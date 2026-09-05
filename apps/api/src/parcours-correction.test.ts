/**
 * PARCOURS DE CORRECTION — « rien ne s'efface » (CLAUDE.md §3 règle 7).
 *
 * Le parcours nominal (`parcours-nominal.test.ts`) prouve que la chaîne monte.
 * Celui-ci prouve qu'elle sait REDESCENDRE : une réception saisie par erreur,
 * une fournée lancée pour rien, et le stock doit revenir EXACTEMENT à son
 * point de départ — sans qu'aucune ligne n'ait été effacée.
 *
 * DEUX POINTS QU'AUCUN TEST UNITAIRE NE PEUT ATTRAPER :
 *
 *  1. **L'ORDRE des deux annulations.** Annuler une réception APRÈS avoir
 *     annulé une production qui l'avait consommée a été un défaut RÉEL de ce
 *     dépôt (D-087) : la contrepassation de la sortie de production écrit
 *     elle-même un mouvement `entree`, que `annulerReception` prenait pour
 *     l'entrée d'origine — l'annulation échouait DÉFINITIVEMENT sur un message
 *     absurde. Ce parcours joue précisément cet ordre-là. Le jouer dans
 *     l'autre sens ne prouverait rien.
 *
 *  2. **Le retour au point de départ AU GRAMME.** Un test qui vérifie
 *     « le stock a diminué » ne voit pas une contrepassation qui rend 145 g au
 *     lieu de 1 136 g. On compare donc à la quantité exacte du bon de
 *     livraison, ingrédient par ingrédient, avec des quantités volontairement
 *     dissemblables (7 333 g, 4 111 ml, 53 pièces).
 *
 * Base neuve en mémoire, `seed()` seul, aucun appel réseau : mêmes règles de
 * fabrication que `parcours-nominal.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  jourCivilBelge,
  schemaAnnulationProductionCreee,
  schemaAnnulationReceptionCreee,
  schemaEtatStock,
  schemaListeLots,
  schemaListeMouvementsLot,
  schemaProductionDetail,
  schemaReceptionCreee,
} from '@batte/core';
import { creerBase, migrer, seed, type BaseBatte } from '@batte/db';
import { construireServeur } from './serveur.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Le scenario, en chiffres non ronds et volontairement dissemblables
   ═══════════════════════════════════════════════════════════════════════════ */

const RECEPTION_FARINE = { quantite: 7_333, prixLigneCents: 689, lot: 'FAR-CORR-A' };
const RECEPTION_LAIT = { quantite: 4_111, prixLigneCents: 501, lot: 'LAI-CORR-A' };
const RECEPTION_OEUFS = { quantite: 53, prixLigneCents: 1_093, lot: 'OEU-CORR-A' };

const CIBLE_CREPES = 47;

/** Motif imposé par le catalogue : une correction sans motif n'existe pas. */
const MOTIF_CORRECTION = 'ERREUR_SAISIE';

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
let idRecette = '';
let idLieu = '';
let idSession = '';
let idProduction = '';
let idReception = '';
let idLotFarine = '';
let aujourdhui = '';

/** Quantité consommée par la production, par ingrédient — relevée à l'étape 2. */
const consommeParIngredient = new Map<string, number>();

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

/** Quantité disponible d'un ingrédient, telle que `GET /api/stock` la rend. */
async function disponible(ingredientId: string): Promise<number> {
  const stock = schemaEtatStock.parse(
    (await app.inject({ method: 'GET', url: '/api/stock' })).json(),
  );
  return stock.data.find((l) => l.ingredientId === ingredientId)?.quantiteDisponible ?? 0;
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

  /* ── Référentiel minimal, saisi par les vraies routes d'écriture ──────── */

  idFournisseur = (
    await app.inject({
      method: 'POST',
      url: '/api/fournisseurs',
      payload: {
        nom: 'Moulin de Hollogne',
        type: 'moulin',
        email: null,
        telephone: null,
        adresse: null,
        delaiLivraisonJours: 3,
        francoDePortCents: null,
        commandeMinimumCents: null,
        notes: null,
      },
    })
  ).json<{ id: string }>().id;

  const creerIngredient = async (charge: Record<string, unknown>): Promise<string> => {
    const reponse = await app.inject({ method: 'POST', url: '/api/ingredients', payload: charge });
    if (reponse.statusCode !== 201) throw new Error(`Ingrédient refusé : ${reponse.payload}`);
    return reponse.json<{ id: string }>().id;
  };

  idFarine = await creerIngredient({
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
  idLait = await creerIngredient({
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
  idOeufs = await creerIngredient({
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

  for (const [ingredientId, libelle, quantiteUniteRef, prixCents] of [
    [idFarine, 'Sac 25 kg', 25_000, 2_347],
    [idLait, 'Bidon 6 L', 6_000, 731],
    [idOeufs, 'Plateau de 30', 30, 619],
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

  idRecette = (
    await app.inject({
      method: 'POST',
      url: '/api/recettes',
      payload: {
        code: 'P1',
        nom: 'Pâte froment — correction',
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
      },
    })
  ).json<{ id: string }>().id;

  await app.inject({
    method: 'PATCH',
    url: `/api/recettes/${idRecette}/statut`,
    payload: { statut: 'active' },
  });

  idLieu = (
    await app.inject({
      method: 'POST',
      url: '/api/lieux',
      payload: {
        nom: 'La Batte — correction',
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
      },
    })
  ).json<{ id: string }>().id;

  idSession = (
    await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { lieuId: idLieu, dateSession: aujourdhui, fondsCaisseInitialCents: 4_700 },
    })
  ).json<{ id: string }>().id;
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

describe('parcours de correction — annuler sans rien effacer, et revenir au gramme près', () => {
  it('étape 1 — le stock part de zéro, puis monte des quantités exactes du bon de livraison', async () => {
    expect(await disponible(idFarine)).toBe(0);

    const reception = await app.inject({
      method: 'POST',
      url: '/api/receptions',
      payload: {
        fournisseurId: idFournisseur,
        dateReception: aujourdhui,
        numeroBonLivraison: 'BL-CORR-8821',
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
        ],
      },
    });
    expect(reception.statusCode, reception.payload).toBe(201);
    idReception = schemaReceptionCreee.parse(reception.json()).receptionId;

    expect(await disponible(idFarine)).toBe(RECEPTION_FARINE.quantite);
    expect(await disponible(idLait)).toBe(RECEPTION_LAIT.quantite);
    expect(await disponible(idOeufs)).toBe(RECEPTION_OEUFS.quantite);

    idLotFarine = schemaListeLots.parse(
      (await app.inject({ method: 'GET', url: `/api/stock/${idFarine}/lots` })).json(),
    ).data[0]!.id;
  });

  it('étape 2 — la production consomme, et le stock baisse exactement de ce qu’elle a pris', async () => {
    const production = await app.inject({
      method: 'POST',
      url: '/api/productions',
      payload: {
        recetteId: idRecette,
        cible: { cible: 'crepes', valeur: CIBLE_CREPES },
        dateProduction: aujourdhui,
        sessionId: idSession,
        notes: 'Fournée à annuler.',
      },
    });
    expect(production.statusCode, production.payload).toBe(201);
    const detail = schemaProductionDetail.parse(production.json());
    idProduction = detail.id;

    for (const conso of detail.consommations) {
      consommeParIngredient.set(conso.ingredientId, conso.quantiteTheorique);
    }
    expect(consommeParIngredient.size).toBe(3);

    expect(await disponible(idFarine)).toBe(
      RECEPTION_FARINE.quantite - consommeParIngredient.get(idFarine)!,
    );
    expect(await disponible(idLait)).toBe(
      RECEPTION_LAIT.quantite - consommeParIngredient.get(idLait)!,
    );
    expect(await disponible(idOeufs)).toBe(
      RECEPTION_OEUFS.quantite - consommeParIngredient.get(idOeufs)!,
    );
  });

  it('étape 3 — annuler la production ramène le stock EXACTEMENT au bon de livraison', async () => {
    const annulation = await app.inject({
      method: 'POST',
      url: `/api/productions/${idProduction}/annuler`,
      payload: { motifCode: MOTIF_CORRECTION },
    });
    expect(annulation.statusCode, annulation.payload).toBe(201);
    const resultat = schemaAnnulationProductionCreee.parse(annulation.json());

    // Trois lots consommés, trois contrepassations : la confirmation dit CE QUI
    // a bougé, jamais seulement « c'est fait ».
    expect(resultat.nbMouvementsContrepasses).toBe(3);
    expect(resultat.productionId).toBe(idProduction);

    // Retour AU GRAMME, pas « à peu près ».
    expect(await disponible(idFarine)).toBe(RECEPTION_FARINE.quantite);
    expect(await disponible(idLait)).toBe(RECEPTION_LAIT.quantite);
    expect(await disponible(idOeufs)).toBe(RECEPTION_OEUFS.quantite);
  });

  it('étape 4 — la production annulée reste LISIBLE, avec son historique : rien n’a été effacé', async () => {
    const detail = schemaProductionDetail.parse(
      (await app.inject({ method: 'GET', url: `/api/productions/${idProduction}` })).json(),
    );

    expect(detail.statut).toBe('annulee');
    // Ses consommations restent au dossier : c'est ce que l'AFSCA vient
    // chercher, et ce que « rien ne s'efface » promet à l'utilisateur.
    expect(detail.consommations).toHaveLength(3);

    const mouvements = schemaListeMouvementsLot.parse(
      (await app.inject({ method: 'GET', url: `/api/lots/${idLotFarine}/mouvements` })).json(),
    );

    // Trois lignes : l'entrée de réception, la sortie de production (désormais
    // barrée), et la contrepassation qui l'annule.
    expect(mouvements.meta.total).toBe(3);
    expect(mouvements.meta.nbAnnules).toBe(1);

    const sortie = mouvements.data.find((m) => m.type === 'sortie_production')!;
    expect(sortie.isAnnule).toBe(true);
    expect(sortie.annuleParId).not.toBeNull();
    expect(sortie.quantite).toBe(consommeParIngredient.get(idFarine));

    // La contrepassation EXISTE et se reconnaît : l'écriture annulée et
    // l'écriture d'annulation restent toutes les deux visibles (D-083).
    const contrepassation = mouvements.data.find((m) => m.estContrepassation)!;
    expect(contrepassation.id).toBe(sortie.annuleParId);
    expect(contrepassation.type).toBe('entree');
    expect(contrepassation.quantite).toBe(consommeParIngredient.get(idFarine));
    expect(contrepassation.motifCode).toBe(MOTIF_CORRECTION);
  });

  it('étape 5 — D-087 : annuler la réception APRÈS l’annulation de production PASSE, et vide le stock', async () => {
    /*
     * LE CAS QUI A CASSÉ EN VRAI. La contrepassation de l'étape 3 a écrit un
     * mouvement de type `entree` sur ce même lot. Un `annulerReception` qui
     * chercherait « les entrées non annulées » en trouverait donc DEUX, et
     * échouerait sur la seconde après avoir déjà rendu le lot à zéro — une
     * annulation légitime, définitivement impossible.
     */
    const annulation = await app.inject({
      method: 'POST',
      url: `/api/receptions/${idReception}/annuler`,
      payload: { motifCode: MOTIF_CORRECTION },
    });
    expect(annulation.statusCode, annulation.payload).toBe(201);
    const resultat = schemaAnnulationReceptionCreee.parse(annulation.json());

    expect(resultat.receptionId).toBe(idReception);
    // Une entrée d'origine par lot, et seulement celles-là.
    expect(resultat.nbMouvementsContrepasses).toBe(3);
    // Aucune commande n'était liée : `null` le dit, ce n'est pas un oubli.
    expect(resultat.commandeId).toBeNull();

    /* ── LE POINT DE DÉPART EST RETROUVÉ : zéro partout ─────────────────── */

    expect(await disponible(idFarine)).toBe(0);
    expect(await disponible(idLait)).toBe(0);
    expect(await disponible(idOeufs)).toBe(0);
  });

  it('étape 6 — le lot reste VISIBLE malgré la réception annulée, et porte les deux annulations', async () => {
    /*
     * D-083 : un lot rendu introuvable est effacé du point de vue de qui le
     * cherche, même si sa ligne survit en base. Une réception contrepassée
     * ramène la quantité restante à zéro sans toucher `lot.statut` — le lot
     * doit donc rester listé, marqué par `receptionStatut`.
     */
    const lots = schemaListeLots.parse(
      (await app.inject({ method: 'GET', url: `/api/stock/${idFarine}/lots` })).json(),
    );
    expect(lots.data).toHaveLength(1);
    expect(lots.data[0]!.id).toBe(idLotFarine);
    expect(lots.data[0]!.quantiteRestante).toBe(0);
    expect(lots.data[0]!.receptionStatut).toBe('annulee');
    // La quantité INITIALE, elle, ne bouge jamais : c'est ce qui figurait sur
    // le bon de livraison, et une correction ne réécrit pas le passé.
    expect(lots.data[0]!.quantiteInitiale).toBe(RECEPTION_FARINE.quantite);

    const mouvements = schemaListeMouvementsLot.parse(
      (await app.inject({ method: 'GET', url: `/api/lots/${idLotFarine}/mouvements` })).json(),
    );

    // Quatre lignes, DEUX annulées : la sortie de production et l'entrée de
    // réception. Les deux écritures d'annulation restent, elles, actives.
    expect(mouvements.meta.total).toBe(4);
    expect(mouvements.meta.nbAnnules).toBe(2);

    const entreeOrigine = mouvements.data.find(
      (m) => m.type === 'entree' && !m.estContrepassation,
    )!;
    expect(entreeOrigine.quantite).toBe(RECEPTION_FARINE.quantite);
    expect(entreeOrigine.isAnnule).toBe(true);

    // La somme SIGNÉE des mouvements vaut zéro : c'est la définition même du
    // « retour au point de départ » quand le stock est la somme des mouvements
    // (CLAUDE.md §3 règle 5), et ce que la simple lecture de `quantiteRestante`
    // ne prouve pas.
    const signe = (type: string) => (type === 'entree' ? 1 : -1);
    expect(mouvements.data.reduce((somme, m) => somme + signe(m.type) * m.quantite, 0)).toBe(0);
  });

  it('étape 7 — le grand livre reste cohérent, et une seconde annulation est refusée', async () => {
    const diagnostic = (await app.inject({ method: 'GET', url: '/api/stock/integrite' })).json<{
      coherent: boolean;
      nbLotsVerifies: number;
    }>();
    expect(diagnostic.coherent).toBe(true);
    expect(diagnostic.nbLotsVerifies).toBe(3);

    // « Une écriture ne se contrepasse qu'une seule fois » (D-021) : sans ce
    // refus, deux annulations successives CRÉERAIENT de la matière.
    const rejeu = await app.inject({
      method: 'POST',
      url: `/api/receptions/${idReception}/annuler`,
      payload: { motifCode: MOTIF_CORRECTION },
    });
    expect(rejeu.statusCode).toBe(422);
    expect(rejeu.json<{ erreur: { code: string } }>().erreur.code).toBe('reception_deja_annulee');

    const rejeuProduction = await app.inject({
      method: 'POST',
      url: `/api/productions/${idProduction}/annuler`,
      payload: { motifCode: MOTIF_CORRECTION },
    });
    expect(rejeuProduction.statusCode).toBe(422);
    expect(rejeuProduction.json<{ erreur: { code: string } }>().erreur.code).toBe(
      'production_deja_annulee',
    );
  });
});
