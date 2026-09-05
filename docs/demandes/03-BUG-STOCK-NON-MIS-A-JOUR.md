# 03 — Bug bloquant : le stock affiché ne bouge pas après une entrée

**Priorité : traiter en premier.** Ce bug fausse toute donnée en aval — coût de revient,
prévision, réapprovisionnement, registre AFSCA. Rien construit dessus n'est fiable tant qu'il
n'est pas corrigé.

## Reproduction rapportée

Réception simulée de 10 kg de vergeoise blonde. Le stock affiché reste figé à 463 (unité non
précisée par l'utilisateur — probablement grammes, à confirmer à l'écran). Comportement
identique constaté sur d'autres ingrédients : ce n'est pas un cas isolé, c'est structurel.

## Hypothèse la plus probable — à vérifier en premier

`docs/02-MODELE-DONNEES.md` pose un invariant explicite : **le stock ne se stocke jamais,
il se calcule comme la somme des mouvements** (« La quantité restante d'un lot n'est jamais
stockée : elle se calcule comme `quantite_initiale - SUM(mouvement_stock.quantite …)` »).

La cause la plus probable de ce bug est que l'implémentation a dévié de cette règle : un
champ de quantité a été **mis en cache** quelque part (sur `lot`, ou sur une vue
matérialisée non rafraîchie, ou côté client dans un état React qui ne se resynchronise pas
après l'écriture), et c'est ce cache figé que l'écran Stock affiche — pas le résultat d'un
recalcul sur les mouvements.

**Vérifier dans cet ordre :**

1. La réception crée-t-elle bien une ligne dans `mouvement_stock` (type `entree`) avec la
   bonne quantité ? Si non, le bug est côté écriture (formulaire de réception).
2. Si le mouvement existe bien en base : la requête qui alimente l'écran Stock recalcule-t-
   elle réellement `SUM(mouvement_stock.quantite)`, ou lit-elle un champ figé ? Si elle lit
   un champ figé, c'est la vraie cause.
3. Si le calcul côté serveur est correct : le client re-fetch-il les données après la
   réception (invalidation de cache React Query / SWR ou équivalent), ou affiche-t-il une
   valeur restée en mémoire depuis le chargement de la page ?

## Ce qui doit changer

- Corriger la cause racine identifiée à l'étape ci-dessus — pas seulement forcer un
  rafraîchissement manuel qui masquerait le problème.
- Ajouter le test d'invariant qui **aurait dû empêcher ce bug** : après un mouvement
  d'entrée de X unités, `v_stock_courant` doit refléter +X, vérifié par un test automatisé
  qui insère un mouvement et relit la vue dans la foulée.
- Si un champ de cache de quantité existe quelque part dans le schéma, le supprimer et
  s'assurer qu'aucun code ne s'appuie dessus.

## Ce qui doit être relié

Tout ce qui lit une quantité de stock doit passer par le même mécanisme recalculé :
écran Stock, contrôle de faisabilité en Production (module 3), calcul du point de commande
(module 2), tableau de bord.

## Critère de fin

Réception de 10 kg de vergeoise blonde sur un stock à 463 g → l'écran Stock affiche
immédiatement 10 463 g (ou 10,46 kg selon la fiche 01), sans rechargement manuel de la page,
et le test automatisé décrit ci-dessus est vert.

---

## Mise à jour du 01/08/2026 — vérifié dans le code réel

**Verdict : le bug tel que décrit ne se reproduit pas ; c'était un symptôme mal attribué,
déjà corrigé.**

**Les trois hypothèses de la fiche ont été vérifiées une par une, dans le code actuel, et
aucune ne tient :**

1. **Écriture.** `enregistrerReception` (`packages/db/src/services/reception.ts`) crée bien
   une ligne `mouvement_stock` de type `entree`, testé de bout en bout dans
   `packages/db/src/services/stock.test.ts:78` — test nommé littéralement
   « critère de fin : 25 kg reçus, 4 kg sortis, 21 kg restants correctement valorisés »,
   qui réceptionne, sort, puis relit `etatDuStock()` et vérifie `quantiteDisponible`,
   `valeurCents` et `cumpCentsParUnite`. Ce test existait déjà, avant cette fiche.
2. **Calcul serveur.** `packages/db/src/depots/stock.ts` (`SQL_RESTANT`) recalcule
   systématiquement `SUM(CASE type WHEN 'entree' THEN 1 ELSE -1 END × quantite)` à chaque
   lecture — **aucun champ de quantité stocké nulle part sur `lot`**, confirmé par lecture
   du dépôt entier. `verifierInvariantLots` / `diagnostiquerIntegriteStock`
   (`packages/db/src/depots/stock.ts:305-362`, exposé par `GET /api/stock/integrite`) détecte
   déjà les deux défaillances qu'un tel bug produirait (sorties qui dépassent l'initiale,
   entrée comptée deux fois) et sont testées trois fois dans le dépôt.
3. **Client.** `apps/web/src/pages/Stock.tsx` : `receptionEnregistree()` appelle
   `rafraichir()`, qui incrémente `revision`, qui redéclenche le `useEffect` sur `/stock`
   (ligne 664-687) — le ré-affichage est automatique, aucun rechargement manuel requis.

**Ce que le code montre avoir réellement existé** (et corrigé) : le défaut **G6**
(`docs/14-TEST-PARCOURS-UTILISATEUR.md` §G6, « Les lots périmés portent le statut
Disponible ») décrit un lot administrativement `disponible` mais dont la DLC est dépassée
depuis 208 jours, affiché « ● Disponible » alors que `quantiteDisponible`
(`packages/core/src/stock.ts`) l'excluait déjà correctement du total consommable — **le
moteur avait raison, l'étiquette mentait**, exactement l'hypothèse notée en amont de cette
mission. Le chiffre « 463 g » cité par le porteur dans cette fiche est très probablement le
même que celui de G7 (`docs/14` : « Vergeoise blonde 778 g / 463 g → manque 315 g »), un
écran de faisabilité de production, pas une réception — la confusion porte sur le scénario,
pas sur un calcul faux.

**État des trois défauts G6, vérifié dans le code d'aujourd'hui — tous corrigés :**

- Étiquette du lot : `statutAfficheLot` (`apps/web/src/pages/Stock.tsx:235-243`) affiche
  désormais « Périmé » pour un lot `disponible` dont la DLC est dépassée (correctif du
  30/07/2026, cité dans le code par son nom G6).
- Statut agrégé de l'ingrédient (« défaut adjacent » laissé ouvert le 30/07) : `statutLigne`
  (`Stock.tsx:189-195`) vérifie désormais `estPerime` avant `statutStock` — un ingrédient
  dont le lot le plus ancien est périmé ne peut plus afficher « ● OK ».
  correctif du 01/08/2026 : `valoriserStockPerime`
  (`packages/core/src/stock.ts:400-411`) sépare la valeur périmée de la valeur exploitable,
  affichée sur `Stock.tsx:1159-1163` (« … de matière périmée non »).
- Compteur du tableau de bord (second « défaut adjacent ») : `lignesDlcProches` /
  `lignesPerimees` (`apps/web/src/pages/TableauDeBord.tsx:897-949`) distinguent désormais un
  lot « proche de sa DLC » d'un lot déjà périmé, avec deux alertes séparées.

**Verdict.** Le mécanisme central — le stock est la somme des mouvements, recalculé à chaque
lecture, sans aucun champ figé — est sain et testé, aujourd'hui comme au moment où la fiche a
été écrite. Le symptôme réellement observable et déjà corrigé est un défaut d'AFFICHAGE (le
statut d'un lot ou d'un ingrédient), jamais un défaut du calcul de quantité. Aucune régression
à corriger n'a été trouvée ; rien à ajouter à une liste de « manque » sur ce point.
