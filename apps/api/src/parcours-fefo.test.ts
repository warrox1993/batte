/**
 * PARCOURS FEFO — « first expired, first out », obligation réglementaire
 * (CLAUDE.md §3 règle 6 : « c'est une obligation réglementaire, pas une
 * élégance technique »).
 *
 * POURQUOI CE PARCOURS EST CONSTRUIT EXACTEMENT COMME ÇA. Un test qui
 * réceptionne deux lots dans l'ordre chronologique de leur DLC ne prouve
 * RIEN : il passerait à l'identique avec un simple « premier entré, premier
 * sorti », voire avec un `ORDER BY rowid`. Trois lots sont donc reçus ici dans
 * un ordre qui rend les trois politiques DISTINGUABLES :
 *
 *   ordre de RÉCEPTION :   A (J-5)  →  B (J-2)  →  C (J)
 *   ordre des DLC :        B (J+9)  →  A (J+40) →  C (aucune DLC)
 *
 *   FIFO consommerait A, LIFO consommerait C, FEFO doit consommer B.
 *
 * Le lot le plus périssable est reçu EN SECOND, et le lot SANS DLC est reçu en
 * DERNIER — « un lot sans DLC passe en dernier, et non en premier : une denrée
 * non périssable n'est jamais urgente » (`ordonnerFefo`, `@batte/core`).
 *
 * DÉSÉQUILIBRE VOLONTAIRE, sur DEUX axes à la fois :
 *  - les tailles (5 000 g, 2 900 g, 9 000 g) : une fournée doit ENJAMBER deux
 *    lots, sinon on ne verrait jamais l'ordre, seulement le premier choisi ;
 *  - les prix unitaires (0,0842 / 0,11621 / 0,07789 c/g, soit 49 % d'écart
 *    entre les extrêmes) : le COÛT de la fournée devient alors un témoin de
 *    l'ordre réellement suivi, et pas seulement la liste des lots touchés.
 *    Trois lots au même prix seraient une fixture aveugle.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  jourCivilBelge,
  schemaFaisabilite,
  schemaListeLots,
  schemaProductionDetail,
  schemaStatutLotChange,
  schemaTracabiliteAvalLot,
} from '@batte/core';
import { creerBase, migrer, seed, type BaseBatte } from '@batte/db';
import { construireServeur } from './serveur.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Les trois lots — tailles, prix et DLC volontairement dissemblables
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Un lot du scénario. `dlcJ` est un décalage en jours par rapport à
 * aujourd'hui, `null` pour une denrée SANS DLC — le cas que la FEFO doit
 * servir en dernier, et qui impose ce type explicite.
 */
type LotDuScenario = {
  readonly numero: string;
  readonly quantite: number;
  readonly prixLigneCents: number;
  readonly receptionJ: number;
  readonly dlcJ: number | null;
};

/** Reçu EN PREMIER, DLC LOINTAINE : FIFO le prendrait, FEFO ne doit pas. */
const LOT_A: LotDuScenario = {
  numero: 'FAR-LONGUE-CONSERVATION',
  quantite: 5_000,
  prixLigneCents: 421,
  receptionJ: -5,
  dlcJ: 40,
};
/** Reçu EN SECOND, DLC la PLUS PROCHE : c'est LUI que la FEFO doit consommer. */
const LOT_B: LotDuScenario = {
  numero: 'FAR-DLC-COURTE',
  quantite: 2_900,
  prixLigneCents: 337,
  receptionJ: -2,
  dlcJ: 9,
};
/** Reçu EN DERNIER, SANS DLC : LIFO le prendrait, FEFO doit le garder pour la fin. */
const LOT_C: LotDuScenario = {
  numero: 'FAR-SANS-DLC',
  quantite: 9_000,
  prixLigneCents: 701,
  receptionJ: 0,
  dlcJ: null,
};

/**
 * Cibles en VOLUME, choisies pour que la première fournée enjambe deux lots
 * (3 400 g demandés, 2 900 g dans le lot le plus périssable) et que la seconde
 * atteigne le lot sans DLC (5 000 g demandés, 2 100 g restants sur le lot A).
 */
const VOLUME_FOURNEE_1_ML = 10_657;
const VOLUME_FOURNEE_2_ML = 15_674;

/* ═══════════════════════════════════════════════════════════════════════════
   Montage
   ═══════════════════════════════════════════════════════════════════════════ */

let base: BaseBatte;
let app: FastifyInstance;
const envInitial: Record<string, string | undefined> = {};

let idFournisseur = '';
let idFarine = '';
let idRecette = '';
let aujourdhui = '';

const idLotParNumero = new Map<string, string>();
let idProduction1 = '';
/** Besoin en farine de la première fournée, relevé sur la faisabilité. */
let requis1 = 0;

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

/** Les lots de la farine, indexés par numéro fournisseur. */
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
        nom: 'Moulin de Hollogne',
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
        stockSecurite: 2_000,
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

  // Recette à UN seul ingrédient : ce parcours ne teste que l'ordre de sortie
  // des lots, pas la mise à l'échelle multi-ingrédients (couverte ailleurs).
  idRecette = (
    await app.inject({
      method: 'POST',
      url: '/api/recettes',
      payload: {
        code: 'PF',
        nom: 'Pâte — parcours FEFO',
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

describe('parcours FEFO — le plus proche de la péremption sort en premier, quel que soit son rang d’arrivée', () => {
  it('étape 1 — les trois lots entrent dans un ordre qui contredit l’ordre des DLC', async () => {
    for (const lot of [LOT_A, LOT_B, LOT_C]) {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/receptions',
        payload: {
          fournisseurId: idFournisseur,
          dateReception: jourDecale(lot.receptionJ),
          numeroBonLivraison: `BL-${lot.numero}`,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: lot.quantite,
              prixLigneCents: lot.prixLigneCents,
              numeroLotFournisseur: lot.numero,
              dateDlc: lot.dlcJ === null ? null : jourDecale(lot.dlcJ),
            },
          ],
        },
      });
      expect(reponse.statusCode, reponse.payload).toBe(201);
    }

    const lots = await lotsFarine();
    expect(lots.size).toBe(3);
    for (const [numero, valeur] of lots) idLotParNumero.set(numero, valeur.id);

    expect(lots.get(LOT_A.numero)!.quantiteRestante).toBe(LOT_A.quantite);
    expect(lots.get(LOT_B.numero)!.quantiteRestante).toBe(LOT_B.quantite);
    expect(lots.get(LOT_C.numero)!.quantiteRestante).toBe(LOT_C.quantite);

    /*
     * GARDE-FOU CONTRE LA FIXTURE AVEUGLE. Si les trois prix unitaires
     * devenaient égaux, ce parcours resterait vert tout en cessant de
     * distinguer quoi que ce soit. On refuse ici cette dérive silencieuse.
     */
    const prixUnitaire = (lot: LotDuScenario) => lot.prixLigneCents / lot.quantite;
    expect(new Set([prixUnitaire(LOT_A), prixUnitaire(LOT_B), prixUnitaire(LOT_C)]).size).toBe(3);
  });

  it('étape 2 — la faisabilité chiffre un besoin qui ENJAMBE deux lots (sinon l’ordre serait invisible)', async () => {
    const faisabilite = schemaFaisabilite.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/productions/faisabilite',
          payload: {
            recetteId: idRecette,
            cible: { cible: 'volume', valeur: VOLUME_FOURNEE_1_ML },
            dateProduction: aujourdhui,
          },
        })
      ).json(),
    );

    expect(faisabilite.faisable).toBe(true);
    requis1 = faisabilite.besoins.find((b) => b.ingredientId === idFarine)!.requis;

    // Le besoin doit dépasser le lot le plus périssable SANS dépasser
    // ce lot + le suivant : c'est cette fenêtre qui rend l'ordre observable.
    expect(requis1).toBeGreaterThan(LOT_B.quantite);
    expect(requis1).toBeLessThan(LOT_B.quantite + LOT_A.quantite);
    // Et il doit tenir dans le SEUL lot A : sans cela, FIFO enjamberait aussi
    // deux lots et le test perdrait son pouvoir de discrimination.
    expect(requis1).toBeLessThan(LOT_A.quantite);
  });

  it('étape 3 — la production consomme le lot le plus PÉRISSABLE d’abord, pas le plus ancien ni le dernier reçu', async () => {
    const production = await app.inject({
      method: 'POST',
      url: '/api/productions',
      payload: {
        recetteId: idRecette,
        cible: { cible: 'volume', valeur: VOLUME_FOURNEE_1_ML },
        dateProduction: aujourdhui,
        notes: 'Première fournée du parcours FEFO.',
      },
    });
    expect(production.statusCode, production.payload).toBe(201);
    const detail = schemaProductionDetail.parse(production.json());
    idProduction1 = detail.id;

    const idA = idLotParNumero.get(LOT_A.numero)!;
    const idB = idLotParNumero.get(LOT_B.numero)!;
    const idC = idLotParNumero.get(LOT_C.numero)!;

    // DEUX consommations, et deux seulement : le lot sans DLC n'est pas touché.
    expect(detail.consommations).toHaveLength(2);
    const parLot = new Map(detail.consommations.map((c) => [c.lotId, c]));

    // Le lot le plus périssable est ÉPUISÉ en premier — c'est toute la règle.
    expect(parLot.get(idB)!.quantiteTheorique).toBe(LOT_B.quantite);
    // Le reste vient du lot à DLC lointaine, et de lui seul.
    expect(parLot.get(idA)!.quantiteTheorique).toBe(requis1 - LOT_B.quantite);
    // Le lot sans DLC est intact : une denrée non périssable n'est jamais urgente.
    expect(parLot.has(idC)).toBe(false);

    /*
     * LE COÛT COMME TÉMOIN DE L'ORDRE. Chaque allocation est valorisée au prix
     * unitaire de SON lot. Comme les trois prix diffèrent de près de 50 %, ce
     * total ne peut pas coïncider par hasard avec celui d'un autre ordre :
     * une FIFO pure (tout sur le lot A) donnerait un chiffre franchement
     * différent, calculé ci-dessous pour le prouver.
     */
    const coutFefoCents =
      Math.round(LOT_B.quantite * (LOT_B.prixLigneCents / LOT_B.quantite)) +
      Math.round((requis1 - LOT_B.quantite) * (LOT_A.prixLigneCents / LOT_A.quantite));
    expect(detail.coutMatiereTheoriqueCents).toBe(coutFefoCents);

    const coutSiFifoCents = Math.round(requis1 * (LOT_A.prixLigneCents / LOT_A.quantite));
    expect(detail.coutMatiereTheoriqueCents).not.toBe(coutSiFifoCents);

    const coutSiLifoCents = Math.round(requis1 * (LOT_C.prixLigneCents / LOT_C.quantite));
    expect(detail.coutMatiereTheoriqueCents).not.toBe(coutSiLifoCents);
  });

  it('étape 4 — le restant de chaque lot reflète exactement l’ordre suivi', async () => {
    const lots = await lotsFarine();

    // Le lot périssable a disparu de la liste : épuisé et disponible, il n'a
    // plus rien à y faire (`routes/stock.ts` filtre les lots vides encore
    // disponibles, mais garde ceux dont la RÉCEPTION a été annulée — D-083).
    expect(lots.has(LOT_B.numero)).toBe(false);
    expect(lots.get(LOT_A.numero)!.quantiteRestante).toBe(
      LOT_A.quantite - (requis1 - LOT_B.quantite),
    );
    expect(lots.get(LOT_C.numero)!.quantiteRestante).toBe(LOT_C.quantite);
  });

  it('étape 5 — la fournée suivante poursuit sur le lot à DLC lointaine, puis seulement sur celui sans DLC', async () => {
    const restantAvant = (await lotsFarine()).get(LOT_A.numero)!.quantiteRestante;

    const faisabilite = schemaFaisabilite.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/productions/faisabilite',
          payload: {
            recetteId: idRecette,
            cible: { cible: 'volume', valeur: VOLUME_FOURNEE_2_ML },
            dateProduction: aujourdhui,
          },
        })
      ).json(),
    );
    const requis2 = faisabilite.besoins.find((b) => b.ingredientId === idFarine)!.requis;
    // Le besoin doit DÉPASSER ce qui reste du lot A, sinon le lot sans DLC ne
    // serait jamais atteint et l'étape ne prouverait rien de neuf.
    expect(requis2).toBeGreaterThan(restantAvant);

    const production = await app.inject({
      method: 'POST',
      url: '/api/productions',
      payload: {
        recetteId: idRecette,
        cible: { cible: 'volume', valeur: VOLUME_FOURNEE_2_ML },
        dateProduction: aujourdhui,
        notes: 'Seconde fournée du parcours FEFO.',
      },
    });
    expect(production.statusCode, production.payload).toBe(201);
    const detail = schemaProductionDetail.parse(production.json());

    const parLot = new Map(detail.consommations.map((c) => [c.lotId, c]));
    expect(parLot.get(idLotParNumero.get(LOT_A.numero)!)!.quantiteTheorique).toBe(restantAvant);
    expect(parLot.get(idLotParNumero.get(LOT_C.numero)!)!.quantiteTheorique).toBe(
      requis2 - restantAvant,
    );

    const lots = await lotsFarine();
    expect(lots.has(LOT_A.numero)).toBe(false);
    expect(lots.get(LOT_C.numero)!.quantiteRestante).toBe(
      LOT_C.quantite - (requis2 - restantAvant),
    );
  });

  it('étape 6 — un lot mis en QUARANTAINE sort de la FEFO : le blocage protège réellement', async () => {
    /*
     * `schema.ts` motive le mécanisme : « un ERP BLOQUE et exige un déblocage
     * explicite tracé ; c'est aussi une exigence AFSCA ». La FEFO ne sert que
     * les lots `disponible` — encore faut-il que le déclencheur soit branché.
     * C'est CE branchement, et pas la fonction de tri, que cette étape vérifie.
     */
    const idC = idLotParNumero.get(LOT_C.numero)!;
    const restantAvant = (await lotsFarine()).get(LOT_C.numero)!.quantiteRestante;
    expect(restantAvant).toBeGreaterThan(0);

    const quarantaine = await app.inject({
      method: 'PATCH',
      url: `/api/lots/${idC}/statut`,
      payload: { statut: 'quarantaine', motifCode: 'QUARANTAINE_DOUTE' },
    });
    expect(quarantaine.statusCode, quarantaine.payload).toBe(200);
    const change = schemaStatutLotChange.parse(quarantaine.json());
    expect(change.statutPrecedent).toBe('disponible');
    expect(change.statut).toBe('quarantaine');
    // Une quarantaine ne DÉTRUIT rien : aucun mouvement de perte.
    expect(change.mouvementDestructionId).toBeNull();

    const faisabilite = schemaFaisabilite.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/productions/faisabilite',
          payload: {
            recetteId: idRecette,
            cible: { cible: 'volume', valeur: 5_000 },
            dateProduction: aujourdhui,
          },
        })
      ).json(),
    );

    // La matière est physiquement là, mais elle n'est plus CONSOMMABLE.
    expect(faisabilite.faisable).toBe(false);
    expect(faisabilite.besoins.find((b) => b.ingredientId === idFarine)!.disponible).toBe(0);
    expect(faisabilite.ingredientLimitant).not.toBeNull();
    expect(faisabilite.ingredientLimitant!.ingredientId).toBe(idFarine);

    // Et le lot reste VISIBLE, quantité intacte : mis de côté, jamais effacé.
    const lots = await lotsFarine();
    expect(lots.get(LOT_C.numero)!.quantiteRestante).toBe(restantAvant);
  });

  it('étape 7 — depuis le lot périssable, la traçabilité aval remonte à la fournée qui l’a consommé', async () => {
    const aval = schemaTracabiliteAvalLot.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/afsca/tracabilite/lots/${idLotParNumero.get(LOT_B.numero)}`,
        })
      ).json(),
    );

    expect(aval.numeroLotFournisseur).toBe(LOT_B.numero);
    // Un seul chemin : ce lot n'a servi qu'à la PREMIÈRE fournée, celle que la
    // FEFO lui a attribuée. S'il en portait deux, c'est que l'ordre aurait
    // changé entre les deux productions.
    expect(aval.productions.map((p) => p.productionId)).toEqual([idProduction1]);
    expect(aval.productions[0]!.numeroLotPate.trim()).not.toBe('');
  });
});
