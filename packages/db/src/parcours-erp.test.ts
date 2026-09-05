/**
 * PARCOURS ERP — la these de CLAUDE.md §0 mise a l'epreuve de bout en bout.
 *
 *   « les modules ne sont pas des applications juxtaposees, ils forment UNE
 *     SEULE CHAINE DE DONNEES. Une reception de farine chez le meunier doit se
 *     propager, SANS RESSAISIE, jusqu'a la marge nette du dimanche suivant et
 *     jusqu'au registre AFSCA. »
 *
 * Tous les autres fichiers de test de ce paquet verifient UN service isole.
 * Celui-ci ne verifie aucun service : il verifie les SOUDURES entre eux. Un
 * module peut etre parfaitement juste et rester debranche du suivant — c'est
 * exactement ce que ce fichier doit rendre impossible.
 *
 * Regle de redaction imposee par cette intention : chaque assertion porte sur
 * une valeur PROPAGEE, lue en base ou rendue par un depot, jamais sur un
 * nombre recalcule dans le test. Si le test refaisait le calcul dans son coin,
 * il passerait tout aussi bien avec des modules totalement deconnectes — et ne
 * prouverait donc rien.
 *
 * Meme raison pour l'absence de litteraux metier : ni taux de commission, ni
 * seuil legal, ni duree de conservation ne sont ecrits ici. Ils sont lus depuis
 * `parametre` / `CATALOGUE_PARAMETRES`. Un test qui code « 1,69 % » en dur
 * casse le jour ou le contrat SumUp change, sans qu'aucune regle metier n'ait
 * bouge : ce serait un faux positif de regression.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  ErreurMetier,
  appliquerPointsDeBase,
  definitionParametre,
  rendementReelBp,
} from '@batte/core';
import { and, eq, ne } from 'drizzle-orm';
import { creerBase, sqliteBrut, type BaseBatte } from './client.js';
import { migrer } from './migrer.js';
import { seed } from './seed/index.js';
import { seedDemonstration } from './seed/demonstration.js';
import {
  fournisseur,
  ingredient,
  lieuMarche,
  lot,
  mouvementStock,
  production,
  productionConsommation,
  produitGarniture,
  produitVente,
  recette,
  sessionMarche,
  sessionVente,
} from './schema.js';
import { lireParametres } from './depots/parametres.js';
import { lotsDeLIngredient, tousLesLots, verifierInvariantLots } from './depots/stock.js';
import { syntheseExercice } from './depots/comptabilite.js';
import { creerCompositionMenu } from './depots/menus.js';
import { creerProduit } from './depots/referentiel.js';
import { tableauSeuils } from './depots/sessions.js';
import { tracabiliteAmontSession, tracabiliteAvalLot } from './depots/tracabilite.js';
import { enregistrerReception, type ResultatReception } from './services/reception.js';
import { annulerMouvement } from './services/mouvements.js';
import { lancerProduction, saisirRealise, type ResultatProduction } from './services/production.js';
import { annulerSession, cloturerSession, creerSession } from './services/sessions.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Calendrier du parcours

   Les dates suivent l'ordre reel d'utilisation : on approvisionne dans la
   semaine, on produit la veille, on vend le dimanche. Elles sont volontairement
   DISTINCTES, pour qu'une confusion entre date de reception, date de mouvement
   et date de session se voie immediatement au lieu de se compenser.
   ═══════════════════════════════════════════════════════════════════════════ */

const JOUR_APPRO_EPICERIE = '2026-07-22';
const JOUR_APPRO_FARINE_A = '2026-07-23';
const JOUR_APPRO_FARINE_B = '2026-07-24';
const JOUR_PRODUCTION = '2026-07-25';
const JOUR_SESSION = '2026-07-26';
const ANNEE = 2026;

/**
 * Les deux lots de farine du scenario.
 *
 * DLC et prix DIFFERENTS, c'est tout l'enjeu : si les deux lots etaient
 * identiques, la FEFO et la valorisation lot par lot rendraient le meme
 * resultat qu'une moyenne, et le test ne distinguerait plus un ERP d'une
 * calculette. Le lot le moins cher est aussi le plus proche de la DLC : la
 * FEFO doit donc le servir EN PREMIER, ce qui rend le cout matiere sensible a
 * l'ordre de consommation.
 */
const FARINE_LOT_A = {
  quantite: 1000,
  prixLigneCents: 90,
  dateDlc: '2026-08-05',
  numeroLotFournisseur: 'MEUNIER-A',
} as const;

const FARINE_LOT_B = {
  quantite: 2000,
  prixLigneCents: 300,
  dateDlc: '2026-12-31',
  numeroLotFournisseur: 'MEUNIER-B',
} as const;

/** Approvisionnement volontairement large : seule la farine doit etre limitante. */
const QUANTITE_EPICERIE = 50_000;
const PRIX_LIGNE_EPICERIE_CENTS = 1000;

/** Volume vise pour la fournee du dimanche. */
const VOLUME_PRODUIT_ML = 5000;

/** Quantites et prix de vente EN LIGNE DIRECTE du dimanche. Donnees d'entree du test, pas des regles. */
const CREPES_VENDUES_DIRECT = 50;
const PRIX_CREPE_CENTS = 300;
const POTS_VENDUS_DIRECT = 8;
const PRIX_POT_CENTS = 750;

/**
 * LE MENU du parcours — nouveaute de la nuit du 29 au 30/07/2026 (CLAUDE.md §6,
 * §0). Il groupe UNE crepe garnie et UN pot revendu : les deux natures dans un
 * seul conteneur, exactement le cas qui rend la ventilation transforme/revendu
 * obligatoire (`packages/core/src/menus.ts`) — un menu 100 % transforme ou
 * 100 % revendu ne testerait rien que la vente directe ne teste deja.
 *
 * Prix INFERIEUR a la somme des prix catalogue des deux composants : la remise
 * doit se repartir entre eux, jamais rester un bloc non ventile.
 *
 * La crepe du menu est DELIBEREMENT distincte de celle vendue en ligne directe
 * (`crepeProduitId`) et n'est vendue, dans tout ce parcours, QUE via ce menu :
 * c'est le cas « garniture jamais vendue seule » de l'audit AFSCA du
 * 30/07/2026 (`depots/tracabilite-menu-garniture.test.ts`), repris ici DANS LA
 * MEME chaine que la farine du meunier plutot que dans un decor isole.
 */
const MENU_QUANTITE_CREPE_PAR_MENU = 1;
const MENU_QUANTITE_POT_PAR_MENU = 1;
const MENU_PRIX_CENTS = 900;
const MENUS_VENDUS = 5;
/** Contribution du menu aux crepes et aux pots reellement ecoules — jamais recalculee, juste nommee. */
const CREPES_VENDUES_VIA_MENU = MENUS_VENDUS * MENU_QUANTITE_CREPE_PAR_MENU;
const POTS_VENDUS_VIA_MENU = MENUS_VENDUS * MENU_QUANTITE_POT_PAR_MENU;
/** Total REELLEMENT vendu, direct + via menu : c'est CE total qui doit sortir du stock. */
const CREPES_VENDUES_TOTAL = CREPES_VENDUES_DIRECT + CREPES_VENDUES_VIA_MENU;
const POTS_VENDUS_TOTAL = POTS_VENDUS_DIRECT + POTS_VENDUS_VIA_MENU;

const FRAIS = {
  emplacementCents: 2200,
  deplacementCents: 1400,
  gazCents: 600,
  diversCents: 0,
} as const;
const FONDS_CAISSE_CENTS = 6000;
const CA_CARTE_CENTS = 9000;
const CREPES_INVENDUES = 4;
const CREPES_CASSEES = 2;
const VOLUME_REEL_ML = 4800;
const CREPES_REELLES = CREPES_VENDUES_TOTAL + CREPES_INVENDUES + CREPES_CASSEES;

/* ═══════════════════════════════════════════════════════════════════════════
   Mise en place
   ═══════════════════════════════════════════════════════════════════════════ */

function baseNeuve(): BaseBatte {
  const base = creerBase(':memory:');
  migrer(base);
  seed(base);
  seedDemonstration(base);
  return base;
}

/**
 * Empreinte integrale de la base : toutes les tables, toutes les lignes.
 *
 * Sert au scenario « production infaisable ». Comparer des COMPTEURS de lignes
 * ne suffirait pas : une ecriture qui en remplace une autre laisserait le
 * compteur intact. On compare donc le CONTENU, trie pour ne pas dependre de
 * l'ordre de lecture de SQLite.
 */
function empreinteBase(base: BaseBatte): string {
  const brut = sqliteBrut(base);
  const tables = brut
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as readonly { name: string }[];

  return [...tables]
    .map((t) => t.name)
    .sort()
    .map((nom) => {
      const lignes = brut.prepare(`SELECT * FROM "${nom}"`).all() as readonly unknown[];
      const serialisees = lignes.map((l) => JSON.stringify(l)).sort();
      return `${nom}\n  ${serialisees.join('\n  ')}`;
    })
    .join('\n');
}

/**
 * L'article REVENDU du parcours, pris DANS le jeu de demonstration.
 *
 * Il etait autrefois fabrique ici, faute de mieux : la graine ne contenait que
 * des produits transformes. Elle en contient desormais un — c'est precisement
 * le defaut que `seed/demonstration.test.ts` interdit de reintroduire — et le
 * prendre a la source vaut mieux que d'en creer un second. Ce parcours verifie
 * alors la chaine sur les donnees que l'utilisateur voit vraiment a l'ecran, et
 * non sur un decor monte pour l'occasion.
 *
 * L'echec est BRUYANT si la graine perdait son article revendu : sans une seule
 * ligne de revente, ce fichier validerait une ventilation qui ne ventile rien.
 */
function articleRevenduDeLaDemonstration(base: BaseBatte): {
  ingredientId: string;
  produitId: string;
} {
  const produit = base
    .select({ id: produitVente.id, ingredientId: produitVente.ingredientId })
    .from(produitVente)
    .where(eq(produitVente.nature, 'revendu'))
    .get();

  if (produit === undefined || produit.ingredientId === null) {
    throw new Error(
      'Le jeu de démonstration ne contient aucun produit de nature « revendu » rattaché à un ' +
        'ingrédient : la ventilation transformé / revendu de CLAUDE.md §6 ne ventilerait rien.',
    );
  }

  return { ingredientId: produit.ingredientId, produitId: produit.id };
}

/**
 * La crepe GARNIE du menu, DISTINCTE de celle vendue en ligne directe.
 *
 * Prise elle aussi dans le jeu de demonstration : elle est garnie de
 * « Sirop de Liège en vrac », un ingredient different de la vergeoise qui
 * garnit la crepe vendue directement — ce qui permet de distinguer sans
 * ambiguite, cote traçabilite, ce qui sort du stock via la vente directe et ce
 * qui sort via le menu. Dans TOUT ce parcours, ce produit n'est vendu que par
 * le menu : c'est exactement le cas « garniture jamais vendue seule » de
 * l'audit AFSCA du 30/07/2026 (`depots/tracabilite-menu-garniture.test.ts`),
 * repris ici dans la MEME chaine que la farine plutot que dans un decor isole.
 *
 * L'echec est BRUYANT si la graine ne fournit pas une seconde crepe garnie :
 * sans elle, le menu de ce parcours ne prouverait rien de plus que la vente
 * directe deja couverte par `crepeProduitId`.
 */
function crepeGarnieDuMenu(
  base: BaseBatte,
  crepeVendueDirectementId: string,
): {
  produitId: string;
  nomProduit: string;
  ingredientGarnitureId: string;
  quantiteGarniturePartUnite: number;
} {
  const ligne = base
    .select({
      produitId: produitVente.id,
      nomProduit: produitVente.nom,
      ingredientGarnitureId: produitGarniture.ingredientId,
      quantiteGarniturePartUnite: produitGarniture.quantiteUniteRef,
    })
    .from(produitGarniture)
    .innerJoin(produitVente, eq(produitVente.id, produitGarniture.produitVenteId))
    .where(
      and(eq(produitVente.nature, 'transforme'), ne(produitVente.id, crepeVendueDirectementId)),
    )
    .get();

  if (ligne === undefined) {
    throw new Error(
      'Le jeu de démonstration ne fournit pas une SECONDE crêpe garnie, distincte de celle ' +
        'vendue en ligne directe : le menu de ce parcours ne pourrait rien prouver de plus que ' +
        "la vente directe déjà couverte, et l'audit AFSCA « garniture jamais vendue seule via un " +
        'menu » (30/07/2026) ne serait pas rejoué dans la chaîne complète.',
    );
  }

  return ligne;
}

/**
 * Tout ce que le parcours a PRODUIT, et rien d'autre.
 *
 * Volontairement pauvre : uniquement des identifiants et les objets rendus par
 * les services. Aucun montant, aucune quantite calculee n'y est stocke — les
 * assertions doivent aller les relire en base, sinon elles verifieraient la
 * memoire du test au lieu de la propagation.
 */
type Parcours = {
  readonly farineId: string;
  readonly siropIngredientId: string;
  readonly siropProduitId: string;
  readonly crepeProduitId: string;
  readonly sessionId: string;
  readonly receptionEpicerie: ResultatReception;
  readonly receptionFarineA: ResultatReception;
  readonly receptionFarineB: ResultatReception;
  readonly productionFournee: ResultatProduction;
  /** Le menu du parcours (voir les constantes MENU_* plus haut). */
  readonly menuProduitId: string;
  /** La crepe INCLUSE dans le menu — jamais vendue en ligne directe (voir `crepeGarnieDuMenu`). */
  readonly crepeMenuProduitId: string;
  readonly crepeMenuNomProduit: string;
  /** Sa garniture propre, distincte de celle de la crepe vendue directement. */
  readonly crepeMenuIngredientGarnitureId: string;
  readonly crepeMenuQuantiteGarniturePartUnite: number;
};

/**
 * Deroule le parcours complet, dans l'ordre reel d'utilisation.
 *
 * La SESSION est creee AVANT la production, et ce n'est pas un artifice de
 * test : c'est la seule sequence qui a du sens metier. On planifie le marche,
 * puis on produit POUR lui — c'est ce rattachement (`production.session_id`)
 * qui fait ensuite remonter le cout matiere jusqu'a la marge nette. Produire
 * d'abord et rattacher apres reviendrait a ressaisir le lien.
 */
function derouleParcours(base: BaseBatte): Parcours {
  const idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
  const idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
  const idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!
    .id;

  const farine = base
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(eq(ingredient.nom, 'Farine de froment T55'))
    .get()!;

  const revendu = articleRevenduDeLaDemonstration(base);

  const crepeProduitId = base
    .select({ id: produitVente.id })
    .from(produitVente)
    .where(eq(produitVente.nature, 'transforme'))
    .get()!.id;

  // --- 0. Le MENU du parcours (referentiel, voir les constantes MENU_*) ----
  // Cree AVANT la cloture : un menu est du referentiel (comme une recette ou
  // un produit), il n'a besoin d'aucune activite prealable. Il combine la
  // crepe garnie DU MENU (jamais vendue en ligne directe) et le MEME article
  // revendu que la ligne directe ci-dessous — precisement pour verifier que
  // les deux canaux de vente d'un meme article se cumulent avant la FEFO
  // (`services/sessions.ts::sortirLesProduitsRevendus`).
  const crepeMenu = crepeGarnieDuMenu(base, crepeProduitId);
  const menuProduitId = creerProduit(base, {
    nom: '[test] Menu crêpe garnie + pot de sirop',
    nature: 'menu',
    recetteId: null,
    ingredientId: null,
    prixCents: MENU_PRIX_CENTS,
    nbCrepes: null,
    volumeMlParUnite: null,
    categorie: 'menu',
    // Vente a emporter, comme les deux produits de demonstration qui le composent.
    consommationSurPlace: false,
  });
  creerCompositionMenu(base, menuProduitId, {
    produitInclusId: crepeMenu.produitId,
    quantite: MENU_QUANTITE_CREPE_PAR_MENU,
  });
  creerCompositionMenu(base, menuProduitId, {
    produitInclusId: revendu.produitId,
    quantite: MENU_QUANTITE_POT_PAR_MENU,
  });

  // --- 1. Receptions fournisseur -------------------------------------------
  // Trois documents distincts : l'epicerie, puis DEUX lots de farine a des prix
  // et des DLC differents. Trois receptions et non une seule, pour que la
  // tracabilite amont ait quelque chose a distinguer en bout de chaine.
  const autresIngredients = base
    .select({ id: ingredient.id })
    .from(ingredient)
    .all()
    .filter((i) => i.id !== farine.id);

  const receptionEpicerie = enregistrerReception(base, {
    fournisseurId: idFournisseur,
    dateReception: JOUR_APPRO_EPICERIE,
    numeroBonLivraison: 'BL-EPICERIE',
    lignes: autresIngredients.map((i) => ({
      ingredientId: i.id,
      quantite: QUANTITE_EPICERIE,
      prixLigneCents: PRIX_LIGNE_EPICERIE_CENTS,
      numeroLotFournisseur: 'LOT-TEST-EPICERIE',
    })),
  });

  const receptionFarineA = enregistrerReception(base, {
    fournisseurId: idFournisseur,
    dateReception: JOUR_APPRO_FARINE_A,
    numeroBonLivraison: 'BL-MEUNIER-A',
    lignes: [{ ingredientId: farine.id, ...FARINE_LOT_A }],
  });

  const receptionFarineB = enregistrerReception(base, {
    fournisseurId: idFournisseur,
    dateReception: JOUR_APPRO_FARINE_B,
    numeroBonLivraison: 'BL-MEUNIER-B',
    lignes: [{ ingredientId: farine.id, ...FARINE_LOT_B }],
  });

  // --- 2. Session planifiee -------------------------------------------------
  const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR_SESSION });

  // --- 3. Production rattachee a la session --------------------------------
  const productionFournee = lancerProduction(base, {
    recetteId: idR1,
    cible: { type: 'volume', volumeMl: VOLUME_PRODUIT_ML },
    dateProduction: JOUR_PRODUCTION,
    sessionId: session.id,
  });

  // --- 4. Saisie du realise -------------------------------------------------
  saisirRealise(base, productionFournee.productionId, {
    volumeReelMl: VOLUME_REEL_ML,
    crepesReelles: CREPES_REELLES,
    ecartMotif: 'Fond de bassine plus important que prévu',
  });

  // --- 5. Cloture de la session --------------------------------------------
  cloturerSession(base, session.id, {
    ventes: [
      {
        produitVenteId: crepeProduitId,
        quantite: CREPES_VENDUES_DIRECT,
        prixUnitaireCents: PRIX_CREPE_CENTS,
      },
      {
        produitVenteId: revendu.produitId,
        quantite: POTS_VENDUS_DIRECT,
        prixUnitaireCents: PRIX_POT_CENTS,
      },
      // Le MENU : une seule ligne de vente ici, comme un ticket de caisse reel
      // — c'est `cloturerSession` qui l'eclate ensuite en composants pour le
      // CA ventile et les sorties de stock (voir la these du maillon 4bis).
      {
        produitVenteId: menuProduitId,
        quantite: MENUS_VENDUS,
        prixUnitaireCents: MENU_PRIX_CENTS,
      },
    ],
    frais: FRAIS,
    fondsCaisseInitialCents: FONDS_CAISSE_CENTS,
    // Especes comptees = fonds de tete + tout ce qui n'a pas ete paye par carte.
    // Le menu compte pour son PRIX PRATIQUE entier (900 c) : c'est un montant
    // de caisse reel, jamais la somme (a priori inconnue du test) de ses parts
    // ventilees — `repartir()` garantit que ces parts somment exactement a ce
    // prix, voir le maillon 4bis.
    especesCompteesCents:
      FONDS_CAISSE_CENTS +
      (CREPES_VENDUES_DIRECT * PRIX_CREPE_CENTS +
        POTS_VENDUS_DIRECT * PRIX_POT_CENTS +
        MENUS_VENDUS * MENU_PRIX_CENTS -
        CA_CARTE_CENTS),
    caCarteCents: CA_CARTE_CENTS,
    crepesProduites: CREPES_REELLES,
    crepesInvendues: CREPES_INVENDUES,
    crepesCassees: CREPES_CASSEES,
    heureDebutReelle: '08:00',
    heureFinReelle: '14:30',
  });

  return {
    farineId: farine.id,
    siropIngredientId: revendu.ingredientId,
    siropProduitId: revendu.produitId,
    crepeProduitId,
    sessionId: session.id,
    receptionEpicerie,
    receptionFarineA,
    receptionFarineB,
    productionFournee,
    menuProduitId,
    crepeMenuProduitId: crepeMenu.produitId,
    crepeMenuNomProduit: crepeMenu.nomProduit,
    crepeMenuIngredientGarnitureId: crepeMenu.ingredientGarnitureId,
    crepeMenuQuantiteGarniturePartUnite: crepeMenu.quantiteGarniturePartUnite,
  };
}

/** Lit la session close. Toutes les assertions de propagation partent d'ici. */
function lireSession(base: BaseBatte, sessionId: string) {
  return base.select().from(sessionMarche).where(eq(sessionMarche.id, sessionId)).get()!;
}

/** Restant d'un lot, tel que le depot le calcule (somme des mouvements). */
function restantDuLot(base: BaseBatte, ingredientId: string, lotId: string): number {
  return lotsDeLIngredient(base, ingredientId).find((l) => l.id === lotId)!.quantiteRestante;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE PARCOURS
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Parcours ERP — du meunier a la marge nette, sans ressaisie', () => {
  let base: BaseBatte;
  let parcours: Parcours;

  // `beforeAll` et non `beforeEach` : le parcours est CONTINU. Chaque `it`
  // ci-dessous inspecte un maillon de la MEME execution, et non un scenario
  // rejoue. C'est le seul montage qui puisse prouver une chaine.
  beforeAll(() => {
    base = baseNeuve();
    parcours = derouleParcours(base);
  });

  /* ── Maillon 1 : reception → lots ───────────────────────────────────────── */

  it('la reception cree un lot par ligne, avec son prix et sa DLC propres', () => {
    const lotsFarine = base.select().from(lot).where(eq(lot.ingredientId, parcours.farineId)).all();

    expect(lotsFarine).toHaveLength(2);

    const a = lotsFarine.find((l) => l.numeroLotFournisseur === FARINE_LOT_A.numeroLotFournisseur)!;
    const b = lotsFarine.find((l) => l.numeroLotFournisseur === FARINE_LOT_B.numeroLotFournisseur)!;

    // Chaque lot pointe vers SA reception : c'est le premier maillon de la
    // tracabilite amont, et le seul moyen de retrouver le bon de livraison.
    expect(a.receptionId).toBe(parcours.receptionFarineA.receptionId);
    expect(b.receptionId).toBe(parcours.receptionFarineB.receptionId);

    // Le montant paye est stocke TEL QUEL, en centimes entiers : un lot doit
    // rester rapprochable de la facture fournisseur au centime pres (regle n°3).
    expect(a.prixLigneCents).toBe(FARINE_LOT_A.prixLigneCents);
    expect(b.prixLigneCents).toBe(FARINE_LOT_B.prixLigneCents);

    // Deux prix unitaires REELLEMENT differents : sans cela, tout le reste du
    // test sur la valorisation lot par lot serait vide de sens. Le taux est
    // DERIVE, il ne se lit pas en base.
    const tauxA = a.prixLigneCents / a.quantiteInitiale;
    const tauxB = b.prixLigneCents / b.quantiteInitiale;
    expect(tauxA).not.toBe(tauxB);
    expect(a.dateDlc).toBe(FARINE_LOT_A.dateDlc);
    expect(b.dateDlc).toBe(FARINE_LOT_B.dateDlc);
  });

  /* ── Maillon 2 : lots → production, en FEFO ─────────────────────────────── */

  it('la production consomme en FEFO : aucun lot plus proche de la DLC ne reste entame', () => {
    const lots = lotsDeLIngredient(base, parcours.farineId)
      .filter((l) => l.dateDlc !== null)
      .sort((x, y) => String(x.dateDlc).localeCompare(String(y.dateDlc)));

    const consommes = new Set(
      base
        .select({ lotId: productionConsommation.lotId })
        .from(productionConsommation)
        .where(eq(productionConsommation.productionId, parcours.productionFournee.productionId))
        .all()
        .map((c) => c.lotId),
    );

    // Invariant FEFO, et non une quantite absolue : des qu'un lot est entame,
    // TOUS ceux qui perimeraient avant lui doivent etre a zero. Cette
    // formulation survit a un changement de rendement de la recette, alors
    // qu'un « expect(restant).toBe(1407) » casserait sans qu'aucune regle
    // n'ait bouge.
    for (let rang = 0; rang < lots.length; rang += 1) {
      const suivantsConsommes = lots
        .slice(rang + 1)
        .some((posterieur) => consommes.has(posterieur.id));
      if (suivantsConsommes) {
        expect(lots[rang]!.quantiteRestante).toBe(0);
      }
    }

    // Et la fournee a bien traverse les DEUX lots de farine : avec un seul lot
    // entame, l'invariant ci-dessus serait vrai par vacuite et ne prouverait
    // rien. On ne compte que les lots de farine — la production consomme aussi
    // les huit autres ingredients.
    expect(lots.filter((l) => consommes.has(l.id))).toHaveLength(2);
  });

  it('le cout matiere de la production vient du prix de CHAQUE lot consomme', () => {
    const consommations = base
      .select({
        lotId: productionConsommation.lotId,
        ingredientId: lot.ingredientId,
        quantite: productionConsommation.quantiteTheorique,
        coutCents: productionConsommation.coutCents,
        // Le taux se RECONSTITUE a partir des deux entiers stockes : le montant
        // paye pour le lot et sa quantite d'origine. Rien n'est lu en flottant.
        prixLigneCents: lot.prixLigneCents,
        quantiteInitiale: lot.quantiteInitiale,
      })
      .from(productionConsommation)
      .innerJoin(lot, eq(productionConsommation.lotId, lot.id))
      .where(eq(productionConsommation.productionId, parcours.productionFournee.productionId))
      .all();

    /** Taux unitaire d'un lot, derive comme le fait `lotsDeLIngredient`. */
    const taux = (c: (typeof consommations)[number]): number =>
      c.quantiteInitiale > 0 ? c.prixLigneCents / c.quantiteInitiale : 0;

    // Chaque ligne est valorisee au prix de SON lot, pas a une moyenne.
    for (const c of consommations) {
      expect(c.coutCents).toBe(Math.round(c.quantite * taux(c)));
    }

    const entete = base
      .select()
      .from(production)
      .where(eq(production.id, parcours.productionFournee.productionId))
      .get()!;

    const sommeLignes = consommations.reduce((total, c) => total + c.coutCents, 0);
    expect(entete.coutMatiereTheoriqueCents).toBe(sommeLignes);

    // Preuve que la valorisation est bien LOT PAR LOT et non moyennee :
    // valoriser toute la farine au prix d'un SEUL de ses deux lots donnerait
    // forcement un autre chiffre. Sans cette contre-epreuve, un CUMP global
    // passerait l'assertion precedente sans qu'on s'en apercoive.
    const farine = consommations.filter((c) => c.ingredientId === parcours.farineId);
    expect(farine.length).toBe(2);
    const coutFarineReel = farine.reduce((total, c) => total + c.coutCents, 0);
    const quantiteFarine = farine.reduce((total, c) => total + c.quantite, 0);
    const coutSiPrixUnique = Math.round(quantiteFarine * taux(farine[0]!));
    expect(coutFarineReel).not.toBe(coutSiPrixUnique);
  });

  it('les mouvements de sortie portent le meme cout que les lignes de consommation', () => {
    // Deux tables, une seule verite : `production_consommation` sert la
    // tracabilite, `mouvement_stock` sert le stock. Si elles divergent, l'une
    // des deux ment — et on ne saurait pas laquelle.
    const consommations = base
      .select()
      .from(productionConsommation)
      .where(eq(productionConsommation.productionId, parcours.productionFournee.productionId))
      .all();

    const mouvements = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.productionId, parcours.productionFournee.productionId))
      .all();

    expect(mouvements).toHaveLength(consommations.length);

    for (const c of consommations) {
      const m = mouvements.find((x) => x.lotId === c.lotId)!;
      expect(m.type).toBe('sortie_production');
      expect(m.quantite).toBe(c.quantiteTheorique);
      expect(m.coutCents).toBe(c.coutCents);
      // Le mouvement porte la session : le stock sait pour quel marche il part.
      expect(m.sessionId).toBe(parcours.sessionId);
    }
  });

  /* ── Maillon 3 : realise → ecart theorique/reel ─────────────────────────── */

  it('le realise coexiste avec le theorique : l ecart est mesurable, pas ecrase', () => {
    const entete = base
      .select()
      .from(production)
      .where(eq(production.id, parcours.productionFournee.productionId))
      .get()!;

    expect(entete.statut).toBe('terminee');
    // Le theorique est intact : c'est de la coexistence des deux que nait
    // l'analyse d'ecart (docs/01 module 3).
    expect(entete.volumeTheoriqueMl).toBe(parcours.productionFournee.volumeTheoriqueMl);
    expect(entete.crepesTheoriques).toBe(parcours.productionFournee.crepesTheoriques);
    expect(entete.volumeReelMl).toBe(VOLUME_REEL_ML);
    expect(entete.crepesReelles).toBe(CREPES_REELLES);

    // L'ecart se calcule avec la fonction pure du domaine, sur des valeurs
    // PROPAGEES : le test ne refait pas la division.
    const rendementBp = rendementReelBp(entete.crepesReelles!, entete.crepesTheoriques);
    expect(rendementBp).toBeGreaterThan(0);
    expect(rendementBp).toBeLessThan(10_000);
    expect(entete.ecartMotif).toContain('Fond de bassine');
  });

  // CORRIGE (D-038) : `saisirRealise` ecrit desormais le cout matiere reel,
  // somme des consommations valorisees lot par lot.
  it("le cout matiere REEL d'une production est renseigne a la saisie du realise", () => {
    // ANCIEN `it.fails` — MAILLON POSE, commentaire corrige le 30/07/2026.
    //
    // Ce test decrivait un trou reel : `production.cout_matiere_reel_cents` et
    // `production_consommation.quantite_reelle` existaient au schema sans
    // qu'aucun service ne les ecrive, donc l'ecart THEORIQUE/REEL en matiere ne
    // remontait jamais jusqu'a la marge. `saisirRealise` les ecrit desormais, et
    // l'`it.fails` a donc echoue — ce qui a force sa conversion en test de
    // non-regression ordinaire, exactement le but de cette convention.
    //
    // Le commentaire, lui, avait survecu a la correction et affirmait encore le
    // contraire du code juste en dessous. Une note qui decrit un etat revolu
    // envoie le lecteur suivant refaire un travail deja fait : c'est le meme
    // piege que les tableaux de statut perimes de `docs/`, et il a deja coute
    // deux agents entiers sur ce projet.
    const entete = base
      .select()
      .from(production)
      .where(eq(production.id, parcours.productionFournee.productionId))
      .get()!;
    expect(entete.coutMatiereReelCents).not.toBeNull();
  });

  /* ── Maillon 4 : production → cout matiere de la session ────────────────── */

  it('le cout matiere de la session vient EXACTEMENT des sorties de stock', () => {
    const session = lireSession(base, parcours.sessionId);

    const productions = base
      .select({ cout: production.coutMatiereTheoriqueCents })
      .from(production)
      .where(eq(production.sessionId, parcours.sessionId))
      .all();

    expect(productions.length).toBeGreaterThan(0);
    const sommeProductions = productions.reduce((total, p) => total + p.cout, 0);

    // Ce que la cloture sort du stock APRES la fournee : marchandises revendues
    // telles quelles, et garnitures etalees au service. La pate sort a la
    // production, la garniture sort au service — deux moments, deux ecritures,
    // un seul cout matiere.
    const sommeSortiesVente = base
      .select({ coutCents: mouvementStock.coutCents })
      .from(mouvementStock)
      .where(
        and(
          eq(mouvementStock.sessionId, parcours.sessionId),
          eq(mouvementStock.type, 'sortie_vente'),
          eq(mouvementStock.isAnnule, false),
        ),
      )
      .all()
      .reduce((total, m) => total + m.coutCents, 0);

    // LE maillon central de la these : le cout matiere du dimanche n'est jamais
    // saisi, il est la somme de ce que la matiere a reellement coute a la
    // reception, propagee via la FEFO.
    expect(session.coutMatiereCents).toBe(sommeProductions + sommeSortiesVente);

    // Et il remonte bien jusqu'aux lignes de consommation, donc jusqu'aux lots.
    const sommeConsommations = base
      .select({ coutCents: productionConsommation.coutCents })
      .from(productionConsommation)
      .innerJoin(production, eq(productionConsommation.productionId, production.id))
      .where(eq(production.sessionId, parcours.sessionId))
      .all()
      .reduce((total, c) => total + c.coutCents, 0);

    expect(session.coutMatiereCents).toBe(sommeConsommations + sommeSortiesVente);
    // Un cout nul ferait passer toutes les egalites de marge ci-dessous sans
    // rien prouver : on exige que la matiere ait vraiment coute quelque chose.
    expect(session.coutMatiereCents).toBeGreaterThan(0);
  });

  /* ── Maillon 4bis : menu → composants → stock (nouveaute de la nuit) ────── */

  it('un menu vendu sort le stock de CHACUN de ses composants, garniture et revendu confondus', () => {
    // Le composant TRANSFORME du menu (une crepe garnie JAMAIS vendue en ligne
    // directe dans ce parcours) doit avoir etale sa garniture au service :
    // exactement le mecanisme D-053, mais declenche par un MENU, pas par une
    // vente directe — « Trou 2 » de l'audit du 30/07/2026
    // (`services/sessions.ts::exploserLigneMenu`).
    const sortiesGarnitureMenu = base
      .select({ quantite: mouvementStock.quantite, coutCents: mouvementStock.coutCents })
      .from(mouvementStock)
      .where(
        and(
          eq(mouvementStock.sessionId, parcours.sessionId),
          eq(mouvementStock.ingredientId, parcours.crepeMenuIngredientGarnitureId),
          eq(mouvementStock.type, 'sortie_vente'),
          eq(mouvementStock.isAnnule, false),
        ),
      )
      .all();

    expect(sortiesGarnitureMenu.length).toBeGreaterThan(0);
    const quantiteSortieGarnitureMenu = sortiesGarnitureMenu.reduce((t, m) => t + m.quantite, 0);
    const coutSortieGarnitureMenu = sortiesGarnitureMenu.reduce((t, m) => t + m.coutCents, 0);

    // Quantite attendue : crepes du menu (jamais vendues ailleurs) x garniture
    // par unite — une multiplication de deux entiers CONNUS du test, pas un
    // recalcul de la FEFO ni de l'explosion du menu.
    expect(quantiteSortieGarnitureMenu).toBe(
      CREPES_VENDUES_VIA_MENU * parcours.crepeMenuQuantiteGarniturePartUnite,
    );
    // Un cout NUL cacherait exactement le defaut trouve cette nuit (0,073 €/crepe,
    // mission) : la garniture doit avoir un prix reel, pas gratuit.
    expect(coutSortieGarnitureMenu).toBeGreaterThan(0);

    // Le composant REVENDU du menu partage le MEME article que la vente
    // directe (le pot de sirop, `parcours.siropProduitId`) : les deux canaux
    // doivent se CUMULER avant la FEFO, jamais se substituer l'un a l'autre —
    // sans quoi l'un des deux resterait « eternellement en stock » (D-037).
    const lotSirop = base
      .select({ id: lot.id })
      .from(lot)
      .where(eq(lot.ingredientId, parcours.siropIngredientId))
      .get()!;
    expect(restantDuLot(base, parcours.siropIngredientId, lotSirop.id)).toBe(
      QUANTITE_EPICERIE - POTS_VENDUS_TOTAL,
    );
  });

  it('le composant transforme du menu ne declenche AUCUNE production supplementaire : la meme fournee sert les deux canaux de vente', () => {
    // Sans ce garde-fou, une confusion entre « produit vendu » et « production
    // a lancer » ferait dupliquer la fournee des qu'un menu contient un
    // transforme — exactement le genre de maillon qui « oublie » un maillon
    // recent que cette mission recherche.
    const productions = base
      .select({ id: production.id })
      .from(production)
      .where(eq(production.sessionId, parcours.sessionId))
      .all();
    expect(productions).toHaveLength(1);
    expect(productions[0]!.id).toBe(parcours.productionFournee.productionId);
  });

  /* ── Maillon 5 : ventes → CA → marge nette ──────────────────────────────── */

  it('le CA total est la somme des lignes de vente, jamais un total saisi — LE MENU COMPRIS', () => {
    const session = lireSession(base, parcours.sessionId);
    const lignes = base
      .select()
      .from(sessionVente)
      .where(eq(sessionVente.sessionId, parcours.sessionId))
      .all();

    // Trois lignes : crepe directe, pot direct, et LE MENU comme un ticket
    // UNIQUE — jamais eclate en `session_vente` (c'est `totaliserVentes`, en
    // interne, qui l'eclate en composants pour le CA ventile, voir le test
    // suivant). Une session close reste relisible comme le porteur l'a vecue.
    expect(lignes).toHaveLength(3);
    for (const l of lignes) {
      expect(l.montantCents).toBe(l.quantite * l.prixUnitaireCents);
    }
    expect(session.caTotalCents).toBe(lignes.reduce((total, l) => total + l.montantCents, 0));

    const ligneMenu = lignes.find((l) => l.produitVenteId === parcours.menuProduitId);
    expect(ligneMenu).toBeDefined();
    expect(ligneMenu!.quantite).toBe(MENUS_VENDUS);
    expect(ligneMenu!.prixUnitaireCents).toBe(MENU_PRIX_CENTS);
    expect(ligneMenu!.montantCents).toBe(MENUS_VENDUS * MENU_PRIX_CENTS);
  });

  /**
   * INVARIANT DE BOUCLAGE — meme esprit que celui des depenses deductibles
   * (maillon 7, plus bas) : une egalite entre deux bouts de la chaine qui ne
   * peut tenir que si l'explosion d'un menu est cablee de bout en bout.
   *
   * `session.caTransformeCents` et `caRevenduCents` viennent de
   * `totaliserVentes`, applique aux lignes EXPLOSEES (menu compris). Le prix
   * PRATIQUE du menu, lui, est une donnee d'entree connue du test — jamais
   * recalculee par `ventilerMenu`. Si l'explosion perdait le menu (retombait
   * entierement dans une seule nature, ou disparaissait), cette egalite
   * rougirait sans qu'aucun litteral n'ait ete code en dur ici.
   */
  it('le CA du menu se ventile REELLEMENT entre transforme et revendu, jamais entache a un seul bloc', () => {
    const session = lireSession(base, parcours.sessionId);

    // Ce qu'auraient rapporte les SEULES ventes directes, sans le menu — un
    // produit de deux entiers connus du test, pas un recalcul de la
    // ventilation sous epreuve (`ventilerMenu`, `packages/core/src/menus.ts`).
    const caTransformeSansMenu = CREPES_VENDUES_DIRECT * PRIX_CREPE_CENTS;
    const caRevenduSansMenu = POTS_VENDUS_DIRECT * PRIX_POT_CENTS;

    // Le menu doit avoir ajoute du CA aux DEUX compteurs : s'il retombait
    // entierement dans un seul, la ventilation transforme/revendu ne
    // ventilerait rien pour ce menu — exactement le piege documente par
    // `packages/core/src/menus.ts`.
    expect(session.caTransformeCents).toBeGreaterThan(caTransformeSansMenu);
    expect(session.caRevenduCents).toBeGreaterThan(caRevenduSansMenu);

    // Et la contribution du menu aux deux compteurs, une fois les ventes
    // directes retranchees, vaut EXACTEMENT son prix pratique multiplie par le
    // nombre de menus vendus : rien ne se perd, rien ne se cree dans
    // l'explosion (garantie de `repartir()`, jamais reimplementee ici).
    const contributionMenuCents =
      session.caTransformeCents! +
      session.caRevenduCents! -
      caTransformeSansMenu -
      caRevenduSansMenu;
    expect(contributionMenuCents).toBe(MENUS_VENDUS * MENU_PRIX_CENTS);
  });

  it('la marge nette decoule du CA moins le cout matiere, les frais et la commission', () => {
    const session = lireSession(base, parcours.sessionId);

    // Le taux vient de `parametre`, avec sa date de validite : c'est la seule
    // source autorisee (CLAUDE.md §7, « ne pas coder en dur des taux »).
    const parametres = lireParametres(base, session.dateSession);
    const tauxBp = parametres.pointsDeBase('taux_commission_sumup_bp');

    // La commission ne porte QUE sur l'encaissement carte.
    expect(session.commissionCarteCents).toBe(appliquerPointsDeBase(session.caCarteCents!, tauxBp));

    const fraisTotaux =
      session.fraisEmplacementCents +
      session.fraisDeplacementCents +
      session.fraisGazCents +
      session.fraisDiversCents;

    expect(session.margeBruteCents).toBe(session.caTotalCents! - session.coutMatiereCents!);
    expect(session.margeNetteCents).toBe(
      session.caTotalCents! -
        session.coutMatiereCents! -
        fraisTotaux -
        session.commissionCarteCents!,
    );

    // La caisse tombe juste : le fonds de tete ne gonfle pas le CA.
    expect(session.ecartCaisseCents).toBe(0);
    expect(session.caEspecesCents).toBe(session.caTotalCents! - session.caCarteCents!);
  });

  /* ── Maillon 6 : session → seuils legaux ────────────────────────────────── */

  it('les compteurs de seuils integrent ce CA, ventile transforme / revendu', () => {
    const session = lireSession(base, parcours.sessionId);
    const seuils = tableauSeuils(base, ANNEE);

    expect(seuils.meta.sessionsTenues).toBe(1);
    expect(seuils.meta.caTransformeCents).toBe(session.caTransformeCents);
    expect(seuils.meta.caRevenduCents).toBe(session.caRevenduCents);

    // La ventilation ventile REELLEMENT : sans une vente revendue, ce test
    // passerait avec un compteur toujours a zero (CLAUDE.md §6 — le seuil TVA
    // porte sur le CA, or la revente en genere ~2,6 fois plus a marge egale).
    expect(seuils.meta.caRevenduCents).toBeGreaterThan(0);
    expect(seuils.meta.caTransformeCents).toBeGreaterThan(0);
    expect(seuils.meta.caTransformeCents! + seuils.meta.caRevenduCents!).toBe(session.caTotalCents);
    expect(seuils.meta.partRevenduBp).toBeGreaterThan(0);

    /**
     * Chaque compteur porte SON assiette, et son plafond vient de la table
     * `parametre` — pas d'un litteral dans l'ecran ni dans ce test.
     *
     * Ce test affirmait auparavant que les TROIS compteurs portent le chiffre
     * d'affaires. Il encodait donc le defaut au lieu de le detecter :
     * `seuil_cotisation_reduite_cents` porte sur un REVENU NET, grandeur
     * differente et toujours inferieure. Un test peut figer une erreur aussi
     * surement qu'il fige une regle — c'est ce qui le rendait invisible.
     */
    const parametres = lireParametres(base, `${ANNEE}-12-31`);
    expect(seuils.data.length).toBeGreaterThan(0);
    for (const compteur of seuils.data) {
      expect(compteur.plafondCents).toBeGreaterThan(0);
      // Le catalogue TypeScript est la source unique des cles (decision D-013).
      expect(definitionParametre(compteur.cle)).toBeDefined();
    }

    // Les seuils de CHIFFRE D'AFFAIRES portent bien le CA de la session…
    for (const cle of ['seuil_franchise_tva_cents', 'seuil_airbag_cents']) {
      expect(seuils.data.find((c) => c.cle === cle)!.realiseCents, cle).toBe(session.caTotalCents);
    }

    // …et celui de REVENU NET porte autre chose, strictement moindre.
    const cotisation = seuils.data.find((c) => c.cle === 'seuil_cotisation_reduite_cents')!;
    expect(cotisation.realiseCents).toBeLessThan(session.caTotalCents!);

    const franchise = seuils.data.find((c) => c.cle === 'seuil_franchise_tva_cents')!;
    expect(franchise.plafondCents).toBe(parametres.centimes('seuil_franchise_tva_cents'));
    // Une seule session : « le rythme » n'existe pas encore, on ne projette pas.
    expect(franchise.projectionFinAnneeCents).toBeNull();
  });

  /* ── Maillon 7 : session → synthese d'exercice ──────────────────────────── */

  it("la synthese d'exercice reprend ce CA en recettes", () => {
    const synthese = syntheseExercice(base, ANNEE);

    // On remonte volontairement jusqu'aux LIGNES DE VENTE, et non jusqu'a
    // l'agregat `session.ca_total_cents` : comparer la synthese a la colonne
    // qu'elle vient elle-meme de lire serait une tautologie, vraie meme si les
    // deux etaient faux ensemble.
    const caDesLignes = base
      .select()
      .from(sessionVente)
      .where(eq(sessionVente.sessionId, parcours.sessionId))
      .all()
      .reduce((total, l) => total + l.montantCents, 0);

    expect(synthese.annee).toBe(ANNEE);
    expect(caDesLignes).toBeGreaterThan(0);
    expect(synthese.recettesCents).toBe(caDesLignes);

    /**
     * Ce test affirmait auparavant que le benefice brut EGALE la recette,
     * « aucune depense ni amortissement saisis dans ce parcours ». C'etait
     * vrai en apparence et faux au fond : ce parcours enregistre BIEN trois
     * receptions (achats de marchandise, `derouleParcours`) et des frais de
     * session (`FRAIS`), deux populations de charges reelles que
     * `syntheseExercice` ignorait avant correction (docs/14 §G2 — « BENEFICE
     * BRUT 973,00 € » pendant que le Journal des achats du meme ecran listait
     * 447,61 € d'achats). Ce test figeait donc le defaut au lieu de le
     * detecter, exactement comme le faisait autrefois le test des seuils
     * legaux plus haut dans ce fichier.
     *
     * Les deux montants ci-dessous sont lus tels que PROPAGES par le parcours
     * (`ResultatReception.montantTotalCents`, `FRAIS` passe tel quel a
     * `cloturerSession`), jamais recalcules : la discipline du fichier reste
     * respectee.
     */
    const achatsMarchandisesCents =
      parcours.receptionEpicerie.montantTotalCents +
      parcours.receptionFarineA.montantTotalCents +
      parcours.receptionFarineB.montantTotalCents;
    const fraisSessionCents =
      FRAIS.emplacementCents + FRAIS.deplacementCents + FRAIS.gazCents + FRAIS.diversCents;

    /**
     * La COMMISSION CARTE est une charge de l'exercice au meme titre que les
     * frais de session.
     *
     * Elle etait deja deduite de la marge nette de chaque session (comptabilite
     * ANALYTIQUE) mais n'entrait pas dans la synthese (comptabilite GENERALE) :
     * les charges de l'annee etaient donc sous-comptees, et le benefice estime
     * — donc les cotisations INASTI et l'IPP provisionnes — surevalues d'autant.
     *
     * Ce test figeait l'ancienne egalite a DEUX termes, donc l'erreur. Il en
     * porte maintenant TROIS. Constate sur la vraie base du porteur : 6,76 EUR
     * de commission sur deux sessions closes, jamais comptes.
     */
    const sessionCloturee = lireSession(base, parcours.sessionId);
    const commissionCarteCents = sessionCloturee.commissionCarteCents ?? 0;
    expect(commissionCarteCents).toBeGreaterThan(0);

    expect(synthese.depensesDeductiblesCents).toBe(
      achatsMarchandisesCents + fraisSessionCents + commissionCarteCents,
    );
    // Le benefice brut EST la recette moins ces TROIS SEULES charges. L'egalite
    // verifie que rien ne s'est glisse au milieu — un cout matiere de session
    // (grandeur analytique) compte une seconde fois en plus de l'achat, par
    // exemple : voir `totalAchatsMarchandisesCents` dans depots/comptabilite.ts.
    expect(synthese.beneficeBrutCents).toBe(
      caDesLignes - achatsMarchandisesCents - fraisSessionCents - commissionCarteCents,
    );
  });

  /* ── Maillon 8 : tracabilite bidirectionnelle ───────────────────────────── */

  it('tracabilite AMONT : de la session jusqu aux lots fournisseur et a leurs receptions', () => {
    const amont = tracabiliteAmontSession(base, parcours.sessionId);

    expect(amont.productions).toHaveLength(1);
    const prod = amont.productions[0]!;
    expect(prod.productionId).toBe(parcours.productionFournee.productionId);
    expect(prod.numeroLotPate).toBe(parcours.productionFournee.numeroLotPate);

    // Les lots traces sont EXACTEMENT ceux consommes : ni plus (on n'invente
    // pas un lot), ni moins (on n'en perd pas un en route).
    const tracesLots = new Set(prod.consommations.map((c) => c.lotId));
    const consommesLots = new Set(parcours.productionFournee.consommations.map((c) => c.lotId));
    expect(tracesLots).toEqual(consommesLots);

    // Et la chaine remonte jusqu'au DOCUMENT fournisseur : les trois receptions
    // du parcours sont retrouvees, chacune avec son numero et son fournisseur.
    const receptionsTracees = new Set(prod.consommations.map((c) => c.receptionId));
    expect(receptionsTracees).toEqual(
      new Set([
        parcours.receptionEpicerie.receptionId,
        parcours.receptionFarineA.receptionId,
        parcours.receptionFarineB.receptionId,
      ]),
    );
    for (const c of prod.consommations) {
      expect(c.receptionNumero).toMatch(/^RC-\d{4}-\d{4}$/);
      expect(c.fournisseurNom).toBeTruthy();
    }

    // Le rappel AFSCA se fait par NUMERO DE LOT FOURNISSEUR : c'est la seule
    // donnee que le meunier reconnaitra au telephone.
    const numerosFournisseur = prod.consommations
      .map((c) => c.numeroLotFournisseur)
      .filter((n): n is string => n !== null);
    expect(numerosFournisseur).toContain(FARINE_LOT_A.numeroLotFournisseur);
    expect(numerosFournisseur).toContain(FARINE_LOT_B.numeroLotFournisseur);
  });

  it('tracabilite AVAL : d un lot fournisseur jusqu a cette session', () => {
    // Sens inverse, et non la meme requete retournee : on part du coup de fil
    // du meunier (« mon lot A est rappele ») pour trouver qui a mange quoi.
    const lotA = base
      .select({ id: lot.id })
      .from(lot)
      .where(eq(lot.numeroLotFournisseur, FARINE_LOT_A.numeroLotFournisseur))
      .get()!;

    const aval = tracabiliteAvalLot(base, lotA.id);

    expect(aval.ingredientId).toBe(parcours.farineId);
    expect(aval.receptionId).toBe(parcours.receptionFarineA.receptionId);
    expect(aval.productions).toHaveLength(1);

    const prod = aval.productions[0]!;
    expect(prod.productionId).toBe(parcours.productionFournee.productionId);
    expect(prod.session).not.toBeNull();
    expect(prod.session!.id).toBe(parcours.sessionId);
    expect(prod.session!.dateSession).toBe(JOUR_SESSION);
  });

  /* ── Maillon 8bis : le MENU dans la tracabilite (nouveaute de la nuit) ──── */

  it('tracabilite AMONT classe la garniture consommee via le MENU en garniture, jamais en revendu, meme si sa crepe n est vendue par aucune ligne directe', () => {
    const amont = tracabiliteAmontSession(base, parcours.sessionId);

    const garnitureMenu = amont.garnitures.find(
      (g) => g.ingredientId === parcours.crepeMenuIngredientGarnitureId,
    );
    expect(
      garnitureMenu,
      'la garniture de la crêpe incluse dans le menu doit apparaître dans le bloc garnitures, ' +
        'même si cette crêpe ne figure sur AUCUNE ligne directe de la session',
    ).toBeDefined();
    expect(garnitureMenu!.produits).toContain(parcours.crepeMenuNomProduit);

    // Et elle ne doit JAMAIS se glisser dans les marchandises revendues : ce
    // serait perdre exactement la distinction qui decide de la portee d'un
    // rappel (le client d'un pot ferme detient un numero de lot, celui d'une
    // crepe garnie n'a rien) — le meme defaut que l'audit AFSCA du 30/07/2026
    // a corrige dans `produitsGarnisDeLaSession`.
    expect(
      amont.revendus.some((r) => r.ingredientId === parcours.crepeMenuIngredientGarnitureId),
    ).toBe(false);
  });

  it('tracabilite AMONT cumule un meme article revendu vendu par les DEUX canaux (ligne directe et menu) dans un seul lot trace', () => {
    const amont = tracabiliteAmontSession(base, parcours.sessionId);

    const revendusSirop = amont.revendus.filter(
      (r) => r.ingredientId === parcours.siropIngredientId,
    );
    expect(revendusSirop.length).toBeGreaterThan(0);
    const quantiteTracee = revendusSirop.reduce((total, r) => total + r.quantite, 0);

    // La quantite tracee doit couvrir la vente DIRECTE ET la vente VIA MENU :
    // rien ne doit rester invisible du registre au seul motif que la vente est
    // passee par un menu plutot que par une ligne directe.
    expect(quantiteTracee).toBe(POTS_VENDUS_TOTAL);
  });

  it('tracabilite AVAL depuis le lot de la garniture du menu remonte a CETTE session, classee en garniture, avec le bon produit porteur nomme', () => {
    const lotGarnitureMenu = base
      .select({ id: lot.id })
      .from(lot)
      .where(eq(lot.ingredientId, parcours.crepeMenuIngredientGarnitureId))
      .get()!;

    const aval = tracabiliteAvalLot(base, lotGarnitureMenu.id);

    expect(aval.garnitures.map((g) => g.session.id)).toContain(parcours.sessionId);
    expect(aval.ventes.map((v) => v.session.id)).not.toContain(parcours.sessionId);

    const ligne = aval.garnitures.find((g) => g.session.id === parcours.sessionId);
    expect(ligne).toBeDefined();
    expect(ligne!.produits).toContain(parcours.crepeMenuNomProduit);
  });

  /**
   * INVARIANT DE BOUCLAGE — meme principe que celui des depenses deductibles
   * (maillon 7) : le REGISTRE (vue classee en `revendus` / `garnitures`) doit
   * reconstituer EXACTEMENT le LEDGER brut (`mouvement_stock`, type
   * `sortie_vente`). Si un mouvement de sortie tombait dans aucun des deux
   * blocs — ou dans les deux a la fois — cette egalite rougirait, sans qu'aucun
   * chiffre metier n'ait ete code en dur ici. C'est exactement le defaut que le
   * menu, arrive cette nuit, aurait pu introduire en silence.
   */
  it('la tracabilite AMONT reconstitue EXACTEMENT le nombre de sorties de vente du ledger : rien de perdu, rien de double', () => {
    const amont = tracabiliteAmontSession(base, parcours.sessionId);

    const sortiesBrutes = base
      .select({ id: mouvementStock.id })
      .from(mouvementStock)
      .where(
        and(
          eq(mouvementStock.sessionId, parcours.sessionId),
          eq(mouvementStock.type, 'sortie_vente'),
          eq(mouvementStock.isAnnule, false),
        ),
      )
      .all();

    // Plancher non nul : sans lui, l'egalite ci-dessous serait vraie par
    // vacuite et ne prouverait rien (pot direct, pot via menu — cumules en une
    // seule allocation puisqu'un seul lot —, vergeoise de la crepe directe,
    // sirop-liege-vrac de la crepe du menu : au moins trois sorties distinctes
    // sont attendues).
    expect(sortiesBrutes.length).toBeGreaterThan(0);
    expect(amont.revendus.length + amont.garnitures.length).toBe(sortiesBrutes.length);
  });

  /* ── Maillon 9 : le stock est la somme de ses mouvements ────────────────── */

  it('le stock restant egale la somme des mouvements, sans aucun UPDATE de quantite', () => {
    const mouvements = base.select().from(mouvementStock).all();

    for (const l of tousLesLots(base)) {
      // La somme est refaite ICI a partir des lignes brutes : si le depot
      // lisait une quantite stockee quelque part, l'egalite tomberait.
      const somme = mouvements
        .filter((m) => m.lotId === l.id)
        .reduce((total, m) => total + (m.type === 'entree' ? m.quantite : -m.quantite), 0);
      expect(l.quantiteRestante).toBe(somme);
    }

    // `quantite_initiale` n'a jamais bouge depuis la reception : la
    // consommation ne se soustrait pas du lot, elle s'ecrit en face de lui
    // (regle d'architecture n°5).
    const toutesLesLignes = [
      ...parcours.receptionEpicerie.lotsCrees,
      ...parcours.receptionFarineA.lotsCrees,
      ...parcours.receptionFarineB.lotsCrees,
    ];
    for (const ligne of toutesLesLignes) {
      const enBase = base.select().from(lot).where(eq(lot.id, ligne.lotId)).get()!;
      expect(enBase.quantiteInitiale).toBe(ligne.quantite);

      // Une seule ecriture d'entree par lot, du montant recu. Une seconde
      // entree signifierait une reception comptee deux fois.
      const entrees = mouvements.filter((m) => m.lotId === ligne.lotId && m.type === 'entree');
      expect(entrees).toHaveLength(1);
      expect(entrees[0]!.quantite).toBe(ligne.quantite);
    }

    // Et la baisse de stock s'explique ENTIEREMENT par des PIECES : le document
    // de production pour ce que la fournee a pris, la cloture de session pour ce
    // qui est parti au service. Un meme lot peut relever des deux — la vergeoise
    // entre dans la pate ET s'etale sur la crepe. C'est ce rapprochement qui
    // interdit une fuite de matiere sans piece justificative.
    const consommations = base
      .select()
      .from(productionConsommation)
      .where(eq(productionConsommation.productionId, parcours.productionFournee.productionId))
      .all();

    expect(consommations.length).toBeGreaterThan(0);
    for (const c of consommations) {
      const enBase = base.select().from(lot).where(eq(lot.id, c.lotId)).get()!;
      const restant = restantDuLot(base, c.ingredientId, c.lotId);
      const sortiEnVente = mouvements
        .filter((m) => m.lotId === c.lotId && m.type === 'sortie_vente' && !m.isAnnule)
        .reduce((total, m) => total + m.quantite, 0);
      expect(enBase.quantiteInitiale - restant).toBe(c.quantiteTheorique + sortiEnVente);
    }

    // Diagnostic global : aucun lot sur-consomme, aucune entree dupliquee.
    expect(verifierInvariantLots(base)).toEqual([]);
  });

  // CORRIGE (D-037) : la cloture emet des mouvements `sortie_vente` en FEFO.
  it('vendre un produit REVENDU sort bien son stock', () => {
    // Le type de mouvement `sortie_vente` existe au schema et dans les
    // contrats, mais aucun service ne l'emet : `cloturerSession` n'ecrit
    // aucun mouvement de stock. Un pot de sirop vendu reste donc
    // eternellement en stock, ce qui fausse a la fois le reapprovisionnement
    // et la valeur du stock au bilan.
    const lotSirop = base
      .select({ id: lot.id })
      .from(lot)
      .where(eq(lot.ingredientId, parcours.siropIngredientId))
      .get()!;
    expect(restantDuLot(base, parcours.siropIngredientId, lotSirop.id)).toBe(
      QUANTITE_EPICERIE - POTS_VENDUS_TOTAL,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO ADVERSE 1 — annulation en cascade

   D-021 : `is_annule` sert a l'AFFICHAGE, jamais au calcul. C'est le bug reel
   deja rencontre sur ce projet : exclure les ecritures annulees ET compter la
   contrepassation rend la matiere DEUX FOIS.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Parcours ERP — annulation en cascade', () => {
  let base: BaseBatte;
  let parcours: Parcours;

  beforeAll(() => {
    base = baseNeuve();
    parcours = derouleParcours(base);
  });

  it('annuler la session ne detruit rien, mais la retire des compteurs legaux', () => {
    const avant = tableauSeuils(base, ANNEE);
    expect(avant.data[0]!.realiseCents).toBeGreaterThan(0);

    annulerSession(base, parcours.sessionId, 'Panne de gaz après une heure de vente');

    const session = lireSession(base, parcours.sessionId);
    expect(session.statut).toBe('annulee');
    expect(session.exclureDuModele).toBe(true);
    // Rien ne s'efface : la ligne existe toujours, ses agregats aussi.
    expect(session.caTotalCents).toBe(avant.data[0]!.realiseCents);
    expect(
      base.select().from(sessionVente).where(eq(sessionVente.sessionId, parcours.sessionId)).all(),
    ).toHaveLength(3);

    // …et la propagation joue dans l'autre sens : le CA d'une session annulee
    // disparait des seuils legaux ET de la synthese d'exercice, sans qu'aucun
    // recalcul manuel n'ait ete demande.
    const apres = tableauSeuils(base, ANNEE);
    expect(apres.meta.sessionsTenues).toBe(0);
    expect(apres.data[0]!.realiseCents).toBe(0);
    expect(apres.meta.caRevenduCents).toBe(0);
    expect(syntheseExercice(base, ANNEE).recettesCents).toBe(0);
  });

  it('contrepasser un mouvement rend la matiere UNE seule fois', () => {
    const lotA = base
      .select({ id: lot.id, quantiteInitiale: lot.quantiteInitiale })
      .from(lot)
      .where(eq(lot.numeroLotFournisseur, FARINE_LOT_A.numeroLotFournisseur))
      .get()!;

    const sortie = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.lotId, lotA.id))
      .all()
      .find((m) => m.type === 'sortie_production')!;

    const avant = restantDuLot(base, parcours.farineId, lotA.id);
    const idContrepassation = annulerMouvement(base, sortie.id, 'ERREUR_SAISIE');

    // Le stock remonte d'EXACTEMENT la quantite contrepassee. S'il remontait du
    // double, c'est que le calcul excluait l'ecriture annulee tout en comptant
    // la contrepassation — le bug de D-021.
    const apres = restantDuLot(base, parcours.farineId, lotA.id);
    expect(apres - avant).toBe(sortie.quantite);
    expect(apres).toBe(lotA.quantiteInitiale);
    expect(verifierInvariantLots(base)).toEqual([]);

    // Rien n'est efface : l'original reste lisible, marque et relie a sa
    // contrepassation ; la contrepassation existe comme ecriture a part entiere.
    const original = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.id, sortie.id))
      .get()!;
    expect(original.isAnnule).toBe(true);
    expect(original.annuleParId).toBe(idContrepassation);
    expect(original.quantite).toBe(sortie.quantite);

    const contrepassation = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.id, idContrepassation))
      .get()!;
    expect(contrepassation.type).toBe('entree');
    expect(contrepassation.quantite).toBe(sortie.quantite);
    expect(contrepassation.ajustement).toBe(true);
    // Meme date que l'original : les cumuls d'une periode close ne bougent pas.
    expect(contrepassation.dateMouvement).toBe(sortie.dateMouvement);
    expect(contrepassation.motifTexte).toContain(sortie.id);
  });

  it('une ecriture ne se contrepasse qu une seule fois', () => {
    const lotA = base
      .select({ id: lot.id })
      .from(lot)
      .where(eq(lot.numeroLotFournisseur, FARINE_LOT_A.numeroLotFournisseur))
      .get()!;

    const dejaAnnule = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.lotId, lotA.id))
      .all()
      .find((m) => m.isAnnule)!;

    // Sans cette regle, deux annulations successives CREERAIENT de la matiere.
    expect(() => annulerMouvement(base, dejaAnnule.id, 'ERREUR_SAISIE')).toThrow(ErreurMetier);
  });

  it('la tracabilite survit a l annulation : le lot mene toujours a la session', () => {
    // L'AFSCA se moque qu'une session ait ete annulee comptablement : la pate a
    // ete fabriquee, les crepes ont ete servies. La chaine doit rester entiere.
    const lotA = base
      .select({ id: lot.id })
      .from(lot)
      .where(eq(lot.numeroLotFournisseur, FARINE_LOT_A.numeroLotFournisseur))
      .get()!;

    const aval = tracabiliteAvalLot(base, lotA.id);
    expect(aval.productions).toHaveLength(1);
    expect(aval.productions[0]!.session!.id).toBe(parcours.sessionId);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO ADVERSE 2 — production infaisable : tout ou rien
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Parcours ERP — production infaisable', () => {
  it("n'ecrit ABSOLUMENT RIEN quand le stock ne suffit pas", () => {
    const base = baseNeuve();
    const idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
    const idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    const idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!
      .id;

    const farine = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!;

    // Tout est la, SAUF assez de farine. On veut que l'echec vienne d'un seul
    // ingredient limitant, pas d'une base vide : c'est le cas realiste.
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR_APPRO_EPICERIE,
      lignes: base
        .select({ id: ingredient.id })
        .from(ingredient)
        .all()
        .map((i) => ({
          ingredientId: i.id,
          quantite: i.id === farine.id ? 10 : QUANTITE_EPICERIE,
          prixLigneCents: PRIX_LIGNE_EPICERIE_CENTS,
          numeroLotFournisseur: 'LOT-TEST-EPICERIE',
        })),
    });
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR_SESSION });

    const empreinteAvant = empreinteBase(base);

    expect(() =>
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: VOLUME_PRODUIT_ML },
        dateProduction: JOUR_PRODUCTION,
        sessionId: session.id,
      }),
    ).toThrow(ErreurMetier);

    // Comparaison LIGNE A LIGNE de toute la base, pas un simple comptage : une
    // production a moitie ecrite laisserait du stock consomme sans lot de pate
    // en face, donc une tracabilite fausse — ce que l'AFSCA ne pardonne pas.
    // Un numero de document consomme pour rien suffit a faire echouer ce test,
    // et c'est voulu : une sequence trouee est un defaut d'audit.
    expect(empreinteBase(base)).toBe(empreinteAvant);
  });

  it("nomme l'ingredient limitant et le chiffre qui manque", () => {
    const base = baseNeuve();
    const idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
    const idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!
      .id;
    const farine = base
      .select({ id: ingredient.id, nom: ingredient.nom })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!;

    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR_APPRO_EPICERIE,
      lignes: base
        .select({ id: ingredient.id })
        .from(ingredient)
        .all()
        .map((i) => ({
          ingredientId: i.id,
          quantite: i.id === farine.id ? 10 : QUANTITE_EPICERIE,
          prixLigneCents: PRIX_LIGNE_EPICERIE_CENTS,
          numeroLotFournisseur: 'LOT-TEST-EPICERIE',
        })),
    });

    try {
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: VOLUME_PRODUIT_ML },
        dateProduction: JOUR_PRODUCTION,
      });
      expect.unreachable('la production aurait dû échouer');
    } catch (erreur) {
      // Un refus sec obligerait l'utilisateur a aller chercher lui-meme quoi
      // commander : le message doit porter la donnee qui manque (docs/07 §6.3).
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('production_infaisable');
      expect((erreur as ErreurMetier).message).toContain(farine.nom);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO ADVERSE 3 — rejeu d'une reception
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Parcours ERP — rejeu', () => {
  it('la meme reception enregistree deux fois cree deux lots distincts', () => {
    const base = baseNeuve();
    const idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
    const farine = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!;

    const entree = {
      fournisseurId: idFournisseur,
      dateReception: JOUR_APPRO_FARINE_A,
      numeroBonLivraison: 'BL-MEUNIER-A',
      lignes: [{ ingredientId: farine.id, ...FARINE_LOT_A }],
    };

    const premiere = enregistrerReception(base, entree);
    const seconde = enregistrerReception(base, entree);

    // Deux livraisons identiques du meme meunier le meme jour, c'est POSSIBLE.
    // Deduplication interdite : l'application ne doit jamais decider a la place
    // de l'utilisateur qu'une marchandise physiquement recue n'existe pas.
    expect(seconde.receptionId).not.toBe(premiere.receptionId);
    expect(seconde.numero).not.toBe(premiere.numero);
    expect(seconde.lotsCrees[0]!.lotId).not.toBe(premiere.lotsCrees[0]!.lotId);

    // Sequence de numerotation sans trou : on verifie le PAS, pas une valeur
    // absolue — le jeu de demonstration peut consommer des numeros.
    const rangPremiere = Number.parseInt(premiere.numero.slice(-4), 10);
    const rangSeconde = Number.parseInt(seconde.numero.slice(-4), 10);
    expect(rangSeconde).toBe(rangPremiere + 1);

    // Et la marchandise est bien la EN DOUBLE : le stock suit le physique.
    const lots = lotsDeLIngredient(base, farine.id);
    expect(lots).toHaveLength(2);
    expect(lots.reduce((total, l) => total + l.quantiteRestante, 0)).toBe(
      FARINE_LOT_A.quantite * 2,
    );

    // Deux lots, deux mouvements d'entree, deux receptions tracables : aucune
    // fusion silencieuse en cours de route.
    expect(
      base.select().from(mouvementStock).where(eq(mouvementStock.ingredientId, farine.id)).all(),
    ).toHaveLength(2);
    expect(tracabiliteAvalLot(base, premiere.lotsCrees[0]!.lotId).receptionId).toBe(
      premiere.receptionId,
    );
    expect(tracabiliteAvalLot(base, seconde.lotsCrees[0]!.lotId).receptionId).toBe(
      seconde.receptionId,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   SCENARIO ADVERSE 4 — la ressaisie que la these interdit
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Parcours ERP — ressaisie', () => {
  /**
   * ANCIEN `it.fails` (« MAILLON ROMPU ») — CORRIGE (docs/17 fiche 10).
   *
   * `resoudreCrepesProduites` refusait deja une valeur DIVERGENTE quand des
   * productions etaient rattachees a la session. Le trou etait ailleurs :
   * quand AUCUNE production n'etait rattachee, la valeur saisie etait
   * acceptee telle quelle, sans etre confrontee a
   * vendues + invendues + cassees — qui decrivent pourtant la meme fournee.
   * Un chiffre absurde (9999 crepes pour 10 vendues) passait donc sans
   * controle. `resoudreCrepesProduites` verifie desormais cette conservation
   * dans les DEUX cas.
   */
  it('MAILLON REPARE : la cloture refuse un nombre de crepes qui contredit la production', () => {
    // « sans ressaisie » (CLAUDE.md §0). `cloturerSession` DERIVE
    // `crepesProduites` des productions rattachees quand il y en a, et
    // rapproche systematiquement les compteurs sinon.
    const base = baseNeuve();
    const parcours = derouleParcours(base);

    const prod = base
      .select()
      .from(production)
      .where(eq(production.id, parcours.productionFournee.productionId))
      .get()!;
    const session = lireSession(base, parcours.sessionId);

    // Le parcours a saisi la valeur coherente ; on le montre en clorant une
    // SECONDE session, SANS production rattachee, avec un chiffre absurde :
    // elle doit desormais etre refusee.
    expect(session.crepesProduites).toBe(prod.crepesReelles);

    const idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    const autre = creerSession(base, { lieuId: idLieu, dateSession: '2026-08-02' });
    expect(() =>
      cloturerSession(base, autre.id, {
        ventes: [
          {
            produitVenteId: parcours.crepeProduitId,
            quantite: 10,
            prixUnitaireCents: PRIX_CREPE_CENTS,
          },
        ],
        frais: FRAIS,
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 10 * PRIX_CREPE_CENTS,
        caCarteCents: 0,
        // Aucune production n'est rattachee a cette session : declarer
        // 9 999 crepes produites pour 10 vendues est desormais refuse.
        crepesProduites: 9999,
        crepesInvendues: 0,
        crepesCassees: 0,
      }),
    ).toThrow(ErreurMetier);
  });
});
