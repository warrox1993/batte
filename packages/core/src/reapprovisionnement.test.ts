/**
 * Tests du Lot 7 — reapprovisionnement.
 *
 * Critere de fin de docs/04-ROADMAP-LOTS.md : « le stock de farine passe sous
 * le seuil, l'application propose une commande de 2 sacs de 25 kg chez le bon
 * fournisseur ». Le « bon fournisseur » et le groupement par commande sont du
 * ressort du service `@batte/db` (integration) ; ce fichier couvre la logique
 * de calcul pure.
 */

import { describe, expect, it } from 'vitest';
import { ErreurMetier } from './erreurs.js';
import {
  arrondirAuConditionnement,
  calculerBesoinBrut,
  calculerBesoinReapprovisionnement,
  calculerPointCommande,
  profilConsommation,
} from './reapprovisionnement.js';

describe('profilConsommation', () => {
  it('rend des zeros sur une serie vide', () => {
    expect(profilConsommation([])).toEqual({
      moyenneJournaliere: 0,
      ecartTypeJournalier: 0,
      nbJoursObserves: 0,
    });
  });

  it('rend un ecart-type nul sur une seule observation', () => {
    const profil = profilConsommation([500]);
    expect(profil.moyenneJournaliere).toBe(500);
    expect(profil.ecartTypeJournalier).toBe(0);
    expect(profil.nbJoursObserves).toBe(1);
  });

  it('les jours sans mouvement comptent pour ZERO, pas seulement les jours de production', () => {
    // Une seule fournee de 300 g sur 7 jours : la moyenne doit refleter les
    // six jours a zero, et l'ecart-type doit etre eleve — c'est exactement ce
    // qui distingue un ingredient a rythme hebdomadaire d'un ingredient a
    // consommation reguliere de meme moyenne.
    const profil = profilConsommation([0, 0, 0, 0, 0, 0, 300]);
    expect(profil.nbJoursObserves).toBe(7);
    expect(profil.moyenneJournaliere).toBeCloseTo(42.857142857142854, 9);
    expect(profil.ecartTypeJournalier).toBeCloseTo(113.38934190276818, 9);
  });
});

describe('calculerPointCommande', () => {
  it('applique la formule statistique, pas la formule naive', () => {
    // moyenne 200 g/j, ecart-type 50 g/j, delai 3 j, Z=1,28 (90 %).
    const resultat = calculerPointCommande({
      moyenneJournaliere: 200,
      ecartTypeJournalier: 50,
      delaiLivraisonJours: 3,
      z: 1.28,
    });

    expect(resultat.consommationPendantDelai).toBe(600);
    // stock_securite = 1,28 * racine(3 * 50^2) = 1,28 * racine(7500) ~= 110,85 -> 111.
    expect(resultat.stockSecurite).toBe(111);
    expect(resultat.pointCommande).toBe(711);
  });

  it('rend un stock de securite nul quand la demande est parfaitement reguliere', () => {
    // Ecart-type nul : deux ingredients de meme moyenne mais l'un regulier,
    // l'autre erratique, ne doivent PAS recevoir le meme stock de securite.
    // Celui-ci, parfaitement regulier, n'en a besoin d'aucun.
    const resultat = calculerPointCommande({
      moyenneJournaliere: 200,
      ecartTypeJournalier: 0,
      delaiLivraisonJours: 3,
      z: 1.28,
    });
    expect(resultat.stockSecurite).toBe(0);
    expect(resultat.pointCommande).toBe(600);
  });

  it('un niveau de service plus eleve (Z plus grand) augmente le stock de securite', () => {
    const service90 = calculerPointCommande({
      moyenneJournaliere: 200,
      ecartTypeJournalier: 50,
      delaiLivraisonJours: 3,
      z: 1.28,
    });
    const service99 = calculerPointCommande({
      moyenneJournaliere: 200,
      ecartTypeJournalier: 50,
      delaiLivraisonJours: 3,
      z: 2.33,
    });
    expect(service99.stockSecurite).toBeGreaterThan(service90.stockSecurite);
  });

  it('tient compte de la variabilite du delai quand elle est connue', () => {
    const sansVariabiliteDelai = calculerPointCommande({
      moyenneJournaliere: 200,
      ecartTypeJournalier: 50,
      delaiLivraisonJours: 3,
      z: 1.28,
    });
    const avecVariabiliteDelai = calculerPointCommande({
      moyenneJournaliere: 200,
      ecartTypeJournalier: 50,
      delaiLivraisonJours: 3,
      ecartTypeDelaiJours: 1,
      z: 1.28,
    });
    expect(avecVariabiliteDelai.stockSecurite).toBeGreaterThan(sansVariabiliteDelai.stockSecurite);
  });

  it('refuse une consommation moyenne negative, avec le chiffre en cause', () => {
    expect(() =>
      calculerPointCommande({
        moyenneJournaliere: -5,
        ecartTypeJournalier: 0,
        delaiLivraisonJours: 3,
        z: 1.28,
      }),
    ).toThrow(ErreurMetier);
  });

  it('refuse un delai de livraison negatif', () => {
    expect(() =>
      calculerPointCommande({
        moyenneJournaliere: 10,
        ecartTypeJournalier: 0,
        delaiLivraisonJours: -1,
        z: 1.28,
      }),
    ).toThrow(ErreurMetier);
  });

  it('refuse un coefficient Z negatif', () => {
    expect(() =>
      calculerPointCommande({
        moyenneJournaliere: 10,
        ecartTypeJournalier: 0,
        delaiLivraisonJours: 3,
        z: -1,
      }),
    ).toThrow(ErreurMetier);
  });
});

describe('calculerBesoinBrut', () => {
  it('rend la difference quand le stock projete est sous le point de commande', () => {
    expect(calculerBesoinBrut(1000, 300)).toBe(700);
  });

  it('rend zero, jamais un nombre negatif, quand le stock projete suffit deja', () => {
    expect(calculerBesoinBrut(1000, 1500)).toBe(0);
  });
});

describe('arrondirAuConditionnement', () => {
  it('ne propose aucun conditionnement quand le besoin est nul', () => {
    expect(arrondirAuConditionnement(0, { conditionnementUniteRef: 25_000 })).toEqual({
      quantiteUniteRef: 0,
      nbConditionnements: 0,
    });
  });

  it('arrondit au conditionnement superieur : « on ne commande pas 17 kg quand le sac fait 25 kg »', () => {
    const resultat = arrondirAuConditionnement(17_000, { conditionnementUniteRef: 25_000 });
    expect(resultat.nbConditionnements).toBe(1);
    expect(resultat.quantiteUniteRef).toBe(25_000);
  });

  it('propose 2 sacs de 25 kg pour un besoin de 26 kg (critere de fin du Lot 7)', () => {
    const resultat = arrondirAuConditionnement(26_000, { conditionnementUniteRef: 25_000 });
    expect(resultat.nbConditionnements).toBe(2);
    expect(resultat.quantiteUniteRef).toBe(50_000);
  });

  it('ne depasse pas le besoin quand il tombe exactement sur un multiple', () => {
    const resultat = arrondirAuConditionnement(50_000, { conditionnementUniteRef: 25_000 });
    expect(resultat.nbConditionnements).toBe(2);
    expect(resultat.quantiteUniteRef).toBe(50_000);
  });

  it("l'ORDRE NORMATIF fait gagner le plancher sur un plafond mal calibre", () => {
    // docs/07 §1.9 : « reduire au maximum -> augmenter au minimum ». Si le
    // plafond est (par erreur de configuration) plus bas que le plancher, cet
    // ordre garantit que le plancher fournisseur l'emporte : on respecte
    // toujours la contrainte du fournisseur, jamais une capacite de stockage
    // mal renseignee. L'ordre inverse ferait gagner le plafond a la place.
    const resultat = arrondirAuConditionnement(10, {
      conditionnementUniteRef: 100,
      quantiteMaximaleUniteRef: 50, // plafond, volontairement trop bas
      quantiteMinimaleUniteRef: 200, // plancher fournisseur
    });
    // reduire au max(10,50) -> 10 (le besoin est deja sous le plafond) ;
    // augmenter au min(10,200) -> 200 ; arrondir -> 1 conditionnement de 100
    // ne suffit pas a couvrir 200, donc 2.
    expect(resultat.nbConditionnements).toBe(2);
    expect(resultat.quantiteUniteRef).toBe(200);
  });

  it('refuse un conditionnement de contenance nulle ou negative', () => {
    expect(() => arrondirAuConditionnement(100, { conditionnementUniteRef: 0 })).toThrow(
      ErreurMetier,
    );
  });
});

describe('calculerBesoinReapprovisionnement — composition complete', () => {
  it('critere de fin : farine sous le seuil -> commande de 2 sacs de 25 kg', () => {
    // Consommation reguliere de 6000 g/jour (ecart-type nul), delai fournisseur
    // de 5 jours, rupture quasi totale (stock projete nul). Point de commande
    // 30 000 g, arrondi au sac de 25 kg -> 2 sacs.
    const resultat = calculerBesoinReapprovisionnement({
      quantitesParJourCalendaire: Array(10).fill(6000),
      delaiLivraisonJours: 5,
      z: 1.28,
      stockProjete: 0,
      conditionnementUniteRef: 25_000,
    });

    expect(resultat.profil.moyenneJournaliere).toBe(6000);
    expect(resultat.pointCommande.pointCommande).toBe(30_000);
    expect(resultat.besoinBrut).toBe(30_000);
    expect(resultat.commande).toEqual({ quantiteUniteRef: 50_000, nbConditionnements: 2 });
  });

  it('enchaine correctement profil, point de commande, besoin et arrondi sur une demande erratique', () => {
    const resultat = calculerBesoinReapprovisionnement({
      quantitesParJourCalendaire: [0, 0, 0, 0, 0, 0, 300],
      delaiLivraisonJours: 3,
      z: 1.28,
      stockProjete: 100,
      conditionnementUniteRef: 50,
    });

    expect(resultat.pointCommande.pointCommande).toBe(380);
    expect(resultat.besoinBrut).toBe(280);
    expect(resultat.commande).toEqual({ quantiteUniteRef: 300, nbConditionnements: 6 });
  });

  it('ne propose rien quand le stock projete couvre deja le point de commande', () => {
    const resultat = calculerBesoinReapprovisionnement({
      quantitesParJourCalendaire: Array(10).fill(100),
      delaiLivraisonJours: 2,
      z: 1.28,
      stockProjete: 100_000,
      conditionnementUniteRef: 5000,
    });

    expect(resultat.besoinBrut).toBe(0);
    expect(resultat.commande).toEqual({ quantiteUniteRef: 0, nbConditionnements: 0 });
  });
});
