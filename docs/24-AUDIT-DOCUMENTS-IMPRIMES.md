# 24 — Audit des documents imprimés

> Audit réalisé sur une instance entièrement isolée : API sur `127.0.0.1:4781`, base neuve dans le
> dossier temporaire de session, `migrer` + `seed` + `seed:demo`. Aucune requête vers
> `127.0.0.1:3001` (serveur du porteur, non redémarré). Process API arrêté par son PID exact
> (19308, celui qui écoutait réellement sur le port 4781, vérifié par `Get-NetTCPConnection`).
> Aucun appel à l'API Anthropic. Les fichiers produits (PDF, XLSX, scripts de vérification) sont
> dans `audit-docs/` du dossier temporaire de session ; ils ne survivront pas à la session, d'où une
> description écrite complète de chaque constat plutôt qu'un simple renvoi au fichier.
>
> Chaque document a été lu directement (rendu PDF page par page, texte et image) via l'outil de
> lecture — pas seulement généré. Deux mécanismes ont en plus été vérifiés en isolation avec des
> répliques exactes du CSS et de l'appel Playwright réels (jamais de modification du code
> applicatif) : la présence d'un pied de page, et le débordement horizontal d'un tableau.

---

## 1. Combien de documents, combien produits

**12 documents distincts** recensés depuis `apps/api/src/documents/` (deux fichiers de gabarits
HTML — `gabarits.ts`, `registre-afsca.ts` — et un fichier d'export `excel.ts`, tous relus en entier)
et les routes qui les servent (`routes/documents.ts`, `routes/commandes.ts`, `routes/previsions.ts`,
`routes/economies.ts` — seuls fichiers du dépôt à appeler `rendrePdf`, `archiverExportExcel` ou
`ExcelJS`, vérifié par recherche exhaustive sur `apps/api/src` et `packages/`). Aucun autre
mécanisme de génération de document n'existe ailleurs dans le dépôt.

**Les 12 ont été produits, aucun n'a échoué.**

| #   | Document                    | Format | Route                                  | Produit |
| --- | --------------------------- | ------ | -------------------------------------- | ------- |
| 1   | Fiche technique             | PDF    | `GET /documents/fiche-technique/:id`   | Oui     |
| 2   | Affichette allergènes       | PDF    | `GET /documents/affichette-allergenes` | Oui     |
| 3   | Étiquette de bac            | PDF    | `GET /documents/etiquette-bac/:id`     | Oui     |
| 4   | Rapport de session          | PDF    | `GET /documents/rapport-session/:id`   | Oui     |
| 5   | Registre AFSCA mensuel      | PDF    | `GET /documents/registre-afsca`        | Oui     |
| 6   | Brief avant-marché          | PDF    | `GET /prevision/brief`                 | Oui     |
| 7   | Bon de commande             | PDF    | `GET /commandes/:id/pdf`               | Oui     |
| 8   | État de stock valorisé      | Excel  | `GET /exports/stock`                   | Oui     |
| 9   | Journal des recettes        | Excel  | `GET /exports/journal-recettes`        | Oui     |
| 10  | Journal des achats          | Excel  | `GET /exports/journal-achats`          | Oui     |
| 11  | Journal des mouvements      | Excel  | `GET /exports/mouvements`              | Oui     |
| 12  | Suivi des économies d'achat | Excel  | `GET /exports/economies`               | Oui     |

Pour produire des documents réellement remplis (la consigne « un document vide ne se juge pas »),
des données ont été saisies via l'API elle-même (jamais en SQL direct) : 3 relevés de température
(dont un dépassement avec action corrective), 2 exécutions de nettoyage, changements de statut sur
3 lots (quarantaine, levée de quarantaine, blocage suite à rappel fournisseur), 3 non-conformités
rattachées à ces lots, un exercice de traçabilité, une commande fournisseur générée, et le drapeau
`allergenesVerifies` posé sur les 10 ingrédients du jeu de démonstration pour voir les documents
dans leur état « vérifié » (le jeu de démonstration seul ne l'active jamais, donc sans cette étape
les trois documents allergènes n'auraient montré que l'avertissement « non encore vérifiés »,
jamais le libellé réel).

**Rien n'a été impossible à produire.** Tout ce qui suit a donc été vu, pas déduit.

---

## 2. Ce qui rend un document inutilisable, par gravité décroissante

### 2.1 CRITIQUE — un tableau à plusieurs colonnes de texte libre s'effondre et des colonnes entières disparaissent de la page

**Constaté sur un document réellement produit et lu** : le registre AFSCA de juillet 2026, section
« Non-conformités » (7 colonnes : Constat, Type, Description, Gravité, Lot concerné, Action
corrective, Résolution).

Avant tout ajout : les 6 non-conformités du jeu de test s'imprimaient correctement, les 7 colonnes
visibles sur chaque ligne, aucune coupure.

**Une seule non-conformité supplémentaire, avec un champ `type` de 85 caractères sans espace et une
`description` de 140 caractères sans espace** (texte réaliste : un libellé technique ou une
référence fournisseur collée sans espace, ce qui arrive), régénère le même registre et casse la
section entière :

- L'en-tête de tableau ne montre plus que **CONSTAT | TYPE | DESCRIPTION** — les colonnes
  **GRAVITÉ, LOT CONCERNÉ, ACTION CORRECTIVE et RÉSOLUTION ont entièrement disparu de la page**,
  pour **toutes** les lignes, y compris les 5 lignes qui n'ont rien de long.
- La colonne DESCRIPTION elle-même est **tronquée en plein mot**, sur presque toutes les lignes :
  « verification demande » (il manque « e. »), « ... au » (il manque « -delà du seuil de 7 °C. »),
  « conservatio » (il manque le « n » final), « passé de « disponible » à « quara » (il manque
  « ntaine » le 2026-07-31. »).

Fichier produit et lu : `05b-registre-afsca-stress.pdf` (comparé à `05-registre-afsca.pdf`, produit
juste avant, sans le champ long — identique par ailleurs).

**Cause racine, vérifiée dans le code** : `apps/api/src/documents/style-impression.ts:114-118`
définit la règle `<table>` **unique et partagée par les 12 documents** —

```css
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9.5pt;
}
```

— sans `table-layout: fixed` ni `<colgroup>`. `docs/07-DOCTRINE-ERP-ET-DESIGN.md` §4.5 impose
pourtant explicitement `table-layout: fixed` + `<colgroup>` pour les tableaux à l'écran, avec la
justification qu'un `auto` laisse la largeur des colonnes bouger. **Cette règle n'est appliquée nulle
part côté impression.** En layout `auto`, une seule cellule au contenu insécable (`white-space` par
défaut, aucune limite de longueur en saisie sur `type`, `description` ou `action_corrective` du
formulaire de non-conformité) force la largeur de sa colonne, donc de la table entière, au-delà de
la largeur imprimable (180 mm de contenu sous A4 avec les marges de 15 mm) — et Chromium, en
impression, ne fait pas défiler horizontalement : il **coupe** au bord de la page.

**Vérifié par un second essai indépendant**, sur la fiche technique (3 colonnes : Ingrédient,
Quantité, Coût), en renommant temporairement un ingrédient avec un nom de 97 caractères sans
espace : la table ne casse **pas** dans ce cas (fichier `01c-fiche-technique-stress.pdf`) — les
colonnes Quantité et Coût restent lisibles. **La différence n'est pas une protection du code : elle
tient au nombre de colonnes de texte libre dans la même table.** Une table à une seule colonne de
texte libre encaisse un contenu long en se comprimant elle-même (il reste assez de place) ; une
table à **plusieurs** colonnes de texte libre pouvant chacune recevoir du texte long — exactement le
cas de « Non-conformités » (Type, Description, Action corrective) — additionne les largeurs requises
et dépasse la page dès qu'une seule de ces colonnes reçoit un texte un peu long. **C'est la table la
plus à risque de tout le produit**, et c'est celle destinée à un contrôle AFSCA.

Un troisième essai (isolé, sans toucher au code, réplique exacte du CSS partagé) sur le tableau
« Ventes » du rapport de session (4 colonnes, dont une seule de texte libre) confirme la même
nuance : un nom de produit de 79 puis 133 caractères sans espace ne fait pas disparaître les
montants — la marge est simplement plus large avec une seule colonne de texte libre. Le risque n'est
donc pas théorique mais **concentré sur les tableaux à colonnes de texte libre multiples**, au
premier rang desquels « Non-conformités » du registre AFSCA.

**Conséquence pour l'usage réel** : `type`, `description` et `action_corrective` sont des champs de
formulaire libres, sans limite de longueur (`schemaCreationNonConformite`,
`packages/core/src/contrats/afsca.ts:174-182` : `z.string().min(1, ...)`, aucun `.max()`). Rien
n'empêche un futur relevé plus détaillé de reproduire l'incident, et rien dans les tests du dépôt ne
peut le voir — un test qui vérifie le HTML produit ne voit pas où Chromium coupe une page A4.

### 2.2 GRAVE — aucun document ne porte de pied de page ni de numérotation, alors que le code croit en produire un

Sur les 7 documents PDF, **5 sont censés porter un pied de page** (fiche technique, rapport de
session, registre AFSCA, bon de commande, brief avant-marché — les 2 restants, affichette et
étiquette, sont volontairement sans pied, `apps/api/src/documents/rendu.ts:74` : « Omis pour les
étiquettes et affichettes »). **Aucun des 5 n'en affiche réellement un**, sur aucune page, y compris
la première.

Constaté en lisant `05-registre-afsca.pdf` (3 pages) : aucune des 3 pages ne porte de mention
« Registre AFSCA — Juillet 2026 » ni de numéro de page, alors que le gabarit
(`apps/api/src/documents/registre-afsca.ts:244-249`) construit explicitement ce pied de page.
Vérifié aussi sur `01-fiche-technique.pdf`, `04-rapport-session.pdf`, `06-brief-avant-marche.pdf`,
`07-bon-commande.pdf` : même absence.

**Cause racine, vérifiée dans le code, précise** : chaque gabarit calcule bien un pied de page
(`pied(...)`) et le passe à `documentHtml(titre, corps, { pied: ... })` — mais
`documentHtml` (`apps/api/src/documents/rendu.ts:79-89`) **n'utilise jamais** `options.pied` : sa
seule utilisation de `options` porte sur `options.styleAdditionnel` (ligne 85). La valeur calculée
est donc perdue à cet endroit précis.

Le **seul** mécanisme qui compte réellement pour Playwright est un champ totalement **différent** :
`DemandeRendu.options` (`rendu.ts:112`), lu uniquement dans `rendrePdf` (`rendu.ts:254-257`) :

```ts
displayHeaderFooter: demande.options?.pied !== undefined,
footerTemplate: demande.options?.pied ?? '<span></span>',
```

Or **aucun des 6 sites d'appel** à `rendrePdf(base, { ... })` ne renseigne jamais ce champ
`options` — vérifié par recherche exhaustive : `apps/api/src/routes/documents.ts:117, 148, 185, 220,
251`, `apps/api/src/routes/commandes.ts:88`, `apps/api/src/routes/previsions.ts:1941`. Le pied de
page conçu dans chaque gabarit n'atteint donc **jamais** l'appel réel à `page.pdf()`.

**Vérifié que ce n'est pas une limite de Playwright** : une réplique isolée strictement identique de
l'appel (même police, même taille 7pt, même couleur `#71717a`, même structure `footerTemplate`)
produit un pied de page parfaitement lisible sur chaque page (`test-footer-exact.pdf`, 2 pages,
« Registre AFSCA — Juillet 2026 · page 1/2 » puis « · page 2/2 » bien visibles). Le mécanisme
fonctionne ; il est simplement **débranché** entre le gabarit et l'appel à `rendrePdf`.

**Conséquence** : une page détachée du registre AFSCA — le cas nommément visé par la consigne — ne
porte aujourd'hui **aucune** mention de document, de période ni de numéro de page. Le même défaut
touche le rapport de session, la fiche technique, le bon de commande et le brief, documents qui ont
tous un pied de page prévu dans leur gabarit mais jamais rendu.

### 2.3 MODÉRÉ — un lot rattaché à une non-conformité n'affiche ni son fournisseur ni sa DLC quand un numéro de lot existe

Vérifié sur `05-registre-afsca.pdf` : la non-conformité « Rappel fournisseur » sur le lot de farine
affiche `Farine de froment T55 — DÉMO-FARINE-01 / Statut : Bloqué — Dernier changement de statut :
Bloqué suite à un rappel fournisseur (le 31/07/2026 10:19)`. **Le nom du fournisseur n'apparaît
jamais**, alors que le mouvement d'entrée réel de ce lot (vérifié via `/api/exports/mouvements` et
`/api/exports/journal-achats`) montre qu'il vient de « [démo] Fournisseur générique » — précisément
l'information qu'un « rappel fournisseur » doit permettre de retrouver sans ressaisie.

**La DLC est logée dans les données mais jamais affichée dès qu'un numéro de lot existe.** Le type
`DonneesRegistreAfscaLotConcerne` (`apps/api/src/documents/registre-afsca.ts:136-138`) porte bien
`numeroLotFournisseur` et `dateDlc`, mais `libelleLotConcerne`
(`apps/api/src/documents/registre-afsca.ts:437-445`) les combine en `OU`, jamais en `ET` :

```ts
const identifiant =
  lot.numeroLotFournisseur ?? (lot.dateDlc === null ? null : `DLC ${formaterDate(lot.dateDlc)}`);
```

Vérifié sur les données réelles : le lot de beurre a une DLC connue (`2026-09-05`, visible via
`/api/stock/.../lots`) et un numéro (`DÉMO-BEURRE-01`) — le registre n'affiche que le numéro, jamais
la DLC. Même chose pour le lot d'œufs (DLC `2026-08-12`).

Il existe une justification écrite dans le code (`registre-afsca.ts:130-134`, référence à la
directive 2011/91/UE) : « identifiable par numéro OU DLC au jour près, jamais les deux à zéro ». Ce
n'est pas un bug au sens strict — c'est un choix documenté. Mais la consigne de cet audit demande
explicitement les quatre informations ensemble (« fournisseur, numéro, DLC, statut ») parce que
c'est ce qui borne la portée d'un rappel, et **le fournisseur, lui, n'a même pas de mécanisme de
repli** : `resoudreLotsConcernes` (`apps/api/src/documents/donnees.ts:573-610`) ne joint jamais
`schema.fournisseur`, alors que la jointure existe déjà et fonctionne dans un autre gabarit du même
fichier (`donnees.ts:789-800`, export du journal des achats). Un lecteur du registre imprimé doit
aujourd'hui retourner à l'écran Stock pour savoir chez qui rappeler un lot.

### 2.4 Ce qui n'est PAS un défaut, vérifié pour ne pas le confondre avec un vrai

- **Le statut de lot s'imprime bien**, coloré, avec le motif et sa date — vérifié explicitement sur
  les 3 lots testés (quarantaine, levée de quarantaine, blocage). C'est le point que la consigne
  demandait de vérifier en priorité : il fonctionne.
- La coupure d'une **rangée** de tableau à cheval sur un saut de page ne se produit pas :
  `style-impression.ts:138` (`tr { break-inside: avoid; }`) fonctionne, vérifié sur le registre AFSCA
  — la table « Tâches de nettoyage en retard » (8 lignes) se coupe proprement entre les pages 1 et 2,
  avec l'en-tête de colonnes **répété** sur la page 2 (`thead { display: table-header-group; }`,
  `style-impression.ts:119-122`, fonctionne aussi). C'est un mécanisme différent du pied de page
  (§2.2) — celui-ci marche, l'autre non.
- Les « 0 g disponible » qui apparaissent pour le beurre et la farine dans le brief avant-marché et
  l'export de stock, après avoir mis leurs lots uniques en quarantaine/blocage, ne sont **pas** un
  bug : c'est la conséquence correcte et cohérente, sur plusieurs écrans différents, du principe
  « la FEFO ne sert que les lots disponibles » (`docs/07` §1.9, `docs/02`). Une bonne surprise de cet
  audit : le statut d'un lot se propage correctement à la planification de production, pas seulement
  au registre.

---

## 3. Les deux points réglementaires demandés

### 3.1 Libellés d'allergènes — vérifié correct partout

Recherche exhaustive de tout usage de `.allergenes` dans `gabarits.ts`, `registre-afsca.ts` et
`donnees.ts` : **toutes** les sorties passent par `libelleAllergene()`
(`packages/core/src/contrats/referentiel.ts:548-550`), jamais le code brut. Vérifié visuellement sur
3 documents produits avec des ingrédients marqués vérifiés :

- Fiche technique R1 : « Céréales contenant du gluten · Lait (y compris lactose) · Œufs ».
- Affichette allergènes : mêmes libellés, en capitales, pour les 2 produits transformés ; « Aucun
  allergène déclaré » pour le produit revendu.
- Étiquette de bac : même liste.

Aucune occurrence de `gluten`, `lait` ou `oeufs` bruts trouvée sur un document lu. Le défaut déjà
corrigé une fois sur l'affichette (mentionné dans la consigne) n'est pas revenu, ni ailleurs.

### 3.2 Identification complète d'un lot — statut confirmé imprimé, fournisseur et DLC pas toujours

Voir §2.4 (statut, confirmé) et §2.3 (fournisseur absent, DLC absente dès qu'un numéro existe). Pour
résumer sur les 3 champs demandés en plus du statut :

| Champ         | Toujours imprimé quand connu ?               | Preuve                                                                        |
| ------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| Numéro de lot | Oui                                          | `DÉMO-BEURRE-01`, `DÉMO-FARINE-01`, `DÉMO-OEUFS-01` visibles sur chaque ligne |
| Statut        | Oui, coloré, avec motif et date              | §2.4                                                                          |
| DLC           | **Non** — seulement si aucun numéro n'existe | §2.3                                                                          |
| Fournisseur   | **Non — jamais**, aucun mécanisme de repli   | §2.3                                                                          |

---

## 4. Ce qui est bien fait et ne doit pas casser

- **Alignement des nombres.** Vérifié sur les 7 PDF et les 5 Excel : les montants et quantités sont
  systématiquement alignés à droite (`class="num"`, `tabular-nums`), le texte et les identifiants
  (dates, numéros de lot) à gauche. Aucune exception trouvée.
- **Zéro affiché comme valeur, absence affichée comme `—`.** Vérifié : « Écart de caisse : 0,00 »
  s'affiche en gras comme un vrai résultat sur le rapport de session ; un coût matière inconnu sur la
  fiche technique affiche `—`, jamais un `0,00` fabriqué.
- **Aucune information portée par la seule couleur.** Recherche exhaustive de `background`/`color`
  dans les 3 fichiers de gabarits : aucun aplat de fond n'est utilisé pour signaler un état: chaque
  alerte colorée (`.statut-alerte`, `.statut-depassement`) est **toujours** accompagnée d'un mot
  (« Dépassement », « Bloqué », « En quarantaine ») ou d'un glyphe (`▲` sur le brief avant-marché,
  devant la contrainte limitante). C'est exactement la règle de `docs/07` §4.5 pour le noir et blanc,
  et elle est respectée.
- **Mention de franchise de TVA** présente sur les documents commerciaux (fiche technique, rapport de
  session, bon de commande, journal des recettes et des achats Excel) et absente des documents
  internes (registre AFSCA, brief, étiquette, export de stock et de mouvements) — vérifié
  conforme à `apps/api/src/documents/style-impression.ts:33-34` et à sa règle d'usage documentée.
- **Excel : pas de perte de donnée en cas de texte long.** Contrairement au PDF, une colonne Excel
  trop étroite pour son contenu ne perd rien : la valeur reste entièrement présente dans la cellule
  et reste lisible en élargissant la colonne ou en cliquant dessus. Le défaut de §2.1 est **propre au
  rendu PDF/impression**, pas aux exports Excel.
- **Répétition de l'en-tête de colonnes sur les pages suivantes** d'un tableau qui déborde (mécanisme
  CSS natif du navigateur, `display: table-header-group`), et **aucune rangée coupée en deux** à la
  césure — vérifiés tous les deux sur le registre AFSCA à 3 pages.
- **Cohérence inter-écrans du statut de lot** : un lot bloqué ou mis en quarantaine sort réellement du
  stock disponible affiché à la fois par `/api/stock`, l'export Excel de stock et le brief
  avant-marché — pas seulement du registre AFSCA.

---

## 5. Ce qui n'a pas pu être vérifié, et pourquoi

- **La pagination réelle au-delà de 3 pages** n'a pas été observée : le seul document naturellement
  multi-page dans ce jeu de données est le registre AFSCA (3 pages en configuration normale, 2 en
  configuration de test). Un registre sur une année complète, avec plusieurs mois de relevés, n'a pas
  été produit — le volume de données de démonstration ne le permettait pas sans fabriquer des mois
  de relevés artificiels, ce qui aurait dépassé le rôle d'un audit.
- **L'impression noir et blanc réelle** n'a pas été testée sur un vrai pilote d'imprimante : la
  vérification faite ici est une lecture du code (aucun aplat de couleur, uniquement du texte
  coloré) et une lecture visuelle des couleurs utilisées, pas un test d'impression physique en niveaux
  de gris.
- **L'affichette allergènes à plus de 3 produits** n'a pas été testée : le jeu de démonstration n'en
  compte que 3, qui tiennent sur une seule page. Le code ne lui donne aucun pied de page ni numérotation
  (choix volontaire, `rendu.ts:74`) ; si elle venait à s'étendre sur 2 pages avec davantage de
  produits actifs, rien ne permettrait d'identifier une page 2 — mais ce cas n'a pas été observé
  concrètement, seulement déduit du code.
- **Le seuil exact de longueur de texte** qui déclenche le débordement de tableau (§2.1) n'a pas été
  mesuré précisément colonne par colonne — seulement démontré qu'il existe et qu'il dépend du nombre
  de colonnes de texte libre dans la même table, pas d'une seule valeur.
- **Le format des heures sur l'étiquette de bac** (« Produit le 25/07/2026 02:00 ») a semblé
  étrange à la lecture, mais la fonction de formatage (`packages/core/src/horodatage.ts:42-52`) utilise
  bien le fuseau `Europe/Brussels` : l'heure inhabituelle vient très probablement d'un horodatage
  arbitraire du jeu de données de démonstration (minuit UTC), pas d'un défaut de conversion. Non
  retenu comme défaut faute d'avoir pu vérifier la donnée source du jeu de démonstration en detail.
- **Trois autres agents travaillaient en parallèle** sur `apps/web/src/pages/**` et
  `docs/06-UI-ET-PARCOURS.md` pendant cet audit ; rien de ce qui précède ne touche à ces zones, et
  aucun de mes rendus n'a échoué de façon qui suggérait une collision avec leur travail.
