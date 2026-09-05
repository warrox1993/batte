# 26 — Audit des dix règles d'architecture « non négociables »

> Audit conduit le 31/07/2026, en dérivation directe du code — jamais recopié d'un autre
> document. **Un document antérieur existe déjà sur le même sujet**, `docs/09-AUDIT-ARCHITECTURE.md`
> (27→30/07/2026) : il n'a pas été utilisé comme source de vérité ici, conformément à la
> doctrine du dépôt (D-045, « une liste écrite à la main n'est pas une preuve d'absence »)
> — y compris quand la liste en question est elle-même un audit. Chaque verdict ci-dessous
> vient d'une commande exécutée aujourd'hui contre le code aujourd'hui. Les deux documents
> sont ensuite comparés au §3 de chaque règle concernée, pour dire ce qui a tenu, ce qui a
> bougé, et ce qui n'avait jamais été vu.
>
> Aucun fichier de code n'a été modifié. Aucune requête réseau vers `127.0.0.1` ou l'API
> Anthropic n'a été faite. Aucun sous-agent n'a été délégué : toute la dérivation ci-dessous
> a été faite à la main, commande par commande.

---

## 1. Tableau des dix règles

| #   | Règle                                                          | Verdict                             | Violations                                      | Commande de vérification                                                                                                                                                                         |
| --- | -------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Logique métier chiffrée dans `packages/core`                   | **Violée**                          | **≥ 14 fichiers**, dont un majeur               | `grep -rn "function calculerFacteurMeteoMesure\|estimerAvecMeteoMesuree" packages/core/src` (0 résultat, alors que ces fonctions existent et calculent dans `apps/api/src/routes/previsions.ts`) |
| 2   | Un LLM ne calcule jamais (Zod + `source` + validation humaine) | **Respectée**                       | **0**                                           | `grep -n "valideParHumain" packages/db/src/depots/previsions.ts` → filtre `eq(evenement.valideParHumain, true)` réellement appliqué à la lecture                                                 |
| 3   | Argent en centimes entiers, aucun flottant                     | **Respectée**                       | **0**                                           | `grep -n "real(" packages/db/src/schema.ts` (aucune colonne monétaire) + vérification croisée des 13 champs `...Cents: z.number()` des contrats                                                  |
| 4   | Masses en g / volumes en ml, conversion par densité déclarée   | **Respectée**                       | **0**                                           | `grep -rn "densiteGParMl\|convertir(" packages apps --include=*.ts` → unique point de conversion, `packages/core/src/unites.ts`                                                                  |
| 5   | Stock modifié uniquement par mouvement                         | **Respectée**                       | **0**                                           | `grep -rn "\.set(\{[^}]*quantite" packages/db/src -i` → une seule occurrence, hors solde de stock                                                                                                |
| 6   | Traçabilité par lot + FEFO réellement appliqué                 | **Respectée**                       | **0**                                           | `grep -rn "repartirFefo(" packages/db/src/services` → appelé à chaque décision de consommation fraîche                                                                                           |
| 7   | Rien ne s'efface ; audit sur tables sensibles                  | **Respectée**, garde-fou incomplet  | **0** aujourd'hui / **38 tables non protégées** | `grep -rn "\.delete($t\b" apps packages --include=*.ts --include=*.tsx` rejoué pour les 49 tables de `schema.ts`                                                                                 |
| 8   | Fuseau `Europe/Brussels` partout                               | **Quasi respectée**                 | **1** (mineure)                                 | `grep -rn "\.getMonth()\|\.getDate()\|\.getFullYear()\|\.getDay()" apps packages --include=*.ts --include=*.tsx`                                                                                 |
| 9   | Zéro donnée personnelle client                                 | **Respectée**                       | **0**                                           | `grep -n "email\|telephone\|adresse" packages/db/src/schema.ts` → toutes les occurrences attribuables à `fournisseur` / `commandeFournisseur` / `lieuMarche`                                     |
| 10  | Chaque écran utilisable au clavier                             | **Respectée** (vérification bornée) | **0 nouveau**                                   | `grep -rn "<div[^>]*onClick" apps/web/src --include=*.tsx` (0 résultat)                                                                                                                          |

Les nombres d'abord : **1 rupture d'architecture majeure** (règle 1, ~20 fonctions du moteur de
prévision hors `packages/core`), **1 garde-fou réel mais incomplet** (règle 7, 11/49 tables
protégées par le test de non-suppression), **1 défaut mineur** (règle 8, un script hors
suite), et **sept règles pleinement tenues** (2, 3, 4, 5, 6, 9, 10).

---

## 2. Détail des règles non pleinement respectées, triées par conséquence

### Règle 1 — logique métier hors `packages/core`

C'est la seule règle vraiment violée, et elle l'est largement. Par conséquence pour le
porteur, du plus grave au plus anodin :

1. **`apps/api/src/routes/previsions.ts` — le moteur de prévision lui-même, pas une fuite
   ponctuelle.** Environ vingt fonctions non triviales y calculent : `calculerFacteurMeteoMesure`,
   `estimerAvecMeteoMesuree`, `mesureFacteurMeteoCategorie`, `calculerSaisonRetenue`,
   `calculerTendanceRetenue`, `calculerPredicteursPrecision`, `previsionCalendaireComplete`,
   `alerteReapproPredictiveIngredient`, `plafondStockCrepes`, `volumeParCrepe`, entre autres —
   validation croisée leave-one-out, estimation de facteurs météo/saison/tendance, répartition
   de production. Aucune de ces fonctions n'existe dans `packages/core/src/prevision/` (grep à
   blanc). Conséquence concrète : la règle n°2 de CLAUDE.md §4 (« toute fonction de
   `packages/core` est testée, cible ≥ 80 % de couverture ») ne s'applique à AUCUNE d'entre
   elles, puisqu'elles n'y sont pas — elles ne sont exercées que via `apps/api/src/routes/
previsions.test.ts`, c'est-à-dire par des tests d'intégration HTTP (`describe('GET /api/
prevision — ...')`), jamais par des tests unitaires directs de fonction pure. Un défaut dans
   `calculerFacteurMeteoMesure` — le cœur du calcul qui décide si un facteur météo mesuré est
   fiable — peut donc se propager au chiffre que Claude commente et que l'utilisateur produit
   chaque dimanche, sans qu'aucune des garanties que le projet s'impose sur `packages/core` ne
   s'y applique. Ce n'est pas documenté comme un choix : le commentaire de la ligne 720 évoque
   des clés de paramètres « hors zone d'écriture de cet agent », ce qui indique une dette issue
   du développement par agents parallèles, pas une décision d'architecture.

2. **`apps/web/src/pages/Evenements.tsx:91-97, 408-411` — `bpDepuisEcartPourcent` /
   `bpDepuisMultiplicateur`.** Ces fonctions, définies localement dans la page React, convertissent
   la saisie utilisateur (« +20 % », « ×1,3 ») en points de base et produisent `impactEstimeBp`,
   la valeur envoyée au serveur et qui alimente ensuite le facteur d'événement du moteur de
   prévision (`packages/db/src/depots/previsions.ts`, colonne `impact_estime_bp`). Un écart
   d'arrondi ici fausse silencieusement une entrée du moteur déterministe. Confirmé encore
   présent aujourd'hui (31/07), dans les mêmes termes que `docs/09-AUDIT-ARCHITECTURE.md`
   l'avait relevé le 27/07 sous une autre référence de ligne.

3. **`apps/web/src/pages/Comptabilite.tsx:147-153` — `parserPourcentBp`.** Convertit le
   pourcentage déductible saisi pour une dépense en points de base
   (`Math.round(valeur * 100)`), valeur qui entre ensuite dans le calcul du montant déductible
   d'une dépense — une écriture comptable. Même famille de risque que le point précédent :
   confirmé toujours présent aujourd'hui.

4. **`apps/web/src/pages/Sessions.tsx:1164-1169` — recalcul de `fraisTotauxCents`.** Le
   composant additionne cinq colonnes de frais (`fraisEmplacementCents + fraisDeplacementCents
   - fraisGazCents + fraisDiversCents + fraisEnergieCents`) au lieu d'afficher un total déjà
produit par le serveur. Le commentaire de la ligne 2320 du même fichier reconnaît lui-même
« Même garde que `calculerRentabilite`côté serveur » : la duplication est consciente. Si la
formule de`calculerRentabilite` change un jour côté serveur (ajout d'une catégorie de
     frais, par exemple), ce total-ci divergera silencieusement de celui affiché ailleurs à
     partir de la même session.

5. **`apps/api/src/routes/comptabilite.ts:77-89`** — trois totalisations `.reduce()` en ligne
   dans la route `GET /depenses` (`montantTotalCents`, `montantDeductibleTotalCents`,
   `montantImmobiliseTotalCents`) — l'exemple connu de la mission, confirmé.

6. **`packages/db/src/services/factures.ts:554` et `:812`** — la soustraction
   `ligne.montantCents - lotVise.prixLigneCents` est réécrite deux fois dans le même fichier,
   alors que `packages/core/src/factures.ts:80` exporte une fonction pure `ecartPrix` dédiée à
   exactement ce calcul. L'exemple connu de la mission (ligne 554) porte un second jumeau non
   signalé (ligne 812, `ecartResiduelCents`).

7. **`packages/db/src/services/production.ts:641-643, 668`** — le coût d'une restitution de
   pâte à un lot se calcule ici (`ligne.coutCents / ligne.quantiteTheorique` puis
   `Math.round(quantite * prixUnitaireCents)`) et un accumulateur `coutReelCents -=
coutCentsLigne` répartit ce qui reste à valoriser — de la valorisation de stock, explicitement
   citée par CLAUDE.md §3 comme devant vivre dans `packages/core`, écrite ici dans le service.

8. **`apps/api/src/routes/economies.ts:100`** et **`apps/api/src/routes/stock.ts:101`** — deux
   totalisations `.reduce()` supplémentaires, même patron que comptabilite.ts (`economieTotaleCents`,
   `valeurTotaleCents`).

9. **`packages/db/src/depots/recettes.ts:291`** et **`packages/db/src/depots/sessions.ts:225`**
   — deux calculs de marge (`prix - coûtMatière`) en soustraction directe dans la couche dépôt,
   sans passer par une fonction de marge dédiée.

10. **`packages/db/src/depots/previsions.ts:645`** et **`packages/db/src/depots/concurrents.ts:580`**
    — un coût de rupture (`Math.max(0, prixMoyenCrepeCents - coutInvenduCents)`) et un écart de
    prix concurrent, calculés en dépôt avant d'être transmis à des fonctions core qui, elles,
    ne reçoivent que le résultat déjà calculé.

11. **`apps/api/src/routes/ia.ts:56`** — `Math.max(0, plafondMensuelCents -
depenseDuMoisCents)`, le reste de budget IA affiché, calculé en ligne plutôt que par une
    fonction testée (mineur : ne pilote aucune décision, seulement l'affichage — la vraie
    décision d'autorisation passe par `verifierPlafond`, en core).

**Ce qui n'est PAS une violation**, vérifié explicitement pour ne pas gonfler ce compte :
`apps/web/src/saisie-stock/SaisieReception.tsx:617` et `apps/web/src/pages/Factures.tsx:1423`
(`totalSaisiCents`) sont des totaux de contrôle documentés comme non-autoritaires (« le
montant qui FAIT FOI reste celui que le serveur renvoie ») ; les `reduce()` de
`Sessions.tsx:2251/2413` pré-remplissent un champ avant écriture, sous garde explicite que le
serveur reste seul juge. Les treize champs de contrat `...Cents: z.number()` (`prixUnitaireCents`,
`cumpCentsParUnite`, `coutIndicatifCentsParUnite`, etc.) sont des taux dérivés d'AFFICHAGE,
documentés comme jamais persistés (D-018, D-044) — vérifié en confirmant qu'aucune colonne SQL
correspondante ne les stocke.

**Aucun garde-fou automatisé n'existe pour cette règle** — contrairement aux règles 7 et 9, qui
ont chacune un test qui scanne réellement le code source (`non-suppression-historique.test.ts`,
le test RGPD des quatre tables), rien ne scanne « pas d'arithmétique métier hors
`packages/core` ». Rien n'empêche donc ce compte de grandir au prochain lot.

### Règle 7 — rien ne s'efface : le garde-fou existe, mais protège 11 tables sur 49

Recherche indépendante, exhaustive, des 49 tables de `schema.ts` : un seul `.delete(` en code
de production, `packages/db/src/depots/referentiel-ecriture.ts:1154`
(`baseTx.delete(recetteLigne)...`). C'est une exception légitime et bien gardée : le code
refuse explicitement de modifier une recette qui a déjà servi à une production
(`nbProductions(baseTx, id) > 0` lève `recette_scellee`), la composition antérieure part au
journal d'audit avant la suppression, et le commentaire en ligne l'assume noir sur blanc
(« LE SEUL DELETE de ce fichier »). **0 violation réelle aujourd'hui.**

Mais le test qui est censé empêcher une régression
(`packages/db/src/non-suppression-historique.test.ts`) ne couvre que onze tables :
`sessionVente`, `sessionMarche`, `production`, `mouvementStock`, `lot`, `nonConformite`,
`releveTemperature`, `nettoyageExecution`, `exerciceTracabilite`, `journalAudit`,
`documentGenere`. Trente-huit tables du schéma n'y figurent pas — dont, précisément, les
tables comptables les plus sensibles au sens de CLAUDE.md §1 et §7 :
`depense`, `factureFournisseur`, `factureLigne`, `commandeFournisseur`, `commandeLigne`,
`immobilisation`, `amortissementAnnuite`, `echeance`, `periode`, `reception`. Un futur
`.delete(depense)` ou `.delete(factureFournisseur)` — la table qui rapproche exactement les
montants qu'un contrôle fiscal viendrait vérifier — ne ferait échouer aucun test existant. La
méthode du test (balayage réel du code source, auto-falsifié par des cas positifs et négatifs
injectés) est exactement la bonne — c'est son **périmètre** qui est incomplet, le même type de
trou que D-045 documente pour les routes.

### Règle 8 — Europe/Brussels : une exception mineure, hors exécution réelle

`packages/db/src/scripts/audit-echelle.ts:801` — `new Date().getMonth() + 1`, dépendant du
fuseau local du processus plutôt que de `jourCivilBelge`. Sévérité faible : ce fichier
s'auto-décrit en tête (« Script de mesure HORS SUITE ») comme un outil de mesure de performance
à 3 ans d'échelle, lancé manuellement, jamais par l'application ni par la suite de tests
automatisée, et ne produit ni registre AFSCA ni document fiscal. Aucune autre entorse trouvée :
`jourCivilBelge` (`packages/core/src/horodatage.ts`) est le point de passage unique ailleurs,
y compris dans les routes qui datent au jour civil belge (`stock.ts`, `comptabilite.ts`,
`ia.ts`). Les occurrences de `toLocaleString('fr-BE', …)` relevées par un premier balayage
(`registre-afsca.ts`, `Equipements.tsx`, `Opportunites.tsx`) formatent des NOMBRES
(températures, kilomètres), pas des dates — fausses pistes écartées après lecture.

---

## 3. Confrontation avec l'audit antérieur (`docs/09-AUDIT-ARCHITECTURE.md`)

Ce document n'a pas servi de source : chaque verdict ci-dessus vient d'une commande rejouée
aujourd'hui. Après coup, les deux se recoupent utilement :

- **Règle 3** (argent) : `docs/09` la donnait _Violée_ le 27/07 (`real('prix_unitaire_cents')`
  sur `lot` et `commande_ligne`), puis _corrigée_ le 30/07, re-vérifiée indépendamment à
  `schema.ts:981`. Mon balayage d'aujourd'hui sur schema.ts entier confirme : plus aucune
  colonne monétaire en `real(...)`. Le correctif a tenu quatre jours plus tard.
- **Règles 5, 6, 7** : `docs/09` les donnait _Partielles_ à cause des défauts B2 (vente d'un
  produit revendu ne sortait rien du stock) et B3 (journal d'audit jamais écrit), puis les
  donnait corrigés le 30/07. Mes propres vérifications d'aujourd'hui (FEFO appelé y compris
  par `nomenclature-vente.ts` pour les produits revendus ; `journaliser()` réellement appelé
  dans `factures.ts`, `mouvements.ts`, `production.ts`) sont cohérentes avec cette correction —
  sans que j'aie cherché B2/B3 nommément, ce qui n'est pas une revérification complète de ces
  deux défauts précis.
- **Règle 1** : `docs/09` citait déjà trois fuites côté React (`Comptabilite.tsx`,
  `Evenements.tsx`, `Sessions.tsx`) — vérifiées PRÉSENTES aujourd'hui, quatre jours plus tard,
  dans les mêmes fichiers. Mais `docs/09` ne mentionnait ni `previsions.ts` (le moteur de
  prévision hors `packages/core`) ni les instances de `packages/db/src/depots`/`services`
  listées ci-dessus : soit ces fuites sont apparues depuis le 27/07 (développement par agents
  parallèles), soit le balayage de `docs/09` — lui-même écrit à la main sur des exemples
  précis, pas par recherche exhaustive de motif — ne les avait pas couvertes. Impossible de
  trancher laquelle sans l'historique git, absent de ce dépôt.
- **Règle 2** : `docs/09` concluait « aucune écriture en base issue d'une réponse Claude ».
  C'était vrai le 27/07 et ne l'est plus littéralement : `evenements-decouverte.ts` (fiche 05)
  écrit désormais des propositions IA dans la table `evenement` elle-même. Ce n'est PAS une
  régression — la fonctionnalité passe par Zod (`schemaPropositionsEvenementsIaBrutes.safeParse`),
  marque `valide_par_humain = false`, et le moteur de prévision filtre explicitement dessus à
  la lecture (`eq(evenement.valideParHumain, true)`) — mais la formulation de `docs/09` doit
  être considérée obsolète sur ce point précis.
- **Règle 9, 10** : verdicts identiques aux deux dates, par des chemins de vérification
  indépendants (grep sur des motifs différents, aboutissant à la même conclusion).

---

## 4. Ce que cet audit ne couvre pas

- **Aucune revérification des défauts B2/B3 de `docs/09` par leur nom.** J'ai vérifié que FEFO
  s'applique aux produits revendus et que `journaliser()` est appelé dans les trois services
  cités, mais je n'ai pas rejoué le scénario complet (clôturer une session avec un revendu,
  lire `/api/audit` sans filtre) qui prouverait ces deux corrections de bout en bout.
- **`apps/web` n'a pas été balayé exhaustivement pour la règle 1.** J'ai vérifié les trois
  fichiers cités par `docs/09` plus les `reduce()` détectés par grep ciblé sur `Cents`/`montant`.
  Un calcul métier qui ne porte NI l'un NI l'autre mot (un ratio, une comparaison de dates, une
  règle de seuil non monétaire) resterait invisible à cette méthode. Les ~130 fichiers `.tsx`
  de `apps/web/src/pages` n'ont pas été lus intégralement.
- **La règle 10 n'a reçu qu'une vérification bornée**, sur consigne explicite de la mission
  (ne pas refaire D-079/D-086). Absence de `<div onClick>`, de glisser-déposer et de
  modale/popover constatée par grep ; aucun écran n'a été parcouru au clavier manuellement.
- **Aucun test n'a été exécuté.** Tous les verdicts viennent de lecture directe du code
  source, jamais d'un `npm run test` — la mission l'interdisait explicitement (cinq agents
  écrivent en parallèle). Un test qui semblerait couvrir une des dix règles n'a donc jamais été
  vu s'exécuter par cet audit ; sa seule valeur ici est ce que sa LECTURE prouve (ex. :
  `non-suppression-historique.test.ts` est falsifié par construction, donc digne de confiance
  sur ce qu'il couvre — mais je n'ai pas visionné un run réel).
- **Le périmètre de la règle 7 (11/49 tables protégées) est un DIAGNOSTIC, pas une preuve
  d'absence de risque sur les 38 tables restantes** — seulement la preuve qu'aujourd'hui,
  aucune d'elles n'est supprimée. Le même balayage devrait être rejoué après tout ajout de
  table pour rester vrai.
- **La règle 2 n'a été vérifiée que sur les deux chemins d'écriture réels trouvés**
  (`demanderCommentaire` pour les commentaires texte, `rechercherEvenementsParClaude` pour la
  découverte d'événements). L'usage « extraction » (Haiku, lecture d'un bon de livraison),
  annoncé par CLAUDE.md §5 comme « fréquent », n'a **aucune implémentation trouvée** dans le
  code : `reception.source` accepte `'ia_validee'` au niveau du type
  (`packages/db/src/services/reception.ts:69`) et le schéma le documente, mais aucun appel ne
  fixe jamais cette valeur. Ce n'est pas une violation (rien n'entre en base sans garde), mais
  c'est un écart entre ce que CLAUDE.md décrit comme un usage courant et ce qui existe
  réellement — à garder en tête avant de supposer cette voie déjà couverte par les garanties
  ci-dessus le jour où elle sera construite.
- **Les commandes de ce rapport n'ont pas été rejouées une seconde fois après rédaction.** Le
  dépôt change pendant que j'écris (cinq agents en parallèle, par consigne de la mission) : un
  chiffre cité ici peut déjà être périmé de quelques minutes au moment de la lecture. La
  méthode (commande reproductible, citée) reste valide même si un compte précis a bougé d'une
  unité entre-temps.
