/**
 * Gestionnaire d'erreurs unique de l'API. Toute reponse d'erreur, quelle que
 * soit son origine, respecte la forme fixee par docs/06-UI-ET-PARCOURS.md,
 * section « Conventions d'API » :
 *   { erreur: { code, message, champs? } }
 * avec 422 pour une violation de regle metier ou de validation.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { estErreurMetier, type ChampsEnErreur } from '@batte/core';

// Zod fournit nativement une locale francaise pour ses messages de validation
// (pas de dependance supplementaire) : sans cet appel, un champ invalide
// produirait un message technique en anglais, contraire a docs/06 (« message
// en francais directement affichable »). Un seul appel suffit pour tout le
// processus ; il doit juste precéder la premiere validation d'une requete.
z.config(z.locales.fr());

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: ChampsEnErreur };
};

/** Chemin du champ Zod fautif ('_global' si l'erreur ne vise aucun champ precis). */
function champsDepuisZod(erreur: ZodError): ChampsEnErreur {
  const champs: ChampsEnErreur = {};
  for (const issue of erreur.issues) {
    const chemin = issue.path.length === 0 ? '_global' : issue.path.join('.');
    champs[chemin] = issue.message;
  }
  return champs;
}

/**
 * Reponse JSON pour une route inexistante. Exportee a part parce que le
 * repli SPA de serveur.ts (production uniquement) doit pouvoir l'invoquer
 * lui-meme pour les routes `/api/*` non trouvees, avant de servir `index.html`
 * pour tout le reste.
 */
export function envoyerReponse404(requete: FastifyRequest, reponse: FastifyReply): void {
  const corps: ReponseErreur = {
    erreur: {
      code: 'route_introuvable',
      message: `Route inconnue : ${requete.method} ${requete.url}.`,
    },
  };
  reponse.status(404).send(corps);
}

/** Statut HTTP porte par une erreur Fastify, ou `null` si elle n'en porte pas. */
function statutHttpDe(erreur: unknown): number | null {
  if (typeof erreur !== 'object' || erreur === null) return null;
  const statut = (erreur as { statusCode?: unknown }).statusCode;
  return typeof statut === 'number' && Number.isInteger(statut) ? statut : null;
}

/** Code d'erreur Fastify (`FST_ERR_…`), utile au diagnostic sans fuiter de trace. */
function codeFastify(erreur: unknown): string | null {
  if (typeof erreur !== 'object' || erreur === null) return null;
  const code = (erreur as { code?: unknown }).code;
  return typeof code === 'string' && code !== '' ? code.toLowerCase() : null;
}

/**
 * Message en francais par statut client.
 *
 * On ne renvoie JAMAIS le message brut de Fastify : il est en anglais technique
 * et peut porter un fragment du corps envoye.
 */
function messageClient(statut: number): string {
  switch (statut) {
    case 400:
      return 'La requête est mal formée : le corps envoyé n’est pas du JSON valide.';
    case 413:
      return 'Le contenu envoyé est trop volumineux.';
    case 414:
      return 'L’adresse demandée est trop longue.';
    case 415:
      return 'Le format envoyé n’est pas accepté : utilisez « application/json ».';
    case 404:
      return 'La ressource demandée est introuvable.';
    case 429:
      // Limitation de debit des routes couteuses (plugins/limitation-debit.ts).
      return 'Trop de demandes en peu de temps pour cette action : patientez une minute avant de réessayer.';
    default:
      return 'La requête a été refusée. Vérifiez les données envoyées.';
  }
}

/**
 * Gestionnaire de route inconnue.
 *
 * Il est PARAMETRABLE, et ce n'est pas de la souplesse gratuite : Fastify
 * n'accepte qu'UN SEUL `setNotFoundHandler` par prefixe et **leve** au second
 * appel. Ce plugin en posait un inconditionnellement, et `serveur.ts` en posait
 * un second en production pour le repli SPA — donc `construireServeur` levait
 * `Not found handler already set` et **le mode production n'a jamais pu
 * demarrer**. Aucun test ne le voyait : ils construisent tous le serveur en
 * mode developpement, ou la seconde inscription n'a pas lieu.
 *
 * En passant le comportement plutot qu'en l'inscrivant deux fois, la faute
 * devient inecrivable : il n'y a qu'un seul point d'inscription.
 */
export type GestionnaireRouteInconnue = (requete: FastifyRequest, reponse: FastifyReply) => void;

export function enregistrerGestionnaireErreurs(
  app: FastifyInstance,
  surRouteInconnue: GestionnaireRouteInconnue = envoyerReponse404,
): void {
  app.setErrorHandler((erreur: unknown, requete: FastifyRequest, reponse: FastifyReply) => {
    if (estErreurMetier(erreur)) {
      reponse.status(erreur.statut).send(erreur.versReponse());
      return;
    }

    if (erreur instanceof ZodError) {
      const corps: ReponseErreur = {
        erreur: {
          code: 'validation',
          message: 'La saisie contient des champs invalides.',
          champs: champsDepuisZod(erreur),
        },
      };
      reponse.status(422).send(corps);
      return;
    }

    /**
     * Erreurs 4xx natives de Fastify : corps JSON malforme
     * (`FST_ERR_CTP_INVALID_JSON`), charge trop grosse (413), type de contenu
     * refuse (415), URL trop longue (414)…
     *
     * Sans ce bloc, elles ressortaient toutes en **500**. Une faute du CLIENT
     * etait donc presentee — et journalisee — comme une panne du serveur : le
     * message disait « consultez les journaux » alors qu'il suffisait de
     * corriger la requete, et le journal se remplissait de fausses pannes.
     */
    const statutNatif = statutHttpDe(erreur);
    if (statutNatif !== null && statutNatif >= 400 && statutNatif < 500) {
      requete.log.warn(erreur);
      const corpsClient: ReponseErreur = {
        erreur: {
          code: codeFastify(erreur) ?? 'requete_invalide',
          message: messageClient(statutNatif),
        },
      };
      reponse.status(statutNatif).send(corpsClient);
      return;
    }

    // Erreur non prevue : jamais de catch silencieux (CLAUDE.md §4). Le
    // detail complet part dans les journaux serveur ; le navigateur ne recoit
    // qu'un message generique, comprehensible mais qui ne fuite aucune trace
    // technique.
    requete.log.error(erreur);
    const corps: ReponseErreur = {
      erreur: {
        code: 'erreur_interne',
        message:
          "Une erreur inattendue s'est produite. Réessayez, ou consultez les journaux du serveur si cela persiste.",
      },
    };
    reponse.status(500).send(corps);
  });

  app.setNotFoundHandler(surRouteInconnue);
}
