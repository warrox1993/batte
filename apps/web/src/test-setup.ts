/**
 * Amorçage des tests d'interface — chargé UNIQUEMENT par le projet « web »
 * (voir `vitest.config.ts`), jamais par les tests de `packages/**` ni
 * d'`apps/api`, qui restent en environnement `node` et n'ont rien à faire d'un
 * DOM.
 *
 * ═══ Pourquoi ce fichier existe (01/08/2026) ═══
 *
 * La couverture réelle de l'application a été mesurée ce jour-là, sur les
 * QUATRE paquets et non sur le seul `packages/core` que la configuration
 * regardait jusqu'ici : 57 % au total, dont `apps/web` à **18 %**.
 *
 * La cause n'était pas la paresse : elle était structurelle. Sans DOM,
 * `renderToStaticMarkup` rend un composant UNE fois, dans son état initial.
 * Aucun `useEffect` ne s'exécute, aucun clic n'existe, aucune transition
 * d'état n'est atteignable — donc tout ce qui se passe APRÈS le premier rendu
 * était hors de portée de tout test, y compris la règle n°10 de CLAUDE.md
 * (« chaque écran doit être utilisable au clavier »), qui ne se vérifiait qu'à
 * la main.
 *
 * `jsdom` et `@testing-library` ont été installés le 01/08/2026 après
 * validation explicite du porteur — CLAUDE.md §7 l'exige pour toute
 * dépendance. Ce sont des dépendances de DÉVELOPPEMENT : elles ne partent
 * jamais dans le paquet servi au navigateur.
 *
 * Ce que ça ne change pas : les tests déjà écrits avec `renderToStaticMarkup`
 * restent valables et ne sont pas à réécrire. Ils prouvent le balisage rendu,
 * ce qui reste la bonne façon de vérifier une structure de tableau ou un
 * attribut d'accessibilité. Le montage réel s'ajoute pour ce qu'eux ne
 * pouvaient pas voir.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Deux fonctions du navigateur que jsdom N'IMPLÉMENTE PAS, et sans lesquelles
 * des composants parfaitement corrects lèvent au montage.
 *
 * Trouvées le 01/08/2026, dans l'heure qui a suivi l'installation de jsdom :
 *
 *  - `Element.prototype.scrollIntoView` — `Navigation` s'en sert pour recentrer
 *    la ligne courante. Tout montage de `Navigation`, donc de `App`, donc de
 *    n'importe quel écran rendu dans son cadre, échouait.
 *  - `URL.createObjectURL` / `revokeObjectURL` — c'est ainsi que
 *    `BoutonDocument` remet un PDF ou un classeur au navigateur. Le chemin
 *    NOMINAL du téléchargement était donc intestable ; seuls les chemins
 *    d'erreur passaient.
 *
 * Elles sont posées ICI, une fois pour toute la suite web, plutôt que
 * recopiées dans chaque fichier : l'oubli produit une erreur qui accuse le
 * composant (« scrollIntoView is not a function ») au lieu de l'environnement,
 * et coûte une enquête à chaque fois.
 *
 * `vi.fn()` et non une implémentation : on observe qu'un défilement est
 * DEMANDÉ, jamais qu'il a lieu — jsdom n'a ni mise en page ni pixels. Ce que
 * ça prouve reste réel (le composant appelle bien la bonne chose au bon
 * moment) ; ce que ça ne prouve pas se vérifie au navigateur.
 */
if (typeof Element !== 'undefined' && Element.prototype.scrollIntoView === undefined) {
  Element.prototype.scrollIntoView = vi.fn();
}
if (typeof URL !== 'undefined' && URL.createObjectURL === undefined) {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
}

/**
 * Sans ceci, chaque test laisse son arbre monté dans le `document` partagé du
 * fichier : le suivant trouve DEUX boutons « Enregistrer », et une requête par
 * rôle échoue avec un message qui accuse le composant au lieu du voisinage.
 * Le piège est d'autant plus vicieux qu'un test isolé passe et que seul
 * l'ordre d'exécution le révèle.
 */
afterEach(() => {
  cleanup();
});
