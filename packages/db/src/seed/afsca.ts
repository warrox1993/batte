/**
 * Tâches de nettoyage par défaut du plan AFSCA (Lot 8).
 *
 * Idempotent PAR TÂCHE, et non « si la table est vide » : une tâche ajoutée
 * plus tard à `CATALOGUE_TACHES_NETTOYAGE` doit pouvoir atteindre une base déjà
 * en usage, sans jamais toucher aux tâches déjà présentes qu'un utilisateur a
 * pu désactiver. Même contrat que `seedMotifs` et `seedParametres` : idempotent
 * sur l'existence (identifiée par le libellé), synchronisant zone et fréquence,
 * jamais l'activation — désactiver une tâche inutile est une décision humaine
 * que le seed ne doit jamais défaire.
 *
 * N'appelle rien : c'est à `seed/index.ts` de l'invoquer.
 */

import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { tacheNettoyage } from '../schema.js';

type DefinitionTacheNettoyage = {
  libelle: string;
  frequence: 'apres_session' | 'hebdomadaire' | 'mensuelle';
  zone: string;
};

/**
 * Plan de nettoyage minimal d'un stand de crêpes ambulant, gaz uniquement,
 * chaîne du froid passive (CLAUDE.md §6). Valeurs par défaut, modifiables et
 * complétables dans l'écran Registre AFSCA — ce catalogue n'est qu'un point
 * de départ, pas une liste réglementaire figée.
 */
const CATALOGUE_TACHES_NETTOYAGE: readonly DefinitionTacheNettoyage[] = [
  {
    libelle: 'Nettoyage de la plaque de cuisson (billig)',
    frequence: 'apres_session',
    zone: 'Cuisson',
  },
  {
    libelle: 'Désinfection des ustensiles de cuisson',
    frequence: 'apres_session',
    zone: 'Cuisson',
  },
  {
    libelle: 'Nettoyage du plan de travail et du bac à pâte',
    frequence: 'apres_session',
    zone: 'Préparation',
  },
  {
    libelle: 'Nettoyage et désinfection de la glacière',
    frequence: 'apres_session',
    zone: 'Chaîne du froid',
  },
  {
    libelle: 'Nettoyage des surfaces de vente et du comptoir',
    frequence: 'apres_session',
    zone: 'Stand',
  },
  {
    libelle: 'Contrôle et nettoyage des bouteilles de gaz et détendeurs',
    frequence: 'hebdomadaire',
    zone: 'Équipement gaz',
  },
  {
    libelle: 'Vérification et étalonnage de la sonde de température',
    frequence: 'hebdomadaire',
    zone: 'Chaîne du froid',
  },
  {
    libelle: 'Nettoyage approfondi du véhicule de transport',
    frequence: 'hebdomadaire',
    zone: 'Transport',
  },
  {
    libelle: 'Nettoyage des zones de stockage sec (farine, sucre)',
    frequence: 'mensuelle',
    zone: 'Stockage',
  },
  {
    libelle: "Contrôle de l'état général du matériel et des joints",
    frequence: 'mensuelle',
    zone: 'Équipement',
  },
] as const;

export type ResultatSeedAfsca = {
  inseres: string[];
  misAJour: string[];
};

export function seedAfsca(base: BaseBatte): ResultatSeedAfsca {
  const inseres: string[] = [];
  const misAJour: string[] = [];
  const maintenant = maintenantUtc();

  for (const definition of CATALOGUE_TACHES_NETTOYAGE) {
    const existante = base
      .select({
        id: tacheNettoyage.id,
        frequence: tacheNettoyage.frequence,
        zone: tacheNettoyage.zone,
      })
      .from(tacheNettoyage)
      .where(eq(tacheNettoyage.libelle, definition.libelle))
      .limit(1)
      .all();

    const ligne = existante[0];
    if (ligne !== undefined) {
      if (ligne.frequence !== definition.frequence || ligne.zone !== definition.zone) {
        base
          .update(tacheNettoyage)
          .set({ frequence: definition.frequence, zone: definition.zone, modifieLe: maintenant })
          .where(eq(tacheNettoyage.id, ligne.id))
          .run();
        misAJour.push(definition.libelle);
      }
      continue;
    }

    base
      .insert(tacheNettoyage)
      .values({
        id: nouvelIdentifiant(),
        libelle: definition.libelle,
        frequence: definition.frequence,
        zone: definition.zone,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    inseres.push(definition.libelle);
  }

  return { inseres, misAJour };
}
