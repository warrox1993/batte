# 33 — Parcours rejoué après une journée de vingt-cinq agents (01/08/2026)

> Rejeu complet du parcours hebdomadaire, au navigateur, sur une **instance isolée** : API sur
> `http://127.0.0.1:4991`, interface sur `http://localhost:4992`, base SQLite neuve dans le
> dossier temporaire de session, `migrer` + `seed` + `seed:demo`. Vérifié avant et après par
> `GET /api/sante` sur les deux instances : la mienne renvoie
> `...\scratchpad\instance\donnees\batte-test.sqlite`, celle du porteur (`:3001`) renvoie
> `C:\Users\<compte>\Desktop\AppCrepe\donnees\batte.sqlite` — deux chemins distincts, aucune requête
> écrite sur la seconde. Aucun appel Claude n'a été déclenché (`ANTHROPIC_API_KEY` vide, confirmé
> aussi bien côté shell que par l'écran Assistance IA lui-même). Aucun fichier du dépôt n'a été
> modifié en dehors de celui-ci — aucune ligne de code corrigée, aucun sous-agent dispatché.
>
> Rejoue `docs/27-PARCOURS-REJOUE.md` (rejoué il y a quelques heures, zéro arrêt dur) après une
> journée entière d'écriture parallèle par une vingtaine d'agents. Deux capacités neuves
> apparues dans l'intervalle — annulation de réception, annulation de production — sont au
> centre de ce rejeu, avec la séquence qui se bloquait elle-même le matin même.

---

## 1. Les trois nombres

| Catégorie                 | Compte | Détail                                                                                                                                                                                                                               |
| ------------------------- | :----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Arrêts durs**           | **1**  | Écran **Produits** (`/produits`) : liste et fiche systématiquement remplacées par « Erreur inattendue, sans plus de détail. », reproduit 5 fois sur 25 minutes, dans 3 onglets différents, après rechargement complet à chaque fois. |
| **Impasses silencieuses** | **1**  | Le mail « Envoyée » (suite de G14, docs/27) : corrigé **au moment de l'envoi**, mais redevient trompeur dès qu'on quitte l'écran et qu'on y revient — exactement le moment où le porteur le consulterait en pratique.                |
| **Gestes introuvables**   | **0**  | Tout ce que j'ai cherché a été trouvé, y compris par un chemin détourné (voir §3.c).                                                                                                                                                 |

Un **second symptôme apparenté** à l'arrêt dur ci-dessus existe sur l'écran **Sessions**
(le widget « Seuils légaux » affiche la même « Erreur inattendue, sans plus de détail. »),
mais je ne le compte pas dans les arrêts durs : le reste de l'écran — liste des sessions,
panneau de détail avec marge et CA — reste pleinement utilisable. Voir §3.b.

---

## 2. Les gestes neufs de la journée

### a. Annuler une réception — fonctionne bout en bout, reversion exacte

Réception RC-2026-0005 créée au clavier : Sirop de Liège (pot 450 g), fournisseur
« Producteur local (terroir) », rattachée à la commande CF-2026-0001, 24 pièces, 115,20 €, lot
`MEU-SIROP-260801`, DLC 08/01/2027.

| Étape                                                                                            | Sirop de Liège (pot 450 g) | Valeur totale du stock |
| ------------------------------------------------------------------------------------------------ | :------------------------: | :--------------------: |
| **Avant** réception                                                                              |     6 pièces — 28,80 €     |        79,12 €         |
| **Après** réception                                                                              |    30 pièces — 144,00 €    |        194,32 €        |
| **Après annulation** (motif « Correction d'une erreur de saisie », choisi dans une liste fermée) |     6 pièces — 28,80 €     |      **79,12 €**       |

Reversion **exacte au centime**, vérifiée à la fois à l'écran et par `GET /api/stock` avant/après.
La commande CF-2026-0001 est repassée automatiquement de « Reçue » à « Envoyée », avec une note
ajoutée d'elle-même : « Réception RC-2026-0005 annulée le 2026-08-01 : statut remis à « envoyee »
(statut antérieur retrouvé au journal d'audit). » Le lot annulé reste visible dans la liste des
lots de l'ingrédient (0 pièce restante, statut « Disponible », réception « annulée ») — rien
n'a disparu, conformément à CLAUDE.md §3 règle 7.

### b. Annuler une production, puis annuler sa réception — la séquence qui se bloquait elle-même le matin

Reconstituée de zéro pour isoler un lot unique :

1. Réception RC-2026-0006 (Farine de froment T55, hors commande, 500 g, 2,50 €, lot
   `FARINE-TEST-PROD`, DLC 01/10/2026 — volontairement plus proche que le lot existant, sans
   DLC, pour que la FEFO le consomme en premier).
2. Production PR-2026-0002 lancée pour 28 crêpes (2,1 L), rattachée à SM-2026-0001. La
   traçabilité des lots confirme la FEFO attendue : 500 g pris sur `FARINE-TEST-PROD` (lot
   épuisé), puis 177 g sur le lot préexistant `DÉMO-FARINE-01`.
3. **Constat, pas supposition** : une fois `FARINE-TEST-PROD` à 0 g restant, il **disparaît**
   du panneau des lots de l'ingrédient sur l'écran Stock (`GET /api/stock/{id}/lots` ne le
   renvoie plus). Aucune commande « Annuler la réception » n'est donc plus atteignable pour ce
   lot par ce chemin — je n'ai pas littéralement provoqué le refus documenté par la boîte de
   dialogue (« Si ce lot a déjà été consommé, même en partie, l'annulation est refusée »),
   faute de pouvoir seulement ouvrir cette boîte de dialogue.
4. **Annuler la production PR-2026-0002** (motif « Correction d'une erreur de saisie ») →
   `POST /api/productions/{id}/annuler` → 201. Les deux lots consommés reviennent à leur
   quantité d'avant (`DÉMO-FARINE-01` : 21 617 g restaurés ; `FARINE-TEST-PROD` : 500/500 g).
   `FARINE-TEST-PROD` **réapparaît** aussitôt dans le panneau des lots.
5. **Annuler la réception RC-2026-0006** (motif « Correction d'une erreur de saisie ») →
   `POST /api/receptions/{id}/annuler` → **201, succès**. Farine de froment T55 revient à
   **21,6 kg — 16,21 €**, exactement l'état d'avant le test (confirmé par `GET /api/stock`).

**La séquence complète fonctionne désormais de bout en bout, avec reversion exacte.** Le
journal des mouvements du lot montre les quatre écritures dans l'ordre, aucune effacée :
réception (+500 g) → production (−500 g, annulée, barrée) → réception de contrepassation
(+500 g, « Correction d'une erreur de saisie ») → ajustement de contrepassation (−500 g,
même motif). C'est exactement le comportement que CLAUDE.md §3 règle 7 exige.

### c. Palmarès — critères et échantillon trop maigre

Sur le tableau de bord, les quatre critères de « Palmarès produits » (Marge totale, Volume
vendu, Marge/unité, Marge/min cuisson) et les cinq de « Palmarès fournisseurs » (Économie,
Fiabilité facture, Prix comparable, Délai livraison, Qualité produit) basculent correctement
au clic. Avec une seule session close dans l'historique, les deux blocs affichent, quel que
soit le critère : « 1 session close sur la période — moins que le minimum de 4 retenu pour
classer honnêtement : un palmarès sur un échantillon aussi réduit serait du bruit, pas une
mesure. » C'est le comportement demandé — jamais un classement fabriqué sur un échantillon
insuffisant.

Le lien « Voir le détail » du palmarès produits renvoie vers `/produits` — c'est-à-dire vers
l'arrêt dur du §3.a. Rejoué depuis le palmarès fournisseurs, même lien mène à `/fournisseurs`,
qui lui **fonctionne** (non détaillé ici, hors périmètre du rejeu).

### d. Recette non vérifiée — distinction confirmée

Écran Recettes → R1 (Pâte à crêpes froment, active) : les 8 lignes d'ingrédients affichent
toutes `non vérifié` dans la colonne ALLERGÈNES (texte orange, jamais un tiret), et le
calculateur en bas de fiche résume : « Allergènes : non vérifié ». Confirmé à la source sur
l'écran Ingrédients : une case à cocher « Allergènes vérifiés » porte l'explication exacte —
« Cochez une fois la liste ci-dessous contrôlée. Tant que c'est décoché, les documents
affichent « allergènes non encore vérifiés » plutôt qu'une liste. » Aucun ingrédient de ce
jeu de données neuf n'a encore cette case cochée, donc je n'ai pas pu observer le cas
contraire (« aucun allergène », liste vide mais vérifiée) à l'écran — mais le mécanisme et son
texte d'aide sont sans ambiguïté.

---

## 3. Ce que j'ai trouvé, du plus bloquant au plus cosmétique

### a. Arrêt dur — écran Produits inutilisable (nouveau, absent de docs/27)

`GET /produits`, `/api/recettes`, `/api/ingredients`, `/api/menus`, `/api/couts-produits`
répondent tous **200** avec des données bien formées (vérifié à la fois par
`read_network_requests` et par un `fetch` direct dans la console de l'onglet). Malgré cela,
la liste des produits est remplacée par : « Erreur inattendue, sans plus de détail. » —
reproduit 5 fois, dans 3 onglets différents, à 20 minutes d'écart, sur une page qui n'affiche
aucune erreur console (le message générique vient d'un `catch` qui retombe sur ce texte
quand l'exception n'est pas une `ErreurApi` — donc vraisemblablement une exception cliente,
peut-être un désaccord de forme entre un schéma Zod et une réponse API, survenu pendant les
travaux du jour sur `Produits.tsx`, `recettes.ts` (contrats) ou la recette « Café — recette
vide » du jeu de données). Je n'ai pas cherché la ligne exacte : ce n'est pas mon rôle ici,
seulement le constat, avec preuve qu'il ne s'agit pas d'un aléa de rechargement HMR (voir
capture 1, §5).

**Conséquence concrète** : le porteur ne peut plus ouvrir sa liste de produits — ni consulter
un produit existant, ni son prix, ni sa marge depuis cet écran (le formulaire « Nouveau
produit », lui, reste affiché et semble utilisable, mais je ne l'ai pas testé pour ne pas
laisser de données de test supplémentaires alors que la liste elle-même reste cassée).

### b. Défaut apparenté — widget « Seuils légaux » de l'écran Sessions

Écran Sessions : le bloc « SEUILS LÉGAUX » en haut de page affiche la même
« Erreur inattendue, sans plus de détail. », alors que le reste de l'écran — la liste des
2 sessions, et le panneau de détail d'une session cliquée — fonctionne normalement (voir §4
pour le détail de marge vérifié dessus). Reproduit à l'identique après rechargement complet.
Je ne compte pas ce point comme un second arrêt dur puisque rien n'empêche de consulter les
sessions ; mais c'est la même famille de symptôme qu'en (a), sur un écran différent, ce qui
suggère une cause partagée plutôt que deux défauts indépendants.

### c. Une fois un lot totalement consommé par la production, il disparaît du panneau Stock — mais reste traçable ailleurs

Pendant le test (b) ci-dessus, une fois `FARINE-TEST-PROD` épuisé (0 g restant) par une
production **active** (non annulée), il ne figurait plus du tout dans le panneau des lots de
l'écran Stock (`FARINE DE FROMENT T55 — 1 LOT` au lieu de 2). À comparer : un lot épuisé par
une **réception annulée** (Sirop de Liège, §2.a) reste lui bien listé, à 0 pièce, avec son
statut d'annulation visible. Le lot « disparu » n'est cependant **pas introuvable** : je l'ai
retrouvé intact via le panneau de traçabilité de la Production elle-même (tableau
CONSOMMATIONS), et via la recherche de traçabilité du Registre AFSCA par numéro de lot
(aval → sessions impactées), qui l'a remonté sans UUID à taper. Je le signale comme une
incohérence d'affichage à surveiller (deux lots à 0 restant, traités différemment selon la
cause), pas comme un défaut bloquant : sur aucun des deux chemins de secours je ne me suis
retrouvée sans réponse.

Dans ce même panneau de traçabilité, la production annulée (PR-2026-0002) apparaît dans la
liste « CONSOMMÉ EN PRODUCTION » du lot **sans aucune mention qu'elle a été annulée** — à
vérifier si un jour un vrai rappel s'appuie sur cet écran : rien n'indique qu'il faut ignorer
cette ligne.

### d. Le mail « Envoyée » — mieux qu'avant, mais toujours une impasse silencieuse (suite de G14, docs/27 §3.a)

**Juste après l'envoi**, l'écran est maintenant honnête : « Mode test — rien n'a été envoyé au
fournisseur. Le mail a été écrit dans `…\sorties\mails\mail_20260801-0321_meunier-
test@example.be.txt` (destinataire visé : meunier-test@example.be le 01/08/2026). » C'est
exactement le correctif que docs/27 réclamait, et le code documente lui-même très
explicitement pourquoi (`apps/web/src/pages/Achats.tsx`, commentaire au-dessus de
`messageEnvoiCommande` et de `dernierEnvoiConnu`) : **cette mémoire est volontairement limitée
à la session d'écran courante**, faute d'un champ persisté en base (« hors zone d'écriture de
cet agent », selon le commentaire).

**Conséquence vérifiée** : en quittant l'écran Achats puis en y revenant (navigation normale,
pas de rechargement forcé), la même commande CF-2026-0001 affiche à nouveau uniquement :
« Envoyée à meunier-test@example.be le 01/08/2026. » — sans un mot sur le mode test. C'est
précisément le scénario réel : le porteur envoie une commande, ferme l'application, la
rouvre le lendemain pour vérifier — et voit un message qui se lit exactement comme un envoi
réel. Le correctif ferme le trou pendant quelques secondes ; il ne le ferme pas pour l'usage
normal de l'application. Je le compte comme **la seule impasse silencieuse** de ce rejeu,
au même titre que l'original.

### e. Valorisation du stock hors matière périmée — corrigée en calcul, pas encore en affichage principal (confirmation du soupçon de la mission)

Sur le panneau de détail d'un ingrédient (ex. Sirop de Liège), un nouveau chiffre
« Valeur exploitable » apparaît à côté du total de lots, avec l'infobulle : « Recalculée sur
les lots ci-dessous : exclut la matière détruite et périmée. Peut différer de la colonne
« Valeur (€) » ci-dessus, **pas encore corrigée côté serveur**. » C'est l'écran lui-même qui le
dit. Autrement dit : le calcul existe désormais (visible uniquement après avoir cliqué dans le
détail d'un ingrédient), mais le bandeau « Valeur totale » en haut de l'écran Stock et la
colonne « Valeur (€) » du tableau principal — ce que le porteur voit en premier, sans avoir à
cliquer nulle part — restent, par la propre admission du code, calculés à l'ancienne méthode.
Je n'ai pas reconstitué le scénario exact de docs/27 (café moulu 100 % périmé) pour revérifier
le chiffre trompeur en tête d'écran ; je rapporte ce que l'infobulle affirme elle-même, sans
supposition supplémentaire.

### f. DLC déjà dépassée à la réception — corrigé (fermeture du point d de docs/27)

En saisissant délibérément une DLC antérieure à la date de réception (10/01/2026 pour une
réception du 01/08/2026, soit 203 jours d'écart), le formulaire de réception affiche
désormais, avant tout enregistrement : « ▲ Farine de froment T55 : la DLC saisie (2026-01-10)
est déjà dépassée de 203 jours à la date de cette réception (2026-08-01) — vérifiez qu'il ne
s'agit pas d'une erreur de saisie de date (jour, mois ou année inversés). La réception reste
enregistrée telle quelle : une marchandise livrée déjà périmée doit rester traçable, pas
disparaître. » N'empêche pas l'enregistrement (bon choix : une DLC réellement dépassée à la
livraison doit rester traçable), mais avertit clairement — exactement le défaut d que docs/27
avait relevé sans avertissement du tout.

### g. Registre AFSCA — pluralisation corrigée, texte de non-conformité toujours brut (statu quo depuis docs/27)

- Pluralisation (G15, docs/27) : **corrigée**. Un relevé de température affiche « 1 RELEVÉ »
  (pas « 1 RELEVÉS ») ; à deux relevés, « 2 RELEVÉS ». Une non-conformité déclarée affiche
  « 1 NON-CONFORMITÉ » (pas « 1 NON-CONFORMITÉS »).
- Le filtre « Mois du registre (PDF) » porte maintenant sa propre mention explicite :
  « Ne filtre que le PDF ci-dessus. Les onglets ci-dessous affichent toujours tout
  l'historique enregistré, quel que soit ce mois. » — ferme l'ambiguïté que docs/27 avait
  relevée (§3.h) sans qu'aucune correction fonctionnelle n'ait été nécessaire : l'écran se
  contente désormais de le dire.
- La description auto-générée d'une non-conformité reste inchangée depuis docs/27 :
  « 9.5 °C relevés sur « Glacière rigide » le 2026-08-01 (depart), au-delà du seuil de 7 °C. »
  — point décimal anglais, date ISO brute, « depart » en minuscule sans accent. Ni corrigé ni
  régressé : identique au caractère près.

### h. Comptabilité, seuils, marge de session — cohérents et stables

Synthèse de l'exercice 2026 : Recettes 838,00 €, dépenses déductibles 418,10 €
(note explicite : « Dépenses saisies ci-dessous + achats de marchandises… + frais de
session »), bénéfice brut 419,90 € — **toujours différent des recettes**, confirmant que G2
(docs/14, fermé dans docs/27) reste fermé. Le bouton « Clôturer Août 2026 » (section
PÉRIODES) a été localisé mais **jamais cliqué**, conformément à la consigne — sa légende
(« la clôture d'un mois marque ses écritures comme figées ; elle ne les rend pas
infalsifiables — une réouverture reste possible, motivée et tracée ») a été lue sans y toucher.

Détail de la session close SM-2026-0002 (26/07/2026, La Batte) : CA 838,00 € (dont transformé
433,00 €, dont revendu 405,00 €, soit 48 % de revente — même chiffre que le tableau de bord),
coût matière réel 310,73 €, marge brute 527,27 € (= 838,00 − 310,73 ✓), commission carte
6,25 €, frais totaux 22,00 €, marge nette 499,02 € (= 527,27 − 6,25 − 22,00 ✓). Panier/marge
loin de 100 % (59,6 %) : pas le piège que la mission demandait de traquer. Ce 499,02 € est
identique à celui déjà rapporté par docs/27 il y a quelques heures — stable, pas de nouvelle
dérive depuis ce rejeu-là (l'écart avec les 514,54 € de docs/14 reste une question ouverte non
instruite, comme docs/27 l'avait déjà signalé).

### i. Assistance IA — mode dégradé confirmé sans y toucher

L'écran affiche de lui-même : « Assistance Claude non configurée sur ce poste : aucune clé
n'est renseignée. L'application reste pleinement fonctionnelle sans elle — l'IA est un
confort, jamais une dépendance. » Plafond mensuel 5,00 €, aucun appel journalisé. Les boutons
« Demander un avis » et « Résumer le brief » (écran Prochaine session) ont été repérés mais
**jamais cliqués**, par prudence, conformément à la consigne — la clé étant vide côté
environnement, le risque réel était nul, mais je n'ai pas voulu vérifier ce point par le
clic plutôt que par la lecture.

---

## 4. Les chiffres de prévision — vraisemblables

Écran Prochaine session (28/07 → 02/08/2026, La Batte) :

- **Base historique** : 124 crêpes (1 seule session comparable, confiance du modèle affichée
  à 9 %, honnêtement qualifiée de faible).
- Météo (ensoleillé et tiède, 26 °C), Événement, Saison, Tendance : les quatre facteurs sont à
  **× 1,00** — chacun avec une explication explicite de pourquoi il est neutralisé (« prior,
  jamais mesuré », « aucun ce jour-là », « historique trop court, 1/4 mois distincts
  observés », « encore 1/10 sessions antérieures exploitables »). C'est le comportement de
  démarrage à froid attendu : aucun facteur ne s'invente une confiance qu'il n'a pas.
- Demande attendue 124 crêpes (médiane 117, fourchette 76–181 — médiane sous la moyenne,
  cohérent avec une distribution bornée à gauche par zéro et une queue haute plus longue).
- Newsvendor explicite : « Une rupture coûte 2,97 € de marge, un invendu 0,26 € de pâte. On
  produit donc au niveau qui couvre 92 % des cas, pas 50 %. » → 188 crêpes. Raisonnement
  manuel refait : un coût de rupture très supérieur au coût d'invendu justifie bien un niveau
  de service très supérieur à 50 %. Cohérent.
- Recommandation ramenée de **188 à 28 crêpes** — contrainte : stock d'ingrédients (28), loin
  devant capacité de cuisson (331) et capacité de la glacière (360). Vérifié : le sucre
  vanillé n'a que 38 g en stock (8 g requis pour 6 crêpes → plafond exact à 28,5, arrondi à
  28). Manque à gagner estimé 259,62 €, plausible pour ~160 crêpes non produites à marge
  espérée décroissante sur la queue de la distribution (259,62 / 160 ≈ 1,62 €/crêpe, inférieur
  au coût de rupture unitaire de 2,97 € — cohérent avec une espérance calculée sur des ventes
  de moins en moins probables à mesure qu'on s'éloigne de la médiane).

**Comparaison avec docs/27** (même jeu de données, rejoué il y a quelques heures) : la
demande non contrainte est passée de **170 à 188 crêpes** (+10,6 %) — c'est exactement l'effet
attendu de la correction des huit modules et de la fuite d'information supprimée que la
mission annonce : des prédicteurs auparavant écartés à tort sont maintenant admis, et le
chiffre a bougé, mais dans une proportion modeste et dans le bon sens (à la hausse, cohérent
avec « moins de prédicteurs perdus »). Le plafond final (28 crêpes, manque à gagner
259,62 € contre 225,34 € dans docs/27) suit mécaniquement, puisque la contrainte reste le
stock de sucre vanillé — inchangé entre les deux rejeux, donc un plafond identique en crêpes
était même prévisible.

**Recoupement avec CLAUDE.md §6** : la session historique unique (SM-2026-0002) affiche
CA 838,00 € — exactement la valeur de référence « ≈ 838 € de CA brut ». Le CA « transformé »
(433,00 €) rapporté à un prix moyen pondéré de ~3,25 €/crêpe (350 et 300 cts selon la
garniture) donne ≈ 133 crêpes vendues, à comparer à la référence « ≈ 134 crêpes » — l'écart
est de moins d'une unité. **Aucun chiffre invraisemblable trouvé** sur ce parcours : ni
négatif, ni nul là où il devrait être `null`, ni disproportionné par rapport aux ordres de
grandeur du §6.

---

## 5. Captures — les trois pires moments

Toutes prises après vérification de `document.documentElement.clientWidth` (mesuré à
1912×867, `devicePixelRatio` à 1 sur cette session — donc pas de facteur de downscale à
corriger ; la capture livrée par l'outil à 1568 px de large est un downscale de transport,
comme déjà noté dans docs/27, pas un rendu tronqué).

1. **`C:\Users\<compte>\AppData\Local\Temp\claude-chrome-screenshots-pKDvTF\screenshot-1785551499887-14.jpg`**
   — Écran Produits : « Erreur inattendue, sans plus de détail. » à la place de la liste,
   alors que les 5 appels API sous-jacents répondent tous 200 (§3.a — l'arrêt dur).
2. **`C:\Users\<compte>\AppData\Local\Temp\claude-chrome-screenshots-pKDvTF\screenshot-1785551913324-15.jpg`**
   — Écran Sessions : même message d'erreur sur le seul widget « Seuils légaux », le reste de
   l'écran restant fonctionnel (§3.b).
3. **`C:\Users\<compte>\AppData\Local\Temp\claude-chrome-screenshots-pKDvTF\screenshot-1785551996900-16.jpg`**
   — Achats, CF-2026-0001 rouverte après navigation : « Envoyée à meunier-test@example.be le
   01/08/2026. » sans aucune mention du mode test, confirmé aussi en texte brut par
   `get_page_text` (§3.d — l'impasse silencieuse). Le panneau de détail déborde légèrement à
   droite de la capture sur cette page précise ; le texte exact a été revérifié hors capture
   pour ne pas dépendre du cadrage.

---

## 6. Ce que je n'ai pas pu jouer, et pourquoi

- **Aucun téléchargement de fichier** : ni bon de commande PDF, ni fiche technique PDF, ni
  étiquette du bac PDF, ni registre AFSCA PDF, ni export Excel (état du stock, mouvements de
  stock, journaux comptables). Même règle que docs/27 : autorisation explicite requise avant
  tout téléchargement, personne à qui la demander en tâche automatisée. Conséquence : les
  mentions légales et l'identité d'exploitant annoncées comme ajoutées aux documents imprimés
  n'ont pas été vérifiées à l'écran du document lui-même — seule leur présence en base
  (paramètres `exploitant_nom`, `exploitant_adresse`, etc., vus via `GET /api/sante` et le
  fichier `apps/api/src/documents/donnees.ts`) a été constatée, pas leur rendu PDF réel.
- **Comptabilité → Clôturer Août 2026** : localisé, jamais cliqué (point de non-retour,
  consigne explicite).
- **Assistance IA / Propositions IA / Demander un avis / Résumer le brief** : les quatre
  points d'entrée existent et ont été repérés ; aucun n'a été cliqué, par prudence, même si la
  clé Anthropic vide rendait tout appel réel impossible.
- **Clôture d'une session de vente saisie de zéro** : je n'ai vérifié la marge et
  l'écoulement que sur la session **déjà close** du jeu de données (SM-2026-0002, §3.h), pas
  en rejouant moi-même une saisie complète de ventes suivie d'une clôture, comme l'avait fait
  docs/27. Le temps du rejeu a été concentré sur les deux capacités neuves (annulation
  réception / production) et sur l'investigation de l'arrêt dur Produits. C'est une limite
  réelle de ce parcours, à ne pas confondre avec un test réussi : la clôture de session
  elle-même reste non rejouée aujourd'hui.
- **Café moulu périmé (scénario exact de docs/27 §3.b)** : non reconstitué. J'ai confirmé le
  mécanisme « Valeur exploitable » sur un autre ingrédient (Sirop de Liège) et cité l'infobulle
  de l'écran lui-même (§3.e), mais je n'ai pas revérifié à l'écran, sur un nouveau lot
  100 % périmé, que le bandeau « Valeur totale » affiche toujours le chiffre trompeur.
- **FEFO sur un lot périmé mélangé à des lots valides** : non retesté, même limite que
  docs/27 (mon scénario isolait toujours un ingrédient à un seul lot supplémentaire).
- **Le point de commande qui ignore la demande prévue** (question ouverte héritée de G7,
  docs/14 puis docs/27) : non revérifié, exigerait une lecture de
  `packages/db/src/services/commandes.ts` hors du cadre d'un test au navigateur.
- **Multi-stands, clôture au choix (crêpes ou pâte), écrans de lecture « Big Ambition »** :
  hors du parcours hebdomadaire en quatre temps, non joués.
- **Écrans annexes non ouverts** : Qualité du modèle, Objectifs et succès, Économies d'achat,
  Factures fournisseur, Concurrents, Événements, Équipements, Menus, Nomenclature de vente,
  Lieux de marché, Comparaison des lieux, Où aller ?, Journal d'audit, Fournisseurs (sauf
  passage éclair via le lien palmarès, non détaillé). Aucune affirmation n'est faite sur leur
  état.
- **Instabilité observée, non comptée comme défaut** : plusieurs actions ont échoué une
  première fois avec des messages d'erreur d'outil (« Script injection timed out »,
  « page busy or mid-navigation ») ou un écran d'erreur de compilation Vite plein cadre
  (`Production.tsx`, `'import' and 'export' may only appear at the top level`), toujours
  résolus par une nouvelle tentative dans un onglet neuf. Ces épisodes coïncident avec des
  vagues de `hmr update` / `hmr invalidate` dans le journal du serveur Vite, sur les mêmes
  fichiers que ceux touchés par mes propres tests (`Stock.tsx`, `SaisieReception.tsx`,
  `DetailLot.tsx`, `BlocAnnulation.tsx`, `Production.tsx`) — cohérent avec des agents encore
  actifs sur ces écrans au moment du rejeu. Conformément à la consigne, ces épisodes n'ont
  pas été comptés comme des défauts ; seuls les symptômes reproduits après un rechargement
  complet et une attente ont été retenus (§3.a et §3.b).

Ce parcours couvre donc les quatre temps de la semaine, les deux gestes neufs demandés en
détail avec leurs chiffres exacts, le palmarès, la distinction recette non vérifiée, et la
plausibilité de la prévision. Il reste **partiel** sur tout ce qui exigeait un téléchargement
de fichier, un appel IA, le geste de clôture comptable explicitement interdit, et une
clôture de session rejouée de zéro — ces limites sont documentées ci-dessus, pas passées sous
silence.
