/**
 * Les deux vérifications d'existence de `depots/economies.ts` que rien
 * n'appelait : `conditionnementId` et `commandeId`.
 *
 * `economies.test.ts` couvre déjà l'ingrédient, le fournisseur et le refus
 * d'économie non positive. Les deux références FACULTATIVES, elles, n'étaient
 * exercées par aucun test — ni pour refuser une valeur inconnue, ni même pour
 * accepter une valeur connue : les deux fonctions n'étaient jamais appelées du
 * tout, puisque toute la suite passait `null` aux deux champs.
 *
 * Ce n'est pas cosmétique : les deux colonnes portent une vraie clé étrangère
 * (`foreign_keys = ON`, `client.ts`). Sans ces gardes, un identifiant recopié
 * de travers ne se manifesterait qu'en violation de contrainte SQLite — un 500
 * brut à la place d'un 422 nommant le champ fautif.
 */

import { ErreurIntrouvable, ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { commandeFournisseur, conditionnement, fournisseur, ingredient } from '../schema.js';
import {
  enregistrerEconomie,
  renegocierTarifAvecEconomie,
  type EntreeEconomie,
} from './economies.js';

const JOUR = '2026-07-28';

function attendCode(fn: () => unknown, code: string): ErreurMetier {
  try {
    fn();
    expect.unreachable(`devait lever une ErreurMetier de code « ${code} »`);
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect((erreur as ErreurMetier).code).toBe(code);
    return erreur as ErreurMetier;
  }
  throw new Error('inatteignable');
}

describe('enregistrerEconomie — références facultatives', () => {
  let base: BaseBatte;
  let idIngredient: string;
  let idFournisseur: string;
  let idConditionnement: string;
  let idCommande: string;

  /** Économie valide : 100 c -> 90 c, les deux références à `null`. */
  function economieDeBase(): EntreeEconomie {
    return {
      dateAction: JOUR,
      ingredientId: idIngredient,
      fournisseurId: idFournisseur,
      conditionnementId: null,
      typeAction: 'negociation_prix',
      description: 'Renégociation annuelle',
      prixUnitaireAvantCents: 100,
      prixUnitaireApresCents: 90,
      quantiteConcernee: 25_000,
      commandeId: null,
      saisiPar: null,
    };
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const maintenant = maintenantUtc();

    idFournisseur = nouvelIdentifiant();
    base
      .insert(fournisseur)
      .values({
        id: idFournisseur,
        nom: 'Moulin de la Statte',
        type: 'moulin',
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idIngredient = nouvelIdentifiant();
    base
      .insert(ingredient)
      .values({
        id: idIngredient,
        nom: 'Farine T55',
        categorie: 'farine',
        uniteReference: 'g',
        allergenes: ['gluten'],
        stockSecurite: 0,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idConditionnement = nouvelIdentifiant();
    base
      .insert(conditionnement)
      .values({
        id: idConditionnement,
        ingredientId: idIngredient,
        fournisseurId: idFournisseur,
        libelle: 'Sac 25 kg',
        quantiteUniteRef: 25_000,
        prixCents: 2500,
        datePrix: JOUR,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idCommande = nouvelIdentifiant();
    base
      .insert(commandeFournisseur)
      .values({
        id: idCommande,
        numero: 'CF-2026-0001',
        fournisseurId: idFournisseur,
        dateCreation: JOUR,
        statut: 'brouillon',
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  });

  it('accepte une économie rattachée à un conditionnement ET à une commande RÉELS', () => {
    // Le cas passant vient d'abord : sans lui, les deux refus ci-dessous
    // pourraient tenir à une fixture globalement invalide.
    const ligne = enregistrerEconomie(base, {
      ...economieDeBase(),
      conditionnementId: idConditionnement,
      commandeId: idCommande,
    });
    expect(ligne.conditionnementId).toBe(idConditionnement);
    expect(ligne.commandeNumero).toBe('CF-2026-0001');
    // Économie DÉRIVÉE, jamais stockée : (100 - 90) × 25 000 unités.
    expect(ligne.economieCents).toBe(10 * 25_000);
  });

  it('refuse un conditionnement inexistant, en nommant le champ', () => {
    const erreur = attendCode(
      () =>
        enregistrerEconomie(base, {
          ...economieDeBase(),
          conditionnementId: nouvelIdentifiant(),
        }),
      'conditionnement_introuvable',
    );
    expect(erreur.champs).toHaveProperty('conditionnementId');
  });

  it('refuse une commande inexistante, en nommant le champ', () => {
    const erreur = attendCode(
      () =>
        enregistrerEconomie(base, {
          ...economieDeBase(),
          commandeId: nouvelIdentifiant(),
        }),
      'commande_introuvable',
    );
    expect(erreur.champs).toHaveProperty('commandeId');
  });

  it('n’exige NI l’un NI l’autre : les deux à null restent le cas normal', () => {
    // Discrimine : une garde posée sur la présence plutôt que sur l'existence
    // refuserait ce cas, qui est celui du formulaire de saisie libre.
    const ligne = enregistrerEconomie(base, economieDeBase());
    expect(ligne.conditionnementId).toBeNull();
    expect(ligne.commandeNumero).toBeNull();
  });

  it('renegocierTarifAvecEconomie rend 404 sur un conditionnement inexistant', () => {
    // La lecture PRÉALABLE du conditionnement (elle sert à décrire l'ancien
    // tarif dans la description par défaut) est le premier geste de cette
    // fonction : son refus n'était couvert par rien. 404 et non 422 —
    // l'identifiant vient de l'URL de la sous-ressource `/tarifs`.
    try {
      renegocierTarifAvecEconomie(base, {
        conditionnementId: nouvelIdentifiant(),
        prixCents: 2400,
        datePrix: '2026-08-15',
        referenceFournisseur: null,
        quantiteConcernee: 25_000,
        description: null,
        saisiPar: null,
      });
      expect.unreachable('devait lever ErreurIntrouvable');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurIntrouvable);
      expect((erreur as ErreurIntrouvable).statut).toBe(404);
    }
  });

  it('renégocie normalement un conditionnement RÉEL, et en capture l’économie', () => {
    // Discrimine : sans ce cas, le 404 ci-dessus pourrait masquer un refus
    // systématique. 2 500 c -> 2 400 c sur 25 000 g : l'économie est
    // strictement positive, donc enregistrée.
    const resultat = renegocierTarifAvecEconomie(base, {
      conditionnementId: idConditionnement,
      prixCents: 2400,
      datePrix: '2026-08-15',
      referenceFournisseur: null,
      quantiteConcernee: 25_000,
      description: null,
      saisiPar: null,
    });
    expect(resultat.economie).not.toBeNull();
    // (2 500 - 2 400) centimes par sac × 25 000 unités de référence.
    expect(resultat.economie!.economieCents).toBe(100 * 25_000);
  });
});
