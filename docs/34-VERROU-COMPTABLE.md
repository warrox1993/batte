# 34 — Le verrou comptable (`periode.statut = 'verrouillee'`) : préparer la décision du porteur

> ## ⚠ PÉRIMÉ SUR SON POINT CENTRAL — corrigé le 01/08/2026
>
> **Ce document affirme partout qu'aucun chemin de production n'écrit `'verrouillee'`. C'est FAUX
> depuis qu'un bouton existe.** La chaîne est complète et vérifiée :
> `verrouillerPeriode` (`packages/db/src/depots/comptabilite.ts`) →
> `POST /periodes/:id/verrouiller` (`apps/api/src/routes/comptabilite.ts`) →
> bouton « Verrouiller… » dans `apps/web/src/pages/Comptabilite.tsx`.
>
> **Ce que cette erreur a coûté** : l'affirmation a servi, le 01/08, à écarter un avertissement
> avant action irréversible — au motif qu'on bâtirait un écran pour un état inatteignable. Le
> porteur pouvait donc verrouiller une période d'un clic, puis se heurter des semaines plus tard à
> un refus d'annulation **définitif**, sans avoir jamais été prévenu. L'avertissement existe
> désormais (recopie exacte du libellé du mois, impact chiffré chargé avant d'offrir le bouton).
>
> **La leçon, plus large que ce document** : une affirmation d'**absence** lue dans un document doit
> être **revérifiée dans le code** avant de servir d'argument pour refuser du travail. C'est D-045
> appliqué à la documentation elle-même. Voir `docs/39-DOCTRINE-DES-AGENTS.md` §14.
>
> **Ce qui reste VALABLE ci-dessous** : l'inventaire des points d'appel de la garde, l'analyse des
> conséquences, et les trois issues posées pour le porteur. Seul le constat « personne ne l'écrit »
> est mort. Le paragraphe d'origine est conservé tel quel — c'est un document daté, pas une charte.

> Ce document ne tranche rien. Il établit, à partir du code réellement lu (pas supposé), le coût et
> les conséquences de trois issues possibles pour un état qui existe dans le schéma, dans le type,
> dans le contrat Zod, et dans deux gardes qui le lisent — mais qu'aucun chemin de production
> n'écrit. La décision revient au porteur (CLAUDE.md §9 : « en cas d'ambiguïté dans la spec, poser
> la question, ne pas deviner » — ici l'ambiguïté n'est pas dans la spec, elle est dans ce que le
> porteur veut faire de code déjà écrit).

---

## 1. Le constat vérifié, pas supposé

`packages/db/src/schema.ts:1913` déclare la colonne :

```ts
statut: text('statut', { enum: ['ouverte', 'cloturee', 'verrouillee'] }).notNull().default('ouverte'),
```

Trois états. Deux d'entre eux sont écrits par du code de production :

- `'ouverte'` — valeur par défaut, et valeur écrite par `rouvrirPeriode`
  (`packages/db/src/depots/comptabilite.ts:1161-1226`).
- `'cloturee'` — écrite par `cloturerPeriode` (`comptabilite.ts:1066-1151`), exposée par
  `POST /api/periodes/cloturer` (`apps/api/src/routes/comptabilite.ts:243`) et par le bouton
  « Clôturer {mois} » de `Comptabilite.tsx:2179`.

Le troisième, `'verrouillee'`, **n'est écrit par aucune de ces deux fonctions, ni par aucune autre
fonction exportée de `packages/db`.** Vérifié par grep exhaustif de `statut:\s*'verrouillee'` sur
tout `packages/db/src` : les deux seules occurrences sont la déclaration du type et deux
comparaisons de LECTURE (voir §1.2). Les seuls endroits qui **écrivent** cette valeur sont des
fixtures directes (`base.insert(periode).values({ statut: 'verrouillee', ... })`) dans **6 fichiers
de test**, jamais dans un chemin appelable depuis une route HTTP ou un écran.

### 1.1 — Le type et le contrat Zod existent, cohérents avec le schéma

- `packages/db/src/depots/comptabilite.ts:966` — `export type StatutPeriode = 'ouverte' | 'cloturee' | 'verrouillee';`
- `packages/core/src/contrats/comptabilite.ts:207` — `export const schemaStatutPeriode = z.enum(['ouverte', 'cloturee', 'verrouillee']);`
- `apps/web/src/pages/Comptabilite.tsx:765` — la table de libellés d'affichage porte déjà
  `verrouillee: 'Verrouillée'` : l'écran sait afficher cet état s'il survient un jour, mais rien ne
  peut le lui faire atteindre.

### 1.2 — Les deux gardes qui LISENT le verrou, jamais ne l'écrivent

1. **`verifierPeriodeNonVerrouillee`** (`comptabilite.ts:1040-1057`) — lève `ErreurMetier
('periode_verrouillee', …)` si `periode.statut === 'verrouillee'` pour l'année/mois d'une date
   d'écriture donnée. Grep exhaustif de ses appels réels (hors définition, hors tests) :
   **13 sites d'appel**, dans 5 fichiers :

   | Fichier                       | Fonctions appelantes                                                                                                                           |
   | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
   | `depots/comptabilite.ts` (×3) | `enregistrerDepense`, `annulerDepense`, `enregistrerImmobilisation`                                                                            |
   | `services/mouvements.ts` (×3) | `enregistrerSortie` (l.87), `contrepasserMouvement` (l.210, partagé par `annulerMouvement` ET `annulerProduction`), `changerStatutLot` (l.450) |
   | `services/production.ts` (×3) | `lancerProduction`, `saisirRealise`, `annulerProduction`                                                                                       |
   | `services/reception.ts` (×2)  | `enregistrerReception`, `annulerReception`                                                                                                     |
   | `services/sessions.ts` (×2)   | `cloturerSession`, `annulerSession`                                                                                                            |

   Ce chiffre (13) confirme et actualise `docs/20-ETAT-DES-LIEUX.md` §4, déjà à jour au 30/07/2026.

2. **Le garde-fou interne de `rouvrirPeriode`** (`comptabilite.ts:1183-1188`) —
   `if (existante.statut === 'verrouillee') throw new ErreurMetier('periode_verrouillee', …)` :
   une période verrouillée ne peut pas non plus être rouverte. C'est la deuxième moitié du même
   principe (« point de non-retour »), codée séparément de la première.

**Conséquence exacte** : une période « clôturée » aujourd'hui (`'cloturee'`) ne bloque **aucune**
des 13 écritures ci-dessus — seule `'verrouillee'` le fait, et rien ne peut y mener une période.
Le garde-fou est juste ; il ne peut jamais se déclencher en usage réel.

### 1.3 — Vérifié dans la vraie base SQLite, pas seulement dans le schéma Drizzle

`packages/db/drizzle/0006_icy_captain_universe.sql` (la migration qui crée la table) :

```sql
CREATE TABLE `periode` (
	`id` text PRIMARY KEY NOT NULL,
	`annee` integer NOT NULL,
	`mois` integer NOT NULL,
	`statut` text DEFAULT 'ouverte' NOT NULL,
	...
);
```

**Aucun `CHECK` SQL** sur `statut` — la colonne est un `text NOT NULL` nu. L'énumération
`{ enum: [...] }` de Drizzle est une contrainte **TypeScript uniquement**, jamais appliquée par
SQLite lui-même (confirmé ici, pas seulement supposé par analogie avec un autre retrait). C'est le
fait central qui rend l'Option B (§3) réalisable **sans migration** : SQLite acceptera toujours
n'importe quelle chaîne dans cette colonne, avant comme après un changement du type TypeScript.

---

## 2. Option A — Câbler le geste « transmettre au comptable »

### Ce qu'il faudrait écrire

- **Une fonction de dépôt**, symétrique à `cloturerPeriode`/`rouvrirPeriode`
  (`packages/db/src/depots/comptabilite.ts`) : par exemple `verrouillerPeriode(base, periodeId,
clotureePar?)`. Refuse une période déjà `'verrouillee'` (même patron que
  `periode_deja_cloturee`), refuse probablement une période encore `'ouverte'` (le verrou
  définitif ne devrait s'appliquer qu'à un exercice DÉJÀ clôturé — un raccourci direct
  `'ouverte' → 'verrouillee'` sauterait l'étape qui existe pour permettre les corrections
  courantes). Journalise dans `journal_audit`, même geste que les deux fonctions voisines.
- **Une route** `POST /api/periodes/:id/verrouiller` (`apps/api/src/routes/comptabilite.ts`), à
  côté de `/periodes/cloturer` (l.243) et `/periodes/:id/rouvrir` (l.252).
- **Un bouton d'écran** (`apps/web/src/pages/Comptabilite.tsx`) : le libellé d'affichage existe déjà
  (`verrouillee: 'Verrouillée'`, l.765), mais aucun bouton ne mène à cet état — seul `{l.statut ===
'cloturee' && <button>Rouvrir</button>}` existe (l.2282-2296). Il faudrait un second bouton
  conditionné sur `'cloturee'`, avec une confirmation au moins aussi appuyée que celle de
  « Clôturer » (l.1446, qui prévient déjà que la réouverture « exigera un motif et sera tracée ») —
  ici, il n'y a **aucune** réouverture possible à annoncer.

Coût de développement : réduit — le patron existe déjà deux fois dans le même fichier
(`cloturerPeriode`, `rouvrirPeriode`), la route suit le même modèle que ses deux voisines, l'écran
porte déjà le libellé. Il n'y a pas de nouvelle colonne ni de migration à écrire.

### Ce que ça bloquerait exactement, et pour qui

Dès qu'une période est verrouillée, les **13 points d'écriture du §1.2** refusent toute écriture
DATÉE dans cette période — dépenses, immobilisations, mouvements de stock (entrées, sorties,
changements de statut de lot), réceptions, productions, sessions. Concrètement, pour le porteur :

- Une dépense mal datée dans ce mois ne peut plus être **corrigée par contre-passation à sa propre
  date** — mais `annulerDepense` date sa contre-écriture du **jour de l'annulation**
  (`comptabilite.ts:304-311`, commentaire : « c'est exactement le mécanisme d'une note de crédit
  comptable ») : une dépense fautive d'un mois verrouillé reste donc corrigible tant que le mois
  **courant** est lui-même ouvert. Ce mécanisme ne s'applique **qu'aux dépenses**.
- Une réception, une production ou une session de ce mois ne peuvent plus être annulées **du
  tout** — `annulerReception` (`reception.ts:572`), `annulerProduction` (via `contrepasserMouvement`,
  `mouvements.ts:210`) et `annulerSession` (`sessions.ts:1789`) vérifient tous les trois le verrou
  sur la date **d'origine** de l'écriture, jamais sur aujourd'hui. Voir le fait du §4 : c'est
  précisément la différence entre les deux catégories.

Autrement dit : verrouiller un mois fige définitivement son **stock et ses sessions de vente**,
mais laisse encore une porte pour **corriger ses dépenses** via une écriture compensatoire datée du
jour. C'est une asymétrie réelle du code actuel, pas un choix que ce document propose de changer.

---

## 3. Option B — Retirer l'état

### Ce que ça toucherait, chiffré

**Aucune migration SQL** (voir §1.3) : la colonne reste un `text NOT NULL` quelle que soit la
liste TypeScript qui la décrit. Retirer `'verrouillee'` de trois déclarations suffit à faire
disparaître le troisième état du système de types :

1. `packages/db/src/schema.ts:1913` — `enum: ['ouverte', 'cloturee']`.
2. `packages/db/src/depots/comptabilite.ts:966` — `StatutPeriode = 'ouverte' | 'cloturee'`.
3. `packages/core/src/contrats/comptabilite.ts:207` — `schemaStatutPeriode = z.enum(['ouverte', 'cloturee'])`.

**Code mort à retirer en cascade**, une fois ces trois types resserrés à deux valeurs (le
compilateur TypeScript refusera toute comparaison avec une valeur qui n'existe plus dans le type,
donc ce retrait n'est pas optionnel une fois les trois lignes ci-dessus changées) :

- `verifierPeriodeNonVerrouillee` (`comptabilite.ts:1040-1057`, 18 lignes de logique + un
  commentaire de 43 lignes) — son corps entier repose sur `existante.statut !== 'verrouillee'`,
  qui deviendrait une comparaison sans chevauchement de type. Soit la fonction est **supprimée**,
  soit ses **13 sites d'appel** (§1.2) sont retirés un par un — dans les deux cas, 13 lignes
  réparties sur 5 fichiers de service (`comptabilite.ts`, `mouvements.ts`, `production.ts`,
  `reception.ts`, `sessions.ts`) à retirer, chacune accompagnée d'un commentaire qui cite
  aujourd'hui « docs/07 §1.6 » et qu'il faudrait alors soit supprimer soit réécrire.
- Le garde-fou interne de `rouvrirPeriode` (`comptabilite.ts:1183-1188`), même sort.
- `apps/web/src/pages/Comptabilite.tsx:765` — l'entrée `verrouillee: 'Verrouillée'` de la table de
  libellés, qui deviendrait une propriété excédentaire sur un type `Record<StatutPeriode, string>`
  resserré à deux clés (erreur de compilation, pas un simple avertissement).

**Tests à supprimer ou réécrire**, chiffrés par grep exhaustif de la fonction utilitaire
`verrouillerPeriode(...)` (un utilitaire de fixture, dupliqué à l'identique dans chacun de ces
6 fichiers — jamais partagé, chaque fichier porte sa propre copie) :

| Fichier de test                               | Appels à `verrouillerPeriode(...)` |
| --------------------------------------------- | :--------------------------------: |
| `packages/db/src/audit-annulations.test.ts`   |                 3                  |
| `packages/db/src/depots/comptabilite.test.ts` |                 8                  |
| `packages/db/src/services/mouvements.test.ts` |                 4                  |
| `packages/db/src/services/production.test.ts` |                 4                  |
| `packages/db/src/services/reception.test.ts`  |                 3                  |
| `packages/db/src/services/sessions.test.ts`   |                 2                  |
| **Total**                                     |               **24**               |

24 emplacements de fixture, dans 6 fichiers, un nombre **plancher** du nombre de cas de test qui
vérifient aujourd'hui « une période verrouillée refuse cette écriture précise » (plusieurs
emplacements peuvent partager un même `it`, mais aucun `it` ne teste ce comportement sans passer
par cette fixture) — retirer le troisième état rend chacun de ces cas **irréalisable à écrire**
(on ne peut plus construire l'état qu'ils vérifient), pas seulement inutile.

### Risque de migration

**Aucun**, au sens SQL : confirmé au §1.3, la colonne n'a jamais porté de contrainte `CHECK`. Une
base SQLite existante (y compris `donnees/batte.sqlite`, la base réelle du porteur) continuerait de
fonctionner à l'identique après ce retrait : elle ne contient aujourd'hui aucune ligne
`statut = 'verrouillee'` (cet état n'a jamais été atteint que par des fixtures de test sur des
bases `:memory:`), et rien n'empêcherait techniquement une valeur `'verrouillee'` orpheline d'y
survivre si elle existait — mais un tel cas n'existe nulle part dans ce dépôt à ce jour.

---

## 4. Option C — Le laisser inerte, documenté

### Ce qu'il faudrait écrire, et où

Rien dans le code ne change. Ce qui manque aujourd'hui, c'est une trace explicite du fait que cet
état est un **choix délibéré d'inaction**, pas un oubli — pour qu'un futur lecteur (agent ou
porteur, dans six mois) ne perde pas une demi-journée à redécouvrir ce que ce document établit déjà
(exactement le risque que `packages/core/src/comptabilite.ts` documente en tête, cité par
`schema.ts:1000` : « comptable `periode.statut = 'verrouillee'` a coûté une demi-journée » — au
passé, pour un AUTRE défaut ; ne pas laisser celui-ci coûter la même chose une seconde fois).

Trois emplacements, chacun déjà porteur d'un commentaire lié à ce sujet qu'il faudrait compléter,
jamais dupliquer ailleurs :

1. **`packages/db/src/depots/comptabilite.ts`**, sur `verifierPeriodeNonVerrouillee` (au-dessus de
   la ligne 996) : le commentaire actuel explique déjà la distinction `cloturee`/`verrouillee` et
   cite `docs/16-AUDIT-COMPTABILITE.md §6.1` — il manque un renvoi explicite vers CE document
   (`docs/34-VERROU-COMPTABLE.md`) pour qui cherche « pourquoi cet état n'est jamais atteint ».
2. **`docs/05-DECISIONS.md`** (journal des décisions d'architecture, CLAUDE.md §9) : une entrée
   `D-0XX` — contexte (cet état existe, non câblé), options (les trois ci-dessus), choix
   (« aucun pour l'instant, réexaminer si/quand le geste « transmettre au comptable » devient un
   besoin réel »), conséquence (le garde-fou reste un filet prêt à l'emploi, jamais déclenché).
3. **`docs/20-ETAT-DES-LIEUX.md` §4**, déjà à jour et déjà correct sur ce point (mise à jour du
   30/07/2026, citée au §1.2 ci-dessus) : il suffirait d'y ajouter un renvoi vers ce document au
   lieu de laisser la mention « décision produit à prendre par le porteur » sans destination.

Coût : nul en code, quelques paragraphes en documentation. Risque si on ne le fait pas : un futur
agent (ou le porteur lui-même) retombe sur `verifierPeriodeNonVerrouillee`, la croit inopérante
(« aucun test ne la déclenche en usage réel »), et propose de la supprimer sans avoir vu que
`docs/16` §6.1, `docs/20` §4 et ce document en discutent déjà — retravaillant une question déjà
posée, exactement le coût que CLAUDE.md §9 demande d'éviter.

---

## 5. Un fait qui pèse sur le choix, à donner au porteur avant qu'il tranche

`contrepasserMouvement` (`packages/db/src/services/mouvements.ts:182-210`) vérifie le verrou sur la
date du mouvement **d'ORIGINE** (`origine.dateMouvement`, l.210), jamais sur la date de la
contre-passation elle-même. Son commentaire (l.204-209) l'affirme déjà comme si c'était le
comportement actuel :

> « un mouvement de stock dont la date est verrouillée ne se corrige plus DU TOUT dans
> l'application, y compris par contrepassation — "irreversible meme pour un administrateur" »

**Ce commentaire décrit aujourd'hui un comportement inatteignable** : puisqu'aucune période n'est
jamais `'verrouillee'` en usage réel (§1), cette phrase ne s'est encore jamais vérifiée une seule
fois en dehors d'un test. Elle n'est pas fausse — elle est **prématurée**, écrite pour le jour où
elle deviendrait vraie.

**Si l'Option A est choisie**, le jour où le premier verrou est posé sur un mois donné, cette phrase
devient vraie **d'un coup, et rétroactivement** : elle s'applique à tout mouvement déjà écrit dans
ce mois, y compris ceux enregistrés des mois avant que le geste de verrouillage n'existe dans
l'application. Un mouvement de stock qui semblait corrigible (parce que rien, jusque-là, ne le
verrouillait) cesse de l'être sans qu'aucune action n'ait été prise sur CE mouvement précis — c'est
la période qui a changé d'état, pas l'écriture elle-même. Ce n'est PAS un défaut de conception —
ni de ce document, ni du code actuel : c'est la sémantique même d'un « point de non-retour ». Mais c'est un
effet de bord que le porteur doit connaître **avant** de décider de câbler le geste, pas après avoir
verrouillé un premier mois et découvert qu'une correction de stock qu'il pensait encore possible ne
l'est plus.

---

## 6. Ce que ce document ne fait pas

Il ne recommande aucune des trois issues. Les trois sont réalisables ; aucune n'est gratuite ; leurs
coûts ne se comparent pas sur le même axe (développement pour A, suppression de code et de tests
pour B, rien pour C sinon le risque documenté au §4). Le choix dépend de ce que le porteur veut
réellement faire un jour d'un exercice comptable « transmis » — question à laquelle ce document
n'a pas de réponse à donner à sa place.
