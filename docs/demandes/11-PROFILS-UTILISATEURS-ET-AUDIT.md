# 11 — Profils utilisateurs et journal d'audit

## Constat

Besoin de savoir, entre les deux personnes qui utilisent l'application, qui a réalisé quelle
action — pour pouvoir encadrer et vérifier une éventuelle erreur de saisie a posteriori.

**Précision importante de l'utilisateur : il ne doit pas y avoir d'authentification à
proprement parler.** Pas de compte par personne avec mot de passe, pas d'écran de connexion.
Juste un moyen simple de savoir « qui a fait quoi », entre deux personnes de confiance qui
partagent le même outil.

## Deux préoccupations à ne pas confondre

1. **Sécurité de la base** — qui a le droit technique d'écrire dans Supabase. Déjà réglée par
   RLS (`docs/07-SECURITE-ET-DEPLOIEMENT.md` §2), au niveau de l'application entière, de
   façon invisible pour l'utilisateur. Ne nécessite aucune action de sa part et **n'est pas
   concernée par cette fiche**.

   > **Correction du 01/08/2026, vérifiée contre le code et contre `docs/05-DECISIONS.md`** :
   > ce paragraphe est **faux pour ce projet**. **Ni Supabase ni RLS n'existent dans cette
   > application.** La base est un **fichier SQLite local** (décision **D-001**), sans serveur
   > de base de données, donc sans mécanisme de RLS possible — vérifié dans `packages/db/src/schema.ts`
   > et `packages/db/src/client.ts`, qui n'ouvrent qu'un fichier `better-sqlite3`. Le fichier
   > `docs/07-SECURITE-ET-DEPLOIEMENT.md` cité n'existe pas non plus : le document réel est
   > `docs/07-DOCTRINE-ERP-ET-DESIGN.md`, qui ne mentionne ni Supabase ni RLS.
   >
   > Ce n'est pas une coquille isolée : c'est **exactement l'erreur déjà signalée et corrigée**
   > dans `docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md` le 29/07/2026, et déjà
   > actée par le porteur dans **D-056** (`docs/05-DECISIONS.md`, « Pas d'authentification ni de
   > RLS : la fiche 11 est reportée ») — une décision qui porte sur **cette fiche precisement**.
   > Voir la section datée en fin de fiche pour ce que D-056 dit et pour la contradiction que
   > cela pose avec la présente version de la fiche.

2. **Attribution des actions** — savoir laquelle des deux personnes est actuellement devant
   l'écran, pour l'inscrire dans le journal d'audit. C'est le seul vrai sujet ici.

Confondre les deux aurait fait dériver cette fiche vers un système de comptes avec mots de
passe, exactement ce que l'utilisateur ne veut pas.

## Ce que ça confirme dans les décisions déjà prises — pas de révision nécessaire

`docs/05-DECISIONS.md`, entrée **D-012**, reste valable telle quelle : une politique RLS
uniforme, sans rôles différenciés en droits d'accès. Cette fiche **ne la révise pas** : elle
ajoute une couche d'attribution légère, séparée de toute question de sécurité ou de
restriction. Aucune nouvelle entrée de décision n'est nécessaire dans `docs/05-DECISIONS.md`
pour cette fiche.

> **Correction du 01/08/2026** : ce paragraphe est **doublement faux**, vérifié contre
> `docs/05-DECISIONS.md`.
>
> 1. **D-012 n'est pas une politique RLS.** Son titre réel est _« Application web servie en
>    local, pas de packaging desktop »_ — une décision sur Fastify/Vite/Electron, sans aucun
>    rapport avec un contrôle d'accès. C'est exactement la même citation erronée que **D-056**
>    a déjà relevée sur l'ancienne version de cette fiche : _« La fiche citait D-012 comme étant
>    la politique RLS. D-012 est en réalité "Application web servie en local, pas de packaging
>    desktop". La citation était erronée. »_
> 2. **Une nouvelle entrée de décision existe déjà**, et porte sur cette fiche même :
>    **D-056**, datée du 29/07/2026, où le porteur a **reporté** la fiche 11 telle qu'elle
>    existait alors, précisément à cause de cette confusion Supabase/RLS. Voir la section
>    datée en fin de fiche.

## Vérifier l'existant avant de coder

`utilisateur.role` et `journal_audit` existent déjà dans le modèle de données
(`docs/02-MODELE-DONNEES.md`). Ce qui manque : un moyen sans friction de dire « c'est moi »
sur un poste donné, et l'exploitation concrète de `journal_audit` dans un écran.

## Ce qui doit changer

- **Sélecteur de profil, pas un formulaire de connexion** : au démarrage de l'application sur
  un poste (ou à tout moment via un menu), un choix simple entre deux boutons — le nom du
  porteur du projet, le nom de sa compagne. Aucun mot de passe, aucun champ à remplir. Le
  choix est mémorisé sur ce poste jusqu'à ce qu'on le change explicitement.
- L'accès technique à Supabase qui rend RLS possible (`docs/07-SECURITE-ET-DEPLOIEMENT.md`
  §2) reste un mécanisme d'application, invisible pour l'utilisateur — ce sélecteur ne
  l'authentifie pas auprès de la base, il se contente d'étiqueter les actions faites depuis
  ce poste avec le bon nom.
  _(Correction du 01/08/2026 : il n'y a ni Supabase ni RLS dans ce projet — voir la correction
  du §"Deux préoccupations" ci-dessus et la section datée en fin de fiche. La base est SQLite
  locale, D-001.)_
- Chaque table modifiable trace son auteur (`modifie_par`, déjà ajouté au modèle de données
  lors de la revue de sécurité) à partir du profil actif sélectionné — pas d'un compte
  technique séparé par personne.
- Écran « Journal d'activité » : chronologie des actions par profil et par table, filtrable
  par personne, par période, par type d'action — s'appuie sur `journal_audit` déjà posé.
- Aucune restriction de droits entre les deux profils, conformément à D-012 : ce mécanisme
  sert à comprendre après coup, pas à bloquer une action en amont.

## Ce qui doit être relié

- RLS (`docs/07-SECURITE-ET-DEPLOIEMENT.md` §2) : inchangé, une seule politique pour l'accès
  technique de l'application — cette fiche n'y touche pas.
  _(Correction du 01/08/2026 : aucune RLS n'existe dans ce projet — voir plus haut.)_
- Toutes les tables métier modifiables : vérifier que `modifie_par` est bien renseigné à
  partir du profil actif sélectionné, à chaque écriture.

## Critère de fin

Sur un poste, sélectionner le profil du porteur du projet et saisir une vente ; sur l'autre
poste, sélectionner le profil de sa compagne et modifier une recette. L'écran Journal
d'activité distingue clairement les deux, sans qu'aucun mot de passe n'ait été demandé à
aucun moment.

---

## Mise à jour du 01/08/2026 — état vérifié dans le code, et une contradiction non tranchée

Vérification faite **dans le code courant**, pas depuis un document. Rien codé ci-dessous n'a
été modifié — cette section est documentaire.

### État : PARTIEL

| Élément demandé par la fiche                                                                                | État                                                           | Preuve                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table `utilisateur` (nom, rôle)                                                                             | Existe                                                         | `packages/db/src/schema.ts:59-66` — colonnes `nom`, `role` (`'proprietaire' \| 'collaborateur'`), `actif`                                                                                                |
| `journal_audit`                                                                                             | Existe et est ALIMENTÉ                                         | `packages/db/src/depots/audit.ts::journaliser`, appelé à huit endroits (recettes, paramètres, ingrédients, produits, conditionnements, lieux)                                                            |
| Écran « Journal d'activité »                                                                                | **Existe déjà**, au-delà de ce que la fiche supposait manquant | `apps/web/src/pages/JournalAudit.tsx` — filtrable par table, par action (création/modification/annulation) et par période. Route `GET /audit` (`apps/api/src/routes/audit.ts`)                           |
| Filtre **par personne** dans cet écran                                                                      | **Absent**                                                     | Aucune colonne de filtre sur `parQui` dans `JournalAudit.tsx` — cohérent avec le point suivant : il n'y a rien à filtrer                                                                                 |
| Sélecteur de profil (« c'est moi »)                                                                         | **Absent**                                                     | Aucune route `/utilisateurs*` (`grep` exhaustif sur `apps/api/src/routes`, `apps/web/src`), aucun composant de sélection, aucun stockage local de profil actif                                           |
| `modifie_par` / `journal_audit.utilisateur` (`parQui`) / `mouvement_stock.cree_par` renseignés à l'écriture | **Absent — toujours `null`**                                   | `packages/db/src/audit-colonnes-orphelines.test.ts:161-197` : « aucune route HTTP ne leur fournit jamais de valeur (vérifié par lecture complète de `apps/api/src/routes/*.ts`, pas seulement un grep) » |

**Ce qui manque précisément** pour que la fiche soit satisfaite telle qu'écrite :

1. Le sélecteur de profil lui-même (bouton/menu, mémorisation par poste) — rien n'existe, ni
   composant React, ni endpoint, ni stockage local.
2. Le câblage de ce profil vers `modifie_par`/`parQui`/`cree_par` sur chaque route d'écriture
   — aujourd'hui ces colonnes ne sont _jamais_ alimentées, par choix documenté (voir plus bas),
   pas par oubli.
3. Un filtre « par personne » sur `JournalAudit.tsx` — inutile tant que 1 et 2 ne sont pas faits.

### Ce que l'application fait EN PLUS de ce que la fiche croyait manquant

La fiche (§ « Vérifier l'existant ») posait comme manquant : « l'exploitation concrète de
`journal_audit` dans un écran ». **C'est fait**, et plus complètement que la fiche ne le
demandait : `JournalAudit.tsx` affiche une chronologie filtrable par table/action/période, avec
un panneau de détail qui calcule et affiche uniquement les **champs qui ont réellement changé**
entre deux instantanés (`differencesAudit`), plutôt que de ré-afficher toute la ligne. Ce
raffinement (diff ciblé, pas un dump JSON) va au-delà de ce que la fiche demandait pour cet
écran.

### Les erreurs factuelles (Supabase, RLS, `docs/07-SECURITE-ET-DEPLOIEMENT.md`, D-012) — corrigées ci-dessus, dans le texte

Corrigées **là où elles étaient écrites**, avec une note datée à chaque occurrence (quatre
endroits dans cette fiche). Résumé : aucun Supabase, aucune RLS n'existent dans ce projet — base
SQLite locale (**D-001**) — le document réel est `docs/07-DOCTRINE-ERP-ET-DESIGN.md`, et
**D-012** porte sur le packaging web local, pas sur une politique d'accès.

### La contradiction fiche ↔ décision — présentée, non tranchée

**D-056** (`docs/05-DECISIONS.md`, 29/07/2026, _« Pas d'authentification ni de RLS : la fiche 11
est reportée »_) documente que le porteur a déjà **reporté** une version antérieure de cette
fiche (`docs/demandes/11-PROFILS-UTILISATEURS.md`, nom de fichier différent de l'actuel), au
motif exact des erreurs Supabase/RLS ci-dessus, avec cette citation du porteur : _« on va laisser
tomber cette fiche 11, Supabase n'est pas utile pour le moment, on la laisse de côté, nous
verrons cela plus tard »_. D-056 conclut : _« Aucune authentification n'entre dans le produit »_
et renvoie le besoin réel (savoir qui a saisi quoi) à un traitement futur, par **attribution**
plutôt que par **authentification** — un champ sur l'écriture, pas un contrôle d'accès.

La présente fiche (renommée « ET-AUDIT ») est très exactement cette reformulation en attribution
sans authentification que D-056 annonçait — mais elle reprend, sans les corriger, les mêmes
citations Supabase/RLS/D-012 que D-056 avait déjà identifiées comme fausses. Ce n'est donc pas
une contradiction de fond entre la fiche et D-056 : la fiche va dans le sens que D-056 annonçait
(« sera traité autrement »). C'est une contradiction de **forme** — une erreur déjà corrigée une
fois ailleurs (fiche 07, 29/07/2026) qui n'avait pas été répercutée ici, maintenant faite.

**Ce qui reste un arbitrage réel, non tranché par cette mission** : `CLAUDE.md` §0 pose
« mono-utilisateur — pas de gestion de droits [...] Deux personnes, un poste, un métier » et
insiste que « les deux personnes qui utilisent l'application ne sont PAS distinguées PAR ELLE,
par choix de simplification ». Le test `packages/db/src/audit-colonnes-orphelines.test.ts`
(commentaire d'en-tête, section « CE QUI N'EST PAS COUVERT ICI ») argumente explicitement que
remplir `creePar`/`parQui` **réaliserait à la lettre** ce que ce §0 écarte, et qu'aucune règle de
CLAUDE.md §3 (traçabilité par lot, journal d'audit) ni l'AFSCA n'exige de savoir **lequel** des
deux associés a tenu le clavier — seulement quoi et quand. La fiche 11, elle, demande
explicitement ce sélecteur de profil et ce câblage.

Les deux textes ne peuvent pas être satisfaits en même temps sans une clarification du porteur :
soit §0 est révisé pour admettre une attribution légère sans droits différenciés (ce que D-056
semblait envisager — « le sujet reviendra si des employés arrivent », fiche 19 §5, mais dans un
contexte différent, celui d'employés futurs plutôt que du couple actuel), soit cette fiche reste
sans suite, comme son ancêtre l'a été par D-056. **Cette mission ne tranche pas** lequel des deux
documents doit céder — elle documente que la table `utilisateur` et les colonnes
`modifie_par`/`cree_par` existent en base **sans aucun consommateur**, dans l'état exact où
`audit-colonnes-orphelines.test.ts` les a laissées, en attendant cette clarification.
