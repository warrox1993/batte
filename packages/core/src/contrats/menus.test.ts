/**
 * Tests du contrat HTTP des MENUS (fiche 16 §2.2), en particulier
 * `prixForceCents` — mission du 30/07/2026 : le dépôt (`packages/db`,
 * `depots/menus.ts`) savait déjà écrire, lire et appliquer ce réglage, mais
 * `schemaSaisieCompositionMenu`/`schemaCompositionMenu` ne le portaient pas,
 * ce qui empêchait tout écran de le SAUVEGARDER. Ces tests couvrent
 * uniquement le contrat Zod (bornes, `null` vs absence vs `0`) : la
 * persistance elle-même est déjà testée par `packages/db/src/depots/menus.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { schemaCompositionMenu, schemaSaisieCompositionMenu } from './menus.js';

describe('schemaSaisieCompositionMenu — prixForceCents', () => {
  const SAISIE_BASE = { produitInclusId: 'produit-1', quantite: 1 };

  it('reste valide quand le champ est complètement omis (formulaire prorata pur)', () => {
    const resultat = schemaSaisieCompositionMenu.parse(SAISIE_BASE);
    expect(resultat.prixForceCents).toBeUndefined();
  });

  it('accepte un montant entier de centimes, positif', () => {
    const resultat = schemaSaisieCompositionMenu.parse({ ...SAISIE_BASE, prixForceCents: 150 });
    expect(resultat.prixForceCents).toBe(150);
  });

  it('accepte `null` — « aucun prix imposé, ce composant suit le prorata »', () => {
    const resultat = schemaSaisieCompositionMenu.parse({ ...SAISIE_BASE, prixForceCents: null });
    expect(resultat.prixForceCents).toBeNull();
  });

  it('accepte `0` — un composant OFFERT dans ce menu, une valeur légitime, distincte de l’absence', () => {
    const resultat = schemaSaisieCompositionMenu.parse({ ...SAISIE_BASE, prixForceCents: 0 });
    expect(resultat.prixForceCents).toBe(0);
  });

  it('rejette un montant négatif', () => {
    expect(() =>
      schemaSaisieCompositionMenu.parse({ ...SAISIE_BASE, prixForceCents: -10 }),
    ).toThrow();
  });

  it('rejette un montant non entier (centimes uniquement, jamais de flottant)', () => {
    expect(() =>
      schemaSaisieCompositionMenu.parse({ ...SAISIE_BASE, prixForceCents: 1.5 }),
    ).toThrow();
  });

  it('rejette un `undefined` envoyé EXPLICITEMENT (à distinguer d’une clé absente)', () => {
    // `.exactOptional()` : la clé peut manquer, mais si elle est présente,
    // elle ne peut pas valoir `undefined` — seulement un entier ou `null`.
    expect(() =>
      schemaSaisieCompositionMenu.parse({ ...SAISIE_BASE, prixForceCents: undefined }),
    ).toThrow();
  });
});

describe('schemaCompositionMenu — prixForceCents (lecture)', () => {
  const LECTURE_BASE = {
    id: 'ligne-1',
    menuId: 'menu-1',
    produitInclusId: 'produit-1',
    nomProduitInclus: 'Café',
    nature: 'revendu' as const,
    quantite: 1,
    prixCatalogueCents: 200,
    actif: true,
  };

  it('EXIGE le champ (le dépôt le fournit toujours en lecture) — absent, le parse échoue', () => {
    expect(() => schemaCompositionMenu.parse(LECTURE_BASE)).toThrow();
  });

  it('accepte `null` — aucun prix imposé sur ce composant', () => {
    const resultat = schemaCompositionMenu.parse({ ...LECTURE_BASE, prixForceCents: null });
    expect(resultat.prixForceCents).toBeNull();
  });

  it('accepte un montant imposé', () => {
    const resultat = schemaCompositionMenu.parse({ ...LECTURE_BASE, prixForceCents: 150 });
    expect(resultat.prixForceCents).toBe(150);
  });
});
