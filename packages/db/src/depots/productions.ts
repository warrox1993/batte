/**
 * Lecture des productions et de leurs consommations.
 *
 * Le depot assemble, il ne calcule pas : l'ecart de rendement vient de
 * `ecartRendementBp` de `@batte/core`, en fonction pure et testee.
 */

import { ecartRendementBp, ratioEnPointsDeBase } from '@batte/core';
import { and, desc, eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  ingredient,
  lot,
  mouvementStock,
  prevision,
  production,
  productionConsommation,
  recette,
} from '../schema.js';

/** Liste des productions, de la plus recente a la plus ancienne. */
export function listerProductions(base: BaseBatte) {
  return base
    .select({
      id: production.id,
      numero: production.numero,
      recetteCode: recette.code,
      recetteNom: recette.nom,
      dateProduction: production.dateProduction,
      statut: production.statut,
      volumeTheoriqueMl: production.volumeTheoriqueMl,
      crepesTheoriques: production.crepesTheoriques,
      volumeReelMl: production.volumeReelMl,
      crepesReelles: production.crepesReelles,
      coutMatiereTheoriqueCents: production.coutMatiereTheoriqueCents,
      // Ecrit par `saisirRealise`, lu par la cloture de session — donc DEJA
      // facture a la marge du marche — et expose par aucune route jusqu'au
      // 01/08/2026. Voir `schemaProductionResume` pour le detail du defaut.
      coutMatiereReelCents: production.coutMatiereReelCents,
      numeroLotPate: production.numeroLotPate,
      dateDlcPate: production.dateDlcPate,
    })
    .from(production)
    .innerJoin(recette, eq(production.recetteId, recette.id))
    .orderBy(desc(production.dateProduction), desc(production.numero))
    .all();
}

/**
 * Detail d'une production, tel que rendu par `lireProductionDetail`.
 *
 * Type de retour EXPLICITE (et non infere) : une fonction de depot sans
 * annotation peut elargir une projection sans que `tsc` ne le remarque — la
 * violation du contrat Zod (`schemaProductionDetail`) ne sortirait alors qu'en
 * 422 au premier appel HTTP, jamais a la compilation (audit du 30/07/2026).
 */
export type ProductionDetailLue = {
  id: string;
  numero: string;
  recetteCode: string;
  recetteNom: string;
  dateProduction: string;
  statut: (typeof production.$inferSelect)['statut'];
  volumeTheoriqueMl: number;
  crepesTheoriques: number;
  volumeReelMl: number | null;
  crepesReelles: number | null;
  coutMatiereTheoriqueCents: number;
  /** `null` tant que le realise n'est pas saisi — jamais un zero. */
  coutMatiereReelCents: number | null;
  numeroLotPate: string;
  dateDlcPate: string;
  ecartMotif: string | null;
  notes: string | null;
  consommations: {
    lotId: string;
    ingredientId: string;
    nomIngredient: string;
    unite: (typeof ingredient.$inferSelect)['uniteReference'];
    numeroLotFournisseur: string | null;
    quantiteTheorique: number;
    quantiteReelle: number | null;
    coutCents: number;
    /**
     * Declares REQUIS ici (et non `?:`), et desormais requis aussi au contrat
     * Zod (`schemaConsommationProduction`, `@batte/core`, 01/08/2026) : les deux
     * gardes se renforcent au lieu de se remplacer. Cette annotation-ci est ce
     * qui force `tsc` a verifier que le depot FOURNIT le champ ; le contrat est
     * ce qui fait rendre 422 a la route s'il cesse de le faire. Tant que le
     * contrat portait `.optional()`, cette annotation etait la seule chose entre
     * le depot et une suppression SILENCIEUSE a la frontiere HTTP (docs/39 §5).
     *
     * `quantiteMouvementee` porte le meme nom que son homonyme des contrats
     * AFSCA depuis le 01/08/2026 : c'est la meme grandeur, le meme grand livre
     * — voir `schemaConsommationProduction.quantiteMouvementee`.
     */
    quantiteMouvementee: number | null;
    coutReelCents: number | null;
  }[];
  ecartRendementBp: number | null;
  /**
   * Prevision retenue au lancement (`production.ordre_prevision_id`), et sa
   * relecture (docs/03, D-058) : `null` = decidee sans prevision, un cas
   * normal, pas une donnee manquante. Voir `schemaProductionDetail`
   * (`@batte/core`) pour la justification complete.
   */
  previsionId: string | null;
  previsionDateCalcul: string | null;
  previsionP50Crepes: number | null;
  previsionCrepesRetenues: number | null;
  ecartVsPrevisionBp: number | null;
  /** Voir `schemaProductionDetail` (`@batte/core`) : garant de l'invariant de somme. */
  coutMatiereReelNonAffecteCents: number | null;
};

/** Net signe d'un couple (ingredient, lot) dans le grand livre d'une production. */
type NetLotProduction = { quantite: number; coutCents: number };

/**
 * Grand livre d'UNE production : le net, lot par lot, des mouvements de stock
 * que cette production a reellement ecrits.
 *
 * POURQUOI PASSER PAR LES MOUVEMENTS plutot que recalculer un cout par ligne.
 * `saisirRealise` (`services/production.ts`) construit `cout_matiere_reel_cents`
 * ainsi, et pas autrement :
 *
 *   somme(production_consommation.cout_cents)        <- ecrit au lancement
 *   + somme(cout des sorties d'ecart, FEFO du jour)  <- sur-consommation
 *   - somme(cout des restitutions aux lots)          <- sous-consommation
 *
 * Chacun de ces termes est AUSSI un mouvement, au centime pres : les valeurs
 * inserees dans `mouvement_stock` sont litteralement celles qui alimentent la
 * somme (`allocation.coutCents`, `coutCentsLigne`). Rejouer la meme somme
 * depuis les mouvements redonne donc EXACTEMENT le total deja facture a la
 * marge du marche. Tout autre calcul — « quantite reelle x prix unitaire du
 * lot » par exemple — reintroduirait un arrondi la ou le service en avait fait
 * deux (un par mouvement), et la somme des lignes manquerait le total de
 * quelques centimes. Un mouvement de stock a 29,73 c n'existe pas : c'est
 * `Math.round` qui decide, mouvement par mouvement.
 *
 * DEUX FILTRES, chacun indispensable :
 *
 *  - `production_id = ?` : `lancerProduction` et `saisirRealise` sont les seuls
 *    chemins qui posent cette colonne sur un mouvement (verifie : la seule
 *    autre ecriture qui la renseigne est une contrepassation, qui la RECOPIE de
 *    son original ; `enregistrerSortie` n'est appele qu'avec `productionId`
 *    absent, depuis `routes/stock.ts`).
 *  - `ajustement = false` : ecarte precisement ces contrepassations. Une
 *    production annulee garde son `cout_matiere_reel_cents` d'origine —
 *    `annulerProduction` contrepasse le stock mais ne reecrit PAS ce champ.
 *    Sans ce filtre, la somme des lignes retomberait a zero face a un total
 *    inchange, et l'ecran afficherait deux verites contradictoires sur la meme
 *    fiche. Ce filtre garde donc l'ECRITURE D'ORIGINE, `is_annule` compris :
 *    c'est bien elle que la comptabilite a retenue.
 */
function grandLivreProduction(
  base: BaseBatte,
  productionId: string,
): Map<string, NetLotProduction> {
  const mouvements = base
    .select({
      lotId: mouvementStock.lotId,
      ingredientId: mouvementStock.ingredientId,
      type: mouvementStock.type,
      quantite: mouvementStock.quantite,
      coutCents: mouvementStock.coutCents,
    })
    .from(mouvementStock)
    .where(and(eq(mouvementStock.productionId, productionId), eq(mouvementStock.ajustement, false)))
    .all();

  const net = new Map<string, NetLotProduction>();
  for (const m of mouvements) {
    const cle = cleLot(m.ingredientId, m.lotId);
    // La quantite est toujours positive en base, le SIGNE est porte par le
    // type (voir `schema.ts`). Une `entree` rattachee a une production est une
    // RESTITUTION de sous-consommation : elle retire du cout, elle n'en ajoute
    // pas.
    const signe = m.type === 'entree' ? -1 : 1;
    const courant = net.get(cle) ?? { quantite: 0, coutCents: 0 };
    net.set(cle, {
      quantite: courant.quantite + signe * m.quantite,
      coutCents: courant.coutCents + signe * m.coutCents,
    });
  }
  return net;
}

/**
 * Cle d'agregation du grand livre.
 *
 * Le couple (ingredient, lot) identifie une ligne de `production_consommation`
 * SANS ambiguite : `recette_ligne` porte un index unique sur
 * (recette_id, ingredient_id), donc un ingredient n'apparait qu'une fois dans
 * une recette, et `repartirFefo` n'alloue qu'une fois par lot. Deux lignes ne
 * peuvent donc pas partager cette cle.
 */
function cleLot(ingredientId: string, lotId: string): string {
  return `${ingredientId} ${lotId}`;
}

/**
 * Detail d'une production, consommations comprises.
 *
 * Les consommations sont jointes au LOT et a l'INGREDIENT : c'est ce qui permet
 * de remonter d'une production jusqu'au numero de lot du fournisseur, exigence
 * de tracabilite du Lot 8.
 */
export function lireProductionDetail(base: BaseBatte, id: string): ProductionDetailLue | null {
  const entete = base
    .select({
      production,
      recetteCode: recette.code,
      recetteNom: recette.nom,
      perteCuissonBp: recette.perteCuissonBp,
      tauxCasseBp: recette.tauxCasseBp,
    })
    .from(production)
    .innerJoin(recette, eq(production.recetteId, recette.id))
    .where(eq(production.id, id))
    .get();

  if (entete === undefined) return null;

  const consommations = base
    .select({
      lotId: productionConsommation.lotId,
      ingredientId: productionConsommation.ingredientId,
      nomIngredient: ingredient.nom,
      unite: ingredient.uniteReference,
      numeroLotFournisseur: lot.numeroLotFournisseur,
      quantiteTheorique: productionConsommation.quantiteTheorique,
      quantiteReelle: productionConsommation.quantiteReelle,
      coutCents: productionConsommation.coutCents,
    })
    .from(productionConsommation)
    .innerJoin(ingredient, eq(productionConsommation.ingredientId, ingredient.id))
    .innerJoin(lot, eq(productionConsommation.lotId, lot.id))
    .where(eq(productionConsommation.productionId, id))
    .orderBy(ingredient.nom)
    .all();

  const p = entete.production;

  /**
   * Un cout REEL par ligne n'existe que si le realise a ete saisi. Le
   * discriminant est `cout_matiere_reel_cents`, et non `statut === 'lancee'` :
   * une production ANNULEE avant tout realise n'est plus `lancee` et n'a
   * pourtant toujours aucun reel — c'est la colonne du total qui dit la
   * verite, et c'est aussi elle que la somme des lignes doit retrouver.
   */
  const reelSaisi = p.coutMatiereReelCents !== null;
  const grandLivre = reelSaisi
    ? grandLivreProduction(base, id)
    : new Map<string, NetLotProduction>();

  const consommationsValorisees = consommations.map((c) => {
    const cle = cleLot(c.ingredientId, c.lotId);
    const net = grandLivre.get(cle);
    // Retire au fur et a mesure : ce qui RESTE dans la carte a la fin est,
    // par construction, ce qu'aucune ligne ne peut porter.
    grandLivre.delete(cle);
    return {
      ...c,
      // `?? null` et jamais `?? 0` : une ligne sans mouvement correspondant
      // serait une incoherence (les deux sont ecrits dans la meme boucle de
      // `lancerProduction`), et un zero s'y lirait « ce lot n'a rien coute ».
      quantiteMouvementee: net?.quantite ?? null,
      coutReelCents: net?.coutCents ?? null,
    };
  });

  // Reliquat : les mouvements poses sur des lots que cette fournee n'avait pas
  // consommes au lancement (sur-consommation servie en FEFO par un autre lot).
  // Ce terme est ce qui fait tenir « somme des lignes + reliquat = total »
  // PAR CONSTRUCTION. `0` quand tout est rattachable, et c'est un vrai zero.
  const coutMatiereReelNonAffecteCents = reelSaisi
    ? [...grandLivre.values()].reduce((total, n) => total + n.coutCents, 0)
    : null;

  // Prevision retenue au lancement (docs/03, D-058) : `null` des que la
  // production n'en portait aucune, cas normal (decidee sans prevision).
  // Requete SEPAREE plutot qu'un `leftJoin` sur la requete d'entete
  // ci-dessus : `production.ordre_prevision_id` n'est pas indexe (une seule
  // production par prevision, jamais une jointure de masse), et separer
  // evite de complexifier une projection deja large d'un `leftJoin`
  // conditionnel pour le cas, tres frequent, ou aucune prevision n'est
  // rattachee.
  const previsionRattachee =
    p.ordrePrevisionId === null
      ? null
      : (base
          .select({
            dateCalcul: prevision.dateCalcul,
            p50Crepes: prevision.p50Crepes,
            crepesRetenues: prevision.crepesRetenues,
          })
          .from(prevision)
          .where(eq(prevision.id, p.ordrePrevisionId))
          .get() ?? null);

  // Ecart SIGNE entre ce qui a ete DECIDE (crepesTheoriques, fige au
  // lancement) et ce que le modele suggerait CE soir-la, APRES ecretage par
  // les contraintes dures (crepesRetenues, jamais le p50 brut qui les
  // ignore) — c'est la mesure qui repond a « le porteur a-t-il suivi le
  // modele, et de combien s'en est-il ecarte ». `null` sans prevision
  // rattachee, ou si celle-ci portait sur zero crepe retenue (ratio sans
  // sens) : jamais un zero invente (CLAUDE.md §7).
  const ecartVsPrevisionBp =
    previsionRattachee !== null && previsionRattachee.crepesRetenues > 0
      ? ratioEnPointsDeBase(
          p.crepesTheoriques - previsionRattachee.crepesRetenues,
          previsionRattachee.crepesRetenues,
        )
      : null;

  return {
    id: p.id,
    numero: p.numero,
    recetteCode: entete.recetteCode,
    recetteNom: entete.recetteNom,
    dateProduction: p.dateProduction,
    statut: p.statut,
    volumeTheoriqueMl: p.volumeTheoriqueMl,
    crepesTheoriques: p.crepesTheoriques,
    volumeReelMl: p.volumeReelMl,
    crepesReelles: p.crepesReelles,
    coutMatiereTheoriqueCents: p.coutMatiereTheoriqueCents,
    // `null` tant que le realise n'est pas saisi — jamais un zero, qui se
    // lirait « cette production n'a rien coute » (voir le contrat Zod).
    coutMatiereReelCents: p.coutMatiereReelCents,
    numeroLotPate: p.numeroLotPate,
    dateDlcPate: p.dateDlcPate,
    ecartMotif: p.ecartMotif,
    notes: p.notes,
    consommations: consommationsValorisees,
    coutMatiereReelNonAffecteCents,
    // `null` tant que le realise n'est pas saisi : on ne peut pas mesurer un
    // ecart contre une valeur qui n'existe pas encore.
    ecartRendementBp:
      p.crepesReelles === null
        ? null
        : ecartRendementBp(p.crepesReelles, p.crepesTheoriques, {
            perteCuissonBp: entete.perteCuissonBp,
            tauxCasseBp: entete.tauxCasseBp,
          }),
    previsionId: p.ordrePrevisionId,
    previsionDateCalcul: previsionRattachee?.dateCalcul ?? null,
    previsionP50Crepes: previsionRattachee?.p50Crepes ?? null,
    previsionCrepesRetenues: previsionRattachee?.crepesRetenues ?? null,
    ecartVsPrevisionBp,
  };
}

/*
 * `productionsDuLot` RETIRÉE le 01/08/2026 — et elle a failli l'être à tort.
 *
 * Elle rendait la tracabilite AVAL (« de quel lot fournisseur partent quelles
 * productions »), sans aucun appelant, et figurait a ce titre sur une liste de
 * morts-nes a supprimer. Verification faite AVANT retrait : ce n'etait pas un
 * doublon de `tracabiliteAvalLot` — elle portait `numeroLotPate`, que le schema
 * appelle lui-meme « le lien qui rend la tracabilite bidirectionnelle
 * possible », et que sa remplacante OMETTAIT entierement.
 *
 * Autrement dit, la capacite de repondre a « quel lot de pate est issu d'une
 * production ayant consomme ce lot d'ingredient rappele ? » n'existait que
 * dans la fonction morte. C'est un geste de RAPPEL SANITAIRE (§3 regle 6 :
 * « obligation reglementaire, pas une elegance technique »).
 *
 * L'ordre a suivi : le champ a d'abord ete porte dans `tracabiliteAvalLot`
 * (`depots/tracabilite.ts`), puis dans le contrat Zod — qui le supprimait
 * SILENCIEUSEMENT a la frontiere HTTP faute de le declarer —, puis affiche au
 * registre AFSCA. Ce n'est qu'apres, la chaine complete etant prouvee par un
 * test de bout en bout, que cette fonction est devenue un vrai sous-ensemble
 * et que son retrait est devenu sans perte.
 *
 * LA LEÇON, et elle vaut plus que la suppression : un premier balayage de
 * morts-nes s'est trompe une fois sur trois, et l'erreur portait sur une
 * obligation reglementaire. « Zero appelant » n'est pas « inutile » — c'est une
 * question a poser, pas une conclusion.
 */
