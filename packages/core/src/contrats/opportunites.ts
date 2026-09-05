/**
 * Contrat HTTP de l'écran « Où aller ? » (docs/demandes/14-EVENEMENTS-COMME-
 * OPPORTUNITES.md), en miroir de `apps/api/src/routes/opportunites.ts`.
 *
 * Même règle que les autres fichiers de ce dossier : uniquement des schémas
 * Zod et les types qui en dérivent — la logique vit dans
 * `packages/core/src/opportunites.ts` et `packages/core/src/deplacement.ts`
 * (fiche 13, réutilisé sans modification).
 *
 * `schemaFiabiliteLieu` est importé de `./lieux.js` plutôt que redéclaré :
 * c'est EXACTEMENT la même notion (`fiabiliteLieu`, `deplacement.ts`), une
 * opportunité n'invente pas un second vocabulaire de fiabilité. Même logique
 * pour `schemaTypeEvenement`, importé de `./previsions.js` : le type d'un
 * événement ne change pas parce qu'il devient une opportunité.
 */

import { z } from 'zod';
import { estJourCivilValide } from '../horodatage.js';
import { schemaFiabiliteLieu } from './lieux.js';
import { schemaTypeEvenement } from './previsions.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Famille d'opportunité — domaine fermé (fiche 14 §3)
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaFamilleOpportunite = z.enum(['grand_public', 'entreprise', 'marche_noel']);

export type FamilleOpportuniteContrat = z.infer<typeof schemaFamilleOpportunite>;

/* ═══════════════════════════════════════════════════════════════════════════
   Ligne de la comparaison — une opportunité, sa fréquentation et sa marge
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaLigneOpportunite = z.object({
  id: z.string(),
  nom: z.string(),
  type: schemaTypeEvenement,
  famille: schemaFamilleOpportunite,
  dateDebut: z.string(),
  dateFin: z.string(),
  /** Nombre de sessions couvertes — 1, sauf campagne marché de Noël (fiche 14 §3.3). */
  nbSessions: z.int(),
  communeTexte: z.string().nullable(),
  lieuId: z.string().nullable(),
  lieuNom: z.string().nullable(),
  /**
   * Distance retenue pour le calcul de déplacement — ROUTIÈRE si un lieu de
   * marché est rattaché (`lieu_marche.distance_km`), sinon À VOL D'OISEAU
   * (`evenement.distance_km`, fiche 05) en dernier recours. Voir
   * `distanceEstimeeVolDoiseau` pour savoir laquelle des deux c'est.
   */
  distanceKm: z.number().nullable(),
  /** `true` : la distance ci-dessus n'est qu'une estimation à vol d'oiseau. */
  distanceEstimeeVolDoiseau: z.boolean(),
  /** `null` = inconnu, jamais 0 — pertinent surtout pour la famille `entreprise`. */
  effectifEstime: z.int().nullable(),
  fiabilite: schemaFiabiliteLieu,
  nbSessionsRetenues: z.int(),
  /** D'où vient la fréquentation affichée — l'utilisateur doit pouvoir la contester. */
  explicationPrevision: z.string(),
  crepesPrevuesParSession: z.int().nullable(),
  crepesPrevuesTotal: z.int().nullable(),
  caAttenduCents: z.int().nullable(),
  coutMatiereAttenduCents: z.int().nullable(),
  coutGazAttenduCents: z.int().nullable(),
  coutEmplacementCents: z.int().nullable(),
  coutEmplacementIndisponibleRaison: z.string().nullable(),
  coutDeplacementCents: z.int().nullable(),
  /** `null` dès qu'un des coûts ou la fréquentation est inconnu — jamais une marge partielle. */
  margeNetteAttendueCents: z.int().nullable(),
  source: z.string().nullable(),
  notes: z.string().nullable(),
});

export const schemaListeOpportunites = z.object({
  data: z.array(schemaLigneOpportunite),
  meta: z.object({
    total: z.int(),
    coutKilometriqueCentsParKm: z.number(),
    coutKilometriqueSource: z.string(),
    coutsDisponibles: z.boolean(),
    avertissementCouts: z.string().nullable(),
    /**
     * Rappelle POURQUOI la famille `entreprise` reste silencieuse (fiche 14
     * §3.2, D-059) : non `null` tant qu'aucun mécanisme d'observation du taux
     * de prise n'existe — voir `packages/core/src/opportunites.ts`.
     */
    avertissementTauxPriseEntreprise: z.string().nullable(),
  }),
});

export type LigneOpportunite = z.infer<typeof schemaLigneOpportunite>;
export type ListeOpportunites = z.infer<typeof schemaListeOpportunites>;

/* ═══════════════════════════════════════════════════════════════════════════
   Création d'une opportunité — directement dans `evenement`, hors du parcours
   « facteur classique » de `apps/api/src/routes/previsions.ts`
   ═══════════════════════════════════════════════════════════════════════════ */

const champJourCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ, par exemple 2026-12-01.')
  // La FORME ne suffit pas : `2026-02-30` la respecte et n'existe pas.
  .refine(estJourCivilValide, 'Cette date n’existe pas au calendrier.');

export const schemaCreationOpportunite = z
  .object({
    nom: z.string().trim().min(1, 'Donnez un nom à cette opportunité.').max(200),
    type: schemaTypeEvenement,
    famille: schemaFamilleOpportunite,
    dateDebut: champJourCivil,
    dateFin: champJourCivil,
    communeTexte: z.string().trim().min(1).max(200).nullable().optional(),
    lieuId: z.string().min(1).nullable().optional(),
    /** À vol d'oiseau — ignorée si `lieuId` référence un lieu avec sa propre distance routière. */
    distanceKm: z.number().nonnegative().max(500).nullable().optional(),
    effectifEstime: z.int().nonnegative().nullable().optional(),
    source: z.string().trim().min(1).max(500).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.dateFin >= v.dateDebut, {
    message: 'La date de fin ne peut pas précéder la date de début.',
    path: ['dateFin'],
  });

export type CreationOpportunite = z.infer<typeof schemaCreationOpportunite>;

/** Corps de `PATCH /opportunites/:id/rattacher-lieu` — associer un lieu déclaré, après coup. */
export const schemaRattachementLieuOpportunite = z.object({
  lieuId: z.string().min(1, 'Choisissez un lieu.'),
});

export type RattachementLieuOpportunite = z.infer<typeof schemaRattachementLieuOpportunite>;
