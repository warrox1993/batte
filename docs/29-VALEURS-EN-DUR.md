# 29 — Valeurs en dur : ce qui est codé en dur, et ce qui ment

> Mission de **mesure**, pas de correction. Aucune ligne de code n'a été modifiée pour produire
> ce rapport ; seul ce fichier a été écrit. Audit mené le 01/08/2026 sur l'arborescence
> `packages/core`, `packages/db`, `apps/api`, `apps/web` (hors `node_modules`, `dist`, tests).

## 0. Les quatre nombres

| Question posée par la mission                                                           | Réponse                                                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Valeurs en dur qui **doivent** être paramétrables                                       | **9** valeurs distinctes, sur 3 sites de code (voir §3)                                                                   |
| Paramètres du catalogue **jamais lus** hors test                                        | **0 sur 99**                                                                                                              |
| Paramètres lus à un seul endroit alors que **plusieurs écrans posent la même question** | **1 cas confirmé et déjà documenté dans le code lui-même**, + 1 cas adjacent plus faible (voir §4)                        |
| Valeurs du §6 de `CLAUDE.md` **absentes du catalogue**                                  | **1** (le 31 mars du listing clients TVA) — le reste est soit déjà présent, soit correctement modélisé ailleurs (voir §5) |

Le résultat le plus surprenant de cet audit n'est pas le nombre de défauts trouvés : c'est que
**le catalogue de paramètres lui-même est sain** (99/99 lus). Les vrais défauts trouvés sont
ailleurs — dans du code qui n'utilise PAS le catalogue alors qu'il le devrait, ce que la
mission appelle « le paramètre existe, et le code ne le lit pas », mais version pire : ici, le
code contourne carrément la table `parametre`.

---

## 1. Méthode et outillage — un piège rencontré, corrigé, à savoir pour la suite

Cet audit s'appuie sur `rg` (ripgrep) exécuté via l'outil Bash. **Premier essai raté** : `rg`
n'est pas un binaire dans le `PATH` de ce poste — c'est une **fonction bash** définie par le CLI
Claude Code lui-même (`declare -f rg`), qui shell-oute vers l'exécutable Claude en mode
ripgrep intégré. Une fonction bash n'est pas héritée par un `bash script.sh` lancé en
sous-processus : mon premier script d'analyse par paramètre a donc tourné **sans erreur visible
mais avec `rg` introuvable à chaque appel**, produisant silencieusement « 0 appelant » pour les
99 clés du catalogue. Rien de tout cela n'a été rapporté avant vérification : le chiffre « 0
partout » était trop propre pour être vrai, et `bash -x` sur un cas isolé a montré
`bash: line 3: rg: command not found`. Correction : `export -f rg` avant l'exécution, puis
revérification manuelle de plusieurs clés au cas par cas. Je signale ce piège explicitement
parce que la mission cite un piège analogue (l'homonyme, la comparaison de noms nus) : un outil
qui échoue silencieusement est la même famille de défaut qu'une valeur qui ment.

**Portée** : `packages/core/src`, `packages/db/src`, `apps/api/src`, `apps/web/src` — jamais un
sous-répertoire choisi à l'avance. Fichiers `*.test.ts`/`*.test.tsx` exclus du comptage des
« appelants réels » (mais jamais du grep brut, gardé pour le total de référence). Fichiers
d'infrastructure générique exclus aussi du comptage par clé, parce qu'ils manipulent
**n'importe quelle** clé sans en connaître le sens : `packages/core/src/parametres.ts`
(définition), `packages/db/src/seed/parametres.ts` (seed générique, ne redéclare aucune clé),
`packages/db/src/depots/parametres.ts` (dépôt CRUD générique), `apps/api/src/routes/parametres.ts`
(route REST générique), `apps/web/src/pages/Parametres.tsx` (écran générique, ne connaît que la
convention de suffixe `_cents`/`_bp` pour l'affichage — vérifié en lisant le fichier en entier,
828 lignes, aucune clé nommée en dur dans la logique).

---

## 2. Dérivation 2 — paramètres du catalogue jamais lus

**Commande** :

```bash
# 1. Extraction des 99 clés
rg -o "cle: '([a-z0-9_]+)'" packages/core/src/parametres.ts

# 2. Pour chaque clé, fichiers .ts/.tsx (hors node_modules/dist) qui la référencent
#    en littéral de chaîne, hors tests et hors infrastructure générique (liste ci-dessus)
rg -l -F "'<CLE>'" packages apps -g '*.ts' -g '*.tsx' -g '!node_modules' -g '!dist'
```

**Candidats bruts** : 99 clés, chacune recherchée individuellement (script complet dans
`analyse_params.sh`, non commité — travail de mesure). **Bruit écarté** : occurrences dans les
6 fichiers d'infrastructure listés en §1, et dans tout fichier `*.test.ts`/`*.test.tsx` (la
règle de la mission : « un appelant qui est un test n'est pas un appelant »).

**Retenus** : **les 99 clés ont au moins un appelant réel hors test et hors infrastructure.**
Aucune à zéro. Exemples de lecture typée confirmée à la main pour clôturer le doute sur les cas
les plus exotiques :

- `afsca_motifs_incident_sanitaire_json` (type `json`) — lu via `.texte()` puis `JSON.parse` dans
  `packages/db/src/services/mouvements.ts:394`, pas via une méthode `.json()` dédiée (la classe
  `Parametres` n'en a pas).
- `prevision_vacances_scolaires_be_json` — même patron, `packages/db/src/depots/previsions.ts:450`.
- `adresse_depart_defaut` (valeur par défaut vide `''`, volontairement) — lu dans
  `apps/api/src/routes/referentiel-ecriture.ts`.
- Les six clés `ia_tarif_*` et `ia_modele_*` — chacune a un lecteur unique dans
  `packages/core/src/ia.ts`, centralisé (bonne pratique : un seul calcul de coût, pas cinq copies).

Ce résultat contredit ma propre attente de départ (la mission annonce un cas déjà trouvé
d'incohérence par paramètre non lu ailleurs) : je le signale comme un **fait vérifié deux fois**
(le premier passage, faussé par le bug d'outillage du §1, avait produit « 0 partout » pour une
mauvaise raison — je ne voulais pas répéter la même erreur dans l'autre sens en annonçant
« tout est lu » sans un second passage propre).

---

## 3. Dérivation 1 — nombres magiques dans le calcul métier

**Commandes** (répertoire de recherche : `packages/core/src packages/db/src apps/api/src
apps/web/src`, jamais restreint à un sous-dossier) :

```bash
# a) valeurs par défaut de paramètre de fonction — la forme la plus trompeuse
rg -n '\w+\s*(\??)\s*(:\s*[A-Za-z0-9_<>\[\], ]+)?\s*=\s*-?[0-9][0-9_.]*\s*[,)]' \
   -g '*.ts' -g '*.tsx' -g '!*.test.ts' -g '!*.test.tsx' -g '!node_modules' -g '!dist' \
   packages/core/src packages/db/src apps/api/src apps/web/src

# b) comparaisons numériques (seuils potentiels), 0 et 1 exclus (bruit structurel)
rg -n '[<>]=?\s*[0-9]+(\.[0-9]+)?\b|\b[0-9]+(\.[0-9]+)?\s*[<>]=?' \
   -g '*.ts' -g '*.tsx' -g '!*.test.ts' -g '!*.test.tsx' -g '!node_modules' -g '!dist' \
   -g '!*/contrats/**' packages/core/src packages/db/src apps/api/src apps/web/src

# c) mots-clés métier + littéral numérique adjacent
rg -n '\b(seuil|plafond|minimum|maximum|delai|horizon|marge|taux|capacite|quantile|coefficient|
       facteur|pente|ratio|tarif|tolerance|franchise|cotisation)\w*\s*[:=]\s*[0-9]' \
   -g '*.ts' -g '*.tsx' -g '!*.test.ts' -g '!*.test.tsx' -g '!node_modules' -g '!dist' \
   packages apps

# d) défauts de colonne suspects dans le schéma
rg -n '\.default\(' packages/db/src/schema.ts
```

### Bruit écarté (vérifié un par un, pas supposé)

- **Codes HTTP** : `ia.ts:267` (`statut >= 500`), `plugins/erreurs.ts:136` (`>= 400 && < 500`),
  `erreurs.ts:27` (`?? 422`).
- **Conversions universelles** : `unites.ts:86,90` (`>= 1000` g→kg, ml→L), `energie.ts:143`
  (`/60/1000`, minutes→heures, W→kW), `horodatage.ts` (`3_600_000`, `86_400_000` — ms).
- **Constantes mathématiques d'un algorithme numérique**, pas des règles métier :
  `prevision/statistiques.ts` — approximation d'Acklam (quantile normal) et algorithme de Hart
  (répartition normale), coefficients à 15 décimales, bornes `37` et `7.071...` qui sont des
  limites de précision flottante, pas des seuils métier. Un commentaire du fichier le dit
  lui-même : « aucun seuil de décision ne s'appuie sur ces deux points ».
- **Identité mathématique, pas un seuil** : `deplacement.ts` — « distance réelle < 2 × la
  référence » : le `2×` vient de ce qu'une distance de référence est **aller simple** et un
  trajet réel est **aller-retour** ; ce n'est pas un coefficient à régler, c'est une définition.
- **Élément neutre, pas un réglage** : `sessions.ts:740` (`volumePateVendueMl = 0`, l'absence de
  vente directe de pâte), `schema.ts` (la quasi-totalité des `.default(0)`/`.default(1)` sur des
  colonnes numériques — le neutre additif ou multiplicatif de leur propre calcul, pas un chiffre
  métier caché). Vérifié colonne par colonne dans `packages/db/src/schema.ts`.
- **Palier de jeu, explicitement pas un seuil légal** : `packages/core/src/succes.ts`
  (`JOURS_ANTICIPATION_PALIERS`, `PALIERS_NIVEAU_CA`, `PALIERS_NIVEAU_ANCIENNETE` — 30/60/90
  jours, paliers de CA cumulé 1 000 à 200 000 €, paliers d'ancienneté 5 à 200 sessions). Le
  fichier justifie lui-même l'exclusion : « des ronds de jeu, jamais un seuil légal », et
  distingue explicitement le contexte réglementaire réel (`seuil_franchise_tva_cents`),
  recalculé À CÔTÉ par `packages/db/src/depots/objectifs.ts`, jamais recopié ici. **Décision
  déjà motivée dans le code** — je la classe « devrait » au mieux (des paliers modifiables
  seraient un confort, jamais une obligation), pas « doit ».
- **Défaut de pagination d'écran**, pas un seuil métier : `packages/db/src/depots/ia.ts:81`
  (`listerAppelsIa(base, limite = 100)`) et `affichage.ts` (`decimales = 0`/`decimales = 1`,
  précision d'affichage). Tier « ne doit pas » — aucun tiers externe n'impose ces chiffres.
- **Constante de sécurité technique**, pas métier : `packages/db/src/services/factures.ts:171`
  (signatures d'octets MIME, longueur de préfixe décodé) — vérification anti-usurpation de type
  de fichier, sans lien avec une règle métier ou réglementaire.

### Retenus — 9 valeurs, 3 sites de code

Détail complet et tri par coût en §6. Localisation précise ici :

1. `packages/core/src/horodatage.ts:98` — `formaterJoursRestants(echeance, aujourdHui,
horizonJours = 14)`.
2. `apps/web/src/pages/Comptabilite.tsx:537` — `formaterJoursRestants(l.prochaineDate,
aujourdHui(), 60)`.
3. `packages/core/src/comptabilite.ts:320` — `PAS_ANNEES.quinquennale = 5` (années).
4. à 7. `packages/core/src/comptabilite.ts:374-429` — `CATALOGUE_ECHEANCES`, quatre ancrages de
   date réglementaire codés en dur : `'03-31'` (listing TVA), le groupe
   `'04-10'`/`['07-10','10-12','12-21']` (quatre échéances INASTI, comptées comme une seule
   entrée de code), `'03-02'` (contribution AFSCA), `'12-15'` (formulaire e604B).
5. `packages/core/src/comptabilite.ts:403` — montants de la contribution AFSCA (« 102,71 € »,
   « 51,36 € ») présents **uniquement en prose**, dans `sourceLegale`.
6. `packages/core/src/comptabilite.ts:424-425` — plafond de tolérance du formulaire e604B
   (« 27 500 € », et un rappel du seuil de franchise « 25 000 € ») également en prose seule.

---

## 4. Dérivation 3 — même question, deux réponses

**Commande** : pour chaque fonction transversale identifiée (`formaterJoursRestants`,
`listerEcheances`), recherche de tous les appelants avec leurs arguments :

```bash
rg -n "formaterJoursRestants" -g '*.ts' -g '*.tsx'
```

### Cas confirmé, et déjà documenté dans le code lui-même

`formaterJoursRestants` (`packages/core/src/horodatage.ts:95-104`) répond à « dans combien de
jours cette DLC tombe-t-elle ? ». Deux implémentations concurrentes de la même question :

| Question                                                            | Mécanisme                                                                                                                           | Horizon      | Appelants                                                                                                                   |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| DLC proche, dans le **brief avant-marché**                          | `parametres.entier('brief_horizon_alerte_dlc_jours')` → `lotsAlerteDlc` (requête SQL dédiée, `packages/db/src/depots/stock.ts:385`) | **7 jours**  | `apps/api/src/routes/previsions.ts:1400,1498`                                                                               |
| DLC proche, sur les **écrans** Stock / Production / Tableau de bord | `formaterJoursRestants(dlc, jour)` **sans 3ᵉ argument** → défaut codé en dur `= 14`                                                 | **14 jours** | `apps/web/src/pages/Stock.tsx:281`, `apps/web/src/pages/Production.tsx:215,229`, `apps/web/src/pages/TableauDeBord.tsx:706` |

`apps/api/src/documents/gabarits.ts:536-543` contient un commentaire qui **décrit exactement ce
tableau**, avant que ce rapport n'existe : « l'écran Stock utilise un défaut DIFFÉRENT (14
jours...) : à la même seconde sur la même base, les deux auraient pu annoncer des comptes
différents sans qu'aucun des deux ne dise pourquoi ». `TableauDeBord.tsx:707-711` documente la
même chose dans l'autre sens, en présentant le **14 codé en dur** comme une garantie de
cohérence entre écrans web — ce qui est vrai **entre eux**, faux **face au brief imprimé**.
C'est très exactement le défaut que `brief_horizon_alerte_dlc_jours` (7, modifiable dans l'écran
Paramètres) ne corrige qu'à un quart : le porteur peut changer 7 → 3, le brief avant-marché
réagira, **les trois écrans web ne bougeront pas d'un jour**.

### Cas adjacent, plus faible — à ne pas confondre avec le précédent

`echeance_horizon_alerte_jours` (valeur 30, paramétrée et lue une seule fois dans
`packages/db/src/depots/comptabilite.ts:609`, pour calculer le drapeau `alerteProche` consommé
ensuite par `TableauDeBord.tsx` ET `Comptabilite.tsx` — **centralisation correcte**, pas un
défaut). Mais `Comptabilite.tsx:537` tronque l'AFFICHAGE du compte à rebours à **60 jours**
(un `formaterJoursRestants(..., 60)` codé en dur), sans lien avec le seuil d'alerte de 30. Les
deux ne répondent pas exactement à la même question (« faut-il colorer la ligne en alerte » vs
« jusqu'à quand afficher un compteur de jours »), donc ce n'est pas la même duplication que le
cas ci-dessus — mais c'est tout de même un chiffre de coupure choisi sans paramètre, à côté d'un
paramètre qui, lui, existe pour une notion voisine.

Je n'ai pas trouvé d'autre cas de ce type après vérification ciblée de : stock de sécurité
(centralisé via `reappro_*`), température chaîne du froid (un seul lecteur, aucun écran ne
recalcule un seuil de 7 °C en parallèle — vérifié dans `RegistreAfsca.tsx`), délais de nettoyage
AFSCA (un seul lecteur), coût kilométrique (trois lecteurs, mais du **même** paramètre à chaque
fois, jamais une valeur recopiée).

---

## 5. Dérivation 4 — les valeurs du §6 face au catalogue

| Valeur du §6                                              | Présente dans `parametre` ?                                                                                                                                                                                                    | Constat                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recette R1 (145 g farine, 240 ml lait, ... 66 crêpes/5 L) | Non — **et c'est correct** : modélisée comme donnée de domaine versionnée (tables `recette`/`ligne_recette`), éditable en entier via l'écran Recettes (docs/demandes/04). Une recette n'est pas un scalaire, c'est une entité. | Absence justifiée                                                                                                                                            |
| Recette R2 (68 crêpes/5 L)                                | Idem                                                                                                                                                                                                                           | Absence justifiée                                                                                                                                            |
| Coût matière R1 ≈0,33 €, R2 ≈0,41-0,45 €                  | Non — **et c'est correct** : ce sont des sorties CALCULÉES depuis les lignes de recette et les prix d'achat, jamais des constantes à stocker.                                                                                  | Absence justifiée                                                                                                                                            |
| Session type (6 h 30, 838 €, 2 h 16, 134 crêpes)          | Partiellement : `capacite_cuisson_crepes_par_heure = 60` **est** le paramètre dont ce calcul dérive, avec cette phrase du §6 comme `source` littérale.                                                                         | Le paramètre d'entrée existe ; 838 €/134/2h16/6h30 sont des sorties illustratives, jamais utilisées comme constantes ailleurs dans le code — rien à corriger |
| SumUp 1,69 %                                              | Oui — `taux_commission_sumup_bp = 169`                                                                                                                                                                                         | Conforme                                                                                                                                                     |
| Seuil franchise TVA 25 000 €                              | Oui — `seuil_franchise_tva_cents`                                                                                                                                                                                              | Conforme                                                                                                                                                     |
| Seuil Airbag 23 000 €                                     | Oui — `seuil_airbag_cents`                                                                                                                                                                                                     | Conforme                                                                                                                                                     |
| Seuil cotisation réduite 17 374,08 €                      | Oui — `seuil_cotisation_reduite_cents`                                                                                                                                                                                         | Conforme                                                                                                                                                     |
| Listing clients TVA au **31 mars**                        | **Non.** Codé en dur : `jourReference: '03-31'` dans `CATALOGUE_ECHEANCES` (`packages/core/src/comptabilite.ts:378`), sans `dateDebutValidite`, sans mécanisme de mise à jour des lignes déjà semées (voir §3 et §6).          | **Absente du catalogue**                                                                                                                                     |

**1 valeur sur l'ensemble des références chiffrées du §6** est donc réellement absente là où
elle devrait être : le 31 mars. Toutes les autres sont soit déjà présentes, soit correctement
absentes parce qu'elles vivent ailleurs dans une structure plus appropriée (recette versionnée)
ou parce que ce sont des résultats calculés et non des entrées.

---

## 6. Les valeurs qui doivent être paramétrables — triées par ce que ça coûte

### 1. `CATALOGUE_ECHEANCES` et `PAS_ANNEES` — `packages/core/src/comptabilite.ts`

**Le plus coûteux, et le plus insidieux**, parce qu'il se présente déjà comme une table de
référence disciplinée (chaque entrée porte un champ `sourceLegale`, le fichier affirme
lui-même : « comme pour les seuils, la SOURCE accompagne chaque échéance ») **sans posséder le
seul mécanisme qui rend une source vérifiable dans ce projet : une `dateDebutValidite` et un
chemin de correction sans recompilation.**

- `PAS_ANNEES.quinquennale = 5` fixe la périodicité légale de renouvellement de l'autorisation
  d'activités ambulantes. Si la Wallonie passe ce cycle à 10 ans, **rien dans l'application ne
  peut être corrigé sans changer ce fichier TypeScript et redéployer.**
- Les quatre échéances du catalogue portent chacune une date fixée par un tiers externe
  (SPF Finances : 31 mars ; caisse d'assurances sociales INASTI : 10 avril / 10 juillet /
  12 octobre / 21 décembre ; AFSCA : 2 mars ; SPF Finances de nouveau : 15 décembre). Ce sont
  très exactement les « taux, seuils ou montants réglementaires » du §7.
- **Pire que le cas générique** : `packages/db/src/depots/comptabilite.ts:556-600`
  (`seedEcheances`) **insère si absent, ne met jamais à jour** une ligne déjà semée. Contraste
  avec `seedParametres` (`packages/db/src/seed/parametres.ts`), qui **resynchronise**
  description/source/type à chaque exécution. Une base déjà initialisée ne rattrapera donc
  jamais une correction de ce fichier sur les champs `recurrence`/`joursSupplementaires` déjà
  écrits en base — seul `marquerEcheanceFaite` relit le catalogue en direct, et seulement au
  moment où l'utilisateur coche « faite ».
- Les montants de la contribution AFSCA (102,71 € / 51,36 €) et le plafond de tolérance e604B
  (27 500 €) n'existent qu'en **prose** dans `sourceLegale` : aucune colonne numérique ne les
  porte, ils ne nourrissent aucun calcul (vérifié : `estimerMontantEcheance` ne lit que la
  saisie manuelle de l'utilisateur), mais un texte qui devient faux ne le signale à personne —
  contrairement à un paramètre du catalogue, qui a une date de validité consultable.

**Coût le jour où c'est faux** : un porteur qui se fie au registre `parametre` pour ses seuils
mais qui n'a **aucune raison de suspecter** que les dates et cycles de son échéancier fiscal
vivent ailleurs, dans un fichier qu'il ne consultera jamais depuis l'écran Paramètres. Une
échéance ratée par un décalage de date non répercuté a un coût direct (majoration INASTI,
citée par le code lui-même comme risque).

### 2. `formaterJoursRestants(..., horizonJours = 14)` — `packages/core/src/horodatage.ts:98`

Détaillé en §4. **Coût** : trois écrans (Stock, Production, Tableau de bord) et un document
imprimé (brief avant-marché) répondent différemment à « cette DLC est-elle proche ? » — 14
jours contre 7. Le porteur qui resserre `brief_horizon_alerte_dlc_jours` à 3 jours pour être
plus réactif **verra le changement nulle part sur ses écrans quotidiens**, seulement sur le
document imprimé le samedi soir. C'est exactement le patron « le paramètre existe, il se modifie,
il ne fait rien (ici) » que la mission demande de traquer — sauf qu'il ne « ment » qu'aux trois
quarts : il fonctionne, mais seulement pour un quart des lecteurs de la question qu'il est censé
gouverner.

### 3. Le littéral `60` — `apps/web/src/pages/Comptabilite.tsx:537`

Coupure d'affichage du compte à rebours des échéances légales, sans lien avec le seuil d'alerte
`echeance_horizon_alerte_jours` (30) qui, lui, gouverne correctement la mise en évidence de la
ligne. Coût plus faible que les deux précédents : aucune conséquence réglementaire directe,
seulement une incohérence de confort si quelqu'un aligne un jour les deux nombres en tête et se
demande pourquoi ils diffèrent.

---

## 7. Les paramètres qui mentent — nommément

Au sens strict de la mission (« présents, modifiables, sans effet ») : **aucun** des 99
paramètres du catalogue n'est dans ce cas — voir §2, revérifié après correction du bug d'outillage
du §1.

Mais le sens **pratique** de « paramètre qui ment » — modifiable, avec un effet visible sur UNE
SEULE des questions qu'il devrait gouverner, silencieux sur les autres — s'applique à un
paramètre nommément :

> **`brief_horizon_alerte_dlc_jours`** — modifiable dans l'écran Paramètres, son effet réel est
> intégralement confiné à la génération du brief avant-marché
> (`apps/api/src/routes/previsions.ts:1400,1498`). Un porteur qui le règle en pensant ajuster
> « l'alerte DLC » en général constatera que Stock, Production et le Tableau de bord continuent
> d'appliquer un horizon de 14 jours qui n'a jamais consulté ce paramètre — parce que ce n'est
> pas ce paramètre qu'ils lisent, c'est une valeur par défaut de fonction codée à
> `packages/core/src/horodatage.ts:98`.

Aucun autre candidat trouvé à ce jour selon ce critère élargi (paramètre à effet partiel plutôt
que paramètre à effet nul).

---

## 8. Ce que ma méthode ne couvre pas

Cette section conditionne la confiance à accorder au reste du rapport.

1. **Détection par littéral de chaîne uniquement.** Toute clé de paramètre construite
   dynamiquement (concaténation, variable non-littérale passée à `.entier()`/`.texte()`/etc.)
   échapperait à `rg -F "'<CLE>'"`. J'ai vérifié à la main le seul patron de ce type trouvé
   (`entierAvecRepli(parametres, cle, repli)` dans `backtest.ts`/`previsions.ts`) : dans les
   deux cas, la clé y est toujours un littéral de chaîne au site d'appel. Je n'ai pas de preuve
   qu'il n'existe aucun autre patron de ce genre ailleurs — seulement que je l'ai cherché et
   qu'il n'est pas apparu dans mes autres grep.

2. **Recherche de nombres magiques par mot-clé et par motif de comparaison, pas par lecture
   exhaustive.** `apps/web/src/pages` compte une quarantaine de fichiers ; je n'ai pas lu chaque
   fichier ligne à ligne. Un nombre métier caché dans une expression que mes regex ne couvrent
   pas (par exemple un calcul réparti sur plusieurs lignes, ou une valeur construite par
   template literal) peut m'avoir échappé. Les regex utilisées (défauts de paramètre de
   fonction, comparaisons, mots-clés+nombre) couvrent les formes les plus courantes, pas
   toutes les formes possibles.

3. **Docs et migrations SQL non pris comme terrain d'audit à part entière.** J'ai vérifié
   `packages/db/src/schema.ts` (valeurs `.default(...)`) mais pas le contenu des 29 fichiers de
   migration `packages/db/drizzle/*.sql` ni les snapshots `meta/*.json`, qui pourraient contenir
   des valeurs par défaut historiques désormais divergentes du schéma actuel — improbable
   (Drizzle régénère les migrations depuis le schéma), non vérifié directement.

4. **Aucune vérification à l'exécution.** Tout ce rapport est de l'analyse statique. Je n'ai
   lancé ni serveur ni test (interdit par la mission, respecté) : je n'ai donc aucune preuve
   d'exécution que, par exemple, `formaterJoursRestants` produit bien des comptes différents en
   pratique sur les mêmes données — seulement la preuve textuelle que le code appelle la
   fonction avec des arguments différents.

5. **Le tri en trois classes (doit/devrait/ne doit pas) reste un jugement, pas une mesure.**
   J'ai motivé chaque classement (voir §3, bruit écarté), mais la frontière entre « devrait »
   et « doit » pour un cas comme les montants AFSCA en prose (§6 point 1) est discutable : ils
   ne nourrissent aucun calcul aujourd'hui, donc leur défaut de mise à jour ne casse rien
   silencieusement — seulement un texte affiché qui devient faux sans avertissement. Un lecteur
   pourrait légitimement les classer « devrait » plutôt que « doit ». Je les ai mis dans le même
   site que les dates réglementaires (`doit`) parce qu'ils partagent le même défaut structurel
   (aucune date de validité, aucune resynchronisation), pas parce que leur impact direct est
   aussi grave que les dates elles-mêmes.

6. **Aucune revérification croisée avec un tiers humain.** Les seules garanties de non-double
   comptage et de non-homonymie sont les miennes : chaque candidat cité porte un chemin de
   fichier et un numéro de ligne précis, vérifiable directement, mais je n'ai pas fait relire ce
   rapport par un second passage indépendant.

7. **Documents (`docs/*.md`) traités comme contexte, jamais comme vérité.** Conformément à la
   consigne, aucun verdict d'un document existant n'a été repris sans revérification dans le
   code courant : chaque affirmation de ce rapport cite un fichier et une ligne de code
   actuels, pas une ligne de doc.
