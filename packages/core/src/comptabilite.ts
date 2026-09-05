/**
 * Comptabilite : amortissements, deductibilite, echeancier.
 *
 * Fonctions pures. L'application ne remplace pas un comptable — elle produit
 * des chiffres verifiables et documente d'ou ils viennent (CLAUDE.md §7).
 */

import { BASE_POINTS, appliquerPointsDeBase, type Centimes, type PointsDeBase } from './argent.js';
import { ErreurMetier } from './erreurs.js';
import { CATALOGUE_PARAMETRES, Parametres } from './parametres.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Amortissements
   ═══════════════════════════════════════════════════════════════════════════ */

export type MethodeAmortissement = 'lineaire' | 'degressive';

export type Immobilisation = {
  readonly libelle: string;
  readonly dateAcquisition: string;
  readonly montantCents: Centimes;
  /** Nombre d'exercices comptables. Entier : un demi-exercice n'existe pas. */
  readonly dureeAnnees: number;
  readonly methode: MethodeAmortissement;
  readonly valeurResiduelleCents: Centimes;
};

export type Annuite = {
  readonly exercice: number;
  readonly montantCents: Centimes;
  readonly valeurNetteFinCents: Centimes;
};

/**
 * Plan d'amortissement complet.
 *
 * Le montant amortissable est le prix d'acquisition MOINS la valeur residuelle :
 * on n'amortit pas ce qu'on compte recuperer a la revente.
 *
 * L'arrondi est absorbe par la DERNIERE annuite, de sorte que la somme des
 * annuites egale exactement le montant amortissable. Repartir l'arrondi ferait
 * que le cumul ne tombe jamais juste, et un plan d'amortissement dont le total
 * ne correspond pas au bien est inexploitable par un comptable.
 *
 * VALIDATION. Les entrees sont controlees ICI et pas seulement dans le schema
 * Zod de la route HTTP : `packages/core` est la couche de calcul du projet,
 * appelee aussi par les seeds, les imports et les tests. Une bibliotheque qui
 * ne se defend que derriere son appelant ne se defend pas.
 */
export function planAmortissement(immobilisation: Immobilisation): Annuite[] {
  const { dureeAnnees, montantCents, valeurResiduelleCents, methode } = immobilisation;

  // Une duree fractionnaire ne produit AUCUNE derniere annuite (`index ===
  // duree - 1` n'est jamais vrai) : personne n'absorbe l'arrondi et le plan
  // sur-amortit. 1 000 € sur 2,5 ans donnait 3 x 400 € = 1 200 €, soit 200 €
  // de charge deduite pour un bien qui n'existe pas a hauteur de 20 %.
  if (!Number.isInteger(dureeAnnees)) {
    throw new ErreurMetier(
      'duree_amortissement_invalide',
      "La durée d'amortissement se compte en années entières : le plan produit " +
        "une annuité par exercice comptable, et un demi-exercice n'existe pas.",
      { champs: { dureeAnnees: "Indiquez un nombre entier d'années (3, 5, 10…)." } },
    );
  }
  if (dureeAnnees <= 0) {
    throw new ErreurMetier(
      'duree_amortissement_invalide',
      "La durée d'amortissement doit être d'au moins un an.",
      { champs: { dureeAnnees: "Indiquez un nombre d'années supérieur à zéro." } },
    );
  }

  // CLAUDE.md §3 : l'argent est un entier de centimes, y compris ici. Un
  // montant a virgule ferait de chaque annuite un flottant.
  if (!Number.isInteger(montantCents) || !Number.isInteger(valeurResiduelleCents)) {
    throw new ErreurMetier(
      'montant_invalide',
      "Les montants d'une immobilisation s'expriment en centimes entiers.",
      { champs: { montantCents: 'Saisissez un montant en centimes, sans décimale.' } },
    );
  }
  if (montantCents <= 0) {
    throw new ErreurMetier(
      'montant_invalide',
      "Le montant d'une immobilisation doit être strictement positif.",
    );
  }
  if (valeurResiduelleCents < 0) {
    throw new ErreurMetier(
      'valeur_residuelle_invalide',
      'La valeur résiduelle ne peut pas être négative : elle représente ce que le ' +
        'bien vaudra encore en fin de plan.',
    );
  }
  if (valeurResiduelleCents >= montantCents) {
    throw new ErreurMetier(
      'valeur_residuelle_invalide',
      "La valeur résiduelle ne peut pas atteindre le prix d'acquisition : " +
        "il n'y aurait rien à amortir.",
    );
  }

  const exerciceDebut = Number.parseInt(immobilisation.dateAcquisition.slice(0, 4), 10);
  if (!Number.isFinite(exerciceDebut)) {
    throw new ErreurMetier(
      'date_acquisition_invalide',
      "La date d'acquisition est illisible : le premier exercice du plan en dépend.",
      { champs: { dateAcquisition: 'Format attendu : AAAA-MM-JJ.' } },
    );
  }

  const amortissable = montantCents - valeurResiduelleCents;
  const annuites: Annuite[] = [];
  let cumul = 0;

  for (let index = 0; index < dureeAnnees; index += 1) {
    const restant = amortissable - cumul;
    const dernier = index === dureeAnnees - 1;

    let montant: number;
    if (dernier) {
      // La derniere annuite absorbe l'arrondi : la somme tombe juste.
      montant = restant;
    } else if (methode === 'lineaire') {
      montant = Math.round(amortissable / dureeAnnees);
    } else {
      // Degressif : taux double du lineaire, applique a la valeur nette.
      const tauxBp = Math.round((2 / dureeAnnees) * BASE_POINTS);
      montant = appliquerPointsDeBase(restant, tauxBp);
    }

    // Jamais plus qu'il ne reste a amortir. Sur un montant derisoire, les n−1
    // annuites de round(A/n) peuvent depasser A et rendre la derniere negative
    // (cas minimal : 2 centimes sur 4 ans → 1, 1, 1, −1). Une annuite negative
    // serait une REPRISE d'amortissement, que ce plan ne represente pas.
    montant = Math.min(montant, restant);

    cumul += montant;
    annuites.push({
      exercice: exerciceDebut + index,
      montantCents: montant,
      valeurNetteFinCents: montantCents - cumul,
    });
  }

  return annuites;
}

/** Valeur nette comptable a la fin d'un exercice donne. */
export function valeurNetteComptable(immobilisation: Immobilisation, exercice: number): Centimes {
  const plan = planAmortissement(immobilisation);
  const derniereAnnuiteApplicable = plan.filter((a) => a.exercice <= exercice).at(-1);
  return derniereAnnuiteApplicable?.valeurNetteFinCents ?? immobilisation.montantCents;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Depenses
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Part deductible d'une depense mixte.
 *
 * Le carburant d'un vehicule aussi utilise a titre prive n'est deductible qu'a
 * hauteur de son usage professionnel. La part vient de la depense elle-meme,
 * jamais d'un taux global : elle differe d'une depense a l'autre.
 */
export function montantDeductible(montantCents: Centimes, deductibleBp: PointsDeBase): Centimes {
  return appliquerPointsDeBase(montantCents, deductibleBp);
}

/**
 * Part deductible EN CHARGE DE L'EXERCICE, immobilisation comprise.
 *
 * UNE DEPENSE IMMOBILISEE NE SE DEDUIT PAS COMME CHARGE. Son cout part dans le
 * plan d'amortissement, annuite par annuite : c'est toute la raison d'etre du
 * lien `depense.immobilisation_id`. La compter des deux cotes deduit deux fois
 * le meme bien.
 *
 * Le materiel du projet le montre au chiffre pres : 3 500 € saisis en depense
 * (categorie « materiel », 100 % deductible) ET immobilises sur 5 ans donnaient
 * 3 500 + 5 x 700 = 7 000 € de charge pour un bien de 3 500 €. Resultat minore
 * de 3 500 €, soit — aux taux du catalogue, 20,50 % de cotisations puis 40 %
 * d'IPP sur le reliquat — environ 1 830 € de cotisations et d'impot sous-
 * estimes. CLAUDE.md §7 interdit de produire un chiffre qui minore ce qui est
 * du : la deduction passe par le plan, jamais par les deux chemins a la fois.
 *
 * `montantDeductible` reste exporte tel quel : elle repond a « quelle part de
 * ce montant est professionnelle ? », question distincte de « cette depense
 * est-elle une charge de l'exercice ? ».
 */
export function montantDeductibleCharge(ligne: {
  readonly montantCents: Centimes;
  readonly deductibleBp: PointsDeBase;
  /** Vrai si la depense est rattachee a une immobilisation. */
  readonly immobilisee?: boolean;
}): Centimes {
  if (ligne.immobilisee === true) return 0;
  return montantDeductible(ligne.montantCents, ligne.deductibleBp);
}

export type LigneJournal = {
  readonly date: string;
  readonly libelle: string;
  readonly categorie: string;
  readonly montantCents: Centimes;
  readonly deductibleBp: PointsDeBase;
  /** Rattachee a une immobilisation : deduite par le plan, pas en charge. */
  readonly immobilisee?: boolean;
};

export type TotauxJournal = {
  readonly montantTotalCents: Centimes;
  readonly montantDeductibleCents: Centimes;
  /**
   * Part du total partie en immobilisation. Rendue a part pour que l'ecran
   * puisse EXPLIQUER l'ecart entre le decaisse et le deductible, au lieu de
   * laisser croire a une erreur de saisie.
   */
  readonly montantImmobiliseCents: Centimes;
  readonly parCategorie: ReadonlyMap<string, Centimes>;
};

/** Totalise un journal de depenses, avec la ventilation par categorie. */
export function totaliserJournal(lignes: readonly LigneJournal[]): TotauxJournal {
  const parCategorie = new Map<string, Centimes>();
  let montantTotalCents = 0;
  let montantDeductibleCents = 0;
  let montantImmobiliseCents = 0;

  for (const ligne of lignes) {
    // Le montant TOTAL et la ventilation par categorie comptent la depense
    // immobilisee : l'argent est bien sorti, et un journal qui n'en garde pas
    // trace ne se rapproche plus du compte en banque.
    montantTotalCents += ligne.montantCents;
    montantDeductibleCents += montantDeductibleCharge(ligne);
    if (ligne.immobilisee === true) montantImmobiliseCents += ligne.montantCents;
    parCategorie.set(
      ligne.categorie,
      (parCategorie.get(ligne.categorie) ?? 0) + ligne.montantCents,
    );
  }

  return { montantTotalCents, montantDeductibleCents, montantImmobiliseCents, parCategorie };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Resultat et estimation du net
   ═══════════════════════════════════════════════════════════════════════════ */

export type ResultatExercice = {
  readonly recettesCents: Centimes;
  readonly depensesDeductiblesCents: Centimes;
  readonly amortissementsCents: Centimes;
  readonly beneficeBrutCents: Centimes;
  readonly cotisationsSocialesCents: Centimes;
  readonly impotEstimeCents: Centimes;
  readonly netEstimeCents: Centimes;
};

/**
 * Estimation du resultat et du net.
 *
 * INDICATIVE, et l'ecran doit le dire : « l'application ne remplace pas un
 * comptable » (CLAUDE.md §7). Les taux viennent de la table `parametre`, avec
 * leur source — pas de constante ici.
 *
 * `depensesDeductiblesCents` est un TOTAL DEJA ASSEMBLE par l'appelant
 * (`syntheseExercice`, `@batte/db`) : cette fonction ne sait pas, et n'a pas
 * besoin de savoir, qu'il recouvre plusieurs populations (depenses saisies,
 * achats de marchandises, frais de session — docs/14 §G2). Elle reste une
 * simple soustraction ; la definition d'une charge deductible, elle, vit cote
 * depot, pres des tables qu'elle lit.
 */
export function estimerResultat(entree: {
  recettesCents: Centimes;
  depensesDeductiblesCents: Centimes;
  amortissementsCents: Centimes;
  tauxCotisationBp: PointsDeBase;
  tauxImpotBp: PointsDeBase;
}): ResultatExercice {
  const beneficeBrutCents =
    entree.recettesCents - entree.depensesDeductiblesCents - entree.amortissementsCents;

  // Pas de cotisation ni d'impot sur un resultat negatif : une perte ne cree
  // pas de dette fiscale, et afficher un montant negatif induirait en erreur.
  const assiette = Math.max(0, beneficeBrutCents);
  const cotisationsSocialesCents = appliquerPointsDeBase(assiette, entree.tauxCotisationBp);
  const impotEstimeCents = appliquerPointsDeBase(
    Math.max(0, assiette - cotisationsSocialesCents),
    entree.tauxImpotBp,
  );

  return {
    recettesCents: entree.recettesCents,
    depensesDeductiblesCents: entree.depensesDeductiblesCents,
    amortissementsCents: entree.amortissementsCents,
    beneficeBrutCents,
    cotisationsSocialesCents,
    impotEstimeCents,
    netEstimeCents: beneficeBrutCents - cotisationsSocialesCents - impotEstimeCents,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Echeancier reglementaire
   ═══════════════════════════════════════════════════════════════════════════ */

export type RecurrenceEcheance = 'annuelle' | 'trimestrielle' | 'quinquennale' | 'ponctuelle';

/**
 * Parametres RESOLUS A LEURS VALEURS PAR DEFAUT DU CATALOGUE — jamais une
 * ligne reellement en base.
 *
 * Sert a CONSTRUIRE `CATALOGUE_ECHEANCES` ci-dessous (voir
 * `construireCatalogueEcheances`) sans dupliquer une seconde fois les jours,
 * sources, URL et montants de l'echeancier dans ce fichier :
 * `packages/core/src/parametres.ts` est desormais l'UNIQUE endroit ou ces
 * valeurs sont ecrites en dur (docs/29-VALEURS-EN-DUR.md §6 point 1). Avant
 * cette migration, les memes valeurs vivaient ICI, en litteraux, sans
 * `dateDebutValidite` ni `source` structures — exactement ce que CLAUDE.md §7
 * interdit pour un « taux, seuil ou montant reglementaire ».
 *
 * LIMITE ASSUMEE, ICI SEULEMENT : ceci lit les valeurs PAR DEFAUT du
 * catalogue, jamais une ligne reellement chargee depuis la base — ce paquet
 * n'a et ne doit jamais avoir d'acces base (CLAUDE.md §3 regle 1). Sert
 * UNIQUEMENT a `CATALOGUE_ECHEANCES` ci-dessous, un instantane fige aux
 * valeurs par defaut (utile aux tests et a l'affichage documentaire).
 *
 * COMMENTAIRE MIS A JOUR (mission du 01/08/2026) : la limite decrite plus
 * haut a ete comblee cote appelant — `packages/db/src/depots/comptabilite.ts`
 * (`seedEcheances`, `marquerEcheanceFaite`) appelle desormais
 * `construireCatalogueEcheances` avec un `Parametres` charge DEPUIS LA BASE
 * (`lireParametres`), jamais avec `CATALOGUE_ECHEANCES`/`PARAMETRES_PAR_DEFAUT` :
 * les cles `echeance_*` sont donc reellement editables depuis l'ecran
 * Parametres, `echeance_pas_quinquennal_annees` desormais comprise (voir
 * `DefinitionEcheance.pasAnnees`). Un commentaire perime affirmant le
 * contraire serait pire qu'absent (D-040) — cette limite ne s'applique donc
 * plus qu'a `CATALOGUE_ECHEANCES`, jamais au chemin reellement utilise par
 * l'application.
 */
const PARAMETRES_PAR_DEFAUT = new Parametres(
  CATALOGUE_PARAMETRES.map((definition) => [definition.cle, definition.valeurDefaut] as const),
);

/**
 * REPRESENTATION DES RECURRENCES — choix a lire avant de toucher au catalogue.
 *
 * Une echeance recurrente est decrite par deux choses :
 *   1. les JOURS de l'annee civile ou elle tombe (`jourReference` + `joursSupplementaires`) ;
 *   2. le PAS en annees entre deux cycles (`DefinitionEcheance.pasAnnees`, ci-dessous).
 *
 *   annuelle       1 jour,   pas de 1 an
 *   trimestrielle  4 jours,  pas de 1 an
 *   quinquennale   1 jour,   pas PARAMETRABLE (5 ans par defaut), compte depuis une date d'ancrage
 *   ponctuelle     1 date complete, aucun pas
 *
 * POURQUOI UNE LISTE DE JOURS et pas un pas de trois mois pour la trimestrielle :
 * les quatre echeances INASTI ne sont pas espacees regulierement (10 avril,
 * 10 juillet, 12 octobre, 21 decembre 2026). « +3 mois » depuis le 10 avril
 * donnerait 10 juillet, 10 octobre puis 10 janvier — deux dates fausses, dont
 * une qui sort de l'annee. Ces dates sont PUBLIEES par la caisse d'assurances
 * sociales, elles ne se calculent pas : elles restent donc des donnees du
 * catalogue, avec leur source, comme les seuils legaux (CLAUDE.md §7).
 *
 * POURQUOI `jourReference` + `joursSupplementaires` plutot qu'un seul tableau :
 * le type garantit alors qu'il y a TOUJOURS au moins un jour — une echeance
 * sans date ne serait pas representable — et `jourReference` reste le champ
 * deja lu par la couche `packages/db`.
 */
export type DefinitionEcheance = {
  readonly libelle: string;
  readonly recurrence: RecurrenceEcheance;
  /**
   * Premier jour du cycle, au format `MM-JJ`.
   * Exception : une echeance `ponctuelle` porte ici sa date complete `AAAA-MM-JJ`,
   * puisqu'elle n'a pas de cycle.
   */
  readonly jourReference: string;
  /** Autres jours `MM-JJ` du meme cycle annuel. Vide sauf pour une trimestrielle. */
  readonly joursSupplementaires: readonly string[];
  readonly sourceLegale: string;
  readonly urlSource: string | null;
  /**
   * Pas, en annees, entre deux CYCLES de CETTE echeance. `null` : aucune
   * repetition (`ponctuelle`).
   *
   * DEFAUT CORRIGE (mission du 01/08/2026, docs/29-VALEURS-EN-DUR.md §6 point 1,
   * `echeance_pas_quinquennal_annees`) : ce champ vivait auparavant dans une
   * constante PRIVEE de module (`PAS_ANNEES`), calculee UNE SEULE FOIS depuis
   * les valeurs PAR DEFAUT du catalogue de parametres — modifier
   * `echeance_pas_quinquennal_annees` depuis l'ecran Parametres n'avait donc
   * AUCUN effet sur la prochaine occurrence quinquennale calculee par
   * `prochaineOccurrenceEcheance`, alors meme que la cle etait deja editable
   * et deja lue par ailleurs (`construireCatalogueEcheances` la relit bien
   * pour les jours, sources et URL — seul CE nombre restait fige). Porte
   * desormais PAR LA DEFINITION, comme `jourReference`/`sourceLegale` :
   * `construireCatalogueEcheances` le calcule depuis le `Parametres` REELLEMENT
   * reçu (valeurs par defaut OU chargees en base via `lireParametres`), et
   * `prochaineOccurrenceEcheance` ne lit plus qu'une constante de module.
   *
   * Valeurs structurelles pour les trois autres recurrences (`1` pour
   * `annuelle`/`trimestrielle`, `null` pour `ponctuelle`) : ce ne sont PAS des
   * « taux, seuils ou montants reglementaires » (CLAUDE.md §7) mais la
   * definition meme des mots « annuelle » et « ponctuelle » — rien a
   * parametrer, contrairement au pas quinquennal qui EST une decision externe
   * (la Wallonie pourrait un jour passer ce cycle a 10 ans).
   */
  readonly pasAnnees: number | null;
};

/**
 * Analyse la valeur d'un parametre `echeance_*_jours` : une liste de jours
 * `MM-JJ` separee par des virgules, ou le PREMIER est `jourReference` et les
 * suivants `joursSupplementaires` — docs/29-VALEURS-EN-DUR.md §6 point 1 et
 * CLAUDE.md §7 : une seule valeur porte les deux, ce sont deux faces d'un
 * meme cycle (voir le commentaire « REPRESENTATION DES RECURRENCES »
 * ci-dessus). Rend TOUJOURS au moins un jour, meme garantie que le type
 * `DefinitionEcheance` : une echeance sans date n'est pas representable.
 */
function joursDuParametre(valeurBrute: string): readonly [string, ...string[]] {
  const [premier, ...reste] = valeurBrute.split(',');
  if (premier === undefined || premier === '') {
    throw new ErreurMetier(
      'parametre_echeance_invalide',
      `Le paramètre de jours d'échéance « ${valeurBrute} » ne définit aucun jour exploitable.`,
    );
  }
  return [premier, ...reste];
}

/**
 * Construit le catalogue des echeances reglementaires a partir d'un jeu de
 * PARAMETRES donne — jours, sources legales et URL de chaque echeance sont
 * DESORMAIS LUS depuis le catalogue de `packages/core/src/parametres.ts`
 * (cles `echeance_*_jours`, `echeance_*_source_legale`, `echeance_*_url_source`),
 * plus jamais des litteraux inline (docs/29-VALEURS-EN-DUR.md §6 point 1).
 *
 * `libelle` et `recurrence` restent des litteraux ICI, volontairement : ce
 * ne sont pas des « taux, seuils ou montants reglementaires » (CLAUDE.md §7)
 * mais des identifiants structurels. `libelle` sert de CLE DE CORRESPONDANCE
 * avec la table `echeance` (`packages/db/src/depots/comptabilite.ts`,
 * `seedEcheances`) : le dupliquer dans le catalogue de parametres n'apporterait
 * rien et ouvrirait un second endroit ou il pourrait diverger du premier.
 *
 * EXPORTEE (et non gardee privee) pour deux raisons : les tests peuvent
 * verifier qu'un jeu de parametres DIFFERENT produit un catalogue different
 * (preuve que la lecture est reelle, pas un decor), et `packages/db` (voir
 * `depots/comptabilite.ts::seedEcheances`/`marquerEcheanceFaite`) l'appelle
 * avec un `Parametres` charge DEPUIS LA BASE (`lireParametres`), pas
 * seulement les valeurs par defaut — c'est ce qui rend CES cles reellement
 * editables a effet depuis l'ecran Parametres, `echeance_pas_quinquennal_annees`
 * comprise (voir `DefinitionEcheance.pasAnnees` ci-dessus).
 */
export function construireCatalogueEcheances(
  parametres: Parametres,
): readonly DefinitionEcheance[] {
  const joursListingTva = joursDuParametre(parametres.texte('echeance_listing_tva_jours'));
  const joursInasti = joursDuParametre(parametres.texte('echeance_inasti_trimestrielle_jours'));
  const joursAfsca = joursDuParametre(parametres.texte('echeance_contribution_afsca_jours'));
  const joursAmbulant = joursDuParametre(
    parametres.texte('echeance_renouvellement_ambulant_jours'),
  );
  const joursE604b = joursDuParametre(parametres.texte('echeance_e604b_jours'));
  // Seule recurrence dont le pas est reellement PARAMETRABLE — voir le
  // commentaire de `DefinitionEcheance.pasAnnees`. Lu UNE fois ici, depuis le
  // `Parametres` REELLEMENT reçu (defauts ou base), jamais depuis une
  // constante de module figee.
  const pasQuinquennalAnnees = parametres.entier('echeance_pas_quinquennal_annees');
  // Ce parametre etait AUPARAVANT sans effet (voir le commentaire de
  // `DefinitionEcheance.pasAnnees`) : rien ne pouvait donc jamais le tester a
  // une valeur absurde. Devenu reellement editable, il merite la meme garde
  // que `dureeAnnees` sur `planAmortissement` — un pas negatif ou nul ferait
  // boucler `prochaineOccurrenceQuinquennale` sur une division invalide.
  // `Parametres.entier` garantit deja un entier ; seule la positivite reste a
  // verifier ici.
  if (pasQuinquennalAnnees <= 0) {
    throw new ErreurMetier(
      'pas_quinquennal_invalide',
      `Le pas de renouvellement quinquennal doit être un nombre entier d'années strictement ` +
        `positif (reçu ${pasQuinquennalAnnees}).`,
      { champs: { echeance_pas_quinquennal_annees: 'Doit être un entier strictement positif.' } },
    );
  }

  return [
    {
      libelle: 'Listing clients TVA',
      recurrence: 'annuelle',
      jourReference: joursListingTva[0],
      joursSupplementaires: joursListingTva.slice(1),
      sourceLegale: parametres.texte('echeance_listing_tva_source_legale'),
      urlSource: parametres.texteOuNull('echeance_listing_tva_url_source'),
      pasAnnees: 1,
    },
    {
      libelle: 'Cotisation INASTI (trimestrielle)',
      recurrence: 'trimestrielle',
      jourReference: joursInasti[0],
      joursSupplementaires: joursInasti.slice(1),
      sourceLegale: parametres.texte('echeance_inasti_trimestrielle_source_legale'),
      urlSource: parametres.texteOuNull('echeance_inasti_trimestrielle_url_source'),
      pasAnnees: 1,
    },
    {
      libelle: 'Contribution annuelle AFSCA',
      recurrence: 'annuelle',
      jourReference: joursAfsca[0],
      joursSupplementaires: joursAfsca.slice(1),
      sourceLegale: parametres.texte('echeance_contribution_afsca_source_legale'),
      urlSource: parametres.texteOuNull('echeance_contribution_afsca_url_source'),
      pasAnnees: 1,
    },
    {
      libelle: "Renouvellement de l'autorisation d'activités ambulantes",
      recurrence: 'quinquennale',
      jourReference: joursAmbulant[0],
      joursSupplementaires: joursAmbulant.slice(1),
      sourceLegale: parametres.texte('echeance_renouvellement_ambulant_source_legale'),
      urlSource: parametres.texteOuNull('echeance_renouvellement_ambulant_url_source'),
      pasAnnees: pasQuinquennalAnnees,
    },
    {
      libelle: 'Formulaire e604B — dépassement du seuil de franchise TVA',
      recurrence: 'annuelle',
      jourReference: joursE604b[0],
      joursSupplementaires: joursE604b.slice(1),
      sourceLegale: parametres.texte('echeance_e604b_source_legale'),
      urlSource: parametres.texteOuNull('echeance_e604b_url_source'),
      pasAnnees: 1,
    },
  ];
}

/**
 * Echeances reglementaires belges connues, RESOLUES A LEURS VALEURS PAR
 * DEFAUT (voir `PARAMETRES_PAR_DEFAUT` et la limite qui y est documentee).
 *
 * Le projet ne prevoyait qu'un rappel — le listing TVA au 31 mars. Il en manque
 * au moins quatre, toutes reelles et toutes a consequence financiere
 * (docs/07 §6.8 rang 14).
 *
 * Comme pour les seuils, la SOURCE accompagne chaque echeance : une date sans
 * source est inverifiable l'annee suivante.
 */
export const CATALOGUE_ECHEANCES: readonly DefinitionEcheance[] =
  construireCatalogueEcheances(PARAMETRES_PAR_DEFAUT);

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const FORMAT_MOIS_JOUR = /^\d{2}-\d{2}$/;

/** Normalise « AAAA-MM-JJ… » en « AAAA-MM-JJ ». Refuse toute autre forme. */
function jourSeul(valeur: string): string {
  const jour = valeur.slice(0, 10);
  if (!FORMAT_JOUR.test(jour)) {
    throw new ErreurMetier(
      'date_invalide',
      `« ${valeur} » n'est pas une date exploitable. Format attendu : AAAA-MM-JJ.`,
    );
  }
  return jour;
}

/**
 * Verifie qu'une date construite EXISTE au calendrier.
 *
 * Sans ce controle, un jour de reference au 29 fevrier produirait « 2027-02-29 »
 * trois annees sur quatre : une date fabriquee, dont `joursAvantEcheance` ne
 * saurait rien dire et que l'echeancier afficherait sans jamais alerter. Mieux
 * vaut refuser bruyamment que rappeler une echeance a une date qui n'existe pas.
 */
function verifierDateReelle(date: string, origine: string): void {
  const annee = Number(date.slice(0, 4));
  const mois = Number(date.slice(5, 7));
  const jour = Number(date.slice(8, 10));
  const controle = new Date(Date.UTC(annee, mois - 1, jour));
  if (controle.getUTCMonth() !== mois - 1 || controle.getUTCDate() !== jour) {
    throw new ErreurMetier(
      'date_invalide',
      `Le jour « ${origine} » n'existe pas en ${annee}. Choisissez une date présente ` +
        'toutes les années (le 29 février ne convient pas).',
    );
  }
}

/** Tous les jours `MM-JJ` d'un cycle. Au moins un, garanti par le type. */
function joursDuCycle(definition: DefinitionEcheance): readonly [string, ...string[]] {
  return [definition.jourReference, ...definition.joursSupplementaires];
}

/**
 * Prochaine occurrence ANNUELLE d'un jour `MM-JJ`, a partir d'un jour donne.
 *
 * Primitive de bas niveau : elle ne connait qu'un pas d'un an. Pour respecter la
 * recurrence declaree au catalogue, passer par `prochaineOccurrenceEcheance`.
 */
export function prochaineOccurrence(jourReference: string, aPartirDe: string): string {
  if (!FORMAT_MOIS_JOUR.test(jourReference)) {
    throw new ErreurMetier(
      'jour_reference_invalide',
      `« ${jourReference} » n'est pas un jour de référence. Format attendu : MM-JJ.`,
    );
  }
  const depart = jourSeul(aPartirDe);
  const annee = Number.parseInt(depart.slice(0, 4), 10);
  const candidate = `${annee}-${jourReference}`;
  const retenu = candidate >= depart ? candidate : `${annee + 1}-${jourReference}`;
  verifierDateReelle(retenu, jourReference);
  return retenu;
}

/**
 * Prochaine occurrence d'une echeance du catalogue, EN TENANT COMPTE de sa
 * recurrence.
 *
 * `dateAncrage` n'est requis que par la recurrence quinquennale : elle porte la
 * date de PREMIERE DELIVRANCE de l'autorisation, qui est une donnee de
 * l'utilisateur et non du catalogue. La premiere echeance est alors cet ancrage
 * plus cinq ans — pas l'ancrage lui-meme, qui est un point de depart de
 * validite, pas une date butoir.
 */
export function prochaineOccurrenceEcheance(
  definition: DefinitionEcheance,
  aPartirDe: string,
  dateAncrage?: string,
): string {
  const jour = jourSeul(aPartirDe);

  switch (definition.recurrence) {
    case 'ponctuelle': {
      // Rendue telle quelle, meme depassee : `joursAvantEcheance` sera negatif
      // et l'echeancier l'affichera « en retard ». Une echeance ponctuelle
      // manquee ne doit surtout pas se reporter toute seule a l'annee suivante,
      // ce qui la ferait disparaitre de la liste des retards (CLAUDE.md §7).
      return jourSeul(definition.jourReference);
    }

    case 'annuelle':
    case 'trimestrielle': {
      // Meme pas d'un an pour les deux ; seul le nombre de jours du cycle
      // change. On projette chaque jour sur sa prochaine occurrence annuelle et
      // on garde la plus proche — les dates ISO se comparent comme des chaines.
      const occurrences = joursDuCycle(definition).map((j) => prochaineOccurrence(j, jour));
      return occurrences.reduce((plusProche, date) => (date < plusProche ? date : plusProche));
    }

    case 'quinquennale': {
      // `pasAnnees` vient de LA DEFINITION reçue en argument, jamais d'une
      // constante de module : voir le commentaire de `DefinitionEcheance.pasAnnees`.
      // Une echeance `quinquennale` DOIT porter un pas reel — `null` ici
      // serait une definition mal construite, jamais un cas metier normal.
      if (definition.pasAnnees === null) {
        throw new ErreurMetier(
          'pas_echeance_manquant',
          `« ${definition.libelle} » est declaree quinquennale mais ne porte aucun pas en ` +
            'années : le catalogue qui a construit cette définition est incomplet.',
        );
      }

      if (dateAncrage === undefined) {
        throw new ErreurMetier(
          'ancrage_echeance_manquant',
          `« ${definition.libelle} » se renouvelle tous les ${definition.pasAnnees} ans ` +
            'à compter de sa première délivrance : renseignez cette date dans ' +
            "l'échéancier pour connaître la prochaine.",
          {
            champs: {
              dateAncrage: 'Indiquez la date de première délivrance (AAAA-MM-JJ).',
            },
          },
        );
      }
      return prochaineOccurrenceQuinquennale(jourSeul(dateAncrage), jour, definition.pasAnnees);
    }
  }
}

/**
 * Occurrence quinquennale : ancrage + k x `pas` ans, avec k >= 1, la plus
 * proche a partir de `jour`. Le jour et le mois viennent de l'ANCRAGE — c'est
 * la date de delivrance qui fixe l'anniversaire, pas le repere par defaut du
 * catalogue.
 *
 * `pas` est RECU en argument (`DefinitionEcheance.pasAnnees`), jamais lu
 * depuis une constante de module : c'est precisement ce qui rend
 * `echeance_pas_quinquennal_annees` reellement editable depuis l'ecran
 * Parametres (mission du 01/08/2026 — voir le commentaire de
 * `DefinitionEcheance.pasAnnees`).
 */
function prochaineOccurrenceQuinquennale(ancrage: string, jour: string, pas: number): string {
  const anneeAncrage = Number.parseInt(ancrage.slice(0, 4), 10);
  const moisJour = ancrage.slice(5);

  // Premiere annee civile ou le jour anniversaire n'est pas deja passe.
  const anneeCourante = Number.parseInt(jour.slice(0, 4), 10);
  const anneeCible = jour.slice(5) <= moisJour ? anneeCourante : anneeCourante + 1;

  // Puis on remonte au multiple de `pas` suivant, au minimum un cycle complet.
  const cycles = Math.max(1, Math.ceil((anneeCible - anneeAncrage) / pas));
  const occurrence = `${anneeAncrage + cycles * pas}-${moisJour}`;
  verifierDateReelle(occurrence, moisJour);
  return occurrence;
}

/** Jours restants avant une echeance. Negatif si elle est depassee. */
export function joursAvantEcheance(dateEcheance: string, aujourdHui: string): number {
  const a = Date.parse(`${aujourdHui.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${dateEcheance.slice(0, 10)}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
