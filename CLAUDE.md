# CLAUDE.md — Projet « Batte » (gestion d'une activité de crêpes ambulantes)

> Ce fichier est le contexte permanent du projet. Il est lu à chaque session Claude Code.
> Les spécifications détaillées sont dans `docs/`. Ne pas dupliquer ici ce qui y est déjà écrit.
>
> Il est conservé dans le dépôt comme trace de la méthode : l'application a été développée en
> pilotant Claude Code à partir de ce contexte, des spécifications de `docs/`, du journal de
> décisions (`docs/05-DECISIONS.md`) et des audits successifs (`docs/08` à `docs/40`).

---

## 0. Le produit en une phrase

> **Un ERP mono-utilisateur ultra-simplifié pour une micro-entreprise alimentaire ambulante.**

Cette phrase est l'ancrage principal. Elle veut dire trois choses précises :

**« ERP »** — les modules ne sont pas des applications juxtaposées, ils forment **une seule
chaîne de données**. Une réception de farine chez le meunier doit se propager, sans ressaisie,
jusqu'à la marge nette du dimanche suivant et jusqu'au registre AFSCA. Si un module peut être
codé sans connaître les autres, c'est probablement un mauvais découpage.

| Module d'un ERP classique   | Équivalent ici                                               |
| --------------------------- | ------------------------------------------------------------ |
| Achats / Fournisseurs       | Commandes, réceptions, mails automatiques                    |
| Gestion des stocks          | Lots, mouvements, FEFO, DLC, point de commande               |
| Production / MRP            | Recettes = nomenclatures, ordres de production, consommation |
| Ventes / CRM                | Sessions de marché, produits, mix, panier moyen              |
| Planification de la demande | Moteur de prévision météo + événements                       |
| Qualité / Conformité        | Registre AFSCA, traçabilité, températures                    |
| Comptabilité générale       | Journaux, dépenses, amortissements, seuils légaux            |
| Comptabilité analytique     | Coût de revient réel, marge par axe, écart théorique/réel    |
| Business Intelligence       | Tableau de bord, qualité du modèle                           |

**« mono-utilisateur »** — pas de gestion de droits, pas de workflow d'approbation, pas de
multi-société, pas de multi-devise, pas de multi-entrepôt. Deux personnes, un poste, un métier.

**« ultra-simplifié »** — chaque écran fait une chose. Aucun paramétrage inutile. Si une
fonctionnalité d'ERP standard n'a pas d'usage concret le dimanche soir après un marché, elle
n'existe pas. **La complexité est dans les calculs, jamais dans l'interface.**

---

## 1. Ce qu'on construit

Une **application de bureau locale** pour piloter une activité de vente de crêpes en ambulant
(indépendant complémentaire, Wallonie, marché de La Batte à Liège).

Cinq domaines fonctionnels, dans un seul produit :

1. **Recettes & fiches techniques** — proportions exactes, rendements, allergènes, versionnage.
2. **Stock & traçabilité** — entrées fournisseur par lot, déduction automatique à la production,
   alertes de réapprovisionnement, envoi de bons de commande par mail.
3. **Prévision de production** — combien de litres de pâte produire pour la prochaine session,
   à partir de l'historique, de la météo et des événements locaux.
4. **Compta générale et analytique** — CA, dépenses, coût matière réel par crêpe, marge par
   session, écart théorique/réel, suivi des seuils légaux belges.
5. **Registre AFSCA** — relevés de température, traçabilité des lots, plan de nettoyage,
   génération du registre d'autocontrôle.

**Utilisateurs** : deux personnes (le porteur du projet + sa partenaire), sur PC.
Aucun usage sur le stand pendant le marché : la saisie se fait avant et après.

---

## 2. Stack technique — décidée, ne pas la remettre en question sans raison explicite

| Couche     | Choix                                       | Pourquoi                                      |
| ---------- | ------------------------------------------- | --------------------------------------------- |
| Langage    | TypeScript strict partout                   | Un seul langage à relire                      |
| Runtime    | Node.js 22 LTS                              |                                               |
| Backend    | Fastify                                     | Léger, typé, rapide à lire                    |
| Base       | SQLite (`better-sqlite3`) + Drizzle ORM     | 0 €, fichier unique, sauvegardable            |
| Frontend   | React 19 + Vite + TypeScript                |                                               |
| UI         | Tailwind CSS + shadcn/ui                    |                                               |
| Graphiques | Recharts                                    |                                               |
| PDF        | Playwright (Chromium) → HTML/CSS print      | Un seul mécanisme pour tous les documents     |
| Excel      | ExcelJS                                     |                                               |
| Word       | `docx` (npm)                                | Uniquement si le comptable l'exige            |
| Mail       | Nodemailer + SMTP                           | Simple, pas d'OAuth en V1                     |
| Météo      | Open-Meteo                                  | Gratuit, sans clé API                         |
| IA         | `@anthropic-ai/sdk`, **serveur uniquement** | La clé ne doit jamais atteindre le navigateur |
| Tests      | Vitest                                      |                                               |

**Monorepo** : `apps/api`, `apps/web`, `packages/core` (logique métier pure et testable),
`packages/db` (schéma Drizzle + migrations).

**Lancement** : `npm run dev` → API sur `:3001`, web sur `:5173`.
Packaging Electron/Tauri : **hors périmètre V1**, à reconsidérer seulement si le double
lancement devient pénible à l'usage.

**Coût d'infra visé : 0 €/mois.** Tout tourne en local. La seule dépense est l'API Claude,
facturée à l'usage (voir §5).

---

## 3. Règles d'architecture non négociables

1. **Toute la logique métier chiffrée vit dans `packages/core`, en fonctions pures, testées.**
   Conversions d'unités, calculs de rendement, valorisation de stock, coûts de revient,
   moteur de prévision : rien de tout ça ne doit se trouver dans un composant React ou dans
   un handler Fastify.

2. **Un LLM ne calcule jamais.** Claude ne produit aucun chiffre qui entre dans la base.
   Le moteur de prévision est déterministe et écrit en TypeScript (voir
   `docs/03-MOTEUR-PREVISION.md`). Claude **commente** les chiffres, **explique** les écarts,
   **aide à structurer** une saisie — il ne les invente pas. Toute sortie d'un appel Claude
   qui alimente la base doit passer par un schéma Zod strict et être marquée
   `source = 'ia'` avec validation humaine explicite.

3. **Argent en entiers.** Tous les montants sont stockés en **centimes d'euro** (`INTEGER`).
   Aucun flottant pour de l'argent, nulle part.

4. **Masses en grammes, volumes en millilitres, tous deux en entiers.** Les conversions
   volume↔masse passent obligatoirement par la densité déclarée de l'ingrédient.
   Aucune conversion implicite.

5. **Le stock ne se modifie que par un mouvement.** Jamais d'`UPDATE` direct sur une quantité.
   Le stock courant est toujours la somme des mouvements. Cela rend l'historique auditable,
   ce qui est exactement ce que l'AFSCA demande.

6. **Traçabilité par lot obligatoire.** Toute entrée de marchandise crée un lot
   (fournisseur, date de réception, numéro de lot, DLC). Toute production consomme des lots
   identifiés, en FEFO (_first expired, first out_). C'est une obligation réglementaire,
   pas une élégance technique.

7. **Rien ne s'efface.** Corrections par écriture d'annulation (`is_annule` + `annule_par_id`),
   jamais par `DELETE`. Journal d'audit sur toutes les tables sensibles.

8. **Fuseau `Europe/Brussels` partout.** Stockage en ISO 8601 UTC, affichage local.
   Les sessions de marché sont datées au jour civil belge.

9. **Zéro donnée personnelle client en V1.** On compte des transactions et des paniers,
   pas des personnes. Pas de nom, pas d'e-mail, pas de fidélité nominative tant qu'une base
   légale RGPD et une politique de conservation n'ont pas été écrites.

10. **Chaque écran doit être utilisable au clavier.** La saisie post-marché est répétitive :
    tabulation, entrée, chiffres. Pas de souris obligatoire.

---

## 4. Conventions de code

- **Langue** : identifiants du domaine métier en **français** (`recette`, `fournisseur`,
  `mouvementStock`, `sessionMarche`), vocabulaire technique en anglais
  (`repository`, `handler`, `useEffect`). Ne pas franciser React.
- **Nommage** : `camelCase` en TS, `snake_case` en SQL, `PascalCase` pour les composants.
- **Commentaires en français**, sur le _pourquoi_ et sur les règles métier / réglementaires.
  Un commentaire qui paraphrase le code est du bruit.
- **Pas de `any`.** `unknown` + affinage si nécessaire.
- **Validation** : Zod à toutes les frontières (HTTP, fichiers importés, réponses Claude).
- **Erreurs** : jamais de `catch` silencieux. Erreurs métier typées, remontées à l'UI en
  français compréhensible.
- **Tests** : toute fonction de `packages/core` est testée. Cible ≥ 80 % de couverture sur
  ce package. Le reste, au jugement.
- **Commits** : conventionnels (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`), message en
  français.

---

## 5. Usage de l'API Claude dans l'application

Trois usages, trois modèles, dans cet ordre de préférence :

| Usage                                                                            | Modèle                         | Fréquence |
| -------------------------------------------------------------------------------- | ------------------------------ | --------- |
| Extraction structurée (lecture d'un bon de livraison, normalisation de libellés) | Haiku 4.5                      | fréquent  |
| Commentaire de prévision, analyse d'écart, brief avant-marché                    | Sonnet                         | ~4×/mois  |
| Analyse trimestrielle profonde, arbitrages stratégiques                          | Sonnet, ou Opus ponctuellement | rare      |

**État réel au 28/09/2026.** L'extraction structurée (lecture d'un bon de livraison) **n'est pas
implémentée** : la valeur `extraction` de `journal_ia.usage` et `reception.source = 'ia_validee'`
sont réservées, jamais écrites. Le modèle bon marché de cette famille (Haiku 4.5) sert aujourd'hui
à la découverte d'événements avec l'outil serveur de recherche web ; Sonnet 5 rédige les
commentaires (prévision, analyse d'écart, synthèse). Les deux identifiants de modèle sont des
paramètres en base (`ia_modele_extraction`, `ia_modele_commentaire`), jamais du code.

Repères de tarification API (page officielle
<https://platform.claude.com/docs/en/about-claude/pricing>, vérifiée le 28/09/2026) : Haiku 4.5
à 1 $ / 5 $ par million de tokens d'entrée / sortie ; Sonnet 5 à 2 $ / 10 $, le tarif
d'introduction étant devenu le tarif standard ; la recherche web à 10 $ les 1 000 recherches.
Le cache de prompt facture les entrées relues à 10 % du prix de base, et l'API Batch applique
une remise de 50 %. Haiku 4.5 (`claude-haiku-4-5-20251001`) est actif et non déprécié à cette
date ; son retrait provisoire n'interviendra pas avant le 15/10/2026, avec un préavis annoncé
d'au moins 60 jours (page officielle des retraits de modèles).

**Au volume de ce projet (une session de marché par semaine), la dépense mensuelle attendue
se compte en unités d'euros, pas en dizaines.** Implémenter malgré tout :

- un compteur de coût par appel, stocké en base (`journal_ia`) ;
- un plafond mensuel configurable qui coupe les appels non essentiels quand il est atteint ;
- un **mode dégradé complet** : l'application doit rester pleinement fonctionnelle sans
  aucun appel Claude. L'IA est un confort, jamais une dépendance.

---

## 6. Contexte métier — chiffres de référence

À traiter comme des **valeurs par défaut paramétrables en base**, jamais comme des constantes
codées en dur.

> ⛔ **Corrigé le 6 août 2026.** Les coûts matière, le rendement et le chiffre d'affaires
> qui figuraient ici étaient **fictifs** — jamais mesurés, jamais issus d'un devis. Le code
> qui s'y compare (`packages/core/src/sessions.ts`, `contrats/sessions.ts`) se comparait donc
> à rien. Les seuls chiffres légitimes sont ceux ci-dessous : les **prix**, qui viennent de
> devis fournisseurs réels, et les **quantités de recette**, qui viennent d'une pâte réellement
> faite. Tout le reste attend une mesure.

- **Recette R1** (froment) — par fournée d'environ 1,9 L : 0,5 kg farine T55, 1 L lait entier,
  4 œufs entiers + 2 jaunes, 0,1 kg beurre (brut, avant filtrage du beurre noisette),
  0,09 kg vergeoise blonde, 0,008 kg sel, 1 gousse de vanille, 0,03 L rhum brun.
- **Recette R2** (sarrasin-châtaigne) — quantités par fournée **pas encore écrites**.
- **Coût matière R1 : 3,19 € HTVA la fournée**, au 6 août 2026. Calculé sur les meilleurs
  prix réellement reçus pour la farine, le lait, les œufs, le beurre, la vergeoise et le sel.
  Les devis et le nom des fournisseurs restent hors du dépôt (retirés le 28/09/2026 avant la
  publication : ce sont des prix négociés avec des tiers). **Vanille et rhum ne sont chez aucun
  fournisseur consulté** : le total est donc un plancher, pas le coût complet.
  Source : un script de calcul tenu hors du dépôt, à rejouer à chaque nouveau devis — les prix
  bougent, ce chiffre aussi.
- **Coût par crêpe : INCONNU.** Il faut le rendement d'une fournée, qui n'a jamais été compté.
  Peser une fournée et compter les crêpes une seule fois suffit. Tant que ce n'est pas fait,
  aucun coût unitaire ne doit apparaître dans l'application autrement que vide.
- **Session type : INCONNUE.** Ni le nombre de crêpes, ni le chiffre d'affaires, ni la durée
  de cuisson n'ont été mesurés. Ne rien afficher plutôt qu'un chiffre inventé : une inconnue
  affichée comme un zéro est un mensonge, pas une valeur par défaut.
- **Contraintes du stand** : chaîne du froid passive (glacière rigide + blocs eutectiques +
  thermomètre sonde), paiement SumUp (1,69 %).
- **L'électricité dépend du LIEU, pas du projet.** Certains emplacements en fournissent, d'autres
  non — c'est le marché qui décide. C'est donc un **attribut de `lieu_marche`**, jamais une
  hypothèse globale : ne coder ni « il y a du courant », ni « il n'y en a pas ».
  Le gaz reste la source de cuisson par défaut, et l'application doit rester **pleinement
  utilisable sans électricité** — même exigence de mode dégradé que pour les appels Claude (§5).
  Ce qui en dépend : la capacité de cuisson (paramètre `capacite_cuisson_crepes_par_heure`, et
  donc l'écrêtage du moteur de prévision), le froid actif ou passif, et la possibilité d'un
  terminal de paiement connecté sur place.
- **Régime** : franchise de TVA, indépendant complémentaire, INASTI.

**Trois natures de produits vendus** — les deux premières dès la V1, la troisième ajoutée en
cours de route (`docs/demandes/16-MENUS-VENTE-EN-LIGNE-ET-AVIS-CLIENTS.md`) :

- **Transformé** — issu d'une recette, consomme du stock d'ingrédients. Marge ≈ 90 %.
- **Revendu** — produit du terroir acheté préemballé et revendu tel quel (sirop, confiture).
  Marge ≈ 30–40 %. Stock géré à l'unité, pas de recette.
- **Menu** — composé d'autres produits de vente (ex. crêpe + café à prix groupé), sans recette
  ni stock propres : son coût et sa ventilation transformé/revendu se déduisent de ses
  composants (`menu_composition`, `docs/02-MODELE-DONNEES.md`).

Conséquence structurante : pour une même marge, la revente génère **environ 2,6 fois plus de
chiffre d'affaires** que la crêpe. Or les seuils légaux ci-dessous portent sur le **CA**, pas
sur la marge. L'application doit donc afficher les compteurs de seuils **avec la ventilation
transformé / revendu** — un menu y compris, ventilé au prorata de ses composants — sans quoi
l'utilisateur se retrouvera hors franchise TVA sans l'avoir vu venir.

**Seuils légaux à surveiller** (alerte à 80 % du seuil, valeurs 2026 à revérifier chaque année) :

- 25 000 € de CA/an → sortie de la franchise TVA. **La tolérance de dépassement de 10 %
  a été supprimée au 1ᵉʳ janvier 2025** : le franchissement est désormais sec.
- 23 000 € de CA brut/an → éligibilité à l'aide Airbag du Forem
- 1 922,15 € de revenu net/an → en dessous, dispense de cotisations sociales possible en
  complémentaire ; au-dessus, cotisations dues à 20,50 %, sans cotisation minimale.

> ⚠️ **Corrigé le 6 août 2026.** Ce dernier seuil portait 17 374,08 € et l'attribuait à une
> « perte du régime de cotisation réduite du complémentaire ». C'est faux, et
> `docs/07-DOCTRINE-ERP-ET-DESIGN.md` le soupçonnait déjà : ce montant est le plafond du
> régime **étudiant-indépendant**, sans rapport avec un complémentaire. Le paramètre
> `seuil_cotisation_reduite_cents` est donc mal nommé autant que mal valorisé — à reprendre
> dans la table `parametre` avec sa source, pas seulement ici.

**Échéance récurrente** : listing clients TVA au 31 mars, même à zéro.

---

## 7. Garde-fous

- Ne jamais générer de code qui minore un chiffre d'affaires, contourne une obligation
  déclarative ou fabrique un registre AFSCA a posteriori. Le registre enregistre ce qui a été
  saisi, avec sa date de saisie réelle.
- L'application **ne remplace pas** un comptable, un guichet d'entreprise ou l'AFSCA.
  Les écrans de synthèse fiscale portent une mention en ce sens.
- Ne pas coder en dur des taux, seuils ou montants réglementaires : table `parametre`, avec
  date de validité et source.
- Ne pas introduire de dépendance payante ou de service cloud sans validation explicite.
- Les secrets (clé Anthropic, identifiants SMTP, jetons Google) vivent dans `.env`,
  jamais dans le dépôt. Fournir un `.env.example` documenté.

---

## 8. Où trouver quoi

| Fichier                         | Contenu                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `docs/01-SPEC-FONCTIONNELLE.md` | Modules, écrans, parcours utilisateur, documents générés                                  |
| `docs/02-MODELE-DONNEES.md`     | Schéma complet des tables et invariants                                                   |
| `docs/03-MOTEUR-PREVISION.md`   | Algorithme de prévision, démarrage à froid, décision de production                        |
| `docs/04-ROADMAP-LOTS.md`       | Découpage en lots de développement + prompts de démarrage                                 |
| `docs/05-DECISIONS.md`          | Journal des décisions d'architecture (à tenir à jour)                                     |
| `docs/06-UI-ET-PARCOURS.md`     | Écrans, navigation, conventions d'API, glossaire — **à lire avant tout code d'interface** |

---

## 9. Méthode de travail attendue de Claude Code

- **Un lot à la fois**, dans l'ordre de `docs/04-ROADMAP-LOTS.md`. Ne pas anticiper.
- **Avant de coder un lot** : annoncer les fichiers qui vont être créés ou modifiés et les
  décisions non triviales prises. Attendre le feu vert.
- **Après chaque lot** : `npm run typecheck && npm run test && npm run lint` doivent passer.
  Fournir un court résumé de ce qui est vérifiable manuellement.
- **Toute décision d'architecture nouvelle** est consignée dans `docs/05-DECISIONS.md`
  (contexte, options, choix, conséquences).
- **En cas d'ambiguïté dans la spec** : poser la question, ne pas deviner. Une hypothèse
  silencieuse sur une règle métier coûte plus cher qu'une question.
- Le code sera relu ligne à ligne par le porteur du projet, étudiant en informatique.
  Privilégier la lisibilité à l'astuce. Pas de sur-abstraction prématurée.

### 9.1 Doctrine de travail — à lire avant d'écrire une ligne

**`docs/39-DOCTRINE-DES-AGENTS.md`** recense les défauts **réels** que ce dépôt a payés, avec
l'incident qui a révélé chacun : le vert dont personne n'avait mesuré le périmètre, la liste écrite à
la main qui ne prouve jamais une absence (D-045), la fixture aveugle et ses trois formes, la valeur
inconnue affichée comme un zéro, le champ silencieusement supprimé à la frontière HTTP, le maillon
correct branché à rien, et les pièges d'outillage qui font perdre des heures.

**Ce n'est pas une liste de bonnes pratiques génériques.** Rien n'y figure qui n'ait coûté quelque
chose.

### 9.2 Quels agents utiliser — décision du porteur, 01/08/2026

> **Utiliser les agents INSTALLÉS** (fiches génériques installées au niveau utilisateur, et ceux
> des greffons : `pr-review-toolkit:*`, `feature-dev:*`, `claude-security:*`, `code-simplifier:*`…).
> **Ne pas fabriquer d'agents maison pour les remplacer.**
>
> Mise à jour du 28/09/2026 : les fiches génériques venues de GitHub (Kubernetes, Terraform, SEO…)
> ont été retirées de `.claude/agents/`, elles n'avaient rien à voir avec ce projet. Seules les
> quatre fiches `batte-*` y restent.

Le catalogue installé est riche et spécialisé — `silent-failure-hunter` pour les échecs avalés,
`comment-analyzer` pour les commentaires qui mentent, `pr-test-analyzer` pour la qualité des tests,
`type-design-analyzer` pour les invariants exprimés dans les types, `accessibility-expert`,
`security-auditor`, `typescript-pro`, `architect-reviewer`… Plusieurs recouvrent **exactement** les
classes de défauts que ce dépôt paie le plus cher.

**Ce qu'ils ne savent pas**, et qui doit donc venir du prompt à chaque fois :

1. **lire `CLAUDE.md` et `docs/39-DOCTRINE-DES-AGENTS.md` avant tout** — le second porte les pièges
   propres à ce dépôt et leur incident d'origine ;
2. sa **zone d'écriture exclusive** et ce qui lui est interdit — plusieurs agents travaillent souvent
   en parallèle, et un fichier partagé se paie en travail perdu ;
3. les **interdits absolus** (base réelle, `db:seed` hors du même appel de terminal, appel Anthropic
   facturé, serveur du porteur sur `:3001`).

Les quatre fiches `batte-*` restent dans le dossier comme **résumés de doctrine par métier** — elles
sont utiles à lire, y compris pour construire un prompt. Elles ne sont pas le chemin d'exécution
retenu.
