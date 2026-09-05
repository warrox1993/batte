/**
 * Tests du diagnostic d'integrite du stock (`diagnostiquerIntegriteStock`).
 *
 * Contexte (dette du 29/07/2026, `audit-silences.test.ts`) : `verifierInvariantLots`
 * existait et n'etait appelee par aucun chemin de production. Ce fichier teste
 * l'enveloppe `diagnostiquerIntegriteStock` qui porte desormais le verdict
 * complet (`coherent`, `nbLotsVerifies`), consommee par la route de diagnostic
 * `GET /api/stock/integrite`.
 *
 * `verifierInvariantLots` elle-meme reste testee ailleurs (`services/stock.test.ts`,
 * `parcours-erp.test.ts`, `seed/demonstration.test.ts`) : pas de duplication ici.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { fournisseur, ingredient, lot, mouvementStock } from '../schema.js';
import { annulerReception, enregistrerReception } from '../services/reception.js';
import { changerStatutLot } from '../services/mouvements.js';
import { diagnostiquerIntegriteStock, lotsDeLIngredient } from './stock.js';

describe('diagnostiquerIntegriteStock', () => {
  let base: BaseBatte;
  let idFarine: string;
  let idFournisseur: string;

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
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
  });

  it('annonce un stock coherent et compte TOUS les lots quand rien ne cloche', () => {
    // `seedDemonstration` seme le referentiel (fournisseurs, ingredients),
    // pas de mouvement de stock : une reception normale, via le SERVICE, est
    // necessaire pour qu'au moins un lot existe — sinon « 0 lot verifie »
    // serait coherent par vacuite et ne prouverait rien.
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-20',
      numeroBonLivraison: null,
      commandeId: null,
      notes: null,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 100,
          numeroLotFournisseur: 'LOT-INTEGRITE-0',
          dateDlc: null,
        },
      ],
    });

    const resultat = diagnostiquerIntegriteStock(base);

    expect(resultat.coherent).toBe(true);
    expect(resultat.lotsFautifs).toEqual([]);

    // `nbLotsVerifies` doit correspondre au compte reel des lots en base, pas
    // a une valeur arbitraire : c'est le chiffre qui donne du poids au
    // verdict « rien a signaler ».
    const totalLots = base.select({ id: lot.id }).from(lot).all().length;
    expect(resultat.nbLotsVerifies).toBe(totalLots);
    expect(resultat.nbLotsVerifies).toBeGreaterThan(0);
  });

  it('detecte un lot dont les sorties depassent sa quantite initiale', () => {
    const recu = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-20',
      numeroBonLivraison: null,
      commandeId: null,
      notes: null,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 100,
          numeroLotFournisseur: 'LOT-INTEGRITE-1',
          dateDlc: null,
        },
      ],
    });
    const lotId = recu.lotsCrees[0]!.lotId;
    const avant = diagnostiquerIntegriteStock(base);

    // Ecriture DIRECTE en base, hors service : simule exactement le genre de
    // regression du grand livre que ce diagnostic existe pour attraper — une
    // sortie de 1500 g sur un lot recu a 1000 g. `enregistrerSortie` refuse ce
    // cas normalement ; ce test verifie que le CONTROLE le detecterait quand
    // meme si un autre chemin d'ecriture venait a le laisser passer.
    base
      .insert(mouvementStock)
      .values({
        id: nouvelIdentifiant(),
        lotId,
        ingredientId: idFarine,
        type: 'perte',
        quantite: 1500,
        dateMouvement: '2026-07-21',
        valuationDate: '2026-07-21',
        coutCents: 0,
        creeLe: maintenantUtc(),
      })
      .run();

    const resultat = diagnostiquerIntegriteStock(base);

    expect(resultat.coherent).toBe(false);
    expect(resultat.nbLotsVerifies).toBe(avant.nbLotsVerifies);
    expect(resultat.lotsFautifs).toContainEqual({
      lotId,
      quantiteInitiale: 1000,
      restant: -500,
    });
  });

  it('detecte un lot credite au-dela de sa quantite initiale (entree comptee deux fois)', () => {
    const recu = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-20',
      numeroBonLivraison: null,
      commandeId: null,
      notes: null,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 100,
          numeroLotFournisseur: 'LOT-INTEGRITE-2',
          dateDlc: null,
        },
      ],
    });
    const lotId = recu.lotsCrees[0]!.lotId;

    // Une SECONDE entree sur le meme lot, ce que le service ne fait jamais :
    // le restant (2000) depasse alors la quantite initiale (1000).
    base
      .insert(mouvementStock)
      .values({
        id: nouvelIdentifiant(),
        lotId,
        ingredientId: idFarine,
        type: 'entree',
        quantite: 1000,
        dateMouvement: '2026-07-20',
        valuationDate: '2026-07-20',
        coutCents: 0,
        creeLe: maintenantUtc(),
      })
      .run();

    const resultat = diagnostiquerIntegriteStock(base);

    expect(resultat.coherent).toBe(false);
    expect(resultat.lotsFautifs).toContainEqual({
      lotId,
      quantiteInitiale: 1000,
      restant: 2000,
    });
  });
});

/**
 * `lotsDeLIngredient` expose desormais `receptionStatut` (colonne
 * `reception.statut` ajoutee le 30/07/2026, ecrite par `annulerReception`,
 * `services/reception.ts`) : c'est ce qui permet a l'ecran Stock de
 * distinguer un lot simplement epuise par la vente d'un lot dont la
 * reception d'origine a ete ANNULEE — la seule quantite restante (0 dans les
 * deux cas) ne le dit pas.
 */
describe('lotsDeLIngredient — receptionStatut, colonne activee le 30/07/2026', () => {
  let base: BaseBatte;
  let idFarine: string;
  let idFournisseur: string;

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
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
  });

  it("vaut 'active' sur un lot dont la reception n'a jamais ete annulee", () => {
    const recu = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-20',
      numeroBonLivraison: null,
      commandeId: null,
      notes: null,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 100,
          numeroLotFournisseur: 'LOT-STATUT-RECEPTION-1',
          dateDlc: null,
        },
      ],
    });

    const lotLu = lotsDeLIngredient(base, idFarine).find((l) => l.id === recu.lotsCrees[0]!.lotId)!;
    expect(lotLu.receptionStatut).toBe('active');
  });

  it(
    "bascule a 'annulee' des que la reception d'origine est annulee, SANS toucher au " +
      'statut PROPRE du lot (colonne independante)',
    () => {
      const recu = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2026-07-20',
        numeroBonLivraison: null,
        commandeId: null,
        notes: null,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 100,
            numeroLotFournisseur: 'LOT-STATUT-RECEPTION-2',
            dateDlc: null,
          },
        ],
      });
      const lotId = recu.lotsCrees[0]!.lotId;

      annulerReception(base, recu.receptionId, 'ERREUR_SAISIE');

      const lotLu = lotsDeLIngredient(base, idFarine).find((l) => l.id === lotId)!;
      expect(lotLu.receptionStatut).toBe('annulee');
      // La contrepassation a ramene la quantite restante a zero, mais le
      // statut DU LOT (disponible/quarantaine/...) reste une colonne a part :
      // `annulerReception` ne le modifie jamais.
      expect(lotLu.statut).toBe('disponible');
      expect(lotLu.quantiteRestante).toBe(0);
    },
  );
});

/**
 * `lotsDeLIngredient` expose désormais `motifStatutLibelle` et
 * `dateChangementStatut` (`lot.motif_statut_id`, `lot.date_changement_statut`,
 * écrites à CHAQUE changement de statut par `changerStatutLot`,
 * `services/mouvements.ts`) — audit du 30/07/2026
 * (`audit-colonnes-orphelines.test.ts`) : la trace exacte qu'un contrôle
 * AFSCA vient chercher, « pourquoi ce lot a-t-il été bloqué, et quand »,
 * écrite depuis le début mais jamais relue nulle part.
 */
describe('lotsDeLIngredient — motifStatutLibelle et dateChangementStatut, colonnes activées le 30/07/2026', () => {
  let base: BaseBatte;
  let idFarine: string;
  let idFournisseur: string;

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
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
  });

  it("valent `null` sur un lot qui n'a jamais changé de statut depuis sa réception", () => {
    const recu = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-20',
      numeroBonLivraison: null,
      commandeId: null,
      notes: null,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 100,
          numeroLotFournisseur: 'LOT-MOTIF-STATUT-JAMAIS-CHANGE',
          dateDlc: null,
        },
      ],
    });

    const lotLu = lotsDeLIngredient(base, idFarine).find((l) => l.id === recu.lotsCrees[0]!.lotId)!;
    expect(lotLu.motifStatutLibelle).toBeNull();
    expect(lotLu.dateChangementStatut).toBeNull();
  });

  it('portent le libellé du motif et la date du DERNIER changement de statut', () => {
    const recu = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-20',
      numeroBonLivraison: null,
      commandeId: null,
      notes: null,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 100,
          numeroLotFournisseur: 'LOT-MOTIF-STATUT-BLOQUE',
          dateDlc: null,
        },
      ],
    });
    const lotId = recu.lotsCrees[0]!.lotId;

    changerStatutLot(base, lotId, 'bloque', 'RAPPEL_FOURNISSEUR', '2026-07-21');

    const lotLu = lotsDeLIngredient(base, idFarine).find((l) => l.id === lotId)!;
    expect(lotLu.statut).toBe('bloque');
    expect(lotLu.motifStatutLibelle).toBe('Bloqué suite à un rappel fournisseur');
    expect(lotLu.dateChangementStatut).not.toBeNull();
  });
});
