# 02 — Rendu correct en 1080p et en 1440p

## Constat

L'application doit rester lisible et bien proportionnée sur les deux résolutions d'écran de
bureau les plus courantes : 1920×1080 et 2560×1440. C'est un usage desktop uniquement
(pas de contrainte mobile en V1, voir `CLAUDE.md` §1) — l'enjeu n'est donc pas le responsive
mobile, mais la **densité d'information à deux échelles physiques différentes**.

## Vérifier l'existant avant de coder

Regarder si les écrans actuels utilisent des largeurs fixes en pixels (`w-[960px]`,
`width: 1200px`…) ou des unités relatives (`rem`, `%`, `fr`, `clamp()`). Le symptôme typique
d'un problème de résolution : un écran conçu et testé en 1440p qui déborde ou paraît
minuscule en 1080p, ou l'inverse.

## Ce qui doit changer

- Toute largeur de mise en page en unités relatives (`rem`, grille CSS en fractions), jamais
  en pixels fixes, à l'exception des éléments qui doivent garder une taille physique stable
  quelle que soit la résolution (icônes, épaisseur de bordure).
- Les tableaux denses (Stock, Prochaine session, Comptabilité — voir
  `docs/06-UI-ET-PARCOURS.md`) doivent rester lisibles sans scroll horizontal aux deux
  résolutions, avec un point de rupture explicite si une colonne doit se masquer en dessous
  d'une certaine largeur.
- Typographie en `rem` avec une échelle qui garde une lisibilité correcte en 1080p (où le
  même nombre de pixels physiques représente une part plus grande de l'écran) sans paraître
  disproportionnée en 1440p.
- Respect strict du principe déjà posé (`docs/06-UI-ET-PARCOURS.md`) : densité plutôt
  qu'espace vide. À 1440p en particulier, ne pas simplement agrandir les marges — utiliser
  l'espace supplémentaire pour montrer plus d'information utile (plus de lignes visibles
  dans un tableau, pas des blancs plus larges).

## Ce qui doit être relié

Concerne l'ensemble de l'application — pas un module isolé. Vérifier en particulier les
cinq écrans détaillés en `docs/06-UI-ET-PARCOURS.md` §« Les cinq écrans qui comptent », qui
sont les plus denses et donc les plus exposés au problème.

## Critère de fin

Captures d'écran (ou tests Playwright avec viewport fixé) de chaque écran principal aux deux
résolutions, sans débordement, sans scroll horizontal non désiré, sans élément illisible.
À intégrer si possible comme test automatisé de non-régression (deux tailles de viewport
testées en CI), plutôt que comme simple vérification manuelle ponctuelle.

---

## Mise à jour du 01/08/2026 — vérifié dans le code réel : **partiel**

**Deux choses ont changé le 01/08/2026 et corrigent la fiche elle-même** (déjà appliqué dans
`docs/07-DOCTRINE-ERP-ET-DESIGN.md` §4.4, ne pas dupliquer ici, seulement y renvoyer) : la
cible de conception n'est plus « 1280×720 seul » mais **1920×1080**, avec une exigence de
rester pleinement utilisable sur les trois résolutions réelles du porteur — **1280 de large,
1080p et 1440p**. Le titre de cette fiche reste donc juste, mais l'ancienne doctrine qu'elle
citait implicitement (« concevoir pour 1280×720 ») ne l'est plus.

**Ce qui est fait, vérifié dans le CSS/TSX réel :**

- Aucune largeur de mise en page en pixels fixes trouvée. Toutes les occurrences de `w-[…]`
  du dépôt (`Achats.tsx`, `Comptabilite.tsx`, `Evenements.tsx`, `Factures.tsx`,
  `Opportunites.tsx`, `Parametres.tsx`, `Production.tsx`, `RegistreAfsca.tsx`,
  `Sessions.tsx`, `BoutonDocument.tsx`) sont en `rem` (ex. `lg:w-[26.25rem]` pour un panneau
  docké), jamais en `px`.
- Doctrine de densité chiffrée et déjà appliquée : `docs/07-DOCTRINE-ERP-ET-DESIGN.md` §4.2
  à §4.5 (hauteur de rangée, taille de texte, tracking, règles de tableau) — ne pas
  dupliquer ici, y renvoyer.
- Plusieurs audits visuels manuels ont déjà cherché ce défaut et corrigé ce qu'ils ont trouvé :
  `docs/08-AUDIT-INTERFACE.md`, `docs/22-FOCUS-DETRUIT.md`, `docs/23-AUDIT-VISUEL.md`. Ce
  dernier a mené à **D-081** (`docs/05-DECISIONS.md`) : la somme des largeurs de colonnes
  doit faire exactement 100 %, sinon le navigateur rogne le tableau en silence — corrigé sur
  au moins trois écrans indépendants.

**Ce qui manque encore — confirmé, pas supposé :**

- **Le critère de fin de cette fiche n'existe pas dans le dépôt.** Aucun fichier
  `*.spec.ts`/Playwright, aucune config de test de viewport : `docs/07` §4.4 le dit
  lui-même, en toutes lettres, depuis la correction du 01/08 (« ce critère n'existe pas,
  aucun test de rendu multi-résolution dans le dépôt »). Les captures des audits 08/22/23
  ont toutes été prises **manuellement**, dans une instance jetable, jamais commises au
  dépôt (`docs/23-AUDIT-VISUEL.md` : « dans le dossier temporaire de session… jamais dans
  le dépôt »). Il n'y a donc aucune non-régression automatisée sur ce sujet.
- **Non établi par cette vérification** : l'état visuel réel de l'application à 1080p et à
  1440p aujourd'hui. Le serveur web (`:5173`) n'était pas démarré au moment de cette
  vérification et cette mission interdit d'en lancer un — impossible de confirmer par
  capture d'écran que les correctifs de D-081 et des audits 08/22/23 couvrent bien tous les
  écrans aux trois résolutions. Seule l'absence de pixels fixes en CSS a pu être vérifiée
  par lecture de code.
