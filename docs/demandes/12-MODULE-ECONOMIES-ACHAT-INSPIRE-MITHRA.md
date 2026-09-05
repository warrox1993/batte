# 12 — Suivi des économies d'achat (inspiré du classeur Mithra Pharmaceuticals)

## Origine

Analyse du fichier `Réduction_coût_2022.xlsx` fourni par l'utilisateur — un classeur de
suivi des économies d'achat utilisé chez Mithra Pharmaceuticals pour les consommables
pharma. Deux feuilles :

**« COST REDUCTION »** — une ligne par action d'économie réalisée, colonnes : mois, date,
numéro de bon de commande (P/O), code produit (nomenclature ERP interne), désignation,
fournisseur, département, **type d'action de réduction de coût**, description de l'action
menée, prix unitaire avant, prix unitaire après, écart unitaire, quantité commandée,
économie réalisée en euros, cumul progressif.

**« CHART_COST REDUCTION »** — tableau croisé : économie totale sur la période affichée en
tête de page, ventilation mensuelle par type d'action, total par type d'action.

**Trois types d'action identifiés dans le fichier** : négociation de prix, achat d'une
alternative moins chère, remplacement par du stock déjà immobilisé.

Le mécanisme — capturer un avant/après de prix à chaque décision d'achat, en garder la trace
avec sa justification, et l'agréger en tableau de bord — est directement transposable à
l'échelle du projet, malgré la différence d'ordre de grandeur (kilos de farine plutôt que
lots de 500 000 pièces).

## Vérifier l'existant avant de coder

`docs/02-MODELE-DONNEES.md` prévoit déjà `fournisseur`, `conditionnement` (avec prix et
date de prix), `reception`, `commande_fournisseur`. Ce socle existe. Ce qui manque
spécifiquement : la capture explicite d'une **action de réduction de coût** avec son
avant/après et sa justification, et le tableau de bord agrégé qui en découle. Ne pas
dupliquer `conditionnement` — cette fiche s'appuie dessus.

## Modèle de données à ajouter

### `economie_achat`

`id`, `date_action`, `ingredient_id`, `fournisseur_id`, `conditionnement_id` (nullable),
`type_action` (_negociation_prix | achat_alternatif | remplacement_stock_immobilise |
autre_), `description` (texte libre — la justification, comme la colonne « Description » du
fichier Mithra), `prix_unitaire_avant_cents`, `prix_unitaire_apres_cents`,
`quantite_concernee`, `economie_cents` (calculé : écart unitaire × quantité, jamais saisi à
la main), `commande_id` (nullable, référence `commande_fournisseur` si l'économie est liée à
une commande précise), `saisi_par`

> Invariant : `economie_cents` se recalcule toujours depuis
> `(prix_unitaire_avant_cents - prix_unitaire_apres_cents) × quantite_concernee`, jamais
> stocké indépendamment du calcul — même principe que le CUMP du stock, pour la même raison :
> une valeur qui peut diverger de son calcul source est une source de bug (voir fiche 03).

## Ce qui doit changer

### Saisie

- Au moment d'enregistrer une réception (module 2) ou de renégocier un tarif fournisseur, si
  le nouveau prix est inférieur au prix précédent enregistré pour ce couple
  ingrédient/fournisseur, proposer d'enregistrer l'écart comme une économie — pré-rempli,
  pas ressaisi à la main.
- Formulaire libre également pour une économie constatée hors réception (ex. réutilisation
  d'un excédent de stock plutôt qu'un nouvel achat — le troisième type identifié dans le
  fichier Mithra, directement pertinent pour un stock de pâte ou d'ingrédient qui approche
  sa DLC).

### Tableau de bord des économies

Écran dédié, sur le modèle exact de la feuille « CHART_COST REDUCTION » du fichier source :

- Économie totale cumulée en tête, sur la période sélectionnée.
- Ventilation mensuelle par type d'action (graphique en barres empilées, cohérent avec
  Recharts déjà retenu — `CLAUDE.md` §2).
- Total par type d'action, pour identifier le levier le plus efficace (négociation vs
  changement de fournisseur vs déstockage).
- Export Excel au même format que le fichier source (une feuille détail, une feuille
  synthèse croisée), pour rester dans un format que l'utilisateur maîtrise déjà.

## Ce qui doit être relié

- Module Comptabilité (module 7, `docs/01-SPEC-FONCTIONNELLE.md`) : l'économie réalisée
  vient directement réduire le coût matière réel, donc améliorer la marge — le tableau de
  bord analytique doit pouvoir afficher « part de la marge due aux économies d'achat »,
  pas seulement un total isolé.
- `conditionnement.prix_cents` et `date_prix` : toute mise à jour de prix chez un
  fournisseur est l'occasion naturelle de vérifier s'il y a une économie à enregistrer.
- CUMP de l'ingrédient (`ingredient.cump_cents_par_unite`) : une économie de prix futur ne
  change pas rétroactivement le CUMP des lots déjà en stock — cohérent avec le principe
  déjà posé que le stock se valorise au prix réel payé à chaque lot, pas au dernier prix
  négocié.

## Critère de fin

Enregistrer une renégociation de prix sur la farine T55 (exemple : passage de 0,80 à
0,70 €/kg chez un fournisseur, sur un volume donné), voir l'économie calculée automatiquement
apparaître dans le tableau de bord des économies, ventilée par type d'action et par mois,
avec un total cumulé cohérent — et pouvoir exporter cette vue en Excel dans un format proche
de celui du fichier Mithra fourni.

---

## Note de statut — 01/08/2026, vérifiée contre le code

### État : FAIT — le module existe de bout en bout, plus qu'une lecture rapide ne le laisserait supposer

Vérification faite dans le code courant, pas depuis un document.

- **Modèle de données** : table `economie_achat` (`packages/db/src/schema.ts:1984` et suivantes)
  — exactement les colonnes demandées (`ingredientId`, `fournisseurId`, `conditionnementId`
  nullable, `typeAction`, `description`, prix avant/après en centimes entiers, quantité,
  `commandeId` nullable, `saisiPar`). **`economie_cents` n'est PAS une colonne** : le schéma
  porte un commentaire dédié qui l'explique (« calcul exact, sans le moindre risque d'arrondi »)
  — exactement l'invariant que la fiche demande elle-même (« jamais stocké indépendamment du
  calcul »).
- **Logique pure** : `packages/core/src/economies.ts` — `calculerEconomieCents`,
  `estEconomieStrictementPositive`, `agregerEconomies` (ventilation mensuelle + par type, sur le
  modèle exact de la feuille « CHART_COST REDUCTION »), et `partMargeDueAuxEconomiesBp` (le lien
  vers la comptabilité analytique que la fiche demande sous « Ce qui doit être relié »).
- **Dépôt** : `packages/db/src/depots/economies.ts` — `listerEconomies`, `tableauBordEconomies`,
  `detecterEconomiePotentielle` (proposer l'écart AVANT saisie), `enregistrerEconomie` (saisie
  libre, le troisième type Mithra), et surtout `renegocierTarifAvecEconomie` — **le point
  d'accroche exact de la fiche** : il appelle `enregistrerNouveauTarif` (référentiel existant,
  D-042) puis capture l'économie automatiquement si, et seulement si, le nouveau prix est
  réellement inférieur.
- **Routes** : `apps/api/src/routes/economies.ts` — `GET /economies`, `GET /economies/tableau-bord`,
  `GET /economies/detecter`, `POST /economies`, `POST /economies/renegociations-tarif`,
  `GET /exports/economies`.
- **Écran** : `apps/web/src/pages/Economies.tsx` — tableau de bord (total cumulé, graphique en
  barres empilées Recharts par mois et par type, total par type), formulaire « Renégocier un
  tarif » avec détection d'économie en direct (à la sortie du champ prix), formulaire « Économie
  constatée hors réception » (le troisième type Mithra), et export Excel.
- **Export Excel** : `apps/api/src/documents/excel.ts::exportEconomies` — trois feuilles :
  informations, **détail** (une ligne par économie), **synthèse croisée** (`ajouterFeuilleSyntheseEconomies`)
  — exactement le format à deux feuilles du classeur Mithra source que le critère de fin demande.

### Ironie relevée dans la fiche elle-même : `ingredient.cump_cents_par_unite` n'existe pas

La section « Ce qui doit être relié » cite `ingredient.cump_cents_par_unite`. **Cette colonne
n'existe pas, volontairement.** `packages/db/src/schema.ts:209-215` porte le commentaire :
_« PAS de `cump_cents_par_unite` ici [...] Une valeur dérivée stockée contredit la règle n°5 [...]
Le CUMP sera une VUE calculée à partir des lots. »_ Le CUMP se calcule (`calculerCump`,
`packages/core/src/stock.ts`, à partir de `lot.prixLigneCents / lot.quantiteInitiale`), il ne se
stocke jamais — exactement le principe que la fiche énonce elle-même une ligne plus haut pour
`economie_cents` (« une valeur qui peut diverger de son calcul source est une source de bug »),
tout en citant, pour le CUMP, une colonne qui violerait ce même principe si elle existait. Le
code réel n'a pas cette incohérence : `economie_achat` ne référence le CUMP nulle part, ni en
écriture ni en lecture — la fiche cite une colonne fictive dans un paragraphe d'explication, sans
conséquence sur ce qui a été construit.

### Ce que l'application fait EN PLUS de ce que la fiche demandait

- **Palmarès fournisseurs** (`apps/api/src/routes/palmares.ts:132-166`) : `listerEconomies` et
  `agregerEconomiesParFournisseur` alimentent un classement des fournisseurs qui inclut les
  économies négociées avec chacun — un axe que la fiche ne demandait pas (elle ne demandait
  qu'un tableau de bord global par type d'action et par mois).
- **Pont depuis la clôture comptable mensuelle** : `Comptabilite.tsx` calcule
  `cheminEconomiesDuMois` et propose un bouton « Voir l'économie d'achat de ce mois », qui ouvre
  `Economies.tsx` avec l'année déjà sélectionnée (`anneeDepuisParametreUrl`) — un raccourci
  contextuel non demandé par la fiche.
- **Garde-fous ajoutés après coup, documentés dans `depots/economies.ts`** : refus de deviner un
  écart de prix quand plusieurs conditionnements actifs de contenances différentes coexistent
  chez un même fournisseur (comparer un sac de 25 kg à un paquet d'1 kg aurait produit un écart
  absurde) ; exclusion du fournisseur système (« Inventaire d'ouverture ») et des fournisseurs
  désactivés de la liste proposée en saisie libre — deux protections que la fiche n'anticipait
  pas.
- **Message non bloquant à la détection** (`messageDetectionEconomie`, affiché dans
  `Economies.tsx`) : un prix plus élevé n'empêche jamais l'enregistrement (dépannage, qualité
  différente, fournisseur plus proche restent des raisons valables) — la fiche ne précisait pas
  ce comportement, l'application a tranché pour ne jamais bloquer une saisie sur un jugement
  automatique.

### Une divergence précise avec la fiche, à décrire sans la corriger

La fiche demande (§ « Saisie ») que la proposition d'écart apparaisse _« au moment d'enregistrer
une réception (module 2) »_. **Ce n'est pas ce qui a été câblé.** La détection
(`GET /economies/detecter`) n'est appelée que depuis le formulaire **« Renégocier un tarif »** de
l'écran `Economies.tsx` lui-même (à la sortie du champ « Nouveau prix ») — jamais depuis
`apps/web/src/saisie-stock/SaisieReception.tsx`, l'écran où l'on enregistre une réception
fournisseur. Autrement dit : la fiche demandait deux points d'accroche (réception **ou**
renégociation de tarif), le code n'en a câblé qu'un (renégociation de tarif, dans un écran
dédié). Une réception dont le prix baisse par rapport au dernier tarif connu ne déclenche donc
aujourd'hui **aucune** proposition d'économie au moment de sa saisie — il faudrait, après coup,
aller la constater manuellement sur `Economies.tsx` (formulaire libre, ou renégocier le tarif du
conditionnement séparément). Ce n'est pas nécessairement un défaut à corriger — l'écran dédié
regroupe déjà toute la logique d'économies au même endroit — mais c'est un écart réel entre ce
que la fiche demandait et ce que le code fait, à trancher par le porteur (regrouper dans
Économies, comme aujourd'hui, ou dupliquer la détection dans `SaisieReception.tsx`).

### Ce qui manque encore, décrit sans être codé

- **Aucune annulation d'une ligne d'économie** : `depots/economies.ts` documente explicitement
  que `economie_achat` est une table **INSERT-ONLY**, sans mécanisme de correction — une décision
  assumée (« constatation historique, jamais corrigée en place »), mais qui diverge de la règle
  générale `CLAUDE.md` §3 règle 7 (« corrections par écriture d'annulation »). Si une ligne est
  saisie avec une erreur (mauvais prix, mauvaise quantité), rien dans l'écran ni l'API ne permet
  de la corriger ou de l'annuler — à signaler au porteur, pas un manque « oublié » mais une
  décision qui n'est peut-être pas celle attendue par CLAUDE.md §3.7.
- **Le troisième type Mithra (« remplacement_stock_immobilise ») n'est relié à aucune alerte
  DLC** : la fiche suggère ce type pour « un ingrédient qui approche sa DLC » (§ « Saisie »),
  mais rien dans l'écran de réapprovisionnement ou d'alerte DLC ne propose ou ne pré-remplit une
  économie de ce type quand un lot approche de péremption — la saisie reste entièrement libre et
  manuelle, sans suggestion contextuelle.
