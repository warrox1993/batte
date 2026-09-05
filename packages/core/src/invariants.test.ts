/**
 * Tests d'invariants — derives d'arrondi, pertes de precision, violations de regle.
 *
 * POURQUOI CE FICHIER EXISTE. Les tests unitaires du projet verifient des cas
 * nominaux choisis a la main : ils repondent a « la formule est-elle la bonne ? ».
 * Ils ne repondent pas a « la formule tient-elle sur toute la plage de valeurs
 * que l'application va rencontrer en un an ? ». Un centime perdu par session
 * passe inapercu ; multiplie par cinquante marches, il fausse un journal
 * comptable et personne ne sait pourquoi.
 *
 * METHODE. Approche quasi-propriete : on genere des centaines de valeurs et on
 * verifie qu'une egalite ou un encadrement tient sur toutes. Le generateur est
 * DETERMINISTE, a graine fixe, ecrit ici (§0) : `Math.random()` produirait un
 * test qui echoue une fois sur dix sans qu'on puisse le rejouer, ce qui est pire
 * qu'une absence de test.
 *
 * TOLERANCES. Quand un invariant ne peut pas tenir exactement — un arrondi a
 * l'entier en est la cause quasi unique ici — la tolerance est DERIVEE du code
 * teste et justifiee en commentaire, jamais choisie pour faire passer le test.
 * Une tolerance ajustee apres coup ne mesure plus rien.
 *
 * TESTS `it.fails`. Ils marquent un DEFAUT CONSTATE : l'invariant est ecrit tel
 * qu'il devrait tenir, il ne tient pas, et le test le prouve. Ils ne sont pas
 * des tests casses. Chacun porte l'entree exacte qui declenche le defaut.
 * Aucun code de production n'est corrige ici.
 */

import { describe, expect, it } from 'vitest';

import {
  BASE_POINTS,
  appliquerPointsDeBase,
  formaterEuros,
  formaterMontant,
  parserEuros,
  ratioEnPointsDeBase,
  repartir,
  type Centimes,
  type PointsDeBase,
} from './argent.js';
import {
  CATALOGUE_ECHEANCES,
  estimerResultat,
  joursAvantEcheance,
  montantDeductible,
  planAmortissement,
  prochaineOccurrence,
  totaliserJournal,
  valeurNetteComptable,
  type Immobilisation,
  type LigneJournal,
  type MethodeAmortissement,
} from './comptabilite.js';
import { ErreurMetier } from './erreurs.js';
import {
  coutAppelCents,
  coutMaximalCents,
  estimerTokens,
  familleModele,
  tarifModele,
  verifierPlafond,
  type UsageIa,
} from './ia.js';
import { CATALOGUE_PARAMETRES, Parametres } from './parametres.js';
import { calculerBaseline, type ObservationSession } from './prevision/baseline.js';
import { facteurMeteo, type ConditionsMeteo } from './prevision/meteo.js';
import {
  confianceBp,
  contraintesSession,
  manqueAGagnerEcretage,
  prevoir,
  sigmaRetenu,
  type EntreePrevision,
} from './prevision/moteur.js';
import {
  medianeDepuisEsperance,
  quantileLogNormal,
  quantileNormal,
  ratioCritique,
  repartitionNormale,
  sigmaDepuisCoefficientVariation,
  ventesEsperees,
} from './prevision/statistiques.js';
import { controlerFaisabilite, decomposerEcart, rendementReelBp } from './production.js';
import {
  mettreAEchelle,
  rendementNetBp,
  type LigneRecetteCalcul,
  type RecetteCalcul,
} from './recettes.js';
import {
  calculerRentabilite,
  projeterSeuil,
  rapprocherCaisse,
  totaliserVentes,
  type LigneVente,
} from './sessions.js';
import { repartirFefo, type LotStock } from './stock.js';
import { convertir, type Unite } from './unites.js';

/* ═══════════════════════════════════════════════════════════════════════════
   §0. Generateur pseudo-aleatoire deterministe
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Xorshift32 — 7 lignes, aucune dependance, periode 2^32 − 1.
 *
 * On l'ecrit plutot que d'utiliser `Math.random()` pour une seule raison, mais
 * elle est decisive : un test de propriete doit etre REJOUABLE. Quand une
 * assertion tombe au tirage n°317, il faut pouvoir relancer exactement le meme
 * tirage n°317 apres correction. Une graine fixe donne cette garantie ;
 * `Math.random()` donnerait un defaut qui apparait et disparait.
 */
class GenerateurDeterministe {
  private etat: number;

  constructor(graine: number) {
    // L'etat 0 est un point fixe de xorshift : on l'interdit.
    this.etat = graine >>> 0 === 0 ? 1 : graine >>> 0;
  }

  private suivant(): number {
    let x = this.etat;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.etat = x >>> 0;
    return this.etat;
  }

  /** Reel dans [0, 1[. */
  reel(): number {
    return this.suivant() / 4_294_967_296;
  }

  /** Entier dans [min, max], bornes comprises. */
  entier(min: number, max: number): number {
    return min + Math.floor(this.reel() * (max - min + 1));
  }

  /** Reel dans [min, max[. */
  entre(min: number, max: number): number {
    return min + this.reel() * (max - min);
  }

  choisir<T>(valeurs: readonly T[]): T {
    return valeurs[this.entier(0, valeurs.length - 1)]!;
  }

  booleen(): boolean {
    return this.reel() < 0.5;
  }
}

/** Graine unique du fichier. La changer change TOUS les tirages : ne pas y toucher
 *  pour faire passer un test — c'est exactement la manipulation que ce fichier
 *  est cense rendre impossible. */
const GRAINE = 0x9e37_79b9;

/** Nombre de tirages par propriete. Assez pour couvrir, assez peu pour rester rapide. */
const TIRAGES = 400;

/* ═══════════════════════════════════════════════════════════════════════════
   Contexte metier — tout vient de CATALOGUE_PARAMETRES, rien n'est code en dur
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Deux cles proposees par docs/15 §6 / docs/17 fiche 2 pour refermer les deux
 * trous de la grille meteo (ciel dégagé 22-26 °C, ciel dégagé 5-10 °C).
 * PAS ENCORE au catalogue officiel (`packages/core/src/parametres.ts`, hors
 * perimetre d'ecriture de cet agent — voir le rapport de livraison) : sans
 * elles ici, tout test qui fait varier librement la temperature (fuzz compris)
 * finirait par classer un ciel degage dans l'une des deux plages et lever
 * `ErreurParametreManquant`.
 */
const CLE_METEO_TIEDE_BP = 'prevision_meteo_ensoleille_tiede_bp';
const CLE_METEO_FRAIS_BP = 'prevision_meteo_ensoleille_frais_bp';
const VALEUR_METEO_TIEDE_BP = '11000';
const VALEUR_METEO_FRAIS_BP = '10500';

/**
 * Jeu de parametres construit depuis le catalogue.
 *
 * CLAUDE.md §7 : aucune valeur metier en dur. Un test qui ecrirait « 169 » pour
 * la commission SumUp deviendrait faux le jour ou le contrat change, et pire :
 * il continuerait a passer en testant une valeur perimee.
 */
function parametresDeTest(surcharges: Readonly<Record<string, string>> = {}): Parametres {
  return new Parametres([
    ...CATALOGUE_PARAMETRES.map((d) => [d.cle, surcharges[d.cle] ?? d.valeurDefaut] as const),
    [CLE_METEO_TIEDE_BP, surcharges[CLE_METEO_TIEDE_BP] ?? VALEUR_METEO_TIEDE_BP] as const,
    [CLE_METEO_FRAIS_BP, surcharges[CLE_METEO_FRAIS_BP] ?? VALEUR_METEO_FRAIS_BP] as const,
  ]);
}

const PARAMETRES = parametresDeTest();

/** Jour civil decale de `jours` vers le passe. Ancre a 12:00 UTC comme le code teste. */
function jourMoins(jour: string, jours: number): string {
  const base = Date.parse(`${jour}T12:00:00Z`);
  return new Date(base - jours * 86_400_000).toISOString().slice(0, 10);
}

const UNITES_TESTEES: readonly Unite[] = ['g', 'ml', 'piece'];

/* ═══════════════════════════════════════════════════════════════════════════
   §1. argent.ts — l'entier de centimes ne doit jamais devenir un flottant
   ═══════════════════════════════════════════════════════════════════════════ */

describe('argent.ts — invariants monetaires', () => {
  it('parserEuros(formaterEuros(x)) rend exactement x, sur toute la plage utile', () => {
    const alea = new GenerateurDeterministe(GRAINE);
    // De −10 000 € (ecart de caisse extreme) a 1 000 000 € (bien au-dela de tout
    // ce que ce projet verra, mais l'aller-retour doit tenir quand meme).
    for (let i = 0; i < TIRAGES; i += 1) {
      const montant = alea.entier(-1_000_000, 100_000_000);
      expect(parserEuros(formaterEuros(montant))).toBe(montant);
      expect(parserEuros(formaterMontant(montant))).toBe(montant);
    }
  });

  it('l aller-retour tient aussi sur les valeurs limites de saisie', () => {
    for (const montant of [0, 1, -1, 99, -99, 100, -100, 999, 100_000, -100_000]) {
      expect(parserEuros(formaterEuros(montant))).toBe(montant);
    }
  });

  it('parserEuros rend un entier ou null, jamais un flottant', () => {
    const alea = new GenerateurDeterministe(GRAINE + 1);
    for (let i = 0; i < TIRAGES; i += 1) {
      const euros = alea.entre(-1000, 10_000).toFixed(alea.entier(0, 4));
      const centimes = parserEuros(euros.replace('.', ','));
      expect(centimes).not.toBeNull();
      expect(Number.isInteger(centimes)).toBe(true);
    }
  });

  it('appliquerPointsDeBase rend toujours un entier', () => {
    const alea = new GenerateurDeterministe(GRAINE + 2);
    for (let i = 0; i < TIRAGES; i += 1) {
      const resultat = appliquerPointsDeBase(alea.entier(0, 10_000_000), alea.entier(0, 20_000));
      expect(Number.isInteger(resultat)).toBe(true);
      expect(Number.isFinite(resultat)).toBe(true);
    }
  });

  it('appliquerPointsDeBase est monotone en montant et en taux, et jamais negatif sur des entrees positives', () => {
    const alea = new GenerateurDeterministe(GRAINE + 3);
    for (let i = 0; i < TIRAGES; i += 1) {
      const montant = alea.entier(0, 5_000_000);
      const supplement = alea.entier(0, 100_000);
      const taux = alea.entier(0, BASE_POINTS);

      expect(appliquerPointsDeBase(montant, taux)).toBeGreaterThanOrEqual(0);
      // Monotonie en montant.
      expect(appliquerPointsDeBase(montant + supplement, taux)).toBeGreaterThanOrEqual(
        appliquerPointsDeBase(montant, taux),
      );
      // Monotonie en taux.
      expect(
        appliquerPointsDeBase(montant, Math.min(BASE_POINTS, taux + 500)),
      ).toBeGreaterThanOrEqual(appliquerPointsDeBase(montant, taux));
      // Un taux <= 100 % ne peut pas rendre plus que le tout (a l'arrondi pres :
      // Math.round peut ajouter au plus un demi-centime, donc +1 en entier).
      expect(appliquerPointsDeBase(montant, taux)).toBeLessThanOrEqual(montant + 1);
    }
  });

  it('appliquerPointsDeBase est neutre a 10 000 points de base, quel que soit le montant', () => {
    const alea = new GenerateurDeterministe(GRAINE + 4);
    for (let i = 0; i < TIRAGES; i += 1) {
      const montant = alea.entier(-1_000_000, 10_000_000);
      expect(appliquerPointsDeBase(montant, BASE_POINTS)).toBe(montant);
    }
  });

  it('ratioEnPointsDeBase reste dans [0, 10 000] pour une partie incluse dans le tout', () => {
    const alea = new GenerateurDeterministe(GRAINE + 5);
    for (let i = 0; i < TIRAGES; i += 1) {
      const total = alea.entier(1, 1_000_000);
      const partie = alea.entier(0, total);
      const ratio = ratioEnPointsDeBase(partie, total);
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(BASE_POINTS);
      expect(Number.isInteger(ratio)).toBe(true);
    }
    // Un total nul ne doit produire ni NaN ni Infinity : c'est un ecran de
    // tableau de bord qui affiche ce chiffre le dimanche soir.
    expect(ratioEnPointsDeBase(42, 0)).toBe(0);
  });

  /**
   * ANCIEN `it.fails` — DIAGNOSTIC : le TEST etait faux, pas le modele.
   *
   * Le defaut d'origine — repartir un montant en parts exprimees en points de
   * base perd des centimes si chaque part est arrondie independamment avec
   * `appliquerPointsDeBase` — a bien ete corrige : la primitive `repartir(total,
   * poids[])` existe desormais dans `argent.ts` (reste affecte a la derniere
   * part, sur le modele de `planAmortissement`) et est exhaustivement testee
   * dans `argent.test.ts` (describe `repartir`), qui reprend meme le cas exact
   * ci-dessous — `[3333, 3333, 3334]` sur 100 centimes — dans le test « ne perd
   * pas de centime la ou l'arrondi part par part en perd un ».
   *
   * Mais le present test, lui, n'avait jamais ete mis a jour vers la primitive
   * corrigee : il continuait a repartir « a la main », part par part, via
   * `appliquerPointsDeBase` — exactement l'anti-patron que `repartir` a ete
   * ecrit pour remplacer. Il echouait donc pour une raison qui n'avait plus
   * rien a voir avec un manque du modele : le modele (`repartir`) n'a jamais
   * eu ce defaut depuis son ajout, seul cet appelant continuait a le contourner.
   *
   * On le remplace par la propriete correcte, en quasi-propriete sur des poids
   * TIRES AU HASARD exprimes en points de base et sommant a `BASE_POINTS` — le
   * cas d'usage reel (ventiler un frais commun en pourcentages) — passes a
   * `repartir`, la primitive qui porte reellement la garantie.
   */
  it('la somme des parts d une repartition en points de base egale le tout, via repartir', () => {
    const alea = new GenerateurDeterministe(GRAINE + 7);
    for (let i = 0; i < TIRAGES; i += 1) {
      const nbParts = alea.entier(2, 6);
      const poids: PointsDeBase[] = [];
      let restant = BASE_POINTS;
      for (let p = 0; p < nbParts - 1; p += 1) {
        const part = alea.entier(0, restant);
        poids.push(part);
        restant -= part;
      }
      // La derniere part recoit le reste des points de base : la somme des
      // poids vaut donc toujours BASE_POINTS, jamais zero.
      poids.push(restant);

      const total: Centimes = alea.entier(-1_000_000, 1_000_000);
      const parts = repartir(total, poids);
      // Egalite EXACTE, aucune tolerance : ce sont des entiers de centimes.
      expect(parts.reduce((s, p) => s + p, 0)).toBe(total);
    }

    // Le cas minimal reproductible de l'audit d'origine, fige en dur : 1,00 €
    // en trois tiers de points de base ne doit jamais rendre 33 + 33 + 33.
    const poidsAudit: readonly PointsDeBase[] = [3333, 3333, 3334];
    const totalAudit: Centimes = 100;
    expect(repartir(totalAudit, poidsAudit).reduce((s, p) => s + p, 0)).toBe(totalAudit);
  });

  /**
   * DEFAUT — `appliquerPointsDeBase` n'est pas symetrique par changement de signe.
   *
   * `Math.round` arrondit vers +∞ sur les demis : round(0,5) = 1 mais
   * round(−0,5) = −0. La commission d'un remboursement carte differe donc d'un
   * centime de celle de l'encaissement qu'elle annule, et un avoir fournisseur
   * ne se deduit pas exactement de la depense d'origine.
   */
  // CORRIGE : arrondi symetrique, et plus jamais de `-0` (un montant n'est
  // pas une limite mathematique). La commission d'un remboursement solde
  // desormais exactement celle de l'encaissement qu'il annule.
  it('appliquerPointsDeBase(-x, t) vaut -appliquerPointsDeBase(x, t)', () => {
    expect(appliquerPointsDeBase(-1, 5000)).toBe(-appliquerPointsDeBase(1, 5000));
  });

  it('repartirFefo conserve exactement la quantite : somme des allocations + manquant = requis', () => {
    const alea = new GenerateurDeterministe(GRAINE + 6);
    for (let i = 0; i < TIRAGES; i += 1) {
      const lots: LotStock[] = [];
      const nbLots = alea.entier(1, 6);
      for (let j = 0; j < nbLots; j += 1) {
        lots.push({
          id: `lot-${j}`,
          ingredientId: 'ing',
          numeroLotFournisseur: null,
          dateDlc: jourMoins('2026-07-01', -alea.entier(1, 90)),
          dateReception: jourMoins('2026-07-01', alea.entier(1, 30)),
          quantiteRestante: alea.entier(1, 5000),
          prixUnitaireCents: alea.entre(0.01, 5),
          statut: 'disponible',
        });
      }
      const requis = alea.entier(0, 20_000);
      const resultat = repartirFefo(lots, requis, '2026-07-01');

      const alloue = resultat.allocations.reduce((s, a) => s + a.quantite, 0);
      expect(alloue + resultat.quantiteManquante).toBe(requis);
      // Invariant n°1 de docs/02 : aucun lot n'est sur-consomme.
      for (const allocation of resultat.allocations) {
        const lot = lots.find((l) => l.id === allocation.lotId)!;
        expect(allocation.quantite).toBeLessThanOrEqual(lot.quantiteRestante);
      }

      // Le cout total est la somme d'arrondis independants (un par lot servi).
      // Tolerance DERIVEE : `Math.round` par allocation, donc au plus un demi
      // centime par allocation d'ecart avec le cout exact.
      const exact = resultat.allocations.reduce((s, a) => {
        const lot = lots.find((l) => l.id === a.lotId)!;
        return s + a.quantite * lot.prixUnitaireCents;
      }, 0);
      expect(Math.abs(resultat.coutTotalCents - exact)).toBeLessThanOrEqual(
        resultat.allocations.length * 0.5,
      );
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §2. unites.ts — aucune conversion implicite ne doit passer
   ═══════════════════════════════════════════════════════════════════════════ */

describe('unites.ts — conversions masse/volume', () => {
  it('l aller-retour g -> ml -> g reste dans la tolerance derivee de la densite', () => {
    const alea = new GenerateurDeterministe(GRAINE + 10);
    for (let i = 0; i < TIRAGES; i += 1) {
      // Densites alimentaires reelles : huile 0,92, lait 1,03, sirop 1,4, miel 1,45.
      const densite = alea.entre(0.3, 2);
      const grammes = alea.entier(1, 50_000);

      const millilitres = convertir(grammes, 'g', 'ml', densite);
      const retour = convertir(millilitres, 'ml', 'g', densite);

      // TOLERANCE DERIVEE, pas choisie : round(q/d) = q/d + e1 avec |e1| <= 0,5 ;
      // multiplier par d propage cette erreur en 0,5·d ; le second round ajoute
      // au plus 0,5. Donc |retour − q| <= 0,5·d + 0,5.
      expect(Math.abs(retour - grammes)).toBeLessThanOrEqual(0.5 * densite + 0.5);
      expect(Number.isInteger(millilitres)).toBe(true);
      expect(Number.isInteger(retour)).toBe(true);
    }
  });

  it('l aller-retour ml -> g -> ml reste dans la tolerance symetrique', () => {
    const alea = new GenerateurDeterministe(GRAINE + 11);
    for (let i = 0; i < TIRAGES; i += 1) {
      const densite = alea.entre(0.3, 2);
      const millilitres = alea.entier(1, 50_000);

      const retour = convertir(convertir(millilitres, 'ml', 'g', densite), 'g', 'ml', densite);
      // Meme raisonnement, la division venant en second : 0,5/d + 0,5.
      expect(Math.abs(retour - millilitres)).toBeLessThanOrEqual(0.5 / densite + 0.5);
    }
  });

  it('une densite absente, nulle ou negative leve toujours, jamais un chiffre devine', () => {
    const alea = new GenerateurDeterministe(GRAINE + 12);
    const densitesRefusees = [undefined, null, 0, -1, -0.5];
    for (let i = 0; i < TIRAGES; i += 1) {
      const quantite = alea.entier(1, 100_000);
      const de = alea.booleen() ? 'g' : 'ml';
      const vers = de === 'g' ? 'ml' : 'g';
      for (const densite of densitesRefusees) {
        expect(() => convertir(quantite, de, vers, densite)).toThrow(ErreurMetier);
        try {
          convertir(quantite, de, vers, densite);
          expect.unreachable('la conversion aurait du lever');
        } catch (erreur) {
          expect(erreur).toBeInstanceOf(ErreurMetier);
          expect((erreur as ErreurMetier).code).toBe('densite_manquante');
        }
      }
    }
  });

  it('toute conversion impliquant « piece » leve, sauf piece -> piece', () => {
    const alea = new GenerateurDeterministe(GRAINE + 13);
    for (let i = 0; i < TIRAGES; i += 1) {
      const quantite = alea.entier(1, 500);
      const autre = alea.booleen() ? 'g' : 'ml';
      expect(() => convertir(quantite, 'piece', autre, 1)).toThrow(ErreurMetier);
      expect(() => convertir(quantite, autre, 'piece', 1)).toThrow(ErreurMetier);
      // L'identite reste licite : c'est une non-conversion.
      expect(convertir(quantite, 'piece', 'piece')).toBe(quantite);
    }
  });

  it('convertir rend toujours un entier fini quand il ne leve pas', () => {
    const alea = new GenerateurDeterministe(GRAINE + 14);
    for (let i = 0; i < TIRAGES; i += 1) {
      const unite = alea.choisir(UNITES_TESTEES);
      const resultat = convertir(alea.entre(-5000, 100_000), unite, unite);
      expect(Number.isInteger(resultat)).toBe(true);
    }
  });

  /**
   * DEFAUT — `unites.ts:50` : la garde teste `densiteGParMl <= 0` mais pas
   * `Number.isFinite`.
   *
   * `NaN <= 0` vaut `false` : une densite NaN traverse la garde et ressort en
   * quantite NaN. Idem pour `Infinity`. La quantite non finie part ensuite dans
   * un mouvement de stock ; comme le stock est « la somme des mouvements »
   * (regle n°5), UNE seule ligne NaN rend NaN le stock de l'ingredient, sa
   * valorisation, et le cout matiere de toutes les productions suivantes.
   * Correctif attendu : `if (!Number.isFinite(d) || d <= 0) throw ...`.
   */
  // CORRIGE (D-034) : la garde teste desormais `Number.isFinite`.
  it('une densite non finie leve au lieu de propager NaN', () => {
    expect(() => convertir(1000, 'ml', 'g', Number.NaN)).toThrow(ErreurMetier);
  });

  it('une densite infinie leve au lieu de propager Infinity', () => {
    expect(() => convertir(1000, 'ml', 'g', Number.POSITIVE_INFINITY)).toThrow(ErreurMetier);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §3. recettes.ts / production.ts — mise a l'echelle et cout matiere
   ═══════════════════════════════════════════════════════════════════════════ */

/** Recette plausible : 3 a 9 lignes, CUMP fractionnaires comme dans la vraie vie. */
function recetteAleatoire(alea: GenerateurDeterministe, index: number): RecetteCalcul {
  const nbLignes = alea.entier(3, 9);
  const lignes: LigneRecetteCalcul[] = [];
  for (let i = 0; i < nbLignes; i += 1) {
    lignes.push({
      ingredientId: `ing-${index}-${i}`,
      nomIngredient: `Ingrédient ${i}`,
      unite: alea.choisir(UNITES_TESTEES),
      quantiteReference: alea.entier(1, 2000),
      // Le CUMP est un REEL en centimes par unite (farine ≈ 0,12 c/g, beurre
      // ≈ 0,90 c/g). C'est precisement la ou l'arrondi mord : arrondir un cout
      // de 0,24 centime a l'entier le fait disparaitre.
      cumpCentsParUnite: alea.entre(0.01, 5),
      allergenes: [],
    });
  }
  return {
    id: `rec-${index}`,
    code: `R${index}`,
    rendementReferenceMl: alea.entier(1000, 10_000),
    rendementReferenceCrepes: alea.entier(10, 150),
    perteCuissonBp: alea.entier(0, 1500),
    tauxCasseBp: alea.entier(0, 1000),
    lignes,
  };
}

/**
 * Cout matiere exact (non arrondi) du rendement de reference, et cout par crepe
 * vendable asymptotique. Sert de verite de reference aux tests d'echelle.
 *
 * `?? 0` : `cumpCentsParUnite` est `number | null` depuis l'audit du
 * 29/07/2026 (defaut n°1, prix INCONNU d'un ingredient sans conditionnement).
 * `recetteAleatoire` ne genere jamais de prix `null` (elle simule des
 * ingredients dont le prix est CONNU) : ce repli ne masque donc rien ici, il
 * ne fait que satisfaire le type.
 */
function coutAsymptotiqueParCrepe(recette: RecetteCalcul): number {
  const exact = recette.lignes.reduce(
    (somme, ligne) => somme + ligne.quantiteReference * (ligne.cumpCentsParUnite ?? 0),
    0,
  );
  const net = rendementNetBp(recette) / BASE_POINTS;
  return exact / (recette.rendementReferenceCrepes * net);
}

describe('recettes.ts — mise a l echelle', () => {
  it('doubler la cible double chaque quantite, a un entier pres', () => {
    const alea = new GenerateurDeterministe(GRAINE + 20);
    for (let i = 0; i < TIRAGES; i += 1) {
      const recette = recetteAleatoire(alea, i);
      const cible = alea.entier(20, 2000);

      const simple = mettreAEchelle(recette, { type: 'crepes', crepesVendables: cible });
      const double = mettreAEchelle(recette, { type: 'crepes', crepesVendables: cible * 2 });

      expect(double.facteur).toBeCloseTo(simple.facteur * 2, 10);

      for (let l = 0; l < recette.lignes.length; l += 1) {
        // TOLERANCE DERIVEE : round(2u) et 2·round(u) sont deux entiers distants
        // d'au plus 1,5 ; comme ce sont des entiers, l'ecart est au plus 1.
        expect(
          Math.abs(double.lignes[l]!.quantite - 2 * simple.lignes[l]!.quantite),
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it('doubler la cible double le cout matiere, a une borne derivee pres', () => {
    const alea = new GenerateurDeterministe(GRAINE + 21);
    for (let i = 0; i < TIRAGES; i += 1) {
      const recette = recetteAleatoire(alea, i);
      const cible = alea.entier(50, 3000);

      const simple = mettreAEchelle(recette, { type: 'crepes', crepesVendables: cible });
      const double = mettreAEchelle(recette, { type: 'crepes', crepesVendables: cible * 2 });

      // TOLERANCE DERIVEE, ligne par ligne : la quantite doublee derive d'au plus
      // 1 unite (test precedent), soit `cump` centimes ; l'arrondi du cout ajoute
      // 0,5 sur la ligne doublee et 2 × 0,5 sur la ligne simple comptee deux fois.
      // `?? 0` : voir le commentaire de `coutAsymptotiqueParCrepe` ci-dessus.
      const borne = recette.lignes.reduce((s, l) => s + (l.cumpCentsParUnite ?? 0) + 1.5, 0);

      // `recetteAleatoire` ne genere que des prix CONNUS : `coutMatiereCents`
      // n'est donc jamais `null` ici. Narrowing explicite plutot qu'un cast,
      // comme pour `coutParCrepeCents` plus bas — meme convention.
      if (simple.coutMatiereCents === null || double.coutMatiereCents === null) {
        throw new Error(
          'coutMatiereCents inattendument null : recetteAleatoire ne genere que des prix connus.',
        );
      }
      expect(Math.abs(double.coutMatiereCents - 2 * simple.coutMatiereCents)).toBeLessThanOrEqual(
        borne,
      );
    }
  });

  it('le cout par crepe reste stable quelle que soit l echelle', () => {
    const alea = new GenerateurDeterministe(GRAINE + 22);
    for (let i = 0; i < TIRAGES; i += 1) {
      const recette = recetteAleatoire(alea, i);
      const asymptotique = coutAsymptotiqueParCrepe(recette);
      const net = rendementNetBp(recette) / BASE_POINTS;

      // Erreur maximale sur le cout matiere : par ligne, 0,5 unite d'arrondi de
      // quantite (× cump) puis 0,5 centime d'arrondi de cout.
      // `?? 0` : voir le commentaire de `coutAsymptotiqueParCrepe` plus haut.
      const erreurCout = recette.lignes.reduce(
        (s, l) => s + 0.5 * (l.cumpCentsParUnite ?? 0) + 0.5,
        0,
      );
      // Erreur maximale sur le nombre de crepes vendables : round(R·f) apporte
      // 0,5 crepe theorique (donc 0,5·net vendable), le floor final apporte 1.
      const erreurVendables = 0.5 * net + 1;

      for (const cible of [200, 500, 1200, 5000]) {
        const resultat = mettreAEchelle(recette, { type: 'crepes', crepesVendables: cible });
        expect(resultat.crepesVendables).toBeGreaterThan(0);

        // `crepesVendables > 0` garantit un cout par crepe CONNU (docs/17
        // fiche 7) : jamais `null` ici. Narrowing explicite plutot qu'un cast,
        // pour que ce test le documente au lieu de le supposer.
        const { coutParCrepeCents } = resultat;
        if (coutParCrepeCents === null) {
          throw new Error(
            'coutParCrepeCents inattendument null alors que des crepes sont vendables',
          );
        }

        // TOLERANCE DERIVEE : |C/V − A| <= (Ec + A·Ev)/V, plus 0,5 pour l'arrondi
        // final a l'entier de centime. Elle DECROIT en 1/V : c'est le sens meme
        // de « le cout par crepe est stable a l'echelle ».
        const borne =
          0.5 + (erreurCout + asymptotique * erreurVendables) / resultat.crepesVendables;
        expect(Math.abs(coutParCrepeCents - asymptotique)).toBeLessThanOrEqual(borne);
      }
    }
  });

  /**
   * INVARIANT REFORMULE (audit 29/07/2026, defaut n°2 — corrige dans
   * `mettreAEchelle`, `packages/core/src/recettes.ts`).
   *
   * AVANT : « le cout matiere est la somme des couts de lignes, CHACUN DEJA
   * ARRONDI ». Cette formulation etait vraie par construction — c'etait
   * exactement ainsi que `mettreAEchelle` calculait le total avant le
   * correctif — donc l'egalite etait TAUTOLOGIQUE et ne detectait rien. Sur
   * les vraies donnees de R1 (`audit-referentiel.test.ts`), cette methode
   * perdait la ligne de sel (2 g a 0,09 c/g = 0,18 c, arrondie a ZERO
   * individuellement) et rendait 155 c au lieu du total exact 154 c : un
   * centime qui disparaissait sans le moindre signal.
   *
   * APRES : « le cout matiere est L'ARRONDI DE LA SOMME DES COUTS EXACTS
   * (non arrondis) de chaque ligne » — ce n'est PAS la meme affirmation. La
   * doctrine est celle de `repartir()` (`packages/core/src/argent.ts`) :
   * totaliser d'abord, arrondir une seule fois a la fin. Le cout matiere
   * STOCKE reste un entier de centimes (CLAUDE.md §3 regle 3) ; ce qui change
   * est OU l'arrondi a lieu — une fois sur le total, jamais une fois par
   * ligne PUIS une fois de plus en sommant ces arrondis. Le `coutCents`
   * affiche par ligne reste, lui, arrondi individuellement (affichage
   * informatif), mais ne sert plus JAMAIS a recomposer le total.
   */
  it("le cout matiere est l'arrondi de la somme des couts EXACTS de lignes, pas la somme de couts deja arrondis", () => {
    const alea = new GenerateurDeterministe(GRAINE + 23);
    for (let i = 0; i < TIRAGES; i += 1) {
      const recette = recetteAleatoire(alea, i);
      const resultat = mettreAEchelle(recette, {
        type: 'volume',
        volumeMl: alea.entier(500, 40_000),
      });
      // `?? 0` : voir le commentaire de `coutAsymptotiqueParCrepe` plus haut —
      // `recetteAleatoire` ne genere jamais de prix `null`.
      const sommeExacte = resultat.lignes.reduce(
        (s, l) => s + l.quantite * (l.cumpCentsParUnite ?? 0),
        0,
      );
      expect(resultat.coutMatiereCents).toBe(Math.round(sommeExacte));
      for (const ligne of resultat.lignes) {
        expect(Number.isInteger(ligne.quantite)).toBe(true);
        expect(Number.isInteger(ligne.coutCents)).toBe(true);
      }
      expect(Number.isInteger(resultat.coutMatiereCents)).toBe(true);
      expect(Number.isInteger(resultat.coutParCrepeCents)).toBe(true);
    }
  });

  it('rendementNetBp reste dans [0, 10 000] et decroit avec chaque perte', () => {
    const alea = new GenerateurDeterministe(GRAINE + 24);
    for (let i = 0; i < TIRAGES; i += 1) {
      const perteCuissonBp = alea.entier(0, BASE_POINTS);
      const tauxCasseBp = alea.entier(0, BASE_POINTS);
      const net = rendementNetBp({ perteCuissonBp, tauxCasseBp });

      expect(net).toBeGreaterThanOrEqual(0);
      expect(net).toBeLessThanOrEqual(BASE_POINTS);
      expect(Number.isInteger(net)).toBe(true);

      // Augmenter une perte ne peut pas augmenter le rendement.
      const pirePerte = Math.min(BASE_POINTS, perteCuissonBp + 100);
      expect(rendementNetBp({ perteCuissonBp: pirePerte, tauxCasseBp })).toBeLessThanOrEqual(net);
      const pireCasse = Math.min(BASE_POINTS, tauxCasseBp + 100);
      expect(rendementNetBp({ perteCuissonBp, tauxCasseBp: pireCasse })).toBeLessThanOrEqual(net);
    }
    // Sans perte, le rendement est exactement neutre : aucune derive d'arrondi.
    expect(rendementNetBp({ perteCuissonBp: 0, tauxCasseBp: 0 })).toBe(BASE_POINTS);
  });

  it('une recette sans ingredient leve, elle ne rend pas un cout de zero', () => {
    const alea = new GenerateurDeterministe(GRAINE + 25);
    const vide: RecetteCalcul = { ...recetteAleatoire(alea, 0), lignes: [] };
    expect(() => mettreAEchelle(vide, { type: 'crepes', crepesVendables: 100 })).toThrow(
      ErreurMetier,
    );
  });

  it('mettreAEchelle et controlerFaisabilite calculent les memes quantites requises', () => {
    // Deux chemins de code differents aboutissent a la meme decision de stock ;
    // s'ils divergeaient, une production serait declaree faisable puis echouerait
    // au moment de sortir les lots.
    const alea = new GenerateurDeterministe(GRAINE + 26);
    for (let i = 0; i < TIRAGES; i += 1) {
      const recette = recetteAleatoire(alea, i);
      const volumeMl = alea.entier(500, 40_000);
      const facteur = volumeMl / recette.rendementReferenceMl;

      const echelle = mettreAEchelle(recette, { type: 'volume', volumeMl });
      const faisabilite = controlerFaisabilite(recette, facteur, new Map());

      for (let l = 0; l < recette.lignes.length; l += 1) {
        expect(faisabilite.besoins[l]!.requis).toBe(echelle.lignes[l]!.quantite);
      }
    }
  });

  /**
   * NON-REGRESSION (docs/17 fiche 7) — CORRIGE : `recettes.ts` rendait `0`
   * quand aucune crepe n'etait vendable, alors que le cout matiere est
   * strictement positif. `it.fails` converti en test normal, sur le modele de
   * D-054 : le defaut est corrige dans le meme commit qui retire `.fails`.
   *
   * Entree qui declenche le cas : une cible de volume trop petite pour sortir
   * une crepe vendable (ci-dessous 60 ml sur une recette de reference a 5 L).
   * Le cout matiere vaut 1 centime ou plus, et l'ecran affichait « 0,00 € /
   * crepe ».
   *
   * C'est le meme travers que `sessions.ts` evite explicitement pour le panier
   * moyen et que `calculerCump` (`stock.ts`) evite pour le CUMP (« un ingredient epuise n'a
   * pas un cout de zero, il n'a pas de cout »). Le zero etait une donnee
   * affichee comme mesuree.
   *
   * IMPACT CHAINE, et il etait serieux : `packages/db/src/depots/previsions.ts`
   * filtre les couts par `c !== null` puis en fait la moyenne. Un `0` passait
   * le filtre et tirait la moyenne vers le bas ; a l'installation (aucune
   * reception, donc CUMP a 0 partout) le cout matiere par crepe valait 0, ce
   * qui declenchait le defaut newsvendor documente en §5 — un `Co` sous-estime
   * fait MONTER le quantile cible, donc SURPRODUIRE.
   */
  it('coutParCrepeCents rend null, jamais 0, quand aucune crepe n est vendable', () => {
    const recette: RecetteCalcul = {
      id: 'r-min',
      code: 'R-MIN',
      rendementReferenceMl: 5000,
      rendementReferenceCrepes: 66,
      perteCuissonBp: 500,
      tauxCasseBp: 300,
      lignes: [
        {
          ingredientId: 'beurre',
          nomIngredient: 'Beurre',
          unite: 'g',
          quantiteReference: 550,
          cumpCentsParUnite: 0.9,
          allergenes: ['lait'],
        },
      ],
    };
    const resultat = mettreAEchelle(recette, { type: 'volume', volumeMl: 60 });

    expect(resultat.crepesVendables).toBe(0);
    expect(resultat.coutMatiereCents).toBeGreaterThan(0);
    // Un cout par crepe inconnu vaut `null`, comme partout ailleurs — jamais
    // `0`, qui serait un chiffre faux presente comme une donnee.
    expect(resultat.coutParCrepeCents).toBeNull();
  });
});

describe('production.ts — ecart theorique / reel', () => {
  it('l ecart est exactement reel − theorique, et son cout suit le CUMP', () => {
    const alea = new GenerateurDeterministe(GRAINE + 30);
    for (let i = 0; i < TIRAGES; i += 1) {
      const theoriques = [
        {
          ingredientId: 'a',
          nomIngredient: 'A',
          unite: 'g' as Unite,
          quantite: alea.entier(1, 20_000),
          cumpCentsParUnite: alea.entre(0.01, 5),
        },
      ];
      const reel = alea.entier(0, 25_000);
      const [ecart] = decomposerEcart(theoriques, new Map([['a', reel]]));

      expect(ecart!.ecart).toBe(reel - theoriques[0]!.quantite);
      expect(Number.isInteger(ecart!.ecartBp)).toBe(true);
      expect(Number.isInteger(ecart!.coutEcartCents)).toBe(true);
      // Cout de l'ecart : arrondi unique, donc au plus un demi-centime de biais.
      expect(
        Math.abs(ecart!.coutEcartCents - ecart!.ecart * theoriques[0]!.cumpCentsParUnite),
      ).toBeLessThanOrEqual(0.5);
    }
  });

  it('rendementReelBp est positif, entier, et nul sur un theorique nul', () => {
    const alea = new GenerateurDeterministe(GRAINE + 31);
    for (let i = 0; i < TIRAGES; i += 1) {
      const theoriques = alea.entier(1, 500);
      const obtenues = alea.entier(0, theoriques);
      const rendement = rendementReelBp(obtenues, theoriques);
      expect(rendement).toBeGreaterThanOrEqual(0);
      expect(rendement).toBeLessThanOrEqual(BASE_POINTS);
      expect(Number.isInteger(rendement)).toBe(true);
    }
    expect(rendementReelBp(50, 0)).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §4. sessions.ts — caisse, rentabilite, seuils
   ═══════════════════════════════════════════════════════════════════════════ */

describe('sessions.ts — rapprochement de caisse', () => {
  /**
   * INVARIANT N°4 de docs/02-MODELE-DONNEES.md :
   *   (especes_comptees − fonds_caisse_initial) + ca_carte − ca_total == ecart_caisse
   *
   * Il a DEJA ete faux dans la spec (formulation corrigee le 27/07/2026, elle
   * oubliait le fonds de caisse). C'est donc l'invariant le plus surveille du
   * projet : on le verifie sur des centaines de combinaisons, fonds de caisse
   * compris entre 0 et 200 €, y compris avec un ecart negatif.
   */
  it('l invariant n°4 tient exactement sur toutes les combinaisons de caisse', () => {
    const alea = new GenerateurDeterministe(GRAINE + 40);
    for (let i = 0; i < TIRAGES; i += 1) {
      const fondsCaisseInitialCents = alea.entier(0, 20_000);
      const especesCompteesCents = fondsCaisseInitialCents + alea.entier(0, 150_000);
      const caCarteCents = alea.entier(0, 150_000);
      const caVentesCents = alea.entier(0, 300_000);

      const resultat = rapprocherCaisse(
        { fondsCaisseInitialCents, especesCompteesCents, caCarteCents },
        caVentesCents,
      );

      expect(especesCompteesCents - fondsCaisseInitialCents + caCarteCents - caVentesCents).toBe(
        resultat.ecartCaisseCents,
      );

      // Corollaires : le CA especes est bien derive, jamais saisi.
      expect(resultat.caEspecesCents).toBe(especesCompteesCents - fondsCaisseInitialCents);
      // `especesCompteesCents` et `caCarteCents` sont ici TOUJOURS des nombres
      // connus (generes ci-dessus) : `rapprocherCaisse` (@batte/core) ne peut
      // donc jamais rendre `null` pour ce tirage. La garde ci-dessous est une
      // verification de ce fait, pas un contournement du typage — voir la
      // doctrine « l'inconnu se propage » sur `ComptageCaisse`/`ResultatCaisse`.
      if (resultat.caEspecesCents === null) {
        throw new Error('caEspecesCents inattendument nul sur un tirage entierement connu.');
      }
      expect(resultat.caTotalEncaisseCents).toBe(resultat.caEspecesCents + caCarteCents);
      expect(Number.isInteger(resultat.ecartCaisseCents)).toBe(true);
    }
  });

  it('un comptage parfait donne un ecart exactement nul, fonds de caisse compris', () => {
    const alea = new GenerateurDeterministe(GRAINE + 41);
    for (let i = 0; i < TIRAGES; i += 1) {
      const fondsCaisseInitialCents = alea.entier(0, 20_000);
      const caEspeces = alea.entier(0, 100_000);
      const caCarteCents = alea.entier(0, 100_000);
      const resultat = rapprocherCaisse(
        {
          fondsCaisseInitialCents,
          especesCompteesCents: fondsCaisseInitialCents + caEspeces,
          caCarteCents,
        },
        caEspeces + caCarteCents,
      );
      expect(resultat.ecartCaisseCents).toBe(0);
    }
  });
});

describe('sessions.ts — rentabilite', () => {
  function ventesAleatoires(alea: GenerateurDeterministe): LigneVente[] {
    const lignes: LigneVente[] = [];
    const nb = alea.entier(1, 12);
    for (let i = 0; i < nb; i += 1) {
      const nature = alea.booleen() ? 'transforme' : 'revendu';
      lignes.push({
        produitVenteId: `p-${i}`,
        nature,
        quantite: alea.entier(1, 80),
        prixUnitaireCents: alea.entier(50, 1500),
        nbCrepesParUnite: nature === 'transforme' ? alea.entier(1, 2) : 0,
        consommationSurPlace: alea.booleen(),
      });
    }
    return lignes;
  }

  it('le CA total est exactement la somme du transforme et du revendu', () => {
    const alea = new GenerateurDeterministe(GRAINE + 42);
    for (let i = 0; i < TIRAGES; i += 1) {
      const totaux = totaliserVentes(ventesAleatoires(alea));
      // Egalite EXACTE : la ventilation transforme/revendu pilote les compteurs
      // de seuils legaux (CLAUDE.md §6). Un centime egare ici deplace la date de
      // sortie de franchise TVA.
      expect(totaux.caTransformeCents + totaux.caRevenduCents).toBe(totaux.caTotalCents);
      expect(totaux.caSurPlaceCents).toBeLessThanOrEqual(totaux.caTotalCents);
      expect(Number.isInteger(totaux.caTotalCents)).toBe(true);
    }
  });

  it('la marge nette vaut toujours CA − matiere − frais − commission', () => {
    const alea = new GenerateurDeterministe(GRAINE + 43);
    const tauxCommission = PARAMETRES.pointsDeBase('taux_commission_sumup_bp');

    for (let i = 0; i < TIRAGES; i += 1) {
      const totaux = totaliserVentes(ventesAleatoires(alea));
      const coutMatiereCents = alea.entier(0, 40_000);
      const frais = {
        emplacementCents: alea.entier(0, 5000),
        deplacementCents: alea.entier(0, 5000),
        gazCents: alea.entier(0, 3000),
        diversCents: alea.entier(0, 3000),
        // Fiche 17 : cinquième poste de frais, au même titre que les quatre
        // autres pour cette invariante — voir `fraisTotaux` ci-dessous.
        energieCents: alea.entier(0, 2000),
      };
      const caCarteCents = alea.entier(0, totaux.caTotalCents);
      const crepesProduites = alea.entier(1, 400);

      const resultat = calculerRentabilite({
        totaux,
        coutMatiereTransformeCents: coutMatiereCents,
        coutMarchandisesRevenduesCents: 0,
        coutComposantsVenteCents: 0,
        frais,
        caCarteCents,
        tauxCommissionCarteBp: tauxCommission,
        production: {
          crepesProduites,
          crepesVendues: alea.entier(0, crepesProduites),
          crepesInvendues: 0,
          crepesCassees: 0,
        },
        dureeMinutes: alea.entier(60, 600),
      });

      const fraisTotaux =
        frais.emplacementCents +
        frais.deplacementCents +
        frais.gazCents +
        frais.diversCents +
        frais.energieCents;

      // Egalite EXACTE, aucune tolerance : ce sont des entiers de centimes.
      expect(resultat.fraisTotauxCents).toBe(fraisTotaux);
      expect(resultat.margeBruteCents).toBe(totaux.caTotalCents - coutMatiereCents);
      expect(resultat.margeNetteCents).toBe(
        totaux.caTotalCents - coutMatiereCents - fraisTotaux - resultat.commissionCarteCents,
      );
      // La commission ne peut pas depasser l'encaissement carte.
      expect(resultat.commissionCarteCents).toBeLessThanOrEqual(caCarteCents);
      expect(resultat.commissionCarteCents).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(resultat.margeNetteCents)).toBe(true);
    }
  });

  it('un denominateur inconnu rend null, jamais un chiffre invente', () => {
    const totaux = totaliserVentes([]);
    const commun = {
      totaux,
      coutMatiereTransformeCents: 5000,
      coutMarchandisesRevenduesCents: 0,
      coutComposantsVenteCents: 0,
      frais: {
        emplacementCents: 1200,
        deplacementCents: 800,
        gazCents: 400,
        diversCents: 0,
        energieCents: 0,
      },
      caCarteCents: 0,
      tauxCommissionCarteBp: PARAMETRES.pointsDeBase('taux_commission_sumup_bp'),
      production: { crepesProduites: 0, crepesVendues: 0, crepesInvendues: 0, crepesCassees: 0 },
    };

    for (const dureeMinutes of [null, 0, -30]) {
      const resultat = calculerRentabilite({ ...commun, dureeMinutes });
      expect(resultat.margeParHeureCents).toBeNull();
    }
    const sansVente = calculerRentabilite({ ...commun, dureeMinutes: 390 });
    expect(sansVente.panierMoyenCents).toBeNull();
    expect(sansVente.coutMatiereParCrepeCents).toBeNull();
    expect(sansVente.coutCompletParCrepeVendueCents).toBeNull();
    // La marge par heure, elle, reste calculable : la duree est connue.
    expect(sansVente.margeParHeureCents).not.toBeNull();
  });

  it('la marge par heure suit exactement la marge nette rapportee a la duree', () => {
    const alea = new GenerateurDeterministe(GRAINE + 44);
    for (let i = 0; i < TIRAGES; i += 1) {
      const totaux = totaliserVentes(ventesAleatoires(alea));
      const dureeMinutes = alea.entier(30, 720);
      const resultat = calculerRentabilite({
        totaux,
        coutMatiereTransformeCents: alea.entier(0, 30_000),
        coutMarchandisesRevenduesCents: 0,
        coutComposantsVenteCents: 0,
        frais: {
          emplacementCents: 1200,
          deplacementCents: 900,
          gazCents: 500,
          diversCents: 0,
          energieCents: 0,
        },
        caCarteCents: 0,
        tauxCommissionCarteBp: PARAMETRES.pointsDeBase('taux_commission_sumup_bp'),
        production: {
          crepesProduites: 100,
          crepesVendues: 90,
          crepesInvendues: 10,
          crepesCassees: 0,
        },
        dureeMinutes,
      });
      // Arrondi unique a l'entier de centime : au plus un demi-centime d'ecart.
      expect(
        Math.abs(resultat.margeParHeureCents! - resultat.margeNetteCents / (dureeMinutes / 60)),
      ).toBeLessThanOrEqual(0.5);
    }
  });

  /**
   * ANCIEN `it.fails` — DIAGNOSTIC : le TEST etait faux, pas le modele.
   *
   * Le defaut d'origine — `nbTransactions` comptait des ARTICLES, pas des
   * tickets — a bien ete corrige par D-039 : `calculerRentabilite` rapporte
   * desormais `panierMoyenCents` au parametre `nbTickets`, explicitement
   * SAISI, et rend `null` tant qu'il ne l'est pas (docs/17 fiche 11). Mais le
   * present test, lui, n'a jamais fourni ce `nbTickets` : il attendait
   * 1500 (= CA / 1 ticket) sans jamais dire qu'il y avait 1 ticket, et
   * echouait donc pour une raison qui n'avait plus rien a voir avec le calcul.
   *
   * Ce qui restait reellement manquant n'etait pas le modele mais l'ECRAN :
   * `Sessions.tsx` ne portait aucun champ de saisie pour `nbTickets` — corrige
   * dans le meme lot (bloc CAISSE, « Tickets (optionnel) »).
   */
  it('le panier moyen rapporte le CA au nombre de tickets, pas au nombre d articles', () => {
    const totaux = totaliserVentes([
      {
        produitVenteId: 'p1',
        nature: 'transforme',
        quantite: 3,
        prixUnitaireCents: 500,
        nbCrepesParUnite: 1,
        consommationSurPlace: false,
      },
    ]);
    const resultat = calculerRentabilite({
      totaux,
      coutMatiereTransformeCents: 0,
      coutMarchandisesRevenduesCents: 0,
      coutComposantsVenteCents: 0,
      frais: {
        emplacementCents: 0,
        deplacementCents: 0,
        gazCents: 0,
        diversCents: 0,
        energieCents: 0,
      },
      caCarteCents: 0,
      tauxCommissionCarteBp: 0,
      production: { crepesProduites: 3, crepesVendues: 3, crepesInvendues: 0, crepesCassees: 0 },
      dureeMinutes: 390,
      // Une vente de 3 articles a UN SEUL client = 1 ticket, un panier de 15 €.
      nbTickets: 1,
    });
    expect(resultat.panierMoyenCents).toBe(1500);
    // Sans le ticket, le meme CA rend `null`, jamais 1500 : c'est exactement
    // ce que le test d'origine ne verifiait pas.
    const sansTicket = calculerRentabilite({
      totaux,
      coutMatiereTransformeCents: 0,
      coutMarchandisesRevenduesCents: 0,
      coutComposantsVenteCents: 0,
      frais: {
        emplacementCents: 0,
        deplacementCents: 0,
        gazCents: 0,
        diversCents: 0,
        energieCents: 0,
      },
      caCarteCents: 0,
      tauxCommissionCarteBp: 0,
      production: { crepesProduites: 3, crepesVendues: 3, crepesInvendues: 0, crepesCassees: 0 },
      dureeMinutes: 390,
    });
    expect(sansTicket.panierMoyenCents).toBeNull();
  });
});

describe('sessions.ts — seuils legaux', () => {
  it('la projection est monotone croissante en realise et nulle sous deux sessions', () => {
    const alea = new GenerateurDeterministe(GRAINE + 45);
    const plafondCents = PARAMETRES.centimes('seuil_franchise_tva_cents');

    for (let i = 0; i < TIRAGES; i += 1) {
      const realiseCents = alea.entier(0, plafondCents);
      const sessionsTenues = alea.entier(2, 50);
      const sessionsPrevuesDansLAnnee = alea.entier(sessionsTenues, 52);
      const commun = { cle: 'tva', libelle: 'TVA', plafondCents, sessionsPrevuesDansLAnnee };

      const bas = projeterSeuil({ ...commun, realiseCents, sessionsTenues });
      const haut = projeterSeuil({
        ...commun,
        realiseCents: realiseCents + alea.entier(0, 100_000),
        sessionsTenues,
      });

      expect(bas.projectionFinAnneeCents).not.toBeNull();
      expect(haut.projectionFinAnneeCents!).toBeGreaterThanOrEqual(bas.projectionFinAnneeCents!);
      expect(bas.partBp).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(bas.projectionFinAnneeCents!)).toBe(true);

      // Moins de deux sessions : aucune projection. Un rythme ne se deduit pas
      // d'un seul point, et une projection inventee serait pire qu'aucune.
      for (const tenues of [0, 1]) {
        expect(
          projeterSeuil({ ...commun, realiseCents, sessionsTenues: tenues })
            .projectionFinAnneeCents,
        ).toBeNull();
      }
    }
  });

  it('un plafond nul ou negatif ne produit ni division par zero ni pourcentage infini', () => {
    const compteur = projeterSeuil({
      cle: 'x',
      libelle: 'X',
      realiseCents: 500_000,
      plafondCents: 0,
      sessionsTenues: 10,
      sessionsPrevuesDansLAnnee: 40,
    });
    expect(compteur.partBp).toBe(0);
    expect(Number.isFinite(compteur.projectionFinAnneeCents!)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §5. prevision/ — quantiles, newsvendor, baseline
   ═══════════════════════════════════════════════════════════════════════════ */

describe('prevision/statistiques.ts', () => {
  it('quantileNormal est strictement croissante sur ]0,1[, jonctions d Acklam comprises', () => {
    // L'approximation d'Acklam change de branche a p = 0,02425 et p = 0,97575.
    // Une discontinuite a la jonction inverserait l'ordre de deux quantiles
    // voisins et rendrait p10 > p50 sur certaines entrees.
    const probabilites = [0.001, 0.0242499, 0.02425, 0.0242501, 0.1, 0.5, 0.9, 0.97575, 0.999];
    for (let i = 1; i < probabilites.length; i += 1) {
      expect(quantileNormal(probabilites[i]!)).toBeGreaterThan(
        quantileNormal(probabilites[i - 1]!),
      );
    }

    const alea = new GenerateurDeterministe(GRAINE + 50);
    for (let i = 0; i < TIRAGES; i += 1) {
      const p = alea.entre(0.0001, 0.9998);
      expect(quantileNormal(p + 0.0001)).toBeGreaterThan(quantileNormal(p));
    }
  });

  it('quantileNormal refuse les probabilites hors ]0,1[', () => {
    for (const p of [0, 1, -0.1, 1.5]) {
      expect(() => quantileNormal(p)).toThrow(RangeError);
    }
  });

  it('quantileLogNormal est croissante en probabilite et jamais negative', () => {
    const alea = new GenerateurDeterministe(GRAINE + 51);
    for (let i = 0; i < TIRAGES; i += 1) {
      const mediane = alea.entier(1, 500);
      const sigma = alea.entre(0.05, 0.8);
      const p = alea.entre(0.01, 0.9);

      const bas = quantileLogNormal(mediane, sigma, p);
      const haut = quantileLogNormal(mediane, sigma, p + 0.05);
      expect(haut).toBeGreaterThan(bas);
      expect(bas).toBeGreaterThan(0);

      // La mediane de la loi log-normale est bien `mediane` : c'est ce qui rend
      // le p50 du moteur interpretable.
      expect(quantileLogNormal(mediane, sigma, 0.5)).toBeCloseTo(mediane, 6);
      // Sigma nul ou negatif : degenerescence propre vers la mediane.
      expect(quantileLogNormal(mediane, 0, p)).toBe(mediane);
      expect(quantileLogNormal(0, sigma, p)).toBe(0);
    }
  });

  it('le ratio critique newsvendor reste dans ]0,1[ pour tous couts strictement positifs', () => {
    const alea = new GenerateurDeterministe(GRAINE + 52);
    for (let i = 0; i < TIRAGES; i += 1) {
      const coutRupture = alea.entier(1, 2000);
      const coutInvendu = alea.entier(1, 2000);
      const ratio = ratioCritique(coutRupture, coutInvendu);
      expect(ratio).not.toBeNull();

      expect(ratio!).toBeGreaterThan(0);
      expect(ratio!).toBeLessThan(1);
      // Croissant en cout de rupture, decroissant en cout d'invendu : c'est tout
      // le raisonnement de D-006 (« on ne produit jamais la mediane »).
      expect(ratioCritique(coutRupture + 100, coutInvendu)!).toBeGreaterThan(ratio!);
      expect(ratioCritique(coutRupture, coutInvendu + 100)!).toBeLessThan(ratio!);
    }
    // Cout manquant : `null`, et surtout PAS 0,5 — ce serait recommander la
    // mediane, que docs/03 interdit. Corrige en D-034.
    expect(ratioCritique(0, 0)).toBeNull();
  });

  /**
   * REGRESSION — plantage jour 1, corrige en D-034.
   *
   * Chemin complet, entierement realiste le jour de l'installation :
   *   1. aucune reception saisie -> aucun lot -> CUMP nul ;
   *   2. le cout par crepe retombe a 0 ;
   *   3. `ratioCritique(315, 0)` valait exactement 1 ;
   *   4. `quantileNormal(1)` levait une `RangeError` non traduite -> 500
   *      « Probabilite hors ]0,1[ : 1 » sur l'ecran Prochaine session.
   *
   * Desormais le ratio rend `null` et le moteur se rabat sur le quantile cible
   * parametre. La prevision reste calculable, ce qui est le comportement utile :
   * on ne peut pas refuser d'afficher une recommandation le jour de
   * l'installation, mais on ne doit pas non plus inventer un ratio.
   */
  it('un cout d invendu nul ne fait plus planter la prevision', () => {
    const entree: EntreePrevision = {
      baselineCrepes: 134,
      nbSessionsObservees: 3,
      meteo: null,
      coutRuptureCents: 315,
      coutInvenduCents: 0,
      contraintes: [],
    };

    const resultat = prevoir(entree, PARAMETRES);
    expect(Number.isFinite(resultat.crepesRecommandees)).toBe(true);
    expect(resultat.quantileCibleBp).toBe(PARAMETRES.pointsDeBase('quantile_cible_production_bp'));
  });

  it('le symétrique — coût de rupture nul — ne plante pas non plus', () => {
    const entree: EntreePrevision = {
      baselineCrepes: 134,
      nbSessionsObservees: 3,
      meteo: null,
      coutRuptureCents: 0,
      coutInvenduCents: 25,
      contraintes: [],
    };
    expect(() => prevoir(entree, PARAMETRES)).not.toThrow();
  });
});

describe('prevision/moteur.ts', () => {
  function entreePrevision(
    alea: GenerateurDeterministe,
    surcharges: Partial<EntreePrevision> = {},
  ): EntreePrevision {
    return {
      baselineCrepes: alea.entier(20, 400),
      nbSessionsObservees: alea.entier(0, 60),
      meteo: null,
      evenementBp: alea.entier(7000, 15_000),
      saisonBp: alea.entier(8000, 12_000),
      tendanceBp: alea.entier(9000, 11_000),
      coutRuptureCents: alea.entier(50, 500),
      coutInvenduCents: alea.entier(10, 100),
      contraintes: [],
      ...surcharges,
    };
  }

  it('p10 <= p50 <= p90 sur toutes les previsions', () => {
    const alea = new GenerateurDeterministe(GRAINE + 53);
    for (let i = 0; i < TIRAGES; i += 1) {
      const resultat = prevoir(entreePrevision(alea), PARAMETRES);
      expect(resultat.p10).toBeLessThanOrEqual(resultat.p50);
      expect(resultat.p50).toBeLessThanOrEqual(resultat.p90);
      expect(Number.isInteger(resultat.p10)).toBe(true);
      expect(Number.isInteger(resultat.p90)).toBe(true);
      expect(resultat.p10).toBeGreaterThanOrEqual(0);
    }
  });

  it('la recommandation depasse la mediane des que la rupture coute plus cher que l invendu', () => {
    const alea = new GenerateurDeterministe(GRAINE + 54);
    for (let i = 0; i < TIRAGES; i += 1) {
      const coutInvenduCents = alea.entier(10, 60);
      const resultat = prevoir(
        entreePrevision(alea, {
          coutInvenduCents,
          coutRuptureCents: coutInvenduCents + alea.entier(50, 500),
        }),
        PARAMETRES,
      );
      // C'est LE resultat contre-intuitif de D-006. S'il se cassait, personne ne
      // le verrait : la prevision resterait plausible, simplement trop basse.
      expect(resultat.quantileCibleBp).toBeGreaterThan(5000);
      expect(resultat.crepesRecommandees).toBeGreaterThanOrEqual(resultat.p50);
    }
  });

  it('les contraintes dures ne peuvent que rabaisser la recommandation', () => {
    const alea = new GenerateurDeterministe(GRAINE + 55);
    for (let i = 0; i < TIRAGES; i += 1) {
      const contraintes = contraintesSession({
        fenetreMinutes: alea.entier(120, 600),
        volumeParCrepeMl: alea.entier(50, 120),
        stockMaximalCrepes: alea.booleen() ? alea.entier(10, 500) : null,
        parametres: PARAMETRES,
      });
      const resultat = prevoir(entreePrevision(alea, { contraintes }), PARAMETRES);

      expect(resultat.crepesRetenues).toBeLessThanOrEqual(resultat.crepesRecommandees);
      const plafondMinimal = Math.min(...contraintes.map((c) => c.plafondCrepes));
      expect(resultat.crepesRetenues).toBe(Math.min(resultat.crepesRecommandees, plafondMinimal));

      if (resultat.contrainteLimitante === null) {
        expect(resultat.manqueAGagnerCents).toBeNull();
      } else {
        expect(resultat.manqueAGagnerCents).toBeGreaterThanOrEqual(0);
      }
      for (const contrainte of contraintes) {
        expect(contrainte.plafondCrepes).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('confianceBp reste dans [0, 10 000[ et croit avec l historique', () => {
    // La demi-confiance se LIT au catalogue, on ne la reecrit pas ici : sinon le
    // codage en dur se deplacerait du code vers le test, sans disparaitre.
    const demi = Number(
      CATALOGUE_PARAMETRES.find((p) => p.cle === 'prevision_demi_confiance_sessions')?.valeurDefaut,
    );
    expect(Number.isInteger(demi)).toBe(true);

    let precedent = confianceBp(0, demi);
    expect(precedent).toBe(0);
    for (let n = 1; n <= 300; n += 1) {
      const valeur = confianceBp(n, demi);
      expect(valeur).toBeGreaterThanOrEqual(precedent);
      expect(valeur).toBeLessThan(BASE_POINTS);
      precedent = valeur;
    }
  });

  it('confianceBp refuse une demi-confiance nulle ou negative au lieu d annoncer 100 %', () => {
    // Ce parametre est saisissable a l'ecran Parametres : rien n'empeche d'y
    // mettre 0. Sans garde, `n / (n + 0)` vaut 1, donc 100 % de confiance des la
    // premiere session — l'affirmation exactement inverse de celle que ce modele
    // a le droit de faire.
    expect(confianceBp(1, 0)).toBe(0);
    expect(confianceBp(300, -5)).toBe(0);
  });

  it('sigmaRetenu respecte les trois regimes de maturite de l historique', () => {
    // Le prior est un coefficient de VARIATION au catalogue ; la log-normale
    // se parametre par un ecart-type LOG. La conversion CV = √(exp(σ²) − 1)
    // est recalculee ici plutot que figee : le test porte sur la formule.
    const cvPrior = PARAMETRES.pointsDeBase('prevision_cv_prior_bp') / BASE_POINTS;
    const sigmaPrior = sigmaDepuisCoefficientVariation(cvPrior);
    const plancher = PARAMETRES.pointsDeBase('prevision_plancher_sigma_bp') / BASE_POINTS;
    const alea = new GenerateurDeterministe(GRAINE + 56);

    for (let i = 0; i < TIRAGES; i += 1) {
      const sigmaObserve = alea.entre(0.01, 0.9);
      // Sous 8 sessions on ne mesure rien : coefficient de variation a priori.
      expect(sigmaRetenu(alea.entier(0, 7), sigmaObserve, PARAMETRES)).toBe(sigmaPrior);
      // Entre 8 et 25, plancher pour ne pas afficher un intervalle trop etroit.
      expect(sigmaRetenu(alea.entier(8, 24), sigmaObserve, PARAMETRES)).toBeGreaterThanOrEqual(
        plancher,
      );
      // Au-dela de 25, la mesure prime.
      expect(sigmaRetenu(alea.entier(25, 200), sigmaObserve, PARAMETRES)).toBe(sigmaObserve);
      // Sans mesure, quelle que soit l'anciennete, on retombe sur le prior.
      expect(sigmaRetenu(alea.entier(0, 200), null, PARAMETRES)).toBe(sigmaPrior);
    }
  });

  it('le facteur meteo reste strictement positif quelles que soient les conditions', () => {
    const alea = new GenerateurDeterministe(GRAINE + 57);
    for (let i = 0; i < TIRAGES; i += 1) {
      const conditions: ConditionsMeteo = {
        temperatureC: alea.entre(-15, 40),
        precipitationsMm: alea.booleen() ? 0 : alea.entre(0.1, 30),
        ventKmh: alea.entre(0, 110),
        couvertureNuageuseBp: alea.entier(0, BASE_POINTS),
      };
      const resultat = facteurMeteo(conditions, PARAMETRES);
      // Un facteur nul ou negatif ferait s'effondrer le modele multiplicatif et,
      // pire, ferait exploser la normalisation de `baseline.ts`.
      expect(resultat.facteurBp).toBeGreaterThan(0);
      expect(Number.isInteger(resultat.facteurBp)).toBe(true);
    }
  });

  /**
   * ANCIEN `it.fails` — DIAGNOSTIC : le TEST etait faux, pas le modele.
   *
   * Le defaut d'origine — `sigmaRetenu(nbSessions, null, parametres)` ecrit en
   * dur dans `moteur.ts` — a bien ete corrige par D-034 : `EntreePrevision` a
   * gagne un champ `sigmaObserve` et la route le remplit avec la mesure de
   * `calculerBaseline`. Mais le present test, lui, n'a jamais ete mis a jour :
   * son fabricant `entreePrevision` ne pose AUCUN `sigmaObserve`. Les deux
   * appels retombaient donc tous les deux sur le prior, et l'assertion
   * echouait pour une raison qui n'avait plus rien a voir avec le modele.
   *
   * On le remplace par la propriete correcte, en fournissant la mesure — et par
   * son pendant d'honnetete juste en dessous, qui interdit au modele de
   * resserrer un intervalle que les donnees ne resserrent pas.
   */
  it('l intervalle p10–p90 se resserre quand la mesure devient exploitable', () => {
    const alea = new GenerateurDeterministe(GRAINE + 58);
    const avantMesure = PARAMETRES.entier('prevision_sessions_avant_sigma_mesure');
    const fiable = PARAMETRES.entier('prevision_sessions_sigma_fiable');
    const plancher = PARAMETRES.pointsDeBase('prevision_plancher_sigma_bp') / BASE_POINTS;

    for (let i = 0; i < TIRAGES; i += 1) {
      // Un historique regulier : la dispersion mesuree tombe SOUS le plancher.
      // C'est le seul cas ou l'intervalle a le droit de se resserrer.
      const sigmaObserve = alea.entre(0.01, plancher * 0.9);
      // Couts du regime REEL : une rupture coute plus qu'un invendu, donc le
      // quantile cible est au-dessus de la mediane. Dans le regime inverse
      // (Co > Cu) le sens de la derniere assertion s'inverse, et c'est correct :
      // moins d'incertitude fait alors produire PLUS, pas moins.
      const coutInvenduCents = alea.entier(10, 60);
      const base = entreePrevision(alea, {
        sigmaObserve,
        nbSessionsObservees: avantMesure - 1,
        coutInvenduCents,
        coutRuptureCents: coutInvenduCents + alea.entier(50, 500),
      });

      const jeune = prevoir(base, PARAMETRES);
      const intermediaire = prevoir({ ...base, nbSessionsObservees: avantMesure }, PARAMETRES);
      const mature = prevoir({ ...base, nbSessionsObservees: fiable }, PARAMETRES);

      const largeur = (r: { p10: number; p90: number }): number => r.p90 - r.p10;
      expect(largeur(intermediaire)).toBeLessThanOrEqual(largeur(jeune));
      expect(largeur(mature)).toBeLessThan(largeur(jeune));
      // La recommandation suit : moins d'incertitude, moins de sur-production.
      expect(mature.crepesRecommandees).toBeLessThan(jeune.crepesRecommandees);
    }
  });

  it('l intervalle ne se resserre PAS quand les donnees restent dispersees', () => {
    // Le pendant d'honnetete. Un intervalle de PREDICTION mesure la variabilite
    // de la demande, pas celle de l'estimateur : il converge vers la dispersion
    // reelle, il ne tend pas vers zero. Un modele qui retrecirait son intervalle
    // avec le seul nombre de sessions mentirait — c'est exactement le reproche
    // que docs/03 adresse au « 168 crêpes sans intervalle ».
    const alea = new GenerateurDeterministe(GRAINE + 59);
    const fiable = PARAMETRES.entier('prevision_sessions_sigma_fiable');

    for (let i = 0; i < TIRAGES; i += 1) {
      const sigmaObserve = alea.entre(0.4, 0.9);
      const base = entreePrevision(alea, { sigmaObserve, nbSessionsObservees: fiable });
      const mature = prevoir(base, PARAMETRES);
      const tresMature = prevoir({ ...base, nbSessionsObservees: fiable * 8 }, PARAMETRES);

      expect(tresMature.p90 - tresMature.p10).toBe(mature.p90 - mature.p10);
      // Et l'intervalle reste large : la confiance affichee, elle, monte.
      expect(tresMature.confianceBp).toBeGreaterThan(mature.confianceBp);
    }
  });

  /**
   * DEFAUT — `prevoir` (`prevision/moteur.ts`) : la garde
   * `entree.baselineCrepes <= 0` laissait passer `NaN` (toute comparaison
   * avec NaN est fausse).
   *
   * Source realiste du NaN : `calculerBaseline` avec `prevision_poids_prior_k`
   * a 0 et aucune session close calcule `(0 × prior + 0) / (0 + 0)`, soit NaN.
   * Ce parametre est modifiable depuis l'ecran Parametres. Le NaN traverse alors
   * tout le moteur — p10, p50, p90, crepesRecommandees — et l'ecran Prochaine
   * session affiche « NaN crepes » sans qu'aucune erreur ne soit levee.
   * Meme famille que le defaut de densite en §2 : une garde `<= 0` ne rejette
   * pas NaN, il faut `Number.isFinite`.
   */
  // CORRIGE (D-034) : `prevoir` teste `Number.isFinite` sur la baseline.
  it('une baseline NaN est rejetee par une erreur metier', () => {
    const parametresSansPrior = parametresDeTest({ prevision_poids_prior_k: '0' });
    const baseline = calculerBaseline([], '2026-07-26', parametresSansPrior);
    expect(Number.isNaN(baseline.baselineCrepes)).toBe(true);

    expect(() =>
      prevoir(
        {
          baselineCrepes: baseline.baselineCrepes,
          nbSessionsObservees: 0,
          meteo: null,
          coutRuptureCents: 315,
          coutInvenduCents: 25,
          contraintes: [],
        },
        PARAMETRES,
      ),
    ).toThrow(ErreurMetier);
  });

  /* ─────────────────────────────────────────────────────────────────────────
     Proprietes du moteur — audit docs/15
     ───────────────────────────────────────────────────────────────────────── */

  it('la recommandation est MONOTONE en la demande attendue', () => {
    // Propriete la plus elementaire du moteur, et pourtant celle qui casserait
    // le plus silencieusement : plus on attend de clients, jamais moins a
    // produire. Un arrondi mal place suffirait a la violer.
    const alea = new GenerateurDeterministe(GRAINE + 60);
    for (let i = 0; i < TIRAGES; i += 1) {
      const base = entreePrevision(alea, { baselineCrepes: alea.entier(20, 300) });
      const plus = prevoir({ ...base, baselineCrepes: base.baselineCrepes + 1 }, PARAMETRES);
      const moins = prevoir(base, PARAMETRES);

      expect(plus.crepesRecommandees).toBeGreaterThanOrEqual(moins.crepesRecommandees);
      expect(plus.p50).toBeGreaterThanOrEqual(moins.p50);
      expect(plus.p10).toBeGreaterThanOrEqual(moins.p10);
      expect(plus.p90).toBeGreaterThanOrEqual(moins.p90);
    }
  });

  it('aucune entree finie ne produit NaN, Infinity ou un nombre negatif', () => {
    // D-034 l'a montre : ici, un `NaN` se propage SANS JAMAIS LEVER. On balaie
    // donc les extremes de chaque entree, y compris ceux qu'aucun ecran ne
    // produit aujourd'hui — c'est le propre d'un parametre modifiable.
    const alea = new GenerateurDeterministe(GRAINE + 61);
    for (let i = 0; i < TIRAGES; i += 1) {
      const entree: EntreePrevision = {
        baselineCrepes: alea.entier(1, 5000),
        nbSessionsObservees: alea.entier(0, 1000),
        sigmaObserve: alea.choisir([null, 0, 1e-9, 0.18, 3, Number.NaN, Number.POSITIVE_INFINITY]),
        meteo: null,
        evenementBp: alea.entier(1, 100_000),
        saisonBp: alea.entier(1, 100_000),
        tendanceBp: alea.entier(1, 100_000),
        coutRuptureCents: alea.choisir([1, 25, 315, 1e6, 1e15]),
        coutInvenduCents: alea.choisir([1, 25, 315, 1e6, 1e15]),
        contraintes: contraintesSession({
          // Fenetre NEGATIVE comprise : une heure de fin saisie avant l'heure
          // de debut donnait un plafond de −1020 crepes, donc une production
          // negative et un manque a gagner gigantesque.
          fenetreMinutes: alea.entier(-600, 600),
          volumeParCrepeMl: alea.entier(0, 200),
          stockMaximalCrepes: alea.booleen() ? alea.entier(-50, 500) : null,
          parametres: PARAMETRES,
        }),
      };

      const r = prevoir(entree, PARAMETRES);
      for (const valeur of [
        r.demandeAttendue,
        r.p10,
        r.p50,
        r.p90,
        r.crepesRecommandees,
        r.crepesRetenues,
        r.quantileCibleBp,
        r.confianceBp,
        r.manqueAGagnerCents ?? 0,
      ]) {
        expect(Number.isFinite(valeur)).toBe(true);
        expect(valeur).toBeGreaterThanOrEqual(0);
      }
      expect(r.p10).toBeLessThanOrEqual(r.p50);
      expect(r.p50).toBeLessThanOrEqual(r.p90);
    }
  });

  it('meteo et evenement se COMPOSENT sans s annuler', () => {
    // Modele multiplicatif : appliquer deux facteurs defavorables doit donner
    // strictement moins que chacun pris seul. Une composition ecrite en
    // addition, ou un facteur qui remplacerait l'autre, passerait inapercue.
    const alea = new GenerateurDeterministe(GRAINE + 62);
    const pluieEtVent: ConditionsMeteo = {
      temperatureC: 8,
      precipitationsMm: 6,
      ventKmh: 60,
      couvertureNuageuseBp: 9500,
    };

    for (let i = 0; i < TIRAGES; i += 1) {
      const socle = entreePrevision(alea, { meteo: null, evenementBp: BASE_POINTS });
      const evenementBp = alea.entier(3000, 9000);

      const neutre = prevoir(socle, PARAMETRES).demandeAttendue;
      const meteoSeule = prevoir({ ...socle, meteo: pluieEtVent }, PARAMETRES).demandeAttendue;
      const evenementSeul = prevoir({ ...socle, evenementBp }, PARAMETRES).demandeAttendue;
      const lesDeux = prevoir(
        { ...socle, meteo: pluieEtVent, evenementBp },
        PARAMETRES,
      ).demandeAttendue;

      expect(meteoSeule).toBeLessThan(neutre);
      expect(evenementSeul).toBeLessThan(neutre);
      // Le produit, a l'arrondi pres : jamais une somme, jamais un remplacement.
      expect(lesDeux).toBeLessThanOrEqual(Math.min(meteoSeule, evenementSeul));
      expect(lesDeux).toBeCloseTo((meteoSeule * evenementSeul) / neutre, -0.5);
    }
  });

  it('quantileNormal et repartitionNormale sont reciproques', () => {
    // Les deux approximations sont independantes l'une de l'autre : si l'une
    // derivait, la composition ne rendrait plus l'identite.
    const alea = new GenerateurDeterministe(GRAINE + 63);
    for (let i = 0; i < TIRAGES; i += 1) {
      const p = alea.entre(0.001, 0.999);
      expect(repartitionNormale(quantileNormal(p))).toBeCloseTo(p, 8);
    }
    // Valeurs de reference publiees, verifiees a 4 decimales.
    expect(quantileNormal(0.9)).toBeCloseTo(1.2816, 4);
    expect(quantileNormal(0.95)).toBeCloseTo(1.6449, 4);
    expect(quantileNormal(0.99)).toBeCloseTo(2.3263, 4);
  });

  it('la mediane deduite de l esperance est coherente avec la log-normale', () => {
    const alea = new GenerateurDeterministe(GRAINE + 64);
    for (let i = 0; i < TIRAGES; i += 1) {
      const esperance = alea.entre(10, 500);
      const sigma = alea.entre(0.01, 1.2);
      const mediane = medianeDepuisEsperance(esperance, sigma);

      // La mediane est TOUJOURS sous la moyenne pour une log-normale.
      expect(mediane).toBeLessThan(esperance);
      // Et l'esperance se retrouve exactement : E = mediane × exp(sigma²/2).
      expect(mediane * Math.exp((sigma * sigma) / 2)).toBeCloseTo(esperance, 6);
      // Le quantile 50 % d'une log-normale de cette mediane, c'est la mediane.
      expect(quantileLogNormal(mediane, sigma, 0.5)).toBeCloseTo(mediane, 6);
    }
  });

  it('les ventes esperees sont bornees par la production et par la demande', () => {
    const alea = new GenerateurDeterministe(GRAINE + 65);
    for (let i = 0; i < TIRAGES; i += 1) {
      const mediane = alea.entre(20, 400);
      const sigma = alea.entre(0.05, 0.9);
      const quantite = alea.entre(1, 900);

      const ventes = ventesEsperees(quantite, mediane, sigma);
      const esperanceDemande = mediane * Math.exp((sigma * sigma) / 2);

      // On ne vend ni plus qu'on ne produit, ni plus que ce que la demande peut
      // absorber en moyenne.
      expect(ventes).toBeGreaterThan(0);
      expect(ventes).toBeLessThanOrEqual(quantite);
      // `<=` et non `<` : mathematiquement l'inegalite est stricte pour tout Q
      // fini, mais elle SATURE en double des que Q depasse largement la
      // demande — la difference passe sous l'epsilon machine.
      expect(ventes).toBeLessThanOrEqual(esperanceDemande);
      // A la mediane, en revanche, l'ecart est franc : on laisse passer la
      // moitie des journees sans avoir de quoi servir.
      expect(ventesEsperees(mediane, mediane, sigma)).toBeLessThan(esperanceDemande);
      // Monotone : produire plus ne fait jamais vendre moins.
      expect(ventesEsperees(quantite + 1, mediane, sigma)).toBeGreaterThanOrEqual(ventes);
    }
  });

  it('le manque a gagner croit avec la severite de la contrainte, sans jamais atteindre la marge pleine', () => {
    const alea = new GenerateurDeterministe(GRAINE + 66);
    for (let i = 0; i < TIRAGES; i += 1) {
      const mediane = alea.entre(50, 250);
      const sigma = alea.entre(0.1, 0.5);
      const coutInvenduCents = alea.entier(5, 60);
      const coutRuptureCents = coutInvenduCents + alea.entier(50, 400);
      const crepesRecommandees = Math.round(
        quantileLogNormal(mediane, sigma, coutRuptureCents / (coutRuptureCents + coutInvenduCents)),
      );
      const serre = Math.max(1, Math.round(crepesRecommandees * 0.6));
      const large = Math.max(serre + 1, Math.round(crepesRecommandees * 0.9));

      const commun = { crepesRecommandees, mediane, sigma, coutRuptureCents, coutInvenduCents };
      const manqueSerre = manqueAGagnerEcretage({ ...commun, crepesRetenues: serre });
      const manqueLarge = manqueAGagnerEcretage({ ...commun, crepesRetenues: large });

      expect(manqueSerre).toBeGreaterThanOrEqual(manqueLarge);
      expect(manqueLarge).toBeGreaterThanOrEqual(0);
      // La formule naive de docs/03 — « crêpes retirées × marge » — majore
      // toujours, et largement : les crepes ecretees viennent du haut de la
      // distribution, celles qui ne se vendent que les tres bons jours.
      expect(manqueSerre).toBeLessThan((crepesRecommandees - serre) * coutRuptureCents);
      // Aucune contrainte qui ne mord pas ne peut coûter quoi que ce soit.
      expect(manqueAGagnerEcretage({ ...commun, crepesRetenues: crepesRecommandees })).toBe(0);
    }
  });

  it('le ratio critique ne sort jamais du domaine ouvert ]0 ; 1[', () => {
    // `quantileNormal(0)` et `quantileNormal(1)` levent. Deux couts strictement
    // positifs ne suffisent pas a l'exclure : avec Cu = 1e16 et Co = 1, la somme
    // est arrondie a Cu et le ratio vaut exactement 1.
    const alea = new GenerateurDeterministe(GRAINE + 67);
    const extremes = [1e-6, 1, 25, 315, 1e6, 1e15, 1e16, Number.MAX_VALUE];
    for (let i = 0; i < TIRAGES; i += 1) {
      const ratio = ratioCritique(alea.choisir(extremes), alea.choisir(extremes));
      if (ratio === null) continue;
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(1);
      expect(() => quantileNormal(ratio)).not.toThrow();
    }
    expect(ratioCritique(1e16, 1)).toBeNull();
  });
});

describe('prevision/baseline.ts', () => {
  /** Historique de sessions hebdomadaires, facteurs neutres sauf demande contraire. */
  function historique(
    alea: GenerateurDeterministe,
    nbSessions: number,
    jourReference: string,
    facteursNeutres: boolean,
  ): ObservationSession[] {
    const observations: ObservationSession[] = [];
    for (let i = 0; i < nbSessions; i += 1) {
      observations.push({
        dateSession: jourMoins(jourReference, 7 * (i + 1)),
        crepesVendues: alea.entier(40, 300),
        meteoBp: facteursNeutres ? BASE_POINTS : alea.entier(5500, 12_000),
        evenementBp: facteursNeutres ? BASE_POINTS : alea.entier(9000, 15_000),
        saisonBp: facteursNeutres ? BASE_POINTS : alea.entier(8000, 12_000),
      });
    }
    return observations;
  }

  it('sans aucune session, la baseline est exactement le prior et le prior pese 100 %', () => {
    const prior = PARAMETRES.entier('prevision_prior_baseline_crepes');
    const resultat = calculerBaseline([], '2026-07-26', PARAMETRES);

    expect(resultat.baselineCrepes).toBe(prior);
    expect(resultat.poidsPriorBp).toBe(BASE_POINTS);
    expect(resultat.nbSessionsRetenues).toBe(0);
    expect(resultat.sigmaObserve).toBeNull();
  });

  it('le poids du prior decroit strictement de 0 a 30 sessions', () => {
    const alea = new GenerateurDeterministe(GRAINE + 60);
    const jourReference = '2026-07-26';
    let precedent = calculerBaseline([], jourReference, PARAMETRES).poidsPriorBp;

    // 30 est le seuil `SESSIONS_AVANT_DECROISSANCE` : en deca, chaque session
    // pese 1, donc la somme des poids vaut exactement n et la decroissance de
    // k/(k+n) est stricte.
    for (let n = 1; n <= 30; n += 1) {
      const resultat = calculerBaseline(
        historique(alea, n, jourReference, true),
        jourReference,
        PARAMETRES,
      );
      expect(resultat.poidsPriorBp).toBeLessThan(precedent);
      expect(resultat.poidsPriorBp).toBeGreaterThan(0);
      precedent = resultat.poidsPriorBp;
    }
  });

  it('la baseline est toujours une moyenne convexe du prior et des observations', () => {
    // Corollaire direct de « aucun poids temporel n'est negatif ni superieur a 1 » :
    // si un poids sortait de ]0,1], la moyenne ponderee pourrait quitter
    // l'intervalle [min, max] des valeurs combinees.
    const alea = new GenerateurDeterministe(GRAINE + 61);
    const prior = PARAMETRES.entier('prevision_prior_baseline_crepes');
    const jourReference = '2026-07-26';

    for (let i = 0; i < 120; i += 1) {
      const observations = historique(alea, alea.entier(1, 60), jourReference, true);
      const resultat = calculerBaseline(observations, jourReference, PARAMETRES);
      const valeurs = [prior, ...observations.map((o) => o.crepesVendues)];

      // Tolerance de 1 : la baseline est arrondie a l'entier.
      expect(resultat.baselineCrepes).toBeGreaterThanOrEqual(Math.min(...valeurs) - 1);
      expect(resultat.baselineCrepes).toBeLessThanOrEqual(Math.max(...valeurs) + 1);
      expect(resultat.poidsPriorBp).toBeGreaterThan(0);
      expect(resultat.poidsPriorBp).toBeLessThanOrEqual(BASE_POINTS);
    }
  });

  it('la normalisation neutralise bien les facteurs du jour', () => {
    // Deux sessions identiques a la meteo pres doivent donner la meme baseline
    // une fois normalisees : c'est ce qui rend deux marches comparables.
    const jourReference = '2026-07-26';
    const parFacteur = (meteoBp: PointsDeBase, crepesVendues: number): number =>
      calculerBaseline(
        [
          {
            dateSession: jourMoins(jourReference, 7),
            crepesVendues,
            meteoBp,
            evenementBp: BASE_POINTS,
            saisonBp: BASE_POINTS,
          },
        ],
        jourReference,
        PARAMETRES,
      ).baselineCrepes;

    // 100 crepes par pluie continue (facteur du catalogue) equivalent a
    // 100 / facteur crepes par temps neutre.
    const pluieBp = PARAMETRES.pointsDeBase('prevision_meteo_pluie_continue_bp');
    const equivalentNeutre = Math.round(100 / (pluieBp / BASE_POINTS));
    expect(
      Math.abs(parFacteur(pluieBp, 100) - parFacteur(BASE_POINTS, equivalentNeutre)),
    ).toBeLessThanOrEqual(1);
  });

  it('sigmaObserve n apparait qu au-dela du minimum de residus, et reste positif', () => {
    const alea = new GenerateurDeterministe(GRAINE + 62);
    const jourReference = '2026-07-26';
    // Sous 8 residus, `baseline.ts:47` refuse de mesurer une dispersion : un
    // ecart-type sur 3 points ne mesure rien.
    for (let n = 0; n <= 7; n += 1) {
      expect(
        calculerBaseline(historique(alea, n, jourReference, true), jourReference, PARAMETRES)
          .sigmaObserve,
      ).toBeNull();
    }
    for (let n = 8; n <= 20; n += 1) {
      const sigma = calculerBaseline(
        historique(alea, n, jourReference, true),
        jourReference,
        PARAMETRES,
      ).sigmaObserve;
      expect(sigma).not.toBeNull();
      expect(sigma!).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(sigma!)).toBe(true);
    }
  });

  /**
   * DEFAUT — `baseline.ts:96` : `avecDecroissance = observations.length > 30`
   * est un COUPERET, alors que le commentaire de `poidsTemporel` promet
   * l'inverse (« la decroissance est exponentielle, jamais un couperet »).
   *
   * A la 30e session close, chaque observation pese 1 et la somme des poids vaut
   * 30. A la 31e, la ponderation temporelle s'active d'un coup sur TOUT
   * l'historique : avec des sessions hebdomadaires et une demi-vie de 26
   * semaines, la somme des poids retombe a ≈ 21,3. Le poids du prior REMONTE
   * donc de 9,1 % a 12,3 % — l'estimation de depart reprend de l'importance
   * apres une session de plus, et la baseline saute sans raison metier.
   *
   * Impact : discontinuite visible dans la phrase d'explication affichee
   * (« l'estimation de depart pese encore X % ») et micro-saut de la prevision
   * autour de la 31e session. Correctif attendu : appliquer la ponderation
   * temporelle en permanence, ou faire varier le seuil continument.
   */
  // CORRIGE : la ponderation par recence redistribue le poids ENTRE les
  // observations sans toucher a la masse totale. `poidsPriorBp` vaut donc
  // exactement k/(k+n), strictement decroissant.
  it('le poids du prior ne remonte jamais quand une session s ajoute', () => {
    const alea = new GenerateurDeterministe(GRAINE + 63);
    const jourReference = '2026-07-26';
    const trente = calculerBaseline(
      historique(alea, 30, jourReference, true),
      jourReference,
      PARAMETRES,
    );
    const trenteEtUn = calculerBaseline(
      historique(new GenerateurDeterministe(GRAINE + 63), 31, jourReference, true),
      jourReference,
      PARAMETRES,
    );
    expect(trenteEtUn.poidsPriorBp).toBeLessThanOrEqual(trente.poidsPriorBp);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §6. comptabilite.ts — amortissements, resultat, echeances
   ═══════════════════════════════════════════════════════════════════════════ */

describe('comptabilite.ts — amortissements', () => {
  const METHODES: readonly MethodeAmortissement[] = ['lineaire', 'degressive'];

  it('la somme des annuites egale EXACTEMENT le montant amortissable, 1 a 20 ans, deux methodes', () => {
    const alea = new GenerateurDeterministe(GRAINE + 70);
    for (let i = 0; i < TIRAGES; i += 1) {
      const montantCents = alea.entier(1000, 5_000_000);
      const immobilisation: Immobilisation = {
        libelle: 'Materiel',
        dateAcquisition: `${alea.entier(2020, 2030)}-0${alea.entier(1, 9)}-15`,
        montantCents,
        dureeAnnees: alea.entier(1, 20),
        methode: alea.choisir(METHODES),
        valeurResiduelleCents: alea.entier(0, Math.floor(montantCents / 2)),
      };
      const plan = planAmortissement(immobilisation);
      const amortissable = montantCents - immobilisation.valeurResiduelleCents;

      // AUCUNE tolerance : un plan d'amortissement dont le total ne tombe pas
      // juste est inexploitable par un comptable.
      expect(plan.reduce((s, a) => s + a.montantCents, 0)).toBe(amortissable);
      expect(plan).toHaveLength(immobilisation.dureeAnnees);
      for (const annuite of plan) {
        expect(Number.isInteger(annuite.montantCents)).toBe(true);
      }
    }
  });

  it('la valeur nette comptable decroit et n atteint jamais moins que la valeur residuelle', () => {
    const alea = new GenerateurDeterministe(GRAINE + 71);
    for (let i = 0; i < TIRAGES; i += 1) {
      const montantCents = alea.entier(5000, 5_000_000);
      const valeurResiduelleCents = alea.entier(0, Math.floor(montantCents / 3));
      const immobilisation: Immobilisation = {
        libelle: 'Materiel',
        dateAcquisition: '2026-03-15',
        montantCents,
        dureeAnnees: alea.entier(1, 20),
        methode: alea.choisir(METHODES),
        valeurResiduelleCents,
      };
      const plan = planAmortissement(immobilisation);

      let precedent = montantCents;
      for (const annuite of plan) {
        expect(annuite.montantCents).toBeGreaterThanOrEqual(0);
        expect(annuite.valeurNetteFinCents).toBeLessThanOrEqual(precedent);
        expect(annuite.valeurNetteFinCents).toBeGreaterThanOrEqual(0);
        precedent = annuite.valeurNetteFinCents;
      }
      // En fin de plan il reste exactement la valeur residuelle, au centime.
      expect(plan.at(-1)!.valeurNetteFinCents).toBe(valeurResiduelleCents);
      // La VNC lue par exercice suit le plan.
      expect(valeurNetteComptable(immobilisation, 2026 + immobilisation.dureeAnnees)).toBe(
        valeurResiduelleCents,
      );
      // Avant le premier exercice, rien n'est amorti.
      expect(valeurNetteComptable(immobilisation, 2025)).toBe(montantCents);
    }
  });

  it('les entrees invalides levent une erreur metier', () => {
    const base: Immobilisation = {
      libelle: 'Plaque gaz',
      dateAcquisition: '2026-01-10',
      montantCents: 45_000,
      dureeAnnees: 5,
      methode: 'lineaire',
      valeurResiduelleCents: 0,
    };
    expect(() => planAmortissement({ ...base, dureeAnnees: 0 })).toThrow(ErreurMetier);
    expect(() => planAmortissement({ ...base, montantCents: 0 })).toThrow(ErreurMetier);
    expect(() => planAmortissement({ ...base, valeurResiduelleCents: 45_000 })).toThrow(
      ErreurMetier,
    );
  });

  /**
   * DEFAUT (mineur, borne aux tres petits montants) — `comptabilite.ts:79`.
   *
   * En lineaire, les n−1 premieres annuites valent `round(A/n)`. Quand cet
   * arrondi se fait vers le haut et que A est petit devant n, le cumul depasse A
   * avant la derniere annuite : celle-ci devient NEGATIVE et la valeur nette
   * comptable passe sous la valeur residuelle en cours de plan.
   *
   * Condition exacte : amortissable < 0,5 × n × (n−1). Le cas minimal est
   * 2 centimes sur 4 ans (annuites 1, 1, 1, −1). Le pire cas realiste est un
   * amortissable inferieur a 1,90 € sur 20 ans — donc hors de tout usage sense.
   * Signale pour completude : l'invariant « annuite >= 0 » est faux tel qu'ecrit,
   * meme si aucun bien du projet ne tombera dans cette plage.
   */
  // CORRIGE : l'annuite est bornee par le restant a amortir.
  it('aucune annuite n est negative, meme sur un montant derisoire', () => {
    const plan = planAmortissement({
      libelle: 'Cas limite',
      dateAcquisition: '2026-01-01',
      montantCents: 2,
      dureeAnnees: 4,
      methode: 'lineaire',
      valeurResiduelleCents: 0,
    });
    for (const annuite of plan) {
      expect(annuite.montantCents).toBeGreaterThanOrEqual(0);
      expect(annuite.valeurNetteFinCents).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * DEFAUT — `comptabilite.ts:71-76` : `dureeAnnees` n'est jamais verifie entier.
   *
   * La boucle tourne `Math.ceil(duree)` fois, mais le test d'absorption de
   * l'arrondi `index === dureeAnnees − 1` ne peut JAMAIS etre vrai sur une duree
   * fractionnaire. Aucune annuite ne rattrape le reliquat, et la somme depasse
   * l'amortissable.
   *
   * IMPACT CHIFFRE : 1 000 € sur 2,5 ans en lineaire produit trois annuites de
   * 400 € = 1 200 €, soit 200 € d'amortissement fantome — 200 € de charge
   * deduite qui n'existe pas, sur un bien qui n'existe pas a hauteur de 20 %.
   * La VNC finale devient negative (−200 €).
   *
   * Non atteignable aujourd'hui par HTTP (`contrats/comptabilite.ts:104` impose
   * `z.int().positive()`), mais `packages/core` est la couche pure et testee du
   * projet : elle doit se defendre seule, sans dependre d'un validateur en amont.
   */
  // CORRIGE : `planAmortissement` refuse desormais une duree non entiere.
  it('une duree fractionnaire est refusee', () => {
    const immobilisation: Immobilisation = {
      libelle: 'Duree fractionnaire',
      dateAcquisition: '2026-01-01',
      montantCents: 100_000,
      dureeAnnees: 2.5,
      methode: 'lineaire',
      valeurResiduelleCents: 0,
    };
    // Avant correction : 3 annuites de 400 € sur 1 000 € demandes, soit 200 €
    // d'amortissement fantome et une valeur nette finale negative. Le test
    // d'absorption `index === duree - 1` ne matchait jamais sur 2,5.
    expect(() => planAmortissement(immobilisation)).toThrow(ErreurMetier);
  });
});

describe('comptabilite.ts — depenses et resultat', () => {
  it('la somme des categories egale exactement le total du journal', () => {
    const alea = new GenerateurDeterministe(GRAINE + 72);
    const categories = ['matiere', 'emplacement', 'carburant', 'materiel', 'assurance'];

    for (let i = 0; i < TIRAGES; i += 1) {
      const lignes: LigneJournal[] = [];
      for (let l = 0; l < alea.entier(1, 25); l += 1) {
        lignes.push({
          date: '2026-05-12',
          libelle: `Depense ${l}`,
          categorie: alea.choisir(categories),
          montantCents: alea.entier(1, 200_000),
          deductibleBp: alea.entier(0, BASE_POINTS),
        });
      }
      const totaux = totaliserJournal(lignes);
      const sommeCategories = [...totaux.parCategorie.values()].reduce((s, v) => s + v, 0);

      expect(sommeCategories).toBe(totaux.montantTotalCents);
      // Une part deductible <= 100 % ne peut pas exceder le total, a l'arrondi
      // pres : au plus un demi-centime par ligne.
      expect(totaux.montantDeductibleCents).toBeLessThanOrEqual(
        totaux.montantTotalCents + lignes.length * 0.5,
      );
      expect(totaux.montantDeductibleCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('montantDeductible est monotone et borne par le montant a 100 %', () => {
    const alea = new GenerateurDeterministe(GRAINE + 73);
    for (let i = 0; i < TIRAGES; i += 1) {
      const montant = alea.entier(1, 500_000);
      const bp = alea.entier(0, BASE_POINTS);
      expect(montantDeductible(montant, bp)).toBeLessThanOrEqual(montant + 1);
      expect(montantDeductible(montant, BASE_POINTS)).toBe(montant);
      expect(montantDeductible(montant, 0)).toBe(0);
    }
  });

  it('une perte ne cree ni cotisation ni impot', () => {
    const alea = new GenerateurDeterministe(GRAINE + 74);
    const tauxCotisationBp = PARAMETRES.pointsDeBase('taux_cotisation_inasti_bp');
    const tauxImpotBp = PARAMETRES.pointsDeBase('taux_ipp_marginal_bp');

    for (let i = 0; i < TIRAGES; i += 1) {
      const recettesCents = alea.entier(0, 500_000);
      const resultat = estimerResultat({
        recettesCents,
        // Depenses volontairement superieures aux recettes : exercice deficitaire.
        depensesDeductiblesCents: recettesCents + alea.entier(1, 200_000),
        amortissementsCents: alea.entier(0, 100_000),
        tauxCotisationBp,
        tauxImpotBp,
      });

      expect(resultat.beneficeBrutCents).toBeLessThan(0);
      expect(resultat.cotisationsSocialesCents).toBe(0);
      expect(resultat.impotEstimeCents).toBe(0);
      // Le net est alors exactement la perte, ni majoree ni minoree.
      expect(resultat.netEstimeCents).toBe(resultat.beneficeBrutCents);
    }
  });

  it('sur un exercice beneficiaire, le net est exactement brut − cotisations − impot', () => {
    const alea = new GenerateurDeterministe(GRAINE + 75);
    const tauxCotisationBp = PARAMETRES.pointsDeBase('taux_cotisation_inasti_bp');
    const tauxImpotBp = PARAMETRES.pointsDeBase('taux_ipp_marginal_bp');

    for (let i = 0; i < TIRAGES; i += 1) {
      const depensesDeductiblesCents = alea.entier(0, 300_000);
      const amortissementsCents = alea.entier(0, 100_000);
      const resultat = estimerResultat({
        recettesCents: depensesDeductiblesCents + amortissementsCents + alea.entier(0, 2_000_000),
        depensesDeductiblesCents,
        amortissementsCents,
        tauxCotisationBp,
        tauxImpotBp,
      });

      expect(resultat.beneficeBrutCents).toBeGreaterThanOrEqual(0);
      expect(resultat.netEstimeCents).toBe(
        resultat.beneficeBrutCents - resultat.cotisationsSocialesCents - resultat.impotEstimeCents,
      );
      // Tant que cotisations + impot restent sous 100 %, le net reste positif.
      expect(resultat.netEstimeCents).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(resultat.netEstimeCents)).toBe(true);
    }
  });
});

describe('comptabilite.ts — echeancier', () => {
  it('chaque echeance du catalogue produit une date valide et un delai fini', () => {
    // Lit le CATALOGUE : si quelqu'un ajoute une echeance au 29 fevrier, la date
    // construite n'existera pas trois annees sur quatre et ce test le dira.
    for (const echeance of CATALOGUE_ECHEANCES) {
      for (const jour of ['2026-01-01', '2026-06-15', '2026-12-31']) {
        const occurrence = prochaineOccurrence(echeance.jourReference, jour);
        expect(occurrence >= jour).toBe(true);
        expect(Number.isFinite(joursAvantEcheance(occurrence, jour))).toBe(true);
        expect(joursAvantEcheance(occurrence, jour)).toBeGreaterThanOrEqual(0);
      }
      // Une echeance sans source serait inverifiable l'annee suivante.
      expect(echeance.sourceLegale.length).toBeGreaterThan(0);
    }
  });

  it('joursAvantEcheance compte exactement un jour entre deux jours consecutifs, changements d heure compris', () => {
    // Les deux bascules heure d'ete / heure d'hiver belges tombent dans cette
    // fenetre (29 mars et 25 octobre 2026). Un calcul ancre a minuit local
    // renverrait 0 ou 2 jours ces jours-la ; l'ancrage a 12:00 UTC evite le piege.
    let jour = '2026-01-01';
    for (let i = 0; i < 400; i += 1) {
      const lendemain = jourMoins(jour, -1);
      expect(joursAvantEcheance(lendemain, jour)).toBe(1);
      expect(joursAvantEcheance(jour, lendemain)).toBe(-1);
      expect(joursAvantEcheance(jour, jour)).toBe(0);
      jour = lendemain;
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §7. ia.ts — compteur de cout et plafond mensuel
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ia.ts — cout des appels', () => {
  const USAGES: readonly UsageIa[] = [
    'prevision',
    'analyse_ecart',
    'extraction',
    'synthese',
    'evenements',
  ];

  it('un appel avec des tokens coute au moins un centime, pour les deux familles', () => {
    const alea = new GenerateurDeterministe(GRAINE + 80);
    for (let i = 0; i < TIRAGES; i += 1) {
      const usage = alea.choisir(USAGES);
      const tarif = tarifModele(familleModele(usage), PARAMETRES);
      const cout = coutAppelCents(alea.entier(1, 200_000), alea.entier(1, 8000), tarif);

      // Un appel compte pour zero ne consommerait jamais le plafond : le
      // garde-fou de CLAUDE.md §5 ne protegerait plus rien.
      expect(cout).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(cout)).toBe(true);
    }
    // Aucun token, aucune depense.
    const tarif = tarifModele('extraction', PARAMETRES);
    expect(coutAppelCents(0, 0, tarif)).toBe(0);
  });

  it('le cout est monotone croissant en tokens', () => {
    const alea = new GenerateurDeterministe(GRAINE + 81);
    for (const famille of ['extraction', 'commentaire'] as const) {
      const tarif = tarifModele(famille, PARAMETRES);
      for (let i = 0; i < TIRAGES; i += 1) {
        const entree = alea.entier(0, 150_000);
        const sortie = alea.entier(0, 8000);
        const cout = coutAppelCents(entree, sortie, tarif);

        expect(
          coutAppelCents(entree + alea.entier(0, 50_000), sortie, tarif),
        ).toBeGreaterThanOrEqual(cout);
        expect(coutAppelCents(entree, sortie + alea.entier(0, 4000), tarif)).toBeGreaterThanOrEqual(
          cout,
        );
        // Croissance stricte des qu'on double largement le volume.
        expect(coutAppelCents(entree * 4 + 100_000, sortie, tarif)).toBeGreaterThan(cout);
      }
    }
  });

  it('le compteur ne SOUS-estime jamais la depense reelle', () => {
    // Consequence assumee de l'arrondi au superieur (commentaire de `ia.ts:63`) :
    // le compteur surestime. Mesure ici pour memoire — 200 extractions de
    // 500/200 tokens coutent reellement ≈ 0,28 centime au total mais sont
    // comptees 200 centimes, soit ≈ 7 fois trop. Le plafond coupe donc l'IA
    // bien avant la depense reelle ; c'est prudent, pas faux, mais il faut le
    // savoir avant de conclure que « le plafond est trop bas ».
    const tarif = tarifModele('extraction', PARAMETRES);
    const nbAppels = 200;
    const reelExact =
      (nbAppels * (500 * tarif.entreeCentsParMtok + 200 * tarif.sortieCentsParMtok)) / 1_000_000;
    const compte = nbAppels * coutAppelCents(500, 200, tarif);

    expect(compte).toBeGreaterThanOrEqual(reelExact);
    expect(compte).toBe(nbAppels);
  });

  it('le cout maximal a priori majore toujours le cout constate', () => {
    const alea = new GenerateurDeterministe(GRAINE + 82);
    const tokensSortieMax = PARAMETRES.entier('ia_tokens_sortie_max');
    for (let i = 0; i < TIRAGES; i += 1) {
      const tarif = tarifModele(alea.booleen() ? 'extraction' : 'commentaire', PARAMETRES);
      const tokensEntree = alea.entier(1, 100_000);
      const tokensSortieReels = alea.entier(0, tokensSortieMax);

      // Sans cette majoration, on ne pourrait pas refuser un appel AVANT de le
      // lancer, et « on ne peut pas revenir sur une depense deja engagee ».
      expect(coutMaximalCents(tokensEntree, tokensSortieMax, tarif)).toBeGreaterThanOrEqual(
        coutAppelCents(tokensEntree, tokensSortieReels, tarif),
      );
    }
  });

  it('estimerTokens majore la densite annoncee de 4 caracteres par token', () => {
    const alea = new GenerateurDeterministe(GRAINE + 83);
    for (let i = 0; i < TIRAGES; i += 1) {
      const longueur = alea.entier(1, 20_000);
      const estimation = estimerTokens('x'.repeat(longueur));
      expect(estimation).toBeGreaterThanOrEqual(longueur / 4);
      expect(Number.isInteger(estimation)).toBe(true);
      expect(estimation).toBeGreaterThan(0);
    }
    expect(estimerTokens('')).toBe(0);
  });

  it('familleModele est totale sur les cinq usages traces', () => {
    for (const usage of USAGES) {
      const famille = familleModele(usage);
      expect(['extraction', 'commentaire']).toContain(famille);
      expect(tarifModele(famille, PARAMETRES).modele.length).toBeGreaterThan(0);
    }
  });
});

describe('ia.ts — plafond mensuel', () => {
  it('le plafond ne peut jamais etre franchi', () => {
    const alea = new GenerateurDeterministe(GRAINE + 84);
    for (let i = 0; i < TIRAGES; i += 1) {
      const plafond = alea.entier(1, 5000);
      const parametres = parametresDeTest({ plafond_ia_mensuel_cents: String(plafond) });
      const depense = alea.entier(0, plafond + 500);
      const cout = alea.entier(0, 400);

      const decision = verifierPlafond(depense, cout, parametres);
      if (decision.autorise) {
        expect(depense + cout).toBeLessThanOrEqual(plafond);
        expect(decision.resteCents).toBeGreaterThanOrEqual(0);
        expect(decision.resteCents).toBe(plafond - depense - cout);
      } else {
        expect(depense + cout).toBeGreaterThan(plafond);
        // Un refus doit s'expliquer en francais : c'est une reponse normale,
        // pas une panne (mode degrade de CLAUDE.md §5).
        expect(decision.raison.length).toBeGreaterThan(0);
      }
    }
  });

  it('un plafond a zero coupe l IA entierement, quelle que soit la depense', () => {
    const alea = new GenerateurDeterministe(GRAINE + 85);
    const parametres = parametresDeTest({ plafond_ia_mensuel_cents: '0' });
    for (let i = 0; i < 50; i += 1) {
      const decision = verifierPlafond(alea.entier(0, 10_000), alea.entier(0, 500), parametres);
      expect(decision.autorise).toBe(false);
    }
  });

  it('le plafond par defaut du catalogue autorise un appel de commentaire type', () => {
    // Verification de coherence entre deux parametres du catalogue : si le
    // plafond par defaut ne permettait meme pas un appel, l'IA serait morte-nee.
    const tarif = tarifModele('commentaire', PARAMETRES);
    const cout = coutMaximalCents(20_000, PARAMETRES.entier('ia_tokens_sortie_max'), tarif);
    expect(verifierPlafond(0, cout, PARAMETRES).autorise).toBe(true);
  });
});
