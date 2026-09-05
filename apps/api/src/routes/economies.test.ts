/**
 * Routes `/api/economies` — les refus de la détection et l'export Excel.
 *
 * `depots/economies.test.ts` couvre le calcul ; la COUCHE HTTP, elle, n'avait
 * aucun test. Or c'est elle qui porte trois contrôles qu'aucun dépôt ne fait :
 *
 *  - `prixCandidatCents` doit être un entier de CENTIMES (CLAUDE.md §3
 *    règle 3). `Number.parseInt` est permissif : « 250,5 » ou « abc »
 *    passeraient en `NaN` ou en valeur tronquée jusqu'au calcul d'écart.
 *  - `quantiteUniteRefCandidat` doit être un entier strictement positif : à
 *    zéro, la normalisation au prix unitaire diviserait par zéro.
 *  - le filtre `typeAction` de la liste, jamais emprunté.
 *
 * Plus l'export Excel, seule route de ce plugin qui écrit un document archivé.
 *
 * La détection elle-même n'est PAS refaite ici (elle l'est au dépôt) : ce
 * fichier vérifie ce que la route ajoute, et rien d'autre.
 */

import { creerBase, migrer, seed, seedDemonstration, type BaseBatte } from '@batte/db';
import type {
  DetectionEconomieContrat,
  EconomieLigneContrat,
  ListeEconomiesContrat,
  ListeFournisseurs,
  ListeIngredients,
} from '@batte/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { construireServeur } from '../serveur.js';

type ReponseErreur = { erreur: { code: string; message: string; champs?: Record<string, string> } };

describe('routes /api/economies', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let ingredientId: string;
  let fournisseurId: string;
  const ANNEE = 2026;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    const ingredients = (
      await app.inject({ method: 'GET', url: '/api/ingredients' })
    ).json<ListeIngredients>();
    const fournisseurs = (
      await app.inject({ method: 'GET', url: '/api/fournisseurs' })
    ).json<ListeFournisseurs>();
    const ing = ingredients.data[0];
    const four = fournisseurs.data.find((f) => f.type !== 'systeme');
    if (ing === undefined || four === undefined) {
      throw new Error('Le référentiel de démonstration ne fournit pas de quoi détecter.');
    }
    ingredientId = ing.id;
    fournisseurId = four.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /* ── /economies/detecter ──────────────────────────────────────────────── */

  function urlDetection(params: Record<string, string>): string {
    return `/api/economies/detecter?${new URLSearchParams(params).toString()}`;
  }

  it('refuse une détection sans les trois paramètres obligatoires, et NOMME chacun', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/economies/detecter' });
    expect(reponse.statusCode).toBe(422);
    const erreur = reponse.json<ReponseErreur>();
    expect(erreur.erreur.code).toBe('parametres_detection_manquants');
    // Les trois d'un coup, pas seulement le premier : l'écran doit pouvoir
    // accrocher un message sous chaque champ en une seule soumission.
    expect(Object.keys(erreur.erreur.champs ?? {}).sort()).toEqual([
      'fournisseurId',
      'ingredientId',
      'prixCandidatCents',
    ]);
  });

  it('refuse un prix candidat non entier', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: urlDetection({ ingredientId, fournisseurId, prixCandidatCents: 'pas-un-nombre' }),
    });
    expect(reponse.statusCode).toBe(422);
    const erreur = reponse.json<ReponseErreur>();
    expect(erreur.erreur.code).toBe('prix_candidat_invalide');
    expect(erreur.erreur.champs).toHaveProperty('prixCandidatCents');
  });

  /**
   * RÈGLE À DEUX FOYERS — constaté par mutation, signalé, non corrigé.
   *
   * `quantite_candidate_invalide` est levée par DEUX endroits, avec le même
   * code et le même nom de champ : la route (`routes/economies.ts`, ligne 158)
   * et le dépôt (`depots/economies.ts`, lignes 371-380). Neutraliser l'une des
   * deux ne change donc RIEN au code d'erreur observé, et un test qui ne
   * regarderait que ce code serait aveugle à la disparition de l'une d'elles.
   *
   * Seul le message porté par `champs` diffère entre les deux foyers. Ces
   * tests s'y accrochent DÉLIBÉRÉMENT — non pour figer une formulation, mais
   * parce que c'est le seul signal observable qui dit LEQUEL des deux a
   * refusé. Si l'un des deux messages change, ce test doit être relu : c'est
   * précisément le moment où deux copies d'une même règle commencent à
   * diverger (le dépôt en a déjà fait l'expérience, voir l'en-tête de
   * `depots/fournisseur-systeme.ts`).
   */
  const MESSAGE_ROUTE = 'Doit être un entier strictement positif.';

  it('refuse une contenance candidate à zéro — elle sert de DIVISEUR', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: urlDetection({
        ingredientId,
        fournisseurId,
        prixCandidatCents: '2000',
        quantiteUniteRefCandidat: '0',
      }),
    });
    expect(reponse.statusCode).toBe(422);
    const erreur = reponse.json<ReponseErreur>();
    expect(erreur.erreur.code).toBe('quantite_candidate_invalide');
    expect(erreur.erreur.champs?.['quantiteUniteRefCandidat']).toBe(MESSAGE_ROUTE);
  });

  it('refuse une contenance candidate négative', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: urlDetection({
        ingredientId,
        fournisseurId,
        prixCandidatCents: '2000',
        quantiteUniteRefCandidat: '-25000',
      }),
    });
    expect(reponse.statusCode).toBe(422);
    const erreur = reponse.json<ReponseErreur>();
    expect(erreur.erreur.code).toBe('quantite_candidate_invalide');
    expect(erreur.erreur.champs?.['quantiteUniteRefCandidat']).toBe(MESSAGE_ROUTE);
  });

  it('refuse une contenance candidate non numérique', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: urlDetection({
        ingredientId,
        fournisseurId,
        prixCandidatCents: '2000',
        quantiteUniteRefCandidat: 'vingt-cinq-kilos',
      }),
    });
    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('quantite_candidate_invalide');
  });

  it('accepte une détection complète, avec ET sans contenance candidate', async () => {
    // Discrimine : sans ces deux cas passants, les quatre refus ci-dessus
    // pourraient venir d'une route globalement cassée.
    const sansContenance = await app.inject({
      method: 'GET',
      url: urlDetection({ ingredientId, fournisseurId, prixCandidatCents: '2000' }),
    });
    expect(sansContenance.statusCode).toBe(200);

    const avecContenance = await app.inject({
      method: 'GET',
      url: urlDetection({
        ingredientId,
        fournisseurId,
        prixCandidatCents: '2000',
        quantiteUniteRefCandidat: '25000',
      }),
    });
    expect(avecContenance.statusCode).toBe(200);
    const corps = avecContenance.json<DetectionEconomieContrat>();

    // DÉFAUT CORRIGÉ : ces assertions vivaient sous `if (corps
    // .prixReferenceCents === null)`, une branche MORTE sur cette fixture — le
    // référentiel de démonstration porte toujours un conditionnement actif
    // pour ce couple, donc la référence est TOUJOURS connue. Les deux seules
    // assertions vivantes du test étaient alors les deux `statusCode === 200`.
    // La référence étant connue, c'est le cas RENSEIGNÉ qu'il faut asserter.
    expect(corps.prixReferenceCents).not.toBeNull();
    expect(corps.economieUnitaireCents).not.toBeNull();
  });

  /**
   * D-044 ÉPINGLÉE, et c'est tout l'objet de ce test : `prixReferenceCents`
   * est un TAUX ramené à l'unité de référence de l'ingrédient
   * (`prixCents / quantiteUniteRef`), donc légitimement FRACTIONNAIRE. D-044 :
   * « c'est un taux, il a le droit d'être fractionnaire TANT QU'IL N'EST PAS
   * PERSISTÉ » — et `detecterEconomiePotentielle` n'écrit rien, elle PROPOSE
   * un écart avant saisie.
   *
   * Ce test existe parce que le suffixe `…Cents` invite à « corriger » ce
   * champ en `z.int()` au nom de CLAUDE.md §3 règle 3. Mutation jouée : ce
   * durcissement fait répondre **422** à la route sur le cas nominal
   * ci-dessus — comparer deux contenances différentes cesse purement et
   * simplement de fonctionner. La règle §3 porte sur ce qui est STOCKÉ ; ici
   * rien ne l'est. Si ce test tombe un jour, relire D-044 AVANT de toucher au
   * contrat.
   */
  it('sert un taux FRACTIONNAIRE normalisé à l’unité de référence (D-044), jamais un entier arrondi', async () => {
    // Capture indépendante DÉRIVÉE de la source de vérité (D-045), jamais un
    // littéral recopié : le taux le plus bas actuellement ACTIF chez ce
    // fournisseur pour cet ingrédient.
    const { listerConditionnements } = await import('@batte/db');
    const actifs = listerConditionnements(base, ingredientId).filter(
      (c) => c.actif && c.fournisseurId === fournisseurId,
    );
    expect(actifs.length).toBeGreaterThan(0);
    const tauxAttendu = Math.min(...actifs.map((c) => c.prixCents / c.quantiteUniteRef));

    const reponse = await app.inject({
      method: 'GET',
      url: urlDetection({
        ingredientId,
        fournisseurId,
        prixCandidatCents: '2000',
        quantiteUniteRefCandidat: '25000',
      }),
    });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<DetectionEconomieContrat>();

    expect(corps.prixReferenceCents).toBeCloseTo(tauxAttendu, 9);
    // Le cœur du test : la valeur servie n'est PAS un entier, et doit rester
    // servie telle quelle. Un contrat durci en `z.int()` la rejette en 422.
    expect(Number.isInteger(corps.prixReferenceCents)).toBe(false);
  });

  /* ── liste, filtre et export ──────────────────────────────────────────── */

  it('filtre la liste par typeAction', async () => {
    const creation = await app.inject({
      method: 'POST',
      url: '/api/economies',
      payload: {
        dateAction: `${ANNEE}-04-10`,
        ingredientId,
        fournisseurId,
        conditionnementId: null,
        typeAction: 'remplacement_stock_immobilise',
        description: 'Remplacement par du stock proche DLC',
        prixUnitaireAvantCents: 100,
        prixUnitaireApresCents: 60,
        quantiteConcernee: 1000,
        commandeId: null,
        saisiPar: null,
      },
    });
    expect(creation.statusCode).toBe(201);
    const creee = creation.json<EconomieLigneContrat>();
    expect(creee.economieCents).toBe(40 * 1000);

    const filtree = await app.inject({
      method: 'GET',
      url: `/api/economies?annee=${ANNEE}&typeAction=remplacement_stock_immobilise`,
    });
    expect(filtree.statusCode).toBe(200);
    const liste = filtree.json<ListeEconomiesContrat>();
    expect(liste.data.length).toBeGreaterThan(0);
    for (const ligne of liste.data) {
      expect(ligne.typeAction).toBe('remplacement_stock_immobilise');
    }

    // Discrimine : un filtre inopérant rendrait la même liste pour un autre
    // type — ici, la ligne créée ne doit PAS y figurer.
    const autre = await app.inject({
      method: 'GET',
      url: `/api/economies?annee=${ANNEE}&typeAction=negociation_prix`,
    });
    expect(
      autre.json<ListeEconomiesContrat>().data.some((l: EconomieLigneContrat) => l.id === creee.id),
    ).toBe(false);
  });

  it('exporte le suivi des économies en Excel, avec un nom de fichier daté', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: `/api/exports/economies?annee=${ANNEE}`,
    });
    expect(reponse.statusCode).toBe(200);
    // Un classeur Excel réel commence par la signature ZIP « PK ».
    expect(reponse.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(reponse.rawPayload.length).toBeGreaterThan(1000);
    expect(reponse.headers['content-disposition']).toContain(String(ANNEE));
  });
});
