/**
 * Routes `/api/recettes` (Lot 1).
 *
 * L'API assemble et valide, elle ne calcule pas : la mise a l'echelle vient de
 * `mettreAEchelle` de `@batte/core`, en fonction pure et testee
 * (regle d'architecture n°1).
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  ErreurIntrouvable,
  mettreAEchelle,
  schemaCibleCalcul,
  schemaCoutProduitVendu,
  schemaListeCoutsProduits,
  schemaListeRecettes,
  schemaRecetteDetail,
  schemaResultatCalcul,
  type CibleCalcul,
  type CibleMiseAEchelle,
} from '@batte/core';
import {
  chargerRecettePourCalcul,
  coutRevientProduit,
  lireRecetteDetail,
  listerCoutsRevientProduits,
  listerRecettes,
  type BaseBatte,
} from '@batte/db';

/**
 * Traduit la cible HTTP vers la cible metier.
 *
 * Les deux formes different volontairement : le contrat HTTP est plat et
 * facile a poster depuis un formulaire, le type metier est explicite sur ce
 * que « valeur » signifie dans chaque cas.
 */
function versCibleMetier(cible: CibleCalcul): CibleMiseAEchelle {
  switch (cible.cible) {
    case 'crepes':
      return { type: 'crepes', crepesVendables: cible.valeur };
    case 'volume':
      return { type: 'volume', volumeMl: cible.valeur };
    case 'ingredient':
      return {
        type: 'ingredient',
        ingredientId: cible.ingredientId,
        quantiteDisponible: cible.valeur,
      };
  }
}

export function routesRecettes(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    app.get('/recettes', async () => {
      const lignes = listerRecettes(base);
      return schemaListeRecettes.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.get<{ Params: { id: string } }>('/recettes/:id', async (requete) => {
      const detail = lireRecetteDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Recette', requete.params.id);
      return schemaRecetteDetail.parse(detail);
    });

    app.post<{ Params: { id: string } }>('/recettes/:id/calculer', async (requete) => {
      const cible = schemaCibleCalcul.parse(requete.body);

      const pourCalcul = chargerRecettePourCalcul(base, requete.params.id);
      if (pourCalcul === null) throw new ErreurIntrouvable('Recette', requete.params.id);

      // `mettreAEchelle` leve une ErreurMetier typee sur une recette vide, un
      // rendement invalide ou un ingredient hors recette : le gestionnaire
      // d'erreurs la traduit en 422 avec un message francais affichable.
      const resultat = mettreAEchelle(pourCalcul, versCibleMetier(cible));

      return schemaResultatCalcul.parse({
        facteur: resultat.facteur,
        volumeMl: resultat.volumeMl,
        crepesTheoriques: resultat.crepesTheoriques,
        crepesVendables: resultat.crepesVendables,
        lignes: resultat.lignes.map((ligne, index) => ({
          ingredientId: ligne.ingredientId,
          nomIngredient: ligne.nomIngredient,
          unite: ligne.unite,
          quantiteReference: ligne.quantiteReference,
          cumpCentsParUnite: ligne.cumpCentsParUnite,
          allergenes: [...ligne.allergenes],
          ordre: index,
          quantite: ligne.quantite,
          coutCents: ligne.coutCents,
        })),
        coutMatiereCents: resultat.coutMatiereCents,
        coutParCrepeCents: resultat.coutParCrepeCents,
        allergenes: [...resultat.allergenes],
      });
    });

    /**
     * Cout de revient COMPLET des produits vendus : part de pate + garnitures.
     *
     * Distinct de `/recettes/:id/calculer`, qui chiffre une FOURNEE. Ce qui se
     * vend n'est pas une fournee, c'est une crepe garnie — et tant que les
     * garnitures n'entraient nulle part, deux produits vendus 3,00 € et 3,50 €
     * affichaient le meme cout de revient.
     *
     * Une seule route de LISTE et non une par produit : l'ecran Produits a
     * besoin de la colonne pour toutes ses lignes a la fois.
     */
    app.get('/couts-produits', async () => {
      const lignes = listerCoutsRevientProduits(base);
      return schemaListeCoutsProduits.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.get<{ Params: { id: string } }>('/produits/:id/cout-revient', async (requete) => {
      const cout = coutRevientProduit(base, requete.params.id);
      if (cout === null) throw new ErreurIntrouvable('Produit', requete.params.id);
      return schemaCoutProduitVendu.parse(cout);
    });
  };
}
