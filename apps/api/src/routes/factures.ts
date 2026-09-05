/**
 * Routes `/api/factures` — rapprochement facture fournisseur (fiche 14,
 * docs/17-VINGT-AMELIORATIONS.md § 14).
 *
 * L'API assemble et valide ; toute la logique (rapprochement, ventilation des
 * frais, correction de coût) vient de `@batte/core` et de
 * `packages/db/src/services/factures.ts`, en code testé.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  ErreurIntrouvable,
  schemaAnnulationFacture,
  schemaChangementStatutFacture,
  schemaCorrectionLotAppliquee,
  schemaCreationFacture,
  schemaFactureDetail,
  schemaListeFactures,
  schemaListeReceptionsEligibles,
} from '@batte/core';
import {
  annulerFacture,
  changerStatutFacture,
  corrigerCoutLot,
  enregistrerFacture,
  lireFactureDetail,
  listerFactures,
  receptionsEligibles,
  type BaseBatte,
  type FactureDetail,
} from '@batte/db';

/**
 * Pièce jointe (bon de livraison / facture scannée), validée ICI plutôt que
 * dans `schemaCreationFacture` (`@batte/core`) : le contrat HTTP partagé est
 * hors du périmètre d'écriture de la mission qui a ajouté ce champ (voir le
 * rapport de livraison — `packages/db/src/services/factures.ts` documente la
 * décision de conception complète). Ce schéma LOCAL lit la même requête
 * BRUTE que `schemaCreationFacture`, pour cette seule clé : Zod n'exige pas
 * qu'un objet ne porte QUE les clés déclarées pour être validé, donc les deux
 * schémas cohabitent sans conflit sur le même corps.
 *
 * La validation FORTE (format Data URI, taille maximale) reste dans
 * `enregistrerFacture` (`validerPieceJointe`) : ce schéma-ci ne vérifie que
 * la FORME du champ (chaîne ou absent), jamais son contenu.
 */
const schemaPieceJointeRecue = z.object({
  fichierScanPath: z.string().nullable().optional(),
});

/**
 * Assemble la réponse HTTP d'une facture : le contrat partagé
 * (`schemaFactureDetail`), validé puis ENRICHI de `fichierScanPath` — absent
 * de ce contrat aujourd'hui (voir `schemaPieceJointeRecue` ci-dessus), donc
 * jamais autrement strippé que par cette même validation.
 */
function reponseFactureDetail(detail: FactureDetail): Record<string, unknown> {
  return { ...schemaFactureDetail.parse(detail), fichierScanPath: detail.fichierScanPath };
}

export function routesFactures(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    app.get('/factures', async () => {
      const lignes = listerFactures(base);
      return schemaListeFactures.parse({ data: lignes, meta: { total: lignes.length } });
    });

    /**
     * Réceptions ÉLIGIBLES au rapprochement, pour un fournisseur donné : les
     * lots reçus, avec le prix que le bon de livraison annonçait. Alimente
     * l'écran de saisie, qui ne peut proposer que des réceptions DU MÊME
     * fournisseur que la facture en cours de saisie.
     */
    app.get<{ Params: { fournisseurId: string } }>(
      '/factures/receptions-eligibles/:fournisseurId',
      async (requete) => {
        const lignes = receptionsEligibles(base, requete.params.fournisseurId);
        return schemaListeReceptionsEligibles.parse({
          data: lignes,
          meta: { total: lignes.length },
        });
      },
    );

    app.get<{ Params: { id: string } }>('/factures/:id', async (requete) => {
      const detail = lireFactureDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Facture', requete.params.id);
      return reponseFactureDetail(detail);
    });

    /**
     * Enregistre une facture : rapproche ses lignes des réceptions
     * correspondantes, calcule les écarts de prix (sans les appliquer — voir
     * `services/factures.ts`) et ventile immédiatement les frais de
     * réception sur les lots concernés.
     */
    app.post('/factures', async (requete, reponse) => {
      const corps = schemaCreationFacture.parse(requete.body);
      const pieceJointe = schemaPieceJointeRecue.parse(requete.body);

      const resultat = enregistrerFacture(base, {
        numeroFournisseur: corps.numeroFournisseur,
        fournisseurId: corps.fournisseurId,
        dateFacture: corps.dateFacture,
        dateEcheance: corps.dateEcheance ?? null,
        notes: corps.notes ?? null,
        fichierScanPath: pieceJointe.fichierScanPath ?? null,
        lignes: corps.lignes.map((l) => ({
          libelle: l.libelle,
          montantCents: l.montantCents,
          receptionId: l.receptionId ?? null,
          ingredientId: l.ingredientId ?? null,
          quantiteUniteRef: l.quantiteUniteRef ?? null,
          ...(l.methodeRepartitionFrais !== undefined
            ? { methodeRepartitionFrais: l.methodeRepartitionFrais }
            : {}),
        })),
      });

      const detail = lireFactureDetail(base, resultat.factureId);
      if (detail === null) throw new ErreurIntrouvable('Facture', resultat.factureId);

      reponse.code(201);
      return reponseFactureDetail(detail);
    });

    /** `a_rapprocher -> rapprochee -> payee`, ou `litige`. */
    app.patch<{ Params: { id: string } }>('/factures/:id/statut', async (requete) => {
      const corps = schemaChangementStatutFacture.parse(requete.body);
      changerStatutFacture(base, requete.params.id, corps.statut);

      const detail = lireFactureDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Facture', requete.params.id);
      return reponseFactureDetail(detail);
    });

    /**
     * Annule une facture par CONTRE-ÉCRITURE (CLAUDE.md §3 règle 7) : jamais
     * de DELETE ni d'UPDATE destructif — voir `services/factures.ts`.
     */
    app.post<{ Params: { id: string } }>('/factures/:id/annuler', async (requete, reponse) => {
      const corps = schemaAnnulationFacture.parse(requete.body);
      const resultat = annulerFacture(base, requete.params.id, corps.motif);

      const detail = lireFactureDetail(base, resultat.id);
      if (detail === null) throw new ErreurIntrouvable('Facture', resultat.id);

      reponse.code(201);
      return reponseFactureDetail(detail);
    });

    /**
     * CORRECTION EXPLICITE du coût d'un lot, à partir d'une ligne de facture.
     *
     * Séparée de la saisie de la facture (décision assumée, voir
     * `services/factures.ts`) : l'écart se voit dès l'enregistrement, mais ne
     * corrige rien tant que ce geste n'a pas été demandé explicitement.
     */
    app.post<{ Params: { ligneId: string } }>(
      '/factures/lignes/:ligneId/corriger-lot',
      async (requete, reponse) => {
        const resultat = corrigerCoutLot(base, requete.params.ligneId);
        reponse.code(201);
        return schemaCorrectionLotAppliquee.parse({
          factureLigneId: requete.params.ligneId,
          ...resultat,
        });
      },
    );
  };
}
