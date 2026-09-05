/**
 * Contrat HTTP des équipements électriques du stand et de leur diagnostic de
 * puissance (docs/demandes/17-ENERGIE-GAZ-ELECTRICITE-SOLAIRE-EMPREINTE.md,
 * D-055), en miroir de `apps/api/src/routes/equipements.ts`.
 *
 * Même règle que les autres fichiers de ce dossier : uniquement des schémas
 * Zod et les types qui en dérivent, aucun calcul — la logique pure vit dans
 * `packages/core/src/energie.ts`.
 */

import { z } from 'zod';
import { schemaCategorieIngredient } from './referentiel.js';
import { schemaUnite } from './recettes.js';

/**
 * Un seul concept couvre radiateurs, éclairage, terminal de paiement, froid
 * actif et plaques électriques là où le lieu le permet (docs/demandes/17,
 * « ne pas modéliser "le radiateur" mais l'équipement électrique »).
 */
export const schemaTypeEquipement = z.enum([
  'chauffage',
  'eclairage',
  'froid',
  'cuisson',
  'paiement',
  'autre',
]);

export const schemaEquipement = z.object({
  id: z.string(),
  nom: z.string(),
  type: schemaTypeEquipement,
  /** Puissance nominale, relevée sur la plaque signalétique, en watts. */
  puissanceW: z.int(),
  /** `false` = déclaré pour comparaison avant achat, pas en service. */
  enService: z.boolean(),
  notes: z.string().nullable(),
  actif: z.boolean(),
  /** Nombre de sessions où une durée d'utilisation a été enregistrée pour cet appareil. */
  nbUtilisations: z.int(),
});

export const schemaListeEquipements = z.object({
  data: z.array(schemaEquipement),
  meta: z.object({
    total: z.int(),
    /**
     * Somme des puissances des équipements EN SERVICE et ACTIFS — ce qui
     * demanderait à passer dans le câble si tout tournait en même temps
     * (docs/demandes/17, le risque de disjonction plutôt que le coût).
     */
    puissanceTotaleEnServiceW: z.int(),
  }),
});

/** Même convention que `champTexteFacultatif` de `contrats/referentiel.ts` : `''`/absent → `null`. */
const champTexteFacultatif = z
  .string()
  .trim()
  .nullish()
  .transform((valeur) =>
    valeur === undefined || valeur === null || valeur === '' ? null : valeur,
  );

export const schemaSaisieEquipement = z.object({
  nom: z.string().trim().min(1, "Le nom de l'équipement est obligatoire."),
  type: schemaTypeEquipement,
  puissanceW: z
    .int('La puissance doit être un nombre entier de watts.')
    .positive('La puissance doit être strictement positive.'),
  enService: z.boolean(),
  notes: champTexteFacultatif,
});

/**
 * Diagnostic de disjonction pour UN lieu : puissance requise (le parc en
 * service) comparée à la puissance disponible sur ce lieu.
 *
 * `puissanceDisponibleW`, `margeW` et `risqueDisjonction` sont `null` quand la
 * puissance disponible n'est pas renseignée — jamais interprétés comme
 * « pas de risque » (docs/demandes/17, D-055 : aucune valeur par défaut
 * optimiste).
 */
export const schemaDiagnosticPuissanceLieu = z.object({
  lieuId: z.string(),
  lieuNom: z.string(),
  puissanceRequiseW: z.int(),
  puissanceDisponibleW: z.int().nullable(),
  margeW: z.int().nullable(),
  risqueDisjonction: z.boolean().nullable(),
  /** `null` seulement quand il n'y a rien à signaler. */
  avertissement: z.string().nullable(),
});

export const schemaListeDiagnosticsPuissance = z.object({
  data: z.array(schemaDiagnosticPuissanceLieu),
  meta: z.object({
    puissanceRequiseW: z.int(),
    nbEquipementsEnService: z.int(),
  }),
});

/**
 * Point d'équilibre d'une autoproduction (solaire, éolien) — docs/demandes/17
 * §3. Une ligne PAR IMMOBILISATION existante (« rien de neuf à construire
 * pour le solaire : des panneaux sont une immobilisation comme une remorque
 * ou une plaque »), toutes comparées au MÊME coût d'énergie évité moyen —
 * voir `meta.avertissement` : ce calcul ne vaut que pour un investissement
 * qui PRODUIT de l'électricité (solaire, éolien), pas pour un bien
 * quelconque.
 */
export const schemaPointEquilibreAutoproduction = z.object({
  immobilisationId: z.string(),
  libelle: z.string(),
  coutInstallationCents: z.int(),
  /** `null` : voir `raisonIndisponible` — jamais un chiffre optimiste inventé. */
  sessionsAvantEquilibre: z.int().nullable(),
  raisonIndisponible: z.string().nullable(),
});

export const schemaListePointsEquilibreAutoproduction = z.object({
  data: z.array(schemaPointEquilibreAutoproduction),
  meta: z.object({
    /** `null` : aucune session ne permet encore de le mesurer — voir `raisonCoutEviteIndisponible`. */
    coutEnergieEviteParSessionCents: z.int().nullable(),
    nbSessionsPriseEnCompte: z.int(),
    raisonCoutEviteIndisponible: z.string().nullable(),
    /** Garde-fou TOUJOURS affiché (docs/demandes/17 §3.1) : le solaire ne remplace ni le gaz de cuisson ni le chauffage. */
    avertissement: z.string(),
  }),
});

/**
 * Empreinte — quantités PHYSIQUES (docs/demandes/17 §4). Aucune conversion en
 * CO2 : voir `meta.avertissementConversionCarbone`, TOUJOURS présent.
 */
export const schemaQuantitePhysiqueIngredient = z.object({
  ingredientId: z.string(),
  nom: z.string(),
  categorie: schemaCategorieIngredient,
  uniteReference: schemaUnite,
  /** Quantité REÇUE (achats), dans l'unité PROPRE de cet ingrédient — jamais mélangée avec une autre. */
  quantiteRecue: z.int(),
});

export const schemaEmpreinteQuantitesPhysiques = z.object({
  data: z.array(schemaQuantitePhysiqueIngredient),
  meta: z.object({
    /** Aller-retour (× 2) sur les sessions closes à distance connue — un PLANCHER, pas une mesure complète. */
    kilometresParcourus: z.int(),
    /** Sessions closes exclues du total faute de distance connue sur leur lieu. */
    nbSessionsDistanceInconnue: z.int(),
    /** Tous types d'équipement confondus (cuisson et chauffage compris). */
    energieElectriqueKwh: z.number(),
    /** Rappelle qu'AUCUNE conversion en CO2 n'est faite ici (CLAUDE.md §7, §3 règle n°2). */
    avertissementConversionCarbone: z.string(),
  }),
});

export type TypeEquipement = z.infer<typeof schemaTypeEquipement>;
export type Equipement = z.infer<typeof schemaEquipement>;
export type ListeEquipements = z.infer<typeof schemaListeEquipements>;
export type SaisieEquipement = z.infer<typeof schemaSaisieEquipement>;
export type DiagnosticPuissanceLieuContrat = z.infer<typeof schemaDiagnosticPuissanceLieu>;
export type ListeDiagnosticsPuissance = z.infer<typeof schemaListeDiagnosticsPuissance>;
export type PointEquilibreAutoproductionLigne = z.infer<typeof schemaPointEquilibreAutoproduction>;
export type ListePointsEquilibreAutoproduction = z.infer<
  typeof schemaListePointsEquilibreAutoproduction
>;
export type QuantitePhysiqueIngredientContrat = z.infer<typeof schemaQuantitePhysiqueIngredient>;
export type EmpreinteQuantitesPhysiquesContrat = z.infer<typeof schemaEmpreinteQuantitesPhysiques>;
