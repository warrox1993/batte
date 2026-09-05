/**
 * Règles de domaine partagées sur les fournisseurs.
 *
 * DÉPLACÉ DEPUIS `apps/web/src/pages/Fournisseurs.tsx` (mission « garde-fou
 * fournisseur système : de l'écran au service, puis son vrai foyer »,
 * 31/07/2026). La fonction avait été extraite là — un bon réflexe pour cesser
 * de la recopier trois fois (`Factures.tsx`, `Ingredients.tsx`,
 * `Economies.tsx` avaient chacun leur propre copie, déjà divergées, voir
 * `packages/db/src/depots/referentiel.ts` pour un défaut de la même famille
 * côté serveur) — mais ce n'était pas son foyer : `Fournisseurs.tsx` est un
 * ÉCRAN, et `Factures.tsx`/`Ingredients.tsx`/`Economies.tsx` importaient donc
 * un module d'écran plutôt qu'un module de domaine. Si `Fournisseurs.tsx`
 * devient un jour chargé paresseusement (code-splitting par route), ces trois
 * écrans auraient tiré tout l'écran référentiel derrière un prédicat de trois
 * mots — une dépendance écran→écran intenable. `packages/core` est le foyer
 * que CLAUDE.md §3 règle 1 désigne : « toute la logique métier … vit dans
 * `packages/core`, en fonctions pures, testées ».
 *
 * `libelleType` et `statutFournisseur` restent dans `Fournisseurs.tsx` : ce
 * sont des règles d'AFFICHAGE (quel texte, quelle classe CSS), pas des règles
 * de domaine — leur foyer serait `packages/core/src/affichage.ts`, un
 * déplacement distinct, non fait ici faute d'argument le justifiant dans
 * cette mission.
 */

import type { Fournisseur } from './contrats/referentiel.js';

/**
 * Fournisseurs proposables pour une ÉCRITURE NOUVELLE qui en cite un : une
 * nouvelle facture, un nouveau conditionnement, une nouvelle économie
 * constatée hors réception.
 *
 * DEUX CONDITIONS, PAS UNE. « Inventaire d'ouverture » (type `systeme`) n'est
 * pas un fournisseur : c'est la contrepartie interne qui porte le stock déjà
 * présent avant l'installation de l'application
 * (`packages/db/src/seed/fournisseurs-systeme.ts`). Elle n'émet aucune
 * facture, on ne lui commande rien, et aucun conditionnement ne devrait
 * jamais la citer — l'exclure est aussi structurel que d'exclure un
 * fournisseur DÉSACTIVÉ (docs/07-DOCTRINE-ERP-ET-DESIGN.md §1.1, « Un
 * fournisseur désactivé … disparaît des listes de choix »).
 *
 * BALAYAGE DU 31/07/2026 (mission « deux restes de la chaîne d'achat »).
 * Les trois écrans cités ci-dessus réécrivaient ce filtre CHACUN À LA MAIN, et
 * avaient déjà divergé : `Factures.tsx` ne testait que `actif` — une facture
 * restait donc saisissable au nom d'« Inventaire d'ouverture » — et
 * `Economies.tsx` ne testait que `type`, en oubliant `actif` (un fournisseur
 * désactivé restait proposable pour une économie neuve). Seul `Ingredients.tsx`
 * avait les deux conditions. Une fonction unique, testée une seule fois
 * (`fournisseurs.test.ts`), plutôt que trois copies qui dérivent chacune à sa
 * manière — exactement le défaut que cette mission a mesuré.
 *
 * HORS CHAMP, DÉLIBÉRÉMENT : `saisie-stock/SaisieReception.tsx` (réception de
 * marchandise, y compris l'inventaire d'ouverture lui-même) n'appelle PAS
 * cette fonction — recevoir CONTRE la contrepartie système est exactement sa
 * raison d'être (voir le commentaire de
 * `packages/db/src/seed/fournisseurs-systeme.ts`), pas un oubli à corriger.
 *
 * LE SERVEUR PORTE DÉSORMAIS LA MÊME GARDE, À LA BONNE ALTITUDE : ce
 * prédicat d'écran rend une faute moins probable, il ne la rend jamais
 * impossible — une requête HTTP directe (`POST /api/factures`) n'exécute
 * aucun code de `apps/web`. `packages/db/src/services/factures.ts`
 * (`enregistrerFacture`) vérifie désormais explicitement le type et lève
 * `ErreurMetier('fournisseur_systeme', …)`, sur le même patron que
 * `depots/referentiel.ts`, `depots/economies.ts` et
 * `depots/referentiel-ecriture.ts`.
 */
export function fournisseursProposables(fournisseurs: readonly Fournisseur[]): Fournisseur[] {
  return fournisseurs.filter((f) => f.actif && f.type !== 'systeme');
}
