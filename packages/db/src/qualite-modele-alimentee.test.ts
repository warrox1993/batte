/**
 * L'ecran « Qualite du modele » est-il ALIMENTE ?
 *
 * `rapprocherPrevision` existait dans le depot, testee, et n'etait appelee
 * NULLE PART. La chaine de consequences etait entierement silencieuse :
 * `prevision.crepes_reelles` restait `NULL`, `qualiteModele()` filtre sur
 * `IS NOT NULL` et ne rendait donc jamais une ligne, et l'ecran affichait un
 * etat vide **a vie**.
 *
 * Le produit mesurait donc la justesse de ses previsions avec un instrument
 * qu'aucune donnee n'atteignait — et rien ne le signalait : le depot etait
 * couvert, la route repondait 200, l'ecran s'affichait sans erreur.
 *
 * Ce fichier existe pour que le branchement ne puisse pas redevenir orphelin :
 * il part d'une prevision archivee, cloture, et exige que la mesure existe.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { maintenantUtc, nouvelIdentifiant, type ResultatPrevision } from '@batte/core';
import { creerBase, type BaseBatte } from './client.js';
import { migrer } from './migrer.js';
import { seed } from './seed/index.js';
import { seedDemonstration } from './seed/demonstration.js';
import { lieuMarche, prevision, produitVente } from './schema.js';
import { archiverPrevision, qualiteModele } from './depots/previsions.js';
import { cloturerSession, creerSession } from './services/sessions.js';

const JOUR = '2026-09-06';

/** Prevision minimale : seuls `p10/p50/p90` comptent pour le rapprochement. */
function previsionFictive(): ResultatPrevision {
  return {
    baseline: 100,
    facteurs: { meteoBp: 10_000, evenementBp: 10_000, saisonBp: 10_000, tendanceBp: 10_000 },
    demandeAttendue: 100,
    p10: 80,
    p50: 100,
    p90: 130,
    quantileCibleBp: 9000,
    crepesRecommandees: 120,
    crepesRetenues: 120,
    contrainteLimitante: null,
    manqueAGagnerCents: null,
    confianceBp: 3000,
    nbSessionsComparables: 2,
    explication: [],
  } as unknown as ResultatPrevision;
}

describe('la cloture alimente la qualite du modele', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idCrepe = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!.id;
  });

  function sessionAvecPrevisionArchivee(): { sessionId: string; quantiteVendue: number } {
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    archiverPrevision(base, { sessionId: session.id, resultat: previsionFictive() });
    return { sessionId: session.id, quantiteVendue: 24 };
  }

  it('avant cloture, la prevision archivee n a PAS de realise', () => {
    const { sessionId } = sessionAvecPrevisionArchivee();

    const ligne = base
      .select({ reelles: prevision.crepesReelles })
      .from(prevision)
      .where(eq(prevision.sessionId, sessionId))
      .get();

    expect(ligne).toBeDefined();
    // C'est l'etat de depart, et c'etait l'etat DEFINITIF avant le branchement.
    expect(ligne!.reelles).toBeNull();
  });

  it('cloturer ecrit le realise sur la prevision de la session', () => {
    const { sessionId, quantiteVendue } = sessionAvecPrevisionArchivee();

    cloturerSession(base, sessionId, {
      ventes: [{ produitVenteId: idCrepe, quantite: quantiteVendue, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
      fondsCaisseInitialCents: 6000,
      especesCompteesCents: 6000 + quantiteVendue * 300,
      caCarteCents: 0,
      crepesProduites: 30,
      crepesInvendues: 5,
      crepesCassees: 1,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
    });

    const ligne = base
      .select({ reelles: prevision.crepesReelles, erreurBp: prevision.erreurAbsolueBp })
      .from(prevision)
      .where(eq(prevision.sessionId, sessionId))
      .get()!;

    // Le realise vient des VENTES, pas d'une ressaisie (CLAUDE.md §0).
    expect(ligne.reelles).toBe(quantiteVendue);
    // Et l'erreur est mesuree, donc l'ecran a quelque chose a montrer.
    expect(ligne.erreurBp).not.toBeNull();
  });

  it("`qualiteModele` passe de zero ligne a une ligne : l'ecran cesse d'etre vide", () => {
    const { sessionId, quantiteVendue } = sessionAvecPrevisionArchivee();

    const avant = qualiteModele(base);
    const compte = (q: ReturnType<typeof qualiteModele>): number =>
      // La forme exacte du retour peut evoluer ; ce qui compte est le NOMBRE de
      // previsions rapprochees. On le lit sans dependre du nom des autres champs.
      (q as unknown as { nbPrevisionsRapprochees?: number }).nbPrevisionsRapprochees ?? 0;

    expect(compte(avant)).toBe(0);

    cloturerSession(base, sessionId, {
      ventes: [{ produitVenteId: idCrepe, quantite: quantiteVendue, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
      fondsCaisseInitialCents: 6000,
      especesCompteesCents: 6000 + quantiteVendue * 300,
      caCarteCents: 0,
      crepesProduites: 30,
      crepesInvendues: 5,
      crepesCassees: 1,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
    });

    expect(compte(qualiteModele(base))).toBeGreaterThan(0);
  });

  it('une session SANS prevision archivee se cloture normalement', () => {
    // Le rapprochement ne doit jamais devenir une condition de la cloture : une
    // session tenue sans avoir consulte la prevision reste une piece comptable
    // parfaitement valide.
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

    expect(() =>
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 3000,
        caCarteCents: 0,
        crepesProduites: 12,
        crepesInvendues: 2,
        crepesCassees: 0,
        heureDebutReelle: '08:00',
        heureFinReelle: '14:30',
      }),
    ).not.toThrow();
  });
});
