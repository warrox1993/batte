import { describe, expect, it } from 'vitest';
import type { PrevisionArchivee } from '@batte/core';
import { titreSessionAvecModele } from './QualiteModele';

/**
 * Audit du 31/07/2026 (docs/21-CHAMPS-NON-LUS.md §5, candidat non vérifié
 * individuellement dans l'audit) : `versionModele` (`schemaPrevisionArchivee`,
 * `packages/core/src/contrats/previsions.ts:209`) était calculé, testé, servi
 * par `GET /previsions`, jamais lu par cet écran — vérifié ici par un grep
 * sans résultat sur `apps/web/src` avant ce correctif. Son commentaire de
 * schéma : « identifie la génération d'algorithme, pour comparer des pommes
 * et des pommes ».
 *
 * Ce fichier ne monte pas l'écran : ce test prouve la composition de la
 * CHAÎNE d'infobulle, pas que le navigateur l'affiche réellement au survol
 * de la cellule (un survol natif ne se prouve qu'au navigateur).
 */
const PREVISION_BASE: PrevisionArchivee = {
  id: 'prev-1',
  dateCalcul: '2026-07-20T10:00:00.000Z',
  versionModele: 'v3',
  sessionId: 'session-1',
  sessionNumero: 'S-2026-014',
  dateSession: '2026-07-27',
  p50Crepes: 120,
  crepesRecommandees: 125,
  crepesRetenues: 120,
  crepesReelles: 118,
  erreurAbsolueBp: 200,
  confianceBp: 7000,
};

describe('titreSessionAvecModele', () => {
  it('commence par le libellé de session déjà affiché dans la cellule', () => {
    const titre = titreSessionAvecModele(PREVISION_BASE);
    expect(titre.startsWith('S-2026-014 · 27/07/2026')).toBe(true);
  });

  it('nomme la version du modèle qui a produit cette prévision', () => {
    const titre = titreSessionAvecModele(PREVISION_BASE);
    expect(titre).toContain('modèle v3');
  });

  it('distingue deux générations d’algorithme différentes', () => {
    const ancien = titreSessionAvecModele({ ...PREVISION_BASE, versionModele: 'v2' });
    const recent = titreSessionAvecModele({ ...PREVISION_BASE, versionModele: 'v3' });
    expect(ancien).not.toBe(recent);
  });

  it('fonctionne aussi pour une occurrence sans session créée', () => {
    const titre = titreSessionAvecModele({
      ...PREVISION_BASE,
      sessionId: null,
      sessionNumero: null,
      dateSession: null,
    });
    expect(titre.startsWith('Sans session · 20/07/2026')).toBe(true);
    expect(titre).toContain('modèle v3');
  });
});
