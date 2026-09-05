import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { creerBase, migrer, seed, seedDemonstration, type BaseBatte } from '@batte/db';
import {
  ajouterJours,
  jourCivilBelge,
  type AnnulationReceptionCreee,
  type EtatStock,
  type ListeFournisseurs,
  type ListeIngredients,
  type ListeLots,
  type ListeMouvementsLot,
  type MouvementLotContrat,
  type ReceptionCreee,
} from '@batte/core';
import { construireServeur } from '../serveur.js';

/**
 * Les deux gestes de correction du module Stock, exerces par HTTP.
 *
 * Ils ont un point commun : ils sont RARES et CRITIQUES. On ne contrepasse pas
 * un mouvement toutes les semaines, et on ne met pas un lot en quarantaine tous
 * les mois — mais le jour ou il le faut, il le faut vraiment. C'est exactement
 * le profil de fonctionnalite qui pourrit sans qu'on s'en apercoive, d'ou ces
 * tests.
 *
 * AUCUNE VALEUR ABSOLUE N'EST ASSERTEE. Le jeu de demonstration bouge d'un lot
 * a l'autre ; tout ce qui est verifie ici est un ECART entre deux lectures, ou
 * un statut. C'est la seule facon qu'un test de ce genre survive a une
 * evolution de la graine.
 */

/** Marqueur pose sur le mouvement de test, pour le retrouver sans supposer d'ordre. */
const SENTINELLE = 'sentinelle-contrepassation';
type ReponseErreur = { erreur: { code: string; message: string; champs?: Record<string, string> } };

describe('corrections de stock — contrepassation et statut de lot', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let ingredientId: string;
  let jour: string;

  async function etatStock(): Promise<EtatStock['data'][number]> {
    const corps = (await app.inject({ method: 'GET', url: '/api/stock' })).json<EtatStock>();
    const ligne = corps.data.find((l) => l.ingredientId === ingredientId);
    if (ligne === undefined) throw new Error('Ingrédient de test disparu de l’état du stock.');
    return ligne;
  }

  async function lots(): Promise<ListeLots['data']> {
    return (
      await app.inject({ method: 'GET', url: `/api/stock/${ingredientId}/lots` })
    ).json<ListeLots>().data;
  }

  /** Cherche la sentinelle dans les mouvements de TOUS les lots de l'ingredient. */
  async function trouverSentinelle(): Promise<MouvementLotContrat> {
    for (const lot of await lots()) {
      const liste = (
        await app.inject({ method: 'GET', url: `/api/lots/${lot.id}/mouvements` })
      ).json<ListeMouvementsLot>();
      const trouve = liste.data.find((m) => m.motifTexte?.includes(SENTINELLE) === true);
      if (trouve !== undefined) return trouve;
    }
    throw new Error('Mouvement sentinelle introuvable.');
  }

  beforeAll(async () => {
    // Base en memoire : ces tests ne touchent ni le fichier du poste de travail,
    // ni le dossier de sauvegardes.
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    jour = jourCivilBelge(new Date());

    /**
     * Le stock est CONSTRUIT ici, par le vrai chemin d'entree
     * (`POST /api/receptions`), et non emprunte a la graine.
     *
     * Deux raisons. La graine de demonstration ne pose aucun lot — c'est
     * `seedDemonstrationActivite` qui le ferait, et elle n'est pas exportee.
     * Et surtout : un test qui depend des quantites de la graine casse a la
     * premiere evolution de celle-ci. Ici, deux lots de DLC differentes sont
     * crees explicitement, ce qui donne en prime un ordre FEFO connu.
     */
    const fournisseurs = (
      await app.inject({ method: 'GET', url: '/api/fournisseurs' })
    ).json<ListeFournisseurs>();
    const ingredients = (
      await app.inject({ method: 'GET', url: '/api/ingredients' })
    ).json<ListeIngredients>();

    const fournisseur = fournisseurs.data[0];
    // Un ingredient en GRAMMES : la sortie d'une unite y est negligeable, alors
    // qu'elle serait un oeuf entier sur un ingredient a la piece.
    const ingredient = ingredients.data.find((i) => i.unite === 'g');
    if (fournisseur === undefined || ingredient === undefined) {
      throw new Error('Le référentiel de démonstration ne fournit pas de quoi construire un lot.');
    }
    ingredientId = ingredient.id;

    const reception = await app.inject({
      method: 'POST',
      url: '/api/receptions',
      payload: {
        fournisseurId: fournisseur.id,
        dateReception: jour,
        numeroBonLivraison: 'BL-TEST-CORRECTIONS',
        lignes: [
          {
            ingredientId,
            quantite: 25_000,
            prixLigneCents: 3_200,
            numeroLotFournisseur: 'LOT-TEST-A',
            dateDlc: ajouterJours(jour, 30),
          },
          {
            ingredientId,
            quantite: 10_000,
            prixLigneCents: 1_400,
            numeroLotFournisseur: 'LOT-TEST-B',
            dateDlc: ajouterJours(jour, 60),
          },
        ],
      },
    });
    if (reception.statusCode !== 201) {
      throw new Error(`Réception de test refusée : ${reception.payload}`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('rend l’historique des mouvements d’un lot, réception d’origine comprise', async () => {
    const premier = (await lots())[0];
    expect(premier, 'la graine doit fournir au moins un lot').toBeDefined();

    const reponse = await app.inject({ method: 'GET', url: `/api/lots/${premier!.id}/mouvements` });

    expect(reponse.statusCode).toBe(200);
    const liste = reponse.json<ListeMouvementsLot>();
    expect(liste.meta.total).toBe(liste.data.length);
    // Tout lot naît d'une entrée : sans elle, la somme des mouvements ne
    // pourrait pas donner son restant (règle n°5).
    expect(liste.data.some((m) => m.type === 'entree')).toBe(true);
  });

  it('répond 404 sur un lot inexistant, pas une liste vide', async () => {
    // Une liste vide laisserait croire à un lot vierge ; c'est une adresse
    // fausse (D-035 : 404 pour une ressource adressée dans l'URL).
    const reponse = await app.inject({ method: 'GET', url: '/api/lots/lot-fantome/mouvements' });

    expect(reponse.statusCode).toBe(404);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('introuvable');
  });

  it('LA RÈGLE D-021 : contrepasser rend la matière UNE seule fois', async () => {
    const avant = (await etatStock()).quantiteDisponible;

    const sortie = await app.inject({
      method: 'POST',
      url: '/api/mouvements',
      payload: {
        ingredientId,
        quantite: 1,
        type: 'perte',
        motifCode: 'CASSE_CUISSON',
        motifTexte: SENTINELLE,
        dateMouvement: jour,
        // Ne pas dépendre des DLC de la graine : le test porte sur la
        // contrepassation, pas sur la FEFO.
        autoriserDlcDepassee: true,
      },
    });
    expect(sortie.statusCode).toBe(201);

    const apresSortie = (await etatStock()).quantiteDisponible;
    expect(apresSortie).toBe(avant - 1);

    const mouvement = await trouverSentinelle();
    expect(mouvement.isAnnule).toBe(false);

    const annulation = await app.inject({
      method: 'POST',
      url: `/api/mouvements/${mouvement.id}/annuler`,
      payload: { motifCode: 'ERREUR_SAISIE' },
    });
    expect(annulation.statusCode).toBe(201);
    expect(annulation.json<{ quantite: number }>().quantite).toBe(1);

    /**
     * LE chiffre du test. La première implémentation écrivait l'écriture
     * inverse ET excluait l'originale de la somme : la matière revenait deux
     * fois (29 000 g au lieu de 25 000). On exige donc l'égalité stricte avec
     * l'état d'AVANT la sortie, jamais `avant + 1`.
     */
    expect(await etatStock().then((l) => l.quantiteDisponible)).toBe(avant);
  });

  it('laisse l’écriture annulée LISIBLE et marquée, jamais effacée', async () => {
    const mouvement = await trouverSentinelle();

    // La ligne est toujours là — « rien ne s'efface » (CLAUDE.md §3 règle 7).
    expect(mouvement.isAnnule).toBe(true);
    expect(mouvement.annuleParId).not.toBeNull();

    // Et la contrepassation existe, identifiée comme telle pour que l'écran ne
    // propose pas de l'annuler à son tour.
    let contrepassation: MouvementLotContrat | undefined;
    for (const lot of await lots()) {
      const mouvements = (
        await app.inject({ method: 'GET', url: `/api/lots/${lot.id}/mouvements` })
      ).json<ListeMouvementsLot>();
      contrepassation = mouvements.data.find((m) => m.id === mouvement.annuleParId);
      if (contrepassation !== undefined) break;
    }
    expect(contrepassation).toBeDefined();
    expect(contrepassation!.estContrepassation).toBe(true);
    expect(contrepassation!.quantite).toBe(mouvement.quantite);
  });

  it('refuse une seconde contrepassation de la même écriture', async () => {
    // Sans cette règle, deux annulations successives CRÉERAIENT de la matière.
    const mouvement = await trouverSentinelle();

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/mouvements/${mouvement.id}/annuler`,
      payload: { motifCode: 'ERREUR_SAISIE' },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('deja_annule');
  });

  it('répond 404 pour un mouvement inexistant et 422 pour un motif hors catalogue', async () => {
    const inconnu = await app.inject({
      method: 'POST',
      url: '/api/mouvements/mouvement-fantome/annuler',
      payload: { motifCode: 'ERREUR_SAISIE' },
    });
    expect(inconnu.statusCode).toBe(404);

    const mouvement = await trouverSentinelle();
    const motifFaux = await app.inject({
      method: 'POST',
      url: `/api/mouvements/${mouvement.id}/annuler`,
      payload: { motifCode: 'MOTIF_INVENTE' },
    });
    expect(motifFaux.statusCode).toBe(422);
    const corps = motifFaux.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('motif_inconnu');
    // 422 + `champs` (D-035) : l'écran doit savoir sur quel contrôle accrocher
    // le message.
    expect(corps.erreur.champs?.['motifCode']).toBeDefined();
  });

  it('met un lot en quarantaine, et la FEFO cesse de le servir', async () => {
    const cible = (await lots()).find((l) => l.statut === 'disponible' && l.quantiteRestante > 0);
    expect(cible, 'la graine doit fournir un lot disponible non vide').toBeDefined();

    const disponibleAvant = (await etatStock()).quantiteDisponible;

    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/lots/${cible!.id}/statut`,
      payload: { statut: 'quarantaine', motifCode: 'QUARANTAINE_DOUTE' },
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json<{ statutPrecedent: string; statut: string }>()).toMatchObject({
      statutPrecedent: 'disponible',
      statut: 'quarantaine',
    });

    const apres = (await lots()).find((l) => l.id === cible!.id);
    expect(apres?.statut).toBe('quarantaine');

    // L'effet METIER de la quarantaine : la quantité disponible baisse d'autant.
    // C'est ce qui protège réellement — un lot suspect n'est plus servi.
    expect((await etatStock()).quantiteDisponible).toBe(disponibleAvant - cible!.quantiteRestante);
  });

  it('refuse un changement de statut NUL, avec le champ fautif désigné', async () => {
    const enQuarantaine = (await lots()).find((l) => l.statut === 'quarantaine');
    expect(enQuarantaine).toBeDefined();

    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/lots/${enQuarantaine!.id}/statut`,
      payload: { statut: 'quarantaine', motifCode: 'QUARANTAINE_DOUTE' },
    });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('statut_inchange');
    expect(corps.erreur.champs?.['statut']).toBeDefined();
  });

  it('lève la quarantaine et rend le lot à la FEFO', async () => {
    const enQuarantaine = (await lots()).find((l) => l.statut === 'quarantaine');
    expect(enQuarantaine).toBeDefined();
    const disponibleAvant = (await etatStock()).quantiteDisponible;

    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/lots/${enQuarantaine!.id}/statut`,
      payload: { statut: 'disponible', motifCode: 'LEVEE_QUARANTAINE' },
    });

    expect(reponse.statusCode).toBe(200);
    expect((await etatStock()).quantiteDisponible).toBe(
      disponibleAvant + enQuarantaine!.quantiteRestante,
    );
  });

  it('répond 404 sur un lot inexistant et 422 sur un statut hors énumération', async () => {
    const inconnu = await app.inject({
      method: 'PATCH',
      url: '/api/lots/lot-fantome/statut',
      payload: { statut: 'quarantaine', motifCode: 'QUARANTAINE_DOUTE' },
    });
    expect(inconnu.statusCode).toBe(404);

    const cible = (await lots())[0];
    const statutFaux = await app.inject({
      method: 'PATCH',
      url: `/api/lots/${cible!.id}/statut`,
      payload: { statut: 'perdu-dans-le-camion', motifCode: 'QUARANTAINE_DOUTE' },
    });
    expect(statutFaux.statusCode).toBe(422);
    expect(statutFaux.json<ReponseErreur>().erreur.code).toBe('validation');
  });
});

/**
 * DÉFAUT CORRIGÉ (audit du 31/07/2026, D-083) — `GET /stock/:ingredientId/lots`
 * filtrait un lot dès que sa quantité restante tombait à zéro AVEC le statut
 * `disponible`, sans distinguer un lot simplement ÉPUISÉ PAR LA VENTE d'un lot
 * dont la RÉCEPTION avait été ANNULÉE (`annulerReception` ramène la quantité à
 * zéro sans jamais toucher `lot.statut`, qui reste `disponible`). Le lot — et
 * avec lui tout son historique de mouvements, seule preuve que la
 * contrepassation a bien eu lieu — disparaissait donc de cet écran à
 * l'instant même où la correction réussissait : exactement ce que D-083
 * interdit (« les deux écritures restent visibles, jamais l'une à la place de
 * l'autre »).
 *
 * Base ISOLÉE de la précédente : les tests ci-dessus mutent un état partagé,
 * dans un ordre précis ; ce scénario a besoin d'annuler une réception
 * entière, un geste qu'aucun test existant ne devait subir en cascade.
 */
describe('GET /stock/:ingredientId/lots — un lot dont la réception est annulée reste VISIBLE (D-083)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let jour: string;
  let fournisseurId: string;
  let ingredientId: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    app = construireServeur(base, { journaliser: false });
    await app.ready();

    jour = jourCivilBelge(new Date());
    const fournisseurs = (
      await app.inject({ method: 'GET', url: '/api/fournisseurs' })
    ).json<ListeFournisseurs>();
    const ingredients = (
      await app.inject({ method: 'GET', url: '/api/ingredients' })
    ).json<ListeIngredients>();
    const fournisseur = fournisseurs.data[0];
    const ingredient = ingredients.data.find((i) => i.unite === 'g');
    if (fournisseur === undefined || ingredient === undefined) {
      throw new Error('Le référentiel de démonstration ne fournit pas de quoi construire un lot.');
    }
    fournisseurId = fournisseur.id;
    ingredientId = ingredient.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    "reste dans la liste après l'annulation de sa réception, quantité à zéro et statut " +
      '« disponible » compris — contrairement à un lot simplement épuisé par la vente, qui ' +
      'lui reste filtré',
    async () => {
      const reception = await app.inject({
        method: 'POST',
        url: '/api/receptions',
        payload: {
          fournisseurId,
          dateReception: jour,
          numeroBonLivraison: 'BL-TEST-LOT-INVISIBLE',
          lignes: [
            {
              ingredientId,
              quantite: 500,
              prixLigneCents: 200,
              numeroLotFournisseur: 'LOT-TEST-INVISIBLE',
            },
          ],
        },
      });
      expect(reception.statusCode).toBe(201);
      const { receptionId } = reception.json<ReceptionCreee>();

      // AVANT l'annulation : le lot est visible, entier, réception active.
      const lotsAvant = (
        await app.inject({ method: 'GET', url: `/api/stock/${ingredientId}/lots` })
      ).json<ListeLots>().data;
      const lotAvant = lotsAvant.find((l) => l.numeroLotFournisseur === 'LOT-TEST-INVISIBLE');
      expect(lotAvant).toBeDefined();
      expect(lotAvant?.receptionStatut).toBe('active');
      expect(lotAvant?.quantiteRestante).toBe(500);

      const annulation = await app.inject({
        method: 'POST',
        url: `/api/receptions/${receptionId}/annuler`,
        payload: { motifCode: 'ERREUR_SAISIE' },
      });
      expect(annulation.statusCode).toBe(201);
      expect(annulation.json<AnnulationReceptionCreee>().nbMouvementsContrepasses).toBe(1);

      // APRÈS l'annulation : quantité à zéro, statut de LOT toujours
      // `disponible` (annulerReception ne le touche pas) — c'est exactement
      // la combinaison que l'ANCIEN filtre faisait disparaître.
      const lotsApres = (
        await app.inject({ method: 'GET', url: `/api/stock/${ingredientId}/lots` })
      ).json<ListeLots>().data;
      const lotApres = lotsApres.find((l) => l.numeroLotFournisseur === 'LOT-TEST-INVISIBLE');

      expect(
        lotApres,
        'le lot doit rester atteignable après annulation de sa réception',
      ).toBeDefined();
      expect(lotApres?.quantiteRestante).toBe(0);
      expect(lotApres?.statut).toBe('disponible');
      expect(lotApres?.receptionStatut).toBe('annulee');

      // Et son historique de mouvements — la preuve même de la
      // contrepassation — reste atteignable derrière ce lot.
      const mouvements = (
        await app.inject({ method: 'GET', url: `/api/lots/${lotApres!.id}/mouvements` })
      ).json<ListeMouvementsLot>();
      expect(mouvements.data.length).toBe(2);
      expect(mouvements.data.some((m) => m.type === 'entree' && m.isAnnule)).toBe(true);
    },
  );

  it(
    'NE RESTAURE PAS un lot simplement épuisé par une sortie normale (zéro régression) : ' +
      'sa réception reste active, il reste filtré comme avant',
    async () => {
      const reception = await app.inject({
        method: 'POST',
        url: '/api/receptions',
        payload: {
          fournisseurId,
          dateReception: jour,
          numeroBonLivraison: 'BL-TEST-EPUISE-VENTE',
          lignes: [
            {
              ingredientId,
              quantite: 10,
              prixLigneCents: 100,
              numeroLotFournisseur: 'LOT-TEST-EPUISE-VENTE',
            },
          ],
        },
      });
      expect(reception.statusCode).toBe(201);

      const sortie = await app.inject({
        method: 'POST',
        url: '/api/mouvements',
        payload: {
          ingredientId,
          quantite: 10,
          type: 'consommation_perso',
          motifCode: 'PERSO',
          dateMouvement: jour,
          autoriserDlcDepassee: true,
        },
      });
      expect(sortie.statusCode).toBe(201);

      const lots = (
        await app.inject({ method: 'GET', url: `/api/stock/${ingredientId}/lots` })
      ).json<ListeLots>().data;
      // Épuisé par la vente, réception TOUJOURS active : ce lot doit rester
      // filtré — exactement le comportement d'avant le correctif.
      expect(lots.some((l) => l.numeroLotFournisseur === 'LOT-TEST-EPUISE-VENTE')).toBe(false);
    },
  );
});
