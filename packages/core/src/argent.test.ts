import { describe, expect, it } from 'vitest';
import {
  BASE_POINTS,
  appliquerPointsDeBase,
  formaterMontant,
  formaterPointsDeBase,
  parserEuros,
  ratioEnPointsDeBase,
  repartir,
} from './argent.js';
import { ErreurMetier } from './erreurs.js';

describe('parserEuros', () => {
  it('accepte la virgule decimale francophone', () => {
    expect(parserEuros('12,34')).toBe(1234);
  });

  it('accepte le point decimal', () => {
    expect(parserEuros('12.34')).toBe(1234);
  });

  it('accepte le symbole euro et les espaces de milliers', () => {
    expect(parserEuros('1 234,56 €')).toBe(123456);
    // Espace insecable etroit, insere par Intl.NumberFormat en fr-BE.
    expect(parserEuros('1 234,56')).toBe(123456);
  });

  it('rend null sur une saisie non numerique plutot qu un zero silencieux', () => {
    // Un zero implicite fausserait un rapprochement de caisse sans alerter.
    expect(parserEuros('abc')).toBeNull();
    expect(parserEuros('')).toBeNull();
    expect(parserEuros('12,3,4')).toBeNull();
  });

  it('refuse un second point ou un point seul après un signe, comme avant le correctif ReDoS', () => {
    expect(parserEuros('1.2.3')).toBeNull();
    expect(parserEuros('--1')).toBeNull();
    expect(parserEuros('1-')).toBeNull();
    expect(parserEuros(',5')).toBe(50);
    expect(parserEuros('5,')).toBe(500);
  });

  /**
   * CodeQL js/polynomial-redos (28/09/2026) : l'ancien motif `^-?\d*\.?\d*$`
   * essayait chaque partage d'une longue suite de chiffres entre ses deux
   * `\d*` avant de refuser le caractère final (mesuré : 1 s pour 40 000
   * chiffres, ~6 s pour 100 000). Le seuil laisse une marge à une CI lente.
   */
  it('refuse en temps linéaire une longue suite de chiffres invalide (pas de ReDoS)', () => {
    const debut = performance.now();
    expect(parserEuros(`${'9'.repeat(100_000)}x`)).toBeNull();
    expect(performance.now() - debut).toBeLessThan(500);
  });

  it('accepte et refuse exactement les mêmes saisies qu’avec l’ancien motif', () => {
    // Référence : l'ancien comportement, motif `^-?\d*\.?\d*$` compris. Les
    // chaînes générées ne contiennent ni blanc, ni €, ni virgule : le
    // nettoyage de `parserEuros` les laisse telles quelles.
    const ancienParserEuros = (chaine: string): boolean =>
      chaine !== '' && /^-?\d*\.?\d*$/.test(chaine) && Number.isFinite(Number(chaine));
    const alphabet = ['-', '.', '1', '9', 'x'];
    // Toutes les chaînes de 0 à 4 caractères sur cet alphabet : 781 cas.
    let chaines = [''];
    for (let longueur = 0; longueur < 4; longueur++) {
      chaines = chaines.concat(chaines.flatMap((c) => alphabet.map((a) => c + a)));
      chaines = [...new Set(chaines)];
    }
    for (const chaine of chaines) {
      expect(parserEuros(chaine) !== null, JSON.stringify(chaine)).toBe(ancienParserEuros(chaine));
    }
  });

  it('arrondit au centime le plus proche', () => {
    expect(parserEuros('0,005')).toBe(1);
    expect(parserEuros('0,004')).toBe(0);
  });

  it('accepte un montant negatif (ecart de caisse en moins)', () => {
    expect(parserEuros('-3,50')).toBe(-350);
  });

  it('arrondit un demi negatif comme son oppose, et ne rend jamais -0', () => {
    // « -0,005 € » vaut -1 centime, exactement comme « 0,005 € » vaut 1 centime.
    expect(parserEuros('-0,005')).toBe(-1);
    // Un montant qui s'arrondit a zero est zero : `-0` s'afficherait « -0,00 € »
    // et casserait toute comparaison stricte en aval.
    expect(Object.is(parserEuros('-0,004'), -0)).toBe(false);
    expect(parserEuros('-0,004')).toBe(0);
  });
});

describe('formaterMontant', () => {
  it('affiche toujours deux decimales', () => {
    expect(formaterMontant(100)).toBe('1,00');
    expect(formaterMontant(0)).toBe('0,00');
  });
});

describe('appliquerPointsDeBase', () => {
  it('applique la commission SumUp de 1,69 %', () => {
    // 838,00 € de CA carte -> 14,16 € de commission.
    expect(appliquerPointsDeBase(83_800, 169)).toBe(1416);
  });

  it('rend un entier, jamais un flottant', () => {
    const resultat = appliquerPointsDeBase(3333, 169);
    expect(Number.isInteger(resultat)).toBe(true);
  });

  it('est neutre a 10 000 points de base', () => {
    expect(appliquerPointsDeBase(12_345, 10_000)).toBe(12_345);
    expect(appliquerPointsDeBase(-12_345, 10_000)).toBe(-12_345);
  });

  /**
   * Le remboursement doit rendre exactement ce que l'encaissement a pris. Avec
   * `Math.round` seul, `round(-0,5)` valait `-0` la ou `round(0,5)` vaut 1 : la
   * commission d'un avoir differait d'un centime de celle de la vente annulee,
   * et le residu restait au journal sans contrepartie.
   */
  it('est symetrique par changement de signe sur le cas limite du demi-centime', () => {
    expect(appliquerPointsDeBase(1, 5000)).toBe(1);
    expect(appliquerPointsDeBase(-1, 5000)).toBe(-1);
    expect(appliquerPointsDeBase(-1, 5000)).toBe(-appliquerPointsDeBase(1, 5000));
  });

  it('annule exactement une commission SumUp sur un remboursement', () => {
    const encaissement = appliquerPointsDeBase(83_800, 169);
    const remboursement = appliquerPointsDeBase(-83_800, 169);
    expect(remboursement).toBe(-1416);
    // Aucun residu au journal : les deux commissions se soldent a zero.
    expect(encaissement + remboursement).toBe(0);
  });

  it('est symetrique sur toute la plage de montants et de taux utile', () => {
    for (const centimes of [0, 1, 3, 7, 50, 99, 1234, 83_800, 1_000_001]) {
      for (const taux of [0, 1, 50, 169, 2100, 5000, 9999, BASE_POINTS, 20_000]) {
        const positif = appliquerPointsDeBase(centimes, taux);
        const negatif = appliquerPointsDeBase(-centimes, taux);
        // Somme nulle plutot que `toBe(-positif)` : cela evite de comparer un
        // `0` a un `-0`, distinction que `Object.is` fait mais que la
        // comptabilite ignore.
        expect(negatif + positif).toBe(0);
        expect(Number.isInteger(negatif)).toBe(true);
      }
    }
  });

  it('ne rend jamais -0 sur un montant negatif qui s arrondit a zero', () => {
    // -0,0001 % de 1 centime : mathematiquement -0,0000001 centime, donc zero.
    expect(Object.is(appliquerPointsDeBase(-1, 1), -0)).toBe(false);
    expect(appliquerPointsDeBase(-1, 1)).toBe(0);
    expect(Object.is(appliquerPointsDeBase(0, 169), -0)).toBe(false);
  });
});

describe('formaterPointsDeBase', () => {
  it('affiche une decimale quand elle est utile (15,5 %)', () => {
    expect(formaterPointsDeBase(1550)).toBe('15,5 %');
  });

  it('affiche la commission SumUp de 1,69 % avec ses deux decimales', () => {
    expect(formaterPointsDeBase(169)).toBe('1,69 %');
  });

  it('affiche un taux nul sans decimale parasite', () => {
    expect(formaterPointsDeBase(0)).toBe('0 %');
  });

  it('affiche 100 % a la base entiere (10 000 points de base)', () => {
    expect(formaterPointsDeBase(BASE_POINTS)).toBe('100 %');
  });

  it('n’affiche jamais plus de deux decimales, meme sur un taux qui en produirait plus', () => {
    expect(formaterPointsDeBase(12_345)).toBe('123,45 %');
  });

  it('affiche un tres petit taux (1 point de base = 0,01 %) sans le faire disparaitre a zero', () => {
    expect(formaterPointsDeBase(1)).toBe('0,01 %');
  });

  it('affiche un taux negatif avec son signe, sans produire -0 %', () => {
    expect(formaterPointsDeBase(-500)).toBe('-5 %');
    expect(formaterPointsDeBase(-1)).toBe('-0,01 %');
  });

  it('affiche un taux superieur a 100 %', () => {
    expect(formaterPointsDeBase(20_000)).toBe('200 %');
  });
});

describe('ratioEnPointsDeBase', () => {
  it('exprime un taux d ecoulement', () => {
    // 154 vendues sur 172 produites = 89,53 %.
    expect(ratioEnPointsDeBase(154, 172)).toBe(8953);
  });

  it('rend 0 sur un total nul au lieu de diviser par zero', () => {
    expect(ratioEnPointsDeBase(0, 0)).toBe(0);
  });

  it('ne rend jamais -0 sur un ratio negatif negligeable', () => {
    // Un ecart de caisse d'un centime sur 10 000 € : -0,000001, donc 0 point de base.
    expect(Object.is(ratioEnPointsDeBase(-1, 1_000_000), -0)).toBe(false);
    expect(ratioEnPointsDeBase(-1, 1_000_000)).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   repartir — la somme des parts doit egaler le tout, sans exception
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Combinaisons balayees par les proprietes ci-dessous. Volontairement enumerees
 * plutot que tirees au hasard : un test de repartition qui echoue doit etre
 * rejouable a l'identique, et la liste montre d'un coup d'oeil ce qui est
 * couvert (totaux negatifs, poids nuls, poids fractionnaires, part unique).
 */
const TOTAUX_TESTES: readonly number[] = [
  0, 1, -1, 2, 7, -7, 99, 100, -100, 101, 333, -333, 12_345, -12_345, 83_800, 1_000_001,
];

const JEUX_DE_POIDS_TESTES: readonly (readonly number[])[] = [
  [1],
  [5],
  [1, 1],
  [1, 2],
  [1, 1, 1],
  [3333, 3333, 3334],
  [0, 1],
  [1, 0],
  [1, 0, 1],
  [0, 0, 5],
  [7, 3],
  [1, 2, 3, 4, 5],
  [999, 1],
  [2.5, 7.5],
  [1, 1, 1, 1, 1, 1],
  [145, 240, 55, 23, 2], // proportions de la recette R1 (CLAUDE.md §6)
];

describe('repartir', () => {
  it('la somme des parts egale exactement le total, sur toutes les combinaisons', () => {
    for (const total of TOTAUX_TESTES) {
      for (const poids of JEUX_DE_POIDS_TESTES) {
        const parts = repartir(total, poids);
        expect(parts).toHaveLength(poids.length);
        // Egalite EXACTE, aucune tolerance : ce sont des entiers de centimes.
        expect(parts.reduce((somme, part) => somme + part, 0)).toBe(total);
        for (const part of parts) {
          expect(Number.isInteger(part)).toBe(true);
        }
      }
    }
  });

  /**
   * Le cas exact releve en audit : 1,00 € en trois tiers. Arrondir chaque part
   * separement fait disparaitre un centime ; `repartir` ne le peut pas.
   */
  it('ne perd pas de centime la ou l arrondi part par part en perd un', () => {
    const poids = [3333, 3333, 3334];
    const naif = poids.map((p) => appliquerPointsDeBase(100, p));
    expect(naif.reduce((s, p) => s + p, 0)).toBe(99);

    expect(repartir(100, poids).reduce((s, p) => s + p, 0)).toBe(100);
  });

  it('place le reliquat sur la derniere part, de maniere stable', () => {
    // Decoupage attendu, fige : la fonction doit rendre le meme resultat a
    // chaque appel, sinon un journal recalcule bougerait apres impression.
    expect(repartir(100, [1, 1, 1])).toEqual([33, 34, 33]);
    expect(repartir(100, [1, 1, 1])).toEqual(repartir(100, [1, 1, 1]));

    const parts = repartir(1000, [1, 1, 1]);
    // Contrat documente : la derniere part est le reste exact du total.
    expect(parts[2]).toBe(1000 - parts[0]! - parts[1]!);
  });

  it('aucune part ne s ecarte de plus d un centime de sa part exacte', () => {
    for (const total of TOTAUX_TESTES) {
      for (const poids of JEUX_DE_POIDS_TESTES) {
        const sommePoids = poids.reduce((s, p) => s + p, 0);
        if (sommePoids === 0) continue;
        const parts = repartir(total, poids);
        for (let i = 0; i < poids.length; i += 1) {
          const exacte = (total * poids[i]!) / sommePoids;
          // BORNE DERIVEE, pas choisie : chaque part est une difference de deux
          // arrondis d'au plus un demi-centime chacun. L'epsilon absorbe le
          // bruit de la division en virgule flottante du calcul de reference.
          expect(Math.abs(parts[i]! - exacte)).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });

  it('un poids nul ne recoit rien, quelle que soit sa position', () => {
    expect(repartir(100, [0, 1])).toEqual([0, 100]);
    expect(repartir(100, [1, 0])).toEqual([100, 0]);
    expect(repartir(100, [1, 0, 1])).toEqual([50, 0, 50]);
  });

  it('une part unique recoit tout le montant, signe compris', () => {
    expect(repartir(7, [5])).toEqual([7]);
    expect(repartir(-7, [5])).toEqual([-7]);
  });

  it('repartir un montant negatif rend l exact oppose du montant positif', () => {
    // Un avoir fournisseur doit se ventiler comme la depense qu'il annule,
    // sinon la difference reste sur un poste analytique sans justification.
    for (const total of [1, 7, 100, 333, 12_345]) {
      for (const poids of JEUX_DE_POIDS_TESTES) {
        const positif = repartir(total, poids);
        const negatif = repartir(-total, poids);
        for (let i = 0; i < poids.length; i += 1) {
          expect(negatif[i]! + positif[i]!).toBe(0);
        }
      }
    }
  });

  it('ne rend jamais -0, meme sur un total negatif', () => {
    for (const part of repartir(-100, [0, 1, 0])) {
      expect(Object.is(part, -0)).toBe(false);
    }
  });

  it('un total nul rend des parts nulles, meme si tous les poids sont nuls', () => {
    // Aucune proportion n'a besoin d'etre calculee : la reponse est evidente et
    // ne merite pas une erreur.
    expect(repartir(0, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(repartir(0, [1, 2, 3])).toEqual([0, 0, 0]);
  });

  it('refuse de repartir sur aucune part plutot que de faire disparaitre le montant', () => {
    // Meme a zero : une liste vide trahit un filtre trop strict ou des donnees
    // pas encore chargees, pas une intention.
    for (const total of [0, 100, -100]) {
      expect(() => repartir(total, [])).toThrow(ErreurMetier);
    }
    try {
      repartir(100, []);
      expect.unreachable('la repartition aurait du lever');
    } catch (erreur) {
      expect((erreur as ErreurMetier).code).toBe('repartition_poids_invalide');
    }
  });

  it('refuse des poids tous nuls sur un total non nul, au lieu d inventer une repartition egale', () => {
    // Repartir a parts egales serait une regle que l'appelant n'a pas demandee.
    expect(() => repartir(100, [0, 0, 0])).toThrow(ErreurMetier);
    try {
      repartir(100, [0, 0]);
      expect.unreachable('la repartition aurait du lever');
    } catch (erreur) {
      expect((erreur as ErreurMetier).code).toBe('repartition_poids_invalide');
    }
  });

  it('refuse un poids negatif ou non fini au lieu de propager NaN', () => {
    // Meme lecon que la densite non finie (D-034) : une valeur non finie qui
    // traverse une garde contamine tout ce qui la consomme en aval.
    for (const poids of [
      [1, -1],
      [-5],
      [1, Number.NaN],
      [Number.POSITIVE_INFINITY, 1],
      [1, Number.NEGATIVE_INFINITY],
    ]) {
      expect(() => repartir(100, poids)).toThrow(ErreurMetier);
    }
  });

  it('refuse un total qui n est pas un entier de centimes', () => {
    for (const total of [10.5, Number.NaN, Number.POSITIVE_INFINITY, -0.5]) {
      expect(() => repartir(total, [1, 1])).toThrow(ErreurMetier);
    }
    try {
      repartir(10.5, [1, 1]);
      expect.unreachable('la repartition aurait du lever');
    } catch (erreur) {
      expect((erreur as ErreurMetier).code).toBe('repartition_montant_invalide');
    }
  });
});
