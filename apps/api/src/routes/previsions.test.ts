/**
 * Test d'integration — Mission 1 (docs/17 fiche 1, docs/15 §1.8, §1.9).
 *
 * Avant ce lot, `apps/api/src/routes/previsions.ts` passait
 * `stockMaximalCrepes: null` EN DUR au moteur : la prevision pouvait
 * recommander de produire 220 crepes avec de quoi en faire 80. Mesure sur
 * l'installation de production le 29/07/2026 : cible 203 crepes, stock reel
 * de quoi en faire 40 — un ecart de 163 crepes, 80 % de sa propre
 * recommandation. « Le pire mode de defaillance possible » (docs/15).
 *
 * Ce test recree un ecart du meme ordre avec un stock DELIBEREMENT rare, sur
 * une base en memoire, pour verifier l'ecretage sans dependre de l'etat
 * mouvant de la base de production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import {
  aujourdHui,
  cloturerSession,
  corrigerParametre,
  creerBase,
  creerSession,
  enregistrerMeteo,
  enregistrerReception,
  fournisseur,
  lireMeteo,
  migrer,
  prochaineSessionPlanifiee,
  recette,
  schema,
  seed,
  seedDemonstration,
  seedDemonstrationActivite,
  type BaseBatte,
} from '@batte/db';
import {
  nouvelIdentifiant,
  schemaPrevision,
  schemaPrevisionCalendaire,
  type PeriodeVacances,
  type Prevision,
  type RecetteDetail,
} from '@batte/core';
import { construireServeur } from '../serveur.js';
import {
  CREPES_EGALES_AU_PRIOR,
  CYCLE_CREPES_SIGNAL_FORT,
  METEO_TIEDE,
  NB_DIMANCHES_SIGNAL_FORT,
  conditionsTiedeSaisonniere,
  fixtureVacancesScolaires,
  sessionsComparableCalendaire,
  sessionsSessionConsecutive,
  type SessionFixture,
} from './previsions-fixtures-partagees.js';
import { fermerNavigateur } from '../documents/rendu.js';
import { reinitialiserClientIa } from '../ia/client.js';
import { routesPrevisions } from './previsions.js';

/** Recule d'exactement 7 jours un jour civil `AAAA-MM-JJ`. */
function joursAvantMission1(jour: string): string {
  const date = new Date(`${jour}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

describe('GET /api/prevision — la contrainte de stock (Mission 1)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  /** Plafond attendu : deux fournees de reference de R1 (2 x 6 crepes theoriques). */
  let plafondAttendu: number;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    const idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
    const idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!
      .id;

    const session = prochaineSessionPlanifiee(base, aujourdHui())!;

    /**
     * D-082 (`docs/05-DECISIONS.md`) : zéro session close sur un lieu → aucune
     * prévision. `seedDemonstration` seule ne clôture AUCUNE session (elle ne
     * fait que planifier la prochaine et poser le référentiel) — sans une
     * session close sur CE lieu, `/api/prevision` répondrait désormais
     * « premier passage », pas les comportements que ce test vérifie.
     *
     * `seedDemonstrationActivite` aurait aussi fourni cette session close,
     * mais au prix de ses PROPRES réceptions d'ingrédients (épicerie, terroir,
     * garniture) — qui auraient gonflé le stock bien au-delà du stock
     * DÉLIBÉRÉMENT rare construit plus bas, et empêché la contrainte de stock
     * de mordre au niveau attendu. On ferme donc une session historique
     * MINIMALE à la main, sans toucher au stock — mêmes primitives que
     * `cloturerSessionHistorique`/`cloturerDimancheTiede` plus bas dans ce
     * fichier.
     */
    const produitHistorique = base
      .select({ id: schema.produitVente.id })
      .from(schema.produitVente)
      .where(eq(schema.produitVente.nature, 'transforme'))
      .get()!;
    const sessionHistoriqueId = creerSession(base, {
      lieuId: session.lieuId,
      dateSession: joursAvantMission1(session.dateSession),
    }).id;
    cloturerSession(base, sessionHistoriqueId, {
      ventes: [{ produitVenteId: produitHistorique.id, quantite: 120, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 120 * 300,
      caCarteCents: 0,
      crepesProduites: 120,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    // Meteo NEUTRE et deja conservee : la prevision ne doit pas dependre d'un
    // appel reseau reel a Open-Meteo pendant ce test (le lieu de demonstration
    // porte des coordonnees reelles, docs/03).
    enregistrerMeteo(base, {
      lieuId: session.lieuId,
      dateObservation: session.dateSession,
      type: 'prevision',
      temperatureC: 15,
      precipitationsMm: 0,
      ventKmh: 5,
      couvertureNuageuseBp: 8000,
      recupereLe: new Date().toISOString(),
    });

    // Detail de R1 pour connaitre ses quantites de reference SANS les recopier
    // a la main : le rendement (455 ml pour 6 crepes, D-014) n'est pas une
    // valeur de ce test.
    const detail = (
      await app.inject({ method: 'GET', url: `/api/recettes/${idR1}` })
    ).json<RecetteDetail>();
    plafondAttendu = detail.rendementReferenceCrepes * 2;

    // Stock volontairement RARE : deux fournees de reference, tres en dessous
    // de toute baseline plausible (>= 100 crepes par defaut, CLAUDE.md §6),
    // pour que la contrainte de stock morde clairement — et SEULE, avant
    // celles de cuisson et de glaciere qui restent tres au-dessus.
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: session.dateSession,
      lignes: detail.lignes.map((l) => ({
        ingredientId: l.ingredientId,
        quantite: l.quantiteReference * 2,
        prixLigneCents: 100,
        dateDlc: '2027-12-31',
      })),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('ecrete la recommandation au stock reellement disponible et le dit', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/prevision' });
    expect(reponse.statusCode).toBe(200);
    const prevision = reponse.json<Prevision>();

    // AVANT ce lot : `crepesRecommandees` est ce que le moteur produit en
    // ignorant le stock — avec `stockMaximalCrepes: null` en dur, c'est
    // exactement ce chiffre qui s'affichait comme recommandation FINALE.
    // APRES : `crepesRetenues` est ecretee au stock reellement disponible.
    expect(prevision.crepesRecommandees).toBeGreaterThan(prevision.crepesRetenues);
    expect(prevision.contrainteLimitante).toBe("stock d'ingrédients");
    expect(prevision.manqueAGagnerCents).not.toBeNull();
    expect(prevision.manqueAGagnerCents!).toBeGreaterThan(0);

    // Le plafond stock apparait dans le detail des contraintes — c'est ce qui
    // alimente l'encadre « CE QUI VOUS LIMITE » (docs/17 fiche 1), qui ne
    // listait jusqu'ici que la cuisson et la glaciere.
    const contrainteStock = prevision.contraintes.find((c) => c.libelle === "stock d'ingrédients");
    expect(contrainteStock).toBeDefined();
    expect(prevision.crepesRetenues).toBe(contrainteStock!.plafondCrepes);

    // Deux fournees de reference : le plafond reste dans cet ordre de
    // grandeur, tres loin des dizaines de crepes recommandees sans stock.
    expect(contrainteStock!.plafondCrepes).toBeGreaterThan(0);
    expect(contrainteStock!.plafondCrepes).toBeLessThanOrEqual(plafondAttendu);
  });

  /**
   * Fiche 07 (docs/demandes/07) : cinq nouveaux predicteurs de precision,
   * cables par apps/api/src/routes/previsions.ts. `seedDemonstration` ne
   * fournit qu'UNE SEULE session historique cloturee (`seedDemonstrationActivite`) :
   * bien en dessous de ce que chacun des cinq predicteurs exige pour s'activer
   * (2 annees distinctes, 6 observations d'un jour de semaine, 8 paires
   * meteo, 3 occurrences de rupture/invendu). C'est exactement le jeu de
   * donnees ou ils doivent tous rester SILENCIEUX.
   */
  it('zéro régression : aucun des cinq nouveaux prédicteurs n’apparaît sans historique suffisant', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/prevision' });
    expect(reponse.statusCode).toBe(200);
    const prevision = reponse.json<Prevision>();

    // Absent, pas neutre : c'est la distinction que le contrat documente
    // (packages/core/src/contrats/previsions.ts). Un champ present a 10000
    // aurait aussi ete un bug, mais un bug DIFFERENT (predicteur admis a
    // tort) — celui-ci verifie specifiquement l'absence.
    expect(prevision.facteurs.comparableCalendaireBp).toBeUndefined();
    expect(prevision.facteurs.jourSemaineBp).toBeUndefined();
    expect(prevision.facteurs.vacancesScolairesBp).toBeUndefined();
    expect(prevision.facteurs.sessionConsecutiveBp).toBeUndefined();
    expect(prevision.facteurs.inflationSigmaMeteoBp).toBeUndefined();
  });

  it('archive NULL sur les cinq colonnes de précision quand aucun prédicteur n’est admis', async () => {
    const avant = await app.inject({ method: 'GET', url: '/api/prevision' });
    const prevision = avant.json<Prevision>();

    const archive = await app.inject({
      method: 'POST',
      url: '/api/prevision/archiver',
      payload: { sessionId: prevision.session?.id ?? null },
    });
    expect(archive.statusCode).toBe(201);
    const { id } = archive.json<{ id: string }>();

    const ligne = base
      .select({
        comparable: schema.prevision.facteurComparableCalendaireBp,
        jourSemaine: schema.prevision.facteurJourSemaineBp,
        vacances: schema.prevision.facteurVacancesScolairesBp,
        sessionConsecutive: schema.prevision.facteurSessionConsecutiveBp,
        inflationMeteo: schema.prevision.inflationSigmaMeteoBp,
      })
      .from(schema.prevision)
      .where(eq(schema.prevision.id, id))
      .get()!;

    // `NULL`, jamais `BASE_POINTS` (10000) : c'est la garantie explicitement
    // demandée — « ce prédicteur n'a pas influencé cette prévision », pas
    // « neutre ».
    expect(ligne.comparable).toBeNull();
    expect(ligne.jourSemaine).toBeNull();
    expect(ligne.vacances).toBeNull();
    expect(ligne.sessionConsecutive).toBeNull();
    expect(ligne.inflationMeteo).toBeNull();
  });

  /**
   * AUDIT ROBUSTESSE (D-035) : `sessionId` n'était vérifié nulle part avant
   * l'écriture dans `archiverPrevision` (`packages/db/src/depots/previsions.ts`),
   * alors que la colonne `prevision.session_id` porte une vraie clé étrangère
   * (`foreign_keys = ON`, `packages/db/src/client.ts`). Un identifiant erroné
   * (recopié depuis un autre écran, tronqué au copier-coller) ne se
   * manifestait qu'en violation de clé étrangère SQLite — un 500 brut sur
   * l'archivage d'une prévision. Corrigé par un contrôle d'existence AVANT
   * écriture dans la route, même convention que `routes/afsca.ts` pour
   * `lotId`/`sessionId`.
   */
  it('POST /api/prevision/archiver avec un sessionId inconnu rend 422 et nomme le champ, jamais 500', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/prevision/archiver',
      payload: { sessionId: '019fa000-0000-7000-8000-000000000000' },
    });
    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<{ erreur: { code: string; champs?: Record<string, string> } }>();
    expect(corps.erreur.champs?.['sessionId']).toBeTruthy();
  });
});

/**
 * Le prédicteur « jour de la semaine » DOIT pouvoir s'activer : sans ce test,
 * une garantie de non-régression parfaite pourrait cacher un câblage qui ne
 * branche RIEN nulle part (le même défaut que `rapprocherPrevision` avant
 * d'être appelé). Base isolée, historique synthétique construit à la main :
 * douze dimanches à 150 crêpes, douze mercredis à 40 — un écart assez large
 * pour qu'aucun estimateur raisonnable ne le manque.
 *
 * FIXTURE CORRIGÉE (docs/05-DECISIONS.md D-089, complément du 01/08/2026) :
 * les mercredis sont ÉTALÉS sur les mêmes douze semaines que les dimanches,
 * jamais groupés sur les deux ou trois dernières. Avant correction, les trois
 * mercredis de cette fixture étaient tous récents (0 à 14 jours) : une fois
 * la fuite leave-one-out fermée — le modèle de référence ne voit plus les
 * sessions futures au moment où un point est évalué —, la quasi-totalité des
 * dimanches passés n'avait plus, honnêtement, AUCUN mercredi antérieur pour
 * calibrer le prédicteur. Ce n'était pas un défaut du correctif : c'était une
 * fixture qui décrivait une situation impossible (un prédicteur calibré sur
 * des mercredis pas encore arrivés). Le signal (150 contre 40 crêpes) était
 * réel depuis le début ; seul l'étalement dans le temps manquait pour que la
 * validation croisée dispose d'assez de points OÙ LES DEUX jours de semaine
 * étaient déjà représentés dans le passé de chaque point évalué.
 */
describe('GET /api/prevision — le prédicteur « jour de la semaine » s’active avec assez d’historique', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  /** Le dernier jour `jourSemaineCible` STRICTEMENT avant `reference` (jamais `reference` elle-même). */
  function dernierJourAvant(reference: string, jourSemaineCible: number): string {
    const d = new Date(`${reference}T12:00:00Z`);
    let decalage = d.getUTCDay() - jourSemaineCible;
    if (decalage <= 0) decalage += 7;
    d.setUTCDate(d.getUTCDate() - decalage);
    return d.toISOString().slice(0, 10);
  }

  function joursAvant(reference: string, n: number): string {
    const d = new Date(`${reference}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }

  /** Clôture une session historique avec un écoulement NEUTRE (jamais rupture ni invendu important). */
  function cloturerSessionHistorique(
    lieuId: string,
    dateSession: string,
    produitId: string,
    nbCrepesParUnite: number,
    crepesVendues: number,
  ): void {
    const { id } = creerSession(base, { lieuId, dateSession });
    const quantite = Math.round(crepesVendues / nbCrepesParUnite);
    const prixUnitaireCents = 300 * nbCrepesParUnite;
    // Production volontairement un peu AU-DESSUS des ventes (partInvendueBp
    // entre les deux seuils de `session-consecutive.ts`) : cette session ne
    // doit JAMAIS être classée « rupture » ni « invendu important », pour ne
    // pas interférer avec le prédicteur testé ici.
    const crepesProduites = Math.ceil(crepesVendues * 1.08);
    cloturerSession(base, id, {
      ventes: [{ produitVenteId: produitId, quantite, prixUnitaireCents }],
      frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
      fondsCaisseInitialCents: 6000,
      especesCompteesCents: 6000 + quantite * prixUnitaireCents,
      caCarteCents: 0,
      crepesProduites,
      crepesInvendues: crepesProduites - crepesVendues,
      crepesCassees: 0,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
    });
  }

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    const jour = aujourdHui();
    const session = prochaineSessionPlanifiee(base, jour)!;

    // Météo neutre et déjà conservée, même raison que le describe ci-dessus :
    // aucun appel réseau réel pendant ce test.
    enregistrerMeteo(base, {
      lieuId: session.lieuId,
      dateObservation: session.dateSession,
      type: 'prevision',
      temperatureC: 15,
      precipitationsMm: 0,
      ventKmh: 5,
      couvertureNuageuseBp: 8000,
      recupereLe: new Date().toISOString(),
    });

    const produit = base
      .select({ id: schema.produitVente.id, nbCrepes: schema.produitVente.nbCrepes })
      .from(schema.produitVente)
      .where(eq(schema.produitVente.nature, 'transforme'))
      .get()!;
    const nbCrepesParUnite = produit.nbCrepes ?? 1;

    // Douze dimanches (le jour de la session à venir, `jourSemaine` 0 à La
    // Batte) à 150 crêpes. `seedDemonstrationActivite` a déjà clôturé LE
    // dernier dimanche passé (134 crêpes, docs/06) : on démarre donc une
    // semaine plus tôt pour ne jamais entrer en collision avec cette date.
    const dernierDimanche = dernierJourAvant(jour, 0);
    for (let i = 1; i <= 12; i += 1) {
      cloturerSessionHistorique(
        session.lieuId,
        joursAvant(dernierDimanche, 7 * i),
        produit.id,
        nbCrepesParUnite,
        150,
      );
    }

    // Douze mercredis à 40 crêpes, un par semaine sur EXACTEMENT LA MÊME
    // PÉRIODE que les douze dimanches ci-dessus — pas groupés sur les
    // dernières semaines (voir le commentaire du `describe` : c'est
    // précisément ce qui rendait la fixture malhonnête après la fermeture de
    // la fuite leave-one-out, D-089). Un marché hebdomadaire le dimanche plus
    // une sortie hebdomadaire le mercredi (foire, marché secondaire) reste un
    // jeu de données vraisemblable pour ce commerce (CLAUDE.md §6). Second
    // jour de semaine nécessaire (`prevision_jour_semaine_jours_distincts_minimum`)
    // pour que « jour de la semaine » ait quoi que ce soit à mesurer — et à
    // le mesurer avec, pour chaque point évalué, un passé qui contient
    // honnêtement les deux jours.
    const dernierMercredi = dernierJourAvant(jour, 3);
    for (let i = 0; i <= 11; i += 1) {
      cloturerSessionHistorique(
        session.lieuId,
        joursAvant(dernierMercredi, 7 * i),
        produit.id,
        nbCrepesParUnite,
        40,
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('admet « jour de la semaine » et le fait apparaître dans la décomposition', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/prevision' });
    expect(reponse.statusCode).toBe(200);
    const prevision = reponse.json<Prevision>();

    // Admis : le champ est PRÉSENT (pas seulement non-undefined par hasard).
    expect(prevision.facteurs.jourSemaineBp).toBeDefined();
    // La session à venir est un dimanche, systématiquement plus vendeur dans
    // l'historique construit ci-dessus : le facteur doit pousser AU-DESSUS
    // du neutre, jamais en dessous.
    expect(prevision.facteurs.jourSemaineBp!).toBeGreaterThan(10_000);
    expect(prevision.facteurs.jourSemaineExplication).toContain('Jour de la semaine');

    // Les quatre autres prédicteurs, eux, doivent rester silencieux sur CE
    // jeu de données (pas assez d'années, pas de calendrier de vacances, pas
    // assez de paires météo, aucune session en rupture/invendu) : la garantie
    // « un facteur non admis ne s'affiche pas » se vérifie aussi par ce
    // qu'elle NE fait PAS apparaître.
    expect(prevision.facteurs.comparableCalendaireBp).toBeUndefined();
    expect(prevision.facteurs.vacancesScolairesBp).toBeUndefined();
    expect(prevision.facteurs.sessionConsecutiveBp).toBeUndefined();
    expect(prevision.facteurs.inflationSigmaMeteoBp).toBeUndefined();
  });

  it('archive le facteur admis, et NULL sur les quatre autres', async () => {
    const calcul = await app.inject({ method: 'GET', url: '/api/prevision' });
    const prevision = calcul.json<Prevision>();

    const archive = await app.inject({
      method: 'POST',
      url: '/api/prevision/archiver',
      payload: { sessionId: prevision.session?.id ?? null },
    });
    expect(archive.statusCode).toBe(201);
    const { id } = archive.json<{ id: string }>();

    const ligne = base
      .select({
        comparable: schema.prevision.facteurComparableCalendaireBp,
        jourSemaine: schema.prevision.facteurJourSemaineBp,
        vacances: schema.prevision.facteurVacancesScolairesBp,
        sessionConsecutive: schema.prevision.facteurSessionConsecutiveBp,
        inflationMeteo: schema.prevision.inflationSigmaMeteoBp,
      })
      .from(schema.prevision)
      .where(eq(schema.prevision.id, id))
      .get()!;

    expect(ligne.jourSemaine).toBe(prevision.facteurs.jourSemaineBp);
    expect(ligne.comparable).toBeNull();
    expect(ligne.vacances).toBeNull();
    expect(ligne.sessionConsecutive).toBeNull();
    expect(ligne.inflationMeteo).toBeNull();
  });
});

/**
 * Facteur météo MESURÉ par catégorie (docs/17 fiches 2/4, décision D-059).
 *
 * `seedDemonstration` ne pose aucun relevé météo sur sa session historique
 * unique : elle n'entre donc jamais dans `observationsMeteoDuLieu`, et les
 * trois scénarios ci-dessous partent d'un historique météo entièrement
 * CONTRÔLÉ, construit à la main sur une base isolée.
 *
 * FIXTURE CORRIGÉE (docs/05-DECISIONS.md D-089, complément du 01/08/2026,
 * « cinquième cas ») : voir le commentaire de `construireBaseAvecSignalFort`
 * ci-dessous pour le calcul complet. En bref, la fixture d'origine (neuf
 * dimanches identiques) ne décrivait pas un signal trop plat pour être admis
 * — elle décrivait un ÉCHANTILLON TROP PETIT une fois honnêtement filtré par
 * date : sur neuf dimanches de même catégorie, seul le plus récent dispose
 * d'assez de dimanches antérieurs pour être évalué en validation croisée.
 */
describe('GET /api/prevision — le facteur météo mesuré par catégorie (D-059)', () => {
  function joursAvant(reference: string, n: number): string {
    const d = new Date(`${reference}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }

  /** Clôture un dimanche historique classé « ensoleillé et tiède », avec `crepesVendues` exact. */
  function cloturerDimancheTiede(
    baseTest: BaseBatte,
    lieuId: string,
    produitId: string,
    dateSession: string,
    quantite: number,
    conditions: typeof METEO_TIEDE = METEO_TIEDE,
  ): void {
    enregistrerMeteo(baseTest, {
      lieuId,
      dateObservation: dateSession,
      type: 'reelle',
      ...conditions,
      recupereLe: new Date().toISOString(),
    });
    const { id } = creerSession(baseTest, { lieuId, dateSession });
    cloturerSession(baseTest, id, {
      ventes: [{ produitVenteId: produitId, quantite, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
      fondsCaisseInitialCents: 6000,
      especesCompteesCents: 6000 + quantite * 300,
      caCarteCents: 0,
      crepesProduites: quantite,
      crepesInvendues: 0,
      crepesCassees: 0,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
    });
  }

  /**
   * Vingt dimanches passés, tous classés « ensoleillé et tiède », vendant
   * SYSTÉMATIQUEMENT bien plus que la baseline (autour de 300 contre un
   * prior de 120) : un signal fort et constant, exactement le cas où la
   * validation croisée leave-one-out DOIT admettre la mesure.
   *
   * FIXTURE CORRIGÉE (docs/05-DECISIONS.md D-089, complément du 01/08/2026,
   * cinquième cas — la troisième forme de fixture fautive : « trop plate
   * pour discriminer »). Le nombre de dimanches et l'écart de temps entre
   * eux ne sont PAS arbitraires, ils découlent d'un calcul :
   *
   * `previsions.ts` réutilise `prevision_validation_croisee_points_minimum`
   * (8) à la fois comme nombre minimal de plis évalués ET comme nombre
   * minimal d'observations PAR CATÉGORIE (`calculerFacteurMeteoMesure`,
   * `meteo-mesuree.ts`). `estimerAvecMeteoMesuree` filtre, à l'intérieur de
   * CHAQUE pli du leave-one-out, l'historique transmis aux seules sessions
   * de la MÊME catégorie DATÉES STRICTEMENT AVANT la session évaluée
   * (`mesureFacteurMeteoCategorie`, exclusion par date, pas par index —
   * c'est exactement ce que D-089 a fermé). Sur une série de N dimanches
   * identiques en catégorie, classés du plus ancien (k=1) au plus récent
   * (k=N), le dimanche k ne dispose que de (k-1) prédécesseurs de la même
   * catégorie : il ne peut donc être évalué que si (k-1) ≥ 8, c'est-à-dire
   * k ≥ 9. Le nombre de plis évaluables vaut donc (N-8), et il faut N ≥ 16
   * pour atteindre le minimum de 8. Vérifié par calcul direct sur les
   * fonctions pures de `@batte/core` (script de vérification, non conservé
   * dans le dépôt) : N=9 (fixture d'origine) → 1 seul pli évaluable ; N=16 →
   * exactement 8 ; N=20 (ci-dessous) → 12, marge confortable.
   *
   * AVANT ce correctif, les neuf dimanches à EXACTEMENT 300 crêpes ne
   * révélaient pas seulement un échantillon trop petit : ils auraient aussi
   * rendu la mesure INDISCERNABLE d'un artefact d'échantillonnage, puisque
   * moyenner n'importe quel sous-ensemble de valeurs IDENTIQUES donne
   * toujours le même résultat, quel que soit le nombre de plis réellement
   * honnêtes. Vingt dimanches ETALÉS sur ~4,6 mois (une saison de marché
   * traverse forcément plusieurs types de journées), avec des ventes qui
   * VARIENT semaine après semaine (jamais 300 pile) et des conditions météo
   * qui varient elles aussi tout en restant dans la même catégorie,
   * corrigent les DEUX défauts à la fois : assez de plis honnêtes, et un
   * signal qui n'est fort et constant que parce que les dimanches mesurés le
   * sont vraiment — pas parce que la fixture ne peut littéralement rien voir
   * d'autre.
   */
  async function construireBaseAvecSignalFort(): Promise<{
    base: BaseBatte;
    app: FastifyInstance;
  }> {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const app = construireServeur(base, { journaliser: false });
    await app.ready();

    const jour = aujourdHui();
    const session = prochaineSessionPlanifiee(base, jour)!;
    enregistrerMeteo(base, {
      lieuId: session.lieuId,
      dateObservation: session.dateSession,
      type: 'prevision',
      ...METEO_TIEDE,
      recupereLe: new Date().toISOString(),
    });

    const produit = base
      .select({ id: schema.produitVente.id })
      .from(schema.produitVente)
      .where(eq(schema.produitVente.nature, 'transforme'))
      .get()!;

    // Vingt dimanches (N ≥ 16, voir le calcul ci-dessus) : douze plis seront
    // honnêtement évaluables en validation croisée, huit de plus que le
    // minimum exigé.
    const NB_DIMANCHES = NB_DIMANCHES_SIGNAL_FORT;
    const CYCLE_CREPES = CYCLE_CREPES_SIGNAL_FORT;
    for (let i = 1; i <= NB_DIMANCHES; i += 1) {
      cloturerDimancheTiede(
        base,
        session.lieuId,
        produit.id,
        joursAvant(session.dateSession, 7 * i),
        CYCLE_CREPES[i % CYCLE_CREPES.length]!,
        conditionsTiedeSaisonniere(i),
      );
    }

    return { base, app };
  }

  it('admet le facteur mesuré quand assez de dimanches montrent un signal fort et constant', async () => {
    const { app } = await construireBaseAvecSignalFort();
    try {
      const reponse = await app.inject({ method: 'GET', url: '/api/prevision' });
      expect(reponse.statusCode).toBe(200);
      const prevision = reponse.json<Prevision>();

      expect(prevision.meteo.disponible).toBe(true);
      if (!prevision.meteo.disponible) return;
      expect(prevision.meteo.categorie).toBe('ensoleille_tiede');
      // Vingt dimanches autour de 300 crêpes contre un prior à 120 : la
      // mesure pousse NETTEMENT au-dessus du neutre — jamais en dessous,
      // jamais neutre.
      expect(prevision.facteurs.meteoBp).toBeGreaterThan(10_000);
      expect(prevision.meteo.explication).toContain('mesuré sur');
      expect(prevision.meteo.explication).toContain('20 dimanche');
    } finally {
      await app.close();
    }
  });

  it('zéro régression : sous le seuil minimal d’observations, le facteur reste au prior neutre', async () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    const app = construireServeur(base, { journaliser: false });
    await app.ready();
    try {
      const jour = aujourdHui();
      const session = prochaineSessionPlanifiee(base, jour)!;
      enregistrerMeteo(base, {
        lieuId: session.lieuId,
        dateObservation: session.dateSession,
        type: 'prevision',
        ...METEO_TIEDE,
        recupereLe: new Date().toISOString(),
      });
      const produit = base
        .select({ id: schema.produitVente.id })
        .from(schema.produitVente)
        .where(eq(schema.produitVente.nature, 'transforme'))
        .get()!;

      // Trois dimanches seulement — sous `prevision_validation_croisee_points_minimum` (8).
      for (let i = 1; i <= 3; i += 1) {
        cloturerDimancheTiede(
          base,
          session.lieuId,
          produit.id,
          joursAvant(session.dateSession, 7 * i),
          300,
        );
      }

      const reponse = await app.inject({ method: 'GET', url: '/api/prevision' });
      const prevision = reponse.json<Prevision>();
      expect(prevision.meteo.disponible).toBe(true);
      if (!prevision.meteo.disponible) return;
      expect(prevision.facteurs.meteoBp).toBe(10_000);
      expect(prevision.meteo.explication).toContain('encore 3/8');
    } finally {
      await app.close();
    }
  });

  /**
   * Le garde-fou de la fiche 07, appliqué tel quel (D-059) : « on ne
   * remplace pas un prior neutre par du bruit ». Vingt dimanches, ASSEZ
   * d'observations, mais un signal qui égale exactement la baseline neutre
   * (120 partout, prior ET observé) — la mesure n'améliore RIEN par rapport
   * au prior (déjà neutre) et doit donc être rejetée, malgré le nombre
   * d'observations.
   *
   * FIXTURE CORRIGÉE (docs/05-DECISIONS.md D-089, complément du 01/08/2026,
   * SIXIÈME cas — le plus discret : resté VERT, jamais rougi par aucun
   * correctif). Neuf dimanches était insuffisant pour la MÊME raison de
   * calendrier que le cinquième cas ci-dessus (« le facteur météo mesuré par
   * catégorie ») : sur une série de N dimanches identiques en catégorie,
   * classés du plus ancien (k=1) au plus récent (k=N), le dimanche k ne
   * dispose que de (k-1) prédécesseurs de la même catégorie, donc n'est
   * évaluable que si (k-1) ≥ 8, soit k ≥ 9 — un seul pli évaluable sur neuf
   * dimanches. Le test passait, mais parce que la validation croisée refusait
   * de rendre un verdict faute de recul (`raisonRefus` : « pas assez de recul
   * pour juger »), pas parce que la mesure avait été comparée et jugée
   * neutre : le symptôme externe (rejet, `meteoBp` neutre) coïncidait avec le
   * symptôme attendu par pur hasard de calendrier.
   *
   * Vérifié par calcul direct sur les fonctions pures de `@batte/core`
   * (`classerObservationsMeteo`, `estimerAvecMeteoMesuree`,
   * `demandeSansNouveauPredicteur`, `validerParLeaveOneOut` — script de
   * vérification, non conservé dans le dépôt, même méthode que le cinquième
   * cas) : N=9 → 1 seul pli évaluable, AUCUN verdict de MAPE rendu ; N=16 →
   * exactement 8 plis, verdict rendu, MAPE avec/sans TOUS DEUX à 0 %,
   * amélioration nulle, rejeté pour la BONNE raison ; N=20 (retenu ici,
   * marge confortable comme le cinquième cas) → 12 plis, même verdict. La
   * valeur CONSTANTE à 120 (contrairement au cinquième cas, qui a dû varier
   * ses valeurs pour ne pas rester indiscernable d'un artefact
   * d'échantillonnage) reste correcte ICI : elle sert précisément à obtenir
   * un résidu nul et déterministe — la façon la plus sûre de prouver
   * qu'aucune amélioration n'est inventée quand le signal est réellement
   * neutre, sans qu'un bruit aléatoire ne fasse pencher le MAPE d'un côté ou
   * de l'autre par accident.
   */
  it('rejette la mesure quand elle n’améliore rien, même avec assez d’observations', async () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    const app = construireServeur(base, { journaliser: false });
    await app.ready();
    try {
      const jour = aujourdHui();
      const session = prochaineSessionPlanifiee(base, jour)!;
      enregistrerMeteo(base, {
        lieuId: session.lieuId,
        dateObservation: session.dateSession,
        type: 'prevision',
        ...METEO_TIEDE,
        recupereLe: new Date().toISOString(),
      });
      const produit = base
        .select({ id: schema.produitVente.id })
        .from(schema.produitVente)
        .where(eq(schema.produitVente.nature, 'transforme'))
        .get()!;

      // Vingt dimanches à EXACTEMENT 120 crêpes (N ≥ 16, voir le calcul
      // ci-dessus) : douze plis honnêtement évaluables, huit de plus que le
      // minimum exigé. 120 = identique au prior de baseline
      // (`prevision_prior_baseline_crepes`), donc un résidu parfaitement
      // neutre — aucune amélioration possible sur le prior déjà neutre de
      // `ensoleille_tiede`.
      const NB_DIMANCHES = NB_DIMANCHES_SIGNAL_FORT;
      for (let i = 1; i <= NB_DIMANCHES; i += 1) {
        cloturerDimancheTiede(
          base,
          session.lieuId,
          produit.id,
          joursAvant(session.dateSession, 7 * i),
          CREPES_EGALES_AU_PRIOR,
        );
      }

      const reponse = await app.inject({ method: 'GET', url: '/api/prevision' });
      const prevision = reponse.json<Prevision>();
      expect(prevision.meteo.disponible).toBe(true);
      if (!prevision.meteo.disponible) return;
      expect(prevision.facteurs.meteoBp).toBe(10_000);
      expect(prevision.meteo.explication).toContain('rejeté');
    } finally {
      await app.close();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Défaut 2 — `GET /prevision` et `GET /prevision/brief` appelaient RÉELLEMENT
   `releverMeteo()` (donc `https://api.open-meteo.com`) dès qu'aucune ligne
   météo n'était encore en cache pour la date de la session — exactement le
   cas d'une base fraîchement construite en mémoire (`smoke-routes-lecture.test.ts`
   balaie `/api/prevision` sur une base migrée + seedée SANS jamais appeler
   `enregistrerMeteo` au préalable). Un test qui dépend du réseau n'est pas un
   test (CLAUDE.md).

   Correction retenue : `routesPrevisions` accepte désormais un second
   paramètre optionnel, `{ racineUrlMeteo }`, simple relais jusqu'à
   `releverMeteo` (apps/api/src/meteo/open-meteo.ts), qui accepte déjà ce
   paramètre pour cette raison précise. Omis, il vaut `undefined` et
   `releverMeteo` retombe sur la vraie racine Open-Meteo — comportement de
   PRODUCTION inchangé (`serveur.ts` continue d'appeler `routesPrevisions(base)`
   sans le second argument).

   Preuve retenue ICI, plus stricte qu'un simple « le test est rapide » :
   un espion posé sur `globalThis.fetch` (`vi.spyOn`, qui appelle TOUJOURS
   l'implémentation réelle — ce n'est PAS un bouchon du réseau, seulement une
   observation de ce qui part) enregistre CHAQUE URL appelée pendant le test,
   et l'assertion vérifie qu'AUCUNE ne vise `api.open-meteo.com` — la seule
   cible autorisée est le serveur `node:http` local démarré ci-dessous (même
   recette que `apps/api/src/meteo/open-meteo.test.ts` et
   `apps/api/src/ia/client.test.ts`). Un bouchon global du réseau aurait
   masqué un vrai défaut d'appel (mauvaise URL, mauvais paramètres) ; cet
   espion, lui, laisse l'appel réel partir vers le serveur local et ne fait
   que constater sa destination.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('injection du réseau météo (racineUrlMeteo) — aucun appel réel à Open-Meteo pendant les tests', () => {
  /** Sert TOUJOURS le même corps JSON, quelle que soit la requête reçue — jamais le vrai Open-Meteo. */
  function demarrerServeurMeteoLocal(
    corps: unknown,
  ): Promise<{ url: string; fermer: () => Promise<void> }> {
    return new Promise((resolve) => {
      const serveur: Server = createServer((requete, reponse) => {
        requete.on('data', () => {});
        requete.on('end', () => {
          reponse.writeHead(200, { 'content-type': 'application/json' });
          reponse.end(JSON.stringify(corps));
        });
      });
      serveur.listen(0, '127.0.0.1', () => {
        const adresse = serveur.address();
        const port = typeof adresse === 'object' && adresse !== null ? adresse.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}`,
          fermer: () => new Promise((resoudre) => serveur.close(() => resoudre())),
        });
      });
    });
  }

  /** Réponse Open-Meteo minimale mais complète (24 h), fenêtre 08:00-14:30 couverte. */
  function reponseOpenMeteoPour(date: string): unknown {
    const heures = Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`);
    const remplir = (valeur: number): number[] => heures.map(() => valeur);
    return {
      hourly: {
        time: heures,
        temperature_2m: remplir(15),
        precipitation: remplir(0),
        wind_speed_10m: remplir(10),
        cloud_cover: remplir(50),
        apparent_temperature: remplir(13.5),
        precipitation_probability: remplir(42),
        weather_code: remplir(3),
      },
      hourly_units: {
        temperature_2m: '°C',
        apparent_temperature: '°C',
        precipitation: 'mm',
        precipitation_probability: '%',
        wind_speed_10m: 'km/h',
        cloud_cover: '%',
        weather_code: 'wmo code',
      },
    };
  }

  /**
   * Base de test fraîche, sans AUCUNE météo en cache — exactement le cas qui
   * déclenchait le vrai appel réseau.
   *
   * `seedDemonstrationActivite` (D-082, voir le commentaire du premier
   * `describe` de ce fichier) : ne touche à AUCUNE ligne météo, donc n'entre
   * pas en conflit avec « sans météo en cache » — elle donne seulement au
   * lieu de la session à venir UNE session close, condition sine qua non pour
   * qu'une prévision existe du tout.
   */
  function baseSansMeteoEnCache(): {
    base: BaseBatte;
    session: { lieuId: string; dateSession: string };
  } {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    seedDemonstrationActivite(base);
    const session = prochaineSessionPlanifiee(base, aujourdHui())!;
    return { base, session };
  }

  it('GET /prevision : écrit le relevé du serveur local en base, aucun appel ne vise Open-Meteo réel', async () => {
    const { base, session } = baseSansMeteoEnCache();
    const serveurMeteo = await demarrerServeurMeteoLocal(reponseOpenMeteoPour(session.dateSession));
    const app = Fastify();
    await app.register(routesPrevisions(base, { racineUrlMeteo: serveurMeteo.url }));
    await app.ready();

    const espionFetch = vi.spyOn(globalThis, 'fetch');
    try {
      // Confirme la prémisse : aucune ligne météo pour cette date avant l'appel.
      expect(lireMeteo(base, session.lieuId, session.dateSession)).toBeNull();

      const reponse = await app.inject({ method: 'GET', url: '/prevision' });
      expect(reponse.statusCode).toBe(200);
      const prevision = reponse.json<Prevision>();
      expect(prevision.meteo.disponible).toBe(true);

      // Preuve « comment » : chaque appel réellement parti (l'espion ne
      // bouchonne rien, il observe) vise le serveur LOCAL, jamais le vrai
      // service.
      expect(espionFetch).toHaveBeenCalled();
      for (const appel of espionFetch.mock.calls) {
        const urlAppelee = String(appel[0]);
        expect(urlAppelee.startsWith(serveurMeteo.url)).toBe(true);
        expect(urlAppelee).not.toContain('open-meteo.com');
      }

      // Preuve défaut 1, câblée jusqu'à la route : une vraie valeur (issue du
      // serveur local, pas inventée) atteint les quatre colonnes.
      const ligne = lireMeteo(base, session.lieuId, session.dateSession);
      expect(ligne).not.toBeNull();
      expect(ligne!.temperatureRessentieC).toBe(13.5);
      expect(ligne!.probabilitePluieBp).toBe(4200); // 42 % -> 4200 bp, jamais 42.
      expect(ligne!.codeMeteo).toBe(3);
      expect(ligne!.donneesBrutes).not.toBeNull();
    } finally {
      espionFetch.mockRestore();
      await app.close();
      await serveurMeteo.fermer();
    }
  });

  it('GET /prevision/brief : même garantie sur la route qui génère le PDF avant-marché', async () => {
    const { base, session } = baseSansMeteoEnCache();
    const serveurMeteo = await demarrerServeurMeteoLocal(reponseOpenMeteoPour(session.dateSession));
    const app = Fastify();
    await app.register(routesPrevisions(base, { racineUrlMeteo: serveurMeteo.url }));
    await app.ready();

    const espionFetch = vi.spyOn(globalThis, 'fetch');
    try {
      const reponse = await app.inject({ method: 'GET', url: '/prevision/brief' });
      expect(reponse.statusCode).toBe(200);

      expect(espionFetch).toHaveBeenCalled();
      for (const appel of espionFetch.mock.calls) {
        const urlAppelee = String(appel[0]);
        expect(urlAppelee.startsWith(serveurMeteo.url)).toBe(true);
        expect(urlAppelee).not.toContain('open-meteo.com');
      }

      const ligne = lireMeteo(base, session.lieuId, session.dateSession);
      expect(ligne?.temperatureRessentieC).toBe(13.5);
    } finally {
      espionFetch.mockRestore();
      await app.close();
      await serveurMeteo.fermer();
      await fermerNavigateur();
    }
    // 60 s, pas 20 : même repère que `apps/api/src/routes/audit-robustesse.test.ts`
    // et `apps/api/src/smoke-routes-lecture.test.ts` — le démarrage de
    // Chromium (Playwright) n'est pas à durée fixe et se mesure nettement plus
    // lent quand la suite complète tourne avec plusieurs fichiers en
    // parallèle (contention CPU), ce qu'une exécution isolée de ce seul
    // fichier ne révèle pas.
  }, 60_000);

  it('sans racineUrlMeteo (défaut de production) : le paramètre reste optionnel, la route répond quand la météo est déjà en cache', async () => {
    // Ce test ne doit déclencher AUCUN appel réseau : la météo est déjà
    // conservée pour la date de la session, donc `obtenirMeteo` ne consulte
    // jamais `releverMeteo` — il vérifie que l'API par défaut de
    // `routesPrevisions(base)` (sans options, exactement l'appel de
    // `serveur.ts`) reste utilisable après ce lot.
    const { base, session } = baseSansMeteoEnCache();
    enregistrerMeteo(base, {
      lieuId: session.lieuId,
      dateObservation: session.dateSession,
      type: 'prevision',
      temperatureC: 15,
      precipitationsMm: 0,
      ventKmh: 5,
      couvertureNuageuseBp: 8000,
      recupereLe: new Date().toISOString(),
    });

    const app = Fastify();
    await app.register(routesPrevisions(base));
    await app.ready();

    const espionFetch = vi.spyOn(globalThis, 'fetch');
    try {
      const reponse = await app.inject({ method: 'GET', url: '/prevision' });
      expect(reponse.statusCode).toBe(200);
      expect(espionFetch).not.toHaveBeenCalled();
    } finally {
      espionFetch.mockRestore();
      await app.close();
    }
  });
});

/**
 * `POST /prevision/brief/commenter` (mission « brief vs écrans / D-087 »,
 * 01/08/2026) : câble enfin `briefAvantMarche` d'`apps/api/src/ia/usages.ts`,
 * jusqu'ici appelée par son seul test — la quatrième instance du motif
 * « l'aval complet et testé, l'amont manquant » (docs/05-DECISIONS.md D-087).
 *
 * Ces tests ne dépensent JAMAIS un appel réel : aucune `ANTHROPIC_API_KEY`
 * n'est configurée dans cet environnement de test (même garantie que
 * `apps/api/src/routes/ia.test.ts` et `apps/api/src/ia/client.test.ts`), et la
 * météo est PRÉ-ENREGISTRÉE en base pour que `previsionCourante` n'émette
 * elle non plus AUCUNE requête réseau — un espion posé sur `fetch` le PROUVE
 * plutôt que de le supposer (même patron que le bloc météo ci-dessus).
 */
describe('POST /prevision/brief/commenter — le prompt Claude orphelin (D-087), maintenant câblé', () => {
  /** Base de démonstration avec la météo de la prochaine session déjà en cache. */
  function baseAvecMeteoEnCache(): {
    base: BaseBatte;
    session: { lieuId: string; dateSession: string };
  } {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    seedDemonstrationActivite(base);
    const session = prochaineSessionPlanifiee(base, aujourdHui())!;
    enregistrerMeteo(base, {
      lieuId: session.lieuId,
      dateObservation: session.dateSession,
      type: 'prevision',
      temperatureC: 18,
      precipitationsMm: 0,
      ventKmh: 8,
      couvertureNuageuseBp: 4000,
      recupereLe: new Date().toISOString(),
    });
    return { base, session };
  }

  it('reste utilisable sans clé Anthropic (mode dégradé, CLAUDE.md §5) et ne tente AUCUN appel réseau', async () => {
    const { base } = baseAvecMeteoEnCache();
    const app = Fastify();
    await app.register(routesPrevisions(base));
    await app.ready();

    const espionFetch = vi.spyOn(globalThis, 'fetch');
    try {
      const reponse = await app.inject({ method: 'POST', url: '/prevision/brief/commenter' });

      // Le défaut réel corrigé par cette mission : cette route n'existait pas
      // du tout (404 systématique). Elle doit désormais répondre, et
      // honnêtement dire que l'assistance est indisponible plutôt que
      // planter ou inventer un commentaire.
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json<{ disponible: boolean; raison?: string }>();
      expect(corps.disponible).toBe(false);
      expect(corps.raison).toContain('ANTHROPIC_API_KEY');

      // Aucune requête n'est partie : ni vers Open-Meteo (météo déjà en
      // cache, donc `obtenirMeteo` ne consulte jamais `releverMeteo`), ni
      // vers Anthropic (pas de clé configurée : `demanderCommentaire` rend
      // son refus AVANT toute tentative réseau, `ia/client.ts`).
      expect(espionFetch).not.toHaveBeenCalled();
    } finally {
      espionFetch.mockRestore();
      await app.close();
    }
  });

  /**
   * Chemin « succès » — celui qu'aucun test de ce dépôt n'exerçait encore
   * pour AUCUN usage IA (`apps/api/src/ia/client.test.ts` ne couvre que le
   * mode dégradé et les pannes HTTP, jamais un 200 exploité jusqu'au bout).
   * Même recette qu'`ia/client.test.ts` (« panne HTTP réelle ») et
   * qu'`apps/api/src/routes/evenements-decouverte.test.ts` : un serveur
   * `node:http` local IMITE la forme d'une réponse `messages.create` réussie,
   * `ANTHROPIC_BASE_URL` pointe dessus — la requête ne quitte donc JAMAIS ce
   * poste, et la clé posée ci-dessous est un jeton de test, pas une vraie clé.
   */
  it('appel Claude réussi (serveur local, JAMAIS Anthropic) : la réponse suit le contrat `schemaCommentaireIa`', async () => {
    const { base } = baseAvecMeteoEnCache();

    function demarrerServeurAnthropicLocal(
      texte: string,
    ): Promise<{ url: string; fermer: () => Promise<void> }> {
      return new Promise((resolve) => {
        const serveur: Server = createServer((requete, reponse) => {
          requete.on('data', () => {});
          requete.on('end', () => {
            reponse.writeHead(200, { 'content-type': 'application/json' });
            reponse.end(
              JSON.stringify({
                id: 'msg_test_local',
                type: 'message',
                role: 'assistant',
                model: 'claude-sonnet-test',
                content: [{ type: 'text', text: texte }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 500, output_tokens: 80 },
              }),
            );
          });
        });
        serveur.listen(0, '127.0.0.1', () => {
          const adresse = serveur.address();
          const port = typeof adresse === 'object' && adresse !== null ? adresse.port : 0;
          resolve({
            url: `http://127.0.0.1:${port}`,
            fermer: () => new Promise((resoudre) => serveur.close(() => resoudre())),
          });
        });
      });
    }

    const serveurAnthropic = await demarrerServeurAnthropicLocal(
      'Marché calme annoncé : gardez un œil sur le stock de lait.',
    );
    const cleAvant = process.env['ANTHROPIC_API_KEY'];
    const urlAvant = process.env['ANTHROPIC_BASE_URL'];
    // Marqueur `SENTINELLE` obligatoire (voir `securite-secrets.test.ts`, « aucune
    // source ne porte une clé en clair ») : c'est précisément ce qui distingue
    // ce jeton de test d'un secret réel dans le balayage anti-fuite du dépôt.
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-SENTINELLE0PREVISIONS0TEST0JAMAIS0REEL';
    process.env['ANTHROPIC_BASE_URL'] = serveurAnthropic.url;
    reinitialiserClientIa();

    const app = Fastify();
    await app.register(routesPrevisions(base));
    await app.ready();

    try {
      const reponse = await app.inject({ method: 'POST', url: '/prevision/brief/commenter' });

      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json<{ disponible: boolean; texte?: string; coutCents?: number }>();
      expect(corps.disponible).toBe(true);
      expect(corps.texte).toContain('lait');
      // Un cout REELLEMENT calcule depuis les tokens du serveur local, jamais
      // zero ni invente.
      expect(corps.coutCents).toBeGreaterThan(0);
    } finally {
      await app.close();
      await serveurAnthropic.fermer();
      if (cleAvant === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = cleAvant;
      if (urlAvant === undefined) delete process.env['ANTHROPIC_BASE_URL'];
      else process.env['ANTHROPIC_BASE_URL'] = urlAvant;
      reinitialiserClientIa();
    }
  });

  it("refuse 404 pour l'ancien nom de route homonyme du gabarit PDF, preuve qu'aucune confusion ne subsiste", async () => {
    // Non-régression volontaire : `GET /prevision/brief` (le PDF déterministe)
    // et `POST /prevision/brief/commenter` (le commentaire Claude) sont deux
    // routes distinctes. Appeler la seconde en GET ne doit jamais retomber
    // silencieusement sur la première.
    const { base } = baseAvecMeteoEnCache();
    const app = Fastify();
    await app.register(routesPrevisions(base));
    await app.ready();

    const reponse = await app.inject({ method: 'GET', url: '/prevision/brief/commenter' });
    expect(reponse.statusCode).toBe(404);

    await app.close();
  });
});

/**
 * `session.lieuId` du contrat `GET /prevision` (mission du 31/07/2026,
 * docs/demandes/10) : remplace la résolution par NOM que
 * `ProchaineSession.tsx` devait faire elle-même (`resoudreLieuIdParNom`,
 * supprimée) depuis `session.lieuNom`, seul champ que le contrat exposait
 * jusqu'ici. `lieu_marche.nom` n'est pas contraint UNIQUE en base
 * (`packages/db/src/schema.ts`) : le jeu ci-dessous pose donc DEUX lieux du
 * MÊME nom — exactement le cas qui rendait l'ancienne résolution par nom
 * ambiguë — pour prouver que le contrat, lui, ne se trompe jamais : il porte
 * la vraie clé étrangère de la session, pas un libellé.
 */
describe('GET /prevision — session.lieuId, jamais un nom à deviner', () => {
  it('rend le lieuId réel de la session, distinct de son homonyme, et respecte le contrat Zod', async () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    // D-082 : une session close sur ce lieu, sans quoi `/api/prevision` ne
    // rendrait plus une prévision du tout (voir le commentaire du premier
    // `describe` de ce fichier).
    seedDemonstrationActivite(base);

    const session = prochaineSessionPlanifiee(base, aujourdHui())!;

    // Second lieu, EXACTEMENT le même nom que celui de la session à venir :
    // le cas qui rendrait une résolution par NOM ambiguë. La clé étrangère
    // `session_marche.lieu_id`, elle, ne peut jamais confondre les deux.
    const maintenant = new Date().toISOString();
    const lieuHomonymeId = nouvelIdentifiant();
    base
      .insert(schema.lieuMarche)
      .values({
        id: lieuHomonymeId,
        nom: session.lieuNom,
        latitude: session.latitude,
        longitude: session.longitude,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    // Météo neutre et déjà conservée, même raison que les autres describe de
    // ce fichier : aucun appel réseau réel pendant ce test.
    enregistrerMeteo(base, {
      lieuId: session.lieuId,
      dateObservation: session.dateSession,
      type: 'prevision',
      temperatureC: 15,
      precipitationsMm: 0,
      ventKmh: 5,
      couvertureNuageuseBp: 8000,
      recupereLe: new Date().toISOString(),
    });

    const app = Fastify();
    await app.register(routesPrevisions(base));
    await app.ready();

    try {
      const reponse = await app.inject({ method: 'GET', url: '/prevision' });
      expect(reponse.statusCode).toBe(200);

      // Passe explicitement par `.parse()`, pas seulement `.json<Prevision>()` :
      // `vuePrevision` (apps/api/src/routes/previsions.ts) rend `unknown`, donc
      // un champ oublié dans cette vue serait invisible à `tsc` — exactement
      // le défaut, documenté sur `SessionPlanifiee`
      // (`packages/db/src/depots/previsions.ts`), qui a coûté quatre routes
      // d'un coup à ce projet le 29/07/2026. Seul `.parse()` le révèle avant
      // un vrai appel HTTP.
      const prevision = schemaPrevision.parse(reponse.json());

      expect(prevision.session).not.toBeNull();
      expect(prevision.session!.lieuId).toBe(session.lieuId);
      expect(prevision.session!.lieuId).not.toBe(lieuHomonymeId);
      expect(prevision.session!.lieuNom).toBe(session.lieuNom);
    } finally {
      await app.close();
    }
  });
});

/**
 * D-082 (`docs/05-DECISIONS.md`) : `GET /prevision-calendaire` (« Besoins
 * projetés ») agrège plusieurs lieux sur un même horizon. Avant ce correctif,
 * un lieu jamais visité y recevait quand même un chiffre entièrement issu du
 * prior (`prevision_prior_baseline_crepes`) — pendant que `GET /prevision`
 * (« Prochaine session ») refusait de répondre pour ce même lieu. Deux écrans,
 * deux réponses opposées.
 *
 * Ce test construit délibérément DEUX lieux dans le même horizon : La Batte,
 * avec une session close (une seule, D-082 l'exige déjà des), et un second
 * lieu tout neuf, actif et récurrent, mais SANS AUCUNE session close nulle
 * part. Un jeu à un seul lieu n'aurait pas suffi (voir la mise en garde de ce
 * fichier plus haut) : `previsionCalendaireComplete`
 * (`apps/api/src/routes/previsions.ts`) calcule la baseline UNE FOIS PAR LIEU
 * — sans un second lieu réellement absent de l'historique, un bug qui
 * oublierait de vérifier le seuil PAR LIEU (par ex. en le vérifiant une seule
 * fois globalement) passerait inaperçu.
 */
describe('GET /prevision-calendaire — D-082, un lieu jamais visité n’entre dans aucun total', () => {
  it('écarte les occurrences d’un lieu sans session close, sans toucher à celles d’un lieu avec une session close', async () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const session = prochaineSessionPlanifiee(base, aujourdHui())!;

    // Une session historique close à La Batte, même primitive que le
    // describe Mission 1 ci-dessus : sans elle, La Batte serait ELLE AUSSI en
    // premier passage, et ce test ne distinguerait plus rien.
    const produitHistorique = base
      .select({ id: schema.produitVente.id })
      .from(schema.produitVente)
      .where(eq(schema.produitVente.nature, 'transforme'))
      .get()!;
    const sessionHistoriqueId = creerSession(base, {
      lieuId: session.lieuId,
      dateSession: joursAvantMission1(session.dateSession),
    }).id;
    cloturerSession(base, sessionHistoriqueId, {
      ventes: [{ produitVenteId: produitHistorique.id, quantite: 120, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 120 * 300,
      caCarteCents: 0,
      crepesProduites: 120,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    // Météo neutre et déjà conservée pour la session à venir de La Batte :
    // aucun appel réseau réel pendant ce test.
    enregistrerMeteo(base, {
      lieuId: session.lieuId,
      dateObservation: session.dateSession,
      type: 'prevision',
      temperatureC: 15,
      precipitationsMm: 0,
      ventKmh: 5,
      couvertureNuageuseBp: 8000,
      recupereLe: new Date().toISOString(),
    });

    // Second lieu, actif et récurrent (jourSemaine), mais JAMAIS visité :
    // aucune session, close ou non, nulle part dans la base.
    // `occurrencesCandidates` (packages/db/src/depots/previsions.ts) le fait
    // apparaître chaque semaine sur l'horizon, exactement comme La Batte.
    const jourSemaineLaBatte = base
      .select({ jourSemaine: schema.lieuMarche.jourSemaine })
      .from(schema.lieuMarche)
      .where(eq(schema.lieuMarche.id, session.lieuId))
      .get()!.jourSemaine!;
    // Jour distinct de celui de La Batte : deux occurrences du même jour
    // rendraient l'attribution des lignes ambiguë dans les assertions.
    const jourSemaineLieuJamaisVisite = (jourSemaineLaBatte + 3) % 7;

    const maintenant = new Date().toISOString();
    const lieuJamaisVisiteId = nouvelIdentifiant();
    const lieuJamaisVisiteNom = 'Lieu jamais visité (D-082)';
    base
      .insert(schema.lieuMarche)
      .values({
        id: lieuJamaisVisiteId,
        nom: lieuJamaisVisiteNom,
        latitude: null,
        longitude: null,
        actif: true,
        jourSemaine: jourSemaineLieuJamaisVisite,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const app = Fastify();
    await app.register(routesPrevisions(base));
    await app.ready();

    try {
      const reponse = await app.inject({
        method: 'GET',
        url: '/prevision-calendaire?horizonJours=28',
      });
      expect(reponse.statusCode).toBe(200);

      const prevision = schemaPrevisionCalendaire.parse(reponse.json());
      const tousLesJours = prevision.semaines.flatMap((semaine) => semaine.jours);

      // Le lieu jamais visité apparaît bien dans l'horizon (sinon le test ne
      // prouverait rien — voir la mise en garde de ce fichier)…
      const joursLieuJamaisVisite = tousLesJours.filter(
        (jour) => jour.lieuNom === lieuJamaisVisiteNom,
      );
      expect(joursLieuJamaisVisite.length).toBeGreaterThan(0);
      // … mais AUCUNE de ses occurrences n'est exploitable : D-082 l'exclut
      // de tout total, quelle que soit la largeur de son intervalle.
      for (const jour of joursLieuJamaisVisite) {
        expect(jour.exploitable).toBe(false);
      }

      // La Batte, elle, a une session close : ses occurrences restent
      // exploitables — LA preuve qu'une seule session close suffit à
      // retrouver un chiffre, pas seulement au niveau unitaire
      // (`previsionPourDateCandidate`, testé isolément dans
      // `previsions-calendaire-exploitabilite.test.ts`) mais bien de bout en
      // bout, à travers la vraie route HTTP et la vraie base.
      const joursLaBatte = tousLesJours.filter((jour) => jour.lieuNom === session.lieuNom);
      expect(joursLaBatte.length).toBeGreaterThan(0);
      expect(joursLaBatte.some((jour) => jour.exploitable)).toBe(true);

      // Aucun total hebdomadaire ne doit rien devoir au lieu jamais visité :
      // recalculé à la main à partir des seuls jours exploitables, il doit
      // égaler EXACTEMENT `semaine.crepesPrevues` — jamais moins (un total
      // qui les compterait quand même), jamais plus (un total qui les
      // supprimerait deux fois).
      for (const semaine of prevision.semaines) {
        const totalAttendu = semaine.jours
          .filter((jour) => jour.exploitable)
          .reduce((somme, jour) => somme + jour.crepesRecommandees, 0);
        expect(semaine.crepesPrevues).toBe(totalAttendu);
      }
    } finally {
      await app.close();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Isolement des cinq prédicteurs de précision — outillage COMMUN
   ═══════════════════════════════════════════════════════════════════════════ */

/** Les cinq champs de précision du contrat, tels que l'écran « Prochaine session » les lit. */
const FACTEURS_DE_PRECISION = [
  'comparableCalendaireBp',
  'jourSemaineBp',
  'vacancesScolairesBp',
  'sessionConsecutiveBp',
  'inflationSigmaMeteoBp',
] as const;
type FacteurDePrecision = (typeof FACTEURS_DE_PRECISION)[number];

/**
 * Un seul prédicteur admis, les quatre autres muets.
 *
 * C'est l'assertion qui rend la preuve par mutation INTERPRÉTABLE : sans elle,
 * un test vert ne dirait pas LEQUEL des cinq câblages il garde, et neutraliser
 * un prédicteur pourrait faire rougir le test d'un autre.
 *
 * DÉCLARÉE UNE SEULE FOIS, au niveau du module, et non recopiée dans chaque
 * `describe` : les quatre gardes d'activation doivent parler de la MÊME liste
 * de cinq champs. Une liste retapée dans un second `describe` resterait verte
 * pendant qu'un sixième prédicteur apparaîtrait dans le contrat sans que
 * personne ne l'y ajoute — exactement le défaut que
 * `previsions-fixtures-partagees.ts` a fermé sur les fixtures.
 *
 * ISOLEMENT MESURÉ LE 02/08/2026, prédicteur par prédicteur : en remplaçant
 * par `false` les TROIS sites de câblage d'un prédicteur dans
 * `routes/previsions.ts`, puis en rejouant les trois fichiers
 * `previsions*.test.ts` d'`apps/api` en ENTIER (jamais `vitest -t`, docs/39
 * §10) — « comparable calendaire » : 1 rouge ; « vacances scolaires » : 1 ;
 * « session consécutive » : 1 ; « écart météo » : 1 ; « jour de la semaine » :
 * 2, et c'est voulu — ce prédicteur-là est gardé par DEUX tests (la
 * décomposition rendue, puis l'archivage) qui partagent son `beforeAll`, pas
 * par deux fixtures qui s'activeraient l'une l'autre. Aucune mutation ne fait
 * rougir le test d'un AUTRE prédicteur : les cinq fixtures sont bien isolées.
 */
function seulPredicteurAdmis(prevision: Prevision, attendu: FacteurDePrecision): void {
  for (const cle of FACTEURS_DE_PRECISION) {
    if (cle === attendu) expect(prevision.facteurs[cle]).toBeDefined();
    else expect(prevision.facteurs[cle]).toBeUndefined();
  }
}

/**
 * Prédicteur d'ÉCART MÉTÉO prévu/réalisé (`inflationSigmaMeteoBp`).
 *
 * POURQUOI CE `describe` EXISTE. Cinq prédicteurs sont câblés par
 * `routes/previsions.ts`, chacun à TROIS endroits (l'appel à `prevoir`, la
 * décomposition rendue, l'archivage). Un seul — « jour de la semaine » — avait
 * un test qui le voyait ACTIF ; les quatre autres n'étaient jamais assertés
 * autrement que `toBeUndefined()`.
 *
 * Vérifié PAR MUTATION le 01/08/2026 : en neutralisant les douze sites de
 * câblage de ces quatre prédicteurs, les 34 tests de `previsions*.test.ts`
 * restaient VERTS. Le commentaire du `describe` « jour de la semaine » énonce
 * lui-même le risque — « sans ce test, une garantie de non-régression parfaite
 * pourrait cacher un câblage qui ne branche RIEN nulle part » — mais le
 * raisonnement n'avait été mené que pour un prédicteur sur cinq.
 *
 * CE PRÉDICTEUR EST À PART, et c'est pour cela qu'il est le plus simple à
 * activer : `calculerPredicteursPrecision` l'admet SANS validation croisée
 * leave-one-out, à la différence des quatre autres. La raison est écrite dans
 * le moteur : il n'élargit que l'INTERVALLE, jamais l'estimation médiane — son
 * « amélioration de MAPE » vaudrait donc zéro par construction, et il ne
 * serait jamais admis si on lui appliquait le même juge.
 */
describe('GET /api/prevision — le prédicteur d’écart météo prévu/réalisé (D-089)', () => {
  function joursAvantEcart(reference: string, n: number): string {
    const d = new Date(`${reference}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }

  /*
   * HORLOGE FIGÉE SUR UN MERCREDI — sans quoi ce test est rouge UN JOUR SUR
   * SEPT, et il l'a été dès le lendemain de sa rédaction (02/08/2026).
   *
   * LE MÉCANISME, mesuré et non supposé. `seedProchaineSession`
   * (`packages/db/src/seed/demonstration.ts`) plante sa session « au prochain
   * jour de marché du lieu » ; à La Batte c'est le dimanche, et l'écart vaut
   * ZÉRO quand on est déjà dimanche. `prochaineSessionPlanifiee` rend alors la
   * session DU JOUR, `previsionCourante` en déduit un horizon de zéro jour, et
   * `ecartMeteoPrevueRealisee` refuse par construction (`horizonJours <= 0` →
   * `actif: false`) : une météo qui n'est plus une prévision n'a aucune
   * incertitude d'horizon à faire payer à l'intervalle. Le refus est correct ;
   * c'est la fixture qui demandait une admission que ses propres données ne
   * pouvaient pas justifier — docs/39 §3, DEUXIÈME forme (« elle décrit un cas
   * impossible »), et non un prédicteur cassé ni une cross-activation.
   *
   * POURQUOI FIGER PLUTÔT QUE RATTRAPER AU CAS PAR CAS. Une correction
   * conditionnelle (« si la session tombe aujourd'hui, la clôturer et en
   * planter une autre ») ferait suivre au test DEUX chemins différents selon le
   * jour où on le joue — donc un chemin sur deux jamais exercé le jour où on le
   * relit. L'horloge figée lui fait décrire la MÊME situation les sept jours de
   * la semaine, horizon compris (quatre jours, mercredi → dimanche).
   *
   * POURQUOI LE MERCREDI LE PLUS RÉCENT ET NON UNE DATE ABSOLUE. Une date
   * écrite en dur finirait par décrire un passé impossible (docs/39 §3,
   * première forme) et gèlerait aussi le millésime des paramètres légaux. Ici
   * l'horloge reste à moins d'une semaine du jour réel, et TOUT le jeu de
   * démonstration — qui se construit relativement à `new Date()` — en découle.
   *
   * SEUL `Date` EST SIMULÉ (`toFake: ['Date']`) : les minuteries de Fastify
   * restent sur l'horloge réelle. Simuler aussi `setTimeout` obligerait à
   * avancer l'horloge à la main pendant `app.ready()` et `app.inject()`, pour
   * rien — c'est la DATE DU JOUR qui est en cause, pas le passage du temps.
   */
  beforeAll(() => {
    const maintenant = new Date();
    const reculJours = (maintenant.getUTCDay() - 3 + 7) % 7;
    const mercredi = new Date(
      Date.UTC(
        maintenant.getUTCFullYear(),
        maintenant.getUTCMonth(),
        maintenant.getUTCDate() - reculJours,
        12,
        0,
        0,
      ),
    );
    vi.useFakeTimers({ toFake: ['Date'], now: mercredi });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('admet le prédicteur quand assez de paires prévu/réalisé montrent un écart, et le FAIT APPARAÎTRE', async () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const app = construireServeur(base, { journaliser: false });
    await app.ready();
    try {
      const jour = aujourdHui();
      const session = prochaineSessionPlanifiee(base, jour)!;

      // Météo de la session à VENIR : posée en base pour qu'aucun appel réseau
      // réel ne parte vers Open-Meteo pendant ce test.
      enregistrerMeteo(base, {
        lieuId: session.lieuId,
        dateObservation: session.dateSession,
        type: 'prevision',
        ...METEO_TIEDE,
        recupereLe: new Date().toISOString(),
      });

      // Une session close est nécessaire AVANT tout : sans elle, la route
      // entière refuse en 422 `premier_passage_lieu` (D-082) et aucun des cinq
      // prédicteurs n'est même calculé. Ce garde-fou n'a rien à voir avec ce
      // prédicteur, mais il le bloque en pratique.
      const produit = base
        .select({ id: schema.produitVente.id })
        .from(schema.produitVente)
        .where(eq(schema.produitVente.nature, 'transforme'))
        .get()!;
      const dateClose = joursAvantEcart(session.dateSession, 7);
      const { id: idClose } = creerSession(base, {
        lieuId: session.lieuId,
        dateSession: dateClose,
      });
      cloturerSession(base, idClose, {
        ventes: [{ produitVenteId: produit.id, quantite: 120, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
        fondsCaisseInitialCents: 6000,
        especesCompteesCents: 6000 + 120 * 300,
        caCarteCents: 0,
        crepesProduites: 120,
        crepesInvendues: 0,
        crepesCassees: 0,
        heureDebutReelle: '08:00',
        heureFinReelle: '14:30',
      });

      /*
       * HUIT paires (prévu, réalisé) — le minimum exigé par
       * `prevision_ecart_meteo_paires_minimum`. Chaque paire est DEUX lignes
       * `meteo_observation` sur la MÊME date et le MÊME lieu : l'une `prevision`
       * (avec un `recupereLe` antérieur, d'où se déduit l'horizon), l'autre
       * `reelle`.
       *
       * L'écart de température ALTERNE de signe (+4 / -4 °C) : une fixture où
       * la prévision se tromperait TOUJOURS dans le même sens décrirait un
       * BIAIS systématique, pas une INCERTITUDE — or c'est bien la dispersion
       * que ce prédicteur mesure pour élargir l'intervalle.
       */
      const NB_PAIRES = 8;
      for (let i = 1; i <= NB_PAIRES; i += 1) {
        const dateObservation = joursAvantEcart(session.dateSession, 7 * i + 14);
        const ecartC = i % 2 === 0 ? 4 : -4;
        enregistrerMeteo(base, {
          lieuId: session.lieuId,
          dateObservation,
          type: 'prevision',
          ...METEO_TIEDE,
          recupereLe: `${joursAvantEcart(dateObservation, 7)}T06:00:00.000Z`,
        });
        enregistrerMeteo(base, {
          lieuId: session.lieuId,
          dateObservation,
          type: 'reelle',
          ...METEO_TIEDE,
          temperatureC: METEO_TIEDE.temperatureC + ecartC,
          recupereLe: `${dateObservation}T20:00:00.000Z`,
        });
      }

      const reponse = await app.inject({ method: 'GET', url: '/api/prevision' });
      expect(reponse.statusCode).toBe(200);
      const prevision = reponse.json<Prevision>();

      // ADMIS, et LUI SEUL. La première moitié distingue « le prédicteur est
      // câblé » de « le prédicteur est déclaré quelque part et ne branche
      // rien » ; la seconde rend la preuve par mutation interprétable — aucun
      // des quatre autres n'est activé par CE jeu de données (aucune année
      // comparable, aucun calendrier de vacances, aucune session en
      // rupture/invendu, un seul jour de semaine).
      seulPredicteurAdmis(prevision, 'inflationSigmaMeteoBp');
      // Ce prédicteur ÉLARGIT l'intervalle : son facteur est une INFLATION,
      // donc strictement au-dessus du neutre, jamais en dessous. SENS, jamais
      // valeur : l'inflation croît avec l'horizon, et l'épingler au point de
      // base rendrait le test fragile sans rien prouver de plus.
      expect(prevision.facteurs.inflationSigmaMeteoBp!).toBeGreaterThan(10_000);
    } finally {
      await app.close();
    }
  });
});

/**
 * Les TROIS prédicteurs de précision qui n'avaient AUCUNE garde d'activation.
 *
 * POURQUOI CE `describe` EXISTE. Cinq prédicteurs sont câblés par
 * `routes/previsions.ts`, chacun à TROIS endroits (l'appel à `prevoir`, la
 * décomposition rendue, l'archivage). Deux avaient fini par obtenir un test qui
 * les voyait ACTIFS — « jour de la semaine », puis « écart météo ». Les trois
 * derniers (comparable calendaire, vacances scolaires, session consécutive)
 * n'étaient jamais assertés autrement que `toBeUndefined()` / `toBeNull()` :
 * vérifié PAR MUTATION, leurs NEUF sites de câblage pouvaient être supprimés
 * sans qu'un seul test de `apps/api` ne rougisse.
 *
 * Le commentaire du `describe` « jour de la semaine » plus haut énonce lui-même
 * la raison d'être de ce genre de test — « sans ce test, une garantie de
 * non-régression parfaite pourrait cacher un câblage qui ne branche RIEN nulle
 * part ». Le raisonnement avait été fait, écrit, et appliqué à UN prédicteur
 * sur cinq.
 *
 * CE QUI EST ASSERTÉ, ET CE QUI NE L'EST PAS : l'ADMISSION (le champ est
 * PRÉSENT) et le SENS (au-dessus du neutre), jamais une valeur numérique.
 * Celle-ci dépend de la baseline calculée sur tout l'historique ; l'épingler
 * rendrait le test fragile sans rien prouver de plus. Même choix que le
 * `describe` « écart météo » ci-dessus.
 *
 * L'ISOLEMENT EST LE CŒUR DE CES TROIS TESTS, pas un ornement. Si deux
 * prédicteurs s'activaient sur la même fixture, neutraliser le câblage de l'un
 * ferait rougir le test de l'autre, et l'on croirait avoir prouvé un câblage
 * qu'on n'a pas prouvé. Chaque fixture n'en active donc qu'UN — les quatre
 * autres sont assertés absents, et les raisons STRUCTURELLES de leur silence
 * sont écrites dans `previsions-fixtures-partagees.ts`, à côté des constantes
 * qui les produisent.
 */
describe('GET /api/prevision — les trois prédicteurs de précision restés sans garde', () => {
  /**
   * Monte une base isolée, y clôture les sessions de la fixture, et rend
   * l'application prête à répondre.
   *
   * `construire` reçoit la date de la session à VENIR : toutes les fixtures
   * sont datées relativement à elle, jamais sur des dates absolues qui
   * décriraient tôt ou tard un passé impossible (docs/39 §3).
   */
  async function monterFixture(
    construire: (dateCible: string) => {
      readonly sessions: readonly SessionFixture[];
      readonly periodes?: readonly PeriodeVacances[];
    },
  ): Promise<{ base: BaseBatte; app: FastifyInstance }> {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const app = construireServeur(base, { journaliser: false });
    await app.ready();

    const session = prochaineSessionPlanifiee(base, aujourdHui())!;

    // Météo de la session à VENIR, posée en base : aucun appel réseau réel ne
    // part vers Open-Meteo pendant ce test. UN SEUL relevé, de type
    // « prevision », sans « reelle » correspondante — `pairesMeteoDuLieu` ne
    // peut donc former AUCUNE paire, et le cinquième prédicteur (écart météo
    // prévu/réalisé) reste silencieux sur les trois fixtures.
    enregistrerMeteo(base, {
      lieuId: session.lieuId,
      dateObservation: session.dateSession,
      type: 'prevision',
      ...METEO_TIEDE,
      recupereLe: new Date().toISOString(),
    });

    const { sessions, periodes } = construire(session.dateSession);

    if (periodes !== undefined) {
      // Le calendrier scolaire est une DONNÉE, pas une constante du code : il
      // vit dans `parametre`, vide par défaut et à renseigner à la main depuis
      // une source officielle (CLAUDE.md §7). Tant qu'il est vide, le
      // prédicteur « vacances scolaires » reste inactif — c'est le
      // comportement correct, et c'est aussi ce qui le garde muet sur les deux
      // AUTRES fixtures, qui n'y touchent pas.
      const ligne = base
        .select({ id: schema.parametre.id })
        .from(schema.parametre)
        .where(eq(schema.parametre.cle, 'prevision_vacances_scolaires_be_json'))
        .get()!;
      corrigerParametre(base, ligne.id, JSON.stringify(periodes));
    }

    // Produit transformé À UNE CRÊPE PAR UNITÉ, demandé explicitement : sans
    // production rattachée, `cloturerSession` exige l'égalité EXACTE
    // « produites = vendues + invendues + cassées ». Avec un produit à
    // plusieurs crêpes, l'arrondi de la quantité vendue décalerait
    // silencieusement les quantités de la fixture. Le jour où le jeu de
    // démonstration cesserait d'en fournir un, ce `!` échoue bruyamment —
    // ce qui vaut mieux qu'une fixture faussée sans que rien ne le dise.
    const produit = base
      .select({ id: schema.produitVente.id })
      .from(schema.produitVente)
      .where(and(eq(schema.produitVente.nature, 'transforme'), eq(schema.produitVente.nbCrepes, 1)))
      .get()!;

    for (const fixture of sessions) {
      const { id } = creerSession(base, {
        lieuId: session.lieuId,
        dateSession: fixture.dateSession,
      });
      const prixUnitaireCents = 300;
      cloturerSession(base, id, {
        ventes: [
          { produitVenteId: produit.id, quantite: fixture.crepesVendues, prixUnitaireCents },
        ],
        frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
        fondsCaisseInitialCents: 6000,
        especesCompteesCents: 6000 + fixture.crepesVendues * prixUnitaireCents,
        caCarteCents: 0,
        crepesProduites: fixture.crepesProduites,
        crepesInvendues: fixture.crepesProduites - fixture.crepesVendues,
        crepesCassees: 0,
        heureDebutReelle: '08:00',
        heureFinReelle: '14:30',
      });
    }

    return { base, app };
  }

  /** Archive la prévision courante et rend la ligne réellement écrite en base. */
  async function archiverEtRelire(base: BaseBatte, app: FastifyInstance, prevision: Prevision) {
    const archive = await app.inject({
      method: 'POST',
      url: '/api/prevision/archiver',
      payload: { sessionId: prevision.session?.id ?? null },
    });
    expect(archive.statusCode).toBe(201);
    const { id } = archive.json<{ id: string }>();

    return base
      .select({
        comparable: schema.prevision.facteurComparableCalendaireBp,
        jourSemaine: schema.prevision.facteurJourSemaineBp,
        vacances: schema.prevision.facteurVacancesScolairesBp,
        sessionConsecutive: schema.prevision.facteurSessionConsecutiveBp,
        inflationMeteo: schema.prevision.inflationSigmaMeteoBp,
      })
      .from(schema.prevision)
      .where(eq(schema.prevision.id, id))
      .get()!;
  }

  it('admet « comparable calendaire » sur huit années de rendez-vous, et le FAIT APPARAÎTRE', async () => {
    const { base, app } = await monterFixture((dateCible) => ({
      sessions: sessionsComparableCalendaire(dateCible),
    }));
    try {
      const reponse = await app.inject({ method: 'GET', url: '/api/prevision' });
      expect(reponse.statusCode).toBe(200);
      const prevision = reponse.json<Prevision>();

      // ADMIS, et LUI SEUL : c'est cette paire d'assertions qui distingue « le
      // prédicteur est câblé » de « le prédicteur est déclaré quelque part et
      // ne branche rien ».
      seulPredicteurAdmis(prevision, 'comparableCalendaireBp');

      // SENS : la session à venir tombe sur le rendez-vous le plus vendeur de
      // l'année (indice 0 de `NIVEAUX_RENDEZ_VOUS_COMPARABLE`, ≈ 300 crêpes
      // contre une moyenne générale autour de 180). Le facteur doit donc
      // pousser AU-DESSUS du neutre, jamais en dessous.
      expect(prevision.facteurs.comparableCalendaireBp!).toBeGreaterThan(10_000);
      expect(prevision.facteurs.comparableCalendaireExplication).toContain('Comparable calendaire');

      // Troisième site de câblage : l'archivage. `NULL` sur les quatre autres,
      // jamais 10000 — « n'a pas influencé cette prévision » n'est pas
      // « neutre » (`packages/db/src/schema.ts`).
      const ligne = await archiverEtRelire(base, app, prevision);
      expect(ligne.comparable).toBe(prevision.facteurs.comparableCalendaireBp);
      expect(ligne.jourSemaine).toBeNull();
      expect(ligne.vacances).toBeNull();
      expect(ligne.sessionConsecutive).toBeNull();
      expect(ligne.inflationMeteo).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('admet « vacances scolaires » quand le calendrier est renseigné, et le FAIT APPARAÎTRE', async () => {
    const { base, app } = await monterFixture((dateCible) => fixtureVacancesScolaires(dateCible));
    try {
      const reponse = await app.inject({ method: 'GET', url: '/api/prevision' });
      expect(reponse.statusCode).toBe(200);
      const prevision = reponse.json<Prevision>();

      seulPredicteurAdmis(prevision, 'vacancesScolairesBp');

      // SENS : la session à venir tombe DANS un congé scolaire, et les
      // dimanches de congé de cette fixture vendent le double des autres
      // (`CREPES_EN_VACANCES` contre `CREPES_HORS_VACANCES`) — au-dessus du
      // neutre, donc.
      expect(prevision.facteurs.vacancesScolairesBp!).toBeGreaterThan(10_000);
      expect(prevision.facteurs.vacancesScolairesExplication).toContain('Vacances scolaires');
      expect(prevision.facteurs.vacancesScolairesExplication).toContain('en vacances');

      const ligne = await archiverEtRelire(base, app, prevision);
      expect(ligne.vacances).toBe(prevision.facteurs.vacancesScolairesBp);
      expect(ligne.comparable).toBeNull();
      expect(ligne.jourSemaine).toBeNull();
      expect(ligne.sessionConsecutive).toBeNull();
      expect(ligne.inflationMeteo).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('admet « session consécutive » après une rupture, et le FAIT APPARAÎTRE', async () => {
    const { base, app } = await monterFixture((dateCible) => ({
      sessions: sessionsSessionConsecutive(dateCible),
    }));
    try {
      const reponse = await app.inject({ method: 'GET', url: '/api/prevision' });
      expect(reponse.statusCode).toBe(200);
      const prevision = reponse.json<Prevision>();

      seulPredicteurAdmis(prevision, 'sessionConsecutiveBp');

      // SENS : le dimanche précédent s'est soldé par une RUPTURE (tout écoulé,
      // zéro invendu), et dans l'historique de cette fixture une rupture est
      // systématiquement suivie d'une session plus forte — de la demande non
      // servie qui revient. Au-dessus du neutre.
      expect(prevision.facteurs.sessionConsecutiveBp!).toBeGreaterThan(10_000);
      expect(prevision.facteurs.sessionConsecutiveExplication).toContain('Session précédente');
      expect(prevision.facteurs.sessionConsecutiveExplication).toContain('rupture');

      const ligne = await archiverEtRelire(base, app, prevision);
      expect(ligne.sessionConsecutive).toBe(prevision.facteurs.sessionConsecutiveBp);
      expect(ligne.comparable).toBeNull();
      expect(ligne.jourSemaine).toBeNull();
      expect(ligne.vacances).toBeNull();
      expect(ligne.inflationMeteo).toBeNull();
    } finally {
      await app.close();
    }
  });
});
