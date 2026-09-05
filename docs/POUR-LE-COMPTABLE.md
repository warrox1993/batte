# Pour le comptable

Ce document explique, en une page, ce que produit l'application « Batte » et ce qu'elle ne
fait pas. Il s'adresse au comptable ou au guichet d'entreprises qui accompagne l'activité, pas
au porteur du projet.

---

## Ce que c'est

Un outil de gestion **usage interne**, tenu par l'indépendant lui-même (activité complémentaire
de vente de crêpes ambulante, franchise de TVA, Wallonie). Il enregistre au jour le jour :

- les **recettes** de chaque session de marché (chiffre d'affaires, ventilé entre produits
  transformés et produits revendus tels quels) ;
- les **dépenses** hors matière première (emplacement, carburant, matériel, assurance,
  formation, frais bancaires, télécom, etc.) ;
- les **investissements** (matériel amortissable) et leur plan d'amortissement ;
- un **échéancier** des obligations réglementaires connues (listing clients TVA, cotisations
  INASTI, contribution AFSCA, renouvellement de l'autorisation ambulante, formulaire e604B) ;
- un **suivi des seuils légaux** (franchise de TVA, éligibilité Airbag, cotisation réduite du
  complémentaire), avec alerte avant d'atteindre le plafond.

Tous les montants sont enregistrés en centimes d'euro exacts. Aucune valeur n'est arrondie
avant l'affichage.

---

## Ce que ça ne fait pas

- **Ça ne remplace pas votre expertise.** L'écran de synthèse affiche un résultat estimé
  (cotisations sociales, impôt, net) à partir de **taux paramétrables**, pas de barèmes
  officiels tenus à jour automatiquement. Ces taux sont à confirmer et ajuster avec vous.
- **Ça ne dépose aucune déclaration.** Ni TVA, ni impôt des personnes physiques, ni listing
  clients : l'application prépare des chiffres, elle ne transmet rien à l'administration.
- **Ça ne tient pas de comptabilité en partie double.** Il n'y a pas de plan comptable, pas de
  grand livre au sens légal — seulement un journal de recettes et un journal de dépenses,
  pensés pour vous fournir une base de travail propre et complète.
- **Ça ne gère aucune donnée personnelle de client.** Aucun nom, aucune adresse, aucun
  historique nominatif : uniquement des transactions et des paniers anonymes.

---

## Comment lire les chiffres

### Rien ne s'efface

Une dépense saisie par erreur n'est jamais supprimée : elle est annulée par une **écriture
d'annulation** (une seconde ligne, de montant opposé, qui référence la première). Les deux
lignes restent visibles dans l'export. C'est volontaire : c'est ce qui rend le journal
auditable, et c'est la même logique qu'une note de crédit.

### Les périodes se clôturent, pas de manière définitive

Chaque mois peut être marqué « clôturé » une fois vérifié. Une clôture peut être rouverte en
cas d'oubli (facture arrivée en retard, par exemple), mais la réouverture exige un motif écrit
et reste elle-même tracée avec sa date. Si un mois clôturé bouge malgré tout, la raison est
toujours consultable dans l'application.

### Le chiffre d'affaires distingue transformé et revendu

Une crêpe (produit transformé, marge d'environ 90 %) et un pot de confiture revendu tel quel
(marge d'environ 30–40 %) ne pèsent pas pareil sur les seuils légaux, qui portent sur le
**chiffre d'affaires total**, pas sur la marge. Les écrans de seuils affichent toujours cette
ventilation, pour éviter une sortie de franchise TVA qui prendrait tout le monde par surprise.

### Le résultat affiché est indicatif

La synthèse d'exercice applique une formule simple :

```
Bénéfice brut     = recettes − dépenses déductibles − amortissements de l'exercice
Cotisations       = taux INASTI paramétré × bénéfice brut (si positif)
Impôt estimé      = taux marginal paramétré × (bénéfice brut − cotisations)
Net estimé        = bénéfice brut − cotisations − impôt estimé
```

Chaque taux vient d'un paramètre daté et documenté (pas d'une valeur codée en dur), mais reste
une hypothèse de travail tant que vous ne l'avez pas validée pour la situation fiscale réelle
du foyer.

---

## Où trouver quoi dans l'application

| Besoin                                                          | Écran                                       |
| --------------------------------------------------------------- | ------------------------------------------- |
| Chiffre d'affaires par session, ventilé transformé/revendu      | Sessions                                    |
| Suivi des trois seuils légaux (TVA, Airbag, cotisation réduite) | Sessions → « Seuils légaux »                |
| Dépenses hors matière, par catégorie                            | Comptabilité → « Dépenses »                 |
| Matériel amortissable et plan d'amortissement                   | Comptabilité → « Immobilisations »          |
| Échéances réglementaires et leur prochaine date                 | Comptabilité → « Échéancier réglementaire » |
| Clôture / réouverture d'un mois                                 | Comptabilité → « Périodes »                 |
| Résultat estimé de l'exercice                                   | Comptabilité → « Synthèse de l'exercice »   |
| Export chiffré (Excel)                                          | selon l'écran, bouton d'export dédié        |

## Exports disponibles

**Mise à jour du 30/07/2026 — la liste ci-dessous n'était pas exacte, corrigée après lecture du
code (`apps/api/src/routes/documents.ts:269-338`).** Quatre exports Excel existent réellement :
état du stock (`/exports/stock`), journal des recettes (`/exports/journal-recettes`), journal
des achats (`/exports/journal-achats`) et mouvements de stock (`/exports/mouvements`). Il
n'existe **ni** export « grand livre simplifié » **ni** export dédié au détail des
amortissements — ce dernier reste consultable uniquement à l'écran Comptabilité →
« Immobilisations », pas dans un fichier à part.

Les exports Excel produits par l'application (état du stock, journal des recettes, journal des
achats, mouvements de stock) sont conçus pour être repris directement dans votre propre outil de
tenue de comptabilité — ils ne le remplacent pas.

---

_Ce document est informatif. En cas de doute sur une obligation déclarative, seule votre
analyse professionnelle, ou celle d'un guichet d'entreprises agréé, fait foi._
