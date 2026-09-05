/**
 * Contrat HTTP de `GET /api/demarrage` — état DÉRIVÉ du parcours de premier
 * lancement (docs/06-UI-ET-PARCOURS.md, section « Parcours de premier
 * lancement », correction du 31/07/2026).
 *
 * CE QUE CE CONTRAT N'EST PAS. `docs/06` décrivait ce parcours comme une
 * « liste de cases à cocher persistante » — une DÉCLARATION que l'utilisateur
 * coche lui-même. Un audit a établi qu'aucun mécanisme de persistance
 * n'existe nulle part dans `apps/web/src` (ni `localStorage`, ni
 * `sessionStorage`), et qu'en construire un aurait de toute façon posé le
 * même défaut que celui déjà écarté pour le stock (CLAUDE.md §3 règle 5) :
 * une case cochée peut mentir, se désynchroniser, et survivre à la
 * suppression de ce qu'elle prétendait valider.
 *
 * Les huit champs ci-dessous sont donc des FAITS, calculés depuis la base à
 * chaque lecture (`packages/db/src/depots/demarrage.ts`), jamais déclarés.
 * Un état dérivé ne peut pas mentir.
 *
 * DEUX NATURES, JAMAIS MÉLANGÉES — dérivées en les RENCONTRANT plutôt qu'en
 * les devinant (`packages/db/src/chemin-minimal-session.test.ts`) :
 *
 *  - BLOQUANT (`aLieu`, `aRecette`, `aProduitVendable`, `aSession`) : sans
 *    cette création, `creerSession` ou `cloturerSession` lève une erreur
 *    nommée — la clôture est TECHNIQUEMENT impossible (chemin minimal
 *    absolu : quatre créations, section 5 du fichier ci-dessus).
 *  - FAUSSANT (`aIngredient`, `aReception`, `aRecetteActiveAvecLignes`,
 *    `aProductionRattacheeSession`) : rien ne bloque, mais un chiffre affiché
 *    ment tant que c'est faux. Le cas mesuré (même fichier, section 5) : une
 *    session se clôture avec succès et affiche pourtant un coût matière à
 *    zéro et une marge brute à 100 % du chiffre d'affaires — parce qu'aucun
 *    ingrédient n'a jamais été reçu ni consommé.
 *
 * Ce fichier ne décrit QUE la forme de la réponse HTTP. La décision de ce
 * qu'on en affiche — et le regroupement visuel bloquant / faussant — vit
 * dans `apps/web/src/pages/TableauDeBord.tsx` (`construireSignauxDemarrage`),
 * jamais ici : ce module ne doit dépendre ni de React ni d'aucun libellé
 * d'écran (règle d'architecture n°1, CLAUDE.md §3).
 */

import { z } from 'zod';

export const schemaEtatDemarrage = z.object({
  /** Au moins un lieu de marché actif existe. */
  aLieu: z.boolean(),
  /** Au moins une recette existe, quel que soit son statut ou ses lignes. */
  aRecette: z.boolean(),
  /** Au moins un produit vendable actif existe (transformé, revendu ou menu). */
  aProduitVendable: z.boolean(),
  /** Au moins une session existe (planifiée, en cours ou clôturée). */
  aSession: z.boolean(),
  /** Au moins un ingrédient actif existe. */
  aIngredient: z.boolean(),
  /** Au moins une réception active a eu lieu — du stock est réellement entré. */
  aReception: z.boolean(),
  /** Au moins une recette est ACTIVE et possède au moins une ligne. */
  aRecetteActiveAvecLignes: z.boolean(),
  /** Au moins une production a été lancée et rattachée à une session. */
  aProductionRattacheeSession: z.boolean(),
});

export type EtatDemarrage = z.infer<typeof schemaEtatDemarrage>;
