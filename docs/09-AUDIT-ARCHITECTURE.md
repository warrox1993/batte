# 09 — Audit d'architecture (adverse)

> Audit conduit le 27/07/2026 sur l'état du dépôt après les 11 lots.
> 41 tables, 449 tests (1 échec, dans `parcours-erp.test.ts`, travail d'un autre agent en cours).
> Méthode : vérification des 10 règles non négociables une par une, preuve à l'appui,
> puis recherche ciblée des modes de défaillance en usage réel.
> **Aucun fichier de code n'a été modifié.**

> **Mise à jour du 30/07/2026 — les trois défauts « Bloquants » (B1, B2, B3) sont corrigés.**
> Vérifié directement contre le code, pas recopié d'un autre document :
>
> - **B1 (boucle d'achat qui ne se referme jamais)** — `docs/17-VINGT-AMELIORATIONS.md` (§2, ligne
>   « Boucle d'achat jamais refermée ») le donne corrigé par **D-036**.
> - **B2 (vendre un produit revendu ne sort rien du stock)** — corrigé. `sortirLesProduitsRevendus`
>   (`packages/db/src/services/sessions.ts:1111-1170`) répartit en FEFO et écrit un mouvement
>   `sortie_vente` pour chaque produit `revendu` vendu à la clôture d'une session, exactement le
>   correctif suggéré ici. `coutRevenduCents` en sort, désormais intégré au coût de la session. Ce
>   n'était pas explicitement listé dans le tableau « à NE PAS rouvrir » de `docs/17`, mais
>   `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §6 confirme indépendamment que `sortie_vente` est
>   « désormais émis par `cloturerSession` en FEFO (D-037/D-049) ».
> - **B3 (journal d'audit qui n'existe que dans le schéma)** — corrigé côté lecture, la seule moitié
>   qui manquait (l'écriture, elle, était déjà en place au 27/07 par endroits). `listerJournalAudit`
>   est désormais appelée par `apps/api/src/routes/audit.ts:136` (route `GET /audit`) et consommée
>   par un écran, `apps/web/src/pages/JournalAudit.tsx:247`. Détail complet :
>   `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §4.9.
>
> Les défauts « Importants » (I1 à I10) n'ont pas été revérifiés un par un dans cette passe — au
> moins I1 (récurrence trimestrielle), I2 (colonnes d'argent en `REAL`) et I3 (`AUJOURD_HUI` figé)
> sont donnés corrigés par `docs/17-VINGT-AMELIORATIONS.md` §2 ; les autres (I4 à I10) n'ont pas été
> revérifiés ici et ne doivent pas être présumés clos.
>
> **Complément du 30/07/2026, passe suivante** : I6 (garnitures), I7 (écart théorique/réel), I9
> (sauvegarde) et I10 (tables de facture) ont depuis été revérifiés individuellement et sont
> **corrigés** — voir l'encadré propre à chacun, plus bas dans ce document. Ne restent non
> revérifiés depuis le 27/07 : I4, I5, I8.

---

## 1. Verdict en cinq lignes

Les fondations sont bonnes et les règles les plus difficiles sont réellement tenues : le stock
est bien la somme de ses mouvements, la contrepassation est correcte, Claude ne calcule jamais,
les seuils légaux portent bien sur le CA ventilé transformé/revendu, et le code est lisible.
**Mais la chaîne ERP promise au §0 est rompue en trois endroits**, et l'une de ces ruptures
— la boucle d'achat qui ne se referme jamais — désarme silencieusement le réapprovisionnement
au bout de quelques commandes : l'application cessera de proposer de commander de la farine
sans rien signaler. Deux tables réglementaires (`journal_audit`, `facture_fournisseur`) sont
présentes au schéma et mortes dans le code. L'application n'est pas prête pour une année
d'exploitation réelle ; elle en est à trois corrections ciblées de l'être.

---

## 2. Tableau des 10 règles

| #   | Règle                                                        | État          | Preuve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Logique métier chiffrée dans `packages/core`, pure et testée | **Partielle** | Respectée côté serveur : `depots/recettes.ts:4-7` délègue à `mettreAEchelle`, `depots/comptabilite.ts:686` et `723` délèguent à `estimerResultat`. Fuites côté React : `pages/Comptabilite.tsx:94-101` (`parserPourcentBp`), `pages/Evenements.tsx:89-97` (conversion % → bp), `pages/Sessions.tsx:381-382` (recalcule `fraisTotauxCents` déjà produit par `calculerRentabilite`)                                                                                                                       |
| 2   | Un LLM ne calcule jamais                                     | **Respectée** | `apps/api/src/ia/client.ts:12-15, 39-40` : le contenu envoyé contient des chiffres déjà calculés ; D-029 appliquée, `routes/previsions.ts` recalcule côté serveur. `client.ts:149` : `valideeParHumain: null` car un commentaire n'alimente pas la base. Aucune écriture en base issue d'une réponse Claude                                                                                                                                                                                             |
| 3   | Argent en centimes entiers, aucun flottant                   | **Violée**    | `packages/db/src/schema.ts:435` et `:1048` : `real('prix_unitaire_cents')` sur `lot` et `commande_ligne`. Alimenté par une division flottante `services/reception.ts:136` et `depots/recettes.ts:41`. Le reste du schéma est bien en `integer`                                                                                                                                                                                                                                                          |
| 4   | Masses en g, volumes en ml, conversions par densité déclarée | **Respectée** | `packages/core/src/unites.ts:34-60` : lève `densite_manquante` plutôt que de supposer 1 g/ml, arrondit à l'entier. Réserve, **levée le 30/07/2026** : `convertir()` a désormais un appelant de production, `packages/db/src/services/sessions.ts:394` (import `:15`), pour convertir en millilitres un volume de pâte restant saisi en grammes à la clôture de session (voir `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §5.1). La règle est donc tenue par usage, plus seulement par absence de conversion |
| 5   | Le stock ne se modifie que par un mouvement                  | **Partielle** | Cœur correct : `depots/stock.ts:40-44` (`SQL_RESTANT`), aucun `UPDATE` sur une colonne de quantité (grep `.update(` : seuls statuts, dates, drapeaux). **Mais** la vente d'un produit revendu ne produit aucun mouvement (défaut B2)                                                                                                                                                                                                                                                                    |
| 6   | Traçabilité par lot obligatoire, consommation FEFO           | **Partielle** | Production conforme : `services/production.ts:182, 238-243` (FEFO + `sortie_production`), `core/stock.ts:77-87` départage à DLC égale par date de réception. **Mais** aucune traçabilité de sortie sur les produits revendus (défaut B2)                                                                                                                                                                                                                                                                |
| 7   | Rien ne s'efface ; journal d'audit sur les tables sensibles  | **Partielle** | Premier volet excellent : **zéro `.delete(`, zéro `DELETE FROM` dans tout le dépôt** ; contrepassation `services/mouvements.ts:196-226`, `depots/comptabilite.ts:246`, D-021 correctement appliquée. Second volet absent : `journal_audit` (`schema.ts:84-100`) n'est **jamais écrit** (défaut B3)                                                                                                                                                                                                      |
| 8   | `Europe/Brussels` partout, stockage ISO 8601 UTC             | **Respectée** | `core/horodatage.ts:8, 20-28` ; l'année de numérotation vient toujours de la date métier (`services/reception.ts:83`, `production.ts:154`, `sessions.ts:73`, `commandes.ts:359`) ; `ajouterJours` ancre à `T12:00:00Z`, donc insensible à l'heure d'été. Réserves mineures M6 et I3                                                                                                                                                                                                                     |
| 9   | Zéro donnée personnelle client                               | **Respectée** | Grep `clientNom                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | nomClient | emailClient | prenom | fidelite`sur`schema.ts`: aucun résultat. Les seules colonnes`email`sont`fournisseur.email:112`et`commande_fournisseur.email_envoye_a:1021`, toutes deux B2B |
| 10  | Chaque écran utilisable au clavier                           | **Respectée** | Les 63 `onClick` du front portent tous sur `<button type="button">` (aucun `div`/`span` cliquable). Les deux modes de D-017 existent : grille ARIA dans `composants/Tableau.tsx`, mode tableur dans `pages/Sessions.tsx`                                                                                                                                                                                                                                                                                |

> **Mise à jour du 30/07/2026 sur ce tableau** : les colonnes « État » des règles 3 (Violée), 4
> (réserve sur `convertir()`), 5, 6 et 7 (Partielle, toutes trois à cause de B2/B3) ne sont plus à
> jour. Règle 3 (argent en `REAL`) est donnée corrigée par `docs/17-VINGT-AMELIORATIONS.md` §2
> (« Colonnes d'argent en `REAL`… → Corrigé — `integer` »), non revérifiée indépendamment ici. Règle
> 4 : la réserve « `convertir()` n'est appelée nulle part en production » est fausse depuis le
> 30/07/2026 — voir `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §5.1. Règles 5, 6 et 7 dépendaient
> explicitement de B2/B3, corrigés ci-dessus : leur état réel aujourd'hui est plus proche de
> « Respectée » que de « Partielle », sans qu'une revérification complète et indépendante de chacune
> ait été refaite ligne par ligne dans cette mise à jour.
>
> **Règle 3, revérification indépendante (30/07/2026)** : confirmé directement dans le schéma,
> `packages/db/src/schema.ts:981` déclare désormais `prixUnitaireCents: integer('prix_unitaire_cents')`
> (c'était `real(...)` à la rédaction de la ligne ci-dessus). La correction annoncée par `docs/17`
> tient.

---

## 3. Défauts trouvés

### Bloquants

---

**B1 — La boucle d'achat ne se referme jamais : le réapprovisionnement s'éteint tout seul**

_Où._ `packages/db/src/services/commandes.ts:194-208` (`quantiteDejaCommandee`) et `:333`
(`stockProjete: disponible + dejaCommandee`) ; `packages/db/src/services/reception.ts:98`
(`commandeId: null`) ; `packages/db/src/services/commandes.ts:455` et `:487`.

_Le fait._ `quantiteDejaCommandee` somme les quantités des commandes en statut `brouillon`,
`validee` ou `envoyee`, et le résultat est **ajouté** au stock projeté. Or **aucun code ne fait
jamais passer une commande au statut `recue`** : les seuls statuts jamais écrits sont
`brouillon` (`:376`, `:410`), `validee` (`:455`) et `envoyee` (`:487`). Le statut `recue` existe
dans l'énumération du schéma et dans le commentaire de cycle de vie (`schema.ts:1002-1009`), et
n'est produit nulle part. En parallèle, `reception.ts:98` écrit `commandeId: null` en dur : une
réception n'est jamais rattachée à la commande qui l'a provoquée.

_Ce qui se passe en usage réel._ Vous commandez 25 kg de farine, la commande part par mail,
la farine arrive, vous saisissez la réception. La commande reste `envoyee` **pour toujours**.
À partir de cet instant, `quantiteDejaCommandee` rend en permanence 25 000 g pour la farine, et
ces 25 kg sont comptés **une seconde fois** puisqu'ils sont désormais aussi dans `disponible` :
le stock projeté vaut le double du stock réel. L'effet est **cumulatif** — après dix commandes
dans l'année, le moteur croit que 250 kg de farine sont en route. `calculerBesoinReapprovisionnement`
rend alors `nbConditionnements === 0`, la ligne est écartée par le `continue` de `:337`, et
l'ingrédient **disparaît silencieusement** de la génération de commande. Vous arriverez à court
de farine un samedi soir sans qu'aucune alerte n'ait été levée, précisément parce que
l'application est convaincue que la marchandise arrive.

_Correction suggérée._ Trois points solidaires : (a) peupler `reception.commandeId` à la
réception ; (b) ajouter une transition `envoyee → recue` déclenchée par la réception (totale ou
partielle) ; (c) tant que (a) et (b) ne sont pas faits, borner `quantiteDejaCommandee` aux
commandes dont la `date_reception_prevue` n'est pas dépassée — un garde-fou temporel qui évite
l'accumulation infinie. Ajouter un test de non-régression : « après réception, le stock projeté
n'inclut plus la quantité commandée ».

---

**B2 — Vendre un produit revendu ne sort rien du stock**

_Où._ `packages/db/src/services/sessions.ts:213-292` (bloc « Écritures » de `cloturerSession`) ;
`packages/db/src/schema.ts:297-298` (`produitVente.ingredientId`).

_Le fait._ `cloturerSession` insère les lignes `sessionVente`, met à jour `session_marche` et
insère les frais — et **n'appelle jamais `enregistrerSortie`**. Le type de mouvement
`sortie_vente` est déclaré quatre fois (`core/contrats/stock.ts:13`, `schema.ts:483`,
`services/mouvements.ts:26`, `documents/excel.ts:367`) et **n'est produit nulle part** : le seul
appelant de `enregistrerSortie` en production est l'écran de sortie manuelle
(`apps/api/src/routes/stock.ts:137`). La colonne `produitVente.ingredientId`, documentée comme
« l'article acheté-revendu », n'est **lue par aucune requête** (grep : zéro occurrence hors
schéma).

_Ce qui se passe en usage réel._ Le stock des produits du terroir (sirop, confiture) ne fait que
monter. Après un an, l'application affirme que vous détenez 52 pots de sirop vendus depuis des
mois ; la valorisation du stock est gonflée d'autant, le point de commande ne se déclenche
jamais, et surtout — ce sont des denrées à DLC — **il n'existe aucune trace du lot parti à quelle
date de marché**. C'est exactement la question qu'un contrôleur AFSCA pose sur un produit
préemballé rappelé par son fabricant. La règle 6 (« toute production consomme des lots
identifiés ») est tenue pour la pâte et absente pour la revente.

_Correction suggérée._ Dans la transaction de `cloturerSession`, pour chaque ligne dont
`produit.nature === 'revendu'`, appeler `enregistrerSortie` avec `type: 'sortie_vente'`,
`ingredientId: produit.ingredientId`, `sessionId`, et la quantité vendue. Rendre
`produitVente.ingredientId` obligatoire quand `nature = 'revendu'` (contrainte applicative +
validation Zod), sans quoi la sortie sera impossible à écrire.

---

**B3 — Le journal d'audit n'existe que dans le schéma**

_Où._ `packages/db/src/schema.ts:84-100`.

_Le fait._ La table `journal_audit` est définie, indexée sur `(table_cible, enregistrement_id)`
et sur `date_action`. Aucun code n'y écrit ni n'y lit : grep du symbole `journalAudit` hors
`schema.ts` → **zéro occurrence**. La règle 7 comporte deux volets ; le premier
(« corrections par écriture d'annulation ») est très bien tenu, le second (« journal d'audit sur
toutes les tables sensibles ») n'est pas commencé.

_Ce qui se passe en usage réel._ Le jour d'un contrôle, la table est vide. Les modifications qui
ne passent pas par une contrepassation — changement de statut d'un lot
(`services/mouvements.ts:247-256`), réouverture d'une période
(`depots/comptabilite.ts:665-674`), correction du prix d'un conditionnement, modification d'un
paramètre réglementaire (`depots/parametres.ts:49`) — ne laissent **aucune trace de leur valeur
antérieure**. Or `parametre` porte les seuils légaux : quelqu'un peut relever le seuil de
franchise TVA sans qu'on puisse ensuite établir quelle valeur était en vigueur ni quand elle a
changé. C'est précisément ce que l'auditabilité exigée par la règle 5 était censée garantir.

_Correction suggérée._ Un helper unique `journaliser(base, tableCible, id, action, avant, apres)`
appelé depuis les points d'écriture non contrepassés déjà identifiés ci-dessus. Ne pas viser
l'exhaustivité : cinq tables sensibles (`parametre`, `lot`, `periode`, `conditionnement`,
`session_marche`) couvrent le risque réel.

---

### Importants

---

**I1 — Une échéance trimestrielle ou quinquennale rebondit d'un an**

_Où._ `packages/core/src/comptabilite.ts:281-285` (`prochaineOccurrence`) et
`packages/db/src/depots/comptabilite.ts:504-533` (`marquerEcheanceFaite`).

_Le fait._ `prochaineOccurrence` ne sait faire qu'une chose : ajouter **un an**. Or
`marquerEcheanceFaite` l'applique à toutes les récurrences non ponctuelles, y compris
`trimestrielle` et `quinquennale`. Le commentaire de `depots/comptabilite.ts:441-444` assume
explicitement cette uniformité — c'est là qu'est l'erreur.

_Ce qui se passe en usage réel._ Le catalogue (`core/comptabilite.ts:245-249`) ne contient
qu'**une seule** des quatre échéances INASTI, celle du 10 avril ; les trois autres (10 juillet,
12 octobre, 21 décembre) ne vivent que dans le texte libre de `sourceLegale`, que rien ne lit.
Vous cochez « fait » le 10 avril 2026 : l'échéance repart au 10 avril 2027. **Les cotisations de
juillet, octobre et décembre ne sont jamais rappelées** — et l'INASTI applique des majorations de
retard trimestrielles. Même mécanique pour le renouvellement quinquennal de l'autorisation
d'activités ambulantes : coché en 2026, il réapparaît au 1er janvier 2027 au lieu de 2031, puis
sera perçu comme un faux positif et ignoré — jusqu'à l'année où il comptait vraiment.

_Correction suggérée._ Faire porter le pas à la récurrence : `+3 mois` pour `trimestrielle`,
`+5 ans` pour `quinquennale`, `+1 an` pour `annuelle`. Et ajouter les trois échéances INASTI
manquantes au catalogue, avec leur date propre.

---

**I2 — Deux colonnes d'argent en virgule flottante**

_Où._ `packages/db/src/schema.ts:435` (`lot.prix_unitaire_cents`) et `:1048`
(`commande_ligne.prix_unitaire_cents`) ; alimentées par `services/reception.ts:136`
(`ligne.prixLigneCents / ligne.quantite`) et `services/commandes.ts:339-340`.

_Le fait._ Règle 3 : « aucun flottant pour de l'argent, **nulle part** ». Ces deux colonnes sont
des `REAL`. Le besoin sous-jacent est légitime — un sac de 25 kg à 30,00 € donne 0,12 centime par
gramme, qu'un entier arrondirait à 0 — mais la réponse retenue contredit une règle déclarée non
négociable, et elle le fait dans le fichier dont l'en-tête (`schema.ts:459-462`) proclame la
règle 5. À noter que `depots/recettes.ts:41` produit la même grandeur flottante hors base.

_Ce qui se passe en usage réel._ Le risque n'est pas la perte d'un centime sur une allocation
(`core/stock.ts:139` arrondit correctement chaque ligne), c'est le **cumul** :
`core/stock.ts:181-188` (`valoriserStock`) accumule `quantiteRestante * prixUnitaireCents` en
flottant sur tous les lots avant d'arrondir une seule fois. Sur des années et des milliers de
lignes, la valeur de stock reportée au bilan dérive d'un montant que personne ne saura expliquer,
et deux exécutions sur des ordres de lecture différents peuvent ne pas donner le même total.

_Correction suggérée._ Passer à un entier en **millicentimes** par unité de référence
(`prix_millicents_par_unite`, `INTEGER`), avec division finale unique et arrondi explicite. Ou,
plus simple et plus fidèle à D-018 : ne stocker que `prix_ligne_cents` et `quantite` (deux
entiers) et calculer le prix unitaire à la lecture, comme le fait déjà le CUMP.

---

**I3 — La date du jour est figée au chargement de la page (antidatage AFSCA silencieux)**

_Où._ `apps/web/src/pages/RegistreAfsca.tsx:60`, et les six autres pages :
`Comptabilite.tsx:55-56`, `Production.tsx:61`, `Sessions.tsx:87`, `Stock.tsx:48`,
`TableauDeBord.tsx:53`.

_Le fait._ `const AUJOURD_HUI = jourCivilBelge(new Date());` est évalué **une fois, au chargement
du module**. Cette constante sert ensuite de valeur par défaut à des dates **écrites en base** :
`RegistreAfsca.tsx:203` (`dateReleve`), `:493` (`dateExecution`), `:832` (`dateConstat`),
`:1451` (`dateExercice`), ainsi que `Production.tsx:384` (`dateProduction`) et
`Sessions.tsx:574` (`dateCreation`).

_Ce qui se passe en usage réel._ Le produit est lancé par un raccourci `chrome --app=` (D-012) :
la fenêtre reste ouverte. Ouverte jeudi, utilisée dimanche soir après le marché, elle propose
**jeudi** comme date de relevé de température. L'utilisateur valide sans regarder — c'est une
saisie répétitive faite debout après six heures de marché, le scénario nominal décrit au §3
règle 10. Le relevé part en base avec une date métier fausse de trois jours. C'est un antidatage
du registre AFSCA produit par l'interface elle-même, contre le garde-fou §7.

_Circonstance atténuante à conserver._ La conception serveur est saine : `services/afsca.ts:7-8`
distingue explicitement la date métier de `creeLe`, l'instant réel d'écriture
(`:89`, `:159`, `:320`, `:440`). L'incohérence resterait donc détectable en base.

_Correction suggérée._ Remplacer la constante de module par un appel au moment du rendu du
formulaire (ou un `useState` initialisé à l'ouverture de la modale). Et, puisque le serveur
connaît déjà `creeLe`, refuser côté API une date métier antérieure de plus de N jours à
`creeLe` sans motif explicite.

---

**I4 — Le registre AFSCA affirme une chose et en imprime une autre**

_Où._ `apps/api/src/documents/registre-afsca.ts:16-19` contre `:125`.

_Le fait._ La mention portée en tête du registre déclare :
« Ce registre reprend les données saisies dans l'application, **à leur date de saisie réelle**. »
Or le tableau imprime `formaterDate(l.dateReleve)` — la date **métier**, celle que l'utilisateur
a tapée. Grep de `creeLe` sur l'ensemble de `apps/api/src/documents/` : **zéro occurrence**.
Aucun document généré n'expose jamais la date de saisie réelle.

_Ce qui se passe en usage réel._ Le document remis à un contrôleur affirme une propriété que
l'application ne vérifie pas. Combiné à I3, le registre imprime une date fausse **sous une
mention qui garantit qu'elle est vraie**. C'est le cas exact que le garde-fou §7 interdit :
« Le registre enregistre ce qui a été saisi, avec sa date de saisie réelle. »

_Correction suggérée._ Au choix, mais l'un des deux : ajouter une colonne « saisi le »
alimentée par `creeLe` (préférable — c'est ce que la mention promet), ou corriger la mention pour
qu'elle dise ce que le document fait réellement. La première option est aussi la meilleure
défense en cas de contrôle : elle prouve la tenue au fil de l'eau.

> **Mise à jour du 30/07/2026 — corrigé.** `apps/api/src/documents/registre-afsca.ts` accepte
> désormais un `creeLe` optionnel sur chaque relevé de température et chaque exécution de
> nettoyage (`:58`, `:68`) et imprime une mention « Saisi le JJ/MM/AAAA »
> (`mentionSaisieDifferee`, `:188-192`, appliquée `:217` et `:344`) **uniquement** quand le jour
> civil de `creeLe` diffère du jour métier — jamais sur une saisie le jour même. Le grep
> `creeLe` sur `apps/api/src/documents/` ne rend plus zéro : `apps/api/src/documents/donnees.ts:609`
> et `:618` transmettent bien `t.creeLe` et `n.creeLe` en construisant `DonneesRegistreAfsca`,
> alimentés à la source par `packages/db/src/services/afsca.ts` (`creeLe` écrit `:130`, `:304`,
> `:481`, `:601`). Point de vigilance : `apps/api/src/documents/registre-afsca.test.ts:24-32`
> porte encore, dans son propre commentaire, la note « `donnees.ts` ne transmet PAS ENCORE
> `creeLe` » — cette note est datée et fausse aujourd'hui, le branchement a été fait après
> l'écriture de ce test ; ne pas se fier à ce commentaire sans revérifier `donnees.ts`
> directement, comme fait ici.

---

**I5 — Le « panier moyen » est en réalité un prix moyen par article**

_Où._ `packages/core/src/sessions.ts:125` (`nbTransactions += ligne.quantite`) et `:198-201` ;
repris tel quel en base par `services/sessions.ts:251` puis relu par `depots/sessions.ts:131-134`.

_Le fait._ `nbTransactions` additionne les **quantités vendues**, pas les transactions. La saisie
de clôture est agrégée par produit — il n'existe nulle part un compteur de clients. `panierMoyen`
= CA ÷ nombre d'articles.

_Ce qui se passe en usage réel._ Sur une session type (≈ 838 € de CA, ≈ 134 crêpes plus quelques
pots), l'application affiche un « panier moyen » d'environ 5,50 € alors que le panier réel — un
client qui prend deux crêpes — avoisine 11 €. L'indicateur est faux d'un facteur égal au nombre
d'articles par client, et il est affiché comme une mesure sur un écran de pilotage. Toute
décision de prix ou de mix appuyée dessus part d'un chiffre erroné.

_Correction suggérée._ Soit ajouter un champ saisi `nb_tickets` à la clôture (SumUp le fournit
pour la part carte), soit renommer l'indicateur en « prix moyen par article » et retirer le mot
« panier ». La seconde option est gratuite et honnête ; la première est la vraie réponse métier.

> **Mise à jour du 30/07/2026 — corrigé, par la première option.** `packages/core/src/sessions.ts`
> renomme le dénominateur en `nbArticlesVendus` (`:125-135`, commentaire qui cite explicitement
> l'ancien défaut) et `RentabiliteSession` porte désormais deux champs distincts : `panierMoyenCents`
> (`:189`, CA ÷ **tickets**, `null` tant qu'aucun ticket n'est compté) et
> `prixMoyenParArticleCents` (`:192`, CA ÷ articles, toujours calculable — l'ancien calcul, sous son
> vrai nom). Un champ « Tickets (optionnel) » existe désormais dans le formulaire de clôture
> (`apps/web/src/pages/Sessions.tsx:943` `nbTicketsSaisie`, saisi `:2434-2447`), propagé par
> `packages/db/src/services/sessions.ts:134,955,981` (`nbTickets`). Laissé vide, `panierMoyenCents`
> reste `null` (affiché « — »), jamais un chiffre recalculé sur des articles. Ce même correctif
> répond aussi à G13 de `docs/14-TEST-PARCOURS-UTILISATEUR.md` (« panier moyen ne peut jamais être
> calculé »), qui décrivait le même manque côté écran.

---

**I6 — Les garnitures n'entrent ni dans le stock ni dans le coût matière**

_Où._ `packages/db/src/schema.ts:322-345` (`produitGarniture`) ; relations déclarées `:1532-1542`.

_Le fait._ La table est définie avec un commentaire qui énonce son rôle — « ce qui s'ajoute à la
crêpe et qui doit entrer dans son coût matière complet » — et **aucun code ne la lit ni ne
l'écrit** (grep hors `schema.ts` : seulement les deux déclarations de relations).
`cloturerSession` calcule `coutMatiereCents` uniquement à partir des productions rattachées
(`services/sessions.ts:180-185`), c'est-à-dire de la pâte.

_Ce qui se passe en usage réel._ Le Nutella, le sucre et la confiture étalés sur les crêpes ne
sortent jamais du stock et ne pèsent jamais sur la marge. La « marge nette du dimanche soir »
est structurellement surévaluée, et le « coût de revient réel par crêpe »
(`core/sessions.ts:205-210`) — présenté comme l'indicateur analytique du produit — omet un poste
de coût réel. Le stock de garnitures, lui, dérive comme celui des produits revendus.

_Correction suggérée._ Même correctif que B2, appliqué aux garnitures : à la clôture, pour chaque
produit transformé vendu, consommer les lignes `produit_garniture` × quantité vendue via
`enregistrerSortie`, et ajouter le coût obtenu à `coutMatiereCents`.

> **Mise à jour du 30/07/2026 — corrigé.** `produit_garniture` est désormais lue en production par
> `packages/db/src/depots/recettes.ts:198-201` (coût de garniture d'un produit) et
> `packages/db/src/depots/tracabilite.ts:229-232`, et écrite par
> `packages/db/src/seed/demonstration.ts:733-745`. Un service dédié
> `packages/db/src/services/garnitures.ts` (`sortirLesGarnitures`) sort les garnitures du stock à la
> clôture. Une nouvelle route `GET /api/couts-produits` (`apps/api/src/routes/recettes.ts:110`)
> intègre explicitement « part de pâte + garnitures » dans le coût de revient. Détail complet,
> avec la réserve sur l'absence de route pour RATTACHER une nouvelle garniture à un produit :
> `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §4.1 et §3.1.

---

**I7 — L'écart théorique/réel ne peut pas être calculé**

_Où._ `packages/db/src/services/production.ts:222` (`coutMatiereReelCents: null`) ;
lecture en `depots/previsions.ts:186, 197`.

_Le fait._ `production.cout_matiere_reel_cents` est écrit à `null` à la création et **n'est mis à
jour par aucun code** (grep : un seul site d'écriture, celui-ci). `coutMatiereParCrepe` applique
donc systématiquement le repli `p.coutReel ?? p.coutTheorique` (`:197`).

_Ce qui se passe en usage réel._ « Écart théorique/réel » figure au tableau des modules ERP du
§0 et parmi les cinq domaines fonctionnels du §1. En pratique, le réel vaut toujours le
théorique : l'écart est constamment nul, l'analyse est vide de sens, et la sur-consommation
(louche trop généreuse, casse) n'est jamais détectée. C'est aussi ce qui devait permettre de
mesurer `perte_fixe_ml`, laissé à 0 par D-019 en attendant précisément cette mesure.

_Correction suggérée._ Renseigner `coutMatiereReelCents` à la clôture de la production, à partir
de la somme réelle des `mouvement_stock.cout_cents` rattachés (`production_id`), et exposer
l'écart à l'écran. La donnée existe déjà : elle est écrite en `services/production.ts:238-243`,
il ne manque que l'agrégation.

> **Mise à jour du 30/07/2026 — corrigé.** `production.cout_matiere_reel_cents` est désormais écrit
> par `saisirRealise` (`packages/db/src/services/production.ts:342`) et relu par
> `depots/sessions.ts` / `depots/previsions.ts:183` (confirmé indépendamment par
> `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §4.13/§6). Un mécanisme voisin permet aussi de corriger
> `production_consommation.quantite_reelle` (`services/production.ts:642`, déclenché depuis
> `apps/web/src/pages/Production.tsx:854,859`), ce qui alimente l'écart théorique/réel par
> ingrédient également évoqué par cette entrée.

---

**I8 — L'horizon d'alerte DLC vaut 14 jours en dur dans trois écrans**

_Où._ `packages/core/src/horodatage.ts:95-99` (`horizonJours = 14` par défaut), appelé sans
argument par `pages/Production.tsx:173`, `pages/Stock.tsx:149` et `pages/TableauDeBord.tsx:176`.
Le paramètre `brief_horizon_alerte_dlc_jours` existe (`core/parametres.ts:372`) et n'est lu qu'à
un seul endroit : `apps/api/src/routes/previsions.ts:316`. `pages/Comptabilite.tsx:245` passe de
son côté un `60` littéral.

_Ce qui se passe en usage réel._ Deux définitions concurrentes de la même alerte cohabitent : le
brief d'avant-marché utilise le paramètre, le tableau de bord utilise 14. Modifier le paramètre
ne change rien à trois écrans sur quatre, et l'utilisateur verra deux comptes différents de
« lots proches DLC » selon la page. C'est une valeur métier codée en dur, contre §7 et contre la
consigne du porteur qui étend la règle à toute valeur métier.

_Correction suggérée._ Faire descendre le paramètre jusqu'aux écrans (il est déjà exposé par
l'API des paramètres) et retirer la valeur par défaut de la signature, pour que l'oubli devienne
une erreur de compilation.

> **Mise à jour du 30/07/2026 — toujours vrai, revérifié à neuf.** Les lignes citées ont bougé
> mais le défaut est identique : la fonction s'appelle désormais `formaterJoursRestants`
> (`packages/core/src/horodatage.ts:95-98`, toujours `horizonJours = 14` par défaut) et elle est
> toujours appelée sans argument par `apps/web/src/pages/TableauDeBord.tsx:308`,
> `apps/web/src/pages/Stock.tsx:255` et `apps/web/src/pages/Production.tsx:191,205`.
> `apps/web/src/pages/Comptabilite.tsx:340` passe toujours un `60` littéral. Le paramètre
> `brief_horizon_alerte_dlc_jours` (`packages/core/src/parametres.ts:852`) n'est toujours lu qu'à
> un seul endroit, `apps/api/src/routes/previsions.ts:1740`. Ne pas présumer ce point clos : c'est
> le seul des trois (I4, I5, I8) qui reste ouvert après revérification.

---

**I9 — La sauvegarde ne protège ni d'une panne disque ni d'une corruption découverte tard**

_Où._ `packages/db/src/sauvegarde.ts:54-70` (`purger`), `.env.example`
(`RETENTION_SAUVEGARDES_JOURS=30`, `DOSSIER_SAUVEGARDES=./sauvegardes`).

_Le fait._ Le mécanisme lui-même est bon : `VACUUM INTO` (`:44`) est le bon choix en mode WAL, et
le commentaire `:26-29` explique correctement pourquoi copier le `.sqlite` seul serait dangereux.
Mais `purger()` supprime sans condition tout fichier de plus de 30 jours, **sans plancher du type
« conserver au moins N sauvegardes »**, et le dossier de sauvegardes est sur le même disque que
la base.

_Ce qui se passe en usage réel._ Deux scénarios concrets. (a) Le disque lâche : `donnees/` et
`sauvegardes/` disparaissent ensemble — « une base perdue, c'est un registre AFSCA perdu », cité
par le fichier lui-même. (b) Une corruption ou une saisie erronée est découverte au trimestre
suivant, à l'occasion d'un contrôle ou d'un point comptable : toutes les sauvegardes antérieures
à 30 jours ont été effacées, il n'y a rien à restaurer. À noter aussi que rien dans le dépôt ne
documente ni ne teste la **restauration** — on sait produire des sauvegardes, on n'a jamais
vérifié qu'on sait s'en resservir. Enfin, la rétention de 30 jours cohabite mal avec l'obligation
de conservation de dix ans invoquée par D-026.

_Correction suggérée._ Trois mesures peu coûteuses : conserver inconditionnellement les N
dernières sauvegardes quelle que soit leur date ; adopter une rétention en escalier
(quotidiennes 30 j, mensuelles 12 mois, annuelles 10 ans — le fichier est petit) ; documenter et
tester une procédure de restauration, et rappeler dans `.env.example` que
`DOSSIER_SAUVEGARDES` devrait pointer vers un autre support.

> **Mise à jour du 30/07/2026 — en grande partie corrigé.** `purger()` (`packages/db/src/sauvegarde.ts:171`)
> prend désormais un `plancher` (`:176-187`, lu par défaut sur `config.retentionSauvegardesMinimum`)
> qui exempte les N sauvegardes les plus récentes de la purge par âge — vérifié par lecture directe
> le 30/07/2026. Une fonction `restaurer()` existe désormais (`:243`). Ce qui reste ouvert, sans
> changement : le second support (hors du disque de la base) demeure un geste opérateur, pas un
> mécanisme automatique, et la rétention en escalier (quotidien/mensuel/annuel) suggérée ci-dessus
> n'a pas été mise en place — seul un plancher plat existe.

---

**I10 — Quatre tables mortes, dont tout le rapprochement de factures**

_Où._ `packages/db/src/schema.ts` : `factureFournisseur:1062`, `factureLigne`, `fraisReception`,
`produitGarniture:326` (traité en I6), plus `journalAudit` (traité en B3). Aucune n'est
référencée hors du schéma.

_Ce qui se passe en usage réel._ Le commentaire de `facture_fournisseur` (`:1053-1061`) énonce
lui-même l'enjeu : « sans ce maillon, le CUMP est figé par le prix saisi à la RÉCEPTION, qui est
souvent celui du bon de livraison — pas celui de la facture ». C'est exactement la situation
actuelle : le coût matière repose sur un prix jamais confronté à la facture, et la question « le
meunier a-t-il augmenté ses prix ? » reste sans réponse. `frais_reception` (transport, palette)
n'entre dans aucun coût. C'est du schéma spéculatif au sens de KISS : il coûte une migration et
donne l'illusion d'une fonctionnalité livrée.

_Correction suggérée._ Décider explicitement : soit câbler le rapprochement à trois, soit retirer
ces tables du schéma et les consigner comme périmètre V2 dans `docs/05-DECISIONS.md`. Le pire
état est l'état actuel, où un lecteur du schéma croit la fonction présente.

> **Mise à jour du 30/07/2026 — corrigé pour les trois tables de factures.** Un module complet est
> apparu : `packages/db/src/services/factures.ts`, `apps/api/src/routes/factures.ts` (dont
> `PATCH /factures/:id/statut`) et `packages/core/src/contrats/factures.ts`. `factureFournisseur`,
> `factureLigne` et `fraisReception` ne sont plus des tables mortes — le rapprochement à trois a été
> câblé plutôt que retiré. `produitGarniture` est traité séparément en I6 (également corrigé) ;
> `journalAudit` en B3 (également corrigé, voir l'encadré en tête de document). Détail :
> `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §3.1.

---

### Mineurs

| #   | Défaut                                                                                                                                                                                                 | Où                                                                                            | Pourquoi ça compte                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Commentaire qui contredit le code juste au-dessus : « Les mouvements annulés sont exclus » alors que `SQL_RESTANT` les inclut délibérément (et que le commentaire de `:26-30` l'explique correctement) | `packages/db/src/depots/stock.ts:48-51`                                                       | C'est le piège exact de D-021, qui a déjà causé un bug de double retour de matière. Un relecteur qui croit le mauvais commentaire le « corrigera »                                                    |
| M2  | `catch` silencieux : l'échec du marquage d'une échéance ne remonte aucun message                                                                                                                       | `apps/web/src/pages/Comptabilite.tsx:569-573`                                                 | §4 interdit le catch silencieux. L'utilisateur clique « fait » sur une obligation légale et ne voit rien se passer                                                                                    |
| M3  | Conversion pourcentage → points de base réimplémentée deux fois dans le front                                                                                                                          | `pages/Comptabilite.tsx:94-101`, `pages/Evenements.tsx:89-97`                                 | `core/argent.ts` a `formaterPointsDeBase` mais pas de parseur : le manque a été comblé deux fois, différemment, hors du paquet testé                                                                  |
| M4  | `fraisTotauxCents` recalculé dans le composant alors que `calculerRentabilite` le produit déjà                                                                                                         | `pages/Sessions.tsx:381-382`                                                                  | DRY ; deux formules à maintenir pour un même chiffre affiché                                                                                                                                          |
| M5  | Fonctions exportées et jamais appelées : `convertir`, `estUnite`, `lotsProchesDlc`, `totaliserJournal`                                                                                                 | `core/unites.ts:34,20`, `core/stock.ts:209`, `core/comptabilite.ts:140`                       | `lotsProchesDlc` double `depots/stock.ts:187` (`lotsAlerteDlc`) et `totaliserJournal` double le `reduce` de `depots/comptabilite.ts:709-712` : deux implémentations, une seule testée                 |
| M6  | `horodatageFichier` nomme les sauvegardes en UTC                                                                                                                                                       | `core/horodatage.ts:107-110`                                                                  | Une sauvegarde faite à 00 h 30 le 2 août porte la date du 1er. Contre la règle 8 (« affichage local »), et gênant quand on cherche « la sauvegarde d'avant le marché de dimanche »                    |
| M7  | `10_000` littéral au lieu de `BASE_POINTS`                                                                                                                                                             | `depots/comptabilite.ts:163, 184`                                                             | La constante existe dans `core/argent.ts:54` et est importée ailleurs                                                                                                                                 |
| M8  | Montants AFSCA connus (102,71 € / 51,36 €) présents en prose dans `sourceLegale`, jamais en donnée ; `montantEstimeCents` toujours `null`                                                              | `core/comptabilite.ts:250-258`, `depots/comptabilite.ts:451`                                  | L'échéancier ne peut pas chiffrer ce qui est dû, alors que le montant est connu et écrit deux lignes plus haut                                                                                        |
| M9  | `changerStatutLot(…, 'detruit', …)` retirerait le lot de la valorisation et du stock total sans écrire de mouvement                                                                                    | `services/mouvements.ts:233-257`, effets en `core/stock.ts:171, 184` et `depots/stock.ts:129` | **Latent** : aucun appelant n'utilise `'detruit'` aujourd'hui. Le jour où un écran l'expose, ce sera une violation franche de la règle 5. La destruction doit s'accompagner d'un mouvement de `perte` |

> **Mise à jour du 30/07/2026 sur ce tableau — M1, M6 et M9 corrigés ; les autres non
> revérifiés.**
>
> - **M1** : le commentaire trompeur est réécrit. `packages/db/src/depots/stock.ts:31` dit
>   maintenant explicitement « **Les mouvements annulés NE sont PAS exclus.** C'est
>   contre-intuitif et c'est pourtant la seule arithmétique juste […] Les exclure en plus
>   reviendrait à rendre la matière DEUX FOIS. » — l'ancien piège a disparu.
> - **M6** : `horodatageFichier` (`packages/core/src/horodatage.ts:106-134`) nomme désormais les
>   sauvegardes « EN HEURE BELGE, PAS EN UTC », avec un commentaire qui cite explicitement
>   l'ancien défaut (« ce qui était écrit à 19h01 heure belge s'appelait `…-1701` »). Même point
>   dans `docs/12-AUDIT-DEMARRAGE.md` (item 9), également corrigé.
> - **M9** : `changerStatutLot` (`packages/db/src/services/mouvements.ts:418-513`) écrit
>   désormais un mouvement `type: 'perte'` (`:461-505`) quand le statut passe à `'detruit'` et
>   qu'il reste de la quantité, exactement le correctif suggéré ; une interface existe
>   maintenant pour déclencher ce changement de statut (`apps/web/src/saisie-stock/DetailLot.tsx:121,264`),
>   ce n'est donc plus du tout du code latent.
> - **M2, M3, M4, M5, M7, M8** : non revérifiés dans cette passe, ne pas présumer clos.

---

## 4. Ce qui est solide

Il faut le dire clairement, parce que c'est inhabituel à ce stade d'un projet.

- **Règle 7, premier volet : zéro `.delete(` et zéro `DELETE FROM` dans tout le dépôt.** C'est
  rare et c'est vérifiable en une commande. La contrepassation de `services/mouvements.ts:196-226`
  est correcte, y compris le garde-fou « une écriture ne se contrepasse qu'une fois » (`:185-190`)
  dont D-021 explique qu'il vient d'un vrai bug attrapé par un test d'intégration.
- **Le noyau de la règle 5 est juste, y compris dans un piège SQL réel.** `SQL_RESTANT`
  (`depots/stock.ts:40-44`) utilise un alias explicite, et le commentaire `:32-38` documente
  précisément la corrélation rompue en silence par Drizzle que D-020 a rencontrée. C'est le genre
  de détail qu'on ne trouve que si on s'est fait avoir une fois, et qui n'aurait été rattrapé par
  aucun type.
- **Les compteurs de seuils légaux sont corrects sur le point qui compte.** `depots/sessions.ts:239`
  assoit les trois seuils sur `caTotalCents` (le CA, pas la marge), avec la ventilation
  transformé/revendu en `meta` (`:256-258`), et sur la même base que `syntheseExercice`
  (`depots/comptabilite.ts:691-702`) — sessions closes de l'année civile. Mieux : `SEUILS`
  (`:161-184`) porte pour deux des trois seuils une mention disant que l'étiquetage est douteux
  et à confirmer. Un ERP qui affiche ses propres réserves est un ERP honnête.
- **La règle 2 est tenue au-delà de la lettre.** `apps/api/src/ia/client.ts` ne lève jamais
  (`:85-177`), vérifie le plafond **avant** l'appel sur le coût maximal (D-031, `:105-117`),
  journalise même les échecs (`:162-171`), et la clé ne quitte jamais le serveur. Les modes
  dégradés sont réels et systématiques : mail en mode test par défaut (`mail.ts:45-50`), météo
  qui retombe sur un facteur neutre (`meteo/open-meteo.ts:109`), réseau absent traité en
  `ErreurApi` typée (`web/lib/api.ts:76-83`).
- **Zéro `any` dans tout le dépôt**, et la séparation `core` / `db` / `api` est respectée côté
  serveur : les dépôts assemblent et délèguent le calcul, comme l'annoncent leurs en-têtes.
- **Hygiène des secrets irréprochable** : pas de `.env` dans l'arborescence, `.gitignore` couvre
  `.env`, `donnees/`, `sauvegardes/`, `sorties/` et les `*.sqlite*`, et `.env.example` documente
  chaque variable en indiquant explicitement qu'aucune valeur métier n'y a sa place.
- **Le versionnage documentaire de D-026** (`document_genere` + SHA-256 + instantané des
  paramètres) est la bonne réponse à une obligation de conservation, et `verifierIntegrite`
  (`documents/rendu.ts:300-311`) est testé.

---

## 5. Angles morts de test

Les 449 tests couvrent bien les fonctions pures et les invariants de stock. Ce qu'ils ne
couvrent pas, par ordre d'importance :

1. **Le cycle de vie complet d'une commande.** Aucun test ne va de la génération d'un brouillon
   jusqu'à la réception de la marchandise. C'est précisément pour cela que B1 n'a jamais été vu :
   `commandes.test.ts` s'arrête à l'envoi. Un test « je commande, je reçois, je redemande une
   génération » aurait échoué immédiatement.
2. **La vente d'un produit `revendu` de bout en bout.** `services/sessions.test.ts:110` vérifie la
   ventilation du CA transformé/revendu, mais rien ne vérifie l'**effet sur le stock** de la vente
   d'un produit revendu. Le test qui manque tient en une ligne : après clôture, le stock du sirop
   a diminué de la quantité vendue.
3. **La récurrence non annuelle des échéances.** `depots/comptabilite.test.ts:207` teste le
   rebond annuel. Aucun test ne marque « fait » une échéance `trimestrielle` ou `quinquennale`
   pour vérifier où elle retombe (I1).
4. **Le passage d'année et de trimestre en général.** La numérotation par année est correcte par
   construction, mais aucun test ne franchit un 31 décembre sur une chaîne complète (session
   close le 31/12, dépense le 01/01, synthèse d'exercice, compteurs de seuils qui doivent
   repartir de zéro).
5. **La restauration d'une sauvegarde.** `sauvegarder()` n'a pas de test symétrique qui rouvre le
   fichier produit, vérifie son intégrité et compare les données. Une sauvegarde qu'on n'a jamais
   restaurée est une hypothèse, pas une garantie.
6. **Le volume.** Tous les tests portent sur quelques dizaines de lignes. `SQL_RESTANT` est une
   sous-requête corrélée exécutée **une fois par lot**, et `tousLesLots` (`depots/stock.ts:85-93`)
   boucle par ingrédient. À 5 000 mouvements sur trois ans, le comportement n'a jamais été
   observé. Un test de charge à quelques milliers de mouvements dirait en une minute s'il faut
   s'en soucier ou non — D-004 annonce d'ailleurs ce point comme « à surveiller ».
7. **L'accumulation d'arrondis monétaires.** Aucun test ne consomme un lot en de nombreuses
   petites sorties pour vérifier que la somme des coûts alloués égale le prix d'achat du lot
   (lié à I2).
8. **Le front n'est pas testé du tout.** Aucun test de composant. Les défauts I3 (date figée) et
   M2 (catch silencieux) vivent exactement dans cette zone : ils sont invisibles au typage, aux
   tests serveur et à une relecture rapide, et ne se manifestent qu'à l'usage prolongé.

---

_Fin de l'audit. Les corrections B1, B2 et B3 sont les trois qui changent la nature du produit ;
les défauts I1 à I10 sont des erreurs de chiffres ou de conformité qui se corrigent isolément._
