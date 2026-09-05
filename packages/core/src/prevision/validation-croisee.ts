/**
 * Le garde-fou anti-sur-apprentissage de
 * `docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md` §3.
 *
 * « Cinq predicteurs de plus sur un historique de quelques dizaines de
 * sessions, c'est le meilleur moyen d'obtenir un modele qui explique
 * parfaitement le passe et prevoit mal l'avenir. » Ce module ne MESURE pas
 * seulement l'amelioration d'un predicteur, il la REFUSE quand elle n'est pas
 * la : « un predicteur qui n'ameliore pas le MAPE en leave-one-out ne doit pas
 * entrer dans le calcul, meme s'il parait sense ».
 *
 * Validation croisee LEAVE-ONE-OUT : chaque observation est tour a tour
 * retiree de l'historique, re-estimee a partir de TOUTES LES AUTRES, puis
 * comparee a sa valeur reelle. C'est deja le principe pose par docs/03 pour
 * les facteurs meteo/saison ; ce module le GENERALISE pour qu'il s'applique
 * identiquement aux cinq nouveaux predicteurs de la fiche 07, au lieu d'etre
 * reimplemente cinq fois avec des variantes.
 *
 * Deterministe et sans effet de bord : memes entrees, meme verdict — condition
 * du backtesting (docs/03, avertissement).
 */

/**
 * Estime une valeur a partir d'un historique qui EXCLUT deliberement la cible.
 *
 * Rend `null` quand l'estimateur n'a pas assez d'historique pour se prononcer
 * sur CE point precis — c'est le mecanisme de « demarrage a froid » applique
 * point par point : un point que le predicteur ne sait pas estimer sort de la
 * comparaison plutot que de fausser le score dans un sens ou dans l'autre.
 */
export type Estimateur<TContexte> = (
  historique: readonly TContexte[],
  cible: TContexte,
) => number | null;

export type ResultatValidationCroisee = {
  /** Points ou les DEUX modeles ont pu se prononcer : seule base de comparaison equitable. */
  readonly nbPointsEvalues: number;
  readonly mapeSansPredicteurBp: number | null;
  readonly mapeAvecPredicteurBp: number | null;
  /**
   * `mapeSans − mapeAvec`, en points de base. Positif = le predicteur
   * ameliore la prevision. C'est ce chiffre, et lui seul, qui decide de
   * `admis`.
   */
  readonly ameliorationBp: number | null;
  /** Le predicteur peut entrer dans le calcul. Faux par defaut : la charge de la preuve lui incombe. */
  readonly admis: boolean;
  /** Motif du refus, affichable tel quel a l'ecran « Qualité du modèle ». `null` si admis. */
  readonly raisonRefus: string | null;
};

/**
 * Valide un predicteur par validation croisee leave-one-out contre le modele
 * qui ne le connait pas.
 *
 * ## Pourquoi comparer seulement les points ou LES DEUX s'estiment
 *
 * Si l'estimateur « avec predicteur » ne s'active que sur une partie des
 * points (predicteur en demarrage a froid sur les autres), comparer son MAPE
 * a celui du modele « sans » calcule sur TOUS les points biaiserait la
 * comparaison dans un sens impredictible — le sous-ensemble ou le predicteur
 * s'active n'est pas forcement representatif du reste. On restreint donc les
 * DEUX mape au meme sous-ensemble de points : c'est la seule comparaison
 * equitable, « pommes contre pommes ».
 *
 * ## Pourquoi une AMELIORATION STRICTE, pas une egalite tolérée
 *
 * `admis = ameliorationBp > 0`, strictement. Un predicteur qui n'apporte
 * RIEN (amelioration nulle, ou negative) ne doit jamais entrer dans le
 * calcul : il ajoute une ligne a la decomposition affichee sans ameliorer la
 * prevision, ce qui est exactement l'inverse de ce que docs/07 §3 demande
 * (« un paramètre qui améliore le score mais rend l'explication illisible
 * n'est pas un progrès net » — a fortiori un paramètre qui n'améliore RIEN).
 *
 * @param minPointsEvalues Sous ce nombre, aucun verdict n'est rendu : un MAPE
 *   mesure sur trois points ne prouve rien, il aurait pu tomber juste par
 *   hasard. Meme principe que `prevision_residus_minimum` deja pose par
 *   `baseline.ts` — refuser de repondre plutot que de mentir sur la
 *   confiance.
 */
export function validerParLeaveOneOut<TContexte>(
  echantillon: readonly TContexte[],
  valeurReelle: (contexte: TContexte) => number,
  estimerSansPredicteur: Estimateur<TContexte>,
  estimerAvecPredicteur: Estimateur<TContexte>,
  minPointsEvalues: number,
): ResultatValidationCroisee {
  const erreursSans: number[] = [];
  const erreursAvec: number[] = [];

  for (let i = 0; i < echantillon.length; i += 1) {
    const cible = echantillon[i]!;
    const reel = valeurReelle(cible);
    // Un reel nul ou non fini rendrait l'erreur relative infinie ou absurde :
    // ce point sort de la mesure, comme `calculerBaseline` ecarte deja les
    // sessions a zero crepe de son propre calcul de residus.
    if (!Number.isFinite(reel) || reel <= 0) continue;

    // Chaque point retire SA PROPRE observation de l'historique — c'est la
    // definition meme du leave-one-out. `toSpliced` n'existe pas encore
    // partout : on filtre par index plutot que par egalite de valeur, qui
    // exclurait a tort deux observations identiques.
    const historique = echantillon.filter((_, index) => index !== i);

    const sans = estimerSansPredicteur(historique, cible);
    const avec = estimerAvecPredicteur(historique, cible);
    // Point retenu seulement si LES DEUX modeles s'estiment : voir le
    // commentaire de fonction sur l'equite de la comparaison.
    if (sans === null || avec === null) continue;
    if (!Number.isFinite(sans) || !Number.isFinite(avec)) continue;

    erreursSans.push(Math.abs(reel - sans) / reel);
    erreursAvec.push(Math.abs(reel - avec) / reel);
  }

  const nbPointsEvalues = erreursSans.length;

  if (nbPointsEvalues < minPointsEvalues) {
    return {
      nbPointsEvalues,
      mapeSansPredicteurBp: null,
      mapeAvecPredicteurBp: null,
      ameliorationBp: null,
      admis: false,
      raisonRefus:
        `Seulement ${nbPointsEvalues} session${nbPointsEvalues > 1 ? 's' : ''} ` +
        `évaluable${nbPointsEvalues > 1 ? 's' : ''} en validation croisée, ` +
        `${minPointsEvalues} nécessaires : pas assez de recul pour juger ce prédicteur.`,
    };
  }

  const moyenne = (valeurs: readonly number[]): number =>
    valeurs.reduce((total, v) => total + v, 0) / valeurs.length;

  const mapeSansBp = Math.round(moyenne(erreursSans) * 10_000);
  const mapeAvecBp = Math.round(moyenne(erreursAvec) * 10_000);
  const ameliorationBp = mapeSansBp - mapeAvecBp;
  const admis = ameliorationBp > 0;

  return {
    nbPointsEvalues,
    mapeSansPredicteurBp: mapeSansBp,
    mapeAvecPredicteurBp: mapeAvecBp,
    ameliorationBp,
    admis,
    raisonRefus: admis
      ? null
      : `Le prédicteur n'améliore pas le MAPE en validation croisée (${(mapeAvecBp / 100).toFixed(2)} % ` +
        `contre ${(mapeSansBp / 100).toFixed(2)} % sans lui) : il reste écarté du calcul.`,
  };
}
