/**
 * Lecture des entrees du moteur de prevision et archivage des resultats.
 *
 * Le moteur lui-meme est pur (`packages/core/src/prevision`). Ce depot lui
 * fournit ce qu'il ne peut pas connaitre : l'historique, les couts REELS et les
 * evenements. Aucun calcul de prevision ici — uniquement des lectures.
 */

import {
  BASE_POINTS,
  ErreurMetier,
  ageJours,
  ajouterJours,
  facteurMeteo,
  jourCivilBelge,
  maintenantUtc,
  nouvelIdentifiant,
  occurrencesJourSemaine,
  quantiteDisponible,
  ratioEnPointsDeBase,
  type ConditionsMeteo,
  type ObservationEcoulement,
  type ObservationSession,
  type PaireMeteo,
  type Parametres,
  type PeriodeVacances,
  type PointsDeBase,
  type ResultatPrevision,
  type Unite,
} from '@batte/core';
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  commandeFournisseur,
  commandeLigne,
  evenement,
  ingredient,
  lieuMarche,
  meteoObservation,
  mouvementStock,
  prevision,
  production,
  produitVente,
  recette,
  sessionMarche,
  sessionVente,
} from '../schema.js';
import { lireParametres } from './parametres.js';
import { listerRecettes } from './recettes.js';
import { lotsDeLIngredient } from './stock.js';

/**
 * Generation de l'algorithme, archivee avec chaque prevision.
 *
 * Sans elle, comparer l'erreur de janvier a celle de juin revient a comparer
 * deux modeles differents en croyant en mesurer un seul.
 */
export const VERSION_MODELE = 'multiplicatif-newsvendor-1';

/* ═══════════════════════════════════════════════════════════════════════════
   Facteurs historiques
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Dernier releve meteo EXPLOITABLE par date, pour un lieu — conditions brutes,
 * pas encore reduites a un facteur.
 *
 * EXTRAIT de l'ancien corps de `facteursMeteoParDate` (D-059, docs/17 fiches
 * 2/4) : la mesure du facteur meteo PAR CATEGORIE
 * (`apps/api/src/routes/previsions.ts`) a besoin des conditions completes
 * (pour classer via `classerMeteo`), pas seulement du facteur deja reduit —
 * une seconde requete aurait duplique cette meme logique de fusion.
 */
function relevesMeteoParDate(base: BaseBatte, lieuId: string): Map<string, ConditionsMeteo> {
  const releves = base
    .select({
      dateObservation: meteoObservation.dateObservation,
      type: meteoObservation.type,
      temperatureC: meteoObservation.temperatureC,
      precipitationsMm: meteoObservation.precipitationsMm,
      ventKmh: meteoObservation.ventKmh,
      couvertureNuageuseBp: meteoObservation.couvertureNuageuseBp,
    })
    .from(meteoObservation)
    .where(eq(meteoObservation.lieuId, lieuId))
    // 'prevision' avant 'reelle' : la seconde ecrase la premiere dans la Map.
    .orderBy(asc(meteoObservation.dateObservation), asc(meteoObservation.type))
    .all();

  const conditions = new Map<string, ConditionsMeteo>();

  for (const releve of releves) {
    if (
      releve.temperatureC === null ||
      releve.precipitationsMm === null ||
      releve.ventKmh === null ||
      releve.couvertureNuageuseBp === null
    ) {
      continue;
    }
    conditions.set(releve.dateObservation, {
      temperatureC: releve.temperatureC,
      precipitationsMm: releve.precipitationsMm,
      ventKmh: releve.ventKmh,
      couvertureNuageuseBp: releve.couvertureNuageuseBp,
    });
  }

  return conditions;
}

/**
 * Facteur meteo qui s'appliquait un jour donne, recalcule avec les parametres
 * COURANTS a partir du releve conserve.
 *
 * Recalculer plutot que relire le facteur archive est deliberé (D-028) : si
 * l'utilisateur revise son facteur « pluie continue », tout l'historique se
 * renormalise de facon coherente. Un facteur fige par session rendrait la
 * baseline dependante de l'ordre dans lequel les parametres ont ete modifies.
 */
function facteursMeteoParDate(base: BaseBatte, lieuId: string): Map<string, PointsDeBase> {
  const releves = relevesMeteoParDate(base, lieuId);
  const parametres = lireParametres(base);
  const facteurs = new Map<string, PointsDeBase>();

  for (const [date, conditions] of releves) {
    facteurs.set(date, facteurMeteo(conditions, parametres).facteurBp);
  }

  return facteurs;
}

/**
 * Sessions closes du lieu, avec les CONDITIONS METEO brutes du jour (pas
 * encore classees) et les autres facteurs deja neutralises — matiere premiere
 * de la mesure du facteur meteo PAR CATEGORIE (docs/17 fiches 2/4, D-059).
 *
 * Memes filtres que `observationsDuLieu` (sessions closes, non exclues du
 * modele) PLUS un troisieme, propre a cette mesure : une session sans releve
 * meteo exploitable pour sa date est ecartee — jamais un facteur invente sur
 * une categorie qu'on ne peut pas determiner.
 */
export type ObservationMeteoBrute = {
  readonly dateSession: string;
  readonly conditions: ConditionsMeteo;
  readonly crepesVendues: number;
  readonly evenementBp: PointsDeBase;
  readonly saisonBp: PointsDeBase;
};

export function observationsMeteoDuLieu(base: BaseBatte, lieuId: string): ObservationMeteoBrute[] {
  const sessions = base
    .select({
      dateSession: sessionMarche.dateSession,
      crepesVendues: sessionMarche.crepesVendues,
    })
    .from(sessionMarche)
    .where(
      and(
        eq(sessionMarche.lieuId, lieuId),
        eq(sessionMarche.statut, 'cloturee'),
        eq(sessionMarche.exclureDuModele, false),
      ),
    )
    .orderBy(asc(sessionMarche.dateSession))
    .all();

  const releves = relevesMeteoParDate(base, lieuId);
  const evenementsValides = evenementsValidesEnBloc(base);

  const resultat: ObservationMeteoBrute[] = [];
  for (const s of sessions) {
    const conditions = releves.get(s.dateSession);
    if (conditions === undefined) continue;
    resultat.push({
      dateSession: s.dateSession,
      conditions,
      crepesVendues: s.crepesVendues,
      evenementBp: facteurEvenementBpEnMemoire(evenementsValides, s.dateSession),
      // Meme choix que `observationsDuLieu` : pas de modele saisonnier tant
      // que l'historique ne couvre pas une annee.
      saisonBp: BASE_POINTS,
    });
  }
  return resultat;
}

/** Evenements valides qui couvrent une date donnee. */
export function evenementsDuJour(base: BaseBatte, date: string) {
  return base
    .select()
    .from(evenement)
    .where(
      and(
        eq(evenement.valideParHumain, true),
        lte(evenement.dateDebut, date),
        gte(evenement.dateFin, date),
      ),
    )
    .all();
}

/**
 * Tous les événements VALIDÉS PAR UN HUMAIN, chargés en UNE SEULE requête.
 *
 * Matière première du calcul en mémoire de `facteurEvenementBpEnMemoire`
 * ci-dessous, pour un historique ENTIER (`observationsMeteoDuLieu`,
 * `observationsDuLieu`, `observationsCompletesDuLieu`) : ces trois fonctions
 * appelaient `facteurEvenementBp(base, s.dateSession)` — donc une requête sur
 * `evenement` — UNE FOIS PAR SESSION de l'historique, un coût qui croît
 * linéairement avec le nombre de sessions alors que la table `evenement`
 * elle-même ne bouge presque jamais (mesure de charge du 30/07/2026 :
 * `observationsDuLieu` passe de 2,2 ms à vide à 60,3 ms à 150 sessions).
 *
 * Reproduit EXACTEMENT le filtre de `evenementsDuJour` — `valide_par_humain =
 * true`, RIEN d'autre — pour que le repli ne fasse jamais entrer une
 * proposition d'événement non validée dans une prévision (CLAUDE.md §3
 * règle 2). La borne de date, elle, est appliquée ensuite en mémoire par
 * `facteurEvenementBpEnMemoire`, une par date, jamais ici.
 */
function evenementsValidesEnBloc(base: BaseBatte) {
  return base.select().from(evenement).where(eq(evenement.valideParHumain, true)).all();
}

/**
 * Équivalent de `facteurEvenementBp`, mais à partir d'un LOT d'événements déjà
 * chargé (`evenementsValidesEnBloc`) plutôt que d'une requête par date — le
 * cache que `observationsMeteoDuLieu`/`observationsDuLieu`/
 * `observationsCompletesDuLieu` construisent une fois, puis réutilisent pour
 * chaque session de l'historique (même patron que `garniesParSession` dans
 * `depots/tracabilite.ts` : un cache LOCAL À L'APPEL, jamais partagé entre
 * deux appels — un événement modifié entre-temps ne doit jamais se lire
 * périmé).
 *
 * Reproduit EXACTEMENT la borne de `evenementsDuJour` — `date_debut <= date
 * <= date_fin` — par comparaison lexicographique de chaînes `AAAA-MM-JJ`,
 * identique à la comparaison SQL `lte`/`gte` sur ces mêmes colonnes tant que
 * les dates restent dans ce format (D-020, D-026 : bornes de période déjà
 * fautives deux fois dans ce projet, on ne les réapproxime pas).
 */
function facteurEvenementBpEnMemoire(
  evenementsValides: readonly (typeof evenement.$inferSelect)[],
  date: string,
): PointsDeBase {
  const actifs = evenementsValides.filter((e) => e.dateDebut <= date && e.dateFin >= date);
  const produit = actifs.reduce(
    (total, e) => total * ((e.impactMesureBp ?? e.impactEstimeBp) / BASE_POINTS),
    1,
  );
  return Math.round(produit * BASE_POINTS);
}

/**
 * Facteur evenement d'une date : produit des impacts des evenements valides.
 *
 * L'impact MESURE prime sur l'impact estime des qu'il existe. C'est le seul
 * mecanisme par lequel l'estimation d'un evenement recurrent s'ameliore.
 */
export function facteurEvenementBp(base: BaseBatte, date: string): PointsDeBase {
  const actifs = evenementsDuJour(base, date);
  const produit = actifs.reduce(
    (total, e) => total * ((e.impactMesureBp ?? e.impactEstimeBp) / BASE_POINTS),
    1,
  );
  return Math.round(produit * BASE_POINTS);
}

/**
 * Sessions closes exploitables par le modele, du lieu demande.
 *
 * Les sessions marquees `exclure_du_modele` sont ecartees : une panne de gaz
 * n'apprend rien sur la frequentation (docs/03).
 */
export function observationsDuLieu(base: BaseBatte, lieuId: string): ObservationSession[] {
  const sessions = base
    .select({
      dateSession: sessionMarche.dateSession,
      crepesVendues: sessionMarche.crepesVendues,
    })
    .from(sessionMarche)
    .where(
      and(
        eq(sessionMarche.lieuId, lieuId),
        eq(sessionMarche.statut, 'cloturee'),
        eq(sessionMarche.exclureDuModele, false),
      ),
    )
    .orderBy(asc(sessionMarche.dateSession))
    .all();

  const meteoParDate = facteursMeteoParDate(base, lieuId);
  const evenementsValides = evenementsValidesEnBloc(base);

  return sessions.map((s) => ({
    dateSession: s.dateSession,
    crepesVendues: s.crepesVendues,
    meteoBp: meteoParDate.get(s.dateSession) ?? BASE_POINTS,
    evenementBp: facteurEvenementBpEnMemoire(evenementsValides, s.dateSession),
    // Pas de modele saisonnier tant que l'historique ne couvre pas une annee :
    // un facteur invente serait pire qu'un facteur neutre (docs/03).
    saisonBp: BASE_POINTS,
  }));
}

/**
 * Meme historique que `observationsDuLieu`, ENRICHI de ce que le predicteur
 * « session consecutive » de docs/demandes/07 §2 a besoin de connaitre :
 * combien a ete produit et jete a chaque session.
 *
 * NOUVELLE fonction plutot qu'extension de `observationsDuLieu` : cette
 * derniere est deja consommee par `apps/api/src/routes/previsions.ts`
 * (`previsionCourante`), hors de la zone d'ecriture de cet agent — la
 * modifier aurait risque une regression sur un fichier que je ne peux pas
 * verifier moi-meme. Voir le rapport de livraison pour le cablage restant.
 */
export function observationsCompletesDuLieu(
  base: BaseBatte,
  lieuId: string,
): ObservationEcoulement[] {
  const sessions = base
    .select({
      dateSession: sessionMarche.dateSession,
      crepesVendues: sessionMarche.crepesVendues,
      crepesProduites: sessionMarche.crepesProduites,
      crepesInvendues: sessionMarche.crepesInvendues,
    })
    .from(sessionMarche)
    .where(
      and(
        eq(sessionMarche.lieuId, lieuId),
        eq(sessionMarche.statut, 'cloturee'),
        eq(sessionMarche.exclureDuModele, false),
      ),
    )
    .orderBy(asc(sessionMarche.dateSession))
    .all();

  const meteoParDate = facteursMeteoParDate(base, lieuId);
  const evenementsValides = evenementsValidesEnBloc(base);

  return sessions.map((s) => ({
    dateSession: s.dateSession,
    crepesVendues: s.crepesVendues,
    crepesProduites: s.crepesProduites,
    crepesInvendues: s.crepesInvendues,
    meteoBp: meteoParDate.get(s.dateSession) ?? BASE_POINTS,
    evenementBp: facteurEvenementBpEnMemoire(evenementsValides, s.dateSession),
    saisonBp: BASE_POINTS,
  }));
}

/**
 * Couples (prevu, realise) pour un lieu — matiere premiere du predicteur
 * « ecart meteo prevue/realisee » (docs/demandes/07 §2, predicteur 4).
 *
 * ANCIENNE limite, CORRIGEE par D-058 (migration `0015_smooth_gabe_jones.sql`) :
 * `meteo_observation` ne conservait qu'UN releve par (lieu, date, type) —
 * `enregistrerMeteo` ECRASAIT le relevé « prevision » precedent au lieu d'en
 * garder l'historique. L'index unique porte desormais sur (lieu, date, type,
 * horizon), donc plusieurs previsions (J-7, J-3, J-1…) pour LE MEME jour
 * observe coexistent reellement en base.
 *
 * Consequence pour cette fonction : une meme date peut desormais produire
 * PLUSIEURS paires (une par horizon de prevision conserve), toutes comparees
 * au MEME releve « reelle » de cette date — c'est exactement le sens de
 * l'ecart mesure, pas un doublon. Avant D-058, une seule prevision par date
 * existait de toute facon : le comportement sur les donnees anciennes ne
 * change pas.
 */
export function pairesMeteoDuLieu(base: BaseBatte, lieuId: string): PaireMeteo[] {
  const releves = base
    .select({
      dateObservation: meteoObservation.dateObservation,
      type: meteoObservation.type,
      temperatureC: meteoObservation.temperatureC,
      precipitationsMm: meteoObservation.precipitationsMm,
      ventKmh: meteoObservation.ventKmh,
      couvertureNuageuseBp: meteoObservation.couvertureNuageuseBp,
    })
    .from(meteoObservation)
    .where(eq(meteoObservation.lieuId, lieuId))
    .orderBy(asc(meteoObservation.dateObservation))
    .all();

  // Plusieurs « prevision » possibles par date (une par horizon conserve),
  // UN SEUL « reelle » ayant un sens (l'observation du jour meme).
  const parDate = new Map<
    string,
    { prevues: (typeof releves)[number][]; reelle?: (typeof releves)[number] }
  >();
  for (const releve of releves) {
    const entree = parDate.get(releve.dateObservation) ?? { prevues: [] };
    if (releve.type === 'prevision') entree.prevues.push(releve);
    else entree.reelle = releve;
    parDate.set(releve.dateObservation, entree);
  }

  const paires: PaireMeteo[] = [];
  for (const { prevues, reelle } of parDate.values()) {
    if (reelle === undefined) continue;
    if (
      reelle.temperatureC === null ||
      reelle.precipitationsMm === null ||
      reelle.ventKmh === null ||
      reelle.couvertureNuageuseBp === null
    ) {
      continue;
    }

    for (const prevue of prevues) {
      if (
        prevue.temperatureC === null ||
        prevue.precipitationsMm === null ||
        prevue.ventKmh === null ||
        prevue.couvertureNuageuseBp === null
      ) {
        continue;
      }
      paires.push({
        prevue: {
          temperatureC: prevue.temperatureC,
          precipitationsMm: prevue.precipitationsMm,
          ventKmh: prevue.ventKmh,
          couvertureNuageuseBp: prevue.couvertureNuageuseBp,
        },
        reelle: {
          temperatureC: reelle.temperatureC,
          precipitationsMm: reelle.precipitationsMm,
          ventKmh: reelle.ventKmh,
          couvertureNuageuseBp: reelle.couvertureNuageuseBp,
        },
      });
    }
  }
  return paires;
}

/**
 * Calendrier des vacances scolaires belges, lu au catalogue de paramètres
 * (jamais codé en dur — CLAUDE.md §7 et `vacances-scolaires.ts`).
 *
 * La cle `prevision_vacances_scolaires_be_json` N'EST PAS ENCORE au
 * catalogue officiel (`packages/core/src/parametres.ts`, hors perimetre
 * d'ecriture de cet agent — voir le rapport de livraison) : tant qu'elle n'y
 * est pas, cette fonction leve `ErreurParametreManquant` si elle est
 * appelée — c'est le même choix assumé que `meteo.ts` pour
 * `prevision_meteo_ensoleille_tiede_bp` avant son ajout au catalogue.
 */
export function periodesVacancesScolaires(parametres: Parametres): PeriodeVacances[] {
  const brut = parametres.texte('prevision_vacances_scolaires_be_json');
  let valeur: unknown;
  try {
    valeur = JSON.parse(brut);
  } catch (erreur) {
    throw new ErreurMetier(
      'calendrier_vacances_invalide',
      'Le calendrier des vacances scolaires (paramètre ' +
        '« prevision_vacances_scolaires_be_json ») n’est pas un JSON valide.',
      { cause: erreur },
    );
  }
  if (!Array.isArray(valeur)) {
    throw new ErreurMetier(
      'calendrier_vacances_invalide',
      'Le calendrier des vacances scolaires doit être un tableau de périodes ' +
        '{ nom, debut, fin }.',
    );
  }
  return valeur.map((periode: unknown) => {
    if (
      typeof periode !== 'object' ||
      periode === null ||
      typeof (periode as Record<string, unknown>).nom !== 'string' ||
      typeof (periode as Record<string, unknown>).debut !== 'string' ||
      typeof (periode as Record<string, unknown>).fin !== 'string'
    ) {
      throw new ErreurMetier(
        'calendrier_vacances_invalide',
        'Chaque période de vacances doit porter un nom, une date de début et ' +
          'une date de fin en texte.',
      );
    }
    const p = periode as { nom: string; debut: string; fin: string };
    return { nom: p.nom, debut: p.debut, fin: p.fin };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Couts du modele newsvendor
   ═══════════════════════════════════════════════════════════════════════════ */

export type CoutsNewsvendor = {
  readonly coutRuptureCents: number;
  readonly coutInvenduCents: number;
  /**
   * `false` quand `coutInvenduCents` est un ZERO SENTINELLE (aucune
   * production ni aucune recette au coût connu — voir `coutMatiereParCrepe`),
   * pas une vraie mesure ni une vraie estimation. Distinction ajoutée pour
   * l'audit de cohérence du coût complet (docs/demandes/13) : sans elle, un
   * appelant qui ne regarde que `prixMoyenCrepeCents > 0` (comme
   * `routes/lieux-rentabilite.ts`) ne peut pas distinguer « matière estimée à
   * X cents » de « matière totalement inconnue, 0 cents par défaut » — et
   * traiterait ce zéro comme un vrai coût matière, exactement le défaut que
   * CLAUDE.md §7 interdit (« une valeur inconnue vaut `null`, jamais `0` »).
   * Le moteur newsvendor, lui, CONTINUE de recevoir `coutInvenduCents` (jamais
   * `null`) : il a besoin d'un nombre pour proposer une quantité à produire,
   * même sans aucune donnée (mode dégradé, CLAUDE.md §5) — seul un appelant
   * qui calcule une MARGE EN ARGENT (fiche 13) doit vérifier ce drapeau avant
   * d'utiliser `coutInvenduCents` comme un coût réel.
   */
  readonly coutInvenduConnu: boolean;
  /**
   * Prix de vente moyen d'une crêpe — exposé TEL QUEL, jamais à reconstruire
   * par `coutRuptureCents + coutInvenduCents` (ce que faisaient
   * `routes/lieux-rentabilite.ts` et `routes/opportunites.ts` avant l'audit
   * du 30/07/2026, fiche 13). Cette reconstruction n'est exacte QUE quand le
   * prix couvre au moins la matière (`coutRuptureCents = max(0, prix −
   * matière)` ÉCRÊTE à 0 en dessous) : sur une matière plus chère que le prix
   * affiché — vente à perte, ou prix totalement inconnu pendant que la
   * matière, elle, est estimée — la somme reconstruite renvoie la matière,
   * pas le prix réel. `prixMoyenCrepeCents` évite ce piège en portant
   * directement la vraie valeur.
   */
  readonly prixMoyenCrepeCents: number;
  /** `false` quand `prixMoyenCrepeCents` est un ZERO SENTINELLE (aucune
   *  vente ni aucun produit transformé au tarif affiché) — même distinction
   *  que `coutInvenduConnu` ci-dessus, pour la même raison. */
  readonly prixMoyenConnu: boolean;
  /** D'ou viennent ces deux chiffres. Affiche : l'utilisateur doit pouvoir contester. */
  readonly origine: string;
};

/**
 * Cout matiere moyen d'une crepe, mesure sur les productions reelles.
 *
 * `cents: null` UNIQUEMENT quand aucune production ni aucune recette au cout
 * connu n'existe encore : c'est le seul cas ou ce chiffre ne repose sur RIEN
 * de reel (CLAUDE.md §7, « une valeur inconnue vaut null, jamais 0 »). Le
 * repli sur le cout theorique moyen des recettes actives (mesure: false, cents
 * non null) reste un VRAI nombre, calcule depuis de vrais prix d'ingredients —
 * ce n'est pas la meme chose qu'une absence totale de donnee, d'ou les DEUX
 * etats distincts plutot qu'un seul booleen `mesure`.
 */
function coutMatiereParCrepe(base: BaseBatte): { cents: number | null; mesure: boolean } {
  const productions = base
    .select({
      coutTheorique: production.coutMatiereTheoriqueCents,
      coutReel: production.coutMatiereReelCents,
      crepesTheoriques: production.crepesTheoriques,
      crepesReelles: production.crepesReelles,
    })
    .from(production)
    .where(ne(production.statut, 'annulee'))
    .all();

  let cout = 0;
  let crepes = 0;
  for (const p of productions) {
    cout += p.coutReel ?? p.coutTheorique;
    crepes += p.crepesReelles ?? p.crepesTheoriques;
  }
  if (crepes > 0) return { cents: Math.round(cout / crepes), mesure: true };

  // Aucune production : on se rabat sur le cout theorique des recettes, calcule
  // par la meme fonction que l'ecran Recettes — surtout pas une seconde formule.
  const couts = listerRecettes(base)
    .map((r) => r.coutParCrepeCents)
    .filter((c): c is number => c !== null);
  if (couts.length === 0) return { cents: null, mesure: false };

  return {
    cents: Math.round(couts.reduce((s, c) => s + c, 0) / couts.length),
    mesure: false,
  };
}

/**
 * Prix de vente moyen d'une crepe, pondere par le mix reellement vendu.
 *
 * `cents: null` UNIQUEMENT quand aucune vente ni aucun produit transforme au
 * tarif affiche n'existe encore — meme distinction que `coutMatiereParCrepe`
 * ci-dessus, et pour la meme raison (CLAUDE.md §7).
 */
function prixMoyenParCrepe(base: BaseBatte): { cents: number | null; mesure: boolean } {
  const ventes = base
    .select({
      montantCents: sql<number>`COALESCE(SUM(${sessionVente.montantCents}), 0)`,
      crepes: sql<number>`COALESCE(SUM(${sessionVente.quantite} * COALESCE(${produitVente.nbCrepes}, 1)), 0)`,
    })
    .from(sessionVente)
    .innerJoin(produitVente, eq(sessionVente.produitVenteId, produitVente.id))
    .where(eq(produitVente.nature, 'transforme'))
    .get();

  if (ventes !== undefined && ventes.crepes > 0) {
    return { cents: Math.round(ventes.montantCents / ventes.crepes), mesure: true };
  }

  // Aucune vente : moyenne simple des tarifs affiches des produits transformes.
  const produits = base
    .select({ prixCents: produitVente.prixCents, nbCrepes: produitVente.nbCrepes })
    .from(produitVente)
    .where(and(eq(produitVente.nature, 'transforme'), eq(produitVente.actif, true)))
    .all();

  const unitaires = produits
    .map((p) => (p.nbCrepes !== null && p.nbCrepes > 0 ? p.prixCents / p.nbCrepes : null))
    .filter((v): v is number => v !== null);
  if (unitaires.length === 0) return { cents: null, mesure: false };

  return {
    cents: Math.round(unitaires.reduce((s, v) => s + v, 0) / unitaires.length),
    mesure: false,
  };
}

/**
 * Couts du modele newsvendor, tires des donnees reelles.
 *
 * docs/03 est explicite : `Cu` et `Co` viennent des donnees de l'application,
 * « pas de constantes ». Le desequilibre entre les deux est ce qui pousse la
 * production bien au-dessus de la mediane, donc leur origine doit etre visible.
 */
export function coutsNewsvendor(base: BaseBatte): CoutsNewsvendor {
  const matiere = coutMatiereParCrepe(base);
  const prix = prixMoyenParCrepe(base);

  // Le moteur newsvendor a besoin de DEUX NOMBRES pour proposer une quantite
  // a produire, meme sans aucune donnee (mode degrade, CLAUDE.md §5) : les
  // replis explicites sur 0 vivent ICI, au point d'appel qui en a l'usage,
  // plutot que caches dans `coutMatiereParCrepe`/`prixMoyenParCrepe` —
  // `coutInvenduConnu` et `prixMoyenConnu` ci-dessous disent a un appelant
  // qui calcule une MARGE EN ARGENT (fiche 13) que ces 0 sont des
  // sentinelles, pas de vrais chiffres.
  const coutInvenduCents = matiere.cents ?? 0;
  const prixMoyenCrepeCents = prix.cents ?? 0;

  // Une rupture coute la marge entiere ; un invendu, seulement la matiere.
  // Attention : cette soustraction ECRETE a 0 des que la matiere depasse le
  // prix (vente a perte, ou prix inconnu pendant que la matiere est estimee)
  // — raison pour laquelle `prixMoyenCrepeCents` est exposee A PART ci-dessus,
  // plutot que de forcer l'appelant a la reconstruire par
  // `coutRuptureCents + coutInvenduCents` (exact seulement quand
  // prix >= matiere).
  const coutRuptureCents = Math.max(0, prixMoyenCrepeCents - coutInvenduCents);

  const origine =
    matiere.mesure && prix.mesure
      ? 'Mesurés sur vos productions et vos ventes.'
      : `Estimés : ${matiere.mesure ? '' : 'coût matière issu des recettes actives'}` +
        `${!matiere.mesure && !prix.mesure ? ', ' : ''}` +
        `${prix.mesure ? '' : 'prix moyen issu du tarif affiché'}. ` +
        'Ils se préciseront après quelques marchés.';

  return {
    coutRuptureCents,
    coutInvenduCents,
    coutInvenduConnu: matiere.cents !== null,
    prixMoyenCrepeCents,
    prixMoyenConnu: prix.cents !== null,
    origine,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sessions et lieux
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Vue d'une session planifiée telle que `previsionCourante`
 * (`apps/api/src/routes/previsions.ts`) la transmet jusqu'au contrat HTTP
 * (`schemaPrevision.session`, `packages/core/src/contrats/previsions.ts`).
 *
 * Annoté EXPLICITEMENT (mission du 31/07/2026, en écho à un défaut mesuré le
 * 29/07/2026 qui a coûté quatre routes d'un coup) : une fonction de dépôt SANS
 * type de retour laisse `tsc` recopier silencieusement ce que le `.select()`
 * rend, manque compris — un champ retiré ou renommé ne se verrait alors qu'au
 * premier appel réel, en 422 sur `schemaPrevision.parse`. Ce type rend
 * l'invariant visible : `lieuId` est un `string`, jamais `null`, parce que
 * `session_marche.lieu_id` est `NOT NULL` et que la requête ci-dessous le
 * rejoint par un INNER JOIN — une session planifiée sans lieu n'existe pas.
 */
export type SessionPlanifiee = {
  readonly id: string;
  readonly numero: string;
  readonly dateSession: string;
  readonly lieuId: string;
  readonly lieuNom: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly heureDebut: string | null;
  readonly heureFin: string | null;
};

/** Prochaine session planifiee, ou `null` s'il n'y en a pas. */
export function prochaineSessionPlanifiee(
  base: BaseBatte,
  jourReference: string,
): SessionPlanifiee | null {
  return (
    base
      .select({
        id: sessionMarche.id,
        numero: sessionMarche.numero,
        dateSession: sessionMarche.dateSession,
        lieuId: sessionMarche.lieuId,
        lieuNom: lieuMarche.nom,
        latitude: lieuMarche.latitude,
        longitude: lieuMarche.longitude,
        heureDebut: lieuMarche.heureDebut,
        heureFin: lieuMarche.heureFin,
      })
      .from(sessionMarche)
      .innerJoin(lieuMarche, eq(sessionMarche.lieuId, lieuMarche.id))
      .where(
        and(eq(sessionMarche.statut, 'planifiee'), gte(sessionMarche.dateSession, jourReference)),
      )
      .orderBy(asc(sessionMarche.dateSession))
      .get() ?? null
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Archivage et qualite du modele
   ═══════════════════════════════════════════════════════════════════════════ */

/** Archive une prevision avec toutes ses entrees. Rend l'identifiant cree. */
export function archiverPrevision(
  base: BaseBatte,
  entree: {
    sessionId: string | null;
    resultat: ResultatPrevision;
    commentaireIa?: string | null;
    /**
     * Facteurs de precision de la fiche 07 (docs/demandes/07), ADMIS par
     * validation croisee (`validerParLeaveOneOut`) au moment de CETTE
     * prevision — c'est a l'appelant (`apps/api/src/routes/previsions.ts`)
     * de trancher l'admission, ce depot ne fait qu'ecrire ce qu'on lui donne.
     *
     * `null` — jamais `BASE_POINTS` — quand le predicteur n'existait pas
     * assez d'historique ou n'a pas ete admis : c'est EXACTEMENT la
     * distinction que l'ecran Qualite du modele doit pouvoir lire (voir le
     * commentaire sur ces colonnes dans `packages/db/src/schema.ts`). Omettre
     * un champ produit le meme `null` que le passer explicitement : les deux
     * s'ecrivent identiquement en base, `?? null` ne fait que rendre ce choix
     * explicite au lieu de compter sur `undefined` implicite.
     */
    facteurComparableCalendaireBp?: PointsDeBase | null;
    facteurJourSemaineBp?: PointsDeBase | null;
    facteurVacancesScolairesBp?: PointsDeBase | null;
    facteurSessionConsecutiveBp?: PointsDeBase | null;
    inflationSigmaMeteoBp?: PointsDeBase | null;
  },
): string {
  const { resultat } = entree;
  const id = nouvelIdentifiant();

  base
    .insert(prevision)
    .values({
      id,
      sessionId: entree.sessionId,
      dateCalcul: maintenantUtc(),
      versionModele: VERSION_MODELE,
      baselineCrepes: resultat.baseline,
      facteurMeteoBp: resultat.facteurs.meteoBp,
      facteurEvenementBp: resultat.facteurs.evenementBp,
      facteurSaisonBp: resultat.facteurs.saisonBp,
      facteurTendanceBp: resultat.facteurs.tendanceBp,
      facteurComparableCalendaireBp: entree.facteurComparableCalendaireBp ?? null,
      facteurJourSemaineBp: entree.facteurJourSemaineBp ?? null,
      facteurVacancesScolairesBp: entree.facteurVacancesScolairesBp ?? null,
      facteurSessionConsecutiveBp: entree.facteurSessionConsecutiveBp ?? null,
      inflationSigmaMeteoBp: entree.inflationSigmaMeteoBp ?? null,
      p10Crepes: resultat.p10,
      p50Crepes: resultat.p50,
      p90Crepes: resultat.p90,
      quantileCibleBp: resultat.quantileCibleBp,
      crepesRecommandees: resultat.crepesRecommandees,
      crepesRetenues: resultat.crepesRetenues,
      contrainteLimitante: resultat.contrainteLimitante,
      manqueAGagnerCents: resultat.manqueAGagnerCents,
      // Docs/17 fiche 5 : `resultat.repartition` est un TABLEAU, vide quand
      // l'appelant n'a transmis aucune recette active exploitable. On archive
      // `null` dans ce cas precis — pas `[]` — pour ne pas confondre
      // « repartition calculee et vide » avec « fonctionnalite pas encore
      // cablee pour cet appelant » (meme convention que les colonnes
      // `facteur_..._bp` nullables ci-dessus : `NULL` n'est pas « neutre »).
      // `?? []` : un appelant qui construit un `ResultatPrevision` a la main
      // (fixture de test antérieure a ce champ, via `as unknown as
      // ResultatPrevision`) peut encore omettre `repartition` a l'execution
      // malgre le typage — un `undefined` ne doit jamais faire planter
      // l'archivage.
      repartitionRecettes: (resultat.repartition ?? []).length > 0 ? resultat.repartition : null,
      confianceBp: resultat.confianceBp,
      nbSessionsComparables: resultat.nbSessionsComparables,
      commentaireIa: entree.commentaireIa ?? null,
      explicationFacteurs: resultat.explication,
      crepesReelles: null,
      erreurAbsolueBp: null,
    })
    .run();

  return id;
}

/**
 * Impact mesure d'UNE session pour l'evenement `evenementId`, ou `null` quand
 * la mesure n'a pas de sens (docs/03, facteur 3 :
 * `impact_mesure = reel / (baseline x meteo x saison)`).
 *
 * Deux raisons de renvoyer `null`, jamais un chiffre invente :
 *  - aucune prevision archivee pour cette session : pas de baseline / facteur
 *    meteo / facteur saison a retirer du realise ;
 *  - plus d'un evenement actif ce jour-la : le residu observe est la
 *    combinaison des DEUX (ou plus), l'attribuer entierement a `evenementId`
 *    supposerait une repartition que rien ne justifie.
 */
function impactMesureSession(
  base: BaseBatte,
  evenementId: string,
  sessionId: string,
  dateSession: string,
  crepesReelles: number,
): number | null {
  const actifs = evenementsDuJour(base, dateSession);
  if (actifs.length !== 1 || actifs[0]!.id !== evenementId) return null;

  // La prevision la PLUS RECENTE archivee pour cette session : la plus proche
  // de ce qui a reellement guide la decision de production (docs/03 releve la
  // meteo a J-7, J-3, J-1 et le matin meme ; une session peut donc porter
  // plusieurs previsions archivees, D-058).
  const previsionRecente = base
    .select({
      baselineCrepes: prevision.baselineCrepes,
      meteoBp: prevision.facteurMeteoBp,
      saisonBp: prevision.facteurSaisonBp,
    })
    .from(prevision)
    .where(eq(prevision.sessionId, sessionId))
    .orderBy(desc(prevision.dateCalcul))
    .get();
  if (previsionRecente === undefined) return null;

  const facteurSansEvenement =
    (previsionRecente.meteoBp / BASE_POINTS) * (previsionRecente.saisonBp / BASE_POINTS);
  if (previsionRecente.baselineCrepes <= 0 || facteurSansEvenement <= 0) return null;

  return Math.round(
    (crepesReelles / (previsionRecente.baselineCrepes * facteurSansEvenement)) * BASE_POINTS,
  );
}

/**
 * Mesure et ecrit `evenement.impact_mesure_bp` (docs/17 fiches 2/4, D-059) :
 * la colonne existait, documentee, jamais ecrite — vérifié le 29/07/2026,
 * zero `insert`/`update` sur cette colonne dans tout le depot avant ce lot.
 *
 * MOYENNE, pas ecrasement, sur TOUTES les sessions closes tombant dans la
 * fenetre `[date_debut, date_fin]` de l'evenement ou celui-ci etait le SEUL
 * actif (un evenement peut couvrir plusieurs dimanches — braderie d'un mois,
 * par exemple). RECALCULEE integralement a chaque appel plutot que mise a
 * jour de proche en proche (meme choix que `facteursMeteoParDate`,
 * `coutMatiereParCrepe`, D-028) : aucun compteur separe a maintenir, et la
 * correction d'une session passee (exclusion du modele, par exemple) se
 * propage d'elle-meme au prochain appel.
 *
 * **Sessions `exclure_du_modele` toujours ECARTEES de cette moyenne** — a la
 * difference du rapprochement general (`rapprocherPrevision` rapproche TOUTE
 * session, l'agregat `qualiteModele` filtrant ensuite). Ici la mesure ALIMENTE
 * un coefficient REUTILISE pour de FUTURES previsions : une session dont on
 * sait deja qu'elle ne represente rien (panne de gaz) ne doit pas polluer une
 * valeur qui vivra au-dela d'elle. C'est la precaution demandee explicitement
 * par la fiche 4.
 *
 * **Aucune validation croisee ici**, a la difference du facteur meteo par
 * categorie (`apps/api/src/routes/previsions.ts`) — deviation ASSUMEE,
 * documentee dans le rapport de livraison : `docs/03-MOTEUR-PREVISION.md`
 * decrit ce mecanisme comme profitable PRECISEMENT parce qu'il transforme une
 * intuition en coefficient des la premiere observation, et la fiche 4 le cite
 * approuvant ce choix. Un garde-fou a huit observations minimum (le seuil
 * `validerParLeaveOneOut` utilise partout ailleurs) interdirait quasiment
 * toujours la mesure a l'echelle d'un evenement (quelques occurrences par an).
 */
export function mesurerImpactEvenement(base: BaseBatte, evenementId: string): void {
  const ev = base
    .select({ dateDebut: evenement.dateDebut, dateFin: evenement.dateFin })
    .from(evenement)
    .where(eq(evenement.id, evenementId))
    .get();
  if (ev === undefined) return;

  const sessionsFermees = base
    .select({
      id: sessionMarche.id,
      dateSession: sessionMarche.dateSession,
      crepesVendues: sessionMarche.crepesVendues,
    })
    .from(sessionMarche)
    .where(
      and(
        eq(sessionMarche.statut, 'cloturee'),
        eq(sessionMarche.exclureDuModele, false),
        gte(sessionMarche.dateSession, ev.dateDebut),
        lte(sessionMarche.dateSession, ev.dateFin),
      ),
    )
    .all();

  const impacts: number[] = [];
  for (const s of sessionsFermees) {
    const impact = impactMesureSession(base, evenementId, s.id, s.dateSession, s.crepesVendues);
    if (impact !== null) impacts.push(impact);
  }
  // Aucune observation exploitable : on laisse la colonne telle qu'elle est
  // plutot que d'ecrire une moyenne vide — jamais de chiffre invente.
  if (impacts.length === 0) return;

  const moyenneBp = Math.round(impacts.reduce((somme, v) => somme + v, 0) / impacts.length);

  base
    .update(evenement)
    .set({ impactMesureBp: moyenneBp, modifieLe: maintenantUtc() })
    .where(eq(evenement.id, evenementId))
    .run();
}

/**
 * Renseigne le realise sur les previsions d'une session close.
 *
 * Appele a la cloture : sans ce rapprochement, la page « Qualite du modele »
 * reste vide et le modele ne peut pas etre juge.
 */
export function rapprocherPrevision(
  base: BaseBatte,
  sessionId: string,
  crepesReelles: number,
): void {
  const lignes = base
    .select({ id: prevision.id, p50: prevision.p50Crepes })
    .from(prevision)
    .where(eq(prevision.sessionId, sessionId))
    .all();

  for (const ligne of lignes) {
    base
      .update(prevision)
      .set({
        crepesReelles,
        erreurAbsolueBp:
          ligne.p50 > 0
            ? ratioEnPointsDeBase(Math.abs(crepesReelles - ligne.p50), ligne.p50)
            : null,
      })
      .where(eq(prevision.id, ligne.id))
      .run();
  }

  // Referme la SECONDE boucle prevu/realise (docs/17 fiches 2/4, D-059) :
  // les evenements actifs le jour de cette session voient leur impact mesure
  // recalcule. Toujours execute (meme sur une session exclue du modele) : le
  // filtre `exclure_du_modele` vit DANS `mesurerImpactEvenement`, sur
  // l'ensemble de la fenetre de l'evenement, pas seulement sur cette session.
  const session = base
    .select({ dateSession: sessionMarche.dateSession })
    .from(sessionMarche)
    .where(eq(sessionMarche.id, sessionId))
    .get();
  if (session !== undefined) {
    for (const ev of evenementsDuJour(base, session.dateSession)) {
      mesurerImpactEvenement(base, ev.id);
    }
  }
}

/** Previsions archivees, les plus recentes d'abord. */
export function listerPrevisions(base: BaseBatte) {
  return base
    .select({
      id: prevision.id,
      dateCalcul: prevision.dateCalcul,
      versionModele: prevision.versionModele,
      sessionId: prevision.sessionId,
      sessionNumero: sessionMarche.numero,
      dateSession: sessionMarche.dateSession,
      p50Crepes: prevision.p50Crepes,
      crepesRecommandees: prevision.crepesRecommandees,
      crepesRetenues: prevision.crepesRetenues,
      crepesReelles: prevision.crepesReelles,
      erreurAbsolueBp: prevision.erreurAbsolueBp,
      confianceBp: prevision.confianceBp,
    })
    .from(prevision)
    .leftJoin(sessionMarche, eq(prevision.sessionId, sessionMarche.id))
    .orderBy(desc(prevision.dateCalcul))
    .all();
}

/**
 * Taux de rupture et taux d'invendu (docs/03 « Mesure de la qualité du
 * modèle », deux des trois indicateurs manquants avant docs/17 fiche 8).
 *
 * Portent sur la PRODUCTION RÉELLE d'une session, pas sur une prévision : une
 * session peut être en rupture (quasiment tout écoulé) sans qu'aucune
 * prévision n'ait jamais été archivée pour elle. Partagé par `qualiteModele`
 * ci-dessous et par le script `npm run backtest`
 * (`packages/db/src/scripts/backtest.ts`) — un seul calcul, deux appelants.
 *
 * `seuilRuptureBp` reprend le seuil DÉJÀ au catalogue pour le prédicteur
 * « session consécutive » (`prevision_session_consecutive_seuil_rupture_bp`) :
 * la même notion de « part invendue en dessous de laquelle on juge qu'il y a
 * eu rupture » n'a pas besoin d'un second seuil.
 */
export function tauxEcoulement(
  sessions: readonly { readonly crepesProduites: number; readonly crepesInvendues: number }[],
  seuilRuptureBp: PointsDeBase,
): {
  readonly tauxRuptureBp: PointsDeBase | null;
  readonly tauxInvenduBp: PointsDeBase | null;
  readonly nbSessions: number;
} {
  const exploitables = sessions.filter((s) => s.crepesProduites > 0);
  if (exploitables.length === 0) {
    return { tauxRuptureBp: null, tauxInvenduBp: null, nbSessions: 0 };
  }

  const enRupture = exploitables.filter(
    (s) => ratioEnPointsDeBase(s.crepesInvendues, s.crepesProduites) <= seuilRuptureBp,
  ).length;

  // « Pâte jetée / pâte produite » (docs/03) : un ratio AGRÉGÉ (somme des
  // invendus sur somme des produites), pas la moyenne des ratios par session —
  // une grosse session pèse alors a due proportion, comme le CA le ferait.
  const totalProduites = exploitables.reduce((s, o) => s + o.crepesProduites, 0);
  const totalInvendues = exploitables.reduce((s, o) => s + o.crepesInvendues, 0);

  return {
    tauxRuptureBp: ratioEnPointsDeBase(enRupture, exploitables.length),
    tauxInvenduBp: ratioEnPointsDeBase(totalInvendues, totalProduites),
    nbSessions: exploitables.length,
  };
}

/**
 * Compteur d'activation d'UN predicteur : combien de fois, sur l'ensemble de
 * l'historique archive, sa colonne vaut une valeur REELLE (non nulle) contre
 * combien de fois elle est restee `NULL`.
 */
export type CompteurPredicteur = {
  readonly nbActif: number;
  readonly nbTotal: number;
};

function compterActivations(valeurs: readonly (number | null)[]): CompteurPredicteur {
  return {
    nbActif: valeurs.filter((v) => v !== null).length,
    nbTotal: valeurs.length,
  };
}

/**
 * Etat des quatre "facteurs de precision" de la fiche 07
 * (`docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md` §2), sur
 * l'ensemble des previsions archivees : combien de fois chaque predicteur a
 * ete ADMIS (colonne non nulle — apres validation croisee leave-one-out
 * effectuee par `apps/api/src/routes/previsions.ts` au moment de l'archivage)
 * contre combien de fois il ne l'a pas ete (historique insuffisant, ou rejete
 * par la validation croisee).
 *
 * Ecrites a CHAQUE prevision archivee (`archiverPrevision`), jamais relues
 * avant l'audit du 30/07/2026 (voir `audit-colonnes-orphelines.test.ts`) —
 * c'est le seul moyen de savoir si un predicteur de precision « vit »
 * reellement dans l'historique ou reste purement theorique.
 *
 * `nbActif` compte les valeurs NON NULLES, jamais les valeurs neutres
 * (10 000 bp) : la question posee ici est « ce predicteur a-t-il ete admis »,
 * pas « quel effet a-t-il eu » — un predicteur admis peut tres bien mesurer un
 * effet neutre.
 */
export type PredicteursPrecision = {
  readonly facteurComparableCalendaireBp: CompteurPredicteur;
  readonly facteurJourSemaineBp: CompteurPredicteur;
  readonly facteurVacancesScolairesBp: CompteurPredicteur;
  readonly facteurSessionConsecutiveBp: CompteurPredicteur;
};

export function predicteursPrecision(base: BaseBatte): PredicteursPrecision {
  const lignes = base
    .select({
      facteurComparableCalendaireBp: prevision.facteurComparableCalendaireBp,
      facteurJourSemaineBp: prevision.facteurJourSemaineBp,
      facteurVacancesScolairesBp: prevision.facteurVacancesScolairesBp,
      facteurSessionConsecutiveBp: prevision.facteurSessionConsecutiveBp,
    })
    .from(prevision)
    .all();

  return {
    facteurComparableCalendaireBp: compterActivations(
      lignes.map((l) => l.facteurComparableCalendaireBp),
    ),
    facteurJourSemaineBp: compterActivations(lignes.map((l) => l.facteurJourSemaineBp)),
    facteurVacancesScolairesBp: compterActivations(lignes.map((l) => l.facteurVacancesScolairesBp)),
    facteurSessionConsecutiveBp: compterActivations(
      lignes.map((l) => l.facteurSessionConsecutiveBp),
    ),
  };
}

/**
 * Cumul et frequence des DEUX colonnes analytiques de `prevision` qui
 * repondent, ensemble, a la question qui justifierait un jour un
 * investissement (troisieme plaque, camionnette) : « combien le fait de ne
 * pas pouvoir produire plus a-t-il coute, et par quoi la production est-elle
 * le plus souvent bridee ? » (docs/03 « Décision de production »,
 * `contexte.contrainteLimitante` / `contexte.manqueAGagnerCents` dans
 * `packages/core/src/prevision/moteur.ts`).
 *
 * Ecrites a CHAQUE prevision archivee (`archiverPrevision`), jamais relues
 * avant l'audit du 30/07/2026.
 *
 * `totalCents` ne somme QUE les previsions ou le manque a gagner a ete
 * CHIFFRE (`manqueAGagnerCents` non nul) : une prevision sans contrainte
 * limitante n'a, par construction, aucun manque a gagner a additionner — ce
 * n'est pas un zero a additionner, c'est une ligne hors du calcul (CLAUDE.md
 * §7, « une valeur inconnue vaut null, jamais 0 »). `null` uniquement quand
 * AUCUNE prevision archivee n'a jamais ete chiffree.
 *
 * `contrainteLaPlusFrequente` reprend le libelle EXACT ecrit par le moteur
 * (« capacité de cuisson », « capacité de la glacière », etc.,
 * `packages/core/src/prevision/moteur.ts`) — jamais reinterprete ici, ce
 * depot ne fait que compter ce qui a ete archive.
 */
export type SyntheseManqueAGagner = {
  readonly totalCents: number | null;
  readonly nbPrevisionsChiffrees: number;
  readonly nbPrevisionsTotal: number;
  readonly contrainteLaPlusFrequente: string | null;
  readonly nbPrevisionsContrainteLaPlusFrequente: number;
};

export function syntheseManqueAGagner(base: BaseBatte): SyntheseManqueAGagner {
  const lignes = base
    .select({
      manqueAGagnerCents: prevision.manqueAGagnerCents,
      contrainteLimitante: prevision.contrainteLimitante,
    })
    .from(prevision)
    .all();

  const chiffrees = lignes.map((l) => l.manqueAGagnerCents).filter((v): v is number => v !== null);

  const occurrences = new Map<string, number>();
  for (const ligne of lignes) {
    if (ligne.contrainteLimitante === null) continue;
    occurrences.set(
      ligne.contrainteLimitante,
      (occurrences.get(ligne.contrainteLimitante) ?? 0) + 1,
    );
  }

  let contrainteLaPlusFrequente: string | null = null;
  let nbPrevisionsContrainteLaPlusFrequente = 0;
  for (const [libelle, nb] of occurrences) {
    if (nb > nbPrevisionsContrainteLaPlusFrequente) {
      contrainteLaPlusFrequente = libelle;
      nbPrevisionsContrainteLaPlusFrequente = nb;
    }
  }

  return {
    totalCents: chiffrees.length === 0 ? null : chiffrees.reduce((s, v) => s + v, 0),
    nbPrevisionsChiffrees: chiffrees.length,
    nbPrevisionsTotal: lignes.length,
    contrainteLaPlusFrequente,
    nbPrevisionsContrainteLaPlusFrequente,
  };
}

/**
 * Qualite du modele : les six indicateurs de docs/03 « Mesure de la qualité
 * du modèle » — erreur absolue moyenne, MAPE glissante sur 10 sessions, biais
 * moyen, couverture de l'intervalle, taux de rupture, taux d'invendu. Les
 * trois derniers (MAPE glissante, taux de rupture, taux d'invendu) manquaient
 * avant docs/17 fiche 8.
 *
 * Le taux de couverture est le chiffre honnete : si l'intervalle P10–P90 est
 * juste, le realise doit y tomber 80 % du temps. Beaucoup plus, l'intervalle est
 * trop large et ne sert a rien ; beaucoup moins, il ment.
 *
 * `predicteursPrecision` et `syntheseManqueAGagner` ci-dessous NE dependent
 * PAS du rapprochement prevu/realise (elles portent sur TOUTES les previsions
 * archivees, rapprochees ou non) : contrairement aux six indicateurs
 * ci-dessus, elles restent donc calculees meme quand `rapprochees` est vide.
 */
export function qualiteModele(base: BaseBatte) {
  const rapprochees = base
    .select({
      sessionId: prevision.sessionId,
      dateCalcul: prevision.dateCalcul,
      dateSession: sessionMarche.dateSession,
      p10: prevision.p10Crepes,
      p50: prevision.p50Crepes,
      p90: prevision.p90Crepes,
      reelles: prevision.crepesReelles,
      erreurBp: prevision.erreurAbsolueBp,
      crepesProduites: sessionMarche.crepesProduites,
      crepesInvendues: sessionMarche.crepesInvendues,
    })
    .from(prevision)
    .leftJoin(sessionMarche, eq(prevision.sessionId, sessionMarche.id))
    .where(sql`${prevision.crepesReelles} IS NOT NULL`)
    .all();

  if (rapprochees.length === 0) {
    return {
      nbPrevisionsRapprochees: 0,
      erreurMoyenneBp: null,
      tauxCouvertureBp: null,
      biaisMoyenCrepes: null,
      mapeGlissanteBp: null,
      nbSessionsMapeGlissante: 0,
      tauxRuptureBp: null,
      tauxInvenduBp: null,
      nbSessionsEcoulement: 0,
      predicteursPrecision: predicteursPrecision(base),
      syntheseManqueAGagner: syntheseManqueAGagner(base),
    };
  }

  // --- Les trois indicateurs EXISTANTS : inchangés (aucune prevision
  // existante ne doit changer d'un iota) ------------------------------------
  const erreurs = rapprochees.map((r) => r.erreurBp).filter((e): e is number => e !== null);
  const dansIntervalle = rapprochees.filter(
    (r) => r.reelles !== null && r.reelles >= r.p10 && r.reelles <= r.p90,
  ).length;
  const biais = rapprochees.reduce((somme, r) => somme + ((r.reelles ?? 0) - r.p50), 0);

  // --- Indicateurs PAR SESSION (MAPE glissante, taux de rupture, taux
  // d'invendu) : une session peut avoir été prévisionnée plusieurs fois (J-7,
  // J-3, J-1…) avant sa clôture. On ne garde que la DERNIÈRE prévision
  // archivée par session — même choix que `impactMesureSession` — c'est la
  // plus proche de ce qui a réellement guidé la décision de production.
  const derniereParSession = new Map<string, (typeof rapprochees)[number]>();
  for (const r of rapprochees) {
    if (r.sessionId === null || r.dateSession === null) continue;
    const existante = derniereParSession.get(r.sessionId);
    if (existante === undefined || r.dateCalcul > existante.dateCalcul) {
      derniereParSession.set(r.sessionId, r);
    }
  }
  const sessionsUniques = [...derniereParSession.values()].sort((a, b) =>
    b.dateSession!.localeCompare(a.dateSession!),
  );

  const fenetreGlissante = sessionsUniques.slice(0, 10);
  const erreursGlissantes = fenetreGlissante
    .map((r) => r.erreurBp)
    .filter((e): e is number => e !== null);

  const parametres = lireParametres(base);
  const seuilRuptureBp = parametres.pointsDeBase('prevision_session_consecutive_seuil_rupture_bp');
  const ecoulement = tauxEcoulement(
    sessionsUniques.map((r) => ({
      crepesProduites: r.crepesProduites ?? 0,
      crepesInvendues: r.crepesInvendues ?? 0,
    })),
    seuilRuptureBp,
  );

  return {
    nbPrevisionsRapprochees: rapprochees.length,
    erreurMoyenneBp:
      erreurs.length === 0 ? null : Math.round(erreurs.reduce((s, e) => s + e, 0) / erreurs.length),
    tauxCouvertureBp: ratioEnPointsDeBase(dansIntervalle, rapprochees.length),
    biaisMoyenCrepes: Math.round(biais / rapprochees.length),
    mapeGlissanteBp:
      erreursGlissantes.length === 0
        ? null
        : Math.round(erreursGlissantes.reduce((s, e) => s + e, 0) / erreursGlissantes.length),
    nbSessionsMapeGlissante: erreursGlissantes.length,
    tauxRuptureBp: ecoulement.tauxRuptureBp,
    tauxInvenduBp: ecoulement.tauxInvenduBp,
    nbSessionsEcoulement: ecoulement.nbSessions,
    predicteursPrecision: predicteursPrecision(base),
    syntheseManqueAGagner: syntheseManqueAGagner(base),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Evenements
   ═══════════════════════════════════════════════════════════════════════════ */

export function listerEvenements(base: BaseBatte) {
  return base.select().from(evenement).orderBy(desc(evenement.dateDebut)).all();
}

export type EntreeEvenement = {
  readonly nom: string;
  readonly type: (typeof evenement.$inferInsert)['type'];
  readonly dateDebut: string;
  readonly dateFin: string;
  readonly portee: (typeof evenement.$inferInsert)['portee'];
  readonly intensiteEstimee: number;
  readonly impactEstimeBp: number;
  readonly source?: string | null;
  readonly notes?: string | null;
};

export function creerEvenement(base: BaseBatte, entree: EntreeEvenement): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  base
    .insert(evenement)
    .values({
      id,
      nom: entree.nom,
      type: entree.type,
      dateDebut: entree.dateDebut,
      dateFin: entree.dateFin,
      portee: entree.portee,
      intensiteEstimee: entree.intensiteEstimee,
      impactEstimeBp: entree.impactEstimeBp,
      source: entree.source ?? null,
      // Saisi a la main : valide d'office. Seule une proposition IA arrive a faux.
      valideParHumain: true,
      notes: entree.notes ?? null,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  return id;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Meteo
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Horizon (en jours) entre la RECUPERATION d'un releve et le jour observe.
 *
 * `0` pour un releve REEL (D-058) : on observe le jour meme, par definition.
 * Pour une PREVISION, c'est l'ecart entre la date de recuperation et la date
 * observee — EXACTEMENT ce que le predicteur « ecart meteo prevue/realisee »
 * de la fiche 07 doit pouvoir mesurer (une prevision a J-7 ne vaut pas une
 * prevision a J-1). Calcule ici, jamais fourni par l'appelant : deterministe
 * a partir de deux dates deja connues, une troisieme saisie serait une
 * ressaisie qui pourrait diverger des deux autres.
 */
function horizonJoursReleve(entree: {
  type: 'prevision' | 'reelle';
  dateObservation: string;
  recupereLe: string;
}): number {
  if (entree.type === 'reelle') return 0;
  const dateRecuperation = jourCivilBelge(new Date(entree.recupereLe));
  return Math.round(ageJours(entree.dateObservation, dateRecuperation));
}

/**
 * Enregistre ou remplace un releve meteo pour un lieu, une date ET un
 * horizon (D-058, migration `0015_smooth_gabe_jones.sql`).
 *
 * L'index unique portait auparavant sur (lieu, date, type) seuls : une
 * prevision recuperee a J-3 ecrasait donc silencieusement celle de J-7, alors
 * que c'est cet ecart meme que la fiche 07 doit mesurer. Deux previsions du
 * meme jour observe, a des echeances differentes, sont deux FAITS distincts
 * — le `ON CONFLICT` ne doit ecraser que le re-telechargement du MEME
 * horizon (un rafraichissement manuel le meme jour, par exemple).
 */
export function enregistrerMeteo(
  base: BaseBatte,
  entree: {
    lieuId: string;
    dateObservation: string;
    type: 'prevision' | 'reelle';
    temperatureC: number;
    precipitationsMm: number;
    ventKmh: number;
    couvertureNuageuseBp: number;
    recupereLe: string;
    /**
     * Quatre colonnes longtemps inremplissables (audit du 30/07/2026) :
     * `apps/api/src/meteo/open-meteo.ts` ne demandait jamais les variables
     * Open-Meteo correspondantes. Il les demande desormais, et les porte sur
     * `ReleveMeteo` — TOUJOURS optionnelles, pour deux raisons distinctes qui
     * doivent toutes les deux ecrire `null`, jamais `0` (CLAUDE.md §7) :
     *
     *  - champ ABSENT (`undefined`) : `obtenirMeteo` (apps/api/src/routes/
     *    previsions.ts) reconstruit parfois un releve depuis le CACHE
     *    (`lireMeteo`), qui ne relit pas ces quatre champs — l'appelant omet
     *    alors la cle plutot que d'inventer une valeur ;
     *  - champ present mais `null` : Open-Meteo a ete interroge et n'a rendu
     *    AUCUNE valeur pour cette variable precise sur la fenetre.
     *
     * Ce depot ne fait qu'ECRIRE ce qu'on lui donne : la distinction entre
     * « jamais demande » et « demande, rien reçu » appartient a l'appelant,
     * pas a lui — les deux se resolvent identiquement ici, par `?? null`.
     * Une vraie valeur `0` (ex. 0 % de risque de pluie, un temps sec certain)
     * n'est PAS neutralisee par ce `??` : seuls `null`/`undefined` le sont.
     */
    temperatureRessentieC?: number | null | undefined;
    /** Points de base (10000 = 100 %) — jamais un pourcentage brut. */
    probabilitePluieBp?: number | null | undefined;
    /** Code meteo OMM dominant sur la fenetre. */
    codeMeteo?: number | null | undefined;
    /**
     * Tranche brute de la reponse Open-Meteo restreinte a la fenetre de
     * marche (`DonneesBrutesFenetre`, apps/api/src/meteo/open-meteo.ts) —
     * typee `unknown` ici : ce depot (`packages/db`) ne doit pas dependre
     * d'un type defini dans `apps/api`, la dependance va dans l'autre sens.
     * Colonne JSON (`{ mode: 'json' }`) : Drizzle serialise/deserialise seul.
     */
    donneesBrutes?: unknown;
  },
): void {
  const horizon = horizonJoursReleve(entree);

  base
    .insert(meteoObservation)
    .values({
      id: nouvelIdentifiant(),
      lieuId: entree.lieuId,
      dateObservation: entree.dateObservation,
      type: entree.type,
      temperatureC: entree.temperatureC,
      temperatureRessentieC: entree.temperatureRessentieC ?? null,
      precipitationsMm: entree.precipitationsMm,
      probabilitePluieBp: entree.probabilitePluieBp ?? null,
      ventKmh: entree.ventKmh,
      couvertureNuageuseBp: entree.couvertureNuageuseBp,
      codeMeteo: entree.codeMeteo ?? null,
      donneesBrutes: entree.donneesBrutes ?? null,
      recupereLe: entree.recupereLe,
      horizonJours: horizon,
    })
    .onConflictDoUpdate({
      target: [
        meteoObservation.lieuId,
        meteoObservation.dateObservation,
        meteoObservation.type,
        meteoObservation.horizonJours,
      ],
      set: {
        temperatureC: entree.temperatureC,
        temperatureRessentieC: entree.temperatureRessentieC ?? null,
        precipitationsMm: entree.precipitationsMm,
        probabilitePluieBp: entree.probabilitePluieBp ?? null,
        ventKmh: entree.ventKmh,
        couvertureNuageuseBp: entree.couvertureNuageuseBp,
        codeMeteo: entree.codeMeteo ?? null,
        donneesBrutes: entree.donneesBrutes ?? null,
        recupereLe: entree.recupereLe,
        horizonJours: horizon,
      },
    })
    .run();
}

/** Dernier releve conserve pour un lieu et une date, quel qu'en soit le type. */
export function lireMeteo(base: BaseBatte, lieuId: string, date: string) {
  return (
    base
      .select()
      .from(meteoObservation)
      .where(and(eq(meteoObservation.lieuId, lieuId), eq(meteoObservation.dateObservation, date)))
      .orderBy(desc(meteoObservation.type))
      .get() ?? null
  );
}

/** Jour civil belge courant. Regroupe ici pour que les routes n'aient pas a le refaire. */
export function aujourdHui(): string {
  return jourCivilBelge(new Date());
}

/* ═══════════════════════════════════════════════════════════════════════════
   docs/demandes/06 — Prevision calendaire et achats anticipes

   Trois lectures nouvelles, aucun calcul de prevision ici (meme regle que le
   reste du fichier) : les dates candidates de l'horizon, la repartition
   mesuree entre recettes actives, et ce que les commandes ouvertes couvrent
   deja par ingredient. `apps/api/src/routes/previsions.ts` compose ces
   lectures avec `prevoir()`, `besoinsIngredients()` et
   `alerteCommandeAnticipee()` (packages/core/src/prevision) pour produire la
   prevision calendaire et le point de commande predictif.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une date candidate de prevision calendaire : un lieu, un jour, une session deja creee ou non. */
export type OccurrenceCandidate = {
  readonly lieuId: string;
  readonly lieuNom: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly heureDebut: string | null;
  readonly heureFin: string | null;
  readonly dateSession: string;
  /** `null` : occurrence RECURRENTE dont aucune session n'a encore ete creee. */
  readonly sessionId: string | null;
};

/**
 * Dates candidates de la prevision calendaire, sur `[depuis, depuis +
 * horizonJours[`.
 *
 * Une occurrence par lieu ACTIF et par semaine pour les lieux recurrents
 * (`lieuMarche.jourSemaine`, La Batte tous les dimanches) — voir
 * `occurrencesJourSemaine` (packages/core/src/prevision/calendrier.ts) —
 * UNIONNEE aux sessions deja PLANIFIEES dans la fenetre, qu'elles tombent ou
 * non sur le jour habituel (un marche exceptionnel un samedi, par exemple).
 *
 * Dedoublonnee par (lieu, date) : une session deja creee pour une date
 * recurrente porte alors son VRAI `sessionId`, jamais `null` — c'est ce qui
 * permet a l'appelant de relier une prevision calendaire a l'archivage
 * existant (`archiverPrevision`) quand la session existe deja.
 */
export function occurrencesCandidates(
  base: BaseBatte,
  depuis: string,
  horizonJours: number,
): OccurrenceCandidate[] {
  const lieux = base
    .select({
      id: lieuMarche.id,
      nom: lieuMarche.nom,
      latitude: lieuMarche.latitude,
      longitude: lieuMarche.longitude,
      heureDebut: lieuMarche.heureDebut,
      heureFin: lieuMarche.heureFin,
      jourSemaine: lieuMarche.jourSemaine,
    })
    .from(lieuMarche)
    .where(eq(lieuMarche.actif, true))
    .all();

  const cle = (lieuId: string, date: string): string => `${lieuId}|${date}`;
  const parCle = new Map<string, OccurrenceCandidate>();

  for (const lieu of lieux) {
    if (lieu.jourSemaine === null) continue;
    for (const date of occurrencesJourSemaine(lieu.jourSemaine, depuis, horizonJours)) {
      parCle.set(cle(lieu.id, date), {
        lieuId: lieu.id,
        lieuNom: lieu.nom,
        latitude: lieu.latitude,
        longitude: lieu.longitude,
        heureDebut: lieu.heureDebut,
        heureFin: lieu.heureFin,
        dateSession: date,
        sessionId: null,
      });
    }
  }

  const fin = ajouterJours(depuis, Math.max(0, horizonJours));
  const sessionsPlanifiees = base
    .select({
      id: sessionMarche.id,
      lieuId: sessionMarche.lieuId,
      dateSession: sessionMarche.dateSession,
    })
    .from(sessionMarche)
    .where(
      and(
        eq(sessionMarche.statut, 'planifiee'),
        gte(sessionMarche.dateSession, depuis),
        lte(sessionMarche.dateSession, fin),
      ),
    )
    .all();

  const lieuxParId = new Map(lieux.map((l) => [l.id, l]));
  for (const session of sessionsPlanifiees) {
    const lieu = lieuxParId.get(session.lieuId);
    // Lieu desactive entre la creation de la session et ce calcul : on ignore
    // cette occurrence plutot que de faire echouer tout l'horizon pour elle.
    if (lieu === undefined) continue;
    parCle.set(cle(session.lieuId, session.dateSession), {
      lieuId: session.lieuId,
      lieuNom: lieu.nom,
      latitude: lieu.latitude,
      longitude: lieu.longitude,
      heureDebut: lieu.heureDebut,
      heureFin: lieu.heureFin,
      dateSession: session.dateSession,
      sessionId: session.id,
    });
  }

  return [...parCle.values()].sort((a, b) => a.dateSession.localeCompare(b.dateSession));
}

export type PartRecetteHistorique = {
  readonly recetteId: string;
  readonly partBp: PointsDeBase;
};

/**
 * Part de chaque recette ACTIVE dans les crepes produites, MESUREE sur
 * l'historique de production — jamais une repartition egale devinee entre
 * plusieurs recettes actives sans historique pour les departager (meme
 * principe que D-059 : « on ne remplace pas un prior neutre par du bruit »,
 * applique ici a une mesure absente plutot qu'a un prior).
 *
 * `null` : PLUSIEURS recettes actives coexistent SANS aucun historique de
 * production pour les departager. Ce n'est pas la meme chose qu'une recette
 * unique (100 % lui revient trivialement, sans avoir besoin de mesure) ni
 * qu'un historique qui tranche deja. docs/17 fiche 5 (repartition R1/R2 DANS
 * LE MOTEUR de production, qui decide quoi produire) reste hors perimetre
 * ici : cette fonction ne modelise pas laquelle SERA produite, elle mesure
 * laquelle L'A ete — seul le besoin en ingredients projete s'en sert.
 */
export function partsRecettesActives(base: BaseBatte): readonly PartRecetteHistorique[] | null {
  const actives = base
    .select({ id: recette.id })
    .from(recette)
    .where(eq(recette.statut, 'active'))
    .all();
  if (actives.length === 0) return [];
  if (actives.length === 1) return [{ recetteId: actives[0]!.id, partBp: BASE_POINTS }];

  const productions = base
    .select({
      recetteId: production.recetteId,
      crepesTheoriques: production.crepesTheoriques,
      crepesReelles: production.crepesReelles,
    })
    .from(production)
    .where(ne(production.statut, 'annulee'))
    .all();

  const totalParRecette = new Map<string, number>();
  let total = 0;
  for (const p of productions) {
    const crepes = p.crepesReelles ?? p.crepesTheoriques;
    totalParRecette.set(p.recetteId, (totalParRecette.get(p.recetteId) ?? 0) + crepes);
    total += crepes;
  }
  // Plusieurs recettes actives, aucune observation exploitable : ambigu, on
  // ne devine pas — voir la doc de la fonction.
  if (total <= 0) return null;

  return actives.map((r) => ({
    recetteId: r.id,
    partBp: Math.round(((totalParRecette.get(r.id) ?? 0) / total) * BASE_POINTS),
  }));
}

export type IngredientReappro = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly unite: Unite;
  readonly delaiLivraisonJours: number;
};

/**
 * Ingredients ACTIFS dont le delai de livraison est renseigne — meme filtre
 * que `genererBrouillonsCommandes` (services/commandes.ts) pour le
 * declencheur REACTIF : sans delai connu, aucune fenetre PREDICTIVE
 * (`fenetrePredictive`, packages/core/src/prevision/point-commande-
 * predictif.ts) n'est calculable, exactement comme aucun point de commande
 * reactif ne l'est.
 */
export function ingredientsActifsAvecDelai(base: BaseBatte): readonly IngredientReappro[] {
  const actifs = base
    .select({
      ingredientId: ingredient.id,
      nomIngredient: ingredient.nom,
      unite: ingredient.uniteReference,
      delaiLivraisonJours: ingredient.delaiLivraisonJours,
    })
    .from(ingredient)
    .where(eq(ingredient.actif, true))
    .all();

  const resultat: IngredientReappro[] = [];
  for (const i of actifs) {
    if (i.delaiLivraisonJours === null) continue;
    resultat.push({
      ingredientId: i.ingredientId,
      nomIngredient: i.nomIngredient,
      unite: i.unite,
      delaiLivraisonJours: i.delaiLivraisonJours,
    });
  }
  return resultat;
}

/**
 * Quantite deja engagee sur des commandes OUVERTES (brouillon, validee ou
 * envoyee — pas encore recues ni annulees), pour un ingredient.
 *
 * Meme definition EXACTE que `quantiteDejaCommandee`, privee a
 * `services/commandes.ts` : dupliquee ici plutot qu'importee, ce fichier
 * etant en LECTURE SEULE pour cet agent (voir le rapport de livraison —
 * fusionner les deux si `commandes.ts` s'ouvre un jour a l'ecriture).
 */
export function quantiteDejaCommandeeIngredient(base: BaseBatte, ingredientId: string): number {
  const resultat = base
    .select({ total: sql<number | null>`SUM(${commandeLigne.quantiteUniteRef})` })
    .from(commandeLigne)
    .innerJoin(commandeFournisseur, eq(commandeLigne.commandeId, commandeFournisseur.id))
    .where(
      and(
        eq(commandeLigne.ingredientId, ingredientId),
        inArray(commandeFournisseur.statut, ['brouillon', 'validee', 'envoyee']),
      ),
    )
    .get();
  return resultat?.total ?? 0;
}

/**
 * Stock PROJETE d'un ingredient a la date de reference : disponible +
 * deja commande sur des commandes ouvertes — meme definition que
 * `stockProjete` dans `calculerBesoinReapprovisionnement`
 * (packages/core/src/reapprovisionnement.ts), reutilisee ici pour le
 * declencheur PREDICTIF plutot que recalculee a la main.
 */
export function stockProjeteIngredient(
  base: BaseBatte,
  ingredientId: string,
  jourReference: string,
): number {
  const lots = lotsDeLIngredient(base, ingredientId);
  return (
    quantiteDisponible(lots, jourReference) + quantiteDejaCommandeeIngredient(base, ingredientId)
  );
}

/**
 * Serie de consommation JOUR CALENDAIRE PAR JOUR CALENDAIRE d'un ingredient,
 * sur une fenetre se terminant a `jourReference` inclus.
 *
 * Meme requete EXACTE que `serieConsommationJournaliere`, privee a
 * `services/commandes.ts` — dupliquee ici pour la MEME raison que
 * `quantiteDejaCommandeeIngredient` ci-dessus : ce fichier est en LECTURE
 * SEULE pour cet agent. Alimente le declencheur REACTIF de comparaison
 * (`calculerPointCommande` + `calculerBesoinBrut`, packages/core/src/
 * reapprovisionnement.ts) pour que la prevision calendaire puisse dire quel
 * declencheur — reactif, predictif, ou les deux — a fait sonner l'alerte
 * (docs/demandes/06 §3 : « les deux coexistent, le plus contraignant des
 * deux declenche l'alerte »).
 */
export function serieConsommationJournaliereIngredient(
  base: BaseBatte,
  ingredientId: string,
  jourReference: string,
  fenetreJours: number,
): number[] {
  const depuis = ajouterJours(jourReference, -(fenetreJours - 1));

  const lignes = base
    .select({
      jour: mouvementStock.dateMouvement,
      quantite: sql<number>`SUM(${mouvementStock.quantite})`,
    })
    .from(mouvementStock)
    .where(
      and(
        eq(mouvementStock.ingredientId, ingredientId),
        inArray(mouvementStock.type, ['sortie_production', 'sortie_vente']),
        eq(mouvementStock.isAnnule, false),
        gte(mouvementStock.dateMouvement, depuis),
        lte(mouvementStock.dateMouvement, jourReference),
      ),
    )
    .groupBy(mouvementStock.dateMouvement)
    .all();

  const parJour = new Map(lignes.map((l) => [l.jour, l.quantite]));

  const serie: number[] = [];
  for (let i = 0; i < fenetreJours; i++) {
    serie.push(parJour.get(ajouterJours(depuis, i)) ?? 0);
  }
  return serie;
}
