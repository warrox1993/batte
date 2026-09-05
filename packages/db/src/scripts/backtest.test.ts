/**
 * `npm run backtest` (docs/17 fiche 8) : validation croisée leave-one-out sur
 * l'historique clôturé, en LECTURE SEULE.
 *
 * Ces tests appellent `executerBacktest` directement sur une base EN MÉMOIRE
 * (jamais le fichier réel du porteur — voir `ouvrirBaseLectureSeule`, réservée
 * à l'entrée en ligne de commande).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { lieuMarche, prevision, produitVente } from '../schema.js';
import { cloturerSession, creerSession } from '../services/sessions.js';
import { executerBacktest, METHODE_EVALUATION } from './backtest.js';

const DEBUT = new Date('2026-01-04T12:00:00Z'); // un dimanche

function datePlusSemaines(semaines: number): string {
  return new Date(DEBUT.getTime() + semaines * 7 * 86_400_000).toISOString().slice(0, 10);
}

describe('executerBacktest', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte (test backtest)',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idCrepe = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!.id;
  });

  /** Crée et clôture `n` sessions hebdomadaires, avec des ventes croissantes. */
  function clore(n: number, venduePour: (semaine: number) => number): void {
    for (let semaine = 0; semaine < n; semaine += 1) {
      const quantite = venduePour(semaine);
      const session = creerSession(base, {
        lieuId: idLieu,
        dateSession: datePlusSemaines(semaine),
      });
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
        fondsCaisseInitialCents: 6000,
        especesCompteesCents: 6000 + quantite * 300,
        caCarteCents: 0,
        // Vendues + invendues + cassées doit correspondre EXACTEMENT au total
        // produit (`resoudreCrepesProduites`) : quantite + 5 (invendues) + 1
        // (cassées).
        crepesProduites: quantite + 6,
        crepesInvendues: 5,
        crepesCassees: 1,
        heureDebutReelle: '08:00',
        heureFinReelle: '14:30',
      });
    }
  }

  it('rend un tableau vide, sans lever, quand aucun lieu n’a de session close', () => {
    const resultat = executerBacktest(base);
    expect(resultat.parLieu).toEqual([]);
    expect(resultat.methode).toBe(METHODE_EVALUATION);
  });

  it('dit explicitement sur quoi il s’évalue (le piège du backtest en échantillon)', () => {
    clore(15, () => 100);
    const resultat = executerBacktest(base);
    expect(resultat.methode.toLowerCase()).toContain('leave-one-out');
    expect(resultat.methode).toContain('jamais la session cible elle-même');
  });

  it('refuse un verdict sous le seuil minimal de points évalués', () => {
    clore(3, () => 100); // bien en dessous du minimum du catalogue (8)
    const resultat = executerBacktest(base);
    const lieu = resultat.parLieu.find((l) => l.lieuId === idLieu)!;
    expect(lieu.validation.admis).toBe(false);
    expect(lieu.validation.raisonRefus).not.toBeNull();
  });

  it('calcule les six indicateurs sans lever sur un historique suffisant', () => {
    clore(20, (semaine) => 100 + semaine * 2); // légère tendance, pour donner du grain à moudre
    const resultat = executerBacktest(base);
    const lieu = resultat.parLieu.find((l) => l.lieuId === idLieu)!;

    expect(lieu.nbSessionsCloses).toBe(20);
    expect(lieu.nbSessionsMapeGlissante).toBeLessThanOrEqual(10);
    expect(lieu.nbSessionsEcoulement).toBe(20);
    // Les deux (rupture, invendu) sont mesurables : chaque session a produit et
    // laissé un invendu connu.
    expect(lieu.tauxRuptureBp).not.toBeNull();
    expect(lieu.tauxInvenduBp).not.toBeNull();
  });

  it('est déterministe', () => {
    clore(15, (semaine) => 100 + semaine);
    const a = executerBacktest(base);
    const b = executerBacktest(base);
    expect(a).toEqual(b);
  });

  it('ne modifie JAMAIS la base (lecture seule)', () => {
    clore(15, () => 100);
    const avant = base.select().from(prevision).all();
    executerBacktest(base);
    executerBacktest(base);
    const apres = base.select().from(prevision).all();
    expect(apres).toEqual(avant);
  });
});
