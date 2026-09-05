/**
 * Route `/api/opportunites` — l'écran « Où aller ? »
 * (docs/demandes/14-EVENEMENTS-COMME-OPPORTUNITES.md).
 *
 * ORCHESTRE, NE CALCULE PAS (même règle que `routes/lieux-rentabilite.ts`,
 * dont cette route réutilise la composition SANS la recalculer) :
 *  - le coût de déplacement et d'emplacement PAR SESSION viennent de
 *    `packages/core/src/deplacement.ts` (fiche 13) ;
 *  - l'agrégation de CAMPAGNE (plusieurs jours de marché de Noël) et le
 *    prédicteur « effectif × taux de prise » d'un stand entreprise viennent
 *    de `packages/core/src/opportunites.ts` (fiche 14) ;
 *  - la baseline de fréquentation (grand public / marché de Noël avec un lieu
 *    déjà visité) vient de `calculerBaseline`
 *    (`packages/core/src/prevision/baseline.ts`), déjà utilisée par le moteur
 *    de prévision ET par `routes/lieux-rentabilite.ts`.
 *
 * ═══ Import inter-paquet temporaire ═══
 *
 * `packages/core/src/opportunites.ts`, `packages/core/src/contrats/
 * opportunites.ts` sont réexportés en étoile par `@batte/core`. Côté
 * `@batte/db`, la réexportation se fait par une liste EXPLICITE (pas
 * d'étoile) : tout symbole de dépôt utilisé ici doit donc figurer nommément
 * dans `packages/db/src/index.ts` — c'est le seul point d'entrée du paquet,
 * un import relatif profond casserait à l'exécution.
 *
 * ═══ Les trois familles ne se prévoient pas pareil (fiche 14 §3) ═══
 *
 * `entreprise` utilise l'effectif × un taux de prise — jamais un historique
 * de fréquentation. `grand_public` et `marche_noel` réutilisent la baseline
 * de la fiche 13, mais SEULEMENT si le lieu rattaché a déjà une session
 * close : le premier chiffrage d'un lieu jamais visité était un
 * **[À TRANCHER]** du porteur (fiche 14 §3.1) — TRANCHÉ le 31/07/2026
 * (**D-082**, `docs/05-DECISIONS.md`) : zéro session close → aucune
 * prévision, jamais un chiffre. Voir `previsionOpportunite` et
 * `composerLigneOpportunite` ci-dessous, et `estPremierPassage`
 * (`packages/core/src/prevision/baseline.ts`) pour le seuil partagé avec
 * l'écran « Prochaine session ».
 *
 * ═══ D-082, conséquence sur le CLASSEMENT de cet écran ═══
 *
 * Puisqu'aucun revenu ne peut être estimé pour un premier passage, le tri
 * (ci-dessous, `app.get('/opportunites', …)`) ne le fait jamais remonter par
 * un revenu supposé : les lignes à marge connue restent classées par marge
 * nette décroissante (inchangé), mais PARMI les lignes à marge inconnue, le
 * départage se fait sur le COÛT connu (déplacement + emplacement) croissant
 * — la moins chère en tête — plutôt que de les laisser dans un ordre
 * arbitraire hérité de `listerOpportunitesActives`. Le porteur décide en
 * voyant ce que l'occasion COÛTE, jamais ce qu'elle rapporterait.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  avertissementCoutsManquants,
  calculerBaseline,
  coutDeplacementSessionCents,
  coutEmplacementSessionCents,
  definitionParametre,
  estPremierPassage,
  fiabiliteLieu,
  type FiabiliteLieu,
  type ObservationSession,
  type Parametres,
} from '@batte/core';
import {
  aujourdHui,
  coutGazMoyenParCrepe,
  coutsNewsvendor,
  lireParametres,
  observationsDuLieu,
  type BaseBatte,
  type CoutGazMoyen,
} from '@batte/db';
import {
  fiabiliteOpportunite,
  margeNetteAttendueOpportunite,
  nombreSessionsCampagne,
  previsionCrepesEntreprise,
  tauxPriseEntrepriseObserve,
  type FamilleOpportunite,
} from '@batte/core';
import {
  schemaCreationOpportunite,
  schemaLigneOpportunite,
  schemaListeOpportunites,
  schemaRattachementLieuOpportunite,
  type LigneOpportunite,
} from '@batte/core';
import {
  creerOpportunite,
  listerOpportunitesActives,
  rattacherLieuOpportunite,
  rejeterOpportunite,
  type OpportuniteCandidate,
} from '@batte/db';
import { sessionsEntrepriseFermees } from '@batte/db';

const CLE_COUT_KILOMETRIQUE = 'cout_kilometrique_cents_par_km';

type ContexteCalcul = {
  readonly base: BaseBatte;
  readonly jour: string;
  readonly parametres: Parametres;
  readonly coutKilometriqueCentsParKm: number;
  readonly seuilPeuFiable: number;
  readonly seuilFiable: number;
  /** Sessions closes minimum chez LA MÊME entreprise avant que SON taux de
   *  prise devienne utilisable (D-059) — voir `tauxPriseEntrepriseObserve`. */
  readonly seuilObservationsEntrepriseMinimum: number;
  readonly prixMoyenCrepeCents: number;
  readonly coutMatiereCrepeCents: number;
  /**
   * Deux drapeaux et non un seul : le prix moyen et le coût matière sont deux
   * inconnues indépendantes. Les confondre faisait passer un coût matière
   * inconnu pour une matière gratuite dans la marge d'une opportunité.
   */
  readonly prixMoyenConnu: boolean;
  readonly coutMatiereConnu: boolean;
  /** `null` quand les deux précédents sont connus — la marge est alors calculable. */
  readonly avertissementCouts: string | null;
  readonly gaz: CoutGazMoyen;
};

function chargerContexte(base: BaseBatte): ContexteCalcul {
  const jour = aujourdHui();
  const parametres = lireParametres(base, jour);
  const couts = coutsNewsvendor(base);

  return {
    base,
    jour,
    parametres,
    coutKilometriqueCentsParKm: parametres.decimal(CLE_COUT_KILOMETRIQUE),
    seuilPeuFiable: parametres.entier('prevision_sessions_avant_sigma_mesure'),
    seuilFiable: parametres.entier('prevision_sessions_sigma_fiable'),
    seuilObservationsEntrepriseMinimum: parametres.entier(
      'opportunite_entreprise_observations_minimum',
    ),
    // Le prix moyen se LIT (`couts.prixMoyenCrepeCents`), il ne se reconstruit
    // pas par `coutRupture + coutInvendu` : cette somme ne redonne le prix que
    // lorsque le prix couvre la matière, et rendait sinon la matière elle-même
    // en guise de prix.
    prixMoyenCrepeCents: couts.prixMoyenCrepeCents,
    coutMatiereCrepeCents: couts.coutInvenduCents,
    prixMoyenConnu: couts.prixMoyenConnu,
    coutMatiereConnu: couts.coutInvenduConnu,
    avertissementCouts: avertissementCoutsManquants({
      prixMoyenConnu: couts.prixMoyenConnu,
      coutMatiereConnu: couts.coutInvenduConnu,
    }),
    gaz: coutGazMoyenParCrepe(base),
  };
}

/**
 * Fréquentation attendue PAR SESSION, fiabilité et explication — selon la
 * famille (fiche 14 §3). Séparée de la composition de marge (`packages/core/
 * src/opportunites.ts`) : ce choix-ci lit la base (baseline d'un lieu,
 * observations), ce qui n'a pas sa place dans `packages/core`.
 */
function previsionOpportunite(
  candidate: OpportuniteCandidate,
  contexte: ContexteCalcul,
): {
  crepesPrevuesParSession: number | null;
  fiabilite: FiabiliteLieu;
  nbSessionsRetenues: number;
  explicationPrevision: string;
} {
  if (candidate.famille === 'entreprise') {
    // « Le prédicteur naturel est l'effectif × un taux de prise, pas
    // l'historique de fréquentation » (fiche 14 §3.2) — décision déjà prise
    // par le porteur, pas un [À TRANCHER]. Le taux de prise, lui, ne peut
    // venir que de l'observation (D-059) : `sessionsEntrepriseFermees` lit
    // les sessions closes rattachées à CETTE SEULE entreprise (même
    // `evenement.id` que `candidate`), jamais celles d'une autre — voir le
    // piège documenté dans `packages/core/src/opportunites.ts`
    // (`tauxPriseEntrepriseObserve`) : un taux mesuré chez une entreprise ne
    // se transporte jamais à une autre.
    const observations = sessionsEntrepriseFermees(contexte.base, candidate.id);
    const mesure = tauxPriseEntrepriseObserve(
      observations,
      contexte.seuilObservationsEntrepriseMinimum,
    );
    const crepesPrevuesParSession = previsionCrepesEntreprise(
      candidate.effectifEstime,
      mesure.tauxPriseBp,
    );

    const explicationPrevision = ((): string => {
      if (candidate.effectifEstime === null) {
        return "Effectif non renseigné : la prévision ne peut pas être calculée pour cette opportunité d'entreprise.";
      }
      if (mesure.nbObservations === 0) {
        return (
          "Aucune session close n'est encore rattachée à cette entreprise : le taux de prise " +
          "ne peut venir que de l'observation (docs/demandes/14 §3.2, D-059). Rattachez-y une " +
          "session close pour commencer à l'apprendre."
        );
      }
      if (mesure.tauxPriseBp === null) {
        return (
          `Taux de prise mesuré sur seulement ${mesure.nbObservations} session` +
          `${mesure.nbObservations > 1 ? 's' : ''} chez cette entreprise : en dessous du seuil ` +
          "retenu pour s'y fier — la prévision reste silencieuse plutôt que d'utiliser une " +
          'mesure trop jeune.'
        );
      }
      return (
        `Taux de prise estimé sur ${mesure.nbObservations} session` +
        `${mesure.nbObservations > 1 ? 's' : ''} passée${mesure.nbObservations > 1 ? 's' : ''} ` +
        'chez CETTE entreprise — propre à elle, il ne se transporte pas à une autre ' +
        '(docs/demandes/14 §3.2, D-059).'
      );
    })();

    return {
      crepesPrevuesParSession,
      // Jamais mieux que « peu_fiable » ici, même avec beaucoup d'observations :
      // c'est une mesure sur UNE SEULE entreprise, elle ne dit rien d'une autre
      // (voir le piège ci-dessus) — la confondre avec la fiabilité d'un LIEU
      // visité de nombreuses fois tromperait la lecture.
      fiabilite: mesure.tauxPriseBp === null ? 'aucune_donnee' : 'peu_fiable',
      nbSessionsRetenues: mesure.nbObservations,
      explicationPrevision,
    };
  }

  // grand_public / marche_noel : réutilise EXACTEMENT `calculerBaseline`
  // (fiche 13), mais seulement s'il existe une VRAIE session close pour le
  // lieu rattaché. Le premier chiffrage d'un lieu jamais visité était un
  // **[À TRANCHER]** du porteur (fiche 14 §3.1 : affluence annoncée ? session
  // comparable ? démarrage à froid ?) — TRANCHÉ le 31/07/2026 (**D-082** :
  // aucun chiffre, premier passage exploratoire). `estPremierPassage` est le
  // MÊME seuil strict que celui appliqué par `previsionCourante`
  // (`apps/api/src/routes/previsions.ts`, écran « Prochaine session ») : zéro
  // session close, jamais le prior de démarrage à froid utilisé comme si
  // c'était une mesure.
  const observations: ObservationSession[] =
    candidate.lieuId === null ? [] : observationsDuLieu(contexte.base, candidate.lieuId);
  const baseline = calculerBaseline(observations, contexte.jour, contexte.parametres);
  const fiabilite = fiabiliteLieu(
    baseline.nbSessionsRetenues,
    contexte.seuilPeuFiable,
    contexte.seuilFiable,
  );

  if (!estPremierPassage(baseline.nbSessionsRetenues)) {
    return {
      crepesPrevuesParSession: Math.max(0, baseline.baselineCrepes),
      fiabilite,
      nbSessionsRetenues: baseline.nbSessionsRetenues,
      explicationPrevision: baseline.explication,
    };
  }

  return {
    crepesPrevuesParSession: null,
    fiabilite,
    nbSessionsRetenues: 0,
    explicationPrevision:
      'Premier passage : aucune session n’a encore été close à cet endroit, donc aucune ' +
      'prévision de fréquentation n’est possible (décision D-082, docs/05-DECISIONS.md) — ' +
      'ni CA attendu, ni marge, tant qu’un premier marché n’y aura pas eu lieu. Les coûts déjà ' +
      'connus (déplacement, emplacement) restent affichés pour comparer cette occasion aux autres.',
  };
}

function composerLigneOpportunite(
  candidate: OpportuniteCandidate,
  contexte: ContexteCalcul,
): LigneOpportunite {
  const nbSessions = nombreSessionsCampagne(
    candidate.famille,
    candidate.dateDebut,
    candidate.dateFin,
  );

  // Distance : ROUTIÈRE si un lieu rattaché en déclare une (fiche 13) ;
  // sinon, À VOL D'OISEAU (fiche 05) en dernier recours — jamais l'inverse,
  // la distance routière est toujours la plus fiable des deux.
  const distanceRoutiereConnue =
    candidate.lieuId !== null && candidate.lieuDistanceRoutiereKm !== null;
  const distanceKm = distanceRoutiereConnue
    ? candidate.lieuDistanceRoutiereKm
    : candidate.distanceVolDoiseauKm;
  const distanceEstimeeVolDoiseau = !distanceRoutiereConnue && distanceKm !== null;

  const coutDeplacementParSessionCents = coutDeplacementSessionCents(
    distanceKm,
    contexte.coutKilometriqueCentsParKm,
  );
  const coutEmplacementParSession = coutEmplacementSessionCents({
    tarifEmplacementCents: candidate.tarifEmplacementCents,
    modeTarification: candidate.modeTarification,
  });

  const prevision = previsionOpportunite(candidate, contexte);
  const fiabilite = fiabiliteOpportunite(prevision.fiabilite, distanceEstimeeVolDoiseau);

  const margeNette = margeNetteAttendueOpportunite({
    nbSessions,
    crepesPrevuesParSession: prevision.crepesPrevuesParSession,
    prixMoyenCrepeCents: contexte.prixMoyenConnu ? contexte.prixMoyenCrepeCents : null,
    coutMatiereCrepeCents: contexte.coutMatiereConnu ? contexte.coutMatiereCrepeCents : null,
    coutGazCrepeCents: contexte.gaz.mesure ? contexte.gaz.cents : null,
    coutEmplacementParSession,
    modeTarification: candidate.modeTarification,
    coutDeplacementParSessionCents,
  });

  return {
    id: candidate.id,
    nom: candidate.nom,
    type: candidate.type,
    famille: candidate.famille as FamilleOpportunite,
    dateDebut: candidate.dateDebut,
    dateFin: candidate.dateFin,
    nbSessions,
    communeTexte: candidate.communeTexte,
    lieuId: candidate.lieuId,
    lieuNom: candidate.lieuNom,
    distanceKm,
    distanceEstimeeVolDoiseau,
    effectifEstime: candidate.effectifEstime,
    fiabilite,
    nbSessionsRetenues: prevision.nbSessionsRetenues,
    explicationPrevision: prevision.explicationPrevision,
    crepesPrevuesParSession: prevision.crepesPrevuesParSession,
    crepesPrevuesTotal: margeNette.crepesPrevuesTotal,
    caAttenduCents: margeNette.caAttenduCents,
    coutMatiereAttenduCents: margeNette.coutMatiereAttenduCents,
    coutGazAttenduCents: margeNette.coutGazAttenduCents,
    coutEmplacementCents: margeNette.coutEmplacementCents,
    coutEmplacementIndisponibleRaison: margeNette.coutEmplacementIndisponibleRaison,
    coutDeplacementCents: margeNette.coutDeplacementCents,
    margeNetteAttendueCents: margeNette.margeNetteAttendueCents,
    source: candidate.source,
    notes: candidate.notes,
  };
}

/**
 * Coût total CONNU d'une ligne à marge inconnue (D-082) : quand ni CA ni
 * marge ne peuvent départager deux opportunités, seul ce qui reste connu —
 * le coût — peut encore aider à choisir. `null` UNIQUEMENT quand AUCUNE des
 * deux composantes n'est connue (relègue ces lignes après celles dont on
 * connaît au moins un coût) ; sinon, une composante manquante compte pour
 * zéro dans la SOMME — ce zéro ne sert QUE de clé de tri, il n'est jamais
 * affiché ni renvoyé au client comme un coût réel (`coutDeplacementCents`/
 * `coutEmplacementCents` restent `null` tels quels dans la ligne rendue).
 */
function coutConnuPourTri(ligne: LigneOpportunite): number | null {
  if (ligne.coutDeplacementCents === null && ligne.coutEmplacementCents === null) return null;
  return (ligne.coutDeplacementCents ?? 0) + (ligne.coutEmplacementCents ?? 0);
}

export function routesOpportunites(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /**
     * Opportunités actives, triées par marge nette attendue DÉCROISSANTE —
     * les lignes à marge INCONNUE (fréquentation ou coût manquant) restent en
     * fin de liste, jamais en tête (même règle que `/lieux-rentabilite`,
     * docs/demandes/14 §6 : « la fiabilité n'est pas décorative »).
     *
     * D-082 : PARMI les lignes à marge inconnue (premier passage sur un
     * lieu, ou taux de prise entreprise pas encore mesuré), le départage se
     * fait sur le COÛT connu croissant (`coutConnuPourTri`), jamais sur un
     * revenu supposé — avant ce correctif, ces lignes gardaient l'ordre
     * arbitraire hérité de `listerOpportunitesActives`, ce qui n'aidait en
     * rien à choisir entre elles.
     */
    app.get('/opportunites', async () => {
      const contexte = chargerContexte(base);
      const candidats = listerOpportunitesActives(base, contexte.jour);
      const lignes = candidats.map((candidat) => composerLigneOpportunite(candidat, contexte));

      const triees = [...lignes].sort((a, b) => {
        if (a.margeNetteAttendueCents !== null && b.margeNetteAttendueCents !== null) {
          return b.margeNetteAttendueCents - a.margeNetteAttendueCents;
        }
        if (a.margeNetteAttendueCents !== null) return -1;
        if (b.margeNetteAttendueCents !== null) return 1;

        const coutA = coutConnuPourTri(a);
        const coutB = coutConnuPourTri(b);
        if (coutA !== null && coutB !== null) return coutA - coutB;
        if (coutA !== null) return -1;
        if (coutB !== null) return 1;
        return 0;
      });

      return schemaListeOpportunites.parse({
        data: triees,
        meta: {
          total: triees.length,
          coutKilometriqueCentsParKm: contexte.coutKilometriqueCentsParKm,
          coutKilometriqueSource: definitionParametre(CLE_COUT_KILOMETRIQUE)?.source ?? '',
          coutsDisponibles: contexte.avertissementCouts === null,
          avertissementCouts: contexte.avertissementCouts,
          // Ne porte QUE sur les lignes pas encore mesurables (pas sur toute
          // opportunité entreprise) : une entreprise dont le taux est déjà
          // établi n'a pas à porter cet avertissement.
          avertissementTauxPriseEntreprise: triees.some(
            (l) => l.famille === 'entreprise' && l.crepesPrevuesParSession === null,
          )
            ? 'Le taux de prise d’au moins un stand entreprise n’est pas encore mesurable (pas ' +
              'assez de sessions closes rattachées à CETTE entreprise) : ces lignes affichent ' +
              'une fréquentation et une marge inconnues tant que l’observation ne s’est pas ' +
              'accumulée. Un taux mesuré ne s’applique qu’à l’entreprise qui l’a produit, ' +
              'jamais à une autre (docs/demandes/14 §3.2, D-059).'
            : null,
        },
      });
    });

    /** Création d'une opportunité — hors du parcours « facteur classique ». */
    app.post('/opportunites', async (requete) => {
      const corps = schemaCreationOpportunite.parse(requete.body);
      const cree = creerOpportunite(base, {
        nom: corps.nom,
        type: corps.type,
        famille: corps.famille,
        dateDebut: corps.dateDebut,
        dateFin: corps.dateFin,
        communeTexte: corps.communeTexte ?? null,
        lieuId: corps.lieuId ?? null,
        distanceKm: corps.distanceKm ?? null,
        effectifEstime: corps.effectifEstime ?? null,
        source: corps.source ?? null,
        notes: corps.notes ?? null,
      });

      const contexte = chargerContexte(base);
      return schemaLigneOpportunite.parse(composerLigneOpportunite(cree, contexte));
    });

    /** Rattache l'opportunité à un lieu de marché déjà déclaré (distance/tarif réels). */
    app.patch<{ Params: { id: string } }>(
      '/opportunites/:id/rattacher-lieu',
      async (requete, reponse) => {
        const corps = schemaRattachementLieuOpportunite.parse(requete.body);
        rattacherLieuOpportunite(base, requete.params.id, corps.lieuId);
        reponse.code(204);
        return null;
      },
    );

    /** Écarte une opportunité (« je n'y vais pas ») — jamais un DELETE. */
    app.post<{ Params: { id: string } }>('/opportunites/:id/rejeter', async (requete, reponse) => {
      rejeterOpportunite(base, requete.params.id);
      reponse.code(204);
      return null;
    });
  };
}
