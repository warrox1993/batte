import type { KeyboardEvent, ReactNode, RefObject } from 'react';

/**
 * Primitives de saisie PARTAGÉES par tous les écrans du produit.
 *
 * ═══ Pourquoi ce fichier existe (01/08/2026) ═══
 *
 * `ChampTexte` existait en **six exemplaires** — `Equipements.tsx`,
 * `Fournisseurs.tsx`, `Ingredients.tsx`, `LieuxMarche.tsx`, `Produits.tsx`,
 * `Recettes.tsx` — plus une septième variante sous le nom `ChampSaisie` dans
 * `saisie-stock/champs.tsx`, dont l'en-tête annonçait déjà cette remontée.
 * Mesuré le 01/08/2026 : **six copies, six variantes DISTINCTES**. Aucune
 * paire identique. Même constat sur `ChampSelect` (quatre copies, trois
 * variantes) et `IndicateurEnregistrement` (six copies, deux variantes).
 *
 * CE QUE LA DUPLICATION A COÛTÉ, MESURÉ ET NON SUPPOSÉ. Le 01/08/2026, un
 * correctif d'ergonomie — remplacer `required` par `aria-required`, parce que
 * la validation NATIVE du navigateur annule la soumission avant `onSubmit` et
 * empêche l'écran d'afficher ses propres messages — a dû être appliqué
 * SEPT fois. Les six premières fois, cinq écrans continuaient de porter le
 * défaut sans que rien ne le signale.
 *
 * ═══ Ce que l'unification devait préserver ═══
 *
 * Les six variantes ne divergeaient pas par négligence : chacune portait un
 * besoin réel, et une fusion naïve en aurait perdu.
 *
 *  - `inputMode` valait `'numeric'` dans `Fournisseurs` (clavier ENTIERS) et
 *    `'decimal'` dans `LieuxMarche`/`Ingredients` (clavier DÉCIMALES).
 *    Forcer l'un ou l'autre partout casserait soit la saisie d'un prix, soit
 *    la garde d'un champ entier. D'où `numerique: 'entier' | 'decimal'`,
 *    explicite — jamais un booléen, qui ne saurait pas dire lequel des deux.
 *  - `Recettes` seul posait `readOnly` → `lectureSeule`.
 *  - `Equipements`, `LieuxMarche` et `Produits` n'acceptaient NI `erreur` NI
 *    `aide` : les deux restent facultatives.
 *  - `saisie-stock` avait en plus `libelleMasque`, `refChamp`, `onKeyDown` et
 *    `type: 'date'`, indispensables à la saisie en tableau.
 *
 * Règle d'architecture n°1 (CLAUDE.md §3) : aucun calcul métier ici. Ces
 * composants affichent, focalisent et remontent des chaînes — rien d'autre.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   Classes partagées — un seul endroit où change l'apparence d'un contrôle
   ═══════════════════════════════════════════════════════════════════════════ */

/** Jetons sémantiques uniquement (docs/07 §4.9) : aucune couleur Tailwind brute. */
export const CLASSE_BOUTON_PRIMAIRE =
  'h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:bg-ink-4';

export const CLASSE_BOUTON_SECONDAIRE =
  'h-controle rounded-sm border border-line-field bg-surface px-3 text-sm font-medium text-ink-2 hover:bg-surface-sunken';

/** Action tertiaire en ligne (« Retirer », « Ajouter une ligne »). */
export const CLASSE_BOUTON_LIEN =
  'text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const CLASSE_CONTROLE_BASE =
  'h-controle w-full rounded-sm border bg-surface px-2 text-base text-ink';

/* ═══════════════════════════════════════════════════════════════════════════
   Enveloppe commune
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Nature du clavier numérique demandé.
 *
 * `'entier'` → `inputMode="numeric"` : comptes, quantités en grammes ou
 * millilitres, nombres de crêpes — CLAUDE.md §3 règle 4 les veut ENTIERS.
 * `'decimal'` → `inputMode="decimal"` : montants en euros saisis « 18,75 »,
 * densités, distances. Le clavier mobile expose alors le séparateur décimal.
 */
export type NatureNumerique = 'entier' | 'decimal';

type ProprietesCommunes = {
  nom: string;
  /** Libellé complet, toujours annoncé — visuellement ou via `aria-label`. */
  libelle: string;
  erreur?: string | undefined;
  aide?: ReactNode;
  /**
   * Masque le libellé À L'ÉCRAN, jamais aux lecteurs d'écran. Utilisé dans une
   * rangée de tableau, où l'en-tête de colonne porte déjà l'intitulé visuel :
   * répéter le libellé sous chaque champ ferait quatre lignes par rangée.
   */
  libelleMasque?: boolean;
};

function identifiantsDescription(nom: string, avecErreur: boolean, avecAide: boolean): string {
  return [avecErreur ? `${nom}-erreur` : null, avecAide ? `${nom}-aide` : null]
    .filter((identifiant) => identifiant !== null)
    .join(' ');
}

/**
 * Le `<label>` n'enveloppe QUE le libellé visuel et le contrôle : c'est la
 * seule paire dont le nom accessible doit se composer.
 *
 * DÉFAUT CORRIGÉ (01/08/2026). Aide et erreur vivaient toutes deux À
 * L'INTÉRIEUR du `<label>` : un lecteur d'écran les intégrait donc dans le NOM
 * du champ (« MotifLe motif est obligatoire… ») EN PLUS de les annoncer comme
 * description via `aria-describedby` — un double signalement, transposé à
 * l'annonce vocale, exactement ce que docs/07 §4.7 refuse à l'écran. Elles
 * sont désormais FRÈRES du `<label>`, reliées par le seul `aria-describedby`.
 */
function Enveloppe({
  nom,
  libelle,
  erreur,
  aide,
  libelleMasque = false,
  children,
}: ProprietesCommunes & { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-groupe text-sm text-ink-2">
      <label className="flex min-w-0 flex-col gap-groupe">
        {!libelleMasque && <span>{libelle}</span>}
        {children}
      </label>
      {aide !== undefined && (
        <span id={`${nom}-aide`} className="text-xs text-ink-3">
          {aide}
        </span>
      )}
      {erreur !== undefined && (
        <span id={`${nom}-erreur`} className="text-xs text-depassement">
          {erreur}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Champ de saisie
   ═══════════════════════════════════════════════════════════════════════════ */

export type ChampTexteProps = ProprietesCommunes & {
  valeur: string;
  onChange: (valeur: string) => void;
  type?: 'text' | 'date' | 'time';
  /**
   * Annonce l'obligation aux lecteurs d'écran — **jamais** l'attribut natif
   * `required`. Voir le commentaire sur `aria-required` dans le rendu.
   */
  obligatoire?: boolean;
  /** Chiffres tabulaires + pavé numérique adapté. Voir `NatureNumerique`. */
  numerique?: NatureNumerique;
  lectureSeule?: boolean;
  onKeyDown?: (evenement: KeyboardEvent<HTMLInputElement>) => void;
  refChamp?: RefObject<HTMLInputElement | null>;
};

/**
 * Champ de saisie avec message d'erreur EN LIGNE sous le champ (docs/07 §4.7).
 * Ne vide jamais la saisie en cas d'erreur : refaire taper ce qui vient d'être
 * tapé est la faute d'ergonomie la plus coûteuse d'un formulaire.
 */
export function ChampTexte({
  nom,
  libelle,
  valeur,
  onChange,
  type = 'text',
  erreur,
  aide,
  obligatoire = false,
  numerique,
  lectureSeule = false,
  libelleMasque = false,
  onKeyDown,
  refChamp,
}: ChampTexteProps) {
  const decrit = identifiantsDescription(nom, erreur !== undefined, aide !== undefined);

  return (
    <Enveloppe
      nom={nom}
      libelle={libelle}
      erreur={erreur}
      aide={aide}
      libelleMasque={libelleMasque}
    >
      <input
        name={nom}
        type={type}
        {...(refChamp !== undefined ? { ref: refChamp } : {})}
        {...(numerique !== undefined
          ? { inputMode: numerique === 'entier' ? ('numeric' as const) : ('decimal' as const) }
          : {})}
        {...(libelleMasque ? { 'aria-label': libelle } : {})}
        {...(onKeyDown !== undefined ? { onKeyDown } : {})}
        {...(lectureSeule ? { readOnly: true } : {})}
        /* `aria-required` et NON `required` : l'attribut natif déclenche la
           validation du navigateur, qui ANNULE la soumission avant `onSubmit`.
           La validation applicative n'est alors jamais appelée, et aucun
           message français ne s'affiche — seule une bulle native transitoire,
           qui ne nomme qu'un champ à la fois, là où l'écran sait tous les
           montrer ensemble puis focaliser le premier fautif. */
        aria-required={obligatoire}
        className={`${CLASSE_CONTROLE_BASE} ${numerique !== undefined ? 'num' : ''} ${
          erreur === undefined ? 'border-line-field' : 'border-depassement'
        }`}
        value={valeur}
        onChange={(evenement) => onChange(evenement.target.value)}
        aria-invalid={erreur !== undefined}
        {...(decrit === '' ? {} : { 'aria-describedby': decrit })}
      />
    </Enveloppe>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Liste déroulante
   ═══════════════════════════════════════════════════════════════════════════ */

export type OptionSelection = { readonly valeur: string; readonly libelle: string };

export type ChampSelectProps = ProprietesCommunes & {
  valeur: string;
  onChange: (valeur: string) => void;
  options: readonly OptionSelection[];
  /** Libellé de l'option vide. Absente = le champ n'a pas d'état « non choisi ». */
  optionVide?: string;
  obligatoire?: boolean;
  onKeyDown?: (evenement: KeyboardEvent<HTMLSelectElement>) => void;
  refChamp?: RefObject<HTMLSelectElement | null>;
};

/**
 * Liste déroulante. Jamais un champ libre là où un catalogue existe : un motif
 * tapé à la main ne répond pas à « où fuit la matière ? » (docs/07 §6.8).
 */
export function ChampSelect({
  nom,
  libelle,
  valeur,
  onChange,
  options,
  optionVide,
  erreur,
  aide,
  obligatoire = false,
  libelleMasque = false,
  onKeyDown,
  refChamp,
}: ChampSelectProps) {
  const decrit = identifiantsDescription(nom, erreur !== undefined, aide !== undefined);

  return (
    <Enveloppe
      nom={nom}
      libelle={libelle}
      erreur={erreur}
      aide={aide}
      libelleMasque={libelleMasque}
    >
      <select
        name={nom}
        {...(refChamp !== undefined ? { ref: refChamp } : {})}
        {...(libelleMasque ? { 'aria-label': libelle } : {})}
        {...(onKeyDown !== undefined ? { onKeyDown } : {})}
        /* Voir `ChampTexte` : jamais l'attribut natif `required`. */
        aria-required={obligatoire}
        className={`${CLASSE_CONTROLE_BASE} ${
          erreur === undefined ? 'border-line-field' : 'border-depassement'
        }`}
        value={valeur}
        onChange={(evenement) => onChange(evenement.target.value)}
        aria-invalid={erreur !== undefined}
        {...(decrit === '' ? {} : { 'aria-describedby': decrit })}
      >
        {optionVide !== undefined && <option value="">{optionVide}</option>}
        {options.map((option) => (
          <option key={option.valeur} value={option.valeur}>
            {option.libelle}
          </option>
        ))}
      </select>
    </Enveloppe>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Enveloppe d'un contrôle quelconque
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Étiquette + contrôle libre + message d'erreur, pour les cas où le contrôle
 * n'est ni un `<input>` texte ni un `<select>` — un groupe de cases, un
 * `<textarea>`, un contrôle composite.
 *
 * Existait à l'identique sous le nom `Champ` dans `Evenements.tsx`,
 * `Opportunites.tsx` et `Parametres.tsx` (trois copies, empreinte unique).
 *
 * `htmlFor`/`id` explicites, et non l'imbrication : le contrôle est fourni par
 * l'appelant, cette enveloppe ne peut donc pas garantir qu'il n'y en a qu'un.
 * L'association nominative reste la seule fiable.
 */
export function EnveloppeChamp({
  id,
  label,
  erreur,
  children,
}: {
  id: string;
  label: string;
  erreur?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-ink-3">
        {label}
      </label>
      {children}
      {erreur !== undefined && <p className="text-xs text-depassement">{erreur}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Indicateur de sauvegarde
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Indicateur de sauvegarde plutôt que notification (docs/07 §4.7) : sur un
 * écran enregistré vingt fois, une notification à chaque fois est une nuisance.
 */
export type EtatEnregistrement =
  | { phase: 'inchange' }
  | { phase: 'modifie' }
  | { phase: 'enregistrement' }
  | { phase: 'enregistre'; heure: string };

/** Tiret cadratin des valeurs absentes — même glyphe que `TIRET_ABSENT` de `@batte/core`. */
const TIRET = '—';

export function IndicateurEnregistrement({ etat }: { etat: EtatEnregistrement }) {
  switch (etat.phase) {
    case 'inchange':
      return <span className="text-xs text-ink-3">{TIRET}</span>;
    case 'modifie':
      return <span className="text-xs text-alerte">Modifications non enregistrées</span>;
    case 'enregistrement':
      return <span className="text-xs text-ink-3">Enregistrement…</span>;
    case 'enregistre':
      return <span className="text-xs text-conforme">Enregistré {etat.heure}</span>;
  }
}
