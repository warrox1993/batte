/**
 * Reapprovisionnement automatique : point de commande statistique et arrondi
 * aux conditionnements reels (docs/01 module 2, docs/07 §1.9).
 *
 * Fonctions pures : l'historique de consommation, le stock disponible et le
 * conditionnement de reference sont assembles par l'appelant (le service de
 * `packages/db`) a partir des mouvements et du referentiel. Rien ici ne lit ni
 * n'ecrit en base.
 */

import { ErreurMetier } from './erreurs.js';
import { ecartType } from './prevision/statistiques.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. Profil statistique de consommation
   ═══════════════════════════════════════════════════════════════════════════ */

export type ProfilConsommation = {
  readonly moyenneJournaliere: number;
  readonly ecartTypeJournalier: number;
  readonly nbJoursObserves: number;
};

/**
 * Profil de consommation journaliere d'un ingredient, a partir d'une serie de
 * quantites JOUR CALENDAIRE PAR JOUR CALENDAIRE (et non seulement les jours de
 * production).
 *
 * Les jours sans mouvement de `sortie_production` comptent pour ZERO dans la
 * serie fournie par l'appelant. C'est ce zero qui rend l'ecart-type
 * representatif d'un rythme hebdomadaire (une fournee, six jours a zero) plutot
 * que lisse a tort sur les seuls jours ou il s'est passe quelque chose — sans
 * quoi deux ingredients a la meme consommation moyenne mais a des rythmes tres
 * differents recevraient le meme stock de securite (docs/07 §1.9).
 */
export function profilConsommation(
  quantitesParJourCalendaire: readonly number[],
): ProfilConsommation {
  const nbJoursObserves = quantitesParJourCalendaire.length;
  if (nbJoursObserves === 0) {
    return { moyenneJournaliere: 0, ecartTypeJournalier: 0, nbJoursObserves: 0 };
  }

  const moyenneJournaliere =
    quantitesParJourCalendaire.reduce((somme, v) => somme + v, 0) / nbJoursObserves;

  return {
    moyenneJournaliere,
    ecartTypeJournalier: ecartType(quantitesParJourCalendaire),
    nbJoursObserves,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Point de commande statistique
   ═══════════════════════════════════════════════════════════════════════════ */

export type EntreePointCommande = {
  readonly moyenneJournaliere: number;
  readonly ecartTypeJournalier: number;
  readonly delaiLivraisonJours: number;
  /**
   * Ecart-type du delai de livraison lui-meme, en jours. Aucun historique de
   * date de livraison REELLE n'existe encore dans le modele de donnees : tant
   * qu'il n'existe pas, le delai est traite comme FIXE (`0` par defaut), et le
   * stock de securite ne couvre que la variabilite de la demande. A affiner le
   * jour ou un ecart promis/reel est enregistre par reception.
   */
  readonly ecartTypeDelaiJours?: number;
  /**
   * Coefficient Z du niveau de service vise : 1,28 -> 90 %, 1,65 -> 95 %,
   * 2,33 -> 99 % (docs/07 §1.9). Vient TOUJOURS du parametre
   * `reappro_niveau_service_z`, jamais code en dur ici.
   */
  readonly z: number;
};

export type ResultatPointCommande = {
  /** Consommation attendue pendant le delai de livraison, arrondie a l'entier. */
  readonly consommationPendantDelai: number;
  /** Stock tampon contre la variabilite de la demande (et du delai, si connue). */
  readonly stockSecurite: number;
  readonly pointCommande: number;
};

/**
 * Point de commande STATISTIQUE, pas la formule naive.
 *
 * ```
 * point_commande = consommation_moyenne * delai + stock_securite
 * stock_securite = Z * racine(delai * ecart_type_demande^2
 *                              + consommation_moyenne^2 * ecart_type_delai^2)
 * ```
 *
 * La formule naive (`conso * delai + securite manuelle`) ignore le NIVEAU DE
 * SERVICE atteint : deux ingredients de consommation moyenne identique
 * recevraient le meme stock de securite, que leur demande soit reguliere ou
 * erratique. Ici, un ingredient a consommation irreguliere (ecart-type eleve)
 * recoit mecaniquement plus de stock tampon qu'un ingredient regulier de meme
 * moyenne.
 */
export function calculerPointCommande(entree: EntreePointCommande): ResultatPointCommande {
  if (entree.moyenneJournaliere < 0) {
    throw new ErreurMetier(
      'consommation_invalide',
      `La consommation moyenne journalière ne peut pas être négative (reçu ${entree.moyenneJournaliere}).`,
    );
  }
  if (entree.delaiLivraisonJours < 0) {
    throw new ErreurMetier(
      'delai_invalide',
      `Le délai de livraison ne peut pas être négatif (reçu ${entree.delaiLivraisonJours} jour(s)).`,
    );
  }
  if (entree.z < 0) {
    throw new ErreurMetier(
      'niveau_service_invalide',
      `Le coefficient Z du niveau de service ne peut pas être négatif (reçu ${entree.z}).`,
    );
  }

  const ecartTypeDelaiJours = entree.ecartTypeDelaiJours ?? 0;
  if (ecartTypeDelaiJours < 0) {
    throw new ErreurMetier(
      'ecart_type_delai_invalide',
      `L'écart-type du délai de livraison ne peut pas être négatif (reçu ${ecartTypeDelaiJours}).`,
    );
  }

  const consommationPendantDelai = entree.moyenneJournaliere * entree.delaiLivraisonJours;

  const varianceDemandePendantDelai = entree.delaiLivraisonJours * entree.ecartTypeJournalier ** 2;
  const varianceDelai = entree.moyenneJournaliere ** 2 * ecartTypeDelaiJours ** 2;
  const stockSecurite = Math.round(
    entree.z * Math.sqrt(varianceDemandePendantDelai + varianceDelai),
  );

  const consommationArrondie = Math.round(consommationPendantDelai);

  return {
    consommationPendantDelai: consommationArrondie,
    stockSecurite,
    pointCommande: consommationArrondie + stockSecurite,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Besoin brut
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Quantite qu'il manque pour ramener le stock PROJETE (disponible + deja en
 * commande, non encore recu) au niveau du point de commande.
 *
 * Rend `0` et jamais un nombre negatif : un stock projete deja au-dessus du
 * point de commande ne declenche aucune commande, il ne « rembourse » rien.
 */
export function calculerBesoinBrut(pointCommande: number, stockProjete: number): number {
  return Math.max(0, pointCommande - stockProjete);
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. Arrondi aux conditionnements reels — ORDRE NORMATIF
   ═══════════════════════════════════════════════════════════════════════════ */

export type ModificateursConditionnement = {
  /** Contenance d'un conditionnement, dans l'unite de reference de l'ingredient. */
  readonly conditionnementUniteRef: number;
  /** Plancher impose (ex. contrainte fournisseur). Optionnel : aucun par defaut. */
  readonly quantiteMinimaleUniteRef?: number;
  /** Plafond impose (ex. capacite de stockage). Optionnel : aucun par defaut. */
  readonly quantiteMaximaleUniteRef?: number;
};

export type QuantiteCommande = {
  readonly quantiteUniteRef: number;
  readonly nbConditionnements: number;
};

/**
 * Arrondit un besoin brut a un nombre entier de conditionnements, en
 * appliquant les modificateurs dans l'ORDRE NORMATIF (docs/07 §1.9) :
 *
 * ```
 * 1. reduire au maximum -> 2. augmenter au minimum -> 3. arrondir au conditionnement
 * ```
 *
 * Inverser donne des quantites fausses : on ne commande pas 17 kg quand le sac
 * fait 25 kg, et un plancher fournisseur doit pouvoir l'emporter sur un
 * plafond de stockage mal calibre — jamais l'inverse.
 */
export function arrondirAuConditionnement(
  besoinUniteRef: number,
  modificateurs: ModificateursConditionnement,
): QuantiteCommande {
  if (modificateurs.conditionnementUniteRef <= 0) {
    throw new ErreurMetier(
      'conditionnement_invalide',
      `La contenance d'un conditionnement doit être strictement positive ` +
        `(reçu ${modificateurs.conditionnementUniteRef}).`,
    );
  }

  // 1. Reduire au maximum.
  let quantite =
    modificateurs.quantiteMaximaleUniteRef === undefined
      ? besoinUniteRef
      : Math.min(besoinUniteRef, modificateurs.quantiteMaximaleUniteRef);

  // 2. Augmenter au minimum.
  if (modificateurs.quantiteMinimaleUniteRef !== undefined) {
    quantite = Math.max(quantite, modificateurs.quantiteMinimaleUniteRef);
  }

  if (quantite <= 0) return { quantiteUniteRef: 0, nbConditionnements: 0 };

  // 3. Arrondir AU-DESSUS au multiple du conditionnement : on ne livre jamais
  // moins que le besoin couvert, seulement plus.
  const nbConditionnements = Math.ceil(quantite / modificateurs.conditionnementUniteRef);

  return {
    quantiteUniteRef: nbConditionnements * modificateurs.conditionnementUniteRef,
    nbConditionnements,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Composition — un seul appel pour le service
   ═══════════════════════════════════════════════════════════════════════════ */

export type EntreeBesoinReapprovisionnement = {
  readonly quantitesParJourCalendaire: readonly number[];
  readonly delaiLivraisonJours: number;
  readonly ecartTypeDelaiJours?: number;
  readonly z: number;
  /** Stock disponible + deja en commande ouverte, non encore recu. */
  readonly stockProjete: number;
  readonly conditionnementUniteRef: number;
  readonly quantiteMinimaleUniteRef?: number;
  readonly quantiteMaximaleUniteRef?: number;
};

export type ResultatBesoinReapprovisionnement = {
  readonly profil: ProfilConsommation;
  readonly pointCommande: ResultatPointCommande;
  readonly besoinBrut: number;
  readonly commande: QuantiteCommande;
};

/**
 * Chaine complete : profil de consommation -> point de commande -> besoin brut
 * -> arrondi au conditionnement. Un seul point d'entree pour le service
 * `genererBrouillonsCommandes`, dans le meme esprit que `verifierFaisabilite`
 * pour la production.
 */
export function calculerBesoinReapprovisionnement(
  entree: EntreeBesoinReapprovisionnement,
): ResultatBesoinReapprovisionnement {
  const profil = profilConsommation(entree.quantitesParJourCalendaire);

  const pointCommande = calculerPointCommande({
    moyenneJournaliere: profil.moyenneJournaliere,
    ecartTypeJournalier: profil.ecartTypeJournalier,
    delaiLivraisonJours: entree.delaiLivraisonJours,
    z: entree.z,
    ...(entree.ecartTypeDelaiJours === undefined
      ? {}
      : { ecartTypeDelaiJours: entree.ecartTypeDelaiJours }),
  });

  const besoinBrut = calculerBesoinBrut(pointCommande.pointCommande, entree.stockProjete);

  const commande = arrondirAuConditionnement(besoinBrut, {
    conditionnementUniteRef: entree.conditionnementUniteRef,
    ...(entree.quantiteMinimaleUniteRef === undefined
      ? {}
      : { quantiteMinimaleUniteRef: entree.quantiteMinimaleUniteRef }),
    ...(entree.quantiteMaximaleUniteRef === undefined
      ? {}
      : { quantiteMaximaleUniteRef: entree.quantiteMaximaleUniteRef }),
  });

  return { profil, pointCommande, besoinBrut, commande };
}
