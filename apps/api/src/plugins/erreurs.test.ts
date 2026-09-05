/**
 * Le gestionnaire d'erreurs unique : un message FRANÇAIS par statut client.
 *
 * `routes/erreurs-500.test.ts` prouve déjà qu'aucune faute prévisible ne sort
 * en 500. Il ne vérifie pas ce qui est ÉCRIT : `attendreMessageUtile` se
 * contente d'exiger un statut < 500. Or `messageClient` a six branches, et une
 * seule (400) était empruntée. Les cinq autres rendaient donc un message que
 * personne n'avait jamais lu.
 *
 * L'enjeu est celui posé en tête du fichier source : on ne renvoie JAMAIS le
 * message brut de Fastify, parce qu'il est en anglais technique et peut porter
 * un fragment du corps envoyé. Une branche non couverte est une branche dont
 * on ignore si elle tient cette promesse.
 *
 * Deux des statuts sont produits par le VRAI comportement de Fastify (413 par
 * un `bodyLimit` dépassé, 415 par un type de contenu refusé). Les trois autres
 * sont provoqués par une erreur portant un `statusCode` — c'est exactement la
 * forme des erreurs natives de Fastify que le gestionnaire reçoit, et le seul
 * moyen d'atteindre 414 sans dépendre de la limite d'URL de l'environnement.
 */

import { ErreurMetier } from '@batte/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { enregistrerGestionnaireErreurs } from './erreurs.js';

type ReponseErreur = { erreur: { code: string; message: string; champs?: Record<string, string> } };

/** Erreur de la forme exacte que Fastify produit pour ses fautes 4xx natives. */
function erreurFastify(statusCode: number, code: string): Error & { statusCode: number } {
  const erreur = new Error('English technical message, must never reach the browser.') as Error & {
    statusCode: number;
    code: string;
  };
  erreur.statusCode = statusCode;
  erreur.code = code;
  return erreur;
}

describe('gestionnaire d’erreurs — message français par statut', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  /** Application minimale dont l'unique route lève l'erreur fournie. */
  async function appQuiLeve(erreur: unknown, bodyLimit?: number): Promise<FastifyInstance> {
    const instance = Fastify(
      bodyLimit === undefined ? { logger: false } : { logger: false, bodyLimit },
    );
    enregistrerGestionnaireErreurs(instance);
    instance.post('/essai', async () => {
      throw erreur;
    });
    await instance.ready();
    app = instance;
    return instance;
  }

  it('413 — contenu trop volumineux, produit par la VRAIE limite de corps de Fastify', async () => {
    const instance = await appQuiLeve(new Error('jamais atteint'), 64);
    const reponse = await instance.inject({
      method: 'POST',
      url: '/essai',
      payload: JSON.stringify({ texte: 'SENTINELLE-CORPS-'.repeat(40) }),
      headers: { 'content-type': 'application/json' },
    });

    expect(reponse.statusCode).toBe(413);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.message).toBe('Le contenu envoyé est trop volumineux.');
    // Le code Fastify est conservé pour le diagnostic ; le MESSAGE, lui, est
    // réécrit en français et ne porte aucun fragment du corps envoyé.
    expect(corps.erreur.code).toContain('fst_err');
    expect(corps.erreur.message).not.toContain('SENTINELLE-CORPS');
  });

  it('415 — type de contenu refusé, produit par le VRAI parseur de Fastify', async () => {
    const instance = await appQuiLeve(new Error('jamais atteint'));
    const reponse = await instance.inject({
      method: 'POST',
      url: '/essai',
      payload: 'libelle=x',
      headers: { 'content-type': 'application/xml' },
    });

    expect(reponse.statusCode).toBe(415);
    expect(reponse.json<ReponseErreur>().erreur.message).toBe(
      'Le format envoyé n’est pas accepté : utilisez « application/json ».',
    );
  });

  it('400 — corps JSON malformé', async () => {
    const instance = await appQuiLeve(new Error('jamais atteint'));
    const reponse = await instance.inject({
      method: 'POST',
      url: '/essai',
      payload: '{ "a": ',
      headers: { 'content-type': 'application/json' },
    });

    expect(reponse.statusCode).toBe(400);
    expect(reponse.json<ReponseErreur>().erreur.message).toBe(
      'La requête est mal formée : le corps envoyé n’est pas du JSON valide.',
    );
  });

  it('414 — adresse trop longue', async () => {
    const instance = await appQuiLeve(erreurFastify(414, 'FST_ERR_CTP_INVALID_MEDIA_TYPE'));
    const reponse = await instance.inject({ method: 'POST', url: '/essai', payload: {} });

    expect(reponse.statusCode).toBe(414);
    expect(reponse.json<ReponseErreur>().erreur.message).toBe(
      'L’adresse demandée est trop longue.',
    );
  });

  it('404 porté par une erreur levée dans une route (distinct de la route inconnue)', async () => {
    const instance = await appQuiLeve(erreurFastify(404, 'FST_ERR_NOT_FOUND'));
    const reponse = await instance.inject({ method: 'POST', url: '/essai', payload: {} });

    expect(reponse.statusCode).toBe(404);
    expect(reponse.json<ReponseErreur>().erreur.message).toBe(
      'La ressource demandée est introuvable.',
    );
  });

  it('tout autre 4xx retombe sur le message générique, jamais sur le texte de Fastify', async () => {
    const instance = await appQuiLeve(erreurFastify(409, 'FST_ERR_CONFLIT'));
    const reponse = await instance.inject({ method: 'POST', url: '/essai', payload: {} });

    expect(reponse.statusCode).toBe(409);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.message).toBe('La requête a été refusée. Vérifiez les données envoyées.');
    // Discrimine : le message technique anglais de l'erreur d'origine ne doit
    // pas ressortir. C'est toute la raison d'être de `messageClient`.
    expect(corps.erreur.message).not.toContain('English');
  });

  it('une ErreurMetier garde SON code et SON message — elle ne passe pas par messageClient', async () => {
    // Discrimine : sans ce cas, `messageClient` pourrait écraser tous les
    // refus métier, et les six messages ci-dessus s'afficheraient partout.
    const instance = await appQuiLeve(
      new ErreurMetier('stock_insuffisant', 'Il manque 2 300 g de farine T55.', {
        champs: { quantite: 'Réduisez la quantité demandée.' },
      }),
    );
    const reponse = await instance.inject({ method: 'POST', url: '/essai', payload: {} });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('stock_insuffisant');
    expect(corps.erreur.message).toBe('Il manque 2 300 g de farine T55.');
    expect(corps.erreur.champs).toEqual({ quantite: 'Réduisez la quantité demandée.' });
  });

  it('un 5xx ne fuite aucune trace technique', async () => {
    const instance = await appQuiLeve(erreurFastify(503, 'FST_ERR_INDISPONIBLE'));
    const reponse = await instance.inject({ method: 'POST', url: '/essai', payload: {} });

    expect(reponse.statusCode).toBe(500);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('erreur_interne');
    expect(corps.erreur.message).not.toContain('English');
  });
});
