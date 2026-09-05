/**
 * Lectures pour la comparaison des lieux par marge nette attendue
 * (docs/demandes/13-COUT-COMPLET-ET-ARBITRAGE-ENTRE-LIEUX.md).
 *
 * Même règle que `packages/db/src/depots/previsions.ts` (dont ce fichier
 * réutilise les lectures existantes — `observationsDuLieu`, `coutsNewsvendor`,
 * `lireParametres` — sans y toucher, hors zone d'écriture de cet agent) :
 * AUCUN calcul métier ici, uniquement des lectures. La composition (marge
 * nette attendue, coût kilométrique retenu) vit dans
 * `packages/core/src/deplacement.ts`, appelée par
 * `apps/api/src/routes/lieux-rentabilite.ts`.
 */

import type { MesureCoutVehicule } from '@batte/core';
import { and, eq, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { lieuMarche, sessionMarche } from '../schema.js';
import { mesureCarburant } from './comptabilite.js';

export type LieuPourRentabilite = {
  readonly lieuId: string;
  readonly lieuNom: string;
  readonly distanceKm: number | null;
  readonly tarifEmplacementCents: number | null;
  readonly modeTarification: 'metre_lineaire_mois' | 'jour' | 'forfait' | null;
};

/**
 * Lieux ACTIFS uniquement : un lieu retiré (`actif = false`) n'est pas un
 * candidat de marché futur, donc pas une ligne de cette comparaison.
 */
export function lieuxActifsPourRentabilite(base: BaseBatte): LieuPourRentabilite[] {
  return base
    .select({
      lieuId: lieuMarche.id,
      lieuNom: lieuMarche.nom,
      distanceKm: lieuMarche.distanceKm,
      tarifEmplacementCents: lieuMarche.tarifEmplacementCents,
      modeTarification: lieuMarche.modeTarification,
    })
    .from(lieuMarche)
    .where(eq(lieuMarche.actif, true))
    .orderBy(lieuMarche.nom)
    .all();
}

export type CoutGazMoyen = {
  readonly cents: number;
  readonly mesure: boolean;
};

/**
 * Coût gaz moyen par crêpe PRODUITE, mesuré sur TOUTES les sessions closes,
 * tous lieux confondus.
 *
 * GLOBAL et non par lieu, délibérément : la consommation de gaz dépend de ce
 * qui est cuit, pas de l'endroit où on le cuit — aucune donnée du modèle
 * actuel ne permet de distinguer les deux (l'électricité, elle, EST un
 * attribut du lieu depuis D-055, mais rien n'indique aujourd'hui qu'elle s'y
 * substitue pour la cuisson). Sessions `exclure_du_modele` écartées : une
 * panne de gaz n'apprend rien sur la consommation NORMALE — même filtre que
 * `observationsDuLieu` (`depots/previsions.ts`).
 *
 * `mesure: false` quand aucune session close n'a encore produit de crêpe,
 * plutôt qu'un coût inventé — même principe de repli que `coutMatiereParCrepe`
 * (privée à `depots/previsions.ts`, dupliquée en esprit mais pas en code ici
 * puisque non exportée).
 */
export function coutGazMoyenParCrepe(base: BaseBatte): CoutGazMoyen {
  const resultat = base
    .select({
      gaz: sql<number>`COALESCE(SUM(${sessionMarche.fraisGazCents}), 0)`,
      crepes: sql<number>`COALESCE(SUM(${sessionMarche.crepesProduites}), 0)`,
    })
    .from(sessionMarche)
    .where(and(eq(sessionMarche.statut, 'cloturee'), eq(sessionMarche.exclureDuModele, false)))
    .get();

  if (resultat === undefined || resultat.crepes <= 0) return { cents: 0, mesure: false };
  return { cents: Math.round(resultat.gaz / resultat.crepes), mesure: true };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Coût kilométrique MESURÉ — voie B de la fiche 13 §3.1
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Mesure du coût kilométrique OBSERVÉ, matière première de
 * `coutKilometriqueRetenu` (`@batte/core`) : les frais réels du véhicule,
 * divisés par les kilomètres réellement parcourus.
 *
 * Deux populations, cumulées GLOBALEMENT depuis le début — même parti pris
 * que `coutGazMoyenParCrepe` ci-dessus, pas une fenêtre glissante qui
 * ajouterait un paramètre de plus pour une précision que rien ne justifie
 * encore :
 *
 *  - les dépenses de carburant viennent de `mesureCarburant`
 *    (`depots/comptabilite.ts`, qui possède déjà la table `depense`) — voir
 *    son commentaire pour ce qui est délibérément exclu (pneus, entretien :
 *    aucune catégorie dédiée) ;
 *  - les kilomètres parcourus n'ont NULLE PART de compteur ou d'odomètre saisi
 *    (aucune colonne de ce type n'existe, et en ajouter une est hors zone
 *    d'écriture de cet agent — schema.ts est réservé au porteur). On les
 *    DÉDUIT donc des sessions déjà CLOSES : `2 × lieu.distance_km` pour
 *    chaque session dont le lieu a une distance CONFIRMÉE — exactement le
 *    même calcul que `coutDeplacementSessionCents`. C'est la seule mesure de
 *    kilométrage déjà présente dans le modèle de données, et elle correspond
 *    précisément aux trajets pour lesquels le carburant ci-dessus a été
 *    acheté. Un lieu sans distance confirmée ne contribue simplement rien
 *    (jamais une distance devinée) — les sessions ANNULÉES ou seulement
 *    PLANIFIÉES n'ont occasionné aucun trajet et sont donc exclues.
 */
export function mesureCoutVehicule(base: BaseBatte): MesureCoutVehicule {
  const carburant = mesureCarburant(base);

  const sessionsClosesAvecLieu = base
    .select({ distanceKm: lieuMarche.distanceKm })
    .from(sessionMarche)
    .innerJoin(lieuMarche, eq(sessionMarche.lieuId, lieuMarche.id))
    .where(eq(sessionMarche.statut, 'cloturee'))
    .all();

  const totalKmParcourus = sessionsClosesAvecLieu.reduce(
    (somme, s) => somme + (s.distanceKm === null ? 0 : s.distanceKm * 2),
    0,
  );

  return {
    totalDepensesCarburantCents: carburant.totalCents,
    nbPleins: carburant.nbPleins,
    totalKmParcourus,
  };
}
