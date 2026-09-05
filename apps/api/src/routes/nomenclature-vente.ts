/**
 * Routes de la NOMENCLATURE DE VENTE (fiche 15) : ce qu'un produit consomme
 * quand il est VENDU — serviettes, gobelets, cafe en poudre, toppings vendus
 * a la piece — par opposition a la recette, consommee a la PRODUCTION.
 *
 * Meme convention que `routes/referentiel-ecriture.ts` : l'API ASSEMBLE et
 * VALIDE, elle ne decide rien (regle d'architecture n°1). Les bornes et
 * coherences viennent des schemas Zod purs de `@batte/core`
 * (`contrats/nomenclature-vente.ts`) ; l'existence des references et l'etat de
 * la base viennent du depot, qui leve des `ErreurMetier` typees.
 *
 * Conventions d'erreur (D-035) : **404** quand le produit ADRESSE DANS L'URL
 * n'existe pas ; **422 + `champs`** quand l'ingredient SAISI dans le
 * formulaire n'existe pas.
 *
 * AUCUNE ROUTE DE SUPPRESSION (CLAUDE.md §3 regle 7) : on desactive
 * (`PATCH …/activite`), on ne supprime jamais un composant — un lot consomme
 * via ce composant il y a deux mois doit rester tracable jusqu'a lui.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  schemaChangementActivite,
  schemaComposantVente,
  schemaListeComposantsVente,
  schemaSaisieComposantVente,
} from '@batte/core';
import {
  changerActiviteComposantVente,
  creerComposantVente,
  lireComposantVente,
  listerComposantsDuProduit,
  modifierComposantVente,
  type BaseBatte,
} from '@batte/db';

/**
 * Retrouve le composant qu'on vient d'ecrire, pour le renvoyer a l'appelant.
 *
 * Une absence ici serait une incoherence INTERNE (la transaction vient de
 * commiter) et non une faute de l'utilisateur : une vraie 500, jamais un 404
 * qui laisserait croire a une mauvaise saisie. Meme raisonnement que
 * `retrouver` de `routes/referentiel-ecriture.ts`.
 */
function detailApresEcriture(base: BaseBatte, id: string) {
  const ligne = lireComposantVente(base, id);
  if (ligne === null) throw new Error(`Composant de vente ${id} introuvable après écriture.`);
  return schemaComposantVente.parse(ligne);
}

export function routesNomenclatureVente(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /**
     * Composants d'UN produit, ACTIFS ET INACTIFS — l'ecran de declaration a
     * besoin de montrer ce qui est desactive, avec son geste de reactivation.
     */
    app.get<{ Params: { produitVenteId: string } }>(
      '/produits/:produitVenteId/composants',
      async (requete) => {
        const lignes = listerComposantsDuProduit(base, requete.params.produitVenteId);
        return schemaListeComposantsVente.parse({ data: lignes, meta: { total: lignes.length } });
      },
    );

    /**
     * Declare un nouveau composant sur un produit. 404 si le produit adresse
     * dans l'URL n'existe pas ; 422 + `champs` si l'ingredient saisi n'existe
     * pas (D-035).
     */
    app.post<{ Params: { produitVenteId: string } }>(
      '/produits/:produitVenteId/composants',
      async (requete, reponse) => {
        const saisie = schemaSaisieComposantVente.parse(requete.body);
        const id = creerComposantVente(base, requete.params.produitVenteId, saisie);

        reponse.code(201);
        return detailApresEcriture(base, id);
      },
    );

    /**
     * Corrige un composant : la quantite ou l'ingredient rattache etait faux.
     * Ce n'est PAS le geste pour retirer un composant devenu obsolete — voir
     * `PATCH …/activite` ci-dessous (CLAUDE.md §3 regle 7 : on desactive, on
     * ne supprime jamais).
     */
    app.patch<{ Params: { id: string } }>('/composants/:id', async (requete) => {
      const saisie = schemaSaisieComposantVente.parse(requete.body);
      modifierComposantVente(base, requete.params.id, saisie);

      return detailApresEcriture(base, requete.params.id);
    });

    /** Desactivation / reactivation. Le remplacant de la suppression. */
    app.patch<{ Params: { id: string } }>('/composants/:id/activite', async (requete) => {
      const { actif } = schemaChangementActivite.parse(requete.body);
      changerActiviteComposantVente(base, requete.params.id, actif);

      return detailApresEcriture(base, requete.params.id);
    });
  };
}
