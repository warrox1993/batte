/**
 * L'INTERVALLE QUI SE RESSERRE LE DIMANCHE MATIN — D-098.
 *
 * ═══ La chaîne, établie dans le code et non supposée ═══
 *
 * `prochainJourDeMarche` (`packages/db/src/seed/demonstration.ts`) calcule
 * `(jourSemaine − aujourd'hui + 7) % 7` : quand on est DÉJÀ le jour de marché
 * du lieu, l'écart vaut `0` et la prochaine session est LE JOUR MÊME. À La
 * Batte, ce jour est le dimanche. `horizonJoursSession` (`previsions.ts`)
 * vaut alors `0`, et `ecartMeteoPrevueRealisee`
 * (`packages/core/src/prevision/ecart-meteo-prevue-realisee.ts`) refuse par
 * construction à horizon nul — une météo du jour même n'est plus une
 * prévision, il n'y a aucune incertitude d'horizon à faire payer à
 * l'intervalle P10/P90.
 *
 * Le comportement est CORRECT. Ce qui ne l'était pas, c'est le silence :
 * `inflationSigmaMeteoBp` disparaissait de la décomposition, l'intervalle se
 * resserrait, et rien ne le disait — le dimanche matin, c'est-à-dire au
 * moment exact où cet écran sert à décider d'une quantité de pâte.
 *
 * ═══ Ce que ce fichier prouve, et pourquoi il ne vieillit pas ═══
 *
 * Il joue DEUX FOIS le même scénario, sur la même graine et les mêmes
 * données, en ne changeant QUE le jour où on se place :
 *
 *  - un DIMANCHE : la session tombe le jour même, `horizonJours` vaut 0, et
 *    l'inflation d'intervalle liée à la fiabilité météo est absente ;
 *  - un MERCREDI : la session tombe le dimanche suivant, `horizonJours` vaut
 *    4, et l'inflation est PRÉSENTE — bien qu'aucune autre donnée n'ait
 *    changé.
 *
 * Le second cas n'est pas décoratif : sans lui, on ne prouverait pas que
 * l'élargissement existe les autres jours, donc pas que le resserrement du
 * dimanche est bien un CHANGEMENT à expliquer.
 *
 * L'horloge est FIGÉE sur une date CALCULÉE (« le dimanche le plus récent »,
 * « le mercredi le plus récent »), jamais sur une date absolue qui vieillirait
 * — `docs/39-DOCTRINE-DES-AGENTS.md` §3, quatrième forme : un test écrit un
 * samedi est passé au rouge le dimanche, sans qu'une ligne de code ait bougé,
 * précisément sur ce module. Et surtout : aucun branchement `if (on est
 * dimanche)`, qui ferait suivre au test deux chemins selon le jour, dont un
 * jamais exercé le jour où on le relit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  aujourdHui,
  cloturerSession,
  creerBase,
  creerSession,
  enregistrerMeteo,
  migrer,
  prochaineSessionPlanifiee,
  schema,
  seed,
  seedDemonstration,
  type BaseBatte,
} from '@batte/db';
import type { Prevision } from '@batte/core';
import { construireServeur } from '../serveur.js';
import { horizonJoursSession } from './previsions.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Dates CALCULÉES — jamais un littéral qui vieillit
   ═══════════════════════════════════════════════════════════════════════════ */

/** Décale un jour civil `AAAA-MM-JJ` de `jours` (négatif = vers le passé). */
function decaler(jour: string, jours: number): string {
  const date = new Date(`${jour}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + jours);
  return date.toISOString().slice(0, 10);
}

/**
 * Le plus récent `jourSemaine` (0 = dimanche), aujourd'hui compris.
 *
 * Symétrique exact de `prochainJourDeMarche` (seed de démonstration), et
 * calculé depuis l'horloge RÉELLE au moment de la collecte : la date obtenue
 * suit le calendrier au lieu de se périmer. Un littéral `'2026-08-02'` aurait
 * cessé d'être un dimanche « récent » dès la semaine suivante, et surtout
 * aurait laissé le test muet sur le vrai risque.
 */
function jourLePlusRecent(jourSemaine: number): string {
  const date = new Date(`${aujourdHui()}T12:00:00Z`);
  const recul = (date.getUTCDay() - jourSemaine + 7) % 7;
  date.setUTCDate(date.getUTCDate() - recul);
  return date.toISOString().slice(0, 10);
}

const DIMANCHE = 0;
const MERCREDI = 3;

/**
 * Nombre de couples (prévu, réalisé) plantés dans l'historique météo.
 *
 * Doit atteindre `prevision_ecart_meteo_paires_minimum` (8 au catalogue) pour
 * que le prédicteur ait le DROIT de se prononcer : sans ce seuil franchi, il
 * refuserait les DEUX jours, et le mercredi ne prouverait plus rien.
 */
const NB_PAIRES_METEO = 10;

/**
 * Écarts prévu/réalisé, en °C, volontairement DISPERSÉS.
 *
 * Une série constante donnerait un écart-type NUL, donc une inflation de
 * `sigma` exactement neutre (× 1,00) : le prédicteur serait « actif » sans
 * rien changer, et le mercredi ressemblerait au dimanche. C'est la troisième
 * forme de fixture aveugle (`docs/39` §3) — trop dégénérée pour discriminer.
 */
const ECARTS_TEMPERATURE_C = [2.5, -1.5, 3, -2, 1, -3.5, 2, -1, 4, -2.5] as const;

/* ═══════════════════════════════════════════════════════════════════════════
   Préparation — une seule fonction, deux jours
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Monte une installation complète en mémoire AVEC l'horloge figée sur
 * `jourFige`, et rend la prévision servie par `GET /api/prevision`.
 *
 * L'horloge est posée AVANT `seedDemonstration` : c'est elle qui décide où
 * tombe la session planifiée (`prochainJourDeMarche`), donc tout le scénario.
 */
async function previsionAuJour(jourFige: string): Promise<Prevision> {
  // Seul `Date` est feint : Fastify et better-sqlite3 gardent leurs vrais
  // délais. 09:00 UTC est en pleine journée à Bruxelles (UTC+1 ou UTC+2) —
  // aucun risque de basculer sur le jour civil voisin.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${jourFige}T09:00:00Z`));

  const base: BaseBatte = creerBase(':memory:');
  migrer(base);
  seed(base);
  seedDemonstration(base);

  const session = prochaineSessionPlanifiee(base, aujourdHui())!;

  // D-082 : zéro session close sur le lieu → aucune prévision. Une clôture
  // historique minimale, qui fournit aussi le prix de vente moyen sans lequel
  // `coutsNewsvendor` rendrait une marge de rupture nulle (refus en 4xx).
  const produit = base
    .select({ id: schema.produitVente.id })
    .from(schema.produitVente)
    .where(eq(schema.produitVente.nature, 'transforme'))
    .get()!;
  const historiqueId = creerSession(base, {
    lieuId: session.lieuId,
    dateSession: decaler(session.dateSession, -7),
  }).id;
  cloturerSession(base, historiqueId, {
    ventes: [{ produitVenteId: produit.id, quantite: 120, prixUnitaireCents: 300 }],
    frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
    fondsCaisseInitialCents: 0,
    especesCompteesCents: 120 * 300,
    caCarteCents: 0,
    crepesProduites: 120,
    crepesInvendues: 0,
    crepesCassees: 0,
  });

  // Météo de la session DÉJÀ conservée : `obtenirMeteo` la relit et n'appelle
  // donc jamais Open-Meteo (un test qui dépend du réseau n'est pas un test).
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

  // Les couples (prévu, réalisé) qui donnent au prédicteur de quoi se
  // prononcer. Plantés sur des dimanches passés, calculés depuis la session.
  ECARTS_TEMPERATURE_C.slice(0, NB_PAIRES_METEO).forEach((ecart, index) => {
    const date = decaler(session.dateSession, -7 * (index + 2));
    const commun = {
      lieuId: session.lieuId,
      dateObservation: date,
      precipitationsMm: 0,
      ventKmh: 8,
      couvertureNuageuseBp: 5000,
      recupereLe: new Date().toISOString(),
    };
    enregistrerMeteo(base, { ...commun, type: 'prevision', temperatureC: 14 });
    enregistrerMeteo(base, { ...commun, type: 'reelle', temperatureC: 14 + ecart });
  });

  const app = construireServeur(base, { journaliser: false });
  await app.ready();
  try {
    const reponse = await app.inject({ method: 'GET', url: '/api/prevision' });
    expect(reponse.statusCode).toBe(200);
    return reponse.json<Prevision>();
  } finally {
    await app.close();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le calcul lui-même
   ═══════════════════════════════════════════════════════════════════════════ */

describe('horizonJoursSession — la distance qui décide du refus', () => {
  it('vaut 0 quand la session tombe le jour même, et le nombre de jours sinon', () => {
    const dimanche = jourLePlusRecent(DIMANCHE);

    expect(horizonJoursSession(dimanche, dimanche)).toBe(0);
    expect(horizonJoursSession(decaler(dimanche, 4), dimanche)).toBe(4);
  });

  it('n’est JAMAIS négatif : une date passée rend 0, pas une inflation inversée', () => {
    const dimanche = jourLePlusRecent(DIMANCHE);

    // `ecartMeteoPrevueRealisee` multiplie l'inflation par `horizon / 7` : un
    // horizon négatif y produirait une CONTRACTION de l'intervalle, c'est-à-
    // dire l'inverse exact de ce que ce prédicteur doit pouvoir faire.
    expect(horizonJoursSession(decaler(dimanche, -3), dimanche)).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   La chaîne complète, deux jours, mêmes données
   ═══════════════════════════════════════════════════════════════════════════ */

describe('GET /api/prevision — l’horizon nul du dimanche traverse le contrat', () => {
  it(
    'UN DIMANCHE, la session tombe le jour même : horizon 0 porté au contrat, et aucune ' +
      'inflation d’intervalle liée à la fiabilité météo',
    async () => {
      const prevision = await previsionAuJour(jourLePlusRecent(DIMANCHE));

      // La session EST bien celle du jour : c'est la situation que le porteur
      // vit le matin du marché, pas une construction de test.
      expect(prevision.session?.dateSession).toBe(aujourdHui());
      expect(prevision.horizonJours).toBe(0);

      // Le refus du prédicteur, tel que l'écran le voit : le champ est ABSENT
      // (« non admis »), jamais présent à 10000 (« mesuré et neutre »).
      expect(prevision.facteurs.inflationSigmaMeteoBp).toBeUndefined();
      expect(prevision.facteurs.inflationSigmaMeteoExplication).toBeUndefined();
    },
  );

  it(
    'UN MERCREDI, avec exactement les mêmes données, l’inflation est bien LÀ — c’est ce qui ' +
      'prouve que le dimanche la perd, et qu’il y a donc quelque chose à dire',
    async () => {
      const prevision = await previsionAuJour(jourLePlusRecent(MERCREDI));

      // Mercredi → le dimanche qui suit : quatre jours plus tard.
      expect(prevision.horizonJours).toBe(4);
      expect(prevision.session?.dateSession).toBe(decaler(aujourdHui(), 4));

      // Présente ET strictement élargissante : une inflation exactement neutre
      // ne prouverait rien sur la différence entre les deux jours.
      expect(prevision.facteurs.inflationSigmaMeteoBp).toBeDefined();
      expect(prevision.facteurs.inflationSigmaMeteoBp!).toBeGreaterThan(10_000);
    },
  );
});
