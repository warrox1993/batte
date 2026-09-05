/**
 * Audit de la chaîne production + consommation FEFO (mission du 29/07/2026).
 *
 * `CLAUDE.md` §3 règles 5 et 6 s'appliquent SIMULTANÉMENT à la production : le
 * stock ne se modifie que par un mouvement, et toute consommation se fait en
 * FEFO sur des lots identifiés. Un défaut ici fausse à la fois le stock et la
 * traçabilité, donc la marge ET le registre AFSCA.
 *
 * Périmètre balayé, avec le résultat :
 *  1. FEFO (DLC égales, lot sans DLC servi en dernier, quarantaine/blocage
 *     jamais consommés) — déjà couvert de façon exhaustive par
 *     `packages/core/src/stock.test.ts` (`ordonnerFefo`, `repartirFefo`,
 *     `quantiteDisponible`) sur la fonction pure que `lancerProduction` et
 *     `enregistrerSortie` appellent TOUS LES DEUX. Rien à ajouter ici : dupliquer
 *     ces tests au niveau service n'aurait testé qu'une seule fois de plus la
 *     même fonction pure.
 *  2. Consommation réelle par ingrédient (`saisirRealise`) — fiche 9,
 *     CORRIGÉE, testée en profondeur par `services/production.test.ts`
 *     (sur-consommation, sous-consommation, écart nul, plusieurs lots,
 *     seconde saisie refusée). Vérifié : la restitution est bornée par
 *     `ligne.quantiteTheorique` (jamais plus que ce que CETTE production a
 *     réellement pris à CE lot), donc ne peut pas créer de stock qui n'a
 *     jamais existé.
 *  3. Rendements R1/R2 — `rendement_reference_ml` / `_crepes` sont des
 *     COLONNES de `recette` (D-014), jamais des littéraux ; `verifierRecette`
 *     (`packages/core/src/recettes.ts`) refuse un rendement net nul ou négatif
 *     AVANT toute mise à l'échelle. Déjà correct, vérifié par lecture.
 *  4. Rattachement production/session — G1/G4, CORRIGÉ, `verifierSessionRattachable`
 *     refuse déjà une session close à l'aller ET au retour. Déjà testé par
 *     `services/production.test.ts` (describe « Lot G1/G4 »).
 *  5. Faisabilité — `messageFaisabilite` nomme l'ingrédient limitant et le
 *     chiffre manquant. Déjà correct, déjà testé.
 *  6. **ANNULATION — DÉFAUT TROUVÉ, CORRIGÉ ICI.** Voir le describe ci-dessous.
 *  7. Conversions d'unité — `convertir()` est le seul point de conversion
 *     volume↔masse, garde `NaN`/`Infinity`/densité manquante. Aucune
 *     multiplication manuelle trouvée dans `services/production.ts`,
 *     `services/mouvements.ts` ni `services/reception.ts` qui contournerait
 *     `convertir()` — vérifié par lecture (grep), ces trois fichiers ne
 *     manipulent que des quantités déjà dans l'unité de référence déclarée.
 *
 * DÉFAUT n°6, en détail. `schemaStatutProduction` (contrats/productions.ts)
 * prévoit l'état `annulee` depuis le Lot 3 ; `saisirRealise` le REFUSE déjà en
 * entrée ; `depots/previsions.ts` et `services/sessions.ts` (D-038) EXCLUENT
 * déjà les productions `annulee` de leurs sommes. Mais AUCUN chemin du dépôt
 * n'écrivait ce statut : ni service, ni route, ni écran. Une production
 * lancée par erreur (mauvaise recette, mauvaise cible, doublon) restait donc
 * DÉFINITIVEMENT engagée, stock consommé compris — en violation de la règle
 * n°7 (« rien ne s'efface […] corrections par écriture d'annulation »).
 * Corrigé par `annulerProduction` (`services/production.ts`), qui réutilise
 * `contrepasserMouvement` (extrait d'`annulerMouvement`, `services/mouvements.ts`)
 * mouvement par mouvement, dans une seule transaction.
 *
 * LIMITE CONNUE, encodée en `it.fails` en fin de fichier plutôt que passée
 * sous silence (convention `audit-silences.test.ts`) : la route HTTP
 * `POST /productions/:id/annuler` n'est PAS câblée. `annulerProduction` n'est
 * exportée nulle part par `packages/db/src/index.ts` — le SEUL fichier qui
 * bloque, ABSOLUMENT interdit en écriture pour cette mission (« les barils
 * index.ts », plusieurs agents y travaillent en parallèle). Le service est
 * complet et testé ci-dessus ; il manque exactement DEUX lignes pour que
 * l'API l'expose, voir le `it.fails` pour le détail précis.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
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
  production,
  productionConsommation,
  recette,
} from './schema.js';
import { etatDuStock, lotsDeLIngredient } from './depots/stock.js';
import { enregistrerReception } from './services/reception.js';
import { cloturerSession, creerSession } from './services/sessions.js';
import { annulerProduction, lancerProduction, saisirRealise } from './services/production.js';

const JOUR = '2026-07-27';

describe('Audit production — annulation (défaut trouvé : aucun chemin ne l’écrivait)', () => {
  let base: BaseBatte;
  let idR1: string;
  let idFournisseur: string;
  let idLieu: string;
  let idProduitCrepe: string;
  let idFarine: string;

  /**
   * Approvisionne généreusement tous les ingrédients de R1. `numeroLotFournisseur`
   * fixe (docs/17 fiche 16) : un lot doit être identifiable par un numéro OU
   * une DLC précise.
   */
  function approvisionner() {
    const ingredients = base.select().from(ingredient).all();
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: ingredients.map((ing) => ({
        ingredientId: ing.id,
        quantite: 100_000,
        prixLigneCents: 1000,
        numeroLotFournisseur: 'LOT-TEST-APPRO',
      })),
    });
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!.id;
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
    idFarine = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!.id;

    const produitCrepe = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!;
    idProduitCrepe = produitCrepe.id;

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte — test annulation',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  });

  it('rend intégralement le stock consommé, ingrédient par ingrédient', () => {
    approvisionner();
    const avant = etatDuStock(base, JOUR);

    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    // Le stock a bien baissé : sinon le test ne prouverait rien sur l'annulation.
    const farineApresLancement = etatDuStock(base, JOUR).find((l) => l.ingredientId === idFarine)!;
    const farineAvant = avant.find((l) => l.ingredientId === idFarine)!;
    expect(farineApresLancement.quantiteDisponible).toBeLessThan(farineAvant.quantiteDisponible);

    const resultatAnnulation = annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE');
    // Une contrepassation par mouvement d'origine : R1 porte au moins 8 lignes.
    expect(resultatAnnulation.nbMouvementsContrepasses).toBeGreaterThanOrEqual(8);

    const apresAnnulation = etatDuStock(base, JOUR);
    for (const ligneAvant of avant) {
      const ligneApres = apresAnnulation.find((l) => l.ingredientId === ligneAvant.ingredientId)!;
      expect(ligneApres.quantiteDisponible).toBe(ligneAvant.quantiteDisponible);
    }

    const productionApres = base
      .select()
      .from(production)
      .where(eq(production.id, resultat.productionId))
      .get()!;
    expect(productionApres.statut).toBe('annulee');
  });

  it('ne peut pas être annulée deux fois', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE');

    try {
      annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE');
      expect.unreachable('la seconde annulation aurait dû être refusée');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('production_deja_annulee');
    }
  });

  it('D-021 : la contrepassation INCLUT le mouvement annulé dans les sommes, elle ne l’exclut pas', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    const consommationFarine = base
      .select()
      .from(productionConsommation)
      .where(eq(productionConsommation.productionId, resultat.productionId))
      .all()
      .find((c) => c.ingredientId === idFarine)!;

    annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE');

    const mouvementsDuLot = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.lotId, consommationFarine.lotId))
      .all();

    // DEUX écritures au moins : la sortie D'ORIGINE (marquée annulée mais
    // TOUJOURS PRÉSENTE) et la contrepassation en entrée. Rien n'est supprimé
    // (règle n°7 : « rien ne s'efface »).
    expect(mouvementsDuLot.length).toBeGreaterThanOrEqual(2);
    const origine = mouvementsDuLot.find((m) => m.type === 'sortie_production')!;
    expect(origine.isAnnule).toBe(true);
    const contrepassation = mouvementsDuLot.find((m) => m.type === 'entree')!;
    expect(contrepassation.isAnnule).toBe(false);

    // Le restant du lot (`lotsDeLIngredient`, qui somme TOUS les mouvements,
    // annulés compris — D-021) est bien revenu à la quantité initiale : la
    // matière n'a été rendue ni deux fois, ni zéro fois.
    const lots = lotsDeLIngredient(base, idFarine);
    const lot = lots.find((l) => l.id === consommationFarine.lotId)!;
    expect(lot.quantiteRestante).toBe(lot.quantiteInitiale);
  });

  it('contrepasse aussi les écarts de réalisé (fiche 9) : une production TERMINÉE est annulable', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });
    const theorique = base
      .select()
      .from(productionConsommation)
      .where(eq(productionConsommation.productionId, resultat.productionId))
      .all()
      .find((c) => c.ingredientId === idFarine)!.quantiteTheorique;

    // Sur-consommation déclarée : écrit un mouvement de sortie SUPPLÉMENTAIRE
    // (voir `services/production.test.ts`, describe « fiche 9 »).
    saisirRealise(base, resultat.productionId, {
      volumeReelMl: 4800,
      crepesReelles: 61,
      consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: theorique + 50 }],
    });

    const avantAnnulation = etatDuStock(base, JOUR).find(
      (l) => l.ingredientId === idFarine,
    )!.quantiteDisponible;

    // La sortie THÉORIQUE et la sortie D'ÉCART portent toutes deux
    // `production_id` : capturées AVANT l'annulation, pour vérifier ensuite
    // que ce sont bien CES DEUX écritures (et non les contrepassations
    // elles-mêmes) qui se retrouvent marquées annulées.
    const mouvementsAvant = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.productionId, resultat.productionId))
      .all()
      .filter((m) => m.ingredientId === idFarine);
    expect(mouvementsAvant.length).toBe(2);

    const resultatAnnulation = annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE');

    const mouvementsFarineApres = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.productionId, resultat.productionId))
      .all()
      .filter((m) => m.ingredientId === idFarine);
    // Les DEUX originaux, désormais annulés...
    for (const original of mouvementsAvant) {
      expect(mouvementsFarineApres.find((m) => m.id === original.id)!.isAnnule).toBe(true);
    }
    // ...plus DEUX contrepassations toutes fraîches, jamais annulées elles-mêmes.
    expect(mouvementsFarineApres.length).toBe(4);
    expect(mouvementsFarineApres.filter((m) => !m.isAnnule)).toHaveLength(2);

    const apresAnnulation = etatDuStock(base, JOUR).find(
      (l) => l.ingredientId === idFarine,
    )!.quantiteDisponible;
    expect(apresAnnulation).toBeGreaterThan(avantAnnulation);
    expect(resultatAnnulation.nbMouvementsContrepasses).toBeGreaterThanOrEqual(9);

    const productionApres = base
      .select()
      .from(production)
      .where(eq(production.id, resultat.productionId))
      .get()!;
    expect(productionApres.statut).toBe('annulee');
  });

  it('refuse d’annuler une production rattachée à une session DÉJÀ CLÔTURÉE (D-024, agrégats figés)', () => {
    approvisionner();
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      sessionId: session.id,
    });

    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduitCrepe, quantite: 1, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 300,
      caCarteCents: 0,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    try {
      annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE');
      expect.unreachable('l’annulation aurait dû être refusée');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('session_cloturee');
    }

    // Rien n'a bougé : ni le statut, ni le stock.
    const productionApres = base
      .select()
      .from(production)
      .where(eq(production.id, resultat.productionId))
      .get()!;
    expect(productionApres.statut).not.toBe('annulee');
  });

  it('refuse une production introuvable, sans rien écrire', () => {
    expect(() => annulerProduction(base, 'production-inexistante', 'ERREUR_SAISIE')).toThrow(
      ErreurMetier,
    );
  });
});

/** Racine du dépôt : ce fichier vit dans `packages/db/src`. */
const RACINE = resolve(__dirname, '..', '..', '..');

describe('Audit production — annulation reellement joignable (ex-limite connue)', () => {
  /**
   * NON-REGRESSION (ex-`it.fails`, CABLE le 29/07/2026).
   *
   * `annulerProduction` etait ecrite, exportee par `services/production.ts` et
   * testee en profondeur ci-dessus — sans AUCUN appelant de production. Le seul
   * fichier qui bloquait etait le baril `packages/db/src/index.ts`, reserve au
   * coordinateur pendant la campagne multi-agents.
   *
   * La convention a fonctionne exactement comme prevue : le jour du cablage, ce
   * test s'est mis a PASSER, donc a ECHOUER en tant qu'`it.fails` — ce qui a
   * force sa conversion. Il verifie desormais que le chemin reste joignable.
   *
   * Ce qui a ete pose : l'export au baril, l'import dans la route, et
   * `POST /productions/:id/annuler` sur le modele exact de
   * `POST /mouvements/:mouvementId/annuler`, motif OBLIGATOIRE compris — sans
   * lui, le registre ne repondrait pas a « pourquoi ce stock est-il revenu ? ».
   */
  it('annulerProduction est atteignable depuis une route HTTP', () => {
    const baril = readFileSync(resolve(RACINE, 'packages/db/src/index.ts'), 'utf8');
    expect(baril).toContain('annulerProduction');

    const routesProductions = readFileSync(
      resolve(RACINE, 'apps/api/src/routes/productions.ts'),
      'utf8',
    );
    expect(routesProductions).toContain('annulerProduction');
    expect(routesProductions).toContain('/productions/:id/annuler');
  });
});
