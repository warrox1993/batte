/**
 * Registre AFSCA — les deux gardes de référence d'une non-conformité, et
 * l'annulation d'un relevé de température par HTTP.
 *
 * `routes/afsca.ts` vérifie l'existence de `lotId` et de `sessionId` AVANT
 * d'écrire, parce que `declarerNonConformite` les insère tels quels et que les
 * deux colonnes portent une vraie clé étrangère. Sans ces gardes, une faute de
 * copier-coller (le numéro fournisseur à la place de l'identifiant technique)
 * ne se manifestait qu'en violation de contrainte SQLite — un 500 brut sur le
 * registre RÉGLEMENTAIRE lui-même. Les deux branches n'étaient couvertes ni
 * dans un sens ni dans l'autre.
 *
 * L'annulation d'un relevé (D-083) est l'autre chemin non exercé : elle
 * n'efface RIEN (CLAUDE.md §3 règle 7), elle bascule un statut et conserve le
 * mauvais relevé au registre avec son motif.
 */

import { creerBase, migrer, seed, seedDemonstration, type BaseBatte } from '@batte/db';
import type {
  AnnulationReleveTemperatureCreee,
  ListeLieux,
  ListeRelevesTemperature,
  NonConformiteContrat,
  ReleveTemperatureContrat,
  SessionDetail,
} from '@batte/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { construireServeur } from '../serveur.js';

type ReponseErreur = { erreur: { code: string; message: string; champs?: Record<string, string> } };

/** Identifiant syntaxiquement plausible mais absent de la base. */
const ID_INCONNU = '01920000-0000-7000-8000-000000000000';

describe('routes AFSCA — références de non-conformité et annulation de relevé', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let sessionId: string;

  const JOUR = '2026-05-17';

  /** Non-conformité valide, sans aucune référence. */
  function nonConformite() {
    return {
      dateConstat: JOUR,
      type: 'temperature',
      description: 'Glacière au-dessus du seuil à l’ouverture du stand.',
      gravite: 'majeure',
    };
  }

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    const lieux = (await app.inject({ method: 'GET', url: '/api/lieux' })).json<ListeLieux>();
    const lieu = lieux.data[0];
    if (lieu === undefined) throw new Error('Aucun lieu de marché dans la graine.');

    sessionId = (
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { lieuId: lieu.id, dateSession: JOUR },
      })
    ).json<SessionDetail>().id;
  });

  afterAll(async () => {
    await app.close();
  });

  /* ── Non-conformité : références ─────────────────────────────────────── */

  it('accepte une non-conformité SANS aucune référence — le cas le plus courant', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/afsca/non-conformites',
      payload: nonConformite(),
    });
    expect(reponse.statusCode).toBe(201);
    const corps = reponse.json<NonConformiteContrat>();
    expect(corps.lotId).toBeNull();
    expect(corps.sessionId).toBeNull();
  });

  it('accepte une non-conformité rattachée à une session RÉELLE', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/afsca/non-conformites',
      payload: { ...nonConformite(), sessionId },
    });
    expect(reponse.statusCode).toBe(201);
    expect(reponse.json<NonConformiteContrat>().sessionId).toBe(sessionId);
  });

  it('refuse un lotId inconnu en 422 de SAISIE, jamais en 500 ni en 404', async () => {
    // 422 et non 404 : ces identifiants sont SAISIS dans un formulaire, jamais
    // adressés dans l'URL (convention D-035).
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/afsca/non-conformites',
      payload: { ...nonConformite(), lotId: ID_INCONNU },
    });
    expect(reponse.statusCode).toBe(422);
    const erreur = reponse.json<ReponseErreur>();
    expect(erreur.erreur.code).toBe('lot_introuvable');
    expect(erreur.erreur.champs).toHaveProperty('lotId');
    // Le message doit dire OÙ retrouver le bon identifiant.
    expect(erreur.erreur.message).toContain(ID_INCONNU);
  });

  it('refuse un sessionId inconnu en 422 de SAISIE', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/afsca/non-conformites',
      payload: { ...nonConformite(), sessionId: ID_INCONNU },
    });
    expect(reponse.statusCode).toBe(422);
    const erreur = reponse.json<ReponseErreur>();
    expect(erreur.erreur.code).toBe('session_introuvable');
    expect(erreur.erreur.champs).toHaveProperty('sessionId');
  });

  it('n’écrit RIEN quand la référence est refusée', async () => {
    const avant = (
      await app.inject({
        method: 'GET',
        url: `/api/afsca/non-conformites?debut=${JOUR}&fin=${JOUR}`,
      })
    ).json<{ meta: { total: number } }>().meta.total;

    await app.inject({
      method: 'POST',
      url: '/api/afsca/non-conformites',
      payload: { ...nonConformite(), lotId: ID_INCONNU },
    });

    const apres = (
      await app.inject({
        method: 'GET',
        url: `/api/afsca/non-conformites?debut=${JOUR}&fin=${JOUR}`,
      })
    ).json<{ meta: { total: number } }>().meta.total;
    expect(apres).toBe(avant);
  });

  /* ── Annulation d'un relevé de température ───────────────────────────── */

  it('annule un relevé sans l’effacer : il reste au registre, avec son motif', async () => {
    const releve = (
      await app.inject({
        method: 'POST',
        url: '/api/afsca/temperatures',
        payload: {
          sessionId,
          equipement: 'Glacière rigide',
          temperatureC: 3.5,
          dateReleve: JOUR,
          moment: 'depart',
        },
      })
    ).json<ReleveTemperatureContrat>();

    const annulation = await app.inject({
      method: 'POST',
      url: `/api/afsca/temperatures/${releve.id}/annuler`,
      payload: { motif: 'sonde relevée sur le mauvais bac' },
    });
    expect(annulation.statusCode).toBe(201);
    const corps = annulation.json<AnnulationReleveTemperatureCreee>();
    expect(corps.releveId).toBe(releve.id);
    expect(corps.motif).toBe('sonde relevée sur le mauvais bac');

    // Règle 7 : rien ne s'efface. Le relevé DOIT rester listé, au statut
    // « annulee », et sa VALEUR d'origine ne doit pas avoir été réécrite.
    const liste = (
      await app.inject({ method: 'GET', url: `/api/afsca/temperatures?debut=${JOUR}&fin=${JOUR}` })
    ).json<ListeRelevesTemperature>();
    const conserve = liste.data.find((r) => r.id === releve.id);
    expect(conserve).toBeDefined();
    expect(conserve!.statut).toBe('annulee');
    expect(conserve!.temperatureC).toBe(3.5);
  });

  it('refuse une annulation sans motif — c’est lui qui rend la correction auditable', async () => {
    const releve = (
      await app.inject({
        method: 'POST',
        url: '/api/afsca/temperatures',
        payload: {
          sessionId,
          equipement: 'Glacière rigide',
          temperatureC: 4,
          dateReleve: JOUR,
          moment: 'retour',
        },
      })
    ).json<ReleveTemperatureContrat>();

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/afsca/temperatures/${releve.id}/annuler`,
      payload: { motif: '' },
    });
    expect(reponse.statusCode).toBe(422);
  });

  it('rend 404 sur l’annulation d’un relevé inexistant', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/afsca/temperatures/${ID_INCONNU}/annuler`,
      payload: { motif: 'test' },
    });
    expect(reponse.statusCode).toBe(404);
  });
});
