/**
 * Contrat HTTP des routes `/api/evenements-decouverte/*` (fiche
 * `docs/demandes/05-EVENEMENTS-DECOUVERTE-IA-RAYON-REGLABLE.md`).
 *
 * Même convention que `contrats/concurrents.ts` (fiche 08) : un seul schéma
 * valide la sortie côté serveur ET dérive le type côté client.
 *
 * Réutilise `schemaEvenement`, `schemaPorteeEvenement` et `schemaTypeEvenement`
 * de `./previsions.js` plutôt que de les dupliquer — le vocabulaire d'un
 * événement ne change pas parce que sa source est l'IA.
 */

import { z } from 'zod';
import { estJourCivilValide } from '../horodatage.js';
import { schemaEvenement, schemaPorteeEvenement, schemaTypeEvenement } from './previsions.js';
import { schemaFamilleOpportunite } from './opportunites.js';
import { DOMAINE_RAYON_RECHERCHE_KM, estRayonRechercheValide } from '../evenements-decouverte.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Rayon de recherche — domaine fermé, réglable PAR LIEU (fiche 05)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Le domaine est defini UNE SEULE FOIS, dans la logique pure
 * (`packages/core/src/evenements-decouverte.ts`), et le schema le derive.
 *
 * Il etait ecrit deux fois — ici en litteraux Zod, et la-bas en constante.
 * Deux listes que rien n'obligeait a rester d'accord : ajouter un rayon d'un
 * seul cote aurait produit une valeur acceptee par le contrat et refusee par
 * le calcul, ou l'inverse.
 */
export const schemaRayonRechercheKm = z
  .number()
  .int()
  .refine(estRayonRechercheValide, {
    message: `Rayon de recherche invalide : valeurs admises ${DOMAINE_RAYON_RECHERCHE_KM.join(', ')} km.`,
  });

/** Réglage du rayon d'un lieu — corps de `PATCH /lieux-marche/:id/rayon-recherche`. */
export const schemaReglageRayonRecherche = z.object({
  rayonRechercheEvenementsKm: schemaRayonRechercheKm,
});

/**
 * Lieu, tel qu'exposé par ce module pour le sélecteur de l'écran de
 * validation — un sous-ensemble minimal, PAS le référentiel complet
 * (`contrats/referentiel.ts`, hors de la zone d'écriture de cet agent).
 */
export const schemaLieuPourRechercheEvenements = z.object({
  id: z.string(),
  nom: z.string(),
  rayonRechercheEvenementsKm: z.int(),
});

export const schemaListeLieuxPourRechercheEvenements = z.object({
  data: z.array(schemaLieuPourRechercheEvenements),
});

export type LieuPourRechercheEvenements = z.infer<typeof schemaLieuPourRechercheEvenements>;

/* ═══════════════════════════════════════════════════════════════════════════
   Sortie brute attendue de Claude — validée AVANT toute persistance
   ═══════════════════════════════════════════════════════════════════════════

   CLAUDE.md §3 règle 2 : Claude propose (nom, date, lieu approximatif,
   source), il ne calcule rien. `portee` et `intensiteEstimee` sont des
   estimations INITIALES, ajustables par l'utilisateur avant validation
   (fiche 05) — jamais un chiffre final. Aucun champ « impact » ou
   « rentabilité » n'est demandé au modèle : ces deux valeurs sont dérivées
   déterministement par `packages/core/src/evenements-decouverte.ts`. */

const champJourCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ, par exemple 2026-08-15.')
  // La FORME ne suffit pas : `2026-02-30` la respecte et n'existe pas.
  .refine(estJourCivilValide, 'Cette date n’existe pas au calendrier.');

export const schemaPropositionEvenementIaBrute = z
  .object({
    nom: z.string().trim().min(1, 'Un événement proposé doit avoir un nom.').max(200),
    type: schemaTypeEvenement,
    dateDebut: champJourCivil,
    dateFin: champJourCivil,
    /** Commune ou lieu-dit où la recherche situe l'événement — texte libre. */
    communeTexte: z.string().trim().min(1).max(200),
    /**
     * Distance ESTIMÉE PAR LA RECHERCHE elle-même (à vol d'oiseau, jamais
     * routière — fiche 05 : « nomme la grandeur honnêtement »). Ce n'est ni
     * une mesure GPS ni un calcul géodésique : c'est ce que Claude a pu
     * déduire du contenu trouvé, borné pour rester plausible.
     */
    distanceEstimeeKm: z.number().nonnegative().max(500),
    portee: schemaPorteeEvenement,
    intensiteEstimee: z.int().min(1).max(5),
    /** URL ou description de la source trouvée — jamais vide (traçabilité). */
    source: z.string().trim().min(1).max(500),
    resume: z.string().trim().min(1).max(500),
  })
  .refine((valeur) => valeur.dateFin >= valeur.dateDebut, {
    message: 'La date de fin ne peut pas précéder la date de début.',
    path: ['dateFin'],
  });

export type PropositionEvenementIaBrute = z.infer<typeof schemaPropositionEvenementIaBrute>;

/** Borne haute assumée : au-delà, une réponse Claude ressemble à du bruit, pas à une recherche. */
export const schemaPropositionsEvenementsIaBrutes = z
  .array(schemaPropositionEvenementIaBrute)
  .max(15);

/* ═══════════════════════════════════════════════════════════════════════════
   Proposition PERSISTÉE — ce que l'écran de validation affiche et trie
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaPropositionEvenement = schemaEvenement.extend({
  lieuId: z.string().nullable(),
  lieuNom: z.string().nullable(),
  rayonRechercheKm: z.int().nullable(),
  /** À vol d'oiseau — voir la note de `distanceEstimeeKm` ci-dessus. */
  distanceKm: z.number().nullable(),
  communeTexte: z.string().nullable(),
  /**
   * Surcroît de marge ATTENDU, en centimes, signé (CLAUDE.md §3 règle 3 :
   * argent en entiers). Calculé déterministement à chaque lecture — jamais
   * stocké tel quel par Claude.
   */
  rentabiliteEstimeeCents: z.int(),
  /**
   * Passerelle fiche 14 : `NULL` tant que la validation humaine n'a pas
   * taggé cette proposition comme une opportunité — jamais renseigné par
   * Claude (CLAUDE.md §3 règle 2).
   */
  famille: schemaFamilleOpportunite.nullable(),
  effectifEstime: z.int().nullable(),
});

export type PropositionEvenement = z.infer<typeof schemaPropositionEvenement>;

export const schemaListePropositionsEvenements = z.object({
  data: z.array(schemaPropositionEvenement),
  meta: z.object({ total: z.int() }),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Déclenchement de la recherche — mode dégradé DANS le contrat
   ═══════════════════════════════════════════════════════════════════════════

   Même convention que `schemaCommentaireIa` (Lot 9, `contrats/ia.ts`) :
   `disponible: false` est une réponse NORMALE avec un code HTTP 200. Un
   plafond IA atteint ou une clé absente ne bloquent JAMAIS la recherche
   manuelle — ils l'arrêtent proprement (CLAUDE.md §5). */

export const schemaDemandeRecherche = z.object({
  lieuId: z.string().min(1, 'Choisissez un lieu.'),
});

export const schemaResultatRechercheEvenements = z.discriminatedUnion('disponible', [
  z.object({
    disponible: z.literal(true),
    propositions: z.array(schemaPropositionEvenement),
    coutCents: z.int(),
  }),
  z.object({
    disponible: z.literal(false),
    raison: z.string(),
  }),
]);

export type ResultatRechercheEvenements = z.infer<typeof schemaResultatRechercheEvenements>;

/* ═══════════════════════════════════════════════════════════════════════════
   Validation / rejet d'une proposition
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ajustement facultatif de la portée et de l'intensité AVANT validation
 * (fiche 05 : « une case pour ajuster la portée/intensité estimée »).
 * `impactEstimeBp` n'est jamais reçu du client : il est recalculé
 * déterministement à partir de la portée et de l'intensité retenues.
 */
export const schemaValidationProposition = z.object({
  portee: schemaPorteeEvenement.optional(),
  intensiteEstimee: z.int().min(1).max(5).optional(),
  /**
   * Fiche 14 : taguer cette proposition comme une opportunité au moment de
   * sa validation. `undefined` (champ absent) = ne pas toucher à la famille
   * déjà en base ; `null` explicite = la reconduire comme un facteur
   * classique.
   */
  famille: schemaFamilleOpportunite.nullable().optional(),
  effectifEstime: z.int().nonnegative().nullable().optional(),
});

export type ValidationProposition = z.infer<typeof schemaValidationProposition>;
