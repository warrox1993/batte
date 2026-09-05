/**
 * Tests HTTP des routes `/api/equipements` (docs/demandes/17-ENERGIE-GAZ-
 * ELECTRICITE-SOLAIRE-EMPREINTE.md, D-055).
 *
 * Fichier DÉDIÉ plutôt qu'ajouté à `integration.test.ts` : ce dernier est
 * verrouillé pour cet agent (D-045, balayage anti-fuite dérivé de la table de
 * routage réelle) — l'orchestrateur y ajoutera les routes listées dans le
 * rapport de livraison. Même geste que `routes/concurrents.test.ts` : ce
 * fichier construit sa PROPRE instance Fastify minimale, ne montant que
 * `routesEquipements`, avec le MÊME gestionnaire d'erreurs que le vrai serveur.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import {
  creerBase,
  enregistrerImmobilisation,
  enregistrerUtilisationEquipement,
  migrer,
  lieuMarche,
  seed,
  sessionMarche,
  type BaseBatte,
} from '@batte/db';
import { enregistrerGestionnaireErreurs, envoyerReponse404 } from '../plugins/erreurs.js';
import { routesEquipements } from './equipements.js';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

describe('routes /api/equipements', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app, envoyerReponse404);
    await app.register(routesEquipements(base), { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  function corpsEquipement(surcharges: Record<string, unknown> = {}) {
    return {
      nom: 'Radiateur soufflant 2000 W',
      type: 'chauffage',
      puissanceW: 2000,
      enService: true,
      notes: null,
      ...surcharges,
    };
  }

  async function creer(surcharges: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/api/equipements',
      payload: corpsEquipement(surcharges),
    });
  }

  function insererLieu(surcharges: { nom: string; puissanceDisponibleW?: number | null }): string {
    const id = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(lieuMarche)
      .values({
        id,
        nom: surcharges.nom,
        actif: true,
        puissanceDisponibleW: surcharges.puissanceDisponibleW ?? null,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    return id;
  }

  describe('POST /api/equipements', () => {
    it('crée un équipement', async () => {
      const reponse = await creer();
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json();
      expect(corps).toMatchObject({
        nom: 'Radiateur soufflant 2000 W',
        type: 'chauffage',
        puissanceW: 2000,
        enService: true,
        actif: true,
        nbUtilisations: 0,
      });
    });

    it('rejette une puissance négative ou nulle en 422, avec le champ fautif', async () => {
      const reponse = await creer({ puissanceW: 0 });
      expect(reponse.statusCode).toBe(422);
      const corps = reponse.json<ReponseErreur>();
      expect(corps.erreur.champs).toHaveProperty('puissanceW');
    });

    it('rejette un nom vide en 422', async () => {
      const reponse = await creer({ nom: '' });
      expect(reponse.statusCode).toBe(422);
      const corps = reponse.json<ReponseErreur>();
      expect(corps.erreur.champs).toHaveProperty('nom');
    });

    it('un équipement peut être déclaré sans être en service (comparaison avant achat)', async () => {
      const reponse = await creer({ enService: false });
      expect(reponse.json()).toMatchObject({ enService: false });
    });
  });

  describe('GET /api/equipements', () => {
    it('liste les équipements et somme la puissance des SEULS équipements en service', async () => {
      await creer({ nom: 'Radiateur 1', puissanceW: 1500, enService: true });
      await creer({ nom: 'Radiateur 2', puissanceW: 1500, enService: true });
      // Déclaré pour comparaison avant achat : ne doit pas compter dans la somme.
      await creer({ nom: 'Radiateur candidat', puissanceW: 2000, enService: false });

      const reponse = await app.inject({ method: 'GET', url: '/api/equipements' });
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json();
      expect(corps.meta.total).toBe(3);
      expect(corps.meta.puissanceTotaleEnServiceW).toBe(3000);
    });
  });

  describe('PATCH /api/equipements/:id', () => {
    it('modifie un équipement existant', async () => {
      const cree = await creer();
      const id = cree.json().id as string;

      const reponse = await app.inject({
        method: 'PATCH',
        url: `/api/equipements/${id}`,
        payload: corpsEquipement({ puissanceW: 2500, enService: false }),
      });
      expect(reponse.statusCode).toBe(200);
      expect(reponse.json()).toMatchObject({ puissanceW: 2500, enService: false });
    });

    it('rend 404 pour un identifiant inexistant', async () => {
      const reponse = await app.inject({
        method: 'PATCH',
        url: `/api/equipements/${nouvelIdentifiant()}`,
        payload: corpsEquipement(),
      });
      expect(reponse.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/equipements/:id/activite', () => {
    it('retire un équipement sans le supprimer', async () => {
      const cree = await creer();
      const id = cree.json().id as string;

      const reponse = await app.inject({
        method: 'PATCH',
        url: `/api/equipements/${id}/activite`,
        payload: { actif: false },
      });
      expect(reponse.statusCode).toBe(200);
      expect(reponse.json()).toMatchObject({ actif: false });

      const liste = await app.inject({ method: 'GET', url: '/api/equipements' });
      expect(liste.json().meta.total).toBe(1);
    });
  });

  describe('GET /api/equipements/diagnostic-puissance', () => {
    it('signale le risque de disjonction — 4500 W prévus pour 3500 W disponibles', async () => {
      await creer({ nom: 'Radiateur 1', puissanceW: 1500, enService: true });
      await creer({ nom: 'Radiateur 2', puissanceW: 1500, enService: true });
      await creer({ nom: 'Radiateur 3', puissanceW: 1500, enService: true });
      const lieuId = insererLieu({ nom: 'La Batte (hiver)', puissanceDisponibleW: 3500 });

      const reponse = await app.inject({
        method: 'GET',
        url: '/api/equipements/diagnostic-puissance',
      });
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json();
      expect(corps.meta.puissanceRequiseW).toBe(4500);
      expect(corps.meta.nbEquipementsEnService).toBe(3);

      const ligne = corps.data.find((l: { lieuId: string }) => l.lieuId === lieuId);
      expect(ligne.risqueDisjonction).toBe(true);
      expect(ligne.margeW).toBe(-1000);
      expect(ligne.avertissement).toContain('4500 W');
    });

    it('rend le risque à null quand la puissance disponible du lieu est inconnue', async () => {
      await creer({ nom: 'Radiateur 1', puissanceW: 1500, enService: true });
      const lieuId = insererLieu({ nom: 'Lieu sans info', puissanceDisponibleW: null });

      const reponse = await app.inject({
        method: 'GET',
        url: '/api/equipements/diagnostic-puissance',
      });
      const corps = reponse.json();
      const ligne = corps.data.find((l: { lieuId: string }) => l.lieuId === lieuId);
      expect(ligne.risqueDisjonction).toBeNull();
      expect(ligne.margeW).toBeNull();
      expect(ligne.avertissement).not.toBeNull();
    });

    it('ne signale aucun risque quand la puissance disponible suffit', async () => {
      await creer({ nom: 'Radiateur 1', puissanceW: 1500, enService: true });
      const lieuId = insererLieu({ nom: 'Lieu avec courant', puissanceDisponibleW: 5000 });

      const reponse = await app.inject({
        method: 'GET',
        url: '/api/equipements/diagnostic-puissance',
      });
      const corps = reponse.json();
      const ligne = corps.data.find((l: { lieuId: string }) => l.lieuId === lieuId);
      expect(ligne.risqueDisjonction).toBe(false);
      expect(ligne.avertissement).toBeNull();
    });
  });

  describe('GET /api/equipements/point-equilibre-autoproduction', () => {
    beforeEach(() => {
      // Catalogue de paramètres, dont `prix_kwh_cents_par_kwh` (20 par défaut) :
      // sans lui, `parametres.possede(...)` reste faux et masquerait le cas
      // « prix connu » qu'on veut prouver ici.
      seed(base);
    });

    it('aucune session ni équipement compatible en service : le point d’équilibre reste inconnu, jamais estimé à partir d’un coût évité à 0', async () => {
      enregistrerImmobilisation(base, {
        libelle: 'Panneaux solaires',
        dateAcquisition: '2026-01-01',
        montantCents: 500_000,
        dureeAmortissementAnnees: 10,
      });

      const reponse = await app.inject({
        method: 'GET',
        url: '/api/equipements/point-equilibre-autoproduction',
      });
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json();

      // Le coût d'installation, LUI, est parfaitement connu (montant saisi) :
      // c'est bien le coût d'énergie évité, la seule inconnue ici, qui doit
      // faire échouer le calcul — jamais un 0 silencieux à sa place.
      expect(corps.meta.coutEnergieEviteParSessionCents).toBeNull();
      expect(corps.meta.nbSessionsPriseEnCompte).toBe(0);
      expect(corps.meta.raisonCoutEviteIndisponible).not.toBeNull();

      expect(corps.data).toHaveLength(1);
      expect(corps.data[0].sessionsAvantEquilibre).toBeNull();
      expect(corps.data[0].raisonIndisponible).not.toBeNull();
      expect(corps.data[0].raisonIndisponible).toContain('énergie évité');
    });

    it('avec un équipement compatible utilisé sur une session close à un lieu facturé au compteur : un vrai nombre de sessions, jamais 0 ni infini', async () => {
      const eclairage = await creer({
        nom: 'Guirlande LED',
        type: 'eclairage',
        puissanceW: 100,
        enService: true,
      });
      const equipementId = eclairage.json().id as string;

      const lieuId = insererLieu({ nom: 'Lieu au compteur', puissanceDisponibleW: 3000 });
      // `facturationElectricite` n'est pas un champ d'`insererLieu` (helper
      // partagé avec le diagnostic de puissance) : mise à jour directe, même
      // patron que les autres fichiers de tests de cette fiche.
      base
        .update(lieuMarche)
        .set({ facturationElectricite: 'compteur' })
        .where(eq(lieuMarche.id, lieuId))
        .run();

      const sessionId = nouvelIdentifiant();
      const maintenant = maintenantUtc();
      base
        .insert(sessionMarche)
        .values({
          id: sessionId,
          numero: 'SM-EQ-1',
          lieuId,
          dateSession: '2026-01-10',
          statut: 'cloturee',
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      enregistrerUtilisationEquipement(base, { equipementId, sessionId, dureeMinutes: 600 });

      const { id: immobilisationId } = enregistrerImmobilisation(base, {
        libelle: 'Panneaux solaires',
        dateAcquisition: '2026-01-01',
        montantCents: 500_000,
        dureeAmortissementAnnees: 10,
      });

      const reponse = await app.inject({
        method: 'GET',
        url: '/api/equipements/point-equilibre-autoproduction',
      });
      const corps = reponse.json();

      expect(corps.meta.coutEnergieEviteParSessionCents).toBeGreaterThan(0);
      expect(corps.meta.nbSessionsPriseEnCompte).toBe(1);
      expect(corps.meta.raisonCoutEviteIndisponible).toBeNull();

      const ligne = corps.data.find(
        (l: { immobilisationId: string }) => l.immobilisationId === immobilisationId,
      );
      expect(ligne).toBeDefined();
      expect(ligne.sessionsAvantEquilibre).toBeGreaterThan(0);
      expect(ligne.raisonIndisponible).toBeNull();
    });
  });
});
