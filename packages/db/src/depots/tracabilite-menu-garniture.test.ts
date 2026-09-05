/**
 * Traçabilité — garniture consommée via un COMPOSANT DE MENU.
 *
 * Audit AFSCA dédié du 30/07/2026 (mission « registre AFSCA et traçabilité »).
 *
 * CONTEXTE. Le « Trou 2 » corrigé cette même nuit dans `services/sessions.ts`
 * fait désormais sortir du stock les garnitures des composants d'un menu (un
 * sirop ou une crêpe garnie vendus SEULEMENT à travers un menu sortent bien de
 * leur lot, voir `sortirLesGarnitures`/`exploserLigneMenu`). Restait à
 * vérifier que la TRAÇABILITÉ elle-même range cette sortie au bon endroit.
 *
 * DÉFAUT TROUVÉ ET CORRIGÉ ICI : `produitsGarnisDeLaSession`
 * (`packages/db/src/depots/tracabilite.ts`) ne regardait QUE `session_vente`
 * pour savoir quels produits garnis avaient été vendus ce jour-là. Or
 * `cloturerSession` n'écrit une ligne `session_vente` que pour le produit
 * VENDU DIRECTEMENT — le menu-conteneur — jamais pour ses composants
 * (`packages/db/src/services/sessions.ts`, boucle `for (const vente of
 * entree.ventes)`). Un produit garni vendu UNIQUEMENT à l'intérieur d'un menu
 * (jamais en ligne directe) ne portait donc aucune ligne `session_vente` sous
 * son propre identifiant : la jointure de `produitsGarnisDeLaSession` le
 * ratait, et la sortie de sa garniture — pourtant bien réelle en stock —
 * retombait dans le bloc « revendus » de la traçabilité amont ET aval, au lieu
 * du bloc « garnitures ». C'est exactement la distinction qui décide de la
 * portée d'un rappel (le client d'un pot fermé détient un numéro de lot,
 * celui d'une crêpe garnie ne détient rien — voir la doc de
 * `TracabiliteGarniture`) : la perdre est un vrai défaut de traçabilité, pas
 * un détail d'affichage.
 *
 * Corrigé en faisant regarder à `produitsGarnisDeLaSession` aussi les
 * composants ACTIFS des menus vendus ce jour-là, en plus des produits vendus
 * directement.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { fournisseur, lieuMarche, produitGarniture, produitVente } from '../schema.js';
import { creerProduit } from './referentiel.js';
import { creerCompositionMenu } from './menus.js';
import { tracabiliteAmontSession, tracabiliteAvalLot } from './tracabilite.js';
import { enregistrerReception } from '../services/reception.js';
import { cloturerSession, creerSession } from '../services/sessions.js';

describe('Traçabilité — garniture consommée via un composant de menu (jamais vendu seul)', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idFournisseur: string;
  let garni: {
    produitId: string;
    nomProduit: string;
    ingredientId: string;
    quantiteParUnite: number;
    nbCrepes: number;
  };
  let idMenu: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    // Référentiel de démonstration : fournit un produit transformé déjà garni
    // (`produit_garniture`), sans qu'il soit besoin de reconstruire recette,
    // conditionnement et garniture à la main pour ce test.
    seedDemonstration(base);

    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;

    const ligne = base
      .select({
        produitId: produitVente.id,
        nomProduit: produitVente.nom,
        ingredientId: produitGarniture.ingredientId,
        quantiteParUnite: produitGarniture.quantiteUniteRef,
        nbCrepes: produitVente.nbCrepes,
      })
      .from(produitGarniture)
      .innerJoin(produitVente, eq(produitVente.id, produitGarniture.produitVenteId))
      .get();
    if (ligne === undefined || ligne.nbCrepes === null) {
      throw new Error('La graine ne rattache aucune garniture à un produit transformé.');
    }
    garni = { ...ligne, nbCrepes: ligne.nbCrepes };

    // Stock de la garniture : sans réception, la sortie ne ferait qu'un écart
    // et aucun mouvement — ce test doit prouver la CLASSIFICATION d'une
    // sortie réelle, pas l'écart de stock (déjà couvert ailleurs).
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-20',
      lignes: [
        {
          ingredientId: garni.ingredientId,
          quantite: garni.quantiteParUnite * 10,
          prixLigneCents: 500,
          numeroLotFournisseur: 'LOT-GARNITURE-MENU-01',
          dateDlc: '2027-01-01',
        },
      ],
    });

    // Un menu qui contient le produit garni comme SEUL composant : ce produit
    // n'est vendu, dans ce test, QUE via ce menu — jamais en ligne directe.
    idMenu = creerProduit(base, {
      nom: 'Menu test — composant garni jamais vendu seul',
      nature: 'menu',
      recetteId: null,
      ingredientId: null,
      prixCents: 500,
      nbCrepes: null,
      volumeMlParUnite: null,
      categorie: 'menu',
      consommationSurPlace: false,
    });
    creerCompositionMenu(base, idMenu, { produitInclusId: garni.produitId, quantite: 1 });
  });

  /** Clôture une session qui ne vend QUE le menu, jamais le produit garni seul. */
  function cloturerUneVenteDeMenu(dateSession: string): string {
    const session = creerSession(base, { lieuId: idLieu, dateSession });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idMenu, quantite: 1, prixUnitaireCents: 500 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 500,
      caCarteCents: 0,
      // Aucune production rattachée à cette session : le réalisé doit être
      // déclaré, et doit correspondre exactement à ce qu'exploserLigneMenu
      // dérive du composant garni (1 menu × 1 composant × son propre nbCrepes).
      crepesProduites: garni.nbCrepes,
      crepesInvendues: 0,
      crepesCassees: 0,
    });
    return session.id;
  }

  it('classe la sortie de la garniture en GARNITURE, jamais en revendu, même vendue uniquement via un menu', () => {
    const sessionId = cloturerUneVenteDeMenu('2026-07-27');

    const amont = tracabiliteAmontSession(base, sessionId);

    const enGarniture = amont.garnitures.find((g) => g.ingredientId === garni.ingredientId);
    expect(
      enGarniture,
      "la garniture d'un produit vendu uniquement via un menu doit apparaître dans le " +
        'bloc garnitures de la traçabilité amont, pas se perdre dans les revendus',
    ).toBeDefined();
    expect(enGarniture!.produits).toContain(garni.nomProduit);

    // Et surtout : elle ne doit PAS se glisser dans les marchandises
    // revendues, sous peine de perdre la distinction qui décide de la portée
    // d'un rappel (le client d'une crêpe garnie n'a aucun numéro de lot).
    expect(amont.revendus.some((r) => r.ingredientId === garni.ingredientId)).toBe(false);
  });

  it('la traçabilité aval du lot de garniture classe aussi la sortie en garniture, avec le produit porteur nommé', () => {
    const sessionId = cloturerUneVenteDeMenu('2026-07-27');
    const amont = tracabiliteAmontSession(base, sessionId);
    const enGarniture = amont.garnitures.find((g) => g.ingredientId === garni.ingredientId);
    if (enGarniture === undefined) {
      throw new Error('Pré-condition du test amont non remplie : voir le test précédent.');
    }

    const aval = tracabiliteAvalLot(base, enGarniture.lotId);

    expect(aval.garnitures.map((g) => g.session.id)).toContain(sessionId);
    expect(aval.ventes.map((v) => v.session.id)).not.toContain(sessionId);

    const ligneAval = aval.garnitures.find((g) => g.session.id === sessionId);
    expect(ligneAval).toBeDefined();
    expect(ligneAval!.produits).toContain(garni.nomProduit);
  });
});

/**
 * Symétrique du bloc ci-dessus, pour l'exemple LITTÉRAL cité par la mission :
 * « un sirop vendu dans un menu sort maintenant du stock ». Ce produit REVENDU
 * (pas de garniture en jeu) n'était pas concerné par le défaut de classement
 * corrigé plus haut — `produitsGarnisDeLaSession` ne s'applique qu'aux
 * garnitures, un revendu qui n'y figure jamais tombe déjà correctement dans
 * `revendus`/`ventes`. Ce test le PROUVE plutôt que de le supposer : la
 * traçabilité d'un article revendu vendu uniquement via un menu doit rester
 * dans le bon panier, avec le bon numéro de lot fournisseur.
 */
describe('Traçabilité — produit REVENDU consommé via un composant de menu (jamais vendu seul)', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idFournisseur: string;
  let revendu: { produitId: string; nomProduit: string; ingredientId: string };
  let idMenu: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;

    const ligne = base
      .select({
        produitId: produitVente.id,
        nomProduit: produitVente.nom,
        ingredientId: produitVente.ingredientId,
      })
      .from(produitVente)
      .where(eq(produitVente.nature, 'revendu'))
      .get();
    if (ligne === undefined || ligne.ingredientId === null) {
      throw new Error('La graine ne fournit aucun produit revendu.');
    }
    revendu = {
      produitId: ligne.produitId,
      nomProduit: ligne.nomProduit,
      ingredientId: ligne.ingredientId,
    };

    // Stock du produit revendu (le sirop) : sans réception, la sortie ne
    // ferait qu'un écart et aucun mouvement.
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-20',
      lignes: [
        {
          ingredientId: revendu.ingredientId,
          quantite: 10,
          prixLigneCents: 5000,
          numeroLotFournisseur: 'LOT-REVENDU-MENU-01',
          dateDlc: '2027-01-01',
        },
      ],
    });

    // Le sirop n'est vendu, dans ce test, QUE via ce menu — jamais tel quel.
    idMenu = creerProduit(base, {
      nom: 'Menu test — produit revendu jamais vendu seul',
      nature: 'menu',
      recetteId: null,
      ingredientId: null,
      prixCents: 750,
      nbCrepes: null,
      volumeMlParUnite: null,
      categorie: 'menu',
      consommationSurPlace: false,
    });
    creerCompositionMenu(base, idMenu, { produitInclusId: revendu.produitId, quantite: 1 });
  });

  it('classe la sortie du produit revendu en VENTES, jamais en garniture, même vendue uniquement via un menu', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-07-27' });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idMenu, quantite: 1, prixUnitaireCents: 750 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 750,
      caCarteCents: 0,
      // Un revendu ne consomme aucune crêpe (nbCrepesParUnite = 0) : rien à
      // produire pour cette vente.
      crepesProduites: 0,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    const amont = tracabiliteAmontSession(base, session.id);
    expect(amont.revendus.some((r) => r.ingredientId === revendu.ingredientId)).toBe(true);
    expect(amont.garnitures.some((g) => g.ingredientId === revendu.ingredientId)).toBe(false);

    const venteRevendu = amont.revendus.find((r) => r.ingredientId === revendu.ingredientId);
    if (venteRevendu === undefined) throw new Error('Pré-condition non remplie.');

    const aval = tracabiliteAvalLot(base, venteRevendu.lotId);
    expect(aval.ventes.map((v) => v.session.id)).toContain(session.id);
    expect(aval.garnitures.map((g) => g.session.id)).not.toContain(session.id);
  });
});
