/**
 * Cloture d'une session de marche.
 *
 * C'est « le point ou l'argent, la matiere et la prevision se rencontrent »
 * (docs/01 module 4). Une session close est une piece comptable : ses agregats
 * sont FIGES a la cloture et ne se recalculent pas ensuite, meme si un prix de
 * produit change. C'est ce qui garantit qu'un journal des recettes reste
 * relisible des annees plus tard.
 */

import {
  ErreurIntrouvable,
  ErreurMetier,
  calculerRentabilite,
  convertir,
  coutKilometriqueRetenu,
  coutMatiereTransformeSuspect,
  estPateVendueAuVolume,
  exploserVenteMenuEnLignesVente,
  exploserVentesMenusEnQuantitesComposants,
  imputationTourneeDeplacement,
  maintenantUtc,
  nouvelIdentifiant,
  rapprocherCaisse,
  repartirCoutProductionEntrePateVendueEtCrepes,
  repartirFefo,
  resoudreCoutEnergieSession,
  resoudreCrepesDepuisVolumeRestant,
  totaliserVentes,
  ventilerMenu,
  volumePateVendueDirectementMl,
  type ComposantMenuCalcul,
  type ImputationTourneeDeplacement,
  type LigneVente,
  type ResolutionCrepesParVolume,
  type TotauxVentes,
} from '@batte/core';
import { and, asc, eq, gte, inArray, isNotNull, ne } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  equipement,
  evenement,
  ingredient,
  lieuMarche,
  meteoObservation,
  motif,
  mouvementStock,
  production,
  produitVente,
  sessionFrais,
  sessionMarche,
  sessionVente,
} from '../schema.js';
import { journaliser } from '../depots/audit.js';
import { verifierPeriodeNonVerrouillee } from '../depots/comptabilite.js';
// `mesureCoutVehicule` vient du dépôt `lieux-rentabilite.ts` (fiche 13 §3.1,
// voie B), déjà utilisé par `routes/lieux-rentabilite.ts` pour composer
// EXACTEMENT le même `coutKilometriqueRetenu` (forfait/mesuré) — importé ici
// en relatif, jamais via `@batte/db` : ce fichier FAIT PARTIE de ce paquet,
// s'auto-importer par le barrel serait circulaire.
import { mesureCoutVehicule } from '../depots/lieux-rentabilite.js';
import { listerCompositionMenu } from '../depots/menus.js';
// `composantsActifsDesProduits` : lecture SEULE, pour éviter qu'un produit
// transformé À LA DEMANDE (fiche 15, le café) — dont la composition vient
// ENTIÈREMENT de sa nomenclature de vente, jamais d'une recette — voie sa
// recette (délibérément vide) désignée à tort comme « probablement en cause »
// dans `construireAvertissementCoutMatiereTransforme` plus bas. Même famille
// de lecture que `diagnostiquerRecettePourCoutNul` ci-dessous : un depot hors
// zone d'écriture de ce chantier, utilisé ici en LECTURE seule.
import { composantsActifsDesProduits } from '../depots/nomenclature-vente.js';
import { allouerNumero } from '../depots/numerotation.js';
import { lireParametres } from '../depots/parametres.js';
import { rapprocherPrevision } from '../depots/previsions.js';
import { coutRevientProduit } from '../depots/recettes.js';
// `diagnostiquerRecettePourCoutNul` (Trou 2, audit du 30/07/2026) : lecture
// SEULE, jamais un garde-fou d'écriture — voir sa doc dans
// `depots/referentiel.ts` pour pourquoi elle ne vit pas au moment de la
// création/modification d'un produit (`creerProduit`/`modifierProduit`,
// hors zone d'écriture ici).
import {
  diagnostiquerRecettePourCoutNul,
  type DiagnosticRecetteCoutNul,
} from '../depots/referentiel.js';
import { lotsDeLIngredient } from '../depots/stock.js';
import { ecrireReleveTemperature } from './afsca.js';
import { enregistrerUtilisationEquipement } from '../depots/equipements.js';
// `validerPieceJointe` (Data URI RFC 2397, format + plafond de taille) vient
// de `./factures.ts`, réutilisée TELLE QUELLE (mission « justificatif d'un
// frais de session », 30/07/2026) : c'est le MÊME mécanisme que
// `facture_fournisseur.fichier_scan_path` / `reception.fichier_scan_path`,
// appliqué ici à une troisième table — voir la décision de conception
// complète en tête de `services/factures.ts` (pourquoi une Data URI stockée
// dans la ligne, jamais un chemin disque : seule cette voie reste protégée
// par `packages/db/src/sauvegarde.ts`, qui ne sauvegarde QUE le contenu de
// la base). Import RELATIF, même paquet — inutile de passer par le barril
// `@batte/db` pour un usage interne à `packages/db/src`.
import { validerPieceJointe } from './factures.js';
import { sortirLesGarnitures } from './garnitures.js';
import { sortirLesComposantsVente } from './nomenclature-vente.js';

export type LigneVenteSaisie = {
  readonly produitVenteId: string;
  readonly quantite: number;
  /** Prix pratique ce jour-la. Fige a la cloture : un changement de tarif
   *  ulterieur ne doit jamais reecrire une session passee. */
  readonly prixUnitaireCents: number;
  readonly creneauHoraire?: string | null;
};

export type FraisSaisis = {
  readonly emplacementCents: number;
  readonly deplacementCents: number;
  readonly gazCents: number;
  readonly diversCents: number;
  /**
   * Justificatif (ticket, facture) de CHAQUE frais, en Data URI (RFC 2397) —
   * même mécanisme que `facture_fournisseur.fichier_scan_path` et
   * `reception.fichier_scan_path` (`validerPieceJointe`, importée de
   * `./factures.ts` : voir sa décision de conception complète — pourquoi une
   * Data URI stockée dans la ligne, jamais un chemin disque). Un frais sans
   * pièce est un frais qu'on affirme ; en cas de contrôle, c'est la pièce qui
   * le prouve.
   *
   * `session_frais` porte UNE ligne PAR CATÉGORIE non nulle (voir la boucle
   * dans `cloturerSession`) : chaque justificatif est donc rattaché à SA
   * propre catégorie, jamais un champ unique partagé entre les quatre.
   * Aucun champ pour `energie` : ce poste est CALCULÉ (durées d'équipement ×
   * prix du kWh, `resoudreCoutEnergieSession`), jamais une dépense saisie
   * avec un ticket à joindre.
   *
   * Optionnel et nullable : `undefined`/`null` = aucune pièce jointe, jamais
   * une chaîne vide traitée comme un chemin (CLAUDE.md §7).
   */
  readonly emplacementJustificatifPath?: string | null;
  readonly deplacementJustificatifPath?: string | null;
  readonly gazJustificatifPath?: string | null;
  readonly diversJustificatifPath?: string | null;
};

/**
 * Relevé de température saisi À LA CLÔTURE (docs/17 fiche 17), rattaché à
 * CETTE session — pas seulement à une date. Restreint aux deux moments que
 * couvre cet écran ; `depart`, `mi_session` et `stockage` restent la
 * responsabilité de l'écran Registre AFSCA.
 */
export type EntreeReleveTemperatureCloture = {
  readonly moment: 'arrivee' | 'retour';
  readonly equipement: string;
  readonly temperatureC: number;
  readonly actionCorrective?: string | null;
};

export type EntreeCloture = {
  readonly ventes: readonly LigneVenteSaisie[];
  readonly frais: FraisSaisis;
  /**
   * Kilometres REELLEMENT parcourus pendant cette session, tournee comprise
   * (D-064) — PAS un aller-retour automatique, un champ entierement LIBRE
   * (« aller du marche a un autre marche ou chez des fournisseurs »).
   * **Optionnel et nullable** : `undefined`/`null` = non renseigne, JAMAIS 0
   * (CLAUDE.md §7 — une valeur inconnue vaut `null`, jamais 0, qui laisserait
   * croire a un deplacement gratuit en carburant et en usure).
   */
  readonly distanceReelleKm?: number | null;
  readonly fondsCaisseInitialCents: number;
  readonly especesCompteesCents: number;
  readonly caCarteCents: number;
  /**
   * Crepes produites. **Optionnel** : quand des productions sont rattachees a
   * la session, le chiffre en est DERIVE et ne se ressaisit pas (CLAUDE.md §0,
   * « sans ressaisie »). Le champ ne sert plus qu'aux crepes faites hors
   * application, quand aucune production n'est rattachee.
   *
   * Exclusif avec `volumeRestantSaisi` : deux façons de clôturer, jamais les
   * deux à la fois (`resoudreCrepesProduites` refuse la combinaison).
   */
  readonly crepesProduites?: number;
  /**
   * Durée d'utilisation (minutes) de chaque équipement électrique en service
   * pendant la session (fiche 17). **Optionnel** : un lieu sans électricité
   * n'en fournit aucune.
   *
   * DEPUIS CE LOT, alimente aussi le coût d'électricité RETENU dans la marge
   * (cas 3 seulement — facturation au compteur, voir `resolutionEnergie` dans
   * `cloturerSession`) : une liste ABSENTE ou VIDE sur un lieu facturé au
   * compteur ne compte JAMAIS ce coût à 0 par défaut — voir
   * `resoudreCoutEnergieSession` (`@batte/core`) pour pourquoi.
   */
  readonly equipementsUtilises?: readonly { equipementId: string; dureeMinutes: number }[];
  /**
   * Deuxieme facon de declarer la production : le volume de pate MESURE
   * restant dans le bac, au lieu d'un nombre de crepes recompte a la main
   * (demande du porteur). Les crepes produites en sont DEDUITES depuis le
   * volume et les crepes des productions rattachees a cette session — voir
   * `resoudreCrepesDepuisVolumeRestant` dans `@batte/core`. Un ecart avec
   * vendues + invendues + cassees n'est alors jamais refuse : c'est une
   * mesure, pas une saisie contradictoire.
   */
  readonly volumeRestantSaisi?: { readonly quantite: number; readonly unite: 'ml' | 'g' } | null;
  readonly crepesInvendues: number;
  readonly crepesCassees: number;
  readonly heureDebutReelle?: string | null;
  readonly heureFinReelle?: string | null;
  readonly notesQualitatives?: string | null;
  /** Exclut la session du modele de prevision, avec son motif. */
  readonly exclureDuModele?: boolean;
  readonly motifExclusion?: string | null;
  readonly creePar?: string | null;
  /**
   * Nombre de tickets encaisses, releve sur le terminal. **Optionnel** : sans
   * lui, le panier moyen reste `null` plutot que d'etre calcule sur des
   * articles, ce qui le divisait par deux des qu'un client prenait deux
   * produits.
   */
  readonly nbTickets?: number | null;
  /**
   * Relevés de température (docs/17 fiche 17), **optionnels** : un relevé qui
   * manque reste manquant, rien ici ne le force ni ne le reconstitue
   * (CLAUDE.md §7 — le registre n'enregistre que ce qui a été saisi).
   */
  readonly relevesTemperature?: readonly EntreeReleveTemperatureCloture[];
};

/**
 * Ecart constate entre ce qui a ete VENDU et ce que le stock contenait.
 *
 * N'empeche jamais la cloture : la vente a eu lieu, la refuser d'enregistrer
 * serait minorer un chiffre d'affaires (CLAUDE.md §7). L'ecart est donc
 * remonte pour que l'utilisateur le solde par un inventaire — c'est la
 * reponse ERP normale a un stock qui ne correspond pas au reel.
 */
export type EcartStockVente = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly quantiteManquante: number;
};

export type ResultatCloture = {
  readonly ecartsStock: readonly EcartStockVente[];
  /**
   * Present seulement quand `crepesProduites` vient d'etre DEDUIT d'un volume
   * mesure (`volumeRestantSaisi`). `null` sinon — jamais une cle absente,
   * meme convention que `ecartsStock`.
   */
  readonly resolutionVolume: ResolutionCrepesParVolume | null;
  /**
   * Imputation de la TOURNEE reelle entre la session et les achats (D-064
   * point 4, `imputationTourneeDeplacement` — `@batte/core`). Trou 2 (audit du
   * 30/07/2026, refermé le même jour) : la fonction existait, testee, et aucun
   * code de production ne l'appelait ; desormais calculee ET PERSISTEE a
   * CHAQUE cloture (trois colonnes de `session_marche`, migration 0027) — voir
   * le commentaire au point de calcul, dans `cloturerSession`, pour le
   * raisonnement complet (pourquoi figer plutot que recalculer). Ce champ-ci
   * reste un simple MIROIR de commodite pour le bandeau affiche juste apres
   * l'enregistrement (`apps/web/src/pages/Sessions.tsx`) : la meme valeur est
   * desormais aussi exposee sur `schemaSessionDetail`, donc rejouable sur un
   * `GET` ulterieur.
   */
  readonly imputationDeplacement: ImputationTourneeDeplacement;
  /**
   * Avertissement d'electricite (fiche 17), affichable tel quel juste apres
   * l'enregistrement. `null` quand le cout d'electricite retenu est une
   * valeur CERTAINE (mesure, ou zero certain : aucune electricite sur ce
   * lieu, ou deja comptee dans l'emplacement/le forfait). Non-`null` quand ce
   * cout a ete compte 0 PAR PRUDENCE faute de donnee (mode ou prix non
   * parametre, ou aucune duree d'equipement enregistree pour cette session —
   * voir `resoudreCoutEnergieSession`, `@batte/core`). EPHEMERE, comme
   * `resolutionVolume` ci-dessus : jamais persiste pour lui-meme, jamais
   * reconstitue en rouvrant la session plus tard.
   */
  readonly avertissementEnergie: string | null;
  /**
   * Avertissement : du TRANSFORME a ete vendu cette session, mais AUCUNE
   * source de cout n'a ete retenue pour lui — ni `coutMatiereTransformeCents`
   * (production + garnitures), ni le panier des composants de nomenclature de
   * VENTE (fiche 15, transforme A LA DEMANDE comme le cafe) — la marge brute
   * affichee compte alors ce chiffre d'affaires sans en retrancher la matiere
   * (defaut trouve en audit, 30/07/2026 : le trou SYMETRIQUE de celui deja
   * corrige cote revendu/garnitures/composants, protege par `ecartsStock`
   * ci-dessus, mais qui ne dit rien d'une production simplement absente). Voir
   * `coutMatiereTransformeSuspect` (`@batte/core`) pour le seuil de
   * declenchement et sa justification complete.
   *
   * `null` dans les TROIS cas suivants, qu'il ne faut JAMAIS confondre :
   *  - un cout matiere transforme REELLEMENT retenu, meme partiel ;
   *  - un cout de composants de vente REELLEMENT retenu, meme partiel — un
   *    transforme A LA DEMANDE dont la composition vient entierement de sa
   *    nomenclature de vente a bien un cout matiere, simplement compte dans
   *    CE panier plutot que dans `coutMatiereTransformeCents` ;
   *  - une session qui n'a vendu QUE du revendu — un cout transforme nul y
   *    est alors LA VERITE (aucune crepe vendue, rien a retrancher), jamais
   *    une anomalie a signaler.
   *
   * EPHEMERE, meme convention que `avertissementEnergie` juste au-dessus :
   * jamais persiste pour lui-meme, jamais reconstitue en rouvrant la session
   * plus tard.
   */
  readonly avertissementCoutMatiereTransforme: string | null;
};

/**
 * Vérifie qu'un `evenement` peut motiver ou se voir rattacher une session
 * (fiche 14, D-059) — partagée par `creerSession` (dès la création) et
 * `rattacherEvenementSession` (après coup).
 *
 * Seule une OPPORTUNITÉ (`famille` non NULL : `entreprise`, `grand_public` ou
 * `marche_noel`) peut motiver une session. Un événement-FACTEUR classique
 * (`famille = NULL`) module une session déjà existante, il n'en crée jamais
 * une (docs/demandes/14 §2) — l'y rattacher inverserait le sens du modèle.
 */
function validerOpportuniteRattachable(base: BaseBatte, evenementId: string): void {
  const ev = base
    .select({ famille: evenement.famille, rejeteLe: evenement.rejeteLe })
    .from(evenement)
    .where(eq(evenement.id, evenementId))
    .get();
  if (ev === undefined) throw new ErreurIntrouvable('Opportunité', evenementId);

  if (ev.famille === null) {
    throw new ErreurMetier(
      'evenement_pas_une_opportunite',
      'Seul un événement classé comme opportunité (entreprise, grand public ou marché de ' +
        'Noël) peut motiver une session : un événement-facteur classique module une session ' +
        "existante, il n'en crée pas (docs/demandes/14).",
    );
  }
  if (ev.rejeteLe !== null) {
    throw new ErreurMetier(
      'opportunite_rejetee',
      'Cette opportunité a été écartée (« je n’y vais pas ») : elle ne peut pas motiver une ' +
        'session.',
    );
  }
}

export function creerSession(
  base: BaseBatte,
  entree: {
    lieuId: string;
    dateSession: string;
    fondsCaisseInitialCents?: number;
    /**
     * Opportunité (fiche 14) qui motive cette session dès sa création — un
     * stand d'entreprise, un marché de Noël, une fête médiévale. `null` ou
     * absent = session régulière, le cas majoritaire.
     */
    evenementId?: string | null;
  },
): { id: string; numero: string } {
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    // Verification AVANT l'insertion : sans elle, un lieu inconnu ne se
    // manifestait que par une violation de cle etrangere SQLite, remontee en
    // 500 generique. Or dans la meme famille de routes, un ingredient inconnu
    // rend deja un 404 nomme — l'utilisateur n'a aucune raison de subir deux
    // comportements pour la meme faute.
    const lieu = baseTx
      .select({ id: lieuMarche.id })
      .from(lieuMarche)
      .where(eq(lieuMarche.id, entree.lieuId))
      .get();
    if (lieu === undefined) throw new ErreurIntrouvable('Lieu de marché', entree.lieuId);

    if (entree.evenementId !== null && entree.evenementId !== undefined) {
      validerOpportuniteRattachable(baseTx, entree.evenementId);
    }

    const maintenant = maintenantUtc();
    const annee = Number.parseInt(entree.dateSession.slice(0, 4), 10);
    const numero = allouerNumero(baseTx, 'session', annee);
    const id = nouvelIdentifiant();

    baseTx
      .insert(sessionMarche)
      .values({
        id,
        numero,
        lieuId: entree.lieuId,
        evenementId: entree.evenementId ?? null,
        dateSession: entree.dateSession,
        statut: 'planifiee',
        fondsCaisseInitialCents: entree.fondsCaisseInitialCents ?? 0,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    return { id, numero };
  });
}

/**
 * Rattache une session déjà créée à l'opportunité qui l'a motivée, APRÈS
 * coup (fiche 14) — par exemple une session planifiée à laquelle on décide,
 * quelques jours avant, qu'un stand d'entreprise correspond.
 *
 * REFUSÉ sur une session déjà CLÔTURÉE : « le lien doit être posé avant, pas
 * reconstitué » (consigne de ce lot, CLAUDE.md §7) — sans cette garde, on
 * pourrait attendre de connaître le résultat d'une session pour choisir après
 * coup l'entreprise à laquelle l'attribuer, ce qui rendrait le taux de prise
 * mesuré indiscernable d'un chiffre choisi pour arranger la mesure. Une
 * session `annulee` n'est PAS bloquée ici : elle est de toute façon exclue du
 * modèle (`exclure_du_modele = true`, voir `annulerSession`) et ne contribue
 * donc jamais à `sessionsEntrepriseFermees` (`packages/db/src/depots/
 * opportunites.ts`), qui ne lit que les sessions `cloturee`.
 */
export function rattacherEvenementSession(
  base: BaseBatte,
  sessionId: string,
  evenementId: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const session = baseTx
      .select()
      .from(sessionMarche)
      .where(eq(sessionMarche.id, sessionId))
      .get();
    if (session === undefined) throw new ErreurIntrouvable('Session', sessionId);

    if (session.statut === 'cloturee') {
      throw new ErreurMetier(
        'session_deja_cloturee',
        `La session ${session.numero} est déjà clôturée : le lien vers l'opportunité qui l'a ` +
          'motivée doit être posé AVANT la clôture, jamais reconstitué après coup — sinon le ' +
          "taux de prise mesuré serait indiscernable d'un chiffre choisi pour correspondre au " +
          'résultat déjà connu.',
      );
    }

    validerOpportuniteRattachable(baseTx, evenementId);

    const maintenant = maintenantUtc();
    baseTx
      .update(sessionMarche)
      .set({ evenementId, modifieLe: maintenant })
      .where(eq(sessionMarche.id, sessionId))
      .run();

    journaliser(baseTx, {
      table: 'session_marche',
      enregistrementId: sessionId,
      action: 'modification',
      valeurAvant: session,
      valeurApres: { ...session, evenementId },
    });
  });
}

/**
 * Nombre de crepes produites : DERIVE des productions rattachees, ou d'un
 * volume de pate MESURE, jamais ressaisi deux fois.
 *
 * `CLAUDE.md` §0 : « une reception de farine doit se propager, **sans
 * ressaisie**, jusqu'a la marge nette du dimanche suivant ». Redemander a la
 * cloture un chiffre que la saisie du realise a deja enregistre est exactement
 * la ressaisie que la these du produit interdit — et elle n'etait rapprochee de
 * rien : on pouvait cloturer en declarant 9 999 crepes sans aucune production,
 * ce qui faussait taux d'ecoulement et marge par crepe, en silence.
 *
 * Deux modes de saisie de la production, AU CHOIX (jamais les deux) :
 *  - `crepesProduites` : le porteur compte des CREPES ;
 *  - `volumeRestantSaisi` : le porteur MESURE ce qu'il reste dans le bac, et
 *    l'application deduit les crepes produites. Un ecart avec vendues +
 *    invendues + cassees n'est alors JAMAIS refuse : c'est une mesure, pas
 *    une faute de frappe (voir `resoudreCrepesDepuisVolumeRestant`).
 *
 * Quand ni l'un ni l'autre n'est fourni, trois cas, dans cet ordre :
 *  1. des productions sont rattachees -> on derive (le realise prime sur le
 *     theorique des qu'il est connu) ;
 *  2. des productions sont rattachees ET une valeur est saisie -> elle doit
 *     CORRESPONDRE, sinon on refuse en nommant les deux chiffres. Une
 *     divergence EXPLICITEMENT declaree est soit une production oubliee, soit
 *     une faute de frappe : dans les deux cas, la trancher en silence
 *     produirait une piece comptable fausse ;
 *  3. aucune production rattachee -> la valeur saisie fait foi (crepes faites
 *     hors application), et son absence est refusee — MAIS elle doit rester
 *     coherente avec vendues + invendues + cassees, qui decrivent la meme
 *     fournee. Sans ce garde-fou, `9999` passait tel quel des lors qu'aucune
 *     production n'etait rattachee (docs/17 fiche 10, ancien `it.fails`
 *     « MAILLON ROMPU » de `packages/db/src/parcours-erp.test.ts`, depuis
 *     converti en test ordinaire) : le cas « production
 *     rattachee » etait deja verrouille, celui-ci ne l'etait pas.
 *
 * `ventesPourVolumePate` (fiche 15 §5.1) : en mode volume, la pate vendue
 * TELLE QUELLE (une bouteille) quitte le bac sans devenir une crepe. Sans
 * cette retenue, un pot vendu se compterait comme des crepes produites,
 * surestimant la production. Voir `estPateVendueAuVolume` (identification par
 * `consommationUnite === 'volume_pate'`, decision du porteur du 31/07/2026)
 * et `volumePateVendueDirectementMl` (`@batte/core`) : leur contribution
 * reste `0` tant qu'aucun appelant ne lit le volume represente par une unite
 * vendue — limite documentee, jamais silencieuse.
 */
function resoudreCrepesProduites(
  productions: readonly {
    crepesTheoriques: number;
    crepesReelles: number | null;
    volumeTheoriqueMl: number;
    volumeReelMl: number | null;
  }[],
  saisi: number | undefined,
  volumeRestantSaisi: { quantite: number; unite: 'ml' | 'g' } | null | undefined,
  ecoulement: { crepesVendues: number; crepesInvendues: number; crepesCassees: number },
  ventesPourVolumePate: readonly {
    quantite: number;
    estPateVendueAuVolume: boolean;
    volumeMlParUnite: number | null;
  }[],
): { crepesProduites: number; resolutionVolume: ResolutionCrepesParVolume | null } {
  if (saisi !== undefined && volumeRestantSaisi !== null && volumeRestantSaisi !== undefined) {
    throw new ErreurMetier(
      'mode_production_ambigu',
      'Choisissez un seul mode de saisie de la production : le nombre de crêpes produites, ou ' +
        'le volume de pâte restant — pas les deux à la fois.',
      { champs: { crepesProduites: 'Videz ce champ si vous renseignez le volume restant.' } },
    );
  }

  if (volumeRestantSaisi !== null && volumeRestantSaisi !== undefined) {
    // `convertir` refuse elle-meme une conversion g -> ml sans densite : aucune
    // densite de pate n'est declaree nulle part dans le modele (CLAUDE.md §3
    // regle 4). On rattrape seulement le MESSAGE, qui parle par defaut d'un
    // « ingredient » — trompeur ici, ou c'est la pate elle-meme qui est pesee —
    // sans jamais inventer le facteur que `convertir` refuse a raison.
    let volumeRestantMl: number;
    try {
      volumeRestantMl = convertir(volumeRestantSaisi.quantite, volumeRestantSaisi.unite, 'ml');
    } catch (erreur) {
      if (erreur instanceof ErreurMetier && erreur.code === 'densite_manquante') {
        throw new ErreurMetier(
          'densite_pate_manquante',
          'La quantité de pâte restante ne peut pas être saisie en grammes : aucune densité de ' +
            "pâte n'est déclarée dans l'application. Saisissez ce volume en millilitres.",
          { champs: { volumeRestantSaisi: 'Saisissez ce volume en millilitres.' } },
        );
      }
      throw erreur;
    }

    const resolution = resoudreCrepesDepuisVolumeRestant(
      productions.map((p) => ({
        volumeProduitMl: p.volumeReelMl ?? p.volumeTheoriqueMl,
        crepesProduites: p.crepesReelles ?? p.crepesTheoriques,
      })),
      volumeRestantMl,
      volumePateVendueDirectementMl(ventesPourVolumePate),
    );
    return { crepesProduites: resolution.crepesProduites, resolutionVolume: resolution };
  }

  if (productions.length === 0) {
    if (saisi === undefined) {
      throw new ErreurMetier(
        'crepes_produites_inconnues',
        "Aucune production n'est rattachée à cette session : indiquez le nombre de " +
          'crêpes produites, le volume de pâte restant, ou rattachez la production correspondante.',
        { champs: { crepesProduites: 'Indiquez le nombre de crêpes produites.' } },
      );
    }
    // Conservation : tout ce qui est produit finit vendu, invendu ou casse.
    // C'est vrai QUE des productions soient rattachees ou non — ici, sans
    // production, rien d'autre ne peut le verifier. Ce controle ne s'applique
    // qu'a une valeur EXPLICITEMENT declaree : un volume mesure ne passe
    // jamais par cette branche (voir plus haut).
    const attendu =
      ecoulement.crepesVendues + ecoulement.crepesInvendues + ecoulement.crepesCassees;
    if (saisi !== attendu) {
      throw new ErreurMetier(
        'crepes_produites_incoherentes',
        `Vous déclarez ${saisi} crêpes produites, mais vendues (${ecoulement.crepesVendues}) + ` +
          `invendues (${ecoulement.crepesInvendues}) + cassées (${ecoulement.crepesCassees}) ` +
          `totalisent ${attendu}. Aucune production n'étant rattachée à cette session, ces trois ` +
          'chiffres doivent correspondre exactement au total produit.',
        { champs: { crepesProduites: `Vendues + invendues + cassées = ${attendu}.` } },
      );
    }
    return { crepesProduites: saisi, resolutionVolume: null };
  }

  // Le realise prime sur le theorique des qu'il est saisi.
  const derive = productions.reduce(
    (total, p) => total + (p.crepesReelles ?? p.crepesTheoriques),
    0,
  );

  if (saisi !== undefined && saisi !== derive) {
    throw new ErreurMetier(
      'crepes_produites_incoherentes',
      `Vous déclarez ${saisi} crêpes produites, mais les productions rattachées à cette ` +
        `session en totalisent ${derive}. Corrigez le réalisé de la production, ou ` +
        'rattachez la production manquante.',
      { champs: { crepesProduites: `Les productions rattachées totalisent ${derive} crêpes.` } },
    );
  }

  return { crepesProduites: derive, resolutionVolume: null };
}

/**
 * Explose UNE ligne de vente de MENU (fiche 16 §2, migration 0023) en lignes
 * de vente PAR COMPOSANT — LE POINT CRITIQUE de la clôture depuis que
 * `produit_vente.nature` peut valoir `'menu'` : `LigneVente.nature`
 * (`@batte/core`) reste volontairement limité à `'transforme' | 'revendu'`
 * (voir sa doc), donc un menu ne peut JAMAIS atteindre `totaliserVentes` tel
 * quel — il doit être éclaté ICI, avant, ou il tomberait entièrement dans
 * `caRevenduCents` et fausserait le compteur de franchise TVA.
 *
 * Ventile au prix PRATIQUÉ ce jour-là (`vente.prixUnitaireCents`), JAMAIS au
 * prix catalogue du menu (`menu.prixCents`) : une session close est une pièce
 * comptable figée (docs/01 module 4), un tarif de menu qui change ensuite ne
 * doit jamais réécrire une clôture passée — même règle que pour un produit
 * simple. C'est pourquoi cette fonction n'appelle pas `calculerVentilationMenu`
 * (`depots/menus.ts`, qui lit le prix CATALOGUE pour l'écran de simulation) et
 * appelle directement `ventilerMenu` avec le prix du jour.
 *
 * Chaque composant reprend son VRAI coût de revient (`coutRevientProduit`),
 * jamais recalculé, et son prix catalogue comme poids de prorata par défaut.
 * La méthode « composant désigné » (fiche 16 §2.2) EST disponible ici :
 * `prixForceCents` vient de `listerCompositionMenu` (le réglage PERSISTÉ,
 * `menu_composition.prix_force_cents`), jamais forcé à `null` — sans quoi une
 * désignation saisie et validée à l'écran Menus serait silencieusement
 * ignorée à chaque vente réelle, faussant la ventilation transformé/revendu
 * qui alimente les compteurs de seuils légaux (CLAUDE.md §6) sur CHAQUE
 * session close, pas seulement sur l'écran de simulation. Comme
 * `calculerVentilationMenu` (`depots/menus.ts`), cette fonction ventile
 * `null` = prorata pur, une valeur = prix imposé POUR CE composant — les deux
 * peuvent coexister dans le même menu, `ventilerMenu`/`repartirPrixMenu`
 * (`@batte/core`) le gèrent nativement (composants désignés ET composants au
 * prorata, dans la même ventilation).
 *
 * RENVOIE AUSSI LES QUANTITÉS DE COMPOSANTS À SORTIR DU STOCK (Trou 2, audit
 * du 30/07/2026) : `lignesVente` sert la VENTILATION DU CA
 * (`exploserVenteMenuEnLignesVente`, quantite figée à 1, montant déjà
 * multiplié — voir sa doc), `composantsConsommes` sert les TROIS SORTIES DE
 * STOCK (`sortirLesProduitsRevendus`, `sortirLesGarnitures`,
 * `sortirLesComposantsVente`, plus bas dans `cloturerSession`), qui ont
 * besoin d'une QUANTITÉ PHYSIQUE par composant, jamais d'un partage de prix.
 * `exploserVentesMenusEnQuantitesComposants` (`@batte/core`) est FAITE pour
 * ça. AVANT ce correctif, ces trois fonctions opéraient sur `entree.ventes`
 * BRUT, donc sur le produit-conteneur : un composant REVENDU inclus dans un
 * menu (le sirop) n'était donc PAS décompté du stock, ni ses garnitures.
 */
function exploserLigneMenu(
  baseTx: BaseBatte,
  menu: typeof produitVente.$inferSelect,
  vente: LigneVenteSaisie,
): {
  lignesVente: LigneVente[];
  composantsConsommes: { produitInclusId: string; quantite: number }[];
} {
  const composition = listerCompositionMenu(baseTx, menu.id).filter((c) => c.actif);
  if (composition.length === 0) {
    throw new ErreurMetier(
      'menu_sans_composant_actif',
      `Le menu « ${menu.nom} » ne contient aucun composant actif : impossible de ventiler sa vente.`,
    );
  }

  const composants: ComposantMenuCalcul[] = composition.map((c) => ({
    produitInclusId: c.produitInclusId,
    nom: c.nomProduitInclus,
    nature: c.nature,
    quantite: c.quantite,
    prixCatalogueCents: c.prixCatalogueCents,
    coutMatiereCents: coutRevientProduit(baseTx, c.produitInclusId)?.coutMatiereCents ?? null,
    nbCrepesParUnite: c.nbCrepesParUnite,
    // Réglage PERSISTÉ (voir l'en-tête ci-dessus) : `null` = ce composant suit
    // le prorata, une valeur = prix imposé pour CE composant dans CE menu.
    // Contrairement à `calculerVentilationMenu`, aucune simulation éphémère
    // ne s'applique ici — une vente réelle ventile avec le réglage tel que
    // décidé et enregistré, jamais avec une hypothèse ponctuelle.
    prixForceCents: c.prixForceCents,
  }));

  // Le nom du menu n'entre dans AUCUN calcul : il ne sert qu'au message levé
  // quand les prix désignés sont incohérents avec le prix pratiqué. Ce refus
  // interrompt la clôture de TOUTE la journée (D-093) — le porteur doit donc
  // pouvoir savoir quelle fiche ouvrir sans avoir à les essayer une par une.
  const ventilation = ventilerMenu(vente.prixUnitaireCents, composants, { nomMenu: menu.nom });

  const lignesVente = exploserVenteMenuEnLignesVente(
    {
      menuId: menu.id,
      quantite: vente.quantite,
      // Un menu se vend en un bloc, jamais mi-sur-place mi-emporté (fiche 16
      // §2) : c'est le drapeau du CONTENEUR qui s'applique à tous ses
      // composants exposés, pas un drapeau par composant.
      consommationSurPlace: menu.consommationSurPlace,
    },
    ventilation,
  );

  // Quantité PHYSIQUE de chaque composant consommée par CETTE vente de menu
  // (`vente.quantite` menus × `composition[i].quantite` par menu) — jamais un
  // partage de prix, à la différence de `lignesVente` ci-dessus.
  const quantitesComposants = exploserVentesMenusEnQuantitesComposants(
    [{ menuId: menu.id, quantite: vente.quantite }],
    new Map([
      [
        menu.id,
        composition.map((c) => ({ produitInclusId: c.produitInclusId, quantite: c.quantite })),
      ],
    ]),
  );

  return {
    lignesVente,
    composantsConsommes: [...quantitesComposants.entries()].map(([produitInclusId, quantite]) => ({
      produitInclusId,
      quantite,
    })),
  };
}

/**
 * Colonnes d'un relevé `meteo_observation`, dans la forme attendue par
 * `MeteoSessionReleve` (`@batte/core`) — partagées par les deux lectures de
 * `cloturerSession` (prévue et réelle), pour ne pas répéter la même liste de
 * huit champs deux fois.
 */
const COLONNES_RELEVE_METEO = {
  temperatureC: meteoObservation.temperatureC,
  temperatureRessentieC: meteoObservation.temperatureRessentieC,
  precipitationsMm: meteoObservation.precipitationsMm,
  probabilitePluieBp: meteoObservation.probabilitePluieBp,
  ventKmh: meteoObservation.ventKmh,
  couvertureNuageuseBp: meteoObservation.couvertureNuageuseBp,
  codeMeteo: meteoObservation.codeMeteo,
  horizonJours: meteoObservation.horizonJours,
} as const;

/** Minutes entre deux heures `HH:MM`. `null` si l'une des deux manque. */
function dureeMinutes(debut: string | null, fin: string | null): number | null {
  if (debut === null || fin === null) return null;
  const [hd, md] = debut.split(':').map(Number);
  const [hf, mf] = fin.split(':').map(Number);
  if (hd === undefined || md === undefined || hf === undefined || mf === undefined) return null;
  const minutes = hf * 60 + mf - (hd * 60 + md);
  return minutes > 0 ? minutes : null;
}

/**
 * Construit `avertissementCoutMatiereTransforme` (voir sa doc sur
 * `ResultatCloture`) : `null` tant que `coutMatiereTransformeSuspect`
 * (`@batte/core`, LE seuil de déclenchement, justifié dans sa propre doc) rend
 * `false` ; sinon un message qui NOMME les produits transformés vendus cette
 * session, ENRICHI — quand c'est possible — du diagnostic de leur recette
 * (`diagnostiquerRecettePourCoutNul`, `depots/referentiel.ts`) quand elle est
 * en brouillon ou ne porte aucune ligne : le second trou de cette mission
 * (recette jamais activée, jamais garnie) n'est qu'UNE des causes possibles
 * d'un coût transformé nul — l'autre étant simplement l'absence de toute
 * production rattachée, cas qui n'implique aucune recette suspecte et que le
 * message couvre malgré tout par sa formulation générale.
 *
 * `lignes` porte déjà la nature RÉELLE de chaque ligne de vente — menu
 * explosé compris (`exploserLigneMenu` plus haut) — et `parId` porte déjà
 * tous les produits nécessaires pour la résoudre (directs ET composants de
 * menu, résolus avant l'appel) : aucune requête supplémentaire pour les
 * identifier, seulement pour diagnostiquer LEUR recette.
 *
 * TROISIÈME PANIER (mission « café, recette vide et avertissement trop
 * bavard ») : le SEUIL de déclenchement (`coutMatiereTransformeSuspect`)
 * connaît désormais `coutComposantsVenteCents` — voir sa doc. Mais un
 * troisième trou existait encore ICI, dans le MESSAGE : un transformé À LA
 * DEMANDE (fiche 15, le café) peut porter une recette délibérément vide
 * (décision du porteur — satisfaire `verifierCoherenceProduit` sans jamais
 * produire par lot), et `diagnostiquerRecettePourCoutNul` la désignerait alors
 * à tort comme « probablement en cause », alors que sa VRAIE composition vit
 * dans sa nomenclature de vente. Un produit qui porte des composants de vente
 * ACTIFS n'a donc plus SA recette diagnostiquée ici : ce n'est PAS une
 * exception sur le café par son nom, c'est la même règle que le seuil
 * ci-dessus — « le coût est dans un autre panier » — appliquée au message,
 * pour toute la classe des transformés à la demande, présents ou futurs.
 *
 * QUATRIÈME PANIER (mission « la pâte vendue au volume n'est jamais déduite
 * du stock ») : `coutPateVendueDirectementCents` (fiche 15 §5.1) rejoint
 * `coutComposantsVenteCents` dans le seuil — une session qui ne vend QUE de
 * la pâte en bouteille (aucune crêpe cuite) a, elle aussi, `caTransformeCents
 * > 0` et `coutMatiereTransformeCents === 0` (aucune crêpe vendue), sans que
 * ce soit une anomalie : son vrai coût matière est retenu dans CE panier.
 */
function construireAvertissementCoutMatiereTransforme(
  baseTx: BaseBatte,
  totaux: TotauxVentes,
  coutMatiereTransformeCents: number,
  coutComposantsVenteCents: number,
  coutPateVendueDirectementCents: number,
  lignes: readonly LigneVente[],
  parId: ReadonlyMap<string, typeof produitVente.$inferSelect>,
): string | null {
  if (
    !coutMatiereTransformeSuspect({
      caTransformeCents: totaux.caTransformeCents,
      coutMatiereTransformeCents,
      coutComposantsVenteCents,
      coutPateVendueDirectementCents,
    })
  ) {
    return null;
  }

  const produitsTransformeVendus = new Map<string, typeof produitVente.$inferSelect>();
  for (const ligne of lignes) {
    if (ligne.nature !== 'transforme') continue;
    const produit = parId.get(ligne.produitVenteId);
    if (produit !== undefined) produitsTransformeVendus.set(ligne.produitVenteId, produit);
  }

  const noms = [...produitsTransformeVendus.values()].map((p) => `« ${p.nom} »`).join(', ');

  // Un produit dont la nomenclature de VENTE porte au moins un composant ACTIF
  // n'a pas sa composition « dans » sa recette (voir l'en-tête ci-dessus) :
  // sa recette, même vide ou en brouillon, n'est donc jamais désignée comme
  // suspecte — ce serait pointer le mauvais panier.
  const composantsParProduit = composantsActifsDesProduits(baseTx, [
    ...produitsTransformeVendus.keys(),
  ]);
  const idsRecettes = [
    ...new Set(
      [...produitsTransformeVendus.entries()]
        .filter(([produitId]) => (composantsParProduit.get(produitId) ?? []).length === 0)
        .map(([, p]) => p.recetteId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const recettesSuspectes = idsRecettes
    .map((id) => diagnostiquerRecettePourCoutNul(baseTx, id))
    .filter(
      (d): d is DiagnosticRecetteCoutNul =>
        d !== null && (d.statut !== 'active' || d.nbLignes === 0),
    );

  const indiceRecette =
    recettesSuspectes.length === 0
      ? ''
      : ' Recette(s) probablement en cause : ' +
        recettesSuspectes
          .map((d) => `« ${d.libelle} » (statut ${d.statut}, ${d.nbLignes} ligne(s))`)
          .join(', ') +
        '.';

  return (
    `Du transformé a été vendu (${noms}), mais aucun coût matière n'a été retenu pour lui : ` +
    "la marge brute affichée compte ce chiffre d'affaires sans en retrancher la matière. " +
    "Vérifiez qu'une production est bien rattachée à cette session, et que la recette du " +
    `produit vendu n'est pas restée vide ou en brouillon.${indiceRecette}`
  );
}

/**
 * Cloture une session : enregistre les ventes, rapproche la caisse, calcule
 * toutes les marges, et FIGE le resultat.
 *
 * Atomique : une cloture a moitie ecrite laisserait un journal des recettes
 * incoherent avec ses lignes de vente.
 */
export function cloturerSession(
  base: BaseBatte,
  sessionId: string,
  entree: EntreeCloture,
): ResultatCloture {
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const session = baseTx
      .select()
      .from(sessionMarche)
      .where(eq(sessionMarche.id, sessionId))
      .get();
    if (session === undefined) throw new ErreurIntrouvable('Session', sessionId);

    // Verrou de periode (docs/07 §1.6) : une session close est l'ecriture qui
    // porte l'ESSENTIEL du chiffre d'affaires, elle ne doit pas echapper au
    // garde-fou deja applique sur les sept autres points d'ecriture dates
    // (depenses, immobilisations, mouvements de stock, receptions,
    // productions). Verifiee AVANT toute autre regle metier de cloture, sur
    // le jour civil DE LA SESSION (`session.dateSession`), jamais sur
    // aujourd'hui : une session datee dans un exercice deja transmis au
    // comptable ne doit plus pouvoir changer apres coup.
    verifierPeriodeNonVerrouillee(baseTx, session.dateSession);

    if (session.statut === 'cloturee') {
      throw new ErreurMetier(
        'session_deja_cloturee',
        `La session ${session.numero} est déjà clôturée. ` +
          'Une pièce comptable ne se réécrit pas : annulez-la pour la corriger.',
      );
    }

    if (entree.ventes.length === 0) {
      throw new ErreurMetier(
        'session_sans_vente',
        'Une session clôturée doit comporter au moins une ligne de vente. ' +
          "Si le marché n'a pas eu lieu, annulez la session au lieu de la clôturer.",
      );
    }

    // --- Resolution des produits vendus -----------------------------------
    const idsProduits = [...new Set(entree.ventes.map((v) => v.produitVenteId))];
    const produits = baseTx
      .select()
      .from(produitVente)
      .where(inArray(produitVente.id, idsProduits))
      .all();

    const parId = new Map(produits.map((p) => [p.id, p]));
    for (const id of idsProduits) {
      if (!parId.has(id)) throw new ErreurIntrouvable('Produit', id);
    }

    // Un MENU (nature === 'menu') n'atteint JAMAIS `totaliserVentes` tel quel
    // (voir la doc de `NatureProduit`, `@batte/core`) : il est ÉCLATÉ en
    // lignes par composant AVANT, chacune avec sa VRAIE nature — c'est
    // `exploserLigneMenu` ci-dessus qui porte tout le raisonnement.
    //
    // Construit EN MÊME TEMPS `composantsMenusPourStock` (Trou 2, audit du
    // 30/07/2026) : la quantité PHYSIQUE de chaque composant de menu
    // consommée, avec le drapeau `consommationSurPlace` du CONTENEUR qui l'a
    // vendu (même règle que pour le CA : « un menu se vend en un bloc »).
    // Traité MENU PAR MENU (jamais collationné À TRAVERS plusieurs menus
    // différents) pour ne jamais mélanger deux drapeaux distincts si deux
    // menus différents partagent un même composant.
    const lignes: LigneVente[] = [];
    const composantsMenusPourStock: {
      produitVenteId: string;
      quantite: number;
      consommationSurPlace: boolean;
    }[] = [];
    for (const v of entree.ventes) {
      const produit = parId.get(v.produitVenteId)!;
      if (produit.nature === 'menu') {
        const explosion = exploserLigneMenu(baseTx, produit, v);
        lignes.push(...explosion.lignesVente);
        for (const composant of explosion.composantsConsommes) {
          composantsMenusPourStock.push({
            produitVenteId: composant.produitInclusId,
            quantite: composant.quantite,
            consommationSurPlace: produit.consommationSurPlace,
          });
        }
        continue;
      }
      lignes.push({
        produitVenteId: v.produitVenteId,
        nature: produit.nature,
        quantite: v.quantite,
        prixUnitaireCents: v.prixUnitaireCents,
        // Un produit revendu ne consomme aucune crepe.
        nbCrepesParUnite: produit.nature === 'revendu' ? 0 : (produit.nbCrepes ?? 1),
        consommationSurPlace: produit.consommationSurPlace,
      });
    }

    // Les composants d'un menu peuvent n'être JAMAIS vendus directement sur
    // cette session (le sirop d'un menu, sans être aussi vendu seul à côté) :
    // `parId` ne les contient donc pas forcément — `sortirLesProduitsRevendus`
    // (plus bas) a pourtant besoin de leur ligne COMPLÈTE pour résoudre leur
    // nature et leur ingrédient.
    const idsComposantsMenusAResoudre = [
      ...new Set(composantsMenusPourStock.map((c) => c.produitVenteId)),
    ].filter((id) => !parId.has(id));
    if (idsComposantsMenusAResoudre.length > 0) {
      baseTx
        .select()
        .from(produitVente)
        .where(inArray(produitVente.id, idsComposantsMenusAResoudre))
        .all()
        .forEach((p) => parId.set(p.id, p));
    }

    const totaux = totaliserVentes(lignes);
    const caisse = rapprocherCaisse(
      {
        fondsCaisseInitialCents: entree.fondsCaisseInitialCents,
        especesCompteesCents: entree.especesCompteesCents,
        caCarteCents: entree.caCarteCents,
      },
      totaux.caTotalCents,
    );

    // Cout matiere reel : celui des productions rattachees a cette session.
    // Les productions ANNULEES sont exclues — sans ce filtre, une production
    // annulee aurait continue de peser dans la marge de la session.
    const productions = baseTx
      .select({
        cout: production.coutMatiereTheoriqueCents,
        coutReel: production.coutMatiereReelCents,
        crepesTheoriques: production.crepesTheoriques,
        crepesReelles: production.crepesReelles,
        volumeTheoriqueMl: production.volumeTheoriqueMl,
        volumeReelMl: production.volumeReelMl,
      })
      .from(production)
      .where(and(eq(production.sessionId, sessionId), ne(production.statut, 'annulee')))
      .all();
    const coutProductionsCents = productions.reduce(
      (somme, p) => somme + (p.coutReel ?? p.cout),
      0,
    );

    /**
     * Pâte vendue TELLE QUELLE (fiche 15 §5.1) : identifiée par
     * `consommationUnite === 'volume_pate'` (`estPateVendueAuVolume`,
     * `@batte/core`, décision du porteur du 31/07/2026 — voir sa doc pour le
     * défaut que ce champ corrige : avant lui, `nature = 'transforme'` + une
     * recette rattachée + `nbCrepes = 0` suffisaient à déduire ce cas, ce qui
     * rendait aussi VRAI, À TORT, un transformé À LA DEMANDE comme le café).
     *
     * `volumeMlParUnite` LIT DÉSORMAIS `produit.volumeMlParUnite` (mission
     * « la pâte vendue au volume n'est jamais déduite du stock », 01/08/2026) :
     * avant cette mission, ce champ restait codé en dur à `null` — la
     * COLONNE existait déjà sur `produit_vente`, mais rien ici ne la lisait,
     * ce qui rendait `volumePateVendueDirectementMl` (ci-dessous) TOUJOURS
     * nul, quelle que soit la quantité de pâte réellement vendue en
     * bouteille. `produit` vient de `.select()` (toutes colonnes) : aucune
     * requête supplémentaire n'est nécessaire pour l'obtenir.
     */
    const ventesPourVolumePate = entree.ventes.map((v) => {
      const produit = parId.get(v.produitVenteId)!;
      return {
        quantite: v.quantite,
        // Un MENU n'est jamais lui-même de la pâte vendue au volume : ce
        // concept ne s'applique qu'à un produit TRANSFORMÉ simple — un
        // menu-conteneur n'a pas de `consommationUnite` (`null`,
        // `verifierCoherenceProduit`, `@batte/core`). Ses composants exposés,
        // eux, gardent chacun leur propre nature et pourraient un jour porter
        // ce volume, mais aucun champ du modèle ne le permet encore ici (même
        // limite documentée que pour un produit simple).
        estPateVendueAuVolume:
          produit.nature === 'menu'
            ? false
            : estPateVendueAuVolume({
                // Objet reconstruit plutôt que `produit` transmis tel quel :
                // le CONTRÔLE DE FLUX affine bien `produit.nature` à CETTE
                // lecture (branche `!== 'menu'`), mais TypeScript ne
                // reporterait pas cet affinement sur `produit` DANS SON
                // ENSEMBLE si on le passait directement en argument.
                nature: produit.nature,
                consommationUnite: produit.consommationUnite,
              }),
        volumeMlParUnite: produit.volumeMlParUnite,
      };
    });

    /**
     * Volume de pâte vendue DIRECTEMENT (bouteille, pot) sur cette session,
     * TOUS PRODUITS confondus — calculé ICI, INDÉPENDAMMENT du mode de
     * clôture (crêpes ou volume restant mesuré) : une vente de pâte au
     * volume a lieu, et doit peser sur le coût matière de la session, que la
     * clôture se fasse en comptant des crêpes ou en mesurant le bac. Avant
     * cette mission, seul le mode « volume restant » consommait cette valeur
     * (via `resoudreCrepesProduites`) ; le mode « crêpes » l'ignorait
     * entièrement, silencieusement.
     */
    const volumePateVendueDirectementTotalMl = volumePateVendueDirectementMl(ventesPourVolumePate);

    /**
     * Volume total PRODUIT (réel si connu, théorique sinon), toutes
     * productions rattachées à cette session confondues — même agrégat que
     * celui que `resoudreCrepesDepuisVolumeRestant` calcule en interne (mode
     * volume), mais rendu disponible ICI pour le partage du coût
     * (`repartirCoutProductionEntrePateVendueEtCrepes` plus bas), qui doit
     * fonctionner QUEL QUE SOIT le mode de clôture.
     */
    const volumeProduitTotalMl = productions.reduce(
      (somme, p) => somme + (p.volumeReelMl ?? p.volumeTheoriqueMl),
      0,
    );

    const { crepesProduites, resolutionVolume } = resoudreCrepesProduites(
      productions,
      entree.crepesProduites,
      entree.volumeRestantSaisi ?? null,
      {
        crepesVendues: totaux.crepesVendues,
        crepesInvendues: entree.crepesInvendues,
        crepesCassees: entree.crepesCassees,
      },
      ventesPourVolumePate,
    );

    /**
     * Comment `crepesProduites` a ete obtenu (D-057) : la MESURE se conserve,
     * ce qui en est derive se recalcule (meme regle que `especesComptesCents`).
     *
     * `resolutionVolume` n'est non-null que dans le mode volume, et son
     * `volumeRestantMl` EST la mesure d'origine, deja convertie en ml par
     * `resoudreCrepesProduites` ci-dessus — on ne la reconvertit pas, on ne
     * stocke pas non plus le volume produit ni le volume consomme : ces deux-la
     * se recalculent depuis les productions rattachees, ils ne sont pas une
     * mesure.
     */
    const modeCloture: 'crepes' | 'volume' = resolutionVolume !== null ? 'volume' : 'crepes';
    const volumeRestantMesureMl =
      resolutionVolume !== null ? resolutionVolume.volumeRestantMl : null;

    // Parametres a la DATE DE LA SESSION : un taux de commission qui change en
    // cours d'annee ne doit pas reecrire une session passee. (Le ternaire qui
    // testait `ventes.length > 0` etait mort : la garde ci-dessus le garantit.)
    const parametres = lireParametres(baseTx, session.dateSession);
    const tauxCommissionCarteBp = parametres.pointsDeBase('taux_commission_sumup_bp');

    /**
     * Imputation d'une TOURNEE reelle (D-064 point 4, `imputationTourneeDeplacement`,
     * `packages/core/src/deplacement.ts`) — BRANCHEE ICI et nulle part ailleurs
     * jusqu'a cet audit (Trou 2, 30/07/2026) : la fonction existait, testee, et
     * aucun code de production ne l'appelait.
     *
     * FIGEE A LA CLOTURE (calculee une seule fois, ci-dessous, jamais recalculee
     * a la lecture) — meme regle que `coutMatiereReelCents` (D-038), PAS celle
     * du CUMP (D-018/D-020, qui se recalcule a chaque lecture). Le test qui
     * distingue les deux : le CUMP decrit un etat COURANT (le stock qui reste en
     * rayon AUJOURD'HUI), donc le recalculer a chaque lecture donne par
     * construction la bonne reponse. L'imputation decrit un FAIT PASSE (les
     * kilometres deja roules pour CETTE session, deja close) — et un de ses
     * trois intrants, `coutKilometriqueRetenu` en mode « mesure »
     * (`mesureCoutVehicule`, `depots/lieux-rentabilite.ts`), est une MOYENNE
     * GLOBALE qui grossit a chaque nouvelle depense de carburant ou chaque
     * nouvelle session close — sans date de validite, contrairement a
     * `lireParametres`. La recalculer a la lecture ferait donc DERIVER, a
     * chaque donnee future, le partage session/achats d'une session close huit
     * mois plus tot : exactement la piece comptable qui « se reecrit toute
     * seule » que l'en-tete de ce fichier interdit, et que D-038 a deja
     * corrigee une fois pour le cout matiere.
     *
     * CONSEQUENCE : cette imputation est desormais STOCKEE sur trois colonnes
     * entieres nullable (centimes) de `session_marche` — miroir exact de
     * `coutMatiereTheoriqueCents` / `coutMatiereReelCents` (migration 0027,
     * ajoutee par le porteur — `schema.ts` et `packages/db/drizzle/` restent
     * hors zone d'ecriture de cet agent) :
     *   - `cout_deplacement_reel_session_cents`
     *   - `cout_deplacement_reel_detour_achats_cents`
     *   - `cout_deplacement_reel_total_cents`
     * Ecrites ci-dessous, dans le MEME `.set({...})` que le reste de la
     * cloture — une seule transaction, jamais deux ecritures separables.
     * Exposees a la fois sur `ResultatCloture.imputationDeplacement` (miroir
     * de commodite pour le bandeau affiche juste apres l'enregistrement,
     * `apps/web/src/pages/Sessions.tsx`) ET sur `schemaSessionDetail`
     * (`packages/core/src/contrats/sessions.ts`, lues par `lireSessionDetail`,
     * `packages/db/src/depots/sessions.ts`) — donc rejouables sur un `GET`
     * ulterieur, a la difference de `resolutionVolume` ci-dessus, qui reste
     * elle ephemere (pas encore une piece comptable, seulement le detail d'un
     * calcul qui vient de tourner).
     *
     * La part ACHATS (`coutDetourAchatsCents`) n'est PAS auto-enregistree en
     * `depense` (categorie `carburant` — le rattachement deja utilise
     * aujourd'hui pour un aller chez le fournisseur, voir la doc de
     * `fraisReception` dans `schema.ts`) : `mesureCarburant`
     * (`depots/comptabilite.ts`) SOMME deja TOUTES les lignes de cette
     * categorie pour nourrir `coutKilometriqueRetenu` en mode « mesure ». Y
     * inserer une ligne CALCULEE a partir de ce meme taux mesure compterait
     * deux fois le meme plein reel (une fois comme recu, une fois comme part
     * detour derivee de ce recu) et ferait deriver ce taux a la hausse, sans
     * borne, session apres session — une corruption d'une mesure dont ce lot
     * n'a de toute facon pas le droit de modifier le filtre (`depots/
     * comptabilite.ts` est hors zone d'ecriture ici). Le montant reste donc
     * VISIBLE (reponse de cloture) mais NON comptabilise automatiquement :
     * c'est au porteur de decider, au cas par cas, si le detour du jour etait
     * reellement un aller chez un fournisseur (une depense categorie carburant,
     * ou un jour `frais_reception` rattache a la bonne reception) ou un second
     * marche (auquel cas aucune depense supplementaire n'existe) — exactement
     * la doctrine de CLAUDE.md §9 (« en cas d'ambiguite, poser la question, ne
     * pas deviner »).
     */
    const lieuSession = baseTx
      .select({
        distanceKm: lieuMarche.distanceKm,
        facturationElectricite: lieuMarche.facturationElectricite,
      })
      .from(lieuMarche)
      .where(eq(lieuMarche.id, session.lieuId))
      .get();

    // Meme composition forfait/mesure que `routes/lieux-rentabilite.ts` — pas
    // reimplementee ici, seulement rejouee avec les parametres EN VIGUEUR A LA
    // DATE DE LA SESSION (`parametres`, deja lu ci-dessus) : un changement du
    // forfait officiel l'an prochain ne doit pas reecrire une tournee d'aujourd'hui.
    const coutKilometriqueCentsParKm = coutKilometriqueRetenu({
      forfaitCentsParKm: parametres.decimal('cout_kilometrique_cents_par_km'),
      mesure: mesureCoutVehicule(baseTx),
      pleinsMinimum: parametres.entier('cout_kilometrique_mesure_pleins_minimum'),
    }).centsParKm;

    const imputationDeplacement = imputationTourneeDeplacement({
      distanceReelleKm: entree.distanceReelleKm ?? null,
      distanceReferenceKmAllerSimple: lieuSession?.distanceKm ?? null,
      coutKilometriqueCentsParKm,
    });

    /**
     * Cout d'electricite RETENU dans la marge (fiche 17, cas 3 SEULEMENT —
     * facturation au compteur) : `resoudreCoutEnergieSession` (@batte/core)
     * ecarte deja les cas 1 et 2 (aucune electricite, ou deja comptee dans
     * l'emplacement/le forfait — double comptage evite) et distingue un zero
     * CERTAIN d'un zero par EXCLUSION (aucune duree d'equipement encore
     * enregistree pour cette session — cas permanent des sessions closes
     * avant l'existence de cette saisie, `equipement_session` n'ayant alors
     * pour elles AUCUNE ligne, pour toujours).
     *
     * `entree.equipementsUtilises` ne porte que l'id de l'equipement et sa
     * duree (voir `EntreeCloture`) : sa puissance est resolue ICI, PAS par
     * `enregistrerUtilisationEquipement` (`depots/equipements.ts`, appelee
     * plus bas dans cette meme transaction) — celle-ci ecrit la duree, elle
     * ne calcule aucun cout. Un id inconnu est refuse ICI, avant tout calcul,
     * plutot que de laisser une puissance manquante se lire comme 0 W.
     */
    const equipementsUtilisesSaisis = entree.equipementsUtilises ?? [];
    const idsEquipementsUtilises = [
      ...new Set(equipementsUtilisesSaisis.map((u) => u.equipementId)),
    ];
    const equipementsPuissance =
      idsEquipementsUtilises.length === 0
        ? []
        : baseTx
            .select({ id: equipement.id, puissanceW: equipement.puissanceW })
            .from(equipement)
            .where(inArray(equipement.id, idsEquipementsUtilises))
            .all();
    const puissanceParEquipementId = new Map(
      equipementsPuissance.map((e) => [e.id, e.puissanceW] as const),
    );
    for (const id of idsEquipementsUtilises) {
      if (!puissanceParEquipementId.has(id)) throw new ErreurIntrouvable('Équipement', id);
    }

    // Prix du kWh (fiche 17) : `possede()` et non `entier()` direct, meme
    // motif que `GET /equipements/point-equilibre-autoproduction`
    // (`apps/api/src/routes/equipements.ts`) — tant que la cle n'est pas
    // encore en base, le prix reste `null` (inconnu) plutot qu'une erreur 500.
    const prixKwhCentsParKwh = parametres.possede('prix_kwh_cents_par_kwh')
      ? parametres.entier('prix_kwh_cents_par_kwh')
      : null;

    const resolutionEnergie = resoudreCoutEnergieSession({
      equipementsUtilises: equipementsUtilisesSaisis.map((u) => ({
        puissanceW: puissanceParEquipementId.get(u.equipementId)!,
        dureeMinutes: u.dureeMinutes,
      })),
      facturationElectricite: lieuSession?.facturationElectricite ?? null,
      prixKwhCentsParKwh,
    });

    /**
     * Météo FIGÉE à la clôture (docs/03 « Facteur 2 », D-058) —
     * `session_marche.meteo_prevue` / `meteo_reelle`, jusqu'ici ni écrites ni
     * lues (audit du 30/07/2026, mission « météo prévue et réelle d'une
     * session »).
     *
     * QUAND figer `meteoPrevue` — la question posée par cette mission : « au
     * moment de la production de la pâte (la veille, quand la décision est
     * prise) ou à l'ouverture de la session ? » La zone d'écriture de cet
     * agent ne couvre PAS `services/production.ts` (hors périmètre) : il
     * n'existe donc aucun point d'écriture littéralement « au moment de la
     * décision ». Mais la question a une réponse MÉTIER, elle : « c'est la
     * prévision sur laquelle on a décidé qui compte, pas la dernière connue. »
     * Depuis D-058, `meteo_observation` conserve TOUTES les révisions par
     * horizon (J-7, J-3, J-1, matin même) au lieu d'écraser les précédentes —
     * la prévision qui existait la veille (horizon >= 1 jour) reste donc
     * lisible ICI, à la clôture, EXACTEMENT telle qu'elle était alors. Ce
     * n'est PAS un passé reconstitué : c'est la lecture d'un fait déjà
     * enregistré (par la collecte météo, hors zone), choisie pour répondre à
     * la bonne question plutôt qu'à la plus récente.
     *
     * `horizonJours >= 1` EXCLUT délibérément un relevé `type = 'prevision'`
     * avec `horizon_jours = 0` (une récupération le matin même) : c'est
     * exactement la « dernière connue à l'ouverture » que la question ci-
     * dessus écarte. Le PLUS PETIT horizon disponible au-dessus de 0 est
     * retenu (`orderBy(asc(horizonJours))` + premier résultat) : au plus
     * proche de J-1 quand cette révision existe, ou la révision la moins
     * ancienne encore antérieure au jour même si J-1 a été manquée.
     *
     * `meteoReelle` ne peut être connue qu'APRÈS la session (`type = 'reelle'`,
     * horizon 0 par construction, docs/demandes/07 §2) — la clôture est donc,
     * de toute façon, le plus tôt où elle peut exister.
     *
     * Les DEUX restent `null` si aucun relevé exploitable n'existe pour ce
     * lieu et cette date : jamais une valeur inventée (CLAUDE.md §7).
     *
     * SANS RAPPORT avec le moteur de prévision lui-même : le prédicteur
     * « écart météo prévue/réalisée » (`packages/core/src/prevision/
     * ecart-meteo-prevue-realisee.ts`) lit `meteo_observation` DIRECTEMENT par
     * (lieu, date) via `pairesMeteoDuLieu` (`depots/previsions.ts`, hors zone
     * d'écriture ici) et n'a besoin ni de ces colonnes ni d'un lien vers la
     * session. Elles ne servent que l'affichage et l'audit d'UNE session
     * (« qu'annonçait-on ce jour-là, qu'a-t-il fait vraiment ? »).
     */
    const releveMeteoPrevue =
      baseTx
        .select(COLONNES_RELEVE_METEO)
        .from(meteoObservation)
        .where(
          and(
            eq(meteoObservation.lieuId, session.lieuId),
            eq(meteoObservation.dateObservation, session.dateSession),
            eq(meteoObservation.type, 'prevision'),
            isNotNull(meteoObservation.horizonJours),
            gte(meteoObservation.horizonJours, 1),
          ),
        )
        .orderBy(asc(meteoObservation.horizonJours))
        .get() ?? null;

    const releveMeteoReelle =
      baseTx
        .select(COLONNES_RELEVE_METEO)
        .from(meteoObservation)
        .where(
          and(
            eq(meteoObservation.lieuId, session.lieuId),
            eq(meteoObservation.dateObservation, session.dateSession),
            eq(meteoObservation.type, 'reelle'),
          ),
        )
        .get() ?? null;

    // --- Ecritures ---------------------------------------------------------
    const maintenant = maintenantUtc();

    for (const vente of entree.ventes) {
      baseTx
        .insert(sessionVente)
        .values({
          id: nouvelIdentifiant(),
          sessionId,
          produitVenteId: vente.produitVenteId,
          quantite: vente.quantite,
          prixUnitaireCents: vente.prixUnitaireCents,
          montantCents: vente.quantite * vente.prixUnitaireCents,
          creneauHoraire: vente.creneauHoraire ?? null,
        })
        .run();
    }

    /**
     * Ventes RAMENÉES À LEURS COMPOSANTS pour les TROIS sorties de stock qui
     * suivent (Trou 2, audit du 30/07/2026) — JAMAIS les ventes BRUTES, où un
     * menu restait un bloc et son sirop inclus ne sortait jamais du stock.
     * `composantsMenusPourStock` (construit plus haut, en même temps que
     * `lignes`) porte déjà la quantité PHYSIQUE de chaque composant de menu,
     * avec le drapeau `consommationSurPlace` du conteneur qui l'a vendu.
     */
    const ventesNonMenu = entree.ventes.filter(
      (v) => parId.get(v.produitVenteId)!.nature !== 'menu',
    );
    const ventesPourRevenduEtGarnitures = [
      ...ventesNonMenu.map((v) => ({ produitVenteId: v.produitVenteId, quantite: v.quantite })),
      ...composantsMenusPourStock.map((c) => ({
        produitVenteId: c.produitVenteId,
        quantite: c.quantite,
      })),
    ];
    const ventesPourComposantsVente = [
      ...ventesNonMenu.map((v) => ({
        produitVenteId: v.produitVenteId,
        quantite: v.quantite,
        consommationSurPlace: parId.get(v.produitVenteId)!.consommationSurPlace,
      })),
      ...composantsMenusPourStock,
    ];

    const sortiesRevendu = sortirLesProduitsRevendus(baseTx, {
      sessionId,
      dateSession: session.dateSession,
      ventes: ventesPourRevenduEtGarnitures,
      produitsParId: parId,
      maintenant,
      creePar: entree.creePar ?? null,
    });

    /**
     * Les GARNITURES suivent exactement le meme chemin que les revendus.
     *
     * Une crepe consomme deux choses : une part de pate, sortie a la
     * PRODUCTION, et une garniture, etalee au SERVICE. Seule la premiere
     * sortait. La seconde ne bougeait jamais : son point de commande ne se
     * declenchait pas, son lot n'etait rattache a aucune session, et la marge
     * de la crepe ignorait sa part la plus variable — celle qui distingue une
     * crepe a 3,00 € d'une crepe a 3,50 €.
     *
     * Appele APRES les revendus, jamais avant : si un meme ingredient etait a
     * la fois revendu tel quel et etale, la FEFO doit servir d'abord la vente
     * de l'article ferme, dont la quantite est un DECOMPTE exact, avant la
     * garniture, dont la quantite est une estimation par unite vendue.
     */
    const sortiesGarnitures = sortirLesGarnitures(baseTx, {
      sessionId,
      dateSession: session.dateSession,
      ventes: ventesPourRevenduEtGarnitures,
      maintenant,
      creePar: entree.creePar ?? null,
    });

    /**
     * Composants de nomenclature de VENTE (fiche 15) : serviettes, gobelets,
     * assiettes, contenants, ingredients d'un cafe fait a la tasse.
     *
     * Sortis EN DERNIER des trois, et c'est voulu : c'est l'estimation la moins
     * exacte. Un revendu est un DECOMPTE, une garniture une quantite exacte par
     * unite vendue, un composant un RATIO de lot de reference agrege sur toute
     * la session. La FEFO doit donc servir d'abord ce qui est certain.
     */
    const sortiesComposants = sortirLesComposantsVente(baseTx, {
      sessionId,
      dateSession: session.dateSession,
      ventes: ventesPourComposantsVente,
      maintenant,
      creePar: entree.creePar ?? null,
    });

    // Les trois listes se concatenent telles quelles : un ecart de garniture se
    // solde par le meme geste d'inventaire qu'un ecart de revendu, et rien ne
    // justifierait de les presenter separement a l'utilisateur.
    const ecartsStock = [
      ...sortiesRevendu.ecarts,
      ...sortiesGarnitures.ecarts,
      ...sortiesComposants.ecarts,
    ];

    /**
     * Partage du cout de production REEL (`coutProductionsCents`, deja connu,
     * deja paye) entre la pate qui a cuit des crepes et celle vendue
     * DIRECTEMENT au volume (bouteille, pot — fiche 15 §5.1, mission « la
     * pate vendue au volume n'est jamais deduite du stock »).
     *
     * AUCUNE SORTIE DE STOCK SUPPLEMENTAIRE ICI, ET C'EST VOULU : une
     * production a deja sorti farine, lait et oeufs du stock UNE SEULE FOIS,
     * a la production (`sortie_production`, ailleurs). Vendre une part de
     * cette pate telle quelle ne fait sortir AUCUN ingredient de plus — ce
     * serait les compter deux fois. Cette fonction ne fait que PARTAGER un
     * cout deja constate, jamais en creer un nouveau (voir sa doc complete,
     * `packages/core/src/sessions.ts`).
     *
     * Independant du MODE de cloture (crepes ou volume restant mesure) :
     * `volumePateVendueDirectementTotalMl` et `volumeProduitTotalMl` sont
     * tous deux calcules plus haut SANS dependre de `resoudreCrepesProduites`
     * — une vente de pate au volume pese sur le cout matiere de la session
     * que la cloture compte des crepes ou mesure le bac.
     */
    const repartitionPate = repartirCoutProductionEntrePateVendueEtCrepes({
      coutProductionsCents,
      volumeProduitMl: volumeProduitTotalMl,
      volumePateVendueDirectementMl: volumePateVendueDirectementTotalMl,
    });
    const coutPateVendueDirectementCents = repartitionPate.coutPateVendueDirectementCents;

    /**
     * Cout matiere de la session = productions rattachees + marchandises
     * revendues + garnitures, toutes trois sorties du stock.
     *
     * La rentabilite se calcule APRES les sorties de stock, et non avant :
     * c'est la sortie FEFO qui donne le cout d'achat REEL, lot par lot. Le
     * calculer avant obligerait a le reconstituer depuis un prix moyen,
     * c'est-a-dire a inventer un chiffre qu'on possede deja exactement.
     *
     * Le TOTAL reste une seule colonne persistee (`cout_matiere_cents`) : la
     * marge de session ne distingue pas d'ou vient le CA. Mais `calculerRentabilite`
     * a besoin de la matiere du TRANSFORME (production + garnitures) SEULE
     * pour ses ratios « par crepe » — le cout d'achat d'un pot de sirop revendu
     * n'a rien a voir avec une crepe (docs/17 fiche 12).
     *
     * `repartitionPate.coutMatiereTransformeRestantCents` REMPLACE
     * `coutProductionsCents` brut (utilise avant cette mission) : la part
     * prelevee pour la pate vendue directement n'a cuit aucune crepe, elle
     * n'a donc rien a faire dans un panier divise par des crepes vendues.
     * Sur une session qui ne vend AUCUNE pate au volume, cette part vaut 0 et
     * ce panier retombe EXACTEMENT sur `coutProductionsCents` (0 regression).
     */
    const coutMatiereTransformeCents =
      repartitionPate.coutMatiereTransformeRestantCents + sortiesGarnitures.coutGarnituresCents;

    /**
     * Avertissement : marge brute a 100 % sans que rien ne le signale (audit
     * du 30/07/2026) — voir `construireAvertissementCoutMatiereTransforme` et
     * `coutMatiereTransformeSuspect` (`@batte/core`) pour le seuil de
     * declenchement, justifie en detail. Calcule ICI, avant `calculerRentabilite`,
     * pour ne rien changer a l'ordre des ecritures ni aux montants qu'elle
     * produit : cet avertissement ne fait que LIRE `coutMatiereTransformeCents`,
     * `sortiesComposants.coutComposantsCents` et `coutPateVendueDirectementCents`
     * (deja calcules ci-dessus), jamais les modifier.
     */
    const avertissementCoutMatiereTransforme = construireAvertissementCoutMatiereTransforme(
      baseTx,
      totaux,
      coutMatiereTransformeCents,
      sortiesComposants.coutComposantsCents,
      coutPateVendueDirectementCents,
      lignes,
      parId,
    );

    /**
     * Les composants ont leur PROPRE panier, distinct des marchandises
     * revendues : un composant n'est pas un article revendu tel quel (meme
     * raisonnement que la garniture, D-053), et le cout d'achat d'un pot de
     * sirop revendu n'a rien a voir avec celui d'un gobelet en carton. Les
     * confondre sous un seul nom de variable fausserait la lecture du panier
     * « marchandises revendues » le jour ou il est affiche pour lui-meme.
     *
     * `coutPateVendueDirectementCents` (fiche 15 §5.1) rejoint lui aussi ce
     * total : c'est une part du MEME cout de production deja compte, jamais
     * un cout ajoute (voir `repartitionPate` ci-dessus) — l'ajouter ici ne
     * fait donc PAS grossir `coutMatiereCents` par rapport a l'ancien calcul,
     * il en deplace seulement une part depuis `coutMatiereTransformeCents`.
     *
     * Les paniers rejoignent tous le meme total (`coutMatiereCents`) et sont
     * pareillement exclus des ratios « par crepe » de `calculerRentabilite` :
     * aucun n'est forcement lie a une crepe.
     */
    const coutMatiereCents =
      coutMatiereTransformeCents +
      sortiesRevendu.coutRevenduCents +
      sortiesComposants.coutComposantsCents +
      coutPateVendueDirectementCents;

    const rentabilite = calculerRentabilite({
      totaux,
      coutMatiereTransformeCents,
      coutMarchandisesRevenduesCents: sortiesRevendu.coutRevenduCents,
      coutComposantsVenteCents: sortiesComposants.coutComposantsCents,
      coutPateVendueDirectementCents,
      frais: {
        emplacementCents: entree.frais.emplacementCents,
        deplacementCents: entree.frais.deplacementCents,
        gazCents: entree.frais.gazCents,
        diversCents: entree.frais.diversCents,
        // Fiche 17, cas 3 seulement (facturation au compteur) — voir
        // `resolutionEnergie` plus haut : TOUJOURS un entier connu, jamais
        // devine (0 par prudence quand la donnee manque, `avertissementEnergie`
        // le signale a l'appelant dans le `return` de cette fonction).
        energieCents: resolutionEnergie.montantCents,
      },
      caCarteCents: entree.caCarteCents,
      tauxCommissionCarteBp,
      production: {
        crepesProduites,
        crepesVendues: totaux.crepesVendues,
        crepesInvendues: entree.crepesInvendues,
        crepesCassees: entree.crepesCassees,
      },
      dureeMinutes: dureeMinutes(entree.heureDebutReelle ?? null, entree.heureFinReelle ?? null),
      nbTickets: entree.nbTickets ?? null,
    });

    baseTx
      .update(sessionMarche)
      .set({
        statut: 'cloturee',
        dateCloture: maintenant,
        heureDebutReelle: entree.heureDebutReelle ?? null,
        heureFinReelle: entree.heureFinReelle ?? null,
        exclureDuModele: entree.exclureDuModele ?? false,
        motifExclusion: entree.motifExclusion ?? null,

        // Météo FIGÉE (voir le raisonnement complet au point de calcul
        // ci-dessus) : `null` quand aucun relevé exploitable n'existait pour
        // ce lieu et cette date — jamais une valeur inventée.
        meteoPrevue: releveMeteoPrevue,
        meteoReelle: releveMeteoReelle,

        fondsCaisseInitialCents: entree.fondsCaisseInitialCents,
        especesCompteesCents: entree.especesCompteesCents,
        caCarteCents: caisse.caCarteCents,
        caEspecesCents: caisse.caEspecesCents,
        ecartCaisseCents: caisse.ecartCaisseCents,

        caTotalCents: totaux.caTotalCents,
        caTransformeCents: totaux.caTransformeCents,
        caRevenduCents: totaux.caRevenduCents,
        caSurPlaceCents: totaux.caSurPlaceCents,
        // La colonne `nb_transactions` compte des TICKETS : elle reste nulle
        // tant qu'ils ne sont pas saisis. Y mettre le nombre d'articles
        // faisait passer un prix par article pour un panier moyen.
        nbTransactions: entree.nbTickets ?? null,

        coutMatiereCents,
        commissionCarteCents: rentabilite.commissionCarteCents,
        fraisEmplacementCents: entree.frais.emplacementCents,
        fraisDeplacementCents: entree.frais.deplacementCents,
        fraisGazCents: entree.frais.gazCents,
        fraisDiversCents: entree.frais.diversCents,

        // Mesure REELLE, distincte du forfait ci-dessus (D-064) : `null` tant
        // que non renseignee, jamais 0 — voir la doc de `EntreeCloture`.
        distanceReelleKm: entree.distanceReelleKm ?? null,

        // Imputation FIGEE de la tournee reelle (D-064 point 4, voir le
        // raisonnement complet plus haut) : les trois colonnes miroir de
        // `coutMatiereTheoriqueCents` / `coutMatiereReelCents` (migration
        // 0027) — jamais recalculees a la lecture. `null` = pas calculable
        // (distance reelle non saisie, ou distance de reference du lieu
        // inconnue), JAMAIS 0.
        coutDeplacementReelSessionCents: imputationDeplacement.coutSessionCents,
        coutDeplacementReelDetourAchatsCents: imputationDeplacement.coutDetourAchatsCents,
        coutDeplacementReelTotalCents: imputationDeplacement.coutTotalReelCents,

        crepesProduites,
        modeCloture,
        volumeRestantMesureMl,
        crepesVendues: totaux.crepesVendues,
        crepesInvendues: entree.crepesInvendues,
        crepesCassees: entree.crepesCassees,

        margeBruteCents: rentabilite.margeBruteCents,
        margeNetteCents: rentabilite.margeNetteCents,
        notesQualitatives: entree.notesQualitatives ?? null,
        modifieLe: maintenant,
      })
      .where(eq(sessionMarche.id, sessionId))
      .run();

    // Frais detailles, en complement des postes agreges. `energie` (fiche 17)
    // suit EXACTEMENT la meme regle que les quatre autres : une categorie a 0
    // n'ecrit aucune ligne — que ce 0 soit un ZERO CERTAIN (aucune electricite
    // sur ce lieu, ou deja comptee dans l'emplacement/le forfait) ou un zero
    // par EXCLUSION (donnee manquante, `resolutionEnergie.raisonExclusion`
    // porte alors l'explication, exposee a l'appelant via `avertissementEnergie`
    // dans le `return` ci-dessous — jamais persistee ici).
    //
    // JUSTIFICATIF (mission « justificatif d'un frais de session »,
    // 30/07/2026) : `justificatifPath` valait `null` EN DUR, quelle que soit
    // la saisie — la colonne existait, mais aucun chemin ne pouvait jamais
    // l'atteindre. Chaque catégorie SAISIE (pas `energie`, voir la doc de
    // `FraisSaisis`) porte désormais SON PROPRE justificatif, validé par
    // `validerPieceJointe` — MÊME contrôle (format Data URI, plafond de
    // taille, chaîne vide -> `null`) qu'une pièce jointe de facture ou de
    // réception. Une categorie a 0 continue de ne rien ecrire : un
    // justificatif SANS montant n'a aucune ligne ou l'attacher.
    for (const [categorie, montant, justificatifBrut] of [
      ['emplacement', entree.frais.emplacementCents, entree.frais.emplacementJustificatifPath],
      ['deplacement', entree.frais.deplacementCents, entree.frais.deplacementJustificatifPath],
      ['gaz', entree.frais.gazCents, entree.frais.gazJustificatifPath],
      ['divers', entree.frais.diversCents, entree.frais.diversJustificatifPath],
      // `energie` : poste CALCULÉ, jamais une dépense avec un ticket à joindre.
      ['energie', resolutionEnergie.montantCents, null],
    ] as const) {
      if (montant === 0) continue;
      baseTx
        .insert(sessionFrais)
        .values({
          id: nouvelIdentifiant(),
          sessionId,
          libelle: categorie,
          categorie,
          montantCents: montant,
          justificatifPath: validerPieceJointe(justificatifBrut ?? null),
        })
        .run();
    }

    /**
     * Températures (docs/17 fiche 17) : « un registre qu'on remplit ailleurs
     * est un registre qu'on ne remplit pas » (docs/06 §3). Rattachées à CETTE
     * session (`sessionId`), pas seulement à une date, et écrites dans la
     * MÊME transaction que le reste de la clôture — soit les deux passent,
     * soit aucune. Réutilise le cœur PARTAGÉ avec la saisie autonome de
     * `afsca.ts` (fiche 15) : un relevé hors seuil ouvre automatiquement sa
     * non-conformité, ici comme là, sans code dupliqué.
     *
     * **Optionnel et jamais reconstitué** : une session sans relevé saisi
     * n'en gagne aucun — CLAUDE.md §7 interdit de fabriquer un registre a
     * posteriori. Un relevé hors seuil SANS action corrective fait échouer la
     * clôture ENTIÈRE (même règle que pour la saisie autonome) : c'est le prix
     * du choix de le saisir ici plutôt que de le laisser manquant.
     */
    for (const releve of entree.relevesTemperature ?? []) {
      ecrireReleveTemperature(baseTx, {
        sessionId,
        equipement: releve.equipement,
        temperatureC: releve.temperatureC,
        dateReleve: session.dateSession,
        moment: releve.moment,
        actionCorrective: releve.actionCorrective ?? null,
      });
    }

    /**
     * Rapproche la prevision de cette session de son REALISE.
     *
     * Dans la transaction : le rapprochement fait partie de la cloture, pas
     * d'un traitement posterieur qui pourrait echouer seul et laisser une
     * prevision orpheline.
     *
     * `rapprocherPrevision` existait, testee, et n'etait appelee NULLE PART.
     * Consequence en chaine : `prevision.crepes_reelles` restait `NULL`,
     * `qualiteModele()` filtre sur `IS NOT NULL` et ne rendait donc jamais une
     * ligne, et l'ecran « Qualite du modele » etait vide **a vie**. Le produit
     * mesurait la justesse de ses previsions avec un instrument qu'aucune
     * donnee n'atteignait.
     *
     * Une session exclue du modele est rapprochee quand meme : l'ecart est un
     * fait, et le savoir vaut mieux que l'ignorer. C'est l'AGREGAT de qualite
     * qui doit l'ecarter, pas la mesure.
     */
    rapprocherPrevision(baseTx, sessionId, totaux.crepesVendues);

    /**
     * Utilisation des équipements électriques (fiche 17), saisie ICI et nulle
     * part ailleurs : le porteur situe ce relevé au moment de la clôture, et
     * créer un second chemin d'écriture pour la même donnée aurait dupliqué la
     * vérité. **Optionnel** : un lieu sans électricité n'en fournit aucune,
     * et rien ne doit être écrit dans ce cas.
     */
    for (const utilisation of entree.equipementsUtilises ?? []) {
      enregistrerUtilisationEquipement(baseTx, {
        sessionId,
        equipementId: utilisation.equipementId,
        dureeMinutes: utilisation.dureeMinutes,
      });
    }

    return {
      ecartsStock,
      resolutionVolume,
      imputationDeplacement,
      avertissementEnergie: resolutionEnergie.raisonExclusion,
      avertissementCoutMatiereTransforme,
    };
  });
}

/**
 * Sort du stock les produits REVENDUS d'une session (sirop, confiture…).
 *
 * Sans cette sortie, le type de mouvement `sortie_vente` restait declare au
 * schema et jamais emis : un pot vendu restait eternellement en stock, le
 * reapprovisionnement ne le proposait jamais, et la valeur du stock etait
 * surevaluee. Les produits TRANSFORMES ne passent pas par ici : leur matiere
 * est deja sortie a la production.
 *
 * **Ne bloque JAMAIS la cloture.** Si le stock enregistre est insuffisant,
 * c'est le stock qui a tort, pas la vente : on sort ce qui est tracable et on
 * remonte l'ecart. Inventer un lot pour couvrir le manquant fabriquerait une
 * tracabilite fausse — exactement ce que l'AFSCA interdit.
 *
 * `ventes` prend ICI un produit + une quantite, jamais `LigneVenteSaisie`
 * complet (prix, creneau) : ce dont cette fonction a reellement besoin, ni
 * plus. Depuis le Trou 2 (audit du 30/07/2026), l'appelant y fait figurer les
 * composants EXPLOSES d'un menu (le sirop d'un menu, jamais vendu en tant que
 * tel ci-dessus) a la place du menu-conteneur lui-meme.
 */
function sortirLesProduitsRevendus(
  baseTx: BaseBatte,
  contexte: {
    sessionId: string;
    dateSession: string;
    ventes: readonly { produitVenteId: string; quantite: number }[];
    produitsParId: ReadonlyMap<string, typeof produitVente.$inferSelect>;
    maintenant: string;
    creePar: string | null;
  },
): { ecarts: EcartStockVente[]; coutRevenduCents: number } {
  // Un meme ingredient peut etre vendu par plusieurs lignes : on cumule avant
  // de repartir, sinon la FEFO serait appliquee plusieurs fois de suite sur des
  // etats intermediaires et l'ordre des lignes changerait le resultat.
  const quantiteParIngredient = new Map<string, number>();
  for (const vente of contexte.ventes) {
    const produit = contexte.produitsParId.get(vente.produitVenteId);
    if (produit === undefined || produit.nature !== 'revendu') continue;
    if (produit.ingredientId === null) continue;
    quantiteParIngredient.set(
      produit.ingredientId,
      (quantiteParIngredient.get(produit.ingredientId) ?? 0) + vente.quantite,
    );
  }

  const ecarts: EcartStockVente[] = [];
  // Cout d'achat REEL des marchandises sorties, valorise au lot effectivement
  // consomme. Il etait calcule au centime pres puis jete : la marge d'une
  // session ne retenait que le cout des PRODUCTIONS. Sur une session ou la
  // moitie du CA vient de la revente, la marge brute s'affichait a 95 % — soit
  // exactement l'illusion que CLAUDE.md §6 demande de dissiper.
  let coutRevenduCents = 0;

  for (const [ingredientId, quantite] of quantiteParIngredient) {
    const lots = lotsDeLIngredient(baseTx, ingredientId);
    // `autoriserDlcDepassee` : la vente a EU LIEU. Refuser de la sortir parce
    // qu'un lot est perime ne la ferait pas disparaitre, ca laisserait juste le
    // stock faux.
    const repartition = repartirFefo(lots, quantite, contexte.dateSession, {
      autoriserDlcDepassee: true,
    });

    for (const allocation of repartition.allocations) {
      coutRevenduCents += allocation.coutCents;
      baseTx
        .insert(mouvementStock)
        .values({
          id: nouvelIdentifiant(),
          lotId: allocation.lotId,
          ingredientId,
          type: 'sortie_vente',
          quantite: allocation.quantite,
          dateMouvement: contexte.dateSession,
          valuationDate: contexte.dateSession,
          ajustement: false,
          productionId: null,
          sessionId: contexte.sessionId,
          // Pas de motif : une vente n'est pas un ecart a expliquer, c'est la
          // raison d'etre du stock. Le type du mouvement suffit.
          motifId: null,
          motifTexte: null,
          coutCents: allocation.coutCents,
          isAnnule: false,
          annuleParId: null,
          creePar: contexte.creePar,
          creeLe: contexte.maintenant,
        })
        .run();
    }

    if (repartition.quantiteManquante > 0) {
      const ing = baseTx
        .select({ nom: ingredient.nom })
        .from(ingredient)
        .where(eq(ingredient.id, ingredientId))
        .get();

      ecarts.push({
        ingredientId,
        nomIngredient: ing?.nom ?? ingredientId,
        quantiteManquante: repartition.quantiteManquante,
      });
    }
  }

  return { ecarts, coutRevenduCents };
}

/**
 * Annule une session close.
 *
 * Ne supprime rien : la session passe en `annulee` et ses lignes restent
 * lisibles. C'est le seul chemin de correction d'une piece comptable
 * (« rien ne s'efface »).
 *
 * CONTREPASSE aussi tout mouvement `sortie_vente` que CETTE session a ecrit a
 * sa cloture (revendus D-037, garnitures D-053, composants de vente) — meme
 * mecanisme que `annulerMouvement` (`services/mouvements.ts`), reecrit ici en
 * ligne plutot qu'appele : aucune transaction imbriquee n'existe ailleurs
 * dans ce depot, et `annulerMouvement` ouvre la sienne.
 *
 * SANS CETTE CONTREPASSATION, annuler une session cloturee n'a AUCUN effet
 * sur le stock : `depots/stock.ts` (`SQL_RESTANT`) somme TOUS les mouvements,
 * annules ou non — `is_annule` ne sert qu'a l'AFFICHAGE (D-021), jamais au
 * calcul. Le chiffre d'affaires, lui, s'exclut deja des seuils et de la
 * synthese d'exercice par un simple filtre `statut = 'cloturee'` (docs/16) :
 * mais le stock n'a pas d'equivalent « exclusion par statut », la SEULE
 * facon d'en changer la valeur est une ecriture inverse. Sans elle, une
 * session cloturee par erreur puis annulee laissait la matiere
 * DEFINITIVEMENT sortie du stock alors que la vente qui l'avait justifiee ne
 * comptait plus nulle part — un cas ou le CA disparait mais la matiere, elle,
 * ne revient jamais, faussant reapprovisionnement et valorisation pour
 * toujours.
 *
 * Ne touche jamais les mouvements `sortie_production` : une production
 * rattachee a une session a son PROPRE statut (`services/production.ts`,
 * hors zone) et sa propre annulation. La farine reellement petrie ne revient
 * pas au stock au seul motif que la session qui devait l'ecouler est annulee.
 */
export function annulerSession(
  base: BaseBatte,
  sessionId: string,
  motifAnnulation: string,
  creePar?: string | null,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const session = baseTx
      .select()
      .from(sessionMarche)
      .where(eq(sessionMarche.id, sessionId))
      .get();
    if (session === undefined) throw new ErreurIntrouvable('Session', sessionId);

    // Verrou de periode (docs/07 §1.6, CLAUDE.md §3 regle 7) : DEFAUT TROUVE A
    // L'AUDIT (30/07/2026) — `cloturerSession` verifie deja ce verrou sur
    // `session.dateSession` (voir son commentaire plus haut), mais
    // `annulerSession` ne le verifiait PAS du tout. Une session datee dans un
    // exercice deja transmis au comptable pouvait donc etre annulee apres
    // coup — statut, contrepassation de stock et exclusion du modele
    // compris — alors que la meme date refusait deja toute CLOTURE. Verifiee
    // sur `session.dateSession` (la date METIER, jamais aujourd'hui) : c'est
    // elle qui a determine si la cloture d'origine a pu s'ecrire, donc c'est
    // elle qui doit determiner si son annulation le peut encore.
    verifierPeriodeNonVerrouillee(baseTx, session.dateSession);

    if (session.statut === 'annulee') {
      throw new ErreurMetier('session_deja_annulee', 'Cette session est déjà annulée.');
    }
    const motifPropre = motifAnnulation.trim();
    if (motifPropre === '') {
      throw new ErreurMetier(
        'motif_obligatoire',
        "L'annulation d'une session exige un motif : c'est lui qui rend la correction auditable.",
        { champs: { motif: 'Indiquez pourquoi cette session est annulée.' } },
      );
    }

    const maintenant = maintenantUtc();

    // --- Contrepassation du stock ------------------------------------------
    const mouvementsAContrepasser = baseTx
      .select()
      .from(mouvementStock)
      .where(
        and(
          eq(mouvementStock.sessionId, sessionId),
          // Uniquement les sorties ecrites PAR la cloture elle-meme (revendus,
          // garnitures, composants) : jamais `sortie_production`, voir l'en-tete.
          eq(mouvementStock.type, 'sortie_vente'),
          eq(mouvementStock.isAnnule, false),
        ),
      )
      .all();

    if (mouvementsAContrepasser.length > 0) {
      const motifCorrection = baseTx
        .select({ id: motif.id })
        .from(motif)
        .where(eq(motif.code, 'ERREUR_SAISIE'))
        .get();
      if (motifCorrection === undefined) {
        throw new ErreurMetier(
          'motif_inconnu',
          "Le motif « ERREUR_SAISIE » n'existe pas. Lancez « npm run db:seed » pour charger le catalogue.",
          { statut: 500 },
        );
      }

      for (const origine of mouvementsAContrepasser) {
        const idContrepassation = nouvelIdentifiant();

        // Meme forme que `annulerMouvement` : type INVERSE, MEME date que
        // l'original (les cumuls d'un jour de marche deja passe ne bougent
        // pas), ecriture d'ajustement.
        baseTx
          .insert(mouvementStock)
          .values({
            id: idContrepassation,
            lotId: origine.lotId,
            ingredientId: origine.ingredientId,
            type: origine.type === 'entree' ? 'ajustement_inventaire' : 'entree',
            quantite: origine.quantite,
            dateMouvement: origine.dateMouvement,
            valuationDate: origine.valuationDate,
            ajustement: true,
            productionId: origine.productionId,
            sessionId: origine.sessionId,
            motifId: motifCorrection.id,
            motifTexte: `Contrepassation pour annulation de la session ${session.numero} : ${motifPropre}`,
            coutCents: origine.coutCents,
            isAnnule: false,
            annuleParId: null,
            creePar: creePar ?? null,
            creeLe: maintenant,
          })
          .run();

        const apres = baseTx
          .update(mouvementStock)
          .set({ isAnnule: true, annuleParId: idContrepassation })
          .where(eq(mouvementStock.id, origine.id))
          .returning()
          .get();

        journaliser(baseTx, {
          table: 'mouvement_stock',
          enregistrementId: origine.id,
          action: 'annulation',
          valeurAvant: origine,
          valeurApres: apres,
          parQui: creePar ?? null,
        });
      }
    }

    baseTx
      .update(sessionMarche)
      .set({
        statut: 'annulee',
        motifExclusion: motifAnnulation,
        // Une session annulee ne doit jamais peser dans le modele de prevision :
        // « ne pas polluer le modele avec des zeros non representatifs » (docs/03).
        exclureDuModele: true,
        modifieLe: maintenant,
      })
      .where(eq(sessionMarche.id, sessionId))
      .run();
  });
}
