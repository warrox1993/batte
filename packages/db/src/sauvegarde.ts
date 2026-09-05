/**
 * Sauvegarde automatique au demarrage, retention configurable.
 *
 * docs/01-SPEC-FONCTIONNELLE.md, exigences non fonctionnelles :
 * « Une base perdue, c'est un registre AFSCA perdu. »
 *
 * UNE SAUVEGARDE PAR JOUR CIVIL BELGE, ET NON UNE PAR DEMARRAGE.
 *
 * La politique precedente ecrivait un `VACUUM INTO` a CHAQUE demarrage du
 * serveur. En developpement, `tsx watch` redemarre a chaque sauvegarde de
 * fichier : mesure du 28/07/2026, **197 fichiers et 108 Mo accumules en trois
 * jours**, soit environ 1,5 Go au terme de la retention de 30 jours — pour un
 * fichier de base de 720 Ko. Le dossier de sauvegardes devenait deux mille fois
 * plus gros que ce qu'il protege, et surtout illisible : y retrouver « la
 * sauvegarde d'avant-hier » parmi 197 fichiers n'est plus un geste.
 *
 * Ce que la frequence protege reellement : le contenu de la base d'HIER, avant
 * la saisie du jour. Deux sauvegardes prises a huit minutes d'intervalle le
 * meme apres-midi ne protegent de rien de plus l'une que l'autre — elles
 * portent presque exactement la meme donnee. La journee est donc la bonne
 * maille : c'est aussi le rythme reel de l'activite (une session de marche par
 * semaine, une saisie le dimanche soir). A ce rythme d'usage, trois jours
 * produisent trois fichiers d'environ 700 Ko au lieu de 197 fichiers.
 *
 * Le cas « je vais faire une manipulation risquee, je veux un point de
 * restauration maintenant » reste couvert par `forcer: true`.
 *
 * AJOUT DU 29/07/2026 (docs/17-VINGT-AMELIORATIONS.md fiche 19) — deux
 * defauts restaient ouverts une fois la frequence corrigee ci-dessus :
 *
 *  1. `purger` ne filtrait que sur l'age. Un plancher (`plancher`,
 *     `config.retentionSauvegardesMinimum`) garantit desormais qu'au moins N
 *     sauvegardes survivent quel que soit leur age, meme apres une horloge
 *     faussee ou une absence prolongee qui ferait paraitre tout le dossier
 *     perime au meme instant.
 *  2. Aucune fonction de restauration n'existait dans tout le depot. `restaurer`
 *     ci-dessous copie une sauvegarde vers un fichier cible, apres avoir
 *     verifie son integrite SQLite — pour ne jamais ecraser une cible saine par
 *     une archive corrompue sans le dire.
 *
 * Le second defaut (meme disque que l'original) n'a pas de correctif CODE : le
 * dossier de sauvegardes est deja un chemin configurable (`config.ts`,
 * `DOSSIER_SAUVEGARDES`), donc deja pointable vers une cle USB ou un disque
 * reseau. Rien ne peut forcer un support externe depuis le code : c'est un
 * geste operateur.
 *
 * AJOUT DU 30/07/2026 (audit sauvegarde/restauration) — deux defauts restaient
 * ouverts dans `restaurer` malgre ce qui precede :
 *
 *  1. Une restauration ECRASAIT la cible sans jamais proteger ce qu'elle
 *     remplacait. Une copie qui echoue a mi-chemin (disque plein, process
 *     tue) laissait la cible dans un etat pire qu'avant — le pire resultat
 *     possible pour une restauration. `restaurer` prend desormais un CLICHE
 *     DE SECURITE de l'etat courant de la cible (par `VACUUM INTO`, jamais
 *     une copie brute : la cible peut elle-meme porter un `-wal` non
 *     fusionne) avant toute ecriture destructive, et s'en sert pour tout
 *     annuler si la suite echoue.
 *  2. Rien ne verifiait la VERSION DE SCHEMA de la sauvegarde restauree. Une
 *     archive anterieure aux migrations actuelles etait acceptee en silence
 *     et donnerait un `no such column` au premier ecran qui lit la colonne
 *     manquante — en pleine utilisation, jamais au developpement. `restaurer`
 *     compare desormais la derniere migration appliquee a la sauvegarde et la
 *     derniere migration connue de cette installation : une sauvegarde EN
 *     RETARD est migree EXPLICITEMENT (jamais en silence, voir
 *     `migrationAppliquee` dans le resultat) ; une sauvegarde EN AVANCE (schema
 *     plus recent que ce code ne sait migrer) est REFUSEE, sans qu'aucun octet
 *     de la cible n'ait ete touche.
 *
 * AJOUT DU 01/08/2026 — `restaurer` etait entierement teste et n'etait appele
 * par AUCUN chemin utilisable : ni script npm, ni route, ni ecran. Un porteur
 * dont la base est corrompue devait alors copier un fichier a la main, sans
 * savoir si le schema correspond a la version installee. `packages/db/src/restaurer.ts`
 * (`npm run db:restaurer`) est ce chemin. Ses verifications de validite AVANT
 * geste (integrite, schema) sont extraites ici en `diagnostiquerSauvegarde`,
 * pour que le script puisse avertir l'operateur AVANT de lui demander la
 * confirmation qui ecrase la base — jamais apres lui avoir fait retaper un nom
 * de fichier pour une restauration qui echouerait de toute facon.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { horodatageFichier, jourCivilBelge, jourDuNomHorodate, joursEntre } from '@batte/core';
import { config } from './config.js';
import { creerBase, fermerBase, sqliteBrut, type BaseBatte } from './client.js';
import { migrer } from './migrer.js';

const PREFIXE = 'batte-';
const EXTENSION = '.sqlite';

export type ResultatSauvegarde = {
  chemin: string;
  tailleOctets: number;
  /**
   * Vrai quand la sauvegarde du jour existait deja : RIEN n'a ete ecrit, et
   * `chemin` designe le fichier existant. L'appelant doit le dire a l'operateur
   * plutot que d'annoncer une sauvegarde qui n'a pas eu lieu.
   */
  reutilisee: boolean;
  supprimees: string[];
};

export type OptionsSauvegarde = {
  /** Ecrit meme si le jour est deja couvert. Pour un point de restauration a la demande. */
  readonly forcer?: boolean;
  /** Instant de reference. Injectable pour les tests, jamais renseigne en production. */
  readonly instant?: Date;
  /**
   * Dossier cible. Par defaut celui de la configuration ; parametrable pour que
   * les tests n'ecrivent ni ne purgent JAMAIS le vrai dossier de l'utilisateur.
   */
  readonly dossier?: string;
};

/**
 * Copie coherente de la base vers le dossier de sauvegardes, au plus une par
 * jour civil belge.
 *
 * `VACUUM INTO` est prefere a une copie de fichier : en mode WAL, copier le
 * `.sqlite` sans son `-wal` produit une sauvegarde silencieusement incomplete.
 * `VACUUM INTO` produit un fichier unique, coherent et compacte, en une
 * instruction, sans arreter les lectures en cours.
 */
export function sauvegarder(base: BaseBatte, options: OptionsSauvegarde = {}): ResultatSauvegarde {
  const dossier = options.dossier ?? config.dossierSauvegardes;
  mkdirSync(dossier, { recursive: true });

  const instant = options.instant ?? new Date();
  const jour = jourCivilBelge(instant);

  if (options.forcer !== true) {
    const dejaFaite = sauvegardeDuJour(dossier, jour);
    if (dejaFaite !== null) {
      const chemin = join(dossier, dejaFaite);
      return { chemin, tailleOctets: statSync(chemin).size, reutilisee: true, supprimees: [] };
    }
  }

  const destination = join(dossier, `${PREFIXE}${horodatageFichier(instant)}${EXTENSION}`);

  if (existsSync(destination)) {
    // Deux `forcer` dans la meme minute : la sauvegarde existante fait
    // l'affaire, on ne l'ecrase pas.
    return {
      chemin: destination,
      tailleOctets: statSync(destination).size,
      reutilisee: true,
      supprimees: [],
    };
  }

  sqliteBrut(base).prepare('VACUUM INTO ?').run(destination);

  return {
    chemin: destination,
    tailleOctets: statSync(destination).size,
    reutilisee: false,
    supprimees: purger(config.retentionSauvegardesJours, { instant, dossier }),
  };
}

/** Noms de sauvegarde presents dans le dossier, non tries. */
function nomsSauvegardes(dossier: string): string[] {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier).filter((nom) => nom.startsWith(PREFIXE) && nom.endsWith(EXTENSION));
}

/** Premiere sauvegarde trouvee pour ce jour civil belge, ou `null`. */
function sauvegardeDuJour(dossier: string, jourCivil: string): string | null {
  return nomsSauvegardes(dossier).find((nom) => jourDuNomHorodate(nom) === jourCivil) ?? null;
}

export type OptionsPurge = {
  readonly instant?: Date;
  readonly dossier?: string;
  /**
   * Nombre minimal de sauvegardes TOUJOURS conservees, quel que soit leur age.
   * Par defaut `config.retentionSauvegardesMinimum`. Voir le commentaire d'en-tete
   * de ce fichier (fiche 19) pour la justification du chiffre par defaut.
   */
  readonly plancher?: number;
};

/**
 * Supprime les sauvegardes plus vieilles que la retention configuree — sauf
 * les `plancher` plus RECENTES, qui ne sont jamais purgees par l'age.
 *
 * L'age se lit dans le NOM du fichier, pas dans sa date de modification. Une
 * copie du dossier, une restauration ou une synchronisation reecrit toutes les
 * `mtime` a la date du jour : la purge par `mtime` aurait alors considere
 * l'archive entiere comme neuve, et n'aurait plus jamais rien supprime.
 *
 * Un fichier dont le nom ne porte pas de date lisible n'est JAMAIS supprime
 * (ni compte dans le plancher : on ne sait pas dire son age, donc on ne sait
 * pas davantage s'il fait partie des plus recentes). Dans un dossier de
 * sauvegardes, le doute doit conserver : mieux vaut laisser traîner une copie
 * manuelle que d'effacer ce qu'on n'a pas su lire.
 *
 * Le plancher est le garde-fou du defaut n°1 de la fiche 19 : sans lui, une
 * horloge systeme faussee ou une machine restee eteinte plus longtemps que la
 * retention font paraitre TOUTES les sauvegardes perimees au meme instant, et
 * cette fonction les aurait alors toutes supprimees d'un coup.
 */
export function purger(
  retentionJours: number = config.retentionSauvegardesJours,
  options: OptionsPurge = {},
): string[] {
  const dossier = options.dossier ?? config.dossierSauvegardes;
  const plancher = options.plancher ?? config.retentionSauvegardesMinimum;
  const aujourdHui = jourCivilBelge(options.instant ?? new Date());

  // Triees du plus RECENT au plus ANCIEN (ordre lexicographique du nom = ordre
  // chronologique, `horodatageFichier` produit `AAAAMMJJ-HHMM`) : les
  // `plancher` premiers de cette liste sont hors d'atteinte de la purge.
  const datees = nomsSauvegardes(dossier)
    .map((nom) => ({ nom, jour: jourDuNomHorodate(nom) }))
    .filter((entree): entree is { nom: string; jour: string } => entree.jour !== null)
    .sort((a, b) => (a.nom < b.nom ? 1 : a.nom > b.nom ? -1 : 0));

  const intouchables = new Set(datees.slice(0, plancher).map((entree) => entree.nom));
  const supprimees: string[] = [];

  for (const { nom, jour } of datees) {
    if (intouchables.has(nom)) continue;
    if (joursEntre(jour, aujourdHui) <= retentionJours) continue;
    unlinkSync(join(dossier, nom));
    supprimees.push(nom);
  }

  return supprimees;
}

export type OptionsRestauration = {
  /** Chemin du fichier de sauvegarde a restaurer (produit par `sauvegarder`). */
  readonly cheminSauvegarde: string;
  /**
   * Chemin OU la sauvegarde est copiee. Peut etre un fichier neuf ou existant :
   * `restaurer` l'ecrase, mais protege d'abord son contenu actuel (voir
   * `sauvegardeSecurite` du resultat). Sur une base de PRODUCTION deja
   * ouverte, fermez-la d'abord (`fermerBase`) — SQLite refusera l'ecriture
   * plutot que de corrompre un fichier encore verrouille, mais l'appelant doit
   * s'attendre a cette erreur plutot que la decouvrir.
   */
  readonly cheminCible: string;
  /**
   * Dossier ou est ecrit le cliche de securite de l'ancien contenu de la
   * cible. Par defaut le dossier de la cible elle-meme (`dirname(cheminCible)`)
   * — JAMAIS `config.dossierSauvegardes` par defaut : ce cliche est un
   * evenement rare et ponctuel (une restauration), pas la cadence quotidienne
   * de `sauvegarder`, et les tests doivent pouvoir l'isoler sans risquer
   * d'ecrire dans le vrai dossier de sauvegardes au moindre oubli de ce
   * parametre.
   */
  readonly dossierSauvegardeSecurite?: string;
  /** Instant de reference du cliche de securite. Injectable pour les tests, jamais renseigne en production. */
  readonly instant?: Date;
};

export type ResultatSauvegardeSecurite = {
  readonly chemin: string;
  readonly tailleOctets: number;
  /**
   * Comment ce cliche a REELLEMENT ete produit.
   *
   * Trouve le 01/08/2026 par l'audit des echecs silencieux, et c'est le seul
   * defaut de ce module qui puisse coûter des donnees definitivement.
   *
   * `clicheSecurite` tente un `VACUUM INTO` et, s'il echoue, se replie sur une
   * copie brute des octets. Le repli est DEFENDABLE — proteger un etat
   * imparfait vaut mieux que rien. Ce qui ne l'etait pas : la valeur rendue
   * etait **identique dans les deux cas**. Meme message, meme chemin, meme
   * taille plausible.
   *
   * Or une copie brute d'une base SQLite dont le `-wal` n'est pas fusionne peut
   * etre DECHIREE — et ce repli se declenche precisement quand la cible est
   * deja corrompue ou verrouillee, c'est-a-dire **au moment ou ce cliche est le
   * dernier filet**. Le porteur lisait « Cliche de securite cree — 4,2 Mo » et
   * decouvrait la difference en restaurant, donc trop tard.
   */
  readonly methode: 'vacuum' | 'copie_brute';
  /**
   * Message de l'erreur qui a force le repli, `null` sur un `VACUUM INTO`
   * reussi. Sans lui, la cause d'origine etait perdue definitivement — et si
   * la copie brute echouait a son tour, son exception la masquait.
   */
  readonly raisonRepli: string | null;
};

export type ResultatRestauration = {
  readonly chemin: string;
  readonly tailleOctets: number;
  /**
   * Cliche de l'ancien contenu de la cible, pris juste avant l'ecrasement.
   * `null` quand la cible n'existait pas encore : rien n'y avait a proteger.
   */
  readonly sauvegardeSecurite: ResultatSauvegardeSecurite | null;
  /**
   * Vrai quand la sauvegarde restauree portait un schema ANTERIEUR aux
   * migrations connues de cette installation : `restaurer` l'a alors migree
   * EXPLICITEMENT vers le schema courant avant de rendre la main, plutot que
   * de laisser une base perimee entrer silencieusement en service.
   */
  readonly migrationAppliquee: boolean;
  /** Version de schema portee par la sauvegarde restauree, AVANT la migration eventuelle ci-dessus. */
  readonly versionSchemaSauvegarde: number;
  /** Version de schema attendue par cette installation (derniere migration connue). */
  readonly versionSchemaAttendue: number;
};

/**
 * Derniere migration connue de CETTE installation (le dossier de migrations
 * livre avec le code), en millisecondes epoch. Sert de reference pour juger
 * si une sauvegarde restauree est A JOUR, EN RETARD ou EN AVANCE.
 */
export function versionSchemaAttendue(): number {
  const migrations = readMigrationFiles({ migrationsFolder: config.dossierMigrations });
  // Un dossier de migrations vide n'arrive jamais en pratique (migrer() leve
  // avant si le dossier lui-meme est absent) ; 0 est une reference honnete
  // pour « aucune migration connue » plutot qu'un NaN qui casserait toute
  // comparaison en aval.
  if (migrations.length === 0) return 0;
  return Math.max(...migrations.map((migration) => migration.folderMillis));
}

/**
 * Derniere migration APPLIQUEE au fichier SQLite donne, lue dans sa propre
 * table `__drizzle_migrations` — celle que le migrateur Drizzle tient a jour
 * a chaque application (voir `dialect.js` : un `INSERT` par migration jouee).
 *
 * Rend `null` quand la table est absente : ce fichier n'a jamais ete migre
 * par Batte. En pratique, TOUTE sauvegarde reelle en porte une — `sauvegarder`
 * n'est jamais appele sur une base non migree (`creerContexte` migre avant de
 * sauvegarder). Un fichier sans cette table n'est donc pas une sauvegarde
 * Batte credible, plutot qu'une antiquite d'avant le suivi des migrations.
 */
export function lireVersionSchema(chemin: string): number | null {
  const sqlite = new Database(chemin, { readonly: true });
  try {
    const table = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`,
      )
      .get();
    if (table === undefined) return null;

    const ligne = sqlite
      .prepare('SELECT MAX(created_at) AS derniere FROM "__drizzle_migrations"')
      .get() as {
      derniere: number | null;
    };
    return ligne.derniere;
  } finally {
    sqlite.close();
  }
}

/**
 * Chemin de cliche de securite JAMAIS reutilise. `horodatageFichier` n'a
 * qu'une resolution a la MINUTE (`AAAAMMJJ-HHMM`) : deux restaurations
 * survenant dans la meme minute ne doivent pas se voir attribuer le meme
 * fichier, sous peine que la seconde ecrase silencieusement le cliche de la
 * premiere — exactement le defaut que ce cliche existe pour eviter.
 */
function cheminSecuriteDisponible(dossier: string, instant: Date): string {
  const base = `avant-restauration-${horodatageFichier(instant)}`;
  let compteur = 0;
  let chemin = join(dossier, `${base}${EXTENSION}`);
  while (existsSync(chemin)) {
    compteur += 1;
    chemin = join(dossier, `${base}-${compteur}${EXTENSION}`);
  }
  return chemin;
}

/**
 * Cliche de securite de l'etat COURANT de `cheminCible`, pris juste avant de
 * l'ecraser. `null` si `cheminCible` n'existe pas encore : rien a proteger.
 *
 * Par `VACUUM INTO` plutot qu'une copie brute : la cible peut elle-meme
 * porter un `-wal` non fusionne — le meme piege que ce module corrige deja
 * cote sauvegarde reguliere. Si la cible n'est PAS une base SQLite
 * exploitable (corrompue, verrouillee) — precisement le cas ou l'operateur
 * restaure PARCE QUE la cible est cassee — on replie sur une copie brute des
 * octets : proteger un etat imparfait vaut mieux qu'abandonner la
 * restauration faute de pouvoir la proteger proprement.
 *
 * Connexion GEREE ICI (pas via `creerBase`/`fermerBase`) : sur un fichier
 * invalide, l'ouverture reussit mais le PREMIER pragma leve, et une connexion
 * jamais fermee garde un verrou Windows sur le fichier — jusqu'a faire
 * echouer le nettoyage `-wal`/`-shm` qui suit, plus loin dans `restaurer`,
 * avec un `EBUSY` sans rapport apparent avec sa vraie cause. Le `finally`
 * ci-dessous ferme la connexion quoi qu'il arrive, succes ou echec.
 *
 * Le nom ne partage PAS le prefixe (`PREFIXE` = `batte-`) des sauvegardes
 * regulieres : si ce cliche atterrissait par megarde dans
 * `config.dossierSauvegardes`, il ne doit JAMAIS etre confondu par `purger`
 * ou par `sauvegardeDuJour` avec une sauvegarde quotidienne normale.
 */
function clicheSecurite(
  cheminCible: string,
  dossier: string,
  instant: Date,
): ResultatSauvegardeSecurite | null {
  if (!existsSync(cheminCible)) return null;

  mkdirSync(dossier, { recursive: true });
  const destination = cheminSecuriteDisponible(dossier, instant);

  let sqlite: Database.Database | undefined;
  let methode: 'vacuum' | 'copie_brute' = 'vacuum';
  let raisonRepli: string | null = null;
  try {
    sqlite = new Database(cheminCible);
    sqlite.pragma('journal_mode = WAL');
    sqlite.prepare('VACUUM INTO ?').run(destination);
  } catch (erreur) {
    // CLAUDE.md §4 : jamais de `catch` silencieux. La cause est CONSERVEE et
    // remontee a l'appelant — c'est la seule information qui dise pourquoi le
    // dernier filet du porteur n'est peut-etre pas intact.
    methode = 'copie_brute';
    raisonRepli = erreur instanceof Error ? erreur.message : String(erreur);
    copyFileSync(cheminCible, destination);
  } finally {
    sqlite?.close();
  }

  return {
    chemin: destination,
    tailleOctets: statSync(destination).size,
    methode,
    raisonRepli,
  };
}

export type DiagnosticSauvegarde =
  | { readonly valide: true; readonly versionSchema: number }
  | { readonly valide: false; readonly raison: string };

/**
 * Verifie qu'une sauvegarde est RESTAURABLE par cette installation, SANS RIEN
 * ECRIRE nulle part : integrite SQLite (`PRAGMA integrity_check`), puis
 * version de schema comparee a celle attendue ici. Chaque `raison` de refus
 * dit explicitement quoi faire (mettre a jour l'application, essayer une
 * autre archive...) — jamais seulement que c'est impossible.
 *
 * Extrait de `restaurer` (voir sa documentation ci-dessous pour l'ordre des
 * garanties) pour etre appelable SEUL, avant tout geste destructeur :
 * `packages/db/src/restaurer.ts` (`npm run db:restaurer`) s'en sert pour
 * avertir l'operateur AVANT de lui demander la confirmation qui ecrase la
 * base courante, plutot que de le faire retaper le nom d'un fichier pour une
 * restauration qui echouerait de toute facon.
 */
export function diagnostiquerSauvegarde(cheminSauvegarde: string): DiagnosticSauvegarde {
  if (!existsSync(cheminSauvegarde)) {
    return { valide: false, raison: `Sauvegarde introuvable : ${cheminSauvegarde}` };
  }

  const verification = new Database(cheminSauvegarde, { readonly: true });
  let integrite: unknown;
  try {
    integrite = verification.pragma('integrity_check', { simple: true });
  } catch (erreur) {
    // Un fichier qui n'est PAS DU TOUT une base SQLite (texte, binaire
    // quelconque, archive tronquee des les tout premiers octets) fait LEVER
    // `PRAGMA integrity_check` plutot que de rendre une chaine differente de
    // « ok » — trouve en ecrivant le test qui force ce cas (`sauvegarde.test.ts`,
    // « diagnostiquerSauvegarde »). Sans ce `catch`, l'operateur aurait vu
    // l'erreur BRUTE de la bibliotheque SQLite (« file is not a database »),
    // sans le chemin du fichier ni la phrase de reassurance qui suit : la
    // meme situation du point de vue de l'operateur (une archive a ne pas
    // utiliser) doit produire le MEME message explicite dans les deux cas.
    integrite = erreur instanceof Error ? erreur.message : String(erreur);
  } finally {
    verification.close();
  }
  if (integrite !== 'ok') {
    return {
      valide: false,
      raison:
        `Sauvegarde corrompue (verification d'integrite : ${String(integrite)}) : ${cheminSauvegarde}. ` +
        "Restauration refusee plutot que d'ecraser la cible avec une archive douteuse.",
    };
  }

  const versionAttendue = versionSchemaAttendue();
  const versionSauvegarde = lireVersionSchema(cheminSauvegarde);

  if (versionSauvegarde === null) {
    return {
      valide: false,
      raison:
        `Sauvegarde sans aucune trace des migrations Batte (table __drizzle_migrations absente) : ` +
        `${cheminSauvegarde}. Ce n'est probablement pas une sauvegarde produite par cette ` +
        "application : restauration refusee plutot que d'ecraser la cible avec un fichier " +
        "d'origine incertaine.",
    };
  }
  if (versionSauvegarde > versionAttendue) {
    return {
      valide: false,
      raison:
        `Sauvegarde d'un schema plus RECENT que les migrations connues de cette installation ` +
        `(sauvegarde migree jusqu'au ${new Date(versionSauvegarde).toISOString()}, cette ` +
        `installation ne connait ses migrations que jusqu'au ` +
        `${new Date(versionAttendue).toISOString()}) : ${cheminSauvegarde}. Mettez a jour ` +
        "l'application avant de restaurer cette sauvegarde : la restaurer telle quelle " +
        'exposerait un schema que ce code ne sait pas encore lire.',
    };
  }

  return { valide: true, versionSchema: versionSauvegarde };
}

/**
 * Restaure une sauvegarde vers un fichier cible.
 *
 * docs/17-VINGT-AMELIORATIONS.md fiche 19, defaut n°3 : « il n'existe aucune
 * fonction de restauration dans tout le depot ». Une sauvegarde qu'on n'a
 * jamais restauree n'est pas une sauvegarde — c'est un pari sur un fichier
 * dont personne n'a verifie qu'il se relit.
 *
 * Garanties, DANS CET ORDRE — les trois premieres AVANT tout octet ecrit sur
 * la cible, la derniere protege ce qui reste :
 *
 *  1. La sauvegarde est verifiee par `diagnostiquerSauvegarde` : integrite
 *     SQLite, puis version de schema. Decouvrir qu'une archive est corrompue
 *     ou tronquee APRES avoir ecrase la cible serait le pire moment possible
 *     pour l'apprendre — exactement le mode de defaillance que D-033 a deja
 *     corrige une fois cote sauvegarde (WAL non replie) et qu'on ne veut pas
 *     rouvrir cote restauration.
 *  2. La VERSION DE SCHEMA de la sauvegarde (derniere migration qu'elle porte
 *     dans sa propre table `__drizzle_migrations`) est comparee a la derniere
 *     migration connue de cette installation. Une sauvegarde plus RECENTE que
 *     ce code ne sait migrer est REFUSEE — restaurer un schema du futur sur un
 *     code plus ancien exposerait des colonnes que ce code ne sait pas gerer.
 *     Une sauvegarde sans AUCUNE trace de migration Batte est refusee aussi :
 *     ce n'est pas une antiquite credible sur ce projet (les migrations
 *     Drizzle existent depuis le premier commit), plutot un fichier d'origine
 *     incertaine.
 *  3. D'eventuels `-wal` / `-shm` residuels a l'emplacement CIBLE sont
 *     supprimes avant la copie : une restauration remplace entierement l'etat
 *     de la cible, elle ne doit jamais se retrouver a fusionner avec un
 *     journal perime laisse par un ancien fichier au meme chemin.
 *  4. L'etat COURANT de la cible (si elle existe) est fige dans un CLICHE DE
 *     SECURITE avant toute ecriture destructive (`clicheSecurite`). Si la
 *     copie ou la migration qui suit echoue en cours de route, la cible est
 *     restauree a cet etat plutot que laissee a moitie ecrite — une
 *     restauration qui casse la base qu'elle devait remplacer est le pire
 *     resultat possible.
 *
 * Si la sauvegarde restauree porte un schema ANTERIEUR aux migrations
 * connues, elle est migree EXPLICITEMENT vers le schema courant avant que
 * `restaurer` rende la main — jamais acceptee telle quelle en silence. Le
 * resultat le signale via `migrationAppliquee`.
 *
 * `VACUUM INTO` (voir `sauvegarder` et `clicheSecurite`) produit un fichier
 * SANS WAL associe : la sauvegarde SOURCE n'a donc jamais ce probleme, seule
 * la CIBLE (et son eventuel cliche de securite) peuvent en porter un
 * residuel d'une vie anterieure.
 */
export function restaurer(options: OptionsRestauration): ResultatRestauration {
  const { cheminSauvegarde, cheminCible } = options;
  const instant = options.instant ?? new Date();

  if (resolve(cheminSauvegarde) === resolve(cheminCible)) {
    throw new Error('La cible de restauration ne peut pas etre la sauvegarde elle-meme.');
  }

  const diagnostic = diagnostiquerSauvegarde(cheminSauvegarde);
  if (!diagnostic.valide) {
    throw new Error(diagnostic.raison);
  }

  const versionAttendue = versionSchemaAttendue();
  const versionSauvegarde = diagnostic.versionSchema;
  const migrationRequise = versionSauvegarde < versionAttendue;

  mkdirSync(dirname(cheminCible), { recursive: true });

  // Cliche de securite de l'etat COURANT de la cible, avant toute ecriture
  // destructive (voir le point 4 de la documentation ci-dessus).
  const dossierSecurite = options.dossierSauvegardeSecurite ?? dirname(cheminCible);
  const sauvegardeSecurite = clicheSecurite(cheminCible, dossierSecurite, instant);

  // Une cible qui a deja vecu en mode WAL peut porter ces deux fichiers : les
  // laisser survivrait au remplacement du `.sqlite` et ferait relire, au
  // prochain `creerBase`, un mariage entre l'ARCHIVE restauree et un journal
  // qui parle d'un tout autre etat.
  for (const suffixe of ['-wal', '-shm']) {
    const residuel = `${cheminCible}${suffixe}`;
    if (existsSync(residuel)) unlinkSync(residuel);
  }

  try {
    copyFileSync(cheminSauvegarde, cheminCible);

    if (migrationRequise) {
      const baseRestauree = creerBase(cheminCible);
      try {
        migrer(baseRestauree);
      } finally {
        fermerBase(baseRestauree);
      }
    }
  } catch (erreur) {
    // Restauration echouee en cours de route (copie ou migration) : ne JAMAIS
    // laisser la cible dans un etat pire qu'avant. On la remet dans l'etat que
    // le cliche de securite vient de figer, ou on efface la copie partielle
    // s'il n'y avait rien a proteger.
    if (sauvegardeSecurite !== null) {
      copyFileSync(sauvegardeSecurite.chemin, cheminCible);
    } else if (existsSync(cheminCible)) {
      unlinkSync(cheminCible);
    }
    throw erreur;
  }

  return {
    chemin: cheminCible,
    tailleOctets: statSync(cheminCible).size,
    sauvegardeSecurite,
    migrationAppliquee: migrationRequise,
    versionSchemaSauvegarde: versionSauvegarde,
    versionSchemaAttendue: versionAttendue,
  };
}
