/**
 * Configuration de plomberie, lue depuis l'environnement.
 *
 * Ne contient QUE des chemins et des reglages techniques. Aucune valeur metier :
 * celles-la vivent dans la table `parametre` (voir packages/core/parametres.ts).
 */

import { resolve } from 'node:path';

/** Racine du depot, deduite depuis packages/db/src — evite un chemin absolu code en dur. */
const RACINE = resolve(import.meta.dirname, '..', '..', '..');

function texte(cle: string, defaut: string): string {
  const valeur = process.env[cle];
  return valeur === undefined || valeur === '' ? defaut : valeur;
}

function entier(cle: string, defaut: number): number {
  const brut = process.env[cle];
  if (brut === undefined || brut === '') return defaut;
  const valeur = Number.parseInt(brut, 10);
  if (!Number.isInteger(valeur)) {
    throw new Error(`Variable d'environnement ${cle} invalide : « ${brut} » n'est pas un entier.`);
  }
  return valeur;
}

/** Resout un chemin relatif par rapport a la racine du depot. */
function chemin(cle: string, defaut: string): string {
  return resolve(RACINE, texte(cle, defaut));
}

export const config = {
  racine: RACINE,
  cheminBase: chemin('CHEMIN_BASE', './donnees/batte.sqlite'),
  // Chemin RESOLU (voir `chemin()` ci-dessus) : si `DOSSIER_SAUVEGARDES` est un
  // chemin ABSOLU (cle USB, disque reseau), `resolve()` le rend tel quel et
  // ignore `RACINE` — c'est ce qui permet de sortir la sauvegarde du disque de
  // la base (docs/17-VINGT-AMELIORATIONS.md fiche 19, defaut n°2 : « meme
  // disque »). Rien a coder de plus ici : le porteur pointe la variable
  // d'environnement vers le second support.
  dossierSauvegardes: chemin('DOSSIER_SAUVEGARDES', './sauvegardes'),
  retentionSauvegardesJours: entier('RETENTION_SAUVEGARDES_JOURS', 30),
  /**
   * Plancher de conservation : nombre de sauvegardes les plus RECENTES jamais
   * purgees, quel que soit leur age (docs/17-VINGT-AMELIORATIONS.md fiche 19,
   * defaut n°1 : `purger` ne filtrait que sur l'age). Sans plancher, une
   * horloge systeme faussee ou une machine restee eteinte plus longtemps que
   * `RETENTION_SAUVEGARDES_JOURS` fait paraitre TOUTES les sauvegardes perimees
   * au meme instant, et la purge suivante peut tout emporter d'un coup.
   *
   * 10 est le chiffre retenu par defaut : au rythme reel d'usage (une
   * sauvegarde par jour civil belge au plus, voir `sauvegarde.ts`, et une
   * seule saisie hebdomadaire le dimanche soir), 10 sauvegardes couvrent
   * largement plus de deux mois d'activite — bien au-dela de toute absence
   * plausible — pour un cout disque negligeable (10 x ~700 Ko, mesure du
   * 28/07/2026, soit ~7 Mo).
   */
  retentionSauvegardesMinimum: entier('RETENTION_SAUVEGARDES_MINIMUM', 10),
  dossierSorties: chemin('DOSSIER_SORTIES', './sorties'),
  dossierMigrations: resolve(RACINE, 'packages', 'db', 'drizzle'),
} as const;
