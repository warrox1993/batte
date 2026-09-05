/**
 * Tests d'`etatDemarrage` — l'état DÉRIVÉ du parcours de premier lancement.
 *
 * Méthode reprise de `packages/db/src/chemin-minimal-session.test.ts` : une
 * base RÉELLEMENT vierge (`migrer` + `seed()` seul, jamais
 * `seedDemonstration()`), et les mêmes huit gestes que ce fichier a fait
 * apparaître en les RENCONTRANT — quatre bloquants (lieu, recette, produit,
 * session), quatre qui faussent un chiffre sans rien bloquer (ingrédient,
 * réception, recette active avec lignes, production rattachée).
 *
 * Chaque test passe la valeur produite par `etatDemarrage` au travers de
 * `schemaEtatDemarrage.parse(...)` (`@batte/core`) : c'est le contrat que la
 * route `GET /api/demarrage` doit satisfaire, et un dépôt sans type de retour
 * explicite peut violer ce contrat sans que `tsc` ne le voie (§ « attention »
 * de la mission qui a introduit ce fichier) — le passer par `.parse()` est
 * donc la vérification qui compte, pas seulement l'égalité structurelle.
 */

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  schemaEtatDemarrage,
  schemaSaisieIngredient,
  schemaSaisieLieu,
  schemaSaisieProduit,
  schemaSaisieRecette,
} from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { FOURNISSEUR_INVENTAIRE_OUVERTURE } from '../seed/fournisseurs-systeme.js';
import { fournisseur } from '../schema.js';
import {
  changerStatutRecette,
  creerIngredient,
  creerLieu,
  creerRecette,
} from './referentiel-ecriture.js';
import { creerProduit } from './referentiel.js';
import { annulerReception, enregistrerReception } from '../services/reception.js';
import { annulerProduction, lancerProduction } from '../services/production.js';
import { annulerSession, creerSession } from '../services/sessions.js';
import { etatDemarrage } from './demarrage.js';

/** Base RÉELLEMENT vierge : `:memory:`, jamais `donnees/batte.sqlite`. */
function baseVierge(): BaseBatte {
  const base = creerBase(':memory:');
  migrer(base);
  seed(base);
  return base;
}

function idFournisseurSysteme(base: BaseBatte): string {
  return base
    .select({ id: fournisseur.id })
    .from(fournisseur)
    .where(eq(fournisseur.nom, FOURNISSEUR_INVENTAIRE_OUVERTURE))
    .get()!.id;
}

describe('etatDemarrage — base réellement vierge : les huit signaux valent faux', () => {
  it('aucun des huit signaux ne vaut vrai sur une base migrée mais jamais saisie', () => {
    const base = baseVierge();
    const etat = schemaEtatDemarrage.parse(etatDemarrage(base));

    expect(etat).toEqual({
      aLieu: false,
      aRecette: false,
      aProduitVendable: false,
      aSession: false,
      aIngredient: false,
      aReception: false,
      aRecetteActiveAvecLignes: false,
      aProductionRattacheeSession: false,
    });
  });
});

describe('etatDemarrage — les quatre signaux BLOQUANTS, un par un', () => {
  it('aLieu passe à vrai dès la création d’un lieu, et seulement lui', () => {
    const base = baseVierge();
    creerLieu(base, schemaSaisieLieu.parse({ nom: '[test] La Batte' }));

    const etat = schemaEtatDemarrage.parse(etatDemarrage(base));
    expect(etat.aLieu).toBe(true);
    expect(etat.aRecette).toBe(false);
    expect(etat.aProduitVendable).toBe(false);
    expect(etat.aSession).toBe(false);
  });

  it('aRecette passe à vrai dès qu’une recette existe — MÊME VIDE, MÊME EN BROUILLON', () => {
    const base = baseVierge();
    creerRecette(
      base,
      schemaSaisieRecette.parse({
        code: '[test]-R-VIDE',
        nom: '[test] Recette jamais remplie',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 1000,
        rendementReferenceCrepes: 10,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: null,
        procede: null,
        notes: null,
        lignes: [],
      }),
    );

    const etat = schemaEtatDemarrage.parse(etatDemarrage(base));
    expect(etat.aRecette).toBe(true);
    // Vide et en brouillon : ne satisfait PAS le signal FAUSSANT plus strict.
    expect(etat.aRecetteActiveAvecLignes).toBe(false);
  });

  it('aProduitVendable passe à vrai dès la création d’un produit actif (recette vide suffit à le rattacher)', () => {
    const base = baseVierge();
    const recetteId = creerRecette(
      base,
      schemaSaisieRecette.parse({
        code: '[test]-R-2',
        nom: '[test] Recette',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 1000,
        rendementReferenceCrepes: 10,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: null,
        procede: null,
        notes: null,
        lignes: [],
      }),
    );
    creerProduit(
      base,
      schemaSaisieProduit.parse({
        nom: '[test] Crêpe',
        nature: 'transforme',
        recetteId,
        ingredientId: null,
        prixCents: 300,
        consommationUnite: 'crepes',
        nbCrepes: 1,
        volumeMlParUnite: null,
        categorie: null,
        consommationSurPlace: false,
      }),
    );

    const etat = schemaEtatDemarrage.parse(etatDemarrage(base));
    expect(etat.aProduitVendable).toBe(true);
  });

  it('aSession passe à vrai dès la création d’une session, et repasse à faux si elle est ANNULÉE', () => {
    const base = baseVierge();
    const lieuId = creerLieu(base, schemaSaisieLieu.parse({ nom: '[test] Lieu' }));
    const session = creerSession(base, { lieuId, dateSession: '2026-08-02' });

    expect(schemaEtatDemarrage.parse(etatDemarrage(base)).aSession).toBe(true);

    annulerSession(base, session.id, '[test] annulée pour le test');
    expect(schemaEtatDemarrage.parse(etatDemarrage(base)).aSession).toBe(false);
  });
});

describe('etatDemarrage — les quatre signaux qui FAUSSENT un chiffre sans rien bloquer', () => {
  it('aIngredient passe à vrai dès la création d’un ingrédient', () => {
    const base = baseVierge();
    creerIngredient(
      base,
      schemaSaisieIngredient.parse({
        nom: '[test] Farine',
        categorie: 'farine',
        uniteReference: 'g',
        densiteGParMl: 0.55,
        allergenes: ['gluten'],
        stockSecurite: 0,
        delaiLivraisonJours: null,
        dureeConservationJours: null,
        notes: null,
      }),
    );

    expect(schemaEtatDemarrage.parse(etatDemarrage(base)).aIngredient).toBe(true);
  });

  it('aReception passe à vrai dès une réception ACTIVE, et repasse à faux si elle est ANNULÉE', () => {
    const base = baseVierge();
    const farineId = creerIngredient(
      base,
      schemaSaisieIngredient.parse({
        nom: '[test] Farine',
        categorie: 'farine',
        uniteReference: 'g',
        densiteGParMl: 0.55,
        allergenes: ['gluten'],
        stockSecurite: 0,
        delaiLivraisonJours: null,
        dureeConservationJours: null,
        notes: null,
      }),
    );
    const reception = enregistrerReception(base, {
      fournisseurId: idFournisseurSysteme(base),
      dateReception: '2026-07-27',
      numeroBonLivraison: null,
      lignes: [
        {
          ingredientId: farineId,
          quantite: 5000,
          prixLigneCents: 250,
          numeroLotFournisseur: '[test] LOT-1',
        },
      ],
    });

    expect(schemaEtatDemarrage.parse(etatDemarrage(base)).aReception).toBe(true);

    // Contrepassation (règle n°7) : une réception annulée ne doit PLUS
    // compter comme « du stock est réellement entré ».
    annulerReception(base, reception.receptionId, 'ERREUR_SAISIE');
    expect(schemaEtatDemarrage.parse(etatDemarrage(base)).aReception).toBe(false);
  });

  it('aRecetteActiveAvecLignes exige LES DEUX À LA FOIS — active seule ou lignes seules ne suffisent pas', () => {
    const base = baseVierge();
    const farineId = creerIngredient(
      base,
      schemaSaisieIngredient.parse({
        nom: '[test] Farine',
        categorie: 'farine',
        uniteReference: 'g',
        densiteGParMl: 0.55,
        allergenes: ['gluten'],
        stockSecurite: 0,
        delaiLivraisonJours: null,
        dureeConservationJours: null,
        notes: null,
      }),
    );

    // Recette AVEC une ligne, mais encore en BROUILLON : ne satisfait pas le signal.
    const recetteId = creerRecette(
      base,
      schemaSaisieRecette.parse({
        code: '[test]-R-3',
        nom: '[test] Recette avec farine',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 1000,
        rendementReferenceCrepes: 10,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: null,
        procede: null,
        notes: null,
        lignes: [{ ingredientId: farineId, quantiteUniteRef: 100, noteTechnique: null }],
      }),
    );
    expect(schemaEtatDemarrage.parse(etatDemarrage(base)).aRecetteActiveAvecLignes).toBe(false);

    // ACTIVÉE : cette fois les deux conditions sont réunies.
    changerStatutRecette(base, recetteId, 'active');
    expect(schemaEtatDemarrage.parse(etatDemarrage(base)).aRecetteActiveAvecLignes).toBe(true);
  });

  it('aProductionRattacheeSession exige une production NON ANNULÉE et rattachée à une session', () => {
    const base = baseVierge();
    const lieuId = creerLieu(base, schemaSaisieLieu.parse({ nom: '[test] Lieu' }));
    const farineId = creerIngredient(
      base,
      schemaSaisieIngredient.parse({
        nom: '[test] Farine',
        categorie: 'farine',
        uniteReference: 'g',
        densiteGParMl: 0.55,
        allergenes: ['gluten'],
        stockSecurite: 0,
        delaiLivraisonJours: null,
        dureeConservationJours: null,
        notes: null,
      }),
    );
    enregistrerReception(base, {
      fournisseurId: idFournisseurSysteme(base),
      dateReception: '2026-07-27',
      numeroBonLivraison: null,
      lignes: [
        {
          ingredientId: farineId,
          quantite: 5000,
          prixLigneCents: 250,
          numeroLotFournisseur: '[test] LOT-2',
        },
      ],
    });
    const recetteId = creerRecette(
      base,
      schemaSaisieRecette.parse({
        code: '[test]-R-4',
        nom: '[test] Recette avec farine',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 1000,
        rendementReferenceCrepes: 10,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: null,
        procede: null,
        notes: null,
        lignes: [{ ingredientId: farineId, quantiteUniteRef: 100, noteTechnique: null }],
      }),
    );
    changerStatutRecette(base, recetteId, 'active');
    const session = creerSession(base, { lieuId, dateSession: '2026-08-02' });

    // Une production lancée SANS session rattachée ne satisfait pas le signal :
    // c'est justement la distinction qui rend « crêpes produites » saisi à la
    // main plutôt que dérivé (chemin-minimal-session.test.ts, section 4).
    const productionSansSession = lancerProduction(base, {
      recetteId,
      cible: { type: 'volume', volumeMl: 1000 },
      dateProduction: '2026-08-01',
    });
    expect(schemaEtatDemarrage.parse(etatDemarrage(base)).aProductionRattacheeSession).toBe(false);

    const productionRattachee = lancerProduction(base, {
      recetteId,
      cible: { type: 'volume', volumeMl: 1000 },
      dateProduction: '2026-08-01',
      sessionId: session.id,
    });
    expect(schemaEtatDemarrage.parse(etatDemarrage(base)).aProductionRattacheeSession).toBe(true);

    // Annuler LA SEULE production rattachée fait retomber le signal à faux —
    // une production annulée n'a jamais consommé de stock pour de vrai.
    annulerProduction(base, productionRattachee.productionId, 'ERREUR_SAISIE');
    expect(schemaEtatDemarrage.parse(etatDemarrage(base)).aProductionRattacheeSession).toBe(false);

    // La production SANS session, elle, n'a jamais été annulée : elle reste
    // hors de propos pour ce signal, avant comme après (aucune assertion
    // supplémentaire nécessaire — elle a déjà été exclue ci-dessus).
    void productionSansSession;
  });
});

describe('etatDemarrage — le chemin RÉALISTE complet fait passer les huit signaux à vrai', () => {
  it('reproduit section 6 de chemin-minimal-session.test.ts, jusqu’à la clôture', () => {
    const base = baseVierge();

    const lieuId = creerLieu(base, schemaSaisieLieu.parse({ nom: '[test] La Batte' }));
    const farineId = creerIngredient(
      base,
      schemaSaisieIngredient.parse({
        nom: '[test] Farine de froment',
        categorie: 'farine',
        uniteReference: 'g',
        densiteGParMl: 0.55,
        allergenes: ['gluten'],
        stockSecurite: 0,
        delaiLivraisonJours: null,
        dureeConservationJours: null,
        notes: null,
      }),
    );
    enregistrerReception(base, {
      fournisseurId: idFournisseurSysteme(base),
      dateReception: '2026-07-27',
      numeroBonLivraison: null,
      lignes: [
        {
          ingredientId: farineId,
          quantite: 5000,
          prixLigneCents: 250,
          numeroLotFournisseur: '[test] LOT-OUVERTURE-1',
        },
      ],
    });
    const recetteId = creerRecette(
      base,
      schemaSaisieRecette.parse({
        code: '[test]-R-REEL',
        nom: '[test] Recette avec farine',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 1000,
        rendementReferenceCrepes: 10,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: null,
        procede: null,
        notes: null,
        lignes: [{ ingredientId: farineId, quantiteUniteRef: 100, noteTechnique: null }],
      }),
    );
    changerStatutRecette(base, recetteId, 'active');
    const produitId = creerProduit(
      base,
      schemaSaisieProduit.parse({
        nom: '[test] Crêpe',
        nature: 'transforme',
        recetteId,
        ingredientId: null,
        prixCents: 300,
        consommationUnite: 'crepes',
        nbCrepes: 1,
        volumeMlParUnite: null,
        categorie: null,
        consommationSurPlace: false,
      }),
    );
    const session = creerSession(base, { lieuId, dateSession: '2026-08-02' });
    lancerProduction(base, {
      recetteId,
      cible: { type: 'volume', volumeMl: 1000 },
      dateProduction: '2026-08-01',
      sessionId: session.id,
    });

    const etat = schemaEtatDemarrage.parse(etatDemarrage(base));
    expect(etat).toEqual({
      aLieu: true,
      aRecette: true,
      aProduitVendable: true,
      aSession: true,
      aIngredient: true,
      aReception: true,
      aRecetteActiveAvecLignes: true,
      aProductionRattacheeSession: true,
    });

    // `produitId` n'a plus besoin d'être utilisé au-delà de sa création : ce
    // test s'arrête à la production, la clôture elle-même est déjà couverte
    // par `chemin-minimal-session.test.ts`.
    void produitId;
  });
});
