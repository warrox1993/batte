import { defineConfig } from 'drizzle-kit';

// Les chemins sont relatifs a la racine du depot : drizzle-kit est lance depuis
// la racine (`npm run db:generate`), pas depuis packages/db.
export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/db/src/schema.ts',
  out: './packages/db/drizzle',
  dbCredentials: {
    url: process.env['CHEMIN_BASE'] ?? './donnees/batte.sqlite',
  },
  // Un seul utilisateur, aucune migration concurrente : le mode strict
  // interactif n'apporte rien et bloquerait un script non interactif.
  verbose: true,
  strict: false,
});
