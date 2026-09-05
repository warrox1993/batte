# 07 — Rétention illimitée de l'historique des ventes et précision du modèle

## Constat

Le besoin exprimé : ne **jamais** supprimer une donnée de vente, quel que soit son ancienneté,
tant que la base existe, pour disposer du plus long historique possible et affiner la
prévision. Et enrichir le modèle de paramètres supplémentaires pour approfondir la précision
jour par jour.

## Vérifier l'existant avant de coder

Rien dans les fiches actuelles ne prévoit de purge automatique des ventes — c'est donc déjà
implicitement le comportement par défaut. Le travail ici consiste à **le rendre explicite et
garanti** (empêcher qu'une fonctionnalité future — un export, un archivage — supprime des
données par erreur), pas à corriger une suppression existante.

## Un point à clarifier avec l'utilisateur avant de coder

**Correction du 29/07/2026** : ce paragraphe évoquait initialement un « plafond de stockage
Supabase en niveau gratuit ». C'est **faux pour ce projet** — il vient d'une autre version de
l'application. La base est un **fichier SQLite local** (CLAUDE.md §2, décision D-001) ; il
n'existe aucun Supabase dans la stack, et le porteur a explicitement abandonné cette piste le
29/07/2026 (décision **D-056**, `docs/05-DECISIONS.md`). Voir aussi
`[[fiches-demandes-zero-regression]]`, qui liste ce même défaut comme l'une des quatre
contradictions vérifiées de ce lot de fiches.

« Indéfiniment » et « nombre d'années infini » sont à prendre au sens : **aucune purge
automatique, aucune limite de durée codée en dur**, pas au sens littéral d'un stockage
infini — la seule limite réelle est le **disque local de la machine**, et l'historique est
couvert par les sauvegardes déjà prévues (`docs/07-DOCTRINE-ERP-ET-DESIGN.md`). C'est une
réserve **plus favorable** que celle initialement annoncée : pas de quota cloud à surveiller,
seulement l'espace disque d'un poste de travail. En pratique, ce n'est pas une contrainte
réelle avant longtemps : une ligne de vente pèse quelques centaines d'octets, et même plusieurs
décennies de marchés hebdomadaires resteraient largement en dessous de ce que contient un
disque de PC actuel. Documenter cette réserve plutôt que promettre un stockage littéralement
infini.

## Ce qui doit changer

### 1. Garantie de non-suppression

- Aucune fonctionnalité de purge ou d'archivage automatique sur `session_vente`,
  `session_marche`, `production`, `mouvement_stock`. Une suppression ne peut être que
  manuelle, motivée, et passe par une écriture d'annulation — jamais un `DELETE` (règle déjà
  posée en `CLAUDE.md` §3 point 7).
- Ajouter un test qui vérifie qu'aucune tâche planifiée du projet ne touche à ces tables en
  suppression.

### 2. Nouveaux paramètres de précision pour le modèle

En plus des facteurs déjà posés (météo, événement, saison, tendance —
`docs/03-MOTEUR-PREVISION.md`), ajouter ces prédicteurs, chacun activable seulement une fois
suffisamment d'historique disponible pour l'estimer sérieusement (même principe de
démarrage à froid déjà posé) :

- **Comparable historique du même jour calendaire** : les ventes du même jour de l'année
  précédente (et des années antérieures si disponibles), pondérées par leur ancienneté,
  comme point de comparaison direct — utile en particulier pour les jours à forte
  saisonnalité (Chandeleur, période estivale).
- **Jour de la semaine** — déjà pertinent même à un seul lieu si plusieurs jours de vente
  s'ajoutent plus tard (foires en semaine).
- **Proximité d'une période de vacances scolaires belges** (calendrier statique, déjà évoqué
  en `docs/03-MOTEUR-PREVISION.md` §« Facteur 4 »).
- **Historique météo réalisé vs prévu** : mesurer l'écart entre la météo prévue à J-7 et la
  météo réellement observée, pour calibrer la confiance à accorder à une prévision météo
  lointaine dans le calcul de l'intervalle P10/P90.
- **Effet de session consécutive** : une session la semaine précédente s'est-elle soldée par
  une rupture ou un invendu important ? Cet indicateur affine le facteur de tendance à court
  terme, au-delà de la régression linéaire déjà posée.

### 3. Discipline de mesure

Chaque nouveau paramètre suit la même règle que les facteurs existants : n'entrer dans le
calcul qu'une fois testé en validation croisée _leave-one-out_ contre le modèle sans ce
paramètre (déjà posé pour météo/saison en `docs/03-MOTEUR-PREVISION.md`), et rester
visible dans la décomposition affichée à l'écran (`docs/06-UI-ET-PARCOURS.md`, écran
Prochaine session) — un paramètre qui améliore le score mais rend l'explication illisible
n'est pas un progrès net.

## Ce qui doit être relié

- Moteur de prévision (`docs/03-MOTEUR-PREVISION.md`) et son extension calendaire (fiche 06).
- Écran « Qualité du modèle » déjà prévu (module 5, `docs/01-SPEC-FONCTIONNELLE.md`) : ajouter
  le suivi de la contribution de chaque nouveau paramètre à la précision globale (MAPE avec
  et sans le paramètre), pas seulement l'indicateur global déjà posé.
- Sauvegardes (`docs/07-SECURITE-ET-DEPLOIEMENT.md`) : un historique qu'on choisit de ne
  jamais purger doit _a fortiori_ être bien sauvegardé — vérifier que le mécanisme déjà posé
  couvre correctement ces tables en croissance continue.

## Critère de fin

Après plusieurs sessions simulées sur plus d'un an de données synthétiques (jeu de test),
vérifier que le comparable historique du même jour calendaire s'active automatiquement une
fois l'historique suffisant, apparaît dans la décomposition affichée, et améliore
mesurablement le MAPE par rapport au modèle sans ce paramètre.

---

## Vérification du 01/08/2026 — confronté au code réel, dans les deux sens

### 1. Ce que la fiche demande est FAIT, très largement

**§1 Garantie de non-suppression** : `packages/db/src/non-suppression-historique.test.ts`
existe et vérifie explicitement l'absence de `DELETE` sur les tables sensibles.

**§2 Cinq nouveaux prédicteurs** : les cinq modules existent et sont câblés, chacun testé et
soumis à validation croisée _leave-one-out_ (`packages/core/src/prevision/validation-croisee.ts`) :
`comparable-calendaire.ts`, `jour-semaine.ts`, `vacances-scolaires.ts`,
`ecart-meteo-prevue-realisee.ts` (avec `horizon.ts` pour l'inflation de σ), et
`session-consecutive.ts`. Tous archivés sur `prevision` (voir `docs/03-MOTEUR-PREVISION.md`,
déjà à jour sur ce point, marqué `[RÉEL]`).

### 2. Ce que l'application fait EN PLUS de ce que demande la fiche

**a. La garantie de non-suppression couvre TOUT le schéma, pas seulement les 4 tables
nommées.** `non-suppression-historique.test.ts` ne protège plus une liste écrite à la main :
`TABLES_PROTEGEES` se **dérive** de `packages/db/src/schema.ts` (`tablesDuSchema()`), donc
toute table future y entre automatiquement. Une seule exception assumée et documentée
(`recette_ligne`, motif écrit dans le fichier), verrouillée par un test dédié. C'est très
au-delà de ce que demandait la fiche (« aucune tâche planifiée... sur `session_vente`,
`session_marche`, `production`, `mouvement_stock` ») — elle couvre aussi les 7 tables AFSCA
et les ~30 autres tables du schéma (`depense`, `facture_fournisseur`, `immobilisation`,
`echeance`, `periode`...).

**b. La fuite d'information fermée le 01/08 (D-089, `docs/05-DECISIONS.md`) touche
directement la « discipline de mesure » §3 de cette fiche.** Cette fiche exige que « chaque
nouveau paramètre n'entre dans le calcul qu'une fois testé en validation croisée
_leave-one-out_ » — c'est exactement le mécanisme qui contenait la fuite. Avant correction,
`validerParLeaveOneOut` recevait un historique de référence contaminé par des sessions
**futures** (retrait par index, pas par date), donnant un poids maximal à une session
postérieure au point évalué. Le complément du 01/08 a balayé les sept modules du moteur qui
pondèrent par récence :

| Module                     | Portait la fuite  | Verdict après correction                                            |
| -------------------------- | ----------------- | ------------------------------------------------------------------- |
| `saison.ts`                | oui               | corrigé, actif                                                      |
| `jour-semaine.ts`          | oui               | corrigé, actif — **mesuré**                                         |
| `vacances-scolaires.ts`    | oui               | corrigé, actif                                                      |
| `session-consecutive.ts`   | oui (calibration) | corrigé, actif, limité                                              |
| `comparable-calendaire.ts` | non               | **sain** — sa garde d'âge minimum (échelle en années) l'exclut déjà |
| `tendance.ts`              | non               | **sain** — filtre déjà sur la date                                  |

Quatre tests existants **décrivaient l'erreur qu'ils étaient censés surveiller** (fixtures
avec du « passé » en réalité postérieur à la cible) — un mode d'échec qui ne ment pas sur le
résultat mais sur la situation testée. Deux restent rouges pour une raison de fixture
assumée (mercredis tous trop récents), documentée dans le complément D-089 plutôt que
« réparée » en baissant un seuil.

### 3. Ce qui manque à l'app — décrit, non codé

**L'écran « Qualité du modèle » ne montre pas la « contribution de chaque nouveau paramètre à
la précision globale (MAPE avec et sans le paramètre) »**, alors que c'est explicitement
demandé par le §« Ce qui doit être relié » de cette fiche (« pas seulement l'indicateur
global déjà posé »). Vérifié dans `apps/web/src/pages/QualiteModele.tsx`
(`PanneauPredicteursPrecision`) : le panneau « Précision des prédicteurs (fiche 07) »
n'affiche qu'un **compte d'activation** par prédicteur (« X / Y prévisions archivées où le
facteur a été retenu ») pour quatre des cinq prédicteurs (comparable calendaire, jour de
semaine, vacances scolaires, session consécutive — l'écart météo/inflation σ n'y figure pas
du tout). Le calcul sous-jacent existe pourtant déjà et sert à la décision d'admission :
`validerParLeaveOneOut` (`packages/core/src/prevision/validation-croisee.ts`) rend
`mapeAvecPredicteurBp`, `mapeSansPredicteurBp` et `ameliorationBp` pour chaque prédicteur —
mais ce triplet n'est ni archivé par prédicteur, ni affiché nulle part dans l'écran. La
mesure existe donc à l'instant du calcul, mais rien n'en garde de trace exploitable a
posteriori pour répondre précisément à la question que pose cette fiche.
