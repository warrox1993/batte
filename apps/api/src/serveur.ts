/**
 * Serveur Fastify de l'API locale.
 *
 * Decision d'architecture (Lot 0) : en production, la meme instance Fastify
 * sert aussi le bundle React (`apps/web/dist`), avec repli SPA sur toute
 * route non-`/api`. Un seul processus, un seul port a lancer sur le poste de
 * travail. En developpement, Vite sert le frontend sur :5173 et cette partie
 * ne fait rien.
 *
 * `construireServeur` est exportee separement du point d'entree reel pour
 * rester testable via `fastify.inject()` (voir serveur.test.ts), sans ouvrir
 * de vrai port ni toucher a la vraie base du poste de travail.
 */

import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { config, estModulePrincipal, fermerBase, type BaseBatte } from '@batte/db';
import { creerContexte } from './contexte.js';
import { enregistrerGestionnaireErreurs, envoyerReponse404 } from './plugins/erreurs.js';
import { routesAfsca } from './routes/afsca.js';
import { routesAudit } from './routes/audit.js';
import { routesCommandes } from './routes/commandes.js';
import { routesComptabilite } from './routes/comptabilite.js';
import { routesConcurrents } from './routes/concurrents.js';
import { routesDemarrage } from './routes/demarrage.js';
import { routesDocuments } from './routes/documents.js';
import { routesEvenementsDecouverte } from './routes/evenements-decouverte.js';
import { routesEconomies } from './routes/economies.js';
import { routesEquipements } from './routes/equipements.js';
import { routesFactures } from './routes/factures.js';
import { routesLieuxRentabilite } from './routes/lieux-rentabilite.js';
import { routesNomenclatureVente } from './routes/nomenclature-vente.js';
import { routesMenus } from './routes/menus.js';
import { routesObjectifs } from './routes/objectifs.js';
import { routesOpportunites } from './routes/opportunites.js';
import { routesIa } from './routes/ia.js';
import { routesPalmares } from './routes/palmares.js';
import { routesParametres } from './routes/parametres.js';
import { routesPrevisions } from './routes/previsions.js';
import { routesProductions } from './routes/productions.js';
import { routesRecettes } from './routes/recettes.js';
import { routesReferentiel } from './routes/referentiel.js';
import { routesReferentielEcriture } from './routes/referentiel-ecriture.js';
import { routesSante } from './routes/sante.js';
import { routesSessions } from './routes/sessions.js';
import { routesStock } from './routes/stock.js';

const PORT_DEFAUT = 3001;
/**
 * Port de Vite en developpement. Sert uniquement a rediriger celui qui ouvre
 * la racine de l'API vers l'interface ; en production, rien ne l'utilise.
 */
const PORT_VITE_DEV = 5173;
const HOTE = '127.0.0.1'; // Application locale : ne jamais exposer sur le reseau.
const DOSSIER_WEB_PRODUCTION = resolve(config.racine, 'apps', 'web', 'dist');

export type OptionsServeur = {
  /**
   * Journalisation des requetes. Coupee dans les tests : sinon chaque assertion
   * est noyee sous des lignes JSON et un echec devient illisible.
   */
  journaliser?: boolean;
  /**
   * Racine du service meteo, pour la DETOURNER vers un serveur local en test.
   *
   * `undefined` en production : `releverMeteo` retombe alors sur la vraie racine
   * d'Open-Meteo, comportement inchange.
   *
   * Pourquoi cette option existe : `GET /prevision` et `/prevision/brief`
   * appelaient REELLEMENT Open-Meteo pendant la suite de tests des qu'aucune
   * ligne meteo n'etait en cache pour la date de session. Un test qui depend du
   * reseau n'est pas un test — il devient rouge en avion et vert par hasard — et
   * celui-la coutait environ huit secondes hors ligne, a chaque execution.
   *
   * Elle est ici, sur le serveur COMPLET, et pas seulement sur `routesPrevisions`
   * (ou elle existe deja) parce que les balayages qui montent le serveur entier
   * (`smoke-routes-lecture.test.ts`, `audit-robustesse.test.ts`) gardaient sinon
   * le risque : ce sont precisement eux qui appellent toutes les routes de
   * lecture, donc ceux qui declenchent l'appel.
   */
  racineUrlMeteo?: string;
};

export function construireServeur(base: BaseBatte, options: OptionsServeur = {}): FastifyInstance {
  const app = Fastify({ logger: options.journaliser ?? true });
  const enProduction = process.env['NODE_ENV'] === 'production';

  /**
   * UNE SEULE inscription du gestionnaire de route inconnue, dont le
   * comportement depend du mode. Fastify leve au second `setNotFoundHandler`
   * pour un meme prefixe — c'est exactement ce qui rendait le mode production
   * impossible a demarrer.
   *
   * Dans les deux modes, une route `/api` inconnue reste un 404 JSON : c'est
   * une faute d'appel, pas une adresse d'interface.
   */
  enregistrerGestionnaireErreurs(app, (requete, reponse) => {
    if (requete.url.startsWith('/api')) {
      envoyerReponse404(requete, reponse);
      return;
    }

    if (enProduction) {
      /**
       * Le repli SPA ne doit JAMAIS avaler un actif manquant.
       *
       * Sans ce garde-fou, `GET /assets/index-abc123.js` introuvable rendait
       * `200 text/html` — l'`index.html` lui-meme. Le navigateur recevait donc
       * du HTML la ou il attendait du JavaScript, echouait a l'analyse
       * syntaxique, et affichait un **ecran blanc muet**. Le cas est realiste :
       * Vite renomme les actifs a chaque build, et un `index.html` servi depuis
       * un cache navigateur reclame l'ancien nom.
       *
       * Meme raisonnement que pour `/api` : une requete qui attend un FICHIER
       * merite un vrai 404, pas une page. Un 404 se diagnostique en dix
       * secondes dans l'onglet reseau ; un ecran blanc, non.
       */
      const attendUnFichier =
        requete.url.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(requete.url);
      if (attendUnFichier || requete.method !== 'GET') {
        envoyerReponse404(requete, reponse);
        return;
      }

      // Toute autre route inconnue est une route du routeur cote client
      // (react-router) et non une vraie 404 : on renvoie la page de
      // l'application, qui se chargera de son propre routage.
      reponse.type('text/html').sendFile('index.html');
      return;
    }

    /**
     * En DEVELOPPEMENT, l'interface n'est pas ici : Vite la sert sur un autre
     * port. Ouvrir la racine de l'API dans un navigateur est donc un geste
     * naturel — le porteur du projet l'a fait — et rendait un 404 JSON
     * technique qui ne disait pas ou aller. Ce n'etait pas un bug, mais
     * c'etait un message inutile a un humain, ce que CLAUDE.md §4 proscrit.
     * On redirige plutot que d'expliquer : la bonne reponse a « je me suis
     * trompe de porte » est d'ouvrir la bonne.
     *
     * `localhost` et non `127.0.0.1` : sous Windows, Vite ecoute en IPv6 et
     * une redirection vers `127.0.0.1:5173` echouerait — piege deja rencontre
     * plusieurs fois sur ce poste.
     */
    reponse.redirect(`http://localhost:${PORT_VITE_DEV}${requete.url}`, 302);
  });

  app.register(
    async (api) => {
      await api.register(routesSante(base));
      await api.register(routesAfsca(base));
      await api.register(routesAudit(base));
      await api.register(routesCommandes(base));
      await api.register(routesComptabilite(base));
      await api.register(routesConcurrents(base));
      await api.register(routesDemarrage(base));
      await api.register(routesDocuments(base));
      await api.register(routesEvenementsDecouverte(base));
      await api.register(routesEconomies(base));
      await api.register(routesEquipements(base));
      await api.register(routesFactures(base));
      await api.register(routesLieuxRentabilite(base));
      await api.register(routesNomenclatureVente(base));
      await api.register(routesMenus(base));
      await api.register(routesObjectifs(base));
      await api.register(routesOpportunites(base));
      await api.register(routesIa(base));
      await api.register(routesPalmares(base));
      await api.register(routesParametres(base));
      await api.register(
        routesPrevisions(
          base,
          // Transmise seulement si elle est fournie : `exactOptionalPropertyTypes`
          // distingue « absente » de « presente et undefined », et la route
          // retombe sur la vraie racine d'Open-Meteo dans le premier cas.
          options.racineUrlMeteo === undefined ? {} : { racineUrlMeteo: options.racineUrlMeteo },
        ),
      );
      await api.register(routesRecettes(base));
      await api.register(routesProductions(base));
      await api.register(routesReferentiel(base));
      await api.register(routesReferentielEcriture(base));
      await api.register(routesSessions(base));
      await api.register(routesStock(base));
    },
    { prefix: '/api' },
  );

  if (enProduction) {
    /*
     * `wildcard` par defaut (true) : @fastify/static intercepte toute route
     * GET non deja enregistree, essaie de servir un fichier correspondant, et
     * appelle le gestionnaire de route inconnue si rien ne correspond (doc
     * @fastify/static, section « Handling 404s »). C'est ce mecanisme qui
     * alimente le repli SPA declare plus haut, sans route joker a ecrire.
     *
     * ═══ Pourquoi `serveDotFiles: false` et `index` explicites (01/08/2026) ═══
     *
     * Audit de securite du jour. `@fastify/static` 8.3.0 porte quatre avis,
     * dont une TRAVERSEE DE REPERTOIRE et un contournement de garde par
     * separateurs encodes. Une traversee sort AU-DESSUS du `root` : le fait
     * que `apps/web/dist` ne contienne que quatre fichiers publics ne protege
     * donc de rien.
     *
     * Ce qui se trouve trois niveaux au-dessus : `donnees/batte.sqlite` — la
     * base comptable et AFSCA reelle. C'est la ce qu'une traversee viserait,
     * pas un `.env` (il n'y en a pas sur disque, seulement `.env.example`).
     *
     * Ces deux options ne CORRIGEAIENT pas la vulnerabilite du plugin — seule
     * une montee de version le pouvait, et elle franchissait deux majeures.
     * Elles reduisent la surface sans rien casser : `dist` ne contient aucun
     * fichier commencant par un point, et `index.html` est le seul document
     * d'entree.
     *
     * Mise a jour du 28/09/2026 : le plugin est passe en 10.1.5, version qui
     * corrige les quatre avis (npm audit --omit=dev : 0 vulnerabilite). Les
     * ruptures des versions 9 et 10 (content-disposition, `setHeaders` qui
     * recoit la reponse Fastify) ne touchent pas cet usage. Les deux options
     * restent : elles ne coutent rien.
     *
     * Le vrai garde-fou reste ailleurs : le serveur ecoute sur `127.0.0.1`
     * (voir `HOTE`), jamais sur `0.0.0.0`.
     */
    app.register(fastifyStatic, {
      root: DOSSIER_WEB_PRODUCTION,
      serveDotFiles: false,
      index: ['index.html'],
    });
  }

  return app;
}

// Demarrage reel uniquement si ce fichier est le point d'entree lance en ligne
// de commande — jamais lors de l'import par serveur.test.ts, qui ouvrirait une
// vraie base et ecrirait une vraie sauvegarde sur le poste.
if (estModulePrincipal(import.meta.url)) {
  const base = creerContexte();
  const app = construireServeur(base);
  const enProduction = process.env['NODE_ENV'] === 'production';

  const brutPort = process.env['PORT'];
  const port =
    brutPort === undefined || brutPort === '' ? PORT_DEFAUT : Number.parseInt(brutPort, 10);
  if (!Number.isInteger(port)) {
    throw new Error(
      `Variable d'environnement PORT invalide : « ${brutPort ?? ''} » n'est pas un entier.`,
    );
  }

  app
    .listen({ port, host: HOTE })
    .then(() => {
      app.log.info(`API démarrée sur http://${HOTE}:${port}`);
      /**
       * Ligne d'accueil en clair, EN PLUS du journal pino.
       *
       * Le journal sort en JSON sur une seule ligne : l'adresse à ouvrir y est
       * noyée au milieu du niveau, de l'horodatage et du pid. Quelqu'un qui
       * lance l'application veut lire une adresse, pas analyser du JSON.
       */
      const adresse = `http://${HOTE}:${port}`;
      console.log(
        enProduction
          ? `\n  Batte est prêt — ouvrez ${adresse}\n`
          : `\n  API prête sur ${adresse} — l'interface est sur http://localhost:${PORT_VITE_DEV}\n`,
      );
    })
    .catch((erreur: unknown) => {
      /**
       * Le cas de loin le plus frequent est le port deja pris : une pile Node
       * brute en anglais y repond « EADDRINUSE », ce qui n'aide personne. Ce
       * projet s'est deja retrouve avec TROIS serveurs empiles se disputant le
       * meme port, aucun ne servant.
       *
       * Et surtout : `creerContexte()` a DEJA ouvert la base et ecrit une
       * sauvegarde a ce stade. Sortir sans `fermerBase` laisse le journal WAL
       * non replie — exactement le defaut que D-033 avait corrige ailleurs.
       */
      if ((erreur as { code?: string } | null)?.code === 'EADDRINUSE') {
        console.error(
          `\n  Le port ${port} est déjà utilisé : une autre instance de Batte tourne sans doute déjà.\n` +
            `  Ouvrez http://${HOTE}:${port} pour la retrouver, ou fermez-la avant de relancer.\n`,
        );
      } else {
        app.log.error(erreur);
      }
      fermerBase(base);
      process.exitCode = 1;
    });

  /**
   * Arret propre : on ferme Fastify PUIS la base.
   *
   * Fermer la base replie le journal WAL. Sans cela, les dernieres ecritures
   * restent dans `batte.sqlite-wal` et une sauvegarde faite « par simple copie
   * du .sqlite » (D-001) serait silencieusement incomplete.
   */
  const arreter = (signal: NodeJS.Signals): void => {
    app.log.info(`Signal ${signal} reçu, arrêt propre du serveur.`);
    app
      .close()
      .then(() => {
        fermerBase(base);
        process.exit(0);
      })
      .catch((erreur: unknown) => {
        app.log.error(erreur);
        // La base se ferme meme sur echec de Fastify : c'est elle qui porte
        // les donnees, le serveur HTTP n'en porte aucune.
        fermerBase(base);
        process.exit(1);
      });
  };

  /**
   * `SIGHUP` et `SIGBREAK` en plus des deux habituels.
   *
   * Sous Windows, **fermer la fenetre de console** envoie `SIGHUP`, et
   * `Ctrl+Pause` envoie `SIGBREAK`. Ni l'un ni l'autre n'etait ecoute : le
   * geste le plus naturel pour arreter l'application — cliquer sur la croix de
   * la console — laissait donc le journal WAL non replie. Mesure : le fichier
   * `batte.sqlite-wal` restait a sa taille, donc une sauvegarde par copie du
   * seul `.sqlite` aurait ete incomplete, ce que D-001 promet l'inverse.
   *
   * Un kill force (`taskkill /F`, arret de la machine) contourne de toute
   * facon tout gestionnaire : c'est pourquoi `creerBase` ouvre en WAL avec
   * `synchronous=FULL` plutot que de compter sur une fermeture propre.
   */
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
    process.on(signal, arreter);
  }
}
