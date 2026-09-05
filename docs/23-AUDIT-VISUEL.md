# 23 — Audit visuel (fiche 10, nuit du 30 au 31/07/2026)

> ### ⚠️ Correction du 31/07/2026, 04 h — ce rapport a très probablement mesuré 1024×576, pas 1280×720
>
> Deux agents de correction ont mesuré, indépendamment, ce que ce navigateur fait réellement :
> son `devicePixelRatio` vaut **1,25**. Conséquence chiffrée :
>
> - demander un viewport `1280×720` donne un `document.documentElement.clientWidth/clientHeight`
>   **réel de 1024×576** ;
> - pour obtenir un vrai rendu CSS **1280×720**, il faut demander **1600×900** — et le PNG produit
>   mesure alors 1600×900 pixels.
>
> Ce rapport annonce avoir vérifié ses captures « pixel-exact à 1280×720 **en mesurant les fichiers
> PNG** ». C'est précisément la vérification qui ne distingue pas les deux cas : un PNG de 1280×720
> correspond ici à un rendu CSS de **1024×576**. **Seul `clientWidth` fait foi**, et il n'a pas été
> relevé.
>
> **Conséquence sur la lecture du rapport** : le constat « en-têtes tronqués sur 19 des 29 écrans » a
> donc été établi dans une condition **plus dure** que la cible réelle du porteur. Un agent de
> correction, mesurant cette fois `clientWidth === 1280`, n'a pu **reproduire la troncature que sur
> deux de ses six écrans** — les quatre autres s'affichaient déjà en entier.
>
> **Ce que le rapport garde de valide** : le diagnostic de fond (largeurs de colonnes trop justes,
> et non un débordement) est confirmé, et il a mené à la cause racine réelle — la somme des largeurs
> qui dépasse 100 % (voir D-081), trouvée sur **trois** écrans indépendants. Les cas graves nommés
> ici — le nombre coupé, les en-têtes réduits à une lettre — ont été reproduits à la vraie
> résolution. 1024×576 reste par ailleurs un pire cas plausible (portable plus petit, ou mise à
> l'échelle Windows à 175 %), donc les correctifs de largeur ne sont pas du travail perdu.
>
> **Ce qu'il faut cesser de croire** : le chiffre « 19 sur 29 » à 1280×720. Il n'a pas été mesuré à
> cette résolution.

> Audit réalisé par capture d'écran sur une instance entièrement isolée : API sur `127.0.0.1:4711`,
> serveur web Vite sur `127.0.0.1:4712` (config jetable, jamais celle du dépôt), base neuve dans le
> dossier temporaire de session, `migrer` + `seed` + `seed:demo`. **Aucune requête d'écriture** vers
> `127.0.0.1:3001` — vérifié en fin de session que ce port est toujours tenu par son PID d'origine
> (21548), inchangé. Mes deux process (PID 34804 côté API, PID 29200 côté web) ont été arrêtés par
> PID exact en fin de session. Les 36 captures (29 à 1280×720, 4 à ~1920×1080, 3 à ~2560×1440) sont
> dans le dossier temporaire de session, sous `audit-visuel/captures/<résolution>/`, jamais dans le
> dépôt — elles ne survivront pas à la session, d'où une description écrite complète de chaque
> constat plutôt qu'un simple renvoi à l'image.

---

## 0. Note de méthode : la dérive de viewport, et comment je l'ai neutralisée

Le navigateur Playwright piloté ici est **partagé avec au moins un autre agent** (un onglet
`localhost:5194/concurrents` était déjà ouvert à mon arrivée, jamais touché). Premier symptôme :
demander un viewport de 1280×720 rendait tantôt 1024×576, tantôt 1600×900 — une dérive du ratio
physique/CSS que j'ai d'abord prise pour un effet de la mise à l'échelle Windows à 125 % décrite
dans `docs/07` §4.4, avant de constater qu'elle se reproduisait même en ouvrant mon **propre**
onglet dédié (fermé proprement en fin de session), donc plus vraisemblablement un artefact du
navigateur partagé que la vraie mise à l'échelle du poste.

**Correctif retenu, vérifié** : après chaque capture, mesure du PNG produit avec
`System.Drawing.Image` (PowerShell) — la preuve est dans le fichier, pas dans ce que l'outil
prétend avoir fait. **Les 29 captures à 1280×720 ont été vérifiées une par une : les 29 sont
exactement 1280×720 px, sans exception.** Les captures « grand écran » ont dérivé malgré la même
discipline (vérification immédiatement avant la prise, dérive quand même entre la vérification et
la capture elle-même) : elles sont donc réellement à **2400×1350** (visée 1920×1080) et
**3200×1800** (visée 2560×1440) plutôt que les valeurs pile — soit strictement plus grandes que la
cible demandée, ce qui reste valide pour vérifier la dilution en grand, mais je le signale pour ne
pas prétendre une précision que je n'ai pas mesurée.

**Ce que je n'ai PAS testé** : je n'ai navigué que par URL directe (`goto`), jamais au clavier —
donc rien à dire sur les anneaux de focus (hors périmètre demandé, sauf s'il avait été invisible,
et je n'ai pas pu l'observer faute de l'avoir déclenché). Je n'ai ouvert aucune fiche de détail, aucun
onglet secondaire (Registre AFSCA n'a été vu que sur « Températures », pas les 4 autres onglets),
aucun formulaire de saisie rempli, aucune modale. **Chaque capture montre l'état d'atterrissage de
la route, pas ce qu'il y a derrière un clic.**

---

## 1. Combien d'écrans ouverts et capturés

**Les 29 routes de `apps/web/src/composants/Navigation.tsx` ont toutes été ouvertes et capturées à
1280×720** (c'est la source de vérité actuelle, pas `docs/06` qui n'en liste que 13-25 selon la
version) : Tableau de bord, Prochaine session, Besoins projetés, Production, Sessions, Stock,
Achats, Ingrédients, Recettes, Produits, Nomenclature de vente, Menus, Fournisseurs, Événements,
Concurrents, Propositions IA (événements), Lieux de marché, Équipements, Comptabilité, Comparaison
des lieux, Où aller ?, Objectifs et succès, Économies d'achat, Factures fournisseur, Registre AFSCA,
Qualité du modèle, Assistance IA, Journal d'audit, Paramètres.

**4 d'entre elles** (Tableau de bord, Stock, Propositions IA événements, Paramètres) ont aussi été
capturées en grand écran (~2400×1350), et **3** (Tableau de bord, Propositions IA événements,
Paramètres) à ~3200×1800 — choisies parce qu'elles portaient les défauts de troncature les plus
sévères à 1280×720, pour vérifier si la largeur seule les corrige.

**Ce que je n'ai pas atteint** : aucun sous-écran, fiche de détail, onglet secondaire ou formulaire
rempli (voir §0). Le dénominateur de cet audit est donc **29 écrans de premier niveau**, pas
l'ensemble des états que chaque écran peut prendre.

---

## 2. Ce qui casse à 1280×720 — le défaut dominant, par coût décroissant

### 2.1 Des en-têtes de tableau illisibles sur environ deux tiers des écrans

**C'est le défaut le plus grave et le plus répandu de tout l'audit.** Un même mécanisme
(`Tableau`, déjà pointé dans une note antérieure du projet comme tronquant tout) casse de façon
graduée sur **19 des 29 écrans** — de « un mot coupé » à « en-tête réduit à une lettre ». Aucun
défilement horizontal n'apparaît (le tableau ne déborde pas de son conteneur) : le problème n'est
pas un débordement, c'est une troncature CSS (`text-overflow: ellipsis` probable) appliquée à des
colonnes trop étroites pour leur contenu à 1280 px.

**Les quatre pires cas, par ordre de gravité** :

1. **Propositions IA (événements)** (`16-evenements-decouverte.png`) — 11 des 12 en-têtes tronqués,
   certains réduits à une seule lettre suivie de points : `PO...`, `IN...`, `E...`, `SO...`. Un
   utilisateur ne peut pas savoir ce que ces colonnes contiennent sans deviner. **Vérifié corrigé
   à largeur suffisante** : à ~1920 px (`1920x1080/16-evenements-decouverte.png`), les 12 en-têtes
   s'affichent en toutes lettres (ÉVÉNEMENT, TYPE, PÉRIODE, LIEU, DISTANCE, PORTÉE, INTENSITÉ,
   OPPORTUNITÉ ?, EFFECTIF, RENTABILITÉ PRÉVUE, SOURCE, ACTIONS) — la preuve que c'est un problème
   de largeur de colonnes fixes, pas un problème de contenu ou de logique.
2. **Concurrents**, tableau « Derniers prix relevés » (`15-concurrents.png`) — colonnes réduites à
   `CONCURR...`, `POSI...`, `PR...`, `R...` ; valeurs `Stan...`, `Prem...`. Le tableau voisin
   (« Notre carte ») sur la même page est parfaitement lisible : c'est la largeur allouée à ce
   second tableau à deux colonnes qui est en cause, pas l'écran dans son ensemble.
3. **Comparaison des lieux** (`20-comparaison-lieux.png`) — en-têtes `DISTA...`, `CRÊPE...`,
   `CA AT...`, `MA...`, `EM...`, `DÉP...`, `MARGE ...`. Pire : une **valeur numérique** est coupée
   en plein milieu, `32,...` — un nombre tronqué est plus grave qu'un texte tronqué, parce que le
   lecteur ne peut même pas savoir combien de décimales ont disparu. C'est une violation directe du
   principe « décimales fixes par colonne » de `docs/07` §4.5, en pire : ici la troncature rend le
   nombre **imprécis**, pas seulement illisible.
4. **Ingrédients** (`08-ingredients.png`) — quasiment toute la table est illisible : `UNITÉ`
   affiche `gra...` / `milli...` sur chaque ligne, `STOCK M...`, `FORM...`, `STAT...` tous coupés.
   Le panneau de saisie à droite, lui, est intact — la colonne de gauche (~490 px) est simplement
   trop étroite pour ses 5 colonnes.

**Autres écrans touchés, plus légèrement** : Besoins projetés (`FENÊTRE DE COMMA...`, valeur
`Réactif + prédi...`), Sessions (`PROJECTION FIN D'ANNÉ...`, et surtout `Caisse enregistreuse c...`
— voir §5), Achats (`ENVOYÉE...`, `MONTAN...`), Recettes (`CO...`, `Brouill...`, noms d'ingrédients
coupés dans le calculateur), Produits (`PRIX (...`, `Transfor...`), Fournisseurs (`Grossi...`),
Événements (`INTENSI...`, `IMPACT MES...`), Lieux (`SES...`, `STA...`, `Dima...`), Équipements
(`PUISS...`, `EN SE...`, `STAT...`), Où aller ? (presque tous les en-têtes réduits à 2-4 lettres),
Registre AFSCA (`TEMPÉRATU...`, `RELEVÉ...`), Assistance IA (`TOKENS (E...`).

**Écrans indemnes, à prendre comme référence** : **Factures fournisseur** (`24-factures.png`) — les
6 en-têtes (N° FACTURE, FOURNISSEUR, DATE, STATUT, MONTANT (€), ÉCART (€)) s'affichent en entier,
aucune troncature — et c'est l'un des trois fichiers en chantier cette nuit, donc soit déjà
retravaillé, soit jamais touché par le défaut. **Journal d'audit** (`28-journal-audit.png`) est
également intact. **Stock** (`06-stock.png`), **Production** (`04-production.png`), **Comptabilité**
(`19-comptabilite.png`), **Menus** (`12-menus.png`), **Objectifs**, **Économies** n'ont montré aucune
troncature. Le fait que Factures et Stock — deux des trois écrans en chantier annoncés — soient
justement les plus propres est un indice concret : **il vaut la peine de regarder comment ces deux
écrans dimensionnent leurs colonnes et d'appliquer la même méthode ailleurs**, plutôt que
d'élargir le composant `Tableau` au hasard.

### 2.2 Paramètres — une variante différente et pire du même défaut

`29-parametres.png` (1280×720) : la colonne CLÉ contient des identifiants `snake_case`
(`adresse_depart_defaut`, `afsca_motifs_incident_sanitaire_json`…) qui, faute de place, **passent
à la ligne en plein milieu du mot** (`adresse_depart_defau` / `t`). Contrairement aux autres
tableaux, ce n'est pas de l'ellipse mais du retour à la ligne forcé — l'information n'est pas
perdue, mais **la rangée de 32 px prescrite par `docs/07` §4.3 est cassée** : chaque ligne occupe
visuellement 2 lignes de texte, soit 48-56 px, et le rythme de lecture d'un tableau de 99 lignes en
souffre. Les en-têtes `EN VIG...`, `DEPUI...`, `VER...` sont eux aussi tronqués. **Vérifié corrigé
à largeur suffisante** (`1920x1080/29-parametres.png`) : chaque clé tient sur une seule ligne, les
trois en-têtes s'affichent en entier (EN VIGUEUR, DEPUIS LE, VERSIONS). Même diagnostic que §2.1 :
un problème de largeur de colonne fixe, pas de contenu.

### 2.3 La barre de navigation elle-même déborde la hauteur utile

Sur toutes les captures à 1280×720, la barre latérale affiche un ascenseur vertical visible dès le
premier écran (`01-tableau-de-bord.png`) : les 5 groupes et 29 entrées ne tiennent pas dans les
~640 px utiles décrits par `docs/07` §4.4. Ce n'est pas nécessairement une erreur — la navigation
a grossi de 13 à 29 entrées depuis l'écriture de `docs/06` — mais c'est une conséquence directe :
la ressource la plus rare de l'écran (la hauteur) est déjà entamée par la navigation avant même le
contenu.

---

## 3. Incohérences entre écrans, groupées par mécanisme

### 3.1 Tableaux

- **Le même défaut de troncature n'est pas appliqué partout** (voir §2.1) — c'est la fiche 10
  elle-même qui prédit ce risque (« un écran ajouté isolément dérive »), et c'est exactement ce qui
  s'est produit : Factures et Journal d'audit sont propres, la majorité des écrans de référentiel
  ne le sont pas.
- **L'unité tantôt dans l'en-tête, tantôt dans la cellule, pour la même nature de donnée.** Le
  calculateur de Recettes (`09-recettes.png`) affiche `0,11 €`, `0,28 €`, `0,40 €` — l'unité répétée
  dans chaque cellule — alors que Stock (`06-stock.png`) et Objectifs (`22-objectifs.png`) mettent
  `(€)` une seule fois dans l'en-tête et laissent la cellule à `2,60`. `docs/07` §4.5 tranche
  explicitement pour la seconde forme ; les deux se côtoient dans la même application.
- **Le même concept, trois libellés différents, sur trois écrans.** Le taux de vendu/produit
  s'appelle « ÉCOULEMENT » en entier sur Sessions (`05-sessions.png`, tableau des 2 sessions),
  « ÉCOUL. » (abréviation volontaire, sans points de suspension) dans la mini-table du Tableau de
  bord — non, en fait l'inverse est vrai : le Tableau de bord tronque avec points de suspension
  (`ÉCOULE...`) alors que Sessions l'abrège proprement (`ÉCOUL.`, sans troncature visible). Un même
  chiffre, deux traitements différents pour le même manque de place.

### 3.2 Badges de statut

Le vocabulaire glyphe + couleur + mot est globalement bien tenu (▲ orange pour une alerte à traiter,
● vert pour un état conforme, ■ rouge pour un retard, jamais un aplat de fond coloré). Une
incohérence sémantique cependant : sur Sessions (`05-sessions.png`), une session **« Planifiée »**
(qui n'a encore rien d'anormal — c'est un futur normal) porte le même glyphe ▲ que les vraies
alertes du tableau de bord (rupture de stock, DLC proche). Ailleurs dans l'application, ▲ signifie
systématiquement « nécessite une action ». Une session planifiée n'en nécessite aucune tant qu'elle
n'a pas eu lieu. Utiliser ▲ pour un état simplement futur dilue le sens du glyphe partout où il sert
vraiment à alerter — exactement le risque que `docs/07` §3.5 décrit pour la désensibilisation aux
alertes.

### 3.3 Formulaires / mise en page

Le motif à deux panneaux (liste à gauche ~490 px, formulaire de création à droite ~490 px) est
appliqué de façon cohérente sur tous les écrans de référentiel (Ingrédients, Produits, Fournisseurs,
Lieux, Équipements). C'est une bonne cohérence structurelle — mais c'est précisément cette largeur
de ~490 px par panneau qui rend les tableaux à 5-6 colonnes illisibles (§2.1). Le motif lui-même
n'est pas en cause ; c'est le nombre de colonnes qu'on y loge qui l'est.

### 3.4 Boutons

Aucune incohérence trouvée : un seul bouton plein (accent bleu) par panneau pour l'action primaire
(« Nouvel ingrédient », « Enregistrer une réception », « Générer les commandes »…), boutons à
contour pour les actions secondaires (exports Excel, « Rafraîchir la météo »). Cohérent sur les 29
écrans vus.

---

## 4. Interdits de `docs/07` — ce que j'ai vu appliqué (= violé)

**Aucune violation trouvée** sur les 29 écrans capturés : pas de dégradé, pas d'ombre colorée, pas
d'émoji, pas de zébrure de tableau, pas de fond de rangée coloré pour une alerte, pas de carte
imbriquée à profondeur > 1 — chaque panneau suit le même motif simple (en-tête gris `SURFACE-SUNKEN`

- corps blanc, jamais un second niveau de carte à l'intérieur). Le mécanisme d'application par
  jetons semble tenir. **Réserve honnête** : je n'ai pas cherché spécifiquement le signe moins U+2212
  (aucune valeur négative n'est apparue dans les données de démonstration parcourues — tous les
  écarts observés étaient à 0,00 ou positifs), donc je ne peux ni confirmer ni infirmer ce point
  précis, contrairement au reste de cette section que j'ai réellement vérifié à l'écran.

---

## 5. Ce qui est illisible ou ambigu, même conforme

- **Sessions, panneau Seuils légaux** (`05-sessions.png`) : le libellé du seuil **« Caisse
  enregistreuse certifiée (SCE) »** est précisément celui qui se fait tronquer en
  « Caisse enregistreuse c... ». C'est malheureux : `CLAUDE.md` §6 et `docs/07` §6.7 insistent sur
  le fait que ce compteur est le plus susceptible de surprendre le porteur (il bascule de 0 % à
  obligatoire dès qu'une table apparaît sur le stand) — c'est exactement la ligne qu'il ne faut pas
  couper.
- **Comparaison des lieux** : un nombre tronqué (`32,...`, voir §2.1) est pire qu'un texte tronqué
  — impossible de savoir si la vraie valeur est 32,1 ou 32,99.
- **Paramètres** : les clés wrap au milieu d'un identifiant technique. Si le porteur veut relire ou
  transcrire une clé pour la retrouver dans le code (le fichier `CLAUDE.md` lui-même l'encourage à
  lire le code), une clé coupée en deux lignes sans tiret est plus difficile à recopier correctement
  qu'une clé tronquée avec points de suspension.
- **Le glyphe ▲ pour « Planifiée »** (voir §3.2) — à l'usage, un dimanche soir fatigué, voir un
  triangle orange sur une ligne qui n'a besoin d'aucune action force à s'arrêter et vérifier, alors
  que rien ne le justifie.
- **TableauDeBord.tsx, observé instable pendant l'audit — hors du périmètre annoncé.** Ce fichier
  n'est pas l'un des trois cités comme en chantier (`Factures.tsx`, `Recettes.tsx`, `Stock.tsx`,
  `saisie-stock/**`), et pourtant deux `ReferenceError` différentes (`HORIZON_ACHATS_PAR_DEFAUT` /
  `horizonAchats`, puis plus tard `libelleHorizon`) sont apparues dans la console à deux moments
  distincts de la session, avec des numéros de ligne qui changeaient d'un rechargement à l'autre —
  signe qu'un tiers non annoncé modifie ce fichier en direct. **Revérifié juste avant d'écrire ce
  rapport** : l'écran est stable, sans erreur console, aux deux résolutions. Je ne le compte donc
  pas comme un défaut, mais je le signale : un troisième écran est en chantier ce soir sans que la
  consigne me l'ait dit, et un futur audit ne doit pas tenir pour acquis que seuls les trois fichiers
  annoncés bougent.
- **Grand écran (~2400×1350, ~3200×1800 réels) : rien ne se dilue.** Le contenu reste dans une
  largeur de lecture raisonnable (les panneaux ne s'étirent pas sur toute la largeur disponible),
  et les mêmes tableaux qui étaient illisibles à 1280 px deviennent parfaitement lisibles — aucune
  perte de densité, aucun texte qui se disperse. Seule réserve mineure : sur Stock en grand écran, de
  larges espaces vides apparaissent entre les colonnes (le tableau s'étire pour remplir la largeur
  sans ajouter d'information) — pas un défaut au sens de la doctrine, juste un peu lâche.

---

## 6. Trié par coût pour quelqu'un de fatigué, un dimanche soir

**Urgent, systémique** :

1. Les en-têtes et valeurs de tableau tronqués sur ~19 écrans sur 29 à 1280×720 — la résolution
   réelle du poste. Cause confirmée : largeur de colonne insuffisante, pas un problème de contenu
   (la preuve : tout redevient lisible à ~1920 px). Pires cas à corriger en premier : Propositions
   IA (événements), Concurrents (mini-tableau des prix), Comparaison des lieux (avec un **nombre**
   tronqué, pas seulement du texte), Ingrédients. Regarder comment Factures.tsx et Stock.tsx
   dimensionnent leurs colonnes — ce sont les deux tableaux propres de toute l'application.
2. Paramètres : les clés wrappent au milieu du mot et cassent la rangée de 32 px sur un tableau de
   99 lignes que le porteur doit pouvoir parcourir vite.

**Réel mais plus étroit** :

3. Le libellé « Caisse enregistreuse certifiée (SCE) » — précisément le seuil le plus piégeux du
   produit — est celui qui se fait couper sur Sessions.
4. Le glyphe ▲ (« nécessite une action ») réutilisé pour « Planifiée », un état neutre — dilue le
   vocabulaire d'alerte ailleurs dans l'app.
5. L'unité tantôt en en-tête, tantôt répétée en cellule (Recettes vs Stock/Objectifs), et
   « écoulement » orthographié différemment selon l'écran (ÉCOULEMENT / ÉCOUL. / ÉCOULE...).
6. La barre de navigation demande son propre défilement à 1280×720 avant même d'atteindre le
   contenu — la navigation a grossi de 13 à 29 entrées sans qu'on revoie sa hauteur.

**Bonnes nouvelles, vérifiées** :

- Aucun dégradé, ombre colorée, émoji, zébrure ou fond de rangée coloré trouvé nulle part.
- Les trois états vides (premier lancement) sont systématiquement bien traités : titre + une phrase
  - un seul bouton d'action, vus à l'identique sur au moins 11 écrans (Achats, Menus, Nomenclature
    de vente, Événements, Propositions IA, Équipements, Factures, Qualité du modèle, Objectifs,
    Économies, Journal d'audit).
- Le compte est systématiquement affiché (« 10 sur 10 », « 3 sur 3 », « 0 sur 0 ») sur tous les
  écrans à liste vérifiés.
- Les trois écrans officiellement en chantier cette nuit (Factures, Recettes, Stock) étaient stables
  à chaque passage, sans erreur console, et Factures.tsx est l'un des deux seuls tableaux
  entièrement lisibles de toute l'application.
