/**
 * Dépôt du suivi des économies d'achat (fiche 12 — inspiré du classeur Mithra
 * Pharmaceuticals). Trois usages : saisie libre (le formulaire « remplacement
 * de stock immobilisé » et les cas non couverts par une renégociation de
 * tarif), l'accroche sur `enregistrerNouveauTarif`, et le tableau de bord
 * agrégé.
 *
 * ═══ `economie_cents` n'est JAMAIS stocké ═══
 *
 * Voir `packages/db/src/schema.ts` pour la décision complète. Chaque lecture
 * de ce dépôt appelle `calculerEconomieCents` (`packages/core/src/economies.ts`) :
 * il n'y a AUCUN chemin, dans ce fichier, qui écrive une colonne d'économie —
 * la table n'en a pas.
 *
 * ═══ Barrels déjà câblés ═══
 *
 * `packages/core/src/index.ts` et `packages/core/src/contrats/index.ts`
 * exportent désormais ce module (`export * from './economies.js'`) : les
 * imports ci-dessous passent par `@batte/core`, pas par un chemin relatif.
 * Note corrigée le 29/07/2026 (audit chaîne d'achat) : le commentaire
 * précédent affirmait le contraire de ce que le code faisait déjà — un
 * commentaire qui ment est pire qu'un absent (D-040).
 *
 * ═══ Point d'accroche : `enregistrerNouveauTarif` n'est PAS dupliqué ═══
 *
 * `renegocierTarifAvecEconomie` APPELLE la fonction existante de
 * `depots/referentiel-ecriture.ts` (archivage de l'ancienne ligne, refus
 * d'une date antérieure — D-042) puis, SEULEMENT si le nouveau prix est
 * réellement inférieur, ajoute la ligne d'économie dans le prolongement du
 * même appel. Aucune règle de `enregistrerNouveauTarif` n'est réécrite ici.
 */

import { ErreurIntrouvable, ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import {
  agregerEconomies,
  calculerEconomieCents,
  calculerEconomieUnitaireCents,
  estEconomieStrictementPositive,
  partMargeDueAuxEconomiesBp,
  type TableauBordEconomies,
  type TypeActionEconomie,
} from '@batte/core';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  commandeFournisseur,
  conditionnement,
  economieAchat,
  fournisseur,
  ingredient,
  sessionMarche,
} from '../schema.js';
import { verifierFournisseurCommercial } from './fournisseur-systeme.js';
import { enregistrerNouveauTarif, verifierIngredientExiste } from './referentiel-ecriture.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════════ */

export type EconomieLigne = {
  readonly id: string;
  readonly dateAction: string;
  readonly ingredientId: string;
  readonly ingredientNom: string;
  readonly fournisseurId: string;
  readonly fournisseurNom: string;
  readonly conditionnementId: string | null;
  readonly conditionnementLibelle: string | null;
  readonly typeAction: TypeActionEconomie;
  readonly description: string;
  readonly prixUnitaireAvantCents: number;
  readonly prixUnitaireApresCents: number;
  readonly quantiteConcernee: number;
  /** DÉRIVÉ à la lecture — voir l'en-tête de ce fichier. */
  readonly economieCents: number;
  readonly commandeId: string | null;
  readonly commandeNumero: string | null;
  readonly saisiPar: string | null;
  readonly creeLe: string;
};

export type EntreeEconomie = {
  readonly dateAction: string;
  readonly ingredientId: string;
  readonly fournisseurId: string;
  readonly conditionnementId: string | null;
  readonly typeAction: TypeActionEconomie;
  readonly description: string;
  readonly prixUnitaireAvantCents: number;
  readonly prixUnitaireApresCents: number;
  readonly quantiteConcernee: number;
  readonly commandeId: string | null;
  readonly saisiPar: string | null;
};

export type EntreeRenegociationTarif = {
  readonly conditionnementId: string;
  readonly prixCents: number;
  readonly datePrix: string;
  readonly referenceFournisseur: string | null;
  readonly quantiteConcernee: number;
  readonly description: string | null;
  readonly saisiPar: string | null;
};

export type ResultatRenegociationEconomie = {
  readonly conditionnementId: string;
  readonly ancienPrixCents: number;
  readonly nouveauPrixCents: number;
  /** `null` quand le nouveau prix n'est pas inférieur à l'ancien : le tarif
   * change bien, mais ce n'est pas une économie. */
  readonly economie: EconomieLigne | null;
};

export type FiltreEconomies = {
  readonly debut?: string;
  readonly fin?: string;
  readonly typeAction?: TypeActionEconomie;
};

export type DetectionEconomie = {
  /**
   * Taux de référence, en centimes par unité — la contenance d'UN
   * conditionnement quand un seul format est actif pour ce couple
   * ingrédient/fournisseur (mêmes conventions que `conditionnement.prix_cents`,
   * comparé alors TEL QUEL) ; le taux le plus BAS actuellement actif, ramené à
   * l'unité de référence de l'ingrédient (`prixCents / quantiteUniteRef`,
   * fractionnaire, jamais stocké — même exception que `prixUnitaireCents` de
   * D-044), quand `quantiteUniteRefCandidat` est fourni.
   *
   * `null` dans deux cas : aucun conditionnement actif n'existe pour ce couple,
   * OU plusieurs conditionnements actifs de CONTENANCES DIFFÉRENTES coexistent
   * sans qu'on sache à laquelle rapporter le prix candidat. Audit du
   * 29/07/2026 : avant ce correctif, la fonction prenait alors le
   * conditionnement le plus récemment tarifé, SANS regarder sa contenance —
   * comparer le prix total d'un sac de 25 kg à celui d'un paquet d'un kilo
   * aurait produit un écart absurde. `null` dit honnêtement l'impossibilité
   * plutôt que de deviner (même doctrine que `ratioCritique`, D-034).
   */
  readonly prixReferenceCents: number | null;
  readonly economieUnitaireCents: number | null;
  readonly economiePotentielle: boolean;
  /**
   * Franco de port et commande minimum du fournisseur COMPARÉ, `null` si non
   * renseignés ou si le fournisseur est introuvable. Un écart unitaire positif
   * n'est une économie RÉELLE que si le volume envisagé dépasse ces seuils —
   * l'écran doit les montrer À CÔTÉ du chiffre, jamais les traduire en un
   * verdict automatique : convertir un seuil en euros par commande exigerait
   * une hypothèse sur la fréquence d'achat que rien ici ne mesure (même
   * réserve que D-060 pour un tarif d'emplacement au mètre linéaire).
   */
  readonly francoDePortCents: number | null;
  readonly commandeMinimumCents: number | null;
};

export type TableauBordEconomiesDepot = TableauBordEconomies & {
  readonly partMargeBp: number | null;
};

/* ═══════════════════════════════════════════════════════════════════════════
   Vérifications d'existence — mêmes messages et conventions que
   `depots/referentiel-ecriture.ts`. Le fournisseur et l'ingrédient ne sont
   PLUS dupliqués ici (audit du 31/07/2026) : voir `depots/fournisseur-systeme.ts`
   (foyer partagé avec `depots/referentiel-ecriture.ts`, `services/factures.ts`
   et `depots/comptabilite.ts`) et `verifierIngredientExiste`, importée de
   `depots/referentiel-ecriture.ts` (foyer partagé avec
   `depots/nomenclature-vente.ts`) — cette dernière possède le CRUD
   `ingredient`, ce dépôt-ci n'en possède aucun. Conditionnement et commande
   restent vérifiés ICI : aucun autre dépôt n'a besoin de la même vérification
   à ce jour (D-045 : ne pas fondre deux règles qui se ressemblent seulement
   aujourd'hui).
   ═══════════════════════════════════════════════════════════════════════════ */

function verifierConditionnementExiste(base: BaseBatte, conditionnementId: string): void {
  const existe = base
    .select({ id: conditionnement.id })
    .from(conditionnement)
    .where(eq(conditionnement.id, conditionnementId))
    .get();
  if (existe === undefined) {
    throw new ErreurMetier(
      'conditionnement_introuvable',
      "Le conditionnement choisi n'existe pas ou a été supprimé.",
      { champs: { conditionnementId: 'Choisissez un conditionnement existant.' } },
    );
  }
}

function verifierCommandeExiste(base: BaseBatte, commandeId: string): void {
  const existe = base
    .select({ id: commandeFournisseur.id })
    .from(commandeFournisseur)
    .where(eq(commandeFournisseur.id, commandeId))
    .get();
  if (existe === undefined) {
    throw new ErreurMetier(
      'commande_introuvable',
      "La commande choisie n'existe pas ou a été supprimée.",
      { champs: { commandeId: 'Choisissez une commande existante, ou laissez le champ vide.' } },
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Lecture
   ═══════════════════════════════════════════════════════════════════════════ */

type LigneBrute = {
  id: string;
  dateAction: string;
  ingredientId: string;
  ingredientNom: string;
  fournisseurId: string;
  fournisseurNom: string;
  conditionnementId: string | null;
  conditionnementLibelle: string | null;
  typeAction: TypeActionEconomie;
  description: string;
  prixUnitaireAvantCents: number;
  prixUnitaireApresCents: number;
  quantiteConcernee: number;
  commandeId: string | null;
  commandeNumero: string | null;
  saisiPar: string | null;
  creeLe: string;
};

/** Calcule `economieCents` — jamais lu depuis une colonne, voir l'en-tête. */
function construireLigne(brute: LigneBrute): EconomieLigne {
  return {
    ...brute,
    economieCents: calculerEconomieCents(
      brute.prixUnitaireAvantCents,
      brute.prixUnitaireApresCents,
      brute.quantiteConcernee,
    ),
  };
}

function requeteEconomies(base: BaseBatte) {
  return base
    .select({
      id: economieAchat.id,
      dateAction: economieAchat.dateAction,
      ingredientId: economieAchat.ingredientId,
      ingredientNom: ingredient.nom,
      fournisseurId: economieAchat.fournisseurId,
      fournisseurNom: fournisseur.nom,
      conditionnementId: economieAchat.conditionnementId,
      conditionnementLibelle: conditionnement.libelle,
      typeAction: economieAchat.typeAction,
      description: economieAchat.description,
      prixUnitaireAvantCents: economieAchat.prixUnitaireAvantCents,
      prixUnitaireApresCents: economieAchat.prixUnitaireApresCents,
      quantiteConcernee: economieAchat.quantiteConcernee,
      commandeId: economieAchat.commandeId,
      commandeNumero: commandeFournisseur.numero,
      saisiPar: economieAchat.saisiPar,
      creeLe: economieAchat.creeLe,
    })
    .from(economieAchat)
    .innerJoin(ingredient, eq(economieAchat.ingredientId, ingredient.id))
    .innerJoin(fournisseur, eq(economieAchat.fournisseurId, fournisseur.id))
    .leftJoin(conditionnement, eq(economieAchat.conditionnementId, conditionnement.id))
    .leftJoin(commandeFournisseur, eq(economieAchat.commandeId, commandeFournisseur.id));
}

function ligneParId(base: BaseBatte, id: string): EconomieLigne | undefined {
  const brute = requeteEconomies(base).where(eq(economieAchat.id, id)).get();
  return brute === undefined ? undefined : construireLigne(brute);
}

/** Toutes les économies, la plus récente d'abord. Filtrable par période et par type. */
export function listerEconomies(base: BaseBatte, filtre: FiltreEconomies = {}): EconomieLigne[] {
  const conditions = [];
  if (filtre.debut !== undefined) conditions.push(gte(economieAchat.dateAction, filtre.debut));
  if (filtre.fin !== undefined) conditions.push(lte(economieAchat.dateAction, filtre.fin));
  if (filtre.typeAction !== undefined)
    conditions.push(eq(economieAchat.typeAction, filtre.typeAction));

  const requete = requeteEconomies(base);
  const lignes = (conditions.length === 0 ? requete : requete.where(and(...conditions)))
    .orderBy(desc(economieAchat.dateAction), desc(economieAchat.creeLe))
    .all();

  return lignes.map(construireLigne);
}

/**
 * Marge brute cumulée des sessions CLÔTURÉES de la période — même lecture que
 * `syntheseExercice` (`depots/comptabilite.ts`, hors zone d'écriture) mais
 * réimplémentée ici en 6 lignes plutôt que dupliquée en profondeur : elle ne
 * lit qu'UNE colonne déjà agrégée à la clôture de chaque session
 * (`session_marche.marge_brute_cents`), aucun calcul métier n'est refait.
 */
function margeBruteCentsPeriode(base: BaseBatte, bornes: { debut: string; fin: string }): number {
  const lignes = base
    .select({ margeBruteCents: sessionMarche.margeBruteCents })
    .from(sessionMarche)
    .where(
      and(
        eq(sessionMarche.statut, 'cloturee'),
        gte(sessionMarche.dateSession, bornes.debut),
        lte(sessionMarche.dateSession, bornes.fin),
      ),
    )
    .all();
  return lignes.reduce((somme, l) => somme + (l.margeBruteCents ?? 0), 0);
}

/**
 * Tableau de bord agrégé (feuille « CHART_COST REDUCTION » du fichier
 * source) : économie totale, ventilation mensuelle par type, total par type,
 * et la part de la marge brute de la période due aux économies (CLAUDE.md
 * §0 : « une économie isolée ne sert à rien dans un ERP »).
 */
export function tableauBordEconomies(
  base: BaseBatte,
  bornes: { readonly debut: string; readonly fin: string },
): TableauBordEconomiesDepot {
  const lignes = listerEconomies(base, { debut: bornes.debut, fin: bornes.fin });
  const tableau = agregerEconomies(lignes);
  const margeBruteCents = margeBruteCentsPeriode(base, bornes);
  return {
    ...tableau,
    partMargeBp: partMargeDueAuxEconomiesBp(margeBruteCents, tableau.totalCents),
  };
}

/**
 * Compare un prix candidat au prix de référence ACTIF du couple
 * ingrédient/fournisseur, sans rien écrire : sert à PROPOSER l'écart avant
 * saisie (fiche 12, « au moment d'enregistrer une réception… proposer
 * d'enregistrer l'écart »).
 *
 * CORRECTIF D'AUDIT (29/07/2026). Avant, la référence était « le
 * conditionnement actif le plus récemment tarifé », choisi SANS regarder sa
 * contenance (`quantite_unite_ref`) — rien n'empêche un même fournisseur
 * d'avoir plusieurs formats actifs pour le même ingrédient (aucune contrainte
 * d'unicité ne le garantit). Comparer alors le prix TOTAL d'un sac de 25 kg
 * au prix TOTAL d'un paquet d'un kilo aurait produit un écart absurde — c'est
 * exactement le risque que CLAUDE.md §0 demande de fermer sur les conseils
 * d'achat. Deux garde-fous désormais :
 *
 *  1. si plusieurs formats actifs coexistent avec des contenances
 *     DIFFÉRENTES et qu'aucune contenance candidate n'est fournie, la
 *     fonction refuse de deviner et rend `null` (voir `DetectionEconomie`) ;
 *  2. `quantiteUniteRefCandidat`, optionnelle, permet d'appeler le prix
 *     candidat pour une contenance QUELCONQUE : les deux prix sont alors
 *     ramenés à l'unité de référence de l'ingrédient avant comparaison, au
 *     lieu d'une comparaison de totaux qui suppose silencieusement la même
 *     contenance des deux côtés.
 *
 * Le paramètre reste OPTIONNEL pour ne rien casser côté appelant existant :
 * dans le cas le plus courant (un seul format actif), comparer les deux
 * PRIX TOTAUX reste valide sans lui, exactement comme avant ce correctif.
 */
export function detecterEconomiePotentielle(
  base: BaseBatte,
  params: {
    readonly ingredientId: string;
    readonly fournisseurId: string;
    readonly prixCandidatCents: number;
    /** Contenance de l'offre comparée, dans l'unité de référence de
     * l'ingrédient. Voir le commentaire de la fonction : sert à normaliser
     * la comparaison quand plusieurs formats de tailles différentes sont
     * actifs chez ce fournisseur. */
    readonly quantiteUniteRefCandidat?: number;
  },
): DetectionEconomie {
  if (
    params.quantiteUniteRefCandidat !== undefined &&
    (!Number.isFinite(params.quantiteUniteRefCandidat) || params.quantiteUniteRefCandidat <= 0)
  ) {
    throw new ErreurMetier(
      'quantite_candidate_invalide',
      `La contenance de l'offre comparée doit être un nombre strictement ` +
        `positif (reçu ${params.quantiteUniteRefCandidat}).`,
      { champs: { quantiteUniteRefCandidat: 'Doit être strictement positive.' } },
    );
  }

  // Le fournisseur n'est volontairement PAS vérifié par une erreur typée ici :
  // cette route est balayée par le test anti-fuite avec des identifiants
  // inconnus et doit rester un 200 « aucune référence trouvée » (comme
  // aujourd'hui), pas un 422 — cohérent avec le fait que la fonction ne fait
  // que PROPOSER un écart, jamais n'écrit. `fournisseurLigne` reste `undefined`
  // dans ce cas, et le franco/minimum rendus sont `null`.
  const fournisseurLigne = base
    .select({
      commandeMinimumCents: fournisseur.commandeMinimumCents,
      francoDePortCents: fournisseur.francoDePortCents,
    })
    .from(fournisseur)
    .where(eq(fournisseur.id, params.fournisseurId))
    .get();

  const actifs = base
    .select({
      prixCents: conditionnement.prixCents,
      quantiteUniteRef: conditionnement.quantiteUniteRef,
    })
    .from(conditionnement)
    .where(
      and(
        eq(conditionnement.ingredientId, params.ingredientId),
        eq(conditionnement.fournisseurId, params.fournisseurId),
        eq(conditionnement.actif, true),
      ),
    )
    .orderBy(desc(conditionnement.datePrix))
    .all();

  const resultatNul: DetectionEconomie = {
    prixReferenceCents: null,
    economieUnitaireCents: null,
    economiePotentielle: false,
    commandeMinimumCents: fournisseurLigne?.commandeMinimumCents ?? null,
    francoDePortCents: fournisseurLigne?.francoDePortCents ?? null,
  };

  if (actifs.length === 0) return resultatNul;

  if (params.quantiteUniteRefCandidat === undefined) {
    // Comportement historique, INCHANGÉ pour l'appelant qui ne connaît pas la
    // contenance candidate : ne compare des prix TOTAUX que si un seul format
    // est actif, sinon on ne sait pas lequel le prix candidat concerne.
    const taillesDistinctes = new Set(actifs.map((a) => a.quantiteUniteRef)).size;
    if (taillesDistinctes > 1) return resultatNul;

    const reference = actifs[0]!; // le plus récent ; toutes les tailles sont identiques ici.
    return {
      prixReferenceCents: reference.prixCents,
      economieUnitaireCents: calculerEconomieUnitaireCents(
        reference.prixCents,
        params.prixCandidatCents,
      ),
      economiePotentielle: estEconomieStrictementPositive(
        reference.prixCents,
        params.prixCandidatCents,
      ),
      commandeMinimumCents: resultatNul.commandeMinimumCents,
      francoDePortCents: resultatNul.francoDePortCents,
    };
  }

  // Comparaison NORMALISÉE par unité de référence : le taux le plus BAS
  // actuellement actif est la référence honnête, quelle que soit la
  // contenance de chaque format — c'est lui qu'un nouvel achat doit battre
  // pour mériter le nom d'économie.
  const tauxReference = Math.min(...actifs.map((a) => a.prixCents / a.quantiteUniteRef));
  const tauxCandidat = params.prixCandidatCents / params.quantiteUniteRefCandidat;

  return {
    prixReferenceCents: tauxReference,
    economieUnitaireCents: calculerEconomieUnitaireCents(tauxReference, tauxCandidat),
    economiePotentielle: estEconomieStrictementPositive(tauxReference, tauxCandidat),
    commandeMinimumCents: resultatNul.commandeMinimumCents,
    francoDePortCents: resultatNul.francoDePortCents,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Écriture — table INSERT-ONLY (voir le rapport de livraison : décision
   assumée de ne pas construire d'annulation pour ce ticket, `economie_achat`
   est une constatation historique, jamais corrigée en place — même famille
   que `session_vente`, dont les lignes ne se modifient jamais isolément).
   ═══════════════════════════════════════════════════════════════════════════ */

function inserer(base: BaseBatte, entree: EntreeEconomie): EconomieLigne {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  base
    .insert(economieAchat)
    .values({
      id,
      dateAction: entree.dateAction,
      ingredientId: entree.ingredientId,
      fournisseurId: entree.fournisseurId,
      conditionnementId: entree.conditionnementId,
      typeAction: entree.typeAction,
      description: entree.description,
      prixUnitaireAvantCents: entree.prixUnitaireAvantCents,
      prixUnitaireApresCents: entree.prixUnitaireApresCents,
      quantiteConcernee: entree.quantiteConcernee,
      commandeId: entree.commandeId,
      saisiPar: entree.saisiPar,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  const ligne = ligneParId(base, id);
  if (ligne === undefined) throw new Error(`Économie ${id} introuvable juste après création.`);
  return ligne;
}

/**
 * Saisie libre d'une économie constatée — le formulaire du troisième type
 * Mithra (« remplacement par du stock déjà immobilisé », directement
 * pertinent pour un ingrédient qui approche sa DLC), et plus généralement
 * toute économie qui n'accompagne pas une renégociation de tarif de
 * conditionnement (voir `renegocierTarifAvecEconomie` pour ce cas).
 */
export function enregistrerEconomie(base: BaseBatte, entree: EntreeEconomie): EconomieLigne {
  verifierIngredientExiste(base, entree.ingredientId);
  verifierFournisseurCommercial(
    base,
    entree.fournisseurId,
    'aucune économie ne se négocie avec lui.',
  );
  if (entree.conditionnementId !== null)
    verifierConditionnementExiste(base, entree.conditionnementId);
  if (entree.commandeId !== null) verifierCommandeExiste(base, entree.commandeId);

  if (
    !estEconomieStrictementPositive(entree.prixUnitaireAvantCents, entree.prixUnitaireApresCents)
  ) {
    throw new ErreurMetier(
      'economie_non_positive',
      `Le prix « après » (${entree.prixUnitaireApresCents} c) doit être strictement inférieur au ` +
        `prix « avant » (${entree.prixUnitaireAvantCents} c) : une économie ne peut pas être ` +
        'négative ni nulle. Une hausse de prix se documente ailleurs, pas dans ce suivi.',
      { champs: { prixUnitaireApresCents: 'Doit être strictement inférieur au prix « avant ».' } },
    );
  }

  return inserer(base, entree);
}

/**
 * LE POINT D'ACCROCHE de la fiche : renégocie un tarif de conditionnement en
 * appelant `enregistrerNouveauTarif` (archivage + refus de date antérieure,
 * D-042 — logique NON dupliquée ici), puis enregistre automatiquement
 * l'économie si, et seulement si, le nouveau prix est réellement inférieur.
 *
 * Un tarif qui MONTE change quand même (le meunier a augmenté ses prix, c'est
 * une donnée réelle à conserver) mais ne produit aucune ligne d'économie —
 * `resultat.economie` vaut alors `null`, jamais un montant négatif maquillé.
 *
 * PAS de transaction englobante ici, et c'est délibéré : `enregistrerNouveauTarif`
 * ouvre déjà la sienne (elle doit rester autonome, elle est appelée seule par
 * `routes/referentiel-ecriture.ts`). L'ENVELOPPER dans une seconde transaction
 * reposerait sur le support des SAVEPOINTS imbriqués de better-sqlite3 —
 * non vérifié empiriquement ici, et donc pas assumé. Les deux écritures
 * restent deux appels SYNCHRONES consécutifs (better-sqlite3 est
 * intégralement synchrone, aucun `await` ne s'intercale) : la seule fenêtre
 * de non-atomicité serait une exception de programmation entre les deux, sur
 * des données déjà validées — un risque résiduel jugé acceptable au regard de
 * la complexité d'une transaction imbriquée non testée. À revoir si ce risque
 * doit un jour être supprimé plutôt que borné.
 */
export function renegocierTarifAvecEconomie(
  base: BaseBatte,
  saisie: EntreeRenegociationTarif,
): ResultatRenegociationEconomie {
  // Lu AVANT l'appel : `enregistrerNouveauTarif` désactive cette ligne (elle
  // n'est jamais supprimée), donc `ingredientId`/`fournisseurId`/`libelle`
  // restent lisibles après coup — mais la lire maintenant évite toute
  // ambiguïté sur QUELLE ligne on décrit dans la description par défaut.
  const ancien = base
    .select()
    .from(conditionnement)
    .where(eq(conditionnement.id, saisie.conditionnementId))
    .get();
  if (ancien === undefined) {
    throw new ErreurIntrouvable('Conditionnement', saisie.conditionnementId);
  }

  const resultatTarif = enregistrerNouveauTarif(base, saisie.conditionnementId, {
    prixCents: saisie.prixCents,
    datePrix: saisie.datePrix,
    referenceFournisseur: saisie.referenceFournisseur,
  });

  if (
    !estEconomieStrictementPositive(resultatTarif.ancienPrixCents, resultatTarif.nouveauPrixCents)
  ) {
    return { ...resultatTarif, economie: null };
  }

  const fournisseurNom =
    base
      .select({ nom: fournisseur.nom })
      .from(fournisseur)
      .where(eq(fournisseur.id, ancien.fournisseurId))
      .get()?.nom ?? 'ce fournisseur';

  const economie = inserer(base, {
    dateAction: saisie.datePrix,
    ingredientId: ancien.ingredientId,
    fournisseurId: ancien.fournisseurId,
    conditionnementId: resultatTarif.conditionnementId,
    typeAction: 'negociation_prix',
    description:
      saisie.description ?? `Renégociation de tarif — ${ancien.libelle} chez ${fournisseurNom}.`,
    prixUnitaireAvantCents: resultatTarif.ancienPrixCents,
    prixUnitaireApresCents: resultatTarif.nouveauPrixCents,
    quantiteConcernee: saisie.quantiteConcernee,
    commandeId: null,
    saisiPar: saisie.saisiPar,
  });

  return { ...resultatTarif, economie };
}
