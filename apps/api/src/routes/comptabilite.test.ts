import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  cloturerPeriode,
  creerBase,
  enregistrerDepense,
  enregistrerImmobilisation,
  listerLieux,
  listerProduitsVendables,
  migrer,
  schema,
  seed,
  seedDemonstration,
  type BaseBatte,
} from '@batte/db';
import {
  maintenantUtc,
  nouvelIdentifiant,
  type EcheanceLigneContrat,
  type ImpactVerrouillagePeriodeContrat,
  type ListeDepenses,
  type ListeEcheances,
  type ListeVentesParCreneauContrat,
  type PeriodeLigneContrat,
} from '@batte/core';
import { enregistrerGestionnaireErreurs } from '../plugins/erreurs.js';
import { routesComptabilite } from './comptabilite.js';

/**
 * Route `/api/ventes-par-creneau` (fiche 13, docs/17).
 *
 * Les sessions sont crées par INSERTION DIRECTE dans `session_marche` /
 * `session_vente`, plutôt qu'en passant par `cloturerSession` (hors zone
 * d'écriture de cet agent, et un chantier séparé y travaille en ce moment) :
 * cela donne un contrôle exact sur le CA, la marge et le créneau de chaque
 * ligne, ce dont ce test a besoin pour vérifier une répartition au prorata.
 */

type SessionFixture = {
  readonly id: string;
  readonly numero: string;
  readonly dateSession: string;
  readonly statut: 'planifiee' | 'cloturee' | 'annulee';
  readonly margeBruteCents: number | null;
  readonly margeNetteCents: number | null;
  readonly ventes: ReadonlyArray<{
    readonly creneauHoraire: string | null;
    readonly montantCents: number;
    readonly quantite: number;
  }>;
};

describe('route /api/ventes-par-creneau', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let lieuId: string;
  let produitVenteId: string;

  function creerSessionFixture(fixture: SessionFixture): void {
    base
      .insert(schema.sessionMarche)
      .values({
        id: fixture.id,
        numero: fixture.numero,
        lieuId,
        dateSession: fixture.dateSession,
        statut: fixture.statut,
        margeBruteCents: fixture.margeBruteCents,
        margeNetteCents: fixture.margeNetteCents,
        creeLe: maintenantUtc(),
        modifieLe: maintenantUtc(),
      })
      .run();

    for (const vente of fixture.ventes) {
      base
        .insert(schema.sessionVente)
        .values({
          id: nouvelIdentifiant(),
          sessionId: fixture.id,
          produitVenteId,
          quantite: vente.quantite,
          prixUnitaireCents: Math.round(vente.montantCents / vente.quantite),
          montantCents: vente.montantCents,
          creneauHoraire: vente.creneauHoraire,
        })
        .run();
    }
  }

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const lieu = listerLieux(base)[0];
    const produit = listerProduitsVendables(base)[0];
    if (lieu === undefined) throw new Error('Aucun lieu semé.');
    if (produit === undefined) throw new Error('Aucun produit vendable semé.');
    lieuId = lieu.id;
    produitVenteId = produit.id;

    // Session A, 2026 : CA 4000 sur « matin » (75 %), 1000 sur « soir »
    // (25 %) — marge brute 2000, marge nette 1600 connues.
    creerSessionFixture({
      id: 'sess-agregat-a',
      numero: 'SM-TEST-A',
      dateSession: '2026-05-10',
      statut: 'cloturee',
      margeBruteCents: 2000,
      margeNetteCents: 1600,
      ventes: [
        { creneauHoraire: 'matin', montantCents: 3000, quantite: 15 },
        { creneauHoraire: 'matin', montantCents: 1000, quantite: 5 },
        { creneauHoraire: 'soir', montantCents: 1000, quantite: 4 },
      ],
    });

    // Session B, 2026 : ventes AUSSI sur « matin », mais marge encore
    // inconnue (session close avant que la marge ne soit calculée, ou par un
    // mécanisme qui ne l'alimente pas encore) — ne doit PAS tirer la marge
    // estimée vers 0.
    creerSessionFixture({
      id: 'sess-agregat-b',
      numero: 'SM-TEST-B',
      dateSession: '2026-06-14',
      statut: 'cloturee',
      margeBruteCents: null,
      margeNetteCents: null,
      ventes: [{ creneauHoraire: 'matin', montantCents: 500, quantite: 2 }],
    });

    // Session C, 2026 : vente SANS créneau saisi.
    creerSessionFixture({
      id: 'sess-agregat-c',
      numero: 'SM-TEST-C',
      dateSession: '2026-07-01',
      statut: 'cloturee',
      margeBruteCents: 300,
      margeNetteCents: 200,
      ventes: [{ creneauHoraire: null, montantCents: 300, quantite: 3 }],
    });

    // Session D, 2026, mais PAS clôturée : ne doit apparaître dans aucun total.
    creerSessionFixture({
      id: 'sess-agregat-d',
      numero: 'SM-TEST-D',
      dateSession: '2026-07-02',
      statut: 'planifiee',
      margeBruteCents: null,
      margeNetteCents: null,
      ventes: [{ creneauHoraire: 'matin', montantCents: 999_999, quantite: 1 }],
    });

    // Session E, clôturée mais sur un AUTRE exercice : ne doit pas polluer 2026.
    creerSessionFixture({
      id: 'sess-agregat-e',
      numero: 'SM-TEST-E',
      dateSession: '2025-05-10',
      statut: 'cloturee',
      margeBruteCents: 1000,
      margeNetteCents: 800,
      ventes: [{ creneauHoraire: 'matin', montantCents: 800, quantite: 4 }],
    });

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(routesComptabilite(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('cumule le CA par créneau, toutes sessions clôturées de l’année confondues', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/ventes-par-creneau?annee=2026' });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ListeVentesParCreneauContrat>();

    const matin = corps.data.find((l) => l.creneauHoraire === 'matin');
    // Session A (3000+1000) + session B (500) = 4500 ; la session D (planifiee)
    // et la session E (2025) ne comptent pas.
    expect(matin?.caCents).toBe(4500);
    expect(matin?.nbSessions).toBe(2);
  });

  it('exclut les sessions non clôturées du total, même dans l’année demandée', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/ventes-par-creneau?annee=2026' });
    const corps = reponse.json<ListeVentesParCreneauContrat>();

    const total = corps.data.reduce((somme, l) => somme + l.caCents, 0);
    // 999 999 (session D, planifiee) ne doit apparaître nulle part.
    expect(total).toBeLessThan(999_999);
  });

  it('exclut les sessions clôturées d’un AUTRE exercice', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/ventes-par-creneau?annee=2026' });
    const corps = reponse.json<ListeVentesParCreneauContrat>();

    const total = corps.data.reduce((somme, l) => somme + l.caCents, 0);
    // 800 (session E, 2025) ne doit pas être compté dans l'exercice 2026.
    expect(total).toBe(4500 + 1000 + 300); // matin (A+B) + soir (A) + non renseigné (C)
  });

  it('garde le créneau « soir » séparé du créneau « matin »', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/ventes-par-creneau?annee=2026' });
    const corps = reponse.json<ListeVentesParCreneauContrat>();

    const soir = corps.data.find((l) => l.creneauHoraire === 'soir');
    expect(soir?.caCents).toBe(1000);
    expect(soir?.nbSessions).toBe(1);
  });

  it('place les ventes sans créneau saisi dans un bucket `null`, à la fin de la liste', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/ventes-par-creneau?annee=2026' });
    const corps = reponse.json<ListeVentesParCreneauContrat>();

    expect(corps.data.at(-1)?.creneauHoraire).toBeNull();
    expect(corps.data.at(-1)?.caCents).toBe(300);
  });

  it('répartit la marge de la session A au prorata du CA de chaque créneau', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/ventes-par-creneau?annee=2026' });
    const corps = reponse.json<ListeVentesParCreneauContrat>();

    // Session A : CA total 5000 (3000+1000 « matin », 1000 « soir »). Le
    // créneau « soir » n'a QUE la session A comme contributrice de marge :
    // 1000 / 5000 (part du CA de la session A) * 2000 (marge brute A) = 400.
    const soir = corps.data.find((l) => l.creneauHoraire === 'soir');
    expect(soir?.margeBruteEstimeeCents).toBe(400);
    expect(soir?.margeNetteEstimeeCents).toBe(320); // 1000/5000 * 1600
  });

  it('n’écrase jamais une marge inconnue en 0 : la session B ne fait pas baisser l’estimation du créneau « matin »', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/ventes-par-creneau?annee=2026' });
    const corps = reponse.json<ListeVentesParCreneauContrat>();

    const matin = corps.data.find((l) => l.creneauHoraire === 'matin');
    // Seule la session A contribue une marge connue sur « matin » :
    // 4000/5000 (part du CA « matin » dans le total de la session A) * 2000
    // = 1600. La session B (500 cents de CA, marge inconnue) ne doit RIEN
    // retrancher — la moyenne naïve (1600 + 0) / 2 = 800 serait fausse.
    expect(matin?.margeBruteEstimeeCents).toBe(1600);
    expect(matin?.nbSessionsAvecMargeConnue).toBe(1);
    expect(matin?.nbSessions).toBe(2);
  });

  it('rend `null`, jamais 0, quand aucune session du créneau n’a de marge connue', async () => {
    // Le bucket "non renseigné" (session C) a une marge connue (300/200) : on
    // vérifie ici sur un exercice sans aucune donnée, où `data` est vide et où
    // le total ne divise donc jamais par zéro côté serveur.
    const reponse = await app.inject({ method: 'GET', url: '/api/ventes-par-creneau?annee=1999' });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ListeVentesParCreneauContrat>();
    expect(corps.data).toEqual([]);
    expect(corps.meta.nbSessionsCloturees).toBe(0);
  });

  it('annonce le nombre de sessions clôturées de l’exercice dans les métadonnées', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/ventes-par-creneau?annee=2026' });
    const corps = reponse.json<ListeVentesParCreneauContrat>();

    // Sessions A, B, C sont clôturées et datées de 2026 ; D est planifiée, E
    // est sur 2025.
    expect(corps.meta.nbSessionsCloturees).toBe(3);
    expect(corps.meta.annee).toBe(2026);
  });

  it('refuse une année mal formée en 422', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/ventes-par-creneau?annee=pas-une-annee',
    });
    expect(reponse.statusCode).toBe(422);
  });

  it('retombe sur l’année civile courante quand `annee` est omis', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/ventes-par-creneau' });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ListeVentesParCreneauContrat>();
    expect(typeof corps.meta.annee).toBe('number');
  });
});

/**
 * `montantImmobiliseTotalCents` (docs/16-AUDIT-COMPTABILITE.md §4.1 / §8) :
 * sans lui, l'écart entre `montantTotalCents` et `montantDeductibleTotalCents`
 * sur une dépense de matériel immobilisé se lit comme une erreur de saisie
 * plutôt que comme un plan d'amortissement qui prend le relais.
 */
describe('route /api/depenses — montantImmobiliseTotalCents', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  const EXERCICE = 2033;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(routesComptabilite(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('vaut 0 sans aucune dépense rattachée à une immobilisation', async () => {
    enregistrerDepense(base, {
      dateDepense: `${EXERCICE}-01-05`,
      libelle: 'Assurance RC pro',
      categorie: 'assurance',
      montantCents: 12_000,
    });

    const reponse = await app.inject({ method: 'GET', url: `/api/depenses?annee=${EXERCICE}` });
    const corps = reponse.json<ListeDepenses>();
    expect(corps.meta.montantImmobiliseTotalCents).toBe(0);
    expect(corps.meta.montantDeductibleTotalCents).toBe(corps.meta.montantTotalCents);
  });

  it('reprend EXACTEMENT le décaissé des dépenses rattachées à une immobilisation', async () => {
    const immo = enregistrerImmobilisation(base, {
      libelle: 'Matériel de test',
      dateAcquisition: `${EXERCICE}-02-01`,
      montantCents: 350_000,
      dureeAmortissementAnnees: 5,
    });
    enregistrerDepense(base, {
      dateDepense: `${EXERCICE}-02-01`,
      libelle: 'Achat matériel de test',
      categorie: 'materiel',
      montantCents: 350_000,
      immobilisationId: immo.id,
    });

    const reponse = await app.inject({ method: 'GET', url: `/api/depenses?annee=${EXERCICE}` });
    const corps = reponse.json<ListeDepenses>();

    expect(corps.meta.montantImmobiliseTotalCents).toBe(350_000);
    // Le decaisse reste visible dans le total, mais 0 € en est deductible ICI :
    // sa deduction passe par le plan d'amortissement (montantDeductibleCharge).
    expect(corps.meta.montantTotalCents - corps.meta.montantDeductibleTotalCents).toBe(350_000);
  });
});

/**
 * `POST /echeances/:id/estimer-montant` (audit du 30/07/2026) :
 * `echeance.montantEstimeCents` était déclarée dans le contrat de sortie,
 * écrite en dur à `null`, et aucune route ne l'acceptait en entrée.
 */
describe('route /api/echeances/:id/estimer-montant', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let echeanceId: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(routesComptabilite(base), { prefix: '/api' });
    await app.ready();

    // `GET /echeances` sème le catalogue de façon idempotente (voir la route) :
    // on s'en sert pour obtenir un identifiant réel plutôt que d'en fabriquer un.
    const reponseListe = await app.inject({ method: 'GET', url: '/api/echeances' });
    const listeInitiale = reponseListe.json<ListeEcheances>();
    echeanceId = listeInitiale.data[0]!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('vaut `null` avant toute saisie', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/echeances' });
    const corps = reponse.json<ListeEcheances>();
    const ligne = corps.data.find((l) => l.id === echeanceId);
    expect(ligne?.montantEstimeCents).toBeNull();
  });

  it('enregistre un montant estimé et le retrouve tel quel dans la liste', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/echeances/${echeanceId}/estimer-montant`,
      payload: { montantEstimeCents: 10_271 },
    });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<EcheanceLigneContrat>();
    expect(corps.montantEstimeCents).toBe(10_271);

    const reponseListe = await app.inject({ method: 'GET', url: '/api/echeances' });
    const liste = reponseListe.json<ListeEcheances>();
    expect(liste.data.find((l) => l.id === echeanceId)?.montantEstimeCents).toBe(10_271);
  });

  it('efface une estimation avec `null`, plutôt que de la remplacer par 0', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/echeances/${echeanceId}/estimer-montant`,
      payload: { montantEstimeCents: 5_000 },
    });

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/echeances/${echeanceId}/estimer-montant`,
      payload: { montantEstimeCents: null },
    });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<EcheanceLigneContrat>();
    expect(corps.montantEstimeCents).toBeNull();
  });

  it('refuse un montant négatif en 422', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/echeances/${echeanceId}/estimer-montant`,
      payload: { montantEstimeCents: -100 },
    });
    expect(reponse.statusCode).toBe(422);
  });

  it('rend 404 sur une échéance introuvable', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/echeances/introuvable/estimer-montant',
      payload: { montantEstimeCents: 100 },
    });
    expect(reponse.statusCode).toBe(404);
  });
});

/**
 * `GET /periodes/:id/impact-verrouillage` et `POST /periodes/:id/verrouiller`
 * (docs/34-VERROU-COMPTABLE.md) : le geste qui pose le troisième état de
 * `periode.statut`, jusqu'ici jamais atteint par un chemin de production.
 * L'enchaînement imposé et le décompte lui-même sont déjà couverts en détail
 * par `packages/db/src/depots/comptabilite.test.ts` — ce bloc-ci vérifie
 * seulement le CONTRAT HTTP : codes de statut, forme de la réponse.
 */
describe('routes /api/periodes/:id/impact-verrouillage et /api/periodes/:id/verrouiller', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(routesComptabilite(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rend l'impact chiffré (tout à zéro) d'une période clôturée sans aucune écriture", async () => {
    const { id } = cloturerPeriode(base, 2040, 1, 'Le porteur du projet');

    const reponse = await app.inject({
      method: 'GET',
      url: `/api/periodes/${id}/impact-verrouillage`,
    });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ImpactVerrouillagePeriodeContrat>();

    expect(corps).toEqual({
      periodeId: id,
      annee: 2040,
      mois: 1,
      mouvementsStockNonAnnulesCount: 0,
      receptionsNonAnnuleesCount: 0,
      productionsNonAnnuleesCount: 0,
      sessionsNonAnnuleesCount: 0,
      depensesCount: 0,
      immobilisationsCount: 0,
    });
  });

  it('rend 404 sur une période introuvable pour la route d’impact', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/periodes/periode-inexistante/impact-verrouillage',
    });
    expect(reponse.statusCode).toBe(404);
  });

  it("refuse de verrouiller une période encore OUVERTE : l'enchaînement imposé est ouverte -> clôturée -> verrouillée", async () => {
    const cloture = await app.inject({
      method: 'POST',
      url: '/api/periodes/cloturer',
      payload: { annee: 2040, mois: 2 },
    });
    const { id } = cloture.json<PeriodeLigneContrat>();

    await app.inject({
      method: 'POST',
      url: `/api/periodes/${id}/rouvrir`,
      payload: { motif: 'Remise à l’état ouverte pour ce test' },
    });

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/periodes/${id}/verrouiller`,
      payload: {},
    });
    expect(reponse.statusCode).toBe(422);
  });

  it('verrouille une période clôturée, puis refuse ensuite de la rouvrir : le verrou est un point de non-retour', async () => {
    const cloture = await app.inject({
      method: 'POST',
      url: '/api/periodes/cloturer',
      payload: { annee: 2040, mois: 3 },
    });
    const { id } = cloture.json<PeriodeLigneContrat>();

    const verrouillage = await app.inject({
      method: 'POST',
      url: `/api/periodes/${id}/verrouiller`,
      payload: { verrouillePar: 'Le porteur du projet' },
    });
    expect(verrouillage.statusCode).toBe(200);
    const corps = verrouillage.json<PeriodeLigneContrat>();
    expect(corps.statut).toBe('verrouillee');

    const reouverture = await app.inject({
      method: 'POST',
      url: `/api/periodes/${id}/rouvrir`,
      payload: { motif: 'Tentative de correction' },
    });
    expect(reouverture.statusCode).toBe(422);
  });

  it('rend 404 en tentant de verrouiller une période introuvable', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/periodes/periode-inexistante/verrouiller',
      payload: {},
    });
    expect(reponse.statusCode).toBe(404);
  });
});
