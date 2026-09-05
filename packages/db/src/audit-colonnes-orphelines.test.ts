/**
 * Audit du 30/07/2026 — colonnes de `schema.ts` que rien n'écrit, que rien ne
 * lit, ou que rien ne PEUT remplir, et index manquants sur des colonnes
 * réellement filtrées.
 *
 * CONTEXTE : la variante « colonne » du défaut le plus fréquent du projet
 * (« du code ou une donnée que rien n'appelle », déjà corrigé six fois en 24 h
 * — voir `audit-silences.test.ts`, `audit-afsca.test.ts`). Une colonne
 * déclarée, migrée, et jamais câblée fait croire que la donnée existe :
 * quelqu'un construira un écran dessus et affichera du vide.
 *
 * MÉTHODE — mesurée, pas écrite de mémoire : chaque cas ci-dessous vient d'une
 * lecture directe du code (services, dépôts, routes, contrats) et d'une
 * recherche exhaustive de toute écriture (`.values({...})`, `.set({...})`,
 * y compris via variable ou raccourci d'objet — un détecteur qui n'exige
 * qu'un littéral produit des faux « jamais écrite » en masse, piège déjà
 * tombé une fois pendant cet audit) et de toute lecture (projection `select`,
 * accès de propriété qualifié `table.colonne`, contrat Zod, affichage écran).
 * Jamais un `grep` seul pris pour preuve suffisante — et jamais une valeur
 * affichée à l'écran prise pour preuve de relecture de la table : sur
 * `ProchaineSession.tsx`, `prevision.contrainteLimitante` désigne un DTO
 * calculé en direct, homonyme de la colonne archivée.
 *
 * CONVENTION MAISON (déjà en place : `audit-silences.test.ts`,
 * `invariants.test.ts`, `seed/fournisseurs-systeme.test.ts`) : `it.fails`
 * affirme qu'un défaut EXISTE ; la suite reste verte. Le jour où quelqu'un
 * câble le manque, le test se met à PASSER — donc à échouer en tant que
 * `it.fails` — ce qui force à retirer `.fails` et à en faire un test de
 * non-régression.
 *
 * INVENTAIRE (relu et re-vérifié le 30/07/2026, après passage de plusieurs
 * agents en parallèle sur ce même fichier — ce compte peut avoir bougé
 * depuis, relire `grep -c "it\.fails("` avant de s'y fier) : ZÉRO `it.fails`
 * vivant dans ce fichier à l'issue de cette relecture (elle avait commencé
 * avec DEUX `it.fails` encore vivants). CINQ basculements pendant cette même
 * relecture : DEUX câblés par d'autres agents en parallèle et convertis en
 * gardes de non-régression — `reception.commandeId` (converti par un autre
 * agent, vérifié ici — lecture réelle via
 * `receptionsRecentesParCommande`/`receptionsLieesACommande`,
 * `services/commandes.ts`) et `sessionFrais.justificatifPath` (converti dans
 * cette passe, voir plus bas dans ce fichier) — UN câblé par l'agent qui
 * possédait `services/production.ts` (`production.ordrePrevisionId`, détail
 * juste en dessous) — et DEUX RECLASSÉS EN EXCLUSION (une décision de
 * politique de classification, pas un câblage) : `exerciceTracabilite.documentId`
 * et la table `utilisateur` d'abord, puis `mouvementStock.valuationDate` en
 * dernier — c'était le DERNIER `it.fails` vivant de ce dépôt, motivé en
 * détail ci-dessous dans « CE QUI N'EST PAS COUVERT ICI ».
 *
 *  `production.ordrePrevisionId` — CÂBLÉ le 30/07/2026 (mission « relier
 *     une fournée à la prévision qui l'a motivée »), PAR L'AGENT QUI POSSÉDAIT
 *     `services/production.ts` — celui-là même dont dépendait le renoncement
 *     motivé précédent (repris dans l'historique de ce fichier). La question
 *     de fond (distinguer quelle RÉVISION précise de prévision, parmi celles
 *     que D-058 conserve, a motivé quel lancement) était réelle ; elle est
 *     désormais résolue par un champ `previsionId` sur `EntreeProduction`,
 *     choisi par L'ÉCRAN (`Production.tsx`, `previsionRetenue` — la plus
 *     récente prévision archivée pour la session sélectionnée, affichée
 *     avant le clic, jamais un choix fait après coup par le service) et relu
 *     jusqu'à un écart affiché (`ecartVsPrevisionBp`). Ce test est retiré de
 *     l'INVENTAIRE des manques : voir désormais le test de non-régression
 *     dédié, qui a remplacé l'ancien `it.fails` du même nom.
 *
 * CE QUI N'EST PAS COUVERT ICI, ET POURQUOI (documenté, pas oublié) :
 *  - `session_marche.point_depart_texte` (D-064) : ni écrite ni lue au moment
 *    de cet audit, mais son câblage est explicitement EN COURS par d'autres
 *    agents en parallèle de cette mission — un `it.fails` daterait en
 *    quelques heures. La logique pure existe déjà (`packages/core/src/point-depart.ts`).
 *  - `session_marche.distance_reelle_km` (D-064/D-065) : SŒUR du point
 *    précédent — vient d'être câblée EN ÉCRITURE (`cloturerSession`), mais
 *    n'est encore projetée nulle part en lecture (`lireSessionDetail`, ni
 *    `schemaSessionDetail`) ni consommée par `imputationTourneeDeplacement`
 *    (`packages/core/src/deplacement.ts`), sa seule consommatrice prévue.
 *    Même raison de ne pas verrouiller : le reste de D-064 est en cours de
 *    câblage ailleurs au moment même de cet audit.
 *  - `commande_fournisseur.document_id`, `journal_ia.prompt_hash` ET
 *    `exerciceTracabilite.documentId` (REJOINT CETTE LISTE le 30/07/2026,
 *    reclassé DEPUIS la section `it.fails` ci-dessus) : toujours écrites à
 *    `null`, jamais lues — mais chacune porte désormais un commentaire de
 *    fonction qui justifie explicitement ce choix comme CORRECT (le lien réel
 *    se fait dans l'autre sens via `document_genere`, ou le prompt n'est
 *    délibérément pas conservé), pas comme un oubli.
 *
 *    Détail du reclassement d'`exerciceTracabilite.documentId` : ce cas était
 *    resté `it.fails` malgré l'ajout, par un autre agent, du commentaire de
 *    justification sur `enregistrerExerciceTracabilite`
 *    (`packages/db/src/services/afsca.ts`, ~ligne 600) — parce que le critère
 *    de ce fichier distingue une colonne dont l'inutilité EST documentée
 *    (pas un défaut) d'une colonne dont personne ne sait si elle sert (un
 *    défaut), et qu'un agent avait jugé, à raison, que reclasser un cas est
 *    une décision de politique de classification, pas un câblage qu'un agent
 *    tranche seul en passant. Tranché ici, explicitement : ce commentaire est
 *    STRUCTURELLEMENT IDENTIQUE à celui de `commande_fournisseur.document_id`
 *    — même raisonnement (le lien réel se fait dans l'autre sens, via
 *    `document_genere` ; une clé étrangère ne pourrait pointer que vers UNE
 *    version d'un document régénéré à chaque fois). Le fonctionnel n'a pas
 *    changé (toujours `null` à vie, toujours aucune lecture), mais ce n'est
 *    plus « une colonne dont personne ne sait si elle sert » : le même
 *    critère qui exclut `commande_fournisseur.document_id` s'applique donc
 *    ici aussi, à l'identique.
 *  - `mouvementStock.valuationDate` (RECLASSÉE EN EXCLUSION le 30/07/2026 —
 *    c'était le DERNIER `it.fails` vivant de ce dépôt) : la colonne porte une
 *    distinction RÉELLE en comptabilité de stock, documentée dans
 *    `docs/02-MODELE-DONNEES.md` (« date à laquelle la valeur est réputée
 *    connue, distincte de la date du mouvement ») — la quantité est certaine
 *    au mouvement, le coût ne l'est parfois qu'à la facture. Mais VÉRIFIÉ, pas
 *    supposé, contre l'état ACTUEL du code : les SIX chemins qui créent un
 *    mouvement (`services/reception.ts`, `services/production.ts` —
 *    création et les deux corrections d'écart —, `services/sessions.ts`,
 *    `services/nomenclature-vente.ts`, `services/garnitures.ts`,
 *    `services/mouvements.ts`) écrivent TOUS `valuationDate` avec EXACTEMENT
 *    la même valeur que `dateMouvement` (`entree.dateReception`,
 *    `entree.dateProduction`, `contexte.dateSession`…), et les DEUX chemins
 *    de contrepassation (`services/sessions.ts::annulerSession`,
 *    `services/mouvements.ts::annulerMouvement`) recopient
 *    `origine.valuationDate` de l'écriture annulée — jamais une date qui
 *    diverge. `calculerCump` (`packages/core/src/stock.ts`), seule fonction
 *    du dépôt qui valorise le stock, ne lit d'ailleurs JAMAIS
 *    `mouvement_stock` : elle calcule le coût moyen à partir de
 *    `lot.prixLigneCents / lot.quantiteInitiale` (`depots/stock.ts`,
 *    `LotEnBase.prixUnitaireCents`) — elle ne PEUT structurellement pas
 *    consulter cette colonne, quelle que soit sa valeur. Et le seul
 *    mécanisme qui corrige réellement un coût après coup — une facture
 *    fournisseur arrivée en retard (`enregistrerFacture`,
 *    `services/factures.ts`) — écrit DIRECTEMENT sur `lot.prixLigneCents`,
 *    JAMAIS sur `mouvement_stock` : il contourne cette colonne au lieu de la
 *    remplir avec une date distincte. Le seul consommateur qui aurait pu
 *    l'exposer sans rien inventer — `mouvementsDuLot` (`depots/stock.ts`) →
 *    `schemaMouvementLot` (`contrats/stock.ts`) → l'historique d'un lot
 *    affiché par l'écran de détail — projetterait, sur CHAQUE ligne
 *    existante à ce jour, la MÊME valeur que la colonne `dateMouvement` déjà
 *    affichée juste à côté : un doublon visuel, pas une information — soit
 *    exactement l'illusion de contrôle que ce fichier existe pour repérer,
 *    pas pour produire. `docs/07-DOCTRINE-ERP-ET-DESIGN.md` §6.8 rang 8 garde
 *    « Ajustement de coût rétroactif, `valuation_date` » au catalogue des
 *    manques (1 jour estimé) : la distinction reste une bonne idée pour un
 *    FUTUR mécanisme d'ajustement écrit directement sur `mouvement_stock` —
 *    mais ce mécanisme-là n'existe pas aujourd'hui, et celui qui existe
 *    (`enregistrerFacture`) résout déjà la même question réelle par une autre
 *    voie. Câbler une lecture ici aurait été inventer un usage pour faire
 *    passer un test au vert : l'exclusion documente que la colonne ne sert à
 *    RIEN aujourd'hui, pas qu'elle ne pourra jamais servir — si un ajustement
 *    rétroactif est un jour écrit sur `mouvement_stock` plutôt que sur `lot`,
 *    cette exclusion devra être révisée et un test de non-régression
 *    reconstruit à sa place. Décision qui reste au porteur : soit cette
 *    divergence est un jour introduite, soit la colonne est un reliquat que
 *    seule une migration peut retirer (hors périmètre d'un agent).
 *  - `reception.commande_id`, `production.ecart_motif` : deux mesures
 *    indépendantes ont d'abord divergé sur `reception.commande_id`. Vérifié
 *    ici pour trancher : `production.ecart_motif` EST relue
 *    (`depots/productions.ts:94`, `ecartMotif: p.ecartMotif`) — écrite et
 *    lue, simplement pas encore consommée par le moteur de prévision comme
 *    son commentaire d'origine l'annonçait (un manque fonctionnel, pas une
 *    colonne orpheline). `reception.commande_id`, en revanche, N'A aucune
 *    relecture : voir le cas dédié ci-dessous.
 *  - `parametre.dateFinValidite` : toujours écrite à `null`
 *    (`ajouterVersionParametre`), et bien LUE dans le `WHERE` de
 *    `lireParametres` — mais cette branche n'est jamais exercée avec une
 *    vraie valeur. Nuance de conception, pas un défaut assez net pour un
 *    `it.fails` : la colonne EST câblée en lecture, seule sa branche
 *    `IS NOT NULL` dort.
 *  - `utilisateur` (table entière) — RECLASSÉ le 30/07/2026, DEPUIS la
 *    section `it.fails` ci-dessus (décision de politique de classification,
 *    pas un câblage à combler). Une seule ligne (« Propriétaire ») semée une
 *    fois par le seed, jamais relue ailleurs. `journal_audit.utilisateur`
 *    (`parQui`) et `mouvement_stock.cree_par` (`creePar`) — les DEUX colonnes
 *    que cette table est censée qualifier, sur les DEUX tables qui la
 *    référencent — valent TOUJOURS `null` en usage réel : aucune route HTTP
 *    ne leur fournit jamais de valeur (vérifié par lecture complète de
 *    `apps/api/src/routes/*.ts`, pas seulement un grep).
 *
 *    `schema.ts` documente une INTENTION (« le champ sert à tracer qui a
 *    saisi quoi dans le journal d'audit et sur les mouvements de stock ») —
 *    mais cette intention, réalisée à la lettre, décrirait une fonctionnalité
 *    que CLAUDE.md §0 écarte explicitement pour ce produit : «
 *    mono-utilisateur — pas de gestion de droits [...] Deux personnes, un
 *    poste, un métier. » §0 ne dit pas seulement « pas de permissions » — il
 *    pose que les deux personnes qui utilisent l'application ne sont PAS
 *    distinguées PAR ELLE, par choix de simplification (« la complexité est
 *    dans les calculs, jamais dans l'interface »). Remplir `creePar`/`parQui`
 *    avec une vraie valeur exigerait un écran de sélection d'auteur (« qui
 *    saisit ceci en ce moment ? ») sur CHAQUE écran de saisie — exactement le
 *    genre de champ répétitif que la saisie post-marché est censée éviter
 *    (CLAUDE.md §3 règle 10 : clavier, tabulation, entrée, chiffres), pour une
 *    information qu'aucune règle de CLAUDE.md §3 (traçabilité par LOT, règle
 *    6 ; journal d'audit, règle 7) ni l'AFSCA ne réclame : ces obligations
 *    portent sur QUOI a changé et QUAND, jamais sur LEQUEL des deux associés
 *    a tenu le clavier.
 *
 *    Conclusion : la non-utilisation de `creePar`/`parQui` est documentée et
 *    justifiée par le principe mono-utilisateur, pas un oubli de câblage —
 *    elle rejoint cette liste d'exclusion. Ce qui reste une VRAIE question,
 *    hors du périmètre d'un agent : la table `utilisateur` elle-même (avec
 *    ses colonnes `role`/`actif`, pensées pour distinguer les deux personnes)
 *    est-elle un reliquat à retirer par une migration, ou faut-il conserver
 *    la ligne « Propriétaire » semée comme ancrage pour un futur multi-poste ?
 *    Une suppression de table n'est pas une décision d'agent — au porteur de
 *    trancher.
 *  - `docs/13-AUDIT-CAPACITES-ORPHELINES.md` (28-30/07) a été relu et
 *    RE-vérifié plutôt que recopié : plusieurs de ses constats sont devenus
 *    faux entre-temps (`production_consommation.quantite_reelle`,
 *    `production.cout_matiere_reel_cents`, `journal_audit`,
 *    `recette.recette_parent_id`, `conditionnement.reference_fournisseur`
 *    sont désormais câblés). Ne pas s'y fier sans revérifier.
 */

import { CATALOGUE_PARAMETRES } from '@batte/core';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Racine du dépôt : ce fichier vit dans `packages/db/src`. */
const RACINE = resolve(__dirname, '..', '..', '..');

function lire(cheminRelatif: string): string {
  try {
    return readFileSync(resolve(RACINE, cheminRelatif), 'utf8');
  } catch {
    // Un fichier absent ne porte évidemment aucun câblage : compte comme une
    // chaîne vide plutôt que de faire échouer la lecture elle-même.
    return '';
  }
}

/** Liste récursive des fichiers `.ts`/`.tsx` d'un dossier, hors `node_modules`/`dist`. */
function listerFichiersSource(dossier: string): string[] {
  let entrees: string[];
  try {
    entrees = readdirSync(dossier);
  } catch {
    return [];
  }
  const resultats: string[] = [];
  for (const entree of entrees) {
    if (entree === 'node_modules' || entree === 'dist') continue;
    const chemin = join(dossier, entree);
    const info = statSync(chemin);
    if (info.isDirectory()) {
      resultats.push(...listerFichiersSource(chemin));
    } else if (entree.endsWith('.ts') || entree.endsWith('.tsx')) {
      resultats.push(chemin);
    }
  }
  return resultats;
}

describe('Audit du 30/07/2026 — colonnes écrites, jamais lues', () => {
  it('la table `objectif` a un dépôt qui la lit ou l’écrit réellement, pas seulement une table déclarée au schéma', () => {
    // CORRIGÉ le 30/07/2026 : la table `objectif` (fiche 18 §4, 8 colonnes,
    // migrée en `0022_awesome_lyja.sql`) est maintenant câblée de bout en
    // bout — `creerObjectif`, `listerObjectifs`, `annulerObjectif`
    // (`packages/db/src/depots/objectifs.ts`), les routes
    // `GET/POST /objectifs` et `POST /objectifs/:id/annuler`
    // (`apps/api/src/routes/objectifs.ts`) et l'écran `Objectifs.tsx`. Ce
    // test était un `it.fails` qui affirmait le manque ; il s'est mis à
    // PASSER une fois le câblage fait, ce qui — par la convention maison
    // documentée en tête de fichier — force à retirer `.fails` : ceci est
    // désormais un test de NON-RÉGRESSION.
    const depotObjectifs = lire('packages/db/src/depots/objectifs.ts');
    const routeObjectifs = lire('apps/api/src/routes/objectifs.ts');
    const seedIndex = lire('packages/db/src/seed/index.ts');

    const contenu = `${depotObjectifs}\n${routeObjectifs}\n${seedIndex}`;
    expect(contenu).toMatch(/(insert|from)\(objectif\)/);
  });

  it('lot.motifStatutId et lot.dateChangementStatut sont lus quelque part, pas seulement écrits', () => {
    // CORRIGÉ le 30/07/2026 : ces deux colonnes sont écrites à CHAQUE
    // changement de statut d'un lot (`changerStatutLot`,
    // `services/mouvements.ts`) — la trace même qu'un contrôle AFSCA vient
    // chercher, « pourquoi ce lot a-t-il été bloqué, et quand » — et sont
    // désormais relues et exposées : `depots/stock.ts::lotsDeLIngredient`
    // (leftJoin sur `motif`, champs `motifStatutLibelle`/`dateChangementStatut`
    // de `LotEnBase`), `depots/tracabilite.ts::tracabiliteAvalLot` (même
    // paire, plus `statut`, sur `TracabiliteAvalLot`), le contrat
    // (`schemaTracabiliteAvalLot`, `packages/core/src/contrats/afsca.ts`) et
    // l'écran de traçabilité (`RegistreAfsca.tsx`, panneau Aval — pastille de
    // statut + mention « Dernier changement de statut »). Le registre imprimé
    // (`registre-afsca.ts`) sait désormais afficher la même mention sur un lot
    // rattaché à une non-conformité, mais de façon OPTIONNELLE : l'assemblage
    // réel (`apps/api/src/documents/donnees.ts`) est hors de la zone
    // d'écriture de cette mission et ne transmet pas encore ces deux champs —
    // voir le rapport de livraison de l'agent qui a fait ce correctif.
    //
    // Ce test était un `it.fails` qui affirmait le manque ; il s'est mis à
    // PASSER une fois le câblage fait — donc à échouer en tant que `it.fails`
    // — ce qui force, par la convention documentée en tête de fichier, à
    // retirer `.fails` : ceci est désormais un test de NON-RÉGRESSION.
    const contenu = [
      'packages/db/src/depots/stock.ts',
      'packages/db/src/depots/tracabilite.ts',
      'apps/api/src/documents/registre-afsca.ts',
      'apps/api/src/documents/donnees.ts',
      'apps/api/src/routes/stock.ts',
    ]
      .map(lire)
      .join('\n');

    expect(contenu).toMatch(/\.motifStatutId\b|\.dateChangementStatut\b/);
  });

  it('fichierScanPath (reception ou facture fournisseur) reçoit un jour une vraie valeur, ou est lu quelque part', () => {
    // CORRIGÉ le 30/07/2026 (mission « trois chemins de pièce jointe jamais
    // utilisés ») — côté FACTURE : `EntreeFacture.fichierScanPath` est
    // désormais écrite avec une vraie valeur (`enregistrerFacture`, Data URI
    // validée par `validerPieceJointe`, jamais `null` en dur) et relue
    // (`lireFactureDetail`, `FactureDetail.fichierScanPath`). Câblée
    // jusqu'à HTTP dans `apps/api/src/routes/factures.ts` — le contrat
    // partagé `schemaFactureDetail`/`schemaCreationFacture` (`@batte/core`)
    // ne portait pas ce champ (hors périmètre d'écriture de cette mission),
    // donc la route lit/enrichit directement le corps brut plutôt que de
    // passer par ce contrat pour cette seule clé — voir le commentaire de
    // tête de `services/factures.ts` pour la décision de conception
    // complète (pourquoi une Data URI stockée dans la ligne, jamais un
    // chemin disque ni un dossier annexe : seule cette voie reste protégée
    // par `packages/db/src/sauvegarde.ts`, qui ne sauvegarde QUE le contenu
    // de la base).
    //
    // Côté RÉCEPTION, seule la CAPACITÉ D'ÉCRITURE existe
    // (`EntreeReception.fichierScanPath`, `enregistrerReception`) : la
    // route HTTP qui l'appelle (`apps/api/src/routes/stock.ts`) est hors du
    // périmètre d'écriture de cette mission (fichier explicitement
    // protégé) et ne transmet pas encore ce champ — voir le rapport de
    // livraison pour le câblage exact à y ajouter (même patron que la
    // route facture).
    //
    // Ce test était un `it.fails` qui affirmait le manque ; il s'est mis à
    // PASSER une fois le câblage FACTURE fait (l'assertion porte sur les
    // DEUX colonnes ensemble, en OR) — donc à échouer en tant que
    // `it.fails` — ce qui force, par la convention documentée en tête de
    // fichier, à retirer `.fails` : ceci est désormais un test de
    // NON-RÉGRESSION.
    const contenu = [
      'packages/db/src/services/reception.ts',
      'packages/db/src/services/factures.ts',
      'apps/api/src/routes/commandes.ts',
      'apps/api/src/routes/factures.ts',
      'apps/api/src/documents/rendu.ts',
    ]
      .map(lire)
      .join('\n');

    const ecritureReelle = /fichierScanPath:\s*(?!null)[a-zA-Z]/.test(contenu);
    const lectureQuelconque = /\.fichierScanPath\b/.test(contenu);
    expect(ecritureReelle || lectureQuelconque).toBe(true);
  });

  it('reception.commandeId est relue depuis la table, pas seulement écrite — CORRIGÉ le 30/07/2026', () => {
    // Garde de NON-RÉGRESSION (retiré de `it.fails` — convention de ce
    // fichier, voir l'en-tête). Le constat initial était juste : écrite à la
    // création (`services/reception.ts:170`, `commandeId: entree.commandeId
    // ?? null`) et utilisée pour SOLDER la commande AU MOMENT DE L'ÉCRITURE
    // (sur `entree.commandeId`, le paramètre d'entrée — pas une relecture de
    // la colonne persistée). Aucun `.from(reception)` existant ne projetait
    // `commandeId` (`depots/comptabilite.ts`, `services/factures.ts` ne
    // projettent respectivement que `montantTotalCents` puis
    // `id`/`fournisseurId`/`numero`).
    //
    // Mission « deux rattachements écrits et jamais relus » (30/07/2026) —
    // referme la boucle d'achat dans le sens commande -> réception (le seul
    // sens atteignable depuis la zone d'écriture de cette mission :
    // `services/reception.ts` et `apps/api/src/routes/stock.ts`, où vivrait
    // le sens réception -> commande, en sont hors périmètre) :
    //
    //  - `receptionsRecentesParCommande` (`services/commandes.ts`) relit
    //    `reception.commandeId` pour enrichir `listerCommandes` d'un
    //    `receptionNumero`/`receptionStatut` par commande ;
    //  - `receptionsLieesACommande` (même fichier) relit la même colonne pour
    //    exposer, sur `lireCommandeDetail`, la liste complète des réceptions
    //    qui référencent cette commande ;
    //  - les deux sont exposées par `schemaCommandeResume`/`schemaCommandeDetail`
    //    (`packages/core/src/contrats/commandes.ts`) et affichées dans
    //    `Achats.tsx` (colonne « Réception », bloc « Réception(s) liée(s) »
    //    sur la fiche commande).
    //
    // Cette relecture répond à une question réelle et non décorative : une
    // commande reste affichée `recue` pour toujours même quand la réception
    // qui l'avait soldée est ensuite ANNULÉE (`annulerReception` documente
    // explicitement ne jamais revenir sur le statut de la commande). Sans
    // cette relecture, rien ne signalait cette divergence — `Achats.tsx`
    // l'affiche désormais explicitement quand elle se produit. Voir
    // `services/commandes.test.ts`, describe « reception.commandeId
    // reprojetee », pour le test qui la démontre.
    const contenu = [
      'packages/db/src/services/commandes.ts',
      'packages/core/src/contrats/commandes.ts',
      'apps/web/src/pages/Achats.tsx',
    ]
      .map(lire)
      .join('\n');

    expect(contenu).toMatch(/reception\.commandeId\b/);
  });

  it('recetteLigne.noteTechnique est exposée par au moins un contrat ou une fonction de lecture — CORRIGÉ le 30/07/2026', () => {
    // Garde de NON-RÉGRESSION (retiré de `it.fails` — convention de ce
    // fichier, voir l'en-tête) : la note était saisie et conservée d'un
    // enregistrement à l'autre (`notesTechniquesExistantes`,
    // `depots/referentiel-ecriture.ts`) mais jamais RELUE par aucun contrat —
    // ni `lireRecetteDetail`/`RecetteDetail` (`depots/recettes.ts`,
    // `contrats/recettes.ts`, toujours vrai aujourd'hui, conservés ci-dessous
    // pour le jour où ce chemin sera câblé à son tour), ni ailleurs.
    //
    // Câblée désormais via `listerRecettesReferentiel`
    // (`depots/referentiel-ecriture.ts`, champ `notesTechniques`, non vide
    // seulement) et `schemaRecetteReferentiel`
    // (`contrats/referentiel.ts`) — exposée par `GET /referentiel/recettes`,
    // déjà utilisée par `Recettes.tsx` pour préremplir et afficher la note à
    // l'écran, sans qu'aucune route n'ait dû changer.
    const depotRecettes = lire('packages/db/src/depots/recettes.ts');
    const contratsRecettes = lire('packages/core/src/contrats/recettes.ts');
    const depotReferentielEcriture = lire('packages/db/src/depots/referentiel-ecriture.ts');
    const contratsReferentiel = lire('packages/core/src/contrats/referentiel.ts');

    expect(
      `${depotRecettes}\n${contratsRecettes}\n${depotReferentielEcriture}\n${contratsReferentiel}`,
    ).toMatch(/noteTechnique/);
  });

  it('frais_reception est relue par au moins une fonction du dépôt ou une route — CORRIGÉ le 30/07/2026', () => {
    // Écrite par `enregistrerFacture` (un insert par ligne de frais rapproché),
    // ventilée immédiatement sur `lot.prixLigneCents` — mais la table
    // elle-même n'était jamais RELUE nulle part. Garde de NON-RÉGRESSION
    // (retiré de `it.fails` — convention de ce fichier, voir l'en-tête) :
    // `totalFraisReceptionCents` (`packages/db/src/depots/comptabilite.ts`) la
    // relit désormais pour une question réelle, pas pour faire passer ce test
    // — `reception.montantTotalCents` (déjà lu par `totalAchatsMarchandisesCents`)
    // est figé au bon de livraison et n'est JAMAIS mis à jour quand la facture
    // arrive avec ses frais de transport : sans cette relecture, un
    // décaissement réel restait invisible de TOUTE charge de l'exercice.
    // Câblée dans `syntheseExercice` comme cinquième population de charges
    // déductibles, au même titre que les achats de marchandises, les frais de
    // session et la commission carte.
    const fichiers = [
      lire('packages/db/src/services/factures.ts'),
      lire('packages/db/src/depots/comptabilite.ts'),
      lire('apps/api/src/routes/factures.ts'),
      lire('apps/api/src/routes/commandes.ts'),
    ].join('\n');
    const lectureTable = /\.from\(fraisReception\)|\bfraisReception\.\w+/;
    expect(lectureTable.test(fichiers)).toBe(true);
  });

  /**
   * `mouvementStock.valuationDate` : RECLASSÉE EN EXCLUSION le 30/07/2026,
   * retirée d'ici (voir l'en-tête de fichier, section « CE QUI N'EST PAS
   * COUVERT ICI ») — c'était le DERNIER `it.fails` vivant de ce dépôt.
   *
   * Re-vérifié contre l'état ACTUEL du code, pas recopié d'une passe
   * précédente : les six chemins qui créent un mouvement
   * (`services/reception.ts`, `services/production.ts`,
   * `services/sessions.ts`, `services/nomenclature-vente.ts`,
   * `services/garnitures.ts`, `services/mouvements.ts`) écrivent tous
   * `valuationDate` avec EXACTEMENT la même valeur que `dateMouvement`, et
   * les deux chemins de contrepassation (`annulerSession`,
   * `annulerMouvement`) recopient `origine.valuationDate` de l'écriture
   * annulée — jamais une date qui diverge. `calculerCump`
   * (`packages/core/src/stock.ts`), seule fonction du dépôt qui valorise le
   * stock, ne lit d'ailleurs JAMAIS `mouvement_stock` : elle calcule le coût
   * moyen depuis `lot.prixLigneCents / lot.quantiteInitiale`
   * (`depots/stock.ts`, `LotEnBase.prixUnitaireCents`) — elle ne PEUT
   * structurellement pas consulter cette colonne. Et le seul mécanisme qui
   * corrige réellement un coût après coup — une facture fournisseur arrivée
   * en retard (`enregistrerFacture`, `services/factures.ts`) — écrit
   * DIRECTEMENT sur `lot.prixLigneCents`, jamais sur `mouvement_stock` : il
   * contourne cette colonne plutôt que de la remplir avec une date distincte.
   *
   * Câbler une lecture ici (par exemple sur `mouvementsDuLot` →
   * `schemaMouvementLot` → l'historique d'un lot à l'écran) aurait affiché,
   * sur CHAQUE ligne existante à ce jour, la MÊME valeur que la colonne
   * `dateMouvement` déjà affichée juste à côté — un doublon visuel, pas une
   * information, exactement l'illusion de contrôle que ce fichier existe
   * pour repérer. Décision qui reste au porteur, documentée et non tranchée
   * ici : soit une vraie divergence entre les deux dates est introduite un
   * jour (un ajustement de coût rétroactif écrit directement sur
   * `mouvement_stock` plutôt que sur `lot` — `docs/07-DOCTRINE-ERP-ET-
   * DESIGN.md` §6.8 rang 8 garde l'idée au catalogue), et alors cette
   * exclusion devra être révisée et un test de non-régression reconstruit à
   * sa place ; soit la colonne est un reliquat que seule une migration peut
   * retirer (hors périmètre d'un agent).
   */

  it('production.ordrePrevisionId (previsionId) est écrite avec une vraie valeur ET relue jusqu’à l’écran — CÂBLÉ le 30/07/2026', () => {
    // CORRIGÉ le 30/07/2026 (mission « relier une fournée à la prévision qui
    // l'a motivée »), par l'agent qui possédait `services/production.ts` —
    // celui-là même dont le renoncement précédent (repris ci-dessous pour
    // mémoire) avait raison sur le fond : la question était réelle, seule
    // l'écriture manquait un possesseur de fichier.
    //
    // CE QUI ÉTAIT CONSTATÉ AVANT CE LOT : `prevision.sessionId` +
    // `production.sessionId` remontent déjà TRANSITIVEMENT d'une prévision à
    // ses productions via la session commune — mais une session porte
    // PLUSIEURS révisions de prévision archivées (D-058 : J-7, J-3, J-1, le
    // matin même), donc ce lien ne dit jamais LAQUELLE a motivé CE lancement
    // précis, ni de combien la décision s'en est écartée.
    //
    // CÂBLAGE FAIT — trois couches :
    //  1. ÉCRITURE (`services/production.ts`) : `EntreeProduction` porte
    //     désormais `previsionId` (optionnel, `null` = décidée sans
    //     prévision, un cas normal — dépannage, rattrapage). `lancerProduction`
    //     l'écrit TEL QUEL sur `ordrePrevisionId`, après avoir vérifié, via
    //     `verifierPrevisionRattachable`, que la prévision existe et — si une
    //     session est AUSSI fournie — qu'elle porte sur LA MÊME session
    //     (`prevision_session_incoherente` sinon).
    //  2. LECTURE (`depots/productions.ts`) : `lireProductionDetail` (type de
    //     retour désormais EXPLICITE, `ProductionDetailLue` — la classe de
    //     défaut relevée ce jour, une projection élargie sans annotation
    //     peut violer un contrat Zod sans que `tsc` ne le voie) relit la
    //     prévision rattachée et calcule `ecartVsPrevisionBp` : l'écart
    //     SIGNÉ entre ce qui a été décidé (`crepesTheoriques`) et ce que le
    //     modèle suggérait CE soir-là après écrêtage par les contraintes
    //     dures (`crepesRetenues`, jamais le p50 brut). Exposé par
    //     `schemaProductionDetail` (`contrats/productions.ts`).
    //  3. ÉCRAN (`Production.tsx`) : LE POINT DÉLICAT de cette mission était
    //     de choisir QUELLE prévision rattacher au lancement, sans que le
    //     service ne tranche seul après coup. Résolu en laissant l'ÉCRAN
    //     calculer `previsionRetenue` — la plus RÉCENTE prévision archivée
    //     pour la session choisie dans le formulaire (même convention que
    //     `impactMesureSession`, `depots/previsions.ts` : « la plus proche de
    //     ce qui a réellement guidé la décision de production ») — et
    //     l'AFFICHER avant le clic sur « Lancer la production » : c'est ce
    //     que le porteur voit qui est envoyé, jamais un choix invisible fait
    //     par le serveur. Le détail d'une production affiche ensuite « Prévision
    //     suivie » avec l'écart, seulement quand une prévision est rattachée.
    const contenu = [
      lire('packages/db/src/services/production.ts'),
      lire('packages/core/src/contrats/productions.ts'),
      lire('packages/db/src/depots/productions.ts'),
      lire('apps/web/src/pages/Production.tsx'),
    ].join('\n');

    // Écriture réelle : jamais un `null` littéral, toujours `entree.previsionId`
    // (vérifié au préalable par `verifierPrevisionRattachable`).
    expect(contenu).toMatch(/ordrePrevisionId:\s*entree\.previsionId/);

    // Lecture réelle, sur les trois couches : le dépôt relit la colonne
    // persistée ET calcule l'écart, le contrat l'expose, l'écran choisit
    // VISIBLEMENT laquelle rattacher et affiche l'écart au porteur.
    expect(contenu).toMatch(/\.ordrePrevisionId\b/);
    expect(contenu).toMatch(/ecartVsPrevisionBp/);
    expect(contenu).toMatch(/previsionRetenue/);
  });

  /**
   * CORRIGÉ le 30/07/2026 — `it.fails` converti.
   *
   * Les quatre facteurs de précision de la fiche 07
   * (`facteurComparableCalendaireBp`, `facteurJourSemaineBp`,
   * `facteurVacancesScolairesBp`, `facteurSessionConsecutiveBp`) sont
   * désormais reprojetés par `qualiteModele()`
   * (`packages/db/src/depots/previsions.ts`, fonction `predicteursPrecision`) :
   * combien de fois, sur l'ensemble des prévisions archivées, chaque
   * prédicteur a été ADMIS (colonne non nulle) contre combien de fois il ne
   * l'a pas été. Exposé par `schemaQualiteModele.predicteursPrecision`
   * (`packages/core/src/contrats/previsions.ts`) et affiché par l'écran
   * « Qualité du modèle » — panneau « Précision des prédicteurs (fiche 07) »,
   * le bon endroit puisque c'est cet écran qui lit déjà l'historique archivé
   * (contrairement à « Prochaine session », qui n'affiche que le calcul EN
   * COURS).
   *
   * Ce test était un `it.fails` qui affirmait le manque ; il s'est mis à
   * PASSER une fois le câblage fait, ce qui — par la convention maison
   * documentée en tête de fichier — force à retirer `.fails` : ceci est
   * désormais un test de NON-RÉGRESSION.
   */
  it('les quatre facteurs de précision (fiche 07) sont lus par l’écran Qualité du modèle ou le contrat de prévision', () => {
    const ecran = lire('apps/web/src/pages/QualiteModele.tsx');
    const contrat = lire('packages/core/src/contrats/previsions.ts');
    const noms =
      /facteurComparableCalendaireBp|facteurJourSemaineBp|facteurVacancesScolairesBp|facteurSessionConsecutiveBp/;
    expect(noms.test(`${ecran}\n${contrat}`)).toBe(true);
  });

  /**
   * CORRIGÉ le 30/07/2026 — `it.fails` converti, PARTIELLEMENT.
   *
   * Deux des dix colonnes analytiques archivées sont désormais reprojetées
   * par le DÉPÔT (`packages/db/src/depots/previsions.ts`, fonction
   * `syntheseManqueAGagner`, appelée par `qualiteModele()`) : `manqueAGagnerCents`
   * (cumulé, en ignorant les prévisions jamais chiffrées — jamais un zéro
   * inventé pour elles) et `contrainteLimitante` (fréquence par libellé
   * exact). Ce sont les deux colonnes qui répondent à « combien le fait de ne
   * pas pouvoir produire plus a-t-il coûté, et par quoi la production est-elle
   * le plus souvent bridée ? » (docs/03 « Décision de production ») —
   * affichées sur l'écran « Qualité du modèle », panneau « Manque à gagner —
   * contrainte de production ».
   *
   * Les HUIT autres (`facteurEvenementBp`, `facteurTendanceBp`,
   * `inflationSigmaMeteoBp`, `quantileCibleBp`, `repartitionRecettes`,
   * `nbSessionsComparables`, `commentaireIa`, `explicationFacteurs`) restent
   * VOLONTAIREMENT non reprojetées, PAS par oubli : vérifié que
   * `npm run backtest` (`packages/db/src/scripts/backtest.ts`) ne les
   * consomme pas davantage — ce script NE LIT JAMAIS la table `prevision`,
   * il rejoue l'historique depuis les tables sources
   * (`observationsDuLieu`/`observationsCompletesDuLieu`, sur `sessionMarche`,
   * `meteoObservation`, `evenement`) — donc aucune des huit ne peut être
   * justifiée comme « archivée pour alimenter le rejeu ». Elles restent sans
   * consommateur identifié pour une raison différente selon le champ : les
   * quatre facteurs de base et le quantile cible sont déjà visibles EN DIRECT
   * sur « Prochaine session » (hors périmètre de ce lot) ; la répartition en
   * recettes, le commentaire IA et l'explication textuelle sont des
   * artefacts PAR PRÉVISION, pas des indicateurs de qualité agrégés, et
   * aucune question isolée ne justifie encore de leur donner une place sur
   * cet écran-ci. Câbler sans qu'une vraie question le demande serait la
   * même faute que la colonne orpheline que ce test dénonce.
   *
   * Ce test était un `it.fails` qui affirmait qu'AUCUNE des dix colonnes
   * n'était reprojetée ; il s'est mis à PASSER une fois DEUX colonnes
   * câblées, ce qui — par la convention maison documentée en tête de fichier
   * — force à retirer `.fails` : ceci est désormais un test de
   * NON-RÉGRESSION, resserré sur les deux colonnes effectivement câblées
   * plutôt que sur « au moins une », pour ne pas se satisfaire d'un futur
   * câblage isolé des huit autres sans mise à jour de ce commentaire. Vise
   * toujours le DÉPÔT (`prevision.<colonne>` qualifié), jamais un DTO
   * homonyme calculé en direct comme celui de `ProchaineSession.tsx`.
   */
  it('prevision : manqueAGagnerCents et contrainteLimitante sont reprojetées par le dépôt', () => {
    const depotPrevisions = lire('packages/db/src/depots/previsions.ts');

    const analytiques = [
      'facteurEvenementBp',
      'facteurTendanceBp',
      'inflationSigmaMeteoBp',
      'quantileCibleBp',
      'contrainteLimitante',
      'manqueAGagnerCents',
      'repartitionRecettes',
      'nbSessionsComparables',
      'commentaireIa',
      'explicationFacteurs',
    ];

    const reprojetees = analytiques.filter((colonne) =>
      new RegExp(`\\bprevision\\.${colonne}\\b`).test(depotPrevisions),
    );

    expect(reprojetees.sort()).toEqual(['contrainteLimitante', 'manqueAGagnerCents']);
  });

  it('sessionFrais.justificatifPath reçoit une vraie valeur depuis une route — CORRIGÉ le 30/07/2026', () => {
    // Même défaut que fichierScanPath, sur une troisième table :
    // `cloturerSession` écrit une ligne `session_frais` par catégorie non
    // nulle et fixe `justificatifPath: null` — aucune route ne permet de
    // joindre un vrai chemin, contrairement à `depense`
    // (`routes/comptabilite.ts`, qui accepte `corps.justificatifPath`). La
    // colonne EST relue (`listerFraisSession`) mais ne renverra jamais qu'un
    // `null`.
    //
    // CORRIGÉ le 30/07/2026 (mission « justificatif d'un frais de session »,
    // par un autre agent en parallèle de cet inventaire — la bascule a été
    // repérée ici parce que ce test s'est mis à PASSER, donc à échouer en
    // tant que `it.fails`, ce qui force — par la convention documentée en
    // tête de fichier — à retirer `.fails` : ceci est désormais un test de
    // NON-RÉGRESSION). Chaque catégorie SAISIE (emplacement, déplacement,
    // gaz, divers — jamais `energie`, poste CALCULÉ sans ticket à joindre)
    // porte désormais SON PROPRE justificatif, validé par `validerPieceJointe`
    // (`cloturerSession`, `services/sessions.ts`) — même contrôle qu'une pièce
    // jointe de facture ou de réception — et transmis par un schéma DÉDIÉ
    // (`schemaJustificatifsFraisSession`, `apps/api/src/routes/sessions.ts` :
    // `schemaClotureSession` partagé, hors zone d'écriture de cette
    // correction, ne les porte pas, d'où ce second `.parse()` sur la même
    // requête brute), saisi depuis `Sessions.tsx`. Resserré sur la preuve
    // réelle du câblage (l'ancien `corps.justificatifPath` ne correspond plus
    // au nom de variable qu'utilise la route corrigée) plutôt que sur l'ancien
    // `some()` entre écriture et route.
    const ecriture = lire('packages/db/src/services/sessions.ts');
    const routeCloture = lire('apps/api/src/routes/sessions.ts');

    // Écriture réelle : chaque catégorie passe par `validerPieceJointe`,
    // jamais un `null` en dur.
    expect(ecriture).toMatch(/justificatifPath:\s*validerPieceJointe\(/);

    // La route peut transmettre un vrai chemin pour les quatre catégories
    // saisies (jamais `energie`, qui n'a pas de ticket).
    for (const categorie of ['emplacement', 'deplacement', 'gaz', 'divers']) {
      expect(routeCloture).toMatch(new RegExp(`${categorie}JustificatifPath`));
    }
  });

  /**
   * `exerciceTracabilite.documentId` : RECLASSÉ EN EXCLUSION le 30/07/2026,
   * retiré d'ici (voir l'en-tête de fichier, section « CE QUI N'EST PAS
   * COUVERT ICI ») — le commentaire de justification de
   * `enregistrerExerciceTracabilite` (`packages/db/src/services/afsca.ts`)
   * est désormais structurellement identique à celui, déjà exclu, de
   * `commande_fournisseur.document_id` : un `null` à vie qui est CORRECT, pas
   * une colonne dont personne ne sait si elle sert.
   */

  /**
   * `utilisateur` (table entière) : RECLASSÉE EN EXCLUSION le 30/07/2026,
   * retirée d'ici (voir l'en-tête de fichier, section « CE QUI N'EST PAS
   * COUVERT ICI ») — la non-utilisation de `creePar`/`parQui` est justifiée
   * par le principe mono-utilisateur de CLAUDE.md §0, pas un oubli de
   * câblage. Le sort de la table elle-même (conserver vs. retirer par
   * migration) reste une décision du porteur, pas d'un agent.
   */
});

describe('Audit du 30/07/2026 — colonnes ni écrites ni lues (inertes)', () => {
  it('menu_composition.prixForceCents est écrit ET lu par le dépôt — CORRIGÉ le 30/07/2026', () => {
    // Garde de NON-RÉGRESSION (retiré de `it.fails` — convention de ce
    // fichier, voir l'en-tête). Le constat initial était juste :
    // `creerCompositionMenu`/`modifierCompositionMenu` n'écrivaient jamais ce
    // champ, et `calculerVentilationMenu` ne portait qu'un concept
    // `prixForceCents` ÉPHÉMÈRE reçu de l'appelant, jamais persisté ni relu
    // par `CompositionMenuLigne`.
    //
    // Câblé désormais : `SaisieCompositionMenuAvecPrixForce` élargit la
    // saisie standard (`depots/menus.ts`) avec ce champ ; `creerCompositionMenu`
    // l'écrit (`null` par défaut, jamais `0`) et `modifierCompositionMenu` le
    // conserve quand il est absent, l'efface sur `null` explicite, le change
    // sur un montant — même doctrine que `noteTechnique`
    // (`depots/referentiel-ecriture.ts`). `CompositionMenuLigne.prixForceCents`
    // l'expose en lecture, et `calculerVentilationMenu` l'applique désormais
    // PAR DÉFAUT (le paramètre éphémère ne fait plus que le SURCLASSER pour
    // une simulation ponctuelle).
    //
    // CE QUI RESTE HORS DE CE FICHIER (documenté dans `depots/menus.ts` et le
    // rapport de livraison) : `schemaSaisieCompositionMenu`/`schemaCompositionMenu`
    // (`@batte/core`, `contrats/menus.ts`) ne portent pas encore ce champ,
    // donc aucun écran ne peut encore le SAUVEGARDER par menu — seul un appel
    // direct au dépôt le peut aujourd'hui. Ce test vise délibérément le dépôt
    // seul, pas le contrat HTTP.
    const menus = lire('packages/db/src/depots/menus.ts');

    const ecritureColonne = /\.values\(\{[^}]*prixForceCents|\.set\(\{[^}]*prixForceCents/s;
    const lectureColonne = /prixForceCents:\s*l\.ligne\.prixForceCents/;

    expect(ecritureColonne.test(menus)).toBe(true);
    expect(lectureColonne.test(menus)).toBe(true);
  });
});

/**
 * CORRIGÉ le 30/07/2026 — mission « météo prévue et réelle d'une session »,
 * `it.fails` converti (convention de ce fichier, voir l'en-tête).
 *
 * Le constat était juste : `meteoPrevue`/`meteoReelle` n'étaient ni écrites
 * ni lues nulle part hors `schema.ts`, et `dateCloture` était écrite à
 * chaque clôture (`services/sessions.ts`) mais absente des deux couches de
 * LECTURE (`schemaSessionDetail`, `lireSessionDetail`) — Zod tronque
 * silencieusement les clés qu'il ne connaît pas (même défaut que
 * `distanceReelleKm`, Trou 1), donc une session close n'affichait jamais
 * quand elle l'avait été.
 *
 * Câblage fait : `cloturerSession` (`packages/db/src/services/sessions.ts`)
 * FIGE désormais `meteoPrevue`/`meteoReelle` à la clôture, en relisant
 * `meteo_observation` par (lieu, date) — jamais la « dernière connue » à
 * l'ouverture (horizon 0, « le matin même ») pour `meteoPrevue`, mais la
 * révision la plus proche de J-1 disponible (`horizonJours >= 1`, la plus
 * petite) : c'est la prévision sur laquelle la décision de production a pu
 * réellement se prendre, jamais la plus récente. `dateCloture` est
 * désormais exposée par `schemaSessionDetail` (`packages/core/src/
 * contrats/sessions.ts`) et relue par `lireSessionDetail`
 * (`packages/db/src/depots/sessions.ts`).
 *
 * Vérifie l'ÉCRITURE réelle (pas un `null` en dur, même piège que
 * `justificatifPath`/`ordrePrevisionId` ailleurs dans ce fichier) ET
 * l'exposition par le contrat de lecture — les deux couches, comme le test
 * d'origine le faisait déjà, mais sur les TROIS colonnes séparément plutôt
 * qu'un `some()`.
 */
describe('Audit du 30/07/2026 — session_marche : météo prévue/réelle et date de clôture, CORRIGÉES', () => {
  it('meteoPrevue et meteoReelle sont FIGÉES à la clôture (pas un `null` en dur) et exposées par le contrat de lecture', () => {
    const service = lire('packages/db/src/services/sessions.ts');
    const depot = lire('packages/db/src/depots/sessions.ts');
    const contrat = lire('packages/core/src/contrats/sessions.ts');

    // Écriture réelle : `cloturerSession` fige une valeur CALCULÉE
    // (`releveMeteoPrevue`/`releveMeteoReelle`, lues depuis
    // `meteo_observation`), jamais un `null` littéral.
    expect(service).toMatch(/meteoPrevue:\s*(?!null\b)[a-zA-Z_][\w.]*/);
    expect(service).toMatch(/meteoReelle:\s*(?!null\b)[a-zA-Z_][\w.]*/);

    // Lecture réelle : le dépôt relit la colonne persistée (pas un `null`
    // en dur), et le contrat la déclare pour que Zod ne la tronque plus.
    expect(depot).toMatch(/meteoPrevue:\s*(?!null\b)[a-zA-Z_][\w.()]*/);
    expect(depot).toMatch(/meteoReelle:\s*(?!null\b)[a-zA-Z_][\w.()]*/);
    expect(contrat).toMatch(/meteoPrevue:\s*schemaMeteoSessionReleve\.nullable\(\)/);
    expect(contrat).toMatch(/meteoReelle:\s*schemaMeteoSessionReleve\.nullable\(\)/);
  });

  it('dateCloture est relue par lireSessionDetail et exposée par schemaSessionDetail', () => {
    const depot = lire('packages/db/src/depots/sessions.ts');
    const contrat = lire('packages/core/src/contrats/sessions.ts');

    expect(depot).toMatch(/dateCloture:\s*(?!null\b)[a-zA-Z_][\w.]*/);
    expect(contrat).toMatch(/dateCloture:\s*z\.string\(\)\.nullable\(\)/);
  });
});

describe('Audit du 30/07/2026 — colonnes structurellement inatteignables', () => {
  /*
   * Famille de défaut différente de « personne ne s'en sert » : ici, la
   * colonne ne PEUT PAS être remplie — la donnée n'est jamais demandée à la
   * source, ou le seul chemin d'écriture est injoignable depuis HTTP. C'est
   * la variante la plus dangereuse : le maillon a l'air câblé de bout en bout
   * quand on lit une seule couche.
   */

  /**
   * CORRIGÉ le 30/07/2026 — `it.fails` converti.
   *
   * Le constat était juste : les quatre colonnes ne pouvaient pas être remplies
   * parce que la requête à Open-Meteo ne demandait jamais les variables
   * correspondantes — gratuites, et tenant dans le même appel HTTP. Le moteur
   * raisonnait donc sur le cumul de pluie TOMBÉE, jamais sur la probabilité
   * ANNONCÉE : deux informations différentes, et c'est la seconde qui compte
   * puisque la pâte se produit la veille, sur la prévision.
   *
   * Le câblage a été fait, ce test s'est mis à passer — donc à échouer en tant
   * qu'`it.fails` — et il devient ici une garde de non-régression : si quelqu'un
   * retirait ces variables de la requête, les colonnes redeviendraient mortes
   * en silence, sans qu'aucune erreur ne le signale.
   */
  it('meteo_observation : au moins une des quatre colonnes mortes est demandée à Open-Meteo ou écrite avec une vraie valeur', () => {
    // `temperatureRessentieC`, `probabilitePluieBp`, `codeMeteo`,
    // `donneesBrutes` sont écrites en dur à `null` ET absentes du `set` de
    // l'`onConflictDoUpdate` : deux verrous. Cause en amont :
    // `open-meteo.ts` ne demande que
    // `temperature_2m,precipitation,wind_speed_10m,cloud_cover` — les trois
    // variables manquantes existent chez Open-Meteo, sont gratuites et
    // tiennent dans le MÊME appel HTTP. `probabilitePluieBp` est la perte
    // concrète : docs/03 raisonne sur le RISQUE de pluie, le moteur n'a que
    // le cumul constaté.
    const clientMeteo = lire('apps/api/src/meteo/open-meteo.ts');
    const depotPrevisions = lire('packages/db/src/depots/previsions.ts');

    const demandeeALaSource =
      /apparent_temperature|precipitation_probability|weather_code|weathercode/.test(clientMeteo);
    const ecriteAvecValeur =
      /(temperatureRessentieC|probabilitePluieBp|codeMeteo|donneesBrutes)\s*:\s*(?!null\b)[a-zA-Z]/.test(
        depotPrevisions,
      );

    expect(demandeeALaSource || ecriteAvecValeur).toBe(true);
  });

  it('equipement_session : la clôture HTTP peut transmettre les durées d’utilisation (equipementsUtilises au contrat ou à la route) — CORRIGÉ le 30/07/2026', () => {
    // Garde de NON-RÉGRESSION (retiré de `it.fails` — convention de ce
    // fichier, voir l'en-tête) : le pire cas de l'audit était que les trois
    // couches avaient l'air correctes une par une. ÉCRITURE réelle
    // (`enregistrerUtilisationEquipement`, appelée dans `cloturerSession`).
    // LECTURE réelle et atteignable (alimente deux routes affichées par
    // l'écran Équipements). MAIS `equipementsUtilises` n'existait ni dans
    // `schemaClotureSession`, ni dans la route de clôture, ni comme champ
    // de saisie dans `Sessions.tsx` : le contrat HTTP ne pouvait JAMAIS
    // transmettre ce tableau, il valait `?? []` à chaque clôture réelle.
    // Conséquence : le coût d'électricité affiché restait nul pour
    // toujours — un zéro qui se lit « ça ne coûte rien » et voulait dire
    // « on n'a jamais pu le saisir ». Désormais câblé de bout en bout :
    // contrat (`schemaUtilisationEquipementSaisieCloture`), route
    // (`routes/sessions.ts`) et formulaire (`Sessions.tsx`, gardé sur la
    // disponibilité électrique du lieu, D-055).
    const contratSessions = lire('packages/core/src/contrats/sessions.ts');
    const routeSessions = lire('apps/api/src/routes/sessions.ts');

    expect(`${contratSessions}\n${routeSessions}`).toMatch(/equipementsUtilises/);
  });

  it('comptabilite : echeance.montantEstimeCents est saisissable par un schéma d’entrée dédié — CORRIGÉ le 30/07/2026', () => {
    // Garde de NON-RÉGRESSION (retiré de `it.fails` — convention de ce
    // fichier, voir l'en-tête). Le constat initial était juste :
    // `montantEstimeCents` était déclarée dans le contrat de SORTIE (donc
    // renvoyée par l'API, affichable) et écrite en dur à `null` sans qu'aucun
    // schéma d'entrée ne l'accepte — `echeance` n'exposait que « marquer
    // faite ».
    //
    // Câblé désormais par un schéma DÉDIÉ, `schemaEstimerMontantEcheance`
    // (pas un élargissement de `schemaMarquerEcheanceFaite` : marquer une
    // échéance faite et estimer son coût sont deux gestes indépendants),
    // exposé par `POST /echeances/:id/estimer-montant`
    // (`apps/api/src/routes/comptabilite.ts`) et saisissable dans
    // l'échéancier de `Comptabilite.tsx`. `null` explicite reste accepté :
    // effacer une estimation devenue incertaine ne doit jamais retomber sur
    // un 0 silencieux.
    const contratsComptabilite = lire('packages/core/src/contrats/comptabilite.ts');

    const debut = contratsComptabilite.indexOf(
      'export const schemaEstimerMontantEcheance = z.object({',
    );
    expect(debut).toBeGreaterThanOrEqual(0);
    const fin = contratsComptabilite.indexOf('});', debut);
    const corps = contratsComptabilite.slice(debut, fin);
    expect(corps).toMatch(/montantEstimeCents/);

    const routeComptabilite = lire('apps/api/src/routes/comptabilite.ts');
    expect(routeComptabilite).toMatch(/\/echeances\/:id\/estimer-montant/);
  });

  it('comptabilite : immobilisation.dateCession reste VOLONTAIREMENT non saisissable — décision documentée, pas un oubli', () => {
    // Ce cas reste sciemment NON câblé, à la différence de
    // `montantEstimeCents` ci-dessus (même audit, même test à l'origine, même
    // catégorie de colonne). Chercher `dateCession:\s*(?!null)` dans les
    // dépôts matchait à tort la DÉCLARATION DE TYPE `readonly dateCession:
    // string | null` : le piège qui a justifié de viser les schémas d'ENTRÉE
    // eux-mêmes, ci-dessous.
    //
    // RE-VÉRIFIÉ le 30/07/2026 (cette mission) : ni `planAmortissement` ni
    // `valeurNetteComptable` (`packages/core/src/comptabilite.ts`) ne
    // regardent cette colonne — un bien cédé continuerait de produire ses
    // annuités déductibles jusqu'au bout du plan si la saisie s'ouvrait
    // aujourd'hui. C'est EXACTEMENT le risque déjà écrit noir sur blanc dans
    // `docs/16-AUDIT-COMPTABILITE.md` §5.3 et `docs/05-DECISIONS.md` : « le
    // traitement de l'année de cession (prorata jusqu'à la vente, plus- ou
    // moins-value de cession, sort de la valeur nette résiduelle) est
    // entièrement réglementaire. Coder « on arrête après l'année de cession »
    // serait inventer une convention. À spécifier avant d'ouvrir la saisie
    // d'une cession. »
    //
    // Décision prise ici : NE PAS ouvrir cette saisie tant que cette question
    // n'a pas de réponse externe (comptable/porteur) — CLAUDE.md §9, « en cas
    // d'ambiguïté dans la spec, poser la question, ne pas deviner ». Ce test
    // vérifie que cette décision tient : `dateCession` reste absente de tout
    // schéma d'ENTRÉE. S'il se met à ÉCHOUER, c'est qu'une saisie a été
    // ouverte SANS que la question réglementaire ci-dessus ait été tranchée —
    // à vérifier avant de le faire passer au vert.
    const contratsComptabilite = lire('packages/core/src/contrats/comptabilite.ts');

    const schemasEntree = [
      'schemaCreationImmobilisation',
      'schemaCreationDepense',
      'schemaMarquerEcheanceFaite',
      'schemaEstimerMontantEcheance',
    ];

    const saisissable = schemasEntree.some((nom) => {
      const debut = contratsComptabilite.indexOf(`export const ${nom} = z.object({`);
      if (debut < 0) return false;
      const fin = contratsComptabilite.indexOf('});', debut);
      const corps = contratsComptabilite.slice(debut, fin);
      return /dateCession/.test(corps);
    });

    expect(saisissable).toBe(false);
  });
});

/**
 * ═══ TROIS DÉFAUTS CORRIGÉS LE 30/07/2026 — `it.fails` CONVERTIS ═══
 *
 * Les trois index manquants relevés par cet audit ont été créés dans la
 * migration `0027_needy_tiger_shark.sql`. Les `it.fails` se sont donc mis à
 * ÉCHOUER — exactement ce que la convention maison décrite en tête de fichier
 * prévoit — ce qui a forcé leur conversion en tests de non-régression
 * ordinaires. C'est le cycle complet de cette convention, du constat à la garde.
 *
 * Ils protègent maintenant deux choses à la fois : que le filtre existe toujours
 * dans le dépôt, ET que l'index qui le sert n'a pas disparu. Un index supprimé
 * par erreur ne se remarquerait autrement qu'à la lenteur, des mois plus tard.
 */
describe('Audit du 30/07/2026 — index manquants, CORRIGÉS (migration 0027)', () => {
  it('session_marche porte un index sur evenement_id', () => {
    // Colonne bien écrite et bien lue (rattachement d'une session à une
    // opportunité, fiche 14) — mais `depots/opportunites.ts` la filtre en
    // `WHERE` (taux de prise d'une entreprise, D-059) sans qu'aucun index ne
    // la porte. Volume faible aujourd'hui (une session/semaine), mais un scan
    // complet à chaque mesure de taux de prise se verra le jour où
    // l'historique s'allonge.
    const schemaTs = lire('packages/db/src/schema.ts');
    const opportunites = lire('packages/db/src/depots/opportunites.ts');

    expect(opportunites).toMatch(/eq\(sessionMarche\.evenementId/);
    expect(schemaTs).toMatch(/idx_session_evenement/);
  });

  it('non_conformite porte un index sur lot_id', () => {
    // `depots/tracabilite.ts` filtre les non-conformités d'un lot en `WHERE`
    // (traçabilité amont/aval, docs/07 §6.8 rang 11) sans qu'aucun index ne
    // porte cette colonne (seuls `idx_nc_date`/`idx_nc_gravite` existent).
    const schemaTs = lire('packages/db/src/schema.ts');
    const tracabilite = lire('packages/db/src/depots/tracabilite.ts');

    expect(tracabilite).toMatch(/eq\(nonConformite\.lotId/);
    expect(schemaTs).toMatch(/idx_nc_lot|idx_non_conformite_lot/);
  });

  it('journal_audit porte un index utilisable quand enregistrement_id est filtré seul', () => {
    // `listerJournalAudit` compose ses conditions INDÉPENDAMMENT : on peut
    // filtrer sur `enregistrementId` sans donner `table`. Le seul index qui
    // porte cette colonne est `idx_audit_cible(table_cible, enregistrement_id)`
    // — un index composite ne sert un filtre que par son PRÉFIXE GAUCHE :
    // sans `table_cible`, SQLite balaye toute la table. C'est le cas d'usage
    // naturel du journal (« tout l'historique de CET enregistrement ») et
    // celui d'un contrôle — et c'est la table qui grandit à chaque geste,
    // contrairement aux sessions (une par semaine).
    const depotAudit = lire('packages/db/src/depots/audit.ts');
    const schemaTs = lire('packages/db/src/schema.ts');

    expect(depotAudit).toMatch(/eq\(journalAudit\.enregistrementId/);
    const indexUtilisable = /index\('[\w]+'\)\.on\(\s*table\.enregistrementId\b/.test(schemaTs);
    expect(indexUtilisable).toBe(true);
  });
});

describe('Audit du 30/07/2026 — garde de non-régression sur CATALOGUE_PARAMETRES', () => {
  /**
   * `CATALOGUE_PARAMETRES` (`packages/core/src/parametres.ts`) ne doit jamais
   * contenir de clé que rien ne lit.
   *
   * Vérifié le 30/07/2026 sur les 99 clés existantes : AUCUNE orpheline
   * aujourd'hui. Contrairement aux `it.fails` ci-dessus, ce test PASSE
   * aujourd'hui et DOIT continuer de passer : il empêche une FUTURE clé
   * ajoutée sans jamais être lue de passer inaperçue — une énumération figée
   * des clés actuelles n'aurait rien garanti sur celles de demain.
   *
   * Ne couvre que `packages/core/src`, `packages/db/src`, `apps/api/src` et
   * `apps/web/src` : une clé de catalogue n'a de sens que dans le code
   * applicatif, jamais dans `docs/`.
   */
  it('chaque clé de CATALOGUE_PARAMETRES est référencée par au moins un fichier hors du catalogue', () => {
    const racines = ['packages/core/src', 'packages/db/src', 'apps/api/src', 'apps/web/src'];
    const fichiersExclus = new Set(
      [
        'packages/core/src/parametres.ts',
        'packages/core/src/parametres.test.ts',
        'packages/db/src/seed/parametres.ts',
        'packages/db/src/seed/parametres.test.ts',
      ].map((f) => resolve(RACINE, f)),
    );

    const contenu = racines
      .flatMap((racine) => listerFichiersSource(resolve(RACINE, racine)))
      .filter((fichier) => !fichiersExclus.has(fichier))
      .map((fichier) => readFileSync(fichier, 'utf8'))
      .join('\n');

    const orphelines = CATALOGUE_PARAMETRES.filter(
      (definition) => !contenu.includes(`'${definition.cle}'`),
    ).map((definition) => definition.cle);

    expect(orphelines).toEqual([]);
  });
});
