# 20 — État des lieux, 29/07/2026 (soir)

> Document de synthèse, écrit après une journée de développement intensif (24 migrations, une
> trentaine de modules neufs, plus de 60 décisions consignées) pour répondre à une seule question :
> **où en est cette application, là, maintenant ?** Chaque chiffre ci-dessous a été vérifié contre
> le code réel le 29/07/2026 en fin de journée — pas recopié d'un rapport antérieur. Là où je n'ai
> pas pu vérifier, je le dis.

> **Mise à jour du 30/07/2026 — trois chiffres de tête ont bougé depuis la rédaction, recomptés
> depuis la source :**
>
> - **Migrations : 26 au moment de ce recomptage, pas 24 ni même 25.** `packages/db/drizzle/`
>   contient désormais 26 fichiers `.sql` (`0000` à `0025`, `ls packages/db/drizzle/*.sql | wc -l`),
>   dont un nouveau `0025_high_captain_universe.sql` apparu **après** le passage précédent qui avait
>   déjà corrigé ce chiffre de 24 à 25. Le nombre continue de bouger pendant que ce document est
>   consulté — ne pas le recopier sans le revérifier à la source (`packages/db/drizzle/`). Le
>   nombre de tables, lui, tient : **50**, confirmé par `grep -c "sqliteTable(" packages/db/src/schema.ts`.
> - **Décisions : 63, pas 60 — D-001 à D-063, toujours sans trou ni doublon.**
>   `docs/05-DECISIONS.md` porte aujourd'hui des entrées `## D-061`, `## D-062` et `## D-063`
>   (grep des en-têtes `^## D-` : 63 correspondances, séquentielles). Ce document se contredisait
>   déjà lui-même sur ce point : §4 ci-dessous cite « D-063 » alors que §2.4 annonçait un journal
>   arrêté à D-060 — signe que §4 a été retouché après §2.4 sans que le total soit remis à jour.
> - **Fichiers de test : 134 au moment de ce recomptage (30/07/2026), contre 133 annoncés** —
>   compté par un glob `**/*.test.ts` hors `node_modules`. Chiffre à prendre avec prudence : des
>   agents modifient activement des fichiers de test pendant cette vérification (plusieurs
>   horodatages postérieurs à la dernière sauvegarde de ce document), donc ce compte précis bougera
>   encore. Le compte de tests **verts** (2 243) n'a pas été revérifié ici — le revérifier exigerait
>   de relancer toute la suite pendant une écriture concurrente, ce qui ne prouverait rien de stable.

> **Deuxième mise à jour du 30/07/2026 — mission de rattrapage du journal des décisions.** Les trois
> chiffres ci-dessus avaient déjà bougé une fois avant même que ce document soit relu pour cette
> mission ; ils ont recontinué de bouger pendant qu'elle tournait (six autres agents écrivaient du
> code en parallèle). Recomptés depuis la source, à l'instant où cette phrase est écrite :
>
> - **Migrations : 28**, pas 26 (`ls packages/db/drizzle/*.sql` : `0000` à `0027`, séquentiel, sans
>   trou). Le nombre de tables tient toujours à **50**.
> - **Décisions : 73, pas 63 — D-001 à D-073, toujours sans trou ni doublon** (`grep -c "^## D-"
docs/05-DECISIONS.md`). L'écart de 10 par rapport à l'encadré précédent n'est PAS un recomptage
>   du même total : trois décisions manquaient encore à cette date (D-064, D-065, plus trois avant
>   elles), et **huit de plus** (D-066 à D-073) viennent d'être ajoutées par cette mission même —
>   des décisions d'architecture réellement prises et codées le 30/07/2026 (coût d'électricité au
>   compteur, imputation de tournée figée à la clôture, météo de clôture prise à J-1, pièce jointe
>   stockée en ligne, refus gardé par test de la saisie d'une cession d'immobilisation, paramètre
>   texte vide, calcul automatique de distance/point de départ, cinquième poste de décaissement dans
>   la synthèse annuelle), qui existaient déjà dans le code mais n'avaient encore aucune entrée.
> - **Fichiers de test : 142** `*.test.ts` hors `node_modules` (même méthode de comptage que
>   l'encadré précédent, glob direct), contre 134 il y a quelques heures. Le compte de tests **verts**
>   n'a, à nouveau, pas été rejoué ici pour la même raison que l'encadré précédent : plusieurs agents
>   écrivent du code en ce moment même, et un train de tests lancé pendant une écriture concurrente ne
>   prouverait rien de plus stable que le chiffre qu'il remplacerait. Seul `npx prettier --check .`
>   restreint à `docs/` a été effectivement exécuté par cette mission (propre) — voir §2.4 pour la
>   portée exacte de cette vérification.

---

## 1. En une phrase

L'ERP est fonctionnellement complet sur les vingt défauts mesurés de `docs/17`, le schéma de
données a été considérablement enrichi (50 tables, une vingtaine de migrations et ce chiffre continue
de bouger — voir l'encadré de mise à jour ci-dessus pour le décompte à la source) pour couvrir sept
nouvelles
demandes du porteur (fiches `docs/demandes/13` à `19`, y compris l'énergie solaire et
l'empreinte physique — codées entre la rédaction et la relecture de ce document, voir §3.3), et
le journal de décisions est propre. Ce qui reste ouvert est presque entièrement **du ressort du
porteur** (arbitrages produit, questions comptables) ou **des fonctionnalités jamais commencées**
(vente en ligne, avis clients, multi-stand) — pas des bugs cachés.

---

## 2. Ce qui fonctionne, avec des chiffres vérifiés

### 2.1 Les vingt fiches d'amélioration (`docs/17-VINGT-AMELIORATIONS.md`)

**Vingt sur vingt sont corrigées**, revérifiées une à une contre le code le 29/07/2026 (voir §2.1
de ce document pour le détail fichier par fichier). Résumé par domaine :

- **Prévision** (fiches 1, 2, 3, 4, 5, 6, 7, 8) : contrainte de stock câblée, deux catégories
  météo ajoutées avec apprentissage par mesure (D-059), saison et tendance réellement modélisés
  (plus de « × 1,00 » silencieux), impact d'événement mesuré et appris, plan de production par
  recette avec plancher sans gluten, révisions météo conservées par horizon (D-058), coût par
  crêpe ne retombe plus jamais à 0, `npm run backtest` existe et sort six indicateurs.
- **Sessions et analytique** (fiches 9, 10, 11, 12, 13) : consommation réelle par ingrédient
  désormais saisie, clôture cohérente avec la production rattachée, panier moyen calculable
  (tickets), coût matière et coût complet par crêpe enfin distingués, ventes agrégées par créneau
  horaire.
- **Stock et AFSCA** (fiches 15, 16, 17, 18) : un relevé hors seuil ouvre automatiquement une
  non-conformité, un lot exige un numéro ou une DLC précise, la clôture de session permet de saisir
  les températures, détruire un lot écrit désormais un mouvement de stock.
- **Infrastructure** (fiches 14, 19, 20) : rapprochement de facture fournisseur à trois (commande /
  réception / facture), sauvegarde avec plancher de rétention et fonction de restauration réelle,
  pointage d'échéance qui ne masque plus un échec.

**Deux réserves à connaître**, non des bugs mais des limites assumées et documentées dans le code
lui-même :

- Le second support de sauvegarde (hors du disque de la base) reste un **geste opérateur** : le
  dossier est configurable, rien ne peut forcer une clé USB ou un disque réseau depuis le code.
- L'historique des non-conformités et des relevés antérieurs à ces corrections **n'a pas été
  reconstitué** : les corrections s'appliquent à partir de maintenant, pas rétroactivement.

### 2.2 Le schéma de données (`docs/02-MODELE-DONNEES.md`, remis à jour)

**50 tables** (compte stable) **et un nombre de migrations qui a déjà bougé deux fois pendant cette
seule vérification** — voir l'encadré de mise à jour en tête de document pour le décompte à la
source plutôt qu'un chiffre figé ici.
Dix-huit tables ont été ajoutées depuis la dernière version à jour de
la documentation : `motif`, `serie_numero`, `document_genere`, `facture_fournisseur`,
`facture_ligne`, `frais_reception`, `exercice_tracabilite`, `echeance`, `periode`,
`economie_achat`, `concurrent`, `concurrent_produit`, `concurrent_observation`,
`produit_vente_composant`, `menu_composition`, `equipement`, `equipement_session`, `objectif`.
`docs/02-MODELE-DONNEES.md` les décrit désormais toutes, avec les colonnes exactes du schéma réel
(plusieurs noms de colonnes avaient dérivé — `prix_ligne_cents` au lieu de `prix_unitaire_cents`,
`document_id` au lieu de `pdf_path`, `commission_carte_cents` au lieu de `commission_sumup_cents`,
entre autres).

**Décision structurante confirmée dans le code** : il n'existe **aucune vue SQL** (`v_lot_restant`,
etc., prévues à l'origine) — tout est calculé en TypeScript dans les dépôts de
`packages/db/src/depots/` (**D-020**). Le CUMP, en particulier, ne se stocke nulle part : il se
calcule à la lecture depuis les lots (**D-018**).

### 2.3 Le moteur de prévision (`docs/03-MOTEUR-PREVISION.md`, remis à jour)

Le moteur multiplicatif d'origine (baseline, météo, événement, saison, tendance) est implémenté
**et** cinq prédicteurs de précision supplémentaires (`docs/demandes/07`) sont venus s'y ajouter :
comparable calendaire, jour de semaine, vacances scolaires belges, écart météo prévue/réalisée
(inflation de l'intervalle), session consécutive. Chacun est soumis à la même validation croisée
_leave-one-out_ avant d'entrer en jeu — aucun ne remplace un prior neutre sans preuve mesurée
qu'il fait mieux. `npm run backtest` rejoue l'historique clôturé et sort six indicateurs de
qualité (erreur absolue moyenne, biais, MAPE glissante, taux de rupture, taux d'invendu, couverture
de l'intervalle).

### 2.4 Le journal de décisions (`docs/05-DECISIONS.md`)

**60 décisions, D-001 à D-060, numérotation vérifiée exhaustivement : aucun trou, aucun doublon**
(63, D-001 à D-063 au 30/07/2026 — voir l'encadré de mise à jour en tête de document ; toujours sans
trou ni doublon).
Le journal lui-même signale (dans **D-052**) qu'il a sauté un temps de D-051 à D-053 — c'est réparé,
et l'entrée D-052 explique la réparation plutôt que de la masquer. Un échantillon de décisions
citées ailleurs dans les documents (D-005, D-009, D-018, D-036, D-039, D-044, D-049, D-053 à D-060)
a été confronté au code correspondant : toutes se vérifient.

> **Mise à jour du 30/07/2026 (mission de rattrapage) : 73 décisions, D-001 à D-073, toujours sans
> trou ni doublon.** Le journal avait pris une journée de retard sur le code réel : huit décisions
> d'architecture (coût d'électricité, imputation de tournée, météo de clôture, pièce jointe en
> ligne, refus de la saisie de cession gardé par un test, paramètre texte vide, calcul automatique
> de distance/point de départ, cinquième poste de décaissement de la synthèse annuelle) avaient été
> prises et codées le même jour sans jamais être consignées — chacune vérifiée par lecture directe
> du code au moment de l'écrire (`fichier:ligne` cité dans chaque entrée D-066 à D-073), pas recopiée
> d'un rapport d'agent. Voir ces entrées pour le détail.

---

## 3. Ce qui attend une décision du porteur

Ce ne sont **pas** des trous à combler par un agent : ce sont des choix que `CLAUDE.md` §7 et la
méthode de travail (§9) réservent explicitement à un humain.

### 3.1 Questions comptables ouvertes (**D-052**, `docs/05-DECISIONS.md`)

- Comptabilité de **trésorerie ou d'engagement** — jamais tranché, commande le rattachement des
  dépenses à l'exercice.
- **Double comptage matière** : une dépense « Matière » saisie à la main pour un achat déjà
  réceptionné n'est pas détectable techniquement — décision retenue : avertir à la saisie, ne pas
  bloquer.
- Prorata temporis sur la première annuité d'amortissement, plafond du régime dégressif, traitement
  d'une cession d'immobilisation, mécanique réelle de la cotisation INASTI, exactitude des seuils
  légaux étiquetés.
- Conservation 10 ans (droit comptable belge) contre rétention de sauvegarde à 30 jours.

### 3.2 Décision produit explicitement laissée en attente

**`Ctrl+S` sur l'écran Sessions déclenche la clôture définitive** (**D-050**) — le seul point de
tout `docs/05-DECISIONS.md` renvoyé nommément au porteur : confirmation à ajouter, ou séparation
brouillon/clôture, c'est un choix produit.

### 3.3 Dans les fiches `docs/demandes/13` à `19`

Chaque fiche a reçu une note de statut datée du 29/07/2026 (jamais une réécriture du texte du
porteur — ses `[À TRANCHER]` restent intacts). En résumé :

| Fiche                              | Ce qui est codé                                                                                                                                                                                                                                                                                                       | Ce qui reste ouvert                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 13 — Coût complet, arbitrage lieux | Cœur décidé (**D-060**) : coût kilométrique, marge nette par lieu                                                                                                                                                                                                                                                     | Point de départ, deux marchés le même jour, répartition des charges fixes, voie B mesurée                 |
| 14 — Événements-opportunités       | Familles entreprise et marché de Noël, taux de prise mesuré                                                                                                                                                                                                                                                           | Première prévision `grand_public` sur un lieu jamais visité (§3.1)                                        |
| 15 — Catalogue élargi              | Nomenclature de vente (café, consommables, toppings)                                                                                                                                                                                                                                                                  | Plusieurs classements ponctuels ([À TRANCHER] individuels non revérifiés un par un)                       |
| 16 — Menus, vente en ligne, avis   | **Seuls les menus** (répartition de remise, produit revendu inclus)                                                                                                                                                                                                                                                   | **Vente en ligne et avis clients : rien codé, aucune trace trouvée**                                      |
| 17 — Énergie                       | Gaz, électricité, **solaire/éolien et empreinte physique** (`packages/core/src/energie.ts` : `pointEquilibreAutoproduction`, `coutEnergieEviteeAutoproductionMoyenne`, `quantitesPhysiquesParIngredient`, `energieElectriqueTotaleKwh`, câblés dans `routes/equipements.ts` et affichés dans `pages/Equipements.tsx`) | Points ponctuels non revérifiés un par un (voir la note de statut de la fiche, mise à jour le 30/07/2026) |
| 18 — Succès, niveaux, objectifs    | Objectifs et succès (vue recalculée, jamais stockée)                                                                                                                                                                                                                                                                  | Sur quoi asseoir les niveaux ; périmètre exact d'un objectif                                              |
| 19 — Big Ambitions, multi-stands   | Rien — reste une direction non codée                                                                                                                                                                                                                                                                                  | **Aucune notion de stand multiple dans le code** ; tout le contenu reste `[À TRANCHER]`                   |

> **Correction du 30/07/2026** : la ligne 17 ci-dessus a été revérifiée après la rédaction
> initiale de ce document — le solaire et l'empreinte carbone, donnés comme non codés dans une
> première passe (29/07), l'étaient déjà au moment de cette relecture. Le code continue de bouger
> pendant que ce document est écrit ; c'est la preuve que la méthode (relire juste avant de
> conclure) a sa raison d'être.

---

## 4. Ce qui reste ouvert, connu et documenté (pas caché)

- **Le verrou de période : le contrôle existe, l'action de verrouiller n'existe pas.** Cette ligne
  affirmait auparavant que `periode.statut = 'verrouillee'` « n'est appliqué par aucun code ».
  **C'est faux depuis le 30/07/2026** et il fallait le corriger : `verifierPeriodeNonVerrouillee`
  (`packages/db/src/depots/comptabilite.ts`) est appelée à **huit** points d'écriture — dépense,
  contre-écriture, immobilisation, mouvement de stock, réception, production, et depuis cette nuit
  la clôture de session (`packages/db/src/services/sessions.ts:606`) — chacun couvert par un test.
  Voir D-063.

  > **Mise à jour du 30/07/2026, plus tard dans la nuit — le chiffre « huit » est déjà dépassé.**
  > Un grep direct de `verifierPeriodeNonVerrouillee(` sur tout le dépôt, hors définition et hors
  > tests, trouve **treize sites d'appel**, dans ces fonctions exportées :
  > `enregistrerDepense`, `annulerDepense` (`depots/comptabilite.ts`), `enregistrerImmobilisation`,
  > `enregistrerSortie`, `changerStatutLot` (`services/mouvements.ts`), `lancerProduction`,
  > `saisirRealise`, `annulerProduction` (`services/production.ts`), `enregistrerReception`,
  > **`annulerReception`** (`services/reception.ts:403`, nouveau), `cloturerSession`,
  > **`annulerSession`** (`services/sessions.ts:1256`, nouveau) — plus un treizième site partagé par
  > `annulerMouvement` et `annulerProduction` via un helper interne commun
  > (`contrepasserMouvement`, `services/mouvements.ts:210`). Les deux points nouveaux depuis la
  > rédaction ci-dessus sont **`annulerSession`** et **`annulerReception`**, deux fonctions
  > d'annulation qui n'existaient pas encore au moment du chiffre « huit ». Je ne retranscris pas de
  > total unique en catégories (huit → dix, ou treize sites bruts) sans avoir reconstitué la
  > convention de comptage exacte du chiffre d'origine ; les fonctions listées ci-dessus sont,
  > elles, vérifiées directement.
  > Ce qui reste vraiment ouvert est plus étroit : **aucun code de production n'écrit encore le statut
  > `'verrouillee'` lui-même.** `cloturerPeriode` ne pose que `'cloturee'` ; le troisième état n'est
  > atteint que par un utilitaire de test. Autrement dit le verrou tient dès qu'il est posé, mais
  > l'application n'offre pas encore le geste qui le pose. Décision produit à prendre par le porteur.

- **Cette vérification a été menée pendant que plusieurs agents écrivaient**, ce qui a produit des
  rouges transitoires successifs sur `npm run typecheck` (d'abord la nature `menu`, puis
  `apps/api/src/routes/audit-robustesse.test.ts`) — chaque fois un fichier en cours d'édition, et
  chaque fois disparus au contrôle suivant. **La leçon vaut plus que le constat : relancer une
  commande avant de diagnostiquer un rouge.** État vérifié après stabilisation le 30/07/2026 :
  typecheck 0 erreur, lint 0 erreur, prettier conforme, 2 243 tests verts sur 133 fichiers (134
  fichiers au recomptage du 30/07/2026 — voir l'encadré de mise à jour en tête de document ; le
  compte de tests verts n'a pas été rejoué).
- Le second support de sauvegarde (hors disque local) reste un geste opérateur, pas un mécanisme
  automatique (§2.1).

---

## 5. Où trouver quoi (mis à jour)

| Question                                          | Document                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| Schéma complet des tables                         | `docs/02-MODELE-DONNEES.md`                                          |
| Comment le moteur de prévision calcule vraiment   | `docs/03-MOTEUR-PREVISION.md`                                        |
| Historique des choix d'architecture               | `docs/05-DECISIONS.md`                                               |
| État détaillé des vingt défauts corrigés          | `docs/17-VINGT-AMELIORATIONS.md` §2.1                                |
| Demandes du porteur encore partiellement ouvertes | `docs/demandes/13` à `19` (note de statut en tête de chaque fichier) |
| Questions réservées au comptable                  | `docs/05-DECISIONS.md`, entrée **D-052**                             |

---

## 6. Méthode de cette vérification

Chaque affirmation numérotée ci-dessus a été vérifiée par lecture directe du code (fichier et,
autant que possible, ligne précise) le 29/07/2026 en fin de journée, pendant que six autres agents
modifiaient le code en parallèle. Aucune affirmation de ce document ne repose sur un état antérieur
non revérifié. Là où une vérification exhaustive n'était pas possible dans le temps imparti (les
`[À TRANCHER]` individuels de la fiche 15, par exemple), ce document le dit explicitement plutôt
que d'affirmer un état non observé.
