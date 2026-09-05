/**
 * Contrat HTTP des routes `/api/concurrents` (fiche
 * `docs/demandes/08-FICHES-CONCURRENTS.md` — répertorier les vendeurs
 * concurrents observés sur les marchés, avec leurs produits et observations
 * qualitatives).
 *
 * Même convention que les autres fichiers de `contrats/` : un seul schéma
 * valide la sortie côté serveur ET dérive le type côté client. Les vocabulaires
 * (`TYPES_OFFRE_CONCURRENT`, etc.) vivent ICI plutôt que dans un fichier séparé
 * de `packages/core/src/` : ce ticket n'est autorisé à créer qu'un contrat
 * NEUF dans `packages/core/src/contrats/`, donc les tableaux de valeurs et les
 * schémas Zod partagent le même fichier — voir le rapport de livraison.
 *
 * ═══ Ce que ce module NE FAIT PAS ═══
 *
 * Aucun champ ici n'alimente le moteur de prévision (`docs/03-MOTEUR-PREVISION.md`).
 * Un concurrent influence la RÉPARTITION de la clientèle entre vendeurs, pas la
 * demande TOTALE du marché — c'est écrit explicitement dans l'écran
 * (`apps/web/src/pages/Concurrents.tsx`), pas seulement ici.
 */

import { z } from 'zod';
import { estJourCivilValide } from '../horodatage.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Champs communs (mêmes conventions que contrats/economies.ts)
   ═══════════════════════════════════════════════════════════════════════════ */

const champJourCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ, par exemple 2026-07-28.')
  // La FORME ne suffit pas : `2026-02-30` la respecte et n'existe pas.
  .refine(estJourCivilValide, 'Cette date n’existe pas au calendrier.');

/** Champ texte facultatif : `''` et `undefined` deviennent tous deux `null`. */
const champTexteFacultatif = z
  .string()
  .nullish()
  .transform((valeur) => {
    if (valeur === undefined || valeur === null) return null;
    const nettoye = valeur.trim();
    return nettoye === '' ? null : nettoye;
  });

/* ═══════════════════════════════════════════════════════════════════════════
   Vocabulaire — dupliqué à la main dans `packages/db/src/schema.ts` (même
   convention que `economie_achat` / `TYPES_ACTION_ECONOMIE` : ce projet ne
   fait pas dépendre `packages/db` de `packages/core` pour un simple enum, et
   inversement `packages/core` ne dépend jamais de `packages/db`).
   ═══════════════════════════════════════════════════════════════════════════ */

export const TYPES_OFFRE_CONCURRENT = [
  'crepes',
  'gaufres',
  'autre_sucre',
  'sale',
  'mixte',
] as const;
export const schemaTypeOffreConcurrent = z.enum(TYPES_OFFRE_CONCURRENT);
export type TypeOffreConcurrent = z.infer<typeof schemaTypeOffreConcurrent>;

export const POSITIONNEMENTS_CONCURRENT = ['bas_de_gamme', 'standard', 'premium'] as const;
export const schemaPositionnementConcurrent = z.enum(POSITIONNEMENTS_CONCURRENT);
export type PositionnementConcurrent = z.infer<typeof schemaPositionnementConcurrent>;

export const AFFLUENCES_ESTIMEES = ['nulle', 'faible', 'moyenne', 'forte'] as const;
export const schemaAffluenceEstimee = z.enum(AFFLUENCES_ESTIMEES);
export type AffluenceEstimee = z.infer<typeof schemaAffluenceEstimee>;

/* ═══════════════════════════════════════════════════════════════════════════
   Concurrent — lecture
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaConcurrent = z.object({
  id: z.string(),
  nom: z.string(),
  lieuId: z.string(),
  lieuNom: z.string(),
  typeOffre: schemaTypeOffreConcurrent,
  positionnement: schemaPositionnementConcurrent,
  emplacementObserve: z.string().nullable(),
  /**
   * 1 à 5 — appréciation SUBJECTIVE assumée comme telle (fiche 08). Tout
   * affichage de ce champ doit rappeler sa nature : un chiffre présenté sans
   * elle se lit comme une mesure.
   */
  qualitePercue: z.int().min(1).max(5),
  dateDerniereObservation: z.string().nullable(),
  notesGenerales: z.string().nullable(),
  actif: z.boolean(),
  creeLe: z.string(),
  modifieLe: z.string(),
});

export const schemaListeConcurrents = z.object({
  data: z.array(schemaConcurrent),
  meta: z.object({ total: z.int() }),
});

export const schemaConcurrentProduitLigne = z.object({
  id: z.string(),
  concurrentId: z.string(),
  nomProduit: z.string(),
  prixCents: z.int(),
  description: z.string().nullable(),
  dateObservation: z.string(),
  creeLe: z.string(),
});

export const schemaConcurrentObservationLigne = z.object({
  id: z.string(),
  concurrentId: z.string(),
  dateObservation: z.string(),
  affluenceEstimee: schemaAffluenceEstimee,
  fileAttente: z.boolean(),
  notes: z.string().nullable(),
  creeLe: z.string(),
});

/** Projection « dernier prix connu », calculée à la lecture — jamais stockée
 * (voir l'en-tête de `concurrent_produit` dans `packages/db/src/schema.ts`). */
export const schemaDernierPrixProduit = z.object({
  nomProduit: z.string(),
  prixCents: z.int(),
  dateObservation: z.string(),
});

export const schemaConcurrentDetail = schemaConcurrent.extend({
  /** Historique COMPLET, le plus récent d'abord — jamais aplati. */
  produits: z.array(schemaConcurrentProduitLigne),
  observations: z.array(schemaConcurrentObservationLigne),
  dernierPrixParProduit: z.array(schemaDernierPrixProduit),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Saisie — fiche concurrent (création ET modification, même forme que
   `schemaSaisieFournisseur`)
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaSaisieConcurrent = z.object({
  nom: z.string().trim().min(1, 'Le nom du concurrent est obligatoire.'),
  lieuId: z.string().min(1, 'Choisissez le lieu où ce concurrent est observé.'),
  typeOffre: schemaTypeOffreConcurrent,
  positionnement: schemaPositionnementConcurrent,
  emplacementObserve: champTexteFacultatif,
  qualitePercue: z
    .int('La qualité perçue doit être un nombre entier.')
    .min(1, 'La qualité perçue va de 1 à 5.')
    .max(5, 'La qualité perçue va de 1 à 5.'),
  notesGenerales: champTexteFacultatif,
});

export type SaisieConcurrent = z.infer<typeof schemaSaisieConcurrent>;

export const schemaActiviteConcurrent = z.object({ actif: z.boolean() });

/* ═══════════════════════════════════════════════════════════════════════════
   Saisie rapide « après une visite » — produit observé et observation
   qualitative (fiche 08 : « pensé pour être rempli en quelques minutes »)
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaCreationConcurrentProduit = z.object({
  nomProduit: z.string().trim().min(1, 'Le nom du produit observé est obligatoire.'),
  prixCents: z
    .int('Le prix doit être un nombre entier de centimes.')
    .nonnegative('Le prix ne peut pas être négatif.'),
  description: champTexteFacultatif,
  dateObservation: champJourCivil,
});

export type CreationConcurrentProduit = z.infer<typeof schemaCreationConcurrentProduit>;

export const schemaCreationConcurrentObservation = z.object({
  dateObservation: champJourCivil,
  affluenceEstimee: schemaAffluenceEstimee,
  fileAttente: z.boolean().optional().default(false),
  // Obligatoire : une observation sans note qualitative n'apporte rien — c'est
  // le coeur de la visite (fiche 08 : « ce que l'utilisateur a goûté, vu,
  // remarqué »).
  notes: z
    .string()
    .trim()
    .min(1, 'Décrivez ce que vous avez observé : c’est le cœur de la visite.'),
});

export type CreationConcurrentObservation = z.infer<typeof schemaCreationConcurrentObservation>;

/* ═══════════════════════════════════════════════════════════════════════════
   Comparateur — notre carte face aux derniers prix relevés (fiche 08 : « le
   seul écran du module qui change une décision »). Aucune correspondance
   produit-à-produit n'est INVENTÉE ici : les concurrents « équivalents » sont
   ceux dont l'offre couvre les crêpes (`crepes` ou `mixte`), et les prix
   affichés sont les DERNIERS relevés, avec leur date — jamais un appariement
   automatique nom-à-nom, qui laisserait croire à une précision qui n'existe
   pas.
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaComparateurNotreProduit = z.object({
  produitVenteId: z.string(),
  nom: z.string(),
  nature: z.enum(['transforme', 'revendu']),
  prixCents: z.int(),
});

export const schemaComparateurPrixConcurrent = z.object({
  concurrentId: z.string(),
  concurrentNom: z.string(),
  typeOffre: schemaTypeOffreConcurrent,
  positionnement: schemaPositionnementConcurrent,
  nomProduit: z.string(),
  prixCents: z.int(),
  dateObservation: z.string(),
});

export const schemaComparateur = z.object({
  notreCarte: z.array(schemaComparateurNotreProduit),
  dernierPrixConcurrents: z.array(schemaComparateurPrixConcurrent),
  moyenne: z.object({
    /** `null` quand aucun produit transformé actif n'est en carte. */
    notrePrixMoyenCrepeCents: z.int().nullable(),
    /** `null` quand aucun concurrent équivalent n'a de prix relevé. */
    concurrentsPrixMoyenCents: z.int().nullable(),
    /** `null` si l'une des deux moyennes est indisponible — jamais 0 par défaut. */
    ecartBp: z.int().nullable(),
    nbConcurrentsEquivalents: z.int(),
  }),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Mouvements de prix — « qu'est-ce qui a bougé depuis mon avant-dernier
   relevé ? » (docs/demandes/08-FICHES-CONCURRENTS.md, vérification du
   01/08/2026 : `GET /concurrents/comparateur` ne rend que le DERNIER prix par
   produit, jamais l'avant-dernier — le mouvement n'était donc pas calculable
   sans route dédiée, alors que `concurrent_produit` est bien historisé).
   Comparaison PAR PRODUIT (même clé que `dernierPrixParProduit` :
   `concurrentId` + `nomProduit`), entre les DEUX relevés les plus récents de
   CE produit chez CE concurrent — jamais le dernier relevé contre une
   moyenne, contre un autre produit, ou contre un prix implicite de zéro : ce
   serait une comparaison inventée.
   ═══════════════════════════════════════════════════════════════════════════ */

export const STATUTS_MOUVEMENT_PRIX = ['hausse', 'baisse', 'stable', 'nouveau'] as const;
export const schemaStatutMouvementPrix = z.enum(STATUTS_MOUVEMENT_PRIX);
export type StatutMouvementPrix = z.infer<typeof schemaStatutMouvementPrix>;

export const schemaMouvementPrixConcurrent = z.object({
  concurrentId: z.string(),
  concurrentNom: z.string(),
  nomProduit: z.string(),
  /**
   * `nouveau` : un SEUL relevé existe pour ce produit chez ce concurrent —
   * rien à comparer. Ce n'est pas une « hausse » depuis un prix implicite de
   * zéro (règle du projet : la valeur inconnue vaut `null`, jamais 0) :
   * `prixPrecedentCents`, `ecartCents`, `ecartBp` et
   * `dateObservationPrecedente` sont alors tous `null`.
   */
  statut: schemaStatutMouvementPrix,
  /** Dernier prix connu pour ce produit — toujours renseigné. */
  prixCents: z.int(),
  /** Avant-dernier prix connu — `null` si `statut === 'nouveau'`. */
  prixPrecedentCents: z.int().nullable(),
  /** `prixCents - prixPrecedentCents`, en centimes ENTIERS. `null` si non calculable. */
  ecartCents: z.int().nullable(),
  /**
   * Variation relative en points de base. `null` si non calculable OU si le
   * prix précédent était nul (une variation relative depuis zéro n'a pas de
   * sens — jamais 0 par défaut).
   */
  ecartBp: z.int().nullable(),
  /** Date du DERNIER relevé comparé. */
  dateObservation: z.string(),
  /**
   * Date de l'AVANT-DERNIER relevé comparé — `null` si `statut === 'nouveau'`.
   * Sert à l'écran pour juger l'ANCIENNETÉ du mouvement (un écart mesuré entre
   * deux relevés espacés de six mois ne vaut pas un écart d'une semaine) : à
   * combiner avec `joursEntre` (`@batte/core`, déjà exporté) plutôt que
   * dupliqué ici.
   */
  dateObservationPrecedente: z.string().nullable(),
});

export const schemaMouvementsPrixConcurrents = z.object({
  data: z.array(schemaMouvementPrixConcurrent),
  meta: z.object({ total: z.int() }),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Types dérivés
   ═══════════════════════════════════════════════════════════════════════════ */

export type Concurrent = z.infer<typeof schemaConcurrent>;
export type ListeConcurrents = z.infer<typeof schemaListeConcurrents>;
export type ConcurrentProduitLigne = z.infer<typeof schemaConcurrentProduitLigne>;
export type ConcurrentObservationLigne = z.infer<typeof schemaConcurrentObservationLigne>;
export type DernierPrixProduit = z.infer<typeof schemaDernierPrixProduit>;
export type ConcurrentDetail = z.infer<typeof schemaConcurrentDetail>;
export type Comparateur = z.infer<typeof schemaComparateur>;
export type MouvementPrixConcurrent = z.infer<typeof schemaMouvementPrixConcurrent>;
export type MouvementsPrixConcurrents = z.infer<typeof schemaMouvementsPrixConcurrents>;
