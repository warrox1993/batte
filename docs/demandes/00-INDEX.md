# 00 — Index des fiches d'amélioration

Ce dossier contient des **tickets indépendants**, chacun envoyable seul à Claude Code.
Ils s'ajoutent à `docs/01` à `07` (la base déjà posée), ils ne les remplacent pas.

---

## Méthode obligatoire — à appliquer sur CHAQUE fiche, sans exception

Avant d'écrire une seule ligne de code sur une fiche, Claude Code doit :

1. **Vérifier l'existant.** Lire le code actuel du module concerné. La fonctionnalité
   existe-t-elle déjà, même partiellement ? Sous quelle forme ?
2. **Décider en conséquence.**
   - N'existe pas → l'implémenter selon la fiche.
   - Existe mais incomplète ou buguée → l'améliorer/corriger, sans tout réécrire si une
     partie fonctionne déjà.
   - Existe et correspond déjà à la fiche → le dire explicitement et passer à l'étape 3
     sans coder inutilement.
3. **Câbler les dépendances.** Une fonctionnalité isolée ne sert à rien dans un ERP
   (rappel du principe posé en `CLAUDE.md` §0). Après l'avoir codée ou corrigée, vérifier
   et relier explicitement tout ce qui doit la consommer ou l'alimenter : écrans, calculs,
   exports, journal d'audit, moteur de prévision. La fiche liste ces points de câblage sous
   « Ce qui doit être relié ».
4. **Annoncer avant de coder.** Comme pour les lots initiaux : lister les fichiers touchés
   et les décisions non triviales, attendre la validation, puis coder.
5. **Vérifier après coder.** `typecheck`, `test`, `lint` verts, plus le critère de fin propre
   à la fiche.

**Règle du porteur, reformulée le 01/08/2026 — le sens de circulation ne va que dans un sens :**
**0 régression · 0 suppression · 0 doublon · 0 code en dur.** Une fiche est un **document de
suivi**, pas un cahier des charges qui ferait autorité sur le code. Si l'application, en la
relisant, **fait plus** que ce que la fiche décrit, **ce n'est jamais un défaut à corriger en
retirant du code** : c'est la fiche qui est en retard. Dans ce cas, **complète-la** (section
datée, en fin de fiche) au lieu de réduire l'application à ce qu'elle décrivait. Symétriquement,
si la fiche décrit une décision jamais prise ou un chantier non câblé, dis-le explicitement plutôt
que de deviner. Cette moitié de la méthode — « si l'app en fait plus, compléter la fiche » — a été
absente de ce document pendant des semaines aux côtés de « vérifier l'existant avant de coder » ;
les deux sens sont désormais requis.

---

## Liste des fiches

| #   | Fiche                                                                        | Domaine                                  |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| 01  | Unités de masse en production                                                | Production                               |
| 02  | Rendu 1080p / 1440p                                                          | Interface, transverse                    |
| 03  | Bug — le stock ne se met pas à jour                                          | Stock (correctif urgent)                 |
| 04  | Édition complète des recettes                                                | Recettes                                 |
| 05  | Découverte automatique d'événements par l'IA                                 | Prévision                                |
| 06  | Prévision calendaire 365 jours et achats anticipés                           | Prévision, Stock                         |
| 07  | Rétention illimitée des ventes et précision du modèle                        | Prévision                                |
| 08  | Fiches concurrents                                                           | Nouveau module                           |
| 09  | Ajout manuel d'ingrédients et de garnitures                                  | Recettes, Stock                          |
| 10  | Refonte visuelle et intuitivité                                              | Interface, transverse                    |
| 11  | Profils utilisateurs et journal d'audit                                      | Sécurité, transverse                     |
| 12  | Suivi des économies d'achat (inspiré Mithra Pharmaceuticals)                 | Achats, Comptabilité                     |
| 13  | Coût complet et arbitrage entre lieux                                        | Comptabilité analytique, Lieux           |
| 14  | Les événements deviennent des opportunités (dépend de 13)                    | Prévision, Événements                    |
| 15  | Catalogue élargi : consommables, café, pâte vendue, toppings                 | Vente, Stock                             |
| 16  | Menus (fait) ; vente en ligne et avis clients (non commencés)                | Vente, Nouveau module                    |
| 17  | Énergie : gaz, électricité, solaire, empreinte physique                      | Comptabilité analytique, Équipements     |
| 18  | Succès, niveaux et objectifs                                                 | BI, transverse                           |
| 19  | Inspiration Big Ambitions : piloter ses stands (non commencée, délibérément) | Interface, transverse — direction future |

**Ordre de traitement conseillé — origine et mise à jour du 01/08/2026.**

Ordre d'origine, écrit quand il n'y avait que douze fiches et que rien n'était construit :
03 (bug bloquant) → 01 → 09 → 04 → 12 → 11 → 02/10 → 05 → 06 → 07. Le bug du stock fausse
toute donnée en aval (prévision, compta analytique, AFSCA) : c'est la raison pour laquelle
cette fiche ne devait pas attendre.

**Cet ordre a vieilli, sur deux points :**

1. **Il ne couvre pas les fiches 13 à 19**, absentes du dépôt au moment de sa rédaction.
2. **Il suppose que rien n'est fait**, ce qui n'est plus vrai. Les fiches 13 à 19 portent
   chacune, en tête, une « Note de statut » vérifiée contre le code — absente des fiches
   01 à 12, qui n'ont jamais reçu cette relecture. Vérifié directement pour les fiches 16 à
   19 lors de cette mise à jour : les **menus** (fiche 16 §2), l'**énergie/solaire/empreinte
   physique** (fiche 17), et les **succès/objectifs** (fiche 18) sont déjà largement
   construits et câblés ; seuls restent non commencés la **vente en ligne** et les **avis
   clients** (fiche 16 §3-4, bloqués par une décision RGPD non prise) et **toute la fiche 19**
   (non commencée **délibérément**, décision du porteur : l'application de base d'abord).
   Pour les fiches 13 à 15, leurs propres notes de statut (non revérifiées par cet agent —
   hors de sa zone d'écriture, trois autres agents y travaillent) indiquent également un
   cœur déjà implémenté (D-059, D-060).

**Conséquence : ce classement numéroté est une intention historique, pas une file d'attente
fiable.** Avant de traiter une fiche, lire sa propre note de statut quand elle existe, plutôt
que de se fier à sa position dans cette liste — des agents travaillent en parallèle sur
plusieurs fiches à la fois, et l'état réel bouge plus vite que cet index. Deux dépendances
explicites restent vraies indépendamment de l'ordre global : la fiche **14** dépend de la
fiche **13** (marge nette par lieu, sans laquelle une opportunité ne peut pas être classée),
et la fiche **16 §2** dépend de la fiche **15** (nomenclature de vente, dont un menu n'est
qu'un cas particulier). La fiche **19** se place explicitement en dernier par décision du
porteur, répétée deux fois (§1 et §6 de la fiche), après la fiche **10** (refonte visuelle) —
elle-même déjà programmée en dernier dans l'ordre d'origine (« 02/10 »).

---

## Ce qui a inspiré la fiche 12

Analyse du fichier `Réduction_coût_2022.xlsx` (Mithra Pharmaceuticals) fourni par
l'utilisateur : un classeur de suivi des économies d'achat, deux feuilles.

**Feuille « COST REDUCTION »** — 155 lignes de transactions, colonnes : mois, date, n° de
bon de commande (P/O), code produit (nomenclature ERP interne), désignation, fournisseur,
département, **type d'action de réduction de coût**, description de l'action menée, prix
unitaire avant, prix unitaire après, écart unitaire, quantité commandée, économie réalisée
en euros, cumul progressif.

**Feuille « CHART_COST REDUCTION »** — tableau croisé dynamique : économie totale sur la
période en tête de page, ventilation mensuelle par type d'action, total par type d'action.

**Trois types d'action identifiés** : négociation de prix, achat d'une alternative moins
chère, remplacement par du stock déjà immobilisé (ex. réutilisation d'un excédent existant
plutôt qu'un nouvel achat).

Le mécanisme est directement transposable : chaque réception ou négociation fournisseur peut
enregistrer un « avant/après » et une économie, agrégée ensuite dans un tableau de bord dédié.
Détail complet en fiche 12.
