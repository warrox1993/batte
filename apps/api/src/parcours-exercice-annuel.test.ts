/**
 * PARCOURS DE L'ANNÉE — un exercice complet, jusqu'au déclenchement de
 * l'alerte de seuil (CLAUDE.md §6 : « alerte à 80 % du seuil »).
 *
 * CE QUE CE PARCOURS ATTRAPE, ET QU'UN TEST DE SESSION NE PEUT PAS VOIR.
 * Une session isolée se vérifie facilement. Ce qui casse en vrai, c'est le
 * CUMUL : une session oubliée dans l'agrégat annuel, une année mal filtrée, ou
 * — le pire — une alerte adossée au seul chiffre d'affaires TRANSFORMÉ. Le
 * porteur se croirait alors à 60 % du seuil de franchise TVA alors qu'il vient
 * de le franchir, parce que « à marge égale, la revente génère environ
 * 2,6 fois plus de chiffre d'affaires » (CLAUDE.md §6) et que les seuils
 * portent sur le CA, jamais sur la marge.
 *
 * AUCUN CHIFFRE RÉGLEMENTAIRE EN DUR. Le plafond et le palier d'alerte sont
 * LUS dans la table `parametre` via l'API (CLAUDE.md §7 — « ne pas coder en
 * dur des taux, seuils ou montants réglementaires »). Le nombre de sessions
 * nécessaires pour approcher le palier est donc CALCULÉ, jamais écrit : le
 * jour où le seuil belge change, ce parcours suit sans être modifié.
 *
 * DÉSÉQUILIBRE VOLONTAIRE. Cinq profils de session alternent, aux mix très
 * différents — de 6 % à 39 % de revendu dans le chiffre d'affaires, et de
 * 58 239 c à 76 188 c de CA. Des sessions uniformes seraient structurellement
 * incapables de distinguer une ventilation juste d'une ventilation qui
 * répartirait au hasard : toutes les réponses se ressembleraient.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  jourCivilBelge,
  ratioEnPointsDeBase,
  schemaEtatStock,
  schemaResultatCloture,
  schemaSyntheseExercice,
  schemaTableauSeuils,
} from '@batte/core';
import { creerBase, migrer, seed, type BaseBatte } from '@batte/db';
import { construireServeur } from './serveur.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Le calendrier de l'exercice
   ═══════════════════════════════════════════════════════════════════════════ */

const PRIX_CREPE_CENTS = 458;
const PRIX_SIROP_CENTS = 395;

/**
 * Cinq profils de marché, volontairement dissemblables : un dimanche de
 * grand beau, un dimanche pluvieux, un dimanche de fête, un dimanche creux,
 * un dimanche ordinaire. Ils tournent en boucle sur l'année.
 */
const PROFILS = [
  { crepes: 134, sirops: 23, cassees: 4 },
  { crepes: 97, sirops: 41, cassees: 7 },
  { crepes: 156, sirops: 12, cassees: 2 },
  { crepes: 78, sirops: 57, cassees: 9 },
  { crepes: 119, sirops: 31, cassees: 5 },
] as const;

/** Garde-fou : si le palier n'est pas atteint en 60 marchés, la fixture ment. */
const SESSIONS_MAXIMUM = 60;

/** Assez de pots pour toute l'année : sans stock, la clôture signalerait un écart. */
const RECEPTION_SIROP = { quantite: 1_200, prixLigneCents: 298_777, lot: 'SIR-ANNEE-01' };

/* ═══════════════════════════════════════════════════════════════════════════
   Montage
   ═══════════════════════════════════════════════════════════════════════════ */

let base: BaseBatte;
let app: FastifyInstance;
const envInitial: Record<string, string | undefined> = {};

let idFournisseur = '';
let idSirop = '';
let idRecette = '';
let idLieu = '';
let idProduitCrepe = '';
let idProduitSirop = '';
let aujourdhui = '';
let annee = 0;

/** Plafond et palier LUS en base, jamais écrits ici. */
let plafondTvaCents = 0;
let seuilAlerteBp = 0;
let alerteCents = 0;

/** Cumuls attendus, tenus par le test lui-même au fil des clôtures. */
let cumulTransformeCents = 0;
let cumulRevenduCents = 0;
let nbSessionsCloturees = 0;
let siropsVendusTotal = 0;

function memoriserEtDefinir(cle: string, valeur: string | undefined): void {
  envInitial[cle] = process.env[cle];
  if (valeur === undefined) delete process.env[cle];
  else process.env[cle] = valeur;
}

async function poster(url: string, payload: Record<string, unknown>): Promise<string> {
  const reponse = await app.inject({ method: 'POST', url, payload });
  if (reponse.statusCode !== 201) {
    throw new Error(`${url} a répondu ${reponse.statusCode} : ${reponse.payload}`);
  }
  return reponse.json<{ id: string }>().id;
}

/** Le n-ième dimanche de l'exercice, en jour civil `AAAA-MM-JJ`. */
function dateDuMarche(index: number): string {
  const reference = new Date(Date.UTC(annee, 0, 4));
  reference.setUTCDate(reference.getUTCDate() + index * 7);
  return reference.toISOString().slice(0, 10);
}

/**
 * Tient un marché de bout en bout : création, ventes, clôture. Rend le CA de
 * la session, ventilé, et met à jour les cumuls attendus du test.
 *
 * `crepesProduites` est SAISI et non dérivé : aucune production n'est
 * rattachée ici (des crêpes faites hors application, cas que
 * `schemaClotureSession` documente explicitement). Ce parcours mesure les
 * COMPTEURS ANNUELS, pas la chaîne de production — celle-ci est prouvée bout
 * à bout par `parcours-nominal.test.ts`.
 */
async function tenirUnMarche(index: number): Promise<{
  caCents: number;
  transformeCents: number;
  revenduCents: number;
}> {
  const profil = PROFILS[index % PROFILS.length]!;
  const transformeCents = profil.crepes * PRIX_CREPE_CENTS;
  const revenduCents = profil.sirops * PRIX_SIROP_CENTS;
  const caCents = transformeCents + revenduCents;

  const idSession = await poster('/api/sessions', {
    lieuId: idLieu,
    dateSession: dateDuMarche(index),
    fondsCaisseInitialCents: 4_700,
  });

  // Une part carte différente à chaque marché : un taux fixe masquerait une
  // commission mal appliquée sur les petits montants.
  const caCarteCents = Math.floor((caCents * (37 + (index % 11))) / 100);

  const cloture = await app.inject({
    method: 'POST',
    url: `/api/sessions/${idSession}/cloturer`,
    payload: {
      ventes: [
        {
          produitVenteId: idProduitCrepe,
          quantite: profil.crepes,
          prixUnitaireCents: PRIX_CREPE_CENTS,
        },
        {
          produitVenteId: idProduitSirop,
          quantite: profil.sirops,
          prixUnitaireCents: PRIX_SIROP_CENTS,
        },
      ],
      frais: {
        emplacementCents: 1_137,
        deplacementCents: 823,
        gazCents: 449,
        diversCents: 211,
      },
      fondsCaisseInitialCents: 4_700,
      especesCompteesCents: 4_700 + (caCents - caCarteCents),
      caCarteCents,
      crepesProduites: profil.crepes + profil.cassees,
      crepesInvendues: 0,
      crepesCassees: profil.cassees,
      heureDebutReelle: '07:30',
      heureFinReelle: '14:00',
      nbTickets: Math.max(1, Math.floor((profil.crepes + profil.sirops) / 2)),
    },
  });
  if (cloture.statusCode !== 200) {
    throw new Error(`Clôture du marché ${index} refusée : ${cloture.payload}`);
  }
  const resultat = schemaResultatCloture.parse(cloture.json());

  // Contrôle de chaque maillon AU PASSAGE, et pas seulement à l'arrivée : un
  // parcours qui ne vérifie que le dernier chiffre ne dit pas où il a cassé.
  if (resultat.caTotalCents !== caCents) {
    throw new Error(`Marché ${index} : CA ${resultat.caTotalCents} attendu ${caCents}.`);
  }
  if (resultat.caTransformeCents !== transformeCents) {
    throw new Error(
      `Marché ${index} : transformé ${resultat.caTransformeCents} attendu ${transformeCents}.`,
    );
  }
  if (resultat.caRevenduCents !== revenduCents) {
    throw new Error(
      `Marché ${index} : revendu ${resultat.caRevenduCents} attendu ${revenduCents}.`,
    );
  }
  if (resultat.ecartsStock.length !== 0) {
    throw new Error(`Marché ${index} : écart de stock inattendu sur le revendu.`);
  }
  /*
   * Aucune production rattachée : le coût matière du transformé est donc
   * NUL. Ce n'est pas un silence acceptable — la marge brute afficherait
   * 100 % sur cette part sans que rien ne le signale. L'avertissement doit
   * partir avec la réponse (`avertissementCoutMatiereTransforme`).
   */
  if (resultat.avertissementCoutMatiereTransforme === null) {
    throw new Error(`Marché ${index} : aucun avertissement de coût matière transformé nul.`);
  }

  cumulTransformeCents += transformeCents;
  cumulRevenduCents += revenduCents;
  siropsVendusTotal += profil.sirops;
  nbSessionsCloturees += 1;
  return { caCents, transformeCents, revenduCents };
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
  annee = Number.parseInt(aujourdhui.slice(0, 4), 10);

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

  const idFarine = await poster('/api/ingredients', {
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
  idSirop = await poster('/api/ingredients', {
    nom: 'Sirop de Liège 450 g',
    categorie: 'garniture',
    uniteReference: 'piece',
    densiteGParMl: null,
    allergenes: [],
    allergenesVerifies: true,
    stockSecurite: 60,
    delaiLivraisonJours: 4,
    dureeConservationJours: 365,
    notes: null,
  });

  for (const [ingredientId, libelle, quantiteUniteRef, prixCents] of [
    [idFarine, 'Sac 25 kg', 25_000, 2_347],
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
        datePrix: `${annee}-01-02`,
      },
    });
    if (reponse.statusCode !== 201) throw new Error(`Conditionnement refusé : ${reponse.payload}`);
  }

  idRecette = await poster('/api/recettes', {
    code: 'P1',
    nom: 'Pâte froment — exercice',
    typePate: 'froment',
    sansGluten: false,
    rendementReferenceMl: 5_000,
    rendementReferenceCrepes: 66,
    perteCuissonBp: 300,
    tauxCasseBp: 150,
    perteFixeMl: 0,
    procede: null,
    notes: null,
    lignes: [{ ingredientId: idFarine, quantiteUniteRef: 1_595, noteTechnique: null }],
  });
  await app.inject({
    method: 'PATCH',
    url: `/api/recettes/${idRecette}/statut`,
    payload: { statut: 'active' },
  });

  idLieu = await poster('/api/lieux', {
    nom: 'La Batte — exercice',
    adresse: null,
    latitude: null,
    longitude: null,
    jourSemaine: 0,
    heureDebut: '07:30',
    heureFin: '14:00',
    tarifEmplacementCents: 1_137,
    modeTarification: 'jour',
    metresLineaires: null,
    distanceKm: 12.4,
    facturationElectricite: 'aucune',
    puissanceDisponibleW: null,
    notes: null,
  });

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

  const reception = await app.inject({
    method: 'POST',
    url: '/api/receptions',
    payload: {
      fournisseurId: idFournisseur,
      dateReception: `${annee}-01-02`,
      numeroBonLivraison: 'BL-ANNEE-0001',
      lignes: [
        {
          ingredientId: idSirop,
          quantite: RECEPTION_SIROP.quantite,
          prixLigneCents: RECEPTION_SIROP.prixLigneCents,
          numeroLotFournisseur: RECEPTION_SIROP.lot,
          dateDlc: `${annee + 1}-01-02`,
        },
      ],
    },
  });
  if (reception.statusCode !== 201) throw new Error(`Réception refusée : ${reception.payload}`);
}, 120_000);

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

describe('parcours de l’année — l’alerte de seuil se déclenche au bon montant, avec la bonne ventilation', () => {
  it('étape 1 — le plafond et le palier viennent de la table `parametre`, pas d’une constante', async () => {
    const seuils = schemaTableauSeuils.parse(
      (await app.inject({ method: 'GET', url: `/api/seuils?annee=${annee}` })).json(),
    );

    const franchiseTva = seuils.data.find((c) => c.cle.includes('tva'))!;
    plafondTvaCents = franchiseTva.plafondCents;
    seuilAlerteBp = seuils.meta.seuilAlerteBp;
    alerteCents = Math.ceil((plafondTvaCents * seuilAlerteBp) / 10_000);

    expect(plafondTvaCents).toBeGreaterThan(0);
    expect(seuilAlerteBp).toBeGreaterThan(0);
    expect(seuilAlerteBp).toBeLessThan(10_000);
    // Chaque compteur est adossé à sa source : un seuil sans source est
    // invérifiable (CLAUDE.md §7).
    expect(franchiseTva.source.trim()).not.toBe('');

    // Exercice vierge : tout est à zéro, et c'est un ZÉRO CERTAIN.
    expect(franchiseTva.realiseCents).toBe(0);
    expect(seuils.meta.sessionsTenues).toBe(0);
    expect(seuils.meta.partRevenduBp).toBe(0);
  });

  it('étape 2 — les marchés s’enchaînent, et le compteur suit le cumul au centime, marché après marché', async () => {
    let index = 0;
    while (cumulTransformeCents + cumulRevenduCents < alerteCents && index < SESSIONS_MAXIMUM) {
      const prochain = PROFILS[index % PROFILS.length]!;
      const caProchain = prochain.crepes * PRIX_CREPE_CENTS + prochain.sirops * PRIX_SIROP_CENTS;
      // On s'arrête JUSTE AVANT le palier : c'est le point où l'alerte ne doit
      // pas encore avoir sonné, et il faut y arriver exactement.
      if (cumulTransformeCents + cumulRevenduCents + caProchain >= alerteCents) break;

      await tenirUnMarche(index);
      index += 1;

      // Le compteur est relu à CHAQUE marché, pas seulement à la fin : un
      // parcours qui ne contrôle que le dernier chiffre ne dit pas où il casse.
      const seuils = schemaTableauSeuils.parse(
        (await app.inject({ method: 'GET', url: `/api/seuils?annee=${annee}` })).json(),
      );
      const franchiseTva = seuils.data.find((c) => c.cle.includes('tva'))!;
      expect(franchiseTva.realiseCents, `après le marché ${index}`).toBe(
        cumulTransformeCents + cumulRevenduCents,
      );
      expect(seuils.meta.sessionsTenues).toBe(nbSessionsCloturees);
    }

    // La fixture doit AVOIR APPROCHÉ le palier, sinon elle ne prouve rien.
    expect(nbSessionsCloturees).toBeGreaterThan(5);
    expect(nbSessionsCloturees).toBeLessThan(SESSIONS_MAXIMUM);
    expect(cumulTransformeCents + cumulRevenduCents).toBeLessThan(alerteCents);
  });

  it('étape 3 — juste sous le palier, l’alerte ne sonne PAS, et la ventilation est déjà exacte', async () => {
    const seuils = schemaTableauSeuils.parse(
      (await app.inject({ method: 'GET', url: `/api/seuils?annee=${annee}` })).json(),
    );
    const caTotalCents = cumulTransformeCents + cumulRevenduCents;

    expect(seuils.meta.caTransformeCents).toBe(cumulTransformeCents);
    expect(seuils.meta.caRevenduCents).toBe(cumulRevenduCents);
    expect(seuils.meta.partRevenduBp).toBe(ratioEnPointsDeBase(cumulRevenduCents, caTotalCents));
    // Le mix n'est ni trivialement nul ni trivialement total : sans cela, la
    // ventilation ne serait pas discriminante.
    expect(seuils.meta.partRevenduBp).toBeGreaterThan(1_000);
    expect(seuils.meta.partRevenduBp).toBeLessThan(5_000);

    const franchiseTva = seuils.data.find((c) => c.cle.includes('tva'))!;
    expect(franchiseTva.realiseCents).toBe(caTotalCents);
    expect(franchiseTva.partBp).toBe(ratioEnPointsDeBase(caTotalCents, plafondTvaCents));
    // L'ALERTE N'A PAS ENCORE À SONNER.
    expect(franchiseTva.partBp).toBeLessThan(seuilAlerteBp);
  });

  it('étape 4 — le marché suivant franchit le palier : l’alerte sonne, au montant exact', async () => {
    const avantCents = cumulTransformeCents + cumulRevenduCents;
    const marche = await tenirUnMarche(nbSessionsCloturees);
    const apresCents = cumulTransformeCents + cumulRevenduCents;

    expect(apresCents).toBe(avantCents + marche.caCents);
    // Le palier est bien franchi PAR CE MARCHÉ, pas avant.
    expect(avantCents).toBeLessThan(alerteCents);
    expect(apresCents).toBeGreaterThanOrEqual(alerteCents);

    const seuils = schemaTableauSeuils.parse(
      (await app.inject({ method: 'GET', url: `/api/seuils?annee=${annee}` })).json(),
    );
    const franchiseTva = seuils.data.find((c) => c.cle.includes('tva'))!;

    expect(franchiseTva.realiseCents).toBe(apresCents);
    expect(franchiseTva.partBp).toBe(ratioEnPointsDeBase(apresCents, plafondTvaCents));
    // L'ALERTE SONNE — et elle sonne au bon montant, celui que le paramètre
    // impose, jamais un seuil recopié dans un écran.
    expect(franchiseTva.partBp).toBeGreaterThanOrEqual(seuilAlerteBp);
    // La franchise elle-même n'est PAS encore perdue : alerter n'est pas
    // dépasser. Confondre les deux affolerait pour rien.
    expect(franchiseTva.realiseCents).toBeLessThan(franchiseTva.plafondCents);
  });

  it('étape 5 — LE POINT DE CLAUDE.md §6 : c’est le REVENDU qui fait franchir le palier', async () => {
    const seuils = schemaTableauSeuils.parse(
      (await app.inject({ method: 'GET', url: `/api/seuils?annee=${annee}` })).json(),
    );
    const franchiseTva = seuils.data.find((c) => c.cle.includes('tva'))!;

    /*
     * LE DÉFAUT QUE CE TEST EXISTE POUR ATTRAPER. Un compteur adossé au seul
     * chiffre d'affaires TRANSFORMÉ serait encore VERT à cet instant : c'est
     * exactement le scénario où le porteur « se retrouve hors franchise TVA
     * sans l'avoir vu venir » (CLAUDE.md §6).
     */
    expect(cumulTransformeCents).toBeLessThan(alerteCents);
    expect(cumulTransformeCents + cumulRevenduCents).toBeGreaterThanOrEqual(alerteCents);
    expect(franchiseTva.realiseCents).toBe(cumulTransformeCents + cumulRevenduCents);
    expect(franchiseTva.realiseCents).toBeGreaterThan(cumulTransformeCents);

    // Les autres compteurs légaux lisent le MÊME chiffre d'affaires : aucun ne
    // doit avoir sa propre définition du CA.
    for (const compteur of seuils.data) {
      expect(compteur.plafondCents).toBeGreaterThan(0);
      expect(compteur.source.trim()).not.toBe('');
    }
    const airbag = seuils.data.find((c) => c.cle.includes('airbag'));
    if (airbag !== undefined) {
      expect(airbag.realiseCents).toBe(franchiseTva.realiseCents);
    }
  });

  it('étape 6 — la comptabilité générale reprend le même chiffre d’affaires, sans ressaisie', async () => {
    const synthese = schemaSyntheseExercice.parse(
      (await app.inject({ method: 'GET', url: `/api/synthese-exercice?annee=${annee}` })).json(),
    );

    // Le CA de l'exercice vient des mêmes sessions que les compteurs de
    // seuils : deux modules, un seul chiffre.
    expect(synthese.annee).toBe(annee);
    expect(synthese.recettesCents).toBe(cumulTransformeCents + cumulRevenduCents);
    // Le bénéfice brut se DÉDUIT, il ne se saisit pas.
    expect(synthese.beneficeBrutCents).toBe(
      synthese.recettesCents - synthese.depensesDeductiblesCents - synthese.amortissementsCents,
    );
    expect(synthese.netEstimeCents).toBe(
      synthese.beneficeBrutCents - synthese.cotisationsSocialesCents - synthese.impotEstimeCents,
    );
  });

  it('étape 7 — le stock du revendu a baissé d’une unité par pot vendu, sur toute l’année', async () => {
    const stock = schemaEtatStock.parse(
      (await app.inject({ method: 'GET', url: '/api/stock' })).json(),
    );
    const ligneSirop = stock.data.find((l) => l.ingredientId === idSirop)!;

    // Le lien vente -> stock tient sur une année entière, session après
    // session : c'est la propriété qu'un test de session unique ne peut pas
    // établir.
    expect(ligneSirop.quantiteDisponible).toBe(RECEPTION_SIROP.quantite - siropsVendusTotal);
    expect(siropsVendusTotal).toBeGreaterThan(0);

    const diagnostic = (await app.inject({ method: 'GET', url: '/api/stock/integrite' })).json<{
      coherent: boolean;
    }>();
    expect(diagnostic.coherent).toBe(true);
  });

  it('étape 8 — une année VOISINE reste à zéro : le filtre d’exercice ne fuit pas', async () => {
    const anneePrecedente = schemaTableauSeuils.parse(
      (await app.inject({ method: 'GET', url: `/api/seuils?annee=${annee - 1}` })).json(),
    );

    // Sans ce contrôle, un agrégat annuel qui oublierait de filtrer l'année
    // afficherait le même total partout — et resterait vert sur tous les
    // tests ci-dessus.
    expect(anneePrecedente.meta.annee).toBe(annee - 1);
    expect(anneePrecedente.meta.sessionsTenues).toBe(0);
    expect(anneePrecedente.data.find((c) => c.cle.includes('tva'))!.realiseCents).toBe(0);
  });
});
