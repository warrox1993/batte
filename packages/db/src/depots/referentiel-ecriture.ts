/**
 * Depot d'ECRITURE du referentiel de base : ingredients, conditionnements,
 * recettes et lieux de marche.
 *
 * POURQUOI CE FICHIER EXISTE. Ces quatre tables (cinq avec `recette_ligne`)
 * n'etaient ecrites que par `packages/db/src/seed/` — docs/13 §4.7 le classe en
 * trou de gravite 2. Trois consequences, toutes constatees sur la base reelle :
 *
 *  - la recette R2 (sarrasin-chataigne, sans gluten) est semee VIDE et en
 *    brouillon, avec la note « saisissez vos ingredients » — et rien ne le
 *    permettait. L'application proposait un produit sans gluten dont elle
 *    ignorait le cout, les allergenes et le rendement ;
 *  - le prix d'achat vit dans `conditionnement.prix_cents` (D-018). Un
 *    changement de tarif du meunier n'etait donc pas saisissable, et le cout
 *    matiere restait fige au prix de la graine, pour toujours ;
 *  - `ingredient.stock_securite` vaut 0 partout, ce qui rend le point de
 *    commande — et tout l'ecran de reapprovisionnement — inerte.
 *
 * QUATRE REGLES GOUVERNENT CE FICHIER. Elles reprennent celles de
 * `depots/referentiel.ts`, dont ce fichier est le prolongement.
 *
 * 1. **On desactive, on ne supprime jamais** (CLAUDE.md §3 regle 7). Aucun
 *    `DELETE` sur `ingredient`, `conditionnement`, `recette` ni `lieu_marche` :
 *    un ingredient est reference par des lots recus il y a deux ans, dont la
 *    tracabilite AFSCA doit rester lisible. La seule suppression physique de ce
 *    fichier porte sur les LIGNES d'une recette qui n'a jamais produit — voir
 *    la justification detaillee sur `modifierRecette`.
 *
 * 2. **La modification et sa trace d'audit sont dans la MEME transaction.**
 *    Un journal qui survit a un echec, ou qui manque apres un succes, ment.
 *
 * 3. **Aucune regle de forme ici.** Bornes, formats et coherences sont portes
 *    par `@batte/core` (`contrats/referentiel.ts`), en schemas purs et testes,
 *    partages avec le navigateur. Ce depot ne verifie que ce qu'un schema NE
 *    PEUT PAS verifier : l'existence reelle des lignes referencees, l'unicite,
 *    et l'etat de la base (« cette recette a-t-elle deja produit ? »).
 *
 * 4. **Une reference inconnue est un 422 avec `champs`, jamais un 500.**
 *    Sans controle prealable, une cle etrangere inconnue remonterait en
 *    contrainte SQLite brute, donc en « erreur inattendue » (D-035).
 */

import {
  ErreurIntrouvable,
  ErreurMetier,
  maintenantUtc,
  nouvelIdentifiant,
  type CategorieIngredient,
  type SaisieConditionnement,
  type SaisieIngredient,
  type SaisieLieu,
  type SaisieRecette,
  type StatutRecette,
} from '@batte/core';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  conditionnement,
  fournisseur,
  ingredient,
  lot,
  lieuMarche,
  production,
  produitVente,
  recette,
  recetteLigne,
  sessionMarche,
} from '../schema.js';
import { journaliser } from './audit.js';
import { verifierFournisseurCommercial } from './fournisseur-systeme.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Outils communs
   ═══════════════════════════════════════════════════════════════════════════ */

/** Compte les lignes d'une requete agregee, en rendant 0 plutot que `undefined`. */
function nombre(resultat: { valeur: number } | undefined): number {
  return resultat?.valeur ?? 0;
}

/**
 * Foyer de cette garde (audit du 31/07/2026) : la MÊME vérification —
 * l'ingrédient existe-t-il ? — était recopiée à l'identique dans
 * `depots/economies.ts` et `depots/nomenclature-vente.ts`, avec une
 * formulation qui avait déjà divergé sur l'un des deux (« n'existe pas ou a
 * été supprimé. » contre « n'existe plus. » ici). Ce fichier est le foyer
 * naturel : il possède déjà le CRUD de `ingredient` (`creerIngredient`,
 * `modifierIngredient`…), contrairement aux deux autres, qui n'en gèrent
 * aucun. Exportée pour être réutilisée telle quelle par ces deux dépôts.
 */
export function verifierIngredientExiste(base: BaseBatte, ingredientId: string): void {
  const existe = base
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(eq(ingredient.id, ingredientId))
    .get();
  if (existe === undefined) {
    throw new ErreurMetier('ingredient_introuvable', "L'ingrédient choisi n'existe plus.", {
      champs: { ingredientId: 'Choisissez un ingrédient existant.' },
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ingredients — lecture enrichie
   ═══════════════════════════════════════════════════════════════════════════ */

export type IngredientCompletLigne = {
  id: string;
  nom: string;
  // Derive de `schemaCategorieIngredient`, jamais recopie : cette union etait
  // une COPIE a la main des sept categories, et elle s'est desynchronisee des
  // que le porteur en a ajoute une huitieme (`boisson`, 31/07/2026). Une liste
  // recopiee ment toujours un jour ; celle-ci est desormais tenue par le
  // compilateur.
  categorie: CategorieIngredient;
  uniteReference: 'g' | 'ml' | 'piece';
  densiteGParMl: number | null;
  allergenes: string[];
  allergenesVerifies: boolean;
  stockSecurite: number;
  delaiLivraisonJours: number | null;
  dureeConservationJours: number | null;
  notes: string | null;
  actif: boolean;
  nbConditionnements: number;
  coutUnitaireCents: number | null;
  nbLignesRecette: number;
  nbLots: number;
};

/** Comptages par ingredient, en une requete chacun plutot qu'en jointures agregees. */
function compteursIngredients(base: BaseBatte): {
  conditionnements: Map<string, number>;
  lignesRecette: Map<string, number>;
  lots: Map<string, number>;
} {
  const parIngredient = (
    lignes: ReadonlyArray<{ ingredientId: string; valeur: number }>,
  ): Map<string, number> => new Map(lignes.map((l) => [l.ingredientId, l.valeur]));

  return {
    conditionnements: parIngredient(
      base
        .select({ ingredientId: conditionnement.ingredientId, valeur: count() })
        .from(conditionnement)
        .where(eq(conditionnement.actif, true))
        .groupBy(conditionnement.ingredientId)
        .all(),
    ),
    lignesRecette: parIngredient(
      base
        .select({ ingredientId: recetteLigne.ingredientId, valeur: count() })
        .from(recetteLigne)
        .groupBy(recetteLigne.ingredientId)
        .all(),
    ),
    lots: parIngredient(
      base
        .select({ ingredientId: lot.ingredientId, valeur: count() })
        .from(lot)
        .groupBy(lot.ingredientId)
        .all(),
    ),
  };
}

/**
 * Cout unitaire de reference, en centimes par unite (D-018).
 *
 * Repris a l'identique de `depots/recettes.ts` : le conditionnement ACTIF le
 * plus recent, soit `prix_cents / quantite_unite_ref`. Jamais un prix unitaire
 * stocke, qui pourrait diverger de ces deux valeurs.
 */
function coutsUnitaires(base: BaseBatte): Map<string, number> {
  const lignes = base
    .select({
      ingredientId: conditionnement.ingredientId,
      prixCents: conditionnement.prixCents,
      quantite: conditionnement.quantiteUniteRef,
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

/**
 * Tous les ingredients, ACTIFS ET INACTIFS, tries par nom.
 *
 * Distinct de `GET /api/ingredients` (routes/referentiel.ts), qui ne rend que
 * les actifs et un sous-ensemble des colonnes, et dont quatre ecrans dependent.
 * On ajoute a cote, on ne modifie pas : un ecran de referentiel doit montrer ce
 * qui est desactive, un selecteur de reception ne le doit surtout pas.
 */
export function listerIngredientsComplets(base: BaseBatte): IngredientCompletLigne[] {
  const compteurs = compteursIngredients(base);
  const couts = coutsUnitaires(base);

  return base
    .select()
    .from(ingredient)
    .orderBy(asc(ingredient.nom))
    .all()
    .map((ligne) => ({
      id: ligne.id,
      nom: ligne.nom,
      categorie: ligne.categorie,
      uniteReference: ligne.uniteReference,
      densiteGParMl: ligne.densiteGParMl,
      allergenes: ligne.allergenes,
      allergenesVerifies: ligne.allergenesVerifies,
      stockSecurite: ligne.stockSecurite,
      delaiLivraisonJours: ligne.delaiLivraisonJours,
      dureeConservationJours: ligne.dureeConservationJours,
      notes: ligne.notes,
      actif: ligne.actif,
      nbConditionnements: compteurs.conditionnements.get(ligne.id) ?? 0,
      coutUnitaireCents: couts.get(ligne.id) ?? null,
      nbLignesRecette: compteurs.lignesRecette.get(ligne.id) ?? 0,
      nbLots: compteurs.lots.get(ligne.id) ?? 0,
    }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ingredients — ecriture
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `ingredient.nom` porte un index UNIQUE. Sans ce controle, un doublon
 * remonterait en contrainte SQLite brute, donc en 500 « erreur inattendue »,
 * alors que c'est une faute de saisie qui merite un 422 designant le champ.
 */
function verifierNomIngredientLibre(base: BaseBatte, nom: string, saufId?: string): void {
  const conditions = [eq(ingredient.nom, nom)];
  if (saufId !== undefined) conditions.push(ne(ingredient.id, saufId));

  const existant = base
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(and(...conditions))
    .get();

  if (existant !== undefined) {
    throw new ErreurMetier(
      'nom_ingredient_deja_pris',
      `Un ingrédient nommé « ${nom} » existe déjà.`,
      {
        champs: {
          nom: 'Ce nom est déjà utilisé. Choisissez-en un autre, ou réactivez l’ingrédient existant.',
        },
      },
    );
  }
}

export function creerIngredient(
  base: BaseBatte,
  saisie: SaisieIngredient,
  parQui?: string,
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    verifierNomIngredientLibre(baseTx, saisie.nom);

    const cree = baseTx
      .insert(ingredient)
      .values({
        id,
        nom: saisie.nom,
        categorie: saisie.categorie,
        uniteReference: saisie.uniteReference,
        densiteGParMl: saisie.densiteGParMl,
        allergenes: saisie.allergenes,
        // Absent du formulaire (ecran pas encore mis a jour) = pas encore
        // evalue : c'est aussi le defaut de la colonne elle-meme (migration
        // 0024). Voir le commentaire de `schemaSaisieIngredientBrute.allergenesVerifies`.
        allergenesVerifies: saisie.allergenesVerifies ?? false,
        stockSecurite: saisie.stockSecurite,
        delaiLivraisonJours: saisie.delaiLivraisonJours,
        dureeConservationJours: saisie.dureeConservationJours,
        notes: saisie.notes,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'ingredient',
      enregistrementId: id,
      action: 'creation',
      valeurApres: cree,
      parQui: parQui ?? null,
    });

    return id;
  });
}

export function modifierIngredient(
  base: BaseBatte,
  id: string,
  saisie: SaisieIngredient,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(ingredient).where(eq(ingredient.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Ingrédient', id);

    verifierNomIngredientLibre(baseTx, saisie.nom, id);

    /**
     * L'UNITE DE REFERENCE NE SE CHANGE PLUS DES QU'UNE QUANTITE EXISTE.
     *
     * Toutes les quantites de l'ingredient — lots recus, mouvements de stock,
     * lignes de recette, ET conditionnements — sont des ENTIERS exprimes dans
     * cette unite, et rien ne les accompagne. Passer `g` a `ml` ne convertit
     * rien : cela REINTERPRETE 25 000 g en 25 000 ml, silencieusement. Le
     * stock, sa valorisation et le cout matiere deviennent faux sans qu'aucune
     * erreur ne soit levee — meme famille de defaut que le `NaN` de densite
     * (D-034).
     *
     * AUDIT DU 29/07/2026 : LE CONDITIONNEMENT MANQUAIT A CETTE LISTE. Le
     * commentaire d'origine ne comptait que `lot` et `recette_ligne` — mais
     * `conditionnement.quantite_unite_ref` est EXACTEMENT la meme famille de
     * quantite entiere « exprimee dans cette unite » (« Sac 25 kg » = 25 000,
     * dans l'unite de l'ingredient au moment de la saisie). Un ingredient
     * fraichement cree, deja tarife (un conditionnement existe) mais pas
     * encore recu ni utilise dans une recette (aucun lot, aucune ligne :
     * l'ancienne garde laissait alors passer le changement) pouvait donc
     * changer d'unite sans refus, et `coutsDeReference`/`coutsUnitaires`
     * (`depots/recettes.ts`, `depots/referentiel-ecriture.ts`) se seraient mis
     * a diviser le MEME prix par la MEME quantite reinterpretee dans une autre
     * unite physique — un taux au gramme devenu, sans alerte, un taux au
     * millilitre. C'est exactement le defaut que ce garde-fou existe pour
     * empecher ; il ne couvrait simplement pas tous les porteurs de quantite.
     *
     * Le message porte les chiffres : c'est ce qui permet a l'utilisateur de
     * comprendre pourquoi on refuse, plutot que de croire a un bug.
     */
    if (saisie.uniteReference !== avant.uniteReference) {
      const nbLots = nombre(
        baseTx.select({ valeur: count() }).from(lot).where(eq(lot.ingredientId, id)).get(),
      );
      const nbLignes = nombre(
        baseTx
          .select({ valeur: count() })
          .from(recetteLigne)
          .where(eq(recetteLigne.ingredientId, id))
          .get(),
      );
      // ACTIFS ET INACTIFS : un conditionnement desactive reste un prix
      // historique reellement paye dans l'ancienne unite (D-018 corollaire,
      // « l'historique des prix se lit de haut en bas ») — le reinterpreter
      // fausserait tout autant une tendance de prix passee.
      const nbConditionnements = nombre(
        baseTx
          .select({ valeur: count() })
          .from(conditionnement)
          .where(eq(conditionnement.ingredientId, id))
          .get(),
      );

      if (nbLots > 0 || nbLignes > 0 || nbConditionnements > 0) {
        throw new ErreurMetier(
          'unite_reference_figee',
          `L'unité de référence ne peut plus changer : ${nbLots} lot(s), ${nbLignes} ligne(s) ` +
            `de recette et ${nbConditionnements} conditionnement(s) sont déjà exprimés en ` +
            `« ${avant.uniteReference} ». Les convertir en « ${saisie.uniteReference} » ne ` +
            'convertirait pas les quantités, il les réinterpréterait — le stock et le coût ' +
            'matière deviendraient faux sans alerte.',
          {
            champs: {
              uniteReference: `Conservez « ${avant.uniteReference} », ou créez un nouvel ingrédient.`,
            },
          },
        );
      }
    }

    const apres = baseTx
      .update(ingredient)
      .set({
        nom: saisie.nom,
        categorie: saisie.categorie,
        uniteReference: saisie.uniteReference,
        densiteGParMl: saisie.densiteGParMl,
        allergenes: saisie.allergenes,
        /**
         * `undefined` = le formulaire n'a rien dit sur ce point (ecran pas
         * encore mis a jour) -> la valeur DEJA EN BASE survit, exactement
         * comme `notesTechniquesExistantes` (plus bas dans ce fichier)
         * conserve une note technique de recette absente de l'ecran. Sans
         * cette conservation, reenregistrer un ingredient depuis l'ancien
         * formulaire desevaluerait en silence un ingredient deja verifie —
         * la meme famille de defaut que « allergenes vides = aucun allergene ».
         * Un `true`/`false` explicite, lui, change reellement l'evaluation.
         */
        allergenesVerifies: saisie.allergenesVerifies ?? avant.allergenesVerifies,
        stockSecurite: saisie.stockSecurite,
        delaiLivraisonJours: saisie.delaiLivraisonJours,
        dureeConservationJours: saisie.dureeConservationJours,
        notes: saisie.notes,
        modifieLe: maintenantUtc(),
      })
      .where(eq(ingredient.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'ingredient',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/**
 * Active ou desactive un ingredient. **Le remplacant de la suppression** : des
 * lots recus il y a deux ans le referencent, et leur tracabilite AFSCA doit
 * rester lisible pendant toute la duree de conservation legale.
 */
export function changerActiviteIngredient(
  base: BaseBatte,
  id: string,
  actif: boolean,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(ingredient).where(eq(ingredient.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Ingrédient', id);

    const apres = baseTx
      .update(ingredient)
      .set({ actif, modifieLe: maintenantUtc() })
      .where(eq(ingredient.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'ingredient',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Conditionnements — lecture
   ═══════════════════════════════════════════════════════════════════════════ */

export type ConditionnementLigne = {
  id: string;
  ingredientId: string;
  ingredientNom: string;
  uniteReference: 'g' | 'ml' | 'piece';
  fournisseurId: string;
  fournisseurNom: string;
  libelle: string;
  quantiteUniteRef: number;
  prixCents: number;
  referenceFournisseur: string | null;
  datePrix: string;
  actif: boolean;
};

/**
 * Conditionnements, ACTIFS ET INACTIFS, du plus recent au plus ancien.
 *
 * L'ordre n'est pas cosmetique : un changement de tarif desactive la ligne
 * precedente et en insere une nouvelle (voir `enregistrerNouveauTarif`).
 * L'historique des prix se lit donc de haut en bas, et c'est lui qui repond a
 * « le meunier a-t-il augmente ses prix ? ».
 */
export function listerConditionnements(
  base: BaseBatte,
  ingredientId?: string,
): ConditionnementLigne[] {
  const requete = base
    .select({
      c: conditionnement,
      ingredientNom: ingredient.nom,
      uniteReference: ingredient.uniteReference,
      fournisseurNom: fournisseur.nom,
    })
    .from(conditionnement)
    .innerJoin(ingredient, eq(conditionnement.ingredientId, ingredient.id))
    .innerJoin(fournisseur, eq(conditionnement.fournisseurId, fournisseur.id));

  const lignes = (
    ingredientId === undefined
      ? requete
      : requete.where(eq(conditionnement.ingredientId, ingredientId))
  )
    .orderBy(asc(ingredient.nom), desc(conditionnement.datePrix), desc(conditionnement.id))
    .all();

  return lignes.map((ligne) => ({
    id: ligne.c.id,
    ingredientId: ligne.c.ingredientId,
    ingredientNom: ligne.ingredientNom,
    uniteReference: ligne.uniteReference,
    fournisseurId: ligne.c.fournisseurId,
    fournisseurNom: ligne.fournisseurNom,
    libelle: ligne.c.libelle,
    quantiteUniteRef: ligne.c.quantiteUniteRef,
    prixCents: ligne.c.prixCents,
    referenceFournisseur: ligne.c.referenceFournisseur,
    datePrix: ligne.c.datePrix,
    actif: ligne.c.actif,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Conditionnements — ecriture
   ═══════════════════════════════════════════════════════════════════════════ */

export function creerConditionnement(
  base: BaseBatte,
  saisie: SaisieConditionnement,
  parQui?: string,
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    verifierIngredientExiste(baseTx, saisie.ingredientId);
    verifierFournisseurCommercial(baseTx, saisie.fournisseurId, 'on ne lui commande rien.');

    const cree = baseTx
      .insert(conditionnement)
      .values({
        id,
        ingredientId: saisie.ingredientId,
        fournisseurId: saisie.fournisseurId,
        libelle: saisie.libelle,
        quantiteUniteRef: saisie.quantiteUniteRef,
        prixCents: saisie.prixCents,
        referenceFournisseur: saisie.referenceFournisseur,
        datePrix: saisie.datePrix,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'conditionnement',
      enregistrementId: id,
      action: 'creation',
      valeurApres: cree,
      parQui: parQui ?? null,
    });

    return id;
  });
}

/**
 * CORRIGER une fiche de conditionnement : la valeur saisie etait fausse, elle
 * n'a jamais ete vraie (faute de frappe, mauvaise contenance relevee).
 *
 * A ne pas confondre avec `enregistrerNouveauTarif` — c'est exactement la
 * distinction de D-042 pour les parametres, et pour la meme raison. Corriger
 * reecrit le prix a sa date d'origine, donc reecrit retroactivement tout cout
 * matiere recalcule depuis cette date. Faire evoluer ajoute une ligne datee et
 * laisse le passe intact.
 */
export function modifierConditionnement(
  base: BaseBatte,
  id: string,
  saisie: SaisieConditionnement,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(conditionnement).where(eq(conditionnement.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Conditionnement', id);

    verifierIngredientExiste(baseTx, saisie.ingredientId);
    verifierFournisseurCommercial(baseTx, saisie.fournisseurId, 'on ne lui commande rien.');

    const apres = baseTx
      .update(conditionnement)
      .set({
        ingredientId: saisie.ingredientId,
        fournisseurId: saisie.fournisseurId,
        libelle: saisie.libelle,
        quantiteUniteRef: saisie.quantiteUniteRef,
        prixCents: saisie.prixCents,
        referenceFournisseur: saisie.referenceFournisseur,
        datePrix: saisie.datePrix,
        modifieLe: maintenantUtc(),
      })
      .where(eq(conditionnement.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'conditionnement',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

export type ResultatNouveauTarif = {
  /** Identifiant de la ligne de prix NOUVELLEMENT creee. */
  conditionnementId: string;
  ancienPrixCents: number;
  nouveauPrixCents: number;
};

/**
 * FAIRE EVOLUER le tarif : le prix etait juste et change a partir d'une date.
 *
 * Le schema le dit deja (`conditionnement.date_prix`, D-018 corollaire) : « une
 * nouvelle ligne est creee a chaque changement de prix plutot que d'ecraser :
 * sans historique, aucune tendance ni ecart de prix n'est calculable ». Cette
 * fonction est le geste qui manquait pour l'appliquer.
 *
 * L'ANCIENNE LIGNE EST DESACTIVEE, PAS SUPPRIMEE. Trois consommateurs lisent
 * `conditionnement WHERE actif = 1` : `coutsDeReference` (depots/recettes.ts),
 * `conditionnementReference` (services/commandes.ts) et le compteur de
 * `listerFournisseurs`. Les deux premiers prennent deja la date la plus
 * recente, donc laisser les deux lignes actives donnerait le bon prix — mais le
 * troisieme compterait « 2 conditionnements » la ou il n'y a qu'un article, et
 * le fournisseur afficherait un inventaire faux. Desactiver garde l'histoire
 * lisible ET les trois compteurs exacts.
 */
export function enregistrerNouveauTarif(
  base: BaseBatte,
  id: string,
  tarif: { prixCents: number; datePrix: string; referenceFournisseur: string | null },
  parQui?: string,
): ResultatNouveauTarif {
  const nouvelId = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const ancien = baseTx.select().from(conditionnement).where(eq(conditionnement.id, id)).get();
    if (ancien === undefined) throw new ErreurIntrouvable('Conditionnement', id);

    if (!ancien.actif) {
      throw new ErreurMetier(
        'conditionnement_inactif',
        `« ${ancien.libelle} » est désactivé : c'est déjà une ligne d'historique. ` +
          'Repartez du tarif actif de cet article.',
      );
    }

    /**
     * Garde reprise de D-042 : une date anterieure ou egale ne serait jamais
     * retenue par `coutsDeReference` (qui prend la plus recente), donc le
     * nouveau prix n'aurait AUCUN effet — un enregistrement sans consequence
     * est pire qu'un refus, l'utilisateur croirait avoir change le tarif.
     * Le message porte les deux dates : c'est ce qui rend le refus actionnable.
     */
    if (tarif.datePrix <= ancien.datePrix) {
      throw new ErreurMetier(
        'date_tarif_anterieure',
        `Le tarif en vigueur date du ${ancien.datePrix} : une nouvelle date au ${tarif.datePrix} ` +
          'ne serait jamais retenue, le coût matière ne bougerait pas. Choisissez une date ' +
          `postérieure au ${ancien.datePrix}, ou corrigez la fiche si le prix saisi était faux.`,
        { champs: { datePrix: `Choisissez une date postérieure au ${ancien.datePrix}.` } },
      );
    }

    const cree = baseTx
      .insert(conditionnement)
      .values({
        id: nouvelId,
        ingredientId: ancien.ingredientId,
        fournisseurId: ancien.fournisseurId,
        libelle: ancien.libelle,
        quantiteUniteRef: ancien.quantiteUniteRef,
        prixCents: tarif.prixCents,
        referenceFournisseur: tarif.referenceFournisseur ?? ancien.referenceFournisseur,
        datePrix: tarif.datePrix,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .returning()
      .get();

    const archive = baseTx
      .update(conditionnement)
      .set({ actif: false, modifieLe: maintenant })
      .where(eq(conditionnement.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'conditionnement',
      enregistrementId: nouvelId,
      action: 'creation',
      valeurApres: cree,
      parQui: parQui ?? null,
    });
    journaliser(baseTx, {
      table: 'conditionnement',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: ancien,
      valeurApres: archive,
      parQui: parQui ?? null,
    });

    return {
      conditionnementId: nouvelId,
      ancienPrixCents: ancien.prixCents,
      nouveauPrixCents: tarif.prixCents,
    };
  });
}

export function changerActiviteConditionnement(
  base: BaseBatte,
  id: string,
  actif: boolean,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(conditionnement).where(eq(conditionnement.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Conditionnement', id);

    const apres = baseTx
      .update(conditionnement)
      .set({ actif, modifieLe: maintenantUtc() })
      .where(eq(conditionnement.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'conditionnement',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Recettes — ecriture et versionnage (D-005)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Nombre de productions qui referencent cette version de recette.
 *
 * C'EST LE CRITERE QUI TRANCHE ENTRE MODIFIER ET VERSIONNER, et il n'est pas
 * `statut`. D-005 protege une chose precise : « le cout matiere historique
 * d'une production doit rester recalculable ». Or ce qui rend un recalcul
 * historique possible ou faux, c'est `production.recette_id`. Une recette que
 * personne n'a jamais produite n'a aucun passe a proteger : la versionner
 * fabriquerait une v1 vide que rien ne pourrait jamais expliquer.
 */
function nbProductions(base: BaseBatte, recetteId: string): number {
  return nombre(
    base
      .select({ valeur: count() })
      .from(production)
      .where(eq(production.recetteId, recetteId))
      .get(),
  );
}

/** Produits de vente accroches a une version precise de recette. */
function nbProduitsSurRecette(base: BaseBatte, recetteId: string): number {
  return nombre(
    base
      .select({ valeur: count() })
      .from(produitVente)
      .where(eq(produitVente.recetteId, recetteId))
      .get(),
  );
}

/** Une note technique persistée sur une ligne de recette — le geste, pas l'allergène. */
export type NoteTechniqueLigneRecette = {
  ingredientId: string;
  nomIngredient: string;
  noteTechnique: string;
};

export type RecetteReferentielLigne = {
  id: string;
  code: string;
  nom: string;
  version: number;
  statut: StatutRecette;
  sansGluten: boolean;
  recetteParentId: string | null;
  nbLignes: number;
  nbProductions: number;
  nbProduits: number;
  /**
   * Notes techniques NON VIDES de cette recette (audit du 30/07/2026 :
   * `recette_ligne.note_technique` est écrite, conservée d'un enregistrement
   * à l'autre — voir `notesTechniquesExistantes` plus bas — mais jusqu'ici
   * jamais exposée par aucun contrat de lecture). Voir `notesTechniquesParRecette`.
   */
  notesTechniques: NoteTechniqueLigneRecette[];
};

/**
 * Notes techniques NON VIDES, groupées par recette.
 *
 * `recette_ligne.note_technique` porte la note du GESTE (« beurre noisette, ne
 * pas dépasser la coloration ») : elle a sa place sur la fiche technique,
 * imprimée ou à l'écran, mais N'EST PAS un allergène — deux informations aux
 * exigences différentes, jamais à confondre (CLAUDE.md §7 : un allergène
 * inconnu doit rester inconnu, une note technique absente n'affirme rien de
 * tel). Une ligne SANS note n'a rien à montrer : elle est simplement absente
 * du tableau rendu, plutôt qu'une entrée à valeur `null`.
 */
function notesTechniquesParRecette(base: BaseBatte): Map<string, NoteTechniqueLigneRecette[]> {
  const lignes = base
    .select({
      recetteId: recetteLigne.recetteId,
      ingredientId: recetteLigne.ingredientId,
      nomIngredient: ingredient.nom,
      noteTechnique: recetteLigne.noteTechnique,
    })
    .from(recetteLigne)
    .innerJoin(ingredient, eq(recetteLigne.ingredientId, ingredient.id))
    .orderBy(asc(recetteLigne.ordre))
    .all();

  const parRecette = new Map<string, NoteTechniqueLigneRecette[]>();
  for (const ligne of lignes) {
    if (ligne.noteTechnique === null) continue;
    const liste = parRecette.get(ligne.recetteId) ?? [];
    liste.push({
      ingredientId: ligne.ingredientId,
      nomIngredient: ligne.nomIngredient,
      noteTechnique: ligne.noteTechnique,
    });
    parRecette.set(ligne.recetteId, liste);
  }
  return parRecette;
}

/**
 * Toutes les recettes, avec CE QUI DECIDE du geste possible sur chacune.
 *
 * `listerRecettes` (depots/recettes.ts) rend deja le resume metier et le cout
 * par crepe ; on ne le touche pas, quatre ecrans en dependent. Ce qui manque et
 * qui ne se deduit d'aucune de ses colonnes, c'est `nbProductions` : une recette
 * qui a servi est scellee (D-005), et c'est ce compte — pas le statut — qui le
 * dit. Le rendre lisible depuis l'ecran evite qu'un utilisateur decouvre la
 * regle par un refus.
 *
 * Trois agregats en trois requetes plutot qu'en jointures : le referentiel tient
 * en quelques dizaines de lignes, et trois `GROUP BY` se relisent.
 */
export function listerRecettesReferentiel(base: BaseBatte): RecetteReferentielLigne[] {
  const parRecette = (
    lignes: ReadonlyArray<{ recetteId: string | null; valeur: number }>,
  ): Map<string, number> =>
    new Map(
      lignes
        .filter((l): l is { recetteId: string; valeur: number } => l.recetteId !== null)
        .map((l) => [l.recetteId, l.valeur]),
    );

  const lignesParRecette = parRecette(
    base
      .select({ recetteId: recetteLigne.recetteId, valeur: count() })
      .from(recetteLigne)
      .groupBy(recetteLigne.recetteId)
      .all(),
  );
  const productionsParRecette = parRecette(
    base
      .select({ recetteId: production.recetteId, valeur: count() })
      .from(production)
      .groupBy(production.recetteId)
      .all(),
  );
  const produitsParRecette = parRecette(
    base
      .select({ recetteId: produitVente.recetteId, valeur: count() })
      .from(produitVente)
      .groupBy(produitVente.recetteId)
      .all(),
  );
  const notesTechniques = notesTechniquesParRecette(base);

  return base
    .select()
    .from(recette)
    .orderBy(asc(recette.code), asc(recette.version))
    .all()
    .map((ligne) => ({
      id: ligne.id,
      code: ligne.code,
      nom: ligne.nom,
      version: ligne.version,
      statut: ligne.statut,
      sansGluten: ligne.sansGluten,
      recetteParentId: ligne.recetteParentId,
      nbLignes: lignesParRecette.get(ligne.id) ?? 0,
      nbProductions: productionsParRecette.get(ligne.id) ?? 0,
      nbProduits: produitsParRecette.get(ligne.id) ?? 0,
      notesTechniques: notesTechniques.get(ligne.id) ?? [],
    }));
}

/** `(code, version)` porte un index UNIQUE : on verifie avant d'ecrire (D-035). */
function verifierCodeVersionLibre(
  base: BaseBatte,
  code: string,
  version: number,
  saufId?: string,
): void {
  const conditions = [eq(recette.code, code), eq(recette.version, version)];
  if (saufId !== undefined) conditions.push(ne(recette.id, saufId));

  const existant = base
    .select({ id: recette.id })
    .from(recette)
    .where(and(...conditions))
    .get();

  if (existant !== undefined) {
    throw new ErreurMetier(
      'code_recette_deja_pris',
      `Une recette « ${code} » en version ${version} existe déjà.`,
      {
        champs: {
          code: `Choisissez un autre code, ou créez une nouvelle version de « ${code} ».`,
        },
      },
    );
  }
}

/**
 * Notes techniques deja en place, indexees par ingredient.
 *
 * POURQUOI CETTE PRECAUTION. `recette_ligne.note_technique` n'est PAS exposee
 * par `schemaLigneRecette` (contrats/recettes.ts) : aucun ecran ne peut donc la
 * lire, et l'ecran Recettes renvoie forcement `null` pour ce champ a chaque
 * enregistrement. Sans cette conservation, ouvrir puis reenregistrer une recette
 * EFFACERAIT une note qu'on n'a jamais vue — la faute la plus vicieuse d'un
 * formulaire, parce que rien ne la signale.
 *
 * C'est un PALLIATIF, pas la solution : la vraie correction est d'ajouter
 * `noteTechnique` a `schemaLigneRecette` et a `lireRecetteDetail`, puis un champ
 * de saisie par ligne. Tant que ce n'est pas fait, on ne detruit pas.
 */
function notesTechniquesExistantes(base: BaseBatte, recetteId: string): Map<string, string | null> {
  return new Map(
    base
      .select({ ingredientId: recetteLigne.ingredientId, note: recetteLigne.noteTechnique })
      .from(recetteLigne)
      .where(eq(recetteLigne.recetteId, recetteId))
      .all()
      .map((l) => [l.ingredientId, l.note]),
  );
}

/** Remplace la composition d'une recette. Appelee UNIQUEMENT dans une transaction. */
function ecrireLignes(
  baseTx: BaseBatte,
  recetteId: string,
  saisie: SaisieRecette,
  notesConservees: Map<string, string | null> = new Map(),
): void {
  saisie.lignes.forEach((ligne, index) => {
    baseTx
      .insert(recetteLigne)
      .values({
        id: nouvelIdentifiant(),
        recetteId,
        ingredientId: ligne.ingredientId,
        quantiteUniteRef: ligne.quantiteUniteRef,
        ordre: index,
        // Une note explicitement saisie l'emporte ; a defaut, celle qui existait
        // deja pour cet ingredient survit (voir ci-dessus).
        noteTechnique: ligne.noteTechnique ?? notesConservees.get(ligne.ingredientId) ?? null,
      })
      .run();
  });
}

/** Composition actuelle, telle qu'elle part au journal d'audit. */
function lignesDe(base: BaseBatte, recetteId: string) {
  return base
    .select()
    .from(recetteLigne)
    .where(eq(recetteLigne.recetteId, recetteId))
    .orderBy(asc(recetteLigne.ordre))
    .all();
}

/**
 * Refuse une recette « sans gluten » qui CONTREDIT VÉRIFIABLEMENT ses propres
 * ingrédients (audit du 31/07/2026, docs/30 §2.3).
 *
 * `recette.sans_gluten` est une case cochée à la main, totalement indépendante
 * de `ingredient.allergenes` : rien ne recoupait les deux avant cette garde.
 * On peut cocher « sans gluten » sur une recette dont un ingrédient porte
 * explicitement le code `gluten`, et rien ne s'y opposait.
 *
 * TROIS CAS, TROIS TRAITEMENTS — jamais les mêmes (CLAUDE.md §7, sécurité
 * alimentaire, jamais un chiffre) :
 *
 *  - un ingrédient VÉRIFIÉ (`allergenesVerifies = true`) porte le code
 *    `gluten` → CONTRADICTION FRANCHE. L'application SAIT que la recette
 *    contient du gluten pendant qu'on lui demande d'affirmer le contraire :
 *    on refuse (422). On n'écrit jamais en base un fait que l'on sait faux —
 *    ce booléen alimente l'affichette que le client lit.
 *  - un ingrédient N'A JAMAIS ÉTÉ VÉRIFIÉ → IGNORANCE, pas une faute. On
 *    n'affirme rien (ni « contient du gluten », ni « sans gluten confirmé »),
 *    donc on n'a AUCUNE base pour refuser l'enregistrement : les deux
 *    personnes qui utilisent cette application doivent pouvoir enregistrer
 *    une recette en cours de mise au point, un dimanche soir. Ce n'est PAS ce
 *    garde-fou qui protège le client dans ce cas précis, c'est la génération
 *    de document (`apps/api/src/documents/`, déjà vérifiée correcte par
 *    l'audit : les trois documents imprimés refusent d'affirmer une absence
 *    qu'ils ne connaissent pas) — le point de vérité reste la génération du
 *    document, pas la saisie, exactement quand on n'est pas sûr du bon moment
 *    pour bloquer.
 *  - tous les ingrédients sont vérifiés et aucun ne porte `gluten` → cohérent,
 *    on n'écrit rien de plus et on n'avertit de rien : c'est le cas légitime
 *    qui ne doit surtout pas être bloqué par erreur.
 *
 * NE CONCERNE QUE `sansGluten: true` : une recette qui ne revendique rien ne
 * peut contredire personne. Ne regarde que LES LIGNES DE CETTE RECETTE
 * (`recetteLigne` → `ingredient`), pas les garnitures ni les composants de
 * nomenclature de vente — ceux-là appartiennent au produit vendu, pas à la
 * pâte, et sont hors du périmètre de ce champ.
 */
function verifierCoherenceSansGluten(base: BaseBatte, saisie: SaisieRecette): void {
  if (!saisie.sansGluten) return;

  const ingredientIds = [...new Set(saisie.lignes.map((ligne) => ligne.ingredientId))];
  if (ingredientIds.length === 0) return;

  const contradictoire = base
    .select({ id: ingredient.id, nom: ingredient.nom, allergenes: ingredient.allergenes })
    .from(ingredient)
    .where(and(inArray(ingredient.id, ingredientIds), eq(ingredient.allergenesVerifies, true)))
    .all()
    .find((ligne) => ligne.allergenes.includes('gluten'));

  if (contradictoire !== undefined) {
    throw new ErreurMetier(
      'sans_gluten_contradictoire',
      `« ${contradictoire.nom} » contient du gluten (allergènes vérifiés) : cette recette ne ` +
        'peut pas être enregistrée « sans gluten ». Décochez la case « sans gluten », ou retirez ' +
        'cet ingrédient de la recette.',
      {
        champs: {
          sansGluten: `« ${contradictoire.nom} » porte l'allergène gluten (vérifié) : incompatible avec « sans gluten ».`,
        },
      },
    );
  }
}

export function creerRecette(base: BaseBatte, saisie: SaisieRecette, parQui?: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    verifierCodeVersionLibre(baseTx, saisie.code, 1);
    for (const ligne of saisie.lignes) verifierIngredientExiste(baseTx, ligne.ingredientId);
    verifierCoherenceSansGluten(baseTx, saisie);

    const cree = baseTx
      .insert(recette)
      .values({
        id,
        code: saisie.code,
        nom: saisie.nom,
        version: 1,
        recetteParentId: null,
        // Toute recette naît en BROUILLON : `lancerProduction` refuse ce qui
        // n'est pas `active`, donc une recette activee d'office pourrait etre
        // produite avant d'avoir ete relue.
        statut: 'brouillon',
        typePate: saisie.typePate,
        sansGluten: saisie.sansGluten,
        rendementReferenceMl: saisie.rendementReferenceMl,
        rendementReferenceCrepes: saisie.rendementReferenceCrepes,
        perteCuissonBp: saisie.perteCuissonBp,
        tauxCasseBp: saisie.tauxCasseBp,
        perteFixeMl: saisie.perteFixeMl,
        procede: saisie.procede,
        dateActivation: null,
        notes: saisie.notes,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .returning()
      .get();

    ecrireLignes(baseTx, id, saisie);

    journaliser(baseTx, {
      table: 'recette',
      enregistrementId: id,
      action: 'creation',
      valeurApres: { ...cree, lignes: lignesDe(baseTx, id) },
      parQui: parQui ?? null,
    });

    return id;
  });
}

/**
 * Modifie une recette EN PLACE. Refuse des qu'elle a servi.
 *
 * LE CAS QUI COMPTE : R2, semee vide et en brouillon, n'a jamais produit. La
 * remplir est donc une MODIFICATION, pas une nouvelle version — et c'est le
 * seul choix defendable. Versionner une recette vide creerait une v1 sans
 * aucune ligne, definitivement figee, que rien dans l'application ne pourrait
 * expliquer ; elle resterait de surcroit la cible des `produit_vente` qui la
 * pointent, donc les produits sans gluten resteraient accroches a une coquille.
 *
 * Des la premiere production en revanche, la recette est SCELLEE : la modifier
 * reecrirait le cout matiere de pieces comptables (D-005). On refuse alors avec
 * un message qui porte le nombre de productions concernees et nomme le geste de
 * remplacement.
 */
export function modifierRecette(
  base: BaseBatte,
  id: string,
  saisie: SaisieRecette,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(recette).where(eq(recette.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Recette', id);

    const productions = nbProductions(baseTx, id);
    if (productions > 0) {
      throw new ErreurMetier(
        'recette_scellee',
        `${avant.code} v${avant.version} a déjà servi à ${productions} production(s). ` +
          'La modifier réécrirait leur coût matière, qui est une pièce comptable. ' +
          `Créez la version ${avant.version + 1} : les productions passées resteront ` +
          'rattachées à la version qui a réellement été utilisée.',
      );
    }

    if (avant.statut === 'archivee') {
      throw new ErreurMetier(
        'recette_archivee',
        `${avant.code} v${avant.version} est archivée : une version archivée ne se modifie plus. ` +
          'Créez une nouvelle version à partir d’elle.',
      );
    }

    verifierCodeVersionLibre(baseTx, saisie.code, avant.version, id);
    for (const ligne of saisie.lignes) verifierIngredientExiste(baseTx, ligne.ingredientId);
    verifierCoherenceSansGluten(baseTx, saisie);

    const lignesAvant = lignesDe(baseTx, id);
    const notesConservees = notesTechniquesExistantes(baseTx, id);

    const apres = baseTx
      .update(recette)
      .set({
        code: saisie.code,
        nom: saisie.nom,
        typePate: saisie.typePate,
        sansGluten: saisie.sansGluten,
        rendementReferenceMl: saisie.rendementReferenceMl,
        rendementReferenceCrepes: saisie.rendementReferenceCrepes,
        perteCuissonBp: saisie.perteCuissonBp,
        tauxCasseBp: saisie.tauxCasseBp,
        perteFixeMl: saisie.perteFixeMl,
        procede: saisie.procede,
        notes: saisie.notes,
        modifieLe: maintenantUtc(),
      })
      .where(eq(recette.id, id))
      .returning()
      .get();

    /**
     * LE SEUL `DELETE` DE CE FICHIER, et il est borne a une recette qui n'a
     * JAMAIS produit — le controle ci-dessus vient de le garantir. Une ligne de
     * recette non servie est un brouillon, pas une piece : la regle 7 protege
     * ce qui a ete engage (mouvements, sessions, ecritures), pas la composition
     * qu'on est en train d'ecrire. La composition anterieure complete part
     * quand meme au journal d'audit ci-dessous, donc rien n'est perdu.
     */
    baseTx.delete(recetteLigne).where(eq(recetteLigne.recetteId, id)).run();
    ecrireLignes(baseTx, id, saisie, notesConservees);

    journaliser(baseTx, {
      table: 'recette',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: { ...avant, lignes: lignesAvant },
      valeurApres: { ...apres, lignes: lignesDe(baseTx, id) },
      parQui: parQui ?? null,
    });
  });
}

export type ResultatVersionRecetteDepot = {
  id: string;
  code: string;
  version: number;
  recetteParentId: string;
  produitsSurVersionPrecedente: number;
};

/**
 * Cree la version suivante d'une recette (D-005), et archive la precedente.
 *
 * `recette.recette_parent_id` etait une colonne MORTE (docs/13 §3.2 : « jamais
 * ecrite — le versionnage D-005 n'est pas implemente »). C'est ici qu'elle
 * prend son sens : elle chaine les versions, donc elle repond a « d'ou vient
 * cette v3 ? » sans se fier au code, qui n'est pas une cle.
 *
 * Le code NE PEUT PAS changer d'une version a l'autre : `(code, version)` est
 * l'identifiant fonctionnel de la lignee. Changer le code, c'est creer une
 * autre recette — et le refus le dit plutot que de fabriquer une lignee
 * incoherente.
 */
export function creerVersionRecette(
  base: BaseBatte,
  parentId: string,
  saisie: SaisieRecette,
  parQui?: string,
): ResultatVersionRecetteDepot {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const parent = baseTx.select().from(recette).where(eq(recette.id, parentId)).get();
    if (parent === undefined) throw new ErreurIntrouvable('Recette', parentId);

    if (saisie.code !== parent.code) {
      throw new ErreurMetier(
        'code_version_divergent',
        `Une nouvelle version garde le code de sa lignée : « ${parent.code} », pas ` +
          `« ${saisie.code} ». Pour un code différent, créez une nouvelle recette.`,
        { champs: { code: `Conservez « ${parent.code} ».` } },
      );
    }

    for (const ligne of saisie.lignes) verifierIngredientExiste(baseTx, ligne.ingredientId);
    verifierCoherenceSansGluten(baseTx, saisie);

    // Les notes techniques de la version precedente suivent la lignee : aucun
    // ecran ne les affiche encore, donc versionner ne doit pas les perdre.
    const notesConservees = notesTechniquesExistantes(baseTx, parentId);

    // La version suivante se calcule sur TOUTE la lignee, pas sur le parent :
    // versionner deux fois la meme v1 doit donner v2 puis v3, jamais deux v2 —
    // que l'index unique `(code, version)` refuserait de toute facon.
    const maximum = baseTx
      .select({ valeur: sql<number>`max(${recette.version})` })
      .from(recette)
      .where(eq(recette.code, parent.code))
      .get();
    const version = (maximum?.valeur ?? parent.version) + 1;

    verifierCodeVersionLibre(baseTx, parent.code, version);

    const cree = baseTx
      .insert(recette)
      .values({
        id,
        code: parent.code,
        nom: saisie.nom,
        version,
        recetteParentId: parentId,
        // La nouvelle version prend la place de l'ancienne DANS LA MEME
        // transaction : sans cela, il existerait un instant ou aucune version
        // n'est produisible, et l'ecran Production serait vide.
        statut: 'active',
        typePate: saisie.typePate,
        sansGluten: saisie.sansGluten,
        rendementReferenceMl: saisie.rendementReferenceMl,
        rendementReferenceCrepes: saisie.rendementReferenceCrepes,
        perteCuissonBp: saisie.perteCuissonBp,
        tauxCasseBp: saisie.tauxCasseBp,
        perteFixeMl: saisie.perteFixeMl,
        procede: saisie.procede,
        dateActivation: maintenant,
        notes: saisie.notes,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .returning()
      .get();

    ecrireLignes(baseTx, id, saisie, notesConservees);

    journaliser(baseTx, {
      table: 'recette',
      enregistrementId: id,
      action: 'creation',
      valeurApres: { ...cree, lignes: lignesDe(baseTx, id) },
      parQui: parQui ?? null,
    });

    if (parent.statut === 'active') {
      const parentArchive = baseTx
        .update(recette)
        .set({ statut: 'archivee', modifieLe: maintenant })
        .where(eq(recette.id, parentId))
        .returning()
        .get();

      journaliser(baseTx, {
        table: 'recette',
        enregistrementId: parentId,
        action: 'modification',
        valeurAvant: parent,
        valeurApres: parentArchive,
        parQui: parQui ?? null,
      });
    }

    return {
      id,
      code: parent.code,
      version,
      recetteParentId: parentId,
      /**
       * `produit_vente.recette_id` pointe une VERSION precise. Les produits
       * restent donc accroches a la version qu'on vient d'archiver. On ne les
       * redirige PAS en silence — repointer un produit change ce qui sera
       * consomme au prochain marche, c'est une decision, pas un effet de bord —
       * mais on rend le compte, sans quoi personne ne le decouvrirait.
       */
      produitsSurVersionPrecedente: nbProduitsSurRecette(baseTx, parentId),
    };
  });
}

/**
 * Change le statut d'une recette.
 *
 * INDISPENSABLE, et pas cosmetique : `lancerProduction` refuse toute recette qui
 * n'est pas `active`. Sans ce geste, remplir R2 n'aurait servi a rien — elle
 * serait restee un brouillon inproductible. Rendre la saisie possible sans
 * rendre la recette utilisable, c'est refermer le trou a moitie.
 */
export function changerStatutRecette(
  base: BaseBatte,
  id: string,
  statut: StatutRecette,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(recette).where(eq(recette.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Recette', id);

    if (statut === 'active') {
      /**
       * Une recette vide activee serait produisible a l'ecran et echouerait a
       * `mettreAEchelle` (`recette_vide`) au moment du lancement — c'est-a-dire
       * le samedi soir, devant une bassine. Le message porte le compte.
       */
      const nbLignes = nombre(
        baseTx
          .select({ valeur: count() })
          .from(recetteLigne)
          .where(eq(recetteLigne.recetteId, id))
          .get(),
      );
      if (nbLignes === 0) {
        throw new ErreurMetier(
          'recette_vide',
          `${avant.code} v${avant.version} ne contient aucun ingrédient (0 ligne) : ` +
            "elle ne peut pas être activée. Saisissez sa composition d'abord.",
        );
      }

      // Deux versions actives du meme code se disputeraient l'ecran Production
      // et les produits de vente. On refuse plutot que d'archiver l'autre en
      // douce : archiver une recette est une decision, pas un effet de bord.
      const autreActive = baseTx
        .select({ version: recette.version })
        .from(recette)
        .where(and(eq(recette.code, avant.code), eq(recette.statut, 'active'), ne(recette.id, id)))
        .get();
      if (autreActive !== undefined) {
        throw new ErreurMetier(
          'version_active_existante',
          `${avant.code} v${autreActive.version} est déjà active. Archivez-la d'abord : ` +
            'deux versions actives du même code rendraient ambigu ce qui est produit.',
        );
      }
    }

    const apres = baseTx
      .update(recette)
      .set({
        statut,
        // `date_activation` n'est ecrite qu'a la PREMIERE activation : c'est la
        // date d'entree en service de cette version, pas celle du dernier clic.
        dateActivation:
          statut === 'active' && avant.dateActivation === null
            ? maintenantUtc()
            : avant.dateActivation,
        modifieLe: maintenantUtc(),
      })
      .where(eq(recette.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'recette',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Lieux de marche
   ═══════════════════════════════════════════════════════════════════════════ */

export type LieuCompletLigne = {
  id: string;
  nom: string;
  adresse: string | null;
  latitude: number | null;
  longitude: number | null;
  jourSemaine: number | null;
  heureDebut: string | null;
  heureFin: string | null;
  tarifEmplacementCents: number | null;
  modeTarification: 'metre_lineaire_mois' | 'jour' | 'forfait' | null;
  metresLineaires: number | null;
  /** Distance routière aller simple, en km (fiche 13). `null` = non renseignée. */
  distanceKm: number | null;
  facturationElectricite: 'compteur' | 'forfait' | 'comprise' | 'aucune' | null;
  puissanceDisponibleW: number | null;
  notes: string | null;
  actif: boolean;
  nbSessions: number;
};

/**
 * Tous les lieux, ACTIFS ET INACTIFS, avec leurs coordonnees.
 *
 * `GET /api/lieux` (routes/sessions.ts) ne rend que les actifs et cinq
 * colonnes — ni latitude, ni longitude, alors que ce sont elles que le moteur
 * de prevision passe a Open-Meteo. On ajoute a cote, on ne la modifie pas :
 * `Sessions.tsx` en depend.
 */
export function listerLieuxComplets(base: BaseBatte): LieuCompletLigne[] {
  const sessions = new Map(
    base
      .select({ lieuId: sessionMarche.lieuId, valeur: count() })
      .from(sessionMarche)
      .groupBy(sessionMarche.lieuId)
      .all()
      .map((ligne) => [ligne.lieuId, ligne.valeur]),
  );

  return base
    .select()
    .from(lieuMarche)
    .orderBy(asc(lieuMarche.nom))
    .all()
    .map((ligne) => ({
      id: ligne.id,
      nom: ligne.nom,
      adresse: ligne.adresse,
      latitude: ligne.latitude,
      longitude: ligne.longitude,
      jourSemaine: ligne.jourSemaine,
      heureDebut: ligne.heureDebut,
      heureFin: ligne.heureFin,
      tarifEmplacementCents: ligne.tarifEmplacementCents,
      modeTarification: ligne.modeTarification,
      metresLineaires: ligne.metresLineaires,
      distanceKm: ligne.distanceKm,
      facturationElectricite: ligne.facturationElectricite,
      puissanceDisponibleW: ligne.puissanceDisponibleW,
      notes: ligne.notes,
      actif: ligne.actif,
      nbSessions: sessions.get(ligne.id) ?? 0,
    }));
}

export function creerLieu(base: BaseBatte, saisie: SaisieLieu, parQui?: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const cree = baseTx
      .insert(lieuMarche)
      .values({ id, ...saisie, actif: true, creeLe: maintenant, modifieLe: maintenant })
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'lieu_marche',
      enregistrementId: id,
      action: 'creation',
      valeurApres: cree,
      parQui: parQui ?? null,
    });

    return id;
  });
}

export function modifierLieu(
  base: BaseBatte,
  id: string,
  saisie: SaisieLieu,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(lieuMarche).where(eq(lieuMarche.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Lieu de marché', id);

    const apres = baseTx
      .update(lieuMarche)
      .set({ ...saisie, modifieLe: maintenantUtc() })
      .where(eq(lieuMarche.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'lieu_marche',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/**
 * Le remplacant de la suppression : des sessions clôturees referencent ce lieu,
 * et ce sont des pieces comptables conservees dix ans.
 */
export function changerActiviteLieu(
  base: BaseBatte,
  id: string,
  actif: boolean,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(lieuMarche).where(eq(lieuMarche.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Lieu de marché', id);

    const apres = baseTx
      .update(lieuMarche)
      .set({ actif, modifieLe: maintenantUtc() })
      .where(eq(lieuMarche.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'lieu_marche',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}
