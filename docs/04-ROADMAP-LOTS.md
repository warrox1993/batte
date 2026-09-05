# 04 — Roadmap de développement en lots

Principe : **chaque lot produit quelque chose d'utilisable**. Pas de lot « infrastructure »
qui ne se voit pas. À la fin de chaque lot, l'application se lance et fait quelque chose de
plus qu'avant.

Les prompts ci-dessous sont à coller tels quels dans Claude Code, un par un.

---

## Lot 0 — Fondations (½ journée)

**Contenu.** Monorepo, TypeScript strict, Fastify, Vite/React, Tailwind, Drizzle + SQLite,
Vitest, ESLint/Prettier, scripts npm, `.env.example`, sauvegarde automatique au démarrage,
squelette de navigation, jeu de données de démonstration.

**Critère de fin.** `npm run dev` lance l'API et l'interface, une page s'affiche,
`npm run typecheck && npm run test && npm run lint` passent.

> **Prompt**
> Lis `CLAUDE.md` et `docs/`. Implémente le Lot 0 de `docs/04-ROADMAP-LOTS.md`.
> Avant d'écrire du code, liste-moi l'arborescence prévue, les dépendances exactes avec
> leurs versions, et les points où tu as dû trancher. Attends ma validation.

---

## Lot 1 — Recettes et ingrédients (1 journée)

**Contenu.** Tables `ingredient`, `fournisseur`, `conditionnement`, `recette`, `recette_ligne`.
CRUD complet. Mise à l'échelle dans les trois sens (crêpes, volume, ingrédient limitant).
Calcul du coût matière et des allergènes. Versionnage des recettes.
Seed avec R1 et R2 telles que décrites dans `CLAUDE.md` §6.

**Critère de fin.** Je saisis R1, je demande 200 crêpes, l'application me donne les quantités
exactes de chaque ingrédient et le coût matière total.

> **Prompt**
> Implémente le Lot 1. Toute la logique de mise à l'échelle, de conversion d'unités et de
> calcul de coût va dans `packages/core` en fonctions pures, avec des tests Vitest couvrant
> les cas limites (densité manquante, ingrédient en pièces, arrondis). Montre-moi d'abord
> les signatures des fonctions de `core`.

---

## Lot 2 — Stock, lots et traçabilité (1,5 journée)

**Contenu.** `lot`, `mouvement_stock`, `reception`. Vue de stock valorisée au CUMP.
Consommation FEFO. Écran d'inventaire. Alertes DLC. Tous les invariants de
`docs/02-MODELE-DONNEES.md` testés.

**Critère de fin.** Je saisis une réception de 25 kg de farine, je fais une sortie de 4 kg,
le stock affiche 21 kg avec la bonne valorisation, et l'historique est complet.

> **Prompt**
> Implémente le Lot 2. Attention particulière : le stock ne doit jamais être stocké, seulement
> calculé à partir des mouvements. Écris d'abord les tests des 8 invariants listés en fin de
> `docs/02-MODELE-DONNEES.md`, puis le code qui les satisfait.

---

## Lot 3 — Production (1 journée)

**Contenu.** Ordre de production, contrôle de faisabilité avec identification de l'ingrédient
limitant, consommation FEFO automatique, création du lot de pâte avec DLC 24 h, saisie du
réalisé et calcul de l'écart théorique/réel.

**Critère de fin.** Je lance une production de 5 L de R1, le stock se décrémente
automatiquement en respectant la FEFO, un lot de pâte est créé, et je peux tracer chaque
ingrédient consommé jusqu'à son lot fournisseur.

> **Prompt**
> Implémente le Lot 3. La transaction de production doit être atomique : soit tout passe,
> soit rien. Gère explicitement le cas où un lot ne suffit pas et où il faut en consommer
> plusieurs.

---

## Lot 4 — Sessions de marché et compta analytique (1,5 journée)

**Contenu.** `session_marche`, `session_vente`, `produit_vente`, saisie de clôture au clavier,
rapprochement de caisse, calcul des marges, taux d'écoulement, marge par heure, tableau de
bord analytique, compteurs de seuils légaux.

**Critère de fin.** Je clôture une session, je vois immédiatement CA, coût matière réel,
marge nette, marge/heure et l'avancement vers les trois seuils légaux.

> **Prompt**
> Implémente le Lot 4. La saisie de clôture doit être entièrement utilisable au clavier :
> tabulation entre les champs, entrée pour valider une ligne, totaux mis à jour en direct.
> Les seuils légaux viennent de la table `parametre`, pas de constantes.

---

## Lot 5 — Moteur de prévision (2 journées)

**Contenu.** Tout `docs/03-MOTEUR-PREVISION.md`, dans l'ordre d'implémentation indiqué en fin
de fichier. Intégration Open-Meteo. Table `evenement`. Écran « Prochaine session » avec
décomposition lisible des facteurs. Commande `npm run backtest`.

**Critère de fin.** Vendredi, l'application me dit quoi produire, avec un intervalle, une
justification facteur par facteur, et l'indication de la contrainte limitante s'il y en a une.

> **Prompt**
> Implémente le Lot 5, uniquement les étapes 1 à 4 de la section « Ordre d'implémentation ».
> Le moteur est 100 % déterministe, dans `packages/core/prevision`, sans aucun appel réseau
> ni appel Claude. Teste-le sur un historique synthétique que tu génères, en vérifiant
> notamment que le calcul newsvendor donne bien un quantile autour de 0,9 avec les coûts
> réels du projet. Puis arrête-toi et montre-moi les résultats.

---

## Lot 6 — Documents générés (1 journée)

**Contenu.** Chaîne Playwright HTML→PDF, templates : fiche technique, affichette allergènes,
étiquette de bac, bon de commande, brief avant-marché, rapport de session, registre AFSCA
mensuel. Exports ExcelJS : stock valorisé, journaux, amortissements, export CSV paramétrable.

**Critère de fin.** Je génère les sept PDF et les quatre Excel, tous imprimables et lisibles.

> **Prompt**
> Implémente le Lot 6. Un seul mécanisme PDF : templates HTML avec CSS `@media print`,
> rendus par Playwright. Les templates partagent une feuille de style commune. L'affichette
> allergènes doit être lisible à un mètre. Chaque document sortant porte la mention de
> franchise TVA quand c'est un document commercial.

---

## Lot 7 — Réapprovisionnement et mails (1 journée)

**Contenu.** Calcul du point de commande, génération de brouillons de commande groupés par
fournisseur avec arrondi aux conditionnements réels, écran de validation, envoi Nodemailer
avec PDF joint, suivi des commandes.

**Critère de fin.** Le stock de farine passe sous le seuil, l'application me propose une
commande de 2 sacs de 25 kg chez le bon fournisseur, je valide, le mail part.

> **Prompt**
> Implémente le Lot 7. **Aucun envoi automatique sans validation humaine explicite** —
> l'écran de validation est obligatoire dans le flux. Prévois un mode test qui écrit le mail
> dans un fichier au lieu de l'envoyer.

---

## Lot 8 — Registre AFSCA (½ journée)

**Contenu.** Relevés de température avec alerte au-delà de 7 °C, plan de nettoyage,
non-conformités, écran de traçabilité amont/aval, registre mensuel PDF.

**Critère de fin.** Je pars d'une date de vente et je remonte à tous les lots fournisseurs
concernés en un clic.

> **Prompt**
> Implémente le Lot 8. L'écran de traçabilité doit fonctionner dans les deux sens : d'un lot
> fournisseur vers toutes les sessions impactées, et d'une session vers tous les lots
> consommés.

---

## Lot 9 — Intégration Claude (1 journée)

**Contenu.** Service `packages/core/ia` côté serveur, appels typés avec validation Zod des
sorties, `journal_ia` avec comptage de coût, plafond mensuel, mode dégradé complet.
Cinq usages : commentaire de prévision, analyse d'écart, extraction de bon de livraison,
proposition d'événements, synthèse mensuelle.

**Critère de fin.** Je débranche la clé API : toute l'application continue de fonctionner,
seuls les commentaires disparaissent.

> **Prompt**
> Implémente le Lot 9. Chaque usage a son prompt versionné dans un fichier séparé, sa sortie
> validée par un schéma Zod, et son coût journalisé. Route les tâches d'extraction vers Haiku
> et les tâches d'analyse vers Sonnet. Écris d'abord les tests du mode dégradé.

---

## Lot 10 — Comptabilité et exports comptable (1 journée)

**Contenu.** Journaux recettes/achats, dépenses, immobilisations et amortissements,
tableau de bord des seuils avec alerte à 80 %, rappel du listing TVA au 31 mars,
exports pour le comptable.

> **Prompt**
> Implémente le Lot 10. Génère aussi un document `docs/POUR-LE-COMPTABLE.md` expliquant
> ce que l'application produit et sous quel format, à transmettre au comptable pour qu'il
> valide avant la première clôture.

---

## Lot 11 — Google (1 journée, optionnel)

Calendar, Drive, Sheets. OAuth desktop, jetons chiffrés localement. Fonctionnement complet
sans compte connecté.

---

## Lot 12 — Finitions

Sauvegarde/restauration, import/export JSON complet, écran de qualité du modèle, raccourcis
clavier, guide d'utilisation, packaging éventuel.

---

## Ordre de priorité si le temps manque

Pour être opérationnel au premier marché, le minimum vital est :
**Lots 0 → 1 → 2 → 3 → 4**, plus l'affichette allergènes et le registre de température
du Lot 6/8. Le reste peut suivre après le lancement.

La prévision (Lot 5) n'a de toute façon aucune donnée à exploiter avant plusieurs sessions :
la coder tôt est utile pour la structure, pas pour la précision.

---

## Règle de fonctionnement avec Claude Code

1. Un lot à la fois, jamais deux.
2. Avant le code : annonce des fichiers et des décisions. Validation.
3. Après le code : `typecheck`, `test`, `lint` verts, plus un résumé de ce qui est
   vérifiable manuellement.
4. Toute décision d'architecture → `docs/05-DECISIONS.md`.
5. Ambiguïté → question, jamais supposition.
