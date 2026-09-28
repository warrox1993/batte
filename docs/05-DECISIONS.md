# 05 — Journal des décisions d'architecture

Format : contexte → options → décision → conséquences. Une entrée par décision structurante.
À tenir à jour par Claude Code au fil des lots.

---

## D-001 — Application locale plutôt que web hébergée

**Contexte.** Deux utilisateurs, usage exclusivement sur PC, budget d'infrastructure de 0 €,
données sensibles (comptabilité, registre réglementaire).

**Options.** (a) Application locale avec SQLite. (b) Web hébergée sur Vercel + Supabase.
(c) Application desktop packagée Electron/Tauri.

**Décision.** Application locale : API Node + interface web servie en local, base SQLite dans
un fichier. Pas de packaging desktop en V1.

**Conséquences.** Coût réel de 0 €. Sauvegarde = copie d'un fichier. Pas de synchronisation
entre deux postes en V1 : la partenaire travaille sur le même poste, ou on ajoute une
synchronisation plus tard. Migration vers Postgres/Supabase possible sans réécriture si on
reste sur Drizzle et qu'on n'utilise aucune particularité SQLite.

---

## D-002 — Le moteur de prévision est déterministe, pas un LLM

**Contexte.** La demande initiale était que Claude « donne les proportions à produire ».

**Options.** (a) Prompt riche envoyé à Claude qui renvoie une quantité. (b) Moteur statistique
en TypeScript, Claude en commentateur.

**Décision.** Option (b), sans exception.

**Conséquences.** Reproductibilité (indispensable au backtesting), débogabilité, coût quasi
nul, fonctionnement hors ligne. Contrepartie : plus de code à écrire au départ, et le modèle
ne sera pas « intelligent » avant d'avoir des données — ce qui est de toute façon vrai pour
un LLM, qui aurait simplement caché son ignorance derrière une phrase assurée.

---

## D-003 — Argent en centimes, mesures en entiers

**Contexte.** Comptabilité et calculs de coût sur de petites quantités, avec des cumuls
sur des années.

**Décision.** Aucun flottant pour l'argent ni pour les quantités. Centimes, grammes,
millilitres, points de base. Formatage à l'affichage uniquement.

**Conséquences.** Pas de dérive d'arrondi sur les cumuls annuels. Nécessite une couche de
formatage soignée et des tests d'arrondi sur les mises à l'échelle de recettes.

---

## D-004 — Le stock est la somme de ses mouvements

**Contexte.** Obligation de traçabilité AFSCA et besoin d'analyse d'écart théorique/réel.

**Options.** (a) Colonne `quantite_restante` mise à jour. (b) Journal de mouvements,
stock calculé.

**Décision.** Option (b).

**Conséquences.** Historique auditable par construction, ce qui répond directement à
l'exigence réglementaire. Requêtes légèrement plus coûteuses — négligeable au volume du
projet, à surveiller avec des vues et des index si l'historique dépasse plusieurs années.

---

## D-005 — Versionnage des recettes plutôt que modification en place

**Contexte.** Le coût matière historique d'une production doit rester recalculable, même
après ajustement d'une recette.

**Décision.** Une recette active est immuable ; toute modification crée une nouvelle version.

**Conséquences.** L'analyse historique reste juste. Interface un peu plus lourde : il faut
un écran clair de comparaison de versions.

---

## D-006 — Décision de production par le modèle du vendeur de journaux

**Contexte.** Le coût d'une rupture (marge perdue, ≈ 3,15 €) et celui d'un invendu
(matière, ≈ 0,25 €) sont fortement asymétriques.

**Décision.** La quantité recommandée est le quantile de la distribution de demande au ratio
critique `Cu/(Cu+Co)`, soit environ 0,90 — pas la médiane.

**Conséquences.** Gain économique probablement supérieur à celui de la précision du modèle
lui-même. Demande un effort pédagogique dans l'interface : la recommandation paraîtra
« trop haute » à l'intuition, il faut afficher le raisonnement.

---

## D-007 — Aucune donnée personnelle client en V1

**Contexte.** Souhait de suivre « les clients déjà venus » pour calculer des moyennes.

**Décision.** On suit des **transactions et des paniers agrégés**, pas des personnes. Aucun
nom, aucune adresse, aucun identifiant. Un éventuel programme de fidélité fera l'objet d'une
décision séparée avec base légale RGPD, information des personnes et politique de conservation.

**Conséquences.** Les moyennes recherchées (panier moyen, mix produits, fréquentation) sont
toutes calculables sans donnée nominative. Aucune obligation RGPD lourde en V1.

---

## D-008 — Mail par SMTP, pas par API Gmail, en V1

**Contexte.** Envoi de bons de commande aux fournisseurs.

**Décision.** Nodemailer + SMTP avec mot de passe d'application. L'API Gmail est reportée
au lot Google.

**Conséquences.** Beaucoup plus simple à mettre en place et à déboguer. Le mot de passe
d'application doit être traité comme un secret et stocké hors dépôt.

---

## D-009 — Envoi de commande toujours validé par un humain

**Contexte.** La demande initiale évoquait un envoi automatique au seuil de stock.

**Décision.** L'application **génère** et **notifie**, l'utilisateur **valide** et **envoie**.

**Conséquences.** Une commande erronée envoyée chez un meunier coûte plus cher que le clic
économisé. Si l'usage montre que la validation est systématiquement machinale, un mode
automatique pourra être ajouté par fournisseur, avec plafond de montant.

---

## D-010 — Les documents de spécification vivent dans `docs/`

**Contexte.** Les cinq premières specs étaient à la racine du dépôt, alors que `CLAUDE.md` §8 et
`04-ROADMAP-LOTS.md` les référençaient dans `docs/` — douze références mortes.

**Décision.** Création de `docs/`, déplacement des six specs. `CLAUDE.md` reste à la racine
(c'est le fichier lu automatiquement à chaque session).

**Conséquences.** Les références deviennent valides. Les dossiers du monorepo (`apps/api`,
`apps/web`, `packages/core`, `packages/db`) sont créés en même temps, conformément à §2.

---

## D-011 — Aucune étape de compilation pour le backend

**Contexte.** Le monorepo contient quatre paquets TypeScript. La chaîne classique
(`tsc` → `dist/` → exécution) impose de garder des artefacts compilés synchronisés avec la source,
et une étape de build à ne pas oublier.

**Options.** (a) `tsc` par paquet avec `dist/` et project references. (b) Exécution directe du
TypeScript via `tsx`, en développement comme en production. (c) Bundler le backend (`tsup`, `esbuild`).

**Décision.** Option (b). `packages/core` et `packages/db` exposent directement leur source
(`"exports": "./src/index.ts"`). `tsc` ne sert plus qu'au contrôle de types (`--noEmit`).
Seul le front est construit, par Vite.

**Conséquences.** Un `dist/` de moins à ignorer, pas de `composite`/`declaration` à configurer,
aucun risque d'exécuter du code périmé. Le coût est un temps de démarrage de l'API légèrement
supérieur (transpilation à la volée) — non pertinent pour un serveur local démarré une fois par
jour. Contrepartie assumée : la production dépend de `tsx`, qui devient donc une dépendance de
production et non un simple outil de développement.

---

## D-012 — Application web servie en local, pas de packaging desktop

**Contexte.** Question posée en cours de projet : application web ou application desktop
directement ? `CLAUDE.md` §2 réserve le packaging à une reconsidération « si le double lancement
devient pénible ».

**Options.** (a) Web servie en local, deux processus. (b) Web servie en local, un seul processus
en production. (c) Electron. (d) Tauri.

**Décision.** Option (b). En développement, deux processus (Vite a besoin de son HMR).
En production, Fastify sert le bundle React : une commande, un port, une URL. Lancement par
raccourci `chrome --app=` pour obtenir une fenêtre sans onglet ni barre d'adresse.

**Tauri est écarté** pour deux raisons dirimantes : il impose Rust, ce qui contredit « TypeScript
strict partout, un seul langage à relire » (§2), et il n'embarque aucun runtime Node — Fastify,
Drizzle et `better-sqlite3` n'auraient nulle part où tourner sans un sidecar, soit exactement le
double processus qu'on cherche à éviter.

**Conséquences.** Le déclencheur de reconsidération cité par §2 disparaît pour quelques lignes de
code. Si un packaging devient nécessaire (Lot 12), ce sera **Electron**, et il restera un
emballage et non une réécriture, tant que toute la logique vit dans `packages/core` derrière
l'API HTTP. Risque identifié et **levé par mesure** : `better-sqlite3` est un module natif et
Smart App Control bloque les binaires natifs non signés sur le poste de développement — le
chargement a été testé le 26/07/2026 sur Node 24, il fonctionne (SQLite 3.53.2).

---

## D-013 — Le catalogue des paramètres est du TypeScript, la table en est le miroir

**Contexte.** `CLAUDE.md` §7 interdit de coder en dur taux et seuils ; la consigne du porteur
étend la règle à toute valeur métier. Il fallait néanmoins un endroit qui décrive chaque
paramètre — son type, sa valeur initiale, sa source, sa date de validité.

**Options.** (a) Seed SQL. (b) Catalogue TypeScript typé, source unique du seed et de la lecture.

**Décision.** Option (b) : `packages/core/src/parametres.ts` contient `CATALOGUE_PARAMETRES`, et
le type `CleParametre` en est dérivé automatiquement. Le seed transpose, il ne redéclare rien.

**Conséquences.** Une clé ne peut pas exister d'un côté sans l'autre, et une faute de frappe dans
un nom de clé devient une erreur de compilation. Un paramètre absent de la base lève
`ErreurParametreManquant` **au lieu de se replier silencieusement sur une valeur par défaut** :
un seuil manquant est un défaut de configuration à corriger, pas un cas à masquer. La table
conserve l'historique par date de validité, donc un recalcul sur un exercice passé reprend les
seuils de cette année-là.

---

## D-014 — Le rendement de R1 suit `CLAUDE.md` §6, pas les maquettes du doc 06

**Contexte.** Deux valeurs incompatibles pour la même recette. `CLAUDE.md` §6 : R1 pour 6 crêpes
(145 g farine, 240 ml lait…) et « 5 L ≈ 66 crêpes », soit ≈ 76 ml/crêpe. Le calculateur de
`06-UI-ET-PARCOURS.md` affiche pour 5 L : 1 208 g farine, 2 000 ml lait, 17 œufs — un facteur
8,33× qui donne 50 crêpes, soit 100 ml/crêpe.

**Décision.** `CLAUDE.md` §6 fait foi : **≈ 76 ml/crêpe**.

**Justification.** R2 corrobore (5 L → 68 crêpes ≈ 73,5 ml/crêpe), et une crêpe de billig
consomme 70–80 ml de pâte. Les chiffres du doc 06 sont des maquettes d'illustration, par ailleurs
incohérentes entre elles (189 € de CA à l'écran de clôture contre 612–701 € au tableau de bord
et ≈ 838 € en session type).

**Conséquences.** Le rendement de référence est une **donnée de recette en base**
(`rendement_reference_ml` / `rendement_reference_crepes`), donc corrigible sans toucher au code si
la mesure réelle contredit l'hypothèse. Les chiffres des maquettes du doc 06 ne servent jamais de
données de seed ni d'assertion de test.

---

## D-015 — `seuil_alerte_bp` plutôt que `seuil_alerte_pct`

**Contexte.** `02-MODELE-DONNEES.md` liste la clé `seuil_alerte_pct`, alors que son propre en-tête
impose « pourcentages en points de base (10 000 = 100 %) ».

**Décision.** La clé s'appelle `seuil_alerte_bp` et vaut 8000. L'unité prime sur le nom écrit dans
la spec.

**Conséquences.** Cohérence d'unités dans toute la base : aucun pourcentage n'est stocké en
flottant nulle part. Écart de nommage assumé par rapport au doc 02, consigné ici pour qu'il ne
passe pas pour un oubli.

---

## D-016 — Pile de polices système, pas de police auto-hébergée

**Contexte.** La recherche de `docs/07` recommandait Inter Variable auto-hébergée, pour deux
raisons : des métriques déterministes entre postes, et une **ponctuation tabulaire** correcte —
beaucoup de polices alignent les chiffres mais pas la virgule décimale, ce qui ruine l'alignement
des montants dans un tableau.

**Options.** (a) Inter Variable via `@fontsource-variable/inter`. (b) Pile système nettoyée.

**Décision.** Option (b) : `'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif`.

**Justification.** Les deux arguments tombent à l'examen. Le rapport de recherche indique
lui-même que **Segoe UI gère correctement la ponctuation tabulaire**. Et `CLAUDE.md` §1 précise
« deux personnes, **un poste** » : le déterminisme entre machines n'a pas d'objet. Segoe UI
Variable Text est par ailleurs optimisé pour la plage 12–28 px, qui est exactement la nôtre.

**Conséquences.** Zéro dépendance, zéro octet de police à charger, aucun risque de FOUT. La pile
précédente est nettoyée de `-apple-system` et `BlinkMacSystemFont`, qui étaient du poids mort sur
un produit Windows. À reconsidérer uniquement si un second poste sous macOS ou Linux apparaît.

---

## D-017 — Deux modes clavier dans les tableaux, selon le contexte

**Contexte.** Le pattern ARIA `grid` du W3C veut que `Tab` **sorte** de la grille et que les
flèches naviguent entre cellules. C'est la norme d'accessibilité — et c'est contre-intuitif pour
quelqu'un qui connaît Excel. Or la maquette de `docs/06` pour la clôture de session montre
explicitement « Tabulation = champ suivant ».

**Décision.** Deux comportements, deux contextes nettement distincts.

| Écran                                   | Mode            | Comportement                                                                                |
| --------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| Clôture de session, saisies répétitives | **tableur**     | chaque champ est un `input` dans le flux ; `Tab` = champ suivant, `Entrée` = ligne suivante |
| Stock, mouvements, consultation         | **grille ARIA** | flèches naviguent, `Tab` sort de la grille, `F2` entre en édition                           |

**Justification.** L'utilisateur cible connaît Excel, pas ARIA. Sur l'écran le plus utilisé de
l'application — celui du dimanche soir, après six heures debout — c'est l'attente d'Excel qui
prime. Sur les écrans de consultation, la navigation prime sur la saisie et le pattern ARIA est
à la fois plus correct et plus confortable.

**Conséquences.** Deux implémentations à maintenir au lieu d'une. Contrepartie acceptée : chacune
est conforme à l'attente de son contexte, et la frontière entre les deux est nette (un écran de
saisie contre un écran de consultation), donc sans ambiguïté à l'usage.

---

## D-018 — Le CUMP n'est pas une colonne d'`ingredient`

**Contexte.** `02-MODELE-DONNEES.md` prévoit `ingredient.cump_cents_par_unite`, « recalculé à
chaque entrée ». C'est une **valeur dérivée stockée** — exactement le défaut que la règle
d'architecture n° 5 interdit pour les quantités (« le stock ne se modifie que par un mouvement »)
et que l'invariant du lot interdit pour la quantité restante. Le même défaut, appliqué à la valeur
au lieu du volume (relevé en `docs/07` §6.2).

**Options.** (a) Garder la colonne et ajouter un job de recalcul et un test d'invariant.
(b) Ne pas la créer : le coût est calculé, jamais stocké.

**Décision.** Option (b). La colonne **n'existe pas** dans le schéma.

- **Lot 1** : le coût de référence vient du conditionnement actif le plus récent, soit
  `prix_cents / quantite_unite_ref`. Jamais un prix unitaire stocké, qui pourrait diverger de
  ces deux valeurs.
- **Lot 2** : le CUMP réel deviendra une **vue calculée** sur les lots, comme `v_stock_courant`.

**Conséquences.** Le défaut est corrigé **par construction et non par discipline** : il n'y a
aucune colonne à maintenir cohérente, donc aucune dérive possible. Contrepartie : le coût est
recalculé à chaque lecture. Au volume de ce projet (une trentaine d'ingrédients), c'est une
jointure sur quelques dizaines de lignes — sans effet mesurable.

Corollaire appliqué au même moment : `conditionnement` conserve **l'historique des prix** par
`date_prix` au lieu d'écraser, sans quoi aucune tendance ni écart de prix d'achat ne serait
calculable (`docs/07` §6.8 rang 17).

---

## D-019 — `perte_fixe_ml` ajouté à `recette`

**Contexte.** Le modèle ne portait que des pertes proportionnelles (`perte_cuisson_bp`,
`taux_casse_bp`). La recherche sur les ERP de production montre que le rendement se modélise
**toujours en deux termes** : `Intrant = Sortie × (1 + perte%) + perte_fixe`.

**Décision.** Ajout de `recette.perte_fixe_ml`, à 0 par défaut.

**Justification.** C'est exactement la structure d'une pâte à crêpes : une perte **proportionnelle**
(louche trop généreuse, casse) et une perte **fixe par fournée** (fond de bassine, première crêpe
sacrifiée). Un seul des deux termes ne modélise pas la réalité — et l'erreur serait d'autant plus
visible sur les petites fournées, où la perte fixe pèse proportionnellement le plus.

**Conséquences.** Le champ est en base et sera exploité par le calcul de mise à l'échelle au Lot 3
(production), où la perte fixe s'applique réellement. Il reste à 0 dans le seed : c'est une valeur
à **mesurer** sur les premières fournées, pas à supposer.

---

## D-020 — Le stock est calculé en requête, pas en vue SQL

**Contexte.** `02-MODELE-DONNEES.md` prévoit des vues SQL (`v_lot_restant`, `v_stock_courant`).

**Décision.** Le restant d'un lot et l'état du stock sont calculés par des requêtes du dépôt
`packages/db/src/depots/stock.ts`, sans créer de vue.

**Justification.** Même résultat, une migration de moins à maintenir, et le calcul reste testable
en TypeScript. Une vue SQL n'apporterait rien ici : elle n'est ni partagée avec un autre outil, ni
nécessaire à des performances (quelques centaines de lignes).

**Conséquences.** Écart assumé par rapport au doc 02. Le jour où un export SQL direct deviendrait
nécessaire, la vue se crée en une migration à partir de la requête existante.

**Piège rencontré et corrigé.** Dans un gabarit `sql` de Drizzle, `${mouvementStock.lotId} = ${lot.id}`
produit `WHERE "lot_id" = "id"` — **sans qualifier les tables**. Dans une sous-requête corrélée dont
le `FROM` est `mouvement_stock`, ce `"id"` résout vers `mouvement_stock.id` : la corrélation est
rompue en silence, la somme rend toujours zéro, et **aucun type ne proteste**. Toute sous-requête
corrélée doit donc utiliser un **alias explicite** (`FROM "mouvement_stock" m … WHERE m."lot_id" =
"lot"."id"`), et se vérifier avec `.toSQL().sql` au moindre doute.

---

## D-021 — `is_annule` sert à l'affichage, jamais au calcul

**Contexte.** Une correction se fait par contrepassation (règle n° 7, « rien ne s'efface »).
Première implémentation : écrire l'écriture inverse **et** exclure l'originale de la somme des
mouvements.

**Problème constaté.** La matière revenait **deux fois** — 29 000 g au lieu de 25 000 après
annulation d'une sortie de 4 000. Trouvé par un test d'intégration, pas par le typage.

**Décision.** La somme des mouvements **inclut les écritures annulées**. Les deux écritures restent
au journal et s'annulent arithmétiquement. `is_annule` ne sert qu'à l'affichage — barrer la ligne.

**Justification.** C'est la sémantique des ERP : « les cumuls augmentent des deux côtés »
(`docs/07` §1.4). Une contrepassation _ajoute_ une écriture, elle ne _retire_ pas la précédente.

**Conséquences.** Le journal reste intégralement lisible et auditable, ce qui est exactement
l'exigence AFSCA. Corollaire à retenir : **une écriture ne peut être contrepassée qu'une seule
fois** — sans cette règle, deux annulations successives créeraient de la matière. C'est vérifié
par un test.

---

## D-022 — `statutStock` distinct de `statutParPlafond`

**Contexte.** Un seuil légal et un stock de sécurité sont deux seuils de sens opposés : le premier
est un **plafond** dont on s'approche par le bas, le second un **plancher** vers lequel on descend.
Une première version de l'écran Stock réutilisait la fonction de plafond en **inversant ses
arguments**.

**Décision.** Deux fonctions distinctes dans `packages/core/src/affichage.ts` :
`statutParPlafond(valeur, plafond, seuilAlerteBp)` et `statutStock(quantiteDisponible, stockSecurite)`.

**Justification.** L'inversion d'arguments « fonctionnait » mais rendait le code illisible, et se
cassait sur le cas de la rupture totale : une quantité nulle jouait le rôle d'un « plafond ≤ 0 »,
garde écrite pour dire « aucun seuil légal défini » — la rupture s'affichait donc _conforme_.

**Conséquences.** `statutStock` ne prend **aucun paramètre de palier** : le stock de sécurité _est_
déjà le seuil d'alerte, et il est défini par ingrédient. Ajouter un pourcentage par-dessus serait
un seuil sur un seuil. L'écran Stock y gagne un appel réseau et une machine à états en moins.

Corollaire de cohérence : le compteur d'en-tête (`nbAReapprovisionner`) est calculé par **la même
fonction** que celle qui colore chaque ligne. Une définition locale côté API annonçait
« 0 ingrédient concerné » au-dessus de sept lignes rouges.

---

## D-023 — `ca_especes` est dérivé, jamais saisi (correction de l'invariant n° 4)

**Contexte.** `02-MODELE-DONNEES.md` affirmait que `ca_especes + ca_carte − ca_total ==
ecart_caisse` était « toujours vrai par construction ». **C'était faux dès qu'un fonds de caisse
existe** : partir avec 60 € de monnaie donne « CA espèces + 60 » au comptage du soir.

**Décision.** Deux champs distincts sur `session_marche` — `fonds_caisse_initial_cents` et
`especes_comptees_cents` — et `ca_especes` **calculé** par `rapprocherCaisse` de `packages/core`.
L'invariant devient :
`(especes_comptees − fonds_caisse_initial) + ca_carte − ca_total == ecart_caisse`.

**Justification.** L'ancienne formulation ne tenait que si l'utilisateur soustrayait le fonds de
tête — c'est-à-dire s'il faisait à la main le calcul que l'application doit faire. Un test
démontre le défaut : sans la soustraction, l'écart affiche **+60 € sur une caisse parfaitement
juste**, et l'utilisateur passe sa soirée à chercher une erreur qui n'existe pas.

**Conséquences.** `docs/02` a été corrigé, avec une note datée expliquant l'erreur. L'écran de
clôture doit présenter les deux champs comme distincts et ne jamais les confondre.

---

## D-024 — Une session sans vente s'annule, elle ne se clôture pas

**Contexte.** Que faire d'un marché qui n'a pas eu lieu — pluie battante, panne de véhicule ?

**Décision.** `cloturerSession` refuse une session sans aucune ligne de vente et renvoie un
message qui oriente : « annulez la session au lieu de la clôturer ». `annulerSession` exige un
**motif** et bascule `exclure_du_modele` à vrai.

**Justification.** `docs/03` est explicite : « une situation qui rend le marché impossible ne se
modélise pas par un facteur, c'est un drapeau `session_annulee` — ne pas polluer le modèle avec
des zéros non représentatifs ». Une session clôturée à zéro tirerait la baseline vers le bas pour
toujours.

**Conséquences.** Rien n'est effacé : une session annulée garde ses lignes et reste lisible.
Les champs `exclure_du_modele` et `motif_exclusion` comblent au passage le défaut n° 2 relevé en
`docs/07` §6 — `docs/03` les exigeait tous deux, `docs/02` n'en prévoyait aucun.

---

## D-025 — Le seed de démonstration est idempotent PAR ENTITÉ

**Contexte.** La première version gardait un `if (déjà installé) return` global.

**Problème constaté.** Tout ce qu'on ajoutait ensuite au jeu de démonstration — en l'occurrence le
lieu de marché « La Batte » — ne pouvait **plus jamais** s'appliquer à une base existante. Il
fallait tout réinitialiser, donc perdre ses données réelles, pour obtenir un ajout de démo.

**Décision.** Chaque bloc du seed vérifie sa propre présence.

**Conséquences.** Vérifié : relancer sur une base déjà peuplée a ajouté le lieu manquant sans rien
toucher d'autre, et la relance suivante n'a rien fait. Règle à tenir : **tout seed doit être
idempotent au grain de ce qu'il insère**, jamais au grain du fichier.

---

## D-026 — Les documents émis sont archivés, jamais régénérés

**Contexte.** `06-UI-ET-PARCOURS.md` prévoyait `GET /api/documents/:type/:id` qui **génère** le PDF
à la demande.

**Problème.** Si un prix, un seuil ou une recette change entre-temps, le registre AFSCA régénéré
en septembre **diffère de celui présenté au contrôle en mars** — et le contrôleur, lui, en a gardé
une copie. C'est le manque le plus insidieux relevé par la recherche (`docs/07` §6.5) : un ERP
archive le document _émis_, il ne le recalcule pas.

**Décision.** Table `document_genere` : type, objet, numéro, **version**, chemin, taille,
**empreinte SHA-256**, et un instantané JSON des données ayant servi au rendu. Régénérer crée une
**nouvelle version numérotée** ; le fichier précédent reste sur disque et en base.

**Conséquences.** On peut prouver qu'un document n'a pas bougé depuis son émission —
`verifierIntegrite` recalcule l'empreinte et détecte toute altération, ce qui est testé. L'instantané
`parametres_source` permet de comprendre _pourquoi_ un document ancien dit ce qu'il dit, même après
changement des valeurs courantes. Coût : les PDF s'accumulent sur disque, ce qui est exactement ce
qu'on veut pour une obligation de conservation de dix ans.

---

## D-027 — La génération de documents vit dans `apps/api`, pas dans un cinquième paquet

**Contexte.** Où loger la chaîne PDF et les gabarits ?

**Décision.** `apps/api/src/documents/`. Pas de paquet `@batte/documents`.

**Justification.** C'est du code serveur pur : il dépend de la base, de Playwright, et rien d'autre
ne le réutilisera — ni le front, ni le `core` qui doit rester sans dépendance lourde. Un paquet de
plus coûterait un `package.json`, une entrée de workspace et une frontière d'import, pour zéro
bénéfice.

**Conséquences.** `playwright` et `exceljs` sont des dépendances de `@batte/api` uniquement.
Risque testé et levé : **Chromium se lance et produit un PDF sur ce poste** malgré Smart App
Control, vérifié avant d'écrire le moindre gabarit. Le navigateur est démarré paresseusement et
partagé entre rendus — 300 ms de démarrage contre 50 ms par page, il serait absurde de le relancer
pour chacun des sept documents d'une session.

---

## D-028 — La normalisation de l'historique recalcule le facteur météo, elle ne le relit pas

**Contexte.** Pour estimer la baseline de fréquentation, on « neutralise » la météo de chaque session
passée : on divise les ventes par le facteur météo qui s'appliquait ce jour-là. Deux sources
possibles pour ce facteur — celui **archivé** dans la prévision de l'époque, ou celui **recalculé**
depuis le relevé météo conservé, avec les paramètres courants.

**Décision.** Recalcul depuis `meteo_observation`, avec les paramètres **en vigueur maintenant**.
Le facteur figé dans `prevision` n'est utilisé que pour l'audit, jamais pour la baseline.

**Justification.** Si l'utilisateur révise son facteur « pluie continue » de 0,55 à 0,60 parce que
l'expérience le contredit, **tout l'historique doit se renormaliser de façon cohérente**. Avec des
facteurs figés session par session, la baseline dépendrait de l'ordre dans lequel les paramètres ont
été modifiés — deux bases contenant les mêmes ventes donneraient deux baselines différentes.

**Conséquences.** La baseline peut bouger sans qu'aucune vente n'ait changé, ce qui est correct mais
doit être visible : `calculerBaseline` rend une `explication` affichée à l'écran. Une session sans
relevé météo conservé est normalisée avec un facteur neutre — honnête, faute de mieux.

---

## D-029 — Ni Claude ni le client ne fournissent les chiffres que Claude commente

**Contexte.** La route `POST /api/prevision/commenter` doit envoyer une prévision à Claude. Le plus
simple serait que le navigateur, qui l'affiche déjà, la poste au serveur.

**Décision.** Le serveur **recalcule** la prévision avant de la faire commenter. Le corps de la
requête ne porte aucun chiffre.

**Justification.** Sinon n'importe quel appelant pourrait faire commenter des nombres qui ne sortent
pas du moteur, et le commentaire — affiché avec l'autorité de l'application — porterait sur une
fiction. La règle « un LLM ne calcule jamais » (CLAUDE.md §3 règle 2) ne suffit pas si l'entrée
elle-même n'est pas de confiance.

**Conséquences.** Un appel de commentaire coûte un recalcul complet, météo comprise — négligeable,
le relevé étant relu depuis la base et non retéléchargé. `vuePrevision` est factorisée pour que
l'affichage et le commentaire portent, mot pour mot, sur le même objet.

---

## D-030 — Le coût d'un appel Claude est arrondi au centime **supérieur**

**Contexte.** Au volume du projet, un appel coûte typiquement une fraction de centime. Les montants
sont stockés en centimes entiers (CLAUDE.md §3 règle 3).

**Décision.** `coutAppelCents` arrondit au supérieur, avec un plancher à 1 centime dès que le coût
brut est non nul.

**Justification.** Un arrondi au plus proche rendrait **tous** les appels gratuits à ce volume. Le
plafond mensuel ne serait alors jamais atteint et ne protégerait rien : le garde-fou existerait dans
le code sans exister dans les faits.

**Conséquences.** Le compteur **surestime** la dépense réelle, ce qui est le bon sens de l'erreur
pour un plafond. Il ne sert donc pas de justificatif comptable : la facture Anthropic fait foi. Les
tarifs vivent dans `parametre`, en centimes d'euro par million de tokens, avec la conversion depuis
le tarif en dollars documentée dans leur `source`.

---

## D-031 — Le plafond IA est vérifié **avant** l'appel, sur le coût maximal possible

**Contexte.** On ne connaît le coût réel d'un appel qu'après l'avoir reçu.

**Décision.** Avant l'appel, on estime les tokens d'entrée (en **majorant** : ~3 caractères par token
et non 4) et on prend `max_tokens` en sortie. Si ce coût maximal ferait franchir le plafond, l'appel
est refusé.

**Justification.** On ne revient pas sur une dépense engagée. Une sous-estimation ferait franchir le
plafond sans l'avoir vu venir — c'est le seul mode de défaillance qui compte ici.

**Conséquences.** Quelques appels sont refusés alors qu'ils seraient passés de justesse. C'est
acceptable : le refus est une réponse **normale** en HTTP 200, avec une raison affichable qui nomme
le montant restant et dit où relever le plafond. Un plafond à 0 désactive l'IA proprement — vérifié
en conditions réelles : sans `ANTHROPIC_API_KEY`, `/api/ia/etat` et `/api/prevision/commenter`
répondent 200 avec `disponible: false`, sans aucune exception.

---

## D-032 — Le seed principal peuple le plan de nettoyage et l'échéancier réglementaire

**Contexte.** `seedAfsca` et `seedEcheances` existaient sans appelant : il aurait fallu les déclencher
à la main.

**Décision.** `seed()` les appelle, au même titre que les paramètres et les codes motifs. Ce sont des
**données de référence réglementaires**, pas du jeu de démonstration.

**Justification.** Le listing clients TVA est dû au 31 mars **même à zéro**. Une échéance qu'il faut
penser à créer soi-même ne rappelle rien. Idem pour le plan de nettoyage : sans tâches, le registre
AFSCA n'a rien à attester.

**Conséquences.** Trois tests assertaient des valeurs absolues (« la première session porte le
numéro SM-2026-0001 », « le premier `seedAfsca` insère N tâches ») et ont cassé — non parce qu'une
règle métier avait bougé, mais parce qu'ils dépendaient de l'état ambiant. Ils comparent désormais
des **invariants** : une séquence sans trou, un total stable entre deux appels, une date déduite de
la ligne réellement en base. Leçon retenue : un test qui casse à l'enrichissement d'une graine
testait la graine, pas la règle.

---

## D-033 — La base se ferme explicitement, en repliant le journal WAL

**Contexte.** Trouvé en audit : `packages/db` ouvrait la base et ne la fermait **jamais**. Ni le
gestionnaire d'arrêt du serveur (qui ne fermait que Fastify), ni `db:reset`, ni aucun script.

**Le défaut réel.** SQLite tourne en mode WAL (D-004). Les dernières écritures vivent donc dans
`batte.sqlite-wal`, à côté du fichier principal, jusqu'à un point de contrôle. Or D-001 promet une
base « sauvegardable par simple copie ». Un utilisateur qui copiait le seul `.sqlite` après un arrêt
sans point de contrôle obtenait une **sauvegarde silencieusement incomplète** — le pire mode de
défaillance possible pour un registre AFSCA, puisqu'on ne s'en aperçoit qu'au moment de restaurer.

Second symptôme, celui-là **reproduit** : `npm run db:reset` échouait avec `EBUSY` dès que la base
existait, c'est-à-dire dans le seul cas où il sert. Il ouvrait la base pour la sauvegarder puis
tentait `unlinkSync` sur un fichier dont le handle était encore ouvert — ce que Windows refuse.

**Décision.** `fermerBase(base)` exportée par `@batte/db` : elle exécute
`PRAGMA wal_checkpoint(TRUNCATE)` **puis** ferme la connexion, dans un `finally` pour que la
fermeture ait lieu même si le point de contrôle échoue. `TRUNCATE` et non `PASSIVE` : `PASSIVE`
abandonne en silence s'il reste un lecteur ouvert, ce qui reproduirait exactement le défaut.

Appelée à l'arrêt du serveur (SIGINT/SIGTERM, y compris en cas d'échec de Fastify) et par
`reinitialiser.ts` avant la suppression.

**Conséquences.** Vérifié par `packages/db/src/client.test.ts` : après `fermerBase`, aucun fichier
`-wal` résiduel, une copie du seul `.sqlite` contient toutes les données, et le fichier redevient
supprimable. `db:reset` s'exécute désormais trois fois de suite sans erreur. La promesse de D-001
est tenue, alors qu'elle ne l'était pas.

---

## D-034 — `ratioCritique` rend `null` quand un coût manque, jamais un chiffre inventé

**Contexte.** Trouvé en audit : sur une installation neuve, l'écran « Prochaine session » rendait une
**erreur 500 « Probabilite hors ]0,1[ : 1 »** — un message de programmeur, en anglais.

Chaîne complète, entièrement réaliste le jour de l'installation : aucune réception → aucun lot →
coût matière nul → `ratioCritique(315, 0)` valait exactement **1** → `quantileNormal(1)` levait une
`RangeError` non traduite. La route ne contrôlait que `coutRuptureCents`, pas son symétrique.

**Décision.** `ratioCritique` rend `number | null` : `null` dès qu'un des deux coûts n'est pas
strictement positif, ou n'est pas fini. `prevoir` se rabat alors sur le paramètre
`quantile_cible_production_bp`, dont la description dit exactement cela depuis le Lot 5.

**Pourquoi pas conserver le repli à 0,5 qui existait.** Parce que 0,5 est **la médiane**, et que
`docs/03` interdit explicitement de la produire : « on ne produit JAMAIS la médiane ». Le repli
d'origine contredisait donc la doctrine qu'il était censé servir. Un coût absent n'est pas un
arbitrage équilibré, c'est une donnée manquante.

**Conséquences.** La prévision reste calculable le premier jour — on ne peut pas refuser d'afficher
une recommandation à l'installation — mais elle n'invente plus de ratio. Deux gardes de robustesse
posées au passage, même famille de défaut : `unites.ts` refuse une densité `NaN` ou `Infinity`
(sans quoi une seule ligne `NaN` rendait `NaN` le stock entier, sa valorisation et tout coût
matière en aval, **sans jamais lever**), et `prevoir` refuse une baseline non finie.

---

## D-035 — Un 500 est toujours un défaut : cinq causes systémiques supprimées

**Contexte.** Audit dédié aux erreurs 500. L'architecture prévoit que toute situation métier
prévisible remonte en erreur **typée** traduite en 4xx avec un message français actionnable
(CLAUDE.md §4). Cinq familles y échappaient.

**1. Tout 4xx natif de Fastify sortait en 500.** `plugins/erreurs.ts` ne reconnaissait que
`ErreurMetier` et `ZodError`, et ignorait `erreur.statusCode`. Un corps JSON malformé
(`FST_ERR_CTP_INVALID_JSON`, 400) — comme 413, 414, 415 — était donc présenté **et journalisé**
comme une panne serveur : le message disait « consultez les journaux » quand il suffisait de
corriger la requête, et le journal se remplissait de fausses pannes. Le handler honore désormais
`statusCode`, avec un message français par statut. Le message brut de Fastify n'est jamais relayé :
il est en anglais technique et peut porter un fragment du corps envoyé.

**2. Toute date métier antérieure au début de validité des paramètres.** `lireParametres` ne
retenait que `dateDebutValidite <= date` ; le catalogue démarrant au 1er janvier de l'exercice,
toute date antérieure ne ramenait **aucune ligne** et la première lecture typée levait
`ErreurParametreManquant` en 500. Or consulter les tâches en retard « au 15 juin de l'an dernier »,
ou saisir un relevé de température oublié, sont des gestes normaux — et l'utilisateur lisait
« Renseignez-le dans Paramètres », un diagnostic entièrement faux. Repli **clé par clé** sur la
version la plus ancienne connue.

**3. Le coût matière nul du premier jour** → voir D-034.

**4. Violation de clé étrangère → 500 générique.** Quatre routes. Incohérence flagrante : dans une
même réception, un `ingredientId` inconnu rendait un 404 nommé et un `fournisseurId` inconnu un 500.
Les références sont désormais vérifiées **avant** l'écriture, et avant toute allocation de numéro de
série — un numéro consommé pour rien est un trou dans une numérotation légale.

**5. `/api/seuils` rendait 404 là où `/api/synthese-exercice` rend 422.** Deux conventions pour la
même faute de saisie.

**Règle retenue, désormais uniforme.** **404** quand la ressource **adressée dans l'URL** n'existe
pas. **422 avec `champs`** quand une référence **saisie dans un formulaire** est invalide — l'écran
doit savoir sur quel champ accrocher le message, ce qu'un 404 ne dit pas.

**Conséquences.** `apps/api/src/routes/erreurs-500.test.ts` fige les cinq familles : 19 cas dont les
corps malformés, les identifiants du **mauvais type d'objet** (un identifiant de lieu passé là où
une recette est attendue — le typage n'y voit rien, la clé étrangère ne se déclenche qu'à
l'écriture), les dates aberrantes, les transitions interdites et sept charges hostiles sur cinq
routes de détail. Aucune ne produit 500, aucune ne fuite de SQL ni de pile.

---

## D-036 — La réception solde la commande : la boucle d'achat se referme

**Contexte.** Audit de bout en bout de la chaîne ERP. `creerReception` ne connaissait pas la
commande qui l'avait provoquée : `EntreeReception` n'avait pas de `commandeId`, et aucune commande
ne passait jamais au statut `recue`. Une commande restait donc éternellement « en route ».

Conséquence, invisible et cumulative : le stock **projeté** additionne le stock réel et les
commandes en cours. Chaque livraison réceptionnée était donc comptée **deux fois** — une fois dans
les lots, une fois dans la commande jamais soldée. Après quatre semaines, le stock projeté du sac
de farine T55 affichait le quadruple de la réalité, le point de commande ne se déclenchait plus, et
la rupture arrivait un samedi matin sans qu'aucune alerte ne soit sortie.

**Décision.** `EntreeReception` porte un `commandeId` optionnel. Quand il est renseigné :
la commande est vérifiée **avant** toute allocation de numéro de réception (D-035 §4), et passe à
`recue` **dans la même transaction** que l'écriture des lots et des mouvements. Optionnel, parce
qu'une réception peut légitimement n'avoir aucune commande derrière elle (achat de dépannage au
supermarché le samedi matin).

**Pourquoi pas un rapprochement automatique par fournisseur et date.** Parce qu'il serait faux dès
la deuxième commande simultanée chez le même meunier, et qu'un rapprochement faux est pire qu'une
absence de rapprochement : il solde une commande qui n'est pas arrivée.

**Conséquences.** `packages/db/src/services/commandes.test.ts` fige le défaut : avant D-036, la
quantité d'une commande soldée continuait d'être comptée dans le stock projeté. Le lien est
également ce qui rend la traçabilité **amont** complète : d'un lot consommé, on remonte désormais
jusqu'au bon de commande, pas seulement jusqu'au fournisseur.

---

## D-037 — La vente sort le stock, et l'écart ne bloque jamais la clôture

**Contexte.** Deuxième rupture de la chaîne. Les produits **revendus** (sirop de Liège, confiture)
entraient en stock à la réception et n'en sortaient **jamais** : aucun mouvement `sortie_vente`
n'était émis nulle part dans le produit. Le stock de sirop montait indéfiniment. Le réapprovisionnement
n'était jamais déclenché ; l'inventaire de fin d'année aurait été faux de la totalité des ventes.

Les produits **transformés** n'ont pas ce problème : leur matière sort à la production.

**Décision.** `cloturerSession` appelle `sortirLesProduitsRevendus`, qui émet les mouvements
`sortie_vente` en FEFO, dans la transaction de clôture, pour les seules lignes de vente dont le
produit est de nature `revendu`.

**Le point qui n'est pas évident : l'insuffisance de stock ne bloque pas.** Si le stock enregistré
ne couvre pas la vente, **c'est le stock qui a tort, pas la vente** — les pots ont été vendus, on
les a vus partir. Le service sort ce qui est traçable, et remonte l'écart dans
`ResultatCloture.ecartsStock`, que l'écran affiche. Inventer un lot pour couvrir le manquant
fabriquerait une traçabilité fausse : exactement ce que l'AFSCA interdit et ce que CLAUDE.md §7
proscrit. Refuser la clôture, à l'inverse, empêcherait d'enregistrer un chiffre d'affaires réel à
cause d'une erreur de saisie de stock — on bloquerait la comptabilité pour protéger l'inventaire.

**Conséquences.** L'écart est **vu**, donc soldable par un inventaire. Vérifié par
`packages/db/src/services/sessions.test.ts` : sur un stock insuffisant, le CA revendu est intégral,
le stock traçable tombe à zéro, et `ecartsStock` nomme l'ingrédient et la quantité manquante.

> ### ⚠️ Correction du 30/07/2026 — « que l'écran affiche » était FAUX pendant des mois
>
> Le paragraphe ci-dessus (« remonte l'écart dans `ResultatCloture.ecartsStock`, **que l'écran
> affiche** ») décrivait une intention, pas le code. `ecartsStock` était bien calculé
> (`services/sessions.ts`), bien renvoyé par la route, bien testé — et **aucune occurrence
> d'`ecartsStock` n'existait dans `apps/web/src/pages/Sessions.tsx`**. Ses deux frères,
> `resolutionVolume` et `avertissementEnergie`, allaient jusqu'au bandeau ; son chemin à lui
> s'arrêtait avant l'écran.
>
> Toute la conséquence de cette décision reposait donc sur une phrase fausse : **l'écart n'était pas
> vu, donc pas soldable.** Le raisonnement « l'insuffisance de stock ne bloque pas, parce qu'on la
> montre » se tenait uniquement grâce à la seconde moitié — qui n'existait pas.
>
> **Corrigé le 30/07/2026** : le bandeau existe, au même endroit et avec la même convention éphémère
> que ses deux frères. Il nomme l'ingrédient et la quantité manquante, **sans inventer d'unité** (le
> contrat n'en porte pas) ni **de cause** (la donnée ne la connaît pas) : il propose les deux pistes,
> vérifier la dernière réception ou corriger l'inventaire. Un test à regex négative garde
> explicitement contre l'ajout ultérieur d'une unité inventée.
>
> **La leçon, plus large que ce cas** : une décision d'architecture qui affirme un comportement
> d'écran est une **affirmation vérifiable**, pas une intention. Elle mérite le même traitement qu'un
> commentaire de code — confrontée à la réalité, ou elle dérive en silence. C'est la troisième fois
> ce jour-là qu'un texte juste au moment où il a été écrit s'est révélé faux sans qu'une ligne de
> code n'ait bougé.

---

## D-038 — Le coût matière d'une session est le coût **réel**, jamais le théorique quand le réel existe

**Contexte.** Troisième rupture. `saisirRealise` enregistrait le volume réel et les crêpes réelles,
mais laissait `coutMatiereReelCents` à `null` — alors que la consommation de lots venait d'être
écrite avec son coût exact (`productionConsommation.coutCents`, valorisé au lot effectivement
consommé). La marge de session était donc systématiquement calculée sur le coût **théorique**,
c'est-à-dire sur le prix des ingrédients tel qu'il était supposé, pas tel qu'il a été payé.

Une hausse du beurre n'apparaissait jamais dans la marge. Or c'est précisément l'écart
théorique/réel que la comptabilité analytique existe pour montrer (CLAUDE.md §0).

**Décision.** `saisirRealise` écrit `coutMatiereReelCents` = somme des `coutCents` des lignes de
consommation. `cloturerSession` retient `coutReel ?? coutTheorique` : le réel dès qu'il existe, le
théorique tant que le réalisé n'est pas saisi. Les productions au statut `annulee` sont exclues du
total — sans ce filtre, une production annulée continuait de peser sur la marge de la session.

**Conséquences.** `coutRevientParCrepeCents` et `margeNetteCents` deviennent des chiffres de
comptabilité analytique et non des estimations. Figé par `packages/db/src/parcours-erp.test.ts`.

---

## D-039 — Panier moyen et prix moyen par article sont deux chiffres différents

**Contexte.** Le champ s'appelait `nbTransactions` et comptait en réalité des **articles vendus**
(la somme des quantités). Le « panier moyen » affiché valait donc CA / articles. Dès qu'un client
prend deux produits — une crêpe et un pot de sirop, ce qui est le cas courant — le panier affiché
valait **la moitié** du panier réel. Un indicateur de pilotage faux d'un facteur deux, sans aucun
signal.

**Décision.** Séparer les deux grandeurs, parce que ce sont deux questions différentes :

- `prixMoyenParArticleCents` = CA / articles vendus. Toujours calculable, sans saisie supplémentaire.
- `panierMoyenCents` = CA / **tickets**, avec `nbTickets` saisi à la clôture — le chiffre se lit sur
  le terminal SumUp, il n'y a rien à compter à la main. `nbTickets` est **optionnel** : sans lui,
  `panierMoyenCents` vaut `null`.

**Pourquoi `null` plutôt qu'un repli sur les articles.** Un `null` s'affiche « — » et se comprend ;
un panier moyen deux fois trop petit s'interprète comme une contre-performance commerciale et
déclenche de mauvaises décisions (baisser les prix, changer l'assortiment). Le champ a été renommé
`nbArticlesVendus` pour que la faute ne puisse plus être réécrite.

**Conséquences.** Traversant : `packages/core/src/sessions.ts`, ses contrats, les dépôts et services
de session, la route de clôture et l'écran. Aucune valeur historique n'est réinterprétée — les
sessions déjà clôturées n'ont pas de tickets, leur panier moyen vaut donc `null` et non un chiffre
faux.

---

## D-040 — Le rythme de sessions qui projette les seuils est un paramètre, pas un littéral

**Contexte.** `apps/api/src/routes/sessions.ts` portait :

```ts
/**
 * Deduit du rythme reel du lieu (un marche par semaine) et non code en dur a
 * 52 : une activite qui ne tient pas marche en janvier ne doit pas voir sa
 * projection gonflee.
 */
const SESSIONS_PAR_AN = 52;
```

Le commentaire affirmait exactement l'inverse de ce que faisait la ligne suivante. **Un commentaire
qui ment est pire qu'un commentaire absent** : il fait passer la relecture. Double faute au regard
du projet — une valeur métier vivait dans un handler HTTP (règle d'architecture n°1), et un nombre
de pilotage était codé en dur (CLAUDE.md §7).

L'enjeu n'est pas cosmétique : ce nombre multiplie le rythme constaté pour projeter le CA de fin
d'année, et c'est cette projection qui **déclenche l'alerte de sortie de franchise TVA**. Le seuil
porte sur le CA, et la revente génère ≈ 2,6 fois plus de CA que la crêpe à marge égale : se tromper
de rythme, c'est se tromper d'alerte sur le seul indicateur légal qui puisse coûter cher.

**Décision.** Nouvelle clé de catalogue `seuils_sessions_prevues_par_an`, défaut **52**.
`tableauSeuils(base, annee)` la lit elle-même, **à la même date que les plafonds**
(`${annee}-12-31`) — une année passée est ainsi projetée avec le rythme qui était le sien. Le
troisième argument de la fonction disparaît : le handler HTTP ne transporte plus de chiffre métier.

**Pourquoi 52 et pas une moyenne mesurée.** 52 est l'hypothèse **haute** : un marché par semaine,
sans un seul congé. Elle sur-estime, donc elle alerte trop tôt. C'est le sens prudent de l'erreur :
sous-estimer laisserait sortir de la franchise TVA sans prévenir, ce qui est irrattrapable ;
sur-estimer fait regarder un compteur de trop près, ce qui ne coûte rien. La description du
paramètre porte ce raisonnement, pour que l'utilisateur sache dans quel sens le corriger.

**Conséquences.** `packages/db/src/seuils-parametrables.test.ts` (4 tests) fige la règle : la même
base projetée à 52 puis à 26 doit rendre **exactement la moitié** — avec un littéral compilé, les
deux projections seraient identiques et le test tomberait. Les assertions dérivent toutes de la
valeur réellement lue, jamais d'un nombre figé que la graine pourrait déplacer.

**Effet de bord constaté au passage.** `npm run db:seed` a inséré **trois** paramètres manquants
dans la base de développement, dont `prevision_demi_vie_ponderation_jours` et
`prevision_residus_minimum`, ajoutés au catalogue plus tôt sans que la graine soit rejouée. La route
de prévision aurait donc levé `ErreurParametreManquant` sur cette base. Rappel de méthode :
**ajouter une clé au catalogue n'a aucun effet tant que la graine n'est pas rejouée** — le catalogue
est la source de vérité, la graine est ce qui la propage.

---

## D-041 — Où s'arrête « zéro valeur codée en dur » : la règle de partage

**Contexte.** Le balayage systématique déclenché par D-040 (`^const [A-Z_]+ = [0-9]`) a sorti douze
constantes hors du catalogue. Il fallait une règle pour trier, sinon on parametre tout — y compris
un délai de _debounce_ — et le catalogue devient illisible, ce qui est une autre façon de le rendre
inutilisable.

**Règle retenue.**

> Un nombre qui décrit **la réalité de l'utilisateur** est un paramètre.
> Un nombre qui décrit **la forme d'une formule ou le fonctionnement de la machine** n'en est pas un.

**Parameterisés en conséquence (trois clés ajoutées).** Tous les trois étaient les seuls de leur
famille immédiate à être compilés — l'incohérence était le défaut, pas le nombre :

- `prevision_couverture_ensoleille_max_bp` (50 %) — ses cinq voisins de classification météo (pluie,
  vent, trois températures) étaient déjà des paramètres.
- `prevision_sessions_avant_sigma_mesure` (8) et `prevision_sessions_sigma_fiable` (25) — seuils de
  maturité du modèle, même famille que `prevision_poids_prior_k` et `prevision_residus_minimum`,
  déjà au catalogue. Les laisser en dur rendait la maturité du modèle irréglable sans recompiler.

**Laissés en constantes, délibérément.** `DELAI_MAX_MS` (temporisation réseau), `PORT_DEFAUT`,
`DELAI_DEBOUNCE_MS`, `DELAI_SUCCES_MS` — fonctionnement de la machine. `TOKENS_PAR_UNITE_TARIF`
(1 000 000) — définition d'unité, pas un réglage : le tarif est « par million de tokens », changer
ce nombre ne changerait pas un prix, il rendrait tous les prix faux. Et le `+ 10` de `confianceBp` —
c'est le **paramètre de forme d'une courbe asymptotique**, pas un seuil : le commentaire documente
déjà le palier obtenu (20 sessions → 67 %, 30 → 75 %). L'exposer inviterait à régler une courbe dont
personne ne peut juger la bonne pente.

**Quatrième cas, traité ensuite, et c'était le pire des quatre.**
`HORIZON_ECHEANCE_JOURS = 30` n'était pas seulement codé en dur : il l'était **deux fois**, dans
`TableauDeBord.tsx:57` et dans `Comptabilite.tsx:237`, chacun portant un commentaire renvoyant à
l'autre (« même seuil que… »). Une règle métier dupliquée dans deux composants React, donc deux
fautes superposées — la règle d'architecture n°1 dit que la logique métier ne vit ni dans un
composant React ni dans un handler.

Corrigé en déplaçant la **décision**, pas seulement la valeur : `listerEcheances` rend désormais
`alerteProche: boolean`, calculé côté serveur depuis la nouvelle clé
`echeance_horizon_alerte_jours`. Les deux écrans filtrent sur un booléen et ne décident plus de
rien. Une échéance déjà `faite` n'alerte jamais, même si sa date approche — c'est tout l'intérêt de
l'avoir marquée.

Figé par trois tests dans `packages/db/src/seuils-parametrables.test.ts`, dont un qui vérifie la
**borne incluse** (à exactement N jours, l'alerte est déjà levée). Un des tests a d'ailleurs échoué
à l'écriture pour une bonne raison, conservée en commentaire : toutes les échéances ne tiennent pas
dans un horizon d'un an, la récurrence **quinquennale** de l'autorisation ambulante peut être à cinq
ans. Asserter « toutes les échéances non faites » aurait été faux.

**Conséquence de méthode, apprise deux fois de suite.** Ajouter une clé au catalogue **n'a aucun
effet tant que `npm run db:seed` n'est pas rejoué**. La graine a inséré trois clés manquantes au
premier passage, trois autres au second. Le catalogue est la source de vérité ; la graine est ce qui
la propage. Les deux gestes vont ensemble.

---

## D-042 — Corriger et faire évoluer un paramètre sont deux gestes différents, et l'écran doit le dire

**Contexte.** `CLAUDE.md` §6 et §7 exigent que seuils, taux et montants réglementaires vivent dans
la table `parametre`, « avec date de validité et source ». Le mécanisme existait entièrement —
`ajouterVersionParametre` était écrite dans le dépôt, avec son journal d'audit — mais **elle n'avait
aucun appelant HTTP**, et le `PATCH /parametres/:id` qui existait n'était appelé par aucun écran.

Autrement dit : le versionnage annuel des seuils légaux n'était atteignable ni par l'API, ni par
l'interface. Quand le seuil de franchise TVA changera, l'utilisateur — un indépendant — aurait dû
ouvrir le fichier SQLite à la main. La promesse « paramétrable » n'était pas tenue.

**Décision — deux routes, parce que ce sont deux gestes métier distincts.**

| Geste             | Route                            | Sens                                                                                                                                                          |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Corriger**      | `PATCH /parametres/:id`          | La valeur saisie était fausse, elle n'a **jamais** été vraie : faute de frappe, capacité mal relevée. On répare en place, le journal garde l'ancienne valeur. |
| **Faire évoluer** | `POST /parametres/:cle/versions` | La valeur était juste et **change à partir d'une date**. Une nouvelle ligne datée est insérée, l'ancienne reste.                                              |

**Pourquoi la distinction n'est pas cosmétique.** `lireParametres(base, date)` résout les paramètres
**à la date de la pièce**. Corriger en place réécrit donc rétroactivement toutes les sessions déjà
clôturées — exactement ce que D-004 et D-024 (agrégats figés à la clôture) interdisent. Un
utilisateur qui croit réparer une coquille recalculerait sa comptabilité de l'année. L'écran nomme
donc les deux actions et explique laquelle réécrit le passé, au lieu de proposer un « Modifier ».

**Gardes ajoutées au dépôt, pas au handler** (règle d'architecture n°1) : clé hors catalogue → 404 ;
valeur validée contre le `typeValeur` **dérivé de `CATALOGUE_PARAMETRES`**, jamais redéclaré ; date
de validité antérieure ou égale à la version courante → 422 dont le message renvoie vers la
correction. `typeValeur` et `description` deviennent facultatifs et se déduisent du catalogue —
il reste la source unique (D-013).

**Conséquences.** `packages/db/src/depots/parametres-ecriture.test.ts` (17 tests). Le test qui compte :
après une évolution, `lireParametres` à une date antérieure rend **toujours l'ancienne valeur** ;
après une correction, elle rend la nouvelle. C'est la démonstration qu'une session clôturée n'est
pas réécrite.

**Nettoyage nécessaire.** La vérification en HTTP a laissé dans la base de développement une version
2027 du seuil TVA à 27 000 €, avec une source d'allure officielle. **Un seuil réglementaire futur
inventé n'a rien à faire dans la base**, même en développement : il se lit comme une donnée établie.
Supprimé.

---

## D-043 — Quelles colonnes ont le droit d'être coupées est une question métier

**Contexte.** `apps/web/src/composants/Tableau.tsx` appliquait `truncate` à **toutes** les cellules
de **24 instances dans 11 écrans**. Le seul recours était la prop `titre` → attribut `title` natif,
qui **n'est pas exposé au clavier**. Or la règle n°10 exige que chaque écran soit utilisable au
clavier. Ajouter `titre` partout aurait donc fermé le constat d'audit sans rien donner à un
utilisateur au clavier.

**Décision.** Une prop facultative `troncature?: 'ellipse' | 'repli'`, défaut `'ellipse'`.
`'repli'` = la cellule passe à la ligne et n'est **jamais** coupée
(`white-space: normal; overflow-wrap: anywhere` — `break-word` ne suffirait pas, `LOT-2026-0731-A`
ne contient aucune espace).

**Le raisonnement qui compte.** Une fois admis que l'infobulle n'est pas une réponse, la question
cesse d'être « comment révéler le texte caché » et devient « **quelles colonnes ont le droit d'être
coupées** » — et c'est une question métier, pas visuelle :

- un numéro de lot fournisseur coupé, c'est un **rappel de lot qu'on ne peut pas effectuer** ;
- le suffixe ` (revente)` coupé, c'est une marge comptabilisée à 90 % au lieu de 30 %, donc un
  compteur de seuil légal faux (la revente génère ≈ 2,6 fois plus de CA à marge égale).

**Sur la densité, objection prise au sérieux.** `height` sur une cellule de tableau est un
**minimum**, pas une hauteur fixe : une rangée dont le contenu tient sur une ligne reste à 32 px.
Seules grossissent les rangées qui perdaient réellement de l'information. `padding-block: 5px` fait
tenir une ligne unique sous le plancher de 32 px.

**Écarté délibérément.** `aria-label` sur un `<td>` — il **remplace** le nom accessible, et le
pousser sur 24 tableaux en supposant que chaque `titre` correspond à son `rendu` introduirait une
régression silencieuse. Cette supposition est d'ailleurs fausse : `Comptabilite.tsx` rendait
`libelle` avec `sourceLegale` en infobulle. **Une infobulle qui répond à côté est pire que pas
d'infobulle** — corrigé, et la règle inscrite dans la JSDoc de `titre`.

**En-têtes.** Les `<th>` portaient `white-space: nowrap` sans règle d'`overflow` : avec
`table-layout: fixed`, un intitulé long ne s'ellipsait pas, il **débordait sur la colonne voisine**.
`overflow: hidden; text-overflow: ellipsis` ajoutés, plus `title` sur chaque en-tête.

**Navigation clavier — motif `grid` de l'APG**, actif seulement si `onSelectionnerLigne` est fourni.
`Tab` entre sur **une** rangée et sort à la pression suivante (jamais intercepté) ; `↓`/`↑` ±1 ;
`PageDown`/`PageUp` ±10 (et non « une hauteur d'écran » : un chevauchement laisse un repère
visuel) ; `Home`/`End` ; `Entrée`/`Espace` sélectionnent. La rangée active est suivie **par clé et
non par index**, pour qu'un tri ne déplace pas le point d'entrée.

**Pas de bouclage.** `↓` sur la dernière rangée ne fait rien. Un saut silencieux vers le haut d'un
registre de 40 lignes est exactement la sensation d'égarement que `docs/07` §0 proscrit, et le
tableur que l'utilisateur connaît ne boucle pas non plus. Le non-événement ne consomme pas la
touche : le défilement natif reprend, donc la butée se **sent**.

**Outillage.** `@testing-library/react` et `jsdom` sont absents ; ils n'ont **pas** été installés
(CLAUDE.md §7). La logique clavier a été extraite en fonctions pures dans
`apps/web/src/composants/navigationGrille.ts`, testable sans DOM, et les assertions structurelles
passent par `renderToStaticMarkup` (`react-dom`, déjà présent). `vitest.config.ts` a dû être élargi :
son `include` ne couvrait ni `apps/web`, ni le JSX automatique faute de `tsconfig.json` racine — un
test d'interface n'aurait jamais pu s'exécuter.

---

## D-044 — On stocke le montant payé, on dérive le taux. Jamais l'inverse

**Contexte.** Deux colonnes de montant étaient en `real`, contre la règle d'architecture n°3
(`lot.prix_unitaire_cents`, `commande_ligne.prix_unitaire_cents`). Elles l'étaient pour une raison
défendable : elles portaient un **taux** (0,075 centime par gramme), pas un montant, et un taux a le
droit d'être fractionnaire.

**Mais le défaut n'était pas le type, il était en amont.** `services/reception.ts` faisait :

```ts
const prixUnitaireCents = ligne.prixLigneCents / ligne.quantite;
```

… stockait le quotient, et **jetait `prixLigneCents`** — le montant réellement payé, pourtant déjà
un entier en centimes. Un lot n'était donc plus rapprochable au centime près de la facture
fournisseur, ce qui rend impossible le **rapprochement à trois** (facture ↔ réception ↔ commande)
que le schéma prévoit explicitement au-dessus de `facture_fournisseur`.

**Décision.** `lot.prixLigneCents` et `commande_ligne.prixLigneCents`, tous deux `integer`. Le taux
unitaire est **dérivé à la lecture** dans `depots/stock.ts` (`prixLigneCents / quantiteInitiale`,
avec garde à zéro — un `NaN` propagé a déjà coûté cher ici, cf. D-034). `packages/core/src/stock.ts`
continue d'exposer `prixUnitaireCents: number` : c'est un taux, il a le droit d'être fractionnaire
**tant qu'il n'est pas persisté**. Gain collatéral : `montantTotalCents` d'une commande est
désormais la somme exacte des montants de ligne stockés, et non une somme d'arrondis recalculés.

**La migration, et pourquoi elle n'est pas celle qu'on croit.** La recette SQLite habituelle
(table `__new_`, `INSERT … SELECT`, `DROP`, `RENAME`) est **inapplicable ici**, vérifié
empiriquement et non supposé : le migrateur Drizzle enveloppe chaque migration dans un
`BEGIN … COMMIT`, or `PRAGMA foreign_keys=OFF` est sans effet à l'intérieur d'une transaction — et
`defer_foreign_keys` non plus. Le `DROP TABLE lot` déclenche le `DELETE FROM lot` implicite, qui
viole `mouvement_stock.lot_id` et `production_consommation.lot_id`.

D'où une migration écrite à la main en **ajout / conversion / suppression**, qui ne touche aucune clé
étrangère, avec l'`UPDATE` de conversion **avant** le `DROP COLUMN` (règle n°7, rien ne s'efface) :
`CAST(ROUND(prix_unitaire_cents * quantite_initiale) AS INTEGER)` — `ROUND` puis `CAST`, jamais
`CAST` seul, qui tronque vers zéro et perdrait jusqu'à un centime par ligne.

**Résidu technique assumé et documenté** : les deux colonnes portent un `DEFAULT 0` en base. SQLite
l'exige pour ajouter une colonne `NOT NULL` à une table peuplée, et ne sait pas le retirer ensuite
sans la recréation que les clés étrangères interdisent. Le schéma Drizzle déclare `notNull()` sans
défaut : aucune insertion applicative ne peut donc l'utiliser.

**Conséquences.** `packages/db/src/argent-entier.test.ts` (9 tests). Le test qui empêche la faute de
revenir est générique : il parcourt **toutes** les tables via `PRAGMA table_info` et échoue si une
colonne dont le nom finit par `_cents` n'est pas `INTEGER`. Les autres prouvent la réconciliation
exacte, sans `toBeCloseTo` : la somme des montants de lot d'une réception égale son total, au
centime.

**Limite connue, laissée telle quelle.** `valoriserStock` et `calculerCump`
(`packages/core/src/stock.ts`) multiplient toujours le taux dérivé par une quantité. La valorisation
d'un lot **intact** est donc une reconstruction plutôt que le montant payé lui-même. L'écart
possible est d'un centime, sur une grandeur d'inventaire ; le corriger imposerait de faire entrer
`prixLigneCents` dans le type pur `LotStock` et dans tous ses constructeurs de test, pour un gain
qui n'apparaît sur aucune pièce. À reprendre si un jour l'inventaire doit être signé au centime.

---

## D-045 — Une liste écrite à la main n'est pas une preuve d'absence

**Contexte.** `integration.test.ts` porte un balayage anti-fuite : il relit toutes les routes de
lecture avec des sentinelles (clé Anthropic, identifiants SMTP) posées dans l'environnement, et
refuse la moindre correspondance dans les réponses. Excellent test — sauf que la liste des routes
était **écrite à la main**.

Le défaut est structurel, pas circonstanciel : une nouvelle route de lecture s'ajoute sans que rien
ne signale son absence, et le balayage se transforme en **preuve d'absence qui ne prouve plus rien**.
C'est arrivé le jour même : `/api/produits` a été livrée sans y figurer.

**Décision.** Un second test dérive la liste attendue de **la table de routage réelle de Fastify**
(`printRoutes`) et échoue tant qu'une route GET sans paramètre n'est pas balayée. La liste explicite
reste — elle se lit, ce qu'un balayage entièrement dynamique ne permettrait pas — mais elle ne peut
plus mentir.

**Le piège technique qui rendait la version naïve inutile.** Fastify **compresse les préfixes
communs** dans son arbre : `/api/previsions` s'affiche `s` sous `/api/prevision`, et
`taches-en-retard` s'affiche `-en-retard`. Une lecture ligne à ligne aurait donc raté précisément
les routes les plus faciles à oublier — celles dont le nom ressemble à une voisine. Le test rejoue
l'indentation (quatre caractères par niveau) pour recoller les segments.

**Ce que le garde-fou a trouvé immédiatement.** Trois routes de lecture supplémentaires n'avaient
**jamais** été balayées : `/api/recettes` — qui n'est pas un détail —,
`/api/afsca/nettoyage/executions` et `/api/prevision/brief`. Quatre au total avec `/api/produits`.

**Détail retenu.** Les routes qui exigent une période reçoivent leur intervalle via une table
`QUERY_REQUISE`. Elles restent balayées — **une fuite dans un corps 422 vaut une fuite dans un corps
200** — mais on leur donne de quoi répondre, sinon on testerait la validation d'entrée au lieu du
contenu de la réponse.

**Portée.** Le raisonnement vaut au-delà de ce test : partout où une suite énumère à la main ce
qu'elle couvre (routes, tables, paramètres), il faut confronter l'énumération à la source de vérité,
sans quoi la couverture se dégrade en silence à chaque ajout.

---

## D-046 — Le maillon zéro de la chaîne ERP avait été livré sans écran

**Contexte.** `CLAUDE.md` §0 définit le produit par sa chaîne de données : « une réception de farine
chez le meunier doit se propager, sans ressaisie, jusqu'à la marge nette du dimanche suivant et
jusqu'au registre AFSCA ». Les routes `POST /api/receptions` et `POST /api/mouvements` existaient
depuis le Lot 2, testées. **Aucun écran ne les appelait.** `Stock.tsx` était en lecture seule.

Pour enregistrer une livraison, l'utilisateur — un indépendant, pas un développeur — devait donc
forger une requête HTTP à la main. Toute la traçabilité AFSCA, tout le coût matière et tout le
réapprovisionnement en dépendent. Le défaut n'était visible dans aucun test : la couche serveur
était complète et verte.

**Décision.** Un dossier `apps/web/src/saisie-stock/` porte trois pièces réutilisables : les champs
partagés, la saisie de réception multi-lignes, et le mouvement de correction. `Stock.tsx` et
`InventaireInitial.tsx` les consomment.

**Trois points de conception qui valent d'être retenus.**

1. **La DLC déduite est calculée par la MÊME fonction pure que le serveur.** Quand la DLC n'est pas
   saisie, le serveur la déduit de la durée de conservation déclarée. L'écran appelle
   `ajouterJours` — pas une reformulation — donc il ne peut pas annoncer une date que la base
   contredira. Quand la durée est inconnue, l'écran affiche « Sans DLC : servi en dernier (FEFO) »,
   qui est exactement le comportement serveur, et non un champ vide.
2. **Un total de contrôle, à comparer au bon de livraison papier.** Une réception est une pièce
   comptable : le geste réel de l'utilisateur est de confronter l'écran à son papier avant de
   valider.
3. **`Entrée` crée la ligne suivante et y place le focus ; `Ctrl+Entrée` enregistre.** `Entrée` est
   intercepté sur les cinq champs de ligne — sans quoi il déclencherait la soumission native et
   **expédierait une réception à moitié saisie**. Saisie d'une livraison à trois lignes vérifiée
   sans souris, au navigateur.

**Défaut trouvé et corrigé en cours de route.** Un compteur de clés au niveau module repartait à
zéro au remplacement à chaud de Vite : deux lignes recevaient la clé `ligne-1` et **React fusionnait
leurs champs de saisie**. Remplacé par `nouvelIdentifiant()`. Le symptôme n'apparaissait qu'après
une édition à chaud — c'est-à-dire jamais en production, et systématiquement en développement.

**Blocage assumé, non contourné.** `POST /api/inventaires` est listé par `docs/06` §208 mais
n'existe pas, et `schemaCreationReception` exige un `fournisseurId`. L'inventaire d'ouverture passe
donc par la route de réception, qui réclame un fournisseur. **On ne rend pas `fournisseurId`
nullable** : un `null` répondrait « on ne sait pas » à la question « d'où vient ce lot ? », qui est
précisément la question posée lors d'un rappel AFSCA, et toute la traçabilité amont devrait gérer un
cas d'absence. Un fournisseur **système** nommé « Inventaire d'ouverture » répond quelque chose de
vrai et d'auditable : ce stock était là avant l'application, son origine commerciale n'est pas
tracée par cet outil.

**Dettes signalées, non traitées.** `services/reception.ts:84-99` valide les lignes sans porter leur
index : le serveur ne peut pas dire **quelle** ligne est fautive. L'écran valide avec les mêmes
règles et absorbe tout `champs` orphelin en bandeau plutôt que de perdre le message — mais la route
reste imprécise. Et `parserEntierPositif` est désormais écrit **trois fois** (`Production.tsx`,
`Sessions.tsx`, `saisie-stock/champs.tsx`) : il manque à `packages/core` une fonction pure de
lecture de quantité saisie.

---

## D-047 — La porte de sortie était verte parce qu'elle ne regardait pas

**Contexte.** `npm run typecheck && npm run lint && npx vitest run && npm run build` est invoquée
après chaque lot depuis le Lot 0, et elle est verte en permanence. **Son périmètre n'avait jamais
été mesuré.** Trois trous avaient déjà été trouvés par accident ; l'audit systématique en a sorti
quatre autres.

| Trou                                                           | Portée réelle                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest.config.ts` n'incluait pas `apps/web`                   | un test d'interface n'aurait **jamais** pu s'exécuter — il aurait été vert par absence                                                                                                                                                   |
| `eslint.config.js` n'ignorait pas `sorties/`                   | un répertoire de sortie faisait tomber le lint                                                                                                                                                                                           |
| Aucune règle des hooks React                                   | sur une base React 19 de plusieurs milliers de lignes                                                                                                                                                                                    |
| **`vitest.config.ts` n'appartenait à aucun projet TypeScript** | le fichier qui décide **quels tests tournent** n'était jamais typé. Une faute de frappe dans son `include` n'était vue par rien                                                                                                          |
| **Le seuil de couverture de 80 % était inexécutable**          | `@vitest/coverage-v8` n'a jamais été installé. Le seuil de CLAUDE.md §4 était une intention, pas une mesure                                                                                                                              |
| Rien ne reliait `schema.ts` aux migrations                     | ajouter une colonne sans régénérer donnait une porte **entièrement verte**, un `npm run dev` qui démarre (base de dev déjà migrée), et un `no such column` **sur base fraîche** — c'est-à-dire chez l'utilisateur, ou après restauration |
| Prettier réécrivait sans que rien ne vérifie                   | et sans `.prettierignore`, il aurait réécrit les instantanés générés par drizzle-kit, `CLAUDE.md` et `docs/`                                                                                                                             |

**Décision — n'activer que ce qui intercepte une faute déjà commise dans ce projet.** Le preset
`recommended-latest` de `eslint-plugin-react-hooks` v7 a été écarté : il embarque une quinzaine de
règles du React Compiler, hors sujet ici et contraires à la sobriété demandée par CLAUDE.md §9. Deux
règles seulement : `rules-of-hooks` et `exhaustive-deps`.

Deux devDependencies gratuites et locales ajoutées : `eslint-plugin-react-hooks` et
`@vitest/coverage-v8` — sans le second, le seuil de CLAUDE.md §4 restait indémontrable.

**Le résultat qui compte : la couverture de `packages/core`, mesurée pour la première fois.**
99,23 % de lignes, 97,48 % de branches, 96,72 % de fonctions. Le seuil de 80 % est très largement
tenu — il l'était sans doute depuis longtemps, mais **personne ne pouvait le savoir**. Deux points
bas nommés : `motifs.ts` (`definitionMotif` et `motifsPour` ne sont appelées par aucun test, seules
fonctions de `core` jamais exercées) et `reapprovisionnement.ts`.

> **Mise à jour du 30/07/2026 — ce point bas n'existe plus pour `motifs.ts`.**
> `packages/core/src/motifs.test.ts` existe désormais et teste les deux fonctions. `definitionMotif`
> a en plus gagné des appelants de production : `apps/api/src/routes/stock.ts:56` et `:293`, et
> `packages/db/src/services/mouvements.ts:550`. `motifsPour`, elle, est testée mais n'a toujours
> aucun appelant de production trouvé par recherche sur tout le dépôt — voir
> `docs/13-AUDIT-CAPACITES-ORPHELINES.md` §5.4, qui documente ce même point avec la recommandation
> de câblage restante (remplacer le filtre manuel de `apps/web/src/saisie-stock/SaisieSortie.tsx`).

**Test de dérive schéma/migrations.** `packages/db/src/schema-migrations.test.ts` migre à blanc et
compare tables et colonnes au schéma déclaré. Point de méthode : l'agent l'a **falsifié avant de le
livrer** — table fantôme et colonne fantôme injectées, le test échoue en nommant l'écart. Un test de
non-régression qu'on n'a pas vu échouer ne prouve rien. `db:generate` n'a **pas** été mis dans le
hook : une commande qui **écrit** des fichiers n'a rien à faire dans une vérification.

**Sur les hooks React : aucune violation de `rules-of-hooks`, aucune dépendance manquante de
`useEffect`.** Le code existant est propre sur le fond. Les 10 violations d'`exhaustive-deps`
relèvent toutes du même motif — `const x = etat.statut === 'pret' ? etat.x : []` recrée un tableau
neuf à chaque rendu et annule le `useMemo` qui en dépend. **Performance, pas justesse** : aucun
affichage n'est faux. D'où un **cliquet** — liste nominative et datée en `warn`, `error` partout
ailleurs, à supprimer et non à étendre.

**Dette assumée, non traitée : 105 fichiers non conformes à Prettier.** Le motif est systématique
(`'…d\'une erreur…'` → `"…d'une erreur…"`, l'apostrophe française échappée). Reformater 105 fichiers
pendant que quatre agents écrivaient aurait tout fait exploser. `format:check` existe comme script
mais n'est pas dans la porte : les deux gestes vont ensemble, en une fois, hors travail parallèle.

> **Mise à jour chiffrée du 01/08/2026.** La dette n'est plus de 105 fichiers mais de **24**
> (`npx prettier --check "**/*.{ts,tsx,json,md,css}"`, en excluant le répertoire `coverage/`
> qui n'est ignoré ni par `.gitignore` ni par `.prettierignore` — deux lignes à ajouter quand
> plus personne n'écrit). Elle s'est donc résorbée de 77 % au fil des lots, sans passage
> dédié. Le raisonnement ci-dessus reste valable tel quel : `format:check` n'est toujours pas
> dans la porte de sortie, et le passage groupé attend toujours un moment sans travail
> parallèle.

---

## D-048 — Un texte que nous n'écrivons pas ne franchit pas la frontière

**Contexte.** Audit de sécurité des secrets et de la chaîne Claude — zone jamais auditée jusque-là.
Le message d'une exception du SDK Anthropic partait **tel quel** à deux endroits : dans le corps
HTTP de la réponse, et dans `journal_ia.erreur` — laquelle est renvoyée au navigateur par
`GET /api/ia/journal`.

Ce texte n'est pas écrit par nous. Il vient du SDK, d'undici ou du système, et peut porter le
préfixe d'une clé (l'API le renvoie en 401), une URL avec paramètre, l'arborescence du poste ou une
pile d'appel — c'est-à-dire exactement ce que le balayage anti-fuite du dépôt s'interdit déjà par
ailleurs.

**Décision — séparer les deux usages, avec deux niveaux de sévérité différents.**

- **La raison affichée** est déduite du **seul statut HTTP** et écrite intégralement dans
  `packages/core`. Sur la frontière la plus exposée, **aucune liste de refus** : une liste de refus
  finit toujours par laisser passer quelque chose.
- **Le détail journalisé** est un extrait assaini et borné à 200 caractères. Sans lui, une panne
  récurrente redeviendrait invisible — ce que CLAUDE.md §4 interdit (« jamais de `catch`
  silencieux »).

**Ce que l'audit a confirmé SAIN, par mesure et non par intention.** `npm run build` puis fouille de
`apps/web/dist/` : zéro `sk-ant`, zéro `ANTHROPIC`, zéro `SMTP`, zéro `process.env`. Structurellement,
le SDK n'est déclaré que dans `apps/api`, `apps/web` ne dépend que de `@batte/core` qui ne lit aucun
environnement, et **aucune variable `VITE_` n'existe dans le dépôt** — or Vite inline toute variable
ainsi préfixée. Aucune réponse de Claude n'entre en base : `reponseBrute` est toujours `NULL`. Le
plafond est vérifié **avant** l'appel, sur le coût maximal. Le mode dégradé refuse en 200 motivé aux
quatre états (pas de clé, plafond nul, plafond atteint, panne réseau).

**Injection de prompt : surface nulle aujourd'hui.** L'usage « extraction de bon de livraison » est
déclaré au catalogue et à l'énumération SQL, mais **aucun code n'envoie de document fournisseur à
Claude**. Le cahier des charges de sécurité du futur lot est écrit au §6 de
`docs/11-AUDIT-SECURITE.md` plutôt que différé.

**Trois conséquences transférables.**

1. **`.env.example` doit décrire ce que le code lit, dans les DEUX sens.** Deux variables y étaient
   documentées sans être jamais lues, dont `PLAFOND_IA_MENSUEL_CENTS` — poser `=0` ne coupait rien,
   le plafond vit dans `parametre`. Une variable documentée mais ignorée fait croire à un réglage
   qui n'existe pas, et sur un plafond de dépense c'est une fausse sécurité.
2. **Un mode test doit simuler exactement ce qui serait parti.** Le mode test du mail archivait des
   en-têtes forgés qu'un vrai envoi n'aurait pas produits : un nom de fournisseur contenant `\r\n`
   créait une ligne `Bcc:` dans `sorties/mails/`. Nodemailer, lui, normalise. Le fichier de test
   décrivait donc un message qui n'aurait jamais existé — un mode test infidèle ment dans le sens le
   plus dangereux, celui qui rassure.
3. **Aucune valeur d'environnement ne franchit la frontière HTTP, pas même un numéro de port.** Les
   messages **nomment** les variables, ils ne les citent pas.

**Méthode.** Les corrections ont été **prouvées rouges** en rétablissant l'ancien code, et le
balayage anti-fuite couvre désormais les corps d'**erreur** — il n'exerçait que des réponses 200,
alors qu'une fuite dans un 500 vaut une fuite dans un 200. Un test dérive enfin la liste des usages
couverts **des exports réels du module** : c'est D-045 appliqué aux consignes système.

---

## D-049 — Rendre la démonstration honnête a révélé quatre défauts du produit

**Contexte.** Le jeu de démonstration ne contenait **aucun produit de nature `revendu`**. La
ventilation affichait donc 100 % transformé, `sortie_vente` n'était jamais émis, et le risque que
`CLAUDE.md` §6 désigne comme le principal — sortir de la franchise TVA sans le voir venir, parce que
la revente génère ≈ 2,6 fois plus de CA à marge égale — était **invisible à la première ouverture**.

Une donnée de démonstration sert à ce que l'utilisateur comprenne son outil avant d'y saisir sa vraie
activité. Celle-ci lui cachait exactement ce qu'il doit surveiller.

**Ce qui a été ajouté** : un circuit terroir complet — fournisseur, ingrédient à l'unité,
conditionnement (marge 36 %, dans la fourchette de §6), **deux lots de DLC différentes** pour que la
FEFO soit discernable d'un simple décompte, et une session close au mix exact de §6 (838 € sur
6 h 30, 134 crêpes). Aucun chiffre réglementaire inventé, aucun fournisseur réel, aucune donnée
personnelle.

**Observation qui mérite d'être notée** : 838 € pour 134 crêpes fait 6,25 € la crêpe, trois fois le
prix affiché. **Les deux chiffres de §6 ne sont donc pas compatibles avec un stand qui ne vendrait
que des crêpes** — la session de référence implique nécessairement une part de revente. La
ventilation retenue (433 € / 405 €) est _une_ répartition cohérente avec les deux chiffres
documentés, pas une mesure ; c'est écrit en commentaire et dans les notes de la session.

**Les quatre défauts que ces données ont fait apparaître, tous corrigés.**

**1. Le coût des marchandises revendues n'entrait pas dans la marge.** `cloturerSession` calculait
`cout_matiere_cents` à partir des seules **productions**. Le coût d'achat des pots était pourtant
écrit au centime près dans `mouvement_stock.cout_cents` par `sortirLesProduitsRevendus` — puis jeté.
Marge brute affichée sur la démonstration : **802 € sur 838 €, soit 95,7 %**, alors que la moitié du
CA venait d'une revente à 36 %. La vraie marge est 542,79 €. C'était exactement l'illusion que §6
demande de dissiper.

Corrigé en **déplaçant le calcul après les sorties de stock** : c'est la sortie FEFO qui donne le
coût d'achat réel, lot par lot. Le calculer avant obligerait à le reconstituer depuis un prix moyen,
c'est-à-dire à inventer un chiffre qu'on possède déjà exactement.

**2. Un article revendu ne déclenchait jamais de réapprovisionnement.** La série de consommation
filtrait sur `type = 'sortie_production'` uniquement. Un article qui ne sort que par `sortie_vente`
avait une consommation perçue **nulle**, donc un point de commande nul : on ne l'aurait jamais
recommandé. Les deux sorties commerciales sont désormais retenues. Les autres types restent exclus à
dessein : une perte ou une casse est un accident, pas de la demande — les inclure ferait commander
pour couvrir des pertes futures.

**3. La traçabilité ignorait les marchandises revendues — défaut réglementaire.** `tracabilite.ts`
ne parcourait que `production_consommation`. Un article revendu ne passe par aucune production : son
lot n'est relié à la session que par le mouvement. **En cas de rappel sur un lot de sirop,
l'application ne disait pas dans quelles sessions il avait été vendu.** L'obligation AFSCA ne fait
aucune différence entre transformé et revendu.

Les deux sens ont désormais une branche `sortie_vente`. **Le lot revendu est rendu dans un bloc
`revendus` distinct, jamais greffé dans `productions[].consommations`** : l'y mettre fabriquerait
une production qui n'a pas eu lieu, dans le document même qui sert à prouver ce qui s'est passé.

**4. Le moteur pouvait commander au fournisseur système.** Reproduit, pas supposé.
`conditionnementReference` prenait le conditionnement le plus récent **tous fournisseurs confondus**,
et rien n'écartait « Inventaire d'ouverture ». Le geste déclencheur est banal : c'est le fournisseur
qu'on vient d'utiliser pour déclarer son stock d'ouverture.

Corrigé par une valeur d'enum `systeme`, **lisible mais non saisissable** — `schemaSaisieFournisseur`
n'accepte que les quatre types commerciaux, sans quoi un formulaire pourrait fabriquer du stock
d'origine non tracée à volonté. Aucune migration : l'enum est déclarative côté TypeScript, SQLite ne
porte pas de contrainte `CHECK` sur cette colonne.

**Sur la méthode.** Les quatre défauts avaient été encodés en `it.fails` par l'agent qui les a
trouvés. Les corriger les a fait **passer au rouge** — « Expect test to fail » — ce qui force à les
convertir en non-régression. Le mécanisme a fonctionné exactement comme prévu.

Un cinquième test a cassé pour une autre raison, plus intéressante : il calculait la marge du
transformé comme `caTransforme − coutMatiere`, formule juste **tant que `coutMatiere` ne portait que
la production**. Corriger le champ a rendu le test faux. Réécrit pour lire le coût revendu **sur les
mouvements** plutôt que de le reconstituer depuis un prix moyen de conditionnement — qui aurait été
voisin mais faux dès qu'il existe deux lots de prix différents, ce qui est précisément le cas ici.

---

## D-050 — Une colonne se coupe si et seulement si deux valeurs distinctes ne peuvent pas s'afficher identiques

**Contexte.** Suite de D-043 : 45 colonnes textuelles n'avaient ni `titre` ni `troncature`.

**Le résultat du tri est le contraire de ce qu'on attendait : 44 des 45 sont restées telles
quelles.** 18 dates, 25 énumérations bornées (statut, gravité, méthode, fréquence, nature),
2 colonnes de bouton — aucune ne peut rendre deux valeurs distinctes identiques. Une seule a changé,
et pour une raison qu'un audit statique n'aurait pas vue : le créneau horaire des ventes, parce que
ce tableau est **aussi** rendu dans une fiche dockée de 460 px, où « 10:00–11:00 » et
« 10:00–12:00 » s'affichaient tous deux « 10:00–… ».

**Le vrai gisement était ailleurs : dans des colonnes réputées « traitées » par un `titre`.** Or
`titre` n'est pas un recours — il n'est pas exposé au clavier. Neuf colonnes supplémentaires sont
passées en `repli`, chacune **mesurée** (`scrollWidth > clientWidth` à 1280 px) et non jugée à
l'œil : numéro de lot fournisseur et ingrédient en production (traçabilité AFSCA), tâche et motif du
registre (10 rangées sur 10 coupées), action corrective, nom de recette (c'est le suffixe
« (sans gluten) » qui sautait), allergènes, clé de paramètre, motif de réouverture de période.

**Le contrat de `titre`, désormais explicite** : l'infobulle doit **commencer par le texte
réellement rendu** et ne jamais en dire moins. Cinq violations trouvées, dont deux subtiles — un
`titre` valant chaîne vide sur une cellule affichant « — » pose un `title=""`, soit une infobulle
vide ; et une cellule affichant le volume **réel** dont l'infobulle donnait le **théorique**, or les
deux ne diffèrent que lorsqu'il y a un écart de rendement, c'est-à-dire précisément quand on
survole.

**La largeur n'est pas la réponse à la troncature.** Élargir la colonne « Nom » des recettes coupait
l'en-tête voisin « SANS GLUTEN ». On arbitre par `repli` ; on ne déplace de la largeur que **depuis
une colonne bornée vers une colonne mesurée comme débordante**.

**Clavier hors tableaux.** Deux points étaient sains : un `:focus-visible` global sans aucun
`outline-none`, et l'unique `tablist` conforme à l'APG. Le défaut réel était que **9 écrans sur 13
n'avaient aucun `<form>`** — `Entrée` n'y faisait rien. Treize grappes de saisie converties.

**Règle retenue, avec son exception motivée** : `<form onSubmit>` est le défaut de toute grappe de
saisie, **sauf** pour une action irréversible. « Lancer la production » consomme le stock en FEFO et
n'a délibérément pas été enveloppé : y rendre `Entrée` actif créerait le geste destructif par
mégarde qu'on cherche à éviter. La clôture de période, elle, passe désormais par une confirmation
qui **nomme le mois** — c'était le seul verrouillage comptable atteignable par une tabulation de
trop.

**Reste à trancher par le porteur** : `Ctrl+S` sur l'écran Sessions déclenche la **clôture
définitive**. Le réflexe « Ctrl+S = j'enregistre mon brouillon » clôture donc une pièce comptable.
Soit une confirmation, soit une vraie séparation brouillon / clôture — c'est une décision produit.

---

## D-051 — Le mode production n'avait jamais démarré, et rien ne pouvait le dire

**Contexte.** Le porteur du projet ouvre `http://127.0.0.1:3001/` dans son navigateur et reçoit
`{"erreur":{"code":"route_introuvable","message":"Route inconnue : GET /."}}`.

Ce comportement était **correct en développement** : le front est servi par Vite sur `:5173`, l'API
ne sert que `/api`. Mais la vérification a mis au jour un défaut d'une tout autre gravité.

**Le défaut.** `apps/api/src/plugins/erreurs.ts` posait un `setNotFoundHandler`, et `serveur.ts` en
posait un **second** en production pour le repli SPA. Or **Fastify n'accepte qu'un seul gestionnaire
de route inconnue par préfixe et lève au second appel.** `construireServeur` échouait donc avec
`Not found handler already set for Fastify instance with prefix: '/'` dès que
`NODE_ENV=production`.

Autrement dit : **le mode production n'a jamais pu se construire, encore moins écouter.** Or D-001
en fait la promesse centrale du produit — « en production, la même instance Fastify sert aussi le
bundle React ; un seul processus, un seul port à lancer sur le poste de travail ». Cette promesse
était morte à l'écriture.

**Pourquoi rien ne le signalait, et c'est le point de méthode.** Les 892 tests construisaient tous le
serveur **sans toucher à `NODE_ENV`**, donc systématiquement dans la branche développement — la
seule qui fonctionnait. `typecheck`, `lint`, `vitest` et `build` étaient verts, et l'audit d'outillage
(D-047) qui avait mesuré tous les périmètres n'avait rien à mesurer ici : le fichier était couvert,
c'est la **branche** qui ne l'était pas.

> **Un mode jamais exercé n'est pas testé, il est supposé.**

C'est la même famille que D-045 (« une liste écrite à la main n'est pas une preuve d'absence ») et
que D-047 (« la porte de sortie était verte parce qu'elle ne regardait pas ») : la vérification
existait, son **périmètre** était l'angle mort.

**Décision.** **Un seul point d'inscription.** `enregistrerGestionnaireErreurs(app, surRouteInconnue)`
prend le comportement en paramètre, avec `envoyerReponse404` par défaut. `serveur.ts` lui passe un
gestionnaire unique qui décide selon le mode. La faute devient **inécrivable** : il n'y a plus deux
endroits où inscrire.

**Corollaire ergonomique, traité au passage.** En développement, la racine de l'API répond désormais
par une **redirection 302 vers `http://localhost:5173`**, en conservant le chemin demandé — ouvrir
`/stock` sur le port de l'API mène à `/stock` sur l'interface, pas à l'accueil. On redirige plutôt
qu'on explique : la bonne réponse à « je me suis trompé de porte » est d'ouvrir la bonne, pas de
décrire la bonne. Et `localhost`, jamais `127.0.0.1` : Vite écoute en IPv6 sous Windows, une
redirection vers l'adresse IPv4 aboutirait à une connexion refusée.

**L'invariant qui compte, et qui vaut dans les deux modes.** Une route `/api` inconnue reste un
**404 JSON**. Servir l'HTML de l'application sur un appel d'API serait le pire des deux mondes : le
client recevrait 200 accompagné de HTML là où il attend du JSON, et le défaut se manifesterait à
l'analyse syntaxique — loin de sa cause, et sans rapport apparent avec elle.

**Conséquences.** `apps/api/src/serveur-modes.test.ts` (7 tests) exerce **les deux modes** : que le
serveur se construise, ce qu'il sert à la racine, la conservation du chemin dans la redirection,
l'interdiction de `127.0.0.1`, et l'invariant du 404 JSON. Le mode production a été vérifié en
exécution réelle : `GET /` et `GET /stock` rendent l'HTML, `GET /api/sante` rend 200,
`GET /api/route-inconnue` rend un 404 JSON.

**Piège de test consigné.** `NODE_ENV` est un état **global du processus**. Un test qui le modifie
sans le restaurer fait basculer les fichiers suivants dans l'autre mode, avec des échecs dont la
cause est introuvable. Restauration en `afterEach`, systématique.

---

## D-052 — Ce que l'application ne tranche PAS : les questions ouvertes au comptable

**Contexte.** `CLAUDE.md` §7 interdit de coder une règle fiscale que l'application n'a pas
autorité à fixer : « l'application ne remplace pas un comptable ». Plusieurs audits ont donc
signalé sans corriger — et c'était le bon réflexe. Mais ces signalements vivaient dispersés dans
sept rapports d'audit, où personne ne va les relire.

**Cette entrée existe pour qu'ils aient UNE adresse.** Elle sera mise à jour à mesure que les
réponses arrivent — une question résolue devient une décision numérotée, pas une ligne effacée.

**Le numéro D-052 lui-même est une correction.** Le journal sautait de D-051 à D-053 : j'avais
rédigé deux décisions dans un fichier de travail sans vérifier le compteur. Un journal de décisions
avec un trou fait douter de tout ce qu'il contient — on se demande ce qui a été supprimé. Rien ne
l'avait été ; c'était une faute d'écriture, et elle est réparée ici plutôt que masquée.

### Les deux questions principales

**1. Comptabilité de trésorerie ou d'engagement ?**
L'implémentation déduit un achat **l'année où il est payé**, sans retrancher le stock non consommé
au 31 décembre. Si le régime exige la comptabilité d'engagement (`stock initial + achats −
stock final = charge`), les charges sont **surévaluées les années où le stock s'accumule**, donc le
bénéfice sous-évalué, donc les cotisations et l'impôt estimés trop bas. La donnée nécessaire existe
déjà (`valoriserStock`, lot par lot au prix payé).

**2. Double comptage d'un achat de matière.**
Rien n'empêche de saisir à la main une dépense de catégorie « Matière » correspondant à un achat
**déjà réceptionné**. Aucune clé étrangère ne relie `depense` à `reception` : le code ne peut pas
détecter le doublon. Décision retenue — **avertir au point de saisie, ne pas retirer la
catégorie** : un achat comptant jamais passé par une réception est un cas légitime, et supprimer
l'option ferait disparaître silencieusement une charge réelle.

### Les autres, signalées par les audits et non tranchées

- **Prorata temporis absent** sur la première annuité d'amortissement. Un plan de 5 ans devrait
  peut-être s'étaler sur 6 exercices ; si le prorata est obligatoire, le plan est faux sur **tous**
  ses exercices.
- **Dégressif non plafonné**, et la dernière annuité qui **remonte** au lieu de basculer en
  linéaire. Question préalable : le régime dégressif est-il seulement ouvert à ce contribuable ?
- **`date_cession` ni écrite ni lue** : un bien cédé continuerait de produire ses annuités.
- **Cotisation INASTI en taux plat** sur le bénéfice brut, sans assiette circulaire, sans cotisation
  minimale, sans régularisation. `taux_ipp_marginal_bp` porte la mention « estimation indicative » ;
  `taux_cotisation_inasti_bp` **ne la porte pas** — asymétrie à corriger, elle, sans avis extérieur.
- **Étiquetage des trois seuils légaux** : deux sont documentés comme douteux dans `SEUILS.source`
  (`docs/07` §6.6). Corriger le câblage rend le compteur cohérent avec sa description ; ça ne garantit
  pas que la description soit juste.

**Règle de conduite.** Aucune de ces lignes ne se code sans réponse. En attendant, l'application
affiche ce qu'elle sait calculer, avec la mention d'indication déjà présente à l'écran — jamais un
chiffre présenté comme une déclaration.

> ### Mise à jour du 01/08/2026 — état de chaque ligne, vérifié dans le code
>
> Une seule des lignes ci-dessus a bougé, et c'est la seule qui pouvait bouger sans avis
> extérieur :
>
> - **L'asymétrie de mention est corrigée.** La liste ci-dessus relève que
>   « `taux_cotisation_inasti_bp` **ne porte pas** » la mention « estimation indicative ». Il la
>   porte aujourd'hui (`packages/core/src/parametres.ts` : « Estimation indicative :
>   l'application ne remplace pas un comptable. »). Ligne close.
> - **Tout le reste est encore ouvert, et c'est normal** — ce sont des questions
>   réglementaires, pas du travail en attente. Revérifié le 01/08 : `planAmortissement`
>   (`packages/core/src/comptabilite.ts`) ne contient **aucun** prorata temporis, le régime
>   dégressif y applique « taux double du linéaire » **sans plafond**, et `dateCession`
>   n'apparaît dans **aucun** schéma d'entrée — elle n'existe qu'en sortie sur
>   `schemaImmobilisationDetail`, où elle vaut toujours `null`, gardée par le test nommé en
>   D-070 (vert).
>
> **Deux questions se sont ajoutées depuis** et appartiennent à cette liste : le double
> comptage possible du **gaz** (ingrédient acheté en bouteille _et_ frais de session
> forfaitaire) et du **trajet** (jusqu'à trois écritures pour le même déplacement) — voir
> D-073, qui les signale et démontre par test qu'aucune protection n'existe. Elles attendent
> le porteur, pas un agent.

---

## D-053 — Les garnitures sortent du stock, et leur traçabilité a son propre bloc

**Contexte.** La table `produit_garniture` était déclarée au schéma et **morte** : ni écrite, ni
lue. Conséquence : une crêpe au sucre ne consommait pas de sucre. Le coût matière ignorait la
garniture, les garnitures ne sortaient jamais du stock — donc aucun réapprovisionnement, aucune
traçabilité de lot sur une denrée pourtant étalée sur un produit vendu au public.

**Décision.** Les garnitures sortent en FEFO à la clôture, comme les produits revendus (D-037), et
leur coût entre dans `coutMatiereCents`. Le calcul de rentabilité reste **après** les sorties de
stock : c'est la sortie FEFO qui donne le coût d'achat réel lot par lot (D-049).

**Mesure sur la démonstration.** Coût matière de la session : 29 521 c → **31 073 c** (+15,52 €).
Marge brute : 542,79 € → **527,27 €**. Coût matière par crêpe vendue : 0,2687 € → **0,3846 €**.

**Un chiffre qui dépasse maintenant la cible, et c'est une information.** `CLAUDE.md` §6 annonce
0,33 €/crêpe ; on obtient 0,385 €. Les 20 g de cassonade et 20 g de sirop de la graine sont des
ordres de grandeur assumés — le commentaire du seed dit lui-même « pesez une cuillère… puis
corrigez-les ». Ils sont généreux d'environ 50 % ; 0,33 € correspondrait à ≈ 13 g par crêpe. **À
peser sur le premier marché.** Le branchement révèle donc une inconnue qui existait déjà et que
personne ne pouvait voir tant que la garniture valait zéro.

**Traçabilité : un bloc propre, dans les deux sens.** Les deux rattachements existants étaient faux,
chacun pour sa raison. Dans les **consommations d'une production** : aucune fournée n'étale de
garniture — c'est l'argument de D-049, mot pour mot. Dans les **marchandises revendues** : une
garniture n'est pas vendue telle quelle.

Et la différence est **opérationnelle, pas cosmétique** : le client d'un pot fermé emporte
l'emballage, donc le numéro de lot ; **le client d'une crêpe garnie n'emporte rien**. Seul le
registre sait où le lot est parti. C'est exactement cette différence qui décide de la portée d'un
rappel — public ou interne. La fondre dans « Marchandises revendues » ferait perdre l'information
qui déclenche cette décision.

D'où un champ que le bloc revendu n'a pas : le **produit porteur**. Il relie le lot à l'assiette.

**Limite connue, documentée en commentaire, jamais silencieuse.** Le discriminant est
l'appartenance à `produit_garniture ⋈ session_vente` : rien sur le mouvement ne sépare une garniture
d'un revendu. Un ingrédient à la fois étalé **et** vendu tel quel le même jour verrait toutes ses
sorties classées en garniture. **Rien ne disparaît du registre** — lot, quantité et coût restent
intégralement lisibles ; seule l'étiquette serait celle du composant. Trancher exactement exigerait
un type de mouvement `sortie_garniture` dans l'énumération du schéma. Le modèle décourage déjà le
cas : la graine distingue le pot (`piece`) du vrac (`g`), qui sont deux articles.

**Conséquence pratique.** Les sessions **déjà clôturées ne sont pas réécrites** — une pièce
comptable ne se recalcule pas (D-024). La correction se voit à la prochaine clôture.

---

## D-054 — Chaque seuil légal est confronté à SON assiette

**Contexte.** Les trois compteurs de seuils recevaient le même réalisé : le **chiffre d'affaires**.
Or `seuil_cotisation_reduite_cents` porte sur un **revenu net**, grandeur différente et toujours
inférieure.

Détail qui dit tout : le champ `assiette` était **déjà déclaré** sur les trois définitions de
`SEUILS`, avec la valeur `'total'`, et **n'était lu nulle part**. L'intention avait été posée, le
câblage n'avait jamais suivi.

**Mesure au rythme de référence de `CLAUDE.md` §6.** Au bout de 21 sessions, le CA vaut 17 598 € : le
compteur affichait **101,3 %** du seuil de 17 374,08 € et criait « dépassement ». Le revenu net
estimé sur le même exercice valait **7 617,40 €**, soit **43,8 %**. Écart de 9 980 €, facteur 2,31.

**Le sens de l'erreur est ce qui la rend dangereuse.** Le net étant toujours inférieur au CA,
l'alerte ne pouvait pas arriver trop **tard**. Elle arrivait trop **tôt** — ce qui est plus
insidieux : un compteur qui crie au loup désensibilise l'utilisateur aux **deux vrais compteurs de
CA**, ceux qui, eux, peuvent lui faire perdre la franchise TVA sans prévenir. Une fausse alerte
n'est pas une prudence excessive ; elle détruit la valeur des vraies.

**Décision.** `tableauSeuils` lit `definition.assiette` et confronte chaque seuil à sa grandeur :
CA pour les deux premiers, `syntheseExercice(...).netEstimeCents` pour le troisième. Le net est
calculé **une seule fois** et seulement s'il sert.

**Un test encodait le défaut.** `parcours-erp.test.ts` affirmait `realiseCents === caTotalCents`
pour les trois compteurs — il figeait donc l'erreur au lieu de la détecter, et c'est précisément ce
qui la rendait invisible. **Un test peut sceller une faute aussi sûrement qu'une règle.** Deux autres
tests portaient la même supposition. Tous trois réécrits pour asserter l'invariant : les deux seuils
de CA portent le même réalisé, celui de revenu net en porte un autre, strictement moindre, égal au
net de la synthèse.

**Corollaire traité dans la foulée : l'alerte à 80 % n'existait pas.** `CLAUDE.md` §6 l'exige,
`seuil_alerte_bp` était au catalogue, et `statutParPlafond` existait dans `packages/core`, testée —
**appelée nulle part**. L'écran faisait `depassementProjete ? 'depassement' : 'conforme'`. À
**21 250 €, soit 85 % du seuil de franchise TVA**, la ligne s'affichait donc **en vert**, avec
3 750 € de marge avant la sortie de franchise.

Les **deux** signaux sont désormais combinés, parce qu'ils ne disent pas la même chose :
`statutParPlafond` regarde le **réalisé** — où j'en suis ; `depassementProjete` regarde la
**trajectoire** — où je vais. On peut être à 40 % du seuil et le franchir avant décembre ; on peut
être à 85 % en décembre sans risque. N'en garder qu'un laisserait passer la moitié des cas.

---

## D-055 — L'électricité est un attribut du LIEU, pas une hypothèse du projet

**Date** : 29/07/2026 · **Contexte** : demande explicite du porteur

### Contexte

`CLAUDE.md` §6 posait depuis l'origine : « pas d'électricité (gaz uniquement) ». Cette phrase était
traitée comme une contrainte du **projet**, donc valable partout.

Le porteur l'a corrigée : _« il est possible qu'il y ait de l'électricité comme il est possible que
non, tout dépend du lieu, du marché, donc on doit pouvoir avoir le paramètre électricité en plus au
cas où »_.

### Options

- **A — garder la contrainte globale.** Simple, mais fausse dès le deuxième marché : elle
  interdirait de modéliser un emplacement qui fournit du courant.
- **B — supposer l'électricité disponible partout.** Symétriquement fausse, et bien plus
  dangereuse : elle ferait dépendre l'application d'une ressource absente le jour du marché.
- **C — en faire un attribut de `lieu_marche`.** L'information est portée par l'endroit où elle
  se constate.

### Choix

**C.** L'électricité devient un attribut du lieu.

Ce n'est pas seulement le choix le plus exact, c'est le seul qui reste vrai quand l'activité
s'étend à plusieurs marchés — ce que le porteur a annoncé comme imminent. Une contrainte globale
aurait dû être révisée au premier emplacement différent.

Le gaz reste la source de cuisson par défaut, et **le mode dégradé sans électricité reste la
règle** : même exigence que pour les appels Claude (§5), une ressource absente ne doit jamais
empêcher de travailler.

### Conséquences

1. `CLAUDE.md` §6 est réécrit : la contrainte n'est plus « pas d'électricité » mais « l'électricité
   dépend du lieu ».
2. `lieu_marche` recevra l'attribut. **Aucune valeur par défaut optimiste** : en l'absence
   d'information, on suppose qu'il n'y a pas de courant — se tromper dans ce sens ne coûte qu'une
   occasion manquée, alors que l'inverse coûte une session ratée.
3. La **capacité de cuisson** (`capacite_cuisson_crepes_par_heure`) devient dépendante du lieu, et
   non plus seulement du matériel. C'est déjà un paramètre et une contrainte d'écrêtage du moteur
   de prévision : le jour venu, **c'est une valeur à faire varier, pas du code à écrire**.
4. En dépendent aussi : le froid actif ou passif (donc les relevés AFSCA, et la possibilité de
   vendre de la pâte crue — fiche 15), et le terminal de paiement connecté sur place.
5. Ne **pas** modéliser l'électricité comme un ingrédient : le gaz arrive en bouteilles, donc en
   lots traçables ; l'électricité se compte au compteur. Détail traité dans la fiche 17.

---

## D-056 — Pas d'authentification ni de RLS : la fiche 11 est reportée

**Date** : 29/07/2026 · **Contexte** : décision du porteur, sur signalement d'une contradiction

### Contexte

`docs/demandes/11-PROFILS-UTILISATEURS.md` demandait des profils utilisateurs, en s'appuyant sur
**Supabase** et sur des **politiques RLS** (_row level security_). Deux problèmes, signalés au
porteur avant tout développement :

1. **Ni Supabase ni RLS n'existent dans ce projet.** La base est un fichier **SQLite local**
   (décision **D-001**), sans serveur de base de données, donc sans mécanisme de RLS.
2. **La fiche citait D-012 comme étant la politique RLS.** D-012 est en réalité _« Application web
   servie en local, pas de packaging desktop »_. La citation était erronée.

Conformément à la règle du porteur — _si une fiche contredit une décision consignée, la décision
l'emporte et on le lui dit_ — la contradiction lui a été soumise.

### Options

- **A — implémenter avec Supabase.** Introduirait un service cloud et une dépendance externe, ce
  que `CLAUDE.md` §7 interdit sans validation explicite, et contredirait D-001 (coût 0 €/mois,
  tout en local).
- **B — reproduire une RLS en local.** Construire un mécanisme de droits sur SQLite pour **deux
  personnes qui partagent le même poste**. Beaucoup de complexité pour aucun besoin réel.
- **C — reporter.**

### Choix

**C — reporter**, sur décision explicite du porteur : _« on va laisser tomber cette fiche 11,
Supabase n'est pas utile pour le moment, on la laisse de côté, nous verrons cela plus tard »_.

### Conséquences

1. **Aucune authentification n'entre dans le produit.** `CLAUDE.md` §0 reste vrai sans retouche :
   _« mono-utilisateur — pas de gestion de droits, pas de workflow d'approbation »_.
2. **Le besoin réel derrière la fiche reste valable et sera traité autrement.** Savoir **qui** a
   saisi quoi relève de l'**attribution**, pas de l'authentification : un champ sur l'écriture, pas
   un contrôle d'accès. Le journal d'audit couvre déjà la traçabilité des modifications.
3. **Le sujet reviendra si des employés arrivent** (fiche 19 §5). Ce jour-là, il faudra réviser
   `CLAUDE.md` §0 explicitement — pas ajouter des droits en silence.
4. La **vague 3 est vide** : la séquence passe directement à la vague 4 (prévision).

---

## D-057 — Deux façons de clôturer une session, au choix, et la mesure se conserve

**Date** : 29/07/2026 · **Contexte** : demande explicite du porteur

### Contexte

La clôture exigeait un **nombre de crêpes produites**. Le porteur a demandé le choix :

> _« Je préfère avoir le choix manuel entre nombre de crêpes vendues et quantité en ml ou g vendue
> et restante, ce serait plus simple et ça me nécessiterait moins de calcul. »_

Compter 130 crêpes à 23 h après un marché est une source d'erreur ; regarder ce qu'il reste dans le
bac est une mesure immédiate.

### Choix

**Deux modes exclusifs**, au choix à chaque session :

| Mode                 | Il saisit                      | L'application déduit                                    |
| -------------------- | ------------------------------ | ------------------------------------------------------- |
| Je compte les crêpes | crêpes produites               | rien                                                    |
| Je compte la pâte    | volume **restant** dans le bac | crêpes produites, au prorata des productions rattachées |

Trois points ont été tenus fermement :

1. **Le nombre d'invendues reste saisissable à la main dans LES DEUX modes** — exigence explicite du
   porteur. Il n'est jamais noyé dans le volume restant.
2. **Les grammes sont acceptés à la saisie mais refusés sans densité déclarée.** `convertir()` de
   `packages/core/src/unites.ts` refuse d'elle-même une conversion masse↔volume sans densité
   (`CLAUDE.md` §3 règle 4). Aucune densité de pâte n'existe dans le modèle : **rien n'a été
   inventé**, le refus est explicite et porte un message contextuel.
3. **L'écart devient une information, jamais un refus.** En mode volume, un écart entre les crêpes
   déduites et (vendues + invendues + cassées) s'affiche et **ne bloque pas la clôture** — c'est une
   mesure, pas une saisie contradictoire. Le refus est **conservé** dans l'autre cas : un nombre de
   crêpes déclaré explicitement qui contredit une production rattachée fait toujours échouer la
   clôture.

### La conséquence la plus intéressante

Le contrôle de cohérence **change de nature**. Il cessait de comparer deux nombres que
l'utilisateur avait tapés lui-même ; il compare désormais ce qu'il a **mesuré** à ce que
l'application **prévoyait**. Un écart devient donc une information exploitable — pâte plus épaisse,
louche plus généreuse, rendement réel différent du théorique — au lieu d'un motif de refus.

### Conséquences sur le schéma (migration 0012)

Deux colonnes ajoutées à `session_marche` : `mode_cloture` et `volume_restant_mesure_ml`.

**Pourquoi** : sans elles, la mesure d'origine disparaissait à la clôture. `crepes_produites`
survivait, mais plus rien ne disait **d'où il venait**, ni ne permettait de le revérifier. C'est la
même raison d'être que `especes_comptees_cents` : **ce que l'utilisateur a mesuré se conserve, ce
qui en est dérivé se recalcule.** Les deux colonnes sont `NULL` sur les sessions closes avant leur
existence, et en mode « je compte les crêpes ».

### Limite connue, non refermée

Aucune **densité de pâte** n'existe (seule `ingredient.densite_g_par_ml` existe, pour un ingrédient,
pas pour la pâte finie). Peser sa pâte restera donc refusé tant qu'une source de densité n'aura pas
été déclarée — paramètre ou champ de recette. À décider le jour où le besoin est réel, pas avant.

---

## D-058 — Une prévision météo à J-7 et une à J-3 sont deux faits, pas une correction

**Date** : 29/07/2026 · **Contexte** : défaut trouvé en implémentant la fiche 07

### Contexte

`meteo_observation` portait un index unique sur `(lieu_id, date_observation, type)`. Une seule
ligne pouvait donc exister par lieu, par jour et par type — et **une prévision récupérée à J-3
écrasait silencieusement celle de J-7**.

Trois choses s'en trouvaient contredites :

1. `docs/03-MOTEUR-PREVISION.md` demande explicitement la **conservation de toutes les versions**.
2. `CLAUDE.md` §3 règle 7 : **rien ne s'efface**.
3. Le prédicteur d'écart météo de la fiche 07 est censé mesurer **la différence entre la météo
   annoncée à sept jours et celle réellement observée**. Avec un seul relevé conservé, il mesurait
   une différence qui n'existait plus.

Le défaut ne produisait aucune erreur : la donnée disparaissait chaque semaine, sans signal.

### Options

- **A — clé incluant `recupere_le`.** Conserve tout, mais deux récupérations le même jour créent
  deux lignes sans que ça apprenne quoi que ce soit.
- **B — clé incluant l'HORIZON** (nombre de jours entre récupération et date observée).
- **C — table d'historique séparée.** Plus lourd, et sépare des faits de même nature.

### Choix

**B.** L'horizon est exactement la grandeur que le modèle utilise — « la prévision faite à sept
jours » — et il déduplique naturellement : re-récupérer le même horizon le même jour remplace la
ligne au lieu d'en empiler une.

**Le point conceptuel** : une prévision à J-7 et une prévision à J-3 pour le même dimanche ne sont
pas deux versions d'un même fait dont la seconde corrigerait la première. **Ce sont deux faits
distincts** — ce que l'on croyait à sept jours, et ce que l'on croyait à trois. L'écart entre eux
est une information, et c'est même précisément celle qu'on cherche.

### Conséquences

1. Migration **0015** : `DROP INDEX`, `ADD COLUMN horizon_jours`, `CREATE UNIQUE INDEX` sur
   `(lieu_id, date_observation, type, horizon_jours)`. **Aucune reconstruction de table**, donc le
   piège D-044 ne s'applique pas.
2. `horizon_jours` vaut **0** pour `type = 'reelle'` — on observe le jour même, par définition.
3. La colonne est **NULLABLE** : les lignes antérieures ont un horizon **inconnu**, et « inconnu »
   n'est pas « zéro ». Ne jamais leur en inventer un — même principe que `mode_cloture` en D-057.
4. Le code de récupération météo doit désormais **calculer et écrire** l'horizon. Tant qu'il ne le
   fait pas, le prédicteur d'écart météo reste silencieux, ce qui est le comportement correct.

---

## D-059 — Les facteurs ne se demandent pas au porteur, ils s'apprennent

**Date** : 29/07/2026 · **Contexte** : réponse du porteur à une question que je n'aurais pas dû poser

### Contexte

La fiche 2 de `docs/17-VINGT-AMELIORATIONS.md` relève deux trous dans la grille des priors météo :
un dimanche ensoleillé entre 22 et 26 °C, et un dimanche ensoleillé entre 5 et 10 °C, retombent
tous deux sur la catégorie `couvert_sec`, facteur **1,00**. Mesuré en production le 29/07 :
25,3 °C sous 13 % de nuages, classé « couvert et sec ».

La fiche concluait : _« le porteur doit fournir les deux valeurs — c'est une décision métier, pas
un calcul »_. Je lui ai donc posé la question, avec quatre valeurs au choix.

**Sa réponse a corrigé la fiche, et elle est meilleure :**

> _« Ce sont vraiment le genre de données que l'on va justement étudier avec l'application au fil
> des semaines. C'est pour ça que chacune des sessions de vente réalisées doivent être enregistrées
> indéfiniment, afin de pouvoir faire ce genre de statistique. »_

### Le défaut de fond que ça révèle

L'application a **la forme** de l'apprentissage, pas le **mécanisme**.

- `evenement.impact_mesure_bp` existe, son commentaire dit explicitement _« `impact_estime_bp` est
  ce qu'on croyait AVANT, `impact_mesure_bp` ce qu'on a mesuré APRÈS »_ — et **aucun code ne
  l'écrit**. Vérifié : zéro `insert`/`update` sur cette colonne dans tout le dépôt. C'est la fiche 4
  de `docs/17`, et c'est le même défaut que la grille météo.
- Les priors météo sont des constantes de catalogue qu'aucune observation ne vient corriger.

Autrement dit : le produit **enregistre** au lieu d'**apprendre**. Or garder l'historique
indéfiniment (fiche 07, décision de rétention) n'a de sens que si quelque chose s'en sert.

### Choix

**Ne pas demander de valeur au porteur. Rendre les facteurs mesurables, puis les laisser
se mesurer.** En trois temps :

1. **Créer les catégories manquantes** (`ensoleille_tiede`, `ensoleille_frais`) avec un prior
   **explicitement neutre à 1,00**, documenté comme _prior non mesuré_. C'est l'étape qui débloque
   tout : tant que ces conditions retombent dans `couvert_sec`, elles ne peuvent pas être mesurées
   **séparément**, donc jamais apprises. **Le découpage est le préalable, pas la valeur.**
2. **Refermer la boucle de mesure**, sur le même patron que celui déjà décrit pour les événements :
   une fois la session passée, l'écart entre le prévu et le réalisé alimente un facteur **mesuré**,
   qui **prime** sur le prior dès qu'il repose sur assez d'observations.
3. **Afficher lequel des deux est en usage.** « Facteur 1,00 — prior, jamais mesuré » et
   « Facteur 1,12 — mesuré sur 9 dimanches » ne se valent pas, et l'utilisateur doit voir la
   différence dans le tableau « D'OÙ VIENT CE CHIFFRE ».

### Conséquences

1. **La fiche 2 n'est plus bloquée** par une décision du porteur. Sa dépendance déclarée était
   fausse : il ne manquait pas un chiffre, il manquait un **découpage** et une **boucle**.
2. Le garde-fou de la fiche 07 s'applique tel quel : un facteur mesuré n'entre en jeu qu'après
   validation croisée _leave-one-out_. On ne remplace pas un prior neutre par du bruit.
3. **Ne jamais inventer un prior non neutre.** 1,00 assumé et signalé comme non mesuré est honnête ;
   1,10 deviné ne l'est pas — et serait indistinguable d'une valeur mesurée une fois en base.
4. Les fiches **2 et 4 sont le même travail** : refermer la boucle prévu/réalisé. À traiter
   ensemble, pas séparément.

> ### ⚠️ Correction du 30/07/2026 — la moitié « événements » du défaut de fond est refermée, la moitié « météo » reste ouverte
>
> Le paragraphe « Le défaut de fond que ça révèle » ci-dessus affirme, au présent : « `evenement.impact_mesure_bp` existe… et **aucun code ne l'écrit**. Vérifié : zéro `insert`/`update` sur cette colonne dans tout le dépôt. » **Ce n'est plus vrai.**
>
> Vérifié dans le code : `packages/db/src/depots/previsions.ts` porte désormais `mesurerImpactEvenement` (à partir de la ligne 856), qui calcule une moyenne d'impact mesuré sur les sessions closes de la fenêtre de l'événement et écrit `impactMesureBp` (ligne 894 : `.set({ impactMesureBp: moyenneBp, ... })`). Cette fonction n'est pas orpheline : `rapprocherPrevision` (ligne 905) l'appelle pour chaque événement actif le jour de la session (ligne 942), et `rapprocherPrevision` est elle-même appelée depuis `cloturerSession`
> (`packages/db/src/services/sessions.ts:1556`) — donc à chaque clôture réelle, pas seulement en test. `packages/db/src/depots/previsions.test.ts` porte un `describe('mesurerImpactEvenement / rapprocherPrevision — impact mesuré des événements', …)` (ligne 568) qui l'exerce. Le docblock de `mesurerImpactEvenement` lui-même date le correctif : « vérifié le 29/07/2026, zéro insert/update sur cette colonne dans tout le dépôt **avant ce lot** » — c'est-à-dire que le trou décrit par D-059 a été refermé le jour même ou le lendemain de sa rédaction, sans qu'aucune entrée de ce journal ne le consigne. Recherche faite sur tout `docs/05-DECISIONS.md` : aucune autre entrée ne mentionne `impact_mesure_bp` ou `impactMesureBp`.
>
> **Ce qui reste vrai, et qu'il ne faut pas corriger par excès de zèle** : la seconde moitié du même paragraphe — « les priors météo sont des constantes de catalogue qu'aucune observation ne vient corriger » — **tient toujours**. `packages/core/src/parametres.ts` documente encore `prevision_meteo_ensoleille_tiede_bp` et `prevision_meteo_ensoleille_frais_bp` comme « PRIOR NEUTRE ET JAMAIS MESURÉ (D-059) », à 10 000 (1,00) chacun : le découpage des catégories (l'étape 1 du choix ci-dessus) est fait, mais la boucle de mesure météo (l'étape 2, pour la météo spécifiquement) ne l'est pas — contrairement à celle des événements, qui l'est. Les deux moitiés du même défaut de fond n'ont donc pas avancé au même rythme, et c'est une information utile en soi.
>
> Aucun code à corriger ici : c'est le texte de cette décision qui décrivait un défaut depuis résolu pour sa partie « événements ».

> ### ⚠️ Correction du 01/08/2026 — la moitié « météo » est refermée à son tour, et l'encadré ci-dessus est donc lui-même périmé
>
> L'encadré du 30/07 conclut : « la boucle de mesure météo (l'étape 2, pour la météo
> spécifiquement) **ne l'est pas** ». **Ce n'est plus vrai.**
>
> Vérifié dans le code : `packages/core/src/prevision/meteo-mesuree.ts` porte
> `classerObservationsMeteo`, `mesureFacteurMeteoCategorie`, `estimerAvecMeteoMesuree` et
> `calculerFacteurMeteoMesure`. **Ce module n'est pas orphelin** :
> `apps/api/src/routes/previsions.ts` importe `calculerFacteurMeteoMesure` et l'appelle dans le
> calcul de prévision servi au porteur ; le résultat n'entre dans le chiffre **que** si
> `meteoMesure.enUsage` est vrai (c'est-à-dire après validation croisée leave-one-out, garde-fou
> exigé par le point 2 des « Conséquences » ci-dessus), et `meteoMesure.origine` est concaténée à
> l'explication affichée — ce qui satisfait l'étape 3 du « Choix » (« afficher lequel des deux est
> en usage »). Les trois étapes du choix sont donc faites, pas seulement la première.
>
> Le catalogue le dit d'ailleurs déjà lui-même : la description de
> `prevision_meteo_ensoleille_tiede_bp` (`packages/core/src/parametres.ts`) se termine par « ce
> facteur s'efface de lui-même dès qu'assez de dimanches de cette catégorie sont observés et que
> la mesure bat le prior en validation croisée leave-one-out ». Le mot « PRIOR NEUTRE ET JAMAIS
> MESURÉ » qui l'ouvre décrit la **valeur par défaut**, pas l'absence de mécanisme — c'est ce
> qui a rendu l'encadré du 30/07 plausible plus longtemps qu'il n'était vrai.
>
> **Point de méthode, payé pendant cette vérification** : ma première recherche des appelants
> de `calculerFacteurMeteoMesure` a rendu **zéro résultat de production**, et j'allais conclure
> « capacité orpheline ». La cause n'était pas un motif trop étroit — c'était un `| head -20`
> saturé par les vingt lignes du fichier de test, l'appelant réel tombant au vingt-et-unième
> rang. **D-045 sous une forme qu'il ne nomme pas : ce n'est pas seulement la liste écrite à la
> main qui ment, c'est aussi la sortie tronquée.** Un `grep | head` n'est jamais une preuve
> d'absence.
>
> Aucun code à corriger ici : les deux moitiés du défaut de fond sont refermées.

---

## D-060 — Le cœur décidé de la fiche 13 : coût kilométrique, et deux chiffres qui ne se mélangent jamais

**Date** : 29/07/2026 · **Contexte** : implémentation du cœur déjà décidé de
`docs/demandes/13-COUT-COMPLET-ET-ARBITRAGE-ENTRE-LIEUX.md`, plusieurs points restant
**[À TRANCHER]** dans cette fiche et non traités ici.

### Contexte

Le porteur a déjà tranché l'essentiel : un seul coût kilométrique tout compris (carburant, pneus,
entretien), **aucune** valorisation du temps de trajet, et une comparaison entre lieux qui
n'affiche **jamais** les charges fixes (assurance, cotisations, amortissements) — sans quoi
l'écart réel entre deux lieux (souvent quelques dizaines d'euros) disparaîtrait sous des charges
identiques partout. Restait à construire le chaînage : baseline de fréquentation → CA attendu →
coûts différentiels → marge nette attendue par lieu, et l'écran qui compare.

### Choix

1. **Le coût kilométrique vit dans le catalogue** (`cout_kilometrique_cents_par_km`,
   `packages/core/src/parametres.ts`), en **décimal** et non en entier : la valeur officielle
   (indemnité kilométrique belge, arrêté royal du 18/01/1965) est précise au centime — 0,4761 €/km
   pour la période annuelle du 01/07/2026 au 30/06/2027 (Circulaire n° 767 du 8 juin 2026, Moniteur
   belge du 16/06/2026, vérifiée via deux sources indépendantes le 29/07/2026). Un second montant,
   à révision **trimestrielle**, existe pour d'autres usages (0,4440 €/km au 01/07/2026) ; c'est
   le montant **annuel** qui est retenu, conformément à l'hypothèse de la fiche.
2. **`packages/core/src/deplacement.ts` porte plus que son nom** : coût de déplacement, coût
   d'emplacement, fiabilité d'une baseline de lieu, et la composition finale en marge nette
   attendue. C'est le seul fichier de `packages/core` accordé à ce lot (zone d'écriture exclusive,
   plusieurs autres agents travaillant en parallèle sur `core/prevision/`, `core/recettes.ts`) —
   regrouper y était la seule option qui respecte la règle n°1 (tout calcul chiffré vit dans
   `packages/core`) sans toucher aux fichiers interdits.
3. **La marge nette attendue par lieu réutilise la BASELINE neutre** (`calculerBaseline`,
   météo/événement neutralisés), **pas** la recommandation de production du moteur newsvendor.
   Comparer des lieux n'est pas prévoir une session précise à une date donnée — il n'existe ni
   relevé météo, ni contrainte de capacité connue à l'avance pour un lieu qu'on n'a pas encore
   planifié. Simplification assumée et documentée, pas une prévision recalculée.
4. **Le coût gaz est mesuré GLOBALEMENT**, tous lieux confondus (`coutGazMoyenParCrepe`,
   `packages/db/src/depots/lieux-rentabilite.ts`) : rien dans le modèle actuel ne permet de dire
   que la consommation de gaz dépend du lieu plutôt que de ce qui est cuit.
5. **Un tarif d'emplacement `metre_lineaire_mois` ne se convertit PAS automatiquement en coût par
   session.** Le convertir exigerait une hypothèse sur le nombre de sessions que ce lieu draine
   par mois — exactement le type de convention arbitraire que la fiche 13 §5.4 laisse
   **[À TRANCHER]** au porteur pour les charges fixes annuelles. Le coût d'emplacement reste `null`
   pour ce mode, avec la raison affichée, plutôt qu'une répartition devinée.
6. **`NULL` veut dire inconnu, jamais zéro, partout dans ce chaînage** — même principe que
   `mode_cloture` (D-057) et que l'horizon météo (D-058) : distance non renseignée, coût
   d'emplacement non convertible, coût gaz jamais mesuré, prix/matière non mesurables → la marge
   nette attendue du lieu est `null`, jamais un chiffre optimiste à 0 €. L'écran de comparaison
   trie les lignes à marge connue en tête ; les lignes à marge inconnue restent en fin de liste,
   quel que soit leur classement alphabétique ou leur fréquentation.

### Ce qui reste explicitement [À TRANCHER], non traité par ce lot

- Le point de départ (adresse unique vs par session) et le calcul/la saisie de la distance
  elle-même (fiche 13 §5.1–5.2) : la colonne `lieu_marche.distance_km` existait déjà, saisie à la
  main, avant ce lot.
- L'enchaînement de deux marchés le même jour, qui changerait le ×2 aller-retour (fiche 13 §5.3) :
  non modélisé, le ×2 systématique s'applique toujours.
- La répartition des charges fixes par session pour le chiffre « combien je gagne vraiment »
  (fiche 13 §5.4) : hors périmètre de ce lot, qui ne construit QUE le chiffre différentiel « quel
  marché faire ».
- La voie B du coût kilométrique (frais réels mesurés et recalculés, fiche 13 §3.1) : la clé de
  catalogue est conçue pour être remplacée par cette mesure plus tard, mais rien ne la calcule
  encore — conformément à l'hypothèse de rédaction de la fiche elle-même.

### Conséquences

1. `packages/core/src/index.ts`, `packages/core/src/contrats/index.ts`, `packages/db/src/index.ts`,
   `apps/api/src/serveur.ts`, `apps/web/src/App.tsx` et `apps/web/src/composants/Navigation.tsx`
   restent à câbler (fichiers interdits à cet agent) : voir le rapport de livraison pour les lignes
   exactes à ajouter.
2. Les colonnes `distance_km`, `facturation_electricite` et `puissance_disponible_w` de
   `lieu_marche` sont désormais saisissables depuis l'écran « Lieux de marché », pas seulement
   posées en base.

> ### ⚠️ Correction du 01/08/2026 — un des quatre points « [À TRANCHER] » ci-dessus est en réalité construit
>
> Le dernier point de la liste — « **la voie B du coût kilométrique** (frais réels mesurés et
> recalculés, fiche 13 §3.1) : la clé de catalogue est conçue pour être remplacée par cette
> mesure plus tard, mais **rien ne la calcule encore** » — **est faux aujourd'hui**.
> `mesureCoutVehicule` (`packages/db/src/depots/lieux-rentabilite.ts`) calcule ce coût observé,
> calibré sur les pleins, avec sa clé de plancher `cout_kilometrique_mesure_pleins_minimum`.
>
> D-064 le dit déjà, en toutes lettres et dès le 30/07 : « le §3.1 de la fiche était déjà réglé
> sans décision — **les deux sont construits** ». La contradiction entre les deux entrées n'a
> simplement jamais été reportée ici, et c'est la moitié la plus ancienne qu'on lit en premier.
>
> **Les trois autres points de la liste restent ouverts et le sont réellement** : le point de
> départ (traité depuis par D-072, donc à retirer aussi de cette liste), l'enchaînement de deux
> marchés le même jour (le `×2` systématique s'applique toujours), et la répartition des charges
> fixes par session — celle-ci attend le porteur, pas un agent (voir D-064 point 5).

**Mise à jour du 30/07/2026, vérifiée dans le code.** Le câblage du point 1 est terminé : `packages/core/src/index.ts:13` exporte `deplacement.js`, `packages/core/src/contrats/index.ts` exporte `lieux.js` (qui porte le contrat `schemaListeComparaisonLieux`, la comparaison de lieux vit dans ce fichier plutôt que dans un `deplacement.ts` séparé — un contrat par groupe de routes, pas par module `core`), `packages/db/src/index.ts` exporte le dépôt `lieux-rentabilite.js`, `apps/api/src/serveur.ts` enregistre `routesLieuxRentabilite`, et `apps/web/src/App.tsx` / `Navigation.tsx` exposent la page « Comparaison des lieux » (`/comparaison-lieux`). Les points **[À TRANCHER]** listés plus haut (point de départ, double marché le même jour, répartition des charges fixes, voie B du coût kilométrique) restent, eux, non traités.

---

## D-061 — La nature de produit `menu` n'atteint jamais `totaliserVentes` : elle est explosée avant

**Date** : 30/07/2026 · **Contexte** : audit du 30/07/2026 sur la fiche 16 §2 (menus, migration 0023),
consigné dans le code mais jamais dans ce journal

### Contexte

`produit_vente.nature` porte depuis la migration 0023 une troisième valeur, `'menu'` :
`schemaNatureProduit` (`packages/core/src/contrats/referentiel.ts:197`) est
`z.enum(['transforme', 'revendu', 'menu'])`, et son type dérivé `NatureProduitVente`
(`referentiel.ts:206`) est le type COMPLET, conteneur de menu compris.

`NatureProduit` (`packages/core/src/sessions.ts:38`) — celui de `LigneVente` (`sessions.ts:40-49`)
et de `totaliserVentes` (`sessions.ts:137-163`), qui alimente directement `caTransformeCents` /
`caRevenduCents` et donc les compteurs de seuils légaux (franchise TVA, Airbag, SCE) — reste lui
**volontairement limité à deux valeurs** : `'transforme' | 'revendu'`. Ce n'est pas un oubli : c'est
documenté explicitement en tête de `sessions.ts` comme une divergence délibérée avec
`NatureProduitVente`.

Le premier symptôme concret de cette divergence a été trouvé et corrigé le 30/07/2026 (« Trou 1 » du
code, `packages/core/src/contrats/sessions.ts:19-37`) : `schemaProduitVendable`, trop étroit,
utilisait par erreur `NatureProduit` au lieu de `NatureProduitVente` — `GET /api/produits-vendables`
levait alors une erreur Zod dès qu'un menu actif existait, rendant l'écran de clôture inutilisable.

### Options

- **A — élargir `NatureProduit` à trois valeurs**, pour que `LigneVente.nature` accepte `'menu'`
  directement. Le plus direct à écrire.
- **B — garder `NatureProduit` à deux valeurs** et exploser toute vente de menu en une ligne par
  composant, chacune portant la VRAIE nature de son composant, avant qu'elle n'atteigne
  `totaliserVentes`.

### Choix

**B.** L'option A ferait tomber une ligne de menu non explosée dans le `else` de `totaliserVentes`
(`sessions.ts:148-149` : tout ce qui n'est pas `'transforme'` rejoint `caRevenduCents`) — un menu
contenant des crêpes ET un pot de sirop revendu se compterait donc **entièrement en « revendu »**,
faussant silencieusement le compteur de franchise TVA (CLAUDE.md §6 : la revente génère ~2,6 fois
plus de CA que la crêpe à marge égale, donc gonfler `caRevenduCents` à tort surestime le CA total
dans les mêmes proportions).

`packages/db/src/services/sessions.ts` implémente B : `cloturerSession` détecte
`produit.nature === 'menu'` (`sessions.ts:657`) et appelle `exploserLigneMenu`
(`sessions.ts:501-564`) à la place d'ajouter la ligne telle quelle. Celle-ci :

1. lit la composition active du menu (`listerCompositionMenu`, `sessions.ts:509`) ;
2. ventile le prix RÉELLEMENT PRATIQUÉ ce jour-là (`vente.prixUnitaireCents`, jamais le prix
   catalogue du menu) sur les composants via `ventilerMenu` (`sessions.ts:530`) — une session close
   est une pièce comptable figée, un tarif de menu modifié ensuite ne doit jamais réécrire une
   clôture passée ;
3. explose le résultat en lignes de vente via `exploserVenteMenuEnLignesVente`
   (`packages/core/src/menus.ts:363-377`), chaque ligne portant la nature RÉELLE de son composant
   (`transforme` ou `revendu`, jamais `menu`).

### Conséquences

1. `totaliserVentes` ne voit jamais `nature === 'menu'` : le type `NatureProduit` à deux valeurs
   reste un invariant vérifiable par le compilateur, pas seulement par convention.
2. Les deux types divergent PAR CONSTRUCTION et ne doivent pas être fusionnés : `NatureProduitVente`
   sert à tout ce qui affiche ou vend un produit (catalogue, écran de clôture avant saisie),
   `NatureProduit` sert à tout ce qui compte un chiffre d'affaires après explosion.
3. Un menu se vend TOUJOURS en un bloc (jamais mi-sur-place mi-emporté, fiche 16 §2) : c'est le
   drapeau `consommationSurPlace` du CONTENEUR qui s'applique à tous ses composants explosés
   (`sessions.ts:539`), jamais un drapeau par composant.
4. Aucun composant désigné n'est pris en compte à la clôture (fiche 16 §2.2) : le prorata se fait
   sur tous les composants du prix pratiqué, faute d'un réglage persisté (voir `depots/menus.ts`).

---

## D-062 — Un menu vendu sort ses composants du stock, en FEFO, comme une vente directe

**Date** : 30/07/2026 · **Contexte** : audit du 30/07/2026, « Trou 2 » (code), jamais consigné ici

### Contexte

Avant ce correctif, les trois fonctions de sortie de stock à la clôture — `sortirLesProduitsRevendus`
(`packages/db/src/services/sessions.ts:1111`), `sortirLesGarnitures`
(`packages/db/src/services/garnitures.ts`) et `sortirLesComposantsVente`
(`packages/db/src/services/nomenclature-vente.ts`) — recevaient `entree.ventes` **brut**, c'est-à-dire
la ligne du menu-conteneur lui-même. Un composant REVENDU d'un menu (un pot de sirop inclus dans une
formule) n'était donc **jamais décompté du stock**, ni ses garnitures : la vente existait en CA, la
sortie de matière n'existait pas.

### Choix

`exploserLigneMenu` (`packages/db/src/services/sessions.ts:501-564`) renvoie désormais **deux**
choses distinctes, jamais confondues :

- `lignesVente` : la ventilation du CA (quantité figée à 1, montant déjà multiplié) — sert
  `totaliserVentes` (D-061) ;
- `composantsConsommes` : la **quantité PHYSIQUE** de chaque composant réellement consommée par
  cette vente de menu (`vente.quantite` menus × quantité du composant dans la composition), calculée
  par `exploserVentesMenusEnQuantitesComposants` (`packages/core/src/menus.ts:312-329`) — une
  fonction PURE, distincte de `exploserVenteMenuEnLignesVente`, qui ne partage aucun prix.

`cloturerSession` collecte ces quantités dans `composantsMenusPourStock`
(`sessions.ts:650-666`), traité **menu par menu** (jamais collationné à travers plusieurs menus
différents, pour ne pas mélanger deux drapeaux `consommationSurPlace` distincts si deux menus
partagent un même composant), puis les ajoute aux ventes non-menu avant d'appeler les trois
fonctions de sortie de stock (`sessions.ts:825-891`) : `sortirLesProduitsRevendus` (:844),
`sortirLesGarnitures` (:868), `sortirLesComposantsVente` (:885). Les trois consomment donc
désormais les LOTS RÉELS en FEFO (`repartirFefo`) pour un composant de menu exactement comme pour
une vente directe du même produit.

Les composants qui ne sont **jamais vendus seuls** sur la session (le sirop d'un menu, sans être
aussi en rayon à côté) ne figurent pas dans `parId` : `sessions.ts:685-695` va les résoudre
explicitement, pour que `sortirLesProduitsRevendus` dispose de leur ligne complète (nature,
ingrédient).

### Conséquences

1. **L'ordre des trois sorties est délibéré et documenté** (`sessions.ts:852-891`) : revendus
   d'abord (un DÉCOMPTE exact), puis garnitures (une quantité exacte par unité vendue), puis
   composants de nomenclature de vente (un RATIO agrégé, l'estimation la moins exacte) — la FEFO doit
   servir d'abord ce qui est certain.
2. Le coût matière d'une session avec menus (garnitures + composants inclus dans un menu) est
   désormais réel, lot par lot, au lieu d'ignorer silencieusement la matière consommée via un menu.
3. Cette correction ne touche que la CLÔTURE (`cloturerSession`) : l'écran de simulation d'un menu
   (`calculerVentilationMenu`, `depots/menus.ts`, prix catalogue) n'en a pas besoin et n'est pas
   concerné.

---

## D-063 — Le verrou de période s'applique à la clôture de session, comme aux sept autres écritures datées

**Date** : 30/07/2026 · **Contexte** : `docs/17-VINGT-AMELIORATIONS.md` §7.3 et `docs/20-ETAT-DES-LIEUX.md`
§4 affirmaient tous deux que le statut `periode.statut = 'verrouillee'` n'était appliqué par aucun
code — vérification faite le 30/07/2026, l'affirmation est aujourd'hui erronée pour le CONTRÔLE
(voir la nuance en conséquence 3)

### Contexte

`docs/07-DOCTRINE-ERP-ET-DESIGN.md` §1.6 pose trois états pour une période comptable :
`ouverte` → `cloturee` → `verrouillee`, ce dernier réservé à un exercice définitivement transmis au
comptable, au-delà du délai de correction usuel. Une session de marché close est l'écriture qui porte
l'essentiel du chiffre d'affaires d'un exercice : elle ne doit pas pouvoir échapper à ce garde-fou
alors que les autres écritures datées y sont déjà soumises.

### Choix

`verifierPeriodeNonVerrouillee` (`packages/db/src/depots/comptabilite.ts:765-783`) lève une erreur
métier `periode_verrouillee` si la période (année/mois) de la date d'écriture est verrouillée. Elle
est appelée, AVANT toute autre règle métier de clôture, à **huit points d'écriture datée** :

| Point d'écriture        | Fichier :ligne                                       |
| ----------------------- | ---------------------------------------------------- |
| Dépense                 | `packages/db/src/depots/comptabilite.ts:192`         |
| Contre-écriture         | `packages/db/src/depots/comptabilite.ts:303`         |
| Immobilisation          | `packages/db/src/depots/comptabilite.ts:470`         |
| Mouvement de stock (×3) | `packages/db/src/services/mouvements.ts:87,210,413`  |
| Réception               | `packages/db/src/services/reception.ts:107`          |
| Production (×3)         | `packages/db/src/services/production.ts:168,449,729` |
| **Session (clôture)**   | `packages/db/src/services/sessions.ts:606`           |

Dans `cloturerSession`, l'appel se fait sur `session.dateSession` (le jour civil de la session, pas
la date du jour) et avant toute autre vérification — une session datée dans un exercice déjà
transmis au comptable ne doit plus pouvoir changer après coup, y compris par correction.

### Conséquences

1. Chacun des huit points est testé positivement (une écriture datée dans une période verrouillée
   est refusée) et négativement (une période seulement `cloturee`, elle, reste modifiable) :
   `comptabilite.test.ts:365-491`, `mouvements.test.ts:93-171`, `production.test.ts:1176-1256`,
   `reception.test.ts:67-116`, `sessions.test.ts:1344-1360`.
2. **`docs/17-VINGT-AMELIORATIONS.md` §7.3 est corrigé par cette entrée** (voir le journal vivant
   §2.1) : l'affirmation « le statut `verrouillee` n'est écrit par aucun code » restait, elle,
   partiellement vraie et méritait d'être distinguée du contrôle — voir le point 3.
3. **Nuance qui reste vraie et qu'il ne faut pas effacer en corrigeant le point 2** : aucun chemin de
   production n'écrit aujourd'hui le statut `verrouillee` lui-même. `cloturerPeriode`
   (`comptabilite.ts:791-876`) n'écrit que `'cloturee'`, et `rouvrirPeriode` (`comptabilite.ts:886-926`)
   ramène à `'ouverte'` en refusant sur `'verrouillee'` (`:908-913`) — seules ces deux fonctions sont
   exposées par `apps/api/src/routes/comptabilite.ts:208,217`. Chaque suite de tests crée la ligne
   `'verrouillee'` par un insert direct via un petit assistant de test LOCAL (`verrouillerPeriode`,
   ex. `comptabilite.test.ts:40-48`), jamais via une fonction de dépôt exportée. **Le contrôle est
   donc réel et testé ; la troisième action (« verrouiller définitivement ») qui permettrait de
   l'atteindre depuis l'application reste, elle, à construire** — décision produit non tranchée :
   voir la question ouverte en fin de rapport.

> ### ⚠️ Correction du 01/08/2026 — le point 3 ci-dessus n'est plus vrai : la troisième action EST construite
>
> La nuance du point 3 (« aucun chemin de production n'écrit aujourd'hui le statut
> `verrouillee` lui-même ») était exacte au 30/07. **Elle est fausse aujourd'hui**, vérifié
> dans le code par la dérivation que D-087 recommande précisément (« les valeurs d'énum lues
> par une garde, confrontées aux endroits qui les écrivent ») :
>
> - `verrouillerPeriode` existe comme **fonction de dépôt exportée**
>   (`packages/db/src/depots/comptabilite.ts`), et non plus seulement comme assistant local
>   de test ;
> - elle est exposée par `POST /periodes/:id/verrouiller`
>   (`apps/api/src/routes/comptabilite.ts`), délibérément **séparée** de la route de clôture ;
> - et elle est appelée depuis l'interface, dans `apps/web/src/pages/Comptabilite.tsx`.
>
> Les trois états de `docs/07` §1.6 — `ouverte` → `cloturee` → `verrouillee` — sont donc tous
> atteignables depuis l'application. **La « décision produit non tranchée » annoncée en fin de
> point 3 a été tranchée** ; ce journal ne l'avait pas enregistrée.
>
> **Second constat, favorable, relevé au même moment** : `verifierPeriodeNonVerrouillee` est
> aujourd'hui appelée en **quatorze** points d'écriture datée, contre les **huit** que liste
> le tableau ci-dessus. La règle s'est étendue, elle n'a pas reculé — le tableau est en
> retard, pas faux.
>
> **Ce que cette correction ROUVRE, et qu'un agent ne doit pas refermer seul** : D-087 a
> écarté l'idée d'avertir le porteur **avant** qu'un verrou rende une annulation impossible,
> au motif que ce serait « un signal qui ne peut jamais être vrai ». Cet argument tombe.
> Comme `contrepasserMouvement` vérifie la période sur la date **du mouvement d'origine**, un
> exercice verrouillé n'est plus corrigible du tout. L'arbitrage revient au porteur — il est
> posé ici, il n'est pas tranché.

---

## D-064 — Le déplacement se modélise comme une TOURNÉE réelle, pas comme un aller-retour

**Date** : 30/07/2026. **Contexte** : les cinq points à trancher de
`docs/demandes/13-COUT-COMPLET-ET-ARBITRAGE-ENTRE-LIEUX.md`, tranchés en séance avec le porteur.

### Le déplacement d'une session n'est pas un aller-retour

C'est la décision structurante, et elle vient d'une correction du porteur. La fiche posait la
question « le coût compte-t-il 2 × la distance ? » ; sa réponse a été :

> « Ça dépend, tu dois laisser libre ce champ afin que je puisse par exemple aller du marché à un
> autre marché ou chez des fournisseurs. »

Un trajet réel est donc : domicile → marché → éventuellement un autre marché → éventuellement un
fournisseur → retour. **Une tournée, pas un aller-retour.** La question posée présupposait un modèle
faux, et c'est le porteur qui l'a redressée.

### Conséquence : deux grandeurs distinctes, et non une seule

| Grandeur                                | Porté par     | Sert à                       | Nature     |
| --------------------------------------- | ------------- | ---------------------------- | ---------- |
| Distance de référence, **aller simple** | `lieu_marche` | Arbitrer **avant** d'y aller | Estimation |
| Kilomètres **réellement parcourus**     | la session    | Le coût réel **après**       | Mesure     |

C'est exactement le couple théorique/réel que le projet applique déjà à la matière
(`cout_matiere_theorique_cents` contre `cout_matiere_reel_cents`, D-038) : on ne peut pas connaître
les kilomètres réels d'une session qui n'a pas eu lieu, et on ne veut pas arbitrer sur une mesure
qu'on n'a pas encore. Les deux coexistent parce qu'elles répondent à deux questions différentes.

### Les cinq points, tranchés

1. **Point de départ** — une adresse de domicile en paramètre sert de défaut, **surchargeable par
   session**. Le cas courant ne demande aucune saisie, le cas particulier reste possible.
2. **Distance** — ⚠️ **CE POINT EST ANNULÉ ET REMPLACÉ PAR [D-065](#d-065). Ne pas l'appliquer.**
   Il est conservé ici parce qu'il documente une décision réellement prise, puis revue par le porteur
   une heure plus tard dans la même séance — l'effacer masquerait le fait que la question a été posée
   deux fois. Un agent a d'ailleurs travaillé sur la foi de ce point avant de lire D-065 : c'est
   précisément pourquoi l'avertissement est ici et pas seulement là-bas.

   Le texte d'origine : **saisie à la main**, d'après Google Maps ou Plans, sans aucun
   pré-remplissage à vol d'oiseau. Le porteur avait été explicite : « je dois introduire manuellement
   la distance selon google maps ou plans ». Un pré-remplissage à vol d'oiseau aurait été **pire que
   rien** : la fiche elle-même chiffre l'écart routier à 20-40 %, et un chiffre suggéré est un chiffre
   qu'on valide par inadvertance. La distance inconnue reste `null`, jamais `0` (déjà en place) — **ce
   dernier point, lui, reste vrai et vaut toujours.**

3. **Aller-retour** — **pas d'interrupteur**. Le champ des kilomètres de session est libre, et
   **pré-rempli à 2 × la distance de référence du lieu**. Zéro frappe dans le cas normal, liberté
   totale dès qu'il y a un détour. Le pré-remplissage est ici légitime, contrairement au point 2 :
   il dérive d'un chiffre que le porteur a lui-même saisi, pas d'une estimation calculée.
4. **Trajet mixte** — **la session porte son propre aller-retour, le détour porte le reste.** La
   session est chargée de ce qu'elle aurait coûté seule (2 × la distance de référence) ; les
   kilomètres au-delà sont attribués aux achats. Ce n'est pas une clé de répartition arbitraire : les
   kilomètres en trop sont **réellement causés** par le détour. Sans cette règle, un passage chez le
   meunier dégraderait la marge du marché et pourrait inverser l'arbitrage entre deux lieux —
   précisément ce que la fiche 13 existe pour éviter.
5. **Frais fixes** — **au niveau de l'exercice annuel seulement.** Le porteur a répondu « je ne sais
   pas dire ici, on doit prendre la logique comptable », et la logique comptable a une réponse : une
   assurance et un amortissement sont des **charges de la période**, rattachées à l'exercice. Les
   répartir par session serait un choix de **gestion**, pas une règle comptable — et pour comparer
   deux lieux, ces frais sont identiques des deux côtés : ils s'annulent (D-060). À confirmer par le
   comptable, mais rien n'attend cette confirmation pour être juste.

### Le §3.1 de la fiche était déjà réglé sans décision

La fiche demandait de choisir entre un forfait au kilomètre et des frais réels recalculés. **Les deux
sont construits** : `cout_kilometrique_cents_par_km` (indemnité kilométrique belge officielle,
sourcée et datée) et un coût observé calibré sur les pleins (`mesureCoutVehicule`,
`cout_kilometrique_mesure_pleins_minimum`). C'est l'application de la consigne permanente du porteur :
quand deux options sont complémentaires et non contradictoires, on fait les deux.

### Ce que cela reste à construire

Le point 1 (surcharge du point de départ par session), le point 3 (champ de kilomètres réels sur la
session, pré-rempli) et le point 4 (imputation du surplus aux achats) demandent des colonnes qui
n'existent pas encore. Aucun n'est codé au moment où cette décision est écrite.

> ### ⚠️ Mise à jour du 01/08/2026 — les trois sont codés depuis
>
> La phrase ci-dessus est datée (« au moment où cette décision est écrite ») et reste donc
> exacte pour le 30/07. Elle est en revanche **trompeuse pour qui la lit aujourd'hui**, faute
> de suite. Vérifié dans le code :
>
> | Point de D-064                           | Ce qui existe aujourd'hui                                                                                                                                                                            |
> | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | **1** — point de départ surchargeable    | `session_marche.point_depart_texte` (migration 0026) + `packages/core/src/point-depart.ts` — mis en œuvre par **D-072**                                                                              |
> | **3** — km réels de session, pré-remplis | `session_marche.distance_reelle_km` déclarée en **`real`** ; `apps/web/src/pages/Sessions.tsx` pré-remplit à `distance × 2`                                                                          |
> | **4** — imputation du surplus aux achats | `imputationTourneeDeplacement` (`packages/core/src/deplacement.ts`) appelée dans `cloturerSession` — figée à la clôture par **D-067**, sur trois colonnes `cout_deplacement_reel_*` (migration 0027) |
>
> Autrement dit : ce qui restait « à construire » ici a été construit par D-067 et D-072, qui
> le disent chacune de leur côté sans que cette entrée l'apprenne. **Les points encore ouverts
> de la fiche 13 ne sont pas ceux-là** — ce sont ceux listés en D-060 (« Ce qui reste
> explicitement [À TRANCHER] ») moins la voie B, elle aussi construite : voir la correction
> portée sur D-060.

---

## D-065 — La distance d'un lieu est CALCULÉE une fois, vérifiée par le porteur, et jamais réécrite

**Date** : 30/07/2026, en séance. **Révise le point 2 de D-064.**

### Le porteur s'est corrigé, et la correction élargit la règle

D-064 point 2 actait une **saisie manuelle** de la distance, d'après Google Maps, explicitement sans
pré-remplissage. Une heure plus tard, dans la même séance :

> « Ici l'application doit pouvoir calculer automatiquement les km sans mon intervention ; je dois
> être là pour vérifier, mais le modèle est d'avoir le plus de choses automatiques. »

Ce n'est pas seulement un revirement sur un champ : c'est un **principe de conception** énoncé pour
tout le produit — le maximum d'automatique, le porteur en position de contrôle et non de saisie.
D-064 point 2 est donc annulé et remplacé par la présente entrée.

### Ce qui a été vérifié avant de s'engager, et ce qui ne l'a pas été

Une distance **routière** ne se déduit pas de coordonnées : le vol d'oiseau s'en écarte de 20 à 40 %
(chiffre de la fiche 13 elle-même), assez pour **inverser un arbitrage entre deux lieux**. Il faut
donc un service extérieur, ce que `CLAUDE.md` §7 interdit d'introduire sans accord explicite.

**Vérifié le 30/07/2026** sur le palier gratuit d'OpenRouteService : 2 500 requêtes/jour,
40 000/mois, géocodage et itinéraires inclus ; résultats sous **CC-BY 4.0**, donc **attribution
OpenStreetMap obligatoire** partout où une distance est affichée.

**Non vérifié, et laissé au porteur** : les conditions d'utilisation elles-mêmes n'ont pas pu être
lues (page rendue en JavaScript). Des sources tierces suggèrent que le palier gratuit vise les
projets personnels, la recherche et les phases initiales d'un projet commercial — or l'activité du
porteur est commerciale. **C'est une question juridique, pas technique** : elle lui a été signalée
telle quelle, il la tranchera à l'inscription. Le code n'en dépend pas (voir ci-dessous).

### Le point de conception qui désamorce l'enjeu : un appel par lieu, une fois

Le besoin n'est pas « un appel par affichage » mais **un appel par lieu, une fois dans sa vie**. Une
trentaine de lieux, c'est une trentaine d'appels **au total** — quatre ordres de grandeur sous le
palier gratuit. La distance est calculée à la création ou à la modification du lieu, **stockée** dans
`lieu_marche.distance_km`, puis vérifiée par le porteur.

D'où trois propriétés qui rendent cette dépendance acceptable là où un appel par affichage ne
l'aurait pas été :

1. **Aucune dépendance structurelle.** Service fermé, conditions changées, réseau coupé : rien ne
   casse, les distances sont déjà en base. La dépendance est **passagère, pas installée**.
2. **Coût récurrent nul**, donc l'objectif « 0 €/mois d'infrastructure » (§2) tient.
3. **Mode dégradé complet**, même exigence que pour Claude (§5) : sans clé, clé invalide, hors quota,
   sans réseau ou adresse introuvable → la saisie manuelle reste disponible et la distance vaut
   `null` **avec une raison nommée et affichable**, jamais `0`. Un `0` ferait croire à un lieu sans
   déplacement, donc gratuit en carburant et en usure.

### La vérification humaine gagne toujours

Le porteur n'a pas répondu à la question posée sur ce point ; la voie recommandée a donc été retenue
et lui a été annoncée : **sa correction gagne, elle est conservée telle quelle, et aucun recalcul ne
la réécrit jamais.** Un chiffre qu'on sait faux et qu'on ne peut pas corriger détruit la confiance
dans l'écran entier — et lui a vu la route, l'algorithme non.

Cela impose de distinguer en base une valeur **calculée** d'une valeur **corrigée à la main**.

### Ce qui reste ouvert

- La colonne ou le drapeau qui porte cette distinction n'existe pas encore : demandé à l'agent, à
  migrer ensuite (zone exclusive de l'orchestrateur).
- La clé `OPENROUTESERVICE_API_KEY` doit être créée par le porteur et vivre dans `.env`, jamais dans
  le dépôt (§7). Documentée dans `.env.example`.
- **Aucun appel réel au service dans les tests** : un service gratuit ne se martèle pas, et un test
  qui dépend du réseau devient rouge en avion et vert par hasard. Même règle que l'API Claude, pour
  une raison différente. À noter : deux routes de prévision violent déjà ce principe avec Open-Meteo.

---

## D-066 — Le coût d'électricité n'entre dans la marge que « au compteur » : `null` peut vouloir dire « déjà compté ailleurs », pas seulement « inconnu »

**Date** : 30/07/2026. **Contexte** : fiche `docs/demandes/17-ENERGIE-GAZ-ELECTRICITE-SOLAIRE-EMPREINTE.md`,
suite de D-055 (« l'électricité est un attribut du lieu »).

### Le piège du prix du kWh

Beaucoup d'emplacements ne facturent PAS l'électricité au compteur : elle est comprise dans le tarif
d'emplacement, ou facturée au forfait journalier. Calculer un coût en kWh dans ces deux cas
inventerait une dépense qui n'existe pas et la compterait DEUX FOIS avec le tarif d'emplacement.
`coutEnergieSessionCents` (`packages/core/src/energie.ts:181-235`) ne calcule donc un coût que pour
le mode `'compteur'`, et seulement si un prix du kWh est renseigné — jamais inventé (CLAUDE.md §7).
Pour les trois autres modes (`null` inconnu, `'aucune'`, `'forfait'`, `'comprise'`), `cents` vaut
`null`, mais avec un `raisonIndisponible` qui distingue explicitement une absence CERTAINE (le coût
existe, il est déjà ailleurs) d'une vraie INCONNUE (mode ou prix non paramétré).

### Un garde-fou de plus, que la fonction pure ne peut pas connaître elle-même

`resoudreCoutEnergieSession` (`packages/core/src/sessions.ts:126-186`) ajoute une règle que
`coutEnergieSessionCents` ne peut pas poser seule : sur un lieu facturé AU COMPTEUR, une liste
d'équipements utilisés VIDE ne veut pas dire « zéro kWh consommé » — elle peut aussi bien vouloir
dire « jamais mesuré » (cas permanent de toute session close avant l'existence de cette saisie,
fiche 17). Compter 0 sans le dire embellirait la marge en silence ; ce cas est donc traité EN
PREMIER et rend un coût EXCLU (0, mais signalé par `raisonExclusion`), jamais un coût certain.

### Décision : toujours un entier dans la marge, jamais un `null` qui s'y propage

`FraisSession.energieCents` (`packages/core/src/sessions.ts:53-74`) est TOUJOURS un entier connu,
jamais `null` : une inconnue vaut 0 par prudence (rien de plus à soustraire qu'on connaisse) plutôt
que de faire échouer tout le calcul de marge. `ResolutionCoutEnergieSession.raisonExclusion` porte
la nuance que ce seul entier ne peut pas exprimer : `null` quand le zéro est un FAIT ACQUIS (aucune
électricité sur ce lieu, ou déjà comptée dans l'emplacement/le forfait), un message quand c'est une
EXCLUSION par manque de données. Les deux valent 0 dans l'arithmétique de la marge, mais un seul des
deux mérite d'être visible à l'écran comme un manque.

### Conséquences

Testé positivement et négativement pour les cinq branches (`compteur` avec/sans prix, `aucune`,
`forfait`, `comprise`, mode inconnu) et pour le garde-fou « liste vide sur lieu au compteur » —
voir les tests de `packages/core/src/energie.test.ts` et `packages/core/src/sessions.test.ts`.

---

## D-067 — L'imputation d'une tournée est FIGÉE à la clôture, jamais recalculée — contrairement au CUMP

**Date** : 30/07/2026. **Contexte** : audit du 30/07/2026 (« Trou 2 ») — `imputationTourneeDeplacement`
(D-064 point 4, `packages/core/src/deplacement.ts:63-179`) existait, était testée, et **aucun code de
production ne l'appelait**. Branchée le même jour dans `cloturerSession`
(`packages/db/src/services/sessions.ts`, docblock au-dessus de `imputationDeplacement`, vers la
ligne 903 au 30/07/2026 — ce fichier bouge pendant que d'autres agents y écrivent en parallèle ;
se fier au commentaire « FIGEE A LA CLOTURE » recherché en texte plutôt qu'au numéro s'il a dérivé).

### Pourquoi figer plutôt que recalculer à la lecture

Règle identique à `coutMatiereReelCents` (D-038), et délibérément DIFFÉRENTE de celle du CUMP
(D-018/D-020, qui se recalcule à chaque lecture). Le test qui distingue les deux cas : le CUMP décrit
un état COURANT (le stock qui reste en rayon aujourd'hui) — le recalculer à chaque lecture donne par
construction la bonne réponse, puisque la question porte sur maintenant. L'imputation d'une tournée
décrit au contraire un FAIT PASSÉ (les kilomètres déjà roulés pour CETTE session, déjà close).

Un de ses trois intrants — `coutKilometriqueRetenu` en mode « mesuré »
(`mesureCoutVehicule`, `packages/db/src/depots/lieux-rentabilite.ts`) — est une MOYENNE GLOBALE qui
grossit à chaque nouvelle dépense de carburant ou chaque nouvelle session close, **sans date de
validité**, contrairement à `lireParametres`. Le recalculer à la lecture ferait donc DÉRIVER, à
chaque donnée future, le partage session/achats d'une session close des mois plus tôt : exactement
la pièce comptable « qui se réécrit toute seule » que l'en-tête de `services/sessions.ts` interdit,
et que D-038 a déjà corrigée une fois pour le coût matière.

### Décision

L'imputation est calculée UNE SEULE FOIS, à la clôture, avec les paramètres et le taux kilométrique
EN VIGUEUR à la date de la session, puis STOCKÉE sur trois colonnes entières nullable de
`session_marche` (migration 0027) : `cout_deplacement_reel_session_cents`,
`cout_deplacement_reel_detour_achats_cents`, `cout_deplacement_reel_total_cents` — même patron que
`coutMatiereTheoriqueCents`/`coutMatiereReelCents`. Écrites dans le MÊME `.set({...})` que le reste
de la clôture (`packages/db/src/services/sessions.ts:1328-1330` au 30/07/2026, ligne susceptible
d'avoir dérivé depuis — chercher `coutDeplacementReelSessionCents:` dans le `.set({...})` de
`cloturerSession`), jamais en deux écritures
séparables. Exposées à la fois en miroir de commodité sur `ResultatCloture.imputationDeplacement`
et sur `schemaSessionDetail` (rejouables sur un `GET` ultérieur).

### Ce qui reste volontairement non automatisé

La part ACHATS (`coutDetourAchatsCents`) n'est PAS auto-enregistrée en `depense` : le rattachement
à une catégorie (carburant, ou frais de réception d'un fournisseur visité pendant le détour) dépend
d'un fait que seul le porteur connaît (un second marché n'appelle aucune dépense supplémentaire, un
détour chez un fournisseur si). L'écrire automatiquement compterait deux fois le même plein réel et
ferait dériver le taux mesuré à la hausse sans borne — CLAUDE.md §9, « en cas d'ambiguïté, poser la
question, ne pas deviner ».

---

## D-068 — La météo prévue d'une session figée à la clôture est celle de J-1, pas la dernière connue

**Date** : 30/07/2026. **Contexte** : audit du 30/07/2026 (« mission météo prévue et réelle d'une
session ») — `session_marche.meteo_prevue` / `meteo_reelle` (colonnes JSON) n'étaient jusque-là ni
écrites ni lues.

### La question posée, et pourquoi elle a une réponse métier

« Quand figer `meteoPrevue` : au moment de la production de la pâte (la veille, quand la décision de
produire est prise) ou à l'ouverture de la session ? » La zone d'écriture de l'agent qui a répondu ne
couvrait pas `services/production.ts` : il n'existe donc aucun point d'écriture littéralement « au
moment de la décision ». Mais la question a une réponse métier : **c'est la prévision sur laquelle on
a décidé qui compte, pas la dernière connue.**

### Ce qui rend cette réponse applicable sans nouveau code de collecte

Depuis D-058, `meteo_observation` conserve TOUTES les révisions par horizon (J-7, J-3, J-1, matin
même) au lieu d'écraser les précédentes. La prévision qui existait la veille (horizon >= 1 jour)
reste donc lisible, à la clôture, EXACTEMENT telle qu'elle était alors — ce n'est pas un passé
reconstitué, c'est la lecture d'un fait déjà enregistré, choisi pour répondre à la bonne question
plutôt qu'à la plus récente (`packages/db/src/services/sessions.ts:1043-1101` au 30/07/2026, même
réserve de dérive que ci-dessus — chercher le commentaire « Météo FIGÉE à la clôture »).

### Décision

`horizonJours >= 1` exclut délibérément un relevé `type = 'prevision'` avec `horizon_jours = 0` (une
récupération le matin même) — exactement la « dernière connue à l'ouverture » que la question
écarte. Le PLUS PETIT horizon disponible au-dessus de 0 est retenu (`orderBy(asc(horizonJours))` +
premier résultat) : au plus proche de J-1 quand cette révision existe, ou la révision la moins
ancienne encore antérieure au jour même si J-1 a été manquée. `meteoReelle`, elle, ne peut être
connue qu'APRÈS la session (`type = 'reelle'`, horizon 0 par construction) — la clôture est donc, de
toute façon, le plus tôt où elle peut exister. Les deux restent `null` si aucun relevé exploitable
n'existe pour ce lieu et cette date, jamais une valeur inventée.

### Conséquences

Sans rapport avec le moteur de prévision lui-même : le prédicteur « écart météo prévue/réalisée »
(`packages/core/src/prevision/ecart-meteo-prevue-realisee.ts`) lit `meteo_observation` directement
par (lieu, date), sans passer par ces colonnes ni par un lien vers la session. `meteo_prevue` /
`meteo_reelle` ne servent que l'affichage et l'audit d'UNE session : « qu'annonçait-on ce jour-là,
qu'a-t-il fait vraiment ? ».

---

## D-069 — Une pièce jointe (bon de livraison, facture scannée) est stockée DANS la ligne, pas sur le disque

**Date** : 30/07/2026. **Contexte** : mission « trois chemins de pièce jointe jamais utilisés » —
`reception.fichier_scan_path` était une colonne migrée depuis le Lot 7, jamais écrite qu'à `null`.

### Trois voies envisagées, deux rejetées pour la MÊME raison

1. Un vrai CHEMIN vers un fichier du disque, ce que le nom de la colonne suggère. **Rejeté** :
   `packages/db/src/sauvegarde.ts` sauvegarde la base par `VACUUM INTO` (vérifié à la lecture de ce
   fichier, pas supposé) — jamais un dossier annexe. Un chemin disque resterait donc HORS de chaque
   sauvegarde quotidienne : le porteur croirait avoir tout sauvegardé et perdrait ses justificatifs
   au premier disque changé.
2. Une COPIE dans un dossier géré par l'application, à côté de `donnees/batte.sqlite`. **Rejeté**
   pour la MÊME raison : `sauvegarder()` ne connaît que le fichier `.sqlite` lui-même, aucun
   mécanisme existant ne copie un dossier annexe.
3. Stocker la pièce DANS la ligne elle-même. **Retenu** : c'est la seule des trois voies protégée
   par le mécanisme de sauvegarde qui existe RÉELLEMENT aujourd'hui, sans y toucher — `VACUUM INTO`
   copie le contenu de chaque ligne, pièce jointe comprise.

### Décision

`fichier_scan_path` reste une colonne TEXTE (le schéma n'était pas modifiable par cette mission) :
la pièce est encodée en Data URI (RFC 2397, `data:<mime>;base64,<...>`) plutôt qu'en BLOB — un URI
valide au sens du navigateur, donc le nom de la colonne reste défendable même si son contenu vit
désormais dans la ligne plutôt que sur disque. Validée par `validerPieceJointe`
(`packages/db/src/services/factures.ts:192-216` au 30/07/2026 — fichier actif, ligne susceptible
d'avoir bougé depuis, chercher le nom de fonction ; réutilisée par `services/reception.ts:40,192` en
import relatif, même paquet) : formats acceptés JPEG/PNG/WEBP/PDF, plafond de **8 Mo** — au-delà, le
« fichier unique sauvegardable » (CLAUDE.md §2) grossirait trop. `''` / `null` / `undefined` valent
`null` (non renseigné), jamais un chemin vide traité comme une valeur.

### Renforcement constaté en RELISANT le code au moment d'écrire cette entrée : le contenu est vérifié, pas seulement le format de l'enveloppe

La regex de forme (`MOTIF_PIECE_JOINTE_DATA_URI`) ne garantit que la SYNTAXE de la Data URI, pas que
son contenu corresponde réellement au type MIME déclaré : rien n'empêchait un contenu quelconque de
circuler étiqueté `image/png`, tant que l'enveloppe était bien formée. `packages/db/src/services/
factures.ts:123-181` (`SIGNATURES_MIME`, `contenuCorrespondAuTypeDeclare`) vérifie désormais les
premiers octets DÉCODÉS contre la signature binaire attendue de chaque type (PNG, JPEG, PDF ; WEBP
à part, RIFF/WEBP n'étant pas contigus) — sans décoder l'intégralité d'une pièce jusqu'à 8 Mo pour
une simple vérification d'en-tête. Le scénario visé est nommé explicitement dans le code : pas un
attaquant distant (l'application est mono-utilisateur, CLAUDE.md), mais un fichier reçu d'un
fournisseur et joint sans y regarder, dont l'extension déclarée ne garantit rien sur le contenu réel.

### Conséquences

Voir `packages/core/src/contrats/comptabilite.ts` et §7 de `factures.ts`
(`packages/db/src/services/factures.ts:1-53`) pour les deux autres décisions de conception voisines
(prix vs quantité, rapprochement automatique vs correction explicite) prises dans la même mission.

---

## D-070 — Le refus d'ouvrir la saisie d'une date de cession d'immobilisation est désormais GARDÉ par un test, pas seulement documenté

**Date** : 30/07/2026. **Contexte** : re-vérification du point déjà signalé en **D-052**
(« `date_cession` ni écrite ni lue ») et dans `docs/16-AUDIT-COMPTABILITE.md` §5.3.

### Ce qui était déjà su, et ce qui manquait

D-052 signalait déjà que `date_cession` n'est ni écrite ni lue, parmi les questions comptables non
tranchées. Ce que cette entrée ajoute : une re-vérification directe du 30/07/2026 confirme que ni
`planAmortissement` ni `valeurNetteComptable` (`packages/core/src/comptabilite.ts`) ne regardent
cette colonne — un bien cédé continuerait de produire ses annuités déductibles jusqu'au bout du plan
si la saisie s'ouvrait aujourd'hui. Le traitement de l'année de cession (prorata jusqu'à la vente,
plus- ou moins-value de cession, sortie de la valeur nette résiduelle) est **entièrement
réglementaire** : coder « on arrête après l'année de cession » serait inventer une convention.

### Décision

Ne PAS ouvrir cette saisie tant que cette question n'a pas de réponse externe (comptable ou porteur)
— CLAUDE.md §9. `dateCession` reste absente de tout schéma d'ENTRÉE
(`packages/core/src/contrats/comptabilite.ts:106-121` documente ce choix au point exact où un futur
lecteur serait tenté de l'ajouter).

### Conséquences : un test transforme l'intention en invariant vérifié

`packages/db/src/audit-colonnes-orphelines.test.ts:816-861` (ligne au 30/07/2026 ; ce fichier bouge
pendant que d'autres agents y ajoutent des cas en parallèle — se fier au nom du test,
`immobilisation.dateCession reste VOLONTAIREMENT non saisissable`, plutôt qu'au numéro de ligne s'il
a encore dérivé) vérifie que `dateCession` n'apparaît dans
AUCUN des schémas d'entrée (`schemaCreationImmobilisation`, etc.). S'il se met à échouer, c'est
qu'une saisie a été ouverte SANS que la question réglementaire ait été tranchée — à vérifier avant de
le faire passer au vert. Une décision documentée en prose peut se faire contourner par inadvertance ;
un test qui l'encode ne le peut pas.

---

## D-071 — Un paramètre de type `texte` peut être VIDE ; le vide y signifie « non renseigné », pas une faute

**Date** : 30/07/2026. **Contexte** : `PATCH /api/parametres/:cle` (`schemaCorrectionParametre`,
`packages/core/src/contrats/parametres.ts`) portait un `.min(1)` qui refusait toute valeur vide.

### Pourquoi cette garde était fausse pour un type précis

Zod ne peut pas savoir de quel TYPE est le paramètre corrigé : il ne reçoit qu'une valeur, la clé est
dans l'URL, et c'est elle qui dit, via le catalogue, s'il s'agit d'un entier, d'un booléen ou d'un
texte libre. Or la règle correcte dépend du type : un seuil ou un taux vide est une faute
(`Number('')` vaut 0, donc un `decimal` vide passerait pour zéro), tandis qu'un `texte` vide est une
INFORMATION légitime — c'est ainsi que `adresse_depart_defaut` dit « pas encore renseignée » (D-065).
Refuser le vide partout forçait à inventer une adresse par défaut plausible, ce que ce projet
interdit : elle aurait produit des distances fausses, donc des coûts de déplacement faux, que rien
n'aurait signalés.

### Décision

Le `.min(1)` est retiré de `schemaCorrectionParametre`
(`packages/core/src/contrats/parametres.ts:38-66`) : le contrat HTTP ne porte plus aucune garde sur le
vide. La garde n'est pas perdue, elle est DÉPLACÉE là où le catalogue est connu : `verifierValeur`
(`packages/db/src/depots/parametres.ts:107-136`) refuse le vide pour tous les types SAUF `texte`, et
lève une `ErreurMetier` traduite en 422 avec un message français.

### Conséquences

Contrat correct : pour un `texte`, VIDE VEUT DIRE INCONNU, et le code qui le lit doit le traiter comme
`null`, jamais comme une chaîne utilisable — même doctrine que partout ailleurs dans ce projet
(« une valeur inconnue vaut `null`, jamais zéro »), appliquée ici à une chaîne. Dupliquer une règle
dans un endroit qui n'a pas l'information nécessaire pour l'appliquer correctement, c'est la façon
dont une règle finit par être fausse — la garde vit désormais au seul endroit qui connaît le type.

---

## D-072 — La distance ET le point de départ d'un lieu se calculent automatiquement (OpenRouteService), mais ne se RECALCULENT que si le champ est vide

**Date** : 30/07/2026. **Contexte** : met en œuvre D-065 (« la distance d'un lieu est calculée une
fois, vérifiée par le porteur ») et le point 1 de D-064 (point de départ surchargeable par session),
tous deux laissés « à construire » dans leurs entrées d'origine.

### Le point de départ : un paramètre qui devient un PRÉREQUIS

`packages/core/src/point-depart.ts` résout le point de départ EFFECTIF d'une session : celui de la
session s'il est renseigné (`session_marche.point_depart_texte`, migration 0026), sinon l'adresse de
domicile en paramètre (`adresse_depart_defaut`) — la session prime toujours sur le défaut, jamais
l'inverse. Ce fichier ne calcule aucune distance : il ne fait que dire QUEL texte de départ
s'applique, et NOMMER pourquoi aucun ne s'applique quand c'est le cas, pour que l'écran dise au
porteur quoi saisir plutôt que de lui montrer un tiret muet.

### Le calcul automatique lui-même

`apps/api/src/itineraire/client.ts` intègre OpenRouteService (clé gratuite, 2 500 requêtes/jour,
40 000/mois) avec les mêmes trois règles que le client Claude (`apps/api/src/ia/client.ts`) : la clé
ne quitte jamais le serveur ni les messages d'erreur ; mode dégradé complet (sans clé, clé invalide,
hors quota, adresse introuvable → refus MOTIVÉ, jamais une exception, jamais 0 km) ; un seul appel
par lieu, jamais à la lecture. Les résultats dérivent d'OpenStreetMap sous licence CC-BY 4.0 :
`ATTRIBUTION_OPENSTREETMAP` accompagne obligatoirement toute distance affichée — condition de
licence, pas décoration.

### La règle structurante : comment une correction manuelle survit à un recalcul SANS colonne dédiée

`distanceAvecCalculAutomatique` (`apps/api/src/routes/referentiel-ecriture.ts:127-244`) ne se
déclenche QUE quand le formulaire soumet `distanceKm: null`. Un champ NON VIDE n'est JAMAIS touché —
qu'il ait été saisi à la main ou calculé automatiquement la fois précédente ; il gagne toujours, le
service n'est même pas consulté. Un champ VIDÉ PAR LE PORTEUR (il efface la valeur puis enregistre)
redevient `null` dans CETTE requête précise, donc redéclenche légitimement une tentative : c'est le
porteur, et lui seul, qui décide qu'un nouveau calcul est bienvenu.

**C'est un choix délibéré pour COMBLER, sans elle, l'absence de la colonne de provenance
(« calculée » vs « corrigée ») que D-065 laissait ouverte** : au lieu d'une colonne
`distance_km_origine` qui resterait à migrer, le SEUL état observable — le champ est vide ou ne l'est
pas — fait tout le travail de distinction. Une valeur non vide fait toujours foi, peu importe son
origine ; c'est uniquement l'absence de valeur qui autorise un nouveau calcul.

### Conséquences

Testé pour les cinq cas (déjà connue, adresse absente, service non configuré, adresse de domicile
absente, échec du service) dans `apps/api/src/routes/referentiel-ecriture.test.ts` (autour des lignes
890-1071). La colonne de provenance dédiée reste, elle, un besoin réel si le porteur veut un jour
savoir SANS relire l'écran si une distance affichée a été vérifiée ou seulement suggérée — ce
mécanisme la rend inutile pour protéger une correction manuelle, pas pour l'afficher comme telle.

---

## D-073 — Un cinquième poste de décaissement (frais de réception) manquait à la synthèse annuelle d'exercice, et deux nouveaux risques de double comptage sont signalés sans être corrigés

**Date** : 30/07/2026. **Contexte** : audit du 30/07/2026 sur `syntheseExercice`
(`packages/db/src/depots/comptabilite.ts:1243`), qui définit la « charge déductible de l'exercice »
en comptabilité GÉNÉRALE (docs/14 §G2).

### Le trou trouvé

`frais_reception` (transport, palette…) est écrite par `enregistrerFacture`
(`packages/db/src/services/factures.ts`) à chaque ligne de facture rattachée à une réception sans
ingrédient, puis ventilée IMMÉDIATEMENT sur `lot.prixLigneCents` — mais la table elle-même n'était
relue NULLE PART, ni dépôt ni route. C'est un DÉCAISSEMENT réel, distinct de la valeur des
marchandises : `reception.montantTotalCents` (déjà comptée) est figé au moment de la réception et
n'est jamais mis à jour quand la facture arrive ensuite avec ses frais de transport. Sans relecture,
ce transport n'apparaissait dans AUCUNE charge de l'exercice — ni les achats de marchandises, ni les
dépenses saisies. C'est la CINQUIÈME population de ce genre découverte dans cette fonction (après
`depense`, les achats de marchandises, les frais de session, la commission carte), toutes de même
famille : un décaissement réel invisible de la synthèse tant qu'il n'est pas relu.

### Décision

`totalFraisReceptionCents` (`packages/db/src/depots/comptabilite.ts:1022-1069`) lit `frais_reception`
joint à `reception` pour dater le frais (la table ne porte aucune colonne de date propre), aux MÊMES
bornes et même filtre `statut = 'active'` que les achats de marchandises. `syntheseExercice`
(`:1085-1130`) l'ajoute comme cinquième composant des charges déductibles.

### Deux risques de double comptage signalés, volontairement NON corrigés

Un audit qui ferme un trou en ouvre parfois un autre, visible seulement une fois le premier fermé :

1. **Le gaz existe deux fois dans le modèle** (`packages/db/src/depots/comptabilite.ts:1195-1224`) :
   comme catégorie d'ingrédient acheté en bouteille (déjà compté dans les achats de marchandises) et
   comme frais de session forfaitaire (`frais_gaz_cents`, déjà compté aussi). Si les deux
   représentent la même bouteille, ce montant est compté deux fois — mais rien ne relie
   techniquement les deux, donc rien ne peut le détecter, seulement le signaler.
2. **Le même trajet peut désormais apparaître une troisième fois** (`:1226-1241`) : une fois en
   `depense` catégorie carburant (si le porteur va chercher la marchandise), une fois dans
   `frais_deplacement_cents`/`frais_gaz_cents` de session, et maintenant une troisième fois en
   `frais_reception` si c'est le FOURNISSEUR qui facture le transport. Aucune clé technique ne relie
   ces trois écritures.

**Décision de conduite** : ne PAS retirer ces catégories ni ces colonnes — un déplacement réel
distinct resterait alors invisible, ce qui serait pire — mais avertir au point de saisie
(`apps/web/src/pages/Comptabilite.tsx`) et le prouver par un test qui démontre l'absence de
protection plutôt que de prétendre qu'elle existe (`depots/comptabilite.test.ts`, « ne protège PAS
contre le double comptage du gaz »). Question réservée au porteur, à ajouter à D-052.

---

## D-074 — La distance d'un lieu reste en kilomètres ENTIERS, alors qu'elle ne devrait plus l'être : constat posé, changement de type délibérément différé

**Date** : 30/07/2026 · **Statut** : ~~constat acté, correctif NON appliqué~~ →
**appliquée le 31/07/2026, mais PAR L'OPTION 1, que cette entrée avait écartée**
(corrigé le 01/08/2026 — voir l'encadré ci-dessous)

> ### ⚠️ Correction de statut du 01/08/2026 — le correctif est appliqué, et le choix a été INVERSÉ sans que ce journal le dise
>
> Trois faits vérifiés dans le code, pas supposés :
>
> 1. **L'arrondi à la source est corrigé.** `apps/api/src/itineraire/client.ts` fait
>    désormais `Math.round(metres / METRES_PAR_DIXIEME_KM) / 10` — au **dixième de
>    kilomètre** (100 m), plus au kilomètre entier. C'est exactement le correctif que le
>    « Complément du 30/07 » ci-dessous désignait comme le seul qui compte
>    (« l'arrondi n'est PAS dans la colonne, il est en amont »).
> 2. **La validation accepte les décimales.**
>    `packages/core/src/contrats/referentiel.ts` porte `distanceKm: z.number().nullable()`,
>    gardé par `packages/core/src/contrats/referentiel.test.ts` (« `24.8` accepté »,
>    « `-0.5` refusé »).
> 3. **La colonne est restée `integer`** (`packages/db/src/schema.ts`), avec un commentaire
>    qui documente tout le raisonnement.
>
> **C'est-à-dire l'OPTION 1 de la section « Options » ci-dessous — celle que cette entrée
> avait explicitement ÉCARTÉE**, au motif qu'« une colonne qui annonce `integer` et contient
> 12,4 ment au prochain lecteur, et le projet préfère la lisibilité à l'astuce ».
>
> **Ce qui a fait changer d'avis, et qui est une information neuve, pas un renoncement** :
> l'option 2 (migrer en `real`) a été **essayée sur une COPIE de la base réelle le
> 31/07/2026** et elle échoue en `FOREIGN KEY constraint failed` — la reconstruction de table
> générée par Drizzle est refusée parce que `lieu_marche` est référencée (sessions,
> observations météo), et `PRAGMA foreign_keys=OFF` est sans effet dans la transaction du
> migrateur. Le commentaire de `schema.ts` conclut : « **impossible, pas seulement risquée** ».
> C'est la confirmation empirique de la règle posée en D-044.
>
> **Ce qu'il faut donc NE PLUS FAIRE** : la section « Conséquences » ci-dessous prescrit,
> en « à faire quand le porteur est disponible », de sauvegarder la base puis de **migrer la
> colonne en `real`**. **Cette prescription est caduque** — l'opération a été tentée et
> échoue. Ne pas réserver un créneau pour elle.
>
> **Ce qui reste vrai et qu'il ne faut pas jeter** : le « Complément — `metres_lineaires_occupes` »
> en fin d'entrée (colonne `integer`, aucun consommateur, coût mesuré nul aujourd'hui) est
> vérifié encore exact au 01/08/2026.
>
> **Le raisonnement d'origine reste ci-dessous tel quel**, y compris le rejet de l'option 1 :
> il était juste avec l'information dont il disposait. Ce qui manquait, c'est qu'une décision
> revue mérite une ligne à l'endroit où on la lit — sans quoi le lecteur applique la règle
> abandonnée, exactement comme pour la cible de résolution (D-091).

### Contexte

Une recette jouée au clavier sur l'écran des lieux a relevé que le champ « Distance (km) » refuse
« 12,5 ». Le premier réflexe était de traiter ça comme un défaut de validation. **Vérification faite,
c'en est un mais pas là où on le croyait** : la colonne elle-même est déclarée `integer`
(`packages/db/src/schema.ts:846`). L'écran n'est pas trop strict — il est fidèle à la base.

Le vrai constat est en amont, et il date d'aujourd'hui. Tant que la distance était **saisie à la
main** sur un GPS, l'entier était le bon choix : personne ne recopie « 12,4 ». Depuis D-065 et D-072,
elle est **calculée** par OpenRouteService, qui rend des **mètres**. L'arrondi au kilomètre jette donc
une précision obtenue gratuitement, et il se propage : les km réels d'une session sont pré-remplis à
**2 × cette distance** (D-064), et `session_marche.distance_reelle_km` est, elle, déclarée `real`. Un
lieu réellement à 12,4 km produit 12 → 24 au lieu de 24,8.

La règle 4 du §3 de `CLAUDE.md` n'impose l'entier qu'aux **masses et aux volumes**. Elle n'a jamais
rien dit des distances — l'entier ici est un choix, pas une contrainte héritée.

### Options

1. **Assouplir la validation Zod sans toucher à la colonne.** Techniquement ça « marche » :
   l'affinité NUMERIC de SQLite conserve 12,4 dans une colonne déclarée `INTEGER` au lieu de la
   tronquer. **Écartée** — une colonne qui annonce `integer` et contient 12,4 ment au prochain
   lecteur, et le projet préfère la lisibilité à l'astuce.
2. **Migrer la colonne en `real`.** C'est la bonne cible. Mais SQLite ne sait pas changer le type
   d'une colonne : Drizzle génère une **reconstruction complète de table**, hors du périmètre que
   D-044 a déclaré sûr (`ADD COLUMN` / `CREATE INDEX` / `DROP INDEX` uniquement).
3. **Ajouter une seconde colonne `real` à côté.** Écartée : deux colonnes pour une seule grandeur,
   c'est la porte ouverte à ce qu'elles divergent.

### Choix

**Option 2 sur le fond, différée dans le temps.** Le commentaire de conception de la colonne est
corrigé dès maintenant pour dire la vérité (calculée, plus saisie ; entière, et pourquoi c'est
désormais discutable). Le changement de type attend que le porteur soit là et que sa base soit
sauvegardée — une reconstruction de table s'exécute sur `donnees/batte.sqlite`, qui contient ses
données réelles.

**Ce qui a motivé l'attente plutôt que l'exécution** : le gain se compte en centimes sur une session
(0,8 km à ~0,35 €/km) et l'app tourne en ce moment sur cette base. Le seul endroit où l'arrondi pèse
vraiment, c'est le **classement de deux lieux proches** sur la marge nette — un biais systématique de
±0,5 km par lieu peut y inverser un ordre. C'est réel, mais ce n'est pas une urgence de nuit.

### Conséquences

- Le commentaire périmé de `schema.ts:833-846` — « saisie à la main, et c'est délibéré » — est
  remplacé. Il justifiait un choix par un argument (« une distance à vol d'oiseau se trompe de 20 à
  40 % ») qui **visait la mauvaise cible** : ce n'est pas du vol d'oiseau, c'est un itinéraire
  routier. Un commentaire juste sur le fond peut devenir faux sans qu'une ligne de code ne bouge.
- Aucune migration n'est écrite. Aucune validation n'est assouplie. L'écran reste cohérent avec la
  base, ce qui est préférable à une saisie qui accepte ce que la base ne promet pas.
- **À faire quand le porteur est disponible**, et l'ordre compte : d'abord `Math.round`, ensuite la
  colonne. Sauvegarder `donnees/batte.sqlite`, migrer la colonne en `real`, relire les arrondis en
  aval (pré-remplissage de session, comparaison de lieux, `lieux-rentabilite.ts`), et lever la
  mention correspondante dans D-044.

### Complément du 30/07/2026 — l'arrondi n'est PAS dans la colonne, il est en amont

Mesuré après coup, et ça change le correctif : la précision est jetée **à la source**, pas au
stockage. `apps/api/src/itineraire/client.ts:269` fait `Math.round(metres / METRES_PAR_KM)` **au
moment même** où les mètres bruts d'OpenRouteService sont convertis, avant que la valeur n'atteigne
la fiche du lieu. Rien entre là et l'écriture (`routes/referentiel-ecriture.ts`,
`distanceAvecCalculAutomatique`) ne la récupère.

**Conséquence pratique : migrer la colonne en `real` sans toucher à cette ligne ne changerait
strictement rien** — on stockerait un entier dans une colonne réelle. C'est exactement le genre de
correctif qui a l'air fait et ne l'est pas.

La propagation est confirmée jusqu'au bout : `Sessions.tsx:1472` charge la valeur déjà arrondie,
`Sessions.tsx:1867-1870` pré-remplit les km réels à `distance × 2`, et rien ne compense. Un
itinéraire réel de 12,4 km affiche 24 km au lieu de 24,8. Le champ reste libre — le porteur peut
corriger — mais s'il ne touche à rien, `coutDeplacementSessionCents`
(`packages/core/src/deplacement.ts`) est sous-évalué, et ce coût alimente la comparaison de marge
nette entre lieux.

### Complément — `metres_lineaires_occupes` : question close, sans correctif

Elle est bien `integer` elle aussi (`schema.ts:818`), et un emplacement de 3,5 m est réaliste. Mais
la vérification en aval, qui manquait, a donné un résultat net : **aucun consommateur**. Ni
`packages/core`, ni `lieux-rentabilite.ts` ne lisent jamais `metresLineaires`. La perte de précision
est réelle et latente, mais **son coût mesuré est nul aujourd'hui**. À rouvrir le jour où un calcul
de coût d'emplacement au mètre linéaire existera — pas avant.

---

## D-075 — Une fournée est rattachée à la prévision que le porteur AVAIT SOUS LES YEUX, pas à celle que le service choisirait après coup

**Date** : 30/07/2026 · **Statut** : appliquée

### Contexte

`production.ordre_prevision_id` existait depuis le premier jour, écrite en dur à `null` et lue nulle
part. Elle doit relier une fournée à **la prévision sur laquelle on a décidé de la lancer**.

Un lien indirect existait déjà : une production porte une session, une prévision aussi. Il ne suffit
pas. D-058 **conserve toutes les révisions** d'une prévision au lieu de les écraser — J-7, J-3, J-1,
le matin même. Le lien transitoire dit donc « une prévision de cette session », jamais **laquelle**.

Or c'est précisément ce qui manque pour apprendre. Le porteur produit sa pâte **la veille**, sur une
prévision précise. Sans ce lien, on peut comparer le réalisé à _une_ prévision ; jamais à _celle qui
a servi_.

### Options

1. **La plus récente au moment du lancement, choisie par le service.** Écartée : le service tourne
   après le clic. Si une révision est archivée entre l'affichage de l'écran et l'enregistrement,
   il rattacherait une prévision que le porteur n'a **jamais vue**, et l'écart mesuré deviendrait un
   artefact.
2. **Un choix explicite dans un menu déroulant.** Écarté : c'est une saisie de plus, sur un écran
   qu'on utilise en cuisine, pour une information que l'écran connaît déjà.
3. **Ce que l'écran affichait.** Retenue.

### Choix

**L'écran calcule `previsionRetenue` — la plus récente archivée pour la session choisie — l'affiche
au moment du lancement, et transmet cet identifiant.** Le service ne choisit rien : il vérifie que la
prévision existe et qu'elle porte bien la même session (`prevision_session_incoherente`), puis écrit
tel quel.

Même convention que `impactMesureSession` (`packages/db/src/depots/previsions.ts`) applique déjà pour
un autre besoin — « la plus proche de ce qui a réellement guidé la décision ». Ce n'est donc pas une
règle inventée pour l'occasion.

**`null` reste pleinement valide** et garde un sens précis : « décidée sans prévision » — un
dépannage, un rattrapage, une session pas encore choisie. Ce n'est pas « prévision inconnue », et le
champ n'est pas rendu obligatoire.

### Conséquences

- `lireProductionDetail` relit la prévision rattachée et calcule **`ecartVsPrevisionBp`**, l'écart
  signé en points de base entre ce qui a été décidé (`crepesTheoriques`) et ce que le modèle
  recommandait. **Comparé à `crepesRetenues`, jamais au p50 brut** : l'écrêtage par les contraintes
  dures (volume transportable, capacité de cuisson) fait partie de la recommandation, pas du bruit.
- L'écran de détail affiche « Prévision suivie », sa date de calcul, et l'écart en pourcentage.
  C'est la mesure que la boucle prévu/réalisé attendait : le porteur suivait-il le modèle, et de
  combien s'en écartait-il.
- Le `it.fails` correspondant est converti en test de non-régression. Il n'en reste **qu'un** dans
  tout le dépôt (`mouvementStock.valuationDate`).
- `ProductionDetailLue` est annoté explicitement, et c'est délibéré. Une fonction de dépôt **sans
  type de retour** peut violer le contrat Zod qu'elle alimente **sans que `tsc` ne dise rien** :
  l'inférence recopie exactement ce que la fonction rend, manque compris. Le cas réel de ce jour
  était `lireCommandeDetail` (`packages/db/src/services/commandes.ts`), qui rendait deux champs de
  moins que `schemaCommandeDetail` n'en exige — invisible au typecheck, sorti en **HTTP 422** sur
  quatre routes au premier appel. C'est l'annotation qui crée le contrôle.

---

## D-076 — Annuler une réception rend à la commande son statut d'AVANT, parce qu'on écrit désormais ce statut au moment où on le change

**Date** : 30/07/2026 · **Statut** : appliquée

### Contexte

`annulerReception` contrepassait tout le stock d'une réception mais **ne revenait jamais** sur le
statut `recue` de la commande liée. Une commande pouvait donc afficher « reçue » alors que la
marchandise était intégralement repartie.

Son propre commentaire disait pourquoi : le statut d'avant la réception — `brouillon`, `validee` ou
`envoyee` — « n'est conservé nulle part ».

### Options

La question posée était : **remettre le statut d'avant** (mais lequel ? on ne le sait pas) ou
**laisser `recue`** et rendre l'incohérence visible.

Les deux respectaient « rien ne s'efface » (§3 règle 7). Aucune n'était satisfaisante : la première
exige de deviner, la seconde laisse une donnée fausse en base et se contente de l'afficher.

### Choix — une troisième voie : rendre le fait enregistrable

**Le statut d'avant n'était nulle part parce que personne ne l'avait jamais écrit.**
`enregistrerReception` inscrit maintenant une entrée de `journal_audit` (action `modification`,
valeur d'enum existante, **aucun changement de schéma**) chaque fois qu'elle bascule une commande en
`recue`, en y consignant le statut réel d'avant.

La question « deviner ou laisser » devient alors « a-t-on le fait, oui ou non » :

- **Le fait existe** (toute réception enregistrée à partir d'aujourd'hui) → l'annulation restaure le
  statut exact, par un **nouvel** `UPDATE` daté accompagné de sa propre entrée d'audit. L'entrée
  « → recue » d'origine n'est jamais touchée, et une note est ajoutée à `commande.notes` pour
  expliquer la correction.
- **Le fait n'existe pas** (réception antérieure à ce correctif) → **rien n'est deviné.** La commande
  reste `recue`, et l'incohérence est inscrite **définitivement dans `commande.notes`** — un fait en
  base, pas un affichage calculé à la lecture.

### Le cas de la commande à plusieurs réceptions

Il tient, et pour une raison structurelle vérifiée : `enregistrerReception` **refuse déjà** de
rattacher une réception à une commande `recue` ou `annulee`. Au plus **une** réception active peut
donc être responsable du statut `recue` courant. Quand on en annule une, c'est nécessairement
**celle** qui a causé l'état actuel.

Un cycle complet reste possible et correct — `recue` → annulée → ouverte → `recue` à nouveau, une
seconde réception légitime redevenant rattachable — et chaque annulation retrouve **sa propre**
entrée d'audit (la plus récente qui corresponde), jamais celle d'un cycle antérieur. Testé
explicitement sur deux réceptions.

### Conséquences

- **La boucle achat se referme dans les deux sens** : commande → réception (D-073) et réception →
  commande. Le menu de rattachement existait déjà depuis D-036 ; ce qui manquait était de **voir
  laquelle** — `ResultatReception` et `schemaReceptionCreee` portent désormais `commandeNumero`.
- Le test qui affirmait l'ancien comportement (« reste `recue` pour toujours ») était un test qui
  **gardait un défaut**. Il a été réécrit, pas supprimé.
- Le correctif s'applique à la **source de la donnée**, pas à son affichage. L'alerte de lecture
  posée plus tôt dans la journée sur l'écran des achats reste utile pour l'historique antérieur —
  c'est désormais son seul rôle.

---

## D-077 — Une marge brute de 100 % est signalée sur un seuil STRICT (coût nul), jamais sur un pourcentage

**Date** : 30/07/2026 · **Statut** : appliquée

### Contexte

Une session pouvait se clôturer avec un **coût matière transformé à zéro** sans que rien ne le dise :
`margeBruteCents = caTotalCents`, marge affichée à 100 %. Le chemin était court et plausible — un
produit transformé dont la recette existe mais est vide et jamais activée, puis une clôture en mode
« crêpes produites saisies à la main », sans production rattachée.

C'est l'illusion que `CLAUDE.md` §6 demande de dissiper. Le trou symétrique côté marchandises
revendues avait été fermé deux jours plus tôt ; celui-ci était resté ouvert.

### La vraie difficulté : deux cas que zéro confond

- « du transformé a été vendu, mais son coût matière est nul » → **anomalie**, la marge est fausse ;
- « il n'y a eu que du revendu ce jour-là » → **normal**, un coût transformé nul est la vérité.

Un avertissement qui se déclenche dans le second cas est ignoré au bout de trois fois — et alors il
ne sert plus jamais dans le premier. Le seuil était donc la décision, pas l'affichage.

### Choix

**`caTransformeCents > 0` ET `coutMatiereTransformeCents === 0`, strictement.** Fonction pure
`coutMatiereTransformeSuspect` (`packages/core/src/sessions.ts`).

**Pourquoi pas un seuil relatif** (« moins de X % du CA ») : un coût partiellement retenu, ne
serait-ce qu'un centime, prouve qu'au moins une source de coût a été consultée. Ce n'est plus le
silence total que l'avertissement vise — c'est un chiffre discutable au cas par cas, et ces cas-là
sont déjà couverts par `EcartStockVente`. Un pourcentage inventerait une marge d'erreur arbitraire
sans mieux protéger contre le seul défaut réel : l'absence totale de coût.

**Pourquoi `caTransformeCents` plutôt qu'un comptage de crêpes** : la grandeur est déjà calculée par
`totaliserVentes`, menus explosés au prorata compris ; elle reste positive pour un produit qui ne
produit aucune crêpe (pâte vendue au volume) ; et elle évite d'introduire une **seconde** façon de
compter ce que le compteur de seuils légaux compte déjà.

### Conséquences

- Nouveau bandeau à la clôture, au même endroit et avec la même convention éphémère que
  `avertissementEnergie` : affiché une fois après l'enregistrement, jamais persisté ni reconstitué.
  Il nomme les produits transformés vendus et, quand une recette en brouillon ou sans ligne est
  identifiable, la désigne.
- `diagnostiquerRecettePourCoutNul` (lecture seule, `depots/referentiel.ts`) est branchée **à la
  clôture uniquement**, jamais à la création du produit : c'est le moment de la **vente** qui doit
  être honnête. Créer un produit avant que sa recette ne soit finie reste un ordre de travail
  légitime. `verifierRattachements` n'est pas touchée — elle ne vérifie toujours que l'existence.
- **Défaut adjacent signalé, non corrigé** : `ecartsStock` est calculé et renvoyé par
  `POST /sessions/:id/cloturer` depuis longtemps, mais **n'est jamais affiché**. Le chemin de
  `avertissementEnergie` va jusqu'à l'écran ; celui de `ecartsStock` s'arrête avant.

> ### ⚠️ Correction du 30/07/2026 — ce « défaut adjacent » était déjà corrigé au moment où cette phrase a été écrite
>
> Le point ci-dessus affirme qu'`ecartsStock` « n'est jamais affiché ». **C'est faux**, vérifié directement dans le code au moment d'écrire cette correction : `apps/web/src/pages/Sessions.tsx` calcule `avertissementEcartsStock = formaterAvertissementEcartsStock(ecartsStockDerniereCloture)` et le rend conditionnellement dans le JSX (`{avertissementEcartsStock !== null && (<p>…</p>)}`, juste après le bandeau `imputationDeplacementDerniereCloture`). `apps/web/src/pages/Sessions.test.tsx` porte 13 tests, tous verts (`npx vitest run apps/web/src/pages/Sessions.test.tsx`), dont trois qui couvrent nommément `formaterAvertissementEcartsStock` — le cas `[]` → `null` (jamais de bandeau vert à vide), le nommage de l'ingrédient et de la quantité sur un seul écart, et le cas à plusieurs écarts.
>
> **Ce n'est pas une dérive du code après coup : c'est une contradiction interne à ce journal.**
> D-037, plus haut dans ce même fichier, porte un encadré du même jour qui documente précisément
> l'ajout de ce bandeau.
>
> **La cause est connue et vaut d'être écrite plutôt que devinée** : cette phrase de D-077 était
> **vraie au moment où elle a été écrite**. Elle reprenait le signalement d'un agent qui venait de
> terminer, pendant qu'un second agent était _déjà en train_ de poser le bandeau. Entre la rédaction
> et la vérification, le correctif a atterri. Ce n'est donc ni une négligence ni une copie non
> revérifiée : c'est le prix du travail parallèle, et la seule parade est de **relire le code au
> moment d'écrire la ligne**, pas une heure plus tôt.
>
> La leçon de D-037 s'applique quand même, sous une forme plus dure : « une décision qui affirme un
> comportement d'écran est une affirmation vérifiable ». Ici elle était vérifiable **et vérifiée** —
> simplement pas au bon instant. Un journal de décisions écrit pendant que le code bouge doit dater
> ses constats à l'heure, pas au jour.
>
> Rien à corriger dans le code : le bandeau existe, fonctionne et est testé. Seule cette ligne de D-077 était fausse ; elle reste ci-dessus telle quelle (le dépôt ne s'efface pas), corrigée ici.

---

## D-078 — L'inventaire des `it.fails` est à zéro, et ça ne veut PAS dire « plus aucun défaut connu »

**Date** : 30/07/2026 · **Statut** : acté

### Contexte

La convention `it.fails` du dépôt encode un défaut trouvé par un audit qui ne peut pas le corriger
sur-le-champ : le test affirme le comportement **voulu** et est marqué « attendu en échec ». La suite
reste verte, mais le jour où quelqu'un corrige le défaut, le test se met à **passer**, donc à
**échouer** en tant qu'`it.fails` — ce qui force sa conversion en test de non-régression. Une dette
qui se rappelle toute seule.

Le dépôt en comptait quatre au matin du 30/07/2026. Il n'en reste **aucun**, vérifié par
`grep -rn "^\s*it\.fails(" --include=*.ts --include=*.tsx packages apps` (exit 1, zéro résultat) —
pas de mémoire, pas depuis une liste.

### Ce que ce zéro signifie, et ce qu'il ne signifie pas

Le cycle s'est fermé de **trois** façons distinctes, et la distinction est le fond de cette entrée :

1. **Deux défauts corrigés** — `production.ordrePrevisionId` (D-075) et un câblage d'annulation de
   réception. Le test s'est mis à passer, la conversion a suivi. **C'est le cas nominal.**
2. **Deux reclassés en exclusion motivée** — `exerciceTracabilite.documentId` et la table
   `utilisateur`. Le critère du fichier est explicite : _une colonne dont l'inutilité est documentée
   n'est pas un défaut ; une colonne dont personne ne sait si elle sert en est un._ Ce ne sont pas
   des corrections, ce sont des **verdicts**.
3. **Un dernier reclassé après vérification** — `mouvementStock.valuationDate`, ci-dessous.

**Un inventaire à zéro ne dit donc rien de plus que : aucune dette n'est actuellement encodée sous
cette forme.** Il ne dit pas que le dépôt n'a plus de défauts. Ceux trouvés le 30/07 par recette au
navigateur (focus perdu, tabulation piégée) n'ont jamais transité par un `it.fails` — la convention
ne couvre que ce qu'un test automatisé peut affirmer, et ce dépôt n'a **ni jsdom ni
`@testing-library/react`**, donc rien ne peut observer `document.activeElement`.

### Le cas `mouvementStock.valuationDate`

Une date de valorisation distincte de la date du mouvement sert, en comptabilité de stock, à
découpler « quand la marchandise a bougé » de « quand son coût a été arrêté » — une facture
fournisseur qui arrive après coup et corrige un coût déjà mouvementé. Besoin réel en général.

**Ici, non**, et c'est vérifié plutôt que supposé :

- les **six** chemins d'écriture et les **deux** chemins de contrepassation écrivent tous
  `valuationDate` avec **exactement** la date du mouvement ;
- `calculerCump` (`packages/core/src/stock.ts`), seule fonction qui valorise le stock, ne lit
  **jamais** `mouvement_stock` : elle part de `lot.prixLigneCents / lot.quantiteInitiale`. Elle ne
  peut **structurellement pas** consulter cette colonne ;
- le seul mécanisme qui corrige réellement un coût après coup — `enregistrerFacture` — écrit
  directement sur `lot.prixLigneCents` et **contourne** `mouvement_stock`.

Câbler une lecture aurait affiché, sur chaque ligne, la même valeur que la date du mouvement déjà
affichée à côté : un doublon visuel, pas une information. Exactement l'illusion de contrôle que ce
fichier d'audit existe pour repérer.

**Réserve inscrite dans le fichier** : si un ajustement rétroactif est un jour écrit directement sur
`mouvement_stock` plutôt que sur `lot`, cette exclusion devra être révisée et un test de
non-régression reconstruit. `docs/07-DOCTRINE-ERP-ET-DESIGN.md` §6.8 garde d'ailleurs « ajustement de
coût rétroactif » au catalogue des manques assumés.

---

## D-079 — Un rechargement de liste ne doit PAS repasser par l'état « chargement » : c'est ce qui fait perdre le focus

**Date** : 30/07/2026 · **Statut** : appliquée sur trois écrans, sweep à faire

### Contexte

Le focus qui retombe sur `<body>` a été **reproduit huit fois sur cinq écrans** par deux recettes au
clavier : Stock, Menus, Comptabilité (deux cas), Factures. À chaque fois, il faut retraverser les
vingt-cinq entrées du menu latéral avant de pouvoir continuer à saisir. Sur une saisie répétitive au
chiffre et à la tabulation, c'est la fonctionnalité qui cesse de servir.

Le défaut **n'était pas systématique**, et c'est ce qui a permis de le diagnostiquer : sur les mêmes
écrans, « Nouvelle dépense », « Nouvelle immobilisation » et l'enregistrement d'une facture complète
rendaient correctement le focus.

### La cause, unique pour les six cas

Un **rechargement de liste en arrière-plan** fait transiter la machine à états de l'écran par une
phase intermédiaire `{ statut: 'chargement' }`. Cette phase remplace inconditionnellement le
`<Tableau>` (ou la liste de lignes) par un « Chargement… », puis le remet — **détruisant et
reconstruisant tous les nœuds du sous-arbre**, y compris celui qui portait le focus, ou celui vers
lequel `Tab` venait de l'amener. Rien ne le repose ensuite.

Ce qui distingue les cas qui **fonctionnent** : ils appellent `.focus()` sur un nœud **stable**, hors
du sous-arbre rendu conditionnellement (le bouton bascule), et ils le font **avant** de déclencher le
rechargement. Les cas fautifs n'appellent `.focus()` nulle part.

### Choix

**Un rechargement de données déjà affichées écrit directement `{ statut: 'pret', lignes }`.** Le
sous-arbre ne se démonte jamais, donc le focus survit sans qu'on ait à le reposer. L'état
`'chargement'` reste réservé au **premier** chargement, celui où il n'y a effectivement rien à
montrer.

Deux corollaires, chacun tranché sur le geste réel plutôt que sur la commodité technique :

- **Quand le nœud focalisé disparaît légitimement** — « Marquer faite » fait disparaître le bouton
  cliqué — le focus va sur **l'échéance suivante encore actionnable**, continuation naturelle d'une
  liste de contrôle qu'on descend. Si plus aucune ne l'est, `null` : **aucune cible forcée**, et le
  cas est documenté comme limite connue plutôt que comblé par un repli inventé.
- **Quand on retire une ligne** — facture, réception — le focus va sur **la ligne qui prend
  visuellement sa place**. On retire une ligne parce qu'on s'est trompé, et on veut continuer à
  saisir au même endroit.

### Conséquences

- Corrigé sur `Comptabilite.tsx` (échéancier), `Factures.tsx` (retrait de ligne + retour de focus
  après refus) et, par le même raisonnement, `saisie-stock/SaisieReception.tsx`.
- **Le sweep reste à faire** : tout autre écran qui recharge une liste en repassant par
  `'chargement'` porte le même défaut. La liste doit être **dérivée du code**, pas énumérée à la main
  (D-045).
- **Ce qui n'est pas prouvé, et doit l'être à la main une fois** : que `.focus()` atteigne réellement
  le nœud visé, et que le `<Tableau>` reste bien monté. Le dépôt n'a **ni jsdom ni
  `@testing-library/react`** — décision assumée (§7 : aucune dépendance nouvelle sans validation) —
  donc rien ne peut observer `document.activeElement`. Le patron du dépôt est d'extraire la
  **décision** en fonction pure exportée et de la tester : ça prouve que la bonne cible est calculée,
  jamais que le navigateur y va.
- Défaut adjacent corrigé au passage : un nouvel objectif arrivait avec **début et fin au même
  jour**, produisant une cible que rien ne pourrait jamais évaluer. `date_fin` étant `NOT NULL`
  (`schema.ts:2313`), la date vide n'est pas stockable — le champ démarre donc vide et une validation
  **côté écran uniquement** force un choix. Un début et une fin identiques choisis _délibérément_
  restent acceptés : seul le défaut silencieux est traité.

### Complément du 31/07/2026 — le même symptôme a une SECONDE cause, sans rapport avec la première

Le titre de la section ci-dessus — « la cause, **unique** pour les six cas » — reste vrai pour ces
six cas. Il était en revanche en train de devenir trompeur pour la suite : deux écrans corrigés selon
D-079 **perdaient encore le focus**, et une lecture du code a donné une cause entièrement distincte.

`Ingredients.tsx` et `Sessions.tsx` (clôture, `Ctrl+S`) portaient `disabled={enCours}` sur le bouton
d'enregistrement — **celui-là même qui avait le focus au moment du clic ou du raccourci**. Or un
élément désactivé ne peut pas être focalisé : **le navigateur le lâche de lui-même**, avant tout
rendu React, et le focus retombe sur `<body>`. Aucune reconstruction de sous-arbre là-dedans : le
nœud n'est jamais démonté, il devient seulement inéligible. Le remède de D-079 — ne pas repasser par
`'chargement'` — ne pouvait donc rien y faire.

**Ce qu'il faut retenir, et qui vaut au-delà de ce défaut** : désactiver un contrôle pendant qu'il a
le focus est une opération destructrice, même quand le contrôle survit. C'est le cas général de tout
bouton d'action asynchrone protégé contre le double-clic — c'est-à-dire de presque tous.

Corrigé sur les deux écrans par le patron déjà en place sur `boutonSortir` / `Stock.tsx` :
`requestAnimationFrame` + `ref`, qui repose le focus une fois `enCours` retombé.

**Conséquence méthodologique** : une décision qui affirme avoir trouvé « la » cause d'un symptôme
observable doit être relue quand le symptôme réapparaît, jamais rejouée. Ici, appliquer D-079 plus
fort sur ces deux écrans n'aurait rien donné et aurait fait conclure à un défaut de navigateur.

---

## D-080 — Un contrôle placé à côté du titre d'un écran prétend commander tout l'écran, quoi que dise son libellé

**Date** : 31/07/2026 · **Statut** : appliquée

### Contexte

La fiche 10 demande un **horizon choisi par l'utilisateur** au tableau de bord : 7 jours, 15 jours,
30 jours par défaut, 3 mois, 6 mois, 1 an.

Le recensement préalable, encart par encart, a donné un résultat qui change tout : **sur huit
encarts, deux seulement peuvent honnêtement recevoir un horizon.**

| Encart                                | Sensible ? | Pourquoi                                                           |
| ------------------------------------- | ---------- | ------------------------------------------------------------------ |
| Prochaine session                     | Non        | question singulière (« la prochaine »), pas une fenêtre            |
| Dernières sessions                    | Non        | regarde en arrière                                                 |
| Stock sous seuil / DLC déjà périmée   | Non        | fait **présent**, pas une projection                               |
| DLC proches                           | Non        | fenêtre **partagée avec `Stock.tsx`** — voir ci-dessous            |
| Nettoyage en retard / non-conformités | Non        | « en retard » et « ouvert » n'ont pas de dimension future          |
| Seuils légaux                         | Non        | **annuels par nature** — une fenêtre en jours serait un contresens |
| Échéances réglementaires              | **Oui**    | `joursAvantEcheance` déjà chargé, filtrage honnête côté écran      |
| Achats à anticiper                    | **Oui**    | `/prevision-calendaire?horizonJours=` accepte déjà le paramètre    |

Le cas des **DLC proches** mérite d'être isolé : sa fenêtre de quatorze jours est délibérément la
même que celle de l'écran Stock, pour que **les deux écrans ne comptent jamais différemment le même
fait**. La rendre réglable ici seulement les aurait fait diverger. Laissée telle quelle, motif écrit.

### Le problème que ce constat crée

Un sélecteur logé dans la rangée du `<h1>` se lit comme un contrôle **de l'écran entier**. Quelqu'un
qui passe de 30 à 7 jours en conclut que tout ce qui reste affiché concerne les sept prochains jours.
C'est faux pour six encarts sur huit, dont les seuils légaux.

**Ce n'est pas le chiffre qui ment, c'est le cadre qu'on met autour** — même classe de défaut que
celle traquée partout ailleurs dans ce projet, à un niveau au-dessus.

### Options

1. **Nommer la portée dans le libellé du sélecteur.** Écartée pour deux raisons : un libellé assez
   long pour nommer « achats + échéances » mange la rangée que `docs/07` §4.4 protège (la hauteur est
   la ressource rare à 1280×720) — et surtout **il ne corrige rien** : la position communique une
   portée globale quel que soit le texte.
2. **Le garder en en-tête, en plus discret.** Écartée : la discrétion change l'apparence, pas ce que
   la position dit.
3. **Le déplacer auprès de ce qu'il commande.** Retenue.

### Choix

**Le sélecteur vit dans le panneau « Achats à anticiper »**, en enfant permanent — jamais à
l'intérieur d'une branche rendue conditionnellement, pour que D-079 continue de tenir. L'en-tête
redevient un `<h1>` nu.

**Sans duplication**, parce que les deux consommateurs ne sont pas symétriques : « Achats à
anticiper » a besoin du contrôle sur place, il déclenche un vrai recalcul serveur ; la ligne
« échéances » de la liste à traiter, elle, **énonce déjà son horizon en toutes lettres**
(« … (horizon : 30 j) »). Un second sélecteur dans une liste qui mêle alertes dépendantes et
indépendantes de l'horizon aurait reproduit le même excès de portée un niveau plus bas.

### Conséquences

- **Règle générale à retenir** : un contrôle placé à côté du titre d'un écran prétend commander tout
  l'écran. S'il ne le fait pas, il ment par sa position — le déplacer coûte moins cher que de
  l'expliquer, et `docs/07` écarte de toute façon les textes d'aide qui compensent une interface
  ambiguë au lieu de la corriger.
- Le choix **n'est pas persisté**, après vérification qu'**aucun filtre d'écran de l'application ne
  survit à un rechargement** (aucun `localStorage`/`sessionStorage` dans `apps/web/src`). Le
  persister en ferait la seule exception, et une exception surprend plus qu'elle n'aide.
- Quand l'horizon ne contient rien : l'encart bascule sur l'état vide **variante « filtre »** — « vide
  après filtrage », pas « vide normal » — avec un bouton de réinitialisation. La ligne « échéances »,
  elle, **disparaît** de la liste à traiter : jamais un « aucune échéance » décoratif.
- **Restent non traitables sans sortir du périmètre** : rendre les DLC proches réglables exigerait de
  faire évoluer `Stock.tsx` en même temps ; afficher les tâches de nettoyage **à venir** (et pas
  seulement en retard) exigerait une fonction de dépôt qui n'existe pas. Décrits, non créés.

---

## D-081 — La somme des largeurs de colonnes doit faire EXACTEMENT 100, sinon le navigateur rabote tout le tableau en silence

**Date** : 31/07/2026 · **Statut** : ~~appliquée, garde à écrire~~ → **appliquée, garde
écrite** (corrigé le 01/08/2026)

> **Correction de statut du 01/08/2026.** L'en-tête disait « garde à écrire » alors que le
> corps de cette même entrée dit, en gras, « **La garde est écrite** ». Une entrée qui se
> contredit elle-même fait douter du reste. Vérifié : `apps/api/src/tableau-largeurs-colonnes.test.ts`
> existe, tourne, et journalise pendant l'exécution « **49 fichiers .ts/.tsx examinés sous
> apps/web/src (hors _.test._) — 71 définitions de colonnes détectées** », zéro dépassement.
> Seul le champ `Statut` était en retard.

### Contexte

Un audit visuel a capturé les 29 écrans à **1280×720** — la résolution réelle d'un 1920×1080 sous
Windows à 150 %, celle du poste du porteur. Verdict : **en-têtes et valeurs de tableau tronqués sur
19 des 29 écrans**, de « un mot coupé » à « en-tête réduit à une lettre ». Aucun débordement : le
tableau tenait dans son conteneur. Et les mêmes tableaux à ~1920 px s'affichaient en toutes lettres.

L'hypothèse naturelle — « il y a trop de colonnes, il faut rééquilibrer » — était **fausse**.

### La cause, arithmétique

`Tableau.tsx` pose les `largeur` déclarées sur un `<colgroup>` avec `table-layout: fixed`. **Si leur
somme dépasse 100 %, le navigateur renormalise chaque colonne à `100 / somme`.**

C'est un rétrécissement **uniforme et invisible à la lecture du code** : rien dans le fichier ne
laisse voir que la colonne déclarée à 13 % s'affichera à 10 %.

Le cas mesuré : `PropositionsEvenements.tsx` déclarait douze largeurs sommant à **129 %**
(16+9+13+10+12+9+8+12+7+11+9+13). Chaque colonne était donc rendue à **77,5 %** de sa valeur
déclarée — un rabotage de 22,5 % sur toute la table, qui suffit à réduire un en-tête à une lettre.

**Ce qui distinguait les écrans propres** — Factures (16+22+12+16+17+17 = 100) et Journal d'audit
(16+14+12+22+26+10 = 100) — n'était ni un meilleur partage ni une meilleure typographie : **ils
n'avaient simplement jamais eu ce bug arithmétique.**

### Choix

**Avant de toucher une largeur, additionner.** Toute autre optimisation faite avant cette
vérification compense un symptôme et masque la cause.

Deux règles complémentaires, tirées des mêmes deux écrans de référence :

- **La colonne identifiante porte `troncature: 'repli'`**, jamais l'ellipse par défaut. Une identité
  ne se tronque pas — on préfère une rangée plus haute à un nom illisible.
- **Un nombre ne se tronque jamais**, sous aucune forme. Un texte coupé se devine ou se survole ; un
  nombre coupé après la virgule est **impossible à reconstituer** — `32,…` peut être 32,1 ou 32,99.
  Si une colonne numérique ne tient pas : élargir, réduire les décimales **de toute la colonne**, ou
  sortir l'unité vers l'en-tête. Jamais d'ellipse.

### Conséquences

- **La garde est écrite** : `apps/api/src/tableau-largeurs-colonnes.test.ts`. Elle dérive la liste des
  tableaux du système de fichiers — **45 fichiers, 70 définitions de colonnes** — et somme chaque
  bloc. Motif D-045 respecté : rien n'est énuméré à la main, donc un écran ajouté demain est couvert
  sans que personne n'ait à y penser.

  Trois choses méritent d'être sues sur elle :

  - **Elle vit sous `apps/api/src/`, pas sous `apps/web/`**, et pas par erreur. Elle lit des fichiers,
    donc elle importe `node:fs` — ce que `securite-secrets.test.ts` interdit à tout fichier du front,
    parce que la clé Anthropic ne doit jamais atteindre le navigateur (§2). La garde a fait sonner
    cet autre garde-fou ; **c'est la garde qui a déménagé, pas le garde-fou qu'on a assoupli.** Même
    emplacement et même justification que `schema-migrations.test.ts` et `smoke-routes-lecture.test.ts`.
  - **Une somme INFÉRIEURE à 100 avertit sans faire échouer.** Sous 100, le navigateur ne renormalise
    pas : il laisse l'espace inutilisé. Ça ne casse rien, mais ça trahit souvent une colonne oubliée.
    Le choix est délibéré — un test trop strict pour une raison bénigne finit désactivé au premier
    agacement, et alors il ne protège plus rien.
  - **Deux angles morts, vérifiés absents aujourd'hui mais nommés** : une `largeur` qui ne serait pas
    un littéral `'NN%'` (calculée, ou construite par gabarit) échappe au comptage **et** au contrôle
    de couverture, puisque les deux reposent sur le même motif ; et une table composée par
    **étalement** de deux tableaux déjà valides (`[...COLONNES_A, ...COLONNES_B]`) serait vue comme
    deux blocs à 100 % chacun, là où le navigateur en verrait un à 200 %. La garde ne s'étendra pas
    d'elle-même à ces formes.

- **Elle a immédiatement trouvé une prise que l'œil avait manquée** : `Economies.tsx` somme à **108 %**
  — un écran qui n'était dans aucune des trois listes de correction et que l'audit visuel n'avait pas
  signalé. Et `Menus.tsx` à **90 %**, signalé sans échec.

### Complément du 31/07/2026 — `troncature: 'repli'` n'est PAS un remède universel

Poser `repli` partout sur les tableaux de traçabilité du registre AFSCA a **empiré** le rendu : une
rangée est montée à **550 px** — contre 32 prescrits — parce qu'un **identifiant sans espaces**
s'enroule caractère par caractère. Le remède était pire que le mal.

**La règle affinée, en trois cas** :

- **Un identifiant réglementaire** (numéro de lot fournisseur) garde `repli`, **avec une largeur
  généreuse** : il ne doit jamais être perdu, et sa largeur doit rendre l'enroulement rare.
- **Un texte libre** (ingrédient, fournisseur, produit) garde l'**ellipse + infobulle `titre`** : on
  accepte de le tronquer parce que le survol le rend, et parce qu'il s'enroule mal.
- **Une date ou un nombre** reçoit une largeur **suffisante pour ne jamais faire ni l'un ni l'autre**.
  Un nombre ne se tronque jamais, et un nombre qui s'enroule est illisible.

### Complément — la somme à 100 est nécessaire, pas suffisante

Deux écrans dont la somme valait déjà **exactement 100** tronquaient quand même : la répartition
était mauvaise. Sur `Production.tsx`, un **numéro de lot de pâte** — identifiant AFSCA — était coupé
de **5 px**. Et un tableau à 90 % dans un panneau étroit de 550 px faisait déborder **quatre**
en-têtes, là où le même déficit dans un panneau large n'aurait laissé qu'un vide.

**Corollaire pour la garde** : elle attrape l'erreur arithmétique, jamais la mauvaise répartition. La
mesure du texte réel (`canvas.measureText`, police et majuscules comprises) reste le seul moyen de
savoir ce qu'une colonne demande — et une capture d'écran, le seul moyen de savoir ce qu'elle rend.

**État à l'issue de la campagne** : la garde passe sur **70 définitions de colonnes dans 45 fichiers,
zéro dépassement**. Deux tableaux restent structurellement trop larges pour 1280 px et sont décrits
sans être corrigés — les tableaux Amont/Aval du registre AFSCA, côte à côte dans une grille de
2 × 464 px, et la liste des commandes quand son panneau de détail est ouvert.

- **L'audit visuel avait raison sur le symptôme et n'a pas pu voir la cause** : il photographiait des
  écrans, pas des sommes. C'est la complémentarité des deux méthodes — regarder puis dériver — qui a
  produit le diagnostic, aucune des deux seule.
- Un écran annoncé cassé (`Ingredients.tsx`) s'est révélé **déjà corrigé**, ses commentaires portant
  la trace d'un travail de largeur antérieur. Un rapport d'audit vieux de deux heures peut être en
  retard sur le code quand plusieurs agents écrivent.

### Note opérationnelle, apprise à la dure

Les agents qui vérifient au navigateur **partagent le même navigateur**. Un agent a détecté
plusieurs fois qu'un autre avait navigué ou redimensionné son onglet en pleine session. Deux
conséquences : vérifier `window.location.href` **juste avant chaque capture**, et **mesurer
`document.documentElement.clientWidth`** plutôt que de croire la taille du PNG — le facteur d'échelle
du navigateur (1,25 ici) rend un « 1280×720 » annoncé physiquement différent de ce qu'il prétend.

### Complément du 31/07/2026 — ce que cette garde NE PEUT PAS voir, et il faut le dire

La garde vérifie que la somme fait 100. Elle **ne dit rien de ce que 100 % représente en pixels**.

Le cas qui l'a montré : la liste des concurrents s'affiche dans un panneau de **551,7 px** (deux
panneaux côte à côte à 1280). Mesurés au `measureText` d'un canvas — police et rembourrage réels, pas
une estimation — les six colonnes exigeaient **~575 px** de minimum incompressible. La garde était à
**100 avant** la correction et à **100 après**. Elle a été verte des deux côtés d'un défaut réel.

**C'est exactement le point** : une somme de pourcentages est une contrainte de **répartition**, pas
de **capacité**. Un tableau dont les colonnes ne peuvent physiquement pas tenir reste parfaitement
réparti. Aucun rééquilibrage ne le sauve — il faut **retirer ou fusionner une colonne**, ce qui est
une décision de contenu, pas de largeur.

**Conséquence** : ne jamais présenter cette garde comme une preuve que les tableaux vont bien. Elle
intercepte une faute d'arithmétique, ce qui vaut la peine ; elle est **muette sur la seule question
qui compte pour l'utilisateur** — est-ce lisible. Cette question-là se mesure au navigateur, à
`clientWidth` vérifié, ou ne se mesure pas.

Deux fusions décidées sur ce raisonnement, et **toutes deux en juxtaposition, jamais en somme
calculée** : « Déplacement (€) » + « Emplacement (€) » → « Frais (€) » sur « Où aller ? » (un vrai
total exigerait une décision métier sur les coûts partiellement inconnus, qui n'appartient pas à un
écran) ; et la suppression de « Dernière visite » chez les concurrents — seule des six colonnes à ne
pas être aussi un champ éditable de la fiche, et dont la donnée reste intégralement lisible dans
l'historique des observations.

---

## D-082 — Un lieu JAMAIS visité ne reçoit AUCUNE prévision, et « Où aller ? » n'affiche que des faits connus

**Date** : 31/07/2026 · **Statut** : **implémentée le 31/07/2026**, y compris le calendrier et le
tableau de bord (deux reliquats traités séparément)

### Contexte

La fiche 14 laissait ouverte la question la plus bloquante du projet : **sur quoi s'appuie la
première prévision pour un lieu jamais visité ?** Sans réponse, l'application ne savait chiffrer
**aucun** des événements visés — feux d'artifice, villages gaulois, marchés médiévaux, marchés de
Noël, entreprises.

Ce que le code fait **aujourd'hui**, vérifié : `observationsDuLieu` filtre bien par lieu
(`depots/previsions.ts:274`), donc un lieu jamais visité a **zéro observation**, et `calculerBaseline`
(`packages/core/src/prevision/baseline.ts:133`) retombe **entièrement** sur le paramètre
`prevision_prior_baseline_crepes` — **120 crêpes**. L'explication produite est honnête (« aucune
session close : la base vient entièrement de l'estimation de départ »), mais **le chiffre reste
inventé**, et c'est lui qui alimenterait un classement d'opportunités.

### Options soumises au porteur

1. **Son estimation d'affluence, marquée hypothèse** — il saisit une affluence attendue, l'app la
   convertit par un taux de prise, confiance très basse. Chiffre tous les événements immédiatement ;
   qualité entièrement dépendante de son estimation.
2. **Emprunter à un lieu comparable déjà visité** — repose sur du réel mesuré, mais inutilisable tant
   qu'il n'a qu'un seul lieu, donc ne débloque rien avant des mois.
3. **Aucun chiffre — premier passage exploratoire.** Retenue.

### Choix

**Zéro session close sur ce lieu → aucune prévision.** L'écran le dit (« premier passage, aucune
prévision possible ») au lieu de produire un nombre. C'est le choix le plus exigeant des trois, et il
est cohérent avec la règle 2 du §3 : rien n'invente un chiffre qui entre dans une décision.

**Le seuil est strict : zéro.** À partir d'une session close, le mélange actuel reprend, avec sa
confiance déjà décroissante — le prior ne remonte jamais (invariant testé).

### Conséquence sur l'écran « Où aller ? », tranchée en même temps

Puisqu'aucun revenu ne peut être estimé, l'écran **affiche les faits connus et rien d'autre** : date,
type, distance, tarif d'emplacement, coût de déplacement calculé. Les colonnes « CA attendu » et
« marge » portent un **tiret** et la mention « premier passage ».

**Le tri se fait sur les coûts connus, jamais sur un revenu supposé.** Le porteur décide en voyant ce
que l'occasion **coûte**, pas ce qu'elle rapporterait — ce qui reste une aide réelle à l'arbitrage,
sans le faux confort d'un classement par rentabilité imaginaire.

Écartées : masquer les lieux non chiffrables (l'écran n'afficherait qu'une ligne tant qu'il n'a qu'un
lieu) ; réduire l'écran à un calendrier (ce ne serait plus un outil d'arbitrage).

---

## D-083 — Un relevé de température mal saisi s'annule par écriture nouvelle, les deux restant visibles

**Date** : 31/07/2026 · **Statut** : **implémentée le 31/07/2026** — colonne `releve_temperature.statut`
(migration 0028), service `annulerReleveTemperature`, route `POST /afsca/temperatures/:id/annuler`,
écran `RegistreAfsca.tsx`

### Contexte

L'application ne permettait **aucune** annulation d'un relevé de température. La question — posée
faute de certitude réglementaire — était de savoir ce qu'elle doit faire **en attendant** une réponse
de l'AFSCA.

### Choix

**Annulation par écriture nouvelle, les deux relevés restant au registre.** Le mauvais reste, barré,
avec sa **date de saisie réelle** et un motif ; le bon s'ajoute à côté.

C'est exactement le mécanisme déjà appliqué aux lots, aux réceptions et aux sessions (§3 règle 7), et
c'est celui qui sert le mieux un contrôle : un contrôleur voit **la correction et sa raison**, plutôt
que deux relevés contradictoires sans savoir lequel fait foi — ce qu'aurait produit l'option
« interdire l'annulation ».

**Ce que ça ne change pas** : le registre enregistre ce qui a été saisi, avec sa date de saisie
réelle (§7). Une annulation est une écriture **d'aujourd'hui** qui annule un fait ancien ; elle ne
réécrit jamais le passé, et ne fabrique jamais un registre a posteriori.

**Réserve** : la question reste posée à l'AFSCA. Si elle refuse qu'un relevé annulé figure au
registre imprimé, c'est **l'impression** qui devra changer, pas le modèle — la donnée, elle, doit
rester.

---

## D-084 — La discipline de largeur de colonnes vaut aussi pour le PAPIER, et elle y avait été oubliée

**Date** : 31/07/2026 · **Statut** : appliquée

### Contexte

Personne n'avait jamais **regardé** les documents que l'application imprime. Douze documents existent
— registre AFSCA, journaux du comptable, bons de commande, affichette allergènes, fiche technique,
étiquette de bac, rapport de session, brief avant-marché, cinq exports Excel. Ils ont tous été
produits et ouverts pour la première fois le 31/07/2026.

**Trois défauts, dont un critique sur le document qu'on présente à un contrôle sanitaire.**

Il suffisait d'**une** non-conformité dont le type ou la description est long et sans espaces — un
code de référence collé, geste banal — pour que le tableau des non-conformités du registre AFSCA
perde **quatre colonnes entières** : Gravité, Lot concerné, Action corrective, Résolution
disparaissaient de la page, **sur toutes les lignes**, y compris les lignes courtes.

### La cause, et sa parenté avec D-081

`apps/api/src/documents/style-impression.ts` partageait **une seule règle `<table>` pour les douze
documents**, sans `table-layout: fixed` et sans `<colgroup>`. En disposition `auto`, une chaîne
insécable élargit la table au-delà de la zone imprimable, et le moteur d'impression **ne défile
pas : il coupe au bord de la page.**

C'est exactement la discipline que `docs/07` §4.5 impose à l'écran, **jamais appliquée au papier**.
Même famille que D-081, sur un support où la conséquence est pire : un écran tronqué se survole, une
page imprimée est définitive.

### Choix

`table-layout: fixed` sur la règle partagée, `overflow-wrap: break-word` sur les cellules, et **un
`<colgroup>` explicite sur chacune des dix-huit tables** — douze dans les gabarits, six dans le
registre. Leçon de D-081 appliquée dès le départ : `fixed` **sans** largeurs déclarées répartit les
colonnes également, ce qui aurait dégradé les tables aujourd'hui correctes.

**Une seconde garde automatique** balaie désormais chaque `<colgroup>` des documents et échoue si une
somme dépasse 100 — le pendant, pour l'impression, de la garde des écrans. Prouvée en cassant une
largeur volontairement.

### Deux défauts corrigés dans le même passage

- **Aucun des cinq PDF ne portait de pied de page.** Chaque gabarit calculait pourtant la valeur :
  `documentHtml` (`rendu.ts`) la **jetait silencieusement**, et le champ que Playwright lit
  réellement n'était passé par **aucun** des six appelants. Le mécanisme fonctionnait ; il était
  débranché. Conséquence : **une page détachée du registre AFSCA n'était rattachable à rien** — ni à
  l'entreprise, ni à la période, ni au document dont elle venait. C'est précisément ce qu'un contrôle
  regarde.
- **Un lot cité dans une non-conformité perdait son identité** : jamais son fournisseur, et sa DLC
  disparaissait dès qu'un numéro de lot existait — donc l'un ou l'autre, jamais les deux. Or c'est
  cette identité qui décide de la **portée d'un rappel** (§3 règle 6).

### Conséquences

- **Les onze autres documents ont été produits et vérifiés un par un** après le correctif : c'était
  le vrai risque, la règle fautive étant partagée. Aucun n'a été dégradé.
- **Ce qui était déjà bon et doit le rester**, vérifié document par document : nombres alignés à
  droite, `0,00` distinct de `—`, **aucun signal porté par la couleur seule**, mention de TVA bien
  placée, **aucune rangée coupée par un saut de page**, en-têtes répétés sur les pages de
  continuation, libellés d'allergènes réglementaires partout, statut de lot imprimé avec motif et
  date.
- **Non vérifié, et dit comme tel** : aucun document de plus de trois pages, aucune impression
  physique en noir et blanc.

---

## D-085 — Un champ qui NOMME ce qu'une unité consomme, au lieu de le déduire d'un zéro

**Date** : 31/07/2026 · **Statut** : appliquée

### Contexte

La question « **qu'est-ce qu'une unité vendue consomme de la production ?** » n'a que trois réponses,
et elles s'excluent : **N crêpes**, **V millilitres de pâte**, ou **rien** — sa composition vivant
dans la nomenclature de vente, comme le café fait à la tasse (fiche 15 §4).

Deux champs et une déduction encodaient ces trois cas, et le troisième était **inexprimable** :
`nb_crepes = 0` voulait dire _à la fois_ « c'est de la pâte, pas une crêpe » et « ce produit ne
consomme aucune crêpe ».

Conséquence mesurée : la validation **réclamait un volume de pâte pour un café**. Et la fausse
solution évidente — lui donner 100 ml, l'eau de la tasse — aurait fait **retrancher 100 ml du bac de
pâte à chaque café vendu**. Pire que le blocage.

### Le chemin de la décision, qui vaut d'être gardé

Le porteur a d'abord choisi de **donner une recette vide au café** pour satisfaire la règle. Deux
vérifications successives ont montré que ça ne suffisait pas : la validation porte **deux règles
indépendantes**, et la seconde se déclenchait alors sur le volume. Les deux erreurs se produisaient
simultanément, donc la première masquait la seconde.

Il a ensuite choisi une **case à cocher explicite**, puis demandé « la meilleure logique possible ».
Une case laisse des états absurdes représentables — cochée avec cinq crêpes, cochée sans volume,
décochée avec un volume. Un **champ à trois valeurs** les rend inécrivables, pour le même coût de
migration : une colonne.

### Choix

`produit_vente.consommation_unite` — `'crepes' | 'volume_pate' | 'nomenclature'` — **nullable pour
`revendu` et `menu`**, où la question ne se pose pas. `null` y veut dire « sans objet », jamais
« zéro ».

Le champ est **omissible** (`.exactOptional()`) et non requis-mais-nul : forcer chaque fixture d'un
revendu à écrire `consommationUnite: null` lui ferait répondre à une question qu'on ne lui pose pas.
La preuve que le modèle est juste : deux fichiers de test entiers n'ont eu **besoin d'aucune
modification** — **un bon champ ne fait pas travailler ceux qu'il ne concerne pas.**

**Les combinaisons absurdes sont refusées explicitement**, dans les deux sens : un `volume_pate` avec
des crêpes, un `nomenclature` avec un volume, mais aussi un `revendu` qui prétendrait consommer des
crêpes.

**L'écran pose enfin la vraie question** — « une unité vendue consomme… » — et n'affiche le champ de
suite que quand il s'applique. Il ne fait plus deviner que « 0 crêpe » signifie secrètement « pâte » :
c'est ce piège qui a coûté deux allers-retours au porteur le matin même.

### Conséquences

- **La reprise de l'existant n'a rien deviné** : jusqu'à cette migration, `nb_crepes = 0` n'avait
  qu'un seul sens possible, le troisième cas n'existant pas. Chaque ligne ancienne se relit donc avec
  certitude.
- Le prédicat `estPateVendueAuVolume` lit désormais le champ au lieu de déduire. **Aucun montant ne
  bouge** : `volumeMlParUnite` reste codé en dur à `null` côté clôture, limite préexistante et hors
  périmètre — seule l'identification change.
- Le `it.fails` du café est converti. **Vérifié qu'il passait pour la BONNE raison avant conversion**
  — il échouait encore, mais à cause du nouveau champ absent de sa charge utile, pas du défaut
  documenté. Convertir sans regarder ça aurait effacé la trace d'un défaut jamais réparé.

---

## D-086 — Le champ date natif coûte une tabulation de plus, et on ne le corrige PAS

**Date** : 31/07/2026 · **Statut** : mesurée, aucune intervention

### Contexte

Une recette au clavier avait observé qu'un `<input type="date">` ou `type="time"` demandait « entre 2
et 6 » pressions de `Tab` avant de rendre la main, sans aucun repère visuel — donc on croit l'écran
figé. L'observation venait d'un pilotage automatisé, donc suspecte d'artefact.

### Ce que la mesure a établi

**Le défaut est réel**, reproduit trois fois avec de vraies frappes :

| Champ                           | Tabulations pour en sortir |
| ------------------------------- | -------------------------- |
| texte ordinaire (référence)     | **1**                      |
| `type="date"` **rempli**        | **2**                      |
| `type="date"` **jamais rempli** | **2**                      |
| `type="time"` vide              | **2**                      |

**Et l'hypothèse de départ est FAUSSE.** On soupçonnait le bouton natif d'effacement, qui n'apparaît
que lorsqu'une valeur existe. L'essai vide/rempli devait trancher : il donne **exactement le même
coût**. Le contrôle Chromium porte donc **deux arrêts de tabulation internes en permanence**, valeur
ou pas.

**Le « 2 à 6 » s'explique par l'accumulation**, pas par un champ isolé : deux champs `type="time"`
consécutifs à la clôture font passer un trajet de 2 tabulations attendues à **4**.

**Le détail qui explique le ressenti** : à la tabulation « perdue », **aucun événement `focusin` /
`focusout` ne se déclenche et `document.activeElement` ne bouge pas**. La touche est invisible pour
JavaScript comme pour l'utilisateur — ni indice visuel, ni indice programmatique.

### Choix : ne rien corriger

Le remède proposé — intercepter `keydown` et forcer la sortie au premier `Tab` — est **plus dangereux
que le défaut** : dans un champ date, la tabulation sert aussi à **passer d'un segment à l'autre**
(jour, mois, année). Forcer la sortie casserait la saisie au clavier d'une date, c'est-à-dire
précisément ce que la règle 10 du §3 protège.

Les autres voies coûtent davantage : remplacer le contrôle natif par un composant fait maison perd le
sélecteur de calendrier **et** la saisie au pavé numérique.

**Le coût réel est d'une tabulation par champ date.** Le remède risque d'en coûter trois et de casser
la saisie. On documente, on ne touche pas.

### Réserve

Le comportement exact peut varier selon la version de Chromium. Si le porteur constate un jour un
coût nettement supérieur à une tabulation par champ, cette décision est à rouvrir — avec une mesure,
pas une impression.

### Vérifié dans le même passage, et favorable

La confirmation d'enregistrement d'une réception est **sans ambiguïté** : bandeau vert en haut de
l'écran, **avant** le formulaire vidé, portant le numéro (« Réception RC-2026-0005 enregistrée — 1 lot
créé, 45,00 € »), la mention de commande soldée quand il y en a une, et l'avertissement de traçabilité
quand un lot n'a que sa DLC pour identifiant — qui **disparaît proprement** à la réception suivante.

C'était la **condition** posée à la décision de laisser le formulaire ouvert après enregistrement
(D-079 et suivantes) : sans confirmation claire, un formulaire qui se vide ressemble à une saisie
perdue. La condition est remplie.

Écart assumé à `docs/07` §4.7 (« succès : 5 s ») : ce bandeau n'a **pas** de minuteur et reste
jusqu'à la prochaine écriture. Écart **favorable** ici, puisque le formulaire vide juste en dessous
invite à enchaîner — et une confirmation qui disparaît pendant qu'on saisit la ligne suivante ne
confirmerait plus rien.

---

## D-087 — Deux capacités d'annulation existent, testées, et aucun écran ne les appelle : la règle 7 n'est pas tenue pour la production ni pour la réception

**Date** : 31/07/2026 · **Statut** : ~~constat établi, câblage à faire~~ → **appliquée**
(câblage terminé, corrigé le 01/08/2026 — voir l'encadré ci-dessous)

> ### ⚠️ Correction de statut du 01/08/2026 — le câblage EST fait, et deux affirmations de cette entrée sont périmées
>
> **Le statut « câblage à faire » était en retard sur le code.** Vérification dérivée
> (toutes les URL `/annuler` émises par `apps/web/src`, confrontées aux neuf routes du
> tableau ci-dessous, et non une relecture d'écran par écran) :
>
> - `POST /productions/:id/annuler` est appelée par `apps/web/src/pages/Production.tsx` ;
> - `POST /receptions/:id/annuler` est appelée par `apps/web/src/saisie-stock/DetailLot.tsx`
>   **et** par `apps/web/src/saisie-stock/SaisieReception.tsx`.
>
> Les **neuf** routes d'annulation sont donc atteintes depuis l'interface : la règle 7 est
> tenue pour la production et pour la réception. Le tableau ci-dessous, qui porte encore
> « **aucun** » sur les deux dernières lignes, décrit l'état du 31/07 au matin — il est
> conservé tel quel (le journal ne s'efface pas), mais **il ne décrit plus le produit**.
>
> **Conséquence directe à ne pas manquer** : la section « Ce n'est pas théorique : le cas est
> ouvert aujourd'hui » affirme que le porteur n'a « **aucun moyen légitime** de corriger sa
> propre base » et cite RC-2026-0007 / RC-2026-0008. **Il a ce moyen depuis le 31/07.**
>
> **Seconde affirmation périmée, dans le tableau « aval complet / amont manquant »** : la
> ligne « deux gardes lisant `periode.statut = 'verrouillee'` → **rien ne pose jamais ce
> statut** » est **fausse aujourd'hui**. `verrouillerPeriode`
> (`packages/db/src/depots/comptabilite.ts`) écrit ce statut, elle est exposée par
> `POST /periodes/:id/verrouiller` (`apps/api/src/routes/comptabilite.ts`) et appelée depuis
> `apps/web/src/pages/Comptabilite.tsx`. Voir la correction jumelle en D-063.
>
> **Ce que cela rouvre, et qu'un agent ne doit PAS refermer seul** : le raisonnement de la
> « Correction du même jour » plus bas — refuser l'avertissement préventif de verrou parce
> qu'il serait « un signal qui ne peut jamais être vrai » — reposait sur une prémisse qui
> **n'est plus vraie**. Le porteur peut désormais verrouiller une période, puis se heurter à
> un refus d'annulation sans avoir été prévenu. Le constat est posé ici ; l'arbitrage
> (avertir avant, ou continuer à ne traiter l'erreur qu'à la remontée) lui revient.
>
> Rien à corriger dans le code : les trois écrans existent et la suite est verte.

### Contexte

Le §3 règle 7 de `CLAUDE.md` est catégorique : « Corrections par écriture d'annulation
(`is_annule` + `annule_par_id`), jamais par `DELETE`. » Une vérification dérivée du code — et non
énumérée à la main (D-045) — confronte les routes d'annulation exposées par l'API aux appels
réellement émis par l'interface.

**Neuf routes d'annulation existent. Sept sont appelées par un écran. Deux ne le sont par aucun.**

| Objet annulable       | Route                             | Écran appelant               |
| --------------------- | --------------------------------- | ---------------------------- |
| Commande fournisseur  | `/commandes/:id/annuler`          | `Achats.tsx`                 |
| Mouvement de stock    | `/mouvements/:id/annuler`         | `saisie-stock/DetailLot.tsx` |
| Dépense               | `/depenses/:id/annuler`           | `Comptabilite.tsx`           |
| Facture               | `/factures/:id/annuler`           | `Factures.tsx`               |
| Objectif              | `/objectifs/:id/annuler`          | `Objectifs.tsx`              |
| Relevé de température | `/afsca/temperatures/:id/annuler` | `RegistreAfsca.tsx`          |
| Session de marché     | `/sessions/:id/annuler`           | `Sessions.tsx`               |
| **Production**        | `/productions/:id/annuler`        | **aucun**                    |
| **Réception**         | `/receptions/:id/annuler`         | **aucun**                    |

Les deux dernières ne sont pas des ébauches : service, contrat Zod, contrepassation des mouvements,
motif obligatoire, tests de route — tout est là. Le commentaire de `productions.ts:141` décrit même
précisément le défaut qu'elles corrigent. Il ne manque que le bouton.

### Pourquoi ce sont exactement les deux qui comptent le plus

Ce sont les **seules écritures qui créent ou consomment des lots**, donc les seules dont une erreur
se propage jusqu'au registre AFSCA :

- une **réception** saisie deux fois, ou avec un numéro de lot ou une DLC erronés, crée un lot
  fantôme qui entre dans le FEFO, fausse le stock, et apparaît au registre de traçabilité ;
- une **production** lancée par erreur consomme des lots qui ne l'ont pas été.

Les sept objets déjà annulables depuis l'interface sont comptables ou organisationnels. Les deux
oubliés sont **réglementaires**. L'ordre de câblage a été exactement l'inverse de l'ordre d'enjeu.

### Ce n'est pas théorique : le cas est ouvert aujourd'hui

Deux agents ont écrit dans la base réelle du porteur le 31/07/2026, y créant **RC-2026-0007 et
RC-2026-0008**, deux réceptions inexistantes qui ont consommé deux numéros de la séquence
documentaire. La seule correction conforme à la règle 7 est une écriture d'annulation motivée. Elle
est impossible depuis l'interface. Le porteur n'a donc, à cet instant, **aucun moyen légitime** de
corriger sa propre base.

### Choix

**Câbler les deux, sur le patron déjà établi** — motif obligatoire, confirmation explicite, écriture
d'annulation visible à côté de l'écriture annulée (D-083, tranché avec le porteur : les deux
restent lisibles, jamais l'une à la place de l'autre).

Ce n'est **pas une décision nouvelle** : c'est la seconde moitié d'une décision déjà prise et déjà
implémentée côté serveur. La seule question ouverte était de savoir si l'annulation devait exister —
elle est tranchée depuis la règle 7, et le code serveur l'applique.

### Conséquences

- Rend `nbMouvementsContrepasses` lisible par un humain, alors qu'il était classé « champ calculé que
  personne ne lit » (`docs/21-CHAMPS-NON-LUS.md`). **Ce n'était pas un champ oublié : c'était le
  symptôme d'une capacité entière jamais branchée.** Un champ non lu mérite qu'on demande _pourquoi_
  avant qu'on l'affiche.
- Débloque la correction de RC-2026-0007 / RC-2026-0008 par le porteur, avec un motif daté et
  auditable — la seule forme de correction que la règle 7 autorise.
- **Contrainte vérifiée dans le code, pas supposée** : annuler une réception dont un lot a déjà été
  consommé **est bien refusée**. Le contrôle n'est pas dans `annulerReception` mais un cran plus bas,
  dans `contrepasserMouvement` (`services/mouvements.ts:226`), posé par l'audit du 30/07/2026 : une
  contrepassation d'`entree` compare la quantité restante du lot à la quantité d'origine et lève
  `entree_deja_consommee` si elle est insuffisante. `annulerReception` ouvrant une transaction autour
  de la boucle, **le refus d'un seul lot annule toute la réception** — comportement correct, et pas
  un effet de bord.

  Le commentaire qui l'accompagne nomme précisément le danger évité : sans ce contrôle,
  l'annulation **écrivait quand même**, journalisait, avait l'air de réussir, et fabriquait une
  `quantite_restante` négative. « Une annulation qui semble fonctionner » est le pire des deux.

  Reste donc au câblage un travail d'**interface**, pas de service : ce refus doit arriver à l'écran
  en français, avec le nom du lot et la quantité manquante, pas en code d'erreur.

- **Un verrou de période rend l'annulation définitivement impossible**, sur les deux objets :
  `contrepasserMouvement` vérifie la période sur la date **du mouvement d'origine**, jamais sur
  aujourd'hui. Un exercice transmis au comptable ne se corrige donc plus du tout — conséquence
  assumée et déjà commentée dans le code.

  **Correction du même jour, quelques heures plus tard** : j'avais écrit ici « l'écran doit le
  **dire** au lieu de laisser un bouton qui échoue ». C'était faux, et dangereusement. Vérification
  dérivée du code : **`statut = 'verrouillee'` n'est écrit par AUCUN chemin de production** — seuls
  l'énum, le type, le contrat Zod et **deux gardes qui le lisent** existent. Il n'est posé qu'à la
  main, dans des fixtures de test. Construire l'avertissement préventif aurait donc fabriqué
  exactement le défaut qu'on venait de retirer de l'écran Fournisseurs : **un signal qui ne peut
  jamais être vrai**, et qui apprend à ignorer ceux qui le sont. Le traitement de l'erreur à la
  remontée reste juste et peu coûteux ; l'avertissement préventif, non.

### Le motif, généralisé — l'aval complet et l'amont manquant

Cette décision décrit un cas particulier de quelque chose qui s'est produit **quatre fois** en une
semaine, chaque fois découvert par accident, jamais par recherche :

| Aval complet, testé                                  | Amont manquant                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `POST /productions/:id/annuler`                      | aucun écran ne l'appelle                                                    |
| `POST /receptions/:id/annuler`                       | aucun écran ne l'appelle                                                    |
| `GET /prevision/brief`, `POST /ia/analyse-ecart/:id` | aucun écran ne les appelle — **les deux gestes hebdomadaires du `docs/01`** |
| deux gardes lisant `periode.statut = 'verrouillee'`  | **rien ne pose jamais ce statut**                                           |

**Ce qui rend ce motif invisible à toutes les vérifications du dépôt** : le typecheck compile, les
tests passent (l'aval est testé, et bien), le lint est muet, et aucun écran n'affiche d'erreur —
puisqu'aucun écran n'essaie. C'est un défaut qui ne produit **aucun symptôme**, seulement une absence.

**Conséquence méthodologique** : cet inventaire doit être **dérivé, périodique et systématique**,
jamais laissé au hasard des relectures. Trois dérivations suffisent, et elles ont chacune trouvé du
neuf : la table de routage réelle de Fastify confrontée aux appels de `apps/web/src` ; les symboles
exportés de `packages/core` confrontés à leurs importateurs ; et — celle que personne n'avait faite —
**les valeurs d'énum lues par une garde, confrontées aux endroits qui les écrivent.**

---

## D-088 — Le « champ mort côté écriture » : une quatrième catégorie, découverte en balayant les champs que personne ne lit

**Date** : 31/07/2026 · **Statut** : appliquée

### Contexte

Le balayage des champs de sortie jamais lus par un écran (`docs/21-CHAMPS-NON-LUS.md`) reposait sur
une typologie à trois cas : le champ **utile non câblé** (à corriger), le champ **délibérément
absent** (commenté comme tel), et le **faux positif** — dont l'homonyme (§11 de la note de périmètre)
et le **faux positif narratif**, où l'information est déjà dite en toutes lettres sans que le nom du
champ n'apparaisse.

La dernière passe en a trouvé une quatrième, absente de cette typologie.

### Le cas

Trois champs sont de vrais champs de contrat, correctement calculés, jamais faux — et **aucun chemin
d'écriture actuel ne leur donne jamais autre chose que leur valeur par défaut** :

| Champ                               | Vaut toujours | Pourquoi                                   |
| ----------------------------------- | ------------- | ------------------------------------------ |
| `dateFinValidite`                   | `null`        | rien ne l'écrit jamais                     |
| `dateReceptionPrevue`               | `null`        | rien ne l'écrit jamais                     |
| `genereAutomatiquement` (commandes) | `true`        | aucune route de création manuelle n'existe |

Un quatrième, `genereLe` (prévision calendaire), est **tautologique** : fixé à `maintenantIso()` à
chaque requête, sans cache, il vaut toujours « à l'instant ».

Les afficher n'aurait montré **qu'un tiret ou une constante** — jamais une information.

### Choix

**Ne pas les câbler, et nommer la catégorie plutôt que de bricoler un motif au cas par cas.**

La distinction qui compte : un champ **non lu** est un défaut d'interface, un champ **mort côté
écriture** est un défaut d'amont — soit la capacité qui devait le remplir n'a jamais été construite,
soit elle n'existera jamais. **Câbler l'affichage d'un champ mort le rend pire**, parce qu'un tiret
permanent à l'écran ressemble à une donnée manquante qu'on pourrait saisir.

### Conséquences

- **Un champ non lu mérite qu'on demande _pourquoi_ avant qu'on l'affiche.** La question « ce champ
  est-il lu ? » a une réponse mécanique ; la question « qu'est-ce qui empêche cette valeur
  d'exister ? » a une réponse qui change ce qu'on fait.
- C'est exactement le raisonnement qui a fait remonter **D-087** : `nbMouvementsContrepasses` était
  classé « champ non lu », alors que sa vraie nature était **le symptôme d'une capacité entière
  jamais branchée** — deux routes d'annulation qu'aucun écran n'appelait. Le champ mort et la
  capacité débranchée sont deux formes du même diagnostic : _l'amont manque, pas l'aval_.
- Différence de traitement entre les deux, et elle est nette : `nbMouvementsContrepasses` a été
  câblé, parce que la capacité manquante **devait exister** (§3 règle 7). Les trois champs
  ci-dessus ne le sont pas, parce que rien n'établit que la leur doive exister. **La catégorie ne
  dit pas quoi faire ; elle dit quelle question poser.**
- À reporter dans `docs/21-CHAMPS-NON-LUS.md` comme quatrième cas de la typologie, avant le prochain
  balayage. Sans ça, le prochain passage les recomptera comme défauts.

---

## D-089 — La validation croisée du moteur voyait l'avenir, et rejetait donc les prédicteurs de tendance

**Date** : 01/08/2026 · **Statut** : appliquée, **changement de calcul assumé**

### Contexte

`validerParLeaveOneOut` retire un point de l'échantillon **par index**
(`echantillon.filter((_, index) => index !== i)`), sans jamais trier ni filtrer par date. L'historique
qui en résulte contient donc, pour tout point qui n'est pas le dernier chronologiquement, des sessions
**postérieures** au point retiré.

Cet historique était transmis tel quel à `calculerBaseline`, dont `poidsTemporel` donnait le poids
**maximal** — celui d'« aujourd'hui » — à toute session d'âge négatif, c'est-à-dire à toute session
future.

C'est une **fuite d'information** au sens classique : le modèle de référence connaissait la réponse.

### La mesure, pas le raisonnement

Sur dix sessions passées à 150 crêpes, ajouter **une seule** session future à J+14 valant 900 crêpes
faisait passer la baseline de **143 à 205** crêpes, et `poidsPriorBp` de 2000 à 1875 bp. Après
correction, les deux résultats sont **strictement identiques** avec et sans la session future.

### Pourquoi ça ne se voyait pas

Le calcul **réellement servi** au porteur ne reçoit que des sessions **closes et passées** — un
commentaire du code le dit déjà en toutes lettres. Le correctif y est un **no-op prouvé**.

La contamination ne touchait donc que le **contexte leave-one-out**. Mais celui-ci ne calcule pas la
prévision : **il décide quels prédicteurs sont utilisés**. Un prédicteur candidat devait battre une
référence qui avait triché — donc le modèle restait plus bête qu'il ne devait l'être, en permanence.

### Ce que ça change, chiffré

| Jeu de données                                  | Avant : amélioration / admis | Après : amélioration / admis |
| ----------------------------------------------- | ---------------------------- | ---------------------------- |
| Rampe linéaire (40 sessions, +3 crêpes/semaine) | **−317 bp** / **rejeté**     | **+1052 bp** / **admis**     |
| Rampe exponentielle (+2 %/semaine)              | **−249 bp** / **rejeté**     | **+1038 bp** / **admis**     |
| Saison (janvier 2,5× juillet, 4 ans)            | +4625 bp / admis             | +4290 bp / admis             |

Le prédicteur de **tendance passe de rejeté à admis** sur une simple rampe — le symptôme exact qu'un
agent précédent avait décrit et **contourné** en fabriquant une forme de données artificielle
« plateau puis accélération » pour obtenir une admission.

### Choix

**Corriger `calculerBaseline`, la fonction partagée**, plutôt que chacun de ses appelants. Elle ferme
le défaut d'un coup dans les cinq prédicteurs de précision, la saison, la tendance **et**
`packages/db/src/scripts/backtest.ts` — qui reproduit exactement le même `filter` par index — sans
jamais toucher au chiffre servi par le calcul direct.

### Conséquences

- **Deux tests d'intégration sont tombés**, et c'est le comportement attendu : ils décrivaient une
  admission qui **dépendait de la contamination**. Ils ne se « réparent » pas en baissant un seuil —
  la question posée est **pourquoi** ils tombent : le jeu de test contenait-il un vrai signal
  hebdomadaire, ou passait-il pour la mauvaise raison ?
- **Un cas voisin reste ouvert et n'a PAS été touché** : `saison.ts` porte sa **propre** fonction de
  pondération temporelle (`poidsRecence`), dupliquée de celle de `baseline.ts` et **non filtrée par
  date non plus**. Même défaut de fond, hors du périmètre nommé — à traiter, et la duplication
  elle-même est la cause : une règle écrite deux fois se corrige une fois sur deux.
- **Ce qui n'est PAS mesuré** : l'effet sur la base réelle du porteur. Les chiffres ci-dessus viennent
  de jeux synthétiques. L'ampleur du changement d'admission sur son historique réel reste inconnue
  tant qu'il n'a pas été rejoué — et c'est lui qui décide combien de litres de pâte produire.

### Complément du 01/08/2026 — la fuite était dans QUATRE modules, et dans leurs tests

Le balayage systématique — dérivé, pas énuméré — a confronté les sept modules du moteur qui
appliquent une pondération par récence. **Quatre portaient la même fuite**, pas un :

| Module                     | Copie de la pondération | Appelée en leave-one-out | Verdict                                                                  |
| -------------------------- | ----------------------- | ------------------------ | ------------------------------------------------------------------------ |
| `baseline.ts`              | canonique               | —                        | corrigé par D-089                                                        |
| `saison.ts`                | oui                     | oui                      | **actif**                                                                |
| `jour-semaine.ts`          | oui                     | oui                      | **actif, et mesuré**                                                     |
| `vacances-scolaires.ts`    | oui                     | oui                      | **actif**                                                                |
| `session-consecutive.ts`   | oui (calibration)       | oui                      | **actif**, limité                                                        |
| `comparable-calendaire.ts` | non (formule propre)    | oui                      | **sain** — sa garde d'âge minimum exclut structurellement un âge négatif |
| `tendance.ts`              | non                     | —                        | **sain** — filtre déjà sur la date                                       |

**Choix** : unifier pour les quatre, en exportant `ageEnJours` et `poidsTemporel` depuis
`baseline.ts`. La **valeur** de demi-vie reste propre à chaque configuration — on partage la
formule, pas le réglage : si la saison a un jour besoin d'une autre demi-vie, rien ne l'en empêche.

`comparable-calendaire.ts` est **laissé intact, avec la raison écrite à côté** : sa demi-vie se
compte en **années**, pas en jours, et sa garde d'âge minimum la protège déjà. Le fusionner
n'aurait rien simplifié — seulement couplé deux échelles de temps différentes. **Deux règles qui se
ressemblent ne sont pas la même règle.**

### Ce qui rend ce complément intéressant : les TESTS portaient la même fuite

Quatre tests existants sont tombés. Pour chacun, la question posée était « décrivait-il le bon
comportement ? » — et **la réponse a été non, quatre fois sur quatre** :

- deux fixtures utilisaient des données **postérieures** à leur propre date cible comme « passé » ;
- deux autres plaçaient la cible juste après la première occurrence d'un cycle, sans qu'aucune
  occurrence antérieure n'existe pour calibrer.

Autrement dit, **les tests reproduisaient l'erreur qu'ils étaient censés surveiller**. C'est le mode
d'échec le plus discret d'un jeu de données de test : il ne ment pas sur le résultat, il ment sur la
situation. Un test vert sur une fixture impossible ne prouve rien — et rien ne le signale.

### Un reste, structurel et assumé

Deux tests d'intégration restent rouges, et la cause est **dérivée, pas supposée** : les trois
mercredis de leur fixture sont tous très récents (0 à 14 jours), donc pour la quasi-totalité des
dimanches passés, **aucun mercredi n'existait encore honnêtement** au moment évalué. Le seuil de
jours distincts échoue pour tous les points sauf un.

Ce n'est pas un défaut du correctif : c'est une **propriété de la fixture, rendue visible par la
fermeture de la fuite**. Confirmé par mesure — ajouter des dimanches ne change rien, jusqu'à quinze.
La réponse est d'**étaler les mercredis sur la même période**, jamais de baisser le seuil : le
signal est réel (150 crêpes contre 40), c'est l'échantillonnage qui ne l'est pas.

> ### ⚠️ Mise à jour du 01/08/2026 — les deux tests ne sont plus rouges
>
> La section ci-dessus décrit « **deux tests d'intégration restent rouges** » comme un reste
> structurel assumé. **La suite est aujourd'hui entièrement verte** : `npx vitest run` (suite
> complète, non filtrée) rend **198 fichiers, 3 635 tests, 0 échec**. Vérifié aussi que ce vert
> n'est pas obtenu par désactivation : aucun `it.skip(`, `describe.skip(`, `test.skip(` ni
> `.todo(` dans `packages/` et `apps/` (recherche dérivée, exit 1).
>
> La correction recommandée par cette entrée — **étaler les mercredis** plutôt que baisser le
> seuil — est celle qui a été appliquée : `packages/core/src/prevision/jour-semaine.test.ts`
> construit désormais huit mercredis répartis à la semaine (`jourPlus('2026-01-07', 7 * i)`)
> au lieu de trois mercredis tous récents. Le seuil de jours distincts n'a pas bougé.
>
> Réserve de portée, qui vaut pour tout ce paragraphe : un test vert ne prouve pas qu'il pouvait
> échouer. Cette entrée démontre elle-même que **quatre fixtures reproduisaient l'erreur qu'elles
> surveillaient** ; le vert d'aujourd'hui n'est pas une garantie que les fixtures restantes
> décrivent des situations possibles.

---

## D-090 — L'application n'a AUCUN ordonnanceur, et c'est un choix : tout se déclenche à la main

**Date** : 01/08/2026 (consignée après coup) · **Statut** : appliquée depuis l'origine, jamais écrite

### Contexte

Le §9 de `CLAUDE.md` exige que « toute décision d'architecture nouvelle » soit consignée ici. Celle-ci
ne l'avait jamais été — repérée le 01/08 en confrontant les fiches d'amélioration au code réel.

`docs/demandes/05` demande une **tâche planifiée hebdomadaire** pour la découverte d'événements.
`apps/api/src/routes/evenements-decouverte.ts:5-14` a dévié, avec un raisonnement écrit dans le
code, mais aucune entrée ici.

### Le fait, vérifié par dérivation

**Ce projet n'a aucun ordonnanceur** : aucune dépendance de type cron, aucun processus d'arrière-plan,
aucune tâche récurrente. Rien, nulle part.

### Choix

**On n'en ajoute pas.** Tout ce qui pourrait être périodique se déclenche par un geste explicite :
un bouton « Chercher des événements » par lieu, un rafraîchissement de météo, un recalcul de
prévision à la demande.

**L'argument qui a été écrit dans le code, et qui vaut au-delà de cette fiche** : ajouter un
ordonnanceur pour une seule fonctionnalité serait **la première pièce d'une infrastructure que rien
d'autre n'utilise**. Un processus d'arrière-plan sur un poste de bureau, ce sont des questions
nouvelles — que fait-il quand l'application est fermée, quand la machine dort, quand deux instances
tournent ? — pour un bénéfice qu'un clic hebdomadaire rend nul.

### Cohérence avec le reste

- **§5** : « l'IA est un confort, jamais une dépendance ». Un déclenchement manuel garantit qu'aucun
  appel payant ne part sans qu'on l'ait voulu. Un ordonnanceur ferait exactement l'inverse.
- **§2** : « coût d'infra visé 0 €/mois, tout tourne en local ». Un ordonnanceur suppose un processus
  qui vit — c'est le premier pas vers un serveur qu'on héberge.
- **§1** : l'application s'ouvre avant et après le marché. Un traitement qui s'exécuterait pendant
  qu'elle est fermée n'a personne à qui parler.

### Conséquences

- **Ce qui est perdu, et qu'il faut dire** : rien ne prévient tout seul. Une échéance qui approche,
  un événement découvert, une DLC — tout se voit **quand on ouvre l'application**, jamais avant.
  C'est acceptable pour deux personnes qui l'ouvrent chaque semaine ; ça cesserait de l'être si
  l'activité devenait quotidienne.
- **Ce qui est gagné** : aucune dépendance, aucun processus fantôme, aucun appel Claude involontaire,
  et un mode dégradé qui reste trivialement vrai.
- **Le jour où un ordonnanceur deviendra nécessaire**, cette décision devra être rouverte
  explicitement — et la première question sera « que fait-il quand l'application est fermée ? »,
  pas « quelle bibliothèque ».

---

## D-091 — La cible de résolution était FAUSSE : 1080p responsive, pas 1280 × 720

**Date** : 01/08/2026 · **Statut** : appliquée — `docs/07` §4.4 corrigé en place

### Contexte

`docs/07-DOCTRINE-ERP-ET-DESIGN.md` §4.4 posait depuis l'origine :

> « Concevoir pour 1280 × 720, jamais pour 1920 × 1080. »

Cette règle a été appliquée toute la journée du 01/08 à une vingtaine d'agents, et elle a servi
d'argument pour **refuser du contenu** au tableau de bord. Le porteur l'a corrigée :

> « la cible de visibilité est **1080p** mais **responsive pour 100 % de l'app** — l'app doit
> s'adapter à mes écrans : **1280, 1080 et 1440** »

Et il a ajouté : « je te l'avais déjà demandé ». **Il avait raison** :
`docs/demandes/02-RESPONSIVE-1080P-1440P.md` le demandait déjà, et la doctrine la contredisait.

### D'où venait l'erreur — elle mérite d'être disséquée

Le raisonnement d'origine partait d'un **fait exact** : Windows tourne couramment à 125–150 %, donc
un écran 1920 × 1080 à 150 % donne bien un viewport CSS réel de 1280 × 720.

**Le fait est vrai. La conclusion ne l'était pas.** Elle transformait **le pire cas en cible unique**,
puis servait de justification à des refus. Deux erreurs empilées : une mauvaise cible, et une
mauvaise conséquence tirée de la mauvaise cible.

### Choix

**Concevoir pour 1920 × 1080**, et rester **pleinement utilisable** sur les trois résolutions réelles
du porteur : **1280 de large**, **1920 × 1080**, **2560 × 1440**. Ce n'est plus un point à respecter,
c'est un **intervalle à couvrir**.

### Ce qui reste vrai, et qu'il ne faut pas jeter avec la règle

La mise à l'échelle existe réellement. Un `devicePixelRatio` de 1,25 transforme un « 1280 × 720
demandé » en **1024 × 576 réel** — et un audit s'y est déjà trompé, déclarant 19 écrans cassés à tort
pour avoir mesuré la taille du fichier PNG au lieu du viewport.

**Toute vérification visuelle mesure `document.documentElement.clientWidth`**, jamais la taille
demandée. **C'est un piège de MESURE, pas une règle de CONCEPTION** — et c'est précisément parce que
les deux vivaient dans le même paragraphe qu'ils ont été confondus.

### Conséquences

- **« La hauteur est la ressource rare » cesse d'être un principe général.** C'est vrai à 1280 × 720
  (~640 px utiles, 16 rangées) et **faux à 1080 comme à 1440**. La densité reste une qualité sur un
  écran de **saisie** ; elle ne peut plus servir à refuser du contenu.
- **Le tableau de bord devient explicitement un COCKPIT** (règle posée le même jour) : « toutes les
  données sous la main au même endroit », en **grille bento pleine page**. Mesuré ce jour-là : la
  fenêtre du porteur fait **2 552 px CSS**, et l'écran n'occupait que la moitié gauche, moitié basse
  vide.
- **Le critère de fin de la fiche 02 devient la seule preuve possible** : des captures automatisées
  aux trois résolutions. **Il n'existe pas** — aucun test de rendu multi-résolution dans le dépôt.
  Tant qu'il manque, une capture manuelle **aux trois largeurs** est la seule vérification valable.

---

## D-092 — Un tableau de bord montre ce qui a BOUGÉ, pas ce qui EST : la veille concurrentielle rendue actionnable

**Date** : 01/08/2026 · **Statut** : appliquée — ~~route et contrat livrés, affichage en
cours~~ → **route, contrat ET affichage livrés** (corrigé le 01/08/2026)

> **Correction de statut du 01/08/2026.** « Affichage en cours » n'est plus vrai :
> `apps/web/src/pages/TableauDeBord.tsx` définit `SectionMouvementsConcurrents` **et la rend
> dans le JSX de la page**, avec ses trois fonctions pures de résumé
> (`resumeMouvementsConcurrents`, `phraseResumeMouvementsConcurrents`,
> `compterMouvementsParStatut`) et la lecture de `GET /concurrents/mouvements`
> (`apps/api/src/routes/concurrents.ts`). `apps/web/src/pages/TableauDeBord.test.tsx` est vert.
>
> Réserve de portée, à ne pas confondre avec ce qui précède : cette vérification prouve que le
> composant est **monté**, jamais qu'il est **lisible** — c'est la distinction que D-081 pose
> lui-même, et elle ne se mesure qu'au navigateur.

### Contexte

Le porteur a demandé que les **concurrents** figurent au tableau de bord. La capacité existante,
`GET /concurrents/comparateur`, ne rend que **le dernier prix relevé par produit**. Un agent l'a
établi et a refusé de bâtir dessus : le mouvement — « 2 concurrents ont augmenté leurs prix » —
**n'était pas calculable**.

### Pourquoi une liste ne suffisait pas

**Le porteur connaît déjà ces prix : c'est lui qui les a saisis.** Les lui réafficher n'ajoute rien.
Ce qui change ce qu'il fait, c'est qu'un prix ait **bougé depuis son dernier relevé** : un concurrent
qui passe de 3,50 € à 4,00 € lui ouvre une marge de manœuvre, un qui baisse lui pose une question.

C'est la doctrine du tableau de bord tout entier, formulée ici pour la première fois :
**il affiche ce qui demande une décision, jamais un état qu'on peut aller consulter.**

### La question qui commandait tout, posée avant de coder

**Le modèle conserve-t-il un historique de prix par produit concurrent ?** Si un seul prix était
retenu par produit, le mouvement était **structurellement incalculable** et la réponse aurait été une
décision de modèle, pas un câblage.

**Il existait.** `concurrent_produit` n'est jamais mise à jour — chaque relevé est un `INSERT` — et un
index `idx_concurrent_produit_historique(concurrent_id, nom_produit, date_observation)` avait été posé
exactement pour cette projection. Il ne manquait que la requête qui compare l'avant-dernier au
dernier.

### Choix

`GET /concurrents/mouvements`, comparant par couple (concurrent, produit) les **deux relevés les plus
récents de ce produit**, pour les concurrents actifs. Quatre statuts : `hausse`, `baisse`, `stable`,
`nouveau`.

### Trois distinctions qui sont le fond de la décision

- **`stable` n'est pas un vide.** Le prix n'a pas bougé, `ecartCents` vaut `0`, et **ce zéro est
  vrai** : c'est une information vérifiée.
- **`nouveau` n'est pas `0`.** Un seul relevé, ou un produit apparu depuis : l'écart est **inconnu**,
  donc `null`. L'afficher en `0 €` se lirait « prix inchangé » — le mensonge exact que ce dépôt
  traque partout (règle « la valeur inconnue vaut `null`, jamais `0` »).
- **Un prix précédent de `0` ne donne pas un pourcentage.** Une dégustation gratuite devenue payante
  fait une division par zéro ; `ecartBp` vaut alors `null` plutôt que le `0` silencieux qu'aurait
  rendu le ratio. Garde non demandée, ajoutée par l'agent.

**Les deux dates comparées sont rendues.** Un mouvement mesuré entre deux relevés espacés de six mois
ne vaut pas celui d'une semaine, et un audit avait déjà relevé qu'on ne voit nulle part qu'une fiche
concurrent est devenue périmée. L'ancienneté se calcule à l'écran avec `joursEntre` — elle n'est pas
dupliquée dans l'API.

### Conséquence de méthode, confirmée dans l'heure

La route neuve **n'était pas** dans le balayage de fuite de secrets de `integration.test.ts`. Ce n'est
pas une relecture qui l'a vu : c'est le **test de couverture** de ce balayage, qui dérive la liste des
routes montées au lieu de la lire (D-045). Signalée et corrigée le jour même. **Ce test est le seul
mécanisme du dépôt qui rende une route neuve impossible à oublier.**

---

## D-093 — Un refus de clôture bloque la journée entière : les deux coûts sont établis, le choix revient au porteur

**Date** : 01/08/2026 · **Statut** : **ouverte** — le message a été corrigé, le comportement non

### Contexte

Un menu dont les **prix désignés** dépassent le prix pratiqué (typiquement après une remise
exceptionnelle) fait échouer `cloturerSession` en entier. Le message disait :

> « La somme des prix imposés (380 c) dépasse déjà le prix du menu (300 c). »

Ni quel menu, ni quels composants, ni comment s'en sortir — et des centimes bruts.

### Ce qui a été corrigé, et qui ne prête pas à discussion

Le message nomme désormais le menu, les composants porteurs d'un prix désigné, ce qui ne reçoit plus
rien, et les **deux sorties** (corriger le prix pratiqué de cette vente, ou le prix désigné dans la
fiche du menu) — le tout en euros. Le nom du menu vient des deux appelants de `ventilerMenu`, qui
l'avaient déjà en portée sans le transmettre.

### Ce qui reste ouvert, et pourquoi ce n'est pas à un agent de le trancher

**Aujourd'hui** : une seule ligne de vente incohérente empêche d'enregistrer **toute** la journée —
les autres ventes, le rapprochement de caisse, les relevés de température, les entrées AFSCA. Rien
n'est perdu en silence, mais rien n'est enregistré non plus tant qu'il n'a pas corrigé.

**L'alternative** — refuser la seule ligne fautive en la nommant et clôturer le reste — lui rendrait
sa soirée, mais marquerait la session `'cloturee'`, donc **pièce comptable figée**, **amputée** du CA,
de la consommation de stock et de la contribution aux seuils de cette vente. Il faudrait alors
inventer un mécanisme pour compléter après coup une session réputée immuable : exactement le risque
d'écriture partielle que la règle 7 existe pour empêcher, et un mode de défaillance qui n'existe pas
aujourd'hui.

**Les deux se défendent. C'est un arbitrage d'atomicité comptable, pas une question technique.**
À poser au porteur, avec ces deux coûts.

## D-094 — La pâte n'est pas un article de stock, et « déduire du stock » ne pouvait donc pas vouloir dire écrire un mouvement

**Date** : 01/08/2026 · **Statut** : appliquée — ~~moteur corrigé, un reste côté écran
(tâche #141)~~ → **moteur ET dépôt corrigés** (corrigé le 01/08/2026)

> **Correction de statut du 01/08/2026.** La section « Ce qui reste, et pourquoi c'est le
> même défaut » affirme que « `depots/recettes.ts::coutRevientProduit` **ne passe pas encore**
> les nouveaux arguments au moteur » et que « **l'écran affiche toujours `0`** ». **Ce n'est
> plus vrai** : `packages/db/src/depots/recettes.ts::coutRevientProduit` passe aujourd'hui les
> trois champs à `coutProduitVendu` — `estPateVendueAuVolume`, `coutParMlCents` et
> `volumeMlParUnite`. Le commentaire posé juste au-dessus date lui-même le correctif :
> « TROU CORRIGE (mission « un correctif qui n'arrive pas jusqu'a l'ecran ne corrige rien »,
> 01/08/2026) ».
>
> **Ce qui reste vrai, et qu'il ne faut pas corriger par excès de zèle** : la « Limite connue
> et assumée » ci-dessous tient — seul le mode de clôture « volume restant » maintient
> l'invariant `volumeRestant + volumeVenduEnBouteille + volumeCuitEnCrêpes = volumeProduit`.
> En mode « crêpes », rien ne retranche automatiquement la pâte embouteillée du compte de
> crêpes de la production.

### Contexte

Un produit de nature **`volume_pate`** (une bouteille de pâte vendue au litre plutôt que cuite en
crêpes) portait **deux** défauts, tous deux reproduits en rouge avant correction :

1. **Coût toujours nul.** `coutProduitVendu` calculait `coutPateCents = coutParCrepeCents ×
nbCrepesParUnite`, et `nbCrepesParUnite` vaut **0** pour ce type de produit. Une bouteille dont la
   matière vaut 33 c/crêpe ne coûtait donc que son bouchon (8 c) : **marge de 100 %** sur sa propre
   part.
2. **Volume jamais retenu.** `ventesPourVolumePate` codait `volumeMlParUnite: null` **en dur**. La
   colonne `produit_vente.volume_ml_par_unite` existait depuis D-085 et **n'était lue nulle part**.

### Ce qui a été établi avant de coder, et qui a changé la nature du correctif

**La pâte n'est PAS un stock.** Aucune catégorie d'ingrédient « pâte », aucun `lot`, aucun
`mouvement_stock` pour elle. Elle n'existe que comme **agrégats sur `production`**
(`volumeTheoriqueMl` / `volumeReelMl`, `coutMatiereTheoriqueCents` / `coutMatiereReelCents`) : un bac
comptable, pas un article de stock avec ses propres mouvements.

**Conséquence directe** : « faire consommer le volume au stock » ne pouvait pas signifier écrire un
mouvement de pâte. Les ingrédients sont **déjà sortis à la production** — un mouvement de plus aurait
été un **double comptage**, pas un correctif.

C'est le genre de vérification qui décide de tout : formulée à partir de l'énoncé du défaut, la
correction « évidente » aurait aggravé les chiffres au lieu de les réparer.

### Choix

- **Lire réellement `volume_ml_par_unite`**, ce qui alimente la retenue déjà existante dans
  `resoudreCrepesDepuisVolumeRestant`.
- **Partager** le coût réel **déjà connu** de la production entre pâte embouteillée et crêpes
  (`repartirCoutProductionEntrePateVendueEtCrepes`), via `repartir()` : un seul arrondi, dernière part
  dérivée par soustraction. **Rien n'est recalculé depuis la recette, rien n'est écrit.**

### Preuve du non-double-comptage, par renversement délibéré

En rétablissant l'ancienne formule, le coût matière d'une session passait de **12 800 c** à **17 920**
puis **25 600** — le double comptage confirmé en le provoquant, avant restauration. Un test qui
affirme l'absence de double comptage sans jamais l'avoir provoqué ne prouve rien.

**Invariant vérifié en pur et en base** :
`volumeRestant + volumeVenduEnBouteille + volumeCuitEnCrêpes = volumeProduit`.

### Ce qui reste, et pourquoi c'est le même défaut

`depots/recettes.ts::coutRevientProduit` ne passe pas encore les nouveaux arguments au moteur. **Le
moteur est juste et l'écran affiche toujours `0`** — donc toujours 100 % de marge, là où le porteur
regarde. Un correctif qui n'arrive pas jusqu'à l'écran n'a rien corrigé.

**Limite connue et assumée** : seul le mode de clôture « volume restant » tient l'invariant. En mode
« crêpes », rien ne retranche automatiquement la pâte embouteillée du compte de crêpes de la
production.

## D-095 — `jsdom` et Testing Library installés : la couverture affichée regardait un paquet sur quatre

**Date** : 01/08/2026 · **Statut** : appliquée — configuration livrée, écriture des tests en cours

### Contexte

`vitest.config.ts` limitait `coverage.include` à `packages/core/src/**`, au motif que CLAUDE.md §4 y
fixe la cible de 80 % et laisse « le reste au jugement ». Le chiffre affiché — **98,81 %** — était
donc **exact et trompeur** : il ne regardait qu'un paquet sur quatre.

Mesure du 01/08/2026 sur les quatre :

| Zone                | Instructions | Manquantes |
| ------------------- | ------------ | ---------- |
| `apps/web/src`      | **18,13 %**  | 23 555     |
| `packages/db/src`   | 91,92 %      | 1 191      |
| `apps/api/src`      | 92,73 %      | 489        |
| `packages/core/src` | 98,81 %      | 108        |
| **Total**           | **57,28 %**  | 25 343     |

**« Le reste au jugement » veut dire que le seuil est plus bas ailleurs, pas que le reste est
invisible.** Une mesure dont on ignore le périmètre ne mesure rien — c'est la leçon déjà consignée
sur les portes de sortie, appliquée cette fois à la couverture elle-même.

### La cause n'était pas la paresse

93 % du manque est dans `apps/web`, et c'était **structurel**. Sans DOM, `renderToStaticMarkup` rend
un composant **une** fois, dans son état initial : aucun `useEffect`, aucun clic, aucune touche,
aucune transition. **Tout ce qui se passe après le premier rendu était hors de portée de tout
test** — y compris la règle n°10 (« chaque écran doit être utilisable au clavier »), qui ne se
vérifiait qu'à la main, écran par écran, capture par capture.

### Choix

**Installer `jsdom`, `@testing-library/react`, `@testing-library/user-event` et
`@testing-library/jest-dom`**, en dépendances de développement — jamais livrées au navigateur.
CLAUDE.md §7 exige une validation explicite du porteur pour toute dépendance ; elle a été demandée
et donnée le jour même.

**Deux projets Vitest, et non un environnement unique.** Basculer globalement en `jsdom` aurait été
une faute : `packages/db` ouvre `better-sqlite3`, `apps/api` monte Fastify et lance Chromium —
aucun n'a besoin d'un DOM, et tous paieraient le coût de son amorçage à chaque fichier.

Le découpage dit aussi quelque chose de vrai sur le produit : **la logique métier chiffrée (§3
règle 1) n'a jamais besoin d'un navigateur pour être prouvée.** Si un test de `packages/core`
réclamait un jour un DOM, ce serait le signe que du calcul a fui dans l'interface.

### Ce que ça ne change pas

**Les tests existants en `renderToStaticMarkup` restent valables et ne sont pas à réécrire.** Ils
prouvent le balisage rendu, ce qui reste la bonne façon de vérifier une structure de tableau ou un
attribut d'accessibilité. Le montage réel **s'ajoute** pour ce qu'eux ne pouvaient pas voir.

### Seuils

Seuils globaux posés **bas** (55 / 65 / 55) : garde-fou anti-régression, **pas objectif**. La cible
de 80 % de CLAUDE.md §4 reste posée sur `packages/core`, où elle est tenue à 98,81 %. À relever au
fur et à mesure — **jamais à baisser pour faire passer une suite**, ce qui désarmerait le garde-fou
en croyant le réparer.

### Réserve à porter au porteur

**100 % d'instructions sur trente écrans React n'est pas un objectif qui vaut son prix.** Ce qui
compte est que chaque **décision** et chaque **flux** soient couverts. Le chiffre sera mesuré et
rapporté tel quel, jamais arrondi vers le haut.

---

## D-096 — Le coût matière RÉEL était calculé, persisté, facturé — et exposé par aucune route

**Date** : 01/08/2026 · **Statut** : appliquée — corrigée dans l'heure de sa découverte

### Le défaut

`production.cout_matiere_reel_cents` était **écrit** par `saisirRealise`, **lu** par la clôture de
session — qui facturait donc bien le coût réel à la marge du marché — et **rendu par aucune route de
lecture** : ni `lireProductionDetail`, ni `listerProductions`, ni les contrats Zod correspondants.

Conséquence mesurée : l'écran Production affichait le coût **théorique**, la comptabilité de session
facturait le coût **réel**, et l'écart entre les deux n'était visible nulle part.

CLAUDE.md §0 range « écart théorique/réel » parmi les modules du produit. **L'écart de rendement
était exposé (`ecartRendementBp`) ; l'écart de coût, non.** La moitié du module manquait.

### Pourquoi seul un parcours de bout en bout pouvait le trouver

**Aucun test unitaire de `saisirRealise` ne pouvait le voir : la valeur EST bien écrite en base.**
Aucun test de contrat non plus : le contrat était cohérent avec lui-même. Il fallait un scénario qui
saisisse un réalisé, clôture la session, **puis relise la production** — c'est-à-dire traverser
trois modules que rien n'oblige à se parler.

C'est la sixième instance du motif « maillon correct qui n'est branché à rien », et la première
trouvée par un parcours plutôt que par un audit.

### Le `it.fails` a fonctionné exactement comme prévu

L'agent qui l'a trouvé ne pouvait pas le corriger — la correction vivait hors de sa zone. Il l'a
donc encodé en **`it.fails`** avec la description du défaut. Dès le champ ajouté au contrat et au
dépôt, ce test est **passé au rouge** (« Expect test to fail ») et a signalé de lui-même qu'il
devait redevenir un test ordinaire.

**Un commentaire, lui, se serait périmé en silence.** C'est l'argument en faveur de cette convention,
et il vient d'être démontré plutôt que supposé.

### Ce qui reste ouvert

`coutCents` de chaque **ligne de consommation** reste théorique à côté d'une `quantiteReelle`. Le
total est désormais juste ; **le détail ligne à ligne, non** — une quantité et un coût qui ne se
correspondent pas.

## D-097 — Le grand livre est la source unique du coût réel et de la traçabilité, `production_consommation` ne dit que le prévu

**Date** : 01/08/2026 · **Statut** : appliquée

### Les deux défauts, et leur cause commune

**1. Corriger deux fois le réalisé effaçait l'écart matière.** `saisirRealise` recalculait
`cout_matiere_reel_cents` **à partir de zéro** à chaque appel, en accumulant
`production_consommation.cout_cents` — resté **théorique à vie**. Or seule `consommationsReelles`
était refusée une seconde fois : **corriger le seul nombre de crêpes suffisait donc à effacer l'écart
matière**, un geste anodin qu'on fait en se relisant.

Le chiffre mesuré : **1 536 c de matière réellement sortie facturés 1 223 c**, soit **313 c minorés
sur une seule fournée**. Et ce qui en faisait une perte d'argent réelle plutôt qu'un affichage
faux : `cloturerSession` facture `p.coutReel ?? p.cout` — c'est ce `??` qui portait le mensonge
jusqu'à la marge du marché.

**2. Le lot d'une sur-consommation manquait à la traçabilité.** `tracabiliteAvalLot` partait de
`production_consommation`, écrite **au lancement**. Quand la matière supplémentaire est prise en FEFO
sur le stock du jour, elle peut tomber sur un lot absent de la fournée d'origine. Ce lot a réellement
alimenté la pâte, et un rappel du meunier ne l'aurait **pas retrouvé** — `CLAUDE.md` §3 règle 6.

**La cause est la même** : `production_consommation` dit ce qui était **prévu**, le grand livre dit
ce qui est **sorti**. Faire dire au premier ce que seul le second sait produit deux vérités qui
divergent.

### Choix

**Le grand livre (`mouvement_stock`) devient la source unique**, dans les deux cas, avec les mêmes
deux filtres : `production_id = ?` et `ajustement = false`, le signe porté par le type de mouvement.

`production_consommation` reste lue pour le **théorique** et la **quantité déclarée** — qu'aucun
mouvement ne porte — mais **ne décide plus quels lots existent**. L'ensemble des lots est l'**union**
grand livre ∪ `production_consommation`, jamais un remplacement : une ligne prévue sans mouvement
resterait au registre plutôt que d'en disparaître.

### Ce qui a été vérifié plutôt que cru

La pureté du filtre `production_id` a été établie **contre le commentaire qui l'affirmait** :
`enregistrerSortie` accepte bien ce paramètre mais son unique appelant ne le fournit jamais ; le
`production_id` de `releve_temperature` porte sur une autre table ; les contrepassations sont en
`ajustement: true`.

### `annulerProduction` reste inchangé — et il n'y a rien à arbitrer

La question posée était : si le total devient dérivé, une production annulée doit-elle voir son coût
retomber ? **Elle ne se pose pas**, et c'est le code qui le dit, pas un commentaire :

1. `cloturerSession` filtre `ne(production.statut, 'annulee')` — une production annulée **ne pèse dans
   aucune marge**. Son coût figé n'est jamais facturé.
2. `saisirRealise` refuse déjà une production annulée : aucun chemin ne recalcule après coup.
3. Annuler une production rattachée à une session **déjà clôturée** est refusé en 422 (D-024).

Le total est donc dérivé **à l'écriture**, pas à la lecture. Dériver à la lecture aurait contredit le
filtre `ajustement = false` de `lireProductionDetail` et fait « retomber » les lignes face à un total
figé — **deux vérités contradictoires sur la même fiche**.

### La preuve, et pourquoi une mutation valait mieux qu'un test

**Mutation B** — ramener le sens **amont** seul à `production_consommation` — a produit **un seul
rouge, l'amont**, l'aval restant vert. C'est ce qui prouve que **les deux sens sont couverts
indépendamment**, et qu'une correction de l'aval seul aurait laissé la moitié du registre fausse **en
silence**.

Un parcours de bout en bout neuf (`parcours-ecart-matiere.test.ts`) rejoue le rappel par **numéro de
lot fournisseur** — le seul que porte un avis de rappel réel — et boucle amont/aval avec la session
nommée des deux côtés. `numeroLotPate` y est asserté explicitement : c'est la capacité qui avait déjà
failli être perdue en retirant une fonction jugée morte.

### Ce qui reste imparfait, et qu'il faut savoir

**La cohérence lecture/écriture repose sur un test, pas sur du code partagé.**
`coutMatiereReelDepuisMouvements` (service) et `grandLivreProduction` (dépôt) rejouent le même grand
livre dans **deux fonctions distinctes**. L'invariant `Σ lignes + reliquat = total` rougirait si un
filtre changeait d'un seul côté — mais **c'est un garde-fou, pas une garantie structurelle**.
Partager la fonction resterait mieux.

Et `quantiteMouvementee` traversait HTTP sans qu'aucun écran ne l'affiche : **une capacité à
brancher, pas un mort-né** (§6 de `docs/39`).

> **Corrigé le 02/08/2026 — cette phrase était devenue fausse le jour même de sa rédaction.** Deux
> colonnes l'affichent désormais : « Sorti du lot » dans le registre AFSCA et sur la fiche de rappel
> imprimée, et « Réel » dans le détail d'une production. Le champ a aussi été **durci en requis** au
> contrat, ce qui a révélé une fixture qui ne le fournissait pas — exactement ce que le durcissement
> achetait.
>
> Signalé par l'agent qui venait d'écrire ces colonnes. C'est `docs/39` §14 sur son propre auteur :
> **une affirmation sur l'état d'un autre fichier est fausse avant la fin de la journée.** Elle
> n'aurait pas dû être écrite ici, mais dans une tâche.

---

## D-098 — À horizon nul, l'intervalle se resserre : le refus est correct, le silence ne l'était pas

**Date** : 02/08/2026 · **Statut** : appliquée

### Le fait, établi dans le code et non supposé

Le prochain jour de marché de La Batte est le **dimanche**. `prochainJourDeMarche`
(`packages/db/src/seed/demonstration.ts`) calcule `(jourSemaine − aujourd'hui + 7) % 7` : quand on
est **déjà** dimanche, l'écart vaut `0` et la prochaine session est **le jour même**.
`prochaineSessionPlanifiee` la retient, l'horizon de prévision vaut donc **0**, et
`ecartMeteoPrevueRealisee` (`packages/core/src/prevision/`) **refuse par construction** dès que
`horizonJours <= 0`.

**Ce refus est justifié, et il ne change pas.** Une météo du jour même n'est plus une prévision :
il n'y a aucune incertitude d'horizon à faire payer à l'intervalle P10/P90. Le moteur reste
**hors périmètre** de cette décision — rien n'y a été modifié.

Conséquence à l'écran : `inflationSigmaMeteoBp` disparaît de `facteurs`, la ligne « Fiabilité
météo » quitte la décomposition, et **l'intervalle affiché devient plus étroit** — le dimanche
matin, c'est-à-dire au moment exact où cet écran sert à décider d'une quantité de pâte.
**Rien ne l'expliquait.**

### Ce que ce refus a déjà coûté une fois

Un test d'activation de prédicteur, écrit un **samedi**, est passé au **rouge le dimanche**, sans
qu'une ligne de code ait bougé. C'est la **quatrième forme de fixture aveugle**, consignée depuis
dans `docs/39-DOCTRINE-DES-AGENTS.md` §3 : un cas impossible **un jour sur sept**, donc invisible six
jours sur sept et indiscernable d'un défaut réel le septième.

Le raisonnement qui justifie le refus **n'était écrit que dans le code**. Un lecteur qui découvre
l'écart un dimanche conclut au défaut — c'est exactement ce qui est arrivé. **D'où cette entrée.**

### Les cinq prédicteurs à horizon nul : un seul est concerné

Vérifié dans le code, pas dans un commentaire. `calculerPredicteursPrecision`
(`packages/core/src/prevision/predicteurs-precision.ts`) reçoit `horizonMeteoJours` et **ne le
transmet qu'à `ecartMeteoPrevueRealisee`**. Les quatre autres — comparable calendaire, jour de
semaine, vacances scolaires, session consécutive — ne reçoivent que `dateCible` et **n'ont aucune
notion d'horizon** : leurs conditions d'activation portent sur le nombre d'années civiles
distinctes, de jours de semaine distincts, d'observations en/hors vacances, d'occurrences d'un état
d'écoulement — jamais sur la distance à aujourd'hui.

**La divergence est donc réelle et voulue**, et c'est elle qui interdisait un message générique :
seul l'élargissement d'intervalle disparaît un dimanche, les quatre facteurs de demande sont
strictement inchangés. Un message qui aurait dit « les prédicteurs ne s'appliquent pas aujourd'hui »
aurait été **faux pour quatre d'entre eux sur cinq**.

`inflationHorizonBp` (`horizon.ts`) est neutre à horizon nul comme à tout horizon en-deçà du seuil
fiable, et n'est de toute façon utilisé que par la prévision **calendaire**, pas par
`/api/prevision` : il ne participe pas à ce resserrement.

### Choix — un troisième cas, avec ses propres mots

Ce dépôt tient depuis longtemps la distinction **mesuré** / **inconnu** (`docs/39` §4 : la valeur
inconnue vaut `null`, jamais `0`). Ce cas-ci n'est **ni l'un ni l'autre** : la grandeur n'est pas
inconnue, elle **n'a pas d'objet**. La phrase retenue le dit en toutes lettres :

> Le marché a lieu aujourd'hui : la météo est observée, ce n'est plus une prévision. L'élargissement
> de l'intervalle lié à la fiabilité météo est donc **sans objet** — il n'est ni mesuré ni inconnu,
> il n'a simplement pas lieu d'être. L'intervalle est plus étroit pour cette seule raison, pas parce
> que la prévision serait plus sûre.

Elle ferme les **deux contresens** possibles : « c'est en panne » (d'où « il n'a simplement pas lieu
d'être », et non « indisponible ») et « la prévision est donc plus fiable aujourd'hui » (d'où la
dernière proposition). Elle énonce ce qui est vrai **aujourd'hui** sans prétendre être l'unique
raison d'une ligne absente : à horizon nul, l'élargissement d'horizon n'a pas lieu d'être, que
l'historique de couples (prévu, réalisé) soit suffisant ou non.

**Registre : le fait, pas l'avertissement.** `EncartErreur.tsx` distingue deux natures de refus —
`metier` (le porteur a un geste à faire : glyphe `▲`, `text-alerte`) et `technique` (rien n'a
échoué de son fait : ton neutre, `role="alert"`). **Ce message n'est ni l'un ni l'autre** : rien à
corriger, rien de cassé. Il prend donc le ton du texte courant (`text-xs text-ink-3`, celui de
`couts.origine` et `baseline.explication`), sans glyphe et sans `role="alert"` — mélanger les
registres diluerait le seul signal qui doit rester rare.

**Placement : sous les trois nombres qu'il qualifie** (fourchette basse / demande médiane /
fourchette haute), pas dans « D'où vient ce chiffre » — c'est l'intervalle qui a changé de nature,
et c'est sur lui que se prend la décision de production.

### Le fait traverse le contrat — il n'est pas déduit à l'écran

`schemaPrevision` porte désormais **`horizonJours: z.int()`**, calculé serveur par
`horizonJoursSession` (`apps/api/src/routes/previsions.ts`), extraite de l'expression jusque-là
anonyme passée à `calculerPredicteursPrecision`. **Le même nombre** alimente le prédicteur et la
phrase : ils ne peuvent pas parler de deux jours différents.

L'alternative — laisser l'écran comparer `session.dateSession` à `new Date()` — était **exclue par
`CLAUDE.md` §3 règle 1** (aucun calcul métier dans un composant), et aurait rouvert le piège
d'origine : un composant qui lit l'horloge se comporte différemment selon le jour où on le regarde,
et ses tests avec lui.

**Champ REQUIS, pas optionnel**, et c'est ce qui rend le maillon impossible à laisser débranché : la
route parse sa propre sortie (`schemaPrevision.parse(vuePrevision(...))`). Vérifié par mutation —
retirer `horizonJours` de `vuePrevision` fait répondre `/api/prevision` en **422**, bruyamment, au
lieu de laisser Zod le supprimer en silence (`docs/39` §5).

Nom et unité **identiques** à `schemaJourCalendaire.horizonJours` : une seule grandeur, un seul mot,
dans les deux contrats.

### La preuve

Quatre mutations, chacune restaurée et vérifiée **identique au bit près** (SHA-256) :

| Mutation                                  | Attendu                        | Obtenu                                       |
| ----------------------------------------- | ------------------------------ | -------------------------------------------- |
| `mentionHorizonNul` rend toujours `null`  | rouge                          | **2 rouges** — le test pur ET l'écran monté  |
| `Math.max(0, …)` devient `Math.max(1, …)` | rouge                          | **3 rouges**, dont l'intégration             |
| `horizonJours` retiré de `vuePrevision`   | bruyant, jamais un silence     | **`expected 422 to be 200`**, les deux jours |
| phrase déplacée AVANT la fourchette       | rouge (elle qualifie celle-ci) | **1 rouge** sur l'ordre dans le document     |

Le test d'intégration (`apps/api/src/routes/previsions-horizon-nul.test.ts`) joue **deux fois le
même scénario, sur la même graine et les mêmes données**, en ne changeant que le jour où l'on se
place : un **dimanche** (`horizonJours = 0`, aucune inflation) et un **mercredi**
(`horizonJours = 4`, inflation présente et strictement supérieure à 10000). Le second cas n'est pas
décoratif — sans lui, on ne prouverait pas que l'élargissement **existe** les autres jours, donc pas
que le resserrement du dimanche est un changement à expliquer.

**L'horloge est figée sur une date CALCULÉE** (`jourLePlusRecent(0)`, `jourLePlusRecent(3)`),
jamais sur un littéral qui vieillirait, et **sans aucun branchement « si on est dimanche »** : un
test à deux chemins selon le jour n'en exerce qu'un le jour où on le relit — on remplacerait une
fragilité par une fixture aveugle.

Les tests d'écran, eux, **ne lisent aucune horloge** : `horizonJours` étant un fait porté par le
contrat, la fixture le pose (`0` puis `6`). Le jour où ces fichiers sont relus n'entre nulle part.

### Ce qui n'est pas prouvé

- **La suite n'a été passée qu'un dimanche.** C'est le jour à risque, donc le bon jour pour la
  passer ; ce n'est pas une preuve pour les six autres.
- **Aucun test ne compare la LARGEUR de l'intervalle entre les deux jours.** L'inflation est prouvée
  présente le mercredi et absente le dimanche ; que `p90 − p10` soit effectivement plus étroit
  relève de `prevoir()`, hors périmètre de cette décision.
- **jsdom ne calcule aucun style.** Le registre est vérifié sur le texte et sur les classes, pas sur
  le rendu — le contraste réel du ton `ink-3` reste à voir au navigateur.

## D-099 — Les routes coûteuses sont limitées en débit, même sur une API qui n'écoute que 127.0.0.1

**Date** : 28/09/2026 · **Statut** : appliquée

### Contexte

L'analyse CodeQL (suite `security-extended`, activée le 28/09/2026) signale
`js/missing-rate-limiting` sur `GET /api/commandes/:id/pdf` et `GET /api/prevision/brief`.
L'objection évidente — « l'API n'écoute que sur 127.0.0.1 » (`serveur.ts`, `HOTE`) — ne tient
pas : n'importe quelle page ouverte dans le navigateur du poste peut émettre des `GET` vers
`http://127.0.0.1:3001`. Elle ne lit pas la réponse, mais la requête part et la route
s'exécute. Or chaque génération de document lance Chromium (ou ExcelJS) **et archive une
nouvelle version sur disque** (D-026) : une boucle suffit à saturer le processeur et à remplir
le disque. Un appel IA est facturé, un envoi de mail part réellement chez le fournisseur.

### Options

1. Rejeter l'alerte comme « application locale » : faux, voir ci-dessus.
2. Limiter toutes les routes : les écrans appellent les routes de lecture en rafale, une limite
   globale aurait tôt ou tard refusé un usage normal.
3. **Limiter seulement les routes coûteuses**, par route, avec `@fastify/rate-limit`
   (greffon officiel Fastify, `global: false`).

### Choix

Option 3. `apps/api/src/plugins/limitation-debit.ts` porte deux niveaux :
`LIMITE_GENERATION_DOCUMENT` (30 par minute et par route : les 10 routes de
`routes/documents.ts`, le PDF de commande, le brief avant-marché) et `LIMITE_APPEL_EXTERNE`
(10 par minute et par route : envoi de commande par mail, les trois demandes de commentaire
IA, la recherche d'événements). Le greffon est inscrit sur l'instance **racine**, avant les
routes : inscrit dans un contexte encapsulé, il n'aurait vu aucune route de `/api`. Au-delà
de la limite, la réponse est un **429** au format habituel
(`{ erreur: { code: 'trop_de_demandes', message } }`, message en français).

### Conséquences

- La clé est l'adresse IP ; tout arrive de 127.0.0.1, la limite vaut donc pour le poste
  entier, par route. C'est le but.
- `plugins/limitation-debit.test.ts` monte le serveur complet et fige la liste EXACTE des
  routes limitées : une route coûteuse ajoutée sans limite, ou une route ordinaire limitée par
  erreur, fait échouer le test.
- Ne protège pas contre ce qu'une page tierce peut faire en une minute sous la limite ; une
  vérification de l'en-tête `Origin` sur les routes qui écrivent reste une amélioration
  possible, hors du périmètre de cette décision.
