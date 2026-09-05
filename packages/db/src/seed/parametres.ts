/**
 * Insertion des parametres depuis le catalogue de `packages/core`.
 *
 * Le catalogue est l'unique source de verite : ce fichier ne redeclare aucune
 * valeur, il ne fait que la transposer en lignes. Ajouter un parametre se fait
 * dans `packages/core/src/parametres.ts`, jamais ici.
 */

import { CATALOGUE_PARAMETRES, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { parametre } from '../schema.js';

export type ResultatSeedParametres = {
  inseres: string[];
  deja_presents: string[];
  /** Cles dont la documentation a ete resynchronisee depuis le catalogue. */
  metadonneesMisesAJour: string[];
};

/**
 * Idempotent sur les VALEURS, synchronisant sur les METADONNEES.
 *
 * Repartition des responsabilites (D-013) : le catalogue TypeScript possede la
 * documentation d'un parametre (libelle, source, type), la base possede son
 * reglage. Un `db:seed` relance corrige donc une description ou une source
 * amelioree, mais ne remet JAMAIS un seuil ajuste a la main a sa valeur d'usine.
 */
export function seedParametres(base: BaseBatte): ResultatSeedParametres {
  const inseres: string[] = [];
  const dejaPresents: string[] = [];
  const metadonneesMisesAJour: string[] = [];
  const maintenant = maintenantUtc();

  for (const definition of CATALOGUE_PARAMETRES) {
    const existant = base
      .select({
        id: parametre.id,
        description: parametre.description,
        source: parametre.source,
        typeValeur: parametre.typeValeur,
      })
      .from(parametre)
      .where(eq(parametre.cle, definition.cle))
      .limit(1)
      .all();

    const ligne = existant[0];
    if (ligne !== undefined) {
      dejaPresents.push(definition.cle);

      const aDerive =
        ligne.description !== definition.description ||
        ligne.source !== definition.source ||
        ligne.typeValeur !== definition.typeValeur;

      if (aDerive) {
        base
          .update(parametre)
          .set({
            description: definition.description,
            source: definition.source,
            typeValeur: definition.typeValeur,
            modifieLe: maintenant,
          })
          .where(eq(parametre.id, ligne.id))
          .run();
        metadonneesMisesAJour.push(definition.cle);
      }
      continue;
    }

    base
      .insert(parametre)
      .values({
        id: nouvelIdentifiant(),
        cle: definition.cle,
        valeur: definition.valeurDefaut,
        typeValeur: definition.typeValeur,
        dateDebutValidite: definition.dateDebutValidite,
        dateFinValidite: null,
        source: definition.source,
        description: definition.description,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    inseres.push(definition.cle);
  }

  return { inseres, deja_presents: dejaPresents, metadonneesMisesAJour };
}
