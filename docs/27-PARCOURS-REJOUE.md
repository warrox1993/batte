# 27 — Parcours rejoué (31/07/2026)

> Rejeu complet du parcours d'une semaine, au navigateur, sur une **instance isolée** :
> API sur `http://127.0.0.1:4891`, interface sur `http://localhost:4892`, base SQLite neuve
> dans le dossier temporaire de session, `migrer` + `seed` + `seed:demo`. Le serveur du porteur
> (`:3001` / `:5173`, base réelle `donnees/batte.sqlite`) n'a reçu aucune requête — vérifié par
> `GET /api/sante` sur les deux instances avant et après le test, qui renvoient deux chemins de
> base différents (voir §7). Aucun appel Claude n'a été déclenché. Aucun fichier du dépôt n'a
> été modifié en dehors de celui-ci.
>
> Rejoue `docs/14-TEST-PARCOURS-UTILISATEUR.md`, dont la mise à jour du 30/07/2026 affirmait
> sept correctifs sans avoir rejoué le parcours complet. C'est ce rejeu-là.

---

## 1. Les trois nombres

| Catégorie                 | Compte | Détail                                                                                        |
| ------------------------- | :----: | --------------------------------------------------------------------------------------------- |
| **Arrêts durs**           | **0**  | Aucun des deux arrêts durs de docs/14 ne s'est reproduit, et je n'en ai trouvé aucun nouveau. |
| **Impasses silencieuses** | **1**  | Le mail « Envoyée » (G14) : l'écran ne dit jamais qu'il est en mode test.                     |
| **Gestes introuvables**   | **0**  | Chaque fonctionnalité rencontrée était accessible depuis un écran qui y mène directement.     |

Le verdict du 28/07 (« il s'arrête deux fois, et il ment une fois de plus ») **n'est plus l'état
du code**. Les deux arrêts (G3, G4) sont fermés et je les ai reproduits fermés moi-même, avec
des données que j'ai saisies de zéro — pas seulement en relisant l'affirmation de docs/14.

---

## 2. Le sort des sept points de docs/14 — un par un, avec preuve

### 1. Mardi — réception du meunier → **Passe, toujours.**

Réception RC-2026-0005 enregistrée au clavier (fournisseur → Tab×4 → n° BL → ligne → Ctrl+Entrée) :
2 pots de sirop rattachés à la commande CF-2026-0001. Message :
`Réception RC-2026-0005 enregistrée — 1 lot créé, 115,20 €. Commande CF-2026-0001 soldée.`
Le montant collait exactement au total de la commande. La commande est passée de « Envoyée » à
« Reçue » automatiquement.

### 2. Mercredi — commande → **Corrigé. G3 fermé.**

Geste rejoué à l'identique : Achats → CF-2026-0001 (brouillon) → **Valider la commande**.

- Réseau : `POST /api/commandes/{id}/valider → 200` (au lieu de 400).
- Écran : statut passe à « Validée », puis le bloc « Envoyer au fournisseur » apparaît.
- Testé une seconde fois avec l'envoi par email : `Envoyée à meunier-test@example.be le
31/07/2026.` (voir toutefois §3, ce message ment sur le mode test — G14, non corrigé).

### 3. Samedi — prévision → **Passe, et l'excès du 28/07 est réglé (G7 fermé).**

`Prochaine session` recommandait 170 crêpes sur l'historique brut, mais affiche :

> **28 crêpes** — ▲ _Ramené de 170 à 28 — limite : stock d'ingrédients. Manque à gagner estimé :
> 225,34 €._

Le tableau « CE QUI VOUS LIMITE » liste désormais trois contraintes : capacité de cuisson (331),
capacité de la glacière (360), et **stock d'ingrédients (28)** — celle qui manquait en docs/14.
Une quatrième ligne, « volume transportable », s'affiche honnêtement comme _non contrôlée_ tant
que la capacité du véhicule n'est pas saisie, plutôt que de l'ignorer en silence.

Passé ensuite dans Production avec la cible à 28 crêpes : `Réalisable avec le stock actuel`,
tous les ingrédients à `OK` (sucre vanillé 37 g requis / 38 g disponible — la marge est réelle,
pas un hasard d'arrondi). Le moteur et l'écran de faisabilité sont maintenant cohérents entre eux.

### 4. Dimanche matin — production → **Passe, et la jointure qui manquait est là (G1, moitié production).**

Sur l'écran **Production**, le formulaire de création porte maintenant un champ
« Session de destination (optionnel) ». Production PR-2026-0002 lancée avec 28 crêpes cible,
rattachée dès la création à **SM-2026-0001 (02/08/2026 — La Batte)**. Le panneau de détail
confirme : « SESSION DE VENTE — Rattachée à SM-2026-0001 », avec un contrôle « Rattacher à »
pour changer après coup. FEFO non re-testé en détail (pas de lot périmé dans la chaîne
farine/lait/œufs de ce jeu de données neuf), mais la consommation a bien été journalisée
lot par lot dans le tableau CONSOMMATIONS. Réalisé saisi : 26 crêpes (écart de rendement −7,1 %,
calculé et affiché correctement).

### 5. Dimanche soir — clôture → **Passe, et le mensonge de marge est corrigé (G1, moitié clôture).**

Clôture de SM-2026-0001 rejouée entièrement au clavier : 18 crêpes sirop + 6 crêpes cassonade +
2 pots revendus + 3 cafés, fonds 0,00 €, espèces 40 €, carte 62 €, 24 tickets.

Résultat affiché, vérifié à la main :

| Poste                  | Affiché                          |
| ---------------------- | -------------------------------- |
| CA total               | 102,00 €                         |
| **Coût matière réel**  | **20,51 €**                      |
| Marge brute            | 81,49 € (= 102,00 − 20,51 ✓)     |
| Commission carte       | 1,05 €                           |
| Marge nette            | 80,44 € (= 81,49 − 1,05 ✓)       |
| Panier moyen           | 4,25 € (= 102,00 / 24 tickets ✓) |
| Coût matière par crêpe | 0,45 €                           |

**20,51 € n'est plus seulement le coût de la revente.** Avec 2 pots de sirop revendus à un CUMP
de 4,80 €/pièce (9,60 €), le reste (≈ 10,91 €) ne peut s'expliquer que par une part de la pâte
produite (PR-2026-0002, 7,12 € de matière théorique pour le lot) et le café vendu malgré un
stock insuffisant (voir §3). C'est exactement le mécanisme que G1 disait manquant : la marge
n'est plus calculée en ignorant la pâte. Marge nette 80,44/102 = 78,8 % — un chiffre plausible,
**pas** le piège « 100 % de marge » que la mission demandait de traquer.

`packages/db/src/services/sessions.ts` (agrégation par `production.sessionId`) et
`apps/web/src/pages/Production.tsx` (champ de rattachement) sont bien ceux cités par la mise à
jour du 30/07 — mais je ne me suis pas fiée à cette citation : le calcul ci-dessus est reconstruit
à la main sur des données que j'ai saisies moi-même, pas sur le jeu de démonstration déjà en base.

### 6. Lundi — AFSCA → **Corrigé. G4 fermé, les deux défauts.**

Registre AFSCA → Traçabilité → AVAL. Champ maintenant intitulé « Numéro de lot fournisseur (ou
identifiant technique) », placeholder « celui de l'avis de rappel, par ex. ». Recherche de
`MEU-SIROP-260731` (le numéro que **j'ai saisi moi-même** à la réception, pas un UUID) →
réponse immédiate : fournisseur, date de réception, DLC, non-conformités rattachées, consommé en
production, vendu tel quel. Aucun UUID à taper.

Second défaut (colonne SESSION vide) également fermé : recherche du lot `DÉMO-FARINE-01` (utilisé
par ma production PR-2026-0002) → la ligne affiche désormais `SM-2026-0001 — La Batte,
02/08/2026` au lieu de `—`. Un rappel réel peut maintenant remonter jusqu'à la session vendue.

### 7. Fin de mois — comptabilité → **Corrigé. G2 fermé.**

Comptabilité → Synthèse de l'exercice 2026, après ma réception de 115,20 € :

```
RECETTES               940,00 €
DÉPENSES DÉDUCTIBLES   534,35 €   « Dépenses saisies ci-dessous + achats de marchandises
                                    (détail dans le Journal des achats, frais de réception —
                                    transport, palette — compris) + frais de session. »
AMORTISSEMENTS           0,00 €
BÉNÉFICE BRUT           405,65 €
```

Le bénéfice brut **n'est plus égal aux recettes** (405,65 ≠ 940,00), et l'écran affiche
lui-même, en toutes lettres, qu'il inclut désormais les achats de marchandises — exactement le
défaut que docs/14 décrivait (les 447,61 € invisibles). Je n'ai pas recalculé le montant exact
des achats de l'année au centime (cela suppose de retélécharger le journal Excel, ce que je me
suis interdit — voir §7), mais l'écran ne peut structurellement plus reproduire « bénéfice brut
= recettes » puisque le poste dépenses déductibles n'est plus nul par construction.

---

## 3. Ce que j'ai trouvé que docs/14 n'avait pas vu

Du plus bloquant/trompeur au plus cosmétique.

### a. Le mail « Envoyée » ment toujours — G14, non corrigé (mon unique impasse silencieuse)

Reproduit à l'identique : commande validée → email saisi → **Envoyée à
meunier-test@example.be le 31/07/2026.** Rien à l'écran n'indique le mode test. Vérifié côté
disque : le fichier a bien été archivé, jamais envoyé —
`sorties/mails/mail_20260731-1917_meunier-test@example.be.txt` (dans le dossier de sorties
isolé, pas celui du porteur) contient bien l'en-tête `[MODE TEST — ce mail n'a PAS été envoyé]`.
L'écran, lui, ne le dit toujours pas. Contrairement aux 7 points ci-dessus, aucune mise à jour du
30/07 ne prétendait ce point corrigé — ce n'est donc pas une régression, juste un défaut resté
non traité.

**Pourquoi c'est le pire des trois** : c'est le seul cas où l'utilisateur croit qu'une action a
réussi (« le meunier a reçu ma commande ») alors qu'il ne s'est rien passé d'utile. Un arrêt dur
se voit ; celui-ci ne se voit pas avant le jour où la farine n'arrive pas.

### b. La valeur du stock compte un lot 100 % périmé comme un actif normal

Nouveau test, non présent dans docs/14 (dont les lots périmés étaient mélangés à du stock encore
valide) : réception délibérée de 200 g de café moulu avec une DLC déjà passée (01/01/2026, alors
qu'on est le 31/07/2026). Résultat sur l'écran Stock :

| Ingrédient | Stock (disponible) | Valeur (€) | Statut       |
| ---------- | ------------------ | ---------- | ------------ |
| Café moulu | 0 g                | **3,00**   | ▲ Lot périmé |

Le stock disponible exclut bien le lot périmé (0 g, correct), et l'étiquette dit maintenant
juste « Lot périmé » (le défaut principal de G6 est bien fermé, voir point c ci-dessous). Mais
la colonne **Valeur** — et donc le bandeau « Valeur totale : 176,83 € » en haut de l'écran —
continue de compter les 3,00 € payés pour ce lot, comme si c'était un actif vendable. Confirmé
indépendamment par l'API (`GET /api/stock`) : `quantiteDisponible: 0, valeurCents: 300`. Ce n'est
ni un arrêt ni une impasse — la donnée reste juste **invraisemblable sans le signaler** : le
porteur qui lit « 176,83 € de stock » croit disposer de 176,83 € de marchandise utilisable, alors
que 3,00 € sont déjà un déchet.

### c. G6 : en fait mieux corrigé que ce que docs/14 annonçait le 30/07

La mise à jour du 30/07 disait « partiellement corrigé : le défaut principal est réglé, les deux
défauts adjacents subsistent » (statutLigne qui affiche « OK » sur du périmé ; le tableau de bord
qui confond DLC dépassée et DLC proche). Sur ce jeu de données neuf, **les deux adjacents sont
également résolus** :

- Le café moulu (0 g disponible, lot périmé depuis 211 jours) affiche `▲ Lot périmé` dans la
  colonne STATUT de la liste des ingrédients — pas `OK`, pas un `Commander` générique.
- Le tableau de bord distingue maintenant deux compteurs séparés : **« 1 ingrédient avec un lot
  DÉJÀ périmé »** et **« 1 ingrédient avec un lot proche de sa DLC »** — l'ancien libellé unique
  qui les confondait a disparu.

Je ne peux pas certifier que _tous_ les cas soient couverts (mon scénario est un lot 100 %
périmé sur un ingrédient à stock par ailleurs nul ; docs/14 testait un ingrédient à stock mixte).
Mais sur le cas que j'ai rejoué, c'est mieux que ce que la dernière mise à jour connue affirmait.

### d. Une DLC déjà passée est acceptée à la réception sans le moindre avertissement

Dans le formulaire de réception, saisir le 01/01/2026 comme DLC pour un lot reçu le 31/07/2026
(c'est-à-dire une DLC dépassée de 211 jours **au moment même de la réception**) ne déclenche
aucun message, aucune confirmation, aucun avertissement. La marchandise entre en stock, le lot
est marqué périmé seulement _a posteriori_ en le rouvrant. Un contrôle de saisie du genre
« Cette DLC est déjà dépassée — confirmez-vous ? » éviterait une double-frappe de date
(31/03/2027 tapé 31/03/2026, par exemple) qui passerait aujourd'hui inaperçue jusqu'à ce que le
porteur retombe dessus par hasard dans Stock.

### e. Vente malgré un stock insuffisant : bien géré, à noter positivement

En clôturant la session avec 3 cafés vendus alors que tous les ingrédients du café étaient à
0 g de stock, l'écran a affiché, sans bloquer l'enregistrement :

> ▲ _Stock insuffisant à la vente : « Café moulu » (quantité manquante : 21), … La vente reste
> enregistrée telle quelle — c'est le stock qui a tort, pas la vente : vérifiez la dernière
> réception ou corrigez l'inventaire de ces ingrédients._

Vérifié via l'API que le stock ne passe pas en négatif (`quantiteDisponible: 0` pour tous les
ingrédients concernés, jamais un nombre négatif) : le manque est absorbé proprement, signalé,
jamais caché. C'est le contraire d'une impasse silencieuse — je le note pour que ce
comportement, qui est bon, ne soit pas cassé par erreur plus tard.

### f. Pluralisation toujours cassée (G15, non corrigé)

Reproduit à l'identique : **« 1 NON-CONFORMITÉS »** au lieu de « 1 NON-CONFORMITÉ » (Registre
AFSCA, onglet Non-conformités), et **« 1 RELEVÉS »** au lieu de « 1 RELEVÉ » (même écran, onglet
Températures, observé avant que je n'ajoute un deuxième relevé). Le tableau de bord, lui,
accorde correctement (« 1 ingrédient avec… », singulier). Le défaut est donc localisé aux
gabarits de titres de tableau du Registre AFSCA, pas généralisé.

### g. Le message de non-conformité auto-générée reste en partie brut

La description automatique de la non-conformité ouverte par un relevé hors seuil est :
« 9.5 °C relevés sur « Glacière rigide » le 2026-07-31 (depart), … » — point décimal anglais
(`9.5` au lieu de `9,5`), date ISO brute (`2026-07-31`) et minuscule sans accent (`depart`) dans
un texte par ailleurs en français. Mineur, mais visible dans un document qui finit dans un PDF
réglementaire.

### h. Le filtre « Mois » du Registre AFSCA ne filtre pas la liste affichée

Le sélecteur affichait « juin 2026 » par défaut alors que les relevés du 31/07 et du 02/08
apparaissaient quand même dans la liste en dessous. En creusant, le sélecteur semble ne piloter
que la génération du PDF mensuel, pas l'affichage à l'écran — mais rien ne le précise, et un
utilisateur pressé peut légitimement croire qu'il régle ce qu'il voit.

### i. Corrigés et vérifiés en passant (pas de défaut)

- **G8** (Paramètres en lecture seule) : confirmé réglé. Chaque paramètre propose désormais
  « Faire évoluer à partir d'une date » et « Corriger la valeur en vigueur », avec un texte qui
  distingue clairement les deux gestes.
- **Stock de sécurité par ingrédient** : le champ existe maintenant sur l'écran Ingrédients
  (conséquence du même chantier que G8), avec un texte d'aide qui explique le calcul du point de
  commande.
- **Fournisseurs, colonne TYPE** : affiche maintenant « Système » (capitalisé) au lieu de
  `systeme` brut.
- **Écran Recettes** : charge sans erreur (3 recettes listées, dont un brouillon
  « Café — recette vide »), confirmant que le chantier référentiel cité en docs/14 §7 est livré.
- **Route `/documents/etiquette-bac/:id`** : confirmée présente dans le code
  (`apps/api/src/routes/documents.ts:170`) sans cliquer le bouton, pour ne télécharger aucun
  fichier sans autorisation explicite (voir §7).

---

## 4. Une observation non tranchée, à ne pas confondre avec une régression

La session de démonstration SM-2026-0002 affiche une marge nette de **499,02 €** sur cette
instance, alors que docs/14 (28/07) rapportait **514,54 €** pour la même session, avec le même
CA de 838,00 €. Je n'ai **pas** recalculé cette session à la main (cela aurait exigé de
retélécharger le détail des lignes de vente et de frais, hors du parcours que je rejouais) ; je
ne sais donc pas si c'est un changement des données de départ (`seed:demo` a pu évoluer en trois
jours de travail parallèle) ou un début de régression sur le calcul de marge. **Signalé,
non instruit** — exactement la distinction que la mission demande de ne pas brouiller.

---

## 5. Captures — les trois pires moments

Toutes prises après vérification de `document.documentElement.clientWidth` (mesuré à 1912×867,
capture livrée par l'outil à 1568×711 — un downscale de transport, pas un rendu tronqué : le
contenu visible correspond à ce qu'un poste de bureau classique afficherait, vérifié par mesure
directe et non déduit de la taille du PNG).

1. **`C:\Users\<compte>\AppData\Local\Temp\claude-chrome-screenshots-pKDvTF\screenshot-1785520737814-0.jpg`**
   — Achats, CF-2026-0001 : « Envoyée à meunier-test@example.be le 31/07/2026 » sans aucune
   mention du mode test (§3.a).
2. **`C:\Users\<compte>\AppData\Local\Temp\claude-chrome-screenshots-pKDvTF\screenshot-1785520760731-1.jpg`**
   — Stock : Café moulu à `0 g` disponible, `▲ Lot périmé`, mais `3,00 €` toujours compté dans la
   valeur totale de 176,83 € (§3.b).
3. **`C:\Users\<compte>\AppData\Local\Temp\claude-chrome-screenshots-pKDvTF\screenshot-1785520805833-3.jpg`**
   — Registre AFSCA, onglet Non-conformités : « 1 NON-CONFORMITÉS » et description brute
   `9.5 °C … le 2026-07-31 (depart)` (§3.f, §3.g).

---

## 6. Ce que je n'ai pas pu jouer, et pourquoi

- **Aucun téléchargement de fichier n'a été effectué** : ni le journal des achats Excel, ni
  l'état du stock Excel, ni le bon de commande PDF, ni le registre AFSCA PDF, ni l'étiquette du
  bac. La règle de sécurité qui encadre cette session exige une autorisation explicite avant tout
  téléchargement de fichier ; je n'avais personne à qui la demander en cours de tâche
  automatisée, donc je me la suis refusée systématiquement. Conséquence concrète : je n'ai **pas**
  revérifié à la main le montant exact de 447,61 € d'achats cité par G2 (docs/14), ni le format
  de date `2026-07-21T00:00:00.000Z` dans l'export Excel (G15) — les deux restent non rejoués.
- **Comptabilité → Clôturer un mois** : jamais cliqué, sur consigne explicite (« point de
  non-retour »). Je n'ai donc pas vérifié ce qui se passe après une clôture mensuelle réelle sur
  cette instance.
- **Assistance IA / Propositions IA (événements)** : les deux existent bien dans la navigation
  (constaté, pas ouvert). Je n'ai cliqué sur aucun des deux, pour ne prendre aucun risque
  d'appel réel à l'API Anthropic — même un simple chargement d'écran peut, selon l'implémentation,
  déclencher un appel, donc je n'ai pas cherché à vérifier lequel.
- **FEFO sur un lot réellement périmé mélangé à des lots valides** : mon scénario de test (§3.b)
  utilise un ingrédient à stock nul avant réception, donc un seul lot, entièrement périmé. Je n'ai
  pas reconstitué le cas mixte (un lot périmé et un lot valide sur le même ingrédient) que
  docs/14 avait testé pour la vergeoise — je n'ai donc pas revérifié que FEFO écarte toujours
  correctement un lot périmé quand une alternative valide existe à côté.
- **Multi-stands, clôture au choix (crêpes ou pâte), écrans de lecture « Big Ambition »** :
  hors du parcours hebdomadaire décrit par docs/14, donc hors périmètre de ce rejeu ; non joués.
- **Tous les écrans annexes** (Comparaison des lieux, Où aller ?, Objectifs et succès, Économies
  d'achat, Factures fournisseur, Concurrents, Événements, Équipements, Menus, Nomenclature de
  vente, Lieux de marché, Qualité du modèle) : non ouverts, car ils ne font pas partie du
  parcours en quatre temps demandé (avant / veille / après / registre). Aucune affirmation n'est
  faite sur leur état.
- **Le point de commande qui ignore la demande prévue** (dernier paragraphe non tranché de G7
  dans la mise à jour du 30/07) : non revérifié — cela exigeait de lire
  `packages/db/src/services/commandes.ts` en détail, ce qui dépasse le cadre d'un test au
  navigateur. Reste un point ouvert, hérité tel quel de docs/14.

Ce parcours est donc complet sur les sept points demandés et sur le test au clavier, mais
**partiel** sur tout ce qui exigeait soit un téléchargement de fichier, soit un appel IA, soit un
geste explicitement interdit (clôture comptable) — ces trois exclusions sont des règles de
sécurité de la session, pas des limites techniques de l'application.
