/**
 * Routes `/api/equipements` — équipements électriques du stand, diagnostic de
 * disjonction, point d'équilibre d'une autoproduction (solaire, éolien) et
 * empreinte — quantités physiques
 * (docs/demandes/17-ENERGIE-GAZ-ELECTRICITE-SOLAIRE-EMPREINTE.md, D-055,
 * §3, §4).
 *
 * ═══ Ce que ce module fait — et ne fait pas ═══
 *
 * L'API ASSEMBLE ET VALIDE, ELLE NE DÉCIDE RIEN (règle d'architecture n°1) :
 *  - la somme des puissances et le diagnostic de disjonction viennent de
 *    `sommePuissanceEnServiceW` / `diagnosticPuissanceLieu` ;
 *  - le point d'équilibre solaire/éolien et le coût moyen évité viennent de
 *    `pointEquilibreAutoproduction` / `coutEnergieEviteeAutoproductionMoyenne` ;
 *  - les quantités physiques de l'empreinte viennent de
 *    `quantitesPhysiquesParIngredient` / `kilometresParcourusAllerRetour` /
 *    `energieElectriqueTotaleKwh`
 *    (toutes dans `packages/core/src/energie.ts`) ;
 *  - CRUD standard sur `equipement`, sans suppression (CLAUDE.md §3 règle 7) —
 *    même geste que `routes/referentiel-ecriture.ts` pour `lieu_marche`.
 *
 * Les deux nouvelles routes (§3, §4) n'ajoutent VOLONTAIREMENT aucune
 * fonction au dépôt `packages/db` : elles composent des dépôts DÉJÀ EXPORTÉS
 * par `@batte/db` (`listerSessions`, `listerLieuxComplets`,
 * `listerIngredientsComplets`, `tousLesLots`, `listerImmobilisations`,
 * `utilisationsEquipementsSession`, `lireParametres`) — même patron que
 * `/equipements/diagnostic-puissance` juste en dessous (fetch puis délégation
 * du calcul à une fonction pure). Ce choix évite toute dépendance à un
 * câblage de barillet encore non fait (`packages/db/src/index.ts`, fichier
 * interdit à cet agent) : ces deux routes sont donc utilisables IMMÉDIATEMENT,
 * sans attendre un agent de câblage.
 *
 * AUCUNE ROUTE ICI N'ÉCRIT DE DURÉE D'UTILISATION PAR SESSION : le porteur a
 * indiqué que cette saisie a lieu À LA CLÔTURE (docs/demandes/17 §4bis.4).
 * L'utilisation d'un équipement s'écrit par `enregistrerUtilisationEquipement`
 * (`packages/db/src/depots/equipements.ts`), appelée depuis `cloturerSession`
 * (`packages/db/src/services/sessions.ts`) dans la même transaction que le
 * reste de la clôture. Ce module n'expose donc AUCUNE route d'écriture pour
 * cette donnée : en créer une ouvrirait deux chemins pour une seule vérité,
 * ce que ce projet évite systématiquement.
 *
 * LE PRIX DU KWH (`prix_kwh_cents_par_kwh`) est maintenant un paramètre du
 * catalogue (`packages/core/src/parametres.ts`) : une VALEUR DE DÉPART de
 * marché, à corriger avec le vrai contrat (voir sa `description`/`source`) —
 * jamais un taux réglementaire. `GET /equipements/point-equilibre-autoproduction`
 * le lit via `possede()` plutôt que `entier()` direct : tant que la base n'a
 * pas encore été re-seedée avec cette clé, le calcul reste `null` (inconnu),
 * jamais une estimation.
 */

import type { FastifyPluginAsync } from 'fastify';
import { schemaChangementActivite } from '@batte/core';
import type { BaseBatte } from '@batte/db';
import {
  schemaEmpreinteQuantitesPhysiques,
  schemaEquipement,
  schemaListeDiagnosticsPuissance,
  schemaListeEquipements,
  schemaListePointsEquilibreAutoproduction,
  schemaSaisieEquipement,
} from '@batte/core';
import {
  AVERTISSEMENT_EMPREINTE_CARBONE,
  AVERTISSEMENT_POINT_EQUILIBRE_AUTOPRODUCTION,
  coutEnergieEviteeAutoproductionMoyenne,
  diagnosticPuissanceLieu,
  energieElectriqueTotaleKwh,
  kilometresParcourusAllerRetour,
  pointEquilibreAutoproduction,
  quantitesPhysiquesParIngredient,
  sommePuissanceEnServiceW,
  type LigneUtilisationPourAutoproduction,
} from '@batte/core';
import {
  changerActiviteEquipement,
  creerEquipement,
  lieuxActifsPourDiagnosticPuissance,
  lireParametres,
  listerEquipements,
  listerImmobilisations,
  listerIngredientsComplets,
  listerLieuxComplets,
  listerSessions,
  modifierEquipement,
  tousLesLots,
  utilisationsEquipementsSession,
  type EquipementLigne,
} from '@batte/db';

/**
 * Retrouve la ligne qu'on vient d'écrire, pour la renvoyer à l'appelant.
 *
 * Une absence ici n'est PAS une faute de l'utilisateur : l'écriture vient de
 * réussir dans une transaction commitée. Même raisonnement et même fonction
 * que `retrouver` dans `routes/referentiel-ecriture.ts`.
 */
function retrouver(lignes: EquipementLigne[], id: string): EquipementLigne {
  const ligne = lignes.find((l) => l.id === id);
  if (ligne === undefined) throw new Error(`Équipement ${id} introuvable après écriture.`);
  return ligne;
}

export function routesEquipements(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /* ─── Liste, avec la puissance totale EN SERVICE en méta ──────────────── */
    app.get('/equipements', async () => {
      const lignes = listerEquipements(base);
      return schemaListeEquipements.parse({
        data: lignes,
        meta: {
          total: lignes.length,
          puissanceTotaleEnServiceW: sommePuissanceEnServiceW(lignes),
        },
      });
    });

    /**
     * Diagnostic de disjonction, pour CHAQUE lieu actif : la puissance requise
     * (le parc en service, la même pour tous les lieux — les appareils
     * voyagent avec le stand) comparée à la puissance disponible du lieu.
     *
     * Route STATIQUE, déclarée avant toute route à paramètre — même lecture
     * que `routes/concurrents.ts`.
     */
    app.get('/equipements/diagnostic-puissance', async () => {
      const equipements = listerEquipements(base);
      const puissanceRequiseW = sommePuissanceEnServiceW(equipements);
      const nbEquipementsEnService = equipements.filter((e) => e.enService && e.actif).length;

      const lieux = lieuxActifsPourDiagnosticPuissance(base);
      const data = lieux.map((lieu) => ({
        lieuId: lieu.lieuId,
        lieuNom: lieu.lieuNom,
        ...diagnosticPuissanceLieu(puissanceRequiseW, lieu.puissanceDisponibleW),
      }));

      return schemaListeDiagnosticsPuissance.parse({
        data,
        meta: { puissanceRequiseW, nbEquipementsEnService },
      });
    });

    /**
     * Point d'équilibre d'une autoproduction (solaire, éolien) —
     * docs/demandes/17 §3 : « au bout de combien de sessions l'installation
     * est-elle remboursée par l'électricité qu'on ne paie plus ? ».
     *
     * Une ligne PAR IMMOBILISATION existante (§3 : « rien de neuf à
     * construire pour le solaire, des panneaux sont une immobilisation comme
     * une remorque ou une plaque »), toutes comparées au MÊME coût d'énergie
     * moyen évité — `meta.avertissement` rappelle que ce calcul ne vaut que
     * pour un investissement qui PRODUIT de l'électricité.
     *
     * Le coût évité est restreint aux équipements qu'une autoproduction
     * mobile modeste peut RÉALISTEMENT alimenter (éclairage, froid actif,
     * terminal de paiement) : JAMAIS la cuisson ni le chauffage — le
     * garde-fou non négociable de la fiche (`coutEnergieEviteeAutoproductionMoyenne`,
     * `packages/core/src/energie.ts`). Sans ce filtre, comparer le coût des
     * panneaux au budget gaz TOTAL (presque entièrement de la cuisson)
     * donnerait un point d'équilibre bien trop optimiste.
     *
     * Route STATIQUE, déclarée avant toute route à paramètre.
     */
    app.get('/equipements/point-equilibre-autoproduction', async () => {
      // Sessions CLOSES uniquement : une session planifiée n'a encore rien
      // consommé, une session annulée non plus.
      const sessionsCloses = listerSessions(base)
        .filter((s) => s.statut === 'cloturee')
        .map((s) => ({ id: s.id, lieuId: s.lieuId }));
      const lieuxParId = new Map(listerLieuxComplets(base).map((lieu) => [lieu.id, lieu] as const));

      const lignesUtilisation: LigneUtilisationPourAutoproduction[] = [];
      for (const session of sessionsCloses) {
        const facturationElectricite =
          lieuxParId.get(session.lieuId)?.facturationElectricite ?? null;
        for (const usage of utilisationsEquipementsSession(base, session.id)) {
          lignesUtilisation.push({
            sessionId: session.id,
            type: usage.type,
            puissanceW: usage.puissanceW,
            dureeMinutes: usage.dureeMinutes,
            facturationElectricite,
          });
        }
      }

      // `possede()` et non `entier()` direct : tant que `prix_kwh_cents_par_kwh`
      // n'est pas encore en base (avant un `db:seed`), le prix reste `null`
      // (inconnu) plutôt qu'une erreur 500 — même doctrine que partout
      // ailleurs (une valeur inconnue rend `null`, jamais une estimation).
      const parametres = lireParametres(base);
      const prixKwhCentsParKwh = parametres.possede('prix_kwh_cents_par_kwh')
        ? parametres.entier('prix_kwh_cents_par_kwh')
        : null;

      const {
        coutMoyenParSessionCents,
        nbSessionsPriseEnCompte,
        raisonIndisponible: raisonCoutEviteIndisponible,
      } = coutEnergieEviteeAutoproductionMoyenne(lignesUtilisation, prixKwhCentsParKwh);

      const data = listerImmobilisations(base)
        .map((immobilisation) => {
          const resultat = pointEquilibreAutoproduction({
            coutInstallationCents: immobilisation.montantCents,
            coutEnergieEviteParSessionCents: coutMoyenParSessionCents,
          });
          return {
            immobilisationId: immobilisation.id,
            libelle: immobilisation.libelle,
            coutInstallationCents: immobilisation.montantCents,
            sessionsAvantEquilibre: resultat.sessionsAvantEquilibre,
            raisonIndisponible: resultat.raisonIndisponible,
          };
        })
        // Connu avant inconnu — même convention que la comparaison de lieux
        // (D-060) : jamais un tri qui laisse une inconnue se mêler aux
        // valeurs calculées.
        .sort((a, b) => {
          if (a.sessionsAvantEquilibre === null && b.sessionsAvantEquilibre === null) return 0;
          if (a.sessionsAvantEquilibre === null) return 1;
          if (b.sessionsAvantEquilibre === null) return -1;
          return a.sessionsAvantEquilibre - b.sessionsAvantEquilibre;
        });

      return schemaListePointsEquilibreAutoproduction.parse({
        data,
        meta: {
          coutEnergieEviteParSessionCents: coutMoyenParSessionCents,
          nbSessionsPriseEnCompte,
          raisonCoutEviteIndisponible,
          avertissement: AVERTISSEMENT_POINT_EQUILIBRE_AUTOPRODUCTION,
        },
      });
    });

    /**
     * Empreinte — quantités PHYSIQUES (docs/demandes/17 §4) : litres,
     * kilos, pièces, kilomètres, kWh — AUCUNE conversion en CO2
     * (`meta.avertissementConversionCarbone`, TOUJOURS présent). Les facteurs
     * d'émission sont des données réglementaires externes non sourcées ici
     * (CLAUDE.md §7) ; un LLM n'en calcule ni n'en estime aucun (CLAUDE.md §3
     * règle n°2). Afficher un chiffre de CO2 inventé serait pire que ne rien
     * afficher.
     *
     * Route STATIQUE, déclarée avant toute route à paramètre.
     */
    app.get('/equipements/empreinte-quantites-physiques', async () => {
      const parIngredient = quantitesPhysiquesParIngredient(
        tousLesLots(base),
        listerIngredientsComplets(base),
      );

      const sessionsCloses = listerSessions(base)
        .filter((s) => s.statut === 'cloturee')
        .map((s) => ({ id: s.id, lieuId: s.lieuId }));
      const lieuxParId = new Map(listerLieuxComplets(base).map((lieu) => [lieu.id, lieu] as const));

      const { totalKm, nbSessionsDistanceInconnue } = kilometresParcourusAllerRetour(
        sessionsCloses.map((session) => ({
          distanceKmAllerSimple: lieuxParId.get(session.lieuId)?.distanceKm ?? null,
        })),
      );

      // TOUS les types d'équipement comptent ici (cuisson et chauffage
      // compris) : à la différence du point d'équilibre solaire ci-dessus,
      // l'empreinte physique ne filtre rien — ce qui a été consommé pèse,
      // même si le solaire ne peut pas le fournir.
      const lignesUtilisation: { puissanceW: number; dureeMinutes: number }[] = [];
      for (const session of sessionsCloses) {
        for (const usage of utilisationsEquipementsSession(base, session.id)) {
          lignesUtilisation.push({
            puissanceW: usage.puissanceW,
            dureeMinutes: usage.dureeMinutes,
          });
        }
      }

      return schemaEmpreinteQuantitesPhysiques.parse({
        data: parIngredient,
        meta: {
          kilometresParcourus: totalKm,
          nbSessionsDistanceInconnue,
          energieElectriqueKwh: energieElectriqueTotaleKwh(lignesUtilisation),
          avertissementConversionCarbone: AVERTISSEMENT_EMPREINTE_CARBONE,
        },
      });
    });

    app.post('/equipements', async (requete) => {
      const saisie = schemaSaisieEquipement.parse(requete.body);
      const id = creerEquipement(base, saisie);
      return schemaEquipement.parse(retrouver(listerEquipements(base), id));
    });

    app.patch<{ Params: { id: string } }>('/equipements/:id', async (requete) => {
      const saisie = schemaSaisieEquipement.parse(requete.body);
      modifierEquipement(base, requete.params.id, saisie);
      return schemaEquipement.parse(retrouver(listerEquipements(base), requete.params.id));
    });

    /** Le remplaçant de la suppression (CLAUDE.md §3 règle 7) : on ne supprime pas, on retire. */
    app.patch<{ Params: { id: string } }>('/equipements/:id/activite', async (requete) => {
      const { actif } = schemaChangementActivite.parse(requete.body);
      changerActiviteEquipement(base, requete.params.id, actif);
      return schemaEquipement.parse(retrouver(listerEquipements(base), requete.params.id));
    });
  };
}
