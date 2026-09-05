# 38 — État des décisions : le journal dit-il la vérité sur le code ?

**Date de l'audit** : 01/08/2026
**Objet** : confronter les 94 entrées de `docs/05-DECISIONS.md` (D-001 → D-094) au code réel.
**Périmètre d'écriture** : ce fichier, plus les seuls champs `Statut` fautifs de
`docs/05-DECISIONS.md`. **Aucun fichier de code ni de test n'a été modifié.**

---

## 0. Ce qui a été fait, et comment

Trois moyens de preuve, jamais le texte seul :

1. **Lecture du code** au point nommé par la décision (fichier + symbole).
   Le numéro de ligne n'est jamais la preuve — plusieurs entrées avertissent elles-mêmes
   que les lignes dérivent pendant que des agents écrivent. La preuve est le **symbole**.
2. **Suite de tests jouée en entier**, pas filtrée :
   `npx vitest run` → **198 fichiers, 3 635 tests, 0 échec** (durée 97,9 s, 01/08 12:40).
   Isolation vérifiée **avant** de lancer : aucun test n'appelle `creerBase()` sans argument
   (`grep -rn "creerBase()" --include=*.test.ts --include=*.test.tsx` → exit 1), tous passent
   `':memory:'` ou un `mkdtempSync(tmpdir())`. La base réelle `donnees/batte.sqlite` n'a pas
   été touchée.
3. **Dérivation plutôt qu'énumération** (D-045) dès qu'il s'agissait de conclure une absence.

### L'erreur que j'ai commise moi-même, et qui vaut d'être écrite

En cherchant les appelants de `calculerFacteurMeteoMesure` (D-059), un premier
`grep … | head -20` a rendu **zéro appelant de production** — et j'allais conclure
« capacité orpheline ». **C'était faux** : `head -20` était saturé par les vingt lignes du
fichier de test, et l'appelant réel (`apps/api/src/routes/previsions.ts:450`) tombait au
vingt-et-unième rang. C'est exactement le piège de D-045, sous une forme que D-045 ne
nomme pas : ce n'est pas le **motif** qui était trop étroit, c'est la **troncature de la
sortie**. Un `grep | head` n'est jamais une preuve d'absence.

### Ce que cet audit n'a PAS pu prouver — à lire avant de s'y fier

- **Il ne prouve pas qu'un test vert exerce vraiment ce qu'il annonce.** Les 3 635 tests
  passent ; le dépôt a déjà payé six fois le prix de la « fixture aveugle », et D-089 vient
  de démontrer que **quatre tests reproduisaient l'erreur qu'ils surveillaient**. Je n'ai
  falsifié aucun test (interdiction de toucher au code).
- **Il ne prouve rien sur le rendu réel à l'écran.** Aucune capture n'a été prise. Quand je
  dis « l'affichage est livré », je prouve qu'un composant est _monté dans le JSX_, jamais
  qu'il est _lisible_ — distinction que D-081 pose lui-même.
- **Il ne mesure pas le comportement sur la base réelle du porteur** (D-089 le signale déjà
  pour le moteur de prévision).
- **Il n'a pas relu les 94 raisonnements pour en juger la justesse**, seulement leur
  correspondance au code. Une décision peut être fidèlement appliquée **et** mauvaise.

---

## 1. Le décompte

| Verdict                                                                       | Nombre |
| ----------------------------------------------------------------------------- | ------ |
| **Statut juste** (déclaré = constaté)                                         | **82** |
| **Statut faux — déclaré en retard sur le code** (livré, dit à faire)          | **5**  |
| **Statut faux — décision inversée sans que l'entrée le dise**                 | **1**  |
| **Corps périmé** (statut acceptable, mais un paragraphe est faux aujourd'hui) | **6**  |
| **Statut faux dans l'autre sens** (déclaré appliqué, absent du code)          | **0**  |

**Total des écarts : 12 sur 94** (D-074 compte dans deux colonnes : statut faux _et_
décision inversée ; il est compté une fois dans le total).

**Le sens de l'erreur est uniforme et c'est une bonne nouvelle** : aucune entrée ne
promet une capacité qui n'existe pas. **Les douze écarts vont tous dans le même sens —
le journal est en retard sur le code, jamais en avance.** Le risque n'est donc pas qu'on
s'appuie sur du vide ; c'est qu'on **refasse un travail déjà fait**, ou qu'on croie
qu'il reste du chantier là où il n'y en a plus. C'est précisément le cas D-082/D-083 que
le porteur a trouvé ce matin, et il se répète **cinq fois**.

---

## 2. Les cinq statuts faux « en retard sur le code »

### D-087 — « constat établi, câblage à faire » → **le câblage est fait**

**Preuve** (dérivée : toutes les URL `/annuler` émises par `apps/web/src`, confrontées aux
neuf routes du tableau de D-087) :

| Route déclarée sans écran  | Écran qui l'appelle aujourd'hui                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `/productions/:id/annuler` | `apps/web/src/pages/Production.tsx` (`requeteApi(\`/productions/${cible.id}/annuler\`)`)         |
| `/receptions/:id/annuler`  | `apps/web/src/saisie-stock/DetailLot.tsx` **et** `apps/web/src/saisie-stock/SaisieReception.tsx` |

Les neuf routes d'annulation sont donc **toutes** atteintes depuis l'interface. La règle 7
de `CLAUDE.md` §3 est tenue pour la production **et** pour la réception.

**Ce que le porteur perd tant que le statut reste faux** : D-087 affirme, au présent, qu'il
n'a « **aucun moyen légitime** de corriger sa propre base » et nomme deux réceptions
fantômes (RC-2026-0007, RC-2026-0008) comme cas ouvert. **Il a le moyen depuis le
31/07.** C'est le plus coûteux des cinq : l'entrée décrit un blocage réglementaire résolu.

**Sous-point du même corps, également faux** : le tableau « aval complet / amont manquant »
porte la ligne « deux gardes lisant `periode.statut = 'verrouillee'` → **rien ne pose jamais
ce statut** ». Voir D-063 ci-dessous : ce n'est plus vrai.

---

### D-074 — « constat acté, correctif NON appliqué » → **appliqué, et par l'option que D-074 avait écartée**

C'est le seul écart de sa catégorie, et le plus délicat à lire.

**Ce que le code fait aujourd'hui** :

- `apps/api/src/itineraire/client.ts` : `Math.round(metres / METRES_PAR_DIXIEME_KM) / 10`
  — l'arrondi est au **dixième de kilomètre** (100 m), plus au kilomètre entier. C'est
  exactement le correctif que le « Complément du 30/07 » de D-074 désignait comme le seul
  qui compte (« l'arrondi n'est PAS dans la colonne, il est en amont »).
- `packages/core/src/contrats/referentiel.ts` : `distanceKm: z.number().nullable()` — la
  validation accepte les décimales. Gardé par
  `packages/core/src/contrats/referentiel.test.ts` (« `distanceKm: 24.8` accepté »,
  « `-0.5` refusé »).
- `packages/db/src/schema.ts` : `distanceKm: integer('distance_km')` — **le type n'a pas
  bougé**, et un long commentaire y explique pourquoi.

**Le point qui compte** : D-074 avait explicitement **écarté** l'option 1
(« assouplir la validation Zod sans toucher à la colonne »), au motif qu'« une colonne qui
annonce `integer` et contient 12,4 **ment au prochain lecteur** ». C'est pourtant l'option
qui a été retenue — pour une raison neuve et solide, écrite dans `schema.ts` : la migration
en `real` a été **essayée sur une copie de la base réelle le 31/07/2026** et échoue en
`FOREIGN KEY constraint failed`, la table étant référencée (sessions, observations météo).
« Impossible, pas seulement risquée. »

**Le journal ne dit nulle part que la décision a été inversée.** Un lecteur qui ouvre D-074
y lit « correctif NON appliqué » et « à faire quand le porteur est disponible : migrer la
colonne en `real` » — un travail qu'on a démontré impossible, sur un défaut déjà corrigé
là où il pesait.

**Le complément sur `metres_lineaires_occupes` reste vrai** (colonne `integer`, aucun
consommateur) — vérifié, ne pas le corriger.

---

### D-092 — « route et contrat livrés, **affichage en cours** » → **l'affichage est livré**

`apps/web/src/pages/TableauDeBord.tsx` définit `SectionMouvementsConcurrents` et **la rend
dans le JSX de la page** (ligne ≈ 3058), avec ses fonctions pures de résumé
(`resumeMouvementsConcurrents`, `phraseResumeMouvementsConcurrents`,
`compterMouvementsParStatut`) et la lecture de `GET /concurrents/mouvements`. Route côté
serveur : `apps/api/src/routes/concurrents.ts` (`app.get('/concurrents/mouvements', …)`).

---

### D-094 — « moteur corrigé, un reste côté écran (tâche #141) » → **le reste est fermé**

D-094 dit : « `depots/recettes.ts::coutRevientProduit` **ne passe pas encore** les nouveaux
arguments au moteur. Le moteur est juste et **l'écran affiche toujours `0`** ».

`packages/db/src/depots/recettes.ts::coutRevientProduit` passe aujourd'hui les **trois**
champs à `coutProduitVendu` : `estPateVendueAuVolume`, `coutParMlCents`,
`volumeMlParUnite`. Le commentaire au-dessus date lui-même le correctif :
« TROU CORRIGE (mission « un correctif qui n'arrive pas jusqu'a l'ecran ne corrige rien »,
01/08/2026) ».

**La limite connue en fin d'entrée reste vraie** (seul le mode de clôture « volume restant »
tient l'invariant) — ne pas la corriger.

---

### D-081 — « appliquée, **garde à écrire** » → contradiction avec son propre corps

Le corps de D-081 dit, en gras : « **La garde est écrite** :
`apps/api/src/tableau-largeurs-colonnes.test.ts` ». Elle existe, elle tourne, et sa sortie
observée pendant l'audit est :

```
[D-081] 49 fichiers .ts/.tsx examinés sous apps/web/src (hors *.test.*) — 71 définitions de colonnes détectées.
```

Seul le champ `Statut` de l'en-tête est en retard. Écart bénin, corrigé pour ne pas laisser
une entrée se contredire elle-même.

---

## 3. Les six corps périmés (statut acceptable, paragraphe faux)

| Entrée    | Ce que le corps affirme                                                                         | Constaté aujourd'hui                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-063** | conséquence 3 : « la troisième action (« verrouiller définitivement ») **reste à construire** » | **Construite de bout en bout** : `verrouillerPeriode` (`depots/comptabilite.ts`), route `POST /periodes/:id/verrouiller` (`routes/comptabilite.ts`), écran (`Comptabilite.tsx`)                                                           |
| **D-059** | correction du 30/07 : « la moitié « **météo** » reste ouverte »                                 | **Refermée** : `calculerFacteurMeteoMesure` est appelée en production (`routes/previsions.ts`), `meteoMesure.enUsage` garde l'entrée dans le calcul, `meteoMesure.origine` s'affiche                                                      |
| **D-064** | « Ce que cela reste à construire » — points 1, 3, 4 « aucun n'est codé »                        | **Les trois sont codés** : `session_marche.point_depart_texte` (pt 1), `distance_reelle_km` en `real` + pré-remplissage `× 2` dans `Sessions.tsx` (pt 3), `imputationTourneeDeplacement` appelée dans `cloturerSession` (pt 4, via D-067) |
| **D-060** | « la **voie B** du coût kilométrique … **rien ne la calcule encore** »                          | **Calculée** : `mesureCoutVehicule` (`depots/lieux-rentabilite.ts`). D-064 le dit déjà (« les deux sont construits ») — la contradiction n'a jamais été reportée ici                                                                      |
| **D-089** | « Un reste, structurel et assumé : **deux tests d'intégration restent rouges** »                | **Suite entièrement verte** — 3 635/3 635, aucun `it.skip` / `describe.skip` / `.todo` dans le dépôt (grep dérivé, exit 1). Les fixtures ont été étalées comme l'entrée le recommandait                                                   |
| **D-047** | dette : « **105 fichiers** non conformes à Prettier »                                           | **24 fichiers** (`npx prettier --check`, hors `coverage/`). La dette a été réduite de 77 %, jamais consigné                                                                                                                               |

Deux corps sont périmés **de façon favorable** et méritent d'être signalés sans être
« corrigés » :

- **D-052** listait comme asymétrie « `taux_cotisation_inasti_bp` **ne porte pas** la
  mention _estimation indicative_ ». Elle la porte aujourd'hui
  (`packages/core/src/parametres.ts` : « Estimation indicative : l'application ne remplace
  pas un comptable. »). Ce point de D-052 est réglé ; les autres ne le sont pas (voir §5).
- **D-065** laissait ouverte « la colonne ou le drapeau qui porte la distinction
  calculée / corrigée à la main ». Elle n'existe toujours pas — mais **D-072 a délibérément
  rendu ce besoin caduc** pour protéger une correction manuelle (« le SEUL état observable
  — le champ est vide ou ne l'est pas — fait tout le travail »). Ce n'est donc pas un trou,
  c'est une décision plus récente qui supersède. D-072 le dit ; D-065 ne le sait pas.

---

## 4. Les 82 statuts justes — preuve par entrée

Format : preuve = symbole ou fichier vérifié à la lecture. Aucun numéro de ligne n'est
donné comme preuve (les entrées elles-mêmes préviennent qu'ils dérivent).

| N°    | Titre court                                             | Déclaré                               | Constaté                     | Preuve                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------- | ------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-001 | Application locale, SQLite                              | (implicite) appliquée                 | ✅                           | `packages/db/src/client.ts::creerBase`, `config.cheminBase = ./donnees/batte.sqlite`                                                                                                                                      |
| D-002 | Moteur déterministe, pas un LLM                         | appliquée                             | ✅                           | `packages/core/src/prevision/moteur.ts::prevoir` ; aucun appel LLM dans le chemin de calcul                                                                                                                               |
| D-003 | Argent en centimes, mesures entières                    | appliquée                             | ✅                           | `packages/db/src/argent-entier.test.ts` (balaie `PRAGMA table_info`, échoue si un `_cents` n'est pas `INTEGER`)                                                                                                           |
| D-004 | Stock = somme des mouvements                            | appliquée                             | ✅                           | Aucune colonne `quantite_restante` au schéma ; `depots/stock.ts` calcule                                                                                                                                                  |
| D-005 | Versionnage des recettes                                | appliquée                             | ✅                           | `uniqueIndex('idx_recette_code_version').on(code, version)`                                                                                                                                                               |
| D-006 | Modèle du vendeur de journaux                           | appliquée                             | ✅                           | `prevision/statistiques.ts::quantileNormal` + `ratioCritique`                                                                                                                                                             |
| D-007 | Zéro donnée personnelle client                          | appliquée                             | ✅                           | Aucune table ni colonne nominative au schéma (dérivé du schéma, pas d'une liste)                                                                                                                                          |
| D-008 | SMTP, pas API Gmail                                     | appliquée                             | ✅                           | `apps/api/src/mail.ts` importe `nodemailer` ; `apps/api/package.json`                                                                                                                                                     |
| D-009 | Envoi de commande validé par un humain                  | appliquée                             | ✅                           | `POST /commandes/:id/envoyer` — geste explicite, jamais déclenché par un seuil                                                                                                                                            |
| D-010 | Les specs vivent dans `docs/`                           | appliquée                             | ✅                           | `docs/` contient 38 documents ; `CLAUDE.md` reste à la racine                                                                                                                                                             |
| D-011 | Aucune compilation backend                              | appliquée                             | ✅                           | `package.json` : `typecheck` = `tsc --noEmit` ; scripts `db:*` en `tsx`                                                                                                                                                   |
| D-012 | Web servie en local, pas d'Electron/Tauri               | appliquée                             | ✅                           | `apps/api/src/serveur.ts` sert le statique en production (voir D-051)                                                                                                                                                     |
| D-013 | Catalogue TS, table = miroir                            | appliquée                             | ✅                           | `packages/core/src/parametres.ts::CATALOGUE_PARAMETRES`, `type CleParametre` dérivé                                                                                                                                       |
| D-014 | Rendement R1 = `CLAUDE.md` §6                           | appliquée                             | ✅                           | `recette.rendement_reference_ml` / `rendement_reference_crepes` en base, pas en dur                                                                                                                                       |
| D-015 | `seuil_alerte_bp` (pas `_pct`)                          | appliquée                             | ✅                           | Clé `seuil_alerte_bp` au catalogue                                                                                                                                                                                        |
| D-016 | Pile de polices système                                 | appliquée                             | ✅                           | `apps/web/src/index.css` : `--font-sans: 'Segoe UI Variable Text', …`                                                                                                                                                     |
| D-017 | Deux modes clavier                                      | appliquée                             | ✅                           | `apps/web/src/composants/navigationGrille.ts` (grille ARIA) + mode tableur de `Sessions.tsx`                                                                                                                              |
| D-018 | Pas de colonne CUMP sur `ingredient`                    | appliquée                             | ✅                           | `schema.ts` : « PAS de `cump_cents_par_unite` ici, contrairement a docs/02 »                                                                                                                                              |
| D-019 | `perte_fixe_ml` sur `recette`                           | appliquée                             | ✅                           | `perteFixeMl: integer('perte_fixe_ml').notNull().default(0)`                                                                                                                                                              |
| D-020 | Stock en requête, pas en vue SQL                        | appliquée                             | ✅                           | Aucun `CREATE VIEW` dans `packages/db/drizzle/` ; `depots/stock.ts` documente l'écart                                                                                                                                     |
| D-021 | `is_annule` = affichage seul                            | appliquée                             | ✅                           | Sommes de mouvements sans filtre `isAnnule` ; `non-suppression-historique.test.ts`                                                                                                                                        |
| D-022 | `statutStock` ≠ `statutParPlafond`                      | appliquée                             | ✅                           | Les deux exportées par `packages/core/src/affichage.ts`                                                                                                                                                                   |
| D-023 | `ca_especes` dérivé                                     | appliquée                             | ✅                           | `packages/core/src/sessions.ts::rapprocherCaisse`                                                                                                                                                                         |
| D-024 | Session sans vente : on annule                          | appliquée                             | ✅                           | `services/sessions.ts` : erreur `session_sans_vente` + « annulez la session au lieu de la clôturer » ; `exclureDuModele`                                                                                                  |
| D-025 | Seed idempotent PAR ENTITÉ                              | appliquée                             | ✅                           | `packages/db/src/seed/index.ts` — chaque bloc vérifie sa présence                                                                                                                                                         |
| D-026 | Documents archivés, jamais régénérés                    | appliquée                             | ✅                           | Table `documentGenere` avec `parametresSource` (instantané JSON) + empreinte                                                                                                                                              |
| D-027 | Documents dans `apps/api`                               | appliquée                             | ✅                           | `apps/api/src/documents/` ; aucun paquet `@batte/documents`                                                                                                                                                               |
| D-028 | Baseline recalcule le facteur météo                     | appliquée                             | ✅                           | `prevision/baseline.ts::calculerBaseline` rend une `explication`                                                                                                                                                          |
| D-029 | Le serveur recalcule avant de faire commenter           | appliquée                             | ✅                           | `routes/previsions.ts` : `POST /prevision/commenter` appelle `vuePrevision(base, calcul)`, corps de requête vide                                                                                                          |
| D-030 | Coût IA arrondi au centime supérieur                    | appliquée                             | ✅                           | `packages/core/src/ia.ts` : `Math.max(1, Math.ceil(brut))`                                                                                                                                                                |
| D-031 | Plafond IA vérifié AVANT l'appel                        | appliquée                             | ✅                           | `apps/api/src/ia/client.ts` : « Controle du plafond AVANT l'appel »                                                                                                                                                       |
| D-032 | Le seed peuple nettoyage + échéances                    | appliquée                             | ✅                           | `seed/index.ts` appelle `seedAfsca(base)` et `seedEcheances(base)`                                                                                                                                                        |
| D-033 | `fermerBase` replie le WAL                              | appliquée                             | ✅                           | `client.ts::fermerBase` → `pragma('wal_checkpoint(TRUNCATE)')` ; `client.test.ts`                                                                                                                                         |
| D-034 | `ratioCritique` rend `null`                             | appliquée                             | ✅                           | `prevision/statistiques.ts::ratioCritique(): number \| null`                                                                                                                                                              |
| D-035 | Cinq causes de 500 supprimées                           | appliquée                             | ✅                           | `apps/api/src/routes/erreurs-500.test.ts` ; `plugins/erreurs.ts` honore `statusCode`                                                                                                                                      |
| D-036 | La réception solde la commande                          | appliquée                             | ✅                           | `services/reception.ts` : `entree.commandeId` vérifié avant allocation de numéro                                                                                                                                          |
| D-037 | La vente sort le stock ; écart non bloquant             | appliquée (+ correction du 30/07)     | ✅                           | `sortirLesProduitsRevendus` ; `Sessions.tsx::formaterAvertissementEcartsStock` rendu dans le JSX                                                                                                                          |
| D-038 | Coût matière réel > théorique                           | appliquée                             | ✅                           | `services/production.ts` écrit `coutMatiereReelCents` ; `parcours-erp.test.ts`                                                                                                                                            |
| D-039 | Panier moyen ≠ prix moyen par article                   | appliquée                             | ✅                           | `core/sessions.ts` : `nbArticlesVendus`, `panierMoyenCents` nullable                                                                                                                                                      |
| D-040 | Rythme de sessions = paramètre                          | appliquée                             | ✅                           | Clé `seuils_sessions_prevues_par_an` lue par `depots/sessions.ts` et `depots/objectifs.ts`                                                                                                                                |
| D-041 | Règle de partage « zéro valeur en dur »                 | appliquée                             | ✅                           | 4 clés au catalogue : `echeance_horizon_alerte_jours`, `prevision_couverture_ensoleille_max_bp`, `prevision_sessions_avant_sigma_mesure`, `prevision_sessions_sigma_fiable`                                               |
| D-042 | Corriger ≠ faire évoluer                                | appliquée                             | ✅                           | `routes/parametres.ts` : `PATCH /parametres/:id` **et** `POST /parametres/:cle/versions`                                                                                                                                  |
| D-043 | Troncature = question métier                            | appliquée                             | ✅                           | `composants/Tableau.tsx` : prop `troncature?: 'ellipse' \| 'repli'`                                                                                                                                                       |
| D-044 | On stocke le montant, on dérive le taux                 | appliquée                             | ✅                           | `schema.ts` : `prixLigneCents: integer(…)` sur `lot` **et** `commande_ligne` ; `argent-entier.test.ts`                                                                                                                    |
| D-045 | Une liste manuscrite ne prouve pas une absence          | appliquée                             | ✅                           | `routes/integration.test.ts` dérive de `printRoutes` ; `smoke-routes-lecture.test.ts`                                                                                                                                     |
| D-046 | Écran de saisie de stock                                | appliquée                             | ✅                           | `apps/web/src/saisie-stock/` (champs, `SaisieReception`, `SaisieSortie`, `DetailLot`)                                                                                                                                     |
| D-047 | Porte de sortie élargie                                 | appliquée (dette Prettier périmée)    | ✅                           | `vitest.config.ts` : `include` couvre `apps/*/src/**` ; `thresholds: 80` ; `@vitest/coverage-v8` + `eslint-plugin-react-hooks` en `devDependencies`                                                                       |
| D-048 | Un texte qu'on n'écrit pas ne passe pas                 | appliquée                             | ✅                           | `apps/api/src/securite-secrets.test.ts`, `mail.securite.test.ts`, `audit-ia.test.ts`                                                                                                                                      |
| D-049 | Démo honnête → 4 défauts produit                        | appliquée                             | ✅                           | Enum fournisseur `systeme` ; branche `sortie_vente` dans le réappro et la traçabilité                                                                                                                                     |
| D-050 | Une colonne se coupe si et seulement si…                | appliquée (1 point ouvert, voir §5)   | ✅                           | `troncature: 'repli'` posé ; `<form onSubmit>` généralisé sauf action irréversible                                                                                                                                        |
| D-051 | Un seul point d'inscription du 404                      | appliquée                             | ✅                           | `plugins/erreurs.ts::enregistrerGestionnaireErreurs` — un seul `setNotFoundHandler` ; `serveur-modes.test.ts`                                                                                                             |
| D-052 | Questions ouvertes au comptable                         | ouverte                               | ✅ (voir §5)                 | `planAmortissement` sans prorata ; dégressif sans plafond ; `dateCession` absente des schémas d'entrée                                                                                                                    |
| D-053 | Garnitures : sortie FEFO + bloc propre                  | appliquée                             | ✅                           | `services/garnitures.ts::sortirLesGarnitures`, appelée par `cloturerSession`                                                                                                                                              |
| D-054 | Chaque seuil face à SON assiette                        | appliquée                             | ✅                           | `depots/sessions.ts` : `assiette: 'total'` ×2, `'revenu_net'`, `'ca_sur_place'` — **lue**, plus seulement déclarée                                                                                                        |
| D-055 | L'électricité est un attribut du LIEU                   | appliquée                             | ✅                           | `lieu_marche.facturation_electricite`, `.puissance_disponible_w`                                                                                                                                                          |
| D-056 | Pas d'authentification ni de RLS                        | appliquée                             | ✅                           | Aucune table `utilisateur` active, aucun middleware d'auth, aucune dépendance Supabase                                                                                                                                    |
| D-057 | Deux modes de clôture                                   | appliquée                             | ✅                           | `session_marche.mode_cloture` (`'crepes' \| 'volume'`), `volume_restant_mesure_ml`                                                                                                                                        |
| D-058 | J-7 et J-3 sont deux faits                              | appliquée                             | ✅                           | `meteo_observation.horizon_jours` + index unique incluant l'horizon                                                                                                                                                       |
| D-059 | Les facteurs s'apprennent                               | appliquée (corps périmé, §3)          | ✅                           | `mesurerImpactEvenement` (événements) **et** `calculerFacteurMeteoMesure` (météo) appelées en production                                                                                                                  |
| D-060 | Cœur de la fiche 13                                     | appliquée (corps périmé, §3)          | ✅                           | `core/deplacement.ts`, clé `cout_kilometrique_cents_par_km`, `routesLieuxRentabilite` enregistrée dans `serveur.ts`                                                                                                       |
| D-061 | Un menu n'atteint jamais `totaliserVentes`              | appliquée                             | ✅                           | `services/sessions.ts::exploserLigneMenu` ; `NatureProduit` reste à 2 valeurs                                                                                                                                             |
| D-062 | Un menu sort ses composants en FEFO                     | appliquée                             | ✅                           | `exploserLigneMenu` rend `composantsConsommes`, distinct de `lignesVente`                                                                                                                                                 |
| D-063 | Verrou de période à la clôture de session               | appliquée (corps périmé, §3)          | ✅                           | `verifierPeriodeNonVerrouillee` appelée en **14** points d'écriture datée (8 déclarés — la règle s'est étendue, elle n'a pas reculé)                                                                                      |
| D-064 | Le déplacement est une TOURNÉE                          | appliquée (corps périmé, §3)          | ✅                           | `distance_reelle_km` en `real` ; imputation figée à la clôture                                                                                                                                                            |
| D-065 | Distance calculée une fois, jamais réécrite             | appliquée (1 point externe, §5)       | ✅                           | `apps/api/src/itineraire/client.ts` ; `OPENROUTESERVICE_API_KEY` dans `.env.example`                                                                                                                                      |
| D-066 | Électricité « au compteur » seulement                   | appliquée                             | ✅                           | `core/energie.ts::coutEnergieSessionCents` + `core/sessions.ts::resoudreCoutEnergieSession`                                                                                                                               |
| D-067 | Imputation de tournée FIGÉE à la clôture                | appliquée                             | ✅                           | 3 colonnes `cout_deplacement_reel_*` ; `imputationTourneeDeplacement` appelée dans `cloturerSession` ; commentaire « FIGEE A LA CLOTURE »                                                                                 |
| D-068 | Météo prévue figée = celle de J-1                       | appliquée                             | ✅                           | `services/sessions.ts` : commentaire « Météo FIGÉE » + écriture de `meteoPrevue`                                                                                                                                          |
| D-069 | Pièce jointe DANS la ligne (Data URI)                   | appliquée                             | ✅                           | `services/factures.ts` : `validerPieceJointe`, `SIGNATURES_MIME`, `contenuCorrespondAuTypeDeclare`                                                                                                                        |
| D-070 | `dateCession` gardée par un test                        | appliquée                             | ✅                           | `audit-colonnes-orphelines.test.ts` : « immobilisation.dateCession reste VOLONTAIREMENT non saisissable » — **vert**. `dateCession` n'apparaît qu'en schéma de **sortie** (`schemaImmobilisationDetail`), jamais d'entrée |
| D-071 | Un paramètre `texte` peut être vide                     | appliquée                             | ✅                           | `contrats/parametres.ts` : plus de `.min(1)` ; garde déplacée dans `depots/parametres.ts::verifierValeur`                                                                                                                 |
| D-072 | Calcul auto, recalcul seulement si vide                 | appliquée                             | ✅                           | `routes/referentiel-ecriture.ts::distanceAvecCalculAutomatique` + ses tests                                                                                                                                               |
| D-073 | 5ᵉ poste : frais de réception                           | appliquée                             | ✅                           | `depots/comptabilite.ts::totalFraisReceptionCents`, intégrée à `syntheseExercice`                                                                                                                                         |
| D-075 | Fournée rattachée à la prévision affichée               | appliquée                             | ✅                           | `services/production.ts` écrit `ordrePrevisionId: entree.previsionId ?? null`                                                                                                                                             |
| D-076 | Le statut d'AVANT est écrit au moment du changement     | appliquée                             | ✅                           | `services/reception.ts` : entrées `journal_audit` avec `valeurAvant`, relues à l'annulation                                                                                                                               |
| D-077 | Marge 100 % signalée sur seuil STRICT                   | appliquée (+ correction du 30/07)     | ✅                           | `core/sessions.ts::coutMatiereTransformeSuspect`, consommée par `Sessions.tsx`                                                                                                                                            |
| D-078 | Inventaire des `it.fails` à zéro                        | acté                                  | ✅                           | `grep -rn "it\.fails(" --include=*.ts --include=*.tsx packages apps` → **exit 1, zéro résultat** (rejoué le 01/08)                                                                                                        |
| D-079 | Un rechargement ne repasse pas par « chargement »       | appliquée sur 3 écrans, sweep à faire | ✅ (statut honnête, voir §5) | `Comptabilite.tsx::rechargerEcheancesEnArrierePlan` ; `Factures.tsx` ; `SaisieReception.tsx`                                                                                                                              |
| D-080 | Un contrôle près du titre commande tout l'écran         | appliquée                             | ✅                           | Le sélecteur d'horizon vit dans le panneau « Achats à anticiper » (`TableauDeBord.tsx`), l'en-tête est un `<h1>` nu                                                                                                       |
| D-082 | Un lieu jamais visité ne reçoit aucune prévision        | implémentée                           | ✅                           | `prevision/baseline.ts::estPremierPassage`, consommée par `routes/opportunites.ts` **et** `routes/previsions.ts` ; `Opportunites.tsx` affiche « premier passage »                                                         |
| D-083 | Un relevé de température s'annule par écriture nouvelle | implémentée                           | ✅                           | `releve_temperature.statut` (`'active' \| 'annulee'`, migration 0028), `annulerReleveTemperature`, `RegistreAfsca.tsx`                                                                                                    |
| D-084 | La discipline de largeur vaut pour le PAPIER            | appliquée                             | ✅                           | `documents/colgroup-largeurs-impression.test.ts`, `table-impression-largeur.test.ts` — verts                                                                                                                              |
| D-085 | Un champ qui NOMME ce qu'une unité consomme             | appliquée                             | ✅                           | `produit_vente.consommation_unite` (`'crepes' \| 'volume_pate' \| 'nomenclature'`) ; validations croisées dans `contrats/referentiel.ts`                                                                                  |
| D-086 | Le champ date natif coûte une tabulation                | mesurée, aucune intervention          | ✅                           | Aucune interception de `keydown` sur les champs date — conforme à la décision de ne rien faire                                                                                                                            |
| D-088 | Le « champ mort côté écriture »                         | appliquée                             | ✅                           | Les 3 champs (`dateFinValidite`, `dateReceptionPrevue`, `genereAutomatiquement`) restent non câblés, comme décidé                                                                                                         |
| D-089 | La validation croisée voyait l'avenir                   | appliquée (corps périmé, §3)          | ✅                           | `ageEnJours` / `poidsTemporel` exportés de `baseline.ts` et importés par `jour-semaine.ts`, `saison.ts`, `vacances-scolaires.ts`, `session-consecutive.ts` ; `comparable-calendaire.ts` laissé intact avec sa raison      |
| D-090 | Aucun ordonnanceur                                      | appliquée depuis l'origine            | ✅                           | Dérivé : aucune occurrence de `node-cron`, `croner`, `node-schedule`, `agenda`, ni de `setInterval` dans `packages/` et `apps/`                                                                                           |
| D-091 | Cible 1080p responsive, pas 1280 × 720                  | appliquée                             | ✅ (avec une réserve, §5)    | `docs/07` §4.4 porte l'encadré « CORRIGÉ PAR LE PORTEUR LE 01/08/2026 » et l'intervalle 1280 / 1080 / 1440                                                                                                                |
| D-093 | Un refus de clôture bloque la journée                   | **ouverte**                           | ✅                           | Le message a été enrichi (`core/menus.ts` : nomme le menu, les composants, les deux sorties, en euros) ; le comportement atomique n'a pas changé                                                                          |

---

## 5. Ce qui reste réellement ouvert — et la distinction qui compte

Le porteur a demandé qu'on ne mélange pas **une décision qu'il doit prendre** et **du
travail qui reste à faire**. Ce ne sont pas les mêmes files d'attente.

### A. Décisions qui attendent le porteur (ou le comptable) — **ne pas coder**

| Réf.         | La question                                                                                                          | Qui répond                 | Ce qui se dégrade en attendant                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-093**    | Un menu incohérent doit-il bloquer **toute** la clôture, ou seulement sa ligne ?                                     | **Le porteur**             | Une soirée entière bloquée par une ligne, ou une pièce comptable amputée. Les deux coûts sont chiffrés dans l'entrée — elle est prête à être arbitrée                                                      |
| **D-050**    | `Ctrl+S` sur l'écran Sessions déclenche la **clôture définitive**. Confirmation, ou séparation brouillon / clôture ? | **Le porteur**             | **Vérifié : rien n'a bougé.** `Sessions.tsx` appelle `cloturerSessionRef.current()` directement sur `Ctrl+S`, sans confirmation. Le réflexe « j'enregistre mon brouillon » clôture une pièce comptable     |
| **D-052 §1** | Comptabilité de **trésorerie** ou d'**engagement** ?                                                                 | **Le comptable**           | Charges surévaluées les années où le stock s'accumule ⇒ cotisations et impôt estimés trop bas                                                                                                              |
| **D-052 §2** | Double comptage d'un achat de matière (aucune clé entre `depense` et `reception`)                                    | **Le comptable**           | Décision de conduite déjà prise (avertir, ne pas retirer la catégorie) ; la règle de fond reste à confirmer                                                                                                |
| **D-052**    | **Prorata temporis** absent sur la 1ʳᵉ annuité ; **dégressif non plafonné**                                          | **Le comptable**           | Vérifié : `planAmortissement` ne contient aucun `prorata` ; le dégressif applique « taux double du linéaire » **sans plafond**. Si le prorata est obligatoire, le plan est faux sur **tous** ses exercices |
| **D-052**    | Cotisation INASTI en taux plat, sans assiette circulaire ni minimum                                                  | **Le comptable**           | Chiffre indicatif — la mention est désormais portée par le paramètre                                                                                                                                       |
| **D-073**    | Le gaz peut être compté **deux fois** ; un trajet **trois fois**                                                     | **Le porteur**             | Signalé au point de saisie et prouvé par un test « ne protège PAS » — rien ne peut le détecter techniquement                                                                                               |
| **D-065**    | Conditions d'utilisation d'OpenRouteService pour un usage **commercial**                                             | **Le porteur** (juridique) | Aucune dépendance structurelle (les distances sont en base) — mais la clé `OPENROUTESERVICE_API_KEY` reste vide dans `.env.example`                                                                        |
| **D-060**    | Points restants : **deux marchés le même jour**, **répartition des charges fixes par session**                       | **Le porteur**             | Le `×2` aller-retour reste systématique ; le coût d'emplacement `metre_lineaire_mois` reste `null` avec sa raison affichée — jamais un chiffre deviné                                                      |

### B. Travail qui reste à faire — **aucune décision n'attend**

| Réf.      | Le travail                                                                                                                          | Où j'en suis                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D-079** | **Le sweep du focus perdu.** Statut honnête, travail réel                                                                           | **Non fait, et je peux le mesurer** : 25 occurrences de `disabled={…enCours}` dans `apps/web/src/**.tsx` — la **seconde** cause identifiée par le complément du 31/07 — contre **11 fichiers** portant le remède `requestAnimationFrame`. Et **aucune garde dérivée n'existe** pour ce défaut, alors que l'entrée exige que la liste soit dérivée du code (D-045). Je n'affirme pas que 14 écrans sont cassés : j'affirme que **rien ne le dit, dans un sens ni dans l'autre** |
| **D-091** | Le **critère de fin de la fiche 02** : captures automatisées aux trois résolutions                                                  | **Toujours inexistant** — aucun test de rendu multi-résolution. L'entrée le dit et c'est encore vrai. Tant qu'il manque, une capture manuelle aux trois largeurs reste la seule vérification valable                                                                                                                                                                                                                                                                           |
| **D-047** | La dette **Prettier**                                                                                                               | 24 fichiers restants (contre 105 annoncés). `format:check` n'est toujours pas dans la porte de sortie — les deux gestes vont ensemble, hors travail parallèle                                                                                                                                                                                                                                                                                                                  |
| **D-081** | Deux tableaux **structurellement trop larges** pour 1280 px (Amont/Aval du registre AFSCA, liste des commandes avec panneau ouvert) | Décrits, non corrigés — et la garde est **muette** dessus par construction (« une somme de pourcentages est une contrainte de répartition, pas de capacité »)                                                                                                                                                                                                                                                                                                                  |
| **D-089** | `saison.ts` **avait** sa propre pondération dupliquée                                                                               | **Fait** : `ageEnJours`/`poidsTemporel` sont partagés depuis `baseline.ts` par les quatre modules concernés (voir §3, D-089)                                                                                                                                                                                                                                                                                                                                                   |
| **D-078** | Rappel de portée                                                                                                                    | Zéro `it.fails` **ne veut pas dire** zéro défaut connu. Les défauts trouvés au navigateur n'y transitent jamais : le dépôt n'a ni `jsdom` ni `@testing-library/react`, donc rien ne peut observer `document.activeElement`                                                                                                                                                                                                                                                     |

---

## 6. Les trois écarts qui coûtent le plus au porteur

### 1. D-087 — on lui dit qu'il ne peut pas corriger sa base, alors qu'il le peut

L'entrée affirme, au présent et en gras, qu'il n'a « **aucun moyen légitime** de corriger sa
propre base », et nomme deux réceptions fantômes créées par des agents dans sa base réelle.
**Le câblage existe depuis le 31/07** sur les trois écrans concernés.

**Ce qu'il perd** : soit il croit son registre AFSCA durablement faux et attend un correctif
déjà livré, soit un agent recâble une capacité déjà là et casse ce qui marche. C'est le seul
écart qui touche une obligation réglementaire.

### 2. D-074 — le journal envoie vers une migration qu'on a prouvée impossible

L'entrée dit « correctif NON appliqué » et prescrit, en « à faire quand le porteur est
disponible », de **migrer `distance_km` en `real`**. Or : le correctif qui comptait — la
précision jetée **à la source** — est appliqué (arrondi au dixième), **et** la migration
prescrite a été essayée sur une copie de sa base le 31/07 et **échoue en
`FOREIGN KEY constraint failed`**.

**Ce qu'il perd** : un créneau réservé « avec sauvegarde de la base » pour une opération
impossible, sur un défaut déjà réparé. Et, plus grave pour la lecture du journal, l'option
retenue est celle que D-074 avait **écartée** — sans qu'aucune ligne ne le dise. Un lecteur
qui applique D-074 telle qu'écrite en tire une règle abandonnée, exactement le cas
D-091/cible de résolution qu'il a déjà payé.

### 3. D-063 + D-087 — « rien ne pose jamais le statut `verrouillee` » est faux, et c'est un verrou comptable

Les deux entrées affirment, chacune de son côté, que le troisième état d'une période
(`verrouillee`) n'est **écrit par aucun chemin de production**, et D-087 en tire même une
décision d'interface (« ne pas construire l'avertissement préventif : ce serait un signal
qui ne peut jamais être vrai »).

**Il est écrit aujourd'hui**, de bout en bout : `verrouillerPeriode` → `POST
/periodes/:id/verrouiller` → bouton dans `Comptabilite.tsx`.

**Ce qu'il perd** : le raisonnement qui a justifié de **ne pas** avertir avant une action
irréversible repose sur une prémisse devenue fausse. Le porteur peut donc aujourd'hui
verrouiller une période, puis se heurter à un refus d'annulation **sans avoir été prévenu** —
et `contrepasserMouvement` vérifie la période sur la date **du mouvement d'origine**, ce qui
rend la correction définitivement impossible (conséquence assumée par D-087). Le garde-fou
existe, l'avertissement a été écarté sur un argument périmé.

---

## 7. Deux observations hors périmètre, signalées sans être corrigées

- **`coverage/` n'est ignoré ni par `.gitignore` ni par `.prettierignore`.** Le répertoire est
  apparu pendant l'audit (horodaté 12:48–12:49, soit après ma propre exécution de `vitest`,
  donc probablement produit par un autre agent en parallèle). Il fait remonter Prettier à 29
  fichiers non conformes au lieu de 24. **Je ne l'ai pas supprimé** : il peut appartenir à une
  exécution en cours. Deux lignes à ajouter, quand plus personne n'écrit.
- **`schemaImmobilisationDetail.dateCession` est un champ de sortie qui vaut toujours `null`**
  — c'est-à-dire exactement la quatrième catégorie que D-088 vient de nommer (« champ mort
  côté écriture »). Il est déjà documenté comme tel dans le contrat, et D-070 le garde par un
  test. Rien à faire ; à citer dans `docs/21-CHAMPS-NON-LUS.md` au prochain balayage, comme
  D-088 le demande.
