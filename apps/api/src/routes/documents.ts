/**
 * Routes `/api/documents` et `/api/exports` — les documents que l'application
 * sait produire mais qu'aucune adresse HTTP n'exposait.
 *
 * Deux conventions, celles de `docs/06` § « Conventions d'API » :
 *   GET /api/documents/:type/:id   -> un PDF
 *   GET /api/exports/:type         -> un classeur Excel
 *
 * En-tetes, type MIME et nom de fichier reprennent EXACTEMENT le modele des
 * deux routes qui existaient deja (`commandes.ts` pour le bon de commande,
 * `previsions.ts` pour le brief) : `Content-Disposition: inline` avec le nom du
 * fichier archive, et le corps est le fichier lui-meme relu sur disque.
 *
 * D-026, point capital : chaque appel ARCHIVE une NOUVELLE VERSION numerotee,
 * avec son empreinte SHA-256 et l'instantane des donnees sources. On ne
 * regenere jamais « par-dessus » : consulter deux fois le registre de juillet
 * produit deux fichiers, `v1` et `v2`, tous deux conserves. C'est ce qui permet
 * d'affirmer, devant un controle, que le fichier presente est bien celui qui a
 * ete emis a telle date — `verifierIntegrite` le prouve.
 *
 * Conventions d'erreur D-035 : 404 quand la ressource ADRESSEE DANS L'URL
 * n'existe pas, 422 avec `champs` quand une valeur SAISIE (une periode, un
 * exercice) est invalide.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ErreurIntrouvable, ErreurMetier } from '@batte/core';
import { aujourdHui, lireProductionDetail, tracabiliteAvalLot, type BaseBatte } from '@batte/db';
import {
  affichetteAllergenes,
  etiquetteBac,
  ficheTechnique,
  rapportSession,
} from '../documents/gabarits.js';
import { registreAfscaMensuel } from '../documents/registre-afsca.js';
import { ficheRappelLot } from '../documents/fiche-rappel.js';
import {
  archiverExportExcel,
  exportJournalAchats,
  exportJournalRecettes,
  exportMouvementsStock,
  exportStockValorise,
} from '../documents/excel.js';
import { rendrePdf, type DocumentArchive } from '../documents/rendu.js';
import {
  donneesAffichetteAllergenes,
  donneesEtiquetteBac,
  donneesExportMouvements,
  donneesExportStock,
  donneesFicheRappelLot,
  donneesFicheTechnique,
  donneesJournalAchats,
  donneesJournalRecettes,
  donneesRapportSession,
  donneesRegistreAfsca,
  libellePeriodeMensuelle,
  statutSession,
} from '../documents/donnees.js';

/**
 * Periode mensuelle `AAAA-MM`.
 *
 * Validee par Zod plutot que par un `Number.parseInt` optimiste : une periode
 * absurde doit rendre un 422 avec le champ fautif, jamais un registre vide qui
 * passerait pour « aucun relevé ce mois-là » (CLAUDE.md §7).
 */
const schemaPeriodeMensuelle = z.object({
  periode: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Indiquez un mois au format AAAA-MM, par exemple 2026-07.'),
});

/** Exercice comptable. Bornes larges : c'est un garde-fou de saisie, pas une regle metier. */
const schemaExercice = z.object({
  annee: z.coerce
    .number()
    .int('L’exercice doit être une année entière.')
    .min(2000, 'Exercice trop ancien : indiquez une année à partir de 2000.')
    .max(2200, 'Exercice trop lointain.'),
});

/**
 * Envoie un document archive tel quel.
 *
 * Le fichier est RELU sur disque plutot que garde en memoire apres l'ecriture :
 * ce qui part au navigateur est donc exactement l'octet archive, celui sur
 * lequel porte l'empreinte SHA-256. Meme geste que `genererPdfCommande`
 * (`routes/commandes.ts`).
 */
function servirFichier(
  doc: DocumentArchive,
  typeMime: string,
  reponse: { header: (nom: string, valeur: string) => unknown; type: (t: string) => unknown },
): Buffer {
  const octets = readFileSync(doc.chemin);
  reponse.header('Content-Disposition', `inline; filename="${basename(doc.chemin)}"`);
  reponse.type(typeMime);
  return octets;
}

const MIME_PDF = 'application/pdf';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function routesDocuments(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /* ═══════════════════════════════════════════════════════════════════════
       PDF
       ═══════════════════════════════════════════════════════════════════════ */

    /** Fiche technique d'une VERSION de recette (`docs/01` module 1). */
    app.get<{ Params: { id: string } }>(
      '/documents/fiche-technique/:id',
      async (requete, reponse) => {
        const donnees = donneesFicheTechnique(base, requete.params.id);
        if (donnees === null) throw new ErreurIntrouvable('Recette', requete.params.id);

        const doc = await rendrePdf(base, {
          type: 'fiche_technique',
          objetId: requete.params.id,
          numero: donnees.code,
          titre: `Fiche technique ${donnees.code}`,
          ...ficheTechnique(donnees),
          parametresSource: donnees,
        });

        return servirFichier(doc, MIME_PDF, reponse);
      },
    );

    /**
     * Affichette allergenes — OBLIGATION D'AFFICHAGE sur le stand.
     *
     * Sans identifiant : elle porte toute la carte active, pas un produit. Elle
     * est donc archivee avec `objetId = null`, ce qui la versionne globalement
     * — reediter l'affichette apres avoir ajoute un produit cree la version
     * suivante, et l'ancienne reste consultable pour prouver ce qui etait
     * affiche tel jour.
     */
    app.get('/documents/affichette-allergenes', async (_requete, reponse) => {
      const donnees = donneesAffichetteAllergenes(base);
      if (donnees.produits.length === 0) {
        throw new ErreurMetier(
          'aucun_produit_actif',
          "Aucun produit actif : l'affichette serait vide. Activez au moins un produit de la carte avant de l'éditer.",
        );
      }

      const doc = await rendrePdf(base, {
        type: 'affichette_allergenes',
        objetId: null,
        numero: null,
        titre: 'Affichette allergènes',
        ...affichetteAllergenes(donnees),
        parametresSource: donnees,
      });

      return servirFichier(doc, MIME_PDF, reponse);
    });

    /**
     * Etiquette a coller sur le bac de pate (document interne de tracabilite).
     *
     * Garde-fou de statut : une production ANNULEE n'a jamais existe en pate
     * reellement produite (CLAUDE.md §3 regle 6, tracabilite par lot). Coller
     * une etiquette sur ce bac designerait un lot qui n'aurait jamais du
     * exister — c'est une erreur de tracabilite, pas seulement un document
     * inutile.
     */
    app.get<{ Params: { id: string } }>(
      '/documents/etiquette-bac/:id',
      async (requete, reponse) => {
        const production = lireProductionDetail(base, requete.params.id);
        if (production === null) throw new ErreurIntrouvable('Production', requete.params.id);
        if (production.statut === 'annulee') {
          throw new ErreurMetier(
            'production_annulee',
            `La production ${production.numero} est annulée : imprimer l'étiquette de ce bac ` +
              `désignerait un lot qui n'aurait jamais dû exister.`,
          );
        }

        const donnees = donneesEtiquetteBac(base, requete.params.id);
        if (donnees === null) throw new ErreurIntrouvable('Production', requete.params.id);

        const doc = await rendrePdf(base, {
          type: 'etiquette_bac',
          objetId: requete.params.id,
          numero: donnees.numeroLotPate,
          titre: `Étiquette ${donnees.numeroLotPate}`,
          ...etiquetteBac(donnees),
          parametresSource: donnees,
        });

        return servirFichier(doc, MIME_PDF, reponse);
      },
    );

    /**
     * Rapport d'une session CLOTUREE.
     *
     * Une session ouverte est refusee en 422 et non en 404 : la session existe,
     * c'est son etat qui interdit le document. Editer un « rapport » de session
     * en cours reviendrait a presenter un chiffre provisoire comme un resultat.
     */
    app.get<{ Params: { id: string } }>(
      '/documents/rapport-session/:id',
      async (requete, reponse) => {
        const statut = statutSession(base, requete.params.id);
        if (statut === null) throw new ErreurIntrouvable('Session', requete.params.id);
        if (statut !== 'cloturee') {
          throw new ErreurMetier(
            'session_non_cloturee',
            `Cette session est en statut « ${statut} » : le rapport n'est éditable qu'après clôture.`,
          );
        }

        const donnees = donneesRapportSession(base, requete.params.id);
        if (donnees === null) throw new ErreurIntrouvable('Session', requete.params.id);

        const doc = await rendrePdf(base, {
          type: 'rapport_session',
          objetId: requete.params.id,
          numero: donnees.numero,
          titre: `Rapport de session ${donnees.numero}`,
          ...rapportSession(donnees),
          parametresSource: donnees,
        });

        return servirFichier(doc, MIME_PDF, reponse);
      },
    );

    /**
     * Registre d'autocontrole AFSCA d'un mois — la seule sortie opposable a un
     * controle (`docs/04` : minimum vital).
     *
     * Un mois SANS relevé produit quand meme un registre : chaque section porte
     * alors « Aucun relevé sur la période ». C'est une information, et c'en est
     * une que le controleur doit pouvoir lire — la refuser reviendrait a
     * masquer un mois vide.
     */
    app.get<{ Querystring: { periode?: string } }>(
      '/documents/registre-afsca',
      async (requete, reponse) => {
        const { periode } = schemaPeriodeMensuelle.parse(requete.query);
        const annee = Number.parseInt(periode.slice(0, 4), 10);
        const mois = Number.parseInt(periode.slice(5, 7), 10);

        const donnees = donneesRegistreAfsca(base, annee, mois);

        const doc = await rendrePdf(base, {
          type: 'registre_afsca',
          objetId: periode,
          numero: null,
          titre: `Registre AFSCA — ${libellePeriodeMensuelle(annee, mois)}`,
          ...registreAfscaMensuel(donnees),
          parametresSource: donnees,
        });

        return servirFichier(doc, MIME_PDF, reponse);
      },
    );

    /**
     * Fiche de rappel — traçabilité AVAL d'un lot fournisseur (mission du
     * 01/08/2026, voir le docblock de `../documents/fiche-rappel.ts` pour
     * l'argument complet sur pourquoi ce document est DÉDIÉ, distinct du
     * registre AFSCA mensuel).
     *
     * `:lot` ACCEPTE INDIFFÉREMMENT L'IDENTIFIANT TECHNIQUE DU LOT OU SON
     * NUMÉRO FOURNISSEUR — même convention que `/afsca/tracabilite/lots/:id`
     * (`routes/afsca.ts`), pour la même raison : `tracabiliteAvalLot` résout
     * déjà les deux (`resoudreLotId`, `packages/db/src/depots/tracabilite.ts`),
     * en essayant l'identifiant technique en premier puis le numéro
     * fournisseur en repli. Restreindre cette route à un seul des deux serait
     * un choix, pas une contrainte technique — et un choix perdant : un avis
     * de rappel réel porte le numéro fournisseur, jamais l'identifiant
     * technique (ce que le porteur a sous les yeux), mais `numeroLotFournisseur`
     * est NULLABLE (`schema.ts`, colonne `lot.numero_lot_fournisseur`) — un lot
     * réceptionné sans numéro fournisseur deviendrait alors définitivement
     * inatteignable par cette fiche si elle n'acceptait QUE ce numéro.
     *
     * `objetId` D'ARCHIVAGE : L'IDENTIFIANT TECHNIQUE RÉSOLU, JAMAIS LA CHAÎNE
     * BRUTE REÇUE DANS L'URL. `tracabiliteAvalLot` est donc appelée UNE
     * PREMIÈRE FOIS ici pour obtenir `lotId`, avant de reconstruire les
     * données d'affichage via `donneesFicheRappelLot(base, lotId)` — sans
     * cette résolution préalable, consulter le même lot une fois par son
     * numéro fournisseur puis une fois par son identifiant technique
     * ouvrirait DEUX historiques de version distincts pour le MÊME lot
     * (chacun verrait sa propre « version 1 ») au lieu d'une version 1 puis
     * d'une version 2 continues (D-026). Le second appel de résolution, sur
     * un identifiant déjà technique, aboutit immédiatement (`resoudreLotId`
     * essaie toujours l'identifiant technique en premier) : aucun risque
     * d'ambiguïté introduit par ce second passage.
     *
     * DEUX CAS, ET UN SEUL N'EST PAS UNE ERREUR. Un lot INCONNU rend 404
     * (`ErreurIntrouvable`, ressource adressée dans l'URL — D-035) ; un
     * numéro fournisseur AMBIGU (plusieurs lots le partagent) rend 422
     * (`ErreurMetier` par défaut) — les deux sont déjà levés par
     * `tracabiliteAvalLot`, rien à ajouter ici. Un lot RÉEL qui n'a alimenté
     * aucune production N'EST PAS un de ces deux cas : le gabarit édite
     * alors un document qui DIT « Aucune production n'a consommé ce lot. »
     * (CLAUDE.md §7 — un document vide qui ne dit pas qu'il est vide se lit
     * comme « rien à signaler », ce qui n'est pas la même information).
     */
    app.get<{ Params: { lot: string } }>(
      '/documents/fiche-rappel/:lot',
      async (requete, reponse) => {
        const aval = tracabiliteAvalLot(base, requete.params.lot);
        const donnees = donneesFicheRappelLot(base, aval.lotId);

        const doc = await rendrePdf(base, {
          type: 'fiche_rappel',
          objetId: aval.lotId,
          numero: donnees.numeroLotFournisseur,
          titre:
            donnees.numeroLotFournisseur === null
              ? `Fiche de rappel — ${donnees.ingredientNom}`
              : `Fiche de rappel — ${donnees.ingredientNom} (${donnees.numeroLotFournisseur})`,
          ...ficheRappelLot(donnees),
          parametresSource: donnees,
        });

        return servirFichier(doc, MIME_PDF, reponse);
      },
    );

    /* ═══════════════════════════════════════════════════════════════════════
       Excel
       ═══════════════════════════════════════════════════════════════════════ */

    /** Etat de stock valorise a aujourd'hui (`docs/01` module 2). */
    app.get('/exports/stock', async (_requete, reponse) => {
      const jour = aujourdHui();
      const donnees = donneesExportStock(base, jour);
      const octets = await exportStockValorise(donnees);

      const doc = await archiverExportExcel(
        base,
        { objetId: `stock-${jour}`, numero: null, parametresSource: donnees },
        octets,
      );

      return servirFichier(doc, MIME_XLSX, reponse);
    });

    /** Journal des recettes de l'exercice — obligatoire sous franchise de TVA. */
    app.get<{ Querystring: { annee?: string } }>(
      '/exports/journal-recettes',
      async (requete, reponse) => {
        const { annee } = schemaExercice.parse(requete.query);
        const donnees = donneesJournalRecettes(base, annee);
        const octets = await exportJournalRecettes(donnees);

        const doc = await archiverExportExcel(
          base,
          { objetId: `journal-recettes-${annee}`, numero: null, parametresSource: donnees },
          octets,
        );

        return servirFichier(doc, MIME_XLSX, reponse);
      },
    );

    /** Journal des achats de l'exercice, une ligne par reception. */
    app.get<{ Querystring: { annee?: string } }>(
      '/exports/journal-achats',
      async (requete, reponse) => {
        const { annee } = schemaExercice.parse(requete.query);
        const donnees = donneesJournalAchats(base, annee);
        const octets = await exportJournalAchats(donnees);

        const doc = await archiverExportExcel(
          base,
          { objetId: `journal-achats-${annee}`, numero: null, parametresSource: donnees },
          octets,
        );

        return servirFichier(doc, MIME_XLSX, reponse);
      },
    );

    /** Journal complet des mouvements de stock — la tracabilite exigee par l'AFSCA. */
    app.get<{ Querystring: { annee?: string } }>(
      '/exports/mouvements',
      async (requete, reponse) => {
        const { annee } = schemaExercice.parse(requete.query);
        const donnees = donneesExportMouvements(base, annee);
        const octets = await exportMouvementsStock(donnees);

        const doc = await archiverExportExcel(
          base,
          { objetId: `mouvements-${annee}`, numero: null, parametresSource: donnees },
          octets,
        );

        return servirFichier(doc, MIME_XLSX, reponse);
      },
    );
  };
}
