/**
 * Diagnostic de configuration : quelle base est ouverte, et quelles cles du
 * catalogue de packages/core/src/parametres.ts manquent encore en base. Sert
 * de point de controle au parcours de premier lancement (docs/06).
 *
 * **Le statut est DEDUIT, il n'est plus affirme.** Il valait `'ok'` en dur, y
 * compris quand la base venait d'etre migree sans etre ensemencee — soit 49
 * parametres absents et la moitie des routes en 500. La seule sonde du premier
 * lancement rendait donc « tout va bien » au moment precis ou rien n'allait,
 * et le geste qui aurait sauve l'utilisateur n'etait ecrit nulle part.
 *
 * Un indicateur de sante qui ne peut pas virer au rouge n'est pas un
 * indicateur, c'est une decoration.
 */

import type { FastifyPluginAsync } from 'fastify';
import { lireParametres, sqliteBrut, type BaseBatte } from '@batte/db';

export function routesSante(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    app.get('/sante', async () => {
      const parametresManquants = lireParametres(base).clesManquantes();
      const complet = parametresManquants.length === 0;

      return {
        statut: complet ? ('ok' as const) : ('incomplet' as const),
        base: sqliteBrut(base).name,
        parametresManquants,
        /**
         * Le geste exact a faire, pas un diagnostic a interpreter. `null`
         * quand il n'y a rien a faire : un champ toujours rempli finit par ne
         * plus etre lu.
         */
        action: complet
          ? null
          : `${parametresManquants.length} paramètre(s) absent(s) de la base. ` +
            'Lancez « npm run db:seed » pour les créer depuis le catalogue.',
      };
    });
  };
}
