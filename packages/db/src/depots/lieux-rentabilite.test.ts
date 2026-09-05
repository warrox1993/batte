import { maintenantUtc } from '@batte/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, schema, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { enregistrerDepense } from './comptabilite.js';
import { changerActiviteLieu, creerLieu } from './referentiel-ecriture.js';
import {
  coutGazMoyenParCrepe,
  lieuxActifsPourRentabilite,
  mesureCoutVehicule,
} from './lieux-rentabilite.js';

/** Saisie de lieu valide, déjà normalisée comme le ferait le contrat Zod. */
function saisieLieu(surcharges: Record<string, unknown> = {}) {
  return {
    nom: 'Marché de test',
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

function creerSessionFixture(
  base: BaseBatte,
  lieuId: string,
  fixture: {
    id: string;
    dateSession: string;
    statut: 'planifiee' | 'cloturee' | 'annulee';
    fraisGazCents?: number;
    crepesProduites?: number;
    exclureDuModele?: boolean;
  },
): void {
  const maintenant = maintenantUtc();
  base
    .insert(schema.sessionMarche)
    .values({
      id: fixture.id,
      numero: `SM-TEST-${fixture.id}`,
      lieuId,
      dateSession: fixture.dateSession,
      statut: fixture.statut,
      fraisGazCents: fixture.fraisGazCents ?? 0,
      crepesProduites: fixture.crepesProduites ?? 0,
      exclureDuModele: fixture.exclureDuModele ?? false,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
}

describe('dépôt lieux-rentabilité — lieux actifs (fiche 13)', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('ne renvoie que les lieux actifs, avec distance, tarif et mode', () => {
    const idActif = creerLieu(
      base,
      saisieLieu({
        nom: 'La Batte',
        distanceKm: 12,
        tarifEmplacementCents: 2200,
        modeTarification: 'jour',
      }),
    );
    const idInactif = creerLieu(base, saisieLieu({ nom: 'Marché retiré' }));
    changerActiviteLieu(base, idInactif, false);

    const lignes = lieuxActifsPourRentabilite(base);
    expect(lignes.some((l) => l.lieuId === idInactif)).toBe(false);

    const batte = lignes.find((l) => l.lieuId === idActif);
    expect(batte).toBeDefined();
    expect(batte?.distanceKm).toBe(12);
    expect(batte?.tarifEmplacementCents).toBe(2200);
    expect(batte?.modeTarification).toBe('jour');
  });

  it('renvoie null pour la distance d’un lieu où elle n’a jamais été renseignée', () => {
    const id = creerLieu(base, saisieLieu({ nom: 'Marché sans distance' }));
    const ligne = lieuxActifsPourRentabilite(base).find((l) => l.lieuId === id);
    expect(ligne?.distanceKm).toBeNull();
  });

  it('une distance décimale (D-074, calculée par OpenRouteService) survit intacte au round-trip base', () => {
    // `lieu_marche.distance_km` reste déclarée `integer` tant que la migration
    // de colonne (hors zone de cet agent, voir le rapport de livraison) n'a
    // pas eu lieu — mais l'affinité NUMERIC de SQLite conserve déjà une valeur
    // décimale insérée dans une colonne `INTEGER` plutôt que de la tronquer
    // (D-074, complément du 30/07/2026) : ce test le vérifie EN VRAI, sur la
    // base SQLite réelle, plutôt que de le supposer.
    const id = creerLieu(base, saisieLieu({ nom: 'Marché décimal', distanceKm: 12.4 }));
    const ligne = lieuxActifsPourRentabilite(base).find((l) => l.lieuId === id);
    expect(ligne?.distanceKm).toBe(12.4);
  });
});

describe('dépôt lieux-rentabilité — coût gaz moyen par crêpe (fiche 13)', () => {
  let base: BaseBatte;
  let lieuId: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    lieuId = creerLieu(base, saisieLieu({ nom: 'La Batte' }));
  });

  it('n’est pas mesuré tant qu’aucune session close n’a produit de crêpe', () => {
    const resultat = coutGazMoyenParCrepe(base);
    expect(resultat.mesure).toBe(false);
    expect(resultat.cents).toBe(0);
  });

  it('mesure une moyenne pondérée sur toutes les sessions closes', () => {
    creerSessionFixture(base, lieuId, {
      id: 'sess-a',
      dateSession: '2026-06-01',
      statut: 'cloturee',
      fraisGazCents: 2000,
      crepesProduites: 100,
    });
    creerSessionFixture(base, lieuId, {
      id: 'sess-b',
      dateSession: '2026-06-08',
      statut: 'cloturee',
      fraisGazCents: 1000,
      crepesProduites: 100,
    });

    // (2000 + 1000) / (100 + 100) = 15 centimes / crêpe.
    const resultat = coutGazMoyenParCrepe(base);
    expect(resultat.mesure).toBe(true);
    expect(resultat.cents).toBe(15);
  });

  it('écarte les sessions planifiées et exclues du modèle', () => {
    creerSessionFixture(base, lieuId, {
      id: 'sess-planifiee',
      dateSession: '2026-06-01',
      statut: 'planifiee',
      fraisGazCents: 5000,
      crepesProduites: 50,
    });
    creerSessionFixture(base, lieuId, {
      id: 'sess-exclue',
      dateSession: '2026-06-08',
      statut: 'cloturee',
      fraisGazCents: 9000,
      crepesProduites: 10,
      exclureDuModele: true,
    });
    creerSessionFixture(base, lieuId, {
      id: 'sess-valide',
      dateSession: '2026-06-15',
      statut: 'cloturee',
      fraisGazCents: 500,
      crepesProduites: 100,
    });

    const resultat = coutGazMoyenParCrepe(base);
    expect(resultat.mesure).toBe(true);
    expect(resultat.cents).toBe(5);
  });
});

describe('dépôt lieux-rentabilité — mesure du coût kilométrique (fiche 13 §3.1, voie B)', () => {
  let base: BaseBatte;
  let lieuId: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    lieuId = creerLieu(base, saisieLieu({ nom: 'La Batte', distanceKm: 20 }));
  });

  it('renvoie zéro partout sans aucune dépense carburant ni session close', () => {
    const resultat = mesureCoutVehicule(base);
    expect(resultat.totalDepensesCarburantCents).toBe(0);
    expect(resultat.nbPleins).toBe(0);
    expect(resultat.totalKmParcourus).toBe(0);
  });

  it('cumule le carburant et les km ALLER-RETOUR des sessions closes à distance connue', () => {
    enregistrerDepense(base, {
      dateDepense: '2026-06-01',
      libelle: 'Plein n°1',
      categorie: 'carburant',
      montantCents: 4_000,
    });
    enregistrerDepense(base, {
      dateDepense: '2026-06-08',
      libelle: 'Plein n°2',
      categorie: 'carburant',
      montantCents: 3_500,
    });
    creerSessionFixture(base, lieuId, {
      id: 'sess-a',
      dateSession: '2026-06-01',
      statut: 'cloturee',
    });
    creerSessionFixture(base, lieuId, {
      id: 'sess-b',
      dateSession: '2026-06-08',
      statut: 'cloturee',
    });

    const resultat = mesureCoutVehicule(base);
    expect(resultat.totalDepensesCarburantCents).toBe(7_500);
    expect(resultat.nbPleins).toBe(2);
    // 20 km aller simple × 2 (aller-retour) × 2 sessions = 80 km.
    expect(resultat.totalKmParcourus).toBe(80);
  });

  it('écarte les sessions planifiées, en cours ou annulées — aucun trajet n’a eu lieu', () => {
    creerSessionFixture(base, lieuId, {
      id: 'sess-planifiee',
      dateSession: '2026-06-01',
      statut: 'planifiee',
    });
    creerSessionFixture(base, lieuId, {
      id: 'sess-annulee',
      dateSession: '2026-06-15',
      statut: 'annulee',
    });

    const resultat = mesureCoutVehicule(base);
    expect(resultat.totalKmParcourus).toBe(0);
  });

  it('cumule des kilomètres DÉCIMAUX (D-074) sans les tronquer', () => {
    const lieuDecimal = creerLieu(base, saisieLieu({ nom: 'Marché décimal', distanceKm: 12.4 }));
    creerSessionFixture(base, lieuDecimal, {
      id: 'sess-decimale',
      dateSession: '2026-06-01',
      statut: 'cloturee',
    });

    const resultat = mesureCoutVehicule(base);
    // 12,4 km aller simple × 2 (aller-retour) = 24,8 km — jamais arrondi à 24
    // ou 25, qui fausserait le coût kilométrique mesuré (dépenses / km).
    expect(resultat.totalKmParcourus).toBe(24.8);
  });

  it('une session close sur un lieu SANS distance confirmée ne contribue aucun km', () => {
    const lieuSansDistance = creerLieu(base, saisieLieu({ nom: 'Marché sans distance' }));
    creerSessionFixture(base, lieuSansDistance, {
      id: 'sess-sans-distance',
      dateSession: '2026-06-01',
      statut: 'cloturee',
    });

    const resultat = mesureCoutVehicule(base);
    expect(resultat.totalKmParcourus).toBe(0);
  });
});
