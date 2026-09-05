# 06 — Interface, parcours et conventions techniques

Ce document existe pour une raison simple : sans lui, l'interface sera inventée. Il fixe
la structure des écrans, les conventions d'API et le niveau de finition attendu.

---

## Principe directeur : ERP simplifié, pas tableau de bord d'agence

L'interface n'a pas à impressionner. Elle a à faire gagner du temps un dimanche soir à 21 h,
après six heures debout. Trois règles :

1. **Densité d'information plutôt que grands espaces.** C'est un outil de gestion. Un écran
   qui affiche trois chiffres au milieu du vide fait perdre du temps.
2. **Le chiffre avant le graphique.** Un graphique illustre, il ne remplace jamais le nombre.
   Toute donnée graphique doit être lisible aussi sous forme de tableau exportable.
3. **Aucune modale pour une saisie répétitive.** Les modales cassent le rythme clavier.
   Saisie en ligne, dans un tableau, comme dans un tableur.

**Direction visuelle.** Sobre, dense, professionnel. Une couleur d'accent unique. Typographie
système. Pas de dégradés, pas d'ombres portées décoratives, pas d'emoji dans l'interface.
Le seul usage justifié de la couleur est le **statut** : conforme / alerte / dépassement.

---

## Navigation

Barre latérale fixe, jamais rétractable, groupée par moment d'usage :

```
PILOTAGE
  Tableau de bord
  Prochaine session

EXPLOITATION
  Production
  Sessions
  Stock
  Achats

RÉFÉRENTIEL
  Recettes
  Produits
  Fournisseurs
  Événements

CONTRÔLE
  Comptabilité
  Registre AFSCA
  Qualité du modèle

  Paramètres
```

L'ordre reflète la fréquence d'usage réelle, pas une logique d'entités.

> **Mise à jour du 30/07/2026 — partiellement corrigé.** Le principe (groupée par moment d'usage,
> ordre = fréquence réelle, jamais rétractable) est resté vrai et est bien implémenté
> (`apps/web/src/composants/Navigation.tsx:19-76`), mais la liste elle-même est très en retrait :
> 13 entrées ci-dessus contre 25 réellement affichées aujourd'hui. Composition réelle des groupes
> (`Navigation.tsx:19-76`) :
>
> - **Pilotage** : Tableau de bord, Prochaine session, **Besoins projetés** (`/prevision-calendaire`).
> - **Exploitation** : inchangé (Production, Sessions, Stock, Achats).
> - **Référentiel** : **Ingrédients**, Recettes, Produits, **Nomenclature de vente**, **Menus**,
>   Fournisseurs, Événements, **Concurrents**, **Propositions IA (événements)**, **Lieux de marché**,
>   **Équipements** — 11 entrées contre 4 dans la liste ci-dessus.
> - **Contrôle** : Comptabilité, **Comparaison des lieux**, **Où aller ?**, **Objectifs et succès**,
>   **Économies d'achat**, **Factures fournisseur**, Registre AFSCA, Qualité du modèle,
>   **Journal d'audit** — 9 entrées contre 3.
> - **Paramètres** : inchangé, seul dans son groupe.
>
> (Gras = absent de la liste ci-dessus.) Source de vérité désormais : `Navigation.tsx`, pas ce bloc.

> **Mise à jour du 31/07/2026 10:16 — la correction ci-dessus est elle-même déjà dépassée.**
> Recompté directement dans `Navigation.tsx:20-82` (les cinq objets de `GROUPES`, un `libelle` par
> entrée) : **29 entrées, 5 groupes**, pas 25. Le compte détaillé, groupe par groupe :
>
> - **Pilotage** (`:22-28`) — 3 entrées : Tableau de bord, Prochaine session, Besoins projetés.
>   Inchangé par rapport au bloc ci-dessus.
> - **Exploitation** (`:29-37`) — 4 entrées : Production, Sessions, Stock, Achats. Inchangé.
> - **Référentiel** (`:38-54`) — 11 entrées, inchangé par rapport au bloc ci-dessus.
> - **Contrôle** (`:55-77`) — **10 entrées**, pas 9 : la liste ci-dessus omet **Assistance IA**
>   (`chemin: '/assistance-ia'`, `Navigation.tsx:72`), insérée entre Qualité du modèle et Journal
>   d'audit. Route servie par `App.tsx:80` (`<Route path="/assistance-ia" element={<AssistanceIa />} />`),
>   écran `apps/web/src/pages/AssistanceIa.tsx`.
> - **Paramètres** (`:78-81`) — 1 entrée, seule dans son groupe, inchangé.
>
> 3 + 4 + 11 + 10 + 1 = **29**, ce qui recoupe le compte indépendant de `docs/23-AUDIT-VISUEL.md`
> §1 (« Les 29 routes de `Navigation.tsx` ») — mais je ne le recopie pas : je l'ai recompté moi-même
> sur le fichier ouvert à l'instant, comme l'exige D-045 (« une liste recopiée à la main ne prouve
> rien »).
>
> **Un écart supplémentaire, hors navigation** : `App.tsx:55-94` déclare **30** routes réelles (hors
> la route `*` de secours) — une de plus que les 29 entrées de menu. La 30ᵉ est
> `/stock/inventaire` (`App.tsx:60`, écran `InventaireInitial.tsx`), atteinte uniquement par un lien
> posé DANS l'écran Stock (`Stock.tsx:953`, `navigate('/stock/inventaire')`), jamais depuis la barre
> latérale — cohérent avec la section « Parcours de premier lancement » plus bas dans ce document
> (étape 5, « Saisir un stock initial par inventaire »), qui ne prévoit pas d'entrée de navigation
> dédiée. Le dossier `apps/web/src/pages/` contient exactement 30 fichiers `.tsx` non-test : un par
> route déclarée, aucun composant orphelin, aucune route sans écran.
>
> **Méthode** : lecture intégrale de `Navigation.tsx` et `App.tsx`, comptage manuel des littéraux
> `libelle:` / `chemin:` et des éléments `<Route>` ; `apps/web/src/pages/*.tsx` listé par motif
> glob (30 résultats une fois les `*.test.tsx` exclus par le motif lui-même).

---

## Les cinq écrans qui comptent

Les autres peuvent être des tableaux CRUD standards. Ces cinq-là méritent d'être dessinés.

### 1. Tableau de bord

Répond à une seule question : **« qu'est-ce que je dois faire cette semaine ? »**

```
┌─ PROCHAINE SESSION ─────────────────┐ ┌─ ALERTES ───────────────────────┐
│ Dimanche 2 août — La Batte          │ │ ▲ Farine T55 : sous le seuil    │
│ Ensoleillé 21 °C                    │ │ ▲ Lot beurre #241 : DLC J-3     │
│ À produire : R1 5,5 L / R2 3,0 L    │ │ ● Listing TVA : dans 8 mois     │
│ ≈ 140 crêpes  [110 – 178]           │ └─────────────────────────────────┘
│ Confiance : faible (4 sessions)     │
│           [ Voir le détail ]        │ ┌─ SEUILS LÉGAUX ─────────────────┐
└─────────────────────────────────────┘ │ TVA        4 210 / 25 000  17 % │
                                        │  dont revente        820 €      │
┌─ 4 DERNIÈRES SESSIONS ──────────────┐ │ Airbag     4 210 / 23 000  18 % │
│ Date    CA     Marge  Écoul. €/h    │ │ Cotis.     2 890 / 17 374  17 % │
│ 26/07   612    418    92 %   64     │ └─────────────────────────────────┘
│ 19/07   538    351    78 %   54     │
│ 12/07   701    489    97 %   75  ▲  │  ▲ = rupture ce jour-là
└─────────────────────────────────────┘
```

La colonne **taux d'écoulement** et le marqueur de rupture sont les deux informations qui
pilotent réellement la décision suivante. Ne pas les enterrer.

> **Mise à jour du 31/07/2026 10:16 — plusieurs écarts, vérifiés dans `TableauDeBord.tsx`.**
>
> - **« Confiance : faible (4 sessions) » ne s'affiche PAS ici.** Le panneau réel
>   (`SectionPrevision`, `TableauDeBord.tsx:118-194`) ne montre que le nombre de crêpes à produire,
>   le libellé « crêpes à produire », un bouton « Voir le détail » et — seulement si une contrainte
>   écrête — une ligne d'alerte. Le niveau de confiance existe bien dans l'application, mais sur
>   l'écran « Prochaine session » (panneau « Confiance du modèle », `ProchaineSession.tsx:879-887`),
>   pas ici.
> - **« ALERTES » n'énumère jamais un ingrédient, un lot ou une échéance par son nom** — la maquette
>   montre `Farine T55 : sous le seuil`, `Lot beurre #241 : DLC J-3`, `Listing TVA : dans 8 mois`.
>   La construction réelle (`construireAlertes`, `TableauDeBord.tsx:506-584`) agrège en **comptes**
>   par catégorie (jusqu'à 6 : stock sous seuil, DLC déjà périmée, DLC proche, nettoyage en retard,
>   non-conformités ouvertes, échéances) — ex. « 2 ingrédients sous le seuil de sécurité » — jamais
>   le nom d'un ingrédient ou d'un numéro de lot précis dans la ligne elle-même (docs/07 §2.2, la
>   _cue_ : un agrégat cliquable, pas une liste détaillée). Le vrai panneau s'appelle d'ailleurs
>   « À traiter » (`TableauDeBord.tsx:1053`), pas « ALERTES ».
> - **« SEUILS LÉGAUX » montre aujourd'hui 4 lignes, pas 3.** `SEUILS`
>   (`packages/db/src/depots/sessions.ts:377-429`) définit Franchise TVA, Éligibilité Airbag,
>   Cotisation réduite **et** Caisse enregistreuse certifiée (SCE) — cette quatrième ligne
>   (`sessions.ts:417-429`) n'a pas d'équivalent dans la maquette. Et « dont revente » n'est pas
>   imbriqué sous la ligne TVA comme le dessine la maquette : c'est une ligne unique, sous
>   l'ensemble des seuils, commune à tous (`SectionSeuils`, `TableauDeBord.tsx:691-712`).
> - **Aucun marqueur de rupture (« ▲ ») sur le tableau des 4 dernières sessions.**
>   `COLONNES_DERNIERES_SESSIONS` (`TableauDeBord.tsx:750-781`) ne porte que Date, CA, Marge nette,
>   Écoulement — pas de colonne ni de glyphe signalant qu'une rupture de stock a eu lieu ce jour-là.

### 2. Prochaine session

L'écran de décision. Il doit être **argumenté**, parce que la recommandation contredira
souvent l'intuition (voir le quantile 90 % dans `03-MOTEUR-PREVISION.md`).

```
COMMENT ON ARRIVE À CE CHIFFRE
  Base historique                118 crêpes
  × Météo (ensoleillé, 21 °C)      1,15
  × Événement (aucun)              1,00
  × Saison (août)                  1,05
  × Tendance (+3 %/mois)           1,03
  ─────────────────────────────────────
  Demande attendue (médiane)     147 crêpes
  Fourchette                     [110 – 178]

POURQUOI PRODUIRE PLUS QUE 147
  Une rupture coûte 3,15 € de marge, un invendu 0,25 € de pâte.
  On produit donc au niveau qui couvre 90 % des cas, pas 50 %.
  → 172 crêpes

CE QUI LIMITE
  Capacité de cuisson (2 plaques, 6 h 30) ......... 185  ✓
  Glacière (18 L utiles) .......................... 176  ✓
  Stock de farine T55 ............................. 210  ✓
  → Retenu : 172 crêpes

RÉPARTITION      R1  5,5 L (116 crêpes)   R2  2,5 L (56 crêpes)

              [ Ajuster ]  [ Lancer la production ]
```

Chaque facteur est cliquable pour voir les données qui le fondent. Un ajustement manuel
demande un motif — c'est ce motif qui améliore le modèle.

> **Mise à jour du 31/07/2026 10:16 — les deux boutons de bas de maquette n'existent pas.**
> Recherche de `Ajuster` et `Lancer la production` dans `ProchaineSession.tsx` : aucune occurrence.
> Les actions réellement proposées sont différentes et vivent dans l'en-tête, pas sous la
> répartition : « Rafraîchir la météo » et « Archiver cette prévision »
> (`ProchaineSession.tsx:494-515`), plus un bouton « Demander un avis » à la demande, dans un
> panneau séparé « Avis de Claude » (`ProchaineSession.tsx:611-626`). Aucun de ces trois boutons
> n'ajuste manuellement la recommandation ni ne lance une production depuis cet écran — la
> répartition R1/R2 s'affiche dans un panneau « Plan de production » purement informatif
> (`ProchaineSession.tsx:826-877`), sans action attachée.

### 3. Clôture de session

L'écran le plus utilisé, dans les pires conditions de fatigue. **Tout au clavier.**

```
Session du 26/07 — La Batte                          [ Enregistrer  Ctrl+S ]

VENTES                                        Tabulation = champ suivant
  Produit                        Qté    PU     Total
  Froment / cassonade            [24]  3,00     72,00
  Froment / Sirop de Liège       [18]  3,50     63,00
  Sans gluten / cassonade        [ 9]  3,50     31,50
  Pot Sirop de Liège 450 g       [ 3]  7,50     22,50   (revente)
  + ligne…
                                        TOTAL  189,00

CAISSE      Espèces [118,50]   SumUp [70,50]   Écart : 0,00 ✓

PRODUCTION  Produit 172   Vendu 154   Invendu 15   Cassé 3
            Taux d'écoulement : 90 %

TEMPÉRATURES  Départ [3,1]  Arrivée [4,0]  Mi-session [5,2]  Retour [6,1]  ✓

FRAIS       Emplacement [22,00]  Déplacement [14,00]  Gaz [6,00]
```

L'écart de caisse s'affiche en direct, pas au bilan mensuel. Les températures sont dans le
même écran que les ventes : un registre qu'on remplit ailleurs est un registre qu'on ne
remplit pas.

> **Mise à jour du 31/07/2026 10:16 — trois écarts vérifiés dans `Sessions.tsx`.**
>
> - **CAISSE compte 5 champs, pas 3.** Le bloc réel (`Sessions.tsx:3526-3618`) affiche, dans l'ordre :
>   Fonds de caisse (€), Espèces comptées (€), SumUp — carte (€), Tickets (optionnel), Écart de
>   caisse. « Fonds de caisse » corrige l'invariant faux relevé par `docs/07` §6.1
>   (`ca_especes = especes_comptees − fonds_initial`) ; « Tickets » alimente le panier moyen
>   (D-039, docs/17 fiche 11). Ni l'un ni l'autre n'existait quand cette maquette a été dessinée.
> - **TEMPÉRATURES : 2 relevés, pas 4.** Le type réel est
>   `MomentTemperatureCloture = 'arrivee' | 'retour'` (`Sessions.tsx:542`) — aucun relevé « Départ »
>   ni « Mi-session » nulle part dans le fichier. Cela **précise**, sans le contredire, le constat
>   du 30/07/2026 sous « 4. Stock » juste en dessous, qui dit seulement que les températures sont
>   saisies « au même endroit que les ventes » — vrai, mais avec deux points de relevé, pas quatre.
> - **Une section entière absente de la maquette : ÉQUIPEMENTS ÉLECTRIQUES** (fiche 17, D-055,
>   `Sessions.tsx:88-90` pour la mention dans le commentaire d'en-tête, `:3957-3974` pour le rendu —
>   durée d'utilisation par appareil, masquée sur un lieu sans électricité). Ce bloc de saisie n'a
>   jamais eu d'équivalent dans ce document.
>
> Ce qui reste conforme, vérifié : le tableau VENTES porte bien les colonnes Qté / PU (€) / Total (€)
> (`Sessions.tsx:823-837`), et le code lui-même signale un écart que ce document n'avait pas encore
> acté : « `Ctrl+S` clôture (= enregistre : la maquette de docs/06 n'affiche qu'un seul bouton,
> "Enregistrer", il n'y a pas de brouillon séparé de la clôture) » (`Sessions.tsx:108-110`).

### 4. Stock

Un seul tableau dense, trié par urgence.

```
Ingrédient        Stock    Valeur   Seuil  Couvert.  DLC min    Statut
Farine T55        4,2 kg    3,15    8 kg    1 sess.  —          ▲ COMMANDER
Lait entier      12,0 L    13,80   10 L     2 sess.  02/08      ● OK
Beurre            2,1 kg   18,90    3 kg    1 sess.  29/07  ▲   ▲ COMMANDER
Sirop de Liège    3,4 kg   22,92    2 kg    4 sess.  12/2027    ● OK

                              [ Générer les commandes (2 fournisseurs) ]
```

La colonne **couverture en sessions** est plus parlante que la quantité brute : « il me reste
une séance de farine » se comprend immédiatement.

> **Mise à jour du 30/07/2026 — toujours vrai (non corrigé).** Vérifié par grep sur
> `apps/web/src/pages/Stock.tsx` : aucune colonne « couverture » / « Couvert. » n'existe. Le bouton
> « Générer les commandes » existe bien, mais pas sur cet écran : il est sur
> `apps/web/src/pages/Achats.tsx:361` (`Générer les commandes`), pas sur `Stock.tsx`. En revanche, le
> mockup « Clôture de session » plus haut (températures dans le même écran que les ventes) est
> désormais exact : `apps/web/src/pages/Sessions.tsx:2729-2755` saisit bien les relevés de
> température (arrivée/retour) au même endroit que les ventes — ce constat n'était pas encore vrai
> lors des audits précédents et n'appelle donc aucune correction ici.

> **Mise à jour du 31/07/2026 10:16 — re-vérifié en direct : le fond du constat ci-dessus tient
> toujours, mais sa propre citation de ligne est déjà caduque.** Toujours aucune colonne
> « couverture » / « Couvert. » dans `Stock.tsx` (grep répété à l'instant). Mais le bouton
> « Générer les commandes » n'est plus à `Achats.tsx:361` — cette ligne appartient aujourd'hui au
> gestionnaire d'erreur de `chargerCommandes` (`Achats.tsx:358-361`), sans rapport avec ce bouton. Le
> vrai panneau est « Générer des commandes » (`Achats.tsx:645`), et le bouton lui-même est à
> `Achats.tsx:655`. Le fichier a grossi depuis le 30/07 ; la conclusion (« pas sur `Stock.tsx` »)
> reste vraie, seule la ligne précise a bougé — même défaut que celui relevé plus bas dans
> « Conventions d'API » pour `referentiel-ecriture.ts`.

### 5. Recette

Panneau gauche : ingrédients et procédé. Panneau droit : **calculateur permanent**.

```
CALCULER POUR…
  ( ) 200 crêpes    (•) 5 litres    ( ) tout mon stock de farine

  Farine T55     ......  1 208 g     0,91 €
  Lait entier    ......  2 000 ml    2,30 €
  Œufs           ......  17 pièces   3,40 €
  Beurre         ......    458 g     4,12 €
  ...
  ────────────────────────────────────────
  66 crêpes             Coût matière  21,80 €   soit 0,33 €/crêpe
  Marge à 3,50 €        209,20 €      soit 91 %

  ALLERGÈNES  gluten (blé) · œufs · lait
```

---

## Conventions d'API

REST, préfixe `/api`, JSON, ressources au pluriel en français.

```
GET    /api/recettes
POST   /api/recettes
GET    /api/recettes/:id
PATCH  /api/recettes/:id
POST   /api/recettes/:id/versions
POST   /api/recettes/:id/calculer      { cible: 'crepes'|'volume'|'ingredient', valeur }

GET    /api/stock                       état courant valorisé
POST   /api/receptions
POST   /api/mouvements
POST   /api/inventaires

POST   /api/productions                 crée et consomme le stock (atomique)
PATCH  /api/productions/:id/realise

GET    /api/sessions
POST   /api/sessions/:id/cloturer

GET    /api/previsions/prochaine?lieuId=…
POST   /api/previsions/recalculer

POST   /api/commandes/generer
POST   /api/commandes/:id/envoyer

GET    /api/documents/:type/:id         génère un PDF
GET    /api/exports/:type               génère un Excel

POST   /api/ia/:usage                   appels Claude, serveur uniquement
```

> **Mise à jour du 30/07/2026 — partiellement corrigé.** Ce bloc décrit des routes génériques
> paramétriques ; la plupart n'existent pas sous cette forme, mais plusieurs ont désormais un
> équivalent réel et consommé, vérifié fichier par fichier :
>
> - `GET /api/recettes`, `GET /api/recettes/:id` : réels et consommés, inchangé.
> - **`POST /api/recettes`, `PATCH /api/recettes/:id`, `POST /api/recettes/:id/versions`** :
>   **existent réellement et sont câblés**, contrairement à ce qu'un audit antérieur
>   (`docs/13-AUDIT-CAPACITES-ORPHELINES.md §4.7`) concluait pour la création complète. Les trois
>   routes sont déclarées dans `apps/api/src/routes/referentiel-ecriture.ts:263,280,297`. Côté écran,
>   `apps/web/src/pages/Recettes.tsx:1349-1391` (fonction `enregistrer`) calcule un couple
>   `chemin`/`methode` variable — `POST /recettes` en création, `PATCH /recettes/:id` en édition,
>   `POST /recettes/:id/versions` en versionnage — et appelle `requeteApi(chemin, { method: methode })`
>   dans les trois cas (`:1393`). C'est le même motif de variable dynamique que
>   `Fournisseurs.tsx:355`/`Produits.tsx:360`, qu'une recherche littérale de route ne trouve pas.
>   `PATCH /recettes/:id/statut` existe aussi séparément (`referentiel-ecriture.ts:310`), consommé
>   par `Recettes.tsx:1436`, pour le changement brouillon/actif sans passer par une nouvelle version.
> - `POST /api/inventaires` : **n'existe toujours pas** ; `POST /api/receptions` en tient lieu,
>   choix assumé et documenté dans `apps/web/src/pages/InventaireInitial.tsx:11-27`.
> - `POST /api/previsions/recalculer` : **n'existe toujours pas** sous ce nom ; l'équivalent réel est
>   `GET /api/prevision?rafraichirMeteo=1` (`apps/api/src/routes/previsions.ts:1643`), qui ne
>   « recalcule » qu'en forçant un nouvel appel météo, pas un recalcul complet paramétrable.
> - `GET /api/previsions/prochaine?lieuId=…` : **n'existe toujours pas** ; l'équivalent est
>   `GET /api/prevision`, au singulier, sans filtre de lieu.
> - `GET /api/documents/:type/:id` et `GET /api/exports/:type` : **n'existent pas sous forme
>   paramétrique**, mais `apps/api/src/routes/documents.ts` (nouveau fichier) expose l'équivalent en
>   routes nommées : `GET /documents/fiche-technique/:id`, `/documents/affichette-allergenes`,
>   `/documents/etiquette-bac/:id`, `/documents/rapport-session/:id`, `/documents/registre-afsca`,
>   `/exports/stock`, `/exports/journal-recettes`, `/exports/journal-achats`, `/exports/mouvements`
>   (lignes `111,139,169,205,242,269,284,302,320`). Un bouton `apps/web/src/composants/BoutonDocument.tsx`
>   les consomme depuis plusieurs écrans (Stock, Sessions, RegistreAfsca, Production, Achats,
>   Comptabilite) — détail complet dans `docs/13-AUDIT-CAPACITES-ORPHELINES.md §2.3`.
> - `POST /api/ia/:usage` : **n'existe pas sous forme paramétrique.** Les usages réels sont
>   dispersés : `apps/api/src/routes/ia.ts` expose `GET /ia/etat`, `GET /ia/journal` et
>   `POST /ia/analyse-ecart/:id` (tous trois toujours orphelins côté écran, vérifié par grep sur
>   `apps/web/src`), et l'appel Claude pour la prévision est invoqué en interne par
>   `apps/api/src/routes/previsions.ts` via `apps/api/src/ia/usages.ts`. Un usage supplémentaire
>   (aide à la saisie d'événements) vit sous un préfixe encore différent,
>   `apps/api/src/routes/evenements-decouverte.ts`, avec un client Claude dupliqué (commentaire
>   `:33-44` du même fichier, signalé pour fusion).

> **Mise à jour du 31/07/2026 10:16 — les numéros de ligne ci-dessus sur `referentiel-ecriture.ts`
> sont déjà caducs, et deux familles de routes entières manquent à l'appel.**
>
> Relu à l'instant : `POST /recettes`, `PATCH /recettes/:id`, `POST /recettes/:id/versions` et
> `PATCH /recettes/:id/statut` existent toujours et fonctionnent comme décrit, mais pas aux lignes
> citées : ils vivent maintenant à `referentiel-ecriture.ts:403,420,437,450` (pas `:263,280,297,310`).
> L'écart (+140 lignes) vient de deux blocs de routes insérés avant, dans le même fichier, tous deux
> absents de cette section de ce document, alors qu'ils suivent exactement le même motif REST que
> les recettes : CRUD complet sur les ingrédients (`GET /referentiel/ingredients`, `POST /ingredients`,
> `PATCH /ingredients/:id`, `PATCH /ingredients/:id/activite` — `:273-311`) et sur les
> conditionnements (`GET /conditionnements`, `POST /conditionnements`, `PATCH /conditionnements/:id`,
> une variante `POST /conditionnements/:id`, `PATCH /conditionnements/:id/activite` — `:312-391`),
> plus un troisième bloc pour les lieux de marché (`GET /referentiel/lieux`, `POST /lieux`,
> `PATCH /lieux/:id`, `PATCH /lieux/:id/activite` — `:467-504`). Aucun des trois n'a d'équivalent
> dans cette section, qui ne prend `/api/recettes` que comme exemple générique du motif REST : le
> motif tient toujours, mais le fichier réel est aujourd'hui bien plus large que ce que cette
> section laisse deviner.

**Réponses.** Succès : l'objet ou `{ data, meta }` pour les listes.
Erreur : `{ erreur: { code, message, champs? } }`, message **en français** directement
affichable. Codes HTTP standards ; 422 pour une violation de règle métier avec le détail
des champs.

**Validation.** Un schéma Zod par route, partagé entre client et serveur via `packages/core`.
Le typage du client est dérivé du schéma, jamais réécrit à la main.

---

## Definition of done — à vérifier avant de clore un écran

- [ ] Utilisable entièrement au clavier
- [ ] État vide traité explicitement (pas d'écran blanc au premier lancement)
- [ ] État de chargement et état d'erreur traités
- [ ] Les montants s'affichent en euros, les quantités dans l'unité naturelle de l'ingrédient
- [ ] Aucun calcul dans le composant : tout vient de `packages/core` ou de l'API
- [ ] Fonctionne sans connexion réseau (sauf météo et IA, qui dégradent proprement)
- [ ] Les libellés sont en français, sans jargon technique visible
- [ ] Testé avec des données réalistes, pas avec « test 1 / test 2 »

---

## Parcours de premier lancement

L'application démarre avec une base vide. Elle doit guider, pas afficher des tableaux vides.

1. Créer le lieu de marché (La Batte pré-rempli, coordonnées incluses)
2. Vérifier les paramètres légaux 2026 (seuils pré-remplis, à confirmer)
3. Importer les recettes R1 et R2 depuis le seed
4. Saisir les fournisseurs et ingrédients principaux
5. Saisir un stock initial par inventaire
6. Définir la carte des produits et les prix
7. Fixer le prior de fréquentation (avec un texte expliquant que cette valeur s'effacera
   d'elle-même après quelques sessions)

Ce parcours est un écran d'accueil avec une liste de cases à cocher persistante, pas un
assistant modal en sept étapes qu'on ne peut pas quitter.

> **Mise à jour du 31/07/2026 10:16 — aucun écran de ce type n'existe, sous aucune forme trouvée.**
> Recherche sur tout `apps/web/src` d'un composant d'accueil ou de liste de tâches persistante
> (motifs `checklist`, `onboarding`, `premier-lancement` comme NOM d'écran) : seule correspondance,
> la variante `'premier-lancement'` du composant générique `EtatVide`
> (`composants/EtatVide.tsx:41-47`), utilisée ponctuellement écran par écran (ex.
> `ProchaineSession.tsx:536-542`, « Aucune session à venir »). Il n'y a ni route dédiée (absente de
> `App.tsx:55-94`), ni composant listant les 7 étapes décrites ci-dessus, ni case à cocher.
>
> **La persistance qu'exige ce parcours n'a nulle part où vivre.** Recherche de `localStorage` et
> `sessionStorage` sur tout `apps/web/src` : une seule occurrence, dans un commentaire de
> `TableauDeBord.tsx:849` qui constate la même absence pour une autre raison (l'horizon du tableau
> de bord ne doit délibérément pas survivre à un rechargement). Aucun mécanisme d'état ne persiste
> au-delà d'un rechargement de page nulle part dans le dépôt web, cases à cocher comprises.
>
> **Je décris, je ne tranche pas** (consigne de mission) : soit ce parcours guidé reste à
> construire, soit les états vides distribués écran par écran (un par écran concerné, cohérents
> avec docs/07 §4.7) en tiennent lieu et ce paragraphe doit être réécrit pour décrire CE choix-là.
> Les deux lectures sont défendables ; je n'en retiens aucune.

---

## Glossaire métier

| Terme                    | Définition dans ce projet                                                           |
| ------------------------ | ----------------------------------------------------------------------------------- |
| **Session**              | Une journée de présence sur un marché, du départ au retour                          |
| **Production**           | Fabrication d'un lot de pâte à partir d'une recette                                 |
| **Lot**                  | Quantité d'un ingrédient reçue en une fois, avec DLC et n° fournisseur              |
| **FEFO**                 | _First Expired, First Out_ — on consomme d'abord ce qui périme le plus tôt          |
| **CUMP**                 | Coût unitaire moyen pondéré — méthode de valorisation du stock                      |
| **Taux d'écoulement**    | Vendu ÷ produit, sur une session                                                    |
| **Baseline**             | Ventes d'une session « neutre » : météo moyenne, sans événement                     |
| **Quantile cible**       | Niveau de couverture de la demande retenu pour décider la production                |
| **Écart théorique/réel** | Différence entre la consommation prévue par la recette et la consommation constatée |
| **Transformé / Revendu** | Produit issu d'une recette vs produit acheté et revendu tel quel                    |
| **Billig**               | Plaque de cuisson à crêpes professionnelle                                          |
| **AFSCA**                | Agence fédérale belge pour la sécurité de la chaîne alimentaire                     |
| **INASTI**               | Institut national d'assurances sociales pour travailleurs indépendants              |
| **Franchise TVA**        | Régime dispensant de facturer la TVA sous un seuil de chiffre d'affaires            |
