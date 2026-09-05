/**
 * Remise a zero de la base de developpement (`npm run db:reset`).
 *
 * Outil de developpement, volontairement prudent : il sauvegarde AVANT
 * d'effacer, et refuse de tourner en production. Une base effacee, c'est un
 * registre AFSCA effacee — le confort d'un script ne justifie pas ce risque.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { config } from './config.js';
import { creerBase, fermerBase } from './client.js';
import { estModulePrincipal } from './module-principal.js';
import { migrer } from './migrer.js';
import { sauvegarder } from './sauvegarde.js';
import { seed } from './seed/index.js';

export function reinitialiser(): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      "db:reset est interdit en production. Effacez le fichier à la main si c'est vraiment voulu.",
    );
  }

  if (existsSync(config.cheminBase)) {
    // Sauvegarde d'abord : si la suite echoue, les donnees existent encore.
    const ancienne = creerBase();
    const sauvegarde = sauvegarder(ancienne);
    console.log(`Sauvegarde avant réinitialisation : ${sauvegarde.chemin}`);

    // FERMETURE OBLIGATOIRE avant suppression. Windows refuse de supprimer un
    // fichier dont un handle est encore ouvert : sans cette ligne, `db:reset`
    // echouait avec EBUSY dans le seul cas ou il sert — quand la base existe.
    fermerBase(ancienne);

    for (const suffixe of ['', '-wal', '-shm']) {
      const fichier = `${config.cheminBase}${suffixe}`;
      if (existsSync(fichier)) unlinkSync(fichier);
    }
    console.log(`Base supprimée : ${config.cheminBase}`);
  }

  const base = creerBase();
  migrer(base);
  const resultat = seed(base);
  console.log(
    `Base recréée : ${resultat.parametres.inseres.length} paramètre(s), ` +
      `${resultat.utilisateursInseres} utilisateur(s).`,
  );

  // On rend la main sur une base fermee : l'appelant est un script qui se
  // termine, et un WAL non replie laisserait la base fraiche incomplete.
  fermerBase(base);
}

if (estModulePrincipal(import.meta.url)) {
  reinitialiser();
}
