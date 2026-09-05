/**
 * Lancement d'une production et saisie du realise.
 *
 * ATOMICITE ABSOLUE : soit tout passe, soit rien. Une production a moitie
 * ecrite laisserait du stock consomme sans lot de pate en face — donc une
 * tracabilite fausse, ce que l'AFSCA ne pardonne pas. C'est l'exigence
 * explicite du prompt du Lot 3 dans docs/04-ROADMAP-LOTS.md.
 */

import {
  ErreurIntrouvable,
  ErreurMetier,
  ajouterHeures,
  calculerCump,
  controlerFaisabilite,
  decomposerEcart,
  formaterQuantite,
  maintenantUtc,
  messageFaisabilite,
  mettreAEchelle,
  nouvelIdentifiant,
  repartirFefo,
  volumeAPreparer,
  type CibleMiseAEchelle,
  type CodeMotif,
  type ResultatFaisabilite,
} from '@batte/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  ingredient,
  lot,
  motif,
  mouvementStock,
  prevision,
  production,
  productionConsommation,
  recette,
  sessionMarche,
} from '../schema.js';
import { allouerNumero } from '../depots/numerotation.js';
import { chargerRecettePourCalcul } from '../depots/recettes.js';
import { journaliser } from '../depots/audit.js';
import { verifierPeriodeNonVerrouillee } from '../depots/comptabilite.js';
import { lireParametres } from '../depots/parametres.js';
import { lotsDeLIngredient } from '../depots/stock.js';
import { contrepasserMouvement } from './mouvements.js';

export type EntreeProduction = {
  readonly recetteId: string;
  readonly cible: CibleMiseAEchelle;
  /** Jour civil belge. Sert de date de mouvement et de base au calcul de DLC. */
  readonly dateProduction: string;
  /**
   * Session a laquelle la pate est destinee, si elle est deja connue au
   * lancement. Verifiee par `verifierSessionRattachable` (non cloturee) : le
   * meme controle qu'un rattachement fait apres coup via `rattacherSession`,
   * pour qu'un seul chemin ne puisse pas atteindre un etat que l'autre refuse
   * (docs/14 G1/G4).
   */
  readonly sessionId?: string | null;
  /**
   * Prevision sur laquelle le porteur a decide de lancer CETTE fournee, si
   * l'ecran en affichait une au moment du lancement (voir
   * `schemaCreationProduction.previsionId`, `@batte/core`, pour la
   * justification complete). `undefined`/`null` : decidee sans prevision,
   * un cas normal (depannage, rattrapage) — jamais une valeur choisie APRES
   * coup par ce service, qui ne peut pas savoir ce que l'ecran affichait
   * reellement a l'instant du lancement. Verifiee par
   * `verifierPrevisionRattachable` avant toute ecriture, meme convention que
   * `sessionId` ci-dessus.
   */
  readonly previsionId?: string | null;
  readonly notes?: string | null;
  readonly creePar?: string | null;
};

export type ResultatProduction = {
  productionId: string;
  numero: string;
  numeroLotPate: string;
  dateDlcPate: string;
  volumeTheoriqueMl: number;
  crepesTheoriques: number;
  coutMatiereTheoriqueCents: number;
  /** Une ligne par LOT consomme, pas par ingredient : c'est la tracabilite. */
  consommations: { lotId: string; ingredientId: string; quantite: number; coutCents: number }[];
};

/** Stock disponible par ingredient, pour le controle de faisabilite. */
function stockParIngredient(
  base: BaseBatte,
  ingredientIds: readonly string[],
  jour: string,
): Map<string, number> {
  const stock = new Map<string, number>();
  for (const id of ingredientIds) {
    const lots = lotsDeLIngredient(base, id);
    const disponible = lots
      .filter((l) => l.statut === 'disponible' && l.quantiteRestante > 0)
      .filter((l) => l.dateDlc === null || l.dateDlc >= jour)
      .reduce((total, l) => total + l.quantiteRestante, 0);
    stock.set(id, disponible);
  }
  return stock;
}

/**
 * Verifie qu'une production est realisable, SANS rien ecrire.
 *
 * Separe du lancement a dessein : l'ecran doit pouvoir afficher le diagnostic
 * en direct pendant que l'utilisateur ajuste la quantite, sans effet de bord.
 */
export function verifierFaisabilite(
  base: BaseBatte,
  recetteId: string,
  cible: CibleMiseAEchelle,
  jour: string,
): { faisabilite: ResultatFaisabilite; facteur: number; volumeMl: number; crepes: number } {
  const pourCalcul = chargerRecettePourCalcul(base, recetteId);
  if (pourCalcul === null) throw new ErreurIntrouvable('Recette', recetteId);

  const echelle = mettreAEchelle(pourCalcul, cible);
  const stock = stockParIngredient(
    base,
    pourCalcul.lignes.map((l) => l.ingredientId),
    jour,
  );

  return {
    faisabilite: controlerFaisabilite(pourCalcul, echelle.facteur, stock),
    facteur: echelle.facteur,
    volumeMl: echelle.volumeMl,
    crepes: echelle.crepesVendables,
  };
}

/**
 * Verifie qu'une session existe et n'est PAS cloturee, avant d'y rattacher
 * une production (au lancement ou apres coup — les deux passent par ici).
 *
 * Une session cloturee est une piece comptable dont les agregats sont FIGES
 * (D-024) : `cloturerSession` ne tourne qu'UNE fois, a la cloture. Rattacher
 * une production apres coup changerait un cout matiere deja arrete sans que
 * le total affiche ne le repercute jamais — l'ecran mentirait en silence.
 * D'ou le refus explicite en 422, plutot que d'accepter et de laisser le
 * chiffre diverger discretement.
 */
function verifierSessionRattachable(
  base: BaseBatte,
  sessionId: string,
): { id: string; numero: string } {
  const session = base
    .select({ id: sessionMarche.id, numero: sessionMarche.numero, statut: sessionMarche.statut })
    .from(sessionMarche)
    .where(eq(sessionMarche.id, sessionId))
    .get();
  if (session === undefined) throw new ErreurIntrouvable('Session', sessionId);
  if (session.statut === 'cloturee') {
    throw new ErreurMetier(
      'session_cloturee',
      `La session ${session.numero} est déjà clôturée : ses agrégats sont figés (D-024). ` +
        'Un rattachement changerait un coût matière déjà arrêté. Choisissez une session non clôturée.',
    );
  }
  return { id: session.id, numero: session.numero };
}

/**
 * Lance une production : consomme le stock en FEFO et cree le lot de pate.
 *
 * Refuse si le stock est insuffisant, avec le nom de l'ingredient limitant et
 * le chiffre manquant — jamais un refus sec.
 */
export function lancerProduction(base: BaseBatte, entree: EntreeProduction): ResultatProduction {
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    // Verrou de periode (docs/07 §1.6) : une production datee dans un
    // exercice verrouille est refusee avant toute autre verification.
    verifierPeriodeNonVerrouillee(baseTx, entree.dateProduction);

    const enteteRecette = baseTx
      .select()
      .from(recette)
      .where(eq(recette.id, entree.recetteId))
      .get();
    if (enteteRecette === undefined) throw new ErreurIntrouvable('Recette', entree.recetteId);

    if (enteteRecette.statut !== 'active') {
      throw new ErreurMetier(
        'recette_non_active',
        `La recette ${enteteRecette.code} est en ${enteteRecette.statut} : ` +
          'seule une recette active peut être produite.',
      );
    }

    // Verifie la session AVANT toute ecriture, meme regle qu'un rattachement
    // apres coup (`rattacherSession`) : une session choisie des le lancement
    // doit passer le meme controle qu'une session choisie plus tard, sinon le
    // meme etat (production rattachee a une session cloturee) serait
    // atteignable par un chemin et refuse par l'autre.
    if (entree.sessionId !== undefined && entree.sessionId !== null) {
      verifierSessionRattachable(baseTx, entree.sessionId);
    }

    // Prevision retenue au lancement (voir la doc de `EntreeProduction.previsionId`)
    // : verifiee AVANT toute ecriture, meme regle que la session ci-dessus.
    // Si les deux sont fournis, ils doivent porter sur LE MEME marche —
    // sinon la prevision n'a rien pu motiver de CE lancement.
    if (entree.previsionId !== undefined && entree.previsionId !== null) {
      const previsionTrouvee = verifierPrevisionRattachable(baseTx, entree.previsionId);
      if (
        entree.sessionId !== undefined &&
        entree.sessionId !== null &&
        previsionTrouvee.sessionId !== null &&
        previsionTrouvee.sessionId !== entree.sessionId
      ) {
        throw new ErreurMetier(
          'prevision_session_incoherente',
          'Cette prévision porte sur une autre session que celle choisie pour cette ' +
            "production : elle n'a pas pu motiver ce lancement.",
          { champs: { previsionId: 'Choisissez une prévision de la même session.' } },
        );
      }
    }

    const pourCalcul = chargerRecettePourCalcul(baseTx, entree.recetteId);
    if (pourCalcul === null) throw new ErreurIntrouvable('Recette', entree.recetteId);

    const echelle = mettreAEchelle(pourCalcul, entree.cible);

    // Controle de faisabilite AVANT toute ecriture : on ne veut pas decouvrir le
    // manque au milieu de la consommation, meme si la transaction annulerait tout.
    const stock = stockParIngredient(
      baseTx,
      pourCalcul.lignes.map((l) => l.ingredientId),
      entree.dateProduction,
    );
    const faisabilite = controlerFaisabilite(pourCalcul, echelle.facteur, stock);
    if (!faisabilite.faisable) {
      // Pas de `champs` ici : ce champ sert a pointer un CHAMP DE FORMULAIRE, et
      // un identifiant d'ingredient n'en est pas un — l'interface ne saurait pas
      // sur quel input l'accrocher. Le message porte deja le nom de l'ingredient
      // limitant et la quantite manquante, formatee dans son unite. Le detail
      // structure, ingredient par ingredient, est le role de la route
      // `/productions/faisabilite`, que l'ecran interroge en direct.
      throw new ErreurMetier('production_infaisable', messageFaisabilite(faisabilite)!);
    }

    const maintenant = maintenantUtc();
    const annee = Number.parseInt(entree.dateProduction.slice(0, 4), 10);
    const numero = allouerNumero(baseTx, 'production', annee);

    // DLC de la pate : depuis le parametre, jamais 24 h code en dur.
    const parametres = lireParametres(baseTx, entree.dateProduction);
    const dureeHeures = parametres.entier('duree_conservation_pate_heures');
    const dateDlcPate = ajouterHeures(`${entree.dateProduction}T00:00:00Z`, dureeHeures);

    const productionId = nouvelIdentifiant();
    const volumeTheoriqueMl = volumeAPreparer(echelle.volumeMl, enteteRecette.perteFixeMl);

    // Motif structure sur les sorties de production : sans code, l'ecart de
    // matiere ne serait pas attribuable.
    const motifProduction = baseTx
      .select({ id: motif.id })
      .from(motif)
      .where(eq(motif.code, 'SURDOSAGE'))
      .get();

    // PREMIERE PASSE — on calcule toutes les allocations FEFO sans rien ecrire.
    // Deux raisons : la ligne `production` doit exister AVANT les consommations
    // qui la referencent (contrainte de cle etrangere), et le cout total doit
    // etre connu avant de l'inserter — plutot que d'ecrire puis de corriger.
    const consommations: ResultatProduction['consommations'] = [];
    let coutTotalCents = 0;

    for (const ligne of echelle.lignes) {
      const lots = lotsDeLIngredient(baseTx, ligne.ingredientId);
      const repartition = repartirFefo(lots, ligne.quantite, entree.dateProduction);

      if (repartition.quantiteManquante > 0) {
        // Ne devrait pas arriver : la faisabilite vient d'etre verifiee. Si ca
        // se produit, c'est une incoherence entre les deux calculs, pas une
        // situation metier — on echoue bruyamment plutot que de produire un
        // stock faux.
        throw new Error(
          `Incohérence de faisabilité sur ${ligne.nomIngredient} : ` +
            `${repartition.quantiteManquante} manquant après contrôle favorable.`,
        );
      }

      for (const allocation of repartition.allocations) {
        consommations.push({
          lotId: allocation.lotId,
          ingredientId: ligne.ingredientId,
          quantite: allocation.quantite,
          coutCents: allocation.coutCents,
        });
        coutTotalCents += allocation.coutCents;
      }
    }

    const numeroLotPate = `PATE-${numero}`;

    // SECONDE PASSE — les ecritures, dans l'ordre impose par les cles etrangeres.
    baseTx
      .insert(production)
      .values({
        id: productionId,
        numero,
        recetteId: entree.recetteId,
        dateProduction: entree.dateProduction,
        statut: 'lancee',
        volumeTheoriqueMl,
        crepesTheoriques: echelle.crepesVendables,
        coutMatiereTheoriqueCents: coutTotalCents,
        volumeReelMl: null,
        crepesReelles: null,
        coutMatiereReelCents: null,
        numeroLotPate,
        dateDlcPate,
        sessionId: entree.sessionId ?? null,
        // Prevision retenue au lancement (voir `EntreeProduction.previsionId`) :
        // ecrite TELLE QUELLE, jamais choisie ici — `null` reste un cas normal
        // (decidee sans prevision), pas une valeur par defaut inventee.
        ordrePrevisionId: entree.previsionId ?? null,
        // `ecartMotif` reste vide au lancement : il porte le motif de l'ecart
        // THEORIQUE/REEL, qui ne peut etre saisi qu'avec le realise.
        ecartMotif: null,
        notes: entree.notes ?? null,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    for (const consommation of consommations) {
      baseTx
        .insert(mouvementStock)
        .values({
          id: nouvelIdentifiant(),
          lotId: consommation.lotId,
          ingredientId: consommation.ingredientId,
          type: 'sortie_production',
          quantite: consommation.quantite,
          dateMouvement: entree.dateProduction,
          valuationDate: entree.dateProduction,
          ajustement: false,
          productionId,
          sessionId: entree.sessionId ?? null,
          motifId: motifProduction?.id ?? null,
          motifTexte: `Production ${numero}`,
          coutCents: consommation.coutCents,
          isAnnule: false,
          annuleParId: null,
          creePar: entree.creePar ?? null,
          creeLe: maintenant,
        })
        .run();

      baseTx
        .insert(productionConsommation)
        .values({
          id: nouvelIdentifiant(),
          productionId,
          lotId: consommation.lotId,
          ingredientId: consommation.ingredientId,
          quantiteTheorique: consommation.quantite,
          /**
           * `quantite_reelle` reste NULLE au lancement, et c'est la seule
           * valeur honnete a ce moment : la production n'a pas encore eu lieu.
           * Elle est ensuite renseignee par `saisirRealise` (fiche 9,
           * ci-dessous) — SEULEMENT quand un seul lot a ete consomme pour cet
           * ingredient dans cette production, seul cas ou la valeur declaree
           * lui est attribuable sans inventer de repartition. Le mouvement
           * d'ecart, lui, est TOUJOURS ecrit (regle n°5), que cette colonne se
           * fige ou reste `null`.
           *
           * DERIVER cette valeur du volume reel global
           * (`quantiteTheorique × volumeReel / volumeTheorique`) a ete ECARTE :
           * ce serait inventer une mesure (CLAUDE.md §7), l'ecart par
           * ingredient serait strictement proportionnel donc sans
           * information, et la valeur divergerait des mouvements de stock —
           * le « reel » n'aurait aucune contrepartie a l'inventaire.
           */
          quantiteReelle: null,
          coutCents: consommation.coutCents,
        })
        .run();
    }

    return {
      productionId,
      numero,
      numeroLotPate,
      dateDlcPate,
      volumeTheoriqueMl,
      crepesTheoriques: echelle.crepesVendables,
      coutMatiereTheoriqueCents: coutTotalCents,
      consommations,
    };
  });
}

export type ConsommationReelleDeclaree = {
  readonly ingredientId: string;
  readonly quantiteReelle: number;
};

export type RealiseProduction = {
  readonly volumeReelMl: number;
  readonly crepesReelles: number;
  readonly ecartMotif?: string | null;
  /**
   * Consommation REELLE, INGREDIENT PAR INGREDIENT (docs/17 fiche 9). Partielle
   * et optionnelle : le porteur peut n'en declarer qu'un seul, ou aucun.
   */
  readonly consommationsReelles?: readonly ConsommationReelleDeclaree[];
};

/**
 * Rejoue l'ordre FEFO (meme regle que `ordonnerFefo` de `@batte/core`) sur des
 * lignes de consommation DEJA ECRITES d'une production — pas sur des lots
 * vivants. C'est ce qui permet de defaire une consommation dans l'ordre
 * EXACTEMENT inverse de celui ou elle a ete faite.
 */
function parOrdreFefo<
  T extends { readonly dateDlc: string | null; readonly dateReception: string },
>(lignes: readonly T[]): T[] {
  return [...lignes].sort((a, b) => {
    if (a.dateDlc === null && b.dateDlc === null) {
      return a.dateReception.localeCompare(b.dateReception);
    }
    if (a.dateDlc === null) return 1;
    if (b.dateDlc === null) return -1;
    const parDlc = a.dateDlc.localeCompare(b.dateDlc);
    return parDlc !== 0 ? parDlc : a.dateReception.localeCompare(b.dateReception);
  });
}

/**
 * Cout matiere REEL d'une production, DERIVE du grand livre — c'est-a-dire des
 * mouvements de stock que cette production a reellement ecrits.
 *
 * DEFAUT QUI A IMPOSE CETTE FONCTION (01/08/2026). `saisirRealise` recalculait
 * ce total A PARTIR DE ZERO a chaque appel, en sommant
 * `production_consommation.cout_cents` — une colonne qui reste THEORIQUE a vie.
 * Les mouvements d'ecart ecrits a la premiere saisie n'etaient jamais relus.
 * Or seule `consommationsReelles` est refusee une seconde fois : corriger le
 * SEUL nombre de crepes — un geste anodin, que le porteur fait naturellement en
 * se relisant — suffisait donc a effacer l'ecart matiere du total, en silence,
 * alors que la matiere etait toujours sortie du stock et que les mouvements
 * d'ecart n'etaient pas contrepasses. La cloture de session facturait ensuite
 * un cout MINORE, et rien ne le signalait.
 *
 * LES DEUX FILTRES, chacun indispensable — ce sont EXACTEMENT ceux de
 * `grandLivreProduction` (`depots/productions.ts`), et cette identite n'est pas
 * une coincidence : c'est elle qui fait tenir l'invariant
 * `somme(consommations.coutReelCents) + coutMatiereReelNonAffecteCents
 * === coutMatiereReelCents`, verifie a chaque scenario de
 * `productions-cout-reel.test.ts`. Si l'un des deux filtres change d'un cote
 * sans l'autre, ce test rougit — c'est le garde-fou qui remplace le partage de
 * code, la lecture et l'ecriture ne vivant pas dans le meme paquet de fichiers.
 *
 *  - `production_id = ?` : seuls `lancerProduction` et `saisirRealise` posent
 *    cette colonne sur un mouvement de stock. Verifie et non suppose :
 *    `enregistrerSortie` l'accepte en entree mais son unique appelant
 *    (`routes/stock.ts`) ne la fournit jamais, et `releve_temperature`
 *    porte bien un `production_id` mais n'est pas un mouvement de stock.
 *  - `ajustement = false` : ecarte les contrepassations, qui RECOPIENT le
 *    `production_id` de leur original. Une production annulee conserve ainsi
 *    le cout qui lui a deja ete facture (voir `annulerProduction`), au lieu de
 *    le voir retomber a zero.
 *
 * Le SIGNE vient du type, jamais de la quantite (toujours positive en base) :
 * une `entree` rattachee a une production est une RESTITUTION de
 * sous-consommation, elle retire du cout.
 *
 * Aucun arrondi ici : chaque `cout_cents` a deja ete arrondi une fois, au
 * moment de l'ecriture du mouvement. Recalculer « quantite x prix unitaire »
 * en referait un second et manquerait le total de quelques centimes.
 */
function coutMatiereReelDepuisMouvements(base: BaseBatte, productionId: string): number {
  return base
    .select({ type: mouvementStock.type, coutCents: mouvementStock.coutCents })
    .from(mouvementStock)
    .where(and(eq(mouvementStock.productionId, productionId), eq(mouvementStock.ajustement, false)))
    .all()
    .reduce((total, m) => total + (m.type === 'entree' ? -m.coutCents : m.coutCents), 0);
}

/**
 * Saisie du realise. Ne modifie JAMAIS le theorique : les deux coexistent, et
 * c'est de leur ecart que nait l'analyse.
 *
 * FICHE 9 (docs/17) : `consommationsReelles` declare, INGREDIENT PAR
 * INGREDIENT, ce qui a reellement ete consomme — jamais une valeur DERIVEE
 * par une regle de trois a partir du volume global, qui inventerait une
 * mesure (CLAUDE.md §7). `decomposerEcart` de `@batte/core` calcule l'ecart ;
 * cet ecart devient un vrai MOUVEMENT rattache a la production (regle n°5) :
 *
 *  - SUR-consommation (reel > theorique) : la matiere en plus est reellement
 *    sortie du stock ACTUEL, en FEFO — une nouvelle sortie, comme toute autre.
 *  - SOUS-consommation (reel < theorique) : la matiere non consommee est
 *    RESTITUEE aux lots que CETTE PRODUCTION a reellement consommes, dans
 *    l'ordre INVERSE de leur consommation d'origine (le dernier lot entame
 *    est le premier credite) — jamais a un lot que cette production n'a pas
 *    touche, ce serait une invention de tracabilite.
 *
 * `production_consommation.quantite_reelle` n'est fige QUE quand un SEUL lot a
 * ete consomme pour cet ingredient dans cette production : c'est la seule
 * situation ou la valeur declaree lui est attribuable sans inventer de
 * repartition. Sur plusieurs lots, la colonne reste `null` pour ces lignes —
 * le mouvement, lui, est ecrit dans tous les cas : c'est la que l'information
 * doit vivre, pas dans une colonne qui devine.
 *
 * `consommationsReelles` n'est accepte QUE sur la PREMIERE saisie du realise
 * (production encore `lancee`) : une seconde saisie ecrirait un second jeu de
 * mouvements pour le MEME ecart, doublant la correction. Volume et crepes,
 * eux, restent corrigibles a tout moment, comme avant.
 */
export function saisirRealise(
  base: BaseBatte,
  productionId: string,
  realise: RealiseProduction,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    const maintenant = maintenantUtc();

    const existante = baseTx.select().from(production).where(eq(production.id, productionId)).get();
    if (existante === undefined) throw new ErreurIntrouvable('Production', productionId);

    // Verrou de periode (docs/07 §1.6) : la saisie du realise ecrit ses
    // eventuels mouvements d'ecart a LA DATE DE LA PRODUCTION (jamais
    // « aujourd'hui », voir plus bas), donc verifiee sur cette date.
    verifierPeriodeNonVerrouillee(baseTx, existante.dateProduction);

    if (existante.statut === 'annulee') {
      throw new ErreurMetier(
        'production_annulee',
        `La production ${existante.numero} est annulée : son réalisé ne peut plus être saisi.`,
      );
    }
    if (realise.volumeReelMl < 0 || realise.crepesReelles < 0) {
      throw new ErreurMetier(
        'realise_invalide',
        'Le volume et le nombre de crêpes réalisés ne peuvent pas être négatifs.',
      );
    }

    const consommationsReelles = realise.consommationsReelles ?? [];
    if (consommationsReelles.length > 0 && existante.statut !== 'lancee') {
      throw new ErreurMetier(
        'consommation_reelle_deja_saisie',
        `La production ${existante.numero} a déjà un réalisé enregistré : la consommation ` +
          "réelle par ingrédient ne se déclare qu'une seule fois, à la première saisie.",
      );
    }

    /**
     * Lignes de consommation ECRITES AU LANCEMENT. Elles servent ICI a deux
     * choses, et a deux choses seulement : connaitre le THEORIQUE par
     * ingredient (pour en deduire l'ecart) et savoir a quels lots restituer
     * une sous-consommation.
     *
     * Elles ne servent PLUS a calculer le cout reel — voir
     * `coutMatiereReelDepuisMouvements`, et le defaut qui a impose ce
     * changement.
     */
    const consommations = baseTx
      .select({
        id: productionConsommation.id,
        lotId: productionConsommation.lotId,
        ingredientId: productionConsommation.ingredientId,
        quantiteTheorique: productionConsommation.quantiteTheorique,
        coutCents: productionConsommation.coutCents,
        nomIngredient: ingredient.nom,
        unite: ingredient.uniteReference,
        dateDlc: lot.dateDlc,
        dateReception: lot.dateReception,
      })
      .from(productionConsommation)
      .innerJoin(ingredient, eq(productionConsommation.ingredientId, ingredient.id))
      .innerJoin(lot, eq(productionConsommation.lotId, lot.id))
      .where(eq(productionConsommation.productionId, productionId))
      .all();

    // Motif structure des mouvements d'ecart : «écart constaté», la meme
    // categorie que l'inventaire, jamais du texte libre (docs/07 §6.8 rang 9).
    const motifEcartReel =
      consommationsReelles.length === 0
        ? undefined
        : baseTx
            .select({ id: motif.id })
            .from(motif)
            .where(eq(motif.code, 'INVENTAIRE_ECART'))
            .get();

    for (const declaration of consommationsReelles) {
      if (declaration.quantiteReelle < 0) {
        throw new ErreurMetier(
          'quantite_reelle_invalide',
          'La quantité réellement consommée ne peut pas être négative.',
          { champs: { quantiteReelle: 'Indiquez une quantité positive ou nulle.' } },
        );
      }

      const lignesIngredient = consommations.filter(
        (c) => c.ingredientId === declaration.ingredientId,
      );
      if (lignesIngredient.length === 0) {
        throw new ErreurMetier(
          'ingredient_non_consomme',
          `La production ${existante.numero} n'a consommé aucun ingrédient portant cet ` +
            'identifiant : rien à corriger.',
        );
      }

      const { unite, nomIngredient } = lignesIngredient[0]!;
      const theorique = lignesIngredient.reduce((total, l) => total + l.quantiteTheorique, 0);

      const lotsIngredient = lotsDeLIngredient(baseTx, declaration.ingredientId);
      /*
       * `calculerCump` rend `null` — jamais `0` — quand il ne reste aucun
       * stock, et son propre docstring dit pourquoi : « un ingredient epuise
       * n'a pas un cout de zero, il n'a pas de cout. Zero ferait apparaitre une
       * marge de 100 % sur la prochaine production. »
       *
       * Le `?? 0` qui se trouvait ici DEFAISAIT exactement la protection que
       * cette fonction existe pour offrir (audit des echecs silencieux,
       * 01/08/2026). Le zero traversait `decomposerEcart`, ressortait en
       * `coutEcartCents = 0`, et s'imprimait dans le `motifTexte` d'un
       * `mouvement_stock` — un enregistrement PERMANENT et INEFFACABLE
       * (regle n°7), qui est la piste d'audit AFSCA.
       *
       * Le porteur lisait donc « (evalue a 0,00 € au CUMP actuel) » sur un
       * ecart qui lui a bel et bien coute de la matiere, et le mouvement
       * portait a cote un `coutCents` reel non nul : la ligne d'audit
       * CONTREDISAIT le mouvement qu'elle decrit.
       *
       * Le cas n'est pas rare : il survient des que la production a vide le
       * stock de l'ingredient, c'est-a-dire le deroule normal.
       */
      const cumpActuel = calculerCump(lotsIngredient);
      const [ecartDecompose] = decomposerEcart(
        [
          {
            ingredientId: declaration.ingredientId,
            nomIngredient,
            unite,
            quantite: theorique,
            // `0` seulement pour la DECOMPOSITION, qui a besoin d'un nombre :
            // la valeur reellement affichee plus bas distingue, elle, le cout
            // inconnu du cout nul.
            cumpCentsParUnite: cumpActuel ?? 0,
          },
        ],
        new Map([[declaration.ingredientId, declaration.quantiteReelle]]),
      );
      const { ecart, coutEcartCents } = ecartDecompose!;

      // « inconnu » et « nul » ne se disent pas pareil, surtout dans un
      // registre que l'AFSCA peut demander a consulter.
      const evaluation =
        cumpActuel === null
          ? 'coût inconnu : il ne reste aucun stock de cet ingrédient, donc aucun CUMP à appliquer'
          : `évalué à ${(coutEcartCents / 100).toFixed(2)} € au CUMP actuel`;

      const motifTexteBase =
        `Écart réel de production ${existante.numero} — ${nomIngredient} : ` +
        `${formaterQuantite(theorique, unite)} théorique, ` +
        `${formaterQuantite(declaration.quantiteReelle, unite)} réel ` +
        `(${evaluation}).`;

      if (ecart > 0) {
        // SUR-consommation : la difference est reellement sortie du stock
        // ACTUEL, en FEFO — une nouvelle consommation, la meme regle que
        // toute autre sortie (regle n°5).
        const repartition = repartirFefo(lotsIngredient, ecart, existante.dateProduction);
        if (repartition.quantiteManquante > 0) {
          throw new ErreurMetier(
            'ecart_reel_stock_insuffisant',
            `La consommation réelle déclarée pour ${nomIngredient} dépasse le théorique de ` +
              `${formaterQuantite(ecart, unite)}, mais le stock actuel ne permet d'en tracer ` +
              `que ${formaterQuantite(ecart - repartition.quantiteManquante, unite)}.`,
            { champs: { quantiteReelle: 'Vérifiez la quantité saisie ou le stock disponible.' } },
          );
        }
        for (const allocation of repartition.allocations) {
          baseTx
            .insert(mouvementStock)
            .values({
              id: nouvelIdentifiant(),
              lotId: allocation.lotId,
              ingredientId: declaration.ingredientId,
              type: 'sortie_production',
              quantite: allocation.quantite,
              dateMouvement: existante.dateProduction,
              valuationDate: existante.dateProduction,
              ajustement: false,
              productionId,
              sessionId: existante.sessionId,
              motifId: motifEcartReel?.id ?? null,
              motifTexte: motifTexteBase,
              coutCents: allocation.coutCents,
              isAnnule: false,
              annuleParId: null,
              creePar: null,
              creeLe: maintenant,
            })
            .run();
        }
      } else if (ecart < 0) {
        // SOUS-consommation : restitue aux MEMES lots que cette production a
        // consommes, dans l'ordre INVERSE de la FEFO d'origine.
        let aRendre = -ecart;
        for (const ligne of parOrdreFefo(lignesIngredient).reverse()) {
          if (aRendre <= 0) break;
          const quantite = Math.min(aRendre, ligne.quantiteTheorique);
          if (quantite <= 0) continue;
          const prixUnitaireCents =
            ligne.quantiteTheorique > 0 ? ligne.coutCents / ligne.quantiteTheorique : 0;
          const coutCentsLigne = Math.round(quantite * prixUnitaireCents);

          baseTx
            .insert(mouvementStock)
            .values({
              id: nouvelIdentifiant(),
              lotId: ligne.lotId,
              ingredientId: declaration.ingredientId,
              type: 'entree',
              quantite,
              dateMouvement: existante.dateProduction,
              valuationDate: existante.dateProduction,
              ajustement: false,
              productionId,
              sessionId: existante.sessionId,
              motifId: motifEcartReel?.id ?? null,
              motifTexte: `${motifTexteBase} Restitué au lot.`,
              coutCents: coutCentsLigne,
              isAnnule: false,
              annuleParId: null,
              creePar: null,
              creeLe: maintenant,
            })
            .run();

          aRendre -= quantite;
        }
      }

      // Figeage de `quantite_reelle`, SEULEMENT quand un seul lot a ete
      // consomme pour cet ingredient : seule situation ou la valeur declaree
      // lui est attribuable sans inventer de repartition.
      if (lignesIngredient.length === 1) {
        baseTx
          .update(productionConsommation)
          .set({ quantiteReelle: declaration.quantiteReelle })
          .where(eq(productionConsommation.id, lignesIngredient[0]!.id))
          .run();
      }
    }

    baseTx
      .update(production)
      .set({
        volumeReelMl: realise.volumeReelMl,
        crepesReelles: realise.crepesReelles,
        // DERIVE du grand livre, jamais reaccumule : voir
        // `coutMatiereReelDepuisMouvements`. Calcule ICI, apres l'ecriture des
        // mouvements d'ecart ci-dessus, pour que ces derniers soient dans la
        // somme — la lecture voit les ecritures de sa propre transaction.
        coutMatiereReelCents: coutMatiereReelDepuisMouvements(baseTx, productionId),
        statut: 'terminee',
        ecartMotif: realise.ecartMotif ?? existante.ecartMotif,
        modifieLe: maintenant,
      })
      .where(eq(production.id, productionId))
      .run();
  });
}

export type ResultatAnnulationProduction = {
  readonly productionId: string;
  readonly numero: string;
  /** Mouvements de stock contrepassés : la consommation d'origine ET tout écart de réalisé. */
  readonly nbMouvementsContrepasses: number;
};

/**
 * Annule une production : CONTREPASSE tous ses mouvements de stock non déjà
 * annulés, puis marque la production `annulee`.
 *
 * DÉFAUT TROUVÉ À L'AUDIT (29/07/2026) : `schemaStatutProduction` prévoit
 * l'état `annulee` depuis le Lot 3, `saisirRealise` le REFUSE déjà
 * explicitement en entrée (« La production … est annulée : son réalisé ne
 * peut plus être saisi. »), et `depots/previsions.ts` comme
 * `services/sessions.ts` (D-038) EXCLUENT déjà les productions `annulee` de
 * leurs sommes — mais AUCUN chemin du dépôt n'écrivait ce statut. Le modèle de
 * données anticipait l'annulation ; rien ne savait la produire. Une production
 * lancée par erreur (mauvaise recette, mauvaise cible) restait donc
 * DÉFINITIVEMENT engagée, stock consommé compris — en violation directe de la
 * règle d'architecture n°5 : une correction se fait par écriture d'annulation
 * (règle n°7), jamais en laissant l'erreur engagée faute de chemin de retour.
 *
 * RÉUTILISE `contrepasserMouvement` (`services/mouvements.ts`), mouvement par
 * mouvement, dans CETTE MEME transaction : c'est le même cœur que
 * `annulerMouvement`, donc la même garantie D-021 (une écriture ne se
 * contrepasse qu'une seule fois, les deux écritures restent dans les sommes)
 * s'applique ici SANS dupliquer la logique de contrepassation — un second
 * chemin de contrepassation qui divergerait un jour du premier serait
 * exactement le genre d'incohérence qu'un contrôle AFSCA finit par trouver.
 *
 * Couvre à la fois la consommation D'ORIGINE (écrite par `lancerProduction`)
 * ET tout mouvement d'écart déjà écrit par `saisirRealise` (fiche 9) : les
 * deux portent `mouvement_stock.production_id`, donc les deux sont repris ici.
 * Une production `terminee` (réalisé déjà saisi) est donc annulable au même
 * titre qu'une production `lancee` — l'erreur peut se découvrir après coup.
 *
 * Refuse :
 *  - si la production est DÉJÀ `annulee` (même règle que `deja_annule` sur un
 *    mouvement isolé : une annulation ne se rejoue pas, sans quoi une seconde
 *    annulation contrepasserait des mouvements déjà contrepassés — impossible
 *    ici puisque `contrepasserMouvement` filtre déjà sur `isAnnule = false`,
 *    mais le refus explicite évite un « 0 mouvement contrepassé » silencieux
 *    qui laisserait croire à une annulation alors qu'il n'y avait rien à
 *    annuler) ;
 *  - si la production est rattachée à une session DÉJÀ CLÔTURÉE — même garde
 *    que `verifierSessionRattachable` (D-024) : les agrégats de cette session
 *    sont figés, annuler la production changerait un coût matière déjà arrêté
 *    sans que la marge affichée ne le répercute jamais.
 */
export function annulerProduction(
  base: BaseBatte,
  productionId: string,
  motifCode: CodeMotif,
  creePar?: string | null,
): ResultatAnnulationProduction {
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const existante = baseTx.select().from(production).where(eq(production.id, productionId)).get();
    if (existante === undefined) throw new ErreurIntrouvable('Production', productionId);

    // Verrou de periode (docs/07 §1.6) : verifiee ICI, et pas seulement via
    // `contrepasserMouvement` plus bas, pour couvrir aussi le cas ou AUCUN
    // mouvement n'est a contrepasser (deja tous annules individuellement) —
    // sans quoi cette annulation passerait sans jamais consulter le verrou.
    verifierPeriodeNonVerrouillee(baseTx, existante.dateProduction);

    if (existante.statut === 'annulee') {
      throw new ErreurMetier(
        'production_deja_annulee',
        `La production ${existante.numero} est déjà annulée : une écriture ne se contrepasse ` +
          'qu’une seule fois.',
      );
    }

    if (existante.sessionId !== null) {
      const session = baseTx
        .select({ numero: sessionMarche.numero, statut: sessionMarche.statut })
        .from(sessionMarche)
        .where(eq(sessionMarche.id, existante.sessionId))
        .get();
      if (session !== undefined && session.statut === 'cloturee') {
        throw new ErreurMetier(
          'session_cloturee',
          `La production ${existante.numero} est rattachée à la session ${session.numero}, ` +
            'déjà clôturée : ses agrégats sont figés (D-024). Cette production ne peut plus ' +
            'être annulée.',
        );
      }
    }

    // Tous les mouvements NON DEJA ANNULES rattaches a cette production :
    // la consommation d'origine ET tout ecart de realise (fiche 9), qui
    // portent tous les deux `production_id`.
    const mouvements = baseTx
      .select({ id: mouvementStock.id })
      .from(mouvementStock)
      .where(and(eq(mouvementStock.productionId, productionId), eq(mouvementStock.isAnnule, false)))
      .all();

    for (const m of mouvements) {
      contrepasserMouvement(baseTx, m.id, motifCode, creePar);
    }

    const apres = baseTx
      .update(production)
      .set({ statut: 'annulee', modifieLe: maintenantUtc() })
      .where(eq(production.id, productionId))
      .returning()
      .get();

    // Journal d'audit sur la production elle-meme (CLAUDE.md §3 regle 7) :
    // chaque mouvement contrepasse porte deja sa propre trace via
    // `contrepasserMouvement` ; celle-ci est la trace de la DECISION
    // d'annuler la production, distincte de ses consequences sur le stock.
    journaliser(baseTx, {
      table: 'production',
      enregistrementId: productionId,
      action: 'annulation',
      valeurAvant: existante,
      valeurApres: apres,
      parQui: creePar ?? null,
    });

    return {
      productionId,
      numero: existante.numero,
      nbMouvementsContrepasses: mouvements.length,
    };
  });
}

/**
 * Rattache (ou detache, ou corrige) le rattachement d'une production a une
 * session, INDEPENDAMMENT du realise (docs/14 G1/G4). C'est le geste
 * manquant : avant ce lot, `production.session_id` ne pouvait etre pose qu'au
 * lancement, jamais corrige ni renseigne apres coup — or la pate se lance
 * souvent avant que la session du marche n'existe encore.
 *
 * Verrouille dans LES DEUX SENS, pas seulement a l'arrivee :
 *  - la session CIBLE ne doit pas etre cloturee (`verifierSessionRattachable`) ;
 *  - si la production est DEJA rattachee a une session cloturee, ce
 *    rattachement ne bouge plus non plus. La tracabilite aval
 *    (`tracabiliteAvalLot`) lit `production.session_id` en direct : detacher
 *    une production d'une session deja fermee romprait, pour un controle
 *    AFSCA, un registre qui ne doit plus changer une fois la piece close.
 */
export function rattacherSession(
  base: BaseBatte,
  productionId: string,
  sessionId: string | null,
): void {
  const existante = base.select().from(production).where(eq(production.id, productionId)).get();
  if (existante === undefined) throw new ErreurIntrouvable('Production', productionId);

  if (existante.sessionId !== null) {
    const actuelle = base
      .select({ numero: sessionMarche.numero, statut: sessionMarche.statut })
      .from(sessionMarche)
      .where(eq(sessionMarche.id, existante.sessionId))
      .get();
    if (actuelle !== undefined && actuelle.statut === 'cloturee') {
      throw new ErreurMetier(
        'session_source_cloturee',
        `La production ${existante.numero} est rattachée à la session ${actuelle.numero}, déjà ` +
          'clôturée : ses agrégats sont figés (D-024). Ce rattachement ne peut plus être modifié.',
      );
    }
  }

  if (sessionId !== null) verifierSessionRattachable(base, sessionId);

  base
    .update(production)
    .set({ sessionId, modifieLe: maintenantUtc() })
    .where(eq(production.id, productionId))
    .run();
}

/**
 * Verifie qu'une prevision existe avant d'y rattacher une production au
 * lancement (`lancerProduction` uniquement — il n'existe pas de rattachement
 * apres coup symetrique de `rattacherSession` : la prevision courante est
 * deja connue au moment ou la decision de produire se prend, contrairement a
 * la session du marche qui peut n'exister que plus tard).
 *
 * Rend aussi `sessionId` de la prevision, pour que l'appelant puisse
 * verifier — quand une session est EGALEMENT fournie au lancement — que les
 * deux ne pointent pas vers deux marches differents : une prevision d'une
 * AUTRE session n'a pas pu motiver CETTE fournee.
 */
function verifierPrevisionRattachable(
  base: BaseBatte,
  previsionId: string,
): { id: string; sessionId: string | null } {
  const trouvee = base
    .select({ id: prevision.id, sessionId: prevision.sessionId })
    .from(prevision)
    .where(eq(prevision.id, previsionId))
    .get();
  if (trouvee === undefined) throw new ErreurIntrouvable('Prevision', previsionId);
  return trouvee;
}

/** Session rattachee, telle que rendue a l'ecran : jamais un UUID, toujours le numero lisible. */
export type SessionRattacheeInfo = {
  id: string;
  numero: string;
  statut: (typeof sessionMarche.$inferSelect)['statut'];
};

/**
 * Sessions rattachees a un ensemble de productions, pour enrichir une reponse
 * HTTP (numero lisible, jamais un UUID a l'ecran) SANS toucher au depot de
 * lecture `depots/productions.ts` (hors perimetre de ce lot — voir le rapport
 * de livraison pour ce qui reste a cabler dans le baril `@batte/db`).
 *
 * Rend une entree pour CHAQUE id demande, `null` pour une production non
 * rattachee — jamais une cle absente, pour que l'appelant n'ait pas a deviner
 * la difference entre « pas encore rattachee » et « pas encore interroge ».
 */
export function sessionsDesProductions(
  base: BaseBatte,
  productionIds: readonly string[],
): Map<string, SessionRattacheeInfo | null> {
  const carte = new Map<string, SessionRattacheeInfo | null>();
  for (const id of productionIds) carte.set(id, null);
  if (productionIds.length === 0) return carte;

  const lignes = base
    .select({
      productionId: production.id,
      sessionId: production.sessionId,
      sessionNumero: sessionMarche.numero,
      sessionStatut: sessionMarche.statut,
    })
    .from(production)
    .leftJoin(sessionMarche, eq(production.sessionId, sessionMarche.id))
    .where(inArray(production.id, productionIds))
    .all();

  for (const ligne of lignes) {
    if (ligne.sessionId === null || ligne.sessionNumero === null || ligne.sessionStatut === null) {
      continue; // reste `null`, deja pose par la boucle d'initialisation.
    }
    carte.set(ligne.productionId, {
      id: ligne.sessionId,
      numero: ligne.sessionNumero,
      statut: ligne.sessionStatut,
    });
  }
  return carte;
}
