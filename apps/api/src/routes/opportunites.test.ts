import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { maintenantUtc } from '@batte/core';
import {
  changerActiviteConditionnement,
  changerActiviteProduit,
  cloturerSession,
  creerBase,
  creerLieu,
  creerSession,
  listerLieuxComplets,
  migrer,
  modifierLieu,
  produitVente,
  schema,
  seed,
  seedDemonstration,
  seedDemonstrationActivite,
  type BaseBatte,
  type LieuCompletLigne,
} from '@batte/db';
import {
  creerOpportunite,
  type EntreeOpportunite,
  // Import relatif temporaire : dépôt neuf, hors du barrel @batte/db tant que
  // l'orchestrateur ne l'a pas câblé — voir le rapport de livraison.
} from '@batte/db';
import { routesOpportunites } from './opportunites.js';

function saisieDepuisLigne(ligne: LieuCompletLigne, surcharges: Record<string, unknown> = {}) {
  return {
    nom: ligne.nom,
    adresse: ligne.adresse,
    latitude: ligne.latitude,
    longitude: ligne.longitude,
    jourSemaine: ligne.jourSemaine,
    heureDebut: ligne.heureDebut,
    heureFin: ligne.heureFin,
    tarifEmplacementCents: ligne.tarifEmplacementCents,
    modeTarification: ligne.modeTarification,
    metresLineaires: ligne.metresLineaires,
    distanceKm: ligne.distanceKm,
    facturationElectricite: ligne.facturationElectricite,
    puissanceDisponibleW: ligne.puissanceDisponibleW,
    notes: ligne.notes,
    ...surcharges,
  };
}

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

function entreeOpportunite(surcharges: Partial<EntreeOpportunite> = {}): EntreeOpportunite {
  return {
    nom: 'Opportunité de test',
    type: 'festival',
    famille: 'grand_public',
    dateDebut: '2099-12-01',
    dateFin: '2099-12-01',
    ...surcharges,
  };
}

/**
 * Désactive TOUS les conditionnements actifs de la base : rend le coût
 * matière de chaque recette inconnu (`coutParCrepeCents === null`) sans
 * toucher aux produits de vente ni à leur prix. Même helper que
 * `lieux-rentabilite.test.ts` (fiche 13) : isole l'inconnue « matière » de
 * l'inconnue « prix », les deux devant rester indépendantes.
 */
function desactiverTousLesConditionnements(base: BaseBatte): void {
  const lignes = base.select({ id: schema.conditionnement.id }).from(schema.conditionnement).all();
  for (const ligne of lignes) {
    changerActiviteConditionnement(base, ligne.id, false);
  }
}

/**
 * Désactive tous les produits transformés : rend le prix moyen d'une crêpe
 * inconnu sans toucher aux recettes ni à leur coût matière — l'inverse de
 * `desactiverTousLesConditionnements` ci-dessus.
 */
function desactiverProduitsTransformes(base: BaseBatte): void {
  const produits = base.select().from(schema.produitVente).all();
  for (const produit of produits) {
    if (produit.nature === 'transforme') changerActiviteProduit(base, produit.id, false);
  }
}

describe('route /api/opportunites — mode dégradé (aucun coût mesurable)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    // Le catalogue de paramètres (coût kilométrique, seuils de fiabilité…)
    // n'est seedé qu'ici — sans lui, `lireParametres` lève, même pour une
    // base sans recette ni vente. Même besoin que `lieux-rentabilite.test.ts`.
    seed(base);
    creerOpportunite(base, entreeOpportunite());

    app = Fastify({ logger: false });
    await app.register(routesOpportunites(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reste fonctionnel sans aucune recette ni vente : marge nulle, jamais 0 € trompeur', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    expect(reponse.statusCode).toBe(200);

    const corps = reponse.json();
    expect(corps.meta.total).toBe(1);
    expect(corps.meta.coutsDisponibles).toBe(false);
    expect(corps.meta.avertissementCouts).not.toBeNull();
    expect(corps.data[0].margeNetteAttendueCents).toBeNull();
  });
});

describe('route /api/opportunites — familles (fiche 14 §3)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let lieuAvecHistoriqueId: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    seedDemonstrationActivite(base);

    const batte = listerLieuxComplets(base).find((l) => l.nom === 'La Batte');
    if (batte === undefined) throw new Error('Lieu « La Batte » introuvable après la graine.');
    lieuAvecHistoriqueId = batte.id;
    modifierLieu(
      base,
      lieuAvecHistoriqueId,
      saisieDepuisLigne(batte, {
        distanceKm: 12,
        tarifEmplacementCents: 2200,
        modeTarification: 'jour',
      }),
    );

    app = Fastify({ logger: false });
    await app.register(routesOpportunites(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reste silencieuse pour une opportunité entreprise : aucun taux de prise mesuré', async () => {
    creerOpportunite(
      base,
      entreeOpportunite({ nom: 'Stand entreprise', famille: 'entreprise', effectifEstime: 200 }),
    );

    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const corps = reponse.json();
    const ligne = corps.data.find((l: { nom: string }) => l.nom === 'Stand entreprise');

    expect(ligne.crepesPrevuesParSession).toBeNull();
    expect(ligne.margeNetteAttendueCents).toBeNull();
    expect(ligne.fiabilite).toBe('aucune_donnee');
    expect(corps.meta.avertissementTauxPriseEntreprise).not.toBeNull();
  });

  /**
   * D-082 (`docs/05-DECISIONS.md`, décidée le 31/07/2026) a tranché ce qui
   * était encore un **[À TRANCHER]** au moment où ce test a été écrit : zéro
   * session close sur un lieu → aucune prévision, jamais un chiffre. Le
   * texte affiché doit donc dire que la décision EST prise (« décision
   * D-082 »), pas qu'elle reste ouverte (« reste une décision du porteur,
   * non tranchée ») — l'ancienne assertion affirmait le contraire de ce que
   * D-082 vient d'établir, c'est elle qui devait changer.
   */
  it('reste silencieuse pour un grand public jamais visité (aucun lieu rattaché)', async () => {
    creerOpportunite(
      base,
      entreeOpportunite({ nom: 'Fête médiévale', famille: 'grand_public', lieuId: null }),
    );

    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const corps = reponse.json();
    const ligne = corps.data.find((l: { nom: string }) => l.nom === 'Fête médiévale');

    expect(ligne.crepesPrevuesParSession).toBeNull();
    expect(ligne.margeNetteAttendueCents).toBeNull();
    expect(ligne.fiabilite).toBe('aucune_donnee');
    expect(ligne.nbSessionsRetenues).toBe(0);
    expect(ligne.explicationPrevision).toContain('D-082');
    expect(ligne.explicationPrevision).toContain('Premier passage');
  });

  it('affiche une fréquentation connue pour un lieu grand public déjà visité', async () => {
    creerOpportunite(
      base,
      entreeOpportunite({
        nom: 'Marché de Noël sur lieu connu',
        famille: 'grand_public',
        lieuId: lieuAvecHistoriqueId,
      }),
    );

    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const corps = reponse.json();
    const ligne = corps.data.find(
      (l: { nom: string }) => l.nom === 'Marché de Noël sur lieu connu',
    );

    expect(ligne.crepesPrevuesParSession).not.toBeNull();
    expect(ligne.nbSessionsRetenues).toBeGreaterThan(0);
    expect(ligne.distanceKm).toBe(12);
    expect(ligne.distanceEstimeeVolDoiseau).toBe(false);
  });

  it('agrège une campagne de marché de Noël sur tous ses jours', async () => {
    creerOpportunite(
      base,
      entreeOpportunite({
        nom: 'Marché de Noël — 5 jours',
        famille: 'marche_noel',
        lieuId: lieuAvecHistoriqueId,
        dateDebut: '2099-12-01',
        dateFin: '2099-12-05',
      }),
    );

    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const corps = reponse.json();
    const ligne = corps.data.find((l: { nom: string }) => l.nom === 'Marché de Noël — 5 jours');

    expect(ligne.nbSessions).toBe(5);
    // Tarif "jour" : payé chaque jour de la campagne.
    expect(ligne.coutEmplacementCents).toBe(2200 * 5);
  });

  it('trie les lignes à marge connue avant les lignes à marge inconnue', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const corps = reponse.json();

    let vuMargeInconnue = false;
    for (const ligne of corps.data as { margeNetteAttendueCents: number | null }[]) {
      if (ligne.margeNetteAttendueCents === null) {
        vuMargeInconnue = true;
      } else {
        expect(vuMargeInconnue).toBe(false);
      }
    }
  });
});

/**
 * D-082 (`docs/05-DECISIONS.md`) : « le tri se fait sur les coûts connus,
 * jamais sur un revenu supposé ». Base ISOLÉE de celle des autres blocs
 * `describe` de ce fichier : les deux lieux ci-dessous ne portent
 * DÉLIBÉRÉMENT aucune session close (premier passage sur les deux), pour que
 * ni l'un ni l'autre n'ait de marge ni de fréquentation — sans quoi ce test
 * vérifierait le tri par marge (déjà couvert ci-dessus), pas le départage
 * PARMI les lignes à marge inconnue qu'il cible.
 */
describe('route /api/opportunites — D-082 : tri par coût connu entre deux premiers passages', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const lieuCherId = creerLieu(
      base,
      saisieLieuVierge({
        nom: 'Lieu cher, jamais visité',
        distanceKm: 100,
        tarifEmplacementCents: 5000,
        modeTarification: 'jour',
      }),
    );
    const lieuMoinsCherId = creerLieu(
      base,
      saisieLieuVierge({
        nom: 'Lieu moins cher, jamais visité',
        distanceKm: 10,
        tarifEmplacementCents: 1000,
        modeTarification: 'jour',
      }),
    );

    // Créées dans l'ordre « cher d'abord » : si le tri se contentait de
    // préserver l'ordre d'insertion (comportement AVANT ce correctif), le
    // moins cher resterait, à tort, en seconde position.
    creerOpportunite(
      base,
      entreeOpportunite({ nom: 'Cher', famille: 'grand_public', lieuId: lieuCherId }),
    );
    creerOpportunite(
      base,
      entreeOpportunite({ nom: 'Moins cher', famille: 'grand_public', lieuId: lieuMoinsCherId }),
    );

    app = Fastify({ logger: false });
    await app.register(routesOpportunites(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('classe deux premiers passages sur leur coût connu croissant, jamais sur un revenu supposé', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const corps = reponse.json();
    const noms = (corps.data as { nom: string }[]).map((l) => l.nom);

    const cher = corps.data.find((l: { nom: string }) => l.nom === 'Cher') as {
      margeNetteAttendueCents: number | null;
      crepesPrevuesParSession: number | null;
      coutDeplacementCents: number | null;
      coutEmplacementCents: number | null;
      explicationPrevision: string;
    };
    const moinsCher = corps.data.find(
      (l: { nom: string }) => l.nom === 'Moins cher',
    ) as typeof cher;

    // Prémisse : aucune des deux lignes n'a de marge ni de fréquentation
    // connues (D-082, premier passage sur les deux lieux) — sinon ce test
    // vérifierait le tri par marge, pas le tri par coût.
    expect(cher.margeNetteAttendueCents).toBeNull();
    expect(moinsCher.margeNetteAttendueCents).toBeNull();
    expect(cher.crepesPrevuesParSession).toBeNull();
    expect(moinsCher.crepesPrevuesParSession).toBeNull();
    expect(cher.explicationPrevision).toContain('Premier passage');

    expect(cher.coutDeplacementCents).not.toBeNull();
    expect(cher.coutEmplacementCents).not.toBeNull();
    expect(cher.coutDeplacementCents! + cher.coutEmplacementCents!).toBeGreaterThan(
      moinsCher.coutDeplacementCents! + moinsCher.coutEmplacementCents!,
    );

    // La ligne la MOINS chère doit précéder la plus chère, malgré un ordre
    // d'insertion inverse.
    expect(noms.indexOf('Moins cher')).toBeLessThan(noms.indexOf('Cher'));
  });
});

describe('route /api/opportunites — mesure du taux de prise entreprise (D-059)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idLieu: string;
  let idCrepe: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    idLieu = creerLieu(base, saisieLieuVierge({ nom: 'Lieu — sessions entreprise' }));
    idCrepe = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!.id;

    app = Fastify({ logger: false });
    await app.register(routesOpportunites(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Crée puis clôture une session rattachée à `evenementId`, avec `crepesVendues`
   *  vendues. Le seuil par défaut du catalogue est 3 observations. */
  function sessionCloseVersEntreprise(
    evenementId: string,
    dateSession: string,
    crepesVendues: number,
  ): void {
    const session = creerSession(base, { lieuId: idLieu, dateSession, evenementId });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idCrepe, quantite: crepesVendues, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: crepesVendues * 300,
      caCarteCents: 0,
      crepesProduites: crepesVendues,
      crepesInvendues: 0,
      crepesCassees: 0,
    });
  }

  it('reste silencieuse tant que le nombre d’observations est SOUS le seuil (3 par défaut)', async () => {
    const opportunite = creerOpportunite(
      base,
      entreeOpportunite({
        nom: 'Entreprise sous le seuil',
        famille: 'entreprise',
        effectifEstime: 100,
      }),
    );
    sessionCloseVersEntreprise(opportunite.id, '2026-10-01', 40);
    sessionCloseVersEntreprise(opportunite.id, '2026-10-08', 40);

    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const corps = reponse.json();
    const ligne = corps.data.find((l: { id: string }) => l.id === opportunite.id);

    expect(ligne.crepesPrevuesParSession).toBeNull();
    expect(ligne.margeNetteAttendueCents).toBeNull();
    expect(ligne.nbSessionsRetenues).toBe(2);
    expect(ligne.fiabilite).toBe('aucune_donnee');
    expect(ligne.explicationPrevision).toContain('2');
    expect(corps.meta.avertissementTauxPriseEntreprise).not.toBeNull();
  });

  it('devient utilisable au seuil (3 observations) et le dit explicitement', async () => {
    const opportunite = creerOpportunite(
      base,
      entreeOpportunite({
        nom: 'Entreprise au seuil',
        famille: 'entreprise',
        effectifEstime: 100,
      }),
    );
    // 40 / 100 = 40 % à chaque visite.
    sessionCloseVersEntreprise(opportunite.id, '2026-10-01', 40);
    sessionCloseVersEntreprise(opportunite.id, '2026-10-08', 40);
    sessionCloseVersEntreprise(opportunite.id, '2026-10-15', 40);

    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const ligne = reponse.json().data.find((l: { id: string }) => l.id === opportunite.id);

    expect(ligne.nbSessionsRetenues).toBe(3);
    expect(ligne.fiabilite).toBe('peu_fiable');
    // 100 employés × 40 % = 40 crêpes.
    expect(ligne.crepesPrevuesParSession).toBe(40);
    expect(ligne.explicationPrevision).toContain('3');
    expect(ligne.explicationPrevision.toLowerCase()).toContain('cette entreprise');
  });

  it('ne mélange JAMAIS deux entreprises : chacune garde son propre taux (le piège de ce lot)', async () => {
    const entrepriseA = creerOpportunite(
      base,
      entreeOpportunite({
        nom: 'Grande entreprise avec cantine',
        famille: 'entreprise',
        effectifEstime: 200,
      }),
    );
    const entrepriseB = creerOpportunite(
      base,
      entreeOpportunite({
        nom: 'Petite entreprise sans rien',
        famille: 'entreprise',
        effectifEstime: 40,
      }),
    );
    // A : 50 % de taux de prise (100/200).
    sessionCloseVersEntreprise(entrepriseA.id, '2026-11-01', 100);
    sessionCloseVersEntreprise(entrepriseA.id, '2026-11-08', 100);
    sessionCloseVersEntreprise(entrepriseA.id, '2026-11-15', 100);
    // B : 15 % de taux de prise (6/40) — très différent de A.
    sessionCloseVersEntreprise(entrepriseB.id, '2026-11-01', 6);
    sessionCloseVersEntreprise(entrepriseB.id, '2026-11-08', 6);
    sessionCloseVersEntreprise(entrepriseB.id, '2026-11-15', 6);

    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const data = reponse.json().data as { id: string; crepesPrevuesParSession: number | null }[];
    const ligneA = data.find((l) => l.id === entrepriseA.id)!;
    const ligneB = data.find((l) => l.id === entrepriseB.id)!;

    // 200 × 50 % = 100 ; 40 × 15 % = 6 — chacune son taux, jamais moyennées
    // ensemble (qui donnerait un chiffre absurde pour les deux).
    expect(ligneA.crepesPrevuesParSession).toBe(100);
    expect(ligneB.crepesPrevuesParSession).toBe(6);
  });

  it('exclut du calcul les sessions annulées / exclues du modèle', async () => {
    const opportunite = creerOpportunite(
      base,
      entreeOpportunite({
        nom: 'Entreprise avec une session à écarter',
        famille: 'entreprise',
        effectifEstime: 100,
      }),
    );
    sessionCloseVersEntreprise(opportunite.id, '2026-12-01', 40);
    sessionCloseVersEntreprise(opportunite.id, '2026-12-08', 40);

    // Une troisième session existe, mais est EXCLUE du modèle (panne de gaz) :
    // elle ne doit pas compter comme 3e observation.
    const exclue = creerSession(base, {
      lieuId: idLieu,
      dateSession: '2026-12-15',
      evenementId: opportunite.id,
    });
    cloturerSession(base, exclue.id, {
      ventes: [{ produitVenteId: idCrepe, quantite: 1, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 300,
      caCarteCents: 0,
      crepesProduites: 1,
      crepesInvendues: 0,
      crepesCassees: 0,
      exclureDuModele: true,
      motifExclusion: 'Panne de gaz',
    });

    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const ligne = reponse.json().data.find((l: { id: string }) => l.id === opportunite.id);

    expect(ligne.nbSessionsRetenues).toBe(2);
    expect(ligne.crepesPrevuesParSession).toBeNull();
  });
});

describe('route /api/opportunites — création, rattachement, rejet', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    app = Fastify({ logger: false });
    await app.register(routesOpportunites(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('crée une opportunité par POST et la renvoie composée', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/opportunites',
      payload: {
        nom: 'Feu d’artifice',
        type: 'festival',
        famille: 'grand_public',
        dateDebut: '2099-07-14',
        dateFin: '2099-07-14',
      },
    });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json();
    expect(corps.nom).toBe('Feu d’artifice');
    expect(corps.famille).toBe('grand_public');
  });

  it('rattache un lieu déclaré et met à jour la distance affichée', async () => {
    const creation = await app.inject({
      method: 'POST',
      url: '/api/opportunites',
      payload: {
        nom: 'Village gaulois',
        type: 'festival',
        famille: 'grand_public',
        dateDebut: '2099-08-01',
        dateFin: '2099-08-02',
      },
    });
    const id = creation.json().id as string;

    const lieuId = creerLieu(
      base,
      saisieLieuVierge({ nom: 'Emplacement village gaulois', distanceKm: 33 }),
    );

    const rattachement = await app.inject({
      method: 'PATCH',
      url: `/api/opportunites/${id}/rattacher-lieu`,
      payload: { lieuId },
    });
    expect(rattachement.statusCode).toBe(204);

    const liste = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const ligne = liste.json().data.find((l: { id: string }) => l.id === id);
    expect(ligne.lieuId).toBe(lieuId);
    expect(ligne.distanceKm).toBe(33);
    expect(ligne.distanceEstimeeVolDoiseau).toBe(false);
  });

  it('écarte une opportunité par rejet : elle disparaît de la liste', async () => {
    const creation = await app.inject({
      method: 'POST',
      url: '/api/opportunites',
      payload: {
        nom: 'Opportunité à écarter',
        type: 'autre',
        famille: 'grand_public',
        dateDebut: '2099-09-01',
        dateFin: '2099-09-01',
      },
    });
    const id = creation.json().id as string;

    const rejet = await app.inject({ method: 'POST', url: `/api/opportunites/${id}/rejeter` });
    expect(rejet.statusCode).toBe(204);

    const liste = await app.inject({ method: 'GET', url: '/api/opportunites' });
    expect(liste.json().data.some((l: { id: string }) => l.id === id)).toBe(false);
  });
});

describe('route /api/opportunites — deux inconnues indépendantes : prix connu, matière inconnue (fiche 13, défaut corrigé le 30/07/2026)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let opportuniteId: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base); // recettes + produits actifs : prix de vente catalogue connu

    const idLieu = creerLieu(
      base,
      saisieLieuVierge({ nom: 'Lieu — entreprise, matière inconnue' }),
    );
    const opportunite = creerOpportunite(
      base,
      entreeOpportunite({
        nom: 'Entreprise — matière inconnue',
        famille: 'entreprise',
        effectifEstime: 100,
      }),
    );
    opportuniteId = opportunite.id;

    // Taux de prise mesurable (>= 3 observations, seuil par défaut) SANS
    // passer par `cloturerSession`/`session_vente` : `sessionsEntrepriseFermees`
    // lit directement `session_marche.crepes_vendues` + `evenement_id` — même
    // patron d'insertion directe que le coût kilométrique mesuré de
    // `lieux-rentabilite.test.ts`. Ne crée donc AUCUNE vente mesurée : le prix
    // moyen reste sur le repli catalogue (produits actifs, prix affiché).
    const maintenant = maintenantUtc();
    for (let i = 0; i < 3; i += 1) {
      base
        .insert(schema.sessionMarche)
        .values({
          id: `sess-entreprise-mi-${i}`,
          numero: `SM-ENTR-MI-${i}`,
          lieuId: idLieu,
          evenementId: opportuniteId,
          dateSession: `2026-0${i + 1}-10`,
          statut: 'cloturee',
          crepesVendues: 40,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
    }

    // Rend le coût matière inconnu : aucune production n'existe (l'insertion
    // ci-dessus ne passe pas par le service de production), donc le seul
    // repli de `coutMatiereParCrepe` est le coût théorique des recettes
    // actives — coupé ici en désactivant tous les conditionnements.
    desactiverTousLesConditionnements(base);

    app = Fastify({ logger: false });
    await app.register(routesOpportunites(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('le prix connu ne doit JAMAIS faire passer un coût matière inconnu pour 0', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json();

    expect(corps.meta.coutsDisponibles).toBe(false);
    expect(corps.meta.avertissementCouts).not.toBeNull();
    expect(corps.meta.avertissementCouts).toContain('recette');
    expect(corps.meta.avertissementCouts).not.toContain('prix de vente');

    const ligne = corps.data.find((l: { id: string }) => l.id === opportuniteId);
    expect(ligne).toBeDefined();
    // Le taux de prise EST mesurable : 40 crêpes vendues / 100 employés = 40 %.
    expect(ligne.crepesPrevuesParSession).toBe(40);
    expect(ligne.caAttenduCents).toBeGreaterThan(0);
    // Le défaut réel, corrigé une heure avant cette mission : sans lui, ce
    // champ valait 0 (matière gratuite), jamais `null`.
    expect(ligne.coutMatiereAttenduCents).toBeNull();
    expect(ligne.margeNetteAttendueCents).toBeNull();
  });
});

describe('route /api/opportunites — deux inconnues indépendantes : matière connue, prix inconnu (l’inverse du défaut corrigé)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let opportuniteId: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const idLieu = creerLieu(base, saisieLieuVierge({ nom: 'Lieu — entreprise, prix inconnu' }));
    const opportunite = creerOpportunite(
      base,
      entreeOpportunite({
        nom: 'Entreprise — prix inconnu',
        famille: 'entreprise',
        effectifEstime: 100,
      }),
    );
    opportuniteId = opportunite.id;

    const maintenant = maintenantUtc();
    for (let i = 0; i < 3; i += 1) {
      base
        .insert(schema.sessionMarche)
        .values({
          id: `sess-entreprise-pi-${i}`,
          numero: `SM-ENTR-PI-${i}`,
          lieuId: idLieu,
          evenementId: opportuniteId,
          dateSession: `2026-0${i + 1}-15`,
          statut: 'cloturee',
          crepesVendues: 40,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
    }

    // Rend le prix moyen inconnu : aucune vente mesurée (pas de
    // `session_vente` ci-dessus), et le repli catalogue est coupé en
    // désactivant les produits transformés. La matière, elle, reste connue
    // (conditionnements actifs, repli recette).
    desactiverProduitsTransformes(base);

    app = Fastify({ logger: false });
    await app.register(routesOpportunites(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('la recette déjà saisie ne doit JAMAIS être réclamée quand seul le prix de vente manque', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/opportunites' });
    const corps = reponse.json();

    expect(corps.meta.coutsDisponibles).toBe(false);
    expect(corps.meta.avertissementCouts).not.toBeNull();
    expect(corps.meta.avertissementCouts).toContain('prix de vente');
    expect(corps.meta.avertissementCouts).not.toContain('recette');

    const ligne = corps.data.find((l: { id: string }) => l.id === opportuniteId);
    expect(ligne).toBeDefined();
    expect(ligne.crepesPrevuesParSession).toBe(40);
    // La matière EST connue : elle doit rester un vrai nombre, jamais noyée
    // par l'inconnue du prix.
    expect(ligne.coutMatiereAttenduCents).toBeGreaterThan(0);
    expect(ligne.caAttenduCents).toBeNull();
    expect(ligne.margeNetteAttendueCents).toBeNull();
  });
});
