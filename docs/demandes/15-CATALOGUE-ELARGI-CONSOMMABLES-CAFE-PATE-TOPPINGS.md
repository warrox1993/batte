# Fiche 15 — Catalogue élargi : consommables, café, pâte vendue, toppings

> **Origine** : idées dictées par le porteur le 29/07/2026, mises en forme par Claude Code.
> **Statut** : brouillon à relire et amender. Rien n'est codé.
> **[À TRANCHER]** = décision attendue du porteur. **[HYPOTHÈSE]** = supposition de rédaction.
> **[VÉRIFIÉ]** = constat lu dans le code, pas une supposition.
>
> **Note de statut — 29/07/2026, vérifiée contre le code.** Le mécanisme central de cette fiche est
> implémenté : la **nomenclature de vente** (table `produit_vente_composant`,
> `packages/core/src/nomenclature-vente.ts`) fait sortir du stock, à la vente, ce qu'un produit
> `transforme_a_la_demande` ou `consommable` consomme — café à la tasse, serviettes, gobelets,
> toppings à la pièce, avec le garde-fou « lot de référence » contre l'arrondi à zéro d'une petite
> quantité. **Les `[À TRANCHER]` ponctuels de cette fiche (catégorie du café moulu, garde-fou de
> saisie, format de contenant pour la pâte à tartiner, etc.) n'ont pas été revérifiés un par un
> dans cette passe** : l'existence du mécanisme ne présume pas que chaque question de classement ou
> d'ergonomie ait été tranchée à la place du porteur.
>
> **Mise à jour du 01/08/2026 — voir la « Note de statut » en fin de fiche.** Plusieurs des points
> non revérifiés le 29/07 le sont désormais : la catégorie du café moulu est tranchée (`'boisson'`
> et `'aromate'` existent), l'alerte allergène des options est implémentée, et — nouveau depuis le
> 29/07 — le **coût de revient d'un produit à nomenclature est calculé pour la première fois**.

---

## 1. La demande, dans ses mots

> « Dans cette application on doit lui rajouter les **serviettes, assiettes, gobelets** avec les
> différents fournisseurs. Et oui les gobelets car ma femme et moi allons aussi vendre du **café**,
> et nous allons aussi vendre **la pâte en elle-même** et le **mélange de café tout fait en
> poudre**. Donc il y a beaucoup d'éléments à prendre en compte pour tout cela. »
>
> « Ensuite nous allons aussi vendre le **topping directement** si le client veut, et puis ça
> **embellit le stand**. »

---

## 2. Ce que le modèle sait déjà faire — et ce qu'il ne fait pas

### 2.1 Bonne nouvelle : les consommables ont déjà leur place

**[VÉRIFIÉ]** La table `ingredient` a une catégorie `'consommable'`, à côté de `farine`, `laitier`,
`oeuf`, `sucre`, `garniture` et `gaz`. L'unité de référence accepte déjà `'piece'`.

Donc : serviettes, assiettes et gobelets peuvent **entrer en stock dès aujourd'hui**, avec leur
fournisseur, leur lot, leur prix payé, leur point de commande. Toute la chaîne d'achat fonctionne
sans une ligne de code.

### 2.2 Premier problème : rien ne les fait SORTIR

**[VÉRIFIÉ]** La chaîne `'consommable'` n'apparaît nulle part dans la logique de consommation.
Elle n'existe que dans la déclaration du schéma, dans le contrat HTTP et dans le jeu de
démonstration.

Conséquence concrète : **on achèterait des serviettes qui ne quitteraient jamais le stock.** Le
stock gonflerait indéfiniment, le point de commande ne se déclencherait jamais, et le coût par
crêpe les ignorerait complètement.

> C'est **exactement la même classe de défaut que les garnitures** (décision D-053, corrigée le
> 28/07) : le Nutella entrait en stock, était servi sur les crêpes, et n'en sortait jamais. La
> correction avait révélé un coût matière sous-estimé de **0,073 € par crêpe**.
>
> Une serviette + une assiette, c'est du même ordre de grandeur. Sur une session à 134 crêpes,
> c'est une dizaine d'euros qui n'apparaissent nulle part.

### 2.3 Second problème : la catégorie sert aujourd'hui de fourre-tout

**[VÉRIFIÉ]** Dans le jeu de démonstration, `'consommable'` est utilisée pour le **sel fin** et
l'**eau de fleur d'oranger** — parce qu'aucune autre catégorie ne leur allait.

Or ce sont de **vrais ingrédients**, consommés par la recette, au moment de la production. Une
serviette est consommée **au moment de la vente**. Les mélanger dans une même catégorie brouillerait
la seule chose qui compte ici : **quand la sortie de stock a lieu**.

**[À TRANCHER]** Deux options :

- ajouter une catégorie `'aromate'` (ou `'autre_ingredient'`) pour le sel et la fleur d'oranger,
  et réserver `'consommable'` au non-alimentaire ;
- garder une catégorie unique et distinguer par un autre champ.

**[HYPOTHÈSE de rédaction]** : la première. La catégorie sert déjà à piloter des comportements
(DLC, traçabilité AFSCA), et une serviette n'a ni DLC ni obligation de traçabilité alimentaire.

---

## 3. Le point structurant : QUAND le stock sort

C'est le fil conducteur de toute cette fiche. Les nouveaux produits ne se ressemblent pas par ce
qu'ils sont, mais par **le moment où ils consomment du stock**.

| Nature                      | Exemple                              | Ce qui sort du stock             | Quand                |
| --------------------------- | ------------------------------------ | -------------------------------- | -------------------- |
| Transformé **par lot**      | crêpe                                | farine, lait, œufs (via la pâte) | à la **production**  |
| Transformé **à la demande** | café à la tasse                      | café en poudre, sucre, gobelet   | à la **vente**       |
| **Conditionné**             | pot de pâte, sachet de mélange café  | le contenu **+ le contenant**    | à la **mise en pot** |
| **Revendu**                 | sirop, confiture achetés préemballés | l'article lui-même               | à la **vente**       |
| **Consommable**             | serviette, assiette, gobelet         | l'article, par vente servie      | à la **vente**       |

**[VÉRIFIÉ]** Le modèle actuel ne connaît que deux natures : `'transforme'` et `'revendu'`. Et il
suppose que « transformé » veut dire « issu d'un lot de production ».

**[VÉRIFIÉ]** Le mécanisme de sortie à la vente existe déjà (`sortie_vente`), il sert aux produits
revendus depuis la décision D-037. Ce n'est donc pas à inventer — c'est à **étendre**.

---

## 4. Le café : un transformé sans lot de production

Un café ne se produit pas par lot de 5 litres la veille. Il se fait **à la tasse, à la demande**.

Il a pourtant bien une nomenclature : dose de café, eau, sucre éventuel, **gobelet**, touillette.

**[VÉRIFIÉ]** Aujourd'hui, une nomenclature n'existe que sur `recette`, et une recette n'est
consommée qu'à travers une `production`. Il n'y a pas de chemin « nomenclature consommée à la
vente ».

**[À TRANCHER]** Trois voies :

- **A** — le café est une recette avec un rendement de 1, et on lance une « production » fictive à
  la clôture. _Simple, mais tordu : on invente une production qui n'a pas eu lieu._
- **B** — on introduit une **nomenclature de vente** : la liste de ce qu'un produit consomme quand
  il est vendu. _Plus propre, et elle sert AUSSI aux consommables du §2 et aux toppings du §6._
- **C** — on saisit le café en fin de session comme un simple compteur, et le stock de café se
  corrige par inventaire. _Le moins de travail, mais on perd la traçabilité et le coût réel._

**[HYPOTHÈSE de rédaction]** : la voie **B**. Elle résout d'un coup le café, les serviettes, les
gobelets et les toppings vendus — quatre demandes avec un seul concept. C'est le signe qu'on a
trouvé le bon découpage.

### 4.1 Les ingrédients du café, et deux pièges

Liste donnée par le porteur : **café, sucre, eau, chicorée, cannelle**, plus « le coût de
production et de stockage à l'avenir ».

| Ingrédient | Unité | Catégorie                                                      | Remarque                                            |
| ---------- | ----- | -------------------------------------------------------------- | --------------------------------------------------- |
| Café moulu | g     | `'aromate'` ou nouvelle catégorie `'boisson'` **[À TRANCHER]** |                                                     |
| Chicorée   | g     | idem                                                           | s'utilise en mélange avec le café                   |
| Sucre      | g     | `'sucre'`                                                      | existe déjà                                         |
| Cannelle   | g     | idem café                                                      | **quantités minuscules — voir le piège ci-dessous** |
| Eau        | ml    | idem                                                           | voir §4.2                                           |

#### Piège n° 1 — la cannelle : elle DOIT compter, et elle le peut

Exigence du porteur, sans ambiguïté : _« il faut pourtant tenir compte de la cannelle dans le prix
total, donc ici je dois pouvoir introduire la quantité de cannelle »_. Elle compte. La seule
question est **comment la saisir** pour qu'elle ne s'évapore pas en route.

**[VÉRIFIÉ]** La quantité d'une ligne de recette est stockée en **entier** (`quantite_unite_ref`),
conformément à la règle n° 4 de `CLAUDE.md`. Une pincée de 0,2 g par tasse **ne peut donc pas
s'écrire telle quelle** : arrondie, elle vaudrait 0.

**[VÉRIFIÉ — et c'est la bonne nouvelle]** En revanche, la chaîne de calcul du coût est **déjà
correcte** : le coût unitaire moyen (`calculerCump`) est un **flottant** — il n'est jamais arrondi
au centime par gramme — et le coût d'une ligne est calculé par `Math.round(quantité × coût
unitaire)`, donc **on multiplie d'abord et on arrondit à la fin**.

> C'est exactement ce qu'il faut. Sans ça, la farine à 1 €/kg vaudrait 0,1 centime le gramme,
> arrondi à **0**, et le coût matière de R1 s'effondrerait. Le principe « totaliser d'abord,
> diviser ensuite » est déjà en place et protège les petites quantités.

**La solution est donc de saisir pour un LOT DE RÉFÉRENCE**, exactement comme les recettes
existantes : R1 est écrite « **pour 6 crêpes** : 145 g de farine », jamais « pour 1 crêpe : 24,17 g ».

| Ce qu'on saisit                              | Ce que ça donne pour 80 cafés           |
| -------------------------------------------- | --------------------------------------- |
| ✅ « Pour **100 cafés** : 20 g de cannelle » | 20 × 0,8 = **16 g**, coût réel calculé  |
| ❌ « Pour **1 café** : 0,2 g »               | arrondi à 0 g, coût nul, stock immobile |

**[À TRANCHER]** Une seule règle à respecter, et l'écran de saisie devrait la faire respecter :
**le lot de référence doit être assez grand pour que chaque ingrédient atteigne au moins 1 g.**
Pour la cannelle à 0,2 g la tasse, cela impose un lot de référence d'au moins 5 cafés — 100 est
plus confortable et plus lisible.

**[HYPOTHÈSE de rédaction]** : avertir à la saisie plutôt que refuser. « Avec ce lot de référence,
la cannelle est arrondie à 0 g et ne sera pas comptée — augmentez le lot de référence. » C'est un
message qui apprend la règle au lieu de bloquer sans expliquer.

Et la consommation de stock suit la même logique : **une fois par session sur le total vendu**,
jamais tasse par tasse. Quatre-vingts arrondis à zéro font zéro ; un seul arrondi sur le total fait
16 g.

#### Piège n° 2 — le gaz serait compté deux fois

Le « coût de production » d'un café, c'est essentiellement **le gaz pour chauffer l'eau**.

**[VÉRIFIÉ]** Or le gaz existe déjà **deux fois** dans l'application :

- comme **catégorie d'ingrédient** (`'gaz'`), donc stockable en bouteilles, avec un fournisseur ;
- comme **frais de session** (`fraisGazCents`), saisi à la clôture.

Si on ajoute une consommation de gaz dans la nomenclature du café **sans retirer le gaz des frais
de session**, on le compte deux fois — et la marge devient fausse.

**[À TRANCHER]** Choisir **un seul** des deux :

- **A** — le gaz reste un frais de session forfaitaire. _Simple, imprécis, mais honnête._
- **B** — le gaz devient un ingrédient consommé par les nomenclatures (pâte cuite + café), et le
  frais de session disparaît. _Précis, mais suppose de savoir combien de grammes de gaz part dans
  une tasse — ce qui n'est pas mesurable au stand._

**[HYPOTHÈSE de rédaction]** : **A**. Une bouteille de gaz sert aux plaques et à l'eau chaude en
même temps ; vouloir répartir au gramme donnerait une fausse précision. Mieux vaut un forfait
assumé qu'une décimale inventée. C'est exactement l'esprit de `CLAUDE.md` : la complexité est dans
les calculs, pas dans la saisie.

#### Le « coût de stockage » — il a sa place, mais pas ici

Le porteur mentionne un coût de stockage « à l'avenir ». Il faut le ranger au bon endroit, et la
**fiche 13** donne le critère : un coût de stockage **ne varie pas selon le marché choisi**. Il
n'entre donc **pas** dans l'arbitrage entre deux lieux, seulement dans le « combien je gagne
vraiment ».

**[À TRANCHER]** En revanche, il a une utilité précise et immédiate : **arbitrer un achat en gros**.
Le module d'économies d'achat (fiche 12) compare aujourd'hui des prix. Or acheter 50 kg de farine
pour économiser 15 % n'est gratuit que si l'on ne compte ni la place, ni le risque de DLC dépassée.
**Le coût de stockage est ce qui rend cet arbitrage honnête.** C'est là qu'il sert, pas dans le prix
d'une tasse de café.

### 4.1bis Les options du café : lait, crème, beurre

> _« Concernant le café je vais devoir te donner la recette qu'on n'a pas encore réalisée, et en
> plus du café tu dois rajouter : lait, crème, beurre comme topping. »_

**La recette manquante ne bloque rien.** Une recette est une **donnée**, pas du code : elle se
saisit dans l'application le jour où elle est mise au point. Rien à attendre de ce côté.

#### Une option n'est pas un menu — deux concepts à ne pas confondre

C'est la distinction utile ici, et elle recoupe la **fiche 16** :

| Concept             | Exemple               | Nature                                   |
| ------------------- | --------------------- | ---------------------------------------- |
| **Menu** (fiche 16) | crêpe + café à 5,00 € | deux produits **assemblés**, prix global |
| **Option**          | café **avec crème**   | **un** produit **modifié**               |

Une option modifie la nomenclature d'un produit : elle ajoute une ligne de consommation, donc un
coût, et éventuellement un supplément de prix. **[À TRANCHER]** Le supplément est-il facturé, ou
offert ? Les deux existent au marché ; l'application doit permettre les deux, y compris une option
gratuite qui coûte quand même en matière.

#### **[ALERTE] Une option peut ajouter un ALLERGÈNE**

C'est le point sérieux de cette section.

**[VÉRIFIÉ]** L'application calcule les allergènes depuis les recettes et génère des affichettes
(`affichette_allergenes`). Le **lait** est un allergène à déclaration obligatoire.

Un café noir n'en contient pas. **Un café avec crème, si.**

Si la liste d'allergènes est calculée sur la seule recette de base, l'application déclarerait un
café **sans allergène** alors qu'on vient d'y verser de la crème. Ce n'est pas une imprécision
comptable, c'est une **information fausse donnée à un client allergique**.

> **Règle qui en découle** : le calcul des allergènes doit porter sur **le produit tel qu'il est
> servi**, options comprises — jamais sur la recette de base seule. Et une affichette doit énoncer
> les allergènes **apportés par les options**, puisqu'on ne sait pas à l'avance ce que le client
> demandera.

**[HYPOTHÈSE de rédaction]** : l'affichette liste les allergènes du produit de base, puis
« **sur demande** : lait (lait, crème), lait (beurre) ». C'est ce que fait n'importe quel bon stand,
et l'application a déjà toute la donnée pour l'écrire.

#### La chaîne du froid, encore

Lait, crème et beurre sont des **produits laitiers** : DLC courte, conservation au froid.

**[VÉRIFIÉ]** `CLAUDE.md` §6 : la chaîne du froid du stand est **passive** (glacière rigide et blocs
eutectiques). C'est exactement la même contrainte que celle qui pèse sur la vente de pâte crue
(§5 de cette fiche) et sur les relevés de température AFSCA.

**[À TRANCHER]** Un froid **actif** demanderait de l'électricité — donc dépend du lieu (décision
**D-055**) et vient s'ajouter au parc d'équipements de la fiche 17. La question « puis-je proposer
de la crème sur ce marché ? » a donc la même réponse que « y a-t-il du courant ici ? ».

**[À VÉRIFIER AUPRÈS DE L'AFSCA]**, en même temps que les questions du §7 : la conservation de
produits laitiers ouverts en froid passif sur une session de six heures et demie.

### 4.2 L'eau, et une question d'hygiène plus que de coût

Le prix de l'eau du robinet est négligeable. Ce n'est pas le sujet.

**[À TRANCHER]** La vraie question est **d'où elle vient au stand**. `CLAUDE.md` §6 rappelle qu'il
n'y a **pas d'électricité** et une chaîne du froid passive. S'il n'y a pas non plus d'arrivée d'eau,
l'eau est **transportée**, en jerricans ou en bouteilles — et devient alors un vrai article de
stock, avec un fournisseur, un contenant et un volume à prévoir.

Et servir des boissons chaudes engage l'hygiène : l'eau doit être potable et sa conservation
maîtrisée. **[À VÉRIFIER AUPRÈS DE L'AFSCA]** en même temps que les questions du §7.

### 4.3 Le gobelet dépend du mode de consommation

**[VÉRIFIÉ]** `produit_vente` porte déjà un drapeau `consommationSurPlace`, qui alimente le
compteur du seuil SCE (distinct de la franchise TVA).

Un café sur place et un café à emporter ne consomment pas le même contenant, et **ne comptent pas
pareil pour les seuils légaux**. La nomenclature de vente doit donc pouvoir dépendre de ce drapeau.

---

## 5. Vendre la pâte : trois conséquences, dont une urgente

### 5.1 Collision directe avec la clôture au volume — **point dur**

**[VÉRIFIÉ]** La clôture « je compte la pâte » (en cours d'écriture au moment de la rédaction)
déduit le nombre de crêpes à partir du volume disparu du bac.

**Si deux litres partent en bouteille, ils quittent le bac sans devenir des crêpes.** Le calcul les
compterait comme des crêpes produites — donc surestimerait la production, fausserait le taux
d'écoulement et le coût par crêpe.

> **À traiter obligatoirement** : la pâte vendue en tant que pâte doit être **retranchée du volume
> consommé** avant d'en déduire les crêpes. Sinon le mode « je compte la pâte » devient faux dès la
> première bouteille vendue.

### 5.2 La pâte devient un produit avec un contenant

Vendre de la pâte, c'est vendre **un contenu + un contenant**. La bouteille ou le pot est un
consommable qui a son fournisseur, son coût, son stock.

**[À TRANCHER]** Quel format ? Un contenant unique, ou plusieurs volumes (50 cl / 1 L) ?

### 5.3 Elle entre en concurrence avec les crêpes

Deux litres vendus, ce sont environ **26 crêpes qu'on ne pourra pas cuire**. Selon les repères de
`CLAUDE.md` §6, une crêpe rapporte ~90 % de marge ; un litre de pâte vendu brut rapporte beaucoup
moins en valeur absolue.

**[À TRANCHER]** Faut-il un garde-fou ? **[HYPOTHÈSE]** non, pas un blocage — mais l'écran de
clôture peut afficher le manque à gagner, comme il affiche déjà les écarts. Informer, ne pas
interdire.

---

## 6. Vendre les toppings, et le stand qui doit être beau

> « Nous allons aussi vendre le topping directement si le client veut, et puis ça embellit le stand. »

### 6.1 Un même pot, deux façons de sortir du stock

Un pot de pâte à tartiner peut être **étalé sur une crêpe** (au gramme) **ou vendu entier** (à la
pièce). C'est le même article physique, avec deux chemins de sortie.

**[VÉRIFIÉ]** Le modèle sait déjà relier un produit revendu à un ingrédient de stock : la clôture
sort le stock des revendus et signale les écarts (`ecartsStock`, décision D-037). Le socle existe.

**[À TRANCHER]** Le point délicat est l'**unité**. Si la pâte à tartiner est stockée en grammes
pour l'usage garniture, vendre un pot de 400 g doit sortir 400 g. Il faut donc que le produit de
vente connaisse son équivalent en unité de stock. **[HYPOTHÈSE]** : une quantité par unité vendue,
sur le produit de vente — sans quoi les deux usages ne peuvent pas partager le même stock.

### 6.2 « Ça embellit le stand » n'est pas un détail

C'est un argument de **marchandisage**, et il est juste : des pots alignés donnent envie de
s'arrêter. Il justifie de tenir en stock plus de variété que la seule marge ne le recommanderait.

**[À TRANCHER]** L'application ne modélise pas la beauté d'un stand. Mais elle peut éviter de
donner un mauvais conseil : si un écran classe un jour les produits par rentabilité, il ne doit pas
suggérer de retirer un article peu rentable **sans signaler qu'il peut être là pour attirer**.
Un simple drapeau « produit d'appel / de présentation » suffirait à empêcher ce contresens.

---

## 7. Le point réglementaire à ne pas découvrir trop tard

**[À VÉRIFIER AUPRÈS DE L'AFSCA — l'application ne tranche pas, cf. `CLAUDE.md` §7]**

Servir une crêpe sur un stand et vendre un pot de pâte préemballé ne relèvent pas du même régime.

- Une denrée **non préemballée**, servie sur place, demande essentiellement l'information sur les
  **allergènes**.
- Une denrée **préemballée** vendue à emporter — un pot de pâte, un sachet de mélange café — relève
  du règlement européen **INCO (n° 1169/2011)**, qui impose sur l'étiquette : dénomination, **liste
  des ingrédients**, **allergènes mis en évidence**, quantité nette, **date de durabilité**,
  **conditions de conservation**, et les coordonnées de l'exploitant.

Et de la **pâte crue contenant œufs et lait** a une durée de conservation courte, avec une chaîne du
froid à respecter — alors que le stand fonctionne en **froid passif** (glacière et blocs
eutectiques, `CLAUDE.md` §6).

> **Bonne nouvelle** : l'application **génère déjà des affichettes allergènes** (le type de document
> `affichette_allergenes` existe dans le schéma). Une étiquette INCO, c'est **la même donnée dans
> un autre format** — les allergènes et la composition sont déjà calculés depuis la recette.
> Le travail est un gabarit de plus, pas un nouveau moteur.

**[À TRANCHER]** Ces trois questions se posent au même endroit :

1. La vente de pâte crue préemballée est-elle couverte par l'autorisation AFSCA actuelle ?
2. Quelle DLC porter, et le froid passif la permet-il ?
3. Le mélange de café en poudre : est-il **fabriqué** (donc étiquetage complet) ou simplement
   **reconditionné** ?

---

## 8. Ce que ça implique, récapitulé

| Chantier                            | Effort                 | Pourquoi                                                      |
| ----------------------------------- | ---------------------- | ------------------------------------------------------------- |
| Sortie de stock des consommables    | moyen                  | sinon le stock ne baisse jamais et le coût par crêpe est faux |
| Nomenclature de **vente**           | moyen                  | résout café + consommables + toppings d'un seul concept       |
| Séparer `consommable` de `aromate`  | faible                 | deux moments de consommation différents                       |
| Pâte vendue retranchée du volume    | **faible mais urgent** | sinon la clôture au volume est fausse                         |
| Contenants (bouteille, sachet)      | faible                 | ce sont des consommables de plus                              |
| Étiquette INCO                      | faible                 | le calcul des allergènes existe déjà                          |
| Drapeau « produit de présentation » | faible                 | évite un mauvais conseil de rentabilité                       |

---

## 9. Liens

- **Fiche 13** — coût complet : les consommables en font partie.
- **Décision D-053** — les garnitures sortent du stock. Même problème, déjà résolu une fois.
- **Décision D-037** — la vente sort du stock sans jamais bloquer la clôture.
- **`docs/02-MODELE-DONNEES.md`** — natures de produit et types de mouvement.

---

## Note de statut — 01/08/2026, vérifiée contre le code

Vérification faite dans le code courant. Rien codé ici — mission documentaire.

### Le fait nouveau : le coût de revient d'un produit à nomenclature se calcule enfin

Jusqu'ici, `coutRevientProduit` (`packages/db/src/depots/recettes.ts`) ne tirait de la
nomenclature de vente **que les allergènes** — un produit entièrement fait de composants de
vente (le café, `consommationUnite: 'nomenclature'`, **D-085**) n'avait donc **jamais** de coût
matière chiffrable, même quand tous ses ingrédients avaient un prix connu. **Corrigé le
01/08/2026** : `coutsComposantsVente` (`packages/core/src/contrats/recettes.ts:279` et suivantes)
calcule désormais ce coût, avec **trois arbitrages tranchés dans cette même mission** :

1. **Un composant OPTIONNEL (`optionnel: true`) n'entre jamais dans `coutComposantsCents`.** Le
   prix catalogue d'une tasse de café ne varie pas selon l'option choisie ; le compter
   systématiquement surestimerait le coût de chaque vente nature pour ne refléter que celles
   avec l'option. La ligne reste néanmoins **affichée** dans le tableau (`inclusDansLeCout:
false`) : jamais retirée en silence.
2. **`consommationSurPlace` du composant doit correspondre au mode FIXE du produit**
   (`produitVente.consommationSurPlace`, colonne `NOT NULL`) — pas un mode par vente comme à la
   clôture de session. Un gobelet jetable n'entre pas dans le coût catalogue d'un produit
   consommé sur place. `null` sur le composant = consommé dans les deux cas, toujours inclus.
3. **Un composant INCLUS sans prix connu (`cumpCentsParUnite: null`) rend `coutComposantsCents`
   entier à `null`** — un total partiellement inconnu n'est pas présentable comme complet (même
   doctrine que les lignes de recette, D-018) — **mais la ligne reste dans le tableau**,
   identifiable avec son `coutCents: null` propre, jamais retirée.

**Vérifié par calcul indépendant, à partir des données du jeu de démonstration**
(`packages/db/src/seed/demonstration.ts`, `COMPOSANTS_CAFE`) : pour « Tasse de café à emporter »
(hors options), café moulu (7 g à 1,40 c/g) + chicorée (2 g à 0,70 c/g) + sucre (5 g à 0,18 c/g) +
eau (100 ml à 0,016 c/ml) + cannelle (0,2 g à 1,92 c/g, via le lot de référence de 100 tasses) +
gobelet (1 pièce à 13 c) = **27,08 centimes, arrondis à 27**. Avec un prix de vente à 2,00 €, la
marge vaut (200 − 27) / 200 = **86,5 %** — les deux chiffres cités dans la consigne de mission
sont donc corroborés par un calcul indépendant sur les données réelles du seed, pas seulement
rapportés.

### §2.3 — TRANCHÉ : `'aromate'` et `'boisson'` séparent bien les deux moments de consommation

`packages/db/src/schema.ts:163-175` : l'énum `categorie` de `ingredient` porte désormais neuf
valeurs, dont `'boisson'` et `'aromate'`, en plus de `'consommable'`. Le seed de démonstration
applique la distinction exactement comme l'hypothèse de rédaction le proposait : café, chicorée,
eau en `'boisson'`, cannelle en `'aromate'` (« elle parfume le café, mais aussi une crêpe en
topping »), gobelet en `'consommable'`. **Aucune migration SQL** n'a été nécessaire : la liste
n'est contrainte qu'en TypeScript, pas par un `CHECK` SQL.

### §4.1bis ALERTE (allergène apporté par une option) — TRANCHÉ et implémenté

Le point que la fiche qualifiait de « sérieux » (un café avec crème doit déclarer l'allergène
lait, un café noir non) est résolu **exactement selon l'hypothèse de rédaction proposée** :
`apps/api/src/documents/donnees.ts` et `gabarits.ts` calculent une liste d'allergènes principale
(composants non optionnels) et une liste séparée « sur demande » (composants optionnels non
inclus). Deux fichiers de test dédiés le couvrent :
`apps/api/src/documents/allergenes-verifies.test.ts` (« un composant optionnel non évalué
n'entache pas le produit ») et `audit-documents.test.ts` (le cas café noir / café avec crème
explicitement testé).

### §5.1 — PARTIEL : l'identification existe, la valeur réelle n'est pas encore lue

Le point que la fiche qualifiait d'« urgent » (la pâte vendue en bouteille ne doit pas être
comptée comme des crêpes produites) a un mécanisme d'**identification** posé par **D-085**
(31/07/2026) : `produit_vente.consommation_unite = 'volume_pate'` et la fonction
`estPateVendueAuVolume` (`packages/core/src/sessions.ts`) distinguent enfin sans ambiguïté un
café (`'nomenclature'`) d'une pâte vendue au volume (`'volume_pate'`) — avant cette décision, les
deux étaient confondus par un même `nb_crepes = 0`.

**Mais la colonne qui porte le volume réel n'est lue nulle part.** `produit_vente.volume_ml_par_unite`
existe en base (`packages/db/src/schema.ts:402`), mais `packages/db/src/services/sessions.ts:1004-1013`
construit la retenue de volume avec `volumeMlParUnite: null` **codé en dur**, avec un commentaire
qui le documente explicitement : _« ce champ EXISTE désormais sur `produit_vente`, mais rien dans
cette fonction ne le lit encore — la contribution au volume retranché est donc `0` aujourd'hui,
limite documentée et non silencieuse [...] et HORS PÉRIMÈTRE de cette mission »_. **Concrètement,
aujourd'hui : vendre une bouteille de pâte n'est plus compté comme des crêpes (bonne nouvelle),
mais son volume n'est pas non plus retranché du bac (la correction n'a donc, pour l'instant,
aucun effet chiffré sur le calcul de clôture) — la ligne est seulement ignorée plutôt que
comptée à tort.** Il manque : lire `volumeMlParUnite` du produit vendu au moment de la clôture et
l'injecter dans `ventesPourVolumePate` au lieu de `null`.

### §4.1, piège n°2 (gaz compté deux fois) — hypothèse A confirmée par construction

`COMPOSANTS_CAFE` (`packages/db/src/seed/demonstration.ts`) ne contient aucune ligne `gaz` :
le gaz reste un poste de frais de session forfaitaire (`fraisGazCents`), jamais un ingrédient
consommé par la nomenclature. Cohérent avec l'hypothèse de rédaction retenue par la fiche
(« un forfait assumé plutôt qu'une décimale inventée ») — mais ceci reste une conséquence du
jeu de démonstration, pas une contrainte imposée par le schéma : rien n'empêche techniquement de
déclarer une ligne `gaz` sur une nomenclature de vente, ce qui recréerait le double comptage
que la fiche signale. Ce garde-fou n'est donc pas structurel.

### §6.1 (le pot de pâte à tartiner, deux chemins de sortie) — état à vérifier avec le porteur, pas tranché

Constat en demi-teinte, à ne pas confondre avec un « fait ». Le mécanisme de nomenclature de
vente (`produit_vente_composant`, `packages/db/src/depots/nomenclature-vente.ts::creerComposantVente`)
n'est **techniquement pas restreint** à un produit `transforme` : `creerComposantVente` ne
vérifie que l'existence du produit et de l'ingrédient, jamais sa `nature`, et l'écran
`NomenclatureVente.tsx` propose bien les produits `transforme` **et** `revendu` au choix (ligne
533). Un pot de Nutella `revendu`, stocké en grammes, pourrait donc en principe recevoir un
composant de nomenclature déclarant « 1 unité vendue = 400 g ».

**Ce que cette mission n'a pas pu établir avec certitude** : si un produit `revendu` a À LA FOIS
son `ingredientId` propre (sortie 1:1 du stock, D-037) ET des composants de nomenclature de
vente actifs, rien de trouvé dans le code ne montre explicitement qu'une seule des deux
mécaniques s'applique à l'exclusion de l'autre — un risque de double sortie de stock n'est ni
confirmé ni écarté par cette lecture. Aucun exemple ou test du jeu de démonstration ne couvre ce
cas précis (un `revendu` avec composants). **À vérifier avant de considérer ce point comme
résolu** — ne pas présumer qu'il l'est seulement parce que le mécanisme existe pour le café.

### Ce qui reste absent, sans ambiguïté

- **Drapeau « produit d'appel / de présentation » (§6.2)** : recherche exhaustive sur `schema.ts`,
  les écrans et `packages/core` — aucune colonne, aucun champ de ce type n'existe. Rien ne
  protège un futur écran de classement par rentabilité contre le contresens que la fiche signale.
- **Étiquette INCO (§7)** : seuls deux types de document existent
  (`packages/db/src/schema.ts:1231-1232` : `'affichette_allergenes'`, `'etiquette_bac'`). Aucun
  gabarit dédié à un étiquetage de denrée préemballée (dénomination, quantité nette, date de
  durabilité, coordonnées de l'exploitant, règlement INCO 1169/2011) n'existe — la fiche notait
  elle-même que « le travail est un gabarit de plus, pas un nouveau moteur », ce gabarit reste à
  écrire.
- **Contenants dédiés à la pâte vendue (bouteille/pot, §5.2) et à la revente de café en poudre** :
  aucun ingrédient ni produit de ce type dans le seed ou le schéma au-delà du gobelet du café.
- **Les trois questions AFSCA du §7** (couverture de l'autorisation actuelle pour la pâte crue
  préemballée, DLC en froid passif, fabrication vs reconditionnement du mélange café) : hors
  périmètre du code par construction, jamais tranchées ni par la fiche ni par le code — à poser
  au régulateur, pas à deviner.
