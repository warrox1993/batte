/**
 * Contrat HTTP des routes `/api/afsca/*` (Lot 8 — registre AFSCA).
 */

import { z } from 'zod';
import { schemaStatutLot, schemaStatutReception } from './stock.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Relevés de température
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaMomentReleve = z.enum(['depart', 'arrivee', 'mi_session', 'retour', 'stockage']);

/**
 * Statut d'un relevé de température — `'active'` (le cas normal) ou
 * `'annulee'` (D-083, 31/07/2026 : un relevé MAL SAISI s'annule PAR ÉCRITURE
 * NOUVELLE, jamais par suppression ni par réécriture de sa valeur — voir
 * `annulerReleveTemperature`, `packages/db/src/services/afsca.ts`). Même
 * principe que `schemaStatutReception` (`./stock.js`) : un enum dédié plutôt
 * qu'un booléen, pour que ce champ reste lisible tel quel dans un futur
 * troisième statut si l'AFSCA en exigeait un.
 */
export const schemaStatutReleveTemperature = z.enum(['active', 'annulee']);

export const schemaReleveTemperature = z.object({
  id: z.string(),
  sessionId: z.string().nullable(),
  productionId: z.string().nullable(),
  equipement: z.string(),
  temperatureC: z.number(),
  dateReleve: z.string(),
  moment: schemaMomentReleve,
  conforme: z.boolean(),
  actionCorrective: z.string().nullable(),
  relevePar: z.string().nullable(),
  creeLe: z.string(),
  statut: schemaStatutReleveTemperature,
  /**
   * Motif de l'annulation (D-083) — `null` sur un relevé `active`. Retrouvé
   * dans `journal_audit` par `avecMotifAnnulation`
   * (`packages/db/src/services/afsca.ts`) : ce n'est délibérément PAS une
   * colonne de `releve_temperature` (voir le commentaire de la colonne
   * `statut` dans `packages/db/src/schema.ts`).
   */
  motifAnnulation: z.string().nullable(),
  /** Instant RÉEL de l'annulation (`journalAudit.dateAction`) — `null` sur un relevé `active`. */
  dateAnnulation: z.string().nullable(),
});

export const schemaListeRelevesTemperature = z.object({
  data: z.array(schemaReleveTemperature),
  meta: z.object({ total: z.int() }),
});

/**
 * Aucun champ n'a de valeur par défaut côté serveur : `temperatureC` arrive
 * TOUJOURS saisi par l'utilisateur (CLAUDE.md — un champ de température ne se
 * pré-remplit jamais, un champ pré-rempli se valide sans être lu).
 */
export const schemaCreationReleveTemperature = z.object({
  sessionId: z.string().nullable().optional(),
  productionId: z.string().nullable().optional(),
  equipement: z.string().min(1, "Indiquez l'équipement relevé."),
  temperatureC: z.number(),
  dateReleve: z.string().min(1),
  moment: schemaMomentReleve,
  actionCorrective: z.string().nullable().optional(),
  relevePar: z.string().nullable().optional(),
});

/**
 * Corps de `POST /afsca/temperatures/:id/annuler` (D-083). `motif` texte
 * libre et OBLIGATOIRE — à la différence de `schemaAnnulationReception`
 * (`./stock.js`), qui porte un `motifCode` du catalogue
 * (`packages/core/src/motifs.ts`) : cette annulation ne contrepasse AUCUN
 * mouvement de stock, il n'existe donc aucune écriture sœur où loger un motif
 * structuré — voir le commentaire de `annulerReleveTemperature`
 * (`packages/db/src/services/afsca.ts`) pour le raisonnement complet.
 */
export const schemaAnnulationReleveTemperature = z.object({
  motif: z.string().min(1, 'Indiquez pourquoi ce relevé est annulé.'),
});

export const schemaAnnulationReleveTemperatureCreee = z.object({
  releveId: z.string(),
  motif: z.string(),
});

/**
 * Session clôturée de la période sans AUCUN relevé de température rattaché —
 * le trou que `sessionsSansReleveTemperature` (`packages/db/src/services/
 * afsca.ts`) rend visible plutôt que de laisser un registre qui n'affiche que
 * ce qui existe donner une fausse impression de complétude (audit AFSCA du
 * 30/07/2026).
 */
export const schemaSessionSansReleveTemperature = z.object({
  sessionId: z.string(),
  numero: z.string(),
  dateSession: z.string(),
  lieuNom: z.string(),
});

export const schemaListeSessionsSansReleveTemperature = z.object({
  data: z.array(schemaSessionSansReleveTemperature),
  meta: z.object({ total: z.int() }),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Plan de nettoyage
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaFrequenceNettoyage = z.enum(['apres_session', 'hebdomadaire', 'mensuelle']);

export const schemaTacheNettoyage = z.object({
  id: z.string(),
  libelle: z.string(),
  frequence: schemaFrequenceNettoyage,
  zone: z.string(),
  actif: z.boolean(),
  creeLe: z.string(),
  modifieLe: z.string(),
});

export const schemaListeTachesNettoyage = z.object({
  data: z.array(schemaTacheNettoyage),
  meta: z.object({ total: z.int() }),
});

export const schemaCreationExecutionNettoyage = z.object({
  tacheId: z.string().min(1),
  sessionId: z.string().nullable().optional(),
  dateExecution: z.string().min(1),
  executePar: z.string().nullable().optional(),
  observations: z.string().nullable().optional(),
});

export const schemaExecutionNettoyage = z.object({
  id: z.string(),
  tacheId: z.string(),
  sessionId: z.string().nullable(),
  dateExecution: z.string(),
  executePar: z.string().nullable(),
  observations: z.string().nullable(),
  creeLe: z.string(),
});

export const schemaExecutionNettoyageDetail = z.object({
  id: z.string(),
  tacheId: z.string(),
  tacheLibelle: z.string(),
  zone: z.string(),
  dateExecution: z.string(),
  executePar: z.string().nullable(),
  observations: z.string().nullable(),
  /**
   * Instant RÉEL d'écriture, distinct de `dateExecution` — voir
   * `ExecutionNettoyageDetail` (`packages/db/src/services/afsca.ts`) pour la
   * règle complète (CLAUDE.md §7). Ajouté ICI, au contrat, en même temps qu'au
   * dépôt : ne l'ajouter que côté dépôt aurait fait tronquer le champ
   * SILENCIEUSEMENT par le `.parse()` de la route (même piège déjà documenté
   * sur `schemaTracabiliteAvalLot.nonConformites` ci-dessous).
   */
  creeLe: z.string(),
});

export const schemaListeExecutionsNettoyage = z.object({
  data: z.array(schemaExecutionNettoyageDetail),
  meta: z.object({ total: z.int() }),
});

export const schemaTacheEnRetard = z.object({
  tacheId: z.string(),
  libelle: z.string(),
  zone: z.string(),
  frequence: schemaFrequenceNettoyage,
  derniereExecution: z.string().nullable(),
  motif: z.string(),
});

export const schemaListeTachesEnRetard = z.object({
  data: z.array(schemaTacheEnRetard),
  meta: z.object({ total: z.int() }),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Non-conformités
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaGraviteNonConformite = z.enum(['mineure', 'majeure', 'critique']);

export const schemaNonConformite = z.object({
  id: z.string(),
  dateConstat: z.string(),
  type: z.string(),
  description: z.string(),
  gravite: schemaGraviteNonConformite,
  actionCorrective: z.string().nullable(),
  dateResolution: z.string().nullable(),
  sessionId: z.string().nullable(),
  lotId: z.string().nullable(),
  creeLe: z.string(),
  modifieLe: z.string(),
});

export const schemaListeNonConformites = z.object({
  data: z.array(schemaNonConformite),
  meta: z.object({ total: z.int() }),
});

export const schemaCreationNonConformite = z.object({
  dateConstat: z.string().min(1),
  type: z.string().min(1, 'Indiquez le type de non-conformité.'),
  description: z.string().min(1, 'Décrivez la non-conformité constatée.'),
  gravite: schemaGraviteNonConformite,
  actionCorrective: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  lotId: z.string().nullable().optional(),
});

export const schemaClotureNonConformite = z.object({
  dateResolution: z.string().min(1),
  actionCorrective: z.string().min(1, "Décrivez l'action corrective prise."),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Exercice de traçabilité
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaResultatExercice = z.enum(['concluant', 'ecarts', 'echec']);

export const schemaExerciceTracabilite = z.object({
  id: z.string(),
  dateExercice: z.string(),
  lotDepartId: z.string().nullable(),
  dureeMinutes: z.int().nullable(),
  resultat: schemaResultatExercice,
  ecartsConstates: z.string().nullable(),
  documentId: z.string().nullable(),
  creeLe: z.string(),
});

export const schemaListeExercicesTracabilite = z.object({
  data: z.array(schemaExerciceTracabilite),
  meta: z.object({ total: z.int() }),
});

export const schemaCreationExerciceTracabilite = z.object({
  dateExercice: z.string().min(1),
  lotDepartId: z.string().nullable().optional(),
  dureeMinutes: z.int().nonnegative().nullable().optional(),
  resultat: schemaResultatExercice,
  ecartsConstates: z.string().nullable().optional(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Traçabilité amont / aval
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaTracabiliteAmontConsommation = z.object({
  lotId: z.string(),
  ingredientId: z.string(),
  ingredientNom: z.string(),
  quantiteTheorique: z.int(),
  quantiteReelle: z.int().nullable(),
  /**
   * Quantité réellement SORTIE de ce lot pour cette production — net signé des
   * mouvements de stock, écarts de réalisé compris.
   *
   * AJOUTÉ LE 01/08/2026 avec le passage de la traçabilité au grand livre. Les
   * deux champs voisins ne suffisaient pas à répondre à un rappel :
   * `quantiteTheorique` vaut `0` pour un lot venu combler un écart (rien
   * n'était prévu de lui), et `quantiteReelle` est `null` dès qu'un ingrédient
   * a été servi par plusieurs lots — la déclaration du porteur porte sur
   * l'ingrédient, jamais sur le lot. Sans ce champ, le registre affichait
   * « 0 théorique / — réel » sur un lot qui avait bel et bien alimenté la pâte.
   *
   * ═══ REQUIS DEPUIS LE 01/08/2026 — LE `.optional()` EST LEVÉ ═══
   *
   * Il n'avait jamais été un choix : requis, il cassait des fixtures de
   * `apps/web` que la mission qui a ajouté ce champ n'avait pas le droit de
   * toucher. Ces fixtures sont à jour.
   *
   * Ce que le durcissement achète (docs/39 §5) : un champ OPTIONNEL que le
   * dépôt cesserait de fournir disparaît SILENCIEUSEMENT à la frontière HTTP —
   * le dépôt calcule, le contrat supprime, personne ne voit, rien ne le
   * signale. REQUIS, la même disparition rend un 422 bruyant. Ce qui tenait à
   * la place du contrat n'était pas une garantie mais un équilibre à deux
   * pieds : le type de retour annoté du dépôt
   * (`TracabiliteAmontConsommation`, qui déclare le champ REQUIS et force donc
   * `tsc` à vérifier qu'il est fourni) et un test de route vérifiant la
   * présence de la clé. Si l'un des deux tombait, la suppression silencieuse
   * redevenait possible.
   *
   * NON nullable, à la différence de son homonyme
   * `schemaConsommationProduction.quantiteMouvementee` (`./productions.js`) :
   * c'est la MÊME grandeur et le MÊME nom, mais le registre la montre dès le
   * lancement (le stock a enregistré quelque chose), quand l'écran Production
   * la tait jusqu'à la saisie du réalisé. La nullabilité est portée par le
   * type, jamais par le nom.
   */
  quantiteMouvementee: z.int(),
  numeroLotFournisseur: z.string().nullable(),
  dateReception: z.string(),
  dateDlc: z.string().nullable(),
  fournisseurId: z.string(),
  fournisseurNom: z.string(),
  receptionId: z.string(),
  receptionNumero: z.string(),
  /**
   * Statut de la RÉCEPTION d'origine (`active`/`annulee`), réutilisé tel quel
   * depuis `./stock.js` — c'est la MÊME colonne (`reception.statut`) que celle
   * déjà exposée par `schemaLotDetail.receptionStatut` : un second enum ici
   * serait une deuxième vérité pour une même colonne. Un lot consommé par une
   * production venait forcément d'une réception `active` au moment de la
   * consommation (`annulerReception` refuse d'annuler une réception dont un
   * lot a déjà servi), mais le registre doit pouvoir dire, a posteriori, que
   * cette réception a ENSUITE été annulée — sans faire disparaître le lot de
   * la traçabilité (CLAUDE.md §7 : rien ne se réécrit).
   */
  receptionStatut: schemaStatutReception,
});

export const schemaTracabiliteAmontProduction = z.object({
  productionId: z.string(),
  numero: z.string(),
  recetteCode: z.string(),
  recetteNom: z.string(),
  numeroLotPate: z.string(),
  dateProduction: z.string(),
  consommations: z.array(schemaTracabiliteAmontConsommation),
});

/**
 * Lot d'un produit REVENDU (sirop, confiture), sorti sans production.
 *
 * Un article revendu ne figure dans aucune production : son lot n'est relié à
 * la session que par le mouvement `sortie_vente`. Sans ce bloc, une denrée à
 * DLC vendue au public était absente du registre dans les DEUX sens — or
 * l'obligation AFSCA ne distingue pas transformé et revendu.
 */
export const schemaTracabiliteRevendu = z.object({
  lotId: z.string(),
  ingredientId: z.string(),
  ingredientNom: z.string(),
  quantite: z.int(),
  numeroLotFournisseur: z.string().nullable(),
  dateReception: z.string(),
  dateDlc: z.string().nullable(),
  fournisseurId: z.string(),
  fournisseurNom: z.string(),
  receptionId: z.string(),
  receptionNumero: z.string(),
  /** Statut de la RÉCEPTION d'origine — voir `schemaTracabiliteAmontConsommation.receptionStatut`. */
  receptionStatut: schemaStatutReception,
});

/**
 * Lot d'une GARNITURE étalée sur un produit transformé.
 *
 * Bloc distinct des deux précédents, et non un cas particulier de l'un d'eux :
 * une garniture n'est étalée par aucune production (la ranger dans les
 * consommations ferait état d'une fabrication qui n'a pas eu lieu), et elle
 * n'est pas vendue telle quelle (le client n'emporte aucun emballage, donc
 * aucun numéro de lot — ce qui change la portée d'un rappel).
 *
 * `produits` est ce que le bloc revendu n'a pas : il relie le lot à l'assiette.
 */
export const schemaTracabiliteGarniture = schemaTracabiliteRevendu.extend({
  produits: z.array(z.string()),
});

export const schemaTracabiliteAmontSession = z.object({
  sessionId: z.string(),
  numero: z.string(),
  dateSession: z.string(),
  productions: z.array(schemaTracabiliteAmontProduction),
  revendus: z.array(schemaTracabiliteRevendu),
  garnitures: z.array(schemaTracabiliteGarniture),
});

export const schemaTracabiliteAvalSession = z.object({
  id: z.string(),
  numero: z.string(),
  dateSession: z.string(),
  lieuNom: z.string(),
});

export const schemaTracabiliteAvalProduction = z.object({
  productionId: z.string(),
  numero: z.string(),
  dateProduction: z.string(),
  /**
   * Numéro du lot de PÂTE issu de cette production — ce que le schéma appelle
   * lui-même « le lien qui rend la traçabilité bidirectionnelle possible ».
   *
   * AJOUTÉ LE 01/08/2026, et le motif vaut d'être écrit. Ce champ n'existait
   * alors que dans `productionsDuLot` (`depots/productions.ts`), une fonction
   * sans aucun appelant, qui figurait à ce titre sur une liste de « morts-nés
   * à retirer ». Vérification faite avant retrait : ce n'était pas un doublon —
   * c'était le SEUL endroit du chemin aval portant ce numéro. Le champ a été
   * porté ICI d'abord ; `productionsDuLot` n'a été retirée qu'ensuite
   * (01/08/2026). La capacité de
   * répondre à « quel lot de pâte est issu d'une production ayant consommé ce
   * lot d'ingrédient rappelé ? » n'existait donc nulle part d'atteignable.
   * C'est un geste de RAPPEL SANITAIRE, pas une commodité (CLAUDE.md §3
   * règle 6 : « obligation réglementaire, pas une élégance technique »).
   *
   * `z.string()` NON nullable : la colonne `production.numeroLotPate`
   * (`packages/db/src/schema.ts`) est `notNull()` et porte un index unique
   * (`idx_production_lot_pate`) — toute production a son lot de pâte.
   *
   * PIÈGE ÉVITÉ DE JUSTESSE : ce schéma n'étant pas `.strict()`, l'absence de
   * ce champ ici ne produisait AUCUNE erreur 422 — la route le supprimait
   * **silencieusement** à la frontière HTTP. Le dépôt le calculait, personne
   * ne le voyait, et rien ne le signalait. Un champ manquant à un contrat de
   * sortie est une perte muette, jamais un échec bruyant.
   */
  numeroLotPate: z.string(),
  quantiteTheorique: z.int(),
  quantiteReelle: z.int().nullable(),
  /**
   * Quantité réellement SORTIE de ce lot pour cette production. Même champ, et
   * même motif, que `schemaTracabiliteAmontConsommation.quantiteMouvementee` —
   * il est ici ce qui distingue « ce lot était prévu dans cette fournée » de
   * « ce lot a alimenté cette pâte », deux affirmations que seul le grand livre
   * sépare, et dont un rappel sanitaire dépend.
   *
   * REQUIS depuis le 01/08/2026, comme lui et pour la même raison — voir
   * `schemaTracabiliteAmontConsommation.quantiteMouvementee`.
   */
  quantiteMouvementee: z.int(),
  session: schemaTracabiliteAvalSession.nullable(),
});

export const schemaTracabiliteAvalLot = z.object({
  lotId: z.string(),
  ingredientId: z.string(),
  ingredientNom: z.string(),
  numeroLotFournisseur: z.string().nullable(),
  dateReception: z.string(),
  dateDlc: z.string().nullable(),
  fournisseurId: z.string(),
  fournisseurNom: z.string(),
  receptionId: z.string(),
  receptionNumero: z.string(),
  /** Statut de la RÉCEPTION d'origine — voir `schemaTracabiliteAmontConsommation.receptionStatut`. */
  receptionStatut: schemaStatutReception,
  /**
   * Statut ACTUEL du lot lui-même — distinct de `receptionStatut` ci-dessus.
   * À lire TOUJOURS avec `motifStatutLibelle`/`dateChangementStatut` juste en
   * dessous : ces deux champs ne portent que le DERNIER changement, `statut`
   * dit à quel état il a mené.
   */
  statut: schemaStatutLot,
  /**
   * Motif et date du DERNIER changement de statut de ce lot
   * (`lot.motif_statut_id`, `lot.date_changement_statut`) — la trace qu'un
   * contrôle AFSCA vient chercher sur un rappel : pourquoi ce lot a-t-il été
   * bloqué, et quand. `null` sur les deux quand le lot n'a jamais changé de
   * statut depuis sa réception (CLAUDE.md §7 : une valeur inconnue vaut
   * `null`, jamais un motif fabriqué).
   */
  motifStatutLibelle: z.string().nullable(),
  dateChangementStatut: z.string().nullable(),
  /**
   * Non-conformités DÉJÀ rattachées à CE lot (`nonConformite.lotId`).
   *
   * DÉFAUT CORRIGÉ (audit du 29/07/2026) : le champ existait en base et dans
   * `schemaCreationNonConformite.lotId`, et l'écran permettait de le saisir
   * (`RegistreAfsca.tsx`), mais `tracabiliteAvalLot` ne le lisait jamais — on
   * pouvait donc lier une non-conformité à un lot et ne plus jamais la revoir
   * en consultant ce lot. Sur un rappel réel (« ce lot est rappelé : a-t-il
   * déjà fait l'objet d'un doute ? »), c'est exactement la question posée.
   *
   * Ajouté ICI, au contrat, en même temps qu'au dépôt
   * (`packages/db/src/depots/tracabilite.ts`) : l'ajouter seulement côté
   * dépôt aurait fait tronquer le champ SILENCIEUSEMENT par le `.parse()` de
   * la route (`schemaTracabiliteAvalLot.parse(resultat)`,
   * `apps/api/src/routes/afsca.ts`).
   */
  nonConformites: z.array(schemaNonConformite),
  productions: z.array(schemaTracabiliteAvalProduction),
  /**
   * Sorties vendues TELLES QUELLES. C'est la réponse à « ce lot est rappelé, où
   * est-il parti ? » pour une marchandise revendue fermée.
   */
  ventes: z.array(
    z.object({
      quantite: z.int(),
      dateMouvement: z.string(),
      session: schemaTracabiliteAvalSession,
    }),
  ),
  /**
   * Sorties ÉTALÉES sur un produit transformé. Séparées des ventes parce que le
   * client d'un pot fermé détient le numéro de lot, celui d'une crêpe garnie ne
   * détient rien : c'est cette différence qui décide de la portée d'un rappel.
   */
  garnitures: z.array(
    z.object({
      quantite: z.int(),
      dateMouvement: z.string(),
      session: schemaTracabiliteAvalSession,
      produits: z.array(z.string()),
    }),
  ),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Requêtes de période, partagées par plusieurs routes de ce module
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaPeriodeRequete = z.object({
  debut: z.string().min(1),
  fin: z.string().min(1),
});

export type MomentReleveContrat = z.infer<typeof schemaMomentReleve>;
export type StatutReleveTemperatureContrat = z.infer<typeof schemaStatutReleveTemperature>;
export type ReleveTemperatureContrat = z.infer<typeof schemaReleveTemperature>;
export type ListeRelevesTemperature = z.infer<typeof schemaListeRelevesTemperature>;
export type CreationReleveTemperature = z.infer<typeof schemaCreationReleveTemperature>;
export type AnnulationReleveTemperature = z.infer<typeof schemaAnnulationReleveTemperature>;
export type AnnulationReleveTemperatureCreee = z.infer<
  typeof schemaAnnulationReleveTemperatureCreee
>;
export type SessionSansReleveTemperatureContrat = z.infer<
  typeof schemaSessionSansReleveTemperature
>;
export type ListeSessionsSansReleveTemperature = z.infer<
  typeof schemaListeSessionsSansReleveTemperature
>;
export type FrequenceNettoyageContrat = z.infer<typeof schemaFrequenceNettoyage>;
export type TacheNettoyageContrat = z.infer<typeof schemaTacheNettoyage>;
export type ListeTachesNettoyage = z.infer<typeof schemaListeTachesNettoyage>;
export type CreationExecutionNettoyage = z.infer<typeof schemaCreationExecutionNettoyage>;
export type ExecutionNettoyageContrat = z.infer<typeof schemaExecutionNettoyage>;
export type ExecutionNettoyageDetailContrat = z.infer<typeof schemaExecutionNettoyageDetail>;
export type ListeExecutionsNettoyage = z.infer<typeof schemaListeExecutionsNettoyage>;
export type TacheEnRetardContrat = z.infer<typeof schemaTacheEnRetard>;
export type ListeTachesEnRetard = z.infer<typeof schemaListeTachesEnRetard>;
export type GraviteNonConformiteContrat = z.infer<typeof schemaGraviteNonConformite>;
export type NonConformiteContrat = z.infer<typeof schemaNonConformite>;
export type ListeNonConformites = z.infer<typeof schemaListeNonConformites>;
export type CreationNonConformite = z.infer<typeof schemaCreationNonConformite>;
export type ClotureNonConformite = z.infer<typeof schemaClotureNonConformite>;
export type ResultatExerciceContrat = z.infer<typeof schemaResultatExercice>;
export type ExerciceTracabiliteContrat = z.infer<typeof schemaExerciceTracabilite>;
export type ListeExercicesTracabilite = z.infer<typeof schemaListeExercicesTracabilite>;
export type CreationExerciceTracabilite = z.infer<typeof schemaCreationExerciceTracabilite>;
export type TracabiliteGarnitureContrat = z.infer<typeof schemaTracabiliteGarniture>;
export type TracabiliteAmontSessionContrat = z.infer<typeof schemaTracabiliteAmontSession>;
export type TracabiliteAvalLotContrat = z.infer<typeof schemaTracabiliteAvalLot>;
export type PeriodeRequete = z.infer<typeof schemaPeriodeRequete>;
