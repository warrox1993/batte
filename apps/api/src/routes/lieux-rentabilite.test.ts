import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { maintenantUtc } from '@batte/core';
import {
  changerActiviteConditionnement,
  changerActiviteProduit,
  creerBase,
  creerLieu,
  enregistrerDepense,
  listerLieuxComplets,
  migrer,
  modifierLieu,
  schema,
  seed,
  seedDemonstration,
  seedDemonstrationActivite,
  type BaseBatte,
  type LieuCompletLigne,
} from '@batte/db';
import { routesLieuxRentabilite } from './lieux-rentabilite.js';

/** Reconstruit une saisie complète de lieu à partir d'une ligne déjà lue. */
function saisieDepuisLigne(ligne: LieuCompletLigne, surcharges: Record<string, unknown> = {}) {
  return {
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
    ...surcharges,
  };
}

/** Saisie de lieu valide, déjà normalisée comme le ferait le contrat Zod. */
function saisieLieuVierge(surcharges: Record<string, unknown> = {}) {
  return {
    nom: 'Lieu de test',
    adresse: null,
    latitude: null,
    longitude: null,
    jourSemaine: null,
    heureDebut: null,
    heureFin: null,
    tarifEmplacementCents: null,
    modeTarification: null,
    metresLineaires: null,
    distanceKm: null,
    facturationElectricite: null,
    puissanceDisponibleW: null,
    notes: null,
    ...surcharges,
  };
}

/**
 * Désactive TOUS les conditionnements actifs de la base : rend le coût
 * matière de chaque recette inconnu (`coutParCrepeCents === null`,
 * `packages/core/src/recettes.ts` — un seul ingrédient sans prix suffit à
 * rendre toute la recette inconnue) sans toucher aux produits de vente ni à
 * leur prix. Isole l'inconnue « matière » de l'inconnue « prix » : les deux
 * doivent rester indépendantes (défaut corrigé dans
 * `avertissementCoutsManquants`, `packages/core/src/affichage.ts`).
 */
function desactiverTousLesConditionnements(base: BaseBatte): void {
  const lignes = base.select({ id: schema.conditionnement.id }).from(schema.conditionnement).all();
  for (const ligne of lignes) {
    changerActiviteConditionnement(base, ligne.id, false);
  }
}

/**
 * Désactive tous les produits transformés : rend le prix moyen d'une crêpe
 * inconnu (aucun tarif affiché exploitable) sans toucher aux recettes ni à
 * leur coût matière — l'inverse de `desactiverTousLesConditionnements`
 * ci-dessus, pour prouver le sens symétrique du même défaut.
 */
function desactiverProduitsTransformes(base: BaseBatte): void {
  const produits = base.select().from(schema.produitVente).all();
  for (const produit of produits) {
    if (produit.nature === 'transforme') changerActiviteProduit(base, produit.id, false);
  }
}

describe('route /api/lieux-rentabilite — mode dégradé (aucun coût mesurable)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    creerLieu(base, saisieLieuVierge({ nom: 'Lieu sans historique', distanceKm: 15 }));

    app = Fastify({ logger: false });
    await app.register(routesLieuxRentabilite(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reste fonctionnel sans aucune recette ni vente : marge nulle, jamais 0 € trompeur', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/lieux-rentabilite' });
    expect(reponse.statusCode).toBe(200);

    const corps = reponse.json();
    expect(corps.meta.total).toBe(1);
    expect(corps.meta.coutsDisponibles).toBe(false);
    expect(corps.meta.avertissementCouts).not.toBeNull();

    const ligne = corps.data[0];
    expect(ligne.caAttenduCents).toBeNull();
    expect(ligne.margeNetteAttendueCents).toBeNull();
    expect(ligne.fiabilite).toBe('aucune_donnee');
    expect(ligne.nbSessionsRetenues).toBe(0);
  });

  it('expose le coût kilométrique retenu et sa source, toujours', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/lieux-rentabilite' });
    const corps = reponse.json();
    expect(corps.meta.coutKilometriqueCentsParKm).toBeGreaterThan(0);
    expect(typeof corps.meta.coutKilometriqueSource).toBe('string');
    expect(corps.meta.coutKilometriqueSource.length).toBeGreaterThan(0);
  });
});

describe('route /api/lieux-rentabilite — avec historique réel (graine de démonstration)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let lieuProcheId: string;
  let lieuLointainId: string;
  let lieuSansDistanceId: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    seedDemonstrationActivite(base);

    const batte = listerLieuxComplets(base).find((l) => l.nom === 'La Batte');
    if (batte === undefined) throw new Error('Lieu « La Batte » introuvable après la graine.');
    lieuProcheId = batte.id;

    // Distance, tarif et mode : colonnes ajoutées APRÈS la graine de
    // démonstration, donc absentes d'elle — on les renseigne pour ce test.
    modifierLieu(
      base,
      lieuProcheId,
      saisieDepuisLigne(batte, {
        tarifEmplacementCents: 2200,
        modeTarification: 'jour',
        distanceKm: 12,
      }),
    );

    lieuLointainId = creerLieu(
      base,
      saisieLieuVierge({
        nom: 'Marché lointain',
        tarifEmplacementCents: 2200,
        modeTarification: 'jour',
        distanceKm: 50,
      }),
    );

    lieuSansDistanceId = creerLieu(
      base,
      saisieLieuVierge({
        nom: 'Marché sans distance renseignée',
        tarifEmplacementCents: 2200,
        modeTarification: 'jour',
      }),
    );

    app = Fastify({ logger: false });
    await app.register(routesLieuxRentabilite(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('calcule une marge nette attendue non nulle pour un lieu avec distance et historique', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/lieux-rentabilite' });
    expect(reponse.statusCode).toBe(200);

    const corps = reponse.json();
    expect(corps.meta.total).toBe(3);
    expect(corps.meta.coutsDisponibles).toBe(true);

    const proche = corps.data.find((l: { lieuId: string }) => l.lieuId === lieuProcheId);
    expect(proche.distanceKm).toBe(12);
    expect(proche.nbSessionsRetenues).toBe(1);
    expect(proche.margeNetteAttendueCents).not.toBeNull();
    expect(proche.coutDeplacementCents).not.toBeNull();
  });

  it('privilégie le lieu le plus proche à coûts autrement identiques — l’exemple du porteur', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/lieux-rentabilite' });
    const corps = reponse.json();

    const proche = corps.data.find((l: { lieuId: string }) => l.lieuId === lieuProcheId);
    const lointain = corps.data.find((l: { lieuId: string }) => l.lieuId === lieuLointainId);

    expect(proche.margeNetteAttendueCents).not.toBeNull();
    expect(lointain.margeNetteAttendueCents).not.toBeNull();
    // Même tarif d'emplacement, même prix/coût matière global : seul le
    // déplacement diffère, et le lieu à 12 km doit donc l'emporter sur celui
    // à 50 km — exactement la logique que le porteur a demandée.
    expect(proche.margeNetteAttendueCents).toBeGreaterThan(lointain.margeNetteAttendueCents);
    expect(proche.coutDeplacementCents).toBeLessThan(lointain.coutDeplacementCents);
  });

  it('ne classe JAMAIS en tête un lieu dont la distance est inconnue', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/lieux-rentabilite' });
    const corps = reponse.json();

    const sansDistance = corps.data.find(
      (l: { lieuId: string }) => l.lieuId === lieuSansDistanceId,
    );
    expect(sansDistance.distanceKm).toBeNull();
    expect(sansDistance.margeNetteAttendueCents).toBeNull();

    // La ligne à marge inconnue doit apparaître APRÈS toutes les lignes à
    // marge connue, quel que soit son rang alphabétique ou sa fréquentation.
    const index = corps.data.findIndex((l: { lieuId: string }) => l.lieuId === lieuSansDistanceId);
    expect(index).toBe(corps.data.length - 1);
  });

  it('trie par marge nette attendue décroissante parmi les lignes connues', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/lieux-rentabilite' });
    const corps = reponse.json();

    const connues = corps.data.filter(
      (l: { margeNetteAttendueCents: number | null }) => l.margeNetteAttendueCents !== null,
    );
    const margesTriees = connues.map(
      (l: { margeNetteAttendueCents: number }) => l.margeNetteAttendueCents,
    );
    const margesAttendues = [...margesTriees].sort((a: number, b: number) => b - a);
    expect(margesTriees).toEqual(margesAttendues);
  });
});

describe('route /api/lieux-rentabilite — coût kilométrique mesuré vs forfait (fiche 13 §3.1)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  // `beforeEach`, pas `beforeAll` : le second test AJOUTE des dépenses et des
  // sessions à la base — une base fraîche par test évite qu'un ordre
  // d'exécution différent ne fasse dépendre un test du précédent.
  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    app = Fastify({ logger: false });
    await app.register(routesLieuxRentabilite(base), { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('reste sur le forfait sans dépense carburant ni session close', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/lieux-rentabilite' });
    const corps = reponse.json();

    expect(corps.meta.coutKilometriqueOrigine).toBe('forfait');
    expect(corps.meta.coutKilometriqueLibelle).toContain('Forfait officiel');
    expect(corps.meta.coutKilometriqueCentsParKm).toBe(47.61);
  });

  it('bascule sur le coût mesuré une fois assez de pleins et de km parcourus réunis', async () => {
    const lieuId = creerLieu(
      base,
      saisieLieuVierge({
        nom: 'Lieu mesuré',
        distanceKm: 25,
        tarifEmplacementCents: 2000,
        modeTarification: 'jour',
      }),
    );

    // Seuil par défaut : 8 pleins (`cout_kilometrique_mesure_pleins_minimum`).
    for (let i = 0; i < 8; i += 1) {
      enregistrerDepense(base, {
        dateDepense: `2026-0${(i % 6) + 1}-10`,
        libelle: `Plein ${i + 1}`,
        categorie: 'carburant',
        montantCents: 5_000,
      });
    }

    // 4 sessions closes à 25 km aller simple : 4 × 2 × 25 = 200 km parcourus.
    // 8 × 5000 = 40 000 centimes / 200 km = 200 centimes/km.
    const maintenant = maintenantUtc();
    for (let i = 0; i < 4; i += 1) {
      base
        .insert(schema.sessionMarche)
        .values({
          id: `sess-mesure-${i}`,
          numero: `SM-MESURE-${i}`,
          lieuId,
          dateSession: `2026-06-0${i + 1}`,
          statut: 'cloturee',
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
    }

    const reponse = await app.inject({ method: 'GET', url: '/api/lieux-rentabilite' });
    const corps = reponse.json();

    expect(corps.meta.coutKilometriqueOrigine).toBe('mesure');
    expect(corps.meta.coutKilometriqueCentsParKm).toBe(200);
    expect(corps.meta.coutKilometriqueLibelle).toContain('Mesuré sur vos frais réels');
    expect(corps.meta.coutKilometriqueLibelle).toContain('8 pleins');
  });
});

describe('route /api/lieux-rentabilite — deux inconnues indépendantes : prix connu, matière inconnue (fiche 13, défaut corrigé le 30/07/2026)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let lieuId: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    // Recettes ET produits de vente, mais AUCUNE session ni production
    // (`seedDemonstrationActivite` n'est PAS appelée) : sans elle, le coût
    // matière mesuré viendrait de productions déjà chiffrées en base, pas du
    // repli théorique qu'on veut précisément couper ci-dessous.
    seedDemonstration(base);
    desactiverTousLesConditionnements(base);

    lieuId = creerLieu(
      base,
      saisieLieuVierge({
        nom: 'Lieu — matière inconnue',
        tarifEmplacementCents: 2000,
        modeTarification: 'jour',
        distanceKm: 10,
      }),
    );

    app = Fastify({ logger: false });
    await app.register(routesLieuxRentabilite(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('le prix de vente connu ne doit JAMAIS faire passer un coût matière inconnu pour 0 — le défaut réel corrigé', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/lieux-rentabilite' });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json();

    expect(corps.meta.coutsDisponibles).toBe(false);
    // Le prix EST connu (produits transformés actifs, seedDemonstration) :
    // l'avertissement ne doit réclamer QUE la recette, jamais le prix de
    // vente déjà saisi — sinon le porteur ressaisit ce qu'il a déjà rempli.
    expect(corps.meta.avertissementCouts).not.toBeNull();
    expect(corps.meta.avertissementCouts).toContain('recette');
    expect(corps.meta.avertissementCouts).not.toContain('prix de vente');

    const ligne = corps.data.find((l: { lieuId: string }) => l.lieuId === lieuId);
    expect(ligne).toBeDefined();
    // Le CA attendu, lui, EST calculable : le prix est connu et la baseline à
    // froid (aucune session pour ce lieu) renvoie le prior non nul du
    // catalogue (120 crêpes par défaut) — donc un vrai nombre, pas un 0 qui
    // masquerait le défaut si crêpesPrévues valait 0 des deux côtés.
    expect(ligne.caAttenduCents).toBeGreaterThan(0);
    // Le défaut réel, corrigé une heure avant cette mission : sans lui, ce
    // champ valait 0 (matière gratuite), jamais `null`.
    expect(ligne.coutMatiereAttenduCents).toBeNull();
    expect(ligne.margeNetteAttendueCents).toBeNull();
  });
});

describe('route /api/lieux-rentabilite — deux inconnues indépendantes : matière connue, prix inconnu (l’inverse du défaut corrigé)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let lieuId: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    desactiverProduitsTransformes(base);

    lieuId = creerLieu(
      base,
      saisieLieuVierge({
        nom: 'Lieu — prix inconnu',
        tarifEmplacementCents: 2000,
        modeTarification: 'jour',
        distanceKm: 10,
      }),
    );

    app = Fastify({ logger: false });
    await app.register(routesLieuxRentabilite(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('la recette déjà saisie ne doit JAMAIS être réclamée quand seul le prix de vente manque', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/lieux-rentabilite' });
    const corps = reponse.json();

    expect(corps.meta.coutsDisponibles).toBe(false);
    expect(corps.meta.avertissementCouts).not.toBeNull();
    expect(corps.meta.avertissementCouts).toContain('prix de vente');
    expect(corps.meta.avertissementCouts).not.toContain('recette');

    const ligne = corps.data.find((l: { lieuId: string }) => l.lieuId === lieuId);
    expect(ligne).toBeDefined();
    // La matière, elle, EST connue (conditionnements actifs, repli recette) :
    // elle doit rester un vrai nombre, jamais noyée par l'inconnue du prix.
    expect(ligne.coutMatiereAttenduCents).toBeGreaterThan(0);
    expect(ligne.caAttenduCents).toBeNull();
    expect(ligne.margeNetteAttendueCents).toBeNull();
  });
});
