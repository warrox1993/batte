# 36 — Audit multi-résolution : l'application tient-elle à 1280, 1920 et 2560 ?

> Mission de mesure, aucun code touché. Fait suite à la correction du porteur du 01/08/2026 sur
> `docs/07-DOCTRINE-ERP-ET-DESIGN.md` §4.4 : la cible n'est plus « 1280 × 720, jamais 1920 × 1080 »
> mais un **intervalle à couvrir** — 1280 de large, 1920 × 1080, 2560 × 1440 — parce que le porteur
> travaille réellement sur ces trois tailles. Le critère de fin de
> `docs/demandes/02-RESPONSIVE-1080P-1440P.md` (captures automatisées aux trois résolutions)
> n'avait jamais été livré : cet audit le livre, une fois, en lecture seule.

---

## 1. Les trois nombres

**30 écrans mesurés, aux 3 largeurs, 0 non mesuré.** 30 × 3 = **90 combinaisons, 90 mesurées.**

| Nombre                                                     | Valeur                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Écrans dérivés de `apps/web/src/App.tsx`                   | **30** (29 routes de `<Routes>` hors joker `*`, + `/stock/inventaire`, atteint depuis `/stock` par une action, absent de `Navigation.tsx` donc de la nav-batch — mesuré séparément par navigation directe) |
| Largeurs testées                                           | **3** — 1280, 1920, 2560 (largeur `document.documentElement.clientWidth` réelle, jamais la taille demandée)                                                                                                |
| Combinaisons mesurées                                      | **90 / 90**                                                                                                                                                                                                |
| Combinaisons pour lesquelles le redimensionnement a échoué | **0** — voir piège de mesure ci-dessous, rencontré une fois et corrigé avant d'entrer dans les résultats                                                                                                   |

**Le piège de mesure annoncé dans la mission s'est produit exactement comme décrit, dès la
première tentative.** Cette machine tourne à `devicePixelRatio = 1.25`. Demander un viewport
`1280 × 720` à Playwright (`page.setViewportSize`) donne un `clientWidth` réel de **1024**, pas
1280 — un quart de la largeur perdu sans qu'aucun signal ne le dise. Chaque taille cible a donc
été atteinte en demandant `taille_cible × 1.25`, puis **vérifiée** par lecture de
`document.documentElement.clientWidth` avant toute capture :

| Cible réelle | Requête envoyée à `setViewportSize` | `clientWidth` constaté | `clientHeight` constaté |
| ------------ | ----------------------------------- | ---------------------- | ----------------------- |
| 1280 large   | 1600 × 900                          | **1280**               | 720                     |
| 1920 × 1080  | 2400 × 1350                         | **1920**               | 1080                    |
| 2560 × 1440  | 3200 × 1800                         | **2560**               | 1440                    |

Chacune des 90 mesures ci-dessous porte le `clientWidth` réellement lu au moment de la mesure, pas
la taille demandée — aucune n'a été acceptée sur la seule foi de la requête envoyée.

**Un second piège, plus fin, rencontré une fois en cours d'audit et corrigé immédiatement par la
même discipline de revérification** : lors d'une mesure ponctuelle hors du grand balayage (le
calcul du débordement de la barre de navigation par hauteur), une paire `resize` + `evaluate`
consécutive a renvoyé `clientWidth: 1024, clientHeight: 576` alors que 1920 × 1080 avait été
demandé — c'est-à-dire la taille _précédente_, pas la nouvelle. Un second appel identique, une
mesure plus tard, a donné le résultat correct (`1920 × 1080`). Cause probable : le navigateur
Playwright de cette session est partagé (l'un des points d'attention explicites de la mission), et
un aller-retour a dû se chevaucher avec une autre action. **Ce point n'a contaminé aucun résultat
retenu** : c'était un contrôle isolé, refait aussitôt l'anomalie vue, et les trois grands balayages
(90 mesures) ont chacun leur `clientWidth` vérifié individuellement dans la sortie brute — tous
corrects. Il est cité ici parce que la mission demande explicitement de ne jamais taire ce genre
d'incident.

**Méthode** (pour que la mesure soit reproductible) : les 29 écrans de la nav sont atteints par
`click()` réel sur chaque `<a>` de `<nav>` (pas par rechargement de page, qui aurait multiplié par
30 le temps et le risque de collision sur le navigateur partagé), avec 300–350 ms d'attente après
chaque clic. Pour chaque écran, à chaque largeur : `document.documentElement.scrollWidth >
clientWidth` (débordement horizontal), balayage de tous les `td/th/span/div` de `<main>` avec
`text-overflow: ellipsis` et `overflow ≠ visible` dont `scrollWidth > clientWidth` (troncature
réelle, pas supposée), et bornes du contenu direct de `<main>` rapportées à `<main>` (proxy de
remplissage horizontal/vertical). `/stock/inventaire` a été mesuré séparément par navigation directe
(absent de la nav). Zéro appel d'écriture à aucun moment : navigation et lecture seules.

---

## 2. Les défauts, triés par ce que le porteur perd

### Rang 1 — Rien : aucun nombre tronqué, nulle part, à aucune largeur

**0 cas** sur 90 combinaisons. Toutes les cellules numériques (montants, quantités, pourcentages,
seuils légaux) restent entières aux trois largeurs, y compris dans les tableaux les plus denses
(Stock — 17 ingrédients, colonnes Stock/Valeur/Seuil/DLC/Statut — capture prise à 1280, aucune
troncature, alignement décimal correct) et dans le panneau Seuils légaux du tableau de bord
(pourcentages `3 %` / `4 %` / `1 %` / `0 %` entiers aux trois largeurs). C'est le critère le plus
sévère de la mission et celui qui tient le mieux.

### Rang 2 — Rien : aucun débordement horizontal, nulle part, à aucune largeur

**0 cas** sur 90. `scrollWidth > clientWidth` n'a jamais été vrai, sur aucun des 30 écrans, à
aucune des 3 largeurs — vérifié deux fois (tolérance souple puis tolérance stricte, zéro pixel de
marge) pour ne pas manquer un cas limite. Aucune page ne défile latéralement.

### Rang 3 — Information réellement perdue, mais jamais un nombre : deux écrans, texte seulement

**`/parametres` — persiste aux trois largeurs.** La colonne « EN VIGUEUR » du tableau des 123
paramètres tronque les valeurs textuelles longues (citations de source légale, JSON de motifs,
identifiant de modèle IA) avec `…`, à toutes les largeurs testées :

| Largeur | Cellules tronquées                                                                             | Largeur de colonne réelle |
| ------- | ---------------------------------------------------------------------------------------------- | ------------------------- |
| 1280    | **9** (dont l'en-tête « Versions », `claude-haiku-4-5-20251001`, et 7 textes de source légale) | 127 px                    |
| 1920    | **6** (les 7 textes de source légale moins un qui rentre désormais)                            | 255 px                    |
| 2560    | **6** (identiques à 1920)                                                                      | 383 px                    |

Exemple concret, jamais lisible en entier dans le tableau à aucune des trois largeurs : la source
légale d'`echeance_e604b_source_legale` — « À déposer avant le 15 décembre en cas de dépasse[ment]…
» (536 px de contenu texte réel contre 383 px de colonne au maximum testé, 2560 px de large). La
colonne grandit avec la fenêtre (127 → 255 → 383 px, proportionnel) mais jamais assez pour des
phrases complètes : ce n'est pas un défaut qui disparaît en élargissant l'écran, c'est un plafond de
largeur de colonne indépendant de la résolution. **Aucun nombre n'est concerné** — uniquement des
textes explicatifs — et le texte complet reste accessible en cliquant la ligne (panneau « Fiche du
paramètre »), donc l'information n'est pas perdue, seulement cachée derrière un clic supplémentaire
non signalé visuellement dans la cellule elle-même.

**`/prochaine-session` — seulement à 1280, résolu à 1920 et 2560.** Le tableau « D'où vient ce
chiffre » tronque 3 des 4 lignes de facteurs à 1280 (« Météo — ensoleillé et chaud, 26 °C —
prior, ja… », « Saison — non modélisée — historique trop co… », « Tendance — non modélisée —
encore 1/10 ses… ») — capture à l'appui. **0 cellule tronquée à 1920 et à 2560.** Là encore, la
colonne numérique adjacente (« × 0,90 », « × 1,00 ») n'est jamais touchée : seul le texte explicatif
raccourcit.

**Tableau de bord — une troncature d'un pixel, à 1280 seulement, sous le seuil de tolérance
normal.** L'en-tête « Marge nette » du tableau « Dernières sessions » affiche « Marge net… » à 1280
(capture à l'appui) alors que la mesure DOM stricte donne `clientWidth: 99, scrollWidth: 100` — un
seul pixel d'écart, sous l'arrondi entier de `scrollWidth`/`clientWidth`, invisible à une tolérance
de mesure de ±1 px mais bien visible à l'œil sur la capture. **Résolu à 1920 et 2560** (l'en-tête
s'affiche en entier, capture à l'appui) : la mise en page à 2 colonnes de 1280 serre cette colonne
plus qu'à 3 colonnes. Cas limite, cité pour être honnête sur ce qu'un détecteur automatique à
tolérance non nulle peut manquer — c'est exactement le genre d'écart qu'une capture d'écran révèle
et qu'une mesure DOM seule aurait laissé passer.

**27 écrans sur 30 : zéro troncature à toutes les largeurs**, y compris les tableaux les plus
chargés en colonnes (Stock, Sessions, Production, Journal d'audit, Ingrédients, Comptabilité).

### Rang 4 — Aucune mise en page cassée trouvée

Sur les 11 captures d'écran effectivement regardées à l'œil (liste en §5), aucun chevauchement,
aucun élément hors cadre, aucun contrôle inatteignable. Les boutons d'action (« Nouvelle dépense »,
« Enregistrer une réception », « Générer les commandes », etc.) restent à leur place et cliquables
aux trois largeurs sur tous les écrans capturés.

---

## 3. La place morte à 1440 — le défaut que le porteur a signalé et que personne n'avait cherché

**Confirmé, mesuré, et plus grave à mesure que la résolution grandit — exactement l'inverse de ce
que la doctrine précédente supposait.**

Le Tableau de bord (`TableauDeBord.tsx`, **modifié en ce moment par un autre agent** — grille bento
en cours de pose, donc chiffres transitoires par construction) affiche aujourd'hui :

| Largeur | Largeur de contenu utilisée | Hauteur de contenu utilisée                | Lecture                                                                                                                                                                                                                                  |
| ------- | --------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1280    | 97 %                        | **140 %** (déborde, défilement nécessaire) | tout tient, avec marge de manœuvre en dessous, pas au-dessus                                                                                                                                                                             |
| 1920    | 99 %                        | **74 %**                                   | ~26 % de la hauteur d'écran vide sous la dernière rangée de cartes                                                                                                                                                                       |
| 2560    | 99 %                        | **53 %**                                   | **~47 % de la hauteur d'écran vide** — capture à l'appui : le contenu s'arrête net après « Palmarès produits / Palmarès fournisseurs / Meilleurs lieux de marché », le reste de l'écran est le canevas gris nu, sans carte, sans message |

**Ce que ceci confirme et ce que ceci infirme du signalement du porteur (écran mesuré à 2 552 px
CSS, « la moitié gauche seulement, toute la moitié basse vide »).** La composante **largeur** ne se
reproduit plus à l'instant de cette mesure : le contenu occupe 97–99 % de la largeur aux trois
tailles (la grille passe de 2 colonnes à 1280 à 3 colonnes à 1920/2560, donc la largeur, elle,
s'utilise). Cela suggère que l'agent qui pose la grille bento **a déjà en partie corrigé** l'aspect
largeur depuis le signalement. **La composante hauteur, elle, est intacte et s'aggrave avec la
résolution** : passer de 1920 à 2560 ne fait qu'ajouter du vide (74 % → 53 % utilisé), parce que le
tableau de bord est un ensemble **borné** de cartes à nombre fixe (« Dernières sessions » plafonne à
quelques lignes avec un lien « Voir toutes les sessions », « Palmarès » liste un nombre fixe
d'entrées) — sa hauteur absolue en pixels ne grandit pas avec la fenêtre, contrairement à un
tableau qui s'allongerait avec plus de lignes. **C'est structurel, pas un artefact de jeu de
données de démonstration** : même avec des années de sessions réelles, ce plafond de cartes ne
grandirait pas.

**Distinction importante faite en cours d'audit, pour ne pas crier au loup partout** : plusieurs
autres écrans affichent eux aussi une part de hauteur utilisée qui décroît avec la résolution
(`/qualite-modele` : 30 % → 18 % → 14 %, `/achats` : 52 % → 35 % → 26 %, `/menus` : 71 % → 48 % →
36 %). **Vérifié par capture d'écran sur ces trois cas précis : ce ne sont pas des défauts, ce sont
des états vides conformes à `docs/07` §4.7** (« Aucune prévision archivée » avec titre + phrase +
un bouton d'action pour Qualité du modèle ; « Aucune commande enregistrée » pour Achats ; « 0 sur 0
menus » pour Menus) — la base de démonstration est jeune (aucune commande d'achat, aucun menu
déclaré) et ces écrans se rempliront avec l'usage réel, sans changement de code. **Le tableau de
bord est différent parce qu'il a du contenu réel non vide** (une session réelle, 7 alertes de
stock, un palmarès) et **laisse quand même du vide en dessous** : c'est la différence entre
« il n'y a pas encore de données » (correct) et « il y a des données mais l'écran ne s'en sert pas
pour remplir l'espace disponible » (le défaut signalé).

**Comptabilité, l'autre écran en chantier, ne montre PAS ce défaut** — voir bonne nouvelle en §4.

---

## 4. Ce qui tient parfaitement aux trois largeurs

**`Comptabilite.tsx`** (également en cours de modification par un autre agent — geste de verrouillage
de période en préparation, donc chiffres transitoires) est, à l'instant mesuré, l'écran le
**mieux** comporté des 30 aux trois résolutions : 0 débordement horizontal, 0 troncature, et un
remplissage vertical qui reste élevé même à 2560 (222 % à 1280 → 135 % à 1920 → **98 % à 2560**,
capture à l'appui — la page utilise presque exactement la hauteur disponible, sans vide en dessous,
parce que ses tableaux (Synthèse, Journaux, Ventes par créneau, Échéancier, Dépenses,
Immobilisations, Périodes) s'empilent en une seule colonne pleine largeur et grandissent avec le
contenu réel plutôt qu'avec des cartes à nombre plafonné). C'est l'exemple à suivre pour corriger
le Tableau de bord : une disposition en liste verticale de blocs pleine largeur, contrairement à une
grille de cartes bornées, absorbe naturellement la hauteur disponible sans laisser de vide.

**Autres bonnes nouvelles, mesurées sur les 90 combinaisons :**

- **0 débordement horizontal sur 30 écrans × 3 largeurs** — le critère le plus strict de la
  mission (« la page ne doit jamais défiler latéralement ») tient absolument partout, y compris les
  tableaux les plus larges (Stock, Sessions, Comptabilité).
- **Aucun nombre tronqué nulle part** — le critère « un nombre ne se tronque jamais » tient à
  100 % sur les 90 combinaisons.
- **La barre de navigation latérale se corrige toute seule avec la hauteur, sans aucun changement
  de code.** Le commentaire de tête de `Navigation.tsx` (lignes 129–136) documentait un débordement
  vertical mesuré de 252 px à 1280 × 720 (29 entrées, 8 sous le pli) — **confirmé au pixel près par
  cet audit** (`scrollHeight − clientHeight = 252` exactement). **À 1920 × 1080 et à 2560 × 1440,
  ce débordement disparaît complètement (0 px)** : les 29 entrées tiennent sans défilement dès que
  la hauteur dépasse 720 px. C'est un point neuf, jamais mesuré avant cet audit : le défaut documenté
  n'existe qu'à la plus petite des trois résolutions cibles.
- **0 erreur console** sur l'ensemble de la session de mesure (30 écrans × 3 largeurs, plus les
  passages de vérification stricte) — aucune exception JavaScript déclenchée par le redimensionnement
  ou la navigation.
- **Les états vides suivent la doctrine et résistent à la résolution** : les trois cas vérifiés par
  capture (`/qualite-modele`, `/achats`, `/menus`) gardent leur carte titre + phrase + action, sans
  s'étirer ni se déformer, aux largeurs testées.

---

## 5. Ce que cet audit ne couvre pas

- **Deux écrans sur trente sont mesurés en plein chantier.** `TableauDeBord.tsx` et
  `Comptabilite.tsx` sont modifiés par d'autres agents pendant cette mission. Chaque nombre donné
  ici pour ces deux écrans est un instantané daté (01/08/2026, mesuré dans l'après-midi) : il peut déjà
  être faux au moment de la lecture de ce document. Ne pas les traiter comme un verdict final, y
  compris la bonne nouvelle sur Comptabilité.
- **Vision réelle sur 11 captures seulement, sur 90 combinaisons.** Le reste (79 combinaisons)
  repose sur des mesures DOM automatiques (`scrollWidth`, `clientWidth`, bornes de `<main>`), pas sur
  un œil humain ou une capture regardée. La mesure DOM est fiable pour détecter un débordement ou
  une troncature CSS réelle, mais ne verrait pas un défaut purement visuel qui ne change aucune
  largeur/hauteur de boîte : contraste insuffisant, icône mal alignée de quelques pixels,
  chevauchement `z-index` sans changement de taille, texte lisible mais mal contrasté. Les 11
  captures ont été choisies pour couvrir : les deux écrans en chantier (3 largeurs chacun), les deux
  écrans avec troncature réelle détectée, et un échantillon d'écrans « propres » pour vérifier que
  l'absence de signal automatique correspond bien à un écran réellement propre à l'œil (Stock,
  Qualité du modèle, Achats, Menus) — pas les 19 écrans « propres » restants.
- **Aucun état interactif testé.** Menus déroulants ouverts, infobulles, palette de commandes
  (`Ctrl+K`), modales, panneau « Fiche du paramètre » ouvert, formulaires en cours de saisie : tout
  a été mesuré au repos, page chargée, rien cliqué d'autre que la navigation elle-même. Un
  chevauchement qui n'apparaît qu'un menu déroulant ouvert ne serait pas vu ici.
- **Aucune donnée de volume réel.** La base est celle du seed de démonstration
  (`db:seed` + `db:seed:demo` — 17 ingrédients, 1 session clôturée, 0 commande d'achat, 0 menu
  déclaré). Un Stock à 200 ingrédients ou un Journal d'audit avec deux ans d'historique n'ont pas été
  simulés : `docs/07` interdit la pagination et ne prévoit la virtualisation que pour le journal des
  mouvements — un tableau très long à 1280 reste à tester avec un volume réel avant de conclure qu'il
  tiendra aussi bien que les tableaux courts mesurés ici.
- **Une seule combinaison logicielle.** Chromium via Playwright, un seul `devicePixelRatio` (1,25,
  celui de cette machine) — jamais 1,0 ni 1,5, jamais Firefox, jamais le zoom navigateur (`Ctrl` +
  molette) indépendamment de la mise à l'échelle Windows, jamais une largeur intermédiaire (1366,
  1440 de large, 3440 ultra-wide) ni l'orientation portrait.
- **Aucun export testé.** PDF (Playwright/Chromium côté serveur), Excel, Word : hors du périmètre
  résolution-écran de cette mission, non regardés ici.
- **Le tri de gravité (§2) est celui de cet audit, pas un jugement définitif du porteur.** Il suit
  l'ordre demandé par la mission (nombre tronqué > débordement > place morte > mise en page cassée)
  croisé avec ce qui a réellement été trouvé ; mais la place morte du tableau de bord, bien que
  classée sous les troncatures textuelles dans cet ordre mécanique, est probablement ce qui compte
  le plus pour le porteur puisque c'est lui qui l'a repérée en premier — d'où sa section dédiée en
  §3 plutôt qu'une simple ligne de tableau.
