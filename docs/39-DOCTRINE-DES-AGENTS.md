# 39 — Doctrine des agents : ce que ce dépôt a payé pour apprendre

> **À lire avant d'écrire une ligne de code sur ce projet**, que l'on soit l'agent principal ou un
> agent délégué. Chaque règle ci-dessous vient d'un défaut **réel**, daté, qui a coûté du temps ou
> failli coûter un chiffre faux au porteur. Rien ici n'est une bonne pratique générique : ce sont des
> pièges rencontrés, avec l'incident qui les a révélés.
>
> Les règles du produit sont dans `CLAUDE.md`. Ce document ne les répète pas — il dit **comment
> travailler** pour ne pas retomber dans les mêmes trous.

---

## 1. Le vert ne prouve rien tant qu'on n'a pas mesuré son périmètre

C'est la règle mère. Toutes les autres en découlent.

`typecheck && lint && vitest && build` était **vert en permanence depuis le premier lot**. Personne
n'avait mesuré ce que cette porte regardait. Un audit a trouvé **sept trous**, dont :

- `vitest.config.ts` n'appartenait à **aucun projet TypeScript** — le fichier qui décide _quels tests
  tournent_ n'était jamais typé, et `apps/web` était absent de son `include`. Un test d'interface
  aurait été **vert par absence**.
- Le seuil de couverture de 80 % était déclaré et **physiquement inexécutable** : le provider n'était
  pas installé. Le seuil était une intention.
- La couverture affichée, **98,81 %**, ne regardait qu'**un paquet sur quatre**. La vraie valeur était
  **57,28 %**, et `apps/web` était à **18 %**.

**Comment appliquer** : avant de conclure quoi que ce soit d'un vert, dire **de quoi ce vert est le
vert**. Confronter la liste des fichiers sources à ceux réellement vus par l'outil. Tout écart est un
angle mort à nommer.

**Corollaire** : un test qui ne s'exécute pas est indiscernable d'un test qui passe.

---

## 2. Une liste écrite à la main ne prouve jamais une absence — D-045

Née d'une liste de routes rédigée à la main qui prétendait prouver une absence et **laissait passer
quatre routes de lecture**, dont `/api/recettes`.

**Il faut dériver de la source de vérité**, et la source de vérité n'est presque jamais celle qu'on
croit :

- pour les routes montées : la **table de routage de Fastify** (hook `onRoute` après `app.ready()`),
  **jamais** le code source des fichiers de route. Une route définie mais **non enregistrée** dans
  `serveur.ts` est invisible du serveur réel — c'est arrivé à `/api/palmares/*`, testée isolément,
  absente du vrai serveur ;
- pour les appels du web : une analyse d'appel par **équilibrage de parenthèses**, pas un `grep` sur
  des chaînes littérales. Ce dépôt **construit** ses URL ;
- pour un motif dans le code : attention aux **composants partagés**. Un balayage a compté
  **68 emplacements** là où il y en avait **90** — les 22 manquants passaient par un composant local,
  invisible de tout `grep` de classe CSS.

**Trois variantes du même piège, toutes rencontrées** :

1. le motif est juste mais **la sortie est tronquée** — un `grep | head -20` a rendu « zéro appelant »
   pour une fonction dont l'appelant réel tombait au **21ᵉ rang** ;
2. le motif rate une **forme d'écriture** — `app.get<{ Querystring: X }>('/audit', …)` est invisible
   d'un motif sans `(?:<…>)?` : **105 routes sur 182 disparaissaient** ;
3. le motif rate une **indirection** — `chemin="…"` en attribut littéral n'est pas trouvé par un
   `grep "chemin={"`.

**Comment appliquer** : quand vous écrivez « ceci n'existe nulle part », dites **comment vous l'avez
établi**. Si la réponse est « j'ai fait un grep », ce n'est pas établi.

---

## 3. La fixture aveugle — six instances, aucune détectable par la suite de tests

Un test **vert** dont la fixture ne peut **pas voir** le défaut qu'il prétend couvrir. C'est le
défaut le plus coûteux du dépôt : aucun n'avait jamais échoué, tous ont été découverts **par
accident**, quand un correctif de production les a rendus visibles.

**Trois formes, à distinguer** :

1. **Elle ment sur la situation** — du **futur** servant de passé. Des données de février servaient de
   « passé » à une cible de janvier. Sur le module concerné, l'estimation servie valait **145 crêpes
   en honnête contre 413 en contaminé**, un facteur 2,85 que personne ne voyait.
2. **Elle décrit un cas impossible** — la cible est placée avant toute occurrence utilisable ; le test
   vérifiait une admission que ses propres données ne pouvaient pas justifier.
3. **Elle est trop dégénérée pour discriminer** — elle ne ment pas, elle est simplement incapable de
   voir. Un tableau d'**une seule ligne** ne prouve rien sur une navigation par flèches. Une fixture
   où **tous les coûts sont connus** ne prouve rien sur l'affichage d'un coût inconnu. Un menu à deux
   composants **identiques** ne prouve rien sur une ventilation. Deux lots reçus **dans l'ordre
   chronologique** ne prouvent rien sur le FEFO — le test passerait aussi avec un simple FIFO.

### Une cinquieme forme, trouvee le 02/08/2026 : la promesse deja resolue

**Un test qui feint le reseau avec une promesse deja resolue ne peut voir AUCUN etat d'attente.**

Mesure : sur un ecran, `aria-disabled` a ete remplace par `disabled` natif — le defaut exact que ce
depot corrige depuis des mois, parce qu'un bouton `disabled` qui a le focus le PERD. **49 tests sont
restes verts.**

La cause est mecanique, donc reproductible partout : `mockResolvedValue(...)` rend une promesse deja
resolue. L'etat `envoi` retombe a `inactif` **dans le meme ecoulement de micro-taches** que sa pose.
Il n'atteint jamais le DOM. Tout ce qui ne vit que pendant l'aller-retour — bouton inerte, focus
conserve, second clic ignore, indicateur d'attente — est **structurellement invisible**.

**Ce qui rend cette forme dangereuse** : elle ne se voit sur aucun test pris isolement. Chacun est
bien ecrit, bien nomme, et vert pour une raison qui n'a rien a voir avec ce qu'il annonce.

**Comment appliquer** :

- **Pour tout ce qui vit pendant une requete**, feindre avec une **promesse controlee** — que le test
  resout lui-meme, apres avoir observe l'etat d'attente. `mockResolvedValue` ne convient que pour
  verifier le resultat, jamais le chemin.
- **La mutation qui le revele** : remplacer `aria-disabled` par `disabled`, ou retirer un garde-fou
  d'inertie. Si rien ne rougit, aucun test ne regarde l'attente.
- **Le soupcon vaut pour tout le depot** : environ mille tests montes ont ete ecrits en une journee,
  et ce piege est le meme partout ou une requete est feinte.

### Une quatrième forme, trouvée le 02/08/2026 : la fixture impossible UN JOUR SUR SEPT

Un test d'activation de prédicteur, écrit un **samedi**, est passé au rouge le **dimanche** — sans
qu'une ligne de code ait bougé.

La chaîne, démontrée et non supposée : la graine de démonstration plante sa session au **prochain
jour de marché du lieu**. À La Batte c'est le dimanche, et la fonction rend **le jour même** quand on
est déjà dimanche. L'horizon de prévision valait donc **0**, et le prédicteur d'écart météo refuse
par construction à horizon nul — une météo du jour même n'est plus une prévision.

**Le test décrivait un cas impossible un jour sur sept, et ce jour-là était arrivé.** C'est la forme 2
(« elle décrit un cas impossible »), mais **intermittente** — donc invisible six jours sur sept, et
indiscernable d'un défaut réel le septième.

**Comment appliquer** :

- **Une fixture qui dépend de `new Date()` dépend du jour où on la relit.** Si le scénario suppose un
  horizon, une ancienneté, un décalage — fige l'horloge, et fige-la sur une date **calculée** (« le
  mercredi le plus récent »), jamais sur une date absolue qui vieillira.
- **Ne corrige pas par une condition.** La tentation est d'écrire « si la session tombe aujourd'hui,
  la clôturer et en replanter une ». Le test suivrait alors **deux chemins selon le jour**, dont un
  jamais exercé le jour où on le relit — on remplacerait une fragilité par une fixture aveugle.
- **Un vert obtenu un jour donné ne prouve rien sur les six autres.** Le dire dans le rapport : après
  ce correctif, la suite `node` complète a été passée **un dimanche**, ce qui prouve l'absence de
  fragilité au dimanche — pas aux autres jours.

**Nuance qui a été trouvée en tentant d'écrire une garde** : la platitude d'un signal n'est pas
toujours un défaut. **Un signal plat, fort et constant est une fixture parfaitement légitime** —
c'était même l'objet déclaré d'un test. Vérifier **laquelle** des trois formes est en cause avant de
bâtir une garde contre la mauvaise.

**La seule preuve est la MUTATION.** Cassez la chose testée, obtenez le rouge, restaurez. Si une
mutation évidente ne fait pas rougir, ce n'est pas le test qui est robuste, c'est la fixture qui est
aveugle.

**Et quand un correctif fait tomber un test, ne demandez jamais « comment le faire passer »** —
demandez **« décrivait-il le bon comportement ? »**. Cinq fois sur cinq, la réponse a été non. Le
remède a toujours été d'étaler ou de diversifier les données, **jamais de baisser un seuil** : un
seuil baissé pour faire passer un test désarme le garde-fou en croyant le réparer.

---

## 4. La valeur inconnue vaut `null`, jamais `0`

C'est le mensonge le plus traqué du dépôt, parce qu'il est **plausible** : un coût matière à `0`
produit **100 % de marge**, un chiffre qui ne choque personne et qui est faux.

**Cas réels, tous corrigés** :

- une bouteille de pâte dont le coût valait `0` parce que la formule multipliait par un nombre de
  crêpes nul — marge affichée **98,7 %** sur de la farine, du lait et des œufs ;
- un coût qui échouait et **retombait sur `0`** face au plafond mensuel d'appels Claude ;
- un écart de prix concurrent rendu `0` sur un **premier relevé** — ce qui se lit « le prix n'a pas
  bougé », alors que la vérité est « on ne sait pas encore » ;
- un ratio calculé sur un prix précédent **nul**, où la division par zéro rendait silencieusement `0`.

**La distinction qui compte, et qu'il faut tenir partout** : `stable` (mesuré, égal, `0` **vrai**) et
`inconnu` (`null`) ne sont pas la même chose. À l'écran, « — » ou « inconnu », jamais « 0,00 € ».

**Attention au champ voisin** : un champ composant peut légitimement retomber à `0` si le **total**
est correctement `null` — mais alors **vérifiez qu'aucun écran n'affiche le composant seul**. Fait une
fois, en cherchant `coutPateCents` dans tout `apps/web` : une seule occurrence, dans une fixture. Le
mensonge n'atteignait pas le porteur.

---

## 5. La frontière HTTP supprime en silence ce qu'elle ne connaît pas

Payé **trois fois en une journée**.

- Un champ **fourni par le dépôt mais non déclaré** dans le contrat Zod de sortie est **supprimé
  silencieusement** : le dépôt calcule, personne ne voit, **rien ne le signale**.
- Un champ **déclaré mais non fourni** fait échouer le parse en **422** — bruyant, donc moins grave.
- Une fonction de dépôt **sans type de retour annoté** peut violer son contrat Zod **sans que `tsc`
  ne dise rien**. Ça a coûté **quatre routes en 422 d'un coup**.

**Comment appliquer** : quand vous touchez un contrat, **vérifiez les deux sens**. Et **annotez le
type de retour de toute fonction de dépôt** — l'inférence est ici un piège, pas un confort.

---

## 6. « Zéro appelant » est une question, pas une conclusion

Une capacité entièrement construite — route testée, dépôt testé, contrat écrit — **qu'aucun bouton
n'appelle jamais**. Attrapé **cinq fois séparément**, jamais par une relecture.

Mais l'inverse est un piège symétrique : une fonction a **failli être supprimée à tort**. Elle
paraissait doublon ; elle portait en réalité le seul champ permettant de répondre à « **quel lot de
pâte est issu d'une production ayant consommé ce lot rappelé ?** » — un geste de **rappel sanitaire**.

**Quatre issues possibles, et il faut dire laquelle** : (i) capacité oubliée à brancher ; (ii) brique
interne appelée côté serveur ; (iii) export ouvert par URL directe ; (iv) vrai mort-né à retirer.
**Un inventaire qui classe tout en « à brancher » ne vaut rien.**

**Ordre à suivre pour un retrait** : d'abord porter ce qui manque ailleurs, puis prouver la chaîne
complète par un test de bout en bout, **et seulement après** retirer. Le retrait vient en dernier,
jamais en premier.

**Distinction à tenir** : un **garde-fou de cohérence** inatteignable se garde (coût nul, redevient
utile si un contrat est assoupli) ; une **capacité** morte se retire.

---

## 7. Seul un parcours de bout en bout voit certains défauts

`CLAUDE.md` §0 dit que les modules forment **une seule chaîne de données**. Un test unitaire teste un
maillon ; il ne peut pas voir qu'un maillon correct **n'est branché à rien**.

Exemple vécu : `production.cout_matiere_reel_cents` était **écrit** par le service, **lu** par la
clôture de session — donc **facturé à la marge du marché** — et **exposé par aucune route de
lecture**. L'écran affichait le coût théorique pendant que la comptabilité facturait le réel. Aucun
test unitaire ne pouvait le voir : **la valeur est bien en base**. Aucun test de contrat non plus : le
contrat était cohérent avec lui-même.

**Ce qui rend un parcours utile**, et sans quoi il ne vaut rien :

- **des chiffres qui ne tombent pas rond** (733 c à répartir entre trois composants, 7 333 g à 689 c),
  sinon aucun défaut d'arrondi n'est visible ;
- **une valeur vérifiée à chaque étape**, pas seulement à la fin — sinon on ne sait pas où ça a cassé ;
- **un déséquilibre volontaire** : le tarif catalogue **différent** du prix payé, deux lots de tailles
  différentes. C'est ce qui prouve qu'une production est valorisée au prix du **lot** et non au
  catalogue ;
- **au moins un maillon cassé exprès**, avec le rouge montré. Un sabotage a fait se **contredire** la
  route de ventilation et la clôture — un test unitaire aurait été mis à jour et serait resté vert.

---

## 8. La convention `it.fails` — et la preuve qu'elle fonctionne

Quand un agent trouve un défaut **hors de sa zone d'écriture**, il ne le corrige pas : il écrit le
test qui le montre en **`it.fails`**, avec un commentaire qui explique ce qui est cassé.

**Ce n'est pas un pis-aller.** Démontré le 01/08/2026 : dès le champ manquant ajouté au contrat et au
dépôt, le `it.fails` est passé **au rouge** (« Expect test to fail ») et a signalé **de lui-même**
qu'il devait redevenir un test ordinaire.

**Un commentaire, lui, se serait périmé en silence.**

---

## 9. Quand le code et la documentation divergent, le code gagne — mais on vérifie chez l'appelant

Règle posée par le porteur : **0 régression, 0 suppression, 0 doublon, 0 code en dur**. Si
l'application a plus que la fiche, on **conserve l'application et on complète la fiche**.

Mais « le code gagne » ne se décide pas par principe — **il se vérifie chez l'appelant**. Un
commentaire affirmait qu'un champ envoyé « même à `null` » était refusé ; le code l'acceptait.
Départage : l'écran envoie `null` pour **tout produit non transformé**. Durcir aurait cassé
l'enregistrement de chaque menu et de chaque revendu — **une régression franche pour faire dire vrai à
un commentaire**.

**Et le journal des décisions ment aussi.** Sur 94 entrées, **12 écarts**, tous dans le même sens : le
journal est **en retard** sur le code. Cinq décisions se déclaraient « à implémenter » alors qu'elles
étaient livrées. Deux affirmaient qu'un état n'était atteignable par aucun chemin de production — il
l'était, par un bouton.

**Comment appliquer** : une affirmation d'**absence** lue dans un document doit être **revérifiée dans
le code** avant de servir d'argument pour refuser du travail. C'est D-045 appliqué au journal
lui-même.

---

## 10. Les pièges d'outillage, qui font perdre des heures pour rien

- **`vitest -t "motif"` ne rejoue QUE les tests filtrés.** Un fichier peut être vert en filtré et
  rouge en entier. **Toujours rejouer le fichier entier.**
- **`vi.setConfig({...})` appelé DANS un `beforeAll` ne s'applique jamais** — Vitest fige les délais à
  la collecte. Il doit être au niveau du module, et `hookTimeout` doit être relevé aussi.
- **L'état du shell ne persiste PAS entre deux appels de terminal.** `npm run db:seed` écrit sur la
  **base réelle du porteur** si les variables d'environnement sont posées dans un appel _séparé_.
  Deux agents s'y sont fait prendre et ont consommé deux numéros de réception réels.
- **Ne comparez jamais un texte formaté à un littéral tapé à la main.** `formaterEuros` passe par
  `Intl`, qui insère une espace **insécable** avant le `€`. Deux chaînes visuellement identiques,
  jamais égales. Le danger symétrique est pire : `toContain('3,80')` passe aussi bien sur « 3,80 € »
  que sur « 3,80 c ». **Comparez via le formateur du projet.**
- **`devicePixelRatio` n'est pas constant** : mesuré à **1,25** dans une instance Chromium isolée, à
  **1** dans la fenêtre du porteur. Ne supposez rien : **mesurez
  `document.documentElement.clientWidth`** et ne faites jamais confiance à la taille demandée. Un
  audit a déclaré 19 écrans cassés à tort pour avoir mesuré la taille du fichier PNG.
- **jsdom n'implémente ni `scrollIntoView` ni `URL.createObjectURL`.** Ils sont posés une fois pour
  toutes dans `apps/web/src/test-setup.ts` — leur absence produit une erreur qui accuse le
  **composant** au lieu de l'**environnement**.
- **Un `rg` défini comme fonction de shell n'est pas hérité** par `bash script.sh` : l'outil n'a
  simplement pas tourné, et le résultat vide passait pour une absence.
- **Deux fichiers de ce depot contiennent un octet NUL** (une chaine hostile de test).
  `grep` les traite alors comme **binaires et les saute EN SILENCE** :
  `packages/db/src/depots/productions.ts` et `apps/api/src/routes/integration.test.ts`.
  Un balayage les rate sans rien dire, et le resultat vide passe pour une absence.
  **Utilisez `grep -a`.** Meme famille que le `rg` non herite : l'outil n'a pas regarde,
  il n'a pas dit non.
- **`testTimeout` pose a la RACINE de `test:` n'est PAS herite par les projets Vitest.**
  Le correctif a ete ecrit, verifie... et le message d'echec disait toujours
  « timed out in **5000ms** ». Il faut le repeter DANS CHAQUE projet. Meme famille que le
  `vi.setConfig()` dans un `beforeAll` : un reglage pose la ou il _semble_ juste, et que rien
  ne lit. **La seule verification qui vaille est de relire le delai annonce dans le message
  d'echec**, jamais de relire la configuration.
- **Une sortie de couverture concurrente casse** (`ENOENT coverage/.tmp/…`) : quand plusieurs agents
  mesurent en parallèle, écrire le rapport dans un dossier **isolé**.

---

## 11. Travailler à plusieurs agents sans se marcher dessus

- **Zones d'écriture disjointes, annoncées dans le prompt**, y compris ce qui est _interdit_ et
  pourquoi. Un agent qui croise un rouge dans un fichier qu'il n'a **jamais ouvert** doit le
  **signaler et continuer**, jamais le corriger.
- **Ne jamais donner à un agent une affirmation qu'on n'a pas vérifiée soi-même.** J'ai dit à un agent
  qu'un état n'était écrit par aucun chemin de production ; c'était faux, et j'ai failli lui faire
  supprimer un avertissement légitime.
- **Un rapport d'agent n'est pas une vérité.** Un « point de blocage » signalé s'est révélé
  inexistant après vérification directe. Les échecs « transitoires » signalés par plusieurs agents
  étaient des artefacts d'édition concurrente — confirmés en rejouant.
- **Ne poser une garde qui balaie le code source qu'une fois les zones libérées.** Sinon elle produit
  des rouges intermittents impossibles à interpréter.

---

## 12. Ce qu'on n'invente jamais

- **Un LLM ne calcule pas.** Aucun chiffre produit par Claude n'entre en base. Toute sortie qui
  alimente la base passe par un schéma Zod strict, est marquée `source = 'ia'`, et exige une
  validation humaine.
- **Aucune valeur métier en dur** : taux, seuils, échéances, seuils légaux vont dans la table
  `parametre`, avec date de validité et source.
- **Aucun appel réel à l'API Anthropic** dans un test ou une vérification : le porteur paie chaque
  appel. Le mode dégradé se vérifie sans clé.
- **Aucune requête d'écriture vers le serveur du porteur** (`127.0.0.1:3001`, `:5173`) : il tourne sur
  sa **vraie base**. La lecture `GET` est permise.
- **Interdits absolus** : `npm run db:reset`, écrire sur `donnees/batte.sqlite`, `npm run build`, tuer
  un process node qui n'est pas le sien, installer une dépendance sans accord explicite.

---

## 13. Ce qu'il faut dire dans un rapport, et que presque personne ne dit

**« Ce que mes tests ne prouvent pas. »** C'est la section la plus utile d'un rapport, et la seule qui
empêche le lecteur de surestimer ce qu'il vient de recevoir.

Les meilleurs rapports de ce projet disent, par exemple : que la couverture mesurée est celle d'une
zone **par les tests de cette zone**, et ne dit rien de la façon dont les trente écrans exercent ces
composants ; que deux parcours sur cinq **n'ont jamais été vus échouer** sur un maillon débranché,
donc que leur pouvoir de détection est moins établi ; que jsdom ne calcule **aucun style**, donc que
l'anneau de focus et le contraste restent à vérifier au navigateur.

**Dire ce qu'on n'a pas prouvé n'affaiblit pas un rapport : c'est ce qui le rend utilisable.**

---

## 14. Le coût caché du travail à plusieurs agents : la pourriture de commentaires à l'heure

Mesuré le 01/08/2026 par un audit des commentaires, et **c'est le coût le moins prévu de la méthode
suivie dans ce projet**.

On imagine qu'un commentaire devient faux par dérive lente : vrai à l'écriture, faux des mois plus
tard. **Ce n'est pas ce qui se passe ici.** Sur les 23 commentaires contredisant leur code,
**19 ont été rendus faux le jour même de leur rédaction, par un autre agent travaillant en
parallèle.**

La forme est toujours la même :

> L'agent A écrit « X n'est pas encore câblé, `packages/db` est hors de ma zone d'écriture ».
> L'agent B câble X dans l'heure. **Le commentaire de A survit.**

Le dépôt **fabrique** donc sa propre pourriture, à la vitesse de l'heure et non du mois. Trois
familles mesurées :

| Motif                                               | Occurrences | Vérifiées | Fausses |
| --------------------------------------------------- | ----------- | --------- | ------- |
| « ni `jsdom` ni `@testing-library` n'est installé » | 43          | 43        | **43**  |
| « pas encore branché / aucun appelant »             | 92          | ~22       | **20**  |
| Renvois `fichier.ts:NNN`                            | 87          | 87        | **26**  |

Les 43 de la première ligne étaient **tous vrais le matin même** : les dépendances ont été
installées à midi. Plusieurs renvoient le lecteur à `vitest.config.ts` **comme preuve** — le fichier
qui, désormais, les contredit.

### Ce qui aggrave, et qui est une convention à trancher

**49 commentaires figent une contrainte d'organisation transitoire dans la documentation
permanente** : « hors zone d'écriture de cet agent », « voir le rapport de livraison de cet agent ».
S'y ajoutent 134 mentions de « cet agent », « cette mission », « ce chantier ».

Pour qui relit dans six mois, « hors zone d'écriture de cet agent » **ne désigne rien** : ni quel
agent, ni quelle zone, ni quel jour. Et les rapports cités ne sont pas dans le dépôt.

**Ce n'est pas de la mémoire de décision, c'est de la mémoire de session** — et c'est le terreau
exact des 20 mensonges de la deuxième famille.

### Ce qu'il faut faire, et ne pas faire

- **N'écrivez jamais dans un commentaire une affirmation sur l'état d'un AUTRE fichier** — « pas
  encore branché », « aucun appelant », « déclaré `z.int()` ailleurs ». Elle sera fausse avant la fin
  de la journée. Si l'information compte, elle va dans le **rapport** ou dans une **tâche**, pas dans
  le code.
- **N'écrivez jamais « hors de ma zone d'écriture »** : c'est vrai pour vous une heure, faux pour le
  fichier à jamais. Écrivez ce qui manque, pas qui n'avait pas le droit de le faire.
- **Ne citez pas un numéro de ligne** d'un autre fichier. Sur 87 renvois, 26 étaient périmés, et deux
  pointaient vers un paragraphe **plausible portant sur une autre règle réglementaire** — plus
  trompeur que de ne pointer nulle part. Citez le **symbole**, jamais la ligne.
- **Un commentaire qui raconte l'histoire d'une décision reste un actif** (« retiré le 01/08, et il a
  failli l'être à tort »). La densité de commentaires de ce dépôt n'est pas le problème : c'est
  l'affirmation sur autrui qui l'est.

### Le pire cas rencontré, et pourquoi il justifie tout ce paragraphe

Un commentaire **prescrivait** d'assouplir deux contrats « dans le même mouvement que la migration de
`lieu_marche.distance_km` en `real` ». Les deux contrats étaient **déjà** assouplis, et cette
migration avait été **essayée sur une copie de la base réelle du porteur, où elle a échoué**
(`FOREIGN KEY constraint failed`) — abandonnée, pas différée.

Un lecteur obéissant aurait tenté une reconstruction de table référencée par les sessions et les
observations météo. **C'est le seul commentaire du dépôt qui pouvait coûter une base.**

### Un mensonge de citation, répété 275 fois

`CLAUDE.md` §7 dit : « Ne pas introduire de dépendance **payante ou de service cloud** sans
validation explicite. » 275 commentaires citent ce paragraphe ; l'échantillon vérifié le rend le plus
souvent par « **aucune dépendance nouvelle** sans validation explicite ».

L'élargissement de « payante ou cloud » à « nouvelle » est **la prémisse qui a justifié 43
commentaires** et retardé de plusieurs semaines l'installation de `jsdom` — une dépendance de
développement gratuite. **La charte ne l'a jamais dit.** Quand un commentaire cite une règle,
rouvrez la règle.
