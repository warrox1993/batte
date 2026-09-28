/**
 * Limitation de debit des routes COUTEUSES (CodeQL js/missing-rate-limiting,
 * 28/09/2026 — voir docs/05-DECISIONS.md, D-099).
 *
 * L'API n'ecoute que sur 127.0.0.1 (`serveur.ts`), mais « locale » ne veut pas
 * dire « a l'abri » : n'importe quelle page ouverte dans le navigateur du poste
 * peut emettre des `GET` vers `http://127.0.0.1:3001` (elle ne lira pas la
 * reponse, mais la requete part et la route s'execute). Or une generation de
 * document lance Chromium ou ExcelJS ET archive une nouvelle version sur disque
 * a chaque appel (D-026) : une boucle suffisait a saturer le processeur et a
 * remplir le disque. Un appel IA est facture, un envoi de mail part vraiment.
 *
 * `global: false` : seules les routes qui declarent `config.rateLimit` sont
 * limitees. Les routes de lecture ordinaires, appelees en rafale par
 * l'interface, ne le sont pas.
 *
 * Cle = adresse IP (defaut du greffon). Tout arrive de 127.0.0.1 : la limite
 * vaut donc pour le poste entier, par route, ce qui est exactement le but.
 */

import type { RateLimitPluginOptions } from '@fastify/rate-limit';

/**
 * Generation de document (PDF, classeur Excel) : un clic humain, meme repete,
 * reste tres en dessous. 30 par minute et par route.
 *
 * Les routes GET qui l'utilisent declarent aussi `exposeHeadRoute: false` : la
 * route HEAD que Fastify ajoute d'office execute le MEME gestionnaire (donc
 * genere et archive), mais le greffon lui donne son propre compteur. Sans
 * cela, HEAD offrait un second budget de 30 generations par minute.
 */
export const LIMITE_GENERATION_DOCUMENT = { max: 30, timeWindow: '1 minute' } as const;

/**
 * Appel sortant qui coute ou qui engage : IA facturee, mail envoye au
 * fournisseur. 10 par minute et par route.
 */
export const LIMITE_APPEL_EXTERNE = { max: 10, timeWindow: '1 minute' } as const;

/** Code d'erreur stable renvoye avec le statut 429. */
export const CODE_TROP_DE_DEMANDES = 'trop_de_demandes';

/**
 * Options du greffon, a passer a `app.register(rateLimit, …)` sur l'instance
 * RACINE (`serveur.ts`), avant les routes. Pas d'enveloppe « plugin maison » :
 * une fonction passee a `register` ouvrirait un contexte encapsule, et le
 * greffon n'y verrait que ses propres routes, pas celles de `/api`.
 */
export const OPTIONS_LIMITATION_DEBIT: RateLimitPluginOptions = {
  global: false,
  // L'objet leve passe par le gestionnaire unique (`plugins/erreurs.ts`) : il
  // n'en garde que le statut et le `code`, et remplace le message par sa
  // phrase francaise du 429. Le `message` ci-dessous ne sert qu'au journal.
  errorResponseBuilder: (_requete, contexte) => ({
    statusCode: contexte.statusCode,
    code: CODE_TROP_DE_DEMANDES,
    message: `Limite de ${String(contexte.max)} demandes atteinte.`,
  }),
};
