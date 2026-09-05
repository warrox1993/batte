/**
 * Detecte si un module est le point d'entree lance en ligne de commande.
 *
 * L'equivalent ESM de `require.main === module`. Necessaire parce que plusieurs
 * fichiers de `packages/db` sont a la fois importables (par l'API) et
 * executables (`npm run db:migrate`, `db:seed`) : sans ce test, l'import
 * declencherait l'execution.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function estModulePrincipal(urlModule: string): boolean {
  const argv = process.argv[1];
  if (argv === undefined) return false;
  try {
    return realpathSync(fileURLToPath(urlModule)) === realpathSync(argv);
  } catch {
    // Chemin inexistant (cas d'un runner qui passe un argv synthetique) :
    // on considere que le module n'est pas le point d'entree.
    return false;
  }
}
