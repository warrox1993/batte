/**
 * Tests du dépôt des concurrents (fiche
 * `docs/demandes/08-FICHES-CONCURRENTS.md`).
 *
 * Ce qui est réellement mis à l'épreuve :
 *
 *  - **`concurrent_produit` est historisé, jamais aplati** : deux relevés du
 *    même produit à des dates différentes doivent TOUS DEUX rester lisibles,
 *    et la projection « dernier prix connu » doit retenir le plus récent, pas
 *    le premier inséré ni le moins cher.
 *  - **rien ne s'efface** (CLAUDE.md §3 règle 7) : désactiver un concurrent ne
 *    retire aucune ligne.
 *  - **le comparateur ne stocke rien et ne divise jamais par zéro** (D-034) :
 *    aucun concurrent équivalent -> moyennes et écart à `null`, jamais `NaN`
 *    ni `0` par défaut.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurIntrouvable, ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { lieuMarche, produitVente } from '../schema.js';
import {
  ajouterObservationConcurrent,
  ajouterProduitConcurrent,
  changerActiviteConcurrent,
  comparateurPrix,
  creerConcurrent,
  lireConcurrentDetail,
  listerConcurrents,
  modifierConcurrent,
  mouvementsPrixConcurrents,
  moyenneCentsEntiere,
} from './concurrents.js';

const JOUR_1 = '2026-07-01';
const JOUR_2 = '2026-07-20';

function insererLieu(base: BaseBatte, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(lieuMarche)
    .values({ id, nom, actif: true, creeLe: maintenant, modifieLe: maintenant })
    .run();
  return id;
}

function insererProduitVente(
  base: BaseBatte,
  surcharges: { nom: string; nature: 'transforme' | 'revendu'; prixCents: number; actif?: boolean },
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(produitVente)
    .values({
      id,
      nom: surcharges.nom,
      nature: surcharges.nature,
      recetteId: null,
      ingredientId: null,
      prixCents: surcharges.prixCents,
      nbCrepes: 1,
      categorie: null,
      consommationSurPlace: false,
      actif: surcharges.actif ?? true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

/** Saisie de concurrent valide, déjà normalisée comme le ferait le contrat. */
function saisieConcurrent(lieuId: string, surcharges: Record<string, unknown> = {}) {
  return {
    nom: 'Crêperie du Quai',
    lieuId,
    typeOffre: 'crepes' as const,
    positionnement: 'standard' as const,
    emplacementObserve: null,
    qualitePercue: 3,
    notesGenerales: null,
    ...surcharges,
  };
}

describe('dépôt concurrents', () => {
  let base: BaseBatte;
  let idLieu: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    idLieu = insererLieu(base, 'La Batte');
  });

  describe('creerConcurrent', () => {
    it('crée la fiche et renseigne le nom du lieu joint', () => {
      const cree = creerConcurrent(base, saisieConcurrent(idLieu));
      expect(cree.nom).toBe('Crêperie du Quai');
      expect(cree.lieuNom).toBe('La Batte');
      expect(cree.actif).toBe(true);
      expect(cree.dateDerniereObservation).toBeNull();
    });

    it('refuse un lieu inexistant, en désignant le champ', () => {
      expect(() => creerConcurrent(base, saisieConcurrent('lieu-fantome'))).toThrowError(
        ErreurMetier,
      );
      try {
        creerConcurrent(base, saisieConcurrent('lieu-fantome'));
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).champs).toHaveProperty('lieuId');
      }
    });
  });

  describe('modifierConcurrent', () => {
    it('met à jour les champs de la fiche', () => {
      const cree = creerConcurrent(base, saisieConcurrent(idLieu));
      const modifie = modifierConcurrent(
        base,
        cree.id,
        saisieConcurrent(idLieu, { positionnement: 'premium', qualitePercue: 5 }),
      );
      expect(modifie.positionnement).toBe('premium');
      expect(modifie.qualitePercue).toBe(5);
    });

    it('rend ErreurIntrouvable sur un identifiant inconnu', () => {
      expect(() =>
        modifierConcurrent(base, 'concurrent-fantome', saisieConcurrent(idLieu)),
      ).toThrowError(ErreurIntrouvable);
    });
  });

  describe('changerActiviteConcurrent — rien ne s’efface', () => {
    it('désactive puis réactive sans retirer aucune ligne', () => {
      const cree = creerConcurrent(base, saisieConcurrent(idLieu));

      const desactive = changerActiviteConcurrent(base, cree.id, false);
      expect(desactive.actif).toBe(false);
      // Toujours présent dans le référentiel complet — désactivé, pas supprimé.
      expect(listerConcurrents(base).some((c) => c.id === cree.id)).toBe(true);

      const reactive = changerActiviteConcurrent(base, cree.id, true);
      expect(reactive.actif).toBe(true);
    });
  });

  describe('ajouterProduitConcurrent — historisation', () => {
    it('conserve les DEUX relevés et projette le plus récent comme « dernier prix »', () => {
      const cree = creerConcurrent(base, saisieConcurrent(idLieu));

      ajouterProduitConcurrent(base, cree.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 280,
        description: null,
        dateObservation: JOUR_1,
      });
      ajouterProduitConcurrent(base, cree.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 300,
        description: null,
        dateObservation: JOUR_2,
      });

      const detail = lireConcurrentDetail(base, cree.id)!;
      // L'historique complet garde les DEUX lignes — jamais aplati.
      expect(detail.produits).toHaveLength(2);
      expect(detail.produits.map((p) => p.prixCents).sort()).toEqual([280, 300]);

      // La projection ne retient que le plus récent par nom de produit.
      expect(detail.dernierPrixParProduit).toHaveLength(1);
      expect(detail.dernierPrixParProduit[0]!.prixCents).toBe(300);
      expect(detail.dernierPrixParProduit[0]!.dateObservation).toBe(JOUR_2);
    });

    it('avance `dateDerniereObservation` sans jamais la faire reculer', () => {
      const cree = creerConcurrent(base, saisieConcurrent(idLieu));

      ajouterProduitConcurrent(base, cree.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 300,
        description: null,
        dateObservation: JOUR_2,
      });
      expect(lireConcurrentDetail(base, cree.id)!.dateDerniereObservation).toBe(JOUR_2);

      // Un relevé saisi dans le désordre (date ANTÉRIEURE) ne doit pas reculer
      // la date de dernière observation affichée dans la liste.
      ajouterProduitConcurrent(base, cree.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 260,
        description: null,
        dateObservation: JOUR_1,
      });
      expect(lireConcurrentDetail(base, cree.id)!.dateDerniereObservation).toBe(JOUR_2);
    });

    it('rend ErreurIntrouvable si le concurrent est inconnu', () => {
      expect(() =>
        ajouterProduitConcurrent(base, 'concurrent-fantome', {
          nomProduit: 'Crêpe sucre',
          prixCents: 300,
          description: null,
          dateObservation: JOUR_1,
        }),
      ).toThrowError(ErreurIntrouvable);
    });
  });

  describe('ajouterObservationConcurrent', () => {
    it('ajoute la visite et avance la dernière observation', () => {
      const cree = creerConcurrent(base, saisieConcurrent(idLieu));

      const observation = ajouterObservationConcurrent(base, cree.id, {
        dateObservation: JOUR_2,
        affluenceEstimee: 'forte',
        fileAttente: true,
        notes: "File d'attente de 6 personnes à 10 h.",
      });
      expect(observation.affluenceEstimee).toBe('forte');

      const detail = lireConcurrentDetail(base, cree.id)!;
      expect(detail.observations).toHaveLength(1);
      expect(detail.dateDerniereObservation).toBe(JOUR_2);
    });
  });

  describe('lireConcurrentDetail', () => {
    it('rend `undefined` sur un identifiant inconnu', () => {
      expect(lireConcurrentDetail(base, 'concurrent-fantome')).toBeUndefined();
    });
  });

  describe('listerConcurrents', () => {
    it('filtre par lieu et rend actifs ET inactifs (filtre d’affichage laissé à l’écran)', () => {
      const autreLieu = insererLieu(base, 'Autre marché');
      const c1 = creerConcurrent(base, saisieConcurrent(idLieu, { nom: 'A' }));
      creerConcurrent(base, saisieConcurrent(autreLieu, { nom: 'B' }));
      changerActiviteConcurrent(base, c1.id, false);

      const surLieu = listerConcurrents(base, { lieuId: idLieu });
      expect(surLieu.map((c) => c.nom)).toEqual(['A']);
      expect(surLieu[0]!.actif).toBe(false);

      expect(listerConcurrents(base)).toHaveLength(2);
    });
  });

  describe('moyenneCentsEntiere', () => {
    it('rend `null` sur une liste vide plutôt que NaN', () => {
      expect(moyenneCentsEntiere([])).toBeNull();
    });

    it('arrondit la moyenne entière', () => {
      expect(moyenneCentsEntiere([100, 200, 300])).toBe(200);
      expect(moyenneCentsEntiere([100])).toBe(100);
    });
  });

  describe('comparateurPrix', () => {
    it('rend des moyennes à `null` quand aucun concurrent équivalent n’a de prix', () => {
      insererProduitVente(base, {
        nom: 'Froment / cassonade',
        nature: 'transforme',
        prixCents: 300,
      });
      creerConcurrent(base, saisieConcurrent(idLieu, { nom: 'Vendeur salé', typeOffre: 'sale' }));

      const resultat = comparateurPrix(base);
      expect(resultat.notreCarte).toHaveLength(1);
      expect(resultat.moyenne.notrePrixMoyenCrepeCents).toBe(300);
      expect(resultat.moyenne.concurrentsPrixMoyenCents).toBeNull();
      expect(resultat.moyenne.ecartBp).toBeNull();
      // Le vendeur « salé » n'est pas équivalent à une carte de crêpes.
      expect(resultat.moyenne.nbConcurrentsEquivalents).toBe(0);
      expect(resultat.dernierPrixConcurrents).toEqual([]);
    });

    it('ne retient que le DERNIER prix par concurrent équivalent, jamais l’historique complet', () => {
      insererProduitVente(base, {
        nom: 'Froment / cassonade',
        nature: 'transforme',
        prixCents: 300,
      });
      const concurrentEquivalent = creerConcurrent(
        base,
        saisieConcurrent(idLieu, { nom: 'Crêperie du Quai', typeOffre: 'crepes' }),
      );
      ajouterProduitConcurrent(base, concurrentEquivalent.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 280,
        description: null,
        dateObservation: JOUR_1,
      });
      ajouterProduitConcurrent(base, concurrentEquivalent.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 350,
        description: null,
        dateObservation: JOUR_2,
      });

      const resultat = comparateurPrix(base);
      expect(resultat.dernierPrixConcurrents).toHaveLength(1);
      expect(resultat.dernierPrixConcurrents[0]!.prixCents).toBe(350);
      expect(resultat.moyenne.concurrentsPrixMoyenCents).toBe(350);
      // Concurrent plus cher que nous (350 > 300) : écart POSITIF.
      expect(resultat.moyenne.ecartBp).toBeGreaterThan(0);
      expect(resultat.moyenne.nbConcurrentsEquivalents).toBe(1);
    });

    it('rend un écart NÉGATIF quand le concurrent équivalent est moins cher que nous', () => {
      insererProduitVente(base, {
        nom: 'Froment / cassonade',
        nature: 'transforme',
        prixCents: 300,
      });
      const concurrentEquivalent = creerConcurrent(
        base,
        saisieConcurrent(idLieu, { nom: 'La Petite Bretonne', typeOffre: 'mixte' }),
      );
      ajouterProduitConcurrent(base, concurrentEquivalent.id, {
        nomProduit: 'Crêpe froment nature',
        prixCents: 250,
        description: null,
        dateObservation: JOUR_1,
      });

      const resultat = comparateurPrix(base);
      expect(resultat.moyenne.ecartBp).toBeLessThan(0);
    });

    it('exclut un concurrent équivalent mais DÉSACTIVÉ', () => {
      insererProduitVente(base, {
        nom: 'Froment / cassonade',
        nature: 'transforme',
        prixCents: 300,
      });
      const c = creerConcurrent(
        base,
        saisieConcurrent(idLieu, { nom: 'Fermé', typeOffre: 'crepes' }),
      );
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 999,
        description: null,
        dateObservation: JOUR_1,
      });
      changerActiviteConcurrent(base, c.id, false);

      const resultat = comparateurPrix(base);
      expect(resultat.moyenne.nbConcurrentsEquivalents).toBe(0);
      expect(resultat.moyenne.concurrentsPrixMoyenCents).toBeNull();
    });

    it('n’inclut dans « notre carte » que les produits ACTIFS', () => {
      insererProduitVente(base, { nom: 'Actif', nature: 'transforme', prixCents: 300 });
      insererProduitVente(base, {
        nom: 'Retiré',
        nature: 'transforme',
        prixCents: 999,
        actif: false,
      });

      const resultat = comparateurPrix(base);
      expect(resultat.notreCarte.map((p) => p.nom)).toEqual(['Actif']);
    });

    /**
     * Fiche 16 §2 (migration 0023) : un MENU a un prix FORFAITAIRE, pas un
     * prix à la crêpe. Le comparer au prix moyen relevé chez un concurrent
     * (qui vend des crêpes à l'unité) comparerait deux grandeurs différentes
     * — même doctrine que l'absence d'appariement produit-à-produit (en-tête
     * de `depots/concurrents.ts`). Décision : exclu du comparateur.
     */
    it('exclut un produit de nature MENU de « notre carte »', () => {
      insererProduitVente(base, {
        nom: 'Froment / cassonade',
        nature: 'transforme',
        prixCents: 300,
      });
      const maintenant = maintenantUtc();
      base
        .insert(produitVente)
        .values({
          id: nouvelIdentifiant(),
          nom: 'Menu Crêpe + Café',
          nature: 'menu',
          recetteId: null,
          ingredientId: null,
          prixCents: 500,
          nbCrepes: null,
          categorie: null,
          consommationSurPlace: false,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const resultat = comparateurPrix(base);
      expect(resultat.notreCarte.map((p) => p.nom)).toEqual(['Froment / cassonade']);
      // La moyenne « prix crêpe » n'est donc pas non plus polluée par le forfait.
      expect(resultat.moyenne.notrePrixMoyenCrepeCents).toBe(300);
    });
  });

  describe('mouvementsPrixConcurrents — « qu’est-ce qui a bougé depuis mon avant-dernier relevé ? »', () => {
    it('rend `nouveau` avec TOUT à `null`, jamais 0, sur un seul relevé', () => {
      const c = creerConcurrent(base, saisieConcurrent(idLieu));
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 280,
        description: null,
        dateObservation: JOUR_1,
      });

      const mouvements = mouvementsPrixConcurrents(base);
      expect(mouvements).toHaveLength(1);
      const m = mouvements[0]!;
      expect(m.statut).toBe('nouveau');
      expect(m.prixCents).toBe(280);
      expect(m.prixPrecedentCents).toBeNull();
      expect(m.ecartCents).toBeNull();
      expect(m.ecartBp).toBeNull();
      expect(m.dateObservation).toBe(JOUR_1);
      expect(m.dateObservationPrecedente).toBeNull();
    });

    it('rend `stable` avec un écart à 0 — une information, pas une absence de mouvement', () => {
      const c = creerConcurrent(base, saisieConcurrent(idLieu));
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 280,
        description: null,
        dateObservation: JOUR_1,
      });
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 280,
        description: null,
        dateObservation: JOUR_2,
      });

      const mouvements = mouvementsPrixConcurrents(base);
      const m = mouvements[0]!;
      expect(m.statut).toBe('stable');
      expect(m.ecartCents).toBe(0);
      expect(m.ecartBp).toBe(0);
      expect(m.prixPrecedentCents).toBe(280);
      expect(m.dateObservation).toBe(JOUR_2);
      expect(m.dateObservationPrecedente).toBe(JOUR_1);
    });

    it('rend `hausse` avec un écart POSITIF quand le prix a augmenté', () => {
      const c = creerConcurrent(base, saisieConcurrent(idLieu));
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 280,
        description: null,
        dateObservation: JOUR_1,
      });
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 350,
        description: null,
        dateObservation: JOUR_2,
      });

      const m = mouvementsPrixConcurrents(base)[0]!;
      expect(m.statut).toBe('hausse');
      expect(m.ecartCents).toBe(70);
      expect(m.ecartBp).toBeGreaterThan(0);
      expect(m.prixPrecedentCents).toBe(280);
    });

    it('rend `baisse` avec un écart NÉGATIF quand le prix a diminué', () => {
      const c = creerConcurrent(base, saisieConcurrent(idLieu));
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 350,
        description: null,
        dateObservation: JOUR_1,
      });
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 280,
        description: null,
        dateObservation: JOUR_2,
      });

      const m = mouvementsPrixConcurrents(base)[0]!;
      expect(m.statut).toBe('baisse');
      expect(m.ecartCents).toBe(-70);
      expect(m.ecartBp).toBeLessThan(0);
    });

    it('un produit NOUVEAU chez un concurrent déjà établi reste `nouveau`, pas une hausse depuis zéro', () => {
      const c = creerConcurrent(base, saisieConcurrent(idLieu));
      // Produit établi, deux relevés.
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 280,
        description: null,
        dateObservation: JOUR_1,
      });
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 300,
        description: null,
        dateObservation: JOUR_2,
      });
      // Produit qui apparaît seulement au second relevé — jamais vu avant.
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Gaufre de Liège',
        prixCents: 400,
        description: null,
        dateObservation: JOUR_2,
      });

      const mouvements = mouvementsPrixConcurrents(base);
      expect(mouvements).toHaveLength(2);
      const gaufre = mouvements.find((m) => m.nomProduit === 'Gaufre de Liège')!;
      expect(gaufre.statut).toBe('nouveau');
      expect(gaufre.ecartCents).toBeNull();
      expect(gaufre.prixPrecedentCents).toBeNull();
      // Le produit établi, lui, reste comparable normalement.
      const crepe = mouvements.find((m) => m.nomProduit === 'Crêpe sucre')!;
      expect(crepe.statut).toBe('hausse');
    });

    it('rend `ecartBp` à `null` quand le prix précédent était nul — jamais une division silencieuse', () => {
      const c = creerConcurrent(base, saisieConcurrent(idLieu));
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Dégustation gratuite',
        prixCents: 0,
        description: null,
        dateObservation: JOUR_1,
      });
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Dégustation gratuite',
        prixCents: 150,
        description: null,
        dateObservation: JOUR_2,
      });

      const m = mouvementsPrixConcurrents(base)[0]!;
      expect(m.statut).toBe('hausse');
      expect(m.ecartCents).toBe(150);
      expect(m.ecartBp).toBeNull();
    });

    it('ne conserve QUE l’historique le plus récent — un troisième relevé décale la paire comparée', () => {
      const c = creerConcurrent(base, saisieConcurrent(idLieu));
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 200,
        description: null,
        dateObservation: '2026-06-01',
      });
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 280,
        description: null,
        dateObservation: JOUR_1,
      });
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 300,
        description: null,
        dateObservation: JOUR_2,
      });

      const m = mouvementsPrixConcurrents(base)[0]!;
      // Comparaison des DEUX plus récents (JOUR_2 vs JOUR_1), jamais du tout
      // premier relevé (2026-06-01, 200 cts).
      expect(m.prixCents).toBe(300);
      expect(m.prixPrecedentCents).toBe(280);
      expect(m.dateObservationPrecedente).toBe(JOUR_1);
    });

    it('exclut un concurrent DÉSACTIVÉ — plus surveillé, même s’il a un historique', () => {
      const c = creerConcurrent(base, saisieConcurrent(idLieu));
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 280,
        description: null,
        dateObservation: JOUR_1,
      });
      ajouterProduitConcurrent(base, c.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 350,
        description: null,
        dateObservation: JOUR_2,
      });
      changerActiviteConcurrent(base, c.id, false);

      expect(mouvementsPrixConcurrents(base)).toEqual([]);
    });

    it('filtre par lieu, comme le comparateur', () => {
      const autreLieu = (() => {
        const id = nouvelIdentifiant();
        const maintenant = maintenantUtc();
        base
          .insert(lieuMarche)
          .values({
            id,
            nom: 'Autre marché',
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();
        return id;
      })();

      const surLieu = creerConcurrent(base, saisieConcurrent(idLieu, { nom: 'Sur le lieu' }));
      ajouterProduitConcurrent(base, surLieu.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 280,
        description: null,
        dateObservation: JOUR_1,
      });
      const surAutreLieu = creerConcurrent(base, saisieConcurrent(autreLieu, { nom: 'Ailleurs' }));
      ajouterProduitConcurrent(base, surAutreLieu.id, {
        nomProduit: 'Crêpe sucre',
        prixCents: 999,
        description: null,
        dateObservation: JOUR_1,
      });

      const filtre = mouvementsPrixConcurrents(base, { lieuId: idLieu });
      expect(filtre.map((m) => m.concurrentNom)).toEqual(['Sur le lieu']);
    });

    it('rend un tableau vide sans historique', () => {
      creerConcurrent(base, saisieConcurrent(idLieu));
      expect(mouvementsPrixConcurrents(base)).toEqual([]);
    });
  });
});
