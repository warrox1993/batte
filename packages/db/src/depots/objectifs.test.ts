/**
 * Tests du dépôt des objectifs (budget), succès et niveaux (fiche 18). Base
 * SQLite en mémoire, `seed(base)` pour charger le catalogue de paramètres
 * (seuils légaux, rythme de sessions prévues) dont `tableauSeuils` et
 * `evaluerAnticipationSeuil` ont besoin — même geste que
 * `apps/api/src/routes/sessions.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  ajouterJours,
  ErreurIntrouvable,
  ErreurMetier,
  joursEntre,
  maintenantUtc,
  nouvelIdentifiant,
} from '@batte/core';
import { creerBase, schema, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { annulerObjectif, calculerSucces, creerObjectif, listerObjectifs } from './objectifs.js';

function creerLieu(base: BaseBatte): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.lieuMarche)
    .values({ id, nom: 'La Batte', actif: true, creeLe: maintenant, modifieLe: maintenant })
    .run();
  return id;
}

type FixtureSession = {
  readonly dateSession: string;
  readonly margeNetteCents?: number | null;
  readonly crepesInvendues?: number;
  readonly crepesProduites?: number;
  readonly crepesVendues?: number;
  readonly coutMatiereCents?: number | null;
  readonly caTotalCents?: number | null;
  readonly caSurPlaceCents?: number | null;
};

function creerSessionCloturee(base: BaseBatte, lieuId: string, fixture: FixtureSession): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.sessionMarche)
    .values({
      id,
      numero: `SM-TEST-${id}`,
      lieuId,
      dateSession: fixture.dateSession,
      statut: 'cloturee',
      margeNetteCents: fixture.margeNetteCents ?? null,
      crepesInvendues: fixture.crepesInvendues ?? 0,
      crepesProduites: fixture.crepesProduites ?? 0,
      crepesVendues: fixture.crepesVendues ?? 0,
      coutMatiereCents: fixture.coutMatiereCents ?? null,
      caTotalCents: fixture.caTotalCents ?? null,
      caSurPlaceCents: fixture.caSurPlaceCents ?? null,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function creerPrevision(
  base: BaseBatte,
  sessionId: string,
  fixture: { erreurAbsolueBp: number; dateCalcul?: string },
): void {
  base
    .insert(schema.prevision)
    .values({
      id: nouvelIdentifiant(),
      sessionId,
      dateCalcul: fixture.dateCalcul ?? maintenantUtc(),
      versionModele: 'test',
      baselineCrepes: 100,
      facteurMeteoBp: 10_000,
      facteurEvenementBp: 10_000,
      facteurSaisonBp: 10_000,
      facteurTendanceBp: 10_000,
      p10Crepes: 80,
      p50Crepes: 100,
      p90Crepes: 120,
      quantileCibleBp: 8_000,
      crepesRecommandees: 100,
      crepesRetenues: 100,
      repartitionRecettes: null,
      confianceBp: 5_000,
      nbSessionsComparables: 5,
      crepesReelles: 100,
      erreurAbsolueBp: fixture.erreurAbsolueBp,
    })
    .run();
}

function creerReleveArriveeEtRetour(base: BaseBatte, sessionId: string, dateReleve: string): void {
  for (const moment of ['arrivee', 'retour'] as const) {
    base
      .insert(schema.releveTemperature)
      .values({
        id: nouvelIdentifiant(),
        sessionId,
        equipement: 'Glacière',
        temperatureC: 4,
        dateReleve,
        moment,
        conforme: true,
        creeLe: maintenantUtc(),
      })
      .run();
  }
}

describe('dépôt objectifs — calculerSucces (fiche 18)', () => {
  let base: BaseBatte;
  let lieuId: string;
  /** Neuf sessions clôturées, trois par trimestre (T1/T2/T3 2026). */
  let sessions: string[];

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    lieuId = creerLieu(base);

    const fixtures: FixtureSession[] = [
      // T1 — S1, S2 solides ; S3 casse la marge ET le zéro-gaspillage.
      {
        dateSession: '2026-01-04',
        margeNetteCents: 40_000,
        crepesInvendues: 0,
        crepesProduites: 20,
        crepesVendues: 20,
        coutMatiereCents: 3_000, // 150 c/crêpe
        caTotalCents: 60_000,
      },
      {
        dateSession: '2026-01-11',
        margeNetteCents: 35_000,
        crepesInvendues: 0,
        crepesProduites: 20,
        crepesVendues: 20,
        coutMatiereCents: 3_200, // 160 c/crêpe
        caTotalCents: 60_000,
      },
      {
        dateSession: '2026-01-18',
        margeNetteCents: 20_000, // sous le seuil de marge (30 000)
        crepesInvendues: 2, // casse le zéro-gaspillage
        crepesProduites: 20,
        crepesVendues: 18,
        coutMatiereCents: 2_800, // 156 c/crêpe (arrondi de 155,56)
        caTotalCents: 54_000,
      },
      // T2 — trois sessions solides, coût matière en baisse vs T1.
      {
        dateSession: '2026-04-05',
        margeNetteCents: 32_000,
        crepesInvendues: 0,
        crepesProduites: 20,
        crepesVendues: 20,
        coutMatiereCents: 2_000, // 100 c/crêpe
        caTotalCents: 60_000,
      },
      {
        dateSession: '2026-04-12',
        margeNetteCents: 31_000,
        crepesInvendues: 0,
        crepesProduites: 20,
        crepesVendues: 20,
        coutMatiereCents: 2_200, // 110 c/crêpe
        caTotalCents: 60_000,
      },
      {
        dateSession: '2026-04-19',
        margeNetteCents: 33_000,
        crepesInvendues: 0,
        crepesProduites: 20,
        crepesVendues: 20,
        coutMatiereCents: 2_400, // 120 c/crêpe — moyenne T2 = 110 < moyenne T1 (155,33)
        caTotalCents: 60_000,
      },
      // T3 — trois sessions solides, coût matière encore en baisse vs T2.
      {
        dateSession: '2026-07-05',
        margeNetteCents: 34_000,
        crepesInvendues: 0,
        crepesProduites: 20,
        crepesVendues: 20,
        coutMatiereCents: 1_000, // 50 c/crêpe
        caTotalCents: 60_000,
      },
      {
        dateSession: '2026-07-12',
        margeNetteCents: 36_000,
        crepesInvendues: 0,
        crepesProduites: 20,
        crepesVendues: 20,
        coutMatiereCents: 1_200, // 60 c/crêpe
        caTotalCents: 60_000,
      },
      {
        dateSession: '2026-07-19',
        margeNetteCents: 38_000,
        crepesInvendues: 0,
        crepesProduites: 20,
        crepesVendues: 20,
        coutMatiereCents: 1_400, // 70 c/crêpe — moyenne T3 = 60 < moyenne T2 (110)
        caTotalCents: 60_000,
      },
    ];

    sessions = fixtures.map((f) => creerSessionCloturee(base, lieuId, f));

    // Prévisions rapprochées sur S1, S2, S4, S5, S6, S7 (S3 volontairement
    // absente : une session sans prévision n'est ni un succès ni un échec,
    // elle est simplement ABSENTE de la série).
    creerPrevision(base, sessions[0]!, { erreurAbsolueBp: 500 });
    creerPrevision(base, sessions[1]!, { erreurAbsolueBp: 800 });
    creerPrevision(base, sessions[3]!, { erreurAbsolueBp: 900 });
    creerPrevision(base, sessions[4]!, { erreurAbsolueBp: 1_200 }); // casse la série (> 10 %)
    creerPrevision(base, sessions[5]!, { erreurAbsolueBp: 300 });
    creerPrevision(base, sessions[6]!, { erreurAbsolueBp: 400 });

    // Relevés de température (arrivée + retour) sur S1 à S4 seulement.
    creerReleveArriveeEtRetour(base, sessions[0]!, '2026-01-04');
    creerReleveArriveeEtRetour(base, sessions[1]!, '2026-01-11');
    creerReleveArriveeEtRetour(base, sessions[2]!, '2026-01-18');
    creerReleveArriveeEtRetour(base, sessions[3]!, '2026-04-05');
  });

  it('axe marge : débloque les paliers à la date de la Ne session solide d’affilée', () => {
    const { series } = calculerSucces(base, '2026-08-01');
    const marge = series.find((s) => s.cle === 'marge');
    expect(marge).toBeDefined();
    expect(marge!.paliers.find((p) => p.niveau === 1)?.debloqueLe).toBe('2026-04-19');
    expect(marge!.paliers.find((p) => p.niveau === 2)?.debloqueLe).toBe('2026-07-12');
    expect(marge!.paliers.find((p) => p.niveau === 3)?.debloqueLe).toBeNull();
    expect(marge!.meilleureSerieLongueur).toBe(6);
    expect(marge!.serieActuelleLongueur).toBe(6);
  });

  it('axe gaspillage : la session S3 (2 invendues) casse la série', () => {
    const { series } = calculerSucces(base, '2026-08-01');
    const gaspillage = series.find((s) => s.cle === 'gaspillage');
    expect(gaspillage!.paliers.find((p) => p.niveau === 1)?.debloqueLe).toBe('2026-04-19');
    expect(gaspillage!.meilleureSerieLongueur).toBe(6);
  });

  it('axe prévision : une session sans prévision n’interrompt pas la série, un écart trop grand oui', () => {
    const { series } = calculerSucces(base, '2026-08-01');
    const prevision = series.find((s) => s.cle === 'prevision');
    // Série effective : S1(ok) S2(ok) S4(ok) S5(casse) S6(ok) S7(ok).
    expect(prevision!.paliers.find((p) => p.niveau === 1)?.debloqueLe).toBe('2026-04-05');
    expect(prevision!.meilleureSerieLongueur).toBe(3);
    expect(prevision!.serieActuelleLongueur).toBe(2);
  });

  it('axe AFSCA : lu sur les relevés réellement saisis, casse dès qu’une session en manque', () => {
    const { series } = calculerSucces(base, '2026-08-01');
    const afsca = series.find((s) => s.cle === 'afsca');
    // S1 à S4 ont un relevé complet, S5 à S9 n'en ont aucun.
    expect(afsca!.paliers.find((p) => p.niveau === 1)?.debloqueLe).toBe('2026-04-05');
    expect(afsca!.meilleureSerieLongueur).toBe(4);
    expect(afsca!.serieActuelleLongueur).toBe(0);
  });

  it('axe AFSCA : un relevé ANNULÉ ne fait plus foi — le score BAISSE (D-083)', () => {
    // Référence : S1 à S4 ont un relevé complet (arrivée + retour) valide →
    // meilleureSerieLongueur = 4, palier 1 (longueur requise 4) débloqué à la
    // date de S4 (même fixture que le test précédent).
    const avant = calculerSucces(base, '2026-08-01');
    const afscaAvant = avant.series.find((s) => s.cle === 'afsca')!;
    expect(afscaAvant.meilleureSerieLongueur).toBe(4);
    expect(afscaAvant.paliers.find((p) => p.niveau === 1)?.debloqueLe).toBe('2026-04-05');

    // On annule le relevé de RETOUR de S4 (D-083 : annulation par écriture
    // nouvelle — ici on bascule directement le statut, comme le ferait
    // `annulerReleveTemperature`, services/afsca.ts).
    base
      .update(schema.releveTemperature)
      .set({ statut: 'annulee' })
      .where(
        and(
          eq(schema.releveTemperature.sessionId, sessions[3]!),
          eq(schema.releveTemperature.moment, 'retour'),
        ),
      )
      .run();

    const apres = calculerSucces(base, '2026-08-01');
    const afscaApres = apres.series.find((s) => s.cle === 'afsca')!;
    // S4 n'a plus de relevé de retour VALIDE : sa réussite retombe à faux, la
    // série se limite désormais à S1-S3 (longueur 3) et le palier 1 (longueur
    // requise 4) n'est plus atteint. Un relevé annulé ne doit JAMAIS compter
    // comme preuve de régularité — c'est précisément ce que ce test vérifie.
    expect(afscaApres.meilleureSerieLongueur).toBe(3);
    expect(afscaApres.paliers.find((p) => p.niveau === 1)?.debloqueLe).toBeNull();
  });

  it('axe coût de revient : compare la moyenne du trimestre au trimestre précédent', () => {
    const { series } = calculerSucces(base, '2026-08-01');
    const coutRevient = series.find((s) => s.cle === 'cout_revient');
    // T2 (moyenne 110) < T1 (moyenne 155,33) : premier palier à la dernière session de T2.
    expect(coutRevient!.paliers.find((p) => p.niveau === 1)?.debloqueLe).toBe('2026-04-19');
    // T3 (moyenne 60) < T2 (moyenne 110) : deuxième palier à la dernière session de T3.
    expect(coutRevient!.paliers.find((p) => p.niveau === 2)?.debloqueLe).toBe('2026-07-19');
    expect(coutRevient!.paliers.find((p) => p.niveau === 3)?.debloqueLe).toBeNull();
  });

  it('niveau ancienneté : compte les neuf sessions clôturées', () => {
    const { niveauAnciennete } = calculerSucces(base, '2026-08-01');
    expect(niveauAnciennete.valeurActuelle).toBe(9);
    expect(niveauAnciennete.niveauActuel).toBe(1); // seuil "5 sessions" franchi, pas "10"
    expect(niveauAnciennete.prochainPalier?.seuil).toBe(10);
  });

  it('niveau chiffre d’affaires : JAMAIS nu, toujours accompagné du contexte des seuils légaux', () => {
    const { niveauChiffreAffaires } = calculerSucces(base, '2026-08-01');
    // Cumul : 8 × 60 000 + 54 000 = 534 000 centimes.
    expect(niveauChiffreAffaires.niveau.valeurActuelle).toBe(534_000);
    expect(niveauChiffreAffaires.niveau.niveauActuel).toBe(2); // "5 000 € cumulés" franchi
    // Le contexte des seuils légaux est structurellement présent (fiche §2.1).
    expect(niveauChiffreAffaires.contexteSeuilsLegaux.data.length).toBeGreaterThan(0);
    expect(niveauChiffreAffaires.contexteSeuilsLegaux.meta.annee).toBe(2026);
  });

  it('aucune table nouvelle : `calculerSucces` ne fait que lire les tables existantes', () => {
    // Preuve par l'absence d'exception : si une table manquait, la requête
    // SQL sous-jacente aurait déjà levé avant cette assertion.
    expect(() => calculerSucces(base, '2026-08-01')).not.toThrow();
  });
});

describe('dépôt objectifs — anticipationSeuils (fiche §2.1 : la préparation, pas le montant)', () => {
  let base: BaseBatte;
  let lieuId: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    lieuId = creerLieu(base);

    // Seuil de franchise TVA abaissé à 400 € pour rendre le franchissement
    // atteignable par une poignée de sessions modestes, sans dépendre de la
    // valeur réelle du catalogue (CLAUDE.md §6 : un seuil légal reste
    // paramétrable, jamais recopié en dur dans ce test non plus).
    base
      .update(schema.parametre)
      .set({ valeur: '40000' })
      .where(eq(schema.parametre.cle, 'seuil_franchise_tva_cents'))
      .run();

    // Huit sessions hebdomadaires à 50 € de CA : le cumul franchit 400 € à la
    // 8e session (50 × 8 = 400).
    for (let i = 0; i < 8; i += 1) {
      creerSessionCloturee(base, lieuId, {
        dateSession: ajouterJours('2026-01-04', i * 7),
        caTotalCents: 5_000,
      });
    }
  });

  it('mesure combien de jours la projection a anticipé le franchissement réel', () => {
    const { anticipationSeuils } = calculerSucces(base, '2026-08-01');
    const resultat = anticipationSeuils.find((r) => r.cle.startsWith('seuil_franchise_tva_cents'));
    expect(resultat).toBeDefined();

    const dateSession2 = ajouterJours('2026-01-04', 7);
    const dateSession8 = ajouterJours('2026-01-04', 49);
    expect(resultat!.dateFranchissementReel).toBe(dateSession8);
    // La projection, dès la 2e session, annonce déjà un rythme annuel très
    // supérieur à 400 € (cumul 100 € / 2 sessions × sessions prévues à l'année).
    expect(resultat!.datePremiereAlerte).toBe(dateSession2);
    expect(resultat!.joursAnticipation).toBe(joursEntre(dateSession2, dateSession8));
    expect(resultat!.joursAnticipation).toBeGreaterThanOrEqual(30);
    expect(resultat!.niveau.niveauActuel).toBeGreaterThanOrEqual(1);
  });

  it('exclut les seuils jamais franchis (Airbag, SCE restent hors de portée de cette fixture)', () => {
    const { anticipationSeuils } = calculerSucces(base, '2026-08-01');
    expect(anticipationSeuils.every((r) => r.cle.startsWith('seuil_franchise_tva_cents'))).toBe(
      true,
    );
  });
});

describe('dépôt objectifs — creerObjectif / listerObjectifs / annulerObjectif (fiche §4)', () => {
  let base: BaseBatte;
  let lieuId: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    lieuId = creerLieu(base);

    // Deux sessions clôturées en janvier 2026 : le réalisé d'un objectif posé
    // sur ce mois doit sommer/moyenner EXACTEMENT ces deux lignes.
    creerSessionCloturee(base, lieuId, {
      dateSession: '2026-01-05',
      caTotalCents: 100_000,
      margeNetteCents: 20_000,
      crepesProduites: 50,
      crepesVendues: 50,
      coutMatiereCents: 5_000, // 100 c/crêpe
    });
    creerSessionCloturee(base, lieuId, {
      dateSession: '2026-01-12',
      caTotalCents: 80_000,
      margeNetteCents: 15_000,
      crepesProduites: 40,
      crepesVendues: 40,
      coutMatiereCents: 4_800, // 120 c/crêpe
    });
    // Une session HORS période (février), pour vérifier qu'elle n'est jamais
    // comptée dans le réalisé de janvier.
    creerSessionCloturee(base, lieuId, {
      dateSession: '2026-02-02',
      caTotalCents: 999_999,
      margeNetteCents: 999_999,
      crepesProduites: 10,
      crepesVendues: 10,
      coutMatiereCents: 1_000,
    });
  });

  it('creerObjectif rejette une cible nulle ou négative (défense en profondeur, le contrat Zod la valide déjà)', () => {
    expect(() =>
      creerObjectif(base, {
        grandeur: 'chiffre_affaires',
        dateDebut: '2026-01-01',
        dateFin: '2026-01-31',
        valeurCible: 0,
      }),
    ).toThrow(ErreurMetier);
    expect(() =>
      creerObjectif(base, {
        grandeur: 'chiffre_affaires',
        dateDebut: '2026-01-01',
        dateFin: '2026-01-31',
        valeurCible: -100,
      }),
    ).toThrow(ErreurMetier);
  });

  it('chiffre_affaires : somme le CA des sessions clôturées de la période, jamais celles hors période', () => {
    creerObjectif(base, {
      grandeur: 'chiffre_affaires',
      dateDebut: '2026-01-01',
      dateFin: '2026-01-31',
      valeurCible: 150_000,
    });
    const lignes = listerObjectifs(base, '2026-08-01');
    expect(lignes).toHaveLength(1);
    const ligne = lignes[0]!;
    expect(ligne.evaluation.realise).toBe(180_000); // 100 000 + 80 000, PAS + 999 999
    expect(ligne.evaluation.ecart).toBe(30_000);
    expect(ligne.evaluation.avancementBp).toBe(12_000); // 180 000 / 150 000
    expect(ligne.evaluation.statut).toBe('atteint');
    expect(ligne.evaluation.periodeTerminee).toBe(true);
  });

  it('marge_nette : somme la marge nette des sessions de la période', () => {
    creerObjectif(base, {
      grandeur: 'marge_nette',
      dateDebut: '2026-01-01',
      dateFin: '2026-01-31',
      valeurCible: 40_000,
    });
    const ligne = listerObjectifs(base, '2026-08-01')[0]!;
    expect(ligne.evaluation.realise).toBe(35_000); // 20 000 + 15 000
    expect(ligne.evaluation.statut).toBe('manque'); // 35 000 < 40 000, période terminée
  });

  it('nombre_sessions : compte les sessions clôturées de la période', () => {
    creerObjectif(base, {
      grandeur: 'nombre_sessions',
      dateDebut: '2026-01-01',
      dateFin: '2026-01-31',
      valeurCible: 2,
    });
    const ligne = listerObjectifs(base, '2026-08-01')[0]!;
    expect(ligne.evaluation.realise).toBe(2);
    expect(ligne.evaluation.statut).toBe('atteint');
  });

  it('cout_matiere_par_crepe : moyenne le coût matière du TRANSFORME par crêpe (grandeur qui se MINIMISE)', () => {
    creerObjectif(base, {
      grandeur: 'cout_matiere_par_crepe',
      dateDebut: '2026-01-01',
      dateFin: '2026-01-31',
      valeurCible: 105,
    });
    const ligne = listerObjectifs(base, '2026-08-01')[0]!;
    expect(ligne.evaluation.realise).toBe(110); // moyenne(100, 120)
    // Grandeur qui se MINIMISE : 110 > 105 est un MANQUE, pas une réussite.
    expect(ligne.evaluation.statut).toBe('manque');
  });

  it('réalisé `null` (jamais 0) quand aucune session clôturée ne tombe dans la période', () => {
    creerObjectif(base, {
      grandeur: 'chiffre_affaires',
      dateDebut: '2027-01-01',
      dateFin: '2027-01-31',
      valeurCible: 10_000,
    });
    const ligne = listerObjectifs(base, '2026-08-01')[0]!;
    expect(ligne.evaluation.realise).toBeNull();
    expect(ligne.evaluation.statut).toBe('sans_donnee'); // période future, pas encore terminée
  });

  it('periodeTerminee dépend du jour de référence, jamais figé', () => {
    creerObjectif(base, {
      grandeur: 'marge_nette',
      dateDebut: '2026-01-01',
      dateFin: '2026-01-31',
      valeurCible: 40_000,
    });
    // Avant la fin de période : en cours, pas manqué, malgré le même réalisé.
    const ligneEnCours = listerObjectifs(base, '2026-01-15')[0]!;
    expect(ligneEnCours.evaluation.periodeTerminee).toBe(false);
    expect(ligneEnCours.evaluation.statut).toBe('en_cours');
    // Après la fin de période : manqué.
    const ligneTerminee = listerObjectifs(base, '2026-08-01')[0]!;
    expect(ligneTerminee.evaluation.periodeTerminee).toBe(true);
    expect(ligneTerminee.evaluation.statut).toBe('manque');
  });

  it("annulerObjectif : contre-écriture qui marque l'origine sans jamais l'effacer (CLAUDE.md §3 règle 7)", () => {
    const { id } = creerObjectif(base, {
      grandeur: 'chiffre_affaires',
      dateDebut: '2026-01-01',
      dateFin: '2026-01-31',
      valeurCible: 150_000,
    });

    const contreEcriture = annulerObjectif(base, id, 'Cible mal calibrée, se corrige');

    const lignes = listerObjectifs(base, '2026-08-01');
    expect(lignes).toHaveLength(2); // l'origine ET la contre-écriture, RIEN n'a disparu.

    const origine = lignes.find((l) => l.id === id)!;
    expect(origine.estAnnule).toBe(true);
    expect(origine.estAnnulation).toBe(false);
    // La ligne d'origine reste, telle quelle, avec sa cible et son évaluation.
    expect(origine.valeurCible).toBe(150_000);

    const correction = lignes.find((l) => l.id === contreEcriture.id)!;
    expect(correction.estAnnulation).toBe(true);
    expect(correction.objectifAnnuleId).toBe(id);
    expect(correction.notes).toContain('Cible mal calibrée, se corrige');
  });

  it('annulerObjectif exige un motif non vide', () => {
    const { id } = creerObjectif(base, {
      grandeur: 'nombre_sessions',
      dateDebut: '2026-01-01',
      dateFin: '2026-01-31',
      valeurCible: 2,
    });
    expect(() => annulerObjectif(base, id, '   ')).toThrow(ErreurMetier);
  });

  it('annulerObjectif refuse une seconde annulation de la même ligne', () => {
    const { id } = creerObjectif(base, {
      grandeur: 'nombre_sessions',
      dateDebut: '2026-01-01',
      dateFin: '2026-01-31',
      valeurCible: 2,
    });
    annulerObjectif(base, id, 'Première annulation');
    expect(() => annulerObjectif(base, id, 'Seconde tentative')).toThrow(ErreurMetier);
  });

  it('annulerObjectif sur un identifiant inconnu lève ErreurIntrouvable', () => {
    expect(() => annulerObjectif(base, nouvelIdentifiant(), 'Motif quelconque')).toThrow(
      ErreurIntrouvable,
    );
  });
});
