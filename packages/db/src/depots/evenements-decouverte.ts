/**
 * Dépôt de la découverte automatique d'événements (fiche
 * `docs/demandes/05-EVENEMENTS-DECOUVERTE-IA-RAYON-REGLABLE.md`).
 *
 * ═══ Ce dépôt écrit dans la table `evenement` existante ═══
 *
 * Aucune nouvelle table n'est créée : une proposition IA est un `evenement`
 * comme un autre, avec `source = 'ia'` et `valide_par_humain = false`
 * (`docs/02-MODELE-DONNEES.md` — ces deux colonnes existaient déjà). Une fois
 * validée (`validerPropositionEvenement`), la ligne devient indiscernable
 * d'un événement saisi à la main : `evenementsDuJour` / `facteurEvenementBp`
 * (`./previsions.js`) la prennent en compte SANS aucune modification de leur
 * part, puisqu'ils ne filtrent que sur `valide_par_humain`.
 *
 * ═══ Remboursement de dette : colonnes propres, `notes` redevenu libre ═══
 *
 * Une première version n'avait ni `lieu_id`, ni `distance_km`, ni
 * `commune_texte`, ni colonne de statut sur `evenement` : le lieu de
 * recherche, le rayon, la distance et le résumé étaient encodés dans `notes`
 * (`encoderNotesPropositionIa` / `decoderNotesPropositionIa`), et le rejet
 * marqué par un texte ajouté au même champ. C'était fonctionnel et testé,
 * mais c'était une dette réelle : `notes` est un champ libre que l'écran
 * Événements laisse l'utilisateur éditer (`apps/web/src/pages/Evenements.tsx`),
 * donc corrompre sans le savoir ; et on ne pouvait filtrer une proposition
 * par lieu qu'en décodant du texte ligne par ligne.
 *
 * La migration `0013_bright_millenium_guard.sql` (quatre `ADD COLUMN`, aucune
 * reconstruction de table) a ajouté à `evenement` :
 *
 *   - `lieu_id`      TEXT nullable, `REFERENCES lieu_marche(id)` — nullable à
 *                     dessein : un événement saisi à la main n'est rattaché à
 *                     aucun lieu ;
 *   - `distance_km`  INTEGER nullable — à VOL D'OISEAU, jamais une distance
 *                     routière (fiche 05) ;
 *   - `commune_texte` TEXT nullable ;
 *   - `rejete_le`    TEXT nullable — horodatage ISO du rejet (CLAUDE.md §3
 *                     règle 7 : rien ne s'efface, on marque).
 *
 * `lieuNom` et le rayon de recherche ne sont PAS dupliqués dans `evenement` :
 * ce sont des attributs du LIEU, pas de la proposition. Ils sont retrouvés
 * par une jointure sur `lieu_id` à la lecture (`contextePourLieu` ci-dessous),
 * jamais stockés une seconde fois — une seule source de vérité.
 *
 * Les fonctions d'encodage/décodage et le marqueur de rejet ont été
 * supprimées de `packages/core/src/evenements-decouverte.ts` : du code mort
 * qui décoderait un format qu'on n'écrit plus serait un piège pour le
 * prochain lecteur.
 *
 * Rétrocompatibilité (choix documenté dans le rapport de livraison) :
 * aucune migration de données n'a été écrite pour relire les anciennes
 * `notes` encodées. Vérifié avant d'écrire ce fichier : `donnees/batte.sqlite`
 * (base réelle du porteur) contient ZÉRO ligne `source = 'ia'` à ce jour — il
 * n'existe donc AUCUNE proposition au vieux format à rattraper en pratique.
 * Si une ligne au vieux format existait malgré tout (base de dev, fixture),
 * ses quatre colonnes neuves seraient `NULL` et elle s'afficherait comme un
 * événement sans lieu rattaché (lieu/distance « — », rentabilité à 0 c) —
 * jamais une erreur, jamais une réinterprétation de `notes`.
 */

import {
  BASE_POINTS,
  calculerBaseline,
  ErreurIntrouvable,
  ErreurMetier,
  jourCivilBelge,
  maintenantUtc,
  nouvelIdentifiant,
} from '@batte/core';
import {
  estRayonRechercheValide,
  facteurEvenementDepuisPorteeIntensite,
  rentabiliteEstimeeCents,
  trierParRentabiliteDecroissante,
  type ConfigDecoteDistanceEvenement,
  type ConfigFacteurEvenement,
  type Parametres,
  type PorteeEvenement,
} from '@batte/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { evenement, lieuMarche } from '../schema.js';
import { journaliser } from './audit.js';
import { lireParametres } from './parametres.js';
import { coutsNewsvendor, observationsDuLieu } from './previsions.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Lieux — lecture du rayon et réglage
   ═══════════════════════════════════════════════════════════════════════════ */

export type LieuPourRechercheEvenements = {
  readonly id: string;
  readonly nom: string;
  readonly rayonRechercheEvenementsKm: number;
};

export function lieuPourRechercheEvenements(
  base: BaseBatte,
  lieuId: string,
): LieuPourRechercheEvenements | undefined {
  return base
    .select({
      id: lieuMarche.id,
      nom: lieuMarche.nom,
      rayonRechercheEvenementsKm: lieuMarche.rayonRechercheEvenementsKm,
    })
    .from(lieuMarche)
    .where(eq(lieuMarche.id, lieuId))
    .get();
}

/**
 * Lieux actifs, avec leur rayon de recherche — pour le sélecteur de l'écran
 * de validation. Requête DÉDIÉE plutôt qu'une dépendance sur
 * `listerLieuxComplets` (`depots/referentiel-ecriture.ts`, hors de la zone
 * d'écriture de cet agent) : ce module reste autonome tant que le rayon n'est
 * pas exposé ailleurs — voir le rapport de livraison.
 */
export function listerLieuxPourRechercheEvenements(base: BaseBatte): LieuPourRechercheEvenements[] {
  return base
    .select({
      id: lieuMarche.id,
      nom: lieuMarche.nom,
      rayonRechercheEvenementsKm: lieuMarche.rayonRechercheEvenementsKm,
    })
    .from(lieuMarche)
    .where(eq(lieuMarche.actif, true))
    .orderBy(lieuMarche.nom)
    .all();
}

/**
 * Change le rayon de recherche d'UN lieu — jamais un réglage global
 * (fiche 05 : « réglable indépendamment pour chaque lieu »).
 */
export function reglerRayonRechercheEvenements(
  base: BaseBatte,
  lieuId: string,
  rayonKm: number,
): LieuPourRechercheEvenements {
  if (!estRayonRechercheValide(rayonKm)) {
    throw new ErreurMetier(
      'rayon_recherche_invalide',
      `Le rayon de recherche doit être 5, 10, 15, 20, 40 ou 100 km (reçu : ${rayonKm}).`,
      { champs: { rayonRechercheEvenementsKm: 'Choisissez 5, 10, 15, 20, 40 ou 100 km.' } },
    );
  }
  const avant = lieuPourRechercheEvenements(base, lieuId);
  if (avant === undefined) throw new ErreurIntrouvable('Lieu de marché', lieuId);

  base
    .update(lieuMarche)
    .set({ rayonRechercheEvenementsKm: rayonKm, modifieLe: maintenantUtc() })
    .where(eq(lieuMarche.id, lieuId))
    .run();

  journaliser(base, {
    table: 'lieu_marche',
    enregistrementId: lieuId,
    action: 'modification',
    valeurAvant: avant,
    valeurApres: { ...avant, rayonRechercheEvenementsKm: rayonKm },
  });

  const apres = lieuPourRechercheEvenements(base, lieuId);
  if (apres === undefined) throw new Error(`Lieu ${lieuId} introuvable juste après écriture.`);
  return apres;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Config* — résolution des paramètres réglables (CLAUDE.md §7)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `packages/core/src/evenements-decouverte.ts` reste une fonction PURE
 * (CLAUDE.md §3 règle 1) : elle ne lit jamais `parametre` elle-même. C'est ce
 * dépôt qui résout `Parametres` vers les `Config*` attendus — même motif que
 * `ConfigSessionConsecutive` dans `apps/api/src/routes/previsions.ts`.
 */
function configFacteurEvenementDepuis(parametres: Parametres): ConfigFacteurEvenement {
  return {
    coefficientPorteeBp: {
      quartier: parametres.pointsDeBase('evenement_coefficient_portee_quartier_bp'),
      liege: parametres.pointsDeBase('evenement_coefficient_portee_liege_bp'),
      national: parametres.pointsDeBase('evenement_coefficient_portee_national_bp'),
    },
    penteIntensiteBp: parametres.pointsDeBase('evenement_pente_intensite_bp'),
  };
}

function configDecoteDistanceDepuis(parametres: Parametres): ConfigDecoteDistanceEvenement {
  return {
    distanceSansDecoteKm: parametres.entier('evenement_distance_sans_decote_km'),
    distanceDecoteMaxKm: parametres.entier('evenement_distance_decote_max_km'),
    distancePlancherBp: parametres.pointsDeBase('evenement_distance_plancher_bp'),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Rentabilité prévisionnelle — baseline et marge du lieu concerné
   ═══════════════════════════════════════════════════════════════════════════ */

type ContexteRentabilite = {
  readonly baselineCrepes: number;
  readonly margeUnitaireCents: number;
  readonly configDecote: ConfigDecoteDistanceEvenement;
};

/**
 * Baseline de fréquentation et marge unitaire moyenne, pour UN lieu, à la
 * date du jour. Mêmes fonctions déterministes que le moteur de prévision
 * (`docs/03-MOTEUR-PREVISION.md` §« Facteur 1 » et « décision de
 * production ») — aucune formule dupliquée.
 */
function contexteRentabiliteDuLieu(base: BaseBatte, lieuId: string): ContexteRentabilite {
  const jour = jourCivilBelge(new Date());
  const parametres = lireParametres(base, jour);
  const observations = observationsDuLieu(base, lieuId);
  const baseline = calculerBaseline(observations, jour, parametres);
  // `coutRuptureCents` = prix moyen − coût matière : c'est déjà la marge
  // unitaire moyenne par crêpe (voir `coutsNewsvendor`, `depots/previsions.ts`).
  const couts = coutsNewsvendor(base);
  return {
    baselineCrepes: baseline.baselineCrepes,
    margeUnitaireCents: couts.coutRuptureCents,
    configDecote: configDecoteDistanceDepuis(parametres),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Propositions — lecture enrichie (ce que l'écran de validation affiche)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Dérivé du schéma, pas d'un import inter-paquet : même convention que `depots/concurrents.ts`. */
export type FamilleOpportuniteDb = (typeof evenement.$inferSelect)['famille'];

export type PropositionEvenementLigne = {
  readonly id: string;
  readonly nom: string;
  readonly type: (typeof evenement.$inferSelect)['type'];
  readonly dateDebut: string;
  readonly dateFin: string;
  readonly portee: PorteeEvenement;
  readonly intensiteEstimee: number;
  readonly impactEstimeBp: number;
  readonly impactMesureBp: number | null;
  readonly source: string | null;
  readonly valideParHumain: boolean;
  readonly notes: string | null;
  readonly lieuId: string | null;
  readonly lieuNom: string | null;
  readonly rayonRechercheKm: number | null;
  readonly distanceKm: number | null;
  readonly communeTexte: string | null;
  readonly rentabiliteEstimeeCents: number;
  /**
   * Famille d'opportunité (fiche 14) — `NULL` = pas encore taggée, c'est le
   * cas de TOUTE proposition fraîchement découverte par l'IA : Claude
   * propose un événement, jamais sa famille (CLAUDE.md §3 règle 2). Réglable
   * uniquement AU MOMENT DE LA VALIDATION humaine (`validerPropositionEvenement`
   * ci-dessous), jamais à la création.
   */
  readonly famille: FamilleOpportuniteDb;
  readonly effectifEstime: number | null;
};

/** Lieu + contexte de rentabilité, ensemble : une seule jointure par lieu, jamais deux. */
type ContextePropositionIa = ContexteRentabilite & {
  readonly lieuNom: string;
  readonly rayonRechercheKm: number;
};

/**
 * Résout le contexte d'enrichissement d'UN lieu, avec cache mémoire : plusieurs
 * propositions du même lieu ne relisent ni sa baseline ni son nom deux fois.
 *
 * Rend `null` si le lieu référencé par `lieu_id` n'existe plus (FK vers
 * `lieu_marche`, mais rien n'empêche une suppression) — la proposition reste
 * affichable, simplement sans enrichissement, plutôt que de lever une erreur.
 */
function contextePourLieu(
  base: BaseBatte,
  lieuId: string,
  cache: Map<string, ContextePropositionIa | null>,
): ContextePropositionIa | null {
  const enCache = cache.get(lieuId);
  if (enCache !== undefined) return enCache;

  const lieu = lieuPourRechercheEvenements(base, lieuId);
  const contexte =
    lieu === undefined
      ? null
      : {
          lieuNom: lieu.nom,
          rayonRechercheKm: lieu.rayonRechercheEvenementsKm,
          ...contexteRentabiliteDuLieu(base, lieuId),
        };

  cache.set(lieuId, contexte);
  return contexte;
}

function versPropositionEnrichie(
  base: BaseBatte,
  ligne: typeof evenement.$inferSelect,
  cacheContexte: Map<string, ContextePropositionIa | null>,
): PropositionEvenementLigne {
  const contexte =
    ligne.lieuId === null ? null : contextePourLieu(base, ligne.lieuId, cacheContexte);

  const rentabilite =
    contexte === null
      ? 0
      : rentabiliteEstimeeCents(
          {
            baselineCrepes: contexte.baselineCrepes,
            impactEstimeBp: ligne.impactEstimeBp,
            // `distance_km` est nullable en base ; une proposition IA en pose
            // toujours une (voir `creerPropositionEvenementIa`), donc ce repli
            // ne joue que pour une ligne au vieux format ou altérée à la main.
            distanceKm: ligne.distanceKm ?? 0,
            margeUnitaireCents: contexte.margeUnitaireCents,
          },
          contexte.configDecote,
        );

  return {
    id: ligne.id,
    nom: ligne.nom,
    type: ligne.type,
    dateDebut: ligne.dateDebut,
    dateFin: ligne.dateFin,
    portee: ligne.portee,
    intensiteEstimee: ligne.intensiteEstimee,
    impactEstimeBp: ligne.impactEstimeBp,
    impactMesureBp: ligne.impactMesureBp,
    source: ligne.source,
    valideParHumain: ligne.valideParHumain,
    notes: ligne.notes,
    lieuId: ligne.lieuId,
    lieuNom: contexte?.lieuNom ?? null,
    rayonRechercheKm: contexte?.rayonRechercheKm ?? null,
    distanceKm: ligne.distanceKm,
    communeTexte: ligne.communeTexte,
    rentabiliteEstimeeCents: rentabilite,
    famille: ligne.famille,
    effectifEstime: ligne.effectifEstime,
  };
}

/**
 * Propositions IA en attente de validation, triées par rentabilité prévue
 * DÉCROISSANTE (fiche 05, critère de fin).
 *
 * Le rejet se filtre maintenant EN SQL (`rejete_le IS NULL`) : avant la
 * colonne dédiée, il fallait décoder `notes` ligne par ligne pour le savoir.
 */
export function listerPropositionsEnAttente(base: BaseBatte): PropositionEvenementLigne[] {
  const lignes = base
    .select()
    .from(evenement)
    .where(
      and(
        eq(evenement.source, 'ia'),
        eq(evenement.valideParHumain, false),
        isNull(evenement.rejeteLe),
      ),
    )
    .all();

  const cacheContexte = new Map<string, ContextePropositionIa | null>();
  const enrichies = lignes.map((ligne) => versPropositionEnrichie(base, ligne, cacheContexte));
  return trierParRentabiliteDecroissante(enrichies);
}

function chargerLigne(base: BaseBatte, id: string): typeof evenement.$inferSelect | undefined {
  return base.select().from(evenement).where(eq(evenement.id, id)).get();
}

function chargerPropositionIaOuLever(base: BaseBatte, id: string): typeof evenement.$inferSelect {
  const ligne = chargerLigne(base, id);
  if (ligne === undefined || ligne.source !== 'ia') {
    throw new ErreurIntrouvable('Proposition d’événement', id);
  }
  return ligne;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Création — une proposition par élément de la sortie Claude validée Zod
   ═══════════════════════════════════════════════════════════════════════════ */

export type EntreePropositionEvenementIa = {
  readonly lieuId: string;
  readonly nom: string;
  readonly type: (typeof evenement.$inferInsert)['type'];
  readonly dateDebut: string;
  readonly dateFin: string;
  readonly portee: PorteeEvenement;
  readonly intensiteEstimee: number;
  readonly distanceKm: number;
  readonly communeTexte: string;
  readonly source: string;
  readonly resume: string;
};

/**
 * Insère une proposition IA — `valide_par_humain = false`, `source = 'ia'`
 * (CLAUDE.md §3 règle 2). N'entre dans AUCUN calcul de prévision tant qu'un
 * humain ne l'a pas validée : `evenementsDuJour` filtre déjà sur
 * `valide_par_humain`, sans qu'il soit nécessaire d'y toucher.
 */
export function creerPropositionEvenementIa(
  base: BaseBatte,
  entree: EntreePropositionEvenementIa,
): PropositionEvenementLigne {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  // Calculé ICI, jamais reçu de Claude : CLAUDE.md §3 règle 2, « un LLM ne
  // calcule jamais ». La portée et l'intensité sont les seules estimations
  // que Claude fournit ; le facteur qui en dérive est déterministe.
  const parametres = lireParametres(base);
  const impactEstimeBp = facteurEvenementDepuisPorteeIntensite(
    entree.portee,
    entree.intensiteEstimee,
    configFacteurEvenementDepuis(parametres),
  );

  // `distance_km` est un entier (schema.ts) : la distance à vol d'oiseau
  // n'est qu'une ESTIMATION de la recherche (jamais une mesure GPS), donc
  // l'arrondir au km ne lui fait perdre aucune précision réelle.
  const distanceKm = Math.round(entree.distanceKm);

  base
    .insert(evenement)
    .values({
      id,
      nom: entree.nom,
      type: entree.type,
      dateDebut: entree.dateDebut,
      dateFin: entree.dateFin,
      portee: entree.portee,
      intensiteEstimee: entree.intensiteEstimee,
      impactEstimeBp,
      source: 'ia',
      valideParHumain: false,
      lieuId: entree.lieuId,
      distanceKm,
      communeTexte: entree.communeTexte,
      // `notes` est redevenu un commentaire libre (voir en-tête de fichier) :
      // seul le résumé produit par la recherche y reste, sans plus aucune
      // donnée structurée — l'utilisateur peut l'éditer sans rien casser.
      notes: entree.resume,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  journaliser(base, {
    table: 'evenement',
    enregistrementId: id,
    action: 'creation',
    valeurApres: { nom: entree.nom, source: 'ia', valideParHumain: false, lieuId: entree.lieuId },
  });

  const ligne = chargerLigne(base, id);
  if (ligne === undefined)
    throw new Error(`Proposition d'événement ${id} introuvable après création.`);
  return versPropositionEnrichie(base, ligne, new Map());
}

/* ═══════════════════════════════════════════════════════════════════════════
   Validation — l'événement devient actif et entre dans le calcul
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `| undefined` explicite sur les deux champs : ce type reçoit directement la
 * sortie d'un `.optional()` Zod (`ValidationProposition`,
 * `contrats/evenements-decouverte.ts`), et le projet active
 * `exactOptionalPropertyTypes`. Sous ce réglage, `portee?: PorteeEvenement`
 * (sans le `| undefined`) interdit une clé PRÉSENTE valant `undefined` — or
 * c'est exactement ce que `.parse()` peut produire. Sans cette précision, le
 * type ment sur ce qu'il accepte réellement.
 */
export type AjustementValidation = {
  readonly portee?: PorteeEvenement | undefined;
  readonly intensiteEstimee?: number | undefined;
  /**
   * Passerelle avec la fiche 14 : taguer une proposition découverte par l'IA
   * comme une OPPORTUNITÉ, au moment de sa validation humaine — jamais à sa
   * création (CLAUDE.md §3 règle 2 : Claude propose un événement, jamais sa
   * famille). `undefined` = ne pas toucher à la famille déjà en base
   * (comportement par défaut, rétrocompatible) ; `null` = la reconduire
   * explicitement comme un facteur classique.
   */
  readonly famille?: FamilleOpportuniteDb | undefined;
  readonly effectifEstime?: number | null | undefined;
};

/**
 * Valide une proposition, avec ajustement facultatif de la portée/intensité
 * AVANT validation (fiche 05). `impactEstimeBp` est TOUJOURS recalculé à
 * partir des valeurs retenues — jamais conservé tel que Claude l'aurait
 * suggéré, puisque Claude ne fournit ni ne calcule ce chiffre.
 *
 * Passerelle fiche 14 : si `ajustement.famille` tague cette validation comme
 * une OPPORTUNITÉ (famille non `NULL`), `impactEstimeBp` est forcé au NEUTRE
 * (`BASE_POINTS`) au lieu d'être dérivé de la portée/intensité. Raison :
 * `evenementsDuJour` / `facteurEvenementBp` (ci-dessus) ne filtrent QUE sur
 * `valide_par_humain` et la plage de dates — ils ignorent `famille`. Une
 * opportunité EST sa propre session ; si son impact portait autre chose
 * qu'un facteur neutre, elle contaminerait silencieusement la prévision
 * d'une session RÉGULIÈRE qui tomberait la même date ailleurs. Même garde
 * que `creerOpportunite` (`packages/db/src/depots/opportunites.ts`).
 */
export function validerPropositionEvenement(
  base: BaseBatte,
  id: string,
  ajustement: AjustementValidation = {},
): PropositionEvenementLigne {
  const avant = chargerPropositionIaOuLever(base, id);
  if (avant.valideParHumain) {
    throw new ErreurMetier(
      'proposition_deja_validee',
      'Cette proposition a déjà été validée : elle est déjà active dans le calcul de prévision.',
    );
  }

  const portee = ajustement.portee ?? avant.portee;
  const intensiteEstimee = ajustement.intensiteEstimee ?? avant.intensiteEstimee;
  const famille = ajustement.famille === undefined ? avant.famille : ajustement.famille;
  const effectifEstime =
    ajustement.effectifEstime === undefined ? avant.effectifEstime : ajustement.effectifEstime;
  const impactEstimeBp =
    famille === null
      ? facteurEvenementDepuisPorteeIntensite(
          portee,
          intensiteEstimee,
          configFacteurEvenementDepuis(lireParametres(base)),
        )
      : BASE_POINTS;
  const maintenant = maintenantUtc();

  base
    .update(evenement)
    .set({
      portee,
      intensiteEstimee,
      impactEstimeBp,
      famille,
      effectifEstime,
      valideParHumain: true,
      modifieLe: maintenant,
    })
    .where(eq(evenement.id, id))
    .run();

  journaliser(base, {
    table: 'evenement',
    enregistrementId: id,
    action: 'modification',
    valeurAvant: avant,
    valeurApres: {
      ...avant,
      portee,
      intensiteEstimee,
      impactEstimeBp,
      famille,
      effectifEstime,
      valideParHumain: true,
    },
  });

  const ligne = chargerLigne(base, id);
  if (ligne === undefined) throw new Error(`Événement ${id} introuvable juste après validation.`);
  return versPropositionEnrichie(base, ligne, new Map());
}

/* ═══════════════════════════════════════════════════════════════════════════
   Rejet — jamais un DELETE (CLAUDE.md §3 règle 7)
   ═══════════════════════════════════════════════════════════════════════════ */

export function rejeterPropositionEvenement(base: BaseBatte, id: string): void {
  const avant = chargerPropositionIaOuLever(base, id);
  if (avant.valideParHumain) {
    throw new ErreurMetier(
      'proposition_deja_validee',
      'Cette proposition a déjà été validée : elle ne peut plus être rejetée.',
    );
  }

  // `rejete_le` : horodatage ISO UTC du rejet (CLAUDE.md §3 règle 8). On ne
  // supprime jamais la ligne (règle 7) : elle reste en base, reste visible
  // par une requête directe sur `evenement`, et n'est plus jamais reproposée
  // — `listerPropositionsEnAttente` filtre sur cette colonne, en SQL.
  const maintenant = maintenantUtc();
  base
    .update(evenement)
    .set({ rejeteLe: maintenant, modifieLe: maintenant })
    .where(eq(evenement.id, id))
    .run();

  journaliser(base, {
    table: 'evenement',
    enregistrementId: id,
    action: 'modification',
    valeurAvant: avant,
    valeurApres: { ...avant, rejeteLe: maintenant },
  });
}

/**
 * Nombre de propositions IA en attente — pour le bloc Alertes du tableau de
 * bord (fiche 05). Exportée séparément de `listerPropositionsEnAttente` :
 * un compteur n'a pas besoin de recalculer une rentabilité par ligne, ni de
 * relire `notes`.
 */
export function nombrePropositionsEnAttente(base: BaseBatte): number {
  return base
    .select({ id: evenement.id })
    .from(evenement)
    .where(
      and(
        eq(evenement.source, 'ia'),
        eq(evenement.valideParHumain, false),
        isNull(evenement.rejeteLe),
      ),
    )
    .all().length;
}
