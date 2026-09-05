# 04 — Édition complète des recettes depuis l'application

## Constat

Le Lot 1 a posé les tables `recette` et `recette_ligne` avec un principe de versionnage
(une recette active est immuable, toute modification crée une nouvelle version — voir
`CLAUDE.md` §3 point 5 et `docs/02-MODELE-DONNEES.md`). Le besoin exprimé : pouvoir
**ajouter, modifier et retirer des ingrédients d'une recette existante**, et **créer de
nouvelles recettes entièrement depuis l'application**, sans repasser par un script ou une
insertion manuelle en base.

## Vérifier l'existant avant de coder

Le CRUD de base (Lot 1) permet-il déjà la création d'une recette avec ses lignes ? Si oui,
le manque porte probablement sur l'**édition d'une recette existante** (ajout/retrait de
lignes après coup) et sur le **respect effectif du versionnage** au moment de cette édition
— vérifier qu'une modification crée bien une version `n+1` plutôt que de modifier la ligne
en place, ce qui casserait le recalcul historique des coûts de production passées.

## Ce qui doit changer

- Écran d'édition de recette : ajouter une ligne d'ingrédient, en retirer une, modifier une
  quantité, avec recalcul en direct du coût matière total et par crêpe, et de la liste
  d'allergènes agrégée (module 1).
- Toute modification sur une recette **active** déclenche la création d'une version
  `n+1` et l'archivage de la précédente (règle déjà posée, à faire réellement respecter ici).
  Les productions déjà réalisées restent rattachées à la version utilisée au moment des
  faits — ne jamais réécrire l'historique.
- Écran de création d'une recette entièrement nouvelle depuis zéro : nom, code, type de
  pâte, sans gluten ou non, rendement de référence, lignes d'ingrédients, procédé, taux de
  perte de cuisson et de casse.
- Lors de l'ajout d'une ligne d'ingrédient à une recette, si l'ingrédient recherché n'existe
  pas encore dans le référentiel, proposer sa création à la volée plutôt que de bloquer
  l'utilisateur — voir fiche 09, qui doit être câblée ici.
- Un écran de **comparaison entre deux versions** d'une même recette (avant/après), pour
  visualiser ce qui a changé sans devoir deviner.

## Ce qui doit être relié

- Calculateur de recette et fiches PDF (module 1, déjà posé au Lot 1) — doivent refléter la
  dernière version active immédiatement.
- Écran Production (module 3) — doit toujours pointer vers une version précise, jamais « la
  recette » de façon ambiguë.
- Ajout d'ingrédient à la volée → fiche 09.
- Moteur de prévision (`docs/03-MOTEUR-PREVISION.md`) — la répartition entre recettes lors
  d'une nouvelle recette créée doit démarrer avec un prior neutre, comme n'importe quelle
  nouvelle donnée sans historique (voir principe de démarrage à froid déjà posé).

## Critère de fin

Depuis l'application, sans écrire une seule ligne SQL à la main : retirer un ingrédient de
R1, en ajouter un autre, vérifier que le coût matière recalculé est correct, vérifier qu'une
nouvelle version a été créée et que les productions passées de R1 restent inchangées, puis
créer une recette entièrement nouvelle et la voir apparaître partout où une recette doit
apparaître (production, calculateur, fiches).

---

## Mise à jour du 01/08/2026 — vérifié dans le code réel : **fait**

Toute la fiche est couverte, critère de fin compris.

**Routes** (`apps/api/src/routes/referentiel-ecriture.ts`) :

- `POST /recettes` (`:418`, `creerRecette`) — crée une recette en `brouillon`.
- `PATCH /recettes/:id` (`:435`, `modifierRecette`) — modifie en place.
- `POST /recettes/:id/versions` (`:452`, `creerVersionRecette`) — crée la version `n+1`,
  archive la précédente, rend `produitsSurVersionPrecedente`.
- `PATCH /recettes/:id/statut` (`:465`, `changerStatutRecette`).

**Écran** (`apps/web/src/pages/Recettes.tsx`) : `ajouterLigne`/`retirerLigne` (lignes
~1648/1664) avec recalcul en direct (route `/recettes/:id/calculer`, jamais recalculé côté
écran — règle d'architecture n°1 respectée) ; panneau « Nouvelle version » numéroté
(`libelleNouvelleVersion`) ; **panneau de comparaison de versions** (`comparaisonOuverte`,
`COLONNES_COMPARAISON`, `lignesComparaisonAffichees`, lignes ~720-2230), qui s'ouvre par
défaut sur une paire utile (version active vs son parent) — plus riche que ce que demandait
la fiche.

**Fiche 09 câblée, comme demandé.** `ouvrirCreationIngredient` / `creerIngredientRapide`
(`Recettes.tsx:1379-1520`) proposent la création d'un ingrédient à la volée quand la
recherche ne trouve rien, appellent `POST /ingredients`, puis remplissent automatiquement la
ligne avec l'ingrédient créé.

**Démarrage à froid câblé, comme demandé.** `partsRecettesActives`
(`packages/db/src/depots/previsions.ts:1615-1649`) : une seule recette active reçoit 100 % ;
plusieurs recettes actives sans aucune production historique rendent `null` plutôt que de
deviner une répartition égale — jamais un prior non neutre inventé.

**Raffinement à signaler, pas une contradiction.** La fiche écrit « toute modification sur
une recette active déclenche n+1 ». Le code applique une règle plus précise et plus fidèle à
l'intention de D-005 (`docs/05-DECISIONS.md`, « le coût matière historique doit rester
recalculable ») : c'est le fait d'avoir **déjà servi à au moins une production**
(`nbProductions(base, id) > 0`, erreur `recette_scellee` sinon) qui verrouille la
modification en place, pas le champ `statut` lui-même — une recette `active` jamais produite
(le cas cité dans le code : « R2 — semée vide, jamais produite ») peut donc encore être
modifiée en place. Ce n'est pas une contradiction avec D-005 (l'objectif — protéger le coût
des productions passées — est tenu à l'identique), seulement un déclencheur techniquement
différent du texte littéral de la fiche. Voir `packages/db/src/depots/referentiel-ecriture.ts:1160-1195`
(`modifierRecette`).

**Rien à ajouter à la liste « manque ».**
