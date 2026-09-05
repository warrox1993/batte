/**
 * Contrat HTTP des routes `/api/stock`, `/api/receptions`, `/api/mouvements`
 * et `/api/motifs` (Lot 2).
 */

import { z } from 'zod';
import { schemaUnite } from './recettes.js';

export const schemaStatutLot = z.enum(['disponible', 'quarantaine', 'bloque', 'detruit']);

/**
 * Statut de la RÉCEPTION d'origine d'un lot — indépendant de `schemaStatutLot`
 * ci-dessus, qui porte le statut du LOT (disponible, quarantaine…). Ajoutée le
 * 30/07/2026 avec la colonne `reception.statut` (migration
 * `0025_high_captain_universe.sql`) : c'est ce qui permet à un écran de dire
 * « cette réception est annulée » sur un lot dont la réception a été annulée
 * par `annulerReception` (`packages/db/src/services/reception.ts`).
 */
export const schemaStatutReception = z.enum(['active', 'annulee']);

export const schemaTypeSortie = z.enum([
  'sortie_production',
  'sortie_vente',
  'perte',
  'ajustement_inventaire',
  'consommation_perso',
]);

/** Une ligne de l'ecran Stock : un ingredient, tous lots confondus. */
export const schemaLigneStock = z.object({
  ingredientId: z.string(),
  nom: z.string(),
  unite: schemaUnite,
  stockSecurite: z.int(),
  quantiteDisponible: z.int(),
  quantiteTotale: z.int(),
  valeurCents: z.int(),
  /** `null` quand le stock est epuise : zero ferait croire a une marge de 100 %. */
  cumpCentsParUnite: z.number().nullable(),
  dlcLaPlusProche: z.string().nullable(),
  nbLots: z.int(),
});

export const schemaEtatStock = z.object({
  data: z.array(schemaLigneStock),
  meta: z.object({
    total: z.int(),
    valeurTotaleCents: z.int(),
    /**
     * Nombre d'ingredients a reapprovisionner — rupture OU sous le stock de
     * securite. Calcule par `statutStock`, la MEME fonction que l'ecran utilise
     * pour colorer chaque ligne, afin que l'en-tete ne contredise jamais le
     * tableau. Une definition locale ici annoncerait « 0 ingredient concerne »
     * au-dessus de sept lignes rouges.
     */
    nbAReapprovisionner: z.int(),
  }),
});

/** Un lot, tel qu'affiche dans le detail d'un ingredient. */
export const schemaLotDetail = z.object({
  id: z.string(),
  numeroLotFournisseur: z.string().nullable(),
  dateReception: z.string(),
  dateDlc: z.string().nullable(),
  quantiteRestante: z.int(),
  /** Quantite recue a l'origine. Denominateur du taux ci-dessous, affichee telle quelle. */
  quantiteInitiale: z.int().nonnegative(),
  /**
   * Montant REELLEMENT PAYE pour ce lot, en centimes ENTIERS (regle n°3).
   * C'est la seule valeur rapprochable de la facture fournisseur au centime.
   */
  prixLigneCents: z.int().nonnegative(),
  /** Taux DERIVE (`prixLigneCents / quantiteInitiale`) : fractionnaire, jamais persiste. */
  prixUnitaireCents: z.number(),
  statut: schemaStatutLot,
  /**
   * Statut de la RÉCEPTION d'origine (`active`/`annulee`), distinct de
   * `statut` ci-dessus qui porte celui du lot. Une quantité restante à zéro ne
   * dit pas, à elle seule, si le lot a simplement été épuisé par la vente ou
   * si sa réception a été ANNULÉE — seul ce champ le distingue.
   */
  receptionStatut: schemaStatutReception,
});

export const schemaListeLots = z.object({
  data: z.array(schemaLotDetail),
  meta: z.object({ total: z.int() }),
});

/**
 * UN lot, tel que `GET /api/lots/:lotId` le rend — la RÉCEPTION d'origine
 * comprise (D-087, 31/07/2026).
 *
 * POURQUOI UN SECOND SCHÉMA PLUTÔT QUE TROIS CHAMPS SUR `schemaLotDetail`.
 * `schemaLotDetail` ci-dessus décrit les lignes de `GET /stock/:id/lots`, que
 * `apps/api/src/routes/stock.ts` assemble CHAMP PAR CHAMP avant de les passer
 * à `schemaListeLots.parse`. Y ajouter une clé obligatoire ferait échouer ce
 * `parse` — la route rendrait 500 — tant que la route n'est pas modifiée en
 * regard. `GET /lots/:lotId`, lui, rend l'objet du dépôt TEL QUEL, sans
 * assemblage : les trois champs y arrivent donc dès que `LotEnBase`
 * (`packages/db/src/depots/stock.ts`) les porte. Ce schéma est aussi la
 * PREMIÈRE validation Zod de cette route, jusqu'ici rendue sans contrat.
 *
 * Quand la route de liste sera mise à jour pour transporter ces trois champs,
 * ce schéma pourra fusionner dans `schemaLotDetail` et l'appel supplémentaire
 * disparaîtra de `DetailLot.tsx`.
 */
export const schemaLotAvecReception = schemaLotDetail.extend({
  /** L'ingrédient du lot. Rendu par cette route, absent de la liste ci-dessus. */
  ingredientId: z.string(),
  /**
   * Identifiant de la réception d'origine — le seul moyen d'appeler
   * `POST /receptions/:id/annuler` depuis un écran, aucune route ne LISANT
   * les réceptions.
   */
  receptionId: z.string(),
  /** Numéro lisible (`RC-2026-0007`) : jamais un UUID à l'écran. */
  receptionNumero: z.string(),
  /**
   * Nombre de lots créés par cette réception, celui-ci compris (donc >= 1).
   * Annuler la réception les contrepasse TOUS : ce nombre doit être dit AVANT
   * la confirmation, sans quoi on croit corriger une ligne et on en corrige
   * trois.
   */
  receptionNbLots: z.int().positive(),
});

/** Catalogue des motifs, pour alimenter les listes deroulantes de l'interface. */
export const schemaMotif = z.object({
  code: z.string(),
  libelle: z.string(),
  categorie: z.enum(['perte', 'ajustement', 'sortie_volontaire', 'statut_lot']),
});

export const schemaListeMotifs = z.object({
  data: z.array(schemaMotif),
  meta: z.object({ total: z.int() }),
});

/**
 * Une ligne de réception.
 *
 * L'IDENTIFICATION du lot (numéro fournisseur OU DLC précise au jour près) est
 * une exigence RÉGLEMENTAIRE (docs/17 fiche 16 ; CLAUDE.md §3 règle 6), mais ce
 * n'est PAS un contrôle Zod : elle dépend de la durée de conservation de
 * l'ingrédient, connue seulement en base (une DLC absente ICI peut encore être
 * DÉDUITE côté serveur). `enregistrerReception`
 * (`packages/db/src/services/reception.ts`) est donc la seule autorité sur
 * cette règle — voir son commentaire pour le détail, y compris la référence à
 * la directive européenne 2011/91/UE qui fonde la règle.
 */
export const schemaLigneReception = z.object({
  ingredientId: z.string().min(1),
  quantite: z.int().positive(),
  prixLigneCents: z.int().nonnegative(),
  numeroLotFournisseur: z.string().nullable().optional(),
  dateDlc: z.string().nullable().optional(),
});

export const schemaCreationReception = z.object({
  fournisseurId: z.string().min(1),
  dateReception: z.string().min(1),
  numeroBonLivraison: z.string().nullable().optional(),
  /**
   * Commande soldee par cette reception. Referme la boucle d'achat : sans elle,
   * la commande reste comptee comme « en route » et le stock projete
   * double-compte la marchandise deja recue (D-036).
   */
  commandeId: z.string().min(1).nullable().optional(),
  notes: z.string().nullable().optional(),
  lignes: z.array(schemaLigneReception).min(1, 'Une réception doit contenir au moins une ligne.'),
});

export const schemaReceptionCreee = z.object({
  receptionId: z.string(),
  numero: z.string(),
  montantTotalCents: z.int(),
  nbLots: z.int(),
  /**
   * Avertissements NON BLOQUANTS (docs/17 fiche 16) : la réception a été
   * acceptée, mais au moins un lot n'est identifié que par sa DLC, sans numéro
   * fournisseur — deux réceptions à la même DLC resteraient indistinguables en
   * cas de rappel. Vide la plupart du temps.
   */
  avertissements: z.array(z.string()),
  /**
   * Numéro de la commande soldée par cette réception, `null` si aucune
   * commande n'était rattachée (mission « boucle d'achat », 30/07/2026).
   *
   * L'écran de saisie (`SaisieReception.tsx`) sait déjà QUELLE commande on
   * vient de choisir — c'est le menu déroulant lui-même — mais la
   * confirmation renvoyée après enregistrement ne le redisait jamais : « voir
   * laquelle » s'arrêtait à l'instant de la saisie.
   */
  commandeNumero: z.string().nullable(),
});

/**
 * Annulation d'une réception (audit « rien ne s'efface » du 30/07/2026).
 *
 * Aucun chemin n'annulait une réception, alors que `annulerProduction`,
 * `annulerSession` et `annulerCommande` existaient déjà : une marchandise
 * saisie par erreur restait en stock pour toujours, et la seule issue était une
 * contrepassation manuelle, mouvement par mouvement.
 *
 * Le motif est OBLIGATOIRE, comme pour `schemaAnnulationProduction` et
 * `schemaContrepassation` : une annulation sans motif ne répond pas à la seule
 * question que posera le registre — « pourquoi ce stock a-t-il disparu ? ».
 */
export const schemaAnnulationReception = z.object({
  motifCode: z.string().min(1),
});

export const schemaAnnulationReceptionCreee = z.object({
  receptionId: z.string(),
  numero: z.string(),
  /**
   * Mouvements d'entrée contrepassés, un par lot encore intact. Compte affiché
   * dans la confirmation : le porteur doit lire CE QUI a bougé, pas seulement
   * que « c'est annulé ».
   */
  nbMouvementsContrepasses: z.int(),
  /**
   * Commande liée à cette réception (`reception.commandeId`), ou `null`
   * (mission « boucle d'achat », 30/07/2026).
   */
  commandeId: z.string().nullable(),
  /**
   * Statut auquel la commande liée a été REMISE, uniquement quand son statut
   * antérieur à cette réception a pu être retrouvé avec CERTITUDE (journal
   * d'audit) — voir `annulerReception` (`packages/db/src/services/reception.ts`)
   * pour le raisonnement complet. `null` dans tous les autres cas, y compris
   * quand une commande était bien liée : ne jamais le confondre avec
   * `commandeId`, qui dit LUI si une commande existait.
   */
  commandeStatutRestaure: z.enum(['brouillon', 'validee', 'envoyee']).nullable(),
});

/**
 * Sortie manuelle. Le motif est OBLIGATOIRE : sans code, on ne peut pas
 * repondre a « ou fuit la matiere ? » (docs/07 §6.8 rang 9).
 */
export const schemaCreationSortie = z.object({
  ingredientId: z.string().min(1),
  quantite: z.int().positive(),
  type: schemaTypeSortie,
  motifCode: z.string().min(1),
  motifTexte: z.string().nullable().optional(),
  dateMouvement: z.string().min(1),
  autoriserDlcDepassee: z.boolean().optional(),
});

export const schemaSortieCreee = z.object({
  nbMouvements: z.int(),
  coutTotalCents: z.int(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Historique des mouvements d'un lot, contrepassation, statut de lot
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Type d'un mouvement. Reprend l'enum de la colonne, `entree` COMPRISE — celle
 * qu'une sortie ne peut pas porter (`schemaTypeSortie` ci-dessus) mais qu'un
 * historique doit savoir afficher : c'est la reception d'origine du lot.
 */
export const schemaTypeMouvement = z.enum([
  'entree',
  'sortie_production',
  'sortie_vente',
  'perte',
  'ajustement_inventaire',
  'consommation_perso',
]);

/**
 * Une ligne de l'historique d'un lot.
 *
 * `isAnnule` est rendu au client parce que l'ecran doit BARRER la ligne, pas
 * la masquer : « rien ne s'efface » (CLAUDE.md §3 regle 7) est une promesse
 * faite a l'utilisateur, pas seulement une regle de base de donnees. Et il ne
 * sert QU'A CA — D-021 : les cumuls incluent les ecritures annulees, puisque la
 * contrepassation ajoute une ecriture inverse au lieu d'en retirer une. Filtrer
 * ici et soustraire la-bas rendrait la matiere deux fois (29 000 g au lieu de
 * 25 000, mesure a l'epoque).
 */
export const schemaMouvementLot = z.object({
  id: z.string(),
  type: schemaTypeMouvement,
  /** Toujours positive : c'est le TYPE qui porte le signe. */
  quantite: z.int(),
  dateMouvement: z.string(),
  coutCents: z.int(),
  /** Code du catalogue, `null` sur les mouvements anterieurs au catalogue. */
  motifCode: z.string().nullable(),
  motifLibelle: z.string().nullable(),
  motifTexte: z.string().nullable(),
  ajustement: z.boolean(),
  /** Vrai si CE mouvement a ete contrepasse. Affichage seulement (D-021). */
  isAnnule: z.boolean(),
  /** Identifiant de l'ecriture qui l'a contrepasse. */
  annuleParId: z.string().nullable(),
  /** Vrai si ce mouvement EST une contrepassation d'un autre. */
  estContrepassation: z.boolean(),
  creeLe: z.string(),
});

export const schemaListeMouvementsLot = z.object({
  data: z.array(schemaMouvementLot),
  meta: z.object({
    total: z.int(),
    /** Nombre de lignes annulees, pour que l'ecran l'annonce sans recompter. */
    nbAnnules: z.int(),
  }),
});

/**
 * Contrepassation d'un mouvement. Le motif est OBLIGATOIRE et choisi dans le
 * catalogue : une correction sans motif ne repond pas a « pourquoi ce chiffre
 * a-t-il bouge ? », qui est exactement la question qu'on posera plus tard.
 */
export const schemaContrepassation = z.object({
  motifCode: z.string().min(1),
});

export const schemaContrepassationCreee = z.object({
  /** Le mouvement d'origine, desormais marque annule (il reste au journal). */
  mouvementAnnuleId: z.string(),
  /** L'ecriture INVERSE qui vient d'etre ajoutee. */
  contrepassationId: z.string(),
  /** Quantite remise en jeu, pour que la confirmation porte le chiffre. */
  quantite: z.int(),
});

/**
 * Changement de statut d'un lot (quarantaine, blocage, destruction, remise a
 * disposition). Le motif vient du catalogue, jamais d'un champ libre : le
 * serveur refuse deja un code inconnu par `422 motif_inconnu`.
 */
export const schemaChangementStatutLot = z.object({
  statut: schemaStatutLot,
  motifCode: z.string().min(1),
});

/**
 * Confirmation d'un changement de statut. Les trois derniers champs sont
 * `null` sauf pour une DESTRUCTION qui a réellement retiré de la matière du
 * stock (docs/17 fiche 18) : la confirmation doit dire CE QUI a bougé, jamais
 * seulement « c'est fait » — même principe que `schemaContrepassationCreee`.
 */
export const schemaStatutLotChange = z.object({
  lotId: z.string(),
  statutPrecedent: schemaStatutLot,
  statut: schemaStatutLot,
  /** Mouvement de perte écrit par cette destruction, s'il y en a eu un. */
  mouvementDestructionId: z.string().nullable(),
  quantiteDetruite: z.int().nullable(),
  coutDetruitCents: z.int().nullable(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Diagnostic d'integrite du stock (`GET /api/stock/integrite`)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Un lot dont la somme signee des mouvements ne correspond pas a sa quantite
 * initiale — soit sorti au-dela de ce qu'il contenait (`restant < 0`), soit
 * credite en trop (`restant > quantiteInitiale`). Voir
 * `verifierInvariantLots` (packages/db/src/depots/stock.ts).
 */
export const schemaLotFautifIntegrite = z.object({
  lotId: z.string(),
  quantiteInitiale: z.int(),
  restant: z.int(),
});

/**
 * Verdict du controle d'integrite du grand livre de stock — le controle sur
 * lequel repose la credibilite du registre AFSCA.
 *
 * CLAUDE.md §4 interdit les echecs silencieux : un controle qui ne repond
 * QUE sur l'echec en est un tout autant. `coherent` et `nbLotsVerifies` sont
 * donc TOUJOURS presents, y compris quand tout va bien — « cohérent, N lots
 * vérifiés » est une reponse a part entiere, jamais une absence de reponse.
 */
export const schemaDiagnosticIntegriteStock = z.object({
  coherent: z.boolean(),
  nbLotsVerifies: z.int(),
  /** Vide quand `coherent` est vrai. */
  lotsFautifs: z.array(schemaLotFautifIntegrite),
});

export type LotFautifIntegriteContrat = z.infer<typeof schemaLotFautifIntegrite>;
export type DiagnosticIntegriteStockContrat = z.infer<typeof schemaDiagnosticIntegriteStock>;

export type LigneStockContrat = z.infer<typeof schemaLigneStock>;
export type EtatStock = z.infer<typeof schemaEtatStock>;
export type LotDetail = z.infer<typeof schemaLotDetail>;
export type LotAvecReception = z.infer<typeof schemaLotAvecReception>;
export type ListeLots = z.infer<typeof schemaListeLots>;
export type ReceptionCreee = z.infer<typeof schemaReceptionCreee>;
export type AnnulationReceptionCreee = z.infer<typeof schemaAnnulationReceptionCreee>;
export type MotifContrat = z.infer<typeof schemaMotif>;
export type ListeMotifs = z.infer<typeof schemaListeMotifs>;
export type CreationReception = z.infer<typeof schemaCreationReception>;
export type AnnulationReception = z.infer<typeof schemaAnnulationReception>;
export type CreationSortie = z.infer<typeof schemaCreationSortie>;
export type MouvementLotContrat = z.infer<typeof schemaMouvementLot>;
export type ListeMouvementsLot = z.infer<typeof schemaListeMouvementsLot>;
export type ContrepassationCreee = z.infer<typeof schemaContrepassationCreee>;
export type StatutLotChange = z.infer<typeof schemaStatutLotChange>;
