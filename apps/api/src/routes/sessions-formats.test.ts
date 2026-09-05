/**
 * Contrôles de FORMAT sur la création de session et sur `/api/seuils`.
 *
 * Deux chaînes décident ici de chiffres qui ne se rattrapent pas :
 *
 *  - `dateSession` : `creerSession` en extrait l'année par `slice(0, 4)` puis
 *    `Number.parseInt`. Une valeur mal formée y produisait `NaN`, donc un
 *    numéro de session `SM-NaN-0001` — sur la pièce que la comptabilité belge
 *    exige « sans blancs ni lacunes » (docs/07 §1.5).
 *  - `annee` de `/api/seuils` : `Number.parseInt` est permissif — « 2026abc »
 *    serait tronqué à 2026, « -2026 » accepté. Or ces compteurs décident de la
 *    sortie de la franchise TVA (CLAUDE.md §6) : une année silencieusement
 *    réinterprétée y afficherait le mauvais total.
 *
 * Les deux doivent rendre 422 (saisie fautive), jamais 404 ni 500.
 *
 * DÉFAUT TROUVÉ AU PASSAGE — voir la note en fin de fichier : le garde-fou de
 * date posé DANS `routes/sessions.ts` (lignes 110-119) est aujourd'hui du code
 * MORT, et son commentaire décrit un contrat Zod qui n'existe plus.
 */

import { creerBase, migrer, seed, seedDemonstration, type BaseBatte } from '@batte/db';
import type { ListeLieux, SessionDetail, TableauSeuils } from '@batte/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { construireServeur } from '../serveur.js';

type ReponseErreur = { erreur: { code: string; message: string; champs?: Record<string, string> } };

describe('routes /api/sessions et /api/seuils — contrôles de format', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let lieuId: string;

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
    lieuId = lieu.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuse une date de session qui n’est pas au format AAAA-MM-JJ, en 422', async () => {
    for (const dateSession of ['pas-une-date', '17/05/2026', '2026-5-17', '2026']) {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { lieuId, dateSession },
      });
      expect(reponse.statusCode, dateSession).toBe(422);
      // C'est le CONTRAT Zod qui refuse, pas le garde-fou de la route (voir la
      // note de fin de fichier) : le code est donc `validation`, et le champ
      // fautif est nommé de la même façon.
      const erreur = reponse.json<ReponseErreur>();
      expect(erreur.erreur.code, dateSession).toBe('validation');
      expect(erreur.erreur.champs, dateSession).toHaveProperty('dateSession');
    }
  });

  it('refuse une date qui respecte la FORME mais n’existe pas au calendrier', async () => {
    // `2026-02-30` passe la regex et n'a jamais eu lieu : la session s'y
    // rattacherait à un jour inexistant, et le relevé AFSCA correspondant ne
    // se défendrait pas devant un inspecteur. Ce cas discrimine une garde
    // purement syntaxique d'une garde réellement calendaire.
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { lieuId, dateSession: '2026-02-30' },
    });
    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.champs).toHaveProperty('dateSession');
  });

  it('crée normalement la session dès que la date est bien formée', async () => {
    // Discrimine : sans ce cas, le refus ci-dessus pourrait venir du lieu ou
    // d'une route globalement cassée. Le NUMÉRO doit porter l'année réelle,
    // jamais `NaN`.
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { lieuId, dateSession: '2026-05-17' },
    });
    expect(reponse.statusCode).toBe(201);
    const corps = reponse.json<SessionDetail>();
    expect(corps.numero).toContain('2026');
    expect(corps.numero).not.toContain('NaN');
  });

  it('refuse une année illisible sur /api/seuils, en 422', async () => {
    for (const annee of ['2026abc', '20', 'deux-mille-vingt-six', '-2026', '2026.5']) {
      const reponse = await app.inject({ method: 'GET', url: `/api/seuils?annee=${annee}` });
      expect(reponse.statusCode, annee).toBe(422);
      const erreur = reponse.json<ReponseErreur>();
      expect(erreur.erreur.code, annee).toBe('annee_invalide');
      expect(erreur.erreur.champs, annee).toHaveProperty('annee');
    }
  });

  it('accepte une année à quatre chiffres, et rend les compteurs de seuils', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/seuils?annee=2026' });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<TableauSeuils>();
    expect(corps.meta.annee).toBe(2026);
    // Le tableau doit VENTILER transformé/revendu : à marge égale, la revente
    // génère bien plus de CA, et ce sont les seuils qui portent sur le CA.
    expect(corps.meta).toHaveProperty('caTransformeCents');
    expect(corps.meta).toHaveProperty('caRevenduCents');
    expect(corps.data.length).toBeGreaterThan(0);
  });

  it('accepte l’absence d’année : l’année civile belge en cours', async () => {
    // Discrimine : une garde posée sur « paramètre présent » plutôt que sur
    // son format casserait l'appel par défaut de l'écran.
    const reponse = await app.inject({ method: 'GET', url: '/api/seuils' });
    expect(reponse.statusCode).toBe(200);
  });
});

/**
 * DÉFAUT RÉEL TROUVÉ — non corrigé (code de production hors zone d'écriture).
 *
 * `apps/api/src/routes/sessions.ts`, lignes 100-120, pose un garde-fou de
 * format sur `dateSession` et le justifie ainsi :
 *
 *   « `schemaCreationSession.dateSession` […] n'exige qu'une chaîne non vide,
 *     sans validation de format ».
 *
 * Ce n'est plus vrai. `packages/core/src/contrats/sessions.ts` (lignes
 * 122-125) déclare aujourd'hui :
 *
 *   dateSession: z.string()
 *     .regex(/^\d{4}-\d{2}-\d{2}$/, …)
 *     .refine(estJourCivilValide, …)
 *
 * — une garde STRICTEMENT plus forte que celle de la route (même expression
 * régulière, plus le contrôle calendaire). Aucune valeur ne peut donc encore
 * atteindre le `throw new ErreurMetier('date_session_invalide', …)` : il est
 * inatteignable, et les tests ci-dessus le prouvent (le code rendu est
 * `validation`, jamais `date_session_invalide`).
 *
 * Conséquence : les lignes 110-119 de `routes/sessions.ts` sont du code mort,
 * et un commentaire y affirme le contraire de ce que fait le contrat. Ce qu'il
 * faut trancher hors de cette mission : supprimer le garde-fou devenu inutile
 * (la règle a un foyer unique, le contrat), ou corriger le commentaire s'il
 * doit rester comme filet. Les deux sont défendables ; laisser un commentaire
 * faux ne l'est pas.
 */
