# Fiche 14 — Les événements deviennent des opportunités

> **Origine** : idées dictées par le porteur le 29/07/2026, mises en forme par Claude Code.
> **Statut** : brouillon à relire et amender par le porteur. Rien n'est codé.
> **Dépend de la fiche 13** (coût complet et arbitrage entre lieux) : sans marge nette par lieu,
> une opportunité ne peut pas être classée.
>
> **Note de statut — 29/07/2026, vérifiée contre le code.** Largement implémenté
> (`packages/core/src/opportunites.ts`, `packages/db/src/depots/opportunites.ts`,
> `apps/api/src/routes/opportunites.ts`) : la table `evenement` porte désormais `famille`
> (_grand_public | entreprise | marche_noel_), `effectif_estime`, `distance_km`, `commune_texte`
> (migration 0018) ; la famille `entreprise` utilise l'effectif × un taux de prise **mesuré**
> (`tauxPriseEntrepriseObserve`, jamais transposé d'une entreprise à une autre, D-059) ; la famille
> `marche_noel` retient l'hypothèse « une session par jour » d'une campagne. **Reste
> `[À TRANCHER]`, non résolu par le code** : la première prévision pour un lieu `grand_public`
> jamais visité (§3.1) — le code reste explicitement silencieux (`null`) tant qu'aucune session n'y
> a eu lieu, sans trancher laquelle des options proposées (affluence annoncée, session comparable,
> démarrage à froid) adopter. Les autres `[À TRANCHER]` ci-dessous n'ont pas été revérifiés un par
> un dans cette passe.
>
> **⚠️ Périmé sur ce point précis — voir la « Note de statut — 01/08/2026 » en fin de fiche.** Le
> point ci-dessus, présenté comme non résolu, **a été tranché le lendemain de cette note** par
> **D-082** (31/07/2026, `docs/05-DECISIONS.md`) et est câblé dans le code.

---

## 1. La demande, dans ses mots

> « Au niveau **marché**, on doit tenir compte de **tous les événements régionaux** (tant que je
> reste en Wallonie). On doit rajouter aussi les **événements entreprises** et mettre un stand
> devant l'entreprise pour leurs employés. Ensuite on pourra rajouter les **marchés de Noël**, et
> par exemple les **villages gaulois**, **événements médiévaux** dans la région, **feux
> d'artifice**. »

Précision donnée ensuite, et elle est décisive :

> « Quand je parle d'opportunité, c'est **pour être sur le lieu de l'opportunité**. »

---

## 2. Le changement de nature — le point à ne pas rater

L'application connaît déjà les événements. Mais **pas dans ce sens-là**.

|                | Aujourd'hui                                          | Ce qui est demandé                        |
| -------------- | ---------------------------------------------------- | ----------------------------------------- |
| Rôle           | un **facteur**                                       | une **opportunité**                       |
| Effet          | multiplie la fréquentation d'une session déjà prévue | **crée une session** qui n'existerait pas |
| Lieu           | ailleurs, mais à proximité du marché                 | **on s'y rend**                           |
| Question posée | « combien de crêpes en plus ? »                      | « **est-ce que j'y vais ?** »             |

Une fête médiévale à 60 km ne dope pas La Batte. C'est **un autre marché**, un autre jour, avec son
propre trajet, son propre emplacement, sa propre prévision — et sa propre marge nette.

D'où la dépendance à la fiche 13 : comparer deux opportunités, c'est comparer deux marges nettes,
déplacement compris.

---

## 3. Les familles d'opportunités ne se ressemblent pas

C'est le second point important : ces événements ne se prévoient pas de la même façon.

### 3.1 Événement grand public (fête médiévale, village gaulois, feu d'artifice)

- Fréquentation **inconnue à l'avance**, souvent estimée par l'organisateur (donc optimiste).
- Très sensible à la météo — comme La Batte.
- Concurrence probable : d'autres stands de nourriture.
- **[À TRANCHER]** Sur quoi s'appuie la première prévision quand on n'y est jamais allé ?
  L'affluence annoncée ? Une session comparable ? Le démarrage à froid de `docs/03` ?

### 3.2 Événement d'entreprise — le cas le plus favorable, et le plus différent

Un stand devant une entreprise, à midi, pour les employés.

- Public **captif et dénombrable** : l'effectif est connu **à l'avance**.
- Créneau **étroit** : la pause de midi, pas six heures et demie.
- Concurrence **nulle ou faible**.
- Météo **beaucoup moins déterminante** : on est adossé au bâtiment, les gens sortent de toute façon.

> **Conséquence de modélisation** : le prédicteur naturel n'est pas l'historique de fréquentation,
> c'est **l'effectif × un taux de prise**. Le moteur actuel ne sait pas faire ça — c'est une
> famille de prévision différente, pas un paramètre de plus.

**[À TRANCHER]** Le taux de prise (quelle part des employés achète) est le chiffre clé. Il ne peut
venir que de l'observation : la première fois est un pari, ensuite il s'apprend.

**[À TRANCHER]** Une entreprise, ça se démarche. Est-ce que l'application doit garder trace des
contacts pris, des relances, des réponses ? Attention : **CLAUDE.md §3 règle 9 interdit toute
donnée personnelle client en V1**. Un contact d'entreprise n'est pas un client au sens du RGPD,
mais un nom et un e-mail de responsable en sont bien. À cadrer avant de coder.

### 3.3 Marché de Noël

- **Plusieurs jours consécutifs**, parfois plusieurs semaines.
- Emplacement loué **à la semaine ou au forfait** — le mode de tarification existe déjà dans
  `lieuMarche` (`metre_lineaire_mois` / `jour` / `forfait`).
- Le déplacement se répète chaque jour : le coût kilométrique est multiplié par le nombre de jours.
- Saisonnalité forte et **demande différente** (chaud, sucré, en soirée).

**[À TRANCHER]** Est-ce une session par jour, ou une « campagne » regroupant plusieurs sessions ?
**[HYPOTHÈSE]** une session par jour, regroupées par un identifiant commun — sinon la comparaison
avec un dimanche à La Batte ne veut plus rien dire.

---

## 4. « Tant que je reste en Wallonie »

**[À TRANCHER]** Comment traduire cette contrainte.

Ce n'est **pas** un rayon en kilomètres. Un rayon de 80 km autour de Liège attrape Maastricht,
Aix-la-Chapelle et une partie de la Flandre. « La Wallonie » est une contrainte **administrative**,
pas géométrique.

Deux filtres différents, à ne pas confondre :

- **le rayon** — jusqu'où je suis prêt à me déplacer (question de coût, cf. fiche 13) ;
- **la région** — où j'ai le droit / l'envie d'exercer (question de cadre).

**[À TRANCHER]** Y a-t-il une raison réglementaire derrière « rester en Wallonie » (autorisation
d'ambulant, AFSCA, langue des documents), ou est-ce une préférence pratique ? La réponse change
si c'est un filtre dur ou un simple tri.

---

## 5. Ce que ça change pour la fiche 05 (découverte par l'IA)

La fiche 05 était conçue comme un **confort de prévision** : trouver les événements proches pour
mieux ajuster le facteur de fréquentation.

Avec cette fiche, elle devient de la **prospection commerciale** : trouver où aller vendre.

C'est un changement de valeur, pas seulement de portée. **Elle mérite de remonter dans l'ordre de
priorité.**

Rappel du garde-fou CLAUDE.md §3 règle 2 : **un LLM ne calcule jamais**. Claude peut proposer une
liste d'événements et leurs dates ; il ne produit aucun chiffre de fréquentation ni aucune
prévision. Toute donnée issue de l'IA entre en base marquée `source = 'ia'`, après validation
humaine explicite.

---

## 6. Le parcours visé, en une phrase

> Ouvrir un écran « Où aller ? », voir une liste d'opportunités classées par **marge nette
> attendue**, déplacement compris — et décider.

Ce que la liste doit montrer pour chaque ligne :

| Colonne                  | Source                                     |
| ------------------------ | ------------------------------------------ |
| Événement, date, lieu    | saisi ou proposé par l'IA (validé)         |
| Distance                 | fiche 13                                   |
| Prévision de vente       | moteur, selon la famille (§3)              |
| CA attendu               | prévision × prix moyen                     |
| Coûts variables          | matière + emplacement + trajet + gaz       |
| **Marge nette attendue** | la colonne qui sert à trier                |
| Fiabilité                | forte / faible selon qu'on y est déjà allé |

**La colonne « fiabilité » n'est pas décorative** : une prévision pour un lieu inconnu vaut moins
qu'une prévision pour La Batte, où l'historique est réel. Afficher les deux au même niveau
tromperait la décision.

---

## 7. Questions ouvertes récapitulées

1. Premier chiffrage d'un événement grand public jamais fait ?
2. Taux de prise pour une entreprise : quelle valeur de départ ?
3. Faut-il tracer la prospection d'entreprises, et sous quel cadre RGPD ?
4. Marché de Noël : une session par jour, ou une campagne ?
5. « Wallonie » : filtre dur réglementaire ou préférence ?
6. Que faire d'une opportunité qui **tombe le même jour** qu'un marché habituel ? Elle entre en
   concurrence avec La Batte, pas seulement avec les autres opportunités.

---

## Note de statut — 01/08/2026, vérifiée contre le code

### Question 1 — TRANCHÉE et implémentée : D-082

La note du 29/07/2026 en tête de fiche affirmait que le premier chiffrage d'un lieu `grand_public`
jamais visité restait `[À TRANCHER]`, non résolu par le code. **C'est devenu faux le lendemain** :
**D-082** (`docs/05-DECISIONS.md`, 31/07/2026, _« Un lieu JAMAIS visité ne reçoit AUCUNE
prévision, et "Où aller ?" n'affiche que des faits connus »_) tranche explicitement, avec les
trois options de la fiche soumises et départagées :

- Option retenue : **zéro session close sur ce lieu → aucune prévision**, jamais un chiffre
  inventé (ni l'affluence annoncée par l'organisateur, ni une extrapolation depuis un lieu
  comparable). L'écran dit _« premier passage, aucune prévision possible »_.
- **Conséquence sur le classement de l'écran « Où aller ? »**, tranchée dans la même décision :
  les lignes sans prévision ne remontent jamais par un revenu supposé — elles se classent entre
  elles par **coût connu croissant** (déplacement + emplacement), jamais par une marge inventée.

**Vérifié dans le code**, pas seulement dans la décision :

- `apps/api/src/routes/opportunites.ts` (en-tête de fichier) cite D-082 explicitement et implémente
  le tri décrit ci-dessus.
- `packages/core/src/prevision/baseline.ts::estPremierPassage` — le seuil partagé avec l'écran
  « Prochaine session » qui détecte ce cas.
- `packages/db/src/depots/previsions.ts:274::observationsDuLieu` — filtre bien par lieu, confirmé
  par D-082 lui-même comme le point de départ de la vérification.

**Ce que cette mission n'a pas revérifié** : l'exécution réelle des tests (`npm run test` non
lancé, consigne de la mission) — l'existence du câblage est établie par lecture du code, pas par
exécution.

### Questions 2 et 4 — TRANCHÉES et implémentées (pas seulement par hypothèse de rédaction)

- **Question 2 (taux de prise entreprise)** : `packages/core/src/opportunites.ts` implémente
  `previsionCrepesEntreprise` (effectif × taux de prise) et surtout
  `tauxPriseEntrepriseObserve` — la boucle de mesure complète (D-059, « les facteurs ne se
  demandent pas au porteur, ils s'apprennent »). `session_marche.evenement_id` (migration 0020)
  relie une session close à l'entreprise qui l'a motivée ; le taux ne se moyenne **jamais** entre
  deux entreprises différentes (piège documenté explicitement dans le code : « une entreprise de
  200 personnes avec une cantine et une entreprise de 40 sans rien n'ont aucune raison d'avoir le
  même taux »). Tant qu'une entreprise donnée n'a pas assez d'observations à elle
  (`opportunite_entreprise_observations_minimum`), le taux reste `null` — jamais deviné.
- **Question 4 (marché de Noël, campagne vs session par jour)** : `nombreSessionsCampagne`
  (`opportunites.ts`) retient l'hypothèse de rédaction de la fiche (§3.3 : une session par jour),
  et `coutEmplacementCampagneCents`/`coutDeplacementCampagneCents` étendent les coûts de la fiche
  13 à une campagne de plusieurs jours consécutifs (répétant le déplacement chaque jour,
  répétant ou non l'emplacement selon son mode de tarification).

### Questions 3, 5, 6 — TOUJOURS `[À TRANCHER]`, rien dans le code

Vérifié par recherche exhaustive (schéma, dépôts, routes, écran) : **rien n'a changé** sur ces
trois points depuis la rédaction de la fiche.

- **Question 3 (traçer la prospection d'entreprises, cadre RGPD)** : aucune colonne
  `contact_nom`/`contact_email` (ou équivalent) n'existe sur `evenement` — seules `effectifEstime`
  et `communeTexte` ont été ajoutées (migration 0018). **D-007** (`docs/05-DECISIONS.md`, « Aucune
  donnée personnelle client en V1 ») existe déjà, mais elle porte sur les **clients**, pas sur un
  contact professionnel d'entreprise démarchée — la fiche elle-même signale que ce n'est pas la
  même question RGPD (« un contact d'entreprise n'est pas un client au sens du RGPD, mais un nom
  et un e-mail de responsable en sont bien »). D-007 ne répond donc pas à cette question 3 par
  extension automatique.
- **Question 5 (« Wallonie » : rayon ou filtre régional)** : aucune colonne de région/province
  n'existe sur `lieu_marche` ni `evenement`. Aucun filtre de ce type dans
  `apps/api/src/routes/opportunites.ts` ni dans `Opportunites.tsx`.
- **Question 6 (opportunité le même jour qu'un marché habituel)** : aucune détection de collision
  de date entre une opportunité et une session régulière prévue (La Batte) dans le dépôt ou la
  route `opportunites`.

### Récapitulatif pour le rapport de mission

| Question fiche 14 §7                         | État                                                               |
| -------------------------------------------- | ------------------------------------------------------------------ |
| 1. Premier chiffrage grand public            | **Tranché et câblé** (D-082, 31/07/2026)                           |
| 2. Taux de prise entreprise                  | **Tranché et câblé** (D-059 + `tauxPriseEntrepriseObserve`)        |
| 3. Prospection RGPD                          | **Ouvert** — rien dans le code                                     |
| 4. Marché de Noël : session/jour ou campagne | **Tranché et câblé** (hypothèse de rédaction retenue, implémentée) |
| 5. Filtre Wallonie                           | **Ouvert** — rien dans le code                                     |
| 6. Collision avec un marché habituel         | **Ouvert** — rien dans le code                                     |
