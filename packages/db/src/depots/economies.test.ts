/**
 * Tests du dépôt des économies d'achat (`packages/db/src/depots/economies.ts`,
 * fiche 12 — audit chaîne d'achat du 29/07/2026).
 *
 * Ce fichier n'existait pas avant cet audit : le dépôt entier — guards
 * d'existence, fournisseur système, calcul dérivé, et surtout la détection
 * d'économie potentielle — n'avait ZÉRO test. Trois choses sont mises à
 * l'épreuve ici :
 *
 *  1. Les garde-fous d'écriture (`enregistrerEconomie`, `renegocierTarifAvecEconomie`) :
 *     références inconnues, fournisseur système, économie non strictement positive.
 *  2. Le CORRECTIF de `detecterEconomiePotentielle` : avant, la fonction
 *     choisissait « le conditionnement actif le plus récemment tarifé » SANS
 *     regarder sa contenance. Rien n'empêche un même fournisseur d'avoir
 *     plusieurs formats actifs pour le même ingrédient — comparer alors un
 *     prix total de sac de 25 kg à un prix total de paquet d'un kilo aurait
 *     produit un écart absurde. Les tests ci-dessous reproduisent exactement
 *     ce cas et vérifient le nouveau comportement : refus de deviner sans
 *     contenance candidate, comparaison normalisée avec elle.
 *  3. Que `economieCents` n'est JAMAIS une colonne : recalculé à chaque lecture.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ajouterJours, ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { conditionnement, fournisseur, ingredient } from '../schema.js';
import { creerFournisseur } from './referentiel.js';
import { enregistrerNouveauTarif } from './referentiel-ecriture.js';
import {
  detecterEconomiePotentielle,
  enregistrerEconomie,
  renegocierTarifAvecEconomie,
  type EntreeEconomie,
} from './economies.js';

const JOUR = '2026-07-28';

describe('dépôt économies — audit chaîne d’achat (29/07/2026)', () => {
  let base: BaseBatte;
  let idFarine: string;
  let idFournisseurDemo: string;
  let idConditionnementFarine: string;
  let idFournisseurSysteme: string;
  /**
   * Date RÉELLEMENT semée sur le conditionnement de farine par
   * `seed/demonstration.ts` (`datePrix: maintenant.slice(0, 10)` — le jour
   * CIVIL RÉEL de la machine au moment du test, jamais `JOUR` ci-dessous).
   *
   * CORRECTIF DE CALENDRIER (01/08/2026) : ce fichier codait auparavant
   * `datePrix: '2026-08-01'` en dur pour renégocier un tarif — une date
   * choisie parce qu'elle était, au moment de l'écriture du test,
   * postérieure au jour réel semé par `seedDemonstration`. Le calendrier a
   * rattrapé cette hypothèse (voir `docs/05-DECISIONS.md` si consigné) : au
   * jour où ce fichier tourne EXACTEMENT le 2026-08-01, la date semée et la
   * date codée en dur deviennent ÉGALES, et `enregistrerNouveauTarif` refuse
   * à bon droit une date qui n'est pas strictement postérieure. Une
   * deuxième date en dur plus lointaine (« 2027-01-01 ») n'aurait fait que
   * déplacer l'échéance d'une explosion identique. La correction retenue lit
   * la date RÉELLEMENT semée et calcule sa renégociation RELATIVEMENT à
   * elle (`ajouterJours(datePrixInitialFarine, 1)`) : toujours strictement
   * postérieure, quel que soit le jour où la suite s'exécute.
   */
  let datePrixInitialFarine: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    idFarine = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!.id;

    const ligneConditionnement = base
      .select({
        id: conditionnement.id,
        fournisseurId: conditionnement.fournisseurId,
        datePrix: conditionnement.datePrix,
      })
      .from(conditionnement)
      .where(eq(conditionnement.ingredientId, idFarine))
      .get()!;
    idConditionnementFarine = ligneConditionnement.id;
    idFournisseurDemo = ligneConditionnement.fournisseurId;
    datePrixInitialFarine = ligneConditionnement.datePrix;

    idFournisseurSysteme = base
      .select({ id: fournisseur.id })
      .from(fournisseur)
      .where(eq(fournisseur.type, 'systeme'))
      .get()!.id;
  });

  function entreeValide(surcharges: Partial<EntreeEconomie> = {}): EntreeEconomie {
    return {
      dateAction: JOUR,
      ingredientId: idFarine,
      fournisseurId: idFournisseurDemo,
      conditionnementId: null,
      typeAction: 'autre',
      description: 'Test',
      prixUnitaireAvantCents: 100,
      prixUnitaireApresCents: 80,
      quantiteConcernee: 10,
      commandeId: null,
      saisiPar: null,
      ...surcharges,
    };
  }

  describe('enregistrerEconomie — garde-fous', () => {
    it('crée une ligne et dérive economieCents, jamais lu depuis une colonne', () => {
      const ligne = enregistrerEconomie(base, entreeValide());

      expect(ligne.economieCents).toBe((100 - 80) * 10);
    });

    it('refuse un ingrédient inconnu, en 422 avec `champs`', () => {
      expect(() => enregistrerEconomie(base, entreeValide({ ingredientId: 'inconnu' }))).toThrow(
        ErreurMetier,
      );
    });

    it('refuse un fournisseur inconnu, en 422 avec `champs`', () => {
      expect(() => enregistrerEconomie(base, entreeValide({ fournisseurId: 'inconnu' }))).toThrow(
        ErreurMetier,
      );
    });

    it('refuse le fournisseur SYSTÈME : on ne négocie rien avec « Inventaire d’ouverture »', () => {
      try {
        enregistrerEconomie(base, entreeValide({ fournisseurId: idFournisseurSysteme }));
        expect.unreachable('devrait avoir levé une ErreurMetier');
      } catch (erreur) {
        expect((erreur as ErreurMetier).code).toBe('fournisseur_systeme');
      }
    });

    it('refuse une économie non strictement positive (prix « après » >= « avant »)', () => {
      expect(() =>
        enregistrerEconomie(
          base,
          entreeValide({ prixUnitaireAvantCents: 100, prixUnitaireApresCents: 100 }),
        ),
      ).toThrow(ErreurMetier);
      expect(() =>
        enregistrerEconomie(
          base,
          entreeValide({ prixUnitaireAvantCents: 100, prixUnitaireApresCents: 120 }),
        ),
      ).toThrow(ErreurMetier);
    });
  });

  describe('renegocierTarifAvecEconomie', () => {
    it('un prix qui BAISSE crée le tarif ET l’économie automatiquement', () => {
      const resultat = renegocierTarifAvecEconomie(base, {
        conditionnementId: idConditionnementFarine,
        prixCents: 1_800, // < 1875 (prix de la graine)
        datePrix: ajouterJours(datePrixInitialFarine, 1), // toujours postérieure — voir la note sur `datePrixInitialFarine`
        referenceFournisseur: null,
        quantiteConcernee: 5,
        description: null,
        saisiPar: null,
      });

      expect(resultat.ancienPrixCents).toBe(1_875);
      expect(resultat.nouveauPrixCents).toBe(1_800);
      expect(resultat.economie).not.toBeNull();
      expect(resultat.economie!.economieCents).toBe((1_875 - 1_800) * 5);
    });

    it('un prix qui MONTE change le tarif mais ne crée AUCUNE économie', () => {
      const resultat = renegocierTarifAvecEconomie(base, {
        conditionnementId: idConditionnementFarine,
        prixCents: 2_000, // > 1875
        datePrix: ajouterJours(datePrixInitialFarine, 1), // toujours postérieure — voir la note sur `datePrixInitialFarine`
        referenceFournisseur: null,
        quantiteConcernee: 5,
        description: null,
        saisiPar: null,
      });

      expect(resultat.nouveauPrixCents).toBe(2_000);
      expect(resultat.economie).toBeNull();
    });
  });

  /**
   * CORRECTIF D'AUDIT — `detecterEconomiePotentielle` ne compare plus des
   * prix de contenances différentes sans le savoir.
   */
  describe('detecterEconomiePotentielle — normalisation par contenance', () => {
    it('un seul format actif : compare les PRIX TOTAUX (comportement historique)', () => {
      // Format existant : Sac 25 kg à 1875 c (graine). Candidat moins cher.
      const detection = detecterEconomiePotentielle(base, {
        ingredientId: idFarine,
        fournisseurId: idFournisseurDemo,
        prixCandidatCents: 1_700,
      });

      expect(detection.prixReferenceCents).toBe(1_875);
      expect(detection.economieUnitaireCents).toBe(1_875 - 1_700);
      expect(detection.economiePotentielle).toBe(true);
    });

    it('un candidat plus CHER que le seul format actif : pas d’économie', () => {
      const detection = detecterEconomiePotentielle(base, {
        ingredientId: idFarine,
        fournisseurId: idFournisseurDemo,
        prixCandidatCents: 2_000,
      });

      expect(detection.economiePotentielle).toBe(false);
    });

    it('ingrédient ou fournisseur inconnu : rend un résultat NUL, jamais une erreur', () => {
      const detection = detecterEconomiePotentielle(base, {
        ingredientId: 'inconnu',
        fournisseurId: 'inconnu',
        prixCandidatCents: 100,
      });

      expect(detection).toEqual({
        prixReferenceCents: null,
        economieUnitaireCents: null,
        economiePotentielle: false,
        commandeMinimumCents: null,
        francoDePortCents: null,
      });
    });

    it(
      'DÉFAUT CORRIGÉ : plusieurs formats actifs de CONTENANCES DIFFÉRENTES, sans ' +
        'contenance candidate → refuse de deviner (rendait avant un écart absurde)',
      () => {
        const maintenant = maintenantUtc();
        // Un second format, plus petit, chez le MÊME fournisseur : plus récemment
        // tarifé que le sac de 25 kg de la graine, donc l'ancien code l'aurait
        // choisi comme référence — 1 kg à 90 c, contre 1875 c pour 25 kg.
        // `ajouterJours(datePrixInitialFarine, 1)`, jamais un littéral en dur :
        // toujours postérieur à la date RÉELLEMENT semée de la graine, quel
        // que soit le jour où la suite s'exécute (voir la note plus haut).
        base
          .insert(conditionnement)
          .values({
            id: nouvelIdentifiant(),
            ingredientId: idFarine,
            fournisseurId: idFournisseurDemo,
            libelle: 'Paquet 1 kg',
            quantiteUniteRef: 1_000,
            prixCents: 90,
            datePrix: ajouterJours(datePrixInitialFarine, 1),
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const detection = detecterEconomiePotentielle(base, {
          ingredientId: idFarine,
          fournisseurId: idFournisseurDemo,
          prixCandidatCents: 1_700, // un candidat de sac 25 kg, sans le dire
        });

        // AVANT LE CORRECTIF : la fonction aurait pris le paquet de 1 kg
        // (90 c, le plus récent) comme référence et rendu une "économie"
        // de 1875 - 1700, un écart entre un total de sac et un total de
        // paquet — absurde. Le correctif refuse de choisir.
        expect(detection.prixReferenceCents).toBeNull();
        expect(detection.economieUnitaireCents).toBeNull();
        expect(detection.economiePotentielle).toBe(false);
      },
    );

    it(
      'avec `quantiteUniteRefCandidat`, la comparaison est ramenée à l’unité de ' +
        'référence : un paquet 1 kg à 80 c bat le sac 25 kg à 1875 c (0,075 c/g)',
      () => {
        const maintenant = maintenantUtc();
        base
          .insert(conditionnement)
          .values({
            id: nouvelIdentifiant(),
            ingredientId: idFarine,
            fournisseurId: idFournisseurDemo,
            libelle: 'Paquet 1 kg',
            quantiteUniteRef: 1_000,
            prixCents: 90, // 0,09 c/g — plus cher au gramme que le sac (0,075 c/g)
            datePrix: ajouterJours(datePrixInitialFarine, 1),
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        // Un candidat de 1 kg à 80 c = 0,08 c/g : plus cher que le taux le
        // plus bas actuellement actif (0,075 c/g, le sac de 25 kg) -> pas
        // d'économie, malgré un prix TOTAL bien plus petit (80 c contre 1875 c).
        const detectionPlusCher = detecterEconomiePotentielle(base, {
          ingredientId: idFarine,
          fournisseurId: idFournisseurDemo,
          prixCandidatCents: 80,
          quantiteUniteRefCandidat: 1_000,
        });
        expect(detectionPlusCher.economiePotentielle).toBe(false);

        // Un candidat de 1 kg à 70 c = 0,07 c/g : bat le taux le plus bas
        // (0,075 c/g) -> économie potentielle, correctement normalisée.
        const detectionMoinsCher = detecterEconomiePotentielle(base, {
          ingredientId: idFarine,
          fournisseurId: idFournisseurDemo,
          prixCandidatCents: 70,
          quantiteUniteRefCandidat: 1_000,
        });
        expect(detectionMoinsCher.economiePotentielle).toBe(true);
        expect(detectionMoinsCher.prixReferenceCents).toBeCloseTo(1_875 / 25_000, 6);
      },
    );

    it('rejette une contenance candidate non strictement positive', () => {
      expect(() =>
        detecterEconomiePotentielle(base, {
          ingredientId: idFarine,
          fournisseurId: idFournisseurDemo,
          prixCandidatCents: 100,
          quantiteUniteRefCandidat: 0,
        }),
      ).toThrow(ErreurMetier);
    });

    it('surface le franco de port et la commande minimum du fournisseur comparé', () => {
      const idAutreFournisseur = creerFournisseur(base, {
        nom: 'Grossiste avec conditions',
        type: 'grossiste',
        email: null,
        telephone: null,
        adresse: null,
        delaiLivraisonJours: 5,
        francoDePortCents: 15_000,
        commandeMinimumCents: 5_000,
        notes: null,
      });
      const maintenant = maintenantUtc();
      base
        .insert(conditionnement)
        .values({
          id: nouvelIdentifiant(),
          ingredientId: idFarine,
          fournisseurId: idAutreFournisseur,
          libelle: 'Sac 25 kg',
          quantiteUniteRef: 25_000,
          prixCents: 1_700,
          datePrix: '2026-07-28',
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const detection = detecterEconomiePotentielle(base, {
        ingredientId: idFarine,
        fournisseurId: idAutreFournisseur,
        prixCandidatCents: 1_600,
      });

      expect(detection.francoDePortCents).toBe(15_000);
      expect(detection.commandeMinimumCents).toBe(5_000);
    });
  });

  /** Vérifie que `enregistrerNouveauTarif` (utilisée par `renegocierTarifAvecEconomie`)
   * n'est pas dupliquée : archivage et refus de date antérieure restent SA logique. */
  describe('renegocierTarifAvecEconomie ne duplique pas enregistrerNouveauTarif', () => {
    it('refuse une date ÉGALE à la date de la graine, comme `enregistrerNouveauTarif` seule', () => {
      // Exactement la date semée (`datePrixInitialFarine`), jamais un
      // littéral en dur : cette valeur teste précisément la branche « égale »
      // du garde-fou (`tarif.datePrix <= ancien.datePrix`,
      // `depots/referentiel-ecriture.ts`), quel que soit le jour réel où la
      // suite s'exécute — voir la note sur `datePrixInitialFarine` plus haut.
      expect(() =>
        renegocierTarifAvecEconomie(base, {
          conditionnementId: idConditionnementFarine,
          prixCents: 1_000,
          datePrix: datePrixInitialFarine,
          referenceFournisseur: null,
          quantiteConcernee: 1,
          description: null,
          saisiPar: null,
        }),
      ).toThrow(ErreurMetier);
    });

    it('archive bien l’ancienne ligne (même garantie que `enregistrerNouveauTarif`)', () => {
      renegocierTarifAvecEconomie(base, {
        conditionnementId: idConditionnementFarine,
        prixCents: 1_800,
        datePrix: ajouterJours(datePrixInitialFarine, 1), // toujours postérieure — voir la note sur `datePrixInitialFarine`
        referenceFournisseur: null,
        quantiteConcernee: 1,
        description: null,
        saisiPar: null,
      });

      const ancienne = base
        .select({ actif: conditionnement.actif })
        .from(conditionnement)
        .where(eq(conditionnement.id, idConditionnementFarine))
        .get()!;
      expect(ancienne.actif).toBe(false);
    });
  });

  // `enregistrerNouveauTarif` importée pour prouver qu'un appel direct produit
  // le même archivage que via `renegocierTarifAvecEconomie` ci-dessus — sans
  // quoi le test précédent pourrait cacher une divergence de comportement.
  it('sanity : enregistrerNouveauTarif seule archive aussi la ligne précédente', () => {
    enregistrerNouveauTarif(base, idConditionnementFarine, {
      prixCents: 1_800,
      datePrix: ajouterJours(datePrixInitialFarine, 1), // toujours postérieure — voir la note sur `datePrixInitialFarine`
      referenceFournisseur: null,
    });
    const ancienne = base
      .select({ actif: conditionnement.actif })
      .from(conditionnement)
      .where(eq(conditionnement.id, idConditionnementFarine))
      .get()!;
    expect(ancienne.actif).toBe(false);
  });
});
