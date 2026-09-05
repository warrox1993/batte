# 03 — Moteur de prévision et décision de production

> **Note réécrite le 30/07/2026 — vérifiée directement contre le code, pas contre une version
> antérieure de cette note.** Ce document reste la spécification de référence ; les sections
> ci-dessous décrivent l'intention d'origine (V1). Le moteur RÉEL vit dans
> `packages/core/src/prevision/` : `baseline.ts`, `meteo.ts`, `saison.ts`, `tendance.ts`,
> `moteur.ts`, `repartition-production.ts`, `besoins-ingredients.ts`, `statistiques.ts`,
> `calendrier.ts`, `horizon.ts`, `validation-croisee.ts`, et les cinq prédicteurs de
> `docs/demandes/07` §2 : `comparable-calendaire.ts`, `jour-semaine.ts`, `vacances-scolaires.ts`,
> `ecart-meteo-prevue-realisee.ts`, `session-consecutive.ts`. Le tout est exposé par
> `apps/api/src/routes/previsions.ts` et archivé par `packages/db/src/depots/previsions.ts`.
>
> Tous les facteurs multiplicatifs décrits plus bas sont implémentés et câblés. **§« Facteurs de
> précision ajoutés après la V1 »**, **§« Plan de production »** et **§« Prévision calendaire »**
> décrivent ce que cette spécification d'origine ne prévoyait pas et que le code fait aujourd'hui.
> `npm run backtest` (`packages/db/src/scripts/backtest.ts`) est une commande réelle, pas
> seulement une intention de la section « Mesure de la qualité ».

## Avertissement à lire avant de coder

Ce module est celui qui a le plus de valeur et le plus de risque de décevoir. Deux points
doivent être clairs dès le départ :

**1. Aucune statistique fine n'est possible sans données.** Avec 0 session observée, aucun
modèle ne peut être « ultra fin ». La qualité utile arrive vers 20–30 sessions comparables,
soit environ six mois d'activité hebdomadaire. Le système est donc conçu pour être
**honnête sur son incertitude** dès le premier jour, et pour **s'améliorer automatiquement**.
Un modèle qui affiche « 168 crêpes » sans intervalle au bout de trois sessions ment.

**2. Un LLM ne fait pas les statistiques.** Le moteur est du TypeScript déterministe et testé.
Claude intervient uniquement pour _expliquer_ le résultat, _commenter_ un écart, ou _aider_
à structurer une donnée d'entrée. Deux raisons : la reproductibilité (même entrée → même
sortie, indispensable pour le backtesting) et le contrôle (on peut débuguer une formule,
pas une intuition).

---

## Modèle : multiplicatif à facteurs

```
ventes_attendues = baseline × f_météo × f_événement × f_saison × f_tendance
```

Forme multiplicative, donc additive dans l'espace logarithmique — ce qui permet plus tard
une régression linéaire simple sur `log(ventes)` sans changer la structure du code.

Chaque facteur est stocké en points de base (10 000 = neutre) et **affiché à l'utilisateur**.
La décomposition doit être lisible :

> Base 118 × météo 1,15 × événement 1,30 × saison 0,95 = **168 crêpes attendues**

---

## Facteur 1 — Baseline

Nombre de crêpes vendues lors d'une session « normale » : météo neutre, pas d'événement,
saison moyenne.

### Estimation bayésienne progressive

```
baseline = (k × prior + Σ observations_normalisées) / (k + n)
```

- `n` : nombre de sessions observées pour ce lieu
- `k` : poids du prior, **valeur retenue : 3** (le prior pèse comme trois sessions)
- `observation_normalisée = ventes_réelles / (f_météo × f_événement × f_saison)`
  → on retire l'effet des facteurs pour retrouver ce qu'aurait donné une session neutre

Le prior initial pour La Batte est un paramètre en base, à fixer avec l'utilisateur avant le
premier marché. Il s'efface naturellement à mesure que les données arrivent : après 12 sessions,
il ne pèse plus que 20 %.

**Pondération temporelle** : au-delà de 30 sessions, appliquer une décroissance exponentielle
avec une demi-vie de 26 semaines. Une session d'il y a deux ans en dit moins qu'une session
du mois dernier.

**Sessions atypiques** : une session marquée `exclure_du_modele` (panne de gaz, arrivée en
retard, fermeture anticipée) n'entre pas dans l'estimation. Prévoir la case à cocher.

---

## Facteur 2 — Météo

Source : Open-Meteo, sans clé API.
Coordonnées La Batte : latitude **50,6447**, longitude **5,5822**.
Récupération à J-7, J-3, J-1 et le matin même ; conservation de toutes les versions pour
mesurer a posteriori la sensibilité de la prévision à la révision météo.

### Variables retenues

Température moyenne sur la fenêtre du marché, température ressentie, précipitations
cumulées, probabilité de pluie, vent moyen, couverture nuageuse.

### Priors experts (phase 1, `n < 20`)

| Condition                              | Facteur                                    |
| -------------------------------------- | ------------------------------------------ |
| Pluie continue (> 2 mm sur la fenêtre) | 0,55                                       |
| Averses / pluie intermittente          | 0,80                                       |
| Couvert sec                            | 1,00                                       |
| Ensoleillé, 10–22 °C                   | 1,20                                       |
| Ensoleillé, > 26 °C                    | 0,90                                       |
| Sec et froid, < 5 °C                   | 0,95                                       |
| Vent > 40 km/h                         | × 0,75 (se combine aux lignes précédentes) |

> Ces valeurs sont des **hypothèses de départ**, pas des vérités. Elles vivent dans la table
> `parametre` et doivent être remplacées par des coefficients estimés dès que possible.
>
> Piège à garder en tête : la température joue dans **deux sens opposés** — le froid réduit
> la fréquentation du marché mais augmente l'attrait d'une crêpe chaude. Le facteur net est
> donc empirique par nature, et c'est exactement pour cette raison qu'il faut mesurer plutôt
> que raisonner.

> **[RÉEL]** `packages/core/src/prevision/meteo.ts` implémente huit catégories, pas six : la table
> ci-dessus laissait deux trous — un ciel dégagé entre 22 et 26 °C, et entre 5 et 10 °C, retombait
> sur `couvert_sec` (facteur neutre 1,00) sans le dire. Le code a ajouté `ensoleille_tiede` et
> `ensoleille_frais` pour refermer ces trous (fiche 2 de `docs/17`, migration des clés de
> catalogue). **Décision D-059, importante pour la suite de ce document** : ces deux catégories ne
> reçoivent **pas** un coefficient deviné par le porteur. Elles démarrent neutres (1,00),
> explicitement marquées « prior non mesuré », et un facteur **mesuré** (comparaison prévu/réalisé
> après chaque session) prend le relais dès qu'il repose sur assez d'observations, validé par
> `packages/core/src/prevision/validation-croisee.ts` (leave-one-out). C'est le même mécanisme,
> généralisé, que celui décrit plus bas pour les événements (§« Facteur 3 »).

### Estimation empirique (phase 2, `n ≥ 20`)

Régression sur `log(ventes_normalisées)` avec pour régresseurs : température, température²
(effet en cloche), précipitations, indicateur de pluie, vent. Remplacement des priors par les
coefficients estimés uniquement si le modèle bat le prior en validation croisée _leave-one-out_.

---

## Facteur 3 — Événements

Table `evenement`, saisie manuelle, éventuellement pré-remplie par une recherche Claude
**validée par l'utilisateur**.

### Facteur initial (avant mesure)

```
f_événement = 1 + (portée × intensité × 0,05)
```

avec `portée` ∈ { quartier: 1,0 ; liège: 0,6 ; national: 0,3 } et `intensité` ∈ 1…5.

Événements négatifs (grève, travaux sur le quai, jour férié fermant le marché, alerte
météo rouge) : facteur < 1, saisi directement.

### Apprentissage

Après chaque session concernée, l'application calcule l'**impact mesuré** :

```
impact_mesuré = ventes_réelles / (baseline × f_météo × f_saison)
```

et le stocke dans `evenement.impact_mesure_bp`. Pour un événement récurrent (Les Ardentes
chaque année, braderie annuelle), la moyenne des impacts mesurés remplace l'estimation dès
la deuxième occurrence. C'est le mécanisme d'apprentissage le plus rentable du système :
il transforme une intuition en coefficient au bout d'une seule observation.

### Cas extrêmes

Une situation qui rend le marché impossible (fermeture administrative, crise majeure) ne se
modélise pas par un facteur : c'est un **drapeau `session_annulee`**, la session ne compte
pas dans l'historique. Ne pas polluer le modèle avec des zéros non représentatifs.

---

## Facteur 4 — Saison

Effet du mois de l'année, indépendamment de la météo du jour : tourisme, vacances scolaires,
Chandeleur, habitudes de sortie.

- Phase 1 : coefficients experts par mois dans `parametre`, initialisés à 1,00 sauf
  hypothèses assumées et documentées.
- Phase 2 (`n ≥ 40`) : moyenne mobile annuelle centrée pour extraire la composante
  saisonnière, en séparant proprement l'effet saison de l'effet météo — ils sont corrélés,
  et les confondre reviendrait à compter deux fois le même effet.

Prévoir aussi un indicateur **vacances scolaires belges** (calendrier statique en base) et
**jour férié**.

> **[RÉEL]** `packages/core/src/prevision/saison.ts` implémente exactement ce mécanisme, avec un
> garde-fou explicite : avant correction (fiche 3 de `docs/17`), `depots/previsions.ts` écrivait
> `saisonBp: BASE_POINTS` **en dur** sur toute observation — l'écran affichait « Saison × 1,00 »,
> ce qui se lit « évaluée et jugée neutre », alors qu'elle n'avait jamais été évaluée. Le module
> réel ne calcule un facteur que si `observationsMinimum` (pour le mois cible) **et**
> `moisDistinctsMinimum` (dans tout l'historique) sont atteints ; sinon `actif` vaut faux et
> l'écran doit afficher « non modélisée », jamais « × 1,00 ». Câblé avec validation croisée
> leave-one-out dans `apps/api/src/routes/previsions.ts`. Le calendrier des vacances scolaires
> belges est traité séparément (voir le prédicteur dédié plus bas), pas fusionné dans la saison.

---

## Facteur 5 — Tendance

Croissance ou érosion de la clientèle indépendamment du reste : notoriété qui s'installe,
clients réguliers, arrivée d'un concurrent.

Régression linéaire sur les 12 dernières sessions normalisées, exprimée en variation
mensuelle. **Bornée à ±30 %** pour éviter qu'une série chanceuse produise une extrapolation
absurde. Neutre (1,00) tant que `n < 10`.

> **[RÉEL]** `packages/core/src/prevision/tendance.ts` implémente ce facteur, avec le même garde-fou
> qu'au facteur saison : neutre et **explicitement marqué non modélisé** avant le minimum de
> sessions, jamais un « × 1,00 » silencieux. Câblé via `calculerTendanceRetenue` dans
> `apps/api/src/routes/previsions.ts`.

---

## Cinq facteurs de précision ajoutés après la V1 (`docs/demandes/07`)

**Absents de la conception d'origine de ce document.** Une fois l'historique de sessions retenu
indéfiniment (décision de rétention, fiche 07), cinq prédicteurs supplémentaires sont devenus
mesurables. Chacun vit dans son propre module de `packages/core/src/prevision/`, chacun ne produit
un effet que soumis à la **même validation croisée leave-one-out** que la météo et la saison
(`validation-croisee.ts`) — « un prédicteur qui n'améliore pas le MAPE en leave-one-out ne doit pas
entrer dans le calcul, même s'il paraît sensé ».

1. **Comparable calendaire** (`comparable-calendaire.ts`) — le même jour civil l'an dernier (et les
   années antérieures si disponibles), pondéré par l'ancienneté. Distinct du facteur Saison : celui-
   ci regarde un **jour précis** répété d'année en année (la Chandeleur), la Saison regarde un
   **mois entier**.
2. **Jour de semaine** (`jour-semaine.ts`) — pertinent seulement si plusieurs jours de vente
   coexistent dans l'historique (foires en semaine, en plus du dimanche de La Batte). Reste
   silencieux, jamais neutre, tant qu'un seul jour de semaine est représenté.
3. **Vacances scolaires belges** (`vacances-scolaires.ts`) — proximité d'une période de vacances,
   calendrier officiel de la Fédération Wallonie-Bruxelles stocké en `parametre` (jamais une
   constante compilée, `CLAUDE.md` §7). Effet **binaire** (dans/hors vacances) plutôt que continu,
   déviation assumée et documentée par sur-apprentissage évité.
4. **Écart météo prévue/réalisée** (`ecart-meteo-prevue-realisee.ts`) et **horizon** (`horizon.ts`)
   — ne produisent pas un facteur multiplicatif sur la demande, mais une **inflation de l'écart-
   type (σ)**, qui élargit l'intervalle P10/P90 à mesure que l'horizon de prévision s'éloigne ou que
   la météo à J-7 s'est historiquement trompée. Toujours une inflation, jamais une contraction.
   `horizon.ts` répond en particulier au besoin de `docs/demandes/06` (prévision calendaire à 365
   jours) : une prévision à 300 jours n'a pas la même fiabilité qu'à 7 jours, et ce module rend la
   différence calculable plutôt que de l'afficher avec le même aplomb.
5. **Session consécutive** (`session-consecutive.ts`) — une session la semaine précédente s'est-
   elle soldée par une rupture ou un invendu important ? Affine la tendance à court terme
   au-delà de la régression linéaire du facteur 5.

Ces cinq facteurs sont archivés sur `prevision` (`facteur_comparable_calendaire_bp`,
`facteur_jour_semaine_bp`, `facteur_vacances_scolaires_bp`, `facteur_session_consecutive_bp`,
`inflation_sigma_meteo_bp` — tous nullable, voir `docs/02-MODELE-DONNEES.md`).

### Prévision calendaire jusqu'à 365 jours (`docs/demandes/06`)

**[RÉEL].** Route `GET /prevision-calendaire` (`apps/api/src/routes/previsions.ts`, fonction
`previsionCalendaireComplete`), horizon par défaut lu au catalogue
(`prevision_horizon_calendaire_jours`, 365 jours). Chaque jour de l'horizon reçoit sa propre
prévision, avec l'inflation de `sigma` liée à `horizon.ts` : plus la date est lointaine, plus
l'intervalle P10/P90 s'élargit — jamais un chiffre affiché avec le même aplomb à J+300 qu'à J+7.
Sert aussi de base au point de commande **prédictif** (`prevision/point-commande-predictif.ts`,
`docs/demandes/06` §3) : un second déclencheur d'alerte de réapprovisionnement, qui compare le
besoin en ingrédients projeté sur la fenêtre `[délai de livraison ; délai + marge]`
(`prevision/besoins-ingredients.ts`) au stock disponible plus les commandes en cours — sans jamais
remplacer le point de commande réactif historique, les deux coexistent et le plus contraignant
déclenche.

---

## Incertitude : produire un intervalle, pas un nombre

Un point unique est inutilisable pour décider d'une production. Il faut une distribution.

| Sessions observées | Méthode                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `n < 8`            | Log-normale, coefficient de variation prior **0,35** (intervalle volontairement large)            |
| `8 ≤ n < 25`       | σ estimé sur les résidus log, plancher à 0,20                                                     |
| `n ≥ 25`           | σ estimé, éventuellement conditionné à la météo (l'incertitude est plus forte par temps instable) |

Sortie : `P10`, `P50`, `P90`, et le niveau de confiance affiché = f(nombre de sessions
comparables, dispersion des résidus, âge des données).

L'interface doit dire, sans détour : _« Prévision : 150 à 195 crêpes. Confiance faible —
seulement 4 sessions comparables observées. »_

---

## Décision de production : le point le plus rentable du projet

### Ne jamais produire la moyenne

Produire la prévision médiane est une erreur économique classique. Le coût d'une rupture et
le coût d'un invendu ne sont pas symétriques :

- **Rupture** : on perd la marge complète, soit ≈ 3,15 € sur une crêpe à 3,50 €
  dont 0,35 € de matière — plus un client mécontent, une file qui se disperse et une
  réputation entamée.
- **Invendu** : on perd la matière de la pâte non cuite, soit ≈ 0,25 €/crêpe équivalent.
  La garniture n'est pas engagée puisqu'elle s'applique à la commande.

### Modèle du vendeur de journaux (_newsvendor_)

Le niveau optimal de production est le **quantile de la distribution de demande** au ratio
critique :

```
ratio_critique = Cu / (Cu + Co)
```

où `Cu` = marge perdue par rupture, `Co` = coût d'une unité invendue.

Avec les chiffres ci-dessus :

```
ratio_critique = 3,15 / (3,15 + 0,25) ≈ 0,93
```

**Autrement dit : il faut produire au quantile ~90 %, pas à la médiane.** Le déséquilibre est
énorme, et l'intuition va dans le mauvais sens — on a spontanément peur du gaspillage visible
alors que le vrai coût est la vente manquée, invisible.

`Cu` et `Co` doivent être calculés à partir des **données réelles de l'application** (prix de
vente moyen pondéré par le mix, CUMP courant), pas de constantes. Le ratio se recalcule à
chaque prévision.

### Ajustement du ratio

- Si la pâte restante est réutilisable dans les 24 h (deux marchés consécutifs) : `Co` baisse
  fortement → produire encore plus.
- Si un contrôle de trésorerie serré est déclaré dans les paramètres : abaisser le quantile
  cible manuellement, avec avertissement affiché sur le manque à gagner attendu.

### Contraintes dures appliquées après le calcul

La quantité recommandée est ensuite **écrêtée** par, dans l'ordre :

1. **Capacité de cuisson** : deux plaques, ≈ 2 min/crêpe, fenêtre de 6 h 30 → plafond calculé,
   pas codé en dur. Marge de sécurité pour le service et l'encaissement.
2. **Capacité de la glacière** : volume utile paramétrable, contrainte de chaîne du froid.
3. **Stock d'ingrédients disponible** à la date de production.
4. **Volume maximal transportable** sans véhicule personnel.

> **[RÉEL] Mise à jour du 30/07/2026 — la quatrième contrainte existe désormais dans le code**,
> paramètre `transport_volume_pate_max_ml` (`packages/core/src/parametres.ts:636-638`), et se
> comporte en **deux états explicites**, pas comme une simple contrainte optionnelle :
>
> - **0 (valeur par défaut)** = « non renseigné », jamais « aucune limite ». Tant qu'elle vaut 0,
>   la contrainte n'est **pas ajoutée** à la liste — le moteur n'écrête rien au nom d'un chiffre
>   qu'il ne connaît pas (`packages/core/src/prevision/moteur.ts:701-709`).
> - **> 0** = limite active, même calcul que la glacière (volume de pâte disponible ÷ volume par
>   crêpe), et `prevoir()` distingue ce cas de l'absence de contrainte pour ne signaler à l'écran
>   que le cas « non mesuré » (`packages/core/src/prevision/moteur.ts:463-473`).

Si une contrainte mord, l'écran doit le dire explicitement : _« Recommandation ramenée de
210 à 180 crêpes — limite de capacité de cuisson. Manque à gagner estimé : 94 €. »_
Cette information est ce qui justifiera, chiffres à l'appui, un investissement futur
(troisième plaque, camionnette).

> **[RÉEL] Divergence assumée sur le calcul du manque à gagner**, documentée dans
> `docs/15-AUDIT-MOTEUR-PREVISION.md` et dans le commentaire de
> `manqueAGagnerEcretage` (`packages/core/src/prevision/moteur.ts`). L'exemple ci-dessus
> (30 crêpes retirées × 3,15 € = 94 €) suppose que ces 30 crêpes se seraient **toutes** vendues —
> faux par construction : l'écrêtage retire les crêpes du **haut** de la distribution, celles qui
> ne se vendent que les très bons jours. Le calcul réel compare le profit espéré
> `E[min(demande, Q)]` avant et après écrêtage : `ΔP = (Cu + Co)·(V(Qr) − V(Qc)) − Co·(Qr − Qc)`.
> Sur l'exemple même de ce document, cela donne **3,74 €, pas 94 €** — 25 fois moins. L'écart
> importe parce que ce chiffre est celui qui « justifiera un investissement futur » : surestimé
> d'un facteur 25, il justifierait un achat qui ne se rembourserait jamais.

### Répartition entre recettes — devenue un plan de production complet (`docs/17` fiche 5)

```
part_R2 = moyenne lissée de la part R2 des N dernières sessions
```

avec un plancher de sécurité (l'offre sans gluten est un argument de différenciation : être
en rupture dessus coûte plus que la matière) et un lissage exponentiel. Convertir ensuite en
litres via le rendement de chaque recette, arrondi au demi-litre.

> **[RÉEL]** `docs/17` fiche 5 constatait que rien de tout cela n'existait : la sortie du moteur
> était un nombre de crêpes, pas un plan de production. Fermé par
> `packages/core/src/prevision/repartition-production.ts` (`repartitionProduction`), généralisé à
> **N recettes actives** (pas seulement R1/R2) : le plancher de sécurité s'applique à toute recette
> `sansGluten`, qu'il y en ait une ou plusieurs. **Divergence assumée** : la part de chaque recette
> n'est pas recalculée ici par un lissage exponentiel session par session — elle est reçue déjà
> **mesurée** sur l'historique réel de production (`partsRecettesActives`,
> `packages/db/src/depots/previsions.ts`), jamais une répartition égale devinée quand plusieurs
> recettes actives coexistent sans historique pour les départager (même principe que D-059 pour la
> météo). Ce module se limite au plancher de sécurité et à la conversion en litres arrondie. Calculé
> sur `crepesRetenues` (ce qui sera réellement produit, après écrêtage), jamais sur
> `crepesRecommandees`.

---

## Sortie du moteur

```ts
type ResultatPrevision = {
  baseline: number;
  facteurs: {
    meteo: number;
    evenement: number;
    saison: number;
    tendance: number;
  };
  p10: number;
  p50: number;
  p90: number;
  quantileCible: number; // ratio critique retenu
  crepesRecommandees: number; // avant contraintes
  crepesRetenues: number; // après contraintes
  contrainteLimitante: string | null;
  manqueAGagnerEstimeCents: number | null;
  repartition: { recetteId: string; crepes: number; volumeMl: number }[];
  confiance: number; // 0–1
  nbSessionsComparables: number;
  explication: string[]; // phrases prêtes à afficher
};
```

> **[RÉEL]** Le type réel (`packages/core/src/prevision/moteur.ts`, `ResultatPrevision`) suit cette
> forme d'assez près, avec deux différences notables : `repartition` est produite par
> `repartitionProduction()` (`repartition-production.ts`) à partir d'un `planProduction` **optionnel**
> — quand il est absent (aucune recette exploitable), `repartition` vaut `[]`, jamais une répartition
> égale inventée entre recettes. Le plancher de sécurité sans gluten (R2) et le lissage exponentiel
> de la part R2 sont bien implémentés dans ce module, avec conversion en litres arrondie au demi-
> litre. La persistance (`packages/db/src/depots/previsions.ts`) stocke ce résultat sous
> `repartition_recettes` (JSON, `null` si vide) — il n'existe **pas** de colonne
> `volume_recommande_ml` séparée.

---

## Mesure de la qualité du modèle

Sans mesure, aucune amélioration. Après chaque session, calculer et stocker :

- **erreur absolue en %** entre `p50` et le réalisé ;
- **MAPE glissante** sur 10 sessions ;
- **biais moyen** : le modèle sur-prévoit-il ou sous-prévoit-il systématiquement ?
- **taux de rupture** : sessions terminées à court de pâte ;
- **taux d'invendu** : pâte jetée / pâte produite ;
- **couverture de l'intervalle** : le réalisé tombe-t-il dans [P10, P90] dans ~80 % des cas ?
  Si la couverture est bien supérieure, les intervalles sont trop larges ; bien inférieure,
  trop étroits.

Un écran « Qualité du modèle » affiche ces indicateurs. Une commande
`npm run backtest` rejoue tout l'historique et compare les versions du modèle.

> **[RÉEL]** `npm run backtest` existe (`package.json`, `packages/db/src/scripts/backtest.ts`) et
> sort les six indicateurs demandés ci-dessus : `erreurAbsolueMoyenneBp`, `biaisMoyenCrepes`,
> `mapeGlissanteBp`, `tauxRuptureBp`, `tauxInvenduBp`, et la couverture de l'intervalle P10/P90 —
> tous `null` tant que l'historique clôturé est trop court pour être mesuré, jamais une valeur
> approximative. Le script compare aussi le MAPE du modèle complet à celui d'une baseline naïve,
> pour vérifier que chaque prédicteur ajouté bat effectivement l'absence de prédicteur (fiche 8 de
> `docs/17`).

---

## Rôle exact de Claude dans ce module

| Ce que Claude fait                                 | Ce que Claude ne fait pas            |
| -------------------------------------------------- | ------------------------------------ |
| Rédiger le commentaire explicatif de la prévision  | Calculer la prévision                |
| Analyser un écart important et proposer des causes | Modifier un coefficient              |
| Proposer une liste d'événements à venir, à valider | Insérer un événement en base         |
| Rédiger la synthèse mensuelle                      | Produire un chiffre non recalculable |
| Suggérer une piste d'amélioration du modèle        | L'appliquer sans revue               |

Le prompt d'analyse reçoit : la décomposition des facteurs, l'historique agrégé, la météo,
les événements, les indicateurs de qualité. Jamais la base entière.

---

## Ordre d'implémentation recommandé

1. Squelette multiplicatif avec tous les facteurs à 1,00 et une baseline paramétrée. Ça marche
   dès le premier jour et ça donne déjà un ordre de production défendable.
2. Facteur météo prior + intégration Open-Meteo.
3. Intervalle d'incertitude et calcul newsvendor. **C'est ici que se trouve l'essentiel du
   gain économique** — avant même que le modèle soit précis.
4. Contraintes dures et écrêtage.
5. Mise à jour bayésienne de la baseline.
6. Événements et apprentissage de leur impact.
7. Mesure de qualité et backtesting.
8. Estimation empirique des facteurs météo et saison, une fois `n ≥ 20`.

> **[RÉEL] Les huit étapes sont posées.** Restent gouvernés par les seuils `n` du catalogue plutôt
> que par une date : les facteurs saison/tendance/météo-catégories neufs démarrent neutres et
> explicitement « non modélisés » tant que leur propre minimum d'observations n'est pas atteint
> (voir les notes **[RÉEL]** de chaque section ci-dessus), exactement l'esprit de cet ordre
> d'implémentation — la mécanique existe avant que la donnée ne la nourrisse.
