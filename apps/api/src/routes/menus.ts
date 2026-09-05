/**
 * Routes des MENUS (fiche 16 §2) : un produit_vente qui en contient d'autres,
 * avec son propre prix.
 *
 * Même convention que `routes/nomenclature-vente.ts` : l'API ASSEMBLE et
 * VALIDE, elle ne décide rien (règle d'architecture n°1). Les bornes et
 * cohérences viennent des schémas Zod purs de `@batte/core`
 * (`contrats/menus.ts`) ; l'existence des références et l'état de la base
 * viennent du dépôt, qui lève des `ErreurMetier` typées.
 *
 * Conventions d'erreur (D-035) : **404** quand le MENU adressé dans l'URL
 * n'existe pas ; **422 + `champs`** quand le produit inclus saisi dans le
 * formulaire n'existe pas (ou se référence lui-même, ou est déjà un menu, ou
 * est déjà un composant de ce menu).
 *
 * AUCUNE ROUTE DE SUPPRESSION (CLAUDE.md §3 règle 7) : on désactive
 * (`PATCH …/activite`), on ne supprime jamais un composant.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  schemaChangementActivite,
  schemaCompositionMenu,
  schemaListeCompositionMenu,
  schemaListeMenus,
  schemaSaisieCompositionMenu,
  schemaSimulationVentilationMenu,
  schemaVentilationMenu,
} from '@batte/core';
import {
  calculerVentilationMenu,
  changerActiviteCompositionMenu,
  creerCompositionMenu,
  lireCompositionMenu,
  listerCompositionMenu,
  listerMenus,
  modifierCompositionMenu,
  type BaseBatte,
} from '@batte/db';

/**
 * Retrouve le composant qu'on vient d'écrire, pour le renvoyer à l'appelant.
 *
 * Une absence ici serait une incohérence INTERNE (la transaction vient de
 * commiter) et non une faute de l'utilisateur : une vraie 500, jamais un 404
 * qui laisserait croire à une mauvaise saisie (même raisonnement que
 * `detailApresEcriture` de `routes/nomenclature-vente.ts`).
 */
function detailApresEcriture(base: BaseBatte, id: string) {
  const ligne = lireCompositionMenu(base, id);
  if (ligne === null) throw new Error(`Composant de menu ${id} introuvable après écriture.`);
  return schemaCompositionMenu.parse(ligne);
}

export function routesMenus(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /** Tous les produits qui contiennent au moins un composant (« être un menu » se déduit de `menu_composition`). */
    app.get('/menus', async () => {
      const lignes = listerMenus(base);
      return schemaListeMenus.parse({ data: lignes, meta: { total: lignes.length } });
    });

    /** Composants d'UN menu, ACTIFS ET INACTIFS — l'écran doit montrer ce qui est désactivé. */
    app.get<{ Params: { menuId: string } }>('/menus/:menuId/composition', async (requete) => {
      const lignes = listerCompositionMenu(base, requete.params.menuId);
      return schemaListeCompositionMenu.parse({ data: lignes, meta: { total: lignes.length } });
    });

    /**
     * Déclare un nouveau composant sur un menu. 404 si le menu adressé dans
     * l'URL n'existe pas ; 422 + `champs` si le produit inclus n'existe pas,
     * se référence lui-même, est déjà lui-même un menu, ou figure déjà dans
     * ce menu (D-035).
     */
    app.post<{ Params: { menuId: string } }>(
      '/menus/:menuId/composition',
      async (requete, reponse) => {
        const saisie = schemaSaisieCompositionMenu.parse(requete.body);
        const id = creerCompositionMenu(base, requete.params.menuId, saisie);

        reponse.code(201);
        return detailApresEcriture(base, id);
      },
    );

    /**
     * Corrige un composant : la quantité ou le produit rattaché était faux.
     * Ce n'est PAS le geste pour retirer un composant devenu obsolète — voir
     * `PATCH …/activite` ci-dessous (CLAUDE.md §3 règle 7).
     */
    app.patch<{ Params: { id: string } }>('/composition-menu/:id', async (requete) => {
      const saisie = schemaSaisieCompositionMenu.parse(requete.body);
      modifierCompositionMenu(base, requete.params.id, saisie);

      return detailApresEcriture(base, requete.params.id);
    });

    /** Désactivation / réactivation. Le remplaçant de la suppression. */
    app.patch<{ Params: { id: string } }>('/composition-menu/:id/activite', async (requete) => {
      const { actif } = schemaChangementActivite.parse(requete.body);
      changerActiviteCompositionMenu(base, requete.params.id, actif);

      return detailApresEcriture(base, requete.params.id);
    });

    /**
     * Ventilation du prix du menu entre ses composants (fiche 16 §2.2) : au
     * PRORATA des prix catalogue par défaut, ou avec un prix IMPOSÉ par
     * composant si le corps en fournit un (« le café est à 1,50 € dans ce
     * menu »). C'est ELLE qui répond à la question qui fait tout l'intérêt de
     * cette fiche : combien du prix du menu est du transformé, combien est du
     * revendu — le chiffre qui alimente les compteurs de seuils légaux.
     *
     * POST plutôt que GET : le corps porte la simulation, et rien n'est écrit
     * — voir le rapport de livraison pour la colonne qui manque pour
     * MÉMORISER ce réglage par menu au lieu de le recevoir à chaque appel.
     *
     * 404 si le menu n'existe pas ; 422 si le menu n'a encore aucun
     * composant actif déclaré.
     */
    app.post<{ Params: { menuId: string } }>('/menus/:menuId/ventilation', async (requete) => {
      const simulation = schemaSimulationVentilationMenu.parse(requete.body ?? {});
      const prixForcesCents = new Map(Object.entries(simulation.prixForcesCents));
      const ventilation = calculerVentilationMenu(base, requete.params.menuId, prixForcesCents);

      return schemaVentilationMenu.parse(ventilation);
    });
  };
}
