/**
 * Tests HTTP de la route `/api/ia/analyse-ecart/:id` (Lot 9 — assistance
 * Claude).
 *
 * ═══ Le défaut réel corrigé (audit du 30/07/2026) ═══
 *
 * `caTotalCents`, `margeNetteCents` et `ecartCaisseCents` ne sont écrits sur
 * `session_marche` qu'À LA CLÔTURE (`services/sessions.ts`) : avant, ils
 * valent `null` en base. La route n'imposait AUCUN garde sur le statut de la
 * session et rattrapait ces trois `null` par un `?? 0` avant de les envoyer
 * dans le prompt — ce qui aurait fait dire à Claude qu'une session pas encore
 * clôturée affichait un « chiffre d'affaires de 0 € » et un « écart de caisse
 * de 0 € », soit l'inverse exact d'une donnée absente (CLAUDE.md §7, « une
 * valeur inconnue vaut `null`, jamais 0 »).
 *
 * Corrigé en refusant la session non close AVANT tout calcul (même geste que
 * `/documents/rapport-session/:id`, `routes/documents.ts`) : ce test le
 * PROUVE au niveau HTTP, sans jamais appeler l'API Anthropic réelle (aucune
 * clé n'est configurée dans cet environnement de test — `demanderCommentaire`
 * rend alors un refus motivé avant toute tentative réseau, voir
 * `apps/api/src/ia/client.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  annulerSession,
  cloturerSession,
  creerBase,
  creerLieu,
  creerSession,
  migrer,
  produitVente,
  seed,
  seedDemonstration,
  type BaseBatte,
} from '@batte/db';
import { eq } from 'drizzle-orm';
import { enregistrerGestionnaireErreurs, envoyerReponse404 } from '../plugins/erreurs.js';
import { routesIa } from './ia.js';

type ReponseErreur = { erreur: { code: string; message: string } };

/** Saisie de lieu valide, minimale — même patron que les autres fichiers de tests de cette fiche. */
function saisieLieuVierge(surcharges: Record<string, unknown> = {}) {
  return {
    nom: 'Lieu de test',
    adresse: null,
    latitude: null,
    longitude: null,
    jourSemaine: null,
    heureDebut: null,
    heureFin: null,
    tarifEmplacementCents: null,
    modeTarification: null,
    metresLineaires: null,
    distanceKm: null,
    facturationElectricite: null,
    puissanceDisponibleW: null,
    notes: null,
    ...surcharges,
  };
}

describe('route POST /api/ia/analyse-ecart/:id', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let lieuId: string;
  let idCrepe: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base); // fournit un produit transformé à vendre

    idCrepe = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!.id;

    lieuId = creerLieu(base, saisieLieuVierge({ nom: 'Lieu — analyse écart' }));

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app, envoyerReponse404);
    await app.register(routesIa(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuse une session PLANIFIÉE (pas encore close) en 422, sans jamais renvoyer un chiffre inventé', async () => {
    const session = creerSession(base, { lieuId, dateSession: '2026-08-01' });

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/ia/analyse-ecart/${session.id}`,
    });

    // Le défaut réel : ceci répondait 200 avec un commentaire construit sur
    // caTotalCents/margeNetteCents/ecartCaisseCents ramenés à 0 par un `?? 0`.
    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('session_non_cloturee');
    expect(corps.erreur.message).toContain('planifiee');
    // Le message ne doit contenir AUCUN montant halluciné (pas de « 0,00 € »
    // ni de faux chiffre d'affaires) : seulement le statut réel de la session.
    expect(corps.erreur.message).not.toContain('0,00');
  });

  it('refuse une session ANNULÉE (jamais close non plus) en 422', async () => {
    const session = creerSession(base, { lieuId, dateSession: '2026-08-02' });
    annulerSession(base, session.id, 'Marché annulé pour la pluie.');

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/ia/analyse-ecart/${session.id}`,
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('session_non_cloturee');
  });

  it('rend 404 pour une session inexistante (jamais confondu avec le 422 de statut)', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/ia/analyse-ecart/introuvable-0000',
    });
    expect(reponse.statusCode).toBe(404);
  });

  it('accepte une session CLOSE et reste fonctionnelle sans clé Anthropic configurée (mode dégradé, CLAUDE.md §5)', async () => {
    const session = creerSession(base, { lieuId, dateSession: '2026-08-03' });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 3000,
      caCarteCents: 0,
      crepesProduites: 10,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/ia/analyse-ecart/${session.id}`,
    });

    // Aucune clé ANTHROPIC_API_KEY n'est configurée dans cet environnement de
    // test : la route doit rester utilisable (200) et dire honnêtement que
    // l'assistance est indisponible — jamais une exception, jamais un appel
    // réseau réel (CLAUDE.md §5).
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json();
    expect(corps.disponible).toBe(false);
    expect(corps.raison).toContain('ANTHROPIC_API_KEY');
  });
});
