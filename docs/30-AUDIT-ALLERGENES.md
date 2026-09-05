# 30 — Audit des quatorze allergènes réglementaires : de la saisie jusqu'à l'affichette

> Mission de **mesure**, pas de correction. Aucune ligne de code modifiée, aucun sous-agent
> dispatché, aucune requête vers `127.0.0.1:3001` ni `:5173`, aucun serveur lancé, aucun appel API
> Anthropic, aucune donnée d'allergène inventée. Tout ce qui suit vient d'une lecture directe du
> code source courant (`packages/core`, `packages/db`, `apps/api`, `apps/web`) — jamais d'un verdict
> repris d'un document existant sans revérification, et jamais d'un savoir culinaire personnel : la
> question posée est « l'application le sait-elle ? », pas « est-ce vrai ? ».
>
> Aucun test relancé (cinq agents écrivent en parallèle sur ce dépôt au moment de cet audit). Les
> 16 tests cités à la section 3 ont été **lus**, pas exécutés — leur contenu prouve ce qu'ils
> vérifient, indépendamment de leur statut d'exécution au moment où on les lit.

---

## Résumé exécutif

**Bonne nouvelle, vérifiée et non supposée** : les quatorze allergènes réglementaires sont **tous**
saisissables, portés par une seule liste canonique, et les trois documents imprimés qui affichent
des allergènes (fiche technique, affichette du stand, étiquette de bac) refusent correctement
d'affirmer une absence quand un ingrédient n'a jamais été vérifié — y compris à travers un menu.
C'est le point le plus grave que cette mission demandait de vérifier, et il tient.

**Mais la chaîne casse ailleurs, avant l'impression** : deux écrans interactifs de saisie de
recette affichent les mêmes allergènes **sans jamais consulter le drapeau de vérification**, et la
mention « sans gluten » d'une recette est un **booléen déclaratif indépendant**, jamais recoupé
avec la présence réelle de gluten dans ses ingrédients. Le détail est aux sections 2 et 3.

---

## 1. Les quatorze sont-ils tous saisissables ?

**Oui, les 14/14, aucun manquant.** Liste dérivée du code, pas énumérée à la main, par la commande
suivante :

```
node -e "
const fs = require('fs');
const c = fs.readFileSync('packages/core/src/contrats/referentiel.ts', 'utf8');
console.log(c.match(/CATALOGUE_ALLERGENES = \[([\s\S]*?)\] as const;/)[1]);
"
```

Sortie (`packages/core/src/contrats/referentiel.ts:732-747`) :

```
{ code: 'gluten', libelle: 'Céréales contenant du gluten' },
{ code: 'crustaces', libelle: 'Crustacés' },
{ code: 'oeufs', libelle: 'Œufs' },
{ code: 'poissons', libelle: 'Poissons' },
{ code: 'arachides', libelle: 'Arachides' },
{ code: 'soja', libelle: 'Soja' },
{ code: 'lait', libelle: 'Lait (y compris lactose)' },
{ code: 'fruits-a-coque', libelle: 'Fruits à coque' },
{ code: 'celeri', libelle: 'Céleri' },
{ code: 'moutarde', libelle: 'Moutarde' },
{ code: 'sesame', libelle: 'Graines de sésame' },
{ code: 'sulfites', libelle: 'Anhydride sulfureux et sulfites' },
{ code: 'lupin', libelle: 'Lupin' },
{ code: 'mollusques', libelle: 'Mollusques' },
```

Confrontation aux quatorze de l'annexe II du règlement (UE) n° 1169/2011 : correspondance
**exacte**, un pour un. Aucun des quatorze n'est absent.

**Sur le piège des familles** (le point que la mission demandait explicitement de vérifier) :
`gluten` et `fruits-a-coque` sont bien portés comme des **codes de famille**, avec un libellé de
famille (« Céréales contenant du gluten », « Fruits à coque »), et non réduits à l'un de leurs
membres (pas de code séparé « blé », « avoine », « noisette » ou « amande »). C'est le bon
comportement : l'application ne peut pas déclarer « noisette » sans déclarer « fruits à coque », ni
laisser croire que seul le blé porte du gluten.

**Une seule source, pas deux qui pourraient diverger** — vérifié par recherche exhaustive de
`CATALOGUE_ALLERGENES` dans tout le dépôt (`grep -rn CATALOGUE_ALLERGENES`, hors tests) :

- la contrainte d'écriture (`z.enum(CODES_ALLERGENES...)`,
  `packages/core/src/contrats/referentiel.ts:806-813`) — un code hors de ces 14 est **refusé** à la
  saisie API, avec le message « Allergène hors de la liste réglementaire des 14. » ;
- les deux formulaires web qui proposent les cases à cocher (`apps/web/src/pages/Ingredients.tsx:889`
  et `apps/web/src/pages/Recettes.tsx:2920`, création rapide d'ingrédient depuis l'écran recette) ;
- la fonction de libellé (`libelleAllergene`, `referentiel.ts:751-753`), utilisée par les trois
  documents imprimés pour traduire un code en formulation réglementaire lisible.

Aucune deuxième liste, plus courte ou différente, n'a été trouvée ailleurs (seed, exports Excel,
registre AFSCA). Le point 1 de la mission est donc négatif : **rien ne manque au référentiel**.

---

## 2. L'information remonte-t-elle de l'ingrédient jusqu'au client ?

### 2.1 Ce qui marche : les trois documents imprimés, menu compris

`apps/api/src/documents/donnees.ts::donneesAffichetteAllergenes` (lignes 241-417) résout
explicitement la chaîne complète pour l'affichette :

- ingrédient → **recette** (jointure `recette_ligne` × `ingredient`, ligne 250-262) ;
- ingrédient → **garniture** d'un produit transformé (`produit_garniture`, ligne 264-277) ;
- ingrédient → **composant de nomenclature de vente**, scindé en obligatoire/optionnel
  (`produit_vente_composant.optionnel`, ligne 298-318) — un composant optionnel (la crème d'un
  café) n'entache pas la liste principale, il part sous « sur demande » (ligne 400-411) ;
- ingrédient → **article revendu** (`produit_vente.ingredient_id`, ligne 279-292) ;
- et surtout, **menu → ses produits inclus** (`menu_composition`, lignes 320-380) : un menu n'a ni
  recette ni ingrédient propres (`produit_vente.nature = 'menu'`), donc sans cette résolution
  explicite un menu « crêpe + café » se serait imprimé sans aucun allergène. Le code le dit
  lui-même en commentaire (ligne 324-326) : _« C'est l'omission la plus grave que cette affichette
  puisse commettre »_. Vérifié dans le code, pas supposé : la fonction va bien chercher, pour
  chaque produit inclus dans un menu, sa recette, ses garnitures, ses composants obligatoires et son
  article revendu, et les fusionne dans la liste du menu.

Ce chemin est couvert par des tests d'intégration qui passent par la vraie chaîne (dépôt → base
SQLite en mémoire → assemblage → gabarit), pas par un gabarit isolé sur des données inventées :
`apps/api/src/documents/audit-documents.test.ts` (menu avec crêpe + café, lignes 961-1080) et
`apps/api/src/documents/allergenes-verifies.test.ts` (menu, lignes 473-501). Le menu, présenté par
la mission comme le maillon le plus suspect, **n'est pas** celui qui casse.

Les deux autres documents (fiche technique, étiquette de bac de pâte,
`donnees.ts` lignes 124-176 et 423-463) suivent la même discipline pour la recette seule.

### 2.2 Ce qui casse : les écrans interactifs, AVANT l'impression

La chaîne se rompt plus tôt, dans deux panneaux de calcul en direct de l'écran Recettes — des
écrans que le porteur consulte pour juger « est-ce bon à servir » avant même de songer à imprimer
quoi que ce soit.

Les deux panneaux (aperçu en direct pendant l'édition d'une recette,
`apps/web/src/pages/Recettes.tsx:1095-1190`, et l'outil « calculer »,
`apps/web/src/pages/Recettes.tsx:2624-2669`) appellent directement les fonctions pures de
`packages/core/src/recettes.ts` (`mettreAEchelle`, `agregerAllergenes`). Or ces fonctions pures
portent un champ `allergenes: readonly string[]` par ligne
(`LigneRecetteCalcul`, `packages/core/src/recettes.ts:19-39`) mais **aucun champ de vérification** :
la notion `allergenesVerifies` n'existe nulle part dans `packages/core/src/recettes.ts` ni dans les
contrats de lecture qui l'exposent à l'écran (`schemaLigneRecette`, `schemaResultatCalcul`,
`schemaGarnitureChiffree`, `schemaCoutProduitVendu` — `packages/core/src/contrats/recettes.ts`,
recherche exhaustive : zéro occurrence de `allergenesVerifies` dans ce fichier).

Concrètement, à la ligne 1155 de `Recettes.tsx`, la construction de la ligne envoyée au calcul ne
retient que `ingredient.allergenes` — `ingredient.allergenesVerifies` existe pourtant déjà sur
l'objet source (`IngredientComplet`), mais n'est jamais lu :

```ts
lignesResolues.push({
  ingredientId: ingredient.id,
  nomIngredient: ingredient.nom,
  unite: ingredient.uniteReference,
  quantiteReference: quantite,
  cumpCentsParUnite: ingredient.coutUnitaireCents,
  allergenes: ingredient.allergenes, // <- allergenesVerifies n'est jamais transmis
});
```

Le résultat s'affiche ensuite tel quel (lignes 2444-2448 et 2663-2667) :

```tsx
Allergènes: {
  etatCalcul.resultat.allergenes.length > 0
    ? etatCalcul.resultat.allergenes.join(' · ')
    : TIRET_ABSENT;
}
```

Un ingrédient **jamais vérifié** (le cas par défaut à la création, `allergenesVerifies: false`) a
en général une liste `allergenes` vide — ce panneau affiche alors un simple tiret («&nbsp;—&nbsp;»),
**exactement le même rendu** que pour un ingrédient réellement vérifié et confirmé sans allergène.
Rien à l'écran ne distingue les deux cas. C'est très précisément l'ambiguïté que le drapeau
`allergenesVerifies` existe pour éliminer (voir le commentaire de la colonne,
`packages/db/src/schema.ts:189-201`) — éliminée sur les trois documents imprimés (section 2.1 et
section 3), pas sur ce panneau.

Le même défaut existe sur le tableau des lignes d'une recette ouverte
(`COLONNES_LIGNES_REFERENCE`, `Recettes.tsx:579-590`) : la colonne « Allergènes » affiche
`l.allergenes.join(' · ')` ou un tiret, sans jamais consulter la vérification — et affiche en plus
le **code brut** (`fruits-a-coque`) plutôt que le libellé réglementaire (`libelleAllergene` n'est
appelé nulle part dans ce fichier pour cette colonne), contrairement aux trois documents imprimés
qui, eux, appellent systématiquement `libelleAllergene`.

**Sur l'architecture** : ce partage entre calcul pur (`packages/core`) et vérification (bolt-on
dans `apps/api/src/documents/donnees.ts::tousLesIngredientsVerifies`, lignes 101-112) n'est pas en
lui-même une faute — CLAUDE.md §3 règle 1 réserve `packages/core` aux fonctions pures sans accès
base, et vérifier `allergenesVerifies` suppose de relire l'ingrédient en base. Mais cette séparation
n'a été appliquée que sur le chemin de génération de document ; le chemin de calcul en direct côté
navigateur n'a jamais reçu l'équivalent, alors que les deux chemins affichent la même information à
la même personne.

### 2.3 « Sans gluten » : un booléen déclaratif, jamais recoupé avec les allergènes réels

`recette.sansGluten` (`packages/db/src/schema.ts:287`) est un booléen **saisi à la main** dans le
formulaire recette (`Recettes.tsx:2171-2177`, case à cocher « Sans gluten »), utilisé pour :

- le sous-titre de la fiche technique (`gabarits.ts:109` :
  `` `... ${donnees.sansGluten ? ' · sans gluten' : ''}` ``) ;
- le plancher de production sans gluten du moteur de prévision
  (`packages/core/src/prevision/repartition-production.ts`) ;
- l'affichage du nom de recette dans les écrans de production et de prévision.

Ce booléen est **entièrement indépendant** de `allergenes`, la liste calculée à partir des
ingrédients réels de la recette. `verifierCoherenceRecette`
(`packages/core/src/contrats/referentiel.ts:1082-1096`), la seule fonction de validation qui
s'applique à la saisie d'une recette, ne vérifie que deux choses : l'absence de doublon
d'ingrédient, et qu'il reste un rendement net non nul après les deux taux de perte. **Rien** n'y
recoupe `sansGluten` avec la présence ou l'absence du code `gluten` dans les lignes de la recette.

Conséquence directement observable sur la fiche technique : rien n'empêche un document où le
sous-titre affiche « · sans gluten » pendant que la section « Allergènes » un peu plus bas liste
« Céréales contenant du gluten » — deux affirmations contradictoires sur le même document, sans
qu'aucun code ne s'y oppose.

Ce n'est pas une hypothèse en l'air : la donnée de démonstration est **actuellement dans cet état
latent**. `packages/db/src/seed/demonstration.ts:948-977` crée R2 (« Pâte à crêpes
sarrasin-châtaigne (sans gluten) ») avec `sansGluten: true` et **zéro ligne d'ingrédient** — le
commentaire du seed dit explicitement _« la composition [est] NON documentée. On ne l'invente pas
[…] l'utilisateur la complète »_. Aucune farine de sarrasin ni de châtaigne n'existe même dans le
catalogue d'ingrédients de démonstration (`INGREDIENTS`, même fichier, lignes 145-404 : neuf
ingrédients de R1 plus les composants du café, rien pour R2). Le jour où le porteur remplira R2, si
un seul ingrédient choisi porte par erreur (ou par omission de vérification) le code `gluten`, rien
dans le code ne le signalera avant l'impression — ni à la saisie, ni sur le document lui-même, qui
imprimera « sans gluten » et « Céréales contenant du gluten » côte à côte. C'est exactement
l'affirmation que CLAUDE.md §0 cite comme devant être « vraie, pas approximative ».

Accessoirement, la route qui génère la fiche technique
(`GET /documents/fiche-technique/:id`, `apps/api/src/routes/documents.ts`) ne vérifie pas non plus
que la recette est `active` : une recette encore `brouillon` (comme R2 aujourd'hui) peut déjà
produire un PDF dès qu'elle a au moins une ligne.

---

## 3. Que se passe-t-il quand un ingrédient n'est pas vérifié ?

**Sur les trois documents imprimés : non, l'affichette ne peut pas afficher une absence qu'elle ne
sait pas.** Démonstration, pas affirmation :

Le schéma (`packages/db/src/schema.ts:187-204`) porte deux colonnes distinctes sur `ingredient` :
`allergenes` (liste, défaut `[]`) et `allergenesVerifies` (booléen, défaut `false`). Le commentaire
de la colonne énonce lui-même la doctrine : _« Sans ce drapeau, `allergenes = []` est ambigu : un
ingrédient qu'on n'a jamais interrogé s'imprime exactement comme un ingrédient contrôlé sans
allergène. […] le seul défaut de ce fichier qui puisse envoyer quelqu'un à l'hôpital. »_

Les trois gabarits (`apps/api/src/documents/gabarits.ts`) traduisent ce booléen en trois endroits
distincts, et à chaque fois de la même façon — jamais la liste ni « aucun allergène déclaré »
quand `allergenesVerifies` est faux, toujours un avertissement à la place :

- fiche technique, ligne 171-172 : `« Allergènes non encore vérifiés — évaluez-les avant toute
diffusion. »` ;
- affichette du stand, ligne 245-246 : `« Allergènes non encore vérifiés »` ;
- étiquette de bac, ligne 330-331 : `« non encore vérifiés »`.

Le drapeau lui-même est calculé, pour chaque document, en repassant par la base
(`tousLesIngredientsVerifies`, `donnees.ts:101-112`, et `toutesVerifiees`/`ContributionAllergene`
pour l'affichette, lignes 230-239), et il est **faux dès qu'un seul** ingrédient contributeur ne
l'est pas — recette, garniture, composant obligatoire, article revendu, ou l'une de ces sources
pour un produit inclus dans un menu. Un composant **optionnel** non vérifié, lui, n'entache pas le
produit (seule sa mention « sur demande » en dépend) : c'est cohérent, puisqu'un allergène
optionnel non confirmé n'est de toute façon jamais affirmé comme faisant partie du produit de base.

Cette règle est couverte par **16 tests** dans
`apps/api/src/documents/allergenes-verifies.test.ts` (compté : `grep -c "  it(" ...` → 16), qui
passent tous par la vraie chaîne (dépôt → base SQLite en mémoire → assemblage → gabarit), jamais
par un gabarit isolé sur des données inventées. Ils couvrent explicitement : un ingrédient de
recette non vérifié (fiche technique et affichette), une garniture non vérifiée, un article revendu
non vérifié, un composant de nomenclature obligatoire non vérifié, un composant **optionnel** non
vérifié qui n'entache pas le produit, un menu qui hérite du non-vérifié d'un seul de ses deux
produits inclus, l'étiquette de bac sur une production réelle (recette → réception → lot →
production), et quatre tests sur le dépôt (`creerIngredient`/`modifierIngredient`) qui prouvent que
le drapeau se crée à `false` par défaut, se préserve si le formulaire l'omet à la modification (ne
désévalue jamais un ingrédient déjà vérifié en silence), et ne change que sur envoi explicite.

**Nuance sur ce que le drapeau garantit historiquement.** La migration qui l'a introduit
(`packages/db/drizzle/0024_fat_miss_america.sql`) a rétroactivement mis `allergenes_verifies = 1`
sur **tout ingrédient qui avait déjà une liste `allergenes` non vide** au moment de la migration —
une hypothèse (« une liste renseignée veut dire qu'elle a été vérifiée »), pas un geste de
vérification humaine explicite pour ces ingrédients-là. Le commentaire de la migration assume ce
choix et l'explique (éviter que l'avertissement apparaisse partout et perde son sens) ; il reste
qu'un ingrédient antérieur à cette migration peut porter `allergenesVerifies = true` sans qu'un
humain n'ait jamais coché la case pour lui.

**Mais hors des trois documents imprimés : oui**, un ingrédient non vérifié peut se lire comme
« pas d'allergène » — voir la section 2.2. Les deux panneaux de calcul en direct de l'écran
Recettes affichent la même liste `allergenes` sans jamais consulter `allergenesVerifies`, avec un
tiret identique pour « jamais vérifié, liste vide » et pour « vérifié, aucun allergène ».

**Sur la donnée de démonstration** : `packages/db/src/seed/demonstration.ts` ne pose jamais
`allergenesVerifies` sur aucun des ~18 ingrédients qu'il crée (recherche exhaustive dans le
fichier : zéro occurrence de `allergenesVerifies`) — ils héritent donc tous du défaut `false`, **y
compris** farine, lait, œufs, beurre et crème, dont les allergènes sont pourtant bien renseignés
dans `allergenes`. C'est le comportement conservateur voulu par la doctrine (rien ne s'affirme sans
confirmation humaine explicite), mais concrètement, toute base neuve issue de ce seed affichera
« non encore vérifiés » sur les trois documents jusqu'à ce que quelqu'un coche la case, ingrédient
par ingrédient, dans l'écran Ingrédients (`Ingredients.tsx:918-926`, case « Allergènes vérifiés »
native, atteignable au clavier).

---

## 4. L'affichette imprimée dit-elle la vérité ?

Lue dans le gabarit (`apps/api/src/documents/gabarits.ts:235-276`), l'affichette :

- **dit les allergènes présents** — par produit, avec le libellé réglementaire complet
  (`libelleAllergene`), jamais le code interne ;
- **dit ce qu'elle ignore** — l'avertissement « Allergènes non encore vérifiés » remplace la liste
  quand un contributeur n'a pas été évalué (section 3) ;
- **distingue le systématique du conditionnel** — un composant optionnel (la crème d'un café)
  s'affiche à part, sous « Sur demande », jamais fondu dans la liste principale (ligne 253-259) ;
- **porte une date** — « Affichette éditée le [date] » (ligne 270-272), qui vient de
  `donneesAffichetteAllergenes` (`new Date()` au moment de la génération, `donnees.ts:415`) ;
- **ne présente que des produits actifs** — un produit retiré de la carte n'y figure plus (`where
produitVente.actif`, `donnees.ts:245`), pour ne pas faire douter le client du reste du panneau ;
- **refuse de s'imprimer vide** — la route (`apps/api/src/routes/documents.ts`) lève une erreur
  métier explicite si aucun produit actif n'existe, plutôt que de rendre une affichette blanche.

Elle **ne dit en revanche pas** que la mention « sans gluten » d'une recette liée est indépendante
de la liste d'allergènes qu'elle affiche pour ce même produit (section 2.3) — un lecteur de
l'affichette n'a aucun moyen de savoir que ces deux informations ne sont pas mutuellement
garanties par le code.

---

## 5. Les « traces » et la contamination croisée

**Non exprimable, à part une phrase générique unique.** Le modèle de données ne porte **aucune**
distinction entre « contient » et « peut contenir des traces de » : `ingredient.allergenes` est une
simple liste de codes (`text('allergenes', { mode: 'json' }).$type<string[]>()`,
`packages/db/src/schema.ts:188`), sans attribut de certitude ni de sévérité. Recherche exhaustive
des termes « trace », « contamination croisée », « peut contenir » dans `packages/` et `apps/` :
**une seule occurrence pertinente**, dans le gabarit de l'affichette
(`gabarits.ts:264-268`), un unique paragraphe imprimé **une fois par affichette, identique pour
tous les produits** :

> « Nos préparations sont réalisées sur un même plan de travail : une présence accidentelle de
> traces d'autres allergènes ne peut pas être exclue. N'hésitez pas à nous interroger. »

Cette phrase est une clause de prudence générale, pas une déclaration structurée par produit ou par
allergène. Elle ne dit pas, par exemple, que la crêpe sans gluten (R2) cuit à quelques centimètres
d'une crêpe au froment sur le même stand (CLAUDE.md §6 : « deux plaques gaz en parallèle ») — le cas
précis que la mission demandait de considérer. Rien dans le code ne permet aujourd'hui de :

- déclarer un allergène comme « trace possible » plutôt que « composant » pour un produit donné ;
- varier cette mention selon le produit (elle est strictement identique, qu'il s'agisse d'un pot de
  sirop scellé en usine ou d'une crêpe cuite à la louche à quelques centimètres d'une autre pâte) ;
- distinguer un produit réellement isolé (four dédié, plan de travail séparé) d'un produit exposé à
  un risque de contact croisé réel.

**C'est une décision produit et réglementaire, pas une question de code** — la mission demande
explicitement de ne pas trancher à la place du porteur. Voir les questions à poser à l'AFSCA,
section 6.

---

## 6. Ce qui mérite d'être posé à l'AFSCA

Formulé pour être copié tel quel :

1. « Notre affichette déclare, pour chaque produit, la liste des allergènes qu'il contient, avec un
   avertissement séparé pour les allergènes apportés par une option servie sur demande (ex. la
   crème d'un café). Elle ne distingue pas “contient” de “peut contenir des traces de” : une phrase
   générique en bas de page mentionne un risque de contamination croisée pour l'ensemble du stand.
   Est-ce suffisant, ou faut-il une mention plus spécifique — par exemple sur la crêpe sans gluten
   cuite à proximité d'une crêpe au froment sur le même stand ? »
2. « Notre crêpe sarrasin-châtaigne est annoncée “sans gluten” sur la fiche technique et dans
   l'application. Cette mention est aujourd'hui une case cochée par l'utilisateur, indépendante du
   calcul des allergènes réels de la recette — rien ne garantit informatiquement leur cohérence
   mutuelle. Le contrôle humain avant impression suffit-il, ou attendez-vous une preuve
   documentaire (analyse, attestation fournisseur) que l'application devrait pouvoir rattacher à la
   recette ? »
3. « Deux plaques de cuisson au gaz fonctionnent en parallèle sur le stand, avec une pâte à la fois
   par plaque. Le risque de contamination croisée entre une pâte au froment et une pâte sans gluten
   doit-il être traité comme un “peut contenir des traces” générique (notre pratique actuelle), ou
   la configuration matérielle (ustensiles dédiés, séquencement des cuissons) doit-elle être décrite
   plus précisément sur l'affichette ou dans un document interne ? »
4. « Un ingrédient dont les allergènes n'ont jamais été évalués fait aujourd'hui refuser
   l'impression du document correspondant (l'application affiche “non encore vérifié” plutôt
   qu'une liste). Est-ce le comportement attendu par un contrôle, ou une affichette partiellement
   vérifiée (produits confirmés listés, produits non confirmés signalés à part sur le même document)
   serait-elle préférable à un document qui refuse de citer les produits déjà vérifiés parce qu'un
   autre produit de la carte ne l'est pas encore ? » — _note : aujourd'hui l'application n'empêche
   pas d'imprimer une affichette partielle : le drapeau non-vérifié est calculé par PRODUIT, pas
   globalement ; la question porte sur l'attente réglementaire, pas sur une limite technique._

---

## 7. Ce que cet audit ne couvre pas

Cette section n'est pas optionnelle : sur ce sujet, une lacune non dite est un risque, pas une
imperfection.

- **Aucune vérification visuelle du PDF réellement rendu.** Tout ce qui précède est une lecture du
  code source (gabarits HTML, assemblage, schéma, tests) — jamais un PDF généré et lu page par
  page. La mission interdisait explicitement de lancer un serveur ou d'appeler l'API ; un audit
  antérieur (`docs/24-AUDIT-DOCUMENTS-IMPRIMES.md`) a rendu et lu visuellement l'affichette, mais
  sur un état du code antérieur à aujourd'hui — non revérifié ici au-delà de la citation à la
  section 2.1, conformément à la consigne de ne rien reprendre sans revérification.
- **Aucune vérification des DONNÉES réelles.** Ni le contenu de `donnees/batte.sqlite` (interdit de
  toucher) ni un état réel des cases « Allergènes vérifiés » cochées par le porteur n'ont été
  consultés. Tout ce qui est dit sur « ce qui s'affiche pour tel ingrédient » porte sur le
  **mécanisme**, jamais sur l'état actuel de la vraie base.
- **Aucune vérification du registre AFSCA ni du bon de commande** vis-à-vis des allergènes : la
  mission porte sur la chaîne ingrédient → recette → produit → menu → affichette ; le registre
  d'autocontrôle (`registre-afsca.ts`) et le bon de commande n'affichent pas d'allergènes et n'ont
  pas été audités sous cet angle.
- **Aucune vérification de l'écran Menus.tsx** au-delà de sa présence dans la recherche par
  mots-clés — sa construction de la composition d'un menu (quels produits, en quelle quantité) n'a
  pas été relue ligne à ligne ; seule la résolution des allergènes d'un menu déjà composé
  (`donneesAffichetteAllergenes`) l'a été.
- **Aucune vérification du parcours d'import IA** (« extraction structurée », CLAUDE.md §5, lecture
  d'un bon de livraison) vis-à-vis des allergènes : ce parcours n'a pas été localisé dans le code
  au moment de cet audit (peut-être pas encore construit) ; s'il existe ou est construit plus tard,
  il faudra vérifier qu'il passe bien par le même schéma Zod à 14 valeurs que les deux formulaires
  web, et non par une écriture directe qui contournerait la contrainte.
- **La faille de saisie hors-API n'a été démontrée qu'en test.** La section 2 mentionne que la
  colonne `ingredient.allergenes` n'a aucune contrainte au niveau SQLite (seul le schéma Zod de
  l'API l'impose) et que des tests du dépôt écrivent directement une valeur hors catalogue
  (`apps/api/src/documents/audit-documents.test.ts:939` et `:1025`, `'fruits à coque'` au lieu de
  `'fruits-a-coque'`) pour vérifier le comportement de repli (`libelleAllergene` affiche la chaîne
  telle quelle). Aucun chemin de production réel écrivant hors du formulaire n'a été identifié ni
  démontré exploitable — c'est un point de vigilance sur la défense en profondeur, pas une
  vulnérabilité démontrée en conditions réelles.
- **Le statut d'exécution des 16 tests cités n'a pas été vérifié.** Ils ont été lus, pas relancés
  (consigne explicite de la mission). Si un autre agent a modifié entretemps
  `donnees.ts`, `gabarits.ts` ou `schema.ts`, le contenu cité peut avoir changé depuis cette lecture.
- **Aucun avis juridique.** Les questions de la section 6 sont des questions à poser, pas des
  réponses ; ce document ne dit à aucun moment ce que le règlement ou l'AFSCA exigent au-delà de ce
  que CLAUDE.md cite déjà lui-même.
