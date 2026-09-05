import { describe, expect, it } from 'vitest';
import { ErreurMetier } from './erreurs.js';
import {
  controlerFaisabilite,
  decomposerEcart,
  ecartRendementBp,
  messageFaisabilite,
  rendementReelBp,
  volumeAPreparer,
} from './production.js';
import type { RecetteCalcul } from './recettes.js';

/** R1 reduite a trois lignes : la faisabilite ne depend pas du nombre d'ingredients. */
const R1: RecetteCalcul = {
  id: 'r1',
  code: 'R1',
  rendementReferenceMl: 455,
  rendementReferenceCrepes: 6,
  perteCuissonBp: 0,
  tauxCasseBp: 0,
  lignes: [
    {
      ingredientId: 'farine',
      nomIngredient: 'Farine T55',
      unite: 'g',
      quantiteReference: 145,
      cumpCentsParUnite: 0.075,
      allergenes: ['gluten'],
    },
    {
      ingredientId: 'lait',
      nomIngredient: 'Lait entier',
      unite: 'ml',
      quantiteReference: 240,
      cumpCentsParUnite: 0.115,
      allergenes: ['lait'],
    },
    {
      ingredientId: 'sel',
      nomIngredient: 'Sel fin',
      unite: 'g',
      quantiteReference: 2,
      cumpCentsParUnite: 0.09,
      allergenes: [],
    },
  ],
};

describe('volumeAPreparer — la perte fixe ne depend pas du volume', () => {
  it('ajoute la perte fixe au volume utile', () => {
    // Fond de bassine : 150 ml perdus quelle que soit la taille de la fournee.
    expect(volumeAPreparer(5000, 150)).toBe(5150);
  });

  it('pese proportionnellement plus sur une petite fournee', () => {
    // 3 % sur 5 L, mais 30 % sur 500 ml : c'est exactement pour ca qu'un modele
    // purement proportionnel sous-estime les petites productions.
    const petite = volumeAPreparer(500, 150);
    const grande = volumeAPreparer(5000, 150);
    expect((petite - 500) / 500).toBeGreaterThan((grande - 5000) / 5000);
  });

  it('est neutre quand aucune perte fixe n est declaree', () => {
    expect(volumeAPreparer(5000, 0)).toBe(5000);
  });
});

describe('controlerFaisabilite', () => {
  it('déclare faisable quand tout le stock suffit', () => {
    const stock = new Map([
      ['farine', 10_000],
      ['lait', 10_000],
      ['sel', 1000],
    ]);
    const resultat = controlerFaisabilite(R1, 10, stock);

    expect(resultat.faisable).toBe(true);
    expect(resultat.manquants).toHaveLength(0);
    expect(resultat.ingredientLimitant).toBeNull();
  });

  it('nomme l ingredient limitant et chiffre ce qui manque', () => {
    const stock = new Map([
      ['farine', 1000], // il en faut 1450
      ['lait', 10_000],
      ['sel', 1000],
    ]);
    const resultat = controlerFaisabilite(R1, 10, stock);

    expect(resultat.faisable).toBe(false);
    expect(resultat.ingredientLimitant?.nomIngredient).toBe('Farine T55');
    expect(resultat.ingredientLimitant?.manquant).toBe(450);
  });

  it('classe le plus contraignant par RATIO, pas par manque brut', () => {
    // 2 g de sel manquants bloquent autant que 2 kg de farine : c'est le ratio
    // disponible/requis qui compte, pas la valeur absolue.
    const stock = new Map([
      ['farine', 1400], // requis 1450 -> ratio 0,966
      ['lait', 2400], // requis 2400 -> suffit
      ['sel', 2], // requis 20   -> ratio 0,1
    ]);
    const resultat = controlerFaisabilite(R1, 10, stock);

    expect(resultat.ingredientLimitant?.ingredientId).toBe('sel');
    expect(resultat.manquants.map((m) => m.ingredientId)).toEqual(['sel', 'farine']);
  });

  it('calcule le volume maximal reellement produisible', () => {
    const stock = new Map([
      ['farine', 1450], // 10 fournees
      ['lait', 24_000], // 100 fournees
      ['sel', 100], // 50 fournees
    ]);
    const resultat = controlerFaisabilite(R1, 100, stock);

    // La farine borne a 10 fournees : 10 x 455 ml = 4550 ml.
    expect(resultat.volumeMaximalMl).toBe(4550);
  });

  it('rend un volume maximal nul quand le stock est vide', () => {
    const resultat = controlerFaisabilite(R1, 10, new Map());
    expect(resultat.volumeMaximalMl).toBe(0);
    expect(resultat.faisable).toBe(false);
  });

  it('traite un ingredient absent du stock comme une quantite nulle', () => {
    const stock = new Map([['farine', 10_000]]);
    const resultat = controlerFaisabilite(R1, 1, stock);
    expect(resultat.besoins.find((b) => b.ingredientId === 'lait')?.disponible).toBe(0);
  });

  it('refuse une recette vide ou un facteur invalide', () => {
    expect(() => controlerFaisabilite({ ...R1, lignes: [] }, 1, new Map())).toThrow(ErreurMetier);
    expect(() => controlerFaisabilite(R1, 0, new Map())).toThrow(ErreurMetier);
    expect(() => controlerFaisabilite(R1, -1, new Map())).toThrow(ErreurMetier);
  });
});

describe('messageFaisabilite', () => {
  it('rend null quand la production passe', () => {
    const stock = new Map([
      ['farine', 10_000],
      ['lait', 10_000],
      ['sel', 1000],
    ]);
    expect(messageFaisabilite(controlerFaisabilite(R1, 1, stock))).toBeNull();
  });

  it('nomme l ingredient et le chiffre manquant', () => {
    const stock = new Map([
      ['farine', 1000],
      ['lait', 10_000],
      ['sel', 1000],
    ]);
    const message = messageFaisabilite(controlerFaisabilite(R1, 10, stock));
    expect(message).toContain('450 g');
    expect(message).toContain('Farine T55');
  });

  it('signale le nombre d autres ingredients en manque', () => {
    const message = messageFaisabilite(controlerFaisabilite(R1, 10, new Map()));
    expect(message).toContain('2 autre(s)');
  });
});

describe('decomposerEcart', () => {
  const theoriques = [
    {
      ingredientId: 'farine',
      nomIngredient: 'Farine T55',
      unite: 'g' as const,
      quantite: 1450,
      cumpCentsParUnite: 0.075,
    },
  ];

  it('signale une surconsommation en positif', () => {
    // Une louche trop genereuse : on a mis 1550 g au lieu de 1450.
    const [ecart] = decomposerEcart(theoriques, new Map([['farine', 1550]]));
    expect(ecart?.ecart).toBe(100);
    expect(ecart?.ecartBp).toBe(690); // +6,9 %
    expect(ecart?.coutEcartCents).toBe(8);
  });

  it('signale une sous-consommation en negatif', () => {
    const [ecart] = decomposerEcart(theoriques, new Map([['farine', 1400]]));
    expect(ecart?.ecart).toBe(-50);
    expect(ecart?.ecartBp).toBeLessThan(0);
  });

  it('suppose le theorique quand le reel n a pas ete saisi', () => {
    // Ne pas saisir n'est pas la meme chose que saisir zero : sans mesure, on
    // ne peut affirmer aucun ecart.
    const [ecart] = decomposerEcart(theoriques, new Map());
    expect(ecart?.reel).toBe(1450);
    expect(ecart?.ecart).toBe(0);
  });

  it('ne divise pas par un theorique nul', () => {
    const [ecart] = decomposerEcart(
      [{ ...theoriques[0]!, quantite: 0 }],
      new Map([['farine', 10]]),
    );
    expect(ecart?.ecartBp).toBe(0);
  });
});

describe('rendementReelBp et ecartRendementBp', () => {
  it('mesure le rendement obtenu', () => {
    expect(rendementReelBp(60, 66)).toBe(9091); // 90,91 %
  });

  it('rend 0 sur un theorique nul plutot que de diviser par zero', () => {
    expect(rendementReelBp(10, 0)).toBe(0);
  });

  it('compare le mesure a ce que la recette annonce', () => {
    // Recette annoncant 10 % de perte -> rendement net 9000 bp.
    // Realise : 60/66 = 9091 bp. L'ecart est donc legerement favorable.
    const ecart = ecartRendementBp(60, 66, { perteCuissonBp: 1000, tauxCasseBp: 0 });
    expect(ecart).toBe(91);
  });

  it('signale un rendement plus mauvais que prevu', () => {
    const ecart = ecartRendementBp(50, 66, { perteCuissonBp: 0, tauxCasseBp: 0 });
    expect(ecart).toBeLessThan(0);
  });
});
