/**
 * Routes `/api/depenses`, `/api/immobilisations`, `/api/echeances`,
 * `/api/periodes`, `/api/synthese-exercice` et `/api/ventes-par-creneau`
 * (Lot 10 — comptabilité).
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  agregerVentesParCreneau,
  ErreurIntrouvable,
  ErreurMetier,
  jourCivilBelge,
  schemaAnnulationDepense,
  schemaClotureRequisePeriode,
  schemaCreationDepense,
  schemaCreationImmobilisation,
  schemaDepenseLigne,
  schemaEcheanceLigne,
  schemaEstimerMontantEcheance,
  schemaImmobilisationDetail,
  schemaImpactVerrouillagePeriode,
  schemaListeDepenses,
  schemaListeEcheances,
  schemaListeImmobilisations,
  schemaListePeriodes,
  schemaListeVentesParCreneau,
  schemaMarquerEcheanceFaite,
  schemaPeriodeLigne,
  schemaReouverturePeriode,
  schemaSyntheseExercice,
  schemaVerrouillageRequisPeriode,
  totaliserJournal,
  type LigneVenteCreneauBrute,
} from '@batte/core';
import {
  annulerDepense,
  calculerImpactVerrouillagePeriode,
  cloturerPeriode,
  enregistrerDepense,
  enregistrerImmobilisation,
  estimerMontantEcheance,
  listerDepenses,
  listerEcheances,
  listerImmobilisations,
  listerPeriodes,
  marquerEcheanceFaite,
  rouvrirPeriode,
  seedEcheances,
  syntheseExercice,
  ventesParCreneauBrutes,
  verrouillerPeriode,
  type BaseBatte,
} from '@batte/db';

/** Annee civile courante (Europe/Brussels), utilisee comme defaut de filtre. */
function anneeCourante(): number {
  return Number.parseInt(jourCivilBelge(new Date()).slice(0, 4), 10);
}

function analyserAnnee(brute: string | undefined): number {
  if (brute === undefined) return anneeCourante();

  // Format vérifié AVANT toute conversion : `Number.parseInt` est permissif
  // (« 2026abc » ou « 2026.5 » seraient tronqués au lieu d'être refusés, et
  // « -2026 » serait accepté comme un entier valide malgré `Number.isInteger`).
  if (!/^\d{4}$/.test(brute)) {
    throw new ErreurMetier('annee_invalide', `Année invalide : « ${brute} ».`, {
      champs: { annee: 'Indiquez une année sur quatre chiffres.' },
    });
  }
  return Number.parseInt(brute, 10);
}

export function routesComptabilite(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /* ─── Dépenses ────────────────────────────────────────────────────────── */

    app.get<{ Querystring: { annee?: string } }>('/depenses', async (requete) => {
      const annee =
        requete.query.annee === undefined ? undefined : analyserAnnee(requete.query.annee);
      const lignes = listerDepenses(base, annee === undefined ? undefined : { annee });
      // Totalisation déléguée à `totaliserJournal` (`@batte/core`, CLAUDE.md §3
      // règle 1) : cette route recalculait elle-même TROIS `.reduce()` en
      // ligne qui redisaient — moins bien, sans la ventilation par catégorie —
      // exactement ce que cette fonction fait déjà, testée séparément
      // (`comptabilite.test.ts`, `comptabilite-charges.test.ts`) et jusqu'ici
      // sans aucun appelant de production (docs/28-ORPHELINS-DERIVES.md §2).
      // `immobilisee: l.immobilisationId !== null` reproduit EXACTEMENT le
      // critère déjà appliqué par `listerDepenses` pour calculer
      // `l.montantDeductibleCents` (`montantDeductibleCharge`,
      // `packages/db/src/depots/comptabilite.ts`) : les totaux rendus ici sont
      // donc identiques, au centime près, à ceux d'avant ce correctif — seule
      // la manière de les calculer change, jamais le résultat.
      const totaux = totaliserJournal(
        lignes.map((l) => ({
          date: l.dateDepense,
          libelle: l.libelle,
          categorie: l.categorie,
          montantCents: l.montantCents,
          deductibleBp: l.deductibleBp,
          immobilisee: l.immobilisationId !== null,
        })),
      );
      return schemaListeDepenses.parse({
        data: lignes,
        meta: {
          total: lignes.length,
          montantTotalCents: totaux.montantTotalCents,
          montantDeductibleTotalCents: totaux.montantDeductibleCents,
          // NOM À NE PAS CONFONDRE (mission du 01/08/2026) : ce champ-ci est la
          // part des DÉPENSES DE CETTE PÉRIODE partie en immobilisation — pas
          // la valeur totale des immobilisations elles-mêmes (qui sommerait
          // `immobilisation.montantCents` sur toute la table, indépendamment
          // de l'exercice des dépenses). Sans cette précision, l'écart entre
          // `montantTotalCents` et `montantDeductibleTotalCents` sur une
          // dépense de matériel immobilisé se lit comme une erreur de saisie
          // (docs/16-AUDIT-COMPTABILITE.md §4.1) — c'est `totaliserJournal` qui
          // fournit ce chiffre, `montantImmobiliseCents` en son sein, ici
          // exposé sous son nom historique côté contrat HTTP.
          montantImmobiliseTotalCents: totaux.montantImmobiliseCents,
        },
      });
    });

    app.post('/depenses', async (requete, reponse) => {
      const corps = schemaCreationDepense.parse(requete.body);
      // Reconstruction explicite plutot qu'un simple spread de `corps` : sous
      // `exactOptionalPropertyTypes`, un champ optionnel du contrat HTTP porte
      // `| undefined` que le depot ne veut pas voir (meme patron que
      // `routesSessions.creerSession`).
      const cree = enregistrerDepense(base, {
        dateDepense: corps.dateDepense,
        libelle: corps.libelle,
        categorie: corps.categorie,
        montantCents: corps.montantCents,
        ...(corps.fournisseurId === undefined ? {} : { fournisseurId: corps.fournisseurId }),
        ...(corps.justificatifPath === undefined
          ? {}
          : { justificatifPath: corps.justificatifPath }),
        ...(corps.deductibleBp === undefined ? {} : { deductibleBp: corps.deductibleBp }),
        ...(corps.immobilisationId === undefined
          ? {}
          : { immobilisationId: corps.immobilisationId }),
        ...(corps.notes === undefined ? {} : { notes: corps.notes }),
      });

      const trouvee = listerDepenses(base).find((l) => l.id === cree.id);
      if (trouvee === undefined) throw new Error(`Dépense ${cree.id} introuvable après création.`);

      reponse.code(201);
      return schemaDepenseLigne.parse(trouvee);
    });

    app.post<{ Params: { id: string } }>('/depenses/:id/annuler', async (requete) => {
      const corps = schemaAnnulationDepense.parse(requete.body);
      const contreEcriture = annulerDepense(base, requete.params.id, corps.motif);

      const trouvee = listerDepenses(base).find((l) => l.id === contreEcriture.id);
      if (trouvee === undefined) {
        throw new Error(`Contre-écriture ${contreEcriture.id} introuvable après annulation.`);
      }
      return schemaDepenseLigne.parse(trouvee);
    });

    /* ─── Immobilisations ────────────────────────────────────────────────── */

    app.get<{ Querystring: { annee?: string } }>('/immobilisations', async (requete) => {
      const annee = analyserAnnee(requete.query.annee);
      const lignes = listerImmobilisations(base, annee);
      return schemaListeImmobilisations.parse({
        data: lignes,
        meta: { total: lignes.length, annee },
      });
    });

    app.post('/immobilisations', async (requete, reponse) => {
      const corps = schemaCreationImmobilisation.parse(requete.body);
      const cree = enregistrerImmobilisation(base, {
        libelle: corps.libelle,
        dateAcquisition: corps.dateAcquisition,
        montantCents: corps.montantCents,
        dureeAmortissementAnnees: corps.dureeAmortissementAnnees,
        ...(corps.methode === undefined ? {} : { methode: corps.methode }),
        ...(corps.valeurResiduelleCents === undefined
          ? {}
          : { valeurResiduelleCents: corps.valeurResiduelleCents }),
        ...(corps.notes === undefined ? {} : { notes: corps.notes }),
      });

      const trouvee = listerImmobilisations(base).find((l) => l.id === cree.id);
      if (trouvee === undefined)
        throw new Error(`Immobilisation ${cree.id} introuvable après création.`);

      reponse.code(201);
      return schemaImmobilisationDetail.parse(trouvee);
    });

    /* ─── Échéancier réglementaire ───────────────────────────────────────── */

    app.get('/echeances', async () => {
      // Peuplement idempotent PAR ENTITE avant chaque lecture : un lancement
      // de l'application sans passage par le seed principal (hors périmètre
      // de ce lot) doit tout de même afficher l'échéancier réglementaire.
      seedEcheances(base);
      const lignes = listerEcheances(base);
      return schemaListeEcheances.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.post<{ Params: { id: string } }>('/echeances/:id/marquer-faite', async (requete) => {
      const corps = schemaMarquerEcheanceFaite.parse(requete.body ?? {});
      marquerEcheanceFaite(base, requete.params.id, corps.dateRealisation);

      const trouvee = listerEcheances(base).find((l) => l.id === requete.params.id);
      if (trouvee === undefined) throw new ErreurIntrouvable('Échéance', requete.params.id);
      return schemaEcheanceLigne.parse(trouvee);
    });

    /**
     * Saisie du montant estimé d'une échéance (audit du 30/07/2026 :
     * `echeance.montantEstimeCents` était déclarée dans le contrat de SORTIE,
     * écrite en dur à `null` pour toujours, et AUCUN schéma d'entrée ne
     * l'acceptait — un échéancier qui ne pouvait jamais dire combien une
     * échéance allait coûter).
     *
     * Écriture descendue dans `estimerMontantEcheance`
     * (packages/db/src/depots/comptabilite.ts — voir sa justification, y
     * compris sur l'absence VOLONTAIRE de verrou de période) : la route
     * valide l'entrée, appelle, sérialise, rien de plus (CLAUDE.md §3
     * règle 1).
     */
    app.post<{ Params: { id: string } }>('/echeances/:id/estimer-montant', async (requete) => {
      const corps = schemaEstimerMontantEcheance.parse(requete.body);
      estimerMontantEcheance(base, requete.params.id, corps.montantEstimeCents);

      const trouvee = listerEcheances(base).find((l) => l.id === requete.params.id);
      if (trouvee === undefined) throw new ErreurIntrouvable('Échéance', requete.params.id);
      return schemaEcheanceLigne.parse(trouvee);
    });

    /* ─── Verrou de période ──────────────────────────────────────────────── */

    app.get('/periodes', async () => {
      const lignes = listerPeriodes(base);
      return schemaListePeriodes.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.post('/periodes/cloturer', async (requete) => {
      const corps = schemaClotureRequisePeriode.parse(requete.body);
      const { id } = cloturerPeriode(base, corps.annee, corps.mois, corps.clotureePar ?? null);

      const trouvee = listerPeriodes(base).find((l) => l.id === id);
      if (trouvee === undefined) throw new Error(`Période ${id} introuvable après clôture.`);
      return schemaPeriodeLigne.parse(trouvee);
    });

    app.post<{ Params: { id: string } }>('/periodes/:id/rouvrir', async (requete) => {
      const corps = schemaReouverturePeriode.parse(requete.body);
      rouvrirPeriode(base, requete.params.id, corps.motif);

      const trouvee = listerPeriodes(base).find((l) => l.id === requete.params.id);
      if (trouvee === undefined) throw new ErreurIntrouvable('Période', requete.params.id);
      return schemaPeriodeLigne.parse(trouvee);
    });

    /**
     * Impact CHIFFRÉ d'un verrouillage, À CONSULTER AVANT de poser le geste
     * (docs/34-VERROU-COMPTABLE.md) : combien de mouvements de stock, de
     * réceptions, de productions et de sessions datés de ce mois deviendraient
     * DÉFINITIVEMENT incorrigibles, plus les dépenses/immobilisations du mois
     * à titre INFORMATIF (elles ne le deviennent pas — voir le commentaire de
     * `calculerImpactVerrouillagePeriode`, `packages/db/src/depots/comptabilite.ts`).
     * Route SÉPARÉE de `/periodes/:id/verrouiller` ci-dessous : l'écran doit
     * pouvoir afficher ce décompte SANS déclencher le verrou lui-même.
     */
    app.get<{ Params: { id: string } }>('/periodes/:id/impact-verrouillage', async (requete) => {
      const impact = calculerImpactVerrouillagePeriode(base, requete.params.id);
      return schemaImpactVerrouillagePeriode.parse(impact);
    });

    /**
     * Verrouille DÉFINITIVEMENT une période déjà clôturée (`verrouillerPeriode`,
     * `packages/db/src/depots/comptabilite.ts`, voir son commentaire pour
     * l'enchaînement imposé et l'irréversibilité établie). Aucun `motif` dans
     * le corps, à la différence de `/periodes/:id/rouvrir` : verrouiller
     * n'est pas une correction à justifier, c'est le geste principal attendu
     * une fois l'exercice transmis.
     */
    app.post<{ Params: { id: string } }>('/periodes/:id/verrouiller', async (requete) => {
      const corps = schemaVerrouillageRequisPeriode.parse(requete.body ?? {});
      const { id } = verrouillerPeriode(base, requete.params.id, corps.verrouillePar ?? null);

      const trouvee = listerPeriodes(base).find((l) => l.id === id);
      if (trouvee === undefined) throw new Error(`Période ${id} introuvable après verrouillage.`);
      return schemaPeriodeLigne.parse(trouvee);
    });

    /* ─── Synthèse d'exercice ────────────────────────────────────────────── */

    app.get<{ Querystring: { annee?: string } }>('/synthese-exercice', async (requete) => {
      const annee = analyserAnnee(requete.query.annee);
      return schemaSyntheseExercice.parse(syntheseExercice(base, annee));
    });

    /* ─── Ventes par créneau horaire (fiche 13, docs/17) ────────────────────
     *
     * Requête descendue dans `ventesParCreneauBrutes`
     * (packages/db/src/depots/comptabilite.ts — voir sa justification) : la
     * route valide l'entrée, appelle, sérialise, rien de plus (CLAUDE.md §3
     * règle 1).
     */
    app.get<{ Querystring: { annee?: string } }>('/ventes-par-creneau', async (requete) => {
      const annee = analyserAnnee(requete.query.annee);

      // Annotation explicite : le retour de `ventesParCreneauBrutes` n'est
      // typé qu'une fois le barillet câblé (voir le commentaire d'import
      // ci-dessus) — sans elle, `lignesBrutes` inférerait `any` en attendant.
      const lignesBrutes: LigneVenteCreneauBrute[] = ventesParCreneauBrutes(base, annee);
      const sessionsClotureesCount = new Set(lignesBrutes.map((l) => l.sessionId)).size;

      return schemaListeVentesParCreneau.parse({
        data: agregerVentesParCreneau(lignesBrutes),
        meta: { annee, nbSessionsCloturees: sessionsClotureesCount },
      });
    });
  };
}
