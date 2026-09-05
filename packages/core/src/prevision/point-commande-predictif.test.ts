import { describe, expect, it } from 'vitest';
import {
  alerteCommandeAnticipee,
  combinerDeclencheurs,
  dansFenetre,
  fenetrePredictive,
} from './point-commande-predictif.js';

describe('fenetrePredictive', () => {
  it('borne la fenêtre entre le délai de livraison et délai + marge', () => {
    expect(fenetrePredictive(10, 7)).toEqual({ debutJours: 10, finJours: 17 });
  });

  it('exemple de la fiche : farine à 10 jours de délai, marge de 3 jours', () => {
    // Un événement à J+21 tombe HORS de cette fenêtre [10,13] : c'est le point
    // qui distingue « prévoir tôt » de « prévoir juste à temps ». La marge de
    // sécurité doit être choisie en conséquence par l'utilisateur (paramètre).
    const fenetre = fenetrePredictive(10, 3);
    expect(dansFenetre(21, fenetre)).toBe(false);
    expect(dansFenetre(11, fenetre)).toBe(true);
  });

  it('ramène un délai ou une marge négatifs à zéro plutôt que de remonter dans le passé', () => {
    expect(fenetrePredictive(-5, -2)).toEqual({ debutJours: 0, finJours: 0 });
    expect(fenetrePredictive(-5, 10)).toEqual({ debutJours: 0, finJours: 10 });
  });
});

describe('dansFenetre', () => {
  it('inclut les deux bornes', () => {
    const fenetre = fenetrePredictive(10, 7);
    expect(dansFenetre(10, fenetre)).toBe(true);
    expect(dansFenetre(17, fenetre)).toBe(true);
    expect(dansFenetre(9, fenetre)).toBe(false);
    expect(dansFenetre(18, fenetre)).toBe(false);
  });
});

describe('alerteCommandeAnticipee', () => {
  it('déclenche quand le besoin projeté dépasse le stock projeté', () => {
    const resultat = alerteCommandeAnticipee({
      besoinProjeteFenetre: 5000,
      stockProjeteActuel: 3000,
    });
    expect(resultat.alerte).toBe(true);
    expect(resultat.deficit).toBe(2000);
  });

  it('ne déclenche pas quand le stock projeté couvre le besoin', () => {
    const resultat = alerteCommandeAnticipee({
      besoinProjeteFenetre: 3000,
      stockProjeteActuel: 5000,
    });
    expect(resultat.alerte).toBe(false);
    expect(resultat.deficit).toBe(0);
  });

  it('ne rend jamais un déficit négatif — un excédent ne « rembourse » rien', () => {
    const resultat = alerteCommandeAnticipee({
      besoinProjeteFenetre: 100,
      stockProjeteActuel: 10_000,
    });
    expect(resultat.deficit).toBe(0);
  });
});

describe('combinerDeclencheurs', () => {
  it("rend 'aucun' quand rien ne se déclenche", () => {
    expect(combinerDeclencheurs({ alerteReactive: false, alertePredictive: false })).toBe('aucun');
  });

  it("rend 'reactif' quand seul le réactif se déclenche", () => {
    expect(combinerDeclencheurs({ alerteReactive: true, alertePredictive: false })).toBe('reactif');
  });

  it("rend 'predictif' quand seul le prédictif se déclenche — le cas central de la fiche 06", () => {
    expect(combinerDeclencheurs({ alerteReactive: false, alertePredictive: true })).toBe(
      'predictif',
    );
  });

  it("rend 'les_deux' quand les deux se déclenchent, sans qu'aucun n'annule l'autre", () => {
    expect(combinerDeclencheurs({ alerteReactive: true, alertePredictive: true })).toBe('les_deux');
  });
});
