/**
 * Point de départ EFFECTIF d'une session de marché (D-064 point 1).
 *
 * Le porteur a tranché en séance du 30/07/2026 : l'adresse de départ est un
 * PARAMÈTRE (le domicile, catalogue `adresse_depart_defaut`), qui sert de
 * DÉFAUT, et que CHAQUE SESSION peut SURCHARGER quand elle ne part pas de
 * chez soi (`session_marche.point_depart_texte`, migration 0026). Surcharge
 * et non remplacement — la consigne permanente du porteur : le cas courant
 * ne demande aucune saisie, le cas particulier reste possible.
 *
 * ## Ce qui a changé en cours de route
 *
 * D-064 point 2 tenait initialement la distance pour SAISIE À LA MAIN
 * (Google Maps), ce qui rendait cette adresse presque décorative : aucun
 * calcul ne partait jamais d'elle. Le porteur est revenu sur ce point en
 * séance : l'application doit pouvoir calculer les kilomètres SANS son
 * intervention (avec vérification a posteriori). L'adresse de départ passe
 * donc de commodité à PRÉREQUIS — sans elle, aucune distance ne peut être
 * calculée automatiquement, donc aucun coût de déplacement, donc aucun
 * arbitrage entre lieux (`calculerMargeAttendueLieu`, `deplacement.ts`).
 *
 * Ce fichier ne calcule PAS de distance ni de coût : la méthode de calcul
 * (quel service de géocodage/itinéraire, quelles coordonnées) reste
 * À TRANCHER avec le porteur, et CLAUDE.md §7 interdit d'introduire un
 * service externe sans son accord explicite. Il ne fait que résoudre QUEL
 * texte de départ s'applique, et NOMMER pourquoi aucun ne s'applique quand
 * c'est le cas — pour que l'écran dise au porteur quoi saisir plutôt que de
 * lui montrer un tiret muet.
 *
 * Fichier neuf et non `deplacement.ts` : cet agent a `point-depart.ts` pour
 * zone d'écriture exclusive pendant qu'un autre agent modifie
 * `deplacement.ts` en parallèle sur la même fiche (D-064).
 */

/**
 * `''` (chaîne vide) et les blancs valent « non renseigné », jamais une
 * adresse. Une valeur de paramètre de type `texte` est TOUJOURS une chaîne
 * (jamais SQL `NULL`, contrairement à une colonne) : c'est cette fonction
 * qui traduit « vide » en `null`, au sens métier du terme — exactement la
 * même règle que pour une colonne, énoncée autrement.
 */
function texteRenseigneOuNull(valeur: string | null | undefined): string | null {
  if (valeur === null || valeur === undefined) return null;
  const nettoye = valeur.trim();
  return nettoye === '' ? null : nettoye;
}

export type ResultatPointDepartSession = {
  /** Le point de départ effectif de cette session, ou `null` si inconnu des deux côtés. */
  readonly texte: string | null;
  /**
   * Raison NOMMÉE quand `texte` est `null` — jamais un simple silence.
   * Dit explicitement au porteur QUOI saisir pour débloquer un calcul de
   * coût de déplacement, pas seulement qu'un chiffre manque.
   */
  readonly raisonIndisponible: string | null;
};

/**
 * Résout le point de départ EFFECTIF d'une session : celui de la session
 * s'il est renseigné, sinon l'adresse de domicile en paramètre
 * (`adresse_depart_defaut`). `null` des deux côtés reste `null` — « on ne
 * sait pas d'où on est parti » est une réponse, pas un vide à combler.
 *
 * La précédence est celle de D-064 point 1 : la session prime toujours sur
 * le défaut, jamais l'inverse. Une chaîne vide ou faite uniquement de blancs
 * compte comme absente des deux côtés (voir `texteRenseigneOuNull`).
 */
export function resoudrePointDepartSession(entrees: {
  readonly pointDepartTexteSession: string | null;
  readonly adresseDepartDefautParametre: string | null;
}): ResultatPointDepartSession {
  const pointDepartSession = texteRenseigneOuNull(entrees.pointDepartTexteSession);
  if (pointDepartSession !== null) {
    return { texte: pointDepartSession, raisonIndisponible: null };
  }

  const adresseDefaut = texteRenseigneOuNull(entrees.adresseDepartDefautParametre);
  if (adresseDefaut !== null) {
    return { texte: adresseDefaut, raisonIndisponible: null };
  }

  return {
    texte: null,
    raisonIndisponible:
      "Adresse de départ non renseignée : le coût de déplacement n'est pas calculable.",
  };
}
