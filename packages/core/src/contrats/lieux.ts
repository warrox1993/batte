/**
 * Contrat HTTP de la comparaison des lieux par marge nette attendue
 * (docs/demandes/13-COUT-COMPLET-ET-ARBITRAGE-ENTRE-LIEUX.md), en miroir de
 * `apps/api/src/routes/lieux-rentabilite.ts`.
 *
 * Même règle que les autres fichiers de ce dossier : uniquement des schémas
 * Zod et les types qui en dérivent, aucun calcul (`packages/core/src/
 * deplacement.ts` porte la logique).
 */

import { z } from 'zod';

/**
 * Fiabilité d'une baseline de lieu (`fiabiliteLieu`, `deplacement.ts`).
 *
 * Liste redondante avec l'union TypeScript de `deplacement.ts` plutôt que
 * dérivée d'elle — même convention que `schemaModeTarification` ci-contre
 * dans `referentiel.ts`, qui ne s'importe pas non plus depuis `schema.ts` :
 * un contrat HTTP décrit une FORME de réponse, indépendamment de la
 * représentation interne qui la produit.
 */
export const schemaFiabiliteLieu = z.enum(['aucune_donnee', 'peu_fiable', 'fiable', 'tres_fiable']);

/**
 * D'où vient le coût kilométrique retenu (`coutKilometriqueRetenu`,
 * `deplacement.ts`) — même convention de redondance que `schemaFiabiliteLieu`
 * ci-dessus : un contrat HTTP décrit une FORME, indépendamment de la
 * représentation interne qui la produit.
 *
 * `forfait` : l'indemnité kilométrique officielle du catalogue.
 * `mesure`  : les frais réels de carburant, divisés par les km parcourus,
 * une fois qu'ils reposent sur assez de pleins (docs/demandes/13 §3.1, voie B).
 */
export const schemaOrigineCoutKilometrique = z.enum(['forfait', 'mesure']);

export const schemaLigneComparaisonLieu = z.object({
  lieuId: z.string(),
  lieuNom: z.string(),
  /**
   * Distance routière aller simple, en km. `null` = non renseignée : CE
   * LIEU NE PEUT PAS ÊTRE COMPARÉ AUX AUTRES sur la marge nette — l'écran
   * doit le dire, jamais le classer premier (docs/demandes/13, point 4).
   *
   * DÉCIMALE depuis le 31/07/2026 (D-074), et ce n'est pas un relâchement : le
   * calcul d'itinéraire rend des mètres, désormais arrondis au dixième de km et
   * non plus au kilomètre. Un `z.int()` ici referait un 422 sur la première
   * distance non ronde. La règle 4 du §3 n'impose l'entier qu'aux MASSES et aux
   * VOLUMES ; une distance routière se lit « 23,4 km ».
   */
  distanceKm: z.number().nullable(),
  /** Baseline météo/événement neutralisés — PAS la recommandation de production. */
  crepesPrevuesBaseline: z.int(),
  nbSessionsRetenues: z.int(),
  poidsPriorBp: z.int(),
  fiabilite: schemaFiabiliteLieu,
  explicationBaseline: z.string(),
  caAttenduCents: z.int().nullable(),
  coutMatiereAttenduCents: z.int().nullable(),
  coutGazAttenduCents: z.int().nullable(),
  coutEmplacementCents: z.int().nullable(),
  /** Pourquoi `coutEmplacementCents` est `null`, quand c'est le cas. */
  coutEmplacementIndisponibleRaison: z.string().nullable(),
  coutDeplacementCents: z.int().nullable(),
  /**
   * `null` dès qu'un des coûts DIFFÉRENTIELS est inconnu (docs/demandes/13
   * §2.2) — jamais une charge fixe ici, voir `deplacement.ts`.
   */
  margeNetteAttendueCents: z.int().nullable(),
});

export const schemaListeComparaisonLieux = z.object({
  data: z.array(schemaLigneComparaisonLieu),
  meta: z.object({
    total: z.int(),
    /** Coût kilométrique retenu pour CE calcul, en centimes/km (peut être décimal). */
    coutKilometriqueCentsParKm: z.number(),
    /** D'où vient ce chiffre — l'utilisateur doit pouvoir contester (CLAUDE.md §7). */
    coutKilometriqueSource: z.string(),
    /** Forfait ou mesuré : voir `schemaOrigineCoutKilometrique` ci-dessus. */
    coutKilometriqueOrigine: schemaOrigineCoutKilometrique,
    /**
     * Phrase affichable TELLE QUELLE (« Forfait officiel : 0,4761 €/km. » ou
     * « Mesuré sur vos frais réels : 0,52 €/km, sur 14 pleins. ») — jamais
     * reconstruite côté écran, même règle que `explicationBaseline` ci-dessus.
     */
    coutKilometriqueLibelle: z.string(),
    /**
     * `false` : ni vente ni tarif affiché n'existe encore nulle part — le CA
     * et la marge de TOUTES les lignes restent `null`, pas un mensonge à 0 €.
     */
    coutsDisponibles: z.boolean(),
    avertissementCouts: z.string().nullable(),
  }),
});

export type FiabiliteLieuContrat = z.infer<typeof schemaFiabiliteLieu>;
export type OrigineCoutKilometriqueContrat = z.infer<typeof schemaOrigineCoutKilometrique>;
export type LigneComparaisonLieu = z.infer<typeof schemaLigneComparaisonLieu>;
export type ListeComparaisonLieux = z.infer<typeof schemaListeComparaisonLieux>;
