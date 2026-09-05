/**
 * Les deux contrôles de LIGNE de `enregistrerReception`, jamais exercés.
 *
 * `reception_vide` est déjà couvert. Les deux gardes qui suivent, non — alors
 * qu'elles portent sur les deux nombres qui entrent réellement en stock :
 *
 *  - `quantite <= 0` : une ligne à zéro créerait un LOT sans matière, donc une
 *    traçabilité AFSCA rattachée à rien ; une ligne négative RETIRERAIT du
 *    stock par une réception, ce qu'aucun écran ne pourrait ensuite expliquer.
 *  - `prixLigneCents < 0` : le prix de ligne alimente le CUMP. Un prix négatif
 *    y ferait baisser le coût matière moyen, donc monter la marge — exactement
 *    le chiffre que CLAUDE.md §7 interdit de fabriquer.
 *
 * Le refus doit intervenir AVANT toute écriture : la réception est atomique,
 * une ligne fautive ne doit laisser ni lot ni mouvement derrière elle.
 */

import { ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { fournisseur, ingredient, lot, mouvementStock } from '../schema.js';
import { enregistrerReception } from './reception.js';

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

describe('enregistrerReception — contrôles de ligne', () => {
  let base: BaseBatte;
  let idFournisseur: string;
  let idFarine: string;
  let idLait: string;

  /**
   * Deux lignes, dont la PREMIÈRE est toujours saine. Une réception réduite à
   * la seule ligne fautive ne prouverait pas que le refus intervient avant
   * toute écriture : la première ligne, elle, aurait pu passer.
   */
  function receptionAvecSecondeLigne(quantite: number, prixLigneCents: number) {
    return {
      fournisseurId: idFournisseur,
      dateReception: '2026-02-10',
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 25_000,
          prixLigneCents: 2500,
          numeroLotFournisseur: 'LOT-SAIN',
        },
        {
          ingredientId: idLait,
          quantite,
          prixLigneCents,
          numeroLotFournisseur: 'LOT-FAUTIF',
        },
      ],
    };
  }

  function nbLots(): number {
    return base.select().from(lot).all().length;
  }

  function nbMouvements(): number {
    return base.select().from(mouvementStock).all().length;
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
        nom: 'Grossiste de test',
        type: 'grossiste',
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    for (const [nom, unite, cible] of [
      ['Farine T55', 'g', 'farine'],
      ['Lait entier', 'ml', 'lait'],
    ] as const) {
      const id = nouvelIdentifiant();
      base
        .insert(ingredient)
        .values({
          id,
          nom,
          categorie: cible === 'farine' ? 'farine' : 'laitier',
          uniteReference: unite,
          allergenes: [],
          stockSecurite: 0,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      if (cible === 'farine') idFarine = id;
      else idLait = id;
    }
  });

  it('accepte une réception à deux lignes saines — la référence', () => {
    const resultat = enregistrerReception(base, receptionAvecSecondeLigne(1000, 120));
    expect(resultat.lotsCrees.length).toBe(2);
    expect(nbLots()).toBe(2);
  });

  it('refuse une ligne de quantité nulle, sans créer AUCUN lot', () => {
    const erreur = attendCode(
      () => enregistrerReception(base, receptionAvecSecondeLigne(0, 120)),
      'quantite_invalide',
    );
    expect(erreur.champs).toHaveProperty('quantite');
    // Atomicité : la première ligne, pourtant saine, ne doit rien avoir écrit.
    expect(nbLots()).toBe(0);
    expect(nbMouvements()).toBe(0);
  });

  it('refuse une ligne de quantité négative', () => {
    attendCode(
      () => enregistrerReception(base, receptionAvecSecondeLigne(-1000, 120)),
      'quantite_invalide',
    );
    expect(nbLots()).toBe(0);
  });

  it('refuse un prix de ligne négatif, sans créer AUCUN lot', () => {
    const erreur = attendCode(
      () => enregistrerReception(base, receptionAvecSecondeLigne(1000, -120)),
      'prix_invalide',
    );
    expect(erreur.champs).toHaveProperty('prixLigneCents');
    expect(nbLots()).toBe(0);
    expect(nbMouvements()).toBe(0);
  });

  it('accepte en revanche un prix de ligne à ZÉRO — un échantillon gratuit existe', () => {
    // Discrimine : la garde porte sur « négatif », pas sur « nul ». Un
    // échantillon offert par le meunier est une entrée réelle, à tracer, dont
    // le prix payé est bien zéro — ce n'est pas un prix INCONNU.
    const resultat = enregistrerReception(base, receptionAvecSecondeLigne(1000, 0));
    expect(resultat.lotsCrees.length).toBe(2);
  });
});
