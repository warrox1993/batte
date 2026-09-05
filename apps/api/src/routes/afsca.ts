/**
 * Routes `/api/afsca/*` (Lot 8 — registre AFSCA).
 *
 * Regroupées sous un préfixe dédié plutôt que sous `/sessions` ou `/lots` :
 * ce module est développé en parallèle d'autres lots qui touchent ces mêmes
 * ressources, et un préfixe propre élimine tout risque de collision de route.
 *
 * Toute la logique (seuil de température, retard de nettoyage, traçabilité)
 * vient de `@batte/db` — cette route assemble et valide, rien de plus.
 */

import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  ErreurMetier,
  jourCivilBelge,
  schemaAnnulationReleveTemperature,
  schemaAnnulationReleveTemperatureCreee,
  schemaClotureNonConformite,
  schemaCreationExecutionNettoyage,
  schemaCreationExerciceTracabilite,
  schemaCreationNonConformite,
  schemaCreationReleveTemperature,
  schemaExecutionNettoyage,
  schemaExerciceTracabilite,
  schemaListeExecutionsNettoyage,
  schemaListeExercicesTracabilite,
  schemaListeNonConformites,
  schemaListeRelevesTemperature,
  schemaListeSessionsSansReleveTemperature,
  schemaListeTachesEnRetard,
  schemaListeTachesNettoyage,
  schemaNonConformite,
  schemaPeriodeRequete,
  schemaReleveTemperature,
  schemaTracabiliteAmontSession,
  schemaTracabiliteAvalLot,
} from '@batte/core';
import {
  // Tout ce qui vient de `@batte/db` passe par son baril `src/index.ts` :
  // le `package.json` du paquet restreint ses `exports` à ce seul point
  // d'entrée. Si un symbole manque ici, il faut l'AJOUTER au baril — jamais
  // le contourner par un import relatif profond, qui compilerait mais
  // casserait à l'exécution.
  annulerReleveTemperature,
  cloturerNonConformite,
  declarerNonConformite,
  enregistrerExecutionNettoyage,
  enregistrerExerciceTracabilite,
  enregistrerReleveTemperature,
  executionsNettoyagePeriode,
  listerExercicesTracabilite,
  listerNonConformites,
  listerRelevesTemperature,
  listerTachesNettoyage,
  lot,
  nonConformitesPeriode,
  production,
  relevesTemperaturePeriode,
  sessionMarche,
  sessionsSansReleveTemperature,
  tachesEnRetard,
  tracabiliteAmontSession,
  tracabiliteAvalLot,
  type BaseBatte,
} from '@batte/db';

/**
 * `AAAA-MM-JJ` strict — même convention que `routes/audit.ts` (`JOUR_CIVIL`)
 * et `routes/objectifs.ts` (`FORMAT_JOUR_CIVIL`).
 */
const FORMAT_JOUR_CIVIL_AFSCA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valide `dateReference` AVANT de la transmettre à `tachesEnRetard`.
 *
 * Défaut trouvé à l'audit du 01/08/2026 (CLAUDE.md §4 — Zod à toutes les
 * frontières) : cette chaîne de requête n'était validée nulle part, à la
 * différence de `debut`/`fin` sur les routes voisines de ce même fichier
 * (`schemaPeriodeRequete.parse`). Une valeur malformée (`abc`, chaîne vide…)
 * atteignait directement `tachesEnRetard` → `lireParametres(base,
 * dateReference)`, qui choisit la version en vigueur des paramètres
 * réglementaires à CETTE date : un format invalide ne levait AUCUNE erreur,
 * la route rendait silencieusement 200 avec un résultat dont rien ne garantit
 * qu'il corresponde à une date sensée — jamais un 500, mais un succès qui ne
 * veut rien dire, ce que le § 4 proscrit tout autant qu'une exception brute.
 */
function analyserDateReferenceNettoyage(brut: string | undefined): string {
  if (brut === undefined) return jourCivilBelge(new Date());
  if (!FORMAT_JOUR_CIVIL_AFSCA.test(brut)) {
    throw new ErreurMetier(
      'date_invalide',
      `Date invalide : « ${brut} ». Format attendu AAAA-MM-JJ.`,
      { champs: { dateReference: 'Indiquez une date au format AAAA-MM-JJ.' } },
    );
  }
  return brut;
}

export function routesAfsca(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /* ── Relevés de température ────────────────────────────────────────── */

    app.get<{ Querystring: { debut?: string; fin?: string } }>(
      '/afsca/temperatures',
      async (requete) => {
        const { debut, fin } = requete.query;
        let lignes;
        if (debut !== undefined && fin !== undefined) {
          const periode = schemaPeriodeRequete.parse({ debut, fin });
          lignes = relevesTemperaturePeriode(base, periode.debut, periode.fin);
        } else {
          lignes = listerRelevesTemperature(base);
        }

        return schemaListeRelevesTemperature.parse({
          data: lignes,
          meta: { total: lignes.length },
        });
      },
    );

    /**
     * Sessions clôturées de la période SANS AUCUN relevé de température
     * rattaché (D'audit AFSCA du 30/07/2026) : « un registre qui affiche
     * seulement ce qui existe donne une fausse impression de complétude ».
     * Répond à la question qu'un inspecteur pose directement : « vous avez
     * tenu un marché ce jour-là, où est le relevé ? »
     */
    app.get<{ Querystring: { debut: string; fin: string } }>(
      '/afsca/temperatures/sessions-sans-releve',
      async (requete) => {
        const periode = schemaPeriodeRequete.parse(requete.query);
        const lignes = sessionsSansReleveTemperature(base, periode.debut, periode.fin);
        return schemaListeSessionsSansReleveTemperature.parse({
          data: lignes,
          meta: { total: lignes.length },
        });
      },
    );

    app.post('/afsca/temperatures', async (requete, reponse) => {
      const corps = schemaCreationReleveTemperature.parse(requete.body);

      // `sessionId` est déjà vérifiée AVANT écriture par `ecrireReleveTemperature`
      // (packages/db/src/services/afsca.ts). `productionId` ne l'est PAS : la
      // colonne porte pourtant une vraie clé étrangère (`foreign_keys = ON`,
      // packages/db/src/client.ts), et un identifiant erroné ne se manifestait
      // qu'en violation de clé étrangère SQLite — un 500 brut sur le registre
      // réglementaire. Valeur SAISIE, jamais adressée dans l'URL : 422 avec
      // `champs`, jamais 404 (même convention que `lotId`/`sessionId` ci-dessous
      // pour les non-conformités, D-035 §4).
      if (corps.productionId !== undefined && corps.productionId !== null) {
        const productionTrouvee = base
          .select({ id: production.id })
          .from(production)
          .where(eq(production.id, corps.productionId))
          .get();
        if (productionTrouvee === undefined) {
          throw new ErreurMetier(
            'production_introuvable',
            `Aucune production ne correspond à l'identifiant « ${corps.productionId} ».`,
            { champs: { productionId: 'Identifiant de production introuvable.' } },
          );
        }
      }

      const resultat = enregistrerReleveTemperature(base, {
        sessionId: corps.sessionId ?? null,
        productionId: corps.productionId ?? null,
        equipement: corps.equipement,
        temperatureC: corps.temperatureC,
        dateReleve: corps.dateReleve,
        moment: corps.moment,
        actionCorrective: corps.actionCorrective ?? null,
        relevePar: corps.relevePar ?? null,
      });

      reponse.code(201);
      return schemaReleveTemperature.parse(resultat);
    });

    /**
     * ANNULE un relevé de température MAL SAISI (D-083, tranché par le
     * porteur le 31/07/2026) : le mauvais relevé RESTE au registre, `statut`
     * bascule seul à `annulee` — jamais un `DELETE`, jamais une réécriture de
     * sa valeur (CLAUDE.md §3 règle 7). Le motif est du TEXTE LIBRE
     * OBLIGATOIRE (`schemaAnnulationReleveTemperature.motif`), pas un
     * `motifCode` du catalogue : cette annulation ne contrepasse AUCUN
     * mouvement de stock — voir le commentaire complet de
     * `annulerReleveTemperature` (`packages/db/src/services/afsca.ts`).
     */
    app.post<{ Params: { id: string } }>(
      '/afsca/temperatures/:id/annuler',
      async (requete, reponse) => {
        const corps = schemaAnnulationReleveTemperature.parse(requete.body);
        const resultat = annulerReleveTemperature(base, requete.params.id, corps.motif);

        reponse.code(201);
        return schemaAnnulationReleveTemperatureCreee.parse(resultat);
      },
    );

    /* ── Plan de nettoyage ──────────────────────────────────────────────── */

    app.get('/afsca/nettoyage/taches', async () => {
      const lignes = listerTachesNettoyage(base);
      return schemaListeTachesNettoyage.parse({ data: lignes, meta: { total: lignes.length } });
    });

    /**
     * Tâches en retard à une date donnée. Par défaut, aujourd'hui en jour
     * civil belge — jamais le jour UTC (CLAUDE.md §8).
     */
    app.get<{ Querystring: { dateReference?: string } }>(
      '/afsca/nettoyage/taches-en-retard',
      async (requete) => {
        const dateReference = analyserDateReferenceNettoyage(requete.query.dateReference);
        const lignes = tachesEnRetard(base, dateReference);
        return schemaListeTachesEnRetard.parse({ data: lignes, meta: { total: lignes.length } });
      },
    );

    app.post('/afsca/nettoyage/executions', async (requete, reponse) => {
      const corps = schemaCreationExecutionNettoyage.parse(requete.body);

      // `tacheId` est déjà vérifiée AVANT écriture par `enregistrerExecutionNettoyage`
      // (packages/db/src/services/afsca.ts). `sessionId` ne l'est PAS : la
      // colonne porte pourtant une vraie clé étrangère (`foreign_keys = ON`),
      // et un identifiant erroné ne se manifestait qu'en violation de clé
      // étrangère SQLite — un 500 brut sur le plan de nettoyage. Valeur SAISIE,
      // jamais adressée dans l'URL : 422 avec `champs` (D-035 §4).
      if (corps.sessionId !== undefined && corps.sessionId !== null) {
        const sessionTrouvee = base
          .select({ id: sessionMarche.id })
          .from(sessionMarche)
          .where(eq(sessionMarche.id, corps.sessionId))
          .get();
        if (sessionTrouvee === undefined) {
          throw new ErreurMetier(
            'session_introuvable',
            `Aucune session ne correspond à l'identifiant « ${corps.sessionId} ».`,
            { champs: { sessionId: 'Identifiant de session introuvable.' } },
          );
        }
      }

      const resultat = enregistrerExecutionNettoyage(base, {
        tacheId: corps.tacheId,
        sessionId: corps.sessionId ?? null,
        dateExecution: corps.dateExecution,
        executePar: corps.executePar ?? null,
        observations: corps.observations ?? null,
      });

      reponse.code(201);
      return schemaExecutionNettoyage.parse(resultat);
    });

    app.get<{ Querystring: { debut?: string; fin?: string } }>(
      '/afsca/nettoyage/executions',
      async (requete) => {
        const periode = schemaPeriodeRequete.parse(requete.query);
        const lignes = executionsNettoyagePeriode(base, periode.debut, periode.fin);
        return schemaListeExecutionsNettoyage.parse({
          data: lignes,
          meta: { total: lignes.length },
        });
      },
    );

    /* ── Non-conformités ────────────────────────────────────────────────── */

    app.get<{ Querystring: { debut?: string; fin?: string } }>(
      '/afsca/non-conformites',
      async (requete) => {
        const { debut, fin } = requete.query;
        let lignes;
        if (debut !== undefined && fin !== undefined) {
          const periode = schemaPeriodeRequete.parse({ debut, fin });
          lignes = nonConformitesPeriode(base, periode.debut, periode.fin);
        } else {
          lignes = listerNonConformites(base);
        }

        return schemaListeNonConformites.parse({ data: lignes, meta: { total: lignes.length } });
      },
    );

    app.post('/afsca/non-conformites', async (requete, reponse) => {
      const corps = schemaCreationNonConformite.parse(requete.body);

      // Verifie AVANT l'ecriture (meme convention que la reception, D-035 §4) :
      // `declarerNonConformite` insere `lotId`/`sessionId` tels quels, sans
      // controle d'existence, et les deux colonnes portent une vraie cle
      // etrangere (`foreign_keys = ON`, `packages/db/src/client.ts`). Sans ce
      // garde, une faute de saisie (le numero fournisseur recopie a la place de
      // l'identifiant technique, un id tronque au copier-coller) ne se
      // manifestait qu'en violation de cle etrangere SQLite — un 500 brut, non
      // traduit, sur le registre reglementaire lui-meme. Ce sont des valeurs
      // SAISIES dans un formulaire, jamais adressees dans l'URL : 422 avec
      // `champs`, jamais 404 (regle D-035).
      if (corps.lotId !== undefined && corps.lotId !== null) {
        const lotTrouve = base
          .select({ id: lot.id })
          .from(lot)
          .where(eq(lot.id, corps.lotId))
          .get();
        if (lotTrouve === undefined) {
          throw new ErreurMetier(
            'lot_introuvable',
            `Aucun lot ne correspond à l'identifiant « ${corps.lotId} ». Copiez l'identifiant ` +
              "technique depuis l'écran Stock, détail du lot.",
            { champs: { lotId: 'Identifiant de lot introuvable.' } },
          );
        }
      }
      if (corps.sessionId !== undefined && corps.sessionId !== null) {
        const sessionTrouvee = base
          .select({ id: sessionMarche.id })
          .from(sessionMarche)
          .where(eq(sessionMarche.id, corps.sessionId))
          .get();
        if (sessionTrouvee === undefined) {
          throw new ErreurMetier(
            'session_introuvable',
            `Aucune session ne correspond à l'identifiant « ${corps.sessionId} ».`,
            { champs: { sessionId: 'Identifiant de session introuvable.' } },
          );
        }
      }

      const resultat = declarerNonConformite(base, {
        dateConstat: corps.dateConstat,
        type: corps.type,
        description: corps.description,
        gravite: corps.gravite,
        actionCorrective: corps.actionCorrective ?? null,
        sessionId: corps.sessionId ?? null,
        lotId: corps.lotId ?? null,
      });

      reponse.code(201);
      return schemaNonConformite.parse(resultat);
    });

    app.post<{ Params: { id: string } }>('/afsca/non-conformites/:id/cloturer', async (requete) => {
      const corps = schemaClotureNonConformite.parse(requete.body);
      const resultat = cloturerNonConformite(base, requete.params.id, corps);
      return schemaNonConformite.parse(resultat);
    });

    /* ── Exercice de traçabilité ────────────────────────────────────────── */

    app.post('/afsca/exercices-tracabilite', async (requete, reponse) => {
      const corps = schemaCreationExerciceTracabilite.parse(requete.body);

      // `lotDepartId` n'est vérifiée nulle part avant écriture
      // (`enregistrerExerciceTracabilite`, packages/db/src/services/afsca.ts) :
      // la colonne porte pourtant une vraie clé étrangère (`foreign_keys = ON`),
      // et un identifiant erroné ne se manifestait qu'en violation de clé
      // étrangère SQLite — un 500 brut sur un exercice de traçabilité. Valeur
      // SAISIE, jamais adressée dans l'URL : 422 avec `champs` (D-035 §4).
      if (corps.lotDepartId !== undefined && corps.lotDepartId !== null) {
        const lotTrouve = base
          .select({ id: lot.id })
          .from(lot)
          .where(eq(lot.id, corps.lotDepartId))
          .get();
        if (lotTrouve === undefined) {
          throw new ErreurMetier(
            'lot_introuvable',
            `Aucun lot ne correspond à l'identifiant « ${corps.lotDepartId} ». Copiez ` +
              "l'identifiant technique depuis l'écran Stock, détail du lot.",
            { champs: { lotDepartId: 'Identifiant de lot introuvable.' } },
          );
        }
      }

      const resultat = enregistrerExerciceTracabilite(base, {
        dateExercice: corps.dateExercice,
        lotDepartId: corps.lotDepartId ?? null,
        dureeMinutes: corps.dureeMinutes ?? null,
        resultat: corps.resultat,
        ecartsConstates: corps.ecartsConstates ?? null,
      });

      reponse.code(201);
      return schemaExerciceTracabilite.parse(resultat);
    });

    app.get('/afsca/exercices-tracabilite', async () => {
      const lignes = listerExercicesTracabilite(base);
      return schemaListeExercicesTracabilite.parse({
        data: lignes,
        meta: { total: lignes.length },
      });
    });

    /* ── Traçabilité amont / aval ───────────────────────────────────────── */

    /** D'une session vers tous les lots fournisseurs consommés. */
    app.get<{ Params: { id: string } }>('/afsca/tracabilite/sessions/:id', async (requete) => {
      const resultat = tracabiliteAmontSession(base, requete.params.id);
      return schemaTracabiliteAmontSession.parse(resultat);
    });

    /**
     * D'un lot fournisseur vers toutes les sessions impactées.
     *
     * `:id` accepte l'identifiant technique du lot COMME son numéro de lot
     * fournisseur (`tracabiliteAvalLot` résout les deux, docs/17 §5, fiche
     * réécrite lors de cet audit) : lors d'un rappel réel, c'est le second que
     * porte l'avis du fournisseur, jamais le premier.
     */
    app.get<{ Params: { id: string } }>('/afsca/tracabilite/lots/:id', async (requete) => {
      const resultat = tracabiliteAvalLot(base, requete.params.id);
      return schemaTracabiliteAvalLot.parse(resultat);
    });
  };
}
