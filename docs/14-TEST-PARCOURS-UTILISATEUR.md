# 14 — Test de parcours utilisateur

> Rapport de recette joué le **28/07/2026**, en mode production sur `http://127.0.0.1:3001`,
> par un testeur jouant le porteur du projet sur une semaine complète.
> Aucun code n'a été modifié. Les corrections décrites ici ne sont **pas** appliquées.
>
> **Méthode.** Chaque défaut a été reproduit au moins deux fois avant d'être écrit. Les
> chiffres affichés ont été recalculés à la main, puis recoupés soit avec l'API, soit avec
> la base SQLite ouverte en lecture seule. Quand un écran a changé sous le testeur (quatre
> agents travaillaient en parallèle), le point a été revérifié après coup et retiré du
> rapport s'il ne se reproduisait plus — voir §7.

---

## 1. Le parcours va-t-il de bout en bout ?

**Non. Il s'arrête deux fois, et il ment une fois de plus à l'arrivée.**

| #   | Étape                        | Résultat                                                                        |
| --- | ---------------------------- | ------------------------------------------------------------------------------- |
| 1   | Mardi — réception du meunier | **Passe.** 3 lignes, lots, DLC, RC-2026-0005, 74,90 €. Stock exact.             |
| 2   | Mercredi — commande          | **ARRÊT.** « Valider la commande » échoue systématiquement (HTTP 400).          |
| 3   | Samedi — prévision           | **Passe**, mais recommande 203 crêpes que le stock ne permet pas de produire.   |
| 4   | Dimanche matin — production  | **Passe.** FEFO correct, coûts exacts, saisie du réalisé au clavier.            |
| 5   | Dimanche soir — clôture      | **Passe mais faux.** Le coût de la pâte n'entre pas dans la marge.              |
| 6   | Lundi — AFSCA                | **ARRÊT.** Partir d'un lot est impossible : la recherche exige un UUID interne. |
| 7   | Fin de mois — comptabilité   | **Passe mais faux.** Bénéfice brut = recettes ; 447,61 € d'achats ignorés.      |

Autrement dit : la chaîne de données existe **physiquement** — une réception se propage
vraiment jusqu'à la production et jusqu'au registre. Mais elle se rompt à trois jointures :
`commande → validation`, `production → session`, et `achats → comptabilité`. Les deux
dernières ne bloquent pas l'utilisateur : elles produisent des chiffres faux sans rien dire.

> **Mise à jour du 30/07/2026 — corrigé : les trois jointures citées sont refermées.** Détail
> section par section ci-dessous, mais en résumé : l'étape 2 (`commande → validation`) est
> réglée par le correctif de G3 (`requeteApi` ne pose plus de `Content-Type` sans corps) ; l'étape
> 5/étape 7 (`production → session`, `achats → comptabilité`) sont réglées par les correctifs de
> G1 (`production.sessionId` rattachable) et G2 (`syntheseExercice` lit désormais les achats de
> marchandises) ; l'étape 6 (recherche AFSCA par UUID) est réglée par le correctif de G4
> (`tracabiliteAvalLot` résout aussi un numéro de lot fournisseur). Le verdict global de ce
> paragraphe (« il s'arrête deux fois, et il ment une fois de plus ») n'est donc plus l'état du
> code aujourd'hui — voir les encadrés sous G1 à G4 pour le détail fichier:ligne de chaque
> correctif. Non rejoué : le parcours complet, bout en bout, avec les mêmes gestes que ce test.

---

## 2. Défauts, par gravité

### G1 — Le coût de la pâte n'entre jamais dans la marge de la session

**Geste.** Produire de la pâte le matin (Production → Lancer la production), puis clôturer la
session du même jour (Sessions → ligne du jour → saisir les ventes → Ctrl+S).

**Ce qui s'affiche**, sur ma session SM-2026-0003 (32 crêpes + 4 pots de sirop) :

| Poste                 | Affiché                 |
| --------------------- | ----------------------- |
| CA total              | 135,00 €                |
| **Coût matière réel** | **19,20 €**             |
| Marge brute           | 115,80 € (85,8 % du CA) |
| Marge nette           | 73,29 €                 |

**Ce qui devrait s'afficher.** 19,20 € est exactement `4 pots × 4,80 €` (le CUMP du sirop) :
**seules les marchandises revendues sont comptées**. Les 32 crêpes vendues ont coûté de la
pâte, et l'application connaît ce coût — `production.cout_matiere_reel_cents = 1026`
(10,26 € pour 38 crêpes, soit 0,27 €/crêpe). La part vendue vaut `32/38 × 10,26 = 8,64 €`.

| Poste                  | Affiché    | Réel       | Écart             |
| ---------------------- | ---------- | ---------- | ----------------- |
| Coût matière           | 19,20 €    | 27,84 €    | −8,64 €           |
| Marge brute            | 115,80 €   | 107,16 €   | **+8,64 €**       |
| Marge brute en % du CA | **85,8 %** | **79,4 %** | +6,4 pts          |
| Marge nette            | 73,29 €    | 64,65 €    | +8,64 € (+11,8 %) |

**Cause.** `production.session_id` vaut `NULL`. La colonne existe dans le schéma, mais
l'écran Production n'offre aucun champ pour rattacher une production à une session. Un seul
mouvement de stock est lié à SM-2026-0003 : la sortie des 4 pots de sirop.

**Pourquoi c'est grave.** À l'échelle d'une vraie session (134 crêpes, 838 € de CA), le même
mécanisme masque ≈ 36 € par dimanche, soit ≈ 7 % de la marge nette. Toutes les semaines. Et
c'est la ligne que lit le comptable. C'est exactement la famille du bug « marge à 95,7 % ».

**Vérification indépendante.** La session de démonstration SM-2026-0002, elle, porte
`cout_matiere_cents = 29521` = 259,20 € de sirop **+ 36,01 € de pâte**. La graine contient
donc le bon chiffre ; c'est le calcul temps réel qui perd la pâte.

_Capture : `C:\Users\<compte>\Desktop\AppCrepe\sorties\test-07-DEFAUT-cout-matiere-sans-la-pate.png`_

> **Mise à jour du 30/07/2026 — corrigé.** `production.sessionId` peut désormais être renseigné à
> la création (`packages/db/src/services/production.ts:190-191,289,313`, vérification
> `verifierSessionRattachable`) et rattaché ou détaché après coup, y compris pour une production
> déjà réalisée (`:814-838`). Côté écran, `apps/web/src/pages/Production.tsx` propose un champ
> « Session de destination » à la création (`:1245-1255`) et un panneau de rattachement dédié
> (`:545,905-916,1420-1441`), avec garde sur une session déjà clôturée (D-024, `:1035`). Côté
> clôture, `packages/db/src/services/sessions.ts:707-720` agrège désormais le coût matière réel
> des productions dont `production.sessionId` correspond à la session — donc y compris la pâte,
> plus seulement les produits revendus. Le calcul complet n'a pas été rejoué à la main sur une
> session comme ce test le faisait, mais le mécanisme qui manquait (`production.session_id`
> toujours `NULL`) est bien câblé dans les deux sens.

---

### G2 — Le bénéfice brut de l'exercice ignore 447,61 € d'achats

**Geste.** Comptabilité → Synthèse de l'exercice 2026.

**Ce qui s'affiche.**

```
RECETTES              973,00 €
DÉPENSES DÉDUCTIBLES    0,00 €
AMORTISSEMENTS          0,00 €
BÉNÉFICE BRUT         973,00 €
COTISATIONS SOCIALES  199,47 €
IMPÔT ESTIMÉ          309,41 €
NET ESTIMÉ            464,12 €
```

Le bénéfice brut **est égal au chiffre d'affaires**. L'achat de farine, de lait, d'œufs et de
sirop n'est déduit nulle part.

**Ce qui devrait s'afficher.** Sur le même écran, le bouton « Journal des achats (Excel) »
produit un fichier qui liste **447,61 €** d'achats sur 2026 (6 réceptions, 17 lots) — j'ai
ouvert le classeur et vérifié le total. Deux exports du même module se contredisent de
447,61 €.

En prenant le coût matière que l'application a elle-même calculé pour les deux sessions
clôturées (295,21 € + 19,20 € = 314,41 €) :

| Poste                 | Affiché  | Attendu    | Écart     |
| --------------------- | -------- | ---------- | --------- |
| Bénéfice brut         | 973,00 € | ≈ 658,59 € | +314,41 € |
| Cotisations (20,50 %) | 199,47 € | ≈ 135,01 € | +64,46 €  |
| Impôt (40 %)          | 309,41 € | ≈ 209,43 € | +99,98 €  |
| Net estimé            | 464,12 € | ≈ 314,15 € | +149,97 € |

**Cause** (lue dans `packages/db/src/depots/comptabilite.ts:834`, `syntheseExercice`) : le
résultat = sessions clôturées − table `depense` − table `amortissement_annuite`. Les achats
de marchandises vivent dans la table `lot`, jamais dans `depense`. L'écran le dit d'ailleurs
lui-même sous le tableau des dépenses : « Les dépenses **hors matière** (emplacement,
carburant, assurance…) apparaîtront ici. » La matière n'a donc aucun autre point d'entrée.

**Nuance honnête.** L'erreur va dans le sens prudent (elle surestime l'impôt provisionné).
Elle reste une erreur, elle alimente désormais le compteur de seuil « Cotisation réduite »,
et l'arithmétique interne de l'écran est par ailleurs juste au centime.

_Capture : `sorties\test-10-DEFAUT-benefice-brut-sans-cout-matiere.png`_

> **Mise à jour du 30/07/2026 — corrigé.** `packages/db/src/depots/comptabilite.ts:10-13` (en-tête
> du fichier) dit désormais explicitement : « `syntheseExercice` lit AUSSI la table `reception`
> (achats de marchandises) et les frais de session agrégés sur `session_marche`, en plus de
> `depense` — voir le commentaire de `syntheseExercice` pour la définition retenue d'une charge de
> l'exercice (`docs/14-TEST-PARCOURS-UTILISATEUR.md §G2`) » — la fonction cite ce document par son
> nom. Dans `syntheseExercice` (`:1161-1236`), `achatsMarchandisesCents = totalAchatsMarchandisesCents(base, annee)`
> est désormais additionné à `depensesSaisiesCents`, `fraisSessionCents` et `commissionsCarteCents`
> pour former `depensesDeductiblesCents`, avec un commentaire explicite sur la non-double-comptage
> (« ce qui est délibérément exclu (coût matière) », `:1226-1227`) — cohérent avec le fait que le
> coût matière consommé par session est compté séparément côté marge analytique (G1), pas ici.
> Non revérifié : rejouer à la main le calcul exact sur le jeu de données de ce test précis (les
> 447,61 €).

---

### G3 — « Valider la commande » échoue toujours (HTTP 400)

**Geste.** Achats → cliquer une commande en brouillon → « Valider la commande ».

**Ce qui s'affiche.** `La requête est mal formée : le corps envoyé n'est pas du JSON valide.`
et, en console, `POST /api/commandes/{id}/valider → 400`.

**Reproduit 3 fois**, sur 3 commandes différentes (CF-2026-0001, CF-2026-0002, CF-2026-0003),
à 40 minutes d'intervalle.

**Ce qui devrait se passer.** La commande passe en « Validée » et le bloc d'envoi apparaît.

**Cause, isolée.** `apps/web/src/lib/api.ts` pose `headers: { 'Content-Type': 'application/json' }`
sur **toutes** les requêtes. `validerCommandeSelectionnee` (`Achats.tsx:390`) est le seul
appel `POST` du client sans `body`. Fastify reçoit alors un content-type JSON avec un corps
vide et lève `FST_ERR_CTP_EMPTY_JSON_BODY`.

Preuve en deux appels, hors navigateur :

```
POST /api/commandes/{id}/valider  (sans en-tête)                  → 200 OK
POST /api/commandes/{id}/valider  (Content-Type: application/json) → 400
```

**Piste de correction (non appliquée).** Envoyer `body: JSON.stringify({})`, ou ne poser
l'en-tête JSON dans `requeteApi` que lorsqu'un `body` est présent. La seconde est plus sûre :
elle protège tout futur `POST` sans corps. C'est aujourd'hui le seul appel concerné — je l'ai
vérifié en balayant tous les `requeteApi(... method: 'POST' ...)` du client.

**Conséquence métier.** Le module Achats est coupé en deux. Le parcours documenté en 3 temps
(générer → valider → envoyer, D-009) ne peut pas franchir le temps 2 depuis l'interface.

_Capture : `sorties\test-04-DEFAUT-valider-commande-400.png`_

> **Mise à jour du 30/07/2026 — corrigé, exactement selon la piste suggérée.** `requeteApi`
> (`apps/web/src/lib/api.ts:107,120`) ne pose désormais `Content-Type: application/json` que
> lorsqu'un `body` est présent (« l'en-tête … n'est posé QUE si un `body` est … », commentaire
> `:107`). `validerCommandeSelectionnee` (`apps/web/src/pages/Achats.tsx:433-441`) continue
> d'appeler l'endpoint sans corps ; c'est désormais sans effet sur l'en-tête envoyé.

---

### G4 — Partir d'un lot est impossible : la traçabilité exige un UUID interne

**Geste.** Registre AFSCA → onglet Traçabilité → « AVAL — d'un lot vers les sessions
impactées » → saisir le numéro de lot lu à l'écran, `MEU-T55-260721`.

**Ce qui s'affiche.** `Lot introuvable : MEU-T55-260721.`

Le champ n'accepte que l'identifiant technique, du type
`019faa10-99e6-7099-b192-d198c9e1fe93`. Cet identifiant **n'est affiché nulle part dans
l'application** : l'écran Stock montre le n° de lot fournisseur, jamais l'UUID. Il n'y a ni
liste déroulante, ni autocomplétion, ni placeholder indiquant le format attendu. Les deux
champs (« Identifiant de la session », « Identifiant du lot ») sont de simples zones de texte.

**Ce qui devrait se passer.** Le geste que l'AFSCA vient demander — « ce lot de farine est
rappelé, où est-il parti ? » — doit se faire depuis l'écran Stock, ou au minimum en tapant le
numéro imprimé sur le sac.

**Le moteur, lui, est bon.** En collant l'UUID lu dans la base, l'écran répond correctement :
en-tête du lot (fournisseur, date de réception, DLC), puis trois axes — consommé en
production / vendu tel quel / étalé en garniture. La fonction existe ; c'est sa porte d'entrée
qui manque.

**Second défaut dans la même réponse.** La colonne SESSION de la production affiche `—` :

```
PR-2026-0002   28/07/2026   961   —   —
```

Même cause que G1 (`production.session_id` nul). Sur un rappel réel, le registre sait dire
« ce lot est entré dans la production PR-2026-0002 » mais **pas** « … qui a été vendue au
marché du 28/07 ». C'est précisément le dernier maillon qu'un rappel exige.

_Capture : `sorties\test-08-DEFAUT-tracabilite-uuid-et-session-vide.png`_

> **Mise à jour du 30/07/2026 — les deux défauts sont corrigés.** Le champ de recherche aval du
> Registre AFSCA porte désormais le libellé « Numéro de lot fournisseur (ou identifiant
> technique) » avec le placeholder « celui de l'avis de rappel, par ex. »
> (`apps/web/src/pages/RegistreAfsca.tsx:2028-2032`), et la fonction serveur
> `tracabiliteAvalLot` (`apps/api/src/routes/afsca.ts:351-357`) résout indifféremment un UUID ou
> un numéro de lot fournisseur (« résout les deux, docs/17 §5 »). Le second défaut (colonne
> SESSION à `—`) partage la cause de G1, corrigée là-bas : `production.sessionId` est désormais
> renseignable, donc la jointure production → session peut être non nulle.

---

### G5 — Le registre AFSCA se contredit : « non conforme » d'un côté, « aucune non-conformité » de l'autre

**Geste.** Registre AFSCA → Températures → saisir un relevé à 9,5 °C (le seuil paramétré
`temperature_max_froid_c` vaut 7). Le formulaire refuse à juste titre tant que l'action
corrective est vide — bon comportement. Une fois l'action saisie, le relevé s'enregistre :

```
28/07/2026   Arrivée   Glacière rigide   9,5   ■ Non conforme   Blocs eutectiques remplacés…
```

Puis onglet Non-conformités :

```
0 NON-CONFORMITÉS
Aucune non-conformité déclarée. C'est la situation attendue.
```

**Ce qui devrait s'afficher.** Une rupture de chaîne du froid à 9,5 °C **est** une
non-conformité. Le même écran affirme simultanément qu'il y en a une et qu'il n'y en a
aucune, et la seconde phrase ajoute « c'est la situation attendue » — donc rassure à tort.
Un relevé hors seuil devrait ouvrir automatiquement une non-conformité (ou, à défaut,
l'onglet devrait afficher « 1 relevé hors seuil non encore qualifié »).

_Capture : `sorties\test-09-DEFAUT-non-conformites-vides-malgre-releve-non-conforme.png`_

> **Mise à jour du 30/07/2026 — corrigé, par l'automatique.** `ecrireReleveTemperature`
> (`packages/db/src/services/afsca.ts:85-152`) ouvre désormais automatiquement une
> non-conformité liée dans la MÊME transaction quand un relevé est hors seuil (`:135-149`), avec
> un commentaire qui cite explicitement ce défaut et la règle retenue (« RÈGLE (docs/17 fiche 15) :
> un relevé HORS SEUIL OUVRE AUTOMATIQUEMENT une non-conformité liée », `:68-83`, citant l'ancienne
> contradiction « ■ Non conforme » / « 0 non-conformités » observée ici mot pour mot). L'argument
> POUR le proposé (fiche vide) est explicitement écarté parce que l'action corrective est déjà
> exigée avant l'écriture du relevé.

---

### G6 — Les lots périmés portent le statut « Disponible »

**Geste.** Stock → cliquer « Vergeoise blonde ».

**Ce qui s'affiche.**

```
VERGEOISE BLONDE — 3 LOTS
Disponible 311 g · Total 10 500,3 kg

N° DE LOT           REÇU LE   DLC              RESTE        STATUT
DÉMO-VERGEOISE-01   22/07     —                311 g        ● Disponible
—                   28/07     01/01  J+208     10 000,0 kg  ● Disponible
5151651             28/07     01/07  J+27      500,0 kg     ● Disponible
```

Le bandeau annonce **311 g disponibles**, le tableau juste en dessous annonce **10 500,3 kg
« Disponible »**. Impossible à réconcilier pour un lecteur.

**Ce qui devrait s'afficher.** Le moteur a raison — j'ai vérifié que la production consomme
bien le seul lot non périmé (FEFO a pris `DÉMO-VERGEOISE-01`, pas les périmés) et que
`quantiteDisponible` les exclut. C'est **l'étiquette** qui ment : un lot dont la DLC est
dépassée devrait s'afficher « Périmé » (ou « Bloqué »), pas « Disponible ».

**Deux défauts adjacents, même écran :**

- La colonne **Statut de l'ingrédient** ne regarde que la quantité face au stock de sécurité
  (`statutLigne` → `statutStock(quantiteDisponible, stockSecurite)`). Un ingrédient dont le
  lot le plus ancien est périmé depuis 208 jours affiche donc **« ● OK »**. Sur un produit
  dont §1 fait de l'AFSCA un domaine à part entière, la colonne Statut ne devrait pas pouvoir
  dire OK sur du périmé.
- Le compteur du tableau de bord appelle ces lots **« 2 ingrédients avec un lot proche de sa
  DLC »**. Ils ne sont pas _proches_ de leur DLC : ils l'ont dépassée de 208 et 26 jours.

**Note d'honnêteté.** Les deux lots monstrueux (10 t, 500 kg) sont des données de test
laissées par un autre agent. Le défaut d'étiquetage, lui, est indépendant des quantités : il
frappe n'importe quel lot dont la DLC est passée.

_Capture : `sorties\test-11-DEFAUT-lots-perimes-marques-disponible.png`_

> **Mise à jour du 30/07/2026 — partiellement corrigé : le défaut principal est réglé, les deux
> défauts adjacents subsistent.** `statutAfficheLot` (`apps/web/src/pages/Stock.tsx:202-207`)
> affiche désormais « Périmé » (glyphe `depassement`) pour un lot `disponible` dont la DLC est
> dépassée, avec un commentaire qui cite ce test par son nom (« G6,
> docs/14-TEST-PARCOURS-UTILISATEUR.md »). En revanche, les deux défauts adjacents n'ont pas
> bougé : `statutLigne` (`apps/web/src/pages/Stock.tsx:160-162`) continue de ne comparer que
> `quantiteDisponible` à `stockSecurite`, sans regarder si le lot le plus ancien est périmé — un
> ingrédient périmé depuis 208 jours peut donc encore afficher « ● OK ». Et le compteur du
> tableau de bord (`apps/web/src/pages/TableauDeBord.tsx:308,359`, libellé « … avec un lot proche
> de sa DLC ») utilise toujours `formaterJoursRestants`, qui ne distingue pas un horizon futur
> (J-3) d'un horizon déjà dépassé (J+208) — les deux passent le même test `jours > horizonJours`
> côté « pas encore filtré », donc un lot périmé depuis longtemps continue d'être compté et
> libellé comme « proche ».

---

### G7 — L'application recommande 203 crêpes qu'elle sait ne pas pouvoir produire

**Geste.** Mercredi, Achats → « Générer les commandes ». Réponse : _« Aucun ingrédient sous le
point de commande : aucun brouillon généré. »_ Dimanche, Production → cible 203 crêpes (le
chiffre que Prochaine session affiche en grand) :

```
Production impossible : il manque 218 g de Sucre vanillé, et 2 autre(s) ingrédient(s) en manque.
Volume maximal réalisable avec le stock actuel : 3,0 L.

Sucre vanillé      271 g   /  53 g   → manque 218 g
Beurre             1,9 kg  /  717 g  → manque 1,1 kg
Vergeoise blonde   778 g   /  463 g  → manque 315 g
```

3,0 L = **40 crêpes**. L'écart entre ce que l'application recommande et ce qu'elle permet est
de **163 crêpes, soit 80 % de sa propre recommandation**.

**Ce qui devrait se passer.** L'écran « Prochaine session » possède un encadré « CE QUI VOUS
LIMITE » qui liste la capacité de cuisson (331) et la capacité de la glacière (240) — mais
**pas le stock**, qui est ici la contrainte la plus basse de très loin. Le porteur découvre le
manque le dimanche matin, quand plus aucun fournisseur n'est ouvert.

**Précision importante — le point de commande n'est pas cassé.** Je l'ai revérifié après la
production : « **1 brouillon généré** » (CF-2026-0003, 1 plaquette de beurre, 4,50 €). Il
fonctionne. Le problème est qu'il **regarde la consommation passée**
(`reappro_fenetre_historique_jours = 90`) et jamais la demande prévue : il commande 500 g de
beurre là où la prévision de dimanche en réclame 1 861 g. La prévision et l'approvisionnement
ne se parlent pas.

**Aggravant.** Les 9 ingrédients ont tous `stock_securite = 0` et l'écran Paramètres est en
lecture seule (voir G8) : le terme « stock de sécurité » de la formule documentée
(`docs/01 §Réapprovisionnement`) est structurellement à zéro et l'utilisateur ne peut pas le
changer.

**Vérification arithmétique.** Tous les chiffres de faisabilité sont exacts : 271 g de sucre
vanillé = `8 × 203/6` ; 1 861 g de beurre = `55 × 203/6` ; le plafond de 3 014 ml =
`53/8 × 455`. Le moteur calcule juste, il n'est simplement pas branché sur l'amont.

_Capture : `sorties\test-05-DEFAUT-prevision-203-non-produisible.png`_

> **Mise à jour du 30/07/2026 — partiellement corrigé.** Le manque principal décrit ici (« CE QUI
> VOUS LIMITE … mais pas le stock ») est comblé : `contraintesSession`
> (`packages/core/src/prevision/moteur.ts:645-688`) ajoute désormais une contrainte
> `"stock d'ingrédients"` à côté de la capacité de cuisson et de la capacité de la glacière, et une
> quatrième contrainte « volume transportable » a été ajoutée dans la même passe (commentaire
> `:690-700` : « absente du moteur jusqu'à l'audit du 30/07/2026 »). L'aggravant décrit ici (« les
> 9 ingrédients ont tous `stock_securite = 0` et l'écran Paramètres est en lecture seule ») ne
> tient plus non plus, puisque G8 est corrigé (voir plus bas). En revanche, le défaut de fond —
> « le point de commande … regarde la consommation passée … et jamais la demande prévue » — n'a
> pas été revérifié comme corrigé : `packages/db/src/services/commandes.ts:312,362` continue de
> lire `reappro_fenetre_historique_jours` et d'appeler `calculerBesoinReapprovisionnement` sans
> paramètre de demande prévue apparent ; la prévision et l'approvisionnement pourraient donc
> toujours ne pas se parler. Ne pas présumer ce point clos sans revérification plus poussée de
> `calculerBesoinReapprovisionnement`.

---

### G8 — L'écran Paramètres est en lecture seule

**Geste.** Paramètres.

**Ce qui s'affiche.** 50 paramètres, colonnes « EN VIGUEUR / DEPUIS LE / VERSIONS », avec ce
chapeau : _« Un paramètre ne se remplace pas : il gagne une version datée […] Les seuils 2026
sont **à reconfirmer chaque année**. »_

**Ce qui manque.** L'écran ne contient **aucun `input`, aucun `select`, aucun bouton** (compté
dans le DOM : 0). Il n'existe pas de route d'écriture côté API non plus (`parametres.ts`
n'expose qu'un `GET`). Le texte demande donc explicitement une action que l'interface ne
permet pas.

**Conséquences concrètes**, toutes rencontrées pendant ce test :

- impossible de saisir le tarif d'emplacement de La Batte — la note de la session de démo
  prévient pourtant « renseignez-le […] sinon la marge nette est surévaluée » ;
- impossible de fixer un stock de sécurité (voir G7) ;
- impossible de reconfirmer les seuils légaux 2027, ni `taux_ipp_marginal_bp`,
  ni `plafond_ia_mensuel_cents`.

> **Mise à jour du 30/07/2026 — G8 est corrigé, déjà signalé « à NE PAS rouvrir » par
> `docs/17-VINGT-AMELIORATIONS.md` §2 (ligne « G8 — écran Paramètres en lecture seule »).**
> `apps/api/src/routes/parametres.ts` expose désormais `PATCH /parametres/:id` (`:57`) et
> `POST /parametres/:cle/versions` (`:80`), consommées par `apps/web/src/pages/Parametres.tsx:637`
> et `:510`. Le versionnage annuel décrit par le chapeau de l'écran (« il gagne une version datée »)
> est donc atteignable aujourd'hui — les trois conséquences listées ci-dessus ne sont plus valides.

---

### G9 — Un lot peut être créé sans numéro de lot ni DLC, et le trou remonte jusqu'au registre

**Geste.** Stock → Enregistrer une réception → fournisseur + 1 ligne (Sucre vanillé, 15 g,
0,26 €) → **laisser « N° de lot fournisseur » et « DLC » vides** → Enregistrer.

**Ce qui s'affiche.** `Réception RC-2026-0006 enregistrée — 1 lot créé, 0,26 €.` Aucun
avertissement.

**Ce qui devrait se passer.** CLAUDE.md règle 6 : « Toute entrée de marchandise crée un lot
(fournisseur, date de réception, **numéro de lot**, DLC). » Le champ devrait être obligatoire,
ou son omission devrait exiger un motif explicite (marchandise sans marquage).

**Preuve que le trou se propage.** La pâte produite ensuite affiche, dans le tableau
« CONSOMMATIONS (TRAÇABILITÉ DES LOTS) » de PR-2026-0002 :

```
Sucre vanillé   DÉMO-VANILLE-01   38 g   0,66
Sucre vanillé   —                 15 g   0,26
```

Une ligne de traçabilité dont le lot vaut « — ». En base, deux lots portent déjà
`numero_lot_fournisseur IS NULL`.

> **Mise à jour du 30/07/2026 — corrigé.** `schemaLigneReception`
> (`packages/core/src/contrats/stock.ts:104-120`) documente désormais explicitement que
> l'identification (numéro fournisseur OU DLC précise) est une exigence réglementaire tenue côté
> service, pas Zod (« docs/17 fiche 16 ; CLAUDE.md §3 règle 6 »). `enregistrerReception`
> (`packages/db/src/services/reception.ts:203-257`) refuse désormais une ligne dont `dateDlc` est
> `null` **et** `numeroLotFournisseur` vide (`:239-250`, message « Indiquez le numéro de lot, ou à
> défaut une DLC précise. »), et avertit (sans bloquer) quand seule la DLC identifie le lot
> (`:255-260`). Une DLC peut aussi être déduite automatiquement de la durée de conservation
> déclarée de l'ingrédient quand elle est omise (`:203-207`).

---

### G10 — Un écart de caisse de −50,00 € s'affiche sur un formulaire vierge

**Geste.** Sessions → cliquer une session planifiée. Sans rien saisir :

```
Écart de caisse   ■  −50,00
```

avec le glyphe de dépassement.

**Ce qui devrait s'afficher.** `—`. Le champ « Espèces comptées » est vide (le fonds de caisse
est pré-rempli à 50,00 €), et la formule documentée
(`(espèces − fonds) + carte − CA`, docs/02 §289) traite ce vide comme 0 :
`(0 − 50) + 0 − 0 = −50`. Tant que la caisse n'a pas été comptée, il n'y a pas d'écart, il y a
une absence de mesure.

**Pourquoi ça compte.** C'est la toute première chose que voit le porteur en ouvrant la
clôture, un dimanche à 21 h. Une alerte rouge qui n'en est pas une apprend à ignorer les
alertes rouges.

Même famille, même écran : « Taux d'écoulement **0 %** » s'affiche alors que rien n'est saisi
(0 produites / 0 vendues).

_Capture : `sorties\test-06-DEFAUT-ecart-caisse-moins-50-sur-formulaire-vide.png`_

> **Mise à jour du 30/07/2026 — partiellement corrigé : le taux d'écoulement est réglé, l'écart de
> caisse ne l'est pas.** Côté « Taux d'écoulement » : `packages/core/src/sessions.ts:172-181`
> rend désormais `tauxEcoulementBp: PointsDeBase | null` (`null` quand rien n'a encore été
> produit, avec un commentaire qui cite explicitement ce défaut : « un dénominateur inconnu rend
> `null`, jamais un chiffre inventé »), et côté écran `apps/web/src/pages/Sessions.tsx:1258-1266`
> calcule `tauxEcoulementEnCours` avec la même garde (`crepesProduites === 0 ? null : …`), affiché
> via `ouTiret` (`:2597`) — donc un tiret, plus un « 0 % » trompeur. En revanche, l'écart de
> caisse EN COURS DE SAISIE n'a pas reçu le même traitement : `rapprocherCaisse`
> (`packages/core/src/sessions.ts:99-111`) rend toujours un `ecartCaisseCents: Centimes` non
> nullable, et l'écran (`apps/web/src/pages/Sessions.tsx:1163-1173,2452`) continue de lui passer
> `especesValeur ?? 0` quand le champ est vide, puis d'afficher inconditionnellement
> `rendreEcartCaisse(resultatCaisse.ecartCaisseCents)` sans vérifier si le champ a été rempli. Sur
> un formulaire vierge (fonds pré-rempli à 50,00 €, espèces vide), l'écart affiché en direct reste
> **−50,00 €**. Une lecture séparée (`detail.ecartCaisseCents === null ? … : …`, `:693-697`, et
> `s.ecartCaisseCents === null`, `:800`) gère bien le cas `null` pour une session déjà
> **enregistrée**, mais ce n'est pas le même code que l'aperçu en direct pendant la saisie, qui
> est celui que ce test décrit.

---

### G11 — Les températures ne sont pas dans l'écran de clôture

`docs/06 §Les cinq écrans qui comptent` place explicitement le bloc TEMPÉRATURES dans l'écran
de session, avec sa raison : _« Les températures sont dans le même écran que les ventes : un
registre qu'on remplit ailleurs est un registre qu'on ne remplit pas. »_

La clôture contient VENTES / CAISSE / PRODUCTION / FRAIS / heures / notes — **pas de
températures**. Elles vivent uniquement dans Registre AFSCA, sur un formulaire qui ne permet
d'ailleurs pas de rattacher le relevé à une session (seulement à une date).

Constat cohérent : la base contient **0 relevé de température** pour une session de
démonstration pourtant clôturée avec chaîne du froid passive.

> **Mise à jour du 30/07/2026 — corrigé.** Un bloc « Températures » existe désormais directement
> dans l'écran de clôture (`apps/web/src/pages/Sessions.tsx:2729-2735`, commentaire « Températures
> à la clôture (docs/17 fiche 17) »), avec un champ par moment (optionnel,
> `LIBELLE_MOMENT_TEMPERATURE`, `:579-591`). Le rattachement à la session existe aussi côté
> service : `ecrireReleveTemperature` (`packages/db/src/services/afsca.ts:85-114`) accepte un
> `sessionId` optionnel et le vérifie avant écriture, et son commentaire
> (`:55-60`) confirme que `cloturerSession` (`packages/db/src/services/sessions.ts`) rattache un
> relevé à la session qu'elle clôture dans la même transaction.

---

### G12 — Le « coût de revient par crêpe » mélange la revente et les frais fixes

**Ce qui s'affiche** sur SM-2026-0003 : `Coût de revient par crêpe 1,93 €`.

**Recalcul.** `(19,20 € de sirop revendu + 0,51 € de commission + 42,00 € de frais) / 32
crêpes = 1,928 €`. Le chiffre divise donc par le nombre de **crêpes** un total qui contient le
coût d'achat des **pots de sirop revendus** et l'intégralité des frais fixes de la journée.

**Pourquoi c'est trompeur.** Une crêpe vendue 3,00–3,50 € avec un « coût de revient » annoncé
à 1,93 € suggère une marge de ~40 %, quand CLAUDE.md §6 annonce ~90 % sur le transformé.
L'indicateur est en réalité un « coût complet par crêpe vendue », et il est mal nommé. Il
héritera par ailleurs de l'erreur G1 une fois celle-ci corrigée.

> **Mise à jour du 30/07/2026 — corrigé, exactement comme proposé.** `RentabiliteSession`
> (`packages/core/src/sessions.ts:200-208`) sépare désormais `coutMatiereParCrepeCents` (matière
> du transformé seul, garnitures comprises, « comparable aux 0,33-0,45 €/crêpe de CLAUDE.md §6 »)
> de `coutCompletParCrepeVendueCents`, dont le commentaire dit explicitement : « Anciennement
> `coutRevientParCrepeCents`, qui divisait aussi le coût d'achat des marchandises revendues par les
> crêpes vendues — un facteur ~2 sur la marge affichée dès qu'il y avait de la revente
> (docs/14 G12, docs/17 fiche 12). Le nom change avec le calcul. » — ce test est cité par son nom
> dans le code.

---

### G13 — « Panier moyen » ne peut jamais être calculé

`Panier moyen —` sur la session clôturée. La colonne `nb_transactions` existe en base (la
session de démo porte 156), mais **le formulaire de clôture n'offre aucun champ pour la
saisir**. J'ai listé les 17 contrôles du panneau : 3 quantités vendues, fonds, espèces, carte,
produites, invendues, cassées, 4 frais, 2 heures, notes, 1 case à cocher. Aucun compteur de
tickets. L'indicateur restera vide indéfiniment.

> **Mise à jour du 30/07/2026 — corrigé.** Un champ « Tickets (optionnel) » existe désormais dans
> le panneau de clôture (`apps/web/src/pages/Sessions.tsx:2429-2447`, `nbTicketsSaisie`), avec un
> texte d'aide qui explique la source attendue (« Relevé sur le terminal SumUp, pas compté à la
> main (D-039, docs/17 fiche 11) : seule source du panier moyen, laissé vide il reste `null` —
> jamais un chiffre calculé sur des articles », `:2456-2458`). Propagé côté serveur par
> `packages/db/src/services/sessions.ts:134,955,981` (`nbTickets`) jusqu'à
> `panierMoyenCents = caTotalCents / nbTickets` (`packages/core/src/sessions.ts:292-295`). Même
> correctif que I5 de `docs/09-AUDIT-ARCHITECTURE.md`.

---

### G14 — Le mail « envoyé » ne l'a pas été, et l'écran ne le dit pas

**Geste.** Achats → commande validée → saisir une adresse → « Envoyer par email ».

**Ce qui s'affiche.** `Envoyée à meunier@example.be le 28/07/2026.` La commande passe au statut
« Envoyée », avec une date d'envoi.

**Ce qui s'est réellement passé.** Aucun `.env` n'existe (seul `.env.example` est présent), donc
aucun SMTP n'est configuré. Le mail a été **archivé sur le disque** :

```
sorties\mails\mail_20260728-1857_meunier@example.be.txt
  ↳ « [MODE TEST — ce mail n'a PAS été envoyé, il est archivé ici] »
```

Le fichier est parfaitement honnête. **L'écran, lui, ne l'est pas** : rien n'y indique le mode
test, ni le chemin du fichier. Le porteur croit que le meunier a reçu sa commande. Le samedi,
il n'y a pas de farine.

**Ce qui devrait s'afficher.** « Mode test : le mail n'a pas été envoyé. Il est archivé dans
sorties\mails\… — configurez le SMTP dans .env pour un envoi réel. »

_(Le PDF joint, lui, est bien produit : `sorties\bon_commande_CF-2026-0002_v1_20260728-1857.pdf`,
61 Ko.)_

---

### G15 — Messages et libellés : le petit lot

| Où                         | Ce qui s'affiche                                                                                                              | Ce qu'il faudrait                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Production, faisabilité    | `il manque 218 g de Sucre vanillé, et 2 autre(s) ingrédient(s) en manque`                                                     | Le `(s)` de gabarit est visible à l'écran ; le tableau juste dessous liste déjà les 3.                                               |
| Production, liste          | `1 PRODUCTIONS`                                                                                                               | `1 production`. Idem `1 RELEVÉS` sur l'AFSCA. L'accord est correct ailleurs (`1 ligne` / `3 lignes`, `9 ingrédients`).               |
| AFSCA, températures        | `Indiquez l'action corrective prise.`                                                                                         | Correct et actionnable, mais sans le chiffre : « 9,5 °C dépasse le seuil de 7 °C — indiquez l'action corrective prise. »             |
| Production                 | `Route inconnue : GET /api/documents/etiquette-bac/019faa25-9dda-712b-81a9-b92875f60690.`                                     | Une URL et un UUID affichés à l'utilisateur. Même si la route manque (chantier en cours), le message ne doit jamais sortir tel quel. |
| Fournisseurs               | colonne TYPE : `systeme` en minuscules brutes, à côté de `Grossiste` / `Ferme`                                                | Valeur d'énumération non traduite.                                                                                                   |
| Journal des achats (Excel) | colonne Date : `2026-07-21T00:00:00.000Z`                                                                                     | Le comptable ouvre un texte ISO au lieu d'une date. CLAUDE.md règle 8 : « affichage local » — un export Excel est un affichage.      |
| Stock                      | La colonne **couverture en sessions** décrite dans `docs/06 §4` (« il me reste une séance de farine ») est absente.           | —                                                                                                                                    |
| Achats                     | Bien vu : la note « Sans rattachement, la marchandise reçue sera comptée deux fois par le point de commande » est exemplaire. | —                                                                                                                                    |

---

## 3. Ce qui fonctionne — écran par écran

Cette section existe pour dire ce que le test couvre. Tous les chiffres ci-dessous ont été
recalculés à la main.

**Tableau de bord.** Chiffres justes. `Dont revente : 405,00 € (48 %)` = 405/838 = 48,33 %.
Seuils TVA 3 % (838/25 000) et Airbag 4 % (838/23 000) corrects. Les tuiles « À traiter »
naviguent. Console vierge.

**Stock — réception.** Le premier maillon de la chaîne existe et il est bon. Réception à 3
lignes enregistrée intégralement au clavier, RC-2026-0005, 74,90 €. Chaque quantité est
relue dans son unité naturelle sous le champ (`25000` → `25,0 kg`, `12000` → `12,0 L`,
`180` → `180 pièces`). Total saisi 74,90 € = 21,50 + 13,80 + 39,60. Après enregistrement :
valeur totale 77,24 → 152,14 € (+74,90 exact) ; farine 21,6 → 46,6 kg ; lait 6,4 → 18,4 L ;
œufs 13 → 193. Le champ « Commande à solder » n'apparaît qu'une fois le fournisseur choisi,
avec l'avertissement du double comptage — bonne divulgation progressive.

**Stock — état.** Valeur totale = somme exacte des 9 lignes (7,48 + 5,86 + 2,60 + 6,45 + 7,36

- 28,80 + 1,82 + 16,21 + 0,66 = 77,24). Tri par urgence, glyphe + texte (jamais la couleur
  seule). Détail des lots au clic. Exports Excel présents.

**Achats.** Génération, détail, conditionnements réels (« Boîte 10 sachets (7,5 g) × 1 =
75 g »), envoi mail + PDF, tableau des « ingrédients ignorés » avec motif. Le message
« Aucun ingrédient sous le point de commande : aucun brouillon généré » est juste et clair.
Le point de commande **se déclenche** dès qu'un ingrédient descend (vérifié : 1 brouillon
généré après la production).

**Prochaine session.** Le meilleur écran de l'application. L'explication est compréhensible
sans documentation : « Une rupture coûte 2,97 € de marge, un invendu 0,26 € de pâte. On
produit donc au niveau qui couvre 92 % des cas, pas 50 %. » Et le 92 % est **exact** :
2,97/(2,97+0,26) = 91,95 %. Le tableau « D'OÙ VIENT CE CHIFFRE » (base 124 × météo 1,00 ×
événement 1,00 × saison 1,00 × tendance 1,00) est lisible, et dit honnêtement « pas encore
modélisée » plutôt que d'inventer. Confiance annoncée à 9 % sur 1 session — démarrage à froid
assumé. Capacité de cuisson 331 = 60 crêpes/h × 6,5 h × 85 % (`marge_securite_service_bp`),
traçable jusqu'au paramètre.

_Réserve de lecture :_ la recommandation (203) sort de la fourchette affichée (79–194) sans
que l'écran explique que 194 est le 90ᵉ centile et 203 le 92ᵉ. Un bandeau « fourchette
10 %–90 % » lèverait l'ambiguïté.

**Production.** Excellent. Faisabilité recalculée en direct, au gramme près — j'ai vérifié les
8 lignes pour 203 crêpes et les 8 pour 40 crêpes, aucune erreur. Bouton « Utiliser ce volume
comme cible » qui résout l'impasse au lieu de la constater. **FEFO correct** : la production a
consommé `DÉMO-OEUFS-01` (DLC 12/08) avant mon lot du 18/08, mon lot de lait (12/08) avant le
lot de démo (20/10), et a **écarté les lots périmés de vergeoise**. Consommation répartie sur
deux lots quand nécessaire (38 g + 15 g de sucre vanillé). Coûts de consommation exacts :
beurre 364 g × 0,90 c/g = 3,28 € ; farine 961 g × 0,086 c/g = 0,83 €. Écart de rendement
−5,0 % = (38−40)/40. Lot de pâte nommé et daté (PATE-PR-2026-0002, DLC J+1).

**Sessions — clôture.** Arithmétique juste partout sauf G1 : ventes 18×3,50 + 14×3,00 +
4×7,50 = 135,00 € ; commission 1,69 % × 30,00 = 0,51 € ; frais 22+14+6 = 42,00 € ; marge
nette 115,80 − 0,51 − 42,00 = 73,29 €. **Écart de caisse exact** : (155 − 50) + 30 − 135 = 0.
Contrôle de cohérence en direct : « produites ≠ vendues + invendues + cassées (−32) », qui
disparaît une fois 38 = 32 + 6 + 0. Les 4 pots de revente sont correctement **exclus** du
compteur « Vendues 32 » (qui ne compte que les crêpes) — subtilité bien traitée.

**Session de démonstration SM-2026-0002** (recalculée intégralement en base) : CA 83 800 c ;
transformé 43 300 + revendu 40 500 = 83 800 ✓ ; marge brute 83 800 − 29 521 = 54 279 ✓ ;
marge nette 54 279 − 625 − 2 200 = 51 454 ✓ ; commission 1,69 % × 37 000 = 625 ✓ ;
écoulement 134/140 = 95,7 % → affiché 96 % ✓ ; écart de caisse 0 ✓.
**Le bug historique « marge à 95,7 % » est bien corrigé** : la marge nette affichée
(514,54 € sur 838 €, soit 61,4 %) inclut le coût des marchandises revendues.

**Registre AFSCA.** Refus correct d'un relevé hors seuil sans action corrective. Onglet
Nettoyage remarquable : les 10 tâches en retard portent chacune un **motif** (« Une session a
été clôturée depuis le dernier nettoyage », « Jamais exécutée ») — c'est ce qui transforme une
liste en outil. Enregistrement d'une exécution au clic sur la ligne, la tâche quitte aussitôt
la liste des retards. Génération du registre PDF mensuel, correctement versionnée (v1 puis v2
sur la même période — vérifié). Affichette allergènes. Les états vides sont soignés : « Aucune
non-conformité déclarée. C'est la situation attendue. »

**Comptabilité.** Hors G2 : l'arithmétique interne est exacte (199,47 = 20,50 % × 973 ;
309,41 = 40 % × (973 − 199,47) ; net 464,12). La mention exigée par CLAUDE.md §7 est présente
et bien écrite. Échéancier réglementaire complet et correctement daté (listing clients TVA au
31/03/2027). Journaux Excel produits, avec la mention art. 56bis. « La clôture d'un mois marque
ses écritures comme figées ; elle ne les rend pas infalsifiables » — honnêteté appréciable.

**Produits / Fournisseurs / Événements.** Formulaires de création présents et fonctionnels.
Textes d'aide de bonne qualité (« À cocher seulement s'il y a table ou chaise au stand… »
pour la consommation sur place ; « C'est à cette adresse que partent les bons de commande »).
Fournisseurs signale « ▲ Sans e-mail » — le défaut de données est visible.

**Qualité du modèle.** État vide correct, avec le geste à faire et un lien pour y aller.

**Paramètres.** 50 paramètres, versionnés et datés. Aucune valeur métier codée en dur :
j'ai vérifié que le taux SumUp (169 bp = 1,69 %), les 3 seuils légaux, la demi-vie de
pondération (182 j = « 26 semaines » affiché) et la capacité de la glacière viennent tous de
la table. Conforme à CLAUDE.md §7 — à l'écriture près (G8).

---

## 4. Verdict sur la saisie au clavier

**Tenable, et même agréable, sur les deux écrans qui comptent.** C'est la bonne surprise du
test.

### Parcours réellement joué — réception (souris utilisée : zéro)

```
[↓][↓]           choisir le fournisseur (liste native, flèches)
[Tab]×4          traverser la date pré-remplie (3 segments JJ/MM/AAAA + sortie)
B L - M E U…     n° de bon de livraison
[Tab]×3          commande à solder → notes → 1re ligne
f                type-ahead : « Farine de froment T55 » sélectionnée
[Tab] 2 5 0 0 0  quantité, relue « 25,0 kg » sous le champ
[Tab] 2 1 , 5 0  prix
[Tab] M E U…     n° de lot
[Tab] 31032027   DLC saisie en chiffres, sans ouvrir le calendrier
[Entrée]         → ligne 2 créée, focus posé sur son sélecteur d'ingrédient
…               (idem lignes 2 et 3)
[Ctrl+Entrée]    → « Réception RC-2026-0005 enregistrée — 3 lots créés, 74,90 € »
```

Le raccourci est **annoncé dans l'écran** (« Entrée : ligne suivante · Ctrl+Entrée :
enregistrer ») et il fonctionne exactement comme annoncé. Le focus atterrit au bon endroit
après création de ligne.

### Parcours réellement joué — clôture de session

```
1 8 [Entrée]     quantité produit 1 → focus produit 2
1 4 [Entrée]     produit 2 → focus produit 3
4  [Tab]×2       produit 3 → « + ligne… » → fonds de caisse
[Tab] 1 5 5      espèces comptées      → écart recalculé en direct
[Tab] 3 0        carte                 → « Écart de caisse ● 0,00 »
[Tab] 3 8        produites             → alerte de cohérence qui disparaît
… [Ctrl+S]       → « Clôture enregistrée »
```

Là encore le contrat affiché (« Tab champ suivant · Entrée ligne suivante · Ctrl+S
enregistrer ») est tenu.

### Détails vérifiés

- **Sélection au Tab.** Les champs pré-remplis (volume réel `3014`, crêpes `40`, fonds
  `50,00`) sont **entièrement sélectionnés** à l'arrivée du Tab : taper remplace, sans
  concaténer. _J'avais d'abord cru à un défaut ; c'était un artefact de mon focus programmé.
  Vérifié au vrai Tab : `selectionStart=0, selectionEnd=4`. Pas de défaut._
- **Tableaux navigables.** `tabindex` roulant correct sur les grilles (0 sur la ligne
  sélectionnée, −1 ailleurs).
- **Lien d'évitement** « Aller au contenu » présent.

### Le seul vrai accroc clavier

**« Œufs entiers » est inatteignable au type-ahead.** Dans le sélecteur d'ingrédient, taper
`o` ne sélectionne rien : la ligature `Œ` n'est pas normalisée par la recherche native du
navigateur. Il faut 9 flèches, ou la touche `Fin` (qui marche ici seulement parce que l'entrée
est la dernière de la liste alphabétique). Sur la recette phare, c'est l'ingrédient le plus
saisi. Un `<datalist>` ou un champ de recherche filtrant réglerait le cas.

**Coût annexe, non imputable à l'application :** un `<input type="date">` consomme 4 appuis de
Tab (3 segments + sortie). Sur une réception à 5 lignes, cela fait 20 Tab rien que pour les
DLC. À considérer si la saisie devient volumineuse.

---

## 5. Erreurs de console, écran par écran

| Écran                                                                                | Console                                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Tableau de bord                                                                      | **Aucune.**                                                                                       |
| Stock (liste, réception, détail des lots)                                            | **Aucune** sur tout le parcours de saisie.                                                        |
| Achats — chargement, génération, envoi                                               | **Aucune.**                                                                                       |
| Achats — clic sur « Valider la commande »                                            | `POST /api/commandes/{id}/valider → 400`. **3 fois sur 3.** → G3                                  |
| Prochaine session                                                                    | **Aucune.**                                                                                       |
| Production — chargement, faisabilité, lancement, réalisé                             | **Aucune.**                                                                                       |
| Production — clic « Étiquette du bac (PDF) »                                         | `GET /api/documents/etiquette-bac/{id} → 404`. Chantier « documents » en cours (§7).              |
| Sessions — saisie et clôture                                                         | **Aucune.**                                                                                       |
| Registre AFSCA — relevé hors seuil sans action corrective                            | `POST /api/afsca/temperatures → 422`. **Attendu** : c'est la règle métier qui s'applique.         |
| Registre AFSCA — traçabilité, numéro de lot inconnu                                  | `404` sur la recherche. Attendu, message correct.                                                 |
| Recettes                                                                             | `GET /api/referentiel/recettes → 404`, l'écran ne charge pas. Chantier référentiel en cours (§7). |
| Produits / Fournisseurs / Événements / Qualité du modèle / Paramètres / Comptabilité | **Aucune.**                                                                                       |

Aucune exception JavaScript non gérée n'a été observée sur l'ensemble du parcours. Le seul
avertissement noté (`The specified value "31032027" does not conform to the required format`)
provenait de mon propre outillage de test, pas de l'application.

---

## 6. Captures

Toutes dans `C:\Users\<compte>\Desktop\AppCrepe\sorties\`.

| Fichier                                                               | Ce qu'il montre                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `test-01-tableau-de-bord.png`                                         | État initial : 203 crêpes, seuils, dernière session 838 €.                   |
| `test-02-reception-3-lignes-avant-enregistrement.png`                 | Réception saisie au clavier, total 74,90 €, quantités relues en kg/L/pièces. |
| `test-03-reception-enregistree-RC-2026-0005.png`                      | Confirmation + stock mis à jour (152,14 €).                                  |
| `test-04-DEFAUT-valider-commande-400.png`                             | **G3** — le message d'erreur JSON sous le bouton Valider.                    |
| `test-05-DEFAUT-prevision-203-non-produisible.png`                    | **G7** — 203 crêpes recommandées, 40 réalisables, 3 manquants chiffrés.      |
| `test-06-DEFAUT-ecart-caisse-moins-50-sur-formulaire-vide.png`        | **G10** — −50,00 € avant toute saisie.                                       |
| `test-07-DEFAUT-cout-matiere-sans-la-pate.png`                        | **G1** — coût matière 19,20 € = les 4 pots seuls.                            |
| `test-08-DEFAUT-tracabilite-uuid-et-session-vide.png`                 | **G4** — recherche par UUID, colonne SESSION à `—`.                          |
| `test-09-DEFAUT-non-conformites-vides-malgre-releve-non-conforme.png` | **G5** — « Aucune non-conformité. C'est la situation attendue. »             |
| `test-10-DEFAUT-benefice-brut-sans-cout-matiere.png`                  | **G2** — bénéfice brut 973,00 € = recettes.                                  |
| `test-11-DEFAUT-lots-perimes-marques-disponible.png`                  | **G6** — « Disponible 311 g » au-dessus de 10 500 kg « Disponible ».         |

---

## 7. Ce qui n'est pas un défaut

Consigné pour éviter qu'un lecteur ultérieur ne le rapporte à nouveau.

**Chantiers en cours au moment du test** (signalés, non instruits) :

- `GET /api/documents/etiquette-bac/:id` → 404 : boutons de téléchargement en cours de
  branchement.
- Écran Recettes cassé (`GET /api/referentiel/recettes` → 404) : migration des écrans
  d'écriture du référentiel en cours. L'ancienne route `/api/recettes` répond toujours 200.
- Absence d'écran pour saisir un stock de sécurité ou un ingrédient : même chantier.
- Coût des garnitures absent de la fiche produit : chantier en cours.
- Contrepassation d'un mouvement de stock : non testée, chantier en cours.

> **Mise à jour du 30/07/2026 sur ces chantiers « en cours » — les deux premiers sont désormais
> livrés, revérifiés directement.** `GET /documents/etiquette-bac/:id`
> (`apps/api/src/routes/documents.ts:170`) existe. `GET /referentiel/recettes`
> (`apps/api/src/routes/referentiel-ecriture.ts:253`) existe aussi, de même que
> `GET /referentiel/ingredients` (`:133`) et `GET /referentiel/lieux` (`:327`) — l'écran Recettes
> ne devrait donc plus être cassé pour cette raison précise. Le stock de sécurité et un ingrédient
> sont désormais saisissables via `POST /ingredients` et `PATCH /ingredients/:id`
> (mêmes lignes `:138,148`). Le coût des garnitures est traité en détail par la mise à jour de I6
> de `docs/09-AUDIT-ARCHITECTURE.md` (corrigé). Non revérifié ici : le rendu visuel réel de
> l'écran Recettes et la contrepassation d'un mouvement de stock (seule la présence des routes
> côté API a été confirmée pour les deux premiers points).

**Faux départs de ma part, vérifiés puis écartés :**

- _« Les champs pré-remplis concatènent au lieu de remplacer. »_ Faux : artefact d'un focus
  programmé. Au vrai Tab, le contenu est sélectionné.
- _« Le tableau de bord et Prochaine session affichent des dates de session différentes
  (02/08 vs 28/07). »_ Faux : un autre agent avait créé la session SM-2026-0003 entre mes deux
  chargements. Après rechargement, les deux écrans s'accordent sur 28/07.
- _« Le registre AFSCA génère deux fichiers v1 pour le même mois. »_ Faux : la 3ᵉ génération a
  bien produit un v2. Le doublon venait d'un réamorçage de base par un autre agent.
- _« Le compteur "Cotisation réduite" compare un CA à un seuil de revenu net. »_ C'était vrai
  au début du test (838,00 / 17 374,08 → 5 %). **Corrigé pendant le test** par un autre agent :
  l'écran affiche désormais 399,73 / 17 374,08 → 2 %, chaque seuil étant confronté à sa propre
  assiette. Vérifié dans `tableauSeuils`. Ne pas rouvrir.
- _« Le point de commande ne se déclenche jamais. »_ Faux : il se déclenche (§G7). Ce qui est
  vrai, c'est qu'il ignore la demande prévue.

**Incidents d'environnement, pas de l'application :**

- API injoignable ~12 min (19h25 → 19h38) puis ~1 min (20h05), pendant des reconstructions.
- Un `404` transitoire sur `/stock` pendant un redémarrage ; 200 juste après.
- Le navigateur Playwright est partagé : mes onglets ont été volés ou fermés à quatre reprises,
  dont une fois en pleine saisie de clôture (données perdues, saisie refaite à l'identique).
- Les lots de 10 t de vergeoise et 500 kg de sel sont des données de test d'un autre agent.
  Les défauts G6 et G9 ont été reproduits indépendamment de ces données.

---

## 8. Si je ne devais corriger que trois choses

1. **G1 + G4 — rattacher la production à la session.** Une seule cause
   (`production.session_id` toujours nul) produit à la fois la marge fausse et le trou de
   traçabilité. C'est la jointure qui manque au milieu de la chaîne annoncée en CLAUDE.md §0.
2. **G2 — faire entrer les achats de marchandises dans la synthèse d'exercice.** Les données
   existent et sortent déjà correctement dans le journal des achats Excel (447,61 €) ; seul
   l'écran les ignore.
3. **G3 — la ligne d'en-tête JSON dans `requeteApi`.** Un défaut d'une ligne qui coupe en
   deux tout le module Achats.
