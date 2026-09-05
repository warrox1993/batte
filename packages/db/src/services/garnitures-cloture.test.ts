/**
 * BRANCHEMENT des garnitures dans la chaine ERP.
 *
 * `services/garnitures.ts` et `depots/recettes.ts` savaient calculer et sortir
 * une garniture depuis leur ecriture — et **rien ne les appelait**. Le code
 * existait, ses tests passaient, et le cout matiere restait faux en production.
 * C'est le profil de defaut que ce projet collectionne : une capacite construite
 * que rien ne consomme. Ce fichier ne teste donc AUCUN calcul — il teste les
 * SOUDURES : la cloture appelle-t-elle la sortie, le cout entre-t-il dans la
 * marge, la tracabilite retrouve-t-elle les lots dans les deux sens.
 *
 * Regle de redaction : aucune assertion ne porte sur une valeur absolue que la
 * graine peut deplacer. Chaque attendu est DERIVE de la source de verite lue en
 * base (`produit_garniture` croisee avec `session_vente`). Un test qui figerait
 * « 1 552 c » casserait le jour ou l'on corrige une cuillere de cassonade, sans
 * qu'aucune regle metier n'ait bouge.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { and, eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { seedDemonstrationActivite } from '../seed/activite.js';
import {
  fournisseur,
  lieuMarche,
  mouvementStock,
  production,
  produitGarniture,
  produitVente,
  sessionMarche,
  sessionVente,
} from '../schema.js';
import { tracabiliteAmontSession, tracabiliteAvalLot } from '../depots/tracabilite.js';
import { enregistrerReception } from './reception.js';
import { cloturerSession, creerSession } from './sessions.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Lectures de reference — la SOURCE DE VERITE dont tous les attendus derivent
   ═══════════════════════════════════════════════════════════════════════════ */

/** Quantite de chaque garniture THEORIQUEMENT consommee par les ventes d'une session. */
function garnituresAttendues(base: BaseBatte, sessionId: string): Map<string, number> {
  const lignes = base
    .select({
      ingredientId: produitGarniture.ingredientId,
      quantiteParUnite: produitGarniture.quantiteUniteRef,
      quantiteVendue: sessionVente.quantite,
    })
    .from(sessionVente)
    .innerJoin(produitGarniture, eq(produitGarniture.produitVenteId, sessionVente.produitVenteId))
    .where(eq(sessionVente.sessionId, sessionId))
    .all();

  const parIngredient = new Map<string, number>();
  for (const l of lignes) {
    parIngredient.set(
      l.ingredientId,
      (parIngredient.get(l.ingredientId) ?? 0) + l.quantiteVendue * l.quantiteParUnite,
    );
  }
  return parIngredient;
}

/** Mouvements `sortie_vente` d'une session, non annules. */
function sortiesVente(base: BaseBatte, sessionId: string) {
  return base
    .select({
      ingredientId: mouvementStock.ingredientId,
      lotId: mouvementStock.lotId,
      quantite: mouvementStock.quantite,
      coutCents: mouvementStock.coutCents,
      dateMouvement: mouvementStock.dateMouvement,
      productionId: mouvementStock.productionId,
      motifId: mouvementStock.motifId,
    })
    .from(mouvementStock)
    .where(
      and(
        eq(mouvementStock.sessionId, sessionId),
        eq(mouvementStock.type, 'sortie_vente'),
        eq(mouvementStock.isAnnule, false),
      ),
    )
    .all();
}

function coutDesProductions(base: BaseBatte, sessionId: string): number {
  return base
    .select({
      cout: production.coutMatiereTheoriqueCents,
      coutReel: production.coutMatiereReelCents,
    })
    .from(production)
    .where(eq(production.sessionId, sessionId))
    .all()
    .reduce((total, p) => total + (p.coutReel ?? p.cout), 0);
}

/* ═══════════════════════════════════════════════════════════════════════════
   La session de demonstration, deroulee par les vrais services
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Garnitures — branchement dans la cloture de session', () => {
  let base: BaseBatte;
  let sessionId: string;
  let attendues: Map<string, number>;

  // `beforeAll` et non `beforeEach` : la graine complete est couteuse, et aucun
  // test de ce bloc n'ecrit — ils lisent tous la meme cloture.
  beforeAll(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    seedDemonstrationActivite(base);

    const close = base
      .select({ id: sessionMarche.id })
      .from(sessionMarche)
      .where(eq(sessionMarche.statut, 'cloturee'))
      .get();
    if (close === undefined)
      throw new Error('La graine de démonstration n’a clôturé aucune session.');
    sessionId = close.id;
    attendues = garnituresAttendues(base, sessionId);
  });

  it('la graine contient bien une garniture rattachee a un produit vendu', () => {
    // Sans elle, tout ce fichier passerait sur du vide et ne prouverait rien.
    expect(attendues.size).toBeGreaterThan(0);
    for (const quantite of attendues.values()) expect(quantite).toBeGreaterThan(0);
  });

  it('la cloture sort du stock la quantite exacte de chaque garniture', () => {
    const sorties = sortiesVente(base, sessionId);

    for (const [ingredientId, quantiteAttendue] of attendues) {
      const sorti = sorties
        .filter((m) => m.ingredientId === ingredientId)
        .reduce((total, m) => total + m.quantite, 0);
      expect(sorti).toBe(quantiteAttendue);
    }
  });

  it('chaque sortie de garniture porte un lot, la session et le jour du marche', () => {
    // Exigence AFSCA : une denree a DLC sortie sans lot ni date n'est pas
    // tracable, et la sortie ne servirait qu'a decompter du stock.
    const session = base
      .select({ dateSession: sessionMarche.dateSession })
      .from(sessionMarche)
      .where(eq(sessionMarche.id, sessionId))
      .get()!;

    const sortiesGarniture = sortiesVente(base, sessionId).filter((m) =>
      attendues.has(m.ingredientId),
    );
    expect(sortiesGarniture.length).toBeGreaterThan(0);

    for (const m of sortiesGarniture) {
      expect(m.lotId).not.toBe('');
      expect(m.dateMouvement).toBe(session.dateSession);
      // Une garniture ne passe par AUCUNE production : le mouvement ne doit pas
      // en revendiquer une. Et une vente n'est pas un ecart a expliquer : pas
      // de motif non plus.
      expect(m.productionId).toBeNull();
      expect(m.motifId).toBeNull();
    }
  });

  it('la FEFO alloue au plus une fois chaque couple (ingredient, lot)', () => {
    // Invariant de la repartition : un cumul par ingredient PRECEDE l'ecriture.
    // Sans lui, deux produits partageant la meme cassonade produiraient deux
    // repartitions successives, et l'ordre des lignes de vente changerait le
    // resultat.
    const vus = new Set<string>();
    for (const m of sortiesVente(base, sessionId)) {
      const cle = `${m.ingredientId}|${m.lotId}`;
      expect(vus.has(cle)).toBe(false);
      vus.add(cle);
    }
  });

  it('le cout des garnitures entre dans `coutMatiereCents` de la session', () => {
    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, sessionId)).get()!;

    const sorties = sortiesVente(base, sessionId);
    const coutGarnitures = sorties
      .filter((m) => attendues.has(m.ingredientId))
      .reduce((total, m) => total + m.coutCents, 0);
    const coutRevendu = sorties
      .filter((m) => !attendues.has(m.ingredientId))
      .reduce((total, m) => total + m.coutCents, 0);

    // Le defaut corrige : ce cout etait calcule au centime pres, puis jete.
    expect(coutGarnitures).toBeGreaterThan(0);
    expect(close.coutMatiereCents).toBe(
      coutDesProductions(base, sessionId) + coutRevendu + coutGarnitures,
    );
  });

  it('la marge brute est amputee du cout des garnitures', () => {
    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, sessionId)).get()!;
    // Ces trois colonnes sont nullables au schema — elles ne le sont plus une
    // fois la session close, et l'exiger explicitement vaut mieux qu'un `!`.
    expect(close.caTotalCents).not.toBeNull();
    expect(close.coutMatiereCents).not.toBeNull();
    expect(close.margeBruteCents).not.toBeNull();

    // Marge brute = CA - cout matiere (packages/core). Si la garniture etait
    // restee hors du cout, la marge aurait ete surevaluee d'autant.
    expect(close.margeBruteCents).toBe((close.caTotalCents ?? 0) - (close.coutMatiereCents ?? 0));
  });

  /* ── Tracabilite ────────────────────────────────────────────────────────── */

  it('la tracabilite amont range les garnitures dans LEUR bloc, ni production ni revendu', () => {
    const amont = tracabiliteAmontSession(base, sessionId);

    expect(amont.garnitures.length).toBeGreaterThan(0);

    const ingredientsGarnis = new Set(amont.garnitures.map((g) => g.ingredientId));
    for (const ingredientId of attendues.keys()) {
      expect(ingredientsGarnis.has(ingredientId)).toBe(true);
    }
    // Aucune garniture ne s'est glissee dans les marchandises revendues : le
    // client d'une crepe garnie n'emporte aucun emballage, donc aucun numero de
    // lot — c'est ce qui decide de la portee d'un rappel.
    for (const r of amont.revendus) {
      expect(attendues.has(r.ingredientId)).toBe(false);
    }
    for (const g of amont.garnitures) {
      expect(g.produits.length).toBeGreaterThan(0);
      expect(g.quantite).toBeGreaterThan(0);
    }
  });

  it('chaque garniture nomme un produit reellement vendu qui la portait', () => {
    const amont = tracabiliteAmontSession(base, sessionId);

    for (const g of amont.garnitures) {
      for (const nom of g.produits) {
        const porteur = base
          .select({ id: produitVente.id })
          .from(produitVente)
          .innerJoin(produitGarniture, eq(produitGarniture.produitVenteId, produitVente.id))
          .innerJoin(sessionVente, eq(sessionVente.produitVenteId, produitVente.id))
          .where(
            and(
              eq(produitVente.nom, nom),
              eq(produitGarniture.ingredientId, g.ingredientId),
              eq(sessionVente.sessionId, sessionId),
            ),
          )
          .get();
        expect(porteur).toBeDefined();
      }
    }
  });

  it('la tracabilite aval retrouve la session depuis un lot de garniture', () => {
    const amont = tracabiliteAmontSession(base, sessionId);

    for (const g of amont.garnitures) {
      const aval = tracabiliteAvalLot(base, g.lotId);
      expect(aval.garnitures.map((v) => v.session.id)).toContain(sessionId);
      expect(aval.ventes.map((v) => v.session.id)).not.toContain(sessionId);

      const quantiteAval = aval.garnitures
        .filter((v) => v.session.id === sessionId)
        .reduce((total, v) => total + v.quantite, 0);
      expect(quantiteAval).toBe(g.quantite);
    }
  });

  it('un lot a la fois transforme et etale apparait dans les DEUX blocs aval', () => {
    // La vergeoise entre dans la pate ET s'etale au service. Fondre les deux
    // ferait croire a un seul usage, et un rappel sur le mauvais perimetre est
    // un rappel manque. Le test ne s'applique que si la graine offre ce cas.
    const amont = tracabiliteAmontSession(base, sessionId);
    const lotsProduits = new Set(
      amont.productions.flatMap((p) => p.consommations.map((c) => c.lotId)),
    );
    const commun = amont.garnitures.find((g) => lotsProduits.has(g.lotId));
    if (commun === undefined) return;

    const aval = tracabiliteAvalLot(base, commun.lotId);
    expect(aval.productions.length).toBeGreaterThan(0);
    expect(aval.garnitures.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   La regle la plus importante : ne JAMAIS bloquer une cloture

   La vente a EU LIEU. Refuser de l'enregistrer parce que le stock enregistre
   ne suit pas serait minorer un chiffre d'affaires (CLAUDE.md §7) ; inventer un
   lot pour couvrir le manquant fabriquerait une tracabilite fausse.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Garnitures — un stock insuffisant ne bloque pas la cloture', () => {
  let base: BaseBatte;
  let idLieu: string;
  let garni: { produitId: string; ingredientId: string; quantiteParUnite: number };
  let idFournisseur: string;

  const QUANTITE_VENDUE = 10;
  const PRIX_CENTS = 300;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    // Referentiel SEUL : aucune reception, donc aucun lot de garniture.
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'Marché de test',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const ligne = base
      .select({
        produitId: produitVente.id,
        ingredientId: produitGarniture.ingredientId,
        quantiteParUnite: produitGarniture.quantiteUniteRef,
      })
      .from(produitGarniture)
      .innerJoin(produitVente, eq(produitVente.id, produitGarniture.produitVenteId))
      .get();
    if (ligne === undefined)
      throw new Error('La graine ne rattache aucune garniture à un produit.');
    garni = ligne;

    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
  });

  function cloturerUneVente(dateSession: string) {
    const session = creerSession(base, { lieuId: idLieu, dateSession });
    const resultat = cloturerSession(base, session.id, {
      ventes: [
        {
          produitVenteId: garni.produitId,
          quantite: QUANTITE_VENDUE,
          prixUnitaireCents: PRIX_CENTS,
        },
      ],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: QUANTITE_VENDUE * PRIX_CENTS,
      caCarteCents: 0,
      crepesProduites: QUANTITE_VENDUE,
      crepesInvendues: 0,
      crepesCassees: 0,
    });
    return { sessionId: session.id, resultat };
  }

  it('cloture quand meme, et remonte l ecart au lieu d inventer un lot', () => {
    const { sessionId, resultat } = cloturerUneVente('2026-08-02');

    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, sessionId)).get()!;
    expect(close.statut).toBe('cloturee');

    const ecart = resultat.ecartsStock.find((e) => e.ingredientId === garni.ingredientId);
    expect(ecart).toBeDefined();
    expect(ecart!.quantiteManquante).toBe(QUANTITE_VENDUE * garni.quantiteParUnite);
    expect(ecart!.nomIngredient).not.toBe('');

    // Et surtout : AUCUN mouvement inventé pour couvrir le manquant.
    const sorties = sortiesVente(base, sessionId).filter(
      (m) => m.ingredientId === garni.ingredientId,
    );
    expect(sorties).toHaveLength(0);
  });

  it('sort ce qui est tracable et ne remonte QUE le reliquat', () => {
    const besoin = QUANTITE_VENDUE * garni.quantiteParUnite;
    const disponible = Math.floor(besoin / 2);

    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-08-01',
      numeroBonLivraison: 'BL-TEST-GARNITURE-PARTIELLE',
      lignes: [
        {
          ingredientId: garni.ingredientId,
          quantite: disponible,
          prixLigneCents: 100,
          numeroLotFournisseur: 'LOT-TEST-PARTIEL',
          dateDlc: null,
        },
      ],
    });

    const { sessionId, resultat } = cloturerUneVente('2026-08-09');

    const sorties = sortiesVente(base, sessionId).filter(
      (m) => m.ingredientId === garni.ingredientId,
    );
    // Ce qui EXISTAIT est sorti, avec son lot…
    expect(sorties.reduce((total, m) => total + m.quantite, 0)).toBe(disponible);
    // …et seul le reliquat devient un ecart.
    const ecart = resultat.ecartsStock.find((e) => e.ingredientId === garni.ingredientId)!;
    expect(ecart.quantiteManquante).toBe(besoin - disponible);

    // Le cout du reel sorti pese bien dans la marge, meme partiel.
    const close = base.select().from(sessionMarche).where(eq(sessionMarche.id, sessionId)).get()!;
    expect(close.coutMatiereCents).toBe(sorties.reduce((total, m) => total + m.coutCents, 0));
  });
});
