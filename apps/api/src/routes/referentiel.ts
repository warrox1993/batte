/**
 * Routes du referentiel : fournisseurs, produits vendus et ingredients.
 *
 * Les deux premiers sont desormais MODIFIABLES depuis l'interface : jusqu'ici,
 * ajouter un produit du terroir a revendre ou changer de meunier imposait
 * d'editer le fichier SQLite a la main.
 *
 * L'API assemble et valide, elle ne decide rien : la coherence
 * nature <-> rattachement d'un produit vient de `schemaSaisieProduit` de
 * `@batte/core` (fonction pure et testee, regle d'architecture n°1), et les
 * ecritures viennent du depot `referentiel` de `@batte/db`, qui les journalise.
 *
 * Conventions d'erreur (D-035) :
 *   - **404** pour une ressource adressee dans l'URL qui n'existe pas
 *     (`ErreurIntrouvable`, levee par le depot) ;
 *   - **422 + `champs`** pour une valeur saisie dans un formulaire — produit
 *     automatiquement par le gestionnaire d'erreurs a partir des `path` des
 *     issues Zod, sans une ligne de code ici.
 *
 * AUCUNE ROUTE DE SUPPRESSION N'EXISTE, ET IL NE DOIT JAMAIS EN EXISTER.
 * Un fournisseur est reference par des lots recus il y a deux ans dont la
 * tracabilite AFSCA doit rester lisible ; un produit figure dans des sessions
 * cloturees, qui sont des pieces comptables. On desactive (`PATCH …/activite`),
 * on ne supprime pas (CLAUDE.md §3 regle 7).
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  schemaChangementActivite,
  schemaListeFournisseurs,
  schemaListeIngredients,
  schemaListeProduits,
  schemaSaisieFournisseur,
  schemaSaisieProduit,
  type Fournisseur,
  type Produit,
} from '@batte/core';
import {
  changerActiviteFournisseur,
  changerActiviteProduit,
  creerFournisseur,
  creerProduit,
  listerFournisseurs,
  listerProduits,
  modifierFournisseur,
  modifierProduit,
  schema,
  type BaseBatte,
} from '@batte/db';
import { asc, eq } from 'drizzle-orm';

/**
 * Retrouve la ligne qu'on vient d'ecrire, pour la renvoyer a l'appelant.
 *
 * Une absence ici n'est PAS une faute de l'utilisateur : l'ecriture vient de
 * reussir dans une transaction commitee. C'est une incoherence interne, donc
 * une vraie 500 — jamais un 404, qui laisserait croire a une mauvaise saisie.
 */
function retrouver<T extends { id: string }>(lignes: T[], id: string, quoi: string): T {
  const ligne = lignes.find((l) => l.id === id);
  if (ligne === undefined) throw new Error(`${quoi} ${id} introuvable après écriture.`);
  return ligne;
}

export function routesReferentiel(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /* ═══ Fournisseurs ═══════════════════════════════════════════════════ */

    /**
     * Rend les fournisseurs ACTIFS ET INACTIFS.
     *
     * Comportement inchange depuis le Lot 2, et deliberement : les ecrans de
     * reception et d'achats consomment cette route, et un inactif doit rester
     * lisible parce qu'une reception passee le reference. C'est a l'ecran de
     * decider ce qu'il masque dans ses listes de choix.
     */
    app.get('/fournisseurs', async () => {
      const lignes: Fournisseur[] = listerFournisseurs(base);
      return schemaListeFournisseurs.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.post('/fournisseurs', async (requete, reponse) => {
      const saisie = schemaSaisieFournisseur.parse(requete.body);
      const id = creerFournisseur(base, saisie);

      reponse.code(201);
      return retrouver(listerFournisseurs(base), id, 'Fournisseur');
    });

    app.patch<{ Params: { id: string } }>('/fournisseurs/:id', async (requete) => {
      const saisie = schemaSaisieFournisseur.parse(requete.body);
      // Leve `ErreurIntrouvable` (404) si l'identifiant de l'URL n'existe pas.
      modifierFournisseur(base, requete.params.id, saisie);

      return retrouver(listerFournisseurs(base), requete.params.id, 'Fournisseur');
    });

    /** Desactivation / reactivation. Le remplacant de la suppression. */
    app.patch<{ Params: { id: string } }>('/fournisseurs/:id/activite', async (requete) => {
      const { actif } = schemaChangementActivite.parse(requete.body);
      changerActiviteFournisseur(base, requete.params.id, actif);

      return retrouver(listerFournisseurs(base), requete.params.id, 'Fournisseur');
    });

    /* ═══ Produits vendus ════════════════════════════════════════════════ */

    /**
     * Rend les produits ACTIFS ET INACTIFS, avec le libelle de leur
     * rattachement.
     *
     * Distincte de `GET /api/produits-vendables` (routes/sessions.ts), qui ne
     * rend que les actifs et sert a garnir la saisie de cloture. Les deux
     * coexistent : un ecran de referentiel doit montrer ce qui est retire de la
     * vente, un ecran de saisie ne le doit surtout pas.
     */
    app.get('/produits', async () => {
      const lignes: Produit[] = listerProduits(base);
      return schemaListeProduits.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.post('/produits', async (requete, reponse) => {
      const saisie = schemaSaisieProduit.parse(requete.body);
      const id = creerProduit(base, saisie);

      reponse.code(201);
      return retrouver(listerProduits(base), id, 'Produit');
    });

    app.patch<{ Params: { id: string } }>('/produits/:id', async (requete) => {
      const saisie = schemaSaisieProduit.parse(requete.body);
      modifierProduit(base, requete.params.id, saisie);

      return retrouver(listerProduits(base), requete.params.id, 'Produit');
    });

    /** Retrait de la vente / remise en vente. Le remplacant de la suppression. */
    app.patch<{ Params: { id: string } }>('/produits/:id/activite', async (requete) => {
      const { actif } = schemaChangementActivite.parse(requete.body);
      changerActiviteProduit(base, requete.params.id, actif);

      return retrouver(listerProduits(base), requete.params.id, 'Produit');
    });

    /* ═══ Ingredients (lecture seule) ════════════════════════════════════ */

    app.get('/ingredients', async () => {
      const lignes = base
        .select({
          id: schema.ingredient.id,
          nom: schema.ingredient.nom,
          categorie: schema.ingredient.categorie,
          unite: schema.ingredient.uniteReference,
          densiteGParMl: schema.ingredient.densiteGParMl,
          allergenes: schema.ingredient.allergenes,
          allergenesVerifies: schema.ingredient.allergenesVerifies,
          stockSecurite: schema.ingredient.stockSecurite,
          dureeConservationJours: schema.ingredient.dureeConservationJours,
        })
        .from(schema.ingredient)
        .where(eq(schema.ingredient.actif, true))
        .orderBy(asc(schema.ingredient.nom))
        .all();

      return schemaListeIngredients.parse({ data: lignes, meta: { total: lignes.length } });
    });
  };
}
