/**
 * Routes `/api/productions` (Lot 3).
 *
 * La faisabilite est exposee separement du lancement : l'ecran doit pouvoir
 * l'interroger en direct pendant que l'utilisateur ajuste la quantite, sans
 * jamais rien ecrire.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  CATALOGUE_MOTIFS,
  ErreurIntrouvable,
  ErreurMetier,
  schemaAnnulationProduction,
  schemaAnnulationProductionCreee,
  schemaCreationProduction,
  schemaDemandeFaisabilite,
  schemaFaisabilite,
  schemaListeProductions,
  schemaProductionDetail,
  schemaRattachementSession,
  schemaSaisieRealise,
  type CibleProduction,
  type CibleMiseAEchelle,
  type CodeMotif,
} from '@batte/core';
import {
  lancerProduction,
  lireProductionDetail,
  listerProductions,
  annulerProduction,
  rattacherSession,
  saisirRealise,
  sessionsDesProductions,
  verifierFaisabilite,
  type BaseBatte,
  type SessionRattacheeInfo,
} from '@batte/db';

/**
 * Resout un code motif contre le catalogue AVANT d'entrer en base.
 *
 * Meme fonction que dans `routes/stock.ts` : un motif inconnu devient une
 * erreur de SAISIE a 422 (D-035) plutot qu'une erreur interne au fond du
 * service.
 */
function resoudreCodeMotif(brut: string): CodeMotif {
  const definition = CATALOGUE_MOTIFS.find((m) => m.code === brut);
  if (definition === undefined) {
    throw new ErreurMetier('motif_inconnu', `Le motif « ${brut} » n'existe pas.`, {
      champs: { motifCode: 'Choisissez un motif dans la liste.' },
    });
  }
  return definition.code;
}

/** Traduit la cible HTTP (plate) vers la cible metier (explicite). */
function versCibleMetier(cible: CibleProduction): CibleMiseAEchelle {
  return cible.cible === 'crepes'
    ? { type: 'crepes', crepesVendables: cible.valeur }
    : { type: 'volume', volumeMl: cible.valeur };
}

/**
 * Fusionne le numero lisible de la session rattachee (jamais un UUID a
 * l'ecran) dans une ligne de production. Fonction de presentation pure : la
 * decision (rattachee ou non) vient deja de `sessionsDesProductions`.
 */
function avecSession<T extends { id: string }>(
  ligne: T,
  sessions: ReadonlyMap<string, SessionRattacheeInfo | null>,
): T & {
  sessionId: string | null;
  sessionNumero: string | null;
  sessionStatut: SessionRattacheeInfo['statut'] | null;
} {
  const session = sessions.get(ligne.id) ?? null;
  return {
    ...ligne,
    sessionId: session?.id ?? null,
    sessionNumero: session?.numero ?? null,
    sessionStatut: session?.statut ?? null,
  };
}

export function routesProductions(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /**
     * Diagnostic de faisabilite, SANS effet de bord.
     *
     * En POST et non en GET malgre l'absence d'ecriture : la cible est un objet
     * structure, et l'encoder en parametres d'URL le rendrait illisible.
     */
    app.post('/productions/faisabilite', async (requete) => {
      const corps = schemaDemandeFaisabilite.parse(requete.body);

      const controle = verifierFaisabilite(
        base,
        corps.recetteId,
        versCibleMetier(corps.cible),
        corps.dateProduction,
      );

      return schemaFaisabilite.parse({
        faisable: controle.faisabilite.faisable,
        besoins: controle.faisabilite.besoins,
        manquants: controle.faisabilite.manquants,
        ingredientLimitant: controle.faisabilite.ingredientLimitant,
        volumeMaximalMl: controle.faisabilite.volumeMaximalMl,
        volumeMl: controle.volumeMl,
        crepes: controle.crepes,
      });
    });

    app.get('/productions', async () => {
      const lignes = listerProductions(base);
      // Rattachement a la session (docs/14 G1/G4) : sans lui, une production
      // non rattachee est indiscernable d'une production rattachee — c'est
      // exactement le defaut qui masquait le cout de la pate dans la marge.
      const sessions = sessionsDesProductions(
        base,
        lignes.map((l) => l.id),
      );
      const enrichies = lignes.map((l) => avecSession(l, sessions));
      return schemaListeProductions.parse({ data: enrichies, meta: { total: enrichies.length } });
    });

    app.get<{ Params: { id: string } }>('/productions/:id', async (requete) => {
      const detail = lireProductionDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Production', requete.params.id);
      const sessions = sessionsDesProductions(base, [detail.id]);
      return schemaProductionDetail.parse(avecSession(detail, sessions));
    });

    /**
     * Lancement. Consomme le stock de facon ATOMIQUE : soit tout passe, soit
     * rien. `lancerProduction` leve une ErreurMetier nommant l'ingredient
     * limitant si le stock ne suffit pas — le gestionnaire d'erreurs la traduit
     * en 422 avec un message francais affichable.
     */
    /**
     * ANNULER une production : contrepasse ses mouvements de stock et passe le
     * statut a « annulee ».
     *
     * Ce chemin n'existait pas. Le statut etait prevu au contrat, refuse en
     * entree par `saisirRealise`, exclu des sommes par D-038 — et rien ne
     * l'ecrivait jamais. Une production lancee par erreur restait donc
     * definitivement engagee, stock consomme compris, sans autre recours qu'une
     * contrepassation manuelle mouvement par mouvement.
     *
     * Le motif est OBLIGATOIRE, comme pour toute contrepassation : sans lui, le
     * registre ne repond pas a « pourquoi ce stock est-il revenu ? ».
     */
    app.post<{ Params: { id: string } }>('/productions/:id/annuler', async (requete, reponse) => {
      const corps = schemaAnnulationProduction.parse(requete.body);
      const resultat = annulerProduction(
        base,
        requete.params.id,
        resoudreCodeMotif(corps.motifCode),
      );

      reponse.code(201);
      return schemaAnnulationProductionCreee.parse(resultat);
    });

    app.post('/productions', async (requete, reponse) => {
      const corps = schemaCreationProduction.parse(requete.body);

      const resultat = lancerProduction(base, {
        recetteId: corps.recetteId,
        cible: versCibleMetier(corps.cible),
        dateProduction: corps.dateProduction,
        notes: corps.notes ?? null,
        // Rattachement DES LE LANCEMENT (docs/14 G1/G4, premier des deux
        // gestes demandes) : optionnel, `lancerProduction` refuse deja une
        // session cloturee (`verifierSessionRattachable`) — le 422 remonte
        // tel quel via le gestionnaire d'erreurs commun.
        sessionId: corps.sessionId ?? null,
        // Prevision retenue au lancement : celle que l'ECRAN affichait au
        // moment de la decision, jamais choisie ici — `lancerProduction`
        // refuse deja une prevision introuvable ou d'une autre session
        // (`verifierPrevisionRattachable`), le 422 remonte tel quel.
        previsionId: corps.previsionId ?? null,
      });

      const detail = lireProductionDetail(base, resultat.productionId);
      if (detail === null) {
        // La production vient d'etre creee dans une transaction validee : son
        // absence serait une incoherence, pas une situation metier.
        throw new Error(`Production ${resultat.productionId} introuvable après création.`);
      }

      const sessions = sessionsDesProductions(base, [detail.id]);
      reponse.code(201);
      return schemaProductionDetail.parse(avecSession(detail, sessions));
    });

    app.patch<{ Params: { id: string } }>('/productions/:id/realise', async (requete) => {
      const corps = schemaSaisieRealise.parse(requete.body);

      saisirRealise(base, requete.params.id, {
        volumeReelMl: corps.volumeReelMl,
        crepesReelles: corps.crepesReelles,
        ecartMotif: corps.ecartMotif ?? null,
        // Consommation REELLE par ingredient (docs/17 fiche 9) : optionnelle et
        // partielle, jamais devinee. `saisirRealise` transforme chaque ecart
        // declare en vrai mouvement rattache a la production (regle n°5).
        consommationsReelles: corps.consommationsReelles ?? [],
      });

      const detail = lireProductionDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Production', requete.params.id);
      const sessions = sessionsDesProductions(base, [detail.id]);
      return schemaProductionDetail.parse(avecSession(detail, sessions));
    });

    /**
     * Rattachement APRES coup (docs/14 G1/G4, second des deux gestes demandes
     * — celui qui compte autant que le premier) : on lance souvent la pate
     * avant que la session du marche n'existe encore. `sessionId: null`
     * detache une production mal rattachee.
     *
     * `rattacherSession` refuse en 422 si la session cible — ou la session
     * actuelle — est deja cloturee (D-024) ; le gestionnaire d'erreurs commun
     * traduit l'`ErreurMetier` telle quelle.
     */
    app.patch<{ Params: { id: string } }>('/productions/:id/session', async (requete) => {
      const corps = schemaRattachementSession.parse(requete.body);
      rattacherSession(base, requete.params.id, corps.sessionId);

      const detail = lireProductionDetail(base, requete.params.id);
      if (detail === null) throw new ErreurIntrouvable('Production', requete.params.id);
      const sessions = sessionsDesProductions(base, [detail.id]);
      return schemaProductionDetail.parse(avecSession(detail, sessions));
    });
  };
}
