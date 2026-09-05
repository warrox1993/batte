/**
 * PARCOURS NOMINAL COMPLET — du meunier a la marge nette et au registre AFSCA.
 *
 * CE QUE CE FICHIER TESTE, ET QUE 3 635 TESTS UNITAIRES NE TESTENT PAS.
 * CLAUDE.md §0 : « les modules ne forment pas des applications juxtaposees,
 * ils forment une seule CHAINE de donnees. Une reception de farine chez le
 * meunier doit se propager, sans ressaisie, jusqu'a la marge nette du dimanche
 * suivant et jusqu'au registre AFSCA. »
 *
 * Un test unitaire prouve qu'un maillon calcule juste. Il ne prouve JAMAIS que
 * ce maillon est BRANCHE au suivant. Ce fichier joue un seul scenario metier
 * du premier geste au dernier, et verifie a chaque etape un chiffre REEL —
 * jamais un code HTTP 200.
 *
 * TROIS REGLES DE FABRICATION, sans lesquelles ce fichier ne vaudrait rien :
 *
 *  1. **Base neuve, en memoire, jamais le fichier du poste.** `creerBase(':memory:')`
 *     explicitement, aucun port ouvert : tout passe par `app.inject()`.
 *     `seed()` seul (parametres, motifs, plan de nettoyage AFSCA, echeances) —
 *     PAS `seedDemonstration()` : tout le referentiel metier de ce parcours est
 *     saisi ICI, par les vraies routes d'ecriture, comme le porteur le ferait.
 *
 *  2. **Des chiffres qui ne tombent JAMAIS rond.** 7 333 g de farine payes
 *     689 c, 4 111 ml de lait payes 501 c, 53 oeufs payes 1 093 c. Un parcours
 *     en nombres ronds ne voit aucun defaut d'arrondi — or l'argent est en
 *     centimes ENTIERS (CLAUDE.md §3 regle 3) et le cout d'un lot est un
 *     `Math.round(quantite × prixLigneCents / quantiteInitiale)`.
 *
 *  3. **Un desequilibre volontaire, et DEUX prix distincts pour la meme
 *     matiere.** Le TARIF du conditionnement (2 347 c les 25 kg) et le PRIX
 *     REELLEMENT PAYE sur le bon de livraison (689 c les 7 333 g) different
 *     deliberement — 0,09388 c/g contre 0,09396 c/g. C'est ce qui discrimine :
 *     une fixture ou les deux prix coincident laisserait passer une production
 *     valorisee au tarif catalogue au lieu du prix paye, et personne ne le
 *     verrait. Les trois ingredients ont aussi des ordres de grandeur
 *     incomparables (milliers de grammes, milliers de ml, dizaines de pieces).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  jourCivilBelge,
  schemaEtatStock,
  schemaFaisabilite,
  schemaListeLots,
  schemaProductionDetail,
  schemaReceptionCreee,
  schemaResultatCalcul,
  schemaResultatCloture,
  schemaTableauSeuils,
  schemaTracabiliteAmontSession,
  schemaTracabiliteAvalLot,
} from '@batte/core';
import { creerBase, migrer, seed, type BaseBatte } from '@batte/db';
import { construireServeur } from './serveur.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Le scenario, en chiffres — tous volontairement non ronds
   ═══════════════════════════════════════════════════════════════════════════ */

/** Tarif catalogue du meunier : ce que le CONDITIONNEMENT coute. */
const TARIF_FARINE = { quantiteUniteRef: 25_000, prixCents: 2_347 };
const TARIF_LAIT = { quantiteUniteRef: 6_000, prixCents: 731 };
const TARIF_OEUFS = { quantiteUniteRef: 30, prixCents: 619 };

/**
 * Bon de livraison REEL : ni les quantites ni les prix ne correspondent au
 * tarif catalogue ci-dessus. C'est voulu (voir l'en-tete, regle 3).
 */
const RECEPTION_FARINE = { quantite: 7_333, prixLigneCents: 689, lot: 'FAR-2026-A' };
const RECEPTION_LAIT = { quantite: 4_111, prixLigneCents: 501, lot: 'LAI-2026-A' };
const RECEPTION_OEUFS = { quantite: 53, prixLigneCents: 1_093, lot: 'OEU-2026-A' };

/** Recette P1, calquee sur R1 (CLAUDE.md §6) mise a l'echelle x11. */
const RECETTE_P1 = {
  rendementReferenceMl: 5_000,
  rendementReferenceCrepes: 66,
  perteCuissonBp: 300,
  tauxCasseBp: 150,
  farineG: 1_595,
  laitMl: 2_640,
  oeufsPiece: 22,
};

/** Cible de la fournee : 47 crepes vendables, pas 50. */
const CIBLE_CREPES = 47;

/** Session : prix de vente et frais, tous non ronds. */
const PRIX_CREPE_CENTS = 273;
const QUANTITE_VENDUE = 31;
const CREPES_CASSEES = 5;
const FRAIS = {
  emplacementCents: 1_137,
  deplacementCents: 823,
  gazCents: 449,
  diversCents: 211,
};
const FONDS_CAISSE_CENTS = 4_700;
const CA_CARTE_CENTS = 3_300;

/* ═══════════════════════════════════════════════════════════════════════════
   Montage
   ═══════════════════════════════════════════════════════════════════════════ */

let base: BaseBatte;
let app: FastifyInstance;
const envInitial: Record<string, string | undefined> = {};

/** Identifiants resolus au fil du parcours — chacun est le fruit d'une etape. */
let idFournisseur = '';
let idFarine = '';
let idLait = '';
let idOeufs = '';
let idRecette = '';
let idLieu = '';
let idProduitCrepe = '';
let idSession = '';
let idProduction = '';
let idReception = '';
let numeroReception = '';
let idLotFarine = '';

let aujourdhui = '';

/** Jour civil belge decale de `jours`. Aucune dependance a un fuseau local. */
function jourDecale(jours: number): string {
  const base = new Date(`${aujourdhui}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + jours);
  return base.toISOString().slice(0, 10);
}

function memoriserEtDefinir(cle: string, valeur: string | undefined): void {
  envInitial[cle] = process.env[cle];
  if (valeur === undefined) delete process.env[cle];
  else process.env[cle] = valeur;
}

beforeAll(async () => {
  // Aucun appel reseau, aucun appel Claude facture : le mode degrade complet
  // exige par CLAUDE.md §5 est precisement ce qu'on exerce ici.
  memoriserEtDefinir('ANTHROPIC_API_KEY', undefined);
  memoriserEtDefinir('MAIL_MODE_TEST', 'true');
  memoriserEtDefinir('OPENROUTESERVICE_API_KEY', undefined);

  base = creerBase(':memory:');
  migrer(base);
  seed(base);

  app = construireServeur(base, { journaliser: false });
  await app.ready();

  aujourdhui = jourCivilBelge(new Date());
}, 60_000);

afterAll(async () => {
  await app.close();
  for (const [cle, valeur] of Object.entries(envInitial)) {
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
}, 60_000);

/* ═══════════════════════════════════════════════════════════════════════════
   Le parcours, etape par etape. `describe` sequentiel : chaque `it` depend
   du precedent — c'est la definition meme d'un parcours, et c'est assume.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('parcours nominal — la chaine complete, du bon de livraison au registre AFSCA', () => {
  it('étape 1 — le référentiel se saisit entièrement par les routes d’écriture', async () => {
    const fournisseur = await app.inject({
      method: 'POST',
      url: '/api/fournisseurs',
      payload: {
        nom: 'Moulin de Hollogne',
        type: 'moulin',
        email: 'commandes@moulin-hollogne.invalid',
        telephone: null,
        adresse: null,
        delaiLivraisonJours: 3,
        francoDePortCents: null,
        commandeMinimumCents: null,
        notes: null,
      },
    });
    expect(fournisseur.statusCode).toBe(201);
    idFournisseur = fournisseur.json<{ id: string }>().id;

    const creerIngredient = async (charge: Record<string, unknown>): Promise<string> => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/ingredients',
        payload: charge,
      });
      expect(reponse.statusCode, JSON.stringify(reponse.json())).toBe(201);
      return reponse.json<{ id: string }>().id;
    };

    idFarine = await creerIngredient({
      nom: 'Farine de froment T55',
      categorie: 'farine',
      uniteReference: 'g',
      densiteGParMl: null,
      allergenes: ['gluten'],
      allergenesVerifies: true,
      stockSecurite: 2_000,
      delaiLivraisonJours: 3,
      dureeConservationJours: 187,
      notes: null,
    });
    idLait = await creerIngredient({
      nom: 'Lait entier',
      categorie: 'laitier',
      uniteReference: 'ml',
      densiteGParMl: 1.03,
      allergenes: ['lait'],
      allergenesVerifies: true,
      stockSecurite: 1_500,
      delaiLivraisonJours: 2,
      dureeConservationJours: 9,
      notes: null,
    });
    // Densite NULLE obligatoire sur une piece : `verifierCoherenceIngredient`
    // refuse une densite sur un ingredient compte a la piece.
    idOeufs = await creerIngredient({
      nom: 'Œuf de poule plein air',
      categorie: 'oeuf',
      uniteReference: 'piece',
      densiteGParMl: null,
      allergenes: ['oeufs'],
      allergenesVerifies: true,
      stockSecurite: 12,
      delaiLivraisonJours: 2,
      dureeConservationJours: 23,
      notes: null,
    });

    expect(idFarine).not.toBe('');
    expect(idLait).not.toBe('');
    expect(idOeufs).not.toBe('');
  });

  it('étape 2 — le TARIF du meunier devient le coût de référence de la recette', async () => {
    const creerConditionnement = async (
      ingredientId: string,
      libelle: string,
      tarif: { quantiteUniteRef: number; prixCents: number },
    ): Promise<void> => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/conditionnements',
        payload: {
          ingredientId,
          fournisseurId: idFournisseur,
          libelle,
          quantiteUniteRef: tarif.quantiteUniteRef,
          prixCents: tarif.prixCents,
          referenceFournisseur: null,
          datePrix: aujourdhui,
        },
      });
      expect(reponse.statusCode, JSON.stringify(reponse.json())).toBe(201);
    };

    await creerConditionnement(idFarine, 'Sac 25 kg', TARIF_FARINE);
    await creerConditionnement(idLait, 'Bidon 6 L', TARIF_LAIT);
    await creerConditionnement(idOeufs, 'Plateau de 30', TARIF_OEUFS);

    const recette = await app.inject({
      method: 'POST',
      url: '/api/recettes',
      payload: {
        code: 'P1',
        nom: 'Pâte froment — parcours',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: RECETTE_P1.rendementReferenceMl,
        rendementReferenceCrepes: RECETTE_P1.rendementReferenceCrepes,
        perteCuissonBp: RECETTE_P1.perteCuissonBp,
        tauxCasseBp: RECETTE_P1.tauxCasseBp,
        perteFixeMl: 0,
        procede: null,
        notes: null,
        lignes: [
          { ingredientId: idFarine, quantiteUniteRef: RECETTE_P1.farineG, noteTechnique: null },
          { ingredientId: idLait, quantiteUniteRef: RECETTE_P1.laitMl, noteTechnique: null },
          { ingredientId: idOeufs, quantiteUniteRef: RECETTE_P1.oeufsPiece, noteTechnique: null },
        ],
      },
    });
    expect(recette.statusCode, JSON.stringify(recette.json())).toBe(201);
    idRecette = recette.json<{ id: string }>().id;

    // `lancerProduction` refuse toute recette qui n'est pas active : sans ce
    // geste, la chaine s'arreterait ici sans qu'aucun test unitaire ne le dise.
    const activation = await app.inject({
      method: 'PATCH',
      url: `/api/recettes/${idRecette}/statut`,
      payload: { statut: 'active' },
    });
    expect(activation.statusCode).toBe(200);

    /*
     * LE PREMIER MAILLON VERIFIE PAR UN CHIFFRE. Le tarif saisi a l'etape
     * precedente (2 347 c les 25 000 g) doit ressortir ici en cout unitaire de
     * reference, au millieme de centime pres — sans qu'aucun ecran ne l'ait
     * ressaisi.
     */
    const calcul = schemaResultatCalcul.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/recettes/${idRecette}/calculer`,
          payload: { cible: 'crepes', valeur: CIBLE_CREPES },
        })
      ).json(),
    );

    const ligneFarine = calcul.lignes.find((l) => l.ingredientId === idFarine)!;
    expect(ligneFarine.cumpCentsParUnite).toBeCloseTo(
      TARIF_FARINE.prixCents / TARIF_FARINE.quantiteUniteRef,
      10,
    );

    // Le cout matiere de la fournee EST la somme arrondie des lignes, pas un
    // total saisi. Chaque ligne vaut `round(quantite × cout unitaire)`.
    for (const ligne of calcul.lignes) {
      expect(ligne.coutCents).not.toBeNull();
      expect(ligne.coutCents).toBe(Math.round(ligne.quantite * ligne.cumpCentsParUnite!));
    }
    expect(calcul.coutMatiereCents).toBe(
      Math.round(calcul.lignes.reduce((somme, l) => somme + l.quantite * l.cumpCentsParUnite!, 0)),
    );

    // Les allergenes des TROIS ingredients remontent a la recette, sans ressaisie.
    expect([...calcul.allergenes].sort()).toEqual(['gluten', 'lait', 'oeufs']);
  });

  it('étape 3 — la réception crée un lot par ligne et fait monter le stock du bon nombre de grammes', async () => {
    const reception = await app.inject({
      method: 'POST',
      url: '/api/receptions',
      payload: {
        fournisseurId: idFournisseur,
        dateReception: aujourdhui,
        numeroBonLivraison: 'BL-HOLLOGNE-4417',
        lignes: [
          {
            ingredientId: idFarine,
            quantite: RECEPTION_FARINE.quantite,
            prixLigneCents: RECEPTION_FARINE.prixLigneCents,
            numeroLotFournisseur: RECEPTION_FARINE.lot,
            dateDlc: jourDecale(187),
          },
          {
            ingredientId: idLait,
            quantite: RECEPTION_LAIT.quantite,
            prixLigneCents: RECEPTION_LAIT.prixLigneCents,
            numeroLotFournisseur: RECEPTION_LAIT.lot,
            dateDlc: jourDecale(9),
          },
          {
            ingredientId: idOeufs,
            quantite: RECEPTION_OEUFS.quantite,
            prixLigneCents: RECEPTION_OEUFS.prixLigneCents,
            numeroLotFournisseur: RECEPTION_OEUFS.lot,
            dateDlc: jourDecale(23),
          },
        ],
      },
    });

    expect(reception.statusCode, JSON.stringify(reception.json())).toBe(201);
    const creee = schemaReceptionCreee.parse(reception.json());
    idReception = creee.receptionId;
    numeroReception = creee.numero;

    expect(creee.nbLots).toBe(3);
    // Le montant du bon de livraison EST la somme de ses lignes, jamais un
    // total saisi a part.
    expect(creee.montantTotalCents).toBe(
      RECEPTION_FARINE.prixLigneCents +
        RECEPTION_LAIT.prixLigneCents +
        RECEPTION_OEUFS.prixLigneCents,
    );

    /* ── Le stock a monte EXACTEMENT des quantites du bon de livraison ──── */

    const stock = schemaEtatStock.parse(
      (await app.inject({ method: 'GET', url: '/api/stock' })).json(),
    );
    const ligne = (id: string) => stock.data.find((l) => l.ingredientId === id)!;

    expect(ligne(idFarine).quantiteDisponible).toBe(RECEPTION_FARINE.quantite);
    expect(ligne(idLait).quantiteDisponible).toBe(RECEPTION_LAIT.quantite);
    expect(ligne(idOeufs).quantiteDisponible).toBe(RECEPTION_OEUFS.quantite);

    /*
     * La VALORISATION du stock vient du prix REELLEMENT PAYE, pas du tarif
     * catalogue. C'est ici que le desequilibre volontaire de l'en-tete paie :
     * si la valorisation lisait le conditionnement, la farine vaudrait
     * round(7333 × 2347/25000) = 688 c, et non les 689 c du bon de livraison.
     */
    expect(ligne(idFarine).valeurCents).toBe(RECEPTION_FARINE.prixLigneCents);
    expect(ligne(idLait).valeurCents).toBe(RECEPTION_LAIT.prixLigneCents);
    expect(ligne(idOeufs).valeurCents).toBe(RECEPTION_OEUFS.prixLigneCents);
    expect(
      Math.round(
        (RECEPTION_FARINE.quantite * TARIF_FARINE.prixCents) / TARIF_FARINE.quantiteUniteRef,
      ),
    ).not.toBe(RECEPTION_FARINE.prixLigneCents);

    /* ── Le lot porte son numero fournisseur et sa DLC ────────────────────── */

    const lots = schemaListeLots.parse(
      (await app.inject({ method: 'GET', url: `/api/stock/${idFarine}/lots` })).json(),
    );
    expect(lots.data).toHaveLength(1);
    idLotFarine = lots.data[0]!.id;
    expect(lots.data[0]!.numeroLotFournisseur).toBe(RECEPTION_FARINE.lot);
    expect(lots.data[0]!.dateDlc).toBe(jourDecale(187));
    expect(lots.data[0]!.quantiteInitiale).toBe(RECEPTION_FARINE.quantite);
    expect(lots.data[0]!.prixLigneCents).toBe(RECEPTION_FARINE.prixLigneCents);
  });

  it('étape 4 — la faisabilité chiffre le besoin contre le stock réellement reçu', async () => {
    const calcul = schemaResultatCalcul.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/recettes/${idRecette}/calculer`,
          payload: { cible: 'crepes', valeur: CIBLE_CREPES },
        })
      ).json(),
    );

    const faisabilite = schemaFaisabilite.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/productions/faisabilite',
          payload: {
            recetteId: idRecette,
            cible: { cible: 'crepes', valeur: CIBLE_CREPES },
            dateProduction: aujourdhui,
          },
        })
      ).json(),
    );

    expect(faisabilite.faisable).toBe(true);
    expect(faisabilite.manquants).toEqual([]);

    // Le BESOIN vient du calculateur de recettes, le DISPONIBLE vient du bon
    // de livraison : deux modules, un seul chiffre de chaque cote.
    for (const besoin of faisabilite.besoins) {
      const ligneCalcul = calcul.lignes.find((l) => l.ingredientId === besoin.ingredientId)!;
      expect(besoin.requis).toBe(ligneCalcul.quantite);
    }
    const besoinFarine = faisabilite.besoins.find((b) => b.ingredientId === idFarine)!;
    expect(besoinFarine.disponible).toBe(RECEPTION_FARINE.quantite);
  });

  it('étape 5 — la production consomme les lots reçus, au prix RÉELLEMENT PAYÉ', async () => {
    const lieu = await app.inject({
      method: 'POST',
      url: '/api/lieux',
      payload: {
        nom: 'La Batte — parcours',
        adresse: null,
        // Aucune coordonnee : le module meteo bascule en mode degrade AVANT
        // toute requete reseau (CLAUDE.md §5). C'est le seul moyen de jouer
        // ce parcours sans jamais appeler Open-Meteo.
        latitude: null,
        longitude: null,
        jourSemaine: 0,
        heureDebut: '07:30',
        heureFin: '14:00',
        tarifEmplacementCents: FRAIS.emplacementCents,
        modeTarification: 'jour',
        metresLineaires: null,
        distanceKm: 12.4,
        facturationElectricite: 'aucune',
        puissanceDisponibleW: null,
        notes: null,
      },
    });
    expect(lieu.statusCode, JSON.stringify(lieu.json())).toBe(201);
    idLieu = lieu.json<{ id: string }>().id;

    const session = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        lieuId: idLieu,
        dateSession: aujourdhui,
        fondsCaisseInitialCents: FONDS_CAISSE_CENTS,
      },
    });
    expect(session.statusCode, JSON.stringify(session.json())).toBe(201);
    idSession = session.json<{ id: string }>().id;

    const stockAvant = schemaEtatStock.parse(
      (await app.inject({ method: 'GET', url: '/api/stock' })).json(),
    );
    const disponibleAvant = new Map(
      stockAvant.data.map((l) => [l.ingredientId, l.quantiteDisponible]),
    );

    const production = await app.inject({
      method: 'POST',
      url: '/api/productions',
      payload: {
        recetteId: idRecette,
        cible: { cible: 'crepes', valeur: CIBLE_CREPES },
        dateProduction: aujourdhui,
        sessionId: idSession,
        notes: 'Fournée du parcours nominal.',
      },
    });
    expect(production.statusCode, JSON.stringify(production.json())).toBe(201);
    const detail = schemaProductionDetail.parse(production.json());
    idProduction = detail.id;

    // Rattachement effectif : sans lui, le cout de la pate se perd et la marge
    // de session est fausse (docs/14 G1/G4).
    expect(detail.sessionId).toBe(idSession);

    /* ── Chaque consommation designe un LOT, jamais un ingredient flottant ── */

    expect(detail.consommations).toHaveLength(3);
    const consoFarine = detail.consommations.find((c) => c.ingredientId === idFarine)!;
    expect(consoFarine.lotId).toBe(idLotFarine);
    expect(consoFarine.numeroLotFournisseur).toBe(RECEPTION_FARINE.lot);

    /*
     * LE CHIFFRE QUI DISCRIMINE. Le cout de la consommation vient du prix
     * unitaire du LOT (689 / 7 333 c/g), pas du tarif catalogue
     * (2 347 / 25 000 c/g). Les deux valeurs sont differentes par
     * construction : une fixture aux prix egaux serait incapable de le voir.
     */
    const prixUnitaireLotFarine = RECEPTION_FARINE.prixLigneCents / RECEPTION_FARINE.quantite;
    const prixUnitaireTarifFarine = TARIF_FARINE.prixCents / TARIF_FARINE.quantiteUniteRef;
    expect(prixUnitaireLotFarine).not.toBe(prixUnitaireTarifFarine);
    expect(consoFarine.coutCents).toBe(
      Math.round(consoFarine.quantiteTheorique * prixUnitaireLotFarine),
    );

    // Le cout matiere theorique de la fournee EST la somme de ses lots.
    expect(detail.coutMatiereTheoriqueCents).toBe(
      detail.consommations.reduce((somme, c) => somme + c.coutCents, 0),
    );

    /* ── Le stock a baisse du BON nombre de grammes, ni plus ni moins ────── */

    const stockApres = schemaEtatStock.parse(
      (await app.inject({ method: 'GET', url: '/api/stock' })).json(),
    );
    for (const conso of detail.consommations) {
      const apres = stockApres.data.find((l) => l.ingredientId === conso.ingredientId)!;
      expect(apres.quantiteDisponible, `stock de ${conso.nomIngredient} après production`).toBe(
        disponibleAvant.get(conso.ingredientId)! - conso.quantiteTheorique,
      );
    }

    // La pate porte son propre numero de lot : c'est le pivot de la
    // tracabilite bidirectionnelle (CLAUDE.md §3 regle 6).
    expect(detail.numeroLotPate.trim()).not.toBe('');
  });

  it('étape 6 — la clôture reprend le coût matière de la production, sans ressaisie', async () => {
    const produit = await app.inject({
      method: 'POST',
      url: '/api/produits',
      payload: {
        nom: 'Crêpe sucre',
        nature: 'transforme',
        recetteId: idRecette,
        ingredientId: null,
        prixCents: PRIX_CREPE_CENTS,
        consommationUnite: 'crepes',
        nbCrepes: 1,
        categorie: 'crepe',
        consommationSurPlace: true,
      },
    });
    expect(produit.statusCode, JSON.stringify(produit.json())).toBe(201);
    idProduitCrepe = produit.json<{ id: string }>().id;

    const productionAvant = schemaProductionDetail.parse(
      (await app.inject({ method: 'GET', url: `/api/productions/${idProduction}` })).json(),
    );
    const coutProductionCents = productionAvant.coutMatiereTheoriqueCents;
    const crepesProduites = productionAvant.crepesTheoriques;

    const caAttenduCents = QUANTITE_VENDUE * PRIX_CREPE_CENTS;
    const cloture = await app.inject({
      method: 'POST',
      url: `/api/sessions/${idSession}/cloturer`,
      payload: {
        ventes: [
          {
            produitVenteId: idProduitCrepe,
            quantite: QUANTITE_VENDUE,
            prixUnitaireCents: PRIX_CREPE_CENTS,
          },
        ],
        frais: FRAIS,
        fondsCaisseInitialCents: FONDS_CAISSE_CENTS,
        // Caisse rapprochee au centime : l'ecart doit valoir exactement zero.
        especesCompteesCents: FONDS_CAISSE_CENTS + (caAttenduCents - CA_CARTE_CENTS),
        caCarteCents: CA_CARTE_CENTS,
        // `crepesProduites` volontairement ABSENT : il doit se DERIVER de la
        // production rattachee. Le renseigner serait une ressaisie — exactement
        // ce que CLAUDE.md §0 interdit.
        crepesInvendues: crepesProduites - QUANTITE_VENDUE - CREPES_CASSEES,
        crepesCassees: CREPES_CASSEES,
        heureDebutReelle: '07:30',
        heureFinReelle: '14:00',
        nbTickets: 24,
      },
    });
    expect(cloture.statusCode, JSON.stringify(cloture.json())).toBe(200);
    const resultat = schemaResultatCloture.parse(cloture.json());

    /* ── Le CA est la somme des lignes, jamais un total saisi ────────────── */

    expect(resultat.caTotalCents).toBe(caAttenduCents);
    expect(resultat.caTotalCents).toBe(
      resultat.ventes.reduce((somme, v) => somme + v.montantCents, 0),
    );

    /* ── LE MAILLON CENTRAL : le cout matiere de la session EST celui de la
       production rattachee. Une production non branchee donnerait 0 ici — et
       une marge brute de 100 %, sans que rien ne le signale. ───────────── */

    expect(resultat.coutMatiereCents).toBe(coutProductionCents);
    // Corollaire : ce chiffre remonte, sans ressaisie, jusqu'au prix paye au
    // meunier a l'etape 3.
    expect(resultat.coutMatiereCents).toBeGreaterThan(0);

    /* ── Les crepes produites viennent de la production, pas du formulaire ─ */

    expect(resultat.crepesProduites).toBe(crepesProduites);

    /* ── La marge nette se DEDUIT, elle ne se saisit pas ─────────────────── */

    const fraisTotauxCents =
      FRAIS.emplacementCents +
      FRAIS.deplacementCents +
      FRAIS.gazCents +
      FRAIS.diversCents +
      resultat.fraisEnergieCents;
    expect(resultat.margeBruteCents).toBe(resultat.caTotalCents! - resultat.coutMatiereCents!);
    expect(resultat.margeNetteCents).toBe(
      resultat.margeBruteCents! - fraisTotauxCents - resultat.commissionCarteCents!,
    );

    // Les quatre frais SAISIS ressortent au centime, chacun dans sa categorie.
    expect(resultat.fraisEmplacementCents).toBe(FRAIS.emplacementCents);
    expect(resultat.fraisDeplacementCents).toBe(FRAIS.deplacementCents);
    expect(resultat.fraisGazCents).toBe(FRAIS.gazCents);
    expect(resultat.fraisDiversCents).toBe(FRAIS.diversCents);

    // Caisse rapprochee au centime.
    expect(resultat.ecartCaisseCents).toBe(0);
    expect(resultat.caEspecesCents).toBe(caAttenduCents - CA_CARTE_CENTS);

    // Session 100 % transformee : la ventilation doit le dire, et rien ne doit
    // se perdre entre les deux natures (CLAUDE.md §6).
    expect(resultat.caTransformeCents).toBe(caAttenduCents);
    expect(resultat.caRevenduCents).toBe(0);
  });

  it('étape 7 — les compteurs de seuils légaux bougent du montant exact de la session', async () => {
    const seuils = schemaTableauSeuils.parse(
      (await app.inject({ method: 'GET', url: '/api/seuils' })).json(),
    );

    const caAttenduCents = QUANTITE_VENDUE * PRIX_CREPE_CENTS;

    expect(seuils.meta.sessionsTenues).toBe(1);
    expect(seuils.meta.caTransformeCents).toBe(caAttenduCents);
    expect(seuils.meta.caRevenduCents).toBe(0);
    // Part de revendu nulle : c'est CE chiffre qui previent d'une sortie de
    // franchise TVA « sans l'avoir vu venir » (CLAUDE.md §6).
    expect(seuils.meta.partRevenduBp).toBe(0);

    const franchiseTva = seuils.data.find((c) => c.cle.includes('tva'))!;
    expect(franchiseTva.realiseCents).toBe(caAttenduCents);
    // Le pourcentage se DEDUIT du plafond parametre, jamais d'une constante.
    expect(franchiseTva.partBp).toBe(
      Math.round((caAttenduCents * 10_000) / franchiseTva.plafondCents),
    );
    // Une seule session : trop tot pour alerter.
    expect(franchiseTva.partBp).toBeLessThan(seuils.meta.seuilAlerteBp);
  });

  it('étape 8 — le lot reçu au premier geste est traçable dans le registre AFSCA (amont)', async () => {
    const amont = schemaTracabiliteAmontSession.parse(
      (
        await app.inject({ method: 'GET', url: `/api/afsca/tracabilite/sessions/${idSession}` })
      ).json(),
    );

    expect(amont.sessionId).toBe(idSession);
    expect(amont.productions).toHaveLength(1);

    const consoFarine = amont.productions[0]!.consommations.find(
      (c) => c.ingredientId === idFarine,
    )!;

    /*
     * LA PROMESSE DE CLAUDE.md §0, VERIFIEE BOUT A BOUT : le numero de lot
     * fournisseur saisi a l'etape 3, sur le bon de livraison du meunier, se
     * retrouve dans le registre d'autocontrole de la session close a
     * l'etape 6 — sans une seule ressaisie entre les deux.
     */
    expect(consoFarine.numeroLotFournisseur).toBe(RECEPTION_FARINE.lot);
    expect(consoFarine.fournisseurNom).toBe('Moulin de Hollogne');
    expect(consoFarine.receptionNumero).toBe(numeroReception);
    expect(consoFarine.receptionStatut).toBe('active');
    expect(consoFarine.dateDlc).toBe(jourDecale(187));

    // Les trois lots recus sont tous traces : aucun ingredient ne disparait.
    expect(amont.productions[0]!.consommations.map((c) => c.numeroLotFournisseur).sort()).toEqual(
      [RECEPTION_FARINE.lot, RECEPTION_LAIT.lot, RECEPTION_OEUFS.lot].sort(),
    );
  });

  it('étape 9 — depuis le lot du meunier, on retrouve la session (aval) : le rappel sanitaire est possible', async () => {
    const aval = schemaTracabiliteAvalLot.parse(
      (
        await app.inject({ method: 'GET', url: `/api/afsca/tracabilite/lots/${idLotFarine}` })
      ).json(),
    );

    expect(aval.lotId).toBe(idLotFarine);
    expect(aval.numeroLotFournisseur).toBe(RECEPTION_FARINE.lot);
    expect(aval.receptionNumero).toBe(numeroReception);
    expect(aval.statut).toBe('disponible');

    expect(aval.productions).toHaveLength(1);
    const production = aval.productions[0]!;
    expect(production.productionId).toBe(idProduction);
    // Le numero de LOT DE PATE : c'est lui qui rend la tracabilite
    // bidirectionnelle (« quel lot de pate est issu du lot rappele ? »).
    expect(production.numeroLotPate.trim()).not.toBe('');
    // Et la session ou cette pate est partie.
    expect(production.session).not.toBeNull();
    expect(production.session!.id).toBe(idSession);
  });

  it('étape 10 — le grand livre de stock reste cohérent : aucun UPDATE de quantité', async () => {
    const diagnostic = (await app.inject({ method: 'GET', url: '/api/stock/integrite' })).json<{
      coherent: boolean;
      nbLotsVerifies: number;
      lotsFautifs: unknown[];
    }>();

    // CLAUDE.md §3 regle 5 : le stock EST la somme des mouvements. Ce
    // diagnostic est ce qui le prouve, lot par lot.
    expect(diagnostic.coherent).toBe(true);
    expect(diagnostic.nbLotsVerifies).toBe(3);
    expect(diagnostic.lotsFautifs).toEqual([]);
  });

  it('étape 11 — la réception d’origine reste retrouvable depuis le lot (bouclage du chemin de correction)', async () => {
    const lot = (await app.inject({ method: 'GET', url: `/api/lots/${idLotFarine}` })).json<{
      receptionId: string;
      receptionNumero: string;
      receptionNbLots: number;
    }>();

    // Sans ce champ, aucun ecran ne peut appeler `POST /receptions/:id/annuler`
    // — le maillon de correction serait correct mais inatteignable.
    expect(lot.receptionId).toBe(idReception);
    expect(lot.receptionNumero).toBe(numeroReception);
    expect(lot.receptionNbLots).toBe(3);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Prolongement du parcours : l'ÉCART THÉORIQUE / RÉEL du coût matière.

   CLAUDE.md §0 range « Comptabilité analytique — coût de revient réel, marge
   par axe, ÉCART THÉORIQUE/RÉEL » parmi les modules du produit. Ce second
   marché exerce précisément cet axe : le porteur déclare avoir réellement
   consommé plus de farine que la recette ne le prévoyait, et on suit le
   chiffre jusqu'au bout de la chaîne.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('parcours nominal (suite) — la sur-consommation réelle, du bac à la comptabilité', () => {
  /** Sur-consommation déclarée : une louche trop généreuse, en grammes non ronds. */
  const SURCONSOMMATION_G = 317;
  /** Second bon de livraison — prix ET DLC volontairement différents du premier. */
  const RECEPTION_2 = {
    farine: { quantite: 9_733, prixLigneCents: 913, lot: 'FAR-2026-B' },
    lait: { quantite: 6_211, prixLigneCents: 787, lot: 'LAI-2026-B' },
    oeufs: { quantite: 41, prixLigneCents: 869, lot: 'OEU-2026-B' },
  };

  let idSession2 = '';
  let idProduction2 = '';
  let coutTheoriqueCents = 0;
  let quantiteFarineTheorique = 0;
  let coutMatiereSessionCents = 0;

  it('étape 12 — un second réapprovisionnement, à un prix DIFFÉRENT du premier', async () => {
    /*
     * Prix volontairement différent du premier bon de livraison : sans cela,
     * on ne saurait pas dire si le coût de la seconde fournée vient du second
     * lot ou du premier — deux lots au même prix sont une fixture aveugle.
     */
    const reception = await app.inject({
      method: 'POST',
      url: '/api/receptions',
      payload: {
        fournisseurId: idFournisseur,
        dateReception: aujourdhui,
        numeroBonLivraison: 'BL-HOLLOGNE-4418',
        lignes: [
          {
            ingredientId: idFarine,
            quantite: RECEPTION_2.farine.quantite,
            prixLigneCents: RECEPTION_2.farine.prixLigneCents,
            numeroLotFournisseur: RECEPTION_2.farine.lot,
            // DLC PLUS PROCHE que celle du premier lot (J+187) : la FEFO doit
            // donc servir CE lot-ci en priorité, alors qu'il arrive en second.
            dateDlc: jourDecale(31),
          },
          {
            ingredientId: idLait,
            quantite: RECEPTION_2.lait.quantite,
            prixLigneCents: RECEPTION_2.lait.prixLigneCents,
            numeroLotFournisseur: RECEPTION_2.lait.lot,
            dateDlc: jourDecale(11),
          },
          {
            ingredientId: idOeufs,
            quantite: RECEPTION_2.oeufs.quantite,
            prixLigneCents: RECEPTION_2.oeufs.prixLigneCents,
            numeroLotFournisseur: RECEPTION_2.oeufs.lot,
            dateDlc: jourDecale(25),
          },
        ],
      },
    });
    expect(reception.statusCode, reception.payload).toBe(201);
    expect(schemaReceptionCreee.parse(reception.json()).nbLots).toBe(3);

    // Prix unitaires réellement distincts entre les deux réceptions.
    expect(RECEPTION_2.farine.prixLigneCents / RECEPTION_2.farine.quantite).not.toBe(
      RECEPTION_FARINE.prixLigneCents / RECEPTION_FARINE.quantite,
    );
  });

  it('étape 13 — la fournée sert le lot à DLC la plus proche, et le stock baisse d’autant', async () => {
    idSession2 = (
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          lieuId: idLieu,
          dateSession: jourDecale(7),
          fondsCaisseInitialCents: FONDS_CAISSE_CENTS,
        },
      })
    ).json<{ id: string }>().id;

    const stockAvant = schemaEtatStock.parse(
      (await app.inject({ method: 'GET', url: '/api/stock' })).json(),
    );
    const farineAvant = stockAvant.data.find(
      (l) => l.ingredientId === idFarine,
    )!.quantiteDisponible;

    const production = await app.inject({
      method: 'POST',
      url: '/api/productions',
      payload: {
        recetteId: idRecette,
        cible: { cible: 'crepes', valeur: CIBLE_CREPES },
        dateProduction: jourDecale(7),
        sessionId: idSession2,
        notes: 'Seconde fournée : la louche a été généreuse.',
      },
    });
    expect(production.statusCode, production.payload).toBe(201);
    const detail = schemaProductionDetail.parse(production.json());
    idProduction2 = detail.id;
    coutTheoriqueCents = detail.coutMatiereTheoriqueCents;

    const consoFarine = detail.consommations.find((c) => c.ingredientId === idFarine)!;
    quantiteFarineTheorique = consoFarine.quantiteTheorique;
    // FEFO : c'est le lot B, plus proche de la péremption, qui est servi —
    // alors que le lot A a été reçu en premier et reste largement suffisant.
    expect(consoFarine.numeroLotFournisseur).toBe(RECEPTION_2.farine.lot);

    const stockApres = schemaEtatStock.parse(
      (await app.inject({ method: 'GET', url: '/api/stock' })).json(),
    );
    expect(stockApres.data.find((l) => l.ingredientId === idFarine)!.quantiteDisponible).toBe(
      farineAvant - quantiteFarineTheorique,
    );
  });

  it('étape 14 — la sur-consommation déclarée sort RÉELLEMENT du stock, en un mouvement tracé', async () => {
    const stockAvant = schemaEtatStock.parse(
      (await app.inject({ method: 'GET', url: '/api/stock' })).json(),
    );
    const farineAvant = stockAvant.data.find(
      (l) => l.ingredientId === idFarine,
    )!.quantiteDisponible;

    const avant = schemaProductionDetail.parse(
      (await app.inject({ method: 'GET', url: `/api/productions/${idProduction2}` })).json(),
    );

    const realise = await app.inject({
      method: 'PATCH',
      url: `/api/productions/${idProduction2}/realise`,
      payload: {
        volumeReelMl: avant.volumeTheoriqueMl,
        crepesReelles: avant.crepesTheoriques,
        ecartMotif: 'Louche trop généreuse à la première dizaine.',
        consommationsReelles: [
          { ingredientId: idFarine, quantiteReelle: quantiteFarineTheorique + SURCONSOMMATION_G },
        ],
      },
    });
    expect(realise.statusCode, realise.payload).toBe(200);
    const apres = schemaProductionDetail.parse(realise.json());

    // L'écart déclaré devient un VRAI mouvement de stock (CLAUDE.md §3
    // règle 5 : le stock ne se modifie que par un mouvement).
    const stockApres = schemaEtatStock.parse(
      (await app.inject({ method: 'GET', url: '/api/stock' })).json(),
    );
    expect(stockApres.data.find((l) => l.ingredientId === idFarine)!.quantiteDisponible).toBe(
      farineAvant - SURCONSOMMATION_G,
    );

    // La consommation porte désormais les DEUX quantités : le théorique reste
    // lisible à côté du réel, jamais écrasé par lui.
    const consoFarine = apres.consommations.find((c) => c.ingredientId === idFarine)!;
    expect(consoFarine.quantiteTheorique).toBe(quantiteFarineTheorique);
    expect(consoFarine.quantiteReelle).toBe(quantiteFarineTheorique + SURCONSOMMATION_G);
  });

  it('étape 15 — la clôture facture le coût RÉEL, pas le théorique : la marge s’en trouve réduite', async () => {
    const caAttenduCents = QUANTITE_VENDUE * PRIX_CREPE_CENTS;
    const productionAvant = schemaProductionDetail.parse(
      (await app.inject({ method: 'GET', url: `/api/productions/${idProduction2}` })).json(),
    );

    const cloture = await app.inject({
      method: 'POST',
      url: `/api/sessions/${idSession2}/cloturer`,
      payload: {
        ventes: [
          {
            produitVenteId: idProduitCrepe,
            quantite: QUANTITE_VENDUE,
            prixUnitaireCents: PRIX_CREPE_CENTS,
          },
        ],
        frais: FRAIS,
        fondsCaisseInitialCents: FONDS_CAISSE_CENTS,
        especesCompteesCents: FONDS_CAISSE_CENTS + (caAttenduCents - CA_CARTE_CENTS),
        caCarteCents: CA_CARTE_CENTS,
        crepesInvendues:
          (productionAvant.crepesReelles ?? productionAvant.crepesTheoriques) -
          QUANTITE_VENDUE -
          CREPES_CASSEES,
        crepesCassees: CREPES_CASSEES,
        heureDebutReelle: '07:30',
        heureFinReelle: '14:00',
      },
    });
    expect(cloture.statusCode, cloture.payload).toBe(200);
    const resultat = schemaResultatCloture.parse(cloture.json());
    coutMatiereSessionCents = resultat.coutMatiereCents!;

    /*
     * LE CHIFFRE QUI PROUVE QUE LE MAILLON EST BRANCHÉ. La comptabilité de la
     * session retient le coût RÉEL de la fournée — donc STRICTEMENT PLUS que
     * le théorique, puisqu'on vient de déclarer 317 g de farine en trop.
     */
    expect(coutMatiereSessionCents).toBeGreaterThan(coutTheoriqueCents);

    /*
     * ET L'ÉCART VAUT EXACTEMENT LA FARINE SUPPLÉMENTAIRE, valorisée au prix
     * du LOT qui l'a fournie — pas au tarif catalogue, pas au prix du lot A.
     *
     * ARRONDI : DEUX MOUVEMENTS, DONC DEUX ARRONDIS, ET C'EST JUSTE. La
     * sur-consommation est un mouvement de stock DISTINCT de la consommation
     * d'origine (CLAUDE.md §3 règle 5), et chaque mouvement porte un coût en
     * centimes ENTIERS (règle 3) : un mouvement à 29,73 c n'existe pas. Le
     * coût facturé est donc la SOMME DU GRAND LIVRE — `round(théorique × pu)`
     * puis `round(écart × pu)` — et non un arrondi unique du total réel, qui
     * donnerait ici un centime de moins. Les deux sont écrits ci-dessous : le
     * premier est celui qui doit sortir, et la ligne `not.toBe` garantit que
     * ce parcours saurait voir la différence si la doctrine changeait.
     */
    const prixUnitaireLotB = RECEPTION_2.farine.prixLigneCents / RECEPTION_2.farine.quantite;
    const coutAutresIngredientsCents = productionAvant.consommations
      .filter((c) => c.ingredientId !== idFarine)
      .reduce((somme, c) => somme + c.coutCents, 0);

    const coutSelonGrandLivreCents =
      Math.round(quantiteFarineTheorique * prixUnitaireLotB) +
      Math.round(SURCONSOMMATION_G * prixUnitaireLotB) +
      coutAutresIngredientsCents;
    const coutSiArrondiUniqueCents =
      Math.round((quantiteFarineTheorique + SURCONSOMMATION_G) * prixUnitaireLotB) +
      coutAutresIngredientsCents;

    expect(coutMatiereSessionCents).toBe(coutSelonGrandLivreCents);
    expect(coutSelonGrandLivreCents).not.toBe(coutSiArrondiUniqueCents);
    expect(coutMatiereSessionCents).not.toBe(coutSiArrondiUniqueCents);
  });

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * DÉFAUT RÉEL TROUVÉ PAR CE PARCOURS — **CORRIGÉ le 01/08/2026**, dans
   * l'heure qui a suivi sa découverte.
   *
   * Il avait été encodé en `it.fails` parce que la correction vivait hors de
   * la zone d'écriture de l'agent qui l'a trouvé. Ce `it.fails` a fait
   * exactement ce pour quoi il existait : dès le champ ajouté au contrat et au
   * dépôt, il est passé AU ROUGE (« Expect test to fail ») et a signalé de
   * lui-même qu'il devait redevenir un test ordinaire. C'est la bonne façon
   * d'encoder un défaut connu — un commentaire, lui, se serait périmé en
   * silence.
   *
   * CE QUI ÉTAIT CASSÉ. `production.cout_matiere_reel_cents`
   * (`packages/db/src/schema.ts:788`) était ÉCRIT par `saisirRealise`
   * (`packages/db/src/services/production.ts:690`) et LU par la clôture
   * (`packages/db/src/services/sessions.ts:988`, qui vient de facturer le coût
   * réel à l'étape 15) — mais il n'était rendu par AUCUNE route :
   * `lireProductionDetail` (`packages/db/src/depots/productions.ts`) ne le
   * sélectionnait pas, et `schemaProductionDetail` / `schemaProductionResume`
   * (`packages/core/src/contrats/productions.ts`) ne le déclaraient pas.
   *
   * CONSÉQUENCE MESURÉE, PAS SUPPOSÉE. L'écran Production affichait
   * `coutMatiereTheoriqueCents`, la comptabilité de session facturait le coût
   * réel, et l'écart entre les deux n'était visible NULLE PART. Pire : la
   * ligne de consommation affiche `quantiteReelle` À CÔTÉ d'un `coutCents`
   * resté théorique — une quantité et un coût qui ne se correspondent pas.
   *
   * POURQUOI C'ÉTAIT PLUS QU'UN CHAMP MANQUANT. CLAUDE.md §0 range « écart
   * théorique/réel » parmi les modules du produit. L'écart de RENDEMENT était
   * bien exposé (`ecartRendementBp`) ; l'écart de COÛT, lui, était calculé,
   * persisté, facturé — et invisible. C'est la définition même du maillon
   * correct qui n'est branché à rien, et aucun test unitaire de
   * `saisirRealise` ne pouvait le voir : la valeur EST bien écrite en base.
   * Seul un parcours de bout en bout pouvait le trouver.
   *
   * CE QUI RESTE OUVERT, et que ce test ne couvre pas : `coutCents` de chaque
   * ligne de consommation reste THÉORIQUE à côté d'une `quantiteReelle`. Le
   * total est désormais juste ; le détail ligne à ligne, non.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('le coût matière RÉEL est exposé, et vaut ce que la session a facturé', async () => {
    const detail = (
      await app.inject({ method: 'GET', url: `/api/productions/${idProduction2}` })
    ).json<Record<string, unknown>>();

    // Le champ traverse bien la frontière HTTP : un champ fourni par le dépôt
    // mais non déclaré au contrat Zod y serait supprimé SILENCIEUSEMENT.
    expect(Object.keys(detail)).toContain('coutMatiereReelCents');
    // Et il vaut EXACTEMENT ce que la session a facturé — le rapprochement
    // qui était impossible avant le 01/08/2026.
    expect(detail.coutMatiereReelCents).toBe(coutMatiereSessionCents);
    // Il diffère du théorique : sans ça, le test passerait aussi bien sur une
    // production sans sur-consommation, donc ne discriminerait rien.
    expect(detail.coutMatiereReelCents).not.toBe(detail.coutMatiereTheoriqueCents);
  });
});
