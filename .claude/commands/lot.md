---
description: Workflow complet de livraison d'un lot Batte — brainstorming, plan, TDD, preuve par mutation, vérification, revue demandée ET reçue, verdict GO / NO-GO.
argument-hint: "[description du lot, ou numéro de lot de docs/04-ROADMAP-LOTS.md]"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Agent, Skill, TodoWrite
---

Tu livres un lot de travail sur **Batte** (ERP mono-utilisateur, crêpes ambulantes).
Demande : `$ARGUMENTS`

Ce workflow **chaîne les compétences `superpowers` sur la doctrine de ce dépôt**. Les deux ne se
recouvrent pas : superpowers apporte la discipline générale (TDD, débogage systématique, preuve
avant affirmation, revue), la doctrine Batte apporte ce qu'aucune compétence générique ne connaît —
**la preuve par mutation**, la convention `it.fails`, « inconnu vaut `null`, jamais `0` ».

**En cas de divergence, la doctrine du dépôt l'emporte.**

---

## Étape 0 — Se charger le contexte (obligatoire, jamais sauté)

Lis, dans cet ordre : `CLAUDE.md`, puis `docs/39-DOCTRINE-DES-AGENTS.md`.

Le second recense **les défauts que ce dépôt a réellement payés**. Le lire évite de les reproduire ;
ne pas le lire, c'est les reproduire — c'est arrivé assez de fois pour qu'un document existe.

Puis le document pertinent au lot : `docs/01-SPEC-FONCTIONNELLE.md`, `docs/02-MODELE-DONNEES.md`,
`docs/03-MOTEUR-PREVISION.md`, `docs/06-UI-ET-PARCOURS.md` (**avant tout code d'interface**),
`docs/05-DECISIONS.md`.

---

## Étape 1 — Cadrer AVANT de coder

**Si l'intention n'est pas déjà écrite noir sur blanc** (fiche `docs/demandes/`, lot de
`docs/04-ROADMAP-LOTS.md`, consigne explicite du porteur) :

→ `Skill(superpowers:brainstorming)`

**Ne devine jamais une règle métier.** CLAUDE.md §9 est explicite : « une hypothèse silencieuse sur
une règle métier coûte plus cher qu'une question. » Si une ambiguïté demeure après le
brainstorming, **pose la question et arrête-toi** — ne la tranche pas. Les points en attente vivent
dans la mémoire `en-attente-du-porteur`.

**Si le lot fait plus de deux ou trois gestes** :

→ `Skill(superpowers:writing-plans)`

Le plan nomme les fichiers créés ou modifiés et les décisions non triviales. Toute décision
d'architecture nouvelle se consigne dans `docs/05-DECISIONS.md` (contexte, options, choix,
conséquences).

---

## Étape 2 — Répartir le travail

**Les quatre agents de ce dépôt, et eux seuls, connaissent sa doctrine :**

| Agent | Quand |
| --- | --- |
| `batte-auditeur` | **lecture seule** — inventaire, recherche de défaut, « X existe-t-il / est-il atteint / est-il mort ? » |
| `batte-ecran` | écrans React — tests montés jsdom, clavier, états d'erreur, valeurs inconnues |
| `batte-testeur` | tests de `packages/core`, `packages/db`, `apps/api` — preuve par mutation exigée |
| `batte-parcours` | parcours de bout en bout — le seul type de test qui voit un maillon correct branché à rien |

Les 53 autres agents installés sont **génériques et ignorent tout de ce dépôt** : ne les utilise que
pour un regard extérieur (sécurité, perf), jamais pour écrire du code métier Batte.

**Deux tâches ou plus sans état partagé** → `Skill(superpowers:dispatching-parallel-agents)`
**Un plan écrit à exécuter par tâches** → `Skill(superpowers:subagent-driven-development)`

**Non négociable, appris à ses dépens** (mémoire `piloter-des-agents-en-parallele`, doctrine §11) :
réserve à chaque agent un **périmètre de fichiers exclusif**, annoncé dans son prompt. Deux agents
sur le même fichier = du travail perdu. Et **vérifie les fichiers toi-même** à leur retour : un
rapport d'agent qui dit « succès » n'est pas une preuve.

---

## Étape 3 — Écrire

→ `Skill(superpowers:test-driven-development)`

Rappels du dépôt qui priment sur toute habitude générique :

- **argent en centimes entiers**, masses en grammes, volumes en millilitres, entiers (CLAUDE.md §3) ;
- **le stock ne se modifie que par un mouvement** — jamais d'`UPDATE` sur une quantité ;
- **rien ne s'efface** — écriture d'annulation, jamais de `DELETE` ;
- **une valeur inconnue vaut `null`, jamais `0`** — un coût à `0` produit 100 % de marge, c'est le
  mensonge le plus traqué ici (doctrine §4) ;
- **aucun calcul métier hors `packages/core`** — ni dans un composant React, ni dans un handler ;
- **règle n°10** : chaque écran utilisable au clavier, et **vérifie où le focus atterrit** après une
  action, pas seulement que le bouton existe ;
- **zéro valeur en dur** : tout seuil, taux ou montant réglementaire va dans `parametre`.

**Dès qu'un test rouge résiste, un comportement surprend, un bug apparaît :**

→ `Skill(superpowers:systematic-debugging)` — **avant** de proposer le moindre correctif.

Et la règle propre au porteur (mémoire `erreur-persistante-passer-en-opus`) : **une seule erreur qui
résiste suffit** à repasser l'audit et la correction en **Opus 5**, jamais en Sonnet. Une erreur qui
persiste signale presque toujours que le modèle de la situation est faux, pas que le code est mal
tapé.

---

## Étape 4 — Prouver par la mutation (propre à Batte, sans équivalent superpowers)

**Un test vert ne prouve rien tant qu'on ne l'a pas vu rougir.**

Pour chaque groupe de tests : **casse la chose testée, montre le rouge, restaure.** Si une mutation
évidente ne fait pas rougir, ce n'est pas le test qui est robuste — c'est **la fixture qui est
aveugle** (doctrine §3, six instances déjà payées).

Les trois formes d'une fixture aveugle :
1. elle **ment** sur la situation — une clé mal nommée fait échouer un `schema.parse` et le test
   mesure le chemin d'erreur en croyant mesurer le succès ;
2. elle décrit un cas **impossible** ;
3. elle est **trop dégénérée pour discriminer** — valeurs toutes identiques, un seul élément là où
   le tri est l'objet du test.

Un harnais de mutation doit **restaurer le fichier même s'il est interrompu** (`try/finally` +
`atexit`) : un fichier de production laissé muté est une bombe pour les autres agents.

**Défaut réel trouvé et non corrigeable dans le périmètre** → encode-le en `it.fails`, avec un
commentaire qui explique **ce qui est cassé, pourquoi, et ce que coûterait le correctif** — puis
signale-le. Ne le corrige pas en douce hors mandat.

**Pièges d'outillage** (doctrine §10) : `vitest -t "motif"` ne rejoue QUE les tests filtrés — rejoue
le fichier entier. Et **ne compare jamais un texte formaté à un littéral tapé à la main** :
`formaterEuros`/`formaterQuantite` passent par `Intl` et posent une espace **insécable**.

---

## Étape 5 — Vérifier AVANT toute affirmation

→ `Skill(superpowers:verification-before-completion)`

Sa Loi de fer : **si tu n'as pas lancé la commande dans CE message, tu ne peux pas dire qu'elle
passe.** C'est la version exécutable de la mémoire `perimetre-des-verifications`.

Portes de sortie, **rejouées fraîches**, jamais citées de mémoire :

```bash
npm run typecheck
npm run test
npm run lint
npx prettier --check "<tes fichiers>"
```

Et la question que ce dépôt reprend à chaque fois : **de quoi ce vert est-il le vert ?** Un
pourcentage de couverture n'a de sens qu'avec son **périmètre** — mesure-le
(`--coverage.include=…`), ne l'estime jamais.

**Interdits absolus**, quelles que soient les circonstances :
- aucune requête vers `127.0.0.1:3001` ni `:5173` — c'est le serveur du porteur, sur sa **vraie
  base** ;
- `npm run db:seed` écrit sur la base RÉELLE si les variables d'environnement ne sont pas dans le
  **même appel de terminal** ;
- jamais `npm run db:reset`, jamais d'écriture sur `donnees/batte.sqlite` ;
- **jamais d'appel réel à l'API Anthropic** — le porteur paie chaque appel ;
- aucune dépendance installée sans validation explicite (CLAUDE.md §7).

---

## Étape 6 — Faire relire, et savoir recevoir la relecture

→ `Skill(superpowers:requesting-code-review)`

Dispatche un relecteur avec un **contexte précisément construit** — jamais l'historique de ta
session. Donne-lui : la doctrine à connaître, les fichiers exacts, et la consigne de chercher **les
fixtures aveugles en priorité**. Ce dépôt n'ayant pas de dépôt git, raisonne par **chemins de
fichiers** et non par SHA.

À la réception → `Skill(superpowers:receiving-code-review)`

Le défaut symétrique de la revue est **l'acquiescement de politesse**. Vérifie techniquement chaque
remarque : corrige ce qui est juste, **pousse en retour avec des preuves** ce qui ne l'est pas.

---

## Étape 7 — Verdict, et rapport honnête

| Verdict | Condition |
| --- | --- |
| 🟥 **NO-GO** | ≥ 1 problème critique : régression, fixture aveugle non corrigée, écriture sur la vraie base, chiffre inventé, valeur inconnue rendue `0` |
| 🟧 **GO avec réserves** | seulement des points importants ou mineurs — le porteur décide |
| 🟩 **GO** | rien de significatif |

Le rapport dit, dans cet ordre (doctrine §13) :

1. **les mesures avant / après**, chiffrées et mesurées, avec leur périmètre ;
2. **les mutations posées et le rouge obtenu** — et **les survivantes**, avec leur explication : une
   mutation qui survit est soit une fixture aveugle, soit du **code mort**, et les deux se disent ;
3. **tout défaut réel trouvé** — c'est la partie la plus précieuse, celle que presque personne
   n'écrit ;
4. **ce que le travail ne prouve toujours pas** — les limites, nommées.

**Ce qu'on n'invente jamais** (doctrine §12) : un chiffre, une date, un résultat de commande non
lancée, un « ça devrait marcher ». Si une chose n'a pas été mesurée, la phrase à écrire est « je ne
l'ai pas mesuré », pas une estimation présentée comme un fait.

---

## Note sur `/pre-push`

La commande `.claude/commands/pre-push.md` de ce dossier vise **un site Next.js** (`messages/**`,
`next.config.ts`, `src/app/api/**`, hreflang, `llms.txt`) : rien de tout cela n'existe dans Batte, et
le dépôt n'a de toute façon **pas de dépôt git** (mémoire `husky-pre-push-inadapte`). Elle est donc
inopérante ici. **Utilise ce workflow-ci**, et laisse `/pre-push` à l'autre projet tant que le
porteur n'a pas tranché son sort.
