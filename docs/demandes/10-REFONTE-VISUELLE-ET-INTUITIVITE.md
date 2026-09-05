# 10 — Refonte visuelle et intuitivité générale

## Constat

Demande transverse : rendre l'application plus lisible, plus belle, la plus intuitive
possible, avec un maximum d'information utile regroupée au même endroit, et une capacité à
croiser un maximum de données pour affiner les prévisions. Ce n'est pas une fiche de bug —
c'est une revue de cohérence à mener une fois les fiches 01 à 09 posées, pour vérifier que
l'ensemble reste un système lisible et pas une collection d'écrans ajoutés au fil de l'eau.

## Vérifier l'existant avant de coder

Relire `docs/06-UI-ET-PARCOURS.md` dans son intégralité et vérifier, écran par écran, si
l'implémentation actuelle respecte encore ses principes après l'ajout des fiches 04, 05, 06,
08, 09, 11, 12 — en particulier la règle « densité plutôt qu'espace » et « le chiffre avant
le graphique ». Un module ajouté isolément dérive facilement du style du reste.

## Ce qui doit changer

### Cohérence

- Un seul système de composants (boutons, tableaux, badges de statut, formulaires) réutilisé
  partout — pas de style ad hoc par écran ajouté au fil des fiches.
- Les nouveaux écrans (Concurrents, Économies d'achat, Échéances, Besoins projetés,
  Profils utilisateurs) s'intègrent dans la navigation existante
  (`docs/06-UI-ET-PARCOURS.md` §« Navigation ») sans la surcharger — regrouper plutôt
  qu'empiler des entrées de menu.

### Regroupement de l'information

- Le tableau de bord reste le point d'entrée unique qui répond à « qu'est-ce que je dois
  faire à venir ? », sur un horizon **choisi par l'utilisateur** plutôt que figé : un
  sélecteur propose 7 jours, 15 jours, 30 jours (par défaut), 3 mois, 6 mois, 1 an — un
  seuil de stock, une échéance administrative ou un pic de demande peuvent se préparer bien
  avant qu'ils ne deviennent urgents (voir fiche 06, besoins projetés), et l'utilisateur
  doit pouvoir zoomer sur l'horizon qui l'intéresse sans changer d'écran. Chaque nouveau
  module y ajoute un encart seulement s'il produit une alerte actionnable dans l'horizon
  sélectionné — pas un résumé décoratif de plus.
- Croisement explicite des données déjà présentes plutôt que des écrans cloisonnés :
  exemple, l'écran Prochaine session doit pouvoir afficher en un clic les prix concurrents
  du moment (fiche 08) à côté de la carte propre, ou l'écran Comptabilité doit pouvoir
  renvoyer directement vers l'économie d'achat du mois (fiche 12) sans re-saisie.

### Lisibilité

- Contraste et taille de police vérifiés aux deux résolutions cibles (fiche 02).
- Statuts (conforme / alerte / dépassement) toujours signalés par la même couleur et le même
  symbole dans toute l'application — jamais réinventés module par module.
- Aucun texte d'aide ou de tooltip qui explique ce qu'un chiffre calculé _devrait_ vouloir
  dire sans expliquer _comment_ il a été obtenu — dans l'esprit déjà posé pour l'écran
  Prochaine session (décomposition des facteurs affichée, pas seulement le résultat).

## Ce qui doit être relié

Cette fiche n'introduit pas de nouvelle donnée : elle audite et corrige la cohérence entre
tous les écrans produits par les fiches précédentes. À traiter en dernier, une fois les
fiches fonctionnelles posées, pour ne pas polir une interface qui va encore bouger.

## Critère de fin

Revue croisée de tous les écrans (existants + nouveaux) contre `docs/06-UI-ET-PARCOURS.md`,
avec une liste des écarts corrigés consignée dans `docs/05-DECISIONS.md` si un principe du
document devait être ajusté en cours de route.

---

## Vérification du 01/08/2026 — confronté au code réel, dans les deux sens

### 0. Trois corrections du porteur, à intégrer à cette fiche

Le porteur a corrigé le 01/08/2026 la cible de résolution de `docs/07-DOCTRINE-ERP-ET-DESIGN.md`
§4.4, et posé deux règles neuves sur le tableau de bord. Les trois touchent directement le
« Ce qui doit changer » de cette fiche :

- **Cible de résolution corrigée.** `docs/07` §4.4 disait « concevoir pour 1280 × 720, jamais
  pour 1920 × 1080 » — **c'est faux**, appliqué à tort toute la journée du 01/08 selon la
  correction du porteur elle-même, déjà écrite dans `docs/07` : « la cible de visibilité est
  **1080p** mais **responsive pour 100 % de l'app** — l'app doit s'adapter à mes écrans :
  **1280, 1080 et 1440** ». La cible de conception est donc **1920 × 1080**, avec pleine
  utilisabilité sur les trois résolutions réelles du porteur (1280 de large, 1920 × 1080,
  2560 × 1440). Ce qui reste vrai : la mise à l'échelle Windows (125/150 %) fausse la mesure
  d'un viewport si on croit la taille demandée plutôt que
  `document.documentElement.clientWidth`. Cette fiche (§4.4 déjà présent dans `docs/07`, pas
  dupliqué ici) devient donc la seule preuve possible qu'une mise en page tient — et
  `docs/07` le dit lui-même : **aucun test de rendu multi-résolution automatisé n'existe
  dans le dépôt à ce jour** (voir §3 ci-dessous).
- **Le tableau de bord est un cockpit.** Règle du porteur, en toutes lettres : « le tableau de
  bord reprend les informations résumées et affichées **comme un cockpit d'avion** afin
  d'avoir **toutes les données sous la main au même endroit** ». Cela contredit un principe
  que cette même fiche pouvait laisser croire général — « chaque écran fait une chose »
  (`CLAUDE.md` §0) — qui reste vrai pour les écrans de **saisie** (clôture de session) mais ne
  s'applique **pas** au tableau de bord, écran de **lecture** par excellence : la densité y est
  une qualité, pas une dette, et un ajout ne doit jamais être refusé au seul motif de la
  place — la bonne question est « est-ce que ça se lit d'un coup d'œil ? », pas
  « est-ce que ça tient ? ».
- **Affichage en grille bento pleine page.** Règle du porteur, juste après la précédente :
  « l'affichage du tableau de bord tu peux mettre cela sous forme de **bento** avec des cases
  qui prennent l'ensemble de la taille de la page ». C'est de la structure de mise en page,
  pas de l'habillage visuel (le porteur distingue explicitement les deux, et reporte
  l'habillage façon Big Ambition à plus tard).

### 1. Ce que la fiche demande est FAIT, largement, sur le tableau de bord

Vérifié directement dans `apps/web/src/pages/TableauDeBord.tsx` :

- **Grille bento réelle** : conteneur `grid grid-cols-1 items-start gap-bloc lg:grid-cols-2
2xl:grid-cols-12` — une seule colonne en dessous de `lg`, deux colonnes à partir de `lg`,
  et une vraie grille de 12 pleine largeur à partir de `2xl`. Les panneaux y portent des
  largeurs variables (`2xl:col-span-12` pour la bannière « Avant de commencer » en pleine
  largeur, `2xl:col-span-6` pour « Seuils légaux », etc.) — « des cases de tailles variables,
  pas des colonnes égales », conforme à la règle du porteur. Les commentaires du fichier
  citent explicitement « mission « bento » du porteur, 01/08/2026 ».
- **Horizon choisi par l'utilisateur** : `SelecteurHorizon`, exactement les six options
  demandées par cette fiche — 7, 15, 30 (défaut), 90 (3 mois), 180 (6 mois), 365 jours (1 an)
  — logé dans le panneau « Achats à anticiper » plutôt que dans l'en-tête général (décision
  documentée : un sélecteur à côté du `<h1>` se lirait comme un contrôle de l'écran entier
  alors qu'il n'en gouverne que deux encarts sur huit).
- **Nouveaux écrans intégrés à la navigation existante, regroupés** : `Concurrents`,
  `Besoins projetés`, `Économies d'achat` figurent chacun dans un groupe existant de
  `composants/Navigation.tsx` (Prévision, Référentiel, Comptabilité) — aucune entrée à plat,
  aucun groupe surchargé.
- **Croisement explicite des données déjà présentes**, les deux exemples cités littéralement
  par cette fiche sont réalisés :
  - « Prochaine session » affiche les prix concurrents du moment
    (`ProchaineSession.tsx`, panneau dépliant « Prix concurrents », fiche 08) ;
  - « Comptabilité » renvoie vers l'économie d'achat du mois sans re-saisie
    (`Comptabilite.tsx`, fonction `cheminEconomiesDuMois`, bouton « Économies → »).
- **Statuts uniformes** : `GLYPHE_STATUT`/`CLASSE_TEXTE_STATUT` réutilisés à l'identique dans
  tous les écrans consultés pendant cette vérification, jamais réinventés par écran.

### 2. Ce que l'application fait EN PLUS de ce que demande la fiche

Le tableau de bord regroupe aujourd'hui bien plus que les cinq encarts imaginés au moment
d'écrire cette fiche : palmarès (recettes, produits, menus, fournisseurs), propositions IA
d'événements, météo (renvoyée vers Prochaine session plutôt que dupliquée), 3 meilleurs
lieux de marché, factures impayées, objectifs et succès, écart prévu/réalisé par session,
budget IA en pied de page discret — une extension cohérente avec la règle du cockpit
ci-dessus, largement au-delà du contenu que cette fiche décrivait à l'origine.

### 3. Ce qui manque à l'app, et ce qui n'est PAS mesurable aujourd'hui

Cette fiche est la seule des cinq à décrire un **processus continu** (« une revue de
cohérence à mener une fois les fiches 01 à 09 posées »), pas un livrable ponctuel — sa
vérification a donc une limite différente des quatre autres.

**a. Le critère de fin littéral de la fiche n'a pas de livrable unique identifiable.** Il
demande « une revue croisée de tous les écrans... avec une liste des écarts corrigés
consignée dans `docs/05-DECISIONS.md` ». Vérifié : `docs/05-DECISIONS.md` compte 89 décisions
(D-001 à D-089), aucune n'est intitulée comme une revue transverse de cohérence visuelle —
les corrections de cohérence trouvées pendant cette vérification (largeurs de colonnes,
alignement, statuts, cockpit) sont réparties en petites décisions ponctuelles
(ex. D-081 largeurs de colonnes, D-084 le même défaut sur le papier) ou en commentaires de
mission dans le code lui-même, jamais consolidées en une liste unique et datée comme le
critère de fin le demande littéralement.

**b. Aucun test de rendu multi-résolution automatisé n'existe**, et `docs/07` §4.4 le dit
lui-même en toutes lettres : le critère de fin de la fiche 02 (captures automatisées aux
trois résolutions) est devenu, après la correction du 01/08, « la seule preuve possible
qu'une mise en page tient » — et cette preuve n'existe pas encore dans le dépôt. Ce que j'ai
trouvé de plus proche : deux captures manuelles, `sorties/dashboard-avant-1440p.png` et
`sorties/dashboard-apres-1440p.png`, qui documentent un seul écran à une seule résolution, pas
une suite reproductible sur 1280/1920/2560.

**c. La mission « bento » et la mission « cockpit » de tableau de bord n'ont pas de décision
consignée dans `docs/05-DECISIONS.md`.** Elles sont documentées en profondeur dans le code
(commentaires de tête de `TableauDeBord.tsx`, missions « bento » et « finir le tableau de
bord » datées du 01/08/2026), mais D-089 (01/08/2026) est la dernière entrée du journal de
décisions et elle porte sur le moteur de prévision, pas sur cette refonte. Le changement de
cible de résolution, lui, est bien consigné — mais dans `docs/07` §4.4 directement, pas dans
`docs/05-DECISIONS.md`.

**d. Le pont Comptabilité → Économies n'est pas complètement bouclé.** Vu depuis fiche 10
(« l'écran Comptabilité doit pouvoir renvoyer directement vers l'économie d'achat du mois...
sans re-saisie ») : `Comptabilite.tsx` construit bien l'URL `cheminEconomiesDuMois(annee,
mois)`, mais `Economies.tsx` (hors zone d'écriture de la mission qui a posé ce pont) ne lit
aujourd'hui **aucun paramètre d'URL** — ni `useSearchParams`, ni lecture de `annee`/`mois` au
montage — et retombe systématiquement sur l'année civile en cours. Le lien atterrit sur le
bon écran ; il n'y filtre pas encore sur le bon mois.

**e. « Un seul système de composants réutilisé partout » n'a pas été vérifié de façon
exhaustive.** Les composants partagés (`Panneau`, `Tableau`, `EtatVide`) sont bien réimportés
dans tous les écrans ouverts pendant cette vérification, ce qui est un signe favorable, mais
aucun balayage systématique des ~45 pages de `apps/web/src/pages` n'a été fait pour
confirmer l'absence totale de style ad hoc — voir §6 du rapport (ce que cette vérification
ne couvre pas).
