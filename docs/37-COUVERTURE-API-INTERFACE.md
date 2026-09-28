# 37 — Couverture API ↔ interface : quelle route est réellement atteinte par un écran

> **Date de la mesure.** 01/08/2026, 12 h 16 (Europe/Brussels). **Nature.** Inventaire pur —
> aucune correction appliquée, aucun fichier de code ni de test modifié.
> **Question posée.** Le dépôt a un défaut récidivant, attrapé cinq fois séparément
> (tâches #117, #123, #127, #134, et le branchement de `routesPalmares` le 01/08) : une capacité
> entièrement construite côté serveur — route testée, dépôt testé, contrat écrit — **qu'aucun
> bouton, aucun lien, aucun écran n'appelle jamais**. Une route que personne n'atteint n'est pas
> une fonctionnalité : c'est du code mort qui a l'air vivant.
>
> **Numérotation corrigée après coup.** Ce document avait été livré en `36-`, numéro déjà pris par
> `docs/36-AUDIT-TROIS-RESOLUTIONS.md` — le nom lui avait été imposé à tort. Renuméroté en `37-`
> le jour même. L'agent avait signalé le doublon sans le corriger de lui-même, ce qui était le bon
> réflexe : renommer le document d'un autre n'était pas son travail.

---

## 0. Les quatre nombres, tout de suite

| Ensemble mesuré                                                               | Total   |
| ----------------------------------------------------------------------------- | ------- |
| Routes **réellement montées** par `construireServeur` (hors `HEAD`/`OPTIONS`) | **182** |
| Couples méthode + chemin **réellement appelés** par `apps/web/src`            | **177** |
| Routes montées **et** atteintes                                               | **177** |
| Routes montées **jamais** atteintes                                           | **5**   |

| Catégorie                                                             | Nombre |
| --------------------------------------------------------------------- | ------ |
| **A** — route montée, jamais appelée par le web                       | **5**  |
| **B** — route définie dans un fichier mais jamais enregistrée         | **0**  |
| **C** — appel du web vers une route inexistante                       | **0**  |
| **D** — route appelée depuis un écran que la navigation n'atteint pas | **0**  |

Répartition des 182 routes montées : **92 `GET`, 62 `POST`, 28 `PATCH`**, sur 49 segments de tête
(`afsca` 15, `concurrents` 9, `commandes`/`equipements`/`evenements-decouverte`/`factures`/
`productions`/`produits`/`recettes` 7 chacun, …). Aucun `PUT`, aucun `DELETE` — cohérent avec la
règle n°7 de `CLAUDE.md` (« rien ne s'efface »).

**Le fait le plus important de ce document n'est pas dans ces tableaux.** Une sixième route,
`GET /api/concurrents/mouvements`, était en catégorie A au **premier** passage de la mesure et n'y
était plus au **second**, quarante minutes plus tard : un agent parallèle l'a câblée dans
`TableauDeBord.tsx:2842` entre les deux exécutions. Le décompte du nombre d'appels le prouve
(207 sites d'appel, puis 208). **Ce chiffre est donc un instantané daté, pas un état permanent** —
voir §6.

---

## 1. La méthode, et pourquoi c'est elle qui compte

Décision **D-045** de ce dépôt : _une liste manuscrite ne prouve jamais une absence — il faut la
dériver de la source de vérité._ Elle est née d'une liste écrite à la main qui prétendait prouver
une absence et laissait passer quatre routes de lecture, dont `/api/recettes`. Rien de ce qui
suit n'est énuméré à la main.

### 1.1 Ensemble n°1 — les routes RÉELLEMENT montées

La source de vérité n'est pas le code source des fichiers de route : c'est la **table de routage
de Fastify**, après résolution de tous les plugins. C'est exactement la distinction qui a manqué
le 01/08 avec `/api/palmares/*` : la route était définie, testée sur une instance Fastify montée
à la main, et **absente du vrai serveur** parce que `serveur.ts` ne l'enregistrait pas.

Le script ci-dessous monte le serveur COMPLET avec la même fonction que le démarrage réel
(`construireServeur`), sur une base **en mémoire** — jamais `donnees/batte.sqlite`, jamais
`creerContexte()` (qui écrirait une vraie sauvegarde sur le poste) — et vide la table via le hook
`onRoute`, seule façon documentée d'observer le routage réel sans dépendre du format texte de
`printRoutes()`. Même technique que `apps/api/src/smoke-routes-lecture.test.ts`.

```ts
// dump-routes.mts — jetable, exécuté hors du dépôt
import { creerBase, migrer, seed } from 'file:///…/packages/db/src/index.ts';
import { construireServeur } from 'file:///…/apps/api/src/serveur.ts';

const base = creerBase(':memory:');
migrer(base);
seed(base);

const app = construireServeur(base, { journaliser: false, racineUrlMeteo: 'http://127.0.0.1:1' });
const routes: { methode: string; url: string }[] = [];
app.addHook('onRoute', (options) => {
  const methodes = Array.isArray(options.method) ? options.method : [options.method];
  for (const methode of methodes) routes.push({ methode, url: options.url });
});
await app.ready(); // avvio ne résout les plugins imbriqués qu'ici
console.log(JSON.stringify(routes));
await app.close();
```

```bash
cd C:/Users/<compte>/Desktop/AppCrepe
CHEMIN_BASE=":memory:" npx tsx <scratchpad>/dump-routes.mts > routes.json
```

`CHEMIN_BASE=":memory:"` est posé **dans le même appel de terminal** que la commande : l'état du
shell ne persiste pas d'un appel à l'autre, et une variable posée séparément aurait laissé le
script ouvrir la vraie base du porteur. Ceinture et bretelles : le script passe déjà `':memory:'`
explicitement à `creerBase`.

`HEAD` et `OPTIONS` sont retirés du décompte : Fastify ajoute automatiquement un `HEAD` par `GET`,
et les compter reviendrait à compter chaque lecture deux fois (274 entrées brutes → 182 routes
utiles).

### 1.2 Ensemble n°2 — les appels RÉELLEMENT émis par le web

Vérification préalable : **`apps/web/src/lib/api.ts` est la seule porte**. Deux `fetch` y sont
écrits, aucun autre ailleurs.

```bash
grep -rn "fetch(\|XMLHttpRequest\|EventSource\|window.open\|location.href\|axios" \
  apps/web/src --include=*.ts --include=*.tsx | grep -v "\.test\."
# → 2 résultats dans lib/api.ts, 3 mentions en commentaire. Rien d'autre.

grep -rn "href=\|action=\|src=" apps/web/src --include=*.tsx | grep "/api"
# → 0 : aucun lien, aucun formulaire, aucune image ne vise l'API directement.
```

Un `grep` sur des chaînes littérales ne suffit pas : ce dépôt construit des URL. Deux passes ont
donc été faites sur tous les `.ts`/`.tsx` de `apps/web/src` hors `*.test.*`.

**Passe A — analyse d'appel.** Pour chaque `requeteApi<…>(` et `telechargerFichierApi(`, lecture du
premier argument par **équilibrage de parenthèses** (et non par expression régulière sur le texte
de l'argument), puis extraction de `method: 'X'` dans les arguments suivants (`GET` par défaut,
et toujours `GET` pour `telechargerFichierApi`). Chaque `${…}` est remplacé par `:p`, en
équilibrant les accolades — ce qui traite correctement les gabarits imbriqués du type
`` `/concurrents${filtre === '' ? '' : `?lieuId=${x}`}` `` sur lesquels un motif non récursif
s'arrête au premier backtick intérieur. La chaîne de requête est coupée à `?`.

→ **208 sites d'appel**, dont **13 non littéraux** (le chemin est porté par une variable ou une
prop).

**Passe B — filet indirect.** Tout littéral (chaîne ou gabarit) commençant par `/`, n'importe où
dans le code web. Cette passe rattrape ce que la passe A ne peut pas voir : la prop
`chemin=` de `BoutonDocument` (qui appelle `telechargerFichierApi` un fichier plus loin), les
chemins assemblés dans une variable, les helpers à seconde signature.

→ **174 chemins distincts**, dont les chemins de `react-router` (`/achats`, `/comptabilite`, …)
et les mentions en commentaire, écartés à la lecture.

**Résolution des 13 sites indirects — à la lecture, un par un.** Chacun a été ouvert :

| Site                                            | Se résout en                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `composants/BoutonDocument.tsx:174`             | les 13 props `chemin=` de ses appelants (voir ci-dessous)                                      |
| `pages/Concurrents.tsx:641`                     | `POST /concurrents` (création) · `PATCH /concurrents/:id` (modification)                       |
| `pages/Equipements.tsx:480`                     | `POST /equipements` · `PATCH /equipements/:id`                                                 |
| `pages/Fournisseurs.tsx:432`                    | `POST /fournisseurs` · `PATCH /fournisseurs/:id`                                               |
| `pages/Ingredients.tsx:615`                     | `POST /ingredients` · `PATCH /ingredients/:id`                                                 |
| `pages/Ingredients.tsx:1186` (helper `envoyer`) | `POST /conditionnements` · `PATCH /conditionnements/:id` · `POST /conditionnements/:id/tarifs` |
| `pages/LieuxMarche.tsx:479`                     | `POST /lieux` · `PATCH /lieux/:id`                                                             |
| `pages/Menus.tsx:479`                           | `POST /menus/:menuId/composition` · `PATCH /composition-menu/:id`                              |
| `pages/NomenclatureVente.tsx:365`               | `POST /produits/:id/composants` · `PATCH /composants/:id`                                      |
| `pages/PrevisionCalendaire.tsx:82`              | `GET /prevision-calendaire` (avec ou sans `?horizonJours=`)                                    |
| `pages/ProchaineSession.tsx:387`                | `GET /concurrents/comparateur` (via `cheminComparateurDuLieu`)                                 |
| `pages/Produits.tsx:735`                        | `POST /produits` · `PATCH /produits/:id`                                                       |
| `pages/Recettes.tsx:1722`                       | `POST /recettes` · `POST /recettes/:id/versions` · `PATCH /recettes/:id`                       |

Les 13 props `chemin=` de `BoutonDocument`, dérivées et non listées de mémoire
(`grep -rn "chemin=" apps/web/src --include=*.tsx | grep -v "\.test\."`) : `/commandes/:id/pdf`,
`/exports/journal-recettes`, `/exports/journal-achats`, `/exports/economies`, `/prevision/brief`,
`/documents/etiquette-bac/:id`, `/documents/fiche-technique/:id`, `/documents/registre-afsca`,
`/documents/affichette-allergenes`, `/documents/rapport-session/:id`, `/exports/stock`,
`/exports/mouvements`, `/documents/fiche-rappel/:lot`.

> Trois de ces treize (`/prevision/brief`, `/documents/affichette-allergenes`, `/exports/stock`)
> s'écrivent `chemin="…"` et non `chemin={`…`}` : un `grep "chemin={"` les manque. C'est
> exactement le genre de demi-mesure qui produit un faux « jamais appelé ».

### 1.3 Croisement, dans les deux sens

Les chemins des deux ensembles sont normalisés à l'identique : préfixe `/api` retiré côté
serveur, chaque paramètre (`:id`, `:lotId`, `:menuId`, …) réduit à `:p` des deux côtés — parce que
`:id` ne désigne pas la même entité selon la route et qu'une comparaison par nom de paramètre
serait fausse. La clé de comparaison est le couple **méthode + chemin** : `GET /factures` et
`POST /factures` sont deux routes distinctes et doivent être comptées comme telles.

Une règle de normalisation supplémentaire a dû être ajoutée après une première exécution qui
produisait **trois faux positifs de catégorie C** (`/concurrents:p`, `/concurrents/comparateur:p`,
`/prevision:p`) :

```js
// Un `${…}` collé à la FIN d'un segment littéral (jamais précédé d'un `/`) n'est pas un
// paramètre de chemin : c'est un suffixe de chaîne de requête conditionnelle.
// Aucune route Fastify de ce dépôt n'a de paramètre collé à un segment — tous sont `/:x`.
const oterSuffixeDeRequete = (c) => c.replace(/([^/]):p$/, '$1');
```

Les trois sites concernés ont été relus à la main pour confirmer la règle avant de l'appliquer
(`Concurrents.tsx:490`, `Concurrents.tsx:507`, `ProchaineSession.tsx:552`) : tous trois écrivent
bien `` `/chemin${cond ? '' : '?param=…'}` ``.

### 1.4 Catégorie B — l'enregistrement, pas la définition

Deux mesures indépendantes, l'une statique et l'autre dynamique, comparées entre elles.

```bash
# Toutes les définitions ÉCRITES dans apps/api/src (hors *.test.ts) :
#   `x.get('/…')`, `.post`, `.put`, `.patch`, `.delete`, `.route({ method, url })`
# — avec les paramètres de type génériques optionnels : `app.get<{ Querystring: X }>('/audit', …)`
```

> **Piège méthodologique rencontré, et corrigé.** Sans `(?:<[\s\S]*?>)?` dans le motif,
> **105 des 182 routes** de ce dépôt étaient invisibles au balayage statique : `concurrents.ts`
> paraissait n'avoir qu'une route, `audit.ts` aucune. Une première version de ce document aurait
> conclu « catégorie B = 0 » sur un ensemble de 77 routes seulement — un vert par cécité, très
> exactement le défaut que `apps/api/src/routes-enregistrement.test.ts` décrit dans son en-tête
> à propos de `palmares`.

**Résultat une fois le motif corrigé :**

- **183 définitions écrites** trouvées, dont **une seule dans un commentaire**
  (`routes/opportunites.ts:45` cite `app.get('/opportunites', …)` en prose ; la vraie
  définition est à `:378`) — soit **182 définitions réelles** ;
- **182 routes montées** ;
- **0 définition écrite absente de la table réelle** (catégorie B = 0) ;
- **0 route montée sans définition écrite correspondante** — les deux ensembles coïncident
  exactement, dans les deux sens ;
- **27 fichiers de route, 27 factories `routesXxx`, une par fichier** — aucun fichier n'en exporte
  deux (un point que `routes-enregistrement.test.ts` ne peut pas voir : son motif ne retient que
  la première `export function routesXxx(` de chaque fichier) ;
- **un seul `register(…, { prefix })` dans tout `apps/api/src`** : `serveur.ts:180`, `/api`. Aucun
  sous-préfixe interne ne peut donc décaler silencieusement un chemin.

### 1.5 Catégorie D — les écrans que la navigation n'atteint pas

`apps/web/src/App.tsx` déclare **30 routes d'écran** (plus le `*` d'égarement) ;
`apps/web/src/composants/Navigation.tsx` en expose **29** dans la barre latérale.

Le seul écart est **`/stock/inventaire`** (`InventaireInitial`), absent de la barre latérale mais
atteint par deux liens internes réels — `pages/Stock.tsx:1107` (`navigate('/stock/inventaire')`)
et `pages/TableauDeBord.tsx:419`. Il n'émet d'ailleurs **aucun appel API** : aucune route ne
dépend de lui. Ce n'est donc pas un écran orphelin.

Contrôle complémentaire, pour la forme dégradée de la catégorie D — une route appelée par un
composant que personne ne rend :

```
63 composants React exportés (hors tests) → 0 jamais référencé ailleurs que dans son
propre fichier.
```

**Catégorie D = 0.**

---

## 2. Catégorie A — les 5 routes montées que rien n'appelle

Rappel de la nuance qui décide de tout : **« zéro appelant » n'est pas « inutile »**. C'est une
question à poser. Pour chacune : (i) capacité oubliée à brancher, (ii) brique interne appelée
par une autre route côté serveur, (iii) export ou document ouvert par une URL directe, (iv)
vrai mort-né à retirer.

Les cinq répondent **200** sur le serveur du porteur, vérifié en lecture seule le 01/08 à 12 h 20
(`curl -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/…`) : elles sont vivantes,
atteignables à l'URL, et aucun écran ne les atteint.

### A.1 — `PATCH /api/conditionnements/:id/activite`

**Écran attendu.** `pages/Ingredients.tsx`, panneau « Format d'achat » — au même endroit que
« Enregistrer un nouveau tarif », « Corriger la fiche » et « Ajouter un conditionnement ».

**Verdict : (i) capacité oubliée à brancher.** C'est la seule route `/activite` du dépôt qui n'a
pas de bouton. Les huit autres — `/fournisseurs/:id/activite`, `/ingredients/:id/activite`,
`/produits/:id/activite`, `/lieux/:id/activite`, `/equipements/:id/activite`,
`/concurrents/:id/activite`, `/composants/:id/activite`, `/composition-menu/:id/activite` — sont
toutes câblées. Le service sous-jacent (`changerActiviteConditionnement`,
`packages/db/src/depots/referentiel-ecriture.ts:749`) est complet : transaction, contrôle
d'existence, journal d'audit.

**Ce que le porteur ne peut pas faire.** Retirer du référentiel un format d'achat que le
fournisseur ne vend plus. Le panneau affiche pourtant `actif`/`archivé` (`Ingredients.tsx:403`),
mais cet état n'est posé **qu'automatiquement**, par `enregistrerNouveauTarif` qui archive la
ligne précédente. Le geste explicite — « ce sac de 25 kg n'existe plus » — n'a aucun chemin. La
règle n°7 de `CLAUDE.md` (« on ne supprime pas, on désactive ») est écrite en toutes lettres en
tête de cet écran (`Ingredients.tsx:54`) ; elle n'est pas applicable ici.

### A.2 — `GET /api/evenements-decouverte/propositions/nombre-en-attente`

**Écran attendu.** Bloc « Alertes » de `pages/TableauDeBord.tsx`, ou un badge dans
`composants/Navigation.tsx` à côté de « Propositions IA (événements) ». La route le dit
elle-même : _« Pour le bloc Alertes du tableau de bord (fiche 05) »_
(`routes/evenements-decouverte.ts:567`).

**Verdict : (i) capacité oubliée à brancher, avec une réserve honnête.** Le tableau de bord
affiche bien une alerte de propositions en attente (`TableauDeBord.tsx:1285`), mais il la dérive
de `GET /evenements-decouverte/propositions` — la **liste complète** — dont il compte les
éléments. Le résultat visible est le même ; la route dédiée n'est donc pas une capacité
_manquante_ pour l'utilisateur, seulement un chemin plus économique jamais emprunté.

Deux issues défendables, et je ne tranche pas : **brancher** la route dédiée là où seul le nombre
est nécessaire (un badge de navigation, qui ne devrait pas charger la liste), ou **retirer** la
route et assumer que le compteur se déduit toujours de la liste. Ce qu'il ne faut pas faire,
c'est laisser les deux et croire que l'un des deux est le chemin officiel.
`docs/28-ORPHELINS-DERIVES.md` §2.5 arrivait déjà à cette route et notait la même hésitation
(« confiance plus faible que les précédents ») : elle est toujours ouverte, cinq semaines plus tard.

### A.3 — `GET /api/produits/:id/cout-revient`

**Écran attendu.** Une fiche produit détaillée — qui n'existe pas ; `pages/Produits.tsx` est une
liste avec un formulaire latéral.

**Verdict : (iv) mort-né, supplanté par sa propre sœur au pluriel.** Le commentaire qui précède la
route sœur dit exactement pourquoi elle ne sert pas :

> _« Une seule route de LISTE et non une par produit : l'écran Produits a besoin de la colonne
> pour toutes ses lignes à la fois. »_ — `apps/api/src/routes/recettes.ts:107-109`

`GET /couts-produits` (`recettes.ts:110`) est appelée par `Produits.tsx:495` et fournit la colonne
pour toutes les lignes. La version unitaire, déclarée quatre lignes plus bas, est le vestige de
l'implémentation que ce commentaire annonce avoir remplacée. Elle n'a pas été retirée.

**Réserve.** `coutRevientProduit` (la fonction qu'elle appelle) reste utilisée ailleurs ; c'est la
**route** qui est morte, pas le calcul. Le retrait proposé porte sur les cinq lignes de la route.

### A.4 — `GET /api/motifs`

**Écran attendu.** Aucun, et c'est délibéré.

**Verdict : (iv) mort-né, par décision d'architecture explicite et documentée.** L'interface
lisait autrefois ce catalogue par HTTP ; elle ne le fait plus, et le commentaire qui remplace
l'appel explique pourquoi :

> _« Ces listes venaient d'un `GET /motifs` suivi d'un filtre par catégorie réécrit à la main —
> c'est-à-dire `motifsPour` (`@batte/core`) réimplémenté dans le navigateur, contre la règle
> d'architecture n°1. Or `motifsPour` lit `CATALOGUE_MOTIFS`, un module statique déjà présent
> côté navigateur : la requête relayait une donnée qu'on avait déjà. Elle est donc supprimée. »_
> — `apps/web/src/saisie-stock/DetailLot.tsx:43-49`

`CATALOGUE_MOTIFS` vit dans `packages/core`, partagé par les deux côtés : la route ne peut donc
jamais rien apporter que le navigateur n'ait déjà. **C'est le seul des cinq cas où le retrait est
sans risque et sans arbitrage** — l'appel a été retiré côté web, la route ne l'a pas été.

### A.5 — `GET /api/sante`

**Écran attendu.** Aucun, et c'est correct.

**Verdict : (iii) sonde de diagnostic ouverte par URL directe.** Point de contrôle
d'infrastructure : quelle base est ouverte, quelles clés de `parametre` manquent, et le geste exact
à faire (`npm run db:seed`). Elle est utilisée — par des humains et par des documents, pas par un
écran : `docs/12-AUDIT-DEMARRAGE.md` (trois relevés), `docs/27-PARCOURS-REJOUE.md`,
`docs/33-PARCOURS-APRES-CAMPAGNE.md` et `docs/05-DECISIONS.md:1472` s'en servent tous pour
identifier l'instance testée.

**À conserver telle quelle.** `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §1.10 et
`docs/28-ORPHELINS-DERIVES.md` §D4.4 la classent déjà ainsi ; ce document confirme, ne rouvre pas.

> **Note de sécurité, sans action demandée ici.** `docs/11-AUDIT-SECURITE.md:401` relève que cette
> route renvoie le chemin absolu du fichier SQLite, donc l'arborescence du poste, et l'assume pour
> une application liée à `127.0.0.1`. Rappelé pour mémoire, pas rouvert.

---

## 3. Catégories B, C et D — les trois listes vides, et ce qui les rend vides

**B = 0.** Les 27 factories `routesXxx` déclarées sous `apps/api/src/routes/` sont toutes
importées **et** appelées dans `serveur.ts`. Ce n'est pas un heureux hasard : c'est
`apps/api/src/routes-enregistrement.test.ts`, écrit le 01/08 précisément après l'incident
`palmares`, qui compare les deux listes dérivées du code source. **Ce test est le seul garde-fou
du dépôt contre la catégorie B ; il ne doit pas être supprimé.**

Ce document ajoute deux vérifications que ce test ne fait pas :

1. **La comparaison ne s'arrête pas aux factories, elle descend à la route.** 182 définitions
   écrites ↔ 182 routes montées, correspondance exacte dans les deux sens. Une route perdue à
   l'intérieur d'une factory enregistrée (branche conditionnelle, `register` imbriqué non
   résolu) serait visible ici et invisible du test.
2. **Un fichier de route qui exporterait DEUX factories** serait à moitié couvert par le test
   (son motif ne retient que la première `export function routesXxx(`). Vérifié : aucun fichier
   n'en exporte deux aujourd'hui. **Si cela arrivait, la seconde serait un angle mort.**

**C = 0**, une fois les trois faux positifs de suffixe de requête écartés (§1.3). Aucun écran
n'appelle une adresse qui n'existe pas : aucune page ne cassera en production pour ce motif.

**D = 0** : les 30 écrans routés sont tous atteignables, et les 63 composants exportés sont tous
rendus quelque part.

---

## 4. Atteignable mais introuvable — signalé à part, jamais compté comme route morte

La mission demande de distinguer une route morte d'une capacité présente que personne n'irait
chercher. Ce n'est pas un défaut de code, ce n'est pas dans les décomptes ci-dessus, et cela ne
justifie aucune ligne de code neuve — seulement un regard.

1. **`/stock/inventaire` n'est dans aucun menu.** L'écran d'inventaire initial n'existe dans la
   barre latérale ni sous ce nom ni sous un autre. On l'atteint par un bouton de l'écran Stock
   (`Stock.tsx:1107`) et par un lien du tableau de bord (`TableauDeBord.tsx:419`) — c'est
   probablement volontaire (c'est un geste de premier lancement, pas une routine hebdomadaire),
   mais il faut savoir où il est pour y retourner.

2. **La barre latérale déborde.** Son propre en-tête le dit
   (`composants/Navigation.tsx:129-136`) : 29 entrées, débordement de 252 px à la résolution
   cible, **8 entrées sous le pli**. Une capacité correctement câblée dont l'entrée de menu est
   sous le pli est atteignable et introuvable au premier regard. Mesuré et assumé par ailleurs ;
   rappelé ici parce que c'est la même famille de défaut, vue du côté de l'utilisateur.

3. **Le contrôle d'intégrité du grand livre de stock** (`GET /stock/integrite`, `Stock.tsx:897`)
   est bien câblé — mais il est en bas de l'écran Stock, à côté des boutons d'export. C'est le
   contrôle sur lequel repose la crédibilité du registre AFSCA. Sa place n'est pas une question de
   couverture d'API, et ce document ne tranche pas ; il la pose.

---

## 5. Rejouer cet inventaire

Trois scripts jetables, exécutés depuis la racine du dépôt, aucun écrivant dans le dépôt.

```bash
# 1. Table de routage RÉELLE (base en mémoire, jamais donnees/batte.sqlite)
CHEMIN_BASE=":memory:" npx tsx <scratchpad>/dump-routes.mts > routes.json

# 2. Appels du web : passe A (analyse d'appel + méthode) et passe B (filet indirect)
node <scratchpad>/extraire-v2.mjs        # → appels-v2.json, + les sites non littéraux à relire
node <scratchpad>/extraire-appels.mjs    # → passe B, tous littéraux commençant par /

# 3. Croisement dans les deux sens (catégories A et C)
node <scratchpad>/croiser.mjs

# 4. Définitions écrites ↔ routes montées (catégorie B)
node <scratchpad>/definitions.mjs

# 5. Composants exportés jamais rendus (forme dégradée de la catégorie D)
node <scratchpad>/composants-orphelins.mjs
```

Les scripts sont volontairement **hors du dépôt** : ils sont un instrument de mesure, pas un
livrable, et une mission d'inventaire ne doit pas laisser de code derrière elle. La méthode, elle,
est ici en entier — c'est elle qu'il faut pouvoir rejouer, pas les fichiers.

**Ce qui vaudrait mieux qu'un rejeu manuel :** un test qui échoue quand une route montée n'a aucun
appelant, sur le modèle exact de `routes-enregistrement.test.ts`, avec une liste d'exceptions
nommées et justifiées (`/sante` en serait la première). Il fermerait la boucle que ce document ne
fait qu'ouvrir. **Ce n'était pas dans le périmètre de cette mission, qui est une mesure.**

---

## 6. Ce que cet inventaire NE prouve PAS

C'est la partie la plus importante de ce document. Un inventaire qui ne dit pas ses trous se lit
comme une garantie, et devient alors plus dangereux que pas d'inventaire du tout.

### 6.1 Il ne prouve pas un état permanent — il est daté à l'heure près

`GET /api/concurrents/mouvements` était en catégorie A à 11 h 34 et n'y était plus à 12 h 08 :
un agent parallèle l'a câblée dans `TableauDeBord.tsx:2842` pendant la mesure. Le nombre de sites
d'appel est passé de 207 à 208 entre les deux exécutions — c'est la preuve, pas une impression.
**Le dépôt bouge sous la mesure.** Tous les chiffres de ce document valent pour le
**01/08/2026 à 12 h 16**, et les numéros de ligne cités peuvent avoir bougé depuis. Ce qui ne
bouge pas, c'est la méthode du §1 : rejouez-la plutôt que de faire confiance à ces nombres.

### 6.2 Il ne prouve pas qu'une route atteinte est atteignable _par l'utilisateur_

C'est la limite la plus lourde. « Un appel existe dans le code » ≠ « le porteur peut le
déclencher ». Une route peut être appelée depuis une branche que rien n'active : un bouton rendu
sous une condition jamais vraie, un `useEffect` derrière un état inatteignable, une action rendue
seulement quand une donnée qui n'existe jamais est présente. **Je n'ai pas exécuté l'interface, ni
cliqué un seul bouton.** Les 177 routes « atteintes » le sont _statiquement_.

Ce que j'ai pu faire pour réduire ce trou, et que j'ai fait : vérifier que les 63 composants
exportés sont tous rendus (§1.5). Ce que je n'ai pas fait : vérifier que chaque _condition de
rendu_ peut être satisfaite. Seul un parcours réel — la famille `docs/14`, `docs/27`, `docs/33` —
peut le prouver.

### 6.3 Il ne prouve pas l'absence d'une URL construite d'une façon que je n'ai pas prévue

Ma détection des appels peut manquer un chemin. Ce que j'ai fait pour m'en assurer, et ce qui
resterait néanmoins possible :

**Ce qui a été couvert.** (a) La porte unique : deux passes de `grep` établissent que `lib/api.ts`
est le seul point de sortie réseau du web, et qu'aucun `href`, `action` ou `src` ne vise `/api`.
(b) Les gabarits imbriqués, par équilibrage d'accolades — le piège sur lequel
`docs/28-ORPHELINS-DERIVES.md` §D4.3 s'était arrêté. (c) Les chemins portés par une variable,
par une seconde passe littérale **et** relecture individuelle des 13 sites — le piège que
`docs/13` §0 avait nommé et que `docs/28` §D4.2 a retrouvé une seconde fois malgré
l'avertissement écrit. (d) Le franchissement de fichier, `BoutonDocument` recevant son chemin
d'un appelant. (e) La méthode HTTP, lue dans les options de l'appel plutôt que supposée.

**Ce qui resterait invisible.** Un chemin construit par **concaténation de constantes**
(`const BASE = '/factures'; requeteApi(BASE + '/' + id)`) : la passe B verrait `/factures` et
manquerait `/factures/:id`. Un chemin **assemblé segment par segment** (`['', 'stock',
id].join('/')`) : aucune des deux passes ne le verrait. Un chemin **traversant deux fichiers dans
une variable** plutôt que dans une prop nommée `chemin`. Un appel **dans une chaîne de
`node_modules`** ou dans un fichier hors `apps/web/src`.

**Vérification directe faite contre ce trou.** Le croisement se lit **dans les deux sens**, et
c'est ce qui limite la casse : si un chemin construit m'avait échappé, il aurait produit une
catégorie C (un appel vers une route que je ne reconnais pas) **ou** laissé une route en
catégorie A. Or la catégorie C est vide, et je suis descendu au code source sur les cinq entrées
de la catégorie A. **Un chemin construit invisible ne peut donc s'être glissé que là où il
duplique un chemin déjà détecté** — auquel cas il ne change aucune conclusion — **ou parmi ces
cinq entrées seulement**, que j'ai lues une par une. C'est le seul argument d'exhaustivité que je
peux réellement fournir, et il vaut mieux qu'une affirmation d'exhaustivité.

### 6.4 Il ne prouve pas qu'une route atteinte est CORRECTEMENT atteinte

Aucune vérification de correspondance entre ce que l'écran envoie et ce que la route attend :
ni corps, ni chaîne de requête, ni forme de la réponse. Un `POST` qui atteint la bonne route avec
le mauvais corps est compté « atteint » ici et échouera chez le porteur. Ce document mesure une
**surface**, pas un contrat. Les tests par route et `apps/api/src/smoke-routes-lecture.test.ts`
couvrent l'autre moitié.

### 6.5 Il ne prouve rien sur les capacités qui n'ont même pas de route

Le motif de D-087 se décline à plusieurs niveaux : service testé sans route, route montée sans
bouton, bouton présent sans être trouvable. **Ce document ne mesure que le deuxième.** Une
fonction complète et testée de `packages/db` ou `packages/core` qu'aucune route n'expose est
invisible ici par construction — et il y en a. `docs/28-ORPHELINS-DERIVES.md` §2.7-2.8 et §3 en
recensent (`ecartPrix`, `totaliserJournal`, `productionsDuLot`, `estUnite`,
`sessionMarche.statut = 'en_cours'`) ; je ne les ai ni revérifiés ni recomptés, et l'un d'eux au
moins peut avoir été traité depuis. **Une couverture API↔interface à 100 % ne dirait rien de la
couverture métier↔API.**

### 6.6 Il ne prouve pas qu'une route de catégorie A est inutile

Répété parce que c'est la conclusion la plus facile à tirer et la plus fausse. Sur cinq entrées :
**une** est à brancher sans discussion (A.1), **une** demande un arbitrage que je ne tranche pas
(A.2), **deux** sont des morts-nés proposés au retrait (A.3, A.4), et **une** doit rester telle
quelle (A.5). Un inventaire qui aurait classé les cinq en « à brancher » aurait fait perdre du
temps sur quatre d'entre elles.
