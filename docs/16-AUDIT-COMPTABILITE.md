# 16 — Audit de la comptabilité et des seuils légaux

> Périmètre : `packages/core/src/comptabilite.ts`, la partie « seuils » de
> `packages/core/src/sessions.ts`, `packages/db/src/depots/comptabilite.ts`,
> `packages/db/src/depots/sessions.ts` (lecture seule), `apps/api/src/routes/comptabilite.ts`
> et le module d'amortissement.
>
> **Règle appliquée à tout ce document.** Aucune donnée réglementaire n'a été inventée, corrigée
> ni « ajustée ». Un taux, un seuil ou une date qui paraît faux est **signalé**, jamais réécrit —
> un chiffre réglementaire faux dans une base se relit ensuite comme une donnée établie
> (`CLAUDE.md` §7). Les corrections apportées ne portent que sur de la **logique de calcul**.

---

## 1. Réponse à la question posée en premier

**Non, le troisième seuil n'est pas juste. Il compare un chiffre d'affaires à un seuil de revenu
net.**

`packages/core/src/parametres.ts` décrit la clé sans ambiguïté :

> `seuil_cotisation_reduite_cents` — « **Revenu net** annuel au-delà duquel le régime de cotisation
> réduite du complémentaire est perdu. »

`packages/db/src/depots/sessions.ts` lui passe pourtant un CA, exactement comme aux deux autres :

```ts
const compteur = projeterSeuil({
  cle: definition.cle,
  realiseCents: caTotalCents,   // ← un CA, pour les TROIS seuils
  plafondCents: parametres.centimes(definition.cle),
  …
});
```

Le plus parlant : le champ **`assiette` est déjà déclaré** sur les trois entrées de `SEUILS`
(`'total' as const`) et **n'est lu nulle part**. L'intention de distinguer les assiettes était là ;
le câblage manque.

### Le calcul qui le démontre

Aux chiffres de référence de `CLAUDE.md` §6 — session type à 838 € de CA, 134 crêpes, coût matière
0,33 €/crêpe, matériel 3 500 € amorti sur 5 ans, taux du catalogue (INASTI 20,50 %, IPP marginal
40 %) :

| Grandeur                                           | Valeur      | Part du seuil 17 374,08 €     |
| -------------------------------------------------- | ----------- | ----------------------------- |
| CA au bout de 21 sessions (ce que le code compare) | 17 598,00 € | **101,3 %** → « dépassement » |
| Revenu net estimé sur le même exercice             | 7 617,40 €  | **43,8 %** → conforme         |

**Écart : 9 980,60 €. Facteur 2,31.** Le compteur affiche 101 % quand la grandeur que le seuil
gouverne réellement est à 44 %.

### Sens de l'erreur

Le revenu net est toujours **inférieur** au CA (les dépenses sont positives). L'alerte ne peut donc
**pas** arriver trop tard : elle arrive **beaucoup trop tôt**, environ 2,3 fois trop tôt. Ce n'est
pas dangereux au sens fiscal, c'est pire à l'usage — un compteur qui crie « dépassement » chaque
année alors que la réalité est à 44 % est un compteur que l'utilisateur apprend à ignorer, et le
jour où l'un des deux **vrais** compteurs de CA passe au rouge, il sera ignoré aussi.

### Le correctif, prêt à coller

Dans `packages/db/src/depots/sessions.ts` — fichier hors de mon périmètre d'écriture.

```ts
// 1. La troisième entrée de SEUILS déclare enfin sa vraie assiette :
  {
    cle: 'seuil_cotisation_reduite_cents',
    libelle: 'Cotisation réduite',
    assiette: 'revenu_net' as const,   // ← était 'total'
    source: …inchangé…
  },

// 2. tableauSeuils lit le revenu net une fois, en tête de fonction :
import { syntheseExercice } from './comptabilite.js';
…
const netEstimeCents = syntheseExercice(base, annee).netEstimeCents;

// 3. …et choisit l'assiette au lieu de l'ignorer :
    realiseCents: definition.assiette === 'revenu_net' ? netEstimeCents : caTotalCents,
```

`syntheseExercice` calcule **déjà** exactement cette grandeur (`estimerResultat().netEstimeCents`,
`@batte/core`) : aucun calcul nouveau, aucune valeur réglementaire touchée.

Le test `packages/db/src/comptabilite-seuils-et-audit.test.ts` encode le défaut en `it.fails`.
**Il passera au rouge le jour du correctif** : retirer alors le `.fails`.

> **Mise à jour du 30/07/2026 — corrigé.** `docs/17-VINGT-AMELIORATIONS.md` §2 donne ce point corrigé
> par **D-054** (« Chaque seuil légal est confronté à SON assiette »). Cohérent avec le code : un
> grep sur tout le dépôt ne trouve plus qu'un seul `it.fails(` actif, dans
> `packages/db/src/audit-annulations.test.ts:625` (sur un sujet différent, `annulerReception`) — le
> `.fails` de `comptabilite-seuils-et-audit.test.ts` a bien été retiré comme annoncé ci-dessus.
>
> **Second correctif, plus tardif dans la même nuit** : ce dernier `it.fails` restant
> (`annulerReception` non joignable depuis une route) est lui aussi retiré. `annulerReception` est
> désormais exportée par `packages/db/src/index.ts:326` et exposée par
> `POST /api/receptions/:id/annuler` (`apps/api/src/routes/stock.ts:234`) ; le test correspondant
> (`packages/db/src/audit-annulations.test.ts:609-634`) documente lui-même la conversion — « Ce
> test était un `it.fails` (…) le câblage a été fait le 30/07/2026, ce qui a fait ÉCHOUER l'`it.fails`
> ». Un grep sur `it\.fails(` (l'invocation, pas la mention en prose) sur tout le dépôt ne renvoie
> **plus aucun résultat**.

---

## 2. L'alerte à 80 % du seuil n'existe pas

`CLAUDE.md` §6 : « **alerte à 80 % du seuil** ». Vérifié dans le code :

| Élément                                            | État                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `seuil_alerte_bp` = 8000                           | présent au catalogue, **lu par aucun code de production**        |
| `statutParPlafond(valeur, plafond, seuilAlerteBp)` | écrite, testée, **appelée nulle part**                           |
| `TableauDeBord.tsx:305`                            | `statut = seuil.depassementProjete ? 'depassement' : 'conforme'` |

L'état `'alerte'` — le triangle ▲ — **n'est jamais atteignable sur un seuil légal**. Le compteur
est binaire : vert, ou rouge une fois la projection au-delà du plafond.

**Conséquence chiffrée.** En fin d'année, `sessionsTenues` rejoint
`seuils_sessions_prevues_par_an`, donc `projection == réalisé`. Un utilisateur à **21 250 € de CA**,
soit **85 % du seuil de franchise TVA**, voit « **● 85 %** » en vert, statut « conforme ». Il lui
reste **3 750 €** avant de sortir de la franchise, et rien ne le lui dit. C'est très exactement le
scénario que `CLAUDE.md` §6 décrit comme à éviter : « se retrouver hors franchise TVA sans l'avoir
vu venir ».

**Second effet, plus net encore.** `depassementProjete` ne regarde **que** la projection :

```ts
return (
  compteur.projectionFinAnneeCents !== null &&
  compteur.projectionFinAnneeCents >= compteur.plafondCents
);
```

Sous deux sessions, la projection vaut `null` (à raison), donc `depassementProjete` vaut `false` —
**même si le réalisé dépasse déjà le plafond**. Le tableau de bord affiche alors « conforme » sur un
seuil franchi. `Sessions.tsx` s'en tire mieux : il écrit « Historique insuffisant ».

**Correctif proposé** — `packages/core/src/sessions.ts`, hors de mon périmètre :

```ts
export function depassementProjete(compteur: CompteurSeuil): boolean {
  // Un plafond DÉJÀ franchi est un dépassement, projection ou pas : sous deux
  // sessions la projection vaut null, et le réalisé était alors ignoré.
  if (compteur.realiseCents >= compteur.plafondCents) return true;
  return (
    compteur.projectionFinAnneeCents !== null &&
    compteur.projectionFinAnneeCents >= compteur.plafondCents
  );
}
```

Et, côté écran, remplacer le ternaire de `TableauDeBord.tsx:305` par
`statutParPlafond(seuil.realiseCents, seuil.plafondCents, seuilAlerteBp)`, en réservant
`'depassement'` au cas `depassementProjete`. Le palier doit venir de `seuil_alerte_bp` lu en base,
jamais d'un littéral.

> **Mise à jour du 30/07/2026 — corrigé, quasiment au mot près du correctif proposé ci-dessus.**
> `depassementProjete` (`packages/core/src/sessions.ts:575`) teste désormais `compteur.realiseCents
>
> > = compteur.plafondCents`avant de regarder la projection — le second effet décrit ci-dessus est
refermé.`statutParPlafond`est appelée par`statutSeuil` (`packages/core/src/sessions.ts:448`),
qui combine explicitement les deux signaux (« `statutParPlafond`regarde le réalisé, la projection
regarde la trajectoire », commentaire`:440-446`) ; `statutSeuil`est à son tour appelée par`apps/web/src/pages/TableauDeBord.tsx:449`et`apps/web/src/pages/Objectifs.tsx:59`, en lisant
`seuilAlerteBp`en base plutôt qu'un littéral. L'alerte à 80 % est donc atteignable aujourd'hui.
Voir aussi`docs/13-AUDIT-CAPACITES-ORPHELINES.md` §5.1, qui documente indépendamment le même
> > correctif côté « fonction sans appelant de production ».

---

## 3. Ce qui est juste, vérifié par le calcul

| Point vérifié                                               | Verdict                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ventilation transformé / revendu reconstitue le total       | ✅ garanti par construction : `totaliserVentes` ajoute chaque ligne au total ET à exactement un des deux ; les trois colonnes sont écrites dans le même `INSERT` à la clôture. Aucun autre chemin d'écriture ne renseigne ces colonnes (le seed de démonstration n'insère que des sessions `planifiee`). Un test le fige désormais côté lecture |
| Projection refusée sous 2 sessions                          | ✅ `projeterSeuil` : `sessionsTenues < 2 → null`                                                                                                                                                                                                                                                                                                |
| Rythme lu depuis `seuils_sessions_prevues_par_an`           | ✅ lu dans `tableauSeuils`, à la même date que les plafonds (D-040)                                                                                                                                                                                                                                                                             |
| Sessions annulées exclues des seuils **et** de la synthèse  | ✅ les deux filtrent `statut = 'cloturee'`                                                                                                                                                                                                                                                                                                      |
| Les trois seuils sont dans `parametre`, avec source et date | ✅ aucun seuil en dur ; `seuil_alerte_bp` aussi, même s'il n'est pas lu                                                                                                                                                                                                                                                                         |
| Listing clients TVA au 31 mars, « même à zéro »             | ✅ présent dans `CATALOGUE_ECHEANCES`, avec la mention                                                                                                                                                                                                                                                                                          |
| Somme des annuités = montant amortissable                   | ✅ balayage exhaustif 1–40 c × 1–20 ans, linéaire et dégressif ; défaut « montants dérisoires » bien fermé                                                                                                                                                                                                                                      |
| Mention « ne remplace pas un comptable »                    | ✅ `Comptabilite.tsx:945`, au-dessus de la synthèse                                                                                                                                                                                                                                                                                             |
| Argent en entiers dans les calculs comptables               | ✅ aucune division flottante persistée : `Math.round(amortissable / durée)`, `appliquerPointsDeBase`, `montantDeductible` et `estimerResultat` rendent tous des entiers ; les seuls quotients fractionnaires (`partBp`, projection) sont arrondis avant sortie                                                                                  |

---

## 4. Défauts corrigés

### 4.1 La dépense immobilisée était déduite DEUX fois — le plus coûteux

`syntheseExercice` additionnait, pour un même exercice, **toutes** les dépenses déductibles **et**
toutes les annuités d'amortissement. Or `depense.immobilisation_id` existe précisément pour dire
« cette dépense est l'achat d'un bien immobilisé ».

**Le calcul.** Matériel 3 500 €, saisi en dépense (catégorie `materiel`, 100 % déductible) et
immobilisé sur 5 ans :

```
charge déduite = 3 500 €  (dépense, exercice 1)
               + 5 × 700 € (annuités, exercices 1 à 5)
               = 7 000 €   pour un bien de 3 500 €
```

**3 500 € de charge fantôme.** Aux taux du catalogue (20,50 % de cotisations puis 40 % d'IPP sur le
reliquat), cela minore les cotisations et l'impôt estimés de **1 830,50 €**. `CLAUDE.md` §7 interdit
de produire un chiffre qui minore ce qui est dû.

**Correction.** Nouvelle fonction pure `montantDeductibleCharge` dans `@batte/core` : une ligne
rattachée à une immobilisation rend **0 € de charge**, sa déduction passant intégralement par le
plan. Elle est utilisée par `totaliserJournal`, par `listerDepenses` (la ligne affiche 0 €
déductible, sans masquer le décaissé) et par `syntheseExercice`. Une seule règle, trois appelants.
`totaliserJournal` rend en plus `montantImmobiliseCents`, pour que l'écran puisse **expliquer**
l'écart entre le décaissé et le déductible au lieu de le laisser passer pour une erreur de saisie.

Le journal `GET /api/depenses` se corrige tout seul : son `montantDeductibleTotalCents` somme les
`montantDeductibleCents` de `listerDepenses`.

### 4.2 `depense.immobilisation_id` n'était contrôlé par rien

La colonne ne porte **aucune clé étrangère** (`schema.ts:1317`, contrairement à `fournisseur_id`).
Un identifiant fantaisiste était accepté en silence — et depuis 4.1, ce champ décide si la dépense
est une charge ou non. `enregistrerDepense` le vérifie désormais avant insertion et lève une
`ErreurMetier` `immobilisation_introuvable` avec un `champs` exploitable par le formulaire, sur le
patron déjà utilisé pour le fournisseur (422, pas 404).

### 4.3 Clôture et réouverture de période : aucune trace, et le motif écrasé

`journaliser` est appelée depuis `depots/parametres.ts` et `depots/referentiel-ecriture.ts` —
**jamais depuis `depots/comptabilite.ts`**. Deux conséquences :

1. la clôture et la réouverture d'une période échappaient au journal d'audit, alors que
   `CLAUDE.md` §3 règle n°7 impose « un journal d'audit sur toutes les tables sensibles » ;
2. la ligne `periode` ne porte qu'**un seul** couple `(date_reouverture, motif_reouverture)`. Au
   deuxième cycle clôture → réouverture, le **premier motif disparaît sans retour** — violation
   directe de « rien ne s'efface ». C'est pourtant exactement la trace qu'un comptable vient
   chercher quand un mois prétendument clos a bougé deux fois.

**Correction.** `cloturerPeriode` et `rouvrirPeriode` journalisent l'état avant et après.
`rouvrirPeriode` est passée en transaction : la trace et la modification vivent ou meurent
ensemble. Un test vérifie que **les deux motifs** de deux réouvertures successives restent
retrouvables, et qu'une réouverture refusée n'écrit rien au journal.

---

## 5. Suspect côté réglementaire — SIGNALÉ, NON CORRIGÉ

Chacun de ces points demande une réponse d'un comptable ou d'une caisse d'assurances sociales.
Aucun n'a été codé « au plausible ».

### 5.1 Le plan d'amortissement ignore le prorata temporis

`planAmortissement` accorde une **annuité pleine l'année d'acquisition**, quelle que soit la date.
Le matériel acquis le **15/03/2026** ouvre donc 700 € de charge sur 2026, contre **560,00 €** si la
première annuité était proratisée sur les 292 jours restants — **140 € de charge avancée**.

Ce n'est pas seulement la première année : avec un prorata, un plan de 5 ans **s'étale sur 6
exercices**, le reliquat tombant sur un sixième. Le plan actuel en produit exactement 5. Si le
prorata est obligatoire, **le plan est faux sur tous ses exercices**, pas seulement le premier.

**Non corrigé** parce que l'obligation de prorata, sa base (jours ? mois entamés ?) et les
éventuelles exceptions sont des règles fiscales : les coder au jugé produirait un plan
d'amortissement faux qui se lirait ensuite comme une donnée établie. **À trancher avec le
comptable**, puis à consigner dans `docs/05-DECISIONS.md`.

### 5.2 Le dégressif n'est plafonné par rien

Le taux appliqué est le double du linéaire, sans borne. Sur 3 500 € :

| Durée | Plan produit (€)                                     | Annuité 1  |
| ----- | ---------------------------------------------------- | ---------- |
| 2 ans | 3 500,00 \| **0,00**                                 | **100 %**  |
| 3 ans | 2 333,45 \| 777,74 \| 388,81                         | **66,7 %** |
| 5 ans | 1 400,00 \| 840,00 \| 504,00 \| 302,40 \| **453,60** | 40 %       |

Trois choses à faire confirmer :

- **un plafond d'annuité existe-t-il ?** L'usage belge que je ne peux pas certifier ici parle d'un
  plafond de 40 % de la valeur d'investissement. Sur 3 ans, le code en produit 66,7 % — soit
  **934,45 € de charge avancée** sur la première année si le plafond s'applique ;
- **un plan de 2 ans avec une annuité de 0,00 €** est inexploitable tel quel par un comptable ;
- **la dernière annuité repart à la hausse** (302,40 € puis 453,60 € sur 5 ans). C'est la
  conséquence de « la dernière annuité absorbe le reste », choix par ailleurs sain pour la somme
  exacte, mais la convention attendue d'un dégressif est le **basculement en linéaire** dès que le
  linéaire sur la durée résiduelle devient plus favorable. Un plan dégressif non monotone se fera
  remarquer.

Et une question préalable à toutes les autres : **le régime dégressif est-il seulement ouvert** à
une personne physique en complémentaire ? Il a été supprimé pour certains contribuables ; je ne
peux pas l'affirmer pour ce cas précis. Tant que la réponse n'est pas écrite, l'option `degressive`
reste offerte à l'écran sans garde-fou.

### 5.3 `date_cession` n'est ni écrite, ni lue

La colonne existe (`schema.ts:1338`), figure au contrat HTTP (`schemaImmobilisationDetail`) et est
rendue par `listerImmobilisations`. Mais :

- `enregistrerImmobilisation` écrit `dateCession: null` en dur, et **aucune fonction ne la
  renseigne** — il n'existe pas de route de cession ;
- `valeurNetteComptable` et `syntheseExercice` l'ignorent totalement.

Le jour où une cession sera saisissable, **un bien vendu continuera de produire ses annuités
déductibles jusqu'au bout du plan**. Sur le matériel, cela ferait jusqu'à 2 800 € de charge sur un
bien qui n'est plus au patrimoine.

**Non corrigé** : le traitement de l'année de cession (prorata jusqu'à la vente, plus- ou
moins-value de cession, sort de la valeur nette résiduelle) est entièrement réglementaire. Coder
« on arrête après l'année de cession » serait inventer une convention. À spécifier avant d'ouvrir
la saisie d'une cession.

**Même trou du côté de l'annulation.** Une immobilisation ne s'annule pas non plus : il n'existe
ni contre-écriture, ni drapeau, ni suppression logique. Annuler la _dépense_ d'achat (ce qui
fonctionne, par contre-écriture) laisse le plan d'amortissement tourner intégralement — le bien
continue de produire ses annuités déductibles alors que son achat a été contrepassé. C'est le
pendant exact de 5.3, et il se règle avec lui.

### 5.4 La cotisation INASTI est estimée par un taux plat, sans plancher ni assiette réelle

`estimerResultat` applique `taux_cotisation_inasti_bp` (20,50 %) au bénéfice brut. Trois écarts
connus avec la mécanique réelle, à faire confirmer par la caisse :

- l'assiette réelle est le revenu net **professionnel**, les cotisations étant elles-mêmes
  déductibles — la relation est circulaire, pas linéaire ;
- il existe une **cotisation minimale** et, en complémentaire, un **seuil en dessous duquel rien
  n'est dû** ; le modèle rend 0 € dès que le bénéfice est nul ou négatif, ce qui est faux dans un
  sens comme dans l'autre selon le cas ;
- la première année d'activité est **provisionnelle**, régularisée deux ans plus tard.

Le paramètre `taux_ipp_marginal_bp` porte déjà, dans sa description, « estimation indicative :
l'application ne remplace pas un comptable ». C'est le bon réflexe ; il faudrait la même mention sur
`taux_cotisation_inasti_bp`, dont la description actuelle ne dit pas que c'est une approximation.

### 5.5 Les étiquettes de deux seuils sur trois restent douteuses

Déjà relevé par `docs/07` §6.6, et **fidèlement reporté à l'écran** via le champ `source` de
`SEUILS` — ce point est donc bien traité, je le note seulement pour mémoire :

- `seuil_cotisation_reduite_cents` = 17 374,08 € serait le revenu de référence des cotisations
  **minimales d'un indépendant à titre principal**, pas un plafond du complémentaire ;
- `seuil_airbag_cents` = 23 000 € est un **critère d'éligibilité** assorti d'une condition
  d'ancienneté de 3 ans, pas un plafond à ne pas dépasser.

Tant que ces étiquettes ne sont pas confirmées, corriger le câblage de §1 rend le compteur
_cohérent avec sa description_, ce qui est déjà un progrès — mais ne garantit pas que la
description soit juste. Les deux questions sont indépendantes.

### 5.6 Le compteur SCE / caisse blanche manque toujours

`docs/07` §6.7 : deux seuils de 25 000 € coexistent, sur des assiettes différentes — le CA total
(franchise TVA) et le CA des **services de restauration** (caisse enregistreuse certifiée). La
donnée existe déjà : `produit_vente.consommation_sur_place`, `session_marche.ca_sur_place_cents`,
et `totaliserVentes` calcule `caSurPlaceCents`. **Aucun compteur ne l'expose.**

Le doc demande que ce compteur soit porté « à zéro, **visiblement** », parce que le jour où une
table apparaît au stand, l'assiette cesse d'être nulle — et une caisse certifiée devenue
obligatoire s'applique ensuite à _toutes_ les ventes, emporté compris. Clé à ajouter en §7
ci-dessous.

> **Mise à jour du 30/07/2026 — corrigé.** `seuil_sce_cents` existe désormais dans
> `CATALOGUE_PARAMETRES` (`packages/core/src/parametres.ts:62-85`), avec une description quasiment
> identique au texte proposé en §7 ci-dessous. `packages/db/src/depots/sessions.ts:339-357` en fait
> un QUATRIÈME `SEUILS`, avec sa propre assiette dédiée `'ca_sur_place' as const` (`:351`) — le
> commentaire qui l'accompagne (`:342-349`) cite explicitement D-054 comme précédent pour ne pas
> répéter l'erreur de confondre les assiettes. Le compteur est donc désormais exposé par
> `tableauSeuils` comme les trois autres.

---

## 6. Autres constats hors périmètre d'écriture

### 6.1 Une période clôturée ne protège rien, et ne marque rien non plus

Vérifié : `enregistrerDepense`, `annulerDepense`, `enregistrerImmobilisation`, la clôture de
session et la contrepassation de mouvement **ne consultent jamais la table `periode`**.

Ce n'est qu'à moitié un défaut : `docs/07` §1.6 pose explicitement que « la clôture **marque**
plutôt qu'elle n'interdit », et le refus pur créerait du contournement. Mais le marquage n'existe
pas davantage — `docs/07` §6.8 rang 1 nomme d'ailleurs le manque « verrou de période **et marquage
des écritures tardives** ». Aujourd'hui le verrou est purement décoratif : on peut écrire dans un
mois clos sans que rien, nulle part, ne le signale.

Le troisième niveau est décoratif lui aussi : le statut `'verrouillee'` (« point de non-retour »)
**n'est écrit par aucun code** ; seul `rouvrirPeriode` le lit, pour refuser.

Il manque une colonne pour le faire proprement (`depense.periode_close_a_la_saisie`, par exemple) —
d'où l'absence de correction ici, `schema.ts` étant hors périmètre. Une estampille dérivée à la
lecture serait un pis-aller trompeur : elle disparaîtrait à la réouverture de la période, alors
qu'une écriture tardive reste tardive pour toujours.

> **Mise à jour du 30/07/2026 — le premier paragraphe est faux, le reste tient encore.**
> `verifierPeriodeNonVerrouillee` (`packages/db/src/depots/comptabilite.ts:765`) est désormais
> appelée par `enregistrerDepense`, la contre-écriture (`comptabilite.ts:192,303`),
> `enregistrerImmobilisation` (`:470`), les mouvements de stock et leur contrepassation
> (`services/mouvements.ts:87,210,450`), la réception (`services/reception.ts:110,403`), la
> production (`services/production.ts:168,449,729`) et — depuis cette nuit — la clôture et
> l'annulation de session (`services/sessions.ts:606,1256`, D-063). Ces fonctions **consultent**
> donc désormais la table `periode`, contrairement à ce que ce paragraphe affirmait. Mais lire la
> fonction (`comptabilite.ts:765-783`) montre que le constat de fond reste vrai sous une forme plus
> étroite : elle ne lève une erreur que si `periode.statut === 'verrouillee'` — jamais pour
> `'cloturee'`. Le troisième paragraphe ci-dessous (« le statut `verrouillee` n'est écrit par aucun
> code ») reste donc exact tel quel : `cloturerPeriode` ne pose que `'cloturee'`, jamais
> `'verrouillee'`, et rien dans le code de production n'écrit ce second statut. En clair : le verrou
> tient dès qu'il est posé, mais la clôture ordinaire (`'cloturee'`) continue de ne rien signaler à
> l'écriture — exactement l'état que `docs/20-ETAT-DES-LIEUX.md` §4 décrit indépendamment, en
> réservant le geste qui manque à une décision du porteur.

### 6.2 `catch` silencieux confirmé — `apps/web/src/pages/Comptabilite.tsx`

Le fait est confirmé, à la **ligne 801** (et non 587, le fichier a bougé) :

```ts
  async function marquerEcheanceFaite(echeanceId: string): Promise<void> {
    try {
      await requeteApi(`/echeances/${echeanceId}/marquer-faite`, { … });
      chargerEcheances();
    } catch {
      // Rafraîchissement simple : une échéance manquée n'a rien de bloquant,
      // l'utilisateur retente depuis la même ligne.
      chargerEcheances();
    }
  }
```

Violation de `CLAUDE.md` §4 (« jamais de `catch` silencieux »), aggravée par le contexte : ce
bouton coche une obligation **réglementaire**. Si l'appel échoue, l'utilisateur voit la ligne se
recharger sans changement et conclura le plus souvent que l'application « a mal compris », pas
qu'une cotisation INASTI n'a pas été pointée. Le commentaire minimise à tort : _manquer_ une
échéance n'a rien de bloquant, mais _croire l'avoir pointée_ fait manquer la suivante.

**Quoi corriger** — même patron que les autres actions de l'écran, qui le font déjà correctement :

```ts
    } catch (erreur: unknown) {
      const message =
        erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
      setEtatEcheances({ statut: 'erreur', message });
    }
```

`EtatEcheances` porte déjà une variante `{ statut: 'erreur'; message: string }`, et
`chargerEcheances` s'en sert : il n'y a rien à ajouter au type. Ne pas rappeler `chargerEcheances()`
dans le `catch` — c'est ce rechargement qui rend l'échec invisible.

> **Mise à jour du 30/07/2026 — corrigé, avec une garantie plus forte que le correctif proposé.**
> Le corps du `catch` a été extrait dans une fonction pure `etatEcheancesApresEchecPointage`
> (`apps/web/src/pages/Comptabilite.tsx:536-538`, commentaire `:527-534`) qui ne fait rien d'autre
> que produire l'état d'erreur — elle ne peut structurellement pas déclencher de rechargement. Le
> `catch` réel de `marquerEcheanceFaite` (`:952` au 30/07/2026, la ligne continue de bouger) capture
> `erreur: unknown`, comme proposé, au lieu du `catch` sans paramètre d'origine.

---

## 7. Clés de paramètre à ajouter

À coller dans `CATALOGUE_PARAMETRES` (`packages/core/src/parametres.ts`, hors de mon périmètre).
**La valeur de 25 000 € vient de `docs/07` §6.7**, elle n'est pas de mon invention — et la source le
dit, avec la mention « à confirmer », conformément à `CLAUDE.md` §7.

> **Mise à jour du 30/07/2026 — fait.** Cette clé exacte (même `cle`, même `valeurDefaut`, même
> texte de `description` à quelques mots près) est désormais dans `CATALOGUE_PARAMETRES`
> (`packages/core/src/parametres.ts:62-85`) — voir §5.6 pour le `SEUILS` qui l'exploite côté écran.

```ts
  {
    cle: 'seuil_sce_cents',
    typeValeur: 'entier',
    valeurDefaut: '2500000',
    description:
      "Chiffre d'affaires des SERVICES DE RESTAURATION (consommation sur place, hors " +
      'boissons) au-delà duquel une caisse enregistreuse certifiée devient obligatoire. ' +
      "Assiette DIFFÉRENTE du seuil de franchise TVA, qui porte sur le CA total. La vente " +
      "à emporter n'est pas un service de restauration : ce compteur reste à zéro tant " +
      "qu'il n'y a ni table ni chaise au stand. Il doit rester affiché À ZÉRO, visiblement — " +
      'une fois la caisse certifiée obligatoire, elle vaut pour toutes les ventes, emporté ' +
      'compris.',
    source:
      'docs/07-DOCTRINE-ERP-ET-DESIGN.md §6.7 — seuil SCE / caisse blanche. ' +
      "Valeur à confirmer auprès du guichet d'entreprises avant de s'y fier.",
    dateDebutValidite: '2026-01-01',
  },
```

Aucune autre clé ne manque : `seuil_alerte_bp` existe déjà (il n'est simplement pas lu, cf. §2), et
`seuils_sessions_prevues_par_an` est correctement câblé.

---

## 8. À câbler ailleurs

| Où                                        | Quoi                                                                                                          | Renvoi | État au 30/07/2026                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/depots/sessions.ts`      | `assiette: 'revenu_net'` sur le seuil de cotisation réduite + lecture de `syntheseExercice`                   | §1     | **Fait**                                                                                                                                                                      |
| `packages/core/src/sessions.ts`           | `depassementProjete` doit voir un plafond **déjà** franchi, projection ou pas                                 | §2     | **Fait**                                                                                                                                                                      |
| `apps/web/src/pages/TableauDeBord.tsx`    | remplacer le ternaire binaire par `statutParPlafond(…, seuilAlerteBp)` — l'alerte à 80 % de `CLAUDE.md` §6    | §2     | **Fait**                                                                                                                                                                      |
| `apps/web/src/pages/Comptabilite.tsx:801` | supprimer le `catch` silencieux sur `marquerEcheanceFaite`                                                    | §6.2   | **Fait**                                                                                                                                                                      |
| `packages/core/src/parametres.ts`         | clé `seuil_sce_cents`                                                                                         | §7     | **Fait**                                                                                                                                                                      |
| `apps/web` — écran Comptabilité           | afficher `montantImmobiliseCents` à côté du déductible, sinon l'écart décaissé/déductible passera pour un bug | §4.1   | Vérifié le 30/07/2026 : toujours absent (aucune occurrence de `montantImmobiliseCents` dans `Comptabilite.tsx`)                                                               |
| `packages/db/src/schema.ts`               | colonne d'estampille d'écriture tardive, si le marquage de période doit exister                               | §6.1   | Toujours absent — voir la nuance ajoutée en §6.1 : le verrou `'verrouillee'` fonctionne quand il est posé, mais rien ne le pose, et `'cloturee'` seul ne bloque toujours rien |

> **Mise à jour du 30/07/2026 : 5 des 7 lignes sont faites**, chacune avec sa preuve `fichier:ligne`
> dans la section renvoyée. Voir ces sections pour le détail plutôt que ce tableau récapitulatif.

---

## 9. Tests ajoutés

| Fichier                                                | Ce qu'il fige                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/comptabilite-charges.test.ts`       | `montantDeductibleCharge` (immobilisée → 0, symétrie sur contre-écriture), `totaliserJournal` (le décaissé reste, le déductible exclut, totaux reconstitués ligne à ligne), **et le calcul qui démontre la double déduction** : plan + journal = 3 500 €, l'ancienne règle donnait 7 000 €                                       |
| `packages/db/src/comptabilite-seuils-et-audit.test.ts` | synthèse d'exercice avec et sans rattachement (écarts mesurés, jamais de valeur absolue), refus d'une immobilisation inconnue, journal d'audit des périodes avec **les deux motifs** conservés, ventilation transformé/revendu qui se reconstitue, projection refusée sous deux sessions, et l'`it.fails` du seuil de revenu net |

Aucune assertion ne porte sur une valeur que la graine pourrait déplacer : tout est écart mesuré
entre deux lectures, ou invariant reconstitué depuis la source de vérité lue.
