# Fiche 13 — Coût complet et arbitrage entre lieux

> **Origine** : idées dictées par le porteur le 29/07/2026, mises en forme par Claude Code.
> **Statut** : brouillon à relire et amender par le porteur. Rien n'est codé.
> Les points marqués **[À TRANCHER]** attendent une décision ; les **[HYPOTHÈSE]** sont des
> suppositions de rédaction qu'il faut confirmer ou corriger.
>
> **Note de statut — 29/07/2026, vérifiée contre le code.** Le cœur déjà tranché de cette fiche
> est implémenté (**D-060**, `docs/05-DECISIONS.md`) : coût kilométrique au catalogue
> (`cout_kilometrique_cents_par_km`), `packages/core/src/deplacement.ts` (coût de déplacement,
> coût d'emplacement, fiabilité de lieu, marge nette attendue), écran de comparaison entre lieux.
> **Tous les points encore marqués `[À TRANCHER]` ci-dessous restent ouverts** — non traités par ce
> lot, D-060 le dit explicitement : point de départ unique ou par session, enchaînement de deux
> marchés le même jour, répartition des charges fixes par session, voie B du coût kilométrique
> (frais réels mesurés).
>
> **⚠️ Périmé — voir la « Note de statut — 01/08/2026 » en fin de fiche.** Les quatre points
> ci-dessus ont depuis été tranchés en séance avec le porteur le 30/07/2026 (**D-064**, **D-065**)
> et sont, pour l'essentiel, câblés dans le code.

---

## 1. La demande, dans ses mots

> « Un vrai point d'amélioration dans la comptabilité est que je puisse enregistrer **100 % de mes
> frais** afin de calculer les prévisions et la rentabilité et vérifier **combien je gagne
> réellement** en tenant compte de 100 % de mes frais. Pour ce point on va devoir creuser et
> rajouter cela et **relier cela dans les prévisions**.
>
> Par exemple si un lieu est à 50 km et je gagnerais en prévision 5000 alors que celui à 20 km me
> ferait gagner 4999, on va donc **privilégier le plus proche**. »

Et, en réponse à la question « comptes-tu ton temps de trajet comme un coût ? » :

> « Le temps de trajet **n'a pas de coût direct**, mais il faut compter **l'usure des pneus,
> l'entretien du véhicule, le carburant**. »

---

## 2. Le point central : ce sont DEUX chiffres, pas un

C'est la chose à ne pas rater dans cette fiche. La demande contient deux questions différentes,
qui n'utilisent pas les mêmes coûts. Les confondre produit de mauvaises décisions.

### 2.1 « Combien je gagne vraiment » → coût COMPLET

Tout ce qui sort de la poche sur l'année : matière, déplacement, emplacement, gaz, assurance,
cotisations INASTI, amortissement de la remorque et des plaques, frais bancaires, etc.

C'est un chiffre **annuel ou par exercice**. Il répond à « est-ce que cette activité me rapporte
quelque chose, oui ou non ».

### 2.2 « Quel marché faire » → coût DIFFÉRENTIEL

Seulement ce qui **change selon le lieu choisi**.

L'assurance coûte pareil qu'on aille à 20 ou à 50 km. L'inclure dans une comparaison ne change pas
le classement — mais elle **écrase l'écart** : deux marchés qui diffèrent de 12 € de carburant
paraîtront identiques une fois noyés sous 300 € de charges fixes mensuelles.

L'exemple du porteur le montre : 5 000 contre 4 999, c'est un écart d'un euro. Mais si les 30 km
supplémentaires coûtent une vingtaine d'euros de véhicule, **le plus proche gagne largement** — et
c'est le calcul qui doit le dire, pas l'intuition.

> **Règle de conception** : un écran qui compare des lieux n'affiche JAMAIS les charges fixes.
> Un écran qui dit « combien je gagne » les affiche TOUTES.

---

## 3. Le coût du déplacement : un seul paramètre

Décision du porteur, déjà prise : **pas de taux horaire, pas de valorisation du temps.**

Ce qui reste est un **coût kilométrique tout compris** :

| Composante            | Nature                    |
| --------------------- | ------------------------- |
| Carburant             | sortie de caisse directe  |
| Usure des pneus       | sortie de caisse différée |
| Entretien du véhicule | sortie de caisse différée |

C'est plus simple **et** plus défendable qu'un coût horaire : ce sont des dépenses réelles, pas une
valeur d'usage estimée.

### 3.1 Comment fixer ce coût — deux voies

**[À TRANCHER]**

- **Voie A — un forfait au km.** Un seul nombre, révisable. L'**indemnité kilométrique** officielle
  belge (révisée chaque année) est la référence usuelle pour ce type de forfait.
  _Avantage_ : immédiat, aucun relevé à tenir. _Inconvénient_ : ne reflète pas le véhicule réel.
- **Voie B — les frais réels, recalculés.** On saisit les pleins, les pneus, les entretiens, et
  l'application divise par les kilomètres parcourus pour obtenir un coût au km **observé**.
  _Avantage_ : c'est le vrai chiffre, et il s'affine tout seul. _Inconvénient_ : demande de saisir
  ses pleins.

**[HYPOTHÈSE de rédaction]** : commencer en A avec un paramètre, et laisser B arriver plus tard
comme un affinage — l'un n'empêche pas l'autre, B ne fait que remplacer la valeur de A par une
valeur mesurée. Dans les deux cas la valeur vit dans la table `parametre` avec sa date de validité
et sa source, jamais en dur dans le code (CLAUDE.md §7).

### 3.2 Question pour le comptable

**La déductibilité de ces frais de véhicule** (forfait kilométrique ou frais réels, et à quel
pourcentage) est une question fiscale que l'application ne tranche pas. À ajouter à la liste des
questions du comptable.

---

## 4. Ce qui manque aujourd'hui dans l'application

| Élément                  | État actuel                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Frais de déplacement     | existent, mais **saisis à la main après coup** (`fraisDeplacementCents`), jamais prédits                                              |
| Distance domicile → lieu | **absente**. `lieuMarche` a `latitude` / `longitude` (pour la météo), mais aucune distance, et aucun point de départ n'est enregistré |
| Coût au kilomètre        | **inexistant**                                                                                                                        |
| Frais fixes répartis     | jamais alloués à une session — ils vivent dans `depense` et `immobilisation`                                                          |
| La prévision             | sort un **nombre de crêpes**, pas une **marge nette par lieu**                                                                        |

### 4.1 Le vrai nœud : la prévision s'arrête trop tôt

Aujourd'hui le moteur dit **« produis 203 crêpes »**.

Il ne dit pas **« ce marché te rapportera 180 € nets, cet autre 165 € »**.

C'est pourtant la même mécanique, poussée d'un cran : crêpes prévues → CA attendu → moins la
matière → moins l'emplacement → moins le déplacement → moins le gaz → **marge nette attendue**.

Tous les ingrédients existent déjà séparément. Ce qui manque est le chaînage et l'écran qui compare.

---

## 5. Points à trancher avant de coder

1. **[À TRANCHER] Le point de départ.** Une adresse de domicile unique ? Ou un point de départ par
   session (on ne part pas toujours de chez soi) ?
2. **[À TRANCHER] La distance.** Saisie à la main par lieu (simple, fiable, mais du travail au
   premier usage) ou calculée depuis les coordonnées ? Attention : une distance à vol d'oiseau
   n'est pas une distance routière — l'écart courant est de 20 à 40 %.
3. **[À TRANCHER] Aller-retour.** Le coût compte-t-il 2 × la distance ? **[HYPOTHÈSE]** oui,
   toujours, sauf enchaînement de deux marchés le même jour.
4. **[À TRANCHER] Répartition des frais fixes.** Pour le chiffre « combien je gagne vraiment »,
   faut-il répartir l'assurance et l'amortissement **par session** (et alors selon quelle clé :
   nombre de sessions ? chiffre d'affaires ?), ou les laisser au niveau de l'exercice annuel ?
   **[HYPOTHÈSE]** : au niveau de l'exercice seulement. Toute répartition par session est une
   convention arbitraire qui donnerait un faux sentiment de précision.

---

## 6. Ce que ça rend possible

- Classer les marchés existants par **marge nette réelle**, pas par chiffre d'affaires.
- Répondre à « ce déplacement vaut-il le coup ? » **avant** de s'engager.
- Détecter un marché qui rapporte beaucoup en CA mais peu en net (emplacement cher, trajet long).
- Alimenter la fiche 14 (événements comme opportunités), qui a besoin exactement de ce calcul.

---

## 7. Lien avec les autres fiches

- **Fiche 14 — Événements comme opportunités** : dépend directement de cette fiche. Sans marge
  nette par lieu, on ne peut pas classer une opportunité.
- **Fiche 05 — Découverte d'événements par l'IA** : fournit les lieux candidats.
- **Fiche 12 — Économies d'achat** : même esprit, côté achats.

---

## Note de statut — 01/08/2026, vérifiée contre le code

**Les quatre points `[À TRANCHER]` du §5 sont désormais tous tranchés**, en séance avec le
porteur le 30/07/2026 (**D-064** — « Le déplacement se modélise comme une TOURNÉE réelle, pas
comme un aller-retour », et **D-065** — « La distance d'un lieu est CALCULÉE une fois, vérifiée
par le porteur, et jamais réécrite », `docs/05-DECISIONS.md`). Le tableau ci-dessous répond
précisément à ce que la mission demandait : lesquels sont réglés dans le code, lesquels restent
ouverts.

| Point `[À TRANCHER]` (fiche, §5)                      | Décision                                                                                                                                                                                                               | État dans le code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Le point de départ (adresse unique ou par session) | D-064 pt.1 : adresse de domicile en paramètre (`adresse_depart_defaut`), **surchargeable par session** (`session_marche.point_depart_texte`)                                                                           | **Câblé** — `packages/core/src/point-depart.ts::resoudrePointDepartSession` (la session prime toujours sur le défaut) ; appelé par `apps/api/src/routes/referentiel-ecriture.ts` au calcul de distance d'un lieu. `point-depart.test.ts` couvre les trois cas                                                                                                                                                                                                                                                                          |
| 2. La distance (saisie ou calculée)                   | D-065 : **calculée automatiquement** via OpenRouteService à la création/modification d'un lieu, **stockée**, puis vérifiable/corrigible par le porteur — jamais réécrite silencieusement après une correction manuelle | **Câblé** — `apps/api/src/itineraire/client.ts::calculerDistanceRoutiere`, appelé par `referentiel-ecriture.ts`. Mode dégradé complet si la clé `OPENROUTESERVICE_API_KEY` est absente ou le service indisponible : refus motivé, jamais `0`, saisie manuelle toujours possible. **Non vérifié par cette mission** : si la clé est effectivement configurée sur le poste du porteur (`docs/en-attente-du-porteur.md` la liste comme en attente) — sans elle, le calcul automatique reste en mode dégradé et la saisie manuelle prévaut |
| 3. Aller-retour (2× systématique ?)                   | D-064 pt.3 : **pas d'interrupteur** — champ des kilomètres réels de la session **libre**, pré-rempli à 2× la distance de référence du lieu                                                                             | **Câblé** — `packages/core/src/deplacement.ts::coutDeplacementSessionCents` (estimation théorique, toujours 2×) et `imputationTourneeDeplacement` (répartition réelle, voir point suivant). `session_marche.distance_reelle_km` lu/écrit dans `services/sessions.ts` et affiché dans `Sessions.tsx`                                                                                                                                                                                                                                    |
| 4. Trajet mixte / répartition des frais fixes         | D-064 pt.4 (trajet mixte) : la session porte 2× sa distance de référence, le surplus va aux achats. D-064 pt.5 (frais fixes) : **au niveau de l'exercice annuel seulement**, jamais réparti par session                | **Câblé** pour le trajet mixte — `imputationTourneeDeplacement` (`deplacement.ts`), persisté à la clôture (`coutDeplacementReelSessionCents`/`coutDeplacementReelDetourAchatsCents`, `services/sessions.ts:1495-1496`) et affiché dans `Sessions.tsx`. **Structurellement respecté** pour les frais fixes — `calculerMargeAttendueLieu` (`deplacement.ts`) n'inclut explicitement AUCUNE charge fixe, par construction, pas par une règle qui pourrait être contournée                                                                 |

**Le §3.1 (voie A forfait / voie B frais réels mesurés) est également tranché** : « les deux sont
construits » (D-064). `coutKilometriqueRetenu` (`deplacement.ts`) décide entre le forfait officiel
(catalogue, `cout_kilometrique_cents_par_km`) et un coût **mesuré** sur les pleins de carburant
réels (`mesureCoutVehicule`), sous conditions cumulatives (assez de pleins, kilomètres réels
positifs, coût mesuré strictement positif) — jamais deviné à partir d'un ou deux pleins isolés.

### Ce qui reste effectivement en dehors de cette mission

- La note de D-064 elle-même signale qu'au 30/07/2026, trois colonnes restaient à créer ; elles
  existent désormais (migrations postérieures), mais cette mission n'a pas ré-exécuté les tests
  (`npm run test` non lancé, consigne de la mission) — l'existence du code est vérifiée par
  lecture, pas par exécution.
- La question fiscale du §3.2 (déductibilité des frais de véhicule) reste, comme la fiche le
  prévoyait elle-même, une question pour le comptable — non traitée par le code, et ce n'est pas
  son rôle.
- La clé `OPENROUTESERVICE_API_KEY` : son statut de configuration réelle sur le poste du porteur
  n'a pas été vérifié par cette mission (accès `.env` hors périmètre) — voir
  `docs/05-DECISIONS.md` D-065 et le journal `en-attente-du-porteur` de la mémoire utilisateur.
