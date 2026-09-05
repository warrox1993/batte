# Fiche 16 — Menus, vente en ligne et avis clients

> **Origine** : idées dictées par le porteur le 29/07/2026, mises en forme par Claude Code.
> **Statut** : brouillon à relire et amender. Rien n'est codé.
> **[À TRANCHER]** = décision attendue. **[HYPOTHÈSE]** = supposition de rédaction.
> **[VÉRIFIÉ]** = constat lu dans le code. **[ALERTE]** = point qui heurte une règle du projet.
>
> **Note de statut — 29/07/2026, vérifiée contre le code.** **Seul le volet MENUS (§2) est
> implémenté** : table `menu_composition`, `packages/core/src/menus.ts` (`ventilerMenu`),
> troisième nature `produit_vente.nature = 'menu'`. Les deux méthodes de répartition de la remise
> (prorata / composant à prix désigné) sont codées, et un menu peut contenir un produit revendu
> (§2.3, tranché : oui). **Recherche exhaustive faite le 29/07/2026 : aucune trace de « vente en
> ligne » ni d'« avis clients » nulle part dans le code** (`packages/`, `apps/`) — le volet §3
> (vente en ligne, avec son piège du double comptage marqué `[À TRANCHER]`) et le volet §4 (avis
> clients) restent des brouillons non codés, en l'état où le porteur les a laissés.

---

## 1. La demande, dans ses mots

> « Il faut aussi tenir compte que certains clients vont nous acheter des **lots**, par exemple des
> **menus types crêpes + café**. Ou bien les clients vont pouvoir nous **commander des produits sur
> notre futur site web**. D'ailleurs sur ce futur site web on va devoir rajouter les **ventes
> directement sur cette app**, et aussi les **avis clients sur Google** de mes stands. »

Trois demandes distinctes, de difficulté très inégale. La première est simple. Les deux autres
touchent une règle non négociable du projet, et méritent d'être lues avant d'être codées.

---

## 2. Les menus — simple en apparence, piégeux au chiffrage

### 2.1 Ce que c'est

Un menu « crêpe + café » est un **produit composé** : il consomme le stock de ses deux composants,
mais il a **son propre prix**, qui n'est pas la somme des prix.

C'est tout l'intérêt commercial : crêpe à 3,50 € + café à 2,00 € = 5,50 €, vendus 5,00 € en menu.

### 2.2 Le piège : où passent les 50 centimes de remise ?

C'est **le** point de cette section, et il ne saute pas aux yeux.

**[VÉRIFIÉ]** L'application ventile le chiffre d'affaires entre **transformé** et **revendu**, et
cette ventilation alimente les **compteurs de seuils légaux** (`CLAUDE.md` §6 : la franchise TVA
porte sur le CA, et la revente génère environ 2,6 fois plus de CA pour une même marge).

**[VÉRIFIÉ]** Elle suit aussi un drapeau `consommationSurPlace`, qui alimente un compteur distinct
(seuil SCE), parce qu'une vente à emporter n'est pas un service de restauration.

Donc un menu ne peut pas rester un bloc de 5,00 €. Il faut savoir **combien de ces 5 € sont du
transformé** et combien sont du revendu — sinon les compteurs de seuils deviennent faux, et c'est
exactement le genre d'erreur qu'on ne voit qu'au moment de sortir de la franchise TVA sans l'avoir
vu venir.

**[À TRANCHER]** Comment répartir la remise entre les composants :

- **au prorata des prix** — le café supporte 18 % de la remise, la crêpe 82 %. _Neutre, simple._
- **remise portée par un seul composant** — par exemple « le café est à 1,50 € dans le menu ».
  _Plus proche de la réalité commerciale, plus lisible._

**[HYPOTHÈSE de rédaction]** : le prorata. Il ne demande aucune saisie supplémentaire et reste
juste quel que soit le menu. La seconde option obligerait à décider, pour chaque menu, quel
composant « paie » la remise.

### 2.3 Le reste est facile

- Le **stock** : un menu vendu sort le stock de ses composants. C'est la nomenclature de vente de
  la **fiche 15** — encore elle. Un menu n'est qu'une nomenclature de vente de plus.
- Le **coût de revient** : somme des coûts des composants. Rien de neuf.
- La **marge** : elle baisse mécaniquement, et c'est voulu. L'écran doit pouvoir montrer la marge
  du menu à côté de celle des produits vendus séparément, sinon on ne saura jamais si le menu
  attire du volume ou grignote la marge.

**[À TRANCHER]** Un menu peut-il contenir un produit **revendu** (une bouteille de sirop) ? Si oui,
la ventilation du §2.2 devient obligatoire dès le premier menu.

---

## 3. La vente en ligne — **[ALERTE] collision avec une règle non négociable**

### 3.1 Le point à lire avant tout le reste

**[VÉRIFIÉ]** `CLAUDE.md` §3, règle 9, dit :

> « **Zéro donnée personnelle client en V1.** On compte des transactions et des paniers, pas des
> personnes. Pas de nom, pas d'e-mail, pas de fidélité nominative **tant qu'une base légale RGPD et
> une politique de conservation n'ont pas été écrites**. »

Or **une commande en ligne est impossible sans donnée personnelle**. Il faut au minimum un nom pour
remettre la commande, et un moyen de contact pour prévenir en cas de problème.

**Ce n'est pas un refus.** La règle ne dit pas « jamais », elle dit « pas avant qu'une base légale
et une durée de conservation soient écrites ». C'est un travail de cadrage, pas une ligne de code.

**[À TRANCHER]** Trois choses à écrire avant tout développement :

1. **La base légale** — pour une commande, c'est l'exécution du contrat. C'est la base la plus
   solide, et elle ne demande pas de consentement.
2. **La durée de conservation** — combien de temps garde-t-on le nom d'un client après le retrait
   de sa commande ? Une commande retirée et payée n'a plus besoin d'un nom.
3. **Le minimum nécessaire** — un prénom et un numéro de commande suffisent-ils ? Le RGPD demande
   de ne collecter que le strict nécessaire, et c'est aussi la solution la plus simple à coder.

**[HYPOTHÈSE de rédaction]** : viser un modèle où **l'application de gestion ne stocke jamais le
nom**. Le site web gère la commande et l'identité ; l'application ne reçoit qu'une ligne de vente
anonyme avec un numéro de commande. La règle 9 resterait alors intacte, et c'est la conception la
plus propre — pas seulement la plus prudente.

### 3.2 Faire remonter les ventes du site dans l'application

C'est le **même problème que le terminal de paiement**, déjà identifié : le travail n'est pas la
connexion, c'est la **correspondance des articles**.

Sans une table de correspondance entre les articles du site et les `produit_vente` de
l'application, on reçoit « Crêpe 3,50 € » sans savoir si c'est du transformé ou du revendu, ni si
c'est consommé sur place. Donc sans pouvoir ventiler, donc sans compteur de seuil juste.

**[À TRANCHER] Le vrai risque, propre à la vente en ligne : le double comptage.** Une commande
passée en ligne et **retirée au stand** peut être encaissée deux fois — une fois par le site, une
fois à la clôture. Il faut décider **qui fait foi** :

- la commande en ligne est déjà une vente, et la clôture ne doit pas la recompter ;
- ou la commande n'est qu'une réservation, et seule la remise au stand vaut vente.

**[HYPOTHÈSE]** la seconde : une commande non retirée n'est pas une vente. Mais alors une commande
**payée d'avance et non retirée** est un cas à traiter — c'est du chiffre d'affaires sans sortie de
stock.

### 3.3 Ce que ça implique côté hébergement

**[VÉRIFIÉ]** `CLAUDE.md` §2 fixe un coût d'infrastructure de **0 €/mois**, tout en local, et §7
interdit « toute dépendance payante ou service cloud sans validation explicite ».

Un site de commande est nécessairement hébergé. Ce n'est pas un obstacle — c'est une **décision à
prendre explicitement**, avec son coût, et à consigner dans `docs/05-DECISIONS.md`. Elle rejoint la
décision déjà ouverte sur la page web consultable depuis le stand.

---

## 4. Les avis Google — utile, mais poser d'abord la bonne question

### 4.1 À quoi ça sert, concrètement

La question honnête à se poser : **quelle décision un avis change-t-il ?**

Un compteur d'étoiles affiché sur un tableau de bord est une jolie statistique qui ne fait rien
faire. Mais il y a un usage réel, et il est bon :

> **Un avis est daté.** Croisé avec les sessions, il dit _quel jour_ quelque chose s'est mal passé —
> et l'application sait déjà ce qui s'est passé ce jour-là : quelle recette, quel lot de farine,
> quelle météo, quelle affluence, quel temps d'attente.

Un avis négatif isolé n'apprend rien. Un avis négatif **rattaché à une session** peut pointer un lot
de matière première ou une journée de rush. C'est la même logique que la traçabilité AFSCA, mais
côté client.

**[HYPOTHÈSE de rédaction]** : c'est le seul usage qui justifie le travail. Afficher une note
moyenne n'en vaut pas la peine.

### 4.2 Trois obstacles à connaître

1. **[ALERTE] Un avis contient une donnée personnelle** — le nom de son auteur. Même règle 9 qu'au
   §3. **[HYPOTHÈSE]** : ne jamais stocker l'auteur. Une note, une date, un texte suffisent à
   l'usage décrit ci-dessus.
2. **[ALERTE] C'est une dépendance cloud** — l'API Google Business Profile demande un compte
   Google, une authentification OAuth et des jetons à renouveler. `CLAUDE.md` §7 impose une
   validation explicite, et §2 rappelle que l'authentification OAuth avait été volontairement
   écartée de la V1 pour le mail.
3. **Un stand ambulant n'a pas forcément de fiche Google.** Une fiche d'établissement suppose une
   adresse. **[À TRANCHER]** : y a-t-il une fiche par marché, une fiche unique pour l'activité, ou
   les avis arrivent-ils ailleurs (Facebook, bouche-à-oreille) ?

**[HYPOTHÈSE de rédaction]** : commencer par une **saisie manuelle** d'un avis marquant, rattaché à
une session, en une ligne. Zéro dépendance, zéro OAuth, et cela vérifie que l'usage du §4.1 sert
vraiment à quelque chose avant d'automatiser quoi que ce soit.

---

## 5. Ce que ça implique, récapitulé

| Chantier                                                 | Effort                    | Bloqué par                   |
| -------------------------------------------------------- | ------------------------- | ---------------------------- |
| Menus (nomenclature de vente + répartition de la remise) | moyen                     | rien — dépend de la fiche 15 |
| Ventilation transformé/revendu dans un menu              | faible                    | décision §2.2                |
| Cadrage RGPD de la vente en ligne                        | **à écrire, pas à coder** | décision du porteur          |
| Correspondance articles site ↔ `produit_vente`           | moyen                     | même travail que le terminal |
| Règle anti-double-comptage commande/clôture              | moyen                     | décision §3.2                |
| Hébergement du site                                      | **décision**              | `CLAUDE.md` §2 et §7         |
| Avis rattachés aux sessions (saisie manuelle)            | faible                    | rien                         |
| Avis Google automatiques                                 | moyen                     | OAuth + validation §7        |

---

## 6. Liens

- **Fiche 15** — la nomenclature de vente ; un menu n'en est qu'un cas particulier.
- **Fiche 13** — le coût complet ; l'hébergement du site en devient une ligne.
- **`CLAUDE.md` §3 règle 9** — zéro donnée personnelle en V1. Le point dur de cette fiche.
- **`CLAUDE.md` §6** — les seuils légaux portent sur le CA ventilé. D'où le §2.2.

---

## 7. Mise à jour du 01/08/2026 — revérification par un agent documentaire

**Recherche refaite dans `packages/` et `apps/` : rien n'a changé sur les §3 et §4 depuis la
note du 29/07/2026.** Aucune trace de vente en ligne (commande, panier client, correspondance
d'articles) ni d'avis clients (Google ou saisie manuelle), sous quelque nom que ce soit — la
recherche a couvert aussi les variantes anglaises (`order`, `review`) et les noms de table qui
auraient pu porter l'un des deux (`utilisateur` n'a que `role: 'proprietaire' | 'collaborateur'`,
rien qui ressemble à un client). **Les deux `[ALERTE]` du §3.1 et du §4.2 restent entières et
non tranchées** : `CLAUDE.md` §3 règle 9 (zéro donnée personnelle client) contient toujours la
clause « tant qu'une base légale RGPD et une politique de conservation n'ont pas été écrites »
mot pour mot, et `CLAUDE.md` §7 (validation explicite pour toute dépendance cloud) est
inchangé. Cette mise à jour **ne tranche ni l'une ni l'autre** — elle confirme seulement qu'elles
sont toujours d'actualité et qu'aucun code ne les a contournées silencieusement.

**Le §2 (menus) est plus avancé que la note du 29/07/2026 ne le dit, avec une nuance
importante à connaître avant de considérer le §2.2 comme entièrement résolu.**

- **Ce qui est confirmé, complet et câblé** : les deux méthodes de répartition de la remise
  existent bien comme **une seule fonction pure**, `repartirPrixMenu` /
  `ventilerMenu` (`packages/core/src/menus.ts`) — `prixForceCents: null` sur tous les composants
  = prorata pur, posé sur un ou plusieurs composants = méthode « composant désigné » (fiche 16
  §2.2, option 2) pour ceux-là, prorata pour le reste. Le §2.3 (marge du menu affichée à côté de
  la marge séparée) est bien à l'écran : `VentilationMenu.margeSepareeCents` et
  `.ecartMargeCents` (`packages/core/src/menus.ts`), rendus dans `apps/web/src/pages/Menus.tsx`
  (lignes ~1001-1014). Le §2.3 « un menu peut contenir un revendu » reste tranché **oui**
  (`ComposantMenuCalcul.nature: NatureProduit`, sans restriction).
- **La nuance non documentée jusqu'ici** : la méthode « composant désigné » est **saisissable et
  persistée** depuis l'écran de composition du menu (`prix_force_cents` en base, écrit et lu par
  `packages/db/src/depots/menus.ts::creerCompositionMenu`/`modifierCompositionMenu`, exposé par
  `contrats/menus.ts::schemaSaisieCompositionMenu.prixForceCents` et affiché dans
  `Menus.tsx`, champ `prixForceCents` du formulaire) — mais elle **ne s'applique jamais à une
  vente réelle**. À la clôture d'une session, `packages/db/src/services/sessions.ts::exploserLigneMenu`
  construit chaque composant avec `prixForceCents: null` **en dur**, quel que soit le réglage
  enregistré pour ce menu, avec ce commentaire explicite à l'endroit même : « aucune méthode
  «composant désigné» (fiche 16 §2.2) à la clôture : ce réglage n'est pas persisté aujourd'hui ».
  **Ce commentaire est lui-même dépassé** : le réglage EST persisté (voir ci-dessus, écrit le
  30/07/2026 d'après l'horodatage du fichier), mais `exploserLigneMenu` — modifié le 31/07/2026,
  donc après — ne le lit pas. Autrement dit : **la méthode « composant désigné » existe et se
  voit dans l'écran de gestion des menus (simulation, catalogue), mais toute vente effective
  applique aujourd'hui le prorata pur, quel que soit le prix désigné enregistré pour ce menu.**
  Ce n'est ni « fait » ni « absent » au sens strict de cette fiche : c'est une fonctionnalité à
  moitié câblée, avec deux commentaires de code qui se contredisent sur son propre état — à
  vérifier auprès de qui a écrit `exploserLigneMenu` avant de considérer le §2.2 clos.
- **`consommationSurPlace`** : confirmé porté par le conteneur, jamais par composant
  (`packages/core/src/menus.ts:341,375`, repris à la clôture — un menu se vend toujours en un
  bloc, jamais mi-sur-place mi-emporté).

**Ce que l'application fait, que la fiche ne demandait pas explicitement** : les deux méthodes
de répartition ne sont pas un choix global pour l'application, mais un **réglage par composant
de menu** (`prixForceCents` individuel) — plus fin que l'alternative binaire envisagée au §2.2
(« au prorata » **ou** « portée par un composant désigné »). Un même menu peut donc avoir un
composant à prix désigné et d'autres au prorata simultanément, ce que le texte d'origine ne
distinguait pas.
