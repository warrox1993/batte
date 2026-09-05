/**
 * Jeu de donnees initial.
 *
 * Idempotent et sans effacement : relancer `npm run db:seed` sur une base
 * utilisee ne doit jamais ecraser une donnee saisie. Chaque lot ajoute son
 * propre seed ici.
 */

import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { estModulePrincipal } from '../module-principal.js';
import { utilisateur } from '../schema.js';
import { seedEcheances } from '../depots/comptabilite.js';
import { seedAfsca, type ResultatSeedAfsca } from './afsca.js';
import {
  seedFournisseursSysteme,
  type ResultatSeedFournisseursSysteme,
} from './fournisseurs-systeme.js';
import { seedMotifs, type ResultatSeedMotifs } from './motifs.js';
import { seedParametres, type ResultatSeedParametres } from './parametres.js';

export type ResultatSeed = {
  parametres: ResultatSeedParametres;
  motifs: ResultatSeedMotifs;
  afsca: ResultatSeedAfsca;
  fournisseursSysteme: ResultatSeedFournisseursSysteme;
  echeancesInserees: number;
  /**
   * Libelles d'echeance dont un champ derive du catalogue (source, URL,
   * recurrence ou date, cette derniere seulement si jamais honoree) a ete
   * resynchronise sur une ligne DEJA presente — voir `seedEcheances`.
   */
  echeancesMisesAJour: readonly string[];
  utilisateursInseres: number;
};

export function seed(base: BaseBatte): ResultatSeed {
  const parametres = seedParametres(base);
  // Les codes motifs sont des donnees de REFERENCE, pas de demonstration :
  // sans eux, aucun mouvement de stock ne peut etre attribue.
  const motifs = seedMotifs(base);

  // Le plan de nettoyage est une donnee de REFERENCE reglementaire, pas de
  // demonstration : sans lui, le registre AFSCA n'a aucune tache a attester.
  const afsca = seedAfsca(base);

  // Le fournisseur « inventaire d'ouverture » est du REFERENTIEL, pas de la
  // demonstration : sans lui, declarer le stock qu'on possede deja le jour de
  // l'installation est impossible, alors que c'est le tout premier geste.
  const fournisseursSysteme = seedFournisseursSysteme(base);

  // Meme raison pour l'echeancier : le listing TVA au 31 mars est du, meme a
  // zero. Une echeance qu'il faut penser a creer soi-meme ne sert a rien.
  const echeances = seedEcheances(base);

  // Deux personnes, pas d'authentification (D-001) : le compte sert uniquement
  // a tracer qui a saisi quoi.
  const existants = base.select({ id: utilisateur.id }).from(utilisateur).limit(1).all();
  let utilisateursInseres = 0;
  if (existants.length === 0) {
    const maintenant = maintenantUtc();
    base
      .insert(utilisateur)
      .values({
        id: nouvelIdentifiant(),
        nom: 'Propriétaire',
        role: 'proprietaire',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    utilisateursInseres = 1;
  }

  return {
    parametres,
    motifs,
    afsca,
    fournisseursSysteme,
    echeancesInserees: echeances.inserees,
    echeancesMisesAJour: echeances.misesAJour,
    utilisateursInseres,
  };
}

if (estModulePrincipal(import.meta.url)) {
  const base = creerBase();
  const resultat = seed(base);
  console.log(
    `Seed : ${resultat.parametres.inseres.length} paramètre(s) inséré(s), ` +
      `${resultat.parametres.deja_presents.length} déjà présent(s), ` +
      `${resultat.parametres.metadonneesMisesAJour.length} documentation(s) resynchronisée(s), ` +
      `${resultat.motifs.inseres.length} motif(s) inséré(s), ` +
      `${resultat.afsca.inseres.length} tâche(s) de nettoyage insérée(s), ` +
      `${resultat.fournisseursSysteme.inseres.length} fournisseur(s) système inséré(s), ` +
      `${resultat.echeancesInserees} échéance(s) insérée(s), ` +
      `${resultat.echeancesMisesAJour.length} échéance(s) resynchronisée(s), ` +
      `${resultat.utilisateursInseres} utilisateur(s) inséré(s).`,
  );
  if (resultat.parametres.inseres.length > 0) {
    console.log(`  insérés  : ${resultat.parametres.inseres.join(', ')}`);
  }
  if (resultat.parametres.metadonneesMisesAJour.length > 0) {
    console.log(`  résynchro: ${resultat.parametres.metadonneesMisesAJour.join(', ')}`);
  }
  if (resultat.echeancesMisesAJour.length > 0) {
    console.log(`  échéances resynchronisées : ${resultat.echeancesMisesAJour.join(', ')}`);
  }
}
