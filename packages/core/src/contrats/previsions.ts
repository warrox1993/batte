/**
 * Contrat HTTP des routes `/api/prevision`, `/api/evenements` et
 * `/api/qualite-modele` (Lot 5).
 */

import { z } from 'zod';
import { schemaUnite } from './recettes.js';

export const schemaConditionsMeteo = z.object({
  temperatureC: z.number(),
  precipitationsMm: z.number(),
  ventKmh: z.number(),
  couvertureNuageuseBp: z.int(),
});

/**
 * Meteo de la prevision. Le mode degrade est dans le CONTRAT, pas en marge :
 * l'ecran doit pouvoir dire « météo indisponible » sans que rien ne casse.
 */
export const schemaMeteoPrevision = z.discriminatedUnion('disponible', [
  z.object({
    disponible: z.literal(true),
    conditions: schemaConditionsMeteo,
    categorie: z.string(),
    facteurBp: z.int(),
    ventFort: z.boolean(),
    explication: z.string(),
    recupereLe: z.string(),
  }),
  z.object({
    disponible: z.literal(false),
    raison: z.string(),
  }),
]);

export const schemaContrainte = z.object({
  libelle: z.string(),
  plafondCrepes: z.int(),
});

/**
 * Resultat complet d'une prevision.
 *
 * Tout ce qui a servi au calcul est renvoye, y compris l'origine des couts :
 * « l'utilisateur doit pouvoir contester chaque facteur » (docs/01 module 5).
 */
export const schemaPrevision = z.object({
  session: z
    .object({
      id: z.string(),
      numero: z.string(),
      dateSession: z.string(),
      /**
       * Identifiant RÉEL du lieu (`lieu_marche.id`), ajouté le 31/07/2026 pour
       * remplacer le rapprochement par NOM que `ProchaineSession.tsx` devait
       * faire lui-même depuis `lieuNom` seul (`resoudreLieuIdParNom`,
       * supprimée) : `lieu_marche.nom` n'est pas contraint UNIQUE en base
       * (`packages/db/src/schema.ts`), donc deux emplacements du même nom
       * rendaient cette résolution ambiguë par construction — un contournement
       * documenté, jamais une solution.
       *
       * JAMAIS `null` tant que `session` est présent : `session_marche.lieu_id`
       * est `NOT NULL` et `prochaineSessionPlanifiee`
       * (`packages/db/src/depots/previsions.ts`) le rejoint par un INNER JOIN —
       * une session planifiée sans lieu n'existe pas. C'est `session`
       * lui-même, ci-dessus, qui porte « pas de session à venir » ; ce champ
       * n'a donc pas besoin d'être nullable une seconde fois.
       */
      lieuId: z.string(),
      lieuNom: z.string(),
    })
    .nullable(),

  baseline: z.object({
    baselineCrepes: z.int(),
    nbSessionsRetenues: z.int(),
    poidsPriorBp: z.int(),
    explication: z.string(),
  }),

  meteo: schemaMeteoPrevision,

  facteurs: z.object({
    meteoBp: z.int(),
    evenementBp: z.int(),
    saisonBp: z.int(),
    tendanceBp: z.int(),
    /**
     * TOUJOURS présentes (docs/17 fiche 3), contrairement aux explications
     * des cinq prédicteurs de précision ci-dessous : `saisonBp`/`tendanceBp`
     * sont des facteurs DE BASE (docs/03), pas des ajouts optionnels — ils
     * doivent donc toujours dire d'où vient leur valeur, y compris quand elle
     * est neutre. C'est exactement le défaut corrigé : un « × 1,00 » sans
     * explication se lit « évalué et jugé neutre », quand la vérité peut être
     * « jamais mesuré ». Distingue « non modélisée » (démarrage à froid) de
     * « mesurée sur N sessions/mois » (`ProchaineSession.tsx` affiche cette
     * chaîne comme libellé de la ligne, jamais un texte figé).
     */
    saisonExplication: z.string(),
    tendanceExplication: z.string(),
    /**
     * Cinq predicteurs de docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-
     * PRECISION.md §2, câblés par `apps/api/src/routes/previsions.ts` :
     * chacun passe par `validerParLeaveOneOut` avant d'être retenu.
     *
     * `.optional()` porte ici un sens PRÉCIS, pas une simple tolérance de
     * schéma : le champ est PRÉSENT si et seulement si le prédicteur a été
     * ADMIS (assez d'historique ET validé en croisement), ABSENT sinon —
     * qu'il s'agisse d'un démarrage à froid ou d'un rejet par la validation
     * croisée. « Non admis » et « neutre » ne sont PAS la même chose : un
     * facteur neutre admis reste présent (à 10000), un facteur non admis est
     * absent. C'est cette distinction que l'écran « Prochaine session » lit
     * pour décider d'afficher ou non chaque ligne (docs/demandes/07 §3 :
     * « un paramètre qui améliore le score mais rend l'explication illisible
     * n'est pas un progrès net »).
     *
     * Chaque facteur est accompagné d'une explication en clair, prête à
     * afficher (même contrat que `meteo.explication` ci-dessus) — absente
     * exactement quand le facteur l'est.
     */
    comparableCalendaireBp: z.int().optional(),
    comparableCalendaireExplication: z.string().optional(),
    jourSemaineBp: z.int().optional(),
    jourSemaineExplication: z.string().optional(),
    vacancesScolairesBp: z.int().optional(),
    vacancesScolairesExplication: z.string().optional(),
    sessionConsecutiveBp: z.int().optional(),
    sessionConsecutiveExplication: z.string().optional(),
    /**
     * Inflation de l'écart-type P10/P90, calibrée sur l'écart météo
     * prévue/réalisée (`ecart-meteo-prevue-realisee.ts`). N'affecte PAS la
     * demande attendue, seulement la largeur de l'intervalle — voir
     * `prevoir()` dans `packages/core`. Validé par son propre seuil
     * d'échantillon (`prevision_ecart_meteo_paires_minimum`), pas par
     * `validerParLeaveOneOut` : ce garde-fou compare des ESTIMATIONS DE
     * DEMANDE par MAPE, et une inflation de sigma ne change jamais la
     * demande estimée — le comparer ainsi rendrait ce prédicteur soit
     * toujours rejeté (amélioration nulle par construction), soit validé
     * pour de mauvaises raisons. Déviation assumée, voir le rapport de
     * livraison.
     */
    inflationSigmaMeteoBp: z.int().optional(),
    inflationSigmaMeteoExplication: z.string().optional(),
  }),

  /**
   * Distance en jours civils belges entre AUJOURD'HUI et la session prévue.
   * `0` veut dire « la session a lieu ce jour même » — jamais « inconnu » :
   * la valeur est toujours calculée serveur, et jamais négative (une session
   * passée n'est plus la prochaine session planifiée).
   *
   * POURQUOI CE CHAMP TRAVERSE LE CONTRAT (D-098). À horizon nul,
   * `ecartMeteoPrevueRealisee` (`packages/core/src/prevision/`) refuse par
   * construction : une météo du jour même n'est plus une prévision, il n'y a
   * aucune incertitude d'horizon à faire payer à l'intervalle P10/P90.
   * `inflationSigmaMeteoBp` disparaît donc de `facteurs` ci-dessus, et
   * l'intervalle affiché se resserre — le dimanche matin, c'est-à-dire au
   * moment exact où le porteur consulte l'écran pour décider de sa quantité
   * de pâte. Sans ce champ, l'écran n'avait aucun moyen de le DIRE : il
   * aurait dû lire l'horloge et refaire la soustraction lui-même, ce que
   * `CLAUDE.md` §3 règle 1 interdit (aucun calcul métier dans un composant).
   *
   * Même nom et même unité que `schemaJourCalendaire.horizonJours` plus bas :
   * un seul mot pour une seule grandeur, dans les deux contrats.
   */
  horizonJours: z.int(),

  p10: z.int(),
  p50: z.int(),
  p90: z.int(),

  couts: z.object({
    coutRuptureCents: z.int(),
    coutInvenduCents: z.int(),
    /**
     * `false` quand `coutInvenduCents` est un ZERO SENTINELLE : aucune
     * production ni aucune recette au cout connu, donc rien a partir de quoi
     * estimer le cout matiere d'une crepe. Le moteur newsvendor a besoin d'un
     * NOMBRE pour proposer une quantite meme dans ce cas (mode degrade,
     * CLAUDE.md §5) et recoit donc 0 ; l'ecran, lui, doit dire « inconnu ».
     *
     * PORTE JUSQU'ICI le 01/08/2026. Le drapeau existait deja dans
     * `coutsNewsvendor` (`packages/db`) et etait correctement consomme par
     * `/api/lieux-rentabilite` et `/api/opportunites`, mais il n'etait PAS
     * declare dans ce contrat : Zod le supprimait donc EN SILENCE a la
     * frontiere HTTP (docs/39 §5), et `ProchaineSession.tsx` affirmait « un
     * invendu coute 0,00 € de pate » — c'est-a-dire que surproduire est
     * gratuit, presente comme la CAUSE du volume recommande.
     */
    coutInvenduConnu: z.boolean(),
    /**
     * Meme distinction pour le prix de vente moyen, dont `coutRuptureCents`
     * est deduit (`max(0, prix − matiere)`). Il n'y a donc PAS de « cout de
     * rupture connu » separe : `coutRuptureCents` n'est un vrai chiffre que si
     * les DEUX drapeaux sont vrais, puisqu'une matiere inconnue comptee pour 0
     * gonfle la marge perdue d'autant.
     */
    prixMoyenConnu: z.boolean(),
    origine: z.string(),
  }),

  quantileCibleBp: z.int(),
  crepesRecommandees: z.int(),
  crepesRetenues: z.int(),
  contraintes: z.array(schemaContrainte),
  contrainteLimitante: z.string().nullable(),
  manqueAGagnerCents: z.int().nullable(),

  confianceBp: z.int(),
  nbSessionsComparables: z.int(),
  explication: z.array(z.string()),

  /**
   * Plan de production (docs/17 fiche 5) : crêpes et volume de pâte par
   * recette active, sur `crepesRetenues`. Tableau vide et
   * `repartitionIndisponible: true` quand aucune recette active exploitable
   * n'a pu être mesurée (plusieurs recettes actives sans historique de
   * production pour les départager, ou aucune recette active du tout) —
   * jamais une répartition inventée pour remplir l'écran.
   */
  repartition: z.array(
    z.object({
      recetteId: z.string(),
      code: z.string(),
      sansGluten: z.boolean(),
      partBp: z.int(),
      crepes: z.int(),
      volumeMl: z.int(),
    }),
  ),
  /** Même nom que `schemaPrevisionCalendaire.repartitionRecettesIndisponible` ci-dessous : même situation. */
  repartitionRecettesIndisponible: z.boolean(),
  /** Vrai quand le plancher de sécurité sans gluten a dû relever une part mesurée trop basse. */
  plancherSansGlutenApplique: z.boolean(),

  evenements: z.array(
    z.object({
      id: z.string(),
      nom: z.string(),
      type: z.string(),
      impactBp: z.int(),
      mesure: z.boolean(),
    }),
  ),
});

/** Demande d'archivage d'une prevision : la sauvegarde est un acte explicite. */
export const schemaArchivagePrevision = z.object({
  sessionId: z.string().min(1).nullable(),
});

export const schemaPrevisionArchivee = z.object({
  id: z.string(),
  dateCalcul: z.string(),
  versionModele: z.string(),
  sessionId: z.string().nullable(),
  sessionNumero: z.string().nullable(),
  dateSession: z.string().nullable(),
  p50Crepes: z.int(),
  crepesRecommandees: z.int(),
  crepesRetenues: z.int(),
  crepesReelles: z.int().nullable(),
  erreurAbsolueBp: z.int().nullable(),
  confianceBp: z.int(),
});

export const schemaListePrevisions = z.object({
  data: z.array(schemaPrevisionArchivee),
  meta: z.object({ total: z.int() }),
});

/**
 * Combien de fois, sur l'ensemble des prévisions archivées, UN predicteur a
 * été ADMIS (colonne non nulle) contre combien de fois il ne l'a pas été.
 */
export const schemaCompteurPredicteur = z.object({
  nbActif: z.int(),
  nbTotal: z.int(),
});

/**
 * Les quatre "facteurs de précision" de la fiche 07
 * (`docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md` §2),
 * archivés sur CHAQUE prévision (`prevision.facteur_..._bp`, nullable) mais
 * jamais relus avant l'audit du 30/07/2026 (`audit-colonnes-orphelines.test.ts`).
 * L'écran « Qualité du modèle » est le bon endroit pour les afficher : c'est
 * lui qui lit déjà l'historique des prévisions archivées, contrairement à
 * « Prochaine session » qui ne montre que le calcul EN COURS.
 */
export const schemaPredicteursPrecision = z.object({
  facteurComparableCalendaireBp: schemaCompteurPredicteur,
  facteurJourSemaineBp: schemaCompteurPredicteur,
  facteurVacancesScolairesBp: schemaCompteurPredicteur,
  facteurSessionConsecutiveBp: schemaCompteurPredicteur,
});

/**
 * Cumul et fréquence de `prevision.manqueAGagnerCents` et
 * `prevision.contrainteLimitante` — les deux colonnes qui répondent à
 * « combien le fait de ne pas pouvoir produire plus a-t-il coûté, et par quoi
 * la production est-elle le plus souvent bridée ? » (docs/03 « Décision de
 * production »). Archivées à chaque prévision, jamais relues avant l'audit du
 * 30/07/2026.
 */
export const schemaSyntheseManqueAGagner = z.object({
  /** Somme des manques à gagner CHIFFRÉS uniquement (`null` si aucun ne l'a jamais été). */
  totalCents: z.int().nullable(),
  nbPrevisionsChiffrees: z.int(),
  nbPrevisionsTotal: z.int(),
  /** Libellé exact écrit par le moteur (« capacité de cuisson », etc.), jamais réinterprété. */
  contrainteLaPlusFrequente: z.string().nullable(),
  nbPrevisionsContrainteLaPlusFrequente: z.int(),
});

/**
 * Qualite du modele.
 *
 * `tauxCouvertureBp` est le chiffre honnete : un intervalle P10–P90 juste doit
 * contenir le realise 80 % du temps. Beaucoup plus, il est trop large pour
 * servir a quoi que ce soit ; beaucoup moins, il ment.
 */
export const schemaQualiteModele = z.object({
  nbPrevisionsRapprochees: z.int(),
  erreurMoyenneBp: z.int().nullable(),
  tauxCouvertureBp: z.int().nullable(),
  biaisMoyenCrepes: z.int().nullable(),
  /**
   * Trois indicateurs de docs/03 « Mesure de la qualité du modèle »,
   * manquants avant docs/17 fiche 8 (`npm run backtest`). Portent sur une
   * SESSION (production réelle), pas sur une ligne de prévision : une même
   * session peut avoir été prévisionnée plusieurs fois avant sa clôture, on
   * ne garde alors que la dernière prévision archivée pour elle.
   */
  mapeGlissanteBp: z.int().nullable(),
  /** Nombre de sessions ayant contribué à `mapeGlissanteBp` (≤ 10). */
  nbSessionsMapeGlissante: z.int(),
  /** Part des sessions terminées à court de pâte (docs/03). */
  tauxRuptureBp: z.int().nullable(),
  /** Pâte jetée / pâte produite, agrégé sur les sessions exploitables (docs/03). */
  tauxInvenduBp: z.int().nullable(),
  /** Nombre de sessions dont la production réelle alimente les deux taux ci-dessus. */
  nbSessionsEcoulement: z.int(),
  /** Audit du 30/07/2026 : quatre colonnes archivées à chaque prévision, jamais relues avant ce lot. */
  predicteursPrecision: schemaPredicteursPrecision,
  /** Audit du 30/07/2026 : deux colonnes archivées à chaque prévision, jamais relues avant ce lot. */
  syntheseManqueAGagner: schemaSyntheseManqueAGagner,
});

export const schemaTypeEvenement = z.enum([
  'festival',
  'ferie',
  'sportif',
  'meteo_exceptionnelle',
  'greve',
  'travaux',
  'concurrence',
  'autre',
]);

export const schemaPorteeEvenement = z.enum(['national', 'liege', 'quartier']);

export const schemaEvenement = z.object({
  id: z.string(),
  nom: z.string(),
  type: schemaTypeEvenement,
  dateDebut: z.string(),
  dateFin: z.string(),
  portee: schemaPorteeEvenement,
  intensiteEstimee: z.int(),
  impactEstimeBp: z.int(),
  impactMesureBp: z.int().nullable(),
  source: z.string().nullable(),
  valideParHumain: z.boolean(),
  notes: z.string().nullable(),
});

export const schemaListeEvenements = z.object({
  data: z.array(schemaEvenement),
  meta: z.object({ total: z.int() }),
});

export const schemaCreationEvenement = z
  .object({
    nom: z.string().min(1, 'Donnez un nom à l’événement.'),
    type: schemaTypeEvenement,
    dateDebut: z.string().min(1),
    dateFin: z.string().min(1),
    portee: schemaPorteeEvenement,
    intensiteEstimee: z.int().min(1).max(5),
    impactEstimeBp: z.int().positive(),
    source: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((v) => v.dateFin >= v.dateDebut, {
    message: 'La date de fin ne peut pas précéder la date de début.',
    path: ['dateFin'],
  });

export type Prevision = z.infer<typeof schemaPrevision>;
export type PrevisionArchivee = z.infer<typeof schemaPrevisionArchivee>;
export type QualiteModele = z.infer<typeof schemaQualiteModele>;
export type CompteurPredicteur = z.infer<typeof schemaCompteurPredicteur>;
export type PredicteursPrecision = z.infer<typeof schemaPredicteursPrecision>;
export type SyntheseManqueAGagner = z.infer<typeof schemaSyntheseManqueAGagner>;
export type Evenement = z.infer<typeof schemaEvenement>;

/* ═══════════════════════════════════════════════════════════════════════════
   docs/demandes/06 — Prevision calendaire et achats anticipes

   Le piege central de la fiche : une prevision a 300 jours n'a pas la meme
   valeur qu'une prevision a 7 jours, et l'ecran ne doit jamais laisser croire
   le contraire. `bandeHorizon`, `confianceHorizonBp` et `exploitable`
   portent cette honnetete jusqu'au contrat HTTP — `exploitable: false` est le
   signal explicite que l'ecran doit afficher « rien de fiable a annoncer »
   plutot que trois nombres qui se deguisent en prevision.
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaBandeHorizon = z.enum(['fiable', 'elargie']);

/** Prevision d'un jour candidat de l'horizon calendaire — meme grandeurs que
 * `schemaPrevision` ci-dessus, mais SANS les facteurs (l'ecran calendaire
 * affiche un tableau par semaine, pas une decomposition facteur par facteur :
 * celle-ci reste le propre de l'ecran « Prochaine session »). */
export const schemaJourCalendaire = z.object({
  dateSession: z.string(),
  lieuNom: z.string(),
  /** `null` : occurrence recurrente dont aucune session n'a encore ete creee. */
  sessionId: z.string().nullable(),
  horizonJours: z.int(),
  bandeHorizon: schemaBandeHorizon,
  /** 0-10000 : confiance liee a la SEULE distance calendaire (horizon.ts),
   * distincte de `confianceBp` (nombre de sessions observees, schemaPrevision). */
  confianceHorizonBp: z.int(),
  /** Corollaire du piege central : `false` veut dire « rien de fiable a
   * annoncer », l'ecran doit alors taire p10/p50/p90 plutot que les afficher. */
  exploitable: z.boolean(),
  demandeAttendue: z.int(),
  p10: z.int(),
  p50: z.int(),
  p90: z.int(),
  crepesRecommandees: z.int(),
  evenements: z.array(z.object({ id: z.string(), nom: z.string() })),
});

/** Besoin projete d'un ingredient sur une semaine — `quantite` n'est PAS
 * persistee (c'est une projection), elle peut donc rester fractionnaire. */
export const schemaBesoinIngredientSemaine = z.object({
  ingredientId: z.string(),
  nomIngredient: z.string(),
  unite: schemaUnite,
  quantite: z.number(),
});

export const schemaSemaineCalendaire = z.object({
  debutSemaine: z.string(),
  finSemaine: z.string(),
  /**
   * Somme des `crepesRecommandees` des jours de la semaine dont `exploitable`
   * vaut vrai — PAS « les jours de la bande fiable » : `bandeHorizon` n'est
   * qu'une distance calendaire (horizon.ts), alors que `exploitable` est le
   * verdict reel sur la largeur de l'intervalle P10/P90 (`intervalleExploitable`),
   * y compris a l'interieur de la bande fiable si l'historique est encore
   * trop court. Un jour inexploitable ne contribue jamais a ce total : ce
   * serait deguiser du bruit en chiffre solide. Les jours exclus restent
   * visibles individuellement dans `jours[]` (`jour.exploitable === false`),
   * c'est ce que l'ecran utilise pour decider d'afficher ou non ce total.
   */
  crepesPrevues: z.int(),
  jours: z.array(schemaJourCalendaire),
  besoinsIngredients: z.array(schemaBesoinIngredientSemaine),
});

export const schemaDeclencheurReappro = z.enum(['reactif', 'predictif', 'les_deux', 'aucun']);

/**
 * Point de commande PREDICTIF (docs/demandes/06 §3, « l'extension la plus
 * importante ») : le declencheur reactif existant coexiste avec celui-ci, le
 * plus contraignant des deux l'emporte (`declencheur`).
 */
export const schemaAlerteReapproPredictive = z.object({
  ingredientId: z.string(),
  nomIngredient: z.string(),
  unite: schemaUnite,
  delaiLivraisonJours: z.int(),
  fenetreDebutJours: z.int(),
  fenetreFinJours: z.int(),
  /**
   * Projete uniquement a partir des jours EXPLOITABLES de la fenetre (meme
   * regle que `schemaSemaineCalendaire.crepesPrevues`) : un jour que le
   * moteur juge trop incertain n'entre jamais dans ce chiffre. Consequence
   * assumee — sur une fenetre qui contient des jours exclus, ce nombre est
   * un PLANCHER, pas une projection complete : voir `joursExclusFenetre`.
   * Sous-estimer par silence serait pire que sur-stocker (ratio critique
   * newsvendor ≈ 0,93, docs/03) : d'ou l'obligation de le dire plutot que de
   * l'omettre.
   */
  besoinProjeteFenetre: z.number(),
  stockProjeteActuel: z.number(),
  deficit: z.number(),
  declencheur: schemaDeclencheurReappro,
  /**
   * Nombre de jours de la fenetre `[fenetreDebutJours ; fenetreFinJours]`
   * ecartes de `besoinProjeteFenetre` car juges inexploitables par le
   * moteur. `0` = fenetre entierement couverte, le chiffre ci-dessus est
   * complet. `> 0` = besoin sous-estime d'autant de jours non comptes —
   * `explication` le dit en toutes lettres, ne jamais l'afficher comme un
   * besoin certain dans ce cas.
   */
  joursExclusFenetre: z.int(),
  explication: z.string(),
});

export const schemaPrevisionCalendaire = z.object({
  genereLe: z.string(),
  horizonJours: z.int(),
  horizonMaxJours: z.int(),
  semaines: z.array(schemaSemaineCalendaire),
  alertesReapproPredictives: z.array(schemaAlerteReapproPredictive),
  /** Vrai quand plusieurs recettes actives coexistent sans historique de
   * production pour les departager : les besoins en ingredients ne peuvent
   * alors pas etre projetes (docs/17 fiche 5 hors perimetre) — l'ecran doit
   * le dire, pas afficher un tableau vide sans explication. */
  repartitionRecettesIndisponible: z.boolean(),
});

export type JourCalendaire = z.infer<typeof schemaJourCalendaire>;
export type BesoinIngredientSemaine = z.infer<typeof schemaBesoinIngredientSemaine>;
export type SemaineCalendaire = z.infer<typeof schemaSemaineCalendaire>;
export type AlerteReapproPredictive = z.infer<typeof schemaAlerteReapproPredictive>;
export type PrevisionCalendaire = z.infer<typeof schemaPrevisionCalendaire>;
