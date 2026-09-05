---
description: Audit multi-agents d'un périmètre de changement Batte — chaîne de données, calcul, traçabilité AFSCA, seuils légaux, clavier, sécurité, honnêteté des chiffres — puis verdict GO / NO-GO.
argument-hint: "[fichiers ou dossiers modifiés, ou 'recent' pour les fichiers touchés aujourd'hui]"
allowed-tools: Bash, Read, Grep, Glob, Agent, Skill, TodoWrite
---

Tu audites **ce qui vient d'être modifié** sur **Batte** (ERP mono-utilisateur, crêpes ambulantes,
monorepo `apps/api` · `apps/web` · `packages/core` · `packages/db`) et tu rends un verdict avant
livraison.

Périmètre demandé : `$ARGUMENTS`

**Ce que cette commande couvre, et que les portes déterministes ne voient pas** :
`npm run typecheck`, `npm run test`, `npm run lint` attrapent les types, les tests écrits et le
style. Ils ne voient **ni un calcul faux qui passe ses propres tests, ni une valeur inconnue rendue
`0`, ni un maillon correct branché à rien, ni un écran devenu impraticable au clavier**.

---

## Étape 0 — Le périmètre, et pourquoi il est fragile ici

**Ce dépôt n'a PAS de dépôt git.** `git diff` ne fonctionne pas, et le hook `.husky/pre-push` est
inopérant pour la même raison (mémoire `husky-pre-push-inadapte`). Le périmètre doit donc être
établi autrement, **par ordre de fiabilité décroissante** :

1. **`$ARGUMENTS` liste des fichiers ou dossiers** → c'est le périmètre, tel quel. La meilleure
   option : elle vient de quelqu'un qui sait ce qu'il a changé.
2. **`$ARGUMENTS` vaut `recent`** → dérive-le des dates de modification :
   ```bash
   find apps packages -name node_modules -prune -o -type f \( -name '*.ts' -o -name '*.tsx' \) \
     -newermt "$(date +%Y-%m-%d)" -print
   ```
   **N'écris JAMAIS `-newermt 'today'`** : mesuré le 01/08/2026 sur le Git Bash de ce poste, cette
   forme rend **0 fichier** sans lever la moindre erreur, là où `-newermt "$(date +%Y-%m-%d)"` en
   rend 99 et `-mtime -1` en rend 101. Un périmètre vide obtenu ainsi ferait conclure « rien n'a
   changé, tout va bien » — le « vert par absence » que ce dépôt traque partout (doctrine §1).

   **Garde-fou obligatoire** : si cette commande rend **0**, ne conclus pas que rien n'a bougé.
   Recoupe avec `-mtime -1`, et si les deux divergent, demande le périmètre.
3. **`$ARGUMENTS` vide** → **demande** quel est le périmètre. **Ne lance rien** sur « tout le
   dépôt » : un audit sans périmètre rend un rapport que personne ne lit, et coûte le prix fort.

**Affiche la liste des fichiers retenus avant de dispatcher quoi que ce soit**, et dis combien il y
en a. Si la liste dépasse ~40 fichiers, dis-le et propose de la découper : au-delà, les agents
survolent au lieu d'auditer.

---

## Étape 1 — Sélectionner les piliers réellement touchés

Ne lance **que** les piliers dont le domaine est touché. Un agent lancé sur un domaine intact rend
du bruit, et le bruit fait rater les vrais signaux.

| Pilier | Agent(s) | Déclenché si le périmètre touche… |
| --- | --- | --- |
| **Chaîne de données** | `batte-parcours` | ≥ 2 modules reliés (`reception` → `production` → `session` → `comptabilite` → `afsca`), ou tout nouveau champ censé se propager |
| **Calcul & argent** | `batte-auditeur` puis `batte-testeur` | `packages/core/**`, tout ce qui porte `Cents`, `quantite`, `Bp`, `cout`, `marge`, `prevision` |
| **Traçabilité AFSCA** | `batte-auditeur` | `lot`, `mouvement`, `fefo`, `dlc`, `reception`, `temperature`, `nettoyage`, `rappel`, `packages/db/src/services/**` |
| **Compta & seuils légaux** | `batte-auditeur` | `seuils`, `tva`, `franchise`, `echeance`, `amortissement`, `verrou`, `parametre`, `apps/api/src/routes/comptabilite*` |
| **Interface & clavier** | `batte-ecran` + `accessibility-tester` | `apps/web/**` (`.tsx`) |
| **Sécurité locale** | `security-auditor` | `.env*`, `apps/api/src/**` (routes, upload, documents), `apps/api/src/ia/**`, toute `Data URI`, tout SQL écrit à la main |
| **Honnêteté des chiffres** | `batte-auditeur` | **TOUJOURS**, dès qu'un chiffre est affiché, calculé ou stocké |
| **Performance** | `performance-engineer` | `packages/db/src/depots/**` (requêtes), boucles sur mouvements/lots, tableaux longs de `apps/web` |

**Les quatre agents `batte-*` sont les seuls qui connaissent la doctrine de ce dépôt.** Les agents
génériques (`security-auditor`, `accessibility-tester`, `performance-engineer`) apportent un regard
extérieur utile — mais **donne-leur le contexte métier dans leur prompt**, ils ne l'ont pas.

---

## Étape 2 — Dispatcher en parallèle

→ `Skill(superpowers:dispatching-parallel-agents)`

Lance tous les agents retenus **dans un seul message**. À chacun, fournis :

- **la liste exacte des fichiers du périmètre** — pas le dépôt entier ;
- la consigne commune : « Audite UNIQUEMENT ces fichiers. Findings **actionnables**, classés
  **bloquant / important / mineur**, avec `fichier:ligne`, ce qui cloche, et un correctif concret.
  Ne réaudite pas le produit entier. **En lecture seule : ne modifie rien.** Réponds en français. » ;
- **la doctrine à lire d'abord** : `CLAUDE.md` et `docs/39-DOCTRINE-DES-AGENTS.md` ;
- la consigne propre au pilier :

**Chaîne de données** — un maillon correct branché à rien reste invisible aux tests unitaires
(doctrine §7). Le champ écrit est-il **lu** en aval ? Un `sessionId` resté `null`, un coût matière
qui n'entre dans aucune marge, une colonne calculée que nulle route n'expose (doctrine §5 : la
frontière HTTP **supprime en silence** ce que son schéma Zod ne déclare pas).

**Calcul & argent** — argent en **centimes entiers**, jamais de flottant ; masses en grammes,
volumes en millilitres, entiers ; conversions volume↔masse **uniquement** par la densité déclarée ;
**aucun calcul métier hors `packages/core`** (ni composant React, ni handler Fastify) ; un LLM ne
produit jamais un chiffre qui entre en base (CLAUDE.md §3 règle 2).

**Traçabilité AFSCA** — toute entrée crée un lot identifié (fournisseur, date, numéro **ou** DLC
précise) ; consommation en **FEFO** ; **le stock ne change que par un mouvement**, jamais par
`UPDATE` sur une quantité ; **rien ne s'efface** — annulation par écriture inverse, jamais `DELETE`.

**Compta & seuils légaux** — les seuils portent sur le **CA**, pas sur la marge, d'où la
ventilation **transformé / revendu** obligatoire (CLAUDE.md §6 : à marge égale, la revente génère
~2,6× plus de CA) ; aucun taux, seuil ou montant réglementaire en dur — table `parametre`, avec
date de validité et source ; **jamais** de code qui minore un CA, contourne une obligation
déclarative ou fabrique un registre a posteriori (CLAUDE.md §7).

**Interface & clavier** — **règle n°10** : chaque écran utilisable au clavier. Vérifie **où le focus
atterrit** après une action, pas seulement que le bouton existe — un `<button disabled>` qui a le
focus le **perd**, c'est pourquoi le produit utilise `aria-disabled` (docs/22-FOCUS-DETRUIT.md). Une
reprise de focus qui vise un nœud démonté par le même geste ne fait **rien**. Contrôles natifs, pas
de `div onClick`. Cible responsive **1280 / 1080 / 1440** (mémoire `doctrine-design-interface`).

**Sécurité locale** — la clé Anthropic et les identifiants SMTP vivent dans `.env`, **jamais** dans
le dépôt, **jamais** côté navigateur (`@anthropic-ai/sdk` serveur uniquement, CLAUDE.md §2) ;
`.env.example` documenté et sans secret réel ; validation Zod à **toutes** les frontières (HTTP,
fichiers importés, réponses Claude) ; pièces jointes en Data URI — type MIME et taille contrôlés,
`download` posé, jamais `target` ; aucun `catch` silencieux.

**Honnêteté des chiffres** — **c'est le pilier qui compte le plus ici.** Une valeur inconnue vaut
`null`, **jamais `0`** (doctrine §4, `docs/40-INVENTAIRE-INCONNU-CONTRE-ZERO.md`) : un coût à `0`
produit 100 % de marge, un dénominateur à `0` produit « 0 % d'écoulement » là où la question ne se
pose pas. Cherche tout `?? 0`, tout `|| 0`, tout tiret remplacé par un zéro à l'affichage. Cherche
aussi les **chiffres inventés** : une date, un montant, un résultat présenté comme mesuré sans
l'avoir été.

**Performance** — SQLite local, un seul utilisateur : le risque n'est pas la charge, c'est le
**N+1** sur les mouvements et les lots, et les tableaux longs re-rendus à chaque frappe.

---

## Étape 3 — Vérifier les portes déterministes

→ `Skill(superpowers:verification-before-completion)`

**Rejoue-les fraîches**, ne les cite jamais de mémoire :

```bash
npm run typecheck
npm run test
npm run lint
npm run format:check
```

Si le périmètre touche `packages/core`, mesure aussi la couverture **avec son périmètre explicite**
— un pourcentage sans périmètre ne mesure rien (mémoire `perimetre-des-verifications`) :

```bash
npx vitest run --coverage --coverage.include='<chemin exact>'
```

**Interdits absolus pendant l'audit** : aucune requête vers `127.0.0.1:3001` ni `:5173` (serveur du
porteur, sur sa **vraie base** `donnees/batte.sqlite`) ; jamais `npm run db:reset` ni `db:seed` hors
d'un appel de terminal portant ses propres variables d'environnement ; **jamais d'appel réel à
l'API Anthropic** — le porteur paie chaque appel.

---

## Étape 4 — Recouper les rapports d'agents

**Un rapport d'agent n'est pas une preuve** (doctrine §11, mémoire `piloter-des-agents-en-parallele`).
Avant d'agréger :

- **vérifie toi-même** les deux ou trois findings les plus graves, fichier et ligne en main ;
- **écarte les faux positifs** dus à l'ignorance du contexte — les agents génériques signalent
  volontiers comme « faille » ce qui est un choix assumé d'application locale mono-utilisateur ;
- **une liste écrite à la main ne prouve jamais une absence** (doctrine §2) : si un agent affirme
  « aucun autre appelant », redérive-le par `grep` avant de le reprendre à ton compte.

---

## Étape 5 — Verdict et rapport

Agrège en **un seul tableau** trié par sévérité :
`Pilier | Sévérité | Fichier:ligne | Problème | Correctif`

| Verdict | Condition |
| --- | --- |
| 🟥 **NO-GO** | ≥ 1 **bloquant** : régression, valeur inconnue rendue `0`, stock modifié hors mouvement, traçabilité de lot rompue, secret exposé, chiffre inventé, écran devenu impraticable au clavier, écriture sur la vraie base |
| 🟧 **GO avec réserves** | seulement important / mineur — le porteur décide |
| 🟩 **GO** | rien de significatif |

Puis, **toujours**, les quatre points du rapport honnête (doctrine §13) :

1. **ce qui a été mesuré**, avec son périmètre et ses chiffres ;
2. **ce qui a été vérifié à la main** par toi, par-dessus les rapports d'agents ;
3. **les défauts réels trouvés** — la partie la plus précieuse, celle que presque personne n'écrit.
   Un défaut hors périmètre de correction s'encode en **`it.fails`** avec son explication, il ne se
   corrige pas en douce ;
4. **ce que cet audit ne prouve toujours pas** — les piliers non lancés, les zones non couvertes,
   les questions restées ouvertes.

**Ce qu'on n'invente jamais** (doctrine §12) : un chiffre, une date, un résultat de commande non
lancée. Si une chose n'a pas été mesurée, la phrase est « je ne l'ai pas mesuré ».

---

## Rapport avec les autres commandes

- **`/lot`** construit un lot de bout en bout (cadrage → plan → TDD → preuve par mutation →
  vérification → revue → verdict). **`/audit` est son étape de contrôle**, utilisable seule sur du
  travail déjà fait — le tien ou celui d'un autre agent.
- **`/pre-push`** vise un **site Next.js** (`messages/**`, `next.config.ts`, hreflang, `llms.txt`) et
  repose sur `git diff` : rien de tout cela n'existe ici. **Cette commande la remplace pour Batte.**
