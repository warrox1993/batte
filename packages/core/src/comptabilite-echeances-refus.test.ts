/**
 * Les deux refus de l'échéancier que rien n'exerçait.
 *
 * Tous deux protègent le MÊME chiffre : le pas, en années, d'une échéance
 * quinquennale (`echeance_pas_quinquennal_annees`). Ce paramètre a longtemps
 * été sans effet — figé dans une constante de module — et sa remise en
 * service (voir le commentaire de `DefinitionEcheance.pasAnnees`) l'a rendu
 * réellement éditable depuis l'écran Paramètres. Éditable veut dire
 * saisissable à une valeur absurde : c'est exactement ce que ces deux refus
 * attrapent, et ce que rien ne vérifiait.
 *
 * `formaterEuros` n'apparaît pas ici — aucun montant n'est en jeu, seulement
 * des durées. On compare donc des codes d'erreur, jamais des messages entiers.
 */

import { describe, expect, it } from 'vitest';
import {
  construireCatalogueEcheances,
  prochaineOccurrenceEcheance,
  type DefinitionEcheance,
} from './comptabilite.js';
import { ErreurMetier } from './erreurs.js';
import { CATALOGUE_PARAMETRES, Parametres } from './parametres.js';

/** Catalogue de paramètres complet, une seule clé écrasée. Aucune valeur en dur. */
function parametresAvec(cle: string, valeur: string): Parametres {
  return Parametres.depuisLignes(
    CATALOGUE_PARAMETRES.map((d) => ({
      cle: d.cle,
      valeur: d.cle === cle ? valeur : d.valeurDefaut,
    })),
  );
}

function attendCode(fn: () => unknown, code: string): ErreurMetier {
  try {
    fn();
    expect.unreachable(`devait lever une ErreurMetier de code « ${code} »`);
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect((erreur as ErreurMetier).code).toBe(code);
    return erreur as ErreurMetier;
  }
  throw new Error('inatteignable');
}

describe('construireCatalogueEcheances — pas quinquennal saisi à une valeur absurde', () => {
  it('accepte le catalogue par défaut : la garde ne bloque pas le cas normal', () => {
    const parDefaut = Parametres.depuisLignes(
      CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: d.valeurDefaut })),
    );
    const catalogue = construireCatalogueEcheances(parDefaut);
    const quinquennales = catalogue.filter((d) => d.recurrence === 'quinquennale');
    // Discrimine : sans au moins une quinquennale au catalogue, le refus
    // testé plus bas porterait sur un cas que le produit ne rencontre jamais.
    expect(quinquennales.length).toBeGreaterThan(0);
    for (const definition of quinquennales) {
      expect(definition.pasAnnees).not.toBeNull();
      expect(definition.pasAnnees).toBeGreaterThan(0);
    }
  });

  it('refuse un pas à zéro — une échéance qui se renouvellerait tous les zéro an', () => {
    const erreur = attendCode(
      () => construireCatalogueEcheances(parametresAvec('echeance_pas_quinquennal_annees', '0')),
      'pas_quinquennal_invalide',
    );
    // Le champ est nommé : l'écran Paramètres doit pouvoir accrocher le
    // message SOUS la clé fautive, pas en bannière (docs/07 §4.7).
    expect(erreur.champs).toHaveProperty('echeance_pas_quinquennal_annees');
  });

  it('refuse un pas négatif', () => {
    attendCode(
      () => construireCatalogueEcheances(parametresAvec('echeance_pas_quinquennal_annees', '-5')),
      'pas_quinquennal_invalide',
    );
  });

  it('reporte le pas RÉELLEMENT saisi dans les définitions quand il est valide', () => {
    // Preuve que la lecture du paramètre est réelle et non décorative : un pas
    // de 3 ans doit se retrouver tel quel dans le catalogue.
    const catalogue = construireCatalogueEcheances(
      parametresAvec('echeance_pas_quinquennal_annees', '3'),
    );
    const quinquennales = catalogue.filter((d) => d.recurrence === 'quinquennale');
    expect(quinquennales.length).toBeGreaterThan(0);
    for (const definition of quinquennales) {
      expect(definition.pasAnnees).toBe(3);
    }
  });
});

describe('prochaineOccurrenceEcheance — définition quinquennale sans pas', () => {
  /**
   * Une définition construite À LA MAIN, telle qu'un catalogue incomplet
   * pourrait la produire : `recurrence: 'quinquennale'` mais `pasAnnees: null`.
   * Le cas n'est pas hypothétique — `pasAnnees` est `null` pour toute
   * récurrence `ponctuelle`, donc une définition recopiée puis reclassée en
   * quinquennale sans toucher au pas tombe exactement ici.
   */
  const SANS_PAS: DefinitionEcheance = {
    libelle: 'Autorisation AFSCA',
    recurrence: 'quinquennale',
    jourReference: '03-31',
    joursSupplementaires: [],
    sourceLegale: 'test',
    urlSource: null,
    pasAnnees: null,
  };

  it('refuse de calculer plutôt que de retomber sur un pas implicite', () => {
    const erreur = attendCode(
      () => prochaineOccurrenceEcheance(SANS_PAS, '2026-08-01', '2024-03-31'),
      'pas_echeance_manquant',
    );
    expect(erreur.message).toContain('Autorisation AFSCA');
  });

  it('calcule normalement dès que la MÊME définition porte un pas', () => {
    // Discrimine : si le refus venait d'autre chose que du pas absent, cet
    // appel échouerait aussi. Ancrage 2024-03-31 + 5 ans -> 2029.
    const avecPas: DefinitionEcheance = { ...SANS_PAS, pasAnnees: 5 };
    expect(prochaineOccurrenceEcheance(avecPas, '2026-08-01', '2024-03-31')).toBe('2029-03-31');
  });
});
