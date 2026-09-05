/**
 * Routes `/api/objectifs` (fiche
 * `docs/demandes/18-SUCCES-NIVEAUX-ET-OBJECTIFS.md`) : objectifs (budget),
 * succès et niveaux.
 *
 * ═══ Objectifs (budget, fiche §4) — câblés ═══
 *
 * La table `objectif` existe (migration `0022_awesome_lyja.sql`).
 * `GET /objectifs` liste, `POST /objectifs` crée, `POST /objectifs/:id/annuler`
 * annule par contre-écriture (rien ne s'efface, CLAUDE.md §3 règle 7) — voir
 * `packages/db/src/depots/objectifs.ts` pour la persistance et
 * `packages/core/src/objectifs.ts` pour le calcul cible/réalisé (cette route
 * ne fait que valider, appeler, sérialiser — CLAUDE.md §3 règle 1). Il n'y a
 * pas de route « modifier » : une correction s'annule puis se ressaisit,
 * même geste que `/api/depenses`.
 *
 * ═══ Le pont relatif temporaire a été supprimé le 30/07/2026 ═══
 *
 * `creerObjectif`, `listerObjectifs` et `annulerObjectif` passaient par un
 * chemin relatif direct vers `packages/db/src/depots/objectifs.ts`, faute
 * d'être réexportées par le barillet. Elles le sont désormais, et l'import
 * ci-dessous passe par le nom de paquet `@batte/db` comme tout le reste.
 *
 * Cet en-tête est conservé plutôt qu'effacé parce que le pont a réellement
 * existé — mais il est corrigé le jour même : une note qui décrit un état
 * révolu envoie le lecteur suivant recréer ce dont on vient de se débarrasser.
 * Il ne subsiste aujourd'hui AUCUN import relatif franchissant une frontière de
 * paquet dans tout le dépôt, ce qui se vérifie par
 * `grep -rn "from '\.\..*\(core\|db\)/src/" --include=*.ts --include=*.tsx packages apps`.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  ErreurMetier,
  schemaAnnulationObjectif,
  schemaCreationObjectif,
  schemaListeObjectifs,
  schemaObjectifLigne,
  schemaSucces,
} from '@batte/core';
import {
  annulerObjectif,
  calculerSucces,
  creerObjectif,
  listerObjectifs,
  type BaseBatte,
} from '@batte/db';

const FORMAT_JOUR_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/** Valide un jour de référence optionnel (`?date=AAAA-MM-JJ`), sans jamais en deviner un. */
function analyserJourReference(brut: string | undefined): string | undefined {
  if (brut === undefined) return undefined;
  if (!FORMAT_JOUR_CIVIL.test(brut)) {
    throw new ErreurMetier(
      'date_invalide',
      `Date invalide : « ${brut} ». Format attendu AAAA-MM-JJ.`,
      { champs: { date: 'Indiquez une date au format AAAA-MM-JJ.' } },
    );
  }
  return brut;
}

export function routesObjectifs(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /* ─── Objectifs (budget, fiche §4) ────────────────────────────────────── */

    app.get<{ Querystring: { date?: string } }>('/objectifs', async (requete) => {
      const jourReference = analyserJourReference(requete.query.date);
      const lignes = listerObjectifs(base, jourReference);
      return schemaListeObjectifs.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.post('/objectifs', async (requete, reponse) => {
      const corps = schemaCreationObjectif.parse(requete.body);
      const cree = creerObjectif(base, {
        grandeur: corps.grandeur,
        dateDebut: corps.dateDebut,
        dateFin: corps.dateFin,
        valeurCible: corps.valeurCible,
        notes: corps.notes,
      });

      const trouve = listerObjectifs(base).find((l) => l.id === cree.id);
      if (trouve === undefined) throw new Error(`Objectif ${cree.id} introuvable après création.`);

      reponse.code(201);
      return schemaObjectifLigne.parse(trouve);
    });

    app.post<{ Params: { id: string } }>('/objectifs/:id/annuler', async (requete) => {
      const corps = schemaAnnulationObjectif.parse(requete.body);
      const contreEcriture = annulerObjectif(base, requete.params.id, corps.motif);

      const trouve = listerObjectifs(base).find((l) => l.id === contreEcriture.id);
      if (trouve === undefined) {
        throw new Error(`Contre-écriture ${contreEcriture.id} introuvable après annulation.`);
      }
      return schemaObjectifLigne.parse(trouve);
    });

    /* ─── Succès et niveaux — VUE recalculée, jamais un état stocké ───────── */

    app.get<{ Querystring: { date?: string } }>('/objectifs/succes', async (requete) => {
      const jourReference = analyserJourReference(requete.query.date);
      const resultat = calculerSucces(base, jourReference);
      return schemaSucces.parse(resultat);
    });
  };
}
