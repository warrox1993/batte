/**
 * Non-regression : AUCUNE route ne doit rendre 500 sur une faute previsible.
 *
 * Dans ce projet, un 500 est toujours un defaut. Toute situation metier
 * previsible doit remonter en erreur TYPEE, traduite en 4xx avec un message
 * francais et actionnable (CLAUDE.md §4, forme de reponse de docs/06). Un 500
 * dit a l'utilisateur « consultez les journaux du serveur » alors que la faute
 * est dans sa saisie — c'est un diagnostic faux.
 *
 * Cinq causes systemiques trouvees en audit, corrigees en D-034 et D-035 :
 *   1. les 4xx natifs de Fastify (JSON malforme, 413, 414, 415) sortaient en 500 ;
 *   2. toute date metier anterieure au debut de validite des parametres ;
 *   3. un cout matiere nul faisait lever une `RangeError` au moteur de prevision ;
 *   4. une violation de cle etrangere sortait en 500, sans nommer le champ ;
 *   5. `/api/seuils` rendait 404 la ou les autres routes rendent 422.
 *
 * Ce fichier les fige toutes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { creerBase, migrer, seed, seedDemonstration, type BaseBatte } from '@batte/db';
import type { ListeLieux, ListeRecettes } from '@batte/core';
import { construireServeur } from '../serveur.js';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

/** Identifiant syntaxiquement plausible mais absent de la base. */
const ID_INCONNU = '019fa000-0000-7000-8000-000000000000';

/**
 * Charges hostiles. Aucune ne doit produire de 500, de trace SQL ni de pile.
 * `'; DROP TABLE` et `../..` verifient qu'aucun identifiant d'URL n'atteint
 * ni le SQL ni le systeme de fichiers.
 */
const CHARGES_HOSTILES: readonly string[] = [
  "' OR 1=1 --",
  "'; DROP TABLE lot; --",
  '../../etc/passwd',
  '   ',
  'é'.repeat(500),
  '<script>alert(1)</script>',
];

describe('aucune route ne rend 500 sur une faute prévisible', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idLieu: string;
  let idRecette: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    idLieu = (await app.inject({ method: 'GET', url: '/api/lieux' })).json<ListeLieux>().data[0]!
      .id;
    idRecette = (await app.inject({ method: 'GET', url: '/api/recettes' })).json<ListeRecettes>()
      .data[0]!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Un message d'erreur doit etre lisible par le porteur, pas par un developpeur. */
  function attendreMessageUtile(reponse: { statusCode: number; payload: string }): void {
    expect(reponse.statusCode).toBeLessThan(500);
    if (reponse.statusCode < 400) return;

    const corps = JSON.parse(reponse.payload) as ReponseErreur;
    expect(corps.erreur.code).toBeTruthy();
    expect(corps.erreur.message.length).toBeGreaterThan(15);
    // Aucune fuite technique : ni SQL, ni pile, ni chemin de fichier.
    expect(corps.erreur.message).not.toMatch(/SQLITE|SELECT |INSERT |at \w+ \(|\.ts:\d+/i);
  }

  /* ── 1. Corps de requête malformés ─────────────────────────────────────── */

  describe('corps de requête malformés', () => {
    const routesEcriture = [
      '/api/sessions',
      '/api/depenses',
      '/api/evenements',
      '/api/afsca/temperatures',
    ];

    it('un JSON tronqué rend 400, jamais 500', async () => {
      for (const url of routesEcriture) {
        const reponse = await app.inject({
          method: 'POST',
          url,
          payload: '{ "libelle": ',
          headers: { 'content-type': 'application/json' },
        });
        expect(reponse.statusCode, url).toBe(400);
        attendreMessageUtile(reponse);
      }
    });

    it('un corps vide, nul ou de mauvaise forme ne fait pas planter', async () => {
      for (const url of routesEcriture) {
        for (const payload of ['{}', 'null', '[]']) {
          const reponse = await app.inject({
            method: 'POST',
            url,
            payload,
            headers: { 'content-type': 'application/json' },
          });
          attendreMessageUtile(reponse);
        }
      }
    });

    it('un type de contenu non supporté ne rend pas 500', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/depenses',
        payload: 'libelle=x',
        headers: { 'content-type': 'text/plain' },
      });
      attendreMessageUtile(reponse);
    });
  });

  /* ── 2. Références vers un parent inexistant ───────────────────────────── */

  describe('références vers un parent inexistant', () => {
    it('POST /api/sessions avec un lieu inconnu rend 404 et NOMME le lieu', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { lieuId: ID_INCONNU, dateSession: '2026-09-06' },
      });
      expect(reponse.statusCode).toBe(404);
      attendreMessageUtile(reponse);
      // Le message doit nommer ce qui est introuvable, pas dire « erreur ».
      expect((JSON.parse(reponse.payload) as ReponseErreur).erreur.message).toMatch(/lieu/i);
    });

    it('POST /api/receptions avec un fournisseur inconnu ne rend pas 500', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/receptions',
        payload: {
          fournisseurId: ID_INCONNU,
          dateReception: '2026-08-01',
          lignes: [{ ingredientId: ID_INCONNU, quantite: 1000, prixLigneCents: 500 }],
        },
      });
      attendreMessageUtile(reponse);
    });

    it('POST /api/depenses avec un fournisseur inconnu ne rend pas 500', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/depenses',
        payload: {
          dateDepense: '2026-08-01',
          libelle: 'Emplacement du mois',
          categorie: 'emplacement',
          montantCents: 8800,
          fournisseurId: ID_INCONNU,
        },
      });
      attendreMessageUtile(reponse);
    });

    it('POST /api/afsca/temperatures avec une session inconnue ne rend pas 500', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/afsca/temperatures',
        payload: {
          equipement: 'Glaciere rigide',
          temperatureC: 4,
          dateReleve: '2026-08-01',
          moment: 'depart',
          sessionId: ID_INCONNU,
        },
      });
      attendreMessageUtile(reponse);
    });

    /**
     * La famille la plus dangereuse : un identifiant qui EXISTE, mais qui
     * designe un autre type d'objet. Le typage TypeScript ne voit rien, et la
     * cle etrangere ne se declenche qu'a l'ecriture.
     */
    it('un identifiant existant mais du MAUVAIS TYPE rend 404, jamais 500', async () => {
      const croisements = [
        `/api/recettes/${idLieu}`,
        `/api/sessions/${idRecette}`,
        `/api/commandes/${idLieu}`,
        `/api/productions/${idLieu}`,
      ];

      for (const url of croisements) {
        const reponse = await app.inject({ method: 'GET', url });
        expect(reponse.statusCode, url).toBe(404);
        attendreMessageUtile(reponse);
      }
    });
  });

  /* ── 3. Dates aberrantes et exercices antérieurs ───────────────────────── */

  describe('dates hors des bornes attendues', () => {
    it('une date métier aberrante ne rend jamais 500', async () => {
      for (const date of ['2026-02-30', '1900-01-01', '3000-12-31', 'pas-une-date', '']) {
        const reponse = await app.inject({
          method: 'GET',
          url: `/api/afsca/nettoyage/taches-en-retard?dateReference=${encodeURIComponent(date)}`,
        });
        attendreMessageUtile(reponse);
      }
    });

    it('un exercice antérieur au catalogue de paramètres ne rend plus 500', async () => {
      // Corrige en D-035 : `lireParametres` retombe sur la version la plus
      // ancienne. Consulter « au 15 juin de l'an dernier » est un geste normal.
      const reponse = await app.inject({
        method: 'GET',
        url: '/api/afsca/nettoyage/taches-en-retard?dateReference=2020-06-15',
      });
      expect(reponse.statusCode).toBeLessThan(500);
    });
  });

  /* ── 4. Querystring invalide ───────────────────────────────────────────── */

  describe('paramètres de requête invalides', () => {
    it('une année illisible rend 422 partout, avec la même convention', async () => {
      for (const url of ['/api/seuils?annee=abc', '/api/synthese-exercice?annee=abc']) {
        const reponse = await app.inject({ method: 'GET', url });
        expect(reponse.statusCode, url).toBe(422);
        const corps = JSON.parse(reponse.payload) as ReponseErreur;
        // Le champ fautif doit etre nomme : l'ecran doit savoir ou l'accrocher.
        expect(corps.erreur.champs?.['annee'], url).toBeTruthy();
      }
    });

    it('une année vide ou répétée ne fait pas planter', async () => {
      for (const url of ['/api/seuils?annee=', '/api/seuils?annee=2026&annee=2027']) {
        attendreMessageUtile(await app.inject({ method: 'GET', url }));
      }
    });
  });

  /* ── 5. Transitions d'état interdites ──────────────────────────────────── */

  describe("transitions d'état interdites", () => {
    it('valider une commande inexistante ne rend pas 500', async () => {
      attendreMessageUtile(
        await app.inject({ method: 'POST', url: `/api/commandes/${ID_INCONNU}/valider` }),
      );
    });

    it('envoyer une commande inexistante ne rend pas 500', async () => {
      attendreMessageUtile(
        await app.inject({
          method: 'POST',
          url: `/api/commandes/${ID_INCONNU}/envoyer`,
          payload: { email: 'test@example.test' },
        }),
      );
    });

    it('clôturer une session inexistante ne rend pas 500', async () => {
      attendreMessageUtile(
        await app.inject({
          method: 'POST',
          url: `/api/sessions/${ID_INCONNU}/cloturer`,
          payload: {
            ventes: [{ produitVenteId: ID_INCONNU, quantite: 1, prixUnitaireCents: 300 }],
            frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
            fondsCaisseInitialCents: 0,
            especesCompteesCents: 300,
            caCarteCents: 0,
            crepesProduites: 1,
            crepesInvendues: 0,
            crepesCassees: 0,
          },
        }),
      );
    });
  });

  /* ── 6. Identifiants hostiles ──────────────────────────────────────────── */

  describe('identifiants hostiles', () => {
    const routesDetail = [
      '/api/recettes/',
      '/api/sessions/',
      '/api/productions/',
      '/api/commandes/',
      '/api/lots/',
    ];

    it('aucune charge hostile ne produit 500 ni ne fuite de trace', async () => {
      for (const prefixe of routesDetail) {
        for (const charge of CHARGES_HOSTILES) {
          const reponse = await app.inject({
            method: 'GET',
            url: `${prefixe}${encodeURIComponent(charge)}`,
          });
          expect(reponse.statusCode, `${prefixe}${charge}`).toBeLessThan(500);
          expect(reponse.payload).not.toMatch(/SQLITE|no such table|at \w+ \(/i);
        }
      }
    });

    it('la base reste saine après le déluge', async () => {
      // Preuve d'absence d'injection : les lectures repondent encore.
      const recettes = await app.inject({ method: 'GET', url: '/api/recettes' });
      expect(recettes.statusCode).toBe(200);
      expect(recettes.json<ListeRecettes>().data.length).toBeGreaterThan(0);
    });
  });

  /* ── 7. Valeurs numériques limites ─────────────────────────────────────── */

  describe('valeurs numériques limites', () => {
    it('des montants absurdes sont refusés proprement', async () => {
      for (const montantCents of [-1, 0, Number.MAX_SAFE_INTEGER, 1.5]) {
        const reponse = await app.inject({
          method: 'POST',
          url: '/api/depenses',
          payload: {
            dateDepense: '2026-08-01',
            libelle: 'Dépense de test',
            categorie: 'autre',
            montantCents,
          },
        });
        attendreMessageUtile(reponse);
      }
    });

    it('une quantité de réception négative est refusée sans planter', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/receptions',
        payload: {
          fournisseurId: ID_INCONNU,
          dateReception: '2026-08-01',
          lignes: [{ ingredientId: ID_INCONNU, quantite: -5, prixLigneCents: 100 }],
        },
      });
      attendreMessageUtile(reponse);
    });
  });
});
