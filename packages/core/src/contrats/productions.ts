/**
 * Contrat HTTP des routes `/api/productions` (Lot 3).
 */

import { z } from 'zod';
import { schemaUnite } from './recettes.js';
import { schemaStatutSession } from './sessions.js';

export const schemaStatutProduction = z.enum(['lancee', 'terminee', 'annulee']);

/** Cible d'une production. Meme forme que celle du calculateur de recettes. */
export const schemaCibleProduction = z.discriminatedUnion('cible', [
  z.object({ cible: z.literal('crepes'), valeur: z.int().positive() }),
  z.object({ cible: z.literal('volume'), valeur: z.int().positive() }),
]);

export const schemaBesoinIngredient = z.object({
  ingredientId: z.string(),
  nomIngredient: z.string(),
  unite: schemaUnite,
  requis: z.int(),
  disponible: z.int(),
  /** `0` quand le stock suffit. */
  manquant: z.int(),
});

/**
 * Diagnostic de faisabilite. Rendu meme quand rien n'est faisable : l'ecran
 * doit pouvoir afficher CHAQUE manque avec son chiffre, pas un refus global.
 */
export const schemaFaisabilite = z.object({
  faisable: z.boolean(),
  besoins: z.array(schemaBesoinIngredient),
  /** Tries du plus contraignant au moins, par RATIO disponible/requis. */
  manquants: z.array(schemaBesoinIngredient),
  ingredientLimitant: schemaBesoinIngredient.nullable(),
  /** Volume reellement produisible avec le stock actuel, en ml. */
  volumeMaximalMl: z.int(),
  /** Ce que la cible demandee represente. */
  volumeMl: z.int(),
  crepes: z.int(),
});

export const schemaDemandeFaisabilite = z.object({
  recetteId: z.string().min(1),
  cible: schemaCibleProduction,
  dateProduction: z.string().min(1),
});

/**
 * Creation d'une production.
 *
 * PAS de `ecartMotif` ici, volontairement. `docs/01` module 3 prevoit de motiver
 * « un ecart important » par rapport a l'ordre suggere — mais l'ordre suggere
 * vient du moteur de prevision, qui est le Lot 5. Sans reference a laquelle se
 * comparer, « ecart important » n'a aucune definition, et le champ finirait par
 * partager la meme colonne que le motif d'ecart du REALISE : la seconde saisie
 * ecraserait silencieusement la premiere. Un champ, un sens.
 */
export const schemaCreationProduction = schemaDemandeFaisabilite.extend({
  notes: z.string().nullable().optional(),
  /**
   * Session a laquelle la pate est destinee, si elle est deja connue au
   * lancement (docs/14 G1/G4). OPTIONNEL : on lance souvent la pate avant
   * d'avoir cree la session du marche — le rattachement peut toujours se
   * faire APRES coup via `schemaRattachementSession`, qui est le geste qui
   * compte autant que celui-ci.
   */
  sessionId: z.string().min(1).nullable().optional(),
  /**
   * Prevision sur laquelle le porteur a decide de lancer CETTE fournee, si
   * l'ecran en affichait une au moment du lancement. La pate se decide la
   * veille (docs/03), et une session peut porter PLUSIEURS revisions de
   * prevision archivees (J-7, J-3, J-1…, D-058) : ce champ dit LAQUELLE a
   * reellement motive ce lancement, ce que `production.sessionId` +
   * `prevision.sessionId` seuls ne peuvent pas dire (transitif, ambigu des
   * qu'une session porte plus d'une revision).
   *
   * OPTIONNEL et volontairement distinct de `sessionId` : une fournee lancee
   * sans prevision (depannage, rattrapage un lundi matin) est un cas normal —
   * `null` le dit explicitement, jamais une valeur choisie apres coup par le
   * serveur (qui ne sait pas ce que l'ecran affichait reellement a cet
   * instant, seul le client le sait).
   */
  previsionId: z.string().min(1).nullable().optional(),
});

/**
 * Rattachement (ou correction, ou detachement) d'une production a une
 * session, INDEPENDAMMENT du lancement — c'est le geste qui manquait :
 * docs/14 G1/G4 constate qu'on ne peut lancer une production QUE sans
 * session, jamais la rattacher apres coup. `sessionId: null` detache la
 * production (corrige une erreur de saisie) ; ce n'est PAS le role de
 * `PATCH /productions/:id/realise`, qui force le statut a `terminee`.
 */
export const schemaRattachementSession = z.object({
  sessionId: z.string().min(1).nullable(),
});

export const schemaConsommationProduction = z.object({
  lotId: z.string(),
  ingredientId: z.string(),
  nomIngredient: z.string(),
  unite: schemaUnite,
  numeroLotFournisseur: z.string().nullable(),
  quantiteTheorique: z.int(),
  /**
   * Quantite DECLAREE par le porteur pour l'INGREDIENT de cette ligne, figee
   * ici seulement quand un seul lot a ete consomme pour cet ingredient — seul
   * cas ou la valeur declaree est attribuable a un lot sans inventer de
   * repartition (voir `saisirRealise`). `null` autrement : c'est une
   * DECLARATION manquante, pas une consommation nulle.
   */
  quantiteReelle: z.int().nullable(),
  /**
   * Cout THEORIQUE de cette ligne, fige au lancement : ce que la recette
   * prevoyait de prendre sur CE lot, au prix paye pour CE lot. Ne bouge plus
   * jamais, meme apres saisie du realise — c'est le terme de comparaison.
   */
  coutCents: z.int(),
  /**
   * Quantite NETTE reellement mouvementee sur CE lot pour cette production :
   * sorties moins restitutions, telles que le grand livre les a enregistrees.
   *
   * DISTINCTE de `quantiteReelle` ci-dessus, et les deux sont necessaires :
   * `quantiteReelle` est ce que le porteur a DECLARE pour l'ingredient entier
   * (donc `null` des que la fournee a puise dans plusieurs lots), tandis que
   * celle-ci est ce que le STOCK a reellement enregistre lot par lot. Sur une
   * sur-consommation, la matiere en plus est prise en FEFO sur le stock du
   * jour : elle peut tomber sur un AUTRE lot que celui de la ligne, auquel cas
   * les deux valeurs different legitimement.
   *
   * `null` tant que le realise n'est pas saisi : avant lui il n'existe aucune
   * mesure du reel, et afficher la quantite theorique dans une colonne
   * « reel » serait exactement le mensonge que `coutMatiereReelCents` evite en
   * restant `null`.
   *
   * ═══ MEME NOM QUE `schemaTracabiliteAmontConsommation.quantiteMouvementee`
   * (`./afsca.js`), ET C'EST VOULU ═══
   *
   * C'est la MEME grandeur, calculee par le meme grand livre : le net signe des
   * mouvements de stock qu'une production a ecrits sur un lot. Elle s'appelait
   * ici `quantiteReelleMouvementee` et la-bas `quantiteMouvementee` — deux noms
   * pour un seul chiffre, dans un produit dont CLAUDE.md §0 pose que les
   * modules forment une seule chaine de donnees. C'est exactement ce qui fait
   * qu'un correctif s'applique d'un cote et pas de l'autre. Unifie sur le nom
   * le plus court le 01/08/2026 : « reelle » ne disait que ce que le chiffre
   * n'est PAS (ni theorique, ni declare), la ou « mouvementee » dit ce qu'il
   * EST — le net du grand livre.
   *
   * Les deux contrats portent desormais le meme triplet de quantites :
   * `quantiteTheorique` (prevu) / `quantiteReelle` (declare) / `quantiteMouvementee`
   * (mouvemente). La NULLABILITE, elle, differe legitimement et n'est pas
   * portee par le nom : cote AFSCA le champ est toujours connu (le registre
   * montre ce que le stock a enregistre des le lancement), ici il reste `null`
   * tant que le realise n'est pas saisi, pour la raison dite juste au-dessus.
   */
  quantiteMouvementee: z.int().nullable(),
  /**
   * Cout REEL de cette ligne, en centimes : le cout des mouvements que cette
   * production a reellement ecrits sur CE lot (sorties moins restitutions),
   * hors contrepassations.
   *
   * DEFAUT CORRIGE le 01/08/2026 : la ligne affichait « 1 509 g consommes » a
   * cote d'un cout calcule sur 1 192 g, parce que `coutCents` est reste
   * theorique. Le total, lui, etait juste — d'ou le pire des symptomes : un
   * chiffre correct rendu suspect par la ligne qui le contredit.
   *
   * DERIVE DU GRAND LIVRE, jamais recalcule : c'est la seule construction pour
   * laquelle la somme des lignes redonne EXACTEMENT le total facture par la
   * cloture de session. Un recalcul « quantite reelle x prix unitaire »
   * arrondirait une seconde fois et divergerait du total de quelques centimes
   * — une incoherence invisible aurait remplace une incoherence visible.
   *
   * L'invariant, verifie par test :
   * `somme(coutReelCents) + coutMatiereReelNonAffecteCents === coutMatiereReelCents`.
   *
   * `null` tant que le realise n'est pas saisi (meme regle que
   * `coutMatiereReelCents`). Un `0` ici est un VRAI zero : la matiere prise sur
   * ce lot a ete integralement restituee, ce qui n'est pas « inconnu ».
   *
   * REQUIS depuis le 01/08/2026 — voir `schemaProductionDetail.
   * coutMatiereReelNonAffecteCents` pour le motif complet. `.nullable()` reste,
   * et ce n'est pas la meme chose : `null` est une valeur qui DIT « pas encore
   * mesure », la ou l'absence de cle ne disait rien du tout.
   */
  coutReelCents: z.int().nullable(),
});

export const schemaProductionResume = z.object({
  id: z.string(),
  numero: z.string(),
  recetteCode: z.string(),
  recetteNom: z.string(),
  dateProduction: z.string(),
  statut: schemaStatutProduction,
  volumeTheoriqueMl: z.int(),
  crepesTheoriques: z.int(),
  volumeReelMl: z.int().nullable(),
  crepesReelles: z.int().nullable(),
  coutMatiereTheoriqueCents: z.int(),
  /**
   * Cout matiere REELLEMENT engage, `null` tant que le realise n'est pas saisi.
   *
   * Trouve manquant le 01/08/2026 par un parcours de bout en bout, et c'est le
   * seul type de test qui pouvait le voir : la colonne est ECRITE par
   * `saisirRealise`, LUE par la cloture de session — qui facture donc bien le
   * cout reel a la marge du marche — et n'etait exposee par AUCUNE route de
   * lecture. Le chiffre etait calcule, persiste, facture, et invisible partout.
   *
   * L'ecart de RENDEMENT etait deja expose (`ecartRendementBp`), pas l'ecart de
   * COUT : la moitie du module « comptabilite analytique — ecart
   * theorique/reel » de CLAUDE.md §0 manquait. Aucun test unitaire de
   * `saisirRealise` ne pouvait le detecter, la valeur etant bien en base.
   */
  coutMatiereReelCents: z.int().nullable(),
  numeroLotPate: z.string(),
  dateDlcPate: z.string(),
  /**
   * Session a laquelle cette production est rattachee. `null` = pate pas
   * encore affectee a un marche. C'est PRECISEMENT le champ dont l'absence de
   * saisie faisait perdre le cout de la pate dans la marge de session ET
   * rompait la tracabilite aval (docs/14 G1/G4) : le moteur le lisait deja
   * (`cloturerSession`, `tracabiliteAvalLot`), seule la saisie manquait.
   *
   * `.optional()` en plus de `.nullable()` UNIQUEMENT pour que l'ecran reste
   * utilisable si le serveur qui repond n'a pas encore ce champ (deploiement
   * en plusieurs temps) — une fois le backend a jour, il est toujours present.
   */
  sessionId: z.string().nullable().optional(),
  /** Numero lisible (`SM-2026-0003`), pour ne jamais afficher un UUID a l'ecran. */
  sessionNumero: z.string().nullable().optional(),
  /**
   * Statut de la session rattachee, pour figer le controle de rattachement
   * cote ecran quand elle est deja cloturee (D-024) — sans reproduire ici le
   * calcul metier, seulement transmettre ce que le serveur a deja verifie.
   */
  sessionStatut: schemaStatutSession.nullable().optional(),
});

export const schemaProductionDetail = schemaProductionResume.extend({
  /** Motif de l'ecart THEORIQUE/REEL, saisi avec le realise. Un seul usage. */
  ecartMotif: z.string().nullable(),
  notes: z.string().nullable(),
  consommations: z.array(schemaConsommationProduction),
  /** `null` tant que le realise n'a pas ete saisi. */
  ecartRendementBp: z.int().nullable(),
  /**
   * Prevision retenue AU LANCEMENT (voir `schemaCreationProduction.previsionId`).
   * `null` = decidee sans prevision, un cas normal, pas une donnee manquante.
   *
   * Les trois champs suivants ne sont QUE la relecture de ce qui a ete
   * archive par `POST /prevision/archiver` — aucun calcul de prevision n'a
   * lieu ici (CLAUDE.md §3 regle 2) — pour que l'ecran puisse comparer ce qui
   * a ete produit a ce que le modele suggerait ce soir-la.
   */
  previsionId: z.string().nullable(),
  previsionDateCalcul: z.string().nullable(),
  previsionP50Crepes: z.int().nullable(),
  previsionCrepesRetenues: z.int().nullable(),
  /**
   * Ecart SIGNE, en points de base, entre `crepesTheoriques` (ce qui a ete
   * decide) et `previsionCrepesRetenues` (ce que le modele, apres ecretage
   * par les contraintes dures, suggerait de produire) — jamais contre le p50
   * brut, qui ignore les contraintes de capacite deja retenues par le
   * moteur. `null` sans prevision rattachee, ou si celle-ci portait sur zero
   * crepe retenue (ratio sans sens).
   */
  ecartVsPrevisionBp: z.int().nullable(),
  /**
   * Part du cout matiere REEL qui ne se rattache a AUCUNE ligne de
   * `consommations`, en centimes.
   *
   * D'ou elle vient : une sur-consommation declaree au realise est prise sur le
   * stock du JOUR, en FEFO. Si les lots que la fournee avait consommes sont
   * epuises, cette matiere sort d'un lot que `production_consommation` ne
   * connait pas — son cout est bien dans `coutMatiereReelCents` (il est sorti
   * du stock, regle n°5), mais aucune ligne ne peut le porter sans lui inventer
   * une appartenance.
   *
   * Ce champ EXISTE pour que l'invariant tienne PAR CONSTRUCTION et non par
   * chance : `somme(consommations.coutReelCents) + ce champ ===
   * coutMatiereReelCents`, toujours. Sans lui, la somme des lignes serait
   * silencieusement inferieure au total dans ce cas precis — le defaut aurait
   * ete deplace, pas corrige.
   *
   * `0` est le cas normal et c'est un VRAI zero (tout est rattache a un lot de
   * la fournee) ; `null` tant que le realise n'est pas saisi.
   *
   * CONSEQUENCE A NE PAS PERDRE DE VUE : quand ce champ n'est pas nul, un lot a
   * reellement alimente cette fournee sans figurer parmi ses `consommations` —
   * qui restent, elles, la photo du plan FEFO pris au lancement. La TRACABILITE
   * ne perd pas ce lot pour autant : `consommationsDeLaProduction` et
   * `tracabiliteAvalLot` (`@batte/db`) partent tous deux du grand livre des
   * mouvements, pas de `production_consommation`, et rendent ce lot avec un
   * `quantiteTheorique` a `0` — un vrai zero, rien ne lui avait ete alloue.
   *
   * ═══ REQUIS DEPUIS LE 01/08/2026 ═══
   *
   * Ce champ, `coutReelCents` et `quantiteMouvementee` avaient ete declares
   * `.optional()` par concession de transition : requis, ils cassaient des
   * fixtures de `apps/web` que la mission qui les a ajoutes n'avait pas le
   * droit de toucher. Ces fixtures sont a jour, la concession est levee.
   *
   * Ce que le durcissement achete, et c'est docs/39 §5 : un champ OPTIONNEL que
   * le depot cesserait de fournir disparait SILENCIEUSEMENT a la frontiere HTTP
   * — le depot calcule, le contrat supprime, personne ne voit, rien ne le
   * signale. REQUIS, la meme disparition rend un 422 bruyant. Ce qui tenait a
   * la place du contrat n'etait pas une garantie mais un equilibre a deux
   * pieds : le type de retour annote du depot (`ProductionDetailLue`) et un test
   * de route verifiant la presence de la cle. Si l'un des deux tombait, la
   * suppression silencieuse redevenait possible.
   */
  coutMatiereReelNonAffecteCents: z.int().nullable(),
});

export const schemaListeProductions = z.object({
  data: z.array(schemaProductionResume),
  meta: z.object({ total: z.int() }),
});

/**
 * Annulation d'une production (audit du 29/07/2026 : le statut `annulee`
 * existait déjà dans `schemaStatutProduction`, aucun chemin ne l'écrivait).
 * Le motif est OBLIGATOIRE et choisi dans le catalogue, même règle que
 * `schemaContrepassation` (`contrats/stock.ts`) : une annulation sans motif ne
 * répondrait pas à « pourquoi ce stock est-il revenu ? ».
 */
export const schemaAnnulationProduction = z.object({
  motifCode: z.string().min(1),
});

export const schemaAnnulationProductionCreee = z.object({
  productionId: z.string(),
  numero: z.string(),
  /** Mouvements contrepassés, pour que la confirmation dise CE QUI a bougé. */
  nbMouvementsContrepasses: z.int(),
});

/**
 * Consommation RÉELLE d'UN ingrédient, déclarée au moment du réalisé
 * (docs/17 fiche 9). Par INGRÉDIENT et non par lot : c'est ce que le porteur
 * peut réellement mesurer après une fournée (peser ce qu'il reste de farine),
 * jamais « combien pris dans le lot A contre le lot B ».
 */
export const schemaConsommationReelleDeclaree = z.object({
  ingredientId: z.string().min(1),
  quantiteReelle: z.int().nonnegative(),
});

export const schemaSaisieRealise = z.object({
  volumeReelMl: z.int().nonnegative(),
  crepesReelles: z.int().nonnegative(),
  ecartMotif: z.string().nullable().optional(),
  /**
   * Optionnelle et partielle : le porteur peut déclarer le réel d'un seul
   * ingrédient, ou d'aucun (comportement inchangé). Chaque écart déclaré
   * devient un vrai MOUVEMENT de stock rattaché à la production (règle
   * n°5) — jamais une valeur dérivée par une règle de trois à partir du
   * volume global, qui inventerait une mesure (docs/17 fiche 9).
   */
  consommationsReelles: z.array(schemaConsommationReelleDeclaree).optional(),
});

export type BesoinIngredientContrat = z.infer<typeof schemaBesoinIngredient>;
export type Faisabilite = z.infer<typeof schemaFaisabilite>;
export type CibleProduction = z.infer<typeof schemaCibleProduction>;
export type ProductionResume = z.infer<typeof schemaProductionResume>;
export type ProductionDetail = z.infer<typeof schemaProductionDetail>;
export type ListeProductions = z.infer<typeof schemaListeProductions>;
export type ConsommationProduction = z.infer<typeof schemaConsommationProduction>;
export type CreationProduction = z.infer<typeof schemaCreationProduction>;
export type RattachementSession = z.infer<typeof schemaRattachementSession>;
export type ConsommationReelleDeclaree = z.infer<typeof schemaConsommationReelleDeclaree>;
export type SaisieRealise = z.infer<typeof schemaSaisieRealise>;
export type AnnulationProduction = z.infer<typeof schemaAnnulationProduction>;
export type AnnulationProductionCreee = z.infer<typeof schemaAnnulationProductionCreee>;
