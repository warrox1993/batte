/**
 * Depot de stock.
 *
 * Regle d'architecture n°5 : **le stock est la somme de ses mouvements**. Aucune
 * requete de ce fichier ne lit une quantite stockee — le restant d'un lot est
 * toujours `quantite_initiale - somme des sorties non annulees`.
 *
 * docs/02 prevoyait des VUES SQL (`v_lot_restant`, `v_stock_courant`). On les
 * calcule ici en requete plutot qu'en vue : meme resultat, une migration de
 * moins a maintenir, et le calcul reste testable en TypeScript. Ecart assume,
 * consigne en D-020.
 */

import {
  calculerCump,
  lotsProchesDlc,
  quantiteDisponible,
  valoriserStock,
  type LotStock,
} from '@batte/core';
import { eq, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { ingredient, lot, motif, mouvementStock, reception } from '../schema.js';

/**
 * Restant d'un lot : somme signee de ses mouvements non annules.
 *
 * La quantite est TOUJOURS stockee positive ; c'est le TYPE qui porte le sens,
 * d'ou le `CASE`. Un `SUM(quantite)` naif melangerait entrees et sorties.
 *
 * **Les mouvements annules NE sont PAS exclus.** C'est contre-intuitif et c'est
 * pourtant la seule arithmetique juste : une contrepassation ecrit une SECONDE
 * ecriture de sens inverse, et les deux restent au journal. Les exclure en plus
 * reviendrait a rendre la matiere DEUX FOIS. `is_annule` sert a l'AFFICHAGE
 * (barrer la ligne), jamais au calcul — c'est exactement ce que font les ERP :
 * « les cumuls augmentent des deux cotes » (docs/07 §1.4).
 *
 * Les identifiants sont ecrits en clair avec un ALIAS `m`, et non interpoles
 * depuis le schema Drizzle. Raison : dans un gabarit `sql`, Drizzle ne qualifie
 * PAS systematiquement les colonnes — `${mouvementStock.lotId} = ${lot.id}`
 * produit `WHERE "lot_id" = "id"`, et dans une sous-requete dont le FROM est
 * `mouvement_stock`, `"id"` resout vers `mouvement_stock.id`. La correlation est
 * alors rompue en silence et la somme rend toujours 0, sans qu'aucun type ne
 * proteste. L'alias explicite supprime toute ambiguite.
 */
const SQL_RESTANT = sql<number>`COALESCE((
  SELECT SUM(CASE m."type" WHEN 'entree' THEN 1 ELSE -1 END * m."quantite")
  FROM "mouvement_stock" m
  WHERE m."lot_id" = "lot"."id"
), 0)`;

/**
 * Nombre de lots nes de la MEME reception que celui-ci, lui compris.
 *
 * Une reception est une PIECE : le meunier livre la farine, le sel et le sucre
 * dans la meme camionnette, sous un seul bon de livraison, et l'annuler
 * contrepasse l'entree de TOUS ses lots d'un coup (`annulerReception`,
 * `services/reception.ts`, qui transactionne autour de la boucle). Un ecran
 * qui propose ce geste depuis UN lot doit donc pouvoir annoncer ce nombre
 * AVANT la confirmation — sans quoi le porteur croit corriger une ligne et en
 * corrige trois.
 *
 * Alias `l2` explicite, meme precaution que `SQL_RESTANT` ci-dessus : sans lui,
 * `"lot"."reception_id"` resoudrait vers la table de la sous-requete et la
 * correlation serait rompue EN SILENCE (le compte vaudrait alors le nombre
 * total de lots de la base, sans qu'aucun type ne proteste — D-020).
 */
const SQL_NB_LOTS_RECEPTION = sql<number>`(
  SELECT COUNT(*)
  FROM "lot" l2
  WHERE l2."reception_id" = "lot"."reception_id"
)`;

/**
 * Un lot tel qu'il vit EN BASE : le contrat pur de `@batte/core`, plus les deux
 * grandeurs entieres dont ce taux est issu.
 *
 * `LotStock.prixUnitaireCents` est un taux fractionnaire, utile aux calculs mais
 * intransmissible a un comptable. `prixLigneCents` est le montant reellement
 * paye, au centime : c'est lui qu'on rapproche de la facture fournisseur, et
 * c'est lui qu'un ecran doit afficher.
 */
export type LotEnBase = LotStock & {
  readonly quantiteInitiale: number;
  readonly prixLigneCents: number;
  /**
   * Statut de la RÉCEPTION d'origine du lot (`active` ou `annulee`), et non
   * celui du lot lui-même (`lot.statut`, `disponible`/`quarantaine`/…) : les
   * deux colonnes sont indépendantes. Ajoutée le 30/07/2026, faisait vivre la
   * colonne `reception.statut` écrite par `annulerReception`
   * (`services/reception.ts`) — sans ce champ, aucun écran ne pouvait
   * distinguer un lot d'une réception simplement épuisée d'un lot dont la
   * réception a été ANNULÉE : la quantité restante (0 dans les deux cas)
   * ne le dit pas, seul le statut de la réception le dit.
   */
  readonly receptionStatut: 'active' | 'annulee';
  /**
   * Identifiant technique de la RECEPTION d'origine, et son numero lisible
   * (`RC-2026-0007`). Ajoutes le 31/07/2026 (D-087) : `receptionStatut`
   * ci-dessus permettait deja de DIRE qu'une reception etait annulee, mais
   * rien ne permettait de l'ANNULER — `POST /receptions/:id/annuler` existe,
   * testee, et aucun ecran ne l'appelait faute de connaitre cet identifiant.
   *
   * Aucune route ne LIT les receptions (ni `GET /receptions`, ni liste, ni
   * recherche) : le lot est donc le seul chemin qui mene a la reception qui
   * l'a cree, et c'est aussi le bon — on ne pense pas « je veux annuler
   * RC-2026-0007 », on pense « ces 10 kg de farine n'auraient jamais du
   * entrer ».
   *
   * Le NUMERO est rendu en plus de l'identifiant parce qu'un ecran n'affiche
   * jamais un UUID (docs/07 §6.8 rang 2) : c'est ce numero-la qu'on cite au
   * telephone et qu'on retrouve sur le bon de livraison papier.
   */
  readonly receptionId: string;
  readonly receptionNumero: string;
  /**
   * Nombre de lots crees par cette reception, CELUI-CI COMPRIS (donc toujours
   * >= 1). Voir `SQL_NB_LOTS_RECEPTION` ci-dessus : annuler la reception les
   * contrepasse TOUS, et l'ecran doit l'annoncer avant la confirmation.
   */
  readonly receptionNbLots: number;
  /**
   * Motif et date du DERNIER changement de statut de ce lot
   * (`lot.motif_statut_id`, `lot.date_changement_statut`), écrits à CHAQUE
   * appel de `changerStatutLot` (`services/mouvements.ts`) — c'est la trace
   * exacte qu'un contrôle AFSCA vient chercher : pourquoi ce lot a-t-il été
   * mis en quarantaine, bloqué ou détruit, et quand.
   *
   * DÉFAUT CORRIGÉ (audit du 30/07/2026, `audit-colonnes-orphelines.test.ts`) :
   * ces deux colonnes étaient écrites à chaque changement de statut sans être
   * exposées nulle part, ni ici ni sur le registre imprimé.
   *
   * `motifStatutLibelle` ne porte que le motif du DERNIER changement — le
   * commentaire de `changerStatutLot` le dit lui-même : « l'historique
   * complet vit dans journal_audit ». Un lot mis en quarantaine PUIS relâché
   * affiche donc ici le motif et la date du RELÂCHEMENT, pas de la mise en
   * quarantaine : à lire toujours avec `statut`, jamais seul, sous peine de
   * laisser croire qu'un motif de blocage s'applique encore à un lot redevenu
   * `disponible`.
   *
   * `null` sur les deux tant qu'aucun changement de statut n'a jamais eu lieu
   * (cas courant : un lot reste `disponible` depuis sa réception) — jamais un
   * motif fabriqué (CLAUDE.md §7 : une valeur inconnue vaut `null`, jamais un
   * motif qui n'existe pas).
   */
  readonly motifStatutLibelle: string | null;
  readonly dateChangementStatut: string | null;
};

/**
 * Restant de chaque lot d'un ingredient.
 *
 * Les mouvements annules NE sont PAS exclus de la somme (voir `SQL_RESTANT`
 * ci-dessus pour le detail arithmetique) : une contrepassation ecrit une
 * SECONDE ecriture de sens inverse, et les deux cumulent. `is_annule` reste
 * lisible (« rien ne s'efface »), mais sert a l'AFFICHAGE, jamais au calcul.
 *
 * `INNER JOIN reception` : sûr sans exception, `lot.reception_id` est
 * `NOT NULL` (schema.ts) et le SEUL point d'écriture de la table `lot` est
 * `enregistrerReception` (`services/reception.ts`), qui pose toujours cette
 * clé — aucun lot ne peut donc exister sans réception, et cette jointure ne
 * fait donc jamais disparaître silencieusement un lot de la liste.
 */
export function lotsDeLIngredient(base: BaseBatte, ingredientId: string): LotEnBase[] {
  const lignes = base
    .select({
      id: lot.id,
      ingredientId: lot.ingredientId,
      numeroLotFournisseur: lot.numeroLotFournisseur,
      dateDlc: lot.dateDlc,
      dateReception: lot.dateReception,
      quantiteInitiale: lot.quantiteInitiale,
      prixLigneCents: lot.prixLigneCents,
      statut: lot.statut,
      receptionStatut: reception.statut,
      receptionId: reception.id,
      receptionNumero: reception.numero,
      receptionNbLots: SQL_NB_LOTS_RECEPTION,
      // `leftJoin` : `lot.motif_statut_id` est nullable (aucun changement de
      // statut depuis la reception, le cas courant). Un `innerJoin` ferait
      // silencieusement disparaitre ces lots de la liste.
      motifStatutLibelle: motif.libelle,
      dateChangementStatut: lot.dateChangementStatut,
      // L'entree d'origine du lot fait partie de la somme : le restant EST donc
      // cette somme signee, il n'y a rien a ajouter a `quantite_initiale`.
      sommeSignee: SQL_RESTANT,
    })
    .from(lot)
    .innerJoin(reception, eq(lot.receptionId, reception.id))
    .leftJoin(motif, eq(lot.motifStatutId, motif.id))
    .where(eq(lot.ingredientId, ingredientId))
    .all();

  return lignes.map((l) => ({
    id: l.id,
    ingredientId: l.ingredientId,
    numeroLotFournisseur: l.numeroLotFournisseur,
    dateDlc: l.dateDlc,
    dateReception: l.dateReception,
    // La somme signee inclut l'entree initiale : elle EST le restant.
    quantiteRestante: l.sommeSignee,
    quantiteInitiale: l.quantiteInitiale,
    prixLigneCents: l.prixLigneCents,
    // Taux DERIVE du montant paye, jamais lu depuis la base : c'est la regle
    // n°3 appliquee dans le bon sens (on persiste le montant entier, on divise
    // a la lecture). Un lot de quantite initiale nulle ne doit produire ni
    // `Infinity` ni `NaN` : D-034 a montre qu'un tel nombre se propage en
    // silence dans TOUTE la valorisation de stock avant qu'on s'en apercoive.
    prixUnitaireCents: l.quantiteInitiale > 0 ? l.prixLigneCents / l.quantiteInitiale : 0,
    statut: l.statut,
    receptionStatut: l.receptionStatut,
    receptionId: l.receptionId,
    receptionNumero: l.receptionNumero,
    receptionNbLots: l.receptionNbLots,
    motifStatutLibelle: l.motifStatutLibelle,
    dateChangementStatut: l.dateChangementStatut,
  }));
}

/** Tous les lots, tous ingredients confondus. Sert aux ecrans de synthese. */
export function tousLesLots(base: BaseBatte): LotEnBase[] {
  const identifiants = base
    .selectDistinct({ id: lot.ingredientId })
    .from(lot)
    .all()
    .map((l) => l.id);

  return identifiants.flatMap((id) => lotsDeLIngredient(base, id));
}

export type LigneStock = {
  ingredientId: string;
  nom: string;
  unite: 'g' | 'ml' | 'piece';
  stockSecurite: number;
  /** Consommable maintenant : hors quarantaine, blocage, destruction et DLC. */
  quantiteDisponible: number;
  /** Tout ce qui est physiquement la, y compris quarantaine et perime. */
  quantiteTotale: number;
  valeurCents: number;
  /** `null` quand le stock est epuise : zero ferait croire a une marge de 100 %. */
  cumpCentsParUnite: number | null;
  /** DLC la plus proche parmi les lots restants. `null` si aucune. */
  dlcLaPlusProche: string | null;
  nbLots: number;
};

/**
 * Etat de stock par ingredient, pour l'ecran Stock.
 *
 * L'ecran est « un seul tableau dense, trie par urgence » (docs/06 §4) : le tri
 * se fait a l'affichage, pas ici, parce que l'urgence depend de la couverture en
 * sessions, qui depend de l'historique de consommation (Lot 4).
 */
export function etatDuStock(base: BaseBatte, jourReference: string): LigneStock[] {
  const ingredients = base
    .select()
    .from(ingredient)
    .where(eq(ingredient.actif, true))
    .orderBy(ingredient.nom)
    .all();

  return ingredients.map((ing) => {
    const lots = lotsDeLIngredient(base, ing.id);
    const restants = lots.filter((l) => l.quantiteRestante > 0 && l.statut !== 'detruit');

    const dlcs = restants
      .map((l) => l.dateDlc)
      .filter((d): d is string => d !== null)
      .sort();

    return {
      ingredientId: ing.id,
      nom: ing.nom,
      unite: ing.uniteReference,
      stockSecurite: ing.stockSecurite,
      quantiteDisponible: quantiteDisponible(lots, jourReference),
      quantiteTotale: restants.reduce((total, l) => total + l.quantiteRestante, 0),
      valeurCents: valoriserStock(lots, jourReference),
      cumpCentsParUnite: calculerCump(lots),
      dlcLaPlusProche: dlcs[0] ?? null,
      nbLots: restants.length,
    };
  });
}

/** Mouvements d'un lot, du plus recent au plus ancien. Sert a la tracabilite. */
export function mouvementsDuLot(base: BaseBatte, lotId: string) {
  return base
    .select()
    .from(mouvementStock)
    .where(eq(mouvementStock.lotId, lotId))
    .orderBy(sql`${mouvementStock.dateMouvement} DESC`)
    .all();
}

/**
 * Verifie l'invariant n°1 sur TOUS les lots : la somme des sorties d'un lot ne
 * peut pas depasser sa quantite initiale.
 *
 * Expose comme fonction de diagnostic et non comme simple test : c'est le genre
 * de coherence qu'on veut pouvoir controler sur la vraie base, pas seulement
 * sur des donnees de test. Rend les lots fautifs, vide si tout va bien.
 */
export function verifierInvariantLots(
  base: BaseBatte,
): { lotId: string; quantiteInitiale: number; restant: number }[] {
  const lignes = base
    .select({
      lotId: lot.id,
      quantiteInitiale: lot.quantiteInitiale,
      restant: SQL_RESTANT,
    })
    .from(lot)
    .all();

  // Un restant negatif signifie qu'on a sorti plus que recu ; un restant
  // superieur a la quantite initiale, qu'une entree a ete comptee deux fois.
  return lignes.filter((l) => l.restant < 0 || l.restant > l.quantiteInitiale);
}

export type DiagnosticIntegriteStock = {
  readonly coherent: boolean;
  readonly nbLotsVerifies: number;
  readonly lotsFautifs: ReturnType<typeof verifierInvariantLots>;
};

/**
 * Diagnostic d'integrite du stock, destine a un appelant de PRODUCTION (route
 * de diagnostic, ecran) — a la difference de `verifierInvariantLots`
 * ci-dessus, qui ne rend QUE les lots fautifs et ne dit RIEN quand tout va
 * bien.
 *
 * `verifierInvariantLots` existait, testee a trois reprises
 * (`services/stock.test.ts`, `parcours-erp.test.ts`, `seed/demonstration.test.ts`),
 * documentee comme un controle qu'on veut « pouvoir controler sur la vraie
 * base, pas seulement sur des donnees de test » — et n'etait appelee par
 * AUCUN chemin de production (`docs/13-AUDIT-CAPACITES-ORPHELINES.md`,
 * `audit-silences.test.ts`). Une regression du grand livre de stock — le
 * controle sur lequel repose la credibilite du registre AFSCA — serait donc
 * passee inapercue jusqu'au jour d'un controle reel.
 *
 * CLAUDE.md §4 interdit les `catch` muets ; un controle d'integrite qui ne
 * repond que sur l'echec en est un tout autant. « Cohérent, N lots vérifiés »
 * est donc une reponse a part entiere, jamais une absence de reponse — d'ou
 * cette enveloppe autour de `verifierInvariantLots`, qui elle reste inchangee
 * (trois tests existants attendent litteralement `[]`).
 *
 * PAS BRANCHE SUR `sauvegarder()` (packages/core/src/sauvegarde.ts), bien que
 * ce soit tentant : `baseEnMemoire()` (sauvegarde.test.ts) construit une base
 * a la SEULE table `marqueur`, sans schema migre, pour isoler la logique de
 * frequence de sauvegarde du contenu reel de la base — cette fonction y
 * leverait « no such table: lot ». Le bon point d'entree est donc un chemin
 * qui connait deja un schema migre : une route de diagnostic
 * (`GET /api/stock/integrite`, apps/api/src/routes/stock.ts), declenchee A LA
 * DEMANDE plutot qu'en effet de bord d'une sauvegarde.
 */
export function diagnostiquerIntegriteStock(base: BaseBatte): DiagnosticIntegriteStock {
  const lotsFautifs = verifierInvariantLots(base);
  const nbLotsVerifies = base.select({ id: lot.id }).from(lot).all().length;
  return { coherent: lotsFautifs.length === 0, nbLotsVerifies, lotsFautifs };
}

/**
 * Lots dont la DLC tombe dans l'horizon, tous ingredients confondus.
 *
 * DÉFAUT CORRIGÉ (audit du 29/07/2026, `audit-silences.test.ts`) : cette
 * fonction réécrivait en SQL brut (`julianday(...) - julianday(...)`) EXACTEMENT
 * le calcul de proximité de DLC déjà écrit, testé et tenu à jour dans
 * `packages/core/src/stock.ts` (`lotsProchesDlc`, jamais appelée en
 * production avant ce correctif). Deux implémentations indépendantes de la
 * même règle métier — l'une en SQL, l'autre en TypeScript pur — sont
 * exactement le défaut que règle n°1 (CLAUDE.md §3) interdit : « toute la
 * logique métier chiffrée vit dans `packages/core`, en fonctions pures,
 * testées ». D-020 a déjà montré, sur ce même fichier, le risque concret
 * d'une logique métier dupliquée en requête SQL (une corrélation rompue en
 * silence, sans qu'aucun type ne proteste) ; deux horloges de proximité DLC
 * qui divergeraient un jour (arrondi, fuseau) seraient le même genre de
 * défaut, invisible jusqu'à ce qu'une alerte DLC dise une chose à l'écran et
 * une autre au brief avant-marché.
 *
 * Recharge tous les lots via `lotsDeLIngredient` (qui somme déjà les
 * mouvements, mêmes annulés compris — D-021) puis délègue le tri FEFO et le
 * filtre d'horizon à `lotsProchesDlc`, seule autorité sur « un lot périmé
 * dans N jours ».
 */
export function lotsAlerteDlc(base: BaseBatte, jourReference: string, horizonJours: number) {
  const ingredients = base
    .select({ id: ingredient.id, nom: ingredient.nom })
    .from(ingredient)
    .all();
  const nomParIngredientId = new Map(ingredients.map((i) => [i.id, i.nom]));

  const tousLots = ingredients.flatMap((i) => lotsDeLIngredient(base, i.id));

  return lotsProchesDlc(tousLots, jourReference, horizonJours).map(({ lot: l, joursRestants }) => ({
    lotId: l.id,
    // Garantie par la clé étrangère `lot.ingredient_id` (schema.ts) : un lot
    // ne peut référencer qu'un ingrédient existant, donc `??` ne masque ici
    // aucune incohérence réelle — seulement le type de `Map.get`.
    ingredientNom: nomParIngredientId.get(l.ingredientId) ?? '',
    numeroLotFournisseur: l.numeroLotFournisseur,
    dateDlc: l.dateDlc,
    statut: l.statut,
    restant: l.quantiteRestante,
    joursRestants,
  }));
}
