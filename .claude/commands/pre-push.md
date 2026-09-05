---
description: Workflow de vérification complet avant push — audits multi-agents (code, cyber, design/a11y, SEO, GEO, i18n, perf) sur le diff, puis verdict GO / NO-GO.
argument-hint: "[base] (défaut: @{push} / origin/HEAD, sinon HEAD~1)"
allowed-tools: Bash, Read, Grep, Glob, Agent, TodoWrite
---

Tu exécutes le **workflow de pre-push par agents** pour ce site Next.js (portfolio, next-intl fr/nl/en). Objectif : auditer **uniquement ce qui va être poussé** avec des sous-agents spécialisés répartis en **piliers d'audit**, puis rendre un verdict clair **avant** le push. Le hook shell `.husky/pre-push` (lint + typecheck + build + Playwright) couvre le déterministe ; **cette commande couvre ce que le hook ne voit pas** : logique, sécurité, design, SEO, GEO, i18n, perf.

## Étape 1 — Périmètre (le diff)
- Base : `$ARGUMENTS` si fourni, sinon `@{push}`, sinon `origin/HEAD`, sinon `HEAD~1`.
- `git diff --stat <base>...HEAD` puis `git diff --name-only <base>...HEAD`.
- Si **aucun** fichier modifié : dis-le et arrête.
- Affiche la liste des fichiers concernés avant de lancer les agents.

## Étape 2 — Sélectionner les piliers touchés par le diff
Ne lance QUE les agents dont le domaine est touché (regarde chemins/extensions). Chaque pilier = un ou plusieurs `subagent_type` :

| Pilier | Agent(s) (`subagent_type`) | Déclenché si le diff touche… |
|---|---|---|
| **Code & correctness** | `code-reviewer` | tout code `src/**` (`.ts`/`.tsx`/`.js`) — **toujours** si du code change |
| **Cyber (sécurité)** | `security-auditor` (+ `penetration-tester` si API/auth) | `src/app/api/**`, `middleware.ts`, `next.config.ts`, `src/config/**`, auth, headers/CSP, rate-limit, `.env*`, `db/**`, `src/lib/security/**` |
| **Design & a11y** | `design-auditor` + `accessibility-tester` | tout `.tsx` UI, `*.module.css`, `public/**` (images), tokens/design-system |
| **SEO** | `seo-strategist` | `messages/**` (contenu), `**/page.tsx` (metadata), `src/lib/schema*`, `sitemap.ts`, `robots*`, `llms.txt`, headings/canonical/hreflang |
| **GEO** | `seo-strategist` (prompt GEO) | idem SEO + JSON-LD (`schema.ts`, `author-schema.ts`, ProfilePage/Person), `llms.txt`, pages de contenu factuel (blog, cv, agence) |
| **i18n** | `i18n-auditor` | `messages/**`, `src/i18n/**`, ou tout composant ajoutant/retirant des clés `t(...)`/`useTranslations` |
| **Perf** | `performance-engineer` | `next.config.ts`, `public/**` (images/fonts), composants lourds, imports |

Ignore les piliers non touchés (ex. pas de SEO/GEO si seul du code interne bouge sans contenu/metadata/schema).

## Étape 3 — Dispatcher les agents EN PARALLÈLE
Lance tous les agents retenus **dans un seul message** (plusieurs appels `Agent` en parallèle). À CHAQUE agent, fournis :
- la **liste exacte des fichiers modifiés** (le diff, pas tout le repo) ;
- la consigne commune : « Revois UNIQUEMENT ces changements avant un push. Findings **actionnables**, classés **blocker / high / medium / low**, avec `fichier:ligne` et un correctif concret. Ne réaudite pas le site entier. »
- la consigne spécifique au pilier :
  - **Cyber** : OWASP, secrets exposés, CSP/nonce, headers, rate-limit, validation/entrées, SSRF/XSS/injection, `dangerouslySetInnerHTML`, authz.
  - **Design & a11y** : cohérence design-system/tokens (0 valeur en dur — cf. `src/config/site.ts` + variables CSS + i18n), responsive, contraste, focus, cibles tactiles ≥ 24px (viser 44px), `prefers-reduced-motion`, WCAG 2.2 AA, images `next/image` (dimensions/alt/formats).
  - **SEO** : titles/descriptions uniques, canonical + hreflang (fr/nl/en, localePrefix as-needed), headings, sitemap/robots cohérents, maillage interne, pas de contenu dupliqué, **recherche web live** des bonnes pratiques 2026 (ne pas répondre de mémoire).
  - **GEO (Generative Engine Optimization)** : lisibilité par les moteurs génératifs / AI Overviews — JSON-LD complet et cohérent (Organization/Person/ProfilePage/BlogPosting, `@id` stables), entités claires et « citables », `llms.txt` à jour, réponses factuelles vérifiables (pas d'affirmations invérifiables), E-E-A-T.
- **Honnêteté** (transverse) : signaler toute affirmation non vérifiable / chiffre inventé / date fictive (le site tient à un ton factuel de portfolio étudiant).

## Étape 4 — Synthèse & verdict
Agrège tout en **un tableau unique** trié par sévérité, colonne `Pilier | Sévérité | Fichier:ligne | Problème | Correctif`. Puis :
- **🟥 NO-GO** s'il existe ≥ 1 **blocker** (bug prod, secret exposé, clé i18n manquante, régression a11y bloquante, faille, affirmation mensongère publiée). Liste ce qui doit être corrigé avant push.
- **🟧 GO avec réserves** si seulement high/medium → l'utilisateur décide.
- **🟩 GO** si rien de significatif.

## Étape 5 — Rappel du gate déterministe
Rappelle que `.husky/pre-push` (lint + typecheck + build + Playwright) tournera **automatiquement** au `git push` et bloquera en cas d'échec. Si le hook échoue pour une raison d'environnement (ex. navigateur Playwright absent) et non de code, le signaler explicitement.

**Ne pousse jamais toi-même sans validation explicite de l'utilisateur.**
