/**
 * Routes `/api/commandes` (Lot 7 — reapprovisionnement et mails).
 *
 * D-009 (docs/05-DECISIONS.md) : l'application GENERE et NOTIFIE, l'utilisateur
 * VALIDE et ENVOIE. Trois routes distinctes pour trois etapes distinctes —
 * aucune ne permet de sauter de `brouillon` a `envoyee`.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import {
  ErreurIntrouvable,
  ErreurMetier,
  formaterEuros,
  schemaAnnulationCommandeRequete,
  schemaCommandeDetail,
  schemaEnvoiCommandeRequete,
  schemaGenerationCommandesRequete,
  schemaListeCommandes,
  schemaResultatEnvoiCommande,
  schemaResultatGeneration,
} from '@batte/core';
import {
  annulerCommande,
  genererBrouillonsCommandes,
  lireCommandeDetail,
  listerCommandes,
  marquerEnvoyee,
  validerCommande,
  type BaseBatte,
} from '@batte/db';
import { bonCommande } from '../documents/gabarits.js';
import { rendrePdf } from '../documents/rendu.js';
import { envoyerMail } from '../mail.js';
import { LIMITE_APPEL_EXTERNE, LIMITE_GENERATION_DOCUMENT } from '../plugins/limitation-debit.js';

/** Corps du mail envoye au fournisseur : lisible, sans mise en forme HTML. */
function corpsMailCommande(detail: NonNullable<ReturnType<typeof lireCommandeDetail>>): string {
  const lignes = detail.lignes.map(
    (l) =>
      `  - ${l.quantiteConditionnements} x ${l.conditionnementLibelle ?? l.nomIngredient} ` +
      `(${l.nomIngredient})`,
  );

  return [
    'Bonjour,',
    '',
    `Merci de préparer la commande suivante, référence ${detail.numero} :`,
    '',
    ...lignes,
    '',
    `Montant estimé : ${formaterEuros(detail.montantTotalCents)}.`,
    '',
    'Cordialement.',
  ].join('\n');
}

/**
 * Rend et ARCHIVE le bon de commande en PDF.
 *
 * Factorise entre l'apercu (`GET /commandes/:id/pdf`) et l'envoi : le
 * fournisseur doit recevoir exactement le document que l'utilisateur a pu
 * relire avant de cliquer « Envoyer ». Deux rendus divergents seraient pires
 * que pas de PDF du tout.
 */
async function genererPdfCommande(
  base: BaseBatte,
  detail: NonNullable<ReturnType<typeof lireCommandeDetail>>,
) {
  const rendu = bonCommande({
    numero: detail.numero,
    fournisseurNom: detail.fournisseurNom,
    fournisseurEmail: detail.fournisseurEmail,
    dateCreation: detail.dateCreation,
    dateReceptionSouhaitee: detail.dateReceptionPrevue,
    lignes: detail.lignes.map((l) => ({
      nomIngredient: l.nomIngredient,
      conditionnementLibelle: l.conditionnementLibelle,
      quantiteConditionnements: l.quantiteConditionnements,
      quantiteUniteRef: l.quantiteUniteRef,
      unite: l.unite,
      montantLigneCents: l.montantLigneCents,
    })),
    montantTotalCents: detail.montantTotalCents,
    notes: detail.notes,
  });

  return rendrePdf(base, {
    type: 'bon_commande',
    objetId: detail.id,
    numero: detail.numero,
    titre: `Bon de commande ${detail.numero}`,
    ...rendu,
    parametresSource: detail,
  });
}

export function routesCommandes(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    app.get('/commandes', async () => {
      const lignes = listerCommandes(base);
      return schemaListeCommandes.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.get<{ Params: { id: string } }>('/commandes/:id', async (requete) => {
      const detail = lireCommandeDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Commande', requete.params.id);
      return schemaCommandeDetail.parse(detail);
    });

    /**
     * PDF du bon de commande, joint au mail envoye au fournisseur (docs/06
     * §« Conventions d'API », `GET /api/documents/:type/:id`). Genere a la
     * demande, ARCHIVE a chaque appel (D-026) : consulter le PDF plusieurs
     * fois cree plusieurs versions numerotees, jamais un ecrasement silencieux.
     */
    app.get<{ Params: { id: string } }>(
      '/commandes/:id/pdf',
      { exposeHeadRoute: false, config: { rateLimit: LIMITE_GENERATION_DOCUMENT } },
      async (requete, reponse) => {
        const detail = lireCommandeDetail(base, requete.params.id);
        if (detail === null) throw new ErreurIntrouvable('Commande', requete.params.id);

        const doc = await genererPdfCommande(base, detail);

        const octets = readFileSync(doc.chemin);
        reponse.header('Content-Disposition', `inline; filename="${basename(doc.chemin)}"`);
        reponse.type('application/pdf');
        return octets;
      },
    );

    /**
     * Calcule le point de commande de chaque ingredient et cree des brouillons
     * groupes par fournisseur. N'envoie RIEN : c'est la premiere des trois
     * etapes de D-009.
     */
    app.post('/commandes/generer', async (requete, reponse) => {
      const corps = schemaGenerationCommandesRequete.parse(requete.body ?? {});

      const resultat = genererBrouillonsCommandes(base, {
        ...(corps.jourReference === undefined ? {} : { jourReference: corps.jourReference }),
      });

      reponse.code(201);
      return schemaResultatGeneration.parse({
        data: resultat.commandes,
        meta: { total: resultat.commandes.length, ingredientsIgnores: resultat.ignores },
      });
    });

    /** `brouillon -> validee`. Deuxieme etape : validation humaine explicite. */
    app.post<{ Params: { id: string } }>('/commandes/:id/valider', async (requete) => {
      validerCommande(base, requete.params.id);

      const detail = lireCommandeDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Commande', requete.params.id);
      return schemaCommandeDetail.parse(detail);
    });

    /**
     * Annule un brouillon ou une commande validee, jamais une commande deja
     * envoyee ou recue (audit du 29/07/2026 : `annulee` existait dans l'enum
     * de statut sans qu'aucune route ne l'atteigne — un brouillon abandonne
     * restait compte indefiniment dans le stock projete, voir
     * `services/commandes.ts::annulerCommande`).
     */
    app.post<{ Params: { id: string } }>('/commandes/:id/annuler', async (requete) => {
      const corps = schemaAnnulationCommandeRequete.parse(requete.body ?? {});
      annulerCommande(base, requete.params.id, corps.motif);

      const detail = lireCommandeDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Commande', requete.params.id);
      return schemaCommandeDetail.parse(detail);
    });

    /**
     * `validee -> envoyee`. Troisieme et derniere etape : c'est la SEULE route
     * qui declenche un envoi reel (ou son ecriture en mode test).
     *
     * Refuse explicitement toute commande qui n'est pas `validee`, y compris
     * un `brouillon` : c'est la garantie technique de D-009, pas seulement une
     * convention d'ecran.
     */
    app.post<{ Params: { id: string } }>(
      '/commandes/:id/envoyer',
      { config: { rateLimit: LIMITE_APPEL_EXTERNE } },
      async (requete) => {
        const corps = schemaEnvoiCommandeRequete.parse(requete.body ?? {});

        const avant = lireCommandeDetail(base, requete.params.id);
        if (avant === null) throw new ErreurIntrouvable('Commande', requete.params.id);

        if (avant.statut !== 'validee') {
          throw new ErreurMetier(
            'commande_non_validee',
            `La commande ${avant.numero} est en statut « ${avant.statut} » : seule une ` +
              "commande validée peut être envoyée. Validez-la d'abord.",
          );
        }

        const email = corps.email ?? avant.fournisseurEmail ?? '';
        if (email.trim() === '') {
          throw new ErreurMetier(
            'email_manquant',
            `Aucune adresse email n'est configurée pour ${avant.fournisseurNom}. ` +
              'Renseignez-en une pour envoyer ce bon de commande.',
            { champs: { email: 'Adresse email requise.' } },
          );
        }

        // Le PDF part EN PIECE JOINTE : un fournisseur ne travaille pas sur un
        // corps de mail en texte brut, et le document archive est la seule trace
        // de ce qui a ete commande.
        const doc = await genererPdfCommande(base, avant);

        const resultatMail = await envoyerMail({
          destinataire: email,
          sujet: `Bon de commande ${avant.numero} — ${avant.fournisseurNom}`,
          corpsTexte: corpsMailCommande(avant),
          piecesJointes: [{ nomFichier: basename(doc.chemin), chemin: doc.chemin }],
        });

        // Persiste LE FAIT « ce mail-là est-il parti ? » (mission « le seul
        // piège silencieux qui reste », 01/08/2026) : sans cela, ce fait
        // n'existait plus nulle part une fois cette réponse HTTP partie — une
        // commande envoyée en mode test se relisait, après un rechargement de
        // page, exactement comme un envoi réel (voir
        // `services/commandes.ts::marquerEnvoyee`).
        marquerEnvoyee(base, requete.params.id, email, {
          modeTest: resultatMail.modeTest,
          cheminFichierTest: resultatMail.cheminFichierTest,
        });

        const apres = lireCommandeDetail(base, requete.params.id);
        if (apres === null) throw new ErreurIntrouvable('Commande', requete.params.id);

        return schemaResultatEnvoiCommande.parse({
          ...apres,
          // Toujours CONNU ici (voir le commentaire du champ sur
          // `schemaResultatEnvoiCommande`) : repris directement du résultat de
          // CET appel, plutôt que relu depuis `apres.envoiModeTest` — les deux
          // valent la même chose puisque `marquerEnvoyee` vient de journaliser
          // ce même fait dans la même requête, mais l'écrire explicitement ne
          // dépend d'aucune relecture.
          envoiModeTest: resultatMail.modeTest,
          cheminFichierTest: resultatMail.cheminFichierTest,
        });
      },
    );
  };
}
