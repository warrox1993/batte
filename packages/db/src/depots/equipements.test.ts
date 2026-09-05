/**
 * Tests du dépôt des équipements électriques et de leur usage par session
 * (docs/demandes/17-ENERGIE-GAZ-ELECTRICITE-SOLAIRE-EMPREINTE.md, D-055).
 *
 * Ce qui est réellement mis à l'épreuve :
 *  - **rien ne s'efface** (CLAUDE.md §3 règle 7) : retirer un équipement ne
 *    supprime aucune ligne, et corriger une durée d'utilisation s'écrit par
 *    UPDATE (upsert), jamais par un DELETE suivi d'un INSERT ;
 *  - `nbUtilisations` compte les sessions réellement enregistrées, pas les
 *    équipements en service ;
 *  - le diagnostic de puissance ne lit QUE les lieux actifs.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurIntrouvable, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { lieuMarche, sessionMarche } from '../schema.js';
// Import relatif temporaire, voir l'en-tête de `./equipements.ts`.
import type { SaisieEquipement } from '@batte/core';
import {
  changerActiviteEquipement,
  creerEquipement,
  enregistrerUtilisationEquipement,
  lieuxActifsPourDiagnosticPuissance,
  listerEquipements,
  modifierEquipement,
  utilisationsEquipementsSession,
} from './equipements.js';

function insererLieu(
  base: BaseBatte,
  surcharges: { nom: string; actif?: boolean; puissanceDisponibleW?: number | null },
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(lieuMarche)
    .values({
      id,
      nom: surcharges.nom,
      actif: surcharges.actif ?? true,
      puissanceDisponibleW: surcharges.puissanceDisponibleW ?? null,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function insererSession(base: BaseBatte, lieuId: string, numero: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(sessionMarche)
    .values({
      id,
      numero,
      lieuId,
      dateSession: '2026-12-06',
      statut: 'cloturee',
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function saisieEquipement(surcharges: Partial<SaisieEquipement> = {}): SaisieEquipement {
  return {
    nom: 'Radiateur soufflant 2000 W',
    type: 'chauffage' as const,
    puissanceW: 2000,
    enService: true,
    notes: null,
    ...surcharges,
  };
}

describe('équipements — CRUD', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('crée un équipement et le retrouve dans la liste, actif par défaut', () => {
    const id = creerEquipement(base, saisieEquipement());
    const lignes = listerEquipements(base);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      id,
      nom: 'Radiateur soufflant 2000 W',
      type: 'chauffage',
      puissanceW: 2000,
      enService: true,
      actif: true,
      nbUtilisations: 0,
    });
  });

  it('un appareil peut être déclaré SANS être en service, pour comparer avant achat', () => {
    creerEquipement(base, saisieEquipement({ enService: false }));
    expect(listerEquipements(base)[0]?.enService).toBe(false);
  });

  it('modifie un équipement existant', () => {
    const id = creerEquipement(base, saisieEquipement());
    modifierEquipement(base, id, saisieEquipement({ puissanceW: 2500, enService: false }));
    const ligne = listerEquipements(base).find((l) => l.id === id);
    expect(ligne?.puissanceW).toBe(2500);
    expect(ligne?.enService).toBe(false);
  });

  it('lève ErreurIntrouvable en modifiant un équipement inexistant', () => {
    expect(() => modifierEquipement(base, nouvelIdentifiant(), saisieEquipement())).toThrow(
      ErreurIntrouvable,
    );
  });

  it('retire un équipement sans le supprimer (rien ne s’efface)', () => {
    const id = creerEquipement(base, saisieEquipement());
    changerActiviteEquipement(base, id, false);
    const lignes = listerEquipements(base);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.actif).toBe(false);
  });

  it('lève ErreurIntrouvable en changeant l’activité d’un équipement inexistant', () => {
    expect(() => changerActiviteEquipement(base, nouvelIdentifiant(), false)).toThrow(
      ErreurIntrouvable,
    );
  });
});

describe('équipements — usage par session', () => {
  let base: BaseBatte;
  let lieuId: string;
  let sessionId: string;
  let equipementId: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    lieuId = insererLieu(base, { nom: 'La Batte' });
    sessionId = insererSession(base, lieuId, 'S-2026-49');
    equipementId = creerEquipement(base, saisieEquipement());
  });

  it('enregistre une durée d’utilisation et la retrouve jointe à l’équipement', () => {
    enregistrerUtilisationEquipement(base, { sessionId, equipementId, dureeMinutes: 180 });
    const lignes = utilisationsEquipementsSession(base, sessionId);
    expect(lignes).toEqual([
      {
        equipementId,
        nom: 'Radiateur soufflant 2000 W',
        type: 'chauffage',
        puissanceW: 2000,
        dureeMinutes: 180,
      },
    ]);
  });

  it('une seconde saisie CORRIGE la durée (upsert), elle n’ajoute pas une seconde ligne', () => {
    enregistrerUtilisationEquipement(base, { sessionId, equipementId, dureeMinutes: 180 });
    enregistrerUtilisationEquipement(base, { sessionId, equipementId, dureeMinutes: 90 });
    const lignes = utilisationsEquipementsSession(base, sessionId);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.dureeMinutes).toBe(90);
  });

  it('nbUtilisations compte les sessions où l’appareil a réellement une durée enregistrée', () => {
    expect(listerEquipements(base).find((l) => l.id === equipementId)?.nbUtilisations).toBe(0);
    enregistrerUtilisationEquipement(base, { sessionId, equipementId, dureeMinutes: 120 });
    expect(listerEquipements(base).find((l) => l.id === equipementId)?.nbUtilisations).toBe(1);
  });

  it('lève ErreurIntrouvable pour un équipement inexistant', () => {
    expect(() =>
      enregistrerUtilisationEquipement(base, {
        sessionId,
        equipementId: nouvelIdentifiant(),
        dureeMinutes: 60,
      }),
    ).toThrow(ErreurIntrouvable);
  });

  it('lève ErreurIntrouvable pour une session inexistante', () => {
    expect(() =>
      enregistrerUtilisationEquipement(base, {
        sessionId: nouvelIdentifiant(),
        equipementId,
        dureeMinutes: 60,
      }),
    ).toThrow(ErreurIntrouvable);
  });
});

describe('lieuxActifsPourDiagnosticPuissance', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('ne rend que les lieux actifs, avec leur puissance disponible (ou null)', () => {
    insererLieu(base, { nom: 'La Batte', puissanceDisponibleW: 3500 });
    insererLieu(base, { nom: 'Marché de Noël', puissanceDisponibleW: null });
    insererLieu(base, { nom: 'Lieu retiré', actif: false, puissanceDisponibleW: 5000 });

    const lignes = lieuxActifsPourDiagnosticPuissance(base);
    expect(lignes).toHaveLength(2);
    expect(lignes.map((l) => l.lieuNom).sort()).toEqual(['La Batte', 'Marché de Noël']);
    expect(lignes.find((l) => l.lieuNom === 'La Batte')?.puissanceDisponibleW).toBe(3500);
    expect(lignes.find((l) => l.lieuNom === 'Marché de Noël')?.puissanceDisponibleW).toBeNull();
  });
});
