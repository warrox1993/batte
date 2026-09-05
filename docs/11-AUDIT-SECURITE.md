# 11 — Audit de sécurité : secrets et chaîne d'appel à Claude

> Périmètre : confinement des secrets (clé Anthropic, identifiants SMTP), contenu réellement
> envoyé à l'API Claude, chemin de retour de ses réponses, injection de prompt, chaîne mail.
> Hors périmètre volontaire : authentification et autorisation — le produit est mono-utilisateur,
> local, sans compte (CLAUDE.md §0) ; menaces réseau — rien n'est exposé, l'API écoute sur
> `127.0.0.1` (`apps/api/src/serveur.ts:35`).
>
> Méthode : vérification **par la construction** partout où c'est possible. Un bundle a été
> réellement produit et fouillé, le graphe d'import réellement lu, le chemin d'échec réellement
> parcouru. Aucun appel n'a été fait à l'API Anthropic ni à un serveur SMTP.

---

## 1. Verdict en une page

| Sujet                                                                   | État                                | Preuve |
| ----------------------------------------------------------------------- | ----------------------------------- | ------ |
| La clé Anthropic peut-elle atteindre le navigateur ?                    | **Non**, structurellement           | §2     |
| Un secret est-il dans le bundle de production ?                         | **Non**                             | §2.1   |
| Un secret est-il en clair quelque part dans le dépôt ?                  | **Non**                             | §3.2   |
| `.env.example` est-il exact ?                                           | **Il ne l'était pas** — corrigé     | §3.1   |
| Un texte non maîtrisé sortait-il par une réponse d'API ?                | **Oui** — corrigé                   | §4.1   |
| Une réponse de Claude peut-elle entrer en base sans Zod ni validation ? | **Non**                             | §5.2   |
| Le plafond protège-t-il avant la dépense ?                              | **Oui**                             | §5.4   |
| Le mode dégradé sans Claude est-il complet ?                            | **Oui**                             | §5.5   |
| Injection de prompt possible ?                                          | **Surface nulle aujourd'hui**       | §6     |
| Injection d'en-tête SMTP possible ?                                     | **Non**                             | §7.1   |
| Le mode test mail fuit-il quelque chose ?                               | **Non** (mais il mentait — corrigé) | §7.2   |

Six défauts trouvés, six corrigés, chacun figé par un test qui repasse au rouge si le défaut
revient. Aucun `it.fails` : il ne reste aucun défaut connu non corrigé dans ce périmètre.

---

## 2. La clé ne peut pas atteindre le navigateur — vérifié par la construction

C'est la règle la plus importante du périmètre (CLAUDE.md §2). Elle ne tient pas par une
convention mais par quatre faits indépendants, chacun vérifiable sans faire confiance au code :

1. **`@anthropic-ai/sdk` n'est déclaré que dans `apps/api/package.json`.** `apps/web` déclare
   `react`, `react-dom`, `react-router-dom` et `@batte/core` — rien d'autre.
2. **`@batte/core`, seul paquet du dépôt embarqué dans le bundle, ne dépend que de `uuid` et
   `zod`**, et ne contient **aucune** lecture de `process.env`.
3. **Aucun fichier de `apps/web/src` ne lit un environnement.** Zéro `process.env`, zéro
   `import.meta.env`, zéro identifiant `VITE_*` — ce qui compte, parce que Vite recopie
   littéralement dans le bundle toute variable préfixée `VITE_`. Il n'en existe aucune
   aujourd'hui, et le test §2.2 empêche qu'il en apparaisse une.
4. **Les seules lectures d'environnement du dépôt** sont : `apps/api/src/ia/client.ts:56`
   (`ANTHROPIC_API_KEY`), `apps/api/src/mail.ts:41` (les `SMTP_*` et `MAIL_MODE_TEST`),
   `apps/api/src/serveur.ts:69,99`, `packages/db/src/config.ts:14,19` et
   `packages/db/drizzle.config.ts:10`. Toutes côté serveur.

### 2.1 Le bundle réellement produit

`npm run build` puis fouille de `apps/web/dist/` :

- `sk-ant` : **0 occurrence**. `ANTHROPIC` : **0**. `SMTP` : **0**. `MOT_DE_PASSE` / `PASSWORD`
  en tant que secret : **0**. `process.env` : **0**.
- `anthropic` (insensible à la casse) : **0 occurrence** dans les trois fichiers livrés.
- Les seules correspondances de `password` et `token` sont des faux positifs vérifiés un par
  un : la table des types d'`<input>` de React DOM (`password:!0`) et le champ `tokensEntree`
  du contrat Zod `schemaAppelIa`.

### 2.2 Ce qui empêche la régression

`apps/api/src/securite-secrets.test.ts` refuse désormais, à chaque exécution de la suite :

- toute lecture d'environnement ou tout identifiant `VITE_*` dans `apps/web/src/**` ;
- tout import de `@anthropic-ai/sdk`, `nodemailer`, `@batte/db` ou `node:fs` depuis le front ;
- toute dépendance du front sur autre chose que `@batte/core` côté paquets du dépôt ;
- toute lecture de `process.env` dans `packages/core` ;
- tout motif de secret dans `apps/web/dist/` **quand le bundle existe** (le test s'ignore
  proprement s'il n'a pas été construit — c'est sa seule faiblesse assumée, la vérification
  structurelle ci-dessus ne dépend, elle, d'aucun build).

---

## 3. `.env` et `.env.example`

### 3.1 DÉFAUT — deux variables documentées que le code n'a jamais lues

`.env.example` déclarait :

```
PLAFOND_IA_MENSUEL_CENTS=500
OPEN_METEO_URL=https://api.open-meteo.com/v1/forecast
```

Aucune des deux n'était lue nulle part. Pour Open-Meteo, l'URL est une constante
(`apps/api/src/meteo/open-meteo.ts:16`) et le commentaire promettait pourtant qu'on pouvait
« la pointer ailleurs en test ».

**La première est la plus dangereuse.** Le fichier annonçait un plafond de dépense en euros ;
un utilisateur inquiet du coût de l'API qui écrit `PLAFOND_IA_MENSUEL_CENTS=0` en croyant
couper la dépense n'aurait rien coupé du tout : le plafond réel vit dans
`parametre.plafond_ia_mensuel_cents` (`packages/core/src/ia.ts:111`). Une variable documentée
mais ignorée est pire qu'une variable absente — elle fait croire à un réglage qui n'existe pas.

**Corrigé** : les deux lignes retirées, remplacées par un commentaire qui dit où vit réellement
le plafond et pourquoi (c'est une valeur métier, elle appartient à `parametre` — CLAUDE.md §7).

**Figé par** deux tests, dans les **deux sens** :

- « documente TOUTE variable que le code lit » — attrape un ajout non documenté ;
- « ne documente AUCUNE variable que le code ignore » — attrape le fantôme.

Le scan comprend les trois indirections réellement employées dans ce dépôt : `process.env[…]`,
`texteEnv('…')` (mail) et `texte/entier/chemin('…', défaut)` (config db). Une quatrième
indirection devra y être ajoutée, c'est écrit dans le test.

_Vérification que le test tombe : réintroduire `OPEN_METEO_URL=…` dans `.env.example` fait
échouer « ne documente AUCUNE variable que le code ignore » avec le nom de la variable en
clair dans le message._

### 3.2 Aucun secret en clair, nulle part — SAIN

Fouillés : `donnees/` (la base SQLite et son WAL, en binaire), `sauvegardes/` (33 fichiers),
`sorties/`, `.playwright-mcp/`, `.claude/settings.local.json`, `docs/`, toutes les sources.
Seuls des **noms** de variables apparaissent (`docs/05-DECISIONS.md`, `docs/10-AUDIT-ERREURS-500.md`
mentionnent `ANTHROPIC_API_KEY`) ; aucune valeur.

Aucun fichier `.env` n'existe sur le poste au moment de l'audit. `.gitignore` couvre `.env`,
`.env.local`, `donnees/`, `sauvegardes/`, `sorties/`, `*.sqlite*` et `*.log`.

Un test refuse désormais toute chaîne en `sk-ant-apiNN-…` dans les sources, les documents,
`.env.example` et `CLAUDE.md` — en excluant explicitement les sentinelles de test, qui portent
toutes le marqueur `SENTINELLE`.

### 3.3 Une variable manquante ne produit pas de plantage obscur — SAIN

Passés en revue, tous les cas de configuration absente :

| Variable absente                          | Comportement                                             | Verdict |
| ----------------------------------------- | -------------------------------------------------------- | ------- |
| `ANTHROPIC_API_KEY`                       | Refus motivé en 200, nomme la variable à renseigner      | Clair   |
| `SMTP_HOTE` (avec `MAIL_MODE_TEST=false`) | `ErreurMetier` `smtp_non_configure`, message actionnable | Clair   |
| `SMTP_PORT` illisible                     | `ErreurMetier` `smtp_port_invalide`                      | Clair   |
| `MAIL_MODE_TEST`                          | Mode test — le côté sûr (§7.3)                           | Clair   |
| `CHEMIN_BASE`, `DOSSIER_*`, `RETENTION_*` | Valeurs par défaut résolues depuis la racine             | Clair   |
| `PORT` non entier                         | Exception française explicite au démarrage               | Clair   |
| Clé de `parametre` manquante              | `GET /api/sante` la liste                                | Clair   |

Aucune correction nécessaire. Observation sans gravité : il n'existe pas de récapitulatif de
configuration au démarrage (`apps/api/src/contexte.ts` journalise seulement la base et la
sauvegarde). Ce n'est pas un défaut de sécurité, c'est un confort absent.

---

## 4. Ce qui sort par une réponse d'API

### 4.1 DÉFAUT — le message d'une exception du SDK franchissait la frontière, deux fois

**Gravité : moyenne.** C'est le seul vrai défaut de fuite trouvé.

Avant correction, `apps/api/src/ia/client.ts` faisait, dans son `catch` :

```ts
const detail = cause instanceof Error ? cause.message : String(cause);
journaliserAppelIa(base, { …, erreur: detail });
return { disponible: false, raison: `L'appel à Claude a échoué (${detail}). …` };
```

Ce `detail` n'est **pas écrit par nous**. Il vient du SDK Anthropic, d'`undici` ou du système.
Il partait par **deux** frontières de sortie :

1. le corps HTTP de `POST /api/ia/analyse-ecart/:id` et de `POST /api/prevision/commenter` ;
2. la colonne `journal_ia.erreur` — que `GET /api/ia/journal` renvoie telle quelle au
   navigateur (`packages/db/src/depots/ia.ts:93`, exposée par
   `packages/core/src/contrats/ia.ts:33`). Ce second chemin est le plus insidieux : il
   **persiste** le texte, et un écran le relit ensuite.

Formes réellement observables sur ce chemin : `401 {"…invalid x-api-key: sk-ant-api03-…"}`
(le préfixe de la clé, renvoyé par l'API elle-même), une URL de requête avec paramètre,
`Cannot find module 'C:\Users\<compte>\…\node_modules\…'`, une pile d'appel Node complète.
Or le dépôt s'interdit déjà explicitement `node_modules` et les débuts de pile dans **toute**
réponse (`MOTIFS_FUITE_TECHNIQUE`, `apps/api/src/routes/integration.test.ts`). Ce chemin
pouvait donc violer l'invariant que le projet s'est lui-même donné.

**Correction — deux niveaux, volontairement différents :**

- **La raison affichée ne contient plus AUCUN texte tiers.** `raisonEchecIa(statut)`
  (`packages/core/src/ia.ts:227`) déduit une phrase française du seul statut HTTP :
  clé refusée (401/403, la seule panne actionnable, qui nomme `ANTHROPIC_API_KEY`), débit
  dépassé (429), panne d'Anthropic (5xx), requête refusée (4xx), injoignable (aucun statut).
  Une liste de refus finit toujours par laisser passer quelque chose ; sur la frontière la
  plus exposée, on n'en utilise donc pas.
- **Le journal conserve un extrait assaini et borné.** `assainirDetailIa`
  (`packages/core/src/ia.ts:201`) coupe les piles d'appel, masque clés, en-têtes
  d'autorisation, paires `token=`/`password=`, chemins absolus Windows et POSIX, chemins
  d'URL et toute mention de `node_modules`, puis tronque à 200 caractères. Sans ce niveau,
  une panne récurrente redeviendrait invisible — ce que CLAUDE.md §4 interdit.

Les deux fonctions vivent dans `packages/core` : elles sont pures et c'est une règle du
produit, pas de la plomberie.

**Figé par** `packages/core/src/ia-securite.test.ts` (12 tests, sept messages d'échec réalistes
confrontés aux motifs interdits) et `apps/api/src/ia/client.test.ts`. Ce dernier parcourt le
**vrai** chemin d'échec en pointant `ANTHROPIC_BASE_URL` sur `http://127.0.0.1:1` — un port
local qui n'écoute pas : la connexion est refusée en boucle locale, rien ne quitte le poste,
et l'on observe réellement ce que l'application fait d'une exception.

_Vérification que le test tombe : en rétablissant l'ancien `catch`, le test
« ne renvoie AUCUN texte de la bibliothèque au navigateur, et journalise assaini » échoue._

### 4.2 DÉFAUT — une valeur d'environnement était recopiée dans une réponse

**Gravité : faible.** `apps/api/src/mail.ts` renvoyait
`Le port SMTP configuré (SMTP_PORT=« <valeur lue> ») n'est pas un entier valide.` — une
`ErreurMetier`, donc affichée telle quelle à l'écran. Un port n'est pas un secret, mais
l'invariant « aucune valeur d'environnement ne franchit la frontière HTTP » vaut mieux
absolu que nuancé : c'est le genre de règle qu'un lecteur futur peut appliquer sans réfléchir.

**Corrigé** : le message nomme la variable sans la citer, et reste actionnable (l'utilisateur
ouvre son `.env`). Figé par `apps/api/src/mail.securite.test.ts`.

### 4.3 DÉFAUT — le balayage anti-fuite ignorait les corps d'ERREUR

**Gravité : faible, mais structurelle.** Le balayage de `integration.test.ts` exigeait un
statut 200 sur chaque route de lecture, et un test de couverture (D-045) le confronte à la
table de routage. Les corps **d'erreur** n'étaient balayés que ponctuellement — or c'est par
eux qu'un secret sort le plus facilement.

**Corrigé** : ajout, dans le même `describe`, de deux tests :

- « aucune réponse d'ERREUR ne laisse filtrer un secret du .env » — environ 90 requêtes
  fabriquées pour échouer (verbe non déclaré sur chaque route de lecture, les huit
  identifiants hostiles sur chaque route de détail, paramètres refusés, écritures à corps
  vide), avec l'exigence que **chacune** rende bien ≥ 400, faute de quoi le balayage ne
  balaierait plus ce qu'il croit balayer ;
- « un corps illisible ne renvoie pas en écho ce qu'il contenait » — une sentinelle est
  envoyée dans un JSON tronqué, et ne doit pas revenir dans la réponse. C'est le chemin par
  lequel un secret collé par erreur dans un formulaire ressortirait.

Les deux passent : le gestionnaire d'erreurs (`apps/api/src/plugins/erreurs.ts:70-85`) ne
renvoie jamais le message natif de Fastify, il le remplace par une phrase par statut. C'était
déjà correct ; ce n'était pas prouvé.

---

## 5. Ce qui est envoyé à Claude, et ce qui en revient

### 5.1 Le contenu réel des prompts — SAIN

Relecture ligne à ligne de `apps/api/src/ia/usages.ts`. Les trois consignes ne transportent
que des **chiffres déjà calculés, des dates et des libellés métier** : quantités de crêpes,
montants formatés en euros, nom du lieu, explication du moteur, alertes de stock et de DLC,
notes qualitatives saisies par l'utilisateur.

Ne s'y trouve **rien** de ce qu'on cherchait : aucun chemin de fichier du poste, aucun nom
d'utilisateur système, aucune valeur d'environnement, aucun identifiant technique (les
prompts parlent numéros métier `SM-2026-0001`, pas UUID), aucune donnée personnelle client —
le modèle de données n'en porte aucune (CLAUDE.md §3 règle 9).

**Figé par** `apps/api/src/ia/usages.test.ts`, qui pose des sentinelles dans l'environnement
avant de construire les prompts et refuse leur présence, ainsi que tout chemin absolu, toute
mention de dépendance et toute adresse e-mail.

### 5.2 Le chemin de retour — SAIN, et gardé

Tracé complet : `demanderCommentaire` rend `{ disponible, texte, coutCents }` →
`routes/ia.ts:92` et `routes/previsions.ts:304` font `schemaCommentaireIa.parse(reponse)` →
la valeur part au navigateur. **Aucune écriture en base.** Le seul `INSERT` du chemin est
`journaliserAppelIa`, appelé **sans** `reponseBrute` : la colonne prévue pour stocker la
sortie brute existe mais reste toujours `NULL`.

Autrement dit, une réponse de Claude ne peut pas atteindre la base aujourd'hui, parce qu'elle
n'y va jamais. C'est la façon la plus sûre de tenir CLAUDE.md §3 règle 2.

**Figé par** deux tests dans `securite-secrets.test.ts` : `reponseBrute` ne doit apparaître
dans aucun fichier hors du dépôt et du schéma qui la déclarent ; et tout appelant de
`demanderCommentaire` doit contenir `schemaCommentaireIa.parse`. Le jour où quelqu'un
renseignera `reponseBrute`, la question « où est le schéma Zod, où est la validation
humaine ? » se posera avant la fusion, pas après.

### 5.3 DÉFAUT — rien ne figeait « chaque usage porte l'interdiction »

**Gravité : faible, structurelle.** L'interdiction « tu ne produis JAMAIS de chiffre » vit
dans une constante `SOCLE` concaténée en tête de chaque consigne. Au fil (ce qui compte),
chaque consigne envoyée la porte donc bien — la décision du Lot 9 tient. Mais **rien ne
cassait** si un quatrième usage était écrit sans le socle.

**Corrigé** par un test qui construit les trois demandes, exige l'interdiction dans chacune,
et — c'est le point — **dérive la liste des usages couverts des exports réels du module**.
Ajouter une fonction sans l'ajouter au test fait tomber la suite. C'est la leçon de D-045
appliquée aux prompts.

Le test refuse aussi tout verbe de calcul dans la partie propre à chaque consigne.

### 5.4 Le plafond protège AVANT la dépense — SAIN

`apps/api/src/ia/client.ts:107-119` : le contrôle a lieu avant `messages.create`, et il porte
sur `coutMaximalCents(tokens estimés en entrée, ia_tokens_sortie_max, tarif)` — c'est-à-dire
sur le **pire cas possible**, pas sur un coût moyen espéré. L'estimation des tokens d'entrée
majore volontairement (un caractère sur trois). Le plafond et les tarifs viennent tous de
`parametre` ; rien n'est codé en dur.

**Figé par** deux tests : budget consommé → refus dont la raison parle du plafond et non du
réseau (preuve que la coupure précède toute tentative de connexion, alors même qu'une clé est
configurée et que la base d'URL pointe sur un port refusé), et aucune ligne de journal
ajoutée ; puis un test qui laisse exactement « le pire cas moins un centime » de budget — un
contrôle qui raisonnerait sur une sortie typique laisserait passer, celui-ci refuse.

### 5.5 Le mode dégradé est complet — SAIN

Les quatre états sont couverts et rendent tous un refus **motivé**, jamais une exception,
jamais autre chose qu'un 200 côté HTTP :

| État            | Raison rendue                                      | Ligne de journal      |
| --------------- | -------------------------------------------------- | --------------------- |
| Aucune clé      | Nomme `ANTHROPIC_API_KEY`                          | Aucune                |
| Plafond à 0     | « assistance désactivée », renvoie vers Paramètres | Aucune                |
| Plafond atteint | Chiffre le dépensé et le plafond                   | Aucune                |
| Panne réseau    | Phrase française, aucun détail technique           | Une, assainie, coût 0 |

---

## 6. Injection de prompt — surface nulle aujourd'hui

L'usage « extraction structurée (lecture d'un bon de livraison) » de CLAUDE.md §5 est
**déclaré partout mais implémenté nulle part** : le type `UsageIa`
(`packages/core/src/ia.ts:18`), l'énumération de `journal_ia.usage`
(`packages/db/src/schema.ts:1275`) et les paramètres de tarif
(`ia_modele_extraction`, `ia_tarif_extraction_*`) l'attendent, mais **aucun code n'envoie de
document fournisseur à Claude**. Il n'existe aucune route d'import de bon de livraison,
aucune lecture de fichier vers un prompt.

La surface d'injection de prompt est donc **nulle**, et il n'y a rien à corriger. Le seul
texte non maîtrisé qui atteint aujourd'hui un prompt est `notesQualitatives`, saisi par
l'utilisateur lui-même sur sa propre session : au pire, il s'auto-influence.

**Quand cet usage sera codé — à retenir** (ce n'est pas une correction, c'est le cahier des
charges de sécurité du futur lot) :

1. La sortie doit être contrainte par un schéma Zod **strict et fermé** — pas d'objet libre,
   pas de champ texte qui deviendrait un ordre ; idéalement des identifiants à choisir dans
   une liste fournie, jamais à inventer.
2. Rien d'extrait ne doit **écrire en base ni déclencher un envoi de mail** sans validation
   humaine explicite : la ligne extraite se pré-remplit dans l'écran de réception, l'humain
   valide. C'est exactement le cycle brouillon → validée → envoyée de D-009, appliqué à
   l'IA — et `journal_ia.valideeParHumain` existe déjà pour le tracer.
3. Le document doit être présenté au modèle comme **donnée** et non comme instruction
   (délimiteurs explicites, consigne disant que le contenu délimité ne contient jamais
   d'ordre).
4. Un montant extrait reste un montant **proposé** : le total de la réception se recalcule
   côté `packages/core`, jamais lu depuis la sortie du modèle (CLAUDE.md §3 règle 2).

---

## 7. La chaîne mail

### 7.1 Injection d'en-tête — SAIN, non exploitable

Le sujet est construit avec le **nom du fournisseur**, saisi à la main :
`Bon de commande ${numero} — ${fournisseurNom}` (`apps/api/src/routes/commandes.ts:194`), et
l'adresse peut venir de la fiche fournisseur sans repasser par le `z.email()` de la route
(`packages/core/src/contrats/commandes.ts:98`). Un `\r\n` dans l'un ou l'autre ouvrirait un
en-tête supplémentaire.

Vérifié dans le code de la dépendance : nodemailer remplace `\r?\n|\r` par une espace dans
**toute** valeur d'en-tête (`node_modules/nodemailer/lib/mime-node/index.js`, branche `default`
de `_encodeHeaderValue`) et reconstruit les adresses par `_parseAddresses` / `_convertAddresses`
plutôt que de les recopier. **L'envoi réel n'a jamais été vulnérable.**

### 7.2 DÉFAUT — le mode test archivait des en-têtes que le vrai mail n'aurait pas eus

**Gravité : faible.** `ecrireMailDeTest` intercalait `sujet` et `destinataire` **bruts** dans
un pseudo-en-tête texte. Un nom de fournisseur contenant `\r\nBcc: …` produisait donc un
fichier de `sorties/mails/` portant une ligne `Bcc:` — que nodemailer aurait aplatie. Le mode
test décrivait un message qui n'aurait jamais existé.

Ce n'est pas une faille SMTP, c'est un défaut de **fidélité**, et pour un mode test c'est
exactement le défaut qui compte : un mode test qui ment sur ce qu'il simule ne vaut rien, et
c'est aussi la seule trace conservée de ce qui a été commandé.

**Corrigé** par `normaliserEnTete` (`apps/api/src/mail.ts:59`), qui reproduit la substitution
de nodemailer et est appliquée une seule fois, en amont des **deux** chemins — mode test et
envoi réel voient désormais rigoureusement le même message. Figé par deux tests
(`mail.securite.test.ts`) qui exigent exactement une ligne `À :` et une ligne `Sujet :`, et
aucune ligne `Bcc:`.

### 7.3 Le reste de la chaîne — SAIN

- **Aucun identifiant SMTP dans un fichier de sortie** : le fichier archivé ne contient que
  destinataire, sujet, date, corps et pièces jointes. Testé avec utilisateur et mot de passe
  posés en sentinelles dans l'environnement.
- **Aucun identifiant SMTP dans une réponse d'API** : les erreurs de nodemailer ne sont pas
  des `ErreurMetier`, elles tombent donc dans le 500 générique, qui ne renvoie qu'une phrase
  fixe. Déjà couvert par le test d'envoi en mode test de `integration.test.ts`.
- **Mode test sûr par défaut** : actif tant que `MAIL_MODE_TEST` n'est pas **explicitement**
  `false` (`apps/api/src/mail.ts`). Une variable absente, vide ou mal orthographiée reste du
  côté « n'envoie rien ». Testé en supprimant complètement la variable.
- **Pas de traversée de chemin par l'adresse** : le nom du fichier de test filtre
  `[^a-zA-Z0-9@.-]`, et un destinataire en `../../../windows/…` produit un fichier qui reste
  dans `sorties/mails`. Testé.

---

## 8. Observations sans gravité, non corrigées

1. **`GET /api/sante` renvoie le chemin absolu du fichier SQLite**
   (`apps/api/src/routes/sante.ts:14`), donc l'arborescence du poste. Assumé : c'est un
   diagnostic de premier lancement sur un produit local mono-utilisateur, et le nom du
   fichier ouvert est précisément l'information utile. Aucune action.
2. **`apps/api/src/ia/usages.ts:127` — `briefAvantMarche` est du code mort.** La route
   `/prevision/brief` utilise l'homonyme de `documents/gabarits.ts` (le gabarit PDF). La
   version « prompt » n'est appelée par personne. Laissée en place (hors périmètre d'un audit
   de sécurité), mais elle est couverte par les tests d'usages, donc elle ne peut pas dériver.
3. **Fenêtre de mois civil du plafond.** Le mois est déterminé en `Europe/Brussels`
   (`client.ts:68`) mais `depenseIaDuMois` borne la requête en UTC
   (`packages/db/src/depots/ia.ts:69`). Pendant une à deux heures au changement de mois, une
   dépense peut être rattachée au mois précédent. Impact au volume du projet : nul. Signalé
   pour mémoire, pas corrigé — la correction touche `packages/db`, hors de la zone d'écriture
   de cet audit.

---

## 9. Fichiers touchés

**Modifiés**

| Fichier                                   | Nature                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/core/src/ia.ts`                 | Ajout de `assainirDetailIa`, `raisonEchecIa`, `detailEchecPourJournal` (fonctions pures) |
| `apps/api/src/ia/client.ts`               | Le `catch` n'exporte plus de texte tiers ; ajout de `statutHttpDe`                       |
| `apps/api/src/mail.ts`                    | `normaliserEnTete` appliquée aux deux chemins ; message `smtp_port_invalide` sans valeur |
| `.env.example`                            | Deux variables fantômes retirées, règle de tenue documentée                              |
| `apps/api/src/routes/integration.test.ts` | Balayage anti-fuite étendu aux corps d'erreur (ajout seul)                               |

**Créés**

| Fichier                                 | Ce qu'il fige                                                            |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `packages/core/src/ia-securite.test.ts` | Assainissement et classification d'un échec (12 tests)                   |
| `apps/api/src/ia/client.test.ts`        | Mode dégradé, plafond avant dépense, chemin d'échec réel (8 tests)       |
| `apps/api/src/ia/usages.test.ts`        | Interdiction dans chaque usage, rien du poste dans les prompts (6 tests) |
| `apps/api/src/mail.securite.test.ts`    | Mode test, en-têtes, erreurs de configuration (8 tests)                  |
| `apps/api/src/securite-secrets.test.ts` | `.env.example`, confinement du front, bundle, dépôt (13 tests)           |

47 tests ajoutés. `npx vitest run` : 889 tests passent ; la seule défaillance
(`packages/db/src/services/commandes.test.ts`) porte sur un identifiant de fournisseur du jeu
de démonstration et n'a aucun rapport avec ce périmètre.

---

## 10. À consigner dans `docs/05-DECISIONS.md`

Voir la note de décision proposée par l'auditeur : **D-046 — Un texte que nous n'écrivons pas
ne franchit pas la frontière**, avec pour conséquences (a) la séparation entre la _raison_
affichée (déduite d'un statut, écrite par nous) et le _détail_ journalisé (assaini, borné),
(b) la règle de tenue de `.env.example` dans les deux sens, et (c) le principe qu'un mode test
doit simuler exactement ce qui serait parti.

> **Mise à jour du 30/07/2026 — le numéro a dérivé.** Cette décision a bien été consignée, avec
> exactement ce titre et ce contenu, mais sous **D-048**, pas D-046 (`docs/05-DECISIONS.md:1221`) —
> d'autres décisions ont pris les numéros D-046/D-047 entre-temps. Un lecteur qui chercherait
> « D-046 » dans le journal tomberait sur une décision sans rapport (le maillon zéro de la chaîne
> ERP). Se référer à **D-048**.
