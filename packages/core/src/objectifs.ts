/**
 * Objectifs (fiche `docs/demandes/18-SUCCES-NIVEAUX-ET-OBJECTIFS.md` §4).
 *
 * « L'apport le plus solide n'est pas les badges : ce sont les objectifs. »
 * L'application sait ce qui s'est passé (sessions) et ce qui va se passer
 * (prévisions) ; elle ne savait pas ce que le porteur VISE. Dans un ERP
 * classique, ce module s'appelle un budget.
 *
 * Fonction pure (CLAUDE.md §3 règle 1) : compare une cible déclarée à un
 * réalisé déjà calculé ailleurs, sans jamais lire ni écrire de base.
 */

import { ratioEnPointsDeBase, type PointsDeBase } from './argent.js';

export const GRANDEURS_OBJECTIF = [
  'chiffre_affaires',
  'marge_nette',
  'nombre_sessions',
  'cout_matiere_par_crepe',
] as const;
export type GrandeurObjectif = (typeof GRANDEURS_OBJECTIF)[number];

/**
 * Sens dans lequel une grandeur s'améliore.
 *
 * Trois grandeurs se MAXIMISENT : « grossir le plus possible » (CLAUDE.md §6,
 * fiche §2.1) vaut pour le chiffre d'affaires, la marge nette et le nombre de
 * sessions. Le coût matière par crêpe est la seule à se MINIMISER — c'est le
 * seul cas où réaliser MOINS que la cible est une réussite.
 */
export function sensAmeliorationObjectif(grandeur: GrandeurObjectif): 'hausse' | 'baisse' {
  return grandeur === 'cout_matiere_par_crepe' ? 'baisse' : 'hausse';
}

export type StatutObjectif = 'sans_donnee' | 'atteint' | 'en_cours' | 'manque';

export type ResultatEvaluationObjectif = {
  readonly grandeur: GrandeurObjectif;
  readonly valeurCible: number;
  readonly realise: number | null;
  /**
   * Écart dans le SENS QUI COMPTE : positif veut toujours dire « dans le bon
   * sens », quelle que soit la grandeur (voir `sensAmeliorationObjectif`).
   * `null` sans donnée réalisée.
   */
  readonly ecart: number | null;
  /**
   * Avancement vers la cible, en points de base, dans le sens qui compte.
   * Peut dépasser 10 000 (objectif dépassé). `null` sans donnée réalisée.
   */
  readonly avancementBp: PointsDeBase | null;
  readonly statut: StatutObjectif;
  readonly periodeTerminee: boolean;
};

/**
 * Évalue un objectif contre son réalisé.
 *
 * @param realise `null` = aucune donnée sur la période (aucune session
 *   clôturée, par exemple) — jamais confondu avec un réalisé de zéro.
 * @param periodeTerminee Calculé par l'appelant (comparaison de `dateFin` au
 *   jour civil courant) : cette fonction ne connaît pas la date d'aujourd'hui,
 *   pour rester testable sans horloge.
 */
export function evaluerObjectif(entree: {
  readonly grandeur: GrandeurObjectif;
  readonly valeurCible: number;
  readonly realise: number | null;
  readonly periodeTerminee: boolean;
}): ResultatEvaluationObjectif {
  const { grandeur, valeurCible, realise, periodeTerminee } = entree;

  if (realise === null) {
    return {
      grandeur,
      valeurCible,
      realise: null,
      ecart: null,
      avancementBp: null,
      statut: periodeTerminee ? 'manque' : 'sans_donnee',
      periodeTerminee,
    };
  }

  const sens = sensAmeliorationObjectif(grandeur);
  const ecart = sens === 'hausse' ? realise - valeurCible : valeurCible - realise;
  const enBonneVoie = ecart >= 0;

  // Avancement toujours exprimé « ce que j'ai fait / ce que je visais », dans
  // le sens qui compte : reste lisible même sur le coût matière (qui baisse).
  // Le dénominateur de `ratioEnPointsDeBase` change de rôle selon le sens
  // (le réalisé en hausse, la cible en baisse) : le cas dégénéré « zéro au
  // dénominateur » se traite donc symétriquement, pas sur le même terme.
  const avancementBp =
    sens === 'hausse'
      ? valeurCible <= 0
        ? realise <= 0
          ? 0
          : 10_000
        : ratioEnPointsDeBase(realise, valeurCible)
      : realise <= 0
        ? valeurCible <= 0
          ? 0
          : 10_000
        : ratioEnPointsDeBase(valeurCible, realise);

  return {
    grandeur,
    valeurCible,
    realise,
    ecart,
    avancementBp,
    statut: enBonneVoie ? 'atteint' : periodeTerminee ? 'manque' : 'en_cours',
    periodeTerminee,
  };
}
