/**
 * Tests de `depots/sessions.ts` — Trou 2 (audit du 30/07/2026).
 *
 * `session_frais` est écrit à chaque clôture (une ligne par catégorie de frais
 * non nulle) et n'était relu NULLE PART. Ce fichier prouve que
 * `listerFraisSession` (et `lireSessionDetail`, qui l'expose désormais sous
 * `fraisDetail`) relit bien ce qui a été écrit — voir le rapport de livraison
 * pour l'arbitrage complet (exposer plutôt que documenter comme redondant) et
 * ce qu'il reste à câbler côté `contrats/sessions.ts`.
 */

import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { lieuMarche, produitVente } from '../schema.js';
import { cloturerSession, creerSession } from '../services/sessions.js';
import { creerEquipement } from './equipements.js';
import { lireSessionDetail, listerFraisSession } from './sessions.js';

const JOUR = '2026-07-27';

describe('depots/sessions — détail des frais (Trou 2)', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idProduitCrepe: string;

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
        nom: 'La Batte — test frais',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idProduitCrepe = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!.id;
  });

  it('relit, catégorie par catégorie, exactement ce que la clôture a écrit', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduitCrepe, quantite: 1, prixUnitaireCents: 300 }],
      frais: {
        emplacementCents: 1500,
        deplacementCents: 800,
        gazCents: 0,
        diversCents: 250,
      },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 300,
      caCarteCents: 0,
      crepesProduites: 1,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    const lignes = listerFraisSession(base, session.id);

    // `gazCents` est nul : `cloturerSession` n'écrit rien pour une catégorie à
    // zéro (voir `services/sessions.ts`), donc trois lignes et pas quatre.
    expect(lignes).toHaveLength(3);

    const parCategorie = new Map(lignes.map((l) => [l.categorie, l]));
    expect(parCategorie.get('emplacement')?.montantCents).toBe(1500);
    expect(parCategorie.get('deplacement')?.montantCents).toBe(800);
    expect(parCategorie.get('divers')?.montantCents).toBe(250);
    expect(parCategorie.get('gaz')).toBeUndefined();

    // Aucun justificatif n'est encore saisissable : `null` partout, pas une
    // chaîne vide qui laisserait croire à une valeur absente différemment.
    for (const ligne of lignes) {
      expect(ligne.justificatifPath).toBeNull();
    }
  });

  it('rend un tableau vide sur une session sans aucun frais non nul', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduitCrepe, quantite: 1, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 300,
      caCarteCents: 0,
      crepesProduites: 1,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    expect(listerFraisSession(base, session.id)).toEqual([]);
  });

  it('lireSessionDetail expose désormais les kilomètres réels saisis (Trou 1)', () => {
    // Le fil écran -> contrat -> service -> base était posé et testé, mais ce
    // dépôt ne renvoyait pas `distanceReelleKm` : une session close n'affichait
    // donc jamais le kilométrage saisi. Sans le champ ajouté au `return` de
    // `lireSessionDetail`, ce test rougit avec `undefined`.
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduitCrepe, quantite: 1, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      distanceReelleKm: 46.8,
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 300,
      caCarteCents: 0,
      crepesProduites: 1,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    expect(lireSessionDetail(base, session.id)!.distanceReelleKm).toBe(46.8);
  });

  it('lireSessionDetail rend `null`, jamais 0, quand les kilomètres réels ne sont pas saisis', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduitCrepe, quantite: 1, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 300,
      caCarteCents: 0,
      crepesProduites: 1,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    expect(lireSessionDetail(base, session.id)!.distanceReelleKm).toBeNull();
  });

  it('lireSessionDetail expose désormais le détail sous fraisDetail', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduitCrepe, quantite: 1, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 1200, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 300,
      caCarteCents: 0,
      crepesProduites: 1,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    const detail = lireSessionDetail(base, session.id)!;
    expect(detail.fraisDetail).toHaveLength(1);
    expect(detail.fraisDetail[0]?.categorie).toBe('emplacement');
    expect(detail.fraisDetail[0]?.montantCents).toBe(1200);
    // Cohérent avec l'agrégat déjà exposé sur `session_marche` : le détail
    // n'est pas un second chiffre qui pourrait diverger du total affiché.
    expect(detail.fraisDetail[0]?.montantCents).toBe(detail.fraisEmplacementCents);
  });

  /**
   * Fiche 17 — `fraisEnergieCents` est reconstruit à CHAQUE lecture depuis le
   * ledger `session_frais` (catégorie `energie`), exactement comme
   * `coutRevenduReconstitueCents` : aucune colonne dédiée sur `session_marche`
   * (migration hors périmètre de cet agent). Il doit aussi entrer dans le
   * coût complet par crêpe recalculé ici, au même titre que les quatre autres
   * postes de frais — sinon `margeNetteCents` (figée à la clôture, électricité
   * comprise) et `coutCompletParCrepeVendueCents` (recalculé à la lecture)
   * décriraient deux réalités différentes pour la même session.
   */
  it("lireSessionDetail reconstruit fraisEnergieCents depuis le ledger et l'inclut dans le coût complet par crêpe", () => {
    base
      .update(lieuMarche)
      .set({ facturationElectricite: 'compteur' })
      .where(eq(lieuMarche.id, idLieu))
      .run();
    const idRadiateur = creerEquipement(base, {
      nom: 'Radiateur soufflant',
      type: 'chauffage',
      puissanceW: 1000,
      enService: true,
      notes: null,
    });

    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduitCrepe, quantite: 1, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 300,
      caCarteCents: 0,
      crepesProduites: 1,
      crepesInvendues: 0,
      crepesCassees: 0,
      equipementsUtilises: [{ equipementId: idRadiateur, dureeMinutes: 120 }],
    });

    // 1000 W x 120 min = 2 kWh x 20 c€/kWh (prix par défaut du catalogue,
    // `prix_kwh_cents_par_kwh`) = 40 centimes.
    const detail = lireSessionDetail(base, session.id)!;
    expect(detail.fraisEnergieCents).toBe(40);
    expect(detail.fraisDetail.find((l) => l.categorie === 'energie')?.montantCents).toBe(40);
    expect(detail.coutCompletParCrepeVendueCents).toBe(40);
  });
});
