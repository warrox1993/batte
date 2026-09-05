/**
 * LA DEMONSTRATION EST-ELLE UNE DEMONSTRATION ?
 *
 * Ce fichier ne teste aucun service : il teste le JEU DE DONNEES lui-meme.
 * Sa raison d'etre tient en une phrase de `CLAUDE.md` §6 :
 *
 *   « à marge égale, la revente génère environ 2,6 fois plus de chiffre
 *     d'affaires que la crêpe. Or les seuils légaux portent sur le CA, pas sur
 *     la marge. L'application doit donc afficher les compteurs de seuils avec la
 *     ventilation transformé / revendu, sans quoi l'utilisateur se retrouvera
 *     hors franchise TVA sans l'avoir vu venir. »
 *
 * Pendant plusieurs lots, la graine ne contenait AUCUN produit de nature
 * `revendu`. La ventilation affichait donc 100 % transformé, les compteurs de
 * seuils ne ventilaient rien, et le type de mouvement `sortie_vente` — declare
 * au schema, code au service de cloture — n'etait emis nulle part. Le risque
 * financier numero un du produit etait invisible a la premiere ouverture.
 *
 * Regle de redaction : aucune assertion ne recopie un montant de la graine.
 * Chaque nombre attendu est DERIVE de ce que la base contient (somme des lignes
 * de vente, prix du conditionnement, restant des lots). Un test qui recopierait
 * les constantes de `activite.ts` passerait meme si la chaine etait rompue.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from './index.js';
import { seedDemonstration, NOM_PRODUIT_CAFE, CODE_RECETTE_VIDE_CAFE } from './demonstration.js';
import { seedDemonstrationActivite } from './activite.js';
import {
  conditionnement,
  ingredient,
  lot,
  mouvementStock,
  produitVente,
  recette,
  recetteLigne,
  sessionMarche,
  sessionVente,
} from '../schema.js';
import { lotsDeLIngredient, verifierInvariantLots } from '../depots/stock.js';
import { tableauSeuils } from '../depots/sessions.js';
import { tracabiliteAmontSession, tracabiliteAvalLot } from '../depots/tracabilite.js';
import { listerComposantsDuProduit } from '../depots/nomenclature-vente.js';
import { cumulerComposantsVendus, schemaSaisieProduit } from '@batte/core';

/** Base complete : parametres reels, referentiel de demo, historique de demo. */
function baseInstallee(): BaseBatte {
  const base = creerBase(':memory:');
  migrer(base);
  seed(base);
  seedDemonstration(base);
  seedDemonstrationActivite(base);
  return base;
}

/** La session close installee par la graine. Point de depart de tout le reste. */
function sessionClose(base: BaseBatte) {
  return base.select().from(sessionMarche).where(eq(sessionMarche.statut, 'cloturee')).get()!;
}

/** L'unique produit de nature `revendu` du catalogue de demonstration. */
function produitRevendu(base: BaseBatte) {
  return base.select().from(produitVente).where(eq(produitVente.nature, 'revendu')).get()!;
}

describe('jeu de démonstration — le catalogue porte les DEUX natures de produit', () => {
  let base: BaseBatte;

  beforeAll(() => {
    base = baseInstallee();
  });

  it('contient au moins un produit transformé ET un produit revendu', () => {
    const produits = base.select().from(produitVente).all();

    expect(produits.filter((p) => p.nature === 'transforme').length).toBeGreaterThan(0);
    // LE défaut que ce fichier existe pour empêcher de revenir.
    expect(produits.filter((p) => p.nature === 'revendu').length).toBeGreaterThan(0);
  });

  it("un produit revendu pointe un ingrédient et aucune recette ; l'inverse pour un transformé — y compris le café, transformé À LA DEMANDE, qui porte désormais une recette VIDE", () => {
    for (const produit of base.select().from(produitVente).all()) {
      if (produit.nature === 'revendu') {
        expect(produit.ingredientId).not.toBeNull();
        expect(produit.recetteId).toBeNull();
        // `nbCrepes` non nul ferait compter des crêpes jamais cuites dans le
        // taux d'écoulement et dans le coût matière par crêpe.
        expect(produit.nbCrepes).toBeNull();
      } else if (produit.nom === NOM_PRODUIT_CAFE) {
        /**
         * Le CAFÉ (fiche 15 §4) est un `transforme` À LA DEMANDE : il ne se
         * produit pas par fournée, il se fait à la tasse, et sa composition
         * vient ENTIÈREMENT de la nomenclature de vente
         * (`produit_vente_composant`), jamais d'une recette de production —
         * voir le commentaire de tête sur sa définition dans
         * `demonstration.ts`.
         *
         * DÉCISION DU PORTEUR (31/07/2026) : `verifierCoherenceProduit`
         * (`packages/core/src/contrats/referentiel.ts`) exige qu'un
         * `transforme` porte une recette. Le café en reçoit donc une, mais
         * délibérément VIDE (`CODE_RECETTE_VIDE_CAFE`, voir les tests
         * dédiés ci-dessous) : `recetteId` n'est donc PLUS `null` ici.
         */
        expect(produit.recetteId).not.toBeNull();
        expect(produit.ingredientId).toBeNull();
        /**
         * `consommationUnite = 'nomenclature'` (REFONTE DU 31/07/2026) :
         * c'est CE champ qui dit désormais que le café ne consomme rien de la
         * production — jamais plus une déduction depuis `nbCrepes = 0`, qui
         * portait AUSSI le sens « pâte vendue au volume » (fiche 15 §5.1) et
         * que la validation ne pouvait pas distinguer. Voir le commentaire
         * complet dans `demonstration.ts` (définition de `PRODUITS`).
         */
        expect(produit.consommationUnite).toBe('nomenclature');
        // `nbCrepes = 0`, explicitement : le café ne consomme aucune crêpe —
        // MÊME valeur qu'avant cette refonte, pour la même raison. Ce qui a
        // changé, c'est que `consommationUnite` porte désormais CE sens, et
        // non plus une déduction : `estPateVendueAuVolume` (`@batte/core`)
        // rend maintenant FAUX pour le café (elle rendait VRAI, À TORT, avant
        // cette décision — voir le test dédié dans `sessions.test.ts`).
        expect(produit.nbCrepes).toBe(0);
      } else {
        expect(produit.recetteId).not.toBeNull();
        expect(produit.ingredientId).toBeNull();
      }
    }
  });

  it('la marge théorique de revente tombe dans la fourchette 30–40 % de CLAUDE.md §6', () => {
    const produit = produitRevendu(base);

    // Prix d'achat DERIVE du conditionnement : prix du carton / nombre de pots.
    // Aucun littéral de coût dans ce test.
    const format = base
      .select()
      .from(conditionnement)
      .where(eq(conditionnement.ingredientId, produit.ingredientId!))
      .get()!;
    const prixAchatUnitaireCents = format.prixCents / format.quantiteUniteRef;

    const margeBp = Math.round(
      ((produit.prixCents - prixAchatUnitaireCents) / produit.prixCents) * 10_000,
    );

    expect(margeBp).toBeGreaterThanOrEqual(3000);
    expect(margeBp).toBeLessThanOrEqual(4000);
  });
});

/**
 * LE CAFÉ démontre le LOT DE RÉFÉRENCE (fiche 15 §4) : la nomenclature de
 * vente était déjà écrite et testée (`packages/core/src/nomenclature-vente.ts`),
 * mais rien, nulle part, ne montrait un café qui fonctionne — ni catégorie
 * d'ingrédient honnête pour le café moulu et la cannelle (corrigé le
 * 31/07/2026 par l'ajout de `'boisson'`), ni exemple dans le jeu de
 * démonstration. Ces tests le comblent.
 *
 * AUCUNE assertion ne recopie un montant de la graine (même règle que le
 * reste de ce fichier) : chaque nombre attendu est DÉRIVÉ de ce que la base
 * contient (conditionnement actif, quantités déclarées).
 */
describe('jeu de démonstration — le café démontre le lot de référence (fiche 15 §4)', () => {
  let base: BaseBatte;

  beforeAll(() => {
    base = baseInstallee();
  });

  function produitCafe() {
    return base.select().from(produitVente).where(eq(produitVente.nom, NOM_PRODUIT_CAFE)).get()!;
  }

  it('le café est un TRANSFORMÉ À LA DEMANDE : sa composition vient entièrement de la nomenclature de vente, jamais de sa recette (délibérément VIDE)', () => {
    const produit = produitCafe();

    expect(produit.nature).toBe('transforme');
    // Recette VIDE (décision du porteur, 31/07/2026) : elle existe pour
    // satisfaire `verifierCoherenceProduit`, jamais pour être produite — voir
    // le describe dédié plus bas (« la recette VIDE du café… »).
    expect(produit.recetteId).not.toBeNull();
    // Zéro EXPLICITE (« cette unité ne consomme aucune crêpe »), jamais `null`.
    expect(produit.nbCrepes).toBe(0);

    const composants = listerComposantsDuProduit(base, produit.id);
    expect(composants.length).toBeGreaterThan(0);
  });

  it('le gobelet est déclaré à un lot de référence de 1 : un gobelet par café, le cas courant', () => {
    const composants = listerComposantsDuProduit(base, produitCafe().id);
    const gobelet = composants.find((c) => c.nomIngredient === 'Gobelet carton');

    expect(gobelet).toBeDefined();
    expect(gobelet!.quantiteReferenceUnites).toBe(1);
  });

  /**
   * LE PIÈGE (fiche 15 §4.1), sur les DONNÉES RÉELLEMENT SEMÉES : une pincée
   * de cannelle à 0,2 g par tasse s'arrondirait à 0 g si elle était déclarée
   * « pour 1 café ». `COMPOSANTS_CAFE` (`demonstration.ts`) la déclare donc
   * pour un lot de référence de 100 cafés — jamais 1 pour 1, contrairement au
   * gobelet ci-dessus. Un jeu de démonstration qui ne porterait qu'un ratio
   * 1:1 partout n'illustrerait rien.
   */
  it("la cannelle est déclarée pour un lot de référence d'au moins 100 cafés, à l'opposé du gobelet", () => {
    const composants = listerComposantsDuProduit(base, produitCafe().id);
    const cannelle = composants.find((c) => c.nomIngredient === 'Cannelle');
    const gobelet = composants.find((c) => c.nomIngredient === 'Gobelet carton');

    expect(cannelle).toBeDefined();
    expect(cannelle!.quantiteReferenceUnites).toBeGreaterThanOrEqual(100);
    expect(cannelle!.quantiteReferenceUnites).toBeGreaterThan(gobelet!.quantiteReferenceUnites);
  });

  it("le coût indicatif de la cannelle N'EST PAS NUL, malgré 0,2 g par tasse — c'est tout l'intérêt du lot de référence", () => {
    const cannelle = listerComposantsDuProduit(base, produitCafe().id).find(
      (c) => c.nomIngredient === 'Cannelle',
    )!;

    // Le coût unitaire courant doit être CONNU (un conditionnement actif
    // existe) : sans lui, un coût indicatif à 0 prouverait un prix inconnu,
    // pas un lot de référence qui fonctionne. `cumpCentsParUnite` est
    // désormais nullable (un composant jamais acheté a un prix INCONNU,
    // jamais gratuit) : cette graine réelle en achète un, donc il ne doit
    // JAMAIS l'être ici — l'échec explicite vaut mieux qu'un `!`/cast qui
    // masquerait une régression de la graine.
    const cumpCannelle = cannelle.cumpCentsParUnite;
    if (cumpCannelle === null) {
      throw new Error('La cannelle de la graine de démonstration doit avoir un prix connu.');
    }
    expect(cumpCannelle).toBeGreaterThan(0);
    expect(cannelle.coutIndicatifCentsParUnite).toBeGreaterThan(0);

    // Dérivé, pas recopié : 0,2 g/café (20 g pour 100) au coût courant du
    // conditionnement — voir `coutIndicatifComposantCents` (`@batte/core`),
    // délibérément NON arrondi.
    const attendu = (cannelle.quantiteUniteRef / cannelle.quantiteReferenceUnites) * cumpCannelle;
    expect(cannelle.coutIndicatifCentsParUnite).toBeCloseTo(attendu, 10);
  });

  /**
   * Le piège en vraie grandeur : 80 cafés vendus UN À LA FOIS (jamais une
   * vente de 80 d'un coup) doivent faire sortir un poids de cannelle NON NUL.
   * `cumulerComposantsVendus` (`@batte/core`) est la fonction pure qui protège
   * ce cumul — déjà testée pour elle-même dans
   * `packages/core/src/nomenclature-vente.test.ts`. Ce test-ci vérifie qu'elle
   * reçoit bien, depuis la graine RÉELLE (pas un composant fabriqué pour
   * l'occasion), une cannelle dont le lot de référence est assez grand pour ne
   * PAS s'évaporer — et rejoue, en contraste, le défaut qu'une déclaration
   * « pour 1 café » aurait produit.
   */
  it('quatre-vingts cafés vendus un par un font sortir un poids de cannelle NON NUL — la même, mal déclarée « pour 1 », ferait sortir zéro', () => {
    const cannelle = listerComposantsDuProduit(base, produitCafe().id).find(
      (c) => c.nomIngredient === 'Cannelle',
    )!;

    const quatreVingtsVentesUnitaires = Array.from({ length: 80 }, () => ({
      quantite: 1,
      consommationSurPlace: false,
      composants: [cannelle],
    }));
    const cumul = cumulerComposantsVendus(quatreVingtsVentesUnitaires);

    expect(cumul.get(cannelle.ingredientId)).toBeGreaterThan(0);

    // Contre-épreuve : la MÊME cannelle, mais déclarée « pour 1 café » — 0,2 g
    // déjà arrondis à 0 g AVANT même la déclaration, faute d'un entier possible
    // (règle n°4 de CLAUDE.md). C'est exactement le défaut que le lot de
    // référence de 100 évite ci-dessus.
    const cannelleMalDeclaree = { ...cannelle, quantiteUniteRef: 0, quantiteReferenceUnites: 1 };
    const cumulMalDeclare = cumulerComposantsVendus(
      Array.from({ length: 80 }, () => ({
        quantite: 1,
        consommationSurPlace: false,
        composants: [cannelleMalDeclaree],
      })),
    );
    expect(cumulMalDeclare.has(cannelle.ingredientId)).toBe(false);
  });
});

/**
 * La recette VIDE du café (fiche 15 §4, décision du porteur, 31/07/2026) :
 * ni un défaut de la graine, ni un contournement — un choix assumé pour
 * satisfaire `verifierCoherenceProduit` (`packages/core/src/contrats/
 * referentiel.ts`, hors zone d'écriture de ce chantier) sans quatrième nature
 * de produit ni assouplissement de la règle.
 */
describe('jeu de démonstration — la recette VIDE du café (fiche 15 §4, décision du porteur)', () => {
  let base: BaseBatte;

  beforeAll(() => {
    base = baseInstallee();
  });

  function recetteVideCafe() {
    return base.select().from(recette).where(eq(recette.code, CODE_RECETTE_VIDE_CAFE)).get()!;
  }

  it("n'a AUCUNE ligne : sa seule fonction est de satisfaire le rattachement, jamais de décrire une composition", () => {
    const r = recetteVideCafe();
    const lignes = base.select().from(recetteLigne).where(eq(recetteLigne.recetteId, r.id)).all();

    expect(lignes).toHaveLength(0);
  });

  it("reste EN BROUILLON, jamais active : `dateActivation` est `null`, comme une recette qu'on n'a jamais eu l'intention de produire", () => {
    const r = recetteVideCafe();

    expect(r.statut).toBe('brouillon');
    expect(r.dateActivation).toBeNull();
  });

  /**
   * NON-RÉGRESSION (ex-`it.fails`, CORRIGÉ et converti — décision du porteur
   * du 31/07/2026, fiche 15 §4/§5.1).
   *
   * LE DÉFAUT D'ORIGINE, encodé ici jusqu'à cette date : la recette VIDE
   * réglait le premier blocage (`recetteId === null`), mais
   * `verifierCoherenceProduit` portait une SECONDE règle, indépendante :
   * `saisie.nbCrepes === 0 && saisie.volumeMlParUnite === null` était
   * interprété comme « pâte vendue au volume » (fiche 15 §5.1) et EXIGEAIT un
   * `volumeMlParUnite`. Le café utilise `nbCrepes = 0` pour une raison
   * DIFFÉRENTE (« cette unité ne consomme aucune crêpe », fiche 15 §4) : il
   * n'est PAS de la pâte vendue au volume, et ne DOIT PAS avoir de
   * `volumeMlParUnite` — mais les deux situations partageaient le même signal
   * (`nbCrepes === 0`), sans que rien ne les distingue. Rouvrir la fiche du
   * café dans l'écran Produits et l'enregistrer SANS RIEN CHANGER échouait
   * donc TOUJOURS en 422.
   *
   * LE CORRECTIF : `produit_vente.consommation_unite`
   * (`packages/db/src/schema.ts`, migration 0029) NOMME désormais le cas
   * plutôt que de le déduire — `'crepes' | 'volume_pate' | 'nomenclature'`,
   * jamais deux à la fois. Le café porte `'nomenclature'` (voir
   * `demonstration.ts`, définition de `PRODUITS`) : `verifierCoherenceProduit`
   * (`packages/core/src/contrats/referentiel.ts`,
   * `verifierConsommationUniteTransforme`) n'exige alors NI `nbCrepes` NI
   * `volumeMlParUnite` renseignés — seulement que `nbCrepes` reste à `0` (la
   * même valeur explicite qu'avant) et que `volumeMlParUnite` reste `null`.
   * Le test s'est donc mis à PASSER, donc à ÉCHOUER en tant qu'`it.fails` —
   * ce qui a forcé sa conversion, comme le veut la convention du dépôt.
   */
  it(
    'le café tel que semé passe `schemaSaisieProduit.parse()` — la PREUVE que rouvrir sa fiche ' +
      "dans l'écran Produits et l'enregistrer SANS RIEN CHANGER n'échoue plus en 422",
    () => {
      const cafe = base
        .select()
        .from(produitVente)
        .where(eq(produitVente.nom, NOM_PRODUIT_CAFE))
        .get()!;

      // EXACTEMENT la forme que l'écran Produits soumet à la ré-enregistrement
      // (`SaisieProduitBrute`) : les mêmes valeurs que celles déjà en base,
      // aucune modification — `consommationUnite` compris, désormais.
      expect(() =>
        schemaSaisieProduit.parse({
          nom: cafe.nom,
          nature: cafe.nature,
          recetteId: cafe.recetteId,
          ingredientId: cafe.ingredientId,
          prixCents: cafe.prixCents,
          consommationUnite: cafe.consommationUnite,
          nbCrepes: cafe.nbCrepes,
          volumeMlParUnite: cafe.volumeMlParUnite,
          categorie: cafe.categorie,
          consommationSurPlace: cafe.consommationSurPlace,
        }),
      ).not.toThrow();
    },
  );
});

describe('jeu de démonstration — la chaîne de revente va de la réception à la vente', () => {
  let base: BaseBatte;

  beforeAll(() => {
    base = baseInstallee();
  });

  it('la réception a créé plusieurs lots de l’article revendu, avec des DLC distinctes', () => {
    const produit = produitRevendu(base);
    const lots = base.select().from(lot).where(eq(lot.ingredientId, produit.ingredientId!)).all();

    expect(lots.length).toBeGreaterThanOrEqual(2);
    // Une DLC par lot : sans elle, la FEFO n'a rien à ordonner et l'AFSCA rien
    // à contrôler. Deux DLC DIFFÉRENTES : sinon la FEFO est indiscernable d'un
    // simple décompte.
    for (const l of lots) expect(l.dateDlc).not.toBeNull();
    expect(new Set(lots.map((l) => l.dateDlc)).size).toBe(lots.length);
  });

  it('la clôture a émis des mouvements `sortie_vente`, en FEFO, et le stock a baissé', () => {
    const produit = produitRevendu(base);
    const session = sessionClose(base);

    const sorties = base
      .select()
      .from(mouvementStock)
      .where(
        and(
          eq(mouvementStock.ingredientId, produit.ingredientId!),
          eq(mouvementStock.type, 'sortie_vente'),
        ),
      )
      .all();

    expect(sorties.length).toBeGreaterThan(0);
    // Chaque sortie est rattachée à la session : c'est le seul lien entre une
    // vente et le stock qu'elle a consommé.
    for (const s of sorties) expect(s.sessionId).toBe(session.id);

    // La quantité sortie ÉGALE la quantité vendue, lue dans les lignes de vente.
    const venduDansLaSession = base
      .select({ quantite: sessionVente.quantite })
      .from(sessionVente)
      .where(
        and(eq(sessionVente.sessionId, session.id), eq(sessionVente.produitVenteId, produit.id)),
      )
      .all()
      .reduce((total, l) => total + l.quantite, 0);

    expect(sorties.reduce((total, s) => total + s.quantite, 0)).toBe(venduDansLaSession);

    // FEFO : le lot dont la DLC est la plus proche est VIDÉ avant que le second
    // ne soit entamé.
    const lots = lotsDeLIngredient(base, produit.ingredientId!);
    const [plusUrgent, ...suivants] = [...lots].sort((a, b) =>
      (a.dateDlc ?? '9999').localeCompare(b.dateDlc ?? '9999'),
    );
    expect(plusUrgent!.quantiteRestante).toBe(0);
    expect(suivants.reduce((total, l) => total + l.quantiteRestante, 0)).toBeGreaterThan(0);

    // Le stock restant est bien la différence : la règle n°5 (« le stock ne se
    // modifie que par un mouvement ») tient sur le chemin de la vente aussi.
    const entre = lots.reduce((total, l) => total + l.quantiteInitiale, 0);
    expect(lots.reduce((total, l) => total + l.quantiteRestante, 0)).toBe(
      entre - venduDansLaSession,
    );

    expect(verifierInvariantLots(base)).toEqual([]);
  });
});

describe('jeu de démonstration — les compteurs de seuils ventilent vraiment', () => {
  let base: BaseBatte;

  beforeAll(() => {
    base = baseInstallee();
  });

  it('la session close porte un CA transformé ET un CA revendu, tous deux non nuls', () => {
    const session = sessionClose(base);

    expect(session.caRevenduCents).toBeGreaterThan(0);
    expect(session.caTransformeCents).toBeGreaterThan(0);
    // La ventilation est exhaustive : rien ne se perd entre les deux natures.
    expect(session.caTransformeCents! + session.caRevenduCents!).toBe(session.caTotalCents);

    // Le CA total est la somme des lignes, jamais un total saisi.
    const caDesLignes = base
      .select()
      .from(sessionVente)
      .where(eq(sessionVente.sessionId, session.id))
      .all()
      .reduce((total, l) => total + l.montantCents, 0);
    expect(session.caTotalCents).toBe(caDesLignes);
  });

  it('`tableauSeuils` remonte la ventilation, avec une part revendue non nulle', () => {
    const session = sessionClose(base);
    const annee = Number.parseInt(session.dateSession.slice(0, 4), 10);
    const seuils = tableauSeuils(base, annee);

    expect(seuils.meta.caRevenduCents).toBeGreaterThan(0);
    expect(seuils.meta.caTransformeCents).toBeGreaterThan(0);
    // Sans cette assertion, un compteur figé à zéro passerait pour une
    // ventilation correcte — c'était exactement l'état d'avant.
    expect(seuils.meta.partRevenduBp).toBeGreaterThan(0);
    expect(seuils.meta.partRevenduBp).toBeLessThan(10_000);

    // Les plafonds viennent de `parametre`, jamais d'un littéral : ce test ne
    // doit contenir aucun seuil légal.
    for (const compteur of seuils.data) {
      expect(compteur.plafondCents).toBeGreaterThan(0);
      // Le realise depend de l'ASSIETTE du seuil : deux portent sur le chiffre
      // d'affaires, le troisieme sur un revenu net — grandeur toujours
      // moindre. Asserter le CA pour les trois figeait le defaut au lieu de le
      // detecter (D-054).
      expect(compteur.realiseCents).toBeLessThanOrEqual(session.caTotalCents!);
      expect(compteur.realiseCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('la part revendue pèse davantage dans le CA que dans la marge — le risque de §6', () => {
    const session = sessionClose(base);

    /**
     * Cout d'achat des marchandises revendues, lu sur les MOUVEMENTS.
     *
     * C'est la source de verite : `sortirLesProduitsRevendus` valorise chaque
     * allocation au lot effectivement consomme (D-044). Le reconstituer depuis
     * `conditionnement.prixCents / quantiteUniteRef` donnerait un taux moyen,
     * donc un chiffre voisin mais faux des qu'il existe deux lots de prix
     * differents — ce qui est precisement le cas du jeu de demonstration.
     */
    const coutRevenduCents = base
      .select({ cout: mouvementStock.coutCents })
      .from(mouvementStock)
      .where(
        and(
          eq(mouvementStock.sessionId, session.id),
          eq(mouvementStock.type, 'sortie_vente'),
          eq(mouvementStock.isAnnule, false),
        ),
      )
      .all()
      .reduce((total, m) => total + (m.cout ?? 0), 0);

    expect(coutRevenduCents).toBeGreaterThan(0);

    // `coutMatiereCents` porte desormais les DEUX couts (D-049) : on en retire
    // la part revendue pour isoler celle du transforme.
    const margeRevendueCents = session.caRevenduCents! - coutRevenduCents;
    const margeTransformeeCents =
      session.caTransformeCents! - (session.coutMatiereCents! - coutRevenduCents);

    const partCaBp = Math.round((session.caRevenduCents! / session.caTotalCents!) * 10_000);
    const partMargeBp = Math.round(
      (margeRevendueCents / (margeRevendueCents + margeTransformeeCents)) * 10_000,
    );

    // C'est TOUT le sujet : la revente prend une place bien plus grande dans le
    // chiffre d'affaires — celui que les seuils légaux mesurent — que dans la
    // marge, celle qui fait vivre l'activité.
    expect(partCaBp).toBeGreaterThan(partMargeBp);
  });
});

describe('jeu de démonstration — traçabilité', () => {
  let base: BaseBatte;

  beforeAll(() => {
    base = baseInstallee();
  });

  it('la traçabilité amont remonte de la session jusqu’aux lots fournisseur de la pâte', () => {
    const session = sessionClose(base);
    const amont = tracabiliteAmontSession(base, session.id);

    expect(amont.productions.length).toBeGreaterThan(0);
    const consommations = amont.productions.flatMap((p) => p.consommations);
    expect(consommations.length).toBeGreaterThan(0);
    for (const c of consommations) {
      expect(c.receptionNumero).not.toBe('');
      expect(c.fournisseurNom).not.toBe('');
    }
  });

  /**
   * NON-RÉGRESSION (ex-`it.fails`, corrigé par D-049).
   *
   * `tracabiliteAmontSession` ne parcourait que `production_consommation`. Un
   * article REVENDU ne passe par AUCUNE production : son lot n'est relié à la
   * session que par `mouvement_stock`. Conséquence réglementaire : en cas de
   * rappel sur un lot de sirop, l'application ne disait pas dans quelles
   * sessions il avait été vendu.
   *
   * Le lot revendu est rendu dans un bloc `revendus` DISTINCT, et non greffé
   * dans `productions[].consommations` : l'y mettre fabriquerait une production
   * qui n'a jamais eu lieu, dans le document même qui sert à prouver ce qui
   * s'est réellement passé.
   */
  it('la traçabilité amont remonte au lot fournisseur de l’article REVENDU', () => {
    const session = sessionClose(base);
    const produit = produitRevendu(base);
    const amont = tracabiliteAmontSession(base, session.id);

    // Il n'est PAS dans les productions, et c'est voulu.
    const viaProductions = new Set(
      amont.productions.flatMap((p) => p.consommations).map((c) => c.ingredientId),
    );
    expect(viaProductions.has(produit.ingredientId!)).toBe(false);

    const revendus = amont.revendus.filter((r) => r.ingredientId === produit.ingredientId);
    expect(revendus.length).toBeGreaterThan(0);

    // La chaîne complète est là : c'est elle qui rend le registre exploitable.
    for (const r of revendus) {
      expect(r.quantite).toBeGreaterThan(0);
      expect(r.fournisseurNom).not.toBe('');
      expect(r.receptionNumero).not.toBe('');
    }
  });

  /** L'autre sens : d'un lot rappelé vers les sessions où il est parti. */
  it('la traçabilité aval nomme les sessions où un lot REVENDU a été vendu', () => {
    const session = sessionClose(base);
    const produit = produitRevendu(base);
    const amont = tracabiliteAmontSession(base, session.id);

    const lotVendu = amont.revendus.find((r) => r.ingredientId === produit.ingredientId);
    expect(lotVendu).toBeDefined();

    const aval = tracabiliteAvalLot(base, lotVendu!.lotId);

    // Aucune production ne l'a consommé — la réponse ne peut venir que des ventes.
    expect(aval.productions).toHaveLength(0);
    expect(aval.ventes.length).toBeGreaterThan(0);
    expect(aval.ventes.map((v) => v.session.id)).toContain(session.id);
  });
});

describe('jeu de démonstration — défauts connus du calcul de marge', () => {
  let base: BaseBatte;

  beforeAll(() => {
    base = baseInstallee();
  });

  /**
   * Test de NON-RÉGRESSION — ex-`it.fails`, CORRIGÉ et converti.
   *
   * Le défaut : `cloturerSession` calculait `cout_matiere_cents` à partir des
   * seules PRODUCTIONS rattachées à la session. Le coût des marchandises
   * REVENDUES était pourtant connu au centime près — `sortirLesProduitsRevendus`
   * l'écrit dans `mouvement_stock.cout_cents` en FEFO, lot par lot — mais
   * personne ne le relisait. La marge brute ignorait donc l'achat des pots.
   *
   * Effet mesuré sur le jeu de démonstration : marge brute affichée ≈ 96 % du CA
   * alors que la moitié de ce CA venait d'une revente à ~36 % de marge. C'est
   * exactement l'illusion que `CLAUDE.md` §6 demande de dissiper.
   *
   * Le correctif vit dans `packages/db/src/services/sessions.ts` : le coût
   * matière additionne désormais les `cout_cents` des mouvements `sortie_vente`
   * de la session. Le test s'est donc mis à PASSER, donc à ÉCHOUER en tant
   * qu'`it.fails` — ce qui a forcé sa conversion, comme le veut la convention
   * du dépôt. Il garde maintenant le correctif : si quelqu'un remet le coût
   * matière au seul périmètre des productions, ce test redevient rouge.
   */
  it('le coût des marchandises revendues entre dans le coût matière', () => {
    const session = sessionClose(base);

    const coutRevenduCents = base
      .select({ coutCents: mouvementStock.coutCents })
      .from(mouvementStock)
      .where(and(eq(mouvementStock.sessionId, session.id), eq(mouvementStock.type, 'sortie_vente')))
      .all()
      .reduce((total, m) => total + m.coutCents, 0);

    expect(coutRevenduCents).toBeGreaterThan(0);
    expect(session.coutMatiereCents).toBeGreaterThanOrEqual(coutRevenduCents);
  });
});

describe('jeu de démonstration — idempotence', () => {
  it('relancer les deux graines n’insère rien et ne modifie plus rien', () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const premierReferentiel = seedDemonstration(base);
    const premiereActivite = seedDemonstrationActivite(base);

    // La première passe doit avoir réellement écrit quelque chose, sinon
    // l'égalité à zéro de la seconde ne prouverait rien.
    expect(premierReferentiel.ingredients).toBeGreaterThan(0);
    expect(premierReferentiel.produits).toBeGreaterThan(0);
    expect(premiereActivite.receptions).toBeGreaterThan(0);
    expect(premiereActivite.sessionsCloturees).toBe(1);

    const secondReferentiel = seedDemonstration(base);
    const secondeActivite = seedDemonstrationActivite(base);

    /**
     * L'invariant est « AUCUN compteur n'a bouge », pas « voici les sept
     * compteurs ».
     *
     * La version precedente comparait la forme exacte de l'objet : elle a
     * casse le jour ou la graine a gagne une categorie (`garnitures`), alors
     * que l'idempotence — la seule chose testee ici — restait parfaite. C'est
     * la quatrieme fois sur ce projet qu'une assertion sur une valeur absolue
     * casse pour une raison sans rapport avec ce qu'elle verifie.
     *
     * Ecrite ainsi, elle couvre AUSSI les categories qui n'existent pas encore.
     */
    for (const [categorie, compte] of Object.entries(secondReferentiel)) {
      expect(compte, `referentiel.${categorie}`).toBe(0);
    }
    for (const [categorie, valeur] of Object.entries(secondeActivite)) {
      // `ecartsStock` est une liste, les autres sont des compteurs : dans les
      // deux cas, « rien de nouveau » se lit par une longueur ou un zero.
      const compte = Array.isArray(valeur) ? valeur.length : valeur;
      expect(compte, `activite.${categorie}`).toBe(0);
    }

    // Compteur indépendant : rien n'a été dupliqué en base non plus.
    expect(base.select().from(ingredient).all()).toHaveLength(premierReferentiel.ingredients);
    expect(base.select().from(produitVente).all()).toHaveLength(premierReferentiel.produits);
    expect(
      base.select().from(sessionMarche).where(eq(sessionMarche.statut, 'cloturee')).all(),
    ).toHaveLength(1);
  });

  it('la graine de démonstration ne fait rien tant que le référentiel est absent', () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);

    // Aucun lieu, aucun ingrédient : l'historique n'a rien sur quoi s'appuyer.
    // Il doit se taire, pas fabriquer un marché sur du vide.
    expect(seedDemonstrationActivite(base)).toEqual({
      receptions: 0,
      productions: 0,
      sessionsCloturees: 0,
      ecartsStock: [],
    });
  });
});
