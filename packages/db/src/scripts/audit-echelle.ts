/**
 * Script de mesure HORS SUITE : « l'application tient-elle avec trois ans de
 * données ? ».
 *
 * CE QUE CE FICHIER FAIT
 * -----------------------
 * 1. Fabrique deux bases SQLite TEMPORAIRES (fichier, jamais `donnees/batte.sqlite`)
 *    remplies via la VRAIE chaîne de services (`enregistrerReception`,
 *    `lancerProduction`, `saisirRealise`, `cloturerSession`) — jamais par des
 *    `INSERT` bruts sur les tables de mouvement, exactement la précaution déjà
 *    prise par `seed/activite.ts` : une graine qui insère ses lignes à la main
 *    peut fabriquer un état que l'application est incapable de produire.
 *      - un scénario CONSERVATEUR : un seul lieu (La Batte), une session par
 *        semaine, 3 ans ≈ 150 sessions (CLAUDE.md §6 : « trois ans, c'est de
 *        l'ordre de 150 sessions »).
 *      - un scénario AMBITIEUX : le porteur veut « grossir le plus possible,
 *        le plus rapidement et solidement possible » (consigne explicite de
 *        cet audit). Deux marchés hebdomadaires distincts (La Batte + un
 *        second marché) plutôt qu'un seul, un marché de Noël dédié (20 jours
 *        par décembre, 3 décembres pleins), et des événements ponctuels
 *        (foires, fêtes locales) à La Batte. Détail et total dans
 *        `SCENARIO_AMBITIEUX` ci-dessous.
 * 2. Chronomètre, à l'état « vide » (référentiel de démonstration seul, une
 *    session) puis à l'échelle 3 ans (conservateur et ambitieux), les lectures
 *    désignées par l'audit : état du stock, tableau de bord (assemblage),
 *    synthèse d'exercice, traçabilité amont d'une session récente, traçabilité
 *    aval d'un lot qui a vécu toute la période, registre AFSCA mensuel
 *    (assemblage), moteur de prévision (coût de la validation croisée
 *    leave-one-out), `npm run backtest` réel, et l'écran Journal d'audit SANS
 *    filtre (`GET /api/audit`, qui ne pose aucune borne SQL — voir
 *    `apps/api/src/routes/audit.ts:136`).
 * 3. Nettoie ses fichiers temporaires en fin d'exécution, y compris en cas
 *    d'erreur.
 *
 * POURQUOI CE N'EST PAS UN TEST VITEST NORMAL
 * --------------------------------------------
 * Fabriquer ~150 puis ~390 sessions par la VRAIE chaîne de services (chacune :
 * une réception, une production, une saisie de réalisé, une clôture — donc
 * plusieurs transactions SQLite committées séparément) prend de l'ordre de la
 * dizaine de secondes, largement au-delà du coût d'un test unitaire et
 * suffisant pour doubler la durée de la suite complète (~1 minute aujourd'hui,
 * voir CLAUDE.md et la contrainte explicite de cet audit : « on ne veut pas la
 * doubler »). Ce script n'est donc PAS enregistré dans `vitest.config`/`npm
 * test` : c'est un outil manuel, au même titre que
 * `packages/db/src/scripts/backtest.ts`, lancé à la demande :
 *
 *   npx tsx packages/db/src/scripts/audit-echelle.ts
 *
 * LECTURE SEULE SUR LA VRAIE BASE
 * --------------------------------
 * Aucune ligne de ce fichier n'ouvre `donnees/batte.sqlite` ni n'importe
 * `config.cheminBase` pour écrire : chaque base est un fichier neuf sous le
 * dossier temporaire du système, créé par `mkdtempSync`, supprimé à la fin.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import {
  ajouterJours,
  calculerBaseline,
  jourCivilBelge,
  maintenantUtc,
  mettreAEchelle,
  nouvelIdentifiant,
  validerParLeaveOneOut,
  type Estimateur,
  type ObservationSession,
  type Parametres,
} from '@batte/core';
import { creerBase, fermerBase, sqliteBrut, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { estModulePrincipal } from '../module-principal.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import {
  evenement,
  fournisseur,
  ingredient,
  lieuMarche,
  produitVente,
  recette,
} from '../schema.js';
import { enregistrerReception } from '../services/reception.js';
import { lancerProduction, saisirRealise } from '../services/production.js';
import { creerSession, cloturerSession } from '../services/sessions.js';
import { chargerRecettePourCalcul, garnituresDuProduit } from '../depots/recettes.js';
import { journaliser, listerJournalAudit } from '../depots/audit.js';
import { etatDuStock } from '../depots/stock.js';
import { tracabiliteAmontSession, tracabiliteAvalLot } from '../depots/tracabilite.js';
import { listerEcheances, syntheseExercice } from '../depots/comptabilite.js';
import { listerSessions, tableauSeuils } from '../depots/sessions.js';
import { lireParametres } from '../depots/parametres.js';
import { coutsNewsvendor, observationsDuLieu } from '../depots/previsions.js';
import {
  executionsNettoyagePeriode,
  listerExercicesTracabilite,
  listerNonConformites,
  nonConformitesPeriode,
  relevesTemperaturePeriode,
  sessionsSansReleveTemperature,
  tachesEnRetard,
} from '../services/afsca.js';
import { executerBacktest } from './backtest.js';

/* ═══════════════════════════════════════════════════════════════════════════
   0. Chronométrage
   ═══════════════════════════════════════════════════════════════════════════ */

type Mesure = { readonly label: string; readonly ms: number };

function chrono<T>(label: string, fn: () => T): { valeur: T; mesure: Mesure } {
  const debut = performance.now();
  const valeur = fn();
  const ms = performance.now() - debut;
  return { valeur, mesure: { label, ms } };
}

/** Additionne plusieurs mesures déjà prises, sous un label composite. */
function sommerMesures(label: string, mesures: readonly Mesure[]): Mesure {
  return { label, ms: mesures.reduce((total, m) => total + m.ms, 0) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Base temporaire
   ═══════════════════════════════════════════════════════════════════════════ */

function creerBaseTemporaire(nomFichier: string): {
  base: BaseBatte;
  cheminDossier: string;
  fermer: () => void;
} {
  const cheminDossier = mkdtempSync(join(tmpdir(), 'batte-audit-echelle-'));
  const cheminFichier = join(cheminDossier, nomFichier);
  const base = creerBase(cheminFichier);
  // Base JETABLE, utilisée uniquement pour cette mesure : la durabilité des
  // écritures n'a aucune valeur ici, et NORMAL évite l'attente d'un fsync par
  // transaction pendant la fabrication de centaines de sessions. Sans effet
  // sur les LECTURES chronométrées ensuite (ce pragma ne change que le coût
  // d'écriture, jamais le plan de requête ni le coût de lecture).
  sqliteBrut(base).pragma('synchronous = NORMAL');
  migrer(base);
  seed(base);
  seedDemonstration(base);
  return {
    base,
    cheminDossier,
    // `fermerBase` REPLIE le journal WAL et ferme le handle AVANT de supprimer
    // le dossier : sur Windows, `rmSync` échoue (EPERM) sur un fichier encore
    // ouvert par better-sqlite3.
    fermer: () => {
      fermerBase(base);
      rmSync(cheminDossier, { recursive: true, force: true });
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Référentiel : identifiants dont le générateur d'activité a besoin
   ═══════════════════════════════════════════════════════════════════════════ */

type Referentiel = {
  readonly fournisseurGrossisteId: string;
  readonly fournisseurTerroirId: string;
  readonly recetteR1Id: string;
  readonly ingredients: {
    readonly farine: string;
    readonly lait: string;
    readonly oeufs: string;
    readonly beurre: string;
    readonly vergeoise: string;
    readonly sel: string;
    readonly sucreVanille: string;
    readonly eauFleurOranger: string;
    readonly siropPot: string;
    readonly siropVrac: string;
  };
  readonly produits: {
    readonly crepeCassonade: string;
    readonly crepeSirop: string;
    readonly siropPotVente: string;
  };
};

function idIngredientParNom(base: BaseBatte, nom: string): string {
  const ligne = base
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(eq(ingredient.nom, nom))
    .get();
  if (ligne === undefined)
    throw new Error(`Ingrédient introuvable dans le référentiel : « ${nom} ».`);
  return ligne.id;
}

function idProduitParNom(base: BaseBatte, nom: string): string {
  const ligne = base
    .select({ id: produitVente.id })
    .from(produitVente)
    .where(eq(produitVente.nom, nom))
    .get();
  if (ligne === undefined)
    throw new Error(`Produit vendu introuvable dans le référentiel : « ${nom} ».`);
  return ligne.id;
}

function idFournisseurParNom(base: BaseBatte, nom: string): string {
  const ligne = base
    .select({ id: fournisseur.id })
    .from(fournisseur)
    .where(eq(fournisseur.nom, nom))
    .get();
  if (ligne === undefined)
    throw new Error(`Fournisseur introuvable dans le référentiel : « ${nom} ».`);
  return ligne.id;
}

function idLieuParNom(base: BaseBatte, nom: string): string {
  const ligne = base
    .select({ id: lieuMarche.id })
    .from(lieuMarche)
    .where(eq(lieuMarche.nom, nom))
    .get();
  if (ligne === undefined) throw new Error(`Lieu introuvable dans le référentiel : « ${nom} ».`);
  return ligne.id;
}

function chargerReferentiel(base: BaseBatte): Referentiel {
  const idIngredient = (nom: string): string => idIngredientParNom(base, nom);
  const idProduit = (nom: string): string => idProduitParNom(base, nom);
  const idFournisseur = (nom: string): string => idFournisseurParNom(base, nom);

  const r1 = base
    .select({ id: recette.id })
    .from(recette)
    .where(and(eq(recette.code, 'R1'), eq(recette.version, 1)))
    .get();
  if (r1 === undefined) throw new Error('Recette R1 v1 introuvable dans le référentiel démo.');

  return {
    fournisseurGrossisteId: idFournisseur('[démo] Fournisseur générique'),
    fournisseurTerroirId: idFournisseur('[démo] Producteur local (terroir)'),
    recetteR1Id: r1.id,
    ingredients: {
      farine: idIngredient('Farine de froment T55'),
      lait: idIngredient('Lait entier'),
      oeufs: idIngredient('Œufs entiers'),
      beurre: idIngredient('Beurre'),
      vergeoise: idIngredient('Vergeoise blonde'),
      sel: idIngredient('Sel fin'),
      sucreVanille: idIngredient('Sucre vanillé'),
      eauFleurOranger: idIngredient("Eau de fleur d'oranger"),
      siropPot: idIngredient('Sirop de Liège (pot 450 g)'),
      siropVrac: idIngredient('Sirop de Liège en vrac (seau 2,5 kg)'),
    },
    produits: {
      crepeCassonade: idProduit('[démo] Crêpe froment / cassonade'),
      crepeSirop: idProduit('[démo] Crêpe froment / Sirop de Liège'),
      siropPotVente: idProduit('[démo] Sirop de Liège — pot 450 g'),
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Calendrier des sessions
   ═══════════════════════════════════════════════════════════════════════════ */

type SessionPlan = {
  readonly lieuId: string;
  readonly dateSession: string;
  /** Crêpes VENDUES visées (avant invendues/cassées). */
  readonly crepesVendues: number;
};

/** Jours civils `AAAA-MM-JJ` correspondant à un jour de semaine donné, entre deux bornes incluses. */
function joursDeSemaineEntre(dateDebut: string, dateFin: string, jourSemaine: number): string[] {
  const dates: string[] = [];
  const curseur = new Date(`${dateDebut}T12:00:00Z`);
  const fin = new Date(`${dateFin}T12:00:00Z`);
  const ecart = (jourSemaine - curseur.getUTCDay() + 7) % 7;
  curseur.setUTCDate(curseur.getUTCDate() + ecart);
  while (curseur.getTime() <= fin.getTime()) {
    dates.push(curseur.toISOString().slice(0, 10));
    curseur.setUTCDate(curseur.getUTCDate() + 7);
  }
  return dates;
}

/** Variation déterministe et modeste du volume de vente, pour ne pas générer une série constante. */
function crepesVenduesDeReference(indice: number): number {
  const cycle = [122, 126, 130, 134, 138, 142, 146];
  return cycle[indice % cycle.length]!;
}

/**
 * Construit le calendrier CONSERVATEUR : un seul lieu (La Batte), une session
 * hebdomadaire, 3 ans. CLAUDE.md §6 : « trois ans, c'est de l'ordre de 150
 * sessions » — on retient exactement 150 (52 × 3 = 156, moins quelques
 * semaines sans marché pour congés/intempéries, cohérent avec l'ordre de
 * grandeur documenté).
 */
function calendrierConservateur(lieuBatteId: string, dernierDimanche: string): SessionPlan[] {
  const dateDebut = ajouterJours(dernierDimanche, -7 * 200);
  const toutes = joursDeSemaineEntre(dateDebut, dernierDimanche, 0);
  const retenues = toutes.slice(-150);
  return retenues.map((dateSession, i) => ({
    lieuId: lieuBatteId,
    dateSession,
    crepesVendues: crepesVenduesDeReference(i),
  }));
}

/**
 * Construit le calendrier AMBITIEUX : le porteur veut grossir vite. Raisonnement :
 *   - La Batte reste hebdomadaire (150 sessions, comme le scénario conservateur :
 *     le marché historique n'est pas abandonné, il continue) ;
 *   - un SECOND marché hebdomadaire régulier (150 sessions) — la façon la plus
 *     directe de doubler le volume d'un ambulant est d'ajouter un second
 *     emplacement fixe, pas d'espérer vendre 2× plus de crêpes au même endroit ;
 *   - un marché de Noël DÉDIÉ, 20 jours par décembre (marchés de Noël belges
 *     typiques : fin novembre à fin décembre), sur 3 décembres pleins déjà
 *     passés (60 sessions) ;
 *   - des événements ponctuels (foires, fêtes locales, brocantes) qui
 *     s'ajoutent aux jours réguliers de La Batte, ~10 par an (30 sessions).
 * Total ≈ 150 + 150 + 60 + 30 = 390 sessions sur 3 ans, soit 2,6× le volume
 * conservateur — une croissance ambitieuse mais dérivée du métier (plus de
 * marchés, pas plus de crêpes par marché), pas un chiffre rond arbitraire.
 */
function calendrierAmbitieux(
  lieuBatteId: string,
  lieuSecondId: string,
  lieuNoelId: string,
  dernierDimanche: string,
): SessionPlan[] {
  const dateDebut = ajouterJours(dernierDimanche, -7 * 200);

  const batte = joursDeSemaineEntre(dateDebut, dernierDimanche, 0).slice(-150);
  // Second marché : le mercredi, jour distinct pour ne jamais chevaucher La Batte.
  const second = joursDeSemaineEntre(dateDebut, dernierDimanche, 3).slice(-150);

  const anneeFin = Number.parseInt(dernierDimanche.slice(0, 4), 10) - 1;
  const anneeDebut = anneeFin - 2;
  const noel: string[] = [];
  for (let annee = anneeDebut; annee <= anneeFin; annee += 1) {
    for (let jour = 1; jour <= 20; jour += 1) {
      noel.push(`${annee}-12-${String(jour).padStart(2, '0')}`);
    }
  }

  // ~10 événements ponctuels par an à La Batte, hors dimanche (jour + 3 civil).
  const evenements: string[] = [];
  for (let annee = anneeDebut; annee <= anneeFin + 1; annee += 1) {
    for (let k = 0; k < 10; k += 1) {
      const jourAnnee = 15 + k * 36;
      const date = new Date(Date.UTC(annee, 0, jourAnnee, 12));
      if (date.getTime() > new Date(`${dernierDimanche}T12:00:00Z`).getTime()) continue;
      evenements.push(date.toISOString().slice(0, 10));
    }
  }

  const plans: SessionPlan[] = [];
  let i = 0;
  for (const dateSession of batte) {
    plans.push({ lieuId: lieuBatteId, dateSession, crepesVendues: crepesVenduesDeReference(i) });
    i += 1;
  }
  for (const dateSession of second) {
    plans.push({ lieuId: lieuSecondId, dateSession, crepesVendues: crepesVenduesDeReference(i) });
    i += 1;
  }
  for (const dateSession of noel) {
    plans.push({ lieuId: lieuNoelId, dateSession, crepesVendues: crepesVenduesDeReference(i) });
    i += 1;
  }
  for (const dateSession of evenements) {
    plans.push({ lieuId: lieuBatteId, dateSession, crepesVendues: crepesVenduesDeReference(i) });
    i += 1;
  }

  return plans.sort((a, b) => a.dateSession.localeCompare(b.dateSession));
}

/** Ajoute deux lieux supplémentaires (référentiel pur, aucun mouvement). */
function ajouterLieuxSupplementaires(base: BaseBatte): { second: string; noel: string } {
  const maintenant = maintenantUtc();
  const second = nouvelIdentifiant();
  const noel = nouvelIdentifiant();

  base
    .insert(lieuMarche)
    .values({
      id: second,
      nom: '[démo] Second marché hebdomadaire',
      jourSemaine: 3,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  base
    .insert(lieuMarche)
    .values({
      id: noel,
      nom: '[démo] Marché de Noël de Liège',
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  return { second, noel };
}

/** Une poignée d'événements-facteurs (festivals) répartis sur la période, pour donner
 *  une matière non triviale — mais non nécessaire en volume — à `evenementsDuJour`. */
function ajouterEvenementsFacteurs(base: BaseBatte, dernierDimanche: string): void {
  const maintenant = maintenantUtc();
  for (let k = 0; k < 12; k += 1) {
    const debut = ajouterJours(dernierDimanche, -30 * k * 8 - 10);
    const fin = ajouterJours(debut, 3);
    base
      .insert(evenement)
      .values({
        id: nouvelIdentifiant(),
        nom: `[démo] Festival local #${k + 1}`,
        type: 'festival',
        dateDebut: debut,
        dateFin: fin,
        portee: 'liege',
        intensiteEstimee: 3,
        impactEstimeBp: 11_000,
        valideParHumain: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. Génération de l'historique d'exploitation
   ═══════════════════════════════════════════════════════════════════════════ */

const MARGE_SECURITE = 1.3;
const MARGE_SECURITE_BULK = 1.5;

/** Quantité exacte requise par la recette R1 pour N crêpes VENDABLES (via `mettreAEchelle`). */
function besoinRecette(
  base: BaseBatte,
  recetteR1Id: string,
  crepesVendables: number,
): Map<string, number> {
  const pourCalcul = chargerRecettePourCalcul(base, recetteR1Id);
  if (pourCalcul === null) throw new Error('Recette R1 introuvable pour le calcul de besoin.');
  const echelle = mettreAEchelle(pourCalcul, { type: 'crepes', crepesVendables });
  return new Map(echelle.lignes.map((l) => [l.ingredientId, l.quantite]));
}

let compteurBonLivraison = 0;
function prochainBonLivraison(prefixe: string): string {
  compteurBonLivraison += 1;
  return `${prefixe}-${String(compteurBonLivraison).padStart(6, '0')}`;
}

export type ResultatGeneration = {
  readonly sessionsFermees: number;
  readonly lotFarineBulkId: string;
  readonly sessionRecenteId: string;
};

/**
 * Rejoue tout le calendrier via la VRAIE chaîne de services. Achète les
 * ingrédients NON PÉRISSABLES (farine, sel, sucre vanillé, eau de fleur
 * d'oranger, vergeoise) EN UNE FOIS, en bloc, avant la première session — ce
 * sont, dans le référentiel de démonstration, les seuls ingrédients dont la
 * DLC est `null` (non périssable à cette échelle, voir
 * `packages/db/src/seed/activite.ts`) : un seul lot qui traverse TOUTE la
 * période est donc un scénario réaliste, pas un artifice — et c'est
 * précisément le cas qui stresse `tracabiliteAvalLot` (une session par ligne
 * de consommation, jamais mise en cache, voir le rapport de l'audit).
 * Lait/œufs/beurre (périssables) sont réachetés CHAQUE session ; le sirop en
 * vrac et le sirop en pot sont réachetés PÉRIODIQUEMENT (tous les 15 et 10
 * marchés), avec une DLC réaliste (180 et 365 jours).
 */
function genererHistorique(
  base: BaseBatte,
  ref: Referentiel,
  plan: readonly SessionPlan[],
): ResultatGeneration {
  const totalCrepesAProduire = plan.reduce((s, p) => s + p.crepesVendues + 6, 0);
  const totalCassonade = plan.reduce((s, p) => s + Math.round(p.crepesVendues * (72 / 134)), 0);

  const besoinReference = besoinRecette(base, ref.recetteR1Id, 10_000);
  const parCrepe = (id: string): number => (besoinReference.get(id) ?? 0) / 10_000;

  const garnituresCassonade = garnituresDuProduit(base, ref.produits.crepeCassonade);
  const ratioVergeoiseGarniture =
    garnituresCassonade.find((g) => g.ingredientId === ref.ingredients.vergeoise)
      ?.quantiteParUnite ?? 0;
  const garnituresSirop = garnituresDuProduit(base, ref.produits.crepeSirop);
  const ratioSiropVracGarniture =
    garnituresSirop.find((g) => g.ingredientId === ref.ingredients.siropVrac)?.quantiteParUnite ??
    0;

  const premiereDateSession = plan[0]!.dateSession;
  const dateBulk = ajouterJours(premiereDateSession, -30);

  // Achat en bloc, une fois : farine, sel, sucre vanillé, eau de fleur
  // d'oranger, vergeoise (recette + garniture cassonade).
  const bulk = enregistrerReception(base, {
    fournisseurId: ref.fournisseurGrossisteId,
    dateReception: dateBulk,
    numeroBonLivraison: prochainBonLivraison('AUDIT-BULK'),
    notes:
      "Achat en bloc, script de mesure d'échelle : ingrédients non périssables à cette " +
      'échelle (DLC nulle dans le référentiel de démonstration), dimensionné pour couvrir ' +
      "tout l'historique généré avec une marge de sécurité de 50 %.",
    lignes: [
      {
        ingredientId: ref.ingredients.farine,
        quantite: Math.ceil(
          parCrepe(ref.ingredients.farine) * totalCrepesAProduire * MARGE_SECURITE_BULK,
        ),
        prixLigneCents: 1_875_00,
        numeroLotFournisseur: 'AUDIT-FARINE-BULK',
        dateDlc: null,
      },
      {
        ingredientId: ref.ingredients.sel,
        quantite: Math.ceil(
          parCrepe(ref.ingredients.sel) * totalCrepesAProduire * MARGE_SECURITE_BULK,
        ),
        prixLigneCents: 9_000,
        numeroLotFournisseur: 'AUDIT-SEL-BULK',
        dateDlc: null,
      },
      {
        ingredientId: ref.ingredients.sucreVanille,
        quantite: Math.ceil(
          parCrepe(ref.ingredients.sucreVanille) * totalCrepesAProduire * MARGE_SECURITE_BULK,
        ),
        prixLigneCents: 39_000,
        numeroLotFournisseur: 'AUDIT-VANILLE-BULK',
        dateDlc: null,
      },
      {
        ingredientId: ref.ingredients.eauFleurOranger,
        quantite: Math.ceil(
          parCrepe(ref.ingredients.eauFleurOranger) * totalCrepesAProduire * MARGE_SECURITE_BULK,
        ),
        prixLigneCents: 29_000,
        numeroLotFournisseur: 'AUDIT-ORANGER-BULK',
        dateDlc: null,
      },
      {
        ingredientId: ref.ingredients.vergeoise,
        quantite: Math.ceil(
          (parCrepe(ref.ingredients.vergeoise) * totalCrepesAProduire +
            ratioVergeoiseGarniture * totalCassonade) *
            MARGE_SECURITE_BULK,
        ),
        prixLigneCents: 32_000,
        numeroLotFournisseur: 'AUDIT-VERGEOISE-BULK',
        dateDlc: null,
      },
    ],
  });
  const lotFarineBulkId = bulk.lotsCrees.find(
    (l) => l.ingredientId === ref.ingredients.farine,
  )!.lotId;

  let sessionsFermees = 0;
  let sessionRecenteId = '';
  const CADENCE_SIROP_VRAC = 15;
  const CADENCE_SIROP_POT = 10;

  plan.forEach((item, indice) => {
    const jourReception = ajouterJours(item.dateSession, -4);
    const jourProduction = ajouterJours(item.dateSession, -1);
    const crepesAProduire = item.crepesVendues + 6;

    // Périssables : réachetés CHAQUE session, en quantité exacte + marge.
    enregistrerReception(base, {
      fournisseurId: ref.fournisseurGrossisteId,
      dateReception: jourReception,
      numeroBonLivraison: prochainBonLivraison('AUDIT-HEBDO'),
      lignes: [
        {
          ingredientId: ref.ingredients.lait,
          quantite: Math.ceil(parCrepe(ref.ingredients.lait) * crepesAProduire * MARGE_SECURITE),
          prixLigneCents: 138_00,
          numeroLotFournisseur: `AUDIT-LAIT-${indice}`,
          dateDlc: ajouterJours(jourReception, 90),
        },
        {
          ingredientId: ref.ingredients.oeufs,
          quantite: Math.ceil(parCrepe(ref.ingredients.oeufs) * crepesAProduire * MARGE_SECURITE),
          prixLigneCents: 120_00,
          numeroLotFournisseur: `AUDIT-OEUFS-${indice}`,
          dateDlc: ajouterJours(jourReception, 21),
        },
        {
          ingredientId: ref.ingredients.beurre,
          quantite: Math.ceil(parCrepe(ref.ingredients.beurre) * crepesAProduire * MARGE_SECURITE),
          prixLigneCents: 180_00,
          numeroLotFournisseur: `AUDIT-BEURRE-${indice}`,
          dateDlc: ajouterJours(jourReception, 45),
        },
      ],
    });

    // Sirop en vrac (garniture) : réapprovisionné tous les 15 marchés.
    if (indice % CADENCE_SIROP_VRAC === 0) {
      const besoinVrac = Math.ceil(
        ratioSiropVracGarniture *
          plan
            .slice(indice, indice + CADENCE_SIROP_VRAC)
            .reduce((s, p) => s + (p.crepesVendues - Math.round(p.crepesVendues * (72 / 134))), 0) *
          MARGE_SECURITE,
      );
      if (besoinVrac > 0) {
        enregistrerReception(base, {
          fournisseurId: ref.fournisseurTerroirId,
          dateReception: jourReception,
          numeroBonLivraison: prochainBonLivraison('AUDIT-VRAC'),
          lignes: [
            {
              ingredientId: ref.ingredients.siropVrac,
              quantite: besoinVrac,
              prixLigneCents: 22_00 * Math.max(1, Math.round(besoinVrac / 2500)),
              numeroLotFournisseur: `AUDIT-SIROP-VRAC-${indice}`,
              dateDlc: ajouterJours(jourReception, 180),
            },
          ],
        });
      }
    }

    // Sirop en pot (revendu) : réapprovisionné tous les 10 marchés.
    if (indice % CADENCE_SIROP_POT === 0) {
      const besoinPots = Math.ceil(
        plan
          .slice(indice, indice + CADENCE_SIROP_POT)
          .reduce((s, p) => s + Math.round(p.crepesVendues * (54 / 134)), 0) * MARGE_SECURITE,
      );
      if (besoinPots > 0) {
        enregistrerReception(base, {
          fournisseurId: ref.fournisseurTerroirId,
          dateReception: jourReception,
          numeroBonLivraison: prochainBonLivraison('AUDIT-POTS'),
          lignes: [
            {
              ingredientId: ref.ingredients.siropPot,
              quantite: besoinPots,
              prixLigneCents: 480 * besoinPots,
              numeroLotFournisseur: `AUDIT-SIROP-POT-${indice}`,
              dateDlc: ajouterJours(jourReception, 365),
            },
          ],
        });
      }
    }

    const session = creerSession(base, {
      lieuId: item.lieuId,
      dateSession: item.dateSession,
      fondsCaisseInitialCents: 5000,
    });

    const lancee = lancerProduction(base, {
      recetteId: ref.recetteR1Id,
      cible: { type: 'crepes', crepesVendables: crepesAProduire },
      dateProduction: jourProduction,
      sessionId: session.id,
      notes: `Fournée générée par audit-echelle.ts, session #${indice}.`,
    });

    saisirRealise(base, lancee.productionId, {
      volumeReelMl: Math.max(1, lancee.volumeTheoriqueMl - 220),
      crepesReelles: crepesAProduire,
      ecartMotif: 'Fond de bassine (script de mesure).',
    });

    const cassonade = Math.round(item.crepesVendues * (72 / 134));
    const sirop = item.crepesVendues - cassonade;
    const pots = Math.round(item.crepesVendues * (54 / 134));
    const caCents = cassonade * 300 + sirop * 350 + pots * 750;
    const caCarteCents = Math.round((caCents * 37_000) / 83_800);

    cloturerSession(base, session.id, {
      ventes: [
        {
          produitVenteId: ref.produits.crepeCassonade,
          quantite: cassonade,
          prixUnitaireCents: 300,
        },
        { produitVenteId: ref.produits.crepeSirop, quantite: sirop, prixUnitaireCents: 350 },
        { produitVenteId: ref.produits.siropPotVente, quantite: pots, prixUnitaireCents: 750 },
      ],
      frais: { emplacementCents: 0, deplacementCents: 1400, gazCents: 800, diversCents: 0 },
      fondsCaisseInitialCents: 5000,
      especesCompteesCents: 5000 + caCents - caCarteCents,
      caCarteCents,
      crepesInvendues: 4,
      crepesCassees: 2,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
      nbTickets: Math.max(1, Math.round((156 * item.crepesVendues) / 134)),
      notesQualitatives: 'Session générée par audit-echelle.ts (mesure de passage à l’échelle).',
      relevesTemperature: [{ moment: 'arrivee', equipement: 'Glacière rigide', temperatureC: 4.0 }],
    });

    sessionsFermees += 1;
    sessionRecenteId = session.id;
  });

  return { sessionsFermees, lotFarineBulkId, sessionRecenteId };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Lectures chronométrées
   ═══════════════════════════════════════════════════════════════════════════ */

/** Approximation fidèle du coût O(n²) de `/api/prevision` (routes/previsions.ts),
 *  SANS réseau : la route valide ~7 prédicteurs par validation croisée
 *  leave-one-out (comparableCalendaire, jourSemaine, vacancesScolaires,
 *  sessionConsecutive, météo mesurée, saison, tendance — voir
 *  `calculerPredicteursPrecision`, `calculerFacteurMeteoMesure`,
 *  `calculerSaisonRetenue`, `calculerTendanceRetenue` dans
 *  `apps/api/src/routes/previsions.ts`), chacune ré-estimant `calculerBaseline`
 *  sur l'historique amputé d'un point, à CHAQUE point. On rejoue ici sept
 *  validations de coût équivalent (même estimateur `calculerBaseline`) sur le
 *  même historique, pour mesurer ce coût sans dépendre d'Open-Meteo.
 */
function coutValidationCroiseeSeptFois(
  observations: readonly ObservationSession[],
  parametres: Parametres,
): void {
  const minPoints = parametres.entier('prevision_validation_croisee_points_minimum');
  const estimer: Estimateur<ObservationSession> = (historique, cible) => {
    const b = calculerBaseline(historique, cible.dateSession, parametres).baselineCrepes;
    return Number.isFinite(b) && b > 0 ? b : null;
  };
  for (let i = 0; i < 7; i += 1) {
    validerParLeaveOneOut(observations, (o) => o.crepesVendues, estimer, estimer, minPoints);
  }
}

function mesurerLectures(
  base: BaseBatte,
  gen: ResultatGeneration | null,
  lieuPrincipalId: string,
): Mesure[] {
  const aujourdHui = jourCivilBelge(new Date());
  const anneeCourante = Number.parseInt(aujourdHui.slice(0, 4), 10);
  const mesures: Mesure[] = [];

  const { mesure: mEtat } = chrono('État du stock (etatDuStock)', () =>
    etatDuStock(base, aujourdHui),
  );
  mesures.push(mEtat);

  const { mesure: mTaches } = chrono('  ↳ tâches nettoyage en retard', () =>
    tachesEnRetard(base, aujourdHui),
  );
  const { mesure: mNc } = chrono('  ↳ non-conformités ouvertes', () => listerNonConformites(base));
  const { mesure: mEcheances } = chrono('  ↳ échéances', () => listerEcheances(base, aujourdHui));
  const { mesure: mSeuils } = chrono('  ↳ seuils légaux', () => tableauSeuils(base, anneeCourante));
  const { mesure: mSessions } = chrono('  ↳ liste des sessions', () => listerSessions(base));
  mesures.push(
    sommerMesures('Tableau de bord (assemblage : stock+tâches+NC+échéances+seuils+sessions)', [
      mEtat,
      mTaches,
      mNc,
      mEcheances,
      mSeuils,
      mSessions,
    ]),
  );

  mesures.push(
    chrono('Synthèse d’exercice (syntheseExercice)', () => syntheseExercice(base, anneeCourante))
      .mesure,
  );

  if (gen !== null) {
    mesures.push(
      chrono('Traçabilité AMONT (session la plus récente)', () =>
        tracabiliteAmontSession(base, gen.sessionRecenteId),
      ).mesure,
    );
    mesures.push(
      chrono('Traçabilité AVAL (lot présent sur toute la période)', () =>
        tracabiliteAvalLot(base, gen.lotFarineBulkId),
      ).mesure,
    );
  }

  const debutMois = `${anneeCourante}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
  const finMois = `${debutMois.slice(0, 8)}28T23:59:59.999Z`;
  const { mesure: mTemp } = chrono('  ↳ relevés température (mois)', () =>
    relevesTemperaturePeriode(base, debutMois, finMois),
  );
  const { mesure: mNett } = chrono('  ↳ exécutions nettoyage (mois)', () =>
    executionsNettoyagePeriode(base, debutMois, finMois),
  );
  const { mesure: mNcPeriode } = chrono('  ↳ non-conformités (mois)', () =>
    nonConformitesPeriode(base, debutMois, finMois),
  );
  const { mesure: mSansReleve } = chrono('  ↳ sessions sans relevé (mois)', () =>
    sessionsSansReleveTemperature(base, debutMois, finMois),
  );
  const { mesure: mExercices } = chrono('  ↳ exercices traçabilité (tout, filtré ensuite)', () =>
    listerExercicesTracabilite(base),
  );
  mesures.push(
    sommerMesures(
      'Registre AFSCA mensuel (assemblage : température+nettoyage+NC+sessions+exercices)',
      [mTemp, mNett, mNcPeriode, mSansReleve, mExercices],
    ),
  );

  const parametres = lireParametres(base, aujourdHui);
  const { valeur: observations, mesure: mObs } = chrono(
    'Prévision — observationsDuLieu (lieu principal)',
    () => observationsDuLieu(base, lieuPrincipalId),
  );
  mesures.push(mObs);
  const { mesure: mCouts } = chrono('  ↳ coûts newsvendor', () => coutsNewsvendor(base));
  const { mesure: mValidation } = chrono(
    '  ↳ 7× validation croisée leave-one-out (approximation /api/prevision)',
    () => coutValidationCroiseeSeptFois(observations, parametres),
  );
  mesures.push(
    sommerMesures('Prévision — TOTAL approché (observations + coûts + 7 validations)', [
      mObs,
      mCouts,
      mValidation,
    ]),
  );

  mesures.push(
    chrono('npm run backtest (executerBacktest, réel, tous lieux)', () => executerBacktest(base))
      .mesure,
  );

  mesures.push(
    chrono('Journal d’audit SANS filtre (GET /api/audit, page d’accueil)', () =>
      listerJournalAudit(base, {}),
    ).mesure,
  );

  return mesures;
}

/** Peuple le journal d'audit à un volume donné, par appels RÉELS à `journaliser`
 *  (jamais un INSERT brut) — pour mesurer la lecture SANS filtre à plusieurs
 *  échelles de la table elle-même, indépendamment du nombre de sessions. */
function peuplerJournalAudit(base: BaseBatte, nbLignes: number): void {
  // Une SEULE transaction pour tout le lot : `journaliser` committe sinon une
  // écriture WAL par ligne, ce qui rendrait ce peuplement — un pur outil de
  // mesure, pas un scénario métier — inutilement lent à 50 000 lignes. Même
  // idiome de cast que `services/production.ts::lancerProduction` pour passer
  // le handle de transaction là où `BaseBatte` est attendu.
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    for (let i = 0; i < nbLignes; i += 1) {
      journaliser(baseTx, {
        table: 'parametre',
        enregistrementId: `audit-stress-${i}`,
        action: 'modification',
        valeurAvant: { valeur: i },
        valeurApres: { valeur: i + 1 },
      });
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. Rapport
   ═══════════════════════════════════════════════════════════════════════════ */

function afficherTableau(titre: string, mesures: readonly Mesure[]): void {
  console.log(`\n── ${titre} ──`);
  for (const m of mesures) {
    console.log(`${m.ms.toFixed(2).padStart(10)} ms   ${m.label}`);
  }
}

function main(): void {
  console.log("Audit d'échelle — trois ans de données, mesuré, pas deviné.\n");

  // 1) État « vide » : référentiel de démonstration seul (une session).
  const vide = creerBaseTemporaire('vide.sqlite');
  try {
    const lieuBatteVide = idLieuParNom(vide.base, 'La Batte');
    const mesuresVide = mesurerLectures(vide.base, null, lieuBatteVide);
    afficherTableau('État VIDE (référentiel démo, 1 session)', mesuresVide);
  } finally {
    vide.fermer();
  }

  // 2) Scénario CONSERVATEUR : 150 sessions, un seul lieu.
  const conservateur = creerBaseTemporaire('conservateur.sqlite');
  try {
    const refC = chargerReferentiel(conservateur.base);
    const lieuBatteId = idLieuParNom(conservateur.base, 'La Batte');
    ajouterEvenementsFacteurs(conservateur.base, jourCivilBelge(new Date()));
    const plan = calendrierConservateur(lieuBatteId, ajouterJours(jourCivilBelge(new Date()), -7));
    const debut = performance.now();
    const gen = genererHistorique(conservateur.base, refC, plan);
    console.log(
      `\n(génération conservatrice : ${gen.sessionsFermees} sessions en ` +
        `${((performance.now() - debut) / 1000).toFixed(1)} s)`,
    );
    const mesures = mesurerLectures(conservateur.base, gen, lieuBatteId);
    afficherTableau(`3 ANS — CONSERVATEUR (${gen.sessionsFermees} sessions, 1 lieu)`, mesures);

    // Stress du journal d'audit à plusieurs échelles, sur cette même base.
    const { mesure: m0 } = chrono('  0 ligne administrative de plus', () =>
      listerJournalAudit(conservateur.base, {}),
    );
    peuplerJournalAudit(conservateur.base, 5000 - 1);
    const { mesure: m5000 } = chrono('  après 5 000 lignes (journaliser réel)', () =>
      listerJournalAudit(conservateur.base, {}),
    );
    peuplerJournalAudit(conservateur.base, 45_000);
    const { mesure: m50000 } = chrono('  après 50 000 lignes (journaliser réel)', () =>
      listerJournalAudit(conservateur.base, {}),
    );
    afficherTableau('Journal d’audit SANS filtre — stress contrôlé (nombre de lignes)', [
      m0,
      m5000,
      m50000,
    ]);
  } finally {
    conservateur.fermer();
  }

  // 3) Scénario AMBITIEUX : ~390 sessions, 3 lieux, marché de Noël + événements.
  const ambitieux = creerBaseTemporaire('ambitieux.sqlite');
  try {
    const refA = chargerReferentiel(ambitieux.base);
    const lieuBatteId = idLieuParNom(ambitieux.base, 'La Batte');
    const { second, noel } = ajouterLieuxSupplementaires(ambitieux.base);
    ajouterEvenementsFacteurs(ambitieux.base, jourCivilBelge(new Date()));
    const plan = calendrierAmbitieux(
      lieuBatteId,
      second,
      noel,
      ajouterJours(jourCivilBelge(new Date()), -7),
    );
    const debut = performance.now();
    const gen = genererHistorique(ambitieux.base, refA, plan);
    console.log(
      `\n(génération ambitieuse : ${gen.sessionsFermees} sessions en ` +
        `${((performance.now() - debut) / 1000).toFixed(1)} s)`,
    );
    const mesures = mesurerLectures(ambitieux.base, gen, lieuBatteId);
    afficherTableau(
      `3 ANS — AMBITIEUX (${gen.sessionsFermees} sessions, 3 lieux, Noël + événements)`,
      mesures,
    );
  } finally {
    ambitieux.fermer();
  }

  console.log('\nTerminé.');
}

// Exécution directe uniquement (`npx tsx packages/db/src/scripts/audit-echelle.ts`),
// jamais à l'import — même garde que `migrer.ts`/`scripts/backtest.ts`.
if (estModulePrincipal(import.meta.url)) {
  try {
    main();
  } catch (erreur) {
    console.error(erreur);
    process.exitCode = 1;
  }
}
