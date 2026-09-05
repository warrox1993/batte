/**
 * Suivi des économies d'achat (fiche `docs/demandes/12-MODULE-ECONOMIES-ACHAT-INSPIRE-MITHRA.md`),
 * transposé d'un classeur Mithra Pharmaceuticals : capturer un avant/après de
 * prix à chaque décision d'achat, l'agréger en tableau de bord.
 *
 * Trois types d'action identifiés dans le fichier source : négociation de
 * prix, achat d'une alternative moins chère, remplacement par du stock déjà
 * immobilisé (ex. un ingrédient qui approche sa DLC, réutilisé plutôt que
 * racheté). `autre` couvre les cas non prévus, plutôt que de forcer une saisie
 * dans une catégorie qui ne correspond pas.
 *
 * DÉCISION STRUCTURANTE DE CE FICHIER : `economieCents` n'est JAMAIS stocké,
 * il se calcule ici, toujours depuis les mêmes trois entiers déjà persistés
 * (`packages/db/src/schema.ts` porte la justification complète). C'est une
 * SOUSTRACTION puis un PRODUIT d'entiers : un calcul exact, sans le moindre
 * risque d'arrondi — ce qui rend d'autant moins défendable l'idée de le
 * stocker malgré tout, contrairement au CUMP (D-018, une moyenne pondérée) ou
 * au prix unitaire d'un lot (D-044, un quotient non représentable en binaire),
 * où au moins la division introduisait une perte de précision réelle à éviter
 * de propager. Ici il n'y a même pas cette excuse.
 */

/** Les quatre types d'action retenus, dans l'ordre du classeur source. */
export const TYPES_ACTION_ECONOMIE = [
  'negociation_prix',
  'achat_alternatif',
  'remplacement_stock_immobilise',
  'autre',
] as const;

export type TypeActionEconomie = (typeof TYPES_ACTION_ECONOMIE)[number];

/* ═══════════════════════════════════════════════════════════════════════════
   Calcul de l'économie — jamais stocké, voir l'en-tête de ce fichier
   ═══════════════════════════════════════════════════════════════════════════ */

/** Écart de prix par unité, en centimes ENTIERS. Positif = économie, négatif = hausse. */
export function calculerEconomieUnitaireCents(
  prixUnitaireAvantCents: number,
  prixUnitaireApresCents: number,
): number {
  return prixUnitaireAvantCents - prixUnitaireApresCents;
}

/**
 * Économie totale d'une ligne : `(avant - après) × quantité`. Fonction pure,
 * appelée à CHAQUE LECTURE par le dépôt (`packages/db/src/depots/economies.ts`)
 * — jamais à l'écriture, jamais stockée.
 */
export function calculerEconomieCents(
  prixUnitaireAvantCents: number,
  prixUnitaireApresCents: number,
  quantiteConcernee: number,
): number {
  return (
    calculerEconomieUnitaireCents(prixUnitaireAvantCents, prixUnitaireApresCents) *
    quantiteConcernee
  );
}

/**
 * Une ligne d'économie n'a de sens que si le prix a RÉELLEMENT baissé : un
 * suivi d'économies qui accepterait des hausses de prix ne serait plus un
 * suivi d'économies. Strictement positive, et non pas seulement non négative
 * — une économie nulle n'est l'aboutissement d'aucune action de réduction de
 * coût, elle ne mérite pas une ligne.
 */
export function estEconomieStrictementPositive(
  prixUnitaireAvantCents: number,
  prixUnitaireApresCents: number,
): boolean {
  return (
    Number.isFinite(prixUnitaireAvantCents) &&
    Number.isFinite(prixUnitaireApresCents) &&
    prixUnitaireApresCents < prixUnitaireAvantCents
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Agrégation — tableau de bord (feuille « CHART_COST REDUCTION » du fichier
   source) : économie totale, ventilation mensuelle par type, total par type.
   ═══════════════════════════════════════════════════════════════════════════ */

export type EntreeEconomieAgregation = {
  /** Jour civil `AAAA-MM-JJ`. */
  readonly dateAction: string;
  readonly typeAction: TypeActionEconomie;
  readonly economieCents: number;
};

/** Montants par type d'action, en centimes. Toujours les quatre clés, à 0 par défaut. */
export type MontantsParType = Readonly<Record<TypeActionEconomie, number>>;

export type VentilationMensuelle = {
  /** `AAAA-MM`. */
  readonly mois: string;
  readonly parType: MontantsParType;
  readonly totalCents: number;
};

export type VentilationParType = {
  readonly typeAction: TypeActionEconomie;
  readonly totalCents: number;
  readonly nbActions: number;
};

export type TableauBordEconomies = {
  readonly totalCents: number;
  readonly nbActions: number;
  /** Trié par mois croissant — c'est l'ordre de lecture d'un graphique en barres empilées. */
  readonly parMois: readonly VentilationMensuelle[];
  /** Toujours les quatre types, y compris ceux à 0 action : c'est ce qui permet
   * de VOIR qu'un levier n'a jamais été utilisé, pas seulement de le déduire
   * de son absence. */
  readonly parType: readonly VentilationParType[];
};

function montantsParTypeVides(): Record<TypeActionEconomie, number> {
  return {
    negociation_prix: 0,
    achat_alternatif: 0,
    remplacement_stock_immobilise: 0,
    autre: 0,
  };
}

/**
 * Agrège une liste de lignes d'économie (déjà calculées, `economieCents`
 * compris) en tableau de bord. Fonction pure : ne lit rien, n'écrit rien —
 * c'est au dépôt de fournir les lignes et à la route de les exposer.
 */
export function agregerEconomies(
  lignes: readonly EntreeEconomieAgregation[],
): TableauBordEconomies {
  const parMoisMap = new Map<string, Record<TypeActionEconomie, number>>();
  const parTypeMap = new Map<TypeActionEconomie, { totalCents: number; nbActions: number }>();
  let totalCents = 0;

  for (const ligne of lignes) {
    const mois = ligne.dateAction.slice(0, 7);

    const ventilationMois = parMoisMap.get(mois) ?? montantsParTypeVides();
    ventilationMois[ligne.typeAction] += ligne.economieCents;
    parMoisMap.set(mois, ventilationMois);

    const cumulType = parTypeMap.get(ligne.typeAction) ?? { totalCents: 0, nbActions: 0 };
    cumulType.totalCents += ligne.economieCents;
    cumulType.nbActions += 1;
    parTypeMap.set(ligne.typeAction, cumulType);

    totalCents += ligne.economieCents;
  }

  const parMois: VentilationMensuelle[] = [...parMoisMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([mois, parType]) => ({
      mois,
      parType,
      totalCents: TYPES_ACTION_ECONOMIE.reduce((somme, type) => somme + parType[type], 0),
    }));

  const parType: VentilationParType[] = TYPES_ACTION_ECONOMIE.map((typeAction) => ({
    typeAction,
    totalCents: parTypeMap.get(typeAction)?.totalCents ?? 0,
    nbActions: parTypeMap.get(typeAction)?.nbActions ?? 0,
  }));

  return { totalCents, nbActions: lignes.length, parMois, parType };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Lien vers la comptabilité analytique — CLAUDE.md §0 : « une économie isolée
   ne sert à rien dans un ERP ».
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Part de la marge brute d'une période due aux économies d'achat réalisées
 * sur la même période, en points de base.
 *
 * `null` si la marge n'est pas strictement positive : un ratio sur une marge
 * nulle ou négative n'a aucun sens à afficher — même famille de garde que
 * `ratioCritique` (D-034), un dénominateur non significatif rend `null`,
 * jamais un chiffre inventé.
 *
 * IMPORTANT (voir fiche 12, « ce qui doit être relié ») : ce ratio ne modifie
 * RIEN à la valorisation du stock. Le CUMP ne change pas rétroactivement — une
 * économie de prix futur ne revalorise pas les lots déjà en stock, qui restent
 * valorisés au prix réel payé à chaque lot (D-044). C'est un indicateur de
 * pilotage en lecture seule, jamais une écriture.
 */
export function partMargeDueAuxEconomiesBp(
  margeBruteCents: number,
  economiesCents: number,
): number | null {
  if (!Number.isFinite(margeBruteCents) || margeBruteCents <= 0) return null;
  if (!Number.isFinite(economiesCents)) return null;
  // Arrondi au plus proche, sans le vocabulaire monétaire de `argent.ts` (pas
  // un montant, un ratio) : `Math.round` suffit, aucun argument negatif ne
  // circule ici (une marge negative est deja ecartee ci-dessus, et une
  // economie negative — une hausse de prix saisie a tort — resterait un cas
  // degrade honnete a afficher, pas a masquer).
  return Math.round((economiesCents / margeBruteCents) * 10_000);
}
