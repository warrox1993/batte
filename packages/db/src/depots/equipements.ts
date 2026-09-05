/**
 * Dépôt des équipements électriques du stand et de leur usage par session
 * (docs/demandes/17-ENERGIE-GAZ-ELECTRICITE-SOLAIRE-EMPREINTE.md, D-055).
 *
 * Un seul concept — un appareil, une puissance déclarée, une durée d'usage —
 * couvre radiateurs (au pluriel, plusieurs types en même temps), éclairage,
 * terminal de paiement, froid actif et plaques électriques là où le lieu le
 * permet. Rien n'est codé en dur : changer d'appareil est un changement de
 * paramètre (`equipement.puissanceW`), jamais une modification de code.
 *
 * ═══ Import relatif temporaire ═══
 *
 * `packages/core/src/contrats/energie.ts` est un fichier NEUF, hors du barrel
 * `@batte/core` (câblage réservé à l'orchestrateur — voir le rapport de
 * livraison pour la ligne exacte à y ajouter). L'import du type `SaisieEquipement`
 * ci-dessous passe donc par un chemin relatif direct, à remplacer par
 * `from '@batte/core'` dès le barrel mis à jour — même convention que
 * `apps/api/src/routes/concurrents.ts` avant son câblage.
 *
 * ═══ Rien ne s'efface (CLAUDE.md §3 règle 7) ═══
 *
 * `changerActiviteEquipement` remplace la suppression : un appareil retiré
 * (`actif = false`) peut avoir chauffé des sessions déjà closes, dont le coût
 * matière/énergie reste une pièce comptable. `enregistrerUtilisationEquipement`
 * ne supprime jamais non plus une ligne `equipement_session` : une correction
 * de durée s'écrit par UPDATE (upsert sur l'index unique session×équipement),
 * jamais par un DELETE suivi d'un INSERT.
 */

import { and, asc, count, eq } from 'drizzle-orm';
import { ErreurIntrouvable, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import type { BaseBatte } from '../client.js';
import { equipement, equipementSession, lieuMarche, sessionMarche } from '../schema.js';
import { journaliser } from './audit.js';
// Import relatif temporaire, voir l'en-tête de ce fichier.
import type { SaisieEquipement } from '@batte/core';

/* ═══════════════════════════════════════════════════════════════════════════
   Équipements
   ═══════════════════════════════════════════════════════════════════════════ */

export type EquipementLigne = {
  id: string;
  nom: string;
  type: 'chauffage' | 'eclairage' | 'froid' | 'cuisson' | 'paiement' | 'autre';
  puissanceW: number;
  enService: boolean;
  notes: string | null;
  actif: boolean;
  /** Nombre de sessions où une durée d'utilisation a été enregistrée pour cet appareil. */
  nbUtilisations: number;
};

/** Tous les équipements, ACTIFS ET INACTIFS — même convention que `listerLieuxComplets`. */
export function listerEquipements(base: BaseBatte): EquipementLigne[] {
  const utilisations = new Map(
    base
      .select({ equipementId: equipementSession.equipementId, valeur: count() })
      .from(equipementSession)
      .groupBy(equipementSession.equipementId)
      .all()
      .map((ligne) => [ligne.equipementId, ligne.valeur] as const),
  );

  return base
    .select()
    .from(equipement)
    .orderBy(asc(equipement.nom))
    .all()
    .map((ligne) => ({
      id: ligne.id,
      nom: ligne.nom,
      type: ligne.type,
      puissanceW: ligne.puissanceW,
      enService: ligne.enService,
      notes: ligne.notes,
      actif: ligne.actif,
      nbUtilisations: utilisations.get(ligne.id) ?? 0,
    }));
}

export function creerEquipement(
  base: BaseBatte,
  saisie: SaisieEquipement,
  parQui?: string,
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const cree = baseTx
      .insert(equipement)
      .values({ id, ...saisie, actif: true, creeLe: maintenant, modifieLe: maintenant })
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'equipement',
      enregistrementId: id,
      action: 'creation',
      valeurApres: cree,
      parQui: parQui ?? null,
    });

    return id;
  });
}

export function modifierEquipement(
  base: BaseBatte,
  id: string,
  saisie: SaisieEquipement,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(equipement).where(eq(equipement.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Équipement', id);

    const apres = baseTx
      .update(equipement)
      .set({ ...saisie, modifieLe: maintenantUtc() })
      .where(eq(equipement.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'equipement',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/**
 * Le remplaçant de la suppression : un appareil retiré peut avoir chauffé des
 * sessions déjà closes, pièces comptables conservées dix ans.
 */
export function changerActiviteEquipement(
  base: BaseBatte,
  id: string,
  actif: boolean,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(equipement).where(eq(equipement.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Équipement', id);

    const apres = baseTx
      .update(equipement)
      .set({ actif, modifieLe: maintenantUtc() })
      .where(eq(equipement.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'equipement',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Usage d'un équipement sur une session — la durée qui fait le coût d'énergie
   ═══════════════════════════════════════════════════════════════════════════ */

export type EntreeUtilisationEquipement = {
  readonly sessionId: string;
  readonly equipementId: string;
  readonly dureeMinutes: number;
};

/**
 * Enregistre (ou corrige) la durée d'utilisation d'un équipement sur une
 * session — UPSERT sur l'index unique `(session_id, equipement_id)`, jamais
 * un DELETE : une durée corrigée s'écrit par-dessus, elle ne fait pas
 * disparaître la ligne (CLAUDE.md §3 règle 7).
 *
 * Prête à être appelée depuis `services/sessions.ts` (`cloturerSession`),
 * dans la même transaction — voir le rapport de livraison pour la ligne
 * exacte à y insérer. Hors zone d'écriture de cet agent pour ce fichier.
 */
export function enregistrerUtilisationEquipement(
  base: BaseBatte,
  entree: EntreeUtilisationEquipement,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const equipementExiste = baseTx
      .select({ id: equipement.id })
      .from(equipement)
      .where(eq(equipement.id, entree.equipementId))
      .get();
    if (equipementExiste === undefined)
      throw new ErreurIntrouvable('Équipement', entree.equipementId);

    const sessionExiste = baseTx
      .select({ id: sessionMarche.id })
      .from(sessionMarche)
      .where(eq(sessionMarche.id, entree.sessionId))
      .get();
    if (sessionExiste === undefined) {
      throw new ErreurIntrouvable('Session de marché', entree.sessionId);
    }

    const avant = baseTx
      .select()
      .from(equipementSession)
      .where(
        and(
          eq(equipementSession.sessionId, entree.sessionId),
          eq(equipementSession.equipementId, entree.equipementId),
        ),
      )
      .get();

    const id = avant?.id ?? nouvelIdentifiant();

    const apres = baseTx
      .insert(equipementSession)
      .values({
        id,
        sessionId: entree.sessionId,
        equipementId: entree.equipementId,
        dureeMinutes: entree.dureeMinutes,
        creeLe: maintenantUtc(),
      })
      .onConflictDoUpdate({
        target: [equipementSession.sessionId, equipementSession.equipementId],
        set: { dureeMinutes: entree.dureeMinutes },
      })
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'equipement_session',
      enregistrementId: id,
      action: avant === undefined ? 'creation' : 'modification',
      valeurAvant: avant ?? null,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

export type UtilisationEquipementLigne = {
  equipementId: string;
  nom: string;
  type: 'chauffage' | 'eclairage' | 'froid' | 'cuisson' | 'paiement' | 'autre';
  puissanceW: number;
  dureeMinutes: number;
};

/** Équipements utilisés sur UNE session, avec leur puissance et leur durée — de quoi calculer le coût d'énergie. */
export function utilisationsEquipementsSession(
  base: BaseBatte,
  sessionId: string,
): UtilisationEquipementLigne[] {
  return base
    .select({
      equipementId: equipement.id,
      nom: equipement.nom,
      type: equipement.type,
      puissanceW: equipement.puissanceW,
      dureeMinutes: equipementSession.dureeMinutes,
    })
    .from(equipementSession)
    .innerJoin(equipement, eq(equipementSession.equipementId, equipement.id))
    .where(eq(equipementSession.sessionId, sessionId))
    .orderBy(asc(equipement.nom))
    .all();
}

/* ═══════════════════════════════════════════════════════════════════════════
   Lieux, pour le diagnostic de puissance
   ═══════════════════════════════════════════════════════════════════════════ */

export type LieuPourDiagnosticPuissance = {
  readonly lieuId: string;
  readonly lieuNom: string;
  readonly puissanceDisponibleW: number | null;
};

/** Lieux ACTIFS uniquement : un lieu retiré n'est pas un candidat de marché futur. */
export function lieuxActifsPourDiagnosticPuissance(base: BaseBatte): LieuPourDiagnosticPuissance[] {
  return base
    .select({
      lieuId: lieuMarche.id,
      lieuNom: lieuMarche.nom,
      puissanceDisponibleW: lieuMarche.puissanceDisponibleW,
    })
    .from(lieuMarche)
    .where(eq(lieuMarche.actif, true))
    .orderBy(asc(lieuMarche.nom))
    .all();
}
