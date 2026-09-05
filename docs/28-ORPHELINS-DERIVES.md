# 28 — Orphelins dérivés : le motif de D-087, cherché systématiquement

> **Date.** 01/08/2026. **Nature.** Mission de mesure pure — aucune correction appliquée.
> **Point de départ.** `docs/05-DECISIONS.md` D-087 et sa section « Le motif, généralisé » :
> du code complet, testé, qu'aucun écran n'appelle — invisible au typecheck, aux tests, au
> lint, puisque rien n'essaie. Trouvé cinq fois par accident en une semaine. Cette mission
> reprend la recherche par dérivation plutôt que par hasard, sur les angles que l'inventaire
> du 31/07 avait explicitement laissés de côté, plus quelques angles ajoutés.

## 0. Les quatre nombres

**12 orphelins retenus** après élimination des faux positifs, répartis :

| Capacité manquante | Mort-né | Réserve délibérée | Total  |
| ------------------ | ------- | ----------------- | ------ |
| **8**              | **3**   | **1**             | **12** |

Un treizième candidat (l'usage IA « extraction » promis par `CLAUDE.md` §5) est décrit en §5
mais **n'est volontairement pas compté** : ce n'est pas un orphelin (aval testé sans amont), c'est
l'inverse — aucun aval n'existe du tout. Compter les deux dans la même case aurait fait la même
erreur de mesure que celle que cette mission cherche à corriger.

**Le fait le plus important de ce document n'est pas dans ce tableau : trois des quatre cas cités
par D-087 elle-même sont déjà résolus**, l'un d'eux aujourd'hui même — voir §1.

---

## 1. D-087 revérifiée avant toute nouvelle recherche

Consigne explicite de la mission : ne reprendre aucun verdict sans le revérifier dans le code
courant. Les quatre lignes de la table « Le motif, généralisé » de D-087 :

| #   | Aval complet, testé                                  | Amont annoncé manquant par D-087 | État vérifié aujourd'hui                                                                                                                                                   |
| --- | ---------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `POST /productions/:id/annuler`                      | aucun écran ne l'appelait        | **RÉSOLU** — `apps/web/src/pages/Production.tsx:1258`, fonction `annulerLaProduction`, bouton réel, motif obligatoire, relecture du détail après écriture                  |
| 2   | `POST /receptions/:id/annuler`                       | aucun écran ne l'appelait        | **RÉSOLU** — `apps/web/src/saisie-stock/DetailLot.tsx:569` (`annulerLaReception`) et `apps/web/src/saisie-stock/SaisieReception.tsx:842`, deux points d'entrée réels       |
| 3   | `GET /prevision/brief`, `POST /ia/analyse-ecart/:id` | aucun écran ne les appelait      | **RÉSOLU** — `apps/web/src/pages/ProchaineSession.tsx:577` (`<BoutonDocument chemin="/prevision/brief">`) et `apps/web/src/pages/Sessions.tsx:1480` (`AnalyseEcartClaude`) |
| 4   | deux gardes lisant `periode.statut = 'verrouillee'`  | rien ne pose jamais ce statut    | **TOUJOURS VRAI** — voir §2, capacité manquante n°2                                                                                                                        |

Trois instances sur quatre ont donc été câblées entre le 31/07 et aujourd'hui — vraisemblablement
par les agents parallèles que la mission signale. La quatrième reste ouverte, revérifiée
indépendamment ci-dessous. **Ceci confirme, dans les deux sens à la fois, l'avertissement de la
mission : un document peut vieillir en devenant faux par optimisme (un « ouvert » qui est fermé)
autant que par oubli (un « fermé » qui ne l'est pas).**

Un chemin de câblage n'est cependant pas allé jusqu'au bout : le commentaire de
`apps/api/src/routes/previsions.ts:2022-2042` et le test
`apps/api/src/routes/previsions.test.ts:879-961` (daté du 01/08/2026, littéralement aujourd'hui)
montrent que quelqu'un a câblé la ROUTE `POST /prevision/brief/commenter` en invoquant
`briefAvantMarche` — mais **aucun écran n'appelle cette route**. C'est une cinquième instance du
même motif, un cran plus loin : le premier correctif (service → route) est allé jusqu'au bout,
le second (route → écran) s'est arrêté juste avant le bouton. Voir capacité manquante n°1 en §2.

---

## 2. Capacités manquantes — triées par ce que le porteur ne peut pas faire

### 1. Commenter le brief du samedi soir — `POST /prevision/brief/commenter`

**Le geste réel bloqué** : le porteur télécharge son brief avant-marché (PDF déterministe, ça
fonctionne), mais ne peut jamais demander à Claude de le commenter — alors que CLAUDE.md §5 nomme
explicitement ce troisième usage Sonnet, et que le code l'implémente en entier.

**Aval.** `apps/api/src/routes/previsions.ts:2043` — route complète, appelle `demanderCommentaire`
et `demandeCommentaireBrief`, retourne `schemaCommentaireIa`. Testée en profondeur
(`previsions.test.ts:879-961`, 3 scénarios dont le refus propre sans clé API et la non-confusion
avec `/prevision/commenter`, la route sœur). **Amont.** Recherche exhaustive dans
`apps/web/src` (`grep -rn "brief/commenter"`) : zéro résultat hors ce fichier de test.

C'est la découverte la plus significative de cette mission : le motif de D-087 vient de se
reproduire **aujourd'hui**, un niveau plus bas que la première fois — pas « aucune route »,
mais « route posée, bouton absent ».

### 2. Verrouiller définitivement une période comptable — `periode.statut = 'verrouillee'`

**Le geste bloqué** : au sens strict, aucun — c'est l'ABSENCE d'un geste qui est le défaut.
Rien ne permet de rendre un exercice transmis au comptable définitivement infalsifiable ; seule
la clôture existe (`statut = 'cloturee'`), réversible par `rouvrirPeriode`.

**Aval.** Schéma (`packages/db/src/schema.ts:1895`), contrat Zod
(`packages/core/src/contrats/comptabilite.ts:207`), et **deux gardes de production** qui lisent
cette valeur : `verifierPeriodeNonVerrouillee` (`packages/db/src/depots/comptabilite.ts:837`) et
`rouvrirPeriode` (`:970`). **Amont.** `cloturerPeriode` (`comptabilite.ts:853-902`) n'écrit jamais
que `'cloturee'` — vérifié ligne à ligne, aucune branche ne produit `'verrouillee'`. Les 74 routes
de `apps/api/src/routes/comptabilite.ts` ne comportent aucun `verrouiller`. Seul un assistant de
test **dupliqué dans six fichiers** (`verrouillerPeriode`, jamais exporté, jamais partagé) simule
cet état par insertion directe. Confirmé identique à D-087 : **toujours vrai aujourd'hui**.

### 3. Imprimer la fiche technique d'une recette — `GET /documents/fiche-technique/:id`

**Le geste bloqué** : `CLAUDE.md` §1 nomme « Recettes & fiches techniques » comme le premier des
cinq domaines fonctionnels du produit. Le document lui-même — proportions, rendement, allergènes —
est généré, archivé, hashé comme les autres ; il n'a simplement **aucun bouton, nulle part**.

**Aval.** `apps/api/src/routes/documents.ts:112-128`, gabarit `ficheTechnique()`, testé dans 5
fichiers (`rendu.test.ts`, `audit-documents.test.ts`, `allergenes-verifies.test.ts`,
`audit-robustesse.test.ts`, `smoke-routes-lecture.test.ts`). **Amont.**
`grep -n "BoutonDocument\|chemin=" apps/web/src/pages/Recettes.tsx` → aucune occurrence. Comparé
aux 11 autres documents `chemin=` recensés (registre AFSCA, affichette allergènes, rapport de
session, étiquette bac, bon de commande, 4 exports Excel, brief), c'est le seul document du
Lot 6 dont l'écran source (`Recettes.tsx`) n'offre tout simplement pas le bouton.

### 4. Repérer les sessions sans relevé de température avant un contrôle — `GET /afsca/temperatures/sessions-sans-releve`

**Le geste bloqué** : relire, sur une période choisie (l'année, avant un contrôle AFSCA), la
liste des sessions dont ni l'arrivée ni le retour n'ont de relevé — un vrai balayage de
conformité, pas un rappel ponctuel.

**Aval.** `apps/api/src/routes/afsca.ts:102-113`, appelle `sessionsSansReleveTemperature`
(`packages/db/src/services/afsca.ts`), testée dans 5 fichiers. **Amont.**
`grep -rn "sessions-sans-releve\|sansReleve\|SansReleve" apps/web/src` : une seule occurrence,
un **commentaire** de `Sessions.tsx:328` qui explique que le bandeau « clôture sans aucun relevé »
de CETTE session (au moment de la clôturer) suit délibérément le même seuil que cette fonction —
sans jamais l'appeler pour autre chose que la session en cours. Le geste rétrospectif
(« quelles sessions ce mois-ci ? ») n'existe nulle part, alors que `RegistreAfsca.tsx` est
précisément l'écran conçu pour ce type de vérification (non-conformités, nettoyage, exercices de
traçabilité y vivent déjà).

### 5. Voir combien de propositions d'événements IA attendent une décision — `GET /evenements-decouverte/propositions/nombre-en-attente`

**Confiance plus faible que les précédents** — à vérifier avant d'agir.

**Aval.** `apps/api/src/routes/evenements-decouverte.ts:556-558`, appelle
`nombrePropositionsEnAttente`, testée (`evenements-decouverte.test.ts`,
`packages/db/src/depots/evenements-decouverte.test.ts`). **Amont.**
`PropositionsEvenements.tsx:213` calcule son propre compteur localement
(`resultat.propositions.length`, dérivé de la recherche en cours) — il ne s'agit donc pas d'un
doublon inutile mais d'un compteur **persistant** (toujours vrai, même sans avoir relancé de
recherche) qui n'alimente aucun badge. Aucune mention dans `Navigation.tsx` ni
`TableauDeBord.tsx`, alors que ce dernier a déjà un encart « à revisiter » pour les concurrents
(`packages/db/src/depots/concurrents.ts`, doctrine ERP : signaler ce qui attend). Plausible que
cette route ait été construite en prévision d'un tel badge, jamais posé.

### 6. Lire l'état des séries de numérotation depuis un écran — `lireSeries`

**Confiance faible, enjeu mineur.** Le commentaire de la fonction dit lui-même sa destination :
« pour l'écran d'administration » (`packages/db/src/depots/numerotation.ts:91`). Aucun écran de ce
nom n'existe dans `apps/web/src/pages`. Ce n'est pas gênant en pratique — les numéros de document
(`RC-2026-0007`, etc.) restent lisibles partout où ils apparaissent — mais le commentaire promet un
écran qui n'a jamais été construit. À traiter comme les deux items précédents : soit construire la
vue (probablement un simple tableau dans un futur écran de paramétrage), soit corriger le
commentaire pour ne plus promettre ce qui n'existe pas.

### 7 et 8. Deux fonctions dont l'appelant réel réimplémente la même formule à la main

Ce ne sont ni des capacités manquantes classiques (rien n'empêche le geste), ni des morts-nés
(la logique EST utilisée — dupliquée, pas absente) : une quatrième forme, comme D-088 en avait
déjà nommé une pour les champs. Le geste que le porteur ne peut pas faire est indirect : **il ne
peut pas faire confiance à ce que ces deux écrans afficheraient si la règle de calcul changeait
un jour**, parce que le point de calcul n'est plus unique (règle d'architecture n°1).

- **`ecartPrix`** (`packages/core/src/factures.ts:80`, testée dans `factures.test.ts`) — zéro
  appelant de production. `packages/db/src/services/factures.ts:554` ET `:812` réécrivent
  chacun, à la main, exactement `montantCents - prixLigneCents` — la soustraction que `ecartPrix`
  encapsule et nomme. Déjà signalé par `docs/26-AUDIT-DIX-REGLES.md` (règle 1, item 6),
  revérifié aujourd'hui : toujours vrai, aux deux lignes citées.
- **`totaliserJournal`** (`packages/core/src/comptabilite.ts:223`, testée 3×) — zéro appelant de
  production. `apps/api/src/routes/comptabilite.ts` (`GET /depenses`) recalcule à la main, en
  trois `.reduce()` distincts, exactement `montantTotalCents`, `montantDeductibleCents` (via
  `montantDeductibleCharge`, la même fonction que `totaliserJournal` appelle en interne) et
  `montantImmobiliseCents` — sans la ventilation par catégorie que `totaliserJournal` fournirait
  gratuitement. Nouveau lien établi par cette mission : `docs/26` avait signalé la duplication
  (règle 1, item 5) sans nommer la fonction de remplacement déjà prête.

**Correctif proposé pour les deux : remplacer la réimplémentation par un appel, pas écrire de code
neuf.** Exactement la leçon de `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §5.4 sur `definitionMotif` :
« aucun appelant ne veut pas dire inutile — il faut d'abord chercher si quelqu'un fait déjà le
travail à sa place, ailleurs et moins bien. »

---

## 3. Morts-nés — retrait proposé

### 1. `sessionMarche.statut = 'en_cours'`

**Jamais écrit, par aucun chemin de production**, et structurellement condamné à ne jamais
l'être. Vérifié dans `packages/db/src/services/sessions.ts` en entier : la création pose
`'planifiee'` (:381), la clôture pose `'cloturee'` (:1450), l'annulation pose `'annulee'` (:1884) —
aucune troisième écriture. Trois gardes de production le lisent pourtant, toujours en
disjonction avec `'planifiee'` : `Sessions.tsx:2679`, `Sessions.tsx:3142`,
`Production.tsx:1082`. Sans écriture possible, ces trois `OR` ont une branche morte.

**L'argument pour le retrait n'est pas seulement l'absence de câblage : c'est que le modèle
d'usage du produit l'interdit structurellement.** `CLAUDE.md` §1 : « Aucun usage sur le stand
pendant le marché : la saisie se fait avant et après. » Faire passer une session à `'en_cours'`
supposerait un geste réalisé PENDANT le marché (« j'arrive, je commence à vendre ») — exactement
l'usage que le produit exclut par construction. Ce n'est donc pas une capacité oubliée : c'est un
état qui n'aurait jamais dû être promis. **Proposition : retirer la valeur de l'enum (schéma,
contrat Zod) et simplifier les trois gardes à une seule comparaison à `'planifiee'`** — ou, si le
porteur veut un jour un geste « arrivée sur site » distinct (auquel cas voir `heureDebutReelle`,
déjà saisissable mais seulement au même formulaire que `heureFinReelle`, jamais séparément),
documenter ce choix avant de le coder.

### 2. `estUnite` (`packages/core/src/unites.ts:20`)

Garde de type, testée par son seul test, zéro appelant de production. Déjà relevé par
`docs/13-AUDIT-CAPACITES-ORPHELINES.md` §5.1 (« garde de type inutilisée »), revérifié aujourd'hui :
toujours vrai. Aucun signe qu'elle serve un besoin à venir (`convertir`, la fonction qui porte
la règle n°4, ne l'appelle pas). **Proposition : retrait**, ou fusion dans le test qui l'utilise
si elle documente une intention utile pour le lecteur.

### 3. `productionsDuLot` (`packages/db/src/depots/productions.ts:209`)

Barrel seul, zéro test, zéro appelant de production — confirmé identique à
`docs/13` §5.2 (30/07/2026). Son propre commentaire dit sa destination : « Alimente l'écran de
traçabilité du Lot 8. » Cet écran existe (`RegistreAfsca.tsx`), et sa traçabilité aval d'un lot
passe bien par une route dédiée — `GET /afsca/tracabilite/lots/:id`
(`apps/api/src/routes/afsca.ts:389-392`) — mais celle-ci appelle **`tracabiliteAvalLot`**
(`packages/db/src/depots/tracabilite.ts:556`), une fonction distincte qui semble couvrir le même
besoin (« quelles productions sont parties de ce lot ») avec davantage de contexte (ingrédient,
fournisseur, statut). **Vraisemblablement une implémentation antérieure supplantée sans être
retirée** — confiance moyenne, je n'ai pas lu `tracabiliteAvalLot` en entier pour confirmer une
équivalence stricte. Proposition : vérifier que `tracabiliteAvalLot` couvre bien tout ce que
`productionsDuLot` offrait, puis retirer cette dernière.

**Non compté, mentionné pour mémoire : les 18 `relations()` Drizzle de `schema.ts:2131-2258`**
(déjà recensées par `docs/13` §5.2, revérifiées aujourd'hui — toujours 18, toujours orphelines
d'usage relationnel). Elles sont passées à `drizzle(sqlite, { schema })` donc validées au
démarrage, jamais dead code au sens strict, mais un balayage de `\.query\.` sur tout le dépôt ne
renvoie que des `requete.query` Fastify — zéro usage de l'API relationnelle de Drizzle. Enjeu
faible (aucun coût de maintenance actif, elles ne divergent pas puisqu'elles ne sont pas
appelées) : je ne les compte pas dans le total et ne recommande pas de les retirer maintenant.

---

## 4. Réserve délibérée — vérifiée, toujours valable

### `releveTemperature.statut = 'annulee'` et son impression au registre

`packages/db/src/schema.ts:1648-1651` porte un commentaire qui existe VRAIMENT (pas une
paraphrase après coup) et pose une vraie question ouverte : « la question reste posée à l'AFSCA.
Si elle refuse qu'un relevé annulé figure au registre IMPRIMÉ, c'est l'impression qui changera,
pas ce modèle — la donnée doit rester. » Vérifié : rien dans le dépôt ne tranche cette question
depuis (aucune mention d'une réponse de l'AFSCA dans `docs/`), et le comportement actuel
(le relevé annulé reste dans le registre imprimé, barré) est cohérent avec la justification
donnée. **La réserve tient toujours** — rien à signaler comme défaut de documentation ici,
contrairement à l'exemple que D-088 avait trouvé ailleurs (un « pas encore » qui décrivait une
chose déjà faite).

---

## 5. Hors périmètre du comptage — décrit, mais pas un orphelin

**L'usage IA « extraction » (CLAUDE.md §5)** — lecture d'un bon de livraison par Haiku, annoncée
« fréquente ». Recherche exhaustive : `journalIa.usage` n'est jamais écrit avec `'extraction'`
en production (seuls `'prevision'`, `'analyse_ecart'`, `'synthese'`, `'evenements'` le sont —
`apps/api/src/ia/usages.ts`, `routes/evenements-decouverte.ts`), et
`reception.source = 'ia_validee'` n'est jamais écrit non plus (déclaré au niveau du type,
`packages/db/src/services/reception.ts:69`, jamais assigné). Contrairement aux huit orphelins
comptés plus haut, **il n'existe aucun aval** : pas de route, pas de service, pas même un stub —
seule la tarification (`familleModele`, `tarifModele`, `packages/core/src/ia.ts`) sait déjà
traiter `'extraction'` comme une famille de coût. Ce n'est donc pas « testé, jamais appelé » :
c'est « jamais construit ». Déjà signalé par `docs/26-AUDIT-DIX-REGLES.md` (fin de document),
revérifié aujourd'hui, toujours vrai. Je ne le compte pas parmi les 12 : le mélanger aux vrais
orphelins aurait fait la même confusion de mesure que cette mission cherche à corriger.

---

## 6. Chaque dérivation, sa commande, ses chiffres

### D1 — Re-vérification des quatre instances de D-087 (§1)

Grep ciblé par fichier web sur chacun des quatre chemins (`/productions/:id/annuler`,
`/receptions/:id/annuler`, `/prevision/brief`, `/ia/analyse-ecart/:id`), suivi d'une lecture du
code appelant pour confirmer un vrai bouton (pas un commentaire).

**Candidats bruts : 4. Faux positifs : 0. Retenus : 1** (`periode.statut`, un cinquième trouvé
en cours de route : `/prevision/brief/commenter`).

### D2 — Valeurs d'énum lues par une garde, confrontées à leurs écrivains, sur les 44 colonnes à énum du schéma

```
grep -n "enum: \[" packages/db/src/schema.ts
```

44 colonnes à énum recensées (liste complète en annexe §7). Pour chacune, recherche des
littéraux de valeur (`'valeur'`) séparant déclaration/contrat (bruit), écriture de production
(`.set({...})`, `.values({...})`), lecture-garde de production (`=== 'valeur'`, `eq(table.col,
'valeur')`), et usage en test seul.

**Candidats bruts : 44 colonnes, ~180 valeurs d'énum individuelles. Vérification approfondie sur
~20 colonnes de type statut/workflow ; les ~24 colonnes purement descriptives (catégories
choisies librement par l'utilisateur) ont reçu un contrôle plus léger (confirmation que la
totalité des valeurs apparaît dans un `Record<Enum, string>` typé ou une liste d'options d'écran,
ce que TypeScript rend auto-vérifiant).**

**Faux positifs écartés, tous instructifs :**

- `sessionMarche.statut = 'en_cours'` confondu, dans un premier passage, avec le motif LOCAL
  `{ statut: 'inactif' | 'en_cours' | 'succes' | 'erreur' }` qui décore des dizaines d'écrans
  (état d'une requête asynchrone en cours). **Un homonyme massif** — dizaines d'occurrences de
  `'en_cours'` sans rapport avec la colonne de `session_marche` (voir §8).
- `echeance.statut = 'en_retard'` : semblait jamais écrit — en réalité calculé À LA LECTURE
  (`depots/comptabilite.ts:614`), jamais stocké, par doctrine assumée (même famille que le CUMP).
  Pas un défaut.
- `ingredient.categorie = 'boisson'` : absent d'un premier grep sur `apps/web/src` à cause d'un
  motif de recherche trop strict (`'boisson'` avec apostrophes, alors que le code écrit
  `boisson: 'Boisson'` sans apostrophe avant le mot-clé) — présent et fonctionnel dans
  `LIBELLE_CATEGORIE_INGREDIENT` (`packages/core/src/affichage.ts:343`), un `Record` typé qui
  aurait fait échouer le typecheck s'il manquait une clé.

**Retenus : 2** (`sessionMarche.statut = 'en_cours'`, nouveau ; `periode.statut = 'verrouillee'`,
confirmé) **+ 2 hors-comptage** (`journalIa.usage = 'extraction'`,
`reception.source = 'ia_validee'`, décrits en §5).

### D3 — Symboles exportés de `packages/core` et `packages/db`, hors tests, hors barrels, confrontés à leurs appelants

Script Node dédié (deux passes) plutôt qu'un grep manuel, pour éviter la confusion nom nu / paire
(fichier, symbole) :

```
node extract_exports.js packages/core/src > core_exports.json   # 553 symboles
node extract_exports.js packages/db/src   > db_exports.json     # 309 symboles
node find_orphans.js core_exports.json core_result.json         # scan de tout apps/+packages/
node find_orphans.js db_exports.json   db_result.json
node true_orphans.js core_result.json   # candidats : 0 appel hors fichier de déclaration
node true_orphans.js db_result.json
```

Le script catégorise chaque occurrence d'un symbole par fichier : déclaration, même fichier
(usage interne), fichier de test, barrel (`index.ts`), ou véritable appelant de production
externe — la distinction que réclame le piège n°3 de la mission (« l'appelant qui est un test »).

**Candidats bruts (zéro appelant de production externe) : 121 (core) + 22 (db) = 143.**

**Faux positifs écartés : 118**, quasi tous d'une seule famille — **111 exports `schema*` de
`packages/core/src/contrats/*.ts`** (Zod), consommés dans leur propre fichier via
`z.infer<typeof schemaX>` : c'est le TYPE dérivé qui circule ailleurs, sous un autre nom, jamais
le symbole `schemaX` littéral. Bruit déjà nommé par `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §5.5
(« z.infer des enveloppes de liste, jamais consommés côté client »). Plus 18 `relations()`
Drizzle (§3), 2 fonctions seed normales (`seedAfsca`, `seedFournisseursSysteme`), et une poignée
de fonctions utilisées seulement à l'intérieur de leur propre fichier (« exportées sans être
dead code », catégorie déjà nommée par `docs/13` §5.1).

**Retenus : 5** (`totaliserJournal`, `ecartPrix`, `estUnite` en core ; `lireSeries`,
`productionsDuLot` en db — les 18 `relations()` et les 2 fonctions seed étant notées mais non
comptées, cf. §3).

### D4 — Table de routage Fastify confrontée aux appels réels de `apps/web/src`

```
node extract_routes.js       # regex sur app.(get|post|patch|put|delete)(...) avec génériques <>
                              # et arguments multi-lignes : 177 routes
node extract_web_calls.js    # regex sur requeteApi<...>(...) : 178 appels littéraux
node compare_routes.js       # normalisation des segments :param avant comparaison
```

**Candidats bruts (aucun appel `requeteApi` normalisé correspondant) : 32.**

**Faux positifs écartés : 28**, répartis en trois pièges bien distincts, chacun instructif :

1. **11 routes de documents** (`/exports/*`, `/documents/*`, `/commandes/:id/pdf`,
   `/prevision/brief`) invoquées via la prop `chemin=` de `<BoutonDocument>`, jamais via
   `requeteApi(...)` littéral — invisibles à un grep qui ne cherche que ce second nom.
2. **~15 routes invoquées via une variable** (`const chemin = selectionId === null ? '/x' :
\`/x/${id}\`; requeteApi(chemin, ...)`) plutôt qu'un littéral inline — exactement le piège que
`docs/13`§0 note 2 et §7 nomment déjà (« le chemin est construit dans une variable, invisible
à une recherche littérale »), retombé une seconde fois malgré l'avertissement écrit. Touche`/concurrents`, `/conditionnements/:id`, `/equipements/:id`, `/fournisseurs/:id`,
`/ingredients/:id`, `/lieux/:id`, `/produits/:id`, `/recettes/:id`, entre autres — un helper
nommé `envoyer(...)` (`Ingredients.tsx`) ajoute une troisième signature à l'appel, distincte de
`requeteApi`.
3. **2 échecs de parsing sur des template literals imbriqués**
   (`` `/concurrents${cond ? '' : `?lieuId=${x}`}` ``) : mon regex, non récursif sur les
   backticks, s'arrêtait au premier ` \` ` intérieur — capturé, identifié, corrigé à la main par
   lecture directe plutôt que par un correctif du script (le temps restant ne le justifiait pas).
4. **`GET /sante`** — 0 usage confirmé, et c'est attendu : un point de contrôle de santé
   d'infrastructure n'a aucune raison d'être appelé par un écran.

**Retenus : 4** (`fiche-technique`, `sessions-sans-releve`, `nombre-en-attente`,
`brief/commenter`).

### D5 — Catalogue des paramètres : lecture unique vérifiée comme lecture de production, pas de test

Angle explicitement signalé par la mission comme jamais bouclé jusqu'au bout.

```
grep -oE "cle:\s*'[a-z0-9_]+'" packages/core/src/parametres.ts   # 99 clés de catalogue
grep -ohE "\.(entier|decimal|texte|booleen|centimes)\('[a-z0-9_]+'"  <fichiers non-test>
```

**Candidats bruts (round 1, accesseurs `.entier/.decimal/.texte/.booleen/.json`) : 43.**
**Round 2** (ajout de l'accesseur `.centimes`, découvert manquant) : 39. **Round 3** — au lieu de
se satisfaire d'une absence de littéral, recherche en texte brut de la clé dans tout fichier non-test,
hors `parametres.ts` lui-même : **0 candidat restant**. Les 39 « orphelins » du round 2 étaient
tous de faux négatifs de méthode : un troisième accesseur (`.pointsDeBase`, découvert sur
`marge_securite_service_bp`, `moteur.ts:668`), une fonction de lecture à second nom
(`entierAvecRepli(parametres, cle, defaut)`, `scripts/backtest.ts:149`), et une résolution de
clé **par variable** dans une table de correspondance (`meteo.ts:62`,
`ensoleille_chaud: 'prevision_meteo_ensoleille_chaud_bp'`, résolue plus loin par une clé
dynamique) — trois formes distinctes du même piège qu'en D4.

**Retenus : 0.** Dérivation qui revient propre, mais seulement après avoir corrigé sa propre
méthode deux fois — exactement l'angle que la mission demandait de ne pas laisser au milieu du
gué.

### D6 — Catalogue des motifs confronté aux écrans

```
grep -n "code:" packages/core/src/motifs.ts     # 12 codes, 4 catégories
grep -rn "motifsPour" apps/web/src apps/api/src packages/core/src
```

**Candidats bruts : 12 codes.** Aucun faux positif à écarter : `motifsPour(categorie)` est une
fonction pure qui rend TOUT le sous-ensemble du catalogue pour une catégorie donnée — un motif
orphelin ne peut exister que si sa catégorie entière n'est jamais demandée. Les 4 catégories
(`perte`, `ajustement`, `sortie_volontaire`, `statut_lot`) sont bien demandées, respectivement par
`SaisieSortie.tsx`, `SaisieSortie.tsx` + `DetailLot.tsx` (annulation), `SaisieSortie.tsx`, et
`DetailLot.tsx` (changement de statut). **Retenus : 0** — et confirmation, en chemin, qu'un
« reste à faire » de `docs/13` §5.4 (remplacer le filtre manuel de `SaisieSortie.tsx` par un vrai
appel à `motifsPour`) est désormais fait (`SaisieSortie.tsx:137`, `DetailLot.tsx:63`,
`annulation.ts:41`) : encore un verdict de document qui a vieilli en devenant faux par optimisme.

### D7 — Pages React jamais routées

```
ls apps/web/src/pages/*.tsx | sed 's#.*/##;s/\.tsx$//'                           # 30 pages
grep -oE "element=\{<[A-Za-z0-9_]+" apps/web/src/App.tsx | sed 's/element={<//'  # 30 routes
comm -23 <(tri des pages) <(tri des routes)
```

**Candidats bruts : 30. Retenus : 0** — les 30 pages sont toutes routées.

### D8 — Composants partagés jamais importés

```
for c in BoutonDocument EtatVide Navigation Panneau Tableau; do
  grep -rl "from '.*/composants/$c'" apps/web/src | grep -v '\.test\.'
done
```

**Candidats bruts : 5. Retenus : 0** — les 5 ont chacun au moins un importateur hors test
(1 à 31 selon le composant).

---

## 7. Annexe — les 44 colonnes à énum du schéma (référence pour D2)

`parametre.typeValeur` · `utilisateur.role` · `journalAudit.action` · `fournisseur.type` ·
`ingredient.categorie` · `ingredient.uniteReference` · `recette.statut` · `produitVente.nature` ·
`produitVente.consommationUnite` · `motif.categorie` · `reception.source` · `reception.statut` ·
`lot.statut` · `mouvementStock.type` · `production.statut` · `lieuMarche.modeTarification` ·
`lieuMarche.facturationElectricite` · `sessionMarche.statut` · `sessionMarche.modeCloture` ·
`documentGenere.type` · `evenement.type` · `evenement.portee` · `evenement.famille` ·
`meteoObservation.type` · `commandeFournisseur.statut` · `factureFournisseur.statut` ·
`fraisReception.methodeRepartition` · `releveTemperature.moment` · `releveTemperature.statut` ·
`tacheNettoyage.frequence` · `nonConformite.gravite` · `exerciceTracabilite.resultat` ·
`journalIa.usage` · `depense.categorie` · `immobilisation.methode` · `echeance.recurrence` ·
`echeance.statut` · `periode.statut` · `economieAchat.typeAction` · `concurrent.typeOffre` ·
`concurrent.positionnement` · `concurrentObservation.affluenceEstimee` · `equipement.type` ·
`objectif.grandeur`.

---

## 8. Homonymes rencontrés

Le piège que la mission désigne comme le plus rentable de ce dépôt, retrouvé trois fois :

1. **`'en_cours'`** — valeur de `sessionMarche.statut`, ET motif local de dizaines de composants
   React pour l'état d'une requête asynchrone (`{ statut: 'inactif' | 'en_cours' | 'succes' |
'erreur' }`). Un grep nu sur `'en_cours'` renvoie ~90 lignes ; moins de 5 concernent vraiment
   la colonne de session. Sans distinguer les deux, `sessionMarche.statut = 'en_cours'` aurait pu
   sembler « largement utilisé » alors qu'il ne l'est jamais pour ce qu'il désigne réellement.
2. **`/prevision/commenter` contre `/prevision/brief/commenter`** — deux routes POST voisines,
   à un segment près, dans le même fichier (`previsions.ts:1928` et `:2043`). La première est
   câblée (`ProchaineSession.tsx:692`), la seconde ne l'est pas. Un contrôle qui s'arrête à
   « `commenter` la prévision, ça fonctionne » sans lire lequel des deux commente QUOI aurait
   blanchi l'orpheline par la présence de sa presque-jumelle — exactement le mécanisme qui a déjà
   coûté cher sur `coutKilometriqueCentsParKm` et sur `briefAvantMarche` (gabarit PDF contre
   constructeur de prompt), cités par la mission comme précédents.
3. **`productionsDuLot` (packages/db) contre `tracabiliteAvalLot` (packages/db, fichier
   voisin)** — pas un nom identique, mais un besoin identique implémenté deux fois sous deux noms
   différents ; l'inverse du piège habituel (deux noms, un seul besoin réel, l'autre mort). À
   surveiller : un futur audit qui chercherait « la fonction de traçabilité aval d'un lot » par
   nom plutôt que par comportement pourrait cocher l'une sans voir l'autre.

---

## 9. Ce que cette méthode ne couvre pas

- **Aucune ré-exécution de test.** Consigne explicite de la mission. Tous les verdicts viennent
  de lecture directe du code ; un test qui semblerait couvrir un cas n'a jamais été vu s'exécuter
  par ce document.
- **D2 (énums) a reçu un contrôle approfondi sur ~20 colonnes de statut/workflow, pas sur les 44
  dans le détail.** Les colonnes purement catégorielles (`ingredient.categorie`,
  `evenement.type`, `depense.categorie`, `concurrent.typeOffre`, etc.) n'ont été vérifiées que
  par le test « toutes les valeurs figurent dans un `Record<Enum, string>` typé » — suffisant pour
  écarter un oubli d'écran, insuffisant pour écarter une valeur qu'aucune ligne de données réelles
  n'a jamais reçue (ce qui n'est pas un défaut de code, mais un fait d'usage que je n'ai pas les
  moyens de mesurer sans interroger `donnees/batte.sqlite`, explicitement interdit).
- **D3 (exports) traite `packages/core` et `packages/db`, jamais `apps/api/src` ni
  `apps/web/src` comme SOURCE de symboles exportés.** Un helper exporté dans une route ou un
  composant, jamais réimporté ailleurs, n'a pas été cherché — uniquement les fonctions/constantes
  utilitaires au niveau module, pas les composants React eux-mêmes (couverts séparément par D7/D8
  pour les pages et les composants partagés, mais pas pour tout utilitaire `apps/web/src/lib`).
- **D4 (routes) compare des URLS NORMALISÉES, pas des méthodes HTTP.** Une route `GET /x` et une
  route `POST /x` sur le même chemin comptent comme « appelée » dès qu'UNE des deux méthodes l'est
  — je n'ai pas vérifié que CHAQUE méthode déclarée sur un chemin partagé a son propre appelant.
- **Aucune vérification que les appels identifiés en D4/D5 sont atteignables au clavier**
  (règle n°10 de `CLAUDE.md` §3) — cette mission mesure l'existence d'un chemin de code, pas son
  ergonomie.
- **Le compteur « 12 orphelins » peut déjà avoir bougé.** Le dépôt change pendant la rédaction
  (plusieurs agents en parallèle, par consigne de la mission) — la preuve la plus nette en est
  `apps/api/src/routes/previsions.ts:2043` et son test daté d'aujourd'hui, câblés PENDANT cette
  investigation. La méthode (commande citée, reproductible) reste valable même si un chiffre
  précis a changé de quelques unités entre la mesure et sa lecture.
- **Aucune dérivation n'a porté sur `apps/web/dist`** (le build servi en production) : tout est
  vérifié sur les sources, jamais sur l'artefact compilé — un écart de build (improbable, non
  cherché) resterait invisible à cette méthode.
- **La dérivation qui reste à inventer, au jugement de cet auteur** : confronter les 14
  allergènes réglementaires cités par `CLAUDE.md` §6 à la liste réellement saisissable dans
  `Ingredients.tsx` — un domaine de valeurs métier, pas un enum de schéma, donc invisible à D2,
  et pourtant du même risque (une valeur qu'aucun formulaire ne permet jamais de cocher serait le
  même défaut, sur l'affichette qui a la conséquence sanitaire la plus directe du produit).
