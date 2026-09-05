# 22 — Sweep du focus détruit au rechargement (suite de D-079)

> Audit en LECTURE SEULE, mené le 31/07/2026 pendant que cinq autres agents corrigeaient en
> parallèle `Produits.tsx`, `Economies.tsx`, `Stock.tsx`, `saisie-stock/**`, `Sessions.tsx`,
> `Recettes.tsx`, `Menus.tsx`. Chaque constat ci-dessous a été relu au moment de l'écrire — voir
> l'horodatage de méthode. Aucun fichier `.ts`/`.tsx` n'a été modifié.

## 1. Méthode de dérivation, avec les commandes

Le réflexe interdit par D-045 est d'énumérer les écrans « à la main ». Voici donc, dans l'ordre,
les commandes qui ont produit la liste de candidats — pas une liste tapée de mémoire.

1. **Repérer le motif exact du correctif déjà posé**, pour savoir quoi chercher :
   `Grep "rechargerEcheancesEnArrierePlan" apps/web/src/pages/Comptabilite.tsx` (contexte ±15
   lignes) — a donné le patron de référence : un rechargement sain écrit `{ statut: 'pret',
lignes }` **directement**, sans jamais réémettre `{ statut: 'chargement' }`.

2. **Lister tous les écrans qui possèdent l'état `'chargement'`**, sans restriction de nom de
   fichier :
   `Grep "statut:\s*'chargement'\s*\}\)" apps/web/src` (via le motif d'appel
   `setEtat\w*\(\{ statut: 'chargement' \}\)`) → **34 sites d'appel, dans 20 fichiers**.
   Complété par `Grep "'chargement'" apps/web/src` (sans restriction de forme) → **30 fichiers**
   au total portent le littéral (les 10 en écart n'ont qu'une déclaration de type jamais
   réémise en dehors de l'état initial).

3. **Pour chaque site trouvé**, remonter à la fonction qui l'englobe
   (`Grep "function charger|function recharger|EnArrierePlan" apps/web/src`, puis lecture du
   fichier), puis chercher **tous les appelants** de cette fonction
   (`Grep "nomDeLaFonction\(\)" <fichier>`), pour trancher : premier chargement (sélection d'un
   élément différent, changement de filtre/année/horizon) ou rechargement d'arrière-plan
   (déclenché par une écriture pendant que l'écran affiché reste le même) ?

4. **Pour chaque rechargement d'arrière-plan**, lire le rendu JSX pour établir si le nœud qui
   vient de recevoir l'action (bouton, champ) est **à l'intérieur** ou **à l'extérieur** du
   sous-arbre gardé par `statut === 'pret'` :
   - à l'extérieur (bouton d'en-tête, formulaire d'ajout dans un panneau frère) → le
     démontage du `<Tableau>` voisin ne touche pas le focus : **sain**, avec ou sans `.focus()`
     explicite.
   - à l'intérieur (bouton de ligne, panneau de détail lui-même gardé par le même `statut`)
     → le geste qui déclenche le rechargement démonte le nœud qui portait le focus :
     **défaut réel**, sauf `.focus()` explicite posé AVANT le rechargement (patron
     `boutonNouvelleDepense.current?.focus(); chargerDepenses();`).

5. **Recherche ciblée des actions de ligne** (pour ne pas dépendre uniquement de l'étape 3) :
   recherche de `onClick=`, `onChange=`, `onBlur=` à proximité de `rendu:` dans les définitions
   de colonnes de `<Tableau>`, sur `pages/*.tsx` et `saisie-stock/*.tsx` — a fait remonter les
   candidats qui ne seraient pas apparus par simple lecture des noms de fonctions
   (`Corriger le coût du lot` dans `Factures.tsx`, `Rattacher un lieu`/`Écarter` dans
   `Opportunites.tsx`, `Valider`/`Rejeter` dans `PropositionsEvenements.tsx`).

6. **Chaque candidat retenu a été revérifié en relisant le fichier une dernière fois juste avant
   d'écrire la ligne le concernant** (consigne du donneur d'ordre) — voir §2, dernière relecture
   horodatée juste avant la rédaction de ce document pour les trois défauts réels.

Aucune commande destructive n'a été utilisée. Pas de `npm run db:reset`, pas d'écriture sur
`donnees/batte.sqlite`, pas de `npm run build`, aucun process node touché.

## 2. Les trois défauts réels trouvés, par coût décroissant

### 2.1 — `Stock.tsx` / `saisie-stock/DetailLot.tsx` — le plus coûteux, potentiellement déjà en cours de correction

**`apps/web/src/pages/Stock.tsx:684-690` (`ecritureSurLot`)** appelle `rafraichir()`
(`Stock.tsx:619`, qui incrémente `revision`, `Stock.tsx:508`) **sans poser de `.focus()`
avant** — à comparer avec `sortieEnregistree` (`Stock.tsx:747-757`) qui, elle, appelle
`requestAnimationFrame(() => boutonSortir.current?.focus())` avant le même `rafraichir()`.

`revision` est une dépendance de l'effet qui charge les lots de l'ingrédient sélectionné
(`Stock.tsx:561-583`), lequel écrit `setEtatLots({ statut: 'chargement' })`
(`Stock.tsx:568`) **inconditionnellement** dès que l'effet se redéclenche — que ce soit pour un
changement d'ingrédient sélectionné (légitime) ou pour un simple bump de `revision` sur le
**même** ingrédient (illégitime).

Le rendu (`Stock.tsx:961-1006`) place `<DetailLot>` **à l'intérieur** de
`{etatLots.statut === 'pret' && (...)}`, avec le `<Tableau>` des lots juste au-dessus. `ecritureSurLot`
est passée à `<DetailLot>` comme prop `onEcriture` (`Stock.tsx:1001`), et déclenchée depuis
**l'intérieur même de `DetailLot`** :

- `appliquerStatut()` (`saisie-stock/DetailLot.tsx:243-300`, bouton « Changer le statut… ») ;
- `contrepasser()` (`saisie-stock/DetailLot.tsx:308-339`, formulaire de contrepassation d'un
  mouvement).

**Ce que l'utilisateur perd concrètement** : après avoir mis un lot en quarantaine ou
contrepassé un mouvement erroné, le `<Tableau>` des lots ET tout le panneau `<DetailLot>` — y
compris le bouton ou le champ motif qui venait de recevoir l'action — sont démontés puis
reconstruits. Sur un contrôle de stock où plusieurs lots sont corrigés à la suite (le cas
d'usage documenté par le commentaire même de la fonction, `Stock.tsx:677-683` : « le lot reste
ouvert — on vient d'agir dessus, le refermer obligerait à le rouvrir »), l'utilisateur doit
retraverser le menu latéral après **chaque** correction avant de pouvoir corriger le lot suivant.
Le commentaire affirme une intention (« le lot reste ouvert ») que le mécanisme ne tient pas :
`lotSelectionneId` survit, donc le même lot se rouvre bien, mais dans une **instance neuve** de
`<DetailLot>`, sans rien qui y repose le focus.

En interne, `saisie-stock/DetailLot.tsx:189-214` reproduit une seconde fois le même schéma pour
sa propre liste de mouvements (`etatMouvements`, dépendance `[lot.id, revision]`, `revision`
local à `DetailLot`) — mais l'effet dominant, celui qui démonte tout le composant, est celui de
`Stock.tsx`.

**Pas de `.focus()` de rattrapage** dans `ecritureSurLot`, `appliquerStatut` ni `contrepasser` —
contrairement à `sortieEnregistree` dans le même fichier, qui montre que le réflexe est connu
mais n'a pas été appliqué ici.

**Important pour la suite** : « Stock » est l'un des cinq écrans **originellement reproduits**
dans D-079 (« Stock, Menus, Comptabilité (deux cas), Factures »), mais **n'est pas** dans la
liste des trois écrans corrigés. `Stock.tsx` et `saisie-stock/**` sont explicitement listés comme
en cours d'édition parallèle au moment de cet audit — ce défaut est donc très probablement **déjà
la cible en cours** d'un des cinq agents. Relu une dernière fois juste avant rédaction
(`Stock.tsx:559-583`, `677-690` ; `saisie-stock/DetailLot.tsx:169-183`) : toujours présent à cet
instant. **À revérifier avant toute action** — il peut être corrigé entre cette lecture et la
lecture de ce rapport.

### 2.2 — `Factures.tsx` — `corrigerCoutLot`, répétitif à l'échelle d'une facture

**`apps/web/src/pages/Factures.tsx:474-487` (`corrigerCoutLot`)** appelle
`chargerDetail(etatDetail.detail.id)` (`Factures.tsx:480`) après succès, **sans `.focus()`
préalable**. `chargerDetail` (`Factures.tsx:346-371`) est la **même** fonction utilisée pour le
premier chargement du détail à la sélection d'une facture différente : elle écrit
`setEtatDetail({ statut: 'chargement' })` (`Factures.tsx:348`) avant l'aller-retour réseau.

Le bouton « Corriger le coût du lot » vit **dans** la colonne `action` de `colonnesLignes`
(`Factures.tsx:547-566`), elle-même dans le `<Tableau>` du détail de facture
(`Factures.tsx:689-694`), lui-même dans le bloc `{detailCourant !== null && (...)}`
(`Factures.tsx:648`) — et `detailCourant` redevient `null` dès que `etatDetail.statut` quitte
`'pret'` (`Factures.tsx:492-493`). Autrement dit : cliquer ce bouton démonte **tout le panneau
de détail de la facture** (en-tête, statut, lignes, pièce jointe, changement de statut,
annulation), pas seulement la ligne cliquée.

**Ce que l'utilisateur perd concrètement** : une facture peut porter plusieurs lignes en écart de
coût (`resoudreEcartLigneFacture(l).type === 'ecart'`, `Factures.tsx:553`). Corriger la première
ligne fait disparaître et réapparaître tout le panneau ; pour corriger la deuxième ligne en
écart, il faut retraverser le menu latéral pour revenir sur l'écran Factures avant de pouvoir
cliquer le bouton suivant.

**Contraste dans le même fichier** : `appliquerChangementStatut()` (`Factures.tsx:423-445`)
écrit `setEtatDetail({ statut: 'pret', detail: detailMisAJour })` **directement**
(`Factures.tsx:435`), sans jamais transiter par `'chargement'` — la bonne pratique existe déjà
dans ce fichier, mais n'a pas été reprise pour `corrigerCoutLot`.

**Défaut jumeau, coût moindre (action rare, pas répétitive)** : `annulerFactureSelectionnee()`
(`Factures.tsx:447-472`) appelle elle aussi `chargerDetail(detail.id)` (`Factures.tsx:465`),
même mécanisme, mais l'annulation d'une facture est un geste unique par facture, pas une boucle
de correction ligne par ligne.

Relu juste avant rédaction (`Factures.tsx:474-487`) : inchangé. `Factures.tsx` n'est **pas** dans
la liste des cinq fichiers en cours d'édition parallèle — ce constat est stable.

### 2.3 — `Recettes.tsx` — `changerStatut`, coût faible (action rare)

**`apps/web/src/pages/Recettes.tsx:1552-1573` (`changerStatut`)** appelle
`setRechargement((n) => n + 1)` (`Recettes.tsx:1566`) **sans `.focus()` préalable**. `rechargement`
est dépendance de l'effet de chargement du détail (`Recettes.tsx:808-841`), qui écrit
`setEtatDetail({ statut: 'chargement' })` (`Recettes.tsx:815`) inconditionnellement.

Les boutons « Activer » (`Recettes.tsx:1803`) et « Archiver » (`Recettes.tsx:1812`), qui
appellent `changerStatut`, vivent dans le panneau « Fiche technique » gardé par
`modeFiche.mode === 'consultation' && recetteActive !== null` (`Recettes.tsx:1681`), et
`recetteActive` redevient `null` dès que `etatDetail.statut` quitte `'pret'`
(`Recettes.tsx:938`). Même mécanisme que Factures : le panneau entier se démonte.

**Contraste dans le même fichier** : la sauvegarde d'une fiche (création/modification/
versionnage, `Recettes.tsx:1500-1537`) appelle
`requestAnimationFrame(() => boutonNouvelleRecette.current?.focus())` **avant** le même
`setRechargement` (`Recettes.tsx:1536-1537`) — le réflexe est présent ailleurs dans ce fichier,
mais absent de `changerStatut`.

**Ce que l'utilisateur perd concrètement** : après avoir cliqué « Activer » ou « Archiver »,
focus perdu, retour au menu latéral nécessaire. Coût réel plus faible que les deux cas
précédents : activer/archiver une recette est un geste ponctuel par recette, pas une boucle
répétée dans la même session.

`Recettes.tsx` **est** dans la liste des fichiers en cours d'édition parallèle. Relu juste avant
rédaction (`Recettes.tsx:1552-1573`) : inchangé à cet instant — à revérifier avant action.

## 3. Faux positifs vérifiés (et pourquoi)

Chaque candidat ci-dessous a été ouvert et tracé jusqu'à l'appelant réel — pas supposé sain par
analogie.

- **`Comptabilite.tsx`** — les 6 sites (`chargerSynthese`, `chargerDepenses`,
  `chargerImmobilisations`, `chargerEcheances`/`rechargerEcheancesEnArrierePlan`,
  `chargerPeriodes`, `chargerVentesParCreneau`) sont soit déjà corrigés (échéancier, D-079), soit
  précédés d'un `.focus()` explicite sur un bouton hors du sous-arbre rechargé (dépense,
  immobilisation, réouverture de période), soit déclenchés par un changement d'année/filtre sans
  élément interactif dans les lignes (ventes par créneau — colonnes 100 % texte).
- **`Achats.tsx`** — `setEtatDetail({statut:'chargement'})` (`:356`) est un premier chargement à
  la sélection d'une commande différente ; les écritures ultérieures (réception, annulation)
  écrivent `'pret'` directement (`:471, 527, 576`), jamais de re-transit par `'chargement'`.
- **`Concurrents.tsx`** — `chargerListe`/`chargerComparateur`/`chargerDetail` sont rappelées après
  ajout d'un produit ou d'une observation, mais les formulaires de saisie rapide
  (`Concurrents.tsx:1092-1162`, `1211+`) sont des **frères** du `<Tableau>` d'historique, pas des
  enfants du bloc `'pret'` — seul l'historique (jamais focalisé au moment de l'ajout) se
  démonte.
- **`NomenclatureVente.tsx`** et **`Menus.tsx`** — même architecture : le panneau de détail
  (formulaire + bouton « Désactiver/Réactiver ») est un panneau frère du `<Tableau>` des
  composants, jamais gardé par le même `statut`. Pour `Menus.tsx`, `etat` (liste des
  menus/produits) n'est même pas utilisé pour démonter un sous-arbre : `menus`/`produits`
  retombent simplement à `[]` via `useMemo`, sans conditionner de JSX.
- **`Objectifs.tsx`**, **`Economies.tsx`** — chaque rechargement après écriture est précédé d'un
  `.focus()` explicite sur un bouton stable (`boutonNouvelObjectif`, `champConditionnement`,
  `champIngredient`), avant l'appel au rechargement.
- **`Opportunites.tsx`**, **`PropositionsEvenements.tsx`** — les actions de ligne (`rattacherLieu`/
  `rejeter`, `valider`/`rejeter`) rappellent un `charger()`/`chargerPropositions()` qui n'écrit
  **jamais** `'chargement'` : il va directement à `'pret'`.
- **`Production.tsx`** — le détail (production sélectionnée) suit le patron premier-chargement ;
  la faisabilité (debounce sur la saisie) recalcule un panneau voisin d'un champ texte toujours
  monté, jamais l'inverse.
- **`Sessions.tsx`** — liste/seuils rechargés uniquement au montage ou après une action dont le
  focus est déjà dans un panneau d'édition séparé (clôture, annulation) ; la sélection
  d'édition/lecture-seule est un premier chargement légitime.
- **`RegistreAfsca.tsx`** — exécutions de nettoyage : le formulaire de saisie rapide est un
  panneau frère de l'historique rechargé. Amont/Aval : recherche en lecture seule, assumée comme
  telle dans le code (`RegistreAfsca.tsx:1995-1997`).
- **`SaisieReception.tsx`** — déjà corrigé (D-079) : ajout/retrait de ligne en état local, aucun
  aller-retour serveur qui retransite par `'chargement'`.
- **`TableauDeBord.tsx`**, **`PrevisionCalendaire.tsx`**, **`ProchaineSession.tsx`**,
  **`JournalAudit.tsx`**, **`Evenements.tsx`**, **`Parametres.tsx`** — écrans de consultation :
  soit le rechargement est purement navigationnel (changement d'horizon/filtre), soit l'état
  `'chargement'` n'apparaît qu'à l'initialisation et n'est jamais réémis. Aucune saisie
  répétitive au clavier n'est en jeu.
- **`Fournisseurs.tsx`, `Ingredients.tsx`, `LieuxMarche.tsx`, `ComparaisonLieux.tsx`,
  `QualiteModele.tsx`, `Equipements.tsx`, `Produits.tsx`** — un seul site `'chargement'`
  (l'état initial), jamais réémis ailleurs dans le fichier : rien à rejouer.

## 4. Ce qui n'est PAS mesuré

- Que le focus atteigne réellement le nœud visé après un `.focus()` — même limite que D-079 :
  ni jsdom ni `@testing-library/react` dans ce dépôt, rien n'observe `document.activeElement`.
  Ce document ne prouve que la **structure du démontage** (quel sous-arbre disparaît, à quel
  moment, ce qui vivait dedans), pas le comportement du navigateur lui-même.
- Le calculateur débité (`EtatCalcul`, `Recettes.tsx:878` ; faisabilité, `Production.tsx:686`) :
  examiné, jugé à faible risque par analogie (le champ tapé reste monté, seul un panneau de
  résultat voisin clignote), mais pas tracé bouton par bouton comme les trois défauts retenus.
- La couverture de `apps/web/src/composants/*.tsx` (bibliothèque partagée, `Tableau.tsx` compris)
  n'a pas été auditée pour un démontage interne indépendant de `statut` — hors du périmètre du
  motif cherché (qui est spécifiquement la transition par `'chargement'`).

## 5. Les trois dénominateurs

- **Écrans examinés** : 28 fichiers (`pages/*.tsx` + `saisie-stock/*.tsx`, hors fichiers
  `.test.tsx` et hors `saisie-stock/champs.tsx` qui n'est pas un écran) : Comptabilite, Achats,
  Concurrents, Objectifs, Production, Sessions, RegistreAfsca, Opportunites,
  PropositionsEvenements, NomenclatureVente, Menus, Economies, TableauDeBord,
  PrevisionCalendaire, ProchaineSession, JournalAudit, SaisieReception, Fournisseurs,
  Ingredients, LieuxMarche, ComparaisonLieux, QualiteModele, Equipements, Produits, Factures,
  Stock, DetailLot, Recettes, Evenements, Parametres (30 au total avec ces deux derniers).
- **Rechargements identifiés et tracés jusqu'à leur(s) appelant(s)** : 34 sites d'appel
  `setEtat\w*({statut:'chargement'})` (recherche `Grep` §1.2), plus les fonctions nommées
  `rafraichir`/`recharger` qui s'appuient sur un compteur (`revision`, `rechargement`) — soit
  environ 40 flux distincts une fois les compteurs dépliés en appelants.
- **Classement en trois catégories** :
  - **Défaut réel** : **3** (`Stock.tsx`/`DetailLot.tsx` — §2.1 ; `Factures.tsx` `corrigerCoutLot`
    — §2.2, avec un jumeau `annulerFactureSelectionnee` de coût moindre ; `Recettes.tsx`
    `changerStatut` — §2.3). Soit 4 fonctions fautives précises si l'on compte le jumeau à part.
  - **Faux positif légitime** (premier chargement, navigation, ou consultation sans saisie) :
    la majorité des 34 sites — détaillé fichier par fichier en §3.
  - **Déjà corrigé** : 3 (échéancier de `Comptabilite.tsx`, retrait de ligne de `Factures.tsx`,
    `SaisieReception.tsx`) — non recomptés, relus au moment de la rédaction pour confirmer qu'ils
    le sont toujours.
