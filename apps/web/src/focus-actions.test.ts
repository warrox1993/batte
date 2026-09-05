/**
 * Garde D-079 (complément du 31/07/2026) — le `disabled` natif qui DÉTRUIT le
 * focus de l'utilisateur au clavier.
 *
 * ═══ LE DÉFAUT QUE CE FICHIER EXISTE POUR EMPÊCHER ═══
 *
 * Le produit a lui-même écrit pourquoi c'est faux, dans `composants/
 * BoutonDocument.tsx` : « Un `<button disabled>` qui a le focus le PERD au
 * moment où il se désactive : le focus retombe sur `<body>`, et l'utilisateur au
 * clavier se retrouve nulle part au milieu de son geste. » Le navigateur lâche
 * l'élément de lui-même, AVANT tout rendu React — aucun sous-arbre n'est
 * démonté, le nœud devient seulement inéligible. Le remède de la première
 * moitié de D-079 (ne pas repasser par `'chargement'`) ne peut donc rien y
 * faire.
 *
 * Le remède est éprouvé au même endroit : `aria-disabled` conserve le focus et
 * annonce l'indisponibilité ; l'inertie RÉELLE vient d'un garde-fou en tête du
 * gestionnaire (`if (verrou.current) return;`), pas de l'attribut.
 *
 * ═══ POURQUOI UNE GARDE, ET PAS UN BALAYAGE ═══
 *
 * Corriger les emplacements est le travail d'autres missions : ils vivent dans
 * les zones d'écriture d'autres agents. Ce fichier ne corrige rien. Il rend le
 * défaut IMPOSSIBLE À AJOUTER SANS LE VOIR — et il le fait en DÉRIVANT la liste
 * du code source, jamais en l'énumérant à la main : ce dépôt a déjà payé
 * plusieurs fois une liste manuscrite qui prétendait prouver une absence
 * (D-045, docs/39 §2).
 *
 * ═══ POURQUOI CE FICHIER VIT SOUS `apps/web/src` ET NE LIT PAS `node:fs` ═══
 *
 * `apps/api/src/tableau-largeurs-colonnes.test.ts` — la garde dont ce fichier
 * reprend la forme — a dû s'exiler sous `apps/api` parce qu'un fichier de
 * `apps/web/src` qui importe `node:fs` casse la garde de confinement de
 * CLAUDE.md §2 (`apps/api/src/securite-secrets.test.ts`, « aucun fichier du
 * front n'importe un module qui parle aux secrets »), laquelle interdit cet
 * import à TOUT fichier sous `apps/web/src`, tests compris. C'est cette même
 * garde qui empêche la clé Anthropic d'atteindre le navigateur : on ne la
 * contourne pas.
 *
 * Ce fichier reste donc sous `apps/web/src` et lit les sources par
 * `import.meta.glob(..., { query: '?raw' })` — la primitive de VITE, résolue à
 * la transformation, qui n'ouvre aucun descripteur de fichier à l'exécution et
 * n'introduit donc aucune capacité nouvelle dans le front. Vérifié avant
 * d'écrire ce fichier : le glob rend **119** fichiers, exactement le compte de
 * `find apps/web/src -name '*.ts' -o -name '*.tsx'`. La dérivation est bien
 * celle du système de fichiers, pas une liste.
 *
 * ═══ CE QUI EST DÉRIVÉ, ET CE QUI EST ÉCRIT À LA MAIN ═══
 *
 * DÉRIVÉ (rien de tout cela n'est énuméré) : la liste des fichiers, la liste
 * des `disabled` natifs, l'expression complète de chacun (par équilibrage
 * d'accolades, pas par `grep` — le dépôt en a plusieurs sur trois lignes), et
 * le découpage de cette expression en termes.
 *
 * ÉCRIT À LA MAIN, et assumé : le **lexique** qui dit si un terme parle d'une
 * ACTION EN VOL ou d'une SAISIE. C'est un vocabulaire d'états, pas une liste de
 * sites — la distinction est exactement celle que D-045 exige : on n'énumère
 * jamais les emplacements, on décrit le motif et on laisse la machine trouver
 * les emplacements. Et surtout : **un terme qui ne correspond à AUCUN des deux
 * lexiques fait ÉCHOUER le test** (`termes non classés`), il n'est jamais rangé
 * en silence du côté légitime. C'est ce qui empêche un vocabulaire neuf de
 * passer sans être vu.
 *
 * ═══ CE QUE CETTE GARDE NE PEUT PAS VOIR, PAR CONSTRUCTION ═══
 *
 *  - Un `disabled` posé par un COMPOSANT INTERMÉDIAIRE (`<MonBouton
 *    inactif={enCours}>` qui pose `disabled` en interne) : le site compté est
 *    alors celui du composant, pas les appelants. C'est le piège des composants
 *    partagés de docs/39 §2 (68 emplacements comptés là où il y en avait 90).
 *    Vérifié absent aujourd'hui — les 25 fichiers touchés posent tous
 *    `disabled` directement sur un `<button>`/`<input>` — mais rien ne garantit
 *    que ça le reste.
 *  - Un nouveau vocabulaire d'action en vol qui aurait la FORME d'un terme de
 *    saisie (par exemple `etatX.statut === 'traitement'`, littéral inconnu du
 *    lexique en vol mais reconnu par le motif « statut d'un objet du
 *    domaine »). Le risque est réel et il est la contrepartie assumée du
 *    lexique. Il est borné : les motifs de saisie sont écrits aussi étroits que
 *    possible, et le lexique EN VOL est prioritaire — un terme qui parle des
 *    deux est compté fautif.
 *  - Ce que fait le GESTIONNAIRE. Cette garde compte des attributs ; elle ne
 *    prouve pas qu'un bouton passé en `aria-disabled` a bien reçu son garde-fou
 *    d'inertie. Un `aria-disabled` sans garde-fou est un bouton qui reste
 *    cliquable — un défaut différent, et pire (D-026 : un double-clic ARCHIVE
 *    DEUX VERSIONS). Ça se prouve au montage, pas ici.
 */

import { describe, expect, it } from 'vitest';

/* ═══════════════════════════════════════════════════════════════════════════
   1. Lecture des sources — dérivée du système de fichiers par Vite
   ═══════════════════════════════════════════════════════════════════════════ */

const SOURCES_BRUTES = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Les tests ne sont pas le produit : un `disabled` dans une fixture ne dérange
 * personne au clavier. Ce filtre exclut aussi CE fichier, qui contient le mot
 * `disabled` dans ses motifs — sans quoi la garde se compterait elle-même.
 */
const SOURCES: ReadonlyArray<readonly [string, string]> = Object.entries(SOURCES_BRUTES)
  .filter(([chemin]) => !/\.test\.tsx?$/.test(chemin))
  .map(([chemin, texte]) => [chemin.replace(/^\.\//, ''), texte] as const)
  .sort(([a], [b]) => a.localeCompare(b));

/* ═══════════════════════════════════════════════════════════════════════════
   2. Extraction : trouver chaque `disabled` natif et son expression ENTIÈRE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Remplace le contenu des commentaires par des espaces, en gardant les sauts de
 * ligne — les numéros de ligne restent donc exacts.
 *
 * Indispensable, et pas théorique : `composants/BoutonDocument.tsx` explique le
 * défaut dans son en-tête avec les mots « Un `<button disabled>` qui a le focus
 * le PERD ». Sans ce masquage, la garde compterait sa propre documentation
 * comme un défaut — un faux positif dans le fichier même qui montre le remède.
 */
function masquerCommentaires(texte: string): string {
  let resultat = '';
  let i = 0;
  while (i < texte.length) {
    if (texte.startsWith('/*', i)) {
      const fin = texte.indexOf('*/', i + 2);
      const bloc = texte.slice(i, fin === -1 ? texte.length : fin + 2);
      resultat += bloc.replace(/[^\n]/g, ' ');
      i += bloc.length;
    } else if (texte.startsWith('//', i)) {
      const fin = texte.indexOf('\n', i);
      const bloc = texte.slice(i, fin === -1 ? texte.length : fin);
      resultat += bloc.replace(/[^\n]/g, ' ');
      i += bloc.length;
    } else {
      resultat += texte[i];
      i += 1;
    }
  }
  return resultat;
}

/**
 * Bloc `{…}` ouvert à `debut`, par équilibrage : son contenu ET la position de
 * l'accolade fermante. `null` si le bloc n'est jamais refermé.
 *
 * L'équilibrage est NAÏF — il ne connaît ni les chaînes ni les littéraux
 * d'expression régulière. Ce n'est pas une négligence, c'est un choix mesuré :
 * un compteur d'accolades conscient des chaînes a été essayé d'abord et s'est
 * DÉSYNCHRONISÉ sur tout ce dépôt, parce que les apostrophes du texte français
 * dans le JSX (`l'utilisateur`) se lisent comme des ouvertures de chaîne. Sur
 * un fichier entier, il ne refermait plus rien. Appliqué à un CORPS DE
 * FONCTION court — le seul usage qui en est fait ici — le compteur naïf est
 * exact, parce qu'aucune de ces fonctions ne contient d'accolade à l'intérieur
 * d'une chaîne. Les deux gardes de ce fichier ne s'en servent que sur des
 * portées de cette taille, et une accolade jamais refermée FAIT ÉCHOUER le
 * test au lieu d'être devinée.
 */
function blocEquilibre(texte: string, debut: number): { texte: string; fin: number } | null {
  let profondeur = 0;
  for (let i = debut; i < texte.length; i++) {
    const caractere = texte[i];
    if (caractere === '{') profondeur += 1;
    else if (caractere === '}') {
      profondeur -= 1;
      if (profondeur === 0) return { texte: texte.slice(debut + 1, i), fin: i };
    }
  }
  return null;
}

/** Contenu d'une accolade JSX ouverte à `debut`, par équilibrage. `null` si non refermée. */
function contenuAccolade(texte: string, debut: number): string | null {
  return blocEquilibre(texte, debut)?.texte ?? null;
}

export type SiteDisabled = {
  readonly fichier: string;
  readonly ligne: number;
  readonly expression: string;
};

/**
 * Le motif ne reconnaît `disabled` que précédé d'un blanc ou d'une accolade :
 * `aria-disabled` (précédé d'un `-`) et les classes Tailwind `disabled:opacity`
 * (suivies d'un `:`) sont donc exclues par construction, sans exception écrite.
 */
const MOTIF_DISABLED = /(^|[\s{])disabled(\s*=\s*\{|[\s/>])/g;

/** Marqueur d'un `<button disabled>` sans expression : désactivation CONSTANTE. */
export const PRESENCE_NUE = 'présence-nue';

export function extraireSites(texte: string, fichier: string): SiteDisabled[] {
  const masque = masquerCommentaires(texte);
  const sites: SiteDisabled[] = [];
  const motif = new RegExp(MOTIF_DISABLED.source, 'g');
  let correspondance: RegExpExecArray | null;

  while ((correspondance = motif.exec(masque)) !== null) {
    const ligne = masque.slice(0, correspondance.index).split('\n').length;
    let expression: string;
    if (correspondance[2]?.includes('{') === true) {
      const ouverture = correspondance.index + correspondance[0].length - 1;
      const contenu = contenuAccolade(masque, ouverture);
      if (contenu === null) {
        throw new Error(
          `${fichier}:${ligne} — accolade de \`disabled={\` jamais refermée. ` +
            `Forme non reconnue par cette garde : à vérifier à la main plutôt qu'à deviner.`,
        );
      }
      expression = contenu.replace(/\s+/g, ' ').trim();
    } else {
      expression = PRESENCE_NUE;
    }
    sites.push({ fichier, ligne, expression });
  }
  return sites;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Découpage en termes, puis classement
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Découpe une expression sur ses `||` et `&&` de PREMIER niveau.
 *
 * Pourquoi terme par terme et non sur l'expression entière : les cas MIXTES
 * (`lieuActuel === null || etatRecherche.statut === 'recherche'`) sont fautifs
 * — il suffit que le terme « en vol » bascule pendant que le bouton a le focus
 * pour que le navigateur le lâche. Le terme de saisie ne rachète rien. Classer
 * l'expression entière d'un bloc rendrait ces cas indécidables ; les découper
 * les tranche sans jugement au cas par cas.
 */
export function decouperEnTermes(expression: string): string[] {
  const termes: string[] = [];
  let profondeur = 0;
  let debut = 0;
  for (let i = 0; i < expression.length; i++) {
    const caractere = expression[i];
    if (caractere === '(' || caractere === '[') profondeur += 1;
    else if (caractere === ')' || caractere === ']') profondeur -= 1;
    else if (
      profondeur === 0 &&
      (expression.startsWith('||', i) || expression.startsWith('&&', i))
    ) {
      termes.push(expression.slice(debut, i));
      i += 1;
      debut = i + 1;
    }
  }
  termes.push(expression.slice(debut));
  return termes
    .map((terme) =>
      terme
        .trim()
        .replace(/^\((.*)\)$/, '$1')
        .trim(),
    )
    .filter((t) => t !== '');
}

/**
 * Vocabulaire des états d'ACTION EN VOL de ce dépôt.
 *
 * Un terme qui en relève bascule **parce que l'utilisateur vient d'activer le
 * bouton** : c'est le cas fautif, celui où le nœud qui perd `disabled` est
 * précisément celui qui avait le focus. Chaque entrée est un motif de
 * VOCABULAIRE, jamais un emplacement.
 */
const MOTIFS_ACTION_EN_VOL: ReadonlyArray<readonly [RegExp, string]> = [
  // `enCours`, `envoiEnCours`, `enCoursId === p.id` — le drapeau booléen ou
  // l'identifiant de la ligne en cours de traitement.
  [/[Ee]nCours/, 'drapeau « en cours »'],
  // Les littéraux de phase des machines à états d'action de ce dépôt.
  [/===\s*'en_cours'/, "phase 'en_cours'"],
  [/===\s*'enregistrement'/, "phase 'enregistrement'"],
  [/===\s*'envoi'/, "phase 'envoi'"],
  [/===\s*'recherche'/, "phase 'recherche'"],
  // `'chargement'` déclenché PAR le bouton (RegistreAfsca, remontée de
  // traçabilité) : le bouton se désactive le temps de l'aller-retour qu'il a
  // lui-même lancé. Même mécanique, même perte de focus.
  [/===\s*'chargement'/, "phase 'chargement'"],
  // `disabled={envoi}` — le drapeau nu, sans comparaison (`Recettes.tsx`).
  [/^!?envoi$/, 'drapeau « envoi » nu'],
];

/**
 * Vocabulaire des désactivations LÉGITIMES : l'expression dépend de la SAISIE
 * ou de la donnée persistée, pas d'une action en vol. Le bouton n'était pas
 * focalisable au moment où il s'est désactivé, donc rien n'est arraché.
 *
 * Volontairement étroits : tout ce qui n'entre ni ici ni au-dessus fait
 * ÉCHOUER la garde, plutôt que d'être absous par défaut.
 */
const MOTIFS_SAISIE: ReadonlyArray<readonly [RegExp, string]> = [
  // Champ texte vide — `x === ''`, `x.trim() === ''`.
  [/===\s*''$/, 'champ non rempli'],
  // Rien de sélectionné.
  [/===\s*null$/, 'rien de sélectionné'],
  // Négation d'un prédicat de validité de la saisie : `!peutEnregistrer`,
  // `!confirmationVerrouillageActivable(...)`. Le lexique EN VOL étant
  // prioritaire, `!enCours` reste fautif.
  [/^!/, 'prédicat de validité nié'],
  // Statut PERSISTÉ d'un objet du domaine (`recetteActive.statut ===
  // 'archivee'`) : il ne bouge pas parce qu'on clique. Les littéraux de phase
  // d'action sont interceptés plus haut, par priorité.
  [/\.statut\s*===\s*'[a-z_]+'$/, 'statut persisté du domaine'],
  // Comparaison entre deux valeurs de l'écran : `statutChoisi ===
  // detailCourant.statut` (« la valeur choisie est déjà celle enregistrée »).
  [/^[\w.]+\s*===\s*[\w.]+$/, "comparaison entre deux valeurs de l'écran"],
  // `<button disabled>` constant : ne bascule jamais, donc n'arrache jamais
  // rien.
  [/^présence-nue$/, 'désactivation constante'],
];

export type Classement = 'action-en-vol' | 'saisie' | 'inconnue';

/** Le lexique EN VOL est prioritaire : un terme mixte est FAUTIF. */
export function classerTerme(terme: string): Classement {
  for (const [motif] of MOTIFS_ACTION_EN_VOL) if (motif.test(terme)) return 'action-en-vol';
  for (const [motif] of MOTIFS_SAISIE) if (motif.test(terme)) return 'saisie';
  return 'inconnue';
}

/** Une expression est fautive dès qu'UN de ses termes parle d'une action en vol. */
export function classerExpression(expression: string): Classement {
  const classements = decouperEnTermes(expression).map(classerTerme);
  if (classements.includes('action-en-vol')) return 'action-en-vol';
  if (classements.includes('inconnue')) return 'inconnue';
  return 'saisie';
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. Le CLIQUET
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Compte, PAR FICHIER, des `disabled` natifs d'action en vol constatés le
 * 01/08/2026 — 59 au total, dans 25 fichiers.
 *
 * ═══ POURQUOI UN CLIQUET ET PAS UNE EXIGENCE DE ZÉRO ═══
 *
 * Ces 59 emplacements sont réels et fautifs. Exiger zéro aujourd'hui rendrait
 * cette garde ROUGE EN PERMANENCE — et une garde rouge en permanence ne se lit
 * plus, elle se désactive au premier agacement. Le cliquet la rend verte sur
 * l'existant et rouge sur toute AGGRAVATION : c'est le seul réglage qui la
 * laisse vivre pendant les mois où le solde se fait.
 *
 * ═══ POURQUOI PAR FICHIER, ET PAS UN TOTAL ═══
 *
 * Un total unique se ferait masquer : cinq écrans sont édités en parallèle au
 * moment où ce cliquet est posé. Dix conversions dans un fichier compenseraient
 * silencieusement un ajout fautif dans un autre. Un compte par fichier ne se
 * compense pas. Des COMPTES et non des numéros de ligne : les lignes bougent à
 * chaque édition, les comptes non.
 *
 * ═══ CE QU'IL FAUT FAIRE POUR LE DESCENDRE ═══
 *
 * Par emplacement, le remède est celui de `composants/BoutonDocument.tsx` :
 * remplacer `disabled={X}` par `aria-disabled={X}`, ajouter `aria-busy` quand
 * l'attente est réelle, et **poser le garde-fou d'inertie en tête du
 * gestionnaire** (`if (verrou.current) return;`) — sans quoi le bouton reste
 * cliquable et un double-clic archive deux versions (D-026). Puis décrémenter
 * la ligne ci-dessous, et la SUPPRIMER quand elle tombe à zéro. Un cliquet se
 * solde, il ne s'étend pas — c'est la règle déjà appliquée au cliquet
 * `exhaustive-deps` d'`eslint.config.js`, soldé le 28/07/2026.
 *
 * Quand un compte descend sous sa valeur ici, le test le SIGNALE (`console.warn`)
 * sans échouer : le travail est fait, il ne reste qu'à écrire le nouveau
 * chiffre.
 */
const CLIQUET: Readonly<Record<string, number>> = {
  'pages/Achats.tsx': 4,
  'pages/Comptabilite.tsx': 6,
  'pages/Concurrents.tsx': 3,
  'pages/Economies.tsx': 2,
  'pages/Equipements.tsx': 1,
  'pages/Evenements.tsx': 1,
  'pages/Factures.tsx': 4,
  'pages/Fournisseurs.tsx': 1,
  'pages/Ingredients.tsx': 2,
  'pages/LieuxMarche.tsx': 1,
  'pages/Menus.tsx': 1,
  'pages/NomenclatureVente.tsx': 1,
  'pages/Objectifs.tsx': 2,
  'pages/Opportunites.tsx': 3,
  'pages/Parametres.tsx': 2,
  'pages/Production.tsx': 1,
  'pages/Produits.tsx': 1,
  'pages/PropositionsEvenements.tsx': 7,
  'pages/Recettes.tsx': 2,
  'pages/RegistreAfsca.tsx': 5,
  'pages/Sessions.tsx': 4,
  'saisie-stock/BlocAnnulation.tsx': 1,
  'saisie-stock/DetailLot.tsx': 2,
  'saisie-stock/SaisieReception.tsx': 1,
  'saisie-stock/SaisieSortie.tsx': 1,
};

export type EcartCliquet = {
  readonly hausses: readonly string[];
  readonly baisses: readonly string[];
};

/**
 * Compare le constat au cliquet. Fonction PURE, testée sur fixtures plus bas :
 * la comparaison est la seule chose qu'un défaut de la garde elle-même pourrait
 * rendre silencieusement permissive.
 */
export function comparerAuCliquet(
  constate: Readonly<Record<string, number>>,
  cliquet: Readonly<Record<string, number>>,
  // Les DEUX gardes de ce fichier comparent au cliquet de la même façon, mais
  // ne comptent pas la même chose. Sans ce libellé, la seconde annonçait ses
  // écarts en parlant de `disabled` — un message qui envoie chercher le défaut
  // au mauvais endroit est pire qu'un message absent.
  libelle = "`disabled` d'action en vol",
): EcartCliquet {
  const hausses: string[] = [];
  const baisses: string[] = [];
  for (const [fichier, compte] of Object.entries(constate)) {
    const autorise = cliquet[fichier] ?? 0;
    if (compte > autorise) {
      hausses.push(
        `${fichier} : ${compte} ${libelle}, cliquet à ${autorise}` +
          (cliquet[fichier] === undefined ? ' (fichier absent du cliquet)' : ''),
      );
    }
  }
  for (const [fichier, autorise] of Object.entries(cliquet)) {
    const compte = constate[fichier] ?? 0;
    if (compte < autorise) baisses.push(`${fichier} : ${compte} constaté, cliquet à ${autorise}`);
  }
  return { hausses: hausses.sort(), baisses: baisses.sort() };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Le balayage, exécuté UNE fois
   ═══════════════════════════════════════════════════════════════════════════ */

type Audit = {
  readonly fichiersScannes: number;
  readonly sites: readonly SiteDisabled[];
  readonly nonClasses: readonly string[];
  readonly comptesParFichier: Readonly<Record<string, number>>;
};

function auditer(): Audit {
  const sites: SiteDisabled[] = [];
  const nonClasses: string[] = [];
  const comptesParFichier: Record<string, number> = {};

  for (const [fichier, texte] of SOURCES) {
    for (const site of extraireSites(texte, fichier)) {
      sites.push(site);
      for (const terme of decouperEnTermes(site.expression)) {
        if (classerTerme(terme) === 'inconnue') {
          nonClasses.push(`${site.fichier}:${site.ligne} — terme non classé : \`${terme}\``);
        }
      }
      if (classerExpression(site.expression) === 'action-en-vol') {
        comptesParFichier[fichier] = (comptesParFichier[fichier] ?? 0) + 1;
      }
    }
  }
  return { fichiersScannes: SOURCES.length, sites, nonClasses, comptesParFichier };
}

let audit: Audit | undefined;
let erreurBalayage: Error | undefined;
try {
  audit = auditer();
} catch (erreur) {
  erreurBalayage = erreur instanceof Error ? erreur : new Error(String(erreur));
}

function auditOuEchec(): Audit {
  if (erreurBalayage !== undefined) throw erreurBalayage;
  if (audit === undefined) throw new Error('Balayage des `disabled` non exécuté.');
  return audit;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. Les tests
   ═══════════════════════════════════════════════════════════════════════════ */

describe('D-079 — le classement des `disabled`, prouvé sur des cas fabriqués', () => {
  // Ces cas-là ne dépendent d'aucun fichier du dépôt : ils prouvent que le
  // classeur DISCRIMINE. Sans eux, un classeur qui rendrait toujours 'saisie'
  // laisserait les tests suivants verts par aveuglement (docs/39 §3).
  it('reconnaît les formes d’ACTION EN VOL', () => {
    for (const expression of [
      'enCours',
      'envoiEnCours',
      'enCoursId === p.id',
      "etatGeneration.statut === 'en_cours'",
      "enregistrement.phase === 'enregistrement'",
      "enregistrement === 'enregistrement'",
      "envoi.statut === 'envoi'",
      'envoi',
      "etatRecherche.statut === 'recherche'",
      "etatAmont.statut === 'chargement'",
    ]) {
      expect(classerExpression(expression), expression).toBe('action-en-vol');
    }
  });

  it('reconnaît les formes de SAISIE', () => {
    for (const expression of [
      '!peutEnregistrer',
      '!confirmationVerrouillageActivable( a, b, c, )',
      "emailSaisi.trim() === ''",
      "dateExecution === ''",
      'lieuActuel === null',
      "recetteActive.statut === 'archivee'",
      'statutChoisi === detailCourant.statut',
      PRESENCE_NUE,
    ]) {
      expect(classerExpression(expression), expression).toBe('saisie');
    }
  });

  it('déclare FAUTIF un cas MIXTE — le terme de saisie ne rachète pas le terme en vol', () => {
    // C'est le point qui rend le tri automatique possible : il suffit que le
    // terme en vol bascule pendant que le bouton a le focus.
    expect(classerExpression("lieuActuel === null || etatRecherche.statut === 'recherche'")).toBe(
      'action-en-vol',
    );
    expect(
      classerExpression("motifAnnulation.trim() === '' || etatAnnulation.statut === 'en_cours'"),
    ).toBe('action-en-vol');
  });

  it('refuse de trancher un vocabulaire INCONNU plutôt que de l’absoudre', () => {
    // Le garde-fou de la garde. Un classeur qui rendrait 'saisie' par défaut
    // laisserait entrer tout vocabulaire neuf sans un mot.
    expect(classerExpression('etatMachin.phase === "vocabulaire-jamais-vu"')).toBe('inconnue');
    expect(classerExpression("etatX.statut === 'en_cours' || truc.bidule('?')")).toBe(
      'action-en-vol',
    );
  });

  it('découpe les expressions sur plusieurs lignes et respecte les parenthèses', () => {
    expect(decouperEnTermes("a === '' || b.statut === 'en_cours'")).toEqual([
      "a === ''",
      "b.statut === 'en_cours'",
    ]);
    // Un `||` À L'INTÉRIEUR d'un appel ne doit pas couper le terme en deux.
    expect(decouperEnTermes('!f(a || b) && c')).toEqual(['!f(a || b)', 'c']);
  });

  it('ne compte NI `aria-disabled` NI les classes Tailwind `disabled:`', () => {
    const source = [
      '<button aria-disabled={enCours} className="disabled:opacity-50">x</button>',
      '<button disabled={enCours}>y</button>',
    ].join('\n');
    const sites = extraireSites(source, 'fictif.tsx');
    expect(sites).toHaveLength(1);
    expect(sites[0]?.ligne).toBe(2);
  });

  it('ne compte pas un `disabled` cité dans un COMMENTAIRE', () => {
    // `composants/BoutonDocument.tsx` documente le défaut avec ces mots-là.
    const source = ['/* Un `<button disabled>` qui a le focus le PERD. */', 'const x = 1;'].join(
      '\n',
    );
    expect(extraireSites(source, 'fictif.tsx')).toEqual([]);
  });

  it('lit une expression étalée sur plusieurs lignes ENTIÈRE, pas sa première ligne', () => {
    const source = [
      '<button',
      '  disabled={',
      "    a === '' ||",
      "    b.statut === 'en_cours'",
      '  }',
      '/>',
    ].join('\n');
    const sites = extraireSites(source, 'fictif.tsx');
    expect(sites).toHaveLength(1);
    expect(classerExpression(sites[0]?.expression ?? '')).toBe('action-en-vol');
  });

  it('le cliquet voit une HAUSSE, y compris dans un fichier qu’il ne connaît pas', () => {
    expect(comparerAuCliquet({ 'a.tsx': 3 }, { 'a.tsx': 2 }).hausses).toHaveLength(1);
    expect(comparerAuCliquet({ 'neuf.tsx': 1 }, { 'a.tsx': 2 }).hausses[0]).toContain(
      'absent du cliquet',
    );
    // Le libellé suit l'appelant : les deux gardes de ce fichier ne comptent pas
    // la même chose et ne doivent pas envoyer chercher au même endroit.
    expect(comparerAuCliquet({ 'a.tsx': 1 }, {}, 'fermeture(s) sans rappel').hausses[0]).toContain(
      'fermeture(s) sans rappel',
    );
    expect(comparerAuCliquet({ 'a.tsx': 2 }, { 'a.tsx': 2 }).hausses).toEqual([]);
    expect(comparerAuCliquet({ 'a.tsx': 1 }, { 'a.tsx': 2 }).baisses).toHaveLength(1);
  });
});

describe('D-079 — la garde, appliquée au dépôt', () => {
  it("le balayage n'est pas vacuellement vide", () => {
    // Une garde dérivée qui balaierait zéro fichier passerait quand même :
    // c'est le « vert par absence » de docs/39 §1.
    const resultat = auditOuEchec();
    const enVol = Object.values(resultat.comptesParFichier).reduce((t, n) => t + n, 0);
    console.log(
      `[D-079] ${resultat.fichiersScannes} fichiers .ts/.tsx examinés sous apps/web/src ` +
        `(hors *.test.*) — ${resultat.sites.length} \`disabled\` natifs, dont ${enVol} d'action en vol.`,
    );
    expect(resultat.fichiersScannes).toBeGreaterThan(40);
    expect(resultat.sites.length).toBeGreaterThan(30);
  });

  it('chaque terme d’un `disabled` est classé — aucun vocabulaire neuf absous en silence', () => {
    const resultat = auditOuEchec();
    for (const ligne of resultat.nonClasses) console.error(`[D-079][NON CLASSÉ] ${ligne}`);
    expect(
      resultat.nonClasses,
      'Terme(s) de `disabled` que le lexique de cette garde ne reconnaît pas. Décidez à la main : ' +
        "vocabulaire d'ACTION EN VOL (→ ajouter au lexique, corriger le bouton en `aria-disabled`) " +
        'ou de SAISIE (→ ajouter au lexique). Ne jamais élargir un motif de saisie pour faire taire ce test.',
    ).toEqual([]);
  });

  it('CLIQUET : aucun `disabled` d’action en vol de PLUS qu’au 01/08/2026', () => {
    const resultat = auditOuEchec();
    const { hausses, baisses } = comparerAuCliquet(resultat.comptesParFichier, CLIQUET);

    // Une baisse est un PROGRÈS : signalée, jamais bloquante. Cinq écrans sont
    // édités en parallèle ; un test qui échouerait sur une amélioration serait
    // désactivé avant d'avoir servi.
    for (const ligne of baisses) {
      console.warn(
        `[D-079][cliquet à descendre] ${ligne} — corrigé depuis : mettez le cliquet à jour.`,
      );
    }
    for (const ligne of hausses) console.error(`[D-079][AGGRAVATION] ${ligne}`);

    expect(
      hausses,
      'Un `disabled` natif a été ajouté sur un bouton dont l’expression bascule PARCE QUE ' +
        'l’utilisateur vient de l’activer. Le navigateur lâchera le focus sur `<body>` au milieu ' +
        'de son geste (CLAUDE.md §3 règle 10). Remède : `aria-disabled` + garde-fou d’inertie ' +
        'dans le gestionnaire — voir `composants/BoutonDocument.tsx`.',
    ).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. Garde n°2 — LA FERMETURE DE PANNEAU QUI NE RAPPELLE PAS LE FOCUS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ═══ LE DÉFAUT QUE CETTE SECONDE GARDE EXISTE POUR EMPÊCHER ═══
 *
 * Un panneau de détail s'ouvre depuis une rangée de tableau. Quand il se
 * referme — bouton « Fermer » ou Échap — tout ce qui avait le focus À
 * L'INTÉRIEUR de lui est démonté, et le navigateur rend le focus à `<body>` :
 * les flèches ne font plus rien, la tabulation suivante repart du tout début du
 * document, et c'est l'instant précis où l'utilisateur reprend la souris — ce
 * que CLAUDE.md §3 règle 10 existe pour interdire.
 *
 * Le remède est éprouvé plusieurs fois dans ce dépôt (`fermerDetailIngredient`
 * et `fermerDetailLot` dans `pages/Stock.tsx`, `fermerDetailProduction` dans
 * `pages/Production.tsx`, `fermerDetail` dans `pages/JournalAudit.tsx`,
 * `fermerDetailCommande` dans `pages/Achats.tsx`) : interroger
 * `tr[aria-selected="true"]` AVANT l'écriture d'état, puis rendre le focus au
 * nœud capturé. Aucune `ref` de rangée n'est nécessaire — c'est précisément la
 * prémisse fausse qui a laissé vivre la quatrième instance, dont le commentaire
 * affirmait que la ligne « n'expose aucune ref de rangée à reutiliser ».
 *
 * ═══ POURQUOI UNE GARDE DÉRIVÉE, ET PAS UN COMPOSANT PARTAGÉ ═══
 *
 * L'extraction d'un composant ou d'un `hook` commun a été examinée et écartée :
 * l'auteur de la quatrième instance CONNAISSAIT les autres écrans — son
 * commentaire les citait — et a quand même visé une cible pire. Une abstraction
 * n'empêche pas d'écrire autre chose à côté d'elle. Et un tel `hook` toucherait
 * le DOM et des `setState`, donc ne serait prouvable que par les tests montés
 * par écran QUI EXISTENT DÉJÀ : l'extraction n'achèterait aucune preuve neuve.
 *
 * Une garde dérivée, elle, rend le défaut IMPOSSIBLE À AJOUTER SANS LE VOIR.
 * C'est l'instrument déjà éprouvé de ce fichier pour le `disabled` natif.
 *
 * ═══ CE QUI EST RÉELLEMENT DÉRIVABLE — ET CE QUI NE L'EST PAS ═══
 *
 * La question posée avant d'écrire une ligne était : « un `setX(null)` suivi
 * d'un `.focus()` sur autre chose que la rangée d'origine est-il reconnaissable
 * mécaniquement ? »
 *
 * NON, PAS SOUS CETTE FORME. Trois motifs ont été essayés et écartés :
 *
 *  1. « tout `set…Selectionne…(null)` sans `.focus()` ». Faux positifs
 *     immédiats et légitimes : les quatre gestionnaires de filtre de
 *     `pages/JournalAudit.tsx` remettent la sélection à `null` sur un
 *     `onChange` — le `<select>` qui a déclenché le changement garde le focus,
 *     il n'y a rien à rappeler. Idem pour la bascule de rangée
 *     (`selectionnerIngredient`, `pages/Stock.tsx`) : le focus est déjà SUR la
 *     rangée. Une garde qui rougit là finit désactivée.
 *  2. « la présence d'un `.focus()` dans le gestionnaire ». C'est le motif qui
 *     aurait laissé passer la quatrième instance : `pages/Achats.tsx` APPELAIT
 *     bien `.focus()` — sur un bouton d'un autre panneau. Un `.focus()` présent
 *     ne dit rien de sa cible.
 *  3. « l'état effacé pilote-t-il une grille ? » seul. Vrai des filtres de
 *     `JournalAudit` comme des fermetures : ne discrimine pas.
 *
 * CE QUI EST DÉRIVABLE, et que cette garde implémente, est plus étroit et
 * entièrement mécanique. Trois faits, chacun lu dans la source :
 *
 *  A. LE GESTE. Deux formes, et deux seulement, dans lesquelles l'élément qui
 *     détient le focus est GARANTI d'être à l'intérieur du panneau qui
 *     disparaît :
 *       - la branche Échap — le corps de la fonction nommée qui contient le
 *         littéral `'Escape'`. Vérifié : les dix-sept occurrences de ce
 *         littéral dans le code de production vivent toutes dans une fonction
 *         `function nom(…)`, et une occurrence qui n'y vivrait pas FAIT
 *         ÉCHOUER cette garde au lieu d'être ignorée ;
 *       - le bouton « Fermer » — l'expression de son `onClick`. Ce bouton-là
 *         se démonte AVEC le panneau, donc son propre focus est perdu à coup
 *         sûr.
 *     Un appel de fonction locale sans argument est REMPLACÉ PAR SON CORPS
 *     (deux niveaux) : sans quoi `onClick={fermerDetailProduction}` serait
 *     illisible, et c'est la forme même du remède.
 *
 *  B. LE PANNEAU EST OUVERT DEPUIS UNE RANGÉE. Dérivé, jamais énuméré : les
 *     états passés en `ligneSelectionneeCle` à `composants/Tableau.tsx` sont
 *     EXACTEMENT ceux qui posent `aria-selected` sur une rangée. Leur setteur
 *     est lu dans la destructuration `useState` du même fichier. Un état de
 *     sélection sans paire `useState` trouvable fait ÉCHOUER la garde. C'est ce
 *     fait B qui écarte les faux positifs du motif 1 : un panneau ouvert par un
 *     BOUTON (`sortieOuverte`, `creationDepenseOuverte`, `saisieOuverte`) rend
 *     légitimement le focus à ce bouton, et n'est pas compté ici.
 *
 *  C. LA FORME DU REMÈDE. Pas « un `.focus()` quelconque » — motif 2 ci-dessus
 *     — mais la LIAISON : un `const <nom> = …aria-selected…;` suivi d'un
 *     `<nom>.focus(`. Le nom capturé et le nom refocalisé doivent être le même.
 *     C'est ce qui distingue le remède d'un `.focus()` visant ailleurs.
 *
 * ═══ CE QUE CETTE GARDE NE PEUT PAS VOIR, PAR CONSTRUCTION ═══
 *
 *  - LE COMPOSANT INTERMÉDIAIRE. `saisie-stock/DetailLot.tsx` porte un bouton
 *    « Fermer » dont l'effacement de sélection vit chez son appelant, via une
 *    prop. Le fichier n'ayant aucun `ligneSelectionneeCle`, le geste n'est pas
 *    compté. Même piège que pour les `disabled` (docs/39 §2 : 68 emplacements
 *    comptés là où il y en avait 90).
 *  - UN AUTRE VOCABULAIRE DE FERMETURE. Un bouton « Retour », « × » ou
 *    « Masquer le détail » n'est pas vu. Le libellé « Fermer » est la
 *    convention tenue par tous les boutons de fermeture du produit ; s'en
 *    écarter contournerait la garde en silence. C'est la contrepartie assumée
 *    du choix A, exactement comme le lexique de la première garde.
 *  - LA CIBLE RÉELLE DU `.focus()` À L'EXÉCUTION. Le fait C prouve que le nœud
 *    capturé est celui qu'on refocalise DANS LE TEXTE. Il ne prouve pas qu'il
 *    portait bien `aria-selected` au moment de la capture, ni qu'il est encore
 *    focalisable. Ça se prouve au montage, écran par écran — c'est le rôle des
 *    tests jsdom, pas de celui-ci.
 *  - L'ORDRE capture / écriture d'état n'est PAS vérifié. Il relève de
 *    l'hygiène et non de la correction : React n'applique pas le `setState`
 *    d'un gestionnaire avant la fin de celui-ci, donc `aria-selected` est
 *    encore posé juste après l'appel. Le cas qui casse VRAIMENT — capturer
 *    DANS le `requestAnimationFrame`, une fois le rendu passé — est attrapé
 *    autrement : il n'y a alors pas de liaison `const`, donc pas de fait C.
 */

/** Identifiants de ce dépôt : ni `$` ni caractère à échapper en expression régulière. */
const IDENTIFIANT = '[A-Za-z_][A-Za-z0-9_]*';

/**
 * Taille maximale d'un corps admis comme GESTIONNAIRE d'Échap.
 *
 * ═══ Pourquoi ce garde-fou existe, et ce qu'il rattrape ═══
 *
 * La région d'un geste « Échap » est le corps de la fonction NOMMÉE la plus
 * proche avant le littéral. Aujourd'hui c'est exact : les seize occurrences du
 * code de production vivent toutes dans un `function surAppuiTouche(…)` /
 * `function surEchap(…)` déclaré juste au-dessus. Mais si quelqu'un écrivait un
 * jour son écouteur en fonction FLÉCHÉE, la fonction nommée la plus proche
 * deviendrait LE COMPOSANT D'ÉCRAN LUI-MÊME. La région engloberait alors tous
 * les autres gestionnaires du fichier, dont probablement un qui capture bien sa
 * rangée — et la garde ABSOUDRAIT le geste fautif par contamination.
 *
 * ═══ Le chiffre, et d'où il vient ═══
 *
 * Mesuré le 02/08/2026 sur tout `apps/web/src` : le plus gros gestionnaire
 * d'Échap réel fait 1 357 caractères (`pages/Comptabilite.tsx`, cinq branches),
 * et le corps MÉDIAN d'un composant d'écran en fait 22 963. Les deux
 * populations sont séparées d'un facteur 17. 4 000 se place à trois fois le
 * plus gros gestionnaire observé et cinq fois sous le composant médian.
 *
 * Franchir ce seuil ne fait rien passer en silence : ça produit une ANOMALIE,
 * donc un test rouge et une décision humaine. C'est la seule direction d'échec
 * acceptable pour une garde (docs/39 §3).
 */
const TAILLE_MAX_GESTIONNAIRE = 4000;

/**
 * Corps de la fonction NOMMÉE la plus proche avant `position`, à condition
 * qu'elle contienne réellement `position`. `null` sinon — et l'appelant en fait
 * une anomalie bloquante, jamais un silence.
 */
export function corpsDeLaFonctionEnglobante(texte: string, position: number): string | null {
  const motif = new RegExp(`\\bfunction\\s+${IDENTIFIANT}\\s*\\(`, 'g');
  let dernier: RegExpExecArray | null = null;
  let courant: RegExpExecArray | null;
  while ((courant = motif.exec(texte)) !== null) {
    if (courant.index >= position) break;
    dernier = courant;
  }
  if (dernier === null) return null;
  const ouverture = texte.indexOf('{', dernier.index + dernier[0].length);
  if (ouverture === -1) return null;
  const bloc = blocEquilibre(texte, ouverture);
  if (bloc === null) return null;
  return ouverture < position && position < bloc.fin ? bloc.texte : null;
}

/**
 * SETTEURS des états qui pilotent `aria-selected` sur une rangée. Entièrement
 * dérivés : `ligneSelectionneeCle` — le seul chemin par lequel
 * `composants/Tableau.tsx` pose l'attribut — puis la destructuration `useState`
 * correspondante.
 *
 * `manquants` porte les états dont le setteur n'a pas pu être lu. Ils ne sont
 * jamais rangés en silence du côté inoffensif : ils font échouer la garde.
 */
export function setteursDeSelectionDeRangee(texte: string): {
  readonly setteurs: readonly string[];
  readonly manquants: readonly string[];
} {
  const etats = new Set<string>();
  for (const m of texte.matchAll(
    new RegExp(`ligneSelectionneeCle\\s*:\\s*(${IDENTIFIANT})`, 'g'),
  )) {
    if (m[1] !== undefined) etats.add(m[1]);
  }
  for (const m of texte.matchAll(
    new RegExp(`ligneSelectionneeCle\\s*=\\s*\\{\\s*(${IDENTIFIANT})\\s*\\}`, 'g'),
  )) {
    if (m[1] !== undefined) etats.add(m[1]);
  }
  const setteurs: string[] = [];
  const manquants: string[] = [];
  for (const etat of etats) {
    const paire = new RegExp(`\\[\\s*${etat}\\s*,\\s*(${IDENTIFIANT})\\s*\\]`).exec(texte);
    if (paire?.[1] === undefined) manquants.push(etat);
    else setteurs.push(paire[1]);
  }
  return { setteurs: setteurs.sort(), manquants: manquants.sort() };
}

/** Corps d'une fonction locale nommée `nom` (déclaration, ou `const nom = …`). */
function corpsDeFonctionLocale(texte: string, nom: string): string | null {
  const debut = new RegExp(`(?:function\\s+${nom}\\s*[(<]|const\\s+${nom}\\s*[:=])`).exec(texte);
  if (debut === null) return null;
  const ouverture = texte.indexOf('{', debut.index);
  if (ouverture === -1) return null;
  const bloc = blocEquilibre(texte, ouverture);
  // Un corps démesuré signale que l'accolade trouvée n'était pas celle d'une
  // fonction (`useRef<X>(null)` n'en a aucune) : mieux vaut ne rien inliner que
  // d'inliner la moitié du fichier et d'absoudre un geste par accident.
  if (bloc === null || bloc.texte.length > 8000) return null;
  return bloc.texte;
}

/**
 * Remplace les appels de fonctions locales SANS ARGUMENT par leur corps, sur
 * deux niveaux. `onClick={fermerDetailProduction}` — l'identifiant nu — est
 * traité de la même façon : c'est la forme même du remède.
 */
export function inlinerAppelsLocaux(
  texte: string,
  region: string,
  niveaux = 2,
  vus: Set<string> = new Set(),
): string {
  if (niveaux === 0) return region;
  const noms = new Set<string>();
  for (const m of region.matchAll(new RegExp(`\\b(${IDENTIFIANT})\\s*\\(\\s*\\)`, 'g'))) {
    if (m[1] !== undefined) noms.add(m[1]);
  }
  const nu = region.trim();
  if (new RegExp(`^${IDENTIFIANT}$`).test(nu)) noms.add(nu);

  let sortie = region;
  for (const nom of noms) {
    if (vus.has(nom)) continue;
    vus.add(nom);
    const corps = corpsDeFonctionLocale(texte, nom);
    if (corps !== null) sortie += `\n${inlinerAppelsLocaux(texte, corps, niveaux - 1, vus)}`;
  }
  return sortie;
}

/**
 * FAIT C : la région capture-t-elle une rangée dans une liaison, et rend-elle le
 * focus À CETTE LIAISON ? Un `.focus()` sur autre chose ne compte pas — c'est
 * exactement ce qui a laissé passer la quatrième instance.
 */
export function rappelleLaRangee(region: string): boolean {
  const normalisee = region.replace(/\s+/g, ' ');
  const capture = new RegExp(`const\\s+(${IDENTIFIANT})\\s*=\\s*[^;]*aria-selected[^;]*;`).exec(
    normalisee,
  );
  const liaison = capture?.[1];
  if (liaison === undefined) return false;
  return new RegExp(`\\b${liaison}\\s*\\??\\.focus\\s*\\(`).test(normalisee);
}

export type GesteFermeture = {
  readonly fichier: string;
  readonly ligne: number;
  readonly forme: 'echap' | 'bouton-fermer';
  readonly rappelle: boolean;
};

export type AuditFermetures = {
  readonly gestes: readonly GesteFermeture[];
  readonly anomalies: readonly string[];
};

/** Les faits A, B et C appliqués à un fichier. */
export function auditerFermetures(texte: string, fichier: string): AuditFermetures {
  const masque = masquerCommentaires(texte);
  const ligneDe = (index: number): number => masque.slice(0, index).split('\n').length;

  const { setteurs, manquants } = setteursDeSelectionDeRangee(masque);
  const anomalies: string[] = manquants.map(
    (etat) =>
      `${fichier} — l'état de sélection \`${etat}\` (passé en \`ligneSelectionneeCle\`) n'a aucune ` +
      `paire \`useState\` lisible : son setteur n'est pas dérivable, la garde est donc aveugle à ce tableau.`,
  );

  const regions: { ligne: number; forme: GesteFermeture['forme']; texte: string }[] = [];

  // FAIT A, forme « Échap ».
  for (const m of masque.matchAll(/['"]Escape['"]/g)) {
    const ligne = ligneDe(m.index);
    const corps = corpsDeLaFonctionEnglobante(masque, m.index);
    if (corps === null) {
      anomalies.push(
        `${fichier}:${ligne} — le littéral « Escape » ne vit dans aucune fonction nommée. ` +
          `Forme inconnue de cette garde : à examiner à la main, jamais à absoudre par défaut.`,
      );
      continue;
    }
    if (corps.length > TAILLE_MAX_GESTIONNAIRE) {
      anomalies.push(
        `${fichier}:${ligne} — la fonction nommée qui contient « Escape » fait ${corps.length} ` +
          `caractères : c'est un composant, pas un gestionnaire. L'écouteur est probablement écrit ` +
          `en fonction fléchée. Cette garde lirait alors tout l'écran comme une seule région et ` +
          `absoudrait le geste par contamination — donnez un nom à l'écouteur.`,
      );
      continue;
    }
    regions.push({ ligne, forme: 'echap', texte: corps });
  }

  // FAIT A, forme « bouton Fermer ».
  for (const m of masque.matchAll(/>\s*Fermer[^<]*<\/button>/g)) {
    const ligne = ligneDe(m.index);
    const ouvrant = masque.lastIndexOf('<button', m.index);
    if (ouvrant === -1) {
      anomalies.push(`${fichier}:${ligne} — libellé « Fermer » sans \`<button\` ouvrant.`);
      continue;
    }
    const balise = masque.slice(ouvrant, m.index);
    const clic = balise.indexOf('onClick={');
    if (clic === -1) {
      anomalies.push(
        `${fichier}:${ligne} — bouton « Fermer » sans \`onClick\` : la garde ne peut pas dire ce qu'il ferme.`,
      );
      continue;
    }
    const expression = contenuAccolade(balise, clic + 'onClick='.length);
    if (expression === null) {
      anomalies.push(`${fichier}:${ligne} — \`onClick\` du bouton « Fermer » jamais refermé.`);
      continue;
    }
    regions.push({ ligne, forme: 'bouton-fermer', texte: expression });
  }

  const gestes: GesteFermeture[] = [];
  for (const region of regions) {
    const complete = inlinerAppelsLocaux(masque, region.texte);
    // FAIT B : ce geste efface-t-il une sélection DE RANGÉE ?
    if (!setteurs.some((setteur) => complete.includes(`${setteur}(null)`))) continue;
    gestes.push({
      fichier,
      ligne: region.ligne,
      forme: region.forme,
      rappelle: rappelleLaRangee(complete),
    });
  }

  return { gestes: gestes.sort((a, b) => a.ligne - b.ligne), anomalies };
}

/**
 * Constat du 02/08/2026 : ONZE fermetures de panneau de rangée ne rappellent
 * pas le focus, dans QUATRE fichiers. HUIT autres le font correctement —
 * `pages/Achats.tsx`, `pages/JournalAudit.tsx`, `pages/Production.tsx` et
 * `pages/Stock.tsx`, deux gestes chacun.
 *
 * C'est cette coexistence qui rend le cliquet lisible : la garde n'est ni
 * « tout rouge » ni « tout vert », elle sépare deux populations réelles,
 * vérifiées à la main une par une le jour où elle a été posée.
 *
 * Même règle que le cliquet des `disabled` ci-dessus : PAR FICHIER (plusieurs
 * écrans sont édités en parallèle, un total unique se ferait compenser), en
 * COMPTES et non en numéros de ligne, à décrémenter au fur et à mesure et à
 * SUPPRIMER quand la ligne tombe à zéro. Un cliquet se solde, il ne s'étend pas.
 *
 * Le remède, par emplacement, est celui de `fermerDetailCommande`
 * (`pages/Achats.tsx`) : capturer `tr[aria-selected="true"]` dans le conteneur
 * du tableau AVANT l'écriture d'état, puis rendre le focus au nœud capturé dans
 * un `requestAnimationFrame`, avec repli sur le conteneur.
 */
const CLIQUET_FERMETURES: Readonly<Record<string, number>> = {
  'pages/Comptabilite.tsx': 2,
  'pages/Factures.tsx': 2,
  'pages/RegistreAfsca.tsx': 4,
  'pages/Sessions.tsx': 3,
};

type AuditGlobalFermetures = {
  readonly gestes: readonly GesteFermeture[];
  readonly anomalies: readonly string[];
  readonly comptesParFichier: Readonly<Record<string, number>>;
};

function auditerToutesLesFermetures(): AuditGlobalFermetures {
  const gestes: GesteFermeture[] = [];
  const anomalies: string[] = [];
  const comptesParFichier: Record<string, number> = {};

  for (const [fichier, texte] of SOURCES) {
    const audit = auditerFermetures(texte, fichier);
    gestes.push(...audit.gestes);
    anomalies.push(...audit.anomalies);
    for (const geste of audit.gestes) {
      if (!geste.rappelle) comptesParFichier[fichier] = (comptesParFichier[fichier] ?? 0) + 1;
    }
  }
  return { gestes, anomalies, comptesParFichier };
}

let auditFermetures: AuditGlobalFermetures | undefined;
let erreurFermetures: Error | undefined;
try {
  auditFermetures = auditerToutesLesFermetures();
} catch (erreur) {
  erreurFermetures = erreur instanceof Error ? erreur : new Error(String(erreur));
}

function auditFermeturesOuEchec(): AuditGlobalFermetures {
  if (erreurFermetures !== undefined) throw erreurFermetures;
  if (auditFermetures === undefined) throw new Error('Balayage des fermetures non exécuté.');
  return auditFermetures;
}

/* ── Les cas fabriqués : ils prouvent que le classeur DISCRIMINE ─────────── */

const REMEDE_CAPTURE = [
  '  const fermerTruc = useCallback((): void => {',
  '    const rangeeCourante =',
  '      conteneur.current?.querySelector<HTMLElement>(\'tr[aria-selected="true"]\') ?? null;',
  '    setTruc(null);',
  '    requestAnimationFrame(() => rangeeCourante?.focus());',
  '  }, []);',
].join('\n');

const REMEDE_FABRIQUE = [
  'export default function Ecran() {',
  '  const [truc, setTruc] = useState<string | null>(null);',
  '  const conteneur = useRef<HTMLDivElement>(null);',
  REMEDE_CAPTURE,
  '  useEffect(() => {',
  '    function surAppuiTouche(evenement: KeyboardEvent): void {',
  "      if (evenement.key === 'Escape') fermerTruc();",
  '    }',
  '  });',
  '  return (',
  '    <Tableau {...(truc !== null ? { ligneSelectionneeCle: truc } : {})} />',
  '    <button type="button" onClick={fermerTruc}>',
  '      Fermer',
  '    </button>',
  '  );',
  '}',
].join('\n');

describe('D-079 — le classement des FERMETURES, prouvé sur des cas fabriqués', () => {
  it('dérive le setteur de sélection depuis `ligneSelectionneeCle`, puis `useState`', () => {
    const { setteurs, manquants } = setteursDeSelectionDeRangee(REMEDE_FABRIQUE);
    expect(setteurs).toEqual(['setTruc']);
    expect(manquants).toEqual([]);
  });

  it('signale un état de sélection dont le setteur est INTROUVABLE, au lieu de l’ignorer', () => {
    const sansUseState = REMEDE_FABRIQUE.replace(
      '  const [truc, setTruc] = useState<string | null>(null);',
      '  const truc = useContexteQuelconque();',
    );
    expect(setteursDeSelectionDeRangee(sansUseState).manquants).toEqual(['truc']);
  });

  it('reconnaît le REMÈDE sur les deux formes de geste — Échap et bouton « Fermer »', () => {
    const { gestes, anomalies } = auditerFermetures(REMEDE_FABRIQUE, 'fictif.tsx');
    expect(anomalies).toEqual([]);
    expect(gestes.map((g) => g.forme).sort()).toEqual(['bouton-fermer', 'echap']);
    expect(gestes.every((g) => g.rappelle)).toBe(true);
  });

  it('déclare FAUTIVE la TÉLÉPORTATION — un `.focus()` est bien là, mais pas sur la rangée', () => {
    // Le point qui rend cette garde utile : un motif qui se contenterait de
    // chercher un `.focus()` serait resté VERT sur la quatrième instance.
    const teleportation = REMEDE_FABRIQUE.replace(
      REMEDE_CAPTURE,
      [
        '  const fermerTruc = useCallback((): void => {',
        '    setTruc(null);',
        '    boutonGenererCommandes.current?.focus();',
        '  }, []);',
      ].join('\n'),
    );
    const { gestes } = auditerFermetures(teleportation, 'fictif.tsx');
    expect(gestes).toHaveLength(2);
    expect(gestes.some((g) => g.rappelle)).toBe(false);
  });

  it('déclare FAUTIVE une capture faite APRÈS le rendu, dans le `requestAnimationFrame`', () => {
    // Là, `aria-selected` a déjà disparu : la requête ne rend plus rien. Aucune
    // liaison `const` n'existe, donc le fait C manque.
    const dansLeFrame = REMEDE_FABRIQUE.replace(
      REMEDE_CAPTURE,
      [
        '  const fermerTruc = useCallback((): void => {',
        '    setTruc(null);',
        '    requestAnimationFrame(() =>',
        '      conteneur.current?.querySelector<HTMLElement>(\'tr[aria-selected="true"]\')?.focus(),',
        '    );',
        '  }, []);',
      ].join('\n'),
    );
    expect(auditerFermetures(dansLeFrame, 'fictif.tsx').gestes.some((g) => g.rappelle)).toBe(false);
  });

  it('NE COMPTE PAS un effacement de sélection hors geste de fermeture (filtre)', () => {
    // Le faux positif qui aurait fait désactiver cette garde : le `<select>`
    // qui a déclenché le changement garde le focus, il n'y a rien à rappeler.
    const filtre = [
      'export default function Ecran() {',
      '  const [truc, setTruc] = useState<string | null>(null);',
      '  return (',
      '    <>',
      '      <select onChange={(e) => { setTable(e.target.value); setTruc(null); }} />',
      '      <Tableau {...(truc !== null ? { ligneSelectionneeCle: truc } : {})} />',
      '    </>',
      '  );',
      '}',
    ].join('\n');
    expect(auditerFermetures(filtre, 'fictif.tsx').gestes).toEqual([]);
  });

  it('NE COMPTE PAS la fermeture d’un panneau ouvert par un BOUTON, qui rend le focus à ce bouton', () => {
    const panneauDeBouton = [
      'export default function Ecran() {',
      '  const [saisieOuverte, setSaisieOuverte] = useState(false);',
      '  const [truc, setTruc] = useState<string | null>(null);',
      '  useEffect(() => {',
      '    function surAppuiTouche(evenement: KeyboardEvent): void {',
      "      if (evenement.key !== 'Escape') return;",
      '      setSaisieOuverte(false);',
      '      boutonBascule.current?.focus();',
      '    }',
      '  });',
      '  return <Tableau {...(truc !== null ? { ligneSelectionneeCle: truc } : {})} />;',
      '}',
    ].join('\n');
    expect(auditerFermetures(panneauDeBouton, 'fictif.tsx').gestes).toEqual([]);
  });

  it('SIGNALE un « Escape » qui ne vit dans aucune fonction nommée, au lieu de le sauter', () => {
    const auPremierNiveau = [
      'const [truc, setTruc] = useState<string | null>(null);',
      "window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTruc(null); });",
      'const grille = <Tableau {...(truc !== null ? { ligneSelectionneeCle: truc } : {})} />;',
    ].join('\n');
    const { anomalies } = auditerFermetures(auPremierNiveau, 'fictif.tsx');
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toContain('aucune fonction nommée');
  });

  it('SIGNALE un « Escape » dont la fonction englobante est un COMPOSANT, pas un gestionnaire', () => {
    // Le cas qui absoudrait par contamination : un écouteur en fonction fléchée
    // fait remonter la région jusqu'au composant entier, lequel contient
    // fatalement une capture de rangée venue d'un AUTRE gestionnaire.
    const remplissage = Array.from(
      { length: 300 },
      (_, i) => `  const variableDeRemplissage${i} = ${i};`,
    ).join('\n');
    const composantGeant = [
      'export default function Ecran() {',
      '  const [truc, setTruc] = useState<string | null>(null);',
      REMEDE_CAPTURE,
      remplissage,
      '  useEffect(() => {',
      "    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTruc(null); });",
      '  });',
      '  return <Tableau {...(truc !== null ? { ligneSelectionneeCle: truc } : {})} />;',
      '}',
    ].join('\n');
    const { anomalies } = auditerFermetures(composantGeant, 'fictif.tsx');
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toContain("c'est un composant, pas un gestionnaire");
  });

  it('remplace un appel local sans argument par son corps, sur deux niveaux d’appel', () => {
    const source = [
      'function a(): void { b(); }',
      'function b(): void { const marqueur = 1; }',
      'function c(): void { a(); }',
    ].join('\n');
    // `a()` -> corps de `a` (niveau 1) -> corps de `b` (niveau 2).
    expect(inlinerAppelsLocaux(source, 'a();')).toContain('marqueur');
    // Un troisième niveau n'est PAS suivi : la profondeur est bornée
    // volontairement, et c'est assez — la forme réelle du dépôt est
    // `onClick={fermerX}` ou `if (…) fermerX();`, soit un seul saut.
    expect(inlinerAppelsLocaux(source, 'c();')).not.toContain('marqueur');
  });
});

describe('D-079 — la garde des fermetures, appliquée au dépôt', () => {
  it("le balayage n'est pas vacuellement vide, et il TROUVE les deux populations", () => {
    const resultat = auditFermeturesOuEchec();
    const rappelees = resultat.gestes.filter((g) => g.rappelle);
    console.log(
      `[D-079/fermetures] ${resultat.gestes.length} fermetures de panneau de rangée — ` +
        `${rappelees.length} rendent le focus à la rangée, ` +
        `${resultat.gestes.length - rappelees.length} non.`,
    );
    // Une garde qui ne verrait AUCUN geste serait verte par absence (docs/39
    // §1) ; une qui n'en verrait aucun de CORRECT ne prouverait pas qu'elle
    // sait reconnaître le remède sur du vrai code (docs/39 §3, forme 3).
    expect(resultat.gestes.length).toBeGreaterThanOrEqual(15);
    expect(rappelees.length).toBeGreaterThanOrEqual(6);
    expect(resultat.gestes.some((g) => g.forme === 'echap')).toBe(true);
    expect(resultat.gestes.some((g) => g.forme === 'bouton-fermer')).toBe(true);
  });

  it('aucune forme de fermeture que cette garde ne sache lire', () => {
    const resultat = auditFermeturesOuEchec();
    for (const ligne of resultat.anomalies) console.error(`[D-079/fermetures][ANOMALIE] ${ligne}`);
    expect(
      resultat.anomalies,
      'Forme(s) de fermeture ou d’état de sélection que cette garde ne reconnaît pas. Décidez à la ' +
        'main plutôt que d’élargir un motif pour faire taire ce test : un motif élargi absout, il ' +
        'ne prouve rien.',
    ).toEqual([]);
  });

  it('CLIQUET : aucune fermeture SANS rappel de focus de plus qu’au 02/08/2026', () => {
    const resultat = auditFermeturesOuEchec();
    const { hausses, baisses } = comparerAuCliquet(
      resultat.comptesParFichier,
      CLIQUET_FERMETURES,
      'fermeture(s) de panneau de rangée SANS rappel de focus',
    );

    for (const ligne of baisses) {
      console.warn(
        `[D-079/fermetures][cliquet à descendre] ${ligne} — corrigé depuis : mettez le cliquet à jour.`,
      );
    }
    for (const ligne of hausses) console.error(`[D-079/fermetures][AGGRAVATION] ${ligne}`);

    expect(
      hausses,
      'Un panneau ouvert depuis une rangée se referme (Échap ou bouton « Fermer ») sans rendre le ' +
        'focus à cette rangée. Au clavier, le focus part sur `<body>` — ou, à peine mieux, se ' +
        'téléporte dans un autre panneau, ce que `choisirRangeeDeRepli` ' +
        '(`composants/navigationGrille.ts`) écarte explicitement. Remède éprouvé : capturer ' +
        '`tr[aria-selected="true"]` AVANT l’écriture d’état, puis rendre le focus au nœud capturé ' +
        '— voir `fermerDetailCommande` (`pages/Achats.tsx`) ou `fermerDetailProduction` ' +
        '(`pages/Production.tsx`).',
    ).toEqual([]);
  });
});
