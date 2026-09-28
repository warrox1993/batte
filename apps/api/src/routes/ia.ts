/**
 * Routes `/api/ia/*` (Lot 9 — assistance Claude).
 *
 * Aucune de ces routes n'est necessaire au fonctionnement de l'application :
 * elles ajoutent du commentaire a des chiffres deja calcules ailleurs. C'est
 * volontaire — « l'IA est un confort, jamais une dependance » (CLAUDE.md §5).
 *
 * Toutes rendent 200 meme quand l'assistance est indisponible : un plafond
 * atteint ou une cle absente sont des ETATS DU PRODUIT, pas des erreurs.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  ErreurIntrouvable,
  ErreurMetier,
  jourCivilBelge,
  schemaCommentaireIa,
  schemaEtatIa,
  schemaJournalIa,
} from '@batte/core';
import {
  depenseIaDuMois,
  lireParametres,
  lireSessionDetail,
  listerAppelsIa,
  type BaseBatte,
} from '@batte/db';
import { assistanceConfiguree, demanderCommentaire } from '../ia/client.js';
import { analyseEcart } from '../ia/usages.js';
import { LIMITE_APPEL_EXTERNE } from '../plugins/limitation-debit.js';

export function routesIa(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /**
     * Etat de l'assistance : configuree ou non, et ou en est le budget.
     *
     * L'utilisateur doit pouvoir repondre a « pourquoi n'ai-je pas de
     * commentaire ce mois-ci ? » sans ouvrir un fichier de log.
     */
    app.get('/ia/etat', async () => {
      const jour = jourCivilBelge(new Date());
      const annee = Number.parseInt(jour.slice(0, 4), 10);
      const mois = Number.parseInt(jour.slice(5, 7), 10);

      const parametres = lireParametres(base);
      const plafondMensuelCents = parametres.centimes('plafond_ia_mensuel_cents');
      const depenseDuMoisCents = depenseIaDuMois(base, annee, mois);

      const appelsDuMois = listerAppelsIa(base, 1000).filter((a) =>
        a.dateAppel.startsWith(jour.slice(0, 7)),
      );

      return schemaEtatIa.parse({
        configuree: assistanceConfiguree(),
        plafondMensuelCents,
        depenseDuMoisCents,
        resteCents: Math.max(0, plafondMensuelCents - depenseDuMoisCents),
        nbAppelsDuMois: appelsDuMois.length,
      });
    });

    app.get('/ia/journal', async () => {
      const lignes = listerAppelsIa(base);
      return schemaJournalIa.parse({ data: lignes, meta: { total: lignes.length } });
    });

    /**
     * Analyse d'ecart sur une session close.
     *
     * Le resultat est du TEXTE affiche a l'ecran. Il n'entre pas en base : rien
     * a valider, rien a marquer `source = 'ia'` (CLAUDE.md §3 regle 2).
     *
     * Refuse une session PAS ENCORE CLOTUREE (meme geste que
     * `routes/documents.ts` pour `/documents/rapport-session/:id`) : sans ce
     * garde-fou, `caTotalCents`/`margeNetteCents`/`ecartCaisseCents` valent
     * `null` en base (colonnes ecrites uniquement a la cloture,
     * `services/sessions.ts`) — defaut trouve le 30/07/2026, ou un `?? 0`
     * les remplacait silencieusement par un chiffre d'affaires et un ecart de
     * caisse « nuls », que Claude aurait alors commentes comme un vrai zero
     * plutot que comme une donnee absente.
     */
    app.post<{ Params: { id: string } }>(
      '/ia/analyse-ecart/:id',
      { config: { rateLimit: LIMITE_APPEL_EXTERNE } },
      async (requete) => {
        const detail = lireSessionDetail(base, requete.params.id);
        if (detail === null) throw new ErreurIntrouvable('Session', requete.params.id);
        if (detail.statut !== 'cloturee') {
          throw new ErreurMetier(
            'session_non_cloturee',
            `Cette session est en statut « ${detail.statut} » : l'analyse d'écart n'est ` +
              "disponible qu'après clôture.",
          );
        }

        const reponse = await demanderCommentaire(
          base,
          lireParametres(base),
          analyseEcart({
            numero: detail.numero,
            dateSession: detail.dateSession,
            crepesProduites: detail.crepesProduites,
            crepesVendues: detail.crepesVendues,
            crepesInvendues: detail.crepesInvendues,
            caTotalCents: detail.caTotalCents,
            margeNetteCents: detail.margeNetteCents,
            ecartCaisseCents: detail.ecartCaisseCents,
            prevuCrepes: null,
            notesQualitatives: detail.notesQualitatives,
          }),
        );

        return schemaCommentaireIa.parse(reponse);
      },
    );
  };
}
