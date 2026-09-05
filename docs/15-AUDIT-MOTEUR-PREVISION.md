# 15 — Audit du moteur de prévision

> Périmètre : `packages/core/src/prevision/**`, `packages/db/src/depots/previsions.ts`,
> `apps/api/src/routes/previsions.ts`, confrontés à `docs/03-MOTEUR-PREVISION.md`.
> Date : 28/07/2026. Première relecture du cœur mathématique du produit.
>
> Ce module décide **combien de crêpes produire**, donc combien de matière acheter et
> combien d'invendus jeter. Une erreur de 10 % s'y traduit en euros chaque dimanche.

> **Mise à jour du 30/07/2026 — §0 et §1 ci-dessous, non retouchés dans le corps du texte, sont
> aujourd'hui largement dépassés sur un point : « la moitié du modèle spécifié n'existe pas ».**
> Vérifié par lecture directe, sans refaire l'audit complet (ce serait un nouvel audit) :
> `packages/core/src/prevision/saison.ts` et `tendance.ts` existent (avec leurs tests), et
> `evenement.impact_mesure_bp` — donné en §1.3 comme « n'a aucun écrivain dans tout le dépôt » —
> est désormais écrit par `packages/db/src/depots/previsions.ts:841`
> (`.set({ impactMesureBp: moyenneBp, ... })`) et lu par `packages/core/src/prevision/evenements.ts:211`.
> `docs/20-ETAT-DES-LIEUX.md` §2.3 et `docs/05-DECISIONS.md` D-059 corroborent : saison, tendance et
> apprentissage d'impact d'événement sont donnés codés. Les étapes 6 et 8 du tableau §1 (et le
> paragraphe ci-dessous) ne doivent donc plus être présumées « absentes » sans revérification — la
> confiance (étape non listée séparément, voir §4/§6, déjà mise à jour) et le rapprochement (§5,
> déjà mis à jour) restent les deux points de cet audit vérifiés en détail après le 28/07/2026 ;
> les autres lignes de §1 (météo empirique, écrêtage, robustesse) n'ont pas été revérifiées ici.

---

## 0. Verdict en une page

Le squelette est **sain** : le modèle multiplicatif, l'estimation bayésienne de la baseline,
la loi log-normale et le ratio critique newsvendor sont présents, déterministes, et fidèles à
l'intention de `docs/03`. L'approximation numérique d'Acklam, souvent suspectée, est **hors de
cause** (mesurée à 1,2e-7 crêpe d'erreur).

Deux défauts mathématiques réels ont été trouvés et corrigés :

| #      | Défaut                                                                            | Impact mesuré                                                                        |
| ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **D1** | Le manque à gagner d'un écrêtage était calculé « crêpes retirées × marge pleine » | **surestimé d'un facteur 4,5 à 39** — 94,50 € affichés là où l'espérance vaut 3,74 € |
| **D2** | L'espérance des ventes était utilisée comme **médiane** de la log-normale         | **+6,3 % de surproduction** à σ = 0,35, soit 13 crêpes ≈ 3,30 €/marché ≈ 165 €/an    |

Trois bugs de robustesse (dont un plantage atteignable depuis l'écran Paramètres), une
divergence d'unité, et un libellé qui mentait à l'utilisateur ont également été corrigés.

En revanche, **la moitié du modèle spécifié n'existe pas** : facteur saison, facteur tendance,
apprentissage de l'impact des événements, estimation empirique de la météo, répartition entre
recettes, et — le plus grave — le **rapprochement prévu / réalisé n'est jamais appelé**, donc
l'écran « Qualité du modèle » mesure un ensemble vide et le modèle ne peut pas s'améliorer.

---

## 1. Conformité à `docs/03`, étape par étape

`docs/03` termine par un « ordre d'implémentation recommandé » en huit étapes. État réel :

| #   | Étape                                          | État                           | Où                                             |
| --- | ---------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| 1   | Squelette multiplicatif à facteurs             | **conforme**                   | `moteur.ts` `prevoir`                          |
| 2   | Facteur météo prior + Open-Meteo               | **partiel**                    | `meteo.ts`, `apps/api/src/meteo/open-meteo.ts` |
| 3   | Intervalle d'incertitude + newsvendor          | **conforme après corrections** | `statistiques.ts`, `moteur.ts`                 |
| 4   | Contraintes dures et écrêtage                  | **partiel**                    | `moteur.ts` `contraintesSession`               |
| 5   | Mise à jour bayésienne de la baseline          | **conforme**                   | `baseline.ts` `calculerBaseline`               |
| 6   | Événements et apprentissage de leur impact     | **absent** (lecture seule)     | `depots/previsions.ts`                         |
| 7   | Mesure de qualité et backtesting               | **inerte**                     | `depots/previsions.ts` `qualiteModele`         |
| 8   | Estimation empirique météo / saison (`n ≥ 20`) | **absent**                     | —                                              |

### 1.1 Facteur 1 — Baseline : conforme

`baseline = (k × prior + n × moyenne_pondérée) / (k + n)` avec `k = 3` au catalogue.
La promesse vérifiable de `docs/03` — « après 12 sessions, le prior ne pèse plus que 20 % » —
tient exactement : `poidsPriorBp = k/(k+n) = 3/15 = 2000 bp`.

**Divergence assumée et déjà documentée dans le code** : `docs/03` n'active la pondération
temporelle qu'« au-delà de 30 sessions ». L'implémentation l'applique dès la première, et
divise par la somme des poids au lieu de la cumuler. C'est un **correctif**, pas une dérive :
appliquée à la lettre, la règle de `docs/03` faisait _remonter_ le poids du prior de 9,1 % à
12,3 % à la 31ᵉ session — l'inverse exact de ce que le document promet.

Sessions `exclure_du_modele` et `annulee` correctement écartées (`observationsDuLieu`).

### 1.2 Facteur 2 — Météo : partiel

Conforme : les six catégories de priors, tous les seuils au catalogue, le vent fort qui se
**combine** au lieu de remplacer (× 0,75), l'intégration Open-Meteo sans clé, le mode dégradé.

Non conforme :

- **Deux trous dans la grille de priors.** `docs/03` donne un facteur au temps ensoleillé
  entre 10 et 22 °C, puis au-delà de 26 °C — et rien entre les deux. Idem entre 5 et 10 °C.
  Ces conditions retombent sur `couvert_sec` (facteur 1,00). **Cas réel constaté sur
  l'installation de production le 28/07/2026** : relevé 23 °C sous 13 % de nuages, affiché
  « couvert et sec, 23 °C ». Le facteur neutre est un repli défendable ; le libellé, non.
  → **Corrigé** : le moteur ne dit plus jamais « couvert » quand le ciel est dégagé.
  → **Reste à trancher** : quel facteur pour un dimanche ensoleillé à 24 °C ? Voir §6.
- **Aucune conservation des révisions.** `docs/03` demande une récupération à J-7, J-3, J-1 et
  le matin même, « conservation de toutes les versions pour mesurer a posteriori la sensibilité
  de la prévision à la révision météo ». La contrainte d'unicité
  `(lieu, date, type)` + `onConflictDoUpdate` n'en garde que deux (`prevision`, `reelle`), et
  rien ne planifie les quatre relevés.
- **Deux variables spécifiées jamais renseignées** : `temperature_ressentie_c` et
  `probabilite_pluie_bp` existent en base et restent à `NULL`.
- **Phase 2 absente** : aucune régression sur `log(ventes_normalisées)`, aucune validation
  croisée _leave-one-out_.

### 1.3 Facteur 3 — Événements : le mécanisme d'apprentissage n'existe pas

- La formule `f_événement = 1 + (portée × intensité × 0,05)` **n'est implémentée nulle part**.
  `portee` et `intensiteEstimee` sont saisis, stockés… et n'entrent dans **aucun calcul**.
  L'utilisateur saisit directement le multiplicateur dans le formulaire web.
- `evenement.impact_mesure_bp` **n'a aucun écrivain** dans tout le dépôt. `facteurEvenementBp`
  lit `impactMesureBp ?? impactEstimeBp` : la branche mesurée est morte, la colonne restera
  `NULL` à vie. Or `docs/03` en dit : « C'est le mécanisme d'apprentissage le plus rentable du
  système : il transforme une intuition en coefficient au bout d'une seule observation. »

### 1.4 Facteur 4 — Saison : absent

`saisonBp` vaut `BASE_POINTS` en dur (`depots/previsions.ts:163`), avec un commentaire honnête.
Aucun coefficient mensuel au catalogue, aucun calendrier de vacances scolaires belges, aucun
indicateur de jour férié.

### 1.5 Facteur 5 — Tendance : absent

`tendanceBp` n'est **jamais fourni** par l'appelant : il retombe systématiquement sur le neutre.
Aucune régression sur les 12 dernières sessions, aucune borne ± 30 %.

### 1.6 Incertitude : conforme après correction d'unité

Les trois régimes de `docs/03` sont bien en place et paramétrés (`< 8` prior, `8–25` plancher,
`≥ 25` mesure). **Divergence corrigée** : le paramètre s'appelle `prevision_cv_prior_bp` et
`docs/03` dit « coefficient de variation prior 0,35 », mais la valeur était injectée telle
quelle comme **écart-type log**. Pour une log-normale, CV = √(exp(σ²) − 1), donc 0,35 de CV
vaut σ = 0,3400 — pas 0,35. La conversion est désormais faite (`sigmaDepuisCoefficientVariation`).
Effet : −1,5 % sur la largeur de l'intervalle et sur la recommandation, sur les jeunes modèles.

Le plancher de 0,20, lui, est déjà exprimé en écart-type log par `docs/03` : aucune conversion.

### 1.7 Décision de production : conforme, et c'est bien l'essentiel du gain

`ratio_critique = Cu / (Cu + Co)` calculé à chaque prévision à partir des **données réelles**
(prix moyen pondéré par le mix vendu, coût matière mesuré sur les productions), jamais de
constantes. Sur l'installation de production au moment de l'audit : Cu = 2,97 €, Co = 0,26 €,
ratio 0,9195 — soit un quantile cible de 92 %, très au-dessus de la médiane. Conforme.

**Non conforme** : les deux ajustements du ratio prévus par `docs/03` sont absents —
« pâte restante réutilisable dans les 24 h » (qui devrait faire chuter `Co`) et « contrôle de
trésorerie serré » (qui devrait permettre d'abaisser manuellement le quantile avec un
avertissement chiffré).

### 1.8 Contraintes dures : deux sur quatre

`docs/03` en énumère quatre, dans l'ordre. État :

1. **Capacité de cuisson** — implémentée, calculée depuis les paramètres. ✔
2. **Capacité de la glacière** — implémentée. ✔
3. **Stock d'ingrédients disponible** — `contraintesSession` sait la prendre, mais
   `apps/api/src/routes/previsions.ts:191` passe `stockMaximalCrepes: null` **en dur**. La
   contrainte n'est jamais appliquée. On peut recommander de produire 220 crêpes avec de quoi
   en faire 80.
4. **Volume maximal transportable** — absente. Aucun paramètre, aucune contrainte.

### 1.9 Répartition entre recettes : absente

`part_R2`, le lissage exponentiel, le plancher de sécurité sans gluten, la conversion en litres
arrondie au demi-litre : rien n'existe. Le type `ResultatPrevision` n'a pas de champ
`repartition`, et `archiverPrevision` écrit `repartitionRecettes: null`.

### 1.10 Mesure de la qualité : l'écran existe, la mesure n'a jamais lieu

Voir §5. Sur les six indicateurs demandés par `docs/03`, trois sont codés
(erreur absolue, biais moyen, couverture de l'intervalle), trois manquent (MAPE glissante sur
10 sessions, taux de rupture, taux d'invendu) — et **aucun n'est jamais alimenté**.
`npm run backtest` n'existe pas.

---

## 2. Défauts mathématiques, avec le calcul qui les démontre

### D1 — Le manque à gagner surestimé d'un facteur 4,5 à 39

**Le code** (avant correction) : `(crepesRecommandees − crepesRetenues) × coutRuptureCents`.

**Pourquoi c'est faux.** Cette formule suppose que **toutes** les crêpes retirées se seraient
vendues. Or l'écrêtage retire les crêpes du **haut** de la distribution : celles qui ne servent
que les très bons jours. Et produire ces crêpes coûte la matière de celles qui finiront à la
poubelle. Le vrai manque à gagner est une différence de **profit espéré** :

```
ΔP = (Cu + Co) · ( V(Qr) − V(Qc) ) − Co · (Qr − Qc)
```

où `V(Q) = E[min(D, Q)]` sont les ventes espérées à production `Q`, de forme fermée connue
pour la log-normale (vérifiée contre une intégration numérique de la fonction de survie,
accord à 1e-8).

**Le calcul, sur l'exemple de `docs/03` lui-même** (210 → 180, Cu = 3,15 €, Co = 0,25 €,
σ = 0,35, donc médiane implicite 126,4) :

|                                           | Valeur                      |
| ----------------------------------------- | --------------------------- |
| Ventes espérées à 210 crêpes              | 131,59                      |
| Ventes espérées à 180 crêpes              | 128,29                      |
| Ventes supplémentaires réellement perdues | **3,30 crêpes** (et non 30) |
| Formule naïve, affichée jusqu'ici         | **94,50 €**                 |
| Profit espéré réellement perdu            | **3,74 €**                  |
| Facteur de surestimation                  | **25,3 ×**                  |

Balayage sur d'autres écrêtages, session type (médiane 134, σ = 0,35, Qr = 223) :

| Écrêtage  | Naïf     | Réel    | Facteur |
| --------- | -------- | ------- | ------- |
| 223 → 200 | 72,45 €  | 1,86 €  | 39,0 ×  |
| 223 → 180 | 135,45 € | 7,77 €  | 17,4 ×  |
| 223 → 150 | 229,95 € | 28,78 € | 8,0 ×   |
| 223 → 120 | 324,45 € | 71,67 € | 4,5 ×   |

**Pourquoi ça compte.** `docs/03` désigne explicitement ce chiffre comme celui qui
« justifiera, chiffres à l'appui, un investissement futur (troisième plaque, camionnette) ».
Surestimé d'un facteur 25, il justifie un achat qui ne se rembourserait jamais.

**DIVERGENCE ASSUMÉE avec la lettre de `docs/03`** : le document donne lui-même le chiffre
naïf (94 €) dans son exemple. Le document a tort ; la formule corrigée est celle du modèle
newsvendor dont il se réclame par ailleurs.

→ Corrigé : `manqueAGagnerEcretage` dans `moteur.ts`, primitive `ventesEsperees` dans
`statistiques.ts`.

### D2 — L'espérance confondue avec la médiane

**Le code** (avant correction) : `p50 = round(baseline × facteurs)`, puis
`quantileLogNormal(p50, σ, p) = p50 · exp(σ·z_p)` — c'est-à-dire que `p50` est traité comme la
**médiane** de la log-normale.

**Pourquoi c'est faux.** `calculerBaseline` produit `Σ w·v / Σ w`, une moyenne **arithmétique**
pondérée des observations normalisées : c'est un estimateur de l'**espérance** `E[D]`. Or pour
une log-normale, `E[D] = médiane × exp(σ²/2)`. Prendre l'espérance pour la médiane gonfle
**tous** les quantiles — p10, p50, p90 — et la recommandation, du même facteur.

| σ retenu                      | exp(σ²/2) | Surestimation |
| ----------------------------- | --------- | ------------- |
| 0,35 (prior, `n < 8`)         | 1,0632    | **+6,32 %**   |
| 0,20 (plancher, `8 ≤ n < 25`) | 1,0202    | +2,02 %       |
| 0,18 (mesuré typique)         | 1,0163    | +1,63 %       |

**Traduction en crêpes**, session type (espérance 134, ratio critique 0,926 → z = 1,4500) :

| σ    | Recommandation avant | Après correction | Écart                         |
| ---- | -------------------- | ---------------- | ----------------------------- |
| 0,35 | 223                  | 209              | **13 crêpes ≈ 3,31 €/marché** |
| 0,20 | 179                  | 176              | 4 crêpes ≈ 0,89 €             |
| 0,18 | 174                  | 171              | 3 crêpes ≈ 0,70 €             |

Sur 50 marchés/an, ≈ 165 € de pâte jetée par pure incohérence interne du modèle. Et l'écran
annonçait « Demande attendue (**médiane**) : 134 crêpes » alors que le chiffre estimait la
moyenne — un mensonge, au sens où `docs/03` emploie ce mot.

→ Corrigé : `medianeDepuisEsperance` dans `statistiques.ts`. Le champ `demandeAttendue`
(l'espérance, la « demande attendue » de `docs/03`) est désormais **distinct** de `p50` (la
médiane), et les deux sont affichés — la décomposition « Base 118 × météo 1,15 × … » reste
lisible telle que le document la présente.

### D3 — Plantage atteignable depuis l'écran Paramètres

`quantile_cible_production_bp` est saisissable. À `0` ou à `10000`, le repli valait `ratio = 0`
ou `ratio = 1`, tous deux hors du domaine de `quantileNormal`, qui levait une `RangeError`
**non traduite** : erreur 500 sur « Prochaine session », sans dire quoi corriger.
Même famille que D-034, autre porte d'entrée.

→ Corrigé : `ErreurMetier('quantile_cible_invalide')` qui nomme le paramètre fautif.

### D4 — `ratioCritique` pouvait encore rendre exactement 1

Le test existant s'appelait « ne rend JAMAIS exactement 1 » mais ne vérifiait que le cas
`Co = 0`. Deux coûts **strictement positifs** ne suffisent pas : `ratioCritique(1e16, 1)` rend
exactement `1` parce que `1e16 + 1 === 1e16` en double précision.

→ Corrigé : la garde teste désormais le **résultat**, pas seulement les entrées.

### D5 — Un σ non fini traversait tout le moteur sans lever

`quantileLogNormal(m, NaN, p)` rendait `NaN` ; avec `Infinity`, `Infinity`. La comparaison
`sigma <= 0` ne rejette pas `NaN` — exactement le mécanisme de D-034.

→ Corrigé sur deux niveaux : `sigmaRetenu` retombe sur le prior devant une mesure
inexploitable (aveu d'ignorance), et `quantileLogNormal` lève franchement si on l'appelle
malgré tout avec un σ non fini.

### D6 — Plafond de production négatif

`contraintesSession` avec une fenêtre négative (heure de fin saisie **avant** l'heure de début
sur un lieu de marché — l'appelant fait une simple soustraction) rendait
`plafondCrepes = −1020`. `prevoir` retient le plus petit plafond : la recommandation devenait
**négative**, et le manque à gagner, gigantesque.

→ Corrigé : tout plafond est écrêté à `[0, +∞[` et rendu fini.

### D7 — Arrondi prématuré dans une chaîne multiplicative

`p50` était arrondi à l'entier **avant** de servir de médiane, puis multiplié par
`exp(σ·z) ≈ 1,66`. L'arrondi se propageait, amplifié : jusqu'à **1 crêpe** d'écart sur la
recommandation finale. On n'arrondit désormais qu'à la sortie.

### Effet cumulé, mesuré sur la session réelle de l'installation de production

Entrées relevées sur `127.0.0.1:3001/api/prevision` le 28/07/2026 — session SM-2026-0003,
La Batte : baseline 124 crêpes, 1 session close, Cu = 2,97 €, Co = 0,26 €, donc ratio critique
0,9195 (quantile cible 91,95 %). Le serveur tournait alors sur le code d'avant correction.

|                     | Avant | Après | Écart |
| ------------------- | ----- | ----- | ----- |
| Demande attendue    | 124   | 124   | 0     |
| p50 (médiane)       | 124   | 117   | −7    |
| p10                 | 79    | 76    | −3    |
| p90                 | 194   | 181   | −13   |
| Crêpes recommandées | 203   | 188   | −15   |

**15 crêpes de moins à produire ce dimanche-là**, soit 3,90 € de pâte non jetée. La demande
attendue, elle, ne bouge pas : c'est bien la conversion moyenne → médiane et la conversion
CV → σ qui se voient, pas un changement de prévision.

_(Le serveur de production n'a pas été redémarré : ces valeurs « après » sont calculées à
partir des mêmes entrées.)_

### Ce qui n'est PAS un défaut : l'approximation d'Acklam

Souvent suspectée, mesurée ici contre une référence haute précision (fonction gamma
incomplète, ~1e-15) :

| p                            | Acklam            | Référence         | Erreur absolue |
| ---------------------------- | ----------------- | ----------------- | -------------- |
| 0,90                         | 1,281 551 564 140 | 1,281 551 565 545 | 1,4e-9         |
| 0,9265 (ratio critique réel) | 1,449 998 908 650 | 1,449 998 907 053 | 1,6e-9         |
| 0,95                         | 1,644 853 625 134 | 1,644 853 626 952 | 1,8e-9         |
| 0,99                         | 2,326 347 874 388 | 2,326 347 874 041 | 3,5e-10        |

Erreur absolue maximale sur la plage réellement utilisée `p ∈ [0,01 ; 0,999]` : **2,9e-9**
(erreur relative 1,1e-9, conforme à la borne publiée). Traduite en production sur la session
type : **1,2e-7 crêpe**. Un raccord de 4,5e-9 subsiste en `p = 0,02425`, sans conséquence :
aucun seuil de décision ne s'y appuie.

---

## 3. Le `it.fails` sur l'intervalle p10–p90 : c'était le TEST qui était faux

`invariants.test.ts` portait un `it.fails` documentant que « l'intervalle p10–p90 ne se
resserre pas quand l'historique s'allonge », attribué à `sigmaRetenu(n, null, parametres)`
écrit en dur dans `moteur.ts`.

**Diagnostic : le défaut de production a été corrigé par D-034, le test ne l'a pas suivi.**
`EntreePrevision` a bien gagné un champ `sigmaObserve`, et
`apps/api/src/routes/previsions.ts:200` le remplit avec la mesure de `calculerBaseline`.
Mais le fabricant `entreePrevision` du fichier de test ne pose **aucun** `sigmaObserve` : les
deux appels retombaient tous les deux sur le prior, et l'assertion échouait pour une raison qui
n'avait plus rien à voir avec le modèle.

Remplacé par **deux** tests de non-régression, parce que la propriété d'origine était elle-même
mal formulée :

1. **L'intervalle se resserre quand la mesure devient exploitable** — en fournissant un σ
   mesuré sous le plancher, la largeur `p90 − p10` décroît strictement de `n = 7` à `n = 25`,
   et la recommandation avec.
2. **L'intervalle ne se resserre PAS quand les données restent dispersées.** C'est le pendant
   d'honnêteté, et il est essentiel : un intervalle de **prédiction** mesure la variabilité de
   la demande, pas celle de l'estimateur. Il converge vers la dispersion réelle, il ne tend pas
   vers zéro. Un modèle qui rétrécirait son intervalle avec le seul nombre de sessions
   mentirait — exactement le reproche que `docs/03` adresse au « 168 crêpes sans intervalle ».
   La **confiance affichée**, elle, monte : c'est elle qui porte la maturité de l'historique.

---

## 4. Honnêteté du modèle

| Exigence de `docs/03`                                | État                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Intervalle volontairement large sous 8 sessions      | ✔ (et l'unité est maintenant la bonne)                                              |
| Plancher de σ entre 8 et 25 sessions                 | ✔                                                                                   |
| σ mesuré au-delà de 25 sessions                      | ✔ (depuis D-034 ; désormais testé)                                                  |
| Confiance = f(sessions, dispersion, âge des données) | **partiel** — `n/(n+10)`, ne dépend que du nombre de sessions                       |
| « Prévision : 150 à 195 crêpes. Confiance faible »   | ✔                                                                                   |
| Le modèle dit quand il ne sait pas                   | ✔ pour σ, **non** pour les facteurs saison / tendance, qui valent 1,00 sans le dire |

**Point à trancher** : `confianceBp(n) = n / (n + 10)` n'est pas spécifié par `docs/03`, qui
demande une fonction de trois variables. La constante `10` (le point de demi-confiance) est un
seuil de maturité de la même famille que `prevision_sessions_avant_sigma_mesure` : elle
devrait vivre au catalogue. Voir §6.

> **Mise à jour du 30/07/2026 — la constante en dur est corrigée.** `confianceBp` exige désormais
> deux arguments, sans valeur par défaut dans la signature :
> `confianceBp(nbSessions: number, demiConfianceSessions: number)`
> (`packages/core/src/prevision/moteur.ts:262`). La demi-confiance vit au catalogue sous
> `prevision_demi_confiance_sessions` (défaut `10`, `packages/core/src/parametres.ts:433-444`) et
> l'appel réel la lit là : `packages/core/src/prevision/moteur.ts:500-503`. Une garde renvoie `0`
> si la demi-confiance transmise est `≤ 0`, pour ne jamais annoncer 100 % de confiance dès la
> première session (`moteur.ts:268`). Reste vrai : la confiance ne dépend toujours que du nombre
> de sessions, pas de la dispersion ni de l'âge des données — ce n'est pas ce point-là qui a été
> corrigé, seulement le codage en dur de la constante.

---

## 5. `rapprocherPrevision` : confirmé orphelin

> **Mise à jour du 30/07/2026 — ce n'est plus un orphelin.** `rapprocherPrevision` est désormais
> appelée en production, exactement au point d'insertion décrit plus bas dans cette même section :
> `packages/db/src/services/sessions.ts:1070`, dans la transaction de `cloturerSession`, après le
> calcul de `totaux.crepesVendues` (import à `sessions.ts:50`). Le constat d'origine ci-dessous est
> gardé tel quel — il documente le défaut qui a motivé le branchement, et le commentaire laissé
> au point d'appel (`sessions.ts:1059-1068`) cite lui-même mot pour mot le diagnostic de cet audit.
> Restent à vérifier séparément (non revérifié dans cette mise à jour) : le rattrapage des sessions
> déjà clôturées avant ce correctif (précaution n°3 ci-dessous), et si l'écran `QualiteModele.tsx`
> affiche désormais des lignes.

`packages/db/src/depots/previsions.ts:355`. Recherche exhaustive sur tout le dépôt : la seule
référence hors de sa définition est la ré-exportation dans `packages/db/src/index.ts:87`.
**Aucun appelant.** Conséquence en chaîne :

- `prevision.crepes_reelles` et `prevision.erreur_absolue_bp` restent `NULL` à vie ;
- `qualiteModele()` filtre sur `crepes_reelles IS NOT NULL` → **toujours zéro ligne** ;
- l'écran `QualiteModele.tsx` affiche donc en permanence « aucune prévision rapprochée » ;
- l'étape 7 de `docs/03` (« Sans mesure, aucune amélioration ») est inerte.

### Ce qu'il faut brancher — le service de clôture n'appartient pas à cet audit

Point d'insertion exact : `packages/db/src/services/sessions.ts`, dans la transaction de
`cloturerSession`, **après** la mise à jour de `sessionMarche` (le nombre de crêpes vendues
y est déjà calculé, `totaux.crepesVendues`) :

```ts
// Sans ce rapprochement, l'ecran « Qualite du modele » mesure un ensemble vide
// et le modele ne peut jamais etre juge (docs/03, etape 7).
rapprocherPrevision(baseTx, sessionId, totaux.crepesVendues);
```

Trois précautions à prendre au moment de le brancher :

1. **Dans la transaction**, pour que le rapprochement soit atomique avec la clôture.
2. **Ne pas rapprocher une session `exclure_du_modele`** — ou alors la rapprocher tout en
   l'excluant des agrégats de `qualiteModele` : une panne de gaz n'est pas une erreur de
   prévision, et la compter comme telle ferait chuter artificiellement la qualité mesurée.
3. **Rapprocher aussi les sessions déjà clôturées** une fois pour toutes (petit script de
   rattrapage), sinon l'historique existant restera vide.

À vérifier aussi : `sessionMarche.crepesVendues` doit être écrit par la clôture, puisque
`observationsDuLieu` le lit pour reconstruire la baseline.

---

## 6. Clés de paramètre à ajouter au catalogue

Toutes sont des **valeurs métier** au sens de D-041 (elles décrivent la réalité de
l'utilisateur, pas la forme d'une formule). Aucune n'est utilisée par le code aujourd'hui :
elles sont proposées pour refermer les trous identifiés ci-dessus.

> **Mise à jour du 30/07/2026 — cinq des sept clés proposées ci-dessous existent désormais au
> catalogue et sont lues en production**, vérifié par grep sur tout le dépôt :
>
> - `prevision_meteo_ensoleille_tiede_bp` et `prevision_meteo_ensoleille_frais_bp` :
>   `packages/core/src/parametres.ts:294,311`, lues dans `packages/core/src/prevision/meteo.ts:73-74`.
> - `prevision_demi_confiance_sessions` : voir §4 ci-dessus.
> - `prevision_tendance_borne_bp` et `prevision_tendance_sessions_minimum` : au catalogue
>   (`parametres.ts:490,512`), lues via `entierAvecRepli` dans
>   `apps/api/src/routes/previsions.ts:723-727` pour construire `ConfigTendance`.
>
> Les deux dernières n'ont **pas** été ajoutées sous le nom proposé ici, mais le trou qu'elles
> visaient à combler est refermé par un mécanisme différent, plus riche que ce qui était esquissé :
>
> - `prevision_evenement_pas_impact_bp` (modèle linéaire à un seul coefficient) n'existe pas —
>   remplacé par un jeu de paramètres à décote par distance et par famille d'événement :
>   `evenement_coefficient_portee_quartier_bp`, `..._liege_bp`, `..._national_bp`,
>   `evenement_pente_intensite_bp`, `evenement_distance_sans_decote_km`,
>   `evenement_distance_decote_max_km`, `evenement_distance_plancher_bp`
>   (`packages/core/src/parametres.ts:1213-1293`).
> - `volume_transportable_max_ml` n'existe pas sous ce nom — la quatrième contrainte dure qu'elle
>   visait existe sous la clé `transport_volume_pate_max_ml` (voir `docs/03-MOTEUR-PREVISION.md`,
>   section « Contraintes dures », mise à jour du 30/07/2026).

```ts
{
  cle: 'prevision_meteo_ensoleille_tiede_bp',
  typeValeur: 'entier',
  valeurDefaut: '11000',
  description:
    'Facteur météo par temps ensoleillé entre la borne haute du « doux » et le seuil de ' +
    'chaleur (11000 = ×1,10). Referme le trou de la grille de docs/03, qui donne un ' +
    'facteur à 10–22 °C puis à plus de 26 °C, et rien entre les deux. Ces journées ' +
    'retombaient sur le facteur neutre par défaut de classification.',
  source: 'docs/15-AUDIT-MOTEUR-PREVISION.md §1.2 — trou constaté sur le relevé du 28/07/2026.',
  dateDebutValidite: '2026-01-01',
},
{
  cle: 'prevision_meteo_ensoleille_frais_bp',
  typeValeur: 'entier',
  valeurDefaut: '10500',
  description:
    'Facteur météo par temps ensoleillé entre le seuil de froid et la borne basse du ' +
    '« doux » (10500 = ×1,05). Second trou de la grille de docs/03 : un dimanche ' +
    'ensoleillé à 8 °C était classé « couvert et sec ».',
  source: 'docs/15-AUDIT-MOTEUR-PREVISION.md §1.2.',
  dateDebutValidite: '2026-01-01',
},
{
  cle: 'prevision_demi_confiance_sessions',
  typeValeur: 'entier',
  valeurDefaut: '10',
  description:
    'Nombre de sessions au bout duquel la confiance affichée atteint 50 % : ' +
    'confiance = n / (n + k). Règle la vitesse à laquelle le modèle se déclare mûr. ' +
    'docs/03 situe la qualité utile vers 20 à 30 sessions, ce que k = 10 donne ' +
    '(20 → 67 %, 30 → 75 %).',
  source: 'docs/03-MOTEUR-PREVISION.md, section incertitude — niveau de confiance affiché.',
  dateDebutValidite: '2026-01-01',
},
{
  cle: 'prevision_evenement_pas_impact_bp',
  typeValeur: 'entier',
  valeurDefaut: '500',
  description:
    "Pas d'impact d'un événement par unité de « portée × intensité » (500 = 5 %). " +
    'Applique la formule f = 1 + (portée × intensité × pas) de docs/03, aujourd’hui ' +
    'absente du code : portée et intensité sont saisies puis ignorées.',
  source: 'docs/03-MOTEUR-PREVISION.md, facteur 3 — « × 0,05 ».',
  dateDebutValidite: '2026-01-01',
},
{
  cle: 'prevision_tendance_borne_bp',
  typeValeur: 'entier',
  valeurDefaut: '3000',
  description:
    'Amplitude maximale du facteur de tendance, en points de base (3000 = ±30 %). ' +
    "Empêche qu'une série chanceuse produise une extrapolation absurde.",
  source: 'docs/03-MOTEUR-PREVISION.md, facteur 5 — « bornée à ±30 % ».',
  dateDebutValidite: '2026-01-01',
},
{
  cle: 'prevision_tendance_sessions_minimum',
  typeValeur: 'entier',
  valeurDefaut: '10',
  description:
    'Nombre de sessions closes en dessous duquel le facteur de tendance reste neutre. ' +
    'Sous ce seuil, une régression sur si peu de points mesure du bruit.',
  source: 'docs/03-MOTEUR-PREVISION.md, facteur 5 — « neutre tant que n < 10 ».',
  dateDebutValidite: '2026-01-01',
},
{
  cle: 'volume_transportable_max_ml',
  typeValeur: 'entier',
  valeurDefaut: '25000',
  description:
    'Volume total de pâte transportable sans véhicule personnel, en millilitres. ' +
    'Quatrième contrainte dure de docs/03, aujourd’hui absente du calcul.',
  source: 'docs/03-MOTEUR-PREVISION.md, contraintes dures — à mesurer sur le matériel réel.',
  dateDebutValidite: '2026-01-01',
},
```

**Ne sont PAS des paramètres** (D-041 — elles décrivent la forme d'une formule, pas la réalité
de l'utilisateur) : les coefficients d'Acklam, ceux de l'approximation de Hart pour Φ, la
conversion CV → σ, le facteur `exp(σ²/2)` entre moyenne et médiane, et les quantiles 10 % et
90 % qui _définissent_ p10 et p90.

---

## 7. Ce qui reste à faire, par ordre de rendement

1. **Brancher `rapprocherPrevision`** (§5). Sans mesure, aucune des suites n'est arbitrable.
2. **Câbler la contrainte de stock** — `apps/api/src/routes/previsions.ts:191` passe `null`.
   Recommander 220 crêpes avec de quoi en faire 80 est le pire mode de défaillance possible.
3. **Écrire `impact_mesure_bp` à la clôture** : `impact = réel / (baseline × f_météo × f_saison)`.
   Le mécanisme d'apprentissage le plus rentable du système, d'après `docs/03` lui-même.
4. **Refermer les deux trous de la grille météo** (§6, deux premières clés).
5. Facteur tendance, puis facteur saison, puis répartition R1/R2.
6. `npm run backtest`, MAPE glissante, taux de rupture, taux d'invendu.

> **Mise à jour du 30/07/2026 — les six points sont faits.** Vérifié contre le code, indépendamment
> de `docs/17-VINGT-AMELIORATIONS.md` §2.1 qui les listait déjà « CORRIGÉ » :
>
> 1. Fait — voir l'encadré de §5.
> 2. Fait : `apps/api/src/routes/previsions.ts:979` porte désormais
>    `stockMaximalCrepes: plafondStockCrepes(base, session.dateSession)`, plus de `null` en dur. Un
>    commentaire du même fichier (`:1895`) cite explicitement cette ligne du présent audit comme
>    l'ancien état.
> 3. Fait : `packages/db/src/depots/previsions.ts:841` écrit
>    `.set({ impactMesureBp: moyenneBp, … })`, dans une fonction dont le commentaire (`:773`) cite
>    « docs/17 fiches 2/4, D-059 ». La lecture (`impactMesureBp ?? impactEstimeBp`,
>    `depots/previsions.ts:211`) n'est donc plus une branche morte.
> 4. Fait — voir l'encadré de §6.
> 5. Fait : `saisonBp` et `tendanceBp` sont importés et utilisés dans
>    `apps/api/src/routes/previsions.ts:40,51` (modules dédiés `prevision/saison.ts`,
>    `prevision/tendance.ts`, non ré-audités ligne à ligne ici).
> 6. Fait : `"backtest": "tsx packages/db/src/scripts/backtest.ts"` existe dans `package.json:34`.
>
> Cela ne signifie pas que §1 à §6 de ce document (le corps de l'audit, daté du 28/07/2026) sont
> devenus faux : ils décrivent un état antérieur, correctement, et les encadrés déjà présents plus
> haut (§4, §5, §6) corrigent les points où le texte d'origine serait lu comme encore vrai
> aujourd'hui. Cette liste de fin, elle, parlait au futur (« ce qui reste à faire ») et ne l'est
> plus : c'est la seule raison de la corriger ici.

---

## 8. Fichiers modifiés par cet audit

| Fichier                                       | Nature                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/prevision/statistiques.ts` | `repartitionNormale`, `ventesEsperees`, `medianeDepuisEsperance`, `sigmaDepuisCoefficientVariation` ; durcissement de `ratioCritique` et `quantileLogNormal` |
| `packages/core/src/prevision/moteur.ts`       | D1, D2, D3, D6, D7 ; champ `demandeAttendue` ; `manqueAGagnerEcretage`                                                                                       |
| `packages/core/src/prevision/meteo.ts`        | Libellé honnête quand le ciel est dégagé ; documentation des deux trous                                                                                      |
| `packages/core/src/prevision/moteur.test.ts`  | Tests des nouvelles primitives ; assertions réécrites sur la **formule**, jamais sur un nombre figé                                                          |
| `packages/core/src/invariants.test.ts`        | `it.fails` diagnostiqué et converti en deux non-régressions ; huit propriétés ajoutées                                                                       |

Couverture de `packages/core/src/prevision` : **100 %** lignes, branches, fonctions.
