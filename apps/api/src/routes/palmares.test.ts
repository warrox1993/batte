/**
 * Tests HTTP de `/api/palmares/produits` et `/api/palmares/fournisseurs`.
 *
 * Fichier DÉDIÉ, avec sa PROPRE instance Fastify minimale (`apps/api/src/
 * serveur.ts` est hors de la zone d'écriture de cette mission — même geste
 * que `demarrage.test.ts` et `objectifs.test.ts`).
 *
 * La logique d'agrégation, de tri et de seuil est déjà couverte en
 * profondeur par `packages/core/src/palmares.test.ts` : ce fichier prouve
 * seulement que LA ROUTE relie correctement la requête HTTP aux dépôts
 * existants et compose une réponse qui respecte le contrat — pas la logique
 * de calcul elle-même.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  aujourdHui,
  creerBase,
  enregistrerEconomie,
  listerEconomies,
  listerFournisseurs,
  listerIngredientsComplets,
  migrer,
  seed,
  seedDemonstration,
  seedDemonstrationActivite,
  type BaseBatte,
} from '@batte/db';
import { ajouterJours, fournisseursProposables } from '@batte/core';
import { enregistrerGestionnaireErreurs, envoyerReponse404 } from '../plugins/erreurs.js';
import { routesPalmares } from './palmares.js';

/**
 * Le référentiel de démonstration ne porte AUCUNE économie et AUCUNE facture —
 * dérivé de la source de vérité, pas supposé : aucun fichier de
 * `packages/db/src/seed/` ne référence `economieAchat` ni `schema.facture`.
 *
 * Conséquence, et c'est le défaut que cette fonction répare :
 * `fournisseursActifsSurPeriode` (`packages/core/src/palmares.ts`) écarte toute
 * ligne à zéro économie ET zéro facture. Sur la graine seule, le classement
 * rendu est donc TOUJOURS VIDE — les boucles d'un test qui l'itère ne
 * s'exécutent jamais, et la seule assertion vivante reste `statusCode === 200`.
 * Le module Économies pouvait être entièrement débranché sans faire rougir quoi
 * que ce soit (mutation jouée : `economieParFournisseur.get(f.id) ?? 0`
 * remplacé par le littéral `0`).
 *
 * Trois lignes injectées, choisies pour DISCRIMINER :
 *  - deux fournisseurs DIFFÉRENTS à des montants DIFFÉRENTS — une fixture à un
 *    seul fournisseur, ou à deux montants égaux, ne prouverait pas que chaque
 *    ligne reçoit LA SIENNE plutôt qu'un total global recopié ;
 *  - une troisième économie VOLONTAIREMENT hors de la fenêtre de 365 jours,
 *    sans quoi le filtre de dates de la route n'a rien à exclure et son
 *    éventuelle disparition passerait inaperçue ;
 *  - des montants qui ne tombent pas rond (docs/39 §7).
 */
function injecterEconomiesDeTest(b: BaseBatte): void {
  const ingredientId = listerIngredientsComplets(b)[0]?.id;
  const commerciaux = fournisseursProposables(listerFournisseurs(b));
  const fournisseurA = commerciaux[0]?.id;
  const fournisseurB = commerciaux[1]?.id;
  if (ingredientId === undefined || fournisseurA === undefined || fournisseurB === undefined) {
    throw new Error(
      'Le référentiel de démonstration doit fournir un ingrédient et deux fournisseurs commerciaux.',
    );
  }

  const jour = aujourdHui();
  const commun = { ingredientId, conditionnementId: null, commandeId: null, saisiPar: null };

  // Dans la fenêtre — fournisseur A : (137 - 91) x 7 = 322 c.
  enregistrerEconomie(b, {
    ...commun,
    dateAction: ajouterJours(jour, -30),
    fournisseurId: fournisseurA,
    typeAction: 'negociation_prix',
    description: 'Renégociation récente chez A (fixture de test).',
    prixUnitaireAvantCents: 137,
    prixUnitaireApresCents: 91,
    quantiteConcernee: 7,
  });

  // Dans la fenêtre — fournisseur B : (211 - 158) x 3 = 159 c, DIFFÉRENT de A.
  enregistrerEconomie(b, {
    ...commun,
    dateAction: ajouterJours(jour, -120),
    fournisseurId: fournisseurB,
    typeAction: 'achat_alternatif',
    description: 'Achat alternatif récent chez B (fixture de test).',
    prixUnitaireAvantCents: 211,
    prixUnitaireApresCents: 158,
    quantiteConcernee: 3,
  });

  // HORS fenêtre (400 jours) — fournisseur A, montant volontairement ÉNORME
  // (4 400 c) : s'il fuitait dans le total, l'écart serait indiscutable.
  enregistrerEconomie(b, {
    ...commun,
    dateAction: ajouterJours(jour, -400),
    fournisseurId: fournisseurA,
    typeAction: 'negociation_prix',
    description: 'Économie ancienne chez A, hors des 365 jours (fixture de test).',
    prixUnitaireAvantCents: 500,
    prixUnitaireApresCents: 100,
    quantiteConcernee: 11,
  });
}

describe('routes /api/palmares', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  async function monter(b: BaseBatte): Promise<FastifyInstance> {
    const instance = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(instance, envoyerReponse404);
    await instance.register(routesPalmares(b), { prefix: '/api' });
    await instance.ready();
    return instance;
  }

  describe('sur une base sans aucune activité (référentiel seul)', () => {
    beforeEach(async () => {
      base = creerBase(':memory:');
      migrer(base);
      seed(base);
      app = await monter(base);
    });

    it('« produits » : période de 365 jours, zéro session close, échantillon insuffisant sur les deux natures', async () => {
      const reponse = await app.inject({ method: 'GET', url: '/api/palmares/produits' });
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json();

      expect(corps.periode.jours).toBe(365);
      expect(corps.periode.debut < corps.periode.fin).toBe(true);
      expect(corps.nbSessionsClosesPeriode).toBe(0);
      expect(corps.seuilMinimumEchantillon).toBeGreaterThan(0);

      expect(corps.groupes).toHaveLength(2);
      const natures = corps.groupes.map((g: { nature: string }) => g.nature).sort();
      expect(natures).toEqual(['revendu', 'transforme']);

      for (const groupe of corps.groupes) {
        expect(groupe.echantillonSuffisant).toBe(false);
        expect(typeof groupe.raisonEchantillonInsuffisant).toBe('string');
        expect(groupe.raisonEchantillonInsuffisant.length).toBeGreaterThan(0);
        expect(groupe.divergenceVenteRentabilite).toBeNull();
      }
    });

    it('« fournisseurs » : aucun signal d’activité, échantillon insuffisant, les deux critères hors de portée le disent', async () => {
      const reponse = await app.inject({ method: 'GET', url: '/api/palmares/fournisseurs' });
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json();

      expect(corps.nbFacturesConsiderees).toBe(0);
      expect(corps.nbLignesEconomiesConsiderees).toBe(0);
      expect(corps.echantillonSuffisant).toBe(false);
      expect(typeof corps.raisonEchantillonInsuffisant).toBe('string');

      // Les deux critères non calculables portent leur raison, jamais une
      // valeur inventée — visibles MÊME quand l'échantillon est insuffisant :
      // ce sont deux informations indépendantes.
      expect(corps.raisonDelaiLivraisonIndisponible.length).toBeGreaterThan(0);
      expect(corps.raisonQualiteProduitIndisponible.length).toBeGreaterThan(0);

      // Aucun fournisseur sans le moindre signal d'activité n'apparaît :
      // jamais un 0/5 par défaut affiché comme une note (mission du porteur).
      expect(corps.lignes).toEqual([]);
    });
  });

  describe('avec le référentiel ET l’historique de démonstration', () => {
    beforeEach(async () => {
      base = creerBase(':memory:');
      migrer(base);
      seed(base);
      seedDemonstration(base);
      seedDemonstrationActivite(base);
      injecterEconomiesDeTest(base);
      app = await monter(base);
    });

    it('« produits » : chaque ligne rendue porte la bonne nature, et jamais de valeur `undefined` cachée en `null`', async () => {
      const reponse = await app.inject({ method: 'GET', url: '/api/palmares/produits' });
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json();

      expect(corps.groupes).toHaveLength(2);
      for (const groupe of corps.groupes) {
        for (const ligne of groupe.lignes) {
          expect(ligne.nature).toBe(groupe.nature);
          // Un produit rendu ici a forcément été VENDU sur la période :
          // volume nul n'a rien à faire dans un classement de ventes.
          expect(ligne.volumeVendu).toBeGreaterThan(0);
          expect(ligne.margeParMinuteCuissonCents).toBeNull();
          expect(ligne.raisonMargeParMinuteCuissonIndisponible.length).toBeGreaterThan(0);
        }
      }

      // Les deux raisons de « marge par minute de cuisson » ne se mélangent
      // jamais entre les deux groupes (transformé : donnée manquante ;
      // revendu : sans objet).
      const raisonsTransforme = new Set(
        corps.groupes
          .find((g: { nature: string }) => g.nature === 'transforme')
          .lignes.map(
            (l: { raisonMargeParMinuteCuissonIndisponible: string }) =>
              l.raisonMargeParMinuteCuissonIndisponible,
          ),
      );
      const raisonsRevendu = new Set(
        corps.groupes
          .find((g: { nature: string }) => g.nature === 'revendu')
          .lignes.map(
            (l: { raisonMargeParMinuteCuissonIndisponible: string }) =>
              l.raisonMargeParMinuteCuissonIndisponible,
          ),
      );
      for (const r of raisonsTransforme) expect(raisonsRevendu.has(r as string)).toBe(false);
    });

    it('« fournisseurs » : le module Économies alimente bien `economieGenereeCents` par ce chemin', async () => {
      const reponse = await app.inject({ method: 'GET', url: '/api/palmares/fournisseurs' });
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json();

      // Le classement n'est PLUS vide (voir `injecterEconomiesDeTest`). Sans
      // cette garde, les boucles ci-dessous n'itèrent jamais et tout le test
      // se réduit au `statusCode === 200` ci-dessus.
      expect(corps.lignes.length).toBeGreaterThan(0);

      // Capture indépendante par le chemin ÉCONOMIES déjà testé
      // (`listerEconomies`), filtrée sur la fenêtre que la route DÉCLARE
      // elle-même dans sa réponse — on n'y recopie pas son filtre, on se sert
      // de ce qu'elle affirme.
      const attenduParFournisseur = new Map<string, number>();
      for (const l of listerEconomies(base, {})) {
        if (l.dateAction < corps.periode.debut || l.dateAction > corps.periode.fin) continue;
        attenduParFournisseur.set(
          l.fournisseurId,
          (attenduParFournisseur.get(l.fournisseurId) ?? 0) + l.economieCents,
        );
      }

      // Au moins deux fournisseurs porteurs : un seul ne prouverait pas que
      // chaque ligne reçoit SON total plutôt qu'un total global.
      expect(attenduParFournisseur.size).toBeGreaterThanOrEqual(2);

      let verifiees = 0;
      for (const ligne of corps.lignes) {
        const attendu = attenduParFournisseur.get(ligne.fournisseurId);
        if (attendu === undefined) continue;
        // ÉGALITÉ, jamais une borne unilatérale : `toBeLessThanOrEqual` est
        // satisfait par `0`, donc par un module Économies entièrement
        // débranché — c'était exactement le trou de la version précédente.
        expect(ligne.economieGenereeCents).toBe(attendu);
        verifiees += 1;
      }
      // Chaque fournisseur porteur d'une économie apparaît RÉELLEMENT au
      // classement : sans ce compte, une route qui les omettrait tous
      // passerait la boucle ci-dessus sans jamais l'exécuter.
      expect(verifiees).toBe(attenduParFournisseur.size);

      // L'économie hors des 365 jours est bien EXCLUE du total servi : c'est
      // ce qui prouve que le filtre de dates de la route est vivant.
      const totalToutesPeriodes = listerEconomies(base, {}).reduce(
        (s, l) => s + l.economieCents,
        0,
      );
      const totalDansFenetre = [...attenduParFournisseur.values()].reduce((s, v) => s + v, 0);
      expect(totalDansFenetre).toBeLessThan(totalToutesPeriodes);

      // Aucune ligne fournisseur ne porte de valeur `undefined` sur les
      // critères hors de portée — toujours `null`, explicitement.
      for (const ligne of corps.lignes) {
        expect(ligne.delaiLivraisonJours).toBeNull();
        expect(ligne.qualiteProduitScore).toBeNull();
      }
    });
  });
});
