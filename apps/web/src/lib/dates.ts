import { jourCivilBelge } from '@batte/core';

/**
 * Jour civil belge LU À CHAQUE APPEL, jamais figé au chargement du module.
 *
 * Pourquoi une fonction et non une constante : une `const AUJOURD_HUI =
 * jourCivilBelge(new Date())` posée au niveau du module n'est évaluée qu'une
 * seule fois, à l'import. L'application est un poste de bureau qu'on laisse
 * ouvert plusieurs jours d'affilée ; le lundi, le formulaire proposait encore
 * la date du vendredi où l'onglet avait été ouvert.
 *
 * Sur les écrans qui écrivent une date en base (Registre AFSCA, Sessions,
 * Production, Comptabilité) c'est un ANTIDATAGE PAR L'INTERFACE : CLAUDE.md §7
 * exige que le registre porte la date de saisie réelle, et l'utilisateur n'a
 * aucun moyen de voir que la date proposée est périmée. Sur les écrans qui ne
 * font qu'afficher un compte à rebours (Stock, Tableau de bord) le même gel
 * fait vieillir les « J-3 avant DLC » sans que rien ne le signale.
 *
 * Usage :
 * - initialisation d'état React : `useState(aujourdHui)` — React appelle
 *   l'initialiseur paresseux au premier rendu du composant, donc à l'ouverture
 *   de l'écran, et non à l'import du module ;
 * - dans un gestionnaire d'événement : `aujourdHui()`, évalué au clic.
 */
export function aujourdHui(): string {
  return jourCivilBelge(new Date());
}
