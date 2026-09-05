# 31 — Documents ouverts et lus (audit indépendant)

> Audit réalisé sur une instance entièrement isolée : API sur `127.0.0.1:4931`, base neuve dans
> le dossier temporaire de session (`.../scratchpad/audit-docs-ouverts-4931/db/batte.sqlite`),
> `db:migrate` + `db:seed` + `db:seed:demo`. Aucune requête vers `127.0.0.1:3001` (serveur du
> porteur, jamais démarré ni contacté par cet audit). Web non lancé : la mission autorise
> explicitement l'appel direct de l'API pour produire les documents ; les valeurs « écran » citées
> ci-dessous sont donc lues soit dans la réponse JSON qui alimente l'écran, soit recalculées en
> appliquant EXACTEMENT la fonction TypeScript que l'écran appelle (citée à chaque fois), jamais
> une capture de navigateur réel — voir §5.
>
> Le serveur de dev (`tsx watch`) redémarrait toutes les 20-40 secondes à cause d'un autre agent
> qui éditait `packages/db/src/depots/referentiel-ecriture.ts` en parallèle : après un premier
> essai perturbé, l'instance a été relancée en **process ponctuel** (`tsx src/serveur.ts`, sans
> `watch`) pour ne plus dépendre du reste du dépôt pendant la génération des documents. PID exact
> du chemin isolé retracé et arrêté proprement en fin d'audit (`taskkill /PID … /T /F`, vérifié par
> `Get-NetTCPConnection` avant et après).
>
> Tous les fichiers produits (PDF, XLSX, images PNG, scripts) sont dans
> `.../scratchpad/audit-docs-ouverts-4931/` du dossier temporaire de session ; ils ne survivront
> pas à la session, d'où une description écrite complète de chaque constat plutôt qu'un simple
> renvoi au fichier.

---

## 1. Combien de documents, combien ouverts

**Commande qui a dérivé la liste** (jamais énumérée à la main) :

```
Grep "rendrePdf|ExcelJS|new Workbook|archiverExportExcel" sur apps/api/src  -> 9 fichiers
Grep "rendrePdf|ExcelJS|new Workbook|archiverExportExcel" sur packages/    -> 0 fichier
```

Les 9 fichiers non-tests sont `documents/rendu.ts`, `documents/excel.ts` (les deux mécanismes de
rendu) et les 4 fichiers de routes qui les appellent : `routes/documents.ts`, `routes/commandes.ts`,
`routes/previsions.ts`, `routes/economies.ts` (les 3 autres sont des `*.test.ts`). Chacun de ces 4
fichiers de routes a été relu en entier pour compter chaque `app.get(...)` qui appelle réellement
`rendrePdf` / `archiverExportExcel` / `exportXxx`. Recherche complémentaire de `from 'docx'` sur
`apps/api/src` : aucune occurrence — aucun document Word n'existe encore (cohérent avec CLAUDE.md
§2 : « uniquement si le comptable l'exige »).

**Résultat : 12 documents distincts, 12 générés, 12 ouverts et lus.** Deux variantes supplémentaires
(registre AFSCA et journal des recettes sur une période **sans aucune donnée**) ont été produites et
lues en plus, pour tester spécifiquement le point 6 de la mission — soit **14 fichiers produits, 14
ouverts**.

| #   | Document                              | Format | Route                                           | Généré | Ouvert               |
| --- | ------------------------------------- | ------ | ----------------------------------------------- | ------ | -------------------- |
| 1   | Fiche technique (R1)                  | PDF    | `GET /documents/fiche-technique/:id`            | Oui    | Oui (image)          |
| 2   | Affichette allergènes                 | PDF    | `GET /documents/affichette-allergenes`          | Oui    | Oui (image)          |
| 3   | Étiquette de bac                      | PDF    | `GET /documents/etiquette-bac/:id`              | Oui    | Oui (image)          |
| 4   | Rapport de session                    | PDF    | `GET /documents/rapport-session/:id`            | Oui    | Oui (image)          |
| 5   | Registre AFSCA (juillet 2026, rempli) | PDF    | `GET /documents/registre-afsca?periode=2026-07` | Oui    | Oui (image, 3 pages) |
| 5b  | Registre AFSCA (juin 2026, **vide**)  | PDF    | idem, `periode=2026-06`                         | Oui    | Oui (image)          |
| 6   | Brief avant-marché                    | PDF    | `GET /prevision/brief`                          | Oui    | Oui (image)          |
| 7   | Bon de commande                       | PDF    | `GET /commandes/:id/pdf`                        | Oui    | Oui (image)          |
| 8   | État de stock valorisé                | Excel  | `GET /exports/stock`                            | Oui    | Oui (cellules)       |
| 9   | Journal des recettes (2026, rempli)   | Excel  | `GET /exports/journal-recettes?annee=2026`      | Oui    | Oui (cellules)       |
| 9b  | Journal des recettes (2020, **vide**) | Excel  | idem, `annee=2020`                              | Oui    | Oui (cellules)       |
| 10  | Journal des achats                    | Excel  | `GET /exports/journal-achats?annee=2026`        | Oui    | Oui (cellules)       |
| 11  | Journal des mouvements                | Excel  | `GET /exports/mouvements?annee=2026`            | Oui    | Oui (cellules)       |
| 12  | Suivi des économies d'achat           | Excel  | `GET /exports/economies?annee=2026`             | Oui    | Oui (cellules)       |

Méthode de lecture : les 7 PDF ont été **rendus en image PNG** page par page (`mupdf`, moteur WASM
installé isolément dans le dossier temporaire, jamais dans le dépôt) puis regardés — une première
tentative d'extraction de texte (`pdftotext -layout`) a été **abandonnée comme preuve de mise en
page** : elle mélange l'ordre des colonnes d'un tableau CSS (vérifié sur la fiche technique : le
rendu image montre les 3 colonnes parfaitement alignées alors que `pdftotext` les recompose dans le
désordre). Les 6 classeurs Excel ont été ouverts avec **ExcelJS** (déjà une dépendance du dépôt) et
chaque cellule listée avec sa valeur ET, quand il y en a une, sa formule.

Rien n'a été impossible à produire ni à ouvrir.

---

## 2. Deux constats déjà corrigés depuis le dernier audit (`docs/24`) — vérifiés, pas supposés

Avant les défauts encore présents : trois défauts CRITIQUES/GRAVES de `docs/24` ont été **revérifiés
sur le code actuel et sont corrigés**. Il serait malhonnête de les re-signaler comme ouverts.

- **Pied de page** (`docs/24` §2.2) : les 5 PDF qui doivent en porter un (fiche technique, rapport
  de session, registre AFSCA, bon de commande, brief) l'affichent bien sur **chaque page**, vérifié
  visuellement sur les 3 pages du registre AFSCA de juillet (« Registre AFSCA — Juillet 2026 · page
  1/3 », etc.). Code actuel : `documentHtml` retourne désormais `{ html, options }`
  (`apps/api/src/documents/rendu.ts:95-116`, commentaire « DÉFAUT CORRIGÉ »), et chaque site d'appel
  fait `...renduGabarit` pour que `options.pied` atteigne réellement `rendrePdf`
  (`apps/api/src/routes/documents.ts:117-262`, `commandes.ts`, `previsions.ts`).
- **Tableau qui perd des colonnes** (`docs/24` §2.1, CRITIQUE) : `style-impression.ts:132-164` porte
  maintenant `table-layout: fixed` + un commentaire citant explicitement docs/24 §2.1, et chaque
  gabarit déclare un `<colgroup>` de largeurs qui somment à 100. Vérifié sur le tableau
  « Non-conformités » du registre AFSCA (7 colonnes, dont 3 de texte libre) : les 7 colonnes
  restent visibles avec des descriptions longues, le texte s'enroule DANS la cellule au lieu de
  pousser les colonnes suivantes hors de la page.
- **Fournisseur et DLC absents dès qu'un numéro de lot existe** (`docs/24` §2.3) :
  `libelleLotConcerne` (`apps/api/src/documents/registre-afsca.ts:551-563`) joint désormais
  numéro ET DLC avec un `.filter(...).join(' — ')`, plus le fournisseur. Vérifié sur le lot de
  beurre du registre de juillet : « Beurre — [démo] Fournisseur générique — DÉMO-BEURRE-01 — DLC
  05/09/2026 » — les quatre informations demandées par la mission (fournisseur, numéro, DLC,
  statut) apparaissent bien ensemble.

---

## 3. Les chiffres qui contredisent l'écran (ou un autre document)

### 3.1 — Fenêtre DLC : le brief dit la sienne (7 j), l'écran ne dit jamais la sienne (14 j)

Exactement le cas visé par la mission, reproduit avec des valeurs réelles de cette instance.

- Lot d'œufs `DÉMO-OEUFS-01`, DLC **2026-08-12**. Jour de référence de l'instance : **2026-08-01**.
  Écart réel : **11 jours**.
- **Brief avant-marché réellement rendu** (`06-brief-avant-marche.pdf`) : section intitulée
  « LOTS À MOINS DE **7 JOURS** DE LEUR DLC » (le document annonce sa fenêtre, en clair) →
  « Aucun lot à moins de 7 jours de sa DLC. » (11 > 7, correctement absent). Fenêtre lue dans le
  paramètre `brief_horizon_alerte_dlc_jours = 7` (`GET /api/parametres`), consommé par
  `apps/api/src/routes/previsions.ts:1399-1400` puis `lotsAlerteDlc`/`lotsProchesDlc`
  (`packages/db/src/depots/stock.ts:385-406`, `packages/core/src/stock.ts:215-225` — cette dernière
  n'exclut que les lots `detruit`, donc un lot **bloqué** comme celui-ci reste éligible).
- **Écran (Stock.tsx et le tableau de bord)** : la même donnée (`dlcLaPlusProche` de l'ingrédient
  « Œufs entiers », confirmé `2026-08-12` sur `GET /api/stock` malgré le lot bloqué) passe par
  `formaterJoursRestants(dlc, jour)` dont l'horizon par défaut est **`14`, codé en dur comme valeur
  par défaut d'un paramètre de fonction** (`packages/core/src/horodatage.ts:98`) — jamais une valeur
  de la table `parametre`, jamais affiché en toutes lettres nulle part dans l'interface (recherche
  de `14 jours` dans `TableauDeBord.tsx` et `Stock.tsx` : aucune occurrence, seul un commentaire de
  code le mentionne, `TableauDeBord.tsx:707-711`). Avec 11 ≤ 14, ce lot afficherait un compteur
  « J-11 » sur la colonne DLC de `Stock.tsx`, et serait compté dans le totalisateur du tableau de
  bord — le libellé exact est `${dlcProches.length} ingrédient(s) avec un lot proche de sa DLC`
  (`TableauDeBord.tsx:830`), qui, sur ce jeu de données, vaudrait **« 1 ingrédient avec un lot
  proche de sa DLC »**.
- **Constat** : la même DLC est simultanément « rien à signaler » sur le document qu'on lit avant de
  partir au marché et « 1 ingrédient à surveiller » sur l'écran qu'on a sous les yeux le reste de la
  semaine — sans qu'aucun des deux textes ne permette de deviner que l'autre existe. Le brief a au
  moins le mérite d'annoncer sa fenêtre (« à moins de 7 jours ») ; l'écran, lui, ne l'annonce jamais.

### 3.2 — Étiquette de bac : une heure fabriquée, absente de l'écran pour la même donnée

- **Document réellement rendu** (`03-etiquette-bac.pdf`, production `PR-2026-0001`) :
  « Produit le **25/07/2026 02:00** » / « À CONSOMMER AVANT LE **26/07/2026 02:00** ».
- **Écran** (`Production.tsx:1639` et `:1964`) pour EXACTEMENT le même champ
  (`detailCourant.dateProduction`) : « Produit le **25/07/2026** » — jamais d'heure. La DLC de pâte
  affichée à l'écran (`rendreDlcPate`, `Production.tsx:215-217`) passe elle aussi par `formaterDate`
  (date seule), jamais `formaterDateHeure`.
- **Cause exacte** : `gabarits.ts:317-324` appelle `formaterDateHeure(donnees.dateProduction)` et
  `formaterDateHeure(donnees.dateDlc)` — un formateur DATE+HEURE — alors que
  `donnees.dateProduction` (`documents/donnees.ts:445`) est un **jour civil pur** (`"2026-07-25"`,
  sans heure). `new Date("2026-07-25")` est interprété par JavaScript comme minuit **UTC**, ce qui,
  reformaté en `Europe/Brussels` en été (UTC+2), devient bien « 02:00 » : la conversion de fuseau
  est mathématiquement correcte, mais elle porte sur un instant **entièrement fabriqué** — cette
  date n'a jamais représenté une heure réelle de production. `packages/core/src/horodatage.ts`
  fournit pourtant `formaterDate` (date seule, ligne 31-39), déjà utilisé par l'écran pour ce même
  champ : c'est cette fonction qu'il fallait appeler dans le gabarit, pas `formaterDateHeure`.
  Le même mécanisme (`ajouterHeures(entree.dateProduction + 'T00:00:00Z', dureeHeures)`,
  `packages/db/src/services/production.ts:256-258`) explique pourquoi la DLC de pâte elle-même
  porte une heure : son ancre est un minuit UTC arbitraire, jamais un instant réellement observé.
- **Conséquence** : une étiquette collée sur un bac de pâte affiche une heure de production et une
  heure limite qui n'existent nulle part ailleurs dans l'application et qui n'ont pas de sens
  métier (personne ne produit à 2h du matin) — l'écran, lui, ne montre jamais cette heure pour le
  même fait.

### 3.3 — Les 5 exports Excel : la date d'édition affichera le mauvais jour civil, alors que les 7 PDF affichent le bon

Constat vérifié **empiriquement**, pas seulement lu dans le code : un objet `Date` JS a été écrit
dans une cellule ExcelJS avec le même mécanisme exact que `ajouterFeuilleInformations`
(`apps/api/src/documents/excel.ts:111-127`, `numFmt = 'dd/mm/yyyy'`), le classeur relu **au niveau
XML brut** (dans le zip du `.xlsx`) pour lire le nombre de série Excel réellement écrit.

- Instant testé : `2026-07-31T23:05:01.311Z` — en heure de Bruxelles (été, UTC+2), c'est le
  **01/08/2026 01:05**.
- Nombre de série Excel obtenu : `46234.961820729164`. Reconverti avec la formule standard
  (`(serial - 25569) * 86400000`), ce nombre reconstruit EXACTEMENT `2026-07-31T23:05:01.311Z` — la
  valeur UTC brute, jamais convertie. Excel/LibreOffice n'appliquent aucune conversion de fuseau à
  l'ouverture : ce nombre de série s'affichera **« 31/07/2026 »**, le jour UTC, pas le jour belge.
- Ceci touche `classeur.created = donnees.dateExport` et la cellule « Date d'export » des **5**
  classeurs (`exportStockValorise`, `exportJournalRecettes`, `exportJournalAchats`,
  `exportMouvementsStock`, `exportEconomies`, toutes en `apps/api/src/documents/excel.ts`). Sur les 5
  fichiers réellement générés dans cet audit, la date d'export interne était entre `23:05:01` et
  `23:05:04` UTC le 31/07 — donc, dans les 5 cas, la cellule affichera **31/07/2026** alors que les
  **7 PDF générés à la même minute affichent tous « 01/08/2026 »** en en-tête (`Édité le`, etc.),
  parce que les gabarits PDF appellent `formaterDate`/`formaterDateHeure`
  (`packages/core/src/horodatage.ts:31-52`), qui convertissent explicitement en `Europe/Brussels`
  via `Intl.DateTimeFormat`, alors que la voie Excel ne fait aucune conversion de fuseau — elle
  transmet l'objet `Date` brut à ExcelJS, qui le sérialise en UTC pur.
- **Portée réelle** : ce n'est pas un cas limite rare — cela se produit chaque fois qu'un export est
  généré entre ~22h00 et minuit UTC (~00h00-02h00 heure belge), une fenêtre tout à fait plausible
  pour une sauvegarde ou un export de fin de soirée. Au 31 décembre, ce même mécanisme ferait basculer
  un export dans le mauvais EXERCICE fiscal aux yeux d'un lecteur qui lit la date affichée sans la
  recalculer. Les colonnes « Date » qui portent des jours civils purs (ancrés à minuit UTC,
  `T00:00:00.000Z`) ne sont PAS affectées par ce défaut précis : minuit UTC reste le même jour
  calendaire une fois reformaté, la coïncidence qui sauve ce cas ne sauve pas la date d'export,
  seule vraie donnée horodatée avec une heure significative dans ces classeurs.

### 3.4 — Registre AFSCA : la nuance de fenêtre existe dans le code, mais seulement quand la liste est vide

`donnees.ts:713-717` affirme en commentaire : « le gabarit imprime cette nuance en clair (« à la
date d'édition du registre ») ». Vérifié : c'est **vrai uniquement pour l'état vide**
(`sectionTachesEnRetard`, `registre-afsca.ts:452-456` : « Aucune tâche en retard à la date d'édition
du registre. »). Dès que la liste contient des lignes (le cas normal, vérifié sur le registre de
juillet, 8 tâches en retard) le titre de section redevient un simple « TÂCHES DE NETTOYAGE EN
RETARD » (`registre-afsca.ts:459-460`), **sans** la précision « à la date d'édition ». Un inspecteur
qui lit un registre de juillet en septembre pourrait légitimement croire que ces 8 retards
décrivent l'état de fin juillet, alors qu'ils décrivent l'état du jour où le PDF a été généré —
n'importe quand après. Le commentaire du code décrit une garantie que le rendu ne tient que dans
la moitié des cas.

---

## 4. Défauts de lisibilité

- **Mineur** — colonne STATUT du tableau « Relevés de température » (registre AFSCA) : largeur
  `10%` (`registre-afsca.ts:352`), trop étroite pour le mot « Dépassement » (11 caractères) à
  9,5 pt : le mot se coupe en plein milieu sans trait d'union (« Dépasseme » / « nt »), constaté sur
  le rendu réel de juillet 2026. Rien n'est perdu (`overflow-wrap: break-word` garde tous les
  caractères, la ligne grandit), mais la coupure est disgracieuse sur un mot qui signale
  précisément un dépassement critique de température — c'est la dernière colonne qu'on veut voir
  mal coupée.
- **Aucune perte de colonne constatée** sur les 7 PDF avec les données de ce jeu (voir §2 : le
  correctif `table-layout: fixed` + `colgroup` tient sur le tableau à 7 colonnes le plus à risque).
  Un test de charge avec des textes très longs sans espace n'a pas été rejoué ici (déjà fait dans
  `docs/24`, cause corrigée depuis, voir §2) — non reproduit pour ne pas dupliquer un travail déjà
  fait, uniquement revérifié sur le code.
- **CUMP à 2 décimales masque un sous-centime, l'export « Valeur » n'en dérive pas visuellement** —
  `08-export-stock.xlsx`, ligne Beurre : `CUMP (€/unité)` réellement stocké `0,009000000000000001`
  (donc un flottant, pas un entier de centimes — tension déjà documentée par ailleurs sur le
  stockage du CUMP, non re-découverte ici) s'affiche arrondi à 2 décimales via `FORMAT_MONTANT`
  (`excel.ts`), soit **0,01 €**. Un lecteur qui recalcule `717 g × 0,01 €` obtient 7,17 €, alors que
  la colonne « Valeur (€) » de la même ligne affiche 6,45 € (calculée en interne à pleine précision).
  Rien n'est faux dans les données, mais une vérification manuelle à partir des seuls chiffres
  imprimés ne reboucle pas — pour un ingrédient bon marché au gramme, ce n'est pas un cas rare.

---

## 5. Mentions légales manquantes, document par document

| Document                              | Franchise TVA          | « Ne remplace pas… »   | Identification de l'exploitant |
| ------------------------------------- | ---------------------- | ---------------------- | ------------------------------ |
| Fiche technique                       | Oui                    | — (non concerné)       | Absente                        |
| Affichette allergènes                 | Non concerné           | — (non concerné)       | Absente                        |
| Étiquette de bac                      | Non concerné           | — (non concerné)       | Absente                        |
| Rapport de session                    | Oui                    | **Absente**            | Absente                        |
| Registre AFSCA                        | Non concerné (interne) | Oui — spécifique AFSCA | **Absente**                    |
| Brief avant-marché                    | Non concerné (interne) | — (non concerné)       | Absente                        |
| Bon de commande                       | Oui                    | — (non concerné)       | Absente                        |
| Export stock / mouvements (Excel)     | Non concerné (interne) | **Absente**            | Absente                        |
| Journal des recettes / achats (Excel) | Oui                    | **Absente**            | Absente                        |
| Économies (Excel)                     | Non concerné           | **Absente**            | Absente                        |

- **Aucun document, à l'exception du registre AFSCA, ne porte de mention disant que l'application
  ne remplace pas un comptable ou un guichet d'entreprise**, alors que CLAUDE.md §7 l'impose pour
  les synthèses fiscales et que le code lui-même qualifie explicitement le journal des recettes et
  celui des achats de pièces destinées « au comptable » (commentaires `excel.ts:432`, `:652`).
  Recherche exhaustive (`comptable|guichet d'entreprise|ne remplace` dans
  `apps/api/src/documents/`) : la seule occurrence de « ne remplace » est la phrase spécifique à
  l'AFSCA (`registre-afsca.ts:16-19`). Le rapport de session (CA, marge nette, seuils implicites) et
  les deux journaux Excel destinés au comptable n'ont **aucun** équivalent.
- **Aucune notion d'« exploitant » n'existe nulle part dans le dépôt** — recherche exhaustive de
  `exploitant|raisonSociale|numeroEntreprise|BCE` sur `apps/api/src` et `packages/` : zéro
  occurrence. Le registre AFSCA affiche la période couverte et la date d'édition (les deux
  présentes, vérifié : « Juillet 2026 » et « Édité le 01/08/2026 » sur chaque page), mais **jamais**
  le nom, l'adresse ou le numéro d'entreprise de l'exploitant contrôlé — sur les 3 pages du registre
  de juillet comme sur la page unique du registre de juin (vide). Un registre d'autocontrôle
  présenté à un contrôle AFSCA sans identifier l'établissement est un vrai manque, pas un détail de
  mise en forme.
- **La mention légale du registre AFSCA (§7) n'apparaît qu'une seule fois, sur la dernière page** —
  elle est écrite comme contenu de corps (`registre-afsca.ts:722`, après toutes les sections), pas
  comme pied de page répété (`pied()`, lignes 288-292, qui lui ne porte que le titre et le numéro de
  page). Sur un registre de plusieurs mois qui s'étendrait sur davantage de pages (non testé ici,
  faute de volume de données, voir §6), seule la toute dernière page porterait la phrase
  réglementaire ; une page intermédiaire détachée porterait son numéro de page mais pas la mention.

---

## 6. Ce que cet audit ne couvre pas

- **Le navigateur réel n'a jamais été piloté.** Toutes les valeurs « écran » citées ci-dessus
  viennent soit de la réponse JSON qui alimente l'écran (`/api/stock`, `/api/sessions`, etc.), soit
  d'un recalcul manuel appliquant EXACTEMENT la fonction TypeScript citée (`formaterDate`,
  `formaterJoursRestants`, `lignesDlcProches`…) — jamais une capture Playwright/Chrome du DOM React
  réellement rendu. Un défaut purement visuel côté React (CSS, troncature d'écran) ne serait pas vu
  ici. Vite n'a pas été démarré du tout, conformément à l'autorisation explicite de la mission
  d'appeler l'API directement.
- **La conversion réelle du fichier Excel dans un tableur n'a pas été observée à l'œil.** Le §3.3
  est une preuve par calcul (reconversion du nombre de série Excel), pas une capture d'écran
  d'Excel ou LibreOffice ouvrant le fichier — cette reconversion suit la spécification du format
  (série = jours depuis 1899-12-30) et n'a aucune raison de différer d'un tableur réel, mais aucun
  tableur n'a été lancé pour le confirmer visuellement.
- **La pagination au-delà de 3 pages n'a pas été observée**, comme dans `docs/24` : le seul document
  naturellement multi-page du jeu de données est le registre AFSCA de juillet (3 pages). Le point de
  §5 sur la mention légale unique n'a donc pas été vérifié au-delà de 3 pages, seulement déduit du
  code (la mention est un paragraphe de corps, placé après toutes les sections, donc mécaniquement
  sur la dernière page quel que soit leur nombre).
- **L'affichette allergènes à plus de 4 produits, et son absence de pied de page sur plusieurs
  pages**, n'a pas été testée : le jeu de démonstration en compte 4, qui tiennent sur une page.
- **Le seuil exact de longueur qui ferait à nouveau perdre des colonnes** n'a pas été remesuré après
  le correctif `table-layout: fixed` — seulement vérifié que le cas précis documenté en `docs/24`
  (7 colonnes, 3 de texte libre) ne casse plus avec les données réelles de cette instance. Un texte
  extrême n'a pas été réinjecté pour chercher une nouvelle limite.
- **L'impression noir et blanc réelle** n'a pas été testée sur un pilote d'imprimante physique.
- **Les documents des menus, factures, et tout écran hors `apps/api/src/documents/`** ne sont pas
  couverts : seuls les 12 documents dérivés par la commande du §1 génèrent un PDF ou un Excel dans
  ce dépôt à cette date ; aucun autre mécanisme n'a été trouvé.
- **Trois agents au moins travaillaient en parallèle** sur d'autres fichiers du dépôt pendant cet
  audit (dont `packages/db/src/depots/referentiel-ecriture.ts`, observé en redémarrant le serveur de
  dev à deux reprises). Rien dans les constats ci-dessus ne touche ces zones, et la seconde instance
  serveur (sans `watch`) a servi tous les documents cités sans interruption ni erreur — mais si l'un
  de ces constats semble contredit par une relecture ultérieure du code, vérifier d'abord qu'aucune
  correction n'a été apportée entre-temps par un autre agent (voir §2 : c'est précisément ce qui
  s'est produit ici pour trois défauts de `docs/24`).
