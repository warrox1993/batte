/**
 * Test d'intégration HTTP — clôture par volume de pâte restant.
 *
 * « Je préfère avoir le choix manuel entre nombre de crêpes vendues et
 * quantité en ml ou g vendu et restant, ce serait plus simple et ça me
 * nécessiterait moins de calcul » — demande explicite du porteur.
 *
 * Ce fichier vérifie la chaîne HTTP complète (`POST /api/sessions/:id/cloturer`
 * → `schemaClotureSession` → `cloturerSession` → `schemaResultatCloture`), au
 * niveau où le contrat Zod (mutuelle exclusion des deux modes, unité `g`
 * refusée) intervient AVANT même d'atteindre le service — ce que les tests de
 * `packages/db/src/services/sessions.test.ts` ne peuvent pas voir, puisqu'ils
 * appellent `cloturerSession` directement.
 *
 * Les productions rattachées sont insérées DIRECTEMENT en base (comme le fait
 * déjà `packages/db/src/services/sessions.test.ts`) : c'est la résolution des
 * crêpes à la clôture qui est en jeu, pas la consommation de stock.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  creerBase,
  creerEquipement,
  creerOpportunite,
  creerSession,
  evenement,
  lieuMarche,
  migrer,
  production,
  produitVente,
  recette,
  seed,
  seedDemonstration,
  sessionMarche,
  utilisationsEquipementsSession,
  type BaseBatte,
} from '@batte/db';
import { maintenantUtc, nouvelIdentifiant, type ResultatCloture } from '@batte/core';
import { construireServeur } from '../serveur.js';

describe('POST /api/sessions/:id/cloturer — clôture par volume de pâte restant', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idLieu: string;
  let idCrepe: string;
  let idR1: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    idCrepe = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!.id;
    idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Insère une ligne `production` rattachée, sans passer par la consommation
   *  de stock (hors sujet ici — voir `services/production.test.ts`). */
  function creerProductionDeTest(sessionId: string, suffixe: string): void {
    const maintenant = maintenantUtc();
    base
      .insert(production)
      .values({
        id: nouvelIdentifiant(),
        numero: `PR-HTTP-${suffixe}`,
        recetteId: idR1,
        dateProduction: '2026-08-09',
        statut: 'lancee',
        volumeTheoriqueMl: 5000,
        crepesTheoriques: 66,
        coutMatiereTheoriqueCents: 0,
        volumeReelMl: null,
        crepesReelles: null,
        coutMatiereReelCents: null,
        numeroLotPate: `PATE-HTTP-${suffixe}`,
        dateDlcPate: '2026-08-10',
        sessionId,
        ordrePrevisionId: null,
        ecartMotif: null,
        notes: null,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  }

  function nouvelleSession(): { id: string } {
    return creerSession(base, { lieuId: idLieu, dateSession: '2026-08-09' });
  }

  it('déduit les crêpes produites du volume mesuré et les renvoie dans la réponse HTTP', async () => {
    const session = nouvelleSession();
    creerProductionDeTest(session.id, '1');

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/cloturer`,
      payload: {
        ventes: [{ produitVenteId: idCrepe, quantite: 40, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 12_000,
        caCarteCents: 0,
        // Aucun `crepesProduites` : seul le volume restant est déclaré.
        volumeRestantSaisi: { quantite: 800, unite: 'ml' },
        crepesInvendues: 10,
        crepesCassees: 5,
      },
    });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ResultatCloture>();
    // `crepesProduites` (55) vit au niveau racine de la réponse, comme pour
    // toute clôture — `resolutionVolume` n'en explique QUE le calcul, sans le
    // dupliquer.
    expect(corps.crepesProduites).toBe(55);
    expect(corps.resolutionVolume).toEqual({
      volumeProduitMl: 5000,
      volumeRestantMl: 800,
      volumeConsommeMl: 4200,
      // Aucune pâte vendue directement sur cette session (fiche 15 §5.1).
      volumePateVendueMl: 0,
    });
  });

  it("n'affiche qu'une information, jamais un refus, quand le volume mesuré diverge de vendues + invendues + cassées", async () => {
    const session = nouvelleSession();
    creerProductionDeTest(session.id, '2');

    // 40 + 10 + 2 = 52, contre 55 crêpes déduites du volume.
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/cloturer`,
      payload: {
        ventes: [{ produitVenteId: idCrepe, quantite: 40, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 12_000,
        caCarteCents: 0,
        volumeRestantSaisi: { quantite: 800, unite: 'ml' },
        crepesInvendues: 10,
        crepesCassees: 2,
      },
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json<ResultatCloture>().crepesProduites).toBe(55);
  });

  it('refuse (422) les deux modes à la fois, désignés par le contrat AVANT le service', async () => {
    const session = nouvelleSession();
    creerProductionDeTest(session.id, '3');

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/cloturer`,
      payload: {
        ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 3000,
        caCarteCents: 0,
        crepesProduites: 66,
        volumeRestantSaisi: { quantite: 800, unite: 'ml' },
        crepesInvendues: 0,
        crepesCassees: 0,
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<{ erreur: { code: string } }>().erreur.code).toBe('validation');
  });

  it("refuse (422) les grammes : aucune densité de pâte n'est déclarée", async () => {
    const session = nouvelleSession();
    creerProductionDeTest(session.id, '4');

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/cloturer`,
      payload: {
        ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 3000,
        caCarteCents: 0,
        volumeRestantSaisi: { quantite: 800, unite: 'g' },
        crepesInvendues: 0,
        crepesCassees: 0,
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<{ erreur: { code: string } }>().erreur.code).toBe('densite_pate_manquante');
  });

  it("refuse (422) un volume mesuré quand aucune production n'est rattachée", async () => {
    const session = nouvelleSession();

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/cloturer`,
      payload: {
        ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 3000,
        caCarteCents: 0,
        volumeRestantSaisi: { quantite: 800, unite: 'ml' },
        crepesInvendues: 0,
        crepesCassees: 0,
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<{ erreur: { code: string } }>().erreur.code).toBe(
      'volume_production_inconnu',
    );
  });

  /* ═══════════════════════════════════════════════════════════════════════
     Persistance et réaffichage du mode de clôture (D-057)

     Le volume mesuré n'était pas conservé : `crepesProduites` survivait à la
     clôture, mais rien ne disait plus d'où il venait. Migration 0012 ajoute
     `modeCloture` et `volumeRestantMesureMl` — ces tests vérifient qu'ils
     survivent à un aller-retour complet clôture → relecture HTTP, comme le
     ferait l'écran en rouvrant une session fermée.
     ═══════════════════════════════════════════════════════════════════════ */

  it('réaffiche le mode « volume » et la mesure d’origine en rouvrant la session par GET', async () => {
    const session = nouvelleSession();
    creerProductionDeTest(session.id, '5');

    const clot = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/cloturer`,
      payload: {
        ventes: [{ produitVenteId: idCrepe, quantite: 40, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 12_000,
        caCarteCents: 0,
        volumeRestantSaisi: { quantite: 800, unite: 'ml' },
        crepesInvendues: 10,
        crepesCassees: 5,
      },
    });
    expect(clot.statusCode).toBe(200);
    // Déjà présent dans la réponse de clôture elle-même…
    expect(clot.json<ResultatCloture>().modeCloture).toBe('volume');
    expect(clot.json<ResultatCloture>().volumeRestantMesureMl).toBe(800);

    // … et retrouvé identique en ROUVRANT la session plus tard, par un GET
    // distinct — c'est ce trajet-là que l'écran emprunte pour réafficher une
    // clôture passée (`schemaSessionDetail`, pas `schemaResultatCloture`).
    const relecture = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });
    expect(relecture.statusCode).toBe(200);
    const detail = relecture.json<{
      modeCloture: string | null;
      volumeRestantMesureMl: number | null;
    }>();
    expect(detail.modeCloture).toBe('volume');
    expect(detail.volumeRestantMesureMl).toBe(800);
  });

  it(
    'réaffiche le mode « crêpes » avec un volume mesuré à `null` quand on compte les crêpes ' +
      '(non-régression)',
    async () => {
      const session = nouvelleSession();
      creerProductionDeTest(session.id, '6');

      const clot = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/cloturer`,
        payload: {
          ventes: [{ produitVenteId: idCrepe, quantite: 66, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 19_800,
          caCarteCents: 0,
          // Mode « crêpes » : correspond exactement à la production rattachée.
          crepesProduites: 66,
          crepesInvendues: 0,
          crepesCassees: 0,
        },
      });
      expect(clot.statusCode).toBe(200);

      const relecture = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });
      expect(relecture.statusCode).toBe(200);
      const detail = relecture.json<{
        modeCloture: string | null;
        volumeRestantMesureMl: number | null;
      }>();
      expect(detail.modeCloture).toBe('crepes');
      expect(detail.volumeRestantMesureMl).toBeNull();
    },
  );

  // Kilometres reels de la tournee (D-064) : le fil COMPLET, HTTP compris —
  // `schemaClotureSession` (contrat) -> route (mappage `corps.distanceReelleKm`)
  // -> `cloturerSession` (service) -> colonne `session_marche.distance_reelle_km`.
  // Un maillon manquant N'IMPORTE OU sur ce fil laisse la colonne a `null`
  // malgre une valeur envoyee, exactement le defaut que ces deux tests
  // detectent (verifie en retirant le mappage de la route : ce premier test
  // rougit alors avec `null` au lieu de `52.6`).
  describe('kilometres reels de la tournee (D-064)', () => {
    it('ecrit les kilometres reels jusque dans la ligne de session, via la route HTTP complete', async () => {
      const session = nouvelleSession();

      const reponse = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/cloturer`,
        payload: {
          ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          distanceReelleKm: 52.6,
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          crepesProduites: 10,
          crepesInvendues: 0,
          crepesCassees: 0,
        },
      });

      expect(reponse.statusCode).toBe(200);
      const ligne = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(ligne.distanceReelleKm).toBe(52.6);
    });

    it('laisse `null`, jamais 0, quand le corps HTTP ne renseigne pas les kilometres reels', async () => {
      const session = nouvelleSession();

      const reponse = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/cloturer`,
        payload: {
          ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          crepesProduites: 10,
          crepesInvendues: 0,
          crepesCassees: 0,
        },
      });

      expect(reponse.statusCode).toBe(200);
      const ligne = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(ligne.distanceReelleKm).toBeNull();
    });

    // Trou 1 (audit du 30/07/2026) : le fil s'arrêtait à la base — la colonne
    // était bien écrite (tests ci-dessus), mais ni `schemaSessionDetail` ni
    // `lireSessionDetail` ne le renvoyaient au client. Sans le champ ajouté
    // aux deux, ce test rougit avec `undefined` (Zod tronque silencieusement
    // les clés qu'il ne connaît pas).
    it('renvoie les kilometres reels dans la reponse HTTP, y compris en rouvrant par GET', async () => {
      const session = nouvelleSession();

      const cloture = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/cloturer`,
        payload: {
          ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          distanceReelleKm: 52.6,
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          crepesProduites: 10,
          crepesInvendues: 0,
          crepesCassees: 0,
        },
      });
      expect(cloture.json<ResultatCloture>().distanceReelleKm).toBe(52.6);

      const relecture = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });
      expect(relecture.json<{ distanceReelleKm: number | null }>().distanceReelleKm).toBe(52.6);
    });
  });

  // Imputation de la tournee reelle entre la session et les achats (D-064
  // point 4, Trou 2 — audit du 30/07/2026) : `imputationTourneeDeplacement`
  // (@batte/core) existait, testee, et aucun code de production ne l'appelait.
  // Ce test prouve que la reponse HTTP de cloture la porte desormais — sans le
  // branchement dans `services/sessions.ts` puis le passage dans
  // `routes/sessions.ts`, `corps.imputationDeplacement` serait `undefined`.
  describe('imputation de la tournee reelle entre la session et les achats (D-064 point 4)', () => {
    it('renvoie la separation session/achats dans la reponse de cloture', async () => {
      const maintenant = maintenantUtc();
      const idLieuAvecDistance = nouvelIdentifiant();
      base
        .insert(lieuMarche)
        .values({
          id: idLieuAvecDistance,
          nom: 'Lieu HTTP avec distance de reference',
          jourSemaine: 0,
          heureDebut: '08:00',
          heureFin: '14:30',
          actif: true,
          distanceKm: 20,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      const session = creerSession(base, {
        lieuId: idLieuAvecDistance,
        dateSession: '2026-08-09',
      });

      const reponse = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/cloturer`,
        payload: {
          ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          // Tournee reelle de 55 km, contre 40 km pour la session seule
          // (2 x 20 km de reference) : 15 km de detour, cause par un
          // fournisseur ou un second marche.
          distanceReelleKm: 55,
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          crepesProduites: 10,
          crepesInvendues: 0,
          crepesCassees: 0,
        },
      });

      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json<ResultatCloture>();
      // Forfait officiel 0,4761 €/km (aucun plein enregistre dans ce test) :
      // 2619 = total, 714 = detour, 1905 = session par soustraction.
      expect(corps.imputationDeplacement).toEqual({
        coutSessionCents: 1905,
        coutDetourAchatsCents: 714,
        coutTotalReelCents: 2619,
      });
    });

    // Migration 0027 (porteur) a ajoute trois colonnes miroir sur
    // `session_marche`. Sans leur ecriture (`services/sessions.ts`) ET leur
    // lecture (`depots/sessions.ts::lireSessionDetail`,
    // `schemaSessionDetail`), ce test rougit : la reponse de cloture porte
    // deja `imputationDeplacement` (test ci-dessus), mais un GET SEPARE,
    // survenu apres, ne retrouvait rien avant ce correctif.
    it('reste lisible en rouvrant par GET — persiste, pas seulement present sur la reponse de cloture', async () => {
      const maintenant = maintenantUtc();
      const idLieuAvecDistance = nouvelIdentifiant();
      base
        .insert(lieuMarche)
        .values({
          id: idLieuAvecDistance,
          nom: 'Lieu HTTP avec distance de reference (GET ulterieur)',
          jourSemaine: 0,
          heureDebut: '08:00',
          heureFin: '14:30',
          actif: true,
          distanceKm: 20,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      const session = creerSession(base, {
        lieuId: idLieuAvecDistance,
        dateSession: '2026-08-09',
      });

      const cloture = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/cloturer`,
        payload: {
          ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          distanceReelleKm: 55,
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          crepesProduites: 10,
          crepesInvendues: 0,
          crepesCassees: 0,
        },
      });
      expect(cloture.statusCode).toBe(200);

      const relecture = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });
      expect(relecture.statusCode).toBe(200);
      const detail = relecture.json<{
        coutDeplacementReelSessionCents: number | null;
        coutDeplacementReelDetourAchatsCents: number | null;
        coutDeplacementReelTotalCents: number | null;
      }>();
      expect(detail.coutDeplacementReelSessionCents).toBe(1905);
      expect(detail.coutDeplacementReelDetourAchatsCents).toBe(714);
      expect(detail.coutDeplacementReelTotalCents).toBe(2619);
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Équipements électriques utilisés à la clôture (fiche 17, D-055)
   ═══════════════════════════════════════════════════════════════════════════

   Trou le plus dangereux de l'audit du 30/07/2026 : `enregistrerUtilisationEquipement`
   (ÉCRITURE) et `utilisationsEquipementsSession` (LECTURE, deux routes de
   l'écran Équipements) étaient toutes deux réelles et atteignables — mais
   `equipementsUtilises` n'existait ni dans `schemaClotureSession`, ni dans la
   route de clôture : le contrat HTTP ne pouvait JAMAIS transmettre cette
   saisie. Ce test prouve le fil COMPLET, HTTP compris. */
describe('POST /api/sessions/:id/cloturer — équipements électriques utilisés (fiche 17)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idLieu: string;
  let idCrepe: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    idCrepe = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    'écrit la durée d’utilisation dans `equipement_session`, via le contrat HTTP complet ' +
      '(schemaClotureSession -> route -> cloturerSession -> enregistrerUtilisationEquipement)',
    async () => {
      const idEquipement = creerEquipement(base, {
        nom: 'Radiateur test HTTP',
        type: 'chauffage',
        puissanceW: 1500,
        enService: true,
        notes: null,
      });
      const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-08-09' });

      const reponse = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/cloturer`,
        payload: {
          ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          crepesProduites: 10,
          crepesInvendues: 0,
          crepesCassees: 0,
          equipementsUtilises: [{ equipementId: idEquipement, dureeMinutes: 180 }],
        },
      });

      expect(reponse.statusCode).toBe(200);
      expect(utilisationsEquipementsSession(base, session.id)).toEqual([
        {
          equipementId: idEquipement,
          nom: 'Radiateur test HTTP',
          type: 'chauffage',
          puissanceW: 1500,
          dureeMinutes: 180,
        },
      ]);
    },
  );

  it('n’écrit aucune ligne quand aucun équipement n’est utilisé — un lieu sans électricité n’en fournit aucun', async () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-08-09' });

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/cloturer`,
      payload: {
        ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 3000,
        caCarteCents: 0,
        crepesProduites: 10,
        crepesInvendues: 0,
        crepesCassees: 0,
      },
    });

    expect(reponse.statusCode).toBe(200);
    expect(utilisationsEquipementsSession(base, session.id)).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Justificatif (ticket) d'un frais de session (mission « justificatif d'un
   frais de session », 30/07/2026) — LE MAILLON DÉCISIF : `schemaClotureSession`
   (`@batte/core`) ne porte pas ces quatre clés, donc c'est ICI, au niveau du
   contrat HTTP, que le fil se coupait en silence si la route ne les relisait
   pas dans la requête brute (`schemaJustificatifsFraisSession`,
   `apps/api/src/routes/sessions.ts`). Les tests de
   `packages/db/src/services/sessions.test.ts` appellent `cloturerSession`
   directement et ne peuvent PAS voir un défaut situé dans la route elle-même.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('POST /api/sessions/:id/cloturer — justificatif (ticket) des frais de session', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idLieu: string;
  let idCrepe: string;

  // Contenu réellement conforme au type MIME déclaré (`validerPieceJointe`
  // vérifie aussi les octets, pas seulement la forme de la Data URI — voir
  // `contenuCorrespondAuTypeDeclare`, `packages/db/src/services/factures.ts`).
  const pieceJointe =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    idCrepe = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepte un justificatif par catégorie de frais et le rattache à SA ligne', async () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-08-09' });

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/cloturer`,
      payload: {
        ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
        frais: {
          emplacementCents: 2200,
          deplacementCents: 0,
          gazCents: 0,
          diversCents: 0,
          emplacementJustificatifPath: pieceJointe,
        },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 3000,
        caCarteCents: 0,
        crepesProduites: 10,
        crepesInvendues: 0,
        crepesCassees: 0,
      },
    });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ResultatCloture>();
    const ligneEmplacement = corps.fraisDetail.find((f) => f.categorie === 'emplacement');
    expect(ligneEmplacement?.justificatifPath).toBe(pieceJointe);
  });

  it('rend `justificatifPath` à `null` quand aucune pièce n’est jointe à un frais', async () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-08-09' });

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/cloturer`,
      payload: {
        ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 2200, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 3000,
        caCarteCents: 0,
        crepesProduites: 10,
        crepesInvendues: 0,
        crepesCassees: 0,
      },
    });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ResultatCloture>();
    const ligneEmplacement = corps.fraisDetail.find((f) => f.categorie === 'emplacement');
    expect(ligneEmplacement?.justificatifPath).toBeNull();
  });

  it('refuse une pièce jointe de frais qui n’est pas une Data URI reconnue', async () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-08-09' });

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/cloturer`,
      payload: {
        ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
        frais: {
          emplacementCents: 0,
          deplacementCents: 1400,
          gazCents: 0,
          diversCents: 0,
          deplacementJustificatifPath: 'C:\\Users\\porteur\\Documents\\ticket.pdf',
        },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 3000,
        caCarteCents: 0,
        crepesProduites: 10,
        crepesInvendues: 0,
        crepesCassees: 0,
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<{ erreur: { code: string } }>().erreur.code).toBe(
      'piece_jointe_format_invalide',
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Rattachement à une opportunité (fiche 14, D-059)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('POST /api/sessions et PATCH /api/sessions/:id/rattacher-evenement', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idLieu: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function creerOpportuniteEntreprise(): string {
    return creerOpportunite(base, {
      nom: 'Stand entreprise — test HTTP',
      type: 'autre',
      famille: 'entreprise',
      dateDebut: '2026-10-01',
      dateFin: '2026-10-01',
      effectifEstime: 120,
    }).id;
  }

  it('crée une session déjà rattachée à une opportunité, via `evenementId` dans le corps', async () => {
    const evenementId = creerOpportuniteEntreprise();

    const creation = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { lieuId: idLieu, dateSession: '2026-10-01', evenementId },
    });
    expect(creation.statusCode).toBe(201);
    const corps = creation.json<{
      id: string;
      evenementId: string | null;
      evenementNom: string | null;
    }>();
    expect(corps.evenementId).toBe(evenementId);
    expect(corps.evenementNom).toBe('Stand entreprise — test HTTP');
  });

  it('laisse `evenementId` à `null` quand rien n’est renseigné — le cas majoritaire', async () => {
    const creation = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { lieuId: idLieu, dateSession: '2026-10-02' },
    });
    expect(creation.statusCode).toBe(201);
    const corps = creation.json<{ evenementId: string | null }>();
    expect(corps.evenementId).toBeNull();
  });

  it('rattache une session après coup, avant sa clôture', async () => {
    const evenementId = creerOpportuniteEntreprise();
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-10-03' });

    const rattachement = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}/rattacher-evenement`,
      payload: { evenementId },
    });
    expect(rattachement.statusCode).toBe(204);

    const relecture = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });
    const detail = relecture.json<{ evenementId: string | null }>();
    expect(detail.evenementId).toBe(evenementId);
  });

  it(
    'refuse (422) le rattachement sur une session déjà CLÔTURÉE — le lien se pose ' +
      'avant, jamais après',
    async () => {
      const evenementId = creerOpportuniteEntreprise();
      const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-10-04' });
      const idCrepe = base
        .select({ id: produitVente.id })
        .from(produitVente)
        .where(eq(produitVente.nature, 'transforme'))
        .get()!.id;

      await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/cloturer`,
        payload: {
          ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          crepesProduites: 10,
          crepesInvendues: 0,
          crepesCassees: 0,
        },
      });

      const rattachement = await app.inject({
        method: 'PATCH',
        url: `/api/sessions/${session.id}/rattacher-evenement`,
        payload: { evenementId },
      });
      expect(rattachement.statusCode).toBe(422);
      expect(rattachement.json<{ erreur: { code: string } }>().erreur.code).toBe(
        'session_deja_cloturee',
      );
    },
  );

  it('refuse (422) le rattachement à un événement-FACTEUR classique (famille = NULL)', async () => {
    const maintenant = maintenantUtc();
    const idFacteur = nouvelIdentifiant();
    // Événement-FACTEUR classique (`famille = NULL`) : module une session
    // existante, il n'en crée jamais une (docs/demandes/14 §2) — il ne peut
    // donc pas non plus se voir rattacher une session après coup.
    base
      .insert(evenement)
      .values({
        id: idFacteur,
        nom: 'Festival classique — test HTTP',
        type: 'festival',
        dateDebut: '2026-08-01',
        dateFin: '2026-08-01',
        portee: 'quartier',
        intensiteEstimee: 3,
        impactEstimeBp: 13_000,
        valideParHumain: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-10-05' });
    const rattachement = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}/rattacher-evenement`,
      payload: { evenementId: idFacteur },
    });
    expect(rattachement.statusCode).toBe(422);
    expect(rattachement.json<{ erreur: { code: string } }>().erreur.code).toBe(
      'evenement_pas_une_opportunite',
    );
  });
});
