# 12 — Audit du démarrage et de la parité développement / production

**Date** : 28/07/2026 · **Périmètre** : le chemin qu'emprunte un opérateur pour lancer
l'application, du dépôt fraîchement cloné à la première page affichée.
**Méthode** : exécution réelle. Serveur lancé sur un port libre (`3099`, puis `3098`), requêtes
HTTP réelles (`curl`), base vierge créée hors du dépôt. Aucune conclusion de cet audit ne repose
sur une lecture de code seule ; ce qui n'a pas pu être exécuté est signalé comme tel.

**Déclencheur.** `GET http://127.0.0.1:3001/` rendait `route_introuvable` en développement.
Ce comportement-là était correct — mais il a révélé que **personne n'avait jamais exécuté le mode
production**. Tous les audits précédents (docs 08 à 11) portaient sur le code en développement.

---

## 1. Verdict

**Le mode production ne démarrait pas. Il n'avait jamais démarré.** Le défaut a été reproduit,
puis corrigé pendant l'audit, puis la correction a été vérifiée par requêtes réelles.

### 1.1 Avant correction — reproduction

```
$env:NODE_ENV='production'; $env:PORT='3099'; node node_modules/tsx/dist/cli.mjs apps/api/src/serveur.ts
```

```
Base ouverte : C:\Users\<compte>\Desktop\AppCrepe\donnees\batte.sqlite
Sauvegarde de démarrage : ...\sauvegardes\batte-20260728-1635.sqlite (720896 octets)

Error: Not found handler already set for Fastify instance with prefix: '/'
    at Object.setNotFoundHandler (node_modules/fastify/lib/four-oh-four.js:96:13)
    at construireServeur (apps/api/src/serveur.ts:82:9)
```

Le processus mourait **avant** d'ouvrir le port. Aucune requête n'était donc servie, quelle
qu'elle soit.

**Cause.** `enregistrerGestionnaireErreurs(app)` posait déjà un `setNotFoundHandler` sur la
racine ; le bloc `if (NODE_ENV === 'production')` en posait un second sur la même instance.
Fastify n'en accepte qu'un par préfixe et lève au second. Le défaut était **structurel**, pas
conjoncturel : il se déclenchait à coup sûr, à chaque lancement.

**Aggravation constatée en cours d'audit** : la première rédaction du message d'accueil de
développement a dupliqué le même appel dans la branche `else`, ce qui a cassé le mode
développement aussi. Le port `3001` est resté fermé pendant ~20 minutes, `tsx watch` bouclant
sur le même crash. Symptôme trompeur : l'interface sur `:5173` répondait « Impossible de
contacter le serveur ».

### 1.2 Après correction — vérification par requêtes réelles

Correctif appliqué dans `apps/api/src/serveur.ts:64` : une **seule** inscription du gestionnaire
de route inconnue, passée en argument à `enregistrerGestionnaireErreurs`, dont le corps branche
sur le mode. `apps/api/src/plugins/erreurs.ts:163` reste le seul endroit du dépôt qui appelle
`setNotFoundHandler`.

`npm run build` puis `NODE_ENV=production PORT=3099` sur le `serveur.ts` réel :

| Requête                     | Code    | Type MIME                | Taille  | Attendu ?                                         |
| --------------------------- | ------- | ------------------------ | ------- | ------------------------------------------------- |
| `GET /`                     | **200** | `text/html`              | 455     | oui — la page de l'application                    |
| `GET /sessions`             | **200** | `text/html`              | 455     | oui — repli SPA                                   |
| `GET /stock/lots`           | **200** | `text/html`              | 455     | oui — repli SPA                                   |
| `GET /api/sante`            | **200** | `application/json`       | 108     | oui                                               |
| `GET /api/route-inconnue`   | **404** | `application/json`       | 93      | oui — `{"erreur":{"code":"route_introuvable",…}}` |
| `GET /favicon.svg`          | **200** | `image/svg+xml`          | 589     | oui                                               |
| `GET /assets/index-…​.js`   | **200** | `application/javascript` | 571 085 | oui                                               |
| `GET /assets/index-…​.css`  | **200** | `text/css`               | 18 403  | oui                                               |
| `GET /assets/inexistant.js` | **200** | `text/html`              | 455     | **non** — défaut n° 3                             |
| `POST /page-inconnue`       | 200     | `text/html`              | 455     | discutable — défaut n° 3 bis                      |

Le chemin `DOSSIER_WEB_PRODUCTION` calculé à l'exécution
(`C:\…\AppCrepe\apps\web\dist`) correspond exactement à la sortie de `npm run build`.
`config.racine` étant déduit de `packages/db/src` et **aucune compilation n'ayant lieu**
(D-011), le chemin est identique en développement et en production : ce risque-là n'existe pas
dans cette architecture.

**Mode développement**, vérifié séparément sur `:3098` avec le même fichier :

| Requête            | Code | Vers                             |
| ------------------ | ---- | -------------------------------- |
| `GET /`            | 302  | `http://localhost:5173/`         |
| `GET /sessions`    | 302  | `http://localhost:5173/sessions` |
| `GET /api/sante`   | 200  | —                                |
| `GET /api/inconnu` | 404  | JSON `route_introuvable`         |

La parité est donc établie dans les deux sens : `/api` se comporte pareil, et une adresse
d'interface mène à l'interface dans les deux modes.

---

## 2. Pourquoi la porte de sortie ne l'a pas vu

`npx vitest run` : **899 tests, 46 fichiers, tous verts** — pendant que le produit livrable ne
démarrait pas.

`apps/api/src/serveur.test.ts` appelle bien `construireServeur`, mais sous `NODE_ENV=test`.
**Aucun test du dépôt ne construisait le serveur en `NODE_ENV=production`.** La branche
production n'était donc pas « peu testée » : elle n'était **jamais exécutée**, ni par les tests,
ni par le développement quotidien. C'est exactement le mécanisme décrit en D-047 — une porte de
sortie verte parce qu'elle ne regarde pas au bon endroit.

**Corrigé** : `apps/api/src/demarrage.test.ts` construit le serveur avec `NODE_ENV` forcé à
`production` et vérifie la page rendue, le repli SPA, le 404 JSON de `/api` et le service des
actifs. Le bloc est **sauté** (et vitest l'annonce) si `apps/web/dist/index.html` n'existe pas —
sur un dépôt fraîchement cloné, l'absence de bundle n'est pas un défaut du code.

---

## 3. Le premier démarrage, sur une machine vierge

Test exécuté avec `CHEMIN_BASE` pointant sur un fichier inexistant, hors du dépôt.

**Ce qui marche déjà, et qui est bien fait :**

- La base est **créée et migrée automatiquement** (`apps/api/src/contexte.ts:23`). Aucun
  `db:migrate` manuel n'est nécessaire.
- Une **sauvegarde horodatée** est écrite avant la première requête HTTP.
- **Aucun fichier `.env` n'est nécessaire** : `--env-file-if-exists` ne bronche pas, et le mode
  dégradé IA est réel — sur base ensemencée, `GET /api/ia/etat` rend
  `{"configuree":false,"plafondMensuelCents":500,…}` en **200**, pas une erreur.

**Ce qui ne marche pas** — sur une base vierge, quatre écrans sont en erreur :

| Requête                      | Code    | Corps                                                           |
| ---------------------------- | ------- | --------------------------------------------------------------- |
| `GET /api/sante`             | 200     | `{"statut":"ok", "parametresManquants":[…49 clés…]}`            |
| `GET /api/seuils`            | **500** | `parametre_manquant` — `seuils_sessions_prevues_par_an`         |
| `GET /api/echeances`         | **500** | `parametre_manquant` — `echeance_horizon_alerte_jours`          |
| `GET /api/synthese-exercice` | **500** | `parametre_manquant` — `taux_cotisation_inasti_bp`              |
| `GET /api/ia/etat`           | **500** | `parametre_manquant` — `plafond_ia_mensuel_cents`               |
| `GET /api/prevision`         | 404     | `aucune_session_planifiee` — correct, c'est un état métier vide |

`creerContexte()` migre mais **n'ensemence pas**. `npm run db:seed` est un geste manuel, que
**rien n'annonçait** : ni la console au démarrage, ni un `README` (il n'y en avait aucun), ni la
documentation. L'opérateur ouvrait donc l'application, voyait quatre écrans en erreur, et n'avait
aucun moyen de savoir qu'il lui manquait une commande.

Le message d'erreur lui-même est bon (« Le paramètre « … » n'est pas défini. Renseignez-le dans
Paramètres avant de continuer. »), mais il envoie vers un écran où il faudrait saisir **cinquante**
valeurs à la main, alors qu'une commande les pose toutes.

**Corrigé par cet audit :**

- `README.md` — prérequis, premier démarrage, les deux façons de lancer, sauvegarde/restauration,
  tableau de dépannage. Toutes les commandes citées ont été exécutées.
- `package.json` — `npm run db:init` (= `db:migrate` puis `db:seed`), une seule commande pour
  rendre une base neuve utilisable. Vérifié sur base vierge : « 50 paramètre(s) inséré(s),
  13 motif(s), 10 tâche(s) de nettoyage, 1 fournisseur système, 5 échéance(s) ».

**Reste à faire** (hors du périmètre d'écriture de cet audit) : voir défauts n° 1 et n° 2.

---

## 4. Le lancement en production existait, mais il était piégé

`npm start` existait déjà (`package.json`) et pointait sur
`cross-env NODE_ENV=production tsx …` — la commande était donc juste, mais **inconnue** : aucun
document du dépôt ne la mentionnait.

Piège mesuré : `npm start` **sans** `npm run build` préalable démarre normalement — `@fastify/static`
n'objecte pas à un `root` inexistant — et rend sur `/` :

```
404 Not Found
```

Onze caractères, en anglais, sans la moindre indication. Le journal serveur ne dit rien non plus.

**Corrigé** : `"start": "npm run build && npm run start:api"`. La construction prend ~4 s, ce qui
est sans commune mesure avec le coût d'un écran blanc inexplicable. `npm run start:api` reste
disponible pour relancer sans reconstruire.

---

## 5. Les messages destinés à un humain

### Au démarrage

Deux lignes en français lisible, puis du JSON brut :

```
Base ouverte : C:\Users\<compte>\Desktop\AppCrepe\donnees\batte.sqlite
Sauvegarde de démarrage : ...\sauvegardes\batte-20260728-1655.sqlite (720896 octets)
{"level":30,"time":1785257709535,"pid":13092,"hostname":"<poste>","msg":"Server listening at http://127.0.0.1:3099"}
{"level":30,"time":1785257709536,"pid":13092,"hostname":"<poste>","msg":"API démarrée sur http://127.0.0.1:3099"}
```

Puis **deux lignes JSON par requête HTTP**, y compris pour chaque fichier d'actif. La ligne utile
(l'adresse) est noyée dans le bruit dès la première seconde d'usage.

### Port déjà occupé — testé

Deuxième instance lancée sur un port déjà servi :

```
{"level":50,"time":…,"err":{"type":"Error","message":"listen EADDRINUSE: address already in use 127.0.0.1:3099","stack":"Error: listen EADDRINUSE…\n    at Server.setupListenHandle (node:net:2008:16)\n    at listenInCluster (node:net:2065:12)…","code":"EADDRINUSE","errno":-4091,…}}
```

Une pile Node brute, en anglais, sur une seule ligne JSON. Le processus **s'arrête** correctement
(code 1) — il ne reste pas suspendu — mais il ne dit ni ce qui s'est passé, ni quoi faire.
C'est le cas le plus fréquent de tous : double-clic sur le raccourci alors que l'application
tourne déjà.

### Arrêt et journal WAL

D-033 promet que `fermerBase` replie le WAL à l'arrêt. Le chemin `SIGINT`/`SIGTERM`
(`apps/api/src/serveur.ts:174-175`) l'appelle bien, y compris si `app.close()` échoue. Mais
**trois** chemins de sortie ne l'appellent pas :

1. **Échec de `listen`** (`apps/api/src/serveur.ts:145`) : le `catch` journalise et pose
   `process.exitCode = 1`, sans `fermerBase`. Or la base a déjà été ouverte **et** une sauvegarde
   écrite par `creerContexte()`, appelé avant. Vérifié.
2. **Exception pendant `construireServeur`** : c'était exactement le cas du défaut critique
   ci-dessus. Base ouverte, sauvegarde écrite, processus mort, WAL non replié. Vérifié.
3. **Fermeture de la fenêtre console sous Windows** : `CTRL_CLOSE_EVENT` arrive dans Node sous
   la forme de `SIGHUP`, qui n'est **pas** écouté. Défaut par lecture de code : je n'ai pas pu
   fermer une fenêtre console de façon reproductible depuis un outil non interactif.

Mesure réelle du coût : après terminaison programmatique du serveur, `donnees/batte.sqlite-wal`
est resté à **12 392 octets, inchangé** — le point de contrôle n'avait pas eu lieu. Sous Windows,
tout arrêt programmatique (`Stop-Process`, `taskkill`, arrêt depuis un IDE, redémarrage de
`tsx watch` à chaque sauvegarde de fichier) est une terminaison brutale : les gestionnaires de
signaux ne s'exécutent pas. Seul un vrai `Ctrl+C` dans la console délivre `SIGINT`.

Aucune donnée n'est perdue dans ces cas — SQLite rejoue le WAL à la réouverture. Le risque est
celui, exact, que D-033 décrivait : **copier `batte.sqlite` seul donne alors une sauvegarde
silencieusement incomplète**. `README.md` le dit maintenant explicitement à l'utilisateur ;
c'est un pansement, pas un correctif.

---

## 6. Défauts, par gravité

### Corrigés pendant l'audit

| #   | Gravité      | Fichier                                 | Défaut                                                                     |
| --- | ------------ | --------------------------------------- | -------------------------------------------------------------------------- |
| C1  | **Critique** | `apps/api/src/serveur.ts:64`            | Double `setNotFoundHandler` — le mode production n'a jamais démarré        |
| C2  | Majeur       | `apps/api/src/demarrage.test.ts` (neuf) | Aucun test ne construisait le serveur en `NODE_ENV=production`             |
| C3  | Majeur       | `README.md` (neuf)                      | Aucune documentation de démarrage dans le dépôt                            |
| C4  | Majeur       | `package.json` (`start`, `db:init`)     | `npm start` sans build ⇒ `404 Not Found` brut ; pas de commande d'amorçage |

### Ouverts

| #     | Gravité    | Fichier:ligne                         | Défaut                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ---------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Majeur     | `apps/api/src/contexte.ts:23-32`      | Le premier démarrage migre mais n'ensemence pas — **toujours vrai le 30/07/2026** : `creerContexte` appelle `migrer(base)` mais n'importe ni n'appelle aucune fonction de seed. **« Et ne le dit pas » est en revanche corrigé** : `GET /api/sante` déduit désormais un statut `'incomplet'` et un champ `action` qui nomme le geste exact (« Lancez « npm run db:seed » ») — voir la ligne 2 ci-dessous.                                                                                                                    |
| ~~2~~ | ~~Majeur~~ | `apps/api/src/routes/sante.ts:13`     | **Corrigé le 30/07/2026.** ~~`statut: 'ok'` est écrit en dur…~~ Le statut est désormais **déduit** : `complet = lireParametres(base).clesManquantes().length === 0`, `statut` vaut `'ok'` ou `'incomplet'` en conséquence, et un champ `action` nomme le geste exact (`npm run db:seed`) quand des paramètres manquent. L'en-tête du fichier documente lui-même l'ancien défaut au passé (« Il valait `'ok'` en dur… La seule sonde du premier lancement rendait donc « tout va bien » au moment précis où rien n'allait »). |
| 3     | Moyen      | `apps/api/src/serveur.ts:74`          | Le repli SPA avale les actifs manquants : `/assets/x.js` absent rend `index.html` en **200 `text/html`**. Le navigateur refuse le module, écran blanc, rien au journal. Cas réel : page en cache après un `npm run build` qui a renommé les actifs. Encodé en `it.fails`.                                                                                                                                                                                                                                                    |
| 3bis  | Mineur     | idem                                  | Le repli répond aussi aux méthodes non-`GET` : `POST /page-inconnue` → 200 HTML.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4     | Moyen      | `apps/api/src/serveur.ts:145`         | Échec de `listen` : ni message en français, ni `fermerBase`. Pile `EADDRINUSE` brute en anglais pour le cas d'erreur le plus courant.                                                                                                                                                                                                                                                                                                                                                                                        |
| 5     | Moyen      | `apps/api/src/serveur.ts:174-175`     | `SIGHUP` non écouté : fermer la fenêtre console ne replie pas le WAL. Cf. § 5.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 6     | Mineur     | `apps/api/src/serveur.ts:141`         | Le journal de démarrage sort en JSON pino. L'adresse à ouvrir est noyée, et en développement elle désigne l'API, pas l'interface.                                                                                                                                                                                                                                                                                                                                                                                            |
| 7     | Mineur     | `apps/api/src/contexte.ts:27`         | Une sauvegarde est écrite **avant** que le serveur soit su démarrable : trois démarrages ratés d'affilée ont produit trois fichiers dans `sauvegardes/`. Borné par la déduplication à la minute.                                                                                                                                                                                                                                                                                                                             |
| 8     | Mineur     | `apps/web/src/lib/api.ts:80`          | « Vérifiez que l'API est démarrée (port 3001) » : le port est codé en dur dans le message, alors que `PORT` est configurable et qu'en production API et interface partagent le même port.                                                                                                                                                                                                                                                                                                                                    |
| 9     | Mineur     | `packages/core/src/horodatage.ts:107` | Les sauvegardes sont nommées en **UTC** (`batte-20260728-1635.sqlite` écrit à 18 h 35 belges). CLAUDE.md §3.8 veut l'affichage en heure locale, et un nom de fichier est ce que l'opérateur lit pour choisir quoi restaurer. En hiver l'écart est d'une heure, mais une sauvegarde faite à 00 h 30 locale porte la **date de la veille**.                                                                                                                                                                                    |

> **Mise à jour du 30/07/2026 sur ce tableau — items 3, 3bis, 4, 5, 6 et 9 corrigés ; item 7
> amélioré ; item 8 toujours vrai.**
>
> - **3 et 3bis (repli SPA avale les actifs manquants)** — corrigés. Le gestionnaire de route
>   inconnue de `apps/api/src/serveur.ts:77-110` refuse désormais explicitement un actif absent
>   ou une méthode non-`GET` en production (`attendUnFichier = requete.url.startsWith('/assets/')
|| /\.[a-z0-9]+$/i.test(requete.url)`, `:98-103`) avant tout repli sur `index.html`. Le
>   commentaire cite lui-même l'ancien défaut. Le `it.fails` mentionné n'existe plus :
>   `apps/api/src/demarrage.test.ts:97,162` porte la mention « NON-REGRESSION (ex-`it.fails`,
>   corrigé par D-052) », confirmant qu'il a été converti en test de non-régression normal —
>   cohérent avec le fait qu'aucun `it.fails(` actif ne subsiste dans le dépôt (vérifié par grep
>   exhaustif le 30/07/2026, voir aussi `docs/13-AUDIT-CAPACITES-ORPHELINES.md`).
> - **4 (EADDRINUSE sans `fermerBase`)** — corrigé. `apps/api/src/serveur.ts:206-227` : le
>   `.catch()` du `listen` distingue désormais `EADDRINUSE` avec un message français actionnable
>   (« Le port … est déjà utilisé : une autre instance de Batte tourne sans doute déjà. »,
>   `:217-221`) et appelle `fermerBase(base)` dans tous les cas (`:225`).
> - **5 (`SIGHUP` non écouté)** — corrigé. `apps/api/src/serveur.ts:267-268` écoute désormais
>   `SIGINT`, `SIGTERM`, `SIGHUP` **et** `SIGBREAK`, avec un commentaire qui cite explicitement le
>   cas Windows (fermeture de la fenêtre console) décrit ici.
> - **6 (adresse noyée dans le JSON pino)** — corrigé : une ligne `console.log` lisible est
>   ajoutée après le succès du `listen` (`apps/api/src/serveur.ts:199-204`), distincte du journal
>   pino, avec un message différent selon le mode (production / développement).
> - **9 (sauvegardes nommées en UTC)** — corrigé. `packages/core/src/horodatage.ts:106-134`
>   (`horodatageFichier`) est désormais explicitement « EN HEURE BELGE, PAS EN UTC », avec un
>   commentaire qui cite le défaut exact décrit ici (une sauvegarde de 00h30 locale portant la
>   date de la veille). Même correction que M6 de `docs/09-AUDIT-ARCHITECTURE.md`.
> - **7 (trois sauvegardes pour trois démarrages ratés)** — partiellement amélioré, pas
>   entièrement corrigé : `apps/api/src/contexte.ts` documente désormais (`:9-13`) une
>   sauvegarde plafonnée à **une par jour civil belge** (pas seulement « à la minute » comme
>   décrit ici), ce qui couvre le cas précis mesuré. Le second support hors du disque de la base,
>   lui, reste un geste opérateur non automatisé — inchangé.
> - **8 (port 3001 codé en dur dans le message d'erreur front)** — toujours vrai, revérifié :
>   `apps/web/src/lib/api.ts:74` affiche encore « Vérifiez que l'API est démarrée (port 3001). »,
>   littéralement, sans lire `PORT`.
> - **1 et 2** : déjà couverts par les mises à jour intégrées à ce même tableau ci-dessus,
>   non retouchées ici.

---

## 7. Correctifs proposés, non appliqués

Rédigés pour être appliqués tels quels par le porteur ; ils touchent des fichiers réservés ou
travaillés en parallèle.

### Défaut n° 1 — dire à l'écran qu'il faut ensemencer

Dans `apps/api/src/contexte.ts`, après `migrer(base)` :

```ts
// Le premier demarrage cree et migre la base, mais ne l'ensemence pas : sans
// les ~50 parametres, quatre ecrans rendent un 500 (docs/12). Rien ne le
// disait a l'operateur, qui n'avait aucun moyen de deviner `npm run db:seed`.
const manquants = lireParametres(base).clesManquantes();
if (manquants.length > 0) {
  console.warn(
    `Attention : ${manquants.length} paramètre(s) manquent en base. ` +
      `Plusieurs écrans seront en erreur tant que « npm run db:init » n'a pas été lancé.`,
  );
}
```

### Défaut n° 2 — `/api/sante` doit refléter l'état réel

Dans `apps/api/src/routes/sante.ts`, remplacer le `statut: 'ok'` en dur :

```ts
app.get('/sante', async () => {
  const manquantes = lireParametres(base).clesManquantes();
  return {
    // « ok » etait ecrit en dur : la sante etait verte avec 49 parametres
    // absents. Le seul point de controle du premier lancement (docs/06)
    // affirmait donc que tout allait bien sur une base inutilisable.
    statut: manquantes.length === 0 ? ('ok' as const) : ('incomplet' as const),
    base: sqliteBrut(base).name,
    parametresManquants: manquantes,
  };
});
```

Attention : `apps/api/src/serveur.test.ts` et l'écran qui consomme `/api/sante` attendent
`statut === 'ok'` — à ajuster en même temps.

### Défaut n° 3 — ne pas servir la page à la place d'un actif manquant

Dans le gestionnaire de route inconnue de `apps/api/src/serveur.ts`, avant le
`sendFile('index.html')` :

```ts
if (enProduction) {
  // Un actif absent n'est PAS une route du routeur client. Sans ce garde-fou,
  // `/assets/x.js` manquant rend index.html en 200 text/html, le navigateur
  // refuse le module et l'ecran reste blanc sans une ligne au journal — le cas
  // se produit avec une page en cache apres un build qui a renomme les actifs.
  if (requete.url.startsWith('/assets/') || requete.method !== 'GET') {
    envoyerReponse404(requete, reponse);
    return;
  }
  reponse.type('text/html').sendFile('index.html');
  return;
}
```

`apps/api/src/demarrage.test.ts` porte déjà le `it.fails` correspondant : il **passera au rouge**
le jour de la correction, ce qui force à le convertir en non-régression.

### Défauts n° 4, 5 et 6 — démarrage et arrêt

Dans le point d'entrée de `apps/api/src/serveur.ts` :

```ts
app
  .listen({ port, host: HOTE })
  .then(() => {
    // Une ligne lisible AVANT le journal JSON : c'est la seule que l'operateur
    // cherche. En developpement l'interface n'est pas ici (Vite, :5173).
    console.log(
      enProduction
        ? `\n  Batte est prêt : ouvrez http://${HOTE}:${port}\n`
        : `\n  API prête. L'interface est sur http://localhost:${PORT_VITE_DEV}\n`,
    );
  })
  .catch((erreur: unknown) => {
    // EADDRINUSE est de loin l'echec le plus frequent (double lancement). La
    // pile Node brute ne dit rien a un humain ; on nomme la cause et le remede.
    if (
      typeof erreur === 'object' &&
      erreur !== null &&
      'code' in erreur &&
      erreur.code === 'EADDRINUSE'
    ) {
      console.error(
        `\n  Le port ${port} est déjà utilisé : l'application tourne probablement déjà.\n` +
          `  Fermez l'autre fenêtre, ou lancez sur un autre port (PORT=3005).\n`,
      );
    } else {
      app.log.error(erreur);
    }
    // La base a ete ouverte et une sauvegarde ecrite par creerContexte() AVANT
    // ce point : sans cet appel, le journal WAL reste deplie (D-033).
    fermerBase(base);
    process.exitCode = 1;
  });
```

et, pour le défaut n° 5 :

```ts
// SIGHUP : sous Windows, fermer la fenetre console arrive sous cette forme.
// C'est un geste d'arret aussi courant que Ctrl+C, et il laissait le WAL
// deplie — donc une sauvegarde par copie du seul .sqlite incomplete (D-033).
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  process.on(signal, arreter);
}
```

Un garde-fou utile au même endroit, pour le piège du § 4 :

```ts
if (enProduction && !existsSync(DOSSIER_WEB_PRODUCTION)) {
  console.error(
    `\n  L'interface n'a pas été construite (${DOSSIER_WEB_PRODUCTION} est absent).\n` +
      `  Lancez « npm run build », ou « npm start » qui le fait pour vous.\n`,
  );
  process.exit(1);
}
```

---

## 8. Ce que cet audit a modifié

| Fichier                          | Nature                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `docs/12-AUDIT-DEMARRAGE.md`     | Ce document                                                                        |
| `README.md`                      | Neuf — la seule porte d'entrée d'un opérateur                                      |
| `apps/api/src/demarrage.test.ts` | Neuf — 9 tests : mode production, repli SPA, actifs, base vierge ; 2 en `it.fails` |
| `package.json`                   | `start` construit avant de servir ; `start:api` ; `db:init`                        |

Aucune route, aucun écran, aucun fichier baril n'a été touché.

## 9. Ce qui n'a pas pu être vérifié

- **Un vrai `Ctrl+C`** dans une console interactive : non reproductible depuis un outil non
  interactif. Le chemin `SIGINT` a été validé par lecture de code ; ce qui a été **mesuré**, c'est
  qu'une terminaison programmatique ne l'emprunte pas.
- **Le rendu visuel** de l'application servie en production : seuls le HTML, les types MIME et
  les tailles ont été vérifiés. Le bundle a été téléchargé intégralement (571 085 octets) et la
  page référence bien ses deux actifs, mais aucune capture d'écran n'a été prise.
- **La fermeture de la fenêtre console** (`SIGHUP`) : défaut établi par lecture de code seule.
