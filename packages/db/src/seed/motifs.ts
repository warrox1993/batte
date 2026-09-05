/**
 * Insertion des codes motifs depuis le catalogue de `packages/core`.
 *
 * Meme contrat que `seedParametres` : idempotent sur l'existence, synchronisant
 * sur le libelle. Le catalogue possede la documentation, la base possede
 * l'activation — desactiver un motif inutilise est une decision de
 * l'utilisateur, le seed ne doit jamais la defaire.
 */

import { CATALOGUE_MOTIFS, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { motif } from '../schema.js';

export type ResultatSeedMotifs = {
  inseres: string[];
  libellesMisAJour: string[];
};

export function seedMotifs(base: BaseBatte): ResultatSeedMotifs {
  const inseres: string[] = [];
  const libellesMisAJour: string[] = [];
  const maintenant = maintenantUtc();

  for (const definition of CATALOGUE_MOTIFS) {
    const existant = base
      .select({ id: motif.id, libelle: motif.libelle, categorie: motif.categorie })
      .from(motif)
      .where(eq(motif.code, definition.code))
      .limit(1)
      .all();

    const ligne = existant[0];
    if (ligne !== undefined) {
      if (ligne.libelle !== definition.libelle || ligne.categorie !== definition.categorie) {
        base
          .update(motif)
          .set({
            libelle: definition.libelle,
            categorie: definition.categorie,
            modifieLe: maintenant,
          })
          .where(eq(motif.id, ligne.id))
          .run();
        libellesMisAJour.push(definition.code);
      }
      continue;
    }

    base
      .insert(motif)
      .values({
        id: nouvelIdentifiant(),
        code: definition.code,
        libelle: definition.libelle,
        categorie: definition.categorie,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    inseres.push(definition.code);
  }

  return { inseres, libellesMisAJour };
}
