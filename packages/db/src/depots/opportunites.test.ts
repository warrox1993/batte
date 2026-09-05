import { BASE_POINTS, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, schema, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { creerLieu } from './referentiel-ecriture.js';
import {
  creerOpportunite,
  listerOpportunitesActives,
  rattacherLieuOpportunite,
  rejeterOpportunite,
  sessionsEntrepriseFermees,
  type EntreeOpportunite,
} from './opportunites.js';

/** Saisie de lieu valide, déjà normalisée comme le ferait le contrat Zod. */
function saisieLieu(surcharges: Record<string, unknown> = {}) {
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

function entreeOpportunite(surcharges: Partial<EntreeOpportunite> = {}): EntreeOpportunite {
  return {
    nom: 'Marché de Noël — Place test',
    type: 'festival',
    famille: 'marche_noel',
    dateDebut: '2026-12-01',
    dateFin: '2026-12-24',
    ...surcharges,
  };
}

/** Insertion directe d'un événement-FACTEUR classique (`famille = NULL`). */
function creerEvenementFactuerFixture(base: BaseBatte, surcharges: Record<string, unknown> = {}) {
  const maintenant = maintenantUtc();
  const id = surcharges['id'] ?? 'evt-facteur-test';
  base
    .insert(schema.evenement)
    .values({
      id: id as string,
      nom: 'Festival classique',
      type: 'festival',
      dateDebut: '2026-08-01',
      dateFin: '2026-08-01',
      portee: 'quartier',
      intensiteEstimee: 3,
      impactEstimeBp: 13_000,
      valideParHumain: true,
      creeLe: maintenant,
      modifieLe: maintenant,
      ...surcharges,
    })
    .run();
  return id as string;
}

describe('dépôt opportunités — lecture (fiche 14)', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('ignore les événements-facteurs classiques (famille = NULL)', () => {
    creerEvenementFactuerFixture(base);
    creerOpportunite(base, entreeOpportunite());

    const lignes = listerOpportunitesActives(base, '2026-01-01');
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.famille).toBe('marche_noel');
  });

  it('ignore une opportunité non encore validée', () => {
    const maintenant = maintenantUtc();
    base
      .insert(schema.evenement)
      .values({
        id: 'evt-non-valide',
        nom: 'Proposition IA',
        type: 'festival',
        dateDebut: '2026-12-01',
        dateFin: '2026-12-24',
        portee: 'quartier',
        intensiteEstimee: 3,
        impactEstimeBp: BASE_POINTS,
        source: 'ia',
        valideParHumain: false,
        famille: 'grand_public',
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    expect(listerOpportunitesActives(base, '2026-01-01')).toHaveLength(0);
  });

  it('ignore une opportunité écartée (rejetée)', () => {
    const opportunite = creerOpportunite(base, entreeOpportunite());
    rejeterOpportunite(base, opportunite.id);

    expect(listerOpportunitesActives(base, '2026-01-01')).toHaveLength(0);
  });

  it('ignore une opportunité déjà terminée', () => {
    creerOpportunite(base, entreeOpportunite({ dateDebut: '2025-12-01', dateFin: '2025-12-24' }));

    expect(listerOpportunitesActives(base, '2026-01-01')).toHaveLength(0);
  });

  it('joint le lieu rattaché — nom, distance routière, tarif et mode', () => {
    const lieuId = creerLieu(
      base,
      saisieLieu({
        nom: 'Place Saint-Lambert',
        distanceKm: 15,
        tarifEmplacementCents: 3000,
        modeTarification: 'jour',
      }),
    );
    creerOpportunite(base, entreeOpportunite({ lieuId }));

    const [ligne] = listerOpportunitesActives(base, '2026-01-01');
    expect(ligne?.lieuId).toBe(lieuId);
    expect(ligne?.lieuNom).toBe('Place Saint-Lambert');
    expect(ligne?.lieuDistanceRoutiereKm).toBe(15);
    expect(ligne?.tarifEmplacementCents).toBe(3000);
    expect(ligne?.modeTarification).toBe('jour');
  });

  it('rend tous les champs de lieu null quand aucun lieu n’est rattaché', () => {
    creerOpportunite(base, entreeOpportunite({ lieuId: null, distanceKm: 62 }));

    const [ligne] = listerOpportunitesActives(base, '2026-01-01');
    expect(ligne?.lieuId).toBeNull();
    expect(ligne?.lieuNom).toBeNull();
    expect(ligne?.lieuDistanceRoutiereKm).toBeNull();
    expect(ligne?.distanceVolDoiseauKm).toBe(62);
  });
});

describe('dépôt opportunités — création (fiche 14)', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('fixe impact_estime_bp au NEUTRE — jamais autre chose', () => {
    const opportunite = creerOpportunite(base, entreeOpportunite());
    const brut = base
      .select()
      .from(schema.evenement)
      .all()
      .find((e) => e.id === opportunite.id);
    expect(brut?.impactEstimeBp).toBe(BASE_POINTS);
  });

  it('valide l’opportunité d’office, comme un événement saisi à la main', () => {
    const opportunite = creerOpportunite(base, entreeOpportunite());
    expect(listerOpportunitesActives(base, '2026-01-01').map((o) => o.id)).toContain(
      opportunite.id,
    );
  });

  it('persiste famille, effectif et distance (arrondie)', () => {
    const opportunite = creerOpportunite(
      base,
      entreeOpportunite({
        famille: 'entreprise',
        effectifEstime: 180,
        distanceKm: 12.6,
        communeTexte: 'Seraing',
      }),
    );
    expect(opportunite.famille).toBe('entreprise');
    expect(opportunite.effectifEstime).toBe(180);
    expect(opportunite.distanceVolDoiseauKm).toBe(13);
    expect(opportunite.communeTexte).toBe('Seraing');
  });

  it('refuse un lieu inexistant', () => {
    expect(() => creerOpportunite(base, entreeOpportunite({ lieuId: 'lieu-inconnu' }))).toThrow();
  });
});

describe('dépôt opportunités — rattachement à un lieu (fiche 14)', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('associe un lieu déclaré après coup', () => {
    const opportunite = creerOpportunite(base, entreeOpportunite());
    const lieuId = creerLieu(
      base,
      saisieLieu({ nom: 'Marché de Noël — emplacement confirmé', distanceKm: 8 }),
    );

    rattacherLieuOpportunite(base, opportunite.id, lieuId);

    const [ligne] = listerOpportunitesActives(base, '2026-01-01');
    expect(ligne?.lieuId).toBe(lieuId);
    expect(ligne?.lieuDistanceRoutiereKm).toBe(8);
  });

  it('refuse un lieu inexistant', () => {
    const opportunite = creerOpportunite(base, entreeOpportunite());
    expect(() => rattacherLieuOpportunite(base, opportunite.id, 'lieu-inconnu')).toThrow();
  });

  it('refuse une opportunité inexistante', () => {
    const lieuId = creerLieu(base, saisieLieu());
    expect(() => rattacherLieuOpportunite(base, 'opp-inconnue', lieuId)).toThrow();
  });
});

describe('dépôt opportunités — sessions entreprise fermées (D-059)', () => {
  let base: BaseBatte;
  let lieuId: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    lieuId = creerLieu(base, saisieLieu());
  });

  /** Insertion directe d'une session, sans passer par `creerSession`/`cloturerSession`
   *  (hors sujet ici — seul le filtre de lecture est testé). */
  function creerSessionFixture(surcharges: Record<string, unknown> = {}): string {
    const maintenant = maintenantUtc();
    const id = nouvelIdentifiant();
    base
      .insert(schema.sessionMarche)
      .values({
        id,
        numero: `SM-TEST-${id}`,
        lieuId,
        dateSession: '2026-09-01',
        statut: 'cloturee',
        crepesVendues: 0,
        creeLe: maintenant,
        modifieLe: maintenant,
        ...surcharges,
      })
      .run();
    return id;
  }

  it('rend [] pour un événement inexistant', () => {
    expect(sessionsEntrepriseFermees(base, 'evt-inconnu')).toEqual([]);
  });

  it('rend [] pour une opportunité qui n’est pas de famille entreprise', () => {
    const opportunite = creerOpportunite(base, entreeOpportunite({ famille: 'grand_public' }));
    expect(sessionsEntrepriseFermees(base, opportunite.id)).toEqual([]);
  });

  it('rend [] quand l’effectif de l’entreprise est inconnu', () => {
    const opportunite = creerOpportunite(
      base,
      entreeOpportunite({ famille: 'entreprise', effectifEstime: null }),
    );
    creerSessionFixture({ evenementId: opportunite.id, crepesVendues: 40 });

    expect(sessionsEntrepriseFermees(base, opportunite.id)).toEqual([]);
  });

  // `'en_cours'` retiré de l'énumération le 01/08/2026 avec l'état lui-même :
  // cette fixture décrivait une session dans un état qu'aucun chemin ne pouvait
  // produire. Le test garde son intention — ignorer les sessions non closes —
  // sur les seuls états qui existent réellement.
  it('ignore les sessions non closes (planifiee, annulee)', () => {
    const opportunite = creerOpportunite(
      base,
      entreeOpportunite({ famille: 'entreprise', effectifEstime: 100 }),
    );
    creerSessionFixture({ evenementId: opportunite.id, statut: 'planifiee', crepesVendues: 0 });
    creerSessionFixture({ evenementId: opportunite.id, statut: 'annulee', crepesVendues: 20 });

    expect(sessionsEntrepriseFermees(base, opportunite.id)).toEqual([]);
  });

  it('ignore les sessions exclues du modèle de prévision', () => {
    const opportunite = creerOpportunite(
      base,
      entreeOpportunite({ famille: 'entreprise', effectifEstime: 100 }),
    );
    creerSessionFixture({
      evenementId: opportunite.id,
      statut: 'cloturee',
      crepesVendues: 40,
      exclureDuModele: true,
    });

    expect(sessionsEntrepriseFermees(base, opportunite.id)).toEqual([]);
  });

  it('scope STRICTEMENT à UN SEUL evenement — n’agrège jamais deux entreprises', () => {
    const entrepriseA = creerOpportunite(
      base,
      entreeOpportunite({ nom: 'Entreprise A', famille: 'entreprise', effectifEstime: 100 }),
    );
    const entrepriseB = creerOpportunite(
      base,
      entreeOpportunite({ nom: 'Entreprise B', famille: 'entreprise', effectifEstime: 40 }),
    );
    creerSessionFixture({ evenementId: entrepriseA.id, statut: 'cloturee', crepesVendues: 40 });
    creerSessionFixture({ evenementId: entrepriseB.id, statut: 'cloturee', crepesVendues: 30 });

    expect(sessionsEntrepriseFermees(base, entrepriseA.id)).toEqual([
      { effectifEstime: 100, crepesVendues: 40 },
    ]);
    expect(sessionsEntrepriseFermees(base, entrepriseB.id)).toEqual([
      { effectifEstime: 40, crepesVendues: 30 },
    ]);
  });

  it('accumule PLUSIEURS sessions rattachées à LA MÊME entreprise', () => {
    const entreprise = creerOpportunite(
      base,
      entreeOpportunite({ famille: 'entreprise', effectifEstime: 150 }),
    );
    creerSessionFixture({ evenementId: entreprise.id, statut: 'cloturee', crepesVendues: 60 });
    creerSessionFixture({ evenementId: entreprise.id, statut: 'cloturee', crepesVendues: 45 });

    const observations = sessionsEntrepriseFermees(base, entreprise.id);
    expect(observations).toHaveLength(2);
    expect(observations.every((o) => o.effectifEstime === 150)).toBe(true);
    expect(observations.map((o) => o.crepesVendues).sort()).toEqual([45, 60]);
  });
});

describe('dépôt opportunités — rejet (fiche 14)', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('marque le rejet sans jamais supprimer la ligne', () => {
    const opportunite = creerOpportunite(base, entreeOpportunite());
    rejeterOpportunite(base, opportunite.id);

    const brut = base
      .select()
      .from(schema.evenement)
      .all()
      .find((e) => e.id === opportunite.id);
    expect(brut).toBeDefined();
    expect(brut?.rejeteLe).not.toBeNull();
  });

  it('refuse de rejeter deux fois', () => {
    const opportunite = creerOpportunite(base, entreeOpportunite());
    rejeterOpportunite(base, opportunite.id);
    expect(() => rejeterOpportunite(base, opportunite.id)).toThrow();
  });

  it('refuse une opportunité inexistante', () => {
    expect(() => rejeterOpportunite(base, 'opp-inconnue')).toThrow();
  });
});
