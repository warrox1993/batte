/**
 * Ecran Parametres (docs/06) : liste complete, correction d'une valeur en
 * vigueur, et evolution datee d'un parametre.
 *
 * **Deux gestes, deux routes, et la distinction est metier, pas technique :**
 *
 *  - `PATCH /parametres/:id` — CORRIGER. La valeur saisie etait fausse, elle
 *    n'a jamais ete vraie : faute de frappe, capacite materielle mal relevee.
 *    On repare en place, et le journal d'audit garde l'ancienne valeur.
 *  - `POST /parametres/:cle/versions` — FAIRE EVOLUER. La valeur etait juste et
 *    change a partir d'une date : le seuil de franchise TVA qui bouge en 2027.
 *    Une NOUVELLE ligne datee est inseree, l'ancienne reste en base.
 *
 * Confondre les deux reecrirait retroactivement les sessions deja cloturees,
 * puisque `lireParametres(base, date)` resout les parametres a la date de la
 * piece. C'est exactement ce que D-004 / D-024 interdisent.
 *
 * Le versionnage n'etait atteignable ni par l'API ni par l'interface avant
 * cette route : `ajouterVersionParametre` existait dans le depot sans aucun
 * appelant HTTP. La promesse « parametrable » de CLAUDE.md §6 n'etait donc pas
 * tenue — changer un seuil imposait d'ouvrir le fichier SQLite a la main.
 *
 * Statuts (docs/06, « Conventions d'API ») : 404 quand la ressource ADRESSEE
 * DANS L'URL n'existe pas (un `:id` inconnu, une `:cle` hors catalogue), 422
 * avec `champs` quand une valeur SAISIE est invalide, pour que l'ecran sache
 * sur quel champ accrocher le message.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  ErreurIntrouvable,
  schemaCorrectionParametre,
  schemaListeParametres,
  schemaNouvelleVersionParametre,
  schemaParametre,
} from '@batte/core';
import {
  ajouterVersionParametre,
  corrigerParametre,
  listerParametres,
  type BaseBatte,
} from '@batte/db';

export function routesParametres(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /** Relit la ligne ecrite pour la renvoyer telle qu'elle est REELLEMENT en base. */
    const relire = (id: string) => listerParametres(base).find((ligne) => ligne.id === id);

    app.get('/parametres', async () => {
      const lignes = listerParametres(base);
      // La sortie est validee contre le contrat partage : si la table gagne une
      // colonne sans que `packages/core` suive, la route echoue ici plutot que
      // de livrer au client une forme qu'il ne sait pas lire.
      return schemaListeParametres.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.patch<{ Params: { id: string } }>('/parametres/:id', async (requete) => {
      const corps = schemaCorrectionParametre.parse(requete.body);
      const { id } = requete.params;

      if (relire(id) === undefined) {
        throw new ErreurIntrouvable('Paramètre', id);
      }

      // Le controle de type de la valeur (un `_cents` est un entier, un booleen
      // est un booleen) vit dans le depot, pas ici : c'est une regle metier
      // (CLAUDE.md §3 regle 1). Elle remonte en 422 avec le champ `valeur`.
      corrigerParametre(base, id, corps.valeur);

      const misAJour = relire(id);
      if (misAJour === undefined) {
        // Invariant du Lot 0 : aucune ligne ne s'efface jamais (CLAUDE.md §3,
        // regle n°7). Une ligne verifiee presente juste au-dessus ne peut pas
        // disparaitre entre les deux lectures.
        throw new Error(`Paramètre ${id} disparu entre la vérification et la mise à jour.`);
      }
      return schemaParametre.parse(misAJour);
    });

    app.post<{ Params: { cle: string } }>('/parametres/:cle/versions', async (requete, reponse) => {
      const corps = schemaNouvelleVersionParametre.parse(requete.body);
      const { cle } = requete.params;

      // Aucune verification de la cle ici : `ajouterVersionParametre` leve
      // deja `ErreurIntrouvable` (404) quand elle est absente du catalogue,
      // et refuse une date retroactive (422). Dupliquer ces gardes dans le
      // handler les ferait diverger le jour ou l'une des deux evoluerait.
      const id = ajouterVersionParametre(base, {
        cle,
        valeur: corps.valeur,
        dateDebutValidite: corps.dateDebutValidite,
        source: corps.source,
      });

      const cree = relire(id);
      if (cree === undefined) {
        throw new Error(`Version de « ${cle} » introuvable juste après son insertion.`);
      }

      reponse.status(201);
      return schemaParametre.parse(cree);
    });
  };
}
