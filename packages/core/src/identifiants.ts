/**
 * Identifiants de toutes les tables : UUID v7 (docs/02-MODELE-DONNEES.md).
 *
 * Le v7 est prefixe par un horodatage milliseconde, donc naturellement trie par
 * ordre chronologique. C'est ce qui permet de paginer un journal de mouvements
 * ou un journal d'audit sans colonne de tri supplementaire, et ce qui donne des
 * index compacts sur SQLite.
 */

import { v7 as uuidv7 } from 'uuid';

export function nouvelIdentifiant(): string {
  return uuidv7();
}
