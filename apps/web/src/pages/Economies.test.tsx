import { describe, expect, it } from 'vitest';
import { anneeDepuisParametreUrl } from './Economies';

/**
 * Pont Comptabilité → Économies (`cheminEconomiesDuMois`, `Comptabilite.tsx`,
 * bouton « Voir l'économie d'achat de ce mois »).
 *
 * AVANT ce lot (mission du 31/07/2026), `Economies.tsx` ne lisait AUCUN
 * paramètre d'URL — son `annee` était initialisée localement sur l'année
 * civile courante (`anneeCourante`), toujours la même quel que soit ce qui
 * figure dans l'URL. `anneeDepuisParametreUrl` est la fonction pure qui rend
 * cette lecture testable sans monter l'écran complet (le montage vit dans
 * `Economies.montage.test.tsx`, à côté de ce fichier).
 *
 * Ce que ce test NE prouve PAS : que le composant `Economies` appelle bien
 * cette fonction au montage, ni qu'elle pré-filtre réellement l'écran une
 * fois monté — seul un montage réel (hors de portée ici, faute de `jsdom`)
 * le prouverait. Voir le rapport de livraison pour ce que ce pont ne fait
 * pas encore (le paramètre `?mois=` posé par `cheminEconomiesDuMois` reste
 * non lu : cet écran ne filtre qu'au niveau de l'année).
 */
describe('anneeDepuisParametreUrl — pré-filtre le pont Comptabilité → Économies', () => {
  it('lit une année valide depuis `?annee=<n>`', () => {
    expect(anneeDepuisParametreUrl(new URLSearchParams('annee=2025'))).toBe(2025);
  });

  it('rend `null` quand le paramètre est absent — jamais une année inventée', () => {
    expect(anneeDepuisParametreUrl(new URLSearchParams(''))).toBeNull();
  });

  it('rend `null` sur une valeur illisible — jamais `NaN` propagé au composant', () => {
    expect(anneeDepuisParametreUrl(new URLSearchParams('annee=pas-un-nombre'))).toBeNull();
  });

  it('rend `null` sur une chaîne vide — même exigence qu’un paramètre absent', () => {
    expect(anneeDepuisParametreUrl(new URLSearchParams('annee='))).toBeNull();
  });
});
