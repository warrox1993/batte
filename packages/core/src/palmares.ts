/**
 * Palmarès du tableau de bord (mission « le palmarès du tableau de bord,
 * décidé par le porteur ») : classement des produits — deux groupes séparés,
 * transformé (crêpes) et revendu, jamais mélangés (choix explicite du
 * porteur) — et des fournisseurs, chacun sur plusieurs critères.
 *
 * DÉCISIONS PRISES ET LEUR JUSTIFICATION VIVENT ICI, PAS SEULEMENT DANS LE
 * RAPPORT DE MISSION : un lecteur qui tombe sur ce fichier dans six mois doit
 * comprendre le POURQUOI sans retrouver la conversation d'origine.
 *
 * 1. « Marge par minute de cuisson » (le critère demandé le plus juste
 *    économiquement, le stand étant limité par la CAPACITÉ DE CUISSON plutôt
 *    que par la demande) N'EST PAS CALCULABLE aujourd'hui : il exige un TEMPS
 *    DE CUISSON PAR RECETTE, qui n'existe pas en base. Le seul paramètre
 *    proche, `capacite_cuisson_crepes_par_heure`, est GLOBAL — pas par
 *    recette — et l'utiliser reviendrait à répartir une capacité commune sur
 *    une seule recette, un chiffre inventé qui aurait l'air juste. Ce fichier
 *    ne le calcule donc PAS : `margeParMinuteCuissonCents` vaut toujours
 *    `null`, avec une raison qui NOMME le manque plutôt que de le cacher.
 *    Pour un produit REVENDU, la raison est différente et plus forte : ce
 *    n'est pas une donnée manquante, c'est une question SANS OBJET — un pot
 *    de sirop ne passe jamais sur la plaque, diviser sa marge par zéro
 *    minute n'a pas de sens mathématique, encore moins métier.
 *
 * 2. Les cinq critères fournisseur ne sont PAS tous calculables aujourd'hui.
 *    Voir le rapport de mission pour le tableau complet ; en résumé :
 *      - économie générée         : calculable (module Économies, fiche 12) ;
 *      - fiabilité de facturation : calculable (`factureLigne.ecartPrixCents`,
 *        agrégé par facture puis par fournisseur) ;
 *      - prix à ingrédient comparable : calculable, MAIS seulement pour les
 *        ingrédients fournis par au moins DEUX fournisseurs actifs — jamais
 *        un prix moyen global (comparer un meunier à un grossiste en
 *        boissons n'a aucun sens, mission du porteur) ;
 *      - délai de livraison        : PAS calculable aujourd'hui — le modèle
 *        de données le permettrait (`reception.commandeId` existe), mais
 *        aucune lecture existante n'expose une réception avec la date
 *        d'envoi de sa commande d'origine ;
 *      - qualité produit           : PAS calculable aujourd'hui — aucune
 *        lecture existante n'expose `lot.fournisseurId` aux côtés des
 *        non-conformités ou des statuts de lot bloqués/en quarantaine.
 *    Ces deux derniers valent TOUJOURS `null`, jamais une note inventée
 *    (CLAUDE.md §7 : « une valeur inconnue vaut `null`, jamais un motif qui
 *    n'existe pas » — même doctrine appliquée ici à une note fournisseur).
 *
 * 3. Fenêtre de classement : 365 jours glissants, jamais une année civile.
 *    Un « depuis toujours » fige le classement de l'an dernier ; une année
 *    civile stricte redevient quasi vide chaque 1er janvier (le pire moment
 *    pour un tableau de bord, qui se lit toute l'année) ; « depuis la
 *    dernière session » est du bruit. 365 jours glissants couvrent un cycle
 *    saisonnier complet à tout moment de l'année, sans jamais retomber à
 *    zéro d'un coup.
 *
 * 4. Échantillon insuffisant : un classement sur trop peu de données ne se
 *    cache pas derrière un tableau qui a l'air normal. Le seuil retenu
 *    (`SEUIL_MINIMUM_ECHANTILLON_PALMARES`) reprend le chiffre DÉJÀ posé par
 *    la doctrine produit comme critère de succès (docs/07 §0 : « quatre
 *    sessions consécutives saisies intégralement ») plutôt que d'en inventer
 *    un nouveau.
 *
 * Règle d'architecture n°1 (CLAUDE.md §3) : tout ce fichier est pur, testé,
 * et ignore totalement SQLite/Fastify/React. Les dépôts (`packages/db`)
 * fournissent les lignes déjà lues ; ce fichier les agrège, les classe et
 * décide ce qui est affichable.
 */

import { ratioEnPointsDeBase, type Centimes, type PointsDeBase } from './argent.js';
import { ajouterJours } from './horodatage.js';

/**
 * Nombre minimum d'événements sous-jacents (sessions closes pour les
 * produits ; factures rapprochées + lignes d'économie pour les fournisseurs)
 * en dessous duquel un classement ne s'affiche pas. Voir le point 4 de
 * l'en-tête de ce fichier pour la provenance du chiffre.
 */
export const SEUIL_MINIMUM_ECHANTILLON_PALMARES = 4;

/** Fenêtre de classement, en jours glissants. Voir le point 3 de l'en-tête de ce fichier. */
export const JOURS_PERIODE_PALMARES = 365;

/* ═══════════════════════════════════════════════════════════════════════════
   Période
   ═══════════════════════════════════════════════════════════════════════════ */

export type PeriodePalmares = {
  readonly debut: string;
  readonly fin: string;
  readonly jours: number;
};

/** Bornes de la fenêtre glissante, calculées depuis un jour civil de référence. */
export function bornesPeriodePalmares(jourReference: string): PeriodePalmares {
  return {
    debut: ajouterJours(jourReference, -JOURS_PERIODE_PALMARES),
    fin: jourReference,
    jours: JOURS_PERIODE_PALMARES,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Produits — transformé (crêpes) et revendu, classements séparés
   ═══════════════════════════════════════════════════════════════════════════ */

export const CRITERES_PRODUIT = [
  'marge_totale',
  'marge_unitaire',
  'volume_vendu',
  'marge_par_minute_cuisson',
] as const;
export type CritereProduit = (typeof CRITERES_PRODUIT)[number];

export type NatureProduitPalmares = 'transforme' | 'revendu';

export type LigneVenteProduit = {
  readonly produitVenteId: string;
  readonly quantite: number;
  readonly montantCents: Centimes;
};

export type AgregatVenteProduit = {
  readonly volumeVendu: number;
  readonly caGenereCents: Centimes;
};

/**
 * Agrège des lignes de vente (déjà chargées, session par session, par
 * l'appelant — voir le rapport de mission pour la raison : aucune lecture
 * existante n'agrège les ventes par produit sur une fenêtre de dates) par
 * produit vendu.
 */
export function agregerVentesParProduit(
  ventes: readonly LigneVenteProduit[],
): Map<string, AgregatVenteProduit> {
  const agregats = new Map<string, AgregatVenteProduit>();
  for (const v of ventes) {
    const courant = agregats.get(v.produitVenteId) ?? { volumeVendu: 0, caGenereCents: 0 };
    agregats.set(v.produitVenteId, {
      volumeVendu: courant.volumeVendu + v.quantite,
      caGenereCents: courant.caGenereCents + v.montantCents,
    });
  }
  return agregats;
}

/** Un produit du catalogue (transformé ou revendu — les menus n'entrent jamais ici, voir le rapport de mission). */
export type ProduitPourClassement = {
  readonly produitVenteId: string;
  readonly nom: string;
  readonly nature: NatureProduitPalmares;
  /** Coût matière UNITAIRE actuel (catalogue), `null` si inconnu — `coutRevientProduit`. */
  readonly coutMatiereUnitaireCents: Centimes | null;
};

export type LigneClassementProduit = {
  readonly produitVenteId: string;
  readonly nom: string;
  readonly nature: NatureProduitPalmares;
  readonly volumeVendu: number;
  readonly caGenereCents: Centimes;
  /** `null` uniquement si le coût matière actuel du produit est inconnu. */
  readonly margeTotaleGenereeCents: Centimes | null;
  readonly margeUnitaireMoyenneCents: Centimes | null;
  /** Toujours `null` aujourd'hui — voir `raisonMargeParMinuteCuissonIndisponible`. */
  readonly margeParMinuteCuissonCents: null;
  readonly raisonMargeParMinuteCuissonIndisponible: string;
};

/** Le champ est manquant : `capacite_cuisson_crepes_par_heure` est global, pas par recette. */
export const RAISON_MARGE_MINUTE_TRANSFORME_INDISPONIBLE =
  'Nécessite un temps de cuisson par recette, non renseigné en base (seule une capacité ' +
  'de cuisson globale existe aujourd’hui, pas par recette).';

/** Le champ est SANS OBJET : zéro minute de plaque, jamais une donnée absente. */
export const RAISON_MARGE_MINUTE_REVENDU_INDISPONIBLE =
  'Sans objet : un produit revendu ne consomme aucune minute de cuisson.';

/** Construit la ligne de classement d'UN produit, sur une période déjà agrégée par l'appelant. */
export function construireLigneClassementProduit(
  produit: ProduitPourClassement,
  agregat: AgregatVenteProduit | undefined,
): LigneClassementProduit {
  const volumeVendu = agregat?.volumeVendu ?? 0;
  const caGenereCents = agregat?.caGenereCents ?? 0;

  const margeTotaleGenereeCents =
    produit.coutMatiereUnitaireCents === null
      ? null
      : caGenereCents - volumeVendu * produit.coutMatiereUnitaireCents;

  const margeUnitaireMoyenneCents =
    margeTotaleGenereeCents === null || volumeVendu === 0
      ? null
      : Math.round(margeTotaleGenereeCents / volumeVendu);

  return {
    produitVenteId: produit.produitVenteId,
    nom: produit.nom,
    nature: produit.nature,
    volumeVendu,
    caGenereCents,
    margeTotaleGenereeCents,
    margeUnitaireMoyenneCents,
    margeParMinuteCuissonCents: null,
    raisonMargeParMinuteCuissonIndisponible:
      produit.nature === 'transforme'
        ? RAISON_MARGE_MINUTE_TRANSFORME_INDISPONIBLE
        : RAISON_MARGE_MINUTE_REVENDU_INDISPONIBLE,
  };
}

/** Un produit jamais vendu sur la période n'a rien à faire dans un classement de ventes. */
export function produitsVendusSurPeriode(
  lignes: readonly LigneClassementProduit[],
): LigneClassementProduit[] {
  return lignes.filter((l) => l.volumeVendu > 0);
}

/**
 * Trie un classement de produits par le critère choisi. Les valeurs inconnues
 * (`null`) vont TOUJOURS en fin de liste, jamais mélangées ni premières (même
 * convention que `routes/lieux-rentabilite.ts`). `marge_par_minute_cuisson`
 * n'a aucun ordre à ce jour (aucune valeur n'est jamais renseignée) : rendu
 * inchangé.
 */
export function trierClassementProduits(
  lignes: readonly LigneClassementProduit[],
  critere: CritereProduit,
): LigneClassementProduit[] {
  if (critere === 'marge_par_minute_cuisson') return [...lignes];

  return [...lignes].sort((a, b) => {
    const valeurDe = (l: LigneClassementProduit): number | null => {
      switch (critere) {
        case 'marge_totale':
          return l.margeTotaleGenereeCents;
        case 'marge_unitaire':
          return l.margeUnitaireMoyenneCents;
        case 'volume_vendu':
          return l.volumeVendu;
      }
    };
    const va = valeurDe(a);
    const vb = valeurDe(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va; // décroissant sur les trois critères calculables : le meilleur en tête
  });
}

export type DivergenceClassementProduits = {
  readonly nature: NatureProduitPalmares;
  readonly nomPlusVendu: string;
  readonly nomPlusRentable: string;
};

/**
 * Le produit le plus VENDU (volume) est-il un AUTRE que le plus RENTABLE
 * (marge totale) ? C'est une INFORMATION à afficher telle quelle, jamais un
 * problème à cacher derrière une moyenne (mission du porteur : « votre crêpe
 * la plus vendue n'est pas la plus rentable » est exactement ce qu'un
 * tableau de bord doit dire).
 *
 * `null` quand la comparaison n'a rien d'honnête à dire : moins de deux
 * produits vendus sur la période, marge totale inconnue pour le premier de ce
 * classement, ou les deux premiers coïncident (rien à signaler).
 */
export function detecterDivergenceVenteRentabilite(
  nature: NatureProduitPalmares,
  lignesVenduesSurPeriode: readonly LigneClassementProduit[],
): DivergenceClassementProduits | null {
  if (lignesVenduesSurPeriode.length < 2) return null;

  const parVolume = trierClassementProduits(lignesVenduesSurPeriode, 'volume_vendu');
  const parMarge = trierClassementProduits(lignesVenduesSurPeriode, 'marge_totale');

  const topVolume = parVolume[0];
  const topMarge = parMarge[0];
  if (topVolume === undefined || topMarge === undefined) return null;
  if (topMarge.margeTotaleGenereeCents === null) return null;
  if (topVolume.produitVenteId === topMarge.produitVenteId) return null;

  return { nature, nomPlusVendu: topVolume.nom, nomPlusRentable: topMarge.nom };
}

export type GroupePalmaresProduits = {
  readonly nature: NatureProduitPalmares;
  readonly lignes: readonly LigneClassementProduit[];
  readonly echantillonSuffisant: boolean;
  readonly raisonEchantillonInsuffisant: string | null;
  readonly divergenceVenteRentabilite: DivergenceClassementProduits | null;
};

function raisonEchantillonInsuffisantProduits(nbSessionsClosesPeriode: number): string {
  return (
    `${nbSessionsClosesPeriode} session${nbSessionsClosesPeriode > 1 ? 's' : ''} close${nbSessionsClosesPeriode > 1 ? 's' : ''} ` +
    `sur la période — moins que le minimum de ${SEUIL_MINIMUM_ECHANTILLON_PALMARES} retenu pour classer honnêtement : ` +
    'un palmarès sur un échantillon aussi réduit serait du bruit, pas une mesure.'
  );
}

/**
 * Construit le classement d'UNE nature (transformé ou revendu) à partir de
 * TOUTES les lignes déjà calculées (les deux natures mélangées) : ce filtre
 * garantit que les deux classements ne se contaminent jamais l'un l'autre —
 * décision explicite du porteur, « chacun comparé à ses semblables ».
 */
export function construireGroupePalmaresProduits(
  nature: NatureProduitPalmares,
  toutesLesLignes: readonly LigneClassementProduit[],
  nbSessionsClosesPeriode: number,
): GroupePalmaresProduits {
  const lignes = produitsVendusSurPeriode(toutesLesLignes.filter((l) => l.nature === nature));
  const echantillonSuffisant = nbSessionsClosesPeriode >= SEUIL_MINIMUM_ECHANTILLON_PALMARES;

  return {
    nature,
    lignes,
    echantillonSuffisant,
    raisonEchantillonInsuffisant: echantillonSuffisant
      ? null
      : raisonEchantillonInsuffisantProduits(nbSessionsClosesPeriode),
    divergenceVenteRentabilite: echantillonSuffisant
      ? detecterDivergenceVenteRentabilite(nature, lignes)
      : null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Fournisseurs — cinq critères demandés, deux calculables moyennant rien de
   plus, un troisième sous condition d'ingrédient comparable, deux hors de
   portée aujourd'hui (voir le point 2 de l'en-tête de ce fichier)
   ═══════════════════════════════════════════════════════════════════════════ */

export const CRITERES_FOURNISSEUR = [
  'economie_generee',
  'fiabilite_facturation',
  'prix_comparable',
  'delai_livraison',
  'qualite_produit',
] as const;
export type CritereFournisseur = (typeof CRITERES_FOURNISSEUR)[number];

/* ─── Critère 1 : économie générée (calculable — module Économies) ────────── */

export type LigneEconomieFournisseur = {
  readonly fournisseurId: string;
  readonly economieCents: Centimes;
};

/** Économie totale par fournisseur sur la période. Un fournisseur absent n'a réalisé aucune économie — un vrai zéro, jamais une inconnue. */
export function agregerEconomiesParFournisseur(
  lignes: readonly LigneEconomieFournisseur[],
): Map<string, Centimes> {
  const totaux = new Map<string, Centimes>();
  for (const l of lignes) {
    totaux.set(l.fournisseurId, (totaux.get(l.fournisseurId) ?? 0) + l.economieCents);
  }
  return totaux;
}

/* ─── Critère 2 : fiabilité de facturation (calculable — factureLigne.ecartPrixCents) ─── */

export type FactureFiabilite = {
  readonly fournisseurId: string;
  readonly montantTotalCents: Centimes;
  /** Écart AGRÉGÉ de la facture (`FactureResume.ecartTotalCents`) : positif ou négatif, un dérapage dans les deux sens compte. */
  readonly ecartTotalCents: Centimes;
};

export type FiabiliteFacturation = {
  readonly nbFactures: number;
  readonly montantCumuleCents: Centimes;
  readonly ecartAbsoluCumuleCents: Centimes;
  /** Écart moyen, en points de base du montant facturé. `null` seulement si le montant cumulé est nul. */
  readonly ecartMoyenBp: PointsDeBase | null;
};

/**
 * Un fournisseur qui facture EXACTEMENT ce qu'il a livré ne dérape jamais
 * (mission du porteur). L'écart est pris en VALEUR ABSOLUE : facturer moins
 * que prévu est tout autant un dérapage qu'facturer plus — les deux disent
 * que le prix facturé n'était pas prévisible.
 */
export function agregerFiabiliteFacturationParFournisseur(
  factures: readonly FactureFiabilite[],
): Map<string, FiabiliteFacturation> {
  const cumuls = new Map<
    string,
    { nbFactures: number; montantCumuleCents: number; ecartAbsoluCumuleCents: number }
  >();

  for (const f of factures) {
    const courant = cumuls.get(f.fournisseurId) ?? {
      nbFactures: 0,
      montantCumuleCents: 0,
      ecartAbsoluCumuleCents: 0,
    };
    cumuls.set(f.fournisseurId, {
      nbFactures: courant.nbFactures + 1,
      montantCumuleCents: courant.montantCumuleCents + f.montantTotalCents,
      ecartAbsoluCumuleCents: courant.ecartAbsoluCumuleCents + Math.abs(f.ecartTotalCents),
    });
  }

  const resultat = new Map<string, FiabiliteFacturation>();
  for (const [fournisseurId, cumul] of cumuls) {
    resultat.set(fournisseurId, {
      ...cumul,
      ecartMoyenBp:
        cumul.montantCumuleCents === 0
          ? null
          : ratioEnPointsDeBase(cumul.ecartAbsoluCumuleCents, cumul.montantCumuleCents),
    });
  }
  return resultat;
}

/* ─── Critère 3 : prix à ingrédient comparable (calculable, sous condition) ─── */

export type ConditionnementPourComparaison = {
  readonly ingredientId: string;
  readonly fournisseurId: string;
  readonly prixCents: Centimes;
  readonly quantiteUniteRef: number;
  readonly datePrix: string;
  readonly actif: boolean;
};

export type PrixComparableFournisseur = {
  /** Nombre d'ingrédients partagés avec au moins un autre fournisseur actif. */
  readonly nbIngredientsComparables: number;
  /** Écart moyen, en points de base, au-dessus du moins cher SUR CES ingrédients. 0 = toujours le moins cher observé. `null` si aucun ingrédient comparable. */
  readonly ecartMoyenBp: PointsDeBase | null;
};

/**
 * Compare les fournisseurs À INGRÉDIENT COMPARABLE, jamais sur un prix moyen
 * global : comparer un meunier à un grossiste en boissons n'a aucun sens
 * (mission du porteur). Un ingrédient n'entre dans la comparaison QUE s'il a
 * au moins deux fournisseurs ACTIFS distincts qui le vendent aujourd'hui —
 * sinon il n'y a rien à comparer, ni bon ni mauvais.
 *
 * Un fournisseur qui n'a AUCUN ingrédient comparable (cas fréquent d'une
 * petite structure à un seul fournisseur par ingrédient) n'apparaît pas dans
 * la Map rendue : à l'appelant de le lire comme `null`, jamais comme un prix
 * neutre ou moyen.
 */
export function comparerPrixParIngredient(
  conditionnements: readonly ConditionnementPourComparaison[],
): Map<string, PrixComparableFournisseur> {
  // 1. Le prix ACTIF le plus récent par couple (ingrédient, fournisseur) :
  // l'historique de prix (D-017) porte plusieurs lignes par couple, seule la
  // plus récente ACTIVE représente ce que ce fournisseur facture aujourd'hui.
  const dernierParPaire = new Map<string, ConditionnementPourComparaison>();
  for (const c of conditionnements) {
    if (!c.actif) continue;
    const cle = `${c.ingredientId}::${c.fournisseurId}`;
    const existant = dernierParPaire.get(cle);
    if (existant === undefined || c.datePrix > existant.datePrix) dernierParPaire.set(cle, c);
  }

  // 2. Regroupement par ingrédient.
  const parIngredient = new Map<string, ConditionnementPourComparaison[]>();
  for (const c of dernierParPaire.values()) {
    const liste = parIngredient.get(c.ingredientId) ?? [];
    liste.push(c);
    parIngredient.set(c.ingredientId, liste);
  }

  // 3. Pour chaque ingrédient à >= 2 fournisseurs, écart de chacun au moins cher.
  const ecartsParFournisseur = new Map<string, number[]>();
  for (const liste of parIngredient.values()) {
    if (liste.length < 2) continue; // un seul fournisseur pour cet ingrédient : pas comparable

    const prixUnitaires = liste.map((c) => ({
      fournisseurId: c.fournisseurId,
      prixUnitaire: c.prixCents / c.quantiteUniteRef,
    }));
    const prixMin = Math.min(...prixUnitaires.map((p) => p.prixUnitaire));
    if (prixMin <= 0) continue; // aucune base positive : un écart relatif n'aurait pas de sens

    for (const p of prixUnitaires) {
      const ecartBp = Math.round(((p.prixUnitaire - prixMin) / prixMin) * 10_000);
      const liste2 = ecartsParFournisseur.get(p.fournisseurId) ?? [];
      liste2.push(ecartBp);
      ecartsParFournisseur.set(p.fournisseurId, liste2);
    }
  }

  const resultat = new Map<string, PrixComparableFournisseur>();
  for (const [fournisseurId, ecarts] of ecartsParFournisseur) {
    const moyenne = Math.round(ecarts.reduce((s, v) => s + v, 0) / ecarts.length);
    resultat.set(fournisseurId, { nbIngredientsComparables: ecarts.length, ecartMoyenBp: moyenne });
  }
  return resultat;
}

/* ─── Critères 4 et 5 : hors de portée aujourd'hui — voir le point 2 de l'en-tête ─── */

export const RAISON_DELAI_LIVRAISON_INDISPONIBLE =
  'Nécessite une date de commande ET une date de réception reliées entre elles ' +
  '(commande_fournisseur.date_envoi / reception.date_reception via reception.commande_id) : ' +
  "le modèle de données le permettrait, mais aucune lecture existante n'expose une réception " +
  "avec la date d'envoi de sa commande d'origine — nouvelle lecture à ajouter dans packages/db.";

export const RAISON_QUALITE_PRODUIT_INDISPONIBLE =
  'Nécessite de savoir quel fournisseur a livré un lot en non-conformité, en quarantaine ou ' +
  "bloqué : aucune lecture existante n'expose lot.fournisseur_id aux côtés des non-conformités " +
  'ou des statuts de lot — nouvelle lecture à ajouter dans packages/db.';

/* ─── Assemblage et tri ────────────────────────────────────────────────── */

export type LigneClassementFournisseur = {
  readonly fournisseurId: string;
  readonly nom: string;
  readonly economieGenereeCents: Centimes;
  /** `null` si aucune facture non annulée n'a été rapprochée sur la période : inconnu, jamais un zéro flatteur. */
  readonly fiabiliteFacturationBp: PointsDeBase | null;
  readonly nbFacturesConsiderees: number;
  /** `null` si ce fournisseur ne partage aucun ingrédient avec un autre fournisseur actif. */
  readonly prixComparableEcartBp: PointsDeBase | null;
  readonly nbIngredientsComparables: number;
  /** Toujours `null` aujourd'hui — voir `RAISON_DELAI_LIVRAISON_INDISPONIBLE`. */
  readonly delaiLivraisonJours: null;
  /** Toujours `null` aujourd'hui — voir `RAISON_QUALITE_PRODUIT_INDISPONIBLE`. */
  readonly qualiteProduitScore: null;
};

export function construireLigneClassementFournisseur(
  fournisseur: { readonly id: string; readonly nom: string },
  economieGenereeCents: Centimes,
  fiabilite: FiabiliteFacturation | undefined,
  prixComparable: PrixComparableFournisseur | undefined,
): LigneClassementFournisseur {
  return {
    fournisseurId: fournisseur.id,
    nom: fournisseur.nom,
    economieGenereeCents,
    fiabiliteFacturationBp: fiabilite?.ecartMoyenBp ?? null,
    nbFacturesConsiderees: fiabilite?.nbFactures ?? 0,
    prixComparableEcartBp: prixComparable?.ecartMoyenBp ?? null,
    nbIngredientsComparables: prixComparable?.nbIngredientsComparables ?? 0,
    delaiLivraisonJours: null,
    qualiteProduitScore: null,
  };
}

/**
 * Trie un classement de fournisseurs par le critère choisi. Les deux critères
 * hors de portée (`delai_livraison`, `qualite_produit`) n'ont aucun ordre à ce
 * jour : rendu inchangé. Sur `fiabilite_facturation` et `prix_comparable`,
 * PLUS PETIT est MEILLEUR (moins d'écart, plus proche du moins cher) — sens
 * inverse de `economie_generee`, où plus grand est meilleur.
 */
export function trierClassementFournisseurs(
  lignes: readonly LigneClassementFournisseur[],
  critere: CritereFournisseur,
): LigneClassementFournisseur[] {
  if (critere === 'delai_livraison' || critere === 'qualite_produit') return [...lignes];

  return [...lignes].sort((a, b) => {
    const valeurDe = (l: LigneClassementFournisseur): number | null => {
      switch (critere) {
        case 'economie_generee':
          return l.economieGenereeCents;
        case 'fiabilite_facturation':
          return l.fiabiliteFacturationBp;
        case 'prix_comparable':
          return l.prixComparableEcartBp;
      }
    };
    const va = valeurDe(a);
    const vb = valeurDe(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;

    const croissant = critere === 'fiabilite_facturation' || critere === 'prix_comparable';
    return croissant ? va - vb : vb - va;
  });
}

export type GroupePalmaresFournisseurs = {
  readonly lignes: readonly LigneClassementFournisseur[];
  readonly echantillonSuffisant: boolean;
  readonly raisonEchantillonInsuffisant: string | null;
};

function raisonEchantillonInsuffisantFournisseurs(nbSignaux: number): string {
  return (
    `${nbSignaux} mouvement${nbSignaux > 1 ? 's' : ''} d'achat (factures rapprochées + lignes ` +
    `d'économie) sur la période — moins que le minimum de ${SEUIL_MINIMUM_ECHANTILLON_PALMARES} ` +
    'retenu pour classer honnêtement : un palmarès fournisseurs sur un échantillon aussi réduit ' +
    'serait du bruit, pas une mesure.'
  );
}

/**
 * Un fournisseur SANS AUCUN signal d'activité sur la période (aucune facture,
 * aucune économie) n'apparaît pas dans le classement : il n'a rien fait, bon
 * ou mauvais, pendant cette fenêtre — l'inclure à zéro partout le ferait
 * paraître moins bien noté qu'il ne l'est, une calomnie plutôt qu'une mesure
 * (mission du porteur : « un fournisseur noté 0/5 parce qu'on n'a pas la
 * donnée est une calomnie »).
 */
export function fournisseursActifsSurPeriode(
  lignes: readonly LigneClassementFournisseur[],
): LigneClassementFournisseur[] {
  return lignes.filter((l) => l.economieGenereeCents !== 0 || l.nbFacturesConsiderees > 0);
}

export function construireGroupePalmaresFournisseurs(
  toutesLesLignes: readonly LigneClassementFournisseur[],
  nbFacturesConsiderees: number,
  nbLignesEconomiesConsiderees: number,
): GroupePalmaresFournisseurs {
  const lignes = fournisseursActifsSurPeriode(toutesLesLignes);
  const nbSignaux = nbFacturesConsiderees + nbLignesEconomiesConsiderees;
  const echantillonSuffisant = nbSignaux >= SEUIL_MINIMUM_ECHANTILLON_PALMARES;

  return {
    lignes,
    echantillonSuffisant,
    raisonEchantillonInsuffisant: echantillonSuffisant
      ? null
      : raisonEchantillonInsuffisantFournisseurs(nbSignaux),
  };
}
