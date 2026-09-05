/**
 * Moteur de succès (fiche `docs/demandes/18-SUCCES-NIVEAUX-ET-OBJECTIFS.md`).
 *
 * Règle d'architecture n°1 de la fiche (§5.1, application directe de
 * CLAUDE.md §3 règle 5 — « le stock ne se modifie que par un mouvement ») :
 * **un succès est une VUE, jamais un état stocké.** Chaque fonction ici est
 * pure et recalcule tout depuis une série d'événements déjà lue en base.
 * Rien n'est persisté nulle part, pas même une date de déblocage : elle est
 * elle-même RECALCULÉE à chaque appel, en rejouant la série chronologique
 * fournie. C'est délibéré et strictement mieux que stocker cette date :
 * si une session est annulée après coup, la série change, et la date de
 * déblocage change avec elle — jamais un badge acquis à tort qui survivrait
 * à la donnée qui l'avait justifié.
 *
 * §5.2 : « les succès se débloquent rétroactivement ». Concrètement, un
 * palier est débloqué à la date du DERNIER événement de la première série
 * de l'historique qui atteint sa longueur requise — pas forcément la série
 * la plus récente. Une fois obtenu quelque part dans l'historique, un palier
 * reste acquis, sauf si une correction ultérieure des données (une
 * annulation qui retire un événement de la série) invalide la série qui
 * l'avait produit — exactement le sens de « le succès reste vrai au
 * recalcul » (§5.1).
 */

import { ratioEnPointsDeBase, type PointsDeBase } from './argent.js';
import { joursEntre } from './horodatage.js';
import { depassementProjete, projeterSeuil } from './sessions.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Paliers en série (streak) — marge, gaspillage, prévision, AFSCA, coût
   ═══════════════════════════════════════════════════════════════════════════ */

/** Un point de la série chronologique, déjà réduit à un booléen de réussite. */
export type EvenementSerie = {
  /** Jour civil ou instant ISO — sert uniquement à DATER un déblocage. */
  readonly date: string;
  readonly reussite: boolean;
};

export type PalierSerie = {
  readonly niveau: number;
  readonly longueurRequise: number;
  readonly libelle: string;
};

export type ResultatPalierSerie = {
  readonly niveau: number;
  readonly libelle: string;
  readonly longueurRequise: number;
  /** Date du dernier événement de la première série qualifiante. `null` = jamais atteint. */
  readonly debloqueLe: string | null;
};

export type ResultatSerie = {
  readonly paliers: readonly ResultatPalierSerie[];
  /** Plus longue série JAMAIS observée dans l'historique fourni. */
  readonly meilleureSerieLongueur: number;
  /** Longueur de la série EN COURS, comptée depuis le dernier événement fourni. */
  readonly serieActuelleLongueur: number;
};

/**
 * Évalue une liste de paliers de série contre une suite d'événements.
 *
 * @param evenements DOIT être trié chronologiquement CROISSANT par l'appelant
 *   — cette fonction ne trie rien, une série n'a de sens que dans l'ordre où
 *   elle s'est produite.
 */
export function evaluerPaliersSerie(
  evenements: readonly EvenementSerie[],
  paliers: readonly PalierSerie[],
): ResultatSerie {
  const paliersTries = [...paliers].sort((a, b) => a.longueurRequise - b.longueurRequise);
  const debloqueLe = new Map<number, string>();
  let meilleureSerieLongueur = 0;
  let courante = 0;

  for (const evenement of evenements) {
    courante = evenement.reussite ? courante + 1 : 0;
    if (courante > meilleureSerieLongueur) meilleureSerieLongueur = courante;

    for (const palier of paliersTries) {
      if (courante >= palier.longueurRequise && !debloqueLe.has(palier.niveau)) {
        debloqueLe.set(palier.niveau, evenement.date);
      }
    }
  }

  return {
    paliers: paliersTries.map((p) => ({
      niveau: p.niveau,
      libelle: p.libelle,
      longueurRequise: p.longueurRequise,
      debloqueLe: debloqueLe.get(p.niveau) ?? null,
    })),
    meilleureSerieLongueur,
    serieActuelleLongueur: courante,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Niveaux (chiffre d'affaires cumulé, ancienneté active)
   ═══════════════════════════════════════════════════════════════════════════ */

export type PalierNiveau = {
  readonly niveau: number;
  readonly seuil: number;
  readonly libelle: string;
};

export type ResultatNiveau = {
  readonly niveauActuel: number;
  readonly libelleNiveauActuel: string | null;
  readonly valeurActuelle: number;
  /** `null` quand le dernier palier est déjà dépassé. */
  readonly prochainPalier: PalierNiveau | null;
  /** Points de base vers le prochain palier. `null` sans prochain palier. */
  readonly progressionVersProchainBp: PointsDeBase | null;
};

/** `paliers` peut être fourni dans n'importe quel ordre : trié ici sur `seuil`. */
export function evaluerNiveau(
  valeurActuelle: number,
  paliers: readonly PalierNiveau[],
): ResultatNiveau {
  const tries = [...paliers].sort((a, b) => a.seuil - b.seuil);

  let atteint: PalierNiveau | null = null;
  let prochain: PalierNiveau | null = null;
  for (const palier of tries) {
    if (valeurActuelle >= palier.seuil) {
      atteint = palier;
    } else {
      prochain = palier;
      break;
    }
  }

  return {
    niveauActuel: atteint?.niveau ?? 0,
    libelleNiveauActuel: atteint?.libelle ?? null,
    valeurActuelle,
    prochainPalier: prochain,
    progressionVersProchainBp:
      prochain === null ? null : ratioEnPointsDeBase(valeurActuelle, prochain.seuil),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Anticipation d'un seuil légal — fiche §2.1 : « un succès mérite aussi
   d'être décerné pour la préparation ». Pas le montant qu'on félicite, mais
   le fait de ne pas avoir été surpris par le changement de régime.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Un point de la trajectoire annuelle vers un seuil légal, dans l'ORDRE des sessions. */
export type PointHistoriqueSeuil = {
  readonly date: string;
  /** Cumul du CA (ou de l'assiette pertinente) réalisé jusqu'à cette session incluse. */
  readonly cumulRealiseCents: number;
  /** Nombre de sessions clôturées comptées jusqu'à cette session incluse. */
  readonly sessionsTenues: number;
};

export type ResultatAnticipationSeuil = {
  readonly cle: string;
  readonly libelle: string;
  /** Date à laquelle le cumul réalisé a effectivement atteint le plafond. `null` si jamais franchi. */
  readonly dateFranchissementReel: string | null;
  /** Date à laquelle la PROJECTION (au rythme d'alors) annonçait déjà le dépassement. */
  readonly datePremiereAlerte: string | null;
  /** Jours d'avance de l'alerte sur le franchissement réel. `null` si l'un des deux manque. */
  readonly joursAnticipation: number | null;
};

/**
 * Rejoue une trajectoire annuelle et mesure de combien de jours la
 * projection (`projeterSeuil` / `depassementProjete`, déjà utilisées par le
 * tableau des seuils légaux) a anticipé le franchissement réel.
 *
 * @param serie Trié chronologiquement croissant par l'appelant : une session
 *   par ligne, cumul déjà calculé jusqu'à elle.
 */
export function evaluerAnticipationSeuil(entree: {
  readonly cle: string;
  readonly libelle: string;
  readonly serie: readonly PointHistoriqueSeuil[];
  readonly plafondCents: number;
  readonly sessionsPrevuesDansLAnnee: number;
}): ResultatAnticipationSeuil {
  let dateFranchissementReel: string | null = null;
  let datePremiereAlerte: string | null = null;

  for (const point of entree.serie) {
    if (dateFranchissementReel === null && point.cumulRealiseCents >= entree.plafondCents) {
      dateFranchissementReel = point.date;
    }
    if (datePremiereAlerte === null) {
      const compteur = projeterSeuil({
        cle: entree.cle,
        libelle: entree.libelle,
        realiseCents: point.cumulRealiseCents,
        plafondCents: entree.plafondCents,
        sessionsTenues: point.sessionsTenues,
        sessionsPrevuesDansLAnnee: entree.sessionsPrevuesDansLAnnee,
      });
      if (depassementProjete(compteur)) datePremiereAlerte = point.date;
    }
  }

  const joursAnticipation =
    dateFranchissementReel !== null && datePremiereAlerte !== null
      ? joursEntre(datePremiereAlerte, dateFranchissementReel)
      : null;

  return {
    cle: entree.cle,
    libelle: entree.libelle,
    dateFranchissementReel,
    datePremiereAlerte,
    joursAnticipation,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Calendrier — trimestre civil, pour le succès « coût de revient en baisse »
   ═══════════════════════════════════════════════════════════════════════════ */

/** « 2026-07-28 » -> « 2026-T3 » (T1 janv-mars, T2 avr-juin, T3 juil-sept, T4 oct-déc). */
export function trimestreCivil(jourCivil: string): string {
  const annee = jourCivil.slice(0, 4);
  const mois = Number.parseInt(jourCivil.slice(5, 7), 10);
  const trimestre = Math.ceil(mois / 3);
  return `${annee}-T${trimestre}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Constantes de configuration.
   ═══════════════════════════════════════════════════════════════════════════
   Ce sont des choix de JEU (longueur de série, tolérance, paliers) — pas des
   valeurs métier réglementaires ou matières au sens de CLAUDE.md §6 (celles-là
   vivent déjà toutes dans `parametre`, et le sont restées ici : aucun seuil
   légal n'est recopié plus bas, voir `PALIERS_NIVEAU_CA`). Elles pourraient
   néanmoins migrer vers `parametre` si le porteur le souhaite ; `parametres.ts`
   est hors zone d'écriture de l'agent qui a livré ce module — voir le rapport
   de livraison. */

/** 300 € : l'ordre de grandeur d'une demi-session (CLAUDE.md §6 : ~838 €/session). */
export const SEUIL_MARGE_NETTE_SERIE_CENTS = 30_000;

/** 10 %, l'exemple même de la fiche §3 (« écart prévision/réel sous 10 % »). */
export const TOLERANCE_ECART_PREVISION_SERIE_BP: PointsDeBase = 1_000;

export const PALIERS_MARGE_SERIE: readonly PalierSerie[] = [
  { niveau: 1, longueurRequise: 3, libelle: 'Trois sessions solides d’affilée' },
  { niveau: 2, longueurRequise: 5, libelle: 'Cinq sessions solides d’affilée' },
  { niveau: 3, longueurRequise: 10, libelle: 'Dix sessions solides d’affilée' },
];

export const PALIERS_GASPILLAGE_SERIE: readonly PalierSerie[] = [
  { niveau: 1, longueurRequise: 3, libelle: 'Trois sessions sans invendu' },
  { niveau: 2, longueurRequise: 5, libelle: 'Cinq sessions sans invendu' },
  { niveau: 3, longueurRequise: 10, libelle: 'Dix sessions sans invendu' },
];

export const PALIERS_PREVISION_SERIE: readonly PalierSerie[] = [
  { niveau: 1, longueurRequise: 3, libelle: 'Trois prévisions justes d’affilée' },
  { niveau: 2, longueurRequise: 5, libelle: 'Cinq prévisions justes d’affilée' },
  { niveau: 3, longueurRequise: 10, libelle: 'Dix prévisions justes d’affilée' },
];

/** Longueurs en SESSIONS (rythme hebdomadaire habituel), pas en semaines civiles. */
export const PALIERS_AFSCA_SERIE: readonly PalierSerie[] = [
  { niveau: 1, longueurRequise: 4, libelle: 'Un mois de relevés sans trou' },
  { niveau: 2, longueurRequise: 8, libelle: 'Deux mois de relevés sans trou' },
  { niveau: 3, longueurRequise: 12, libelle: 'Trois mois de relevés sans trou' },
];

export const PALIERS_COUT_REVIENT_SERIE: readonly PalierSerie[] = [
  { niveau: 1, longueurRequise: 1, libelle: 'Coût matière en baisse sur le trimestre' },
  {
    niveau: 2,
    longueurRequise: 2,
    libelle: 'Coût matière en baisse sur deux trimestres d’affilée',
  },
  {
    niveau: 3,
    longueurRequise: 4,
    libelle: 'Coût matière en baisse sur quatre trimestres d’affilée',
  },
];

export const JOURS_ANTICIPATION_PALIERS: readonly PalierNiveau[] = [
  { niveau: 1, seuil: 30, libelle: 'Anticipé d’un mois' },
  { niveau: 2, seuil: 60, libelle: 'Anticipé de deux mois' },
  { niveau: 3, seuil: 90, libelle: 'Anticipé de trois mois' },
];

/**
 * Paliers de CA CUMULÉ (lifetime), en centimes — des ronds de jeu, jamais un
 * seuil légal : CLAUDE.md §6 interdit de coder en dur un seuil réglementaire,
 * et la fiche §2.1 exige qu'un palier de CA ne s'affiche JAMAIS seul. C'est
 * pourquoi ce module n'y mêle aucune des valeurs de `parametre`
 * (`seuil_franchise_tva_cents`, etc.) : le contexte réglementaire est calculé
 * À CÔTÉ, en direct, par `packages/db/src/depots/objectifs.ts`
 * (`tableauSeuils`, déjà exporté par `@batte/db`), jamais recopié ici où il
 * pourrait devenir périmé si le paramètre change.
 */
export const PALIERS_NIVEAU_CA: readonly PalierNiveau[] = [
  { niveau: 1, seuil: 100_000, libelle: 'Premier millier cumulé' },
  { niveau: 2, seuil: 500_000, libelle: 'Cinq mille euros cumulés' },
  { niveau: 3, seuil: 1_000_000, libelle: 'Dix mille euros cumulés' },
  { niveau: 4, seuil: 2_000_000, libelle: 'Vingt mille euros cumulés' },
  { niveau: 5, seuil: 5_000_000, libelle: 'Cinquante mille euros cumulés' },
  { niveau: 6, seuil: 10_000_000, libelle: 'Cent mille euros cumulés' },
  { niveau: 7, seuil: 20_000_000, libelle: 'Deux cent mille euros cumulés' },
];

export const PALIERS_NIVEAU_ANCIENNETE: readonly PalierNiveau[] = [
  { niveau: 1, seuil: 5, libelle: 'Cinq sessions tenues' },
  { niveau: 2, seuil: 10, libelle: 'Dix sessions tenues' },
  { niveau: 3, seuil: 25, libelle: 'Vingt-cinq sessions tenues' },
  { niveau: 4, seuil: 50, libelle: 'Cinquante sessions tenues' },
  { niveau: 5, seuil: 100, libelle: 'Cent sessions tenues' },
  { niveau: 6, seuil: 200, libelle: 'Deux cents sessions tenues' },
];
