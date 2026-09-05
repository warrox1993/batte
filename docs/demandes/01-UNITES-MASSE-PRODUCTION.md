# 01 — Unités de masse en production

## Constat

L'écran Production (module 3, `docs/01-SPEC-FONCTIONNELLE.md`) affiche les quantités
d'ingrédients exclusivement en millilitres. Or une partie des ingrédients se pèsent
(farine, sucre, beurre) et non se mesurent en volume. Afficher « 1 208 ml de farine » n'a
pas de sens physique et empêche de vérifier la pesée à la balance de cuisine.

## Vérifier l'existant avant de coder

`ingredient.unite_reference` (docs/02-MODELE-DONNEES.md) est déjà **g | ml | piece** par
ingrédient — la donnée existe. Le problème est donc probablement dans la couche
d'affichage de l'écran Production, qui force un affichage en volume au lieu de respecter
l'unité déclarée de chaque ingrédient. Vérifier ce point précisément avant de toucher au
modèle de données : c'est un bug d'affichage, pas un manque de champ.

## Ce qui doit changer

- Chaque ligne d'ingrédient sur l'écran Production, l'écran Recette (calculateur) et tout
  document généré (fiche technique, étiquette) affiche la quantité **dans l'unité naturelle
  de l'ingrédient** : grammes pour un ingrédient pesé, millilitres pour un liquide, pièces
  pour un ingrédient dénombrable (œufs).
- Affichage automatique en **kg au-delà de 1000 g** et en **L au-delà de 1000 ml**, avec
  une décimale (« 1,21 kg », pas « 1208 g » — lisible d'un coup d'œil sur le stand).
- Le **volume total de pâte** de la production (`volume_theorique_ml` /
  `volume_reel_ml`) reste en millilitres/litres : c'est la seule grandeur homogène qui a du
  sens pour la pâte elle-même, tous ingrédients mélangés.
- Aucune conversion silencieuse entre masse et volume sans passer par `densite_g_par_ml`
  (règle déjà posée en `CLAUDE.md` §3, point 4) — ne pas la contourner ici.

## Ce qui doit être relié

- Écran Production (module 3)
- Calculateur de recette (écran Recette, `docs/06-UI-ET-PARCOURS.md` §5)
- Fiche technique PDF, étiquette de bac (module 6)
- Bon de commande fournisseur (les conditionnements sont déjà en unité native — vérifier la
  cohérence d'affichage à l'impression)

## Critère de fin

Sur une production de R2 (sarrasin-châtaigne), la farine de sarrasin s'affiche en grammes
ou en kilogrammes, le lait en millilitres ou en litres, les œufs en pièces — sans qu'aucun
ingrédient ne s'affiche dans une unité qui ne correspond pas à sa nature physique.

---

## Mise à jour du 01/08/2026 — vérifié dans le code réel : **fait**

La fiche est intégralement satisfaite, y compris son critère de fin. Vérifié en lisant le
code, pas la documentation.

**Où ça vit.** `packages/core/src/unites.ts` : `formaterQuantite(quantite, unite)` bascule en
kg/L au-delà de 1000 avec une décimale (« 1,2 kg », testé dans `unites.test.ts`), et
`convertir()` refuse toute conversion masse↔volume sans `densiteGParMl` (lève
`ErreurMetier('densite_manquante', …)`) ainsi que toute conversion impliquant `piece`
(`ErreurMetier('conversion_piece_impossible', …)`) — aucune conversion silencieuse possible.

**Câblage vérifié**, `formaterQuantite`/`libelleUnite` importés et utilisés dans :

- Écran Production — `apps/web/src/pages/Production.tsx` (`COLONNES_BESOINS`,
  `COLONNES_CONSOMMATIONS`, colonne « Volume » de `colonnesHistorique`) ;
- Calculateur de recette et comparaison de versions — `apps/web/src/pages/Recettes.tsx` ;
- Fiche technique PDF et étiquette de bac — `apps/api/src/documents/gabarits.ts`,
  `apps/api/src/documents/fiche-rappel.ts` ;
- Écrans Stock, Achats, Ingrédients, Registre AFSCA, saisie de réception/sortie, détail de
  lot, prévision calendaire — respectivement `Stock.tsx`, `Achats.tsx`, `Ingredients.tsx`,
  `RegistreAfsca.tsx`, `saisie-stock/SaisieReception.tsx`, `saisie-stock/SaisieSortie.tsx`,
  `saisie-stock/DetailLot.tsx`, `PrevisionCalendaire.tsx`, et côté serveur
  `apps/api/src/routes/previsions.ts`.

**Bon de commande fournisseur** (dernier point du § « Ce qui doit être relié ») :
`gabarits.ts` affiche la ligne de commande via `conditionnementLibelle` (le conditionnement
natif du fournisseur, ex. « sac de 25 kg »), jamais une quantité reconvertie — cohérence
d'affichage confirmée, rien à corriger.

**Rien à ajouter à la liste « manque ».** Aucun écran ni document n'a été trouvé affichant
une quantité dans une unité qui ne correspond pas à `ingredient.unite_reference`.
