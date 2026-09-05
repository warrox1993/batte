/**
 * Numérotation documentaire séquentielle (`depots/numerotation.ts`).
 *
 * `allouerNumero` était exercée indirectement par les réceptions, productions
 * et sessions ; `lireSeries` — la lecture qui alimente l'écran d'administration
 * — ne l'était par rien. Or c'est le seul endroit d'où l'on peut constater
 * qu'une série est bien continue : sans elle, un trou dans un journal comptable
 * ne se voit nulle part.
 *
 * La séquence sans trou n'est pas une convention de confort : la tenue de
 * comptabilité informatisée belge impose une numérotation contrôlée par le
 * logiciel, « sans blancs ni lacunes » (docs/07 §1.5). Ce fichier vérifie donc
 * aussi la CONTINUITÉ, pas seulement la lisibilité du format.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { allouerNumero, lireSeries } from './numerotation.js';

describe('numérotation documentaire', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('alloue des numéros consécutifs et sans trou dans une même série', () => {
    expect(allouerNumero(base, 'reception', 2026)).toBe('RC-2026-0001');
    expect(allouerNumero(base, 'reception', 2026)).toBe('RC-2026-0002');
    expect(allouerNumero(base, 'reception', 2026)).toBe('RC-2026-0003');
  });

  it('tient un compteur SÉPARÉ par nature et par année', () => {
    // Fixture volontairement discriminante : quatre compteurs distincts, dont
    // deux partagent la nature et deux l'année. Un compteur unique global
    // passerait un test à une seule série.
    allouerNumero(base, 'reception', 2026);
    allouerNumero(base, 'reception', 2026);
    expect(allouerNumero(base, 'commande', 2026)).toBe('CF-2026-0001');
    expect(allouerNumero(base, 'reception', 2027)).toBe('RC-2027-0001');
    expect(allouerNumero(base, 'reception', 2026)).toBe('RC-2026-0003');
  });

  it('lireSeries rend le dernier numéro attribué de chaque série', () => {
    allouerNumero(base, 'reception', 2026);
    allouerNumero(base, 'reception', 2026);
    allouerNumero(base, 'production', 2026);

    const series = lireSeries(base);
    const reception = series.find((s) => s.nature === 'reception' && s.annee === 2026);
    const production = series.find((s) => s.nature === 'production' && s.annee === 2026);

    expect(reception?.dernierNumero).toBe(2);
    expect(reception?.prefixe).toBe('RC');
    expect(production?.dernierNumero).toBe(1);
    // Aucune série jamais allouée ne doit apparaître : la table est peuplée à
    // la première allocation, pas d'avance.
    expect(series.some((s) => s.nature === 'inventaire')).toBe(false);
  });

  it('lireSeries porte le régime de trous propre à chaque nature', () => {
    // Une session planifiée puis annulée laisse un trou légitime (ce n'est pas
    // un document financier) ; une réception, jamais. La distinction doit
    // rester lisible depuis l'écran d'administration.
    allouerNumero(base, 'session', 2026);
    allouerNumero(base, 'reception', 2026);

    const series = lireSeries(base);
    expect(series.find((s) => s.nature === 'session')?.autoriseTrous).toBe(true);
    expect(series.find((s) => s.nature === 'reception')?.autoriseTrous).toBe(false);
  });

  it('lireSeries rend une liste vide sur une base migrée mais jamais utilisée', () => {
    // Doctrine du dépôt : rien n'est pré-rempli. Une série affichée à zéro
    // laisserait croire qu'un compteur existe déjà.
    expect(lireSeries(base)).toEqual([]);
  });
});

/**
 * NON COUVERT ET DOIT LE RESTER — `allouerNumero`, lignes 84-87 :
 *
 *   const numero = misAJour[0]?.numero;
 *   if (numero === undefined) throw new Error(...)
 *
 * L'`UPDATE … RETURNING` porte sur la ligne de série que les lignes 57-71
 * viennent d'insérer si elle manquait. Elle existe donc toujours quand
 * l'`UPDATE` s'exécute, et `better-sqlite3` est intégralement synchrone —
 * aucune écriture concurrente ne peut la supprimer entre les deux instructions.
 * Atteindre ce `throw` exigerait de simuler un moteur SQLite qui perd une ligne
 * qu'il vient d'écrire : un test qui affirmerait qu'un cas impossible se
 * comporte bien, et qui mentirait donc sur ce que fait le programme.
 */
