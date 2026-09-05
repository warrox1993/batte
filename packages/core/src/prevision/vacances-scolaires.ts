/**
 * Predicteur 3 de docs/demandes/07 §2 : proximite d'une periode de vacances
 * scolaires belges.
 *
 * « Calendrier statique, déjà évoqué en docs/03-MOTEUR-PREVISION.md
 * §« Facteur 4 »." » — ET, condition posee par CLAUDE.md §7 : « ne pas coder
 * en dur des taux, seuils ou montants réglementaires ». Un calendrier de
 * vacances scolaires n'est pas un taux, mais c'est une donnee qui CHANGE
 * chaque annee scolaire (le Gouvernement de la Fédération Wallonie-Bruxelles
 * publie un nouveau calendrier chaque annee) : il doit donc vivre dans la
 * table `parametre` (type `json`), jamais comme une constante compilee ici.
 *
 * CE MODULE NE CONTIENT AUCUNE DATE : les periodes sont un PARAMETRE d'entree
 * de chaque fonction, jamais une valeur par defaut cachee dans le code. Voir
 * le rapport de livraison pour la cle de catalogue proposee et son contenu.
 *
 * DEVIATION ASSUMEE par rapport a la lettre de la fiche : docs/demandes/07
 * parle de « proximité » d'une periode de vacances, ce qui suggererait un
 * effet continu (un tapering a l'approche de la periode). Ce module
 * implemente un effet BINAIRE (dans / hors vacances) : sur un historique de
 * quelques dizaines de sessions hebdomadaires, un effet continu ajouterait un
 * parametre de forme (largeur du tapering) sans assez de points pour
 * l'estimer serieusement — exactement le piege de sur-apprentissage signale
 * pour cette fiche. Le binaire est plus simple, plus sobre en parametres, et
 * reste soumis a la meme validation croisee que les autres predicteurs
 * (`validation-croisee.ts`) : s'il n'ameliore rien, il n'entre pas dans le
 * calcul de toute facon.
 *
 * CONTAMINATION LEAVE-ONE-OUT (docs/05-DECISIONS.md D-089) : ce module
 * portait sa propre fonction de ponderation temporelle (`poidsRecence`),
 * dupliquee de `poidsTemporel` (baseline.ts) et — contrairement a
 * `calculerBaseline`, `tendanceBp` — jamais filtree pour exclure les sessions
 * POSTERIEURES a `dateCible`. `calculerPredicteursPrecision`
 * (predicteurs-precision.ts) appelle `facteurVacancesScolairesBp` A
 * L'INTERIEUR de la validation croisee leave-one-out
 * (`validerParLeaveOneOut`), avec un historique qui exclut la session ciblee
 * PAR INDEX, donc qui peut encore contenir des sessions POSTERIEURES a elle —
 * et `poidsRecence` leur donnait alors le poids maximal (1) au lieu de les
 * exclure. Meme defaut de fond que celui trouve et corrige dans `saison.ts`
 * et `jour-semaine.ts` — voir le rapport de livraison pour la mesure.
 * Corrige en partageant `ageEnJours`/`poidsTemporel` de `baseline.ts` ET en
 * excluant les sessions futures AVANT tout calcul, y compris avant le
 * regroupement en/hors vacances. La VALEUR de demi-vie reste un champ propre
 * a `ConfigVacancesScolaires` : seul le CALCUL est partage.
 */

import type { PointsDeBase } from '../argent.js';
import { BASE_POINTS } from '../argent.js';
import {
  ageEnJours,
  normaliserObservation,
  poidsTemporel,
  type ObservationSession,
} from './baseline.js';

/** Une periode de vacances scolaires, bornes incluses, au format `AAAA-MM-JJ`. */
export type PeriodeVacances = {
  readonly nom: string;
  readonly debut: string;
  readonly fin: string;
};

export type ConfigVacancesScolaires = {
  /** Nombre minimal d'observations DANS et HORS vacances pour estimer un effet différentiel. */
  readonly observationsMinimum: number;
  readonly demiVieJours: number;
};

export type ResultatVacancesScolaires = {
  readonly actif: boolean;
  readonly facteurBp: PointsDeBase;
  readonly enVacances: boolean;
  readonly nbObservationsEnVacances: number;
  readonly nbObservationsHorsVacances: number;
  readonly explication: string | null;
};

/** La date tombe-t-elle dans l'une des periodes fournies, bornes incluses ? */
export function estEnVacances(date: string, periodes: readonly PeriodeVacances[]): boolean {
  return periodes.some((p) => date >= p.debut && date <= p.fin);
}

/**
 * Facteur multiplicatif « vacances scolaires », relatif a la moyenne generale.
 *
 * Le facteur applique est TOUJOURS celui du groupe auquel appartient
 * `dateCible` (en vacances ou non) — jamais un melange des deux, ce qui n'
 * aurait pas de sens pour une date precise.
 */
export function facteurVacancesScolairesBp(
  observations: readonly ObservationSession[],
  dateCible: string,
  periodes: readonly PeriodeVacances[],
  config: ConfigVacancesScolaires,
): ResultatVacancesScolaires {
  const cibleEnVacances = estEnVacances(dateCible, periodes);

  const inactif = (nbEnVacances: number, nbHorsVacances: number): ResultatVacancesScolaires => ({
    actif: false,
    facteurBp: BASE_POINTS,
    enVacances: cibleEnVacances,
    nbObservationsEnVacances: nbEnVacances,
    nbObservationsHorsVacances: nbHorsVacances,
    explication: null,
  });

  // Une session datee APRES (ou le meme jour que) `dateCible` n'existe pas
  // encore pour ce calcul : meme exclusion, et pour la meme raison, que
  // `calculerBaseline` (baseline.ts) — en validation croisee leave-one-out
  // (`calculerPredicteursPrecision`, predicteurs-precision.ts), l'historique
  // transmis exclut la session ciblee mais peut encore contenir des sessions
  // POSTERIEURES a elle. Filtree AVANT tout calcul, y compris avant le
  // regroupement en/hors vacances.
  const observationsRetenues = observations
    .map((observation) => ({ observation, age: ageEnJours(observation.dateSession, dateCible) }))
    .filter(({ age }) => !Number.isFinite(age) || age > 0);

  const enVacances: { readonly observation: ObservationSession; readonly age: number }[] = [];
  const horsVacances: { readonly observation: ObservationSession; readonly age: number }[] = [];
  for (const retenue of observationsRetenues) {
    (estEnVacances(retenue.observation.dateSession, periodes) ? enVacances : horsVacances).push(
      retenue,
    );
  }

  if (
    enVacances.length < config.observationsMinimum ||
    horsVacances.length < config.observationsMinimum
  ) {
    return inactif(enVacances.length, horsVacances.length);
  }

  const moyennePonderee = (
    groupe: readonly { readonly observation: ObservationSession; readonly age: number }[],
  ): number => {
    let sommePoids = 0;
    let sommePonderee = 0;
    for (const { observation, age } of groupe) {
      const poids = poidsTemporel(age, config.demiVieJours);
      sommePoids += poids;
      sommePonderee += poids * normaliserObservation(observation);
    }
    // Chaque groupe compte au moins `config.observationsMinimum` observations
    // (garde ci-dessus) et un poids de recence n'est jamais nul : la division
    // ne peut pas se faire par zero.
    return sommePonderee / sommePoids;
  };

  const moyenneGenerale = moyennePonderee([...enVacances, ...horsVacances]);
  if (moyenneGenerale <= 0) return inactif(enVacances.length, horsVacances.length);

  const moyenneGroupeCible = moyennePonderee(cibleEnVacances ? enVacances : horsVacances);
  const facteurBp = Math.round((moyenneGroupeCible / moyenneGenerale) * BASE_POINTS);

  return {
    actif: true,
    facteurBp,
    enVacances: cibleEnVacances,
    nbObservationsEnVacances: enVacances.length,
    nbObservationsHorsVacances: horsVacances.length,
    explication:
      `Vacances scolaires (${cibleEnVacances ? 'en vacances' : 'hors vacances'}) : ` +
      `× ${(facteurBp / BASE_POINTS).toFixed(2).replace('.', ',')}.`,
  };
}
