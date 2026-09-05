/**
 * Garde D-081 (`docs/05-DECISIONS.md`) — la somme des `largeur` d'une même
 * définition de colonnes DOIT valoir exactement 100.
 *
 * LE DÉFAUT QUE CE FICHIER EXISTE POUR EMPÊCHER : `Tableau.tsx` pose les
 * `largeur` déclarées sur un `<colgroup>` avec `table-layout: fixed`. Si leur
 * somme dépasse 100, le navigateur RENORMALISE chaque colonne à `100 / somme`
 * — un rétrécissement uniforme et invisible À LA LECTURE DU CODE (rien dans le
 * fichier ne laisse voir qu'une colonne déclarée à 13 % s'affichera à 10 %).
 * C'est ce qui a réduit des en-têtes de tableau à une seule lettre sur 19 des
 * 29 écrans de ce dépôt (audit du 31/07/2026, D-081).
 *
 * POURQUOI CE FICHIER VIT SOUS `apps/api/src` ALORS QU'IL NE CONCERNE QUE
 * `apps/web` : même raison, documentée, que `securite-secrets.test.ts` — un
 * fichier de `apps/web/src` qui importe `node:fs` casse la garde de
 * confinement de CLAUDE.md §2 (« aucun fichier du front n'importe un module
 * qui parle au système de fichiers »), qui interdit justement cet import-là
 * à TOUT fichier situé sous `apps/web/src`, tests compris — pour de bonnes
 * raisons : c'est cette même garde qui empêche la clé Anthropic d'atteindre
 * le navigateur. Ce fichier-ci n'est pas du code de FRONT : c'est un outil de
 * build qui lit des sources sur disque, comme `packages/db/src/schema-
 * migrations.test.ts` (compare le schéma déclaré aux migrations appliquées)
 * ou `apps/api/src/smoke-routes-lecture.test.ts` (balaie les routes) — les
 * deux précédents suivis ici pour l'emplacement. Il est typé par
 * `tsconfig.node.json` (`apps/api/**`, `lib: ["ES2023"]`, pas de DOM), jamais
 * par `tsconfig.web.json`.
 *
 * MÉTHODE DE DÉRIVATION — et pourquoi PAS l'import des définitions exportées :
 * vérifié avant d'écrire ce fichier (`grep -rn "export const \w+.*ColonneTableau"`
 * sur tout `apps/web/src`) qu'AUCUNE définition de colonnes n'est exportée —
 * toutes sont des constantes ou fonctions locales à leur écran. Importer des
 * modules pour sommer des tableaux exportés verrait donc ZÉRO définition. Ce
 * fichier lit le code SOURCE à la place : chaque fichier `.ts`/`.tsx` sous
 * `apps/web/src` (dérivé du système de fichiers, jamais une liste d'écrans
 * énumérée à la main — la leçon de D-045, où un balayage anti-fuite énumérait
 * ses routes à la main et en a raté quatre face à la vraie table de routage).
 *
 * FORMES REPÉRÉES DANS CE DÉPÔT (les quatre motifs de déclaration existants,
 * tous couverts) :
 *  1. `const X: ReadonlyArray<ColonneTableau<T>> = [` (assignation directe) ;
 *  2. `function f(...): ReadonlyArray<ColonneTableau<T>> { return [` (le
 *     type peut lui-même s'étaler sur plusieurs lignes quand le générique est
 *     long — `Comptabilite.tsx`, `COLONNES_ECHEANCES`/`COLONNES_ANNUITES`) ;
 *  3. `const x: ReadonlyArray<ColonneTableau<T>> = useMemo(() => [`
 *     (`Factures.tsx`, `colonnesLignes`) ;
 *  4. `colonnes={[` inline dans le JSX, SANS annotation de type du tout
 *     (`Comptabilite.tsx`, `Concurrents.tsx`, `Economies.tsx`) — détecté
 *     par un motif séparé, littéral.
 *
 * COMMENT LA FERMETURE D'UN TABLEAU EST TROUVÉE, SANS ANALYSEUR SYNTAXIQUE :
 * ce dépôt est formaté par Prettier (`npx prettier --check .` fait partie des
 * vérifications obligatoires) — l'indentation d'une ligne EST donc sa
 * profondeur d'imbrication, garantie par la CI, pas supposée. La ligne de
 * fermeture d'un tableau ouvert à l'indentation N est la PREMIÈRE ligne
 * suivante dont l'indentation redescend à N : tout ce qui est imbriqué à
 * l'intérieur (objets de colonne, fonctions `rendu`, JSX) est nécessairement
 * indenté plus profond. Ça évite d'écrire un lexer JS/JSX complet (apostrophes
 * de texte français dans les `rendu`, gabarits, commentaires...) — la vraie
 * fragilité que la mission de ce fichier signale — au prix d'une hypothèse
 * unique et vérifiable : le formatage Prettier. Si cette hypothèse est un
 * jour fausse pour un fichier, ce test ÉCHOUE BRUYAMMENT (voir plus bas,
 * "forme non reconnue"), il ne saute jamais un fichier en silence.
 *
 * GARDE-FOU DE COUVERTURE (le point le plus important de ce fichier, et ce
 * qu'il NE PROUVE PAS) : une mention de `ColonneTableau` n'ouvre pas toujours
 * un tableau (la déclaration du TYPE lui-même, une signature de PROPS
 * `colonnes: ReadonlyArray<...>;` — ni l'une ni l'autre n'est suivie d'un
 * `[`). Plutôt que d'énumérer ces formes à la main, ce test ne lève PAS
 * d'erreur quand aucune ouverture n'est trouvée à proximité d'une mention :
 * il suppose que ce n'était qu'une référence de type. Le filet de sécurité
 * est ce garde-fou : pour CHAQUE fichier, le nombre total d'occurrences du
 * texte `largeur: '...'` doit être EXACTEMENT égal au nombre d'occurrences
 * comptées à l'intérieur des blocs détectés. Si une vraie définition de
 * colonnes a été ratée (ou un bloc mal délimité), ce nombre diverge et le
 * test `couverture totale` échoue en nommant le fichier et l'écart — jamais
 * un sous-comptage silencieux.
 *
 * CE QUE CE GARDE-FOU NE PEUT PAS VOIR, PAR CONSTRUCTION (vérifié absent
 * aujourd'hui, `grep -rn "\.\.\.COLONNES\|\.\.\.colonnes"` et
 * `grep -rEn "largeur: \`|largeur: [a-zA-Z]"` sur tout `apps/web/src` — zéro
 * résultat hors du fichier de test de `Tableau.tsx` lui-même) :
 *  - une `largeur` dont la VALEUR n'est pas un littéral `'NN%'` — un gabarit
 *    (`` `${x}%` ``) ou un appel de fonction ne matcherait jamais
 *    `largeur:\s*'([\d.]+)%'`, et n'apparaîtrait donc dans AUCUN compte : ni
 *    couvert, ni manquant. Le garde-fou de couverture ne le voit pas non
 *    plus, puisqu'il compte lui-même sur ce même motif littéral ;
 *  - une table composée par ÉTALEMENT de plusieurs tableaux de colonnes déjà
 *    valides (`colonnes={[...COLONNES_A, ...COLONNES_B]}`) : ce fichier
 *    verrait `COLONNES_A` et `COLONNES_B` comme deux blocs SÉPARÉS, chacun
 *    sommé individuellement — jamais la somme de la table RÉELLEMENT rendue
 *    une fois les deux combinées. Deux blocs à 100 % chacun, combinés,
 *    donneraient 200 % au navigateur sans que ce test s'en aperçoive.
 * Si l'un de ces motifs apparaît un jour, ce test devra être étendu — il ne
 * le fera pas de lui-même.
 *
 * SOUS 100 vs AU-DESSUS DE 100 — arbitrage volontairement asymétrique :
 * au-dessus de 100, `table-layout: fixed` RENORMALISE et rétrécit TOUTES les
 * colonnes en silence (le défaut réel de D-081) : échec DUR. En dessous de
 * 100, le navigateur ne renormalise rien — il laisse l'espace restant inutilisé,
 * ce qui ne casse rien visuellement mais peut trahir une colonne oubliée :
 * signalé par un `console.warn` nommant le fichier et la somme, MAIS SANS
 * faire échouer le test. Un test trop strict qui échoue pour une raison
 * bénigne se fait désactiver au premier agacement (mission de ce fichier) —
 * hors périmètre de ce que ce défaut-ci exige.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Ce fichier vit dans `apps/api/src` : trois niveaux plus haut, la racine du dépôt. */
const RACINE_DEPOT = resolve(import.meta.dirname, '..', '..', '..');
const DOSSIER_WEB_SRC = resolve(RACINE_DEPOT, 'apps', 'web', 'src');

/** Tolérance de comparaison flottante — les largeurs de ce dépôt sont des entiers, mais rien ne l'impose. */
const EPSILON = 0.01;

type BlocColonnes = {
  readonly fichier: string;
  /** Ligne (1-based) où s'ouvre le tableau — celle qui se termine par `[`. */
  readonly ligneOuverture: number;
  readonly somme: number;
  readonly valeurs: readonly number[];
};

type EcartCouverture = {
  readonly fichier: string;
  readonly totalDansLeFichier: number;
  readonly totalCouvertParLesBlocs: number;
};

type ResultatAudit = {
  readonly fichiersScannes: number;
  readonly blocs: readonly BlocColonnes[];
  readonly ecartsCouverture: readonly EcartCouverture[];
};

/** Liste récursive des fichiers `.ts`/`.tsx` d'un dossier, hors `node_modules`/`dist`. */
function listerFichiersSource(dossier: string): string[] {
  let entrees: string[];
  try {
    entrees = readdirSync(dossier);
  } catch {
    return [];
  }
  const resultats: string[] = [];
  for (const entree of entrees) {
    if (entree === 'node_modules' || entree === 'dist') continue;
    const chemin = join(dossier, entree);
    const info = statSync(chemin);
    if (info.isDirectory()) {
      resultats.push(...listerFichiersSource(chemin));
    } else if (entree.endsWith('.ts') || entree.endsWith('.tsx')) {
      resultats.push(chemin);
    }
  }
  return resultats;
}

/** Une ligne « ouvre un tableau multi-lignes » quand, une fois les espaces de fin retirés, elle se termine par `[`. */
function ligneOuvreUnTableau(ligne: string): boolean {
  return ligne.trimEnd().endsWith('[');
}

/**
 * Cherche, à partir de `depart` (inclus), la première ligne qui ouvre un
 * tableau, dans une fenêtre bornée. Bornée délibérément : au-delà, mieux vaut
 * échouer bruyamment ("forme non reconnue") que risquer d'attraper l'ouverture
 * d'un tableau sans rapport plus loin dans le fichier.
 */
function trouverProchaineOuverture(
  lignes: readonly string[],
  depart: number,
  fenetre: number,
): number {
  const limite = Math.min(lignes.length, depart + fenetre);
  for (let i = depart; i < limite; i++) {
    if (ligneOuvreUnTableau(lignes[i] ?? '')) return i;
  }
  return -1;
}

/**
 * Trouve la ligne de fermeture d'un tableau ouvert à `indexOuverture`, avec
 * l'indentation `indentation` (voir le commentaire d'en-tête : hypothèse
 * Prettier). Renvoie -1 si aucune ligne ne correspond avant la fin du fichier,
 * OU si l'indentation redescend sans que la ligne commence par `]` (une
 * structure inattendue — échec, jamais une fermeture devinée).
 */
function trouverLigneFermeture(
  lignes: readonly string[],
  indexOuverture: number,
  indentation: number,
): number {
  for (let i = indexOuverture + 1; i < lignes.length; i++) {
    const ligne = lignes[i] ?? '';
    const sansIndentation = ligne.replace(/^[ \t]*/, '');
    if (sansIndentation.length === 0) continue; // ligne vide : ignorer, ne compte pas comme un niveau.
    const indentationLigne = ligne.length - sansIndentation.length;
    if (indentationLigne <= indentation) {
      return sansIndentation.startsWith(']') ? i : -1;
    }
  }
  return -1;
}

/**
 * Construit un `BlocColonnes` à partir de sa ligne d'ouverture, ou lève une
 * erreur nommant le fichier et la ligne si la forme n'est pas reconnue —
 * jamais un bloc ignoré en silence.
 */
function construireBloc(
  lignes: readonly string[],
  indexOuverture: number,
  cheminRelatif: string,
): BlocColonnes {
  const ligneOuverture = lignes[indexOuverture] ?? '';
  const sansIndentation = ligneOuverture.replace(/^[ \t]*/, '');
  const indentation = ligneOuverture.length - sansIndentation.length;

  const indexFermeture = trouverLigneFermeture(lignes, indexOuverture, indentation);
  if (indexFermeture === -1) {
    throw new Error(
      `${cheminRelatif}:${indexOuverture + 1} — impossible de trouver la ligne de fermeture de ce tableau ` +
        `par indentation (attendu : une ligne à l'indentation ${indentation} commençant par ']'). ` +
        `Forme non reconnue par ce test — à vérifier à la main plutôt que de deviner.`,
    );
  }

  const texteBloc = lignes.slice(indexOuverture, indexFermeture + 1).join('\n');

  // Fingerprint de contenu : un vrai bloc de colonnes contient toujours ces
  // deux clés (`alignement`, `rendu`). Absentes : la détection a probablement
  // attrapé un tableau sans rapport — échec plutôt qu'un faux résultat
  // silencieux.
  if (!texteBloc.includes('alignement:') || !texteBloc.includes('rendu:')) {
    throw new Error(
      `${cheminRelatif}:${indexOuverture + 1} — bloc détecté sans structure de colonne reconnaissable ` +
        `(ni 'alignement:' ni 'rendu:' à l'intérieur). Détection probablement fausse — à vérifier à la main.`,
    );
  }

  const valeurs: number[] = [];
  const motifLargeur = /largeur:\s*'([\d.]+)%'/g;
  let correspondance: RegExpExecArray | null;
  while ((correspondance = motifLargeur.exec(texteBloc)) !== null) {
    valeurs.push(Number.parseFloat(correspondance[1] ?? '0'));
  }

  return {
    fichier: cheminRelatif,
    ligneOuverture: indexOuverture + 1,
    somme: valeurs.reduce((total, v) => total + v, 0),
    valeurs,
  };
}

/**
 * Extrait tous les blocs de colonnes d'un fichier, via deux déclencheurs
 * indépendants :
 *  A) toute mention de `ColonneTableau` hors d'une ligne `import` — couvre les
 *     formes 1 à 3 de l'en-tête, quel que soit le nombre de lignes que le
 *     générique occupe avant l'ouverture réelle du tableau ;
 *  B) `colonnes={[` littéral — couvre la forme 4 (inline, sans annotation).
 * Dédupliquées par ligne d'ouverture : les deux déclencheurs ne peuvent pas se
 * chevaucher sur ce dépôt (B n'a jamais de mention `ColonneTableau` à
 * proximité, une propriété du code plutôt qu'une garantie inhérente), mais
 * dédupliquer coûte rien et protège d'un double-comptage si ça change.
 */
function extraireBlocsDuFichier(texte: string, cheminRelatif: string): BlocColonnes[] {
  const lignes = texte.split('\n');
  const blocs: BlocColonnes[] = [];
  const lignesOuvertureVues = new Set<number>();

  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i] ?? '';

    const debutLigne = ligne.trimStart();
    const estLigneImport = debutLigne.startsWith('import');
    if (!estLigneImport && ligne.includes('ColonneTableau')) {
      // Toute mention de `ColonneTableau` n'ouvre pas un tableau : la
      // déclaration du TYPE lui-même (`Tableau.tsx`, `export type
      // ColonneTableau<Ligne> = {`) et une signature de PROPS
      // (`colonnes: ReadonlyArray<ColonneTableau<Ligne>>;`) le mentionnent
      // aussi, sans jamais être suivies d'un `[`. Plutôt que d'énumérer ces
      // formes à la main (la faute exacte de D-045), on ne DÉCLENCHE PAS
      // d'erreur quand aucune ouverture n'est trouvée à proximité : cette
      // mention est alors traitée comme une simple référence de type. Le
      // filet de sécurité est ailleurs — le test de COUVERTURE, plus bas :
      // si une vraie définition de colonnes était ratée ici, son
      // `largeur:` resterait hors de tout bloc détecté et ce test-là
      // échouerait, en la nommant.
      const indexOuverture = trouverProchaineOuverture(lignes, i, 20);
      if (indexOuverture !== -1 && !lignesOuvertureVues.has(indexOuverture)) {
        lignesOuvertureVues.add(indexOuverture);
        blocs.push(construireBloc(lignes, indexOuverture, cheminRelatif));
      }
    }

    if (/colonnes=\{\s*\[\s*$/.test(ligne.trimEnd()) && !lignesOuvertureVues.has(i)) {
      lignesOuvertureVues.add(i);
      blocs.push(construireBloc(lignes, i, cheminRelatif));
    }
  }

  return blocs;
}

function auditerLargeursColonnes(): ResultatAudit {
  const tousLesFichiers = listerFichiersSource(DOSSIER_WEB_SRC).filter(
    (f) => !/\.test\.tsx?$/.test(f),
  );

  const blocs: BlocColonnes[] = [];
  const ecartsCouverture: EcartCouverture[] = [];

  for (const cheminAbsolu of tousLesFichiers) {
    const cheminRelatif = relative(RACINE_DEPOT, cheminAbsolu).split(sep).join('/');
    const texte = readFileSync(cheminAbsolu, 'utf8');

    const blocsFichier = extraireBlocsDuFichier(texte, cheminRelatif);
    blocs.push(...blocsFichier);

    // `\s*'` après `largeur:` : distingue une vraie VALEUR de colonne
    // (`largeur: '13%'`) de la déclaration du CHAMP dans le type lui-même
    // (`Tableau.tsx`, `largeur: string;`) — cette dernière ne peut
    // structurellement jamais se trouver dans un bloc, ce n'est pas une
    // fuite de couverture.
    const totalDansLeFichier = (texte.match(/largeur:\s*'/g) ?? []).length;
    const totalCouvertParLesBlocs = blocsFichier.reduce((total, b) => total + b.valeurs.length, 0);
    if (totalDansLeFichier !== totalCouvertParLesBlocs) {
      ecartsCouverture.push({
        fichier: cheminRelatif,
        totalDansLeFichier,
        totalCouvertParLesBlocs,
      });
    }
  }

  return { fichiersScannes: tousLesFichiers.length, blocs, ecartsCouverture };
}

// Le scan tourne UNE FOIS, au chargement du fichier — jamais une seconde fois
// par test, et surtout jamais silencieusement absent d'un test qui l'utilise :
// toute erreur de lecture est capturée ici et relevée par CHAQUE test via
// `resultatOuEchec()`, avec le même message précis (fichier + ligne) plutôt
// qu'un « undefined » sans rapport avec la cause réelle.
let resultat: ResultatAudit | undefined;
let erreurScan: Error | undefined;
try {
  resultat = auditerLargeursColonnes();
} catch (erreur) {
  erreurScan = erreur instanceof Error ? erreur : new Error(String(erreur));
}

function resultatOuEchec(): ResultatAudit {
  if (erreurScan !== undefined) throw erreurScan;
  if (resultat === undefined) throw new Error('Audit des largeurs de colonnes non exécuté.');
  return resultat;
}

describe('D-081 — la somme des `largeur` de chaque définition de colonnes doit faire 100', () => {
  it("le scan n'est pas vacuellement vide : il voit réellement des fichiers et des définitions de colonnes", () => {
    // Un test dérivé qui balaierait silencieusement zéro fichier passerait
    // quand même — exactement le défaut D-045 (« passe par absence ») que ce
    // test existe pour ne pas reproduire une seconde fois.
    const audit = resultatOuEchec();
    console.log(
      `[D-081] ${audit.fichiersScannes} fichiers .ts/.tsx examinés sous apps/web/src (hors *.test.*) — ` +
        `${audit.blocs.length} définitions de colonnes détectées.`,
    );
    expect(audit.fichiersScannes).toBeGreaterThan(20);
    expect(audit.blocs.length).toBeGreaterThan(40);
  });

  it("couverture totale : chaque occurrence de `largeur: '...'` du fichier source est comptée dans un bloc détecté", () => {
    const audit = resultatOuEchec();
    const details = audit.ecartsCouverture.map(
      (e) =>
        `${e.fichier} : ${e.totalDansLeFichier} occurrence(s) de 'largeur:' dans le fichier, ` +
        `${e.totalCouvertParLesBlocs} comptée(s) dans les blocs détectés — ` +
        `${e.totalDansLeFichier - e.totalCouvertParLesBlocs} échappent à ce test.`,
    );
    expect(details).toEqual([]);
  });

  it('aucune somme ne DÉPASSE 100 (le défaut D-081 : renormalisation invisible du navigateur)', () => {
    const audit = resultatOuEchec();

    // Sous 100 : ne casse rien avec `table-layout: fixed` (le navigateur
    // laisse l'espace inutilisé, il ne renormalise que si la somme DÉPASSE
    // 100) — mais peut trahir une colonne oubliée. Signalé, jamais bloquant :
    // voir le commentaire d'en-tête de ce fichier pour la justification
    // complète de cette asymétrie.
    for (const bloc of audit.blocs) {
      if (bloc.somme < 100 - EPSILON) {
        console.warn(
          `[D-081][sous 100, toléré] ${bloc.fichier}:${bloc.ligneOuverture} — somme = ${bloc.somme}% ` +
            `(colonnes : ${bloc.valeurs.join(' + ')}).`,
        );
      }
    }

    const depassements = audit.blocs
      .filter((bloc) => bloc.somme > 100 + EPSILON)
      .map(
        (bloc) =>
          `${bloc.fichier}:${bloc.ligneOuverture} — somme = ${bloc.somme}% (colonnes : ${bloc.valeurs.join(' + ')})`,
      );
    // Chaque dépassement nommé individuellement (pas seulement dans le tableau
    // que `toEqual` compare) : un diff vitest peut tronquer l'affichage, ce
    // `console.error` ne tronque jamais.
    for (const ligne of depassements) console.error(`[D-081][DÉPASSEMENT] ${ligne}`);
    expect(depassements).toEqual([]);
  });
});
