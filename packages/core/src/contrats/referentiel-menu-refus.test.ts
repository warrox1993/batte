/**
 * Cohérence de saisie d'un produit de nature « menu » (fiche 16 §2).
 *
 * `contrats/referentiel.test.ts` exerce en détail les natures `transforme` et
 * `revendu` ; la troisième — le menu, ajoutée en cours de route — n'était
 * couverte par AUCUN cas, ni acceptant ni refusant. Or c'est la nature dont la
 * saisie fautive coûte le plus cher : un menu n'a NI recette NI article propre,
 * son coût vient de la somme de ses composants. Lui laisser une recette
 * produirait un coût de revient à côté du vrai, sans que rien ne le signale.
 *
 * On assère sur les CHEMINS de champ (`path`), pas sur les phrases : le
 * gestionnaire d'erreurs de l'API les transforme en `champs.<nom>`, et c'est
 * cette accroche-là — pas la formulation — qui décide si le message s'affiche
 * sous le bon champ.
 */

import { describe, expect, it } from 'vitest';
import { schemaSaisieProduit, type SaisieProduitBrute } from './referentiel.js';

/**
 * Un menu VALIDE : ni recette, ni ingrédient, ni nombre de crêpes, et pas de
 * clé `consommationUnite` du tout (elle est OMETTABLE — un menu ne doit jamais
 * avoir eu à répondre à cette question).
 */
function menuValide(): SaisieProduitBrute {
  return {
    nom: 'Formule crêpe + café',
    nature: 'menu',
    recetteId: null,
    ingredientId: null,
    prixCents: 450,
    nbCrepes: null,
    volumeMlParUnite: null,
    categorie: 'formule',
    consommationSurPlace: true,
  };
}

/** Chemins de champ signalés, à plat, pour une assertion directe. */
function champsFautifs(saisie: unknown): string[] {
  const resultat = schemaSaisieProduit.safeParse(saisie);
  if (resultat.success) return [];
  return resultat.error.issues.map((i) => i.path.join('.')).sort();
}

describe('schemaSaisieProduit — nature « menu »', () => {
  it('accepte un menu sans recette, sans article et sans nombre de crêpes', () => {
    // Sans ce cas, tous les refus ci-dessous pourraient venir d'une fixture
    // invalide pour une tout autre raison.
    expect(schemaSaisieProduit.safeParse(menuValide()).success).toBe(true);
  });

  it('refuse un menu rattaché à une recette', () => {
    expect(champsFautifs({ ...menuValide(), recetteId: 'recette-r1' })).toEqual(['recetteId']);
  });

  it('refuse un menu rattaché à un article revendu', () => {
    expect(champsFautifs({ ...menuValide(), ingredientId: 'ingredient-sirop' })).toEqual([
      'ingredientId',
    ]);
  });

  it('refuse un menu qui déclarerait consommer des crêpes lui-même', () => {
    // Y compris `0` : ce serait une réponse EXPLICITE à une question qui ne se
    // pose pas — ce sont les composants qui consomment, chacun selon sa nature.
    expect(champsFautifs({ ...menuValide(), nbCrepes: 0 })).toEqual(['nbCrepes']);
    expect(champsFautifs({ ...menuValide(), nbCrepes: 2 })).toEqual(['nbCrepes']);
  });

  it('refuse un menu qui déclarerait consommer quelque chose de la production', () => {
    expect(champsFautifs({ ...menuValide(), consommationUnite: 'crepes' })).toEqual([
      'consommationUnite',
    ]);
  });

  /**
   * DIVERGENCE COMMENTAIRE / CODE, TRANCHÉE le 01/08/2026 — et c'est le CODE
   * qui avait raison. Ce test était en `it.fails` ; il est désormais un test
   * ordinaire qui fige le comportement retenu.
   *
   * Le commentaire de `verifierCoherenceProduit` affirmait qu'envoyer la clé
   * « même à `null` » était attrapé par le refus. La condition disait
   * l'inverse. Le départage s'est fait chez l'APPELANT, pas par préférence :
   * `corpsSaisieProduit` (`apps/web/src/pages/Produits.tsx`) envoie
   * `consommationUnite: null` pour TOUT produit non transformé. Durcir aurait
   * cassé l'enregistrement de chaque menu et de chaque revendu — une
   * régression franche pour faire dire vrai à un commentaire.
   *
   * Pourquoi ce n'est pas incohérent avec `nbCrepes: 0`, refusé juste
   * au-dessus : `0` est une VALEUR légitime de `nbCrepes` (le café, transformé
   * à la demande, en porte une), donc la refuser sur un menu refuse une
   * réponse qui a du sens à une question qui n'en a pas. `null` n'est pas une
   * valeur de `consommationUnite` : c'est l'absence de réponse, épelée par un
   * formulaire qui ne sait pas omettre une clé.
   */
  it('accepte `consommationUnite: null` — c’est l’absence de réponse, pas une réponse', () => {
    expect(champsFautifs({ ...menuValide(), consommationUnite: null })).toEqual([]);
    // Une unité RÉELLE reste refusée : c'est bien une réponse, et elle est
    // fausse pour un menu.
    expect(champsFautifs({ ...menuValide(), consommationUnite: 'volume_pate' })).toEqual([
      'consommationUnite',
    ]);
  });

  it('signale TOUS les champs fautifs d’un coup, pas seulement le premier', () => {
    // Un menu recopié depuis un transformé porte les trois à la fois : l'écran
    // doit pouvoir accrocher un message sous chacun en une seule soumission.
    expect(
      champsFautifs({
        ...menuValide(),
        recetteId: 'recette-r1',
        ingredientId: 'ingredient-sirop',
        nbCrepes: 1,
        consommationUnite: 'crepes',
      }),
    ).toEqual(['consommationUnite', 'ingredientId', 'nbCrepes', 'recetteId']);
  });
});
