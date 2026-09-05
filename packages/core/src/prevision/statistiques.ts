/**
 * Outils statistiques du moteur de prevision.
 *
 * Deliberement minimalistes et deterministes : meme entree, meme sortie
 * (docs/03, avertissement — la reproductibilite est indispensable au
 * backtesting). Aucune dependance externe, aucun appel reseau.
 */

/**
 * Quantile de la loi normale centree reduite.
 *
 * Approximation rationnelle d'Acklam. Erreur MESUREE contre une reference
 * haute precision (fonction gamma incomplete, ~1e-15) sur la plage que ce
 * module utilise reellement, p ∈ [0,01 ; 0,999] : erreur absolue maximale
 * 2,9e-9, erreur relative maximale 1,1e-9 — conforme a la borne publiee par
 * Acklam. Traduit en crepes sur la session type (mediane 134, sigma 0,35,
 * ratio critique 0,926), cela represente 1,2e-7 crepe : l'approximation n'est
 * PAS une source d'erreur pour ce projet.
 *
 * Un raccord subsiste en p = 0,02425 et p = 0,97575, ou les deux branches
 * rationnelles different d'environ 4,5e-9. Sans consequence ici : aucun seuil
 * de decision ne s'appuie sur ces deux points.
 */
export function quantileNormal(probabilite: number): number {
  if (probabilite <= 0 || probabilite >= 1) {
    throw new RangeError(`Probabilite hors ]0,1[ : ${probabilite}`);
  }

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pBas = 0.02425;
  const pHaut = 1 - pBas;

  if (probabilite < pBas) {
    const q = Math.sqrt(-2 * Math.log(probabilite));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }

  if (probabilite > pHaut) {
    const q = Math.sqrt(-2 * Math.log(1 - probabilite));
    return (
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }

  const q = probabilite - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/**
 * Fonction de repartition de la loi normale centree reduite, Φ(z).
 *
 * Algorithme de Hart, dans la forme publiee par West : erreur absolue mesuree
 * 2,0e-14 sur [-8 ; 8] contre la meme reference que `quantileNormal`.
 *
 * Elle n'existe que pour `ventesEsperees` : sans elle, le manque a gagner d'un
 * ecretage ne peut pas etre calcule autrement qu'en supposant que TOUTE crepe
 * non produite aurait ete vendue — hypothese fausse par construction, puisque
 * l'ecretage retire d'abord les crepes du haut de la distribution, celles qui
 * ne se vendent que les tres bons jours.
 */
export function repartitionNormale(z: number): number {
  const absolu = Math.abs(z);
  let queue: number;

  if (absolu > 37) {
    // Au-dela, Φ vaut 0 ou 1 a la precision du double : inutile d'evaluer.
    queue = 0;
  } else {
    const densite = Math.exp((-absolu * absolu) / 2);
    if (absolu < 7.071_067_811_865_47) {
      let numerateur = 3.526_249_659_989_11e-2 * absolu + 0.700_383_064_443_688;
      numerateur = numerateur * absolu + 6.373_962_203_531_65;
      numerateur = numerateur * absolu + 33.912_866_078_383;
      numerateur = numerateur * absolu + 112.079_291_497_871;
      numerateur = numerateur * absolu + 221.213_596_169_931;
      numerateur = numerateur * absolu + 220.206_867_912_376;

      let denominateur = 8.838_834_764_831_84e-2 * absolu + 1.755_667_163_182_64;
      denominateur = denominateur * absolu + 16.064_177_579_207;
      denominateur = denominateur * absolu + 86.780_732_202_946_1;
      denominateur = denominateur * absolu + 296.564_248_779_674;
      denominateur = denominateur * absolu + 637.333_633_378_831;
      denominateur = denominateur * absolu + 793.826_512_519_948;
      denominateur = denominateur * absolu + 440.413_735_824_752;

      queue = (densite * numerateur) / denominateur;
    } else {
      // Fraction continue dans la queue lointaine, ou la forme rationnelle
      // ci-dessus perd sa precision.
      let fraction = absolu + 0.65;
      fraction = absolu + 4 / fraction;
      fraction = absolu + 3 / fraction;
      fraction = absolu + 2 / fraction;
      fraction = absolu + 1 / fraction;
      queue = densite / (fraction * 2.506_628_274_631);
    }
  }

  return z > 0 ? 1 - queue : queue;
}

/**
 * Quantile d'une loi LOG-normale de mediane `mediane` et d'ecart-type log `sigma`.
 *
 * La demande est modelisee en log-normal et non en normal pour deux raisons :
 * elle ne peut pas etre negative, et sa dispersion est multiplicative — une
 * mauvaise journee divise les ventes, elle ne leur soustrait pas un nombre fixe.
 *
 * `mediane` est bien la MEDIANE, pas la moyenne. Pour une log-normale les deux
 * different d'un facteur exp(sigma²/2) — 6,3 % a sigma = 0,35 — et les
 * confondre decale TOUS les quantiles du meme facteur (voir
 * `medianeDepuisEsperance`).
 */
export function quantileLogNormal(mediane: number, sigma: number, probabilite: number): number {
  // Un sigma non fini traversait tout le moteur sans jamais lever : p10, p50,
  // p90 et la recommandation ressortaient en `NaN` ou `Infinity`, et l'ecran
  // affichait « NaN crêpes ». Meme famille que D-034 — une comparaison `<= 0`
  // ne rejette pas `NaN`.
  if (!Number.isFinite(sigma)) {
    throw new RangeError(`Ecart-type log non fini : ${sigma}`);
  }
  if (!Number.isFinite(mediane) || mediane <= 0) return 0;
  if (sigma <= 0) return mediane;
  return mediane * Math.exp(sigma * quantileNormal(probabilite));
}

/**
 * Mediane d'une log-normale dont on connait l'ESPERANCE.
 *
 * POURQUOI CETTE FONCTION EXISTE. `calculerBaseline` produit une moyenne
 * arithmetique ponderee des observations normalisees : c'est un estimateur de
 * l'ESPERANCE des ventes, E[D]. Le moteur s'en servait ensuite directement
 * comme MEDIANE de la log-normale. Or pour une log-normale
 * E[D] = mediane × exp(sigma²/2), donc prendre l'esperance pour la mediane
 * gonfle p10, p50, p90 ET la recommandation du meme facteur : +6,3 % a
 * sigma = 0,35, +2,0 % a sigma = 0,20.
 *
 * Sur la session type (esperance 134 crepes, sigma 0,35, ratio critique 0,926)
 * cela faisait produire 223 crepes au lieu de 209 : 13 crepes de trop chaque
 * dimanche, soit ≈ 3,30 € de pate jetee par marche.
 */
export function medianeDepuisEsperance(esperance: number, sigma: number): number {
  if (!Number.isFinite(esperance) || esperance <= 0) return 0;
  if (!Number.isFinite(sigma) || sigma <= 0) return esperance;
  return esperance * Math.exp((-sigma * sigma) / 2);
}

/**
 * Ventes esperees quand on produit `quantite` : E[min(D, quantite)].
 *
 * Autrement dit : combien de crepes se vendront REELLEMENT si l'on en produit
 * `quantite`. On ne vend jamais plus que la demande, ni plus que ce qu'on a
 * produit — d'ou le minimum des deux.
 *
 * Forme fermee de la log-normale, verifiee contre une integration numerique de
 * la fonction de survie (accord a 1e-8) :
 *
 *     E[min(D,Q)] = m·exp(σ²/2)·Φ((ln(Q/m) − σ²)/σ) + Q·(1 − Φ(ln(Q/m)/σ))
 */
export function ventesEsperees(quantite: number, mediane: number, sigma: number): number {
  if (!Number.isFinite(quantite) || quantite <= 0) return 0;
  if (!Number.isFinite(mediane) || mediane <= 0) return 0;
  // Sans dispersion, la demande vaut exactement la mediane : on vend le
  // minimum des deux, sans integrale.
  if (!Number.isFinite(sigma) || sigma <= 0) return Math.min(quantite, mediane);

  const ecartLog = Math.log(quantite / mediane) / sigma;
  return (
    mediane * Math.exp((sigma * sigma) / 2) * repartitionNormale(ecartLog - sigma) +
    quantite * (1 - repartitionNormale(ecartLog))
  );
}

/**
 * Ecart-type log correspondant a un coefficient de variation donne.
 *
 * docs/03 fixe l'incertitude de demarrage par un « coefficient de variation
 * prior 0,35 », pas par un ecart-type log. Pour une log-normale les deux ne
 * sont pas la meme grandeur : CV = √(exp(σ²) − 1), donc CV = 0,35 correspond a
 * σ = 0,3400, pas a 0,35. Le parametre s'appelle `prevision_cv_prior_bp` : il
 * doit etre CONVERTI, pas injecte tel quel dans un exponentielle.
 *
 * Ce n'est pas un coefficient metier, c'est un changement d'unite — d'ou sa
 * place ici et non au catalogue (D-041).
 */
export function sigmaDepuisCoefficientVariation(coefficientVariation: number): number {
  if (!Number.isFinite(coefficientVariation) || coefficientVariation <= 0) return 0;
  return Math.sqrt(Math.log(1 + coefficientVariation * coefficientVariation));
}

/** Ecart-type d'un echantillon (estimateur non biaise). Rend 0 sous 2 valeurs. */
export function ecartType(valeurs: readonly number[]): number {
  if (valeurs.length < 2) return 0;
  const moyenne = valeurs.reduce((somme, v) => somme + v, 0) / valeurs.length;
  const variance =
    valeurs.reduce((somme, v) => somme + (v - moyenne) ** 2, 0) / (valeurs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Ratio critique du modele du vendeur de journaux.
 *
 * `Cu` = marge perdue par rupture, `Co` = cout d'une unite invendue.
 * C'est LE calcul le plus rentable du projet : le desequilibre entre les deux
 * est enorme (3,15 € contre 0,25 €), et l'intuition va dans le mauvais sens —
 * on craint le gaspillage visible alors que le vrai cout est la vente manquee,
 * invisible (docs/03, decision D-006).
 *
 * Les deux couts viennent des DONNEES REELLES de l'application, jamais de
 * constantes : prix de vente moyen pondere par le mix, CUMP courant.
 */
export function ratioCritique(coutRuptureCents: number, coutInvenduCents: number): number | null {
  // `null` et non 0,5 : renvoyer 0,5 revenait a recommander LA MEDIANE, que
  // docs/03 interdit explicitement de produire. Un cout absent n'est pas un
  // arbitrage equilibre, c'est une donnee manquante — a l'appelant de choisir
  // son repli (le parametre `quantile_cible_production_bp` existe pour ca).
  //
  // Les deux couts doivent etre STRICTEMENT positifs. Avec un cout d'invendu a
  // zero, le ratio valait exactement 1, et `quantileNormal(1)` levait une
  // `RangeError` non traduite : ecran « Prochaine session » en erreur 500 sur
  // une installation neuve, ou aucune reception n'a encore fixe de prix.
  if (!Number.isFinite(coutRuptureCents) || !Number.isFinite(coutInvenduCents)) return null;
  if (coutRuptureCents <= 0 || coutInvenduCents <= 0) return null;

  const ratio = coutRuptureCents / (coutRuptureCents + coutInvenduCents);

  // Deux couts strictement positifs ne SUFFISENT pas a garantir un ratio
  // strictement interieur a ]0,1[ : avec Cu = 1e16 et Co = 1, la somme est
  // arrondie a Cu en double precision et le ratio vaut exactement 1, ce qui
  // relance la `RangeError` que D-034 avait fermee par l'autre porte. On teste
  // donc le RESULTAT, pas seulement les entrees.
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return null;

  return ratio;
}
