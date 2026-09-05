/**
 * Le fournisseur « inventaire d'ouverture » — référentiel, pas démonstration.
 *
 * Ce que ces tests protègent : le premier geste de quelqu'un qui installe
 * l'application est de déclarer ce qu'il a DÉJÀ en stock. Un inventaire
 * d'ouverture est structurellement une réception, or une réception exige un
 * fournisseur. Sans cette ligne de référentiel, l'écran d'inventaire ne peut
 * que demander à l'utilisateur d'inventer lui-même un fournisseur — une
 * consigne de contournement, pas un produit fini.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from './index.js';
import { FOURNISSEUR_INVENTAIRE_OUVERTURE } from './fournisseurs-systeme.js';
import { conditionnement, fournisseur, ingredient, lot } from '../schema.js';
import { enregistrerReception } from '../services/reception.js';
import { enregistrerSortie } from '../services/mouvements.js';
import { genererBrouillonsCommandes } from '../services/commandes.js';
import { ajouterVersionParametre } from '../depots/parametres.js';
import { ajouterJours, maintenantUtc, nouvelIdentifiant } from '@batte/core';

function fournisseurOuverture(base: BaseBatte) {
  return base
    .select()
    .from(fournisseur)
    .where(eq(fournisseur.nom, FOURNISSEUR_INVENTAIRE_OUVERTURE))
    .get();
}

describe("fournisseur système « inventaire d'ouverture »", () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('est créé par `seed()`, donc présent sans installer la démonstration', () => {
    const resultat = seed(base);

    expect(resultat.fournisseursSysteme.inseres).toEqual([FOURNISSEUR_INVENTAIRE_OUVERTURE]);
    expect(fournisseurOuverture(base)).toBeDefined();
  });

  it("relancer la graine n'insère rien et ne duplique pas la ligne", () => {
    seed(base);
    const second = seed(base);

    expect(second.fournisseursSysteme.inseres).toEqual([]);
    expect(
      base
        .select()
        .from(fournisseur)
        .where(eq(fournisseur.nom, FOURNISSEUR_INVENTAIRE_OUVERTURE))
        .all(),
    ).toHaveLength(1);
  });

  it("est ACTIF : l'écran de réception ne propose que les fournisseurs actifs", () => {
    seed(base);
    // `apps/web/src/saisie-stock/SaisieReception.tsx` filtre sur `actif`.
    // Désactivé, ce fournisseur serait invisible dans le seul écran où il sert.
    expect(fournisseurOuverture(base)!.actif).toBe(true);
  });

  it("n'invente aucune donnée de contact ni condition commerciale", () => {
    seed(base);
    const f = fournisseurOuverture(base)!;

    // On ne commande rien à ce fournisseur : tout ce qui est facultatif reste
    // vide plutôt que de porter une valeur plausible mais fausse.
    expect(f.email).toBeNull();
    expect(f.telephone).toBeNull();
    expect(f.adresse).toBeNull();
    expect(f.francoDePortCents).toBeNull();
    expect(f.commandeMinimumCents).toBeNull();
    expect(f.delaiLivraisonJours).toBe(0);
    expect(f.notes).not.toBeNull();
  });

  it('ne porte aucun conditionnement : il ne peut donc jamais aboutir sur un bon de commande', () => {
    seed(base);
    const f = fournisseurOuverture(base)!;

    // C'est CE fait — et non son statut actif/inactif — qui le tient à l'écart
    // des achats : `genererBrouillonsCommandes` déduit le fournisseur à
    // commander du conditionnement de l'ingrédient.
    expect(
      base.select().from(conditionnement).where(eq(conditionnement.fournisseurId, f.id)).all(),
    ).toHaveLength(0);
  });

  it('permet réellement de saisir un inventaire d’ouverture : lot créé et tracé', () => {
    seed(base);
    const f = fournisseurOuverture(base)!;

    const maintenant = maintenantUtc();
    const idIngredient = nouvelIdentifiant();
    base
      .insert(ingredient)
      .values({
        id: idIngredient,
        nom: 'Ingrédient de test',
        categorie: 'consommable',
        uniteReference: 'g',
        densiteGParMl: null,
        allergenes: [],
        stockSecurite: 0,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const recu = enregistrerReception(base, {
      fournisseurId: f.id,
      dateReception: '2026-07-01',
      lignes: [
        {
          ingredientId: idIngredient,
          quantite: 1500,
          prixLigneCents: 900,
          numeroLotFournisseur: 'LOT-TEST',
        },
      ],
    });

    expect(recu.lotsCrees).toHaveLength(1);
    const cree = base.select().from(lot).where(eq(lot.id, recu.lotsCrees[0]!.lotId)).get()!;
    // Le lot porte une identité de fournisseur, pas un vide : c'est toute la
    // raison de préférer une ligne nommée à un `fournisseur_id` nullable.
    expect(cree.fournisseurId).toBe(f.id);
  });

  /**
   * Test de NON-RÉGRESSION — ex-`it.fails`, CORRIGÉ et converti. VÉRIFIÉ, pas
   * déduit.
   *
   * Le défaut : `genererBrouillonsCommandes` choisit à qui commander via
   * `conditionnementReference` — le conditionnement ACTIF de `date_prix` la plus
   * récente, tous fournisseurs confondus. Rien n'y écartait un fournisseur
   * SYSTÈME. Il suffisait donc qu'un format d'achat soit rattaché à « Inventaire
   * d'ouverture » — geste plausible : c'est le fournisseur qu'on vient
   * d'utiliser, et il apparaissait dans les listes déroulantes puisqu'il est
   * actif — pour que le moteur émette un bon de commande adressé à une ligne qui
   * ne correspond à aucune entreprise, sans e-mail, et qu'on puisse ensuite
   * valider puis « envoyer ».
   *
   * Les trois correctifs attendus ont été posés, et vérifiés ici :
   *   1. cinquième valeur d'enum `type` au schéma (`fournisseur.type`,
   *      `schema.ts`) — aucun des quatre types précédents ne décrivait
   *      honnêtement cette ligne ;
   *   2. exclusion par `ne(fournisseur.type, 'systeme')` dans
   *      `conditionnementReference` (`services/commandes.ts`) ;
   *   3. refus à l'écriture en amont (`verifierFournisseurCommercial`,
   *      `depots/fournisseur-systeme.ts`, appelé par
   *      `depots/referentiel-ecriture.ts` et `depots/economies.ts` ;
   *      `verifierFournisseurModifiable`, `depots/referentiel.ts`) : on ne
   *      commande rien à un fournisseur système, et la règle vaut aussi avant
   *      qu'un conditionnement lui soit rattaché.
   *
   * Le test s'est donc mis à PASSER, donc à ÉCHOUER en tant qu'`it.fails` — ce
   * qui a forcé sa conversion, comme le veut la convention du dépôt.
   */
  it('ne reçoit jamais de brouillon de commande', () => {
    seed(base);
    const f = fournisseurOuverture(base)!;

    const jour = '2026-07-27';
    ajouterVersionParametre(base, {
      cle: 'reappro_fenetre_historique_jours',
      valeur: '14',
      typeValeur: 'entier',
      dateDebutValidite: '2026-07-01',
      source: 'test',
    });

    const maintenant = maintenantUtc();
    const idIngredient = nouvelIdentifiant();
    base
      .insert(ingredient)
      .values({
        id: idIngredient,
        nom: 'Article déclaré à l’ouverture',
        categorie: 'consommable',
        uniteReference: 'g',
        densiteGParMl: null,
        allergenes: [],
        stockSecurite: 0,
        delaiLivraisonJours: 3,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    /**
     * Le geste plausible : l'utilisateur a déclaré cet article à l'ouverture,
     * puis lui a créé un format d'achat en choisissant — dans une liste où il
     * apparaît, puisqu'il est actif — le fournisseur qu'il venait d'utiliser.
     * C'est alors le SEUL conditionnement de l'ingrédient, donc sa référence.
     */
    base
      .insert(conditionnement)
      .values({
        id: nouvelIdentifiant(),
        ingredientId: idIngredient,
        fournisseurId: f.id,
        libelle: "Reliquat d'inventaire",
        quantiteUniteRef: 1000,
        prixCents: 500,
        datePrix: jour,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    // Consommation régulière qui fait passer le stock sous le point de commande.
    const debut = ajouterJours(jour, -14);
    enregistrerReception(base, {
      fournisseurId: f.id,
      dateReception: debut,
      lignes: [
        {
          ingredientId: idIngredient,
          quantite: 1600,
          prixLigneCents: 800,
          numeroLotFournisseur: 'LOT-TEST',
        },
      ],
    });
    for (let j = 0; j < 14; j += 1) {
      enregistrerSortie(base, {
        ingredientId: idIngredient,
        quantite: 100,
        type: 'sortie_production',
        motifCode: 'SURDOSAGE',
        dateMouvement: ajouterJours(debut, j),
      });
    }

    const resultat = genererBrouillonsCommandes(base, { jourReference: jour });
    expect(resultat.commandes.map((c) => c.fournisseurId)).not.toContain(f.id);
  });
});
