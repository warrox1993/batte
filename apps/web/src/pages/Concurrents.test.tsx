import { describe, expect, it } from 'vitest';
import type { Comparateur } from '@batte/core';
import { erreursSaisieConcurrent, resoudreEcartComparateur, type Brouillon } from './Concurrents';

/**
 * Audit du 30/07/2026 (« inconnu affiché comme zéro », couche affichage) :
 * le comparateur de prix calculait
 * `(concurrentsPrixMoyenCents ?? 0) - (notrePrixMoyenCrepeCents ?? 0)` — un
 * repli qui ne peut jamais se déclencher AUJOURD'HUI (le serveur ne renvoie
 * `ecartBp` non nul que quand les deux moyennes sont connues,
 * `packages/db/src/depots/concurrents.ts`), mais que le TYPE (`number | null`
 * sur chacun des deux champs) autorise. Si cette invariance venait à se
 * rompre côté serveur, l'écran aurait affiché un écart CONNU (par exemple
 * « +3,00 € ») en traitant un prix INCONNU comme gratuit, au lieu du tiret
 * d'absence.
 */

function moyenne(partiel: Partial<Comparateur['moyenne']>): Comparateur['moyenne'] {
  return {
    notrePrixMoyenCrepeCents: 300,
    concurrentsPrixMoyenCents: 350,
    ecartBp: 1667,
    nbConcurrentsEquivalents: 2,
    ...partiel,
  };
}

describe('resoudreEcartComparateur', () => {
  it('rend l’écart en euros quand les deux moyennes sont connues', () => {
    expect(
      resoudreEcartComparateur(
        moyenne({ notrePrixMoyenCrepeCents: 300, concurrentsPrixMoyenCents: 350 }),
      ),
    ).toBe('+0,50');
  });

  it('rend null quand notre prix moyen est inconnu, jamais un écart calculé sur un prix gratuit', () => {
    expect(
      resoudreEcartComparateur(
        moyenne({ notrePrixMoyenCrepeCents: null, concurrentsPrixMoyenCents: 350 }),
      ),
    ).toBeNull();
  });

  it('rend null quand le prix moyen des concurrents est inconnu', () => {
    expect(
      resoudreEcartComparateur(
        moyenne({ notrePrixMoyenCrepeCents: 300, concurrentsPrixMoyenCents: null }),
      ),
    ).toBeNull();
  });

  it('rend null quand les deux prix moyens sont inconnus', () => {
    expect(
      resoudreEcartComparateur(
        moyenne({ notrePrixMoyenCrepeCents: null, concurrentsPrixMoyenCents: null }),
      ),
    ).toBeNull();
  });
});

/**
 * Retour de focus après un échec d'enregistrement (recette clavier du
 * 30/07/2026, même mission que Produits.tsx) : `corpsFicheDepuisBrouillon`
 * posait déjà `champsEnErreur` sur un lieu non choisi ou une qualité perçue
 * illisible, mais n'appelait jamais `focaliserPremierChampFautif` — le focus
 * restait sur le bouton « Enregistrer ».
 *
 * `erreursSaisieConcurrent` est la fonction PURE extraite de cette validation
 * locale : ces tests prouvent qu'elle désigne le bon champ EN PREMIER — celui
 * que `corpsFicheDepuisBrouillon` transmet désormais à
 * `focaliserPremierChampFautif` juste après `setChampsEnErreur`.
 */
const BROUILLON_VALIDE: Brouillon = {
  nom: 'Le Petit Suisse',
  lieuId: 'lieu-batte',
  typeOffre: 'crepes',
  positionnement: 'standard',
  emplacementObserve: 'Face à la Meuse',
  qualitePercue: '3',
  notesGenerales: '',
};

describe('erreursSaisieConcurrent — le champ que le focus doit atteindre en premier', () => {
  it('signale un lieu non choisi sous `lieuId`', () => {
    const erreurs = erreursSaisieConcurrent({ ...BROUILLON_VALIDE, lieuId: '' });
    expect(Object.keys(erreurs)[0]).toBe('lieuId');
  });

  it('signale une qualité perçue illisible sous `qualitePercue`', () => {
    const erreurs = erreursSaisieConcurrent({ ...BROUILLON_VALIDE, qualitePercue: 'abc' });
    expect(Object.keys(erreurs)[0]).toBe('qualitePercue');
  });

  it('signale une qualité perçue hors bornes (0 ou 6) sous `qualitePercue`', () => {
    expect(
      Object.keys(erreursSaisieConcurrent({ ...BROUILLON_VALIDE, qualitePercue: '0' }))[0],
    ).toBe('qualitePercue');
    expect(
      Object.keys(erreursSaisieConcurrent({ ...BROUILLON_VALIDE, qualitePercue: '6' }))[0],
    ).toBe('qualitePercue');
  });

  it('ne signale rien pour un brouillon valide', () => {
    expect(erreursSaisieConcurrent(BROUILLON_VALIDE)).toEqual({});
  });
});
