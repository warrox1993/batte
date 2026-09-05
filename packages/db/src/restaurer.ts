/**
 * `npm run db:restaurer` — remise en service d'une sauvegarde, en urgence.
 *
 * Constate le 01/08/2026 : `restaurer()` (`sauvegarde.ts`) existait, exportee
 * du baril, entierement testee — et n'etait appelee par AUCUN chemin
 * utilisable. Le jour ou la base est corrompue, le porteur avait des fichiers
 * `.sqlite` horodates dans `sauvegardes/` et aucun moyen de les remettre en
 * service : il aurait fallu copier un fichier a la main, au bon endroit, sans
 * savoir si le schema correspond a la version installee. Ce script est ce
 * moyen — le plus rapide a ecrire, et suffisant pour un usage d'urgence
 * guide.
 *
 * CE GESTE SE FAIT SOUS STRESS, UNE FOIS TOUS LES CINQ ANS, PAR QUELQU'UN QUI
 * VIENT DE PERDRE SES DONNEES. Chaque message ci-dessous est ecrit avec ca en
 * tete : dire QUOI FAIRE, jamais seulement que quelque chose est impossible.
 *
 * Quatre situations, dans l'ordre ou ce fichier les traite :
 *
 *  1. LANCE SANS ARGUMENT — plutot que d'echouer, liste les sauvegardes
 *     disponibles (nom, date, taille), la plus recente en premier, avec
 *     l'exemple de commande a lancer. Sous stress, savoir CE QUI EXISTE est
 *     plus utile qu'un message d'erreur.
 *  2. SAUVEGARDE INTROUVABLE — le nom donne n'existe ni tel quel ni dans le
 *     dossier de sauvegardes : la liste des sauvegardes reelles est
 *     reaffichee juste apres, pour que l'operateur puisse corriger sans
 *     relancer une commande a l'aveugle.
 *  3. SCHEMA ILLISIBLE (ou archive corrompue) — verifie AVANT de demander la
 *     confirmation qui ecrase la base (`diagnostiquerSauvegarde`, extrait de
 *     `restaurer()` par ce meme chantier) : inutile de faire retaper un nom de
 *     fichier a un operateur stresse pour une restauration qui echouerait de
 *     toute facon. Le message de refus vient de `diagnostiquerSauvegarde` et
 *     dit deja quoi faire (mettre a jour l'application, essayer une autre
 *     archive...).
 *  4. RESTAURATION REUSSIE — confirme ce qui a ete fait : chemin final,
 *     migration eventuelle, et l'etat REEL du cliche de securite pris avant
 *     l'ecrasement (voir l'avertissement sur `methode === 'copie_brute'`
 *     ci-dessous, le seul defaut de ce mecanisme qui puisse couter des
 *     donnees definitivement).
 *
 * CONFIRMATION — un `y/N` est trop peu pour une operation qui ecrase une base
 * comptable ET un registre AFSCA. Le geste demande de RETAPER LE NOM EXACT du
 * fichier choisi (pas un mot generique comme « oui ») : ca force l'operateur
 * a reconfirmer QUEL fichier il restaure, pas seulement QU'il veut restaurer
 * quelque chose — le meme principe que la recopie du mois affiche avant un
 * verrouillage comptable definitif (`apps/web/src/pages/Comptabilite.tsx`,
 * `texteConfirmationVerrouillagePeriode`), en plus leger : pas d'impact
 * chiffre a charger ici (aucune table metier n'a de sens a compter avant une
 * restauration, contrairement aux mouvements d'un mois comptable), mais l'etat
 * de la cible actuelle (date, taille) est affiche avant la question, pour que
 * l'operateur sache ce qu'il s'apprete a remplacer.
 *
 * CLICHE DE SECURITE — `restaurer()` en prend un de l'etat courant de la cible
 * AVANT de l'ecraser (voir `sauvegarde.ts`). Mais ce cliche peut lui-meme etre
 * une COPIE BRUTE (`methode: 'copie_brute'`) plutot qu'un instantane coherent,
 * et ce repli se declenche PRECISEMENT quand la cible est deja cassee — donc
 * au moment ou ce cliche est le DERNIER FILET du porteur. Ce script le dit
 * explicitement, jamais en silence : voir la branche `copie_brute` plus bas.
 *
 * TOUT L'AFFICHAGE PASSE PAR DES FONCTIONS INJECTEES (`ecrire`, `ecrireErreur`,
 * `demanderConfirmation`), jamais directement par `console.log`/`readline` en
 * dehors du point d'entree : c'est ce qui rend `executerRestauration`
 * testable par MUTATION (base temporaire, reponses simulees) sans jamais
 * toucher un vrai terminal ni la vraie base du porteur.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { formaterDateHeure } from '@batte/core';
import { config } from './config.js';
import { estModulePrincipal } from './module-principal.js';
import {
  diagnostiquerSauvegarde,
  restaurer as restaurerBase,
  type ResultatRestauration,
} from './sauvegarde.js';

const EXTENSION = '.sqlite';

export type SauvegardeDisponible = {
  readonly nom: string;
  readonly chemin: string;
  readonly tailleOctets: number;
  /** Instant (millisecondes epoch) servant au tri, la plus recente en tete. */
  readonly instantTri: number;
  /** Deja formatee pour l'affichage — voir `dateDepuisNom` ci-dessous. */
  readonly dateAffichage: string;
};

/**
 * Date lisible directement dans le NOM du fichier (`batte-20260728-1200.sqlite`
 * ou `avant-restauration-20260728-1200.sqlite`), sans repasser par un fuseau :
 * `horodatageFichier` (`@batte/core`) produit deja ces chiffres en heure
 * BELGE — les reformater tels quels est donc correct, une conversion de
 * fuseau supplementaire serait fausse plutot que redondante.
 */
function dateDepuisNom(nom: string): { instant: number; affichage: string } | null {
  const trouve = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(nom);
  if (trouve === null) return null;
  const [, aaaa, mm, jj, hh, min] = trouve;
  return {
    instant: Date.UTC(Number(aaaa), Number(mm) - 1, Number(jj), Number(hh), Number(min)),
    affichage: `${jj}/${mm}/${aaaa} ${hh}:${min}`,
  };
}

/** « 720 o », « 4,2 Ko », « 1,3 Mo » — presentation seule, aucune valeur metier. */
export function formaterTailleOctets(octets: number): string {
  const formateurNombre = (valeur: number): string =>
    new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 }).format(valeur);

  if (octets < 1024) return `${octets} o`;
  const ko = octets / 1024;
  if (ko < 1024) return `${formateurNombre(ko)} Ko`;
  return `${formateurNombre(ko / 1024)} Mo`;
}

/**
 * Sauvegardes presentes dans `dossier`, la plus RECENTE en tete. Tout fichier
 * `.sqlite` compte, pas seulement ceux qui suivent la convention `batte-` :
 * un cliche de securite (`avant-restauration-...`) ou une copie manuelle
 * deposee la par le porteur sont des candidats de restauration tout aussi
 * valables. Rend une liste vide si le dossier n'existe pas — jamais une
 * erreur, un dossier de sauvegardes absent n'est pas un defaut de ce script.
 */
export function listerSauvegardesDisponibles(dossier: string): readonly SauvegardeDisponible[] {
  if (!existsSync(dossier)) return [];

  const entrees: SauvegardeDisponible[] = [];
  for (const nom of readdirSync(dossier)) {
    if (!nom.endsWith(EXTENSION)) continue;
    const chemin = join(dossier, nom);
    const stats = statSync(chemin);
    if (!stats.isFile()) continue;

    const depuisNom = dateDepuisNom(nom);
    entrees.push({
      nom,
      chemin,
      tailleOctets: stats.size,
      instantTri: depuisNom?.instant ?? stats.mtime.getTime(),
      dateAffichage: depuisNom?.affichage ?? formaterDateHeure(stats.mtime),
    });
  }

  return entrees.sort((a, b) => b.instantTri - a.instantTri);
}

/**
 * Resout l'argument donne en ligne de commande vers un chemin de sauvegarde
 * existant : tel quel (chemin complet, cle USB, disque reseau) EN PRIORITE,
 * sinon a l'interieur du dossier de sauvegardes configure. Rend `null` si
 * aucun des deux n'existe — a l'appelant de dire quoi faire.
 */
export function resoudreCheminSauvegarde(argument: string, dossier: string): string | null {
  if (existsSync(argument)) return resolve(argument);
  const candidat = join(dossier, argument);
  if (existsSync(candidat)) return candidat;
  return null;
}

/**
 * Texte EXACT que l'operateur doit retaper pour confirmer — le nom du fichier
 * CHOISI, jamais un mot generique. Fonction dediee (comme
 * `texteConfirmationVerrouillagePeriode` dans `Comptabilite.tsx`) pour que le
 * texte attendu et le texte affiche a l'operateur ne puissent jamais diverger.
 */
export function texteConfirmationRestauration(nomSauvegarde: string): string {
  return nomSauvegarde;
}

function afficherListe(dossier: string, ecrire: (texte: string) => void): void {
  const sauvegardes = listerSauvegardesDisponibles(dossier);

  if (sauvegardes.length === 0) {
    ecrire(`Aucune sauvegarde trouvée dans ${dossier}.`);
    ecrire(
      'Si une sauvegarde existe ailleurs (clé USB, disque réseau, copie manuelle), relancez ' +
        'avec son chemin complet : npm run db:restaurer -- "chemin\\vers\\le\\fichier.sqlite"',
    );
    return;
  }

  ecrire(`Sauvegardes disponibles dans ${dossier} (la plus récente en premier) :`);
  ecrire('');
  for (const s of sauvegardes) {
    ecrire(`  ${s.nom}`);
    ecrire(`      prise le ${s.dateAffichage} — ${formaterTailleOctets(s.tailleOctets)}`);
  }
  ecrire('');
  ecrire('Pour restaurer l’une d’elles : npm run db:restaurer -- <nom-du-fichier>');
  const plusRecente = sauvegardes[0];
  if (plusRecente !== undefined) {
    ecrire(`Exemple, la plus récente : npm run db:restaurer -- ${plusRecente.nom}`);
  }
}

async function demanderConfirmationParDefaut(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export type OptionsExecutionRestauration = {
  /** Arguments de ligne de commande APRÈS le nom du script (`process.argv.slice(2)`). */
  readonly argv: readonly string[];
  /** Par défaut `config.dossierSauvegardes` — surchargeable, notamment pour les tests. */
  readonly dossierSauvegardes?: string;
  /** Par défaut `config.cheminBase` — surchargeable, notamment pour les tests. */
  readonly cheminCible?: string;
  /** Par défaut une invite `readline` réelle sur le terminal. Injectable pour les tests. */
  readonly demanderConfirmation?: (question: string) => Promise<string>;
  /** Par défaut `console.log`. Injectable pour capturer la sortie dans les tests. */
  readonly ecrire?: (texte: string) => void;
  /** Par défaut `console.error`. Injectable pour capturer la sortie dans les tests. */
  readonly ecrireErreur?: (texte: string) => void;
};

/**
 * Exécute le scénario complet de `npm run db:restaurer` et rend un code de
 * sortie (0 : rien à signaler ou opération réussie/annulée ; 1 : échec).
 *
 * Toutes les entrées/sorties passent par les options injectées : c'est ce qui
 * permet de tester ce scénario par MUTATION (base réelle temporaire, réponses
 * simulées) sans jamais ouvrir un vrai terminal ni toucher la base du porteur.
 */
export async function executerRestauration(options: OptionsExecutionRestauration): Promise<number> {
  const dossier = options.dossierSauvegardes ?? config.dossierSauvegardes;
  const cible = options.cheminCible ?? config.cheminBase;
  const ecrire = options.ecrire ?? ((texte: string) => console.log(texte));
  const ecrireErreur = options.ecrireErreur ?? ((texte: string) => console.error(texte));
  const demanderConfirmation = options.demanderConfirmation ?? demanderConfirmationParDefaut;

  const argument = options.argv[0];

  // ── Cas 1 : lancé SANS argument ─────────────────────────────────────────
  if (argument === undefined) {
    afficherListe(dossier, ecrire);
    return 0;
  }

  // ── Cas 2 : sauvegarde INTROUVABLE ──────────────────────────────────────
  const cheminSauvegarde = resoudreCheminSauvegarde(argument, dossier);
  if (cheminSauvegarde === null) {
    ecrireErreur(`Sauvegarde introuvable : « ${argument} ».`);
    ecrireErreur(
      `Recherchée telle quelle, puis dans ${dossier} — sans succès dans les deux cas. ` +
        'Vérifiez le nom exact ci-dessous, ou relancez avec un chemin complet si le fichier ' +
        'est ailleurs (clé USB, disque réseau) :',
    );
    ecrireErreur('');
    afficherListe(dossier, ecrireErreur);
    return 1;
  }

  // ── Cas 3 : archive corrompue ou SCHÉMA ILLISIBLE ───────────────────────
  // Vérifié AVANT de demander la confirmation qui écrase la base : inutile de
  // faire retaper un nom de fichier à un opérateur sous stress pour une
  // restauration qui échouerait de toute façon. Le message dit déjà quoi
  // faire (voir `diagnostiquerSauvegarde`, `sauvegarde.ts`).
  const diagnostic = diagnostiquerSauvegarde(cheminSauvegarde);
  if (!diagnostic.valide) {
    ecrireErreur(diagnostic.raison);
    return 1;
  }

  const nomSauvegarde = basename(cheminSauvegarde);
  const statsSauvegarde = statSync(cheminSauvegarde);
  const dateSauvegardeAffichage =
    dateDepuisNom(nomSauvegarde)?.affichage ?? formaterDateHeure(statsSauvegarde.mtime);

  ecrire('');
  ecrire('══════════════════════════════════════════════════════════════════');
  ecrire('  RESTAURATION DE BASE — CETTE OPÉRATION REMPLACE LA BASE ACTUELLE');
  ecrire('══════════════════════════════════════════════════════════════════');
  ecrire('');
  ecrire(`Sauvegarde choisie : ${cheminSauvegarde}`);
  ecrire(`  Prise le ${dateSauvegardeAffichage} — ${formaterTailleOctets(statsSauvegarde.size)}.`);
  ecrire('');

  if (existsSync(cible)) {
    const statsCible = statSync(cible);
    ecrire(`Base actuelle qui sera ÉCRASÉE : ${cible}`);
    ecrire(
      `  Modifiée le ${formaterDateHeure(statsCible.mtime)} — ${formaterTailleOctets(statsCible.size)}.`,
    );
  } else {
    ecrire(`Aucune base n’existe encore à ${cible} : rien à écraser, elle sera créée.`);
  }
  ecrire('');
  ecrire(
    'Un cliché de sécurité du contenu ACTUEL sera pris automatiquement juste avant ' +
      'l’écrasement — mais ce n’est pas une raison de confirmer à la légère : une base ' +
      'comptable et un registre AFSCA sont en jeu.',
  );
  ecrire('');

  const texteAttendu = texteConfirmationRestauration(nomSauvegarde);
  const reponse = await demanderConfirmation(
    `Pour confirmer, retapez exactement le nom du fichier à restaurer (${texteAttendu}) : `,
  );

  if (reponse.trim() !== texteAttendu) {
    ecrire('');
    ecrire('Restauration annulée : rien n’a été modifié.');
    return 0;
  }

  ecrire('');
  ecrire('Restauration en cours…');

  let resultat: ResultatRestauration;
  try {
    resultat = restaurerBase({ cheminSauvegarde, cheminCible: cible });
  } catch (erreur) {
    // CLAUDE.md §4 : jamais de catch silencieux — surtout pas ici. `restaurer()`
    // ne touche la cible qu'APRÈS ses propres vérifications (voir sa
    // documentation) : un échec ici n'a donc rien modifié.
    ecrireErreur('');
    ecrireErreur('ÉCHEC DE LA RESTAURATION — la base actuelle n’a PAS été modifiée :');
    ecrireErreur(erreur instanceof Error ? erreur.message : String(erreur));
    return 1;
  }

  // ── Cas 4 : restauration RÉUSSIE ─────────────────────────────────────────
  ecrire('');
  ecrire(
    `Restauration réussie : ${resultat.chemin} (${formaterTailleOctets(resultat.tailleOctets)}).`,
  );

  if (resultat.migrationAppliquee) {
    ecrire(
      'La sauvegarde restaurée portait un schéma antérieur : elle a été migrée ' +
        'automatiquement vers le schéma courant de cette installation avant d’être mise en service.',
    );
  }

  if (resultat.sauvegardeSecurite === null) {
    ecrire(
      'Aucun cliché de sécurité n’a été nécessaire : il n’y avait rien à protéger avant l’écrasement.',
    );
  } else {
    const cliche = resultat.sauvegardeSecurite;
    ecrire(
      `Cliché de sécurité de l’ancien contenu (avant restauration) : ${cliche.chemin} ` +
        `(${formaterTailleOctets(cliche.tailleOctets)}).`,
    );
    // Le seul défaut de ce mécanisme qui puisse coûter des données
    // définitivement (voir `ResultatSauvegardeSecurite.methode`,
    // `sauvegarde.ts`) : une copie brute peut être déchirée, et ce repli se
    // déclenche précisément quand la cible était déjà cassée — donc au moment
    // où ce cliché est le DERNIER FILET. Le dire ici, jamais en silence.
    if (cliche.methode === 'copie_brute') {
      ecrireErreur(
        '⚠ ATTENTION : ce cliché de sécurité est une COPIE BRUTE, pas un instantané cohérent ' +
          `(le cliché propre a échoué : ${cliche.raisonRepli}). S’il portait un journal ` +
          'WAL non fusionné, il peut être incomplet ou déchiré. NE le considérez PAS comme un ' +
          'filet de secours fiable.',
      );
    }
  }

  return 0;
}

// Exécution directe uniquement (`npm run db:restaurer`), jamais à l'import —
// même garde que `migrer.ts` / `reinitialiser.ts` / `scripts/backtest.ts`.
if (estModulePrincipal(import.meta.url)) {
  executerRestauration({ argv: process.argv.slice(2) })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((erreur: unknown) => {
      // Jamais de catch silencieux : un échec inattendu ici (ex. le terminal
      // ferme l'entrée standard en cours de question) doit rester visible.
      console.error(erreur instanceof Error ? erreur.message : String(erreur));
      process.exitCode = 1;
    });
}
