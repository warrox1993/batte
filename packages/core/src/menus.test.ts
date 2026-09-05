import { describe, expect, it } from 'vitest';
import { formaterEuros } from './argent.js';
import { ErreurMetier } from './erreurs.js';
import {
  exploserVenteMenuEnLignesVente,
  exploserVentesMenusEnQuantitesComposants,
  repartirPrixMenu,
  ventilerMenu,
  type ComposantMenuCalcul,
} from './menus.js';
import { totaliserVentes } from './sessions.js';

/**
 * Vérifie le CODE machine d'une `ErreurMetier`, jamais un extrait du message —
 * le message est en français et destiné à un humain (CLAUDE.md §4), il peut
 * changer sans que la règle qu'il porte change.
 */
function attendCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`devait lever une ErreurMetier de code « ${code} »`);
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect((erreur as ErreurMetier).code).toBe(code);
  }
}

/** Crêpe à 3,50 €, coût de revient 1,15 €, 1 crêpe par unité, transformée. */
function crepe(surcharges: Partial<ComposantMenuCalcul> = {}): ComposantMenuCalcul {
  return {
    produitInclusId: 'crepe',
    nom: 'Crêpe froment',
    nature: 'transforme',
    quantite: 1,
    prixCatalogueCents: 350,
    coutMatiereCents: 115,
    nbCrepesParUnite: 1,
    prixForceCents: null,
    ...surcharges,
  };
}

/** Café à 2,00 €, coût de revient 0,40 €, transformé à la demande (zéro crêpe). */
function cafe(surcharges: Partial<ComposantMenuCalcul> = {}): ComposantMenuCalcul {
  return {
    produitInclusId: 'cafe',
    nom: 'Café',
    nature: 'transforme',
    quantite: 1,
    prixCatalogueCents: 200,
    coutMatiereCents: 40,
    nbCrepesParUnite: 0,
    prixForceCents: null,
    ...surcharges,
  };
}

/** Sirop revendu à 4,00 €, acheté 2,80 €. */
function sirop(surcharges: Partial<ComposantMenuCalcul> = {}): ComposantMenuCalcul {
  return {
    produitInclusId: 'sirop',
    nom: 'Sirop de Liège',
    nature: 'revendu',
    quantite: 1,
    prixCatalogueCents: 400,
    coutMatiereCents: 280,
    nbCrepesParUnite: 0,
    prixForceCents: null,
    ...surcharges,
  };
}

describe('repartirPrixMenu', () => {
  it('ventile au PRORATA des poids quand aucun prix n’est imposé', () => {
    const parts = repartirPrixMenu(500, [
      { nom: 'Crêpe', poids: 350, prixForceCents: null },
      { nom: 'Café', poids: 200, prixForceCents: null },
    ]);

    expect(parts.reduce((a, b) => a + b, 0)).toBe(500);
    // La crêpe (poids 350/550) porte la plus grosse part.
    expect(parts[0]).toBeGreaterThan(parts[1]!);
  });

  it('un composant DÉSIGNÉ reçoit exactement son prix imposé, le reste va aux autres', () => {
    // « Le café est à 1,50 € dans ce menu » : la crêpe absorbe le reste (3,50 €).
    const parts = repartirPrixMenu(500, [
      { nom: 'Crêpe', poids: 350, prixForceCents: null },
      { nom: 'Café', poids: 200, prixForceCents: 150 },
    ]);

    expect(parts).toEqual([350, 150]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(500);
  });

  it('plusieurs composants désignés : le reste se répartit au prorata sur les composants libres restants', () => {
    const parts = repartirPrixMenu(1000, [
      { nom: 'Sirop', poids: 100, prixForceCents: 300 },
      { nom: 'Crêpe', poids: 300, prixForceCents: null },
      { nom: 'Café', poids: 100, prixForceCents: null },
    ]);

    expect(parts[0]).toBe(300);
    expect(parts[1]! + parts[2]!).toBe(700);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('tous les composants désignés, et leur somme correspond exactement au prix du menu', () => {
    const parts = repartirPrixMenu(500, [
      { nom: 'Crêpe', poids: 1, prixForceCents: 300 },
      { nom: 'Café', poids: 1, prixForceCents: 200 },
    ]);

    expect(parts).toEqual([300, 200]);
  });

  it('tous désignés mais la somme NE correspond PAS au prix du menu : erreur, pas un arrondi silencieux', () => {
    expect(() =>
      repartirPrixMenu(500, [
        { nom: 'Crêpe', poids: 1, prixForceCents: 300 },
        { nom: 'Café', poids: 1, prixForceCents: 250 },
      ]),
    ).toThrow(ErreurMetier);
    expect(() =>
      repartirPrixMenu(500, [
        { nom: 'Crêpe', poids: 1, prixForceCents: 300 },
        { nom: 'Café', poids: 1, prixForceCents: 250 },
      ]),
    ).toThrow(/ne correspond pas/);
  });

  it('un prix imposé qui dépasse déjà le prix du menu est refusé', () => {
    expect(() =>
      repartirPrixMenu(500, [
        { nom: 'Sirop', poids: 1, prixForceCents: 600 },
        { nom: 'Crêpe', poids: 100, prixForceCents: null },
      ]),
    ).toThrow(/dépasse déjà/);
  });

  it('refuse un menu sans aucun composant', () => {
    attendCode(() => repartirPrixMenu(500, []), 'menu_sans_composant');
  });

  it('un total nul se ventile en parts nulles, prix imposés compris', () => {
    const parts = repartirPrixMenu(0, [
      { nom: 'Crêpe', poids: 1, prixForceCents: null },
      { nom: 'Café', poids: 1, prixForceCents: 0 },
    ]);
    expect(parts).toEqual([0, 0]);
  });

  it('garantit la somme exacte même quand le prix ne se divise pas proprement (501 c / 3)', () => {
    const parts = repartirPrixMenu(501, [
      { nom: 'Crêpe', poids: 1, prixForceCents: null },
      { nom: 'Café', poids: 1, prixForceCents: null },
      { nom: 'Sirop', poids: 1, prixForceCents: null },
    ]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(501);
  });

  /**
   * LE MESSAGE D'ERREUR LUI-MÊME (audit du 01/08/2026, fiche 16 §2.2) — pas
   * seulement son code. Reproduit le cas RÉEL établi dans le rapport de
   * livraison : une remise fait passer le prix pratiqué SOUS la somme des
   * prix désignés. Le message doit dire QUEL menu, QUELS composants portent
   * un prix désigné (et lequel), les montants en EUROS (jamais des centimes
   * bruts), et les DEUX issues — même niveau d'exigence que le refus
   * d'annulation de réception (`entree_deja_consommee`,
   * `packages/db/src/services/mouvements.ts`).
   */
  describe('message d’erreur — nommer le menu, les composants, et les deux issues', () => {
    it('nomme le menu (quand `contexte.nomMenu` est fourni), les composants désignés en euros, et les deux issues', () => {
      let message = '';
      try {
        repartirPrixMenu(
          900,
          [
            { nom: 'Café', poids: 200, prixForceCents: null },
            { nom: 'Sirop de Liège', poids: 400, prixForceCents: 1140 },
          ],
          { nomMenu: 'Crêpe + sirop' },
        );
        expect.unreachable('devait lever menu_prix_force_incoherent');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        message = (erreur as ErreurMetier).message;
      }

      // Quel menu.
      expect(message).toContain('Crêpe + sirop');
      // Quel composant porte le prix désigné fautif, et son montant en EUROS
      // (jamais « 1140 c », l'unité de stockage qui a fui jusqu'à l'écran).
      // Comparé via `formaterEuros`, pas une chaîne recopiée à la main : le
      // séparateur avant « € » est une espace INSÉCABLE (U+00A0), pas une
      // espace ordinaire — les recopier à la main romprait silencieusement.
      expect(message).toContain('Sirop de Liège');
      expect(message).toContain(formaterEuros(1140));
      expect(message).not.toMatch(/\d+\s*c\b/);
      // Le prix du menu lui-même, en euros.
      expect(message).toContain(formaterEuros(900));
      // Les DEUX issues : corriger le prix pratiqué, ou corriger le réglage du menu.
      expect(message).toMatch(/prix pratiqué/);
      expect(message).toMatch(/prix désigné/);
    });

    it('sans `contexte.nomMenu` (le paramètre est facultatif), le message reste correct — juste sans nom de menu', () => {
      expect(() =>
        repartirPrixMenu(900, [
          { nom: 'Café', poids: 200, prixForceCents: null },
          { nom: 'Sirop de Liège', poids: 400, prixForceCents: 1140 },
        ]),
      ).toThrow(/Sirop de Liège/);
    });

    it('plusieurs composants désignés à la fois : chacun est nommé avec son propre montant', () => {
      let message = '';
      try {
        repartirPrixMenu(500, [
          { nom: 'Crêpe', poids: 1, prixForceCents: null },
          { nom: 'Café', poids: 1, prixForceCents: 300 },
          { nom: 'Sirop', poids: 1, prixForceCents: 250 },
        ]);
        expect.unreachable('devait lever menu_prix_force_incoherent');
      } catch (erreur) {
        message = (erreur as ErreurMetier).message;
      }

      expect(message).toContain('Café');
      expect(message).toContain(formaterEuros(300));
      expect(message).toContain('Sirop');
      expect(message).toContain(formaterEuros(250));
    });
  });

  /**
   * UN PRIX DÉSIGNÉ À 0 € (« composant offert », `CompositionMenuLigne.prixForceCents`
   * dans `packages/db/src/depots/menus.ts`) N'ÉTAIT COUVERT PAR AUCUN TEST
   * avant cette mission. ÉTABLI ici, pas inventé : un composant forcé à 0 se
   * comporte EXACTEMENT comme documenté — il reçoit exactement 0, et les
   * composants libres restants absorbent la TOTALITÉ du prix du menu. Ce
   * n'est PAS absurde : c'est la définition même de « offert dans ce menu ».
   */
  describe('prix désigné à 0 € — composant offert', () => {
    it('un composant forcé à 0 € reçoit exactement 0, le reste du prix va entièrement aux composants libres', () => {
      const parts = repartirPrixMenu(500, [
        { nom: 'Crêpe', poids: 350, prixForceCents: null },
        { nom: 'Café offert', poids: 200, prixForceCents: 0 },
      ]);

      expect(parts).toEqual([500, 0]);
    });

    it('tous les composants forcés, l’un à 0 €, et la somme correspond exactement au prix du menu : aucune erreur', () => {
      const parts = repartirPrixMenu(500, [
        { nom: 'Crêpe', poids: 1, prixForceCents: 500 },
        { nom: 'Café offert', poids: 1, prixForceCents: 0 },
      ]);

      expect(parts).toEqual([500, 0]);
    });

    it('un composant offert (0 €) qui ne suffit pas à expliquer l’écart apparaît quand même dans la liste des désignés du message', () => {
      // Café offert (0 €) + sirop désigné à 3,80 € = 3,80 € désignés, contre
      // un prix pratiqué de 3,00 € : incohérent, et le message doit nommer
      // les DEUX composants désignés, y compris celui à 0 €.
      let message = '';
      try {
        repartirPrixMenu(300, [
          { nom: 'Crêpe', poids: 1, prixForceCents: null },
          { nom: 'Café offert', poids: 1, prixForceCents: 0 },
          { nom: 'Sirop', poids: 1, prixForceCents: 380 },
        ]);
        expect.unreachable('devait lever menu_prix_force_incoherent');
      } catch (erreur) {
        message = (erreur as ErreurMetier).message;
      }

      expect(message).toContain('Café offert');
      expect(message).toContain(formaterEuros(0));
      expect(message).toContain('Sirop');
      expect(message).toContain(formaterEuros(380));
    });
  });
});

describe('ventilerMenu', () => {
  it('crêpe + café à 5,00 € : la somme des parts vaut exactement le prix du menu', () => {
    const ventilation = ventilerMenu(500, [crepe(), cafe()]);

    const sommeParts = ventilation.composants.reduce((a, c) => a + c.partPrixCents, 0);
    expect(sommeParts).toBe(500);
    expect(ventilation.parNatureCents.transforme + ventilation.parNatureCents.revendu).toBe(500);
  });

  it('un menu 100 % transformé ventile tout le prix en `transforme`', () => {
    const ventilation = ventilerMenu(500, [crepe(), cafe()]);
    expect(ventilation.parNatureCents.transforme).toBe(500);
    expect(ventilation.parNatureCents.revendu).toBe(0);
  });

  it('UN MENU PEUT CONTENIR UN PRODUIT REVENDU : la ventilation par nature devient non triviale', () => {
    // Crêpe (transformé, 3,50 €) + sirop (revendu, 4,00 €), vendus 7,00 € en menu.
    const ventilation = ventilerMenu(700, [crepe(), sirop()]);

    expect(ventilation.parNatureCents.transforme).toBeGreaterThan(0);
    expect(ventilation.parNatureCents.revendu).toBeGreaterThan(0);
    expect(ventilation.parNatureCents.transforme + ventilation.parNatureCents.revendu).toBe(700);
  });

  it('la méthode désignée fixe le prix du sirop, la crêpe absorbe le reste', () => {
    const ventilation = ventilerMenu(700, [crepe(), sirop({ prixForceCents: 380 })]);

    const ligneSirop = ventilation.composants.find((c) => c.produitInclusId === 'sirop')!;
    const ligneCrepe = ventilation.composants.find((c) => c.produitInclusId === 'crepe')!;
    expect(ligneSirop.partPrixCents).toBe(380);
    expect(ligneCrepe.partPrixCents).toBe(320);
    expect(ventilation.parNatureCents.revendu).toBe(380);
    expect(ventilation.parNatureCents.transforme).toBe(320);
  });

  it('calcule le coût total, la marge du menu et la marge séparée de référence', () => {
    // Crêpe (cout 1,15 €) + café (cout 0,40 €) = 1,55 € de coût, vendus 5,00 €.
    const ventilation = ventilerMenu(500, [crepe(), cafe()]);

    expect(ventilation.coutTotalCents).toBe(115 + 40);
    expect(ventilation.margeMenuCents).toBe(500 - 155);
    // Vendus séparément : 3,50 + 2,00 = 5,50 €, coût inchangé.
    expect(ventilation.prixSepareTotalCents).toBe(550);
    expect(ventilation.margeSepareeCents).toBe(550 - 155);
    // Le menu coûte 0,50 € de marge par rapport à la vente séparée — la remise entière.
    expect(ventilation.ecartMargeCents).toBe(
      ventilation.margeMenuCents! - ventilation.margeSepareeCents!,
    );
    expect(ventilation.ecartMargeCents).toBe(-50);
  });

  it('un SEUL coût inconnu rend le coût, la marge menu ET la marge séparée inconnus — jamais un total partiel', () => {
    const ventilation = ventilerMenu(500, [crepe(), cafe({ coutMatiereCents: null })]);

    expect(ventilation.coutTotalCents).toBeNull();
    expect(ventilation.margeMenuCents).toBeNull();
    expect(ventilation.margeSepareeCents).toBeNull();
    expect(ventilation.ecartMargeCents).toBeNull();
  });

  it('le CA par nature reste calculable MÊME quand le coût est inconnu (les seuils légaux ne dépendent d’aucun coût)', () => {
    const ventilation = ventilerMenu(700, [crepe(), sirop({ coutMatiereCents: null })]);

    expect(ventilation.coutTotalCents).toBeNull();
    expect(ventilation.parNatureCents.transforme + ventilation.parNatureCents.revendu).toBe(700);
    expect(ventilation.parNatureCents.revendu).toBeGreaterThan(0);
  });

  it('un composant OFFERT (prix catalogue nul) ne fait pas échouer la ventilation : elle bascule sur la quantité', () => {
    const ventilation = ventilerMenu(350, [
      crepe(),
      cafe({ prixCatalogueCents: 0, coutMatiereCents: 40 }),
    ]);

    const somme = ventilation.composants.reduce((a, c) => a + c.partPrixCents, 0);
    expect(somme).toBe(350);
  });

  it('refuse un menu sans aucun composant (propage `menu_sans_composant`)', () => {
    attendCode(() => ventilerMenu(500, []), 'menu_sans_composant');
  });

  it('un composant DÉSIGNÉ à 0 € (offert) reçoit exactement 0, le reste du prix va au composant libre', () => {
    const ventilation = ventilerMenu(350, [crepe(), cafe({ prixForceCents: 0 })]);

    const ligneCafe = ventilation.composants.find((c) => c.produitInclusId === 'cafe')!;
    const ligneCrepe = ventilation.composants.find((c) => c.produitInclusId === 'crepe')!;
    expect(ligneCafe.partPrixCents).toBe(0);
    expect(ligneCrepe.partPrixCents).toBe(350);
  });

  it('`contexte.nomMenu` traverse `ventilerMenu` jusqu’au message d’erreur de `repartirPrixMenu`', () => {
    expect(() =>
      ventilerMenu(300, [crepe(), sirop({ prixForceCents: 380 })], { nomMenu: 'Menu du dimanche' }),
    ).toThrow(/Menu du dimanche/);
  });
});

describe('exploserVentesMenusEnQuantitesComposants — le stock sort par les composants', () => {
  it('un menu vendu N fois avec Q unités d’un composant vaut N × Q ventes effectives de ce composant', () => {
    const compositions = new Map([
      [
        'menu-1',
        [
          { produitInclusId: 'crepe', quantite: 1 },
          { produitInclusId: 'cafe', quantite: 1 },
        ],
      ],
    ]);

    const total = exploserVentesMenusEnQuantitesComposants(
      [{ menuId: 'menu-1', quantite: 3 }],
      compositions,
    );

    expect(total.get('crepe')).toBe(3);
    expect(total.get('cafe')).toBe(3);
  });

  it('cumule sur PLUSIEURS menus qui partagent le même composant', () => {
    const compositions = new Map([
      ['menu-cafe-crepe', [{ produitInclusId: 'cafe', quantite: 1 }]],
      ['menu-cafe-double', [{ produitInclusId: 'cafe', quantite: 2 }]],
    ]);

    const total = exploserVentesMenusEnQuantitesComposants(
      [
        { menuId: 'menu-cafe-crepe', quantite: 4 },
        { menuId: 'menu-cafe-double', quantite: 2 },
      ],
      compositions,
    );

    // 4 x 1 + 2 x 2 = 8.
    expect(total.get('cafe')).toBe(8);
  });

  it('une vente à quantité nulle ou un menu inconnu ne produit aucune sortie', () => {
    const total = exploserVentesMenusEnQuantitesComposants(
      [
        { menuId: 'menu-1', quantite: 0 },
        { menuId: 'menu-inconnu', quantite: 5 },
      ],
      new Map([['menu-1', [{ produitInclusId: 'crepe', quantite: 1 }]]]),
    );

    expect(total.size).toBe(0);
  });
});

describe('exploserVenteMenuEnLignesVente — CA par composant, prêt pour `totaliserVentes`', () => {
  it('le CA total explosé vaut exactement quantité × prix du menu, ventilé par nature', () => {
    const ventilation = ventilerMenu(700, [crepe(), sirop()]);
    const lignes = exploserVenteMenuEnLignesVente(
      { menuId: 'menu-mixte', quantite: 5, consommationSurPlace: false },
      ventilation,
    );

    const totaux = totaliserVentes(lignes);
    expect(totaux.caTotalCents).toBe(700 * 5);
    expect(totaux.caTransformeCents + totaux.caRevenduCents).toBe(700 * 5);
    expect(totaux.caTransformeCents).toBeGreaterThan(0);
    expect(totaux.caRevenduCents).toBeGreaterThan(0);
  });

  it('reporte le mode de consommation de la VENTE (le menu se vend en un bloc) sur chaque composant explosé', () => {
    const ventilation = ventilerMenu(500, [crepe(), cafe()]);
    const lignes = exploserVenteMenuEnLignesVente(
      { menuId: 'menu-1', quantite: 2, consommationSurPlace: true },
      ventilation,
    );

    expect(lignes.every((l) => l.consommationSurPlace)).toBe(true);
    const totaux = totaliserVentes(lignes);
    expect(totaux.caSurPlaceCents).toBe(totaux.caTotalCents);
  });

  it('cumule les crêpes vendues via le menu, y compris le composant à zéro crêpe (le café)', () => {
    const ventilation = ventilerMenu(500, [crepe(), cafe()]);
    const lignes = exploserVenteMenuEnLignesVente(
      { menuId: 'menu-1', quantite: 4, consommationSurPlace: false },
      ventilation,
    );

    const totaux = totaliserVentes(lignes);
    // 4 menus x 1 crêpe par menu (le café n'en ajoute aucune).
    expect(totaux.crepesVendues).toBe(4);
  });

  it('une quantité vendue nulle ou négative n’explose aucune ligne', () => {
    const ventilation = ventilerMenu(500, [crepe(), cafe()]);
    expect(
      exploserVenteMenuEnLignesVente(
        { menuId: 'm', quantite: 0, consommationSurPlace: false },
        ventilation,
      ),
    ).toEqual([]);
  });
});
