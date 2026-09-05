/**
 * `aujourdHui()` — la garantie anti-antidatage de l'interface.
 *
 * ═══ Pourquoi ce fichier existe ═══
 *
 * Mesure du 01/08/2026 : `lib/dates.ts` était couvert à 50 %, et les deux
 * lignes manquantes étaient le CORPS de la fonction. Autrement dit, 15 écrans
 * l'importent (Registre AFSCA, Sessions, Production, Comptabilité, Stock,
 * Factures…) et aucun test ne l'avait jamais appelée.
 *
 * Ce qu'elle protège n'est pas cosmétique. Le commentaire de `dates.ts` le
 * dit : une `const AUJOURD_HUI = jourCivilBelge(new Date())` posée au niveau
 * du module n'est évaluée QU'UNE FOIS, à l'import. L'application est un poste
 * de bureau qu'on laisse ouvert plusieurs jours ; le lundi, le formulaire
 * proposait encore la date du vendredi où l'onglet avait été ouvert.
 *
 * Sur les écrans qui écrivent une date en base, c'est un ANTIDATAGE PAR
 * L'INTERFACE — CLAUDE.md §7 exige que le registre porte la date de saisie
 * réelle, et l'utilisateur n'a aucun moyen de voir que la date proposée est
 * périmée. Le passage de la constante à la fonction est donc un correctif
 * réglementaire, et rien ne l'empêchait de repartir en arrière.
 *
 * ═══ Le piège de fixture évité ici ═══
 *
 * Un test qui appellerait deux fois `aujourdHui()` à la même seconde
 * obtiendrait deux fois la même valeur — et passerait tout autant avec la
 * constante gelée qu'avec la fonction. Il faut donc DÉPLACER l'horloge entre
 * les deux appels : c'est la seule fixture capable de distinguer les deux
 * implémentations.
 *
 * ═══ Ce que ce fichier ne prouve pas ═══
 *
 * La justesse de `jourCivilBelge` lui-même (fuseau, heure d'été, minuit) :
 * elle est prouvée dans `packages/core`, où vit la logique métier chiffrée
 * (CLAUDE.md §3 règle 1). Ici on prouve seulement QUAND l'horloge est lue.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { jourCivilBelge } from '@batte/core';
import { aujourdHui } from './dates';

afterEach(() => {
  vi.useRealTimers();
});

describe('aujourdHui — l’horloge est lue à CHAQUE appel, jamais figée à l’import', () => {
  it('rend le jour civil belge de l’instant courant', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T10:00:00Z'));

    // Comparaison au FORMATEUR et non à un littéral tapé à la main : c'est
    // `jourCivilBelge` qui définit la forme du jour civil belge, et un
    // littéral figerait ici une convention qui appartient à `packages/core`.
    expect(aujourdHui()).toBe(jourCivilBelge(new Date('2026-08-01T10:00:00Z')));
  });

  it('CHANGE quand le jour change, l’onglet restant ouvert', () => {
    // Le cas réel : l'onglet est ouvert le vendredi, la saisie a lieu le lundi.
    // Une constante de module rendrait ici deux fois la même date — c'est
    // exactement le défaut que ce test interdit de réintroduire.
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-07-31T18:00:00Z'));
    const vendredi = aujourdHui();

    vi.setSystemTime(new Date('2026-08-03T09:00:00Z'));
    const lundi = aujourdHui();

    expect(vendredi).not.toBe(lundi);
    expect(vendredi).toBe(jourCivilBelge(new Date('2026-07-31T18:00:00Z')));
    expect(lundi).toBe(jourCivilBelge(new Date('2026-08-03T09:00:00Z')));
  });

  it('suit même un passage de minuit — la saisie du dimanche soir après un marché', () => {
    // La session de La Batte se saisit le dimanche soir ; si la saisie déborde
    // sur minuit, la date proposée doit suivre le jour civil BELGE, pas rester
    // sur la valeur lue à l'ouverture de l'écran.
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-08-02T21:55:00Z'));
    const avant = aujourdHui();
    vi.setSystemTime(new Date('2026-08-02T22:05:00Z'));
    const apres = aujourdHui();

    // 22 h 00 UTC = minuit à Bruxelles en heure d'été : le jour civil belge
    // bascule, alors que la date UTC, elle, ne bouge pas encore.
    expect(avant).not.toBe(apres);
    expect(apres).toBe(jourCivilBelge(new Date('2026-08-02T22:05:00Z')));
  });
});
