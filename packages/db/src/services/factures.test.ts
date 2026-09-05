/**
 * Tests d'integration du rapprochement facture fournisseur (fiche 14,
 * docs/17-VINGT-AMELIORATIONS.md § 14).
 *
 * Deux tests de regression PORTENT le critere de fin explicitement demande :
 * « prouve qu'une facture conforme au bon de livraison ne change rien, et
 * qu'une facture divergente produit un ecart visible » — voir
 * « facture conforme au bon de livraison » et « facture divergente » plus bas.
 *
 * Un troisieme test, « le cout deja consomme reste fige », porte l'arbitrage
 * de rétroactivité du rapport de livraison : une correction de prix ne doit
 * JAMAIS modifier silencieusement une marge déjà constatée.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurMetier } from '@batte/core';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { conditionnement, fournisseur, ingredient } from '../schema.js';
import { creerFournisseur } from '../depots/referentiel.js';
import { FOURNISSEUR_INVENTAIRE_OUVERTURE } from '../seed/fournisseurs-systeme.js';
import { annulerReception, enregistrerReception } from './reception.js';
import { enregistrerSortie } from './mouvements.js';
import { lotsDeLIngredient, mouvementsDuLot } from '../depots/stock.js';
import {
  annulerFacture,
  changerStatutFacture,
  corrigerCoutLot,
  enregistrerFacture,
  lireFactureDetail,
  listerFactures,
  receptionsEligibles,
} from './factures.js';

const JOUR = '2026-07-27';

describe('Fiche 14 — rapprochement facture fournisseur', () => {
  let base: BaseBatte;
  let idFarine: string;
  let idMeunier: string;
  let idAutreFournisseur: string;

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
    idMeunier = base
      .select({ id: conditionnement.fournisseurId })
      .from(conditionnement)
      .where(eq(conditionnement.ingredientId, idFarine))
      .get()!.id;

    idAutreFournisseur = creerFournisseur(base, {
      nom: 'Un autre fournisseur',
      type: 'grossiste',
      email: null,
      telephone: null,
      adresse: null,
      delaiLivraisonJours: 5,
      francoDePortCents: null,
      commandeMinimumCents: null,
      notes: null,
    });
  });

  /** Une reception d'une seule ligne de farine, au prix du bon de livraison. */
  function receptionnerFarine(prixLigneCents: number, quantite = 1000) {
    const resultat = enregistrerReception(base, {
      fournisseurId: idMeunier,
      dateReception: JOUR,
      lignes: [
        {
          ingredientId: idFarine,
          quantite,
          prixLigneCents,
          numeroLotFournisseur: 'LOT-BL-001',
        },
      ],
    });
    return { receptionId: resultat.receptionId, lotId: resultat.lotsCrees[0]!.lotId };
  }

  describe('critère de fin — facture conforme vs facture divergente', () => {
    it('une facture CONFORME au bon de livraison ne change rien : écart nul', () => {
      const { receptionId } = receptionnerFarine(1000);

      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-001',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [
          {
            libelle: 'Farine T55',
            montantCents: 1000, // exactement le bon de livraison
            receptionId,
            ingredientId: idFarine,
          },
        ],
      });

      expect(resultat.ecarts).toEqual([]);

      const detail = lireFactureDetail(base, resultat.factureId)!;
      const ligne = detail.lignes[0]!;
      expect(ligne.ecartPrixCents).toBe(0);
      expect(ligne.lotResolu).toBe(true);
      expect(ligne.ecartResiduelCents).toBe(0);

      // Le prix du lot n'a PAS bougé : une facture conforme n'écrit rien sur le lot.
      const lots = receptionsEligibles(base, idMeunier);
      expect(lots.find((l) => l.receptionId === receptionId)!.prixLigneCents).toBe(1000);
    });

    it('une facture DIVERGENTE produit un écart VISIBLE, sans corriger le lot automatiquement', () => {
      const { receptionId } = receptionnerFarine(1000);

      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-002',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [
          {
            libelle: 'Farine T55',
            montantCents: 1150, // le meunier a augmenté son prix de 150 centimes
            receptionId,
            ingredientId: idFarine,
          },
        ],
      });

      expect(resultat.ecarts).toEqual([{ libelle: 'Farine T55', ecartPrixCents: 150 }]);

      const detail = lireFactureDetail(base, resultat.factureId)!;
      const ligne = detail.lignes[0]!;
      expect(ligne.ecartPrixCents).toBe(150);
      expect(ligne.ecartResiduelCents).toBe(150);
      expect(detail.ecartTotalCents).toBe(150);

      // L'écart est calculé et VISIBLE, mais le lot n'a PAS encore été corrigé :
      // enregistrer une facture ne corrige jamais un prix en silence.
      const lots = receptionsEligibles(base, idMeunier);
      expect(lots.find((l) => l.receptionId === receptionId)!.prixLigneCents).toBe(1000);
    });

    it("une réception ANNULÉE n'est plus proposée au rapprochement d'une facture", () => {
      // Défaut trouvé le 30/07/2026 en câblant `reception.statut` : cette
      // fonction ne filtrait pas le statut. Une réception annulée — donc dont la
      // marchandise a été intégralement contrepassée et n'est jamais restée en
      // stock — restait offerte au rapprochement. On aurait rapproché une
      // facture d'une livraison qu'on a explicitement déclarée n'avoir jamais
      // gardée, et le montant rapproché n'aurait correspondu à aucun stock.
      const active = receptionnerFarine(1000);
      const aAnnuler = receptionnerFarine(2000);

      expect(receptionsEligibles(base, idMeunier).map((l) => l.receptionId)).toContain(
        aAnnuler.receptionId,
      );

      annulerReception(base, aAnnuler.receptionId, 'ERREUR_SAISIE');

      const restants = receptionsEligibles(base, idMeunier).map((l) => l.receptionId);
      expect(restants).not.toContain(aAnnuler.receptionId);
      // L'autre réception du MÊME fournisseur reste proposée : le filtre porte
      // sur le statut, pas sur le fournisseur.
      expect(restants).toContain(active.receptionId);
    });
  });

  describe('corrigerCoutLot — correction explicite, jamais de mouvement fantôme', () => {
    it("applique l'écart au lot, SANS créer de mouvement de stock", () => {
      const { receptionId, lotId } = receptionnerFarine(1000);
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-003',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [
          { libelle: 'Farine T55', montantCents: 1150, receptionId, ingredientId: idFarine },
        ],
      });
      const ligneId = lireFactureDetail(base, resultat.factureId)!.lignes[0]!.id;

      const nbMouvementsAvant = mouvementsDuLot(base, lotId).length;

      const correction = corrigerCoutLot(base, ligneId);

      expect(correction).toEqual({ lotId, prixAvantCents: 1000, prixApresCents: 1150 });
      // Toujours le MÊME nombre de mouvements : une correction de prix ne
      // crée jamais de mouvement fantôme (CLAUDE.md §3 règle 5 ne porte que
      // sur la quantité).
      expect(mouvementsDuLot(base, lotId).length).toBe(nbMouvementsAvant);

      const lots = receptionsEligibles(base, idMeunier);
      expect(lots.find((l) => l.receptionId === receptionId)!.prixLigneCents).toBe(1150);

      // L'écart résiduel retombe à zéro : la correction a été absorbée.
      const detailApres = lireFactureDetail(base, resultat.factureId)!;
      expect(detailApres.lignes[0]!.ecartResiduelCents).toBe(0);
    });

    it('refuse une seconde application : le prix est déjà à jour', () => {
      const { receptionId } = receptionnerFarine(1000);
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-004',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [
          { libelle: 'Farine T55', montantCents: 1150, receptionId, ingredientId: idFarine },
        ],
      });
      const ligneId = lireFactureDetail(base, resultat.factureId)!.lignes[0]!.id;

      corrigerCoutLot(base, ligneId);
      expect(() => corrigerCoutLot(base, ligneId)).toThrow(ErreurMetier);
      try {
        corrigerCoutLot(base, ligneId);
      } catch (erreur) {
        expect((erreur as ErreurMetier).code).toBe('deja_a_jour');
      }
    });

    it("refuse de corriger une ligne qui n'est rattachée à aucune réception", () => {
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-005',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Frais de dossier', montantCents: 500 }],
      });
      const ligneId = lireFactureDetail(base, resultat.factureId)!.lignes[0]!.id;

      expect(() => corrigerCoutLot(base, ligneId)).toThrow(ErreurMetier);
    });

    it(
      'LE COÛT DÉJÀ CONSOMMÉ RESTE FIGÉ : une correction de prix ne modifie jamais ' +
        "rétroactivement le coût d'un mouvement déjà écrit, seule la valorisation FUTURE du " +
        'restant du lot change',
      () => {
        const { receptionId, lotId } = receptionnerFarine(1000, 1000); // 1000 g à 1000 centimes -> 1 ct/g

        // On consomme la MOITIÉ du lot avant que la facture n'arrive : ce coût
        // est celui d'une production déjà lancée, peut-être déjà clôturée.
        enregistrerSortie(base, {
          ingredientId: idFarine,
          quantite: 400,
          type: 'sortie_production',
          motifCode: 'SURDOSAGE',
          dateMouvement: JOUR,
        });
        const mouvementAvant = mouvementsDuLot(base, lotId).find(
          (m) => m.type === 'sortie_production',
        )!;
        expect(mouvementAvant.coutCents).toBe(400); // 400 g × 1 ct/g, au prix du BON DE LIVRAISON

        // La facture arrive, plus chère : 1000 -> 1500 (1,5 ct/g).
        const resultat = enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-006',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          lignes: [
            { libelle: 'Farine T55', montantCents: 1500, receptionId, ingredientId: idFarine },
          ],
        });
        const ligneId = lireFactureDetail(base, resultat.factureId)!.lignes[0]!.id;
        corrigerCoutLot(base, ligneId);

        // LE MOUVEMENT DÉJÀ ÉCRIT NE BOUGE PAS : la marge d'une production ou
        // d'une session déjà close ne doit jamais changer en silence des mois
        // plus tard (piège de rétroactivité, rapport de la fiche 14).
        const mouvementApres = mouvementsDuLot(base, lotId).find(
          (m) => m.type === 'sortie_production',
        )!;
        expect(mouvementApres.coutCents).toBe(400);
        expect(mouvementApres.id).toBe(mouvementAvant.id);

        // En revanche, le RESTANT du lot (600 g) est désormais valorisé au
        // NOUVEAU prix : c'est la seule chose que la correction devait changer.
        const lotRestant = lotsDeLIngredient(base, idFarine).find((l) => l.id === lotId)!;
        expect(lotRestant.quantiteRestante).toBe(600);
        expect(lotRestant.prixUnitaireCents).toBeCloseTo(1.5, 5);
      },
    );
  });

  describe('frais de réception — ventilation automatique et exacte', () => {
    it('ventile un frais de transport proportionnellement à la valeur des lots, sans perdre un centime', () => {
      const idSel = base
        .select({ id: ingredient.id })
        .from(ingredient)
        .where(eq(ingredient.nom, 'Sel'))
        .get()?.id;
      // Si "Sel" n'existe pas dans ce jeu de données, on utilise un second lot de
      // farine sur la même réception pour garder le test indépendant du seed.
      const resultatReception = enregistrerReception(base, {
        fournisseurId: idMeunier,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 3000,
            prixLigneCents: 3000,
            numeroLotFournisseur: 'A',
          },
          ...(idSel !== undefined
            ? [
                {
                  ingredientId: idSel,
                  quantite: 500,
                  prixLigneCents: 1000,
                  numeroLotFournisseur: 'B',
                },
              ]
            : []),
        ],
      });
      const receptionId = resultatReception.receptionId;

      enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-007',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [
          {
            libelle: 'Frais de transport',
            montantCents: 100,
            receptionId,
            // ingredientId absent : c'est un frais, pas une ligne de matière.
          },
        ],
      });

      const lots = receptionsEligibles(base, idMeunier).filter(
        (l) => l.receptionId === receptionId,
      );
      const sommeApres = lots.reduce((s, l) => s + l.prixLigneCents, 0);
      const sommeAvant = resultatReception.montantTotalCents;
      // Le montant du frais est intégralement retrouvé, au centime près.
      expect(sommeApres - sommeAvant).toBe(100);
    });

    it('refuse un frais de réception nul ou négatif', () => {
      const { receptionId } = receptionnerFarine(1000);
      expect(() =>
        enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-008',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          lignes: [{ libelle: 'Avoir transport', montantCents: -50, receptionId }],
        }),
      ).toThrow(ErreurMetier);
    });
  });

  describe('validation du rapprochement', () => {
    it("refuse une ligne rattachée à une réception d'un AUTRE fournisseur", () => {
      const { receptionId } = receptionnerFarine(1000);

      expect(() =>
        enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-009',
          fournisseurId: idAutreFournisseur,
          dateFacture: JOUR,
          lignes: [
            { libelle: 'Farine T55', montantCents: 1000, receptionId, ingredientId: idFarine },
          ],
        }),
      ).toThrow(ErreurMetier);
    });

    it('refuse une facture sans ligne', () => {
      expect(() =>
        enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-010',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          lignes: [],
        }),
      ).toThrow(ErreurMetier);
    });

    it('refuse une ligne à montant nul', () => {
      expect(() =>
        enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-011',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          lignes: [{ libelle: 'Ligne vide', montantCents: 0 }],
        }),
      ).toThrow(ErreurMetier);
    });

    it('accepte un montant NÉGATIF sur une ligne non liée à un frais (remise de fin de trimestre)', () => {
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-012',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Remise fin de trimestre', montantCents: -2000 }],
      });
      expect(resultat.montantTotalCents).toBe(-2000);
    });
  });

  /**
   * DÉFAUT TROUVÉ EN AUDIT (31/07/2026, garde-fous fournisseur système).
   *
   * Trois autres points d'écriture qui reçoivent un `fournisseurId` choisi
   * par l'utilisateur vérifient déjà explicitement son type et lèvent
   * `ErreurMetier('fournisseur_systeme', …)` :
   * `verifierFournisseurModifiable` (`depots/referentiel.ts`),
   * `verifierFournisseurCommercial` (`depots/economies.ts` et
   * `depots/referentiel-ecriture.ts`). `enregistrerFacture` ne vérifiait que
   * l'EXISTENCE du fournisseur — jamais son type — donc une facture au nom
   * du fournisseur système (« Inventaire d'ouverture ») était acceptée sans
   * broncher, alors que ce fournisseur n'est pas une contrepartie
   * commerciale (`seed/fournisseurs-systeme.ts`) : aucun fournisseur réel ne
   * lui envoie de facture.
   *
   * À NE PAS CONFONDRE avec la réception (`services/reception.ts`) :
   * recevoir de la marchandise CONTRE ce fournisseur reste sa raison d'être,
   * et n'est PAS concerné par cette garde — voir le second test ci-dessous,
   * qui prouve que la réception continue de fonctionner sans changement.
   */
  describe('le fournisseur système ne reçoit jamais de facture', () => {
    let idFournisseurSysteme: string;

    beforeEach(() => {
      idFournisseurSysteme = base
        .select({ id: fournisseur.id })
        .from(fournisseur)
        .where(eq(fournisseur.nom, FOURNISSEUR_INVENTAIRE_OUVERTURE))
        .get()!.id;
    });

    it('refuse `enregistrerFacture` au nom du fournisseur système, avec un code dédié', () => {
      expect(() =>
        enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-SYS-001',
          fournisseurId: idFournisseurSysteme,
          dateFacture: JOUR,
          lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
        }),
      ).toThrow(ErreurMetier);

      try {
        enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-SYS-001',
          fournisseurId: idFournisseurSysteme,
          dateFacture: JOUR,
          lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
        });
        expect.unreachable('devrait avoir levé une ErreurMetier');
      } catch (erreur) {
        const metier = erreur as ErreurMetier;
        expect(metier.code).toBe('fournisseur_systeme');
        expect(metier.statut).toBe(422);
      }

      // RIEN N'EST ÉCRIT : ni la facture refusée, ni aucune ligne partielle.
      expect(listerFactures(base)).toHaveLength(0);
    });

    it('un fournisseur COMMERCIAL reste acceptable normalement — la garde ne ferme que le système', () => {
      expect(() =>
        enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-SYS-002',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
        }),
      ).not.toThrow();
    });

    it(
      "NE CASSE PAS l'inventaire d'ouverture : la RÉCEPTION contre le fournisseur système " +
        'reste possible, exactement comme avant ce correctif — seule la FACTURE est refusée',
      () => {
        const resultat = enregistrerReception(base, {
          fournisseurId: idFournisseurSysteme,
          dateReception: JOUR,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 2000,
              prixLigneCents: 1800,
              numeroLotFournisseur: 'INVENTAIRE-INITIAL-001',
            },
          ],
        });

        expect(resultat.lotsCrees).toHaveLength(1);
        const lots = lotsDeLIngredient(base, idFarine);
        expect(lots.some((l) => l.id === resultat.lotsCrees[0]!.lotId)).toBe(true);
      },
    );
  });

  /**
   * Mission « deux restes de la chaîne d'achat » (31/07/2026) — le doute
   * laissé ouvert par le balayage des trois tables à statut : au rattachement
   * d'une ligne de facture à une réception, l'existence de la réception
   * était vérifiée SANS filtrer son statut. Tranché : ACCEPTÉ, jamais refusé
   * (CLAUDE.md §7 — un rapprochement légitime ne se bloque pas), mais un
   * avertissement NON BLOQUANT le dit, à la saisie ET à chaque lecture (voir
   * la décision de conception au-dessus de `avertissementReceptionAnnulee`,
   * `services/factures.ts`).
   */
  describe('rattachement à une réception ANNULÉE — accepté, jamais refusé, mais averti', () => {
    it("n'est PAS bloqué : le rapprochement d'une facture à une réception annulée réussit", () => {
      const { receptionId } = receptionnerFarine(1000);
      annulerReception(base, receptionId, 'ERREUR_SAISIE');

      // Le fournisseur a livré, la réception a été annulée en base (erreur
      // de saisie) mais il a quand même facturé : refuser rendrait cette
      // facture ORPHELINE, ce qui est un problème comptable réel — pas
      // seulement une élégance de modèle qu'on protège.
      expect(() =>
        enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-020',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          lignes: [
            { libelle: 'Farine T55', montantCents: 1000, receptionId, ingredientId: idFarine },
          ],
        }),
      ).not.toThrow();
    });

    it('AVERTIT dès la saisie, en nommant la réception, quand la ligne vise une réception annulée', () => {
      const resultatReception = enregistrerReception(base, {
        fournisseurId: idMeunier,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 1000,
            numeroLotFournisseur: 'LOT-BL-ANN-001',
          },
        ],
      });
      annulerReception(base, resultatReception.receptionId, 'ERREUR_SAISIE');

      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-021',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [
          {
            libelle: 'Farine T55',
            montantCents: 1000,
            receptionId: resultatReception.receptionId,
            ingredientId: idFarine,
          },
        ],
      });

      expect(resultat.avertissements).toHaveLength(1);
      expect(resultat.avertissements[0]).toContain(resultatReception.numero);
    });

    it(
      'NE SE DÉCLENCHE PAS sur une réception ACTIVE : le SILENCE est prouvé, pas seulement ' +
        'supposé — sinon l’avertissement crierait toujours',
      () => {
        const { receptionId } = receptionnerFarine(1000);

        const resultat = enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-022',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          lignes: [
            { libelle: 'Farine T55', montantCents: 1000, receptionId, ingredientId: idFarine },
          ],
        });

        expect(resultat.avertissements).toEqual([]);

        const detail = lireFactureDetail(base, resultat.factureId)!;
        expect(detail.avertissements).toEqual([]);
        expect(detail.lignes[0]!.receptionAnnulee).toBe(false);
      },
    );

    it(
      'un FRAIS DE RÉCEPTION (pas seulement une ligne rapprochée à un lot) rattaché à une ' +
        "réception annulée n'est pas bloqué non plus, et AVERTIT de la même façon",
      () => {
        const { receptionId } = receptionnerFarine(1000);
        annulerReception(base, receptionId, 'ERREUR_SAISIE');

        const resultat = enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-023',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          lignes: [{ libelle: 'Frais de transport', montantCents: 100, receptionId }],
        });

        expect(resultat.avertissements).toHaveLength(1);
      },
    );

    it(
      'recalcule le MÊME avertissement À LA LECTURE quand la réception est annulée APRÈS le ' +
        "rapprochement — l'avertissement ne doit pas rester figé à l'état constaté à la saisie",
      () => {
        const { receptionId } = receptionnerFarine(1000);

        const resultat = enregistrerFacture(base, {
          numeroFournisseur: 'FA-2026-024',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          lignes: [
            { libelle: 'Farine T55', montantCents: 1000, receptionId, ingredientId: idFarine },
          ],
        });

        // Au moment du rapprochement, la réception était encore active :
        // aucun avertissement, ni à la saisie ni à la lecture immédiate.
        expect(resultat.avertissements).toEqual([]);
        expect(lireFactureDetail(base, resultat.factureId)!.avertissements).toEqual([]);

        annulerReception(base, receptionId, 'ERREUR_SAISIE');

        // La MÊME lecture, refaite après l'annulation, fait apparaître
        // l'avertissement : rien n'est figé à l'instant de la saisie.
        const detailApres = lireFactureDetail(base, resultat.factureId)!;
        expect(detailApres.lignes[0]!.receptionAnnulee).toBe(true);
        expect(detailApres.avertissements).toHaveLength(1);
      },
    );
  });

  describe('lecture', () => {
    it('liste les factures et calcule l’écart total par facture', () => {
      const { receptionId } = receptionnerFarine(1000);
      enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-013',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [
          { libelle: 'Farine T55', montantCents: 1200, receptionId, ingredientId: idFarine },
        ],
      });

      const liste = listerFactures(base);
      expect(liste).toHaveLength(1);
      expect(liste[0]!.ecartTotalCents).toBe(200);
      expect(liste[0]!.fournisseurNom).not.toBe('');
      expect(liste[0]!.estAnnulation).toBe(false);
      expect(liste[0]!.estAnnulee).toBe(false);
    });

    it('rend null pour une facture inexistante', () => {
      expect(lireFactureDetail(base, 'introuvable')).toBeNull();
    });
  });

  describe('cycle de vie du statut', () => {
    it('a_rapprocher -> rapprochee -> payee', () => {
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-014',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      });
      expect(lireFactureDetail(base, resultat.factureId)!.statut).toBe('a_rapprocher');

      changerStatutFacture(base, resultat.factureId, 'rapprochee');
      expect(lireFactureDetail(base, resultat.factureId)!.statut).toBe('rapprochee');

      changerStatutFacture(base, resultat.factureId, 'payee');
      expect(lireFactureDetail(base, resultat.factureId)!.statut).toBe('payee');
    });

    it('refuse de changer vers le même statut', () => {
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-015',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      });
      expect(() => changerStatutFacture(base, resultat.factureId, 'a_rapprocher')).toThrow(
        ErreurMetier,
      );
    });
  });

  describe('annulerFacture — contre-écriture, jamais de suppression', () => {
    it('annule par contre-écriture : la facture originale reste lisible, intacte', () => {
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-016',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      });

      const nbAvant = listerFactures(base).length;
      const contrepassation = annulerFacture(base, resultat.factureId, 'Montant mal saisi');
      const nbApres = listerFactures(base).length;

      // RIEN NE S'EFFACE : le nombre de factures AUGMENTE, il ne diminue jamais.
      expect(nbApres).toBe(nbAvant + 1);

      // La facture ORIGINALE est toujours lisible, à l'identique.
      const origineApres = lireFactureDetail(base, resultat.factureId)!;
      expect(origineApres.montantTotalCents).toBe(500);
      expect(origineApres.estAnnulee).toBe(true);

      // La contre-écriture porte le montant INVERSE.
      const contreEcriture = lireFactureDetail(base, contrepassation.id)!;
      expect(contreEcriture.montantTotalCents).toBe(-500);
      expect(contreEcriture.estAnnulation).toBe(true);
      expect(contreEcriture.factureAnnuleeId).toBe(resultat.factureId);
    });

    it('refuse une seconde annulation de la même facture', () => {
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-017',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      });
      annulerFacture(base, resultat.factureId, 'Erreur de saisie');
      expect(() => annulerFacture(base, resultat.factureId, 'Nouvelle tentative')).toThrow(
        ErreurMetier,
      );
    });

    it('exige un motif non vide', () => {
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-2026-018',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      });
      expect(() => annulerFacture(base, resultat.factureId, '   ')).toThrow(ErreurMetier);
    });
  });

  /**
   * Mission « trois chemins de pièce jointe jamais utilisés » (30/07/2026).
   * `fichier_scan_path` (colonne TEXTE) est écrite en Data URI plutôt qu'en
   * chemin disque — voir la décision de conception documentée en tête de
   * `services/factures.ts` : `packages/db/src/sauvegarde.ts` sauvegarde la
   * base entière par `VACUUM INTO`, jamais un dossier annexe, donc seule une
   * pièce vivant DANS la ligne est protégée par la sauvegarde quotidienne.
   */
  describe('pièce jointe (bon de livraison / facture scannée)', () => {
    /** PNG 1×1 minuscule, valide, largement sous le plafond de taille. */
    const PIECE_VALIDE =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    it('conserve une pièce jointe valide, relisible au détail', () => {
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-PJ-001',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        fichierScanPath: PIECE_VALIDE,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      });

      expect(lireFactureDetail(base, resultat.factureId)!.fichierScanPath).toBe(PIECE_VALIDE);
    });

    it("n'écrit rien (reste `null`) quand aucune pièce n'est fournie — comportement inchangé", () => {
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-PJ-002',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      });
      expect(lireFactureDetail(base, resultat.factureId)!.fichierScanPath).toBeNull();
    });

    it('traite une chaîne vide comme `null`, jamais comme un chemin (CLAUDE.md §7)', () => {
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-PJ-003',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        fichierScanPath: '   ',
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      });
      expect(lireFactureDetail(base, resultat.factureId)!.fichierScanPath).toBeNull();
    });

    it("refuse un chemin disque : ce n'est pas une Data URI reconnue", () => {
      // Exactement la voie REJETÉE par la décision de conception : un vrai
      // chemin resterait hors de la sauvegarde automatique.
      expect(() =>
        enregistrerFacture(base, {
          numeroFournisseur: 'FA-PJ-004',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          fichierScanPath: 'C:\\Users\\porteur\\Documents\\facture-scannee.pdf',
          lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
        }),
      ).toThrow(ErreurMetier);
    });

    it('refuse un type MIME non reconnu (format Data URI correct par ailleurs)', () => {
      expect(() =>
        enregistrerFacture(base, {
          numeroFournisseur: 'FA-PJ-005',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          fichierScanPath: 'data:text/plain;base64,QmF0dGU=',
          lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
        }),
      ).toThrow(ErreurMetier);
    });

    it('refuse une pièce jointe trop volumineuse (plafond 8 Mo)', () => {
      const enorme = 'A'.repeat(12 * 1024 * 1024); // ~9 Mo décodés, au-delà du plafond
      expect(() =>
        enregistrerFacture(base, {
          numeroFournisseur: 'FA-PJ-006',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          fichierScanPath: `data:application/pdf;base64,${enorme}`,
          lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
        }),
      ).toThrow(ErreurMetier);
    });

    it("la contre-écriture d'annulation ne porte jamais de pièce jointe propre, l'originale garde la sienne", () => {
      const resultat = enregistrerFacture(base, {
        numeroFournisseur: 'FA-PJ-007',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        fichierScanPath: PIECE_VALIDE,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      });

      const contrepassation = annulerFacture(base, resultat.factureId, 'Erreur de saisie');

      expect(lireFactureDetail(base, contrepassation.id)!.fichierScanPath).toBeNull();
      expect(lireFactureDetail(base, resultat.factureId)!.fichierScanPath).toBe(PIECE_VALIDE);
    });
  });
});
