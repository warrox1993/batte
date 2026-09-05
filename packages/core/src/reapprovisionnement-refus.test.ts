/**
 * Le refus « écart-type de délai négatif » et le chemin où les bornes de
 * conditionnement ne sont PAS fournies.
 *
 * `reapprovisionnement.test.ts` couvre déjà les trois autres refus de
 * `calculerPointCommande` (consommation, délai, coefficient Z). Le quatrième —
 * `ecartTypeDelaiJours` — ne l'était pas, et c'est le seul des quatre qui soit
 * OPTIONNEL : il traverse un `?? 0` avant d'être contrôlé. Un paramètre
 * optionnel dont la garde n'est jamais exercée est précisément celui dont on ne
 * sait pas s'il est gardé.
 *
 * Second sujet : `calculerBesoinReapprovisionnement` propage trois options
 * facultatives par des ternaires `undefined -> {}`. Toute la suite existante
 * les fournit ; la branche « absent » n'était jamais empruntée, alors que
 * c'est le cas NORMAL d'un ingrédient sans franco de port ni palier maximum.
 */

import { describe, expect, it } from 'vitest';
import { ErreurMetier } from './erreurs.js';
import { calculerBesoinReapprovisionnement, calculerPointCommande } from './reapprovisionnement.js';

describe('calculerPointCommande — écart-type du délai de livraison', () => {
  it('refuse un écart-type de délai négatif', () => {
    try {
      calculerPointCommande({
        moyenneJournaliere: 10,
        ecartTypeJournalier: 2,
        delaiLivraisonJours: 3,
        ecartTypeDelaiJours: -1,
        z: 1.65,
      });
      expect.unreachable('devait lever « ecart_type_delai_invalide »');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('ecart_type_delai_invalide');
    }
  });

  it('traite l’absence d’écart-type comme un délai FIXE, jamais comme une erreur', () => {
    // Doctrine du dépôt : une donnée absente n'invente rien. Aucun historique
    // de date de livraison réelle n'existe encore -> délai fixe, le stock de
    // sécurité ne couvre que la variabilité de la DEMANDE.
    const sansEcartType = calculerPointCommande({
      moyenneJournaliere: 10,
      ecartTypeJournalier: 2,
      delaiLivraisonJours: 3,
      z: 1.65,
    });
    const avecEcartTypeNul = calculerPointCommande({
      moyenneJournaliere: 10,
      ecartTypeJournalier: 2,
      delaiLivraisonJours: 3,
      ecartTypeDelaiJours: 0,
      z: 1.65,
    });
    expect(sansEcartType).toEqual(avecEcartTypeNul);
  });

  it('un délai VARIABLE gonfle réellement le stock de sécurité — la garde n’est pas décorative', () => {
    // Discrimine : si `ecartTypeDelaiJours` était ignoré après son contrôle,
    // les deux résultats seraient identiques et le test précédent ne prouverait
    // rien.
    const fixe = calculerPointCommande({
      moyenneJournaliere: 10,
      ecartTypeJournalier: 2,
      delaiLivraisonJours: 3,
      z: 1.65,
    });
    const variable = calculerPointCommande({
      moyenneJournaliere: 10,
      ecartTypeJournalier: 2,
      delaiLivraisonJours: 3,
      ecartTypeDelaiJours: 2,
      z: 1.65,
    });
    expect(variable.stockSecurite).toBeGreaterThan(fixe.stockSecurite);
    expect(variable.consommationPendantDelai).toBe(fixe.consommationPendantDelai);
  });
});

describe('calculerBesoinReapprovisionnement — options de conditionnement absentes', () => {
  /**
   * Trois jours de consommation nettement différents : une série de valeurs
   * identiques donnerait un écart-type nul, donc un stock de sécurité nul, et
   * le calcul ne discriminerait plus rien.
   */
  const CONSOMMATION = [4000, 9000, 6500, 11000, 2500] as const;

  it('sans écart-type de délai, sans minimum ni maximum de commande', () => {
    const resultat = calculerBesoinReapprovisionnement({
      quantitesParJourCalendaire: CONSOMMATION,
      delaiLivraisonJours: 3,
      z: 1.65,
      stockProjete: 1000,
      conditionnementUniteRef: 25_000,
    });

    expect(resultat.profil.moyenneJournaliere).toBeGreaterThan(0);
    expect(resultat.pointCommande.pointCommande).toBeGreaterThan(
      resultat.profil.moyenneJournaliere,
    );
    expect(resultat.besoinBrut).toBe(Math.max(0, resultat.pointCommande.pointCommande - 1000));
    // Sans minimum ni maximum, la quantité commandée est le seul multiple du
    // conditionnement qui couvre le besoin : rien d'autre ne la contraint.
    expect(resultat.commande.quantiteUniteRef % 25_000).toBe(0);
    expect(resultat.commande.quantiteUniteRef).toBeGreaterThanOrEqual(resultat.besoinBrut);
    expect(resultat.commande.quantiteUniteRef - resultat.besoinBrut).toBeLessThan(25_000);
  });

  it('fournir un maximum change RÉELLEMENT le résultat — la branche « absent » n’est pas un décor', () => {
    const commun = {
      quantitesParJourCalendaire: CONSOMMATION,
      delaiLivraisonJours: 3,
      z: 1.65,
      stockProjete: 1000,
      conditionnementUniteRef: 25_000,
    };
    const sansBornes = calculerBesoinReapprovisionnement(commun);
    const avecMaximum = calculerBesoinReapprovisionnement({
      ...commun,
      quantiteMaximaleUniteRef: 25_000,
    });
    expect(sansBornes.commande.quantiteUniteRef).toBeGreaterThan(
      avecMaximum.commande.quantiteUniteRef,
    );
  });

  it('propage RÉELLEMENT l’écart-type de délai et le minimum de commande jusqu’au calcul', () => {
    // L'autre moitié des trois ternaires : la branche « fournie ». Un
    // `...({})` posé du mauvais côté laisserait ces deux réglages sans effet,
    // et rien ne le dirait — le résultat resterait un nombre plausible.
    const commun = {
      quantitesParJourCalendaire: CONSOMMATION,
      delaiLivraisonJours: 3,
      z: 1.65,
      stockProjete: 1000,
      conditionnementUniteRef: 25_000,
    };
    const nu = calculerBesoinReapprovisionnement(commun);

    const avecDelaiVariable = calculerBesoinReapprovisionnement({
      ...commun,
      ecartTypeDelaiJours: 2,
    });
    expect(avecDelaiVariable.pointCommande.stockSecurite).toBeGreaterThan(
      nu.pointCommande.stockSecurite,
    );

    // Minimum de commande volontairement bien au-dessus du besoin calculé :
    // s'il n'était pas transmis, la quantité resterait celle de `nu`.
    const minimum = nu.commande.quantiteUniteRef + 100_000;
    const avecMinimum = calculerBesoinReapprovisionnement({
      ...commun,
      quantiteMinimaleUniteRef: minimum,
    });
    expect(avecMinimum.commande.quantiteUniteRef).toBeGreaterThanOrEqual(minimum);
    expect(avecMinimum.commande.quantiteUniteRef).toBeGreaterThan(nu.commande.quantiteUniteRef);
  });
});
