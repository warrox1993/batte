import { describe, expect, it } from 'vitest';
import type { LotDetail } from '@batte/core';
import { statutAfficheLot, statutLigne, valorisationLots } from './Stock';

/**
 * G6 (docs/14-TEST-PARCOURS-UTILISATEUR.md) : un lot administrativement
 * `disponible` mais dont la DLC est dépassée s'affichait « Disponible » —
 * le moteur (FEFO, `quantiteDisponible`) avait raison de l'exclure, c'était
 * l'ÉTIQUETTE qui mentait. `statutAfficheLot` est la fonction qui corrige
 * cette formulation, sans toucher au statut administratif en base.
 *
 * `jourReference` est un paramètre explicite : le test n'est donc jamais
 * dépendant de la date réelle du jour (piège de test rappelé pour ce lot de
 * travail — ne jamais asserter sur une valeur que l'horloge peut déplacer).
 */

const AUJOURDHUI = '2026-07-28';

describe('statutAfficheLot — distingue l’état administratif de la DLC', () => {
  it('un lot disponible sans DLC reste « Disponible »', () => {
    // Denrée non périssable : jamais périmée, quel que soit le jour de référence.
    expect(statutAfficheLot({ statut: 'disponible', dateDlc: null }, AUJOURDHUI)).toEqual({
      statut: 'conforme',
      libelle: 'Disponible',
    });
  });

  it('un lot disponible dont la DLC n’est pas encore atteinte reste « Disponible »', () => {
    expect(statutAfficheLot({ statut: 'disponible', dateDlc: '2026-08-15' }, AUJOURDHUI)).toEqual({
      statut: 'conforme',
      libelle: 'Disponible',
    });
  });

  it('un lot disponible le jour MÊME de sa DLC reste « Disponible »', () => {
    // Même règle que `estPerime` (@batte/core) : le jour de la DLC n'est pas
    // encore un dépassement.
    expect(statutAfficheLot({ statut: 'disponible', dateDlc: AUJOURDHUI }, AUJOURDHUI)).toEqual({
      statut: 'conforme',
      libelle: 'Disponible',
    });
  });

  it('un lot disponible mais périmé depuis 208 jours affiche « Périmé », pas « Disponible »', () => {
    // Le cas exact rapporté par le testeur (G6) : Vergeoise blonde,
    // DLC 2026-01-01, aujourd'hui 2026-07-28.
    expect(statutAfficheLot({ statut: 'disponible', dateDlc: '2026-01-01' }, AUJOURDHUI)).toEqual({
      statut: 'depassement',
      libelle: 'Périmé',
    });
  });

  it('un lot en quarantaine garde son libellé, même périmé', () => {
    // Quarantaine dit déjà « indisponible » : recroiser avec la DLC
    // n'ajouterait rien, et régresserait sur un libellé qui existait déjà.
    expect(statutAfficheLot({ statut: 'quarantaine', dateDlc: '2026-01-01' }, AUJOURDHUI)).toEqual({
      statut: 'alerte',
      libelle: 'Quarantaine',
    });
  });

  it('un lot bloqué garde son libellé, même périmé', () => {
    expect(statutAfficheLot({ statut: 'bloque', dateDlc: '2026-01-01' }, AUJOURDHUI)).toEqual({
      statut: 'depassement',
      libelle: 'Bloqué',
    });
  });

  it('un lot détruit garde son libellé, même périmé', () => {
    expect(statutAfficheLot({ statut: 'detruit', dateDlc: '2026-01-01' }, AUJOURDHUI)).toEqual({
      statut: 'depassement',
      libelle: 'Détruit',
    });
  });
});

/**
 * `statutLigne` — le « défaut adjacent » de G6 (docs/14-TEST-PARCOURS-
 * UTILISATEUR.md, mise à jour du 30/07/2026) : la colonne Statut d'un
 * INGRÉDIENT ne regardait que `quantiteDisponible` face à `stockSecurite`,
 * sans jamais consulter la DLC du lot le plus ancien. Un ingrédient avec un
 * lot périmé depuis 208 jours, mais une quantité totale confortable,
 * s'affichait donc « ● OK » — exactement le cas mesuré (Vergeoise blonde,
 * 10,3 t disponibles, DLC la plus proche dépassée depuis 208 jours).
 *
 * Même piège de test que `statutAfficheLot` ci-dessus : `jourReference` est
 * un paramètre explicite, jamais l'horloge réelle.
 */
describe('statutLigne — la péremption du lot le plus ancien l’emporte sur la quantité', () => {
  it('quantité au-dessus du seuil, aucune DLC : conforme', () => {
    expect(
      statutLigne(
        { dlcLaPlusProche: null, quantiteDisponible: 21_000, stockSecurite: 8000 },
        AUJOURDHUI,
      ),
    ).toBe('conforme');
  });

  it('quantité sous le seuil, aucune DLC : alerte (comportement de statutStock inchangé)', () => {
    expect(
      statutLigne(
        { dlcLaPlusProche: null, quantiteDisponible: 4200, stockSecurite: 8000 },
        AUJOURDHUI,
      ),
    ).toBe('alerte');
  });

  it('rupture totale : dépassement, DLC ou pas', () => {
    expect(
      statutLigne(
        { dlcLaPlusProche: null, quantiteDisponible: 0, stockSecurite: 8000 },
        AUJOURDHUI,
      ),
    ).toBe('depassement');
  });

  it('quantité confortable, DLC la plus proche pas encore atteinte : conforme', () => {
    expect(
      statutLigne(
        { dlcLaPlusProche: '2026-08-15', quantiteDisponible: 21_000, stockSecurite: 8000 },
        AUJOURDHUI,
      ),
    ).toBe('conforme');
  });

  it('quantité confortable, DLC atteinte le jour même : conforme (pas encore périmé)', () => {
    expect(
      statutLigne(
        { dlcLaPlusProche: AUJOURDHUI, quantiteDisponible: 21_000, stockSecurite: 8000 },
        AUJOURDHUI,
      ),
    ).toBe('conforme');
  });

  it('LE CAS G6 : quantité largement au-dessus du seuil, mais lot le plus ancien périmé depuis 208 jours → dépassement, jamais « OK »', () => {
    expect(
      statutLigne(
        {
          dlcLaPlusProche: '2026-01-01', // 208 jours avant AUJOURDHUI (2026-07-28)
          quantiteDisponible: 10_300_000,
          stockSecurite: 8000,
        },
        AUJOURDHUI,
      ),
    ).toBe('depassement');
  });

  it('quantité déjà sous le seuil (alerte) ET lot périmé : dépassement l’emporte, jamais réduit à une simple alerte', () => {
    expect(
      statutLigne(
        { dlcLaPlusProche: '2026-01-01', quantiteDisponible: 4200, stockSecurite: 8000 },
        AUJOURDHUI,
      ),
    ).toBe('depassement');
  });
});

function lotDetail(partiel: Partial<LotDetail> & { id: string }): LotDetail {
  return {
    numeroLotFournisseur: null,
    dateReception: '2026-01-15',
    dateDlc: null,
    quantiteRestante: 1000,
    quantiteInitiale: 1000,
    prixLigneCents: 300,
    prixUnitaireCents: 0.3,
    statut: 'disponible',
    receptionStatut: 'active',
    ...partiel,
  };
}

/**
 * `valorisationLots` — reproduit le cas réel (docs/27-PARCOURS-REJOUE.md
 * §3.b) : café moulu, 200 g reçus DLC déjà dépassée, 0 g disponible, mais
 * 3,00 € comptés quand même par l'ancien calcul serveur. La FORMULE
 * elle-même (`valoriserStock`/`valoriserStockPerime`) est testée en détail
 * dans `packages/core/src/stock.test.ts` ; ce fichier-ci prouve seulement que
 * cette fonction d'ÉCRAN délègue bien à ces deux fonctions, sur des lots au
 * format `LotDetail` (celui que `GET /stock/:id/lots` rend réellement).
 */
describe('valorisationLots — le panneau de détail affiche déjà la valeur corrigée', () => {
  it('reproduit le cas réel : café moulu, 200 g à DLC déjà dépassée, exclus du total exploitable', () => {
    const lots: readonly LotDetail[] = [
      lotDetail({
        id: 'cafe',
        numeroLotFournisseur: 'CAFE-2026-01',
        dateDlc: '2026-01-01', // dépassée au 2026-07-28 (AUJOURDHUI)
        quantiteRestante: 200,
        quantiteInitiale: 200,
        prixLigneCents: 300,
        prixUnitaireCents: 1.5,
      }),
    ];

    const valorisation = valorisationLots(lots, AUJOURDHUI);

    expect(valorisation.exploitableCents).toBe(0);
    expect(valorisation.perimeeCents).toBe(300); // les 3,00 € ne disparaissent pas
  });

  it('une valeur exploitable non nulle exclut le périmé mais garde le reste', () => {
    const lots: readonly LotDetail[] = [
      lotDetail({ id: 'bon', dateDlc: '2026-12-01', quantiteRestante: 500, prixUnitaireCents: 2 }),
      lotDetail({
        id: 'perime',
        dateDlc: '2026-01-01',
        quantiteRestante: 200,
        prixUnitaireCents: 1.5,
      }),
    ];

    const valorisation = valorisationLots(lots, AUJOURDHUI);

    expect(valorisation.exploitableCents).toBe(1000); // 500 x 2
    expect(valorisation.perimeeCents).toBe(300); // 200 x 1,5
  });

  it('sans aucun lot périmé, la valeur périmée est nulle', () => {
    const lots: readonly LotDetail[] = [
      lotDetail({ id: 'a', dateDlc: '2026-12-01', quantiteRestante: 100, prixUnitaireCents: 4 }),
    ];
    expect(valorisationLots(lots, AUJOURDHUI).perimeeCents).toBe(0);
  });
});
