# 40 — Inventaire : « inconnu » contre « 0 »

> **Mesure du 01/08/2026.** Cinq instances de « valeur inconnue affichée `0` » avaient été
> trouvées et corrigées ce jour-là, **toutes par accident**, en travaillant sur autre chose.
> Personne n'avait jamais mesuré combien il en restait. Ce document est cette mesure.
>
> Règle mesurée : **une valeur inconnue vaut `null`, jamais `0`** (`docs/39` §4, `CLAUDE.md` §7).
> Un coût matière à `0` produit **100 % de marge** — un chiffre qui ne choque personne et
> qui est faux.
>
> **État épinglé** : empreinte des contrats `88f26e3a46047520792f3689ff9c2bb4`
> (`find packages/core/src/contrats -name '*.ts' -not -name '*.test.ts' -exec md5sum {} \; | md5sum`).
> Six agents écrivaient en parallèle pendant cette mesure ; deux fichiers de contrat ont bougé
> sous l'inventaire (le total est passé de 408 à 411 en cours de route). Toute reprise doit
> commencer par recalculer cette empreinte.

---

## 1. Méthode

### 1.1 Pourquoi la liste n'est pas écrite à la main

D-045 : **une liste écrite à la main ne prouve jamais une absence.** La source de vérité
retenue ici n'est ni le texte des fichiers de contrat, ni un `grep` sur `.nullable()`, mais
**les objets Zod eux-mêmes**, importés et parcourus. Un `grep '\.nullable()'` aurait raté les
formes `z.union([X, z.null()])`, `z.int().nullable().optional()`, les schémas construits par
`.extend()` et les objets définis en ligne dans un `z.array(z.object({…}))`.

Le parcours descend dans `object`, `array`, `union`, `record`, `tuple`, `lazy`, `intersection`,
`pipe`, et traverse les enveloppes `optional` / `default` / `catch` / `readonly` / `nonoptional`
/ `prefault` avant de décider si un champ est nullable.

### 1.2 Les commandes

Trois scripts jetables, écrits dans le scratchpad de session (jamais dans le dépôt). Le cœur
du premier, à recopier tel quel pour rejouer :

```ts
// derive.mts — exécuter depuis la racine : npx tsx derive.mts
import { pathToFileURL } from 'node:url';
import { readdirSync } from 'node:fs';
const DIR = 'packages/core/src/contrats';

const defDe = (s: unknown): any =>
  s && typeof s === 'object' && '_zod' in (s as any) ? (s as any)._zod.def : undefined;

// Clé d'unicité = (schéma-objet PROPRIÉTAIRE, nom du champ) — identité d'OBJET, jamais texte.
// Sans ça, un champ atteint depuis cinq réponses différentes serait compté cinq fois.
const parCle = new Map<object, Map<string, unknown>>();

function walk(s: unknown, p = 0): void {
  if (p > 20) return;
  const d = defDe(s);
  if (!d) return;
  if (d.type === 'object' || d.type === 'interface') {
    const shape = typeof d.shape === 'function' ? d.shape() : d.shape;
    for (const [k, v] of Object.entries(shape ?? {})) {
      let cur: any = v,
        g = 0;
      while (cur && g++ < 12) {
        // traverse les enveloppes
        const cd = defDe(cur);
        if (!cd) break;
        if (cd.type === 'nullable' || cd.type === 'null') {
          enregistrer(s as object, k);
          break;
        }
        if (
          cd.type === 'union' &&
          (cd.options ?? []).some((o: unknown) => defDe(o)?.type === 'null')
        ) {
          enregistrer(s as object, k);
          break;
        }
        if (
          ['optional', 'default', 'catch', 'readonly', 'nonoptional', 'prefault'].includes(cd.type)
        ) {
          cur = cd.innerType;
          continue;
        }
        if (cd.type === 'pipe') {
          cur = cd.out;
          continue;
        }
        break;
      }
      walk(v, p + 1);
    }
    return;
  }
  // array | union | record | tuple | lazy | intersection | pipe | enveloppes : descendre
}
```

Les commandes effectivement lancées :

```bash
# 1. Tous les champs nullable de TOUS les contrats (entrée + sortie)
npx tsx derive.mts stats

# 2. Racines de SORTIE : schémas parsés en position `return` dans une route,
#    plus ceux parsés par apps/web sur une réponse. Dérivé, jamais listé à la main.
for f in apps/api/src/routes/*.ts apps/api/src/*.ts; do
  case "$f" in *.test.ts) continue;; esac
  grep -nE "(return|send\(|=>\s*)\s*schema[A-Za-z0-9_]*\.parse\(" "$f" \
    | grep -oE "schema[A-Za-z0-9_]*\.parse\(" | sed 's/\.parse(//'
done | sort -u > out-api.txt                       # 113
grep -rhoE "schema[A-Za-z0-9_]*\.parse\(" apps/web/src --include=*.ts --include=*.tsx \
  | sed 's/\.parse(//' | sort -u > out-web.txt      # 100

# 3. Champs nullable ATTEIGNABLES depuis une racine de sortie
npx tsx derive-sortie.mts stats

# 4. Site d'affichage de chaque nom, sur TOUTES les surfaces
node afficher.mjs stats

# 5. Balayage transverse de toutes les retombées sur 0, les 4 paquets
node zeros.mjs stats

# 6. Mesure sur la base réelle, en LECTURE SEULE
node lire.mjs
```

### 1.3 Les surfaces regardées, et pourquoi trois et non une

Premier balayage : `apps/web/src` seul. Il a rendu **22 champs « affichés nulle part »**.
Vérification croisée : `caEspecesCents` en faisait partie, et il est imprimé sur le rapport PDF
de session (`apps/api/src/documents/gabarits.ts:451`). **Le balayage était faux de son propre
angle mort** — exactement le piège n°2 de `docs/39` §2 (le composant partagé, 68 emplacements
comptés là où il y en avait 90).

Surfaces retenues après correction, et la liste est fermée par construction (tout ce qui
atteint l'œil du porteur) :

| Surface                     | Racine                                                                    | Champs nullable qui y apparaissent |
| --------------------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| Écrans                      | `apps/web/src`                                                            | 234                                |
| Documents PDF               | `apps/api/src/documents` (`gabarits.ts`, `registre-afsca.ts`, `rendu.ts`) | 69                                 |
| Classeurs Excel             | `apps/api/src/documents/excel.ts`                                         | (inclus ci-dessus)                 |
| Aides d'affichage partagées | `packages/core/src/affichage.ts`                                          | 6                                  |

Après élargissement, les « affichés nulle part » tombent de 22 à **19**.

### 1.4 Le balayage transverse — parce que l'affichage n'est pas le seul endroit où on ment

Chercher le mensonge au point d'affichage ne suffit pas : TypeScript strict interdit déjà de
passer un `number | null` à `formaterEuros(centimes: number)`. **Le mensonge se fabrique donc
en amont**, par un `?? 0` posé dans le dépôt, le service, ou la route. Un balayage séparé a
donc couvert `apps/web`, `apps/api`, `packages/core` et `packages/db` :

```
79 retombées sur 0 (hors commentaires)
   37  packages/db
   21  apps/api
   13  packages/core
    8  apps/web
   dont 30 dont l'identifiant porte le nom d'un champ nullable de contrat
```

Plus les formes que `?? 0` ne couvre pas : ternaires `=== null ? 0 :` et **`COALESCE(...)` SQL**,
qui échappe à toute lecture du TypeScript.

### 1.5 La mesure sur la base réelle

Pour chaque cas douteux, la question « ce `?? 0` est-il atteignable ? » a été tranchée par une
lecture **en lecture seule** (`readonly: true`) de `donnees/batte.sqlite` — aucune écriture,
aucune requête vers le serveur du porteur. C'est ce qui distingue « théoriquement possible » de
« se produit sur ses données ».

---

## 2. Les totaux

| Grandeur                                                       |             Valeur | Commande                                      |
| -------------------------------------------------------------- | -----------------: | --------------------------------------------- |
| Fichiers de contrat lus                                        |                 25 | `readdirSync`, hors `*.test.ts` et `index.ts` |
| Schémas Zod exportés                                           |                333 | `derive.mts stats`                            |
| **Champs nullable, tous contrats**                             |            **468** | `derive.mts stats`                            |
| Racines de sortie dérivées                                     | 119 (118 résolues) | §1.2 étape 2                                  |
| **Champs nullable de SORTIE — le périmètre de cet inventaire** |            **411** | `derive-sortie.mts stats`                     |
| — dont `.nullable()`                                           |                408 |                                               |
| — dont `z.null()` pur                                          |                  3 |                                               |
| Schémas-objets porteurs distincts                              |                102 |                                               |
| **Noms de champ distincts**                                    |            **258** |                                               |

La 119ᵉ racine non résolue est l'identifiant littéral `schema`, capté par le motif de l'étape 2
sur des appels de la forme `schema.parse(...)` où `schema` est une variable locale. Faux positif
de mon extraction, pas un contrat manquant.

Les 3 `z.null()` purs sont un **bon** patron, pas un défaut : le champ vaut toujours `null` et
un champ voisin **dit pourquoi**.

- `palmares.ts:schemaLigneClassementProduit.margeParMinuteCuissonCents` +
  `raisonMargeParMinuteCuissonIndisponible: z.string()`
- `palmares.ts:schemaLigneClassementFournisseur.delaiLivraisonJours`
- `palmares.ts:schemaLigneClassementFournisseur.qualiteProduitScore`

---

## 3. Le classement

Sur les **258 noms distincts** :

| Catégorie                            | Nombre | Ce que c'est                               |
| ------------------------------------ | -----: | ------------------------------------------ |
| Testé pour `null` à l'affichage      |    125 | ternaire, `=== null`, `?? '…'` textuel     |
| Passe par `ouTiret` / `TIRET_ABSENT` |     89 | conforme par le helper                     |
| **Affiché sur aucune surface**       | **19** | §3.4 — pas un mensonge, une autre question |
| Reste à examiner à la main           |     13 | §3.3 — tous innocentés, voir le détail     |
| Croise une retombée sur `0`          |     12 | §3.2 et §3.3                               |

**Attention à la lecture de ces cinq lignes** : le classement est automatique et se fait par
**nom de champ**. Il oriente, il ne conclut pas. Ce sont les §3.2 à §3.4 qui concluent, à la
main, avec preuve. Voir §5 pour ce que le classement par nom rate.

### 3.1 Ce qui est conforme, et pourquoi ça compte de le dire

214 noms sur 258 (les deux premières lignes) sont conformes. Le dépôt tient sa règle très
largement. `ouTiret` (`packages/core/src/affichage.ts:32`) est correctement utilisé, et son
commentaire porte la distinction exacte :

> `0,00` est une valeur ; une valeur absente s'écrit `—`. Un stock à zéro et un stock jamais
> inventorié ne sont pas la même information — pour l'AFSCA, c'est même une distinction qui compte.

Vérification faite que la présence de `ouTiret` n'est pas décorative : sur les 89, aucun ne
reçoit un argument déjà rattrapé par `?? 0` en amont (recherche croisée du nom du champ avec
les 79 retombées sur 0 du §1.4).

### 3.2 Les défauts

**Trois défauts réels.** Chacun avec sa preuve, son atteignabilité mesurée, et ce que le porteur
lit de faux.

---

#### D-1 · « Une rupture coûte 0,00 € de marge, un invendu 0,00 € de pâte »

**Où** : `apps/web/src/pages/ProchaineSession.tsx:1019-1020` et, en doublon, la narration du
moteur `packages/core/src/prevision/moteur.ts:608-610`.

```tsx
Une rupture coûte {formaterEuros(couts.coutRuptureCents)} de marge, un invendu{' '}
{formaterEuros(couts.coutInvenduCents)} de pâte. On produit donc au niveau qui couvre{' '}
{formaterPourcent(prevision.quantileCibleBp)} des cas, <strong>pas 50 %</strong>.
```

**La chaîne complète.** `packages/db/src/depots/previsions.ts:635-636` pose deux sentinelles :

```ts
const coutInvenduCents = matiere.cents ?? 0;
const prixMoyenCrepeCents = prix.cents ?? 0;
```

Le commentaire juste au-dessus est **explicite et juste** : ce sont des sentinelles, et deux
drapeaux les accompagnent pour que l'appelant ne s'y trompe pas —
`coutInvenduConnu: matiere.cents !== null` (ligne 658) et `prixMoyenConnu` (ligne 660).

**Deux routes lisent ces drapeaux et font ce qu'il faut** :

- `apps/api/src/routes/lieux-rentabilite.ts:122-123` :
  `coutMatiereCrepeCents: couts.coutInvenduConnu ? couts.coutInvenduCents : null`
- `apps/api/src/routes/opportunites.ts:309` : même patron.

**La troisième ne les lit pas.** Le contrat de prévision,
`packages/core/src/contrats/previsions.ts:150-154`, déclare :

```ts
couts: z.object({
  coutRuptureCents: z.int(),      // NON nullable
  coutInvenduCents: z.int(),      // NON nullable
  origine: z.string(),
}),
```

Ni `coutInvenduConnu` ni `prixMoyenConnu` n'y figurent. Vérifié : **ces deux identifiants
n'apparaissent nulle part dans `apps/web`** (`grep -rn` sur `apps/web/src` : zéro occurrence).
La sentinelle traverse la frontière HTTP déguisée en mesure.

**Atteignabilité, tranchée et non supposée.** Il existe un garde-fou partiel,
`apps/api/src/routes/previsions.ts:430` :

```ts
if (couts.coutRuptureCents <= 0) { throw new ErreurMetier('couts_indisponibles', …); }
```

Comme `coutRuptureCents = max(0, prixMoyen − coutInvendu)` :

- prix **inconnu** → `coutRuptureCents` vaut 0 → la route refuse en 422. **Protégé.**
- prix **connu**, coût matière **inconnu** → `coutRuptureCents = prixMoyen > 0` → **aucun garde-fou**,
  et l'écran imprime « un invendu **0,00 €** de pâte ».

Ce second état est celui d'une installation où des produits ont un prix de vente mais où aucune
recette n'a encore de coût connu (aucun conditionnement actif avec prix) — le **démarrage à
froid**, précisément le moment où le porteur ne peut pas recouper le chiffre.

**Ce que ça lui fait croire.** Que surproduire ne lui coûte rien. Et pire : la phrase est
_causale_ — « On produit **donc** au niveau qui couvre X % des cas ». Or dans cet état, le
pourcentage ne vient **pas** de ces deux coûts : `ratioCritique`
(`packages/core/src/prevision/statistiques.ts:244`) rend `null` dès qu'un coût est ≤ 0, et le
moteur retombe sur le paramètre `quantile_cible_production_bp`. **Le chiffre est faux et le lien
de cause qu'on lui attribue l'est aussi.**

À décharge : la quantité produite, elle, n'est pas corrompue — `ratioCritique` protège le calcul
(D-034). Le défaut est dans la narration, mais c'est la narration du calcul le plus important de
l'application, et `statistiques.ts:225` le dit lui-même : « C'est LE calcul le plus rentable du
projet ».

---

#### D-2 · Un tarif d'emplacement inconnu pré-rempli à `0,00`

**Où** : `apps/web/src/pages/Sessions.tsx:2517-2521`.

```ts
const emplacementDefautCents =
  detail.fraisEmplacementCents > 0
    ? detail.fraisEmplacementCents
    : (defautsLieu?.tarifEmplacementCents ?? 0);
setFraisEmplacementSaisie(formaterMontant(emplacementDefautCents));
```

`lieu_marche.tarif_emplacement_cents` est nullable et signifie « tarif jamais renseigné ». Le
formulaire de clôture affiche alors **`0,00`** dans le champ « frais d'emplacement ».

**Ce qui rend ce cas indiscutable : la même fonction, 25 lignes plus bas, fait l'inverse** pour
le champ voisin, et explique pourquoi (`Sessions.tsx:2536-2538`) :

> Laissé **VIDE (jamais 0)** quand cette distance est inconnue : un 0 ferait croire à une session
> sans déplacement, donc gratuite en carburant et en usure.

Le raisonnement est écrit, admis, appliqué au kilométrage — et pas au tarif d'emplacement, qui
est pourtant un décaissement direct.

**Atteignabilité, mesurée sur sa base** (lecture seule) :

```
lieux : [{ nom: "La Batte", distance_km: null, tarif_emplacement_cents: null, … }]
```

**Son unique lieu n'a pas de tarif.** Le repli sur `0` se déclenche donc sur **100 %** de ses
clôtures.

**Et il a déjà produit une ligne à zéro** :

```
SM-2026-0002  frais_emplacement_cents = 0      marge_nette_cents = 51454
SM-2026-0003  frais_emplacement_cents = 2200   marge_nette_cents =  7329
```

Même lieu, deux valeurs. **Nuance honnête, et elle est importante** : `SM-2026-0002` est une
session de **démonstration**, et sa propre note qualitative le dit déjà —

> « Le frais d'emplacement est à zéro parce que le tarif de La Batte n'est pas documenté :
> renseignez-le avant votre première vraie session, sinon la marge nette est surévaluée. »

Sur la session non-démo (`SM-2026-0003`), le porteur a **écrasé le 0 lui-même** en tapant 22,00.
Le défaut n'a donc corrompu aucune donnée réelle **à ce jour**. Ce qu'il coûte est un risque, pas
une perte constatée : la semaine où il tabule sans regarder, la session part avec un emplacement
gratuit, la marge nette est surévaluée d'environ 22 €, et rien ne le signale.

---

#### D-3 · Le coût matière **réel** d'une production : calculé, facturé, affiché nulle part

**Où** : `packages/core/src/contrats/productions.ts:191`
(`coutMatiereReelCents: z.int().nullable()`), présent dans `schemaProductionDetail` **et**
`schemaProductionResume`.

C'est l'exemple nommé de `docs/39` §7 — et il n'est refermé **qu'à moitié**.

**Ce qui a été réparé** : la route sert désormais le champ.
`packages/db/src/depots/productions.ts:325` le fournit, `apps/api/src/routes/productions.ts:132`
le parse — `GET /productions/:id` le renvoie donc bien.

**Ce qui ne l'est pas** : recherche du nom sur les trois surfaces du §1.3 → **zéro occurrence**.
Il n'est ni à l'écran, ni sur un PDF, ni dans un classeur.

Ce que l'écran affiche à la place, `apps/web/src/pages/Production.tsx:1718` :

```tsx
formaterMontant(detailCourant.coutMatiereTheoriqueCents)} de matière (théorique)
```

Le libellé est honnête — il dit « (théorique) ». Mais le commentaire qui l'accompagne
(lignes 1713-1717) affirme corriger le fait que « le coût matière **réel** d'une fournée n'était
visible NULLE PART dans cet écran », et **il affiche le théorique**. Le correctif ne fait pas ce
que son commentaire dit.

**Pendant ce temps, la comptabilité utilise le réel** : `packages/db/src/services/sessions.ts:988`
lit `coutReel: production.coutMatiereReelCents` à la clôture, donc le réel entre dans la marge du
marché.

**Atteignabilité, mesurée** : ses deux productions ont un coût réel saisi
(`SELECT statut, COUNT(*), SUM(cout_matiere_reel_cents IS NULL) FROM production GROUP BY statut`
→ `terminee, 2, 0`). La divergence est donc **active aujourd'hui** : il lit un coût théorique
pendant que sa marge est calculée sur un réel qu'aucun écran ne lui montre.

Deux champs de la même famille sont dans le même état, sur aucune surface :
`schemaConsommationProduction.coutReelCents` et
`schemaConsommationProduction.quantiteReelleMouvementee`
(`packages/core/src/contrats/productions.ts`).

### 3.3 Les `?? 0` **légitimes** — et la raison de chacun

Un inventaire qui classe tout en défaut ne vaut rien. Voici les 27 croisements écartés, avec le
motif. Trois motifs seulement, ceux du §4 de `docs/39`.

**(a) Le `0` est la VRAIE valeur mesurée** — `stable`, pas `inconnu`.

| Emplacement                                                                           | Pourquoi c'est un vrai zéro                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/pages/Sessions.tsx:813,830` — `nbCrepesParUnite: produit.nbCrepes ?? 0` | `verifierCoherenceProduit` (`contrats/referentiel.ts:528,579`) **impose** `nbCrepes = null` pour un revendu et pour un menu. Un pot de sirop consomme réellement 0 crêpe.     |
| `apps/web/src/pages/Sessions.tsx:2279` — `fondsCaisseInitialCents: fondsValeur ?? 0`  | Un fonds de caisse à zéro est une situation réelle ; le commentaire lignes 2264-2271 le distingue explicitement des trois champs voisins qui, eux, ne sont **pas** rattrapés. |
| `apps/web/src/pages/Ingredients.tsx:250` — `stockSecurite: … ?? 0`                    | Documenté ligne 238 : contrairement à `delaiLivraisonJours`, « pas de stock de sécurité » vaut bien 0.                                                                        |
| `packages/db/src/depots/sessions.ts:358` — `(s.commissionCarteCents ?? 0)`            | Commission nulle = aucun encaissement carte. Et la garde principale du calcul est ailleurs : `coutMatiereTransformeCents === null → null`.                                    |
| `packages/core/src/economies.ts:164-165`                                              | Échec de `Map.get` sur un type d'action absent : « aucune action de ce type », pas « montant inconnu ».                                                                       |
| `packages/core/src/palmares.ts:181-182,540,542`                                       | Idem — agrégat absent = zéro action comptée.                                                                                                                                  |

**(b) Le `null` est rattrapé EN AMONT, le total est correctement `null`.** La règle de `docs/39`
§4 exige alors de **vérifier qu'aucun écran n'affiche le composant seul**. Vérification faite —
et cette fois sur les **trois** surfaces, non sur `apps/web` seul comme la fois précédente.

`packages/core/src/recettes.ts:547-551` :

```ts
const coutPateCents  = … : produit.coutParCrepeCents === null ? 0 : …
const coutAchatCents = produit.coutAchatUniteCents === null ? 0 : …
```

…mais le total est juste (`recettes.ts:576-578`) :

```ts
coutMatiereCents: basePateManquante || baseAchatManquante || coutGarnituresCents === null
  ? null
  : coutPateCents + coutAchatCents + coutGarnituresCents,
```

Recherche des quatre composants sur écrans + documents :

| Champ                 | Occurrences sur une surface visible |
| --------------------- | ----------------------------------: |
| `coutPateCents`       |                                   0 |
| `coutAchatCents`      |                                   0 |
| `coutGarnituresCents` |                                   0 |
| `coutComposantsCents` |                                   0 |

**Aucun composant n'est affiché seul.** Le mensonge n'atteint pas le porteur. Conforme.

Même famille, même verdict :
`apps/api/src/routes/opportunites.ts:360` (`coutConnuPourTri`) — le `?? 0` sert **uniquement de
clé de tri**, la garde `if (les deux sont null) return null` est présente, et la ligne rendue
conserve ses deux `null` ; et `packages/core/src/menus.ts:180`, où la branche n'est atteinte que
si `indicesLibres.length === 0`, c'est-à-dire quand **aucun** `prixForceCents` n'est nul — le
`?? 0` y est un affinage de type, pas un repli.

**(c) Le cas rattrapé n'est produit par aucun chemin de production**, et la garde est prouvée.

`apps/api/src/documents/donnees.ts:513-523` — onze `?? 0` d'un coup, sur le rapport PDF de
session. Chaîne vérifiée dans les trois sens :

1. **La route refuse** : `apps/api/src/routes/documents.ts:210-216` lève une `ErreurMetier` si le
   statut n'est pas `cloturee`.
2. **Le chemin d'écriture remplit toujours** : `packages/db/src/services/sessions.ts:1546-1576`
   écrit `caTotalCents`, `coutMatiereCents`, `commissionCarteCents`… en entiers à chaque clôture ;
   et `especesCompteesCents` / `caCarteCents` sont **requis** à la clôture
   (`contrats/sessions.ts:193-194`), donc `ecartCaisseCents` ne peut pas être `null` après clôture.
3. **Mesuré sur sa base** : sur 2 sessions closes, **0 valeur nulle** sur les six colonnes
   concernées.

Réserve à noter quand même : **la garde (`routes/documents.ts`) et le repli (`documents/donnees.ts`)
vivent dans deux fichiers différents.** Rien dans `donnees.ts` n'empêche un futur appelant de
contourner la garde. La fonction reste correcte, sa sûreté est extrinsèque.

Deux voisins du même bloc **transmettent bien le `null` tel quel**, avec un commentaire modèle
(`donnees.ts:529-537`) : `tauxEcoulementBp` et `margeParHeureCents`. Et le classeur Excel est
irréprochable — `apps/api/src/documents/excel.ts:96-98` :

```ts
function centimesEnEuros(centimes: number | null | undefined): number | null {
  return centimes === null || centimes === undefined ? null : centimes / 100;
}
```

`null` → cellule **vide**, jamais `0`. C'est le bon patron.

Enfin, même verdict pour :
`packages/db/src/depots/comptabilite.ts:1617` (le service de réception calcule toujours le
montant, `services/reception.ts:205-214` ; mesuré : 0 nul sur 8 réceptions actives) ;
`packages/db/src/depots/objectifs.ts:141,143,530,621-622` et
`packages/db/src/depots/economies.ts:308` (toutes filtrées sur `statut = 'cloturee'`, où les
colonnes sont toujours écrites ; mesuré : 0 nul) ;
`packages/db/src/depots/evenements-decouverte.ts:320` (documenté : ne joue que pour une ligne au
vieux format) ; `packages/db/src/services/production.ts:605` (le `?? 0` sert à la **décomposition
arithmétique** seule, et le texte affiché juste en dessous, ligne 615, distingue explicitement
« coût inconnu » d'un montant) ; les deux `seed/*` (scripts de peuplement, aucune surface).

### 3.4 Affichés nulle part — 19 champs

Ce n'est pas un mensonge. C'est l'autre question : **un chiffre calculé que personne ne voit.**
`docs/39` §6 : « zéro appelant est une question, pas une conclusion » — quatre issues possibles,
et il faut dire laquelle.

Méthode : recherche du nom sur les trois surfaces du §1.3, **puis** vérification qu'il n'y passe
pas sous un autre nom (destructuration, renommage, `spread`) en cherchant le radical du champ
dans tout le dépôt hors tests.

| Champ                                                       | Schéma porteur                 | Issue                                                                                              |
| ----------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `coutMatiereReelCents`                                      | `productions.ts` (×2)          | **capacité à brancher** → D-3                                                                      |
| `coutReelCents`                                             | `schemaConsommationProduction` | idem D-3                                                                                           |
| `quantiteReelleMouvementee`                                 | `schemaConsommationProduction` | idem D-3                                                                                           |
| `coutMatiereReelNonAffecteCents`                            | `schemaProductionDetail`       | idem D-3                                                                                           |
| `coutGarnituresCents`, `coutComposantsCents`                | `schemaCoutProduitVendu`       | **garde-fou de cohérence** — leur absence d'affichage est ce qui rend §3.3(b) valide. À conserver. |
| `margeParMinuteCuissonCents`, `qualiteProduitScore`         | `palmares.ts`                  | `z.null()` pur, **accompagnés de leur raison** — le patron correct, rien à faire                   |
| `prixMoyenParArticleCents`                                  | `sessions.ts` (×2)             | capacité à brancher (à ne pas confondre avec le panier moyen, qui l'est)                           |
| `codeMeteo`, `temperatureRessentieC`                        | `schemaMeteoSessionReleve`     | météo **figée** à la clôture ; lue par `routes/previsions.ts`, jamais montrée                      |
| `rayonRechercheKm`                                          | `schemaPropositionEvenement`   | capacité à brancher                                                                                |
| `recetteLibelle`, `ingredientLimitant`                      |                                | capacité à brancher                                                                                |
| `dateCession`, `dateFinValidite`, `dateDerniereObservation` |                                | capacité à brancher                                                                                |
| `annuleParId`, `dateReceptionPrevue`                        |                                | briques internes, lues côté serveur (`routes/stock.ts`, `routes/commandes.ts`)                     |

**Aucun n'est un mort-né à retirer.** Et l'avertissement de `docs/39` §6 s'applique en plein :
une fonction a déjà failli être supprimée à tort parce qu'elle paraissait doublon alors qu'elle
portait le seul champ permettant un **rappel sanitaire**. Rien de cette liste ne doit être
retiré sans porter d'abord ce qui manque ailleurs.

---

## 4. Les trois qui coûtent le plus

**1. `ProchaineSession.tsx:1019` — « un invendu 0,00 € de pâte ».**
Ce qu'il lit de faux : que jeter de la pâte ne lui coûte rien. Ce que ça lui fait croire : que la
surproduction est sans risque — et la phrase le lui présente comme **la raison** du volume
recommandé, alors que ce pourcentage vient en réalité d'un paramètre de repli. C'est le premier
parce que c'est le seul où l'application **enseigne** une économie fausse, sur le calcul que
`docs/03` désigne comme le plus rentable du projet. Et c'est le moins cher à réparer : les deux
drapeaux (`coutInvenduConnu`, `prixMoyenConnu`) existent déjà, sont déjà testés
(`packages/db/src/depots/previsions.test.ts:1200-1238`), et sont déjà correctement consommés par
deux autres routes. Il manque leur passage dans `contrats/previsions.ts:150-154`.

**2. `Sessions.tsx:2520` — le tarif d'emplacement pré-rempli à `0,00`.**
Ce qu'il lit de faux : que son emplacement est gratuit. Ce que ça lui fait croire : une marge
nette surévaluée d'environ 22 € par session, et un CA/marge faussé dans les compteurs de seuils
légaux qui en découlent. Deuxième et non premier parce que c'est un champ **éditable** qu'il a
déjà écrasé une fois de lui-même — mais il se déclenche sur **100 %** de ses lieux, et le remède
est écrit noir sur blanc 25 lignes plus bas, appliqué au champ voisin.

**3. `coutMatiereReelCents` — servi, facturé, affiché nulle part.**
Ce qu'il lit de faux : rien, littéralement — et c'est le problème. Il lit un coût **théorique**
correctement étiqueté, pendant que sa marge de marché est calculée sur un coût **réel** qu'aucun
écran ne lui montre. Il ne peut donc jamais vérifier l'écart théorique/réel, qui est une des cinq
raisons d'être de l'application (`CLAUDE.md` §1). Le défaut est nommé dans `docs/39` §7 depuis
sa découverte ; la moitié route a été refermée, la moitié écran ne l'a pas été.

---

## 5. Trois choses vues en passant, hors périmètre

**5.1 — Une mutation de test aperçue en vol, puis restaurée. Aucune action requise.**
À **15:26 le 01/08/2026**, `packages/db/src/depots/productions.ts:248` contenait :

```ts
const reelSaisi = true; // MUTATION 5
```

au lieu de `const reelSaisi = p.coutMatiereReelCents !== null;`. Relecture en fin de mission :
**la ligne d'origine est revenue**. C'était bien une mutation en cours d'un agent parallèle —
`docs/39` §3 fait de la mutation la seule preuve valable qu'un test peut échouer. Je n'y ai pas
touché (lecture seule, zones disjointes).

Consigné non comme un défaut mais comme un **fait de méthode** : pendant une mission multi-agents,
un fichier lu à un instant `t` peut porter une mutation volontaire, et un audit qui la prendrait
pour du code livré signalerait un faux défaut. Le contrôle qui tranche est
`grep -rn "MUTATION" packages apps --include=*.ts --include=*.tsx` — il doit rendre **zéro**
avant tout commit.

**5.2 — `prixMoyenParCrepe` mélange les transformés à `nb_crepes = 0`.**
`packages/db/src/depots/previsions.ts:585-593` filtre sur `nature = 'transforme'` et divise le
CA par les crêpes. Depuis D-085, un transformé peut légitimement avoir `nb_crepes = 0` (un café,
une pâte vendue au volume) : son **chiffre d'affaires entre au numérateur** sans que ses crêpes
entrent au dénominateur. Le prix moyen par crêpe en ressort surévalué. Sa base contient déjà un
tel produit (`transforme, nb_crepes = 0, n = 1`), mais il n'a aucune vente enregistrée — donc
pas d'effet aujourd'hui. Ce n'est pas un « inconnu contre 0 » : c'est un **vrai zéro mal
consommé**, le symétrique exact de ce que ce document traque. Le `COALESCE(nb_crepes, 1)` de la
ligne 588 est, lui, du code mort : la validation interdit `nbCrepes = null` sur un transformé.

**5.3 — `mesureCoutVehicule` : deux côtés d'un ratio qui ne couvrent pas les mêmes trajets.**
`packages/db/src/depots/lieux-rentabilite.ts:123-126` exclut du kilométrage les sessions dont le
lieu n'a pas de distance (`s.distanceKm === null ? 0 : …`), ce que le commentaire assume
(« jamais une distance devinée »). Mais `mesureCarburant` ne filtre **pas** symétriquement : tout
le carburant reste au numérateur. Un lieu sans distance ferait donc monter le coût au kilomètre.
Aujourd'hui inoffensif — son unique lieu n'a pas de distance, donc `totalKmParcourus = 0`, et la
garde `entrees.mesure.totalKmParcourus > 0` (`packages/core/src/deplacement.ts:496`) bascule en
mode barème. **Le jour où il ajoute un second lieu avec une distance**, le ratio devient faux
sans que rien ne le signale.

---

## 6. Ce que cet inventaire ne prouve pas

**Il ne prouve pas que 411 est le bon dénominateur.** Le périmètre « schéma de sortie » est
dérivé de deux motifs `grep` (§1.2 étape 2). Un schéma renvoyé sans `.parse()`, ou parsé via une
variable intermédiaire (`const s = schemaX; s.parse(...)`), est invisible de ces motifs. J'ai
contrôlé qu'il n'existe ni `setSerializerCompiler` ni bloc `response:` Fastify dans
`apps/api/src` — donc `.parse()` en position de retour est bien l'unique mécanisme de sortie du
dépôt — mais je n'ai pas prouvé l'exhaustivité des deux motifs eux-mêmes. Écart mesuré entre
« tous contrats » (468) et « sortie » (411) : 57 champs, que j'ai supposés être des entrées sans
les vérifier un par un.

**Le classement automatique du §3 est fait par NOM de champ, et le nom est ambigu 81 fois sur 258.** Mesuré :

```
Noms nullable de sortie           : 258
Noms AMBIGUS (aussi non-nullable) :  81
```

Exemple attrapé : `couvertureNuageuseBp` est `.nullable()` dans
`contrats/sessions.ts:317` (météo figée d'une session close) et `z.int()` dans
`contrats/previsions.ts:13` (météo à venir). L'écran `ProchaineSession.tsx:1125` lit **le
second**, non nullable — mon balayage l'avait signalé à tort. J'ai relu à la main les 13
« à examiner » et les 12 « suspects », donc les faux **positifs** sont écartés. **Les faux
négatifs ne le sont pas** : si un champ nullable partage son nom avec un champ non-nullable
correctement affiché ailleurs, mon classement a pu le ranger en « conforme » sur la mauvaise
preuve. C'est la faiblesse principale de cette mesure, et elle porte sur ces 81 noms.

**Il ne prouve rien sur les indirections.** Un champ passé en `prop` à un composant partagé, ou
étalé par `{...ligne}`, ne porte plus son nom au point de rendu. J'ai contré ce risque sur les
cas à conséquence (les quatre composants de coût du §3.3(b), les quatre champs de D-3) en
cherchant le **radical** dans tout le dépôt hors tests, pas seulement le nom exact. Je ne l'ai
**pas** fait pour les 214 champs classés conformes.

**Il ne prouve pas l'absence d'autres formes de mensonge.** J'ai couvert `?? 0`, `|| 0`, les
ternaires `=== null ? 0`, et `COALESCE(...)` en SQL. **Non couverts** : les coercitions
implicites (`Number(null)`, `+null`, concaténation dans un littéral de gabarit), un `.default(0)`
Zod posé sur un champ nullable, et un dépôt qui écrirait un `0` calculé là où le contrat promet
`null` — cette dernière forme n'est détectable que fonction par fonction, et je ne l'ai faite que
sur les chemins des trois défauts et des 27 innocentements.

**Trois `?? 0` sont innocentés par un argument d'atteignabilité, pas par leur code.**
`documents/donnees.ts:513-523`, `depots/objectifs.ts` et `depots/comptabilite.ts:1617` sont
corrects **parce qu'un autre fichier garantit que le cas ne survient pas**. Aucun test ne
verrouille ce couplage. Si la garde de `routes/documents.ts:210` disparaît, onze `0,00 €`
apparaissent sur un PDF sans qu'aucun rouge ne se lève.

**La mesure sur la base réelle porte sur 2 sessions closes, 8 réceptions et 1 lieu.** C'est ce
qui existe ; c'est aussi très peu. « 0 valeur nulle sur 2 lignes » ne prouve pas une invariance,
seulement que le défaut n'est pas déjà présent. Et une partie de ces données est de la
**démonstration** (`docs/…/donnees-fictives-dans-la-base-reelle`) : la seule session à
`frais_emplacement_cents = 0` en fait partie, ce qui affaiblit délibérément la démonstration
de D-2 telle que je la présente au §3.2.

**Enfin, ce document n'a rien corrigé.** Six agents écrivaient en parallèle ; deux fichiers de
contrat ont changé pendant la mesure. Les trois défauts, la mutation du §5.1 et les deux points
du §5.2-5.3 sont **notés, pas réparés** — et l'empreinte de l'en-tête est ce qui permet de savoir
si l'état mesuré est encore celui du dépôt.
