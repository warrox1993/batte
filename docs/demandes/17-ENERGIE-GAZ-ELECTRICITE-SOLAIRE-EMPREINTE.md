# Fiche 17 — Énergie : gaz, électricité, autoproduction et empreinte carbone

> **Origine** : idée dictée par le porteur le 29/07/2026, mise en forme par Claude Code.
> **Statut** : brouillon à relire et amender. Rien n'est codé.
> **[À TRANCHER]** = décision attendue. **[HYPOTHÈSE]** = supposition de rédaction.
> **[VÉRIFIÉ]** = constat lu dans le code. **[ALERTE]** = point qui heurte une règle du projet.
>
> **Note de statut — 30/07/2026, vérifiée contre le code (met à jour la note du 29/07/2026 : le
> solaire et l'empreinte ont été codés dans l'intervalle).** Les volets gaz, électricité, **solaire
> et empreinte physique sont désormais tous implémentés** au niveau cœur + API :
>
> - Électricité/disjonction : tables `equipement`/`equipement_session`,
>   `lieu_marche.facturation_electricite` et `puissance_disponible_w` (**D-055**),
>   `packages/core/src/energie.ts` (`diagnosticPuissanceLieu`, `coutEnergieSessionCents` — coût au
>   kWh uniquement quand le lieu facture au compteur, jamais au forfait ni compris).
> - **§3, point d'équilibre solaire/éolien** : `pointEquilibreAutoproduction` et
>   `coutEnergieEviteeAutoproductionMoyenne` (`packages/core/src/energie.ts`), avec le garde-fou
>   demandé au §3.1 codé en dur dans la logique (`TYPES_EQUIPEMENT_AUTOPRODUCTION_MOBILE` =
>   éclairage, froid actif, terminal de paiement **seulement** — jamais la cuisson ni le
>   chauffage) et son avertissement affichable (`AVERTISSEMENT_POINT_EQUILIBRE_AUTOPRODUCTION`).
>   Exposé par `GET /equipements/point-equilibre-autoproduction`
>   (`apps/api/src/routes/equipements.ts:164`).
> - **§4.2, tableau de quantités physiques** : `quantitesPhysiquesParIngredient`,
>   `kilometresParcourusAllerRetour`, `energieElectriqueTotaleKwh` — exactement l'hypothèse de
>   rédaction retenue (« quantités physiques d'abord, sans conversion CO₂ »), avec
>   `AVERTISSEMENT_EMPREINTE_CARBONE` explicite sur l'absence de facteur d'émission. Exposé par
>   `GET /equipements/empreinte-quantites-physiques` (`apps/api/src/routes/equipements.ts:248`).
> - **§4.1/4.3, conversion en CO₂ et argument commercial : toujours PAS implémentés**, et à dessein
>   — `CLAUDE.md` §7 (aucun taux réglementaire codé en dur) et §3 règle 2 (un LLM n'estime aucun
>   facteur d'émission) l'interdisent tant qu'aucune source publique datée n'est ajoutée au
>   catalogue. Le code le dit lui-même dans son commentaire d'en-tête.
> - **Correction du 30/07/2026, même jour** : la ligne ci-dessus, écrite plus tôt dans la journée,
>   affirmait qu'aucun écran ne consommait ces deux routes. **Revérifié en fin de journée, c'est
>   faux à cet instant** : `apps/web/src/pages/Equipements.tsx` affiche désormais un panneau
>   « Point d'équilibre solaire / éolien » (coût d'énergie évité par session, avertissement,
>   tableau par équipement) et un panneau « Empreinte — quantités physiques » (kilomètres
>   parcourus, énergie électrique en kWh, avertissement sur l'absence de conversion CO₂), tous deux
>   alimentés par les deux routes ci-dessus. La page est routée (`/equipements`, `App.tsx`) et
>   présente dans la navigation (« Équipements »). Le code a bougé plusieurs fois dans la même
>   journée pendant cette relecture ; ne pas se fier à un état antérieur non revérifié.

---

## 1. La demande, dans ses mots

> « Tu dois rajouter comme ressource supplémentaire au gaz, **l'électricité**. Même si à terme on
> souhaite que notre stand soit alimenté en **panneaux solaires** et par **l'énergie du vent** afin
> de réduire notre **empreinte carbone** et nos **coûts** surtout. »

---

## 2. Le point central : le gaz est un stock, l'électricité est un flux

C'est la difficulté de cette fiche, et elle n'est pas anodine.

**[VÉRIFIÉ]** Le gaz existe déjà comme **catégorie d'ingrédient** (`'gaz'`). C'est cohérent : le gaz
s'achète **en bouteilles**. Une bouteille a un fournisseur, une date de réception, une quantité, un
prix payé. Elle entre en stock, elle en sort. Tout le modèle s'applique sans effort.

**L'électricité, non.** Elle ne s'achète pas par unités identifiables, elle se **compte au compteur**.
Il n'y a ni lot, ni DLC, ni FEFO. Les règles n° 5 et n° 6 de `CLAUDE.md` — le stock ne bouge que par
mouvement, et toute entrée crée un lot traçable — n'ont **aucun sens** pour des kilowattheures.

> Forcer l'électricité dans la table `ingredient` reviendrait à créer des lots fictifs de kWh avec
> des DLC inventées. Ce serait techniquement possible et intellectuellement faux.

**[À TRANCHER]** Deux façons de la représenter :

- **A — une charge, pas un stock.** L'électricité est une dépense (`depense`), rattachée à une
  session ou à une période. _Simple, honnête, et immédiat : la table existe déjà._
- **B — une ressource consommée, à côté du stock.** Une notion nouvelle « ressource », avec un
  compteur relevé, sans lot ni traçabilité. _Plus juste conceptuellement, mais c'est un nouveau
  concept à construire pour une seule ligne de coût._

**[HYPOTHÈSE de rédaction]** : **A**. Tant que l'électricité ne sert pas à identifier un lot en cas
de rappel — et elle ne le fera jamais — elle n'a rien à faire dans le stock alimentaire. Le gaz y
est parce qu'il arrive en bouteilles, pas parce que c'est de l'énergie.

**Conséquence** : ce n'est pas « ajouter l'électricité à côté du gaz ». C'est **admettre que le gaz
et l'électricité ne sont pas la même chose pour l'application**, même s'ils sont la même chose pour
le stand.

---

## 3. Le solaire et l'éolien déplacent le coût, ils ne le suppriment pas

C'est le point le plus intéressant de la demande, et il a une réponse propre.

Une fois les panneaux installés, un kilowattheure produit ne coûte **rien** à la consommation. Mais
les panneaux, eux, ont coûté. **Le coût n'a pas disparu : il a changé de nature.**

- Le gaz est une **charge variable** — chaque bouteille se paie, et le coût monte avec l'activité.
- Le solaire est un **investissement amorti** — on paie une fois, puis on étale.

**[VÉRIFIÉ]** L'application sait déjà faire exactement ça : la table `immobilisation` gère les biens
amortis, et la synthèse d'exercice tient compte de l'amortissement.

Donc **rien de neuf n'est à construire** pour le solaire : des panneaux sont une immobilisation
comme une remorque ou une plaque. Le « coût de l'électricité solaire » d'une session, c'est la part
d'amortissement de cette session.

**[À TRANCHER]** Sur quelle durée amortir ? Les panneaux et une batterie n'ont pas la même durée de
vie — une batterie se remplace bien plus souvent que des panneaux. Deux immobilisations distinctes
valent probablement mieux qu'une seule.

### 3.1 Le calcul qui vaut vraiment la peine : le point d'équilibre

La question réelle n'est pas « combien coûte mon électricité ». C'est :

> **Au bout de combien de sessions l'installation est-elle remboursée par le gaz que je n'achète
> plus ?**

C'est un calcul simple, et tous ses termes existent déjà dans l'application :

```
sessions avant équilibre  =  coût de l'installation
                             ────────────────────────────────
                             coût d'énergie évité par session
```

**[HYPOTHÈSE de rédaction]** : c'est **la** fonctionnalité à retenir de cette fiche. Elle transforme
une intention écologique en décision chiffrée, et elle se calcule avec ce qui est déjà en base
(frais de gaz historiques par session, immobilisations). Le reste est du confort.

**[À TRANCHER]** Attention à ne pas fausser ce calcul : le solaire ne remplace pas le gaz pour
**cuire**. Une plaque à crêpes électrique demande une puissance qu'une installation mobile modeste
ne fournira pas. Le solaire couvre plutôt l'éclairage, le terminal de paiement, un petit froid actif.
Comparer « coût des panneaux » à « tout le budget gaz » donnerait un point d'équilibre trop
optimiste.

### 3.2 L'éolien, à traiter à part

Une petite éolienne mobile est un tout autre sujet qu'un panneau : rendement très dépendant du site,
encombrement, bruit, sécurité par vent fort, et autorisations sur un emplacement de marché.

**[HYPOTHÈSE]** : pour l'application, rien ne change — c'est une immobilisation de plus. La question
est d'exploitation, pas de logiciel. À ne pas modéliser séparément tant que la décision d'achat
n'est pas prise.

---

## 4. L'empreinte carbone — un axe entièrement nouveau

### 4.1 Ce que ça demande vraiment

Mesurer une empreinte carbone, ce n'est pas ajouter une colonne. Il faut un **facteur d'émission**
par ingrédient, par kWh, par litre de carburant, par kilomètre parcouru.

**[ALERTE]** Ces facteurs sont des **données réglementaires externes**, avec une source et une date
de validité. Deux règles du projet s'appliquent directement :

- `CLAUDE.md` §7 : « ne pas coder en dur des taux, seuils ou montants réglementaires : table
  `parametre`, avec date de validité et source ». Les facteurs d'émission sont exactement ça.
- `CLAUDE.md` §3 règle 2 : **un LLM ne calcule jamais**. Claude ne doit produire aucun facteur
  d'émission. Ce sont des valeurs à reprendre d'une base publique (ADEME, ou équivalent belge),
  avec la source citée — jamais à estimer.

> Le risque, ici, est celui du **greenwashing involontaire** : afficher « 0,42 kg CO₂ par crêpe »
> avec un chiffre inventé serait pire que ne rien afficher. Si les facteurs ne sont pas sourcés,
> mieux vaut ne pas produire le nombre.

### 4.2 Ce qui est déjà mesurable sans rien inventer

Il y a une bonne nouvelle : les **postes** sont déjà tous en base, même si leurs facteurs n'y sont
pas.

| Poste            | Donnée déjà présente                               |
| ---------------- | -------------------------------------------------- |
| Déplacement      | kilomètres (fiche 13)                              |
| Gaz              | quantité achetée, catégorie `'gaz'`                |
| Électricité      | à venir (§2)                                       |
| Matière première | quantités par ingrédient, par lot, par fournisseur |
| Consommables     | serviettes, gobelets, assiettes (fiche 15)         |

**[HYPOTHÈSE de rédaction]** : commencer par afficher les **quantités physiques** — litres de
carburant, kilos de farine, kWh, nombre de gobelets — sans les convertir en CO₂. C'est déjà un
tableau de bord environnemental honnête, il ne demande **aucune donnée externe**, et il suffit à
voir ce qui pèse. La conversion en CO₂ viendra quand les facteurs seront sourcés.

### 4.3 Et si ça devient un argument commercial

**[À TRANCHER]** Un stand qui affiche son empreinte, c'est un argument de vente — mais un argument
**contrôlable**. Toute allégation environnementale communiquée au client engage, au même titre
qu'une allégation nutritionnelle. Si ces chiffres sortent de l'application pour aller sur une
affiche, ils doivent être sourcés et datés. Même exigence que pour le registre AFSCA : on n'affiche
que ce qu'on peut justifier.

---

## 4bis. Le chauffage — le premier coût qui dépend de la météo

> « On va devoir tenir compte aussi de **radiateur dans les coûts quand il fait froid**. »

### 4bis.1 Pourquoi ce n'est pas juste une ligne de frais de plus

C'est le point qui rend cette demande intéressante : **c'est le premier coût de l'application qui
dépend du temps qu'il fait**.

**[VÉRIFIÉ]** L'application enregistre déjà la météo par session (température, ressenti,
précipitations) et s'en sert dans le moteur de prévision. Mais elle ne s'en sert que **du côté de la
demande** — combien de clients viendront. Jamais du côté des **coûts**.

Un radiateur change ça : à −2 °C il tourne, à 18 °C il ne sert à rien. Le coût de la session dépend
donc directement d'une donnée que l'application possède déjà.

**[HYPOTHÈSE de rédaction]** : c'est ce qui rend cette demande utile bien au-delà du radiateur.
Une fois qu'un coût sait dépendre de la météo, la prévision peut annoncer une **marge nette
attendue** qui tient compte du froid — pas seulement un nombre de crêpes.

### 4bis.2 Le froid a deux effets opposés, et il faut les garder séparés

- Il **augmente la demande** — une crêpe chaude se vend mieux quand il gèle. Le moteur le sait déjà.
- Il **augmente les coûts** — chauffage, et gaz consommé plus vite par les plaques à l'air libre.

**[À TRANCHER]** Ne pas fusionner les deux en un seul « facteur froid ». Ce sont deux effets de
sens contraire sur deux grandeurs différentes ; les mélanger produirait un chiffre net dont
personne ne saurait dire d'où il vient. Deux effets explicites, une marge qui en découle.

### 4bis.2bis Plaque de cuisson ou radiateur ? — l'arbitrage le plus intéressant de la fiche

> _« Pour ce qui est de la chaleur, on va devoir calculer quelle température générale les plaques
> de cuisson en moyenne, en sachant que nous serons dans un stand fermé mais en plein air. Donc on
> va devoir calculer si ce ne serait pas plus utile de rajouter une plaque de cuisson qu'un
> radiateur, selon la production prévue. »_

L'intuition est juste, et elle est meilleure que ce qu'elle a l'air : **une plaque fait deux
métiers, un radiateur un seul.** Elle chauffe _et_ elle produit. C'est un raisonnement de coût
complet, exactement dans l'esprit de la fiche 13.

Il faut séparer trois questions, parce que l'application peut en trancher une, doit en refuser une,
et n'a pas voix sur la troisième.

#### ✅ Ce que l'application PEUT trancher — et c'est la question décisive

**La capacité de cuisson est-elle la contrainte qui limite les ventes ?**

**[VÉRIFIÉ]** `capacite_cuisson_crepes_par_heure` est déjà un paramètre du moteur de prévision, et
il sert déjà d'**écrêtage** : quand la demande prévue dépasse ce que les plaques savent cuire, la
prévision est plafonnée.

Ce plafond est exactement l'information qui tranche :

| Ce que dit la prévision                                      | Ce qu'il faut acheter                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| L'écrêtage **mord** — on refuse des clients faute de cuisson | **Une plaque.** Elle rapporte du chiffre d'affaires **et** elle chauffe. Le radiateur ne fait que coûter. |
| L'écrêtage **ne mord pas** — la demande est servie           | **Un radiateur.** Une plaque de plus ne cuirait rien de plus ; on paierait du gaz pour du confort.        |

**Et un troisième argument, décisif sur certains lieux** : une plaque au gaz **ne demande pas
d'électricité**. Là où le courant n'existe pas — et c'est le cas par défaut, décision **D-055** —
le radiateur électrique n'est **pas une option du tout**. La plaque devient alors le seul moyen de
chauffer, indépendamment de toute considération de rentabilité.

**[HYPOTHÈSE de rédaction]** : c'est _la_ fonctionnalité à retenir de cette section, et elle ne
demande **aucun calcul nouveau**. Il s'agit de regarder une donnée que le moteur produit déjà, sur
l'historique des sessions froides : combien de fois l'écrêtage a-t-il mordu ? Si la réponse est
« jamais », la question est réglée sans thermodynamique.

Et comparer les **puissances** est également honnête, parce qu'elles se lisent sur les plaques
signalétiques : une plaque à crêpes professionnelle au gaz développe couramment plusieurs
kilowatts, un radiateur d'appoint électrique un à deux. Ce sont des chiffres **relevés**, pas
estimés.

#### ❌ Ce que l'application ne doit PAS calculer : la température dans le stand

Prévoir la température intérieure demanderait le volume du stand, son isolation, son taux de
renouvellement d'air, l'exposition au vent, la température extérieure, l'humidité — dans une
structure **fermée mais en plein air**, donc avec des échanges d'air impossibles à caractériser.

Tout nombre produit serait **inventé**. Et il serait cru, parce qu'affiché par un outil.

> `CLAUDE.md` §3 règle 2 : **un LLM ne calcule jamais**, et aucun chiffre non déterministe n'entre
> en base. Le même principe vaut ici pour la physique : mieux vaut **ne pas afficher de
> température** que d'en afficher une fausse. On compare des **puissances de chauffe relevées**,
> jamais une température obtenue.

**[À TRANCHER]** Si la question se pose vraiment à l'usage, la réponse n'est pas un modèle
thermique : c'est **un thermomètre dans le stand**. L'application enregistre déjà des relevés de
température pour l'AFSCA — mesurer vaut mieux que simuler, et coûte moins cher.

#### 🔴 SÉCURITÉ — la question qui prime sur l'arbitrage économique

Un point à poser clairement, parce qu'il ne relève pas de l'application et qu'il ne doit pas se
perdre dans un tableau de coûts.

**Faire fonctionner des appareils à combustion gaz dans un stand fermé est un risque de monoxyde
de carbone.** La combustion consomme l'oxygène et produit du CO, inodore et incolore. Ce risque
augmente avec **chaque brûleur ajouté** — c'est-à-dire exactement ce que propose cet arbitrage.

Cela ne condamne pas l'idée : les stands professionnels au gaz existent et fonctionnent. Mais la
ventilation nécessaire, et l'éventuelle obligation d'un détecteur de CO, sont à valider **auprès
d'un professionnel du gaz, du règlement du marché et de l'assurance** — pas à déduire d'un calcul
de rentabilité.

**[HYPOTHÈSE de rédaction]** : si un écran propose un jour cet arbitrage, il doit porter la même
mention que les écrans de synthèse fiscale — l'application aide à décider, elle ne remplace ni un
professionnel ni un contrôle. C'est déjà la règle du projet (`CLAUDE.md` §7).

### 4bis.3 Le lien direct avec les marchés de Noël

**Un marché de Noël, c'est du froid, plusieurs jours de suite.** La fiche 14 le décrit comme une
famille d'opportunité à part ; le chauffage en est une ligne de coût structurelle, pas un détail.

Conséquence pour l'arbitrage de la **fiche 13** : le coût différentiel entre deux lieux **dépend de
la saison**. Comparer un marché de décembre et un marché de juin sans compter le chauffage
avantagerait le premier à tort.

### 4bis.4 Deux pièges concrets

1. **[TRANCHÉ par le porteur le 29/07] Le chauffage sera obligatoirement ÉLECTRIQUE, pas au gaz.**

   Bonne nouvelle immédiate : la question du partage de bouteille disparaît. Un radiateur
   électrique est une charge **distincte et mesurable**, sans le double comptage du §4.1 de la
   fiche 15. Pas de ventilation sous tente à gérer non plus.

   **Mais la conséquence est plus lourde que le confort de calcul** : un radiateur électrique
   **exige du courant sur place**. Or l'électricité dépend du lieu (décision **D-055**).

   Donc la question n'est plus « combien coûte le chauffage ? » mais **« puis-je chauffer ici,
   oui ou non ? »**. Ce n'est plus une ligne de coût, c'est un **critère de faisabilité du lieu** :

   - Un marché d'hiver **sans électricité** ne se chauffe pas. À l'utilisateur de décider s'il y va
     quand même — mais l'application doit le lui **dire avant**, pas le lui faire découvrir sur place.
   - Un marché de Noël sans courant perd d'un coup son intérêt (fiche 14). Le croisement
     « lieu sans électricité × saison froide » est un signal à afficher dans la liste des
     opportunités.

   **[HYPOTHÈSE de rédaction]** : l'attribut « électricité disponible » du lieu ne sert donc pas
   qu'à calculer un coût — il **filtre les opportunités hivernales**. C'est un usage bien plus
   utile que le simple chiffrage, et il ne demande qu'un croisement entre deux données déjà
   présentes : l'attribut du lieu et la météo attendue.

   **[À TRANCHER]** Un radiateur électrique tire couramment 1 000 à 2 000 W. Une installation
   solaire mobile modeste **ne le fera pas tourner**. Cela renforce l'avertissement du §3.1 : le
   calcul du point d'équilibre solaire ne doit **surtout pas** supposer que l'autoproduction
   couvrira le chauffage. Le solaire vise l'éclairage, le terminal et un petit froid actif — le
   chauffage restera sur le réseau du marché, quand il existe.
   1bis. **[DEMANDE du porteur] La consommation moyenne du radiateur se saisit à la main.**

   _« Pour le radiateur je dois pouvoir introduire manuellement sa consommation moyenne, afin de
   pouvoir avoir le type de radiateur. »_

   C'est la bonne façon de faire, et c'est cohérent avec tout le reste du projet : on ne code pas
   une valeur d'équipement en dur, on la **déclare**. Changer de radiateur devient un changement de
   paramètre, pas une modification de code.

   Le calcul qui en découle est immédiat :

   ```
   coût de la session  =  consommation moyenne (kW)  ×  durée de chauffe (h)  ×  prix du kWh
   ```

   Les trois termes sont déjà disponibles ou triviaux à saisir : la consommation vient de
   l'étiquette du radiateur, la durée se déduit des heures réelles de la session (déjà
   enregistrées), et le prix du kWh est un **paramètre daté et sourcé** comme tous les tarifs
   (`CLAUDE.md` §7).

   **[À TRANCHER] Le piège du prix du kWh sur un marché.** Sur beaucoup d'emplacements,
   l'électricité n'est **pas facturée au compteur** : elle est soit **comprise dans le prix de
   l'emplacement**, soit facturée au **forfait journalier**. Dans ce cas, calculer une
   consommation en kWh donnerait un coût qui n'existe pas, et il serait compté **en double** avec
   le tarif d'emplacement.

   Le mode de facturation est donc, lui aussi, un **attribut du lieu** — au même titre que la
   disponibilité du courant (D-055) : au compteur, au forfait, ou compris. **[HYPOTHÈSE]** trois
   cas, et le calcul ci-dessus ne s'applique qu'au premier.

   **[TRANCHÉ par le porteur le 29/07]** _« Il peut y avoir plusieurs sortes de radiateurs qui
   tournent en même temps. »_ Ce n'est donc pas **un** radiateur, c'est un **parc** d'appareils,
   chacun avec sa consommation déclarée et sa durée de fonctionnement.

   **[HYPOTHÈSE de rédaction — et elle n'est pas de la sur-abstraction]** : ne pas modéliser
   « le radiateur » mais **l'équipement électrique**. Le porteur a déjà nommé, au fil de la
   discussion, plusieurs appareils qui répondent tous au même modèle : radiateurs (au pluriel),
   éclairage, terminal de paiement, froid actif éventuel, plaques électriques si le lieu le permet.
   Un seul concept — un appareil, une puissance déclarée, une durée d'usage — les couvre tous.
   Créer un concept « radiateur » obligerait à en créer cinq autres identiques.

#### Le vrai risque n'est pas le coût, c'est le DISJONCTEUR

C'est le point que fait apparaître le « plusieurs en même temps », et il est plus grave que
l'arithmétique du coût.

**L'énergie et la puissance sont deux choses différentes.**

- L'**énergie** (kWh) détermine ce qu'on **paie**. Elle s'additionne dans le temps.
- La **puissance** (kW) détermine ce qui **passe dans le câble**. Elle s'additionne **à l'instant**.

Trois radiateurs de 1 500 W allumés ensemble, ce sont **4 500 W simultanés**. Or un emplacement de
marché fournit typiquement une prise limitée — souvent 16 A, soit environ 3 500 W. Au-delà, **ça
disjoncte**. Et ça disjoncte au pire moment : le matin, quand tout démarre en même temps.

> Un stand qui saute le disjoncteur à 8 h un dimanche de décembre, ce n'est pas une ligne de coût
> mal estimée — c'est une session compromise. Et l'application a **tout ce qu'il faut pour le
> prévoir**, puisqu'elle connaîtra la puissance de chaque appareil.

**[À TRANCHER]** Le lieu doit donc porter **trois** informations distinctes, et non une seule :

| Attribut du lieu                     | Répond à                                              |
| ------------------------------------ | ----------------------------------------------------- |
| Électricité disponible ?             | puis-je brancher quoi que ce soit (D-055)             |
| **Puissance ou ampérage disponible** | **combien d'appareils en même temps**                 |
| Mode de facturation                  | au compteur / au forfait / compris dans l'emplacement |

**[HYPOTHÈSE]** L'avertissement à afficher est simple et se calcule sans rien de neuf : la somme
des puissances des appareils prévus, comparée à la puissance du lieu. « 4 500 W prévus pour
3 500 W disponibles — deux radiateurs devront fonctionner en alternance. » C'est le genre
d'information qui vaut son écran, parce qu'elle évite un incident au lieu de le commenter après coup.

**[À TRANCHER]** Ce même parc d'équipements sert aussi à **comparer avant d'acheter** : ce que
coûterait un modèle de 1 000 W contre un de 2 000 W sur une saison réelle, avec les vraies durées
de session et les vraies températures. C'est le second usage de la saisie manuelle, et il justifie
de pouvoir déclarer un appareil **sans** qu'il soit en service.

2. **Un radiateur n'est pas qu'un coût.** Il retient les clients : on reste devant un stand où l'on
   a chaud. C'est une dépense qui **soutient le chiffre d'affaires**, pas seulement qui le grève.
   **[HYPOTHÈSE]** l'application ne saura pas mesurer cet effet, et ne doit pas prétendre le faire.
   Mais un écran qui listerait les coûts par ordre décroissant ne doit jamais suggérer de
   « supprimer le chauffage » comme une économie évidente — même précaution que pour les produits
   de présentation (fiche 15 §6.2).

**[À TRANCHER]** Sécurité : un chauffage à gaz sous une tente demande une ventilation, et
l'assurance comme le règlement du marché peuvent l'encadrer. Hors périmètre de l'application, mais
à vérifier avant l'achat.

---

## 5. Effets de bord de l'électricité sur le reste de l'application

**[VÉRIFIÉ]** `CLAUDE.md` §6 pose aujourd'hui : « pas d'électricité (gaz uniquement) ». Cette
contrainte irrigue plusieurs endroits.

| Ce qui change                            | Effet                                                                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capacité de cuisson**                  | c'est déjà un paramètre (`capacite_cuisson_crepes_par_heure`) et une contrainte d'écrêtage du moteur de prévision. Des plaques électriques la modifient — **une valeur à changer, pas du code** |
| **Chaîne du froid**                      | passive aujourd'hui (glacière et blocs eutectiques). Du froid actif changerait les relevés de température AFSCA et **permettrait de vendre de la pâte** (fiche 15 §5)                           |
| **Terminal de paiement, page connectée** | deviennent alimentables sur le stand                                                                                                                                                            |
| **`CLAUDE.md` §6**                       | la phrase « pas d'électricité » devra être révisée le jour venu, avec une décision consignée dans `docs/05-DECISIONS.md`                                                                        |

---

## 6. Ce que ça implique, récapitulé

| Chantier                               | Effort   | Remarque                                      |
| -------------------------------------- | -------- | --------------------------------------------- |
| Électricité comme charge (option A)    | faible   | la table `depense` existe                     |
| Panneaux/éolienne comme immobilisation | **nul**  | déjà supporté                                 |
| Calcul du point d'équilibre solaire    | faible   | **le vrai apport de cette fiche**             |
| Tableau des quantités physiques        | faible   | aucune donnée externe requise                 |
| Facteurs d'émission sourcés            | moyen    | table `parametre`, source + date obligatoires |
| Réviser §6 de `CLAUDE.md`              | décision | le jour où l'électricité arrive               |

---

## 7. Liens

- **Fiche 13** — coût complet : l'énergie en est une ligne ; le point d'équilibre en découle.
- **Fiche 15 §4.1** — le piège du double comptage du gaz (ingrédient **et** frais de session).
  À régler avant d'ajouter l'électricité, sinon on empile deux imprécisions.
- **`CLAUDE.md` §6** — la contrainte « pas d'électricité », appelée à changer.
- **`CLAUDE.md` §7** — pas de taux réglementaire codé en dur. S'applique aux facteurs d'émission.

---

## 8. Mise à jour du 01/08/2026 — revérification par un agent documentaire

**Tout ce que la note du 30/07/2026 affirmait tient toujours, revérifié fichier par fichier :**
`equipement` / `equipement_session` (`packages/db/src/schema.ts`), `facturation_electricite`
(quatre valeurs : `compteur | forfait | comprise | aucune`) et `puissance_disponible_w` sur
`lieu_marche`, `packages/core/src/energie.ts` (`diagnosticPuissanceLieu`,
`coutEnergieSessionCents`, `pointEquilibreAutoproduction`,
`coutEnergieEviteeAutoproductionMoyenne`, `quantitesPhysiquesParIngredient`,
`kilometresParcourusAllerRetour`, `energieElectriqueTotaleKwh`), les deux routes
(`GET /equipements/point-equilibre-autoproduction` et `GET /equipements/empreinte-quantites-physiques`,
`apps/api/src/routes/equipements.ts:164,248`), et les deux panneaux dans
`apps/web/src/pages/Equipements.tsx` (« Point d'équilibre solaire / éolien »,
« Empreinte — quantités physiques »), routés sur `/equipements` et présents dans la navigation.

**La conversion CO₂ et l'argument commercial (§4.1, §4.3) restent, de façon vérifiée et
volontaire, non implémentés.** Recherche refaite sur `CO2`, `CO₂`, tout nom évoquant un facteur
d'émission : les seules occurrences sont des commentaires expliquant pourquoi le calcul est
absent (`packages/core/src/energie.ts:434-449`, `apps/api/src/routes/equipements.ts:239-243`,
`apps/web/src/pages/Equipements.tsx:76-79`) et un texte d'avertissement affiché à l'écran
(`AVERTISSEMENT_EMPREINTE_CARBONE`). Aucune table `parametre` de facteurs d'émission, aucun
calcul de kg de CO₂ nulle part. **Ce n'est pas un manque** : c'est l'application directe de
`CLAUDE.md` §7 (pas de taux réglementaire codé en dur, source et date obligatoires) et §3
règle 2 (un LLM ne calcule jamais un facteur d'émission), exactement comme la fiche le
demandait au §4.1. Un futur lecteur qui verrait l'absence de conversion CO₂ ne doit pas la
prendre pour un oubli.

**Un point du §6 (tableau récapitulatif) est déjà réglé et peut être retiré des chantiers
restants.** La ligne « Réviser §6 de `CLAUDE.md` … le jour où l'électricité arrive » est
**faite** : `CLAUDE.md` §6 ne contient plus la phrase « pas d'électricité (gaz uniquement) ».
Il porte aujourd'hui, en toutes lettres, la doctrine D-055 : « L'électricité dépend du LIEU, pas
du projet. […] Le gaz reste la source de cuisson par défaut, et l'application doit rester
pleinement utilisable sans électricité […] Ce qui en dépend : la capacité de cuisson […], le
froid actif ou passif, et la possibilité d'un terminal de paiement connecté sur place. » La
révision demandée par cette fiche a donc déjà eu lieu, par un autre chantier (D-055), pas par
celui-ci — même situation que le §3.2 de la fiche 19 avec `ComparaisonLieux.tsx`.

**Aucune des deux fiches liées à la correction de résolution (`docs/07`, cible 1080p
responsive 1280/1080/1440 depuis le 01/08/2026) ne s'applique ici** : cette fiche 17 ne cite
aucune résolution d'écran, rien à corriger sur ce point.
