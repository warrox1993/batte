# 17 — Vingt améliorations majeures, dérivées de ce qui est mesuré

> Document dérivé, écrit le 29/07/2026. **Aucun code n'a été modifié, aucun test écrit.**
> Rien ici n'est inventé : chaque fiche part d'un constat déjà mesuré dans `docs/08` à `docs/16`,
> d'un `it.fails` du dépôt, ou d'une limite assumée de `docs/05-DECISIONS.md`.
>
> **Toutes les fiches ont été revérifiées contre le code du 29/07/2026**, pas seulement lues dans
> les audits. Plusieurs défauts célèbres des audits ont été corrigés depuis leur rédaction — ils
> sont listés en §2 pour qu'on ne les rouvre pas.

---

## 1. Le filtre appliqué

`CLAUDE.md` §0 : « si une fonctionnalité d'ERP standard n'a pas d'usage concret le dimanche soir
après un marché, elle n'existe pas », et « la complexité est dans les calculs, jamais dans
l'interface ».

J'ai donc retenu une proposition **seulement si elle change une décision que le porteur prend** :
combien produire, quoi acheter, quel prix fixer, quoi déclarer, quand s'alarmer. Une proposition
qui rend un écran plus agréable sans déplacer une décision est écartée, et dite écartée (§6).

**Trente-et-un candidats sourcés ont été examinés. Vingt sont retenus. Onze sont écartés, avec
leur motif.** Aucune fiche n'a été fabriquée pour atteindre vingt : le §6 dit exactement où j'ai
arrêté, et pourquoi.

---

## 2. Ce qui a été corrigé depuis les audits — à NE PAS rouvrir

Vérifié dans le code du 29/07/2026. Les audits `docs/09` à `docs/16` décrivent un dépôt qui a
bougé sous eux ; ces points sont clos.

| Constat d'audit                                                              | Où c'était                    | État vérifié                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `rapprocherPrevision` n'est jamais appelée (`docs/15 §5`, rang 1 de l'audit) | `depots/previsions.ts:355`    | **Corrigé** — appelée dans la transaction de clôture, `services/sessions.ts:486`      |
| Le 3ᵉ seuil compare un CA à un seuil de revenu net (`docs/16 §1`)            | `depots/sessions.ts`          | **Corrigé** (D-054)                                                                   |
| L'alerte à 80 % n'existe pas, `statutParPlafond` orpheline (`docs/16 §2`)    | `core/affichage.ts:91`        | **Corrigé** — `TableauDeBord.tsx:322`                                                 |
| G3 — « Valider la commande » échoue en 400 (`docs/14 G3`)                    | `web/src/lib/api.ts`          | **Corrigé** — l'en-tête JSON n'est posé que si un `body` existe (`api.ts:120`)        |
| G8 — écran Paramètres en lecture seule (`docs/14 G8`, `docs/08-B`)           | `routes/parametres.ts`        | **Corrigé** — `PATCH /parametres/:id` et `POST /parametres/:cle/versions`             |
| G1/G4 — `production.session_id` toujours nul                                 | `routes/productions.ts`       | **Corrigé** — `PATCH /productions/:id/session`, `rattacherSession`                    |
| G6 — lots périmés marqués « Disponible »                                     | `web/pages/Stock.tsx`         | **Corrigé** — `Stock.tsx:190` affiche « Périmé »                                      |
| G14 — le mail « envoyé » ne l'a pas été                                      | `web/pages/Achats.tsx`        | **Corrigé** — `Achats.tsx:459` annonce le mode test et le chemin du fichier           |
| 15 documents écrits, 0 bouton (`docs/13 §2.3`)                               | `apps/api/src/documents/`     | **Corrigé** — `BoutonDocument.tsx` présent sur 6 écrans, routes Excel et PDF en place |
| Registre AFSCA mensuel inaccessible (`docs/13 §4.2`)                         | `documents/registre-afsca.ts` | **Corrigé** — route `routes/documents.ts:238`                                         |
| `produit_garniture` table morte (`docs/13 §4.1`, `docs/09 I6`)               | `schema.ts:328`               | **Corrigé** (D-053) — `services/garnitures.ts`                                        |
| Journal d'audit illisible (`docs/09 B3`, `docs/13`)                          | `depots/audit.ts`             | **Corrigé** — `routes/audit.ts` + `pages/JournalAudit.tsx`                            |
| Boucle d'achat jamais refermée, stock projeté doublé (`docs/09 B1`)          | `services/reception.ts`       | **Corrigé** (D-036)                                                                   |
| Colonnes d'argent en `REAL` (`docs/09 I2`)                                   | `schema.ts`                   | **Corrigé** — `integer`                                                               |
| `AUJOURD_HUI` figé au chargement du module (`docs/09 I3`)                    | 7 pages web                   | **Corrigé** — `web/src/lib/dates.ts`                                                  |
| Récurrence trimestrielle des échéances (`docs/09 I1`)                        | `core/comptabilite.ts`        | **Corrigé**                                                                           |
| Contraste des en-têtes de tableau, échec AA (`docs/08-A`)                    | `web/src/index.css`           | **Corrigé** — `ink-2`                                                                 |

### 2.1 État des vingt fiches au 29/07/2026, 18 h — À LIRE AVANT DE LANCER UN AGENT

Cette section est un **journal vivant**. Elle n'existait pas au départ, et son absence a coûté un
agent entier : lancé sur la fiche 7, il a constaté que le correctif était déjà en place et n'a rien
eu à faire. **Tenir ce tableau à jour après chaque livraison** coûte moins cher que de le découvrir
en lisant un rapport.

**Mise à jour du 29/07/2026, 18 h : les vingt fiches ont été revérifiées une à une contre le code
réel (lecture directe, pas de confiance dans un état précédent). Les vingt sont désormais
CORRIGÉES.** Le tableau ci-dessous cite, pour chacune, le fichier qui porte la preuve.

| Fiche                                             | État        | Détail vérifié le 29/07/2026, 18 h                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** — contrainte de stock                       | **CORRIGÉ** | `stockMaximalCrepes: plafondStockCrepes(base, session.dateSession)` câblé, plus de `null` en dur (`apps/api/src/routes/previsions.ts:977`)                                                                                                                                                     |
| **2** — trous de la grille météo                  | **CORRIGÉ** | catégories `ensoleille_tiede`/`ensoleille_frais` créées avec clés de catalogue dédiées (`packages/core/src/prevision/meteo.ts`) ; le facteur mesuré prime sur le prior via validation croisée (D-059)                                                                                          |
| **3** — saison et tendance à 1,00                 | **CORRIGÉ** | modules réels `saison.ts` et `tendance.ts`, mesurés et validés en leave-one-out, câblés dans `apps/api/src/routes/previsions.ts` (« non modélisée » explicite tant que le minimum n'est pas atteint)                                                                                           |
| **4** — impact d'événement jamais mesuré          | **CORRIGÉ** | `evenement.impact_mesure_bp` désormais écrit à la clôture (`packages/db/src/depots/previsions.ts:768`)                                                                                                                                                                                         |
| **5** — sortie du moteur = plan de production     | **CORRIGÉ** | `repartitionProduction`/`planProduction` réels (`packages/core/src/prevision/repartition-production.ts`), câblés dans la route (`apps/api/src/routes/previsions.ts:1062`), plancher sans gluten inclus ; omis explicitement si les données sont insuffisantes, jamais une répartition inventée |
| **6** — révisions météo perdues                   | **CORRIGÉ** | schéma migré (**D-058**, `horizonJours` dans l'index unique de `meteo_observation`) ; horizon calculé et écrit à la récupération (`packages/db/src/depots/previsions.ts`, `horizonJoursReleve`)                                                                                                |
| **7** — `coutParCrepeCents` rend 0                | **CORRIGÉ** | rend `null` (jamais `0`) quand `crepesVendables = 0` ou le coût matière est inconnu (`packages/core/src/recettes.ts:266-269`) ; aucun `it.fails(` actif dans tout le dépôt (recherche exhaustive)                                                                                              |
| **8** — `npm run backtest` inexistant             | **CORRIGÉ** | la commande existe (`package.json`), rejoue l'historique et sort les six indicateurs demandés par `docs/03` (`packages/db/src/scripts/backtest.ts`)                                                                                                                                            |
| **9** — consommation réelle par ingrédient        | **CORRIGÉ** | `quantiteReelle` désormais écrite par le service de production, plus seulement `null` (`packages/db/src/services/production.ts:632`)                                                                                                                                                           |
| **10** — clôture contredisant la production       | **CORRIGÉ** | `resoudreCrepesProduites` dérive/valide `crepesProduites` depuis les productions rattachées, refuse un écart non motivé (`packages/db/src/services/sessions.ts`) ; ancien `it.fails` retiré (**D-057**, `parcours-erp.test.ts`)                                                                |
| **11** — panier moyen impossible                  | **CORRIGÉ** | champ `nbTickets` saisissable en clôture (`apps/web/src/pages/Sessions.tsx`), panier moyen calculé quand renseigné, `—` sinon (**D-039**)                                                                                                                                                      |
| **12** — coût de revient mal nommé                | **CORRIGÉ** | `coutMatiereParCrepeCents` et `coutCompletParCrepeVendueCents` désormais distincts (`packages/core/src/sessions.ts:184-293`) ; l'ancien quotient mélangé (matière + revente + frais fixes) n'existe plus                                                                                       |
| **13** — créneau horaire jamais agrégé            | **CORRIGÉ** | agrégat par créneau réel (`apps/web/src/pages/Comptabilite.tsx`, `packages/db/src/depots/comptabilite.ts:1144`)                                                                                                                                                                                |
| **14** — trois tables de facture mortes           | **CORRIGÉ** | service de rapprochement complet (`packages/db/src/services/factures.ts`, `apps/api/src/routes/factures.ts`) ; les trois tables sont désormais lues et écrites                                                                                                                                 |
| **15** — relevé hors seuil sans non-conformité    | **CORRIGÉ** | `ecrireReleveTemperature` ouvre automatiquement une non-conformité liée, dans la même transaction (`packages/db/src/services/afsca.ts`) ; l'historique antérieur n'a **pas** été reconstitué (§7)                                                                                              |
| **16** — lot sans numéro ni DLC                   | **CORRIGÉ** | numéro de lot **OU** DLC précise exigé, sinon la réception est refusée (`packages/db/src/services/reception.ts:231-262`) ; avertissement non bloquant si la DLC seule identifie                                                                                                                |
| **17** — températures absentes de la clôture      | **CORRIGÉ** | bloc « Températures » ajouté à la clôture de session, rattaché à la session (`apps/web/src/pages/Sessions.tsx`, bloc `BlocReleveTemperature`)                                                                                                                                                  |
| **18** — destruction sans mouvement               | **CORRIGÉ** | `changerStatutLot(..., 'detruit', …)` écrit désormais un mouvement de perte dans la même transaction (`packages/db/src/services/mouvements.ts:368-433`)                                                                                                                                        |
| **19** — sauvegarde sans plancher ni restauration | **CORRIGÉ** | `restaurer()` avec vérification d'intégrité (`packages/db/src/sauvegarde.ts:243`), `purger` respecte un plancher configurable (`:176-187`) ; le second support (même disque) reste un geste opérateur, non un défaut de code — le dossier était déjà configurable                              |
| **20** — pointage d'échéance échouant en silence  | **CORRIGÉ** | le `catch` n'est plus silencieux : `etatEcheancesApresEchecPointage` affiche l'erreur sans recharger la liste (`apps/web/src/pages/Comptabilite.tsx:934-951`)                                                                                                                                  |

**Plus aucune fiche ouverte.** Les trois qui restaient « intouchées » à 13 h (3, 5, 8 — la zone
prévision) ont été livrées dans l'intervalle. Un agent qui lirait encore une version antérieure de
ce tableau referait un travail déjà fait : se fier à CETTE version, datée 18 h, pas à la mémoire
d'une conversation précédente.

> **Contrôle du 30/07/2026 — les vingt statuts tiennent, mais les `fichier:ligne` de ce tableau ont
> dérivé de quelques lignes. Ne pas conclure d'un numéro qui ne tombe pas juste que le correctif a
> disparu.**
>
> Le nombre de lignes des fichiers touchés a bougé pendant la nuit (plusieurs agents y écrivaient).
> Le symbole cité est toujours là, quelques lignes plus bas. Écarts mesurés sur un échantillon :
>
> | Cité dans ce document                                            | Position réelle au 30/07/2026                                      |
> | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
> | fiche 1 — `routes/previsions.ts:977`                             | `:979`                                                             |
> | fiche 9 — `services/production.ts:632`                           | `:642` (`.set({ quantiteReelle: … })`)                             |
> | fiche 18 — `services/mouvements.ts:368-433`                      | `changerStatutLot` déclarée `:418`                                 |
> | §2 ci-dessus — `rapprocherPrevision`, `services/sessions.ts:486` | `:1070`                                                            |
> | §2 ci-dessus — `statutParPlafond`, `TableauDeBord.tsx:322`       | `:449`, et via `statutSeuil` (`packages/core/src/sessions.ts:448`) |
>
> **Deux vérifications de fond, elles, confirmées sans réserve** : plus aucun `it.fails(` actif dans
> tout le dépôt (grep exhaustif `.ts` + `.tsx`, hors `node_modules`), ce qui soutient les fiches 7 et
> 10 ; et la fiche 14 (trois tables de facture mortes) est bien fermée — `packages/db/src/services/factures.ts`
> existe et écrit les trois tables.
>
> **Leçon pour la tenue de ce journal vivant** : un `fichier:ligne` est la bonne unité de preuve au
> moment où on l'écrit, et il périme en une nuit. Citer **le symbole** en plus du numéro
> (`changerStatutLot`, `.set({ quantiteReelle })`) rend la preuve revérifiable quand la ligne a
> bougé — c'est la forme à préférer désormais.

> **Deuxième contrôle du 30/07/2026 (mission de rattrapage du journal des décisions) — l'affirmation
> « plus aucun `it.fails(` actif dans tout le dépôt » ci-dessus est désormais FAUSSE, prise au pied de
> la lettre.** `packages/db/src/audit-colonnes-orphelines.test.ts` porte aujourd'hui **six**
> `it.fails(` actifs (grep exhaustif `it\.fails\(` sur `packages/` et `apps/`, hors `node_modules` :
> une seule correspondance de fichier, six occurrences dedans), tous ajoutés le 30/07/2026 par un
> audit distinct de colonnes orphelines : `reception.commandeId`, `mouvementStock.valuationDate`,
> `sessionFrais.justificatifPath`, `exerciceTracabilite.documentId`, la table `utilisateur`, et un
> sixième cas. **Ce qui reste vrai, précisément** : aucun de ces six ne porte sur les fiches 7
> (`coutParCrepeCents` rendant `0`) ni 10 (clôture contredisant la production) — les deux affirmations
> que cette phrase soutenait à l'origine tiennent donc toujours pour CES deux fiches précises. Ce qui
> ne tient plus, c'est la généralisation « dans tout le dépôt » : elle décrivait un état vrai à
> l'instant où elle a été écrite, pas un invariant. La convention maison (`it.fails` encode un défaut
> connu, non un oubli — voir l'en-tête de `audit-colonnes-orphelines.test.ts`) est d'ailleurs conçue
> pour que ce compteur ne reste JAMAIS à zéro bien longtemps sur un projet vivant : de nouveaux audits
> continueront d'en ajouter, à mesure que de nouveaux manques sont découverts.

---

## 3. Ordre de traitement recommandé

Le principe : **d'abord ce qui se perd, ensuite ce qui trompe, ensuite ce qui manque.**

Une donnée non collectée le dimanche est perdue pour toujours ; un chiffre faux affiché avec
aplomb coûte une décision par semaine ; une capacité absente coûte du confort. C'est cet ordre-là,
pas l'ordre de la difficulté.

| Phase                          | Fiches                 | Pourquoi cette phase d'abord                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Ce qui se perd**         | **19, 6**              | Une panne de disque emporte aujourd'hui le registre AFSCA, dont la conservation est de dix ans, et il n'existe aucune fonction de restauration. Chaque dimanche qui passe sans conserver les révisions météo est une donnée définitivement perdue pour le modèle. Ces deux-là coûtent **plus cher chaque semaine d'attente** ; aucune autre n'a cette propriété. |
| **1 — Ce qui trompe dimanche** | **1, 2, 7**            | Trois défauts qui faussent la seule décision hebdomadaire vraiment chère — combien produire — et qui coûtent peu à corriger. La fiche 1 est un `null` codé en dur sur une ligne.                                                                                                                                                                                 |
| **2 — Conformité**             | **16, 17, 15, 18, 20** | Risque réglementaire actif, pas théorique : un lot destructible sans mouvement, un lot créable sans numéro, une non-conformité qui se déclare inexistante. Le registre est la seule sortie opposable à un contrôle.                                                                                                                                              |
| **3 — Mesurer**                | **9, 10, 11**          | Ces trois-là **débloquent les autres** : sans consommation réelle, sans cohérence production/clôture et sans compteur de tickets, les fiches 12 à 14 mesurent du vide. À faire avant la phase 4.                                                                                                                                                                 |
| **4 — Le modèle**              | **3, 4, 5, 8**         | Les facteurs muets et l'apprentissage des événements. Placés après la phase 3 parce que `docs/15 §7` est formel : « sans mesure, aucune des suites n'est arbitrable ». Le rapprochement prévu/réalisé étant désormais branché (§2), la mesure commence enfin à s'accumuler — laisser passer quelques sessions avant de calibrer est un choix défendable.         |
| **5 — L'analyse**              | **12, 13, 14**         | Coût de revient, rentabilité horaire, prix d'achat réels. Utile, non urgent, et sans dépendance amont autre que la phase 3.                                                                                                                                                                                                                                      |

**Un préalable opérationnel, hors périmètre de ces fiches.** `docs/15 §2` note que le serveur de
production n'a pas été redémarré depuis la correction du moteur : l'instance qui tourne
n'exécute pas le code corrigé. Toute mesure d'impact prise sur l'écran avant redémarrage est à
considérer comme non représentative.

---

## 4. Tableau de synthèse — impact / coût

Coût : **S** = une à deux zones, pas de migration · **M** = plusieurs zones ou une donnée
nouvelle · **L** = migration de schéma ou reprise d'historique.

| #   | Amélioration                                                    | Décision changée                                     | Impact                                                                   | Coût  | Phase |
| --- | --------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ | ----- | ----- |
| 1   | La prévision ignore le stock disponible                         | Combien produire / commander mercredi                | Écart mesuré **163 crêpes**, 80 % de sa propre recommandation            | **S** | 1     |
| 2   | Trous de la grille des priors météo                             | Combien produire les beaux dimanches                 | ≈ **11 crêpes**, ≈ **33 €** par dimanche ensoleillé tiède                | S     | 1     |
| 3   | Facteurs saison et tendance muets à 1,00                        | Combien produire en décembre vs en août              | Non chiffrable avant mesure ; biais silencieux permanent                 | M     | 4     |
| 4   | L'impact des événements n'est jamais mesuré                     | Combien produire un jour d'événement                 | « Le mécanisme d'apprentissage le plus rentable du système » (`docs/03`) | M     | 4     |
| 5   | Pas de répartition R1 / R2                                      | **Quoi** produire, et le plancher sans gluten        | La sortie du moteur n'est pas un plan de production                      | M     | 4     |
| 6   | Révisions météo J-7/J-3/J-1 non conservées                      | Aucune aujourd'hui — mais la donnée se perd          | **Coût croissant** : une donnée perdue par dimanche                      | M     | 0     |
| 7   | `coutParCrepeCents` rend `0` au lieu de `null`                  | Combien produire (via le ratio critique)             | Un `0` passe le filtre et tire le coût moyen vers le bas                 | S     | 1     |
| 8   | `npm run backtest` n'existe pas                                 | Aucune directement — rend les fiches 2-5 arbitrables | Sans lui, toute calibration est une opinion                              | M     | 4     |
| 9   | La consommation réelle n'est jamais saisie                      | Où fuit la matière, quel prix fixer                  | Colonne affichée qui restera un tiret à vie                              | M     | 3     |
| 10  | La clôture accepte des crêpes contredisant la production        | Fiabilité de la marge et du taux d'écoulement        | Ressaisie non contrôlée, `it.fails` ouvert                               | S     | 3     |
| 11  | Pas de compteur de tickets à la clôture                         | Assortiment, prix, taille de panier                  | Panier affiché ≈ **5,50 €** contre ≈ **11 €** réels                      | S     | 3     |
| 12  | « Coût de revient par crêpe » mélange revente et frais fixes    | Le prix de vente d'une crêpe                         | Suggère **40 %** de marge là où §6 annonce **90 %**                      | S     | 5     |
| 13  | Le créneau horaire est stocké et jamais agrégé                  | **Rester ou non les deux dernières heures**          | Une session de 6 h 30 non arbitrée                                       | M     | 5     |
| 14  | Trois tables de facture mortes, CUMP figé au bon de livraison   | Changer de fournisseur, négocier                     | « Le meunier a-t-il augmenté ses prix ? » sans réponse                   | L     | 5     |
| 15  | Un relevé hors seuil n'ouvre pas de non-conformité              | Faut-il déclarer une rupture de chaîne du froid      | L'écran affirme **1 relevé non conforme** et **0 non-conformité**        | S     | 2     |
| 16  | Un lot peut naître sans numéro ni DLC                           | Traçabilité opposable                                | Viole `CLAUDE.md` règle 6 ; le trou remonte au registre                  | S     | 2     |
| 17  | Les températures ne sont pas dans l'écran de clôture            | Remplir ou non le registre                           | **0 relevé** en base pour une session clôturée                           | M     | 2     |
| 18  | Détruire un lot ne crée aucun mouvement                         | Intégrité du stock et du registre                    | Viole `CLAUDE.md` règle 5 ; **devenu atteignable** depuis l'écran        | M     | 2     |
| 19  | Sauvegarde sans plancher, même disque, restauration inexistante | Que faire le jour où le disque lâche                 | Conservation légale **10 ans** contre rétention **30 jours**             | M     | 0     |
| 20  | `catch` muet sur le pointage d'une échéance réglementaire       | Croire avoir déclaré                                 | Listing clients TVA au 31/03                                             | S     | 2     |

---

## 5. Les vingt fiches

### 1 — La prévision recommande une production que le stock ne permet pas

**Constat mesuré.** `docs/14 G7` et `docs/15 §1.8` (point 3). Le mercredi, « Aucun ingrédient sous
le point de commande ». Le dimanche, cible 203 crêpes → « Volume maximal réalisable avec le stock
actuel : 3,0 L », soit **40 crêpes**. Écart **163 crêpes, 80 % de la recommandation**.

**Cause, vérifiée le 29/07/2026.** `apps/api/src/routes/previsions.ts:190` passe
`stockMaximalCrepes: null` **en dur**. Le moteur sait pourtant consommer cette contrainte :
`packages/core/src/prevision/moteur.ts:424` la déclare et `:459` l'applique comme plafond. La
capacité est écrite et testée ; c'est l'appelant qui lui donne `null`.

**Pourquoi c'est majeur.** L'encadré « CE QUI VOUS LIMITE » liste la capacité de cuisson (331) et
celle de la glacière (240) — jamais le stock, qui est ici la contrainte la plus basse de très
loin. Le porteur découvre le manque le dimanche matin, quand plus aucun fournisseur n'est ouvert.
`docs/15` classe ce défaut « le pire mode de défaillance possible ».

**Impact chiffré.** Le moteur mesure lui-même une rupture à **2,98 € de marge par crêpe**
(relevé sur l'API de production le 29/07). Une rupture de 20 crêpes vaut donc ≈ **60 €**. Au-delà
du montant : c'est la commande du mercredi qui change.

**Zones de code.** `apps/api/src/routes/previsions.ts` (calcul du plafond stock à partir de la
faisabilité, puis passage au moteur) · `apps/web/src/pages/ProchaineSession.tsx:353` (la contrainte
apparaît alors seule dans le tableau existant, `contrainteLimitante` la désignera d'elle-même).

**Critère de fin.** Sur une base où le stock ne permet que 40 crêpes, l'écran Prochaine session
affiche « ▲ stock disponible — contrainte limitante » avec le plafond, et la recommandation ne
dépasse pas ce plafond sans l'annoncer.

**Dépendances.** Aucune en amont. **Recoupement partiel à connaître** : `docs/demandes/06` §3
(« point de commande prédictif ») traite le **versant approvisionnement** — commander à l'avance
pour un pic connu. La présente fiche traite le **versant recommandation** — ne pas recommander ce
qu'on ne peut pas produire, et le dire. Les deux sont complémentaires et ne se recouvrent pas ;
faire celle-ci d'abord, elle coûte une ligne et rend la fiche 06 plus lisible.

---

### 2 — La grille des priors météo a deux trous, et ils tombent sur les meilleurs dimanches

**Constat mesuré.** `docs/15 §1.2`. `docs/03` donne un facteur au temps ensoleillé **entre 10 et
22 °C**, puis **au-delà de 26 °C**, et rien entre les deux ; idem entre 5 et 10 °C. Ces conditions
retombent sur `couvert_sec`, facteur **1,00**.

**Preuve en production, relevée le 29/07/2026 sur `GET /api/prevision`** :

```
"conditions": { "temperatureC": 25.3, "couvertureNuageuseBp": 1300 },
"categorie": "couvert_sec", "facteurBp": 10000
```

25,3 °C sous 13 % de nuages, classé « couvert et sec », facteur neutre. Le code le reconnaît
lui-même : `packages/core/src/prevision/meteo.ts:81-89` documente le trou et conclut « refermer
les trous demande un CHIFFRE ». Le libellé a été corrigé (l'écran ne dit plus « couvert » sur un
ciel dégagé) ; **le facteur, lui, ne l'a pas été.**

**Pourquoi c'est majeur.** Ce sont exactement les dimanches de forte affluence — beau temps tiède
— que le moteur traite comme neutres.

**Impact chiffré.** `docs/15 §6` propose `prevision_meteo_ensoleille_tiede_bp` = **11 000 bp
(×1,10)**. Sur la baseline actuelle de 105 crêpes, ×1,10 ajoute ≈ **11 crêpes** ; au coût de
rupture mesuré (2,98 €), ≈ **33 € de marge par dimanche concerné**. La valeur 1,10 reste **à
trancher par le porteur** : elle n'est pas déductible du code.

**Zones de code.** `packages/core/src/prevision/meteo.ts` (deux catégories à ajouter) ·
`packages/core/src/parametres.ts` (deux clés au catalogue, jamais de littéral).

**Critère de fin.** Un dimanche à 24 °C, ciel dégagé, produit une catégorie distincte de
`couvert_sec` et un facteur issu du catalogue, tracé dans le tableau « D'OÙ VIENT CE CHIFFRE ».

**Dépendances — CORRIGÉ le 29/07/2026, cette fiche se trompait.** Elle affirmait que « le porteur
doit fournir les deux valeurs ». **Faux** : interrogé, il a répondu que ces valeurs sont
précisément ce que l'application doit **apprendre** au fil des semaines — c'est la raison d'être
de la rétention illimitée de l'historique (fiche 07). Voir décision **D-059**.

Ce qui manque n'est donc pas un chiffre, c'est **un découpage et une boucle** :

1. créer les catégories `ensoleille_tiede` et `ensoleille_frais` avec un prior **neutre à 1,00**,
   explicitement marqué _non mesuré_ — sans ce découpage, ces conditions restent noyées dans
   `couvert_sec` et ne peuvent **jamais** être mesurées séparément ;
2. refermer la boucle prévu/réalisé pour qu'un facteur **mesuré** prime sur le prior ;
3. afficher lequel des deux est en usage.

**Ne jamais inventer un prior non neutre** : 1,00 assumé et signalé est honnête, 1,10 deviné serait
indistinguable d'une valeur mesurée une fois en base.

**À traiter avec la fiche 4** — c'est le même travail : `evenement.impact_mesure_bp` existe,
son commentaire décrit l'intention, et **aucun code ne l'écrit** (vérifié le 29/07 : zéro
`insert`/`update` sur cette colonne dans tout le dépôt).

---

### 3 — Les facteurs saison et tendance valent 1,00 sans le dire

**Constat mesuré.** `docs/15 §1.4` et `§1.5`. `packages/db/src/depots/previsions.ts:163` écrit
`saisonBp: BASE_POINTS` en dur. `tendanceBp` n'est jamais fourni par l'appelant et retombe sur le
neutre. Aucun coefficient mensuel, aucun calendrier de vacances scolaires belges, aucun jour
férié, aucune régression sur les dernières sessions.

**Pourquoi c'est majeur — et pourquoi c'est un défaut de conception, pas un manque.** `docs/15 §4`
le formule exactement : « le modèle dit quand il ne sait pas : ✔ pour σ, **non** pour les facteurs
saison / tendance, qui valent 1,00 **sans le dire** ». L'écran affiche « saison 1,00 », ce qui se
lit « la saisonnalité a été évaluée et jugée neutre ». Elle n'a pas été évaluée. Un dimanche de
décembre et un dimanche d'août sortent le même chiffre.

C'est le même travers que la fiche 15 (l'écran affirme deux choses contradictoires) et que la
fiche 12 (un indicateur mal nommé) : **l'application affiche une mesure là où elle n'en a pas.**

**Impact chiffré.** Non chiffrable avant d'avoir mesuré — et c'est précisément l'argument. Une
activité qui croît de 20 % sur un trimestre est prévue comme si elle stagnait, en sous-production
systématique et invisible. `docs/15 §6` propose `prevision_tendance_borne_bp` = 3000 (±30 %) et
`prevision_tendance_sessions_minimum` = 10.

**Zones de code.** `packages/db/src/depots/previsions.ts` (les deux facteurs) ·
`packages/core/src/prevision/` (régression bornée) · `packages/core/src/parametres.ts` (clés) ·
`apps/web/src/pages/ProchaineSession.tsx` (afficher « pas encore modélisée » plutôt que « 1,00 »,
comme l'écran sait déjà le faire ailleurs).

**Critère de fin.** Tant qu'un facteur n'est pas modélisé, le tableau « D'OÙ VIENT CE CHIFFRE »
affiche « non modélisée » et non « × 1,00 ». Dès que la tendance dispose du minimum de sessions,
elle sort une valeur bornée et traçable.

**Dépendances.** Phase 3 d'abord (mesure). La tendance exige un historique : sans le minimum de
sessions, elle doit se déclarer indisponible plutôt que neutre.

---

### 4 — L'impact d'un événement n'est jamais mesuré, donc jamais appris

**Constat mesuré.** `docs/15 §1.6`. Trois constats distincts, tous vérifiés :

1. la formule `f_événement = 1 + (portée × intensité × 0,05)` n'est implémentée nulle part ;
   `portee` et `intensiteEstimee` sont saisis, stockés, et **n'entrent dans aucun calcul** ;
2. `evenement.impact_mesure_bp` **n'a aucun écrivain dans tout le dépôt** ;
3. `packages/db/src/depots/previsions.ts:125` lit `impactMesureBp ?? impactEstimeBp` : **la branche
   mesurée est morte et la colonne restera `NULL` à vie**.

**Pourquoi c'est majeur.** `docs/03`, cité par l'audit : « c'est le mécanisme d'apprentissage **le
plus rentable du système** : il transforme une intuition en coefficient au bout d'une seule
observation ». Aujourd'hui le porteur estime à la main, à vie, et son estimation n'est jamais
confrontée au réel. Un événement mal estimé une fois le restera indéfiniment.

**Impact chiffré.** La première Fête des Ardentes surestimée de 40 % coûte une fournée entière
d'invendus ; sous-estimée de 40 %, elle coûte une rupture en milieu de journée. Le mécanisme
corrige l'erreur après **une** occurrence au lieu de jamais.

**Zones de code.** `packages/db/src/services/sessions.ts` (écrire l'impact à la clôture, dans la
transaction, formule donnée par `docs/15 §7` : `impact = réel / (baseline × f_météo × f_saison)`) ·
`packages/db/src/depots/previsions.ts` · `packages/core/src/parametres.ts`
(`prevision_evenement_pas_impact_bp` = 500).

**Critère de fin.** Après la clôture d'une session portant un événement,
`evenement.impact_mesure_bp` est renseigné, et la prévision suivante du même événement l'utilise
de préférence à l'estimation.

**Dépendances.** Fiche 3 (le facteur saison entre dans la formule de dénormalisation ; tant qu'il
vaut 1,00, l'impact mesuré absorbe silencieusement la saison). **Ne pas mesurer sur une session
`exclure_du_modele`** — même précaution que le rapprochement de prévision.
**Recoupement à connaître** : `docs/demandes/05` traite la **découverte** d'événements par l'IA ;
elle ne traite pas leur **mesure a posteriori**. Les deux sont complémentaires.

---

### 5 — La sortie du moteur est un nombre de crêpes, pas un plan de production

**Constat mesuré.** `docs/15 §1.9` : « `part_R2`, le lissage exponentiel, **le plancher de
sécurité sans gluten**, la conversion en litres arrondie au demi-litre : **rien n'existe** ». Le
type `ResultatPrevision` n'a pas de champ `repartition` ; `archiverPrevision` écrit
`repartitionRecettes: null`.

**Pourquoi c'est majeur.** R1 (froment) et R2 (sarrasin-châtaigne, **sans gluten**) n'ont ni le
même coût, ni les mêmes ingrédients, ni le même risque de rupture. Le porteur reçoit « 160 crêpes »
et convertit à la main en litres, sans plancher sans gluten. Or une rupture de R2 n'est pas une
rupture ordinaire : c'est un client cœliaque qui repart, et il ne revient pas.

**Impact chiffré.** `CLAUDE.md` §6 : R1 ≈ 0,33 €/crêpe, R2 ≈ 0,41–0,45 €/crêpe — jusqu'à **36 %**
d'écart de coût matière. Tant que le mix n'est pas prévu, le coût matière prévisionnel est faux,
donc le `Co` du newsvendor l'est aussi, donc le quantile cible l'est également. **Ce défaut
contamine la fiche 7.**

**Zones de code.** `packages/core/src/prevision/moteur.ts` (champ `repartition` au résultat) ·
`packages/db/src/depots/previsions.ts` (archivage) · `packages/core/src/parametres.ts`
(part R2, plancher sans gluten, pas d'arrondi) · `apps/web/src/pages/ProchaineSession.tsx`.

**Critère de fin.** L'écran Prochaine session affiche deux volumes en litres, arrondis au
demi-litre, dont un plancher R2 paramétrable, et la production peut être lancée depuis ces deux
chiffres sans conversion manuelle.

**Dépendances.** Fiche 9 (coût matière réel par recette). Bénéficie de `docs/demandes/04`
(édition des recettes) : R2 est aujourd'hui semée **vide et en brouillon**, donc inutilisable
tant que la fiche 04 n'a pas livré.

---

### 6 — Les révisions météo ne sont pas conservées, et la donnée se perd chaque dimanche

**Constat mesuré.** `docs/15`, section « données spécifiées et non collectées ». `docs/03`
demandait quatre relevés (J-7, J-3, J-1, matin même) « **pour mesurer a posteriori la sensibilité
de la prévision à la révision météo** ». La contrainte d'unicité `(lieu, date, type)` combinée à
`onConflictDoUpdate` n'en garde que **deux** (`prevision`, `reelle`), et **rien ne planifie les
quatre relevés**. `temperature_ressentie_c` et `probabilite_pluie_bp` existent en base et restent
`NULL`.

**Pourquoi c'est majeur — et pourquoi c'est en phase 0.** C'est le seul défaut de tout ce document
**dont le coût augmente avec le temps**. Tous les autres coûtent la même chose corrigés aujourd'hui
ou dans six mois. Celui-ci coûte, chaque dimanche, une observation qu'aucun développement ultérieur
ne pourra reconstituer. L'audit le dit sans détour : « chaque dimanche qui passe sans ce dispositif
est une donnée perdue pour toujours ».

**Impact chiffré.** Une session par semaine ⇒ **52 observations perdues par an**. La question
qu'elles permettraient de trancher — « la météo de J-7 vaut-elle qu'on décide dessus, ou faut-il
attendre J-1 ? » — commande la date à laquelle le porteur arrête sa production, donc la date à
laquelle il commande.

**Zones de code.** `packages/db/src/schema.ts` (contrainte d'unicité à élargir au type de révision)
· `apps/api/src/meteo/open-meteo.ts` · `packages/db/src/depots/previsions.ts`.

**Critère de fin.** Quatre relevés distincts coexistent pour une même session sans s'écraser, et un
écran ou un export permet de comparer la prévision J-7 au réalisé.

**Dépendances.** ⚠️ **Touche `packages/db/src/schema.ts` et exige une migration.** Un autre agent
travaille actuellement sur ce fichier : à séquencer, jamais en parallèle. C'est la seule fiche de
la phase 0 qui présente ce risque de collision.

---

### 7 — `coutParCrepeCents` rend `0` là où il devrait rendre `null`, et le zéro se propage

**Constat mesuré.** `it.fails` ouvert, `packages/core/src/invariants.test.ts:649`. Une cible de
volume trop petite pour sortir une crêpe vendable donne `crepesVendables = 0`,
`coutMatiereCents > 0`, et `coutParCrepeCents = 0`. L'écran affiche « 0,00 € / crêpe ».

**Pourquoi c'est majeur.** Le commentaire du test décrit la chaîne, et elle est sérieuse :
`packages/db/src/depots/previsions.ts` filtre les coûts par `c !== null` puis en fait la moyenne.
**Un `0` passe le filtre et tire la moyenne vers le bas.** Le coût matière moyen par crêpe est le
`Co` du modèle newsvendor : le sous-estimer fait **monter** le quantile cible, donc **surproduire**.

C'est aussi une incohérence interne du dépôt : `packages/core/src/stock.ts` refuse explicitement ce
raccourci — « un ingrédient épuisé n'a pas un coût de zéro, il n'a pas de coût » — et
`sessions.ts` l'évite pour le panier moyen. Seul `recettes.ts` l'admet.

**Impact chiffré.** À l'installation (aucune réception, donc CUMP à 0 partout), le coût matière par
crêpe vaut 0. D-034 amortit le cas extrême en rendant `ratioCritique` nul et en se rabattant sur le
paramètre, mais **le cas partiel — une recette sur deux à 0 — passe entre les mailles** et biaise
la moyenne sans qu'aucun garde-fou ne se déclenche.

**Zones de code.** `packages/core/src/recettes.ts:192` · `packages/db/src/depots/previsions.ts`
(le filtre doit aussi écarter les 0, ou n'avoir plus rien à écarter).

**Critère de fin.** Le `it.fails` de `invariants.test.ts:649` est retiré et le test passe au vert
en test de non-régression ; aucun coût nul n'entre dans la moyenne des coûts par crêpe.

**Dépendances.** Aucune. Corriger `recettes.ts` **fera passer le `it.fails` au rouge** — il faut
retirer le `.fails` dans le même commit, comme D-054 l'a fait.

---

### 8 — `npm run backtest` n'existe pas, donc rien de ce qui précède n'est arbitrable

**Constat mesuré.** `docs/04:98` annonce la commande en fin de Lot 5 ; `docs/15` la redemande.
Vérifié le 29/07/2026 : **aucune entrée `backtest` dans `package.json`**. Par ailleurs, sur les six
indicateurs de qualité demandés par `docs/03`, **trois sont codés** (erreur absolue, biais moyen,
couverture de l'intervalle) et **trois manquent** (MAPE glissante sur 10 sessions, taux de rupture,
taux d'invendu).

**Pourquoi c'est majeur.** Les fiches 2, 3, 4 et 5 demandent toutes de **choisir un chiffre** :
que vaut un dimanche ensoleillé à 24 °C, quelle borne pour la tendance, quel pas d'impact
événementiel. Sans rejeu de l'historique, ces chiffres sont des opinions. Avec, ce sont des
mesures. `docs/15 §7` : « sans mesure, aucune des suites n'est arbitrable ».

**Impact chiffré.** Indirect mais large : c'est ce qui permet de dire si les fiches 2 à 5 ont
amélioré ou dégradé la prévision. Sans lui, on ne le saura jamais.

**Zones de code.** `package.json` (script) · `packages/core/src/prevision/` (rejeu pur) ·
`packages/db/src/depots/previsions.ts` (les trois indicateurs manquants).

**Critère de fin.** `npm run backtest` rejoue l'historique clôturé et sort les six indicateurs ;
changer un paramètre météo et relancer montre l'effet chiffré sur l'erreur moyenne.

**Dépendances.** Le rapprochement prévu/réalisé est désormais branché (§2), donc la matière
commence à s'accumuler. `docs/15 §5` prévient qu'un **script de rattrapage** est nécessaire pour
les sessions déjà clôturées, sinon l'historique existant restera vide. À traiter dans cette fiche.

---

### 9 — La consommation réelle par ingrédient n'est jamais saisie

**Constat mesuré.** `docs/13 §4.8`, qualifié « le cas le plus trompeur ». Vérifié le 29/07/2026 :
`packages/db/src/services/production.ts:348` écrit `quantiteReelle: null` — **c'est la seule
écriture de cette colonne dans tout le dépôt**. Elle est pourtant lue en quatre endroits et
**affichée dans une colonne de tableau**, `apps/web/src/pages/Production.tsx:332`.

**Pourquoi c'est majeur.** Deux conséquences distinctes :

1. L'utilisateur voit une colonne « réel » **qui restera un tiret à vie**. Une colonne vide
   apprend à ne plus regarder le tableau.
2. L'écart théorique/réel **par ingrédient** — « où fuit la matière ? », `docs/01 §7`, ligne
   « Comptabilité analytique » de `CLAUDE.md` §0 — est **structurellement impossible**. Corollaire
   direct : `decomposerEcart` (`packages/core/src/production.ts:150`), écrite et testée, n'a
   aucun consommateur possible.

**Impact chiffré.** L'écart global existe déjà (le rendement réel est saisi, −5,0 % sur la
production testée). Ce qui manque est sa **décomposition** : un écart de −5 % réparti sur huit
ingrédients ne se corrige pas, le même écart imputé au beurre se corrige dès la fournée suivante.
C'est aussi la seule voie pour calibrer `perte_fixe_ml`, resté à 0 depuis D-019.

**Zones de code.** `packages/db/src/services/production.ts` (saisie du réel par ingrédient) ·
`packages/core/src/contrats/productions.ts` · `apps/api/src/routes/productions.ts` ·
`apps/web/src/pages/Production.tsx` (la colonne existe déjà, il faut la rendre saisissable).

**Critère de fin.** Après une fournée, le porteur peut saisir la quantité réellement consommée
d'au moins un ingrédient, `decomposerEcart` produit l'écart valorisé au CUMP, et la colonne cesse
d'afficher un tiret.

**Dépendances.** Aucune en amont. **Débloque** la calibration de `perte_fixe_ml` (D-019) et
alimente la fiche 12.

---

### 10 — La clôture accepte un nombre de crêpes qui contredit la production

**Constat mesuré.** `it.fails` ouvert, `packages/db/src/parcours-erp.test.ts:1174`, intitulé
« MAILLON ROMPU ». Le test montre qu'on peut clôturer une session en déclarant **9 999 crêpes
produites** alors qu'aucune production ne lui est rattachée, sans qu'aucune erreur ne soit levée.

**Pourquoi c'est majeur.** Le commentaire du test vise juste : `CLAUDE.md` §0 promet une chaîne
« sans ressaisie ». Or `cloturerSession` **redemande** `crepesProduites`, que `saisirRealise` a
déjà enregistré sous `production.crepes_reelles`. Rien ne rapproche les deux. La marge par crêpe
et le taux d'écoulement s'en trouvent faux, **en silence**.

**Ce qui a changé et rend la fiche réalisable.** Au moment où le test a été écrit, aucune
production n'était rattachable à une session. Depuis, `PATCH /productions/:id/session` existe (§2).
**Le rapprochement est désormais possible ; il n'est simplement pas fait.**

**Impact chiffré.** Sur la session testée, le testeur avait saisi la valeur cohérente — le défaut
n'est donc pas visible aujourd'hui. C'est exactement ce qui le rend dangereux : il ne se
manifestera qu'un dimanche à 21 h, sur une faute de frappe, et produira une marge fausse que rien
ne signalera.

**Zones de code.** `packages/db/src/services/sessions.ts` (`cloturerSession`) ·
`apps/web/src/pages/Sessions.tsx` (pré-remplir depuis la production rattachée plutôt que
redemander).

**Critère de fin.** Le champ « produites » est **pré-rempli** depuis les productions rattachées à
la session ; le modifier exige un motif d'écart explicite, sur le modèle du motif déjà exigé à la
saisie du réalisé. Le `it.fails` est retiré et devient un test de non-régression.

**Dépendances.** Le rattachement production→session doit être **effectivement utilisé** : si le
porteur ne rattache pas, il n'y a rien à pré-remplir. Prévoir le cas « aucune production
rattachée » sans bloquer la clôture.

---

### 11 — Le panier moyen ne peut jamais être calculé, faute d'un champ

**Constat mesuré.** `docs/14 G13`, `it.fails` ouvert `packages/core/src/invariants.test.ts:916`,
et `docs/09 I5`. Le contrat accepte pourtant déjà le champ :
`packages/core/src/contrats/sessions.ts:70` déclare `nbTickets`, et
`packages/db/src/services/sessions.ts:425` l'écrit. **Vérifié le 29/07/2026 : `Sessions.tsx` ne
contient aucune occurrence de `nbTickets` ni de `panierMoyen` en saisie.** L'API est prête, le
formulaire ne l'est pas.

**Pourquoi c'est majeur.** D-039 a délibérément choisi de rendre `panierMoyenCents` **`null`**
plutôt que de le calculer sur les articles, parce que le repli donnait **la moitié** du panier
réel. La décision est saine — mais elle laisse l'indicateur vide à vie tant que le champ de saisie
n'existe pas. Le porteur ne peut piloter ni son assortiment, ni ses prix.

**Impact chiffré.** `docs/09 I5`, sur la session type (838 € de CA, ≈ 134 crêpes) : panier affiché
≈ **5,50 €** contre un panier réel ≈ **11 €** — l'indicateur était divisé par le nombre moyen
d'articles par client. Le chiffre à saisir est lisible sur le terminal SumUp en fin de journée :
**une saisie, une fois par dimanche.**

**Zones de code.** `apps/web/src/pages/Sessions.tsx` (un champ dans le bloc CAISSE, à côté des
espèces et de la carte).

**Critère de fin.** Le formulaire de clôture porte un compteur de tickets ; renseigné, le panier
moyen s'affiche ; laissé vide, il affiche `—` et non `0`. Le `it.fails` de `invariants.test.ts:916`
est retiré.

**Dépendances.** Aucune. **La moins chère des vingt** : le contrat, le service et la base sont
déjà en place. Les sessions déjà clôturées resteront à `null` — c'est assumé par D-039.

---

### 12 — « Coût de revient par crêpe » n'est pas un coût de revient par crêpe

**Constat mesuré.** `docs/14 G12`. Affiché sur SM-2026-0003 : **1,93 €**. Recalcul du testeur :
`(19,20 € de sirop revendu + 0,51 € de commission + 42,00 € de frais) / 32 crêpes = 1,928 €`.
L'indicateur divise donc par le nombre de **crêpes** un total qui contient le coût d'achat des
**pots de sirop revendus** et l'intégralité des frais fixes de la journée. Vérifié le
29/07/2026 : `packages/core/src/sessions.ts:225` calcule toujours ainsi.

**Pourquoi c'est majeur.** Une crêpe vendue 3,00–3,50 € avec un « coût de revient » annoncé à
1,93 € suggère une marge de ~**40 %**, quand `CLAUDE.md` §6 annonce ~**90 %** sur le transformé.
C'est le chiffre sur lequel on décide d'augmenter un prix, d'abandonner une recette ou d'ouvrir une
gamme. Un facteur deux sur cette ligne conduit à la mauvaise décision commerciale.

**Impact chiffré.** Facteur ≈ **2** entre l'indicateur affiché et la marge réelle du transformé.
L'écart vient entièrement du mélange de trois natures de coût dans un seul quotient.

**Zones de code.** `packages/core/src/sessions.ts:168` et `:225` (séparer coût matière du
transformé, coût des marchandises revendues, et frais fixes) · `apps/web/src/pages/Sessions.tsx:470`
(renommer et, de préférence, afficher les trois lignes plutôt qu'un total agrégé).

**Critère de fin.** L'écran distingue « coût matière par crêpe » (comparable aux 0,33 € de §6) et
« coût complet par crêpe vendue », frais fixes inclus ; les deux sont nommés pour ce qu'ils sont.

**Dépendances.** Fiche 9 pour que le coût matière soit le réel et non le théorique. Bénéficie
de D-053 (garnitures), déjà livrée.

---

### 13 — Le créneau horaire est saisi, stocké, affiché — et jamais agrégé

**Constat mesuré.** `docs/13 §2.2` et `docs/01:237-243`. Vérifié le 29/07/2026 : `creneauHoraire`
est porté par le contrat (`contrats/sessions.ts:32`), écrit par le service
(`services/sessions.ts:325`), relu par le dépôt (`depots/sessions.ts:83`) et **affiché comme
colonne** (`Sessions.tsx:394`). **Aucun agrégat ne l'exploite.**

**Pourquoi c'est majeur.** `docs/01:238` pose la question exactement : « **les deux dernières
heures paient-elles leur temps ?** ». C'est une décision d'exploitation concrète et récurrente —
rester jusqu'à 14 h ou plier à 12 h 30 — qui engage du gaz, de la fatigue, et la durée de la
chaîne du froid passive. La donnée nécessaire est **déjà collectée**. Il ne manque que le
regroupement.

**Impact chiffré.** La session type dure **6 h 30** (`CLAUDE.md` §6). Si les deux dernières heures
produisent moins que leur part de frais, les couper améliore la marge horaire sans toucher au CA
proportionnellement. L'application détient les ventes horodatées par créneau et ne sait pas
répondre. Elle calcule déjà une marge par heure — mais globale, donc muette sur la question.

**Zones de code.** `packages/db/src/depots/comptabilite.ts` ou `depots/sessions.ts` (agrégat par
créneau) · `apps/api/src/routes/comptabilite.ts` · `apps/web/src/pages/Comptabilite.tsx`.

**Critère de fin.** Un tableau « CA et marge par créneau horaire », cumulé sur les sessions
clôturées, permet de comparer la dernière tranche horaire aux précédentes.

**Dépendances.** Aucune techniquement. Utile seulement une fois quelques sessions saisies avec
leurs créneaux — à vérifier avant de coder que la saisie du créneau est effectivement utilisée.

---

### 14 — Trois tables de facture mortes : le prix d'achat reste figé au bon de livraison

**Constat mesuré.** `docs/09 I10` et `docs/13 §B.1`. Vérifié le 29/07/2026 : `factureFournisseur`,
`factureLigne` et `fraisReception` n'apparaissent **que dans `packages/db/src/schema.ts`** —
aucune autre référence dans tout le dépôt. Elles porteraient le rapprochement à trois
commande / réception / facture, avec `facture_ligne.ecart_prix_cents` pour détecter un écart de
prix facturé et `frais_reception.methode_repartition` pour ventiler le transport sur les lots.

**Pourquoi c'est majeur.** Le schéma le dit lui-même : « le CUMP est figé par le prix saisi à la
**réception**, pas celui de la facture ». Conséquences directes :

- « **Le meunier a-t-il augmenté ses prix ?** » n'a pas de réponse dans l'application ;
- les **frais de port et de palette** n'entrent dans aucun coût, donc le coût matière est
  sous-estimé d'un montant que personne ne connaît ;
- un écart entre le prix commandé et le prix facturé n'est jamais détecté.

**Impact chiffré.** Non chiffrable en l'état — et c'est le constat. Toute la marge analytique
repose sur des prix qui ne sont **jamais confrontés à la facture réelle**. `docs/13` tranche : le
pire état est l'état actuel, où un lecteur du schéma croit la fonction présente.

**Zones de code.** `packages/db/src/services/` (nouveau service de rapprochement) ·
`apps/api/src/routes/` · un écran de saisie de facture. **Aucune migration nécessaire** : les trois
tables existent déjà au schéma.

**Critère de fin.** Saisir une facture fournisseur rapproche ses lignes des réceptions
correspondantes, affiche les écarts de prix, et ventile les frais de réception sur les lots
concernés.

**Dépendances.** La plus lourde des vingt — à ne pas engager avant la phase 3.
**Recoupement à connaître** : `docs/demandes/12` (économies d'achat, inspiré Mithra) enregistre un
« avant/après » de négociation. Les deux se nourrissent : le rapprochement de facture fournit le
prix réel « après » que la fiche 12 demande de saisir à la main. **Faire la fiche 12 d'abord** —
elle est plus simple et donne l'écran d'accueil du sujet.

---

### 15 — Un relevé hors seuil n'ouvre aucune non-conformité, et l'écran se contredit

**Constat mesuré.** `docs/14 G5`. Un relevé à 9,5 °C (seuil `temperature_max_froid_c` = 7) est
enregistré et affiché « ■ Non conforme ». L'onglet Non-conformités affiche simultanément :

```
0 NON-CONFORMITÉS
Aucune non-conformité déclarée. C'est la situation attendue.
```

Vérifié le 29/07/2026 : `packages/db/src/services/afsca.ts:65` calcule `conforme`, exige à juste
titre une action corrective quand il est faux — et **n'appelle jamais** `creerNonConformite`, qui
existe pourtant dans le même fichier.

**Pourquoi c'est majeur.** Une rupture de chaîne du froid à 9,5 °C **est** une non-conformité. Le
même écran affirme qu'il y en a une et qu'il n'y en a aucune, et la seconde phrase ajoute « c'est
la situation attendue » — donc **rassure à tort** sur un sujet où l'AFSCA attend une déclaration.
C'est le registre lui-même qui devient faux.

**Impact chiffré.** Risque réglementaire, non monétisable ici. Ce qui est certain : le porteur qui
lit « aucune non-conformité » ne déclarera rien, et le registre présenté à un contrôle omettra
l'incident que l'application avait pourtant détecté et horodaté.

**Zones de code.** `packages/db/src/services/afsca.ts` (ouvrir la non-conformité dans la même
transaction que le relevé hors seuil, en y reprenant l'action corrective déjà saisie) ·
`apps/web/src/pages/RegistreAfsca.tsx` (l'état vide ne doit plus affirmer « situation attendue »
quand des relevés hors seuil existent).

**Critère de fin.** Un relevé hors seuil crée une non-conformité liée, visible dans l'onglet, et
l'état vide n'apparaît que lorsqu'il n'existe **aucun** relevé hors seuil.

**Dépendances.** Aucune. Purement local à un service et à un écran.

---

### 16 — Un lot peut être créé sans numéro ni DLC, et le trou remonte au registre

**Constat mesuré.** `docs/14 G9`. Réception enregistrée avec « N° de lot fournisseur » et « DLC »
vides : `Réception RC-2026-0006 enregistrée — 1 lot créé`, **aucun avertissement**. Vérifié le
29/07/2026 : `packages/core/src/contrats/stock.ts:53` déclare `numeroLotFournisseur:
z.string().nullable()`.

**Preuve que le trou se propage**, relevée par le testeur dans le tableau « CONSOMMATIONS
(TRAÇABILITÉ DES LOTS) » :

```
Sucre vanillé   DÉMO-VANILLE-01   38 g   0,66
Sucre vanillé   —                 15 g   0,26
```

Une ligne de traçabilité dont le lot vaut « — ». Deux lots portent déjà
`numero_lot_fournisseur IS NULL` en base.

**Pourquoi c'est majeur.** `CLAUDE.md` règle 6 est explicite : « Toute entrée de marchandise crée
un lot (fournisseur, date de réception, **numéro de lot**, DLC). C'est une obligation
réglementaire, pas une élégance technique. » Un lot sans numéro est un lot qu'on ne peut pas
rappeler.

**Impact chiffré.** Un rappel fournisseur portant sur un lot non identifié oblige à retirer
**toute** la marchandise de l'ingrédient concerné, faute de pouvoir cibler. Le coût est le stock
entier au lieu d'un lot.

**Zones de code.** `packages/core/src/contrats/stock.ts` (rendre le champ obligatoire, ou exiger un
motif explicite du type « marchandise sans marquage ») · `packages/db/src/services/reception.ts` ·
`apps/web/src/saisie-stock/` (message de saisie).

**Critère de fin.** Enregistrer une réception sans numéro de lot est refusé, **ou** exige un motif
choisi dans le catalogue ; le motif est visible sur la ligne de traçabilité au lieu d'un tiret.

**Dépendances.** Aucune. **Attention à l'historique** : deux lots existants sont à `NULL` — prévoir
qu'ils restent lisibles sans bloquer les écrans.

---

### 17 — Les températures ne sont pas dans l'écran de clôture, et le registre reste vide

**Constat mesuré.** `docs/14 G11`. `docs/06` place explicitement le bloc TEMPÉRATURES dans l'écran
de session, avec sa raison : « **un registre qu'on remplit ailleurs est un registre qu'on ne
remplit pas** ». Vérifié le 29/07/2026 : **`Sessions.tsx` ne contient aucune occurrence de
« température »** (comptage : 0). Les relevés vivent uniquement dans Registre AFSCA, sur un
formulaire qui ne permet pas de les rattacher à une session — seulement à une date.

**Constat corroborant, décisif.** La base contient **0 relevé de température** pour une session de
démonstration pourtant clôturée avec chaîne du froid passive. La prédiction de `docs/06` s'est
vérifiée.

**Pourquoi c'est majeur.** Le registre de température est classé « minimum vital » par `docs/04`.
Le stand fonctionne en chaîne du froid passive (glacière rigide + blocs eutectiques) : le relevé
n'est pas une formalité, c'est la preuve que la chaîne a tenu. Un registre vide vaut un registre
absent.

**Impact chiffré.** Deux relevés par session (arrivée, fin) × 52 sessions = **104 relevés par an**
qui n'existent pas. Le geste demandé est de quelques secondes **s'il est au bon endroit**, et ne se
fait jamais s'il est ailleurs.

**Zones de code.** `apps/web/src/pages/Sessions.tsx` (bloc TEMPÉRATURES dans la clôture) ·
`packages/core/src/contrats/sessions.ts` · `packages/db/src/services/sessions.ts` (rattacher le
relevé à la session, pas seulement à une date) · `packages/db/src/services/afsca.ts`.

**Critère de fin.** La clôture d'une session permet de saisir les relevés d'arrivée et de fin ;
ils apparaissent dans le registre AFSCA rattachés à cette session, et le registre mensuel les
imprime.

**Dépendances.** Fiche 15 (un relevé hors seuil saisi ici doit ouvrir une non-conformité — même
mécanisme). Peut exiger une colonne `session_id` sur le relevé : **vérifier `schema.ts` avant**,
un autre agent y travaille.

---

### 18 — Détruire un lot le retire du stock sans écrire aucun mouvement

**Constat mesuré.** `docs/09 M9`. `changerStatutLot(…, 'detruit', …)`
(`packages/db/src/services/mouvements.ts:229`) met à jour le statut et **journalise correctement
dans `journal_audit`** — mais **n'écrit aucun mouvement de stock**. Or `packages/core/src/stock.ts`
filtre sur `statut === 'disponible'` : la quantité disparaît de la valorisation et du stock
courant sans qu'aucune ligne ne l'explique.

**Ce qui a changé, et qui fait passer ce point de latent à actif.** `docs/09` classait ce défaut
« latent : aucun appelant ne l'utilise aujourd'hui ». **Ce n'est plus vrai.** Vérifié le
29/07/2026 : la route `/lots/:lotId/statut` existe et l'écran `apps/web/src/saisie-stock/DetailLot.tsx`
l'appelle. Le jour redouté par l'audit est arrivé.

**Pourquoi c'est majeur.** `CLAUDE.md` règle 5 : « Le stock ne se modifie que par un mouvement.
Jamais d'`UPDATE` direct sur une quantité. Le stock courant est toujours la somme des mouvements.
**Cela rend l'historique auditable, ce qui est exactement ce que l'AFSCA demande.** » Détruire un
lot périmé est précisément le geste qu'un contrôle demandera à justifier — quantité, date, motif.
Aujourd'hui la quantité s'évapore.

**Impact chiffré.** Chaque destruction crée un écart silencieux entre la somme des mouvements et le
stock affiché — exactement l'invariant que `verifierInvariantLots` était censée contrôler, et qui
n'est jamais exécutée hors tests. La perte matière annuelle, elle, devient invisible : elle ne
figure ni en charge, ni dans l'écart de rendement.

**Zones de code.** `packages/db/src/services/mouvements.ts` (écrire un mouvement de sortie avec le
motif de destruction, dans la même transaction) · `packages/core/src/contrats/stock.ts` (le type de
mouvement peut manquer à l'énumération — **à vérifier dans `schema.ts` avant de coder**) ·
`packages/db/src/depots/stock.ts`.

**Critère de fin.** Détruire un lot de 500 g produit un mouvement de sortie de 500 g valorisé au
CUMP, motivé et daté ; `verifierInvariantLots` reste vraie après l'opération, et la perte apparaît
dans l'export des mouvements.

**Dépendances.** ⚠️ Peut exiger une valeur d'énumération au schéma → **collision possible avec
l'agent qui travaille sur `schema.ts`**. Vérifier avant de commencer.

---

### 19 — Sauvegarde sans plancher, sur le même disque, et aucune restauration

**Constat mesuré.** `docs/09 I9`, revérifié le 29/07/2026. Trois défauts distincts, tous ouverts :

1. `packages/db/src/sauvegarde.ts:137-151` — `purger` ne filtre que sur l'âge
   (`joursEntre(jour, aujourdHui) <= retentionJours`). **Aucun plancher « conserver au moins N
   sauvegardes »**. Une horloge système faussée, ou une absence prolongée, peut donc tout emporter.
2. Le dossier de sauvegarde est sur le **même disque** que la base (`DOSSIER_SAUVEGARDES=./sauvegardes`).
   Une panne matérielle emporte l'original **et** ses copies.
3. **Il n'existe aucune fonction de restauration dans tout le dépôt** — recherche exhaustive sur
   `restaurer` / `restore` : une seule occurrence, dans un commentaire. Rien ne documente ni ne
   teste le chemin du retour.

**Pourquoi c'est majeur — et pourquoi c'est en phase 0.** L'application est le registre AFSCA et la
comptabilité d'une entreprise. Le droit belge impose **dix ans** de conservation des documents
comptables (`docs/07:645`) ; la rétention configurée est de **trente jours**. Aucune décision de
`docs/05` ne tranche ce conflit. Et le jour où il faudra restaurer, personne n'aura jamais essayé.

**Impact chiffré.** `docs/09` mesure l'ampleur du dossier : **197 fichiers et 108 Mo en trois
jours**, soit ≈ **1,5 Go** au terme des 30 jours — pour une base de **720 Ko**. Le risque n'est
donc pas le volume, c'est l'absence de filet : perte du registre AFSCA et de l'historique fiscal
sur une panne de disque unique.

**Zones de code.** `packages/db/src/sauvegarde.ts` (plancher de conservation, second emplacement) ·
`packages/db/src/` (fonction de restauration + son test symétrique) · `.env.example` (documenter le
second support) · `apps/api/src/routes/` (sauvegarde et restauration à la demande, annoncées par
`docs/01:301-303` et absentes).

**Critère de fin.** Un test restaure une sauvegarde dans une base neuve et retrouve les mêmes
sessions, lots et relevés. `purger` conserve toujours au moins N sauvegardes quelle que soit leur
date. Le README indique où se trouve le second support.

**Dépendances.** Aucune. **La question des dix ans est une dépendance externe** : elle relève du
comptable (voir §7), mais le plancher, le second support et la restauration se font sans attendre
sa réponse.

---

### 20 — Pointer une échéance réglementaire peut échouer sans rien dire

**Constat mesuré.** `docs/16 §6.2`. Vérifié le 29/07/2026 :
`apps/web/src/pages/Comptabilite.tsx:802` :

```js
} catch {
  // Rafraîchissement simple : une échéance manquée n'a rien de bloquant,
  // l'utilisateur retente depuis la même ligne.
  chargerEcheances();
}
```

**Pourquoi c'est majeur.** Violation franche de `CLAUDE.md` §4 (« jamais de `catch` silencieux »),
aggravée par le contexte : ce bouton coche une obligation **réglementaire**. L'audit corrige le
raisonnement du commentaire : manquer une échéance n'a rien de bloquant, mais **croire l'avoir
pointée fait manquer la suivante**. Et c'est le rechargement dans le `catch` qui rend l'échec
invisible — l'écran se réaffiche, l'utilisateur croit que c'est passé.

**Impact chiffré.** Le listing clients TVA au **31 mars**, dû même à zéro (`CLAUDE.md` §6), et les
quatre échéances INASTI trimestrielles, dont le retard entraîne des majorations. Une case cochée
qui ne l'est pas coûte une majoration et une régularisation.

**Zones de code.** `apps/web/src/pages/Comptabilite.tsx:802`.

**Critère de fin.** Un échec du pointage affiche un message d'erreur en français ; le
rechargement **n'a pas lieu** dans le `catch`. Le type `EtatEcheances` porte **déjà** une variante
`{ statut: 'erreur'; message: string }` : il n'y a rien à ajouter au type.

**Dépendances.** Aucune. Correction d'une dizaine de lignes, la moins risquée du lot.

---

## 6. Ce que j'ai écarté, et pourquoi

Onze candidats sourcés, examinés puis rejetés. Ils sont listés pour que personne ne refasse le
travail de les redécouvrir.

### Écartés parce qu'une fiche de `docs/demandes/` les couvre déjà

| Candidat                                                              | Source                              | Fiche qui le couvre                                                                                                       |
| --------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Point de commande aveugle à la demande prévue                         | `docs/14 G7` (2ᵉ moitié)            | **`demandes/06` §3**, « point de commande prédictif ». Seul le versant _recommandation_ reste, il fait ma fiche 1.        |
| Référentiel non éditable : ni ingrédient, ni recette, ni lieu créable | `docs/13 §4.7`, `docs/09`           | **`demandes/04` et `demandes/09`**. C'est un trou majeur — R2 est semée vide et inutilisable — mais il est déjà instruit. |
| Rétention et précision de l'historique de ventes                      | `docs/15`                           | **`demandes/07`**                                                                                                         |
| Découverte d'événements et rayon réglable                             | `docs/15 §1.3` (versant saisie)     | **`demandes/05`**. Seule la _mesure_ a posteriori reste, elle fait ma fiche 4.                                            |
| Suivi des prix négociés fournisseur                                   | `docs/09 I10` (versant négociation) | **`demandes/12`**. Le rapprochement de facture reste, il fait ma fiche 14.                                                |

### Écartés parce qu'ils ne changent aucune décision

| Candidat                                                                                    | Source              | Motif                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Écart de caisse à **−50,00 €** sur un formulaire vierge                                     | `docs/14 G10`       | Réel et vérifié ouvert. Mais c'est un défaut d'**affichage d'un état vide**, pas un calcul faux : la formule est juste, l'absence de mesure est traitée comme un zéro. À corriger avec la fiche 11, qui touche le même bloc CAISSE — pas à financer seul. |
| Horizon d'alerte DLC : **14 jours** codés en dur, et un littéral `60` sur un écran          | `docs/09 I8`        | Produit deux comptes différents de « lots proches DLC » selon la page. Gênant, mais aucune décision d'achat ne bascule dessus. À traiter en même temps que n'importe quelle fiche touchant `horodatage.ts`.                                               |
| `confianceBp(n) = n / (n + 10)` ne dépend que du nombre de sessions                         | `docs/15 §4`, D-041 | Le refus est **argumenté** en D-041 : régler cette courbe « inviterait à régler une courbe dont personne ne peut juger la bonne pente ». Je ne rouvre pas une limite bien défendue.                                                                       |
| Fenêtre de mois du plafond IA : Bruxelles côté client, UTC côté requête                     | `docs/11 §8.3`      | L'audit chiffre lui-même l'impact : « **nul** » au volume du projet.                                                                                                                                                                                      |
| Pluriels (`1 PRODUCTIONS`), enum `systeme` non traduite, date ISO dans l'Excel du comptable | `docs/14 G15`       | Cosmétique. Relève de `demandes/10`, et en dernier. **Réserve** : la date ISO dans l'export Excel est la seule qui gêne un tiers — le comptable lit `2026-07-21T00:00:00.000Z` au lieu d'une date. À glisser dans la fiche 14 si elle est engagée.        |

### Écartés parce qu'ils relèvent d'une mesure physique, pas de code

| Candidat                                                                | Source | Motif                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `perte_fixe_ml` calibré à **0**                                         | D-019  | Le champ existe et est exploité ; seule la **valeur** manque, et D-019 dit qu'elle est « à mesurer sur les premières fournées, pas à supposer ». Ma fiche 9 fournit l'instrument de mesure.            |
| Grammages de garniture supposés (**20 g**, « généreux d'environ 50 % ») | D-053  | Coût matière par crêpe à **0,3846 €** contre **0,33 €** visé par `CLAUDE.md` §6 ; 0,33 € correspondrait à ≈ **13 g**. D-053 conclut « **à peser sur le premier marché** ». Une balance, pas un commit. |

### Écarté parce que c'est une décision du porteur, pas une amélioration

**`Ctrl+S` sur l'écran Sessions déclenche la clôture définitive** (D-050). Le journal des décisions
le renvoie nommément au porteur : « le réflexe _Ctrl+S = j'enregistre mon brouillon_ clôture donc
une pièce comptable. Soit une confirmation, soit une vraie séparation brouillon / clôture — **c'est
une décision produit**. » C'est le seul point de tout `docs/05` explicitement laissé en attente
d'un arbitrage humain. **Je le signale, je ne le tranche pas.**

---

## 7. Dépendances

### 7.1 Entre les vingt fiches

> **Note du 29/07/2026, 18 h.** Ce qui suit est le plan de répartition **tel qu'écrit avant
> livraison**. Les vingt fiches sont maintenant corrigées (§2.1) : le graphe et le tableau
> ci-dessous sont conservés comme trace de la méthode suivie, pas comme travail restant. En
> particulier, `schema.ts` n'est plus un fichier à séquencer entre agents — les migrations qu'il
> fallait pour 6, 17 et 18 sont faites.

```
Phase 0   19 (sauvegarde)  ─── indépendante
          6  (révisions météo) ── ⚠ schema.ts + migration

Phase 1   1  (contrainte stock) ── indépendante
          2  (grille météo) ────── exige 2 valeurs du porteur
          7  (coût 0 → null) ───── retirer le it.fails dans le même commit

Phase 2   16 (numéro de lot) ───── indépendante
          18 (destruction) ─────── ⚠ vérifier l'énumération dans schema.ts
          15 (non-conformité) ──── indépendante
          17 (températures) ────── dépend de 15 ; ⚠ peut exiger une colonne
          20 (catch muet) ──────── indépendante

Phase 3   9  (consommation réelle) ─┬─→ 12 (coût de revient)
          10 (clôture vs prod.) ────┤   et calibration de perte_fixe_ml
          11 (tickets) ─────────────┘

Phase 4   3  (saison + tendance) ──→ 4 (impact événement)
          5  (R1/R2) ←── dépend de 9, et de demandes/04 pour R2
          8  (backtest) ←── arbitre 2, 3, 4, 5

Phase 5   12 ←── 9    ·    13 indépendante    ·    14 ←── demandes/12
```

**Trois fiches touchent ou pourraient toucher `packages/db/src/schema.ts` : 6, 17 et 18.** Un autre
agent y travaille actuellement. **À séquencer entre elles et avec lui, jamais en parallèle.** Les
dix-sept autres peuvent être réparties sans risque de collision.

**Répartition sans collision suggérée**, par zone de code dominante :

| Agent                     | Fiches         | Zone principale                                                                |
| ------------------------- | -------------- | ------------------------------------------------------------------------------ |
| A — Prévision             | 1, 2, 3, 5, 8  | `packages/core/src/prevision/`, `depots/previsions.ts`, `routes/previsions.ts` |
| B — Sessions & analytique | 10, 11, 12, 13 | `services/sessions.ts`, `core/sessions.ts`, `pages/Sessions.tsx`               |
| C — Stock & AFSCA         | 15, 16, 18, 9  | `services/afsca.ts`, `services/mouvements.ts`, `services/production.ts`        |
| D — Infrastructure        | 19, 20, 14     | `sauvegarde.ts`, `pages/Comptabilite.tsx`, nouveau service de facture          |
| E — Séquencé seul         | 6, 17, 4       | `schema.ts` + migration, puis les fiches qui en dépendent                      |

### 7.2 Dépendances externes — ce que le code ne peut pas trancher

`CLAUDE.md` §7 interdit de coder un taux, un seuil ou une convention réglementaire au jugé.
**Aucune de ces questions n'apparaît dans mes vingt fiches.** Elles sont listées comme conditions,
pas comme travaux.

**Un constat de méthode, qui a été suivi d'effet.** Ce paragraphe signalait, le 29/07/2026 à 13 h,
que `docs/05-DECISIONS.md` sautait de D-051 à D-053 et ne consignait aucune entrée dédiée aux
questions réglementaires en attente du comptable. **Corrigé depuis** : `D-052 — Ce que
l'application ne tranche PAS : les questions ouvertes au comptable` existe désormais et récapitule
ces questions à une adresse unique — voir `docs/05-DECISIONS.md`. Vérifié le 29/07/2026, 18 h : la
numérotation D-001 à D-060 ne présente plus aucun trou ni doublon.

> **Mise à jour du 30/07/2026** : le journal a continué de grandir depuis cette vérification —
> `docs/05-DECISIONS.md` compte aujourd'hui `D-061` à `D-063` en plus (63 en-têtes `## D-` au total,
> toujours séquentiels, recomptés par grep). Le constat reste vrai à l'identique, seulement à une
> borne plus haute : toujours aucun trou, aucun doublon.

| Question                                                                  | Source                 | Ce qui reste bloqué                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prorata temporis sur la première annuité d'amortissement                  | `docs/16 §5.1`         | Matériel au 15/03/2026 : **700 €** de charge contre **560 €** avec prorata. Avec prorata, un plan de 5 ans s'étale sur **6 exercices** — le plan actuel serait faux sur **tous** ses exercices.                                        |
| Régime dégressif : ouvert au complémentaire ? plafonné à 40 % ?           | `docs/16 §5.2`         | Sur 3 500 € / 3 ans, le code produit **66,7 %** en année 1 → **934,45 €** de charge avancée si le plafond s'applique. L'option reste offerte à l'écran **sans garde-fou**.                                                             |
| Traitement de la cession et de l'annulation d'une immobilisation          | `docs/16 §5.3`         | Jusqu'à **2 800 €** de charge sur un bien sorti du patrimoine. Chemin **atteignable aujourd'hui**.                                                                                                                                     |
| Mécanique réelle de la cotisation INASTI                                  | `docs/16 §5.4`         | Taux plat de 20,50 % sur une assiette en réalité **circulaire**. Alimente `netEstimeCents`, donc le 3ᵉ compteur de seuil câblé par D-054.                                                                                              |
| Étiquettes des seuils **17 374,08 €** et **23 000 €**                     | `docs/16 §5.5`         | D-054 rend le compteur cohérent avec sa description ; rien ne garantit que la description soit juste. Les deux questions sont indépendantes.                                                                                           |
| Seuil SCE / caisse blanche (2ᵉ seuil de 25 000 €, assiette « sur place ») | `docs/16 §5.6`         | La donnée est **déjà collectée** (`ca_sur_place_cents`). Décision en jeu : **faut-il mettre une table au stand** — une caisse certifiée devenue obligatoire s'applique ensuite à _toutes_ les ventes.                                  |
| Comptabilité de **trésorerie ou d'engagement**                            | absent des deux audits | Jamais tranché nulle part. Commande le rattachement des dépenses à l'exercice, donc les seuils et la clôture de période.                                                                                                               |
| **Double comptage matière** : compta générale vs analytique               | absent des deux audits | Une réception passée en dépense déductible **et** valorisée en coût matière serait comptée deux fois, dans deux systèmes. Ni confirmé ni infirmé. Ne pas confondre avec D-036 (double comptage du **stock projeté**), qui est corrigé. |
| TVA amont en régime de franchise : montants TVAC ou HTVA ?                | `docs/16`, partie C    | Déplace le coût matière, donc le `Co` du newsvendor, donc **combien produire**.                                                                                                                                                        |
| Conservation **10 ans** contre rétention **30 jours**                     | `docs/07:645`          | Ma fiche 19 traite le plancher, le second support et la restauration **sans attendre** cette réponse. Seule la durée exacte en dépend.                                                                                                 |

### 7.3 Deux points hors périmètre, signalés pour mémoire

- **Corrigé depuis la rédaction de ce point (`docs/16 §6.1`) — à NE PAS rouvrir.** Ce paragraphe
  affirmait que le verrou de période était « purement décoratif » et que le statut `verrouillee`
  n'était appliqué par aucun code. **Vérifié dans le code le 30/07/2026** (**D-063**,
  `docs/05-DECISIONS.md`) : `verifierPeriodeNonVerrouillee`
  (`packages/db/src/depots/comptabilite.ts:765-783`) est bien appliquée, et à HUIT points d'écriture
  datée, pas un seul — dépense, contre-écriture, immobilisation, mouvement de stock (×3), réception,
  production (×3) et, depuis ce lot, la clôture de session elle-même
  (`packages/db/src/services/sessions.ts:606`). Les huit sont testés positivement et négativement
  (`comptabilite.test.ts`, `mouvements.test.ts`, `production.test.ts`, `reception.test.ts`,
  `sessions.test.ts` — voir D-063 pour le détail ligne par ligne).
  **Ce qui reste vrai et n'est PAS corrigé** : aucun code de production n'écrit encore le statut
  `verrouillee` lui-même — `cloturerPeriode` n'écrit que `'cloturee'`, et seule une insertion directe
  en base (faite aujourd'hui par un assistant de test local, jamais par une route ou un dépôt exposé)
  atteint `'verrouillee'`. La troisième action, « verrouiller définitivement », reste donc à
  construire si le porteur la veut un jour — voir D-063, conséquence 3.
- **`it.fails` de `packages/core/src/invariants.test.ts:286`** — le test affirme qu'il « manque une
  primitive `repartir(total, poids[])` ». **Cette primitive existe désormais**
  (`packages/core/src/argent.ts:150`) ; elle n'a simplement **aucun appelant de production**. Le
  test est donc devenu trompeur : il teste l'usage naïf d'`appliquerPointsDeBase` au lieu de
  vérifier que `repartir` est employée. À réécrire le jour où une ventilation réelle apparaît —
  ventiler un frais d'emplacement entre deux sessions, par exemple. Aucune décision n'en dépend
  aujourd'hui : rien ne se ventile encore.

  > **Mise à jour du 30/07/2026 — les deux affirmations ci-dessus sont désormais fausses.**
  > `repartir` a maintenant deux appelants de production, apparus après la rédaction de ce point :
  > `packages/core/src/menus.ts:120` (ventilation du prix d'un menu sur ses composants, D-061/D-062)
  > et `packages/core/src/prevision/repartition-production.ts:154` (répartition du plan de
  > production entre recettes, fiche 5 ci-dessus). « Rien ne se ventile encore » n'est donc plus
  > vrai. Par ailleurs, l'`it.fails` lui-même n'existe plus sous cette forme : la ligne 286 actuelle
  > de `invariants.test.ts` porte un commentaire « ANCIEN `it.fails` — DIAGNOSTIC » suivi d'un test
  > normal (`it(...)`, non `.fails`) qui appelle `repartir` directement — il a déjà été réécrit,
  > exactement comme ce paragraphe le proposait « le jour où une ventilation réelle apparaît ». Un
  > grep sur tout le dépôt confirme qu'il ne reste plus qu'un seul `it.fails(` actif dans tout le
  > projet, sans rapport avec ce point : `packages/db/src/audit-annulations.test.ts:625`
  > (`annulerReception`). Voir aussi `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §5.1, qui documente le
  > même correctif de `repartir` indépendamment.
  >
  > **Second correctif, plus tardif dans la même nuit — ce dernier `it.fails` est retiré aussi.**
  > `annulerReception` est désormais joignable de bout en bout : exportée par
  > `packages/db/src/index.ts:326`, exposée par `POST /api/receptions/:id/annuler`
  > (`apps/api/src/routes/stock.ts:234`), avec ses contrats dans `packages/core/src/contrats/stock.ts`.
  > Le test de `audit-annulations.test.ts:609-634` documente lui-même la conversion de son `it.fails`
  > en test de non-régression ordinaire. Un grep sur `it\.fails(` (l'invocation exacte, pas la mention
  > en prose du nom de la convention) sur tout le dépôt ne renvoie **plus aucun résultat** au
  > 30/07/2026 — il ne reste donc plus aucun `it.fails` actif nulle part dans le projet.

---

## 8. Ce qui m'a surpris

Trois choses, consignées parce qu'elles disent quelque chose sur l'état du projet.

**Le dépôt se corrige plus vite que ses audits ne se lisent.** Dix-sept constats majeurs des
audits `docs/08` à `docs/16` étaient déjà fermés au moment où j'ai vérifié, dont plusieurs classés
« rang 1 » par leur propre auteur — le rapprochement prévu/réalisé, l'assiette du troisième seuil,
l'alerte à 80 %, les quinze documents sans bouton. Un audit non daté et non revérifié est devenu
un piège : il fait rouvrir du travail fait. C'est pourquoi le §2 existe.

**Le défaut le plus coûteux n'est pas un bug, c'est un silence.** Trois fiches — 3, 7 et 15 — ont
la même forme : l'application **affiche une mesure là où elle n'en a pas**. « Saison × 1,00 » sans
avoir regardé la saison. « 0,00 € par crêpe » sans savoir. « Aucune non-conformité, c'est la
situation attendue » avec un relevé hors seuil à l'écran. Le moteur est par ailleurs remarquable de
franchise — il annonce « pas encore modélisée », « confiance 9 % sur 1 session », il refuse de
rétrécir son intervalle pour faire joli. Cette honnêteté-là rend les trois silences restants
d'autant plus dangereux : le porteur a appris à croire l'écran.

**Un défaut a changé de nature pendant que personne ne regardait.** `docs/09 M9` classait la
destruction de lot sans mouvement comme « latent : aucun appelant ne l'utilise aujourd'hui ». Entre
cet audit et cette lecture, l'écran de détail de lot a été branché sur la route de changement de
statut. Le défaut est devenu atteignable en trois clics, sur la règle d'architecture n°5, celle qui
porte l'auditabilité AFSCA. Personne ne l'a vu parce que la ligne du rapport disait « latent ».
**Une dette classée latente devrait porter la condition qui la réveille**, pas seulement son
état du jour.
