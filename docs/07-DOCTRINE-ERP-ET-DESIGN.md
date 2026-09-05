# 07 — Doctrine ERP et design d'interface

> Ce document est issu de deux recherches documentaires menées le 26–27/07/2026, l'une sur
> l'anatomie et le fonctionnement des ERP de premier rang (SAP S/4HANA, Dynamics 365 Business
> Central, Odoo, NetSuite), l'autre sur le craft visuel des logiciels d'entreprise haut de gamme.
>
> Il fait autorité sur **comment l'application doit fonctionner et à quoi elle doit ressembler**.
> Il complète `06-UI-ET-PARCOURS.md`, qui reste la référence des écrans et des parcours.
>
> Références retenues par le porteur : **SAP et Odoo**. Exigence complémentaire :
> **ultra intuitive**.

---

## 0. La thèse du produit

Le porteur a retenu trois mécanismes d'intuitivité sur sept. Ils disent tous la même chose :

> **L'application ne doit jamais faire sentir l'utilisateur perdu, craintif ou idiot.**

| Sentiment à éviter | Mécanisme                    | Conséquence technique                                            |
| ------------------ | ---------------------------- | ---------------------------------------------------------------- |
| **Perdu**          | l'application dit quoi faire | moteur de prochaines actions, cockpit, gestion par exception     |
| **Craintif**       | tout est réversible          | écriture d'annulation exposée à l'écran, historique sur la fiche |
| **Idiot**          | un seul vocabulaire, le sien | glossaire contraignant, libellés centralisés                     |

Cette thèse prime sur l'esthétique. Un écran beau mais désorientant est un échec.

**Critère de succès, vérifiable :** la partenaire du porteur doit pouvoir clôturer une session
seule, la première fois, sans manuel et sans appeler. Et, à l'échelle du produit : **quatre
sessions consécutives saisies intégralement dans l'application, sans carnet ni tableur parallèle.**

---

## 1. Anatomie d'un ERP de premier rang

### 1.1 La séparation fondatrice : référence contre transactionnel

|                           | Données de référence                   | Données transactionnelles               |
| ------------------------- | -------------------------------------- | --------------------------------------- |
| Nature                    | ingrédient, fournisseur, recette, lieu | réception, mouvement, vente, production |
| Modification              | autorisée, tracée                      | **interdite après comptabilisation**    |
| Suppression               | **remplacée par un blocage**           | **interdite**                           |
| Journal des modifications | oui, ciblé                             | **non — inutile, c'est immuable**       |
| Correction                | édition + trace                        | **écriture inverse**                    |

« On bloque, on ne supprime jamais » n'est pas de l'élégance : c'est de l'intégrité
référentielle appliquée au temps. Une écriture de 2026 référence l'ingrédient X ; supprimer X
en 2029 rend l'écriture illisible — ce que le droit comptable belge interdit pendant dix ans.

Les trois éditeurs implémentent la même chose : `Blocked` chez Business Central, booléen
`active` chez Odoo (« _If possible, archive it instead_ »), `deletion flag` chez SAP — qui
n'est pas une suppression mais un marquage pour archivage.

**Corollaire contre-intuitif.** Microsoft recommande explicitement de **ne pas** journaliser les
écritures et documents comptabilisés : journaliser une donnée immuable est un coût pur. Si l'on
ressent le besoin d'un journal de modifications sur du transactionnel, c'est qu'on ne l'a pas
rendu immuable.

### 1.2 Le flux de documents

La relation entre documents est **n↔n**, jamais une clé étrangère simple : une facture peut
regrouper plusieurs livraisons, une livraison alimenter plusieurs factures. D'où une table de
liaison dédiée.

Business Central offre `Find Entries` (`Ctrl+Alt+Q`) : retrouver toutes les écritures liées à un
document, y compris **par numéro de lot** — « _pour voir où un numéro de suivi a été utilisé, de
quel fournisseur il vient, à quel client il a été vendu_ ». C'est exactement la traçabilité
bidirectionnelle du Lot 8.

### 1.3 Le mécanisme le plus instructif : séparer la quantité de la valeur

Chaque transaction de stock produit **deux écritures de nature différente** :

| Écriture               | Contenu                                                         | Droits                            |
| ---------------------- | --------------------------------------------------------------- | --------------------------------- |
| Écriture de stock      | la **quantité**, le lot, la DLC, le reste                       | lecture/écriture                  |
| Écriture de valeur     | la **valeur**, le coût unitaire, la **date de valorisation**    | **lecture + insertion seulement** |
| Application d'écriture | relie entrée ↔ sortie — rend le FEFO valorisable _a posteriori_ | —                                 |

Le droit « insertion seulement » sur l'écriture de valeur est l'expression **technique** de
l'immuabilité : l'application elle-même n'a pas le droit de modifier une valeur passée.

**Pourquoi.** La quantité est certaine au moment du mouvement. Le coût ne l'est souvent qu'après
réception de la facture. Fusionner les deux oblige à _modifier_ une écriture quand la facture
arrive — exactement ce qu'on veut interdire. Avec deux écritures, on **ajoute** une ligne
d'ajustement datée de la facture.

Microsoft l'énonce sans détour : valoriser serait simple « _si les achats étaient toujours
facturés avant les ventes, si les écritures n'étaient jamais antidatées, et si vous ne faisiez
jamais d'erreur. Mais la réalité est différente._ »

### 1.4 Rien ne s'écrase — la règle exacte

- Une écriture ne peut être contrepassée **qu'une seule fois**, et la contrepassation porte le
  **même numéro de document et la même date** que l'original.
- Annuler une réception **ajoute une ligne corrective sous la ligne** du document ; le document
  n'est jamais supprimé.
- Un motif de contrepassation est **obligatoire**.
- Odoo va jusqu'au chaînage cryptographique : SHA-256 sur les champs concaténés, **chaîné à
  l'empreinte de l'écriture précédente**, non désactivable une fois activé.

### 1.5 La numérotation documentaire

> « Par défaut, **les trous ne sont pas autorisés** dans les séries de numéros, parce que
> l'historique exact des transactions financières doit être disponible pour l'audit, **par la
> loi**, et doit donc suivre une séquence ininterrompue. » — Microsoft

Côté belge ce n'est pas une convention : la tenue de comptabilité informatisée impose une
numérotation séquentielle contrôlée par le logiciel, une tenue « par ordre de dates, **sans
blancs ni lacunes** », et l'irréversibilité — l'écriture primitive doit rester lisible.

Segmentation assumée : trous tolérés sur les séries non financières (sessions planifiées
annulées), interdits sur réceptions, commandes et journal des recettes.

### 1.6 Le verrou de période : trois niveaux, pas un

| Niveau                  | Rôle                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| **Fenêtre souple**      | dates de comptabilisation autorisées, ajustables au quotidien                       |
| **Clôture**             | la période est close, mais on peut encore y écrire — l'écriture est **estampillée** |
| **Point de non-retour** | verrou définitif, irréversible même pour un administrateur                          |

**Le détail le plus important : la clôture marque plutôt qu'elle n'interdit.** Business Central
accepte une écriture dans un exercice clos et coche `Prior-Year Entry`. Le refus pur crée du
contournement ; le marquage crée de la traçabilité. Le blocage effectif est porté par la fenêtre
souple, pas par la clôture.

La clôture d'une période **d'inventaire** exige trois préconditions : aucun stock négatif, tous
les coûts ajustés, toutes les productions ajustées. La réouverture est possible **et tracée**.

### 1.7 Le costing

Microsoft recommande **FIFO** explicitement pour « _les articles à durée de vie limitée — les
plus anciens doivent être vendus avant leur date de péremption_ ». C'est notre cas.

Point critique : le **CUMP des ERP n'est pas un CUMP « au fil de l'eau »**, c'est une moyenne
pondérée **périodique**, avec une date de valorisation distincte de la date de comptabilisation
et un traitement par lot qui ajuste rétroactivement. SAP est plus tranchant encore : « _n'utilisez
le prix moyen mobile que pour les matières premières_ — il est très dépendant de l'ordre de
comptabilisation ; si les factures arrivent après les sorties, la valorisation est fausse. »

**Le coût standard est un outil de contrôle, pas de valorisation.** Il est gelé, et sert à faire
apparaître des écarts :

```
Écart prix d'achat      = (Prix réel − Prix standard) × Quantité réelle
Écart quantité matière  = (Qté réelle − Qté standard) × Prix standard
Écart de rendement      = Écart quantité − Écart de composition
```

### 1.8 Le rendement se modélise en deux termes, jamais un

```
Intrant = Sortie × (1 + perte_variable) + perte_fixe
```

C'est exactement la structure d'une pâte à crêpes : une perte **proportionnelle** (louche trop
généreuse, casse) **plus** une perte **fixe par fournée** (fond de bassine, première crêpe
sacrifiée). Notre modèle actuel (`perte_cuisson_bp`, `taux_casse_bp`) ne porte que le terme
variable.

### 1.9 Point de commande : deux rôles distincts

```
Point de commande = Consommation_moyenne × Délai + Stock_sécurité
Stock_sécurité    = Z × √( Délai·σ_demande² + Consommation² ·σ_délai² )
Z : 1,28 → 90 %   1,65 → 95 %   2,33 → 99 %
```

La formule naïve `conso × délai + sécurité` ignore **le niveau de service atteint** : deux
ingrédients de consommation moyenne identique reçoivent le même stock de sécurité, que leur
demande soit régulière ou erratique. Le point de commande couvre la demande **pendant le délai** ;
le stock de sécurité couvre les **fluctuations**. Deux rôles, pas un.

**L'ordre d'application des modificateurs est normatif :**
`1. réduire au maximum → 2. augmenter au minimum → 3. arrondir au conditionnement`.
Inverser donne des quantités fausses.

---

## 2. Comment un ERP vit au quotidien

### 2.1 Le cockpit — les seules limites chiffrées publiées par un éditeur

SAP, pour son launchpad :

| Niveau              | Recommandation                                            |
| ------------------- | --------------------------------------------------------- |
| Espace par rôle     | **1**                                                     |
| Sections par page   | 2 à 5                                                     |
| Tuiles par section  | 3 à 7                                                     |
| **Tuiles par page** | **25 maximum**                                            |
| Ordre des sections  | **de l'analyse (haut-gauche) vers l'action (bas-droite)** |
| Section vide        | **masquée**                                               |

Et la règle surplombante, dite **1-1-3** : un utilisateur, un cas d'usage, **trois écrans maximum**.

### 2.2 La brique fondamentale : la _cue_

C'est le mécanisme le plus directement copiable, et le plus important de tout le dossier :

> **Un nombre agrégé + une couleur seuillée + un clic qui ouvre exactement la liste filtrée
> qui a produit ce nombre.**

Trois précisions :

- Le nombre est un **agrégat calculé**, jamais une saisie.
- La couleur vient d'une **table de paramétrage** (deux seuils, trois styles), pas du code.
- **Jamais un nombre non cliquable.** Un nombre qu'on ne peut pas ouvrir est un nombre qu'on ne
  peut pas contester, donc qu'on finit par ignorer.

L'accroche en phrase (« _headline_ ») existe aussi, mais ce n'est **jamais une alerte** : pas
d'accusé de réception, masquable, en rotation.

### 2.3 Worklist contre liste — la distinction d'interface la plus utile

|                | Worklist                                        | Liste                          |
| -------------- | ----------------------------------------------- | ------------------------------ |
| Contenu        | des éléments que l'utilisateur doit **traiter** | un grand jeu de données        |
| Attente        | il les traite **tous**                          | il en filtre une petite partie |
| Implémentation | liste **sans barre de filtre**                  | avec barre de filtre           |

**L'absence de barre de filtre est un choix de conception, pas un manque.** Si l'écran est censé
se vider, on ne propose pas de filtre — on propose des actions.

Le tableau de bord du dimanche soir est une **worklist**. Le journal des mouvements est une
**liste**. Ce ne sont pas les mêmes écrans et ils n'ont pas les mêmes composants.

### 2.4 Divulgation progressive d'une alerte : quatre paliers

Pour une même situation, quatre niveaux de détail, avec un comportement d'interaction
**identique quel que soit l'endroit** où elle apparaît :

| Palier | Contenu                              |
| ------ | ------------------------------------ |
| S      | icône seule                          |
| M      | + titre et description               |
| L      | + statut et échéance                 |
| XL     | page complète avec actions proposées |

### 2.5 On retente avant de déranger

Règle explicite de Business Central : une tâche en échec est **relancée N fois avant** de
produire une notification. La tuile « tâches en échec » n'affiche que celles qui ont **épuisé**
leurs tentatives.

### 2.6 Ce qui remonte, ce qui reste silencieux

| Silencieux (consultable)              | Remonte                                   |
| ------------------------------------- | ----------------------------------------- |
| un compteur à zéro                    | un compteur qui **franchit** un seuil     |
| une tâche qui a encore des tentatives | une tâche qui a **épuisé** ses tentatives |
| l'historique, les registres, l'audit  | une échéance qui approche                 |
| une variation attendue et récurrente  | une variation **inattendue**              |

### 2.7 Le rythme doit être une donnée de l'application

Un ERP sérieux ne se contente pas de permettre la clôture : il la découpe en **tâches liées
chacune à l'écran où le travail se fait**, groupées (« Fin de mois »), et en compte les
restantes. Le rythme devient une donnée, pas un post-it.

**Contrepoint sectoriel décisif** : dans la restauration, la doctrine est le **coût matière
hebdomadaire, pas mensuel** — « _un coût matière calculé mensuellement est une autopsie_ ». Et
l'inventaire se compte **le dimanche soir, quand les étagères sont au plus bas.** C'est
exactement le cycle de `docs/01`.

### 2.8 Le tableau de bord

La première des treize erreurs classiques : **dépasser les limites d'un seul écran**. Puis :
contexte insuffisant, précision excessive, décoration inutile, abus de couleur.

Nombre de KPI : **8 à 12 maximum** pour un tableau opérationnel.

> « Tout indicateur opérationnel doit avoir un **seuil d'intervention** attaché. Sans seuil, les
> indicateurs deviennent des générateurs d'anxiété quotidienne sans déclencher d'action. »

N'ont pas leur place : ce qui oblige à défiler, un chiffre sans point de comparaison, une
décimale inutile, un KPI sans seuil, une carte vide sans état vide explicite.

---

## 3. Ce qui rend les ERP détestés — et qu'on n'imitera pas

### 3.1 Le signal le plus net de toute la recherche

Notes Capterra, juillet 2026 :

| Produit                       | Note globale | **Facilité d'utilisation** |
| ----------------------------- | ------------ | -------------------------- |
| SAP Business One              | 4,3          | **3,9**                    |
| SAP S/4HANA Cloud             | 4,3          | **3,8**                    |
| Dynamics 365 Business Central | 4,1          | **3,7**                    |
| Odoo                          | 4,2          | **4,0**                    |

**Dans les quatre cas, la facilité d'utilisation est la sous-note la plus basse.** Il n'existe
pas d'ERP réputé pour sa simplicité — il existe des ERP moins pénibles que SAP. Et SAP vend
un outil dont la fonction est de **cacher des champs de ses propres écrans** : c'est un aveu
produit.

### 3.2 Le débat qui contredit l'intuition

Les utilisateurs experts de SAP préfèrent souvent l'**ancien** GUI dense à Fiori épuré :
connaître les codes transaction permet d'atteindre une fonction en quelques frappes, là où Fiori
impose de naviguer dans des tuiles.

> **Un écran dense atteignable au clavier bat un écran épuré atteignable en cinq clics.**

L'épuré gagne pour l'utilisateur occasionnel, perd pour celui qui fait la même chose 200 fois.
Le dimanche soir, on est le second.

### 3.3 Le paramétrable qui n'a jamais été paramétré

- **Plus de 60 %** du code spécifique écrit dans les ERP SAP du monde n'est **jamais exécuté**.
- **45 %** des fonctionnalités d'une application interne ne sont jamais utilisées.
- SAP demande formellement à ses clients de **ne pas modifier son produit** (doctrine _clean core_).

**Règle opérationnelle retenue :** toute clé de `parametre` non modifiée en trois mois est
supprimée et figée en constante testée — **à l'exception explicite des valeurs réglementaires
datées**, qui sont paramétrables parce que le législateur les fait varier.

### 3.4 Le concurrent réel est un tableur

| Constat                                                                | Chiffre  |
| ---------------------------------------------------------------------- | -------- |
| Dirigeants finance utilisant encore Excel malgré un outil en place     | **89 %** |
| Dont le tableur est le système **principal**                           | **61 %** |
| Professionnels < 35 ans repassant au tableur quand l'ERP devient lourd | **75 %** |

Le mécanisme n'est pas la paresse. Le tableur offre trois choses que l'ERP refuse par
construction : **on peut y écrire n'importe quoi**, **on peut le restructurer sans permission**,
**on voit tout d'un coup**.

**Conséquence :** prévoir une **soupape officielle** — un ajustement motivé, codé et visible dans
les écarts. Un ERP sans soupape officielle en fabrique une officieuse, et celle-là n'est pas
auditable.

### 3.5 L'alerte n'a qu'une seule chance

Étude sur 112 praticiens et **1,6 million d'alertes**, 3,5 ans :

| Résultat                              | Valeur                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Acceptation médiane des rappels       | **19,4 %**                                                              |
| Effet de charge                       | **−30 % d'acceptation par alerte supplémentaire dans le même contexte** |
| **Après une première alerte ignorée** | **ignorées ensuite à 87,9 % puis 99,9 %**                               |

**La désensibilisation n'est pas graduelle : elle est quasi immédiate et irréversible.**

Règles qui en découlent, non négociables :

- **Trois alertes actives maximum** à l'écran, le reste replié derrière un compteur.
- **Aucune alerte non actionnable.** Une jauge n'est pas une alerte.
- **Aucune répétition à l'identique.** Une alerte déjà vue et non traitée change de forme,
  s'escalade, ou se tait.
- Le **taux de fausses alertes** est suivi comme un défaut de conception.

### 3.6 Les échecs coûteux, et leur point commun

Birmingham/Oracle : 19 M£ estimés → **216,5 M£**, avec **18 mois sans aucune piste d'audit**.
Lidl/SAP : ~500 M€, abandonné. Hershey : ~100 M$ de commandes non honorées, mise en service
**juste avant Halloween**.

Aucun de ces échecs n'est technique. Ce sont : un calendrier imposé de l'extérieur, une
customisation qui s'écarte du standard, une maîtrise d'ouvrage qui ne comprend plus son système.

**Leçons directes :** aucune mise en service la veille d'un marché. Et la relecture ligne à ligne
par le porteur est une **exigence de sécurité**, pas une préférence de style.

---

## 4. Doctrine d'interface

### 4.1 Diagnostic de l'existant

Douze défauts chiffrés relevés dans la version du Lot 0. Les cinq structurants :

| Constat                                                  | Effet                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Écart canvas/surface de **2 %** (`#fafafa` vs `#ffffff`) | l'échelle de surfaces — seul mécanisme de profondeur autorisé — est neutralisée           |
| Une seule graisse de bordure                             | aucune distinction entre séparateur interne et limite de panneau                          |
| `text-left` forcé sur toutes les cellules                | **les nombres s'alignent à gauche** : le signal d'amateurisme le plus visible dans un ERP |
| `border-collapse: collapse`                              | **casse les en-têtes collants** : la bordure basse disparaît au défilement                |
| Navigation active en aplat d'accent                      | l'élément le plus saturé de l'écran est du chrome, en concurrence avec les statuts        |

### 4.2 Les neuf valeurs qui font le « haut de gamme »

| Mécanisme               | Valeur retenue                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Écart canvas ↔ surface  | **≥ 4 %** de luminance (`#f4f4f5` ↔ `#ffffff`)                                               |
| Graisses de filet       | **2** — interne `#e4e4e7`, structurel `#c9c9ce`                                              |
| Niveaux d'encre         | **4** — `#18181b` / `#3f3f46` / `#71717a` / `#a1a1aa`                                        |
| Graisses typographiques | **3** — 400, 500, 600. Jamais 300 ni 700                                                     |
| Interlettrage           | **+0,3 px** @11 px · **+0,15** @12 px · **0** @13–16 px · **−0,2** @20 px · **−0,35** @24 px |
| Rayon                   | 4 px contrôles, 6 px panneaux, **plafond 8 px**, plancher 3 px                               |
| Survol                  | **70 ms**, `cubic-bezier(0.2, 0, 0.38, 0.9)`                                                 |
| Couche flottante        | entrée **150 ms**, sortie **110 ms**                                                         |
| Chiffres                | `tabular-nums slashed-zero` sur toute cellule numérique                                      |

**L'interlettrage positif sous 13 px est contre-intuitif et c'est le réglage le plus rentable.**
C'est l'inverse du tracking négatif des sites vitrines : sous 14 px les contreformes se referment
et le texte devient une bouillie grise, donc on **ouvre**. Le tracking est une **fonction de la
taille**, pas une signature de marque.

### 4.3 Densité

- **Une seule densité, fixée globalement.** Aucun sélecteur : à deux utilisateurs, un double mode
  double le coût de test pour zéro bénéfice.
- Hauteur de rangée : **32 px** par défaut, 28 px pour les journaux en lecture seule, **36 px**
  pour les rangées contenant des champs de saisie (un champ de 26 px + un anneau de focus de 2 px
  ne tient pas dans 32 px sans mordre la rangée voisine).
- Taille de texte de base : **13 px**.
- Rembourrage de cellule : 12 px horizontal, 16 px sur la première et la dernière colonne.

### 4.4 La contrainte oubliée : la mise à l'échelle Windows

Windows 11 tourne couramment à **125 ou 150 %**. Un écran 1920 × 1080 à 150 % donne un viewport
CSS réel de **1280 × 720**.

> **CORRIGÉ PAR LE PORTEUR LE 01/08/2026.** La règle qui suivait — « concevoir pour 1280 × 720,
> jamais pour 1920 × 1080 » — **est fausse**, et elle a été appliquée toute la journée du 01/08 à
> tort. Ses mots : « la cible de visibilité est **1080p** mais **responsive pour 100 % de l'app** —
> l'app doit s'adapter à mes écrans : **1280, 1080 et 1440** ».
>
> **La cible de conception est donc 1920 × 1080**, et l'application doit rester **pleinement
> utilisable** sur les trois résolutions qu'il utilise réellement : **1280 de large**, **1920 × 1080**
> et **2560 × 1440**. Ce n'est plus un point fixe à respecter, c'est un **intervalle à couvrir**.
>
> **Ce qui reste vrai malgré la correction, et qu'il ne faut pas jeter** : la mise à l'échelle
> Windows existe, un `devicePixelRatio` de 1,25 transforme bien un « 1280 × 720 demandé » en
> 1024 × 576 réel, et toute vérification visuelle doit donc mesurer
> `document.documentElement.clientWidth` plutôt que croire la taille demandée. C'est un piège de
> **mesure**, pas une règle de **conception** — les deux avaient été confondus.
>
> **Ce qui devient faux** : « la hauteur est la ressource rare » comme principe général. À 1080 et à
> 1440, la hauteur est confortable ; c'est à 1280 × 720 qu'elle est contrainte. La densité reste une
> qualité pour un écran de saisie, mais elle ne peut plus servir d'argument pour **refuser** du
> contenu — voir la règle du **cockpit** pour le tableau de bord.
>
> **Conséquence pratique** : la fiche `docs/demandes/02-RESPONSIVE-1080P-1440P.md` cesse d'être un
> confort. Son critère de fin — des captures automatisées aux trois résolutions — devient la seule
> preuve possible qu'une mise en page tient. Aujourd'hui, ce critère **n'existe pas** : aucun test
> de rendu multi-résolution dans le dépôt.

Conséquence de la contrainte de hauteur **à 1280 × 720 seulement** : à 720 px de haut, moins le
chrome du navigateur, il reste ~640 px. Avec un titre, une barre d'outils et un en-tête de tableau,
il ne reste que **16 rangées visibles**. C'est ce cas-là qui justifie la densité et qui condamne les
grands titres de page et les fils d'Ariane décoratifs — **pas les deux autres résolutions**.

### 4.5 Tableaux — le cœur de l'ERP

**Alignement**

- Texte : à gauche, toujours.
- **Nombres quantitatifs** (montants, quantités, pourcentages) : **à droite**, sans exception.
- **Nombres qualitatifs** (dates, numéros de lot) : **à gauche** — ce sont des identifiants, pas
  des grandeurs.
- L'en-tête suit l'alignement de sa colonne. **Jamais de centrage.**

**Alignement décimal.** `text-align: decimal` n'existe pas. La combinaison qui fonctionne :
`text-align: right` + `tabular-nums slashed-zero` + **nombre fixe de décimales par colonne**. Si
le nombre de décimales varie d'une ligne à l'autre, rien ne s'aligne, quelle que soit la police.

**Trois règles de présentation**

1. **L'unité va dans l'en-tête, pas dans la cellule.** `Valeur (€)` en en-tête, `3,15` en cellule.
   Répéter « € » quarante fois est du bruit.
2. **Zéro et inconnu ne s'écrivent pas pareil.** `0,00` est une valeur ; une valeur absente
   s'écrit `—`. Un stock à zéro et un stock non inventorié ne sont pas la même information — pour
   l'AFSCA, c'est une distinction qui compte.
3. **Signe moins typographique U+2212**, et signe systématique sur les écarts (`+3,2 %` / `−1,4 %`).

**Une colonne, une unité.** Si une ligne affiche `4,2 kg` et la suivante `850 g`, la colonne est
illisible. Le seuil de bascule est constant par colonne et annoncé dans l'en-tête.

**Pas de zébrures.** Dans un tableau interactif, la zébrure crée trois nuances de gris qui entrent
en collision avec le survol, la sélection et les états d'alerte.

**Pas de fond de rangée coloré pour les alertes** — et la raison est métier :

> Ces tableaux partent en **PDF chez le comptable et à l'AFSCA**. Un aplat rouge devient un gris
> sale en noir et blanc ; un glyphe `▲` reste un glyphe. C'est aussi la seule solution correcte
> pour un utilisateur daltonien.

L'alerte se porte par une **colonne de glyphe** et un libellé de statut coloré.

**Pièges techniques**

- `border-collapse: separate` est **obligatoire** pour un en-tête collant, avec un fond opaque et
  `box-shadow: inset 0 -1px 0` en guise de bordure basse.
- `table-layout: fixed` + `<colgroup>` : en `auto`, un tri déplace toutes les colonnes. Ce saut
  est fatal pour une saisie au clavier — la cible bouge sous les doigts.

**Pas de pagination.** Elle existe pour protéger un serveur ; SQLite est local. Paginer trente
ingrédients ajoute un contrôle, un état et un clic pour rien. Filtrer et trier la remplacent.
Seul le journal des mouvements justifiera un jour la virtualisation.

**Le tri par défaut n'est jamais alphabétique** : il reflète l'action. Stock trié par urgence,
sessions par date décroissante.

**Toujours afficher le compte** : « 12 sur 34 ingrédients ». Un tableau filtré sans compte est un
tableau dans lequel on croit tout voir.

### 4.6 Clavier

**La palette de commandes est justifiée**, mais recadrée : ce n'est pas une palette de navigation
(14 routes apprises en trois semaines), c'est une **recherche d'entités nommées** — « Farine T55 »,
« lot beurre #241 », « session du 26/07 » — augmentée de six à huit actions globales.

Son second rôle est le plus important : **enseigner les raccourcis**, en affichant le raccourci de
chaque ligne en pavé de touche. Elle ne doit jamais être le seul chemin vers une fonction.

**Deux modes clavier, deux contextes** — décision à consigner :

| Écran                                   | Mode            | Comportement                                               |
| --------------------------------------- | --------------- | ---------------------------------------------------------- |
| Clôture de session, saisies répétitives | **tableur**     | `Tab` = champ suivant, `Entrée` = ligne suivante           |
| Stock, mouvements, consultation         | **grille ARIA** | flèches naviguent, `Tab` **sort** de la grille, `F2` édite |

L'utilisateur cible connaît Excel, pas ARIA. Sur l'écran le plus utilisé, c'est Excel qui gagne.

**Raccourcis à ne pas réinventer :** `Ctrl+K` palette · `Ctrl+S` enregistrer · `Ctrl+Z` annuler ·
`Ctrl+Entrée` valider · `Échap` fermer · `/` recherche · `?` aide.

**Pièges AZERTY belge :** jamais de raccourci à lettre seule sans mode (touches mortes `^` et `¨`,
`AltGr`). Les chiffres exigent `Maj` : un raccourci `1`…`9` est hostile. Et `Ctrl+N`, `Ctrl+T`,
`Ctrl+W` sont **réservés au navigateur, non interceptables** — l'application tourne dans Chrome,
pas dans Electron.

### 4.7 États et retours

**Pas de squelettes de chargement pour les lectures locales.** SQLite répond en moins de 20 ms ;
un squelette produirait un scintillement, soit l'inverse de l'effet recherché.

| Opération                       | Traitement                                        |
| ------------------------------- | ------------------------------------------------- |
| Lecture SQLite locale (< 20 ms) | **rien**                                          |
| Écriture, production, clôture   | bouton occupé, largeur figée                      |
| Météo (200–2000 ms)             | squelette sur la seule carte météo                |
| Appel Claude (1–10 s)           | progression **textuelle et explicite**, annulable |
| PDF, mail                       | bouton occupé + confirmation                      |

Seuil général : **aucun indicateur avant 150 ms**.

**Indicateur de sauvegarde plutôt que notification.** Sur un écran sauvegardé vingt fois, une
notification à chaque fois est une nuisance. Une ligne persistante à trois états :
`Modifications non enregistrées` → `Enregistrement…` → `Enregistré 21:04`.

**Une notification d'erreur qui disparaît toute seule est un bug.** Succès : 5 s. Erreur :
persistante.

**Erreurs de formulaire** : message **en ligne sous le champ**, focus sur le premier champ fautif,
**jamais vider la saisie**, et **pas de notification en plus** — double signalement fait chercher
deux fois. Le message dit ce qui s'est passé **et** quoi faire : pas « Quantité invalide » mais
« La quantité doit être un nombre entier de crêpes ».

**Trois états vides distincts**, et non un seul : premier lancement (titre + une phrase + **une**
action), vide après filtrage (dire **quel** filtre exclut + réinitialiser), vide normal (une ligne
discrète, pas une carte).

### 4.8 Ce qui est interdit

Reprend et étend `docs/06` :

- Dégradés, halos, texte en dégradé, ombres colorées.
- **Une seule ombre dans tout le produit**, teintée d'encre et non de noir, réservée aux **couches
  flottantes** (menu, palette, infobulle) — c'est le seul cas où l'ombre est fonctionnelle, parce
  qu'une couche flottante recouvre un contenu inconnu que l'échelle de surfaces ne peut pas
  distinguer.
- **Cartes imbriquées : profondeur maximale 1.** À l'intérieur d'un panneau, on sépare par un
  filet pleine largeur, jamais par un second panneau.
- Filet fin **et** ombre sur le même élément : il faut choisir.
- Bordure colorée épaisse sur un côté d'une carte.
- Espacement uniforme partout : 4–8 px dans un groupe, 16–24 px entre groupes.
- Plus d'espace **au-dessus** d'un titre qu'en dessous (rapport 2:1).
- Miroitement de squelette, rebond élastique, point de statut qui pulse en permanence.
- Émoji, y compris dans les états vides.
- Icône décorative : une icône ne se justifie que si elle porte une information.
- « Attention ! », « Oups ! » : ton neutre et factuel.

**Mécanisme d'application :** les jetons de design réinitialisent les espaces de noms inutiles, si
bien que `shadow-lg`, `text-6xl`, `font-bold` et `rounded-3xl` **ne compilent plus**. La discipline
n'est plus affaire de vigilance — elle est appliquée par le compilateur, et elle survit au code
généré par un agent. Seuls les dégradés restent à surveiller en revue.

### 4.9 Mode sombre

**Ne pas le construire en V1, mais rendre son coût futur nul.** Discipline immédiate :

- **Aucun composant ne référence jamais `zinc-*`, `white` ou `black`.** Uniquement des jetons
  sémantiques : `bg-surface`, `text-ink-3`, `border-line`.
- Valeurs dans `:root`, exposées par `@theme inline` : un thème sombre devient alors un **unique
  bloc de redéfinition de variables**, sans toucher un composant.
- Sélecteur et non `prefers-color-scheme`, pour pouvoir **forcer le clair au rendu PDF**.

---

## 5. Ce qui est retenu, adapté, écarté

### 5.1 Retenu sans discussion

Immuabilité du transactionnel · séparation quantité/valeur · codes motifs sur chaque mouvement ·
registre de comptabilisation · numérotation séquentielle sans trou · verrou de période à deux
niveaux avec marquage · bloquer plutôt que supprimer · FEFO comme valorisation et non seulement
comme prélèvement · job d'ajustement de coût rétroactif · rendement en deux termes · point de
commande statistique · ordre normatif des modificateurs · la _cue_ comme brique d'interface ·
worklist sans filtre · tâches liées à un écran · assistant sur table temporaire · retenter avant
d'alerter.

### 5.2 Adapté — le concept est bon, l'implémentation tier-1 est disproportionnée

| Concept                                             | Version Batte                                                                                                                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grand livre en partie double                        | **Pas de grand livre.** Sous franchise TVA, l'obligation est un journal des recettes + un tableau des investissements. On garde la _discipline_ (immuabilité, numérotation, verrou, écriture inverse), pas le moteur d'écritures          |
| Dimensions analytiques génériques                   | Les axes sont **connus et fixes** (recette, produit, session, créneau, canal, transformé/revendu) : les coder. Un framework pour six axes stables est du folklore                                                                         |
| MRP multi-niveaux                                   | La nomenclature a **un seul niveau**. Une boucle suffit                                                                                                                                                                                   |
| Coût standard comme valorisation                    | Valorisation en CUMP/FIFO. Le coût standard sert de **repère figé** pour les écarts                                                                                                                                                       |
| Framework de gestion de situations                  | Un objet `alerte` avec cycle de vie et mesure du taux de traitement. Le ciblage par responsabilité est sans objet à deux personnes ; **la mesure ne l'est pas**                                                                           |
| Capacité finie, ordonnancement                      | L'écrêtage par contraintes de `docs/03` **est** le bon niveau                                                                                                                                                                             |
| Inventaire tournant ABC                             | Avec ~20 ingrédients, le comptage complet est plus rapide à faire qu'un programme ABC à concevoir. Garder la **cadence** (dimanche soir), pas la classification                                                                           |
| Journal d'audit « sur toutes les tables sensibles » | **À restreindre** aux données de référence : `recette`, `parametre`, `ingredient`, `produit_vente`, `conditionnement`, `lieu_marche`. Les mouvements et lignes de vente sont immuables par construction — les journaliser est un coût pur |

### 5.3 Écarté — folklore d'entreprise

Workflows d'approbation, gestion de droits, séparation des tâches · multi-société, multi-devise,
multi-entrepôt · promesse de date client · budget contre réel au sens comptable (remplacé par la
trajectoire vers les seuils) · co-produits avec répartition de coût · archivage de performance ·
réservations et allocations · prévisualisation de comptabilisation généralisée · tableau de bord
« stratégique ».

---

## 6. Défauts découverts dans les spécifications existantes

La recherche a mis au jour des problèmes dans nos propres documents. Classés par gravité.

### 6.1 L'invariant n° 4 est faux tel qu'écrit

`docs/02` affirme : `ca_especes + ca_carte − ca_total == ecart_caisse`, « toujours vrai par
construction ».

**C'est faux dès qu'il y a un fonds de caisse.** Si on part avec 60 € de monnaie, le comptage de
fin de journée donne `CA espèces + 60`. L'égalité ne tient que si l'utilisateur soustrait le fonds
de tête — c'est-à-dire fait le calcul que l'application devrait faire.

**Correction :** deux champs sur `session_marche` — `fonds_caisse_initial_cents` et
`especes_comptees_cents` — puis `ca_especes = especes_comptees − fonds_initial`.

### 6.2 `ingredient.cump_cents_par_unite` contredit la règle n° 5

`docs/02` le décrit comme « recalculé à chaque entrée ». C'est une **valeur dérivée stockée** —
exactement le défaut que la règle 5 interdit pour les quantités (« le stock ne se modifie que par
un mouvement ») et que l'invariant du lot interdit pour le restant.

**Le même défaut de conception, appliqué à la valeur au lieu de la quantité.** Soit le CUMP est
une vue calculée, soit c'est un cache explicitement nommé comme tel, avec un job de recalcul et
un test d'invariant. Le mélange des deux rend les valorisations irréconciliables.

### 6.3 Aucun ordonnanceur n'existe

`docs/01` prévoit un « calcul quotidien du point de commande » ; `docs/03` prévoit une
récupération météo à J-7, J-3, J-1 et le matin même. **La stack ne contient aucun ordonnanceur.**
Ces tâches ne se déclencheront que si l'utilisateur ouvre l'application au bon moment — ce qui
n'arrivera pas.

### 6.4 La rétention de sauvegarde est illégale

`docs/01` prévoit **30 jours**. Le droit belge impose **10 ans** pour les documents comptables et
TVA ; l'AFSCA impose **2 ans après la DLC** pour les registres d'autocontrôle. Une sauvegarde
tournante sur 30 jours ne satisfait ni l'un ni l'autre. **L'archivage est un besoin distinct de la
sauvegarde.**

### 6.5 Les documents sont régénérés, pas archivés

`docs/06` prévoit `GET /api/documents/:type/:id` qui **génère** un PDF à la demande.

Si un prix, un seuil ou une recette change entre-temps, le registre AFSCA régénéré en septembre
**diffère de celui présenté au contrôle en mars** — et le contrôleur, lui, en a une copie. Un ERP
archive le document _émis_, il ne le recalcule pas.

**Correction :** table `document_genere` (type, objet, numéro, date, chemin, empreinte SHA-256).
Régénérer crée **une nouvelle version numérotée**, jamais un écrasement.

### 6.6 Trois paramètres réglementaires sont douteux

| Paramètre actuel                               | Problème                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Franchise TVA, tolérance de 10 %               | **La tolérance a disparu au 1ᵉʳ janvier 2025.** Régime actuel à deux étages : dépassement ≤ **27 500 €** → franchise maintenue jusqu'au 31/12 avec **déclaration e604B avant le 15 décembre** ; > 27 500 € → **passage immédiat** au régime normal. Et depuis 2026 le seuil est **proratisé** si l'activité démarre en cours d'année |
| `seuil_cotisation_reduite_cents` = 17 374,08 € | **Probablement mal étiqueté.** C'est le revenu de référence servant au calcul des cotisations minimales d'un indépendant **à titre principal**. Une source professionnelle indique qu'il n'existe **pas** de seuil de revenu faisant perdre le régime complémentaire — celui-ci dépend du statut principal                           |
| `seuil_airbag_cents` = 23 000 €                | **Mal orienté.** Ce n'est pas un plafond à ne pas dépasser, c'est un **critère d'éligibilité**, assorti d'une condition d'**ancienneté de 3 ans** en complémentaire. Le tableau de bord devrait afficher un compte à rebours d'ancienneté à côté du compteur d'euros                                                                 |

**À faire confirmer** auprès du guichet d'entreprises et de la caisse d'assurances sociales avant
d'être codés. C'est exactement l'usage de `parametre.source`.

> **Mise à jour du 30/07/2026 — partiellement corrigé.** Les VALEURS restent inchangées (17 374,08 €,
> 23 000 €, toujours « à reconfirmer », `packages/core/src/parametres.ts:46-61`) — la tolérance de
> 10 % sur la franchise TVA et le régime à deux étages (27 500 €, e604B, proratisation 2026) ne sont
> toujours codés nulle part. Mais les DEUX étiquetages douteux ont un correctif de fond dans
> `packages/db/src/depots/sessions.ts:300-358` (`SEUILS`), affiché à l'écran (`Sessions.tsx:1889`
> via `GET /api/seuils`) :
>
> - le seuil « cotisation réduite » compare désormais le REVENU NET et non plus le CA
>   (`assiette: 'revenu_net'`, `sessions.ts:334` — c'était l'erreur décrite ici, avec un écart
>   chiffré au 30/07 : facteur 2,31 entre les deux assiettes, commentaire `sessions.ts:318-332`) ;
> - le libellé du seuil Airbag précise désormais « critère d'ÉLIGIBILITÉ... et il suppose 3 ans
>   d'ancienneté en complémentaire » (`sessions.ts:311-313`), visible dans la colonne `source` du
>   même panneau. Aucun compte à rebours d'ancienneté séparé n'a en revanche été trouvé.

### 6.7 Un seuil légal manque

Il existe en Belgique **deux seuils de 25 000 € qui ne mesurent pas la même chose** :

| Seuil                    | Assiette                                           | Conséquence                                |
| ------------------------ | -------------------------------------------------- | ------------------------------------------ |
| Franchise TVA            | CA **total**                                       | sortie du régime de franchise              |
| **SCE / caisse blanche** | CA des **services de restauration**, hors boissons | caisse enregistreuse certifiée obligatoire |

Bonne nouvelle vérifiée : **la vente à emporter n'est pas un service de restauration.** Un stand
sans table ni chaise n'est pas concerné. **Mais le jour où une table apparaît**, l'assiette devient
non nulle — et une fois la caisse certifiée obligatoire, _toutes_ les activités y passent, y
compris l'emporté. L'application doit donc porter ce compteur **à zéro, visiblement**, plutôt que
de ne pas le porter du tout.

> **Mise à jour du 30/07/2026 — corrigé.** Le paramètre existe (`seuil_sce_cents`,
> `packages/core/src/parametres.ts:63-84`, description citant explicitement « la vente à emporter
> n'est pas un service de restauration ») et le compteur est calculé et affiché : quatrième entrée
> de `SEUILS` (`packages/db/src/depots/sessions.ts:339-357`, `assiette: 'ca_sur_place'`, alimentée
> par la nouvelle colonne `session_marche.ca_sur_place_cents`), rendue par le panneau « Seuils
> légaux » de `apps/web/src/pages/Sessions.tsx:1889` via `GET /api/seuils`.

### 6.8 Autres manques classés

| Rang | Manque                                                      | Coût estimé |
| ---- | ----------------------------------------------------------- | ----------- |
| 1    | Verrou de période et marquage des écritures tardives        | 0,5 j       |
| 2    | Numérotation documentaire lisible (`RC-2026-0001`)          | 0,5 j       |
| 3    | Archivage des documents émis                                | 1 j         |
| 4    | Ordonnanceur et journal d'exécution                         | 1 j         |
| 5    | Objet `alerte` avec cycle de vie et mesure                  | 1 j         |
| 6    | Facture fournisseur et rapprochement à trois                | 1,5 j       |
| 7    | Frais accessoires ventilés sur les lots                     | 0,5 j       |
| 8    | Ajustement de coût rétroactif, `valuation_date`             | 1 j         |
| 9    | **Codes motifs structurés** — meilleur rapport valeur/coût  | 0,25 j      |
| 10   | Statut de lot (disponible / quarantaine / bloqué / détruit) | 0,25 j      |
| 11   | Exercice de traçabilité et procédure de retrait/rappel      | 0,75 j      |
| 12   | Fonds de caisse                                             | 0,1 j       |
| 13   | Import du relevé SumUp                                      | 0,5 j       |
| 14   | Échéancier réglementaire                                    | 0,5 j       |
| 15   | Compteur « services de restauration »                       | 0,25 j      |
| 16   | Trajectoire vers les seuils, correction des paramètres      | 0,5 j       |
| 17   | Historique des prix d'achat                                 | 0,25 j      |
| 20   | Temps de travail total et coût horaire réel                 | 0,75 j      |
| 21   | Contrepassation d'une session clôturée                      | 0,5 j       |
| 22   | Archivage 10 ans, distinct de la sauvegarde                 | 0,5 j       |

> **Mise à jour du 30/07/2026 sur le rang 1 — partiellement corrigé.** Le contrôle est écrit et
> câblé : `verifierPeriodeNonVerrouillee` (`packages/db/src/depots/comptabilite.ts:765`) est appelée
> avant 8 écritures datées (dépense `:192`, contre-écriture `:303`, immobilisation `:470`, et
> d'autres sites dans `services/mouvements.ts`, `services/reception.ts`, `services/production.ts`,
> `services/sessions.ts` — vérifiés par grep sur tout le dépôt). `cloturerPeriode` pose bien le
> statut `'cloturee'` (marquage, pas blocage — conforme à la doctrine ci-dessus) et `rouvrirPeriode`
> refuse déjà un statut `'verrouillee'`. **Mais aucun code de production ne pose jamais ce statut
> `'verrouillee'`** : recherche exhaustive de la chaîne `'verrouillee'` sur tout le dépôt — les
> seules occurrences d'ÉCRITURE de cette valeur sont dans des fichiers `*.test.ts` (construction de
> fixtures), jamais dans un service ou une route. Il n'existe pas non plus de route
> `/periodes/:id/verrouiller` dans `apps/api/src/routes/comptabilite.ts` (seules `/periodes/cloturer`
> et `/periodes/:id/rouvrir` existent). Le troisième niveau (« point de non-retour, irréversible même
> pour un administrateur », §1.6 ci-dessus) est donc déclaré dans le type
> (`packages/db/src/depots/comptabilite.ts:691`) et déjà contrôlé en lecture, mais **inatteignable
> depuis l'application** : personne ne peut aujourd'hui verrouiller définitivement un exercice.

Sur le **rang 9**, la formulation de la littérature est parfaite :

> « Si "inconnu" est le plus gros poste au bout de six mois, votre processus est cassé. Un écart
> qu'on ne peut pas attribuer est un écart qu'on ne peut pas corriger. »

Sans codes motifs, on ne peut pas répondre à « où fuit la matière ? », pourtant listée comme axe
analytique dans `docs/01` §7. Codes de départ : `CASSE_CUISSON`, `CASSE_TRANSPORT`, `DLC_DEPASSEE`,
`SURDOSAGE`, `FOND_BASSINE`, `PERSO`, `DON`, `ERREUR_SAISIE`, `INVENTAIRE_ECART`.

---

## 7. Les dix principes

1. **Un ERP se juge à l'usage, pas à la livraison.** Critère : quatre sessions consécutives
   saisies intégralement, sans carnet ni tableur parallèle.
2. **Rien ne s'écrase, et c'est le socle de tout le reste.** La règle doit être _techniquement
   impossible à contourner_, pas seulement écrite.
3. **Une alerte n'a qu'une seule chance.** Trois maximum, toutes actionnables, jamais répétées à
   l'identique, taux de fausses alertes suivi comme un défaut.
4. **Chaque nombre affiché est un clic vers la liste qui l'a produit.**
5. **Si l'écran est censé se vider, pas de filtre — des actions.**
6. **La densité n'est pas l'ennemi ; les clics le sont.** Douze champs visibles maximum par écran
   de saisie, un clic de navigation depuis le tableau de bord, zéro souris à la clôture.
7. **Le coût réel arrive après le mouvement — il faut l'avoir prévu.**
8. **Le paramétrable jamais paramétré est une dette pure.**
9. **Le rythme doit être une donnée de l'application.** Et il est **hebdomadaire**, pas mensuel.
10. **Le concurrent réel n'est pas un logiciel, c'est un tableur.** Prévoir une soupape officielle,
    sinon il s'en fabrique une officieuse — et celle-là n'est pas auditable.

---

## 8. Réserves de méthode

- Les guides SAP Fiori renvoient HTTP 403 : citations issues d'extraits indexés, non d'un accès
  direct.
- Les chiffres d'échec d'ERP proviennent de cabinets qui vendent de l'assistance à la sélection,
  sur échantillons auto-sélectionnés : ordres de grandeur, jamais des séries en tendance.
- **Les trois points réglementaires du §6.6 reposent sur des sources professionnelles belges
  concordantes mais non officielles.** Ils doivent être confirmés avant d'être codés.
