/**
 * Traçabilité bidirectionnelle (Lot 8).
 *
 * docs/01 module 6 : « chaîne complète lot fournisseur → lot de pâte → session
 * de vente, reconstituable en un clic pour n'importe quelle date. » Deux sens,
 * deux fonctions — ce n'est pas la même requête inversée, parce que l'amont
 * part d'UNE session vers PLUSIEURS lots, et l'aval part d'UN lot vers
 * PLUSIEURS sessions : les cardinalités ne sont pas symétriques.
 *
 * Aucune donnée n'est recalculée ici. Le lien production ↔ lot vient du GRAND
 * LIVRE (`mouvement_stock`), et non de `production_consommation` : la première
 * dit ce qui est SORTI, la seconde ce qui était PRÉVU au lancement, et les deux
 * divergent dès qu'une sur-consommation est servie en FEFO par un lot hors
 * fournée. `production_consommation` reste lue pour le théorique et la
 * quantité déclarée, qu'aucun mouvement ne porte. Voir
 * `netParLotDeLaProduction` (règle d'architecture n°5 : le stock ne se modifie
 * que par un mouvement — c'est donc le mouvement qui fait foi).
 */

import { ErreurIntrouvable, ErreurMetier } from '@batte/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  fournisseur,
  ingredient,
  lieuMarche,
  lot,
  menuComposition,
  motif,
  mouvementStock,
  nonConformite,
  production,
  productionConsommation,
  produitGarniture,
  produitVente,
  recette,
  reception,
  sessionMarche,
  sessionVente,
} from '../schema.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Amont : d'une session vers les lots fournisseurs consommés
   ═══════════════════════════════════════════════════════════════════════════ */

export type TracabiliteAmontConsommation = {
  lotId: string;
  ingredientId: string;
  ingredientNom: string;
  /**
   * Quantité PRÉVUE de ce lot au lancement. `0` — un vrai zéro — pour un lot
   * que la fournée n'avait pas prévu et qui n'est venu que combler un écart
   * réel : voir `consommationsDeLaProduction`.
   */
  quantiteTheorique: number;
  /** `null` tant que le réalisé n'a pas été saisi ingrédient par ingrédient. */
  quantiteReelle: number | null;
  /**
   * Quantité réellement SORTIE de ce lot pour cette production : net signé des
   * mouvements de stock, écarts compris (`netParLotDeLaProduction`).
   *
   * À ne PAS confondre avec les deux champs ci-dessus. `quantiteTheorique` est
   * ce qui était prévu ; `quantiteReelle` est ce que le porteur a DÉCLARÉ, et
   * reste `null` dès que l'ingrédient a été servi par plusieurs lots (la
   * déclaration porte sur l'ingrédient, pas sur le lot). Celui-ci est le seul
   * des trois qui soit toujours connu et toujours attribuable AU LOT — donc le
   * seul qui réponde à « combien de ce lot rappelé est parti dans cette
   * pâte ? ». Égal au théorique tant qu'aucun écart n'a été déclaré.
   */
  quantiteMouvementee: number;
  numeroLotFournisseur: string | null;
  dateReception: string;
  dateDlc: string | null;
  fournisseurId: string;
  fournisseurNom: string;
  receptionId: string;
  receptionNumero: string;
  /**
   * Statut de la RÉCEPTION d'origine (`active`/`annulee`), et non celui du lot
   * lui-même (`lot.statut`) : les deux colonnes sont indépendantes (voir
   * `LotEnBase.receptionStatut`, `depots/stock.ts`). Un lot consommé par une
   * production venait d'une réception forcément `active` au moment de la
   * consommation — `annulerReception` refuse d'annuler une réception dont un
   * lot a déjà été consommé (garde-fou `entree_deja_consommee`,
   * `services/mouvements.ts`) — mais le registre doit pouvoir dire, a
   * posteriori, que CETTE réception a ensuite été annulée : « rien ne
   * s'efface » vaut aussi pour l'affichage d'un fait passé, pas seulement pour
   * la base (CLAUDE.md §3 règle 7, §7).
   */
  receptionStatut: 'active' | 'annulee';
};

export type TracabiliteAmontProduction = {
  productionId: string;
  numero: string;
  recetteCode: string;
  recetteNom: string;
  numeroLotPate: string;
  dateProduction: string;
  consommations: TracabiliteAmontConsommation[];
};

/**
 * Lot d'un produit REVENDU sorti pour cette session.
 *
 * Un article revendu (sirop, confiture) ne passe par AUCUNE production : sa
 * matiere n'est transformee par aucune recette. Son lot n'est donc relie a la
 * session que par le mouvement `sortie_vente`. Tant que la tracabilite ne
 * parcourait que `production_consommation`, ces lots etaient **invisibles des
 * deux cotes** : on ne pouvait dire ni ce qui avait ete vendu un jour donne, ni
 * dans quelles sessions un lot rappele etait parti. C'est une denree a DLC
 * vendue au public — l'obligation de tracabilite AFSCA ne fait aucune
 * difference entre transforme et revendu.
 */
export type TracabiliteRevendu = {
  lotId: string;
  ingredientId: string;
  ingredientNom: string;
  quantite: number;
  numeroLotFournisseur: string | null;
  dateReception: string;
  dateDlc: string | null;
  fournisseurId: string;
  fournisseurNom: string;
  receptionId: string;
  receptionNumero: string;
  /** Statut de la RÉCEPTION d'origine — voir `TracabiliteAmontConsommation.receptionStatut`. */
  receptionStatut: 'active' | 'annulee';
};

/**
 * Lot d'une GARNITURE étalée sur un produit transformé pendant cette session.
 *
 * POURQUOI UN BLOC À PART, ET NON L'UN DES DEUX BLOCS EXISTANTS
 * -------------------------------------------------------------
 * Les deux rattachements possibles sont faux, chacun pour sa propre raison.
 *
 * *Dans les consommations d'une production* : une garniture n'est étalée par
 * aucune fournée. La ranger là ferait état d'une fabrication qui n'a pas eu
 * lieu, dans le document même qui sert à prouver ce qui s'est réellement passé.
 * C'est mot pour mot la raison qui a déjà sorti les revendus de ce bloc (D-049).
 *
 * *Dans les marchandises revendues* : une garniture n'est pas vendue telle
 * quelle. Elle est le COMPOSANT d'un produit transformé — et c'est justement ce
 * qu'un contrôleur veut savoir. « Ce pot de sirop est rappelé » n'appelle pas la
 * même réponse selon qu'il a été vendu fermé (le client a l'emballage, donc le
 * numéro de lot) ou étalé sur une crêpe (le client n'a rien, seul le registre
 * sait). Confondre les deux dans une ligne « Marchandises revendues » ferait
 * perdre exactement l'information qui déclenche, ou non, un rappel public.
 *
 * D'où le champ `produits`, que le bloc revendu n'a pas : il nomme les produits
 * vendus ce jour-là qui portaient cette garniture. C'est la seule façon de
 * relier un lot à une assiette.
 */
export type TracabiliteGarniture = {
  lotId: string;
  ingredientId: string;
  ingredientNom: string;
  quantite: number;
  numeroLotFournisseur: string | null;
  dateReception: string;
  dateDlc: string | null;
  fournisseurId: string;
  fournisseurNom: string;
  receptionId: string;
  receptionNumero: string;
  /** Statut de la RÉCEPTION d'origine — voir `TracabiliteAmontConsommation.receptionStatut`. */
  receptionStatut: 'active' | 'annulee';
  /** Produits vendus pendant cette session qui portaient cette garniture. */
  produits: string[];
};

export type TracabiliteAmontSession = {
  sessionId: string;
  numero: string;
  dateSession: string;
  productions: TracabiliteAmontProduction[];
  /** Lots revendus tels quels. Vide quand la session n'a vendu que du transformé. */
  revendus: TracabiliteRevendu[];
  /** Lots étalés sur une crêpe. Vide quand aucun produit vendu n'a de garniture. */
  garnitures: TracabiliteGarniture[];
};

/**
 * Net signé, LOT PAR LOT, des mouvements de stock qu'une production a
 * réellement écrits — le GRAND LIVRE de cette production.
 *
 * POURQUOI CETTE SOURCE, ET PAS `production_consommation`. Les deux tables ne
 * répondent pas à la même question : `production_consommation` dit ce qui était
 * PRÉVU au lancement, `mouvement_stock` dit ce qui est SORTI. Elles divergent
 * dès qu'une sur-consommation est déclarée : la matière supplémentaire est
 * prise en FEFO sur le stock DU JOUR, donc éventuellement sur un lot que la
 * fournée n'avait jamais touché. Ce lot a bel et bien alimenté cette pâte, et
 * il n'a AUCUNE ligne dans `production_consommation`.
 *
 * Ce que ça coûtait, et pourquoi ce n'est pas une élégance technique : le
 * meunier rappelle un lot de farine, le porteur demande « quelles pâtes,
 * quelles sessions ». La réponse OMETTAIT toutes les productions où ce lot
 * n'avait servi qu'à combler un écart — dans les DEUX sens, amont comme aval.
 * CLAUDE.md §3 règle 6 : « obligation réglementaire, pas une élégance
 * technique ».
 *
 * Clé : le `lot_id` SEUL suffit dans le périmètre d'une production — un lot ne
 * porte qu'un ingrédient (`lot.ingredient_id` est unique par lot), donc deux
 * ingrédients ne peuvent pas se partager une clé.
 *
 * Les deux filtres sont ceux de `grandLivreProduction` (`depots/productions.ts`)
 * et de `coutMatiereReelDepuisMouvements` (`services/production.ts`) — les
 * trois lectures du même grand livre doivent voir les mêmes écritures :
 *  - `production_id = ?` : seuls `lancerProduction` et `saisirRealise` posent
 *    cette colonne sur un mouvement de stock ;
 *  - `ajustement = false` : écarte les contrepassations, qui recopient le
 *    `production_id` de leur original. Une production annulée reste donc
 *    visible au registre avec ce qu'elle a consommé — « rien ne s'efface »
 *    (CLAUDE.md §3 règle 7) vaut d'abord pour un rappel sanitaire.
 *
 * Le SIGNE vient du type, jamais de la quantité (toujours positive en base) :
 * une `entree` rattachée à une production est la RESTITUTION d'une
 * sous-consommation.
 */
function netParLotDeLaProduction(base: BaseBatte, productionId: string): Map<string, number> {
  const mouvements = base
    .select({
      lotId: mouvementStock.lotId,
      type: mouvementStock.type,
      quantite: mouvementStock.quantite,
    })
    .from(mouvementStock)
    .where(and(eq(mouvementStock.productionId, productionId), eq(mouvementStock.ajustement, false)))
    .all();

  const net = new Map<string, number>();
  for (const m of mouvements) {
    const signe = m.type === 'entree' ? -1 : 1;
    net.set(m.lotId, (net.get(m.lotId) ?? 0) + signe * m.quantite);
  }
  return net;
}

/** Signalétique d'un lot, telle que le registre doit la présenter. */
function signaletiqueDesLots(
  base: BaseBatte,
  lotIds: readonly string[],
): Map<
  string,
  Omit<TracabiliteAmontConsommation, 'quantiteTheorique' | 'quantiteReelle' | 'quantiteMouvementee'>
> {
  const lignes = base
    .select({
      lotId: lot.id,
      ingredientId: lot.ingredientId,
      ingredientNom: ingredient.nom,
      numeroLotFournisseur: lot.numeroLotFournisseur,
      dateReception: lot.dateReception,
      dateDlc: lot.dateDlc,
      fournisseurId: lot.fournisseurId,
      fournisseurNom: fournisseur.nom,
      receptionId: lot.receptionId,
      receptionNumero: reception.numero,
      receptionStatut: reception.statut,
    })
    .from(lot)
    .innerJoin(ingredient, eq(lot.ingredientId, ingredient.id))
    .innerJoin(fournisseur, eq(lot.fournisseurId, fournisseur.id))
    .innerJoin(reception, eq(lot.receptionId, reception.id))
    .where(inArray(lot.id, [...lotIds]))
    .all();
  return new Map(lignes.map((l) => [l.lotId, l]));
}

/**
 * Tous les lots qui ont alimenté UNE production — ceux qu'elle avait prévus au
 * lancement ET ceux que la FEFO du jour a servis pour combler un écart réel.
 *
 * L'ensemble des lots vient du GRAND LIVRE (`netParLotDeLaProduction`), pas de
 * `production_consommation` : voir la doc de cette fonction pour ce que le
 * second manquait. `production_consommation` reste consultée pour le THÉORIQUE
 * et pour la quantité DÉCLARÉE, qu'aucun mouvement ne porte.
 */
function consommationsDeLaProduction(
  base: BaseBatte,
  productionId: string,
): TracabiliteAmontConsommation[] {
  const net = netParLotDeLaProduction(base, productionId);

  const prevues = base
    .select({
      lotId: productionConsommation.lotId,
      quantiteTheorique: productionConsommation.quantiteTheorique,
      quantiteReelle: productionConsommation.quantiteReelle,
    })
    .from(productionConsommation)
    .where(eq(productionConsommation.productionId, productionId))
    .all();
  const prevuesParLot = new Map(prevues.map((p) => [p.lotId, p]));

  // Union des deux sources. `production_consommation` est en principe un
  // sous-ensemble du grand livre (`lancerProduction` écrit les deux dans la
  // MÊME boucle), mais on ne le suppose pas : une ligne prévue sans mouvement
  // serait une incohérence, et la faire disparaître du registre serait le pire
  // des traitements.
  const lotIds = [...new Set([...net.keys(), ...prevuesParLot.keys()])];
  if (lotIds.length === 0) return [];
  const signaletique = signaletiqueDesLots(base, lotIds);

  return lotIds
    .map((lotId) => {
      const infos = signaletique.get(lotId);
      // Incohérence de données, pas un cas métier : un mouvement ou une ligne
      // de consommation référence toujours un lot existant (clé étrangère).
      if (infos === undefined) throw new ErreurIntrouvable('Lot', lotId);
      const prevue = prevuesParLot.get(lotId);
      return {
        ...infos,
        /**
         * `0` — un VRAI zéro, pas une inconnue — pour un lot que la fournée
         * n'avait pas prévu : le plan FEFO du lancement ne lui avait
         * effectivement rien alloué. Ce que ce lot a réellement fourni est dit
         * par `quantiteMouvementee` juste en dessous, jamais par ce champ-ci.
         */
        quantiteTheorique: prevue?.quantiteTheorique ?? 0,
        quantiteReelle: prevue?.quantiteReelle ?? null,
        quantiteMouvementee: net.get(lotId) ?? 0,
      };
    })
    .sort((a, b) => a.ingredientNom.localeCompare(b.ingredientNom));
}

/**
 * Ingrédients qui ont servi de GARNITURE pendant une session → produits porteurs.
 *
 * C'est le discriminant : la clôture émet un `sortie_vente` pour un revendu
 * comme pour une garniture, et rien sur le mouvement lui-même ne les sépare.
 * On repart donc de ce qui a réellement été vendu ce jour-là — `session_vente`
 * croisée avec `produit_garniture` — plutôt que d'une liste figée.
 *
 * LIMITE CONNUE, assumée et non silencieuse. Un ingrédient qui serait à la fois
 * étalé sur une crêpe ET vendu tel quel le même jour verrait toutes ses sorties
 * classées en garniture : le mouvement, son lot et sa quantité restent
 * intégralement lisibles — rien ne disparaît du registre — mais son étiquette
 * serait celle du composant. Trancher exactement exigerait un type de mouvement
 * `sortie_garniture`, donc une migration du schéma. Le modèle décourage déjà ce
 * cas : on n'étale pas des pots de détail, on achète du vrac, qui est un article
 * distinct (voir `seed/demonstration.ts`, ingrédient `sirop-liege-vrac`).
 *
 * DÉFAUT CORRIGÉ (audit AFSCA du 30/07/2026). Cette fonction ne regardait QUE
 * `session_vente` pour savoir quels produits garnis avaient été vendus ce
 * jour-là. Or `cloturerSession` (`packages/db/src/services/sessions.ts`)
 * n'écrit une ligne `session_vente` que pour le produit VENDU DIRECTEMENT — le
 * menu-conteneur, si la ligne est un menu — jamais pour ses composants. Un
 * produit garni vendu UNIQUEMENT à l'intérieur d'un menu (jamais en ligne
 * directe) ne portait donc aucune ligne `session_vente` sous son propre
 * identifiant : la jointure le ratait, et la sortie de sa garniture — pourtant
 * bien réelle en stock depuis que `sortirLesGarnitures` reçoit les composants
 * explosés d'un menu — retombait dans le bloc « revendus » au lieu du bloc
 * « garnitures », perdant exactement la distinction qui décide de la portée
 * d'un rappel. Corrigé en élargissant l'ensemble des « produits vendus ce
 * jour-là » aux composants ACTIFS de chaque menu vendu, en plus des produits
 * vendus en ligne directe — un menu n'est jamais lui-même garni (il n'a pas de
 * ligne dans `produit_garniture`), seul un de ses composants peut l'être.
 */
function produitsGarnisDeLaSession(base: BaseBatte, sessionId: string): Map<string, string[]> {
  const ventesDirectes = base
    .select({ produitVenteId: sessionVente.produitVenteId })
    .from(sessionVente)
    .where(eq(sessionVente.sessionId, sessionId))
    .all();
  const idsVendusDirectement = [...new Set(ventesDirectes.map((v) => v.produitVenteId))];
  if (idsVendusDirectement.length === 0) return new Map();

  // Composants ACTIFS des menus vendus ce jour-là : un composant de menu ne
  // porte, lui, aucune ligne `session_vente` propre (voir la doc ci-dessus).
  const composantsDeMenusVendus = base
    .select({ produitInclusId: menuComposition.produitInclusId })
    .from(menuComposition)
    .where(
      and(inArray(menuComposition.menuId, idsVendusDirectement), eq(menuComposition.actif, true)),
    )
    .all();

  const idsProduitsConsideres = [
    ...new Set([...idsVendusDirectement, ...composantsDeMenusVendus.map((c) => c.produitInclusId)]),
  ];

  const lignes = base
    .select({ ingredientId: produitGarniture.ingredientId, nomProduit: produitVente.nom })
    .from(produitGarniture)
    .innerJoin(produitVente, eq(produitVente.id, produitGarniture.produitVenteId))
    .where(inArray(produitGarniture.produitVenteId, idsProduitsConsideres))
    .orderBy(produitVente.nom)
    .all();

  const parIngredient = new Map<string, string[]>();
  for (const ligne of lignes) {
    const noms = parIngredient.get(ligne.ingredientId) ?? [];
    // Un produit vendu sur deux créneaux horaires (ou composant de deux menus
    // vendus le même jour) produit plusieurs lignes : sans ce garde, il serait
    // nommé plusieurs fois sur la même garniture.
    if (!noms.includes(ligne.nomProduit)) noms.push(ligne.nomProduit);
    parIngredient.set(ligne.ingredientId, noms);
  }
  return parIngredient;
}

/**
 * Toutes les sorties `sortie_vente` d'une session, revendus ET garnitures
 * confondus. Le tri entre les deux se fait au-dessus, par
 * `produitsGarnisDeLaSession`.
 *
 * Les mouvements annulés sont exclus : une écriture contrepassée ne compte
 * plus, mais elle reste lisible ailleurs (« rien ne s'efface », D-021).
 */
function sortiesVenteDeLaSession(base: BaseBatte, sessionId: string): TracabiliteRevendu[] {
  return base
    .select({
      lotId: mouvementStock.lotId,
      ingredientId: mouvementStock.ingredientId,
      ingredientNom: ingredient.nom,
      quantite: mouvementStock.quantite,
      numeroLotFournisseur: lot.numeroLotFournisseur,
      dateReception: lot.dateReception,
      dateDlc: lot.dateDlc,
      fournisseurId: lot.fournisseurId,
      fournisseurNom: fournisseur.nom,
      receptionId: lot.receptionId,
      receptionNumero: reception.numero,
      receptionStatut: reception.statut,
    })
    .from(mouvementStock)
    .innerJoin(lot, eq(mouvementStock.lotId, lot.id))
    .innerJoin(ingredient, eq(mouvementStock.ingredientId, ingredient.id))
    .innerJoin(fournisseur, eq(lot.fournisseurId, fournisseur.id))
    .innerJoin(reception, eq(lot.receptionId, reception.id))
    .where(
      and(
        eq(mouvementStock.sessionId, sessionId),
        eq(mouvementStock.type, 'sortie_vente'),
        eq(mouvementStock.isAnnule, false),
      ),
    )
    .orderBy(ingredient.nom)
    .all();
}

/**
 * Session → productions → lots consommés → réceptions → fournisseurs,
 * ET session → lots revendus tels quels, ET session → lots étalés en garniture.
 *
 * Une session sans aucune production associée n'est pas une erreur : elle rend
 * `productions: []`, par exemple une session annulée avant toute fabrication —
 * ou une session qui n'a vendu que des produits revendus.
 */
export function tracabiliteAmontSession(
  base: BaseBatte,
  sessionId: string,
): TracabiliteAmontSession {
  const session = base.select().from(sessionMarche).where(eq(sessionMarche.id, sessionId)).get();
  if (session === undefined) throw new ErreurIntrouvable('Session', sessionId);

  const productions = base
    .select({
      id: production.id,
      numero: production.numero,
      numeroLotPate: production.numeroLotPate,
      dateProduction: production.dateProduction,
      recetteCode: recette.code,
      recetteNom: recette.nom,
    })
    .from(production)
    .innerJoin(recette, eq(production.recetteId, recette.id))
    .where(eq(production.sessionId, sessionId))
    .orderBy(production.dateProduction)
    .all();

  const garnies = produitsGarnisDeLaSession(base, sessionId);
  const sorties = sortiesVenteDeLaSession(base, sessionId);

  return {
    sessionId: session.id,
    numero: session.numero,
    dateSession: session.dateSession,
    productions: productions.map((p) => ({
      productionId: p.id,
      numero: p.numero,
      recetteCode: p.recetteCode,
      recetteNom: p.recetteNom,
      numeroLotPate: p.numeroLotPate,
      dateProduction: p.dateProduction,
      consommations: consommationsDeLaProduction(base, p.id),
    })),
    revendus: sorties.filter((s) => !garnies.has(s.ingredientId)),
    garnitures: sorties
      .filter((s) => garnies.has(s.ingredientId))
      .map((s) => ({ ...s, produits: garnies.get(s.ingredientId)! })),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Aval : d'un lot fournisseur vers les sessions impactées
   ═══════════════════════════════════════════════════════════════════════════ */

export type TracabiliteAvalSession = {
  id: string;
  numero: string;
  dateSession: string;
  lieuNom: string;
};

export type TracabiliteAvalProduction = {
  productionId: string;
  numero: string;
  dateProduction: string;
  /**
   * Lot de pâte produit (`production.numero_lot_pate`) — pas `numero`,
   * l'identifiant interne de la production. C'est CE numéro que
   * `schema.ts` désigne comme « le lien qui rend la traçabilité
   * bidirectionnelle possible » (commentaire sur la table `production`) :
   * lui seul relie les lots fournisseurs consommés (ce bloc aval) au lot de
   * pâte qui part en session de vente. `NOT NULL` en base — une production
   * en reçoit un dès sa création (`services/production.ts`) — donc jamais
   * `null` ici, à la différence de `session` juste en dessous.
   *
   * DÉFAUT CORRIGÉ (audit du 31/07/2026). Ce champ existait déjà côté amont
   * (`TracabiliteAmontProduction.numeroLotPate`), mais pas
   * ici : la question d'un rappel fournisseur — « quel lot de pâte est issu
   * d'une production ayant consommé ce lot d'ingrédient rappelé ? » — restait
   * sans réponse côté AVAL, alors que c'est précisément l'écran qui répond à
   * un rappel réel (`RegistreAfsca.tsx`, onglet Aval).
   */
  numeroLotPate: string;
  /**
   * Quantité PRÉVUE de ce lot au lancement de cette production. `0` — un vrai
   * zéro — quand cette production n'avait pas prévu ce lot et ne l'a touché
   * que pour combler un écart réel : voir `netParLotDeLaProduction`.
   */
  quantiteTheorique: number;
  quantiteReelle: number | null;
  /**
   * Quantité réellement SORTIE de ce lot pour cette production. Voir
   * `TracabiliteAmontConsommation.quantiteMouvementee` : c'est le seul des
   * trois champs de quantité qui soit toujours connu ET toujours attribuable
   * au lot, donc le seul qui réponde à la question d'un rappel.
   */
  quantiteMouvementee: number;
  /**
   * Une production sans session destinée (pâte pas encore affectée à un
   * marché) rend `null`, jamais une erreur : ce n'est pas une incohérence,
   * c'est un lot de pâte en attente.
   */
  session: TracabiliteAvalSession | null;
};

/**
 * Sortie d'un lot REVENDU vers une session, sans production intermediaire.
 *
 * C'est la reponse a « ce lot de sirop est rappele : ou est-il parti ? ».
 * Avant, la question restait sans reponse : la tracabilite aval ne parcourait
 * que `production_consommation`, et un article revendu n'y figure jamais.
 */
export type TracabiliteAvalVente = {
  quantite: number;
  dateMouvement: string;
  session: TracabiliteAvalSession;
};

/**
 * Sortie d'un lot ÉTALÉ en garniture, sans production intermédiaire.
 *
 * Symétrique du bloc amont, et séparée des ventes pour la même raison : le
 * client d'un pot fermé détient le numéro de lot, celui d'une crêpe garnie ne
 * détient rien. C'est cette différence qui décide de la portée d'un rappel, et
 * elle disparaîtrait dans une liste unique.
 */
export type TracabiliteAvalGarniture = {
  quantite: number;
  dateMouvement: string;
  session: TracabiliteAvalSession;
  /** Produits vendus ce jour-là qui portaient cette garniture. */
  produits: string[];
};

/**
 * Miroir de `NonConformite` (`services/afsca.ts`) : redéclaré ici plutôt
 * qu'importé, pour respecter la direction de dépendance du dépôt (les
 * services importent les dépôts, jamais l'inverse — voir
 * `packages/db/src/services/afsca.ts` qui importe déjà `depots/parametres.ts`,
 * jamais le contraire).
 */
export type NonConformiteLot = typeof nonConformite.$inferSelect;

export type TracabiliteAvalLot = {
  lotId: string;
  ingredientId: string;
  ingredientNom: string;
  numeroLotFournisseur: string | null;
  dateReception: string;
  dateDlc: string | null;
  fournisseurId: string;
  fournisseurNom: string;
  receptionId: string;
  receptionNumero: string;
  /** Statut de la RÉCEPTION d'origine — voir `TracabiliteAmontConsommation.receptionStatut`. */
  receptionStatut: 'active' | 'annulee';
  /**
   * Statut ACTUEL du lot lui-même (`disponible`/`quarantaine`/`bloque`/`detruit`,
   * `lot.statut`) — à NE PAS confondre avec `receptionStatut` ci-dessus, qui
   * porte celui de la réception d'origine.
   *
   * Lu ICI, à côté de `motifStatutLibelle`/`dateChangementStatut` juste en
   * dessous, parce que ces deux champs ne portent QUE le motif et la date du
   * DERNIER changement (voir leur doc) : sans `statut`, rien ne dit si ce
   * dernier changement a mené le lot à `bloque` ou l'en a fait sortir.
   */
  statut: 'disponible' | 'quarantaine' | 'bloque' | 'detruit';
  /**
   * Motif et date du DERNIER changement de statut de ce lot
   * (`lot.motif_statut_id`, `lot.date_changement_statut`, écrits à chaque
   * appel de `changerStatutLot`, `services/mouvements.ts`) — la trace exacte
   * qu'un contrôle AFSCA vient chercher sur un rappel : pourquoi ce lot a-t-il
   * été bloqué, et quand.
   *
   * DÉFAUT CORRIGÉ (audit du 30/07/2026, `audit-colonnes-orphelines.test.ts`) :
   * ces deux colonnes n'étaient exposées nulle part, y compris ici — l'écran
   * de traçabilité affichait donc « ce lot est bloqué » (via `statut`, une
   * fois exposé) sans jamais dire ni pourquoi ni depuis quand.
   *
   * `motifStatutLibelle` ne reflète que le motif du DERNIER changement, jamais
   * l'historique complet (qui vit dans `journal_audit`) : un lot mis en
   * quarantaine PUIS relâché porte ici le motif du RELÂCHEMENT. `null` sur les
   * deux quand le lot n'a jamais changé de statut depuis sa réception — jamais
   * un motif fabriqué (CLAUDE.md §7).
   */
  motifStatutLibelle: string | null;
  dateChangementStatut: string | null;
  /**
   * Non-conformités déjà rattachées à CE lot (`nonConformite.lotId`).
   *
   * DÉFAUT CORRIGÉ (audit du 29/07/2026) : ce champ n'existait pas — on
   * pouvait rattacher une non-conformité à un lot (`RegistreAfsca.tsx`) et ne
   * plus jamais la revoir en consultant ce même lot, alors que c'est
   * exactement l'information qu'un rappel réel réclame en premier. Les plus
   * récentes en tête, même tri que `listerNonConformites`.
   */
  nonConformites: NonConformiteLot[];
  productions: TracabiliteAvalProduction[];
  /** Sorties vendues TELLES QUELLES. Vide pour un ingrédient uniquement transformé. */
  ventes: TracabiliteAvalVente[];
  /** Sorties étalées sur un produit transformé. */
  garnitures: TracabiliteAvalGarniture[];
};

/**
 * Résumé d'une session, pour l'aval. `sessionId` vient de `production.session_id`
 * — si la ligne référencée est absente, c'est une incohérence de données
 * (une session ne doit jamais disparaître, « rien ne s'efface »), pas un cas
 * métier normal : on échoue bruyamment plutôt que de mentir avec un `null`.
 */
function sessionResume(base: BaseBatte, sessionId: string): TracabiliteAvalSession {
  const session = base
    .select({
      id: sessionMarche.id,
      numero: sessionMarche.numero,
      dateSession: sessionMarche.dateSession,
      lieuNom: lieuMarche.nom,
    })
    .from(sessionMarche)
    .innerJoin(lieuMarche, eq(sessionMarche.lieuId, lieuMarche.id))
    .where(eq(sessionMarche.id, sessionId))
    .get();
  if (session === undefined) throw new ErreurIntrouvable('Session', sessionId);
  return session;
}

/**
 * Résout un identifiant de lot SAISI PAR L'UTILISATEUR vers l'identifiant
 * technique (`lot.id`).
 *
 * POURQUOI CE REPLI EST NÉCESSAIRE, ET PAS UNE COMMODITÉ. Le critère de cet
 * audit tient en une phrase : « ce lot de farine rappelé par le meunier est
 * parti dans quelles sessions ? ». Le document qui déclenche cette question —
 * l'avis de rappel du fournisseur — porte SON numéro de lot
 * (`numero_lot_fournisseur`), jamais l'identifiant technique interne
 * (`lot.id`, un ULID). Or cet identifiant technique n'est affiché NULLE PART
 * ailleurs dans l'application (`Stock.tsx`, `DetailLot.tsx` ne montrent que le
 * numéro fournisseur) : avant ce repli, la recherche « Aval » de
 * `RegistreAfsca.tsx` était donc, en pratique, IRRÉALISABLE lors d'un rappel
 * réel — l'utilisateur n'avait tout simplement aucun moyen de se procurer la
 * valeur que le champ attendait.
 *
 * L'identifiant technique reste tenté EN PREMIER (aucune régression sur les
 * appels existants, y compris depuis la route qui reçoit déjà un `lot.id`
 * quand l'appelant clique depuis l'écran Stock). Le repli ne s'active que
 * lorsque rien ne correspond.
 *
 * Une seule correspondance : elle est utilisée silencieusement. Plusieurs :
 * refus explicite plutôt qu'un choix arbitraire — sur un rappel, cibler le
 * mauvais lot parmi plusieurs candidats serait pire que de ne rien trouver.
 * Le message oriente vers l'identifiant technique, seul moyen non ambigu.
 */
function resoudreLotId(base: BaseBatte, identifiant: string): string {
  const parId = base.select({ id: lot.id }).from(lot).where(eq(lot.id, identifiant)).get();
  if (parId !== undefined) return parId.id;

  const parNumero = base
    .select({ id: lot.id })
    .from(lot)
    .where(eq(lot.numeroLotFournisseur, identifiant))
    .all();

  if (parNumero.length === 1) return parNumero[0]!.id;
  if (parNumero.length > 1) {
    throw new ErreurMetier(
      'numero_lot_ambigu',
      `${parNumero.length} lots portent le numéro fournisseur « ${identifiant} ». ` +
        "Utilisez l'identifiant technique du lot (visible dans Stock, détail du " +
        'lot) pour cibler celui-ci précisément.',
    );
  }

  throw new ErreurIntrouvable('Lot', identifiant);
}

/** Lot fournisseur → productions qui l'ont consommé → sessions impactées. */
export function tracabiliteAvalLot(base: BaseBatte, identifiant: string): TracabiliteAvalLot {
  const lotId = resoudreLotId(base, identifiant);

  const entete = base
    .select({
      lotId: lot.id,
      ingredientId: lot.ingredientId,
      ingredientNom: ingredient.nom,
      numeroLotFournisseur: lot.numeroLotFournisseur,
      dateReception: lot.dateReception,
      dateDlc: lot.dateDlc,
      fournisseurId: lot.fournisseurId,
      fournisseurNom: fournisseur.nom,
      receptionId: lot.receptionId,
      receptionNumero: reception.numero,
      receptionStatut: reception.statut,
      statut: lot.statut,
      // `leftJoin` : `lot.motif_statut_id` est nullable (aucun changement de
      // statut depuis la reception, le cas courant). Un `innerJoin` ferait
      // silencieusement disparaitre ces lots de la reponse de tracabilite.
      motifStatutLibelle: motif.libelle,
      dateChangementStatut: lot.dateChangementStatut,
    })
    .from(lot)
    .innerJoin(ingredient, eq(lot.ingredientId, ingredient.id))
    .innerJoin(fournisseur, eq(lot.fournisseurId, fournisseur.id))
    .innerJoin(reception, eq(lot.receptionId, reception.id))
    .leftJoin(motif, eq(lot.motifStatutId, motif.id))
    .where(eq(lot.id, lotId))
    .get();
  // Incohérence, pas un cas métier : `resoudreLotId` vient de garantir
  // l'existence de CET id précis.
  if (entete === undefined) throw new ErreurIntrouvable('Lot', lotId);

  // Non-conformités DÉJÀ rattachées à ce lot précis (défaut corrigé, voir le
  // commentaire du champ `nonConformites` sur `TracabiliteAvalLot`). Même tri
  // que `listerNonConformites` : la plus récente en tête.
  const nonConformitesDuLot = base
    .select()
    .from(nonConformite)
    .where(eq(nonConformite.lotId, lotId))
    .orderBy(desc(nonConformite.dateConstat))
    .all();

  /**
   * Productions qui ont RÉELLEMENT sorti de ce lot, d'après le grand livre.
   *
   * DÉFAUT CORRIGÉ le 01/08/2026. Ce bloc partait de `production_consommation`
   * — la table écrite AU LANCEMENT, donc « ce qui était prévu ». Or une
   * sur-consommation déclarée au réalisé est servie en FEFO sur le stock DU
   * JOUR : elle peut tomber sur un lot que la fournée n'avait pas touché, qui
   * n'a alors AUCUNE ligne dans cette table. Sur un rappel fournisseur, la
   * réponse à « quelles pâtes, quelles sessions » OMETTAIT donc toutes les
   * productions où ce lot n'avait servi qu'à combler un écart — silencieusement.
   * Voir `netParLotDeLaProduction` pour les filtres et leur justification.
   */
  const mouvementsDuLot = base
    .select({
      productionId: production.id,
      numero: production.numero,
      dateProduction: production.dateProduction,
      numeroLotPate: production.numeroLotPate,
      sessionId: production.sessionId,
      type: mouvementStock.type,
      quantite: mouvementStock.quantite,
    })
    .from(mouvementStock)
    // `innerJoin` sur `production` : écarte de lui-même les mouvements sans
    // production (ventes, pertes, inventaire), qui n'ont rien à faire ici.
    .innerJoin(production, eq(mouvementStock.productionId, production.id))
    .where(and(eq(mouvementStock.lotId, lotId), eq(mouvementStock.ajustement, false)))
    .all();

  type ProductionDuLot = {
    productionId: string;
    numero: string;
    dateProduction: string;
    numeroLotPate: string;
    sessionId: string | null;
    quantiteTheorique: number;
    quantiteReelle: number | null;
    quantiteMouvementee: number;
  };

  const parProduction = new Map<string, ProductionDuLot>();
  for (const m of mouvementsDuLot) {
    const courant = parProduction.get(m.productionId) ?? {
      productionId: m.productionId,
      numero: m.numero,
      dateProduction: m.dateProduction,
      numeroLotPate: m.numeroLotPate,
      sessionId: m.sessionId,
      // Défauts remplacés juste après par la ligne prévue, quand elle existe.
      quantiteTheorique: 0,
      quantiteReelle: null,
      quantiteMouvementee: 0,
    };
    courant.quantiteMouvementee += (m.type === 'entree' ? -1 : 1) * m.quantite;
    parProduction.set(m.productionId, courant);
  }

  // Le THÉORIQUE et la quantité DÉCLARÉE ne vivent que dans
  // `production_consommation` : aucun mouvement ne les porte. La jointure sur
  // `production` est conservée pour qu'une ligne prévue SANS mouvement — une
  // incohérence, jamais un cas métier — reste malgré tout au registre plutôt
  // que d'en disparaître.
  const prevues = base
    .select({
      productionId: production.id,
      numero: production.numero,
      dateProduction: production.dateProduction,
      numeroLotPate: production.numeroLotPate,
      sessionId: production.sessionId,
      quantiteTheorique: productionConsommation.quantiteTheorique,
      quantiteReelle: productionConsommation.quantiteReelle,
    })
    .from(productionConsommation)
    .innerJoin(production, eq(productionConsommation.productionId, production.id))
    .where(eq(productionConsommation.lotId, lotId))
    .all();

  for (const p of prevues) {
    const courant = parProduction.get(p.productionId);
    if (courant === undefined) {
      parProduction.set(p.productionId, { ...p, quantiteMouvementee: 0 });
      continue;
    }
    courant.quantiteTheorique = p.quantiteTheorique;
    courant.quantiteReelle = p.quantiteReelle;
  }

  const consommations = [...parProduction.values()].sort(
    (a, b) => a.dateProduction.localeCompare(b.dateProduction) || a.numero.localeCompare(b.numero),
  );

  // Sorties en VENTE directe : le lot est parti tel quel, sans passer par une
  // production. `sessionId` est `NOT NULL` en pratique sur ce type de mouvement
  // — il est emis par la cloture — mais on ne le suppose pas : une ligne sans
  // session serait une incoherence, on l'ecarte plutot que de lever, parce
  // qu'un rappel ne doit pas echouer sur une ligne aberrante.
  const ventes = base
    .select({
      quantite: mouvementStock.quantite,
      dateMouvement: mouvementStock.dateMouvement,
      sessionId: mouvementStock.sessionId,
    })
    .from(mouvementStock)
    .where(
      and(
        eq(mouvementStock.lotId, lotId),
        eq(mouvementStock.type, 'sortie_vente'),
        eq(mouvementStock.isAnnule, false),
      ),
    )
    .orderBy(mouvementStock.dateMouvement)
    .all();

  // Une lecture par SESSION concernée, pas une par mouvement : un lot part sur
  // quelques marchés, pas sur des milliers, et le cache garde la requete de
  // discrimination proportionnelle au nombre de sessions touchées.
  const garniesParSession = new Map<string, Map<string, string[]>>();
  const ingredientDuLot = entete.ingredientId;
  const produitsGarnis = (sessionId: string): string[] | null => {
    let garnies = garniesParSession.get(sessionId);
    if (garnies === undefined) {
      garnies = produitsGarnisDeLaSession(base, sessionId);
      garniesParSession.set(sessionId, garnies);
    }
    return garnies.get(ingredientDuLot) ?? null;
  };

  // Même patron que `garniesParSession` juste au-dessus, appliqué à
  // `sessionResume` : cette fonction était appelée une fois par ligne de
  // consommation ET une fois par ligne de vente, sans cache — un lot qui
  // alimente quelques sessions, jamais des milliers de lignes, n'a besoin
  // que d'UNE lecture par session distincte (mesure du 30/07/2026 : 49,7 ms
  // à 150 sessions, 136,6 ms à 396, croissance quasi linéaire — la signature
  // d'une requête répétée). Cache LOCAL À CET APPEL, comme `garniesParSession` :
  // aucun risque de lire une session périmée sur un appel ultérieur.
  const sessionsParId = new Map<string, TracabiliteAvalSession>();
  const sessionResumeMemo = (sessionId: string): TracabiliteAvalSession => {
    let session = sessionsParId.get(sessionId);
    if (session === undefined) {
      session = sessionResume(base, sessionId);
      sessionsParId.set(sessionId, session);
    }
    return session;
  };

  const sorties = ventes
    .filter((v): v is typeof v & { sessionId: string } => v.sessionId !== null)
    .map((v) => ({
      quantite: v.quantite,
      dateMouvement: v.dateMouvement,
      session: sessionResumeMemo(v.sessionId),
      produits: produitsGarnis(v.sessionId),
    }));

  return {
    ...entete,
    nonConformites: nonConformitesDuLot,
    productions: consommations.map((c) => ({
      productionId: c.productionId,
      numero: c.numero,
      dateProduction: c.dateProduction,
      numeroLotPate: c.numeroLotPate,
      quantiteTheorique: c.quantiteTheorique,
      quantiteReelle: c.quantiteReelle,
      quantiteMouvementee: c.quantiteMouvementee,
      session: c.sessionId === null ? null : sessionResumeMemo(c.sessionId),
    })),
    ventes: sorties
      .filter((s) => s.produits === null)
      .map(({ quantite, dateMouvement, session }) => ({ quantite, dateMouvement, session })),
    garnitures: sorties
      .filter((s): s is typeof s & { produits: string[] } => s.produits !== null)
      .map(({ quantite, dateMouvement, session, produits }) => ({
        quantite,
        dateMouvement,
        session,
        produits,
      })),
  };
}
