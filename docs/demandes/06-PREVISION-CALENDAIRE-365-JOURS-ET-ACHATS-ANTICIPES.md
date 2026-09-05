# 06 — Prévision calendaire sur 365 jours et achats anticipés

C'est la fiche la plus structurante du lot. L'idée centrale : la prévision ne doit plus
répondre seulement à « combien produire dimanche prochain ? », mais alimenter en continu
« ai-je déjà passé les commandes qu'il faut pour être prêt dans trois semaines ? ».

## Constat

Le moteur décrit en `docs/03-MOTEUR-PREVISION.md` calcule aujourd'hui **une prévision par
session**, généralement la prochaine. Le besoin exprimé va plus loin : une estimation pour
**chacun des 365 jours calendaires à venir**, reliée directement au réapprovisionnement, pour
qu'une forte demande prévue dans un mois déclenche une commande **maintenant**, pas la
semaine où elle devient urgente.

Exemple concret du principe (le chiffre donné par l'utilisateur était volontairement
exagéré, l'idée reste valide) : si le modèle prévoit une session à forte affluence dans
trois semaines — un jour d'événement type Ardentes — et que la farine a un délai de
livraison fournisseur de dix jours, l'alerte de commande doit apparaître **aujourd'hui**,
pas dans deux semaines quand il sera trop tard.

## Vérifier l'existant avant de coder

`docs/03-MOTEUR-PREVISION.md` pose déjà tout l'appareil de calcul par facteurs (météo,
événement, saison, tendance) et la décision par quantile. Rien de ceci n'est à jeter — cette
fiche **étend** le moteur à un horizon calendaire complet et le relie au module Stock, il ne
le remplace pas. Vérifier précisément ce qui existe déjà avant d'écrire du code neuf :
le calcul par facteurs est-il déjà une fonction réutilisable indépendamment d'une session
précise, ou est-il câblé uniquement à « la prochaine session » ?

## Ce qui doit changer

### 1. Prévision calendaire, pas seulement ponctuelle

- Générer, pour chaque jour des 365 jours à venir où une session est planifiée ou probable
  (chaque dimanche à La Batte a minima), une prévision complète selon le moteur déjà décrit
  (facteurs, intervalle P10/P50/P90, quantile de décision).
- Recalcul **quotidien** de l'ensemble de l'horizon (nouvelle météo disponible au fil des
  jours qui se rapprochent, nouveaux événements validés, nouvelles ventes réelles qui
  affinent la baseline). La prévision d'un jour lointain est volontairement plus incertaine
  que celle d'un jour proche — l'intervalle P10/P90 doit s'élargir avec l'horizon, pas rester
  constant.
- Stocker chaque recalcul (déjà prévu par la table `prevision` — vérifier qu'elle supporte
  bien plusieurs prévisions successives pour une même date future, pas une seule ligne
  écrasée à chaque recalcul, pour pouvoir mesurer plus tard la stabilité des prévisions dans
  le temps).

### 2. Besoins d'ingrédients projetés sur l'horizon

- À partir de la prévision calendaire et des recettes actives, calculer le **besoin projeté
  en ingrédients** pour chaque semaine de l'horizon (`crêpes prévues × grammage recette`).
- Comparer ce besoin cumulé au **stock actuel + commandes déjà en cours**, semaine par
  semaine, pour détecter une rupture prévisible avant qu'elle ne devienne un point de
  commande classique (module 2).

### 3. Point de commande prédictif — l'extension la plus importante

Le point de commande actuel (`docs/01-SPEC-FONCTIONNELLE.md` module 2) se fonde sur une
consommation moyenne journalière historique :

```
point_de_commande = consommation_moyenne_journalière × délai_livraison_jours + stock_sécurité
```

Cette formule est aveugle à un pic de demande prévu au-delà de la fenêtre de délai de
livraison immédiat. **Elle doit être complétée**, sans être supprimée, par un second
déclencheur :

```
alerte_anticipee = besoin_projeté_sur_fenêtre(délai_livraison_jours à
                    délai_livraison_jours + marge_securite_jours)
                   > stock_actuel + commandes_en_cours
```

Autrement dit : on regarde la demande prévue non pas à partir d'aujourd'hui, mais **dans la
fenêtre correspondant au délai de livraison**, en tenant compte des événements déjà connus
sur cette fenêtre. Si un événement à forte affluence est prévu dans trois semaines et que
le fournisseur de farine met dix jours à livrer, l'alerte doit se déclencher dès qu'on entre
dans la fenêtre où commander aujourd'hui serait encore assez tôt pour être prêt à temps —
et non pas seulement quand le stock courant passe sous le seuil habituel.

### 4. Écran dédié

Un écran « Besoins projetés » (ou une section du Tableau de bord) qui montre, semaine par
semaine sur l'horizon, le volume de crêpes prévu, le besoin en ingrédients clés qui en
découle, et une alerte explicite quand une commande doit partir maintenant pour couvrir un
pic à venir — avec le raisonnement affiché en clair, dans le même esprit que l'écran
Prochaine session déjà maquetté (`docs/06-UI-ET-PARCOURS.md`) : le chiffre seul ne suffit
pas, il faut le pourquoi.

## Ce qui doit être relié

- Module 2 (Stock) : le calcul du point de commande s'enrichit du déclencheur prédictif
  ci-dessus, sans remplacer le déclencheur réactif existant — les deux coexistent, le plus
  contraignant des deux déclenche l'alerte.
- Module 5 (Événements) et fiche 05 : un événement validé à J+21 doit se répercuter dans le
  besoin projeté dès sa validation.
- `npm run backtest` (déjà prévu en fin de `docs/03-MOTEUR-PREVISION.md`) : à étendre pour
  rejouer l'historique sur un horizon calendaire complet, pas seulement session par session.
- Fiche 07 (rétention des ventes) : plus l'historique est long et complet, plus la baseline
  et la saisonnalité de ce calcul calendaire seront fiables — les deux fiches se renforcent
  mutuellement.

## Critère de fin

Créer un événement fictif à fort impact dans trois semaines (via le module Événements),
vérifier que le besoin projeté en farine grimpe sur cette semaine-là dans l'écran dédié, et
que l'alerte de commande anticipée se déclenche dès aujourd'hui si le délai fournisseur
l'exige — avant que le point de commande réactif classique ne l'aurait fait de lui-même.

---

## Vérification du 01/08/2026 — confronté au code réel, dans les deux sens

### 1. Ce que la fiche demande est FAIT, très largement

`docs/03-MOTEUR-PREVISION.md` (sections « Prévision calendaire jusqu'à 365 jours » et
« Cinq facteurs de précision ajoutés après la V1 ») documente déjà l'essentiel de cette fiche
comme **`[RÉEL]`**, vérifié à nouveau ici directement contre le code :

- **Prévision calendaire** : `GET /prevision-calendaire` (`apps/api/src/routes/previsions.ts`,
  fonction `previsionCalendaireComplete`), horizon par défaut lu au catalogue
  (`prevision_horizon_calendaire_jours`, 365 j), écrêté par `Math.min(horizonDemande,
horizonMaxJours)`. Chaque jour porte son propre intervalle P10/P90, élargi avec la distance
  calendaire par `packages/core/src/prevision/horizon.ts` — l'exigence « l'intervalle doit
  s'élargir avec l'horizon » est tenue.
- **Besoins d'ingrédients projetés** : `packages/core/src/prevision/besoins-ingredients.ts`,
  regroupé par semaine (`regrouperParSemaine`), exposé dans `semaines[].besoinsIngredients`.
- **Point de commande prédictif** : `packages/core/src/prevision/point-commande-predictif.ts`
  et `alertesReapproPredictives` dans la réponse de l'API — le second déclencheur coexiste
  bien avec le point de commande réactif, sans le remplacer, exactement comme demandé.
- **Écran dédié** : `apps/web/src/pages/PrevisionCalendaire.tsx` (« Besoins projetés »),
  avec sélecteur d'horizon (4/12 semaines/horizon complet), raisonnement affiché
  (`exploitable: false` → « trop incertain », jamais un chiffre qui se déguise en prévision),
  et intégré à la navigation (`composants/Navigation.tsx`, groupe « Prévision »).
- **Câblage module 5 (Événements)** : `evenementsDuJour` alimente chaque jour calendaire dès
  qu'un événement est validé.
- **`npm run backtest`** (`packages/db/src/scripts/backtest.ts`) compare déjà le modèle complet
  à une baseline naïve en MAPE hors échantillon (fiche 8 de `docs/17`).

### 2. Ce que l'application fait EN PLUS — la fuite d'information fermée le 01/08

**D-089 et son complément du 01/08/2026** (`docs/05-DECISIONS.md`) corrigent un défaut qui
touche directement la fiabilité de TOUTE cette fiche, sans que la fiche elle-même ne le
mentionne : la validation croisée _leave-one-out_ qui décide quels prédicteurs entrent dans
le calcul (dont la tendance, qui alimente la prévision calendaire) laissait filtrer des
sessions **postérieures** au point évalué dans le calcul de référence — une fuite fermée dans
`packages/core/src/prevision/baseline.ts` (`ageEnJours`/`poidsTemporel`, canonique) puis
partagée par les modules qui la dupliquaient (`saison.ts`, `jour-semaine.ts`,
`vacances-scolaires.ts`, `session-consecutive.ts`). Mesuré : sur une rampe linéaire de
40 sessions, le prédicteur de tendance passait de **rejeté (−317 bp)** à **admis (+1052 bp)**
après correction — un modèle qui restait « plus bête qu'il ne devait l'être, en permanence ».
`comparable-calendaire.ts` et `tendance.ts` sont sains par construction (garde d'âge propre,
filtre déjà sur la date) et n'ont pas eu besoin de correction. Deux tests d'intégration sont
tombés à dessein (ils décrivaient une admission qui dépendait de la contamination) ; deux
autres restent rouges pour une raison de fixture assumée (voir le complément D-089).
**Conséquence directe pour cette fiche** : l'alerte de commande anticipée et le besoin
projeté qu'elle sert reposent sur une admission de prédicteurs désormais correcte — avant le
01/08, un signal de tendance réel pouvait être rejeté à tort et ne jamais alimenter l'horizon
calendaire.

### 3. Ce qui manque à l'app — décrit, non codé

**a. Aucun recalcul quotidien automatique n'existe.** La fiche demande un « recalcul
quotidien de l'ensemble de l'horizon ». Il n'existe **aucun ordonnanceur** dans la stack —
l'application est un serveur Fastify lancé à la demande (`npm run dev`), pas un service qui
tourne en continu. `/prevision-calendaire` recalcule tout l'horizon **à chaque appel GET**,
ce qui couvre le besoin fonctionnel (la donnée est toujours fraîche à l'ouverture de
l'écran) mais ne réalise aucun recalcul en arrière-plan un jour où personne n'ouvre
l'application — donc aucune alerte anticipée ne peut « apparaître » de façon proactive un
jour où l'utilisateur n'a pas lui-même ouvert l'écran « Besoins projetés » ou le tableau de
bord.

**b. Aucune prévision calendaire n'est archivée.** C'est le point le plus précis à corriger
dans la fiche elle-même : son §1 demande de « vérifier que [la table `prevision`] supporte
bien plusieurs prévisions successives pour une même date future, pas une seule ligne
écrasée à chaque recalcul, pour pouvoir mesurer plus tard la stabilité des prévisions dans
le temps ». Vérifié : la table `prevision` (`packages/db/src/schema.ts:1436`) n'a bien
**aucune contrainte d'unicité** qui empêcherait plusieurs lignes pour un même
`sessionId`/une même date — sur ce point précis, rien n'empêcherait la stabilité d'être
mesurée. Mais en pratique, **aucune ligne n'est jamais insérée pour un jour de l'horizon
calendaire** : `previsionCalendaireComplete` (`apps/api/src/routes/previsions.ts:1128`)
ne fait **aucun** appel à `archiverPrevision`. Le seul chemin d'écriture est
`POST /prevision/archiver` (`apps/api/src/routes/previsions.ts:1309`), qui n'archive QUE la
prévision de la **prochaine session unique**, et seulement sur un **clic explicite** de
l'utilisateur (« Archive la prevision courante. Acte explicite : on n'archive pas à chaque
affichage. », commentaire du même fichier). Conséquence : la stabilité d'une prévision à
J+90 dans le temps (le recalcul de la semaine 13 était-il le même il y a un mois ?) n'est
aujourd'hui **mesurable pour aucun jour de l'horizon calendaire** — seule la prévision de la
toute prochaine session peut l'être, et seulement si l'utilisateur clique sur « Archiver ».
Ceci n'est pas codé ici, conformément à la mission ; à trancher par le porteur si cette
mesure de stabilité doit être construite (elle demanderait soit un job explicite déclenché à
l'ouverture de l'app, soit un archivage automatique à chaque appel de
`/prevision-calendaire`, avec l'arbitrage de volume de données que cela implique — rappel
fiche 07, aucune purge n'est prévue).
