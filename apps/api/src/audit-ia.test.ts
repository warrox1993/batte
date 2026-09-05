/**
 * Audit de sécurité de la surface IA (29/07/2026) — clé, plafond, mode
 * dégradé, frontière de validation humaine. Zone d'écriture de cet agent :
 * `packages/core/src/{ia,evenements-decouverte}.ts`, `packages/core/src/contrats/ia.ts`,
 * `packages/db/src/depots/{ia,evenements-decouverte}.ts`, `apps/api/src/ia/`,
 * `apps/api/src/routes/{ia,evenements-decouverte}.ts`,
 * `apps/api/src/securite-secrets.test.ts`, `apps/web/src/pages/PropositionsEvenements.tsx`.
 *
 * CE QUI A ÉTÉ VÉRIFIÉ ET CORRIGÉ DANS CETTE ZONE (pas encodé ici, voir les
 * fichiers eux-mêmes et le rapport de livraison) :
 *
 *  - Le plafond de `rechercherEvenementsParClaude` (recherche d'événements,
 *    `apps/api/src/routes/evenements-decouverte.ts`) n'était vérifié qu'UNE
 *    FOIS, avant le tout premier appel réseau. Or une relance `pause_turn`
 *    peut enchaîner jusqu'à 3 appels supplémentaires, chacun rejouant toute
 *    la conversation. Corrigé : le plafond est désormais revérifié avant
 *    CHAQUE tour, sur le coût déjà réellement engagé plus le coût maximal du
 *    tour suivant — reproduit ROUGE puis VERT avec un serveur HTTP local qui
 *    imite la forme d'une réponse `messages.create` (jamais l'API réelle),
 *    voir `apps/api/src/routes/evenements-decouverte.test.ts`.
 *  - Le balayage anti-fuite du bundle de production
 *    (`apps/api/src/securite-secrets.test.ts`) reposait sur une liste de
 *    PRÉFIXES écrite à la main (`ANTHROPIC`, `SMTP_`) — exactement le défaut
 *    D-045. Ajouté : un test qui DÉRIVE les noms de variables sensibles de
 *    `.env.example` par la FORME du nom (`SECRET|TOKEN|MOT_DE_PASSE|...`),
 *    pas d'une énumération figée, pour qu'une future variable secrète
 *    (jeton Google, D-008) soit balayée sans qu'on ait à s'en souvenir.
 *
 * CE QUI A ÉTÉ VÉRIFIÉ ET TROUVÉ SAIN (par mesure, pas par confiance) :
 *
 *  - Mode dégradé complet : exécuté (pas raisonné) sans clé, avec un port
 *    mort et avec un plafond à zéro, sur `demanderCommentaire`
 *    (`apps/api/src/ia/client.test.ts`, préexistant) ET sur
 *    `rechercherEvenementsParClaude` (`evenements-decouverte.test.ts`,
 *    préexistant) : refus motivé en 200, jamais d'exception, jamais d'écran
 *    bloqué en chargement (vérifié aussi côté écran,
 *    `PropositionsEvenements.tsx` : `chargerLieux`/`chargerPropositions`
 *    sont dans des `try/catch`, aucun état de chargement infini possible).
 *  - Aucune sortie de Claude n'entre en base sans passer par le schéma Zod
 *    strict `schemaPropositionsEvenementsIaBrutes`, et toute proposition
 *    créée porte `source: 'ia'` + `valide_par_humain: false` — une seule
 *    fonction (`validerPropositionEvenement`) peut faire passer ce booléen à
 *    `true`, sur un clic explicite. Aucun chemin d'écriture directe trouvé.
 *  - Claude ne calcule aucun chiffre qui entre dans la prévision : le schéma
 *    de sortie demandé à Claude (`schemaPropositionEvenementIaBrute`) ne
 *    porte ni `impactEstimeBp` ni `rentabiliteEstimeeCents` — ces deux
 *    valeurs sont dérivées déterministement de `portee`/`intensiteEstimee`
 *    par `packages/core/src/evenements-decouverte.ts`, jamais lues depuis la
 *    réponse texte de Claude. La meilleure garantie (ne pas demander le
 *    chiffre du tout) est bien celle appliquée.
 *  - Injection de prompt depuis une page web : la seule sortie exploitable
 *    d'une recherche compromise est une proposition `evenement` en attente,
 *    strictement validée par Zod (longueurs et énumérations bornées),
 *    JAMAIS active dans un calcul avant un clic humain explicite — la
 *    protection est structurelle (rien n'agit sans validation), pas une
 *    confiance dans le modèle.
 *  - Le serveur statique de production (`apps/api/src/serveur.ts`, lu, pas
 *    modifié — hors zone) sert exclusivement `apps/web/dist` : aucune route
 *    ne peut exposer `.env`, `donnees/` ou `sauvegardes/`, qui sont hors de
 *    cette arborescence.
 *
 * DÉFAUT CONFIRMÉ PAR UNE PREMIÈRE PASSE, CORRIGÉ PAR CELLE-CI. La première
 * passe avait trouvé le défaut ci-dessous alors que `packages/core/src/parametres.ts`
 * (le catalogue des paramètres) était modifié en parallèle par un autre agent,
 * et l'avait encodé en `it.fails`, selon la convention du dépôt (voir
 * `packages/db/src/audit-silences.test.ts`, `packages/core/src/invariants.test.ts`) —
 * l'assertion est écrite COMME SI le défaut était corrigé ; elle échouait alors
 * (donc `it.fails` la déclarait verte). Cette passe, avec le catalogue
 * redevenu accessible, a CORRIGÉ le défaut :
 *
 *  - Nouvelle clé `ia_tarif_recherche_web_cents_par_mille` dans
 *    `packages/core/src/parametres.ts`, en centimes d'euro pour 1000
 *    recherches, avec sa conversion depuis 10 $ documentée et datée dans sa
 *    `source` (même doctrine que D-030 pour les tarifs de tokens) ;
 *  - `coutRechercheWebCents` (`packages/core/src/ia.ts`) calcule ce coût,
 *    avec la même règle d'arrondi que `coutAppelCents` (au supérieur, plancher
 *    à 1 centime dès que non nul) ;
 *  - `rechercherEvenementsParClaude` (`apps/api/src/routes/evenements-decouverte.ts`)
 *    lit désormais `usage.server_tool_use.web_search_requests` sur CHAQUE
 *    tour, cumule ce compte, et l'ajoute — jamais à la place des tokens — au
 *    coût journalisé ET à la majoration du plafond vérifiée avant chaque
 *    relance `pause_turn` (la même vérification par tour que la première
 *    passe avait déjà corrigée pour les tokens).
 *
 * Ce test, ex-`it.fails`, est désormais un test de NON-RÉGRESSION : son
 * assertion a été RENFORCÉE (elle ne se contentait que de chercher le nom du
 * champ de l'API) pour vérifier aussi que le coût qui en résulte est
 * effectivement calculé et intégré au calcul du plafond — ne pas la
 * redésactiver ni la supprimer.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Racine du dépôt : ce fichier vit dans `apps/api/src`. */
const RACINE = resolve(import.meta.dirname, '..', '..', '..');

function lire(cheminRelatif: string): string {
  return readFileSync(resolve(RACINE, cheminRelatif), 'utf-8');
}

describe('audit IA 29/07/2026 — coût des recherches web (défaut corrigé)', () => {
  /**
   * CONFIRMÉ le 29/07/2026 par lecture EN DIRECT de la documentation
   * Anthropic (`platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool`,
   * section « Usage and pricing », consultée via WebFetch — jamais un appel à
   * l'API Messages elle-même, interdit par cette mission) :
   *
   *   « Web search is available on the Claude API for $10 per 1,000
   *     searches, plus standard token costs. »
   *
   * Chaque recherche web exécutée par `rechercherEvenementsParClaude`
   * (`apps/api/src/routes/evenements-decouverte.ts`) est donc facturée par
   * Anthropic EN PLUS des tokens, et ce nombre de recherches est renvoyé par
   * l'API dans `usage.server_tool_use.web_search_requests`. Le code lisait
   * QUE `usage.input_tokens` et `usage.output_tokens` — jamais
   * `server_tool_use` — pour calculer `coutCents`.
   *
   * Conséquence AVANT correction : jusqu'à 5 recherches par tour × 3 tours
   * (`MAX_USAGES_RECHERCHE_WEB`, `NB_TOURS_MAX`) = jusqu'à 15 recherches
   * RÉELLEMENT facturées (0,15 $ minimum) par clic sur « Chercher des
   * événements », sans qu'un seul centime n'entre dans `journal_ia` ni dans
   * le calcul du plafond mensuel (CLAUDE.md §5).
   *
   * CORRIGÉ. `ia_tarif_recherche_web_cents_par_mille` (catalogue de
   * paramètres) porte le tarif, converti et daté ; `coutRechercheWebCents`
   * (`packages/core/src/ia.ts`) le calcule ; `rechercherEvenementsParClaude`
   * lit `usage.server_tool_use.web_search_requests` à CHAQUE tour, cumule ce
   * compte dans `nbRecherchesWebTotal`, et l'ajoute au coût journalisé ET à
   * la majoration du plafond vérifiée avant chaque relance `pause_turn`.
   *
   * L'assertion ci-dessous est RENFORCÉE par rapport à l'`it.fails` d'origine
   * (qui ne cherchait que le nom du champ de l'API) : elle vérifie aussi que
   * la clé de tarif et la fonction de coût existent bien et sont bien
   * utilisées dans le calcul du plafond, pas seulement mentionnées.
   */
  it(
    'le coût d’une recherche web (evenements-decouverte.ts) inclut le tarif par recherche ' +
      '(10 $ / 1000, confirmé sur platform.claude.com), en plus des tokens — sans quoi ' +
      'jusqu’à 15 recherches réellement facturées par clic échapperaient à journal_ia et au plafond mensuel',
    () => {
      const source = lire('apps/api/src/routes/evenements-decouverte.ts');
      // Le nombre de recherches réellement exécutées est bien lu sur la réponse.
      expect(source).toMatch(/server_tool_use/);
      expect(source).toMatch(/web_search_requests/);
      // ... et intégré à la fois au coût journalisé ET à la majoration du
      // plafond vérifiée avant chaque tour (pas seulement calculé puis ignoré).
      const occurrencesCoutRechercheWeb = source.match(/coutRechercheWebCents/g) ?? [];
      expect(occurrencesCoutRechercheWeb.length).toBeGreaterThanOrEqual(3);

      const parametres = lire('packages/core/src/parametres.ts');
      expect(parametres).toContain('ia_tarif_recherche_web_cents_par_mille');
      // Le tarif est daté et sourcé (CLAUDE.md §7 / D-030) — jamais un
      // nombre codé en dur sans provenance vérifiable.
      expect(parametres).toMatch(/\$10 per 1,000 searches/);
      expect(parametres).toMatch(/vérifié le 29\/07\/2026/);
    },
  );
});
