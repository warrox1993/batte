/**
 * Contrat HTTP des MENUS (fiche 16 §2) : un produit_vente qui en contient
 * d'autres, avec son propre prix — la remise devant être répartie entre les
 * composants (voir `../menus.ts`, qui porte tout le calcul).
 *
 * Même convention que `contrats/nomenclature-vente.ts` : le même schéma valide
 * la sortie serveur et derive le type client. `schemaNatureProduit` est repris
 * de `./referentiel.js` plutôt que redéfini, pour ne jamais diverger de la
 * nature réellement déclarée sur `produit_vente`.
 */

import { z } from 'zod';
import { schemaNatureProduit } from './referentiel.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Menus — la liste des produits qui en contiennent d'autres
   ═══════════════════════════════════════════════════════════════════════════ */

/** Un menu tel que listé pour l'écran : le produit-conteneur, résumé. */
export const schemaMenuResume = z.object({
  id: z.string(),
  nom: z.string(),
  nature: schemaNatureProduit,
  prixCents: z.int(),
  actif: z.boolean(),
  /** Composants ACTIFS : un menu sans aucun composant actif ne peut pas être ventilé. */
  nbComposantsActifs: z.int(),
});

export const schemaListeMenus = z.object({
  data: z.array(schemaMenuResume),
  meta: z.object({ total: z.int() }),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Composition d'un menu — produit -> produit (à ne pas confondre avec
   `produit_vente_composant`, qui est produit -> ingrédient)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Un composant d'UN menu, enrichi du nom et du prix catalogue de ce qu'il inclut. */
export const schemaCompositionMenu = z.object({
  id: z.string(),
  menuId: z.string(),
  produitInclusId: z.string(),
  nomProduitInclus: z.string(),
  nature: schemaNatureProduit,
  quantite: z.int(),
  /** Prix de vente du composant HORS menu — c'est le poids par défaut du prorata. */
  prixCatalogueCents: z.int(),
  actif: z.boolean(),
  /**
   * Prix IMPOSÉ de ce composant dans CE menu, en centimes
   * (`menu_composition.prix_force_cents`, fiche 16 §2.2). `null` = ce
   * composant suit le prorata des prix catalogue — jamais `0`, qui
   * affirmerait « ce composant est offert dans ce menu », une décision bien
   * plus forte qu'une absence de réglage (même doctrine que
   * `depots/menus.ts::CompositionMenuLigne.prixForceCents`, `@batte/db`).
   */
  prixForceCents: z.int().nullable(),
});

export const schemaListeCompositionMenu = z.object({
  data: z.array(schemaCompositionMenu),
  meta: z.object({ total: z.int() }),
});

/** Saisie d'un composant de menu : quel produit, en quelle quantité. */
export const schemaSaisieCompositionMenu = z.object({
  produitInclusId: z.string().min(1, 'Choisissez le produit inclus dans ce menu.'),
  quantite: z
    .int('La quantité doit être un nombre entier.')
    .positive('La quantité doit être strictement positive.')
    .default(1),
  /**
   * Prix imposé de CE composant dans CE menu, en centimes (fiche 16 §2.2).
   * Absent ou `null` : ce composant suit le prorata des prix catalogue —
   * jamais `0`, qui affirmerait « ce composant est offert dans ce menu »,
   * une décision bien plus forte qu'une absence de réglage.
   *
   * `.exactOptional()`, PAS `.optional()` : sous `exactOptionalPropertyTypes`
   * (actif, `tsconfig.base.json`), `.optional()` typerait ce champ
   * `prixForceCents?: number | null | undefined` (le `| undefined` explicite
   * que Zod ajoute à toute clé optionnelle) — incompatible avec le type du
   * dépôt qui l'attend (`SaisieCompositionMenuAvecPrixForce.prixForceCents?:
   * number | null`, `packages/db/src/depots/menus.ts`, SANS `undefined`
   * explicite). `.exactOptional()` garde la clé omettable (une saisie qui ne
   * porte pas encore ce champ reste valide — le dépôt conserve alors la
   * valeur déjà en base) tout en excluant ce `| undefined` explicite du
   * type, et rejette une valeur `undefined` envoyée EXPLICITEMENT (à
   * distinguer d'une clé absente).
   */
  prixForceCents: z
    .int('Le prix imposé doit être un nombre entier de centimes.')
    .nonnegative('Le prix imposé doit être positif ou nul.')
    .nullable()
    .exactOptional(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Ventilation du prix — le cœur de la fiche 16 §2.2
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaVentilationComposantMenu = z.object({
  produitInclusId: z.string(),
  nom: z.string(),
  nature: schemaNatureProduit,
  quantite: z.int(),
  partPrixCents: z.int(),
  coutTotalCents: z.int().nullable(),
});

export const schemaParNatureCents = z.object({
  transforme: z.int(),
  revendu: z.int(),
});

export const schemaVentilationMenu = z.object({
  menuId: z.string(),
  nomMenu: z.string(),
  prixMenuCents: z.int(),
  composants: z.array(schemaVentilationComposantMenu),
  /** Ce qui alimente les compteurs de seuils légaux (CLAUDE.md §6) — toujours calculable. */
  parNatureCents: schemaParNatureCents,
  coutTotalCents: z.int().nullable(),
  margeMenuCents: z.int().nullable(),
  prixSepareTotalCents: z.int(),
  margeSepareeCents: z.int().nullable(),
  ecartMargeCents: z.int().nullable(),
});

/**
 * Simulation ÉPHÉMÈRE de la méthode « composant désigné » (fiche 16 §2.2) :
 * un prix imposé par produit inclus, reçu pour UN SEUL calcul, jamais
 * persisté — à ne pas confondre avec `schemaSaisieCompositionMenu.prixForceCents`
 * ci-dessus, qui LUI est enregistré avec le composant. Cette simulation ne
 * fait que SURCLASSER ponctuellement le réglage enregistré, composant par
 * composant, le temps d'un essai (voir `depots/menus.ts::calculerVentilationMenu`).
 * Absent ou vide : seuls les réglages enregistrés s'appliquent, prorata pur
 * si aucun n'est posé.
 */
export const schemaSimulationVentilationMenu = z.object({
  prixForcesCents: z.record(z.string(), z.int().nonnegative()).default({}),
});

export type MenuResume = z.infer<typeof schemaMenuResume>;
export type ListeMenus = z.infer<typeof schemaListeMenus>;
export type CompositionMenu = z.infer<typeof schemaCompositionMenu>;
export type ListeCompositionMenu = z.infer<typeof schemaListeCompositionMenu>;
export type SaisieCompositionMenu = z.infer<typeof schemaSaisieCompositionMenu>;
export type VentilationComposantMenuContrat = z.infer<typeof schemaVentilationComposantMenu>;
export type VentilationMenuContrat = z.infer<typeof schemaVentilationMenu>;
export type SimulationVentilationMenu = z.infer<typeof schemaSimulationVentilationMenu>;
