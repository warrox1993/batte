# Audit des erreurs 500 — 27 juillet 2026

## Pourquoi cet audit

Dans ce projet, **un 500 est toujours un défaut**. L'architecture prévoit que toute situation métier
prévisible remonte en erreur **typée** (`ErreurMetier`, `ErreurIntrouvable`,
`ErreurParametreManquant`), traduite en 4xx avec un message français et actionnable
(`CLAUDE.md` §4, forme de réponse de `docs/06`).

Un 500 ne se contente pas d'être laid : il **ment**. Il affiche « Une erreur inattendue s'est
produite, consultez les journaux du serveur » alors que la faute est souvent dans la saisie, et il
envoie l'utilisateur chercher une panne qui n'existe pas.

Trois 500 avaient déjà été rencontrés pendant la construction, tous de causes différentes. Cet audit
cherchait les autres.

## Verdict

**Cinq familles trouvées, cinq corrigées.** Aucune n'était un cas exotique : quatre sur cinq sont
atteignables depuis un geste normal de l'utilisateur, et l'une d'elles se déclenchait **le jour de
l'installation**, sur l'écran principal.

Les corrections sont figées par `apps/api/src/routes/erreurs-500.test.ts` (19 cas) et documentées en
D-034 et D-035 de `05-DECISIONS.md`.

---

## Famille 1 — Tout 4xx natif de Fastify sortait en 500

**Fichier.** `apps/api/src/plugins/erreurs.ts`

**Cause racine.** Le gestionnaire d'erreurs ne reconnaissait que `ErreurMetier` et `ZodError`, puis
retombait sur un 500 générique. Il **ignorait `erreur.statusCode`**, que Fastify renseigne pourtant
sur ses propres erreurs.

**Déclencheurs.** Un corps JSON tronqué (`FST_ERR_CTP_INVALID_JSON`, 400). Un `Content-Type`
non supporté (415). Une charge trop lourde (413). Une URL trop longue (414).

**Conséquence réelle.** Une faute du **client** était présentée à l'utilisateur — et **journalisée** —
comme une panne du **serveur**. Le journal se remplissait de fausses pannes, ce qui rend inutilisable
la seule trace disponible le jour d'un vrai incident.

**Correction.** Le handler honore `statusCode` pour tout statut dans `[400, 500[`, avec un message
français choisi par statut. Le message brut de Fastify n'est **jamais** relayé : il est en anglais
technique et peut contenir un fragment du corps envoyé.

---

## Famille 2 — Toute date métier antérieure à la validité des paramètres

**Fichiers.** `packages/db/src/depots/parametres.ts` (`lireParametres`), atteint entre autres par
`apps/api/src/routes/afsca.ts`.

**Cause racine.** `lireParametres(base, date)` ne retenait que les lignes dont
`dateDebutValidite <= date`. Le catalogue démarrant au 1er janvier de l'exercice, **toute date
antérieure ne ramenait aucune ligne** : la première lecture typée levait alors
`ErreurParametreManquant`, une `ErreurMetier` de statut 500.

**Déclencheurs.** Consulter les tâches de nettoyage en retard « au 15 juin de l'an dernier ». Saisir
un relevé de température oublié d'un exercice antérieur. Une `dateReference` hostile
(`' OR 1=1 --` se classe avant `2026-…` dans l'ordre lexicographique — pas d'injection, Drizzle lie
ses paramètres, mais un 500 déclenchable depuis une URL).

**Conséquence réelle.** L'utilisateur lisait « Le paramètre … n'est pas défini. Renseignez-le dans
Paramètres » — un diagnostic **entièrement faux**, puisque le paramètre existe. Il partait corriger
une configuration parfaitement saine.

**Correction.** Repli **clé par clé** sur la version la plus ancienne connue. Une clé correctement
résolue n'est jamais écrasée par une version plus ancienne. Le repli est une approximation assumée,
mais visible — là où un 500 ne laissait que l'incompréhension.

---

## Famille 3 — Coût matière nul le premier jour

**Fichiers.** `packages/core/src/prevision/statistiques.ts`, `packages/core/src/prevision/moteur.ts`

**Cause racine.** `ratioCritique(315, 0)` valait exactement **1**, et `quantileNormal(1)` lève une
`RangeError` — une erreur technique, non traduite, non attrapée.

**Chaîne complète, entièrement réaliste à l'installation.** Aucune réception saisie → aucun lot →
coût matière par crêpe nul → ratio à 1 → `RangeError` → **500 « Probabilite hors ]0,1[ : 1 »** sur
l'écran « Prochaine session », c'est-à-dire l'écran principal du produit.

**Correction.** `ratioCritique` rend `null` dès qu'un coût n'est pas strictement positif ou n'est pas
fini ; le moteur se rabat sur le paramètre `quantile_cible_production_bp`. Le repli qui existait
(0,5) était lui-même fautif : c'est **la médiane**, que `docs/03` interdit explicitement de produire.

Deux gardes de même famille posées au passage : `unites.ts` refuse une densité `NaN` ou `Infinity`
(sans quoi une seule ligne `NaN` rendait `NaN` le stock entier, sa valorisation et tout coût matière
en aval, **sans jamais lever**) ; `prevoir` refuse une baseline non finie.

---

## Famille 4 — Violation de clé étrangère → 500 générique

**Fichiers.** `packages/db/src/services/sessions.ts`, `.../reception.ts`, `.../afsca.ts`,
`packages/db/src/depots/comptabilite.ts`

**Cause racine.** Aucune vérification avant l'écriture : la référence inconnue ne se manifestait que
par une violation de contrainte SQLite, remontée en 500 sans nommer le champ fautif.

**Incohérence la plus parlante.** Dans une **même réception**, un `ingredientId` inconnu rendait un
404 métier nommé, et un `fournisseurId` inconnu un 500. Deux comportements pour la même faute.

**Sous-famille la plus dangereuse.** Un identifiant qui **existe** mais désigne un autre type
d'objet — un identifiant de lieu passé là où une recette est attendue. Le typage TypeScript n'y voit
rien, et la clé étrangère ne se déclenche qu'à l'écriture.

**Correction.** Les références sont vérifiées **avant** l'écriture, et avant toute allocation de
numéro de série : un numéro consommé pour rien est un trou dans une numérotation légalement sans
trou.

---

## Famille 5 — Deux conventions pour la même faute de saisie

**Fichier.** `apps/api/src/routes/sessions.ts`

`GET /api/seuils?annee=abc` rendait **404** « Exercice introuvable », là où
`GET /api/synthese-exercice?annee=abc` rendait **422** avec le champ désigné. L'écran ne pouvait pas
savoir où accrocher le message.

**Correction, et règle désormais uniforme :**

| Situation                                                | Statut             | Pourquoi                                                |
| -------------------------------------------------------- | ------------------ | ------------------------------------------------------- |
| La ressource **adressée dans l'URL** n'existe pas        | **404**            | Il n'y a rien à corriger dans un formulaire             |
| Une référence **saisie dans un formulaire** est invalide | **422** + `champs` | L'écran doit savoir sur quel champ accrocher le message |

---

## Ce que le test de non-régression couvre

`apps/api/src/routes/erreurs-500.test.ts` — 19 cas, base en mémoire, `app.inject()`, aucun appel
réseau. Chaque cas vérifie un statut **strictement inférieur à 500**, un message de plus de
15 caractères, et l'**absence de toute fuite technique** (`SQLITE`, `SELECT`, trace de pile, chemin
de fichier `.ts:`).

| Famille testée          | Cas                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Corps malformés         | JSON tronqué, `{}`, `null`, `[]`, `Content-Type` non supporté, sur 4 routes d'écriture |
| Références inexistantes | lieu, fournisseur (×2), session ; + 4 croisements d'identifiants du **mauvais type**   |
| Dates aberrantes        | `2026-02-30`, an 1900, an 3000, chaîne libre, chaîne vide, exercice antérieur          |
| Querystring             | année illisible, vide, répétée                                                         |
| Transitions interdites  | valider / envoyer une commande inexistante, clôturer une session inexistante           |
| Identifiants hostiles   | 6 charges × 5 routes de détail, puis vérification que la base répond encore            |
| Valeurs limites         | montants négatif, nul, `MAX_SAFE_INTEGER`, fractionnaire ; quantité négative           |

## Ce qui est solide, et vérifié

- **Pas d'injection SQL.** Drizzle lie ses paramètres : après un déluge de charges hostiles sur cinq
  routes, la base répond normalement et aucune trace SQL ne fuite.
- **Pas de traversée de chemin.** Les routes servant un fichier résolvent l'objet **en base** avant
  de toucher le disque.
- **Aucune fuite de secret.** Ni `ANTHROPIC_API_KEY` ni les identifiants SMTP n'apparaissent dans une
  réponse, y compris dans les messages d'erreur.
- **Modes dégradés en 200, pas en 500** : IA sans clé, météo indisponible, mail en mode test.

## Limite de cet audit

Il porte sur la **surface HTTP**. Un 500 déclenché par une panne d'infrastructure (disque plein,
fichier de base corrompu, Chromium absent) n'est pas couvert : ces cas restent des 500 légitimes,
et c'est le comportement voulu.
