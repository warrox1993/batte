/**
 * Refus de `mettreAEchelle` sur la cible « ingrédient », jamais exercé.
 *
 * `recettes.test.ts` couvre déjà `ingredient_hors_recette` (l'ingrédient
 * demandé n'entre pas dans la recette). Il ne couvre PAS le second refus de
 * la même branche : une ligne présente dans la recette mais dont la quantité
 * de référence vaut zéro. Sans ce refus, `quantiteDisponible / 0` rendrait
 * `Infinity`, et le facteur d'échelle traverserait ensuite tout le calcul de
 * coût matière — un litre de pâte à coût infini.
 *
 * Fixture volontairement DISCRIMINANTE : la recette porte DEUX lignes, dont
 * une seule est dégénérée. Une recette réduite à la seule ligne fautive ne
 * prouverait pas que le refus vise bien LA ligne désignée par la cible.
 */

import { describe, expect, it } from 'vitest';
import { ErreurMetier } from './erreurs.js';
import { mettreAEchelle, type RecetteCalcul } from './recettes.js';

/**
 * Recette à deux lignes : la farine est saine (145 g de référence), le sel a
 * une quantité de référence à zéro — la saisie d'un ingrédient « pour
 * mémoire », qui existe réellement dans le référentiel.
 */
const RECETTE_LIGNE_A_ZERO: RecetteCalcul = {
  id: 'r-zero',
  code: 'R-ZERO',
  rendementReferenceMl: 455,
  rendementReferenceCrepes: 6,
  perteCuissonBp: 0,
  tauxCasseBp: 0,
  lignes: [
    {
      ingredientId: 'farine-t55',
      nomIngredient: 'Farine T55',
      unite: 'g',
      quantiteReference: 145,
      cumpCentsParUnite: 0.075,
      allergenes: ['gluten'],
    },
    {
      ingredientId: 'sel',
      nomIngredient: 'Sel',
      unite: 'g',
      quantiteReference: 0,
      cumpCentsParUnite: 0.02,
      allergenes: [],
    },
  ],
};

describe('mettreAEchelle — cible « ingrédient » dont la quantité de référence est nulle', () => {
  it('refuse de diviser par zéro et nomme l’ingrédient fautif', () => {
    try {
      mettreAEchelle(RECETTE_LIGNE_A_ZERO, {
        type: 'ingredient',
        ingredientId: 'sel',
        quantiteDisponible: 500,
      });
      expect.unreachable('devait lever « quantite_reference_nulle »');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('quantite_reference_nulle');
      // Le message doit désigner LA ligne, pas la recette : c'est ce qui
      // permet à l'utilisateur de corriger la bonne ligne du bon écran.
      expect((erreur as ErreurMetier).message).toContain('Sel');
    }
  });

  it('accepte toujours la MÊME recette depuis l’autre ligne — le refus est ciblé, pas global', () => {
    // Discrimine : si le refus portait sur la recette entière plutôt que sur
    // la ligne désignée, cet appel échouerait lui aussi.
    const resultat = mettreAEchelle(RECETTE_LIGNE_A_ZERO, {
      type: 'ingredient',
      ingredientId: 'farine-t55',
      quantiteDisponible: 290,
    });
    expect(resultat.facteur).toBe(2);
    expect(resultat.volumeMl).toBe(910);
  });

  it('ne se déclenche PAS sur une quantité de référence simplement petite', () => {
    // Garde contre un refus posé sur `< 1` plutôt que sur `<= 0` : 2 g de sel
    // est une ligne parfaitement normale d'une recette de crêpes.
    const recetteSaine: RecetteCalcul = {
      ...RECETTE_LIGNE_A_ZERO,
      lignes: RECETTE_LIGNE_A_ZERO.lignes.map((l) =>
        l.ingredientId === 'sel' ? { ...l, quantiteReference: 2 } : l,
      ),
    };
    const resultat = mettreAEchelle(recetteSaine, {
      type: 'ingredient',
      ingredientId: 'sel',
      quantiteDisponible: 6,
    });
    expect(resultat.facteur).toBe(3);
  });
});
