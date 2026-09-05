# Audit d'interface — 27 juillet 2026

## Statut de cet audit : COMPLET

Les douze écrans ont été parcourus au clavier, touche par touche, à 1280×720. Les deux
interruptions d'API des tentatives précédentes sont réparées : le périmètre annoncé
(« NON vérifié — reste à faire ») est entièrement traité.

Ce document consigne **ce qui a été mesuré**, jamais ce qui a été supposé. Les ratios de
contraste sont des mesures faites sur les éléments réellement rendus, pas des lectures de
jetons.

## Pourquoi le clavier compte ici

`CLAUDE.md` §3 règle 10 : « Chaque écran doit être utilisable au clavier. La saisie post-marché
est répétitive : tabulation, entrée, chiffres. Pas de souris obligatoire. »

Ce n'est pas de l'accessibilité de principe. Le dimanche soir, après six heures de marché, deux
personnes saisissent des dizaines de lignes de vente. Une souris obligatoire coûte des minutes
réelles à chaque session.

---

## Corrigé et vérifié — première passe

### Lien d'évitement (WCAG 2.4.1 « Bypass Blocks », niveau A)

**Constat mesuré avant correction :** 13 tabulations pour traverser la navigation avant
d'atteindre le premier contrôle du contenu — sur **chaque** écran et à **chaque** chargement.

**Correction.** Un bouton « Aller au contenu » en tête de `Navigation.tsx`, hors écran tant
qu'il n'a pas le focus. C'est un `<button>` et non un `<a href="#…">` parce que le `<main>`
d'`App.tsx` ne porte pas d'`id` : le focus est déplacé par script, `tabIndex = -1` posé au
moment du clic. La technique WCAG vise la **fonction** — atteindre le contenu — pas l'élément.

**Revérifié dans cette passe :** premier arrêt de tabulation sur les douze écrans, anneau de
focus visible. Fonctionne.

### Contraste des textes secondaires

`text-ink-4` remplacé par `text-ink-3` sur les libellés de facteurs neutres de l'écran
« Prochaine session ». **Revérifié :** plus aucun `ink-4` en échec dans le balayage complet.

### Largeurs de colonnes — cinq tableaux corrigés

| Écran          | Défaut constaté                                                     | Correction                               |
| -------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| Événements     | Formulaire toujours ouvert : table à 8 colonnes tronquées           | Formulaire escamotable, fermé par défaut |
| Événements     | En-têtes « INTENSIT », « IMPACT MESUR » coupés                      | Largeurs rééquilibrées, somme à 100 %    |
| Registre AFSCA | « TEMPÉRATURE (°C » coupé, dernière colonne hors panneau            | En-tête raccourci                        |
| Comptabilité   | Bouton « Marquer faite » débordant ; « DERNIÈRE RÉALISATION » coupé | Colonne d'action à 18 %                  |
| Achats         | En-tête « LIGNES » coupé à 6 %                                      | Porté à 9 %                              |

---

## Corrigé et vérifié — seconde passe (cet audit)

### 1. Onglets du Registre AFSCA — la promesse ARIA n'était pas tenue

C'était « le défaut ARIA le plus net » signalé par la tentative précédente. Confirmé.

`RegistreAfsca.tsx` déclarait `role="tablist"`, `role="tab"` et `aria-selected`, mais il
manquait tout ce qui rend ces rôles utilisables :

| Manquait                                 | Conséquence mesurée                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id` + `aria-controls` sur chaque onglet | Aucun lien onglet → panneau pour le lecteur d'écran                                                                                       |
| `aria-labelledby` + `id` sur le panneau  | Le panneau ne se rattachait à rien                                                                                                        |
| Navigation par flèches ← → Home Fin      | Les flèches ne faisaient rien                                                                                                             |
| Tabindex glissant                        | **Les cinq onglets étaient dans le parcours** : 5 tabulations pour traverser la barre avant d'atteindre le premier champ, à chaque saisie |
| Anneau de focus                          | **Aucun `focus-visible`** sur les onglets : au clavier, la position était invisible                                                       |

Un `role="tablist"` fait une promesse : `Tab` entre dans la barre, les **flèches** changent
d'onglet, `Tab` en ressort vers le contenu. Déclarer les rôles sans le comportement est pire
que de ne rien déclarer, parce que l'utilisateur de lecteur d'écran cherche alors des flèches
qui ne répondent pas.

**Correction** : motif « Tabs » de l'ARIA Authoring Practices, complet. `id`, `aria-controls`,
`aria-labelledby`, tabindex glissant, flèches ← → avec bouclage, Home/Fin, `preventDefault`
pour ne pas faire défiler la page, anneau de focus sur chaque onglet.

**Décision consignée :** le panneau ne reçoit **pas** `tabIndex={0}`. L'APG ne le rend
focalisable que s'il ne contient aucun élément focalisable, ce qui n'est le cas d'aucun des cinq
onglets ; l'ajouter coûterait une tabulation de plus avant le premier champ, à chaque saisie.

**Vérifié réellement au clavier**, pas déduit du code :

- `→` depuis « Températures » : focus **et** sélection **et** panneau passent à « Nettoyage » ;
- `Fin` puis `→` : boucle correctement sur le premier onglet ;
- `window.scrollY` reste à 0 sur les flèches — le `preventDefault` fonctionne ;
- barre traversée en **1** tabulation au lieu de 5.

### 2. `AUJOURD_HUI` figé au chargement du module — antidatage par l'interface

Le défaut signalé était réel, et **il était présent dans six écrans**, pas un seul.

`const AUJOURD_HUI = jourCivilBelge(new Date())` au niveau du module n'est évalué qu'une fois,
à l'import. L'application est un poste de bureau qu'on laisse ouvert plusieurs jours : le lundi,
le formulaire proposait encore la date du vendredi.

| Fichier             | Gravité                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RegistreAfsca.tsx` | **Antidatage réglementaire** — 8 usages, dont la date de relevé de température, la date d'exécution de nettoyage, la date de constat de non-conformité |
| `Sessions.tsx`      | Antidatage — date de création de session                                                                                                               |
| `Production.tsx`    | Antidatage — date de production                                                                                                                        |
| `Comptabilite.tsx`  | Antidatage — date de dépense, date d'immobilisation                                                                                                    |
| `Stock.tsx`         | Affichage — compte à rebours DLC vieillissant                                                                                                          |
| `TableauDeBord.tsx` | Affichage — compte à rebours DLC vieillissant                                                                                                          |

Sur les quatre premiers, une date périmée **part en base** et l'utilisateur n'a aucun moyen de
le voir. `CLAUDE.md` §7 exige que le registre porte la date de saisie réelle.

**Défaut de même nature trouvé en prime :** `ANNEE_COURANTE` dans `Comptabilite.tsx`, également
figée à l'import, alimentait le corps du POST de clôture mensuelle. Un poste laissé ouvert le
soir du 31 décembre aurait clôturé janvier 2027 sous l'exercice 2026.

**Correction** : nouveau `apps/web/src/lib/dates.ts` exposant `aujourdHui()`, lu à chaque appel.
En initialisation d'état, `useState(aujourdHui)` — React appelle l'initialiseur paresseux au
premier rendu du composant, donc à l'ouverture de l'écran. Dans un gestionnaire, `aujourdHui()`,
évalué au clic. Idem `anneeCourante()`.

### 3. `aria-selected` sur une rangée de `<table>` : ignoré par les lecteurs d'écran

`composants/Tableau.tsx` posait `tabIndex={0}` et `aria-selected` sur les `<tr>`
sélectionnables. Or `aria-selected` **n'est valide que dans un `grid` ou un `treegrid`** : sur
une rangée de `<table>` ordinaire, NVDA, JAWS et VoiceOver l'ignorent purement et simplement.

La rangée active était donc surlignée à l'écran **sans que rien ne l'annonce** : l'état
n'existait que pour les voyants. Écrans concernés : Sessions, Stock, Recettes, Production,
Registre AFSCA, Événements.

**Correction** : `role="grid"` sur le `<table>`, **uniquement** quand `onSelectionnerLigne` est
fourni. Un tableau de consultation pure reste un `table`, qui se lit mieux. Le sélecteur CSS
`tbody tr[aria-selected='true'] td` d'`index.css` continue de fonctionner — c'est un sélecteur
d'attribut, indifférent à la validité ARIA.

### 4. `aria-expanded` manquant sur trois panneaux escamotables

| Écran        | Bouton                      | État         |
| ------------ | --------------------------- | ------------ |
| Événements   | « Nouvel événement »        | Déjà correct |
| Sessions     | « Nouvelle session »        | **Ajouté**   |
| Comptabilité | « Nouvelle dépense »        | **Ajouté**   |
| Comptabilité | « Nouvelle immobilisation » | **Ajouté**   |

Sur ces trois boutons, le libellé ne change pas à l'ouverture et le focus ne bouge pas :
`aria-expanded` était le seul signal possible.

**Faux positif écarté :** les deux « Voir le détail » du Tableau de bord **naviguent**
(`navigate('/prochaine-session')`, `navigate('/sessions')`) — ce ne sont pas des panneaux
escamotables, `aria-expanded` y aurait été un mensonge de plus.

### 5. Deux boutons « Voir le détail » identiques, destinations différentes

Sur le Tableau de bord, un utilisateur de lecteur d'écran qui liste les boutons de la page
entendait « Voir le détail » deux fois, sans pouvoir les distinguer (WCAG 2.4.4). Le libellé
visible reste court ; `aria-label` porte désormais la destination.

### 6. Messages de succès jamais annoncés

Les confirmations transitoires (« Relevé enregistré », « Exécution enregistrée »…) sont rendues
puis effacées au bout de 5 secondes. Sans région live, **un lecteur d'écran ne les annonce
jamais** : l'utilisateur ne sait pas si son enregistrement a abouti.

**Correction** : `role="status"` (donc `aria-live="polite"`) sur les **13** messages de succès
des écrans Achats, Événements, Prochaine session, Production, Registre AFSCA, Sessions.

### 7. Huit troncatures encore présentes — dont deux pertes d'information réelles

La première passe avait corrigé cinq tableaux. En mesurant `scrollWidth > clientWidth` sur
**chaque** `th` et `td` des quatorze écrans plutôt qu'en regardant les captures, huit troncatures
subsistaient. Deux d'entre elles ne sont pas cosmétiques.

| Écran              | Défaut mesuré                                                        | Correction                     |
| ------------------ | -------------------------------------------------------------------- | ------------------------------ |
| **Registre AFSCA** | **« ■ Non conforme » coupé de 33 px → « Non conform »**              | Statut 14 % → 18 %             |
| Registre AFSCA     | « 27/07/2026 » coupé de 3 px                                         | Date 12 % → 13 %               |
| Registre AFSCA     | En-tête « Relevé par » coupé de 6 px                                 | 9 % → 10 %                     |
| Registre AFSCA     | En-tête « Action corrective » coupé de 10 px                         | 15 % → 18 %                    |
| **Paramètres**     | **Clés coupées jusqu'à 149 px, sans `titre`**                        | Clé 24 % → 32 % + `titre`      |
| **Paramètres**     | **« 25 000,00 € », « 23 000,00 € », « 17 374,08 € » coupés de 5 px** | Valeur 11 % → 12 % + `titre`   |
| Paramètres         | En-tête « Début de validité » coupé de 25 px                         | Raccourci en « Valide depuis » |
| Paramètres         | « decimal » coupé de 9 px                                            | Type 8 % → 9 %                 |
| Production         | « 27/07/2026 » coupé de 15 px                                        | Date 10 % → 12 %               |
| Recettes           | En-tête « Sans gluten » coupé de 13 px                               | 20 % → 25 %                    |
| Sessions           | En-tête « Projection fin d'année (€) » coupé de 17 px                | 20 % → 22 %                    |
| Sessions           | « Historique insuffisant » coupé de 27 px                            | Trajectoire 16 % → 20 %        |

**Les deux pertes d'information réelles :**

1. **Registre AFSCA, colonne Statut.** « Non conforme » s'affichait « Non conform ». Sur un
   registre réglementaire, le statut de conformité est précisément l'information que l'AFSCA
   vient lire. Aucune colonne ne mérite moins d'être rognée que celle-là.

2. **Paramètres, colonne Clé.** `ia_tarif_commentaire_entree_micro_cents` et
   `ia_tarif_commentaire_sortie_micro_cents` s'affichaient **tous deux**
   « ia_tarif_commentaire_e… ». Deux paramètres distincts, strictement indiscernables à
   l'écran, et sans `titre` pour récupérer la valeur au survol. La clé est l'identifiant de la
   rangée : elle a reçu de la largeur **et** un `titre`, comme Source et Description en avaient
   déjà un.

Toutes les largeurs de colonnes ont été reprises sur des colonnes qui portent un `titre` et
peuvent donc se tronquer sans perte. **Somme vérifiée à exactement 100 % sur les onze tableaux.**

---

## Vérifié sain — mesuré, pas supposé

| Point                                | Constat                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pièges de focus**                  | **Aucun** sur les douze écrans. Les deux « boucles » détectées étaient le bouclage normal du document sur le lien d'évitement                                 |
| **Focus visible**                    | **Aucun** élément focalisable sans anneau visible, sur l'ensemble des douze parcours (hors onglets AFSCA, corrigés ci-dessus)                                 |
| **`<label>` associé**                | **Zéro** champ sans étiquette sur les douze écrans, y compris Sessions, Production, Comptabilité, Registre AFSCA et Événements. Point déjà sain avant l'audit |
| **`role="alert"` sur les erreurs**   | Déjà appliqué systématiquement : 32 occurrences sur 11 écrans. Rien à corriger                                                                                |
| **Débordement horizontal à 1280 px** | **Aucun** sur les quatorze écrans, Registre AFSCA, Comptabilité et Sessions compris                                                                           |
| **Troncature de colonne**            | **Aucune** après correction — mesure `scrollWidth > clientWidth` sur chaque `th` et `td` des quatorze écrans                                                  |
| **Somme des largeurs de colonnes**   | Exactement **100 %** sur les onze tableaux                                                                                                                    |
| **Erreurs console**                  | Aucune imputable à l'interface (voir la réserve ci-dessous)                                                                                                   |
| **Un seul `text-3xl` par écran**     | Respecté                                                                                                                                                      |
| **Un seul `<h1>` par écran**         | Respecté sur les quatorze                                                                                                                                     |
| **Contraste des statuts colorés**    | `conforme`, `alerte`, `depassement` passent AA sur tous leurs fonds — aucun signalement                                                                       |
| **Rangées de tableau au clavier**    | Atteignables par `Tab`, activables par `Entrée` **et** `Espace`                                                                                               |

**Réserve sur les erreurs console.** Des 500 sont apparus pendant le balayage sur
`/api/recettes`, `/api/productions` et `/api/parametres`. Vérification faite dans le journal du
serveur : `ECONNREFUSED 127.0.0.1:3001`, avec changement de PID à chaque fois — c'est
`tsx watch` qui redémarrait pendant les modifications en cours sur `apps/api`. **Transitoire,
pas un défaut de l'interface.** À reconfirmer sur une API stable.

---

## À corriger hors de mon périmètre

### Contraste des en-têtes de tableau — ÉCHEC AA sur huit écrans

C'est le défaut de contraste le plus répandu de l'application, et il touche le texte le plus
répété : **l'en-tête de chaque colonne de chaque tableau**.

`apps/web/src/index.css` **ligne 335** : `thead th { color: var(--color-ink-3) }`, sur un fond
posé ligne 328 à `var(--color-surface-sunken)`.

|                         | Valeur     |
| ----------------------- | ---------- |
| Encre `--ink-3`         | `#71717a`  |
| Fond `--surface-sunken` | `#ebebed`  |
| **Ratio mesuré**        | **4,06:1** |
| Seuil AA à 11 px        | 4,5:1      |
| Verdict                 | **Échec**  |

**La cause est un commentaire juste mais incomplet.** `index.css` ligne 45 annonce
« Contrastes verifies sur --surface », et ligne 48 `--ink-3: #71717a; /* 4,88:1 — AA respecte */`.
C'est exact **sur blanc**. Mais le seul endroit où `ink-3` est massivement employé — les
en-têtes collants — est justement celui où le fond n'est pas blanc : `thead th` impose
`surface-sunken` pour signaler « ceci est du chrome, pas de la donnée ». Le jeton passe donc son
test dans l'abstrait et échoue à l'usage.

**Correction recommandée, une ligne :** `index.css` ligne 335, `var(--color-ink-3)` →
`var(--color-ink-2)`. Mesuré : **8,77:1**. Écrans concernés : Sessions, Stock, Achats, Recettes,
Événements, Comptabilité, Registre AFSCA, Production.

Il vaudrait aussi la peine de corriger le commentaire de la ligne 48 : « 4,88:1 sur `--surface`,
**4,06:1 sur `--surface-sunken` — ne pas utiliser sur fond sunken** ».

_(Non corrigé par moi : `index.css` est explicitement hors périmètre.)_

> **Mise à jour du 30/07/2026 — corrigé.** `apps/web/src/index.css:339` utilise désormais
> `var(--color-ink-2)` pour `thead th`, avec un commentaire `:334-338` qui explique exactement le
> raisonnement recommandé ici (« `ink-3` y tombe à 4,06:1 — sous le seuil AA — … `ink-2` donne
> 8,77:1 »). Le jeton `--ink-3` (`:48`) porte cependant toujours son ancien commentaire
> « 4,88:1 — AA respecté », sans la nuance « pas sur fond sunken » suggérée juste au-dessus — ce
> point précis de la recommandation n'a pas été repris.

### Écran Paramètres : aucun contrôle interactif

`/parametres` affiche ses 43 paramètres mais ne présente **aucun** élément focalisable : l'écran
est en lecture seule. `CLAUDE.md` §7 demande que les taux et seuils réglementaires vivent dans la
table `parametre` avec date de validité et **soient paramétrables** ; §6 précise « valeurs par
défaut paramétrables en base, jamais des constantes codées en dur ». Aujourd'hui il faut passer
par SQL pour changer un seuil.

Ce n'est pas un défaut d'accessibilité mais une question de périmètre fonctionnel, signalée ici
parce qu'elle est apparue pendant le parcours clavier — un écran sans aucun arrêt de tabulation
est un signal.

> **Mise à jour du 30/07/2026 — corrigé**, déjà signalé « à NE PAS rouvrir » par
> `docs/17-VINGT-AMELIORATIONS.md` §2 (« G8 — écran Paramètres en lecture seule »). L'écran a
> désormais des arrêts de tabulation : `apps/api/src/routes/parametres.ts` expose
> `PATCH /parametres/:id` et `POST /parametres/:cle/versions`, consommées par
> `apps/web/src/pages/Parametres.tsx:637` et `:510`. Le nombre de paramètres a aussi changé depuis
> la rédaction (43 ici) — 98 aujourd'hui, comptés dans `packages/core/src/parametres.ts`
> (`CATALOGUE_PARAMETRES`) ; ce n'est plus vraiment un chiffre comparable, le catalogue ayant
> beaucoup grossi entre-temps.

### Produits et Fournisseurs

Placeholders assumés. Constaté, non construit, conformément à la consigne.

> **Mise à jour du 30/07/2026 — corrigé, les deux écrans sont construits.**
> `apps/web/src/pages/Produits.tsx` (907 lignes) et `apps/web/src/pages/Fournisseurs.tsx`
> (738 lignes) sont désormais des formulaires complets de création/modification (`useState` de
> brouillon, validation, gestion d'erreurs par champ), pas des placeholders. Les routes d'écriture
> existent côté API dans `apps/api/src/routes/referentiel.ts` : `POST /produits` (`:122`),
> `PATCH /produits/:id` (`:130`) et `PATCH /produits/:id/activite` (`:138`) ; `POST /fournisseurs`
> (`:82`), `PATCH /fournisseurs/:id` (`:90`) et `PATCH /fournisseurs/:id/activite` (`:99`). Confirmé
> côté usage réel par `docs/14-TEST-PARCOURS-UTILISATEUR.md` (« Produits / Fournisseurs /
> Événements. Formulaires de création présents et fonctionnels »).

---

## Recommandation non appliquée, à arbitrer

**Navigation des rangées de tableau aux flèches ↑ ↓.** Sur Stock, huit rangées coûtent huit
tabulations. Le motif `grid` que je viens de déclarer autoriserait des flèches verticales, ce qui
servirait directement l'objectif de saisie post-marché. Je ne l'ai **pas** implémenté : cela
change le comportement d'un composant partagé par les douze écrans et détournerait les flèches à
l'intérieur de toute cellule contenant un champ. À décider explicitement.

---

## Leçon de méthode

`tsc` et `eslint` sont passés au vert sur **la totalité** des défauts de cet audit : les huit
troncatures de colonnes, les six `AUJOURD_HUI` figés, les rôles ARIA incomplets, les
13 messages de succès muets, les 4,06:1 des en-têtes. Aucun outil statique ne voit qu'un rôle
ARIA ment, qu'une date part périmée en base, qu'un en-tête est illisible, ni que deux paramètres
différents s'affichent avec le même texte.

Trois techniques ont attrapé ce que la relecture de code n'attrapait pas :

1. **La tabulation réelle, touche par touche**, sur les quatorze écrans — pas la lecture du JSX.
   C'est ce qui a montré que les cinq onglets AFSCA mangeaient cinq tabulations et n'avaient
   aucun anneau de focus.
2. **La mesure de contraste sur les éléments rendus**, pas sur les jetons. Un jeton peut être
   documenté « 4,88:1 — AA respecté » et échouer à 4,06:1 partout où il sert vraiment, parce que
   sa vérification a été faite sur un fond qu'il ne rencontre jamais.
3. **`scrollWidth > clientWidth` sur chaque cellule**, plutôt que l'œil sur une capture. Une
   troncature de 3 px est invisible à la relecture et reste une donnée perdue ; c'est aussi
   comme cela qu'on découvre que deux lignes distinctes affichent le même texte.

La capture d'écran reste indispensable pour juger — mais elle confirme, elle ne détecte pas.
