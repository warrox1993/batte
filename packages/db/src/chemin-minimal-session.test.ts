/**
 * CHEMIN MINIMAL jusqu'a la premiere session close, sur une base REELLEMENT
 * VIERGE — mission « établir le chemin minimal jusqu'à la première vraie
 * session ».
 *
 * L'application est couverte par des milliers de tests, mais aucun ne part
 * d'une base sans le jeu de DEMONSTRATION (`seedDemonstration`) pour reproduire
 * ce que le porteur affronte reellement le jour de l'installation : un lieu,
 * un produit, une recette, un ingredient — tout est a saisir. `parcours-erp.
 * test.ts` (meme paquet) part DELIBEREMENT de `seedDemonstration()` : il prouve
 * que la chaine de donnees tient, avec un decor deja plante. Ce fichier fait
 * l'inverse : il enleve le decor et regarde ce qui se passe.
 *
 * METHODE IMPOSEE PAR LA MISSION : deriver l'ordre des dependances en les
 * RENCONTRANT (un appel de service qui echoue, avec son message), jamais en
 * lisant `schema.ts`. Chaque section ci-dessous commence donc par l'echec, puis
 * comble le manque qui vient d'etre nomme. Rien de neuf n'est ecrit dans
 * `packages/db/src` en dehors de ce fichier — tous les services et depots
 * appeles ici sont deja en production.
 *
 * Deux chemins sont prouves, cote a cote :
 *
 *   - le CHEMIN MINIMAL ABSOLU (section 5) : une session close avec le moins
 *     d'entites possible. Il reussit — et degrade SILENCIEUSEMENT le cout
 *     matiere a zero, donc la marge affichee est fausse sans qu'aucune erreur
 *     ne le signale.
 *   - le CHEMIN REALISTE (section 6) : le meme aboutissement, mais avec un
 *     vrai ingredient, une vraie reception, une vraie production — celui que
 *     le porteur doit reellement suivre pour que ses chiffres du dimanche
 *     veuillent dire quelque chose.
 *
 * Aucune donnee METIER n'est inventee ici (CLAUDE.md §7) : les identifiants,
 * prix et quantites de ce fichier sont des DONNEES DE TEST explicitement
 * fictives, jamais presentees comme une recommandation pour la vraie base du
 * porteur (`donnees/batte.sqlite`, jamais touchee par ce fichier).
 */

import { describe, expect, it } from 'vitest';
import {
  ErreurIntrouvable,
  ErreurMetier,
  schemaSaisieIngredient,
  schemaSaisieLieu,
  schemaSaisieProduit,
  schemaSaisieRecette,
} from '@batte/core';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from './client.js';
import { migrer } from './migrer.js';
import { seed } from './seed/index.js';
import { FOURNISSEUR_INVENTAIRE_OUVERTURE } from './seed/fournisseurs-systeme.js';
import {
  conditionnement,
  fournisseur,
  ingredient,
  lieuMarche,
  lot,
  produitVente,
  recette,
  sessionMarche,
} from './schema.js';
import {
  changerStatutRecette,
  creerIngredient,
  creerLieu,
  creerRecette,
} from './depots/referentiel-ecriture.js';
import { creerProduit } from './depots/referentiel.js';
import { lireParametres } from './depots/parametres.js';
import { enregistrerReception } from './services/reception.js';
import { lancerProduction, saisirRealise } from './services/production.js';
import { cloturerSession, creerSession } from './services/sessions.js';

/**
 * Base REELLEMENT vierge : migration + `seed()` SEUL, jamais
 * `seedDemonstration()`. C'est exactement la base que le porteur obtient au
 * premier `npm run db:init` sur une machine neuve.
 *
 * `:memory:` : aucune ecriture sur `donnees/batte.sqlite` (interdiction
 * explicite de la mission — cette base reelle est tenue ouverte par le serveur
 * du porteur).
 */
function baseVierge(): BaseBatte {
  const base = creerBase(':memory:');
  migrer(base);
  seed(base);
  return base;
}

/** Capture une erreur levee par `fn`, sans jamais laisser un test planter au mauvais endroit. */
function capturer(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (erreur) {
    return erreur;
  }
}

describe('Chemin minimal jusqu’à la première session close (base réellement vierge)', () => {
  /* ═══════════════════════════════════════════════════════════════════════
     0. CE QUE LE SEED VIERGE FOURNIT DÉJÀ — avant toute saisie du porteur
     ═══════════════════════════════════════════════════════════════════════ */

  describe('0. Ce que seed() (sans démonstration) pose déjà', () => {
    it('ne pose ni lieu, ni produit, ni recette, ni ingrédient métier : tout cela reste à saisir', () => {
      const base = baseVierge();
      expect(base.select().from(lieuMarche).all()).toHaveLength(0);
      expect(base.select().from(produitVente).all()).toHaveLength(0);
      expect(base.select().from(recette).all()).toHaveLength(0);
      expect(base.select().from(ingredient).all()).toHaveLength(0);
      expect(base.select().from(conditionnement).all()).toHaveLength(0);
    });

    it('pose déjà un fournisseur SYSTÈME utilisable pour déclarer un inventaire d’ouverture', () => {
      const base = baseVierge();
      const fournisseurs = base.select().from(fournisseur).all();
      expect(fournisseurs).toHaveLength(1);
      expect(fournisseurs[0]!.nom).toBe(FOURNISSEUR_INVENTAIRE_OUVERTURE);
      expect(fournisseurs[0]!.type).toBe('systeme');
      // Ce fournisseur est ACTIF : il apparaît donc dans le sélecteur de
      // l'écran de réception dès le premier lancement, sans qu'aucun
      // fournisseur commercial n'ait encore été saisi.
      expect(fournisseurs[0]!.actif).toBe(true);
    });

    it('pose déjà des paramètres dont la valeur par défaut est une HYPOTHÈSE à corriger, jamais une vérité mesurée', () => {
      const base = baseVierge();
      const parametres = lireParametres(base, '2026-08-02');

      // CLAUDE.md §6 nomme explicitement ces deux-là : le prix du kWh et
      // l'estimation de départ de 120 crêpes. Ce test fige leur valeur
      // D'USINE pour qu'un changement silencieux du catalogue (
      // `packages/core/src/parametres.ts`) se voie ici plutôt que de rester
      // caché dans un écran Paramètres que personne ne relit avant le premier
      // marché.
      expect(parametres.entier('prix_kwh_cents_par_kwh')).toBe(20);
      expect(parametres.entier('prevision_prior_baseline_crepes')).toBe(120);

      // Trois autres hypothèses de départ que la mission demande de nommer,
      // en plus des deux ci-dessus :
      expect(parametres.entier('taux_cotisation_inasti_bp')).toBe(2050);
      expect(parametres.entier('taux_ipp_marginal_bp')).toBe(4000);
      expect(parametres.entier('capacite_cuisson_crepes_par_heure')).toBe(60);

      // L'adresse de départ est VIDE par construction : aucune adresse
      // plausible n'est fabriquée (CLAUDE.md §7). Tant qu'elle reste vide, le
      // coût de déplacement d'une session est incalculable — silencieusement,
      // puisque `cloturerSession` ne bloque jamais dessus (voir section 6).
      expect(parametres.texte('adresse_depart_defaut')).toBe('');
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     1. PREMIER OBSTACLE : une session exige un LIEU qui n'existe pas encore
     ═══════════════════════════════════════════════════════════════════════ */

  describe('1. Premier obstacle rencontré : le lieu', () => {
    it('creerSession refuse un lieuId qui n’existe pas — ErreurIntrouvable, jamais une violation SQLite brute', () => {
      const base = baseVierge();
      const erreur = capturer(() =>
        creerSession(base, { lieuId: 'lieu-qui-nexiste-pas', dateSession: '2026-08-02' }),
      );
      expect(erreur).toBeInstanceOf(ErreurIntrouvable);
      expect((erreur as ErreurIntrouvable).message).toContain('Lieu de marché');
    });

    it('un lieu minimal ne demande qu’un nom : coordonnées, tarif, électricité et distance restent facultatifs à la création', () => {
      const base = baseVierge();
      const saisie = schemaSaisieLieu.parse({ nom: '[test] Marché du dimanche' });
      const lieuId = creerLieu(base, saisie);

      const ligne = base.select().from(lieuMarche).where(eq(lieuMarche.id, lieuId)).get()!;
      expect(ligne.nom).toBe('[test] Marché du dimanche');
      // FACULTATIFS à la création — donc silencieusement absents si le
      // porteur ne les saisit pas tout de suite. Chacun a une conséquence :
      // sans latitude/longitude, aucune météo n'est relevée pour ce lieu
      // (facteur 2 du moteur de prévision) ; sans distanceKm, le coût de
      // déplacement de chaque session sur ce lieu reste incalculable ; sans
      // facturationElectricite, le coût d'électricité au compteur ne sera
      // JAMAIS retenu dans la marge, même si des équipements sont déclarés
      // utilisés à la clôture (`resoudreCoutEnergieSession`).
      expect(ligne.latitude).toBeNull();
      expect(ligne.longitude).toBeNull();
      expect(ligne.distanceKm).toBeNull();
      expect(ligne.facturationElectricite).toBeNull();

      // Une session peut maintenant être créée sur ce lieu.
      const session = creerSession(base, { lieuId, dateSession: '2026-08-02' });
      expect(session.id).toBeTruthy();
      expect(session.numero).toMatch(/^SM-\d{4}-\d{4}$/);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     2. DEUXIÈME OBSTACLE : la clôture exige un PRODUIT VENDABLE
     ═══════════════════════════════════════════════════════════════════════ */

  describe('2. Deuxième obstacle rencontré : le produit vendable', () => {
    it('cloturerSession refuse une ligne de vente vers un produit qui n’existe pas', () => {
      const base = baseVierge();
      const lieuId = creerLieu(base, schemaSaisieLieu.parse({ nom: '[test] Lieu' }));
      const session = creerSession(base, { lieuId, dateSession: '2026-08-02' });

      const erreur = capturer(() =>
        cloturerSession(base, session.id, {
          ventes: [
            { produitVenteId: 'produit-qui-nexiste-pas', quantite: 1, prixUnitaireCents: 300 },
          ],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 300,
          caCarteCents: 0,
          crepesProduites: 0,
          crepesInvendues: 0,
          crepesCassees: 0,
        }),
      );
      expect(erreur).toBeInstanceOf(ErreurIntrouvable);
      expect((erreur as ErreurIntrouvable).message).toContain('Produit');
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     3. TROISIÈME OBSTACLE : un produit TRANSFORMÉ exige une recette
     ═══════════════════════════════════════════════════════════════════════ */

  describe('3. Troisième obstacle rencontré : un transformé exige une recette (même vide)', () => {
    it('schemaSaisieProduit refuse un transformé sans recetteId — avant même d’atteindre la base', () => {
      const erreur = capturer(() =>
        schemaSaisieProduit.parse({
          nom: '[test] Crêpe sans recette',
          nature: 'transforme',
          recetteId: null,
          ingredientId: null,
          prixCents: 300,
          consommationUnite: 'crepes',
          nbCrepes: 1,
          volumeMlParUnite: null,
          categorie: null,
          consommationSurPlace: false,
        }),
      );
      expect(erreur).toBeInstanceOf(Error);
      expect((erreur as Error).message).toContain('recette');
    });

    it('une recette peut être créée VIDE, en brouillon, et cela suffit à rattacher un produit vendable', () => {
      const base = baseVierge();
      // Aucune ligne : ni ingrédient, ni conditionnement, ni fournisseur ne
      // sont nécessaires pour CE geste précis — seulement pour que le
      // COÛT du produit veuille dire quelque chose (voir section 5 et 6).
      const recetteId = creerRecette(
        base,
        schemaSaisieRecette.parse({
          code: '[test]-R-VIDE',
          nom: '[test] Recette vide',
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

      const ligneRecette = base.select().from(recette).where(eq(recette.id, recetteId)).get()!;
      // Toute recette naît en BROUILLON — jamais produisible telle quelle
      // (`lancerProduction` refuse tout ce qui n'est pas `active`).
      expect(ligneRecette.statut).toBe('brouillon');

      const produitId = creerProduit(
        base,
        schemaSaisieProduit.parse({
          nom: '[test] Crêpe (recette vide)',
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
      expect(produitId).toBeTruthy();
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     4. QUATRIÈME OBSTACLE : sans production rattachée, crêpes produites
        doit être saisi À LA MAIN — et rester cohérent
     ═══════════════════════════════════════════════════════════════════════ */

  describe('4. Quatrième obstacle rencontré : « crêpes produites » sans aucune production rattachée', () => {
    function baseAvecProduitTransformeSansStock(): {
      base: BaseBatte;
      sessionId: string;
      produitId: string;
    } {
      const base = baseVierge();
      const lieuId = creerLieu(base, schemaSaisieLieu.parse({ nom: '[test] Lieu' }));
      const recetteId = creerRecette(
        base,
        schemaSaisieRecette.parse({
          code: '[test]-R-VIDE-4',
          nom: '[test] Recette vide',
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
      return { base, sessionId: session.id, produitId };
    }

    it('refuse de clôturer sans « crêpes produites » quand aucune production n’est rattachée', () => {
      const { base, sessionId, produitId } = baseAvecProduitTransformeSansStock();

      const erreur = capturer(() =>
        cloturerSession(base, sessionId, {
          ventes: [{ produitVenteId: produitId, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          // `crepesProduites` volontairement absent.
          crepesInvendues: 0,
          crepesCassees: 0,
        }),
      );
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('crepes_produites_inconnues');
    });

    it('refuse un « crêpes produites » incohérent avec vendues + invendues + cassées', () => {
      const { base, sessionId, produitId } = baseAvecProduitTransformeSansStock();

      const erreur = capturer(() =>
        cloturerSession(base, sessionId, {
          ventes: [{ produitVenteId: produitId, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          crepesProduites: 9_999, // n'importe quel nombre, sans rapport avec l'écoulement réel
          crepesInvendues: 0,
          crepesCassees: 0,
        }),
      );
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('crepes_produites_incoherentes');
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     5. LE CHEMIN MINIMAL ABSOLU — réussit, et DÉGRADE LE COÛT MATIÈRE
        SILENCIEUSEMENT (aucun ingrédient, aucune réception, jamais reçus)
     ═══════════════════════════════════════════════════════════════════════ */

  describe('5. Le chemin minimal ABSOLU réussit — et cache un coût matière nul', () => {
    it('clôture une session avec seulement 1 lieu + 1 recette VIDE + 1 produit + 1 session : 4 créations en tout', () => {
      const base = baseVierge();

      // (1) LIEU — bloquant, section 1.
      const lieuId = creerLieu(base, schemaSaisieLieu.parse({ nom: '[test] La Batte' }));

      // (2) RECETTE, vide — bloquant pour créer un produit TRANSFORMÉ (section 3),
      //     mais PAS bloquant pour la production, puisqu'aucune production
      //     n'aura jamais lieu dans ce chemin.
      const recetteId = creerRecette(
        base,
        schemaSaisieRecette.parse({
          code: '[test]-R-ABSOLU',
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

      // (3) PRODUIT — bloquant, section 2 et 3.
      const produitId = creerProduit(
        base,
        schemaSaisieProduit.parse({
          nom: '[test] Crêpe (chemin minimal absolu)',
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

      // (4) SESSION — bloquant, section 1.
      const session = creerSession(base, { lieuId, dateSession: '2026-08-02' });

      // CLÔTURE : aucune réception, aucun ingrédient, aucune production
      // n'ont jamais existé. `crepesProduites` est saisi À LA MAIN (section 4)
      // et rendu cohérent avec l'écoulement déclaré.
      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: produitId, quantite: 10, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 3000,
        caCarteCents: 0,
        crepesProduites: 10,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      // LA CLÔTURE RÉUSSIT — rien ne l'empêche. Aucun écart de stock : il n'y
      // avait aucun stock à sortir (ni garniture, ni marchandise revendue).
      expect(resultat.ecartsStock).toHaveLength(0);

      const sessionCloturee = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;

      expect(sessionCloturee.statut).toBe('cloturee');
      expect(sessionCloturee.caTotalCents).toBe(3000);

      // LA DÉGRADATION SILENCIEUSE : aucune matière première n'a jamais été
      // reçue, donc le coût matière de cette session vaut EXACTEMENT zéro —
      // pas parce que la crêpe ne coûte rien, mais parce que rien n'a jamais
      // été déclaré. Rien dans le retour de `cloturerSession`, ni dans l'état
      // de la session, ne le signale : la marge s'affiche à 100 % du CA,
      // exactement l'illusion contre laquelle CLAUDE.md §6 met en garde à
      // propos de la ventilation transformé/revendu — ici pour le coût
      // matière d'un produit transformé.
      expect(sessionCloturee.coutMatiereCents).toBe(0);
      expect(sessionCloturee.margeBruteCents).toBe(sessionCloturee.caTotalCents);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     6. LE CHEMIN RÉALISTE — le même aboutissement, avec un vrai ingrédient,
        une vraie réception, une vraie production. C'est celui-ci que le
        porteur doit suivre pour que ses chiffres du dimanche soient justes.
     ═══════════════════════════════════════════════════════════════════════ */

  describe('6. Le chemin RÉALISTE : ingrédient, réception, production — pour des chiffres justes', () => {
    /** Recette avec UNE ligne (100 g de farine pour 1000 ml / 10 crêpes), en brouillon. */
    function recetteAvecUneLigne(base: BaseBatte, farineId: string): string {
      return creerRecette(
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
    }

    it('refuse d’activer une recette qui n’a encore aucune ligne (recette_vide)', () => {
      const base = baseVierge();
      const recetteId = creerRecette(
        base,
        schemaSaisieRecette.parse({
          code: '[t]-R-VIDE-2',
          nom: '[test] Recette à remplir',
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

      const erreur = capturer(() => changerStatutRecette(base, recetteId, 'active'));
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('recette_vide');
    });

    it('refuse de lancer une production sur une recette encore en brouillon (recette_non_active)', () => {
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
      const recetteId = recetteAvecUneLigne(base, farineId);
      // Recette pourvue d'une ligne, mais JAMAIS activée : encore `brouillon`.

      const erreur = capturer(() =>
        lancerProduction(base, {
          recetteId,
          cible: { type: 'volume', volumeMl: 1000 },
          dateProduction: '2026-08-01',
        }),
      );
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('recette_non_active');
    });

    it('une réception s’enregistre SANS AUCUN conditionnement : le prix est saisi ligne par ligne, jamais dérivé d’un conditionnement', () => {
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
      // Aucun conditionnement n'existe pour cet ingrédient à cet instant.
      expect(
        base.select().from(conditionnement).where(eq(conditionnement.ingredientId, farineId)).all(),
      ).toHaveLength(0);

      const fournisseurSystemeId = base
        .select({ id: fournisseur.id })
        .from(fournisseur)
        .where(eq(fournisseur.nom, FOURNISSEUR_INVENTAIRE_OUVERTURE))
        .get()!.id;

      const reception = enregistrerReception(base, {
        fournisseurId: fournisseurSystemeId,
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

      // La réception a réussi : un conditionnement n'est donc PAS un
      // préalable à la réception, contrairement à ce que la structure de
      // l'écran pourrait laisser croire. Il sert la SUGGESTION de commande et
      // le coût de revient THÉORIQUE affiché sur la fiche produit
      // (`coutRevientProduit`, `packages/db/src/depots/recettes.ts`), jamais
      // le prix réellement payé à la réception.
      expect(reception.lotsCrees).toHaveLength(1);
      expect(reception.montantTotalCents).toBe(250);
    });

    it('refuse un lot qui n’est identifiable ni par un numéro de lot ni par une DLC', () => {
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
          // Aucune durée de conservation déclarée : aucune DLC ne peut donc
          // être DÉDUITE à la réception.
          dureeConservationJours: null,
          notes: null,
        }),
      );
      const fournisseurSystemeId = base
        .select({ id: fournisseur.id })
        .from(fournisseur)
        .where(eq(fournisseur.nom, FOURNISSEUR_INVENTAIRE_OUVERTURE))
        .get()!.id;

      const erreur = capturer(() =>
        enregistrerReception(base, {
          fournisseurId: fournisseurSystemeId,
          dateReception: '2026-07-27',
          numeroBonLivraison: null,
          lignes: [
            {
              ingredientId: farineId,
              quantite: 5000,
              prixLigneCents: 250,
              // Ni numéro de lot, ni DLC saisie ou déductible.
            },
          ],
        }),
      );
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('lot_non_identifiable');
    });

    it('refuse une production si le stock reçu est insuffisant (production_infaisable)', () => {
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
      const recetteId = recetteAvecUneLigne(base, farineId);
      changerStatutRecette(base, recetteId, 'active');

      const fournisseurSystemeId = base
        .select({ id: fournisseur.id })
        .from(fournisseur)
        .where(eq(fournisseur.nom, FOURNISSEUR_INVENTAIRE_OUVERTURE))
        .get()!.id;

      // Reçu : 50 g de farine. Il en faut 100 g pour 1000 ml (facteur 1).
      enregistrerReception(base, {
        fournisseurId: fournisseurSystemeId,
        dateReception: '2026-07-27',
        numeroBonLivraison: null,
        lignes: [
          {
            ingredientId: farineId,
            quantite: 50,
            prixLigneCents: 3,
            numeroLotFournisseur: '[test] LOT-INSUFFISANT',
          },
        ],
      });

      const erreur = capturer(() =>
        lancerProduction(base, {
          recetteId,
          cible: { type: 'volume', volumeMl: 1000 },
          dateProduction: '2026-08-01',
        }),
      );
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('production_infaisable');
    });

    it('avec assez de stock reçu, production puis clôture aboutissent — et CETTE FOIS le coût matière est réel', () => {
      const base = baseVierge();

      // (1) LIEU
      const lieuId = creerLieu(base, schemaSaisieLieu.parse({ nom: '[test] La Batte' }));

      // (2) INGRÉDIENT
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

      // (3) RÉCEPTION — sur le fournisseur SYSTÈME déjà posé par seed(), sans
      //     jamais avoir créé de fournisseur commercial ni de conditionnement.
      const fournisseurSystemeId = base
        .select({ id: fournisseur.id })
        .from(fournisseur)
        .where(eq(fournisseur.nom, FOURNISSEUR_INVENTAIRE_OUVERTURE))
        .get()!.id;
      const reception = enregistrerReception(base, {
        fournisseurId: fournisseurSystemeId,
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

      // (4) RECETTE avec 1 ligne, puis ACTIVÉE — bloquant pour la production.
      const recetteId = recetteAvecUneLigne(base, farineId);
      changerStatutRecette(base, recetteId, 'active');

      // (5) PRODUIT vendable, rattaché à cette recette.
      const produitId = creerProduit(
        base,
        schemaSaisieProduit.parse({
          nom: '[test] Crêpe (chemin réaliste)',
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

      // (6) SESSION, planifiée AVANT la production : c'est elle qui rattache
      //     ensuite la production à la marge de cette session précise
      //     (`production.session_id`), sans aucune ressaisie (CLAUDE.md §0).
      const session = creerSession(base, { lieuId, dateSession: '2026-08-02' });

      // (7) PRODUCTION, rattachée à la session.
      const production = lancerProduction(base, {
        recetteId,
        cible: { type: 'volume', volumeMl: 1000 },
        dateProduction: '2026-08-01',
        sessionId: session.id,
      });
      expect(production.crepesTheoriques).toBe(10);
      // Coût théorique dérivé du prix RÉELLEMENT payé au lot (250 c / 5000 g
      // = 0,05 c/g, pour 100 g consommés = 5 c) — jamais un prix moyen ni un
      // prix de conditionnement, qui n'existe même pas ici.
      expect(production.coutMatiereTheoriqueCents).toBe(5);

      // (8) SAISIE DU RÉALISÉ — facultative pour clôturer (la clôture peut se
      //     satisfaire du théorique seul), mais nécessaire pour que l'écart
      //     théorique/réel existe.
      saisirRealise(base, production.productionId, {
        volumeReelMl: 1000,
        crepesReelles: 10,
        ecartMotif: null,
      });

      // (9) CLÔTURE — `crepesProduites` n'est PLUS saisi à la main : il est
      //     DÉRIVÉ de la production rattachée (10 crêpes réelles).
      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: produitId, quantite: 10, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 3000,
        caCarteCents: 0,
        crepesInvendues: 0,
        crepesCassees: 0,
      });
      expect(resultat.ecartsStock).toHaveLength(0);

      const sessionCloturee = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;

      expect(sessionCloturee.statut).toBe('cloturee');
      expect(sessionCloturee.caTotalCents).toBe(3000);

      // LE CONTRASTE AVEC LA SECTION 5 : cette fois, le coût matière est
      // RÉEL — dérivé du lot effectivement consommé, jamais saisi — et donc
      // strictement positif. La marge brute est désormais strictement
      // inférieure au CA, pas égale à lui.
      expect(sessionCloturee.coutMatiereCents).toBe(5);
      expect(sessionCloturee.coutMatiereCents).toBeGreaterThan(0);
      expect(sessionCloturee.margeBruteCents).toBe(
        sessionCloturee.caTotalCents! - sessionCloturee.coutMatiereCents!,
      );
      expect(sessionCloturee.margeBruteCents).toBeLessThan(sessionCloturee.caTotalCents!);

      // Le lot de farine porte bien la trace de ce qui a été consommé.
      const lotFarine = base.select().from(lot).where(eq(lot.ingredientId, farineId)).get()!;
      expect(lotFarine.receptionId).toBe(reception.receptionId);
    });
  });
});
