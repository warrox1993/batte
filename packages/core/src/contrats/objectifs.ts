/**
 * Contrat HTTP des routes `/api/objectifs`
 * (fiche `docs/demandes/18-SUCCES-NIVEAUX-ET-OBJECTIFS.md`).
 *
 * Même convention que les autres fichiers de `contrats/` : un seul schéma
 * valide la sortie côté serveur ET dérive le type côté client.
 *
 * ═══ Objectifs (budget) — câblés ═══
 *
 * La table `objectif` existe (migration `0022_awesome_lyja.sql`, voir
 * `packages/db/src/schema.ts`). Les schémas de LECTURE (`schemaObjectifLigne`,
 * `schemaListeObjectifs`) et de SAISIE (`schemaCreationObjectif`,
 * `schemaAnnulationObjectif`) sont utilisés par `packages/db/src/depots/objectifs.ts`
 * (persistance) et `apps/api/src/routes/objectifs.ts` (`GET /objectifs`,
 * `POST /objectifs`, `POST /objectifs/:id/annuler`). Le moteur d'évaluation
 * pur (`packages/core/src/objectifs.ts`) reste la seule source de calcul
 * (CLAUDE.md §3 règle 1) : ce dépôt ne fait que lire/écrire et lui déléguer
 * l'évaluation cible/réalisé.
 *
 * ═══ Succès et niveaux ═══
 *
 * `schemaSucces`, à l'inverse, ne dépend d'AUCUNE table nouvelle : un succès
 * est une VUE recalculée depuis les données déjà en base (CLAUDE.md §3
 * règle 5, fiche §5.1). `packages/db/src/depots/objectifs.ts` l'alimente
 * dès maintenant.
 */

import { z } from 'zod';
import { estJourCivilValide } from '../horodatage.js';
import { GRANDEURS_OBJECTIF } from '../objectifs.js';
// `schemaTableauSeuils` vit dans `contrats/sessions.ts`, déjà exporté par le
// barrel (`@batte/core`) — import direct, aucun pont temporaire nécessaire ici.
import { schemaTableauSeuils } from './sessions.js';

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
   Objectifs (budget)
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaGrandeurObjectif = z.enum(GRANDEURS_OBJECTIF);

export const schemaStatutObjectif = z.enum(['sans_donnee', 'atteint', 'en_cours', 'manque']);

export const schemaEvaluationObjectif = z.object({
  grandeur: schemaGrandeurObjectif,
  valeurCible: z.int(),
  realise: z.number().nullable(),
  ecart: z.number().nullable(),
  avancementBp: z.int().nullable(),
  statut: schemaStatutObjectif,
  periodeTerminee: z.boolean(),
});

/**
 * Saisie d'un nouvel objectif. `valeurCible` est en CENTIMES pour
 * `chiffre_affaires`, `marge_nette` et `cout_matiere_par_crepe` ; en nombre
 * entier de sessions pour `nombre_sessions` — l'unité est entièrement
 * déterminée par `grandeur`, jamais ambiguë à la lecture puisque les deux
 * familles ne se mélangent jamais dans un même enregistrement.
 */
export const schemaCreationObjectif = z
  .object({
    grandeur: schemaGrandeurObjectif,
    dateDebut: champJourCivil,
    dateFin: champJourCivil,
    valeurCible: z
      .int('La cible doit être un nombre entier.')
      .positive('La cible doit être strictement positive.'),
    notes: champTexteFacultatif,
  })
  .refine((valeur) => valeur.dateDebut <= valeur.dateFin, {
    message: 'La date de fin doit être postérieure ou égale à la date de début.',
    path: ['dateFin'],
  });

export type CreationObjectif = z.infer<typeof schemaCreationObjectif>;

export const schemaAnnulationObjectif = z.object({
  motif: z.string().min(1, 'Indiquez pourquoi cet objectif est annulé.'),
});

export type AnnulationObjectif = z.infer<typeof schemaAnnulationObjectif>;

/**
 * Ligne de lecture. `estAnnulation` / `objectifAnnuleId` / `estAnnule` : même
 * mécanisme de contre-écriture que `depense`
 * (`packages/db/src/depots/comptabilite.ts`, `MARQUEUR_ANNULATION`) plutôt
 * qu'une colonne `is_annule` — CLAUDE.md §3 règle 7 satisfaite sans colonne
 * supplémentaire, exactement pour la même raison : la table `objectif`
 * proposée n'en porte pas.
 */
export const schemaObjectifLigne = z.object({
  id: z.string(),
  grandeur: schemaGrandeurObjectif,
  dateDebut: z.string(),
  dateFin: z.string(),
  valeurCible: z.int(),
  notes: z.string().nullable(),
  /** Vrai si cette ligne EST une contre-écriture d'annulation. */
  estAnnulation: z.boolean(),
  /** Identifiant de l'objectif annulé par cette ligne, si `estAnnulation`. */
  objectifAnnuleId: z.string().nullable(),
  /** Vrai si une autre ligne annule celle-ci. */
  estAnnule: z.boolean(),
  creeLe: z.string(),
  modifieLe: z.string(),
  evaluation: schemaEvaluationObjectif,
});

export const schemaListeObjectifs = z.object({
  data: z.array(schemaObjectifLigne),
  meta: z.object({ total: z.int() }),
});

// Suffixe `Contrat` (comme les types de succès plus bas) : le dépôt
// (`packages/db/src/depots/objectifs.ts`) expose son propre type `ObjectifLigne`,
// structurellement identique mais nommé sans suffixe — même convention que
// `DepenseLigneContrat` / `DepenseLigne` (`comptabilite.ts`). Sans cette
// distinction, un fichier important les deux (comme la route HTTP) aurait un
// conflit de noms.
export type ObjectifLigneContrat = z.infer<typeof schemaObjectifLigne>;
export type ListeObjectifsContrat = z.infer<typeof schemaListeObjectifs>;

/* ═══════════════════════════════════════════════════════════════════════════
   Succès — paliers en série (marge, gaspillage, prévision, AFSCA, coût matière)
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaResultatPalierSerie = z.object({
  niveau: z.int(),
  libelle: z.string(),
  longueurRequise: z.int(),
  /** `null` = palier jamais atteint dans l'historique disponible. */
  debloqueLe: z.string().nullable(),
});

export const schemaResultatSerie = z.object({
  /** Identifie l'axe : `marge`, `gaspillage`, `prevision`, `afsca`, `cout_revient`. */
  cle: z.string(),
  libelleAxe: z.string(),
  paliers: z.array(schemaResultatPalierSerie),
  meilleureSerieLongueur: z.int(),
  serieActuelleLongueur: z.int(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Niveaux — chiffre d'affaires cumulé et ancienneté active
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaPalierNiveau = z.object({
  niveau: z.int(),
  seuil: z.int(),
  libelle: z.string(),
});

export const schemaResultatNiveau = z.object({
  niveauActuel: z.int(),
  libelleNiveauActuel: z.string().nullable(),
  valeurActuelle: z.int(),
  prochainPalier: schemaPalierNiveau.nullable(),
  progressionVersProchainBp: z.int().nullable(),
});

/**
 * Niveau de chiffre d'affaires cumulé, TOUJOURS accompagné du contexte des
 * seuils légaux courants — jamais affiché seul (fiche §2.1 : « un palier de
 * CA ne doit jamais s'afficher nu »). Les deux champs sont non-optionnels
 * précisément pour rendre structurellement impossible de rendre l'un sans
 * l'autre.
 */
export const schemaNiveauChiffreAffaires = z.object({
  niveau: schemaResultatNiveau,
  contexteSeuilsLegaux: schemaTableauSeuils,
});

/* ═══════════════════════════════════════════════════════════════════════════
   Anticipation d'un seuil légal — la préparation, pas le montant (fiche §2.1)
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaResultatAnticipationSeuil = z.object({
  cle: z.string(),
  libelle: z.string(),
  dateFranchissementReel: z.string().nullable(),
  datePremiereAlerte: z.string().nullable(),
  joursAnticipation: z.int().nullable(),
  niveau: schemaResultatNiveau,
});

/* ═══════════════════════════════════════════════════════════════════════════
   Enveloppe complète de l'écran Succès
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaSucces = z.object({
  series: z.array(schemaResultatSerie),
  niveauChiffreAffaires: schemaNiveauChiffreAffaires,
  niveauAnciennete: schemaResultatNiveau,
  anticipationSeuils: z.array(schemaResultatAnticipationSeuil),
});

export type ResultatPalierSerieContrat = z.infer<typeof schemaResultatPalierSerie>;
export type ResultatSerieContrat = z.infer<typeof schemaResultatSerie>;
export type PalierNiveauContrat = z.infer<typeof schemaPalierNiveau>;
export type ResultatNiveauContrat = z.infer<typeof schemaResultatNiveau>;
export type NiveauChiffreAffairesContrat = z.infer<typeof schemaNiveauChiffreAffaires>;
export type ResultatAnticipationSeuilContrat = z.infer<typeof schemaResultatAnticipationSeuil>;
export type SuccesContrat = z.infer<typeof schemaSucces>;
