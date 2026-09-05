# 01 — Spécification fonctionnelle

## Principe directeur

L'application suit le **cycle réel d'une semaine de marché**. Chaque écran correspond à un
moment précis de ce cycle, pas à une entité de base de données.

```
Lundi–jeudi      →  Analyse de la session passée, décisions d'achat, commandes fournisseurs
Vendredi         →  Prévision de la session à venir → ordre de production
Samedi           →  Production de la pâte → sortie de stock automatique
Dimanche         →  Marché (pas de saisie sur place)
Dimanche soir    →  Clôture : ventes, invendus, températures, frais → écarts calculés
```

---

## Module 1 — Recettes & fiches techniques

**Objet.** Le référentiel qui rend tout le reste calculable.

### Fonctions

- Créer une recette avec ses lignes d'ingrédients pour un **rendement de référence**
  (ex. « pour 6 crêpes », « pour 5 L de pâte »).
- **Mise à l'échelle** dans les deux sens : depuis un nombre de crêpes cible, depuis un
  volume de pâte, ou depuis une quantité d'ingrédient limitante (« il me reste 4 kg de
  farine, ça me fait combien ? »).
- **Versionnage** : une recette modifiée crée une nouvelle version. Les productions passées
  restent rattachées à la version utilisée le jour même. Sans cela, tout recalcul historique
  de coût est faux.
- Calcul automatique du **coût matière** de la recette au CUMP courant des ingrédients,
  et du coût par crêpe.
- Calcul automatique des **allergènes** par agrégation des allergènes des ingrédients,
  sur la liste réglementaire des 14.
- Champ « perte de cuisson » et « taux de casse » paramétrables par recette : le rendement
  théorique n'est jamais le rendement réel, et l'écart doit être modélisé, pas subi.

### Documents générés

- Fiche technique de recette (PDF) : ingrédients, procédé, rendement, allergènes, coût.
- **Affichette allergènes** (PDF A4/A5) prête à afficher sur le stand — obligation AFSCA.
- Étiquettes de bac de pâte (PDF) : recette, date/heure de production, DLC, n° de lot.

> **Mise à jour du 30/07/2026 — partiellement corrigé.** Les trois gabarits ont désormais une
> route dans `apps/api/src/routes/documents.ts` : fiche technique (`GET /documents/fiche-technique/:id`,
> `documents.ts:111`), affichette allergènes (`GET /documents/affichette-allergenes`, `documents.ts:139`),
> étiquette de bac (`GET /documents/etiquette-bac/:id`, `documents.ts:169`). Côté écran, vérifié par
> grep sur `apps/web/src` : l'affichette a un bouton (`RegistreAfsca.tsx:2508`, via le composant
> `BoutonDocument`) et l'étiquette de bac aussi (`Production.tsx:1389`). La fiche technique de recette
> reste sans bouton — aucun usage de `BoutonDocument` avec `fiche-technique` trouvé dans `apps/web/src`.

---

## Module 2 — Fournisseurs, achats et stock

**Objet.** Savoir en permanence ce qu'il y a en stock, ce que ça a coûté, et quand il faut
recommander.

### Fiche ingrédient

Unité de référence, densité (pour les conversions volume↔masse), allergènes, conditionnements
disponibles, fournisseurs référencés avec leur prix, **délai de livraison en jours**,
**stock de sécurité**, **point de commande**.

### Entrées

Saisie d'une réception : fournisseur, date, lignes (ingrédient, quantité, prix, n° de lot,
DLC). Chaque ligne crée un **lot** de stock. Le prix met à jour le CUMP.

Assistance Claude optionnelle : photo ou PDF d'un bon de livraison → proposition de lignes
pré-remplies, **toujours à valider ligne par ligne avant enregistrement**.

### Sorties

Automatiques à la production (voir module 3). Manuelles pour : casse, perte, DLC dépassée,
consommation personnelle. Chaque sortie manuelle exige un motif — c'est ce qui alimente
l'analyse d'écart.

### Inventaire

Écran de comptage périodique. L'écart entre stock théorique et stock compté est enregistré
comme un mouvement d'ajustement motivé, jamais comme une correction silencieuse.

### Réapprovisionnement automatique

Calcul quotidien du **point de commande** par ingrédient :

```
point_de_commande = consommation_moyenne_journalière × délai_livraison_jours + stock_sécurité
```

La consommation moyenne journalière est dérivée de l'historique de production réel, pas d'une
saisie manuelle. Quand le stock projeté passe sous le point de commande, l'application :

1. crée un **brouillon de commande** groupé par fournisseur ;
2. calcule la quantité à commander en tenant compte des conditionnements réels
   (on ne commande pas 17 kg quand le sac fait 25 kg) ;
3. notifie l'utilisateur ;
4. **après validation humaine explicite**, envoie le bon de commande par mail (PDF joint).

> L'envoi automatique sans validation est volontairement exclu. Une commande partie par erreur
> chez un meunier coûte plus qu'un clic.

### Documents générés

- Bon de commande fournisseur (PDF, envoyé par mail)
- État de stock valorisé (PDF + Excel)
- Liste des lots arrivant à DLC (PDF)

> **Mise à jour du 30/07/2026 — partiellement corrigé.** Le bon de commande a désormais un bouton
> de consultation avant envoi : `apps/web/src/pages/Achats.tsx:750` (`BoutonDocument`, en plus de
> l'envoi déjà existant par mail). L'état de stock valorisé (Excel) a aussi une route et un bouton :
> `GET /exports/stock` (`apps/api/src/routes/documents.ts:269`) et `Stock.tsx:732`. **Toujours
> vrai** : aucun gabarit ni route n'existe pour la liste des lots arrivant à DLC — vérifié par grep
> sur `apps/api/src/documents` et `apps/api/src/routes` : aucune occurrence de ce document.

---

## Module 3 — Production

**Objet.** Transformer un ordre de production en sortie de stock tracée.

### Parcours

1. L'application propose un **ordre de production** issu du moteur de prévision
   (voir `03-MOTEUR-PREVISION.md`) : « R1 : 5,0 L — R2 : 3,5 L ».
2. L'utilisateur ajuste s'il le souhaite, avec obligation de motiver un écart important.
   Le motif est réutilisé plus tard pour améliorer le modèle.
3. **Contrôle de faisabilité** avant lancement : le stock permet-il cette production ?
   Sinon, l'écran affiche l'ingrédient limitant et la quantité maximale réalisable.
4. Validation → consommation automatique des lots en **FEFO**, création des mouvements de
   sortie, création d'un **lot de pâte** avec DLC à 24 h.
5. Saisie du **réalisé** : volume effectivement obtenu, quantité d'ingrédient réellement
   utilisée si différente. L'écart théorique/réel est enregistré.

### Ce que ça produit

Un lot de pâte identifié, une consommation de stock tracée, et la matière première du calcul
de coût de revient réel.

---

## Module 4 — Sessions de marché

**Objet.** Le point où l'argent, la matière et la prévision se rencontrent.

### Avant la session

- Fiche de session : date, lieu, horaires, frais d'emplacement, météo prévue, événements actifs.
- **Brief avant-marché** (PDF, une page) : prévision, ordre de production, stock à emporter,
  points de vigilance, checklist de départ.

### Après la session (saisie du dimanche soir)

- **Ventes par produit** : ligne par ligne (produit = recette + garniture), quantité, prix.
  Saisie clavier rapide, totaux en direct.
- **Rapprochement encaissement** : total espèces + total SumUp doivent correspondre au total
  des ventes saisies. Écart affiché immédiatement, pas au moment du bilan mensuel.
- **Invendus et casse** : crêpes non vendues, pâte restante, pâte jetée.
- **Relevés de température** de la glacière (voir module 6).
- Frais du jour : emplacement, gaz, déplacement, divers.

### Ce que l'application calcule ensuite

- CA réel, coût matière réel valorisé au CUMP, marge brute, marge nette après frais.
- **Taux d'écoulement** : vendu / produit. C'est l'indicateur qui pilote la prévision suivante.
- **Écart théorique/réel** de consommation : ce que la recette prévoyait vs ce qui est sorti.
  Un écart persistant signale une louche trop généreuse, une casse sous-estimée ou une recette
  mal calibrée.
- Panier moyen, mix produits, CA/heure, **marge nette par heure de présence** — le seul
  chiffre qui dit vraiment si la session valait le coup.

### Documents générés

- Brief avant-marché (PDF)
- Rapport de session (PDF)

> **Mise à jour du 30/07/2026 — partiellement corrigé.** Le rapport de session a désormais une
> route ET un bouton : `GET /documents/rapport-session/:id` (`apps/api/src/routes/documents.ts:205`),
> consommé par `apps/web/src/pages/Sessions.tsx:2940` (`BoutonDocument`). **Toujours vrai** pour le
> brief avant-marché : la route existe (`GET /api/prevision/brief`, `apps/api/src/routes/previsions.ts:314`)
> mais aucun bouton n'a été trouvé dans `apps/web/src/pages/ProchaineSession.tsx` (vérifié par grep
> de `BoutonDocument` et de `prevision/brief` sur tout `apps/web/src` : aucune occurrence hors ce
> fichier de route lui-même).

---

## Module 5 — Prévision et assistance IA

Le moteur est spécifié séparément dans `03-MOTEUR-PREVISION.md`. Ici, l'interface.

### Écran « Prochaine session »

- Prévision de fréquentation et de ventes, avec **intervalle P10 / P50 / P90**.
- **Quantité recommandée à produire**, calculée sur un critère économique explicite
  (arbitrage entre rupture et invendu), pas sur la moyenne.
- **Décomposition lisible des facteurs** : « base 118 crêpes × météo 1,15 × événement 1,30
  × saison 0,95 = 168 ». L'utilisateur doit pouvoir contester chaque facteur.
- Niveau de confiance affiché, fondé sur le nombre de sessions comparables observées.

### Où Claude intervient

| Usage                              | Nature                                                     |
| ---------------------------------- | ---------------------------------------------------------- |
| Commentaire de prévision           | Texte court expliquant le raisonnement et les risques      |
| Analyse d'écart post-session       | « Pourquoi 30 crêpes de moins que prévu ? »                |
| Aide à la saisie d'événements      | Recherche et structuration des événements liégeois à venir |
| Lecture de bons de livraison       | Extraction structurée, à valider                           |
| Synthèse mensuelle / trimestrielle | Lecture croisée des indicateurs                            |

Claude reçoit **des données agrégées, pas la base entière**. Chaque appel est journalisé
(prompt, réponse, tokens, coût) dans `journal_ia`.

> **Mise à jour du 30/07/2026 — partiellement corrigé, un usage sur cinq découvert câblé au-delà de
> ce que les audits précédents avaient constaté.** `apps/api/src/ia/usages.ts` n'implémente que
> 3 des 5 consignes (`commentaireDePrevision` → usage `prevision`, `analyseEcart` → usage
> `analyse_ecart`, `briefAvantMarche` → usage `synthese`, qui sert en réalité le brief avant-marché
> et non une synthèse mensuelle/trimestrielle). Mais **« Aide à la saisie d'événements » est
> désormais implémentée ailleurs** : `apps/api/src/routes/evenements-decouverte.ts:310-339` appelle
> réellement `anthropic.messages.create` avec l'outil `web_search`, journalise l'appel
> (`usage: 'evenements'`, `:339`) et expose une proposition que l'utilisateur valide — consommée par
> un écran dédié `apps/web/src/pages/PropositionsEvenements.tsx`, accessible depuis la navigation
> (« Propositions IA (événements) », `apps/web/src/composants/Navigation.tsx:49`). Ce fichier
> duplique volontairement le client Claude de `ia/client.ts` (commentaire `evenements-decouverte.ts:33-44`,
> signalé pour fusion). **Restent absents**, vérifiés par grep sur tout le dépôt hors tests :
> « Lecture de bons de livraison » (aucune occurrence de production pour l'usage `extraction`) et
> « Synthèse mensuelle / trimestrielle » (aucune fonction ni route dédiée ; seul le mot « trimestriel »
> apparaît dans un commentaire sans rapport, `apps/web/src/pages/Comptabilite.tsx:954`).

### Événements

Table saisie manuellement (Les Ardentes, braderies, jours fériés, matchs du Standard, grèves,
travaux sur le quai…), avec portée géographique, intensité estimée et, après coup,
**impact mesuré**. Le modèle apprend l'impact réel, il ne se fie pas à l'estimation initiale.

Claude peut proposer une liste d'événements à venir à partir d'une recherche ; l'utilisateur
valide. Aucune insertion automatique.

---

## Module 6 — Registre AFSCA

**Objet.** Produire le registre d'autocontrôle exigé pour la vente ambulante avec préparation
sur place, sans effort supplémentaire, parce que les données sont déjà là.

- **Relevés de température** : glacière au départ, à l'arrivée, en cours de session, retour.
  Saisie rapide, alerte visuelle au-delà de 7 °C.
- **Traçabilité** : chaîne complète lot fournisseur → lot de pâte → session de vente,
  reconstituable en un clic pour n'importe quelle date.
- **Plan de nettoyage** : tâches récurrentes, cases à cocher datées.
- **Non-conformités** : incident, action corrective, suivi.
- **Registre mensuel (PDF)** prêt à présenter en cas de contrôle.

> **Mise à jour du 30/07/2026 — corrigé.** Le registre mensuel a désormais une route
> (`GET /documents/registre-afsca?periode=`, `apps/api/src/routes/documents.ts:242`) et un bouton :
> `apps/web/src/pages/RegistreAfsca.tsx:2495` (`BoutonDocument`).

> Rappel réglementaire : la préparation sur place relève du régime d'**autorisation** AFSCA,
> pas du simple enregistrement, et le dossier se dépose auprès de l'UPC Liège au moins un mois
> avant la première vente. L'application ne dispense de rien, elle documente.

---

## Module 7 — Comptabilité

### Comptabilité générale (simplifiée, franchise de TVA)

- Journal des recettes (obligatoire) alimenté automatiquement par les sessions.
- Journal des achats alimenté par les réceptions.
- Dépenses hors matière : matériel, emplacement, carburant, assurances, formation, frais bancaires.
- **Registre des investissements** avec plan d'amortissement (le matériel ≈ 3 500 €).
- Mention légale « Régime particulier de franchise des petites entreprises — TVA non applicable »
  sur tout document sortant.

### Comptabilité analytique

C'est le cœur de la valeur ajoutée. Axes d'analyse :

| Axe                 | Question à laquelle il répond                                   |
| ------------------- | --------------------------------------------------------------- |
| Par recette         | Laquelle est réellement rentable, coût matière réel à l'appui ? |
| Par produit vendu   | Quelle garniture porte la marge ?                               |
| Par session         | Ce dimanche-là valait-il le déplacement ?                       |
| Par créneau horaire | Les deux dernières heures paient-elles leur temps ?             |
| Par canal           | Marché vs événement privé — écart de rentabilité                |
| Théorique vs réel   | Où fuit la matière ?                                            |

> **Mise à jour du 30/07/2026 — partiellement corrigé.** L'axe « par créneau horaire » est désormais
> exploité : `apps/web/src/pages/Comptabilite.tsx` affiche un panneau « Ventes par créneau horaire »
> (colonnes `COLONNES_VENTES_CRENEAU:411`, chargement `chargerVentesParCreneau:764` depuis
> `GET /ventes-par-creneau`), servi par `ventesParCreneauBrutes`
> (`packages/db/src/depots/comptabilite.ts`, déjà cité par `docs/02`). Point non vérifié dans le
> temps imparti : l'axe « par canal » (marché vs événement privé) — `session_marche.evenement_id`
> existe en base mais je n'ai pas confirmé qu'une analyse par canal en soit dérivée à l'écran.

**Coût de revient complet par crêpe** : matière + emplacement + déplacement + gaz +
amortissement + commission SumUp, ramené au volume réel de la session.

> **Mise à jour du 30/07/2026 — toujours vrai, à ma connaissance.** Aucun agrégat combinant
> emplacement + déplacement + gaz + amortissement + commission carte n'a été trouvé par grep sur
> `packages/db/src/depots` et `packages/core/src` ; seul le coût matière (recette + garnitures) est
> agrégé par `GET /api/couts-produits` (`apps/api/src/routes/recettes.ts:110`).

### Tableau de bord des seuils

Compteurs glissants avec alerte à 80 % : franchise TVA (25 000 €), plafond Airbag (23 000 €),
cotisation réduite du complémentaire (17 374,08 €). Rappel du listing TVA au 31 mars.

> **Mise à jour du 30/07/2026 — corrigé, un quatrième seuil ajouté.** Le tableau de bord des seuils
> compte désormais 4 compteurs, pas 3 : `SEUILS` (`packages/db/src/depots/sessions.ts:300-358`)
> ajoute le seuil SCE / caisse enregistreuse certifiée (`seuil_sce_cents`, assiette `ca_sur_place`),
> affiché par le panneau « Seuils légaux » de `apps/web/src/pages/Sessions.tsx:1889` (servi par
> `GET /api/seuils`). Par ailleurs le seuil « cotisation réduite » compare désormais le REVENU NET
> (`assiette: 'revenu_net'`, `sessions.ts:334`) et non plus le CA comme les deux autres — l'erreur
> précisément décrite par `docs/07 §6.6` est corrigée dans le code, avec un écart chiffré à l'appui
> dans le commentaire (`sessions.ts:318-332` : facteur 2,31 entre les deux assiettes).

### Exports comptable

- Grand livre simplifié (Excel)
- Journaux recettes / achats (Excel + PDF)
- Récapitulatif annuel (PDF)
- Détail des amortissements (Excel)
- Export CSV générique paramétrable

> **Mise à jour du 30/07/2026 — partiellement corrigé.** Les journaux recettes et achats (Excel) ont
> désormais une route et un bouton : `GET /exports/journal-recettes` et `GET /exports/journal-achats`
> (`apps/api/src/routes/documents.ts:284,302`), consommés par `apps/web/src/pages/Comptabilite.tsx:1124,1129`
> (`BoutonDocument`). **Toujours vrai** pour le grand livre simplifié, le récapitulatif annuel, le
> détail des amortissements et l'export CSV générique : aucun gabarit, aucune route trouvés par grep
> sur `apps/api/src/documents` et `apps/api/src/routes`. Un cinquième export Excel non annoncé ici
> existe désormais par ailleurs : `GET /exports/economies` (`apps/api/src/routes/economies.ts:202`),
> bouton `apps/web/src/pages/Economies.tsx:962` — un export du suivi des économies d'achat (fiche 12),
> hors du périmètre décrit par ce module.

> Les seuils et taux viennent de la table `parametre`, avec date de validité et source.
> Un écran d'administration permet de les mettre à jour chaque année.

---

## Module 8 — Intégrations Google (lot ultérieur)

| Service   | Usage                                                        | Priorité                  |
| --------- | ------------------------------------------------------------ | ------------------------- |
| Calendar  | Calendrier des marchés, rappels de production et de commande | Haute                     |
| Drive     | Dépôt automatique des PDF/Excel générés, dossier par mois    | Haute                     |
| Sheets    | Export vivant pour le comptable                              | Moyenne                   |
| Gmail API | Envoi des commandes                                          | Basse — SMTP suffit en V1 |

OAuth 2.0 desktop, jetons chiffrés en local. **L'application doit fonctionner intégralement
sans compte Google connecté.**

---

## Écrans (arborescence cible)

```
Tableau de bord            Prochaine session, alertes stock, seuils, dernières marges
Prochaine session          Prévision, facteurs, ordre de production, brief PDF
Production                 Ordre → contrôle de faisabilité → validation → réalisé
Sessions                   Liste, saisie de clôture, rapport
Recettes                   Liste, édition, versions, mise à l'échelle, fiches PDF
Stock                      État valorisé, lots, DLC, mouvements, inventaire
Achats                     Fournisseurs, réceptions, commandes, envoi mail
Comptabilité               Journaux, analytique, seuils, exports
Registre AFSCA             Températures, nettoyage, traçabilité, non-conformités
Événements                 Calendrier, impacts estimés et mesurés
Paramètres                 Seuils légaux, tarifs, SMTP, clés API, sauvegarde
```

> **Mise à jour du 30/07/2026 — toujours vrai comme sous-ensemble, mais très incomplet.** Cette liste
> ne compte que 11 écrans. `apps/web/src/App.tsx:54-82` route aujourd'hui 28 écrans, et
> `apps/web/src/composants/Navigation.tsx:19-76` en affiche 25 dans la barre latérale, regroupés
> autrement (Pilotage/Exploitation/Référentiel/Contrôle/Paramètres). Absents de cette arborescence :
> Ingrédients, Nomenclature de vente, Menus, Concurrents, Propositions IA (événements), Lieux de
> marché, Équipements, Comparaison des lieux, Où aller ? (opportunités), Objectifs et succès,
> Économies d'achat, Factures fournisseur, Journal d'audit, Besoins projetés (prévision calendaire).
> Source de vérité désormais : `apps/web/src/composants/Navigation.tsx`, pas cette liste.

---

## Exigences non fonctionnelles

- **Sauvegarde** : copie horodatée du fichier SQLite à chaque démarrage, rétention 30 jours,
  plus un export manuel en un clic. Une base perdue, c'est un registre AFSCA perdu.
- **Import/export complet** en JSON, pour ne jamais être prisonnier de l'application.
- **Démarrage à froid** : jeu de données de démonstration installable, pour tester sans
  polluer les données réelles.
- **Performance** : tout écran sous 200 ms à l'échelle de plusieurs années de données.
  Le volume est petit ; la lenteur serait une faute de conception.
- **Accessibilité** : navigation clavier complète, contrastes suffisants.

> **Mise à jour du 30/07/2026 — toujours vrai (non corrigé).** Vérifié par grep sur tout le dépôt,
> hors tests, avec les motifs `exportJson`/`importJson`/`export.*json`/`import.*json` : aucune
> occurrence dans `apps/api/src`. Seule la sauvegarde **automatique** au démarrage existe
> (`packages/db/src/sauvegarde.ts`, rétention 30 jours confirmée à `sauvegarde.ts:12,172`) ; aucun
> bouton d'export manuel en un clic n'a été trouvé côté écran. Par ailleurs `docs/07 §6.4` relève que
> cette rétention de 30 jours est **insuffisante en droit belge** (10 ans pour le comptable, 2 ans
> après DLC pour l'AFSCA) — un défaut distinct, toujours ouvert lui aussi.
