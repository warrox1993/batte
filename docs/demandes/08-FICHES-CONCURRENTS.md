# 08 — Fiches concurrents

## Constat

Nouveau module, absent des spécifications initiales. Besoin : un écran pour répertorier les
concurrents observés (les deux vendeurs de crêpes déjà repérés à La Batte en sont le premier
exemple), avec leurs prix, leurs types de produits, et une fiche complète par concurrent.

## Vérifier l'existant avant de coder

Aucune table ni écran existant ne couvre ce besoin — c'est une création pure, pas une
extension. Vérifier tout de même qu'aucune table `fournisseur`-like n'a été détournée pour
ça entre-temps, ce qui serait un mauvais signe de modélisation à corriger plutôt qu'à
prolonger.

## Modèle de données à ajouter

### `concurrent`

`id`, `nom`, `lieu_id` (référence `lieu_marche` — un concurrent est observé à un endroit
précis), `type_offre` (_crepes | gaufres | autre_sucre | salé | mixte_), `positionnement`
(_bas_de_gamme | standard | premium_), `emplacement_observe`, `qualite_percue` (1–5,
appréciation subjective assumée comme telle), `date_derniere_observation`, `notes_generales`

### `concurrent_produit`

`id`, `concurrent_id`, `nom_produit`, `prix_cents`, `description`, `date_observation`
→ historisé : un même produit peut être observé à des prix différents dans le temps, ce qui
permet de suivre l'évolution des prix concurrents, pas seulement leur dernier relevé.

### `concurrent_observation`

`id`, `concurrent_id`, `date_observation`, `affluence_estimee` (_nulle | faible | moyenne |
forte_), `file_attente` (bool), `notes` (texte libre — ce que l'utilisateur a goûté, vu,
remarqué)

## Ce qui doit changer

- Écran Concurrents : liste des concurrents par lieu, avec leur dernière observation en
  aperçu, et une fiche complète par concurrent reprenant tous les produits et observations
  historisées.
- Formulaire de saisie rapide après une visite : produit(s) observé(s), prix, affluence,
  notes — pensé pour être rempli en quelques minutes après un passage sur le marché, dans le
  même esprit que la saisie de clôture de session (`docs/06-UI-ET-PARCOURS.md`).
- Comparateur simple : ta carte de prix (`produit_vente`) face aux derniers prix relevés par
  concurrent équivalent, pour visualiser ton positionnement tarifaire d'un coup d'œil.

## Ce qui doit être relié

- `lieu_marche` (un concurrent est rattaché à un lieu).
- Le moteur de prévision (`docs/03-MOTEUR-PREVISION.md`) ne consomme pas directement cette
  donnée en V1 — un concurrent n'est pas un facteur causal de la demande totale du marché,
  mais de sa répartition entre vendeurs. Documenter cette limite explicitement dans l'écran
  plutôt que de laisser croire à un lien automatique qui n'existe pas.
- Tableau de bord : un encart optionnel « dernière observation concurrent » si une visite
  n'a pas eu lieu depuis longtemps, pour ne pas laisser ces fiches se figer.

## Critère de fin

Créer une fiche pour chacun des deux concurrents déjà identifiés à La Batte, y renseigner au
moins un produit avec son prix et une observation qualitative, et visualiser le comparateur
de prix face à la carte actuelle.

---

## Vérification du 01/08/2026 — confronté au code réel, dans les deux sens

### 1. Ce que la fiche demande est FAIT

Module neuf, entièrement construit : tables `concurrent` / `concurrent_produit`
(historisée) / `concurrent_observation` (`packages/db/src/schema.ts`), écran
`apps/web/src/pages/Concurrents.tsx` (liste filtrable par lieu + fiche complète + formulaires
de saisie rapide « après une visite »), comparateur de prix servi par
`GET /concurrents/comparateur` (`apps/api/src/routes/concurrents.ts`,
`packages/db/src/depots/concurrents.ts`). La limite d'usage voulue par la fiche est reprise
littéralement à l'écran : « ce module n'alimente PAS le moteur de prévision » (commentaire de
tête de `Concurrents.tsx`). Intégré à la navigation existante, dans le groupe référentiel
(`composants/Navigation.tsx`), pas en entrée isolée.

### 2. Ce que l'application fait EN PLUS

Le comparateur ne se limite pas à un écran séparé : `ProchaineSession.tsx` porte un panneau
dépliant « Prix concurrents » directement rattaché à la session à venir (§« croisement
explicite des données » de la fiche 10) — la carte propre et les derniers prix concurrents
sont donc consultables **côte à côte au moment où la décision de production se prend**, ce
qui va au-delà du simple comparateur autonome demandé ici.

### 3. Ce qui manque à l'app — décrit, non codé

**a. L'encart « dernière observation concurrent » du tableau de bord n'existe pas.** La fiche
le demande explicitement (« un encart optionnel... si une visite n'a pas eu lieu depuis
longtemps, pour ne pas laisser ces fiches se figer »). `TableauDeBord.tsx` documente
lui-même pourquoi il n'a rien ajouté sur ce point précis : le « mouvement » concurrentiel
utile (ex. « deux concurrents ont augmenté leurs prix depuis votre dernier relevé ») n'est
**pas calculable aujourd'hui** — `GET /concurrents/comparateur` ne rend que le **dernier**
prix relevé par produit, jamais l'avant-dernier, alors que `concurrent_produit` est bien
historisé en base. Calculer cette comparaison demanderait une route dédiée
(le commentaire suggère `GET /concurrents/mouvements`), qui n'existe pas. Une alerte de
simple **ancienneté** (« aucune observation depuis N jours », sans comparaison de prix)
resterait calculable dès aujourd'hui à partir de `dateDerniereObservation`, mais n'a pas non
plus été construite.

**b. La liste des concurrents n'affiche plus la date de dernière observation « en aperçu ».**
La fiche demande une liste « avec leur dernière observation en aperçu ». `Concurrents.tsx`
documente un retrait délibéré de cette colonne : à 1280 px effectifs, les six colonnes
d'origine exigeaient ~575 px pour ne jamais replier une valeur, contre 551,7 px disponibles
— un écart mesuré, pas estimé. La donnée n'est pas perdue (elle reste consultable en un clic
dans la fiche complète du concurrent, « Observations — historique complet »), mais elle
n'est plus visible d'un coup d'œil dans la liste comme la fiche le demandait littéralement.

**c. Détail mineur de câblage** : les commentaires de `Concurrents.tsx`,
`apps/api/src/routes/concurrents.ts` et `packages/db/src/depots/concurrents.ts` décrivent
encore `packages/core/src/contrats/concurrents.ts` comme « hors du barrel `@batte/core` »,
avec un import relatif « temporaire ». Vérifié : `packages/core/src/contrats/index.ts`
exporte bien `./concurrents.js`, et `packages/core/src/index.ts` réexporte `contrats/index.js`
— le câblage au barrel est donc déjà fait, seuls ces commentaires sont restés en retard sur
le code.
