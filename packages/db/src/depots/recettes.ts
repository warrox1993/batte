/**
 * Depot des recettes : lecture seule pour le Lot 1.
 *
 * Le depot assemble les donnees, il ne calcule RIEN (regle d'architecture n°1).
 * Toute mise a l'echelle et tout cout passent par `mettreAEchelle` de
 * `@batte/core`, en fonctions pures et testees.
 */

import {
  agregerAllergenes,
  coutProduitVendu,
  coutsComposantsVente,
  estPateVendueAuVolume,
  mettreAEchelle,
  ratioEnPointsDeBase,
  type ComposantVenteEntree,
  type CoutProduitVenduContrat,
  type GarnitureCalcul,
  type RecetteCalcul,
  type RecetteResume,
} from '@batte/core';
import { and, asc, eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  conditionnement,
  ingredient,
  produitGarniture,
  produitVente,
  produitVenteComposant,
  recette,
  recetteLigne,
} from '../schema.js';
import { composantsActifsDesProduits } from './nomenclature-vente.js';

/**
 * Cout unitaire de reference d'un ingredient, en centimes par unite.
 *
 * Au Lot 1 il n'existe pas encore de lot de stock, donc pas de CUMP reel : on
 * prend le prix du conditionnement actif le plus recent, soit
 * `prix_cents / quantite_unite_ref` — jamais un prix unitaire stocke, qui
 * pourrait diverger de ces deux valeurs (invariant de docs/02).
 *
 * Au Lot 2, le CUMP calcule sur les lots remplacera cette source (D-018).
 *
 * Le dictionnaire rendu ne contient QUE les ingredients qui ont un prix connu :
 * un ingredient sans conditionnement actif en est absent, volontairement. Tout
 * appelant doit donc lire `couts.get(id) ?? null`, JAMAIS `?? 0` — c'est
 * exactement ce dernier repli qui comptait un ingredient sans prix comme
 * gratuit (audit 29/07/2026, defaut n°1 : la creation rapide d'ingredient
 * depuis l'ecran Recettes assigne l'ingredient a la ligne AVANT tout
 * conditionnement, fiche 09).
 */
function coutsDeReference(base: BaseBatte): Map<string, number> {
  const lignes = base
    .select({
      ingredientId: conditionnement.ingredientId,
      prixCents: conditionnement.prixCents,
      quantite: conditionnement.quantiteUniteRef,
      datePrix: conditionnement.datePrix,
    })
    .from(conditionnement)
    .where(eq(conditionnement.actif, true))
    .orderBy(asc(conditionnement.datePrix))
    .all();

  const couts = new Map<string, number>();
  for (const ligne of lignes) {
    if (ligne.quantite <= 0) continue;
    // Tri ascendant : la derniere ligne vue pour un ingredient est la plus recente.
    couts.set(ligne.ingredientId, ligne.prixCents / ligne.quantite);
  }
  return couts;
}

/** Assemble la forme attendue par `mettreAEchelle`, ou `null` si la recette n'existe pas. */
export function chargerRecettePourCalcul(base: BaseBatte, id: string): RecetteCalcul | null {
  const entete = base.select().from(recette).where(eq(recette.id, id)).get();
  if (entete === undefined) return null;

  const couts = coutsDeReference(base);

  const lignes = base
    .select({ ligne: recetteLigne, ingredient })
    .from(recetteLigne)
    .innerJoin(ingredient, eq(recetteLigne.ingredientId, ingredient.id))
    .where(eq(recetteLigne.recetteId, id))
    .orderBy(asc(recetteLigne.ordre))
    .all();

  return {
    id: entete.id,
    code: entete.code,
    rendementReferenceMl: entete.rendementReferenceMl,
    rendementReferenceCrepes: entete.rendementReferenceCrepes,
    perteCuissonBp: entete.perteCuissonBp,
    tauxCasseBp: entete.tauxCasseBp,
    lignes: lignes.map((l) => ({
      ingredientId: l.ingredient.id,
      nomIngredient: l.ingredient.nom,
      unite: l.ingredient.uniteReference,
      quantiteReference: l.ligne.quantiteUniteRef,
      // `?? null`, jamais `?? 0` : un ingredient sans conditionnement actif a
      // un prix INCONNU, pas gratuit (audit 29/07/2026, defaut n°1).
      cumpCentsParUnite: couts.get(l.ingredient.id) ?? null,
      allergenes: l.ingredient.allergenes,
    })),
  };
}

/** Detail complet d'une recette, pour l'ecran. `null` si elle n'existe pas. */
export function lireRecetteDetail(base: BaseBatte, id: string) {
  const entete = base.select().from(recette).where(eq(recette.id, id)).get();
  if (entete === undefined) return null;

  const pourCalcul = chargerRecettePourCalcul(base, id);
  if (pourCalcul === null) return null;

  const lignes = base
    .select({ ligne: recetteLigne, ingredient })
    .from(recetteLigne)
    .innerJoin(ingredient, eq(recetteLigne.ingredientId, ingredient.id))
    .where(eq(recetteLigne.recetteId, id))
    .orderBy(asc(recetteLigne.ordre))
    .all();

  const couts = coutsDeReference(base);

  return {
    id: entete.id,
    code: entete.code,
    nom: entete.nom,
    version: entete.version,
    statut: entete.statut,
    sansGluten: entete.sansGluten,
    rendementReferenceMl: entete.rendementReferenceMl,
    rendementReferenceCrepes: entete.rendementReferenceCrepes,
    nbLignes: lignes.length,
    coutParCrepeCents: coutParCrepe(pourCalcul),
    typePate: entete.typePate,
    perteCuissonBp: entete.perteCuissonBp,
    tauxCasseBp: entete.tauxCasseBp,
    perteFixeMl: entete.perteFixeMl,
    procede: entete.procede,
    notes: entete.notes,
    dateActivation: entete.dateActivation,
    lignes: lignes.map((l, index) => ({
      ingredientId: l.ingredient.id,
      nomIngredient: l.ingredient.nom,
      unite: l.ingredient.uniteReference,
      quantiteReference: l.ligne.quantiteUniteRef,
      // `?? null`, jamais `?? 0` : un ingredient sans conditionnement actif a
      // un prix INCONNU, pas gratuit (audit 29/07/2026, defaut n°1).
      cumpCentsParUnite: couts.get(l.ingredient.id) ?? null,
      allergenes: l.ingredient.allergenes,
      ordre: l.ligne.ordre === 0 ? index : l.ligne.ordre,
      // Note du GESTE (« beurre noisette, ne pas dépasser la coloration »),
      // PAS un allergène (CLAUDE.md §7) : `recette_ligne.note_technique`
      // était écrite mais jamais relue par aucun contrat de lecture (audit
      // du 30/07/2026) — c'est ici que `GET /recettes/:id` (et donc la fiche
      // technique imprimée, `apps/api/src/documents/donnees.ts`) va la lire.
      noteTechnique: l.ligne.noteTechnique,
    })),
  };
}

/**
 * Cout par crepe au rendement de reference, ou `null` si la recette est vide.
 *
 * `null` et non zero : une recette sans ingredient n'a pas un cout de 0 €, elle
 * n'a pas de cout du tout. Afficher « 0,00 € » serait un chiffre faux presente
 * comme une donnee.
 */
function coutParCrepe(pourCalcul: RecetteCalcul): number | null {
  if (pourCalcul.lignes.length === 0) return null;
  try {
    return mettreAEchelle(pourCalcul, {
      type: 'volume',
      volumeMl: pourCalcul.rendementReferenceMl,
    }).coutParCrepeCents;
  } catch {
    // Recette au rendement invalide ou aux pertes absurdes : pas de cout
    // affichable. L'ecran de detail montrera l'erreur precise a l'ouverture.
    return null;
  }
}

/**
 * Cout matiere de la recette PAR ML, au TAUX exact (non arrondi) — le pendant
 * de `coutParCrepe` ci-dessus pour un produit vendu au VOLUME plutot qu'a la
 * crepe (D-085, `consommationUnite: 'volume_pate'`, fiche 15 §5.1).
 *
 * MEME METHODE THEORIQUE que `coutParCrepe` : la mise a l'echelle porte sur
 * la recette a son prix COURANT (CUMP), jamais sur une production reelle
 * passee — c'est deliberer, et c'est deja la regle en vigueur pour tout le
 * cout catalogue rendu par `coutRevientProduit` (voir son commentaire de
 * tete : « panier catalogue... theorique... distinct du panier REEL de la
 * cloture de session »). Le cout REEL, lui, existe deja ailleurs :
 * `repartirCoutProductionEntrePateVendueEtCrepes` (`packages/core/src/sessions.ts`)
 * le calcule au moment de la CLOTURE d'une session precise, a partir du cout
 * REELLEMENT paye par LA production qui y est rattachee. Un produit de
 * catalogue, lui, n'est rattache a AUCUNE production en particulier : rien
 * ne dit s'il faudrait prendre la derniere, une moyenne, ou une autre —
 * choisir inventerait une reponse a une question qui ne se pose pas a ce
 * niveau. La mise a l'echelle sur la recette resout la question sans
 * inventer : c'est EXACTEMENT la meme donnee (et la meme methode) que celle
 * deja utilisee pour `coutParCrepeCents` juste au-dessus.
 *
 * Mise a l'echelle SUR LE VOLUME REEL DE L'UNITE VENDUE (`volumeMl`, la
 * contenance de LA bouteille), pas sur le rendement de reference de la
 * recette : chaque ligne d'ingredient est ainsi arrondie a l'echelle
 * REELLEMENT vendue, ce qui est plus juste qu'une extrapolation depuis un lot
 * de reference d'une autre taille.
 *
 * DELIBEREMENT NON ARRONDI ici : c'est un TAUX (centimes par ml), pas un
 * montant — `coutProduitVendu` (`@batte/core`, packages/core/src/recettes.ts,
 * NON modifie par cette mission) fait l'UNIQUE arrondi, en multipliant ce
 * taux EXACT par `volumeMlParUnite`. Un taux arrondi ICI AVANT cette
 * multiplication ferait disparaitre une pate a tres faible cout au ml,
 * exactement le piege de la cannelle (fiche 15 §4.1) et de la farine
 * (doctrine de `mettreAEchelle`).
 *
 * `null` si la recette est vide ou son rendement inexploitable, ou si
 * `volumeMl` n'est pas exploitable (`<= 0`, ou absent cote appelant) : un
 * cout INCONNU, jamais un cout a zero (CLAUDE.md §7, D-018).
 */
function coutParMl(pourCalcul: RecetteCalcul, volumeMl: number): number | null {
  if (pourCalcul.lignes.length === 0 || volumeMl <= 0) return null;
  try {
    const { coutMatiereCents } = mettreAEchelle(pourCalcul, { type: 'volume', volumeMl });
    return coutMatiereCents === null ? null : coutMatiereCents / volumeMl;
  } catch {
    // Recette au rendement invalide ou aux pertes absurdes : pas de cout
    // affichable, meme garde-fou que `coutParCrepe`.
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Garnitures et cout de revient d'un produit vendu

   La table `produit_garniture` existait au schema depuis le Lot 1 et n'etait ni
   ecrite ni lue. Consequence mesuree sur la demonstration : 0,2567 €/crepe la ou
   CLAUDE.md §6 annonce 0,33 €, soit 22 % de cout matiere invisible — et surtout
   deux produits vendus 3,00 € et 3,50 € qui affichaient le MEME cout de revient.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Garnitures d'un produit, enrichies du cout courant de leur ingredient.
 *
 * Une liste VIDE est un cas normal : la crepe nature existe. La garniture est
 * donc FACULTATIVE, et c'est un choix de modele, pas un oubli — l'exiger
 * interdirait de saisir la moitie d'une carte, et la seule contrainte que le
 * schema pose est l'unicite du couple (produit, ingredient), pas sa presence.
 */
export function garnituresDuProduit(base: BaseBatte, produitVenteId: string): GarnitureCalcul[] {
  const couts = coutsDeReference(base);

  return base
    .select({ garniture: produitGarniture, ingredient })
    .from(produitGarniture)
    .innerJoin(ingredient, eq(produitGarniture.ingredientId, ingredient.id))
    .where(eq(produitGarniture.produitVenteId, produitVenteId))
    .orderBy(asc(ingredient.nom))
    .all()
    .map((l) => ({
      ingredientId: l.ingredient.id,
      nomIngredient: l.ingredient.nom,
      unite: l.ingredient.uniteReference,
      quantiteParUnite: l.garniture.quantiteUniteRef,
      // `?? null`, jamais `?? 0` : un ingredient sans conditionnement actif a
      // un prix INCONNU, pas gratuit (audit 29/07/2026, defaut n°1).
      cumpCentsParUnite: couts.get(l.ingredient.id) ?? null,
      allergenes: l.ingredient.allergenes,
    }));
}

/**
 * Toutes les garnitures de plusieurs produits, en UNE lecture par produit.
 *
 * Sert la cloture de session : elle a besoin des garnitures des produits vendus
 * ce jour-la, pas de tout le catalogue.
 */
export function garnituresDesProduits(
  base: BaseBatte,
  produitVenteIds: readonly string[],
): Map<string, GarnitureCalcul[]> {
  const parProduit = new Map<string, GarnitureCalcul[]>();
  for (const id of new Set(produitVenteIds)) {
    parProduit.set(id, garnituresDuProduit(base, id));
  }
  return parProduit;
}

/**
 * Composants de nomenclature de vente ACTIFS d'un produit, prets pour la
 * fonction pure `coutsComposantsVente` (`@batte/core`) : ce depot ASSEMBLE
 * les donnees, il ne calcule rien (regle d'architecture n°1) — l'arithmetique
 * (division par le lot de reference, somme, arrondi unique) vit entierement
 * dans `coutsComposantsVente`.
 *
 * Requete DEDIEE, distincte de `composantsActifsDesProduits`
 * (`depots/nomenclature-vente.ts`) — mais plus pour la raison qui justifiait
 * initialement cette duplication. `composantsActifsDesProduits` repliait un
 * prix inconnu sur `0` (`?? 0`) : un mensonge sans consequence tant qu'aucun
 * de ses appelants (allergenes ici-meme, longueur seule cote cloture de
 * session) ne lisait ce champ pour de l'argent, mais un mensonge quand meme,
 * corrige depuis (audit du 01/08/2026 — ce champ est desormais `?? null`
 * partout, y compris la-bas).
 *
 * La VRAIE raison qui reste : la FORME differe, pas seulement le prix. Cette
 * requete-ci rend `optionnel` par ligne — indispensable a `coutsComposantsVente`
 * pour exclure une option du total (fiche 15) — un champ que
 * `ComposantVenteCalcul` (le type partage de `@batte/core`, rendu par
 * `composantsActifsDesProduits`) ne porte pas, puisque ses autres appelants
 * (cumul de sortie de stock, comptage) n'en ont jamais eu besoin. Elle est
 * aussi appelee produit par produit, la ou l'autre repond en lot pour
 * plusieurs produits a la fois (cloture de session). Fusionner les deux
 * demanderait d'ajouter `optionnel` au type partage et de faire porter cette
 * information a tous ses autres consommateurs — un changement de plus grande
 * portee que ce que corrige cette mission, pour un gain nul aujourd'hui : les
 * deux requetes rendent desormais le MEME prix pour le MEME ingredient, sur
 * les MEMES lignes actives, elles different seulement par la forme utile a
 * chaque appelant.
 */
function composantsVenteEntreeDuProduit(
  base: BaseBatte,
  produitVenteId: string,
): ComposantVenteEntree[] {
  const couts = coutsDeReference(base);

  return base
    .select({ composant: produitVenteComposant, ingredient })
    .from(produitVenteComposant)
    .innerJoin(ingredient, eq(produitVenteComposant.ingredientId, ingredient.id))
    .where(
      and(
        eq(produitVenteComposant.produitVenteId, produitVenteId),
        eq(produitVenteComposant.actif, true),
      ),
    )
    .orderBy(asc(ingredient.nom))
    .all()
    .map((l) => ({
      ingredientId: l.ingredient.id,
      nomIngredient: l.ingredient.nom,
      unite: l.ingredient.uniteReference,
      quantiteUniteRef: l.composant.quantiteUniteRef,
      quantiteReferenceUnites: l.composant.quantiteReferenceUnites,
      // `?? null`, jamais `?? 0` : un ingredient sans conditionnement actif a
      // un prix INCONNU, pas gratuit (audit 29/07/2026, defaut n°1 ; D-018).
      cumpCentsParUnite: couts.get(l.ingredient.id) ?? null,
      allergenes: l.ingredient.allergenes,
      optionnel: l.composant.optionnel,
      consommationSurPlace: l.composant.consommationSurPlace,
    }));
}

/**
 * Cout de revient d'un produit vendu : part de pate + garnitures + composants
 * de nomenclature de vente, ou prix d'achat + garnitures + composants pour un
 * revendu. `null` si le produit n'existe pas.
 *
 * Le cout de la pate n'est PAS recalcule depuis les lignes de recette : il vient
 * de `coutParCrepe`, qui a deja reparti la fournee sur les crepes vendables. Le
 * re-sommer ici compterait la pate deux fois.
 *
 * COMPOSANTS DE NOMENCLATURE DE VENTE (fiche 15, `produit_vente_composant`) —
 * TROU CORRIGE le 01/08/2026. Ils n'entraient jusqu'ici que dans les
 * ALLERGENES, jamais dans `coutMatiereCents` : un produit ENTIEREMENT fait de
 * composants de vente (le cafe, `consommationUnite: 'nomenclature'`, D-085)
 * n'avait donc JAMAIS de cout matiere chiffrable, meme quand tous ses
 * ingredients avaient un prix connu — la marge de l'ecran Produits et le
 * classement du palmares affichaient un tiret honnete, mais sur toute une
 * famille de produits, pas seulement sur un cas limite. Les deux arbitrages
 * (composant optionnel exclu, mode de consommation filtre) et l'arrondi
 * unique sur le total sont documentes sur `coutsComposantsVente`
 * (`packages/core/src/contrats/recettes.ts`), qui fait le calcul — ce depot
 * ne fait qu'assembler les lignes.
 *
 * Ce panier catalogue reste DISTINCT du panier REEL de la cloture de session
 * (`coutComposantsVenteCents`, `services/sessions.ts`, qui sort du stock au
 * FEFO sur les ventes reellement encaissees) : l'un est le cout THEORIQUE
 * affiche sur la fiche produit, l'autre le cout REEL d'une session precise —
 * exactement la distinction que CLAUDE.md §0 nomme (« coût de revient réel,
 * écart théorique/réel »), pas un doublon.
 *
 * `estRevendu` (D-085, `packages/core/src/recettes.ts`) — CORRIGE A LA RACINE
 * le 01/08/2026, dans `coutProduitVendu` lui-meme plutot qu'ici. Cette
 * fonction PURE supposait que `nbCrepesParUnite === 0` signifiait « produit
 * revendu sans prix d'achat connu » (`baseAchatManquante`) — une hypothese
 * vraie avant D-085, fausse depuis que DEUX AUTRES cas partagent la meme
 * valeur sans etre des revendus : un TRANSFORME A LA DEMANDE
 * (`consommationUnite: 'nomenclature'`, le cafe) et un TRANSFORME VENDU AU
 * VOLUME (`consommationUnite: 'volume_pate'`, une pate en bouteille). Les deux
 * heritaient du meme faux positif « revendu sans prix d'achat » — le cafe
 * demontre ici meme (voir les tests plus bas), la pate au volume jamais
 * demontree faute de produit de ce type dans le jeu de demonstration.
 * `estRevendu: produit.nature === 'revendu'`, passe ci-dessous, remplace
 * l'ancienne deduction : ni la pate ni l'achat ne sont dus pour ces deux cas
 * (les deux valent `0`, sans objet), et `detail.coutMatiereCents` le reflete
 * desormais correctement — plus besoin de le recalculer a part pour la
 * nomenclature, une seule formule couvre les trois cas de D-085.
 */
export function coutRevientProduit(
  base: BaseBatte,
  produitVenteId: string,
): CoutProduitVenduContrat | null {
  const produit = base.select().from(produitVente).where(eq(produitVente.id, produitVenteId)).get();
  if (produit === undefined) return null;

  // Un MENU (fiche 16 §2, migration 0023) n'a NI recette NI article propre :
  // son coût de revient vient de la SOMME de ses composants (`ventilerMenu`,
  // appelé par `depots/menus.ts::calculerVentilationMenu`), jamais d'un calcul
  // ICI qui fabriquerait un chiffre sur une fausse recette. `null` est le bon
  // rendu : un coût INCONNU par CETTE fonction, jamais un coût GRATUIT ni un
  // coût trompeur — même doctrine que le reste de ce fichier (D-018).
  // Ce `return` narrowe aussi `produit.nature` à `'transforme' | 'revendu'`
  // pour tout le reste de la fonction, sans qu'aucun cast ne soit nécessaire.
  if (produit.nature === 'menu') return null;

  const pourCalcul =
    produit.recetteId === null ? null : chargerRecettePourCalcul(base, produit.recetteId);
  const composants = composantsActifsDesProduits(base, [produitVenteId]).get(produitVenteId) ?? [];

  // D-085 (fiche 15 §5.1) : IDENTIFIE par le champ qui le NOMME, jamais
  // deduit de `nbCrepesParUnite === 0` — cette valeur est aussi partagee par
  // un revendu et par un transforme A LA DEMANDE (le cafe), sans etre l'un
  // ou l'autre. Meme fonction que `services/sessions.ts` (cloture de
  // session) : une seule regle d'identification pour toute l'application.
  const estVolumePate = estPateVendueAuVolume({
    nature: produit.nature,
    consommationUnite: produit.consommationUnite,
  });

  const detail = coutProduitVendu({
    // Sans objet pour une pate au volume (voir `estPateVendueAuVolume` /
    // `coutParMlCents` ci-dessous) : un `coutParCrepeCents` renseigne ici
    // suggererait a tort une economie de crepe qui ne s'applique pas a ce
    // produit.
    coutParCrepeCents: estVolumePate || pourCalcul === null ? null : coutParCrepe(pourCalcul),
    // Un revendu ne consomme aucune crepe : `nbCrepes` y vaut `null` en base.
    nbCrepesParUnite: produit.nature === 'revendu' ? 0 : (produit.nbCrepes ?? 1),
    coutAchatUniteCents:
      produit.nature === 'revendu' && produit.ingredientId !== null
        ? (coutsDeReference(base).get(produit.ingredientId) ?? null)
        : null,
    // D-085 : seul un VRAI revendu attend un prix d'achat — voir la doc de
    // `estRevendu` (`packages/core/src/recettes.ts`). Un transforme A LA
    // DEMANDE (nomenclature) ou VENDU AU VOLUME (volume_pate) porte lui
    // aussi `nbCrepesParUnite === 0`, mais n'est ni l'un ni l'autre.
    estRevendu: produit.nature === 'revendu',
    // TROU CORRIGE (mission « un correctif qui n'arrive pas jusqu'a l'ecran
    // ne corrige rien », 01/08/2026) : `coutProduitVendu` savait deja
    // chiffrer la part de pate d'une bouteille depuis sa correction, mais ce
    // depot ne lui fournissait aucun des trois champs ci-dessous — il
    // retombait donc sur `coutParCrepeCents * nbCrepesParUnite`, TOUJOURS
    // zero puisque `nbCrepesParUnite` vaut `0` pour ce type de produit
    // (coût matiere a zero, marge a 100 %, exactement le mensonge interdit
    // par CLAUDE.md §7). `coutParMl` (ci-dessus) reprend la MEME methode
    // theorique que `coutParCrepe`, appliquee au volume REEL de l'unite
    // vendue plutot qu'au rendement de reference.
    estPateVendueAuVolume: estVolumePate,
    coutParMlCents:
      estVolumePate && pourCalcul !== null && produit.volumeMlParUnite !== null
        ? coutParMl(pourCalcul, produit.volumeMlParUnite)
        : null,
    volumeMlParUnite: produit.volumeMlParUnite,
    garnitures: garnituresDuProduit(base, produitVenteId),
    allergenesPate: pourCalcul === null ? [] : agregerAllergenes(pourCalcul.lignes),
    composants: composants.map((c) => ({ allergenes: c.allergenes })),
  });

  const { composants: composantsChiffres, coutComposantsCents } = coutsComposantsVente(
    composantsVenteEntreeDuProduit(base, produitVenteId),
    produit.consommationSurPlace,
  );

  // Une seule formule pour les trois cas de D-085 depuis le correctif de
  // `estRevendu` : `detail.coutMatiereCents` ne vaut plus JAMAIS `null` par
  // erreur pour un transforme a la demande ou vendu au volume (voir le
  // commentaire de tete de fonction) — l'ancien contournement qui recalculait
  // ce total a part pour `consommationUnite === 'nomenclature'` est devenu
  // redondant : les deux chemins rendaient deja rigoureusement le meme
  // nombre (`detail.coutPateCents + detail.coutAchatCents +
  // detail.coutGarnituresCents`, les deux premiers valant `0` dans ce cas,
  // EST `detail.coutMatiereCents` des que ni la pate ni l'achat ne manquent) —
  // preuve verrouillee par les tests de ce fichier (cafe) et de
  // `packages/core/src/recettes.test.ts` (pate au volume).
  const coutMatiereCents =
    detail.coutMatiereCents === null || coutComposantsCents === null
      ? null
      : detail.coutMatiereCents + coutComposantsCents;

  const margeCents = coutMatiereCents === null ? null : produit.prixCents - coutMatiereCents;

  return {
    produitVenteId: produit.id,
    nom: produit.nom,
    nature: produit.nature,
    prixVenteCents: produit.prixCents,
    coutPateCents: detail.coutPateCents,
    coutAchatCents: detail.coutAchatCents,
    coutGarnituresCents: detail.coutGarnituresCents,
    coutComposantsCents,
    coutMatiereCents,
    margeCents,
    // En points de base, jamais en pourcentage flottant (CLAUDE.md §3 n°3).
    // Un prix de vente nul ne rend pas une marge infinie : `null`.
    margeBp:
      margeCents === null || produit.prixCents <= 0
        ? null
        : ratioEnPointsDeBase(margeCents, produit.prixCents),
    garnitures: detail.garnitures.map((g) => ({
      ingredientId: g.ingredientId,
      nomIngredient: g.nomIngredient,
      unite: g.unite,
      quantiteParUnite: g.quantiteParUnite,
      cumpCentsParUnite: g.cumpCentsParUnite,
      coutCents: g.coutCents,
      allergenes: [...g.allergenes],
    })),
    composants: composantsChiffres,
    allergenes: [...detail.allergenes],
  };
}

/** Cout de revient de tous les produits actifs, pour l'ecran Produits. */
export function listerCoutsRevientProduits(base: BaseBatte): CoutProduitVenduContrat[] {
  return base
    .select({ id: produitVente.id })
    .from(produitVente)
    .orderBy(asc(produitVente.nom))
    .all()
    .map((p) => coutRevientProduit(base, p.id))
    .filter((c): c is CoutProduitVenduContrat => c !== null);
}

/** Liste pour l'ecran Recettes, triee par code puis version decroissante. */
export function listerRecettes(base: BaseBatte): RecetteResume[] {
  const entetes = base
    .select()
    .from(recette)
    .orderBy(asc(recette.code), asc(recette.version))
    .all();

  return entetes.map((entete) => {
    const pourCalcul = chargerRecettePourCalcul(base, entete.id);
    return {
      id: entete.id,
      code: entete.code,
      nom: entete.nom,
      version: entete.version,
      statut: entete.statut,
      sansGluten: entete.sansGluten,
      rendementReferenceMl: entete.rendementReferenceMl,
      rendementReferenceCrepes: entete.rendementReferenceCrepes,
      nbLignes: pourCalcul === null ? 0 : pourCalcul.lignes.length,
      coutParCrepeCents: pourCalcul === null ? null : coutParCrepe(pourCalcul),
    };
  });
}
