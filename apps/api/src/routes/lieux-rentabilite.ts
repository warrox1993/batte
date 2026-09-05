/**
 * Route `/api/lieux-rentabilite` — comparaison des lieux par marge nette
 * ATTENDUE (docs/demandes/13-COUT-COMPLET-ET-ARBITRAGE-ENTRE-LIEUX.md).
 *
 * ORCHESTRE, NE CALCULE PAS (même règle que `routes/previsions.ts`, dont
 * cette route réutilise les lectures — `observationsDuLieu`, `coutsNewsvendor`
 * — SANS jamais recalculer la prévision elle-même) :
 *  - la baseline de fréquentation vient de `calculerBaseline`
 *    (`packages/core/src/prevision/baseline.ts`), déjà utilisée par le moteur
 *    de prévision ;
 *  - les coûts moyens mesurés viennent de `coutsNewsvendor` (déjà utilisé par
 *    `previsionCourante`) et de `coutGazMoyenParCrepe` (nouveau, même lecture
 *    des sessions closes) ;
 *  - la composition finale (CA attendu → marge nette) est une fonction PURE
 *    de `packages/core/src/deplacement.ts`.
 *
 * DEUX CHIFFRES, PAS UN (docs/demandes/13 §2) : cet écran ne montre QUE des
 * coûts qui varient selon le lieu (matière, emplacement, déplacement, gaz).
 * Aucune charge fixe (assurance, cotisations, amortissements) n'y figure —
 * ce sont les écrans de comptabilité générale et analytique qui les portent,
 * pour répondre à une question différente (« combien je gagne vraiment »).
 *
 * Chaque prévision de baseline reste NEUTRE (météo/événement neutralisés,
 * PAS la recommandation de production du moteur newsvendor) : comparer des
 * lieux n'est pas prévoir UNE session précise à une date donnée, pour
 * laquelle il n'existe ni relevé météo ni contrainte de capacité connue à
 * l'avance. Voir le rapport de livraison pour la discussion complète.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  avertissementCoutsManquants,
  calculerBaseline,
  calculerMargeAttendueLieu,
  coutDeplacementSessionCents,
  coutEmplacementSessionCents,
  coutKilometriqueRetenu,
  definitionParametre,
  fiabiliteLieu,
  schemaListeComparaisonLieux,
  type ObservationSession,
} from '@batte/core';
import {
  aujourdHui,
  coutGazMoyenParCrepe,
  coutsNewsvendor,
  lieuxActifsPourRentabilite,
  lireParametres,
  observationsDuLieu,
  type BaseBatte,
} from '@batte/db';
// `mesureCoutVehicule` est NEUF (fiche 13 §3.1, voie B) : hors du barrel
// `@batte/db` (liste explicite, pas d'étoile) tant que l'orchestrateur ne l'y
// ajoute pas — même convention que `sessionsEntrepriseFermees` dans
// `routes/opportunites.ts`. Voir le rapport de livraison pour la ligne exacte
// à ajouter à `packages/db/src/index.ts`.
import { mesureCoutVehicule } from '@batte/db';

const CLE_COUT_KILOMETRIQUE = 'cout_kilometrique_cents_par_km';
const CLE_PLEINS_MINIMUM = 'cout_kilometrique_mesure_pleins_minimum';

export function routesLieuxRentabilite(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /**
     * Comparaison des lieux actifs, triée par marge nette attendue
     * décroissante — les lieux dont la marge est INCONNUE (distance ou coût
     * manquant) restent en fin de liste : les classer premiers ferait croire,
     * à tort, qu'ils sont les plus rentables (docs/demandes/13, « NULL veut
     * dire inconnu, jamais zéro, l'écran doit le dire, pas le classer
     * premier »).
     */
    app.get('/lieux-rentabilite', async () => {
      const jour = aujourdHui();
      const parametres = lireParametres(base, jour);

      // Forfait officiel ET mesuré (docs/demandes/13 §3.1, option double n°1) :
      // le mesuré prime dès qu'il repose sur assez de pleins
      // (`cout_kilometrique_mesure_pleins_minimum`), sinon le forfait
      // s'applique — jamais un blocage en attendant assez de données
      // (CLAUDE.md §5). `coutKilometriqueRetenu` (pure, `@batte/core`) décide ;
      // cette route ne fait que lire les deux entrées et composer.
      const coutRetenu = coutKilometriqueRetenu({
        forfaitCentsParKm: parametres.decimal(CLE_COUT_KILOMETRIQUE),
        mesure: mesureCoutVehicule(base),
        pleinsMinimum: parametres.entier(CLE_PLEINS_MINIMUM),
      });
      const coutKilometriqueCentsParKm = coutRetenu.centsParKm;
      const coutKilometriqueSource = definitionParametre(CLE_COUT_KILOMETRIQUE)?.source ?? '';
      const seuilPeuFiable = parametres.entier('prevision_sessions_avant_sigma_mesure');
      const seuilFiable = parametres.entier('prevision_sessions_sigma_fiable');

      const couts = coutsNewsvendor(base);
      // Le prix moyen se LIT, il ne se reconstruit pas. `coutRupture +
      // coutInvendu` ne redonne le prix que lorsque le prix couvre la matière ;
      // dans le cas contraire cette somme rendait la matière elle-même en
      // guise de prix. Et les deux inconnues sont indépendantes : un coût
      // matière inconnu passait pour une matière gratuite dans la marge d'un
      // lieu, ce qui pouvait faire recommander le mauvais emplacement.
      const avertissementCouts = avertissementCoutsManquants({
        prixMoyenConnu: couts.prixMoyenConnu,
        coutMatiereConnu: couts.coutInvenduConnu,
      });
      const coutsDisponibles = avertissementCouts === null;

      const gaz = coutGazMoyenParCrepe(base);

      const lieux = lieuxActifsPourRentabilite(base);

      const lignes = lieux.map((lieu) => {
        const observations: ObservationSession[] = observationsDuLieu(base, lieu.lieuId);
        const baseline = calculerBaseline(observations, jour, parametres);
        const crepesPrevuesBaseline = Math.max(0, baseline.baselineCrepes);

        const emplacement = coutEmplacementSessionCents({
          tarifEmplacementCents: lieu.tarifEmplacementCents,
          modeTarification: lieu.modeTarification,
        });

        const margeNette = calculerMargeAttendueLieu({
          crepesPrevues: crepesPrevuesBaseline,
          prixMoyenCrepeCents: couts.prixMoyenConnu ? couts.prixMoyenCrepeCents : null,
          coutMatiereCrepeCents: couts.coutInvenduConnu ? couts.coutInvenduCents : null,
          coutGazCrepeCents: gaz.mesure ? gaz.cents : null,
          coutEmplacementSessionCents: emplacement.cents,
          coutDeplacementSessionCents: coutDeplacementSessionCents(
            lieu.distanceKm,
            coutKilometriqueCentsParKm,
          ),
        });

        return {
          lieuId: lieu.lieuId,
          lieuNom: lieu.lieuNom,
          distanceKm: lieu.distanceKm,
          crepesPrevuesBaseline,
          nbSessionsRetenues: baseline.nbSessionsRetenues,
          poidsPriorBp: baseline.poidsPriorBp,
          fiabilite: fiabiliteLieu(baseline.nbSessionsRetenues, seuilPeuFiable, seuilFiable),
          explicationBaseline: baseline.explication,
          caAttenduCents: margeNette.caAttenduCents,
          coutMatiereAttenduCents: margeNette.coutMatiereAttenduCents,
          coutGazAttenduCents: margeNette.coutGazAttenduCents,
          coutEmplacementCents: margeNette.coutEmplacementCents,
          coutEmplacementIndisponibleRaison: emplacement.raisonIndisponible,
          coutDeplacementCents: margeNette.coutDeplacementCents,
          margeNetteAttendueCents: margeNette.margeNetteAttendueCents,
        };
      });

      const triees = [...lignes].sort((a, b) => {
        if (a.margeNetteAttendueCents === null && b.margeNetteAttendueCents === null) return 0;
        if (a.margeNetteAttendueCents === null) return 1;
        if (b.margeNetteAttendueCents === null) return -1;
        return b.margeNetteAttendueCents - a.margeNetteAttendueCents;
      });

      return schemaListeComparaisonLieux.parse({
        data: triees,
        meta: {
          total: triees.length,
          coutKilometriqueCentsParKm,
          coutKilometriqueSource,
          coutKilometriqueOrigine: coutRetenu.origine,
          coutKilometriqueLibelle: coutRetenu.libelle,
          coutsDisponibles,
          avertissementCouts,
        },
      });
    });
  };
}
