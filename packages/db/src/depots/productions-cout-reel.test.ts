/**
 * Cout REEL, ligne par ligne, d'une production (mission du 01/08/2026).
 *
 * CE QUI EST TESTE ICI, et pourquoi ca ne pouvait pas l'etre ailleurs. Un
 * parcours de bout en bout avait deja trouve que `cout_matiere_reel_cents`
 * n'etait expose par aucune route ; le TOTAL a ete rendu. La ligne, elle,
 * continuait de mentir : elle affichait « 1 509 g consommes » a cote d'un cout
 * calcule sur 1 192 g, parce que `production_consommation.cout_cents` reste
 * theorique a vie. Un chiffre juste (le total) devenait suspect a cause d'une
 * ligne fausse.
 *
 * LA SEULE PROPRIETE QUI COMPTE, et que ce fichier existe pour prouver :
 * `somme(consommations.coutReelCents) + coutMatiereReelNonAffecteCents`
 * redonne EXACTEMENT `coutMatiereReelCents` — celui-la meme que la cloture de
 * session facture a la marge du marche. « Exactement » au centime, sur des
 * montants qui ne tombent pas rond : un jeu en nombres ronds ne verrait aucun
 * defaut d'arrondi, et l'argent est en centimes entiers.
 *
 * LA FIXTURE EST DELIBEREMENT NON DEGENEREE (docs/39 §3) :
 *  - trois lots de farine, a des prix unitaires FRACTIONNAIRES et TOUS
 *    DIFFERENTS (0,733 / 0,7655… / 0,8422 c/g) — deux lots au meme prix ne
 *    prouveraient rien sur la valorisation au prix DU LOT ;
 *  - la fournee puise dans DEUX lots pour le meme ingredient, donc
 *    `quantite_reelle` reste `null` : c'est le cas ou l'attribution de la
 *    QUANTITE declaree est ambigue, et ou l'on doit malgre tout savoir dire ce
 *    que chaque lot a coute ;
 *  - la sur-consommation deborde sur un TROISIEME lot, que la fournee n'avait
 *    jamais touche : c'est le seul cas qui produit un cout reel non
 *    rattachable a une ligne, et sans lui l'invariant serait vrai par chance.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { fournisseur, ingredient, lot, production, recette, sessionMarche } from '../schema.js';
import { enregistrerReception } from '../services/reception.js';
import { annulerProduction, lancerProduction, saisirRealise } from '../services/production.js';
import { tracabiliteAmontSession, tracabiliteAvalLot } from './tracabilite.js';
import { lireProductionDetail, type ProductionDetailLue } from './productions.js';

const JOUR = '2026-07-27';

/** Trois lots de farine, prix unitaires fractionnaires et tous differents. */
const LOTS_FARINE = [
  { numero: 'FAR-A', quantite: 1000, prixLigneCents: 733, dateDlc: '2026-08-05' },
  { numero: 'FAR-B', quantite: 900, prixLigneCents: 689, dateDlc: '2026-09-10' },
  { numero: 'FAR-C', quantite: 5000, prixLigneCents: 4211, dateDlc: '2026-12-31' },
] as const;

describe('cout reel par ligne de consommation', () => {
  let base: BaseBatte;
  let idR1: string;
  let idFournisseur: string;
  let idFarine: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!.id;
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
    idFarine = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!.id;

    // Tous les AUTRES ingredients en abondance : ce n'est pas eux que ce
    // fichier examine, mais ils doivent suffire, sinon on testerait un refus
    // de faisabilite.
    const autres = base
      .select()
      .from(ingredient)
      .all()
      .filter((i) => i.id !== idFarine);
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: autres.map((i) => ({
        ingredientId: i.id,
        quantite: 100_000,
        prixLigneCents: 1000,
        numeroLotFournisseur: 'LOT-TEST-APPRO',
      })),
    });

    // Une reception PAR lot de farine : c'est ce qui garantit trois lots
    // distincts, donc un ordre FEFO reellement discriminant.
    for (const l of LOTS_FARINE) {
      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: l.quantite,
            prixLigneCents: l.prixLigneCents,
            numeroLotFournisseur: l.numero,
            dateDlc: l.dateDlc,
          },
        ],
      });
    }
  });

  function lancer5L(): string {
    return lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    }).productionId;
  }

  function detail(productionId: string): ProductionDetailLue {
    const lu = lireProductionDetail(base, productionId);
    expect(lu).not.toBeNull();
    return lu!;
  }

  function lignesFarine(d: ProductionDetailLue) {
    return d.consommations.filter((c) => c.ingredientId === idFarine);
  }

  /** L'invariant, ecrit une fois : la somme des lignes plus le reliquat fait le total. */
  function verifierSomme(d: ProductionDetailLue): void {
    const sommeLignes = d.consommations.reduce((total, c) => total + (c.coutReelCents ?? 0), 0);
    expect(d.consommations.every((c) => c.coutReelCents !== null)).toBe(true);
    expect(sommeLignes + d.coutMatiereReelNonAffecteCents!).toBe(d.coutMatiereReelCents);
  }

  it('tant que le realise n est pas saisi : AUCUN cout reel, ni par ligne ni en reliquat', () => {
    const d = detail(lancer5L());

    expect(d.coutMatiereReelCents).toBeNull();
    // `null` et jamais `0` : un zero se lirait « cette production n'a rien
    // coute », alors qu'elle n'a simplement pas encore ete mesuree.
    expect(d.consommations.every((c) => c.coutReelCents === null)).toBe(true);
    expect(d.consommations.every((c) => c.quantiteMouvementee === null)).toBe(true);
    expect(d.coutMatiereReelNonAffecteCents).toBeNull();
    // Le theorique, lui, est connu des le lancement : les deux ne se
    // confondent pas. (Pas `every` : une ligne de 2 g de sel a 0,01 c/g
    // s'arrondit legitimement a 0 centime — c'est un vrai zero, pas une
    // absence, et ce n'est pas l'objet de ce test.)
    expect(d.coutMatiereTheoriqueCents).toBeGreaterThan(0);
    expect(lignesFarine(d).every((c) => c.coutCents > 0)).toBe(true);
  });

  it('sans declaration de consommation reelle : chaque ligne vaut son theorique, et la somme fait le total', () => {
    const id = lancer5L();
    saisirRealise(base, id, { volumeReelMl: 4800, crepesReelles: 61 });

    const d = detail(id);
    // Aucun ecart declare : le grand livre ne porte que les sorties du
    // lancement, donc le reel de chaque ligne EST son theorique. Ce n'est pas
    // une valeur par defaut inventee, c'est ce que le stock a enregistre.
    expect(d.consommations.every((c) => c.coutReelCents === c.coutCents)).toBe(true);
    expect(d.coutMatiereReelNonAffecteCents).toBe(0);
    verifierSomme(d);
  });

  it('sur-consommation debordant sur un lot HORS fournee : la somme des lignes plus le reliquat fait le total au centime', () => {
    const id = lancer5L();
    const avant = detail(id);
    const farineAvant = lignesFarine(avant);

    // La FEFO du lancement a bien puise dans DEUX lots : sans cela, la suite
    // ne prouverait rien sur l'attribution ambigue.
    expect(farineAvant).toHaveLength(2);
    const theoriqueFarine = farineAvant.reduce((t, c) => t + c.quantiteTheorique, 0);
    expect(theoriqueFarine).toBe(1593);
    // 1000 g du lot A a 0,733 c/g, 593 g du lot B a 689/900 c/g.
    expect(farineAvant.map((c) => c.coutCents).sort((a, b) => a - b)).toEqual([454, 733]);

    // +400 g reellement consommes. Le lot A est epuise, le lot B n'a plus que
    // 307 g : le solde part sur le lot C, que cette fournee n'a jamais touche.
    saisirRealise(base, id, {
      volumeReelMl: 4800,
      crepesReelles: 61,
      consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: theoriqueFarine + 400 }],
    });

    const d = detail(id);
    const farine = lignesFarine(d);
    const parLot = new Map(farine.map((c) => [c.numeroLotFournisseur, c]));

    // Lot A : epuise au lancement, il n'a rien recu de plus.
    expect(parLot.get('FAR-A')!.quantiteMouvementee).toBe(1000);
    expect(parLot.get('FAR-A')!.coutReelCents).toBe(733);
    // Lot B : 593 g au lancement + 307 g d'ecart = 900 g, pour 454 + 235 c.
    expect(parLot.get('FAR-B')!.quantiteMouvementee).toBe(900);
    expect(parLot.get('FAR-B')!.coutReelCents).toBe(454 + 235);
    // Le solde (93 g sur le lot C) ne peut se rattacher a AUCUNE ligne : il
    // est compte a part, jamais reparti au jugé sur les lignes existantes.
    expect(d.coutMatiereReelNonAffecteCents).toBe(78);

    // La quantite DECLAREE reste `null` sur les deux lignes (deux lots pour un
    // meme ingredient), et pourtant leur cout est parfaitement connu : c'est
    // toute la difference entre « ce que le porteur a declare » et « ce que le
    // stock a enregistre ».
    expect(farine.every((c) => c.quantiteReelle === null)).toBe(true);

    verifierSomme(d);
    // Et le total n'est pas un nombre rond : la preuve porte sur des centimes
    // reellement arrondis, mouvement par mouvement.
    expect(d.coutMatiereReelCents! % 100).not.toBe(0);
  });

  it('sous-consommation : un lot integralement restitue vaut 0 c, un VRAI zero, jamais null', () => {
    const id = lancer5L();
    const theoriqueFarine = lignesFarine(detail(id)).reduce((t, c) => t + c.quantiteTheorique, 0);

    // On rend exactement ce que le second lot avait fourni (593 g) : la
    // restitution se fait en FEFO INVERSE, donc integralement sur ce lot-la.
    saisirRealise(base, id, {
      volumeReelMl: 4200,
      crepesReelles: 55,
      consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: theoriqueFarine - 593 }],
    });

    const d = detail(id);
    const parLot = new Map(lignesFarine(d).map((c) => [c.numeroLotFournisseur, c]));

    expect(parLot.get('FAR-B')!.quantiteMouvementee).toBe(0);
    // 0, et surtout PAS `null` : la matiere a bien ete rendue, ce n'est pas
    // une inconnue. C'est la distinction `stable` / `inconnu` de docs/39 §4.
    expect(parLot.get('FAR-B')!.coutReelCents).toBe(0);
    expect(parLot.get('FAR-A')!.coutReelCents).toBe(733);
    expect(d.coutMatiereReelNonAffecteCents).toBe(0);
    expect(d.coutMatiereReelCents!).toBeLessThan(d.coutMatiereTheoriqueCents);

    verifierSomme(d);
  });

  it('production ANNULEE apres realise : la somme des lignes fait toujours le total deja facture', () => {
    const id = lancer5L();
    const theoriqueFarine = lignesFarine(detail(id)).reduce((t, c) => t + c.quantiteTheorique, 0);
    saisirRealise(base, id, {
      volumeReelMl: 4800,
      crepesReelles: 61,
      consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: theoriqueFarine + 400 }],
    });
    const avant = detail(id);

    annulerProduction(base, id, 'ERREUR_SAISIE');

    const apres = detail(id);
    expect(base.select().from(production).where(eq(production.id, id)).get()!.statut).toBe(
      'annulee',
    );
    // `annulerProduction` contrepasse le stock mais NE REECRIT PAS
    // `cout_matiere_reel_cents` : si les contrepassations entraient dans la
    // somme, les lignes retomberaient a zero face a un total inchange, et la
    // fiche afficherait deux verites contradictoires.
    expect(apres.coutMatiereReelCents).toBe(avant.coutMatiereReelCents);
    expect(apres.consommations.map((c) => c.coutReelCents)).toEqual(
      avant.consommations.map((c) => c.coutReelCents),
    );
    verifierSomme(apres);
  });

  /**
   * DEFAUT CORRIGE le 01/08/2026 — `it.fails` converti en test de
   * NON-REGRESSION (convention docs/39 §8).
   *
   * `saisirRealise` recalculait `coutReelCents` A PARTIR DE ZERO a chaque
   * appel :
   *
   *     let coutReelCents = consommations.reduce((t, c) => t + c.coutCents, 0);
   *
   * `consommations` vient de `production_consommation`, dont `cout_cents` reste
   * THEORIQUE a vie. Les mouvements d'ecart ecrits lors de la PREMIERE saisie
   * n'etaient jamais relus. Or volume et crepes restent corrigibles a tout
   * moment (seule `consommationsReelles` est refusee une seconde fois) : la
   * moindre correction du nombre de crepes REMETTAIT donc le cout matiere reel
   * au theorique, en silence, alors que la matiere en plus etait toujours
   * sortie du stock et que les mouvements d'ecart n'etaient pas contrepasses.
   * La cloture de session facturait alors un cout MINORE.
   *
   * Corrige en derivant le total du GRAND LIVRE
   * (`coutMatiereReelDepuisMouvements`, `services/production.ts`) : le total
   * n'a plus qu'UNE source, celle-la meme dont `lireProductionDetail` tire
   * deja les lignes. L'`it.fails` est passe au rouge « Expect test to fail »
   * des la correction, et a signale de lui-meme sa conversion.
   */
  it('une seconde saisie du realise (crepes seules) NE REMET PAS le cout reel au theorique', () => {
    const id = lancer5L();
    const theoriqueFarine = lignesFarine(detail(id)).reduce((t, c) => t + c.quantiteTheorique, 0);
    saisirRealise(base, id, {
      volumeReelMl: 4800,
      crepesReelles: 61,
      consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: theoriqueFarine + 400 }],
    });
    const avant = detail(id);

    // La fixture DOIT pouvoir voir le defaut : sans un ecart matiere qui
    // ecarte reellement le reel du theorique, « reel inchange » et « reel
    // remis au theorique » seraient la meme assertion (docs/39 §3, forme 3).
    expect(avant.coutMatiereReelCents).toBeGreaterThan(avant.coutMatiereTheoriqueCents);

    // Simple correction du nombre de crepes comptees : aucun ecart matiere
    // n'est redeclare, rien ne doit bouger cote cout.
    saisirRealise(base, id, { volumeReelMl: 4800, crepesReelles: 59 });

    const apres = detail(id);
    expect(apres.coutMatiereReelCents).toBe(avant.coutMatiereReelCents);
    // Dit explicitement ce que la regression rejouerait : retomber sur le
    // theorique. Redondant avec l'egalite ci-dessus tant qu'elle tient, mais
    // c'est CETTE ligne qui nomme le chiffre faux qui entrait en compta.
    expect(apres.coutMatiereReelCents).not.toBe(apres.coutMatiereTheoriqueCents);
    verifierSomme(apres);
  });

  /**
   * DEFAUT CORRIGE le 01/08/2026 — `it.fails` converti en test de
   * NON-REGRESSION (convention docs/39 §8).
   *
   * `tracabiliteAvalLot` partait de `production_consommation` (« quelles
   * productions ont PREVU ce lot ? »). Une sur-consommation servie en FEFO par
   * un lot que la fournee n'avait pas touche n'y cree AUCUNE ligne : ce lot a
   * pourtant reellement alimente cette pate, et il etait absent du registre
   * qu'un rappel sanitaire vient consulter (CLAUDE.md §3 regle 6 : obligation
   * reglementaire). `coutMatiereReelNonAffecteCents`, non nul, est exactement
   * le signal que ce cas s'est produit — et ce test s'en sert comme garde de
   * fixture, pour ne pas verifier une absence sur un scenario qui n'a jamais
   * produit d'ecart.
   *
   * Corrige en faisant partir les deux sens de la tracabilite du GRAND LIVRE
   * (`netParLotDeLaProduction`, `depots/tracabilite.ts`).
   */
  it('le lot qui a servi la sur-consommation est present dans la tracabilite aval', () => {
    const id = lancer5L();
    const theoriqueFarine = lignesFarine(detail(id)).reduce((t, c) => t + c.quantiteTheorique, 0);
    saisirRealise(base, id, {
      volumeReelMl: 4800,
      crepesReelles: 61,
      consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: theoriqueFarine + 400 }],
    });
    // Garde de fixture : sans reliquat, le lot C n'aurait pas ete touche et le
    // test ne prouverait rien (docs/39 §3, forme 2 — un cas impossible).
    expect(detail(id).coutMatiereReelNonAffecteCents).toBeGreaterThan(0);

    const lotC = base
      .select({ id: lot.id })
      .from(lot)
      .where(eq(lot.numeroLotFournisseur, 'FAR-C'))
      .get()!;
    const aval = tracabiliteAvalLot(base, lotC.id);
    const ligne = aval.productions.find((p) => p.productionId === id);
    expect(ligne).toBeDefined();

    // Le lot C n'etait PAS prevu par cette fournee : son theorique est un vrai
    // zero, et c'est `quantiteMouvementee` qui porte la seule quantite
    // attribuable a ce lot — 93 g, le solde que les lots A et B ne pouvaient
    // plus fournir. Sans ce champ, le registre afficherait « 0 g » sur un lot
    // qui a bel et bien alimente cette pate.
    expect(ligne!.quantiteTheorique).toBe(0);
    expect(ligne!.quantiteMouvementee).toBe(93);
    // Et le lien qui rend le rappel exploitable : le numero du lot de PATE.
    expect(ligne!.numeroLotPate).toBe(
      base.select().from(production).where(eq(production.id, id)).get()!.numeroLotPate,
    );
  });

  /**
   * L'AUTRE SENS. Un rappel ne boucle que si les deux marchent : partir du lot
   * pour trouver les pates (ci-dessus), ET partir de la production pour
   * enumerer les lots qui l'ont alimentee. Le meme defaut frappait les deux —
   * `tracabiliteAmontSession` lisait `production_consommation` par la meme
   * fonction — et une correction de l'aval seul aurait laisse la moitie du
   * registre fausse, sans que rien ne le dise.
   */
  it('le lot qui a servi la sur-consommation est present dans la tracabilite amont', () => {
    const idSession = base.select({ id: sessionMarche.id }).from(sessionMarche).get()!.id;
    const id = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      sessionId: idSession,
    }).productionId;

    const theoriqueFarine = lignesFarine(detail(id)).reduce((t, c) => t + c.quantiteTheorique, 0);
    saisirRealise(base, id, {
      volumeReelMl: 4800,
      crepesReelles: 61,
      consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: theoriqueFarine + 400 }],
    });

    const amont = tracabiliteAmontSession(base, idSession);
    const fournee = amont.productions.find((p) => p.productionId === id);
    expect(fournee).toBeDefined();

    const parLot = new Map(fournee!.consommations.map((c) => [c.numeroLotFournisseur, c]));
    // Les trois lots de farine sont la, dont FAR-C que le LANCEMENT n'avait
    // jamais touche : c'est exactement la ligne qui manquait.
    expect(parLot.get('FAR-C')).toBeDefined();
    expect(parLot.get('FAR-C')!.quantiteTheorique).toBe(0);
    expect(parLot.get('FAR-C')!.quantiteMouvementee).toBe(93);
    // Les lots prevus gardent leur theorique ET disent ce qui est reellement
    // sorti : 1000 g pour A (epuise), 900 g pour B (593 prevus + 307 d'ecart).
    expect(parLot.get('FAR-A')!.quantiteTheorique).toBe(1000);
    expect(parLot.get('FAR-A')!.quantiteMouvementee).toBe(1000);
    expect(parLot.get('FAR-B')!.quantiteTheorique).toBe(593);
    expect(parLot.get('FAR-B')!.quantiteMouvementee).toBe(900);

    // LES DEUX SENS BOUCLENT : chaque lot cite a l'amont retrouve CETTE
    // production quand on repart de lui vers l'aval. C'est la propriete qu'un
    // rappel exige, et qu'aucun des deux tests precedents ne prouve seul.
    for (const c of fournee!.consommations) {
      const aval = tracabiliteAvalLot(base, c.lotId);
      const retour = aval.productions.find((p) => p.productionId === id);
      expect(retour, `lot ${c.numeroLotFournisseur} absent de l'aval`).toBeDefined();
      expect(retour!.quantiteMouvementee).toBe(c.quantiteMouvementee);
      expect(retour!.numeroLotPate).toBe(fournee!.numeroLotPate);
    }
  });
});
