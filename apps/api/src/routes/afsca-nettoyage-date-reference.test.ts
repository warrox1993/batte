/**
 * Tests HTTP de `GET /api/afsca/nettoyage/taches-en-retard`, ciblés sur la
 * validation de `dateReference`.
 *
 * ═══ Défaut trouvé à l'audit du 01/08/2026 (CLAUDE.md §4 — Zod à toutes les
 * frontières) ═══
 *
 * Toutes les autres routes de ce fichier qui acceptent une date en chaîne de
 * requête la valident explicitement AVANT usage — `analyserJour`
 * (`routes/audit.ts`), `analyserJourReference` (`routes/objectifs.ts`),
 * `schemaPeriodeRequete.parse(...)` pour `debut`/`fin` (`routes/afsca.ts`
 * lui-même, `/afsca/temperatures`, `/afsca/nettoyage/executions`,
 * `/afsca/non-conformites`). `dateReference`, sur CETTE route, ne l'était
 * PAS : `requete.query.dateReference ?? jourCivilBelge(new Date())` transmet
 * directement la chaîne brute à `tachesEnRetard` (`packages/db/src/services/
 * afsca.ts`), qui l'utilise pour choisir la version en vigueur des paramètres
 * réglementaires (`lireParametres(base, dateReference)`) et pour comparer des
 * dates de session. `audit-robustesse.test.ts` (fichier partagé, hors de la
 * zone d'écriture de cette mission) exerçait déjà `dateReference=3000-12-31`
 * — un format VALIDE mais absurde — sans jamais essayer un format INVALIDE
 * (`abc`, chaîne vide, `2026-13-45`) : le trou était donc invisible à ce
 * balayage précis, qui ne teste que « pas de 500 », pas « la frontière est
 * validée ».
 *
 * Corrigé en réutilisant EXACTEMENT la même convention que les fonctions
 * `analyserJour*` déjà présentes ailleurs dans ce dépôt (regex `AAAA-MM-JJ`,
 * `ErreurMetier` avec `champs`) — jamais une nouvelle règle inventée.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { creerBase, migrer, seed, seedDemonstration, type BaseBatte } from '@batte/db';
import { enregistrerGestionnaireErreurs, envoyerReponse404 } from '../plugins/erreurs.js';
import { routesAfsca } from './afsca.js';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

describe('GET /api/afsca/nettoyage/taches-en-retard — validation de dateReference', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app, envoyerReponse404);
    await app.register(routesAfsca(base), { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sans dateReference : retombe sur aujourd’hui (jour civil belge), 200', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/afsca/nettoyage/taches-en-retard',
    });
    expect(reponse.statusCode).toBe(200);
  });

  it('dateReference au bon format (même absurde dans le futur) : 200, comportement inchangé', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/afsca/nettoyage/taches-en-retard?dateReference=3000-12-31',
    });
    expect(reponse.statusCode).toBe(200);
  });

  it.each(['abc', '', '2026/07/31', "'; DROP TABLE parametre; --"])(
    'dateReference malformée (%j) : 422 avec un message actionnable, jamais un succès silencieux',
    async (valeur) => {
      const reponse = await app.inject({
        method: 'GET',
        url: `/api/afsca/nettoyage/taches-en-retard?dateReference=${encodeURIComponent(valeur)}`,
      });
      expect(reponse.statusCode).toBe(422);
      const corps = JSON.parse(reponse.payload) as ReponseErreur;
      expect(corps.erreur.code).toBe('date_invalide');
      expect(corps.erreur.message).toContain('AAAA-MM-JJ');
      expect(corps.erreur.champs?.['dateReference']).toBeTruthy();
    },
  );

  /**
   * RÉSIDUEL, assumé — même limite déjà documentée dans `audit-robustesse.
   * test.ts` pour `dateSession` (30 février accepté, cf. son commentaire
   * « le correctif ne valide que le FORMAT ») : la regex `AAAA-MM-JJ`
   * garantit la FORME, pas la validité CALENDAIRE. `2026-13-45` la traverse
   * donc sans erreur, exactement comme les fonctions sœurs de ce dépôt
   * (`analyserJour` de `routes/audit.ts`, `analyserJourReference` de
   * `routes/objectifs.ts`) — convention reprise à l'identique, pas une
   * régression introduite ici.
   */
  it('dateReference au bon FORMAT mais calendairement absurde (2026-13-45) : passe, comme les fonctions sœurs de ce dépôt', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/afsca/nettoyage/taches-en-retard?dateReference=2026-13-45',
    });
    expect(reponse.statusCode).toBeLessThan(500);
  });
});
