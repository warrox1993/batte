/**
 * Tests HTTP des routes `/api/evenements-decouverte/*` (fiche
 * `docs/demandes/05-EVENEMENTS-DECOUVERTE-IA-RAYON-REGLABLE.md`).
 *
 * Fichier DÉDIÉ plutôt qu'ajouté à `integration.test.ts` : ce dernier est
 * verrouillé pour cet agent (même convention que `concurrents.test.ts`,
 * fiche 08). Ce fichier construit sa PROPRE instance Fastify minimale, avec
 * le même gestionnaire d'erreurs que le vrai serveur.
 *
 * ═══ Deux familles de tests ═══
 *
 * 1. Les routes HTTP, avec une source de propositions FACTICE injectée —
 *    aucun appel réseau réel n'est fait ici : ce n'est pas le rôle de ces
 *    tests de vérifier l'intégration Claude, seulement le contrat HTTP, la
 *    persistance et le mode dégradé au niveau de la ROUTE.
 * 2. `rechercherEvenementsParClaude` elle-même (l'implémentation par
 *    défaut), éprouvée SANS jamais appeler l'API Anthropic — même recette que
 *    `apps/api/src/ia/client.test.ts` : mode dégradé sans clé, panne réseau
 *    reproduite via un port mort local, plafond à zéro, aucune fuite de la
 *    clé dans la raison renvoyée. Un test supplémentaire fait tourner un
 *    SERVEUR HTTP LOCAL qui IMITE la forme d'une réponse `messages.create` —
 *    jamais l'API Anthropic réelle — pour prouver que le plafond est
 *    revérifié avant CHAQUE relance `pause_turn`, pas seulement avant le
 *    premier appel (voir « plafond et relance `pause_turn` » plus bas).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createServer, type Server } from 'node:http';
import { CATALOGUE_PARAMETRES, Parametres, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, lieuMarche, listerAppelsIa, migrer, seed, type BaseBatte } from '@batte/db';
import { enregistrerGestionnaireErreurs, envoyerReponse404 } from '../plugins/erreurs.js';
import {
  rechercherEvenementsParClaude,
  routesEvenementsDecouverte,
  type ResultatBrutRechercheIa,
  type SourcePropositionsEvenements,
} from './evenements-decouverte.js';
import {
  schemaListeLieuxPourRechercheEvenements,
  schemaListePropositionsEvenements,
  schemaPropositionEvenement,
  schemaResultatRechercheEvenements,
  type PropositionEvenementIaBrute,
} from '@batte/core';

/** Une proposition brute plausible, déjà conforme au contrat Zod. */
function propositionBrute(
  surcharges: Partial<PropositionEvenementIaBrute> = {},
): PropositionEvenementIaBrute {
  return {
    nom: 'Braderie de Herstal',
    type: 'festival',
    dateDebut: '2026-08-15',
    dateFin: '2026-08-16',
    communeTexte: 'Herstal',
    distanceEstimeeKm: 5,
    portee: 'quartier',
    intensiteEstimee: 3,
    source: 'https://exemple.be/braderie-herstal',
    resume: 'Braderie annuelle, forte affluence attendue.',
    ...surcharges,
  };
}

function sourceFactice(
  resultat: ResultatBrutRechercheIa = {
    disponible: true,
    propositions: [propositionBrute()],
    coutCents: 12,
  },
): SourcePropositionsEvenements {
  return async () => resultat;
}

describe('routes /api/evenements-decouverte', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idLieu: string;

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    idLieu = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte',
        actif: true,
        rayonRechercheEvenementsKm: 20,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app, envoyerReponse404);
    await app.register(routesEvenementsDecouverte(base, { sourcePropositions: sourceFactice() }), {
      prefix: '/api',
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('lieux', () => {
    it('GET /evenements-decouverte/lieux liste les lieux actifs avec leur rayon', async () => {
      const reponse = await app.inject({ method: 'GET', url: '/api/evenements-decouverte/lieux' });
      expect(reponse.statusCode).toBe(200);
      const corps = schemaListeLieuxPourRechercheEvenements.parse(reponse.json());
      expect(corps.data).toHaveLength(1);
      expect(corps.data[0]).toEqual({
        id: idLieu,
        nom: 'La Batte',
        rayonRechercheEvenementsKm: 20,
      });
    });

    it('PATCH .../rayon-recherche modifie le rayon d’UN lieu', async () => {
      const reponse = await app.inject({
        method: 'PATCH',
        url: `/api/evenements-decouverte/lieux/${idLieu}/rayon-recherche`,
        payload: { rayonRechercheEvenementsKm: 100 },
      });
      expect(reponse.statusCode).toBe(200);
      expect(reponse.json()).toMatchObject({ rayonRechercheEvenementsKm: 100 });
    });

    it('PATCH .../rayon-recherche refuse une valeur hors domaine (5|10|15|20|40|100)', async () => {
      const reponse = await app.inject({
        method: 'PATCH',
        url: `/api/evenements-decouverte/lieux/${idLieu}/rayon-recherche`,
        payload: { rayonRechercheEvenementsKm: 25 },
      });
      expect(reponse.statusCode).toBe(422);
    });
  });

  describe('recherche — déclenchement manuel (pas de tâche planifiée)', () => {
    it('crée des propositions `en attente` à partir de la source injectée', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/evenements-decouverte/rechercher',
        payload: { lieuId: idLieu },
      });

      expect(reponse.statusCode).toBe(200);
      const corps = schemaResultatRechercheEvenements.parse(reponse.json());
      expect(corps.disponible).toBe(true);
      if (corps.disponible) {
        expect(corps.propositions).toHaveLength(1);
        expect(corps.propositions[0]!.valideParHumain).toBe(false);
        expect(corps.propositions[0]!.source).toBe('ia');
        expect(corps.coutCents).toBe(12);
      }
    });

    it('rend `disponible: false` sans rien persister quand la source est indisponible', async () => {
      await app.close();
      app = Fastify({ logger: false });
      enregistrerGestionnaireErreurs(app, envoyerReponse404);
      await app.register(
        routesEvenementsDecouverte(base, {
          sourcePropositions: sourceFactice({
            disponible: false,
            raison: "Plafond mensuel atteint : pas d'appel ce mois-ci.",
          }),
        }),
        { prefix: '/api' },
      );
      await app.ready();

      const reponse = await app.inject({
        method: 'POST',
        url: '/api/evenements-decouverte/rechercher',
        payload: { lieuId: idLieu },
      });

      expect(reponse.statusCode).toBe(200); // mode dégradé : jamais une erreur HTTP
      const corps = schemaResultatRechercheEvenements.parse(reponse.json());
      expect(corps.disponible).toBe(false);

      const liste = await app.inject({
        method: 'GET',
        url: '/api/evenements-decouverte/propositions',
      });
      expect(schemaListePropositionsEvenements.parse(liste.json()).meta.total).toBe(0);
    });

    it('refuse un lieu inexistant', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/evenements-decouverte/rechercher',
        payload: { lieuId: 'lieu-fantome' },
      });
      expect(reponse.statusCode).toBe(404);
    });
  });

  describe('propositions en attente — triées par rentabilité décroissante', () => {
    it('GET /evenements-decouverte/propositions liste ce qui a été créé', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/evenements-decouverte/rechercher',
        payload: { lieuId: idLieu },
      });

      const reponse = await app.inject({
        method: 'GET',
        url: '/api/evenements-decouverte/propositions',
      });
      expect(reponse.statusCode).toBe(200);
      const corps = schemaListePropositionsEvenements.parse(reponse.json());
      expect(corps.meta.total).toBe(1);
      expect(corps.data[0]!.nom).toBe('Braderie de Herstal');
    });

    it('GET .../nombre-en-attente compte les propositions non traitées', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/evenements-decouverte/rechercher',
        payload: { lieuId: idLieu },
      });
      const reponse = await app.inject({
        method: 'GET',
        url: '/api/evenements-decouverte/propositions/nombre-en-attente',
      });
      expect(reponse.json()).toEqual({ nombre: 1 });
    });
  });

  describe('validation — sans clic, rien n’entre jamais activement en base', () => {
    it('POST .../valider active l’événement (source toujours `ia`)', async () => {
      const recherche = await app.inject({
        method: 'POST',
        url: '/api/evenements-decouverte/rechercher',
        payload: { lieuId: idLieu },
      });
      const id = schemaResultatRechercheEvenements.parse(recherche.json());
      if (!id.disponible) throw new Error('la recherche factice doit réussir');
      const propositionId = id.propositions[0]!.id;

      const reponse = await app.inject({
        method: 'POST',
        url: `/api/evenements-decouverte/propositions/${propositionId}/valider`,
      });
      expect(reponse.statusCode).toBe(200);
      const valide = schemaPropositionEvenement.parse(reponse.json());
      expect(valide.valideParHumain).toBe(true);
      expect(valide.source).toBe('ia');
    });

    it('POST .../valider accepte un ajustement de portée/intensité AVANT validation', async () => {
      const recherche = await app.inject({
        method: 'POST',
        url: '/api/evenements-decouverte/rechercher',
        payload: { lieuId: idLieu },
      });
      const resultat = schemaResultatRechercheEvenements.parse(recherche.json());
      if (!resultat.disponible) throw new Error('la recherche factice doit réussir');
      const propositionId = resultat.propositions[0]!.id;
      const impactAvant = resultat.propositions[0]!.impactEstimeBp;

      const reponse = await app.inject({
        method: 'POST',
        url: `/api/evenements-decouverte/propositions/${propositionId}/valider`,
        payload: { portee: 'national', intensiteEstimee: 1 },
      });
      const valide = schemaPropositionEvenement.parse(reponse.json());
      expect(valide.portee).toBe('national');
      expect(valide.intensiteEstimee).toBe(1);
      // Recalculé, pas conservé tel quel : la valeur doit changer.
      expect(valide.impactEstimeBp).not.toBe(impactAvant);
    });

    it('rend 404 sur un identifiant inconnu', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/evenements-decouverte/propositions/fantome/valider',
      });
      expect(reponse.statusCode).toBe(404);
    });
  });

  describe('rejet — jamais un DELETE', () => {
    it('POST .../rejeter retire la proposition de la liste « en attente », sans la supprimer', async () => {
      const recherche = await app.inject({
        method: 'POST',
        url: '/api/evenements-decouverte/rechercher',
        payload: { lieuId: idLieu },
      });
      const resultat = schemaResultatRechercheEvenements.parse(recherche.json());
      if (!resultat.disponible) throw new Error('la recherche factice doit réussir');
      const propositionId = resultat.propositions[0]!.id;

      const rejet = await app.inject({
        method: 'POST',
        url: `/api/evenements-decouverte/propositions/${propositionId}/rejeter`,
      });
      expect(rejet.statusCode).toBe(204);

      const liste = await app.inject({
        method: 'GET',
        url: '/api/evenements-decouverte/propositions',
      });
      expect(schemaListePropositionsEvenements.parse(liste.json()).meta.total).toBe(0);
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   `rechercherEvenementsParClaude` — mode dégradé, SANS appel réseau réel
   ═══════════════════════════════════════════════════════════════════════════ */

describe('rechercherEvenementsParClaude (implémentation par défaut)', () => {
  let base: BaseBatte;
  const envInitial: Record<string, string | undefined> = {};

  function definir(cle: string, valeur: string | undefined): void {
    if (!(cle in envInitial)) envInitial[cle] = process.env[cle];
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }

  const SENTINELLE_CLE = 'sk-ant-api03-SENTINELLE0CLIENT0NE0DOIT0JAMAIS0SORTIR';
  const BASE_URL_MORTE = 'http://127.0.0.1:1';
  const MOTIFS_INTERDITS: readonly RegExp[] = [
    /sk-ant-[A-Za-z0-9_-]{6,}/,
    /SENTINELLE0/,
    /node_modules/i,
  ];

  function attendreAucuneFuite(texte: string): void {
    for (const motif of MOTIFS_INTERDITS) expect(texte).not.toMatch(motif);
  }

  function parametresAvec(surcharges: Record<string, string> = {}): Parametres {
    return Parametres.depuisLignes(
      CATALOGUE_PARAMETRES.map((d) => ({
        cle: d.cle,
        valeur: surcharges[d.cle] ?? d.valeurDefaut,
      })),
    );
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    definir('ANTHROPIC_API_KEY', undefined);
    definir('ANTHROPIC_BASE_URL', undefined);
  });

  afterEach(() => {
    for (const [cle, valeur] of Object.entries(envInitial)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
  });

  it('sans clé configurée : refus motivé, aucune exception, rien journalisé', async () => {
    const resultat = await rechercherEvenementsParClaude(base, parametresAvec(), {
      lieuNom: 'La Batte',
      rayonKm: 20,
    });
    expect(resultat.disponible).toBe(false);
    if (!resultat.disponible) {
      expect(resultat.raison).toContain('ANTHROPIC_API_KEY');
      attendreAucuneFuite(resultat.raison);
    }
    expect(listerAppelsIa(base)).toHaveLength(0);
  });

  it('plafond à zéro : coupé avant toute tentative réseau, bien qu’une clé soit configurée', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);
    definir('ANTHROPIC_BASE_URL', BASE_URL_MORTE);

    const resultat = await rechercherEvenementsParClaude(
      base,
      parametresAvec({ plafond_ia_mensuel_cents: '0' }),
      { lieuNom: 'La Batte', rayonKm: 20 },
    );
    expect(resultat.disponible).toBe(false);
    if (!resultat.disponible) {
      expect(resultat.raison).toContain('désactivée');
      attendreAucuneFuite(resultat.raison);
    }
    expect(listerAppelsIa(base)).toHaveLength(0);
  });

  it('panne réseau (port mort local) : refus motivé, journalisé, sans fuite de la clé', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);
    definir('ANTHROPIC_BASE_URL', BASE_URL_MORTE);

    const resultat = await rechercherEvenementsParClaude(base, parametresAvec(), {
      lieuNom: 'La Batte',
      rayonKm: 20,
    });
    expect(resultat.disponible).toBe(false);
    if (!resultat.disponible) {
      expect(resultat.raison).toContain('injoignable');
      attendreAucuneFuite(resultat.raison);
    }

    const appels = listerAppelsIa(base);
    expect(appels).toHaveLength(1);
    expect(appels[0]!.usage).toBe('evenements');
    if (appels[0]!.erreur !== null) attendreAucuneFuite(appels[0]!.erreur);
  }, 15_000);

  /* ═══════════════════════════════════════════════════════════════════════
     Plafond et relance `pause_turn` — audit IA (jamais l'API Anthropic réelle)
     ═══════════════════════════════════════════════════════════════════════

     Défaut trouvé à l'audit : le plafond n'était vérifié qu'UNE FOIS, avant
     le tout premier appel réseau. Or `pause_turn` (limite serveur de
     recherches par tour) fait relancer jusqu'à `NB_TOURS_MAX` appels
     supplémentaires, chacun rejouant toute la conversation et pouvant coûter
     jusqu'à `ia_tokens_sortie_max` en sortie — un plafond vérifié une seule
     fois, avant le premier appel, ne majore le coût que de CET appel, jamais
     celui d'une relance qui en enchaîne plusieurs. Corrigé en revérifiant le
     plafond avant CHAQUE tour, sur le coût déjà RÉELLEMENT engagé plus le
     coût maximal du prochain tour.

     Ce test le PROUVE avec un serveur HTTP local qui IMITE la forme d'une
     réponse `messages.create` — jamais l'API Anthropic réelle, conformément
     à l'interdiction absolue de ce chantier. */

  /**
   * Petit serveur HTTP local qui rend, requête après requête, la réponse
   * suivante de `reponses` (la dernière est répétée si le tableau est
   * épuisé). Sert uniquement à observer COMBIEN de requêtes ont été émises —
   * jamais à simuler un comportement métier de l'API Anthropic.
   */
  function demarrerServeurAnthropicFactice(
    reponses: readonly Record<string, unknown>[],
  ): Promise<{ url: string; nbRequetes: () => number; fermer: () => Promise<void> }> {
    return new Promise((resolve) => {
      let nb = 0;
      const serveur: Server = createServer((requete, reponse) => {
        const morceaux: Buffer[] = [];
        requete.on('data', (m: Buffer) => morceaux.push(m));
        requete.on('end', () => {
          const corps = reponses[nb] ?? reponses[reponses.length - 1];
          nb += 1;
          reponse.writeHead(200, { 'content-type': 'application/json' });
          reponse.end(JSON.stringify(corps));
        });
      });
      serveur.listen(0, '127.0.0.1', () => {
        const adresse = serveur.address();
        const port = typeof adresse === 'object' && adresse !== null ? adresse.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}`,
          nbRequetes: () => nb,
          fermer: () => new Promise((r) => serveur.close(() => r())),
        });
      });
    });
  }

  /** Une réponse `messages.create` minimale, avec le `usage` et le contenu voulus. */
  function reponseFactice(surcharges: {
    readonly texte: string;
    readonly stopReason: 'pause_turn' | 'end_turn';
    readonly tokensEntree: number;
    readonly tokensSortie: number;
    /**
     * Recherches web RÉELLEMENT exécutées ce tour, telles que rendues par
     * l'API dans `usage.server_tool_use.web_search_requests` — absent quand
     * le tour n'a utilisé aucun outil serveur (comportement réel de l'API).
     */
    readonly nbRecherchesWeb?: number;
  }): Record<string, unknown> {
    return {
      id: 'msg_audit_ia_factice',
      type: 'message',
      role: 'assistant',
      model: 'modele-de-test',
      content: [{ type: 'text', text: surcharges.texte }],
      stop_reason: surcharges.stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: surcharges.tokensEntree,
        output_tokens: surcharges.tokensSortie,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        ...(surcharges.nbRecherchesWeb === undefined
          ? {}
          : {
              server_tool_use: {
                web_search_requests: surcharges.nbRecherchesWeb,
                web_fetch_requests: 0,
              },
            }),
      },
    };
  }

  it('une relance `pause_turn` qui ferait franchir le plafond est coupée AVANT le second appel réseau', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);

    // Premier tour : `pause_turn`, avec un contenu volumineux (simule des
    // résultats de recherche déjà trouvés) qui, une fois rejoué dans la
    // conversation du tour suivant, fait exploser l'estimation du prochain
    // appel — c'est exactement ce que le correctif doit intercepter.
    const contenuVolumineux = 'x'.repeat(100_000);
    const serveur = await demarrerServeurAnthropicFactice([
      reponseFactice({
        texte: contenuVolumineux,
        stopReason: 'pause_turn',
        tokensEntree: 20,
        tokensSortie: 5,
      }),
      // Ne devrait JAMAIS être servie si le correctif fonctionne : conservée
      // uniquement pour que le test n'attende pas indéfiniment si le
      // correctif régresse.
      reponseFactice({ texte: '[]', stopReason: 'end_turn', tokensEntree: 1, tokensSortie: 1 }),
    ]);
    definir('ANTHROPIC_BASE_URL', serveur.url);

    try {
      const parametres = parametresAvec({
        plafond_ia_mensuel_cents: '50',
        ia_tarif_extraction_entree_cents_par_mtok: '10000',
        ia_tarif_extraction_sortie_cents_par_mtok: '0',
        ia_tokens_sortie_max: '100',
      });

      const resultat = await rechercherEvenementsParClaude(base, parametres, {
        lieuNom: 'La Batte',
        rayonKm: 20,
      });

      expect(resultat.disponible).toBe(false);
      if (!resultat.disponible) {
        expect(resultat.raison).toContain('Plafond mensuel atteint');
        attendreAucuneFuite(resultat.raison);
      }

      // Preuve centrale du correctif : le serveur n'a reçu qu'UNE requête.
      // Sans la revérification par tour, le code relançait un second appel
      // — potentiellement bien plus coûteux — avant de revoir le plafond.
      expect(serveur.nbRequetes()).toBe(1);

      // Ce qui a REELLEMENT été dépensé (tour 1 seul) est journalisé, pas
      // une estimation, et pas zéro : un tour exécuté a un coût réel.
      const appels = listerAppelsIa(base);
      expect(appels).toHaveLength(1);
      expect(appels[0]!.tokensEntree).toBe(20);
      expect(appels[0]!.tokensSortie).toBe(5);
      expect(appels[0]!.coutCents).toBeGreaterThan(0);
      if (appels[0]!.erreur !== null) attendreAucuneFuite(appels[0]!.erreur);
    } finally {
      await serveur.fermer();
    }
  }, 15_000);

  /* ═══════════════════════════════════════════════════════════════════════
     Coût des recherches web — audit IA du 29/07/2026 (ex-`it.fails` dans
     `apps/api/src/audit-ia.test.ts`)

     Anthropic facture l'outil serveur `web_search` SÉPARÉMENT des tokens
     (10 $ / 1000 recherches). Ce test le prouve avec des tokens rendus
     QUASI GRATUITS (tarif nul) : si le plafond n'était sensible qu'aux
     tokens, la recherche entière passerait sans jamais être coupée. Prouver
     que la relance est malgré tout refusée démontre que le coût des
     recherches web, à lui seul, alimente bien la majoration du plafond
     vérifiée avant chaque tour — pas seulement mentionné dans le code
     (`audit-ia.test.ts`), mais RÉELLEMENT pris en compte dans la décision. */
  it('des recherches web réellement exécutées, même à coût de tokens nul, font franchir le plafond', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);

    // Premier tour : `pause_turn`, 5 recherches web réellement exécutées
    // (`MAX_USAGES_RECHERCHE_WEB`), tokens quasi gratuits (tarif nul plus
    // bas) — seul le coût des recherches web peut ici faire franchir le
    // plafond.
    const serveur = await demarrerServeurAnthropicFactice([
      reponseFactice({
        texte: 'résultats de recherche',
        stopReason: 'pause_turn',
        tokensEntree: 10,
        tokensSortie: 5,
        nbRecherchesWeb: 5,
      }),
      // Ne devrait JAMAIS être servie si la revérification par tour compte
      // bien les recherches web : conservée pour ne pas bloquer le test si
      // le correctif régresse.
      reponseFactice({ texte: '[]', stopReason: 'end_turn', tokensEntree: 1, tokensSortie: 1 }),
    ]);
    definir('ANTHROPIC_BASE_URL', serveur.url);

    try {
      const parametres = parametresAvec({
        // Plafond fixé exactement au coût de 5 recherches web à ce tarif :
        // le premier tour passe tout juste (dépense = plafond, jamais >),
        // mais la relance suivante — qui doit encore compter jusqu'à 5
        // recherches web de plus dans sa majoration — le fait franchir.
        plafond_ia_mensuel_cents: '10',
        ia_tarif_extraction_entree_cents_par_mtok: '0',
        ia_tarif_extraction_sortie_cents_par_mtok: '0',
        ia_tokens_sortie_max: '100',
        ia_tarif_recherche_web_cents_par_mille: '2000',
      });

      const resultat = await rechercherEvenementsParClaude(base, parametres, {
        lieuNom: 'La Batte',
        rayonKm: 20,
      });

      expect(resultat.disponible).toBe(false);
      if (!resultat.disponible) {
        expect(resultat.raison).toContain('Plafond mensuel atteint');
        attendreAucuneFuite(resultat.raison);
      }

      // Preuve centrale : un seul appel réseau, alors que les TOKENS seuls
      // (tarif nul) n'auraient jamais coupé la relance — c'est bien le coût
      // des recherches web qui a déclenché le refus.
      expect(serveur.nbRequetes()).toBe(1);

      const appels = listerAppelsIa(base);
      expect(appels).toHaveLength(1);
      // Coût réel journalisé : uniquement les 5 recherches du tour exécuté
      // (10 centimes), les tokens ne coûtant rien à ce tarif.
      expect(appels[0]!.coutCents).toBe(10);
      if (appels[0]!.erreur !== null) attendreAucuneFuite(appels[0]!.erreur);
    } finally {
      await serveur.fermer();
    }
  }, 15_000);

  /* ═══════════════════════════════════════════════════════════════════════
     Défaut trouvé à l'audit du 01/08/2026 : le `catch` de la boucle de
     relance journalisait `coutCents: 0` quoi qu'il arrive, alors que
     `tokensEntree`/`tokensSortie` journalisaient déjà les totaux RÉELLEMENT
     accumulés sur les tours précédents. Un tour 0 réussi (`pause_turn`) qui
     consomme des tokens facturables, suivi d'une panne réseau ou d'une erreur
     fournisseur AU TOUR SUIVANT, faisait donc disparaître une dépense déjà
     engagée : exactement la classe de défaut visée par CLAUDE.md §3
     (« une valeur inconnue vaut `null`, jamais 0 ») — ici appliquée à un coût
     qui n'est même pas inconnu, puisque les tokens qui le déterminent sont
     déjà dans les mêmes `tokensEntree`/`tokensSortie` journalisés juste à
     côté. Corrigé en recalculant `coutCents` avec la MÊME formule que le
     chemin nominal (`coutAppelCents` + `coutRechercheWebCents`) plutôt que de
     l'écraser à zéro. */
  it('une panne survenant APRÈS un premier tour réussi journalise le coût RÉEL déjà engagé, jamais 0', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);

    // Premier tour : réussi, `pause_turn` (relance un second appel), avec des
    // tokens réellement facturables. Deuxième tour : le serveur factice rend
    // un statut d'erreur — imite une panne fournisseur (5xx) APRÈS qu'une
    // dépense réelle a déjà eu lieu, jamais une panne réseau AVANT le premier
    // appel (déjà couverte par le test « panne réseau » ci-dessus).
    const serveur = await new Promise<{
      url: string;
      nbRequetes: () => number;
      fermer: () => Promise<void>;
    }>((resolve) => {
      let nb = 0;
      const httpServeur: Server = createServer((requete, reponse) => {
        const morceaux: Buffer[] = [];
        requete.on('data', (m: Buffer) => morceaux.push(m));
        requete.on('end', () => {
          nb += 1;
          if (nb === 1) {
            reponse.writeHead(200, { 'content-type': 'application/json' });
            reponse.end(
              JSON.stringify(
                reponseFactice({
                  texte: 'résultats partiels du premier tour',
                  stopReason: 'pause_turn',
                  tokensEntree: 40,
                  tokensSortie: 9,
                }),
              ),
            );
            return;
          }
          // Deuxième requête (et suivantes) : panne simulée côté fournisseur,
          // jamais l'API Anthropic réelle.
          reponse.writeHead(500, { 'content-type': 'application/json' });
          reponse.end(
            JSON.stringify({
              type: 'error',
              error: { type: 'api_error', message: 'panne simulée' },
            }),
          );
        });
      });
      httpServeur.listen(0, '127.0.0.1', () => {
        const adresse = httpServeur.address();
        const port = typeof adresse === 'object' && adresse !== null ? adresse.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}`,
          nbRequetes: () => nb,
          fermer: () => new Promise((r) => httpServeur.close(() => r())),
        });
      });
    });
    definir('ANTHROPIC_BASE_URL', serveur.url);

    try {
      const parametres = parametresAvec({
        // Plafond large : jamais coupé par le plafond dans ce test, pour
        // isoler la seule question du coût journalisé sur panne.
        plafond_ia_mensuel_cents: '100000',
        ia_tarif_extraction_entree_cents_par_mtok: '10000',
        ia_tarif_extraction_sortie_cents_par_mtok: '10000',
        ia_tokens_sortie_max: '100',
      });

      const resultat = await rechercherEvenementsParClaude(base, parametres, {
        lieuNom: 'La Batte',
        rayonKm: 20,
      });

      expect(resultat.disponible).toBe(false);
      // Preuve que le premier tour a bien eu lieu (réussi) avant la panne du
      // second : sans ça, ce test ne prouverait rien sur les tours précédents.
      // Au moins 2 requêtes (tour 0 réussi, tour 1 en panne) — le SDK
      // Anthropic réessaie lui-même les statuts 5xx, donc le compte exact
      // dépend de sa politique de nouvelles tentatives, non de ce correctif.
      expect(serveur.nbRequetes()).toBeGreaterThanOrEqual(2);

      const appels = listerAppelsIa(base);
      expect(appels).toHaveLength(1);
      expect(appels[0]!.tokensEntree).toBe(40);
      expect(appels[0]!.tokensSortie).toBe(9);
      // Cœur du défaut corrigé : le premier tour a réellement consommé des
      // tokens facturables ; les journaliser à coût ZÉRO ferait disparaître
      // une dépense réelle du plafond mensuel du mois suivant.
      expect(appels[0]!.coutCents).toBeGreaterThan(0);
      if (appels[0]!.erreur !== null) attendreAucuneFuite(appels[0]!.erreur);
    } finally {
      await serveur.fermer();
    }
  }, 15_000);
});
