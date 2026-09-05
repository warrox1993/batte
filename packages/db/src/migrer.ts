/**
 * Application des migrations Drizzle.
 *
 * Appelee au demarrage de l'API : sur un poste local il n'y a personne pour
 * lancer une commande de migration avant d'ouvrir l'application. Les migrations
 * Drizzle sont idempotentes (table `__drizzle_migrations`), donc l'appel
 * systematique est sans risque.
 */

import { existsSync } from 'node:fs';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from './config.js';
import { creerBase, type BaseBatte } from './client.js';
import { estModulePrincipal } from './module-principal.js';

export function migrer(base: BaseBatte): void {
  if (!existsSync(config.dossierMigrations)) {
    throw new Error(
      `Dossier de migrations introuvable : ${config.dossierMigrations}. ` +
        'Lancez `npm run db:generate` pour le produire.',
    );
  }
  migrate(base, { migrationsFolder: config.dossierMigrations });
}

// Execution directe uniquement (`npm run db:migrate`), jamais a l'import.
if (estModulePrincipal(import.meta.url)) {
  const base = creerBase();
  migrer(base);
  console.log(`Migrations appliquées sur ${config.cheminBase}`);
}
