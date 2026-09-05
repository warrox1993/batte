# 21 — Champs calculés jamais lus

> **Objet.** Recenser les valeurs **calculées côté serveur, exposées par une route, validées par
> Zod, testées** — et que **rien, dans `apps/web/src` ni dans `apps/api/src/documents`, ne lit
> jamais**. Le typecheck ne les voit pas (un champ non lu compile), les tests ne les voient pas
> (ils testent le calcul, qui est juste). Seule une recherche systématique confrontant les
> schémas de sortie à leurs lecteurs réels peut les trouver.
>
> **Date.** 30/07/2026. **Nature.** Audit — lecture seule, aucune correction appliquée.
>
> **Généalogie.** Ce document n'est pas le premier passage sur ce terrain.
> `docs/13-AUDIT-CAPACITES-ORPHELINES.md` a déjà établi, à l'échelle de la **route**, que
> `GET /api/ia/etat` et `GET /api/ia/journal` sont orphelines (§4.6), et qu'un premier passage sur
> `GET /api/couts-produits` avait seulement vérifié que le **calcul** intègre désormais les
> garnitures (§4.1), sans vérifier sa consommation côté écran. Ce document reprend ce second point
> laissé ouvert, et descend d'un cran : à l'échelle du **champ**, à l'intérieur de routes par
> ailleurs consommées, pour trouver les valeurs qu'un écran lit partiellement — certains champs
> d'une réponse affichés, d'autres jamais.

---

## 0. Méthode — comment cette liste a été construite

Conformément à la leçon D-045 (« une liste énumérée à la main n'est pas une preuve d'absence »),
la liste candidate vient de la source de vérité — les schémas Zod de sortie — et non d'une lecture
fichier par fichier.

**Étape 1 — extraire tous les champs déclarés dans les contrats.**

```
for f in packages/core/src/contrats/*.ts; do
  case "$f" in *.test.ts) continue;; esac
  grep -oE '^\s+[a-zA-Z_][a-zA-Z0-9_]*:' "$f"
done | sed -E 's/^\s+//; s/:$//' | sort -u > all_fields.txt
```

→ **658 noms de champs uniques**, sur les 24 fichiers non-test de `packages/core/src/contrats/`
(7 233 lignes au total, tests compris).

**Étape 2 — construire le vocabulaire réellement utilisé par les lecteurs.**

```
find apps/web/src apps/api/src/documents -type f \( -name "*.ts" -o -name "*.tsx" \) \
  ! -name "*.test.ts" -exec cat {} + \
  | grep -oE '[a-zA-Z_][a-zA-Z0-9_]*' | sort -u > used_words.txt
```

→ **9 676 identifiants uniques**, sur 69 fichiers non-test (`apps/web/src` + `apps/api/src/documents`).

**Étape 3 — soustraire.**

```
comm -23 all_fields.txt used_words.txt > never_used.txt
```

→ **80 candidats** dont le nom n'apparaît **comme aucun token** dans les deux dossiers-cibles.
Cette méthode ne peut pas produire de faux négatif : si un champ est lu (même déstructuré, même
passé en bloc à un composant), son nom apparaît forcément comme mot dans le fichier qui le lit. Elle
peut en revanche produire des faux positifs — un mot générique réutilisé ailleurs, un champ lu via
une variable renommée dans un cas rarissime, ou un champ dont l'information équivalente est déjà
montrée par un champ frère. D'où l'étape 4.

**Étape 4 — vérifier chaque candidat à la main, par lecture du contrat, de la route qui le sert,
puis du fichier consommateur réel.** C'est cette étape, pas le grep, qui décide de la classe
(défaut réel / faux positif / absence délibérée). Sur les 80 candidats, 3 ne sont pas des champs de
donnée (`ctx` est un paramètre de callback Zod ; `sessionsAvecMargeBruteConnue` /
`sessionsAvecMargeNetteConnue` sont des noms de variables internes à un accumulateur, captés par le
même motif de `grep`, jamais des champs de schéma) — 77 candidats réels. **45 ont été vérifiés
individuellement** dans le temps imparti ; les **32 restants ne le sont pas** et ne sont ni comptés
comme défauts ni blanchis (liste en §5).

Pendant la vérification, trois fichiers activement modifiés par d'autres agents
(`apps/web/src/pages/Sessions.tsx`, `packages/db/src/services/stock.ts`,
`packages/core/src/contrats/stock.ts`) ont été relus **au moment d'écrire la ligne les concernant**,
pas depuis une lecture antérieure. Un cas exactement prévu par la consigne s'est produit :
`ecartsStock` (§4 de la mission, D-037) était encore un défaut ouvert en début de parcours ; une
relecture fraîche de `Sessions.tsx` en fin d'audit montre `resultat.ecartsStock` désormais câblé
(`setEcartsStockDerniereCloture(resultat.ecartsStock)`, `Sessions.tsx:2483`, et
`formaterAvertissementEcartsStock(...)`, `:2570`) — corrigé par un agent en parallèle pendant cet
audit. **Non reporté ici comme défaut.**

---

## 1. Défauts réels — triés par coût pour l'utilisateur

### 1.1 Le coût de revient réel par produit n'est visible NULLE PART

- **Champs** : `coutPateCents`, `coutAchatCents`, `coutGarnituresCents`, `coutMatiereCents`,
  `margeCents`, `margeBp`, `garnitures[].coutCents` —
  `packages/core/src/contrats/recettes.ts:144-161` (`schemaCoutProduitVendu`).
- **Routes** : `GET /couts-produits` et `GET /produits/:id/cout-revient`,
  `apps/api/src/routes/recettes.ts:110-119`. Le commentaire de la route (`:100-109`) dit
  explicitement : « L'écran Produits a besoin de la colonne pour toutes ses lignes à la fois. »
- **Vérifié absent** : `apps/web/src/pages/Produits.tsx` n'appelle ni `/couts-produits` ni
  `/produits/:id/cout-revient` (zéro occurrence des deux chemins). Ses colonnes
  (`Produits.tsx:265-308`) sont `nom`, `nature`, `prix`, `statut` — jamais coût ni marge. Zéro
  occurrence aussi dans `apps/api/src/documents`.
- **Ce que le porteur ne voit jamais** : pour CHAQUE produit vendu, le coût de revient réel
  (pâte + garnitures) et la marge qui en découle — alors que c'est la ligne « Comptabilité
  analytique — coût de revient réel, marge par axe » du tableau `CLAUDE.md` §0, l'une des cases qui
  distingue un ERP de modules juxtaposés. Le jeu de démonstration illustre le risque exact que le
  calcul a été corrigé pour éviter (`docs/13` §4.1) : une crêpe à 3,00 € et une à 3,50 € peuvent
  afficher un coût identique tant que personne ne regarde `/couts-produits` — et personne ne le
  regarde.
- **Généalogie** : `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §4.1 avait vérifié que le **calcul**
  intègre désormais les garnitures, en notant explicitement ne pas avoir revérifié la consommation
  écran. C'est ce point, laissé ouvert, que cette entrée referme : le calcul est juste, personne ne
  le lit.

### 1.2 La détection d'économie d'achat n'est appelée par aucun écran

- **Champs** : `prixReferenceCents`, `economieUnitaireCents`, `economiePotentielle`,
  `francoDePortCents`, `commandeMinimumCents` — `packages/core/src/contrats/economies.ts:155-174`
  (`schemaDetectionEconomie`).
- **Route** : `GET /economies/detecter`, `apps/api/src/routes/economies.ts:121-176`, pensée pour
  « proposer l'écart AVANT saisie (réception, ou tout autre point d'entrée) » (commentaire du
  contrat, `economies.ts:150-153`).
- **Vérifié absent** : zéro occurrence de `/economies/detecter` ou `DetectionEconomie` dans
  `apps/web/src`. `apps/web/src/pages/Economies.tsx` charge `/economies`,
  `/economies/tableau-bord`, `/economies/renegociations-tarif`, mais jamais `/economies/detecter`.
- **Ce que le porteur ne voit jamais** : l'écart chiffré entre le prix qu'il s'apprête à payer et
  le meilleur prix déjà connu pour le même ingrédient chez le même (ou un autre) fournisseur,
  calculé par le mécanisme construit précisément pour le signaler avant qu'il ne signe la
  commande. Le module existe, tourne, ne parle à personne — le porteur peut payer plus cher qu'il
  ne le pourrait sans jamais le savoir, à chaque réception.

### 1.3 Le budget et le journal des appels Claude sont invisibles

- **Champs** : `plafondMensuelCents`, `depenseDuMoisCents`, `resteCents`, `nbAppelsDuMois`
  (`schemaEtatIa`, `packages/core/src/contrats/ia.ts:42-48`) ; `tokensEntree`, `tokensSortie`,
  `dureeMs`, `valideeParHumain`, `modele`, `usage`, `erreur` (`schemaAppelIa`, `ia.ts:23-34`).
- **Routes** : `GET /ia/etat` (`apps/api/src/routes/ia.ts:39`) et `GET /ia/journal`
  (`apps/api/src/routes/ia.ts:61`).
- **Vérifié absent** : zéro occurrence de `schemaEtatIa` / `schemaJournalIa` /
  `plafondMensuelCents` / `tokensEntree` dans `apps/web/src`. Le seul schéma IA consommé est
  `schemaCommentaireIa` (`apps/web/src/pages/ProchaineSession.tsx`), et même là,
  `commentaire.coutCents` (le coût de CET appel précis) n'est pas affiché — seul le texte ou la
  raison d'indisponibilité le sont (`ProchaineSession.tsx:345-350`).
- **Ce que le porteur ne voit jamais** : combien du plafond mensuel Claude a déjà été consommé, et
  l'historique des appels passés (avec leur coût et leur durée) — exactement le garde-fou que
  `CLAUDE.md` §5 impose noir sur blanc (« un compteur de coût par appel… un plafond mensuel
  configurable »). Le mécanisme fonctionne et coupe bien les appels au-delà du plafond ; l'écran qui
  dirait pourquoi n'existe pas.
- **Déjà documenté** : `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §4.6, confirmé encore orphelin dans
  l'encadré de mise à jour du 30/07/2026 en tête de ce même document. Cette entrée ajoute le détail
  par champ que §4.6 ne donnait pas.

### 1.4 La confirmation de réception tait l'avertissement de traçabilité et la commande soldée

- **Champs** : `avertissements`, `commandeNumero` — `packages/core/src/contrats/stock.ts:148,158`
  (`schemaReceptionCreee`).
- **Route** : `POST /receptions`, `apps/api/src/routes/stock.ts:182`.
- **Vérifié absent** (relu au moment d'écrire, fichiers sous édition parallèle) : zéro occurrence
  de `avertissements` ou `commandeNumero` dans `apps/web/src/pages/Stock.tsx`,
  `apps/web/src/pages/InventaireInitial.tsx` ou `apps/web/src/saisie-stock/SaisieReception.tsx`. Le
  message de confirmation (`Stock.tsx:712-719`, `InventaireInitial.tsx:41-48`) ne cite que
  `numero`, `nbLots`, `montantTotalCents`.
- **Ce que le porteur ne voit jamais** : quand un lot reçu n'est identifié QUE par sa DLC, sans
  numéro de lot fournisseur — la faiblesse de traçabilité exacte que le champ a été écrit pour
  signaler (« deux réceptions à la même DLC resteraient indistinguables en cas de rappel »,
  `stock.ts:143-146`) — le porteur accepte la réception sans jamais en être averti. C'est
  l'équivalent exact du précédent « motif de blocage AFSCA jamais imprimé » cité par la mission :
  une alerte réglementairement pertinente, calculée, jamais montrée. Le second champ,
  `commandeNumero`, a été ajouté spécifiquement pour dire QUELLE commande venait d'être soldée
  (« la confirmation … ne le redisait jamais : “voir laquelle” s'arrêtait à l'instant de la
  saisie », `stock.ts:150-156`) — et ne le dit toujours pas à l'écran.
- **Régime réglementaire** : oui — traçabilité AFSCA (obligation légale, CLAUDE.md §3 règle 6).

### 1.5 Le détail des frais de session, justificatifs compris, n'est jamais réaffiché

- **Champ** : `fraisDetail` (tableau de `{ id, libelle, categorie, montantCents,
justificatifPath }`) — `packages/core/src/contrats/sessions.ts:344-350` (`schemaSessionDetail`).
- **Vérifié absent** (relu au moment d'écrire, fichier sous édition parallèle) : zéro occurrence de
  `fraisDetail` dans `apps/web/src/pages/Sessions.tsx`. `BlocDetailSession` (`Sessions.tsx:848-854`)
  ne montre que les CINQ totaux agrégés par catégorie (`fraisEmplacementCents`,
  `fraisDeplacementCents`, `fraisGazCents`, `fraisDiversCents`, `fraisEnergieCents`) et leur somme —
  jamais le détail ligne à ligne, jamais le lien vers un justificatif.
- **Ce que le porteur ne voit jamais** : si deux frais « divers » sont enregistrés sur une même
  session, lequel des deux justificatifs correspond à quel montant — en repassant plus tard sur une
  session clôturée, impossible de relier une pièce à une charge précise. Le commentaire du contrat
  documente lui-même que c'était « une donnée déjà écrite à chaque clôture et jamais relue par
  personne côté API » avant l'audit du 30/07/2026 (`sessions.ts:334-342`) : le trou côté contrat a
  été refermé aujourd'hui, mais l'écran n'a pas suivi.
- **Généalogie** : `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §4.11 (rédigé le 28/07) constatait
  `session_frais` illisible à l'échelle de la TABLE. Cette entrée en est la mise à jour du 30/07 :
  le contrat HTTP sait désormais rendre la donnée, l'écran ne la lit toujours pas.

### 1.6 La correction du coût d'un lot ne confirme jamais le AVANT/APRÈS

- **Champs** : `prixAvantCents`, `prixApresCents` — `packages/core/src/contrats/factures.ts:138-139`
  (`schemaCorrectionLotAppliquee`, commentaire : « le AVANT et le APRÈS, jamais “c'est fait” »).
- **Route** : `POST /factures/lignes/:ligneId/corriger-lot`,
  `apps/api/src/routes/factures.ts:161-165`.
- **Vérifié absent** : `apps/web/src/pages/Factures.tsx:474-487` (`corrigerCoutLot`) fait
  `await requeteApi(...)` sans même typer la réponse (`Promise<unknown>` non parsé), puis se
  contente d'un `chargerDetail(...)`. Zéro occurrence de `prixAvantCents` / `prixApresCents` dans
  tout `apps/web/src`.
- **Ce que le porteur ne voit jamais** : après avoir cliqué « corriger le coût du lot », aucune
  confirmation ne dit de combien le coût a changé — malgré un commentaire de contrat qui déclare
  explicitement que c'est là toute la raison d'être du champ. Financier, silencieux.

### 1.7 Le nombre de produits qui resteront accrochés à l'ancienne version d'une recette n'est jamais annoncé

- **Champ** : `nbProduits` — `packages/core/src/contrats/referentiel.ts:979`
  (`schemaRecetteReferentiel`).
- **Route** : `GET /referentiel/recettes`, `apps/api/src/routes/referentiel-ecriture.ts:393-396`.
  Le commentaire au-dessus du champ (`referentiel.ts:937-952`) est sans ambiguïté : « Le nombre de
  produits qui vont rester accrochés à l'ancienne [version] doit être annoncé avant, pas après. »
- **Vérifié absent** : `apps/web/src/pages/Recettes.tsx` lit bien `nbProductions` (le compteur
  voisin, qui scelle la recette — `Recettes.tsx:945,1763`) mais jamais `nbProduits`. Zéro
  occurrence.
- **Ce que le porteur ne voit jamais** : au moment de créer une nouvelle version d'une recette (au
  lieu de la modifier), combien de produits de vente existants continueront de pointer sur
  l'ancienne version — l'écran ne le dit qu'à travers `nbProductions` (productions déjà lancées),
  jamais à travers ce compteur-ci, pourtant écrit précisément pour ce cas.

### 1.8 Le justificatif d'une dépense n'est ni affiché ni ouvrable depuis la liste

- **Champ** : `justificatifPath` — `packages/core/src/contrats/comptabilite.ts:34`
  (`schemaDepenseLigne`).
- **Route** : `GET /depenses`, `apps/api/src/routes/comptabilite.ts:73`.
- **Vérifié absent** : zéro occurrence de `justificatifPath` dans
  `apps/web/src/pages/Comptabilite.tsx`.
- **Ce que le porteur ne voit jamais** : dans la liste des dépenses (celles qui entrent dans le
  calcul du bénéfice imposable), aucune indication qu'une pièce justificative a été jointe, ni
  moyen de la rouvrir pour vérifier une déduction déclarée — un point d'appui direct en cas de
  contrôle fiscal.

### 1.9 Qui a clôturé une période comptable, et quand elle a été rouverte

- **Champs** : `clotureePar`, `dateReouverture` — `packages/core/src/contrats/comptabilite.ts:215-216`
  (`schemaPeriodeLigne`).
- **Route** : `GET /periodes`, `apps/api/src/routes/comptabilite.ts:218`.
- **Vérifié absent** : `Comptabilite.tsx:1918` lit `motifReouverture`, et `dateCloture` est affichée
  (`:1905`) — mais `clotureePar` et `dateReouverture` n'apparaissent nulle part.
- **Ce que le porteur ne voit jamais** : le tableau de bord mono-utilisateur du projet compte DEUX
  personnes (le porteur et sa partenaire, `CLAUDE.md` §1). Savoir laquelle a clôturé une période,
  et à quelle date précise une réouverture a eu lieu (le motif de la réouverture est affiché, sa
  date ne l'est pas), est une information d'imputabilité perdue.

---

## 2. Défauts réels — secondaires (coût moindre, mais vérifiés)

| #    | Champ(s)                                                      | Contrat                                                | Route                                   | Ce que ça coûte                                                                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | `margeW`                                                      | `energie.ts:89` (`schemaDiagnosticPuissanceLieu`)      | `GET /equipements/diagnostic-puissance` | Le risque de disjonction s'affiche en booléen (`risqueDisjonction`) ; la marge RÉELLE en watts, positive ou négative, n'est jamais montrée (`LieuxMarche.tsx`, `Equipements.tsx` vérifiés).                                                                                                                                                           |
| 2.2  | `nbEquipementsEnService` + agrégat `puissanceRequiseW` (méta) | `energie.ts:98-100`                                    | même route                              | `Equipements.tsx:313-315` (`chargerDiagnostic`) ne garde que `.data`, jette `.meta` : l'agrégat flotte parc entier disparaît après le `.parse()`.                                                                                                                                                                                                     |
| 2.3  | `dernierPrixParProduit`                                       | `concurrents.ts:122-132` (`schemaConcurrentDetail`)    | `GET /concurrents/:id`                  | Résumé « dernier prix connu par produit » jamais affiché ; l'historique brut (`produits`, `observations`) l'est, donc l'info existe mais seulement en fouillant, jamais synthétisée.                                                                                                                                                                  |
| 2.4  | `datePremiereAlerte`                                          | `objectifs.ts:198` (`schemaResultatAnticipationSeuil`) | `GET /objectifs/succes`                 | `Objectifs.tsx` affiche `joursAnticipation` (dérivé) mais jamais la date calendaire exacte du premier franchissement du seuil d'alerte à 80 %.                                                                                                                                                                                                        |
| 2.5  | `ancienPrixCents`, `nouveauPrixCents`                         | `economies.ts:143-144` (`schemaResultatRenegociation`) | `POST /economies/renegociations-tarif`  | Le message de confirmation (`Economies.tsx:379-385`) ne cite que l'économie ; l'ancien et le nouveau prix, pourtant renvoyés, n'y figurent pas.                                                                                                                                                                                                       |
| 2.6  | `saisiPar`, `commandeNumero`                                  | `economies.ts:64-65` (`schemaEconomieLigne`)           | `GET /economies`                        | La liste des économies (`Economies.tsx:116-176`) n'a ni colonne « saisi par » (utile à deux utilisateurs) ni lien vers la commande liée.                                                                                                                                                                                                              |
| 2.7  | `mouvementAnnuleId`, `contrepassationId`                      | `stock.ts:291,293` (`schemaContrepassationCreee`)      | `POST /mouvements/:mouvementId/annuler` | `DetailLot.tsx:322-333` (`contrepasser`) ignore intégralement le corps de la réponse (`.then(() => {...})`) : les identifiants des deux écritures venant d'être créées ne sont ni affichés ni utilisés pour cibler un rafraîchissement précis.                                                                                                        |
| 2.8  | `distanceCalculAutomatique.raison`                            | `referentiel.ts:1022-1033`                             | `POST`/`PATCH /lieux`                   | Quand le calcul automatique de distance (OpenRouteService) échoue à la création/modification d'un lieu, la raison de l'échec est calculée et renvoyée, mais `LieuxMarche.tsx:433-453` ne l'inspecte jamais : distance vide, aucune explication. (L'attribution CC-BY 4.0, elle, est correctement affichée — via un texte statique distinct, voir §3.) |
| 2.9  | `nbSessionsEcoulement`                                        | `previsions.ts:279` (`schemaQualiteModele`)            | `GET /qualite-modele`                   | `QualiteModele.tsx` affiche `tauxRuptureBp` et `tauxInvenduBp` sans jamais montrer sur combien de sessions ils sont mesurés — contrairement à la métrique voisine `mapeGlissanteBp`, dont la taille d'échantillon (`nbSessionsMapeGlissante`) est bien affichée.                                                                                      |
| 2.10 | `evenements[].impactBp` (par événement)                       | `previsions.ts:173-181` (`schemaPrevision`)            | `GET /prevision`                        | `ProchaineSession.tsx:381-389` liste les événements du jour et affiche l'effet COMBINÉ (`facteurs.evenementBp`) ; si plusieurs événements coïncident le même jour, la contribution individuelle de chacun n'est jamais isolée.                                                                                                                        |
| 2.11 | `temperatureRessentieC`, `codeMeteo`, `couvertureNuageuseBp`  | `sessions.ts:312-318` (`schemaMeteoSessionReleve`)     | `GET /sessions/:id`                     | `formaterReleveMeteoSession` (`Sessions.tsx:820-833`) construit l'affichage à partir de `temperatureC`, `precipitationsMm`/`probabilitePluieBp` et `ventKmh` seulement ; le relevé météo figé à la clôture (censé répondre à « qu'annonçait-on ce jour-là, qu'a-t-il fait vraiment ? ») omet le ressenti, le code météo et la couverture nuageuse.    |
| 2.12 | `statutPrecedent`                                             | `stock.ts:314-317` (`schemaStatutLotChange`)           | `PATCH /lots/:lotId/statut`             | Valeur faible : `DetailLot.tsx:264-288` construit son message de confirmation à partir de `lot.statut` (déjà connu côté client) plutôt que de relire `resultat.statutPrecedent` — même information, source différente.                                                                                                                                |

---

## 3. Faux positifs — écartés après vérification

La recherche textuelle en a produit beaucoup ; chacun a été rouvert avant d'être compté ou écarté.

| Champ                                                                                | Pourquoi ce n'est PAS un défaut                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `joursAvantEcheance` (`comptabilite.ts:167`)                                         | `Comptabilite.tsx:408` recalcule le même nombre côté client via `formaterJoursRestants`/`joursEntre` (`packages/core/src/horodatage.ts:71-104`), une fonction PURE partagée qui applique exactement la même formule (`Date.parse` ancré à midi UTC, arrondi). Aucune information perdue — juste une seconde exécution du même calcul, pas une duplication de LOGIQUE MÉTIER divergente.                                                                                                                                                                                                                                   |
| `coutKilometriqueCentsParKm` (`lieux.ts:69`, méta)                                   | Redondant avec `coutKilometriqueLibelle`, une phrase préformatée (« Forfait officiel : 0,4761 €/km. ») explicitement conçue pour être affichée « TELLE QUELLE, jamais reconstruite côté écran » — et c'est bien elle qu'affiche `ComparaisonLieux.tsx:266`. **⚠ Cette ligne était vraie et incomplète** : le MÊME NOM existe dans un second contrat (`opportunites.ts:79`), servi par une autre route, où il n'était PAS lu — `Opportunites.tsx` affichait un coût de déplacement sans jamais dire à quel taux ni de quelle source. Corrigé depuis (`formaterTauxKilometrique`). Voir l'encart « l'homonyme » ci-dessous. |
| `nomMenu` (`menus.ts:119`, `schemaVentilationMenu`)                                  | Le panneau de ventilation (`Menus.tsx:222-932`) s'affiche à l'intérieur de la page détail d'un menu déjà nommé par son propre champ `nom` ; `nomMenu` y est structurellement redondant, jamais une perte d'information pour l'utilisateur.                                                                                                                                                                                                                                                                                                                                                                                |
| `quantite` (`stock.ts:295`, `schemaContrepassationCreee`)                            | `DetailLot.tsx:330` affiche `mouvement.quantite`, déjà connue côté client avant l'appel — même valeur, source différente ; contrairement à `mouvementAnnuleId`/`contrepassationId` du même schéma (§2.7), rien n'est réellement perdu ici.                                                                                                                                                                                                                                                                                                                                                                                |
| `distanceCalculAutomatique.reussi` / `.attribution` (`referentiel.ts:1022-1027`)     | L'obligation d'attribution CC-BY 4.0 est déjà honorée par un texte statique présent sur chaque écran affichant une distance (`LieuxMarche.tsx:137`, `ComparaisonLieux.tsx:47`, `Opportunites.tsx:102`, `Sessions.tsx:292`) — aucun risque de non-conformité de licence malgré ce champ-ci non lu.                                                                                                                                                                                                                                                                                                                         |
| `meteo.facteurBp` (`previsions.ts:25`, `schemaMeteoPrevision`)                       | La valeur réellement affichée (`ProchaineSession.tsx:371`, `formaterFacteur(facteurs.meteoBp)`) vient du champ frère `facteurs.meteoBp` (`previsions.ts:67`), pas de celui-ci — le facteur météo EST montré, juste via l'autre copie.                                                                                                                                                                                                                                                                                                                                                                                     |
| `predicteursPrecision`, `syntheseManqueAGagner` et le reste de `schemaQualiteModele` | Entièrement consommés par `QualiteModele.tsx` (`PanneauPredicteursPrecision`, `PanneauManqueAGagner`, lignes 215-289, 305-430) — le commentaire du contrat (`previsions.ts:222-241`) documentait un défaut du 30/07/2026 déjà refermé au moment de cette vérification.                                                                                                                                                                                                                                                                                                                                                    |
| `notesTechniques` (`referentiel.ts:961-965,987`)                                     | Consommé dans `Recettes.tsx` (occurrences confirmées) — même audit du 30/07/2026 que ci-dessus, déjà câblé.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ecartsStock` (`sessions.ts`, D-037)                                                 | Voir §0 — corrigé par un agent en parallèle pendant la rédaction de cet audit ; reconfirmé câblé par une relecture fraîche de `Sessions.tsx:2483,2570`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 4. Absences délibérées — documentées, pas des défauts

| Champ                                                                                                           | Où c'est documenté                                                                                  | Pourquoi ce n'est pas un défaut                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dateCession` (`comptabilite.ts:122`, `schemaImmobilisationDetail`)                                             | Commentaire `comptabilite.ts:105-121`, `docs/16-AUDIT-COMPTABILITE.md` §5.3, `docs/05-DECISIONS.md` | Toujours `null` : aucune règle réglementaire n'a encore tranché le traitement de l'année de cession (prorata, plus/moins-value). Ouvrir la saisie avant cette décision fabriquerait une convention non demandée (CLAUDE.md §9). |
| `motifStatutLibelle`, `dateChangementStatut`, `nonConformites` (`afsca.ts:352,370`, `schemaTracabiliteAvalLot`) | Commentaire `afsca.ts:337-370` : « DÉFAUT CORRIGÉ (audit du 29/07/2026) »                           | Vérifié à nouveau ici : bien affiché dans `RegistreAfsca.tsx:1605-1617,2182-2201` et dans le PDF (`registre-afsca.ts:468-482`). Le défaut historique est refermé, pas réouvert.                                                 |

---

## 4 bis. Champs MORTS CÔTÉ ÉCRITURE — quatrième catégorie, ajoutée le 31/07/2026 (D-088)

La typologie ci-dessus n'en comptait que trois : défaut réel, absence délibérée, faux positif. La
dernière passe en a trouvé une quatrième, qu'aucune des trois ne décrit correctement.

Ces champs sont **de vrais champs de contrat, correctement calculés, jamais faux** — et **aucun
chemin d'écriture actuel ne leur donne jamais autre chose que leur valeur par défaut** :

| Champ                               | Vaut toujours   | Pourquoi                                                             |
| ----------------------------------- | --------------- | -------------------------------------------------------------------- |
| `dateFinValidite`                   | `null`          | rien ne l'écrit jamais                                               |
| `dateReceptionPrevue`               | `null`          | rien ne l'écrit jamais                                               |
| `genereAutomatiquement` (commandes) | `true`          | aucune route de création manuelle n'existe                           |
| `genereLe` (prévision calendaire)   | « à l'instant » | fixé à `maintenantIso()` à chaque requête, sans cache — tautologique |

**Les câbler les rendrait pires** : un tiret permanent à l'écran ressemble à une donnée manquante
qu'on pourrait saisir. Un champ **non lu** est un défaut d'interface ; un champ **mort côté
écriture** est un défaut d'amont — soit la capacité qui devait le remplir n'a jamais été construite,
soit elle n'existera jamais.

C'est exactement le raisonnement qui a fait remonter **D-087** : `nbMouvementsContrepasses` était
classé « champ non lu », alors qu'il était le symptôme d'une **capacité entière jamais branchée** —
deux routes d'annulation qu'aucun écran n'appelait. Différence de traitement, et elle est nette :
celui-là a été câblé parce que la capacité manquante **devait exister** (§3 règle 7 de `CLAUDE.md`) ;
les quatre ci-dessus ne le sont pas, parce que rien n'établit que la leur doive exister.

**La catégorie ne dit pas quoi faire. Elle dit quelle question poser** : non pas « ce champ est-il
lu ? », qui a une réponse mécanique, mais « qu'est-ce qui empêche cette valeur d'exister ? ».

### Deux angles morts de la méthode, payés en route

**L'homonyme.** La garantie « zéro faux négatif par construction » reposait sur une hypothèse jamais
énoncée : que les noms de champs soient **uniques dans tout le dépôt**. Elle est fausse.
`coutKilometriqueCentsParKm` et `poidsPriorBp` existent chacun dans **deux contrats différents**, et
un champ lu d'un côté blanchissait son homonyme non lu de l'autre. **Comparer des paires (contrat,
champ), jamais des noms nus.**

**Le faux positif narratif.** Un champ peut être **raconté en toutes lettres** dans un texte voisin
sans que son nom n'apparaisse jamais chez les lecteurs. Trois cas confirmés en traçant le code
source : `poidsPriorBp` (×2) — `construireExplication` écrit déjà « L'estimation de départ pèse
encore X %… » — et `longueurRequise`, dont chaque `palier.libelle` généré dit déjà le nombre en
toutes lettres (« Trois sessions solides d'affilée »). **Chercher si l'information est déjà DITE
avant de conclure qu'elle manque.**

---

## 5. Champs non vérifiés — SECTION SOLDÉE LE 31/07/2026

> **Cette section est close.** Elle listait 32 candidats « ni comptés comme défauts, ni blanchis ».
> Une passe finale les a **tous rouverts dans le code courant** — jamais depuis ce document, qui avait
> déjà vieilli : 39 paires (contrat, champ) re-vérifiées, **16 groupes câblés**, **17 dispositions
> écartées avec motif** (réparties entre le §3, le §4 et le §4 bis ci-dessus).
>
> **Ce qui reste ouvert, nommément** — et c'est le seul reste :
>
> - `dernierPrixParProduit` (`Concurrents.tsx`), `prixMoyenParArticleCents` et `volumePateVendueMl`
>   (`Sessions.tsx`) : hors zone d'écriture au moment de la passe, jamais examinés au fond ;
> - `codeMeteo` : **écarté par décision motivée**, pas par manque de temps — c'est un code WMO brut,
>   sans table de traduction nulle part dans le dépôt. L'afficher tel quel serait pire qu'une absence,
>   et construire une table de plus de vingt entrées dépasse le coût d'un champ à câbler.
>
> Le texte d'origine est conservé ci-dessous parce que **la commande qui a produit le reste** y figure,
> et qu'elle reste le point de départ de tout balayage futur.

Sur les 77 candidats réels issus de l'étape 3, **32 n'ont pas été individuellement rouverts** faute
de temps. Ils ne sont ni comptés comme défauts, ni blanchis : `genereAutomatiquement`, `genereLe`,
`horizonMaxJours`, `joursExclusFenetre`, `besoinProjeteFenetre`, `deficit`, `stockProjeteActuel`,
`versionModele` (prévision calendaire/archivage, `previsions.ts`), `volumePateVendueMl`
(`sessions.ts:564`), `recurrence` (`comptabilite.ts:160`), `poidsPriorBp` (`lieux.ts:48`),
`periodeTerminee` (`objectifs.ts:66`), `depenseAnnuleeId`, `factureAnnuleeId`, `objectifAnnuleId`,
`annuleParId` (identifiants de contre-écriture, plusieurs fichiers), `configuree`
(`ia.ts:43`, couvert indirectement par la §1.3 puisque toute la route est déjà comptée), et une
quinzaine d'autres. **Une commande a produit ce reste, pas une intuition** :

```
comm -23 all_fields.txt used_words.txt   # 80 lignes, dont 3 non-champs → 77 candidats réels
# 45 rouverts individuellement (contrat + route + lecteur) → §1, §2, §3, §4
# 32 restants → cette section
```

---

## 6. Dénominateurs

| Mesure                                                                                            | Valeur                                             |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Champs de sortie déclarés dans `packages/core/src/contrats/*.ts` (hors tests), noms uniques       | **658**                                            |
| Identifiants uniques utilisés dans `apps/web/src` + `apps/api/src/documents` (hors tests)         | **9 676**                                          |
| Candidats « jamais un mot dans les deux dossiers-cibles » (`comm -23`)                            | **80**                                             |
| … dont non-champs (paramètre Zod, variables internes)                                             | **3**                                              |
| Candidats réels                                                                                   | **77**                                             |
| Vérifiés individuellement (contrat + route + lecteur ouverts)                                     | **45**                                             |
| — Confirmés **défauts réels** (§1 + §2, comptés par champ ou groupe de champs de la même réponse) | **≈ 34 champs, sur 15 réponses/routes distinctes** |
| — Confirmés **faux positifs** (§3)                                                                | **9**                                              |
| — Confirmés **absences délibérées** (§4)                                                          | **2 groupes de champs**                            |
| Non vérifiés, ni comptés ni blanchis (§5)                                                         | **32**                                             |

Aucune affirmation de ce document ne repose sur une liste tenue à la main sans confrontation à un
fichier réellement ouvert ; chaque défaut de §1/§2 cite un `fichier:ligne` de déclaration, une route
qui le sert, et le fichier consommateur dans lequel l'absence a été vérifiée au moment de l'écriture
de la ligne correspondante.
