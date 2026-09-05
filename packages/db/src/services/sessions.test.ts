/**
 * Tests d'integration du Lot 4.
 *
 * Critere de fin de docs/04-ROADMAP-LOTS.md : « Je cloture une session, je vois
 * immediatement CA, cout matiere reel, marge nette, marge/heure et l'avancement
 * vers les trois seuils legaux. »
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  ErreurIntrouvable,
  ErreurMetier,
  formaterEuros,
  maintenantUtc,
  nouvelIdentifiant,
  schemaResultatCloture,
} from '@batte/core';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration, NOM_PRODUIT_CAFE } from '../seed/demonstration.js';
import {
  evenement,
  fournisseur,
  ingredient,
  lieuMarche,
  meteoObservation,
  mouvementStock,
  nonConformite,
  periode,
  production,
  produitVente,
  recette,
  releveTemperature,
  sessionMarche,
  sessionVente,
} from '../schema.js';
import { lotsDeLIngredient } from '../depots/stock.js';
import { creerCompositionMenu } from '../depots/menus.js';
import { creerEquipement } from '../depots/equipements.js';
import { enregistrerReception } from './reception.js';
import { lireSessionDetail, listerFraisSession } from '../depots/sessions.js';
import { creerOpportunite, rejeterOpportunite } from '../depots/opportunites.js';
import {
  annulerSession,
  cloturerSession,
  creerSession,
  rattacherEvenementSession,
} from './sessions.js';

const JOUR = '2026-08-02';

describe('Lot 4 — cloture de session', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idCrepe = base.select({ id: produitVente.id }).from(produitVente).get()!.id;
  });

  function cloturerAvec(surcharge: Partial<Parameters<typeof cloturerSession>[2]> = {}) {
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
      fondsCaisseInitialCents: 6000,
      especesCompteesCents: 6000 + 7200,
      caCarteCents: 0,
      crepesProduites: 30,
      crepesInvendues: 5,
      crepesCassees: 1,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
      ...surcharge,
    });
    return session;
  }

  it('critere de fin : CA, marge nette et marge par heure calcules a la cloture', () => {
    const session = cloturerAvec();
    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;

    expect(close.statut).toBe('cloturee');
    expect(close.caTotalCents).toBe(7200);
    // Marge nette = 7200 - 0 (aucune production rattachee) - 4200 de frais.
    expect(close.margeNetteCents).toBe(3000);
    expect(close.crepesVendues).toBe(24);
  });

  it('le fonds de caisse ne compte PAS dans le chiffre d affaires', () => {
    // C'est la correction de l'invariant n°4 : sans elle, l'ecart afficherait
    // +60 € sur une caisse parfaitement juste.
    const session = cloturerAvec();
    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;

    expect(close.fondsCaisseInitialCents).toBe(6000);
    expect(close.especesCompteesCents).toBe(13_200);
    expect(close.caEspecesCents).toBe(7200);
    expect(close.ecartCaisseCents).toBe(0);
  });

  it('signale un manque en caisse', () => {
    const session = cloturerAvec({ especesCompteesCents: 6000 + 6850 });
    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;
    expect(close.ecartCaisseCents).toBe(-350);
  });

  it('ventile le CA transforme et revendu', () => {
    // Les seuils legaux portent sur le CA : sans ventilation, on sort de la
    // franchise TVA sans l'avoir vu venir (CLAUDE.md §6).
    const session = cloturerAvec();
    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;

    expect(close.caTransformeCents).toBe(7200);
    expect(close.caRevenduCents).toBe(0);
  });

  it('laisse le compteur « sur place » a zero pour de la vente a emporter', () => {
    // Un stand sans table n'est pas un service de restauration : le seuil SCE
    // reste a zero, mais il est PORTE (docs/07 §6.7).
    const session = cloturerAvec();
    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;
    expect(close.caSurPlaceCents).toBe(0);
  });

  it('applique la commission carte au seul CA carte', () => {
    const session = cloturerAvec({
      caCarteCents: 7200,
      especesCompteesCents: 6000,
    });
    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;

    // 72,00 € x 1,69 % = 1,22 €
    expect(close.commissionCarteCents).toBe(122);
  });

  it('enregistre une ligne de vente par produit', () => {
    const session = cloturerAvec();
    const lignes = base
      .select()
      .from(sessionVente)
      .where(eq(sessionVente.sessionId, session.id))
      .all();

    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.montantCents).toBe(7200);
  });

  it('respecte l invariant n°3 : CA total == somme des lignes', () => {
    const session = cloturerAvec();
    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;
    const lignes = base
      .select()
      .from(sessionVente)
      .where(eq(sessionVente.sessionId, session.id))
      .all();

    const somme = lignes.reduce((total, l) => total + l.montantCents, 0);
    expect(close.caTotalCents).toBe(somme);
  });

  describe('kilometres reels de la tournee (D-064)', () => {
    // Le fil complet ecran -> service -> base : sans le cablage de
    // `entree.distanceReelleKm` dans le `.set({...})` de `cloturerSession`,
    // ce test rougit — `close.distanceReelleKm` resterait `null` meme saisi.
    it('ecrit les kilometres reels saisis jusque dans la ligne de session', () => {
      const session = cloturerAvec({ distanceReelleKm: 46.8 });
      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;

      expect(close.distanceReelleKm).toBe(46.8);
    });

    // Jamais 0 par defaut : une session close sans ce champ renseigne doit
    // rester `null` (« non renseigne »), pas un deplacement gratuit.
    it('laisse les kilometres reels a null quand ils ne sont pas saisis', () => {
      const session = cloturerAvec();
      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;

      expect(close.distanceReelleKm).toBeNull();
    });

    it('accepte explicitement `null` sans jamais le transformer en 0', () => {
      const session = cloturerAvec({ distanceReelleKm: null });
      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;

      expect(close.distanceReelleKm).toBeNull();
    });
  });

  describe('imputation de la tournee reelle entre la session et les achats (D-064 point 4, Trou 2)', () => {
    // `imputationTourneeDeplacement` (@batte/core) existait, testee, et AUCUN
    // code de production ne l'appelait avant ce correctif : sans le
    // branchement dans `cloturerSession`, `resultat.imputationDeplacement`
    // n'existerait meme pas et ces trois tests rougissent.
    function cloturerAvecLieu(
      idLieuUtilise: string,
      surcharge: Partial<Parameters<typeof cloturerSession>[2]> = {},
    ) {
      const session = creerSession(base, { lieuId: idLieuUtilise, dateSession: JOUR });
      return cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
        fondsCaisseInitialCents: 6000,
        especesCompteesCents: 6000 + 7200,
        caCarteCents: 0,
        crepesProduites: 30,
        crepesInvendues: 5,
        crepesCassees: 1,
        heureDebutReelle: '08:00',
        heureFinReelle: '14:30',
        ...surcharge,
      });
    }

    it(
      'separe la part session de la part achats sur un detour reel, au forfait officiel ' +
        '(0,4761 €/km — aucun plein enregistre dans ce test, donc pas de mesure)',
      () => {
        const maintenant = maintenantUtc();
        const idLieuAvecDistance = nouvelIdentifiant();
        base
          .insert(lieuMarche)
          .values({
            id: idLieuAvecDistance,
            nom: 'Lieu avec distance de reference',
            jourSemaine: 0,
            heureDebut: '08:00',
            heureFin: '14:30',
            actif: true,
            distanceKm: 20,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        // Tournee reelle de 55 km, alors que la session seule (aller-retour sur
        // la distance de reference de 20 km) n'en vaut que 40 : 15 km de
        // detour, causes par un passage chez un fournisseur ou un second
        // marche (D-064).
        const resultat = cloturerAvecLieu(idLieuAvecDistance, { distanceReelleKm: 55 });

        expect(resultat.imputationDeplacement.coutTotalReelCents).toBe(2619);
        expect(resultat.imputationDeplacement.coutDetourAchatsCents).toBe(714);
        // Derivee par SOUSTRACTION (2619 - 714), jamais arrondie separement :
        // 40 km x 0,4761 €/km arrondis seuls auraient rendu 1904, pas 1905.
        expect(resultat.imputationDeplacement.coutSessionCents).toBe(1905);
        expect(
          resultat.imputationDeplacement.coutSessionCents! +
            resultat.imputationDeplacement.coutDetourAchatsCents!,
        ).toBe(resultat.imputationDeplacement.coutTotalReelCents);
      },
    );

    it('rend les trois valeurs a `null` quand la distance reelle n’est pas saisie', () => {
      const resultat = cloturerAvecLieu(idLieu);
      expect(resultat.imputationDeplacement).toEqual({
        coutSessionCents: null,
        coutDetourAchatsCents: null,
        coutTotalReelCents: null,
      });
    });

    it(
      'connait le total reel mais ne separe pas les deux parts quand le lieu n’a pas de ' +
        'distance de reference',
      () => {
        // `idLieu` (bloc englobant) n'a PAS de `distanceKm` : la separation est
        // impossible, mais le total, lui, ne depend que de la mesure reelle et
        // du tarif kilometrique — il reste connu (cas 2 de
        // `imputationTourneeDeplacement`).
        const resultat = cloturerAvecLieu(idLieu, { distanceReelleKm: 30 });
        expect(resultat.imputationDeplacement.coutSessionCents).toBeNull();
        expect(resultat.imputationDeplacement.coutDetourAchatsCents).toBeNull();
        expect(resultat.imputationDeplacement.coutTotalReelCents).toBe(1428);
      },
    );

    // Migration 0027 (porteur) a ajoute trois colonnes miroir sur
    // `session_marche`. Sans leur ecriture dans le `.set({...})` de
    // `cloturerSession`, ces trois tests rougissent : la reponse de cloture
    // calculait deja `imputationDeplacement`, mais rien ne la persistait — un
    // second appel (un GET ulterieur, ou une simple relecture de la table) ne
    // retrouvait jamais ce qui venait d'etre calcule.
    it('persiste les trois valeurs sur `session_marche`, pas seulement sur la reponse de cloture', () => {
      const maintenant = maintenantUtc();
      const idLieuAvecDistance = nouvelIdentifiant();
      base
        .insert(lieuMarche)
        .values({
          id: idLieuAvecDistance,
          nom: 'Lieu avec distance de reference (persistance)',
          jourSemaine: 0,
          heureDebut: '08:00',
          heureFin: '14:30',
          actif: true,
          distanceKm: 20,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const session = creerSession(base, { lieuId: idLieuAvecDistance, dateSession: JOUR });
      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
        fondsCaisseInitialCents: 6000,
        especesCompteesCents: 6000 + 7200,
        caCarteCents: 0,
        crepesProduites: 30,
        crepesInvendues: 5,
        crepesCassees: 1,
        heureDebutReelle: '08:00',
        heureFinReelle: '14:30',
        distanceReelleKm: 55,
      });

      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;

      // Memes valeurs que la reponse de cloture (colonnes miroir de
      // `session_marche`) : sans cette ecriture, les trois colonnes
      // resteraient `null` pour toujours, meme quand `imputationDeplacement`
      // sait parfaitement les calculer.
      expect(close.coutDeplacementReelSessionCents).toBe(
        resultat.imputationDeplacement.coutSessionCents,
      );
      expect(close.coutDeplacementReelDetourAchatsCents).toBe(
        resultat.imputationDeplacement.coutDetourAchatsCents,
      );
      expect(close.coutDeplacementReelTotalCents).toBe(
        resultat.imputationDeplacement.coutTotalReelCents,
      );
      expect(close.coutDeplacementReelTotalCents).toBe(2619);
    });

    it('reste `null` (jamais 0) sur les trois colonnes quand la distance reelle n’est pas saisie', () => {
      // `distanceReelleKm` absent : `imputationTourneeDeplacement` (cas 1) rend
      // ses trois champs a `null`, et c'est CE `null` qui doit atteindre la
      // ligne — jamais un 0 qui laisserait croire a une tournee gratuite.
      const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-08-03' });
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
        fondsCaisseInitialCents: 6000,
        especesCompteesCents: 6000 + 7200,
        caCarteCents: 0,
        crepesProduites: 30,
        crepesInvendues: 5,
        crepesCassees: 1,
        heureDebutReelle: '08:00',
        heureFinReelle: '14:30',
      });
      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;

      expect(close.coutDeplacementReelSessionCents).toBeNull();
      expect(close.coutDeplacementReelDetourAchatsCents).toBeNull();
      expect(close.coutDeplacementReelTotalCents).toBeNull();
    });

    it(
      'reste rejouable sur un GET ulterieur (`lireSessionDetail`), pas seulement sur la reponse ' +
        'de cloture elle-meme',
      () => {
        const maintenant = maintenantUtc();
        const idLieuAvecDistance = nouvelIdentifiant();
        base
          .insert(lieuMarche)
          .values({
            id: idLieuAvecDistance,
            nom: 'Lieu avec distance de reference (GET ulterieur)',
            jourSemaine: 0,
            heureDebut: '08:00',
            heureFin: '14:30',
            actif: true,
            distanceKm: 20,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const session = creerSession(base, { lieuId: idLieuAvecDistance, dateSession: JOUR });
        cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
          fondsCaisseInitialCents: 6000,
          especesCompteesCents: 6000 + 7200,
          caCarteCents: 0,
          crepesProduites: 30,
          crepesInvendues: 5,
          crepesCassees: 1,
          heureDebutReelle: '08:00',
          heureFinReelle: '14:30',
          distanceReelleKm: 55,
        });

        // Simule un GET /sessions/:id survenu dans une requete SEPAREE, apres
        // la cloture — exactement ce qu'une reponse de POST ne peut jamais
        // prouver a elle seule.
        const detailRelu = lireSessionDetail(base, session.id)!;

        expect(detailRelu.coutDeplacementReelSessionCents).toBe(1905);
        expect(detailRelu.coutDeplacementReelDetourAchatsCents).toBe(714);
        expect(detailRelu.coutDeplacementReelTotalCents).toBe(2619);
      },
    );
  });

  it('numerote les sessions en sequence, sans trou', () => {
    // On verifie la SEQUENCE, pas des valeurs absolues : le jeu de
    // demonstration cree lui aussi une session, et un test qui exigerait
    // « SM-2026-0001 » casserait a chaque enrichissement de la graine sans
    // qu'aucune regle metier n'ait bouge.
    const a = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const b = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

    expect(a.numero).toMatch(/^SM-2026-\d{4}$/);
    const rangA = Number.parseInt(a.numero.slice(-4), 10);
    const rangB = Number.parseInt(b.numero.slice(-4), 10);
    expect(rangB).toBe(rangA + 1);
  });

  it('refuse de cloturer deux fois — une piece comptable ne se reecrit pas', () => {
    const session = cloturerAvec();
    expect(() =>
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 1, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 300,
        caCarteCents: 0,
        crepesProduites: 1,
        crepesInvendues: 0,
        crepesCassees: 0,
      }),
    ).toThrow(ErreurMetier);
  });

  it('refuse de cloturer une session sans aucune vente', () => {
    // Un marche qui n'a pas eu lieu s'ANNULE, il ne se cloture pas a zero :
    // « ne pas polluer le modele avec des zeros non representatifs » (docs/03).
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    expect(() =>
      cloturerSession(base, session.id, {
        ventes: [],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 0,
        caCarteCents: 0,
        crepesProduites: 0,
        crepesInvendues: 0,
        crepesCassees: 0,
      }),
    ).toThrow(ErreurMetier);
  });

  it('annule une session sans rien effacer, et l exclut du modele', () => {
    const session = cloturerAvec();
    annulerSession(base, session.id, 'Panne de gaz, fermeture après une heure');

    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;

    expect(close.statut).toBe('annulee');
    expect(close.exclureDuModele).toBe(true);
    // Les lignes de vente restent lisibles : rien ne s'efface.
    expect(
      base.select().from(sessionVente).where(eq(sessionVente.sessionId, session.id)).all(),
    ).toHaveLength(1);
  });

  it('exige un motif pour annuler', () => {
    const session = cloturerAvec();
    expect(() => annulerSession(base, session.id, '   ')).toThrow(ErreurMetier);
  });

  it('permet d exclure une session atypique du modele de prevision', () => {
    const session = cloturerAvec({
      exclureDuModele: true,
      motifExclusion: 'Arrivée en retard, deux heures de vente perdues',
    });
    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;

    expect(close.exclureDuModele).toBe(true);
    expect(close.motifExclusion).toContain('retard');
  });

  /**
   * LA VENTE SORT LE STOCK (D-037).
   *
   * `sortie_vente` etait declare au schema, aux contrats et jusqu'aux libelles
   * Excel — et emis NULLE PART. Un pot de sirop vendu restait eternellement en
   * stock : le reapprovisionnement ne le proposait jamais et la valeur du stock
   * etait surevaluee.
   */
  describe('vente d un produit revendu', () => {
    /** Cree un ingredient revendu, son stock, et le produit de vente associe. */
    function preparerSirop(quantiteEnStock: number): { produitId: string; ingredientId: string } {
      const maintenant = maintenantUtc();
      const ingredientId = nouvelIdentifiant();
      base
        .insert(ingredient)
        .values({
          id: ingredientId,
          nom: 'Sirop de Liège',
          categorie: 'garniture',
          uniteReference: 'piece',
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const fournisseurId = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
      if (quantiteEnStock > 0) {
        enregistrerReception(base, {
          fournisseurId,
          dateReception: JOUR,
          lignes: [
            {
              ingredientId,
              quantite: quantiteEnStock,
              prixLigneCents: 250 * quantiteEnStock,
              // Sans numéro de lot NI DLC, un lot n'est pas identifiable
              // (CLAUDE.md §3 règle 6) : ce sirop n'a ni l'un ni l'autre par
              // défaut, d'où ce numéro fournisseur explicite.
              numeroLotFournisseur: 'SIROP-TEST',
            },
          ],
        });
      }

      const produitId = nouvelIdentifiant();
      base
        .insert(produitVente)
        .values({
          id: produitId,
          nom: 'Pot de sirop de Liège',
          nature: 'revendu',
          ingredientId,
          prixCents: 600,
          nbCrepes: null,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      return { produitId, ingredientId };
    }

    /** Stock restant = SOMME des mouvements (CLAUDE.md §3 regle 5). */
    function stockRestant(ingredientId: string): number {
      return lotsDeLIngredient(base, ingredientId).reduce(
        (total, l) => total + l.quantiteRestante,
        0,
      );
    }

    it('decremente le stock du produit vendu', () => {
      const { produitId, ingredientId } = preparerSirop(10);
      expect(stockRestant(ingredientId)).toBe(10);

      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: produitId, quantite: 3, prixUnitaireCents: 600 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 1800,
        caCarteCents: 0,
        crepesProduites: 0,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      expect(stockRestant(ingredientId)).toBe(7);
    });

    it('emet un mouvement de type sortie_vente rattache a la session', () => {
      const { produitId, ingredientId } = preparerSirop(10);
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: produitId, quantite: 2, prixUnitaireCents: 600 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 1200,
        caCarteCents: 0,
        crepesProduites: 0,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      const mouvements = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.ingredientId, ingredientId))
        .all();
      const ventes = mouvements.filter((m) => m.type === 'sortie_vente');
      expect(ventes).toHaveLength(1);
      expect(ventes[0]!.sessionId).toBe(session.id);
      expect(ventes[0]!.quantite).toBe(2);
    });

    it('un stock insuffisant ne BLOQUE PAS la cloture, il remonte un ecart', () => {
      // La vente a eu lieu. Refuser de l'enregistrer minorerait un chiffre
      // d'affaires (CLAUDE.md §7) : c'est le stock qui a tort, pas la vente.
      const { produitId, ingredientId } = preparerSirop(2);
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: produitId, quantite: 5, prixUnitaireCents: 600 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 3000,
        caCarteCents: 0,
        crepesProduites: 0,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      // Le CA complet est enregistre...
      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(close.statut).toBe('cloturee');
      expect(close.caRevenduCents).toBe(3000);

      // ...ce qui etait tracable est sorti...
      expect(stockRestant(ingredientId)).toBe(0);

      // ...et l'ecart est REMONTE, pour qu'un inventaire le solde.
      expect(resultat.ecartsStock).toHaveLength(1);
      expect(resultat.ecartsStock[0]!.nomIngredient).toBe('Sirop de Liège');
      expect(resultat.ecartsStock[0]!.quantiteManquante).toBe(3);
    });

    it('ne sort rien pour un produit TRANSFORME : sa matiere est deja sortie a la production', () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 4, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 1200,
        caCarteCents: 0,
        crepesProduites: 4,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      const ventes = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.type, 'sortie_vente'))
        .all();
      expect(ventes).toHaveLength(0);
    });
  });

  /**
   * VENTE D'UN MENU (fiche 16 §2, migration 0023) — LE POINT DE CE TICKET.
   *
   * Un menu n'atteint jamais `totaliserVentes` tel quel : il est éclaté en
   * ses composants avant, chacun avec sa VRAIE nature. Sans cet éclatement,
   * un menu « crêpe + sirop » tomberait ENTIÈREMENT dans `caRevenduCents`
   * (voir `totaliserVentes`, `packages/core/src/sessions.ts` : tout ce qui
   * n'est pas `'transforme'` va dans le `else`) — faussant silencieusement le
   * compteur de franchise TVA (CLAUDE.md §6).
   */
  describe('vente d’un MENU — ventilation transforme/revendu (fiche 16 §2)', () => {
    /**
     * Un menu-conteneur DÉDIÉ (`nature: 'menu'`, sans recette ni article),
     * composé d'une crêpe (transformé) et d'un sirop (revendu) — le cas
     * mixte que fiche 16 §2.3 tranche explicitement (« un menu PEUT contenir
     * un produit revendu »).
     */
    function creerMenuCrepeSirop(prixCatalogueMenuCents: number): {
      idMenu: string;
      idSiropMenu: string;
      idCrepeMenu: string;
      /** Ingrédient revendu du sirop — pour vérifier son STOCK (Trou 2). */
      idIngredientSirop: string;
    } {
      const maintenant = maintenantUtc();

      const idCrepeMenu = nouvelIdentifiant();
      base
        .insert(produitVente)
        .values({
          id: idCrepeMenu,
          nom: 'Crêpe du menu',
          nature: 'transforme',
          recetteId: null,
          prixCents: 350,
          nbCrepes: 1,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const idIngredientSirop = nouvelIdentifiant();
      base
        .insert(ingredient)
        .values({
          id: idIngredientSirop,
          nom: 'Sirop du menu',
          categorie: 'garniture',
          uniteReference: 'piece',
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const idSiropMenu = nouvelIdentifiant();
      base
        .insert(produitVente)
        .values({
          id: idSiropMenu,
          nom: 'Pot de sirop du menu',
          nature: 'revendu',
          ingredientId: idIngredientSirop,
          prixCents: 600,
          nbCrepes: null,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const idMenu = nouvelIdentifiant();
      base
        .insert(produitVente)
        .values({
          id: idMenu,
          nom: 'Menu Crêpe + Sirop',
          nature: 'menu',
          recetteId: null,
          ingredientId: null,
          prixCents: prixCatalogueMenuCents,
          nbCrepes: null,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      creerCompositionMenu(base, idMenu, { produitInclusId: idCrepeMenu, quantite: 1 });
      creerCompositionMenu(base, idMenu, { produitInclusId: idSiropMenu, quantite: 1 });

      return { idMenu, idSiropMenu, idCrepeMenu, idIngredientSirop };
    }

    /** Stock restant = SOMME des mouvements (CLAUDE.md §3 regle 5) — meme
     *  helper que `describe('vente d un produit revendu', ...)` ci-dessus,
     *  redeclare ici pour rester dans la portee de CE describe. */
    function stockRestantMenu(ingredientId: string): number {
      return lotsDeLIngredient(base, ingredientId).reduce(
        (total, l) => total + l.quantiteRestante,
        0,
      );
    }

    it('ventile sa part en transformé ET sa part en revendu, jamais tout d’un côté', () => {
      const { idMenu } = creerMenuCrepeSirop(700);

      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      cloturerSession(base, session.id, {
        // 2 menus vendus 7,00 € pièce, au prix PRATIQUÉ ce jour-là — distinct
        // du prix catalogue passé à `creerMenuCrepeSirop` ci-dessus, pour
        // vérifier que c'est bien CE prix qui est ventilé.
        ventes: [{ produitVenteId: idMenu, quantite: 2, prixUnitaireCents: 700 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 1400,
        caCarteCents: 0,
        crepesProduites: 2,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;

      // Une session close renseigne toujours ces deux colonnes : `null`
      // n'existe que sur une session encore `planifiee` (voir `schema.ts`).
      const caTransformeCents = close.caTransformeCents ?? 0;
      const caRevenduCents = close.caRevenduCents ?? 0;

      expect(close.caTotalCents).toBe(1400);
      // LE test : ni tout en transformé, ni tout en revendu.
      expect(caTransformeCents).toBeGreaterThan(0);
      expect(caRevenduCents).toBeGreaterThan(0);
      expect(caTransformeCents + caRevenduCents).toBe(close.caTotalCents);
      // La crêpe incluse compte bien dans les crêpes vendues de la session.
      expect(close.crepesVendues).toBe(2);
    });

    it('enregistre UNE seule ligne de vente au prix pratiqué : l’éclatement reste en mémoire, la pièce comptable ne change pas de forme', () => {
      const { idMenu } = creerMenuCrepeSirop(700);

      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idMenu, quantite: 2, prixUnitaireCents: 700 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 1400,
        caCarteCents: 0,
        crepesProduites: 2,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      const lignesVente = base
        .select()
        .from(sessionVente)
        .where(eq(sessionVente.sessionId, session.id))
        .all();
      expect(lignesVente).toHaveLength(1);
      expect(lignesVente[0]?.produitVenteId).toBe(idMenu);
      expect(lignesVente[0]?.montantCents).toBe(1400);
    });

    /**
     * TROU 2 (audit du 30/07/2026) — LE POINT DE CE TEST.
     *
     * `exploserLigneMenu` éclate déjà un menu pour VENTILER le CA (tests
     * ci-dessus), mais avant ce correctif, les TROIS sorties de stock
     * (`sortirLesProduitsRevendus`, `sortirLesGarnitures`,
     * `sortirLesComposantsVente`) continuaient d'opérer sur la vente BRUTE,
     * donc sur le produit-conteneur : le sirop revendu inclus dans un menu
     * n'était JAMAIS décompté du stock. Le CA était juste, le stock était
     * faux — exactement le défaut que ce test verrouille.
     */
    it('décompte du stock le SIROP inclus dans un menu, pas seulement la crêpe', () => {
      const { idMenu, idIngredientSirop } = creerMenuCrepeSirop(700);

      const fournisseurId = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
      enregistrerReception(base, {
        fournisseurId,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idIngredientSirop,
            quantite: 10,
            prixLigneCents: 2500,
            numeroLotFournisseur: 'SIROP-MENU-TEST',
          },
        ],
      });
      expect(stockRestantMenu(idIngredientSirop)).toBe(10);

      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      cloturerSession(base, session.id, {
        // 2 menus vendus -> 2 sirops consommés (quantite: 1 par menu dans la
        // composition déclarée par `creerMenuCrepeSirop` ci-dessus).
        ventes: [{ produitVenteId: idMenu, quantite: 2, prixUnitaireCents: 700 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 1400,
        caCarteCents: 0,
        crepesProduites: 2,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      // LE test : le sirop est bien sorti du stock, pas seulement compté au CA.
      expect(stockRestantMenu(idIngredientSirop)).toBe(8);

      const sorties = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.ingredientId, idIngredientSirop))
        .all()
        .filter((m) => m.type === 'sortie_vente');
      expect(sorties).toHaveLength(1);
      expect(sorties[0]!.sessionId).toBe(session.id);
      expect(sorties[0]!.quantite).toBe(2);
    });

    it('refuse la vente d’un menu sans aucun composant actif', () => {
      const maintenant = maintenantUtc();
      const idMenuVide = nouvelIdentifiant();
      base
        .insert(produitVente)
        .values({
          id: idMenuVide,
          nom: 'Menu vide',
          nature: 'menu',
          recetteId: null,
          ingredientId: null,
          prixCents: 500,
          nbCrepes: null,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      expect(() =>
        cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idMenuVide, quantite: 1, prixUnitaireCents: 500 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 500,
          caCarteCents: 0,
          crepesProduites: 0,
          crepesInvendues: 0,
          crepesCassees: 0,
        }),
      ).toThrow(ErreurMetier);
    });

    /**
     * FICHE 16 §2.2 (audit du 01/08/2026) — LE POINT DE CE TICKET.
     *
     * `exploserLigneMenu` forçait `prixForceCents: null` sur CHAQUE composant
     * avant ce correctif, quel que soit le réglage PERSISTÉ par l'écran Menus
     * (`menu_composition.prix_force_cents`, écrit et relu par `depots/menus.ts`,
     * `verifierPrixForceValide`, déjà testés) : une vente RÉELLE repartait donc
     * TOUJOURS au prorata catalogue, ignorant silencieusement tout composant
     * désigné — alors que l'écran de simulation (`calculerVentilationMenu`) le
     * respectait déjà. Les trois premiers tests ci-dessous étaient ROUGES
     * avant le correctif (vérifié en repassant temporairement `prixForceCents:
     * c.prixForceCents` à `prixForceCents: null` dans `exploserLigneMenu` :
     * mêmes échecs que ceux que ce correctif supprime). Le quatrième verrouille
     * le piège symétrique (remise sous la somme des prix désignés), sans
     * inventer de comportement : `repartirPrixMenu` (`@batte/core`) le refuse
     * déjà, ce test documente cette limite.
     */
    describe('composant DÉSIGNÉ (fiche 16 §2.2) — le réglage persisté doit peser sur une vente réelle', () => {
      /**
       * Menu à TROIS composants : crêpe et café transformés (poids de prorata
       * différents, 350 c et 200 c), sirop revendu — DÉSIGNABLE via
       * `prixForceSiropCents`. Le mélange désigné/prorata DANS LE MÊME MENU est
       * le cas que fiche 16 §2.2 décrit, jamais un choix global par menu.
       */
      function creerMenuTroisComposants(prixForceSiropCents: number | null): { idMenu: string } {
        const maintenant = maintenantUtc();

        const idCrepe = nouvelIdentifiant();
        base
          .insert(produitVente)
          .values({
            id: idCrepe,
            nom: 'Crêpe 3C',
            nature: 'transforme',
            recetteId: null,
            prixCents: 350,
            nbCrepes: 1,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const idCafe = nouvelIdentifiant();
        base
          .insert(produitVente)
          .values({
            id: idCafe,
            nom: 'Café 3C',
            nature: 'transforme',
            recetteId: null,
            prixCents: 200,
            // Transformé À LA DEMANDE : zéro crêpe consommée (même convention
            // que `cafe()` dans `packages/core/src/menus.test.ts`).
            nbCrepes: 0,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const idIngredientSirop = nouvelIdentifiant();
        base
          .insert(ingredient)
          .values({
            id: idIngredientSirop,
            nom: 'Sirop 3C',
            categorie: 'garniture',
            uniteReference: 'piece',
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const idSirop = nouvelIdentifiant();
        base
          .insert(produitVente)
          .values({
            id: idSirop,
            nom: 'Sirop 3C',
            nature: 'revendu',
            ingredientId: idIngredientSirop,
            prixCents: 600,
            nbCrepes: null,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const idMenu = nouvelIdentifiant();
        base
          .insert(produitVente)
          .values({
            id: idMenu,
            nom: 'Menu 3 composants',
            nature: 'menu',
            recetteId: null,
            ingredientId: null,
            // Le catalogue du menu n'est JAMAIS ce qui est ventilé à la
            // clôture (voir l'en-tête d'`exploserLigneMenu`) : volontairement
            // très différent des prix pratiqués testés plus bas, pour que ce
            // test échoue si jamais le catalogue était utilisé par erreur.
            prixCents: 999_999,
            nbCrepes: null,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        creerCompositionMenu(base, idMenu, { produitInclusId: idCrepe, quantite: 1 });
        creerCompositionMenu(base, idMenu, { produitInclusId: idCafe, quantite: 1 });
        creerCompositionMenu(base, idMenu, {
          produitInclusId: idSirop,
          quantite: 1,
          prixForceCents: prixForceSiropCents,
        });

        return { idMenu };
      }

      /** Vend `quantite` menus au prix pratiqué `prixUnitaireCents`, sur une SESSION dédiée. */
      function vendreMenu(
        idMenu: string,
        quantite: number,
        prixUnitaireCents: number,
      ): { caTransformeCents: number; caRevenduCents: number; caTotalCents: number } {
        const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
        cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idMenu, quantite, prixUnitaireCents }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: quantite * prixUnitaireCents,
          caCarteCents: 0,
          crepesProduites: quantite,
          crepesInvendues: 0,
          crepesCassees: 0,
        });
        const close = base
          .select()
          .from(sessionMarche)
          .where(eq(sessionMarche.id, session.id))
          .get()!;
        return {
          caTransformeCents: close.caTransformeCents ?? 0,
          caRevenduCents: close.caRevenduCents ?? 0,
          caTotalCents: close.caTotalCents ?? 0,
        };
      }

      it('une vente réelle RESPECTE le prix désigné du sirop, jamais le prorata catalogue', () => {
        const { idMenu } = creerMenuTroisComposants(380);

        // Prix PRATIQUÉ ce jour-là : 700 c — DIFFÉRENT à la fois du catalogue
        // du menu (999 999 c) et de la somme des catalogues des composants
        // (350 + 200 + 600 = 1150 c), pour prouver qu'aucun des deux
        // catalogues n'est ventilé, seul le prix du jour l'est.
        const { caRevenduCents, caTransformeCents, caTotalCents } = vendreMenu(idMenu, 2, 700);

        // AVANT LE CORRECTIF : `prixForceCents` valait toujours `null`, donc
        // la vente repartait au PRORATA des catalogues (350:200:600) — le
        // sirop aurait alors reçu environ 700 × 600/1150 ≈ 365 c par menu,
        // jamais exactement 380 c.
        expect(caRevenduCents).toBe(2 * 380);
        expect(caTransformeCents).toBe(2 * (700 - 380));
        expect(caTransformeCents + caRevenduCents).toBe(caTotalCents);
      });

      it('les composants NON désignés (crêpe, café) restent au prorata — ils suivent le prix du jour, le désigné reste fixe', () => {
        const { idMenu } = creerMenuTroisComposants(380);

        // MÊME réglage persisté, DEUX prix pratiqués différents sur deux
        // sessions distinctes. Si le sirop est vraiment DÉSIGNÉ (poids FIXE)
        // et que crêpe + café sont vraiment au PRORATA (poids VARIABLE, ils
        // absorbent tout changement du prix pratiqué), alors la part revendu
        // ne doit JAMAIS bouger, et la part transformé doit bouger
        // EXACTEMENT du même montant que le prix pratiqué.
        const venteA = vendreMenu(idMenu, 1, 700);
        const venteB = vendreMenu(idMenu, 1, 900);

        // Le composant désigné ne bouge jamais, quel que soit le prix
        // pratiqué ce jour-là — c'est tout le sens de « prix imposé ».
        expect(venteA.caRevenduCents).toBe(380);
        expect(venteB.caRevenduCents).toBe(380);

        // Les composants NON désignés absorbent l'écart de prix pratiqué :
        // 200 c de plus, intégralement affectés à la part transformé — le
        // signe même du prorata, par opposition au désigné qui reste figé.
        expect(venteB.caTransformeCents - venteA.caTransformeCents).toBe(900 - 700);
        expect(venteA.caTransformeCents).toBe(700 - 380);
        expect(venteB.caTransformeCents).toBe(900 - 380);
      });

      it('la somme des parts tombe EXACTEMENT sur le prix pratiqué (docs/02 invariant n°9), même sur un montant qui ne se divise pas rond', () => {
        const { idMenu } = creerMenuTroisComposants(233);

        // 3 menus à 701 c : ni 701 c ni le reste après le désigné (701 − 233 =
        // 468 c) ne se divisent proprement entre crêpe (poids 350) et café
        // (poids 200) — exactement le cas où arrondir chaque part isolément
        // ferait dériver la somme si la dernière part n'était pas dérivée par
        // soustraction (CLAUDE.md §3 règle 3, `repartir()` dans
        // `packages/core/src/argent.ts`).
        const { caTransformeCents, caRevenduCents, caTotalCents } = vendreMenu(idMenu, 3, 701);

        expect(caTotalCents).toBe(3 * 701);
        // LE test : aucun centime perdu ni créé dans la ventilation, désigné
        // et prorata confondus.
        expect(caTransformeCents + caRevenduCents).toBe(caTotalCents);
        // Le désigné reste exactement 3 × 233 c, jamais un prorata approché.
        expect(caRevenduCents).toBe(3 * 233);
      });

      /**
       * LE PIÈGE SYMÉTRIQUE (établi, pas inventé) : si le porteur consent une
       * remise telle que le prix pratiqué ce jour-là descend SOUS la somme des
       * prix désignés, `repartirPrixMenu` (`@batte/core`) refuse — une
       * `ErreurMetier` de code `menu_prix_force_incoherent` — plutôt que de
       * faire déborder une part en négatif. Comme `cloturerSession` s'exécute
       * dans une SEULE transaction (`base.transaction`, en tête de fonction),
       * cette erreur fait échouer la clôture ENTIÈRE, pas seulement cette
       * ligne de vente : aucune écriture partielle ne subsiste. Voir le
       * rapport de livraison pour la discussion de ce comportement.
       */
      it('un prix désigné qui dépasse le prix pratiqué (remise) fait échouer TOUTE la clôture, sans rien écrire à moitié', () => {
        const { idMenu } = creerMenuTroisComposants(380);

        const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
        let erreur: unknown;
        try {
          cloturerSession(base, session.id, {
            // Remise exceptionnelle à 300 c : sous les 380 c déjà désignés au
            // seul sirop, rien ne reste pour crêpe et café.
            ventes: [{ produitVenteId: idMenu, quantite: 1, prixUnitaireCents: 300 }],
            frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
            fondsCaisseInitialCents: 0,
            especesCompteesCents: 300,
            caCarteCents: 0,
            crepesProduites: 1,
            crepesInvendues: 0,
            crepesCassees: 0,
          });
        } catch (e) {
          erreur = e;
        }

        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('menu_prix_force_incoherent');

        // Ce refus interrompt la clôture de TOUTE la journée : le message doit
        // donc suffire à agir SANS ouvrir les fiches une par une. Le nom du
        // menu ne vient pas de `@batte/core`, qui ne le connaît pas — il est
        // passé par CE fichier. C'est une ligne facile à oublier, et son oubli
        // ne casse AUCUN calcul : aucun test de montant ne le verrait.
        const message = (erreur as ErreurMetier).message;
        expect(message).toContain('Menu 3 composants'); // quel menu
        expect(message).toContain('Sirop 3C'); // quel composant désigné
        expect(message).toContain('Crêpe 3C'); // ce qui n'a plus rien à recevoir
        expect(message).toContain('prix pratiqué'); // sortie 1 : corriger cette vente
        expect(message).toContain('fiche du menu'); // sortie 2 : corriger le réglage
        // Comparé via `formaterEuros`, jamais via un littéral : l'espace avant
        // le « € » est INSÉCABLE, et un littéral tapé à la main n'y correspond
        // pas — un test écrit ainsi échoue sur un message pourtant correct.
        expect(message).toContain(formaterEuros(380));
        expect(message).toContain(formaterEuros(300));
        // Plus aucun centime brut : « (380 c) » était l'ancien message.
        expect(message).not.toMatch(/\d+\s*c\b/);

        // La transaction a bien tout annulé : la session reste PLANIFIÉE,
        // rien n'a été écrit à moitié (CLAUDE.md §3 règle 7).
        const nonClose = base
          .select()
          .from(sessionMarche)
          .where(eq(sessionMarche.id, session.id))
          .get()!;
        expect(nonClose.statut).toBe('planifiee');
        expect(nonClose.caTotalCents).toBeNull();
      });
    });
  });

  /**
   * « Je préfère avoir le choix manuel entre nombre de crêpes vendues et
   * quantité en ml ou g vendu et restant » — demande explicite du porteur.
   *
   * Ces tests inserent la ligne `production` DIRECTEMENT (comme `preparerSirop`
   * insere l'ingredient plus haut) : c'est la RESOLUTION des crepes a la
   * cloture qui est en jeu ici, pas la consommation de stock ni la FEFO, deja
   * couvertes par `services/production.test.ts`.
   */
  describe('clôture par volume de pâte restant (au choix avec les crêpes)', () => {
    let idR1: string;

    beforeEach(() => {
      idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!.id;
    });

    function creerProductionDeTest(entree: {
      sessionId: string | null;
      volumeTheoriqueMl: number;
      crepesTheoriques: number;
      volumeReelMl?: number;
      crepesReelles?: number;
      suffixe: string;
    }): string {
      const maintenant = maintenantUtc();
      const id = nouvelIdentifiant();
      const reelConnu = entree.volumeReelMl !== undefined;
      base
        .insert(production)
        .values({
          id,
          numero: `PR-TEST-${entree.suffixe}`,
          recetteId: idR1,
          dateProduction: JOUR,
          statut: reelConnu ? 'terminee' : 'lancee',
          volumeTheoriqueMl: entree.volumeTheoriqueMl,
          crepesTheoriques: entree.crepesTheoriques,
          coutMatiereTheoriqueCents: 0,
          volumeReelMl: entree.volumeReelMl ?? null,
          crepesReelles: entree.crepesReelles ?? null,
          coutMatiereReelCents: reelConnu ? 0 : null,
          numeroLotPate: `PATE-TEST-${entree.suffixe}`,
          dateDlcPate: '2026-08-03',
          sessionId: entree.sessionId,
          ordrePrevisionId: null,
          ecartMotif: null,
          notes: null,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      return id;
    }

    it('déduit les crêpes produites du volume mesuré — exemple CLAUDE.md §6 (R1)', () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      creerProductionDeTest({
        sessionId: session.id,
        volumeTheoriqueMl: 5000,
        crepesTheoriques: 66,
        suffixe: '1',
      });

      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 40, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 12_000,
        caCarteCents: 0,
        // Aucun `crepesProduites` : seul le bac est mesuré.
        volumeRestantSaisi: { quantite: 800, unite: 'ml' },
        crepesInvendues: 10,
        crepesCassees: 5,
      });

      expect(resultat.resolutionVolume).toEqual({
        crepesProduites: 55,
        volumeProduitMl: 5000,
        volumeRestantMl: 800,
        volumeConsommeMl: 4200,
        // Aucune pâte vendue directement sur cette session (fiche 15 §5.1).
        volumePateVendueMl: 0,
      });

      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(close.statut).toBe('cloturee');
      expect(close.crepesProduites).toBe(55);
      expect(close.crepesVendues).toBe(40);
      expect(close.caTotalCents).toBe(12_000);
    });

    it("n'est JAMAIS refusée par un écart avec vendues + invendues + cassées : c'est une mesure, pas une faute", () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      creerProductionDeTest({
        sessionId: session.id,
        volumeTheoriqueMl: 5000,
        crepesTheoriques: 66,
        suffixe: '2',
      });

      // 40 + 10 + 2 = 52, contre 55 crêpes déduites du volume : un écart de 3,
      // et pourtant AUCUN refus.
      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 40, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 12_000,
        caCarteCents: 0,
        volumeRestantSaisi: { quantite: 800, unite: 'ml' },
        crepesInvendues: 10,
        crepesCassees: 2,
      });

      expect(resultat.resolutionVolume?.crepesProduites).toBe(55);
      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(close.statut).toBe('cloturee');
      expect(close.crepesProduites).toBe(55);
    });

    it('agrège plusieurs productions rattachées, pondérées par leur volume', () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      creerProductionDeTest({
        sessionId: session.id,
        volumeTheoriqueMl: 5000,
        crepesTheoriques: 66,
        suffixe: '3a',
      });
      creerProductionDeTest({
        sessionId: session.id,
        volumeTheoriqueMl: 3000,
        crepesTheoriques: 30,
        suffixe: '3b',
      });

      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 50, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 15_000,
        caCarteCents: 0,
        volumeRestantSaisi: { quantite: 1000, unite: 'ml' },
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      // Volume produit total 8000, restant 1000 -> consommé 7000.
      // Crêpes totales 96 sur 8000 ml -> 7000 * 96 / 8000 = 84.
      expect(resultat.resolutionVolume).toEqual({
        crepesProduites: 84,
        volumeProduitMl: 8000,
        volumeRestantMl: 1000,
        volumeConsommeMl: 7000,
        volumePateVendueMl: 0,
      });
    });

    it('utilise le RÉEL de la production, pas le théorique, dès qu il est connu', () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      creerProductionDeTest({
        sessionId: session.id,
        volumeTheoriqueMl: 5000,
        crepesTheoriques: 66,
        volumeReelMl: 4800,
        crepesReelles: 60,
        suffixe: '4',
      });

      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 45, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 13_500,
        caCarteCents: 0,
        // Mesuré contre le bac RÉELLEMENT rempli (4800 ml), pas contre le
        // théorique (5000 ml) qui n'a jamais existé physiquement.
        volumeRestantSaisi: { quantite: 800, unite: 'ml' },
        crepesInvendues: 5,
        crepesCassees: 0,
      });

      // 4800 - 800 = 4000 ; 4000 * 60 / 4800 = 50.
      expect(resultat.resolutionVolume).toEqual({
        crepesProduites: 50,
        volumeProduitMl: 4800,
        volumeRestantMl: 800,
        volumeConsommeMl: 4000,
        volumePateVendueMl: 0,
      });
    });

    it('refuse un volume restant supérieur au volume produit — impossibilité physique, pas une mesure', () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      creerProductionDeTest({
        sessionId: session.id,
        volumeTheoriqueMl: 5000,
        crepesTheoriques: 66,
        suffixe: '5',
      });

      expect(() =>
        cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          volumeRestantSaisi: { quantite: 5001, unite: 'ml' },
          crepesInvendues: 0,
          crepesCassees: 0,
        }),
      ).toThrow(ErreurMetier);

      // Atomique : le refus n'a rien écrit, la session reste planifiée.
      const intacte = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(intacte.statut).toBe('planifiee');
    });

    it('refuse de choisir les deux modes à la fois', () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      creerProductionDeTest({
        sessionId: session.id,
        volumeTheoriqueMl: 5000,
        crepesTheoriques: 66,
        suffixe: '6',
      });

      try {
        cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          crepesProduites: 66,
          volumeRestantSaisi: { quantite: 800, unite: 'ml' },
          crepesInvendues: 0,
          crepesCassees: 0,
        });
        expect.unreachable('la clôture aurait dû être refusée');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('mode_production_ambigu');
      }
    });

    it("refuse les grammes : aucune densité de pâte n'est déclarée dans le modèle", () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      creerProductionDeTest({
        sessionId: session.id,
        volumeTheoriqueMl: 5000,
        crepesTheoriques: 66,
        suffixe: '7',
      });

      try {
        cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          // Aucune densité de pâte n'existe dans le modèle : `convertir` refuse,
          // et le service ne l'invente PAS (CLAUDE.md §3 règle 4).
          volumeRestantSaisi: { quantite: 800, unite: 'g' },
          crepesInvendues: 0,
          crepesCassees: 0,
        });
        expect.unreachable('la clôture aurait dû être refusée');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('densite_pate_manquante');
      }
    });

    it("refuse un volume mesuré quand aucune production n'est rattachée à la session", () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

      try {
        cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 3000,
          caCarteCents: 0,
          volumeRestantSaisi: { quantite: 800, unite: 'ml' },
          crepesInvendues: 0,
          crepesCassees: 0,
        });
        expect.unreachable('la clôture aurait dû être refusée');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('volume_production_inconnu');
      }
    });

    it('régression — un nombre de crêpes EXPLICITEMENT déclaré reste refusé s il contredit la production rattachée', () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      creerProductionDeTest({
        sessionId: session.id,
        volumeTheoriqueMl: 5000,
        crepesTheoriques: 66,
        suffixe: '9',
      });

      try {
        cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idCrepe, quantite: 40, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 12_000,
          caCarteCents: 0,
          // Contredit les 66 crêpes de la production rattachée : une saisie
          // EXPLICITE contradictoire reste refusée, contrairement à un volume
          // mesuré.
          crepesProduites: 70,
          crepesInvendues: 10,
          crepesCassees: 5,
        });
        expect.unreachable('la clôture aurait dû être refusée');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('crepes_produites_incoherentes');
      }
    });

    /* ═════════════════════════════════════════════════════════════════════
       Persistance du mode de clôture et de la mesure d'origine (D-057)

       Le volume mesuré n'était pas conservé : `crepesProduites` survivait à
       la clôture, mais plus rien ne disait d'où il venait ni ne permettait
       de le revérifier. Migration 0012 : `mode_cloture` +
       `volume_restant_mesure_ml`. Même règle que `especes_comptees_cents` :
       la MESURE se conserve, ce qui en est dérivé se recalcule — donc on
       vérifie ici que c'est la mesure (800 ml) qui est stockée, jamais le
       volume produit ni le volume consommé.
       ═════════════════════════════════════════════════════════════════════ */

    it('persiste le mode « volume » et la mesure d’origine, en millilitres', () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      creerProductionDeTest({
        sessionId: session.id,
        volumeTheoriqueMl: 5000,
        crepesTheoriques: 66,
        suffixe: '10',
      });

      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 40, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 12_000,
        caCarteCents: 0,
        volumeRestantSaisi: { quantite: 800, unite: 'ml' },
        crepesInvendues: 10,
        crepesCassees: 5,
      });

      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(close.modeCloture).toBe('volume');
      expect(close.volumeRestantMesureMl).toBe(800);
      // Le volume PRODUIT (5000) et le volume CONSOMMÉ (4200) ne sont pas des
      // mesures : ils ne sont stockés nulle part, seule la mesure l'est.

      const detail = lireSessionDetail(base, session.id)!;
      expect(detail.modeCloture).toBe('volume');
      expect(detail.volumeRestantMesureMl).toBe(800);
    });

    it('convertit la saisie avant stockage : la colonne reste en millilitres quelle que soit l’unité choisie', () => {
      // `convertir()` accepte `ml` telle quelle ici (les grammes sont refusés
      // faute de densité de pâte, cf. test plus haut) — ce test vérifie que
      // c'est bien la valeur CONVERTIE qui est écrite, pas la saisie brute
      // telle quelle, même quand elle coïncide numériquement.
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      creerProductionDeTest({
        sessionId: session.id,
        volumeTheoriqueMl: 3000,
        crepesTheoriques: 30,
        suffixe: '11',
      });

      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 15, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 4500,
        caCarteCents: 0,
        volumeRestantSaisi: { quantite: 500, unite: 'ml' },
        crepesInvendues: 3,
        crepesCassees: 0,
      });

      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(close.volumeRestantMesureMl).toBe(500);
    });

    it('persiste le mode « crêpes » et laisse le volume mesuré à NULL quand on compte les crêpes (non-régression)', () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      // Aucune production rattachée : le nombre de crêpes saisi fait foi,
      // comme avant D-057 — ce test garantit que ce chemin n'a pas changé.
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 7200,
        caCarteCents: 0,
        crepesProduites: 30,
        crepesInvendues: 5,
        crepesCassees: 1,
      });

      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(close.modeCloture).toBe('crepes');
      expect(close.volumeRestantMesureMl).toBeNull();

      const detail = lireSessionDetail(base, session.id)!;
      expect(detail.modeCloture).toBe('crepes');
      expect(detail.volumeRestantMesureMl).toBeNull();
      expect(detail.crepesProduites).toBe(30);
    });

    it(
      'rétrocompatibilité : une session close AVANT D-057 garde `NULL` sur les deux colonnes — ' +
        'jamais interprété comme le mode « crêpes »',
      () => {
        const session = cloturerAvec();

        // Simule une session close avant la migration 0012 : les deux colonnes
        // n'existaient pas encore et valent donc NULL — y compris
        // `mode_cloture`, qui n'a jamais été choisi et ne doit surtout pas être
        // supposé valoir 'crepes' par défaut.
        base
          .update(sessionMarche)
          .set({ modeCloture: null, volumeRestantMesureMl: null })
          .where(eq(sessionMarche.id, session.id))
          .run();

        const detail = lireSessionDetail(base, session.id)!;
        expect(detail.modeCloture).toBeNull();
        expect(detail.volumeRestantMesureMl).toBeNull();
        // Le reste du détail (dérivé, jamais une mesure) reste inchangé : la
        // rétrocompatibilité ne doit rien faire disparaître d'autre.
        expect(detail.crepesProduites).toBe(30);
      },
    );

    /**
     * Mission « la pâte vendue au volume n'est jamais déduite du stock »
     * (01/08/2026, fiche 15 §5.1) : D-085 avait posé l'IDENTIFICATION
     * (`consommationUnite === 'volume_pate'`), mais `volumeMlParUnite`
     * restait codé en dur à `null` dans `cloturerSession` — la retenue de
     * volume existait en théorie, jamais en pratique.
     */
    describe('pâte vendue DIRECTEMENT au volume (fiche 15 §5.1)', () => {
      function creerProduitBouteille(entree: {
        volumeMlParUnite: number;
        prixCents: number;
      }): string {
        const maintenant = maintenantUtc();
        const id = nouvelIdentifiant();
        base
          .insert(produitVente)
          .values({
            id,
            nom: 'Bouteille de pâte 50 cl',
            nature: 'transforme',
            recetteId: idR1,
            consommationUnite: 'volume_pate',
            nbCrepes: 0, // une bouteille ne produit aucune crêpe (D-085)
            volumeMlParUnite: entree.volumeMlParUnite,
            prixCents: entree.prixCents,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();
        return id;
      }

      it(
        'LE ROUGE, avant cette mission : `volumePateVendueMl` restait TOUJOURS à 0, quelle que ' +
          'soit la quantité de pâte réellement vendue en bouteille — ce test échouerait sur ' +
          'l’ancien code, qui codait `volumeMlParUnite: null` en dur',
        () => {
          const idBouteille = creerProduitBouteille({ volumeMlParUnite: 500, prixCents: 550 });
          const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
          creerProductionDeTest({
            sessionId: session.id,
            volumeTheoriqueMl: 5000,
            crepesTheoriques: 66,
            suffixe: 'BOUTEILLE-1',
          });

          const resultat = cloturerSession(base, session.id, {
            ventes: [
              { produitVenteId: idCrepe, quantite: 20, prixUnitaireCents: 300 },
              // 4 bouteilles de 500 ml = 2000 ml vendus DIRECTEMENT, sans jamais
              // devenir des crêpes.
              { produitVenteId: idBouteille, quantite: 4, prixUnitaireCents: 550 },
            ],
            frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
            fondsCaisseInitialCents: 0,
            especesCompteesCents: 20 * 300 + 4 * 550,
            caCarteCents: 0,
            volumeRestantSaisi: { quantite: 800, unite: 'ml' },
            crepesInvendues: 10,
            crepesCassees: 5,
          });

          // La colonne est désormais LUE : 4 × 500 ml, pas 0.
          expect(resultat.resolutionVolume?.volumePateVendueMl).toBe(2000);
          // 5000 ml produits, 800 ml restants -> 4200 ml disparus, dont 2000 ml
          // vendus en bouteille -> 2200 ml réellement cuits en crêpes ->
          // round(2200 × 66 / 5000) = round(29,04) = 29.
          expect(resultat.resolutionVolume?.crepesProduites).toBe(29);

          const close = base
            .select()
            .from(sessionMarche)
            .where(eq(sessionMarche.id, session.id))
            .get()!;
          expect(close.crepesProduites).toBe(29);
        },
      );

      it('INVARIANT persisté : volume restant mesuré + volume vendu directement + volume transformé en crêpes = volume produit', () => {
        const idBouteille = creerProduitBouteille({ volumeMlParUnite: 500, prixCents: 550 });
        const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
        creerProductionDeTest({
          sessionId: session.id,
          volumeTheoriqueMl: 5000,
          crepesTheoriques: 66,
          suffixe: 'BOUTEILLE-2',
        });

        const resultat = cloturerSession(base, session.id, {
          ventes: [
            { produitVenteId: idCrepe, quantite: 20, prixUnitaireCents: 300 },
            { produitVenteId: idBouteille, quantite: 4, prixUnitaireCents: 550 },
          ],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 20 * 300 + 4 * 550,
          caCarteCents: 0,
          volumeRestantSaisi: { quantite: 800, unite: 'ml' },
          crepesInvendues: 10,
          crepesCassees: 5,
        });

        const resolution = resultat.resolutionVolume!;
        const volumeTransformeEnCrepesMl =
          resolution.volumeConsommeMl - resolution.volumePateVendueMl;
        expect(
          resolution.volumeRestantMl + resolution.volumePateVendueMl + volumeTransformeEnCrepesMl,
        ).toBe(resolution.volumeProduitMl);
      });

      /**
       * LA PREUVE DU NON-DOUBLE-COMPTAGE : le coût matière TOTAL de la session
       * doit rester EXACTEMENT égal au coût réel de la production
       * (`coutMatiereReelCents`), que de la pâte ait été vendue en bouteille ou
       * non — c'est le coût déjà payé une seule fois, à la production, qui est
       * seulement PARTAGÉ entre deux destinations, jamais recréé.
       */
      it('ne recrée AUCUN coût : le coût matière total de la session égale EXACTEMENT le coût réel de la production, bouteilles vendues ou non', () => {
        function cloreAvecOuSansBouteille(venditBouteilles: boolean) {
          const idBouteille = creerProduitBouteille({ volumeMlParUnite: 500, prixCents: 550 });
          const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
          const maintenant = maintenantUtc();
          base
            .insert(production)
            .values({
              id: nouvelIdentifiant(),
              numero: `PR-TEST-NONDOUBLE-${venditBouteilles ? 'AVEC' : 'SANS'}`,
              recetteId: idR1,
              dateProduction: JOUR,
              statut: 'terminee',
              volumeTheoriqueMl: 5000,
              crepesTheoriques: 66,
              coutMatiereTheoriqueCents: 12_800,
              volumeReelMl: 5000,
              crepesReelles: 66,
              coutMatiereReelCents: 12_800,
              numeroLotPate: `PATE-TEST-NONDOUBLE-${venditBouteilles ? 'AVEC' : 'SANS'}`,
              dateDlcPate: '2026-08-03',
              sessionId: session.id,
              ordrePrevisionId: null,
              ecartMotif: null,
              notes: null,
              creeLe: maintenant,
              modifieLe: maintenant,
            })
            .run();

          const ventes = venditBouteilles
            ? [
                { produitVenteId: idCrepe, quantite: 20, prixUnitaireCents: 300 },
                { produitVenteId: idBouteille, quantite: 4, prixUnitaireCents: 550 },
              ]
            : [{ produitVenteId: idCrepe, quantite: 20, prixUnitaireCents: 300 }];
          const especesCompteesCents = venditBouteilles ? 20 * 300 + 4 * 550 : 20 * 300;

          cloturerSession(base, session.id, {
            ventes,
            frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
            fondsCaisseInitialCents: 0,
            especesCompteesCents,
            caCarteCents: 0,
            volumeRestantSaisi: { quantite: 800, unite: 'ml' },
            crepesInvendues: 10,
            crepesCassees: 5,
          });

          return base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;
        }

        const sansBouteille = cloreAvecOuSansBouteille(false);
        const avecBouteille = cloreAvecOuSansBouteille(true);

        // Dans LES DEUX CAS, le coût matière total égale EXACTEMENT le coût
        // réel de production (12 800 c) : vendre une bouteille ne fait NI
        // grossir NI rétrécir ce total, il le PARTAGE seulement entre deux
        // paniers (`coutMatiereTransformeCents` et
        // `coutPateVendueDirectementCents`).
        expect(sansBouteille.coutMatiereCents).toBe(12_800);
        expect(avecBouteille.coutMatiereCents).toBe(12_800);
        expect(avecBouteille.coutMatiereCents).toBe(sansBouteille.coutMatiereCents);

        // La marge, elle, DOIT différer : le CA change (les 4 bouteilles
        // ajoutent 2200 c de CA), pas le coût matière. Non-null : les deux
        // sessions sont bien closes à ce stade (`cloreAvecOuSansBouteille`).
        expect(avecBouteille.caTotalCents).toBe(sansBouteille.caTotalCents! + 2200);
        expect(avecBouteille.margeBruteCents).toBe(sansBouteille.margeBruteCents! + 2200);
      });

      /**
       * AUCUN INGRÉDIENT NE SORT DEUX FOIS : farine, lait et œufs ne sont
       * sortis du stock qu'À LA PRODUCTION (`sortie_production`, hors zone
       * d'écriture de cette mission). La clôture d'une session qui vend de la
       * pâte au volume n'écrit AUCUN mouvement de stock supplémentaire — ni
       * pour les ingrédients (qui seraient comptés deux fois), ni pour une
       * quelconque « pâte » (qui n'est pas représentée comme un stock à part
       * entière, voir le rapport de livraison).
       */
      it("n'écrit AUCUN mouvement de stock supplémentaire en vendant de la pâte au volume", () => {
        const idBouteille = creerProduitBouteille({ volumeMlParUnite: 500, prixCents: 550 });
        const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
        creerProductionDeTest({
          sessionId: session.id,
          volumeTheoriqueMl: 5000,
          crepesTheoriques: 66,
          suffixe: 'BOUTEILLE-3',
        });

        cloturerSession(base, session.id, {
          ventes: [
            { produitVenteId: idCrepe, quantite: 20, prixUnitaireCents: 300 },
            { produitVenteId: idBouteille, quantite: 4, prixUnitaireCents: 550 },
          ],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 20 * 300 + 4 * 550,
          caCarteCents: 0,
          volumeRestantSaisi: { quantite: 800, unite: 'ml' },
          crepesInvendues: 10,
          crepesCassees: 5,
        });

        // Ni la crêpe (sans garniture ni composant dans ce test) ni la
        // bouteille (aucun ingrédient de stock propre, aucune nomenclature de
        // vente) ne déclenchent la moindre sortie : `sortirLesGarnitures`,
        // `sortirLesProduitsRevendus` et `sortirLesComposantsVente` n'ont
        // simplement rien à faire ici.
        const mouvements = base
          .select()
          .from(mouvementStock)
          .where(eq(mouvementStock.sessionId, session.id))
          .all();
        expect(mouvements).toHaveLength(0);
      });
    });
  });

  /**
   * docs/17 fiche 17 : les relevés de température n'étaient saisissables que
   * dans l'écran Registre AFSCA, sur un formulaire qui ne rattachait le
   * relevé qu'à une DATE, jamais à une session — « un registre qu'on remplit
   * ailleurs est un registre qu'on ne remplit pas » (docs/06 §3). Ici, la
   * clôture ELLE-MÊME écrit le relevé, rattaché à la session, dans la même
   * transaction, en réutilisant le cœur partagé avec la saisie autonome
   * (`ecrireReleveTemperature`, fiche 15 pour la non-conformité automatique).
   */
  describe('temperatures a la cloture', () => {
    it('rattache un releve « arrivee » ET un releve « retour » a LA SESSION, pas seulement a une date', () => {
      const session = cloturerAvec({
        relevesTemperature: [
          { moment: 'arrivee', equipement: 'Glacière rigide', temperatureC: 3 },
          { moment: 'retour', equipement: 'Glacière rigide', temperatureC: 4 },
        ],
      });

      const releves = base
        .select()
        .from(releveTemperature)
        .where(eq(releveTemperature.sessionId, session.id))
        .all();

      expect(releves).toHaveLength(2);
      expect(releves.find((r) => r.moment === 'arrivee')?.temperatureC).toBe(3);
      expect(releves.find((r) => r.moment === 'retour')?.temperatureC).toBe(4);
      expect(releves.every((r) => r.conforme)).toBe(true);
      // La date METIER du relevé est celle de la SESSION, jamais une date de
      // saisie distincte : c'est le sens même de « rattaché à la session ».
      expect(releves.every((r) => r.dateReleve === JOUR)).toBe(true);
    });

    it("n'ecrit AUCUN releve quand rien n'est saisi — un relevé qui manque reste manquant, jamais reconstitué", () => {
      const session = cloturerAvec();

      const releves = base
        .select()
        .from(releveTemperature)
        .where(eq(releveTemperature.sessionId, session.id))
        .all();
      expect(releves).toHaveLength(0);
    });

    it(
      'un releve hors seuil saisi a la cloture ouvre AUTOMATIQUEMENT sa non-conformite ' +
        '(meme mecanisme que la saisie autonome, docs/17 fiche 15)',
      () => {
        const avant = base.select().from(nonConformite).all().length;

        const session = cloturerAvec({
          relevesTemperature: [
            {
              moment: 'retour',
              equipement: 'Glacière rigide',
              temperatureC: 9.5,
              actionCorrective: 'Ajout de blocs eutectiques, transfert au frigo à domicile.',
            },
          ],
        });

        const nonConformites = base.select().from(nonConformite).all();
        expect(nonConformites).toHaveLength(avant + 1);

        const creee = nonConformites.find((n) => n.sessionId === session.id);
        expect(creee).toBeDefined();
        expect(creee?.actionCorrective).toContain('eutectiques');
        expect(creee?.dateResolution).toBeNull();
      },
    );

    it(
      'refuse la cloture ENTIERE si un releve hors seuil arrive sans action corrective ' +
        '— rien ne se glisse a moitie ecrit',
      () => {
        const avantNonConformites = base.select().from(nonConformite).all().length;
        const avantReleves = base.select().from(releveTemperature).all().length;

        expect(() =>
          cloturerAvec({
            relevesTemperature: [
              { moment: 'retour', equipement: 'Glacière rigide', temperatureC: 9.5 },
            ],
          }),
        ).toThrow(ErreurMetier);

        // Ni le relevé, ni sa non-conformité, ni aucune autre écriture de la
        // clôture n'ont survécu : c'est la MÊME transaction.
        expect(base.select().from(nonConformite).all()).toHaveLength(avantNonConformites);
        expect(base.select().from(releveTemperature).all()).toHaveLength(avantReleves);
      },
    );

    it('un releve conforme n ouvre AUCUNE non-conformite', () => {
      const avant = base.select().from(nonConformite).all().length;

      cloturerAvec({
        relevesTemperature: [{ moment: 'arrivee', equipement: 'Glacière rigide', temperatureC: 3 }],
      });

      expect(base.select().from(nonConformite).all()).toHaveLength(avant);
    });
  });

  /**
   * Mission « justificatif d'un frais de session » (30/07/2026) :
   * `sessionFrais.justificatifPath` valait `null` EN DUR, quelle que soit la
   * saisie (audit du 30/07/2026, `packages/db/src/audit-colonnes-orphelines.test.ts`).
   * Chaque catégorie SAISIE (`emplacement`, `deplacement`, `gaz`, `divers` —
   * jamais `energie`, poste CALCULÉ) peut désormais porter son propre
   * justificatif, validé par LE MÊME mécanisme que `fichier_scan_path`
   * (`validerPieceJointe`, importée de `./factures.ts`).
   */
  describe("justificatif (ticket) d'un frais de session", () => {
    // Contenu RÉELLEMENT conforme au type MIME déclaré (`validerPieceJointe`
    // vérifie désormais aussi les octets, pas seulement la forme de la
    // Data URI — voir `contenuCorrespondAuTypeDeclare`, `./factures.ts`) :
    // quatre types acceptés distincts, pour que la routine de câblage par
    // catégorie soit prouvée par des VALEURS DIFFÉRENTES, pas seulement des
    // chaînes identiques recopiées quatre fois.
    const dataUriPng = `data:image/png;base64,${Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
    ]).toString('base64')}`;
    const dataUriJpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]).toString('base64')}`;
    const dataUriPdf = `data:application/pdf;base64,${Buffer.concat([
      Buffer.from('%PDF-'),
      Buffer.from([1, 2, 3]),
    ]).toString('base64')}`;
    const dataUriWebp = `data:image/webp;base64,${Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP'),
    ]).toString('base64')}`;

    it('valide et rattache un justificatif à SA catégorie ; les autres catégories restent `null`', () => {
      const session = cloturerAvec({
        frais: {
          emplacementCents: 2200,
          deplacementCents: 1400,
          gazCents: 600,
          diversCents: 0,
          emplacementJustificatifPath: dataUriPng,
        },
      });

      const lignesFrais = listerFraisSession(base, session.id);
      expect(lignesFrais.find((l) => l.categorie === 'emplacement')?.justificatifPath).toBe(
        dataUriPng,
      );
      // Une catégorie sans pièce reste `null`, jamais une chaîne vide ni un
      // chemin fantaisiste (CLAUDE.md §7).
      expect(lignesFrais.find((l) => l.categorie === 'deplacement')?.justificatifPath).toBeNull();
    });

    it('accepte un justificatif distinct par catégorie, sur les quatre postes saisis', () => {
      const session = cloturerAvec({
        frais: {
          emplacementCents: 2200,
          deplacementCents: 1400,
          gazCents: 600,
          diversCents: 100,
          emplacementJustificatifPath: dataUriPng,
          deplacementJustificatifPath: dataUriJpeg,
          gazJustificatifPath: dataUriPdf,
          diversJustificatifPath: dataUriWebp,
        },
      });

      const lignesFrais = listerFraisSession(base, session.id);
      const parCategorie = new Map(lignesFrais.map((l) => [l.categorie, l.justificatifPath]));
      expect(parCategorie.get('emplacement')).toBe(dataUriPng);
      expect(parCategorie.get('deplacement')).toBe(dataUriJpeg);
      expect(parCategorie.get('gaz')).toBe(dataUriPdf);
      expect(parCategorie.get('divers')).toBe(dataUriWebp);
    });

    it('refuse un justificatif de frais qui n’est pas une Data URI reconnue', () => {
      expect(() =>
        cloturerAvec({
          frais: {
            emplacementCents: 2200,
            deplacementCents: 1400,
            gazCents: 600,
            diversCents: 0,
            gazJustificatifPath: 'C:\\Users\\porteur\\Documents\\ticket-gaz.pdf',
          },
        }),
      ).toThrow(ErreurMetier);
    });

    it('un poste à 0 € n’écrit aucune ligne, même avec un justificatif fourni', () => {
      // Un justificatif SANS montant n'a aucune ligne où s'attacher : même
      // règle que les quatre autres postes (une catégorie à 0 n'écrit rien).
      const session = cloturerAvec({
        frais: {
          emplacementCents: 2200,
          deplacementCents: 0,
          gazCents: 0,
          diversCents: 0,
          deplacementJustificatifPath: dataUriPng,
        },
      });

      const lignesFrais = listerFraisSession(base, session.id);
      expect(lignesFrais.find((l) => l.categorie === 'deplacement')).toBeUndefined();
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Verrou de période (docs/07 §1.6) — câblage signalé par l'agent qui a posé
   le garde-fou sur les sept autres points d'écriture datés (dépenses,
   immobilisations, mouvements de stock, réceptions, productions) :
   `periode.statut = 'verrouillee'` existait et n'était appliqué NULLE PART à
   la clôture de session — le point le plus important, puisque c'est par lui
   que passe l'essentiel du chiffre d'affaires. Même convention que
   `services/mouvements.test.ts` : un test qui refuse dans la période
   verrouillée, un test PAIRÉ qui prouve que la clôture reste possible dans
   une période ouverte quand un AUTRE mois est verrouillé (zéro régression).
   ═══════════════════════════════════════════════════════════════════════════ */

describe('cloture de session — verrou de periode (docs/07 §1.6)', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte — test verrou de période',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idCrepe = base.select({ id: produitVente.id }).from(produitVente).get()!.id;
  });

  /** Même utilitaire que `depots/comptabilite.test.ts` et `services/mouvements.test.ts`. */
  function verrouillerPeriode(annee: number, mois: number): void {
    const maintenant = maintenantUtc();
    base
      .insert(periode)
      .values({
        id: nouvelIdentifiant(),
        annee,
        mois,
        statut: 'verrouillee',
        dateCloture: maintenant,
        clotureePar: null,
        dateReouverture: null,
        motifReouverture: null,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  }

  /**
   * Clôture minimale : la DATE qui compte pour le verrou est celle de la
   * session (`creerSession`, fixée à la création), jamais un champ de la
   * clôture elle-même — `cloturerSession` ne reçoit pas de date.
   */
  function cloturerSessionDeTest(sessionId: string) {
    return cloturerSession(base, sessionId, {
      ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 3000,
      caCarteCents: 0,
      crepesProduites: 10,
      crepesInvendues: 0,
      crepesCassees: 0,
    });
  }

  it('refuse de clôturer une session datée dans une période verrouillée, sans rien écrire', () => {
    verrouillerPeriode(2026, 4);
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-04-10' });
    const avantVentes = base.select().from(sessionVente).all().length;

    expect(() => cloturerSessionDeTest(session.id)).toThrow(ErreurMetier);

    // Rien n'a été écrit : la session reste PLANIFIÉE, sans aucune ligne de vente.
    const relue = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;
    expect(relue.statut).toBe('planifiee');
    expect(base.select().from(sessionVente).all()).toHaveLength(avantVentes);
  });

  it(
    'reste possible dans une période OUVERTE, même quand un AUTRE mois est verrouillé ' +
      '— zéro régression',
    () => {
      verrouillerPeriode(2026, 4);
      const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-08-02' });

      cloturerSessionDeTest(session.id);

      const relue = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(relue.statut).toBe('cloturee');
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   Rattachement à une opportunité (fiche 14, D-059) — le trou structurel
   ═══════════════════════════════════════════════════════════════════════════ */

describe('rattachement à une opportunité (fiche 14, D-059)', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'Lieu de test rattachement',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idCrepe = base.select({ id: produitVente.id }).from(produitVente).get()!.id;
  });

  function creerEntrepriseFixture(
    surcharges: Partial<Parameters<typeof creerOpportunite>[1]> = {},
  ): string {
    return creerOpportunite(base, {
      nom: 'Stand entreprise test',
      type: 'autre',
      famille: 'entreprise',
      dateDebut: '2026-09-01',
      dateFin: '2026-09-01',
      effectifEstime: 100,
      ...surcharges,
    }).id;
  }

  /** Événement-FACTEUR classique (`famille = NULL`) : module une session
   *  existante, il n'en crée jamais une (docs/demandes/14 §2). */
  function creerFacteurClassiqueFixture(): string {
    const maintenant = maintenantUtc();
    const id = nouvelIdentifiant();
    base
      .insert(evenement)
      .values({
        id,
        nom: 'Festival classique',
        type: 'festival',
        dateDebut: '2026-08-01',
        dateFin: '2026-08-01',
        portee: 'quartier',
        intensiteEstimee: 3,
        impactEstimeBp: 13_000,
        valideParHumain: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    return id;
  }

  function cloturerAvecMinimum(sessionId: string): void {
    cloturerSession(base, sessionId, {
      ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 3000,
      caCarteCents: 0,
      crepesProduites: 10,
      crepesInvendues: 0,
      crepesCassees: 0,
    });
  }

  it('crée une session déjà rattachée à une opportunité dès la création', () => {
    const evenementId = creerEntrepriseFixture();
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-09-01', evenementId });

    const ligne = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;
    expect(ligne.evenementId).toBe(evenementId);
  });

  it('laisse `evenementId` à `null` par défaut — le cas majoritaire', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-09-01' });
    const ligne = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;
    expect(ligne.evenementId).toBeNull();
  });

  it('refuse de créer une session motivée par un événement inexistant', () => {
    expect(() =>
      creerSession(base, {
        lieuId: idLieu,
        dateSession: '2026-09-01',
        evenementId: 'evt-inconnu',
      }),
    ).toThrow(ErreurMetier);
  });

  it(
    'refuse de créer une session motivée par un événement-FACTEUR classique ' +
      '(famille = NULL) — il module une session, il n’en crée pas',
    () => {
      const evenementId = creerFacteurClassiqueFixture();
      expect(() =>
        creerSession(base, { lieuId: idLieu, dateSession: '2026-09-01', evenementId }),
      ).toThrow(ErreurMetier);
    },
  );

  it('rattache une session déjà créée à une opportunité, après coup', () => {
    const evenementId = creerEntrepriseFixture();
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-09-01' });
    expect(
      base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!.evenementId,
    ).toBeNull();

    rattacherEvenementSession(base, session.id, evenementId);

    const ligne = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;
    expect(ligne.evenementId).toBe(evenementId);
  });

  it(
    'refuse le rattachement sur une session déjà CLÔTURÉE — le lien se pose avant, ' +
      'jamais après (CLAUDE.md §7)',
    () => {
      const evenementId = creerEntrepriseFixture();
      const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-09-01' });
      cloturerAvecMinimum(session.id);

      expect(() => rattacherEvenementSession(base, session.id, evenementId)).toThrow(ErreurMetier);

      // Rien n'a bougé : la session reste sans opportunité rattachée.
      const ligne = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(ligne.evenementId).toBeNull();
    },
  );

  it('refuse le rattachement à un événement-FACTEUR classique', () => {
    const evenementId = creerFacteurClassiqueFixture();
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-09-01' });

    expect(() => rattacherEvenementSession(base, session.id, evenementId)).toThrow(ErreurMetier);
  });

  it('refuse le rattachement à une opportunité déjà écartée (rejetée)', () => {
    const evenementId = creerEntrepriseFixture();
    rejeterOpportunite(base, evenementId);
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-09-01' });

    expect(() => rattacherEvenementSession(base, session.id, evenementId)).toThrow(ErreurMetier);
  });

  it('refuse le rattachement à une session inexistante', () => {
    const evenementId = creerEntrepriseFixture();
    expect(() => rattacherEvenementSession(base, 'session-inconnue', evenementId)).toThrow(
      ErreurIntrouvable,
    );
  });

  it('refuse le rattachement à un événement inexistant', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-09-01' });
    expect(() => rattacherEvenementSession(base, session.id, 'evt-inconnu')).toThrow(
      ErreurIntrouvable,
    );
  });

  it(
    'accumule PLUSIEURS sessions closes vers LA MÊME opportunité — ' +
      '`session_marche.evenement_id` n’est pas unique (migration 0020)',
    () => {
      const evenementId = creerEntrepriseFixture();

      const sessionA = creerSession(base, {
        lieuId: idLieu,
        dateSession: '2026-09-01',
        evenementId,
      });
      cloturerAvecMinimum(sessionA.id);

      const sessionB = creerSession(base, { lieuId: idLieu, dateSession: '2026-09-08' });
      rattacherEvenementSession(base, sessionB.id, evenementId);
      cloturerAvecMinimum(sessionB.id);

      const lignes = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.evenementId, evenementId))
        .all();
      expect(lignes).toHaveLength(2);
      expect(lignes.every((l) => l.statut === 'cloturee')).toBe(true);
    },
  );
});

/**
 * Fiche 17 — l'électricité entre RÉELLEMENT dans la marge d'une session
 * (jusqu'ici, la durée d'utilisation d'un équipement se saisissait déjà mais
 * ne changeait rien à ce que le porteur croyait gagner — voir le rapport de
 * livraison).
 *
 * `idLieu` (le fixture partagé du bloc « Lot 4 » ci-dessus) ne renseigne
 * jamais `facturationElectricite` (mode INCONNU) : ce bloc-ci crée ses PROPRES
 * lieux, un par mode de facturation, pour isoler chaque cas de
 * docs/demandes/17.
 */
describe("fiche 17 — coût d'électricité dans la marge de session", () => {
  let base: BaseBatte;
  let idProduitCrepe: string;

  function insererLieuAvecFacturation(
    nom: string,
    facturationElectricite: 'compteur' | 'forfait' | 'comprise' | 'aucune' | null,
  ): string {
    const id = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(lieuMarche)
      .values({
        id,
        nom,
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        facturationElectricite,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    return id;
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    idProduitCrepe = base.select({ id: produitVente.id }).from(produitVente).get()!.id;
  });

  function cloturerAvecEquipements(
    lieuId: string,
    equipementsUtilises: { equipementId: string; dureeMinutes: number }[],
  ) {
    const session = creerSession(base, { lieuId, dateSession: JOUR });
    const resultat = cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduitCrepe, quantite: 24, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 7200,
      caCarteCents: 0,
      crepesProduites: 24,
      crepesInvendues: 0,
      crepesCassees: 0,
      ...(equipementsUtilises.length > 0 ? { equipementsUtilises } : {}),
    });
    return { session, resultat };
  }

  it("cas 3 — lieu facturé AU COMPTEUR, équipement renseigné : réduit la marge d'un coût réel", () => {
    const idLieuCompteur = insererLieuAvecFacturation('Marché au compteur', 'compteur');
    const idRadiateur = creerEquipement(base, {
      nom: 'Radiateur soufflant',
      type: 'chauffage',
      puissanceW: 1000,
      enService: true,
      notes: null,
    });

    // 1000 W x 120 min = 2 kWh ; prix par défaut du catalogue = 20 c€/kWh
    // (`prix_kwh_cents_par_kwh`) -> 40 centimes.
    const { session, resultat } = cloturerAvecEquipements(idLieuCompteur, [
      { equipementId: idRadiateur, dureeMinutes: 120 },
    ]);

    expect(resultat.avertissementEnergie).toBeNull();

    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;
    // Sans électricité : marge nette = 7200 - 4200 = 3000 (voir le test du
    // bloc « Lot 4 » ci-dessus). Avec 40 centimes d'électricité en plus :
    expect(close.margeNetteCents).toBe(3000 - 40);

    const lignesFrais = listerFraisSession(base, session.id);
    const ligneEnergie = lignesFrais.find((l) => l.categorie === 'energie');
    expect(ligneEnergie?.montantCents).toBe(40);
  });

  /**
   * LE TEST QUI PROUVE L'ABSENCE DE DOUBLE COMPTAGE, AU NIVEAU INTÉGRATION :
   * un lieu dont l'électricité est COMPRISE dans l'emplacement ne doit pas la
   * payer une seconde fois, même quand un vrai équipement a réellement
   * tourné pendant la session (2 kWh, un coût qui existerait bel et bien sur
   * un lieu facturé au compteur).
   */
  it("cas 2 — électricité COMPRISE dans l'emplacement : aucune ligne « energie », marge inchangée (pas de double comptage)", () => {
    const idLieuComprise = insererLieuAvecFacturation('Marché tout compris', 'comprise');
    const idRadiateur = creerEquipement(base, {
      nom: 'Radiateur soufflant',
      type: 'chauffage',
      puissanceW: 1000,
      enService: true,
      notes: null,
    });

    const { session, resultat } = cloturerAvecEquipements(idLieuComprise, [
      { equipementId: idRadiateur, dureeMinutes: 120 },
    ]);

    expect(resultat.avertissementEnergie).toBeNull();

    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;
    // Exactement la même marge que sans électricité : le coût est déjà dans
    // `fraisEmplacementCents`, l'ajouter ici l'aurait compté deux fois.
    expect(close.margeNetteCents).toBe(3000);

    const lignesFrais = listerFraisSession(base, session.id);
    expect(lignesFrais.find((l) => l.categorie === 'energie')).toBeUndefined();
  });

  it("cas 3 — lieu facturé au compteur mais AUCUNE durée d'équipement enregistrée : marge inchangée, mais avertie (jamais affirmée nulle)", () => {
    // Simule une session déjà close AVANT l'existence de cette saisie
    // (`equipement_session` n'a alors JAMAIS aucune ligne pour elle) : ici,
    // simplement, aucun équipement n'est transmis à la clôture.
    const idLieuCompteur = insererLieuAvecFacturation(
      'Marché au compteur — sans mesure',
      'compteur',
    );

    const { session, resultat } = cloturerAvecEquipements(idLieuCompteur, []);

    expect(resultat.avertissementEnergie).not.toBeNull();

    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, session.id)).get()!;
    expect(close.margeNetteCents).toBe(3000);

    const lignesFrais = listerFraisSession(base, session.id);
    expect(lignesFrais.find((l) => l.categorie === 'energie')).toBeUndefined();
  });

  it('refuse un équipement inconnu plutôt que de le compter pour 0 W en silence', () => {
    const idLieuCompteur = insererLieuAvecFacturation(
      'Marché au compteur — id invalide',
      'compteur',
    );

    expect(() =>
      cloturerAvecEquipements(idLieuCompteur, [
        { equipementId: 'equipement-inconnu', dureeMinutes: 60 },
      ]),
    ).toThrow(ErreurIntrouvable);
  });
});

/**
 * Audit du 30/07/2026 — mission « météo prévue et réelle d'une session ».
 *
 * `session_marche.meteo_prevue` / `meteo_reelle` n'étaient ni écrites ni lues.
 * `cloturerSession` les fige désormais depuis `meteo_observation` — voir le
 * commentaire complet au point de calcul (`services/sessions.ts`) pour le
 * raisonnement sur QUAND et POURQUOI cet horizon précis est retenu.
 */
describe('Cloture — météo figée (D-058, mission météo prévue/réelle)', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte — test météo session',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idCrepe = base.select({ id: produitVente.id }).from(produitVente).get()!.id;
  });

  /** Insère un relevé `meteo_observation` minimal pour le lieu/jour de test. */
  function insererReleveMeteo(entree: {
    type: 'prevision' | 'reelle';
    horizonJours: number | null;
    temperatureC: number;
  }): void {
    base
      .insert(meteoObservation)
      .values({
        id: nouvelIdentifiant(),
        lieuId: idLieu,
        dateObservation: JOUR,
        type: entree.type,
        temperatureC: entree.temperatureC,
        temperatureRessentieC: null,
        precipitationsMm: null,
        probabilitePluieBp: null,
        ventKmh: null,
        couvertureNuageuseBp: null,
        codeMeteo: null,
        donneesBrutes: null,
        recupereLe: maintenantUtc(),
        horizonJours: entree.horizonJours,
      })
      .run();
  }

  function cloturerAvec() {
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 3000,
      caCarteCents: 0,
      crepesProduites: 10,
      crepesInvendues: 0,
      crepesCassees: 0,
    });
    return session;
  }

  it('fige la prévision la plus proche de J-1, jamais la dernière connue du matin même', () => {
    // Quatre révisions distinctes (D-058) coexistent pour le même jour :
    // J-7, J-3, J-1, et « le matin même » (horizon 0). Seule celle de J-1
    // doit être retenue — pas la plus récente (horizon 0), qui est
    // exactement la « dernière connue à l'ouverture » que la question de
    // cette mission écarte.
    insererReleveMeteo({ type: 'prevision', horizonJours: 7, temperatureC: 10 });
    insererReleveMeteo({ type: 'prevision', horizonJours: 3, temperatureC: 12 });
    insererReleveMeteo({ type: 'prevision', horizonJours: 1, temperatureC: 14 });
    insererReleveMeteo({ type: 'prevision', horizonJours: 0, temperatureC: 20 });

    const session = cloturerAvec();
    const detail = lireSessionDetail(base, session.id)!;

    expect(detail.meteoPrevue).not.toBeNull();
    expect(detail.meteoPrevue?.temperatureC).toBe(14);
    expect(detail.meteoPrevue?.horizonJours).toBe(1);
  });

  it('se replie sur la révision la plus proche de J-1 disponible quand J-1 manque', () => {
    insererReleveMeteo({ type: 'prevision', horizonJours: 7, temperatureC: 10 });
    insererReleveMeteo({ type: 'prevision', horizonJours: 3, temperatureC: 12 });

    const session = cloturerAvec();
    const detail = lireSessionDetail(base, session.id)!;

    expect(detail.meteoPrevue?.temperatureC).toBe(12);
    expect(detail.meteoPrevue?.horizonJours).toBe(3);
  });

  it('ne retient jamais la prévision du matin même (horizon 0) comme météo prévue, même seule disponible', () => {
    insererReleveMeteo({ type: 'prevision', horizonJours: 0, temperatureC: 20 });

    const session = cloturerAvec();
    const detail = lireSessionDetail(base, session.id)!;

    expect(detail.meteoPrevue).toBeNull();
  });

  it('fige la météo réelle depuis le relevé `type = reelle` du jour de la session', () => {
    insererReleveMeteo({ type: 'reelle', horizonJours: 0, temperatureC: 16 });

    const session = cloturerAvec();
    const detail = lireSessionDetail(base, session.id)!;

    expect(detail.meteoReelle).not.toBeNull();
    expect(detail.meteoReelle?.temperatureC).toBe(16);
    expect(detail.meteoReelle?.horizonJours).toBe(0);
  });

  it("rend meteoPrevue et meteoReelle à `null`, jamais inventés, quand aucun relevé n'existe pour ce lieu et cette date", () => {
    const session = cloturerAvec();
    const detail = lireSessionDetail(base, session.id)!;

    expect(detail.meteoPrevue).toBeNull();
    expect(detail.meteoReelle).toBeNull();
  });

  it('n’utilise jamais un relevé d’un AUTRE lieu ou d’une autre date', () => {
    const autreLieu = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(lieuMarche)
      .values({
        id: autreLieu,
        nom: 'Un autre marché',
        jourSemaine: 3,
        heureDebut: '08:00',
        heureFin: '12:00',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    // Même horizon et même type, mais un lieu différent : ne doit jamais
    // être choisi pour la session du lieu de test.
    base
      .insert(meteoObservation)
      .values({
        id: nouvelIdentifiant(),
        lieuId: autreLieu,
        dateObservation: JOUR,
        type: 'prevision',
        temperatureC: 99,
        temperatureRessentieC: null,
        precipitationsMm: null,
        probabilitePluieBp: null,
        ventKmh: null,
        couvertureNuageuseBp: null,
        codeMeteo: null,
        donneesBrutes: null,
        recupereLe: maintenant,
        horizonJours: 1,
      })
      .run();

    const session = cloturerAvec();
    const detail = lireSessionDetail(base, session.id)!;

    expect(detail.meteoPrevue).toBeNull();
  });

  it('fige la date de clôture réelle, absente tant que la session n’est pas close', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    expect(lireSessionDetail(base, session.id)!.dateCloture).toBeNull();

    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 3000,
      caCarteCents: 0,
      crepesProduites: 10,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    const dateCloture = lireSessionDetail(base, session.id)!.dateCloture;
    expect(dateCloture).not.toBeNull();
    // ISO 8601 UTC (CLAUDE.md §3 règle 8), pas un jour civil seul.
    expect(Number.isNaN(new Date(dateCloture!).getTime())).toBe(false);
  });
});

/**
 * Audit du 30/07/2026 — mission « marge brute à 100 % sans que rien ne le
 * signale ». Symétrique du garde-fou qui protège déjà le revendu, les
 * garnitures et les composants de vente (`ecartsStock`, un stock insuffisant
 * se signale déjà) : côté transformé, une production simplement ABSENTE
 * (mode « crêpes produites saisies à la main », aucune production rattachée)
 * ou une recette jamais activée / jamais garnie ne se signalait NULLE PART —
 * `coutMatiereTransformeCents` valait 0, `margeBruteCents` valait le CA total,
 * et `ResultatCloture` ne portait rien qui le dise.
 *
 * Voir `coutMatiereTransformeSuspect` (`packages/core/src/sessions.ts`) pour
 * le SEUIL de déclenchement (strictement `caTransformeCents > 0` ET
 * `coutMatiereTransformeCents === 0`) et sa justification complète, et
 * `diagnostiquerRecettePourCoutNul` (`depots/referentiel.ts`) pour
 * l'enrichissement du message quand une recette précise est en cause.
 */
describe('avertissement — coût matière transformé nul (audit 30/07/2026)', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte — test coût matière',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idCrepe = base.select({ id: produitVente.id }).from(produitVente).get()!.id;
  });

  it(
    'ROUGE (sans le correctif, ce champ restait `null` pour toujours) — du transformé vendu, ' +
      "aucune production rattachée : la marge brute affichée vaut 100 % du CA, et l'avertissement " +
      'le dit',
    () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 7200,
        caCarteCents: 0,
        // Mode « crêpes », AUCUNE production rattachée : exactement le
        // chemin du défaut décrit dans la mission.
        crepesProduites: 24,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      expect(resultat.avertissementCoutMatiereTransforme).not.toBeNull();
      expect(resultat.avertissementCoutMatiereTransforme).toContain('transformé');

      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      // Exactement l'illusion que la mission décrit : marge brute == CA total,
      // sans qu'aucun montant ne soit ici corrigé (seul un avertissement est ajouté).
      expect(close.coutMatiereCents).toBe(0);
      expect(close.margeBruteCents).toBe(close.caTotalCents);
    },
  );

  it(
    'SILENCIEUX — une session qui ne vend QUE du revendu : un coût transformé nul y est la ' +
      'vérité, pas une anomalie',
    () => {
      const maintenant = maintenantUtc();
      const idIngredientSirop = nouvelIdentifiant();
      base
        .insert(ingredient)
        .values({
          id: idIngredientSirop,
          nom: 'Sirop de Liège',
          categorie: 'garniture',
          uniteReference: 'piece',
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idIngredientSirop,
            quantite: 10,
            prixLigneCents: 2500,
            numeroLotFournisseur: 'SIROP-TEST-COUT-NUL',
          },
        ],
      });

      const idProduitSirop = nouvelIdentifiant();
      base
        .insert(produitVente)
        .values({
          id: idProduitSirop,
          nom: 'Pot de sirop de Liège',
          nature: 'revendu',
          ingredientId: idIngredientSirop,
          prixCents: 600,
          nbCrepes: null,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idProduitSirop, quantite: 3, prixUnitaireCents: 600 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 1800,
        caCarteCents: 0,
        crepesProduites: 0,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      expect(resultat.avertissementCoutMatiereTransforme).toBeNull();
    },
  );

  it(
    "SILENCIEUX — dès qu'un coût matière transformé est réellement retenu (même partiel), " +
      "l'avertissement ne se déclenche pas",
    () => {
      const idR1 = base
        .select({ id: recette.id })
        .from(recette)
        .where(eq(recette.code, 'R1'))
        .get()!.id;
      const maintenant = maintenantUtc();

      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

      base
        .insert(production)
        .values({
          id: nouvelIdentifiant(),
          numero: 'PR-TEST-COUT-NUL',
          recetteId: idR1,
          dateProduction: JOUR,
          statut: 'terminee',
          volumeTheoriqueMl: 5000,
          crepesTheoriques: 66,
          coutMatiereTheoriqueCents: 1650,
          volumeReelMl: 5000,
          crepesReelles: 24,
          // Un coût RÉEL, même partiel : c'est exactement ce qui doit
          // empêcher l'avertissement de se déclencher.
          coutMatiereReelCents: 1650,
          numeroLotPate: 'PATE-TEST-COUT-NUL',
          dateDlcPate: '2026-08-03',
          sessionId: session.id,
          ordrePrevisionId: null,
          ecartMotif: null,
          notes: null,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 7200,
        caCarteCents: 0,
        crepesInvendues: 0,
        crepesCassees: 0,
        // `crepesProduites` OMIS : DÉRIVÉ de la production rattachée (24).
      });

      expect(resultat.avertissementCoutMatiereTransforme).toBeNull();

      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(close.coutMatiereCents).toBe(1650);
    },
  );

  /**
   * QUATRIÈME PANIER (mission « la pâte vendue au volume n'est jamais
   * déduite du stock », fiche 15 §5.1) : une session qui ne vend QUE de la
   * pâte en bouteille (aucune crêpe) a `coutMatiereTransformeCents === 0`
   * (aucune crêpe cuite, LA VÉRITÉ), mais son vrai coût matière est retenu
   * dans `coutPateVendueDirectementCents` — sans ce panier, cette fonction
   * confondrait ce cas légitime avec l'anomalie qu'elle traque, ET
   * `close.coutMatiereCents` afficherait 0 (marge à 100 %), exactement le
   * défaut décrit par la mission.
   */
  it(
    'SILENCIEUX — une session qui ne vend QUE de la pâte en bouteille (aucune crêpe cuite) : ' +
      'le coût matière réel est retenu, aucune marge à 100 % ni faux avertissement',
    () => {
      const idR1 = base
        .select({ id: recette.id })
        .from(recette)
        .where(eq(recette.code, 'R1'))
        .get()!.id;
      const maintenant = maintenantUtc();
      const idBouteille = nouvelIdentifiant();
      base
        .insert(produitVente)
        .values({
          id: idBouteille,
          nom: 'Bouteille de pâte 5 L',
          nature: 'transforme',
          recetteId: idR1,
          consommationUnite: 'volume_pate',
          nbCrepes: 0,
          volumeMlParUnite: 5000, // toute la fournée part en une seule bouteille
          prixCents: 1500,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      base
        .insert(production)
        .values({
          id: nouvelIdentifiant(),
          numero: 'PR-TEST-PATE-SEULE',
          recetteId: idR1,
          dateProduction: JOUR,
          statut: 'terminee',
          volumeTheoriqueMl: 5000,
          crepesTheoriques: 66,
          coutMatiereTheoriqueCents: 12_800,
          volumeReelMl: 5000,
          // Aucune crêpe réellement cuite : toute la fournée est partie en
          // bouteille.
          crepesReelles: 0,
          coutMatiereReelCents: 12_800,
          numeroLotPate: 'PATE-TEST-PATE-SEULE',
          dateDlcPate: '2026-08-03',
          sessionId: session.id,
          ordrePrevisionId: null,
          ecartMotif: null,
          notes: null,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const resultat = cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idBouteille, quantite: 1, prixUnitaireCents: 1500 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 1500,
        caCarteCents: 0,
        crepesInvendues: 0,
        crepesCassees: 0,
        // `crepesProduites` OMIS : DÉRIVÉ de la production rattachée (0, la
        // fournée entière étant partie en bouteille).
      });

      // AUCUN avertissement : le coût existe bel et bien, simplement dans le
      // panier « pâte vendue directement », pas dans « transformé ».
      expect(resultat.avertissementCoutMatiereTransforme).toBeNull();

      const close = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      // LE ROUGE QUE CETTE MISSION CORRIGE : sans le partage du coût de
      // production vers ce quatrième panier, `coutMatiereCents` vaudrait 0
      // ici (aucune crêpe vendue, donc `coutMatiereTransformeCents` à 0, et
      // rien d'autre ne portait ce coût avant cette mission) — soit une marge
      // brute affichée à 100 % sur 15,00 € de chiffre d'affaires.
      expect(close.coutMatiereCents).toBe(12_800);
      expect(close.margeBruteCents).toBe(close.caTotalCents! - 12_800);
      expect(close.margeBruteCents).not.toBe(close.caTotalCents);
    },
  );

  it('nomme la recette suspecte quand elle est en BROUILLON et sans aucune ligne (second trou de la mission)', () => {
    const maintenant = maintenantUtc();
    const idRecetteVide = nouvelIdentifiant();
    base
      .insert(recette)
      .values({
        id: idRecetteVide,
        code: 'R9',
        nom: 'Recette jamais finie',
        version: 1,
        statut: 'brouillon',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 5000,
        rendementReferenceCrepes: 66,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: 0,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const idProduitVide = nouvelIdentifiant();
    base
      .insert(produitVente)
      .values({
        id: idProduitVide,
        nom: 'Crêpe (recette pas finie)',
        nature: 'transforme',
        recetteId: idRecetteVide,
        prixCents: 300,
        nbCrepes: 1,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const resultat = cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduitVide, quantite: 24, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 7200,
      caCarteCents: 0,
      crepesProduites: 24,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    expect(resultat.avertissementCoutMatiereTransforme).not.toBeNull();
    expect(resultat.avertissementCoutMatiereTransforme).toContain('R9');
    expect(resultat.avertissementCoutMatiereTransforme).toContain('brouillon');
  });

  /**
   * MISSION « café, recette vide, avertissement trop bavard » (31/07/2026) —
   * les DEUX tests indispensables du rapport de livraison.
   *
   * Le café (fiche 15 §4) est un transformé À LA DEMANDE : sa composition
   * vient entièrement de sa nomenclature de VENTE (`produit_vente_composant`),
   * jamais d'une production. `coutMatiereTransformeCents` (production +
   * garnitures) vaut donc TOUJOURS 0 pour une session qui ne vend QUE du café
   * — avant cette mission, `coutMatiereTransformeSuspect` ne connaissait que
   * ce panier, et l'avertissement se déclenchait à CHAQUE clôture d'une telle
   * session, alors qu'aucun chiffre n'y est faux (le coût existe, dans le
   * panier `coutComposantsVenteCents`).
   */
  describe('café — la nomenclature de vente compte comme une source de coût (mission café)', () => {
    /** Ingrédients « toujours appliqués » de la nomenclature de vente du café (voir `demonstration.ts`). */
    const INGREDIENTS_CAFE = [
      'Café moulu',
      'Chicorée',
      'Sucre en poudre',
      'Eau',
      'Cannelle',
      'Gobelet carton',
    ];

    /**
     * Réceptionne un lot de chacun des ingrédients « toujours appliqués » du
     * café, afin que `sortirLesComposantsVente` trouve du stock à sortir et
     * retienne un coût RÉELLEMENT non nul (sans stock, le coût resterait à 0
     * pour une tout autre raison — un écart de stock — ce qui ne prouverait
     * rien sur la condition testée ici).
     */
    function receptionnerIngredientsCafe(): void {
      const idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
      for (const nomIngredient of INGREDIENTS_CAFE) {
        const idIngredient = base
          .select({ id: ingredient.id })
          .from(ingredient)
          .where(eq(ingredient.nom, nomIngredient))
          .get()!.id;
        enregistrerReception(base, {
          fournisseurId: idFournisseur,
          dateReception: JOUR,
          lignes: [
            {
              ingredientId: idIngredient,
              // Largement suffisant pour 24 cafés (le plus gourmand, l'eau,
              // consomme 100 ml/café soit 2 400 ml).
              quantite: 5000,
              prixLigneCents: 1000,
              numeroLotFournisseur: `CAFE-TEST-${nomIngredient}`,
            },
          ],
        });
      }
    }

    it(
      'SILENCIEUX — une session qui ne vend QUE du café : le coût matière du café est retenu ' +
        "dans le panier des composants de vente, PAS dans celui de la production — l'avertissement " +
        'ne doit PAS se déclencher',
      () => {
        receptionnerIngredientsCafe();

        const idCafe = base
          .select({ id: produitVente.id })
          .from(produitVente)
          .where(eq(produitVente.nom, NOM_PRODUIT_CAFE))
          .get()!.id;

        const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
        const resultat = cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idCafe, quantite: 24, prixUnitaireCents: 200 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 4800,
          caCarteCents: 0,
          // Le café ne consomme aucune crêpe (`nbCrepes = 0`) : 0 partout,
          // cohérent avec une session qui ne cuit rien.
          crepesProduites: 0,
          crepesInvendues: 0,
          crepesCassees: 0,
        });

        // Preuve que le coût matière du café est bien retenu — ailleurs que
        // dans `coutMatiereTransformeCents` (§ non touché par cette mission).
        const close = base
          .select()
          .from(sessionMarche)
          .where(eq(sessionMarche.id, session.id))
          .get()!;
        expect(close.coutMatiereCents).toBeGreaterThan(0);

        expect(resultat.avertissementCoutMatiereTransforme).toBeNull();

        // Passe par le MÊME assemblage que la route HTTP
        // (`POST /sessions/:id/cloturer`, `apps/api/src/routes/sessions.ts`)
        // et le MÊME `.parse()` du contrat partagé : une fonction sans type
        // de retour explicite peut violer son contrat Zod sans que `tsc` ne
        // le voie, l'erreur ne sortant qu'en 422 au premier appel HTTP.
        const detail = lireSessionDetail(base, session.id)!;
        const reponseHttp = schemaResultatCloture.parse({
          ...detail,
          ecartsStock: resultat.ecartsStock,
          resolutionVolume: resultat.resolutionVolume,
          imputationDeplacement: resultat.imputationDeplacement,
          avertissementEnergie: resultat.avertissementEnergie,
          avertissementCoutMatiereTransforme: resultat.avertissementCoutMatiereTransforme,
        });
        expect(reponseHttp.avertissementCoutMatiereTransforme).toBeNull();
      },
    );

    it(
      'DÉCLENCHE TOUJOURS — une session qui vend une crêpe SANS AUCUNE matière (aucune ' +
        'production rattachée, aucune garniture, aucun composant de vente) : le second test ' +
        "indispensable, qui garantit que le garde-fou n'a pas simplement été désarmé",
      () => {
        const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
        const resultat = cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 7200,
          caCarteCents: 0,
          crepesProduites: 24,
          crepesInvendues: 0,
          crepesCassees: 0,
        });

        const close = base
          .select()
          .from(sessionMarche)
          .where(eq(sessionMarche.id, session.id))
          .get()!;
        expect(close.coutMatiereCents).toBe(0);

        expect(resultat.avertissementCoutMatiereTransforme).not.toBeNull();
        expect(resultat.avertissementCoutMatiereTransforme).toContain('transformé');

        const detail = lireSessionDetail(base, session.id)!;
        const reponseHttp = schemaResultatCloture.parse({
          ...detail,
          ecartsStock: resultat.ecartsStock,
          resolutionVolume: resultat.resolutionVolume,
          imputationDeplacement: resultat.imputationDeplacement,
          avertissementEnergie: resultat.avertissementEnergie,
          avertissementCoutMatiereTransforme: resultat.avertissementCoutMatiereTransforme,
        });
        expect(reponseHttp.avertissementCoutMatiereTransforme).not.toBeNull();
      },
    );

    it(
      "N'ACCUSE PAS la recette VIDE du café quand l'avertissement se déclenche pour une AUTRE " +
        'raison (aucun stock du tout pour ses composants) : le message ne doit jamais suggérer de ' +
        'remplir une recette que le porteur a délibérément laissée vide',
      () => {
        // AUCUNE réception : le café est vendu sans qu'aucun de ses
        // composants n'ait jamais été reçu en stock. Le panier des
        // composants de vente reste alors à 0 pour une raison DIFFÉRENTE de
        // la mission (un écart de stock, déjà signalé par `ecartsStock`) —
        // et l'avertissement se déclenche à bon droit (aucune source de coût
        // n'a rien retenu). Ce test vérifie que le message ne désigne PAS,
        // pour autant, la recette vide du café comme « probablement en
        // cause » : sa composition ne vient jamais de cette recette.
        const idCafe = base
          .select({ id: produitVente.id })
          .from(produitVente)
          .where(eq(produitVente.nom, NOM_PRODUIT_CAFE))
          .get()!.id;

        const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
        const resultat = cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idCafe, quantite: 24, prixUnitaireCents: 200 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 4800,
          caCarteCents: 0,
          crepesProduites: 0,
          crepesInvendues: 0,
          crepesCassees: 0,
        });

        // L'avertissement se déclenche à bon droit ici : aucun stock, donc
        // aucun coût nulle part — ce n'est PAS le cas que la mission corrige.
        expect(resultat.avertissementCoutMatiereTransforme).not.toBeNull();
        expect(resultat.avertissementCoutMatiereTransforme).toContain(NOM_PRODUIT_CAFE);
        // Le vrai défaut du café ici est un ÉCART DE STOCK (déjà porté par
        // `ecartsStock`), jamais une recette à compléter.
        expect(resultat.ecartsStock.length).toBeGreaterThan(0);
        expect(resultat.avertissementCoutMatiereTransforme).not.toContain(
          'Recette(s) probablement en cause',
        );
      },
    );
  });
});
