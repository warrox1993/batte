/**
 * PARCOURS DES TROIS NATURES DE PRODUIT — transformé, revendu, menu
 * (CLAUDE.md §6).
 *
 * CE QUE CE PARCOURS DÉFEND, ET POURQUOI ÇA COMPTE PLUS QUE ÇA N'EN A L'AIR.
 * « À marge égale, la revente génère environ 2,6 fois plus de CHIFFRE
 * D'AFFAIRES que la crêpe. Or les seuils légaux belges portent sur le CA, pas
 * sur la marge. » Une ventilation transformé/revendu fausse ne se voit donc
 * NULLE PART dans la marge affichée — elle ne se découvre que le jour où le
 * porteur apprend qu'il est sorti de la franchise TVA sans l'avoir vu venir.
 *
 * LE MENU EST LE MAILLON FRAGILE. Il n'a ni recette ni article propre : son
 * prix doit se RÉPARTIR entre ses composants, chacun retombant dans SA nature.
 * Un menu compté en bloc dans l'une des deux natures laisserait la somme
 * juste et la ventilation fausse — exactement le genre de défaut qu'un test
 * unitaire de `ventilerMenu` ne peut pas voir, puisqu'il ne traverse ni la
 * clôture de session ni les compteurs de seuils.
 *
 * CHIFFRES CHOISIS POUR NE PAS TOMBER ROND. Menu à 7,33 € pour une crêpe à
 * 4,58 € et un sirop à 3,95 € : le prorata donne 733 × 458/853 = 393,57 c —
 * une part qui n'existe pas en centimes entiers. L'arrondi doit donc tomber sur
 * UNE seule part et la DERNIÈRE se déduire par SOUSTRACTION (`repartir`,
 * `@batte/core`), sinon la somme des parts ne vaut plus le prix du menu.
 * Les trois quantités vendues sont elles aussi dissemblables (17, 11, 9) :
 * des quantités égales rendraient les deux natures indiscernables.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  jourCivilBelge,
  ratioEnPointsDeBase,
  schemaEtatStock,
  schemaListeProduitsVendables,
  schemaProductionDetail,
  schemaResultatCloture,
  schemaTableauSeuils,
  schemaVentilationMenu,
} from '@batte/core';
import { creerBase, migrer, seed, type BaseBatte } from '@batte/db';
import { construireServeur } from './serveur.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Les trois produits et le mix de vente
   ═══════════════════════════════════════════════════════════════════════════ */

const PRIX_CREPE_CENTS = 458;
const PRIX_SIROP_CENTS = 395;
const PRIX_MENU_CENTS = 733;

const QUANTITE_CREPES_SEULES = 17;
const QUANTITE_SIROPS_SEULS = 11;
const QUANTITE_MENUS = 9;

/** Réception du sirop : 27 pots pour 6 749 c, soit 249,96… c le pot. */
const RECEPTION_SIROP = { quantite: 27, prixLigneCents: 6_749, lot: 'SIR-2026-B' };
const RECEPTION_FARINE = { quantite: 7_333, prixLigneCents: 689, lot: 'FAR-2026-A' };
const RECEPTION_LAIT = { quantite: 4_111, prixLigneCents: 501, lot: 'LAI-2026-A' };
const RECEPTION_OEUFS = { quantite: 53, prixLigneCents: 1_093, lot: 'OEU-2026-A' };

const FRAIS = {
  emplacementCents: 1_137,
  deplacementCents: 823,
  gazCents: 449,
  diversCents: 211,
};
const FONDS_CAISSE_CENTS = 4_700;
const CA_CARTE_CENTS = 9_111;

/* ═══════════════════════════════════════════════════════════════════════════
   Montage
   ═══════════════════════════════════════════════════════════════════════════ */

let base: BaseBatte;
let app: FastifyInstance;
const envInitial: Record<string, string | undefined> = {};

let idFournisseur = '';
let idFarine = '';
let idLait = '';
let idOeufs = '';
let idSirop = '';
let idRecette = '';
let idLieu = '';
let idSession = '';
let idProduitCrepe = '';
let idProduitSirop = '';
let idMenu = '';
let aujourdhui = '';

/** Parts du prix du menu, telles que le serveur les ventile. Relevées à l'étape 2. */
let partMenuTransformeCents = 0;
let partMenuRevenduCents = 0;
/** La fournée unique qui sert les deux canaux de vente. Relevée à l'étape 3. */
let idProduction = '';
let coutProductionCents = 0;
let crepesProduites = 0;

function memoriserEtDefinir(cle: string, valeur: string | undefined): void {
  envInitial[cle] = process.env[cle];
  if (valeur === undefined) delete process.env[cle];
  else process.env[cle] = valeur;
}

function jourDecale(jours: number): string {
  const reference = new Date(`${aujourdhui}T12:00:00Z`);
  reference.setUTCDate(reference.getUTCDate() + jours);
  return reference.toISOString().slice(0, 10);
}

async function poster(url: string, payload: Record<string, unknown>): Promise<string> {
  const reponse = await app.inject({ method: 'POST', url, payload });
  if (reponse.statusCode !== 201)
    throw new Error(`${url} a répondu ${reponse.statusCode} : ${reponse.payload}`);
  return reponse.json<{ id: string }>().id;
}

beforeAll(async () => {
  memoriserEtDefinir('ANTHROPIC_API_KEY', undefined);
  memoriserEtDefinir('MAIL_MODE_TEST', 'true');
  memoriserEtDefinir('OPENROUTESERVICE_API_KEY', undefined);

  base = creerBase(':memory:');
  migrer(base);
  seed(base);

  app = construireServeur(base, { journaliser: false });
  await app.ready();

  aujourdhui = jourCivilBelge(new Date());

  idFournisseur = await poster('/api/fournisseurs', {
    nom: 'Coopérative du Pays de Herve',
    type: 'grossiste',
    email: null,
    telephone: null,
    adresse: null,
    delaiLivraisonJours: 4,
    francoDePortCents: null,
    commandeMinimumCents: null,
    notes: null,
  });

  idFarine = await poster('/api/ingredients', {
    nom: 'Farine de froment T55',
    categorie: 'farine',
    uniteReference: 'g',
    densiteGParMl: null,
    allergenes: ['gluten'],
    allergenesVerifies: true,
    stockSecurite: 2_000,
    delaiLivraisonJours: 3,
    dureeConservationJours: 187,
    notes: null,
  });
  idLait = await poster('/api/ingredients', {
    nom: 'Lait entier',
    categorie: 'laitier',
    uniteReference: 'ml',
    densiteGParMl: 1.03,
    allergenes: ['lait'],
    allergenesVerifies: true,
    stockSecurite: 1_500,
    delaiLivraisonJours: 2,
    dureeConservationJours: 9,
    notes: null,
  });
  idOeufs = await poster('/api/ingredients', {
    nom: 'Œuf de poule plein air',
    categorie: 'oeuf',
    uniteReference: 'piece',
    densiteGParMl: null,
    allergenes: ['oeufs'],
    allergenesVerifies: true,
    stockSecurite: 12,
    delaiLivraisonJours: 2,
    dureeConservationJours: 23,
    notes: null,
  });
  // Le REVENDU : acheté préemballé, compté à la pièce, jamais transformé.
  idSirop = await poster('/api/ingredients', {
    nom: 'Sirop de Liège 450 g',
    categorie: 'garniture',
    uniteReference: 'piece',
    densiteGParMl: null,
    allergenes: [],
    allergenesVerifies: true,
    stockSecurite: 6,
    delaiLivraisonJours: 4,
    dureeConservationJours: 365,
    notes: null,
  });

  for (const [ingredientId, libelle, quantiteUniteRef, prixCents] of [
    [idFarine, 'Sac 25 kg', 25_000, 2_347],
    [idLait, 'Bidon 6 L', 6_000, 731],
    [idOeufs, 'Plateau de 30', 30, 619],
    [idSirop, 'Carton de 12 pots', 12, 2_988],
  ] as const) {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/conditionnements',
      payload: {
        ingredientId,
        fournisseurId: idFournisseur,
        libelle,
        quantiteUniteRef,
        prixCents,
        referenceFournisseur: null,
        datePrix: aujourdhui,
      },
    });
    if (reponse.statusCode !== 201) throw new Error(`Conditionnement refusé : ${reponse.payload}`);
  }

  idRecette = await poster('/api/recettes', {
    code: 'P1',
    nom: 'Pâte froment — natures',
    typePate: 'froment',
    sansGluten: false,
    rendementReferenceMl: 5_000,
    rendementReferenceCrepes: 66,
    perteCuissonBp: 300,
    tauxCasseBp: 150,
    perteFixeMl: 0,
    procede: null,
    notes: null,
    lignes: [
      { ingredientId: idFarine, quantiteUniteRef: 1_595, noteTechnique: null },
      { ingredientId: idLait, quantiteUniteRef: 2_640, noteTechnique: null },
      { ingredientId: idOeufs, quantiteUniteRef: 22, noteTechnique: null },
    ],
  });
  await app.inject({
    method: 'PATCH',
    url: `/api/recettes/${idRecette}/statut`,
    payload: { statut: 'active' },
  });

  idLieu = await poster('/api/lieux', {
    nom: 'La Batte — natures',
    adresse: null,
    latitude: null,
    longitude: null,
    jourSemaine: 0,
    heureDebut: '07:30',
    heureFin: '14:00',
    tarifEmplacementCents: FRAIS.emplacementCents,
    modeTarification: 'jour',
    metresLineaires: null,
    distanceKm: 12.4,
    facturationElectricite: 'aucune',
    puissanceDisponibleW: null,
    notes: null,
  });

  // Réception UNIQUE des quatre articles : le sirop revendu entre en stock
  // exactement comme la farine, avec son lot et sa DLC (l'AFSCA ne distingue
  // pas le transformé du revendu).
  const reception = await app.inject({
    method: 'POST',
    url: '/api/receptions',
    payload: {
      fournisseurId: idFournisseur,
      dateReception: aujourdhui,
      numeroBonLivraison: 'BL-HERVE-9042',
      lignes: [
        {
          ingredientId: idFarine,
          quantite: RECEPTION_FARINE.quantite,
          prixLigneCents: RECEPTION_FARINE.prixLigneCents,
          numeroLotFournisseur: RECEPTION_FARINE.lot,
          dateDlc: jourDecale(187),
        },
        {
          ingredientId: idLait,
          quantite: RECEPTION_LAIT.quantite,
          prixLigneCents: RECEPTION_LAIT.prixLigneCents,
          numeroLotFournisseur: RECEPTION_LAIT.lot,
          dateDlc: jourDecale(9),
        },
        {
          ingredientId: idOeufs,
          quantite: RECEPTION_OEUFS.quantite,
          prixLigneCents: RECEPTION_OEUFS.prixLigneCents,
          numeroLotFournisseur: RECEPTION_OEUFS.lot,
          dateDlc: jourDecale(23),
        },
        {
          ingredientId: idSirop,
          quantite: RECEPTION_SIROP.quantite,
          prixLigneCents: RECEPTION_SIROP.prixLigneCents,
          numeroLotFournisseur: RECEPTION_SIROP.lot,
          dateDlc: jourDecale(365),
        },
      ],
    },
  });
  if (reception.statusCode !== 201) throw new Error(`Réception refusée : ${reception.payload}`);
}, 60_000);

afterAll(async () => {
  await app.close();
  for (const [cle, valeur] of Object.entries(envInitial)) {
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
}, 60_000);

/* ═══════════════════════════════════════════════════════════════════════════
   Le parcours
   ═══════════════════════════════════════════════════════════════════════════ */

describe('parcours des trois natures — un transformé, un revendu, un menu, dans une seule session', () => {
  it('étape 1 — les trois natures se saisissent, chacune avec SES rattachements obligatoires', async () => {
    idProduitCrepe = await poster('/api/produits', {
      nom: 'Crêpe sucre',
      nature: 'transforme',
      recetteId: idRecette,
      ingredientId: null,
      prixCents: PRIX_CREPE_CENTS,
      consommationUnite: 'crepes',
      nbCrepes: 1,
      categorie: 'crepe',
      consommationSurPlace: true,
    });

    idProduitSirop = await poster('/api/produits', {
      nom: 'Pot de sirop de Liège',
      nature: 'revendu',
      recetteId: null,
      ingredientId: idSirop,
      prixCents: PRIX_SIROP_CENTS,
      categorie: 'terroir',
      consommationSurPlace: false,
    });

    // Un menu n'a NI recette NI article : son coût vient de ses composants.
    idMenu = await poster('/api/produits', {
      nom: 'Menu crêpe + sirop',
      nature: 'menu',
      recetteId: null,
      ingredientId: null,
      prixCents: PRIX_MENU_CENTS,
      categorie: 'menu',
      consommationSurPlace: true,
    });

    /* ── Les règles de cohérence sont bien appliquées, pas décoratives ──── */

    const menuAvecRecette = await app.inject({
      method: 'POST',
      url: '/api/produits',
      payload: {
        nom: 'Menu incohérent',
        nature: 'menu',
        recetteId: idRecette,
        ingredientId: null,
        prixCents: 500,
        categorie: null,
        consommationSurPlace: true,
      },
    });
    expect(menuAvecRecette.statusCode).toBe(422);
    expect(
      menuAvecRecette.json<{ erreur: { champs?: Record<string, string> } }>().erreur.champs,
    ).toHaveProperty('recetteId');

    const produits = schemaListeProduitsVendables.parse(
      (await app.inject({ method: 'GET', url: '/api/produits-vendables' })).json(),
    );
    // Un menu DOIT être vendable : sinon la fonctionnalité n'a aucun sens.
    expect(produits.data.map((p) => p.nature).sort()).toEqual(['menu', 'revendu', 'transforme']);
  });

  it('étape 2 — la composition du menu se déclare, et son prix se ventile sur SES composants', async () => {
    const composant = async (produitInclusId: string): Promise<void> => {
      const reponse = await app.inject({
        method: 'POST',
        url: `/api/menus/${idMenu}/composition`,
        payload: { produitInclusId, quantite: 1 },
      });
      expect(reponse.statusCode, reponse.payload).toBe(201);
    };
    await composant(idProduitCrepe);
    await composant(idProduitSirop);

    const ventilation = schemaVentilationMenu.parse(
      (
        await app.inject({ method: 'POST', url: `/api/menus/${idMenu}/ventilation`, payload: {} })
      ).json(),
    );

    partMenuTransformeCents = ventilation.parNatureCents.transforme;
    partMenuRevenduCents = ventilation.parNatureCents.revendu;

    /*
     * LE PRORATA, AU CENTIME. Les poids sont les prix catalogue : 458 et 395,
     * soit 853 au total. 733 × 458 / 853 = 393,57 c — un nombre qui n'existe
     * pas. Une seule part est arrondie, la SECONDE est le RESTE : c'est ce qui
     * garantit que la somme vaut exactement le prix du menu, pour tout prix.
     */
    const poidsTotal = PRIX_CREPE_CENTS + PRIX_SIROP_CENTS;
    expect(partMenuTransformeCents).toBe(
      Math.round((PRIX_MENU_CENTS * PRIX_CREPE_CENTS) / poidsTotal),
    );
    expect(partMenuRevenduCents).toBe(PRIX_MENU_CENTS - partMenuTransformeCents);
    // AUCUN centime ne se perd ni ne se crée dans la ventilation.
    expect(partMenuTransformeCents + partMenuRevenduCents).toBe(PRIX_MENU_CENTS);

    // Et la remise du menu est réelle : vendus séparément, les deux coûteraient
    // plus cher. Sans cet écart, le prorata ne prouverait rien.
    expect(ventilation.prixSepareTotalCents).toBe(poidsTotal);
    expect(ventilation.prixSepareTotalCents).toBeGreaterThan(PRIX_MENU_CENTS);
  });

  it('étape 3 — une seule fournée sert les deux canaux : crêpes seules ET crêpes de menu', async () => {
    idSession = await poster('/api/sessions', {
      lieuId: idLieu,
      dateSession: aujourdhui,
      fondsCaisseInitialCents: FONDS_CAISSE_CENTS,
    });

    const production = await app.inject({
      method: 'POST',
      url: '/api/productions',
      payload: {
        recetteId: idRecette,
        cible: { cible: 'crepes', valeur: 47 },
        dateProduction: aujourdhui,
        sessionId: idSession,
        notes: 'Fournée du parcours « trois natures ».',
      },
    });
    expect(production.statusCode, production.payload).toBe(201);
    const detail = schemaProductionDetail.parse(production.json());
    idProduction = detail.id;
    coutProductionCents = detail.coutMatiereTheoriqueCents;
    crepesProduites = detail.crepesTheoriques;

    // La fournée doit couvrir les crêpes des DEUX canaux, sinon la session
    // serait incohérente et le test ne mesurerait plus la ventilation.
    expect(crepesProduites).toBeGreaterThanOrEqual(QUANTITE_CREPES_SEULES + QUANTITE_MENUS);
    expect(detail.sessionId).toBe(idSession);
    expect(coutProductionCents).toBeGreaterThan(0);
  });

  it('étape 4 — la clôture ventile le CA, MENU COMPRIS, au prorata de ses composants', async () => {
    const stockAvant = schemaEtatStock.parse(
      (await app.inject({ method: 'GET', url: '/api/stock' })).json(),
    );
    const siropAvant = stockAvant.data.find((l) => l.ingredientId === idSirop)!.quantiteDisponible;

    const caAttenduCents =
      QUANTITE_CREPES_SEULES * PRIX_CREPE_CENTS +
      QUANTITE_SIROPS_SEULS * PRIX_SIROP_CENTS +
      QUANTITE_MENUS * PRIX_MENU_CENTS;
    const crepesVendues = QUANTITE_CREPES_SEULES + QUANTITE_MENUS;
    const crepesCassees = 3;

    const cloture = await app.inject({
      method: 'POST',
      url: `/api/sessions/${idSession}/cloturer`,
      payload: {
        ventes: [
          {
            produitVenteId: idProduitCrepe,
            quantite: QUANTITE_CREPES_SEULES,
            prixUnitaireCents: PRIX_CREPE_CENTS,
          },
          {
            produitVenteId: idProduitSirop,
            quantite: QUANTITE_SIROPS_SEULS,
            prixUnitaireCents: PRIX_SIROP_CENTS,
          },
          {
            produitVenteId: idMenu,
            quantite: QUANTITE_MENUS,
            prixUnitaireCents: PRIX_MENU_CENTS,
          },
        ],
        frais: FRAIS,
        fondsCaisseInitialCents: FONDS_CAISSE_CENTS,
        especesCompteesCents: FONDS_CAISSE_CENTS + (caAttenduCents - CA_CARTE_CENTS),
        caCarteCents: CA_CARTE_CENTS,
        crepesInvendues: crepesProduites - crepesVendues - crepesCassees,
        crepesCassees,
        heureDebutReelle: '07:30',
        heureFinReelle: '14:00',
        nbTickets: 29,
      },
    });
    expect(cloture.statusCode, cloture.payload).toBe(200);
    const resultat = schemaResultatCloture.parse(cloture.json());

    /* ── Le CA total, d'abord : rien ne doit se perdre ────────────────────── */

    expect(resultat.caTotalCents).toBe(caAttenduCents);

    /* ── LA VENTILATION, LE CŒUR DE CE PARCOURS ──────────────────────────── */

    const caTransformeAttenduCents =
      QUANTITE_CREPES_SEULES * PRIX_CREPE_CENTS + QUANTITE_MENUS * partMenuTransformeCents;
    const caRevenduAttenduCents =
      QUANTITE_SIROPS_SEULS * PRIX_SIROP_CENTS + QUANTITE_MENUS * partMenuRevenduCents;

    expect(resultat.caTransformeCents).toBe(caTransformeAttenduCents);
    expect(resultat.caRevenduCents).toBe(caRevenduAttenduCents);
    // La ventilation est EXHAUSTIVE : aucun euro de menu ne reste hors nature.
    expect(caTransformeAttenduCents + caRevenduAttenduCents).toBe(caAttenduCents);

    /*
     * ET ELLE N'EST PAS TRIVIALE. Si le menu était compté en bloc dans l'une
     * des deux natures, la ventilation vaudrait l'un de ces deux chiffres —
     * qu'on refuse explicitement, pour que ce test ne puisse pas verdir sur un
     * menu mal classé.
     */
    const siMenuToutTransforme =
      QUANTITE_CREPES_SEULES * PRIX_CREPE_CENTS + QUANTITE_MENUS * PRIX_MENU_CENTS;
    const siMenuToutRevendu = QUANTITE_CREPES_SEULES * PRIX_CREPE_CENTS;
    expect(resultat.caTransformeCents).not.toBe(siMenuToutTransforme);
    expect(resultat.caTransformeCents).not.toBe(siMenuToutRevendu);

    /* ── Le menu SORT le stock de son composant revendu ───────────────────── */

    const stockApres = schemaEtatStock.parse(
      (await app.inject({ method: 'GET', url: '/api/stock' })).json(),
    );
    const siropApres = stockApres.data.find((l) => l.ingredientId === idSirop)!.quantiteDisponible;
    // 11 pots vendus seuls + 9 pots inclus dans un menu : le menu ne sort rien
    // par lui-même, ce sont SES composants qui sortent.
    expect(siropAvant - siropApres).toBe(QUANTITE_SIROPS_SEULS + QUANTITE_MENUS);
    // Aucun écart de stock signalé : la marchandise était bien là.
    expect(resultat.ecartsStock).toEqual([]);

    /* ── Le coût matière porte les DEUX natures ───────────────────────────── */

    // Coût du revendu sorti : 20 pots au prix unitaire du lot reçu.
    const coutRevenduCents = Math.round(
      (QUANTITE_SIROPS_SEULS + QUANTITE_MENUS) *
        (RECEPTION_SIROP.prixLigneCents / RECEPTION_SIROP.quantite),
    );
    expect(resultat.coutMatiereCents).toBe(coutProductionCents + coutRevenduCents);
    // Le coût PAR CRÊPE exclut volontairement la marchandise revendue : un pot
    // de sirop n'a rien à voir avec une crêpe (docs/17 fiche 12).
    expect(resultat.coutMatiereParCrepeCents).toBe(Math.round(coutProductionCents / crepesVendues));

    expect(resultat.margeBruteCents).toBe(resultat.caTotalCents! - resultat.coutMatiereCents!);
  });

  it('étape 5 — les compteurs de seuils légaux héritent de la ventilation, menu compris', async () => {
    const seuils = schemaTableauSeuils.parse(
      (await app.inject({ method: 'GET', url: '/api/seuils' })).json(),
    );

    const caTransformeAttenduCents =
      QUANTITE_CREPES_SEULES * PRIX_CREPE_CENTS + QUANTITE_MENUS * partMenuTransformeCents;
    const caRevenduAttenduCents =
      QUANTITE_SIROPS_SEULS * PRIX_SIROP_CENTS + QUANTITE_MENUS * partMenuRevenduCents;
    const caTotalCents = caTransformeAttenduCents + caRevenduAttenduCents;

    expect(seuils.meta.caTransformeCents).toBe(caTransformeAttenduCents);
    expect(seuils.meta.caRevenduCents).toBe(caRevenduAttenduCents);
    expect(seuils.meta.partRevenduBp).toBe(
      ratioEnPointsDeBase(caRevenduAttenduCents, caTotalCents),
    );

    // C'est le CA TOTAL — les deux natures confondues — qui compte pour la
    // franchise TVA. Ne compter que le transformé serait la faute exacte que
    // CLAUDE.md §6 décrit.
    const franchiseTva = seuils.data.find((c) => c.cle.includes('tva'))!;
    expect(franchiseTva.realiseCents).toBe(caTotalCents);
    expect(franchiseTva.realiseCents).toBeGreaterThan(caTransformeAttenduCents);
  });

  it('étape 6 — la traçabilité AFSCA distingue le revendu du transformé, sur la même session', async () => {
    const amont = (
      await app.inject({ method: 'GET', url: `/api/afsca/tracabilite/sessions/${idSession}` })
    ).json<{
      productions: {
        productionId: string;
        consommations: { ingredientId: string; numeroLotFournisseur: string | null }[];
      }[];
      revendus: { ingredientId: string; quantite: number; numeroLotFournisseur: string | null }[];
      garnitures: { ingredientId: string }[];
    }>();

    // Le transformé passe par une production, avec ses trois lots d'ingrédients.
    expect(amont.productions).toHaveLength(1);
    // Et c'est bien LA fournée de l'étape 3 : le registre ne reconstitue rien.
    expect(amont.productions[0]!.productionId).toBe(idProduction);
    expect(amont.productions[0]!.consommations.map((c) => c.numeroLotFournisseur).sort()).toEqual(
      [RECEPTION_FARINE.lot, RECEPTION_LAIT.lot, RECEPTION_OEUFS.lot].sort(),
    );

    /*
     * Le REVENDU ne figure dans aucune production : son lot n'est relié à la
     * session que par le mouvement `sortie_vente`. Sans ce bloc distinct, une
     * denrée à DLC vendue au public serait absente du registre dans les deux
     * sens — or l'obligation AFSCA ne distingue pas transformé et revendu.
     */
    const siropTrace = amont.revendus.find((r) => r.ingredientId === idSirop)!;
    expect(siropTrace.numeroLotFournisseur).toBe(RECEPTION_SIROP.lot);
    // Les DEUX canaux cumulés dans un seul lot tracé : vente directe ET menu.
    expect(siropTrace.quantite).toBe(QUANTITE_SIROPS_SEULS + QUANTITE_MENUS);
  });
});
