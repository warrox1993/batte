# Fiche 18 — Succès, niveaux et objectifs

> **Origine** : idée dictée par le porteur le 29/07/2026, mise en forme par Claude Code.
> **Statut** : brouillon à relire et amender. Rien n'est codé.
> **[À TRANCHER]** = décision attendue. **[HYPOTHÈSE]** = supposition de rédaction.
> **[VÉRIFIÉ]** = constat lu dans le code. **[ALERTE]** = point qui heurte une règle du projet.
>
> **Note de statut — 30/07/2026, vérifiée contre le code (précise la note du 29/07/2026 sur
> l'emplacement d'une fonction).** Implémenté de bout en bout : table `objectif`
> (`packages/core/src/objectifs.ts`, `packages/db/src/depots/objectifs.ts`,
> `apps/api/src/routes/objectifs.ts`, écran `apps/web/src/pages/Objectifs.tsx`) et le moteur de
> succès — les règles pures vivent dans `packages/core/src/succes.ts` (`evaluerPaliersSerie`,
> `evaluerNiveau`, `evaluerAnticipationSeuil`), orchestrées par `calculerSucces`
> (`packages/db/src/depots/objectifs.ts:418`, **pas** `core/succes.ts`), exposées par
> `GET /objectifs/succes`. Un succès est bien une **vue recalculée**, jamais un état stocké
> (règle §5.1).
>
> **La décision structurante du §2.1 (« un palier de CA ne s'affiche jamais nu ») est câblée, pas
> seulement actée par le porteur** : `niveauChiffreAffaires` (`depots/objectifs.ts:271`) attache
> systématiquement `contexteSeuilsLegaux` (les trois seuils légaux et leur statut) au niveau de CA,
> et l'écran `Objectifs.tsx` l'affiche à côté du niveau (ligne 147 et suivantes) — jamais un badge
> seul. Le succès de **préparation** (« sortie de franchise TVA anticipée ») existe aussi :
> `anticipationSeuils`/`evaluerAnticipationSeuil`, qui compare la date de première alerte à 80 % à
> la date de franchissement réel.
>
> Les `[À TRANCHER]` restants ci-dessous (sur quoi asseoir les niveaux au-delà du CA et de
> l'ancienneté, périmètre exact d'un objectif) n'ont pas été revérifiés un par un dans cette passe.
>
> ---
>
> ### ⚠️ Correction du 31/07/2026, à la demande du porteur — la note ci-dessus a couru devant le code
>
> **Elle est exacte aujourd'hui. Elle ne l'était pas quand elle a été écrite**, et c'est ça qu'il
> faut retenir.
>
> Au moment de sa rédaction, la ligne « implémenté de bout en bout » ne valait que pour **les
> succès** — qui sont des vues recalculées, sans table, donc effectivement livrés. **Les objectifs,
> eux, ne l'étaient pas** : la table `objectif` était migrée, et **personne ne l'écrivait ni ne la
> lisait**. J'avais pris l'un pour l'autre en relisant trop vite : les deux vivent dans le même
> fichier de dépôt, et un audit du même jour signalait la table comme inerte pendant que cette note
> annonçait le contraire.
>
> **Le câblage a été fait le 30/07/2026**, et vérifié pour écrire cette correction plutôt que
> supposé : `packages/db/src/depots/objectifs.ts:175` insère, `:214` et `:273` lisent, et quatre
> routes existent — `GET /objectifs`, `POST /objectifs`, `POST /objectifs/:id/annuler`,
> `GET /objectifs/succes`.
>
> **La leçon, qui dépasse cette fiche** : une note de statut est une **affirmation vérifiable**, pas
> un résumé d'intention. Écrite pendant que le code bouge, elle vieillit en quelques heures — et une
> note qui annonce « livré » trop tôt est plus coûteuse qu'une absence de note, parce qu'elle
> **empêche de rouvrir** le sujet. Trois autres textes du dépôt se sont révélés faux de la même
> façon pendant la campagne du 30 au 31/07 : un commentaire de colonne, deux commentaires de test, et
> une décision d'architecture qui affirmait un comportement d'écran inexistant (D-037).
>
> La note d'origine reste ci-dessus, intacte : voir qu'un document a couru devant le code a de la
> valeur.

---

## 1. La demande, dans ses mots

> « Dans cette application tu peux aussi rajouter des **succès façon comme dans les jeux**. Et des
> **niveaux selon les ventes et les objectifs**. »

Cohérent avec la direction déjà donnée le 29/07 : s'inspirer de **Big Ambitions** sur les écrans de
**lecture**, en laissant les écrans de **saisie** secs et rapides. Un succès est un objet de
lecture — il est à sa place.

Et ce n'est pas un gadget : à deux, sans salariés, sans client à qui rendre des comptes, la seule
récompense d'un dimanche à 5 h du matin est celle qu'on se donne. Un outil qui la rend visible fait
un vrai travail.

---

## 2. **[ALERTE] Le piège propre à ce métier : un palier de CA ne doit jamais s'afficher seul**

C'est le point central de cette fiche, et il n'est pas évident.

**Un système de succès encode ce qu'on considère comme une réussite.** Ce qu'on félicite, on le
cherche. Ici la croissance est bien l'objectif (§2.1) — mais elle traverse des **seuils qui changent
le régime fiscal et social**, et l'application le sait déjà.

**[VÉRIFIÉ]** `CLAUDE.md` §6 fixe trois seuils légaux, franchis sans préparation ils coûtent cher :

- **25 000 €** de CA/an → sortie de la franchise TVA
- **23 000 €** de CA/an → perte de l'éligibilité à l'aide Airbag du Forem
- **17 374,08 €** de revenu net → perte de la cotisation réduite du complémentaire

**[VÉRIFIÉ]** L'application **alerte déjà à 80 %** de ces seuils.

> Un badge « **20 000 € de chiffre d'affaires, bravo !** » s'afficherait donc exactement au moment
> où l'autre écran affiche **« attention, vous approchez de la sortie de franchise TVA »**.
>
> Deux messages contradictoires, sur la même donnée, dans la même application. Et le badge est plus
> agréable à croire que l'alerte.

### 2.1 Correction — la croissance EST l'objectif, le badge doit juste dire la suite

J'avais d'abord écrit qu'aucun succès ne devait récompenser le chiffre d'affaires. **Le porteur a
corrigé** : _« mon but est de grossir le plus possible, et le plus rapidement et solidement
possible. Donc non, 0 limite d'argent. »_

Il a raison, et ma formulation était fausse. Un seuil légal n'est **pas un plafond**, c'est un
**changement de régime** : franchir 25 000 € veut dire sortir de la franchise TVA, ce qui est une
étape normale d'une activité qui grandit — pas un échec.

**[À TRANCHER] — la décision structurante de cette fiche, reformulée :**

- **Un succès peut célébrer le chiffre d'affaires**, sans limite.
- **Mais il ne doit jamais s'afficher nu.** Un palier de CA porte toujours, dans le même bloc, **ce
  qu'il implique** : « 20 000 € — vous êtes à 80 % de la franchise TVA ; à 25 000 €, voici ce qui
  change ».
- Le vrai contresens à éviter n'est pas de féliciter la croissance, c'est de la féliciter **sans
  dire la suite**. Un badge qui laisse croire que tout va bien pendant qu'un autre écran alerte est
  une application qui se contredit.
- **Un succès mérite aussi d'être décerné pour la préparation** : « sortie de franchise TVA
  anticipée trois mois à l'avance ». Ce n'est pas le montant qu'on félicite, c'est de **ne pas avoir
  été surpris**.

---

## 3. Ce qui mérite d'être célébré, alors

Le critère : un succès doit récompenser **ce qu'on veut voir se répéter**. Cinq axes s'y prêtent, et
tous se calculent depuis des données déjà en base.

| Axe                       | Exemple de succès                                            | Pourquoi c'est un bon objectif                |
| ------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| **Marge**                 | « marge nette au-dessus de X € sur cinq sessions d'affilée » | c'est ce qui reste, pas ce qui entre          |
| **Gaspillage**            | « une session sans une seule crêpe invendue »                | pure économie, aucun effet de seuil           |
| **Justesse de prévision** | « écart prévision/réel sous 10 % trois fois de suite »       | récompense le pilotage, pas la chance         |
| **Régularité AFSCA**      | « douze semaines de relevés de température sans trou »       | une obligation ennuyeuse rendue gratifiante   |
| **Coût de revient**       | « coût matière par crêpe en baisse sur un trimestre »        | l'inverse exact du CA : plus bas, mieux c'est |

**[HYPOTHÈSE de rédaction]** : la **régularité AFSCA** est le meilleur candidat de tous. C'est une
corvée réglementaire, sans récompense naturelle, et le seul moment où l'on constate qu'elle a été
mal tenue, c'est le jour d'un contrôle. Une série à ne pas casser est précisément le bon levier
pour ce genre de tâche.

**[À TRANCHER]** Les **niveaux** : sur quoi les asseoir ? Le chiffre d'affaires convient — c'est
l'objectif assumé du porteur (§2.1) — à condition que chaque palier annonce le seuil légal suivant
et ce qu'il change. **[HYPOTHÈSE]** un second axe utile en parallèle : l'**ancienneté active**,
c'est-à-dire le nombre de sessions tenues. Elle récompense la persévérance là où le CA récompense
la réussite, et les deux ensemble racontent l'activité plus honnêtement qu'un seul.

---

## 4. Ce qui se cache dessous, et qui vaut mieux que le jeu : les OBJECTIFS

Le porteur dit « niveaux selon les ventes **et les objectifs** ». Or **l'application ne connaît
aucun objectif aujourd'hui**.

**[VÉRIFIÉ]** Elle sait ce qui s'est passé (sessions, marges, seuils) et ce qui va se passer
(prévisions). Elle ne sait pas ce que le porteur **vise**.

C'est un vrai manque d'ERP, indépendamment de toute gamification : dans un ERP classique, cela
s'appelle un **budget**, et c'est un module à part entière.

**[HYPOTHÈSE de rédaction]** : c'est **l'apport le plus solide de cette fiche**. Se fixer un
objectif — de marge mensuelle, de coût par crêpe, de nombre de sessions — et voir l'écart au fil du
temps est utile **même sans un seul badge**. Les succès en deviennent la couche d'affichage ; ils
n'en sont pas la substance.

**[À TRANCHER]** Un objectif porte sur quoi, et sur quelle période ? **[HYPOTHÈSE]** : une grandeur
au choix — marge, chiffre d'affaires, sessions, coût par crêpe — sur un mois ou un trimestre. Un
objectif de CA est parfaitement légitime ; il porte simplement, comme tout affichage de CA,
l'alerte de seuil juste à côté (§2.1).

---

## 5. Deux règles d'architecture à ne pas rater

### 5.1 Un succès est une VUE, jamais un état stocké

C'est l'application directe de la règle n° 5 de `CLAUDE.md` — _le stock ne se modifie que par un
mouvement, le stock courant est toujours la somme des mouvements_.

Un succès obéit à la même logique : il se **recalcule** depuis les données, il ne se **stocke** pas
comme un drapeau qu'on lève. Sinon il dérive — une session annulée laisserait un badge acquis à
tort, et l'application se mettrait à affirmer deux choses différentes sur le même fait.

**[HYPOTHÈSE]** : ne stocker que la **date de premier déblocage**, pour pouvoir dire « obtenu le
12 mars » — et encore, uniquement si le succès reste vrai au recalcul.

### 5.2 Un succès ne se donne jamais à la main

Ni bouton, ni saisie, ni « marquer comme obtenu ». Un succès qu'on peut s'attribuer soi-même ne
récompense plus rien.

Corollaire agréable : puisque tout se recalcule depuis l'historique, **les succès se débloquent
rétroactivement** dès leur mise en service. L'historique déjà en base fait le travail — rien à
rejouer, rien à ressaisir.

**[VÉRIFIÉ]** `CLAUDE.md` §7 interdit de « fabriquer un registre AFSCA a posteriori ». Un succès de
régularité AFSCA doit se lire sur les **dates de saisie réelles**, jamais sur des dates
reconstituées. Le principe est le même : on n'invente pas un passé plus flatteur.

---

## 6. Ce que ça implique, récapitulé

| Chantier                                                    | Effort       | Remarque                                          |
| ----------------------------------------------------------- | ------------ | ------------------------------------------------- |
| Module **objectifs** (budget)                               | moyen        | **le vrai apport** — utile sans aucun badge       |
| Moteur de succès (règles recalculées)                       | moyen        | tout vient de données existantes                  |
| Niveaux sur l'ancienneté active                             | faible       | aucun effet pervers                               |
| Écran de lecture façon Big Ambitions                        | faible       | à traiter avec la **fiche 10** (refonte visuelle) |
| Règle « un palier de CA annonce toujours le seuil suivant » | **décision** | à consigner dans `docs/05-DECISIONS.md`           |

---

## 7. Liens

- **`CLAUDE.md` §6** — les seuils légaux. Des points de passage à préparer, pas des plafonds.
- **`CLAUDE.md` §3 règle 5** — le stock est la somme des mouvements. Un succès suit la même règle.
- **Fiche 10** — refonte visuelle, programmée en dernier. Les succès y trouveront leur écran.
- **Fiche 13** — coût complet : la marge nette réelle est le meilleur socle d'objectif.

---

## 8. Mise à jour du 01/08/2026 — revérification par un agent documentaire

**Les `[À TRANCHER]` du §3 et du §4 sont désormais résolus par le code, plus généreusement que
les hypothèses de rédaction ne le proposaient :**

- **§3, niveaux** : le second axe envisagé en hypothèse (« ancienneté active ») est bien codé —
  `PALIERS_NIVEAU_ANCIENNETE` et `niveauAnciennete` (`packages/core/src/succes.ts`,
  `packages/db/src/depots/objectifs.ts:547-549`), à côté du niveau de chiffre d'affaires.
- **§4, objectifs — sur quoi et sur quelle période** : `GRANDEURS_OBJECTIF`
  (`packages/core/src/objectifs.ts:15-20`) vaut exactement `chiffre_affaires | marge_nette |
nombre_sessions | cout_matiere_par_crepe` — les quatre grandeurs envisagées à l'hypothèse,
  aucune de plus, aucune de moins. **La période, en revanche, va au-delà de l'hypothèse** : la
  table `objectif` (`packages/db/src/schema.ts:2435-2446`) porte `dateDebut`/`dateFin` en texte
  libre, pas un choix contraint entre « mois » et « trimestre » — un objectif peut donc porter
  sur n'importe quelle période, ce que l'hypothèse de rédaction n'anticipait pas.
- **§2.1, « un palier de CA ne s'affiche jamais nu »** : confirmé câblé, pas seulement acté.
  `niveauChiffreAffaires` (`packages/db/src/depots/objectifs.ts:527-545`) attache
  systématiquement `contexteSeuilsLegaux` (lu en direct dans `parametre` via `tableauSeuils`,
  jamais recopié) ; côté écran, `BlocChiffreAffaires`
  (`apps/web/src/pages/Objectifs.tsx:854-892`) ne peut pas rendre le niveau sans ce contexte —
  c'est un seul composant, pas deux blocs qu'on pourrait afficher séparément par erreur.

**Ce que la fiche demande encore et qui reste ouvert** : la ligne du §6 « Règle « un palier de
CA annonce toujours le seuil suivant » — décision à consigner dans `docs/05-DECISIONS.md` »
semble toujours vraie à ce jour. Recherche faite dans `docs/05-DECISIONS.md` (D-050 à D-069) :
aucune décision n'y documente le choix d'architecture du module succès/objectifs (vue
recalculée jamais stockée, liste fermée des quatre grandeurs, règle du palier jamais nu) — une
seule mention incidente de la route `/objectifs/:id/annuler` dans un tableau sans rapport. Ce
n'est pas dans la zone d'écriture de cet agent (`docs/05-DECISIONS.md` n'en fait pas partie) :
signalé ici, pas corrigé.

**Le tableau de bord — exactement l'état « en cours » signalé par le porteur le 01/08/2026, pas
encore « fait ».** `apps/web/src/pages/TableauDeBord.tsx` a été modifié le jour même de cette
mise à jour (le fichier le montre, et son propre commentaire le date : « mission «finir le
tableau de bord», septième élément »). Ce qui est confirmé, précisément, à l'instant de cette
lecture :

- **Les OBJECTIFS sont désormais affichés au tableau de bord** : `objectifEnCoursLePlusProche`
  et `libelleObjectifEnCours` (`TableauDeBord.tsx:1075-1106`) ajoutent une ligne « objectif en
  cours » — filtrée sur le statut `'en_cours'` de `evaluerObjectif`, en excluant `'manque'`,
  `'atteint'` et `'sans_donnee'`, sans rien recalculer sur place (règle d'architecture n°1).
- **Les SUCCÈS (paliers, niveaux, badges) ne le sont pas encore.** Le commentaire du même
  passage le dit explicitement : parmi trois pistes soumises par le porteur — objectif en
  cours / prochain succès de série / dernier succès débloqué — seule la première a été retenue
  pour cet emplacement. Aucune occurrence de `calculerSucces`, de `/objectifs/succes`, ni d'un
  palier ou d'un niveau n'apparaît dans `TableauDeBord.tsx` à ce jour.

**En clair** : la demande du porteur du 01/08 (« objectifs et succès sur le tableau de bord »)
est à moitié posée — les objectifs y sont, les succès n'y sont pas encore. Un agent travaille
dessus au moment même de cette relecture ; cette note décrit un instantané, pas un état stable,
et devra être revérifiée avant d'être citée comme définitive (voir la leçon du §0 ci-dessus sur
les notes qui courent devant le code).
