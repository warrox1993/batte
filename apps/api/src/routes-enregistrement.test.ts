/**
 * Garde structurelle : toute factory `routesXxx` exportée par un fichier de
 * `routes/*.ts` (hors tests) doit être IMPORTÉE et RÉELLEMENT APPELÉE dans
 * `serveur.ts` — le seul point d'entrée réel de l'application.
 *
 * ═══ Pourquoi ce test existe (01/08/2026) ═══
 *
 * `routes/palmares.ts` exportait `routesPalmares`, disposait de ses propres
 * tests HTTP (`palmares.test.ts`, sur une instance Fastify minimale montée à
 * la main — même geste que `demarrage.test.ts` avant lui) : chaque test
 * passait, la couverture semblait complète. Mais `serveur.ts` — le VRAI
 * point d'entrée — ne l'enregistrait pas : `GET /api/palmares/produits`
 * répondait donc 404 dans l'application réellement lancée, alors que la même
 * route répondait 200 dans sa suite de tests isolée.
 *
 * `smoke-routes-lecture.test.ts` balaye la table de routage RÉELLE de
 * `construireServeur` (hook `onRoute`) : une route jamais enregistrée y est
 * INVISIBLE PAR CONSTRUCTION, donc absente aussi bien de la liste dérivée que
 * des routes visitées — deux ensembles vides concordent, et le balayage
 * conclut au succès. C'est un « vert par absence » : aucun test existant ne
 * pouvait détecter ce défaut précis, parce qu'aucun ne comparait la liste des
 * routes ÉCRITES dans le dépôt à la liste des routes ENREGISTRÉES par le
 * serveur.
 *
 * ═══ Ce que ce test compare, et pourquoi c'est dérivé, pas énuméré ═══
 *
 * Deux listes, toutes deux lues depuis le code source, jamais une énumération
 * écrite à la main (la leçon de D-045, rappelée dans `smoke-routes-lecture.
 * test.ts`) :
 *  - la liste des factories `routesXxx` DÉCLARÉES : TOUTES celles de chaque
 *    fichier de `routes/*.ts` (hors `*.test.ts`), extraites par un motif sur la
 *    convention de nommage réellement suivie par les 27 fichiers de ce dossier.
 *    Chacun n'en exporte qu'une aujourd'hui (vérifié le 01/08/2026), mais
 *    l'extracteur ne s'appuie PAS sur cette régularité : il les prend toutes —
 *    voir la note sur `factoriesExporteesDe` plus bas ;
 *  - la liste des factories ENREGISTRÉES : celles dont le nom apparaît à la
 *    fois dans un import `from './routes/<fichier>.js'` ET dans un appel
 *    `routesXxx(` quelque part dans `serveur.ts`.
 *
 * Un plancher (`NB_MINIMUM_FACTORIES_ATTENDU`) protège le test lui-même : si
 * la convention de nommage changeait au point que le motif ne matche plus
 * rien, ce test ne doit pas passer VIDE et silencieusement — voir le même
 * raisonnement, appliqué au balayage de routes, dans `smoke-routes-lecture.
 * test.ts`.
 *
 * ═══ Ce que ce test N'EST PAS ═══
 *
 * Un test d'EXÉCUTION : il ne monte aucun serveur, n'ouvre aucune base. Une
 * simple lecture de texte source suffit à détecter le défaut réel rencontré
 * (import manquant, ou import présent mais jamais invoqué) — plus rapide et
 * plus direct qu'un `construireServeur` complet pour cette seule question.
 * `smoke-routes-lecture.test.ts` reste responsable de prouver que les routes
 * EFFECTIVEMENT enregistrées répondent sans 500 ; ce fichier est responsable
 * de prouver qu'aucune route écrite n'a été oubliée à l'enregistrement.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ICI = dirname(fileURLToPath(import.meta.url));
const DOSSIER_ROUTES = join(ICI, 'routes');
const CHEMIN_SERVEUR = join(ICI, 'serveur.ts');

/** Mesuré sur ce dépôt le 01/08/2026 (27 fichiers de route, palmares compris). */
const NB_MINIMUM_FACTORIES_ATTENDU = 25;

type FactoryDeclaree = {
  /** Nom de fichier, sans extension — sert à retrouver le chemin d'import attendu. */
  readonly base: string;
  /** Nom de la fonction exportée, ex. `routesPalmares`. */
  readonly nom: string;
};

/**
 * TOUS les noms de factory `routesXxx` exportés par un fichier de route.
 *
 * Rend un tableau, et pas le premier nom trouvé : l'audit de couverture du
 * 01/08/2026 (`docs/37-COUVERTURE-API-INTERFACE.md`) a relevé que la version
 * d'origine s'arrêtait à la PREMIÈRE déclaration de chaque fichier. Aucun
 * fichier n'en exporte deux aujourd'hui, donc le défaut ne se voyait pas — mais
 * le jour où l'un le ferait, la seconde factory serait invisible de cette garde
 * et pourrait n'être jamais enregistrée, exactement le défaut que ce fichier
 * existe pour empêcher. Une garde qui ne couvre qu'une partie de son domaine
 * est plus dangereuse que pas de garde du tout : elle est verte.
 */
export function factoriesExporteesDe(contenuFichier: string): readonly string[] {
  // `export function routesXxx(` — la parenthèse peut s'ouvrir sur une
  // signature multi-lignes (ex. `routesPrevisions`, `routesEvenementsDecouverte`) :
  // le motif n'exige que le début de la ligne de déclaration.
  return [...contenuFichier.matchAll(/export function (routes[A-Za-z]+)\(/g)].map(
    (trouve) => trouve[1] as string,
  );
}

function listerFactoriesDeclarees(): readonly FactoryDeclaree[] {
  const fichiers = readdirSync(DOSSIER_ROUTES).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );

  const factories: FactoryDeclaree[] = [];
  for (const fichier of fichiers) {
    const contenu = readFileSync(join(DOSSIER_ROUTES, fichier), 'utf8');
    for (const nom of factoriesExporteesDe(contenu)) {
      factories.push({ base: fichier.replace(/\.ts$/, ''), nom });
    }
  }
  return factories;
}

/** Une factory est enregistrée si `serveur.ts` l'importe depuis SON fichier ET l'appelle. */
function estEnregistreeDans(sourceServeur: string, factory: FactoryDeclaree): boolean {
  const estImportee = sourceServeur.includes(`from './routes/${factory.base}.js'`);
  const estAppelee = new RegExp(`\\b${factory.nom}\\(`).test(sourceServeur);
  return estImportee && estAppelee;
}

describe('serveur.ts enregistre toutes les routes déclarées sous routes/', () => {
  it('détecte au moins les factories connues (le motif de détection reste vivant)', () => {
    const factories = listerFactoriesDeclarees();
    expect(factories.length).toBeGreaterThanOrEqual(NB_MINIMUM_FACTORIES_ATTENDU);
  });

  it('chaque factory routesXxx déclarée est importée ET appelée dans serveur.ts', () => {
    const factories = listerFactoriesDeclarees();
    const sourceServeur = readFileSync(CHEMIN_SERVEUR, 'utf8');

    const manquantes = factories
      .filter((factory) => !estEnregistreeDans(sourceServeur, factory))
      .map((factory) => factory.nom);

    expect(manquantes).toEqual([]);
  });

  /**
   * La garde de la garde. Ce test ne regarde pas le dépôt : il donne à
   * l'extracteur une source SYNTHÉTIQUE portant deux factories, ce qu'aucun
   * fichier réel ne fait aujourd'hui. Sans lui, la limite corrigée ici serait
   * restée invisible aussi longtemps que la convention « une factory par
   * fichier » tiendrait — c'est-à-dire jusqu'au jour exact où elle compterait.
   */
  it('l’extracteur voit TOUTES les factories d’un fichier, pas seulement la première', () => {
    const sourceSynthetique = [
      "import type { FastifyInstance } from 'fastify';",
      'export function routesPremiere(app: FastifyInstance) {',
      "  app.get('/premiere', async () => ({ ok: true }));",
      '}',
      'export function routesSeconde(',
      '  app: FastifyInstance,',
      ') {',
      "  app.get('/seconde', async () => ({ ok: true }));",
      '}',
    ].join('\n');

    expect(factoriesExporteesDe(sourceSynthetique)).toEqual(['routesPremiere', 'routesSeconde']);
    // Un fichier sans factory rend un tableau vide, jamais `undefined` :
    // `listerFactoriesDeclarees` itère dessus sans garde supplémentaire.
    expect(factoriesExporteesDe('export const rien = 1;')).toEqual([]);
  });
});
