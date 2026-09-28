/**
 * Routes `/api/prevision`, `/api/evenements` et `/api/qualite-modele` (Lot 5).
 *
 * Cette route ORCHESTRE, elle ne calcule pas : elle rassemble l'historique, la
 * meteo et les contraintes, puis appelle le moteur pur de `packages/core`.
 * Aucun chiffre de prevision n'est produit ici.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  ErreurMetier,
  ageJours,
  ajouterJours,
  alerteCommandeAnticipee,
  bandeHorizon,
  besoinsIngredients,
  calculerBaseline,
  calculerBesoinBrut,
  calculerFacteurMeteoMesure,
  calculerPointCommande,
  calculerPredicteursPrecision,
  calculerSaisonRetenue,
  calculerTendanceRetenue,
  classerMeteo,
  classerObservationsMeteo,
  combinerDeclencheurs,
  confianceHorizonBp,
  contraintesSession,
  dansFenetre,
  estPremierPassage,
  facteurMeteo,
  fenetrePredictive,
  formaterDate,
  formaterQuantite,
  inflationHorizonBp,
  intervalleExploitable,
  mettreAEchelle,
  profilConsommation,
  prevoir,
  schemaArchivagePrevision,
  schemaCommentaireIa,
  schemaCreationEvenement,
  schemaListeEvenements,
  schemaListePrevisions,
  schemaPrevision,
  schemaPrevisionCalendaire,
  schemaQualiteModele,
  statutStock,
  type BandeHorizon,
  type CleParametre,
  type ConditionsMeteo,
  type ConfigInflationHorizon,
  type ConfigRepartitionProduction,
  type ConfigSaison,
  type ConfigTendance,
  type ContrainteProduction,
  type DeclencheurReappro,
  type PartRecette,
  type Parametres,
  type PointsDeBase,
  type RecetteRepartition,
} from '@batte/core';
import {
  archiverPrevision,
  aujourdHui,
  chargerRecettePourCalcul,
  coutsNewsvendor,
  creerEvenement,
  enregistrerMeteo,
  etatDuStock,
  evenementsDuJour,
  facteurEvenementBp,
  ingredientsActifsAvecDelai,
  lireMeteo,
  lireParametres,
  listerEvenements,
  listerPrevisions,
  listerRecettes,
  lotsAlerteDlc,
  observationsCompletesDuLieu,
  observationsDuLieu,
  observationsMeteoDuLieu,
  occurrencesCandidates,
  pairesMeteoDuLieu,
  partsRecettesActives,
  periodesVacancesScolaires,
  prochaineSessionPlanifiee,
  qualiteModele,
  schema,
  serieConsommationJournaliereIngredient,
  stockProjeteIngredient,
  verifierFaisabilite,
  type BaseBatte,
  type IngredientReappro,
  type OccurrenceCandidate,
} from '@batte/db';
import { briefAvantMarche } from '../documents/gabarits.js';
import { rendrePdf } from '../documents/rendu.js';
import { demanderCommentaire } from '../ia/client.js';
// `briefAvantMarche` d'`ia/usages.js` est l'HOMONYME du gabarit PDF importé
// ci-dessus (`../documents/gabarits.js`) — une chose entièrement différente
// (une consigne Claude, pas un rendu HTML). C'est précisément cette
// homonymie qui a retardé la découverte que ce prompt n'était jamais câblé
// (docs/05-DECISIONS.md D-087) : l'alias ci-dessous lève l'ambiguïté au lieu
// de la reproduire dans ce fichier.
import {
  commentaireDePrevision,
  briefAvantMarche as demandeCommentaireBrief,
} from '../ia/usages.js';
import { releverMeteo, type ResultatReleve } from '../meteo/open-meteo.js';
import { LIMITE_APPEL_EXTERNE, LIMITE_GENERATION_DOCUMENT } from '../plugins/limitation-debit.js';

/** Fenetre par defaut quand le lieu n'a pas d'horaires renseignes. */
const HEURE_DEBUT_DEFAUT = '08:00';
const HEURE_FIN_DEFAUT = '14:30';

/** Duree en minutes entre deux heures `HH:MM`. */
function dureeMinutes(debut: string, fin: string): number {
  const [hd, md] = debut.split(':').map(Number);
  const [hf, mf] = fin.split(':').map(Number);
  return (hf ?? 0) * 60 + (mf ?? 0) - ((hd ?? 0) * 60 + (md ?? 0));
}

/**
 * Recupere la meteo, en preferant le releve deja conserve.
 *
 * On n'interroge Open-Meteo que si l'on n'a rien en base pour ce jour : deux
 * previsions successives le meme dimanche ne doivent pas donner deux chiffres
 * differents a cause d'une mise a jour intermediaire du bulletin.
 */
async function obtenirMeteo(
  base: BaseBatte,
  /**
   * Champ nomme `lieuId` et non `id` : la requete de session expose a la fois
   * son propre `id` et `lieuId`, et confondre les deux passe le typage tout en
   * violant la cle etrangere de `meteo_observation` a l'execution.
   */
  lieu: { lieuId: string; latitude: number | null; longitude: number | null },
  date: string,
  heureDebut: string,
  heureFin: string,
  forcer: boolean,
  /**
   * Racine HTTP a interroger, INJECTABLE depuis les tests (CLAUDE.md — un test
   * qui depend du reseau n'est pas un test). `undefined` en production
   * (jamais fourni) : `releverMeteo` retombe alors sur son propre defaut,
   * la vraie racine Open-Meteo — voir `routesPrevisions` ci-dessous, seul
   * point qui peuple ce parametre.
   */
  racineUrlMeteo?: string,
): Promise<ResultatReleve> {
  if (!forcer) {
    const conserve = lireMeteo(base, lieu.lieuId, date);
    if (
      conserve !== null &&
      conserve.temperatureC !== null &&
      conserve.precipitationsMm !== null &&
      conserve.ventKmh !== null &&
      conserve.couvertureNuageuseBp !== null
    ) {
      return {
        disponible: true,
        releve: {
          conditions: {
            temperatureC: conserve.temperatureC,
            precipitationsMm: conserve.precipitationsMm,
            ventKmh: conserve.ventKmh,
            couvertureNuageuseBp: conserve.couvertureNuageuseBp,
          },
          recupereLe: conserve.recupereLe,
        },
      };
    }
  }

  if (lieu.latitude === null || lieu.longitude === null) {
    return {
      disponible: false,
      raison:
        'Le lieu n’a pas de coordonnées. Renseignez sa latitude et sa longitude ' +
        'pour activer le facteur météo.',
    };
  }

  const resultat = await releverMeteo(
    {
      latitude: lieu.latitude,
      longitude: lieu.longitude,
      date,
      heureDebut,
      heureFin,
    },
    // `maintenant` : toujours l'horloge reelle ici, seule `racineUrlMeteo` est
    // injectable depuis ce point d'appel. `undefined` declenche le defaut de
    // `releverMeteo` (`() => new Date()`) exactement comme avant ce lot.
    undefined,
    racineUrlMeteo,
  );

  if (resultat.disponible) {
    enregistrerMeteo(base, {
      lieuId: lieu.lieuId,
      dateObservation: date,
      type: 'prevision',
      ...resultat.releve.conditions,
      recupereLe: resultat.releve.recupereLe,
      // Quatre colonnes fraichement branchees (defaut 1) : desormais ecrites
      // jusqu'en base plutot que jetees. Chaque champ est optionnel sur
      // `ReleveMeteo` (voir sa doc dans `apps/api/src/meteo/open-meteo.ts`) —
      // `enregistrerMeteo` (packages/db) neutralise un `undefined`/`null` en
      // `null`, jamais en `0`.
      temperatureRessentieC: resultat.releve.temperatureRessentieC,
      probabilitePluieBp: resultat.releve.probabilitePluieBp,
      codeMeteo: resultat.releve.codeMeteo,
      donneesBrutes: resultat.releve.donneesBrutes,
    });
  }

  return resultat;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Prédicteurs de précision (docs/demandes/07 §2) et facteur météo MESURÉ par
   catégorie (docs/17 fiches 2/4, décision D-059)

   DÉPLACÉS vers `packages/core/src/prevision/predicteurs-precision.ts` et
   `packages/core/src/prevision/meteo-mesuree.ts` (`docs/26-AUDIT-DIX-
   REGLES.md`, règle 1 : ce calcul métier — validation croisée leave-one-out,
   estimation du facteur météo mesuré — vivait ici, dans un handler HTTP,
   testé uniquement par intégration HTTP et absent du calcul de couverture de
   `packages/core`). Aucune formule n'a changé : `calculerPredicteursPrecision`
   et `calculerFacteurMeteoMesure` sont appelés ci-dessous EXACTEMENT comme
   avant, seule leur définition a changé d'adresse. Chacun est désormais
   testé unitairement dans son propre fichier `*.test.ts`, avec les cas
   limites que l'intégration HTTP ne visite jamais (échantillon vide, une
   seule session, valeurs identiques).
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   Saison et tendance MESURÉES (docs/17 fiche 3, docs/03 facteurs 4 et 5)

   Même défaut de fond que la météo ci-dessus (D-059) : `saisonBp`/`tendanceBp`
   valaient BASE_POINTS en dur (`packages/db/src/depots/previsions.ts`), et
   l'écran affichait « × 1,00 » — indiscernable d'une mesure. Ce qui suit
   mesure, puis ne laisse le résultat entrer dans le calcul qu'après
   validation croisée leave-one-out, EXACTEMENT comme la météo : trois états
   distincts, jamais confondus — « non modélisée » (démarrage à froid),
   « mesurée » (admise), « rejetée par validation croisée » (mesurée mais pas
   admise). C'est pourquoi ces deux facteurs ne suivent PAS le patron plus
   simple des quatre prédicteurs de précision ci-dessus (`PredicteurRetenu`,
   admis/non-admis sans distinguer la raison) : docs/17 fiche 3 exige
   explicitement que l'écran puisse dire LAQUELLE des trois raisons
   s'applique, pas seulement si le facteur est actif.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `entierAvecRepli` plutôt que `parametres.entier()` direct, même choix que
 * `configInflationHorizon` ci-dessus (D-045 : un `GET` ne doit jamais
 * répondre 500 faute d'un paramètre absent de la BASE). Attention à la
 * distinction : une clé peut être au CATALOGUE
 * (`packages/core/src/parametres.ts`) sans être encore dans la BASE du
 * porteur, tant qu'un `db:seed` ne l'y a pas écrite. C'est ce second cas que
 * le repli couvre. Il lit la valeur dès qu'elle existe, et retombe SINON sur
 * la valeur documentée ci-dessous — jamais une valeur inventée pour le RÉSULTAT du
 * modèle (voir les commentaires de `saison.ts`/`tendance.ts`/`repartition-
 * production.ts` : les trois reculs ci-dessous sont des seuils de MÉTHODE
 * repris tels quels de docs/03 ou du principe « aucun prior non neutre »,
 * jamais un chiffre métier deviné).
 */
function configSaisonDepuisParametres(parametres: Parametres): ConfigSaison {
  return {
    observationsMinimum: entierAvecRepli(parametres, 'prevision_saison_observations_minimum', 3),
    moisDistinctsMinimum: entierAvecRepli(parametres, 'prevision_saison_mois_distincts_minimum', 4),
    demiVieJours: parametres.entier('prevision_demi_vie_ponderation_jours'),
  };
}

function configTendanceDepuisParametres(parametres: Parametres): ConfigTendance {
  return {
    // docs/03 : « Neutre (1,00) tant que n < 10 ».
    sessionsMinimum: entierAvecRepli(parametres, 'prevision_tendance_sessions_minimum', 10),
    // docs/03 : « régression … sur les 12 dernières sessions ».
    fenetreSessions: entierAvecRepli(parametres, 'prevision_tendance_fenetre_sessions', 12),
    // docs/03 : « Bornée à ±30 % ».
    borneBp: entierAvecRepli(parametres, 'prevision_tendance_borne_bp', 3000),
  };
}

// `FacteurBaseRetenu`, `calculerSaisonRetenue` et `calculerTendanceRetenue`
// (le même mécanisme à trois états — « non modélisée » / « rejetée par
// validation croisée » / « mesurée » — que ci-dessus pour la météo) ont
// DÉMÉNAGÉ vers `packages/core/src/prevision/facteurs-retenus.ts`
// (`docs/26-AUDIT-DIX-REGLES.md`, règle 1). Seule différence de FORME : ces
// deux fonctions reçoivent maintenant `config` déjà assemblée (voir l'en-tête
// du module core) plutôt que de la construire elles-mêmes via
// `configSaisonDepuisParametres`/`configTendanceDepuisParametres` — ce que
// les deux appels ci-dessous font désormais explicitement. Même valeurs,
// même repli, aucun changement de résultat.

/* ═══════════════════════════════════════════════════════════════════════════
   Plan de production (docs/17 fiche 5)

   docs/03 : « part_R2 = moyenne lissée de la part R2 des N dernières sessions
   […] plancher de sécurité […] conversion en litres arrondie au demi-litre. »
   `partsRecettesActives` (packages/db/src/depots/previsions.ts) mesure déjà
   la part de chaque recette active sur l'historique RÉEL de production — le
   même mécanisme que docs/17 fiche 5 identifie comme le préalable ; ce qui
   suit assemble ce que `repartitionProduction` (packages/core) a besoin de
   savoir en plus : le rendement et le statut « sans gluten » de chaque
   recette, lus depuis `listerRecettes`.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `null` : plusieurs recettes actives coexistent sans historique de
 * production pour les départager (même convention que `partsRecettesActives`
 * — l'appelant doit alors OMETTRE le plan de production plutôt que d'en
 * inventer un). `[]` : aucune recette active.
 */
function recettesPourRepartition(base: BaseBatte): readonly RecetteRepartition[] | null {
  const parts = partsRecettesActives(base);
  if (parts === null) return null;
  if (parts.length === 0) return [];

  const resumes = new Map(listerRecettes(base).map((r) => [r.id, r]));
  const resultat: RecetteRepartition[] = [];
  for (const part of parts) {
    const resume = resumes.get(part.recetteId);
    if (resume === undefined) continue; // recette supprimee entre-temps.
    resultat.push({
      recetteId: part.recetteId,
      code: resume.code,
      sansGluten: resume.sansGluten,
      rendementReferenceMl: resume.rendementReferenceMl,
      rendementReferenceCrepes: resume.rendementReferenceCrepes,
      partMesureeBp: part.partBp,
    });
  }
  return resultat;
}

function configRepartitionDepuisParametres(parametres: Parametres): ConfigRepartitionProduction {
  return {
    // `0` désactive le plancher : docs/03 en demande un, mais ne chiffre
    // aucun pourcentage — en inventer un serait le prior non neutre interdit.
    plancherSansGlutenBp: entierAvecRepli(
      parametres,
      'prevision_repartition_plancher_sans_gluten_bp',
      0,
    ),
    // docs/03 : « conversion en litres arrondie au demi-litre » → 500 ml.
    arrondiVolumeMl: entierAvecRepli(parametres, 'prevision_repartition_arrondi_volume_ml', 500),
  };
}

/**
 * Distance en jours entre `jour` (aujourd'hui, jour civil belge) et la session.
 *
 * `0` quand la session tombe LE JOUR MEME — ce qui arrive un dimanche sur
 * sept a La Batte, puisque `prochainJourDeMarche`
 * (`packages/db/src/seed/demonstration.ts`) et `prochaineSessionPlanifiee`
 * rendent le jour meme quand on y est deja. Ecrete a 0 par le bas : une
 * session deja passee n'est plus la prochaine session planifiee, mais un
 * horizon NEGATIF transmis a `ecartMeteoPrevueRealisee` y produirait une
 * inflation d'intervalle inversee.
 *
 * Fonction PURE et exportee pour etre testee directement, horloge figee, sur
 * les deux cas qui comptent (horizon nul et horizon positif) — meme convention
 * que `sommerJoursExploitables` et `previsionPourDateCandidate` plus bas.
 */
export function horizonJoursSession(dateSession: string, jour: string): number {
  return Math.max(0, ageJours(dateSession, jour));
}

/**
 * Calcule la prevision de la prochaine session.
 *
 * Une seule implementation, utilisee par l'affichage ET par l'archivage : si les
 * deux divergeaient, on archiverait un chiffre que l'utilisateur n'a jamais vu.
 */
async function previsionCourante(
  base: BaseBatte,
  rafraichirMeteo: boolean,
  /** Voir la doc de `obtenirMeteo` ci-dessus — simple relai jusqu'à elle. */
  racineUrlMeteo?: string,
) {
  const jour = aujourdHui();
  const session = prochaineSessionPlanifiee(base, jour);
  if (session === null) {
    throw new ErreurMetier(
      'aucune_session_planifiee',
      'Aucune session à venir. Créez-en une dans Sessions pour obtenir une prévision.',
      { statut: 404 },
    );
  }

  const parametres = lireParametres(base, session.dateSession);

  /**
   * D-082 (`docs/05-DECISIONS.md`) : zéro session close sur CE lieu → aucune
   * prévision, jamais un chiffre appuyé entièrement sur l'estimation de
   * départ (`prevision_prior_baseline_crepes`). Vérifié ICI, AVANT tout appel
   * réseau météo ou calcul des cinq prédicteurs de précision : rien de tout
   * cela ne sert un écran qui n'affichera aucun nombre. Le seuil est STRICT
   * (`estPremierPassage`, `packages/core/src/prevision/baseline.ts`) — dès
   * qu'UNE session est close sur ce lieu, le mélange bayésien habituel de
   * `calculerBaseline` reprend intégralement, inchangé, avec sa confiance
   * déjà décroissante.
   *
   * Exprimé par une `ErreurMetier` plutôt qu'un champ nullable de
   * `schemaPrevision` : c'est EXACTEMENT le mécanisme déjà utilisé quelques
   * lignes plus haut pour la session sœur « aucune session planifiée » — même
   * écran, même famille de « rien à calculer », même traduction côté client
   * (`ProchaineSession.tsx`, `EtatEcran`). Restructurer `schemaPrevision` en
   * union discriminée aurait cassé la lecture, à plat, de ce contrat par
   * `TableauDeBord.tsx` et `apps/api/src/documents/gabarits.ts` — deux
   * fichiers hors de la zone d'écriture de cette mission.
   */
  const observations = observationsDuLieu(base, session.lieuId);
  if (estPremierPassage(observations.length)) {
    throw new ErreurMetier(
      'premier_passage_lieu',
      `Premier passage à ${session.lieuNom} : aucune session n’y a encore été close, donc ` +
        'aucune prévision de production n’est possible (décision D-082). Elle redeviendra ' +
        'disponible dès la clôture de la première session à cet endroit.',
    );
  }

  const heureDebut = session.heureDebut ?? HEURE_DEBUT_DEFAUT;
  const heureFin = session.heureFin ?? HEURE_FIN_DEFAUT;

  const releve = await obtenirMeteo(
    base,
    session,
    session.dateSession,
    heureDebut,
    heureFin,
    rafraichirMeteo,
    racineUrlMeteo,
  );

  const baseline = calculerBaseline(observations, jour, parametres);
  const couts = coutsNewsvendor(base);

  if (couts.coutRuptureCents <= 0) {
    throw new ErreurMetier(
      'couts_indisponibles',
      'Impossible de calculer la marge perdue par rupture : renseignez au moins ' +
        'une recette avec ses ingrédients et un produit transformé avec son prix.',
    );
  }

  const conditions: ConditionsMeteo | null = releve.disponible ? releve.releve.conditions : null;

  // Facteur météo MESURÉ par catégorie (docs/17 fiches 2/4, D-059) : calculé
  // et validé AVANT `prevoir()`, sur le même patron que les cinq prédicteurs
  // de précision ci-dessous. `null` en mode dégradé (pas de météo pour la
  // session à venir) : rien à classer, rien à mesurer.
  const minPointsValidationCroisee = parametres.entier(
    'prevision_validation_croisee_points_minimum',
  );
  const meteoMesure =
    conditions === null
      ? null
      : calculerFacteurMeteoMesure(
          classerObservationsMeteo(observationsMeteoDuLieu(base, session.lieuId), parametres),
          classerMeteo(conditions, parametres),
          facteurMeteo(conditions, parametres).facteurBp,
          session.dateSession,
          minPointsValidationCroisee,
          // Même seuil que la validation croisée globale ci-dessus (D-059) :
          // « assez d'observations » n'a pas besoin d'une seconde notion.
          minPointsValidationCroisee,
          parametres,
        );
  // Une SEULE chaîne, qui alimente à la fois le calcul (`prevoir`, dans sa
  // décomposition affichable) et l'affichage (`decrireMeteo`) : jamais deux
  // formulations qui pourraient diverger sur le même chiffre. Distingue
  // TOUJOURS prior et mesuré, y compris quand le prior est retenu — « D'où
  // vient ce chiffre » ne doit jamais laisser croire qu'un prior est une
  // mesure (docs/17 fiche 2, non négociable).
  const meteoExplication =
    conditions === null || meteoMesure === null
      ? null
      : `${facteurMeteo(conditions, parametres).explication} — ${meteoMesure.origine}`;

  const contraintes: ContrainteProduction[] = contraintesSession({
    fenetreMinutes: dureeMinutes(heureDebut, heureFin),
    // Volume par crepe : deduit du rendement de reference, jamais code en dur.
    volumeParCrepeMl: volumeParCrepe(base),
    stockMaximalCrepes: plafondStockCrepes(base, session.dateSession),
    parametres,
  });

  // Horizon de la prevision meteo COURANTE : combien de jours separent
  // aujourd'hui de la session a venir. Nomme et porte jusqu'au contrat
  // (D-098) parce qu'a horizon NUL le predicteur d'ecart meteo refuse, et
  // que l'ecran doit pouvoir le dire sans relire l'horloge lui-meme.
  const horizonMeteoJours = horizonJoursSession(session.dateSession, jour);

  // Cinq predicteurs de docs/demandes/07 §2, calcules et valides AVANT d'etre
  // transmis a `prevoir()` : voir « Prédicteurs de précision » ci-dessus.
  const predicteurs = calculerPredicteursPrecision(
    observations,
    observationsCompletesDuLieu(base, session.lieuId),
    pairesMeteoDuLieu(base, session.lieuId),
    periodesVacancesScolaires(parametres),
    session.dateSession,
    horizonMeteoJours,
    baseline.baselineCrepes,
    parametres,
  );

  // Saison et tendance MESURÉES (docs/17 fiche 3) : même garde-fou que la
  // météo par catégorie ci-dessus, calculées AVANT `prevoir()`. `config...
  // DepuisParametres` reste ici (lecture du catalogue, avec repli le temps
  // que les clés soient officialisées) ; `calculerSaisonRetenue`/
  // `calculerTendanceRetenue` (packages/core/src/prevision/facteurs-
  // retenus.ts) reçoivent la config déjà assemblée.
  const saison = calculerSaisonRetenue(
    observations,
    session.dateSession,
    minPointsValidationCroisee,
    configSaisonDepuisParametres(parametres),
    parametres,
  );
  const tendance = calculerTendanceRetenue(
    observations,
    session.dateSession,
    minPointsValidationCroisee,
    configTendanceDepuisParametres(parametres),
    parametres,
  );

  // Plan de production (docs/17 fiche 5) : `null` si plusieurs recettes
  // actives coexistent sans historique pour les départager — dans ce cas on
  // OMET `planProduction` plutôt que d'inventer une répartition égale.
  const recettesRepartition = recettesPourRepartition(base);
  const configRepartition = configRepartitionDepuisParametres(parametres);

  const resultat = prevoir(
    {
      baselineCrepes: baseline.baselineCrepes,
      nbSessionsObservees: baseline.nbSessionsRetenues,
      // Sigma MESURE transmis au moteur : sans lui, l'intervalle restait a son
      // coefficient de variation prior a vie, et la recommandation avec.
      sigmaObserve: baseline.sigmaObserve,
      meteo: conditions,
      evenementBp: facteurEvenementBp(base, session.dateSession),
      contraintes,
      ...couts,
      // La phrase distingue TOUJOURS prior et mesuré (voir plus haut) ; le
      // facteur MESURÉ, lui, ne remplace le prior dans le CALCUL que si
      // `meteoMesure.enUsage` — jamais avant (D-059).
      ...(meteoExplication !== null ? { meteoExplication } : {}),
      ...(meteoMesure !== null && meteoMesure.enUsage
        ? { meteoFacteurBp: meteoMesure.facteurBp }
        : {}),
      // Même garde : la saison/tendance MESURÉE ne remplace le neutre dans le
      // CALCUL que si elle a été admise (docs/17 fiche 3).
      ...(saison.enUsage ? { saisonBp: saison.facteurBp } : {}),
      ...(tendance.enUsage ? { tendanceBp: tendance.facteurBp } : {}),
      // Chaque champ n'est fourni QUE si son predicteur a ete ADMIS : un
      // predicteur non admis doit se comporter EXACTEMENT comme avant son
      // introduction (garantie de non-regression, `moteur.test.ts`).
      ...(predicteurs.comparableCalendaire.admis
        ? { comparableCalendaireBp: predicteurs.comparableCalendaire.facteurBp }
        : {}),
      ...(predicteurs.jourSemaine.admis
        ? { jourSemaineBp: predicteurs.jourSemaine.facteurBp }
        : {}),
      ...(predicteurs.vacancesScolaires.admis
        ? { vacancesScolairesBp: predicteurs.vacancesScolaires.facteurBp }
        : {}),
      ...(predicteurs.sessionConsecutive.admis
        ? { sessionConsecutiveBp: predicteurs.sessionConsecutive.facteurBp }
        : {}),
      ...(predicteurs.ecartMeteo.admis
        ? { inflationSigmaMeteoBp: predicteurs.ecartMeteo.facteurBp }
        : {}),
      // Plan de production (docs/17 fiche 5) : omis si aucune recette active
      // exploitable n'a pu être mesurée — `resultat.repartition` vaut alors
      // `[]`, jamais une répartition inventée.
      ...(recettesRepartition !== null && recettesRepartition.length > 0
        ? { planProduction: { recettes: recettesRepartition, config: configRepartition } }
        : {}),
    },
    parametres,
  );

  return {
    session,
    parametres,
    releve,
    conditions,
    meteoExplication,
    baseline,
    couts,
    contraintes,
    predicteurs,
    horizonMeteoJours,
    saison,
    tendance,
    recettesRepartition,
    resultat,
  };
}

type CalculPrevision = Awaited<ReturnType<typeof previsionCourante>>;

/** Traduit le calcul en objet de contrat. Une seule mise en forme, deux appelants. */
function vuePrevision(base: BaseBatte, calcul: CalculPrevision): unknown {
  const { session, resultat, predicteurs, saison, tendance, recettesRepartition } = calcul;

  return {
    session: {
      id: session.id,
      numero: session.numero,
      dateSession: session.dateSession,
      // `lieuId` (mission du 31/07/2026) : remplace le rapprochement par nom
      // que faisait `ProchaineSession.tsx` — voir le commentaire de
      // `schemaPrevision.session.lieuId` (`packages/core/src/contrats/
      // previsions.ts`) pour pourquoi il est sûr de l'exposer tel quel, sans
      // condition, ici.
      lieuId: session.lieuId,
      lieuNom: session.lieuNom,
    },
    baseline: {
      baselineCrepes: calcul.baseline.baselineCrepes,
      nbSessionsRetenues: calcul.baseline.nbSessionsRetenues,
      poidsPriorBp: calcul.baseline.poidsPriorBp,
      explication: calcul.baseline.explication,
    },
    meteo: decrireMeteo(
      calcul.releve,
      calcul.conditions,
      calcul.resultat.facteurs.meteoBp,
      calcul.meteoExplication,
      calcul.parametres,
    ),
    // Les cinq predicteurs de precision ne figurent ici QUE s'ils ont ete
    // ADMIS (`packages/core/src/contrats/previsions.ts` documente pourquoi
    // « absent » et « neutre » ne sont pas la meme chose) : `resultat.facteurs`
    // les fournit toujours neutres par defaut, ce spread les retire quand ils
    // n'ont pas ete retenus, exactement ce que lit l'ecran « Prochaine session ».
    facteurs: {
      meteoBp: resultat.facteurs.meteoBp,
      evenementBp: resultat.facteurs.evenementBp,
      saisonBp: resultat.facteurs.saisonBp,
      tendanceBp: resultat.facteurs.tendanceBp,
      // TOUJOURS présentes (docs/17 fiche 3) : `saison.origine`/`tendance.origine`
      // distinguent « non modélisée », « mesurée » et « rejetée par validation
      // croisée » — jamais un « × 1,00 » muet qui laisserait croire à une mesure.
      saisonExplication: saison.origine,
      tendanceExplication: tendance.origine,
      ...(predicteurs.comparableCalendaire.admis
        ? {
            comparableCalendaireBp: resultat.facteurs.comparableCalendaireBp,
            ...(predicteurs.comparableCalendaire.explication !== null
              ? { comparableCalendaireExplication: predicteurs.comparableCalendaire.explication }
              : {}),
          }
        : {}),
      ...(predicteurs.jourSemaine.admis
        ? {
            jourSemaineBp: resultat.facteurs.jourSemaineBp,
            ...(predicteurs.jourSemaine.explication !== null
              ? { jourSemaineExplication: predicteurs.jourSemaine.explication }
              : {}),
          }
        : {}),
      ...(predicteurs.vacancesScolaires.admis
        ? {
            vacancesScolairesBp: resultat.facteurs.vacancesScolairesBp,
            ...(predicteurs.vacancesScolaires.explication !== null
              ? { vacancesScolairesExplication: predicteurs.vacancesScolaires.explication }
              : {}),
          }
        : {}),
      ...(predicteurs.sessionConsecutive.admis
        ? {
            sessionConsecutiveBp: resultat.facteurs.sessionConsecutiveBp,
            ...(predicteurs.sessionConsecutive.explication !== null
              ? { sessionConsecutiveExplication: predicteurs.sessionConsecutive.explication }
              : {}),
          }
        : {}),
      ...(predicteurs.ecartMeteo.admis
        ? {
            inflationSigmaMeteoBp: predicteurs.ecartMeteo.facteurBp,
            ...(predicteurs.ecartMeteo.explication !== null
              ? { inflationSigmaMeteoExplication: predicteurs.ecartMeteo.explication }
              : {}),
          }
        : {}),
    },
    // Le MEME horizon que celui transmis a `ecartMeteoPrevueRealisee`
    // ci-dessus, pas un second calcul : c'est ce qui garantit que la phrase
    // affichee par l'ecran et le refus du predicteur parlent bien du meme
    // jour (D-098).
    horizonJours: calcul.horizonMeteoJours,
    p10: resultat.p10,
    p50: resultat.p50,
    p90: resultat.p90,
    // Champ par champ, et non `...calcul.couts` : `coutsNewsvendor` rend AUSSI
    // `prixMoyenCrepeCents`, que `schemaPrevision` ne déclare pas et que Zod
    // supprimerait sans rien dire (docs/39 §5). Nommer ce qui sort rend visible
    // ce qui n'en sort pas. `coutInvenduConnu` / `prixMoyenConnu` sont portés
    // ici depuis le 01/08/2026 : sans eux, `ProchaineSession.tsx` ne pouvait pas
    // distinguer un coût matière de 0,00 € d'un coût matière inconnu.
    couts: {
      coutRuptureCents: calcul.couts.coutRuptureCents,
      coutInvenduCents: calcul.couts.coutInvenduCents,
      coutInvenduConnu: calcul.couts.coutInvenduConnu,
      prixMoyenConnu: calcul.couts.prixMoyenConnu,
      origine: calcul.couts.origine,
    },
    quantileCibleBp: resultat.quantileCibleBp,
    crepesRecommandees: resultat.crepesRecommandees,
    crepesRetenues: resultat.crepesRetenues,
    contraintes: calcul.contraintes,
    contrainteLimitante: resultat.contrainteLimitante,
    manqueAGagnerCents: resultat.manqueAGagnerCents,
    confianceBp: resultat.confianceBp,
    nbSessionsComparables: resultat.nbSessionsComparables,
    explication: resultat.explication,
    // Docs/17 fiche 5 : `resultat.repartition` vient directement du moteur,
    // déjà calculé sur `crepesRetenues`. `repartitionRecettesIndisponible`
    // distingue « rien à afficher parce qu'aucune recette active mesurable »
    // de « rien à afficher parce que la mesure est ambiguë » (plusieurs
    // recettes actives sans historique pour les départager) — même situation
    // que `schemaPrevisionCalendaire.repartitionRecettesIndisponible`.
    repartition: resultat.repartition,
    repartitionRecettesIndisponible: recettesRepartition === null,
    plancherSansGlutenApplique: resultat.plancherSansGlutenApplique,
    evenements: evenementsDuJour(base, session.dateSession).map((e) => ({
      id: e.id,
      nom: e.nom,
      type: e.type,
      impactBp: e.impactMesureBp ?? e.impactEstimeBp,
      mesure: e.impactMesureBp !== null,
    })),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Prevision calendaire et achats anticipes (docs/demandes/06)

   `previsionCourante` ci-dessus n'est PAS touchee : c'est la garantie de
   non-regression demandee (« une prevision ponctuelle existante ne doit pas
   changer d'un iota »). Ce qui suit appelle les MEMES primitives pures sur
   CHAQUE date candidate de l'horizon plutot que sur la seule prochaine
   session, et compose deux mecanismes neufs de `packages/core/src/
   prevision/` : l'inflation d'incertitude liee a l'horizon (`horizon.ts`) et
   le besoin en ingredients projete (`besoins-ingredients.ts`).

   `entierAvecRepli` ci-dessous lit la valeur en BASE des qu'elle existe (elle
   l'emporte automatiquement, sans toucher a une ligne de ce fichier) et
   retombe SINON sur la valeur documentee. Distinction a tenir : une cle peut
   etre au CATALOGUE (`packages/core/src/parametres.ts`) sans etre encore dans
   la base du porteur, tant qu'un `db:seed` ne l'y a pas ecrite — c'est ce
   second cas que le repli couvre. Ce choix — et non `ErreurParametreManquant`, pourtant
   le patron suivi ailleurs dans ce fichier pour `prevision_vacances_scolaires_
   be_json` — est DELIBERE ici : D-035 est formel, « un 500 est toujours un
   defaut », et un `GET` sans parametre doit repondre correctement (balayage
   anti-fuite de `apps/api/src/routes/integration.test.ts`, D-045). La
   difference avec `periodesVacancesScolaires` est que CETTE route est deja en
   service des ce lot, quand ce predicteur-la reste gate par sa propre
   validation croisee avant de jamais s'executer sur un appel nu. */
function entierAvecRepli(parametres: Parametres, cle: string, repli: number): number {
  // `cle` est declaree `string` ici — cet utilitaire est volontairement
  // generique — alors que `entier` exige l'union `CleParametre` (derivee du
  // catalogue). D'ou la double assertion via `unknown`. Sans risque a
  // l'execution : `possede` est verifie avant tout appel a `entier`, qui ne
  // fait qu'un acces de Map par la cle textuelle. Un jour ou l'autre, typer
  // `cle: CleParametre` la supprimerait — au prix de la genericite.
  return parametres.possede(cle) ? parametres.entier(cle as unknown as CleParametre) : repli;
}

/**
 * Exportée pour être testée directement (même convention que
 * `previsionPourDateCandidate` ci-dessous, `sommerJoursExploitables`,
 * `regrouperParSemaine`…) : construit la config d'inflation calendaire à
 * partir du catalogue, sans dupliquer les valeurs de repli à la main dans un
 * test.
 */
export function configInflationHorizon(parametres: Parametres): ConfigInflationHorizon {
  return {
    horizonFiableJours: entierAvecRepli(parametres, 'prevision_horizon_fiable_jours', 10),
    penteBpParSemaine: entierAvecRepli(
      parametres,
      'prevision_horizon_inflation_pente_bp_par_semaine',
      500,
    ),
    inflationMaxBp: entierAvecRepli(parametres, 'prevision_horizon_inflation_max_bp', 50_000),
  };
}

/** Meteo CONSERVEE pour une date, sans jamais interroger le reseau (voir plus bas). */
function meteoConserveePourDate(
  base: BaseBatte,
  lieuId: string,
  date: string,
): ConditionsMeteo | null {
  const conserve = lireMeteo(base, lieuId, date);
  if (
    conserve === null ||
    conserve.temperatureC === null ||
    conserve.precipitationsMm === null ||
    conserve.ventKmh === null ||
    conserve.couvertureNuageuseBp === null
  ) {
    return null;
  }
  return {
    temperatureC: conserve.temperatureC,
    precipitationsMm: conserve.precipitationsMm,
    ventKmh: conserve.ventKmh,
    couvertureNuageuseBp: conserve.couvertureNuageuseBp,
  };
}

/**
 * Une prevision de jour candidat, deja mise en forme pour le contrat HTTP.
 *
 * Exporte pour etre teste directement (meme convention que
 * `SemainePanneau` dans `apps/web/src/pages/PrevisionCalendaire.tsx`) :
 * `sommerJoursExploitables`, `regrouperParSemaine` et
 * `alerteReapproPredictiveIngredient` prennent ce type en entree, et un test
 * unitaire construit ses propres fixtures plutot que de rejouer tout le
 * moteur de prevision.
 */
export type JourCalendaireCalcule = {
  readonly occurrence: OccurrenceCandidate;
  readonly horizonJours: number;
  readonly resultat: ReturnType<typeof prevoir>;
  readonly exploitable: boolean;
  readonly confianceHorizonBp: PointsDeBase;
  readonly bande: BandeHorizon;
};

/**
 * Prevision d'UNE date candidate, SANS contraintes dures.
 *
 * Les contraintes dures (capacite de cuisson, glaciere, stock du jour)
 * portent sur ce que l'atelier permet AUJOURD'HUI ; appliquees a une date qui
 * peut etre a un an, elles n'auraient aucun sens (le stock du jour J n'est
 * pas celui d'aujourd'hui). C'est le VOLET APPROVISIONNEMENT de la fiche 06
 * §3 (commander a l'avance pour un pic connu) qui traite le stock — pas le
 * volet capacite du jour meme, deja couvert par la fiche 1 de docs/17 sur
 * l'ecran « Prochaine session ». `crepesRetenues` vaut donc ici EXACTEMENT
 * `crepesRecommandees`.
 *
 * N'utilise PAS les quatre predicteurs de precision de docs/demandes/07 §2
 * (comparable calendaire, jour de semaine, vacances scolaires, session
 * consecutive) : reduction de perimetre ASSUMEE pour ce lot (voir le rapport
 * de livraison) — meteo et evenement, eux, sont bien pris en compte, et
 * c'est l'exemple explicite du critere de fin de la fiche.
 *
 * La meteo est lue UNIQUEMENT depuis ce qui est deja conserve
 * (`meteoConserveePourDate`), JAMAIS interrogee en reseau ici : recalculer
 * l'horizon complet chaque jour ne doit pas declencher des dizaines d'appels
 * Open-Meteo pour des dates que le service ne sait de toute facon pas
 * prevoir a plus d'une quinzaine de jours. Le rafraichissement reseau reste
 * le propre de `/prevision` (bouton « Rafraichir la meteo »).
 *
 * D-082 (`docs/05-DECISIONS.md`) : un lieu sans AUCUNE session close ne peut
 * fonder aucune décision, même seuil strict que « Prochaine session »
 * (`previsionCourante` ci-dessus) et « Où aller ? »
 * (`apps/api/src/routes/opportunites.ts`) — `estPremierPassage`,
 * `packages/core/src/prevision/baseline.ts`, jamais recopié `=== 0` à la
 * main. `prevoir()` ci-dessous ne le sait PAS : il rend quand même un
 * `resultat` chiffré, entièrement issu du prior (`baseline.baselineCrepes`
 * dégénère exactement sur `prevision_prior_baseline_crepes` quand
 * `nbSessionsRetenues` vaut 0). Ce fichier n'a NULLE PART où loger un `null`
 * pour ce cas : `schemaJourCalendaire` (`packages/core/src/contrats/
 * previsions.ts`, hors zone d'écriture) type `p10`/`p50`/`p90`/
 * `crepesRecommandees` en `z.int()` non nullable, et les changer casserait le
 * contrat qu'un autre lot possède. La correction retenue RÉUTILISE donc le
 * mécanisme déjà en place pour « ce chiffre ne doit compter nulle part » :
 * `exploitable`. Forcé à `false` ici, il produit EXACTEMENT le même effet
 * que l'intervalle P10/P90 jugé trop large par `intervalleExploitable` —
 * `sommerJoursExploitables` (semaine ET fenêtre de réappro prédictif)
 * l'exclut déjà du total, et `PrevisionCalendaire.tsx` tait déjà les
 * nombres d'un jour non exploitable. Le nombre issu du prior reste présent
 * dans le JSON (le contrat l'exige), mais n'est plus lu nulle part : ni
 * sommé, ni affiché. Voir aussi le rapport de mission pour la discussion de
 * la nuance perdue (ce cas se confond avec « intervalle trop large », faute
 * d'un champ dédié hors zone d'écriture).
 *
 * Exportée pour être testée directement (même convention que
 * `sommerJoursExploitables`/`regrouperParSemaine` ci-dessous) : un test peut
 * ainsi fixer `baseline.nbSessionsRetenues` à 0 puis à 1 et observer
 * `exploitable` passer de `false` à `true`, sans reconstruire tout
 * l'horizon calendaire ni dépendre d'Open-Meteo.
 */
export function previsionPourDateCandidate(
  base: BaseBatte,
  parametres: Parametres,
  configInflation: ConfigInflationHorizon,
  ratioIntervalleInutileBp: PointsDeBase,
  jour: string,
  baseline: ReturnType<typeof calculerBaseline>,
  couts: ReturnType<typeof coutsNewsvendor>,
  occurrence: OccurrenceCandidate,
): JourCalendaireCalcule {
  const horizonJours = Math.max(0, ageJours(occurrence.dateSession, jour));
  const conditions = meteoConserveePourDate(base, occurrence.lieuId, occurrence.dateSession);
  const inflation = inflationHorizonBp(horizonJours, configInflation);

  const resultat = prevoir(
    {
      baselineCrepes: baseline.baselineCrepes,
      nbSessionsObservees: baseline.nbSessionsRetenues,
      sigmaObserve: baseline.sigmaObserve,
      meteo: conditions,
      evenementBp: facteurEvenementBp(base, occurrence.dateSession),
      contraintes: [],
      inflationSigmaHorizonBp: inflation,
      ...couts,
    },
    parametres,
  );

  return {
    occurrence,
    horizonJours,
    resultat,
    // D-082 : zéro session close sur ce lieu écarte cette occurrence de tout
    // total, AVANT même de regarder si son intervalle P10/P90 est étroit —
    // un intervalle qui semble « exploitable » sur un lieu jamais visité
    // n'est qu'une variance de PRIOR qui a l'air rassurante, jamais une
    // mesure.
    exploitable:
      !estPremierPassage(baseline.nbSessionsRetenues) &&
      intervalleExploitable(resultat.p10, resultat.p50, resultat.p90, ratioIntervalleInutileBp),
    confianceHorizonBp: confianceHorizonBp(inflation),
    bande: bandeHorizon(horizonJours, configInflation.horizonFiableJours),
  };
}

/** Une semaine de l'horizon, avec ses jours et le besoin en ingredients qui en decoule. */
export type SemaineCalculee = {
  readonly debutSemaine: string;
  readonly finSemaine: string;
  readonly crepesPrevues: number;
  readonly jours: readonly JourCalendaireCalcule[];
};

/**
 * Somme les `crepesRecommandees` des jours EXPLOITABLES d'un groupe (semaine
 * calendaire ou fenetre de reappro predictif), et compte au passage ceux qui
 * ne le sont pas.
 *
 * Un jour `exploitable: false` porte un intervalle P10/P90 que le moteur a
 * lui-meme juge trop large pour guider une decision
 * (`intervalleExploitable`, packages/core/src/prevision/horizon.ts) — le
 * sommer sans filtrer produirait un total qui se deguise en chiffre solide
 * alors qu'une partie de sa valeur est du bruit (voir
 * `schemaSemaineCalendaire.crepesPrevues` et `schemaAlerteReapproPredictive`,
 * packages/core/src/contrats/previsions.ts). `joursExclus` permet a
 * l'appelant de DIRE ce qui a ete ecarte plutot que de le taire.
 *
 * Type d'entree structurel minimal (pas `JourCalendaireCalcule` complet) :
 * cette fonction ne regarde que ce dont elle a besoin, ce qui la rend
 * testable sans construire un `ResultatPrevision` entier.
 */
export function sommerJoursExploitables(
  jours: readonly {
    readonly exploitable: boolean;
    readonly resultat: { readonly crepesRecommandees: number };
  }[],
): { readonly total: number; readonly joursExclus: number } {
  let total = 0;
  let joursExclus = 0;
  for (const j of jours) {
    if (j.exploitable) {
      total += j.resultat.crepesRecommandees;
    } else {
      joursExclus += 1;
    }
  }
  return { total, joursExclus };
}

/** Regroupe les jours calcules en semaines de 7 jours depuis `jour`. */
export function regrouperParSemaine(
  jour: string,
  jours: readonly JourCalendaireCalcule[],
): SemaineCalculee[] {
  const parIndex = new Map<number, JourCalendaireCalcule[]>();
  for (const j of jours) {
    const index = Math.floor(j.horizonJours / 7);
    const liste = parIndex.get(index) ?? [];
    liste.push(j);
    parIndex.set(index, liste);
  }

  return [...parIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, joursSemaine]) => ({
      debutSemaine: ajouterJours(jour, index * 7),
      finSemaine: ajouterJours(jour, index * 7 + 6),
      crepesPrevues: sommerJoursExploitables(joursSemaine).total,
      jours: joursSemaine,
    }));
}

/**
 * Recettes ACTIVES chargees pour le calcul, avec leur part historique
 * (docs/17 fiche 5 hors perimetre — voir `partsRecettesActives`,
 * packages/db/src/depots/previsions.ts). `null` si la repartition est
 * indisponible (plusieurs recettes actives sans historique pour les
 * departager) : l'appelant doit alors OMETTRE le besoin en ingredients
 * plutot que d'en inventer un.
 */
export function chargerPartsRecettesActives(base: BaseBatte): readonly PartRecette[] | null {
  const parts = partsRecettesActives(base);
  if (parts === null) return null;

  const resultat: PartRecette[] = [];
  for (const part of parts) {
    const recetteCalcul = chargerRecettePourCalcul(base, part.recetteId);
    if (recetteCalcul === null) continue; // recette supprimee entre-temps : on l'ignore.
    resultat.push({ recette: recetteCalcul, partBp: part.partBp });
  }
  return resultat;
}

/** Point de commande predictif (docs/demandes/06 §3) pour un ingredient donne. */
export function alerteReapproPredictiveIngredient(
  base: BaseBatte,
  parametres: Parametres,
  jour: string,
  jours: readonly JourCalendaireCalcule[],
  partsActives: readonly PartRecette[],
  ing: IngredientReappro,
): {
  fenetreDebutJours: number;
  fenetreFinJours: number;
  besoinProjeteFenetre: number;
  stockProjeteActuel: number;
  deficit: number;
  declencheur: DeclencheurReappro;
  /** Nombre de jours de la fenetre ecartes de `besoinProjeteFenetre` car inexploitables. */
  joursExclusFenetre: number;
} {
  const margeSecuriteJours = entierAvecRepli(
    parametres,
    'reappro_marge_securite_predictive_jours',
    7,
  );
  const fenetre = fenetrePredictive(ing.delaiLivraisonJours, margeSecuriteJours);

  // Ne sommer QUE les jours exploitables (docs/03 §« corollaire du piege
  // central ») : un pic projete sur un jour que le moteur juge lui-meme trop
  // incertain ne doit pas fonder une commande. `joursExclusFenetre` dit
  // combien de jours ont ete ecartes, pour que `besoinProjeteFenetre` soit
  // lu comme un plancher et non comme une projection complete quand il est
  // superieur a 0 — sous-estimer en silence serait pire qu'un surplus
  // (ratio critique ≈ 0,93, docs/03 « decision de production »).
  const joursFenetre = jours.filter((j) => dansFenetre(j.horizonJours, fenetre));
  const { total: crepesFenetre, joursExclus: joursExclusFenetre } =
    sommerJoursExploitables(joursFenetre);

  const besoinIngredientsFenetre = besoinsIngredients(partsActives, crepesFenetre);
  const besoinProjeteFenetre =
    besoinIngredientsFenetre.find((b) => b.ingredientId === ing.ingredientId)?.quantite ?? 0;

  const stockProjeteActuel = stockProjeteIngredient(base, ing.ingredientId, jour);
  const { alerte: alertePredictive, deficit } = alerteCommandeAnticipee({
    besoinProjeteFenetre,
    stockProjeteActuel,
  });

  // Declencheur REACTIF existant (packages/core/src/reapprovisionnement.ts),
  // recalcule ici (memes primitives, meme conditionnement de parametres que
  // `services/commandes.ts`) pour dire lequel des deux a fait sonner
  // l'alerte — jamais pour le remplacer.
  const fenetreHistoriqueJours = parametres.entier('reappro_fenetre_historique_jours');
  const z = parametres.decimal('reappro_niveau_service_z');
  const profil = profilConsommation(
    serieConsommationJournaliereIngredient(base, ing.ingredientId, jour, fenetreHistoriqueJours),
  );
  const pointCommandeReactif = calculerPointCommande({
    moyenneJournaliere: profil.moyenneJournaliere,
    ecartTypeJournalier: profil.ecartTypeJournalier,
    delaiLivraisonJours: ing.delaiLivraisonJours,
    z,
  });
  const alerteReactive =
    calculerBesoinBrut(pointCommandeReactif.pointCommande, stockProjeteActuel) > 0;

  return {
    fenetreDebutJours: fenetre.debutJours,
    fenetreFinJours: fenetre.finJours,
    besoinProjeteFenetre,
    stockProjeteActuel,
    deficit,
    declencheur: combinerDeclencheurs({ alerteReactive, alertePredictive }),
    joursExclusFenetre,
  };
}

/**
 * Avertissement ajoute quand une partie de la fenetre a ete ecartee du
 * calcul (jours inexploitables, voir `sommerJoursExploitables`) : sans lui,
 * un « stock projeté suffisant » silencieux se lirait comme une garantie
 * alors que le besoin n'a ete mesure que sur une partie de la fenetre — un
 * risque de rupture non dit, plus couteux qu'un surplus (ratio critique
 * ≈ 0,93, docs/03).
 */
export function avertissementJoursExclus(joursExclusFenetre: number): string {
  if (joursExclusFenetre <= 0) return '';
  const pluriel = joursExclusFenetre > 1;
  return (
    ` Attention : ${joursExclusFenetre} jour${pluriel ? 's' : ''} de la fenêtre ` +
    `${pluriel ? 'étaient' : 'était'} trop incertain${pluriel ? 's' : ''} pour être ` +
    `compté${pluriel ? 's' : ''} — le besoin réel peut être supérieur à ce chiffre.`
  );
}

function explicationAlertePredictive(
  ing: IngredientReappro,
  alerte: ReturnType<typeof alerteReapproPredictiveIngredient>,
): string {
  const avertissement = avertissementJoursExclus(alerte.joursExclusFenetre);
  if (alerte.declencheur === 'aucun') {
    return (
      `Stock projeté suffisant sur la fenêtre de commande (J+${alerte.fenetreDebutJours} à ` +
      `J+${alerte.fenetreFinJours}).${avertissement}`
    );
  }
  const fenetre = `entre J+${alerte.fenetreDebutJours} et J+${alerte.fenetreFinJours}`;
  if (alerte.declencheur === 'predictif') {
    return (
      `Un pic de demande projeté ${fenetre} dépasse le stock projeté avant même que le point ` +
      `de commande réactif ne l'aurait détecté : commandez ${ing.nomIngredient} ` +
      `maintenant.${avertissement}`
    );
  }
  if (alerte.declencheur === 'reactif') {
    return (
      `Consommation récente déjà sous le point de commande habituel : commandez ` +
      `${ing.nomIngredient}.${avertissement}`
    );
  }
  return (
    `Point de commande réactif ET pic projeté ${fenetre} : commande urgente pour ` +
    `${ing.nomIngredient}.${avertissement}`
  );
}

/**
 * Prevision calendaire complete (docs/demandes/06) : une prevision par date
 * candidate sur l'horizon, regroupees par semaine, avec le besoin en
 * ingredients projete et les alertes de reapprovisionnement predictives.
 */
function previsionCalendaireComplete(base: BaseBatte, horizonDemandeJours?: number) {
  const jour = aujourdHui();
  const parametres = lireParametres(base, jour);
  const horizonMaxJours = entierAvecRepli(parametres, 'prevision_horizon_calendaire_jours', 365);
  const horizonJours = Math.max(
    1,
    Math.min(horizonDemandeJours ?? horizonMaxJours, horizonMaxJours),
  );

  const occurrences = occurrencesCandidates(base, jour, horizonJours);
  const couts = coutsNewsvendor(base);
  if (couts.coutRuptureCents <= 0) {
    throw new ErreurMetier(
      'couts_indisponibles',
      'Impossible de calculer la marge perdue par rupture : renseignez au moins ' +
        'une recette avec ses ingrédients et un produit transformé avec son prix.',
    );
  }

  const configInflation = configInflationHorizon(parametres);
  const ratioIntervalleInutileBp = entierAvecRepli(
    parametres,
    'prevision_intervalle_inutile_ratio_bp',
    20_000,
  );

  // Baseline calculee UNE FOIS par lieu (pas par date) : c'est un historique
  // de sessions PASSEES, il ne varie pas selon la date FUTURE qu'on prevoit.
  const baselineParLieu = new Map<string, ReturnType<typeof calculerBaseline>>();
  for (const lieuId of new Set(occurrences.map((o) => o.lieuId))) {
    baselineParLieu.set(
      lieuId,
      calculerBaseline(observationsDuLieu(base, lieuId), jour, parametres),
    );
  }

  const jours: JourCalendaireCalcule[] = [];
  for (const occurrence of occurrences) {
    const baseline = baselineParLieu.get(occurrence.lieuId);
    if (baseline === undefined) continue; // ne peut pas arriver : lieu deja liste ci-dessus.
    jours.push(
      previsionPourDateCandidate(
        base,
        parametres,
        configInflation,
        ratioIntervalleInutileBp,
        jour,
        baseline,
        couts,
        occurrence,
      ),
    );
  }

  const semaines = regrouperParSemaine(jour, jours);
  const partsActives = chargerPartsRecettesActives(base);
  const repartitionRecettesIndisponible = partsActives === null;

  const semainesVues = semaines.map((semaine) => ({
    debutSemaine: semaine.debutSemaine,
    finSemaine: semaine.finSemaine,
    crepesPrevues: semaine.crepesPrevues,
    jours: semaine.jours.map((j) => ({
      dateSession: j.occurrence.dateSession,
      lieuNom: j.occurrence.lieuNom,
      sessionId: j.occurrence.sessionId,
      horizonJours: j.horizonJours,
      bandeHorizon: j.bande,
      confianceHorizonBp: j.confianceHorizonBp,
      exploitable: j.exploitable,
      demandeAttendue: j.resultat.demandeAttendue,
      p10: j.resultat.p10,
      p50: j.resultat.p50,
      p90: j.resultat.p90,
      crepesRecommandees: j.resultat.crepesRecommandees,
      evenements: evenementsDuJour(base, j.occurrence.dateSession).map((e) => ({
        id: e.id,
        nom: e.nom,
      })),
    })),
    besoinsIngredients:
      partsActives === null ? [] : besoinsIngredients(partsActives, semaine.crepesPrevues),
  }));

  const alertesReapproPredictives =
    partsActives === null
      ? []
      : ingredientsActifsAvecDelai(base)
          .map((ing) => {
            const alerte = alerteReapproPredictiveIngredient(
              base,
              parametres,
              jour,
              jours,
              partsActives,
              ing,
            );
            return {
              ingredientId: ing.ingredientId,
              nomIngredient: ing.nomIngredient,
              unite: ing.unite,
              delaiLivraisonJours: ing.delaiLivraisonJours,
              fenetreDebutJours: alerte.fenetreDebutJours,
              fenetreFinJours: alerte.fenetreFinJours,
              besoinProjeteFenetre: alerte.besoinProjeteFenetre,
              stockProjeteActuel: alerte.stockProjeteActuel,
              deficit: alerte.deficit,
              declencheur: alerte.declencheur,
              joursExclusFenetre: alerte.joursExclusFenetre,
              explication: explicationAlertePredictive(ing, alerte),
            };
          })
          // Les alertes reelles d'abord ('aucun' en dernier), et parmi les
          // alertes, la plus contraignante ('les_deux') en tete : c'est ce
          // que l'utilisateur doit voir sans faire defiler l'ecran.
          .sort((a, b) => {
            const rang: Record<DeclencheurReappro, number> = {
              les_deux: 0,
              predictif: 1,
              reactif: 2,
              aucun: 3,
            };
            return (rang[a.declencheur] ?? 3) - (rang[b.declencheur] ?? 3);
          });

  return {
    genereLe: maintenantIso(),
    horizonJours,
    horizonMaxJours,
    semaines: semainesVues,
    alertesReapproPredictives,
    repartitionRecettesIndisponible,
  };
}

/** Horodatage ISO du calcul — pas de dependance a `horodatage.ts` ici : la valeur n'est jamais reaffichee en jour civil, seulement archivee telle quelle. */
function maintenantIso(): string {
  return new Date().toISOString();
}

export type OptionsRoutesPrevisions = {
  /**
   * Racine HTTP du service meteo, INJECTABLE UNIQUEMENT depuis les tests
   * (CLAUDE.md — un test qui depend du reseau n'est pas un test). Omis en
   * production (`routesPrevisions(base)`, `serveur.ts`) : `obtenirMeteo`
   * retombe alors sur la vraie racine Open-Meteo, comme avant ce lot.
   *
   * Sans ce parametre, `GET /prevision` et `GET /prevision/brief`
   * declenchaient un vrai appel reseau des qu'aucune ligne meteo n'etait
   * encore en cache pour la date de la session — exactement le cas d'une
   * suite de tests qui construit une base fraiche (`smoke-routes-lecture.test.ts`,
   * par exemple). `releverMeteo` (apps/api/src/meteo/open-meteo.ts) accepte
   * deja un `racineUrl` pour cette raison precise ; ce champ n'est que le
   * relais qui permet a `apps/api/src/routes/previsions.test.ts` de pointer
   * vers un serveur `node:http` local plutot que de bouchonner le reseau
   * globalement (ce qui masquerait un vrai defaut d'appel).
   */
  readonly racineUrlMeteo?: string;
};

export function routesPrevisions(
  base: BaseBatte,
  options: OptionsRoutesPrevisions = {},
): FastifyPluginAsync {
  return async (app) => {
    /**
     * Prevision pour la prochaine session planifiee.
     *
     * `?rafraichirMeteo=1` force un nouvel appel Open-Meteo. Par defaut on
     * reutilise le releve conserve : la prevision doit etre reproductible.
     */
    app.get<{ Querystring: { rafraichirMeteo?: string } }>('/prevision', async (requete) => {
      const calcul = await previsionCourante(
        base,
        requete.query.rafraichirMeteo === '1',
        options.racineUrlMeteo,
      );
      return schemaPrevision.parse(vuePrevision(base, calcul));
    });

    /** Archive la prevision courante. Acte explicite : on n'archive pas a chaque affichage. */
    app.post('/prevision/archiver', async (requete, reponse) => {
      const corps = schemaArchivagePrevision.parse(requete.body);
      const calcul = await previsionCourante(base, false, options.racineUrlMeteo);

      // Verifie AVANT l'ecriture (meme convention que `routes/afsca.ts` pour
      // lotId/sessionId, D-035 §4) : `archiverPrevision` insere `sessionId` tel
      // quel, sans controle d'existence, et la colonne porte une vraie cle
      // etrangere (`foreign_keys = ON`, packages/db/src/client.ts). Sans ce
      // garde, un identifiant errone (recopie depuis un autre ecran, tronque au
      // copier-coller) ne se manifestait qu'en violation de cle etrangere
      // SQLite — un 500 brut sur l'archivage d'une prevision. C'est une valeur
      // SAISIE (le corps peut la fournir explicitement), jamais adressee dans
      // l'URL : 422 avec `champs`, jamais 404 (D-035).
      if (corps.sessionId !== null) {
        const sessionTrouvee = base
          .select({ id: schema.sessionMarche.id })
          .from(schema.sessionMarche)
          .where(eq(schema.sessionMarche.id, corps.sessionId))
          .get();
        if (sessionTrouvee === undefined) {
          throw new ErreurMetier(
            'session_introuvable',
            `Aucune session ne correspond à l'identifiant « ${corps.sessionId} ».`,
            { champs: { sessionId: 'Identifiant de session introuvable.' } },
          );
        }
      }

      const id = archiverPrevision(base, {
        sessionId: corps.sessionId ?? calcul.session.id,
        resultat: calcul.resultat,
        // `null` — jamais BASE_POINTS — quand le predicteur n'a pas ete
        // admis : c'est la distinction que l'ecran Qualite du modele doit
        // pouvoir lire (packages/db/src/schema.ts, table `prevision`).
        facteurComparableCalendaireBp: calcul.predicteurs.comparableCalendaire.admis
          ? calcul.predicteurs.comparableCalendaire.facteurBp
          : null,
        facteurJourSemaineBp: calcul.predicteurs.jourSemaine.admis
          ? calcul.predicteurs.jourSemaine.facteurBp
          : null,
        facteurVacancesScolairesBp: calcul.predicteurs.vacancesScolaires.admis
          ? calcul.predicteurs.vacancesScolaires.facteurBp
          : null,
        facteurSessionConsecutiveBp: calcul.predicteurs.sessionConsecutive.admis
          ? calcul.predicteurs.sessionConsecutive.facteurBp
          : null,
        inflationSigmaMeteoBp: calcul.predicteurs.ecartMeteo.admis
          ? calcul.predicteurs.ecartMeteo.facteurBp
          : null,
      });

      reponse.code(201);
      return { id };
    });

    /**
     * Commentaire Claude sur la prevision courante (Lot 9).
     *
     * Route SEPAREE de `/prevision` a dessein : la prevision doit s'afficher
     * instantanement et sans reseau. Le commentaire arrive apres, s'il arrive —
     * « l'IA est un confort, jamais une dependance » (CLAUDE.md §5).
     *
     * Le serveur recalcule la prevision au lieu de la recevoir du client : sans
     * cela, n'importe quel appelant pourrait faire commenter des chiffres qui ne
     * sortent pas du moteur.
     */
    app.post('/prevision/commenter', { config: { rateLimit: LIMITE_APPEL_EXTERNE } }, async () => {
      const calcul = await previsionCourante(base, false, options.racineUrlMeteo);
      const prevision = schemaPrevision.parse(vuePrevision(base, calcul));

      const reponse = await demanderCommentaire(
        base,
        calcul.parametres,
        commentaireDePrevision(prevision),
      );

      return schemaCommentaireIa.parse(reponse);
    });

    /**
     * Brief avant-marche (docs/01 module 4) : le document qu'on relit le
     * samedi soir. `GET`, comme les autres routes de generation de document
     * (docs/06 §« Conventions d'API »), meme si elle ARCHIVE une nouvelle
     * version a chaque appel (D-026) — c'est le meme comportement que les
     * autres gabarits PDF de l'application.
     */
    app.get(
      '/prevision/brief',
      { config: { rateLimit: LIMITE_GENERATION_DOCUMENT } },
      async (_requete, reponse) => {
        const calcul = await previsionCourante(base, false, options.racineUrlMeteo);
        const prevision = schemaPrevision.parse(vuePrevision(base, calcul));

        const jour = aujourdHui();
        const horizonJours = calcul.parametres.entier('brief_horizon_alerte_dlc_jours');

        const lignesStock = etatDuStock(base, jour);
        const alertesStock = lignesStock
          .filter((l) => statutStock(l.quantiteDisponible, l.stockSecurite) !== 'conforme')
          .map((l) => ({
            nomIngredient: l.nom,
            quantiteDisponible: l.quantiteDisponible,
            stockSecurite: l.stockSecurite,
            unite: l.unite,
          }));

        const alertesDlc = lotsAlerteDlc(base, jour, horizonJours)
          .filter((l): l is typeof l & { dateDlc: string } => l.dateDlc !== null)
          .map((l) => ({
            ingredientNom: l.ingredientNom,
            numeroLotFournisseur: l.numeroLotFournisseur,
            dateDlc: l.dateDlc,
          }));

        const rendu = briefAvantMarche({
          session: {
            numero: calcul.session.numero,
            dateSession: calcul.session.dateSession,
            lieuNom: calcul.session.lieuNom,
          },
          crepesRecommandees: prevision.crepesRecommandees,
          crepesRetenues: prevision.crepesRetenues,
          contrainteLimitante: prevision.contrainteLimitante,
          manqueAGagnerCents: prevision.manqueAGagnerCents,
          confianceBp: prevision.confianceBp,
          nbSessionsComparables: prevision.nbSessionsComparables,
          baseline: {
            baselineCrepes: prevision.baseline.baselineCrepes,
            explication: prevision.baseline.explication,
          },
          facteurs: prevision.facteurs,
          evenements: prevision.evenements.map((e) => ({ nom: e.nom })),
          meteo: prevision.meteo.disponible
            ? {
                disponible: true,
                temperatureC: prevision.meteo.conditions.temperatureC,
                precipitationsMm: prevision.meteo.conditions.precipitationsMm,
                ventKmh: prevision.meteo.conditions.ventKmh,
                ventFort: prevision.meteo.ventFort,
                explication: prevision.meteo.explication,
              }
            : { disponible: false, raison: prevision.meteo.raison },
          contraintes: prevision.contraintes,
          alertesStock,
          horizonJours,
          alertesDlc,
        });

        const doc = await rendrePdf(base, {
          type: 'brief_avant_marche',
          objetId: calcul.session.id,
          numero: calcul.session.numero,
          titre: `Brief avant-marché ${calcul.session.numero}`,
          ...rendu,
          parametresSource: prevision,
        });

        const octets = readFileSync(doc.chemin);
        reponse.header('Content-Disposition', `inline; filename="${basename(doc.chemin)}"`);
        reponse.type('application/pdf');
        return octets;
      },
    );

    /**
     * Commentaire Claude sur le BRIEF avant-marche — troisième usage Sonnet
     * cité par CLAUDE.md §5 aux côtés de « commentaire de prévision » et
     * « analyse d'écart ». Jusqu'ici, `briefAvantMarche` (`ia/usages.ts`)
     * n'était appelée que par son propre test (docs/05-DECISIONS.md D-087,
     * quatrième instance du motif « aval complet et testé, amont manquant »).
     *
     * DIFFÉRENT de `POST /prevision/commenter` ci-dessus : celui-ci ne
     * commente que la prévision brute (facteurs, confiance, risques). Celui-ci
     * reprend aussi les points de vigilance imprimés sur le brief lui-même —
     * stock sous seuil, lots proches de leur DLC — que `commentaireDePrevision`
     * ne voit pas. S'il ne faisait que répéter le premier, il n'aurait pas de
     * raison d'exister ; CLAUDE.md §5 le nomme séparément parce qu'il ne le
     * répète pas.
     *
     * Mêmes règles que `/prevision/commenter` : Claude COMMENTE des chiffres
     * déjà calculés par le moteur déterministe, il n'en produit aucun
     * (CLAUDE.md §3 règle 2). Route SÉPARÉE et POST : jamais appelée au
     * chargement d'un écran — l'IA est un CONFORT, jamais une dépendance (§5),
     * et chaque appel a un coût réel pour le porteur.
     */
    app.post(
      '/prevision/brief/commenter',
      { config: { rateLimit: LIMITE_APPEL_EXTERNE } },
      async () => {
        const calcul = await previsionCourante(base, false, options.racineUrlMeteo);
        const prevision = schemaPrevision.parse(vuePrevision(base, calcul));

        const jour = aujourdHui();
        // Même paramètre, même lecture que `GET /prevision/brief` ci-dessus :
        // le commentaire ne doit jamais parler d'une fenêtre DLC différente de
        // celle imprimée sur le document qu'il commente.
        const horizonJours = calcul.parametres.entier('brief_horizon_alerte_dlc_jours');

        const lignesStock = etatDuStock(base, jour);
        const alertesStock = lignesStock
          .filter((l) => statutStock(l.quantiteDisponible, l.stockSecurite) !== 'conforme')
          .map(
            (l) =>
              `${l.nom} (${formaterQuantite(l.quantiteDisponible, l.unite)} restant, seuil ${formaterQuantite(l.stockSecurite, l.unite)})`,
          );

        const alertesDlc = lotsAlerteDlc(base, jour, horizonJours)
          .filter((l): l is typeof l & { dateDlc: string } => l.dateDlc !== null)
          .map((l) => `${l.ingredientNom} — DLC ${formaterDate(l.dateDlc)}`);

        const reponse = await demanderCommentaire(
          base,
          calcul.parametres,
          demandeCommentaireBrief({ prevision, alertesStock, alertesDlc }),
        );

        return schemaCommentaireIa.parse(reponse);
      },
    );

    app.get('/previsions', async () => {
      const lignes = listerPrevisions(base);
      return schemaListePrevisions.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.get('/qualite-modele', async () => schemaQualiteModele.parse(qualiteModele(base)));

    app.get('/evenements', async () => {
      const lignes = listerEvenements(base);
      return schemaListeEvenements.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.post('/evenements', async (requete, reponse) => {
      const corps = schemaCreationEvenement.parse(requete.body);
      const id = creerEvenement(base, {
        nom: corps.nom,
        type: corps.type,
        dateDebut: corps.dateDebut,
        dateFin: corps.dateFin,
        portee: corps.portee,
        intensiteEstimee: corps.intensiteEstimee,
        impactEstimeBp: corps.impactEstimeBp,
        source: corps.source ?? null,
        notes: corps.notes ?? null,
      });

      reponse.code(201);
      return { id };
    });

    /**
     * Prevision calendaire sur l'horizon (docs/demandes/06).
     *
     * `?horizonJours=N` reduit l'horizon (utile pour un ecran de test ou une
     * vue « 4 semaines ») ; jamais au-dela de `prevision_horizon_calendaire_jours`,
     * le plafond du catalogue.
     */
    app.get<{ Querystring: { horizonJours?: string } }>(
      '/prevision-calendaire',
      async (requete) => {
        const brut = requete.query.horizonJours;

        // Format vérifié AVANT toute conversion : `Number.parseInt` est
        // permissif (« 14x » serait tronqué en 14 au lieu d'être refusé), et
        // une valeur totalement illisible (« abc ») retombait silencieusement
        // sur l'horizon par défaut au lieu de signaler la faute de saisie
        // (D-035 — un 422 nommant le champ vaut mieux qu'un résultat différent
        // de celui demandé, rendu sans explication). `previsionCalendaireComplete`
        // écrête déjà tout entier valide à `[1, horizonMaxJours]` : seul le
        // FORMAT est contrôlé ici, jamais la borne.
        if (brut !== undefined && brut !== '' && !/^\d+$/.test(brut)) {
          throw new ErreurMetier(
            'horizon_invalide',
            `« ${brut} » n'est pas un nombre de jours valide. Indiquez un entier positif.`,
            { champs: { horizonJours: 'Indiquez un nombre entier positif de jours.' } },
          );
        }

        const horizonDemande =
          brut !== undefined && brut !== '' ? Number.parseInt(brut, 10) : undefined;
        const calcul = previsionCalendaireComplete(base, horizonDemande);
        return schemaPrevisionCalendaire.parse(calcul);
      },
    );
  };
}

/**
 * Volume de pate par crepe, deduit du rendement de reference des recettes.
 *
 * Rend 0 quand aucune recette n'est exploitable : la contrainte « glaciere » est
 * alors simplement omise plutot que calculee sur une valeur inventee.
 */
function volumeParCrepe(base: BaseBatte): number {
  const volumes = listerRecettes(base)
    .map((r) =>
      r.rendementReferenceCrepes > 0 ? r.rendementReferenceMl / r.rendementReferenceCrepes : null,
    )
    .filter((v): v is number => v !== null);

  if (volumes.length === 0) return 0;
  return Math.round(volumes.reduce((total, v) => total + v, 0) / volumes.length);
}

/**
 * Plafond de production que le stock d'ingredients permet REELLEMENT, en
 * crepes vendables — la troisieme contrainte dure de docs/03, absente jusqu'ici
 * (`stockMaximalCrepes: null` code en dur, docs/15 §1.8, docs/17 fiche 1).
 *
 * Mesure sur l'installation de production : cible 203 crepes, stock reel de
 * quoi en faire 40. Sans cette fonction, le moteur recommandait de produire
 * 220 crepes avec de quoi en faire 80 — « le pire mode de defaillance
 * possible » selon l'audit.
 *
 * NE REIMPLEMENTE RIEN : reutilise `verifierFaisabilite`, deja ecrite et
 * testee pour l'ecran Production (stock par ingredient, FEFO, DLC comprise).
 * Le `cible` passe a `verifierFaisabilite` ne sert qu'a satisfaire sa garde
 * d'entree — le plafond lu, `volumeMaximalMl`, est INDEPENDANT de cette
 * cible : c'est le facteur maximal atteignable compte tenu du stock, pas le
 * resultat d'une mise a l'echelle vers la cible demandee.
 *
 * PLUSIEURS RECETTES ACTIVES : on retient le plafond le PLUS BAS. Tant que la
 * repartition entre recettes n'est pas prevue (docs/17 fiche 5, hors
 * perimetre ici), on ne sait pas laquelle sera produite : le plafond doit
 * tenir quel que soit le choix. Une SOMME des plafonds par recette
 * supposerait a tort qu'aucun ingredient n'est partage entre elles.
 *
 * `null` si aucune recette active n'a de rendement exploitable : la
 * contrainte est alors omise plutot que calculee sur une valeur inventee —
 * meme choix que `volumeParCrepe` ci-dessus.
 */
function plafondStockCrepes(base: BaseBatte, jour: string): number | null {
  let plafond: number | null = null;

  for (const resume of listerRecettes(base)) {
    if (resume.statut !== 'active') continue;
    // Rendement inexploitable (recette vide ou volume/crepes nul) : on saute
    // cette recette plutot que de laisser `verifierFaisabilite` lever — une
    // recette mal renseignee ne doit pas faire echouer TOUTE la prevision.
    if (resume.nbLignes === 0) continue;
    if (resume.rendementReferenceMl <= 0 || resume.rendementReferenceCrepes <= 0) continue;

    const controle = verifierFaisabilite(
      base,
      resume.id,
      { type: 'volume', volumeMl: resume.rendementReferenceMl },
      jour,
    );

    let crepes: number;
    if (controle.faisabilite.volumeMaximalMl <= 0) {
      crepes = 0;
    } else {
      // Reconverti en crepes VENDABLES par la meme fonction que l'ecran
      // Production et le calcul de recette (`mettreAEchelle`) : perte de
      // cuisson et casse y sont deja appliquees, on ne recalcule pas un ratio
      // a la main qui divergerait tot ou tard.
      const pourCalcul = chargerRecettePourCalcul(base, resume.id);
      if (pourCalcul === null) continue;
      crepes = mettreAEchelle(pourCalcul, {
        type: 'volume',
        volumeMl: controle.faisabilite.volumeMaximalMl,
      }).crepesVendables;
    }

    plafond = plafond === null ? crepes : Math.min(plafond, crepes);
  }

  return plafond;
}

/**
 * Decrit la meteo pour le contrat HTTP, mode degrade compris.
 *
 * `facteurBp` vient de `facteurBpRetenu` (le facteur RÉELLEMENT utilisé par
 * `prevoir()`, mesuré ou prior) et `explication` de `explicationRetenue` (la
 * MÊME chaîne, qui distingue toujours les deux — docs/17 fiche 2, D-059) :
 * jamais un second calcul qui pourrait diverger de celui qui a produit la
 * prévision affichée.
 */
function decrireMeteo(
  releve: ResultatReleve,
  conditions: ConditionsMeteo | null,
  facteurBpRetenu: PointsDeBase,
  explicationRetenue: string | null,
  parametres: Parametres,
) {
  if (!releve.disponible || conditions === null) {
    return {
      disponible: false as const,
      raison: releve.disponible ? 'Relevé incomplet.' : releve.raison,
    };
  }

  const resultat = facteurMeteo(conditions, parametres);
  return {
    disponible: true as const,
    conditions,
    categorie: classerMeteo(conditions, parametres),
    facteurBp: facteurBpRetenu,
    ventFort: resultat.ventFort,
    explication: explicationRetenue ?? resultat.explication,
    recupereLe: releve.releve.recupereLe,
  };
}
