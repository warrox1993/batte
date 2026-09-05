/**
 * Sorties de stock et changements de statut de lot.
 *
 * Toute sortie passe par la FEFO de `@batte/core` et exige un MOTIF CODE.
 * Sans code, on ne peut pas repondre a « ou fuit la matiere ? » — et un ecart
 * qu'on ne peut pas attribuer est un ecart qu'on ne peut pas corriger
 * (docs/07 §6.8 rang 9).
 */

import {
  ErreurMetier,
  definitionMotif,
  formaterQuantite,
  maintenantUtc,
  nouvelIdentifiant,
  repartirFefo,
  type CodeMotif,
  type Parametres,
} from '@batte/core';
import { eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { ingredient, lot, motif, mouvementStock } from '../schema.js';
import { journaliser } from '../depots/audit.js';
import { verifierPeriodeNonVerrouillee } from '../depots/comptabilite.js';
import { lireParametres } from '../depots/parametres.js';
import { lotsDeLIngredient } from '../depots/stock.js';
import { declarerNonConformite } from './afsca.js';

/** Types de sortie possibles. L'entree n'en fait pas partie : elle vient d'une reception. */
export type TypeSortie =
  'sortie_production' | 'sortie_vente' | 'perte' | 'ajustement_inventaire' | 'consommation_perso';

export type EntreeSortie = {
  readonly ingredientId: string;
  readonly quantite: number;
  readonly type: TypeSortie;
  /** Code du catalogue de motifs. Obligatoire : c'est ce qui rend l'écart analysable. */
  readonly motifCode: CodeMotif;
  readonly motifTexte?: string | null;
  /** Jour civil belge du mouvement. */
  readonly dateMouvement: string;
  /**
   * Autorise a consommer un lot perime. Exige un motif — c'est la condition
   * exacte posee par l'invariant n°2 de docs/02.
   */
  readonly autoriserDlcDepassee?: boolean;
  readonly productionId?: string | null;
  readonly sessionId?: string | null;
  readonly creePar?: string | null;
};

export type ResultatSortie = {
  mouvements: { id: string; lotId: string; quantite: number; coutCents: number }[];
  coutTotalCents: number;
};

function resoudreMotif(base: BaseBatte, code: CodeMotif): string {
  const trouve = base.select({ id: motif.id }).from(motif).where(eq(motif.code, code)).get();
  if (trouve === undefined) {
    throw new ErreurMetier(
      'motif_inconnu',
      `Le motif « ${code} » n'existe pas. Lancez « npm run db:seed » pour charger le catalogue.`,
      { statut: 500 },
    );
  }
  return trouve.id;
}

/**
 * Sort de la matiere du stock, en FEFO, de facon atomique.
 *
 * Echoue si le stock est insuffisant — et le message porte le CHIFFRE MANQUANT,
 * pas un « stock insuffisant » sec : docs/07 §6.3 impose de signaler
 * l'impossibilite avec la donnee qui manque.
 */
export function enregistrerSortie(base: BaseBatte, entree: EntreeSortie): ResultatSortie {
  if (entree.quantite <= 0) {
    throw new ErreurMetier(
      'quantite_invalide',
      'La quantité à sortir doit être strictement positive.',
      { champs: { quantite: 'La quantité doit être supérieure à zéro.' } },
    );
  }

  // Verrou de periode (docs/07 §1.6, CLAUDE.md §3 regle 7) : un mouvement de
  // stock date dans un exercice verrouille est refuse avant toute autre ecriture.
  verifierPeriodeNonVerrouillee(base, entree.dateMouvement);

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    const motifId = resoudreMotif(baseTx, entree.motifCode);

    const ing = baseTx
      .select({ nom: ingredient.nom, unite: ingredient.uniteReference })
      .from(ingredient)
      .where(eq(ingredient.id, entree.ingredientId))
      .get();
    if (ing === undefined) {
      throw new ErreurMetier('ingredient_introuvable', 'Ingrédient introuvable.', { statut: 404 });
    }

    const lots = lotsDeLIngredient(baseTx, entree.ingredientId);
    const repartition = repartirFefo(lots, entree.quantite, entree.dateMouvement, {
      autoriserDlcDepassee: entree.autoriserDlcDepassee ?? false,
    });

    if (repartition.quantiteManquante > 0) {
      throw new ErreurMetier(
        'stock_insuffisant',
        `Stock insuffisant en ${ing.nom} : il manque ` +
          `${formaterQuantite(repartition.quantiteManquante, ing.unite)}.`,
        {
          champs: {
            quantite: `Disponible : ${formaterQuantite(
              entree.quantite - repartition.quantiteManquante,
              ing.unite,
            )}.`,
          },
        },
      );
    }

    const maintenant = maintenantUtc();
    const mouvements: ResultatSortie['mouvements'] = [];

    for (const allocation of repartition.allocations) {
      const id = nouvelIdentifiant();
      baseTx
        .insert(mouvementStock)
        .values({
          id,
          lotId: allocation.lotId,
          ingredientId: entree.ingredientId,
          type: entree.type,
          quantite: allocation.quantite,
          dateMouvement: entree.dateMouvement,
          valuationDate: entree.dateMouvement,
          ajustement: false,
          productionId: entree.productionId ?? null,
          sessionId: entree.sessionId ?? null,
          motifId,
          // La consommation d'un lot perime laisse une trace explicite dans le
          // texte du motif : c'est ce que l'invariant n°2 appelle « motif
          // explicite enregistre ».
          motifTexte: allocation.dlcDepassee
            ? `${entree.motifTexte ?? ''} [lot consommé malgré DLC dépassée]`.trim()
            : (entree.motifTexte ?? null),
          coutCents: allocation.coutCents,
          isAnnule: false,
          annuleParId: null,
          creePar: entree.creePar ?? null,
          creeLe: maintenant,
        })
        .run();

      mouvements.push({
        id,
        lotId: allocation.lotId,
        quantite: allocation.quantite,
        coutCents: allocation.coutCents,
      });
    }

    return { mouvements, coutTotalCents: repartition.coutTotalCents };
  });
}

/**
 * Coeur de la contrepassation d'UN mouvement, SANS ouvrir de transaction.
 *
 * Extrait d'`annulerMouvement` pour etre reutilisable par un appelant qui doit
 * contrepasser PLUSIEURS mouvements de facon atomique — `annulerProduction`
 * (ci-dessous) annule TOUS les mouvements d'une production dans UNE SEULE
 * transaction : soit toutes les contrepassations passent, soit aucune. Meme
 * patron que `ecrireReleveTemperature` / `enregistrerReleveTemperature`
 * (`services/afsca.ts`) : un coeur qui prend le handle tel qu'on le lui donne,
 * et un point d'entree HTTP autonome qui ouvre SA PROPRE transaction autour.
 *
 * Une ecriture ne peut etre contrepassee qu'UNE SEULE FOIS (docs/07 §1.4) :
 * sans cette regle, deux annulations successives creeraient de la matiere.
 */
function contrepasserMouvement(
  baseTx: BaseBatte,
  mouvementId: string,
  motifCode: CodeMotif,
  creePar?: string | null,
): string {
  const origine = baseTx
    .select()
    .from(mouvementStock)
    .where(eq(mouvementStock.id, mouvementId))
    .get();

  if (origine === undefined) {
    throw new ErreurMetier('mouvement_introuvable', 'Mouvement introuvable.', { statut: 404 });
  }
  if (origine.isAnnule) {
    throw new ErreurMetier(
      'deja_annule',
      "Ce mouvement a déjà été annulé. Une écriture ne se contrepasse qu'une seule fois.",
    );
  }

  // Verrou de periode (docs/07 §1.6) : la contrepassation porte la MEME date
  // que l'original (ci-dessous), jamais « aujourd'hui » — donc verifiee sur
  // CETTE date. Consequence assumee, voir le commentaire de
  // `verifierPeriodeNonVerrouillee` : un mouvement de stock dont la date est
  // verrouillee ne se corrige plus DU TOUT dans l'application, y compris par
  // contrepassation — « irreversible meme pour un administrateur ».
  verifierPeriodeNonVerrouillee(baseTx, origine.dateMouvement);

  /**
   * GARDE-FOU (audit du 30/07/2026) : contrepasser une ENTREE retire de la
   * matiere du lot — l'inverse de contrepasser une sortie, qui lui en rend.
   * Si ce lot a DEJA ete consomme, en tout ou en partie, par une ecriture
   * posterieure (production, vente, destruction), cette matiere a REELLEMENT
   * ete utilisee : elle ne peut pas etre « desreçue ». Sans ce controle, la
   * contrepassation ECRIT quand meme — elle journalise, elle a l'air de
   * reussir — tout en fabriquant un `quantite_restante` NEGATIF sur ce lot,
   * une impossibilite physique que `verifierInvariantLots` (`depots/stock.ts`)
   * sait nommer mais qu'aucun point d'ecriture ne refusait encore. C'est
   * exactement le piege le plus dangereux : une annulation qui semble
   * fonctionner. Les sorties, elles, n'ont besoin d'aucune garde symetrique :
   * les rendre AJOUTE de la matiere, ce qui ne peut jamais aller sous zero.
   */
  if (origine.type === 'entree') {
    const restant =
      lotsDeLIngredient(baseTx, origine.ingredientId).find((l) => l.id === origine.lotId)
        ?.quantiteRestante ?? 0;

    if (restant < origine.quantite) {
      const ing = baseTx
        .select({ nom: ingredient.nom, unite: ingredient.uniteReference })
        .from(ingredient)
        .where(eq(ingredient.id, origine.ingredientId))
        .get();
      const unite = ing?.unite ?? 'g';
      throw new ErreurMetier(
        'entree_deja_consommee',
        `${ing?.nom ?? 'Ce lot'} : il ne reste que ${formaterQuantite(restant, unite)} sur ce lot, ` +
          `pour une entrée de ${formaterQuantite(origine.quantite, unite)}. Annuler cette entrée ` +
          'ferait passer le stock sous zéro : cette matière a déjà été réellement consommée ' +
          '(production, vente ou destruction), elle ne peut pas être « désreçue ». Corrigez ' +
          "plutôt la consommation qui en a disposé, ou passez par un ajustement d'inventaire.",
      );
    }
  }

  const motifId = resoudreMotif(baseTx, motifCode);
  const maintenant = maintenantUtc();
  const idContrepassation = nouvelIdentifiant();

  // La contrepassation porte le type INVERSE et la MEME date que l'original,
  // afin que les cumuls d'une periode close ne bougent pas.
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
      motifId,
      motifTexte: `Contrepassation du mouvement ${mouvementId}`,
      coutCents: origine.coutCents,
      isAnnule: false,
      annuleParId: null,
      creePar: creePar ?? null,
      creeLe: maintenant,
    })
    .run();

  // L'original reste LISIBLE : on le marque annulé, on ne l'efface pas.
  const apres = baseTx
    .update(mouvementStock)
    .set({ isAnnule: true, annuleParId: idContrepassation })
    .where(eq(mouvementStock.id, mouvementId))
    .returning()
    .get();

  // Journal d'audit, DANS la meme transaction (CLAUDE.md §3 regle 7 :
  // « journal d'audit sur toutes les tables sensibles »). Une contrepassation
  // est le seul geste qui defait une ecriture de stock : c'est exactement
  // celui dont il faut pouvoir dire plus tard qui l'a fait, quand, et sous
  // quel motif. Sans cette trace, le mouvement annule se lisait mais la
  // DECISION de l'annuler ne se lisait nulle part.
  journaliser(baseTx, {
    table: 'mouvement_stock',
    enregistrementId: mouvementId,
    action: 'annulation',
    valeurAvant: origine,
    valeurApres: apres,
    parQui: creePar ?? null,
  });

  return idContrepassation;
}

/**
 * Annule un mouvement par CONTREPASSATION, jamais par suppression.
 *
 * Point d'entree HTTP autonome : ouvre SA PROPRE transaction autour de
 * `contrepasserMouvement`, qui porte la regle complete.
 */
export function annulerMouvement(
  base: BaseBatte,
  mouvementId: string,
  motifCode: CodeMotif,
  creePar?: string | null,
): string {
  return base.transaction((tx) =>
    contrepasserMouvement(tx as unknown as BaseBatte, mouvementId, motifCode, creePar),
  );
}

/** Reexporte pour `services/production.ts` : voir `contrepasserMouvement` ci-dessus. */
export { contrepasserMouvement };

/** Ce que `changerStatutLot` rend quand le nouveau statut est `detruit`. */
export type ResultatChangementStatut = {
  /**
   * Identifiant du mouvement de perte écrit pour cette destruction. `null` si
   * le lot ne portait déjà plus aucune matière (rien à sortir du stock) ou si
   * le nouveau statut n'est pas `detruit` — un changement de quarantaine ou de
   * blocage ne retire rien du stock, donc n'écrit aucun mouvement.
   */
  mouvementDestructionId: string | null;
  /** Quantité écrite sur ce mouvement, dans l'unité de référence de l'ingrédient. */
  quantiteDetruite: number | null;
  /** Coût de cette quantité, valorisé au prix payé pour CE lot. */
  coutDetruitCents: number | null;
};

/**
 * Change le statut d'un lot. Le changement est trace : motif et date obligatoires.
 *
 * `schema.ts` motive le mecanisme : « un ERP BLOQUE et exige un deblocage
 * explicite trace ; c'est aussi une exigence AFSCA : un lot suspecte doit
 * pouvoir etre mis en quarantaine avant decision. » Le mot « trace » est la
 * partie qui manquait : la colonne `motif_statut_id` gardait le DERNIER motif,
 * donc un lot mis en quarantaine puis relache ne portait plus aucune trace de
 * la quarantaine. L'historique complet vit maintenant dans `journal_audit`.
 *
 * RÈGLE D'ARCHITECTURE N°5 (CLAUDE.md §3) : passer au statut `detruit` retire
 * de la matière du stock ; ça ne peut donc PAS n'être qu'une mise à jour de
 * statut, comme toute autre sortie ça doit s'écrire en MOUVEMENT (docs/09 M9,
 * docs/17 fiche 18). Avant cette règle, la quantité disparaissait de la
 * valorisation (`packages/core/src/stock.ts` exclut déjà `statut === 'detruit'`
 * de `calculerCump`/`valoriserStock`) sans qu'aucune ligne du journal ne
 * l'explique — exactement ce qu'un contrôle AFSCA vient vérifier. La quantité
 * écrite est le restant du lot au moment de la destruction, calculé par la
 * MÊME arithmétique que `depots/stock.ts` (somme signée des mouvements :
 * `entree` compte pour `+`, tout le reste pour `-`) : c'est ce qui garantit
 * que la somme des mouvements retombe à zéro, sans avoir besoin du filtre sur
 * `statut` pour le faire paraître. Le motif est celui choisi pour le
 * changement de statut lui-même — c'est la même décision qui explique les
 * deux écritures.
 */

/**
 * Motifs de `CATALOGUE_MOTIFS` (`packages/core/src/motifs.ts`) qui, appliqués
 * à un changement de STATUT de lot, ouvrent automatiquement une
 * non-conformité liée à ce lot — même principe que `ecrireReleveTemperature`
 * pour un relevé hors seuil (fiche 15, `services/afsca.ts`) : « une
 * non-conformité qu'on peut oublier d'ouvrir n'est pas un contrôle ».
 *
 * DÉFAUT CORRIGÉ (audit du 29/07/2026, `audit-afsca.test.ts`) : bloquer un lot
 * pour `RAPPEL_FOURNISSEUR` — l'événement le plus grave que ce catalogue sache
 * nommer — n'écrivait qu'un mouvement de perte et une ligne de
 * `journal_audit`, jamais de non-conformité. Or `registreAfscaMensuel`
 * (`apps/api/src/documents/registre-afsca.ts`) tire sa section
 * « Non-conformités » EXCLUSIVEMENT de la table `non_conformite`, jamais du
 * journal d'audit : un rappel fournisseur ayant bloqué un lot était donc
 * absent du document présenté à un contrôle.
 *
 * MIGRÉ VERS LE CATALOGUE DE PARAMÈTRES (29/07/2026) : cette liste vivait au
 * départ codée en dur ici, marquée `[HYPOTHÈSE]`, parce que
 * `packages/core/src/parametres.ts` était alors hors de la zone d'écriture de
 * la mission qui l'a introduite. Elle vit désormais dans le paramètre
 * `afsca_motifs_incident_sanitaire_json` — CLAUDE.md §7 : « ne pas coder en
 * dur une convention réglementaire ». Le RAISONNEMENT complet (pourquoi ces
 * quatre motifs, pourquoi `LEVEE_QUARANTAINE` en est exclu) vit désormais
 * dans la `description` de ce paramètre — c'est elle qu'il faut lire et
 * mettre à jour, pas ce commentaire, si la liste doit un jour changer. Le
 * comportement par défaut est INCHANGÉ : la valeur par défaut du paramètre
 * est exactement la même liste que celle qui vivait ici.
 */
function motifsIncidentSanitaire(parametres: Parametres): ReadonlySet<string> {
  const brut = parametres.texte('afsca_motifs_incident_sanitaire_json');
  let valeur: unknown;
  try {
    valeur = JSON.parse(brut);
  } catch (erreur) {
    throw new ErreurMetier(
      'parametre_motifs_incident_sanitaire_invalide',
      'Le paramètre « afsca_motifs_incident_sanitaire_json » n’est pas du JSON valide.',
      { cause: erreur },
    );
  }
  if (!Array.isArray(valeur) || !valeur.every((element) => typeof element === 'string')) {
    throw new ErreurMetier(
      'parametre_motifs_incident_sanitaire_invalide',
      'Le paramètre « afsca_motifs_incident_sanitaire_json » doit être un tableau de codes motif.',
    );
  }
  return new Set(valeur);
}

function motifOuvreNonConformite(motifCode: CodeMotif, parametres: Parametres): boolean {
  return motifsIncidentSanitaire(parametres).has(motifCode);
}

export function changerStatutLot(
  base: BaseBatte,
  lotId: string,
  statut: 'disponible' | 'quarantaine' | 'bloque' | 'detruit',
  motifCode: CodeMotif,
  /** Jour civil belge du mouvement de destruction, si le nouveau statut en écrit un. */
  dateMouvement: string,
  parQui?: string | null,
): ResultatChangementStatut {
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    const motifId = resoudreMotif(baseTx, motifCode);
    const maintenant = maintenantUtc();

    const avant = baseTx.select().from(lot).where(eq(lot.id, lotId)).get();
    if (avant === undefined) {
      throw new ErreurMetier('lot_introuvable', 'Lot introuvable.', { statut: 404 });
    }
    if (avant.statut === statut) {
      // Refuser plutot que d'ecrire une ligne d'audit qui ne dit rien : un
      // journal rempli de changements sans changement est un journal qu'on
      // cesse de lire.
      throw new ErreurMetier(
        'statut_inchange',
        `Ce lot est déjà en statut « ${statut} » : il n'y a rien à changer.`,
      );
    }

    // Verrou de periode (docs/07 §1.6) : `dateMouvement` date ce changement de
    // statut QUELLE QUE SOIT sa nature (il fixe aussi la date de lecture des
    // parametres pour la non-conformite automatique, plus bas) — pas
    // seulement une destruction, qui, elle, ecrit en plus un mouvement.
    verifierPeriodeNonVerrouillee(baseTx, dateMouvement);

    let resultatDestruction: ResultatChangementStatut = {
      mouvementDestructionId: null,
      quantiteDetruite: null,
      coutDetruitCents: null,
    };

    if (statut === 'detruit') {
      // Restant calcule EXACTEMENT comme `SQL_RESTANT` de `depots/stock.ts` :
      // c'est la seule arithmetique juste (regle n°5 — le stock est la somme
      // de ses mouvements), et elle doit rester identique des deux cotes,
      // sinon la destruction pourrait laisser un ecart entre ce que ce
      // service croit avoir sorti et ce que le stock affiche.
      const mouvementsExistants = baseTx
        .select({ type: mouvementStock.type, quantite: mouvementStock.quantite })
        .from(mouvementStock)
        .where(eq(mouvementStock.lotId, lotId))
        .all();
      const restant = mouvementsExistants.reduce(
        (somme, m) => somme + (m.type === 'entree' ? m.quantite : -m.quantite),
        0,
      );

      // Un lot deja vide (entierement consomme) peut etre marque detruit pour
      // memoire, sans qu'il y ait la moindre matiere a sortir : aucun
      // mouvement de quantite nulle ne s'ecrit (`enregistrerSortie` refuse
      // deja ce cas ailleurs, meme regle ici).
      if (restant > 0) {
        const prixUnitaireCents =
          avant.quantiteInitiale > 0 ? avant.prixLigneCents / avant.quantiteInitiale : 0;
        const coutCents = Math.round(restant * prixUnitaireCents);
        const idMouvement = nouvelIdentifiant();

        baseTx
          .insert(mouvementStock)
          .values({
            id: idMouvement,
            lotId,
            ingredientId: avant.ingredientId,
            type: 'perte',
            quantite: restant,
            dateMouvement,
            valuationDate: dateMouvement,
            ajustement: false,
            productionId: null,
            sessionId: null,
            motifId,
            motifTexte: 'Destruction du lot (changement de statut).',
            coutCents,
            isAnnule: false,
            annuleParId: null,
            creePar: parQui ?? null,
            creeLe: maintenant,
          })
          .run();

        resultatDestruction = {
          mouvementDestructionId: idMouvement,
          quantiteDetruite: restant,
          coutDetruitCents: coutCents,
        };
      }
    }

    const apres = baseTx
      .update(lot)
      .set({
        statut,
        motifStatutId: motifId,
        dateChangementStatut: maintenant,
        modifieLe: maintenant,
      })
      .where(eq(lot.id, lotId))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'lot',
      enregistrementId: lotId,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });

    // Non-conformité automatique, DANS LA MÊME TRANSACTION que le changement
    // de statut (et la destruction, le cas échéant) — soit les écritures
    // passent toutes, soit aucune. Voir `motifOuvreNonConformite` ci-dessus
    // pour la liste des motifs concernés et sa justification. Paramètres lus
    // à la date MÉTIER du mouvement (jamais « aujourd'hui ») : même règle que
    // `ecrireReleveTemperature`, pour qu'une révision future de la liste ne
    // réécrive pas silencieusement l'historique déjà clos.
    const parametres = lireParametres(baseTx, dateMouvement);
    if (motifOuvreNonConformite(motifCode, parametres)) {
      const ing = baseTx
        .select({ nom: ingredient.nom })
        .from(ingredient)
        .where(eq(ingredient.id, avant.ingredientId))
        .get();
      const libelleMotif = definitionMotif(motifCode)?.libelle ?? motifCode;

      declarerNonConformite(baseTx, {
        dateConstat: dateMouvement,
        type: libelleMotif,
        description:
          `${ing?.nom ?? avant.ingredientId} — lot ${avant.numeroLotFournisseur ?? lotId}, ` +
          `passé de « ${avant.statut} » à « ${statut} » le ${dateMouvement}.`,
        // Un rappel fournisseur est l'événement le plus grave du catalogue :
        // seul lui reçoit la gravité maximale, les trois autres motifs
        // restent des doutes ou des pertes subies, pas encore un rappel
        // public (même échelle que `ecrireReleveTemperature`, qui retient
        // 'majeure' pour un hors-seuil).
        gravite: motifCode === 'RAPPEL_FOURNISSEUR' ? 'critique' : 'majeure',
        lotId,
      });
    }

    return resultatDestruction;
  });
}

/**
 * NOTE DE PORTEE — la LISTE des mouvements d'un lot n'est pas ici.
 *
 * Elle aurait sa place dans ce fichier (ou dans `depots/stock.ts`), mais une
 * fonction nouvelle n'y serait accessible a `apps/api` qu'en l'ajoutant au
 * baril `packages/db/src/index.ts`, reserve a un autre chantier en cours. La
 * route `GET /api/lots/:lotId/mouvements` assemble donc la liste a partir de
 * `mouvementsDuLot` (deja exporte) et du catalogue `motif`, sur le modele de
 * `apps/api/src/routes/referentiel.ts` qui interroge deja Drizzle directement.
 * A redescendre ici des que le baril redevient modifiable.
 */
