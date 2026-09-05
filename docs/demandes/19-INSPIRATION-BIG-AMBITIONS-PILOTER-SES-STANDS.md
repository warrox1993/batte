# Fiche 19 — Inspiration Big Ambitions : piloter ses stands

> **Origine** : direction donnée par le porteur les 28 et 29/07/2026, mise en forme par Claude Code.
> **Statut** : brouillon à relire et amender. Rien n'est codé.
> **[À TRANCHER]** = décision attendue. **[HYPOTHÈSE]** = supposition de rédaction.
> **[VÉRIFIÉ]** = constat lu dans le code. **[ALERTE]** = point qui heurte une règle du projet.
>
> **Note de statut — 30/07/2026, revérifiée contre le code (confirme la note du 29/07/2026).**
> Recherche refaite le 30/07 dans `schema.ts`, `packages/core/`, `apps/web/src/pages` :
> **aucune notion de stand multiple, ni d'employé/salarié, n'existe dans le code** — chaque
> occurrence du mot « stand » désigne l'emplacement de vente unique, comme dans le reste du projet.
> Cette fiche reste une direction de porteur non codée ; les `[À TRANCHER]` ci-dessous, y compris
> celui sur l'esthétique « Big Ambitions » réservée aux écrans de lecture, restent entiers.
>
> **Une pièce du §3.2 existe désormais, mais par un autre chantier, pas par celui-ci** :
> `apps/web/src/pages/ComparaisonLieux.tsx` et `GET /lieux-rentabilite` (fiche 13, D-060) affichent
> déjà « l'argent généré » agrégé par `lieu_marche` — exactement la donnée que cette fiche identifie
> comme partagée avec la future « vue stand ». Ce n'est ni une vue « stand » au sens du jeu (pas de
> stock ni de personnel affichés comme un tout) ni un signe que cette fiche a été entamée : c'est la
> confirmation, écrite en §3.2, que la donnée sous-jacente est déjà là le jour où la décision sera
> prise.

---

## 1. La demande, dans ses mots

> « Je ne sais pas si tu connais le jeu **Big Ambitions**, mais ça pourrait être cool de gérer ses
> affaires avec des interfaces similaires. »
>
> « Ce serait vraiment top de pouvoir **gérer ses business ou stands** ici, avec les **stocks en
> temps réel**, **l'argent généré**, **les employés qui y travaillent**. Pour le moment on pourra
> réfléchir à quelque chose de similaire, on doit **d'abord créer l'app de base parfaite**, ensuite
> on ajustera à l'avenir. »

**La séquence vient de lui et fait autorité : la base d'abord, l'habillage ensuite.** Cette fiche
consigne l'intention pour qu'elle ne se perde pas, elle n'autorise pas à commencer.

---

## 2. La ligne de partage : lecture oui, saisie non

C'est le cœur de la fiche. Proposée le 29/07, non contestée par le porteur.

|                           | Écrans de **LECTURE**                                                                   | Écrans de **SAISIE**                                           |
| ------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Exemples                  | tableau de bord, synthèses, consultation d'une session                                  | clôture, réception, production, relevés AFSCA                  |
| Inspiration Big Ambitions | **oui**                                                                                 | **non**                                                        |
| Objectif                  | ouvrir et **savoir en deux secondes** où on en est                                      | vingt lignes tapées à 23 h **sans une erreur**                 |
| Moyens                    | hiérarchie visuelle forte, tendances lisibles d'un coup d'œil, couleur porteuse de sens | densité, tabulation, entrée, chiffres, zéro souris obligatoire |

**Le raisonnement, en une phrase** : _une interface de jeu est conçue pour qu'on ait envie d'y
rester ; un écran de clôture est conçu pour qu'on puisse en sortir vite._ Les deux sont de bons
objectifs — mais pas sur le même écran.

**[VÉRIFIÉ]** C'est déjà la doctrine du projet : `CLAUDE.md` §0 — « **la complexité est dans les
calculs, jamais dans l'interface** » — et §3 règle 10 — « chaque écran doit être utilisable au
clavier ; la saisie post-marché est répétitive ».

**[À TRANCHER]** Un cas limite : le **tableau de bord d'avant-marché**, consulté debout, peut-être
sur un téléphone. Lecture pure, donc éligible — mais lisible en plein soleil et sans réseau.
Contrainte inverse d'un écran de jeu.

---

## 3. Ce qu'il y a vraiment à prendre dans Big Ambitions

Au-delà de l'esthétique, trois idées de fond méritent d'être reprises. Elles ne coûtent pas cher et
elles changent l'usage.

### 3.1 L'état de l'affaire tient sur un écran

Dans le jeu, on voit d'un coup : la trésorerie, ce qui tourne, ce qui bloque. Pas de menu à
explorer pour savoir si tout va bien.

**[HYPOTHÈSE de rédaction]** : c'est l'exigence la plus utile, et la plus exigeante. Elle oblige à
**hiérarchiser** — donc à décider ce qui compte vraiment. Un tableau de bord qui affiche vingt
indicateurs n'en affiche aucun.

### 3.2 Une entité qu'on « possède » et qu'on regarde vivre

Un stand, dans le jeu, est un objet avec son stock, son chiffre, son personnel. Ici, ce serait un
**lieu de marché** avec ses sessions, ses coûts, sa marge — vu comme **un tout**, pas comme une
suite de lignes.

**[VÉRIFIÉ]** Le socle existe déjà : les sessions portent un `lieu_marche`. **« L'argent généré »
par lieu est donc agrégeable sans rien construire.**

**[À TRANCHER]** C'est aussi exactement ce que demande la **fiche 13** (arbitrage entre lieux) : la
marge nette par lieu. La vue « stand » et le calcul d'arbitrage sont **la même donnée**, présentée
deux fois. À construire une seule fois.

### 3.3 Progression et récompense

Traité à part dans la **fiche 18** (succès, niveaux, objectifs), avec son piège : ne jamais
récompenser le chiffre d'affaires brut, parce que le dépasser coûte la franchise TVA.

---

## 4. Ce qu'il ne faut **pas** prendre

| Mécanique de jeu                                              | Pourquoi elle nuit ici                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Boucles d'engagement, notifications qui rappellent de revenir | l'outil doit se faire oublier entre deux marchés, pas capter du temps                              |
| Animations et transitions                                     | ralentissent une saisie répétitive, sans rien apporter                                             |
| Chiffres arrondis « pour faire joli »                         | `CLAUDE.md` §3 règle 3 : l'argent est en centimes entiers. Un chiffre comptable ne s'esthétise pas |
| Aléatoire, événements surprises                               | l'application décrit une activité réelle, elle ne la met pas en scène                              |

### 4.1 Correction importante — l'objectif EST la croissance

J'avais écrit ici qu'une barre de progression « vers plus gros » n'avait pas de sens, l'activité
étant plafonnée par les seuils légaux. **Le porteur a corrigé, et il a raison :**

> _« Mon but est de grossir le plus possible, et le plus rapidement et solidement possible. Donc
> non, **0 limite d'argent**. »_

C'était une supposition de ma part, pas une donnée du projet. Elle est retirée.

**Ce que cela change** : les seuils légaux de `CLAUDE.md` §6 ne sont **pas des plafonds à ne pas
atteindre**. Ce sont des **points de passage** :

| Seuil                            | Ce que ce n'est PAS          | Ce que c'est                                          |
| -------------------------------- | ---------------------------- | ----------------------------------------------------- |
| 25 000 € — franchise TVA         | une limite à ne pas franchir | un **changement de régime** à préparer                |
| 23 000 € — aide Airbag           | un échec si dépassé          | une aide qui cesse, à anticiper dans la trésorerie    |
| 17 374,08 € — cotisation réduite | un mur                       | le moment où le statut complémentaire coûte plus cher |

> **Le rôle de l'application n'est pas de le garder petit. C'est de faire en sorte qu'il franchisse
> ces seuils en le sachant, préparé, et au moment qu'il choisit** — pas de le découvrir chez le
> comptable en mars.

L'alerte à 80 % garde donc tout son sens, mais son message change de nature : ce n'est pas
« ralentis », c'est **« prépare-toi, voilà ce qui change après »**.

### 4.2 **[ALERTE] Ce que l'ambition de croissance implique techniquement

Un point à voir venir de loin, parce qu'il est structurant et qu'il n'existe pas aujourd'hui.

**[VÉRIFIÉ]** `CLAUDE.md` §6 pose le régime actuel : **franchise de TVA**. Toute l'application est
bâtie là-dessus — pas de taux, pas de TVA déductible sur les achats, pas de déclaration.

**Franchir 25 000 € rend la TVA obligatoire.** Il faudra alors : des taux par produit (l'alimentaire
et la restauration ne sont pas au même taux en Belgique), la TVA déductible sur les achats, les
déclarations périodiques, et des documents de vente conformes.

**[À TRANCHER]** Ce n'est pas à construire aujourd'hui — mais c'est à **ne pas rendre impossible**.
Deux précautions concrètes, sans coût immédiat :

1. Ne jamais coder « pas de TVA » en dur : c'est un **paramètre de régime**, daté, comme tous les
   seuils (`CLAUDE.md` §7).
2. Conserver dès maintenant, sur les réceptions, le **montant payé réel** — ce qui est déjà le cas
   depuis la décision D-044. C'est ce qui permettra de reconstituer une TVA déductible le jour venu.

**[HYPOTHÈSE de rédaction]** : mieux vaut découvrir ce chantier maintenant, sur le papier, qu'à
24 000 € de chiffre d'affaires un mois de novembre.

---

## 5. **[ALERTE] Les employés sortent du périmètre déclaré**

Le porteur cite « les employés qui y travaillent ». C'est le seul élément de cette fiche qui heurte
frontalement une règle fondatrice.

**[VÉRIFIÉ]** `CLAUDE.md` §0 dit aujourd'hui : _« mono-utilisateur — pas de gestion de droits, pas
de workflow d'approbation, pas de multi-société. **Deux personnes, un poste, un métier.** »_

Des employés sur des stands, ce n'est pas une fonctionnalité de plus, c'est un **changement de
nature** :

1. Savoir **qui** a tenu quel stand — de l'attribution, pas de l'authentification (à rapprocher de
   la fiche 11, profils utilisateurs).
2. La **masse salariale** devient une charge de l'exercice, donc touche la synthèse comptable et le
   seuil de revenu net.
3. « L'argent généré par stand » suppose de rattacher les frais à un **stand**, et non plus à une
   session.
4. Un employé est une **personne** : contrat, données sociales, RGPD. Le §3 règle 9 exclut les
   données personnelles **clients** en V1 ; les données salariés sont un sujet distinct et plus
   lourd.

**[À TRANCHER]** Le jour venu, cela demandera une **révision explicite de `CLAUDE.md` §0** et une
décision consignée dans `docs/05-DECISIONS.md`. **Ne rien ajouter silencieusement** qui suppose des
employés.

---

## 6. Ordre de marche

1. **D'abord l'application de base**, complète et juste. Décision du porteur, répétée deux fois.
2. Ensuite la **fiche 10** (refonte visuelle), programmée **en dernier** — la fiche le dit
   elle-même : « pour ne pas polir une interface qui va encore bouger ».
3. Les **succès** (fiche 18) et la **vue par stand** (§3.2) s'y greffent naturellement.
4. Les **employés** (§5) restent hors périmètre jusqu'à décision explicite.

---

## 7. Liens

- **Fiche 10** — refonte visuelle et intuitivité. C'est là que cette fiche se concrétise.
- **Fiche 18** — succès, niveaux et objectifs. La progression, avec son garde-fou.
- **Fiche 13** — marge nette par lieu : la même donnée que la vue « stand ».
- **Fiche 11** — profils utilisateurs : le préalable technique à toute notion d'employé.
- **`CLAUDE.md` §0 et §3 règle 10** — la doctrine que cette fiche respecte, et la règle qu'elle
  finira par obliger à réviser.

---

## 8. Mise à jour du 01/08/2026 — revérification par un agent documentaire, et deux éléments concrets

### 8.1 Rien n'a commencé par accident — reconfirmé

Recherche refaite dans `packages/db/src/schema.ts`, `packages/core/src/`, `apps/web/src/pages/` :
**toujours aucune notion de stand multiple ni d'employé/salarié.** La table `utilisateur`
(`packages/db/src/schema.ts:59-66`) ne porte que `nom` et `role: 'proprietaire' | 'collaborateur'`
— la fiche 11, pas un début de fiche 19. Chaque occurrence du mot « stand » dans le code désigne
toujours l'emplacement de vente unique (ex. `packages/core/src/energie.ts:2`, « Énergie et
puissance électriques du stand »), jamais une pluralité. Les deux `[ALERTE]` (§4.2 : TVA
obligatoire au franchissement de seuil, non rendue impossible mais non construite ; §5 : les
employés hors périmètre) restent entières, non tranchées, non codées.

Le tableau de bord a été retouché aujourd'hui même par un autre agent (ajout de la ligne
« objectif en cours », voir fiche 18 §8) : son layout reste un grid CSS responsive ordinaire
(`grid grid-cols-1 … lg:grid-cols-2 2xl:grid-cols-12`, `apps/web/src/pages/TableauDeBord.tsx`),
préexistant à cette session et non une nouvelle disposition « bento » construite en réponse à la
demande du §8.2 ci-dessous — aucune trace du mot « bento » ni « cockpit » dans `apps/web/src/`.
**Rien n'a donc commencé par accident sur cette fiche, ici non plus.**

### 8.2 Deux éléments nouveaux du 01/08/2026 — première fois que cette fiche touche du concret

Le porteur a formulé, le 01/08/2026, deux précisions qui portent directement sur cette fiche et
qui n'existaient pas quand elle a été écrite :

1. **Le tableau de bord doit être un cockpit** — « toutes les données sous la main au même
   endroit » — organisé en **grille bento pleine page**. C'est une reformulation concrète du
   §3.1 de cette fiche (« l'état de l'affaire tient sur un écran ») : la métaphore du cockpit et
   la grille bento en sont une traduction visuelle directe, pas une idée séparée.
2. **L'esthétique « façon Big Ambitions » est explicitement reportée à plus tard.** Cela confirme
   et date la séquence déjà actée au §1 et au §6 : la base d'abord, l'habillage ensuite — mais
   cette fois avec une décision write : le cockpit bento n'attend pas l'esthétique Big Ambitions
   pour exister, les deux sont dissociés dans le temps.

**Ni l'un ni l'autre n'est codé** (voir §8.1 : aucune trace de grille bento dans
`apps/web/src/`). Cette section les consigne pour qu'ils ne se perdent pas — exactement le rôle
de cette fiche depuis son origine (§1 : « cette fiche consigne l'intention pour qu'elle ne se
perde pas, elle n'autorise pas à commencer ») — sans rien construire ici.

### 8.3 Le reste, inchangé

`ComparaisonLieux.tsx` et `GET /lieux-rentabilite` (fiche 13, D-060) existent toujours et
affichent toujours l'argent généré agrégé par `lieu_marche`, confirmant le constat du §3.2 :
la donnée sous-jacente à une future vue « stand » est déjà là, sans que cela constitue un début
de cette fiche.
