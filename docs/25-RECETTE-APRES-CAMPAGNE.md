# 25 — Recette après la campagne de 25 agents

> Audit exécuté le 31/07/2026, en parallèle de trois agents qui écrivaient encore dans
> `packages/db/src/seed/`, `packages/core/src/sessions.ts`, `packages/db/src/depots/objectifs.ts`,
> `apps/web/src/pages/PrevisionCalendaire.tsx` et `TableauDeBord.tsx`. Instance isolée : API sur
> `127.0.0.1:4821`, web sur `127.0.0.1:4822`, base neuve dans le dossier temporaire de session,
> `migrer` + `seed` + `seed:demo`. Le serveur du porteur (3001/5173, base réelle) n'a reçu aucune
> requête de ma part, à une exception près décrite ci-dessous — la seule qui compte.

---

## 0. Incident — à lire avant tout le reste

**Mes commandes `npm run db:seed` et `npm run db:seed:demo` ont écrit dans la VRAIE base du
porteur** (`donnees/batte.sqlite`), pas dans ma base isolée. Ce n'est pas une hypothèse : je l'ai
prouvé en comparant la sauvegarde de démarrage `sauvegardes/batte-20260731-1347.sqlite` (prise
avant mes commandes) à l'état actuel de `donnees/batte.sqlite`, table par table et ligne par ligne.

**Cause exacte** : j'ai fixé les variables d'environnement (`CHEMIN_BASE` et consorts) et lancé
`npm run db:migrate` dans le **même appel** PowerShell — ce coup-là a correctement visé ma base
isolée. Mais `db:seed` et `db:seed:demo` ont été lancés dans **deux appels PowerShell séparés**, et
l'état du shell (variables d'environnement comprises) ne persiste pas d'un appel à l'autre dans cet
outillage. Ces deux commandes ont donc tourné avec `CHEMIN_BASE` non défini, c'est-à-dire sur le
chemin par défaut `./donnees/batte.sqlite` — la base réelle.

**Ce qui a été ajouté dans la vraie base** (confirmé par comparaison avant/après, IDs à l'appui) :

| Table                     | Lignes ajoutées | Détail                                                                                                                    |
| ------------------------- | :-------------: | ------------------------------------------------------------------------------------------------------------------------- |
| `ingredient`              |        8        | Sirop de Liège en vrac (seau 2,5 kg), Café moulu, Chicorée, Sucre en poudre, Eau, Cannelle, Gobelet carton, Crème liquide |
| `conditionnement`         |        8        | un conditionnement par ingrédient ci-dessus                                                                               |
| `recette`                 |        1        | `CAFE-VIDE v1` — « Café — recette vide (satisfait uniquement la règle de cohérence) », statut brouillon                   |
| `produit_vente`           |        1        | « [démo] Tasse de café à emporter »                                                                                       |
| `produit_garniture`       |        2        | rattachées aux produits « [démo] Crêpe froment / Sirop de Liège » et « / cassonade »                                      |
| `produit_vente_composant` |        9        | composants du café à emporter                                                                                             |
| `concurrent`              |        2        | « [démo] Crêperie du Quai », « [démo] La Petite Bretonne »                                                                |
| `concurrent_produit`      |        4        | prix relevés chez ces deux concurrents                                                                                    |
| `concurrent_observation`  |        2        | visites datées du 24/07 et du 17/07/2026                                                                                  |
| `reception`               |        2        | **`RC-2026-0007`** et **`RC-2026-0008`**, numéros réels de la série de numérotation                                       |

Tous les libellés sauf les 8 ingrédients/conditionnements portent le préfixe `[démo]` — repérables
par recherche du texte `[démo]` dans les écrans Produits, Concurrents, Stock. Les 8 ingrédients
n'ont pas ce préfixe : ce sont des ingrédients « café » plausibles (le porteur envisage une offre
café d'après `packages/db/src/schema.ts:153-158`), à évaluer au cas par cas plutôt qu'à retirer en
bloc.

**Ce qui n'est PAS de mon fait** : `parametre` a gagné 10 lignes (`prevision_demi_confiance_sessions`,
`evenement_coefficient_portee_*`, etc.), mais leur horodatage (`11:50:09Z`, soit 13:50 locale) précède
mon `db:seed` et ne correspond à aucune commande que j'aie lancée — `db:seed` n'appelle jamais de
migration, et son propre journal a rapporté « 0 paramètre(s) inséré(s), 99 déjà présent(s) » au
moment où je l'ai exécuté. C'est vraisemblablement le serveur `tsx watch` du porteur qui a rechargé
une migration ajoutée entretemps par un des trois agents en cours. Je le signale par honnêteté de
méthode, mais je ne le compte pas dans l'incident.

**Doctrine du projet, rappelée ici** (CLAUDE.md §3 règle 7, docs/07 §1.1) : rien ne s'efface, on
bloque. Je n'ai touché à rien pour « réparer » — ce n'est pas mon rôle et ça aurait ajouté une
seconde erreur à la première. Recommandation, à votre décision :

- Les deux réceptions `RC-2026-0007`/`RC-2026-0008` sont des **numéros de document réels consommés**
  dans une série qui, par doctrine (docs/07 §1.5), ne doit jamais avoir de trou ni d'écriture
  fantôme. La voie conforme est d'utiliser la fonction **« annuler la réception »** déjà existante
  dans l'écran Stock/Achats sur ces deux réceptions — ce qui pose le statut `annulee` (contrepassation
  tracée), plutôt qu'une suppression en base.
- Les autres lignes (ingrédients, produits, concurrents) portent un flag `actif` : les désactiver
  depuis leurs écrans respectifs si vous ne les voulez pas, plutôt qu'y toucher en base.
- Je n'ai aucune preuve que cet incident se reproduise sans la même faute méthodologique (deux
  commandes d'écriture dans deux invocations shell séparées, sans revalider l'environnement) — mais
  la leçon vaut d'être notée pour la prochaine session d'agent : **toujours regrouper la définition
  des variables d'environnement et la commande qui les utilise dans un seul appel**, ou écrire un
  script jetable qui les fixe et les consomme en un seul processus.

---

## 1. Combien d'écrans ouverts

**30 sur 30 routes de `App.tsx` ouvertes au moins une fois**, viewport calibré à un rendu CSS réel
de **1280×720** (vérifié par `document.documentElement.clientWidth/clientHeight`, pas par la taille
du PNG — la fenêtre Chrome pilotée par l'extension ne descend pas sous ~2552×1274 dans cet
environnement quels que soient les paramètres demandés à `resize_window`, donc j'ai basculé sur les
outils Playwright, dont `setViewportSize` répond correctement une fois calibré : demander 1600×900
donne bien 1280×720 réels, avec un `devicePixelRatio` de 1,25 mesuré sur cette machine).

**Profondeur de vérification, à deux niveaux** :

- **Chargement + captures + zéro erreur console sur les 30 routes** : Tableau de bord, Prochaine
  session, Besoins projetés, Production, Sessions, Stock, Stock/inventaire, Achats, Recettes,
  Produits, Fournisseurs, Événements, Comptabilité, Comparaison des lieux, Concurrents, Propositions
  IA (événements), Registre AFSCA, Qualité du modèle, Économies d'achat, Équipements, Factures
  fournisseur, Nomenclature de vente, Menus, Objectifs et succès, Où aller ?, Assistance IA, Journal
  d'audit, Ingrédients, Lieux de marché, Paramètres.
- **Interaction réelle (saisie, sauvegarde, focus, recherche de troncature en DOM)** : Sessions
  (clôture complète, deux tentatives ratées puis une réussie), Ingrédients (édition + sauvegarde),
  Nomenclature de vente (sélection produit), Produits (diagnostic d'un écran cassé), Fournisseurs
  (couleurs de statut), Concurrents (mesure de colonne), Propositions IA événements et Où aller ?
  (mesure d'en-têtes), Registre AFSCA (vérification du mois par défaut).

**39 captures**, nommées `NN-nom-ecran.png`, toutes dans le dossier temporaire de session
(`…/scratchpad/audit-25agents/captures/`) — aucune dans le dépôt. Chaque défaut ci-dessous cite son
fichier.

**Non fait, et pourquoi** : pas de test de saisie clavier complet sur les 30 écrans (budget de temps) ;
pas de stress avec des volumes de données artificiellement grands (des centaines d'ingrédients) — la
donnée « longue » utilisée est réelle : noms de recette/produit longs, dates, glyphes de statut,
générés par le seed de démonstration lui-même, pas fabriqués par moi. Section 7 détaille le reste.

---

## 2. Ce qui est cassé

### 2.1 Produits — « Erreur inattendue, sans plus de détail. » (capture `15-produits.png`)

Écran entièrement cassé au premier chargement : liste absente, seul le panneau de création
survit. **Diagnostic mené jusqu'au bout, pas seulement constaté** :

1. `GET /api/produits` répond bien `200`, mais chaque objet renvoyé **omet la clé `consommationUnite`**
   que le contrat Zod partagé `schemaProduit` (`packages/core/src/contrats/referentiel.ts:246`)
   déclare obligatoire (nullable, mais présente). `chargerProduits()` dans `Produits.tsx:430-433`
   fait `schemaListeProduits.parse(reponse)` côté client : ça lève, l'exception n'est pas une
   `ErreurApi`, donc le message générique s'affiche (`Produits.tsx:461-469`).
2. Vérifié que `listerProduits` (`packages/db/src/depots/referentiel.ts:304`) construit pourtant bien
   cette clé — le code source, lu au moment du diagnostic, est correct.
3. Cause réelle : **mon serveur API tournait depuis 14:02**, lancé en `node` simple (pas de
   `tsx watch`), donc figé sur le code chargé à cet instant. La migration `0029_bouncy_lady_
mastermind.sql` qui ajoute la colonne `consommation_unite` a été écrite à **14:23**, par un des
   agents en cours sur une zone qui n'était pas dans ma liste de fichiers surveillés. Mon processus
   ne pouvait pas la voir tourner.
4. **Vérifié en le corrigeant** : `npm run db:migrate` (colonne ajoutée à ma base isolée) n'a **pas**
   suffi (capture `16-produits-remigre.png`, toujours cassé) — la preuve que le code JS en mémoire de
   mon serveur, pas seulement le schéma SQL, était en cause. Après `taskkill` du PID exact et
   redémarrage propre du même serveur isolé, l'écran fonctionne (capture `17-produits-restart.png`,
   « 4 sur 4 produits »).

**Conclusion, telle que la mission le demande** : ce n'est **pas un défaut stable de la campagne**,
c'est un artefact de mon propre instantané de code pendant que quelqu'un d'autre le faisait évoluer.
Je le documente parce que le diagnostic est instructif, pas parce qu'il faut le corriger — il s'est
corrigé de lui-même. **Point de vigilance réel pour le porteur** : si son propre serveur de
développement (celui sur 3001) tourne depuis avant 14:23 aujourd'hui, son écran Produits est
probablement cassé en ce moment précis de la même façon, jusqu'à son prochain redémarrage — je n'ai
pas vérifié son serveur (interdit), donc ceci est une hypothèse à tester, pas un fait constaté.

### 2.2 Tableau de bord / Prochaine session — 404 sur `/api/prevision` (capture `42-tableau-bord-404.png`)

Repéré lors de ma repasse finale après redémarrage du serveur. **Ce n'est pas un défaut** : c'est un
404 sémantique voulu (`{"erreur":{"code":"aucune_session_planifiee", "message":"Aucune session à
venir. Créez-en une dans Sessions pour obtenir une prévision."}}`), déclenché parce que **j'ai
moi-même clôturé, pendant mes tests de focus (§6), l'unique session planifiée** du jeu de
démonstration. L'écran gère le cas proprement (état vide correct, capture jointe). Je le note pour
que le 404 visible dans la console ne soit pas repris à tort comme un bug par un lecteur pressé de ce
rapport.

---

## 3. Incohérences que la campagne a laissées ou introduites

### 3.1 Le vocabulaire de statut n'est PAS unifié visuellement

La mission demandait explicitement de vérifier l'unification annoncée. **Mesuré en DOM, pas
supposé** :

| Écran           | Colonne statut | Traitement                                                                                                    | Preuve                                                              |
| --------------- | -------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Sessions        | Statut         | glyphe `●` + texte coloré pour « Clôturée » ; **rien** pour « Planifiée »                                     | capture `04-sessions.png`, confirmé par le snapshot d'accessibilité |
| Fournisseurs    | Commande       | glyphe `▲`/`●` + texte coloré (`GLYPHE_STATUT`, `Fournisseurs.tsx:167-176`)                                   | capture `18-fournisseurs.png`                                       |
| Recettes        | Statut         | texte **brut, une seule couleur d'encre** (`rgb(63,63,70)` mesuré identique pour « Brouillon » et « Active ») | capture `14-recettes.png`, mesure `getComputedStyle`                |
| Produits        | Statut         | texte « En vente », **aucune couleur ni glyphe**                                                              | capture `17-produits-restart.png`                                   |
| Concurrents     | Statut         | texte « Actif », **aucune couleur ni glyphe**                                                                 | capture `22-concurrents.png`                                        |
| Lieux de marché | Statut         | texte « Actif », **aucune couleur ni glyphe**                                                                 | capture `40-lieux.png`                                              |

Trois traitements différents pour le même concept (« l'état d'une ligne ») : glyphe+couleur sur deux
écrans, texte neutre sur quatre autres, et sur Sessions lui-même, les deux valeurs possibles ne sont
pas traitées pareil. Ce n'est pas cosmétique : le §4.5 de `docs/07` fait du glyphe de statut le
**seul** mécanisme d'alerte autorisé dans un tableau (compatible daltonisme, lisible en PDF noir et
blanc) — sur quatre écrans, ce mécanisme est absent là où le concept de statut existe pourtant.

### 3.2 La ligne système de Fournisseurs cumule deux défauts de traitement

Le fournisseur système « Inventaire d'ouverture — origine non tracée » (créé par le seed de
référence, jamais par un utilisateur) :

- affiche **`systeme`** en colonne Type — minuscule, sans accent — parce que `TYPES` (la liste de
  types sélectionnables, `Fournisseurs.tsx:92-93`) ne contient pas cette valeur : `libelleType()`
  retombe sur la valeur brute de l'enum au lieu d'un libellé. Toutes les autres lignes affichent
  « Grossiste », « Ferme » correctement capitalisés.
- affiche **`▲ Sans e-mail`** en colonne Commande — alors que ce fournisseur ne reçoit jamais de bon
  de commande par construction (il sert uniquement à documenter un stock déjà en main, voir docs/06
  « Parcours de premier lancement » étape 5). Voir §4.1 ci-dessous : c'est un faux avertissement
  permanent.

Capture `18-fournisseurs.png`.

### 3.3 Une même donnée, deux formats de date différents à un clic d'écart

Sur l'écran Ingrédients, la fiche d'un ingrédient affiche ses conditionnements dans un sous-tableau
dont la colonne « Depuis le » montre **`2026-07-31`** (ISO brut) — alors que strictement toutes les
autres dates de l'application, y compris sur ce même écran et cette même page (dates de DLC sur
Stock, dates de session, dates de relevé) s'affichent `JJ/MM/AAAA`. Capture `39-ingredients-apres-
save.png`, colonne « Depuis le » du tableau « Conditionnements — Beurre ».

---

## 4. Avertissements qui crient pour rien

### 4.1 « Sans e-mail » sur le fournisseur système (déjà cité en §3.2)

Le fournisseur « Inventaire d'ouverture » ne sert jamais à passer une vraie commande — c'est
documenté dans son propre nom et dans docs/06. Or `statutFournisseur()` (`Fournisseurs.tsx:167-176`)
ne fait aucune exception pour `type === 'systeme'` : ce fournisseur affichera **`▲ Sans e-mail`**
pour toujours, quoi qu'on fasse, puisque personne ne va lui attribuer une adresse mail réelle. Un
avertissement qui ne peut structurellement jamais se résoudre est exactement ce que docs/07 §3.5
interdit (« aucune alerte non actionnable ») — celui-là n'est même pas actionnable _par construction_.

### 4.2 (à vérifier par le porteur, pas confirmé) « Réactif » sur le sirop de Liège malgré un déficit de 0

Sur Besoins projetés, la ligne « Sirop de Liège (pot 450 g) » porte le déclencheur **`▲ Réactif`**
dans le tableau « Commande anticipée », mais sa propre justification écrit noir sur blanc : « Sur la
fenêtre : besoin projeté 0 pièce, stock projeté 6 pièces, **déficit 0 pièce** ». Capture
`35-prevision-calendaire.png`. Je n'ai **pas** pu établir avec certitude si c'est contradictoire :
le texte explique qu'il s'agit d'un déclencheur réactif basé sur la consommation récente déjà sous le
point de commande _aujourd'hui_, distinct du déficit _de cette fenêtre_, ce qui est cohérent avec la
doctrine des deux rôles du point de commande (docs/07 §1.9). Mais la phrase, telle qu'écrite, peut se
lire comme « il faut commander alors qu'il ne manque rien » — à clarifier, pas à corriger en aveugle.

### 4.3 Deux avertissements qui, à l'inverse, sont bien calibrés (pour équilibrer ce rapport)

Vérifiés comme légitimes, pas comme des faux positifs, parce que je les ai déclenchés moi-même avec
des données que je connaissais :

- « Aucun relevé de température n'a été saisi à cette clôture » (Sessions, capture
  `10-sessions-cloture-final.png`) : je n'avais effectivement saisi aucune température. Le message
  explique pourquoi ce n'est pas corrigeable après coup et ne bloque pas la clôture — conforme à la
  doctrine.
- « Mode de facturation de l'électricité inconnu pour ce lieu » (même capture) : le lieu de
  démonstration n'a effectivement pas ce champ renseigné.

---

## 5. Ce qui déborde encore à 1280×720

Mesuré en DOM (`scrollWidth` vs `clientWidth`), pas seulement lu sur la capture — cf. la leçon du
dixième trou de `perimetre-des-verifications` sur les faux positifs de mesure visuelle.

| Écran                        | Élément                                                                                                                  | Mesuré                                                                                                  | Capture                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Sessions (clôture)           | 4 champs `<input type="file">` (Frais)                                                                                   | conteneur 160×16 px, texte natif « Choisir un fichier / Aucun fichier choisi » clippé en « Aucu…hoisi » | `06-sessions-cloture-scroll.png` |
| Concurrents                  | Colonne « Relevé le » (dates)                                                                                            | cellule 92–110 px de large, hauteur 47 à 83 px (norme 32 px) — la date `JJ/MM/AAAA` passe à la ligne    | `22-concurrents.png`             |
| Nomenclature de vente        | Colonne « Mode » (« Peu importe · Option »)                                                                              | 99 px disponibles, 144 px requis — tronqué en « Peu import… », le qualificatif « Option » disparaît     | `31-nomenclature-cafe.png`       |
| Propositions IA (événements) | En-têtes « Opportunité ? », « Rentabilité prévue »                                                                       | 92 px vs 109/136 px requis                                                                              | `23-propositions-evenements.png` |
| Où aller ? (Opportunités)    | 6 en-têtes sur 12 : Distance, Crêpes prévues, CA attendu (€), Déplacement (€), Emplacement (€), Marge nette attendue (€) | pire cas : 82 px disponibles pour 178 px requis (« Marge nette attendue (€) »)                          | `34-opportunites.png`            |
| Paramètres                   | En-tête « Version » → « VER… »                                                                                           | tronqué, mineur                                                                                         | `41-parametres.png`              |

Le principe cité mot pour mot dans le code lui-même (`Produits.tsx:349-350`, « un en-tête tronqué ne
se devine pas ») a bien été appliqué **sur l'écran qui porte le commentaire**, mais pas ailleurs :
c'est le même défaut, corrigé une fois, oublié quatre fois.

---

## 6. Le focus, écran par écran

| Écran / action                                             | Résultat mesuré (`document.activeElement`) | Jugement                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Sessions — ouverture de la clôture d'une session planifiée | premier champ « Qté » de la table Ventes   | conforme                                                                                    |
| Sessions — tentative d'enregistrement refusée (validation) | reste sur le bouton « Enregistrer »        | acceptable, mais docs/07 §4.7 demande le premier champ fautif — pas respecté à la lettre    |
| **Sessions — clôture réussie**                             | **`<body>`**                               | **défaut confirmé** — reproduit deux fois de suite (capture `09/10-sessions-cloture-*.png`) |
| Stock/Inventaire — ouverture de l'écran                    | select « Fournisseur »                     | conforme                                                                                    |
| Ingrédients — sélection d'une ligne dans la grille         | la ligne elle-même (`<tr>`), pas un champ  | conforme au mode « grille ARIA » de docs/07 §4.6                                            |
| **Ingrédients — enregistrement réussi d'une modification** | **`<body>`**                               | **défaut confirmé**, même symptôme que Sessions                                             |

Les deux pertes de focus sur `<body>` sont **le même défaut, sur deux écrans différents, tous deux
listés par la mission comme « déjà réparés »**. Ce n'est donc pas une régression neuve : c'est
l'ancien défaut décrit dans la mémoire du projet (« le focus retombe sur `<body>` … après un
enregistrement réussi »), toujours présent après la campagne, sur au moins ces deux écrans. Je ne l'ai
pas testé sur les trois autres écrans que la mémoire cite (Produits, Lieux, plus un) faute de temps —
voir §7.

---

## 7. Ce que je n'ai pas pu vérifier, et pourquoi

- **Focus** : testé en profondeur sur 2 écrans (Sessions, Ingrédients) sur les cinq que la campagne
  dit avoir corrigés. Produits, Lieux de marché et un cinquième écran non identifiés avec certitude
  ne sont pas passés au clavier réel — seulement chargés et lus visuellement.
- **Volume de données réellement massif** : mon jeu de démonstration compte 17 ingrédients, 4
  produits, 2 sessions — représentatif d'un usage réel (les noms longs et les glyphes de statut
  viennent de données authentiques, pas fabriquées pour l'audit), mais pas un test de charge à 200
  lignes. Les débordements du §5 sont donc probablement un plancher, pas un plafond.
- **Comptabilité, Registre AFSCA, Journal d'audit, Paramètres, Équipements, Factures, Économies,
  Menus, Événements, Comparaison des lieux, Qualité du modèle, Objectifs, Où aller ?, Assistance IA,
  Besoins projetés** : chargement, capture à 1280×720 et zéro erreur console vérifiés sur chacun,
  mais **pas** de saisie, sauvegarde ou navigation clavier complète — le temps imparti ne le
  permettait pas sur 30 écrans avec la rigueur exigée ailleurs.
- **Aucun appel réel à Claude ni à OpenRouteService** : `ANTHROPIC_API_KEY` et
  `OPENROUTESERVICE_API_KEY` laissées vides sur mon instance. Vérifié que Assistance IA affiche
  proprement le mode dégradé. Je n'ai cliqué ni « Demander un avis » (Assistance IA / Prochaine
  session) ni « Chercher des événements » (Propositions IA), les deux écrans que la mission signalait
  comme déclencheurs.
- **Aucun clic sur « Marquer faite » ni sur un bouton de clôture de période en Comptabilité**,
  conformément à la consigne.
- **TableauDeBord.tsx, PrevisionCalendaire.tsx, `packages/db/src/depots/objectifs.ts`,
  `packages/db/src/seed/`, `packages/core/src/sessions.ts`** : zones explicitement en chantier
  pendant mon audit. Ce que j'y ai vu (§2.2, Objectifs en §-, Besoins projetés en §4.2) est un
  instantané daté à 13h–15h le 31/07/2026, pas un état stable — à revérifier une fois ces agents
  terminés.
- **Le serveur réel du porteur (3001/5173)** : jamais interrogé, ni en lecture ni en écriture. Le
  risque décrit en §2.1 (écran Produits potentiellement cassé s'il tourne depuis avant 14:23) est une
  hypothèse non vérifiée, pas un fait constaté sur sa machine.

---

## 8. Nettoyage effectué

Processus API et web de l'instance isolée arrêtés par PID exact (`22172` et `3532`), jamais par nom.
Aucun fichier temporaire, capture ou configuration laissé à la racine du dépôt — vérifié par listage
après coup. Le dossier `.playwright-mcp/` (déjà ignoré par git, déjà partagé avec d'autres sessions
selon la mémoire du projet) n'a pas été purgé, pour ne pas risquer d'effacer le travail d'un agent
concurrent qui partage le même navigateur Playwright.
