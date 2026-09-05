# 05 — Découverte automatique d'événements par l'IA, rayon réglable autour de chaque lieu

## Constat

Le module Événements (`docs/01-SPEC-FONCTIONNELLE.md` module 5) permet aujourd'hui la saisie
manuelle. Le besoin : que l'IA **cherche elle-même** les événements susceptibles d'affecter
la fréquentation d'un lieu de vente (`lieu_marche`), dans un rayon **réglable** autour de ses
coordonnées — 5, 10, 15, 20, 40 ou 100 km, avec 20 km comme valeur par défaut — La Batte
étant le premier lieu concerné. Les propositions trouvées doivent ensuite être **triées par
rentabilité prévue**, pas seulement listées par date, pour que l'utilisateur traite d'abord
ce qui compte le plus.

## Vérifier l'existant avant de coder

Le champ `evenement.source` et `evenement.valide_par_humain` existent déjà dans le modèle de
données (`docs/02-MODELE-DONNEES.md`) — la structure pour distinguer une saisie manuelle
d'une proposition automatique est donc déjà en place. Ce qui manque : le déclenchement de la
recherche elle-même, le réglage du rayon, l'estimation de rentabilité, et l'écran de
validation qui en découle.

## Rappel de principe — non négociable

`CLAUDE.md` §3 point 2 est explicite : **un LLM ne calcule jamais** et **aucune sortie IA
n'entre en base sans validation humaine explicite**. La recherche d'événements est un usage
d'assistance à la saisie, exactement comme la lecture d'un bon de livraison (Lot 9,
`docs/03-MOTEUR-PREVISION.md` §« Rôle exact de Claude dans ce module »). Elle **propose**,
elle n'**insère jamais** directement dans `evenement`. Le calcul de rentabilité prévue décrit
ci-dessous est déterministe (mêmes règles que le moteur de prévision), pas une estimation
donnée par le modèle de langage.

## Ce qui doit changer

### Rayon de recherche réglable

- Champ sur `lieu_marche` : `rayon_recherche_evenements_km`, valeur parmi
  **5, 10, 15, 20, 40, 100**, réglable indépendamment pour chaque lieu — pas une constante
  codée en dur. Défaut : 20 km.
- Tâche planifiée (hebdomadaire, par lieu actif) qui interroge le web (recherche + lecture
  de pages, pas une invention par le modèle) pour repérer les événements à venir dans ce
  rayon : festivals, braderies, matchs à domicile, travaux de voirie connus, jours fériés
  locaux, grèves annoncées.
- Résultat stocké comme **proposition en attente** (`evenement.valide_par_humain = false`,
  `source = 'ia'`), jamais directement actif dans le calcul de prévision.

### Tri par rentabilité prévue

- Chaque proposition reçoit une **estimation de rentabilité prévisionnelle**, calculée avec
  les mêmes règles que le facteur événement du moteur de prévision
  (`docs/03-MOTEUR-PREVISION.md` §« Facteur 3 — Événements ») : impact estimé à partir de la
  portée et de l'intensité, appliqué à la baseline du lieu concerné, converti en surcroît de
  marge attendu (nombre de crêpes supplémentaires estimées × marge unitaire moyenne).
- La distance réelle de l'événement doit peser dans cette estimation : un événement à 5 km
  a plausiblement plus d'effet sur la fréquentation qu'un événement à 90 km trouvé parce que
  le rayon a été élargi à 100 km — la portée déjà modélisée (_quartier | liège | national_)
  reste le bon levier pour capturer ça, à affiner si besoin par une distance-decay explicite
  si l'expérience montre que la portée seule ne suffit pas à distinguer 5 km de 90 km.
- Écran de validation dédié : liste des propositions **triée par rentabilité prévue
  décroissante**, avec la source citée, la distance au lieu, une case pour ajuster la
  portée/intensité estimée avant validation, et deux actions — valider (l'événement devient
  actif et entre dans le calcul) ou rejeter.
- Respect du plafond de coût IA et du mode dégradé déjà posés (Lot 9) : si le plafond
  mensuel est atteint, cette recherche automatique s'arrête proprement, sans bloquer le
  reste de l'application, avec un message explicite plutôt qu'un échec silencieux.

## Ce qui doit être relié

- Table `evenement` et son mécanisme d'apprentissage de l'impact mesuré, déjà posé en
  `docs/03-MOTEUR-PREVISION.md` §« Facteur 3 — Événements » : une fois un événement validé et
  sa session passée, l'impact mesuré réel doit aussi permettre de recalibrer l'estimation de
  rentabilité prévue pour de futurs événements comparables, pas seulement le facteur brut.
- Tableau de bord (`docs/06-UI-ET-PARCOURS.md`) : une proposition d'événement en attente de
  validation doit apparaître dans le bloc Alertes, au même titre qu'un seuil de stock ou
  une échéance administrative, avec sa rentabilité prévue en évidence.
- `journal_ia` : chaque recherche est journalisée avec son coût, comme tout appel Claude.

## Critère de fin

Une tâche planifiée propose au moins un événement plausible pour La Batte, dans le rayon
réglé pour ce lieu (20 km par défaut), l'utilisateur voit la liste triée par rentabilité
prévue décroissante avec la distance affichée, valide un événement, et celui-ci entre dans
le calcul de la prochaine prévision — sans qu'aucune proposition ne soit jamais entrée en
base sans ce clic de validation. Changer le rayon à 100 km fait apparaître des événements
plus lointains, correctement classés plus bas s'ils sont estimés moins rentables.

---

## Mise à jour du 01/08/2026 — vérifié dans le code réel

**Verdict : fait, avec deux déviations assumées et documentées dans le code.**

**Rayon réglable.** `DOMAINE_RAYON_RECHERCHE_KM = [5, 10, 15, 20, 40, 100]`, défaut 20
(`packages/core/src/evenements-decouverte.ts:32`), réglable par lieu via
`PATCH /evenements-decouverte/lieux/:lieuId/rayon-recherche`
(`apps/api/src/routes/evenements-decouverte.ts:501-512`).

**Recherche web réelle, pas une invention.** `rechercherEvenementsParClaude`
(`apps/api/src/routes/evenements-decouverte.ts:228-475`) utilise l'outil serveur
`web_search_20250305`, avec une consigne qui interdit explicitement d'inventer (« si tu ne
trouves rien de sourcé, réponds par un tableau vide », `:153-154`) et relance jusqu'à
`NB_TOURS_MAX` fois après `pause_turn`, en **revérifiant le plafond mensuel avant chaque
tour** (`:276-324`, audité le 30/07/2026 selon le commentaire du fichier). Chaque appel est
journalisé dans `journal_ia` sur tous les chemins (succès, refus, coupure par plafond,
panne réseau) via `journaliserAppelIa`.

**Propositions jamais actives sans validation.** `creerPropositionEvenementIa`
(`packages/db/src/depots/evenements-decouverte.ts`) écrit `valide_par_humain = false`,
`source = 'ia'` ; `POST …/propositions/:id/valider` et `.../rejeter`
(`evenements-decouverte.ts:572-588`) sont les deux seuls chemins qui en changent l'état.

**Rentabilité, entièrement déterministe.** `facteurEvenementDepuisPorteeIntensite` reprend
littéralement `1 + portée × intensité × pente` (docs/03) ; `facteurDistanceDecayBp` +
`rentabiliteEstimeeCents` (`packages/core/src/evenements-decouverte.ts:77-195`) implémentent
**en plus** la décote de distance explicite que la fiche ne demandait qu'« à affiner si
besoin » — déjà faite, linéaire entre deux seuils réglables via `parametre`, plancher à
100 km. `trierParRentabiliteDecroissante` trie le résultat, côté serveur
(`:198-202`, appelé dans la route de recherche).

**Écran de validation.** `apps/web/src/pages/PropositionsEvenements.tsx` affiche la source,
la distance (« ≈ X km à vol d'oiseau », jamais un temps de trajet), permet d'ajuster
portée/intensité avant validation, et les deux actions valider/rejeter.

**Câblage au tableau de bord, comme demandé.** `TableauDeBord.tsx` (état `propositionsEvenements`,
commentaire daté citant cette fiche par son nom) affiche les propositions en attente dans le
bloc Alertes, triées par rentabilité — via `GET /evenements-decouverte/propositions`.

**Déviation n°1 — documentée dans le code, pas dans `docs/05-DECISIONS.md`.** La fiche
demande une « tâche planifiée hebdomadaire ». Le projet n'a **aucun ordonnanceur** (aucune
dépendance cron, aucun processus d'arrière-plan) ; plutôt que d'en ajouter un pour cette
seule fiche, un bouton « Chercher des événements » par lieu déclenche la recherche
manuellement (`apps/api/src/routes/evenements-decouverte.ts:5-13`). Le raisonnement est
écrit et cohérent avec CLAUDE.md §5, mais **CLAUDE.md §9 demande que toute décision
d'architecture nouvelle soit consignée dans `docs/05-DECISIONS.md`** — je n'ai trouvé aucune
entrée qui la consigne (recherche sur « ordonnanceur », « cron », « tâche planifiée » :
aucun résultat). Signalé, pas tranché : ce n'est pas mon fichier à modifier.

**Déviation n°2 — un manque réel, pas encore couvert.** La fiche demande que « l'impact
mesuré réel doit AUSSI permettre de recalibrer l'estimation de rentabilité prévue pour de
futurs événements comparables, pas seulement le facteur brut ». Le mécanisme existant
(`mesurerImpactEvenement` / `impactMesureSession`,
`packages/db/src/depots/previsions.ts:807-925`, antérieur à cette fiche — déjà posé pour la
fiche 4) écrit `evenement.impact_mesure_bp` pour **cet événement précis**, une fois ses
sessions closes. Rien, dans `packages/db/src/depots/evenements-decouverte.ts` ni ailleurs,
ne relit l'historique des `impact_mesure_bp` d'événements comparables (même type, même
portée) pour ajuster `coefficientPorteeBp`/`penteIntensiteBp` ou toute autre composante de
`rentabiliteEstimeeCents` sur une NOUVELLE proposition. C'est donc à faire — décrit ici, pas
codé.

**Note technique, mineure.** `packages/core/src/contrats/evenements-decouverte.ts` et
`packages/db/src/depots/evenements-decouverte.ts` sont encore hors des barrels
`@batte/core`/`@batte/db` : les imports croisés passent par un chemin relatif temporaire
(commentaire en tête de `apps/api/src/routes/evenements-decouverte.ts` et de
`PropositionsEvenements.tsx`). Sans conséquence pour l'utilisateur, mais à câbler pour qui
reprend ce module.
