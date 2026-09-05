/**
 * Rapprochement facture fournisseur (fiche 14, docs/17-VINGT-AMELIORATIONS.md
 * § 14 : « Trois tables de facture mortes, CUMP figé au bon de livraison »).
 *
 * `facture_fournisseur`, `facture_ligne` et `frais_reception` existent depuis
 * le Lot 7 mais n'etaient ecrites nulle part ailleurs qu'au schema — verifie
 * par recherche exhaustive avant d'ecrire ce fichier (voir le rapport de
 * livraison). Consequence : le CUMP restait fige au prix du bon de livraison,
 * jamais confronte au prix reellement facture.
 *
 * TROIS DECISIONS D'ARCHITECTURE A LIRE AVANT DE MODIFIER CE FICHIER.
 *
 * 1. **Prix vs quantite (CLAUDE.md §3 regle 5).** Le stock ne se modifie que
 *    par un MOUVEMENT — mais cette regle porte sur la QUANTITE. Un ecart de
 *    facture ne change jamais une quantite : il corrige `lot.prix_ligne_cents`,
 *    le montant REELLEMENT PAYE pour ce lot (D-044). Ce n'est pas une
 *    quantite, donc ce n'est pas un mouvement — l'ecrire comme un mouvement
 *    fantome inventerait une entree ou une sortie qui n'a jamais eu lieu.
 *    La correction est une simple ecriture sur `lot`, journalisee dans
 *    `journal_audit` (meme mecanisme que `changerStatutLot`, qui met deja a
 *    jour `lot.statut` sans passer par un mouvement).
 *
 * 2. **Rapprochement automatique vs correction explicite.** Enregistrer une
 *    facture RAPPROCHE ses lignes (retrouve le lot vise) et VENTILE
 *    immediatement les FRAIS DE RECEPTION (transport, palette) sur les lots
 *    de la livraison : ce sont des couts additionnels, jamais ambigus,
 *    jamais une remise en cause d'un prix deja constate — les ventiler tout
 *    de suite est sans risque. L'ECART DE PRIX, lui, n'est JAMAIS applique
 *    automatiquement : il est calcule et rendu visible
 *    (`facture_ligne.ecart_prix_cents`), et c'est un geste EXPLICITE
 *    (`corrigerCoutLot`) qui l'applique au lot. Le rapport de la fiche 14 le
 *    dit lui-meme : l'ecart « doit se voir — et il doit POUVOIR corriger le
 *    coût des lots », pas corriger en silence a la saisie.
 *
 * 3. **Jamais de recalcul retroactif silencieux.** `corrigerCoutLot` met a
 *    jour `lot.prix_ligne_cents` — qui n'alimente QUE la valorisation du
 *    RESTANT du lot (`calculerCump`/`valoriserStock` dans
 *    `packages/core/src/stock.ts` ne lisent que `quantite_restante` et le prix
 *    COURANT du lot). Le cout DEJA CONSOMME reste fige dans
 *    `mouvement_stock.cout_cents`, calcule au moment de la sortie et jamais
 *    retouche : une marge de session close ne bouge donc JAMAIS en silence.
 *    Corriger un lot integralement consomme est sans effet mesurable
 *    ailleurs — c'est voulu : la correction porte sur ce qui reste a
 *    valoriser, jamais sur un constat deja lu par le porteur (voir le
 *    rapport de livraison pour l'arbitrage complet).
 *
 * `facture_fournisseur` et `facture_ligne` n'ont pas de colonne
 * `is_annule`/`annule_par_id` (le schema n'est pas modifiable par cette
 * fiche) : la correction d'une facture mal saisie suit donc le meme
 * mecanisme que `annulerDepense` (`packages/db/src/depots/comptabilite.ts`) —
 * une CONTRE-ECRITURE (montant negatif, marqueur `[ANNULATION:<id>]` dans
 * `notes`), jamais un DELETE ni un UPDATE destructif.
 */

import {
  ecartPrix,
  ErreurIntrouvable,
  ErreurMetier,
  jourCivilBelge,
  maintenantUtc,
  nouvelIdentifiant,
  ventilerFrais,
  type BaseVentilationLot,
} from '@batte/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  factureFournisseur,
  factureLigne,
  fournisseur,
  fraisReception,
  ingredient,
  lot,
  reception,
} from '../schema.js';
import { journaliser } from '../depots/audit.js';
import { verifierFournisseurCommercial } from '../depots/fournisseur-systeme.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Piece jointe (bon de livraison / facture scannee)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * DECISION DE CONCEPTION (mission « trois chemins de pièce jointe jamais
 * utilisés », 30/07/2026) — À LIRE avant de toucher à `fichierScanPath`.
 *
 * TROIS VOIES étaient envisageables pour `fichier_scan_path` (colonne TEXTE
 * migrée depuis le Lot 7, jamais écrite qu'à `null`) :
 *
 *  1. Un vrai CHEMIN vers un fichier du disque (ce que le nom de la colonne
 *     suggère). REJETÉ : `packages/db/src/sauvegarde.ts` sauvegarde la base
 *     par `VACUUM INTO` (vérifié À LA LECTURE de ce fichier, pas supposé) —
 *     JAMAIS un dossier annexe. Un chemin disque resterait donc HORS de
 *     chaque sauvegarde quotidienne : le porteur croirait avoir tout
 *     sauvegardé et perdrait ses justificatifs au premier disque changé —
 *     un piège pire que l'absence de fonctionnalité.
 *  2. Une COPIE dans un dossier géré par l'application (à côté de
 *     `donnees/batte.sqlite`, par exemple). REJETÉ pour la MÊME raison que
 *     la voie 1 : `sauvegarder()` (`sauvegarde.ts`) ne connaît QUE le
 *     fichier `.sqlite` lui-même — aucun mécanisme existant ne copie un
 *     dossier annexe, géré ou non. Faire copier ce dossier par
 *     `sauvegarde.ts` est hors du périmètre d'écriture de cette mission
 *     (fichier explicitement protégé) — voir le rapport de livraison.
 *  3. Stocker la pièce DANS la ligne elle-même. RETENU : c'est la SEULE des
 *     trois voies protégée par le mécanisme de sauvegarde qui existe
 *     RÉELLEMENT aujourd'hui, sans y toucher — `VACUUM INTO` copie le
 *     contenu de CHAQUE ligne, pièce jointe comprise.
 *
 * `fichier_scan_path` reste une colonne TEXTE (le schéma n'est pas
 * modifiable par cette mission) : la pièce est donc encodée en Data URI
 * (RFC 2397, `data:<mime>;base64,<...>`) plutôt qu'en BLOB. Une Data URI EST
 * un URI valide au sens du navigateur — `<a href>` / `<img src>` la
 * consomment telle quelle — donc le nom de la colonne (« chemin ») reste
 * défendable, même si son contenu vit désormais dans la ligne plutôt que sur
 * disque.
 *
 * Plafond de taille : sans lui, un fichier trop lourd grossirait
 * `donnees/batte.sqlite` bien au-delà du « fichier unique sauvegardable »
 * visé (CLAUDE.md §2). 8 Mo couvre très largement un scan A4 ou une photo de
 * smartphone d'un bon de livraison ou d'une facture — le volume réel de ce
 * projet (une poignée de factures par mois).
 */
const TAILLE_MAX_PIECE_JOINTE_OCTETS = 8 * 1024 * 1024;

/**
 * Ancré `^...$`, SANS drapeau `i` : un type MIME hors casse exacte
 * (`IMAGE/PNG`), un paramètre inséré avant `;base64,` (`;charset=...`), un
 * `;base64` absent ou dédoublé, ou tout caractère hors alphabet base64 (donc
 * hors de question un deuxième `data:` littéral, puisque `:` n'appartient pas
 * à `[A-Za-z0-9+/]`) ne correspond à AUCUNE de ces variantes — l'ancrage aux
 * deux bouts et l'absence de drapeau insensible à la casse ferment ces
 * contournements par construction, pas par une liste de cas exclus.
 */
const MOTIF_PIECE_JOINTE_DATA_URI =
  /^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/]+=*)$/;

/**
 * Signature (« nombres magiques ») attendue en tête des octets décodés, pour
 * chaque type MIME accepté — sauf WEBP, vérifié à part ci-dessous (RIFF/WEBP
 * ne sont pas contigus).
 *
 * SANS CE CONTRÔLE, le type MIME déclaré dans la Data URI n'est qu'une
 * AFFIRMATION du client : rien n'empêchait un contenu HTML/JS de circuler
 * étiqueté `image/png`, tant que la regex de forme ci-dessus était satisfaite
 * (un motif hostile n'a besoin que d'un en-tête Data URI syntaxiquement
 * correct, pas d'un contenu honnête). Le scénario réaliste dans une
 * application MONO-UTILISATEUR (CLAUDE.md — nuance de la mission « surface
 * d'attaque ») n'est pas un attaquant distant : c'est un fichier reçu d'un
 * fournisseur et joint sans y regarder, dont l'extension ne garantit rien sur
 * le contenu réel. Vérifier les octets ferme cette confusion de type sans
 * jamais faire confiance à ce que le client déclare.
 */
const SIGNATURES_MIME: Readonly<Record<string, readonly number[]>> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // "%PDF-"
};

/**
 * Le contenu décodé correspond-il RÉELLEMENT au type MIME déclaré ?
 *
 * Décode seulement un PRÉFIXE (32 caractères base64 = 24 octets décodés) :
 * largement suffisant pour la plus longue signature vérifiée ici (WEBP,
 * 12 octets), sans décoder l'intégralité d'une pièce jusqu'à 8 Mo pour une
 * simple vérification d'en-tête.
 */
function contenuCorrespondAuTypeDeclare(mime: string, base64: string): boolean {
  const prefixeDecode = Buffer.from(base64.slice(0, 32), 'base64');

  if (mime === 'image/webp') {
    // RIFF <taille 4 octets> WEBP : deux jetons non contigus, vérifiés à part.
    if (prefixeDecode.length < 12) return false;
    return (
      prefixeDecode.subarray(0, 4).toString('latin1') === 'RIFF' &&
      prefixeDecode.subarray(8, 12).toString('latin1') === 'WEBP'
    );
  }

  const signature = SIGNATURES_MIME[mime];
  if (signature === undefined) return false;
  if (prefixeDecode.length < signature.length) return false;
  return signature.every((octet, index) => prefixeDecode[index] === octet);
}

/**
 * Valide et normalise une pièce jointe reçue en Data URI. Exportée pour être
 * réutilisée telle quelle par `services/reception.ts` (import RELATIF, même
 * paquet — inutile de passer par le baril `@batte/db` pour un usage interne
 * à `packages/db/src`, et ce fichier n'a pas le droit d'y toucher).
 *
 * `null` / `undefined` / chaîne vide -> `null` : CLAUDE.md — « une valeur
 * inconnue vaut null, jamais une chaîne vide traitée comme un chemin ».
 */
export function validerPieceJointe(valeur: string | null | undefined): string | null {
  if (valeur === null || valeur === undefined || valeur.trim() === '') return null;

  const correspondance = MOTIF_PIECE_JOINTE_DATA_URI.exec(valeur);
  if (correspondance === null) {
    throw new ErreurMetier(
      'piece_jointe_format_invalide',
      'La pièce jointe doit être une image (JPEG, PNG, WEBP) ou un PDF, envoyée en Data URI.',
      { champs: { fichierScanPath: 'Format non reconnu.' } },
    );
  }

  const mime = correspondance[1] ?? '';
  const base64 = correspondance[2] ?? '';
  const tailleOctets = Math.floor((base64.length * 3) / 4);
  if (tailleOctets > TAILLE_MAX_PIECE_JOINTE_OCTETS) {
    throw new ErreurMetier(
      'piece_jointe_trop_volumineuse',
      'La pièce jointe dépasse la taille maximale autorisée ' +
        `(${Math.floor(TAILLE_MAX_PIECE_JOINTE_OCTETS / (1024 * 1024))} Mo).`,
      { champs: { fichierScanPath: 'Fichier trop volumineux.' } },
    );
  }

  if (!contenuCorrespondAuTypeDeclare(mime, base64)) {
    throw new ErreurMetier(
      'piece_jointe_contenu_incoherent',
      'Le contenu du fichier ne correspond pas au type annoncé : ses premiers octets ne sont ' +
        'pas ceux d’une image ou d’un PDF valide. Le fichier est peut-être corrompu, ou d’un ' +
        'autre type que celui indiqué.',
      { champs: { fichierScanPath: 'Le contenu ne correspond pas au format annoncé.' } },
    );
  }

  return valeur;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Marqueur d'annulation — meme mecanisme que `annulerDepense`
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `facture_fournisseur` n'a pas de colonne `is_annule` / `annule_par_id` : la
 * regle n°7 de CLAUDE.md §3 (« rien ne s'efface, correction par ecriture
 * d'annulation ») est donc satisfaite par une CONTRE-ECRITURE reperee par ce
 * marqueur dans `notes` — exactement le mecanisme de
 * `packages/db/src/depots/comptabilite.ts` (`annulerDepense`).
 */
const MARQUEUR_ANNULATION = /^\[ANNULATION:([^\]]+)\]\s*(.*)$/;

/* ═══════════════════════════════════════════════════════════════════════════
   Ecriture — enregistrement d'une facture
   ═══════════════════════════════════════════════════════════════════════════ */

export type LigneFactureEntree = {
  readonly libelle: string;
  /** Montant de la ligne, en centimes ENTIERS. Non nul ; peut être négatif (remise). */
  readonly montantCents: number;
  readonly receptionId?: string | null;
  readonly ingredientId?: string | null;
  readonly quantiteUniteRef?: number | null;
  /** Méthode de ventilation si cette ligne est un frais de réception. Défaut : `valeur`. */
  readonly methodeRepartitionFrais?: 'valeur' | 'quantite';
};

export type EntreeFacture = {
  readonly numeroFournisseur: string;
  readonly fournisseurId: string;
  readonly dateFacture: string;
  readonly dateEcheance?: string | null;
  readonly notes?: string | null;
  /**
   * Bon de livraison ou facture SCANNÉE, en Data URI (RFC 2397). Voir la
   * décision de conception en tête de fichier : rattachée AU MOMENT DE LA
   * SAISIE (CLAUDE.md §7 — jamais reconstituée après coup), stockée dans la
   * ligne elle-même pour rester dans le périmètre protégé par
   * `packages/db/src/sauvegarde.ts`.
   */
  readonly fichierScanPath?: string | null;
  readonly lignes: readonly LigneFactureEntree[];
};

export type LigneFactureEcart = {
  readonly libelle: string;
  readonly ecartPrixCents: number;
};

export type ResultatFacture = {
  readonly factureId: string;
  readonly montantTotalCents: number;
  /** Ecarts de prix DETECTES (lignes rapprochées à un lot unique, écart non nul). */
  readonly ecarts: readonly LigneFactureEcart[];
  /**
   * Avertissements NON BLOQUANTS (voir `avertissementReceptionAnnulee` plus
   * bas) : au moins une ligne a été rattachée à une réception dont le statut
   * est `annulee`. Vide la plupart du temps.
   */
  readonly avertissements: readonly string[];
};

/** Les lots d'une réception, pour la ventilation des frais et le rapprochement. */
function lotsDeLaReception(
  base: BaseBatte,
  receptionId: string,
): { id: string; ingredientId: string; quantiteInitiale: number; prixLigneCents: number }[] {
  return base
    .select({
      id: lot.id,
      ingredientId: lot.ingredientId,
      quantiteInitiale: lot.quantiteInitiale,
      prixLigneCents: lot.prixLigneCents,
    })
    .from(lot)
    .where(eq(lot.receptionId, receptionId))
    .all();
}

/**
 * Résout le lot UNIQUE d'une réception pour un ingrédient donné.
 *
 * Rend `null` s'il y en a ZERO (aucune correspondance) ou PLUSIEURS
 * (ambigu — une même réception ne devrait porter qu'un lot par ingrédient,
 * mais rien ne l'empêche techniquement) : dans les deux cas, aucune
 * correction automatique n'est sûre, et l'appelant doit le savoir plutôt que
 * de deviner lequel corriger.
 */
function lotUniqueDeReception(
  base: BaseBatte,
  receptionId: string,
  ingredientId: string,
): { id: string; prixLigneCents: number } | null {
  const trouves = base
    .select({ id: lot.id, prixLigneCents: lot.prixLigneCents })
    .from(lot)
    .where(and(eq(lot.receptionId, receptionId), eq(lot.ingredientId, ingredientId)))
    .all();
  return trouves.length === 1 ? trouves[0]! : null;
}

/** Ventile un frais de réception sur tous les lots de cette réception, en une transaction. */
function appliquerVentilationFrais(
  base: BaseBatte,
  receptionId: string,
  montantCents: number,
  methode: 'valeur' | 'quantite',
  maintenant: string,
): void {
  const lots = lotsDeLaReception(base, receptionId);
  if (lots.length === 0) {
    throw new ErreurMetier(
      'reception_sans_lot',
      "Cette réception ne porte aucun lot : impossible d'y ventiler un frais.",
    );
  }

  const basesVentilation: BaseVentilationLot[] = lots.map((l) => ({
    lotId: l.id,
    base: methode === 'quantite' ? l.quantiteInitiale : l.prixLigneCents,
  }));
  const parts = ventilerFrais(montantCents, basesVentilation);
  const prixParLot = new Map(lots.map((l) => [l.id, l.prixLigneCents]));

  for (const part of parts) {
    if (part.montantCents === 0) continue;
    const avant = prixParLot.get(part.lotId) ?? 0;
    const apres = avant + part.montantCents;
    base
      .update(lot)
      .set({ prixLigneCents: apres, modifieLe: maintenant })
      .where(eq(lot.id, part.lotId))
      .run();
    journaliser(base, {
      table: 'lot',
      enregistrementId: part.lotId,
      action: 'modification',
      valeurAvant: { prixLigneCents: avant },
      valeurApres: { prixLigneCents: apres },
      parQui: null,
    });
  }
}

/**
 * DÉCISION DE CONCEPTION — rattacher une ligne de facture à une réception
 * ANNULÉE (mission « deux restes de la chaîne d'achat », 31/07/2026). À LIRE
 * avant de toucher à cette fonction ou à son unique appelant, `enregistrerFacture`.
 *
 * Le doute se défendait dans les deux sens et c'est pour ça qu'il était resté
 * ouvert. LÉGITIME : le fournisseur a livré, la réception a été annulée en
 * base (une erreur de saisie, par exemple) mais il a quand même facturé —
 * REFUSER rendrait cette facture ORPHELINE, impossible à rapprocher de quoi
 * que ce soit, ce qui est un problème comptable réel (CLAUDE.md §7 : « ne
 * jamais bloquer un geste comptable légitime au nom d'une élégance de
 * modèle »). SUSPECT : rapprocher une facture d'une livraison qu'on a
 * explicitement déclarée n'avoir jamais gardée sent la manipulation, et
 * l'ACCEPTER EN SILENCE la rendrait invisible.
 *
 * D-076 (`annulerReception`, `services/reception.ts`) tranche un doute de la
 * même forme — remettre le statut d'une commande après l'annulation de sa
 * réception — de la même façon : ni deviner, ni bloquer, ni laisser une
 * incohérence muette, mais RENDRE LE FAIT VISIBLE ET PERMANENT. C'est la même
 * troisième voie ici : la ligne est ACCEPTÉE, mais un avertissement NON
 * BLOQUANT le dit — à la SAISIE (ci-dessous, `ResultatFacture.avertissements`)
 * ET À CHAQUE LECTURE (`lireFactureDetail`, `FactureDetail.avertissements`),
 * puisqu'une réception peut être annulée APRÈS le rapprochement d'une facture
 * qui la visait déjà : ce fait ne doit pas s'effacer avec le temps, il doit
 * rester visible aussi longtemps que le rapprochement existe.
 *
 * SANS RISQUE DE CHIFFRE FAUSSÉ : une réception annulée a, PAR CONSTRUCTION
 * (`annulerReception` refuse sinon l'annulation dans son ensemble — voir
 * `contrepasserMouvement`, `services/mouvements.ts`), TOUS ses lots à
 * `quantiteRestante` nulle. Calculer un écart de prix ou ventiler un frais de
 * réception sur un tel lot (`corrigerCoutLot` plus bas, `appliquerVentilationFrais`
 * ci-dessus) est donc de la MÊME famille que corriger un lot déjà
 * intégralement consommé : sans effet mesurable sur la valorisation du stock
 * — jamais un risque de fausser un chiffre déjà lu.
 */
function avertissementReceptionAnnulee(numeroReception: string): string {
  return (
    `Rattachée à la réception ${numeroReception}, qui est annulée : sa marchandise a été ` +
    'intégralement contrepassée et ne correspond plus à aucun stock — vérifiez que ce ' +
    'rapprochement est bien voulu.'
  );
}

/**
 * La garde « ce fournisseur peut-il recevoir une facture ? » (existence +
 * rejet du fournisseur SYSTÈME, « Inventaire d'ouverture ») vit désormais
 * dans `depots/fournisseur-systeme.ts` — foyer unique partagé avec
 * `depots/referentiel-ecriture.ts`, `depots/economies.ts` et
 * `depots/comptabilite.ts` (audit du 31/07/2026 : la même vérification était
 * recopiée à l'identique dans les trois premiers, absente du quatrième).
 *
 * EFFET DE BORD ASSUMÉ DU REGROUPEMENT : un `fournisseurId` INEXISTANT
 * (jamais testé, ni ici ni côté API — vérifié avant ce changement) passait
 * jusqu'ici par `ErreurIntrouvable('Fournisseur', …)`, donc un 404 SANS
 * `champs`. La fonction partagée rend désormais un 422 `fournisseur_introuvable`
 * AVEC `champs`, exactement comme `depots/economies.ts` et
 * `depots/referentiel-ecriture.ts` le faisaient déjà pour la même faute de
 * saisie — et exactement la règle que D-035 pose lui-même : « une référence
 * SAISIE DANS UN FORMULAIRE » (ce `fournisseurId` en est une) « est un 422
 * avec `champs`, jamais un 404 », qui est réservé à la ressource ADRESSÉE
 * DANS L'URL. Le seul code protégé par un test est `fournisseur_systeme`
 * (`factures.test.ts`), inchangé par ce regroupement.
 *
 * À NE PAS CONFONDRE avec la réception (`services/reception.ts`,
 * `SaisieReception.tsx`) : RECEVOIR de la marchandise CONTRE ce fournisseur
 * est sa raison d'être (c'est ainsi que l'inventaire d'ouverture obtient un
 * lot tracé, exigence AFSCA) — cette garde ne porte que sur la FACTURE, un
 * document commercial que ce fournisseur ne peut, par construction, jamais
 * émettre. `services/reception.ts` n'appelle pas cette fonction et ne doit
 * jamais le faire.
 */

/**
 * Enregistre une facture fournisseur : rapproche ses lignes des réceptions
 * correspondantes, calcule les écarts de prix (sans les appliquer — voir
 * décision 2 en tête de fichier) et ventile immédiatement les frais de
 * réception sur les lots concernés.
 *
 * ATOMIQUE : une facture à moitié écrite laisserait des frais ventilés sans
 * leur ligne, ou une ligne sans sa facture.
 */
export function enregistrerFacture(base: BaseBatte, entree: EntreeFacture): ResultatFacture {
  if (entree.numeroFournisseur.trim() === '') {
    throw new ErreurMetier(
      'numero_manquant',
      'Le numéro de facture du fournisseur est obligatoire.',
      { champs: { numeroFournisseur: 'Indiquez le numéro tel qu’il figure sur la facture.' } },
    );
  }
  if (entree.lignes.length === 0) {
    throw new ErreurMetier('facture_vide', 'Une facture doit contenir au moins une ligne.');
  }

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    verifierFournisseurCommercial(
      baseTx,
      entree.fournisseurId,
      "aucune facture ne s'enregistre à son nom.",
    );

    const maintenant = maintenantUtc();
    const factureId = nouvelIdentifiant();
    const ecarts: LigneFactureEcart[] = [];
    const avertissements: string[] = [];

    // L'entete est ecrite AVANT les lignes : `facture_ligne.facture_id` la
    // reference, et une ligne sans entete serait une orpheline inutilisable.
    baseTx
      .insert(factureFournisseur)
      .values({
        id: factureId,
        numeroFournisseur: entree.numeroFournisseur.trim(),
        fournisseurId: entree.fournisseurId,
        dateFacture: entree.dateFacture,
        dateEcheance: entree.dateEcheance ?? null,
        montantTotalCents: 0, // corrige plus bas, une fois les lignes connues.
        fichierScanPath: validerPieceJointe(entree.fichierScanPath),
        statut: 'a_rapprocher',
        notes: entree.notes ?? null,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    for (const ligne of entree.lignes) {
      if (ligne.montantCents === 0) {
        throw new ErreurMetier(
          'montant_ligne_nul',
          `La ligne « ${ligne.libelle} » doit porter un montant non nul.`,
          { champs: { montantCents: 'Indiquez un montant différent de zéro.' } },
        );
      }

      const receptionId = ligne.receptionId ?? null;
      const ingredientId = ligne.ingredientId ?? null;

      if (receptionId !== null) {
        const rec = baseTx
          .select({
            id: reception.id,
            fournisseurId: reception.fournisseurId,
            numero: reception.numero,
            statut: reception.statut,
          })
          .from(reception)
          .where(eq(reception.id, receptionId))
          .get();
        if (rec === undefined) {
          throw new ErreurMetier(
            'reception_introuvable',
            `La réception liée à la ligne « ${ligne.libelle} » est introuvable.`,
            { champs: { receptionId: 'Choisissez une réception dans la liste.' } },
          );
        }
        if (rec.fournisseurId !== entree.fournisseurId) {
          throw new ErreurMetier(
            'reception_autre_fournisseur',
            `La réception liée à la ligne « ${ligne.libelle} » appartient à un autre fournisseur.`,
            { champs: { receptionId: 'Choisissez une réception de ce fournisseur.' } },
          );
        }
        // ACCEPTÉ, JAMAIS REFUSÉ — voir la décision de conception au-dessus
        // de `avertissementReceptionAnnulee`. Un rapprochement légitime
        // (le fournisseur a facturé une livraison depuis annulée en base)
        // ne doit pas être bloqué ; il doit seulement rester visible.
        if (rec.statut === 'annulee') {
          avertissements.push(avertissementReceptionAnnulee(rec.numero));
        }
      }

      let ecartPrixCents = 0;

      if (receptionId !== null && ingredientId !== null) {
        // Ligne rapprochée à UN lot precis : l'ecart se calcule, il ne se
        // corrige PAS ici (decision 2 en tete de fichier).
        const lotVise = lotUniqueDeReception(baseTx, receptionId, ingredientId);
        if (lotVise !== null) {
          // `ecartPrix` (`@batte/core`) est le SEUL endroit qui fixe le sens
          // de l'écart (positif = la facture réclame PLUS que le bon de
          // livraison) — cette ligne le réimplémentait à la main.
          ecartPrixCents = ecartPrix(ligne.montantCents, lotVise.prixLigneCents);
          if (ecartPrixCents !== 0) {
            ecarts.push({ libelle: ligne.libelle, ecartPrixCents });
          }
        }
        // Zero ou plusieurs lots trouves : aucun ecart calculable, la ligne
        // reste a `0` et `lireFactureDetail` le distinguera via `lotResolu`.
      } else if (receptionId !== null && ingredientId === null) {
        // Ligne de FRAIS DE RECEPTION : cout additionnel non ambigu, ventile
        // IMMEDIATEMENT (decision 2) — jamais une remise en cause d'un prix
        // deja constate, donc aucun risque a l'appliquer tout de suite.
        if (ligne.montantCents <= 0) {
          throw new ErreurMetier(
            'frais_invalide',
            `Les frais de réception de la ligne « ${ligne.libelle} » doivent être strictement ` +
              'positifs : un frais ne se négocie pas en négatif.',
            { champs: { montantCents: 'Indiquez un montant strictement positif.' } },
          );
        }
        const methode = ligne.methodeRepartitionFrais ?? 'valeur';
        baseTx
          .insert(fraisReception)
          .values({
            id: nouvelIdentifiant(),
            receptionId,
            libelle: ligne.libelle,
            montantCents: ligne.montantCents,
            methodeRepartition: methode,
          })
          .run();
        appliquerVentilationFrais(baseTx, receptionId, ligne.montantCents, methode, maintenant);
      }

      baseTx
        .insert(factureLigne)
        .values({
          id: nouvelIdentifiant(),
          factureId,
          receptionId,
          ingredientId,
          libelle: ligne.libelle,
          quantiteUniteRef: ligne.quantiteUniteRef ?? null,
          montantCents: ligne.montantCents,
          ecartPrixCents,
        })
        .run();
    }

    // Montant total = somme EXACTE des lignes stockees (meme principe que
    // `commande_fournisseur.montant_total_cents`, jamais un total saisi a
    // part qui pourrait diverger de ses lignes).
    const montantTotalCents = entree.lignes.reduce((somme, l) => somme + l.montantCents, 0);
    baseTx
      .update(factureFournisseur)
      .set({ montantTotalCents, modifieLe: maintenant })
      .where(eq(factureFournisseur.id, factureId))
      .run();

    journaliser(baseTx, {
      table: 'facture_fournisseur',
      enregistrementId: factureId,
      action: 'creation',
      valeurAvant: null,
      valeurApres: {
        numeroFournisseur: entree.numeroFournisseur.trim(),
        fournisseurId: entree.fournisseurId,
        montantTotalCents,
      },
      parQui: null,
    });

    return { factureId, montantTotalCents, ecarts, avertissements };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Lecture
   ═══════════════════════════════════════════════════════════════════════════ */

export type LigneFactureDetail = {
  readonly id: string;
  readonly libelle: string;
  readonly montantCents: number;
  readonly receptionId: string | null;
  readonly numeroReception: string | null;
  readonly ingredientId: string | null;
  readonly nomIngredient: string | null;
  readonly quantiteUniteRef: number | null;
  /** Ecart CONSTATE A LA SAISIE, figé pour toujours. */
  readonly ecartPrixCents: number;
  /** Vrai si UN SEUL lot a pu être résolu pour cette ligne. */
  readonly lotResolu: boolean;
  /** Ecart LIVE contre le prix ACTUEL du lot. `null` si `lotResolu` est faux. */
  readonly ecartResiduelCents: number | null;
  /**
   * Vrai si cette ligne est rattachée à une réception dont le statut ACTUEL
   * est `annulee` — recalculé À CHAQUE LECTURE, contrairement à
   * `ecartPrixCents` qui est figé à la saisie : une réception peut être
   * annulée APRÈS le rapprochement d'une facture qui la visait déjà, et ce
   * fait ne doit pas rester invisible pour autant (voir la décision de
   * conception au-dessus de `avertissementReceptionAnnulee`). Accepté, jamais
   * refusé — ce champ n'est qu'un AVERTISSEMENT.
   */
  readonly receptionAnnulee: boolean;
};

export type FactureResume = {
  readonly id: string;
  readonly numeroFournisseur: string;
  readonly fournisseurId: string;
  readonly fournisseurNom: string;
  readonly dateFacture: string;
  readonly dateEcheance: string | null;
  readonly montantTotalCents: number;
  readonly statut: 'a_rapprocher' | 'rapprochee' | 'payee' | 'litige';
  readonly nbLignes: number;
  readonly ecartTotalCents: number;
  readonly estAnnulation: boolean;
  readonly factureAnnuleeId: string | null;
  readonly estAnnulee: boolean;
  readonly creeLe: string;
};

export type FactureDetail = FactureResume & {
  readonly notes: string | null;
  /**
   * Bon de livraison ou facture scannée, en Data URI, ou `null` si aucune
   * pièce n'a été jointe à la saisie. Voir la décision de conception en tête
   * de fichier.
   */
  readonly fichierScanPath: string | null;
  /**
   * Avertissements NON BLOQUANTS, recalculés À LA LECTURE (jamais figés à la
   * saisie, contrairement à `ecartTotalCents`) : une phrase par ligne
   * rattachée à une réception dont le statut ACTUEL est `annulee` — voir la
   * décision de conception au-dessus de `avertissementReceptionAnnulee`.
   * Vide la plupart du temps.
   */
  readonly avertissements: readonly string[];
  readonly lignes: readonly LigneFactureDetail[];
};

/** Liste des factures, la plus récente d'abord. */
export function listerFactures(base: BaseBatte): FactureResume[] {
  const entetes = base
    .select({
      id: factureFournisseur.id,
      numeroFournisseur: factureFournisseur.numeroFournisseur,
      fournisseurId: factureFournisseur.fournisseurId,
      fournisseurNom: fournisseur.nom,
      dateFacture: factureFournisseur.dateFacture,
      dateEcheance: factureFournisseur.dateEcheance,
      montantTotalCents: factureFournisseur.montantTotalCents,
      statut: factureFournisseur.statut,
      notes: factureFournisseur.notes,
      creeLe: factureFournisseur.creeLe,
    })
    .from(factureFournisseur)
    .innerJoin(fournisseur, eq(factureFournisseur.fournisseurId, fournisseur.id))
    .orderBy(desc(factureFournisseur.dateFacture), desc(factureFournisseur.creeLe))
    .all();

  const agregats = base
    .select({
      factureId: factureLigne.factureId,
      nbLignes: sql<number>`COUNT(*)`,
      ecartTotalCents: sql<number>`COALESCE(SUM(${factureLigne.ecartPrixCents}), 0)`,
    })
    .from(factureLigne)
    .groupBy(factureLigne.factureId)
    .all();
  const agregatParFacture = new Map(agregats.map((a) => [a.factureId, a]));

  const idsAnnules = new Set(
    entetes
      .map((e) => (e.notes === null ? null : MARQUEUR_ANNULATION.exec(e.notes)?.[1]))
      .filter((id): id is string => id !== undefined && id !== null),
  );

  return entetes.map((e) => {
    const correspondance = e.notes === null ? null : MARQUEUR_ANNULATION.exec(e.notes);
    const agregat = agregatParFacture.get(e.id);
    return {
      id: e.id,
      numeroFournisseur: e.numeroFournisseur,
      fournisseurId: e.fournisseurId,
      fournisseurNom: e.fournisseurNom,
      dateFacture: e.dateFacture,
      dateEcheance: e.dateEcheance,
      montantTotalCents: e.montantTotalCents,
      statut: e.statut,
      nbLignes: agregat?.nbLignes ?? 0,
      ecartTotalCents: agregat?.ecartTotalCents ?? 0,
      estAnnulation: correspondance !== null,
      factureAnnuleeId: correspondance?.[1] ?? null,
      estAnnulee: idsAnnules.has(e.id),
      creeLe: e.creeLe,
    };
  });
}

/** Détail d'une facture, lignes comprises, écarts recalculés en direct. */
export function lireFactureDetail(base: BaseBatte, factureId: string): FactureDetail | null {
  const entete = base
    .select({
      facture: factureFournisseur,
      fournisseurNom: fournisseur.nom,
    })
    .from(factureFournisseur)
    .innerJoin(fournisseur, eq(factureFournisseur.fournisseurId, fournisseur.id))
    .where(eq(factureFournisseur.id, factureId))
    .get();
  if (entete === undefined) return null;

  const lignesBrutes = base
    .select({
      id: factureLigne.id,
      libelle: factureLigne.libelle,
      montantCents: factureLigne.montantCents,
      receptionId: factureLigne.receptionId,
      ingredientId: factureLigne.ingredientId,
      quantiteUniteRef: factureLigne.quantiteUniteRef,
      ecartPrixCents: factureLigne.ecartPrixCents,
    })
    .from(factureLigne)
    .where(eq(factureLigne.factureId, factureId))
    .all();

  const lignes: LigneFactureDetail[] = lignesBrutes.map((l) => {
    let numeroReception: string | null = null;
    let nomIngredient: string | null = null;
    let lotResolu = false;
    let ecartResiduelCents: number | null = null;
    let receptionAnnulee = false;

    if (l.receptionId !== null) {
      const rec = base
        .select({ numero: reception.numero, statut: reception.statut })
        .from(reception)
        .where(eq(reception.id, l.receptionId))
        .get();
      numeroReception = rec?.numero ?? null;
      // Recalculé À CHAQUE LECTURE, jamais figé : voir la décision de
      // conception au-dessus de `avertissementReceptionAnnulee`.
      receptionAnnulee = rec?.statut === 'annulee';
    }
    if (l.ingredientId !== null) {
      const ing = base
        .select({ nom: ingredient.nom })
        .from(ingredient)
        .where(eq(ingredient.id, l.ingredientId))
        .get();
      nomIngredient = ing?.nom ?? null;
    }
    if (l.receptionId !== null && l.ingredientId !== null) {
      const lotVise = lotUniqueDeReception(base, l.receptionId, l.ingredientId);
      if (lotVise !== null) {
        lotResolu = true;
        // Même fonction que plus haut (`enregistrerFacture`) : un seul point
        // qui fixe le sens de l'écart, jamais une soustraction refaite à la main.
        ecartResiduelCents = ecartPrix(l.montantCents, lotVise.prixLigneCents);
      }
    }

    return {
      id: l.id,
      libelle: l.libelle,
      montantCents: l.montantCents,
      receptionId: l.receptionId,
      numeroReception,
      ingredientId: l.ingredientId,
      nomIngredient,
      quantiteUniteRef: l.quantiteUniteRef,
      ecartPrixCents: l.ecartPrixCents,
      lotResolu,
      ecartResiduelCents,
      receptionAnnulee,
    };
  });

  // Agrégé une seule fois, MÊME PHRASE que celle produite à la saisie
  // (`avertissementReceptionAnnulee`, seule source du texte) : une réception
  // annulée après coup doit rester visible ici exactement comme si elle
  // l'avait été avant le rapprochement.
  const avertissements: string[] = [];
  for (const l of lignes) {
    if (l.receptionAnnulee && l.numeroReception !== null) {
      avertissements.push(avertissementReceptionAnnulee(l.numeroReception));
    }
  }

  const f = entete.facture;
  const correspondance = f.notes === null ? null : MARQUEUR_ANNULATION.exec(f.notes);
  const dejaAnnulee =
    base
      .select({ id: factureFournisseur.id })
      .from(factureFournisseur)
      .where(sql`${factureFournisseur.notes} LIKE ${`[ANNULATION:${factureId}]%`}`)
      .all().length > 0;

  return {
    id: f.id,
    numeroFournisseur: f.numeroFournisseur,
    fournisseurId: f.fournisseurId,
    fournisseurNom: entete.fournisseurNom,
    dateFacture: f.dateFacture,
    dateEcheance: f.dateEcheance,
    montantTotalCents: f.montantTotalCents,
    statut: f.statut,
    nbLignes: lignes.length,
    ecartTotalCents: lignes.reduce((somme, l) => somme + l.ecartPrixCents, 0),
    estAnnulation: correspondance !== null,
    factureAnnuleeId: correspondance?.[1] ?? null,
    estAnnulee: dejaAnnulee,
    creeLe: f.creeLe,
    notes: f.notes,
    fichierScanPath: f.fichierScanPath,
    avertissements,
    lignes,
  };
}

export type LigneReceptionEligible = {
  readonly receptionId: string;
  readonly numeroReception: string;
  readonly dateReception: string;
  readonly ingredientId: string;
  readonly nomIngredient: string;
  /** Prix payé annoncé au bon de livraison, tel qu'enregistré sur le lot. */
  readonly prixLigneCents: number;
  readonly numeroLotFournisseur: string | null;
};

/**
 * Lots des réceptions d'un fournisseur, éligibles au rapprochement d'une
 * ligne de facture. Alimente l'écran de saisie : une facture ne peut se
 * rapprocher qu'à une réception DU MÊME fournisseur.
 */
export function receptionsEligibles(
  base: BaseBatte,
  fournisseurId: string,
): LigneReceptionEligible[] {
  return base
    .select({
      receptionId: reception.id,
      numeroReception: reception.numero,
      dateReception: reception.dateReception,
      ingredientId: lot.ingredientId,
      nomIngredient: ingredient.nom,
      prixLigneCents: lot.prixLigneCents,
      numeroLotFournisseur: lot.numeroLotFournisseur,
    })
    .from(lot)
    .innerJoin(reception, eq(lot.receptionId, reception.id))
    .innerJoin(ingredient, eq(lot.ingredientId, ingredient.id))
    .where(
      and(
        eq(reception.fournisseurId, fournisseurId),
        // Une réception ANNULÉE n'a plus de marchandise retenue en stock : sa
        // contrepassation a tout ramené à zéro. La proposer au rapprochement
        // d'une facture inviterait à rapprocher une facture d'une livraison
        // qu'on a explicitement déclarée n'avoir jamais gardée — et le montant
        // rapproché ne correspondrait à aucun stock.
        eq(reception.statut, 'active'),
      ),
    )
    .orderBy(desc(reception.dateReception))
    .all();
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cycle de vie — statut, annulation, correction de coût
   ═══════════════════════════════════════════════════════════════════════════ */

export type StatutFacture = 'a_rapprocher' | 'rapprochee' | 'payee' | 'litige';

/** Change le statut d'une facture (`a_rapprocher -> rapprochee -> payee`, ou `litige`). */
export function changerStatutFacture(
  base: BaseBatte,
  factureId: string,
  statut: StatutFacture,
): void {
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    const avant = baseTx
      .select()
      .from(factureFournisseur)
      .where(eq(factureFournisseur.id, factureId))
      .get();
    if (avant === undefined) throw new ErreurIntrouvable('Facture', factureId);
    if (avant.statut === statut) {
      throw new ErreurMetier(
        'statut_inchange',
        `Cette facture est déjà « ${statut} » : il n'y a rien à changer.`,
        { champs: { statut: 'Choisissez un statut différent.' } },
      );
    }

    const maintenant = maintenantUtc();
    baseTx
      .update(factureFournisseur)
      .set({ statut, modifieLe: maintenant })
      .where(eq(factureFournisseur.id, factureId))
      .run();

    journaliser(baseTx, {
      table: 'facture_fournisseur',
      enregistrementId: factureId,
      action: 'modification',
      valeurAvant: { statut: avant.statut },
      valeurApres: { statut },
      parQui: null,
    });
  });
}

/**
 * Annule une facture par CONTRE-ECRITURE (voir `MARQUEUR_ANNULATION` en tête
 * de fichier) : une nouvelle facture, montant négatif, notes marquées, datée
 * du JOUR DE L'ANNULATION — jamais de la date de la facture d'origine, même
 * principe que `annulerDepense` : une période déjà close ne doit jamais voir
 * ses totaux bouger après coup.
 *
 * NE REVIENT PAS sur d'éventuelles corrections de coût de lot déjà
 * appliquées par cette facture (`corrigerCoutLot`) : ce sont des actions
 * délibérées et séparées, chacune ré-appliquable indépendamment si une
 * valeur s'avérait fautive — voir le rapport de livraison pour l'arbitrage
 * complet.
 */
export function annulerFacture(base: BaseBatte, factureId: string, motif: string): { id: string } {
  const motifPropre = motif.trim();
  if (motifPropre === '') {
    throw new ErreurMetier(
      'motif_obligatoire',
      "L'annulation d'une facture exige un motif : c'est lui qui rend la correction auditable.",
      { champs: { motif: 'Indiquez pourquoi cette facture est annulée.' } },
    );
  }

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const origine = baseTx
      .select()
      .from(factureFournisseur)
      .where(eq(factureFournisseur.id, factureId))
      .get();
    if (origine === undefined) throw new ErreurIntrouvable('Facture', factureId);

    const marqueur = `[ANNULATION:${factureId}]`;
    const dejaAnnulee = baseTx
      .select({ id: factureFournisseur.id })
      .from(factureFournisseur)
      .where(sql`${factureFournisseur.notes} LIKE ${`${marqueur}%`}`)
      .all();
    if (dejaAnnulee.length > 0) {
      throw new ErreurMetier(
        'deja_annule',
        "Cette facture a déjà été annulée. Une écriture ne se contrepasse qu'une seule fois.",
      );
    }

    const lignesOrigine = baseTx
      .select()
      .from(factureLigne)
      .where(eq(factureLigne.factureId, factureId))
      .all();

    const idContrepassation = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    const jourAnnulation = jourCivilBelge(new Date());

    baseTx
      .insert(factureFournisseur)
      .values({
        id: idContrepassation,
        numeroFournisseur: origine.numeroFournisseur,
        fournisseurId: origine.fournisseurId,
        dateFacture: jourAnnulation,
        dateEcheance: null,
        montantTotalCents: -origine.montantTotalCents,
        // Une contre-ecriture n'est pas un document scanne : rien a joindre,
        // le scan reste sur la facture D'ORIGINE (`origine.fichierScanPath`,
        // jamais copie ni deplace ici).
        fichierScanPath: null,
        statut: 'litige',
        notes: `${marqueur} ${motifPropre}`,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    for (const l of lignesOrigine) {
      baseTx
        .insert(factureLigne)
        .values({
          id: nouvelIdentifiant(),
          factureId: idContrepassation,
          receptionId: l.receptionId,
          ingredientId: l.ingredientId,
          libelle: `Annulation — ${l.libelle}`,
          quantiteUniteRef: l.quantiteUniteRef,
          montantCents: -l.montantCents,
          // La contre-ecriture annule un MONTANT, elle ne recalcule pas un
          // nouvel ecart de prix : ce serait comparer un montant negatif a
          // un bon de livraison, ce qui ne veut rien dire.
          ecartPrixCents: 0,
        })
        .run();
    }

    journaliser(baseTx, {
      table: 'facture_fournisseur',
      enregistrementId: factureId,
      action: 'annulation',
      valeurAvant: { montantTotalCents: origine.montantTotalCents, statut: origine.statut },
      valeurApres: null,
      parQui: null,
    });

    return { id: idContrepassation };
  });
}

export type ResultatCorrectionLot = {
  readonly lotId: string;
  readonly prixAvantCents: number;
  readonly prixApresCents: number;
};

/**
 * Applique l'écart d'une ligne de facture au LOT qu'elle vise : geste
 * EXPLICITE et SÉPARÉ de la saisie de la facture (décision 2 en tête de
 * fichier). Met à jour `lot.prix_ligne_cents` — jamais un mouvement de stock,
 * puisque aucune quantité ne bouge (décision 1) — et journalise le AVANT/APRÈS.
 *
 * Idempotent par construction : `lot.prix_ligne_cents` devient exactement
 * `factureLigne.montantCents`, donc rappeler cette fonction une seconde fois
 * ne change plus rien — refusé explicitement ci-dessous pour ne pas bruiter
 * le journal d'audit d'une écriture qui ne dit rien.
 */
export function corrigerCoutLot(base: BaseBatte, factureLigneId: string): ResultatCorrectionLot {
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const ligne = baseTx
      .select()
      .from(factureLigne)
      .where(eq(factureLigne.id, factureLigneId))
      .get();
    if (ligne === undefined) throw new ErreurIntrouvable('Ligne de facture', factureLigneId);

    if (ligne.receptionId === null || ligne.ingredientId === null) {
      throw new ErreurMetier(
        'ligne_non_rapprochable',
        "Cette ligne n'est rattachée à aucune réception : il n'y a aucun lot à corriger.",
      );
    }

    const lotVise = lotUniqueDeReception(baseTx, ligne.receptionId, ligne.ingredientId);
    if (lotVise === null) {
      throw new ErreurMetier(
        'lot_non_resolu',
        'Aucun lot unique ne correspond à cette réception pour cet ingrédient : la correction ' +
          'doit être faite manuellement.',
      );
    }

    if (lotVise.prixLigneCents === ligne.montantCents) {
      throw new ErreurMetier(
        'deja_a_jour',
        'Le prix de ce lot correspond déjà au montant facturé : il n’y a rien à corriger.',
      );
    }

    const maintenant = maintenantUtc();
    const avant = lotVise.prixLigneCents;
    const apres = ligne.montantCents;

    baseTx
      .update(lot)
      .set({ prixLigneCents: apres, modifieLe: maintenant })
      .where(eq(lot.id, lotVise.id))
      .run();

    journaliser(baseTx, {
      table: 'lot',
      enregistrementId: lotVise.id,
      action: 'modification',
      valeurAvant: { prixLigneCents: avant },
      valeurApres: { prixLigneCents: apres },
      parQui: null,
    });

    return { lotId: lotVise.id, prixAvantCents: avant, prixApresCents: apres };
  });
}
