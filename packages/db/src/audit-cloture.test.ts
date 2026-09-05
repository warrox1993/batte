/**
 * Audit ciblé de la clôture de session et du calcul de marge (29/07/2026).
 *
 * L'écran de clôture vient d'être beaucoup modifié le même jour (deux modes de
 * saisie, températures, composants de vente). Ce fichier ne re-teste pas ce
 * que `sessions.test.ts` et `parcours-erp.test.ts` couvrent déjà : il fige les
 * défauts trouvés lors de l'audit et corrigés dans la foulée, plus une preuve
 * d'atomicité bout en bout de la clôture.
 *
 * DÉFAUT 1 — CORRIGÉ : `annulerSession` ne contrepassait AUCUN mouvement de
 * stock. Une session close par erreur (revendu, garniture ou composant de
 * vente sorti du stock à la clôture), puis annulée, laissait la matière
 * DÉFINITIVEMENT sortie du stock : `depots/stock.ts` (`SQL_RESTANT`) somme
 * TOUS les mouvements, annulés ou non (D-021 — `is_annule` ne sert qu'à
 * l'affichage), et rien ne reliait le statut de la session au calcul du
 * stock. Le chiffre d'affaires, lui, s'excluait déjà des seuils légaux par un
 * simple filtre `statut = 'cloturee'` — mais le stock n'a pas d'équivalent
 * « exclusion par statut » : la SEULE façon d'en changer la valeur est une
 * écriture inverse. `annulerSession` contrepasse désormais, dans la MÊME
 * transaction que le changement de statut, tout mouvement `sortie_vente`
 * écrit par la clôture de CETTE session (revendus, garnitures, composants) —
 * jamais les mouvements `sortie_production` d'une production rattachée,
 * qui restent sous la responsabilité de sa propre annulation.
 *
 * DÉFAUT 2 — CORRIGÉ : `calculerRentabilite` rendait `tauxEcoulementBp: 0`
 * (jamais `null`) quand aucune crêpe n'avait été produite (session qui ne
 * vend QUE du revendu, par exemple) — `ratioEnPointsDeBase` rend 0 sur un
 * dénominateur nul, ce qui affichait « 0 % d'écoulement », soit un invendu
 * total, là où la vraie réponse est « la question ne se pose pas ». Le type
 * `RentabiliteSession.tauxEcoulementBp` est désormais `PointsDeBase | null`,
 * même garde que les autres ratios de la fonction. Le même défaut existait à
 * l'identique dans l'aide à la frappe de `Sessions.tsx` (corrigé au passage).
 *
 * DÉFAUT 3 — CORRIGÉ : les composants de vente (fiche 15) partageaient leur
 * coût avec les marchandises revendues sous un seul paramètre
 * (`coutMarchandisesRevenduesCents`) dans `calculerRentabilite`, alors que ce
 * ne sont pas la même ligne comptable (un gobelet n'est pas un article
 * revendu tel quel). `calculerRentabilite` reçoit désormais un troisième
 * panier dédié, `coutComposantsVenteCents` — les chiffres ne changent pas
 * (même somme, même exclusion des ratios « par crêpe »), seule la
 * séparation devient explicite dans la signature. Voir
 * `packages/core/src/sessions.test.ts` pour la preuve unitaire complète.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurMetier } from '@batte/core';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from './client.js';
import { migrer } from './migrer.js';
import { seed } from './seed/index.js';
import { seedDemonstration } from './seed/demonstration.js';
import {
  fournisseur,
  ingredient,
  lieuMarche,
  mouvementStock,
  produitVente,
  recette,
  releveTemperature,
  sessionFrais,
  sessionMarche,
  sessionVente,
} from './schema.js';
import { lotsDeLIngredient } from './depots/stock.js';
import { lireSessionDetail, tableauSeuils } from './depots/sessions.js';
import { enregistrerReception } from './services/reception.js';
import { lancerProduction, saisirRealise } from './services/production.js';
import { annulerSession, cloturerSession, creerSession } from './services/sessions.js';

const JOUR = '2026-08-02';
const ANNEE = 2026;

function baseNeuve(): BaseBatte {
  const base = creerBase(':memory:');
  migrer(base);
  seed(base);
  seedDemonstration(base);
  return base;
}

/**
 * L'article REVENDU du jeu de démonstration — même raisonnement que
 * `parcours-erp.test.ts` : le prendre à la source (plutôt que d'en fabriquer
 * un second) prouve que la démonstration reste honnête (D-049) tout en
 * évitant de dupliquer un fournisseur/ingrédient de test.
 */
function articleRevenduDeLaDemonstration(base: BaseBatte): {
  ingredientId: string;
  produitId: string;
} {
  const produit = base
    .select({ id: produitVente.id, ingredientId: produitVente.ingredientId })
    .from(produitVente)
    .where(eq(produitVente.nature, 'revendu'))
    .get();
  if (produit === undefined || produit.ingredientId === null) {
    throw new Error(
      'Le jeu de démonstration ne contient aucun produit « revendu » : ce fichier ne peut pas ' +
        'vérifier la contrepassation du stock à l’annulation.',
    );
  }
  return { ingredientId: produit.ingredientId, produitId: produit.id };
}

/** Stock total (tous lots confondus) d'un ingrédient, tel que le dépôt le calcule. */
function restantTotal(base: BaseBatte, ingredientId: string): number {
  return lotsDeLIngredient(base, ingredientId).reduce((total, l) => total + l.quantiteRestante, 0);
}

/**
 * Réceptionne un lot frais de l'article revendu : le jeu de démonstration ne
 * garantit AUCUN stock résiduel pour lui (sa propre session de démonstration
 * peut l'avoir intégralement vendu) — même précaution que
 * `parcours-erp.test.ts`, qui réapprovisionne toujours avant de vendre plutôt
 * que de supposer un stock de départ.
 */
function approvisionnerRevendu(base: BaseBatte, ingredientId: string, quantite: number): void {
  const idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
  enregistrerReception(base, {
    fournisseurId: idFournisseur,
    dateReception: '2026-07-25',
    numeroBonLivraison: 'BL-AUDIT-REVENDU',
    lignes: [
      {
        ingredientId,
        quantite,
        prixLigneCents: quantite * 270, // ~2,70 €/unité, cohérent avec la démo
        numeroLotFournisseur: 'LOT-AUDIT-REVENDU',
      },
    ],
  });
}

describe('Audit clôture — annuler une session close contrepasse le stock', () => {
  let base: BaseBatte;
  let idLieu: string;
  let revendu: { ingredientId: string; produitId: string };

  beforeEach(() => {
    base = baseNeuve();
    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    revendu = articleRevenduDeLaDemonstration(base);
    approvisionnerRevendu(base, revendu.ingredientId, 100);
  });

  it('DÉFAUT CORRIGÉ : le stock sorti par la clôture revient après annulation', () => {
    const restantAvantVente = restantTotal(base, revendu.ingredientId);

    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: revendu.produitId, quantite: 5, prixUnitaireCents: 750 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 3750,
      caCarteCents: 0,
      crepesProduites: 0,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    // La vente a bien sorti le stock (D-037, déjà couvert ailleurs) : le
    // vérifier ici sert de point de comparaison AVANT l'annulation.
    const restantApresVente = restantTotal(base, revendu.ingredientId);
    expect(restantApresVente).toBe(restantAvantVente - 5);

    const mouvementAvant = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.sessionId, session.id))
      .all()
      .find((m) => m.type === 'sortie_vente')!;
    expect(mouvementAvant.isAnnule).toBe(false);

    annulerSession(base, session.id, 'Session enregistrée par erreur, la vente n’a jamais eu lieu');

    // LE DÉFAUT : avant correction, ce chiffre restait égal à
    // `restantApresVente` pour toujours — `annulerSession` ne faisait que
    // marquer le statut, sans écrire la moindre contrepassation.
    const restantApresAnnulation = restantTotal(base, revendu.ingredientId);
    expect(restantApresAnnulation).toBe(restantAvantVente);

    // La contrepassation suit EXACTEMENT la forme de `annulerMouvement`
    // (services/mouvements.ts) : original marqué, jamais effacé ; écriture
    // inverse datée du même jour.
    const mouvementsApres = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.sessionId, session.id))
      .all();
    const original = mouvementsApres.find((m) => m.id === mouvementAvant.id)!;
    expect(original.isAnnule).toBe(true);
    expect(original.annuleParId).not.toBeNull();

    const contrepassation = mouvementsApres.find((m) => m.id === original.annuleParId)!;
    expect(contrepassation.type).toBe('entree');
    expect(contrepassation.quantite).toBe(original.quantite);
    expect(contrepassation.ajustement).toBe(true);
    expect(contrepassation.dateMouvement).toBe(original.dateMouvement);

    // « Rien ne s'efface » : le CA de la session reste lisible sur la ligne...
    const closeApres = base
      .select()
      .from(sessionMarche)
      .where(eq(sessionMarche.id, session.id))
      .get()!;
    expect(closeApres.statut).toBe('annulee');
    expect(closeApres.caTotalCents).toBe(3750);
    // ...mais ne compte plus nulle part dans les seuils légaux (déjà couvert
    // par `parcours-erp.test.ts`, revérifié ici pour ce scénario précis).
    const seuils = tableauSeuils(base, ANNEE);
    expect(seuils.meta.sessionsTenues).toBe(0);
  });

  it('ne touche PAS la matière consommée par une production rattachée à la session', () => {
    // Une production a sa PROPRE annulation (services/production.ts, hors
    // zone) : la farine réellement pétrie ne doit jamais revenir au stock au
    // seul motif que la SESSION à laquelle la pâte était destinée est annulée.
    const idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
    const idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!
      .id;
    const farine = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!;
    const crepeProduitId = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!.id;

    // Réapprovisionnement large de tous les ingrédients SAUF la farine (déjà
    // en stock via la démonstration) : seule la farine doit être limitante,
    // même précaution que `parcours-erp.test.ts`.
    const autresIngredients = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .all()
      .filter((i) => i.id !== farine.id);
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-30',
      numeroBonLivraison: 'BL-AUDIT-EPICERIE',
      lignes: autresIngredients.map((i) => ({
        ingredientId: i.id,
        quantite: 50_000,
        prixLigneCents: 1000,
        numeroLotFournisseur: 'LOT-AUDIT-EPICERIE',
      })),
    });
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-31',
      numeroBonLivraison: 'BL-AUDIT-FARINE',
      lignes: [
        {
          ingredientId: farine.id,
          quantite: 5000,
          prixLigneCents: 500,
          numeroLotFournisseur: 'LOT-AUDIT-FARINE',
        },
      ],
    });

    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const productionFournee = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      sessionId: session.id,
    });
    saisirRealise(base, productionFournee.productionId, { volumeReelMl: 5000, crepesReelles: 66 });

    const restantFarineAvantCloture = restantTotal(base, farine.id);

    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: crepeProduitId, quantite: 60, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 18_000,
      caCarteCents: 0,
      crepesProduites: 66,
      crepesInvendues: 6,
      crepesCassees: 0,
    });

    // La clôture elle-même ne touche pas la farine : elle sort à la
    // PRODUCTION (déjà faite), pas à la vente (D-037).
    const restantFarineApresCloture = restantTotal(base, farine.id);
    expect(restantFarineApresCloture).toBe(restantFarineAvantCloture);

    annulerSession(
      base,
      session.id,
      'Session annulée pour erreur de saisie, sans rapport avec la pâte',
    );

    const restantFarineApresAnnulation = restantTotal(base, farine.id);
    expect(restantFarineApresAnnulation).toBe(restantFarineApresCloture);
  });

  it('une session déjà annulée refuse une seconde annulation, sans toucher au stock à nouveau', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: revendu.produitId, quantite: 2, prixUnitaireCents: 750 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 1500,
      caCarteCents: 0,
      crepesProduites: 0,
      crepesInvendues: 0,
      crepesCassees: 0,
    });
    annulerSession(base, session.id, 'Première annulation');
    const restantApresPremiereAnnulation = restantTotal(base, revendu.ingredientId);

    expect(() => annulerSession(base, session.id, 'Seconde tentative')).toThrow(ErreurMetier);
    expect(restantTotal(base, revendu.ingredientId)).toBe(restantApresPremiereAnnulation);
  });
});

describe('Audit clôture — un dénominateur inconnu rend null, jamais 0', () => {
  let base: BaseBatte;
  let idLieu: string;
  let revendu: { ingredientId: string; produitId: string };

  beforeEach(() => {
    base = baseNeuve();
    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    revendu = articleRevenduDeLaDemonstration(base);
    approvisionnerRevendu(base, revendu.ingredientId, 100);
  });

  it('DÉFAUT CORRIGÉ : le taux d’écoulement est null, pas 0 %, quand rien n’a été produit', () => {
    // Une session qui ne vend QUE du revendu (aucune crêpe) : `crepesProduites`
    // vaut 0 par construction (aucune production rattachée, aucune crêpe
    // vendue ni cassée ni invendue à justifier).
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: revendu.produitId, quantite: 3, prixUnitaireCents: 750 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 2250,
      caCarteCents: 0,
      crepesProduites: 0,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    const detail = lireSessionDetail(base, session.id)!;
    expect(detail.crepesProduites).toBe(0);
    expect(detail.tauxEcoulementBp).toBeNull();
  });
});

describe('Audit clôture — la clôture est tout ou rien', () => {
  let base: BaseBatte;
  let idLieu: string;
  let revendu: { ingredientId: string; produitId: string };

  beforeEach(() => {
    base = baseNeuve();
    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    revendu = articleRevenduDeLaDemonstration(base);
    approvisionnerRevendu(base, revendu.ingredientId, 100);
  });

  it('un relevé de température hors seuil sans action corrective annule INTÉGRALEMENT la clôture', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

    expect(() =>
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: revendu.produitId, quantite: 2, prixUnitaireCents: 750 }],
        frais: { emplacementCents: 1000, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 1500,
        caCarteCents: 0,
        crepesProduites: 0,
        crepesInvendues: 0,
        crepesCassees: 0,
        // 25 °C dépasse largement le seuil par défaut (7 °C) et ne porte
        // aucune action corrective : `ecrireReleveTemperature` doit refuser,
        // et cet échec arrive APRÈS les ventes, les sorties de stock, la mise
        // à jour de la session et les frais — le point idéal pour prouver
        // que rien ne reste à moitié écrit.
        relevesTemperature: [{ moment: 'retour', equipement: 'Glacière rigide', temperatureC: 25 }],
      }),
    ).toThrow(ErreurMetier);

    const closeApres = base
      .select()
      .from(sessionMarche)
      .where(eq(sessionMarche.id, session.id))
      .get()!;
    expect(closeApres.statut).toBe('planifiee');
    expect(
      base.select().from(sessionVente).where(eq(sessionVente.sessionId, session.id)).all(),
    ).toHaveLength(0);
    expect(
      base.select().from(mouvementStock).where(eq(mouvementStock.sessionId, session.id)).all(),
    ).toHaveLength(0);
    expect(
      base.select().from(sessionFrais).where(eq(sessionFrais.sessionId, session.id)).all(),
    ).toHaveLength(0);
    expect(
      base
        .select()
        .from(releveTemperature)
        .where(eq(releveTemperature.sessionId, session.id))
        .all(),
    ).toHaveLength(0);
  });
});
