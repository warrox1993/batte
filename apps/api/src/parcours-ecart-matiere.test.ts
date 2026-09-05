/**
 * PARCOURS ÉCART MATIÈRE — quand le réel dépasse le théorique, la matière en
 * plus vient d'un lot que la fournée n'avait pas prévu.
 *
 * DEUX DÉFAUTS RÉELS, tous deux corrigés le 01/08/2026, et tous deux
 * INVISIBLES d'un test unitaire. Chacun était un chiffre faux, ou un registre
 * incomplet, qui atteignait le porteur :
 *
 *  1. `saisirRealise` recalculait `cout_matiere_reel_cents` À PARTIR DE ZÉRO à
 *     chaque appel, en sommant `production_consommation.cout_cents` — une
 *     colonne qui reste THÉORIQUE à vie. Or seule `consommationsReelles` est
 *     refusée une seconde fois : corriger le SEUL nombre de crêpes suffisait à
 *     effacer l'écart matière du total, en silence, alors que la matière était
 *     toujours sortie du stock. La clôture de session facturait ensuite un coût
 *     MINORÉ. C'est l'étape 4 de ce parcours.
 *  2. Les deux sens de la traçabilité partaient de `production_consommation`,
 *     la table écrite AU LANCEMENT. Le lot qui n'avait servi qu'à combler
 *     l'écart n'y a AUCUNE ligne : il était absent du registre qu'un rappel
 *     sanitaire vient consulter (CLAUDE.md §3 règle 6). Étapes 5 et 6.
 *
 * POURQUOI UN PARCOURS HTTP, et pas seulement des tests de dépôt. Le second
 * défaut ne se referme qu'à la frontière : un champ que le dépôt calcule mais
 * que le contrat Zod ne déclare pas est supprimé **silencieusement** — le
 * dépôt travaille, personne ne voit, rien ne le signale (docs/39 §5). Les
 * assertions `toBeDefined()` des étapes 5 et 6 ne sont donc pas une politesse :
 * ce sont les seules qui prouvent que `quantiteMouvementee` ARRIVE, et pas
 * seulement qu'il est produit.
 *
 * LA FIXTURE EST DÉLIBÉRÉMENT NON DÉGÉNÉRÉE (docs/39 §3) :
 *  - DEUX lots aux prix unitaires FRACTIONNAIRES et DIFFÉRENTS (0,244333 et
 *    0,261125 c/g) — à prix égal, on ne saurait pas dire de quel lot vient le
 *    coût, et l'étape 4 serait vraie par chance ;
 *  - la fournée ne touche QU'UN lot (vérifié en étape 2, sinon le scénario
 *    perd tout son sens) : c'est ce qui fait du second lot un lot RÉELLEMENT
 *    hors fournée, le seul cas où le défaut n°2 se manifeste ;
 *  - le débordement est calculé pour dépasser STRICTEMENT le reliquat du
 *    premier lot, jamais posé au hasard ;
 *  - aucun chiffre ne tombe rond, pour qu'un défaut d'arrondi soit visible.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  jourCivilBelge,
  schemaFaisabilite,
  schemaListeLots,
  schemaProductionDetail,
  schemaTracabiliteAmontSession,
  schemaTracabiliteAvalLot,
} from '@batte/core';
import { creerBase, migrer, seed, type BaseBatte } from '@batte/db';
import { construireServeur } from './serveur.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Les deux lots — prix unitaires fractionnaires et différents
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * DLC la plus PROCHE : la FEFO le sert en premier, donc c'est LUI que la
 * fournée entame — et lui seul (vérifié en étape 2).
 */
const LOT_ENTAME = {
  numero: 'FAR-ECART-ENTAME',
  quantite: 3_000,
  prixLigneCents: 733,
  dlcJ: 7,
} as const;

/**
 * DLC LOINTAINE : la fournée ne le touche pas. Il n'entrera dans cette
 * production QUE par l'écart de réalisé — c'est le lot dont l'absence du
 * registre était le défaut n°2.
 */
const LOT_RESERVE = {
  numero: 'FAR-ECART-RESERVE',
  quantite: 8_000,
  prixLigneCents: 2_089,
  dlcJ: 45,
} as const;

/**
 * De combien la sur-consommation doit DÉPASSER le reliquat du lot entamé.
 * Strictement positif, et non rond : c'est exactement la quantité qui doit se
 * retrouver sur le lot réservé, et donc au registre.
 */
const DEBORDEMENT_G = 239;

/** Volume cible, volontairement pas un multiple du rendement de référence. */
const VOLUME_FOURNEE_ML = 7_331;

/* ═══════════════════════════════════════════════════════════════════════════
   Montage
   ═══════════════════════════════════════════════════════════════════════════ */

let base: BaseBatte;
let app: FastifyInstance;
const envInitial: Record<string, string | undefined> = {};

let idFournisseur = '';
let idFarine = '';
let idRecette = '';
let idLieu = '';
let idSession = '';
let idProduction = '';
let aujourdhui = '';

const idLotParNumero = new Map<string, string>();

/** Besoin THÉORIQUE en farine, relevé sur la faisabilité — jamais supposé. */
let requisG = 0;
/** Sur-consommation déclarée, au-delà du théorique. */
let surplusG = 0;
/** Coût matière réel après la première saisie, relevé pour l'étape 4. */
let coutReelApresPremiereSaisie = 0;

function memoriserEtDefinir(cle: string, valeur: string | undefined): void {
  envInitial[cle] = process.env[cle];
  if (valeur === undefined) delete process.env[cle];
  else process.env[cle] = valeur;
}

function jourDecale(jours: number): string {
  const reference = new Date(`${aujourdhui}T12:00:00Z`);
  reference.setUTCDate(reference.getUTCDate() + jours);
  return reference.toISOString().slice(0, 10);
}

/** Les lots de farine, indexés par numéro fournisseur. */
async function lotsFarine(): Promise<Map<string, { id: string; quantiteRestante: number }>> {
  const liste = schemaListeLots.parse(
    (await app.inject({ method: 'GET', url: `/api/stock/${idFarine}/lots` })).json(),
  );
  return new Map(
    liste.data.map((l) => [
      l.numeroLotFournisseur ?? '(sans numéro)',
      { id: l.id, quantiteRestante: l.quantiteRestante },
    ]),
  );
}

beforeAll(async () => {
  // Aucune clé : le mode dégradé est la seule façon de jouer un parcours sans
  // jamais appeler l'API Anthropic, que le porteur paierait (CLAUDE.md §5).
  memoriserEtDefinir('ANTHROPIC_API_KEY', undefined);
  memoriserEtDefinir('MAIL_MODE_TEST', 'true');
  memoriserEtDefinir('OPENROUTESERVICE_API_KEY', undefined);

  base = creerBase(':memory:');
  migrer(base);
  seed(base);

  app = construireServeur(base, { journaliser: false });
  await app.ready();

  aujourdhui = jourCivilBelge(new Date());

  idFournisseur = (
    await app.inject({
      method: 'POST',
      url: '/api/fournisseurs',
      payload: {
        nom: 'Moulin — parcours écart',
        type: 'moulin',
        email: null,
        telephone: null,
        adresse: null,
        delaiLivraisonJours: 3,
        francoDePortCents: null,
        commandeMinimumCents: null,
        notes: null,
      },
    })
  ).json<{ id: string }>().id;

  idFarine = (
    await app.inject({
      method: 'POST',
      url: '/api/ingredients',
      payload: {
        nom: 'Farine de froment T55',
        categorie: 'farine',
        uniteReference: 'g',
        densiteGParMl: null,
        allergenes: ['gluten'],
        allergenesVerifies: true,
        stockSecurite: 1_000,
        delaiLivraisonJours: 3,
        dureeConservationJours: 187,
        notes: null,
      },
    })
  ).json<{ id: string }>().id;

  await app.inject({
    method: 'POST',
    url: '/api/conditionnements',
    payload: {
      ingredientId: idFarine,
      fournisseurId: idFournisseur,
      libelle: 'Sac 25 kg',
      quantiteUniteRef: 25_000,
      prixCents: 2_347,
      referenceFournisseur: null,
      datePrix: aujourdhui,
    },
  });

  // Recette à UN seul ingrédient : ce parcours examine l'écart de matière et
  // sa traçabilité, pas la mise à l'échelle multi-ingrédients (couverte
  // ailleurs). Un seul ingrédient rend chaque gramme attribuable sans ambiguïté.
  idRecette = (
    await app.inject({
      method: 'POST',
      url: '/api/recettes',
      payload: {
        code: 'PE',
        nom: 'Pâte — parcours écart matière',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 5_000,
        rendementReferenceCrepes: 66,
        perteCuissonBp: 300,
        tauxCasseBp: 150,
        perteFixeMl: 0,
        procede: null,
        notes: null,
        lignes: [{ ingredientId: idFarine, quantiteUniteRef: 1_595, noteTechnique: null }],
      },
    })
  ).json<{ id: string }>().id;

  await app.inject({
    method: 'PATCH',
    url: `/api/recettes/${idRecette}/statut`,
    payload: { statut: 'active' },
  });

  idLieu = (
    await app.inject({
      method: 'POST',
      url: '/api/lieux',
      payload: {
        nom: 'La Batte — parcours écart',
        adresse: null,
        // Aucune coordonnée : la météo bascule en mode dégradé AVANT toute
        // requête réseau. C'est ce qui rend ce parcours jouable hors ligne.
        latitude: null,
        longitude: null,
        jourSemaine: 0,
        heureDebut: '07:30',
        heureFin: '14:00',
        tarifEmplacementCents: 1_800,
        modeTarification: 'jour',
        metresLineaires: null,
        distanceKm: 12.4,
        facturationElectricite: 'aucune',
        puissanceDisponibleW: null,
        notes: null,
      },
    })
  ).json<{ id: string }>().id;

  idSession = (
    await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { lieuId: idLieu, dateSession: aujourdhui, fondsCaisseInitialCents: 5_000 },
    })
  ).json<{ id: string }>().id;
}, 60_000);

afterAll(async () => {
  await app.close();
  for (const [cle, valeur] of Object.entries(envInitial)) {
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
}, 60_000);

/* ═══════════════════════════════════════════════════════════════════════════
   Le parcours
   ═══════════════════════════════════════════════════════════════════════════ */

describe('parcours écart matière — le lot qui comble un écart doit compter, et se retrouver', () => {
  it('étape 1 — deux lots entrent, à des prix unitaires réellement différents', async () => {
    for (const lotScenario of [LOT_ENTAME, LOT_RESERVE]) {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/receptions',
        payload: {
          fournisseurId: idFournisseur,
          dateReception: aujourdhui,
          numeroBonLivraison: `BL-${lotScenario.numero}`,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: lotScenario.quantite,
              prixLigneCents: lotScenario.prixLigneCents,
              numeroLotFournisseur: lotScenario.numero,
              dateDlc: jourDecale(lotScenario.dlcJ),
            },
          ],
        },
      });
      expect(reponse.statusCode, reponse.payload).toBe(201);
    }

    const lots = await lotsFarine();
    expect(lots.size).toBe(2);
    for (const [numero, valeur] of lots) idLotParNumero.set(numero, valeur.id);

    /*
     * GARDE-FOU CONTRE LA FIXTURE AVEUGLE. À prix unitaires égaux, le coût
     * cesserait de témoigner du lot d'où vient la matière : l'étape 4 resterait
     * verte en ayant perdu tout pouvoir de discrimination.
     */
    const prixUnitaire = (l: { quantite: number; prixLigneCents: number }) =>
      l.prixLigneCents / l.quantite;
    expect(prixUnitaire(LOT_ENTAME)).not.toBe(prixUnitaire(LOT_RESERVE));
  });

  it('étape 2 — la fournée n’entame QU’UN lot : le second est réellement hors fournée', async () => {
    const faisabilite = schemaFaisabilite.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/productions/faisabilite',
          payload: {
            recetteId: idRecette,
            cible: { cible: 'volume', valeur: VOLUME_FOURNEE_ML },
            dateProduction: aujourdhui,
          },
        })
      ).json(),
    );
    expect(faisabilite.faisable).toBe(true);
    requisG = faisabilite.besoins.find((b) => b.ingredientId === idFarine)!.requis;

    // Le besoin doit tenir DANS le seul lot entamé : c'est cette fenêtre qui
    // fait du lot réservé un lot que la fournée n'a jamais touché.
    expect(requisG).toBeGreaterThan(0);
    expect(requisG).toBeLessThan(LOT_ENTAME.quantite);

    const production = await app.inject({
      method: 'POST',
      url: '/api/productions',
      payload: {
        recetteId: idRecette,
        cible: { cible: 'volume', valeur: VOLUME_FOURNEE_ML },
        dateProduction: aujourdhui,
        notes: 'Fournée du parcours écart matière.',
      },
    });
    expect(production.statusCode, production.payload).toBe(201);
    const detail = schemaProductionDetail.parse(production.json());
    idProduction = detail.id;

    // UNE seule consommation, et c'est le lot à DLC courte : sans cela, le
    // reste du parcours ne prouverait rien sur un lot « hors fournée ».
    expect(detail.consommations).toHaveLength(1);
    expect(detail.consommations[0]!.lotId).toBe(idLotParNumero.get(LOT_ENTAME.numero));
    expect(detail.coutMatiereReelCents).toBeNull();

    // Le reliquat du lot entamé décide du débordement : on le calcule, on ne
    // le suppose pas.
    const reliquatEntame = LOT_ENTAME.quantite - requisG;
    expect(reliquatEntame).toBeGreaterThan(0);
    surplusG = reliquatEntame + DEBORDEMENT_G;
  });

  it('étape 3 — la sur-consommation déclarée sort réellement du second lot', async () => {
    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/productions/${idProduction}/realise`,
      payload: {
        volumeReelMl: 7_100,
        crepesReelles: 92,
        ecartMotif: 'Pâte trop épaisse : rallongée en cours de fournée.',
        consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: requisG + surplusG }],
      },
    });
    expect(reponse.statusCode, reponse.payload).toBe(200);
    const detail = schemaProductionDetail.parse(reponse.json());

    /*
     * Le lot entamé est ÉPUISÉ, le lot réservé a fourni exactement le
     * débordement : le stock n'est que la somme des mouvements (§3 règle 5),
     * et c'est bien lui qu'on interroge ici.
     *
     * L'ABSENCE du lot entamé n'est pas une donnée manquante : la route
     * `/stock/:ingredientId/lots` masque DÉLIBÉRÉMENT les lots vidés par la
     * consommation normale (D-083, qui ne garde visibles que ceux dont la
     * réception a été annulée). C'est donc bien la façon dont cette route dit
     * « il n'en reste rien » — vérifié sur la route, pas supposé.
     */
    const lots = await lotsFarine();
    expect(lots.has(LOT_ENTAME.numero)).toBe(false);
    expect(lots.get(LOT_RESERVE.numero)!.quantiteRestante).toBe(
      LOT_RESERVE.quantite - DEBORDEMENT_G,
    );

    // Le coût réel dépasse le théorique — c'est la matière en plus, et c'est
    // elle que l'étape 4 doit voir survivre à une correction.
    expect(detail.coutMatiereReelCents).not.toBeNull();
    expect(detail.coutMatiereReelCents!).toBeGreaterThan(detail.coutMatiereTheoriqueCents);
    // Une part de ce coût ne se rattache à AUCUNE ligne de consommation : c'est
    // le signal, non nul, que l'écart a débordé sur un lot hors fournée.
    expect(detail.coutMatiereReelNonAffecteCents!).toBeGreaterThan(0);

    coutReelApresPremiereSaisie = detail.coutMatiereReelCents!;
  });

  it('étape 4 — DÉFAUT n°1 : corriger les seules crêpes n’efface plus l’écart matière', async () => {
    /*
     * Le geste le plus anodin du porteur : il se relit et corrige le nombre de
     * crêpes comptées. Aucun écart matière n'est redéclaré — la route ne
     * transmet même pas `consommationsReelles`. Rien ne doit bouger côté coût :
     * la matière est toujours sortie du stock, et les mouvements d'écart ne
     * sont pas contrepassés.
     */
    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/productions/${idProduction}/realise`,
      payload: { volumeReelMl: 7_100, crepesReelles: 89 },
    });
    expect(reponse.statusCode, reponse.payload).toBe(200);
    const detail = schemaProductionDetail.parse(reponse.json());

    expect(detail.crepesReelles).toBe(89);
    expect(detail.coutMatiereReelCents).toBe(coutReelApresPremiereSaisie);
    // Et surtout : il n'est pas retombé sur le THÉORIQUE. C'est ce chiffre-là,
    // minoré, que la clôture de session facturait à la marge du marché.
    expect(detail.coutMatiereReelCents!).toBeGreaterThan(detail.coutMatiereTheoriqueCents);

    // Le stock n'a pas bougé non plus : une correction de comptage ne rend
    // aucune farine.
    const lots = await lotsFarine();
    expect(lots.get(LOT_RESERVE.numero)!.quantiteRestante).toBe(
      LOT_RESERVE.quantite - DEBORDEMENT_G,
    );
  });

  it('étape 5 — DÉFAUT n°2, sens AVAL : le lot du débordement mène jusqu’à la pâte', async () => {
    /*
     * Le geste réel : le meunier rappelle un lot, le porteur saisit LE NUMÉRO
     * FOURNISSEUR — le seul que l'avis de rappel porte — et demande quelles
     * pâtes sont concernées.
     */
    const reponse = await app.inject({
      method: 'GET',
      url: `/api/afsca/tracabilite/lots/${LOT_RESERVE.numero}`,
    });
    expect(reponse.statusCode, reponse.payload).toBe(200);
    const aval = schemaTracabiliteAvalLot.parse(reponse.json());

    expect(aval.numeroLotFournisseur).toBe(LOT_RESERVE.numero);
    const ligne = aval.productions.find((p) => p.productionId === idProduction);
    // AVANT correction, cette ligne n'existait pas : la réponse à « quelles
    // pâtes » omettait toutes les productions où ce lot n'avait comblé qu'un
    // écart.
    expect(ligne, 'le lot du débordement doit mener à la production').toBeDefined();

    // Le lot n'était PAS prévu par cette fournée : son théorique est un vrai
    // zéro, et la quantité déclarée reste inconnue (la déclaration du porteur
    // porte sur l'ingrédient, pas sur le lot) — `null`, jamais `0`.
    expect(ligne!.quantiteTheorique).toBe(0);
    expect(ligne!.quantiteReelle).toBeNull();
    /*
     * `toBeDefined()` AVANT l'égalité, et ce n'est pas une redondance : le
     * champ est `.optional()` au contrat, donc une suppression silencieuse à
     * la frontière HTTP (docs/39 §5) laisserait le `parse` réussir et rendrait
     * `undefined`. C'est cette assertion-ci, et elle seule, qui prouve que le
     * chiffre ARRIVE jusqu'à l'écran du registre.
     */
    expect(ligne!.quantiteMouvementee).toBeDefined();
    expect(ligne!.quantiteMouvementee).toBe(DEBORDEMENT_G);

    // Le lien qui rend le rappel exploitable : le numéro du LOT DE PÂTE. Sans
    // lui, on sait qu'une production est touchée sans pouvoir nommer ce qui en
    // est sorti.
    expect(ligne!.numeroLotPate.trim()).not.toBe('');

    // Le lot entamé, lui, était déjà au registre : la correction n'a rien
    // retiré à ce qui marchait.
    const avalEntame = schemaTracabiliteAvalLot.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/afsca/tracabilite/lots/${LOT_ENTAME.numero}`,
        })
      ).json(),
    );
    const ligneEntame = avalEntame.productions.find((p) => p.productionId === idProduction);
    expect(ligneEntame).toBeDefined();
    expect(ligneEntame!.quantiteTheorique).toBe(requisG);
    // Théorique ET mouvementé diffèrent sur CE lot aussi : la fournée l'a
    // ensuite vidé pour combler l'écart. Deux chiffres distincts, deux vérités
    // distinctes — les confondre était tout le défaut.
    expect(ligneEntame!.quantiteMouvementee).toBe(LOT_ENTAME.quantite);
    expect(ligneEntame!.quantiteMouvementee).not.toBe(ligneEntame!.quantiteTheorique);
  });

  it('étape 6 — DÉFAUT n°2, sens AMONT : et les deux sens bouclent', async () => {
    // La pâte est destinée à ce marché : c'est ce rattachement qui fait entrer
    // la production dans le registre amont de la session.
    const rattachement = await app.inject({
      method: 'PATCH',
      url: `/api/productions/${idProduction}/session`,
      payload: { sessionId: idSession },
    });
    expect(rattachement.statusCode, rattachement.payload).toBe(200);

    const reponse = await app.inject({
      method: 'GET',
      url: `/api/afsca/tracabilite/sessions/${idSession}`,
    });
    expect(reponse.statusCode, reponse.payload).toBe(200);
    const amont = schemaTracabiliteAmontSession.parse(reponse.json());

    const fournee = amont.productions.find((p) => p.productionId === idProduction);
    expect(fournee).toBeDefined();

    const parNumero = new Map(fournee!.consommations.map((c) => [c.numeroLotFournisseur, c]));
    // LES DEUX lots sont cités, dont celui que le lancement n'avait jamais
    // touché : corriger le seul sens aval aurait laissé cette moitié fausse.
    expect(parNumero.get(LOT_ENTAME.numero)).toBeDefined();
    expect(parNumero.get(LOT_RESERVE.numero)).toBeDefined();

    expect(parNumero.get(LOT_RESERVE.numero)!.quantiteTheorique).toBe(0);
    expect(parNumero.get(LOT_RESERVE.numero)!.quantiteMouvementee).toBeDefined();
    expect(parNumero.get(LOT_RESERVE.numero)!.quantiteMouvementee).toBe(DEBORDEMENT_G);
    expect(parNumero.get(LOT_ENTAME.numero)!.quantiteTheorique).toBe(requisG);
    expect(parNumero.get(LOT_ENTAME.numero)!.quantiteMouvementee).toBe(LOT_ENTAME.quantite);

    /*
     * LA BOUCLE, et c'est elle qui décide qu'un rappel est exploitable : chaque
     * lot cité en AMONT doit, quand on repart de LUI, retrouver cette
     * production ET la même quantité. Un rappel qui ne boucle pas laisse le
     * porteur avec deux listes qui se contredisent.
     */
    for (const consommation of fournee!.consommations) {
      const avalDuLot = schemaTracabiliteAvalLot.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/afsca/tracabilite/lots/${consommation.lotId}`,
          })
        ).json(),
      );
      const retour = avalDuLot.productions.find((p) => p.productionId === idProduction);
      expect(retour, `lot ${consommation.numeroLotFournisseur} absent du sens aval`).toBeDefined();
      expect(retour!.quantiteMouvementee).toBe(consommation.quantiteMouvementee);
      expect(retour!.numeroLotPate).toBe(fournee!.numeroLotPate);
      // La session est nommée dans les deux sens : c'est ce qui permet de
      // dire au contrôleur QUEL MARCHÉ est concerné, pas seulement quelle pâte.
      expect(retour!.session?.id).toBe(idSession);
    }
  });
});
