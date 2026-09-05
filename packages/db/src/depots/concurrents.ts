/**
 * Dépôt des concurrents (fiche `docs/demandes/08-FICHES-CONCURRENTS.md`) —
 * répertorier les vendeurs concurrents observés sur les marchés, leurs
 * produits et leurs observations qualitatives.
 *
 * ═══ `concurrent_produit` est HISTORISÉ, jamais aplati ═══
 *
 * Un même produit peut être observé à des prix différents dans le temps
 * (voir `packages/db/src/schema.ts`). Ce dépôt ne fait AUCUN `UPDATE` sur une
 * ligne existante de `concurrent_produit` : chaque relevé est une nouvelle
 * ligne, et la projection « dernier prix connu » (`dernierPrixParProduit`) se
 * calcule à la LECTURE, en mémoire, jamais en base.
 *
 * ═══ Import inter-paquet temporaire — `packages/core/src/contrats/concurrents.ts` ═══
 *
 * Ce fichier n'a besoin que des DEUX TYPES d'énumération (`TypeOffreConcurrent`,
 * `PositionnementConcurrent`, `AffluenceEstimee`), jamais des schémas Zod : la
 * validation d'entrée reste entièrement à la charge de la route HTTP. Plutôt
 * que d'importer ces types depuis `@batte/core` (paquet dont ce dépôt dépend
 * déjà pour `nouvelIdentifiant` etc.), on les DÉRIVE directement des colonnes
 * `enum` de `schema.ts` via `$inferSelect` : zéro import inter-paquet
 * supplémentaire, zéro duplication, et le type suit le schéma si l'énumération
 * change un jour.
 *
 * ═══ Calcul pur colocalisé ici, hors de `packages/core` ═══
 *
 * Ce ticket n'autorise la création que d'un contrat NEUF dans
 * `packages/core/src/contrats/` — pas d'un second fichier de logique pure
 * (l'équivalent de `packages/core/src/economies.ts` pour la fiche 12). La
 * moyenne entière du comparateur (`moyenneCentsEntiere`) vit donc ici, en
 * fonction pure et testée directement par `concurrents.test.ts` — voir le
 * rapport de livraison, qui liste cette fonction comme candidate à une
 * promotion vers `packages/core` si un futur ticket la réutilise ailleurs.
 */

import { ErreurIntrouvable, ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { ratioEnPointsDeBase } from '@batte/core';
import type { StatutMouvementPrix } from '@batte/core';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  concurrent,
  concurrentObservation,
  concurrentProduit,
  lieuMarche,
  produitVente,
} from '../schema.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Types — dérivés du schéma, jamais dupliqués à la main
   ═══════════════════════════════════════════════════════════════════════════ */

type TypeOffreConcurrent = (typeof concurrent.$inferSelect)['typeOffre'];
type PositionnementConcurrent = (typeof concurrent.$inferSelect)['positionnement'];
type AffluenceEstimee = (typeof concurrentObservation.$inferSelect)['affluenceEstimee'];

export type ConcurrentLigne = {
  readonly id: string;
  readonly nom: string;
  readonly lieuId: string;
  readonly lieuNom: string;
  readonly typeOffre: TypeOffreConcurrent;
  readonly positionnement: PositionnementConcurrent;
  readonly emplacementObserve: string | null;
  readonly qualitePercue: number;
  readonly dateDerniereObservation: string | null;
  readonly notesGenerales: string | null;
  readonly actif: boolean;
  readonly creeLe: string;
  readonly modifieLe: string;
};

export type ConcurrentProduitLigne = {
  readonly id: string;
  readonly concurrentId: string;
  readonly nomProduit: string;
  readonly prixCents: number;
  readonly description: string | null;
  readonly dateObservation: string;
  readonly creeLe: string;
};

export type ConcurrentObservationLigne = {
  readonly id: string;
  readonly concurrentId: string;
  readonly dateObservation: string;
  readonly affluenceEstimee: AffluenceEstimee;
  readonly fileAttente: boolean;
  readonly notes: string | null;
  readonly creeLe: string;
};

export type DernierPrixProduit = {
  readonly nomProduit: string;
  readonly prixCents: number;
  readonly dateObservation: string;
};

export type ConcurrentDetail = ConcurrentLigne & {
  readonly produits: ConcurrentProduitLigne[];
  readonly observations: ConcurrentObservationLigne[];
  readonly dernierPrixParProduit: DernierPrixProduit[];
};

export type SaisieConcurrent = {
  readonly nom: string;
  readonly lieuId: string;
  readonly typeOffre: TypeOffreConcurrent;
  readonly positionnement: PositionnementConcurrent;
  readonly emplacementObserve: string | null;
  readonly qualitePercue: number;
  readonly notesGenerales: string | null;
};

export type EntreeConcurrentProduit = {
  readonly nomProduit: string;
  readonly prixCents: number;
  readonly description: string | null;
  readonly dateObservation: string;
};

export type EntreeConcurrentObservation = {
  readonly dateObservation: string;
  readonly affluenceEstimee: AffluenceEstimee;
  readonly fileAttente: boolean;
  readonly notes: string;
};

export type FiltreConcurrents = {
  readonly lieuId?: string;
};

export type ComparateurNotreProduit = {
  readonly produitVenteId: string;
  readonly nom: string;
  readonly nature: 'transforme' | 'revendu';
  readonly prixCents: number;
};

export type ComparateurPrixConcurrent = {
  readonly concurrentId: string;
  readonly concurrentNom: string;
  readonly typeOffre: TypeOffreConcurrent;
  readonly positionnement: PositionnementConcurrent;
  readonly nomProduit: string;
  readonly prixCents: number;
  readonly dateObservation: string;
};

export type ComparateurResultat = {
  readonly notreCarte: ComparateurNotreProduit[];
  readonly dernierPrixConcurrents: ComparateurPrixConcurrent[];
  readonly moyenne: {
    readonly notrePrixMoyenCrepeCents: number | null;
    readonly concurrentsPrixMoyenCents: number | null;
    readonly ecartBp: number | null;
    readonly nbConcurrentsEquivalents: number;
  };
};

/**
 * Types d'offre « équivalents » à notre carte de crêpes, pour le comparateur.
 * `mixte` est inclus : un stand qui vend aussi des crêpes reste un concurrent
 * sur ce produit, même si ce n'est pas sa seule offre.
 */
const TYPES_OFFRE_EQUIVALENTS_CREPES: readonly TypeOffreConcurrent[] = ['crepes', 'mixte'];

/* ═══════════════════════════════════════════════════════════════════════════
   Calculs purs — colocalisés ici, voir l'en-tête de ce fichier
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Moyenne entière en centimes, arrondie au plus proche. `null` sur une liste
 * vide plutôt que `NaN` (D-034) : une moyenne inconnue n'est pas zéro.
 */
export function moyenneCentsEntiere(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const somme = valeurs.reduce((total, v) => total + v, 0);
  return Math.round(somme / valeurs.length);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Vérifications d'existence — mêmes conventions que `depots/economies.ts`
   ═══════════════════════════════════════════════════════════════════════════ */

function verifierLieuExiste(base: BaseBatte, lieuId: string): void {
  const existe = base
    .select({ id: lieuMarche.id })
    .from(lieuMarche)
    .where(eq(lieuMarche.id, lieuId))
    .get();
  if (existe === undefined) {
    throw new ErreurMetier('lieu_introuvable', "Le lieu choisi n'existe pas ou a été supprimé.", {
      champs: { lieuId: 'Choisissez un lieu existant.' },
    });
  }
}

function trouverConcurrent(base: BaseBatte, id: string) {
  return base.select().from(concurrent).where(eq(concurrent.id, id)).get();
}

function verifierConcurrentExiste(base: BaseBatte, id: string): void {
  if (trouverConcurrent(base, id) === undefined) throw new ErreurIntrouvable('Concurrent', id);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Lecture — fiche concurrent
   ═══════════════════════════════════════════════════════════════════════════ */

function requeteConcurrents(base: BaseBatte) {
  return base
    .select({
      id: concurrent.id,
      nom: concurrent.nom,
      lieuId: concurrent.lieuId,
      lieuNom: lieuMarche.nom,
      typeOffre: concurrent.typeOffre,
      positionnement: concurrent.positionnement,
      emplacementObserve: concurrent.emplacementObserve,
      qualitePercue: concurrent.qualitePercue,
      dateDerniereObservation: concurrent.dateDerniereObservation,
      notesGenerales: concurrent.notesGenerales,
      actif: concurrent.actif,
      creeLe: concurrent.creeLe,
      modifieLe: concurrent.modifieLe,
    })
    .from(concurrent)
    .innerJoin(lieuMarche, eq(concurrent.lieuId, lieuMarche.id));
}

/** Tous les concurrents (actifs ET inactifs — le filtre d'affichage est à la
 * charge de l'écran, même convention que `listerFournisseurs`), triés par nom. */
export function listerConcurrents(
  base: BaseBatte,
  filtre: FiltreConcurrents = {},
): ConcurrentLigne[] {
  const requete = requeteConcurrents(base);
  const lignes = (
    filtre.lieuId === undefined ? requete : requete.where(eq(concurrent.lieuId, filtre.lieuId))
  )
    .orderBy(concurrent.nom)
    .all();
  return lignes;
}

function produitsDuConcurrent(base: BaseBatte, concurrentId: string): ConcurrentProduitLigne[] {
  return base
    .select({
      id: concurrentProduit.id,
      concurrentId: concurrentProduit.concurrentId,
      nomProduit: concurrentProduit.nomProduit,
      prixCents: concurrentProduit.prixCents,
      description: concurrentProduit.description,
      dateObservation: concurrentProduit.dateObservation,
      creeLe: concurrentProduit.creeLe,
    })
    .from(concurrentProduit)
    .where(eq(concurrentProduit.concurrentId, concurrentId))
    .orderBy(desc(concurrentProduit.dateObservation), desc(concurrentProduit.creeLe))
    .all();
}

function observationsDuConcurrent(
  base: BaseBatte,
  concurrentId: string,
): ConcurrentObservationLigne[] {
  return base
    .select({
      id: concurrentObservation.id,
      concurrentId: concurrentObservation.concurrentId,
      dateObservation: concurrentObservation.dateObservation,
      affluenceEstimee: concurrentObservation.affluenceEstimee,
      fileAttente: concurrentObservation.fileAttente,
      notes: concurrentObservation.notes,
      creeLe: concurrentObservation.creeLe,
    })
    .from(concurrentObservation)
    .where(eq(concurrentObservation.concurrentId, concurrentId))
    .orderBy(desc(concurrentObservation.dateObservation), desc(concurrentObservation.creeLe))
    .all();
}

/**
 * Projection « dernier prix connu » PAR NOM DE PRODUIT, calculée en mémoire à
 * partir de l'historique complet (déjà trié du plus récent au plus ancien par
 * `produitsDuConcurrent`) : le premier relevé rencontré pour un nom donné EST
 * le plus récent. Jamais stockée — voir l'en-tête de ce fichier.
 */
export function dernierPrixParProduit(base: BaseBatte, concurrentId: string): DernierPrixProduit[] {
  const historique = produitsDuConcurrent(base, concurrentId);
  const vus = new Set<string>();
  const resultat: DernierPrixProduit[] = [];
  for (const ligne of historique) {
    if (vus.has(ligne.nomProduit)) continue;
    vus.add(ligne.nomProduit);
    resultat.push({
      nomProduit: ligne.nomProduit,
      prixCents: ligne.prixCents,
      dateObservation: ligne.dateObservation,
    });
  }
  return resultat;
}

export function lireConcurrentDetail(base: BaseBatte, id: string): ConcurrentDetail | undefined {
  const ligne = requeteConcurrents(base).where(eq(concurrent.id, id)).get();
  if (ligne === undefined) return undefined;
  return {
    ...ligne,
    produits: produitsDuConcurrent(base, id),
    observations: observationsDuConcurrent(base, id),
    dernierPrixParProduit: dernierPrixParProduit(base, id),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Écriture — fiche concurrent
   ═══════════════════════════════════════════════════════════════════════════ */

function ligneParId(base: BaseBatte, id: string): ConcurrentLigne {
  const ligne = requeteConcurrents(base).where(eq(concurrent.id, id)).get();
  if (ligne === undefined) throw new Error(`Concurrent ${id} introuvable juste après écriture.`);
  return ligne;
}

export function creerConcurrent(base: BaseBatte, saisie: SaisieConcurrent): ConcurrentLigne {
  verifierLieuExiste(base, saisie.lieuId);

  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(concurrent)
    .values({
      id,
      nom: saisie.nom,
      lieuId: saisie.lieuId,
      typeOffre: saisie.typeOffre,
      positionnement: saisie.positionnement,
      emplacementObserve: saisie.emplacementObserve,
      qualitePercue: saisie.qualitePercue,
      dateDerniereObservation: null,
      notesGenerales: saisie.notesGenerales,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  return ligneParId(base, id);
}

export function modifierConcurrent(
  base: BaseBatte,
  id: string,
  saisie: SaisieConcurrent,
): ConcurrentLigne {
  verifierConcurrentExiste(base, id);
  verifierLieuExiste(base, saisie.lieuId);

  base
    .update(concurrent)
    .set({
      nom: saisie.nom,
      lieuId: saisie.lieuId,
      typeOffre: saisie.typeOffre,
      positionnement: saisie.positionnement,
      emplacementObserve: saisie.emplacementObserve,
      qualitePercue: saisie.qualitePercue,
      notesGenerales: saisie.notesGenerales,
      modifieLe: maintenantUtc(),
    })
    .where(eq(concurrent.id, id))
    .run();

  return ligneParId(base, id);
}

/**
 * On DÉSACTIVE, on ne supprime jamais (CLAUDE.md §3 règle 7) — même geste que
 * `changerActiviteFournisseur` : un concurrent qui a quitté le marché
 * disparaît des listes actives mais son historique de prix reste lisible.
 */
export function changerActiviteConcurrent(
  base: BaseBatte,
  id: string,
  actif: boolean,
): ConcurrentLigne {
  verifierConcurrentExiste(base, id);

  base
    .update(concurrent)
    .set({ actif, modifieLe: maintenantUtc() })
    .where(eq(concurrent.id, id))
    .run();

  return ligneParId(base, id);
}

/**
 * Met à jour `date_derniere_observation` si la nouvelle date est plus récente
 * (ou si aucune n'était encore connue) — jamais un recul silencieux d'une
 * saisie faite dans le désordre.
 */
function avancerDerniereObservation(
  base: BaseBatte,
  concurrentId: string,
  dateObservation: string,
): void {
  const actuel = base
    .select({ date: concurrent.dateDerniereObservation })
    .from(concurrent)
    .where(eq(concurrent.id, concurrentId))
    .get();
  if (actuel === undefined) return;
  if (actuel.date === null || dateObservation > actuel.date) {
    base
      .update(concurrent)
      .set({ dateDerniereObservation: dateObservation, modifieLe: maintenantUtc() })
      .where(eq(concurrent.id, concurrentId))
      .run();
  }
}

/**
 * Ajoute un relevé de prix — INSERT SEUL, jamais un `UPDATE` sur une ligne
 * existante : c'est ce qui fait de `concurrent_produit` un historique
 * (fiche 08). Deux appels avec le même `nomProduit` créent deux lignes.
 */
export function ajouterProduitConcurrent(
  base: BaseBatte,
  concurrentId: string,
  entree: EntreeConcurrentProduit,
): ConcurrentProduitLigne {
  verifierConcurrentExiste(base, concurrentId);

  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(concurrentProduit)
    .values({
      id,
      concurrentId,
      nomProduit: entree.nomProduit,
      prixCents: entree.prixCents,
      description: entree.description,
      dateObservation: entree.dateObservation,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  avancerDerniereObservation(base, concurrentId, entree.dateObservation);

  const ligne = base
    .select({
      id: concurrentProduit.id,
      concurrentId: concurrentProduit.concurrentId,
      nomProduit: concurrentProduit.nomProduit,
      prixCents: concurrentProduit.prixCents,
      description: concurrentProduit.description,
      dateObservation: concurrentProduit.dateObservation,
      creeLe: concurrentProduit.creeLe,
    })
    .from(concurrentProduit)
    .where(eq(concurrentProduit.id, id))
    .get();
  if (ligne === undefined)
    throw new Error(`Produit concurrent ${id} introuvable juste après création.`);
  return ligne;
}

/** Ajoute une visite de terrain — INSERT SEUL, même logique que ci-dessus. */
export function ajouterObservationConcurrent(
  base: BaseBatte,
  concurrentId: string,
  entree: EntreeConcurrentObservation,
): ConcurrentObservationLigne {
  verifierConcurrentExiste(base, concurrentId);

  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(concurrentObservation)
    .values({
      id,
      concurrentId,
      dateObservation: entree.dateObservation,
      affluenceEstimee: entree.affluenceEstimee,
      fileAttente: entree.fileAttente,
      notes: entree.notes,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  avancerDerniereObservation(base, concurrentId, entree.dateObservation);

  const ligne = base
    .select({
      id: concurrentObservation.id,
      concurrentId: concurrentObservation.concurrentId,
      dateObservation: concurrentObservation.dateObservation,
      affluenceEstimee: concurrentObservation.affluenceEstimee,
      fileAttente: concurrentObservation.fileAttente,
      notes: concurrentObservation.notes,
      creeLe: concurrentObservation.creeLe,
    })
    .from(concurrentObservation)
    .where(eq(concurrentObservation.id, id))
    .get();
  if (ligne === undefined)
    throw new Error(`Observation concurrent ${id} introuvable juste après création.`);
  return ligne;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Comparateur — voir l'en-tête de `packages/core/src/contrats/concurrents.ts`
   pour la décision de NE PAS inventer d'appariement produit-à-produit.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Un MENU n'a pas sa place dans ce comparateur : son prix est un FORFAIT
 * ("crêpe + café à 5 €"), pas un prix à la crêpe — le comparer au prix moyen
 * relevé chez un concurrent (qui vend des crêpes à l'unité) comparerait deux
 * grandeurs différentes et inventerait une précision qui n'existe pas (même
 * doctrine que l'absence d'appariement produit-à-produit, voir l'en-tête de
 * ce fichier). Exclu à la source, pas filtré après coup : `ComparateurNotreProduit.nature`
 * reste a deux valeurs, exactement ce que `schemaComparateurNotreProduit`
 * (`packages/core/src/contrats/concurrents.ts`) valide déjà.
 */
function estNatureVendueSeule<T extends { nature: 'transforme' | 'revendu' | 'menu' }>(
  produit: T,
): produit is T & { nature: 'transforme' | 'revendu' } {
  return produit.nature !== 'menu';
}

export function comparateurPrix(
  base: BaseBatte,
  filtre: FiltreConcurrents = {},
): ComparateurResultat {
  const notreCarte: ComparateurNotreProduit[] = base
    .select({
      produitVenteId: produitVente.id,
      nom: produitVente.nom,
      nature: produitVente.nature,
      prixCents: produitVente.prixCents,
    })
    .from(produitVente)
    .where(and(eq(produitVente.actif, true), ne(produitVente.nature, 'menu')))
    .orderBy(produitVente.nom)
    .all()
    .filter(estNatureVendueSeule);

  const concurrentsEquivalents = listerConcurrents(base, filtre).filter(
    (c) => c.actif && TYPES_OFFRE_EQUIVALENTS_CREPES.includes(c.typeOffre),
  );

  const dernierPrixConcurrents: ComparateurPrixConcurrent[] = concurrentsEquivalents.flatMap((c) =>
    dernierPrixParProduit(base, c.id).map((p) => ({
      concurrentId: c.id,
      concurrentNom: c.nom,
      typeOffre: c.typeOffre,
      positionnement: c.positionnement,
      nomProduit: p.nomProduit,
      prixCents: p.prixCents,
      dateObservation: p.dateObservation,
    })),
  );

  const notrePrixMoyenCrepeCents = moyenneCentsEntiere(
    notreCarte.filter((p) => p.nature === 'transforme').map((p) => p.prixCents),
  );
  const concurrentsPrixMoyenCents = moyenneCentsEntiere(
    dernierPrixConcurrents.map((p) => p.prixCents),
  );
  const ecartBp =
    notrePrixMoyenCrepeCents === null || concurrentsPrixMoyenCents === null
      ? null
      : ratioEnPointsDeBase(
          concurrentsPrixMoyenCents - notrePrixMoyenCrepeCents,
          notrePrixMoyenCrepeCents,
        );

  return {
    notreCarte,
    dernierPrixConcurrents,
    moyenne: {
      notrePrixMoyenCrepeCents,
      concurrentsPrixMoyenCents,
      ecartBp,
      nbConcurrentsEquivalents: concurrentsEquivalents.length,
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Mouvements de prix — voir l'en-tête de
   `packages/core/src/contrats/concurrents.ts` (§ « Mouvements de prix ») pour
   le contrat de sortie et la doctrine « `nouveau`, pas `hausse` depuis zéro ».
   ═══════════════════════════════════════════════════════════════════════════ */

export type MouvementPrixLigne = {
  readonly concurrentId: string;
  readonly concurrentNom: string;
  readonly nomProduit: string;
  readonly statut: StatutMouvementPrix;
  readonly prixCents: number;
  readonly prixPrecedentCents: number | null;
  readonly ecartCents: number | null;
  readonly ecartBp: number | null;
  readonly dateObservation: string;
  readonly dateObservationPrecedente: string | null;
};

/**
 * « Qu'est-ce qui a bougé depuis mon avant-dernier relevé ? » — un mouvement
 * de prix par PRODUIT (couple `concurrentId` + `nomProduit`), chez chaque
 * concurrent ACTIF. Contrairement à `comparateurPrix`, AUCUNE restriction de
 * `typeOffre` : un mouvement chez un vendeur de gaufres reste un mouvement
 * à surveiller, même s'il n'est pas « équivalent » à notre carte de crêpes.
 * Un concurrent désactivé (qui a quitté le marché, CLAUDE.md §3 règle 7)
 * n'est plus surveillé — son historique reste lisible dans sa fiche, pas ici.
 *
 * Compare les DEUX relevés les plus récents de CE produit chez CE concurrent
 * — jamais le dernier contre une moyenne ou contre un autre produit, ce qui
 * inventerait une comparaison qui n'existe pas. `produitsDuConcurrent` trie
 * déjà du plus récent au plus ancien (`dateObservation` puis `creeLe`), donc
 * le premier relevé rencontré pour un `nomProduit` donné EST le plus récent,
 * et le second EST l'avant-dernier.
 */
export function mouvementsPrixConcurrents(
  base: BaseBatte,
  filtre: FiltreConcurrents = {},
): MouvementPrixLigne[] {
  const concurrentsActifs = listerConcurrents(base, filtre).filter((c) => c.actif);

  const resultat: MouvementPrixLigne[] = [];
  for (const c of concurrentsActifs) {
    const historique = produitsDuConcurrent(base, c.id);

    // Regroupe l'historique (déjà trié du plus récent au plus ancien) par nom
    // de produit, en conservant l'ordre de rencontre — donc l'ordre chronologique
    // décroissant à l'intérieur de chaque groupe.
    const relevesParProduit = new Map<string, ConcurrentProduitLigne[]>();
    for (const ligne of historique) {
      const releves = relevesParProduit.get(ligne.nomProduit);
      if (releves === undefined) relevesParProduit.set(ligne.nomProduit, [ligne]);
      else releves.push(ligne);
    }

    for (const [nomProduit, releves] of relevesParProduit) {
      const dernier = releves[0];
      // Garde de type pour `noUncheckedIndexedAccess` : impossible en pratique,
      // `relevesParProduit` ne contient que des listes non vides.
      if (dernier === undefined) continue;
      const avantDernier = releves[1];

      if (avantDernier === undefined) {
        resultat.push({
          concurrentId: c.id,
          concurrentNom: c.nom,
          nomProduit,
          statut: 'nouveau',
          prixCents: dernier.prixCents,
          prixPrecedentCents: null,
          ecartCents: null,
          ecartBp: null,
          dateObservation: dernier.dateObservation,
          dateObservationPrecedente: null,
        });
        continue;
      }

      const ecartCents = dernier.prixCents - avantDernier.prixCents;
      const statut: StatutMouvementPrix =
        ecartCents > 0 ? 'hausse' : ecartCents < 0 ? 'baisse' : 'stable';
      // Variation relative depuis un prix précédent NUL : indéfinie, jamais 0.
      const ecartBp =
        avantDernier.prixCents === 0
          ? null
          : ratioEnPointsDeBase(ecartCents, avantDernier.prixCents);

      resultat.push({
        concurrentId: c.id,
        concurrentNom: c.nom,
        nomProduit,
        statut,
        prixCents: dernier.prixCents,
        prixPrecedentCents: avantDernier.prixCents,
        ecartCents,
        ecartBp,
        dateObservation: dernier.dateObservation,
        dateObservationPrecedente: avantDernier.dateObservation,
      });
    }
  }

  // Ordre déterministe, indépendant de l'ordre d'insertion en base.
  resultat.sort(
    (a, b) =>
      a.concurrentNom.localeCompare(b.concurrentNom) || a.nomProduit.localeCompare(b.nomProduit),
  );
  return resultat;
}
