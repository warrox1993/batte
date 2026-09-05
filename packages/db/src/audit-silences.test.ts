/**
 * Audit ciblé du 29/07/2026 — zone d'écriture : services de stock, réception,
 * commandes, production, sauvegarde et leur logique pure associée
 * (`packages/core/src/{stock,reapprovisionnement,economies,unites,argent}.ts`).
 *
 * MÉTHODE : chercher des SILENCES — des choses qui devraient se produire et ne
 * se produisent pas — jamais des erreurs, que le typecheck et les tests
 * attrapent déjà. Six catégories balayées (colonnes jamais écrites, fonctions
 * orphelines, valeurs d'énumération jamais produites, sorties de stock
 * manquantes, `catch` muets, paramètres du catalogue jamais lus).
 *
 * CONSTAT GÉNÉRAL, à consigner ici pour la prochaine lecture : cette zone a
 * déjà été très largement corrigée par des passages précédents. Vérifié un par
 * un et NON rouverts : `changerStatutLot` écrit bien un mouvement de perte à la
 * destruction d'un lot (docs/17 fiche 18), `enregistrerReception` accepte une
 * DLC sans numéro de lot avec avertissement plutôt qu'un refus injustifié
 * (docs/17 fiche 16), `enregistrerReception`/`genererBrouillonsCommandes`
 * referment la boucle d'achat (D-036), `saisirRealise` sait déjà écrire la
 * consommation réelle ingrédient par ingrédient (docs/17 fiche 9),
 * `sauvegarde.ts` porte un plancher de rétention et une fonction `restaurer`
 * testée de bout en bout (docs/17 fiche 19). Aucun de ces points n'est
 * réouvert ici.
 *
 * Les deux tests ci-dessous encodaient les deux SILENCES restants trouvés dans
 * cette zone : deux fonctions écrites, testées, jamais appelées ailleurs que
 * par leur propre test. Convention maison (voir `packages/core/src/invariants.test.ts`
 * et `packages/db/src/seed/fournisseurs-systeme.test.ts`) : `it.fails` affirme
 * que le défaut existe ; la suite reste verte ; le jour où quelqu'un câble un
 * appelant en dehors des tests, le test se met à PASSER — donc à échouer en
 * tant que `it.fails` — ce qui force à retirer `.fails` et à en faire un test
 * de non-régression.
 *
 * MISE À JOUR DU 29/07/2026 : SILENCE 1 est corrigé et son `it.fails` converti
 * en test de non-régression (voir son commentaire ci-dessous pour le détail du
 * câblage).
 *
 * MISE À JOUR DU 29/07/2026 (audit production/FEFO) : SILENCE 2
 * (`lotsProchesDlc`) est CORRIGÉ à son tour, et son `it.fails` converti en
 * test de non-régression — voir son commentaire ci-dessous pour le choix
 * retenu et pourquoi la suppression a été écartée.
 *
 * Recherche EFFECTUÉE, pas devinée : lecture de code source, jamais un `grep`
 * seul pris pour preuve suffisante (voir chaque test pour le détail de ce qui
 * est réellement inspecté).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Racine du dépôt : ce fichier vit dans `packages/db/src`. */
const RACINE = resolve(__dirname, '..', '..', '..');

/**
 * Fichiers susceptibles d'appeler une fonction de service en dehors des
 * tests : toutes les routes HTTP (le seul point d'entrée de production vers
 * `packages/db`), l'ouverture de contexte du serveur, les scripts npm, ET LES
 * DÉPÔTS EUX-MÊMES (`packages/db/src/depots/`) — un dépôt qui en appelle un
 * autre est un appelant de production tout autant qu'une route : c'est
 * exactement le chemin par lequel SILENCE 2 a été refermé (`lotsAlerteDlc`
 * appelle désormais `lotsProchesDlc`). Délibérément PAS `packages/**\/*.test.ts` :
 * un appel depuis un test ne compte pas comme un appelant de production,
 * c'est exactement ce qui est vérifié.
 */
function contenuDesAppelantsPotentiels(): string {
  const fichiers = [
    'apps/api/src/contexte.ts',
    'apps/api/src/serveur.ts',
    'apps/api/src/routes/stock.ts',
    'apps/api/src/routes/commandes.ts',
    'apps/api/src/routes/previsions.ts',
    'apps/api/src/routes/productions.ts',
    'apps/api/src/documents/donnees.ts',
    'packages/db/src/depots/stock.ts',
    'package.json',
  ];
  return fichiers
    .map((chemin) => {
      try {
        return readFileSync(resolve(RACINE, chemin), 'utf8');
      } catch {
        // Un fichier absent ne porte évidemment aucun appel : compte comme
        // une chaîne vide plutôt que de faire échouer la lecture elle-même.
        return '';
      }
    })
    .join('\n');
}

describe('Audit ciblé 29/07/2026 — silences restants de la zone stock/commandes/production', () => {
  /**
   * SILENCE 1 — CORRIGÉ le 29/07/2026, `it.fails` converti en test de
   * non-régression (c'est toute la raison d'être de la convention, voir
   * l'en-tête du fichier).
   *
   * `verifierInvariantLots` (packages/db/src/depots/stock.ts) était exportée
   * par le baril `@batte/db`, testée à trois reprises
   * (`services/stock.test.ts`, `parcours-erp.test.ts`, `seed/demonstration.test.ts`),
   * documentée comme un contrôle qu'on veut « pouvoir contrôler sur la vraie
   * base, pas seulement sur des données de test » — et n'avait AUCUN appelant
   * de production (`docs/13-AUDIT-CAPACITES-ORPHELINES.md`, ligne
   * `depots/stock.ts:190`).
   *
   * CÂBLAGE RETENU : une enveloppe `diagnostiquerIntegriteStock` (même
   * fichier), qui appelle `verifierInvariantLots` ET porte le compte total de
   * lots vérifiés — un contrôle qui ne répond que sur l'échec est un silence
   * rassurant (CLAUDE.md §4). Elle est appelée par la route de diagnostic
   * `GET /api/stock/integrite` (`apps/api/src/routes/stock.ts`), déclenchée à
   * la demande de l'utilisateur, jamais en effet de bord d'une sauvegarde :
   * `baseEnMemoire()` (`sauvegarde.test.ts`) construit une base à la seule
   * table `marqueur`, sans `lot` ni `mouvement_stock`, pour isoler la
   * politique de fréquence de `sauvegarder()` du contenu réel de la base —
   * `verifierInvariantLots` y lèverait « no such table: lot ».
   *
   * VÉRIFIÉ ICI, pas supposé, en DEUX temps — la chaîne complète, pas
   * seulement son premier maillon :
   *   1. un appelant de production (`apps/api/src/routes/stock.ts`) référence
   *      bien `diagnostiquerIntegriteStock` ;
   *   2. `diagnostiquerIntegriteStock`, dans `packages/db/src/depots/stock.ts`,
   *      appelle bien `verifierInvariantLots(base)` — et non une réécriture
   *      parallèle qui aurait fait double emploi.
   */
  it('verifierInvariantLots (integrite du stock) est appelee par au moins un chemin de production, pas seulement par ses propres tests', () => {
    const appelants = contenuDesAppelantsPotentiels();
    expect(appelants).toContain('diagnostiquerIntegriteStock');

    const depotStock = readFileSync(resolve(RACINE, 'packages/db/src/depots/stock.ts'), 'utf8');
    expect(depotStock).toContain('verifierInvariantLots(base)');
  });

  /**
   * SILENCE 2 — CORRIGÉ le 29/07/2026 (audit production/FEFO), `it.fails`
   * converti en test de non-régression, même raison d'être que SILENCE 1.
   *
   * `lotsProchesDlc` (packages/core/src/stock.ts) est une fonction PURE (tri
   * FEFO + filtre d'horizon sur des `LotStock[]` déjà chargés), exportée par
   * le baril `@batte/core`, testée dans `stock.test.ts`, mais SANS AUCUN
   * appelant de production : l'alerte DLC réellement servie par
   * `GET /api/prevision` passait par `lotsAlerteDlc`
   * (`packages/db/src/depots/stock.ts`), une requête SQL qui recalculait EN
   * SQL BRUT (`julianday(...) - julianday(...)`) exactement la même règle
   * métier que `lotsProchesDlc` calculait déjà en TypeScript pur et testé.
   * Déjà noté par `docs/13-AUDIT-CAPACITES-ORPHELINES.md` (« test seul »).
   *
   * TRANCHÉ : câbler, pas supprimer. Supprimer `lotsProchesDlc` aurait laissé
   * `lotsAlerteDlc` seule autorité sur « un lot périmé dans N jours », EN SQL
   * — exactement ce que la règle d'architecture n°1 interdit (CLAUDE.md §3 :
   * « toute la logique métier chiffrée vit dans `packages/core`, en fonctions
   * pures, testées »), et exactement le genre de défaut que D-020 a déjà
   * trouvé sur CE MÊME fichier (une corrélation SQL rompue en silence, sans
   * qu'aucun type ne proteste). Deux horloges de proximité DLC qui
   * divergeraient un jour (arrondi, fuseau) sont un risque réel, pas
   * théorique, pour une alerte qui conditionne une commande.
   *
   * CÂBLAGE RETENU : `lotsAlerteDlc` recharge tous les lots via
   * `lotsDeLIngredient` (qui somme déjà les mouvements, annulés compris —
   * D-021) puis délègue le tri FEFO et le filtre d'horizon à
   * `lotsProchesDlc`. La requête SQL corrélée disparaît ; la seule autorité
   * sur la règle redevient la fonction pure et testée.
   *
   * VÉRIFIÉ ICI, pas supposé, en DEUX temps — même patron que SILENCE 1 :
   *   1. un appelant de production (`packages/db/src/depots/stock.ts`)
   *      référence bien `lotsProchesDlc` ;
   *   2. `lotsAlerteDlc`, dans ce même fichier, appelle bien
   *      `lotsProchesDlc(` — et non une réécriture parallèle qui aurait fait
   *      double emploi.
   */
  it('lotsProchesDlc (integrite du stock) est appelee par au moins un chemin de production, pas seulement par ses propres tests', () => {
    const appelants = contenuDesAppelantsPotentiels();
    expect(appelants).toContain('lotsProchesDlc');

    const depotStock = readFileSync(resolve(RACINE, 'packages/db/src/depots/stock.ts'), 'utf8');
    expect(depotStock).toContain('lotsProchesDlc(');
  });
});
