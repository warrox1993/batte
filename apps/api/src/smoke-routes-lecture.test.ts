/**
 * SMOKE TEST DE DEMARRAGE — balayage de TOUTES les routes de lecture (`GET`)
 * sur une base fraichement migree.
 *
 * POURQUOI CE FICHIER EXISTE (30/07/2026). Le porteur va, ce matin meme,
 * arreter son serveur, lancer `npm run db:migrate` (migrations 0024 et 0025),
 * puis redemarrer — pour exposer une trentaine de routes nouvelles que son
 * serveur, demarre AVANT ces migrations, n'expose pas encore. Le defaut precis
 * que ce fichier existe pour prevenir : une colonne ajoutee au schema sans que
 * le code qui la lit soit pret (ou l'inverse) donne une porte de sortie
 * entierement verte en developpement — parce que la base de dev est deja
 * migree — et un `no such column` **sur base fraiche**, c'est-a-dire chez
 * l'utilisateur, un dimanche de marche.
 *
 * CE QUE CE FICHIER PROUVE, ET COMMENT (D-045) :
 *
 *  1. Deux bases 100 % fraiches sont construites ici meme, en memoire :
 *       - PASSE 1 : `creerBase(':memory:')` + `migrer()` + `seed()` — c'est
 *         EXACTEMENT le referentiel legal/technique qu'un premier lancement
 *         reel possede (parametres, motifs, taches AFSCA, fournisseur
 *         systeme, echeancier). Aucune donnee de demonstration.
 *       - PASSE 2 : la meme base, PUIS `seedDemonstration()` ET
 *         `seedDemonstrationActivite()` — les DEUX fonctions que
 *         `npm run db:seed:demo` execute (voir le bloc `estModulePrincipal`
 *         de `packages/db/src/seed/demonstration.ts`). Sans la seconde,
 *         aucune session n'est CLOTUREE, aucune production n'existe, aucun
 *         lot n'existe — or ce sont exactement les compteurs et jointures
 *         qui cassent sur des DONNEES REELLES et jamais sur du vide (une
 *         division par un compteur de sessions, un tri sur une marge nulle,
 *         un `.slice()` sur un champ absent).
 *     Jamais `donnees/batte.sqlite`, jamais `creerContexte()` (qui ecrirait
 *     une vraie sauvegarde sur le poste) : uniquement des bases en memoire,
 *     construites ici.
 *
 *  2. Le serveur complet est monte via `construireServeur`, la MEME fonction
 *     que `serveur.ts` appelle au demarrage reel — aucune route n'est
 *     recopiee a la main.
 *
 *  3. La liste des routes `GET` est DERIVEE de la table de routage REELLE de
 *     Fastify, via le hook `onRoute` (voir `poserCaptureDeRoutes` ci-dessous)
 *     — jamais d'une enumeration ecrite a la main. C'est la legon de D-045 :
 *     un balayage anti-fuite qui listait ses routes de memoire avait laisse
 *     quatre routes de lecture jamais verifiees, dont `/api/recettes`.
 *
 *     Le hook est pose sur l'instance APRES l'appel a `construireServeur`
 *     (qui a deja appele tous ses `api.register(...)`) mais AVANT
 *     `app.ready()`. Ce n'est pas un probleme : Fastify (moteur `avvio`) ne
 *     RESOUT les plugins enregistres — y compris les sous-plugins imbriques
 *     sous le prefixe `/api` — qu'au moment de `ready()`/`listen()`, jamais a
 *     l'appel synchrone de `register()`. Le hook voit donc bien TOUTES les
 *     routes, y compris celles de chaque sous-module. Verifie
 *     experimentalement avant d'ecrire ce fichier (voir le rapport de
 *     livraison) avec un plugin imbrique reproduisant exactement la structure
 *     de `serveur.ts` : les six routes du plugin de demonstration apparaissent
 *     toutes dans la capture, prefixees.
 *
 *  4. Le nombre de routes balayees est AFFIRME, pas seulement compte : les
 *     tests comparent la liste effectivement visitee a la liste `GET` extraite
 *     de la table de routage au moment du test (jamais un nombre invente), ET
 *     exigent un PLANCHER absolu (`PLANCHER_ROUTES_GET`, mesure sur ce
 *     depot le 30/07/2026 — voir sa justification). Sans ce plancher, un
 *     module entier qui cesserait de s'enregistrer (un `await
 *     api.register(...)` supprime par erreur dans `serveur.ts`) ferait
 *     simplement RETRECIR la liste derivee, et « toutes les routes derivees
 *     ont ete visitees » resterait vrai sur un ensemble plus petit — un
 *     balayage vert qui ne prouverait plus rien.
 *
 *  5. Routes PARAMETREES (`/api/recettes/:id`) : DEUX appels, jamais un seul.
 *       - un identifiant INEXISTANT (`IDENTIFIANT_INEXISTANT`) : la route ne
 *         doit JAMAIS rendre 500 (404 ou 422 sont des reponses legitimes) ;
 *       - un identifiant REEL, resolu EN DIRECT depuis la base du test par un
 *         resolveur dedie a CETTE route precise (`RESOLVEURS_PAR_ROUTE`) :
 *         200 attendu.
 *     Un resolveur est explicite PAR GABARIT DE ROUTE et non par nom de
 *     parametre : `:id` ne designe pas la meme entite selon la route (une
 *     recette ici, une session la, un lot ailleurs) — une correspondance par
 *     nom serait fausse. Si aucun resolveur n'est enregistre pour une route
 *     paramétree rencontree, ou si le resolveur ne trouve rien sur CETTE
 *     base, la route n'est JAMAIS sautee en silence : elle est quand meme
 *     appelee avec l'identifiant inexistant (jamais 500), et signalee dans
 *     les tableaux `sansResolveurConnu` / `sansIdentifiantReel` que le
 *     dernier test du fichier imprime explicitement.
 *
 * CE QUE CE FICHIER N'EST PAS : un test de CONTENU. Il ne verifie aucune
 * valeur metier, uniquement l'absence de 500 et — pour les identifiants
 * reels — un 200. `serveur.test.ts` et les tests par route couvrent deja le
 * contenu ; ce fichier couvre la SURFACE.
 */

import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { eq, ne } from 'drizzle-orm';
import {
  commandeFournisseur,
  concurrent,
  creerBase,
  factureFournisseur,
  fournisseur,
  ingredient,
  lot,
  menuComposition,
  migrer,
  production,
  produitVente,
  recette,
  seed,
  seedDemonstration,
  seedDemonstrationActivite,
  sessionMarche,
  type BaseBatte,
} from '@batte/db';
import { construireServeur } from './serveur.js';
import { fermerNavigateur } from './documents/rendu.js';

// Plusieurs routes rendent un PDF (Playwright/Chromium) ou un classeur Excel :
// le demarrage de Chromium n'est pas a duree fixe (voir la note identique dans
// `apps/api/src/routes/documents.test.ts` et `documents/rendu.test.ts` — le
// timeout par defaut de Vitest, 5 s, a deja ete mesure trop court sur ce
// depot). Le budget ci-dessous couvre les deux passes completes, PDF compris.
//
// `hookTimeout` (defaut Vitest : 10 s) a ete AJOUTE ici le 31/07/2026, apres
// diagnostic d'un 500 intermittent sur `/api/documents/affichette-allergenes`
// visible uniquement en suite complete (jamais fichier seul). Preuve : le
// `afterAll` ci-dessous ferme Chromium (`fermerNavigateur`), et sur une
// execution complete de la suite (~180 fichiers, dont 5 lancent Chromium :
// `rendu.test.ts`, `audit-documents.test.ts`, `table-impression-largeur.test.ts`,
// `integration.test.ts`, celui-ci), cette fermeture peut legitimement depasser
// 10 s sous la contention reelle de plusieurs instances Chromium simultanees —
// mesure directement : « Hook timed out in 10000ms » sur CE `afterAll` lors
// d'une execution complete (voir le rapport de livraison). Seul `testTimeout`
// etait couvert ici ; `hookTimeout` ne l'etait pas et reste, sans cette ligne,
// au defaut de 10 s.
//
// `/api/prevision` et `/api/prevision/brief` NE tentent PLUS de vrai appel
// reseau Open-Meteo depuis ce fichier — voir `demarrerServeurMeteoLocal`
// ci-dessous : avant ce detournement, la passe demonstration (seule a poser
// une session planifiee) declenchait un vrai appel qui se degradait en 8 s au
// plus des que le reseau etait absent, a chaque execution.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** UUID syntaxiquement valide mais qui n'existe dans AUCUNE base construite ici. */
const IDENTIFIANT_INEXISTANT = '00000000-0000-4000-8000-000000000000';

/* ═══════════════════════════════════════════════════════════════════════════
   Detournement du reseau meteo — aucun appel reel a Open-Meteo pendant ce
   balayage (CLAUDE.md — « un test qui depend du reseau n'est pas un test »).

   Ce fichier appelle TOUTES les routes GET de l'application, dont
   `/api/prevision` et `/api/prevision/brief` : la passe demonstration
   (seedDemonstration + seedDemonstrationActivite) pose une session PLANIFIEE
   dont aucune meteo n'est encore en cache, exactement la condition qui
   declenche `releverMeteo` (`apps/api/src/meteo/open-meteo.ts`) vers le vrai
   `https://api.open-meteo.com`.
   `construireServeur` accepte desormais `{ racineUrlMeteo }` (voir sa doc dans
   `apps/api/src/serveur.ts`) : les deux passes ci-dessous la pointent vers un
   serveur `node:http` local qui IMITE la FORME d'une reponse Open-Meteo — le
   serveur echoue `start_date` dans la reponse pour rester valable quelle que
   soit la session/date rencontree, sans avoir a la connaitre a l'avance.
   Omis, ce parametre vaudrait `undefined` et `releverMeteo` retomberait sur la
   vraie racine — exactement le comportement de PRODUCTION (`serveur.ts`
   appelle `construireServeur(base)` sans ce champ).

   Preuve retenue, plus stricte qu'un simple « le test est rapide » : un
   espion pose sur `globalThis.fetch` (`vi.spyOn`, qui laisse TOUJOURS partir
   l'appel reel — ce n'est PAS un bouchon du reseau, seulement une observation
   de ce qui part) enregistre CHAQUE URL appelee pendant TOUT le fichier
   (les deux passes), et le dernier test ci-dessous verifie qu'AUCUNE ne
   contient `open-meteo.com`. Un bouchon global aurait masque un vrai defaut
   d'appel (mauvaise URL, mauvais parametres) ; cet espion, lui, laisse la
   requete reelle partir vers le serveur local et ne fait que constater sa
   destination — meme recette que `apps/api/src/routes/previsions.test.ts`,
   `apps/api/src/meteo/open-meteo.test.ts` et `apps/api/src/ia/client.test.ts`.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Sert une reponse Open-Meteo VALIDE pour la date demandee (`start_date`), quelle qu'elle soit — jamais le vrai service. */
function demarrerServeurMeteoLocal(): Promise<{ url: string; fermer: () => Promise<void> }> {
  return new Promise((resolve) => {
    const serveur: Server = createServer((requete, reponse) => {
      requete.on('data', () => {});
      requete.on('end', () => {
        const url = new URL(requete.url ?? '/', 'http://127.0.0.1');
        // `releverMeteo` interroge toujours la MEME fenetre (start_date ===
        // end_date) : echouer ce seul parametre suffit a couvrir n'importe
        // quelle session rencontree par l'une ou l'autre passe, sans avoir a
        // connaitre sa date a l'avance (elle depend du jour de marche du lieu
        // de demonstration et de la date d'execution du test).
        const date = url.searchParams.get('start_date') ?? '2026-01-01';
        const heures = Array.from(
          { length: 24 },
          (_, h) => `${date}T${String(h).padStart(2, '0')}:00`,
        );
        const remplir = (valeur: number): number[] => heures.map(() => valeur);
        reponse.writeHead(200, { 'content-type': 'application/json' });
        reponse.end(
          JSON.stringify({
            hourly: {
              time: heures,
              temperature_2m: remplir(15),
              precipitation: remplir(0),
              wind_speed_10m: remplir(10),
              cloud_cover: remplir(50),
              apparent_temperature: remplir(13.5),
              precipitation_probability: remplir(42),
              weather_code: remplir(3),
            },
            hourly_units: {
              temperature_2m: '°C',
              apparent_temperature: '°C',
              precipitation: 'mm',
              precipitation_probability: '%',
              wind_speed_10m: 'km/h',
              cloud_cover: '%',
              weather_code: 'wmo code',
            },
          }),
        );
      });
    });
    serveur.listen(0, '127.0.0.1', () => {
      const adresse = serveur.address();
      const port = typeof adresse === 'object' && adresse !== null ? adresse.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        fermer: () => new Promise<void>((resoudre) => serveur.close(() => resoudre())),
      });
    });
  });
}

/**
 * Hooks de PORTEE FICHIER (declares hors de tout `describe`) : ils encadrent
 * les deux passes ci-dessous ET le test de preuve final, dans l'ordre de
 * declaration — voir la note de fermeture en bas de fichier.
 */
let serveurMeteo: { url: string; fermer: () => Promise<void> };
let espionFetch: MockInstance<typeof fetch>;

beforeAll(async () => {
  serveurMeteo = await demarrerServeurMeteoLocal();
  espionFetch = vi.spyOn(globalThis, 'fetch');
});

afterAll(async () => {
  espionFetch.mockRestore();
  await serveurMeteo.fermer();
});

/**
 * Plancher mesure le 30/07/2026 en executant CE fichier sur ce depot : la
 * table de routage reelle (le hook `onRoute` ci-dessous, pas une lecture du
 * code source) exposait alors 85 gabarits `GET`. Ce n'est pas un nombre
 * invente pour faire joli : c'est la valeur EN DESSOUS de laquelle un module
 * entier a cesse de s'enregistrer (un `await api.register(...)` disparu de
 * `serveur.ts`, par exemple). La marge sous 85 tolere l'ajout ou la fusion de
 * quelques routes sans faire echouer ce garde-fou pour rien ; en dessous, un
 * module a disparu de l'enregistrement. A RELEVER quand des routes GET sont
 * ajoutees en nombre — le test qui l'utilise nomme le chiffre attendu dans
 * son propre message d'echec.
 */
const PLANCHER_ROUTES_GET = 80;

type RouteCapturee = { readonly methode: string; readonly url: string };

/**
 * Pose le hook `onRoute` puis rend le tableau qu'il remplit au fil de
 * `app.ready()`. Seule facon documentee par Fastify d'observer la table de
 * routage REELLE sans dependre du format texte de `printRoutes()` — voir
 * l'en-tete de ce fichier pour la verification experimentale de l'ordre
 * pose-avant-ready.
 */
function poserCaptureDeRoutes(app: FastifyInstance): RouteCapturee[] {
  const routes: RouteCapturee[] = [];
  app.addHook('onRoute', (options) => {
    const methodes = Array.isArray(options.method) ? options.method : [options.method];
    for (const methode of methodes) {
      routes.push({ methode, url: options.url });
    }
  });
  return routes;
}

/**
 * DIAGNOSTIC (defaut intermittent du 31/07/2026 sur `/documents/affichette-allergenes`,
 * 500 un run sur deux) : `construireServeur(base, { journaliser: false, ... })` — ce que
 * CE fichier fait sur les deux passes — donne un logger Fastify no-op. Le
 * `app.log.error(erreur)` du gestionnaire d'erreurs (`plugins/erreurs.ts`) part alors
 * dans le vide : un 500 mesure ici ne dit jamais QUOI a echoue, seulement QUE ca a
 * echoue.
 *
 * Le hook `onError` (docs Fastify : « This hook will be executed before the Custom
 * Error Handler set by setErrorHandler ») recoit l'erreur BRUTE, avant que le
 * gestionnaire ne la transforme en reponse generique 500 — et il est cumulable
 * avec `setErrorHandler`, contrairement a `onRoute`/`setNotFoundHandler`. Poser ce
 * hook ici, cote test, ne change AUCUN comportement de production : aucune reponse,
 * aucun en-tete, aucun journal n'est modifie ; on observe seulement, en plus.
 */
type ErreurCapturee = { readonly methode: string; readonly url: string; readonly detail: string };

function poserCaptureDErreurs(app: FastifyInstance): ErreurCapturee[] {
  const erreurs: ErreurCapturee[] = [];
  app.addHook('onError', async (requete, _reponse, erreur) => {
    const pile = erreur instanceof Error ? (erreur.stack ?? erreur.message) : String(erreur);
    erreurs.push({ methode: requete.method, url: requete.url, detail: pile });
  });
  return erreurs;
}

/** Gabarits `GET` uniques (Fastify ajoute automatiquement un `HEAD` par `GET` : on ne le compte pas deux fois). */
function gabaritsGet(routes: readonly RouteCapturee[]): string[] {
  return [...new Set(routes.filter((r) => r.methode === 'GET').map((r) => r.url))].sort();
}

function estParametree(gabarit: string): boolean {
  return gabarit.includes(':');
}

/** Remplace CHAQUE segment `:xxx` du gabarit par la meme valeur (aucune route de ce depot n'a deux parametres distincts — verifie a l'ecriture de ce fichier). */
function resoudreUrl(gabarit: string, valeur: string): string {
  return gabarit.replace(/:[a-zA-Z]+/g, valeur);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Resolveurs d'identifiants REELS — un par gabarit de route, jamais par nom
   de parametre (voir l'en-tete). Chacun lit directement la base du test.
   ═══════════════════════════════════════════════════════════════════════════ */

type Resolveur = (base: BaseBatte) => string | null;

const idRecette: Resolveur = (base) =>
  base.select({ id: recette.id }).from(recette).limit(1).get()?.id ?? null;

const idProduitVenteQuelconque: Resolveur = (base) =>
  base.select({ id: produitVente.id }).from(produitVente).limit(1).get()?.id ?? null;

/** Prefere un produit TRANSFORME (rattache a une recette) : exerce le calcul de cout matiere, pas seulement le cas revendu. */
const idProduitVenteTransforme: Resolveur = (base) => {
  const transforme = base
    .select({ id: produitVente.id })
    .from(produitVente)
    .where(eq(produitVente.nature, 'transforme'))
    .limit(1)
    .get();
  return transforme?.id ?? idProduitVenteQuelconque(base);
};

/** Prefere un ingredient qui possede reellement des LOTS : exerce le filtrage/mappage de `/stock/:ingredientId/lots`, pas seulement la liste vide legitime. */
const idIngredientAvecLot: Resolveur = (base) => {
  const avecLot = base
    .select({ id: ingredient.id })
    .from(ingredient)
    .innerJoin(lot, eq(lot.ingredientId, ingredient.id))
    .limit(1)
    .get();
  if (avecLot !== undefined) return avecLot.id;
  return base.select({ id: ingredient.id }).from(ingredient).limit(1).get()?.id ?? null;
};

const idFournisseurQuelconque: Resolveur = (base) =>
  base.select({ id: fournisseur.id }).from(fournisseur).limit(1).get()?.id ?? null;

const idLotQuelconque: Resolveur = (base) =>
  base.select({ id: lot.id }).from(lot).limit(1).get()?.id ?? null;

const idConcurrentQuelconque: Resolveur = (base) =>
  base.select({ id: concurrent.id }).from(concurrent).limit(1).get()?.id ?? null;

const idSessionQuelconque: Resolveur = (base) =>
  base.select({ id: sessionMarche.id }).from(sessionMarche).limit(1).get()?.id ?? null;

/** Requise par `/documents/rapport-session/:id` et utile pour `/afsca/tracabilite/sessions/:id` : une session PLANIFIEE y rendrait 422 (« pas encore cloturee »), jamais un test du chemin nominal. */
const idSessionCloturee: Resolveur = (base) =>
  base
    .select({ id: sessionMarche.id })
    .from(sessionMarche)
    .where(eq(sessionMarche.statut, 'cloturee'))
    .limit(1)
    .get()?.id ?? null;

/** Requise par `/documents/etiquette-bac/:id` : une production ANNULEE y rendrait 422 (garde-fou D-035 volontaire), jamais le chemin nominal. */
const idProductionNonAnnulee: Resolveur = (base) =>
  base
    .select({ id: production.id })
    .from(production)
    .where(ne(production.statut, 'annulee'))
    .limit(1)
    .get()?.id ?? null;

/** `seedDemonstration()` ne cree aucune composition de menu : rendra `null` sur les deux passes de ce fichier, et c'est le rapport de livraison qui le dit, pas un saut silencieux. */
const idMenuQuelconque: Resolveur = (base) =>
  base.select({ id: menuComposition.menuId }).from(menuComposition).limit(1).get()?.id ?? null;

/** Ni `seed()` ni `seedDemonstration()` ne creent de commande fournisseur : `null` attendu sur les deux passes. */
const idCommandeQuelconque: Resolveur = (base) =>
  base.select({ id: commandeFournisseur.id }).from(commandeFournisseur).limit(1).get()?.id ?? null;

/** Ni `seed()` ni `seedDemonstration()` ne creent de facture : `null` attendu sur les deux passes. */
const idFactureQuelconque: Resolveur = (base) =>
  base.select({ id: factureFournisseur.id }).from(factureFournisseur).limit(1).get()?.id ?? null;

/**
 * Un resolveur PAR GABARIT DE ROUTE PARAMETREE reellement enregistre dans
 * `apps/api/src/routes/*.ts` au 30/07/2026 (afsca, commandes, concurrents,
 * documents, factures, menus, nomenclature-vente, productions, recettes,
 * sessions, stock). Une route paramétree absente de cette table n'est jamais
 * sautee : voir `balayerRoutes` ci-dessous, qui la signale explicitement dans
 * `sansResolveurConnu` au lieu de la passer sous silence.
 */
// Cles PREFIXEES `/api` : c'est sous ce prefixe que `construireServeur`
// enregistre tout (`serveur.ts`, `app.register(..., { prefix: '/api' })`), et
// donc ce que `onRoute` capture reellement dans `options.url` (verifie a
// l'ecriture de ce fichier — une premiere version de cette table, sans le
// prefixe, ne correspondait JAMAIS a un gabarit capture : chaque route
// paramétree tombait en silence dans `sansResolveurConnu`, et aucune n'etait
// jamais appelee avec un identifiant reel malgre le 200 vise. Voir le rapport
// de livraison).
const RESOLVEURS_PAR_ROUTE: Readonly<Record<string, Resolveur>> = {
  '/api/afsca/tracabilite/sessions/:id': idSessionQuelconque,
  '/api/afsca/tracabilite/lots/:id': idLotQuelconque,
  '/api/commandes/:id': idCommandeQuelconque,
  '/api/commandes/:id/pdf': idCommandeQuelconque,
  '/api/concurrents/:id': idConcurrentQuelconque,
  '/api/documents/fiche-technique/:id': idRecette,
  '/api/documents/etiquette-bac/:id': idProductionNonAnnulee,
  '/api/documents/rapport-session/:id': idSessionCloturee,
  '/api/factures/receptions-eligibles/:fournisseurId': idFournisseurQuelconque,
  '/api/factures/:id': idFactureQuelconque,
  '/api/menus/:menuId/composition': idMenuQuelconque,
  '/api/produits/:produitVenteId/composants': idProduitVenteQuelconque,
  '/api/productions/:id': idProductionNonAnnulee,
  '/api/recettes/:id': idRecette,
  '/api/produits/:id/cout-revient': idProduitVenteTransforme,
  '/api/sessions/:id': idSessionQuelconque,
  '/api/stock/:ingredientId/lots': idIngredientAvecLot,
  '/api/lots/:lotId': idLotQuelconque,
  '/api/lots/:lotId/mouvements': idLotQuelconque,
};

/* ═══════════════════════════════════════════════════════════════════════════
   Balayage
   ═══════════════════════════════════════════════════════════════════════════ */

type ResultatBalayage = {
  /** Chaque gabarit `GET` de la table de routage a ete appele au moins une fois. */
  readonly visitees: ReadonlySet<string>;
  /** Routes paramétrees rencontrees SANS resolveur enregistre dans `RESOLVEURS_PAR_ROUTE`. */
  readonly sansResolveurConnu: readonly string[];
  /** Routes paramétrees AVEC resolveur, mais dont cette base precise ne permet de resoudre aucun identifiant reel. */
  readonly sansIdentifiantReel: readonly string[];
};

/**
 * Appelle CHAQUE gabarit `GET` de `gabarits` :
 *   - route simple -> un seul appel, jamais 500 ;
 *   - route paramétree -> un appel avec `IDENTIFIANT_INEXISTANT` (jamais 500),
 *     puis, si un identifiant reel est resoluble sur `base`, un second appel
 *     avec cet identifiant (200 exige).
 *
 * N'ASSOUPLIT JAMAIS l'assertion « jamais 500 » : une route qui y echoue fait
 * echouer le test appelant (l'`expect` en cause interrompt la boucle), avec
 * l'URL exacte de la requete fautive dans le message.
 */
/**
 * Message d'echec enrichi du DETAIL reellement capture par `poserCaptureDErreurs`
 * pour cette URL precise (le dernier en date : un seul appel `inject` est en vol
 * a la fois dans cette boucle sequentielle, donc aucune ambiguite possible entre
 * deux requetes).
 */
function messageEchec(
  url: string,
  statut: number,
  erreursCapturees: readonly ErreurCapturee[],
): string {
  const correspondante = [...erreursCapturees].reverse().find((e) => e.url === url);
  const detail =
    correspondante === undefined ? '(aucune erreur capturee par onError)' : correspondante.detail;
  return `GET ${url} -> ${statut}\n${detail}`;
}

async function balayerRoutes(
  app: FastifyInstance,
  base: BaseBatte,
  gabarits: readonly string[],
  erreursCapturees: readonly ErreurCapturee[],
): Promise<ResultatBalayage> {
  const visitees = new Set<string>();
  const sansResolveurConnu: string[] = [];
  const sansIdentifiantReel: string[] = [];

  for (const gabarit of gabarits) {
    if (!estParametree(gabarit)) {
      const reponse = await app.inject({ method: 'GET', url: gabarit });
      expect(
        reponse.statusCode,
        messageEchec(gabarit, reponse.statusCode, erreursCapturees),
      ).toBeLessThan(500);
      visitees.add(gabarit);
      continue;
    }

    const urlInexistante = resoudreUrl(gabarit, IDENTIFIANT_INEXISTANT);
    const reponseInexistante = await app.inject({ method: 'GET', url: urlInexistante });
    expect(
      reponseInexistante.statusCode,
      messageEchec(urlInexistante, reponseInexistante.statusCode, erreursCapturees),
    ).toBeLessThan(500);
    visitees.add(gabarit);

    const resolveur = RESOLVEURS_PAR_ROUTE[gabarit];
    if (resolveur === undefined) {
      sansResolveurConnu.push(gabarit);
      continue;
    }

    const identifiantReel = resolveur(base);
    if (identifiantReel === null) {
      sansIdentifiantReel.push(gabarit);
      continue;
    }

    const urlReelle = resoudreUrl(gabarit, identifiantReel);
    const reponseReelle = await app.inject({ method: 'GET', url: urlReelle });
    expect(
      reponseReelle.statusCode,
      `(identifiant reel ${identifiantReel}) ${messageEchec(urlReelle, reponseReelle.statusCode, erreursCapturees)}`,
    ).toBe(200);
  }

  return { visitees, sansResolveurConnu, sansIdentifiantReel };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Passe 1 — base vierge migree + seed() SEUL (referentiel legal, sans demonstration)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('smoke test — base vierge migree + seed() (chemin exact du redemarrage du porteur)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let routesCapturees: RouteCapturee[];
  let erreursCapturees: ErreurCapturee[];

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    // `racineUrlMeteo` : voir le bloc « Detournement du reseau meteo »
    // ci-dessus. Sans session planifiee sur cette passe, `/api/prevision`
    // rend 404 avant meme de consulter la meteo — mais la passer ici aussi
    // rend cette garantie independante du contenu du seed, pas seulement du
    // cas actuellement observe.
    app = construireServeur(base, { journaliser: false, racineUrlMeteo: serveurMeteo.url });
    routesCapturees = poserCaptureDeRoutes(app);
    erreursCapturees = poserCaptureDErreurs(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await fermerNavigateur();
  });

  it(`la table de routage Fastify expose au moins ${PLANCHER_ROUTES_GET} routes GET`, () => {
    expect(gabaritsGet(routesCapturees).length).toBeGreaterThanOrEqual(PLANCHER_ROUTES_GET);
  });

  it('aucune route GET ne rend 500 sur une base seedee mais VIDE de demonstration', async () => {
    const gabarits = gabaritsGet(routesCapturees);
    const resultat = await balayerRoutes(app, base, gabarits, erreursCapturees);

    // La liste EFFECTIVEMENT visitee doit correspondre EXACTEMENT a la liste
    // derivee de la table de routage au moment du test : pas un nombre fige,
    // une comparaison structurelle qui echoue des qu'une route existe et n'a
    // pas ete appelee.
    expect([...resultat.visitees].sort()).toEqual(gabarits);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Passe 2 — base vierge migree + seed() + demonstration COMPLETE
   (referentiel de demonstration ET historique d'exploitation — les DEUX
   fonctions que `npm run db:seed:demo` execute)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('smoke test — base vierge migree + seed() + demonstration complete (npm run db:seed:demo)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let routesCapturees: RouteCapturee[];
  let erreursCapturees: ErreurCapturee[];

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    // Les DEUX : `seedDemonstration()` seul ne cree que le referentiel
    // (fournisseurs, ingredients, recettes, produits, lieu, prochaine
    // session) — sans `seedDemonstrationActivite()`, aucune session n'est
    // CLOTUREE, aucune production ni aucun lot n'existe, et ce sont
    // exactement les jointures et compteurs qui cassent sur des donnees
    // REELLES (une division par un nombre de sessions, un tri sur une marge
    // nulle) qui resteraient alors non testes. C'est exactement ce que fait
    // `npm run db:seed:demo` (voir le bloc `estModulePrincipal` de
    // `packages/db/src/seed/demonstration.ts`).
    seedDemonstration(base);
    seedDemonstrationActivite(base);

    // `racineUrlMeteo` : cette passe pose la session PLANIFIEE (seed de
    // demonstration) qui declenchait le vrai appel reseau — voir le bloc
    // « Detournement du reseau meteo » en tete de fichier.
    app = construireServeur(base, { journaliser: false, racineUrlMeteo: serveurMeteo.url });
    routesCapturees = poserCaptureDeRoutes(app);
    erreursCapturees = poserCaptureDErreurs(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await fermerNavigateur();
  });

  it(`la table de routage Fastify expose au moins ${PLANCHER_ROUTES_GET} routes GET`, () => {
    expect(gabaritsGet(routesCapturees).length).toBeGreaterThanOrEqual(PLANCHER_ROUTES_GET);
  });

  it('aucune route GET ne rend 500 sur une base peuplee par la demonstration complete', async () => {
    const gabarits = gabaritsGet(routesCapturees);
    const resultat = await balayerRoutes(app, base, gabarits, erreursCapturees);

    expect([...resultat.visitees].sort()).toEqual(gabarits);

    // Rapport explicite : ce que ce balayage n'a PAS pu exercer avec un
    // identifiant reel, et pourquoi (CLAUDE.md §4 — un silence rassurant est
    // un echec silencieux). Imprime meme quand le test passe : c'est cette
    // sortie que le rapport de livraison reprend telle quelle.
    console.log(
      `[smoke-routes-lecture] passe demonstration — ${gabarits.length} route(s) GET visitee(s).\n` +
        `  sans resolveur enregistre : ${
          resultat.sansResolveurConnu.length === 0
            ? 'aucune'
            : resultat.sansResolveurConnu.join(', ')
        }\n` +
        `  sans identifiant reel resoluble sur cette base : ${
          resultat.sansIdentifiantReel.length === 0
            ? 'aucune'
            : resultat.sansIdentifiantReel.join(', ')
        }`,
    );
  });
});

/**
 * Preuve d'ABSENCE, pas de presence (voir le bloc « Detournement du reseau
 * meteo » en tete de fichier) : declare hors de tout `describe`, ce test
 * s'execute apres les deux passes ci-dessus (ordre de declaration au niveau
 * du fichier) et inspecte l'espion pose par le `beforeAll` de portee fichier,
 * qui a accumule TOUS les appels `fetch` reellement partis pendant les deux
 * passes. Aucune assertion sur le NOMBRE d'appels : seule compte la
 * destination de ceux qui sont partis.
 */
it('aucun appel reseau reel n’a vise Open-Meteo pendant tout le balayage (les deux passes)', () => {
  for (const appel of espionFetch.mock.calls) {
    const urlAppelee = String(appel[0]);
    expect(urlAppelee).not.toContain('open-meteo.com');
  }
});
