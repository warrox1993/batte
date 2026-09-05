/**
 * Predicteur 5 de docs/demandes/07 §2 : effet de session consecutive.
 *
 * « Une session la semaine précédente s'est-elle soldée par une rupture ou un
 * invendu important ? Cet indicateur affine le facteur de tendance à court
 * terme, au-delà de la régression linéaire déjà posée. »
 *
 * Principe : on regarde, dans TOUT l'historique, comment les ventes ont
 * evolue d'une session a la suivante quand la session precedente s'est
 * terminee en rupture (quasiment tout ecoule) ou en invendu important (beaucoup
 * jete) — puis on applique ce meme ajustement quand la VRAIE session qui
 * precede `dateCible` presente le meme profil. Un profil sans precedent
 * suffisant dans l'historique reste sans effet : on ne devine pas une
 * ampleur qu'on n'a jamais mesuree.
 *
 * CONTAMINATION LEAVE-ONE-OUT (docs/05-DECISIONS.md D-089) : la calibration
 * (`ratioCroissancePondereMoyen`) portait sa propre fonction de ponderation
 * temporelle (`poidsRecence`), dupliquee de `poidsTemporel` (baseline.ts) et
 * — contrairement a `calculerBaseline`, `tendanceBp` — jamais filtree pour
 * exclure les paires POSTERIEURES a `dateCible`. `calculerPredicteursPrecision`
 * (predicteurs-precision.ts) appelle `sessionConsecutiveBp` A L'INTERIEUR de
 * la validation croisee leave-one-out (`validerParLeaveOneOut`), avec un
 * historique qui exclut la session ciblee PAR INDEX, donc qui peut encore
 * contenir des sessions POSTERIEURES a elle — et la calibration regardait
 * alors des paires (avant, apres) entierement FUTURES par rapport a
 * `dateCible`, `poidsRecence` leur donnant le poids maximal (1) au lieu de
 * les exclure. Le repère « VRAIE session qui precede `dateCible` »
 * (`sessionConsecutiveBp` ci-dessous, via `anterieures`) etait deja correct ;
 * seule la CALIBRATION (la moyenne qui sert a estimer l'AMPLEUR de l'effet)
 * fuitait. Meme defaut de fond que celui trouve et corrige dans `saison.ts`,
 * `jour-semaine.ts` et `vacances-scolaires.ts` — voir le rapport de
 * livraison pour la mesure. Corrige en partageant `ageEnJours`/
 * `poidsTemporel` de `baseline.ts` ET en excluant les paires dont `apres` est
 * postérieur (ou égal) a `dateCible` AVANT tout calcul. La VALEUR de
 * demi-vie reste un champ propre a `ConfigSessionConsecutive` : seul le
 * CALCUL est partage.
 */

import type { PointsDeBase } from '../argent.js';
import { BASE_POINTS, ratioEnPointsDeBase } from '../argent.js';
import { ageJours } from './calendrier.js';
import {
  ageEnJours,
  normaliserObservation,
  poidsTemporel,
  type ObservationSession,
} from './baseline.js';

/** Une session dont on connait, en plus des ventes, ce qui a ete produit et jete. */
export type ObservationEcoulement = ObservationSession & {
  readonly crepesProduites: number;
  readonly crepesInvendues: number;
};

export type EtatEcoulement = 'rupture' | 'invendu_important' | 'neutre' | 'indetermine';

export type ConfigSessionConsecutive = {
  /** Au-dela, la session precedente est jugee trop ancienne pour etre « consecutive ». */
  readonly ecartMaxJours: number;
  /** Part invendue (bp) EN DESSOUS de laquelle on juge qu'il y a eu rupture potentielle. */
  readonly seuilRuptureBp: PointsDeBase;
  /** Part invendue (bp) AU-DESSUS de laquelle on juge l'invendu « important ». */
  readonly seuilInvenduImportantBp: PointsDeBase;
  /** Nombre minimal d'occurrences passées d'un état pour calibrer son ajustement. */
  readonly occurrencesMinimum: number;
  readonly demiVieJours: number;
};

export type ResultatSessionConsecutive = {
  readonly actif: boolean;
  readonly facteurBp: PointsDeBase;
  readonly etatSessionPrecedente: EtatEcoulement;
  readonly nbOccurrencesEtat: number;
  readonly explication: string | null;
};

/** Classe l'ecoulement d'une session : rupture, invendu important, ou neutre. */
export function classerEcoulement(
  observation: ObservationEcoulement,
  config: Pick<ConfigSessionConsecutive, 'seuilRuptureBp' | 'seuilInvenduImportantBp'>,
): EtatEcoulement {
  if (observation.crepesProduites <= 0) return 'indetermine';
  const partInvendueBp = ratioEnPointsDeBase(
    observation.crepesInvendues,
    observation.crepesProduites,
  );
  if (partInvendueBp <= config.seuilRuptureBp) return 'rupture';
  if (partInvendueBp >= config.seuilInvenduImportantBp) return 'invendu_important';
  return 'neutre';
}

/**
 * Ratio de croissance ponderé, entre la session `apres` et une session
 * `avant` dans l'etat donne — moyenne sur toutes les paires consecutives de
 * l'historique qui presentent cet etat.
 *
 * `moyenne` vaut `null` si moins de `config.occurrencesMinimum` paires
 * exploitables existent : jamais d'ajustement invente sur une poignee de
 * coincidences. `nbOccurrences`, lui, est TOUJOURS le compte REEL trouve —
 * y compris quand `moyenne` est `null` faute d'en avoir assez.
 *
 * POURQUOI CE N'EST PAS UN SIMPLE `| null` SUR TOUT L'OBJET (defaut corrige) :
 * l'appelant a besoin d'afficher CE compte a l'utilisateur (« 1 rupture
 * observee, 3 necessaires pour calibrer ») meme quand aucune moyenne n'est
 * calculable. Rendre `null` pour tout l'objet obligeait `sessionConsecutiveBp`
 * a ecrire `calibration?.nbOccurrences ?? 0` — un nombre reel (1 occurrence
 * VUE) devenait indiscernable d'une absence totale (0 occurrence), exactement
 * la confusion que « une donnee manquante ne vaut jamais zero » interdit.
 */
function ratioCroissancePondereMoyen(
  observationsTriees: readonly ObservationEcoulement[],
  etatRecherche: EtatEcoulement,
  dateCible: string,
  config: ConfigSessionConsecutive,
): { readonly moyenne: number | null; readonly nbOccurrences: number } {
  let sommePoids = 0;
  let sommePonderee = 0;
  let nbOccurrences = 0;

  for (let i = 1; i < observationsTriees.length; i += 1) {
    const avant = observationsTriees[i - 1]!;
    const apres = observationsTriees[i]!;

    // Une paire dont `apres` tombe APRES (ou le meme jour que) `dateCible`
    // n'existe pas encore pour ce calcul — meme exclusion, et pour la meme
    // raison, que `calculerBaseline` (baseline.ts) : en validation croisee
    // leave-one-out, `observationsTriees` peut contenir des sessions
    // POSTERIEURES a `dateCible`. `avant` precede toujours `apres` (tableau
    // trie), donc cette seule garde suffit a exclure la paire entiere.
    const ageApres = ageEnJours(apres.dateSession, dateCible);
    if (Number.isFinite(ageApres) && ageApres <= 0) continue;

    const ecart = ageJours(apres.dateSession, avant.dateSession);
    if (!Number.isFinite(ecart) || ecart > config.ecartMaxJours) continue;
    if (classerEcoulement(avant, config) !== etatRecherche) continue;

    const valeurAvant = normaliserObservation(avant);
    if (valeurAvant <= 0) continue;
    const ratio = normaliserObservation(apres) / valeurAvant;

    const poids = poidsTemporel(ageApres, config.demiVieJours);
    sommePoids += poids;
    sommePonderee += poids * ratio;
    nbOccurrences += 1;
  }

  if (nbOccurrences < config.occurrencesMinimum || sommePoids <= 0) {
    return { moyenne: null, nbOccurrences };
  }
  return { moyenne: sommePonderee / sommePoids, nbOccurrences };
}

const LIBELLE_ETAT: Readonly<Record<EtatEcoulement, string>> = {
  rupture: 'rupture la session précédente',
  invendu_important: 'invendu important la session précédente',
  neutre: 'écoulement normal la session précédente',
  indetermine: 'écoulement inconnu la session précédente',
};

/**
 * Facteur multiplicatif « session consécutive », relatif à un écoulement
 * normal — s'active seulement si la VRAIE session qui précède `dateCible`
 * est en rupture ou en invendu important ET que l'historique contient assez
 * d'occurrences de cet état pour en calibrer sérieusement l'ampleur.
 */
export function sessionConsecutiveBp(
  observations: readonly ObservationEcoulement[],
  dateCible: string,
  config: ConfigSessionConsecutive,
): ResultatSessionConsecutive {
  const inactif = (etat: EtatEcoulement, nbOccurrences: number): ResultatSessionConsecutive => ({
    actif: false,
    facteurBp: BASE_POINTS,
    etatSessionPrecedente: etat,
    nbOccurrencesEtat: nbOccurrences,
    explication: null,
  });

  const triees = [...observations].sort((a, b) => (a.dateSession < b.dateSession ? -1 : 1));

  // La VRAIE session qui precede immediatement `dateCible`, dans la fenetre
  // de tolerance : la plus recente STRICTEMENT anterieure a la cible.
  const anterieures = triees.filter((o) => o.dateSession < dateCible);
  const precedente = anterieures.at(-1);
  if (precedente === undefined) return inactif('indetermine', 0);

  const ecart = ageJours(dateCible, precedente.dateSession);
  if (!Number.isFinite(ecart) || ecart > config.ecartMaxJours) return inactif('indetermine', 0);

  const etat = classerEcoulement(precedente, config);
  // Un ecoulement neutre ou indetermine n'a rien de distinctif a expliquer :
  // le facteur reste neutre par construction, sans avoir besoin de chercher
  // une calibration historique pour un etat qui ne demande aucun ajustement.
  if (etat === 'neutre' || etat === 'indetermine') return inactif(etat, 0);

  const calibration = ratioCroissancePondereMoyen(triees, etat, dateCible, config);
  const reference = ratioCroissancePondereMoyen(triees, 'neutre', dateCible, config);
  // Le compte REEL d'occurrences (`calibration.nbOccurrences`) est toujours
  // connu, meme quand `moyenne` est `null` faute d'en avoir assez pour
  // calibrer : jamais remplace par 0, qui dirait a tort « aucune rupture
  // jamais vue » la ou il pourrait y en avoir eu une ou deux, insuffisantes
  // seulement pour en tirer une ampleur fiable.
  if (calibration.moyenne === null || reference.moyenne === null || reference.moyenne <= 0) {
    return inactif(etat, calibration.nbOccurrences);
  }

  const facteurBp = Math.round((calibration.moyenne / reference.moyenne) * BASE_POINTS);

  return {
    actif: true,
    facteurBp,
    etatSessionPrecedente: etat,
    nbOccurrencesEtat: calibration.nbOccurrences,
    explication: `Session précédente (${LIBELLE_ETAT[etat]}) : × ${(facteurBp / BASE_POINTS).toFixed(2).replace('.', ',')}.`,
  };
}
