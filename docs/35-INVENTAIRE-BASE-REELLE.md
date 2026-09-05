# 35 — Inventaire réel/fictif de la base du porteur

> **Date.** 01/08/2026. **Nature.** Mission de mesure et de préparation pure — **aucune écriture**
> nulle part (ni base réelle, ni sauvegarde, ni requête `POST`/`PATCH`/`DELETE`). Travaillé sur une
> copie de `sauvegardes/batte-20260801-0856.sqlite`, dans le dossier temporaire de session. Cette
> copie a été vérifiée identique octet pour octet à la sauvegarde d'origine (`md5sum`), puis
> recoupée en lecture seule contre le serveur réel (routes `GET` de `/api/stock`) : les deux
> sources concordent exactement (19 lots, intégrité cohérente, mêmes quantités restantes). Le
> contenu ci-dessous décrit donc l'état réel de
> `donnees/batte.sqlite` au moment de l'audit, pas seulement celui de la sauvegarde.
>
> **Contexte.** `CLAUDE.md` §3 règles 6 et 7, §7. `docs/25-RECETTE-APRES-CAMPAGNE.md` documente
> l'incident du 31/07/2026 (`db:seed` et `db:seed:demo` lancés sans `CHEMIN_BASE`, donc sur la vraie
> base) et annonce deux réceptions consommées, `RC-2026-0007` et `RC-2026-0008`. Cette mission va
> plus loin : elle établit que ce n'est ni le premier ni le seul épisode.

---

## 1. Le discriminant, et ses limites — à lire en premier

Trois niveaux de certitude, du plus solide au moins solide. Tout le reste de ce document en
dépend.

### 1.1 Certain — prouvé par correspondance au code source

`packages/db/src/seed/demonstration.ts`, `concurrents.ts` et `activite.ts` codent en dur des
constantes littérales : noms préfixés `[démo] `, quatre bons de livraison
(`BL-DÉMO-ÉPICERIE`, `BL-DÉMO-TERROIR`, `BL-DÉMO-GARNITURE-ÉPICERIE`,
`BL-DÉMO-GARNITURE-TERROIR`), des textes de note entiers, des quantités et des prix précis. Une
ligne dont **le nom, le prix, la quantité et la date relative correspondent exactement** à ces
constantes ne peut pas être une coïncidence — c'est un artefact du script, prouvable par lecture
du code, pas une supposition. C'est le niveau de preuve le plus fort de ce document.

Le préfixe `[démo]` seul **ne couvre pas tout** : une réception, un lot, un mouvement de stock, une
vente de session n'ont pas de nom. Ils sont rattachés par ricochet — un lot dont le
`numero_lot_fournisseur` est `DÉMO-VERGEOISE-02` (constante du fichier), ou un mouvement dont le
`lot_id` pointe vers un tel lot, hérite de la même certitude sans porter lui-même le préfixe.

**Nuance capitale, trouvée en creusant** : « inséré par le script de démonstration » n'est **pas**
synonyme de « fictif ». L'en-tête de `demonstration.ts` le dit noir sur blanc : _« Ce qui est REEL
… la composition de R1 … le rendement de R1 et R2 … Ce qui est FICTIF : les fournisseurs, les prix,
les densités usuelles. »_ La recette `R1` (et son rendement `R2`) sont du **contenu réellement
documenté dans `CLAUDE.md` §6**, simplement saisi par un script plutôt que par le porteur au
clavier. Les désactiver comme le reste de la démonstration casserait la seule recette utilisable de
l'application. Même chose pour le lieu « La Batte » : coordonnées et fenêtre horaire réelles,
insérées par `seedLieu()`, jamais fictives. Ce document distingue donc ces lignes (« réel-contenu,
inséré par script ») du reste du référentiel démo, explicitement fictif par la propre déclaration du
code (`CAFE-VIDE`, fournisseurs, prix, ingrédients, produits vendus, concurrents).

À l'inverse, ce qui **ne peut JAMAIS être inséré par `db:seed` ni `db:seed:demo`** est également une
certitude négative exploitable : `journal_ia`, `depense`, `equipement`, `evenement`,
`nettoyage_execution`, `releve_temperature`, `meteo_observation`, `document_genere`,
`commande_fournisseur` ne sont touchées par **aucun** des deux scripts. Toute ligne qui s'y trouve a
donc été écrite par l'application en fonctionnement (humain ou agent), jamais par une graine — mais
cette certitude est seulement **négative** : elle prouve « ce n'est pas de la démo », pas « c'est une
vraie vente ».

### 1.2 Déductible par recoupement — vraisemblable, jamais prouvé

Ni marqueur textuel, ni empreinte de code : seulement des indices convergents.

- **Convention de nommage `ZZ…`/`Diagnostic`/`Test`** : deux ingrédients (« ZZ Ingredient
  Diagnostic 2 », « ZZ Diagnostic Parse Check ») et une recette (« ZZTEST-Q », nom « Test
  diagnostic quantité ») créés le **30/07/2026 entre 21:30 et 21:46**, via l'application (chacun a
  une entrée `journal_audit`, ce que seule une écriture par un dépôt réel produit). Rien dans le
  code ne les qualifie de test — c'est la convention de nommage et le regroupement temporel qui
  l'indiquent, avec une force de conviction élevée mais **non prouvée**.
- **Vraisemblance métier** : `RC-2026-0003` (10 000 000 g de vergeoise, soit 10 tonnes) et
  `RC-2026-0004` (500 000 g de vergeoise + 500 000 g de sel) portent des quantités absurdes pour
  un stand de crêpes, et leurs lots affichent une **DLC antérieure ou égale à la date de
  réception elle-même** (`date_dlc: 2026-01-01` pour une réception du 28/07 ; `2026-07-01` pour
  une réception du 28/07) — une livraison réellement acceptée avec une péremption déjà dépassée
  n'existe pas. Fort indice de test, non prouvé.
- **À l'inverse**, `RC-2026-0005` (« BL-MEUNIER-7741 ») porte des numéros de lot au format
  plausible d'un vrai fournisseur (`MEU-T55-260721`, `LAI-2607-B`, `OEU-P26-3007`) et des DLC
  cohérentes (2 à 3 semaines après réception pour du frais, 8 mois pour la farine) — vraisemblable
  comme vraie livraison, non prouvé non plus.
- **Initiales « JB »** (celles du porteur) sur `nettoyage_execution` et `releve_temperature` — ce
  sont aussi les deux seules tables qu'aucun script d'aucune sorte n'écrit, donc la certitude
  négative du §1.1 se double ici d'un indice positif convergent.

### 1.3 Non distinguable du tout

- **Aucun fournisseur réel n'existe dans la base.** Sur les 3 lignes de `fournisseur`, une est le
  fournisseur système (« Inventaire d'ouverture »), les deux autres sont les fournisseurs FICTIFS
  du script de démo. **Les 8 réceptions de la base, sans exception, pointent donc vers un
  fournisseur `[démo]`.** Le rattachement à un fournisseur démo ne prouve donc RIEN sur le
  caractère réel ou fictif d'une réception — c'était le seul choix possible dans le menu déroulant.
  C'est la limite la plus importante de ce document : **le porteur n'a jamais créé sa propre fiche
  fournisseur**, ce qui invalide silencieusement tout raisonnement du type « fournisseur démo ⇒
  ligne démo ».
- **`commande_fournisseur` (3 lignes, `CF-2026-0001/0002/0003`)** : aucune n'est rattachée à une
  réception (`commande_id` toujours `null` côté réception), toutes pointent vers un fournisseur
  démo, aucun indice de nommage ni de vraisemblance ne permet de trancher. Authentiques commandes
  du porteur, essais de sa part, ou essais d'un agent — indiscernable avec les moyens de cette
  mission.
- **`session_marche` `SM-2026-0003`** (28/07/2026, un mardi — alors que « La Batte » ne se tient
  que le dimanche) et tout ce qui en dépend (`session_vente` ×3, `session_frais` ×3, une partie de
  `production`/`production_consommation`) : chiffres modestes et plausibles (135 €, 32 crêpes,
  frais d'emplacement réellement saisi à 22 €), mais elle a nécessairement vendu les **produits
  démo** (aucun autre catalogue n'existe) et sa production (`PR-2026-0002`) a physiquement
  **mélangé, dans la même fournée**, des lots issus de réceptions démo (`RC-2026-0001`) et des
  lots issus de réceptions plausiblement réelles (`RC-2026-0005`, `RC-2026-0006`) — la FEFO ne
  distingue pas l'origine d'un lot. **Une fois consommée en production, la matière réelle et la
  matière fictive ne sont plus séparables : ni par requête, ni après coup.** C'est la limite
  structurelle la plus profonde de cet inventaire.
- **`document_genere` (20 lignes)** : ce sont des fichiers réellement générés par l'application
  (PDF, Excel), mais leur **contenu** peut documenter un objet démo (registre AFSCA d'une session
  fictive) aussi bien qu'un objet réel — non vérifié ligne à ligne, faute de temps (voir §6).

---

## 2. Inventaire chiffré, table par table

**50 tables** trouvées en base (le libellé de la mission en annonçait 49 — écart mineur, non
creusé). **17 sont vides** dans les deux sens (0 ligne réelle, 0 fictive) :
`amortissement_annuite`, `depense`, `economie_achat`, `equipement`, `equipement_session`,
`evenement`, `exercice_tracabilite`, `facture_fournisseur`, `facture_ligne`, `frais_reception`,
`immobilisation`, `journal_ia`, `menu_composition`, `non_conformite`, `objectif`, `periode`,
`prevision`.

Six catégories, dont la somme retombe exactement sur les **349 lignes** non vides de la base
(vérifié par addition croisée, deux fois) :

| Code   | Catégorie                                                         | Lignes  |
| ------ | ----------------------------------------------------------------- | :-----: |
| **F**  | Fictif certain (démo, sans valeur métier réelle)                  |   130   |
| **RC** | Réel par le contenu, inséré par le script — **ne jamais toucher** |   10    |
| **R**  | Réel certain (système, légal, technique, structurel)              |   136   |
| **D**  | Débris de test/diagnostic, quasi-certain                          |   15    |
| **P**  | Plausiblement réel (saisie du porteur), quasi-certain             |   15    |
| **M**  | Indéterminé / mixte, ne peut être tranché                         |   43    |
| —      | **Total**                                                         | **349** |

### 2.1 Table par table (33 tables non vides)

| Table                     | Total |  F  | RC  |  R  |  D  |  P  |  M  | Détail                                                                                                                                                         |
| ------------------------- | :---: | :-: | :-: | :-: | :-: | :-: | :-: | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parametre`               |  99   |     |     | 99  |     |     |     | Seuils légaux, taux — écrits par `seed()`, jamais par la démo.                                                                                                 |
| `mouvement_stock`         |  39   | 29  |     |     |  3  |  7  |     | Voir §3 pour la ventilation par réception.                                                                                                                     |
| `motif`                   |  13   |     |     | 13  |     |     |     | Motifs de mouvement, référence système.                                                                                                                        |
| `document_genere`         |  20   |     |     |     |     |     | 20  | Fichiers réels, contenu non vérifié individuellement (§1.3, §6).                                                                                               |
| `ingredient`              |  19   | 17  |     |     |  2  |     |     | 17 = liste exacte de `INGREDIENTS` (demonstration.ts). 2 = « ZZ… » (30/07).                                                                                    |
| `lot`                     |  19   | 12  |     |     |  3  |  4  |     | 12 = lots de RC-0001/0002/0007/0008. 3 = lots de RC-0003/0004. 4 = lots de RC-0005/0006.                                                                       |
| `conditionnement`         |  17   | 17  |     |     |     |     |     | Les 17 conditionnements de `INGREDIENTS`, prix fictifs assumés par le code.                                                                                    |
| `production_consommation` |  17   |  8  |     |     |     |     |  9  | 8 = PR-2026-0001 (100 % lots démo). 9 = PR-2026-0002 (lots démo **et** plausiblement réels mélangés).                                                          |
| `reception`               |   8   |  4  |     |     |  2  |  2  |     | Voir §3, détail complet.                                                                                                                                       |
| `tache_nettoyage`         |  10   |     |     | 10  |     |     |     | Plan de nettoyage AFSCA, référence système (`seed/afsca.ts`).                                                                                                  |
| `produit_vente_composant` |   9   |  9  |     |     |     |     |     | 9 composants du café `[démo]`, journalisés par `creerComposantVente` dans le script lui-même.                                                                  |
| `recette_ligne`           |   9   |     |  8  |     |  1  |     |     | 8 = lignes réelles de R1 (CLAUDE.md §6). 1 = ligne de `ZZTEST-Q` (débris).                                                                                     |
| `journal_audit`           |  12   |  9  |     |     |  3  |     |     | 9 = création des 9 composants café (par le script). 3 = création des « ZZ… »/`ZZTEST-Q` (30/07).                                                               |
| `session_vente`           |   6   |  3  |     |     |     |     |  3  | 3 = SM-2026-0002 (démo). 3 = SM-2026-0003 (session ambiguë, §1.3).                                                                                             |
| `session_frais`           |   5   |  2  |     |     |     |     |  3  | Idem répartition ci-dessus.                                                                                                                                    |
| `echeance`                |   5   |     |     |  5  |     |     |     | Échéances légales, référence système.                                                                                                                          |
| `produit_vente`           |   4   |  4  |     |     |     |     |     | Les 4 produits `[démo]` — **aucun produit réel n'existe encore dans la base**.                                                                                 |
| `concurrent_produit`      |   4   |  4  |     |     |     |     |     | Prix concurrents `[démo]`.                                                                                                                                     |
| `serie_numero`            |   4   |     |     |  4  |     |     |     | Compteurs système — **valeurs polluées** par les insertions démo (voir §3).                                                                                    |
| `recette`                 |   4   |     |  2  |     |  1  |     |     | R1+R2 = réel-contenu (RC). `CAFE-VIDE` compté à part (fictif structurel, non inclus au total F pour éviter un double compte — voir note). `ZZTEST-Q` = débris. |
| `commande_fournisseur`    |   3   |     |     |     |     |     |  3  | Non rattachées à une réception, indécidables (§1.3).                                                                                                           |
| `commande_ligne`          |   3   |     |     |     |     |     |  3  | Lignes des commandes ci-dessus.                                                                                                                                |
| `fournisseur`             |   3   |  2  |     |  1  |     |     |     | 2 fictifs (`[démo]`). 1 système (« Inventaire d'ouverture »).                                                                                                  |
| `session_marche`          |   3   |  2  |     |     |     |     |  1  | SM-0001 (coquille planifiée, démo) + SM-0002 (démo close). SM-0003 = indécidable.                                                                              |
| `concurrent`              |   2   |  2  |     |     |     |     |     | Les 2 concurrents `[démo]`.                                                                                                                                    |
| `concurrent_observation`  |   2   |  2  |     |     |     |     |     |                                                                                                                                                                |
| `produit_garniture`       |   2   |  2  |     |     |     |     |     |                                                                                                                                                                |
| `production`              |   2   |  1  |     |     |     |     |  1  | PR-2026-0001 (démo, session SM-0002). PR-2026-0002 (session_id null, lots mélangés).                                                                           |
| `meteo_observation`       |   2   |     |     |  2  |     |     |     | Prévisions Open-Meteo réellement récupérées (contenu honnête, quel que soit le déclencheur).                                                                   |
| `lieu_marche`             |   1   |     |     |  1  |     |     |     | « La Batte » — coordonnées et horaires réels (CLAUDE.md), jamais fictifs malgré l'insertion par script.                                                        |
| `nettoyage_execution`     |   1   |     |     |     |     |  1  |     | Initiales « JB », table jamais écrite par un script.                                                                                                           |
| `releve_temperature`      |   1   |     |     |     |     |  1  |     | Idem.                                                                                                                                                          |
| `utilisateur`             |   1   |     |     |  1  |     |     |     | « Propriétaire », créé par `seed()`.                                                                                                                           |

> Note sur `recette` : le tableau ci-dessus compte `CAFE-VIDE` (1 ligne) séparément du total F=130
> de la synthèse — elle est incluse dedans (fictive, structurelle, jamais activée par construction),
> ce qui porte le compte réel de la ligne à 1 F + 2 RC + 1 D = 4, cohérent avec le total de la
> table.

---

## 3. `RC-2026-0007` et `RC-2026-0008` — et ce qu'elles cachent : `RC-2026-0001` et `RC-2026-0002`

### 3.1 Ce que contiennent les deux réceptions demandées

| Numéro         | Bon de livraison             | Fournisseur                         | Date récept. | Créée le (réelle)       | Lot créé                                      | Qté initiale | Restant | Consommé ? |
| -------------- | ---------------------------- | ----------------------------------- | :----------: | ----------------------- | --------------------------------------------- | :----------: | :-----: | :--------: |
| `RC-2026-0007` | `BL-DÉMO-GARNITURE-ÉPICERIE` | `[démo] Fournisseur générique`      |  2026-07-23  | **2026-07-31 11:52:56** | Vergeoise blonde (`DÉMO-VERGEOISE-02`)        |    2000 g    | 2000 g  |  **Non**   |
| `RC-2026-0008` | `BL-DÉMO-GARNITURE-TERROIR`  | `[démo] Producteur local (terroir)` |  2026-07-23  | **2026-07-31 11:52:56** | Sirop de Liège en vrac (`DÉMO-SIROP-VRAC-01`) |    2500 g    | 2500 g  |  **Non**   |

Chacune ne crée **qu'un seul lot** (les deux réceptions « garniture » du script n'ont qu'une
ligne). Aucun mouvement de sortie n'a jamais été écrit sur ces deux lots — confirmé par la même
requête que celle qu'utilise `contrepasserMouvement` (`packages/db/src/services/mouvements.ts`,
somme signée des mouvements du lot) et **recoupé en direct sur le serveur réel** :
`GET /api/stock/{id-ingrédient}/lots` renvoie `quantiteRestante === quantiteInitiale` pour les deux,
et `GET /api/stock/integrite` répond `{"coherent":true,"nbLotsVerifies":19,"lotsFautifs":[]}`.

### 3.2 L'annulation passerait-elle aujourd'hui ? Établi, pas supposé

**Oui pour les deux, à la date de cet audit.** Vérifié en rejouant précisément la logique de
`annulerReception`/`contrepasserMouvement` :

1. `reception.statut = 'active'` pour les deux (pas déjà annulées) → pas de refus
   `reception_deja_annulee`.
2. `periode` est **vide** (0 ligne) → `verifierPeriodeNonVerrouillee` ne bloque jamais, quelle que
   soit la date.
3. Le garde-fou `entree_deja_consommee` compare le restant du lot (`SUM` signée de tous les
   mouvements) à la quantité de l'entrée d'origine : `2000 ≥ 2000` et `2500 ≥ 2500` — **la
   condition de refus ne se déclenche pas**.

`POST /receptions/{id}/annuler` avec un `motifCode` valide contrepasserait donc l'entrée de chacune,
poserait `statut = 'annulee'`, et journaliserait la décision — sans erreur.

### 3.3 La découverte qui change la portée : `RC-2026-0001` et `RC-2026-0002` sont ÉGALEMENT fictives

Non demandées explicitement, mais trouvées en vérifiant que la liste des quatre bons `BL-DÉMO-*`
codés en dur ne s'arrête pas à `RC-2026-0007/0008` :

| Numéro         | Bon de livraison   | Fournisseur                         | Créée le (réelle) | Lignes | Restant global                                                                                                                                                                                 |
| -------------- | ------------------ | ----------------------------------- | ----------------- | :----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RC-2026-0001` | `BL-DÉMO-ÉPICERIE` | `[démo] Fournisseur générique`      | **2026-07-28**    |   8    | **Les 8 lots sont partiellement consommés** (farine 21617/25000, lait 6400/12000, œufs 0/60, beurre 353/2000, vergeoise 311/1000, sel 940/1000, sucre vanillé 0/225, fleur d'oranger 131/250). |
| `RC-2026-0002` | `BL-DÉMO-TERROIR`  | `[démo] Producteur local (terroir)` | **2026-07-28**    |   2    | **Les 2 lots sont partiellement consommés** (24 → 0 restant, 36 → 2 restant).                                                                                                                  |

Ce sont les **deux tout premiers numéros** de la série `RC-2026-*` — antérieurs de trois jours à
l'incident documenté dans `docs/25`, donc issus d'un **épisode distinct et non documenté** où
`db:seed:demo` (ou son équivalent) a déjà écrit dans ce qui était en train de devenir la vraie base,
avant même que le porteur ne commence ses vraies réceptions (`RC-2026-0003` à `RC-2026-0006`,
créées le même jour, 17h04 à 19h10). **Vérifié avec la même méthode qu'au §3.2 : l'annulation de
`RC-2026-0001` et `RC-2026-0002` échouerait aujourd'hui**, sur chacune des 10 lignes, avec le motif
`entree_deja_consommee` — leur matière a réellement servi à la fournée `PR-2026-0001` (session
démo close `SM-2026-0002`) et à la vente `sortie_vente` de 3 lignes (dont une partie sur la session
ambiguë `SM-2026-0003`, §1.3). **La voie conforme (§3 règle 7) leur est donc définitivement
fermée** : ni suppression, ni annulation ne peuvent aujourd'hui les traiter — seule une désactivation
en bloc de tout leur historique aval, ou leur maintien assumé, restent possibles.

---

## 4. Les options — chiffrées, sans recommandation

### Option A — Annuler `RC-2026-0007` et `RC-2026-0008` (les deux seules annulables)

- **Coût** : deux appels `POST /receptions/:id/annuler`, aucune ressaisie requise, réversible par
  nature (contrepassation, pas suppression).
- **Ce qu'elle laisse comme trace** : `reception.statut = 'annulee'` sur les deux, une écriture de
  contrepassation par lot dans `mouvement_stock`, une entrée `journal_audit`. **Les numéros
  `RC-2026-0007` et `RC-2026-0008` restent définitivement consommés** dans la série — c'est le
  principe même de la contrepassation, pas un défaut de l'exécution.
- **Ce que ça ne résout pas** : `RC-2026-0001` et `RC-2026-0002`, tout aussi fictives, restent
  actives et non annulables (§3.3) — cette option **ne couvre que la moitié** des réceptions
  fictives présentes dans la série.
- **Ce qu'un contrôle AFSCA ou un comptable y verrait** : deux documents annulés, datés et motivés,
  strictement conformes à la doctrine « rien ne s'efface » — un contrôleur verrait une correction
  tracée, pas un trou. Il verrait aussi, s'il recoupe la série complète, deux AUTRES réceptions
  (0001, 0002) tout aussi manifestement fictives (fournisseur `[démo]`, notes explicites « réception
  de démonstration ») mais jamais annulées — une incohérence de traitement entre quatre lignes de
  même nature, à justifier.

### Option B — Tout laisser (cohérent avec la décision déjà prise pour le reste du référentiel)

- **Coût** : nul dans l'immédiat.
- **Ce qu'elle laisse comme trace** : les 349 lignes classées ci-dessus restent en base telles
  quelles, y compris les 4 réceptions fictives actives, les 2 lignes de débris de test (`ZZ…`), et
  la zone indéterminate (43 lignes, dont une session entière). **Le compteur `serie_numero` pour
  `reception` reste à 8 alors que 4 des 8 numéros ne représentent aucune vraie livraison** — tout
  totalisateur qui compte « nombre de réceptions » sans filtrer sera faux tant que la distinction
  n'est pas faite à la lecture.
- **Ce qu'un contrôle y verrait** : rien d'anormal dans l'immédiat (aucune donnée n'est fausse au
  sens comptable — les montants et quantités sont ce qu'ils sont), mais un CA ou une consommation
  matière calculés sur la période complète **incluraient les ventes de la session démo
  (`SM-2026-0002`, 838 €, 134 crêpes)** si un filtre par `[démo]`/statut n'est pas appliqué en
  lecture — risque de surestimation du chiffre d'affaires réel tant qu'aucun filtre n'existe dans
  les écrans de synthèse (non vérifié dans cette mission, voir §6).

### Option C — Repartir d'une base propre

Ce que le porteur perdrait, précisément, en repartant de zéro (base migrée mais non seedée) :

- **Ses vraies saisies, mesurées** :
  - `RC-2026-0005` (« BL-MEUNIER-7741 », plausible réel) et `RC-2026-0006`, avec leurs 4 lots et 7
    mouvements de stock ;
  - `nettoyage_execution` (1 ligne, initiales JB) et `releve_temperature` (1 ligne, initiales JB) —
    des saisies AFSCA réelles, datées, qui ne peuvent pas être régénérées après coup sans en
    fausser la date de saisie réelle (CLAUDE.md §7) ;
  - la session `SM-2026-0003` et sa production `PR-2026-0002`, **si** elles s'avèrent réelles à la
    question posée au porteur (§1.3) — perte non quantifiable tant que ce point n'est pas tranché ;
  - les 3 commandes fournisseur (`CF-2026-0001/0002/0003`), même statut indéterminé ;
  - 99 lignes de `parametre` ne sont PAS perdues (recréées à l'identique par `seed()`), de même que
    `motif` (13), `echeance` (5), `tache_nettoyage` (10), `utilisateur` (1) — ce socle système
    revient automatiquement.
- **Ce qui disparaît aussi, et que le porteur devrait ressaisir manuellement** : ses 2 ingrédients
  et sa recette de test (`ZZ…`, `ZZTEST-Q`) — sans valeur à conserver s'ils sont bien des débris,
  mais à confirmer avant de les jeter (§1.2, non prouvé).
- **Ce qu'un comptable y verrait** : la propreté la plus nette des trois options — mais **aucune
  reprise automatique n'existe** pour rejouer les 10-15 lignes plausiblement réelles (P) dans une
  base neuve ; il faudrait les ressaisir une par une, à la main, avec le risque d'erreur que cela
  comporte, et la date de saisie réelle ne serait plus celle d'origine (CLAUDE.md §7 : « le registre
  enregistre ce qui a été saisi, avec sa date de saisie réelle » — recréer ces lignes dans une base
  neuve aujourd'hui leur donnerait une date de saisie fausse, ironiquement le même défaut que celui
  qu'on cherche à corriger).

---

## 5. Le script de nettoyage — écrit, **non exécuté**

**Chemin** :
`C:\Users\jeanb\AppData\Local\Temp\claude\C--Users-jeanb-Desktop-AppCrepe\4a0b963f-bb78-46de-9c20-a01043b227f3\scratchpad\inventaire-base-reelle-0801\nettoyage-demo.cjs`

Conception :

- **Ne touche jamais le fichier SQLite directement.** Il parle exclusivement à l'API HTTP déjà en
  service (`POST /receptions/:id/annuler`, `PATCH` de désactivation `actif=false`) : chaque écriture
  passe donc par la même validation métier, le même journal d'audit et la même contrepassation que
  l'application elle-même produirait — jamais un `UPDATE`/`DELETE` SQL fabriqué à la main.
- **Mode `--dry-run` par défaut**, sans aucune option pour l'éviter silencieusement : il faut
  passer explicitement `--confirmer` pour qu'une seule requête d'écriture parte.
- **Liste blanche figée**, issue exactement de cet audit (les IDs de `RC-2026-0007`/`0008`, les noms
  exacts des 2 fournisseurs, 17 ingrédients, 4 produits et 2 concurrents fictifs). **Il exclut
  explicitement `R1`, `R2` et `La Batte`** (réel-contenu, §1.1) de toute désactivation, même si un
  jour quelqu'un élargissait la liste par erreur.
- **Revérifie l'état en direct avant chaque action** (ne se fie jamais à un instantané) : relit
  `quantiteRestante` avant de tenter l'annulation d'une réception, et **refuse d'agir sur
  `RC-2026-0001`/`RC-2026-0002`**, constatées non annulables (§3.3), en les listant comme « à
  décider autrement » plutôt que d'échouer en silence.
- **Refuse d'exécuter le moindre changement si une ligne rencontrée dans une table ciblée ne
  correspond pas exactement à la liste blanche** — par exemple, si un fournisseur démo a été
  renommé entre-temps, ou si une ligne supplémentaire est apparue : le script s'arrête entièrement,
  n'applique rien, et l'écrit dans son journal. C'est la clause explicitement demandée : le
  discriminant qui ne peut pas trancher une ligne fait échouer tout le lot, jamais une partie
  silencieuse.
- **Ne propose aucune action** sur les catégories D (débris de test), P (plausible réel) ou M
  (indéterminé) — il les liste avec leur identifiant, pour décision humaine, et ne les modifie
  jamais.
- **Journalise** chaque décision (agi / refusé / ignoré) dans un fichier append-only,
  horodaté, dans le même dossier — jamais dans le dépôt.

---

## 6. Ce que cet inventaire NE couvre PAS

- **`document_genere` (20 lignes) n'a pas été vérifié document par document.** Savoir si chaque
  PDF/Excel documente un objet démo, réel ou mixte demanderait de résoudre `objet_id` contre
  chacune des tables ci-dessus, table par table — non fait, faute de temps. Risque concret : un
  registre AFSCA déjà imprimé pourrait porter sur la session démo sans que rien ne le signale à la
  relecture.
- **Aucun écran de synthèse (tableau de bord, comptabilité, seuils légaux) n'a été vérifié pour
  savoir s'il filtre déjà les lignes démo/test avant d'agréger.** Ce document établit CE QUI est
  fictif dans la base ; il n'établit PAS si l'application le sait déjà à la lecture. C'est la
  question la plus consommante pour la suite : si aucun filtre n'existe, le CA affiché aujourd'hui
  inclut déjà les 838 € de la session démo et une partie de la session ambiguë.
  `commande_fournisseur`/`commande_ligne` (indéterminées, §1.3) et `session_marche SM-2026-0003`
  n'ont pas non plus été confrontées à la mémoire du porteur — seule une question directe peut
  trancher ces 43 lignes classées « M ».
- **`serie_numero` n'a pas été audité pour d'autres séries** que `reception` — `session`,
  `production` et `commande` portent chacun au moins une ligne fictive ou indéterminée (SM-0001,
  SM-0002 ; PR-0001 ; les trois `CF-*`) sans que leur compteur en soit pour autant « faux » au sens
  strict (un compteur qui avance à chaque insertion, démo ou pas, reste correct dans son rôle —
  seule la SIGNIFICATION du total en est polluée).
- **Aucune vérification n'a porté sur les sauvegardes antérieures au 28/07/2026** pour dater
  précisément le tout premier épisode de mélange (`RC-2026-0001`/`0002`) — établi ici comme
  antérieur au 31/07, pas daté plus précisément faute d'avoir ouvert d'autres fichiers de
  `sauvegardes/`.
- **La question posée au porteur au §1.3 (SM-2026-0003 est-elle une vraie session ?) n'a pas de
  réponse dans ce document** : c'est une question, pas une conclusion — répondre à sa place aurait
  été deviner une règle métier, exactement ce que `CLAUDE.md` §9 interdit.
