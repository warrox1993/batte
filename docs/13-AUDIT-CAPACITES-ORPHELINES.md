# 13 — Audit des capacités orphelines

> **Objet.** Recenser ce qui est **construit mais inatteignable** : routes exposées qu'aucun écran
> n'appelle, écrans et routes annoncés par la spécification et absents du code, tables et colonnes
> que rien n'écrit ou que rien ne lit, fonctions exportées sans appelant de production.
>
> **Date.** 28/07/2026. **Nature.** Audit — aucune correction n'a été appliquée **au moment de la
> rédaction**. Voir l'encadré de mise à jour ci-dessous : la plupart l'ont été depuis.
>
> **Pourquoi cet audit.** Ces défauts ont un profil commun : **rien ne les signale**. Le typage est
> content, les tests passent, `npm run lint` est vert. Ils n'apparaissent qu'en confrontant ce qui
> est _offert_ à ce qui est _consommé_.

> **Mise à jour du 30/07/2026 — cet audit est en grande partie périmé, dans le bon sens.**
>
> Vérifié à nouveau contre le code du 30/07/2026 : la quasi-totalité des « trous » de gravité 1 et 2
> listés en §4, et la quasi-totalité des orphelins listés en §5.1/§5.2, ont un appelant de
> production aujourd'hui. Chaque section concernée porte désormais son propre encadré « Mise à jour
> du 30/07/2026 » avec le `fichier:ligne` de preuve, sur le modèle de §5.4 (déjà corrigé par ailleurs
> et non retraité ici). Restent au milieu du gué et **non corrigés** au 30/07 :
>
> - `productionsDuLot` et `lireSeries` (§5.2) — toujours sans appelant hors barrel.
> - Le brief avant-marché (`GET /api/prevision/brief`, §4.4) et l'analyse d'écart post-session
>   (`POST /api/ia/analyse-ecart/:id`, §4.5), ainsi que `GET /api/ia/etat` et `GET /api/ia/journal`
>   (§4.6) — toujours orphelins, aucun écran de `apps/web/src` ne les référence.
> - ~~Le versionnage de recette au sens strict (`recette.recette_parent_id`, §3.2) — toujours jamais
>   écrit.~~ **Correction du 30/07/2026, contrôle plus tardif dans la même soirée : c'est fait.**
>   `creerVersionRecette` (`packages/db/src/depots/referentiel-ecriture.ts:1157-1206`) écrit
>   `recetteParentId: parentId` à l'insertion, est appelée par la route
>   `POST /recettes/:id/versions` (`apps/api/src/routes/referentiel-ecriture.ts:299`), elle-même
>   appelée par `apps/web/src/pages/Recettes.tsx:1389` (mode « versionnage » du formulaire, avec
>   message de confirmation dédié `:1398-1403`). Le code a bougé entre la rédaction de cet encadré
>   et cette relecture — exactement la raison pour laquelle la consigne est de relire le code au
>   moment d'écrire, pas de faire confiance à un contrôle antérieur, même du même soir. Voir §2.1 et
>   §3.2 pour la correction à l'endroit exact.
>
> **Ce que je n'ai PAS refait : un nouveau recensement complet.** Douze nouveaux fichiers de routes
> sont apparus depuis le 28/07 (`audit.ts`, `concurrents.ts`, `documents.ts`, `economies.ts`,
> `equipements.ts`, `evenements-decouverte.ts`, `factures.ts`, `lieux-rentabilite.ts`, `menus.ts`,
> `nomenclature-vente.ts`, `objectifs.ts`, `referentiel-ecriture.ts` — compté par
> `find apps/api/src/routes -iname "*.ts" ! -iname "*.test.ts"`, 24 fichiers au 30/07 contre 12
> implicitement couverts par le tableau de §1). **Les chiffres de tête — « 76 routes », « 41 tables »,
> « 416 symboles » (§0, §1, §3.1, §5, §7) — sont donc mécaniquement dépassés**, mais un audit sens
> A/B/C/D exhaustif sur le périmètre élargi est un nouvel audit, pas une correction ; je ne l'ai pas
> fait et je ne invente aucun chiffre de remplacement. Si ce recensement est nécessaire, il doit être
> commandé comme un audit à part entière.
>
> **Un seul chiffre de tête recompté, sans refaire l'audit de consommation** : le nombre BRUT de
> routes déclarées. `grep -oE "app\.(get|post|put|patch|delete)(<[^>]*>)?\(" apps/api/src/routes/*.ts`
> (hors fichiers `*.test.ts`) trouve **168 déclarations de route** au 30/07/2026, contre 76 le
> 28/07/2026 — plus du double. Ce chiffre mesure des déclarations, pas des routes distinctes
> consommées par un écran (§1/§2) : il ne remplace donc PAS « 76 routes exposées, 69 consommées,
> 7 orphelines » de §0/§1.13, qui reste, lui, un audit de consommation non refait sur le périmètre
> élargi.

---

## 0. Méthode

| Sens  | Question                                                                           | Source de vérité                                                                                      |
| ----- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **A** | Quelles routes exposées ne sont appelées par aucun écran ?                         | Table de routage Fastify réelle (hook `onRoute` sur `construireServeur`), pas la lecture des fichiers |
| **B** | Qu'annonce la doc qui n'existe pas ?                                               | `docs/01`, `docs/04`, `docs/06` confrontés au code                                                    |
| **C** | Quelles tables / colonnes sont écrites sans être lues, ou lues sans être écrites ? | Balayage de tous les `.insert()`, `.update()`, `.from()`, `.innerJoin()` hors tests                   |
| **D** | Quelles fonctions exportées n'ont aucun appelant de production ?                   | Recherche du symbole exact, en écartant les barrels et les tests                                      |

Trois précautions ont été prises, parce que chacune change le résultat :

1. **La liste des routes vient de Fastify, pas des fichiers.** `app.printRoutes()` compresse les
   préfixes communs (`/api/previsions` s'affiche `s` sous `/api/prevision`) : la liste plate a donc
   été extraite via un hook `onRoute`, qui donne méthode + URL complète sans interprétation.
2. **Les appels côté web sont dynamiques.** Ils passent tous par `requeteApi(chemin)` avec des
   gabarits de chaîne (`` `/sessions/${id}/cloturer` ``) et, dans deux écrans, par une variable
   `chemin` calculée (`Fournisseurs.tsx:355`, `Produits.tsx:360`). Une recherche littérale rate la
   moitié des cas ; chaque appel a été résolu à la main.
3. **Un test n'est pas un consommateur.** Les sept routes orphelines de la section A sont **toutes
   exercées par `apps/api/src/routes/integration.test.ts`**. C'est précisément pour cela qu'elles ne
   se voient pas.

**Décompte.** **76 routes exposées** (hors `HEAD`, ajoutées automatiquement par Fastify pour chaque
`GET`) — **69 consommées par l'interface**, **7 orphelines**, **0 fantôme** (aucun écran n'appelle
une route inexistante).

> **Mise à jour du 30/07/2026 — ce décompte est périmé, sans qu'un nouveau total fiable puisse être
> donné ici.** La méthode d'origine (hook `onRoute` sur le serveur réel, §0 note 1) n'a pas été
> rejouée ; un simple grep statique de `app\.(get|post|put|patch|delete)` sur-compte (les generics
> TypeScript comme `app.get<{ Params: … }>(` cassent un grep naïf dans un sens ou dans l'autre) et
> ne peut donc pas se substituer honnêtement au chiffre d'origine. Ce qui est vérifié par lecture
> directe, en revanche : **au moins deux fichiers de routes entiers sont apparus depuis cet audit**
> et ne figurent dans aucun des tableaux §1 ci-dessous — `apps/api/src/routes/audit.ts`
> (`GET /api/audit`, lecture du journal d'audit) et
> `apps/api/src/routes/referentiel-ecriture.ts` (18 routes : création/modification d'ingrédients,
> conditionnements, recettes — y compris `POST /recettes/:id/versions` — et lieux de marché).
> Les deux sont consommées par des écrans réels (`apps/web/src/pages/JournalAudit.tsx`,
> `apps/web/src/pages/Recettes.tsx`, `Ingredients.tsx`/écrans référentiel). Voir §4.7 et §4.9 :
> les deux plus gros « TROU » de cet audit sont refermés. **76/69/7 est donc un plancher, pas un
> compte à jour** — une nouvelle passe avec la méthode `onRoute` d'origine serait nécessaire pour
> un chiffre exact.

---

## 1. Sens A — table de correspondance complète des 76 routes

Colonne « Consommée par » : fichier et ligne de l'appel `requeteApi` correspondant.

### 1.1 AFSCA — `apps/api/src/routes/afsca.ts`

| Route                                          | Déclarée       | Consommée par                                      |
| ---------------------------------------------- | -------------- | -------------------------------------------------- |
| `GET /api/afsca/temperatures`                  | `afsca.ts:57`  | `RegistreAfsca.tsx:259`                            |
| `POST /api/afsca/temperatures`                 | `afsca.ts:76`  | `RegistreAfsca.tsx:304`                            |
| `GET /api/afsca/nettoyage/taches`              | `afsca.ts:96`  | `RegistreAfsca.tsx:696`                            |
| `GET /api/afsca/nettoyage/taches-en-retard`    | `afsca.ts:105` | `RegistreAfsca.tsx:664` ; `TableauDeBord.tsx:476`  |
| `POST /api/afsca/nettoyage/executions`         | `afsca.ts:114` | `RegistreAfsca.tsx:753`                            |
| `GET /api/afsca/nettoyage/executions`          | `afsca.ts:129` | `RegistreAfsca.tsx:678`                            |
| `GET /api/afsca/non-conformites`               | `afsca.ts:143` | `RegistreAfsca.tsx:1052` ; `TableauDeBord.tsx:477` |
| `POST /api/afsca/non-conformites`              | `afsca.ts:159` | `RegistreAfsca.tsx:1107`                           |
| `POST /api/afsca/non-conformites/:id/cloturer` | `afsca.ts:176` | `RegistreAfsca.tsx:1148`                           |
| `POST /api/afsca/exercices-tracabilite`        | `afsca.ts:184` | `RegistreAfsca.tsx:1955`                           |
| `GET /api/afsca/exercices-tracabilite`         | `afsca.ts:199` | `RegistreAfsca.tsx:1915`                           |
| `GET /api/afsca/tracabilite/sessions/:id`      | `afsca.ts:210` | `RegistreAfsca.tsx:1620`                           |
| `GET /api/afsca/tracabilite/lots/:id`          | `afsca.ts:216` | `RegistreAfsca.tsx:1635`                           |

**13/13 consommées.** Le module AFSCA est le plus complètement branché de l'application.

### 1.2 Commandes — `apps/api/src/routes/commandes.ts`

| Route                             | Déclarée           | Consommée par                                |
| --------------------------------- | ------------------ | -------------------------------------------- |
| `GET /api/commandes`              | `commandes.ts:98`  | `Achats.tsx:282` ; `SaisieReception.tsx:224` |
| `GET /api/commandes/:id`          | `commandes.ts:103` | `Achats.tsx:308`                             |
| **`GET /api/commandes/:id/pdf`**  | `commandes.ts:115` | **— ORPHELINE**                              |
| `POST /api/commandes/generer`     | `commandes.ts:132` | `Achats.tsx:361`                             |
| `POST /api/commandes/:id/valider` | `commandes.ts:147` | `Achats.tsx:389`                             |
| `POST /api/commandes/:id/envoyer` | `commandes.ts:163` | `Achats.tsx:437`                             |

### 1.3 Comptabilité — `apps/api/src/routes/comptabilite.ts`

| Route                                   | Déclarée              | Consommée par                                    |
| --------------------------------------- | --------------------- | ------------------------------------------------ |
| `GET /api/depenses`                     | `comptabilite.ts:62`  | `Comptabilite.tsx:592`                           |
| `POST /api/depenses`                    | `comptabilite.ts:77`  | `Comptabilite.tsx:682`                           |
| `POST /api/depenses/:id/annuler`        | `comptabilite.ts:106` | `Comptabilite.tsx:719`                           |
| `GET /api/immobilisations`              | `comptabilite.ts:119` | `Comptabilite.tsx:611`                           |
| `POST /api/immobilisations`             | `comptabilite.ts:128` | `Comptabilite.tsx:768`                           |
| `GET /api/echeances`                    | `comptabilite.ts:152` | `Comptabilite.tsx:627` ; `TableauDeBord.tsx:478` |
| `POST /api/echeances/:id/marquer-faite` | `comptabilite.ts:161` | `Comptabilite.tsx:796`                           |
| `GET /api/periodes`                     | `comptabilite.ts:172` | `Comptabilite.tsx:640`                           |
| `POST /api/periodes/cloturer`           | `comptabilite.ts:177` | `Comptabilite.tsx:822`                           |
| `POST /api/periodes/:id/rouvrir`        | `comptabilite.ts:186` | `Comptabilite.tsx:845`                           |
| `GET /api/synthese-exercice`            | `comptabilite.ts:197` | `Comptabilite.tsx:579`                           |

**11/11 consommées.**

### 1.4 Assistance Claude — `apps/api/src/routes/ia.ts`

| Route                                | Déclarée   | Consommée par   |
| ------------------------------------ | ---------- | --------------- |
| **`GET /api/ia/etat`**               | `ia.ts:38` | **— ORPHELINE** |
| **`GET /api/ia/journal`**            | `ia.ts:60` | **— ORPHELINE** |
| **`POST /api/ia/analyse-ecart/:id`** | `ia.ts:71` | **— ORPHELINE** |

**0/3 consommées.** Module entièrement orphelin.

### 1.5 Paramètres — `apps/api/src/routes/parametres.ts`

| Route                                | Déclarée           | Consommée par        |
| ------------------------------------ | ------------------ | -------------------- |
| `GET /api/parametres`                | `parametres.ts:49` | `Parametres.tsx:202` |
| `PATCH /api/parametres/:id`          | `parametres.ts:57` | `Parametres.tsx:637` |
| `POST /api/parametres/:cle/versions` | `parametres.ts:80` | `Parametres.tsx:510` |

**3/3 consommées.** Le versionnage annuel des seuils légaux, signalé comme inatteignable des deux
côtés lors d'un audit précédent, est **désormais complètement branché** (voir §6.1).

### 1.6 Prévision et événements — `apps/api/src/routes/previsions.ts`

| Route                           | Déclarée            | Consommée par                                        |
| ------------------------------- | ------------------- | ---------------------------------------------------- |
| `GET /api/prevision`            | `previsions.ts:264` | `ProchaineSession.tsx:133` ; `TableauDeBord.tsx:456` |
| `POST /api/prevision/archiver`  | `previsions.ts:270` | `ProchaineSession.tsx:164`                           |
| `POST /api/prevision/commenter` | `previsions.ts:294` | `ProchaineSession.tsx:267`                           |
| **`GET /api/prevision/brief`**  | `previsions.ts:314` | **— ORPHELINE**                                      |
| `GET /api/previsions`           | `previsions.ts:387` | `QualiteModele.tsx:131`                              |
| `GET /api/qualite-modele`       | `previsions.ts:392` | `QualiteModele.tsx:131`                              |
| `GET /api/evenements`           | `previsions.ts:394` | `Evenements.tsx:236`                                 |
| `POST /api/evenements`          | `previsions.ts:399` | `Evenements.tsx:395`                                 |

### 1.7 Production — `apps/api/src/routes/productions.ts`

| Route                                | Déclarée             | Consommée par        |
| ------------------------------------ | -------------------- | -------------------- |
| `POST /api/productions/faisabilite`  | `productions.ts:45`  | `Production.tsx:527` |
| `GET /api/productions`               | `productions.ts:66`  | `Production.tsx:555` |
| `GET /api/productions/:id`           | `productions.ts:71`  | `Production.tsx:585` |
| `POST /api/productions`              | `productions.ts:83`  | `Production.tsx:681` |
| `PATCH /api/productions/:id/realise` | `productions.ts:104` | `Production.tsx:724` |

**5/5 consommées.**

### 1.8 Recettes — `apps/api/src/routes/recettes.ts`

| Route                             | Déclarée         | Consommée par                                                  |
| --------------------------------- | ---------------- | -------------------------------------------------------------- |
| `GET /api/recettes`               | `recettes.ts:51` | `Recettes.tsx:269` ; `Production.tsx:465` ; `Produits.tsx:198` |
| `GET /api/recettes/:id`           | `recettes.ts:56` | `Recettes.tsx:299`                                             |
| `POST /api/recettes/:id/calculer` | `recettes.ts:62` | `Recettes.tsx:361`                                             |

**3/3 consommées** — mais aucune écriture n'existe (voir §2.1).

### 1.9 Référentiel — `apps/api/src/routes/referentiel.ts`

| Route                                  | Déclarée             | Consommée par                                      |
| -------------------------------------- | -------------------- | -------------------------------------------------- |
| `GET /api/fournisseurs`                | `referentiel.ts:77`  | `Fournisseurs.tsx:214` ; `SaisieReception.tsx:222` |
| `POST /api/fournisseurs`               | `referentiel.ts:82`  | `Fournisseurs.tsx:356` (branche création)          |
| `PATCH /api/fournisseurs/:id`          | `referentiel.ts:90`  | `Fournisseurs.tsx:356` (branche modification)      |
| `PATCH /api/fournisseurs/:id/activite` | `referentiel.ts:99`  | `Fournisseurs.tsx:385`                             |
| `GET /api/produits`                    | `referentiel.ts:117` | `Produits.tsx:189`                                 |
| `POST /api/produits`                   | `referentiel.ts:122` | `Produits.tsx:363` (branche création)              |
| `PATCH /api/produits/:id`              | `referentiel.ts:130` | `Produits.tsx:363` (branche modification)          |
| `PATCH /api/produits/:id/activite`     | `referentiel.ts:138` | `Produits.tsx:391`                                 |
| `GET /api/ingredients`                 | `referentiel.ts:147` | `SaisieReception.tsx:223` ; `Produits.tsx:199`     |

**9/9 consommées.** Les deux `chemin` variables (`Fournisseurs.tsx:355`, `Produits.tsx:360`) sont
la raison pour laquelle une recherche littérale de `'/fournisseurs/'` conclurait à tort à
l'orphelinage de deux `PATCH`.

### 1.10 Santé — `apps/api/src/routes/sante.ts`

| Route                | Déclarée      | Consommée par                                    |
| -------------------- | ------------- | ------------------------------------------------ |
| **`GET /api/sante`** | `sante.ts:12` | **— ORPHELINE** (sonde de diagnostic, voir §6.2) |

### 1.11 Sessions — `apps/api/src/routes/sessions.ts`

| Route                             | Déclarée          | Consommée par                                |
| --------------------------------- | ----------------- | -------------------------------------------- |
| `GET /api/lieux`                  | `sessions.ts:35`  | `Sessions.tsx:768`                           |
| `GET /api/produits-vendables`     | `sessions.ts:40`  | `Sessions.tsx:789`                           |
| `GET /api/sessions`               | `sessions.ts:48`  | `Sessions.tsx:732` ; `TableauDeBord.tsx:516` |
| `GET /api/sessions/:id`           | `sessions.ts:53`  | `Sessions.tsx:1052`, `1074`                  |
| `POST /api/sessions`              | `sessions.ts:59`  | `Sessions.tsx:1013`                          |
| `POST /api/sessions/:id/cloturer` | `sessions.ts:81`  | `Sessions.tsx:1244`                          |
| `POST /api/sessions/:id/annuler`  | `sessions.ts:116` | `Sessions.tsx:1280`                          |
| `GET /api/seuils`                 | `sessions.ts:132` | `Sessions.tsx:746` ; `TableauDeBord.tsx:502` |

**8/8 consommées.**

### 1.12 Stock — `apps/api/src/routes/stock.ts`

| Route                               | Déclarée       | Consommée par                             |
| ----------------------------------- | -------------- | ----------------------------------------- |
| `GET /api/stock`                    | `stock.ts:37`  | `Stock.tsx:392` ; `TableauDeBord.tsx:475` |
| `GET /api/stock/:ingredientId/lots` | `stock.ts:57`  | `Stock.tsx:425`                           |
| `GET /api/motifs`                   | `stock.ts:85`  | `SaisieSortie.tsx:133`                    |
| `POST /api/receptions`              | `stock.ts:96`  | `SaisieReception.tsx:542`                 |
| `POST /api/mouvements`              | `stock.ts:123` | `SaisieSortie.tsx:203`                    |
| **`GET /api/lots/:lotId`**          | `stock.ts:155` | **— ORPHELINE**                           |

`POST /api/receptions` et `POST /api/mouvements`, orphelines depuis le Lot 2, sont **désormais
branchées** (voir §6.1).

### 1.13 Récapitulatif des 7 orphelines

| Route                            | Fichier:ligne       | Exercée par un test ?                                 | Classement (§5)           |
| -------------------------------- | ------------------- | ----------------------------------------------------- | ------------------------- |
| `POST /api/ia/analyse-ecart/:id` | `ia.ts:71`          | oui — `integration.test.ts:1645`, `1756`              | **TROU**                  |
| `GET /api/prevision/brief`       | `previsions.ts:314` | oui — `integration.test.ts:1701`                      | **TROU**                  |
| `GET /api/ia/etat`               | `ia.ts:38`          | oui — `integration.test.ts:1571`, `1595`              | **TROU**                  |
| `GET /api/ia/journal`            | `ia.ts:60`          | oui — `integration.test.ts:1653`                      | **TROU**                  |
| `GET /api/commandes/:id/pdf`     | `commandes.ts:115`  | oui — `integration.test.ts:165`, `1881`               | **TROU** (mineur)         |
| `GET /api/lots/:lotId`           | `stock.ts:155`      | oui — `integration.test.ts:625`, `2090`               | **PRÉMATURÉ** (redondant) |
| `GET /api/sante`                 | `sante.ts:12`       | oui — `integration.test.ts:481`, `serveur.test.ts:33` | **NORMAL**                |

> **Mise à jour du 30/07/2026.** `GET /api/commandes/:id/pdf` n'est plus orpheline : elle est
> consommée par `apps/web/src/pages/Achats.tsx:751`
> (`chemin={`/commandes/${detailCourant.id}/pdf`}`, via le composant `BoutonDocument`). Voir §4.10.
> Les six autres lignes de ce tableau restent orphelines, vérifiées à nouveau le 30/07/2026 par un
> grep sur `apps/web/src` qui ne renvoie aucune occurrence de `ia/etat`, `ia/journal`,
> `ia/analyse-ecart`, `prevision/brief`, ni d'un appel à `GET /api/lots/:lotId` (par opposition à
> `/lots/:id/mouvements` et `/lots/:id/statut`, deux routes différentes consommées par
> `apps/web/src/saisie-stock/DetailLot.tsx:184,272`).

---

## 2. Sens B — annoncé par la documentation, absent du code

Toutes les déclarations d'endpoints explicites de la documentation se trouvent dans
`docs/06-UI-ET-PARCOURS.md` lignes 196–225 (bloc « Conventions d'API »). `docs/01` et `docs/04`
n'énoncent aucun chemin `/api` : ils annoncent des **capacités**, traitées en §2.2 et §2.3.

### 2.1 Routes annoncées et absentes

| Route annoncée                           | Doc           | Existe ?                                  | Équivalent                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/recettes`                     | `docs/06:198` | ~~**non**~~ **oui, au 30/07/2026**        | ~~aucun — une recette ne peut naître que du seed~~ **corrigé** : `POST /recettes` (`apps/api/src/routes/referentiel-ecriture.ts:263`), appelé depuis l'écran par `apps/web/src/pages/Recettes.tsx:1393` (chemin calculé, `:1388-1391`)                                                                                                                                            |
| `PATCH /api/recettes/:id`                | `docs/06:200` | ~~**non**~~ **oui, au 30/07/2026**        | ~~aucun — une recette est en lecture seule à vie~~ **corrigé** : `PATCH /recettes/:id` (`referentiel-ecriture.ts:280`), même appel `Recettes.tsx:1393` avec `methode = 'PATCH'` en mode modification                                                                                                                                                                              |
| `POST /api/recettes/:id/versions`        | `docs/06:201` | ~~**non**~~ **oui, depuis le 30/07/2026** | ~~aucun — le versionnage existe **en base** (`schema.ts:229`, index unique `schema.ts:256`, décision D-005) et n'a aucun déclencheur~~ **corrigé** : `POST /recettes/:id/versions` (`apps/api/src/routes/referentiel-ecriture.ts:299`) appelle `creerVersionRecette` (`packages/db/src/depots/referentiel-ecriture.ts:1157`), consommé par `apps/web/src/pages/Recettes.tsx:1389` |
| `POST /api/inventaires`                  | `docs/06:207` | **non**                                   | `POST /api/receptions`, choix assumé et documenté dans `InventaireInitial.tsx:11-27`                                                                                                                                                                                                                                                                                              |
| `GET /api/previsions/prochaine?lieuId=…` | `docs/06:215` | **non**                                   | `GET /api/prevision` (singulier, sans filtre de lieu)                                                                                                                                                                                                                                                                                                                             |
| `POST /api/previsions/recalculer`        | `docs/06:216` | **non**                                   | partiellement `GET /api/prevision?rafraichirMeteo=1`                                                                                                                                                                                                                                                                                                                              |
| `GET /api/documents/:type/:id`           | `docs/06:221` | **non**                                   | 2 routes ad hoc sur 8 types de documents                                                                                                                                                                                                                                                                                                                                          |
| `GET /api/exports/:type`                 | `docs/06:222` | **non**                                   | **aucune** — aucune route Excel n'existe                                                                                                                                                                                                                                                                                                                                          |
| `POST /api/ia/:usage`                    | `docs/06:224` | **non**                                   | 2 usages sur 5 exposés par des routes ad hoc                                                                                                                                                                                                                                                                                                                                      |

Deux fichiers de routes **citent eux-mêmes la route générique manquante** en commentaire :
`commandes.ts:111` et `previsions.ts:310` renvoient tous deux à
« `docs/06 §"Conventions d'API"`, `GET /api/documents/:type/:id` ».

> **Mise à jour du 30/07/2026.** Les deux routes génériques existent désormais, sous une forme non
> paramétrique mais fonctionnellement équivalente : `apps/api/src/routes/documents.ts` (nouveau
> fichier, en-tête ligne 1-24, écrit explicitement « Routes `/api/documents` et `/api/exports` —
> les documents que l'application sait produire mais qu'aucune adresse HTTP n'exposait ») expose
> `GET /documents/fiche-technique/:id` (`:111`), `GET /documents/affichette-allergenes` (`:139`),
> `GET /documents/etiquette-bac/:id` (`:169`), `GET /documents/rapport-session/:id` (`:205`),
> `GET /documents/registre-afsca?periode=` (`:242`), et quatre routes Excel :
> `GET /exports/stock` (`:269`), `GET /exports/journal-recettes` (`:284`),
> `GET /exports/journal-achats` (`:302`), `GET /exports/mouvements` (`:320`). Voir §2.3 pour l'état
> de leur consommation côté écran.

### 2.2 Écrans et gestes annoncés et absents

| Geste annoncé                                                                                                 | Doc                                                  | État                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Écran d'**inventaire de comptage périodique** (écart théorique/compté)                                        | `docs/01:72-75` ; `docs/04:48` ; `docs/06:258`       | `InventaireInitial.tsx` couvre l'inventaire **d'ouverture** seulement. L'écart négatif passe par `SaisieSortie` avec motif `INVENTAIRE_ECART` ; l'écart **positif** n'a aucune voie |
| **Créer / éditer une recette**, gérer ses versions                                                            | `docs/01:288` ; `docs/04:30`                         | `Recettes.tsx` = liste + fiche + calculateur. Aucun formulaire, aucun bouton de version                                                                                             |
| **Créer / éditer un ingrédient**, ses conditionnements                                                        | `docs/01:52-56` ; `docs/04:29-30`                    | aucun écran, aucune route d'écriture                                                                                                                                                |
| **Créer un lieu de marché**                                                                                   | `docs/06:254`                                        | `GET /api/lieux` seul ; un second marché est impossible sans toucher au seed                                                                                                        |
| Écran d'accueil de **premier lancement** avec cases à cocher persistantes                                     | `docs/06:250-264`                                    | absent ; seul un `EtatVide variante="premier-lancement"` existe                                                                                                                     |
| Boutons **« Ajuster »** et **« Lancer la production »** sur Prochaine session, avec motif d'écart obligatoire | `docs/06:117-121` ; `docs/01:113-114`                | `ProchaineSession.tsx` n'a que « Rafraîchir la météo », « Archiver », « Demander un avis »                                                                                          |
| **Facteurs cliquables** sur Prochaine session                                                                 | `docs/06:120`                                        | aucun `onClick` sur les facteurs                                                                                                                                                    |
| **Températures dans l'écran de clôture de session**                                                           | `docs/06:144-151` ; `docs/01:146`                    | aucune occurrence de « température » dans `Sessions.tsx` ; la saisie n'existe que dans `RegistreAfsca.tsx` — exactement l'« ailleurs » que `docs/06:149-151` voulait éviter         |
| **Consulter le journal IA / le plafond mensuel**                                                              | `docs/01:189-190` ; `docs/04:161-162` ; CLAUDE.md §5 | routes présentes, **aucun écran ne les appelle**                                                                                                                                    |
| **Analyse d'écart post-session**                                                                              | `docs/01:184`                                        | route présente, **aucun écran ne l'appelle**                                                                                                                                        |
| **Lecture d'un bon de livraison par Claude**                                                                  | `docs/01:63-64`, `:186`                              | absent — `ia/usages.ts` n'expose que 3 prompts sur 5 usages typés (`core/ia.ts:18`)                                                                                                 |
| **Aide à la saisie d'événements** par Claude                                                                  | `docs/01:185`                                        | absent                                                                                                                                                                              |
| **Synthèse mensuelle / trimestrielle** par Claude                                                             | `docs/01:187`                                        | absent                                                                                                                                                                              |
| Colonne **« couverture en sessions »** et bouton **« Générer les commandes »** sur l'écran Stock              | `docs/06:157-168`                                    | absents de `Stock.tsx` ; le bouton existe, mais dans `Achats.tsx:361`                                                                                                               |
| Paramètres **SMTP, clés API, sauvegarde** dans l'écran Paramètres                                             | `docs/01:294`                                        | absents — la configuration SMTP vit dans `.env` (`apps/api/src/mail.ts:64-92`)                                                                                                      |
| **Sauvegarde manuelle en un clic**, **import/export JSON**                                                    | `docs/01:301-303` ; `docs/04:198`                    | seule la sauvegarde **automatique** au démarrage existe (`packages/db/src/sauvegarde.ts`)                                                                                           |
| **Historique des mouvements** à l'écran Stock                                                                 | `docs/01:289`                                        | **il n'existe aucun `GET /api/mouvements`** — l'écran ne peut afficher que l'état et les lots                                                                                       |
| Axes analytiques **par créneau horaire, par canal, par recette, par produit**                                 | `docs/01:237-243`                                    | absents de `Comptabilite.tsx`. La colonne `session_vente.creneau_horaire` est saisissable mais n'alimente aucune analyse                                                            |
| **Coût de revient complet par crêpe** (matière + emplacement + déplacement + gaz + amortissement + SumUp)     | `docs/01:246-247`                                    | aucun agrégat ne le produit                                                                                                                                                         |

> **Mise à jour du 30/07/2026 sur quatre lignes de ce tableau :**
>
> - **Créer / éditer un ingrédient** : câblé. `apps/api/src/routes/referentiel-ecriture.ts:138`
>   (`POST /ingredients`) est appelé par `apps/web/src/pages/Recettes.tsx:1186`, et un écran dédié
>   `apps/web/src/pages/Ingredients.tsx` existe désormais.
> - **Créer un lieu de marché** : câblé. `referentiel-ecriture.ts:332` (`POST /lieux`) et la
>   désactivation `PATCH /lieux/:id/activite` sont consommés par un nouvel écran
>   `apps/web/src/pages/LieuxMarche.tsx:419,445` (variable `chemin`/`methode`, même motif que
>   `Fournisseurs.tsx:355` déjà signalé §1.9 — une recherche littérale l'aurait raté).
> - **Créer / éditer une recette** : partiellement câblé, pas au sens où ce tableau l'entendait.
>   `POST /recettes` (`referentiel-ecriture.ts:263`) et `PATCH /recettes/:id/statut`
>   (`referentiel-ecriture.ts:310`) existent et ce dernier est consommé
>   (`Recettes.tsx:1436`, changement de statut brouillon/actif). Je n'ai en revanche trouvé **aucun
>   appel** à `POST /recettes` (création d'une recette entière) dans `apps/web/src` — seule la
>   création d'un ingrédient _au sein_ d'une ligne de recette existante est câblée. Créer une
>   recette de toutes pièces depuis l'écran reste donc, sauf erreur de ma part, hors de portée.
>
>   > **Rectification du 30/07/2026, plus tard dans la même soirée — « sauf erreur de ma part »
>   > était bien une erreur, et c'est le piège que ce document dénonce lui-même en §0 note 2.**
>   > `POST /recettes` **est** appelé depuis l'écran : `apps/web/src/pages/Recettes.tsx:1388-1391`
>   > construit une variable `chemin` — `'/recettes'` en mode création, `/recettes/:id/versions` en
>   > mode versionnage, `/recettes/:id` en modification — puis `:1393` émet
>   > `requeteApi(chemin, { method: methode, … })` avec `methode = 'POST'` à la création. C'est
>   > **exactement** le motif de `Fournisseurs.tsx:355` et `Produits.tsx:360` que §0 note 2 et §1.9
>   > signalent comme rendant une recherche littérale trompeuse : chercher la chaîne
>   > `'/recettes'` suivie d'un `POST` ne trouve rien, parce que le chemin est calculé. Créer une
>   > recette entièrement nouvelle depuis l'écran **est** donc possible aujourd'hui, et `PATCH
/recettes/:id` (modification en place) l'est aussi, par la même ligne. Corollaire : la ligne
>   > correspondante de §2.1 (`POST /api/recettes` et `PATCH /api/recettes/:id` donnés « non ») est
>   > à lire avec cette rectification, et §4.7 ci-dessous porte la même erreur, rectifiée sur place.
>
> - **Coût de revient complet** : `apps/api/src/routes/recettes.ts:110` expose désormais
>   `GET /couts-produits`, dont le commentaire (`:100-104`) dit explicitement intégrer « part de
>   pâte + garnitures ». Voir §4.1, où le chiffre faux du coût matière est corrigé par la même
>   occasion. Ce n'est pas encore le coût _complet_ de `docs/01:246-247` (emplacement, déplacement,
>   gaz, amortissement, SumUp) : je n'ai vérifié que la composante matière + garniture.

### 2.3 Documents générés — la rupture la plus large

`docs/04:118` fixe le critère de fin du Lot 6 : « Je génère les **sept PDF** et les **quatre
Excel** ». Voici l'état réel.

| #   | Document                               | Doc                                                       | Gabarit dans le code                                                                             | Route                        | Bouton d'écran |
| --- | -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------- | -------------- |
| 1   | Fiche technique de recette             | `docs/01:41`, `:288`                                      | `gabarits.ts:74` `ficheTechnique`                                                                | **aucune**                   | aucun          |
| 2   | **Affichette allergènes**              | `docs/01:42` ; `docs/04:206` (minimum vital)              | `gabarits.ts:157` `affichetteAllergenes`                                                         | **aucune**                   | aucun          |
| 3   | Étiquette de bac de pâte               | `docs/01:43`                                              | `gabarits.ts:208` `etiquetteBac`                                                                 | **aucune**                   | aucun          |
| 4   | Bon de commande fournisseur            | `docs/01:99` ; `docs/04:133-135`                          | `gabarits.ts:616` `bonCommande`                                                                  | `GET /api/commandes/:id/pdf` | **aucun**      |
| 5   | Brief avant-marché                     | `docs/01:136-137`, `:161`, `:285`                         | `gabarits.ts:443` `briefAvantMarche`                                                             | `GET /api/prevision/brief`   | **aucun**      |
| 6   | Rapport de session                     | `docs/01:162`, `:287`                                     | `gabarits.ts:283` `rapportSession`                                                               | **aucune**                   | aucun          |
| 7   | **Registre AFSCA mensuel**             | `docs/01:214` ; `docs/04:147`, `:206-207` (minimum vital) | `registre-afsca.ts:259` `registreAfscaMensuel` — **importé par aucun fichier, pas même un test** | **aucune**                   | aucun          |
| 8   | État de stock valorisé (Excel)         | `docs/01:100`                                             | `excel.ts:201` `exportStockValorise`                                                             | **aucune**                   | aucun          |
| 9   | Liste des lots arrivant à DLC          | `docs/01:101`                                             | aucun gabarit                                                                                    | aucune                       | aucun          |
| 10  | Grand livre simplifié                  | `docs/01:256`                                             | aucun                                                                                            | aucune                       | aucun          |
| 11  | Journaux recettes / achats (Excel)     | `docs/01:257` ; `docs/04:178`                             | `excel.ts:271`, `excel.ts:334`                                                                   | **aucune**                   | aucun          |
| 12  | Récapitulatif annuel                   | `docs/01:258`                                             | aucun gabarit                                                                                    | aucune                       | aucun          |
| 13  | Détail des amortissements (Excel)      | `docs/01:259`                                             | aucun                                                                                            | aucune                       | aucun          |
| 14  | Export CSV générique                   | `docs/01:260`                                             | aucun                                                                                            | aucune                       | aucun          |
| 15  | Export des mouvements de stock (Excel) | _non annoncé_                                             | `excel.ts:429` `exportMouvementsStock`                                                           | **aucune**                   | aucun          |

**Résultat : 2 PDF sur 7 atteignables par une route, 0 Excel sur 4, et 0 document sur 15 n'a de
bouton dans l'interface.** Toute la chaîne Playwright (`documents/rendu.ts`) et ExcelJS
(`documents/excel.ts`) est écrite **et testée** (`rendu.test.ts`, `excel.test.ts`) — et inaccessible
à l'utilisateur. Aucune balise `<a href>`, `window.open`, `createObjectURL` ou bouton
« Exporter / Imprimer / Télécharger » n'existe dans `apps/web/src` (vérifié par balayage complet).

> **Mise à jour du 30/07/2026 — ce constat est presque entièrement corrigé.** Un composant
> `apps/web/src/composants/BoutonDocument.tsx` existe désormais et est câblé sur six écrans. Repris
> ligne par ligne du tableau ci-dessus :
>
> | #           | Document                                                                    | État au 30/07/2026                                                                                                                                                                               |
> | ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | 1           | Fiche technique de recette                                                  | Route `GET /documents/fiche-technique/:id` créée (`documents.ts:111`). **Toujours aucun bouton** — un balayage de `BoutonDocument` dans `apps/web/src` ne renvoie aucun usage `fiche-technique`. |
> | 2           | Affichette allergènes                                                       | Route créée (`documents.ts:139`) **et** bouton : `RegistreAfsca.tsx:2509` (`chemin="/documents/affichette-allergenes"`). Trou fermé — voir §4.3.                                                 |
> | 3           | Étiquette de bac de pâte                                                    | Route créée (`documents.ts:169`) **et** bouton : `Production.tsx:1390`.                                                                                                                          |
> | 4           | Bon de commande fournisseur                                                 | Route déjà existante ; bouton désormais présent : `Achats.tsx:751`. Voir §4.10.                                                                                                                  |
> | 5           | Brief avant-marché                                                          | **Toujours orphelin** — aucun bouton trouvé, voir §4.4.                                                                                                                                          |
> | 6           | Rapport de session                                                          | Route créée (`documents.ts:205`) **et** bouton : `Sessions.tsx:2941`.                                                                                                                            |
> | 7           | Registre AFSCA mensuel                                                      | Route créée (`documents.ts:242`) **et** bouton : `RegistreAfsca.tsx:2496`. Trou fermé — voir §4.2.                                                                                               |
> | 8           | État de stock valorisé (Excel)                                              | Route créée (`documents.ts:269`, `/exports/stock`) **et** bouton : `Stock.tsx:733`.                                                                                                              |
> | 9–10, 12–14 | Liste DLC, grand livre, récapitulatif annuel, amortissements, CSV générique | Toujours aucun gabarit — inchangé.                                                                                                                                                               |
> | 11          | Journaux recettes / achats (Excel)                                          | Routes créées (`documents.ts:284,302`) **et** boutons : `Comptabilite.tsx:1125,1130`.                                                                                                            |
> | 15          | Export des mouvements de stock (Excel)                                      | Route créée (`documents.ts:320`, `/exports/mouvements`) **et** bouton : `Stock.tsx:754`.                                                                                                         |
>
> Nouveau bilan mesuré le 30/07/2026 : **8 documents sur 15 ont désormais un bouton** (#2, #3, #4,
> #6, #7, #8, #11, #15), contre 0/15 affirmé ci-dessus. Restent sans route ni bouton : liste DLC,
> grand livre, récapitulatif annuel, détail amortissements, export CSV générique (5 documents,
> #9/#10/#12/#13/#14). Reste avec route mais sans bouton : fiche technique (#1). Reste sans bouton
> malgré une route existante : le brief avant-marché (`previsions.ts:314`, #5, voir §4.4).

### 2.4 État des lots de `docs/04-ROADMAP-LOTS.md`

| Lot                               | État             | Ce qui manque                                                                                                        |
| --------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0 — Fondations                    | livré            | —                                                                                                                    |
| 1 — Recettes et ingrédients       | **partiel**      | le « CRUD complet » (`docs/04:30`) : aucune écriture sur `recette`, `recette_ligne`, `ingredient`, `conditionnement` |
| 2 — Stock, lots, traçabilité      | **partiel**      | l'« écran d'inventaire » (`docs/04:48`) au sens comptage ; pas de `GET /api/mouvements`                              |
| 3 — Production                    | livré            | —                                                                                                                    |
| 4 — Sessions et compta analytique | **partiel**      | tableau de bord analytique par axes ; températures hors de l'écran de clôture                                        |
| 5 — Moteur de prévision           | **partiel**      | `npm run backtest` (`docs/04:98`) absent de `package.json` ; boutons Ajuster / Lancer la production                  |
| 6 — Documents générés             | **très partiel** | 2/7 PDF exposés, 0/4 Excel, 0 bouton. **Le lot le plus en retrait**                                                  |
| 7 — Réappro et mails              | livré            | réserve : le bouton de génération est sur Achats, pas sur Stock (`docs/06:164`)                                      |
| 8 — Registre AFSCA                | **partiel**      | le registre mensuel PDF (`docs/04:147`), seule sortie opposable à un contrôle                                        |
| 9 — Intégration Claude            | **partiel**      | 3 usages sur 5 ; aucun écran ne montre journal ni coût                                                               |
| 10 — Comptabilité et exports      | **partiel**      | les « exports pour le comptable » (`docs/04:178`) : aucune route Excel/CSV                                           |
| 11 — Google                       | absent           | lot optionnel, cohérent                                                                                              |
| 12 — Finitions                    | **partiel**      | sauvegarde/restauration à la demande, import/export JSON, guide d'utilisation                                        |

Le « minimum vital » de `docs/04:205-207` est _Lots 0→4 + affichette allergènes + registre de
température_. Les lots 0 à 4 sont substantiellement là et le registre de température est là, mais
**l'affichette allergènes — obligation AFSCA rappelée `docs/01:42` — est écrite et inaccessible**.

---

## 3. Sens C — tables et colonnes mortes

Méthode : balayage de tous les `.insert(T)`, `.update(T)`, `.from(T)`, `.innerJoin(T)`,
`.leftJoin(T)` de `packages/db/src`, `apps/api/src` et `packages/core/src`, **hors fichiers de
test**. Aucune requête relationnelle Drizzle (`base.query.X`) n'est utilisée dans le dépôt : les
`relations()` déclarées en `schema.ts:1423-1559` ne créent donc aucun accès implicite.

### 3.1 Les 41 tables

| Table                     | Écrite par                                                                                            | Lue par                                                    | Verdict                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `parametre`               | `depots/parametres.ts:182,298` ; `seed/parametres.ts:59,74`                                           | `depots/parametres.ts:46,64,76,174,281`                    | vivante                                                        |
| `utilisateur`             | `seed/index.ts:57` **(seed seul)**                                                                    | `seed/index.ts:52` **(seed seul)**                         | **morte en usage**                                             |
| `journal_audit`           | `depots/audit.ts:62` (appelé par `parametres.ts:188,314` et `referentiel.ts:122,155,194,315,348,384`) | `depots/audit.ts:127` — **aucun appelant de production**   | **écrite, jamais lue**                                         |
| `fournisseur`             | `depots/referentiel.ts:117,149,188` ; seeds                                                           | 8 sites                                                    | vivante                                                        |
| `ingredient`              | **`seed/demonstration.ts:416` seul**                                                                  | 9 sites                                                    | **jamais créée par l'application**                             |
| `conditionnement`         | **`seed/demonstration.ts:454` seul**                                                                  | 4 sites                                                    | **jamais créée par l'application**                             |
| `recette`                 | **`seed/demonstration.ts:493,553` seuls**                                                             | 8 sites                                                    | **jamais créée par l'application**                             |
| `recette_ligne`           | **`seed/demonstration.ts:523` seul**                                                                  | `depots/recettes.ts:55,89`                                 | **jamais créée par l'application**                             |
| `produit_vente`           | `depots/referentiel.ts:310,342,378` ; seed                                                            | 8 sites                                                    | vivante                                                        |
| **`produit_garniture`**   | **aucun code**                                                                                        | **aucun code**                                             | **TABLE MORTE — chiffre faux (§4.1)**                          |
| `motif`                   | `seed/motifs.ts:37,51` **(seed seul)**                                                                | `services/mouvements.ts:52` ; `services/production.ts:166` | vivante (référentiel figé)                                     |
| `reception`               | `services/reception.ts:147`                                                                           | `seed/activite.ts:312` — **aucune lecture applicative**    | **écrite, jamais relue**                                       |
| `lot`                     | `services/reception.ts:195` ; `services/mouvements.ts:244`                                            | 6 sites                                                    | vivante                                                        |
| `mouvement_stock`         | 5 sites (`reception`, `mouvements`, `production`, `sessions`)                                         | 5 sites                                                    | vivante                                                        |
| `serie_numero`            | `depots/numerotation.ts:59,74`                                                                        | `depots/numerotation.ts:52,93`                             | vivante (2 séries mortes, §3.3)                                |
| `production`              | `services/production.ts:207,338`                                                                      | 7 sites                                                    | vivante                                                        |
| `production_consommation` | `services/production.ts:258`                                                                          | 5 sites                                                    | vivante (1 colonne morte, §3.2)                                |
| `lieu_marche`             | **`seed/demonstration.ts:641` seul**                                                                  | 5 sites                                                    | **jamais créé par l'application**                              |
| `session_marche`          | `services/sessions.ts:128,372,565` ; seed                                                             | 15 sites                                                   | vivante (2 colonnes mortes, §3.2)                              |
| `session_vente`           | `services/sessions.ts:315`                                                                            | `depots/previsions.ts:219` ; `depots/sessions.ts:84`       | vivante                                                        |
| **`session_frais`**       | `services/sessions.ts:425`                                                                            | **aucun code**                                             | **écrite, jamais lue**                                         |
| `document_genere`         | `documents/rendu.ts:201`                                                                              | `documents/rendu.ts:125,272,292`                           | vivante, mais alimentée uniquement par les 2 routes orphelines |
| `evenement`               | `depots/previsions.ts:473`                                                                            | `depots/previsions.ts:105,453`                             | vivante                                                        |
| `meteo_observation`       | `depots/previsions.ts:514`                                                                            | `depots/previsions.ts:66,548`                              | vivante                                                        |
| `prevision`               | `depots/previsions.ts:317,368`                                                                        | `depots/previsions.ts:362,398,420`                         | vivante (2 colonnes mortes, §3.2)                              |
| `commande_fournisseur`    | `services/commandes.ts:414,497,528` ; `services/reception.ts:260`                                     | 4 sites                                                    | vivante                                                        |
| `commande_ligne`          | `services/commandes.ts:435`                                                                           | `services/commandes.ts:76,120,217`                         | vivante                                                        |
| **`facture_fournisseur`** | **aucun code**                                                                                        | **aucun code**                                             | **TABLE MORTE**                                                |
| **`facture_ligne`**       | **aucun code**                                                                                        | **aucun code**                                             | **TABLE MORTE**                                                |
| **`frais_reception`**     | **aucun code**                                                                                        | **aucun code**                                             | **TABLE MORTE**                                                |
| `releve_temperature`      | `services/afsca.ts:105`                                                                               | `services/afsca.ts:111,122`                                | vivante                                                        |
| `tache_nettoyage`         | `seed/afsca.ts:111,121` **(seed seul)**                                                               | `services/afsca.ts:142,162`                                | vivante (référentiel figé)                                     |
| `nettoyage_execution`     | `services/afsca.ts:177`                                                                               | `services/afsca.ts:207,247`                                | vivante                                                        |
| `non_conformite`          | `services/afsca.ts:339,377`                                                                           | `services/afsca.ts:358,396,407`                            | vivante                                                        |
| `exercice_tracabilite`    | `services/afsca.ts:458`                                                                               | `services/afsca.ts:466`                                    | vivante                                                        |
| `journal_ia`              | `depots/ia.ts:33`                                                                                     | `depots/ia.ts:73,95` → **routes orphelines uniquement**    | vivante en base, invisible à l'écran                           |
| `depense`                 | `depots/comptabilite.ts:198,259`                                                                      | 4 sites                                                    | vivante                                                        |
| `immobilisation`          | `depots/comptabilite.ts:380`                                                                          | `depots/comptabilite.ts:319`                               | vivante                                                        |
| `amortissement_annuite`   | `depots/comptabilite.ts:398`                                                                          | `depots/comptabilite.ts:330,769`                           | vivante                                                        |
| `echeance`                | `depots/comptabilite.ts:465,544,578`                                                                  | `depots/comptabilite.ts:458,503,537`                       | vivante                                                        |
| `periode`                 | `depots/comptabilite.ts:648,672,719`                                                                  | `depots/comptabilite.ts:618,641,704`                       | vivante                                                        |

> **Mise à jour du 30/07/2026 — quatre lignes de ce tableau sont fausses aujourd'hui.**
>
> - **`journal_audit`** n'est plus « écrite, jamais lue » : `listerJournalAudit`
>   (`depots/audit.ts:115`) est désormais appelée en production par
>   `apps/api/src/routes/audit.ts:136` (nouveau fichier de route). Voir §4.9 et §5.2.
> - **`produit_garniture`** n'est plus une table morte. Elle est **lue** en production par
>   `depots/tracabilite.ts:229-232` (jointure garniture/produit pour la traçabilité),
>   `depots/recettes.ts:198-201` (coût de garniture d'un produit) et
>   `apps/api/documents/donnees.ts:252-257` ; elle est **écrite** par
>   `packages/db/src/seed/demonstration.ts:733-745`. Un service dédié
>   `packages/db/src/services/garnitures.ts` existe désormais (`sortirLesGarnitures`, sortie de
>   stock des garnitures à la clôture). Voir §4.1 : le chiffre faux qu'elle causait est corrigé. Je
>   n'ai en revanche pas trouvé de route qui permette de RATTACHER une garniture à un produit
>   depuis l'écran (au-delà du seed) — si elle existe, elle m'a échappé ; à revérifier avant de
>   conclure que ce volet précis est complètement fermé.
> - **`facture_fournisseur`, `facture_ligne`, `frais_reception`** ne sont plus des tables mortes.
>   Un module complet est apparu : `packages/db/src/services/factures.ts`,
>   `apps/api/src/routes/factures.ts` (dont `PATCH /factures/:id/statut:97`), et
>   `packages/core/src/contrats/factures.ts`. Voir §4.12, qui doit être retiré de la liste
>   « PRÉMATURÉ ».
>
> **Bilan corrigé au 30/07/2026** : sur les 4 tables « totalement mortes » listées ci-dessous, les
> 4 sont désormais vivantes. Le chiffre de tête « 41 tables » reste, lui, à recompter (voir l'encadré
> en tête de document) : au moins `menu_composition`, `equipement`, `equipement_session`, `objectif`
> et les tables du module factures existent en plus de celles listées ici, sans que j'aie repris le
> dénombrement complet.

**Bilan original (28/07/2026, dépassé — voir l'encadré ci-dessus) : 4 tables totalement mortes**
(`produit_garniture`, `facture_fournisseur`,
`facture_ligne`, `frais_reception`), **2 tables écrites et jamais relues** (`session_frais`,
`journal_audit`), **1 table écrite et jamais relue applicativement** (`reception`),
**5 tables que seul le seed peut créer** (`ingredient`, `conditionnement`, `recette`,
`recette_ligne`, `lieu_marche`), **1 table morte en usage** (`utilisateur`).

### 3.2 Colonnes mortes des tables vivantes

Colonnes dont le nom n'apparaît **nulle part hors `schema.ts`** (tests exclus) :

| Colonne                                 | Ligne du schéma  | Constat                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_marche.meteo_prevue`           | `schema.ts:720`  | jamais écrite, jamais lue — la météo vit dans `meteo_observation`                                                                                                                                                                                                                   |
| `session_marche.meteo_reelle`           | `schema.ts:721`  | idem                                                                                                                                                                                                                                                                                |
| ~~`recette.recette_parent_id`~~         | `schema.ts:230`  | ~~jamais écrite — le versionnage D-005 n'est pas implémenté~~ **Corrigé le 30/07/2026** : écrite par `creerVersionRecette` (`packages/db/src/depots/referentiel-ecriture.ts:1206`), route `POST /recettes/:id/versions`, consommée par `Recettes.tsx:1389` — voir l'encadré de tête |
| `recette_ligne.note_technique`          | `schema.ts:274`  | jamais écrite, jamais lue                                                                                                                                                                                                                                                           |
| `conditionnement.reference_fournisseur` | `schema.ts:196`  | jamais écrite, jamais lue — c'est pourtant la référence à citer au fournisseur                                                                                                                                                                                                      |
| `facture_ligne.ecart_prix_cents`        | `schema.ts:1118` | table morte                                                                                                                                                                                                                                                                         |
| `frais_reception.methode_repartition`   | `schema.ts:1143` | table morte                                                                                                                                                                                                                                                                         |

Colonnes **écrites mais jamais relues** :

| Colonne                          | Ligne           | Constat                                                   |
| -------------------------------- | --------------- | --------------------------------------------------------- |
| `prevision.commentaire_ia`       | `schema.ts:988` | écrite en `depots/previsions.ts:339`, jamais sélectionnée |
| `prevision.explication_facteurs` | `schema.ts:989` | écrite en `depots/previsions.ts:340`, jamais sélectionnée |

Colonne **lue et affichée mais jamais renseignée** — le cas le plus trompeur :

| Colonne                                   | Ligne           | Constat                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `production_consommation.quantite_reelle` | `schema.ts:655` | écrite **à `null`** et seulement à `null` (`services/production.ts:265`) ; **aucune écriture ultérieure**. Elle est pourtant lue en `depots/productions.ts:68`, `depots/tracabilite.ts:106,314,352`, et **affichée dans une colonne de tableau** (`Production.tsx:332`). L'utilisateur voit une colonne « réel » qui restera un tiret à vie, et l'écart théorique/réel **par ingrédient** — l'analyse « où fuit la matière ? » de `docs/01 §7` — est structurellement impossible |

> **Mise à jour du 30/07/2026 — cette ligne est fausse.** `packages/db/src/services/production.ts:642`
> écrit désormais une vraie valeur : `.set({ quantiteReelle: declaration.quantiteReelle })`, dans un
> nouveau mécanisme de correction manuelle de la consommation réelle (`consommationsReelles`,
> même fichier, à partir de la ligne ~500). `decomposerEcart` (`packages/core/src/production.ts:150`,
> orpheline en §5.1 au 28/07) y est désormais appelée (`services/production.ts:537`) pour calculer
> l'écart et son coût. La colonne n'est donc plus figée à `null` : elle se remplit quand l'utilisateur
> saisit une correction, et le geste est bien atteignable depuis l'écran : `Production.tsx:854,859`
> construit le tableau `consommationsReelles` envoyé au serveur. L'affichage `Production.tsx:362`
> (`ouTiret(c.quantiteReelle, …)`) n'est donc plus condamné à afficher un tiret à vie.

### 3.3 Séries de numérotation mortes

`SERIES` (`depots/numerotation.ts:21-29`) déclare six natures. Quatre sont allouées
(`reception`, `commande`, `production`, `session`). **`registre` (préfixe `RG`) et `inventaire`
(préfixe `IN`) ne sont jamais allouées** — conséquence directe de l'absence de route de génération
du registre AFSCA et de document d'inventaire.

---

## 4. Le tri — trous, prématurés, normaux

Le critère qui tranche : **un utilisateur, le dimanche soir après un marché (ou le samedi soir
avant), a-t-il besoin de ce geste ?** Si oui et qu'il ne peut pas le faire depuis l'interface,
c'est un trou.

### 4.1 TROU — gravité 1 : `produit_garniture` fausse le coût matière

**Où.** `packages/db/src/schema.ts:328-341` ; relations déclarées `schema.ts:1545-1559`.

**Le fait.** La table est définie avec un commentaire qui énonce son rôle — « ce qui s'ajoute à la
crêpe et **qui doit entrer dans son coût matière complet** » — et **aucun code ne l'écrit ni ne la
lit**. Aucune route ne permet de rattacher une garniture à un produit ; aucun écran non plus.
`Produits.tsx` ne propose que nom, nature, recette/ingrédient, prix, catégorie.

**Le chiffre.** Sur la base de démonstration (`npm run db:seed:demo`), le coût matière de R1
calculé par l'application vaut :

| Ingrédient             | Quantité (6 crêpes) | Coût unitaire | Coût         |
| ---------------------- | ------------------- | ------------- | ------------ |
| Farine de froment T55  | 145 g               | 0,075 c/g     | 10,88 c      |
| Lait entier            | 240 ml              | 0,115 c/ml    | 27,60 c      |
| Œufs entiers           | 2 pièces            | 20 c/pièce    | 40,00 c      |
| Beurre                 | 55 g                | 0,90 c/g      | 49,50 c      |
| Vergeoise blonde       | 23 g                | 0,32 c/g      | 7,36 c       |
| Sel fin                | 2 g                 | 0,09 c/g      | 0,18 c       |
| Sucre vanillé          | 8 g                 | 1,733 c/g     | 13,87 c      |
| Eau de fleur d'oranger | 4 ml                | 1,16 c/ml     | 4,64 c       |
| **Total**              | **pour 6 crêpes**   |               | **154,02 c** |

> **0,2567 €/crêpe** (affiché arrondi à **26 c** par `lireRecetteDetail`), contre **0,33 €/crêpe**
> annoncés par `CLAUDE.md` §6. **L'écart est de 0,073 €/crêpe, soit 22 % du coût réel annoncé.
> Cet écart EST la garniture.**

**Ce que ça coûte en usage réel.**

- Sur une session type de La Batte (134 crêpes, `CLAUDE.md` §6) : **9,82 € de coût matière
  invisible par session**, donc autant de marge brute surévaluée.
- Sur 40 sessions : **≈ 393 €/an** de matière consommée qui n'apparaît nulle part.
- Le Nutella, la cassonade, le sirop étalés sur les crêpes **ne sortent jamais du stock** : le
  point de commande de ces ingrédients ne se déclenche jamais, et on tombe en rupture au marché.
- Ce sont des denrées à DLC : **aucune trace du lot de garniture parti à quelle date de marché**.
  C'est exactement la question posée lors d'un rappel AFSCA.
- Le jeu de démonstration l'illustre involontairement : « Crêpe froment / cassonade » à 3,00 € et
  « Crêpe froment / Sirop de Liège » à 3,50 € (`seed/demonstration.ts:277-295`) ont **le même coût
  matière** dans l'application. Les 0,50 € d'écart de prix ne rencontrent aucun écart de coût.

**Déjà signalé.** `docs/09-AUDIT-ARCHITECTURE.md` §I6 le décrit ; le présent audit y ajoute le
chiffre et le constat qu'aucune route ni aucun écran n'existe pour alimenter la table.

> **Mise à jour du 30/07/2026 — ce trou est fermé côté lecture.** `produit_garniture` est désormais
> lue par `depots/recettes.ts:198-201` et exploitée par une nouvelle route
> `GET /api/couts-produits` (`apps/api/src/routes/recettes.ts:110`), dont le commentaire dit
> explicitement intégrer « part de pâte + garnitures » et cite **le même exemple** que ce constat
> (crêpe froment/cassonade vs. crêpe froment/sirop de Liège à coût identique, `:104`). Voir §3.1
> pour l'écriture (seed + service `garnitures.ts`). Je n'ai **pas revérifié le chiffre** (0,2567 €
> vs 0,33 €/crêpe) après correction — c'est-à-dire que je n'ai pas recalculé combien `GET
/couts-produits` rend aujourd'hui pour R1 sur la base de démonstration ; je constate seulement que
> le mécanisme qui produisait le chiffre faux (garniture ignorée) a un correctif en place. Un
> point non résolu, à ma connaissance : je n'ai pas trouvé de route qui permette d'ATTACHER une
> nouvelle garniture à un produit depuis l'écran — la traçabilité DLC et le déclenchement du point
> de commande évoqués plus haut restent à revérifier séparément.

### 4.2 TROU — gravité 1 : le registre AFSCA mensuel n'a ni route ni bouton

**Où.** `apps/api/src/documents/registre-afsca.ts:259` (`registreAfscaMensuel`).

**Le fait.** La fonction qui produit le registre d'autocontrôle est écrite, complète — et
**importée par aucun fichier du dépôt, pas même un test**. Aucune route ne l'appelle, aucun bouton
n'existe dans `RegistreAfsca.tsx` (2 145 lignes, zéro affordance d'export).

**Ce que ça coûte.** `docs/04:206-207` classe le registre dans le **minimum vital**. C'est la seule
sortie opposable à un contrôle : l'application collecte scrupuleusement températures, nettoyages,
non-conformités et exercices de traçabilité, et **ne sait rien en produire**. Le jour d'un contrôle,
le porteur n'a rien à présenter que des écrans.

Corollaire : `SERIES.registre` (`RG`, `numerotation.ts:27`) n'est jamais alloué, et
`document_genere` ne contiendra jamais de ligne `registre_afsca`.

> **Mise à jour du 30/07/2026 — ce trou est fermé.** `registreAfscaMensuel` est désormais appelée en
> production par `apps/api/src/routes/documents.ts:256` (route `GET /documents/registre-afsca`), et
> un bouton existe : `apps/web/src/pages/RegistreAfsca.tsx:2496`
> (`chemin={`/documents/registre-afsca?periode=${…}`}`, via `BoutonDocument`). Le corollaire sur
> `SERIES.registre` reste à revérifier : je n'ai pas confirmé si `allouerNumero('registre', …)` est
> maintenant appelé lors de la génération de ce PDF (voir §3.3, non retraité ici).

### 4.3 TROU — gravité 1 : l'affichette allergènes est écrite et inaccessible

**Où.** `apps/api/src/documents/gabarits.ts:157` (`affichetteAllergenes`).

**Le fait.** Seul appelant : `apps/api/src/documents/rendu.test.ts`. Aucune route, aucun bouton.

**Ce que ça coûte.** `docs/01:42` et `docs/04:206` la classent, comme le registre, dans le minimum
vital : c'est une **obligation réglementaire d'affichage** au stand. `docs/04:122-123` précise même
qu'elle doit être « lisible à un mètre ». Le gabarit existe ; il est impossible de l'imprimer.

> **Mise à jour du 30/07/2026 — ce trou est fermé.** `affichetteAllergenes` est désormais appelée en
> production par `apps/api/src/routes/documents.ts:153` (route `GET /documents/affichette-allergenes`),
> et un bouton existe : `apps/web/src/pages/RegistreAfsca.tsx:2509`
> (`chemin="/documents/affichette-allergenes"`, via `BoutonDocument`).

### 4.4 TROU — gravité 2 : le brief avant-marché ne peut pas être ouvert

**Où.** `GET /api/prevision/brief` — `apps/api/src/routes/previsions.ts:314`. Orpheline.

**Le fait.** La route fonctionne (deux exemplaires du PDF traînent dans `sorties/` :
`brief_avant_marche_SM-2026-0002_v1_…` et `_v2_…`, produits à la main). `ProchaineSession.tsx` n'a
aucun bouton pour l'appeler.

**Ce que ça coûte.** `docs/01:136-137` décrit le brief comme **le document qu'on relit le samedi
soir** — quantité à produire, alertes de stock, lots proches de la DLC, contrainte limitante. C'est
littéralement le geste « avant le marché ». Il exige aujourd'hui de taper une URL dans un
navigateur.

### 4.5 TROU — gravité 2 : l'analyse d'écart post-session est injoignable

**Où.** `POST /api/ia/analyse-ecart/:id` — `apps/api/src/routes/ia.ts:71`. Orpheline.

**Le fait.** La route prend une session close, en extrait produites / vendues / invendues / CA /
marge / écart de caisse, et demande à Claude un commentaire. `Sessions.tsx` ne la référence pas.

**Ce que ça coûte.** `docs/01:184` la formule ainsi : « Pourquoi 30 crêpes de moins que prévu ? ».
C'est **exactement** la question du dimanche soir. Toute la plomberie est là — plafond, journal,
mode dégradé — et la question ne peut pas être posée.

### 4.6 TROU — gravité 2 : le plafond de dépense IA est invisible

**Où.** `GET /api/ia/etat` (`ia.ts:38`) et `GET /api/ia/journal` (`ia.ts:60`). Orphelines.

**Le fait.** `CLAUDE.md` §5 impose « un compteur de coût par appel, stocké en base (`journal_ia`) »
et « un plafond mensuel configurable qui coupe les appels non essentiels quand il est atteint ».
Les deux existent et fonctionnent. **Aucun écran ne les montre.**

**Ce que ça coûte.** Le commentaire de `ia.ts:35-36` énonce lui-même l'exigence : « l'utilisateur
doit pouvoir répondre à _pourquoi n'ai-je pas de commentaire ce mois-ci ?_ sans ouvrir un fichier
de log ». Aujourd'hui, quand le plafond coupe, l'application se tait sans dire pourquoi. La table
`journal_ia` est écrite à chaque appel et n'est lisible que par requête HTTP manuelle.

### 4.7 TROU — gravité 2 : rien ne peut créer un ingrédient, un conditionnement, une recette ni un lieu

**Où.** Absence de `POST /api/ingredients`, `POST /api/recettes`, `PATCH /api/recettes/:id`,
`POST /api/lieux`, et de toute route sur `conditionnement`.

**Le fait.** Cinq tables du référentiel ne sont écrites que par `packages/db/src/seed/`.
Conséquences en chaîne :

- Acheter un nouvel article — un sirop d'un autre producteur, un nouveau type de farine —
  **oblige à éditer le code du seed**. Or `produit_vente.ingredient_id` est requis pour un produit
  `revendu` : sans nouvel ingrédient, pas de nouveau produit revendu.
- Le prix d'achat vient de `conditionnement.prix_cents` (D-018). **Un changement de tarif du
  meunier ne peut pas être saisi** : le coût matière reste figé au prix du seed, et la question
  « le meunier a-t-il augmenté ses prix ? » n'a pas de réponse.
- R2 est semée **vide et en `brouillon`** (`seed/demonstration.ts:560-570`, note :
  « la recette reste inutilisable tant qu'elle est vide ») et **il n'existe aucun moyen de la
  remplir** depuis l'application.
- Un second marché est impossible.

C'est la rupture la plus profonde de la « chaîne unique de données » du §0 : le premier maillon —
_qu'est-ce que j'achète, à quel prix, chez qui_ — n'est pas saisissable.

> **Mise à jour du 30/07/2026 — ce trou est fermé pour l'ingrédient et le lieu, ouvert pour la
> recette entière.** `apps/api/src/routes/referentiel-ecriture.ts` (nouveau fichier, registré dans
> `apps/api/src/serveur.ts:152`) expose `POST /ingredients` (`:138`), `POST /conditionnements`
> (`:182`), `POST /recettes` (`:263`), `PATCH /recettes/:id/statut` (`:310`) et `POST /lieux`
> (`:332`). Côté écran : `POST /ingredients` est consommé par `Recettes.tsx:1186` (création d'un
> ingrédient depuis une ligne de recette, avec un nouvel écran `Ingredients.tsx`) ; `POST /lieux`
> et la désactivation d'un lieu sont consommés par un nouvel écran `LieuxMarche.tsx:419,445`.
> R2 peut donc être remplie et un second marché créé. Point non revérifié : je n'ai trouvé **aucun
> appel** à `POST /recettes` dans `apps/web/src` — créer une recette entièrement nouvelle depuis
> l'écran reste donc, sauf erreur de ma part, non câblé, même si la route existe. Voir aussi §2.2.
>
> > **Rectification du 30/07/2026, contrôle plus tardif — ce « point non revérifié » était faux, et
> > ce trou est donc fermé ENTIÈREMENT, recette comprise.** `POST /recettes` est appelé par
> > `apps/web/src/pages/Recettes.tsx:1393` (`requeteApi(chemin, { method: methode, … })`), où
> > `chemin` vaut `'/recettes'` et `methode` vaut `'POST'` en mode création (`:1388-1391`). Le
> > chemin étant **calculé**, aucune recherche littérale de `'/recettes'` associée à un `POST` ne
> > pouvait le trouver — c'est le piège que §0 note 2 de ce même document décrit pour
> > `Fournisseurs.tsx:355` et `Produits.tsx:360`, et il a été retendu ici. La conclusion de §4.7
> > devient donc : **rien de ce qui était listé comme impossible ne l'est plus** — ingrédient,
> > conditionnement, recette (création, modification, versionnage) et lieu sont tous saisissables
> > depuis l'application. Le « premier maillon de la chaîne §0 » est refermé.
>
> Note pour le porteur, hors du périmètre « docs » de cette vérification : le fichier de test
> `apps/api/src/routes/referentiel-ecriture.test.ts:17-19` affirme dans son propre commentaire que
> « ce plugin n'est pas encore enregistré dans `serveur.ts` » — c'est un commentaire de code, pas une
> affirmation de `docs/`, donc hors de ma zone d'écriture, mais il vaut la peine de le signaler : il
> est **faux** aujourd'hui (`serveur.ts:152` l'enregistre bel et bien) et devrait être mis à jour ou
> supprimé par qui touche ce fichier.

### 4.8 TROU — gravité 3 : `production_consommation.quantite_reelle` affiche une colonne à vie vide

Voir §3.2. `Production.tsx:332` affiche une colonne « réel » alimentée par une donnée que rien
n'écrit jamais. L'écart théorique/réel par ingrédient est annoncé au tableau des modules ERP
(`CLAUDE.md` §0, ligne « Comptabilité analytique ») et vaut structurellement zéro.

> **Mise à jour du 30/07/2026 — ce trou est fermé.** Voir l'encadré de §3.2 : la colonne se remplit
> désormais via un mécanisme de correction manuelle (`services/production.ts:642`), déclenché depuis
> `Production.tsx:854,859`.

### 4.9 TROU — gravité 3 : le journal d'audit est écrit et illisible

`journal_audit` reçoit une entrée à chaque création/modification de paramètre et de référentiel
(8 sites d'appel de `journaliser`). **`listerJournalAudit` (`depots/audit.ts:108`) n'a aucun
appelant de production, et aucune route ne l'expose.** `CLAUDE.md` §3 règle 7 exige un « journal
d'audit sur toutes les tables sensibles » ; il est tenu, et personne ne peut le consulter — y
compris un contrôleur.

> **Mise à jour du 30/07/2026 — ce trou est fermé côté route.** `listerJournalAudit`
> (`depots/audit.ts:115` — la ligne a bougé depuis le 28/07) est désormais appelée par
> `apps/api/src/routes/audit.ts:136`, nouveau fichier dont l'en-tête (`:6`) référence explicitement
> ce constat au passé (« strictement illisible : `listerJournalAudit` n'avait aucun appelant de
> [production]… »). Confirmation (30/07/2026, contrôle indépendant) : oui, un écran l'appelle bel et
> bien — `apps/web/src/pages/JournalAudit.tsx:247` (`requeteApi<unknown>('/audit?' + parametres.toString())`).
> Le trou est fermé des deux côtés, route et écran.

### 4.10 TROU — gravité 3 : le bon de commande ne peut pas être relu avant envoi

`GET /api/commandes/:id/pdf` est orpheline. Le PDF **est** bien joint au mail par
`POST /commandes/:id/envoyer`, donc la chaîne d'achat fonctionne. Ce qui manque est la
**consultation avant envoi** — or D-009 fait justement de la validation humaine explicite le
garde-fou (« une commande partie par erreur chez un meunier coûte plus cher que le clic
économisé »). On valide aujourd'hui sans pouvoir lire le document qu'on valide.

> **Mise à jour du 30/07/2026 — ce trou est fermé.** Un bouton `BoutonDocument` appelle désormais
> cette route depuis `apps/web/src/pages/Achats.tsx:751`.

### 4.11 TROU — gravité 3 : `session_frais` et `reception` sont écrites et jamais relues

- `session_frais` (`services/sessions.ts:425`) duplique les quatre postes agrégés de
  `session_marche` et n'est lue par personne. Le champ `justificatif_path` qu'elle porte — la seule
  place prévue pour rattacher un ticket — est donc inatteignable.
- `reception` est écrite par `services/reception.ts:147` et **n'est relue par aucune requête
  applicative** (seul `seed/activite.ts:312` la lit). Il n'existe donc aucun écran « historique des
  réceptions » : le numéro `RC-2026-xxxx`, conçu pour être « lisible et citable au téléphone »
  (`schema.ts:381-385`), n'est affiché qu'une fois, dans le bandeau de confirmation.

### 4.12 PRÉMATURÉ — à signaler, pas à brancher

| Cas                                                                                                | Constat                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`facture_fournisseur`, `facture_ligne`, `frais_reception`** (`schema.ts:1082`, `:1105`, `:1134`) | Trois tables, leurs index et leurs migrations, pour un rapprochement à trois **jamais commencé**. Déjà relevé en `docs/09` §I10. Décider : câbler, ou retirer et consigner en V2. Le pire état est l'état actuel, où un lecteur du schéma croit la fonction présente                                   |
| **`GET /api/lots/:lotId`** (`stock.ts:155`)                                                        | Redondante : `GET /api/stock/:ingredientId/lots` sert l'écran Stock, `GET /api/afsca/tracabilite/lots/:id` sert la traçabilité. De plus son implémentation balaie **tout** le stock puis tous les lots de chaque ingrédient pour retrouver un identifiant — coût inutile pour un besoin sans demandeur |
| **`utilisateur`** (`schema.ts:59`)                                                                 | Une ligne semée, jamais lue hors du seed. Le champ `cree_par` des mouvements est alimenté par du texte, pas par cette table. Cohérent avec « pas d'authentification en V1 », mais la table ne sert à rien                                                                                              |
| **`session_vente.creneau_horaire`** (`schema.ts:788`)                                              | Saisissable (`Sessions.tsx`) et stockée, mais **aucune analyse ne l'exploite** : l'axe « les deux dernières heures paient-elles leur temps ? » (`docs/01:238`) n'existe nulle part. Donnée collectée sans consommateur — à brancher ou à assumer comme préparatoire                                    |
| **`SERIES.registre` et `SERIES.inventaire`** (`numerotation.ts:27-28`)                             | Deux natures déclarées, jamais allouées. Se résoudront d'elles-mêmes si §4.2 est corrigé                                                                                                                                                                                                               |
| **`prevision.commentaire_ia` / `explication_facteurs`**                                            | Écrites à l'archivage, jamais relues. Utiles le jour où un écran affichera une prévision archivée ; inutiles aujourd'hui                                                                                                                                                                               |
| **Écran `InventaireInitial`** (`/stock/inventaire`)                                                | Routé (`App.tsx:45`) mais **absent de la navigation** : la seule porte d'entrée est le bouton d'état vide de `Stock.tsx:604`, qui disparaît dès la première réception. Acceptable pour un inventaire _d'ouverture_ ; problématique le jour où l'inventaire de comptage périodique du §2.2 sera écrit   |

### 4.13 NORMAL — vérifié, rien à corriger

Il importe de dire ce que cet audit a examiné **et** blanchi.

| Cas                                                                                                                             | Pourquoi c'est normal                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`GET /api/sante`**                                                                                                            | Sonde de diagnostic. Consommée par `serveur.test.ts:33`, `serveur-modes.test.ts:130`, `integration.test.ts:481`. `docs/06:250-264` la destine à un écran de premier lancement qui n'existe pas encore, mais son absence de consommateur UI n'est pas un défaut                 |
| **`GET /api/motifs`**                                                                                                           | Consommée par `SaisieSortie.tsx:133`. Elle sert `CATALOGUE_MOTIFS` (le catalogue TypeScript), pas la table `motif` — c'est cohérent avec D-013 : le catalogue est la source, le seed le transpose, la table ne sert qu'à résoudre les clés étrangères                          |
| **`POST /api/receptions` et `POST /api/mouvements`**                                                                            | Signalées orphelines par un audit précédent : **désormais branchées** (`SaisieReception.tsx:542`, `SaisieSortie.tsx:203`). Le premier maillon de la chaîne §0 est refermé                                                                                                      |
| **`ajouterVersionParametre` / `PATCH /api/parametres/:id`**                                                                     | Signalés inatteignables des deux côtés : **désormais branchés des deux côtés** (`POST /api/parametres/:cle/versions` en `parametres.ts:80` ↔ `Parametres.tsx:510` ; `PATCH` en `parametres.ts:57` ↔ `Parametres.tsx:637`). Le versionnage annuel des seuils légaux est complet |
| **Type de mouvement `sortie_vente`**                                                                                            | Signalé « émis nulle part » : **désormais émis** par `cloturerSession` en FEFO (`services/sessions.ts:505`, décisions D-037 / D-049), lu par `depots/tracabilite.ts:154,338` et par le moteur de réapprovisionnement (`services/commandes.ts:195`). Résolu                     |
| **`production.cout_matiere_reel_cents`**                                                                                        | Signalé jamais écrit : **désormais écrit** par `saisirRealise` (`services/production.ts:342`) et relu par `depots/sessions.ts` / `depots/previsions.ts:183`. Résolu                                                                                                            |
| **`journal_audit` en écriture**                                                                                                 | Signalé « n'existe que dans le schéma » : **désormais écrit** par 8 sites. Seule la lecture manque (§4.9)                                                                                                                                                                      |
| **Les 6 routes `PATCH`**                                                                                                        | Toutes consommées. Deux d'entre elles ne le sont que via une variable `chemin` (`Fournisseurs.tsx:355`, `Produits.tsx:360`) : une recherche littérale aurait conclu à tort                                                                                                     |
| **`GET /api/produits-vendables`, `GET /api/lieux`, `GET /api/seuils`, `GET /api/qualite-modele`, `GET /api/synthese-exercice`** | Toutes consommées, malgré leur absence du bloc REST de `docs/06:196-225`                                                                                                                                                                                                       |
| **`documents/rendu.ts`** (`rendrePdf`, `archiverFichierGenere`, `documentHtml`, `echapper`)                                     | Appelés en production par `routes/commandes.ts` et `routes/previsions.ts`. Le moteur de rendu n'est pas orphelin — ce sont ses gabarits qui n'ont pas de route                                                                                                                 |
| **`gabarits.ts` : `bonCommande`, `briefAvantMarche`**                                                                           | Appelés en production. Ce sont leurs **routes** qui sont orphelines, pas les fonctions                                                                                                                                                                                         |
| **`allouerNumero`**                                                                                                             | 5 appelants de production. Seules 2 des 6 natures déclarées sont mortes                                                                                                                                                                                                        |
| **`amortissement_annuite`, `echeance`, `periode`, `depense`, `immobilisation`**                                                 | Écrites et lues, branchées à `Comptabilite.tsx`. Rien à signaler                                                                                                                                                                                                               |
| **Aucune route fantôme**                                                                                                        | Aucun écran n'appelle une route inexistante : les 69 chemins consommés existent tous                                                                                                                                                                                           |

---

## 5. Sens D — fonctions exportées sans appelant de production

Méthode : extraction de tous les `export function` / `export const` / `export class` des fichiers
non-test de `packages/core/src` et `packages/db/src` (**416 symboles de valeur**), puis recherche
du symbole exact **hors** fichiers de test, **hors** barrels (`core/src/index.ts`,
`core/src/contrats/index.ts`, `core/src/prevision/index.ts`, `db/src/index.ts`, qui ne font que
réexporter) et **hors** homonymes de champs. Deux passes indépendantes (grep mot-entier + graphe
d'imports) ont été croisées ; les cinq divergences ont été tranchées à la main.

**Résultat : 40 symboles sur 416 (9,6 %) n'ont aucun appelant de production.**

### 5.1 `packages/core` — 11 orphelins

| Déclaration           | Symbole              | Cité où                                                        | Commentaire                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `motifs.ts:105`       | `definitionMotif`    | ~~**nulle part**~~ → production + tests (30/07/2026)           | voir §5.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `motifs.ts:110`       | `motifsPour`         | ~~**nulle part**~~ → testée ; câblage web restant (30/07/2026) | voir §5.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `unites.ts:34`        | `convertir`          | ~~tests seuls~~ → production (30/07/2026)                      | **la fonction qui porte la règle d'architecture n°4** (« les conversions volume↔masse passent obligatoirement par la densité déclarée »). **Mise à jour du 30/07/2026** : elle a désormais un appelant de production, `packages/db/src/services/sessions.ts:394` (import `:15`), pour convertir en millilitres un volume de pâte restant saisi en grammes lors de la clôture de session — `convertir` refuse elle-même la conversion si aucune densité de pâte n'est déclarée, ce que le code appelant rattrape sans jamais inventer de facteur (voir le commentaire `sessions.ts:387-391`). Vérifié par grep sur tout le dépôt, hors fichiers de test. |
| `unites.ts:20`        | `estUnite`           | test seul                                                      | garde de type inutilisée                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `argent.ts:150`       | `repartir`           | ~~test seul~~ → production (30/07/2026)                        | répartition d'un total en centimes **exacts** sur des poids. Les occurrences « prod » repérées à l'origine (`Tableau.tsx:201`, `services/sessions.ts:467`) étaient bien le **verbe français** dans un commentaire, pas des appels — mais **deux vrais appels de production sont apparus depuis** : `packages/core/src/menus.ts:120` (ventilation du prix d'un menu sur ses composants) et `packages/core/src/prevision/repartition-production.ts:154` (répartition du nombre de crêpes cible entre recettes). Vérifié par grep sur tout le dépôt, hors fichiers de test, le 30/07/2026.                                                                 |
| `sessions.ts:312`     | `partRevenduBp`      | test seul                                                      | **la logique est ré-implémentée côté base** : `depots/sessions.ts:267` calcule la même part avec `ratioEnPointsDeBase`. Or c'est exactement le chiffre que `CLAUDE.md` §6 rend structurant (ventilation transformé / revendu pour les seuils légaux) — il est calculé hors de `packages/core`, contre la règle d'architecture n°1. **Vérifié à nouveau le 30/07/2026, toujours vrai** : le symbole a bougé à `sessions.ts:583` et la duplication vit désormais à `depots/sessions.ts:460`, mais aucun appelant de production de la fonction `packages/core` n'existe.                                                                                   |
| `comptabilite.ts:185` | `totaliserJournal`   | tests seuls                                                    | totalisation d'un journal comptable — sans écran ni export qui l'utilise (§2.3). **Vérifié à nouveau le 30/07/2026, toujours vrai.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `production.ts:150`   | `decomposerEcart`    | ~~tests seuls~~ → production (30/07/2026)                      | décomposition de l'écart de production. **Mise à jour du 30/07/2026** : appelée désormais par `packages/db/src/services/production.ts:537`, dans un nouveau mécanisme de correction manuelle de la consommation réelle qui écrit enfin une vraie valeur dans `quantite_reelle` (voir §3.2, §4.8) — le « sans consommateur » d'origine tombe avec sa propre cause.                                                                                                                                                                                                                                                                                       |
| `recettes.ts:219`     | `ingredientLimitant` | test seul                                                      | les hits « prod » sont un **champ homonyme** (`production.ts:32/108/115`, `contrats/productions.ts:35`, `routes/productions.ts:59`). **Vérifié à nouveau le 30/07/2026, toujours vrai**, y compris pour le nouvel appelant `apps/api/src/routes/productions.ts:108`, qui lit le même champ homonyme.                                                                                                                                                                                                                                                                                                                                                    |
| `stock.ts:215`        | `lotsProchesDlc`     | ~~test seul~~ → production (30/07/2026)                        | **Mise à jour du 30/07/2026** : appelée désormais par `packages/db/src/depots/stock.ts:287`. Un test dédié (`packages/db/src/audit-silences.test.ts:168-173`) verrouille la non-régression. À ne pas confondre avec `lotsAlerteDlc` (db), qui, lui, servait déjà. La déclaration a glissé de `stock.ts:204` (28/07) à `:215` (30/07).                                                                                                                                                                                                                                                                                                                   |
| `affichage.ts:91`     | `statutParPlafond`   | ~~test seul~~ → production (30/07/2026)                        | jauge de plafond. **Mise à jour du 30/07/2026** : appelée désormais en production par `apps/web/src/pages/TableauDeBord.tsx:449` et `apps/web/src/pages/Objectifs.tsx:59`, via `statutSeuil` (`packages/core/src/sessions.ts:448-452`), qui combine ce signal (le réalisé) avec `depassementProjete` (la trajectoire). C'est le correctif que `docs/16-AUDIT-COMPTABILITE.md` §2 proposait explicitement (voir la mise à jour apportée à ce document) : l'alerte à 80 % du seuil, absente en 28/07, est désormais atteignable.                                                                                                                          |

**Exportés sans être dead code** — utilisés à l'intérieur de leur propre fichier, donc l'export est
superflu mais la logique vit : `calculerPointCommande` et `calculerBesoinBrut`
(`reapprovisionnement.ts:102`, `:158`, appelés par `calculerBesoinReapprovisionnement:261,271` qui,
lui, est utilisé par `services/commandes.ts:17`), `quantileNormal` (`statistiques.ts:73`),
`sigmaRetenu` (`moteur.ts:163`), `rendementReelBp` (`production.ts:196`), `assainirDetailIa`
(`ia.ts:265`), `prochaineOccurrence` (`comptabilite.ts:475`).

### 5.2 `packages/db` — 29 orphelins

**Neuf fonctions de dépôt / service** réexportées par le barrel et importées par aucun `apps/` :

| Déclaration                  | Symbole                 | Cité où                                           | Enjeu                                                                                                                                                                                                                              |
| ---------------------------- | ----------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `depots/audit.ts:115`        | `listerJournalAudit`    | ~~barrel + 3 tests~~ → production (30/07/2026)    | **le journal d'audit est illisible** (§4.9). **Mise à jour du 30/07/2026** : appelée par `apps/api/src/routes/audit.ts:136`, nouveau fichier dont l'en-tête cite explicitement ce constat au passé. Trou fermé côté route.         |
| `services/mouvements.ts:310` | `annulerMouvement`      | ~~barrel + 2 tests~~ → production (30/07/2026)    | **Mise à jour du 30/07/2026** : appelée par `apps/api/src/routes/stock.ts:340`. La contrepassation d'un mouvement erroné est désormais atteignable par une route.                                                                  |
| `services/mouvements.ts:418` | `changerStatutLot`      | ~~barrel + 1 test~~ → production (30/07/2026)     | **Mise à jour du 30/07/2026** : appelée par `apps/api/src/routes/stock.ts:393`. La mise en quarantaine / blocage d'un lot est désormais atteignable par une route.                                                                 |
| `depots/stock.ts:179`        | `mouvementsDuLot`       | ~~barrel + 1 test~~ → production (30/07/2026)     | **Mise à jour du 30/07/2026** : appelée par `apps/api/src/routes/stock.ts:284`. L'historique de mouvements d'un lot est désormais affiché (consommé aussi par `apps/web/src/saisie-stock/DetailLot.tsx:184`).                      |
| `depots/stock.ts:112`        | `tousLesLots`           | ~~barrel + 1 test~~ → production (30/07/2026)     | **Mise à jour du 30/07/2026** : appelée par `apps/api/src/routes/equipements.ts:250`.                                                                                                                                              |
| `depots/stock.ts:196`        | `verifierInvariantLots` | ~~barrel + 3 tests~~ → production (30/07/2026)    | **Mise à jour du 30/07/2026** : appelée depuis `depots/stock.ts:250`, qui l'enveloppe pour un usage applicatif (diagnostic d'écran). Le contrôle d'intégrité du stock s'exécute désormais hors tests.                              |
| `depots/previsions.ts:852`   | `rapprocherPrevision`   | ~~barrel seul, 0 test~~ → production (30/07/2026) | **Mise à jour du 30/07/2026** : appelée par `packages/db/src/services/sessions.ts:1070`, à la clôture de session — exactement le point d'appel dont l'absence était signalée. Le rapprochement prévu/réalisé fonctionne désormais. |
| `depots/productions.ts:113`  | `productionsDuLot`      | **barrel seul, 0 test**                           | — **Vérifié à nouveau le 30/07/2026, toujours vrai** : seule la déclaration et le barrel citent ce symbole.                                                                                                                        |
| `depots/numerotation.ts:92`  | `lireSeries`            | **barrel seul, 0 test**                           | — **Vérifié à nouveau le 30/07/2026, toujours vrai** : seule la déclaration et le barrel citent ce symbole.                                                                                                                        |

**Deux tables jamais requêtées** : `factureLigne` (`schema.ts:1105`), `fraisReception`
(`schema.ts:1134`). `factureFournisseur` (`schema.ts:1082`) n'échappe au décompte que par sa clé
étrangère depuis `factureLigne:1111` — orphelin transitif.

**Dix-huit `relations()`** (`schema.ts:1423` à `:1550`). Nuance vérifiée : elles sont bien passées à
l'ORM par `drizzle(sqlite, { schema })` (`client.ts:35`). Mais elles ne servent qu'à l'API
relationnelle `base.query.<table>.findMany({ with })`, et **un balayage de `\.query\.` sur tout le
dépôt ne renvoie que des `requete.query` Fastify** : zéro usage. Elles ne sont donc jamais
exercées, ni directement ni par Drizzle. Sans les `relations*`, `packages/db` retombe à
**11 orphelins « métier »**.

### 5.3 Symboles dont le seul appelant de production est un seed ou un script CLI (9)

`reinitialiser` (`reinitialiser.ts:17`), `seed` (`seed/index.ts:31`), `seedDemonstration`
(`seed/demonstration.ts:335`), `seedParametres` (`seed/parametres.ts:29`), `seedMotifs`
(`seed/motifs.ts:20`), `seedAfsca` (`seed/afsca.ts:90`), `seedFournisseursSysteme`
(`seed/fournisseurs-systeme.ts:44`), `seedDemonstrationActivite` (`seed/activite.ts:265`),
`FOURNISSEUR_INVENTAIRE_OUVERTURE` (`seed/fournisseurs-systeme.ts:38`).

C'est normal pour huit d'entre eux. **Le neuvième mérite un signalement** :
`FOURNISSEUR_INVENTAIRE_OUVERTURE` est semé par `seed()` (donc présent dans toute base) et
`seed/fournisseurs-systeme.ts:6-7` justifie son existence par « sans eux, une fonction documentée
de l'application est inutilisable dès la première minute ». Or **l'écran qui en a besoin ne le
connaît pas** : `InventaireInitial.tsx:20-27` affirme qu'« il n'existe ni fournisseur nullable, ni
fournisseur "inventaire d'ouverture" pré-semé » et demande à l'utilisateur d'en **créer un à la
main** (`InventaireInitial.tsx:77-82`). Le fournisseur système existe, il est actif, `GET
/api/fournisseurs` le renvoie — et l'écran dit le contraire. Chaque installation créera donc un
doublon manuel.

**Faux positifs écartés** : `purger` (`sauvegarde.ts:54`) est appelé par `sauvegarder():49`,
lui-même appelé par `apps/api/src/contexte.ts:27` — vraie production. `seedEcheances`
(`depots/comptabilite.ts:451`) est appelé par `routes/comptabilite.ts:156` — vraie production.

### 5.4 Le cas nommé : `definitionMotif()` et `motifsPour()`

`packages/core/src/motifs.ts:105` et `:110`.

- **Appelants de production : 0. Tests : 0.** Occurrences totales dans le dépôt : **3** — les deux
  déclarations, plus une mention documentaire en `docs/05-DECISIONS.md:1190` qui note déjà qu'elles
  « ne sont appelées par aucun test ». Le présent audit ajoute qu'elles ne sont pas non plus
  appelées par la production.
- **Le code qui devrait les appeler les duplique.**
  `apps/api/src/routes/stock.ts:130` écrit
  `const definition = CATALOGUE_MOTIFS.find((m) => m.code === corps.motifCode);` — c'est
  **mot pour mot** le corps de `definitionMotif` (`motifs.ts:106`).
  Côté web, `SaisieSortie.tsx:48-70` reconstruit à la main la table
  type de sortie → catégorie de motif, puis filtre le catalogue reçu — c'est-à-dire
  `motifsPour`, réécrit dans le navigateur.
- **Verdict** : `definitionMotif` est du code mort **par duplication** (un seul site à réécrire,
  `routes/stock.ts:130`) ; `motifsPour` est du code mort **pur** — la route `GET /api/motifs`
  (`stock.ts:85-93`) renvoie le catalogue entier sans filtre, et le filtrage par catégorie s'est
  déplacé côté client, contre la règle d'architecture n°1.

> **Mise à jour du 30/07/2026 — ce verdict est en partie périmé, et le mot « mort » était le mauvais
> mot.**
>
> - **`definitionMotif` a désormais un appelant de production réel** :
>   `packages/db/src/services/mouvements.ts:513`, pour le libellé d'une non-conformité. Elle est
>   aussi testée (`packages/core/src/motifs.test.ts`), y compris sur le code inconnu — qui rend
>   `undefined` et non un libellé inventé.
> - **Les deux duplications de `routes/stock.ts` sont supprimées** : `resoudreCodeMotif` et le
>   libellé de mouvement appellent `definitionMotif`. Le troisième usage de `CATALOGUE_MOTIFS` dans
>   ce fichier (`GET /api/motifs`, qui sert le catalogue entier) est légitime et reste en place.
> - **`motifsPour` n'était pas du code mort : c'était un câblage manquant**, ce qui appelle la
>   décision inverse. La supprimer aurait laissé le filtre réécrit à la main dans
>   `apps/web/src/saisie-stock/SaisieSortie.tsx` comme **seule** implémentation de la règle — donc
>   entériné l'écart d'architecture au lieu de le corriger. Elle est gardée et testée ; il reste à
>   remplacer le filtre manuel de cet écran par un appel à `motifsPour`.
>
> La leçon dépasse ce cas : **« aucun appelant » ne veut pas dire « inutile ».** Il faut d'abord
> chercher si quelqu'un fait déjà le travail à sa place, ailleurs et moins bien.

### 5.5 Note hors périmètre : types purs orphelins

238 `export type` / `interface` dans les deux packages, dont **46 sans aucune référence** hors
déclaration et barrel — massivement concentrés dans `packages/core/src/contrats/`, où ce sont les
`z.infer` des enveloppes de liste, jamais consommés côté client. Exemples :
`contrats/stock.ts:135-141` (5 d'affilée), `contrats/afsca.ts:301-323` (13),
`contrats/comptabilite.ts:200-210` (7), `contrats/referentiel.ts:325-342` (5). Sans conséquence
fonctionnelle : c'est du bruit de lecture, pas un défaut.

---

## 6. Ce que cet audit a confirmé résolu

Quatre défauts signalés par des audits précédents ont été vérifiés et sont **fermés** :

1. **`POST /api/receptions` et `POST /api/mouvements`** — branchés à `SaisieReception.tsx:542` et
   `SaisieSortie.tsx:203`. Le premier maillon de la chaîne §0 (enregistrer une livraison) est
   atteignable sans forger de requête HTTP.
2. **`ajouterVersionParametre` et `PATCH /api/parametres/:id`** — exposés
   (`parametres.ts:80`, `:57`) **et** consommés (`Parametres.tsx:510`, `:637`). Le versionnage
   annuel des seuils légaux fonctionne des deux côtés.
3. **`sortie_vente`** — émis par `cloturerSession` en FEFO (`services/sessions.ts:505`, D-037 /
   D-049), lu par la traçabilité (`depots/tracabilite.ts:154,338`) et par le moteur de
   réapprovisionnement (`services/commandes.ts:195`).
4. **`production.cout_matiere_reel_cents`** — écrit par `saisirRealise`
   (`services/production.ts:342`) et relu.

Un cinquième est **à moitié fermé** : `journal_audit` est désormais **écrit** (8 sites d'appel de
`journaliser`) mais toujours **illisible** (§4.9).

> **Mise à jour du 30/07/2026 — le cinquième point est désormais fermé aussi.** `listerJournalAudit`
> a un appelant de production (`apps/api/src/routes/audit.ts:136`, voir §4.9 et §5.2) : `journal_audit`
> est maintenant écrit ET lisible. Par ailleurs, la même vérification a fermé plusieurs des « quatre
> trous à traiter en premier » listés en §7 ci-dessous : voir les encadrés de §4.1, §4.2, §4.3, §4.7,
> §4.9 et §4.10 pour le détail, avec `fichier:ligne` à l'appui de chacun.

---

## 7. Synthèse

| Sens  | Mesure                                                                                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | 76 routes exposées, **69 consommées**, **7 orphelines**, 0 fantôme                                                                                                                                         |
| **B** | 9 routes annoncées et absentes ; ~19 gestes annoncés et absents ; **2 PDF sur 7 et 0 Excel sur 4 atteignables par une route, 0 document sur 15 atteignable par un bouton**                                 |
| **C** | 41 tables : **4 mortes**, **3 écrites et jamais relues**, **5 que seul le seed peut créer**, 1 morte en usage ; **7 colonnes mortes**, 2 écrites-jamais-lues, **1 lue et affichée mais jamais renseignée** |
| **D** | 416 symboles exportés, **40 sans appelant de production (9,6 %)**, dont 22 cités nulle part du tout                                                                                                        |

> **Mise à jour du 30/07/2026 — ce tableau de synthèse est un plancher, pas un compte à jour.** Les
> quatre chiffres (A/B/C/D) datent du 28/07/2026 et n'ont pas été recomptés selon la méthode
> d'origine (voir l'encadré en tête de document : au moins 12 nouveaux fichiers de routes sont
> apparus). Ce qui est vérifié, en revanche : la plupart des « trous » et « orphelins » que ces
> chiffres résumaient sont fermés — voir la liste corrigée ci-dessous et les encadrés de §2, §3, §4,
> §5.

**Les cinq trous à traiter en premier (28/07/2026)** — état individuel au 30/07/2026 :

1. **`produit_garniture`** (§4.1) — chiffre faux, **0,073 €/crêpe**, ≈ 9,82 €/session,
   ≈ 393 €/an, plus une rupture de traçabilité sur des denrées à DLC.
   **Fermé côté lecture** : `produit_garniture` alimente désormais `GET /api/couts-produits`
   (`apps/api/src/routes/recettes.ts:110`). Chiffre non recalculé par mes soins — voir l'encadré de
   §4.1.
2. **Registre AFSCA mensuel** (§4.2) — la seule sortie opposable à un contrôle, écrite et
   inaccessible ; classée « minimum vital » par `docs/04:206-207`.
   **Fermé** : route (`documents.ts:242`) et bouton (`RegistreAfsca.tsx:2496`).
3. **Affichette allergènes** (§4.3) — obligation d'affichage réglementaire, écrite et
   inaccessible ; même classement.
   **Fermé** : route (`documents.ts:139`) et bouton (`RegistreAfsca.tsx:2509`).
4. **Écriture du référentiel** (§4.7) — ni ingrédient, ni conditionnement, ni recette, ni lieu ne
   peut être créé depuis l'application. Le premier maillon de la chaîne §0 (_qu'est-ce que
   j'achète, à quel prix, chez qui_) n'est pas saisissable, et R2 restera vide à vie.
   **Fermé entièrement** (rectifié le 30/07/2026, contrôle tardif) : ingrédient, conditionnement,
   lieu **et recette** — création, modification et versionnage — sont tous saisissables
   (`referentiel-ecriture.ts`, `Ingredients.tsx`, `LieuxMarche.tsx`, `Recettes.tsx:1388-1393`).
   Un contrôle antérieur du même soir concluait à tort que la création d'une recette entière
   n'était pas câblée : le chemin est calculé dans une variable, invisible à une recherche
   littérale — voir la rectification de §4.7.
5. **Brief avant-marché et analyse d'écart** (§4.4, §4.5) — les deux gestes que `docs/01` place
   explicitement le samedi soir et le dimanche soir, tous deux à une route de distance.
   **Toujours ouvert au 30/07/2026** — aucun des deux boutons n'a été trouvé dans `apps/web/src`.

**Le motif commun (28/07/2026).** Sur les cinq, quatre sont des capacités **entièrement écrites et
testées** auxquelles il ne manque qu'un branchement — une route, ou un bouton. C'est le profil décrit
en introduction : le typage est content, les tests passent, la porte de sortie est verte, et le geste
est impossible. **Au 30/07/2026, quatre de ces cinq trous sont refermés** (§4.1 côté lecture, §4.2,
§4.3, §4.7 entièrement), **un seul reste ouvert** (§4.4/§4.5, le brief et l'analyse d'écart) —
cohérent avec le motif commun : c'était bien, pour l'essentiel, un problème de branchement, et le
branchement a été fait.

> **Leçon de méthode, ajoutée le 30/07/2026 — la même erreur a été commise trois fois dans ce seul
> document, dans les deux sens.** §5.4 (le cas `motifsPour`) enseignait déjà que « aucun appelant »
> ne veut pas dire « inutile ». La rectification de §4.7 enseigne le symétrique, plus embarrassant :
> **« je n'ai trouvé aucun appel » ne veut pas dire « il n'y en a pas »**. Trois fois, un contrôle a
> conclu à l'absence d'un appelant que le code portait pourtant — parce que le chemin HTTP est
> construit dans une variable (`chemin`/`methode`), ou parce que le grep était restreint à `*.ts`
> quand l'appelant vivait dans un `.tsx` (cas `statutParPlafond`, §5.1). Ce document décrit lui-même
> ce piège en §0 note 2, et il y est retombé. La contre-mesure n'est pas « mieux grepper » : c'est de
> **lire l'écran qui devrait faire le geste** avant de conclure qu'il ne le fait pas.
