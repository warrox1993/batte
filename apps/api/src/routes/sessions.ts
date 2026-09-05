/**
 * Routes `/api/sessions`, `/api/lieux`, `/api/produits-vendables` et
 * `/api/seuils` (Lot 4).
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  ErreurIntrouvable,
  ErreurMetier,
  jourCivilBelge,
  schemaAnnulationSession,
  schemaClotureSession,
  schemaCreationSession,
  schemaListeLieux,
  schemaListeProduitsVendables,
  schemaListeSessions,
  schemaRattachementEvenementSession,
  schemaResultatCloture,
  schemaSessionDetail,
  schemaTableauSeuils,
} from '@batte/core';
import {
  annulerSession,
  cloturerSession,
  creerSession,
  lireSessionDetail,
  listerLieux,
  listerProduitsVendables,
  listerSessions,
  tableauSeuils,
  type BaseBatte,
} from '@batte/db';
import { rattacherEvenementSession } from '@batte/db';

/**
 * Justificatifs (ticket, facture) des quatre frais SAISIS à la clôture —
 * lus À PART du contrat partagé, même patron que `schemaPieceJointeRecue`
 * (`routes/factures.ts`) et `schemaPieceJointeReception` (`routes/stock.ts`) :
 * `schemaClotureSession.frais` (`@batte/core`) ne connaît que les quatre
 * MONTANTS, donc son `.parse()` supprimerait ces quatre clés en silence
 * (Zod ignore par défaut les clés qu'il ne connaît pas sur un objet
 * imbriqué comme sur un objet racine). Ce schéma LOCAL relit la MÊME requête
 * BRUTE, pour ces seules clés — les deux schémas cohabitent sans conflit sur
 * le même corps.
 *
 * La validation FORTE (format Data URI, plafond de taille) reste dans
 * `cloturerSession` (`validerPieceJointe`, importée de
 * `packages/db/src/services/factures.ts`) : ce schéma-ci ne vérifie que la
 * FORME du champ (chaîne ou absent), jamais son contenu.
 *
 * Aucune clé pour `energie` : ce poste est CALCULÉ (durées d'équipement ×
 * prix du kWh), jamais une dépense saisie avec un ticket à joindre — voir
 * `FraisSaisis` (`packages/db/src/services/sessions.ts`).
 */
const schemaJustificatifsFraisSession = z.object({
  frais: z
    .object({
      emplacementJustificatifPath: z.string().nullable().optional(),
      deplacementJustificatifPath: z.string().nullable().optional(),
      gazJustificatifPath: z.string().nullable().optional(),
      diversJustificatifPath: z.string().nullable().optional(),
    })
    .optional(),
});

export function routesSessions(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    app.get('/lieux', async () => {
      const lignes = listerLieux(base);
      return schemaListeLieux.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.get('/produits-vendables', async () => {
      const lignes = listerProduitsVendables(base);
      return schemaListeProduitsVendables.parse({
        data: lignes,
        meta: { total: lignes.length },
      });
    });

    app.get('/sessions', async () => {
      const lignes = listerSessions(base);
      return schemaListeSessions.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.get<{ Params: { id: string } }>('/sessions/:id', async (requete) => {
      const detail = lireSessionDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Session', requete.params.id);
      return schemaSessionDetail.parse(detail);
    });

    app.post('/sessions', async (requete, reponse) => {
      const corps = schemaCreationSession.parse(requete.body);

      /*
       * DÉFENSE EN PROFONDEUR, aujourd'hui INATTEIGNABLE — et le commentaire
       * d'origine, corrigé ici le 01/08/2026, ne le disait plus.
       *
       * Il justifiait ce garde-fou par « `schemaCreationSession.dateSession`
       * n'exige qu'une chaîne non vide, sans validation de format ». C'était
       * vrai le jour où il a été écrit ; ça ne l'est plus : le contrat porte
       * désormais la même expression régulière PLUS un
       * `.refine(estJourCivilValide)`. Aucune valeur ne peut donc atteindre ce
       * `throw` — mesuré : la route rend le code `validation`, jamais
       * `date_session_invalide`.
       *
       * POURQUOI ON LE GARDE malgré tout. Le crash qu'il empêche est réel et
       * silencieux : `creerSession` extrait l'année par `dateSession.slice(0,
       * 4)` puis `Number.parseInt(...)` pour numéroter la session, et une
       * valeur mal formée y produit `NaN`, qui remontait en 500 brut. Ce filet
       * ne coûte rien et redeviendrait utile le jour où le contrat serait
       * assoupli — ce qui est exactement le genre de changement qu'on fait
       * sans se souvenir de ce qui en dépendait.
       *
       * Ce qu'il ne faut PAS en conclure : que le code mort se garde par
       * défaut. Ici c'est un garde-fou de cohérence à coût nul ; une CAPACITÉ
       * morte, elle, se retire (voir `productionsDuLot`, `depots/productions.ts`).
       */
      if (!/^\d{4}-\d{2}-\d{2}$/.test(corps.dateSession)) {
        throw new ErreurMetier(
          'date_session_invalide',
          `« ${corps.dateSession} » n'est pas une date valide. Indiquez une date au format AAAA-MM-JJ.`,
          {
            champs: {
              dateSession: 'Indiquez une date au format AAAA-MM-JJ, par exemple 2026-08-01.',
            },
          },
        );
      }

      const creee = creerSession(base, {
        lieuId: corps.lieuId,
        dateSession: corps.dateSession,
        ...(corps.fondsCaisseInitialCents === undefined
          ? {}
          : { fondsCaisseInitialCents: corps.fondsCaisseInitialCents }),
        // Opportunité (fiche 14) qui motive cette session dès sa création —
        // transmise seulement si renseignée : `undefined` laisse le service
        // par défaut à `null` (session régulière).
        ...(corps.evenementId === undefined ? {} : { evenementId: corps.evenementId }),
      });

      const detail = lireSessionDetail(base, creee.id);
      if (detail === null) throw new Error(`Session ${creee.id} introuvable après création.`);

      reponse.code(201);
      return schemaSessionDetail.parse(detail);
    });

    /**
     * Cloture. Ecriture comptable ATOMIQUE : le serveur fait foi sur tous les
     * calculs, l'ecran n'affiche que des totaux d'aide a la saisie.
     */
    app.post<{ Params: { id: string } }>('/sessions/:id/cloturer', async (requete) => {
      const corps = schemaClotureSession.parse(requete.body);
      // Justificatifs des frais (ticket, facture) : `schemaClotureSession`
      // (`@batte/core`) ne les porte pas — voir `schemaJustificatifsFraisSession`
      // ci-dessus pour pourquoi ce second `.parse()` relit la MÊME requête brute.
      const justificatifsFrais = schemaJustificatifsFraisSession.parse(requete.body);

      const resultat = cloturerSession(base, requete.params.id, {
        ventes: corps.ventes.map((v) => ({
          produitVenteId: v.produitVenteId,
          quantite: v.quantite,
          prixUnitaireCents: v.prixUnitaireCents,
          creneauHoraire: v.creneauHoraire ?? null,
        })),
        frais: {
          ...corps.frais,
          // Chaque catégorie porte SON PROPRE justificatif ; `undefined` (rien
          // envoyé pour cette clé) devient `null` — validé et éventuellement
          // refusé par `validerPieceJointe`, dans `cloturerSession`.
          emplacementJustificatifPath:
            justificatifsFrais.frais?.emplacementJustificatifPath ?? null,
          deplacementJustificatifPath:
            justificatifsFrais.frais?.deplacementJustificatifPath ?? null,
          gazJustificatifPath: justificatifsFrais.frais?.gazJustificatifPath ?? null,
          diversJustificatifPath: justificatifsFrais.frais?.diversJustificatifPath ?? null,
        },
        // Kilometres REELS de la tournee (D-064), champ libre et optionnel :
        // `undefined` laisse le service ecrire `null` (non renseigne, jamais 0).
        distanceReelleKm: corps.distanceReelleKm ?? null,
        fondsCaisseInitialCents: corps.fondsCaisseInitialCents,
        especesCompteesCents: corps.especesCompteesCents,
        caCarteCents: corps.caCarteCents,
        // Transmis seulement s'il est saisi : `undefined` laisse le service
        // DERIVER le chiffre des productions rattachees (pas de ressaisie).
        ...(corps.crepesProduites === undefined ? {} : { crepesProduites: corps.crepesProduites }),
        // Second mode, au choix avec `crepesProduites` : le volume de pâte
        // MESURÉ restant dans le bac (demande du porteur).
        volumeRestantSaisi: corps.volumeRestantSaisi ?? null,
        nbTickets: corps.nbTickets ?? null,
        // Relevés de température saisis à la clôture (docs/17 fiche 17) :
        // transmis tels quels, `cloturerSession` les rattache à la session
        // dans sa propre transaction. Absent -> tableau vide, jamais reconstitué.
        relevesTemperature: (corps.relevesTemperature ?? []).map((r) => ({
          moment: r.moment,
          equipement: r.equipement,
          temperatureC: r.temperatureC,
          actionCorrective: r.actionCorrective ?? null,
        })),
        // Équipements électriques utilisés pendant la session (fiche 17) :
        // transmis tels quels, absent -> tableau vide, jamais reconstitué.
        // C'ÉTAIT LE MAILLON MANQUANT (audit du 30/07/2026) — `equipementsUtilises`
        // n'existait ni dans `schemaClotureSession` ni ici : le contrat HTTP ne
        // pouvait donc jamais transmettre cette saisie, alors que le service
        // (`cloturerSession`) et le dépôt (`enregistrerUtilisationEquipement`)
        // étaient déjà prêts à la recevoir. Conséquence concrète : le coût
        // d'électricité se lisait zéro pour toujours, un zéro qui voulait dire
        // « on n'a jamais pu le saisir », pas « ça ne coûte rien ».
        equipementsUtilises: (corps.equipementsUtilises ?? []).map((u) => ({
          equipementId: u.equipementId,
          dureeMinutes: u.dureeMinutes,
        })),
        crepesInvendues: corps.crepesInvendues,
        crepesCassees: corps.crepesCassees,
        heureDebutReelle: corps.heureDebutReelle ?? null,
        heureFinReelle: corps.heureFinReelle ?? null,
        notesQualitatives: corps.notesQualitatives ?? null,
        exclureDuModele: corps.exclureDuModele ?? false,
        motifExclusion: corps.motifExclusion ?? null,
      });

      const detail = lireSessionDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Session', requete.params.id);

      // Les ecarts de stock partent avec la reponse : ils n'ont pas bloque la
      // cloture, mais l'ecran doit les montrer pour qu'un inventaire suive.
      // Idem pour `resolutionVolume` : c'est le detail qui justifie le
      // `crepesProduites` qui vient d'entrer dans `detail`, quand il a ete
      // DEDUIT d'un volume mesure plutot que saisi directement.
      return schemaResultatCloture.parse({
        ...detail,
        ecartsStock: resultat.ecartsStock,
        resolutionVolume: resultat.resolutionVolume,
        // Imputation de la tournée réelle (D-064 point 4, Trou 2, audit du
        // 30/07/2026) : éphémère, comme `resolutionVolume` ci-dessus — voir
        // `services/sessions.ts::cloturerSession` pour le raisonnement complet.
        imputationDeplacement: resultat.imputationDeplacement,
        // Avertissement d'électricité (fiche 17) : éphémère lui aussi — voir
        // `services/sessions.ts::cloturerSession` (`resolutionEnergie`) pour
        // le raisonnement complet (zéro CERTAIN contre zéro par EXCLUSION).
        avertissementEnergie: resultat.avertissementEnergie,
        // Avertissement « marge brute à 100 % sans que rien ne le signale »
        // (audit du 30/07/2026) : éphémère lui aussi — voir
        // `services/sessions.ts::cloturerSession`
        // (`construireAvertissementCoutMatiereTransforme`) et
        // `coutMatiereTransformeSuspect` (`@batte/core`) pour le seuil de
        // déclenchement, justifié en détail.
        avertissementCoutMatiereTransforme: resultat.avertissementCoutMatiereTransforme,
      });
    });

    /**
     * Rattache une session déjà créée à l'opportunité qui l'a motivée
     * (fiche 14), APRÈS coup — refusé sur une session déjà clôturée
     * (`rattacherEvenementSession`, `packages/db/src/services/sessions.ts`) :
     * le lien doit être posé avant, jamais reconstitué après la clôture.
     */
    app.patch<{ Params: { id: string } }>(
      '/sessions/:id/rattacher-evenement',
      async (requete, reponse) => {
        const corps = schemaRattachementEvenementSession.parse(requete.body);
        rattacherEvenementSession(base, requete.params.id, corps.evenementId);
        reponse.code(204);
        return null;
      },
    );

    app.post<{ Params: { id: string } }>('/sessions/:id/annuler', async (requete) => {
      const corps = schemaAnnulationSession.parse(requete.body);
      annulerSession(base, requete.params.id, corps.motif);

      const detail = lireSessionDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Session', requete.params.id);
      return schemaSessionDetail.parse(detail);
    });

    /**
     * Compteurs de seuils legaux, avec PROJECTION de fin d'annee.
     *
     * Un pourcentage instantane ne permet aucune decision ; une projection en
     * permet une. L'alerte porte sur la trajectoire, pas sur le pourcentage
     * (docs/07 §6.8 rang 16).
     */
    app.get<{ Querystring: { annee?: string } }>('/seuils', async (requete) => {
      const anneeDemandee = requete.query.annee;

      // Format vérifié AVANT toute conversion : `Number.parseInt` est permissif
      // (« 2026abc » ou « 2026.5 » seraient tronqués au lieu d'être refusés, et
      // « -2026 » serait accepté comme un entier valide). 422 et non 404 : une
      // année illisible est une SAISIE fautive, pas une ressource absente.
      // `/api/synthese-exercice` rendait déjà 422 pour la même faute — deux
      // conventions pour un même geste sont un piège pour l'écran qui doit
      // décider où accrocher le message.
      if (anneeDemandee !== undefined && !/^\d{4}$/.test(anneeDemandee)) {
        throw new ErreurMetier(
          'annee_invalide',
          `« ${anneeDemandee} » n'est pas une année valide. Indiquez une année à quatre chiffres.`,
          { champs: { annee: 'Indiquez une année à quatre chiffres, par exemple 2026.' } },
        );
      }

      const annee =
        anneeDemandee === undefined
          ? Number.parseInt(jourCivilBelge(new Date()).slice(0, 4), 10)
          : Number.parseInt(anneeDemandee, 10);

      return schemaTableauSeuils.parse(tableauSeuils(base, annee));
    });
  };
}
