/**
 * Point d'entree de la logique metier pure.
 *
 * Regle d'architecture n°1 (CLAUDE.md §3) : tout calcul chiffre vit ici, en
 * fonctions pures et testees. Aucun import de `better-sqlite3`, de `fastify`
 * ni de `react` ne doit jamais apparaitre dans ce paquet.
 */

export * from './affichage.js';
export * from './argent.js';
export * from './comptabilite.js';
export * from './contrats/index.js';
export * from './deplacement.js';
export * from './point-depart.js';
export * from './energie.js';
export * from './erreurs.js';
export * from './evenements-decouverte.js';
export * from './factures.js';
export * from './fournisseurs.js';
export * from './nomenclature-vente.js';
export * from './horodatage.js';
export * from './ia.js';
export * from './identifiants.js';
export * from './motifs.js';
export * from './menus.js';
export * from './objectifs.js';
export * from './opportunites.js';
export * from './palmares.js';
export * from './succes.js';
export * from './parametres.js';
export * from './prevision/index.js';
export * from './production.js';
export * from './reapprovisionnement.js';
export * from './economies.js';
export * from './recettes.js';
// Recherche tolerante (accents, casse, ligature oe) + catalogue de synonymes :
// sans elle, chercher « cassonade » ne trouvait pas « vergeoise » et l'on creait
// un DOUBLON de stock, avec deux points de commande et une tracabilite coupee.
export * from './recherche-ingredients.js';
export * from './sessions.js';
export * from './stock.js';
export * from './unites.js';
