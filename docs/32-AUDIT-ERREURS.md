# 32 — Audit des erreurs vues par l'utilisateur (CLAUDE.md §4)

> Angle jamais vérifié jusqu'ici : `docs/10-AUDIT-ERREURS-500.md` a déjà traqué les 500 (« un 500
> est toujours un défaut »). Cet audit-ci prend les DEUX autres phrases du §4 des conventions de
> code — « jamais de `catch` silencieux, erreurs métier typées, remontées en français
> compréhensible » et « Zod à toutes les frontières » — et les vérifie ligne à ligne sur
> `apps/api/src/**` (hors `routes/comptabilite.ts`, confié à un autre agent en parallèle). Périmètre :
> ce que deux personnes lisent un dimanche soir quand quelque chose rate, pas ce qui s'affiche
> quand tout marche.

---

## 1. Les quatre nombres

| Catégorie                            | Nombre                                                                                                                                                          | Balayage (commande exacte)                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `catch` silencieux trouvés           | **0** au sens strict (aucun catch qui avale une erreur sans la remonter typée) — **1 catch qui transforme un échec réel en valeur fausse**, classée à part (§2) | `grep -n "catch\s*(" apps/api/src -r` puis `grep -n "catch\s*{" apps/api/src -r` puis lecture intégrale des **5 fichiers de production** qui en contiennent (`ia/client.ts`, `meteo/open-meteo.ts`, `itineraire/client.ts`, `routes/evenements-decouverte.ts`, `documents/rendu.ts` — confirmé exhaustif par `grep -rn "^\s*try\s*{" apps/api/src`, 5 fichiers non-test) |
| Réparés                              | **1** (`routes/evenements-decouverte.ts`, `coutCents: 0` → calcul réel)                                                                                         | voir §2                                                                                                                                                                                                                                                                                                                                                                  |
| Messages incompréhensibles à l'écran | **0** trouvé                                                                                                                                                    | lecture de `plugins/erreurs.ts` (le point de passage UNIQUE de toute erreur HTTP) + les deux balayages déjà existants `routes/erreurs-500.test.ts` (19 cas) et `routes/audit-robustesse.test.ts` (116 cas), qui vérifient déjà `message.length > 10/15` et l'absence de `SQLITE\|SELECT \|INSERT \|at \w+ (\|.ts:\d+` sur TOUTE réponse d'erreur du serveur complet      |
| Frontières sans Zod                  | **1 sans AUCUNE validation, corrigée** + **8 avec une validation plus faible que Zod (documentées, non corrigées, dont une hors zone)**                         | voir §4, dérivé de `grep -n "requete\.\(body\|query\|params\)" apps/api/src/routes -r` croisé avec `grep -n "\.parse(" ` sur les mêmes fichiers                                                                                                                                                                                                                          |

Le solde est volontairement asymétrique : ce dépôt a déjà, avant cet audit, un mécanisme
centralisé (`plugins/erreurs.ts`) et deux balayages exhaustifs qui rendent la classe 2 (message
incompréhensible) et une bonne partie de la classe 1 (catch silencieux) **structurellement
difficiles à réintroduire**. Ce qui restait à trouver était plus fin — voir ci-dessous.

---

## 2. L'erreur qui devient une valeur — la plus grave, trouvée et réparée

**Fichier.** `apps/api/src/routes/evenements-decouverte.ts`, fonction
`rechercherEvenementsParClaude`, bloc `catch (cause)` (~ligne 351, avant correction).

**Le défaut.** La boucle de relance après `pause_turn` accumule `tokensEntreeTotal` /
`tokensSortieTotal` au fil des tours **réellement exécutés et facturés**. Si un tour ultérieur
échoue (panne réseau, erreur 5xx du fournisseur), le `catch` journalisait déjà les tokens réels
accumulés — mais écrasait **inconditionnellement** `coutCents` à `0`, alors même que le chemin
nominal juste en dessous (succès complet) et le chemin « plafond franchi en cours de recherche »
(interruption **volontaire**) calculent tous deux le coût réel avec la MÊME formule
(`coutAppelCents(tokensEntreeTotal, tokensSortieTotal, tarif) + coutRechercheWebCents(...)`).

Autrement dit : un tour 0 réussi (tokens réellement consommés, réellement facturés par Anthropic)
suivi d'une panne au tour 1 faisait disparaître la dépense du tour 0 du journal `journal_ia` —
exactement le mécanisme que `packages/db/src/depots/ia.ts` dit vouloir empêcher dans son propre
commentaire de tête (« un appel qui a échoué après consommation de tokens a quand même coûté
quelque chose »). C'est le mensonge visé par CLAUDE.md §3 règle 2 (« une valeur inconnue vaut
`null`, jamais 0 ») — sauf qu'ici la valeur n'était même pas inconnue : les tokens qui la
déterminent étaient déjà dans le MÊME objet journalisé, deux champs plus haut.

**Conséquence réelle.** Le plafond mensuel Claude (`plafond_ia_mensuel_cents`, CLAUDE.md §5)
sous-compte silencieusement la dépense d'un mois où une recherche multi-tours a échoué en cours de
route — exactement le genre d'écart qui ne se voit qu'après coup, à la facture Anthropic réelle.

**Correction.** Le `catch` calcule désormais `coutCents` avec la même formule que les deux autres
chemins, à partir des totaux déjà accumulés — aucune formule nouvelle, réutilisation de
`coutAppelCents`/`coutRechercheWebCents` déjà importés dans le fichier.

**Preuve, rouge puis vert.** Nouveau test dans `evenements-decouverte.test.ts` : un premier tour
réussi (40 tokens entrée, 9 sortie, `pause_turn`) suivi d'une panne 5xx simulée par un serveur HTTP
local (jamais l'API Anthropic réelle). Avant correction : `expected 0 to be greater than 0`. Après :
`coutCents > 0`, `tokensEntree`/`tokensSortie` inchangés. Les 17 autres tests du fichier (dont les
deux qui prouvent déjà le comportement correct sur les DEUX AUTRES chemins d'échec) restent verts.

**Pourquoi ce n'est pas un doublon d'un audit précédent.** `routes/audit-robustesse.test.ts`
contient déjà, depuis un audit antérieur, un commentaire affirmant avoir lu ce même `catch`
« ligne à ligne » et conclu qu'il « journalise l'échec ET renvoie un résultat typé ». C'est vrai —
mais cet audit-là vérifiait le CONTRÔLE (échec signalé, jamais un succès muet), pas la VALEUR
journalisée. Les deux propriétés sont indépendantes ; un audit qui prouve la première ne prouve
rien sur la seconde. C'est exactement la leçon du §4 de la mission : compter les `catch` ne suffit
pas, il faut lire ce que chacun écrit.

**À noter, pour comparaison, ce qui N'est PAS un défaut.** `apps/api/src/ia/client.ts` a un
`catch` presque identique qui journalise aussi `coutCents: 0`. Différence structurante :
`demanderCommentaire` ne fait **qu'un seul** appel réseau — si CET appel échoue, aucun tour
précédent n'a pu consommer de tokens (contrairement à la boucle multi-tours
d'`evenements-decouverte.ts`) : `0` y est donc **factuellement correct**, pas une valeur de repli.
Vérifié en lisant les deux fichiers côte à côte avant de conclure — un `catch` qui ressemble à un
défaut au premier coup d'œil peut être juste ailleurs, pour une raison structurelle précise.

---

## 3. Gardes qui ne peuvent jamais se déclencher

**Dans ma zone, une seule trouvée**, à faible enjeu et déjà noté comme tel par l'auteur :
`apps/api/src/routes/previsions.ts:1167`, `if (baseline === undefined) continue; // ne peut pas
arriver : lieu deja liste ci-dessus.` — un filet de sécurité TypeScript autour d'un `Map.get()`
dont la clé est garantie présente par construction (le lieu vient de `new Set(occurrences.map(...))`
juste avant). Inoffensif : coûte une ligne, ne fait rien de trompeur, et l'auteur savait déjà qu'il
ne se déclencherait jamais (commentaire explicite). Pas un défaut à corriger, juste consigné parce
que la mission demande de signaler ce type de garde.

**Hors zone, déjà documentée ailleurs, pour mémoire.** `docs/07-DOCTRINE-ERP-ET-DESIGN.md` §6.8
consigne déjà le cas le plus significatif du dépôt : `rouvrirPeriode` refuse un statut
`'verrouillee'`, mais **aucun code de production ne pose jamais ce statut** — seule la chaîne
`'verrouillee'` apparaît dans des fixtures de test. Ce garde-fou vit dans
`packages/db/src/depots/comptabilite.ts` et sa route dans
`apps/api/src/routes/comptabilite.ts` — les deux hors de ma zone (l'un par nature, l'autre
explicitement exclu de cette mission). Rien de nouveau trouvé ici, seulement confirmé toujours
d'actualité.

---

## 4. Les frontières sans Zod — dérivées du code, pas énumérées

Méthode : chaque route de `apps/api/src/routes/*.ts` a été confrontée à ses propres accès
`requete.body` / `requete.query` / `requete.params`, pour voir lesquels traversent un
`schemaXxx.parse(...)` et lesquels non — jamais une liste écrite d'avance.

### 4.1 Trouvée et corrigée : zéro validation, pas seulement une validation faible

`GET /afsca/nettoyage/taches-en-retard` (`apps/api/src/routes/afsca.ts`) lisait
`requete.query.dateReference ?? jourCivilBelge(new Date())` et la transmettait **brute** à
`tachesEnRetard` (`packages/db/src/services/afsca.ts`), qui s'en sert pour choisir la version en
vigueur des paramètres réglementaires (`lireParametres(base, dateReference)`) et pour comparer des
dates de session. Aucune des fonctions `analyserJour*` déjà écrites ailleurs dans ce même fichier
et dans `routes/audit.ts` / `routes/objectifs.ts` n'était réutilisée ici. Conséquence mesurée : une
`dateReference` malformée (`abc`, chaîne vide, `2026/07/31`, une charge SQL hostile) ne produisait
**ni 500 ni 422** — un **200 silencieux**, potentiellement sur un mauvais jeu de paramètres
réglementaires. `audit-robustesse.test.ts` (fichier partagé, hors de ma zone) exerçait déjà cette
route avec `dateReference=3000-12-31` — un format valide mais absurde — sans jamais essayer un
format invalide : le trou était invisible à ce balayage précis, qui ne teste que « pas de 500 »,
pas « la frontière est validée ».

**Corrigé** en réutilisant EXACTEMENT la même convention que les fonctions sœurs (regex
`AAAA-MM-JJ`, `ErreurMetier` avec `champs`) : nouvelle fonction `analyserDateReferenceNettoyage`
dans `afsca.ts`. Preuve rouge (5 valeurs malformées → 200 avant correctif) puis verte (422,
`code: 'date_invalide'`, message citant le format attendu, `champs.dateReference` renseigné) dans
le nouveau fichier `apps/api/src/routes/afsca-nettoyage-date-reference.test.ts`. Un test
supplémentaire documente, sans le corriger (limite assumée, partagée avec `analyserJour` et
`analyserJourReference` ailleurs dans ce dépôt), que la regex garantit le FORMAT mais pas la
validité calendaire (`2026-13-45` passe).

### 4.2 Documentées, non corrigées : validation plus faible que Zod, mais pas absente

**Convention répandue de parseurs manuels pour les scalaires de requête**, dans ma zone :
`routes/audit.ts` (`analyserJour`, `analyserAction`, `analyserLimite`), `routes/economies.ts` et
`routes/objectifs.ts` (`analyserAnnee`/`analyserJourReference`), `routes/previsions.ts`,
`routes/sessions.ts` (`comptabilite.ts` fait la même chose mais est hors zone). Chacune de ces
fonctions valide rigoureusement (regex avant conversion, message français, `champs` renseigné) et
est testée — la **substance** de CLAUDE.md §4 est respectée partout où j'ai vérifié. Mais ce n'est
littéralement pas Zod : c'est une réimplémentation manuelle, dupliquée fichier par fichier, de ce
qu'un schéma Zod ferait en une ligne. Je ne l'ai pas réécrite : le risque (une dizaine de routes à
toucher, un mécanisme déjà testé et correct, et au moins un fichier — `comptabilite.ts` — dont je
n'ai pas le droit d'écrire la moitié miroir) est disproportionné par rapport à un gain qui est
d'ordre stylistique, pas comportemental.

**Réponses de services externes castées, jamais Zod.** `meteo/open-meteo.ts`
(`(await reponse.json()) as ReponseOpenMeteo`) et `itineraire/client.ts`
(`(await reponse.json()) as ReponseGeocodage` / `as ReponseDirections`) font un cast TypeScript
brut sur la réponse JSON d'Open-Meteo / OpenRouteService, puis narrowent manuellement au `typeof`
avant tout usage — jamais un `schema.safeParse(...)`. Dans les deux cas, le code est déjà défensif
(un champ absent ou mal typé produit un `null`/`disponible: false`, jamais un crash ni une valeur
inventée) : le risque concret est donc faible. Je ne l'ai **pas** corrigé, et pas seulement pour
limiter le risque de régression : un `schema.parse()` strict sur une réponse d'API externe
**rejetterait entièrement** une réponse partiellement incomplète, là où le code actuel en tire
encore ce qu'il peut (mode dégradé partiel) — remplacer l'un par l'autre pourrait DÉGRADER le
comportement de dégradation que CLAUDE.md §5/§6 exige explicitement, pas seulement le rendre plus
« propre ». Un éventuel futur schéma Zod pour ces deux frontières devrait donc être **permissif
champ par champ** (chaque champ optionnel avec fallback), pas un simple `.parse()` strict — je n'ai
pas jugé ce reboisement proportionné à cette mission.

**Réponses Claude : déjà correctement Zod-validées, pour mémoire.** Vérification faite parce que
CLAUDE.md §4 nomme explicitement cette frontière : le contenu JSON extrait de la réponse texte de
Claude (`extraireTableauJson`) passe bien par
`schemaPropositionsEvenementsIaBrutes.safeParse(brut)` avant d'entrer dans le système
(`evenements-decouverte.ts`), et le commentaire IA de `routes/ia.ts` passe par
`schemaCommentaireIa.parse(reponse)`. Seule l'enveloppe de transport SDK (`reponse.usage.*`,
`stop_reason`…) est lue via les types du SDK Anthropic lui-même, jamais re-validée par un Zod
maison — cohérent avec le fait que c'est le SDK, pas notre code, qui a déjà validé cette forme à la
désérialisation HTTP. Rien à corriger ici ; noté pour que le décompte du §4.2 ne semble pas plus
alarmant qu'il ne l'est.

**Hors zone, documentée seulement.** `schemaPeriodeRequete`
(`packages/core/src/contrats/afsca.ts:442-445`) — utilisée par plusieurs routes de `afsca.ts`
pour `debut`/`fin` — ne valide que `z.string().min(1)` : la NON-VACUITÉ, pas le FORMAT
`AAAA-MM-JJ`. Une valeur comme `debut=xyz&fin=xyz` traverse ce Zod sans erreur et atteint
`relevesTemperaturePeriode`/`nonConformitesPeriode`/`executionsNettoyagePeriode` comme chaîne brute,
avec un résultat qui dépend ensuite d'une comparaison lexicographique SQLite plutôt que d'un refus
explicite. Le correctif vit dans `packages/core`, hors de ma zone d'écriture : je ne l'ai pas
touché, je le signale précisément pour qui a la main dessus.

---

## 5. Ce que cet audit ne prouve pas

- **Il ne couvre pas `routes/comptabilite.ts`** (exclu de la mission) ni `packages/core` /
  `packages/db` / `apps/web` : les mêmes trois catégories (catch, message, Zod) peuvent avoir des
  défauts propres dans ces zones, jamais examinées ici.
- **« Aucun catch silencieux » est vrai pour `apps/api/src` seulement, et seulement pour la forme
  `try/catch`/`.catch()` explicite.** Un échec qui ne passe JAMAIS par un `catch` parce que la
  fonction appelée elle-même avale une erreur en interne (dans `packages/core`/`packages/db`,
  jamais lus en entier ligne à ligne pour cette question précise) ne serait pas détecté par ce
  balayage.
- **La convention de parseurs manuels (§4.2) n'a pas été testée pour des cas limites que Zod
  attraperait automatiquement** (ex. une valeur de requête envoyée deux fois, `?annee=2026&annee=2027`,
  que Fastify transforme en tableau) : je n'ai vérifié ce risque que par lecture, jamais en
  envoyant réellement un tel cas à chaque route concernée.
- **Le nouveau test `afsca-nettoyage-date-reference.test.ts` ne prouve pas la validité calendaire**
  (`2026-13-45` passe toujours, assumé et documenté, pas corrigé).
- **Rien ici ne prouve que le reste du dépôt (fichiers déjà « verts ») restera vert** : je n'ai
  relancé que les fichiers touchés et la suite `apps/api/src` complète une fois ; un autre agent
  modifiant `packages/core`/`packages/db` en parallèle peut faire bouger ce même terrain après
  cette photo.

---

## 6. Travaux annexes effectués dans ma zone, sur demande explicite du coordinateur en cours de mission

Deux demandes ponctuelles, hors du périmètre §4 ci-dessus mais dans ma zone d'écriture, traitées
avant de reprendre l'audit :

1. **`routes/palmares.ts` livré mais jamais enregistré dans `serveur.ts`.** Vérifié que le fichier
   existe et exporte `routesPalmares(base): FastifyPluginAsync` avant d'agir. Corrigé par
   l'import + `await api.register(routesPalmares(base))` dans `serveur.ts`. **Garde ajoutée**
   pour que ce défaut précis (« vert par absence » — une route jamais enregistrée est invisible du
   balayage qui dérive ses routes de la table de routage réelle) ne se reproduise pas :
   `apps/api/src/routes-enregistrement.test.ts`, qui confronte, dérivé du code source (jamais
   énuméré), la liste des factories `routesXxx` exportées par `routes/*.ts` à celles réellement
   importées ET appelées dans `serveur.ts`. Prouvé rouge (retrait temporaire de l'enregistrement du
   palmarès → le test nomme exactement `routesPalmares`) puis vert. Effet de bord détecté et corrigé
   dans la foulée : `routes/integration.test.ts` a son propre balayage anti-fuite dérivé de la
   table de routage, qui exigeait à son tour les deux URLs `/api/palmares/produits` et
   `/api/palmares/fournisseurs` dans sa liste `routes` — ajoutées, même convention que les entrées
   voisines (« signalées par le test de couverture, jamais une relecture »).

2. **Diagnostic demandé sur les deux tests rouges de `previsions.test.ts` (prédicteur « jour de la
   semaine »).** Ni corrigé ni fait passer, conformément à la consigne. Mesuré (script externe,
   aucun fichier de `packages/core` touché) que le jeu de test contient un signal hebdomadaire
   objectivement fort (150 crêpes le dimanche contre 40 le mercredi) et que le rejet en validation
   croisée vient d'une incohérence mécanique entre modules : `baseline.ts`, `tendance.ts` et
   `session-consecutive.ts` filtrent déjà leur historique aux observations strictement antérieures
   à la date cible (anti-fuite leave-one-out) ; `jour-semaine.ts` (et, par le même motif,
   `vacances-scolaires.ts`) ne le fait pas encore. Conclusion transmise au coordinateur : lecture
   (b), pas (a) — voir le fil de conversation pour le détail chiffré point par point.
