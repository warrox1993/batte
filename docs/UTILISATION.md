# Guide d'utilisation

Installation, lancement, configuration, sauvegarde et dépannage de Batte sur le poste de
l'exploitant. La présentation du projet est dans le [README](../README.md).

---

## Prérequis

- **Node.js 22 LTS ou plus récent** (`node --version`). Le paquet `better-sqlite3` est un module
  natif : il est téléchargé pré-compilé, aucun outil de compilation C++ n'est nécessaire.
- Un navigateur récent. Aucune base de données à installer : SQLite est un simple fichier.

---

## Premier démarrage, sur une machine vierge

```bash
npm install          # installe les 4 paquets de l'espace de travail
npm run db:init      # crée la base, applique les migrations, insère les données de référence
npm start            # construit l'interface puis lance l'application
```

Puis ouvrir **<http://127.0.0.1:3001>**.

`npm run db:init` n'est pas optionnel. Il insère les ~50 **paramètres** (seuils légaux, taux,
coefficients du moteur de prévision) sans lesquels les écrans _Seuils_, _Échéances_,
_Synthèse fiscale_ et _Assistance IA_ affichent une erreur. `CLAUDE.md` §7 interdit de coder ces
valeurs en dur : elles vivent en base, il faut donc les y mettre.

Le script est **rejouable sans risque** : il n'insère que ce qui manque.

### Données de démonstration (facultatif)

```bash
npm run db:seed:demo
```

Remplit une activité fictive complète (recettes, stock, sessions, comptabilité) pour découvrir
l'application sans saisir quoi que ce soit. À ne pas lancer sur une base réelle.

---

## Les deux façons de lancer

| Commande      | Pour qui                     | Ce qui tourne                                             | Où aller                                       |
| ------------- | ---------------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| `npm start`   | **usage quotidien**          | un seul processus : Fastify sert l'API **et** l'interface | <http://127.0.0.1:3001>                        |
| `npm run dev` | développement (rechargement) | deux processus : API sur `:3001`, Vite sur `:5173`        | <http://localhost:5173> — **pas** le port 3001 |

En développement, ouvrir `http://127.0.0.1:3001` **redirige** vers l'interface : ce port ne sert
que l'API. En production il n'y a **qu'une** adresse, c'est le principe de la décision
[D-012](05-DECISIONS.md).

Variantes utiles :

```bash
npm run start:api    # relance le serveur sans reconstruire l'interface
npm run build        # construit seulement l'interface (apps/web/dist)
PORT=3005 npm start  # change le port (sous PowerShell : $env:PORT='3005'; npm start)
```

> Une fenêtre sans onglet ni barre d'adresse :
> `chrome --app=http://127.0.0.1:3001`

---

## Configuration

Aucune configuration n'est **obligatoire** : sans fichier `.env`, l'application démarre et
fonctionne intégralement.

Pour l'assistance Claude ou l'envoi de bons de commande par mail :

```bash
cp .env.example .env   # PowerShell : Copy-Item .env.example .env
```

`.env.example` documente **exactement** les variables lues par le code, ni plus ni moins.

- **Sans `ANTHROPIC_API_KEY`** : mode dégradé complet. Tous les écrans restent utilisables ;
  seuls les commentaires rédigés par Claude sont annoncés comme indisponibles.
- **Sans configuration SMTP** : les bons de commande sont écrits dans `sorties/` au lieu d'être
  envoyés (`MAIL_MODE_TEST=true`).

---

## Sauvegarde et restauration

- La base est **un seul fichier** : `donnees/batte.sqlite`.
- À **chaque démarrage**, une copie horodatée et cohérente est écrite dans `sauvegardes/`
  (`VACUUM INTO`, pas une copie brute), et les copies de plus de 30 jours sont purgées.
- Pour restaurer : arrêter l'application, remplacer `donnees/batte.sqlite` par la copie choisie,
  supprimer les fichiers `batte.sqlite-wal` et `batte.sqlite-shm` s'ils subsistent, relancer.

**Arrêter l'application avec `Ctrl+C`** dans sa fenêtre. C'est ce geste qui replie le journal WAL
et rend le fichier `.sqlite` copiable tel quel (voir [D-033](05-DECISIONS.md)). Fermer la
fenêtre à la croix ou tuer le processus laisse les dernières écritures dans `batte.sqlite-wal` :
elles ne sont pas perdues, mais une sauvegarde faite en copiant le seul `.sqlite` serait
incomplète.

---

## Vérifications

```bash
npm run typecheck      # tsc --noEmit (Node + web)
npm run lint           # eslint
npm run test           # vitest
npm run test:couverture # vitest + seuils de couverture (vitest.config.ts)
npm run format:check   # prettier
npm run build          # construction de l'interface
```

Le script `.husky/pre-push` enchaîne ces étapes et bloque le push si l'une échoue. husky n'étant
pas une dépendance du projet, il ne s'exécute que si on le branche soi-même :
`git config core.hooksPath .husky`. L'intégration continue (`.github/workflows/ci.yml`) rejoue de
toute façon les mêmes vérifications, hors mesure de couverture, à chaque push sur `main` et sur
chaque pull request.

---

## En cas de problème

| Symptôme                                                          | Cause et remède                                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `listen EADDRINUSE ... 127.0.0.1:3001`                            | Une autre instance tourne déjà. La fermer, ou lancer sur un autre port (`PORT=3005`).                             |
| Page blanche, ou `404 Not Found` brut sur `http://127.0.0.1:3001` | L'interface n'a jamais été construite. Lancer `npm run build` (ou `npm start`, qui le fait).                      |
| « Le paramètre « … » n'est pas défini » sur plusieurs écrans      | La base n'a pas été ensemencée. Lancer `npm run db:seed`.                                                         |
| « Impossible de contacter le serveur »                            | L'API n'est pas démarrée. Vérifier la fenêtre de `npm start`, et `http://127.0.0.1:3001/api/sante`.               |
| `npm run dev` : la page ne se met pas à jour                      | Vérifier qu'on est bien sur <http://localhost:5173> et non sur `:3001`.                                           |
| Écran blanc après un `npm run build` alors que tout marchait      | Vider le cache du navigateur (`Ctrl+Maj+R`) : la page en cache réclame des fichiers renommés par la construction. |

Point de contrôle rapide : **<http://127.0.0.1:3001/api/sante>** indique quelle base est ouverte
et quels paramètres manquent encore.

---

## Ce que l'application ne fait pas

Elle **ne remplace pas** un comptable, un guichet d'entreprises ni l'AFSCA. Les écrans de synthèse
fiscale portent cette mention. Le registre d'autocontrôle enregistre ce qui a été saisi, avec sa
date de saisie réelle.
