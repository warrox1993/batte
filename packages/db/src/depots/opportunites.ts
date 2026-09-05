/**
 * Dépôt des opportunités (docs/demandes/14-EVENEMENTS-COMME-OPPORTUNITES.md).
 *
 * Une opportunité est un `evenement` comme un autre (même table, aucune
 * migration nouvelle : `famille` et `effectif_estime` existent déjà depuis
 * `0018_adorable_black_bolt.sql`), distingué uniquement par `famille NON
 * NULL` — `famille = NULL` reste le cas historique « facteur classique »
 * (voir `packages/db/src/schema.ts`).
 *
 * ═══ AUCUN calcul métier ici ═══
 *
 * Même règle que `packages/db/src/depots/lieux-rentabilite.ts` : ce fichier
 * ne fait QUE lire et écrire. La composition (fréquentation prévue, coûts,
 * marge nette, fiabilité) vit dans `packages/core/src/opportunites.ts` et
 * `packages/core/src/deplacement.ts` (fiche 13, réutilisé sans modification),
 * appelée par `apps/api/src/routes/opportunites.ts`.
 *
 * ═══ `impact_estime_bp = BASE_POINTS` (neutre) à la création — jamais autre chose ═══
 *
 * `evenementsDuJour` / `facteurEvenementBp` (`./previsions.js`) ne filtrent
 * QUE sur `valide_par_humain` et la plage de dates — ils ignorent `famille`.
 * Une opportunité est `valide_par_humain = true` dès sa création (comme tout
 * événement saisi à la main). Si son `impact_estime_bp` portait autre chose
 * qu'un facteur neutre (10 000 = ×1,00), elle contaminerait silencieusement
 * la prévision d'une session RÉGULIÈRE qui tomberait la même date ailleurs —
 * une opportunité n'est PAS un facteur qui module une autre session, c'est sa
 * propre session. `creerOpportunite` fixe donc ce champ au neutre, point fixe
 * du calcul classique, jamais dérivé de `portee`/`intensiteEstimee` (qui
 * n'ont d'ailleurs aucun sens pour une opportunité — colonnes NOT NULL du
 * schéma, renseignées à une valeur de repli qu'aucun calcul ne lit).
 *
 * ═══ La boucle de mesure du taux de prise « entreprise » (D-059) ═══
 *
 * `sessionsEntrepriseFermees` lit les sessions CLOSES rattachées à UN SEUL
 * `evenement.id`, pour alimenter `tauxPriseEntrepriseObserve`
 * (`@batte/core`). Recalculée intégralement à chaque appel plutôt que
 * maintenue par un compteur séparé — même choix que `coutGazMoyenParCrepe`,
 * `facteursMeteoParDate` (D-028) et `mesurerImpactEvenement`
 * (`packages/db/src/depots/previsions.ts`) : aucune colonne à maintenir,
 * une session exclue ou annulée après coup se propage d'elle-même.
 *
 * ═══ Passerelle avec la fiche 05 ═══
 *
 * `packages/db/src/depots/evenements-decouverte.ts` (même zone d'écriture)
 * étend `validerPropositionEvenement` pour permettre d'attacher une famille à
 * une proposition découverte par l'IA au moment de sa validation humaine —
 * c'est le pont entre « Claude propose un événement » et « cet événement est
 * une opportunité à évaluer ici ». Ce dépôt-ci ne s'occupe QUE des
 * opportunités déjà validées : il ne lit et n'écrit jamais `source = 'ia'`
 * directement.
 */

import {
  BASE_POINTS,
  ErreurIntrouvable,
  ErreurMetier,
  maintenantUtc,
  nouvelIdentifiant,
} from '@batte/core';
import { and, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { evenement, lieuMarche, sessionMarche } from '../schema.js';
import { journaliser } from './audit.js';

/** Dérivé du schéma, pas d'un import inter-paquet : même convention que `depots/concurrents.ts`. */
type FamilleOpportuniteDb = NonNullable<(typeof evenement.$inferSelect)['famille']>;
type ModeTarificationDb = (typeof lieuMarche.$inferSelect)['modeTarification'];
type TypeEvenementDb = (typeof evenement.$inferSelect)['type'];

/* ═══════════════════════════════════════════════════════════════════════════
   Lecture — opportunités actives, avec le lieu éventuellement rattaché
   ═══════════════════════════════════════════════════════════════════════════ */

export type OpportuniteCandidate = {
  readonly id: string;
  readonly nom: string;
  readonly type: TypeEvenementDb;
  readonly famille: FamilleOpportuniteDb;
  readonly dateDebut: string;
  readonly dateFin: string;
  readonly communeTexte: string | null;
  readonly effectifEstime: number | null;
  /** À vol d'oiseau (fiche 05) — jamais une distance routière. */
  readonly distanceVolDoiseauKm: number | null;
  readonly source: string | null;
  readonly notes: string | null;
  readonly lieuId: string | null;
  readonly lieuNom: string | null;
  /** Distance ROUTIÈRE du lieu rattaché, si son champ est renseigné (fiche 13). */
  readonly lieuDistanceRoutiereKm: number | null;
  readonly tarifEmplacementCents: number | null;
  readonly modeTarification: ModeTarificationDb;
};

/**
 * Opportunités VALIDÉES, non rejetées, dont la fin n'est pas déjà passée.
 *
 * Trois filtres, chacun pour une raison distincte :
 * - `famille IS NOT NULL` : seule une famille d'opportunité entre dans cet
 *   écran, jamais un événement-facteur classique (`famille = NULL`).
 * - `valide_par_humain = true` : une proposition IA pas encore confirmée par
 *   un humain reste dans `PropositionsEvenements.tsx`, jamais ici (CLAUDE.md
 *   §3 règle 2).
 * - `rejete_le IS NULL` : une opportunité écartée par l'utilisateur
 *   (`rejeterOpportunite`) ne revient jamais dans la liste — jamais un
 *   `DELETE` (CLAUDE.md §3 règle 7), une marque qui filtre.
 * - `date_fin >= jour` : décider « est-ce que j'y vais ? » n'a de sens que
 *   pour une opportunité qui n'est pas déjà terminée.
 */
export function listerOpportunitesActives(base: BaseBatte, jour: string): OpportuniteCandidate[] {
  const lignes = base
    .select({
      id: evenement.id,
      nom: evenement.nom,
      type: evenement.type,
      famille: evenement.famille,
      dateDebut: evenement.dateDebut,
      dateFin: evenement.dateFin,
      communeTexte: evenement.communeTexte,
      effectifEstime: evenement.effectifEstime,
      distanceVolDoiseauKm: evenement.distanceKm,
      source: evenement.source,
      notes: evenement.notes,
      lieuId: evenement.lieuId,
      lieuNom: lieuMarche.nom,
      lieuDistanceRoutiereKm: lieuMarche.distanceKm,
      tarifEmplacementCents: lieuMarche.tarifEmplacementCents,
      modeTarification: lieuMarche.modeTarification,
    })
    .from(evenement)
    .leftJoin(lieuMarche, eq(evenement.lieuId, lieuMarche.id))
    .where(
      and(
        isNotNull(evenement.famille),
        eq(evenement.valideParHumain, true),
        isNull(evenement.rejeteLe),
        gte(evenement.dateFin, jour),
      ),
    )
    .orderBy(evenement.dateDebut)
    .all();

  // `famille` est garanti non NULL par le filtre SQL ci-dessus ; le cast
  // rétablit ce que Drizzle ne peut pas exprimer dans son type de colonne.
  return lignes.map((ligne) => ({ ...ligne, famille: ligne.famille as FamilleOpportuniteDb }));
}

function chargerLigne(base: BaseBatte, id: string): typeof evenement.$inferSelect | undefined {
  return base.select().from(evenement).where(eq(evenement.id, id)).get();
}

function chargerOpportuniteOuLever(base: BaseBatte, id: string): typeof evenement.$inferSelect {
  const ligne = chargerLigne(base, id);
  if (ligne === undefined || ligne.famille === null) {
    throw new ErreurIntrouvable('Opportunité', id);
  }
  return ligne;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sessions d'ENTREPRISE fermées — la boucle de mesure du taux de prise (D-059)
   ═══════════════════════════════════════════════════════════════════════════ */

export type ObservationEntrepriseFermee = {
  readonly effectifEstime: number;
  readonly crepesVendues: number;
};

/**
 * Sessions CLOSES rattachées à UN SEUL `evenement.id`, pour nourrir
 * `tauxPriseEntrepriseObserve` (`@batte/core`).
 *
 * SCOPE STRICTEMENT à cet unique `evenement.id` — ne JAMAIS agréger plusieurs
 * entreprises distinctes dans un même appel (voir le piège documenté dans
 * `packages/core/src/opportunites.ts`) : une entreprise de 200 personnes avec
 * cantine et une de 40 sans rien n'ont aucune raison de partager un taux.
 * `session_marche.evenement_id` n'est PAS unique (migration 0020) : plusieurs
 * sessions peuvent rattacher LE MÊME `evenement`, exactement le cas d'une
 * entreprise visitée à plusieurs reprises — c'est ce qui permet à
 * l'observation de s'accumuler POUR ELLE, jamais pour une autre.
 *
 * `effectifEstime` vient de L'ÉVÉNEMENT (connu à l'avance, fiche 14 §3.2),
 * jamais de la session elle-même : l'effectif ne varie pas d'une visite à
 * l'autre pour la même entreprise, sauf correction explicite de l'événement.
 *
 * Filtre `exclure_du_modele = false`, même garde que `mesurerImpactEvenement`
 * (`packages/db/src/depots/previsions.ts`) : une session déjà connue pour ne
 * pas être représentative (panne de gaz, arrivée en retard) ne doit pas
 * polluer un coefficient réutilisé pour de futures prévisions.
 *
 * Rend `[]` — jamais une exception — si l'événement n'est pas une opportunité
 * `entreprise`, ou si son effectif est inconnu : dans les deux cas, aucune
 * observation n'a de sens à calculer.
 */
export function sessionsEntrepriseFermees(
  base: BaseBatte,
  evenementId: string,
): ObservationEntrepriseFermee[] {
  const ev = base
    .select({ famille: evenement.famille, effectifEstime: evenement.effectifEstime })
    .from(evenement)
    .where(eq(evenement.id, evenementId))
    .get();
  if (ev === undefined || ev.famille !== 'entreprise' || ev.effectifEstime === null) return [];

  const effectifEstime = ev.effectifEstime;
  const lignes = base
    .select({ crepesVendues: sessionMarche.crepesVendues })
    .from(sessionMarche)
    .where(
      and(
        eq(sessionMarche.evenementId, evenementId),
        eq(sessionMarche.statut, 'cloturee'),
        eq(sessionMarche.exclureDuModele, false),
      ),
    )
    .all();

  return lignes.map((ligne) => ({ effectifEstime, crepesVendues: ligne.crepesVendues }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Création — directement dans `evenement`, hors du parcours « facteur classique »
   ═══════════════════════════════════════════════════════════════════════════ */

export type EntreeOpportunite = {
  readonly nom: string;
  readonly type: TypeEvenementDb;
  readonly famille: FamilleOpportuniteDb;
  readonly dateDebut: string;
  readonly dateFin: string;
  readonly communeTexte?: string | null | undefined;
  readonly lieuId?: string | null | undefined;
  readonly distanceKm?: number | null | undefined;
  readonly effectifEstime?: number | null | undefined;
  readonly source?: string | null | undefined;
  readonly notes?: string | null | undefined;
};

export function creerOpportunite(base: BaseBatte, entree: EntreeOpportunite): OpportuniteCandidate {
  if (entree.lieuId !== null && entree.lieuId !== undefined) {
    const lieu = base.select().from(lieuMarche).where(eq(lieuMarche.id, entree.lieuId)).get();
    if (lieu === undefined) throw new ErreurIntrouvable('Lieu de marché', entree.lieuId);
  }

  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  const distanceKm =
    entree.distanceKm === null || entree.distanceKm === undefined
      ? null
      : Math.round(entree.distanceKm);

  base
    .insert(evenement)
    .values({
      id,
      nom: entree.nom,
      type: entree.type,
      dateDebut: entree.dateDebut,
      dateFin: entree.dateFin,
      // `portee`/`intensiteEstimee` : colonnes NOT NULL sans signification pour
      // une opportunité — voir l'en-tête de fichier. Valeurs de repli neutres,
      // jamais lues par le calcul de marge d'une opportunité.
      portee: 'quartier',
      intensiteEstimee: 3,
      // NEUTRE À DESSEIN (voir l'en-tête de fichier) : ne doit JAMAIS moduler
      // la prévision d'une session régulière qui tomberait la même date.
      impactEstimeBp: BASE_POINTS,
      source: entree.source ?? null,
      // Saisi directement par l'utilisateur : valide d'office, comme tout
      // événement créé à la main (`creerEvenement`, `depots/previsions.ts`).
      valideParHumain: true,
      lieuId: entree.lieuId ?? null,
      famille: entree.famille,
      effectifEstime: entree.effectifEstime ?? null,
      distanceKm,
      communeTexte: entree.communeTexte ?? null,
      notes: entree.notes ?? null,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  journaliser(base, {
    table: 'evenement',
    enregistrementId: id,
    action: 'creation',
    valeurApres: { nom: entree.nom, famille: entree.famille, lieuId: entree.lieuId ?? null },
  });

  const cree = listerOpportunitesActives(base, entree.dateDebut).find((o) => o.id === id);
  if (cree !== undefined) return cree;

  // L'opportunité vient d'être créée avec `dateFin` potentiellement déjà
  // dépassée (saisie manuelle d'une date passée) : `listerOpportunitesActives`
  // filtre alors sur `date_fin >= jour` et ne la retrouve pas. On reconstruit
  // la ligne directement plutôt que de lever une erreur pour un cas qui n'en
  // est pas un — la création a réellement réussi.
  const ligne = chargerOpportuniteOuLever(base, id);
  const lieu =
    ligne.lieuId === null
      ? undefined
      : base.select().from(lieuMarche).where(eq(lieuMarche.id, ligne.lieuId)).get();
  return {
    id: ligne.id,
    nom: ligne.nom,
    type: ligne.type,
    famille: ligne.famille as FamilleOpportuniteDb,
    dateDebut: ligne.dateDebut,
    dateFin: ligne.dateFin,
    communeTexte: ligne.communeTexte,
    effectifEstime: ligne.effectifEstime,
    distanceVolDoiseauKm: ligne.distanceKm,
    source: ligne.source,
    notes: ligne.notes,
    lieuId: ligne.lieuId,
    lieuNom: lieu?.nom ?? null,
    lieuDistanceRoutiereKm: lieu?.distanceKm ?? null,
    tarifEmplacementCents: lieu?.tarifEmplacementCents ?? null,
    modeTarification: lieu?.modeTarification ?? null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Rattachement à un lieu déclaré — pour affiner distance et tarif
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Associe une opportunité à un `lieu_marche` déjà déclaré, après coup — par
 * exemple quand le porteur crée « Marché de Noël — Place St-Lambert » dans
 * Lieux de marché avec sa distance ROUTIÈRE et son tarif réels, une fois
 * l'opportunité prise au sérieux. Sans lieu rattaché, seule la distance à vol
 * d'oiseau de la découverte IA (`evenement.distance_km`) reste disponible.
 */
export function rattacherLieuOpportunite(base: BaseBatte, id: string, lieuId: string): void {
  const avant = chargerOpportuniteOuLever(base, id);
  const lieu = base.select().from(lieuMarche).where(eq(lieuMarche.id, lieuId)).get();
  if (lieu === undefined) throw new ErreurIntrouvable('Lieu de marché', lieuId);

  const maintenant = maintenantUtc();
  base.update(evenement).set({ lieuId, modifieLe: maintenant }).where(eq(evenement.id, id)).run();

  journaliser(base, {
    table: 'evenement',
    enregistrementId: id,
    action: 'modification',
    valeurAvant: avant,
    valeurApres: { ...avant, lieuId },
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Rejet — jamais un DELETE (CLAUDE.md §3 règle 7)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Écarte une opportunité (« je n'y vais pas ») sans jamais l'effacer. */
export function rejeterOpportunite(base: BaseBatte, id: string): void {
  const avant = chargerOpportuniteOuLever(base, id);
  if (avant.rejeteLe !== null) {
    throw new ErreurMetier('opportunite_deja_rejetee', 'Cette opportunité a déjà été écartée.');
  }

  const maintenant = maintenantUtc();
  base
    .update(evenement)
    .set({ rejeteLe: maintenant, modifieLe: maintenant })
    .where(eq(evenement.id, id))
    .run();

  journaliser(base, {
    table: 'evenement',
    enregistrementId: id,
    action: 'modification',
    valeurAvant: avant,
    valeurApres: { ...avant, rejeteLe: maintenant },
  });
}
