/**
 * Registre unique des parametres metier.
 *
 * CLAUDE.md §7 : « Ne pas coder en dur des taux, seuils ou montants
 * reglementaires : table `parametre`, avec date de validite et source. »
 * Consigne complementaire du porteur : la regle s'etend a TOUTE valeur metier,
 * pas seulement aux valeurs reglementaires.
 *
 * Ce fichier est la seule source de verite. Il alimente le seed ET la lecture
 * typee, ce qui garantit qu'une cle ne peut pas exister d'un cote sans l'autre.
 * Ajouter un parametre = ajouter une entree ici, rien d'autre.
 */

import { ErreurParametreManquant } from './erreurs.js';
import type { Centimes, PointsDeBase } from './argent.js';

export type TypeValeurParametre = 'entier' | 'decimal' | 'texte' | 'booleen' | 'json';

export type DefinitionParametre = {
  readonly cle: string;
  readonly typeValeur: TypeValeurParametre;
  /** Toujours stockee en texte : la table `parametre` est generique par nature. */
  readonly valeurDefaut: string;
  readonly description: string;
  /** D'ou vient ce chiffre. Obligatoire : un seuil sans source est invérifiable. */
  readonly source: string;
  readonly dateDebutValidite: string;
};

/**
 * Valeurs 2026, a reverifier chaque annee (CLAUDE.md §6). Les seuils legaux ne
 * sont volontairement PAS regroupes ailleurs : ils vivent ici comme les autres,
 * pour qu'il n'existe qu'un seul endroit a mettre a jour.
 */
export const CATALOGUE_PARAMETRES: readonly DefinitionParametre[] = [
  // --- Seuils legaux belges -------------------------------------------------
  {
    cle: 'seuil_franchise_tva_cents',
    typeValeur: 'entier',
    valeurDefaut: '2500000',
    description: "Chiffre d'affaires annuel au-delà duquel la franchise de TVA est perdue.",
    source: 'Régime de franchise des petites entreprises — valeur 2026, à reconfirmer.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'seuil_airbag_cents',
    typeValeur: 'entier',
    valeurDefaut: '2300000',
    description: "Chiffre d'affaires annuel maximal pour rester éligible à l'aide Airbag du Forem.",
    source: 'Forem — aide Airbag, valeur 2026, à reconfirmer.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'seuil_cotisation_reduite_cents',
    typeValeur: 'entier',
    valeurDefaut: '1737408',
    description:
      'Revenu net annuel au-delà duquel le régime de cotisation réduite du complémentaire est perdu.',
    source: 'INASTI — plafond du complémentaire, valeur 2026, à reconfirmer.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'seuil_sce_cents',
    typeValeur: 'entier',
    valeurDefaut: '2500000',
    description:
      "Chiffre d'affaires des SERVICES DE RESTAURATION (consommation sur place, hors " +
      'boissons) au-delà duquel une caisse enregistreuse certifiée (SCE) devient ' +
      'obligatoire. Assiette DIFFÉRENTE du seuil de franchise TVA, qui porte sur le CA ' +
      "total : c'est exactement la confusion d'assiette corrigée en D-054, avec un facteur " +
      "d'erreur différent. La vente à emporter n'est pas un service de restauration : ce " +
      "compteur doit rester affiché À ZÉRO, visiblement, tant qu'il n'y a ni table ni " +
      "chaise au stand — car le jour où l'assiette cesse d'être nulle, la caisse certifiée, " +
      'une fois obligatoire, vaut pour TOUTES les ventes, emporté compris.',
    source:
      "SPF Finances — système de caisse enregistreuse (SCE/GKS) dans l'horeca, " +
      'systemedecaisseenregistreuse.be/fr/qui-quand (page officielle) : « le chiffre ' +
      "d'affaires hors TVA, relatif aux services de restaurant et de restauration, à " +
      "l'exclusion de la fourniture de boissons, dépasse 25.000 euros ». Seuil fixé par " +
      "l'arrêté royal remplaçant la règle des 10 % par la règle des 25 000 € (2016), " +
      'inchangé depuis (vérifié le 2026-07-29 ; les échéances 2025-2026 de la migration ' +
      'SCE 2.0 ne portent que sur le système technique, pas sur ce montant). À reconfirmer ' +
      "auprès du guichet d'entreprises avant de s'y fier pour une décision réelle.",
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'seuil_alerte_bp',
    typeValeur: 'entier',
    valeurDefaut: '8000',
    description: "Part d'un seuil légal à partir de laquelle une alerte est levée (8000 = 80 %).",
    source: 'CLAUDE.md §6 — « alerte à 80 % du seuil ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_horizon_alerte_jours',
    typeValeur: 'entier',
    valeurDefaut: '30',
    description:
      'Nombre de jours avant une échéance réglementaire à partir duquel elle passe en alerte ' +
      'et remonte dans la worklist du tableau de bord. 30 jours laissent le temps de réunir ' +
      "les pièces sans encombrer l'écran toute l'année.",
    source: 'docs/06-UI-ET-PARCOURS.md — worklist « À traiter ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'comptabilite_horizon_affichage_echeances_jours',
    typeValeur: 'entier',
    valeurDefaut: '60',
    description:
      "Coupure d'AFFICHAGE de la colonne « Prochaine date » de l'échéancier réglementaire " +
      '(`Comptabilite.tsx`) : au-delà de ce nombre de jours, la cellule montre la date seule, ' +
      'sans compteur « J-n ». SANS RAPPORT avec `echeance_horizon_alerte_jours` ci-dessus (30, ' +
      'lu côté serveur pour `alerteProche`, qui décide QUAND une échéance passe en alerte) : ' +
      "celui-ci décide seulement JUSQU'À QUAND afficher un compte à rebours — deux questions " +
      'différentes, deux chiffres qui ne coïncident pas par hasard et ne doivent jamais être ' +
      'confondus.',
    source:
      'docs/29-VALEURS-EN-DUR.md §6 point 1 — littéral `60` nu, sans nom ni renvoi, au ' +
      'troisième argument de `formaterJoursRestants` dans `Comptabilite.tsx`. Nommé ' +
      '`HORIZON_AFFICHAGE_ECHEANCES_JOURS` par un correctif du 01/08/2026 qui ne pouvait pas ' +
      "encore créer ce paramètre (`packages/core/src/parametres.ts` hors de sa zone d'écriture) " +
      '; valeur inchangée (60) au moment où le littéral devient ce paramètre réellement lu.',
    dateDebutValidite: '2026-08-01',
  },
  {
    cle: 'seuils_sessions_prevues_par_an',
    typeValeur: 'entier',
    valeurDefaut: '52',
    description:
      "Nombre de sessions attendues sur l'année, utilisé pour projeter le chiffre d'affaires " +
      "de fin d'année et non pour le calculer. 52 = un marché par semaine, sans interruption : " +
      "c'est volontairement l'hypothèse HAUTE. Sur un seuil légal, sur-estimer alerte trop tôt, " +
      "sous-estimer laisse sortir de la franchise TVA sans prévenir — l'erreur prudente est " +
      'celle-là. À baisser dès que le rythme réel est connu (congés, hiver, marchés annulés).',
    source: 'CLAUDE.md §6 — seuils légaux surveillés sur le CA annuel.',
    dateDebutValidite: '2026-01-01',
  },

  // --- Taux -----------------------------------------------------------------
  {
    cle: 'taux_cotisation_inasti_bp',
    typeValeur: 'entier',
    valeurDefaut: '2050',
    description:
      'Taux de cotisation sociale INASTI appliqué au revenu net (2050 = 20,50 %). Estimation ' +
      "indicative : l'application ne remplace pas un comptable.",
    source: "INASTI — taux ordinaire, à confirmer avec le guichet d'entreprise.",
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'taux_ipp_marginal_bp',
    typeValeur: 'entier',
    valeurDefaut: '4000',
    description:
      "Taux marginal d'impôt sur les revenus retenu pour estimer le net. Estimation " +
      "indicative : l'application ne remplace pas un comptable.",
    source: 'À fixer avec le comptable selon la situation fiscale du ménage.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'taux_commission_sumup_bp',
    typeValeur: 'entier',
    valeurDefaut: '169',
    description: 'Commission SumUp par transaction carte (169 = 1,69 %).',
    source: 'CLAUDE.md §6 — contrat SumUp.',
    dateDebutValidite: '2026-01-01',
  },

  // --- Production et chaine du froid ---------------------------------------
  {
    cle: 'quantile_cible_production_bp',
    typeValeur: 'entier',
    valeurDefaut: '9000',
    description:
      'Quantile de demande couvert par la production, utilisé en repli quand le ratio ' +
      'critique newsvendor ne peut pas être calculé faute de données (9000 = 90 %). ' +
      'Dès que les coûts réels sont disponibles, le ratio calculé prime.',
    source: 'docs/05-DECISIONS.md D-006 — modèle du vendeur de journaux.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'temperature_max_froid_c',
    typeValeur: 'decimal',
    valeurDefaut: '7',
    description: 'Température maximale admissible de la glacière, en degrés Celsius.',
    source: 'AFSCA — chaîne du froid pour denrées réfrigérées.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'duree_conservation_pate_heures',
    typeValeur: 'entier',
    valeurDefaut: '24',
    description: "Durée de vie d'un lot de pâte après production, en heures. Fixe sa DLC.",
    source: 'docs/01-SPEC-FONCTIONNELLE.md module 3 — « lot de pâte avec DLC 24 h ».',
    dateDebutValidite: '2026-01-01',
  },

  // --- Moteur de prévision : baseline et incertitude ------------------------
  // Tous ces coefficients sont des HYPOTHÈSES DE DÉPART, pas des vérités. Ils
  // vivent ici précisément pour être remplacés par des valeurs mesurées dès que
  // l'historique le permet (docs/03).
  {
    cle: 'prevision_prior_baseline_crepes',
    typeValeur: 'entier',
    valeurDefaut: '120',
    description:
      "Nombre de crêpes vendues lors d'une session « normale » : météo neutre, sans " +
      "événement, saison moyenne. Valeur de départ à fixer avec l'utilisateur avant le " +
      "premier marché. Elle s'efface d'elle-même à mesure que les données arrivent.",
    source: 'docs/03-MOTEUR-PREVISION.md, facteur 1 — à confirmer avant la première session.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_poids_prior_k',
    typeValeur: 'entier',
    valeurDefaut: '3',
    description:
      "Poids du prior dans l'estimation bayésienne de la baseline : il compte comme k " +
      'sessions observées. Après 12 sessions, il ne pèse plus que 20 %.',
    source: 'docs/03-MOTEUR-PREVISION.md, facteur 1 — « valeur retenue : 3 ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_cv_prior_bp',
    typeValeur: 'entier',
    valeurDefaut: '3500',
    description:
      'Coefficient de variation utilisé tant que moins de 8 sessions sont observées ' +
      '(3500 = 0,35). Intervalle volontairement large : un modèle qui affiche un chiffre ' +
      'sans intervalle au bout de trois sessions ment.',
    source: 'docs/03-MOTEUR-PREVISION.md, section incertitude.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_plancher_sigma_bp',
    typeValeur: 'entier',
    valeurDefaut: '2000',
    description:
      "Plancher de l'écart-type des résidus log, entre 8 et 25 sessions (2000 = 0,20). " +
      'Empêche un intervalle absurdement étroit sur un historique encore court.',
    source: 'docs/03-MOTEUR-PREVISION.md, section incertitude.',
    dateDebutValidite: '2026-01-01',
  },

  {
    cle: 'prevision_demi_vie_ponderation_jours',
    typeValeur: 'entier',
    valeurDefaut: '182',
    description:
      'Demi-vie de la pondération par récence, en jours (182 = 26 semaines). Une ' +
      "session vieille d'une demi-vie compte moitié moins qu'une session du jour. " +
      'La pondération redistribue le poids ENTRE les observations, elle ne retire ' +
      "jamais de masse à l'historique — sans quoi vieillir ferait remonter le prior.",
    source: 'docs/03-MOTEUR-PREVISION.md, « pondération temporelle » — demi-vie de 26 semaines.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_residus_minimum',
    typeValeur: 'entier',
    valeurDefaut: '8',
    description:
      "Nombre minimal de résidus EXPLOITABLES pour qu'un écart-type mesure quelque " +
      "chose. Compte les résidus, pas les sessions : une session à zéro crêpe n'a pas " +
      'de logarithme et ne compte pas. En dessous, le modèle répond « je ne sais pas » ' +
      'plutôt que de donner un intervalle faussement étroit.',
    source: 'docs/03-MOTEUR-PREVISION.md, section incertitude — « n < 8 ».',
    dateDebutValidite: '2026-01-01',
  },

  // --- Moteur de prévision : priors météo (phase 1, n < 20) ----------------
  {
    cle: 'prevision_meteo_pluie_continue_bp',
    typeValeur: 'entier',
    valeurDefaut: '5500',
    description: 'Facteur météo par pluie continue (5500 = ×0,55).',
    source: 'docs/03-MOTEUR-PREVISION.md, priors experts — hypothèse à mesurer.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_meteo_averses_bp',
    typeValeur: 'entier',
    valeurDefaut: '8000',
    description: 'Facteur météo par averses ou pluie intermittente (8000 = ×0,80).',
    source: 'docs/03-MOTEUR-PREVISION.md, priors experts — hypothèse à mesurer.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_meteo_couvert_sec_bp',
    typeValeur: 'entier',
    valeurDefaut: '10000',
    description: 'Facteur météo par temps couvert et sec (10000 = neutre).',
    source: 'docs/03-MOTEUR-PREVISION.md, priors experts.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_meteo_ensoleille_doux_bp',
    typeValeur: 'entier',
    valeurDefaut: '12000',
    description: 'Facteur météo par temps ensoleillé et doux (12000 = ×1,20).',
    source: 'docs/03-MOTEUR-PREVISION.md, priors experts — hypothèse à mesurer.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_meteo_ensoleille_chaud_bp',
    typeValeur: 'entier',
    valeurDefaut: '9000',
    description:
      'Facteur météo par forte chaleur ensoleillée (9000 = ×0,90). La chaleur détourne ' +
      "de la crêpe : c'est l'effet en cloche de la température.",
    source: 'docs/03-MOTEUR-PREVISION.md, priors experts — hypothèse à mesurer.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_meteo_ensoleille_tiede_bp',
    typeValeur: 'entier',
    valeurDefaut: '10000',
    description:
      'Facteur de frequentation par ciel degage et temperature TIEDE — au-dessus de la ' +
      "plage douce, en dessous du seuil de chaleur. Cette plage n'existait pas dans la " +
      'grille : 25 degres sous 13 % de nuages retombait sur « couvert et sec », un beau ' +
      'dimanche de juillet compte comme un jour gris (docs/17 fiche 2). PRIOR NEUTRE ET ' +
      'JAMAIS MESURE (D-059) : refermer le trou de classification est le prealable, la ' +
      "valeur ne se devine pas. 1,10 avait ete propose puis retire — indiscernable d'une " +
      'valeur mesuree une fois en base, ce que CLAUDE.md §3 regle 2 interdit. Ce facteur ' +
      "s'efface de lui-meme des qu'assez de dimanches de cette categorie sont observes et " +
      'que la mesure bat le prior en validation croisee leave-one-out.',
    source: 'docs/05-DECISIONS.md D-059 — les facteurs ne se demandent pas, ils s’apprennent.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_meteo_ensoleille_frais_bp',
    typeValeur: 'entier',
    valeurDefaut: '10000',
    description:
      'Facteur de frequentation par ciel degage et temperature FRAICHE — au-dessus du seuil ' +
      'de froid, en dessous de la plage douce. Second trou de la meme grille : un ciel ' +
      "degage a 8 degres n'est pas un jour couvert (docs/17 fiche 2). PRIOR NEUTRE ET JAMAIS " +
      'MESURE (D-059), meme raisonnement que « ensoleille_tiede » ci-dessus : 1,05 avait ete ' +
      "propose puis retire, faute d'etre distinguable d'une mesure.",
    source: 'docs/05-DECISIONS.md D-059 — les facteurs ne se demandent pas, ils s’apprennent.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_meteo_sec_froid_bp',
    typeValeur: 'entier',
    valeurDefaut: '9500',
    description:
      'Facteur météo par temps sec et froid (9500 = ×0,95). La température joue dans DEUX ' +
      "sens opposés : le froid réduit la fréquentation mais augmente l'attrait d'une crêpe " +
      'chaude. Le facteur net est empirique par nature.',
    source: 'docs/03-MOTEUR-PREVISION.md, priors experts — hypothèse à mesurer.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_meteo_vent_fort_bp',
    typeValeur: 'entier',
    valeurDefaut: '7500',
    description: 'Multiplicateur additionnel par vent fort (7500 = ×0,75), combiné aux autres.',
    source: 'docs/03-MOTEUR-PREVISION.md, priors experts — hypothèse à mesurer.',
    dateDebutValidite: '2026-01-01',
  },

  // --- Moteur de prévision : seuils de classification météo -----------------
  {
    cle: 'prevision_couverture_ensoleille_max_bp',
    typeValeur: 'entier',
    valeurDefaut: '5000',
    description:
      'Couverture nuageuse au-delà de laquelle on ne parle plus de temps ensoleillé ' +
      '(5000 = 50 %). Sépare les catégories « ensoleillé » de « couvert sec ».',
    source: 'docs/03-MOTEUR-PREVISION.md — classification météo.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_horizon_calendaire_jours',
    typeValeur: 'entier',
    valeurDefaut: '365',
    description:
      "Horizon maximal de la prevision calendaire, en jours. Au-dela, l'application ne " +
      'projette plus rien : elle ne dispose ni de meteo, ni d evenements connus, ni d une ' +
      'tendance extrapolable sur cette duree.',
    source: 'docs/demandes/06-PREVISION-CALENDAIRE-365-JOURS-ET-ACHATS-ANTICIPES.md',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_horizon_fiable_jours',
    typeValeur: 'entier',
    valeurDefaut: '10',
    description:
      "Horizon en deca duquel aucune inflation d'incertitude n'est appliquee. Cale sur la " +
      "portee reelle d'une prevision meteo : au-dela, on ne sait plus quel temps il fera, " +
      "et l'intervalle doit s'elargir pour le dire.",
    source: 'docs/demandes/06 — croissance de l incertitude avec l horizon.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_horizon_inflation_pente_bp_par_semaine',
    typeValeur: 'entier',
    valeurDefaut: '500',
    description:
      "Croissance de l'inflation de l'ecart-type, en points de base par semaine entamee " +
      "au-dela de l'horizon fiable. Une prevision a 300 jours ne vaut pas une prevision a " +
      '7 jours, et l affichage doit le montrer plutot que de laisser croire le contraire.',
    source: 'docs/demandes/06 — croissance de l incertitude avec l horizon.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_horizon_inflation_max_bp',
    typeValeur: 'entier',
    valeurDefaut: '50000',
    description:
      "Plafond de l'inflation d'incertitude liee a l'horizon (50 000 bp = x5). Sans " +
      'plafond, une projection lointaine produirait un intervalle si large qu il ne serait ' +
      'meme plus affichable.',
    source: 'docs/demandes/06 — croissance de l incertitude avec l horizon.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_intervalle_inutile_ratio_bp',
    typeValeur: 'entier',
    valeurDefaut: '20000',
    description:
      "Ratio (P90 - P10) / P50 au-dela duquel l'intervalle est declare inexploitable et " +
      "l'ecran affiche « trop incertain » au lieu de chiffres. Corollaire assume : quand le " +
      'modele n a rien de serieux a dire, il vaut mieux ne rien dire que produire un nombre.',
    source: 'docs/demandes/06 — corollaire de l horizon.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'reappro_marge_securite_predictive_jours',
    typeValeur: 'entier',
    valeurDefaut: '7',
    description:
      'Marge ajoutee au delai fournisseur pour la fenetre du point de commande PREDICTIF. ' +
      'Avec 7 jours, un ingredient a delai 10 j declenche jusqu a J+17 : un evenement plus ' +
      "lointain n'alertera qu avec une marge reglee en consequence — c'est precisement " +
      "l'interet d'un parametre plutot que d'une constante.",
    source: 'docs/demandes/06 — point de commande predictif.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_sessions_avant_sigma_mesure',
    typeValeur: 'entier',
    valeurDefaut: '8',
    description:
      "Nombre de sessions en dessous duquel l'écart-type n'est pas mesuré du tout : on " +
      "assume le coefficient de variation a priori. C'est un choix d'honnêteté — un modèle " +
      'qui affiche un intervalle serré au bout de trois sessions ment.',
    source: 'docs/03-MOTEUR-PREVISION.md — section incertitude.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_demi_confiance_sessions',
    typeValeur: 'entier',
    valeurDefaut: '10',
    description:
      "Nombre de sessions comparables auquel la confiance affichee atteint 50 %. C'est le " +
      'seul reglage de la courbe `n / (n + k)` : avec 10, on lit ~67 % a 20 sessions, ~75 % a ' +
      '30, ~83 % a 50 — et jamais 100 %, ce qui est la verite d un modele statistique. ' +
      'Augmenter cette valeur rend le modele plus modeste, la diminuer le rend plus ' +
      'peremptoire ; elle ne change aucune prevision, seulement la confiance annoncee.',
    source:
      'docs/03-MOTEUR-PREVISION.md — palier de qualite utile a 20-30 sessions. La valeur 10 ' +
      "etait codee en dur dans `confianceBp` (moteur.ts) et l'a ete jusqu'au 30/07/2026 ; " +
      "elle reproduit exactement l'ancien comportement et reste a calibrer sur l'historique reel.",
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_sessions_sigma_fiable',
    typeValeur: 'entier',
    valeurDefaut: '25',
    description:
      "Nombre de sessions à partir duquel l'écart-type mesuré est retenu tel quel. En " +
      'dessous, il est relevé au plancher : un historique court sous-estime toujours la ' +
      "variabilité, parce qu'il n'a pas encore rencontré la mauvaise journée.",
    source: 'docs/03-MOTEUR-PREVISION.md — section incertitude.',
    dateDebutValidite: '2026-01-01',
  },

  // --- Moteur de prévision : saison, tendance, répartition entre recettes ---
  // Facteurs 4 (saison) et 5 (tendance) de docs/03-MOTEUR-PREVISION.md, plus la
  // répartition entre recettes de la décision de production. Ces clés étaient
  // déjà LUES par `apps/api/src/routes/previsions.ts` et `packages/db/src/
  // scripts/backtest.ts` via un repli sûr (`entierAvecRepli`) tant qu'elles
  // n'existaient pas ici : les ajouter ne change donc AUCUN comportement, cela
  // rend seulement le réglage possible sans modifier le code.
  {
    cle: 'prevision_saison_observations_minimum',
    typeValeur: 'entier',
    valeurDefaut: '3',
    description:
      "Nombre minimal d'observations pour un mois donné avant d'estimer son effet " +
      'de saison propre. Démarrage à froid de ce facteur, même esprit que ' +
      '`prevision_sessions_avant_sigma_mesure` : en dessous, un seul point ne prouve rien.',
    source: 'docs/03-MOTEUR-PREVISION.md, facteur 4 — saison.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_saison_mois_distincts_minimum',
    typeValeur: 'entier',
    valeurDefaut: '4',
    description:
      "Nombre de mois CIVILS distincts devant être représentés dans l'historique " +
      "avant d'activer l'effet de saison. Démarrage à froid de ce facteur, même " +
      'esprit que `prevision_sessions_avant_sigma_mesure`.',
    source: 'docs/03-MOTEUR-PREVISION.md, facteur 4 — saison.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_tendance_sessions_minimum',
    typeValeur: 'entier',
    valeurDefaut: '10',
    description:
      "Nombre minimal de sessions avant d'activer le facteur de tendance. En " +
      'dessous, le facteur reste neutre (1,00) — reprise littérale de docs/03.',
    source: 'docs/03-MOTEUR-PREVISION.md, facteur 5 — « Neutre (1,00) tant que n < 10 ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_tendance_fenetre_sessions',
    typeValeur: 'entier',
    valeurDefaut: '12',
    description:
      'Taille de la fenêtre de régression linéaire (en nombre des dernières ' +
      'sessions) utilisée pour estimer la tendance — reprise littérale de docs/03.',
    source:
      'docs/03-MOTEUR-PREVISION.md, facteur 5 — « régression linéaire sur les 12 ' +
      'dernières sessions ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_tendance_borne_bp',
    typeValeur: 'entier',
    valeurDefaut: '3000',
    description:
      'Plafond de la variation mensuelle de tendance, en points de base (3000 = ' +
      '±30 %) : empêche une série chanceuse ou malchanceuse de produire une ' +
      'extrapolation absurde — reprise littérale de docs/03.',
    source: 'docs/03-MOTEUR-PREVISION.md, facteur 5 — « Bornée à ±30 % ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_repartition_plancher_sans_gluten_bp',
    typeValeur: 'entier',
    valeurDefaut: '0',
    description:
      'Part minimale (en points de base) réservée à la recette sans gluten (R2) ' +
      'dans la répartition de production, même quand son poids mesuré est plus ' +
      'bas. DÉSACTIVÉ PAR DÉFAUT (0) : docs/03 demande un plancher de sécurité ' +
      'mais ne chiffre aucun pourcentage, et en inventer un serait exactement le ' +
      "prior non neutre que CLAUDE.md §3 interdit. C'est au porteur du projet de " +
      "fixer cette part s'il veut garantir une offre sans gluten minimale — tant " +
      'que la clé reste à 0, la fonctionnalité est simplement désactivée, pas en panne.',
    source:
      'docs/03-MOTEUR-PREVISION.md, « répartition entre recettes » — plancher ' +
      'demandé mais non chiffré ; valeur 0 = désactivé, décision explicite, pas une ' +
      'estimation.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_repartition_arrondi_volume_ml',
    typeValeur: 'entier',
    valeurDefaut: '500',
    description:
      "Pas d'arrondi, en millilitres, appliqué au volume de pâte recommandé par " +
      'recette après conversion des litres — reprise littérale de docs/03.',
    source:
      'docs/03-MOTEUR-PREVISION.md, « répartition entre recettes » — « arrondi au ' +
      'demi-litre ».',
    dateDebutValidite: '2026-01-01',
  },

  {
    cle: 'prevision_seuil_pluie_continue_mm',
    typeValeur: 'decimal',
    valeurDefaut: '2',
    description:
      'Précipitations cumulées sur la fenêtre au-delà desquelles on parle de pluie continue.',
    source: 'docs/03-MOTEUR-PREVISION.md — « > 2 mm sur la fenêtre ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_seuil_vent_fort_kmh',
    typeValeur: 'decimal',
    valeurDefaut: '40',
    description: 'Vent moyen au-delà duquel le multiplicateur de vent fort s applique.',
    source: 'docs/03-MOTEUR-PREVISION.md — « vent > 40 km/h ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_temp_douce_min_c',
    typeValeur: 'decimal',
    valeurDefaut: '10',
    description: 'Borne basse de la plage de température dite douce.',
    source: 'docs/03-MOTEUR-PREVISION.md — « ensoleillé, 10–22 °C ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_temp_douce_max_c',
    typeValeur: 'decimal',
    valeurDefaut: '22',
    description: 'Borne haute de la plage de température dite douce.',
    source: 'docs/03-MOTEUR-PREVISION.md — « ensoleillé, 10–22 °C ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_temp_chaude_c',
    typeValeur: 'decimal',
    valeurDefaut: '26',
    description: 'Température au-delà de laquelle la chaleur détourne de la crêpe.',
    source: 'docs/03-MOTEUR-PREVISION.md — « ensoleillé, > 26 °C ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_temp_froide_c',
    typeValeur: 'decimal',
    valeurDefaut: '5',
    description: 'Température en dessous de laquelle on parle de temps froid.',
    source: 'docs/03-MOTEUR-PREVISION.md — « sec et froid, < 5 °C ».',
    dateDebutValidite: '2026-01-01',
  },

  // --- Contraintes dures de production --------------------------------------
  {
    cle: 'capacite_cuisson_crepes_par_heure',
    typeValeur: 'entier',
    valeurDefaut: '60',
    description:
      'Débit de cuisson : deux plaques gaz en parallèle, environ 2 min par crêpe, ' +
      "soit ~60 crêpes/heure. À mesurer sur les premières sessions — c'est ce chiffre " +
      "qui justifiera un jour l'achat d'une troisième plaque.",
    source: 'CLAUDE.md §6 — deux plaques, ≈ 2 h 16 de cuisson pour ≈ 134 crêpes.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'marge_securite_service_bp',
    typeValeur: 'entier',
    valeurDefaut: '8500',
    description:
      'Part de la fenêtre de marché réellement consacrée à la cuisson (8500 = 85 %). ' +
      'Le reste part en service, encaissement et nettoyage.',
    source: 'docs/03-MOTEUR-PREVISION.md, contraintes dures — hypothèse à mesurer.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'glaciere_volume_utile_ml',
    typeValeur: 'entier',
    valeurDefaut: '18000',
    description:
      'Volume utile de la glacière, en millilitres. Contrainte de chaîne du froid : ' +
      "on ne transporte pas plus de pâte que ce qu'on peut garder au froid.",
    source: 'docs/06-UI-ET-PARCOURS.md, écran Prochaine session — « glacière (18 L utiles) ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'transport_volume_pate_max_ml',
    typeValeur: 'entier',
    valeurDefaut: '0',
    description:
      "Volume maximal de PÂTE transportable jusqu'au stand sans véhicule adapté, en " +
      'millilitres — quatrième contrainte dure de docs/03-MOTEUR-PREVISION.md, absente ' +
      "du moteur jusqu'à l'audit du 30/07/2026 (aucun paramètre, aucun code, nulle part " +
      "dans le dépôt). Porte UNIQUEMENT sur le volume de pâte : c'est la seule quantité " +
      'que le moteur sait chiffrer aujourd’hui (bacs, garnitures, consommables, glacière ' +
      "elle-même n'ont ni volume ni poids suivis quelque part dans l'application) — " +
      'élargir la portée reviendrait à prétendre modéliser un coffre de voiture sans en ' +
      'avoir les données. VALEUR PAR DÉFAUT 0 = NON RENSEIGNÉ, JAMAIS « aucune limite » : ' +
      "tant que cette clé vaut 0, aucun écrêtage n'est appliqué et la prévision le dit " +
      'explicitement (« volume transportable non renseigné — cette contrainte n’est pas ' +
      'contrôlée »), plutôt que de choisir entre inventer un plafond ou laisser croire à ' +
      'une capacité illimitée — les deux erreurs symétriques que ce dépôt corrige sans ' +
      "relâche (« inconnu = zéro » autant que « inconnu = infini »). C'est au porteur de " +
      "mesurer cette limite sur son propre véhicule (combien de bacs d'un volume connu y " +
      'tiennent réellement) : aucune valeur plausible ne peut être devinée depuis ce dépôt.',
    source:
      'docs/03-MOTEUR-PREVISION.md, « Contraintes dures appliquées après le calcul », ' +
      'point 4 — « volume maximal transportable sans véhicule personnel ». Absence ' +
      "constatée par recherche exhaustive du dépôt lors de l'audit du 30/07/2026. Valeur " +
      'à mesurer sur le matériel réel du porteur — question posée dans le rapport de ' +
      'livraison de cette clé, non tranchée ici.',
    dateDebutValidite: '2026-07-30',
  },

  // --- Registre AFSCA : plan de nettoyage (Lot 8) ---------------------------
  {
    cle: 'nettoyage_delai_hebdomadaire_jours',
    typeValeur: 'entier',
    valeurDefaut: '7',
    description:
      'Nombre de jours au-delà duquel une tâche de nettoyage « hebdomadaire » ' +
      'sans exécution récente est signalée en retard.',
    source: 'docs/02-MODELE-DONNEES.md — table tache_nettoyage, fréquence hebdomadaire.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'nettoyage_delai_mensuel_jours',
    typeValeur: 'entier',
    valeurDefaut: '31',
    description:
      'Nombre de jours au-delà duquel une tâche de nettoyage « mensuelle » ' +
      'sans exécution récente est signalée en retard. 31 et non 30 : un mois ' +
      "plein ne doit pas déclencher une fausse alerte le jour même de l'échéance.",
    source: 'docs/02-MODELE-DONNEES.md — table tache_nettoyage, fréquence mensuelle.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'afsca_motifs_incident_sanitaire_json',
    typeValeur: 'json',
    valeurDefaut: '["RAPPEL_FOURNISSEUR","QUARANTAINE_DOUTE","DLC_DEPASSEE","NON_CONFORME"]',
    description:
      'Codes motif (packages/core/src/motifs.ts) qui, appliqués à un changement de STATUT ' +
      'de lot (`changerStatutLot`, packages/db/src/services/mouvements.ts), ouvrent ' +
      'AUTOMATIQUEMENT une non-conformité AFSCA liée au lot — même principe que ' +
      "`ecrireReleveTemperature` pour un relevé hors seuil : « une non-conformité qu'on " +
      "peut oublier d'ouvrir n'est pas un contrôle ». Le critère retenu est le MOTIF, pas " +
      'le statut cible : traduit-il un INCIDENT SANITAIRE (un doute réel sur la sécurité ' +
      'de la denrée), par opposition à un ajustement de gestion de stock ? RAPPEL_FOURNISSEUR ' +
      '(événement le plus grave du catalogue), QUARANTAINE_DOUTE (son libellé dit lui-même ' +
      '« conformité à vérifier » — un doute sanitaire non résolu), DLC_DEPASSEE (une perte ' +
      'SUBIE, pas un choix de gestion) et NON_CONFORME (nomme littéralement la ' +
      'non-conformité) sont retenus. EXCLU DÉLIBÉRÉMENT, et non par oubli : ' +
      "LEVEE_QUARANTAINE — c'est la RÉSOLUTION d'un doute déjà tracé par QUARANTAINE_DOUTE, " +
      'jamais un nouvel incident ; en ouvrir une seconde ici doublerait la même situation ' +
      'ligne pour ligne. Les motifs `ajustement` (INVENTAIRE_ECART, ERREUR_SAISIE) et les ' +
      '`sortie_volontaire`/`perte` de production ne passent jamais par un changement de ' +
      'STATUT de lot (ils relèvent de `enregistrerSortie`), donc n’atteignent jamais ce ' +
      'prédicat en pratique — ils restent exclus explicitement plutôt que par défaut ' +
      'silencieux, pour que la liste reste une décision et non un oubli.',
    source:
      'Arbitrage métier posé et justifié dans packages/db/src/services/mouvements.ts ' +
      '(motifOuvreNonConformite), confirmé lors de sa migration vers ce catalogue le ' +
      '29/07/2026 (audit AFSCA, packages/db/src/audit-afsca.test.ts). Valeur par défaut ' +
      "IDENTIQUE au comportement déjà éprouvé : ce n'est pas une hypothèse à apprendre, " +
      "c'est une décision métier déjà tranchée — ne pas la neutraliser lors d'une révision.",
    dateDebutValidite: '2026-01-01',
  },

  // --- Réapprovisionnement automatique (Lot 7) ------------------------------
  {
    cle: 'reappro_niveau_service_z',
    typeValeur: 'decimal',
    valeurDefaut: '1.28',
    description:
      'Coefficient Z du niveau de service visé pour le stock de sécurité : ' +
      '1,28 = 90 %, 1,65 = 95 %, 2,33 = 99 %. Cohérent avec le quantile cible de ' +
      '90 % déjà retenu pour la décision de production (D-006).',
    source: 'docs/07-DOCTRINE-ERP-ET-DESIGN.md §1.9 — point de commande statistique.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'reappro_fenetre_historique_jours',
    typeValeur: 'entier',
    valeurDefaut: '90',
    description:
      "Fenêtre d'historique de consommation (jours calendaires) utilisée pour " +
      "estimer la moyenne et l'écart-type journaliers de chaque ingrédient. " +
      'Trop courte, elle est bruitée ; trop longue, elle efface les changements ' +
      'de rythme récents.',
    source: 'docs/01-SPEC-FONCTIONNELLE.md module 2 — « calcul quotidien du point de commande ».',
    dateDebutValidite: '2026-01-01',
  },

  // --- Déplacement et arbitrage entre lieux (fiche 13) ----------------------
  // Un SEUL coût kilométrique tout compris (carburant, pneus, entretien) —
  // decision explicite du porteur : « le temps de trajet n'a pas de cout
  // direct, mais il faut compter l'usure des pneus, l'entretien du vehicule,
  // le carburant. » Aucune valorisation du temps de trajet, jamais.
  {
    cle: 'cout_kilometrique_cents_par_km',
    typeValeur: 'decimal',
    valeurDefaut: '47.61',
    description:
      "Coût kilométrique tout compris (carburant, pneus, entretien), en centimes d'euro par " +
      'kilomètre. Sert UNIQUEMENT au coût de déplacement d’une session et à la comparaison ' +
      'entre lieux (docs/demandes/13) — jamais à valoriser le temps de trajet lui-même. ' +
      'Décimal et non entier : la valeur officielle est précise au centime près (0,4761 €), ' +
      'arrondir à l’entier aurait introduit une erreur qu’aucune loi n’exige.',
    source:
      'Indemnité kilométrique belge (arrêté royal du 18 janvier 1965), montant ANNUEL en ' +
      'vigueur du 01/07/2026 au 30/06/2027 : 0,4761 €/km (Circulaire n° 767 du 8 juin 2026, ' +
      'Moniteur belge du 16/06/2026). Vérifié le 29/07/2026 via deux sources indépendantes ' +
      '(UCM — Union des Classes Moyennes, et ProLegal) qui republient ce montant officiel. ' +
      'C’est la référence usuelle pour ce type de forfait (docs/demandes/13 §3.1) ; la ' +
      'déductibilité fiscale exacte pour un indépendant complémentaire reste une question ' +
      'pour le comptable (docs/demandes/13 §3.2), non tranchée ici. Un second montant existe, ' +
      'à révision TRIMESTRIELLE (0,4440 €/km au 01/07/2026), utilisé par certains employeurs ' +
      'pour un remboursement indexé au carburant : le montant ANNUEL est retenu ici, révisé ' +
      'une fois par an comme l’attendait la fiche. À réviser au prochain ajustement ' +
      '(normalement le 1er juillet suivant).',
    dateDebutValidite: '2026-07-01',
  },
  {
    cle: 'cout_kilometrique_mesure_pleins_minimum',
    typeValeur: 'entier',
    valeurDefaut: '8',
    description:
      'Nombre minimal de pleins de carburant enregistrés (`depense.categorie = ' +
      "'carburant'`) avant que le coût kilométrique MESURÉ ne prime sur le forfait " +
      'officiel ci-dessus (docs/demandes/13 §3.1, voie B). Même patron que D-059 ' +
      '(« les facteurs ne se demandent pas, ils s’apprennent ») : en dessous, un ou ' +
      'deux pleins isolés (prix ponctuellement haut ou bas à la pompe) donneraient un ' +
      'coût au km qui ne veut rien dire — on reste sur le forfait, et l’écran dit ' +
      'lequel des deux s’applique. Valeur alignée sur ' +
      '`prevision_sessions_avant_sigma_mesure`, qui retient le même seuil pour la même ' +
      'raison (une mesure sur une poignée de points ne prouve rien) — une notion ' +
      'différente (des pleins, pas des sessions), donc une clé séparée plutôt qu’une ' +
      'clé partagée qui les confondrait.',
    source: 'docs/05-DECISIONS.md — même doctrine que D-059, appliquée au coût kilométrique.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'adresse_depart_defaut',
    typeValeur: 'texte',
    valeurDefaut: '',
    description:
      "Adresse de domicile utilisée comme point de départ PAR DÉFAUT d'une session de " +
      'marché, quand celle-ci ne surcharge pas `session_marche.point_depart_texte` ' +
      '(D-064 point 1 : « une adresse de domicile en paramètre sert de défaut, et chaque ' +
      'session peut surcharger » — surcharge et non remplacement, le cas courant ne ' +
      "demande aucune saisie). Vide (« non renseignée ») tant que le porteur ne l'a pas " +
      "saisie dans l'écran Paramètres : AUCUNE adresse plausible n'est fabriquée ici. Une " +
      'valeur inventée produirait des distances, puis des coûts de déplacement, faux sans ' +
      "que rien ne le signale — bien pire qu'une case vide qui, elle, s'affiche comme " +
      'telle et rend le coût de déplacement explicitement incalculable ' +
      '(`packages/core/src/point-depart.ts`).',
    source:
      "À saisir par le porteur lui-même dans l'écran Paramètres — aucune adresse n'est " +
      "connue au moment où ce catalogue est écrit, et personne d'autre que lui ne peut la " +
      'fournir légitimement.',
    dateDebutValidite: '2026-07-30',
  },

  // --- Énergie : électricité au compteur et point d'équilibre solaire/éolien (fiche 17) ---
  {
    cle: 'prix_kwh_cents_par_kwh',
    typeValeur: 'entier',
    valeurDefaut: '20',
    description:
      "Prix du kilowattheure d'électricité, en centimes d'euro ENTIERS, pour les lieux " +
      "facturés AU COMPTEUR (`lieu_marche.facturation_electricite = 'compteur'`). Sert au " +
      'coût d’électricité par session (`coutEnergieSessionCents`) et au coût évité qui ' +
      "alimente le point d'équilibre solaire/éolien (docs/demandes/17 §2 et §3). " +
      'VALEUR DE DÉPART À CORRIGER AVEC LE VRAI CONTRAT, comme `prevision_prior_baseline_' +
      'crepes` ou `taux_ipp_marginal_bp` : contrairement au tarif kilométrique (un montant ' +
      "OFFICIEL unique fixé par arrêté royal), le prix de l'électricité varie fortement " +
      "d'un contrat à l'autre (compteur simple ou bihoraire, fixe ou variable) et dans le " +
      "temps — ce n'est PAS un taux réglementaire, seulement une moyenne de marché faute de " +
      'mieux. À remplacer par le prix réellement facturé dès qu’un relevé est disponible ' +
      '(écran Paramètres) — jamais laissé tel quel pour une décision réelle.',
    source:
      'Comparateurs belges (callmepower.be, « Le prix du kWh en Belgique en juillet 2026 ») : ' +
      'coût total facturé (énergie + réseau + taxes) pour un compteur simple en Wallonie ' +
      'estimé autour de 20 c€/kWh en juillet 2026 (la part énergie seule variant de 10,60 à ' +
      '20,87 c€/kWh selon l’offre — un facteur presque du simple au double, signe que ce ' +
      'chiffre est une moyenne et non une référence unique). Le rapport de la CREG « Prix de ' +
      'l’énergie pour les ménages — constatations avril 2026 » (creg.be, 3 avril 2026) ' +
      'confirme une hausse de ~16,40 % de la composante énergie sur la période sans donner de ' +
      'tarif TTC absolu. Vérifié le 30/07/2026. À reconfirmer sur la facture réelle : ce ' +
      "chiffre n'a pas la même autorité qu'un montant fixé par arrêté royal (comparer à " +
      '`cout_kilometrique_cents_par_km` ci-dessus).',
    dateDebutValidite: '2026-07-30',
  },

  // --- Opportunités : taux de prise d'un stand entreprise (fiche 14 §3.2, D-059) --
  // « Le taux de prise ne peut venir que de l'observation » — mais un taux
  // mesuré chez UNE SEULE entreprise ne se transporte à AUCUNE autre (une
  // entreprise de 200 personnes avec cantine et une de 40 sans rien n'ont
  // aucune raison de partager un taux, voir `packages/core/src/opportunites.ts`
  // — `tauxPriseEntrepriseObserve`). Ce seuil ne gouverne donc PAS un pool
  // global : il gouverne le nombre de sessions closes rattachées AU MÊME
  // `evenement` (la même entreprise, visitée plusieurs fois) avant que SON
  // taux à elle devienne utilisable pour SA prochaine session.
  {
    cle: 'opportunite_entreprise_observations_minimum',
    typeValeur: 'entier',
    valeurDefaut: '3',
    description:
      'Nombre de sessions closes rattachées à LA MÊME entreprise (même `evenement`), en ' +
      "dessous duquel son taux de prise n'est pas utilisé : une seule visite est un pari, pas " +
      'une mesure. Démarrage à froid, même esprit que `prevision_sessions_avant_sigma_mesure`, ' +
      'mais volontairement plus bas : une entreprise se visite typiquement une poignée de fois ' +
      'par an, un seuil calqué sur le rythme hebdomadaire des marchés ne serait jamais atteint.',
    source:
      'Aucune valeur donnée par docs/demandes/14-EVENEMENTS-COMME-OPPORTUNITES.md §3.2 (« le ' +
      "taux de prise... ne peut venir que de l'observation : la première fois est un pari, " +
      "ensuite il s'apprend »). Hypothèse de démarrage à froid non tranchée par le porteur, à " +
      'confirmer — voir le rapport de livraison du lot ayant ajouté cette clé.',
    dateDebutValidite: '2026-01-01',
  },

  // --- Documents : brief avant-marché ---------------------------------------
  {
    cle: 'brief_horizon_alerte_dlc_jours',
    typeValeur: 'entier',
    valeurDefaut: '7',
    description:
      'Nombre de jours avant DLC à partir duquel un lot figure parmi les alertes ' +
      'du brief avant-marché (points de vigilance).',
    source:
      'docs/01-SPEC-FONCTIONNELLE.md module 4 — « points de vigilance » du brief avant-marché.',
    dateDebutValidite: '2026-01-01',
  },

  // --- Assistance Claude (Lot 9) --------------------------------------------
  // L'IA est un CONFORT, jamais une dependance (CLAUDE.md §5) : l'application
  // reste pleinement fonctionnelle avec un plafond a zero ou sans cle d'API.
  {
    cle: 'plafond_ia_mensuel_cents',
    typeValeur: 'entier',
    valeurDefaut: '500',
    description:
      "Plafond de dépense Claude par mois civil, en centimes d'euro. Une fois " +
      'atteint, les appels non essentiels sont refusés proprement et ' +
      "l'application continue de fonctionner. Mettre 0 coupe l'IA entièrement.",
    source:
      'CLAUDE.md §5 — « un plafond mensuel configurable qui coupe les appels non essentiels ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'ia_modele_extraction',
    typeValeur: 'texte',
    valeurDefaut: 'claude-haiku-4-5-20251001',
    description:
      'Modèle bon marché de la famille « extraction ». Il sert aujourd’hui à la ' +
      'découverte d’événements (recherche web). La lecture d’un bon de livraison, ' +
      'prévue pour cette famille, n’est pas implémentée.',
    source:
      'CLAUDE.md §5. Statut vérifié le 28/09/2026 sur la page officielle des retraits ' +
      'de modèles Anthropic : actif, non déprécié, retrait provisoire pas avant le ' +
      '15/10/2026, avec un préavis annoncé d’au moins 60 jours.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'ia_modele_commentaire',
    typeValeur: 'texte',
    valeurDefaut: 'claude-sonnet-5',
    description:
      "Modèle utilisé pour les commentaires de prévision, analyses d'écart et " +
      'briefs avant-marché. Environ 4 appels par mois.',
    source: 'CLAUDE.md §5 — tableau des trois usages.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'ia_tarif_extraction_entree_cents_par_mtok',
    typeValeur: 'entier',
    valeurDefaut: '92',
    description:
      "Tarif d'entrée du modèle d'extraction, en centimes d'euro par million de " +
      'tokens. Sert UNIQUEMENT au compteur de coût, jamais à la facturation ' +
      "réelle : c'est une estimation, convertie du tarif en dollars.",
    source:
      'CLAUDE.md §5 — Haiku 4.5 à 1 $/Mtok en entrée (vérifié le 26/07/2026), ' +
      'converti à ~0,92 €. À réviser si le change ou le tarif bougent.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'ia_tarif_extraction_sortie_cents_par_mtok',
    typeValeur: 'entier',
    valeurDefaut: '460',
    description:
      "Tarif de sortie du modèle d'extraction, en centimes d'euro par million de tokens.",
    source: 'CLAUDE.md §5 — Haiku 4.5 à 5 $/Mtok en sortie, converti à ~4,60 €.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'ia_tarif_commentaire_entree_cents_par_mtok',
    typeValeur: 'entier',
    valeurDefaut: '184',
    description:
      "Tarif d'entrée du modèle de commentaire, en centimes d'euro par million de tokens.",
    source:
      'Sonnet 5 à 2 $/Mtok en entrée, converti à ~1,84 €. Le tarif d’introduction ' +
      'est devenu le tarif standard (page officielle des prix, vérifiée le 28/09/2026).',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'ia_tarif_commentaire_sortie_cents_par_mtok',
    typeValeur: 'entier',
    valeurDefaut: '920',
    description:
      'Tarif de sortie du modèle de commentaire, en centimes d’euro par million de tokens.',
    source:
      'Sonnet 5 à 10 $/Mtok en sortie, converti à ~9,20 €. Le tarif d’introduction ' +
      'est devenu le tarif standard (page officielle des prix, vérifiée le 28/09/2026).',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'ia_tokens_sortie_max',
    typeValeur: 'entier',
    valeurDefaut: '1024',
    description:
      'Plafond de tokens en sortie par appel. Borne le coût du pire cas et évite ' +
      "qu'un commentaire déborde de son panneau à l'écran.",
    source: 'Choix de conception — un commentaire tient en quelques paragraphes.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'ia_tarif_recherche_web_cents_par_mille',
    typeValeur: 'entier',
    valeurDefaut: '920',
    description:
      "Tarif de l'outil serveur `web_search`, en centimes d'euro pour 1000 recherches " +
      'EFFECTIVEMENT exécutées. Facturé PAR ANTHROPIC SÉPARÉMENT du coût des tokens ' +
      "d'entrée/sortie : ce tarif s'ADDITIONNE à `coutAppelCents`, il ne le remplace " +
      'jamais. Conversion au MÊME taux que les autres tarifs de ce catalogue (~0,92 €/$, ' +
      'voir `ia_tarif_extraction_entree_cents_par_mtok` et les clés voisines) : 10 $ → ' +
      '920 centimes pour 1000 recherches.',
    source:
      'platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool, section ' +
      '« Usage and pricing », vérifié le 29/07/2026 par lecture directe de la page : ' +
      '« Web search is available on the Claude API for $10 per 1,000 searches, plus ' +
      'standard token costs. » Tarif fournisseur vérifiable, pas une supposition. À ' +
      'réviser si Anthropic change ce tarif ou si le taux de change de référence bouge.',
    dateDebutValidite: '2026-01-01',
  },

  // --- Moteur de prévision : prédicteurs de précision (fiche 07) ------------
  // Cinq nouveaux prédicteurs de docs/demandes/07-HISTORIQUE-VENTES-RETENTION-
  // ET-PRECISION.md §2 (comparable calendaire, jour de semaine, vacances
  // scolaires, écart météo prévue/réalisée, session consécutive), chacun
  // soumis à `validerParLeaveOneOut` avant d'entrer dans le calcul
  // (`packages/core/src/prevision/validation-croisee.ts`). Les demi-vies de
  // récence de ces trois derniers réutilisent DÉLIBÉRÉMENT
  // `prevision_demi_vie_ponderation_jours`, déjà au catalogue : une seule
  // notion de « combien de temps une observation compte encore », pas cinq.
  {
    cle: 'prevision_comparable_calendaire_fenetre_jours',
    typeValeur: 'entier',
    valeurDefaut: '10',
    description:
      'Tolérance, en jours calendaires, autour du jour cible (ex. Chandeleur) pour ' +
      "qu'une observation historique compte comme un « comparable » de ce jour précis.",

    source:
      'docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md §2 — ' +
      'prédicteur « comparable historique du même jour calendaire ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_comparable_calendaire_age_minimum_jours',
    typeValeur: 'entier',
    valeurDefaut: '250',
    description:
      "Âge minimal (en jours) pour qu'une observation compte comme « année " +
      'antérieure » plutôt que comme de la récence déjà captée par la baseline ' +
      "bayésienne. Sans ce plancher, le même dimanche d'il y a huit jours compterait " +
      'deux fois.',
    source:
      'packages/core/src/prevision/comparable-calendaire.ts — ' +
      'ConfigComparableCalendaire.ageMinimumJours.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_comparable_calendaire_demi_vie_ans',
    typeValeur: 'entier',
    valeurDefaut: '2',
    description:
      'Décroissance par ancienneté du comparable calendaire, en ANNÉES (et non en ' +
      'semaines comme la baseline générale) : une année ancienne pèse moins qu’une ' +
      'année récente, mais compte encore.',
    source:
      'docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md §2 — ' +
      '« pondérées par leur ancienneté ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_comparable_calendaire_annees_minimum',
    typeValeur: 'entier',
    valeurDefaut: '2',
    description:
      "Nombre d'années civiles distinctes exigées avant que ce prédicteur ne " +
      "s'active. En dessous, un seul point de comparaison ne prouve rien — c'est " +
      'le démarrage à froid de ce prédicteur.',
    source:
      'docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md §2 — ' +
      '« une fois suffisamment d’historique disponible ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_jour_semaine_observations_minimum',
    typeValeur: 'entier',
    valeurDefaut: '6',
    description:
      "Nombre minimal d'observations POUR LE jour de semaine cible avant d'estimer " +
      'son effet propre.',
    source:
      'docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md §2 — ' +
      'prédicteur « jour de la semaine ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_jour_semaine_jours_distincts_minimum',
    typeValeur: 'entier',
    valeurDefaut: '2',
    description:
      'Nombre de jours de semaine DISTINCTS devant être représentés dans tout ' +
      "l'historique pour qu'un « effet du jour » ait un sens. Avec un seul jour " +
      'représenté (La Batte seule, toujours un dimanche), il n’existe aucune ' +
      'variation inter-jours à mesurer : le prédicteur reste silencieux.',
    source:
      'packages/core/src/prevision/jour-semaine.ts — ConfigJourSemaine.joursDistinctsMinimum.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_vacances_scolaires_be_json',
    typeValeur: 'json',
    valeurDefaut: '[]',
    description:
      'Calendrier des vacances scolaires de la Fédération Wallonie-Bruxelles, en ' +
      'JSON : un tableau de périodes `{ "nom": "...", "debut": "AAAA-MM-JJ", ' +
      '"fin": "AAAA-MM-JJ" }`. VALEUR VIDE PAR DÉFAUT ET ASSUMÉE : ce calendrier ' +
      'change chaque année scolaire et doit être renseigné À LA MAIN depuis une ' +
      'source officielle (gouvernement.cwb.be ou enseignement.be) — CLAUDE.md §3 ' +
      "règle 2, « un LLM ne calcule jamais », s'étend ici à « on n'invente pas une " +
      'donnée réglementaire ». Tant que la liste est vide, le prédicteur ' +
      '« vacances scolaires » reste inactif : c’est le comportement correct, pas ' +
      'une panne.',
    source:
      'docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md §2 — à ' +
      'renseigner manuellement, à reconfirmer chaque année scolaire.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_vacances_observations_minimum',
    typeValeur: 'entier',
    valeurDefaut: '5',
    description:
      "Nombre minimal d'observations DANS et HORS vacances pour estimer un effet " +
      'différentiel entre les deux groupes.',
    source:
      'packages/core/src/prevision/vacances-scolaires.ts — ' +
      'ConfigVacancesScolaires.observationsMinimum.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_ecart_meteo_paires_minimum',
    typeValeur: 'entier',
    valeurDefaut: '8',
    description:
      'Nombre minimal de couples (météo prévue, météo réalisée) pour mesurer un ' +
      "écart significatif entre prévision et réalité, et calibrer l'inflation de " +
      "l'intervalle P10/P90 en conséquence.",
    source:
      'docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md §2 — ' +
      'prédicteur « historique météo réalisé vs prévu ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_ecart_meteo_echelle_temperature_c',
    typeValeur: 'decimal',
    valeurDefaut: '3',
    description:
      "Écart-type de température (°C) auquel l'échelle d'inflation de l'incertitude " +
      "est calibrée : à l'horizon de référence et à cet écart-type mesuré, " +
      "l'inflation vaut exactement ×2 avant plafonnement.",
    source:
      'packages/core/src/prevision/ecart-meteo-prevue-realisee.ts — ' +
      'ConfigEcartMeteo.echelleTemperatureC.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_ecart_meteo_horizon_reference_jours',
    typeValeur: 'entier',
    valeurDefaut: '7',
    description:
      'Horizon (en jours) auquel `prevision_ecart_meteo_echelle_temperature_c` ' +
      "s'applique — docs/03 : la météo est relevée à J-7, J-3, J-1 et le matin même.",
    source: 'docs/03-MOTEUR-PREVISION.md §2 — « Récupération à J-7, J-3, J-1 ».',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_ecart_meteo_inflation_max_bp',
    typeValeur: 'entier',
    valeurDefaut: '20000',
    description:
      "Plafond de l'inflation de l'écart-type appliquée à l'intervalle P10/P90 " +
      "(20000 = ×2). Empêche qu'un historique météo très instable ne fasse " +
      'exploser la fourchette affichée au point de la rendre inutile.',
    source:
      'packages/core/src/prevision/ecart-meteo-prevue-realisee.ts — ' +
      'ConfigEcartMeteo.inflationMaxBp.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_session_consecutive_ecart_max_jours',
    typeValeur: 'entier',
    valeurDefaut: '10',
    description:
      'Au-delà de cet écart (en jours) avec la session cible, la session ' +
      "précédente est jugée trop ancienne pour être « consécutive » — elle n'entre " +
      'pas dans le calcul de cet effet.',
    source:
      'packages/core/src/prevision/session-consecutive.ts — ' +
      'ConfigSessionConsecutive.ecartMaxJours.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_session_consecutive_seuil_rupture_bp',
    typeValeur: 'entier',
    valeurDefaut: '200',
    description:
      "Part invendue (bp) EN DESSOUS de laquelle une session est jugée s'être " +
      'soldée par une rupture potentielle (200 = 2 % de pâte jetée ou moins : ' +
      'quasiment tout écoulé).',
    source:
      'packages/core/src/prevision/session-consecutive.ts — ' +
      'ConfigSessionConsecutive.seuilRuptureBp.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_session_consecutive_seuil_invendu_bp',
    typeValeur: 'entier',
    valeurDefaut: '1500',
    description:
      "Part invendue (bp) AU-DESSUS de laquelle une session est jugée s'être " +
      'soldée par un invendu important (1500 = 15 % de pâte jetée ou plus).',
    source:
      'packages/core/src/prevision/session-consecutive.ts — ' +
      'ConfigSessionConsecutive.seuilInvenduImportantBp.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_session_consecutive_occurrences_minimum',
    typeValeur: 'entier',
    valeurDefaut: '3',
    description:
      "Nombre minimal d'occurrences passées d'un état (rupture, ou invendu " +
      'important) pour calibrer sérieusement son ajustement sur la session ' +
      'suivante. En dessous, on ne devine pas une ampleur jamais mesurée.',
    source:
      'packages/core/src/prevision/session-consecutive.ts — ' +
      'ConfigSessionConsecutive.occurrencesMinimum.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'prevision_validation_croisee_points_minimum',
    typeValeur: 'entier',
    valeurDefaut: '8',
    description:
      'Nombre minimal de sessions évaluables en validation croisée leave-one-out ' +
      "en dessous duquel AUCUN des cinq nouveaux prédicteurs n'est jugé, quel que " +
      'soit son MAPE mesuré : un score sur une poignée de points ne prouve rien.',
    source:
      'packages/core/src/prevision/validation-croisee.ts — ' +
      'validerParLeaveOneOut(minPointsEvalues).',
    dateDebutValidite: '2026-01-01',
  },

  // --- Découverte d'événements : facteur portée/intensité et décote distance (fiche 05) ---
  // Migrées depuis des constantes codées en dur de
  // `packages/core/src/evenements-decouverte.ts` (CLAUDE.md §7 : « ne pas coder
  // en dur des taux, seuils ou montants »). Valeurs par défaut IDENTIQUES au
  // comportement précédent — une recopie de docs/03-MOTEUR-PREVISION.md
  // §« Facteur 3 — Événements », jamais une mesure. Même statut que les autres
  // hypothèses de démarrage du moteur de prévision (`prevision_meteo_*`, etc.) :
  // À CALIBRER sur les premières sessions réelles, pas des vérités figées.
  {
    cle: 'evenement_coefficient_portee_quartier_bp',
    typeValeur: 'entier',
    valeurDefaut: '10000',
    description:
      "Coefficient de portée d'un événement de portée « quartier », en points de base " +
      '(10000 = ×1,00), utilisé dans f_événement = 1 + portée × intensité × pente (voir ' +
      '`evenement_pente_intensite_bp`).',
    source:
      'docs/03-MOTEUR-PREVISION.md §« Facteur 3 — Événements » — « portée ∈ { quartier: 1,0 ; ' +
      'liège: 0,6 ; national: 0,3 } ». Valeur reprise telle quelle de la formule documentée, ' +
      'jamais mesurée : à calibrer sur les premières sessions réelles.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'evenement_coefficient_portee_liege_bp',
    typeValeur: 'entier',
    valeurDefaut: '6000',
    description:
      "Coefficient de portée d'un événement de portée « liège », en points de base " +
      '(6000 = ×0,60).',
    source:
      'docs/03-MOTEUR-PREVISION.md §« Facteur 3 — Événements » — « liège: 0,6 ». Valeur reprise ' +
      'telle quelle de la formule documentée, jamais mesurée : à calibrer sur les premières ' +
      'sessions réelles.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'evenement_coefficient_portee_national_bp',
    typeValeur: 'entier',
    valeurDefaut: '3000',
    description:
      "Coefficient de portée d'un événement de portée « national », en points de base " +
      '(3000 = ×0,30).',
    source:
      'docs/03-MOTEUR-PREVISION.md §« Facteur 3 — Événements » — « national: 0,3 ». Valeur ' +
      'reprise telle quelle de la formule documentée, jamais mesurée : à calibrer sur les ' +
      'premières sessions réelles.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'evenement_pente_intensite_bp',
    typeValeur: 'entier',
    valeurDefaut: '500',
    description:
      "Pente de l'intensité dans f_événement = 1 + portée × intensité × pente, en points de " +
      'base (500 = 0,05 par point d’intensité).',
    source:
      'docs/03-MOTEUR-PREVISION.md §« Facteur 3 — Événements » — « f_événement = 1 + (portée × ' +
      'intensité × 0,05) ». Valeur reprise telle quelle de la formule documentée, jamais ' +
      'mesurée : à calibrer sur les premières sessions réelles.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'evenement_distance_sans_decote_km',
    typeValeur: 'entier',
    valeurDefaut: '10',
    description:
      "Distance, en kilomètres à vol d'oiseau, en deçà de laquelle l'impact d'un événement ne " +
      'subit aucune décote de distance.',
    source:
      'packages/core/src/evenements-decouverte.ts — décote explicite ajoutée par la fiche 05 ' +
      '(docs/demandes/05-EVENEMENTS-DECOUVERTE-IA-RAYON-REGLABLE.md) en anticipation de la ' +
      'portée qualitative à trois paliers de docs/03, qui ne distingue pas 5 km de 90 km. ' +
      'Valeur de départ non mesurée : à calibrer sur les premières sessions réelles.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'evenement_distance_decote_max_km',
    typeValeur: 'entier',
    valeurDefaut: '100',
    description:
      "Distance, en kilomètres à vol d'oiseau, au-delà de laquelle la décote atteint son " +
      'plancher (`evenement_distance_plancher_bp`) et n’empire plus. Alignée sur le rayon de ' +
      'recherche maximal réglable (fiche 05, `DOMAINE_RAYON_RECHERCHE_KM`).',
    source:
      'packages/core/src/evenements-decouverte.ts — même décote que ci-dessus. Valeur de ' +
      'départ non mesurée : à calibrer sur les premières sessions réelles.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'evenement_distance_plancher_bp',
    typeValeur: 'entier',
    valeurDefaut: '2000',
    description:
      "Poids résiduel minimal de l'impact d'un événement au-delà de " +
      '`evenement_distance_decote_max_km`, en points de base (2000 = 20 %). Un événement ' +
      'lointain garde un résidu d’effet plutôt que de tomber à zéro : rien ne prouve qu’il est ' +
      'SANS AUCUN effet, seulement qu’il en a moins.',
    source:
      'packages/core/src/evenements-decouverte.ts — même décote que ci-dessus. Valeur de ' +
      'départ non mesurée : à calibrer sur les premières sessions réelles.',
    dateDebutValidite: '2026-01-01',
  },

  // --- Échéancier réglementaire : jours, sources et montants ---------------
  // docs/29-VALEURS-EN-DUR.md §6 point 1 : `CATALOGUE_ECHEANCES` et
  // `PAS_ANNEES` (packages/core/src/comptabilite.ts) portaient ces 19 valeurs
  // EN DUR, sans `dateDebutValidite` ni entrée dans ce catalogue — exactement
  // ce que CLAUDE.md §7 interdit pour un « taux, seuil ou montant
  // réglementaire ». AUCUNE VALEUR N'A CHANGÉ ICI : chaque `valeurDefaut`
  // ci-dessous est une copie EXACTE de ce qui était écrit en dur avant cette
  // migration — seul l'ENDROIT où elle vit a bougé. `comptabilite.ts`
  // construit désormais `CATALOGUE_ECHEANCES` en LISANT ces entrées
  // (`construireCatalogueEcheances`), au lieu de les dupliquer une seconde
  // fois dans un tableau littéral séparé.
  //
  // UN SEUL PARAMÈTRE PAR CYCLE DE JOURS (`*_jours`) : `jourReference` et
  // `joursSupplementaires` sont DEUX FACES DE LA MÊME description de cycle
  // (packages/core/src/comptabilite.ts, commentaire « REPRESENTATION DES
  // RECURRENCES »), jamais deux faits séparés. Une seule valeur les porte
  // tous les deux : une liste de jours `MM-JJ` séparés par des virgules, le
  // PREMIER étant `jourReference`, les suivants `joursSupplementaires`.
  //
  // LIMITE ASSUMÉE, À NE PAS CROIRE RÉSOLUE PAR CE DÉPLACEMENT SEUL : le
  // dépôt `packages/db/src/depots/comptabilite.ts` (`seedEcheances`,
  // `prochaineOccurrenceEcheance`) consomme `CATALOGUE_ECHEANCES` comme une
  // CONSTANTE calculée UNE FOIS depuis les valeurs PAR DÉFAUT de ce
  // catalogue — pas depuis les lignes réellement en base de la table
  // `parametre`. Modifier l'une de ces clés depuis l'écran Paramètres ne
  // change donc RIEN à l'échéancier tant que ce dépôt (hors zone d'écriture
  // de cette migration : `packages/db`) n'aura pas été branché sur
  // `construireCatalogueEcheances(parametresChargees)` à la place de l'import
  // direct de `CATALOGUE_ECHEANCES`. Ces clés sont donc, pour l'instant,
  // DOCUMENTÉES et DATÉES comme les 99 autres, mais pas encore RÉELLEMENT
  // éditables à effet — signalé ici en clair pour que ça ne se découvre pas
  // en silence plus tard (voir `construireCatalogueEcheances`, comptabilite.ts).
  {
    cle: 'echeance_listing_tva_jours',
    typeValeur: 'texte',
    valeurDefaut: '03-31',
    description:
      'Jour de référence (format MM-JJ) du listing clients à la TVA, obligatoire ' +
      'même à zéro. Cycle à un seul jour : aucun jour supplémentaire ici (comparer à ' +
      '`echeance_inasti_trimestrielle_jours`, qui en porte quatre).',
    source:
      "Valeur reprise à l'identique de `CATALOGUE_ECHEANCES` (packages/core/src/" +
      'comptabilite.ts) avant sa migration vers ce catalogue (docs/29-VALEURS-EN-DUR.md ' +
      '§6 point 1). SPF Finances — listing intracommunautaire des clients assujettis ; ' +
      'voir `echeance_listing_tva_source_legale` pour le détail réglementaire.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_listing_tva_source_legale',
    typeValeur: 'texte',
    valeurDefaut:
      'Obligatoire même à zéro depuis 2026, avec communication du chiffre d’affaires total ' +
      "de l'année précédente. Délai exceptionnellement porté au 30 avril pour 2026.",
    description:
      "Explication réglementaire affichée en regard de l'échéance « Listing clients TVA » " +
      "dans l'échéancier.",
    source:
      "Texte repris à l'identique de `CATALOGUE_ECHEANCES.sourceLegale` (packages/core/src/" +
      'comptabilite.ts) — migration docs/29-VALEURS-EN-DUR.md §6 point 1, aucun mot changé.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_listing_tva_url_source',
    typeValeur: 'texte',
    valeurDefaut: '',
    description:
      'URL de la source officielle du listing clients TVA, quand elle est connue. Vide = ' +
      'non renseignée (voir `Parametres.texteOuNull`), jamais une URL inventée.',
    source:
      "Aucune URL n'était renseignée dans `CATALOGUE_ECHEANCES` (`urlSource: null`) avant " +
      'cette migration (docs/29 §6 point 1) : valeur inchangée, seulement déplacée.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_inasti_trimestrielle_jours',
    typeValeur: 'texte',
    valeurDefaut: '04-10,07-10,10-12,12-21',
    description:
      'Les QUATRE jours (format MM-JJ, séparés par des virgules) de la cotisation ' +
      'INASTI trimestrielle. Une liste et non un pas de trois mois : les quatre dates ' +
      'sont IRRÉGULIÈRES (voir packages/core/src/comptabilite.ts, commentaire ' +
      '« POURQUOI UNE LISTE DE JOURS »). Le premier élément joue le rôle de ' +
      '`jourReference`, les trois suivants celui de `joursSupplementaires`.',
    source:
      "Valeur reprise à l'identique de `CATALOGUE_ECHEANCES` avant sa migration vers ce " +
      'catalogue (docs/29-VALEURS-EN-DUR.md §6 point 1). Caisse d’assurances sociales — ' +
      '10 avril, 10 juillet, 12 octobre, 21 décembre POUR 2026 ; voir ' +
      '`echeance_inasti_trimestrielle_source_legale`.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_inasti_trimestrielle_source_legale',
    typeValeur: 'texte',
    valeurDefaut:
      'Quatre échéances par an, à dates irrégulières fixées par la caisse d’assurances ' +
      'sociales : 10 avril, 10 juillet, 12 octobre et 21 décembre pour 2026. Ces jours ' +
      'sont reconduits tels quels les années suivantes faute de mieux — à reconfirmer ' +
      'chaque année auprès de la caisse, un retard entraînant des majorations.',
    description:
      "Explication réglementaire affichée en regard de l'échéance « Cotisation INASTI » " +
      "dans l'échéancier.",
    source:
      "Texte repris à l'identique de `CATALOGUE_ECHEANCES.sourceLegale` — migration " +
      'docs/29-VALEURS-EN-DUR.md §6 point 1, aucun mot changé.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_inasti_trimestrielle_url_source',
    typeValeur: 'texte',
    valeurDefaut: '',
    description:
      'URL de la source officielle des dates INASTI, quand elle est connue. Vide = non ' +
      'renseignée, jamais une URL inventée.',
    source:
      "Aucune URL n'était renseignée dans `CATALOGUE_ECHEANCES` avant cette migration " +
      '(docs/29 §6 point 1) : valeur inchangée, seulement déplacée.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_contribution_afsca_jours',
    typeValeur: 'texte',
    valeurDefaut: '03-02',
    description:
      "Jour de référence (format MM-JJ) de l'ouverture de la campagne de contribution " +
      'annuelle AFSCA. Cycle à un seul jour.',
    source:
      "Valeur reprise à l'identique de `CATALOGUE_ECHEANCES` avant sa migration vers ce " +
      'catalogue (docs/29-VALEURS-EN-DUR.md §6 point 1). AFSCA — campagne ouverte le ' +
      '2 mars 2026 ; voir `echeance_contribution_afsca_source_legale`.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_contribution_afsca_source_legale',
    typeValeur: 'texte',
    valeurDefaut:
      'Campagne ouverte le 2 mars 2026. Tarif starter 102,71 € avec autorisation, ' +
      '51,36 € sinon. À reconfirmer chaque année.',
    description:
      "Explication réglementaire affichée en regard de l'échéance « Contribution annuelle " +
      "AFSCA » dans l'échéancier.",
    source:
      "Texte repris à l'identique de `CATALOGUE_ECHEANCES.sourceLegale` — migration " +
      'docs/29-VALEURS-EN-DUR.md §6 point 1, aucun mot changé.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_contribution_afsca_url_source',
    typeValeur: 'texte',
    valeurDefaut: '',
    description:
      'URL de la source officielle de la contribution AFSCA, quand elle est connue. ' +
      'Vide = non renseignée, jamais une URL inventée.',
    source:
      "Aucune URL n'était renseignée dans `CATALOGUE_ECHEANCES` avant cette migration " +
      '(docs/29 §6 point 1) : valeur inchangée, seulement déplacée.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_contribution_afsca_avec_autorisation_cents',
    typeValeur: 'entier',
    valeurDefaut: '10271',
    description:
      "Contribution annuelle AFSCA pour un établissement titulaire d'une AUTORISATION " +
      "(et non d'un simple enregistrement), en centimes d'euro entiers (10271 = 102,71 €).",
    source:
      'Montant cité en PROSE SEULE dans `CATALOGUE_ECHEANCES.sourceLegale` (« Contribution ' +
      'annuelle AFSCA », packages/core/src/comptabilite.ts) avant cette migration ' +
      '(docs/29-VALEURS-EN-DUR.md §6 point 1, « les montants qui n’existent qu’en ' +
      'PROSE ») : valeur inchangée (102,71 €), devenue un champ numérique réel. À ' +
      'reconfirmer chaque année auprès de l’AFSCA (voir ' +
      '`echeance_contribution_afsca_source_legale`).',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_contribution_afsca_sans_autorisation_cents',
    typeValeur: 'entier',
    valeurDefaut: '5136',
    description:
      'Contribution annuelle AFSCA pour un établissement sous simple ENREGISTREMENT ' +
      "(sans autorisation), en centimes d'euro entiers (5136 = 51,36 €).",
    source:
      'Même origine que `echeance_contribution_afsca_avec_autorisation_cents` ci-dessus : ' +
      "montant repris à l'identique de la prose de `CATALOGUE_ECHEANCES` (51,36 €), " +
      'devenu un champ numérique réel lors de cette migration (docs/29 §6 point 1).',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_renouvellement_ambulant_jours',
    typeValeur: 'texte',
    valeurDefaut: '01-01',
    description:
      'Jour de référence (format MM-JJ) DU CATALOGUE pour le renouvellement de ' +
      "l'autorisation d'activités ambulantes — un simple repère par défaut : la vraie " +
      'échéance se calcule depuis la date RÉELLE de délivrance, saisie par ' +
      'l’utilisateur (voir `prochaineOccurrenceEcheance`, packages/core/src/' +
      'comptabilite.ts). Cycle à un seul jour.',
    source:
      "Valeur reprise à l'identique de `CATALOGUE_ECHEANCES` avant sa migration vers ce " +
      'catalogue (docs/29-VALEURS-EN-DUR.md §6 point 1).',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_renouvellement_ambulant_source_legale',
    typeValeur: 'texte',
    valeurDefaut:
      'Tous les 5 ans en Wallonie, à compter de la première délivrance. Le 1er janvier ' +
      "n'est qu'un repère par défaut : renseignez la date réelle de délivrance dans " +
      "l'échéancier, sinon la date affichée ne veut rien dire.",
    description:
      "Explication réglementaire affichée en regard de l'échéance « Renouvellement de " +
      "l'autorisation d'activités ambulantes » dans l'échéancier.",
    source:
      "Texte repris à l'identique de `CATALOGUE_ECHEANCES.sourceLegale` — migration " +
      'docs/29-VALEURS-EN-DUR.md §6 point 1, aucun mot changé.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_renouvellement_ambulant_url_source',
    typeValeur: 'texte',
    valeurDefaut: '',
    description:
      "URL de la source officielle du régime d'activités ambulantes, quand elle est " +
      'connue. Vide = non renseignée, jamais une URL inventée.',
    source:
      "Aucune URL n'était renseignée dans `CATALOGUE_ECHEANCES` avant cette migration " +
      '(docs/29 §6 point 1) : valeur inchangée, seulement déplacée.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_pas_quinquennal_annees',
    typeValeur: 'entier',
    valeurDefaut: '5',
    description:
      "Nombre d'années entre deux renouvellements de l'autorisation d'activités " +
      "ambulantes en Wallonie (récurrence 'quinquennale' de l'échéancier). Remplace " +
      '`PAS_ANNEES.quinquennale`, codé en dur dans packages/core/src/comptabilite.ts.',
    source:
      "Valeur reprise à l'identique de `PAS_ANNEES.quinquennale = 5` (packages/core/src/" +
      'comptabilite.ts) avant sa migration vers ce catalogue (docs/29-VALEURS-EN-DUR.md ' +
      '§6 point 1). Si la Wallonie change ce cycle, la correction se fait ICI, plus dans ' +
      'du code TypeScript à redéployer.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_e604b_jours',
    typeValeur: 'texte',
    valeurDefaut: '12-15',
    description:
      'Jour de référence (format MM-JJ) du dépôt du formulaire e604B en cas de ' +
      'dépassement du seuil de franchise TVA. Cycle à un seul jour.',
    source:
      "Valeur reprise à l'identique de `CATALOGUE_ECHEANCES` avant sa migration vers ce " +
      'catalogue (docs/29-VALEURS-EN-DUR.md §6 point 1).',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_e604b_source_legale',
    typeValeur: 'texte',
    valeurDefaut:
      'À déposer avant le 15 décembre en cas de dépassement du seuil de 25 000 € sans ' +
      'excéder 27 500 €. La tolérance de 10 % a DISPARU au 1er janvier 2025. ' +
      'À confirmer auprès du guichet d’entreprises.',
    description:
      "Explication réglementaire affichée en regard de l'échéance « Formulaire e604B » " +
      "dans l'échéancier.",
    source:
      "Texte repris à l'identique de `CATALOGUE_ECHEANCES.sourceLegale` — migration " +
      'docs/29-VALEURS-EN-DUR.md §6 point 1, aucun mot changé.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_e604b_url_source',
    typeValeur: 'texte',
    valeurDefaut: '',
    description:
      'URL de la source officielle du formulaire e604B, quand elle est connue. Vide = ' +
      'non renseignée, jamais une URL inventée.',
    source:
      "Aucune URL n'était renseignée dans `CATALOGUE_ECHEANCES` avant cette migration " +
      '(docs/29 §6 point 1) : valeur inchangée, seulement déplacée.',
    dateDebutValidite: '2026-01-01',
  },
  {
    cle: 'echeance_e604b_tolerance_cents',
    typeValeur: 'entier',
    valeurDefaut: '2750000',
    description:
      'Plafond de tolérance du formulaire e604B au-delà duquel la franchise de TVA est ' +
      "perdue, en centimes d'euro entiers (2 750 000 = 27 500 €). Distinct de " +
      '`seuil_franchise_tva_cents` (25 000 €) : ce plafond-ci est la LIMITE ABSOLUE de ' +
      'tolérance, pas le seuil qui déclenche la démarche.',
    source:
      'Montant cité en PROSE SEULE dans `CATALOGUE_ECHEANCES.sourceLegale` (« Formulaire ' +
      'e604B », packages/core/src/comptabilite.ts) avant cette migration (docs/29-' +
      'VALEURS-EN-DUR.md §6 point 1) : valeur inchangée (27 500 €), devenue un champ ' +
      'numérique réel. La tolérance de 10 % a disparu au 1er janvier 2025 (voir ' +
      '`echeance_e604b_source_legale`) — à confirmer auprès du guichet d’entreprises.',
    dateDebutValidite: '2026-01-01',
  },

  // --- Identité de l'exploitant (registre AFSCA et documents officiels) ----
  // CONSTAT (audit docs/31-DOCUMENTS-OUVERTS.md §5) : AUCUNE notion
  // d'exploitant n'existait nulle part dans le dépôt — ni nom, ni adresse, ni
  // numéro d'entreprise, sur AUCUN des 12 documents produits, y compris le
  // registre d'autocontrôle AFSCA. Un registre présenté à un contrôle SANS
  // identifier l'établissement contrôlé est une lacune réglementaire, pas un
  // défaut de mise en forme.
  //
  // « L'EXPLOITANT N'EST PAS UN CLIENT » — CLAUDE.md §3 règle 9 impose « zéro
  // donnée personnelle CLIENT » (pas de nom, pas d'e-mail, pas de fidélité
  // nominative tant qu'aucune base légale RGPD n'a été écrite) : cette règle
  // protège les PERSONNES qui achètent une crêpe. Elle ne concerne PAS
  // l'entreprise elle-même : un exploitant qui s'identifie sur SON PROPRE
  // registre d'autocontrôle n'est pas une collecte de données clients, c'est
  // une obligation faite à l'entreprise vis-à-vis d'elle-même. Aucune
  // contradiction avec la règle 9, mais le rapprochement est assez tentant
  // pour mériter cette précision explicite.
  //
  // VALEUR VIDE ('') PAR DÉFAUT, ET ASSUMÉE : aucun de ces quatre champs ne
  // peut être deviné depuis ce dépôt (nom, adresse, numéro d'entreprise et
  // numéro d'enregistrement AFSCA du porteur ne sont connus de personne
  // d'autre que lui). Une valeur inventée serait pire qu'un champ vide : elle
  // imprimerait un registre faussement identifié, sans qu'aucun signal
  // n'alerte quiconque. `Parametres.texteOuNull` traduit cette chaîne vide de
  // stockage (contrainte : `parametre.valeur` est NOT NULL, packages/db/src/
  // schema.ts) en `null` pour le code appelant — jamais `0`, jamais `''`. Le
  // document qui les affiche doit tester `null` et imprimer une mention
  // explicite (« non renseigné — à compléter dans Paramètres ») plutôt qu'un
  // champ blanc silencieux.
  {
    cle: 'exploitant_nom',
    typeValeur: 'texte',
    valeurDefaut: '',
    description:
      'Nom (personne physique en indépendant complémentaire) ou raison sociale de ' +
      "l'exploitant, tel qu'il doit identifier l'établissement sur le registre AFSCA et " +
      'les autres documents officiels.',
    source:
      "À saisir par le porteur lui-même dans l'écran Paramètres — aucun nom n'est connu " +
      "depuis ce dépôt, et personne d'autre que lui ne peut légitimement le fournir " +
      '(constat : docs/31-DOCUMENTS-OUVERTS.md §5).',
    dateDebutValidite: '2026-08-01',
  },
  {
    cle: 'exploitant_adresse',
    typeValeur: 'texte',
    valeurDefaut: '',
    description:
      "Adresse de l'exploitant (siège de l'activité ou domicile pour un indépendant " +
      'complémentaire ambulant), affichée sur le registre AFSCA et les documents ' +
      'officiels. Distincte de `adresse_depart_defaut` (point de départ kilométrique) : ' +
      'même valeur probable, usage différent — saisie séparément pour ne pas lier deux ' +
      'notions qui pourraient un jour diverger (un déménagement du domicile sans ' +
      "changement du siège d'activité, par exemple).",
    source:
      "À saisir par le porteur lui-même dans l'écran Paramètres — aucune adresse n'est " +
      'connue depuis ce dépôt (constat : docs/31-DOCUMENTS-OUVERTS.md §5).',
    dateDebutValidite: '2026-08-01',
  },
  {
    cle: 'exploitant_numero_entreprise',
    typeValeur: 'texte',
    valeurDefaut: '',
    description:
      "Numéro d'entreprise (BCE, format « BE0XXX.XXX.XXX »), affiché sur le registre " +
      'AFSCA et les documents officiels destinés au comptable ou à un contrôle.',
    source:
      "À saisir par le porteur lui-même dans l'écran Paramètres — aucun numéro n'est " +
      'connu depuis ce dépôt (constat : docs/31-DOCUMENTS-OUVERTS.md §5).',
    dateDebutValidite: '2026-08-01',
  },
  {
    cle: 'exploitant_numero_enregistrement_afsca',
    typeValeur: 'texte',
    valeurDefaut: '',
    description:
      "Numéro d'enregistrement ou d'autorisation AFSCA de l'établissement (distinct du " +
      "numéro d'entreprise BCE ci-dessus) — c'est ce numéro, pas le numéro BCE, qu'un " +
      'contrôle AFSCA rapproche en premier du registre présenté. docs/01-SPEC-' +
      'FONCTIONNELLE.md module 6 : la préparation sur place relève du régime ' +
      "d'autorisation AFSCA, pas du simple enregistrement.",
    source:
      "À saisir par le porteur lui-même dans l'écran Paramètres, une fois le dossier " +
      "déposé auprès de l'UPC Liège — aucun numéro n'est connu depuis ce dépôt (constat : " +
      'docs/31-DOCUMENTS-OUVERTS.md §5).',
    dateDebutValidite: '2026-08-01',
  },
] as const;

/** Cles connues du catalogue, derivees automatiquement — aucune liste a maintenir en double. */
export type CleParametre = (typeof CATALOGUE_PARAMETRES)[number]['cle'];

export function definitionParametre(cle: string): DefinitionParametre | undefined {
  return CATALOGUE_PARAMETRES.find((d) => d.cle === cle);
}

/**
 * Acces typé a un jeu de parametres deja charge depuis la base.
 *
 * Volontairement construit sur une simple Map : la resolution des dates de
 * validite est faite par la requete SQL, pas ici. Cette classe reste une
 * fonction pure au sens de CLAUDE.md §3 — aucun acces base, aucun effet de bord.
 */
export class Parametres {
  private readonly valeurs: ReadonlyMap<string, string>;

  constructor(valeurs: Iterable<readonly [string, string]>) {
    this.valeurs = new Map(valeurs);
  }

  /** Construit depuis les lignes de la table, en ne gardant que la valeur en vigueur. */
  static depuisLignes(lignes: readonly { cle: string; valeur: string }[]): Parametres {
    return new Parametres(lignes.map((l) => [l.cle, l.valeur] as const));
  }

  private brut(cle: CleParametre): string {
    const valeur = this.valeurs.get(cle);
    if (valeur === undefined) throw new ErreurParametreManquant(cle);
    return valeur;
  }

  entier(cle: CleParametre): number {
    const brut = this.brut(cle);
    const valeur = Number.parseInt(brut, 10);
    if (!Number.isInteger(valeur)) {
      throw new ErreurParametreManquant(`${cle} (valeur « ${brut} » non entiere)`);
    }
    return valeur;
  }

  centimes(cle: CleParametre): Centimes {
    return this.entier(cle);
  }

  pointsDeBase(cle: CleParametre): PointsDeBase {
    return this.entier(cle);
  }

  decimal(cle: CleParametre): number {
    const brut = this.brut(cle);
    const valeur = Number(brut);
    if (!Number.isFinite(valeur)) {
      throw new ErreurParametreManquant(`${cle} (valeur « ${brut} » non numerique)`);
    }
    return valeur;
  }

  texte(cle: CleParametre): string {
    return this.brut(cle);
  }

  /**
   * Lecture d'une valeur texte OPTIONNELLE : rend `null` si le paramètre n'a
   * jamais été renseigné, JAMAIS une chaîne vide.
   *
   * La colonne `parametre.valeur` est `NOT NULL` (packages/db/src/schema.ts) :
   * elle ne peut donc jamais porter un vrai NULL SQL. La convention de ce
   * catalogue est qu'une chaîne vide en base signifie « non renseigné »
   * (déjà le cas d'`adresse_depart_defaut`) — mais un numéro d'entreprise non
   * renseigné n'est pas « » : il n'existe pas, et le code appelant doit
   * pouvoir distinguer les deux pour le DIRE explicitement (« non renseigné —
   * à compléter ») plutôt que d'imprimer un champ blanc en silence. Cette
   * méthode traduit la contrainte de STOCKAGE (chaîne vide, imposée par le
   * schéma) vers le contrat que voit le CODE APPELANT (`null`).
   */
  texteOuNull(cle: CleParametre): string | null {
    const brut = this.texte(cle);
    return brut === '' ? null : brut;
  }

  booleen(cle: CleParametre): boolean {
    return this.brut(cle) === 'true';
  }

  /** Presence sans lever : utile pour un ecran de diagnostic de configuration. */
  possede(cle: string): boolean {
    return this.valeurs.has(cle);
  }

  /** Cles du catalogue absentes du jeu charge — alimente l'ecran Parametres. */
  clesManquantes(): string[] {
    return CATALOGUE_PARAMETRES.filter((d) => !this.valeurs.has(d.cle)).map((d) => d.cle);
  }
}
