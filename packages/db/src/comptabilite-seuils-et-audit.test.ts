/**
 * Audit de la comptabilite et des seuils legaux — tests de non-regression.
 *
 * Trois defauts corriges, un defaut CONSTATE et laisse ouvert :
 *
 *  1. la depense rattachee a une immobilisation etait deduite DEUX fois (une
 *     fois en charge, une fois par les annuites) ;
 *  2. `depense.immobilisation_id` n'a aucune cle etrangere en base : un
 *     identifiant fantaisiste passait sans bruit ;
 *  3. la cloture et la reouverture d'une periode n'etaient PAS journalisees, et
 *     le motif de la reouverture precedente etait ecrase a chaque cycle ;
 *  4. `it.fails` en fin de fichier : le compteur « cotisation reduite » compare
 *     un CHIFFRE D'AFFAIRES a un seuil de REVENU NET. Le correctif tient en
 *     trois lignes dans `depots/sessions.ts`, hors perimetre de ce fichier —
 *     voir docs/16-AUDIT-COMPTABILITE.md.
 *
 * Aucune assertion ne porte sur une valeur absolue que la graine pourrait
 * deplacer : tout est ecart mesure ou invariant reconstitue depuis la source
 * de verite lue.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, type BaseBatte } from './client.js';
import { migrer } from './migrer.js';
import { seed } from './seed/index.js';
import { seedDemonstration } from './seed/demonstration.js';
import {
  fournisseur,
  ingredient,
  lieuMarche,
  produitVente,
  recette,
  sessionMarche,
} from './schema.js';
import { listerJournalAudit } from './depots/audit.js';
import {
  cloturerPeriode,
  enregistrerDepense,
  enregistrerImmobilisation,
  listerDepenses,
  rouvrirPeriode,
  syntheseExercice,
  totalAchatsMarchandisesCents,
} from './depots/comptabilite.js';
import { tableauSeuils } from './depots/sessions.js';
import { enregistrerReception } from './services/reception.js';
import { lancerProduction } from './services/production.js';
import { cloturerSession, creerSession } from './services/sessions.js';

/**
 * Exercice volontairement lointain : aucune donnee de graine ne s'y trouve, si
 * bien que les ecarts mesures ne viennent que de ce que le test ecrit lui-meme.
 */
const EXERCICE = 2031;

describe('audit comptabilite — immobilisations et double deduction', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
  });

  /** Le materiel du projet : ≈ 3 500 € sur 5 ans (CLAUDE.md §6, docs/01 module 7). */
  function materielImmobilise(): { id: string; annuiteExerciceCents: number } {
    const cree = enregistrerImmobilisation(base, {
      libelle: 'Matériel de crêperie ambulante',
      dateAcquisition: `${EXERCICE}-03-15`,
      montantCents: 350_000,
      dureeAmortissementAnnees: 5,
    });
    // L'annuite vient du plan REELLEMENT persiste, jamais d'un litteral.
    const annuite = cree.annuites.find((a) => a.exercice === EXERCICE);
    expect(annuite, "le plan doit porter une annuite sur l'exercice d'acquisition").toBeDefined();
    return { id: cree.id, annuiteExerciceCents: annuite!.montantCents };
  }

  it("n'ajoute QUE son annuité au résultat quand le bien est immobilisé", () => {
    const avant = syntheseExercice(base, EXERCICE);
    const { annuiteExerciceCents } = materielImmobilise();
    const apres = syntheseExercice(base, EXERCICE);

    expect(apres.amortissementsCents - avant.amortissementsCents).toBe(annuiteExerciceCents);
    expect(apres.depensesDeductiblesCents).toBe(avant.depensesDeductiblesCents);
  });

  it('NE DÉDUIT PAS une seconde fois la dépense rattachée à cette immobilisation', () => {
    const immo = materielImmobilise();
    const avant = syntheseExercice(base, EXERCICE);

    enregistrerDepense(base, {
      dateDepense: `${EXERCICE}-03-15`,
      libelle: 'Achat matériel de crêperie',
      categorie: 'materiel',
      montantCents: 350_000,
      immobilisationId: immo.id,
    });

    const apres = syntheseExercice(base, EXERCICE);
    // Le decaissement est enregistre, mais il ne cree AUCUNE charge de plus :
    // sa deduction est deja portee par le plan d'amortissement.
    expect(apres.depensesDeductiblesCents).toBe(avant.depensesDeductiblesCents);
    expect(apres.beneficeBrutCents).toBe(avant.beneficeBrutCents);
  });

  it('déduit en revanche une dépense de même montant NON rattachée', () => {
    // Contre-epreuve : sans le rattachement, la depense est bien une charge.
    const avant = syntheseExercice(base, EXERCICE);
    enregistrerDepense(base, {
      dateDepense: `${EXERCICE}-03-15`,
      libelle: 'Fournitures diverses',
      categorie: 'materiel',
      montantCents: 350_000,
    });
    const apres = syntheseExercice(base, EXERCICE);
    expect(apres.depensesDeductiblesCents - avant.depensesDeductiblesCents).toBe(350_000);
  });

  it('affiche 0 € déductible sur la ligne immobilisée, sans masquer le décaissé', () => {
    const immo = materielImmobilise();
    const { id } = enregistrerDepense(base, {
      dateDepense: `${EXERCICE}-03-15`,
      libelle: 'Achat matériel de crêperie',
      categorie: 'materiel',
      montantCents: 350_000,
      immobilisationId: immo.id,
    });

    const ligne = listerDepenses(base).find((l) => l.id === id);
    expect(ligne?.montantCents).toBe(350_000);
    expect(ligne?.montantDeductibleCents).toBe(0);
    expect(ligne?.immobilisationId).toBe(immo.id);
  });

  it('refuse une dépense rattachée à une immobilisation inconnue', () => {
    // `depense.immobilisation_id` ne porte AUCUNE cle etrangere : sans ce
    // controle applicatif, un identifiant invente etait accepte en silence.
    expect(() =>
      enregistrerDepense(base, {
        dateDepense: `${EXERCICE}-03-15`,
        libelle: 'Achat rattaché à un fantôme',
        categorie: 'materiel',
        montantCents: 350_000,
        immobilisationId: 'immobilisation-qui-n-existe-pas',
      }),
    ).toThrow(ErreurMetier);
  });
});

describe('audit comptabilite — verrou de periode et journal d audit', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  it('journalise la clôture d une période', () => {
    const { id } = cloturerPeriode(base, EXERCICE, 3, 'jean-baptiste');
    const traces = listerJournalAudit(base, { table: 'periode', enregistrementId: id });
    expect(traces.length).toBeGreaterThan(0);
    expect(traces[0]?.valeurApres).toMatchObject({ statut: 'cloturee' });
  });

  it('CONSERVE les deux motifs de deux réouvertures successives', () => {
    // La ligne `periode` ne porte qu'UN couple (date, motif) : au deuxieme
    // cycle, le premier motif est ecrase sans retour. C'est exactement la trace
    // qu'un comptable vient chercher quand un mois clos a bouge deux fois.
    const { id } = cloturerPeriode(base, EXERCICE, 4, null);
    rouvrirPeriode(base, id, 'Facture fournisseur reçue en retard');
    cloturerPeriode(base, EXERCICE, 4, null);
    rouvrirPeriode(base, id, 'Erreur de catégorie sur une dépense');

    const traces = listerJournalAudit(base, { table: 'periode', enregistrementId: id });
    const motifs = traces
      .map((t) => (t.valeurApres as { motifReouverture?: unknown } | null)?.motifReouverture)
      .filter((m): m is string => typeof m === 'string');

    expect(motifs).toContain('Facture fournisseur reçue en retard');
    expect(motifs).toContain('Erreur de catégorie sur une dépense');
  });

  it("n'écrit RIEN au journal quand la réouverture est refusée", () => {
    // Le journal et la modification vivent ou meurent ensemble : une trace de
    // reouverture sans reouverture mentirait autant que l'inverse.
    const { id } = cloturerPeriode(base, EXERCICE, 5, null);
    const avant = listerJournalAudit(base, { table: 'periode', enregistrementId: id }).length;
    expect(() => rouvrirPeriode(base, id, '   ')).toThrow(ErreurMetier);
    expect(listerJournalAudit(base, { table: 'periode', enregistrementId: id }).length).toBe(avant);
  });
});

describe('audit comptabilite — seuils legaux', () => {
  let base: BaseBatte;
  let idLieu: string;

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
        nom: 'La Batte (test seuils)',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  });

  /** Un produit de chaque nature : la ventilation n'a de sens qu'avec les deux. */
  function produits(): { transforme: string; revendu: string } {
    const tous = base
      .select({ id: produitVente.id, nature: produitVente.nature })
      .from(produitVente)
      .all();
    const transforme = tous.find((p) => p.nature === 'transforme');
    const revendu = tous.find((p) => p.nature === 'revendu');
    expect(transforme, 'la démonstration doit fournir un produit transformé').toBeDefined();
    expect(revendu, 'la démonstration doit fournir un produit revendu').toBeDefined();
    return { transforme: transforme!.id, revendu: revendu!.id };
  }

  /** Deux sessions closes : en dessous, `projeterSeuil` refuse de projeter. */
  function deuxSessionsCloses(): void {
    const { transforme, revendu } = produits();
    for (const jour of [`${EXERCICE}-08-03`, `${EXERCICE}-08-10`]) {
      const session = creerSession(base, { lieuId: idLieu, dateSession: jour });
      cloturerSession(base, session.id, {
        ventes: [
          { produitVenteId: transforme, quantite: 60, prixUnitaireCents: 300 },
          { produitVenteId: revendu, quantite: 8, prixUnitaireCents: 650 },
        ],
        frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
        fondsCaisseInitialCents: 6000,
        especesCompteesCents: 6000 + 18_000 + 5200,
        caCarteCents: 0,
        crepesProduites: 70,
        crepesInvendues: 8,
        crepesCassees: 2,
        heureDebutReelle: '08:00',
        heureFinReelle: '14:30',
      });
    }
  }

  it('reconstitue exactement le CA total depuis la ventilation transformé / revendu', () => {
    // Les seuils portent sur le CA, pas sur la marge : si la ventilation
    // pouvait se desynchroniser du total, l'utilisateur sortirait de la
    // franchise TVA sans l'avoir vu venir (CLAUDE.md §6).
    deuxSessionsCloses();
    const seuils = tableauSeuils(base, EXERCICE);
    const realise = seuils.data.map((c) => c.realiseCents);

    expect(seuils.meta.caTransformeCents + seuils.meta.caRevenduCents).toBe(realise[0]);
    expect(seuils.meta.caTransformeCents).toBeGreaterThan(0);
    expect(seuils.meta.caRevenduCents).toBeGreaterThan(0);
  });

  it('projette au rythme du paramètre, et refuse de projeter sous deux sessions', () => {
    const { transforme } = produits();
    const uneSeule = creerSession(base, { lieuId: idLieu, dateSession: `${EXERCICE}-08-03` });
    cloturerSession(base, uneSeule.id, {
      ventes: [{ produitVenteId: transforme, quantite: 60, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 2200, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 18_000,
      caCarteCents: 0,
      crepesProduites: 70,
      crepesInvendues: 8,
      crepesCassees: 2,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
    });

    for (const compteur of tableauSeuils(base, EXERCICE).data) {
      expect(compteur.projectionFinAnneeCents, compteur.libelle).toBeNull();
      expect(compteur.depassementProjete, compteur.libelle).toBe(false);
    }
  });

  /**
   * NON-RÉGRESSION (ex-`it.fails`, corrigé par D-054).
   *
   * `seuil_cotisation_reduite_cents` est décrit dans le catalogue comme un
   * « REVENU NET annuel au-delà duquel le régime de cotisation réduite est
   * perdu ». `tableauSeuils` lui passe pourtant `realiseCents: caTotalCents` —
   * un CHIFFRE D'AFFAIRES. Les deux autres seuils, eux, portent bien sur le CA.
   *
   * Le champ `assiette` est DÉJÀ déclaré sur les trois entrées de `SEUILS`
   * (`depots/sessions.ts`) et n'est lu nulle part : l'intention était là, le
   * câblage manque. Correctif en trois lignes, décrit dans
   * docs/16-AUDIT-COMPTABILITE.md.
   *
   * Corrigé : `assiette: 'revenu_net'` est désormais LU, et le compteur reçoit
   * `syntheseExercice(...).netEstimeCents`.
   */
  it('compare le seuil de cotisation réduite à un REVENU NET, pas à un CA', () => {
    deuxSessionsCloses();
    const seuils = tableauSeuils(base, EXERCICE);
    const cotisation = seuils.data.find((c) => c.cle === 'seuil_cotisation_reduite_cents');
    expect(cotisation, 'le compteur de cotisation réduite doit exister').toBeDefined();

    // La grandeur que ce seuil gouverne est deja calculee par la synthese.
    const netEstimeCents = syntheseExercice(base, EXERCICE).netEstimeCents;
    expect(netEstimeCents).toBeGreaterThan(0);
    expect(cotisation!.realiseCents).toBe(netEstimeCents);
  });

  /**
   * NON-RÉGRESSION — quatrième seuil ajouté : SCE / caisse enregistreuse
   * certifiée (docs/16 §5.6, docs/07 §6.7). Assiette CA de consommation SUR
   * PLACE, jamais le CA total — exactement la même classe d'erreur que
   * D-054 (assiette confondue), ici entre « CA total » et « CA des services
   * de restauration », avec un facteur d'erreur différent.
   *
   * Le seed ne fournit aucun produit en consommation sur place : on active le
   * drapeau sur le produit TRANSFORMÉ uniquement, en laissant le REVENDU à
   * l'emporté. Cela donne une assiette sur place non nulle ET strictement
   * inférieure au CA total, ce qui prouve que le compteur ne retombe pas
   * silencieusement sur le CA total (le défaut exact que la confusion
   * d'assiette produirait).
   */
  it('compare le seuil SCE à un CA DE CONSOMMATION SUR PLACE, jamais au CA total', () => {
    const { transforme } = produits();
    base
      .update(produitVente)
      .set({ consommationSurPlace: true, modifieLe: maintenantUtc() })
      .where(eq(produitVente.id, transforme))
      .run();

    deuxSessionsCloses();

    const seuils = tableauSeuils(base, EXERCICE);
    const sce = seuils.data.find((c) => c.cle === 'seuil_sce_cents');
    expect(sce, 'le compteur SCE doit exister').toBeDefined();

    // Reconstitution INDÉPENDANTE depuis la colonne source, pas depuis
    // `tableauSeuils` lui-même : évite un test tautologique (même piège que
    // documenté dans `comptabilite-seuils-et-audit.test.ts` pour le CA total).
    const caSurPlaceCents = base
      .select({ v: sessionMarche.caSurPlaceCents })
      .from(sessionMarche)
      .where(
        and(
          eq(sessionMarche.statut, 'cloturee'),
          sql`substr(${sessionMarche.dateSession}, 1, 4) = ${String(EXERCICE)}`,
        ),
      )
      .all()
      .reduce((somme, l) => somme + (l.v ?? 0), 0);

    expect(caSurPlaceCents).toBeGreaterThan(0);
    expect(sce!.realiseCents).toBe(caSurPlaceCents);

    const caTotalCents = seuils.data.find(
      (c) => c.cle === 'seuil_franchise_tva_cents',
    )!.realiseCents;
    // Le produit revendu reste vendu à emporter : l'assiette sur place doit
    // rester STRICTEMENT sous le CA total, jamais s'y confondre avec lui.
    expect(sce!.realiseCents).toBeLessThan(caTotalCents);
  });
});

/**
 * G2 (docs/14-TEST-PARCOURS-UTILISATEUR.md) : « BÉNÉFICE BRUT 973,00 € » avec
 * « DÉPENSES DÉDUCTIBLES 0,00 € » pendant que le Journal des achats (Excel) du
 * MÊME écran listait 447,61 € d'achats sur l'exercice — deux exports du même
 * module qui se contredisaient parce que `syntheseExercice` ne lisait jamais
 * la table `reception`.
 *
 * Trois choses a prouver, jamais par une valeur absolue que la graine
 * pourrait deplacer (piege confirme cinq fois) :
 *  1. un achat de marchandise (reception) devient bien une charge deductible,
 *     au centime pres, et seulement pour l'exercice ou il tombe ;
 *  2. un frais de session (emplacement, deplacement, gaz, divers) devient
 *     lui aussi une charge deductible de l'exercice — il ne l'etait nulle
 *     part avant, alors qu'il entrait deja dans la marge NETTE analytique de
 *     la session ;
 *  3. LE PIEGE PRINCIPAL : le cout matiere D'UNE SESSION (grandeur
 *     analytique, deja nette dans sa marge) ne doit RIEN ajouter de plus aux
 *     depenses deductibles de l'EXERCICE au-dela de l'achat et des frais deja
 *     comptes — sinon la meme farine serait deduite deux fois, exactement le
 *     defaut que docs/16 §4.1 a deja corrige une fois pour les immobilisations.
 */
describe('audit comptabilite — achats de marchandises et frais de session (G2)', () => {
  let base: BaseBatte;
  let idFournisseur: string;
  let idLieu: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idFournisseur = nouvelIdentifiant();
    base
      .insert(fournisseur)
      .values({
        id: idFournisseur,
        nom: 'Moulin de test (G2)',
        type: 'moulin',
        delaiLivraisonJours: 3,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
  });

  /**
   * `cloturerSession` refuse une session sans AUCUNE ligne de vente
   * (`session_sans_vente`) : une vente minimale est necessaire pour cloturer,
   * meme quand ce n'est pas ce que le test cherche a mesurer.
   */
  function venteMinimale(): {
    produitVenteId: string;
    quantite: number;
    prixUnitaireCents: number;
  } {
    const produit = base
      .select({ id: produitVente.id, prixCents: produitVente.prixCents })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!;
    return { produitVenteId: produit.id, quantite: 1, prixUnitaireCents: produit.prixCents };
  }

  it('ajoute une réception (achat de marchandise) aux dépenses déductibles, au centime près', () => {
    const avant = syntheseExercice(base, EXERCICE);
    const farine = base
      .select()
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!;

    const { montantTotalCents } = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: `${EXERCICE}-03-10`,
      lignes: [
        {
          ingredientId: farine.id,
          quantite: 25_000,
          prixLigneCents: 2150,
          numeroLotFournisseur: 'LOT-TEST',
        },
      ],
    });
    expect(montantTotalCents).toBeGreaterThan(0);

    const apres = syntheseExercice(base, EXERCICE);
    expect(apres.depensesDeductiblesCents - avant.depensesDeductiblesCents).toBe(montantTotalCents);
    expect(apres.beneficeBrutCents - avant.beneficeBrutCents).toBe(-montantTotalCents);
  });

  it("ignore une réception datée en dehors de l'exercice demandé", () => {
    const avant = syntheseExercice(base, EXERCICE);
    const farine = base
      .select()
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!;

    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: `${EXERCICE + 1}-01-01`,
      lignes: [
        {
          ingredientId: farine.id,
          quantite: 1000,
          prixLigneCents: 500,
          numeroLotFournisseur: 'LOT-TEST',
        },
      ],
    });

    const apres = syntheseExercice(base, EXERCICE);
    expect(apres.depensesDeductiblesCents).toBe(avant.depensesDeductiblesCents);
  });

  it('ajoute les frais de session (emplacement, déplacement, gaz, divers) aux dépenses déductibles', () => {
    const avant = syntheseExercice(base, EXERCICE);
    const vente = venteMinimale();

    const session = creerSession(base, { lieuId: idLieu, dateSession: `${EXERCICE}-03-15` });
    const frais = {
      emplacementCents: 2200,
      deplacementCents: 1400,
      gazCents: 600,
      diversCents: 300,
    };
    cloturerSession(base, session.id, {
      ventes: [vente],
      frais,
      fondsCaisseInitialCents: 0,
      especesCompteesCents: vente.quantite * vente.prixUnitaireCents,
      caCarteCents: 0,
      crepesProduites: vente.quantite,
      crepesInvendues: 0,
      crepesCassees: 0,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
    });

    const apres = syntheseExercice(base, EXERCICE);
    const fraisTotalCents =
      frais.emplacementCents + frais.deplacementCents + frais.gazCents + frais.diversCents;
    // La vente vendue n'est la que pour satisfaire la contrainte de cloture ;
    // seuls les FRAIS doivent expliquer l'ecart de depenses deductibles.
    expect(apres.depensesDeductiblesCents - avant.depensesDeductiblesCents).toBe(fraisTotalCents);
  });

  it(
    'ne compte pas deux fois la matière : le coût matière (comptabilité ANALYTIQUE) ' +
      "d'une session rattachée n'ajoute RIEN de plus aux dépenses déductibles de " +
      "l'exercice (comptabilité GÉNÉRALE) au-delà de l'achat et des frais déjà comptés",
    () => {
      // Achat de TOUTE la matiere necessaire a R1, largement au-dela du besoin :
      // meme patron que `approvisionner()` dans depots/tracabilite.test.ts.
      const tousIngredients = base.select().from(ingredient).all();
      const { montantTotalCents: achatCents } = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: `${EXERCICE}-03-10`,
        lignes: tousIngredients.map((ing) => ({
          ingredientId: ing.id,
          quantite: 100_000,
          prixLigneCents: 1000,
          numeroLotFournisseur: 'LOT-TEST',
        })),
      });
      expect(achatCents).toBeGreaterThan(0);

      // Capture APRES l'achat : seul l'ecart cause par la SESSION qui suit
      // (frais + eventuel cout matiere) doit apparaitre dans la comparaison.
      const avant = syntheseExercice(base, EXERCICE);

      const idR1 = base
        .select({ id: recette.id })
        .from(recette)
        .where(eq(recette.code, 'R1'))
        .get()!.id;
      const session = creerSession(base, { lieuId: idLieu, dateSession: `${EXERCICE}-03-15` });
      const production = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: `${EXERCICE}-03-15`,
        sessionId: session.id,
      });

      const frais = {
        emplacementCents: 2200,
        deplacementCents: 1400,
        gazCents: 600,
        diversCents: 0,
      };
      // `cloturerSession` refuse une session sans aucune vente : une ligne
      // minimale, sans lien avec la recette produite (aucune vente de
      // "transforme" ne deduit de stock — la consommation a deja eu lieu a la
      // PRODUCTION), suffit a satisfaire la contrainte.
      const vente = venteMinimale();
      cloturerSession(base, session.id, {
        ventes: [vente],
        frais,
        fondsCaisseInitialCents: 0,
        especesCompteesCents: vente.quantite * vente.prixUnitaireCents,
        caCarteCents: 0,
        // `crepesProduites` omis volontairement : une production est rattachee,
        // le nombre de crepes produites se DERIVE d'elle
        // (`resoudreCrepesProduites`).
        crepesInvendues: production.crepesTheoriques,
        crepesCassees: 0,
        heureDebutReelle: '08:00',
        heureFinReelle: '14:30',
      });

      const sessionFermee = base
        .select({ coutMatiereCents: sessionMarche.coutMatiereCents })
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      // La session porte bien un cout matiere reel non nul (la farine a ete
      // consommee FEFO) : sans cette assertion, le test prouverait une
      // absence de double comptage... d'un cout qui ne serait jamais compte.
      expect(sessionFermee.coutMatiereCents).toBeGreaterThan(0);

      const apres = syntheseExercice(base, EXERCICE);
      const fraisTotalCents =
        frais.emplacementCents + frais.deplacementCents + frais.gazCents + frais.diversCents;

      // Le SEUL ecart admissible entre avant et apres est celui des FRAIS de
      // session : le cout matiere (analytique) de la production rattachee
      // n'ajoute rien, parce que la farine est deja comptee via l'achat
      // (reception) capture avant `avant`.
      expect(apres.depensesDeductiblesCents - avant.depensesDeductiblesCents).toBe(fraisTotalCents);
      // La vente minimale explique tout l'ecart de recettes : rien d'autre ne
      // doit avoir bouge le CA.
      expect(apres.recettesCents - avant.recettesCents).toBe(
        vente.quantite * vente.prixUnitaireCents,
      );
    },
  );

  it("expose `totalAchatsMarchandisesCents` comme la SEULE source de l'achat dans la synthèse", () => {
    // Sans depense manuelle ni frais de session ni amortissement sur cet
    // exercice, `depensesDeductiblesCents` de la synthese doit reconstituer
    // EXACTEMENT `totalAchatsMarchandisesCents` — c'est l'invariant que doit
    // aussi verifier, cote apps/api, la comparaison avec `donneesJournalAchats`
    // (meme table, meme colonne, meme fenetre de dates — voir
    // apps/api/src/documents/journal-achats-synthese.test.ts).
    const farine = base
      .select()
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!;
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: `${EXERCICE}-05-05`,
      lignes: [
        {
          ingredientId: farine.id,
          quantite: 10_000,
          prixLigneCents: 890,
          numeroLotFournisseur: 'LOT-TEST',
        },
      ],
    });

    const total = totalAchatsMarchandisesCents(base, EXERCICE);
    expect(total).toBeGreaterThan(0);
    expect(syntheseExercice(base, EXERCICE).depensesDeductiblesCents).toBe(total);
  });
});
