/**
 * Contrats HTTP partages entre `apps/api` et `apps/web`.
 *
 * Un fichier par groupe de routes, en miroir de `apps/api/src/routes/`. C'est
 * l'unique endroit ou la forme d'une reponse est decrite : le serveur valide sa
 * sortie contre ces schemas, le client en derive ses types.
 */

export * from './afsca.js';
export * from './audit.js';
export * from './commandes.js';
export * from './comptabilite.js';
export * from './demarrage.js';
export * from './concurrents.js';
export * from './evenements-decouverte.js';
export * from './economies.js';
export * from './energie.js';
export * from './factures.js';
export * from './lieux.js';
export * from './nomenclature-vente.js';
export * from './ia.js';
export * from './menus.js';
export * from './objectifs.js';
export * from './opportunites.js';
export * from './palmares.js';
export * from './parametres.js';
export * from './parametres-versions.js';
export * from './previsions.js';
export * from './productions.js';
export * from './recettes.js';
export * from './referentiel.js';
export * from './sessions.js';
export * from './stock.js';
