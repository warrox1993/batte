# 09 — Ajout manuel d'ingrédients et de garnitures

## Constat

Besoin exprimé de pouvoir ajouter soi-même de nouveaux ingrédients et de nouvelles sortes de
garniture, sans dépendre d'une intervention technique.

## Vérifier l'existant avant de coder

Le Lot 1 a posé un CRUD sur `ingredient`. Le manque probable n'est pas l'absence totale de
la fonction, mais son **accessibilité** : un écran d'administration séparé, peu visible,
plutôt qu'un ajout possible à l'endroit où le besoin surgit réellement (en plein milieu de
l'édition d'une recette, en plein milieu de la définition d'un produit vendu). Vérifier
précisément où la création d'ingrédient est aujourd'hui possible avant de recréer un écran
qui existe peut-être déjà ailleurs sous une autre forme.

## Ce qui doit changer

### Ingrédients

- Écran dédié de gestion des ingrédients (liste, création, modification) — s'il n'existe
  pas déjà sous cette forme.
- **Création à la volée** depuis l'écran d'édition de recette (fiche 04) : si l'ingrédient
  recherché n'existe pas, un raccourci propose de le créer immédiatement (nom, unité de
  référence, densité si pertinente, allergènes, catégorie) sans quitter l'écran de recette.
- Champ de recherche qui matche sur le nom ET les synonymes courants (« vergeoise » /
  « cassonade », par exemple), pour éviter les doublons de saisie.

### Garnitures

- `docs/02-MODELE-DONNEES.md` prévoit déjà `produit_garniture` (association produit vendu /
  ingrédient / quantité) pour les produits _transformés_. Une garniture nouvelle n'est donc
  pas une entité séparée à créer : c'est soit un `ingredient` de catégorie _garniture_ déjà
  couvert par le point précédent, soit un `produit_vente` de nature _revendu_ si elle est
  vendue telle quelle (un pot de sirop, voir `docs/02-MODELE-DONNEES.md` §« nature »).
  Vérifier que l'écran de gestion des ingrédients permet bien de créer un ingrédient de
  catégorie _garniture_ aussi simplement qu'une farine — pas de traitement spécial artificiel
  à construire pour les garnitures si le mécanisme général suffit déjà.

## Ce qui doit être relié

- Édition de recette (fiche 04).
- Calcul des allergènes (module 1) : tout nouvel ingrédient doit immédiatement pouvoir
  déclarer ses allergènes, agrégés automatiquement dans toute recette qui l'utilise.
- Stock (module 2) : un ingrédient nouvellement créé apparaît immédiatement dans l'écran
  Stock avec une quantité à zéro, prêt à recevoir une première réception — pas d'état
  intermédiaire bancal où l'ingrédient existe sans pouvoir être stocké.
- Fournisseurs et conditionnements : à la création d'un ingrédient, proposer d'associer tout
  de suite au moins un fournisseur et un conditionnement, sinon le point de commande
  (module 2) ne pourra jamais se calculer pour ce nouvel ingrédient.

## Critère de fin

Depuis l'écran d'édition d'une recette, ajouter un ingrédient qui n'existe pas encore
(exemple : une nouvelle confiture de fruit), le créer à la volée avec son unité, ses
allergènes et un fournisseur associé, l'intégrer à la recette, et le retrouver immédiatement
dans l'écran Stock à quantité zéro.

---

## Vérification du 01/08/2026 — confronté au code réel, dans les deux sens

### 1. Ce que la fiche demande est FAIT, sur presque tous les points

- **Écran dédié de gestion des ingrédients** : `apps/web/src/pages/Ingredients.tsx`, CRUD
  complet, conditionnements et fournisseurs rattachés.
- **Création à la volée depuis l'édition de recette** : `apps/web/src/pages/Recettes.tsx`,
  composant `FormulaireIngredientRapide` (mini-formulaire scopé à la ligne qui l'a ouvert —
  nom, catégorie, unité, densité si pertinente, allergènes).
- **Recherche par nom ET synonymes** : `packages/core/src/recherche-ingredients.ts`, testé
  (`recherche-ingredients.test.ts`), câblé sur le champ de recherche de `Ingredients.tsx`
  (placeholder « Nom ou synonyme courant — « cassonade » trouve aussi la vergeoise »).
- **Garnitures** : traitées comme une simple catégorie d'ingrédient, aucune entité séparée
  créée — exactement la vérification que demandait la fiche avant de coder quoi que ce soit
  de spécifique.
- **Câblage Stock** : le mini-formulaire l'annonce lui-même à l'écran (« cet ingrédient y
  apparaîtra immédiatement, actif, à quantité zéro dans l'écran Stock »).
- **Câblage fournisseur/conditionnement depuis l'écran Ingrédients** : sélectionner un
  ingrédient sans conditionnement affiche un état vide actionnable (« Sans format d'achat,
  cet ingrédient n'a pas de prix... aucune commande ne peut être générée » +
  bouton « Ajouter un conditionnement ») — la fiche demandait de « proposer d'associer tout
  de suite au moins un fournisseur et un conditionnement », c'est bien le cas, mais **depuis
  l'écran Ingrédients**, pas depuis la recette (voir point 3).

### 2. Ce que l'application fait EN PLUS

Le mini-formulaire de création rapide gère le cas `unite === 'piece'` en masquant le champ
densité (une quantité en pièces ne se convertit ni en masse ni en volume) — un garde-fou de
cohérence que la fiche ne demandait pas explicitement mais qui évite une densité posée sur un
ingrédient où elle ne serait jamais lue.

### 3. Ce qui manque à l'app — décrit, non codé

**Le critère de fin exact de la fiche n'est pas entièrement tenu en une seule saisie.** Il
demande : depuis l'édition de recette, créer l'ingrédient « avec son unité, ses allergènes
**et un fournisseur associé** », l'intégrer à la recette, le retrouver dans Stock à zéro.
Vérifié dans `Recettes.tsx` (commentaire de tête de `FormulaireIngredientRapide`) : le
mini-formulaire collecte nom, catégorie, unité, densité, allergènes — **volontairement pas**
le fournisseur ni le conditionnement, différés à l'écran Ingrédients (« Le fournisseur et le
conditionnement — donc le prix — se règlent ensuite depuis l'écran Ingrédients... cette
fiche-là n'a pas à la dupliquer pour rester lisible en une saisie »). C'est une décision
documentée et défendable (lisibilité du mini-formulaire), mais elle signifie concrètement
qu'associer un fournisseur à un ingrédient créé à la volée demande une **seconde visite
d'écran**, alors que le critère de fin de la fiche décrit une seule séquence continue.
