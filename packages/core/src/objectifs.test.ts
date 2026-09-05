import { describe, expect, it } from 'vitest';
import { evaluerObjectif, sensAmeliorationObjectif } from './objectifs.js';

describe('sensAmeliorationObjectif', () => {
  it('le coût matière par crêpe se minimise', () => {
    expect(sensAmeliorationObjectif('cout_matiere_par_crepe')).toBe('baisse');
  });

  it('le chiffre d’affaires, la marge nette et le nombre de sessions se maximisent', () => {
    expect(sensAmeliorationObjectif('chiffre_affaires')).toBe('hausse');
    expect(sensAmeliorationObjectif('marge_nette')).toBe('hausse');
    expect(sensAmeliorationObjectif('nombre_sessions')).toBe('hausse');
  });
});

describe('evaluerObjectif — grandeurs qui se maximisent', () => {
  it('rend "sans_donnee" quand rien n’est encore réalisé et la période est en cours', () => {
    const resultat = evaluerObjectif({
      grandeur: 'chiffre_affaires',
      valeurCible: 100_000,
      realise: null,
      periodeTerminee: false,
    });
    expect(resultat).toEqual({
      grandeur: 'chiffre_affaires',
      valeurCible: 100_000,
      realise: null,
      ecart: null,
      avancementBp: null,
      statut: 'sans_donnee',
      periodeTerminee: false,
    });
  });

  it('rend "manque" quand rien n’est réalisé et la période est terminée', () => {
    const resultat = evaluerObjectif({
      grandeur: 'chiffre_affaires',
      valeurCible: 100_000,
      realise: null,
      periodeTerminee: true,
    });
    expect(resultat.statut).toBe('manque');
  });

  it('rend "en_cours" avec un écart négatif tant que la cible n’est pas atteinte', () => {
    const resultat = evaluerObjectif({
      grandeur: 'chiffre_affaires',
      valeurCible: 100_000,
      realise: 60_000,
      periodeTerminee: false,
    });
    expect(resultat.statut).toBe('en_cours');
    expect(resultat.ecart).toBe(-40_000);
    expect(resultat.avancementBp).toBe(6_000);
  });

  it('rend "manque" avec un écart négatif si la période est terminée sans avoir atteint la cible', () => {
    const resultat = evaluerObjectif({
      grandeur: 'marge_nette',
      valeurCible: 100_000,
      realise: 60_000,
      periodeTerminee: true,
    });
    expect(resultat.statut).toBe('manque');
    expect(resultat.ecart).toBe(-40_000);
  });

  it('rend "atteint" avec un écart positif dès que le réalisé égale ou dépasse la cible', () => {
    const pile = evaluerObjectif({
      grandeur: 'nombre_sessions',
      valeurCible: 10,
      realise: 10,
      periodeTerminee: false,
    });
    expect(pile.statut).toBe('atteint');
    expect(pile.ecart).toBe(0);
    expect(pile.avancementBp).toBe(10_000);

    const depasse = evaluerObjectif({
      grandeur: 'nombre_sessions',
      valeurCible: 10,
      realise: 15,
      periodeTerminee: false,
    });
    expect(depasse.statut).toBe('atteint');
    expect(depasse.ecart).toBe(5);
    // Avancement peut dépasser 10 000 : l'objectif est dépassé, pas juste atteint.
    expect(depasse.avancementBp).toBe(15_000);
  });

  it('ne divise jamais par zéro sur une cible nulle', () => {
    const sansRealise = evaluerObjectif({
      grandeur: 'chiffre_affaires',
      valeurCible: 0,
      realise: 0,
      periodeTerminee: false,
    });
    expect(sansRealise.avancementBp).toBe(0);
    expect(sansRealise.statut).toBe('atteint');

    const avecRealise = evaluerObjectif({
      grandeur: 'chiffre_affaires',
      valeurCible: 0,
      realise: 500,
      periodeTerminee: false,
    });
    expect(avecRealise.avancementBp).toBe(10_000);
  });
});

describe('evaluerObjectif — coût matière par crêpe (se minimise)', () => {
  it('rend "atteint" quand le réalisé est SOUS la cible', () => {
    const resultat = evaluerObjectif({
      grandeur: 'cout_matiere_par_crepe',
      valeurCible: 40,
      realise: 33,
      periodeTerminee: false,
    });
    expect(resultat.statut).toBe('atteint');
    // Écart dans le sens qui compte : positif = bon signe, même si "réalisé < cible".
    expect(resultat.ecart).toBe(7);
    expect(resultat.avancementBp).toBeGreaterThan(10_000);
  });

  it('rend "en_cours" quand le réalisé est AU-DESSUS de la cible et la période n’est pas terminée', () => {
    const resultat = evaluerObjectif({
      grandeur: 'cout_matiere_par_crepe',
      valeurCible: 30,
      realise: 45,
      periodeTerminee: false,
    });
    expect(resultat.statut).toBe('en_cours');
    expect(resultat.ecart).toBe(-15);
    expect(resultat.avancementBp).toBe(Math.round((30 / 45) * 10_000));
  });

  it('rend "manque" quand la période est terminée au-dessus de la cible', () => {
    const resultat = evaluerObjectif({
      grandeur: 'cout_matiere_par_crepe',
      valeurCible: 30,
      realise: 45,
      periodeTerminee: true,
    });
    expect(resultat.statut).toBe('manque');
  });

  it('ne divise jamais par zéro sur un réalisé nul', () => {
    const resultat = evaluerObjectif({
      grandeur: 'cout_matiere_par_crepe',
      valeurCible: 30,
      realise: 0,
      periodeTerminee: false,
    });
    // Coût nul face à une cible positive : la meilleure situation possible,
    // représentée par le plafond conventionnel de 10 000 (voir le commentaire
    // du calcul dans objectifs.ts), pas par une division par zéro.
    expect(resultat.avancementBp).toBe(10_000);
    // Un coût matière nul est, littéralement, sous la cible : c'est une réussite.
    expect(resultat.statut).toBe('atteint');
  });
});
