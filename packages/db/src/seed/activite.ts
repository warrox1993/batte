/**
 * HISTORIQUE D'EXPLOITATION de demonstration — la chaine ERP deroulee en vrai.
 *
 * `demonstration.ts` installe le REFERENTIEL : ce qui existe avant qu'on ait
 * vendu quoi que ce soit. Ce module-ci installe les MOUVEMENTS : deux
 * receptions fournisseur, une production rattachee a un marche, et la cloture
 * de ce marche. Il n'ecrit rien directement — il appelle les memes services que
 * l'interface (`enregistrerReception`, `lancerProduction`, `saisirRealise`,
 * `cloturerSession`). C'est volontaire : une graine qui inserait ses lignes a la
 * main pourrait fabriquer un etat que l'application est incapable de produire,
 * et la demonstration cesserait de demontrer quoi que ce soit.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * `CLAUDE.md` §6 nomme un risque financier precis : « à marge égale, la revente
 * génère environ 2,6 fois plus de chiffre d'affaires que la crêpe. Or les seuils
 * légaux portent sur le CA, pas sur la marge. » Tant que la demonstration ne
 * vendait que des crepes, la ventilation transforme / revendu affichait 100 %
 * transforme, les compteurs de seuils ne ventilaient rien, et le type de
 * mouvement `sortie_vente` n'etait jamais emis. Le risque numero un du produit
 * etait invisible a la premiere ouverture.
 *
 * D'OU VIENNENT LES CHIFFRES
 * --------------------------
 * `CLAUDE.md` §6 : session type de La Batte, fenetre de 6 h 30, ~838 € de CA
 * brut, ~134 crepes. Ces deux chiffres ne sont PAS compatibles avec un stand
 * qui ne vendrait que des crepes : 838 / 134 = 6,25 € la crepe, trois fois le
 * prix affiche. La session de reference comporte donc necessairement une part
 * de revente. La ventilation retenue ci-dessous (433 € transforme, 405 €
 * revendu) est UNE repartition coherente avec les deux chiffres documentes,
 * pas une mesure — elle est a remplacer par le releve reel du premier marche.
 */

import { ajouterJours, jourCivilBelge } from '@batte/core';
import { and, eq, ne } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  fournisseur,
  ingredient,
  lieuMarche,
  produitVente,
  production,
  recette,
  reception,
  sessionMarche,
} from '../schema.js';
import { enregistrerReception } from '../services/reception.js';
import { lancerProduction, saisirRealise } from '../services/production.js';
import { cloturerSession, creerSession, type EcartStockVente } from '../services/sessions.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Le scenario, en constantes nommees

   Aucun de ces nombres n'est reglementaire. Aucun n'est un taux. Les seuls
   chiffres qui viennent d'ailleurs que de ce fichier sont ceux de `CLAUDE.md`
   §6, cites en commentaire la ou ils servent.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Marqueurs de reconnaissance : c'est par eux que la graine reste idempotente. */
const BL_EPICERIE = 'BL-DÉMO-ÉPICERIE';
const BL_TERROIR = 'BL-DÉMO-TERROIR';
/**
 * L'appro de GARNITURE, sur deux bons distincts.
 *
 * Pourquoi deux bons neufs plutot que des lignes ajoutees aux deux precedents :
 * la graine est idempotente PAR BON DE LIVRAISON. Completer `BL-DÉMO-ÉPICERIE`
 * n'aurait eu aucun effet sur une base ou il est deja enregistre — c'est-a-dire
 * sur toutes les bases existantes. Un bon neuf, lui, s'applique partout.
 *
 * Et pourquoi deux et non un : la cassonade vient du grossiste, le sirop en vrac
 * du producteur local. Une reception appartient a UN fournisseur.
 */
const BL_GARNITURE_EPICERIE = 'BL-DÉMO-GARNITURE-ÉPICERIE';
const BL_GARNITURE_TERROIR = 'BL-DÉMO-GARNITURE-TERROIR';

/** Decalages en jours par rapport au dimanche de marche. */
const JOURS_AVANT_MARCHE = {
  approTerroir: -5,
  approEpicerie: -4,
  approGarniture: -3,
  production: -1,
} as const;

/**
 * Ce qui est recu chez le grossiste, en conditionnements ENTIERS.
 *
 * On ne recoit pas « 3 383 g de farine » : on recoit un sac. C'est la raison
 * d'etre de la table `conditionnement`, et une reception qui l'ignorerait
 * donnerait une demonstration ou le point de commande n'aurait aucun sens.
 *
 * Les DLC sont celles des DENREES PERISSABLES uniquement. La farine, le sel,
 * les sucres et l'eau de fleur d'oranger n'en portent pas : `null` signifie
 * « non perissable a cette echelle », et la FEFO sert alors ces lots EN
 * DERNIER, ce qui est le comportement prudent. Les durees ci-dessous sont des
 * valeurs de demonstration, a remplacer par la date imprimee sur l'emballage.
 */
const RECEPTION_EPICERIE: readonly {
  nom: string;
  quantite: number;
  prixLigneCents: number;
  joursAvantDlc: number | null;
  numeroLotFournisseur: string;
}[] = [
  {
    nom: 'Farine de froment T55',
    quantite: 25_000,
    prixLigneCents: 1875,
    joursAvantDlc: null,
    numeroLotFournisseur: 'DÉMO-FARINE-01',
  },
  {
    nom: 'Lait entier',
    quantite: 12_000,
    prixLigneCents: 1380,
    joursAvantDlc: 90,
    numeroLotFournisseur: 'DÉMO-LAIT-01',
  },
  {
    nom: 'Œufs entiers',
    quantite: 60,
    prixLigneCents: 1200,
    joursAvantDlc: 21,
    numeroLotFournisseur: 'DÉMO-OEUFS-01',
  },
  {
    nom: 'Beurre',
    quantite: 2000,
    prixLigneCents: 1800,
    joursAvantDlc: 45,
    numeroLotFournisseur: 'DÉMO-BEURRE-01',
  },
  {
    nom: 'Vergeoise blonde',
    quantite: 1000,
    prixLigneCents: 320,
    joursAvantDlc: null,
    numeroLotFournisseur: 'DÉMO-VERGEOISE-01',
  },
  {
    nom: 'Sel fin',
    quantite: 1000,
    prixLigneCents: 90,
    joursAvantDlc: null,
    numeroLotFournisseur: 'DÉMO-SEL-01',
  },
  {
    nom: 'Sucre vanillé',
    quantite: 225,
    prixLigneCents: 390,
    joursAvantDlc: null,
    numeroLotFournisseur: 'DÉMO-VANILLE-01',
  },
  {
    nom: "Eau de fleur d'oranger",
    quantite: 250,
    prixLigneCents: 290,
    joursAvantDlc: null,
    numeroLotFournisseur: 'DÉMO-ORANGER-01',
  },
];

/**
 * Le circuit REVENDU, chez l'autre fournisseur et sur un autre document.
 *
 * Cinq cartons de douze, soit 60 pots a 4,80 € : 288 € immobilises. La session
 * en vend 54, il en reste 6. Ce reliquat n'est pas un detail — c'est ce qui rend
 * visible, a l'ecran Stock, qu'un article revendu se compte a l'unite et se
 * consomme par les VENTES, pas par la production.
 *
 * DEUX lots sur le meme bon de livraison, et non un seul. Un lot unique aurait
 * rendu la FEFO indiscernable d'un simple decompte : avec deux DLC differentes,
 * la vente doit vider d'abord le lot le plus proche de la peremption, et le
 * mouvement de sortie le prouve. La situation est courante — le producteur
 * solde une fin de serie en meme temps qu'il livre du frais.
 *
 * `dateDlc: null` signifie « pas saisie » et non « pas de DLC » : elle est alors
 * DEDUITE de la duree de conservation declaree sur l'ingredient (365 jours).
 * C'est le seul chemin de la demonstration qui exerce cette derivation.
 */
const POTS_PAR_CARTON = 12;
const PRIX_CARTON_CENTS = 5760;

const RECEPTION_TERROIR: readonly {
  cartons: number;
  numeroLotFournisseur: string;
  /** `null` = DLC deduite de la duree de conservation de l'ingredient. */
  joursAvantDlc: number | null;
}[] = [
  // Fin de serie : DLC plus proche, donc servi EN PREMIER par la FEFO.
  { cartons: 2, numeroLotFournisseur: 'DÉMO-SIROP-FIN-SERIE', joursAvantDlc: 120 },
  { cartons: 3, numeroLotFournisseur: 'DÉMO-SIROP-01', joursAvantDlc: null },
];

const NOM_INGREDIENT_REVENDU = 'Sirop de Liège (pot 450 g)';
const NOM_INGREDIENT_GARNITURE_SUCRE = 'Vergeoise blonde';
const NOM_INGREDIENT_GARNITURE_SIROP = 'Sirop de Liège en vrac (seau 2,5 kg)';

/**
 * L'appro de GARNITURE : ce qui s'etale sur la crepe au moment du service.
 *
 * Deux quantites choisies pour que la session tienne SANS ecart, mais de peu :
 *   - cassonade : 72 crepes × 20 g = 1 440 g. Le premier lot de vergeoise, entamé
 *     par la production (537 g sur 1 000 g), n'en a plus que 463 : la sortie doit
 *     donc VIDER ce lot puis mordre sur le neuf. C'est la seule ligne de la
 *     demonstration ou la FEFO a deux lots du meme ingredient a departager sur
 *     une sortie de vente, et le mouvement en garde la preuve ;
 *   - sirop en vrac : 62 crepes × 20 g = 1 240 g sur un seau de 2 500 g.
 *
 * Prix FICTIFS, alignes sur les conditionnements du referentiel.
 */
const RECEPTION_GARNITURE_EPICERIE = {
  nom: NOM_INGREDIENT_GARNITURE_SUCRE,
  quantite: 2000,
  prixLigneCents: 640,
  numeroLotFournisseur: 'DÉMO-VERGEOISE-02',
} as const;

const RECEPTION_GARNITURE_TERROIR = {
  nom: NOM_INGREDIENT_GARNITURE_SIROP,
  quantite: 2500,
  prixLigneCents: 2200,
  numeroLotFournisseur: 'DÉMO-SIROP-VRAC-01',
  joursAvantDlc: 180,
} as const;

/**
 * Le mix de vente du dimanche.
 *
 * 72 + 62 = 134 crepes (`CLAUDE.md` §6) et 54 pots. CA = 21 600 + 21 700 +
 * 40 500 = 83 800 c, soit exactement les ~838 € annonces. La part revendue pese
 * alors 48,3 % du CA pour environ 27 % de la marge : c'est precisement l'ecart
 * que les compteurs de seuils doivent rendre visible.
 */
const MIX_DE_VENTE: readonly { nomProduit: string; quantite: number; prixUnitaireCents: number }[] =
  [
    { nomProduit: '[démo] Crêpe froment / cassonade', quantite: 72, prixUnitaireCents: 300 },
    { nomProduit: '[démo] Crêpe froment / Sirop de Liège', quantite: 62, prixUnitaireCents: 350 },
    { nomProduit: '[démo] Sirop de Liège — pot 450 g', quantite: 54, prixUnitaireCents: 750 },
  ];

const CREPES_VENDUES = 134;
const CREPES_INVENDUES = 4;
const CREPES_CASSEES = 2;
/** Ce qu'il faut cuire pour vendre 134 crepes en gardant de quoi finir la matinee. */
const CREPES_A_PRODUIRE = CREPES_VENDUES + CREPES_INVENDUES + CREPES_CASSEES;

/**
 * Fond de bassine : la pate qui ne devient jamais une crepe.
 *
 * Ecart THEORIQUE/REEL volontaire. Sans lui, `volume_reel_ml` egalerait le
 * theorique et l'ecran d'analyse d'ecart n'aurait jamais rien a montrer — alors
 * que c'est un des rares chiffres que l'utilisateur doit apprendre a lire sur
 * ses propres fournees.
 */
const FOND_DE_BASSINE_ML = 220;

/**
 * Frais de la session.
 *
 * `emplacement` reste a ZERO : le tarif de La Batte n'est documente nulle part
 * (voir la note du lieu dans `demonstration.ts`), et inventer un montant
 * d'emplacement gonflerait artificiellement une charge dans une piece
 * comptable. Le deplacement et le gaz, eux, sont des ordres de grandeur
 * fictifs mais inoffensifs.
 */
const FRAIS = {
  emplacementCents: 0,
  deplacementCents: 1400,
  gazCents: 800,
  diversCents: 0,
} as const;

const FONDS_CAISSE_CENTS = 5000;
/** Part encaissee par terminal. C'est la seule assiette de la commission SumUp. */
const CA_CARTE_CENTS = 37_000;
/** Tickets comptes sur le terminal : seule source honnete du panier moyen. */
const NB_TICKETS = 156;

const HEURE_DEBUT_REELLE = '08:00';
/** 08:00 → 14:30 = 6 h 30, la fenetre de `CLAUDE.md` §6. */
const HEURE_FIN_REELLE = '14:30';

export type ResultatSeedActivite = {
  receptions: number;
  productions: number;
  sessionsCloturees: number;
  /** Remonte tel quel : un ecart silencieux serait pire qu'une graine qui echoue. */
  ecartsStock: readonly EcartStockVente[];
};

const RIEN: ResultatSeedActivite = {
  receptions: 0,
  productions: 0,
  sessionsCloturees: 0,
  ecartsStock: [],
};

/* ═══════════════════════════════════════════════════════════════════════════
   Seed
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Idempotent PAR ETAPE : chaque etape verifie sa propre presence avant d'ecrire.
 *
 * Relancer ne duplique ni reception, ni production, ni cloture. Une installation
 * interrompue au milieu reprend a l'etape suivante — c'est la seule facon de ne
 * pas dependre d'un `db:reset` pour completer une demonstration.
 */
export function seedDemonstrationActivite(base: BaseBatte): ResultatSeedActivite {
  const lieu = base
    .select({ id: lieuMarche.id, jourSemaine: lieuMarche.jourSemaine })
    .from(lieuMarche)
    .where(eq(lieuMarche.nom, 'La Batte'))
    .get();
  // Le referentiel n'est pas installe : on ne fabrique pas un historique sur du
  // vide, on ne fait rien et on le dit par un compteur a zero.
  if (lieu === undefined) return RIEN;

  const dateSession = dernierJourDeMarche(lieu.jourSemaine ?? 0);
  const jourEpicerie = ajouterJours(dateSession, JOURS_AVANT_MARCHE.approEpicerie);
  const jourTerroir = ajouterJours(dateSession, JOURS_AVANT_MARCHE.approTerroir);
  const jourGarniture = ajouterJours(dateSession, JOURS_AVANT_MARCHE.approGarniture);
  const jourProduction = ajouterJours(dateSession, JOURS_AVANT_MARCHE.production);

  const receptions =
    seedReceptionEpicerie(base, jourEpicerie) +
    seedReceptionTerroir(base, jourTerroir) +
    seedReceptionsGarniture(base, jourGarniture);

  const sessionId = seedSessionPassee(base, lieu.id, dateSession);
  if (sessionId === null) return { ...RIEN, receptions };

  const productions = seedProduction(base, sessionId, jourProduction);
  const cloture = seedCloture(base, sessionId);

  return {
    receptions,
    productions,
    sessionsCloturees: cloture === null ? 0 : 1,
    ecartsStock: cloture ?? [],
  };
}

/** Dernier dimanche STRICTEMENT passe : une session close ne peut pas etre a venir. */
function dernierJourDeMarche(jourSemaine: number): string {
  const aujourdHui = new Date(`${jourCivilBelge(new Date())}T12:00:00Z`);
  // `|| 7` : quand aujourd'hui EST le jour de marche, on remonte d'une semaine
  // entiere plutot que de dater la session close du jour meme.
  const ecart = (aujourdHui.getUTCDay() - jourSemaine + 7) % 7 || 7;
  aujourdHui.setUTCDate(aujourdHui.getUTCDate() - ecart);
  return aujourdHui.toISOString().slice(0, 10);
}

/** `true` si la reception portant ce bon de livraison a deja ete enregistree. */
function receptionDejaEnregistree(base: BaseBatte, numeroBonLivraison: string): boolean {
  return (
    base
      .select({ id: reception.id })
      .from(reception)
      .where(eq(reception.numeroBonLivraison, numeroBonLivraison))
      .limit(1)
      .all().length > 0
  );
}

function idFournisseurParNom(base: BaseBatte, nom: string): string | null {
  return (
    base.select({ id: fournisseur.id }).from(fournisseur).where(eq(fournisseur.nom, nom)).get()
      ?.id ?? null
  );
}

function idIngredientParNom(base: BaseBatte, nom: string): string | null {
  return (
    base.select({ id: ingredient.id }).from(ingredient).where(eq(ingredient.nom, nom)).get()?.id ??
    null
  );
}

function seedReceptionEpicerie(base: BaseBatte, jour: string): number {
  if (receptionDejaEnregistree(base, BL_EPICERIE)) return 0;

  const fournisseurId = idFournisseurParNom(base, '[démo] Fournisseur générique');
  if (fournisseurId === null) return 0;

  const lignes = RECEPTION_EPICERIE.map((l) => {
    const ingredientId = idIngredientParNom(base, l.nom);
    if (ingredientId === null) return null;
    return {
      ingredientId,
      quantite: l.quantite,
      prixLigneCents: l.prixLigneCents,
      numeroLotFournisseur: l.numeroLotFournisseur,
      dateDlc: l.joursAvantDlc === null ? null : ajouterJours(jour, l.joursAvantDlc),
    };
  }).filter((l): l is NonNullable<typeof l> => l !== null);

  if (lignes.length === 0) return 0;

  enregistrerReception(base, {
    fournisseurId,
    dateReception: jour,
    numeroBonLivraison: BL_EPICERIE,
    notes:
      'Réception de démonstration : matière première de la recette R1, en conditionnements ' +
      'entiers. Les prix reprennent le tarif catalogue fictif du fournisseur.',
    lignes,
  });

  return 1;
}

function seedReceptionTerroir(base: BaseBatte, jour: string): number {
  if (receptionDejaEnregistree(base, BL_TERROIR)) return 0;

  const fournisseurId = idFournisseurParNom(base, '[démo] Producteur local (terroir)');
  const ingredientId = idIngredientParNom(base, NOM_INGREDIENT_REVENDU);
  if (fournisseurId === null || ingredientId === null) return 0;

  enregistrerReception(base, {
    fournisseurId,
    dateReception: jour,
    numeroBonLivraison: BL_TERROIR,
    notes:
      'Réception de démonstration : article REVENDU, acheté préemballé et revendu tel quel. ' +
      'Aucune recette ne le consomme — il ne sort du stock que par la vente. Deux lots de DLC ' +
      'différentes, pour que la FEFO ait quelque chose à trancher.',
    lignes: RECEPTION_TERROIR.map((l) => ({
      ingredientId,
      quantite: l.cartons * POTS_PAR_CARTON,
      prixLigneCents: l.cartons * PRIX_CARTON_CENTS,
      numeroLotFournisseur: l.numeroLotFournisseur,
      dateDlc: l.joursAvantDlc === null ? null : ajouterJours(jour, l.joursAvantDlc),
    })),
  });

  return 1;
}

/**
 * Les deux receptions de GARNITURE. Rend le nombre de bons enregistres (0 a 2).
 *
 * Sans elles, les garnitures declarees sur les produits n'auraient aucun stock a
 * consommer : la cloture remonterait deux ecarts et la demonstration montrerait
 * une rupture la ou elle veut montrer une chaine qui tient.
 */
function seedReceptionsGarniture(base: BaseBatte, jour: string): number {
  let bons = 0;

  const idSucre = idIngredientParNom(base, RECEPTION_GARNITURE_EPICERIE.nom);
  const idGrossiste = idFournisseurParNom(base, '[démo] Fournisseur générique');
  if (
    idSucre !== null &&
    idGrossiste !== null &&
    !receptionDejaEnregistree(base, BL_GARNITURE_EPICERIE)
  ) {
    enregistrerReception(base, {
      fournisseurId: idGrossiste,
      dateReception: jour,
      numeroBonLivraison: BL_GARNITURE_EPICERIE,
      notes:
        'Réception de démonstration : la cassonade ÉTALÉE sur la crêpe, distincte de celle qui ' +
        'entre dans la pâte. Même ingrédient, deux usages — la production en sort au moment de ' +
        'la fournée, la garniture au moment du service.',
      lignes: [
        {
          ingredientId: idSucre,
          quantite: RECEPTION_GARNITURE_EPICERIE.quantite,
          prixLigneCents: RECEPTION_GARNITURE_EPICERIE.prixLigneCents,
          numeroLotFournisseur: RECEPTION_GARNITURE_EPICERIE.numeroLotFournisseur,
          dateDlc: null,
        },
      ],
    });
    bons += 1;
  }

  const idSirop = idIngredientParNom(base, RECEPTION_GARNITURE_TERROIR.nom);
  const idTerroir = idFournisseurParNom(base, '[démo] Producteur local (terroir)');
  if (
    idSirop !== null &&
    idTerroir !== null &&
    !receptionDejaEnregistree(base, BL_GARNITURE_TERROIR)
  ) {
    enregistrerReception(base, {
      fournisseurId: idTerroir,
      dateReception: jour,
      numeroBonLivraison: BL_GARNITURE_TERROIR,
      notes:
        'Réception de démonstration : sirop de Liège EN VRAC, la version qui se tartine. Ce ' +
        "n'est pas le pot revendu tel quel : autre conditionnement, autre unité de stock, autre " +
        'point de commande.',
      lignes: [
        {
          ingredientId: idSirop,
          quantite: RECEPTION_GARNITURE_TERROIR.quantite,
          prixLigneCents: RECEPTION_GARNITURE_TERROIR.prixLigneCents,
          numeroLotFournisseur: RECEPTION_GARNITURE_TERROIR.numeroLotFournisseur,
          dateDlc: ajouterJours(jour, RECEPTION_GARNITURE_TERROIR.joursAvantDlc),
        },
      ],
    });
    bons += 1;
  }

  return bons;
}

/**
 * La session passee. Rend son identifiant, ou `null` si le lieu n'existe pas.
 *
 * Volontairement creee par `creerSession` : c'est elle qui alloue le numero
 * dans la sequence legale, et une session de demonstration n'a aucune raison
 * d'echapper a la numerotation sans trou.
 */
function seedSessionPassee(base: BaseBatte, lieuId: string, dateSession: string): string | null {
  const existante = base
    .select({ id: sessionMarche.id })
    .from(sessionMarche)
    .where(eq(sessionMarche.dateSession, dateSession))
    .get();
  if (existante !== undefined) return existante.id;

  return creerSession(base, {
    lieuId,
    dateSession,
    fondsCaisseInitialCents: FONDS_CAISSE_CENTS,
  }).id;
}

function seedProduction(base: BaseBatte, sessionId: string, jourProduction: string): number {
  const dejaProduite = base
    .select({ id: production.id })
    .from(production)
    .where(and(eq(production.sessionId, sessionId), ne(production.statut, 'annulee')))
    .limit(1)
    .all();
  if (dejaProduite.length > 0) return 0;

  const idR1 = base
    .select({ id: recette.id })
    .from(recette)
    .where(and(eq(recette.code, 'R1'), eq(recette.version, 1)))
    .get();
  if (idR1 === undefined) return 0;

  const lancee = lancerProduction(base, {
    recetteId: idR1.id,
    // Cible en CREPES et non en volume : c'est ainsi qu'on raisonne le samedi
    // soir (« il m'en faut 140 »), et c'est le seul chiffre qui a un sens
    // commercial. Le volume s'en deduit.
    cible: { type: 'crepes', crepesVendables: CREPES_A_PRODUIRE },
    dateProduction: jourProduction,
    sessionId,
    notes: 'Fournée de démonstration pour la session du dimanche suivant.',
  });

  saisirRealise(base, lancee.productionId, {
    volumeReelMl: lancee.volumeTheoriqueMl - FOND_DE_BASSINE_ML,
    crepesReelles: CREPES_A_PRODUIRE,
    ecartMotif:
      'Fond de bassine sur les deux plaques : le volume réel est inférieur au théorique, ' +
      'le nombre de crêpes ne bouge pas.',
  });

  return 1;
}

/**
 * Cloture. Rend les ecarts de stock constates, ou `null` si rien n'a ete fait.
 *
 * Aucune valeur agregee n'est passee : le CA, la ventilation transforme /
 * revendu, la commission SumUp et les marges sont TOUS calcules par le service,
 * a partir des lignes de vente. Une graine qui les ecrirait elle-meme
 * fabriquerait une piece comptable que l'application ne sait pas reproduire.
 */
function seedCloture(base: BaseBatte, sessionId: string): readonly EcartStockVente[] | null {
  const session = base
    .select({ statut: sessionMarche.statut })
    .from(sessionMarche)
    .where(eq(sessionMarche.id, sessionId))
    .get();
  if (session === undefined || session.statut !== 'planifiee') return null;

  const ventes = MIX_DE_VENTE.map((v) => {
    const produit = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nom, v.nomProduit))
      .get();
    if (produit === undefined) return null;
    return {
      produitVenteId: produit.id,
      quantite: v.quantite,
      prixUnitaireCents: v.prixUnitaireCents,
    };
  }).filter((v): v is NonNullable<typeof v> => v !== null);

  // Une cloture sans ligne de vente est refusee par le service, a raison :
  // mieux vaut laisser la session planifiee que d'inventer une vente.
  if (ventes.length === 0) return null;

  const caCents = ventes.reduce((total, v) => total + v.quantite * v.prixUnitaireCents, 0);

  const resultat = cloturerSession(base, sessionId, {
    ventes,
    frais: FRAIS,
    fondsCaisseInitialCents: FONDS_CAISSE_CENTS,
    // Especes comptees = fonds de tete + tout ce qui n'a pas ete paye par
    // carte. La caisse tombe donc juste : un ecart non nul dans une graine
    // ferait croire a une erreur de saisie des la premiere ouverture.
    especesCompteesCents: FONDS_CAISSE_CENTS + caCents - CA_CARTE_CENTS,
    caCarteCents: CA_CARTE_CENTS,
    // `crepesProduites` n'est PAS passe : il est DERIVE de la production
    // rattachee. Le ressaisir ici serait exactement la ressaisie que la thèse
    // du produit interdit (`CLAUDE.md` §0).
    crepesInvendues: CREPES_INVENDUES,
    crepesCassees: CREPES_CASSEES,
    heureDebutReelle: HEURE_DEBUT_REELLE,
    heureFinReelle: HEURE_FIN_REELLE,
    nbTickets: NB_TICKETS,
    notesQualitatives:
      'Session de DÉMONSTRATION. Chiffres cohérents avec les ordres de grandeur de ' +
      'CLAUDE.md §6 (6 h 30, ~838 € de CA, ~134 crêpes), pas avec un marché réel. ' +
      "Le frais d'emplacement est à zéro parce que le tarif de La Batte n'est pas documenté : " +
      'renseignez-le avant votre première vraie session, sinon la marge nette est surévaluée.',
  });

  return resultat.ecartsStock;
}
