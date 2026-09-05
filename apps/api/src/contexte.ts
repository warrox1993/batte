/**
 * Ouverture de la base pour tout le processus API.
 *
 * docs/01-SPEC-FONCTIONNELLE.md (exigences non fonctionnelles) : « une base
 * perdue, c'est un registre AFSCA perdu ». D'ou la sauvegarde horodatee des
 * le demarrage (`sauvegarder`, VACUUM INTO), avant meme la premiere requete
 * HTTP — pas seulement a la fermeture, qu'un arret brutal ne declencherait
 * jamais.
 *
 * Cette sauvegarde est desormais plafonnee a UNE PAR JOUR CIVIL BELGE (voir
 * l'en-tete de `packages/db/src/sauvegarde.ts` pour le chiffre qui a motive la
 * decision). Ce fichier n'a donc plus a se demander s'il doit sauvegarder : il
 * demande, et le module repond soit un fichier neuf, soit celui du jour.
 *
 * La purge qui suit conserve desormais un PLANCHER de sauvegardes recentes
 * (docs/17-VINGT-AMELIORATIONS.md fiche 19) en plus de la retention par age :
 * ni ce fichier ni son appelant n'ont a s'en soucier, `sauvegarder` le fait
 * suivre a `purger` avec la configuration par defaut.
 *
 * `creerContexte` n'est appelee qu'une seule fois, au demarrage reel du
 * serveur (voir le point d'entree de serveur.ts, garde par `estPointEntree`).
 * Les tests ne l'appellent jamais : ils construisent leur propre base en
 * memoire et appellent directement `construireServeur`, ce qui evite d'ecrire
 * une vraie sauvegarde sur disque a chaque run de test.
 *
 * La base retournee est aussi le seul point d'acces necessaire aux
 * parametres : `lireParametres(base)` (exporte par @batte/db) suffit a tout
 * appelant. Une enveloppe dediee n'apporterait rien de plus.
 */

import { config, creerBase, migrer, sauvegarder, type BaseBatte } from '@batte/db';

export function creerContexte(): BaseBatte {
  const base = creerBase();
  migrer(base);

  const sauvegarde = sauvegarder(base);
  console.log(`Base ouverte : ${config.cheminBase}`);

  // Dire lequel des deux cas s'est produit : annoncer « Sauvegarde de
  // démarrage » alors que rien n'a été écrit ferait croire à une protection
  // qui date en réalité de ce matin.
  console.log(
    sauvegarde.reutilisee
      ? `Sauvegarde du jour déjà présente : ${sauvegarde.chemin}`
      : `Sauvegarde de démarrage : ${sauvegarde.chemin} (${sauvegarde.tailleOctets} octets)`,
  );
  if (sauvegarde.supprimees.length > 0) {
    console.log(
      `Rétention : ${sauvegarde.supprimees.length} sauvegarde(s) au-delà de ` +
        `${config.retentionSauvegardesJours} jours supprimée(s).`,
    );
  }

  return base;
}
