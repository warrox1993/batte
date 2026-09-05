/**
 * Dépôt des MENUS (fiche 16 §2) : un produit_vente qui en contient d'autres,
 * avec son propre prix. Table `menu_composition` (migration
 * `0021_icy_the_hunter.sql`), déjà appliquée.
 *
 * À NE PAS CONFONDRE avec `depots/nomenclature-vente.ts`, qui porte
 * `produit_vente_composant` (produit -> INGRÉDIENT, consommé à la vente). Ici
 * c'est produit -> PRODUIT : un menu ne consomme rien par lui-même, ce sont
 * ses composants qui sortent du stock, sont coûtés et ventilés — exactement
 * comme n'importe quel autre produit vendu.
 *
 * TROIS RÈGLES REPRISES DE `depots/nomenclature-vente.ts` et
 * `depots/referentiel-ecriture.ts`, pour la même raison :
 *  1. On DÉSACTIVE, on ne supprime jamais (CLAUDE.md §3 règle 7).
 *  2. La modification et sa trace d'audit sont dans la MÊME transaction.
 *  3. Une référence inconnue est un 422 avec `champs`, un menu adressé dans
 *     l'URL introuvable est un 404 (D-035).
 *
 * LE CALCUL NE VIT PAS ICI (règle d'architecture n°1) : ce dépôt assemble le
 * prix catalogue et le coût de revient de chaque composant — en réutilisant
 * `coutRevientProduit` de `depots/recettes.ts`, jamais recalculé — et délègue
 * la répartition du prix et la ventilation transformé/revendu à
 * `ventilerMenu` de `@batte/core`.
 *
 * AUDIT DU 30/07/2026 — `menu_composition.prix_force_cents` NI ÉCRITE NI LUE.
 * Ce dépôt écrit et lit désormais cette colonne (voir
 * `SaisieCompositionMenuAvecPrixForce`, `CompositionMenuLigne.prixForceCents`
 * et `calculerVentilationMenu` ci-dessous). CE QUI RESTE HORS DE CE FICHIER,
 * documenté ici pour ne pas se perdre : `schemaSaisieCompositionMenu` et
 * `schemaCompositionMenu` (`@batte/core`, `contrats/menus.ts`) ne portent pas
 * encore ce champ, donc `POST/PATCH …/composition` (routes/menus.ts) ne le
 * transmettent pas encore réellement depuis un écran. Une fois ces deux
 * schémas complétés (deux lignes chacun), routes et dépôt n'ont RIEN d'autre
 * à changer — voir le rapport de livraison de l'agent qui a câblé la lecture
 * et l'écriture au niveau dépôt.
 */

import {
  ErreurIntrouvable,
  ErreurMetier,
  maintenantUtc,
  nouvelIdentifiant,
  ventilerMenu,
  type ComposantMenuCalcul,
  type NatureProduit,
  type NatureProduitVente,
  type SaisieCompositionMenu,
  type VentilationMenu,
} from '@batte/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { menuComposition, produitVente } from '../schema.js';
import { journaliser } from './audit.js';
import { coutRevientProduit } from './recettes.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Lecture
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Un menu résumé : le produit-conteneur, avec le nombre de composants ACTIFS.
 *
 * `nature` porte le type COMPLET (`NatureProduitVente`, menu compris) et non
 * `NatureProduit` (deux valeurs, `@batte/core`) : le conteneur lui-même est un
 * `produit_vente` ordinaire, qui peut désormais légitimement porter
 * `nature: 'menu'` (fiche 16 §2, migration 0023) — mais peut tout aussi bien
 * rester `transforme` ou `revendu`, comme avant cette migration : « être un
 * menu » se définit par la présence de composants (`menu_composition`), pas
 * par cette colonne, voir `listerMenus` ci-dessous.
 */
export type MenuLigne = {
  readonly id: string;
  readonly nom: string;
  readonly nature: NatureProduitVente;
  readonly prixCents: number;
  readonly actif: boolean;
  readonly nbComposantsActifs: number;
};

/**
 * Tous les produits qui ont AU MOINS une ligne dans `menu_composition` en
 * tant que `menuId` — c'est ce qui définit « être un menu » : la colonne
 * `nature` peut valoir `'menu'` depuis la migration 0023, mais un conteneur
 * PEUT AUSSI rester `transforme` ou `revendu` (compatibilité avec les menus
 * déclarés avant cette migration) — la présence de composants reste le seul
 * signal fiable ici.
 */
export function listerMenus(base: BaseBatte): MenuLigne[] {
  const lignes = base
    .select({ menuId: menuComposition.menuId, actifComposant: menuComposition.actif })
    .from(menuComposition)
    .all();

  const nbActifsParMenu = new Map<string, number>();
  const idsMenus = new Set<string>();
  for (const ligne of lignes) {
    idsMenus.add(ligne.menuId);
    if (ligne.actifComposant) {
      nbActifsParMenu.set(ligne.menuId, (nbActifsParMenu.get(ligne.menuId) ?? 0) + 1);
    }
  }
  if (idsMenus.size === 0) return [];

  return base
    .select()
    .from(produitVente)
    .where(inArray(produitVente.id, [...idsMenus]))
    .orderBy(asc(produitVente.nom))
    .all()
    .map((produit) => ({
      id: produit.id,
      nom: produit.nom,
      nature: produit.nature,
      prixCents: produit.prixCents,
      actif: produit.actif,
      nbComposantsActifs: nbActifsParMenu.get(produit.id) ?? 0,
    }));
}

/** Un composant de menu, tel que servi à l'écran : enrichi du nom et du prix catalogue du produit inclus. */
export type CompositionMenuLigne = {
  readonly id: string;
  readonly menuId: string;
  readonly produitInclusId: string;
  readonly nomProduitInclus: string;
  readonly nature: NatureProduit;
  readonly quantite: number;
  readonly prixCatalogueCents: number;
  /** `0` pour un revendu — même convention que `coutRevientProduit`. */
  readonly nbCrepesParUnite: number;
  /**
   * Prix IMPOSÉ de ce composant dans CE menu, en centimes
   * (`menu_composition.prix_force_cents`, fiche 16 §2.2). `null` = ce
   * composant suit le prorata — jamais `0`, qui affirmerait « ce composant
   * est offert dans ce menu », une décision bien plus forte qu'une absence
   * de réglage.
   */
  readonly prixForceCents: number | null;
  readonly actif: boolean;
};

function versCompositionLigne(l: {
  ligne: typeof menuComposition.$inferSelect;
  produit: typeof produitVente.$inferSelect;
}): CompositionMenuLigne {
  // Invariant maintenu À L'ÉCRITURE par `verifierPasMenuImbrique` : un
  // composant de menu n'est jamais lui-même un menu. La colonne
  // `produit_vente.nature` reste à TROIS valeurs (elle porte aussi les
  // conteneurs, voir `MenuLigne` ci-dessus) ; ce garde-fou ramène la LECTURE
  // aux deux natures vendues, jamais par un cast — et transforme en erreur
  // explicite le seul cas où l'invariant serait violé après coup (le produit
  // composant a été repassé en `nature: 'menu'` après avoir été inclus).
  if (l.produit.nature === 'menu') {
    throw new ErreurMetier(
      'composant_menu_devenu_menu',
      `Le composant « ${l.produit.nom} » est devenu lui-même un menu après avoir été inclus : ` +
        'ce menu ne peut plus être ventilé. Retirez ce composant ou reclassez-le.',
    );
  }
  return {
    id: l.ligne.id,
    menuId: l.ligne.menuId,
    produitInclusId: l.ligne.produitInclusId,
    nomProduitInclus: l.produit.nom,
    nature: l.produit.nature,
    quantite: l.ligne.quantite,
    prixCatalogueCents: l.produit.prixCents,
    nbCrepesParUnite: l.produit.nature === 'revendu' ? 0 : (l.produit.nbCrepes ?? 1),
    prixForceCents: l.ligne.prixForceCents,
    actif: l.ligne.actif,
  };
}

/**
 * Composants d'UN menu, ACTIFS ET INACTIFS, pour l'écran de déclaration — même
 * convention que `listerComposantsDuProduit` : un composant désactivé reste
 * visible, avec son geste de réactivation.
 */
export function listerCompositionMenu(base: BaseBatte, menuId: string): CompositionMenuLigne[] {
  return base
    .select({ ligne: menuComposition, produit: produitVente })
    .from(menuComposition)
    .innerJoin(produitVente, eq(menuComposition.produitInclusId, produitVente.id))
    .where(eq(menuComposition.menuId, menuId))
    .orderBy(asc(produitVente.nom))
    .all()
    .map(versCompositionLigne);
}

/** Un composant de menu précis, ou `null` s'il n'existe pas (ou plus). */
export function lireCompositionMenu(base: BaseBatte, id: string): CompositionMenuLigne | null {
  const ligne = base
    .select({ ligne: menuComposition, produit: produitVente })
    .from(menuComposition)
    .innerJoin(produitVente, eq(menuComposition.produitInclusId, produitVente.id))
    .where(eq(menuComposition.id, id))
    .get();

  return ligne === undefined ? null : versCompositionLigne(ligne);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Écriture
   ═══════════════════════════════════════════════════════════════════════════ */

function verifierMenuExiste(base: BaseBatte, menuId: string): void {
  const existe = base
    .select({ id: produitVente.id })
    .from(produitVente)
    .where(eq(produitVente.id, menuId))
    .get();
  if (existe === undefined) throw new ErreurIntrouvable('Menu', menuId);
}

function verifierProduitInclusExiste(base: BaseBatte, produitInclusId: string): void {
  const existe = base
    .select({ id: produitVente.id })
    .from(produitVente)
    .where(eq(produitVente.id, produitInclusId))
    .get();
  if (existe === undefined) {
    throw new ErreurMetier(
      'produit_inclus_introuvable',
      "Le produit à inclure dans ce menu n'existe plus.",
      {
        champs: { produitInclusId: 'Choisissez un produit existant.' },
      },
    );
  }
}

/** Un menu ne peut pas se contenir lui-même : la ventilation tournerait indéfiniment. */
function verifierPasAutoReference(menuId: string, produitInclusId: string): void {
  if (produitInclusId === menuId) {
    throw new ErreurMetier('menu_auto_reference', 'Un menu ne peut pas se contenir lui-même.', {
      champs: { produitInclusId: 'Choisissez un autre produit que le menu lui-même.' },
    });
  }
}

/**
 * Un menu ne peut pas inclure un AUTRE menu : `ventilerMenu` ne sait explorer
 * qu'un niveau de composition, et un menu imbriqué rendrait le coût et la
 * ventilation par nature silencieusement incomplets (le composant « menu »
 * n'a ni recette ni article propre à coûter).
 */
function verifierPasMenuImbrique(base: BaseBatte, produitInclusId: string): void {
  const estDejaUnMenu = base
    .select({ id: menuComposition.id })
    .from(menuComposition)
    .where(eq(menuComposition.menuId, produitInclusId))
    .limit(1)
    .get();
  if (estDejaUnMenu !== undefined) {
    throw new ErreurMetier(
      'menu_imbrique_interdit',
      'Un menu ne peut pas inclure un autre menu : choisissez un produit simple.',
      { champs: { produitInclusId: 'Ce produit est déjà lui-même un menu.' } },
    );
  }
}

/**
 * Empêche la nidification dans l'AUTRE sens : un produit déjà composant d'un
 * AUTRE menu ne peut pas lui-même devenir un menu-conteneur. Sans ce garde-fou
 * symétrique de `verifierPasMenuImbrique`, l'imbrication resterait possible en
 * construisant d'abord « Z contient X », puis « X contient Y » — même défaut,
 * juste construit dans l'ordre inverse.
 */
function verifierPasDejaComposantDunAutreMenu(base: BaseBatte, menuId: string): void {
  const dejaComposant = base
    .select({ id: menuComposition.id })
    .from(menuComposition)
    .where(eq(menuComposition.produitInclusId, menuId))
    .limit(1)
    .get();
  if (dejaComposant !== undefined) {
    throw new ErreurMetier(
      'menu_imbrique_interdit',
      'Ce produit est déjà un composant d’un autre menu : il ne peut pas devenir lui-même un menu.',
    );
  }
}

/** L'index unique `(menu_id, produit_inclus_id)` interdit un doublon : mieux vaut un 422 clair qu'une contrainte SQLite brute. */
function ligneExistante(
  base: BaseBatte,
  menuId: string,
  produitInclusId: string,
): { id: string } | undefined {
  return base
    .select({ id: menuComposition.id })
    .from(menuComposition)
    .where(
      and(eq(menuComposition.menuId, menuId), eq(menuComposition.produitInclusId, produitInclusId)),
    )
    .get();
}

/**
 * Élargit la saisie standard d'un composant avec son prix imposé
 * (fiche 16 §2.2). `SaisieCompositionMenu` (contrat HTTP, `@batte/core`,
 * `contrats/menus.ts`) ne porte pas encore ce champ — voir l'en-tête de ce
 * fichier : le contrat doit encore être complété pour qu'un écran l'envoie
 * réellement. Ce type élargit la saisie ICI, au niveau du dépôt, pour que la
 * persistance existe dès aujourd'hui, prête à être appelée dès que le contrat
 * suivra.
 *
 * `undefined` = le formulaire n'a rien dit sur ce point → la valeur déjà en
 * base survit (même doctrine que `noteTechnique` et `allergenesVerifies`,
 * `depots/referentiel-ecriture.ts`) ; `null` = « aucun prix imposé, ce
 * composant suit le prorata » ; un montant = prix imposé, en centimes.
 */
export type SaisieCompositionMenuAvecPrixForce = SaisieCompositionMenu & {
  readonly prixForceCents?: number | null;
};

/**
 * Le prix imposé, quand il est fourni, doit être un entier de centimes
 * positif ou nul — `0` est un composant OFFERT dans ce menu, une valeur
 * légitime, jamais une absence de réglage (voir `CompositionMenuLigne`).
 */
function verifierPrixForceValide(prixForceCents: number | null | undefined): void {
  if (prixForceCents === null || prixForceCents === undefined) return;
  if (!Number.isInteger(prixForceCents) || prixForceCents < 0) {
    throw new ErreurMetier(
      'prix_force_invalide',
      'Le prix imposé doit être un nombre entier de centimes, positif ou nul.',
      { champs: { prixForceCents: 'Indiquez un montant entier de centimes, positif ou nul.' } },
    );
  }
}

/**
 * Déclare un composant sur un menu. 404 si le menu adressé dans l'URL
 * n'existe pas ; 422 + `champs` si le produit inclus n'existe pas, se
 * référence lui-même, est déjà lui-même un menu, ou est déjà un composant de
 * ce menu (modifiez la ligne existante plutôt que d'en recréer une).
 */
export function creerCompositionMenu(
  base: BaseBatte,
  menuId: string,
  saisie: SaisieCompositionMenuAvecPrixForce,
  parQui?: string,
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    verifierMenuExiste(baseTx, menuId);
    verifierProduitInclusExiste(baseTx, saisie.produitInclusId);
    verifierPasAutoReference(menuId, saisie.produitInclusId);
    verifierPasDejaComposantDunAutreMenu(baseTx, menuId);
    verifierPasMenuImbrique(baseTx, saisie.produitInclusId);
    verifierPrixForceValide(saisie.prixForceCents);

    if (ligneExistante(baseTx, menuId, saisie.produitInclusId) !== undefined) {
      throw new ErreurMetier(
        'composant_menu_deja_present',
        'Ce produit est déjà un composant de ce menu : modifiez la ligne existante plutôt que d’en créer une autre.',
        { champs: { produitInclusId: 'Ce produit figure déjà dans ce menu.' } },
      );
    }

    const cree = baseTx
      .insert(menuComposition)
      .values({
        id,
        menuId,
        produitInclusId: saisie.produitInclusId,
        quantite: saisie.quantite,
        // Absent du formulaire aujourd'hui (voir le type ci-dessus) = pas
        // encore désigné, exactement le défaut de la colonne elle-même.
        prixForceCents: saisie.prixForceCents ?? null,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'menu_composition',
      enregistrementId: id,
      action: 'creation',
      valeurApres: cree,
      parQui: parQui ?? null,
    });

    return id;
  });
}

/** Corrige un composant de menu : la quantité ou le produit rattaché était faux. */
export function modifierCompositionMenu(
  base: BaseBatte,
  id: string,
  saisie: SaisieCompositionMenuAvecPrixForce,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(menuComposition).where(eq(menuComposition.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Composant de menu', id);

    verifierProduitInclusExiste(baseTx, saisie.produitInclusId);
    verifierPasAutoReference(avant.menuId, saisie.produitInclusId);
    verifierPasMenuImbrique(baseTx, saisie.produitInclusId);
    verifierPrixForceValide(saisie.prixForceCents);

    const collision = ligneExistante(baseTx, avant.menuId, saisie.produitInclusId);
    if (collision !== undefined && collision.id !== id) {
      throw new ErreurMetier(
        'composant_menu_deja_present',
        'Ce produit est déjà un composant de ce menu : modifiez la ligne existante plutôt que d’en créer une autre.',
        { champs: { produitInclusId: 'Ce produit figure déjà dans ce menu.' } },
      );
    }

    const apres = baseTx
      .update(menuComposition)
      .set({
        produitInclusId: saisie.produitInclusId,
        quantite: saisie.quantite,
        // `undefined` = le formulaire ne porte pas encore ce champ → le prix
        // imposé déjà en base SURVIT (même doctrine que `noteTechnique`,
        // `depots/referentiel-ecriture.ts`) ; `null` explicite l'efface, un
        // montant explicite le change.
        prixForceCents:
          saisie.prixForceCents === undefined ? avant.prixForceCents : saisie.prixForceCents,
        modifieLe: maintenantUtc(),
      })
      .where(eq(menuComposition.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'menu_composition',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/** Active ou désactive un composant de menu. Le remplaçant de la suppression (CLAUDE.md §3 règle 7). */
export function changerActiviteCompositionMenu(
  base: BaseBatte,
  id: string,
  actif: boolean,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(menuComposition).where(eq(menuComposition.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Composant de menu', id);

    const apres = baseTx
      .update(menuComposition)
      .set({ actif, modifieLe: maintenantUtc() })
      .where(eq(menuComposition.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'menu_composition',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ventilation — le cœur de la fiche 16 §2.2
   ═══════════════════════════════════════════════════════════════════════════ */

export type VentilationMenuLigne = VentilationMenu & {
  readonly menuId: string;
  readonly nomMenu: string;
  readonly prixMenuCents: number;
};

/**
 * Calcule la ventilation du prix d'UN menu entre ses composants ACTIFS :
 * prix par nature (ce qui alimente les compteurs de seuils légaux), coût de
 * revient total, marge du menu et marge de référence si les composants
 * avaient été vendus séparément.
 *
 * DEUX SOURCES pour le prix imposé d'un composant (fiche 16 §2.2). Le
 * réglage PERSISTÉ (`menu_composition.prix_force_cents`, lu ici via
 * `listerCompositionMenu`) s'applique par défaut. `prixForcesCents` — un
 * réglage ÉPHÉMÈRE, PAR PRODUIT INCLUS (clé = `produitInclusId`), reçu du
 * DEMANDEUR pour UNE simulation ponctuelle — le SURCLASSE composant par
 * composant quand l'appelant fournit une valeur pour ce composant précis :
 * sans cette priorité, un réglage déjà décidé et persisté devrait être
 * ressaisi à chaque calcul, exactement le défaut que ce câblage corrige. Vide
 * ou omis : les valeurs persistées s'appliquent seules, prorata pur si aucune
 * n'est posée.
 *
 * `creerCompositionMenu`/`modifierCompositionMenu` savent déjà écrire ce
 * réglage persisté (voir `SaisieCompositionMenuAvecPrixForce`) — mais aucun
 * écran ne l'envoie encore réellement tant que `schemaSaisieCompositionMenu`
 * (`@batte/core`, `contrats/menus.ts`) ne porte pas ce champ (voir l'en-tête
 * de ce fichier et le rapport de livraison).
 *
 * 404 si le menu n'existe pas ; 422 si le menu n'a encore aucun composant
 * actif déclaré — rien à ventiler.
 */
export function calculerVentilationMenu(
  base: BaseBatte,
  menuId: string,
  prixForcesCents: ReadonlyMap<string, number> = new Map(),
): VentilationMenuLigne {
  const menu = base.select().from(produitVente).where(eq(produitVente.id, menuId)).get();
  if (menu === undefined) throw new ErreurIntrouvable('Menu', menuId);

  const compositionActive = listerCompositionMenu(base, menuId).filter((ligne) => ligne.actif);
  if (compositionActive.length === 0) {
    throw new ErreurMetier(
      'menu_sans_composant_actif',
      'Ce menu ne contient encore aucun composant actif : déclarez au moins un composant avant de calculer sa ventilation.',
    );
  }

  const composants: ComposantMenuCalcul[] = compositionActive.map((ligne) => {
    const forcePonctuel = prixForcesCents.get(ligne.produitInclusId);
    return {
      produitInclusId: ligne.produitInclusId,
      nom: ligne.nomProduitInclus,
      nature: ligne.nature,
      quantite: ligne.quantite,
      prixCatalogueCents: ligne.prixCatalogueCents,
      coutMatiereCents: coutRevientProduit(base, ligne.produitInclusId)?.coutMatiereCents ?? null,
      nbCrepesParUnite: ligne.nbCrepesParUnite,
      // La simulation éphémère surclasse le réglage persisté UNIQUEMENT
      // quand elle porte une valeur pour CE composant (`!== undefined`) —
      // sinon le réglage déjà décidé et sauvegardé continue de s'appliquer.
      prixForceCents: forcePonctuel !== undefined ? forcePonctuel : ligne.prixForceCents,
    };
  });

  // Le nom du menu n'entre dans AUCUN calcul : il ne sert qu'au message d'erreur
  // levé quand les prix désignés sont incohérents avec le prix du menu. Sans lui,
  // le porteur lit « la somme des prix imposés dépasse le prix du menu » sans
  // savoir DE QUEL menu il s'agit — et il peut en avoir plusieurs.
  const ventilation = ventilerMenu(menu.prixCents, composants, { nomMenu: menu.nom });

  return { ...ventilation, menuId: menu.id, nomMenu: menu.nom, prixMenuCents: menu.prixCents };
}
