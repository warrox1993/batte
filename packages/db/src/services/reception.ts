/**
 * Enregistrement d'une reception de marchandise.
 *
 * Chaque ligne cree UN lot (obligation de tracabilite, CLAUDE.md §3 regle n°6)
 * et UN mouvement d'entree. Le lot porte l'identite de la marchandise, le
 * mouvement porte la quantite : c'est la separation quantite / valeur des ERP
 * (docs/07 §1.3), et c'est ce qui permet plus tard d'ajouter une ecriture
 * d'ajustement de cout sans jamais modifier l'entree d'origine.
 *
 * Toute l'operation est ATOMIQUE : une reception a moitie ecrite laisserait un
 * lot sans mouvement d'entree, donc un stock faux et un numero de document
 * consomme pour rien.
 */

import {
  ErreurIntrouvable,
  ErreurMetier,
  ajouterJours,
  avertissementDlcDejaDepassee,
  jourCivilBelge,
  maintenantUtc,
  nouvelIdentifiant,
  type CodeMotif,
} from '@batte/core';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  commandeFournisseur,
  fournisseur,
  ingredient,
  lot,
  mouvementStock,
  reception,
} from '../schema.js';
import { journaliser, listerJournalAudit } from '../depots/audit.js';
import { verifierPeriodeNonVerrouillee } from '../depots/comptabilite.js';
import { allouerNumero } from '../depots/numerotation.js';
import { contrepasserMouvement } from './mouvements.js';
// Import RELATIF (même paquet) : la validation de pièce jointe est partagée
// avec `services/factures.ts`, sans passer par le baril `@batte/db` — voir la
// décision de conception documentée en tête de `factures.ts`.
import { validerPieceJointe } from './factures.js';

export type LigneReception = {
  readonly ingredientId: string;
  /** Quantite recue, dans l'unite de reference de l'ingredient. */
  readonly quantite: number;
  /** Prix payé pour CETTE ligne, en centimes. Le prix unitaire s'en deduit. */
  readonly prixLigneCents: number;
  readonly numeroLotFournisseur?: string | null;
  /** Jour civil `AAAA-MM-JJ`. Si absent, deduit de la duree de conservation. */
  readonly dateDlc?: string | null;
};

export type EntreeReception = {
  readonly fournisseurId: string;
  /** Jour civil belge de la reception. */
  readonly dateReception: string;
  readonly numeroBonLivraison?: string | null;
  /**
   * Commande fournisseur que cette reception solde.
   *
   * REFERME LA BOUCLE D'ACHAT. Sans ce rattachement, la commande restait
   * eternellement « envoyee » et sa quantite continuait d'etre comptee comme
   * « en route » par le calcul de point de commande : le stock projete
   * double-comptait la marchandise deja recue, et le moteur finissait par ne
   * plus jamais proposer de reapprovisionner.
   */
  readonly commandeId?: string | null;
  readonly source?: 'manuelle' | 'ia_validee';
  readonly notes?: string | null;
  readonly creePar?: string | null;
  /**
   * Bon de livraison SCANNÉ, en Data URI (RFC 2397). Voir la décision de
   * conception documentée en tête de `services/factures.ts` : stocké dans la
   * ligne elle-même (`reception.fichier_scan_path`, colonne TEXTE), pour
   * rester dans le périmètre protégé par `packages/db/src/sauvegarde.ts`.
   *
   * CORRECTION (mission « surface d'attaque ouverte aujourd'hui »,
   * 30/07/2026) : la note précédente affirmait qu'« aucune route HTTP ne le
   * transmet encore » — FAUX à la vérification : `POST /api/receptions`
   * (`apps/api/src/routes/stock.ts`, `schemaPieceJointeReception`) câble déjà
   * ce champ jusqu'ici, exactement comme `routes/factures.ts` le fait pour
   * `facture_fournisseur`. Ce champ est donc bien atteignable par HTTP dès
   * aujourd'hui — la seule garde réelle est `validerPieceJointe`
   * (`services/factures.ts`), qui s'applique ici aussi. `routes/stock.ts`
   * reste hors du périmètre d'écriture de cette mission (fichier
   * explicitement protégé) : cette note ne fait que corriger la
   * documentation, aucun câblage n'y a été ajouté ni retiré.
   */
  readonly fichierScanPath?: string | null;
  readonly lignes: readonly LigneReception[];
};

export type ResultatReception = {
  receptionId: string;
  numero: string;
  lotsCrees: { lotId: string; ingredientId: string; quantite: number }[];
  montantTotalCents: number;
  /**
   * Avertissements NON BLOQUANTS (docs/17 fiche 16) : au moins un lot n'est
   * identifié que par sa DLC, sans numéro de lot fournisseur. Vide la plupart
   * du temps.
   */
  avertissements: string[];
  /**
   * Numéro de la commande soldée par cette réception (`entree.commandeId`),
   * `null` si aucune commande n'était rattachée.
   *
   * REFERME LA BOUCLE D'ACHAT côté ÉCRITURE (mission « boucle d'achat »,
   * 30/07/2026) : l'écran de saisie (`SaisieReception.tsx`) savait déjà QUELLE
   * commande on venait de choisir — c'est le menu déroulant lui-même — mais la
   * confirmation renvoyée après enregistrement ne le redisait jamais. Sans ce
   * champ, « voir laquelle » s'arrêtait à l'instant de la saisie.
   */
  commandeNumero: string | null;
};

export function enregistrerReception(base: BaseBatte, entree: EntreeReception): ResultatReception {
  if (entree.lignes.length === 0) {
    throw new ErreurMetier(
      'reception_vide',
      'Une réception doit contenir au moins une ligne de marchandise.',
    );
  }

  for (const ligne of entree.lignes) {
    if (ligne.quantite <= 0) {
      throw new ErreurMetier(
        'quantite_invalide',
        'Chaque ligne de réception doit porter une quantité strictement positive.',
        { champs: { quantite: 'La quantité doit être supérieure à zéro.' } },
      );
    }
    if (ligne.prixLigneCents < 0) {
      throw new ErreurMetier(
        'prix_invalide',
        "Le prix d'une ligne de réception ne peut pas être négatif.",
        { champs: { prixLigneCents: 'Le prix doit être positif ou nul.' } },
      );
    }
  }

  // Verrou de periode (docs/07 §1.6) : une reception datee dans un exercice
  // verrouille est refusee avant toute ecriture.
  verifierPeriodeNonVerrouillee(base, entree.dateReception);

  // `better-sqlite3` execute la transaction de facon synchrone : soit toutes les
  // ecritures passent, soit aucune. C'est ce qui garantit qu'on ne laisse jamais
  // un lot sans son mouvement d'entree.
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    // Verifie AVANT d'allouer un numero : sans ce controle, un fournisseur
    // inconnu ne se manifestait qu'en violation de cle etrangere, remontee en
    // 500 generique — alors qu'un ingredient inconnu, dans la MEME reception,
    // rend deja un 404 nomme.
    const f = baseTx
      .select({ id: fournisseur.id })
      .from(fournisseur)
      .where(eq(fournisseur.id, entree.fournisseurId))
      .get();
    if (f === undefined) throw new ErreurIntrouvable('Fournisseur', entree.fournisseurId);

    // Commande soldee : verifiee ici, marquee `recue` plus bas. On refuse une
    // commande deja recue ou annulee — enregistrer deux receptions sur la meme
    // commande ferait disparaitre sa quantite du stock projete deux fois.
    //
    // `commandeNumero` est capture ICI, avant toute ecriture : c'est ce qui
    // permet a la reponse de dire QUELLE commande vient d'etre soldee (« voir
    // laquelle » — `ResultatReception.commandeNumero` ci-dessus).
    let commandeNumero: string | null = null;
    if (entree.commandeId !== undefined && entree.commandeId !== null) {
      const commande = baseTx
        .select({
          id: commandeFournisseur.id,
          statut: commandeFournisseur.statut,
          numero: commandeFournisseur.numero,
        })
        .from(commandeFournisseur)
        .where(eq(commandeFournisseur.id, entree.commandeId))
        .get();

      if (commande === undefined) {
        throw new ErreurMetier('commande_introuvable', "La commande à solder n'existe pas.", {
          champs: { commandeId: 'Choisissez une commande dans la liste.' },
        });
      }
      if (commande.statut === 'recue' || commande.statut === 'annulee') {
        throw new ErreurMetier(
          'commande_deja_soldee',
          `Cette commande est déjà « ${commande.statut} » : elle ne peut plus être ` +
            'rattachée à une réception. Enregistrez la marchandise sans commande.',
          { champs: { commandeId: 'Choisissez une commande encore ouverte.' } },
        );
      }
      commandeNumero = commande.numero;
    }

    const maintenant = maintenantUtc();
    const annee = Number.parseInt(entree.dateReception.slice(0, 4), 10);
    const numero = allouerNumero(baseTx, 'reception', annee);

    const receptionId = nouvelIdentifiant();
    const montantTotalCents = entree.lignes.reduce((total, l) => total + l.prixLigneCents, 0);

    tx.insert(reception)
      .values({
        id: receptionId,
        numero,
        fournisseurId: entree.fournisseurId,
        dateReception: entree.dateReception,
        numeroBonLivraison: entree.numeroBonLivraison ?? null,
        montantTotalCents,
        fichierScanPath: validerPieceJointe(entree.fichierScanPath),
        commandeId: entree.commandeId ?? null,
        source: entree.source ?? 'manuelle',
        notes: entree.notes ?? null,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const lotsCrees: ResultatReception['lotsCrees'] = [];
    const avertissements: string[] = [];

    for (const ligne of entree.lignes) {
      const ing = tx
        .select({
          id: ingredient.id,
          nom: ingredient.nom,
          dureeConservationJours: ingredient.dureeConservationJours,
        })
        .from(ingredient)
        .where(eq(ingredient.id, ligne.ingredientId))
        .get();

      if (ing === undefined) {
        throw new ErreurMetier(
          'ingredient_introuvable',
          `Ingrédient introuvable dans la réception : ${ligne.ingredientId}.`,
          { statut: 404 },
        );
      }

      // DLC deduite de la duree de conservation declaree si elle n'est pas
      // saisie. Jamais inventee quand la duree est inconnue : un lot sans DLC
      // est servi en DERNIER par la FEFO, ce qui est le comportement prudent.
      const dateDlc =
        ligne.dateDlc ??
        (ing.dureeConservationJours === null
          ? null
          : ajouterJours(entree.dateReception, ing.dureeConservationJours));

      /**
       * CLAUDE.md §3 regle 6 : un lot doit etre IDENTIFIABLE pour rester
       * rappelable. L'identifiant est soit le numero de lot fournisseur, soit
       * la DLC precise au jour pres — jamais les deux exiges ensemble.
       *
       * Fondement reglementaire (corrige apres une premiere version trop
       * stricte qui rendait injustement 31 tests injoignables, y compris des
       * scenarios reels) : la directive europeenne 2011/91/UE sur l'indication
       * du lot prevoit explicitement qu'un numero de lot N'EST PAS exige quand
       * la date de durabilite minimale est indiquee en clair avec AU MOINS le
       * jour et le mois — la date fait alors office d'identifiant de lot. Un
       * achat de lait ou d'oeufs au supermarche le samedi matin porte
       * typiquement une DLC lisible et AUCUN numero de lot exploitable ;
       * exiger les deux aurait rendu la reception impossible a enregistrer, et
       * aurait pousse a taper un numero bidon pour passer l'ecran — echanger
       * une tracabilite absente contre une tracabilite MENSONGERE, ce qui est
       * pire (CLAUDE.md §4 : jamais de faux en ecriture).
       *
       * Verifie ICI, apres deduction de la DLC, et non seulement au contrat
       * HTTP (`schemaLigneReception` de `packages/core`) : le contrat ne peut
       * pas savoir si une DLC omise sera DEDUITE en base — cette fonction est
       * donc la seule autorite sur la regle.
       *
       * Refus SEULEMENT quand NI L'UN NI L'AUTRE n'existe : la ou la
       * tracabilite est reellement impossible. Quand seule la DLC identifie
       * (pas de numero), la reception est ACCEPTEE avec un AVERTISSEMENT : deux
       * receptions a la meme DLC resteraient indistinguables en cas de rappel
       * — une information utile, pas un motif de refus.
       */
      const numeroLotVide =
        ligne.numeroLotFournisseur === undefined ||
        ligne.numeroLotFournisseur === null ||
        ligne.numeroLotFournisseur.trim() === '';
      if (dateDlc === null && numeroLotVide) {
        throw new ErreurMetier(
          'lot_non_identifiable',
          "Cette denrée n'est identifiable ni par un numéro de lot ni par une DLC : indiquez " +
            "au moins l'un des deux, sinon un rappel devrait retirer tout le stock de cet " +
            'ingrédient, faute de pouvoir cibler ce lot.',
          {
            champs: {
              numeroLotFournisseur: 'Indiquez le numéro de lot, ou à défaut une DLC précise.',
            },
          },
        );
      }
      if (dateDlc !== null && numeroLotVide) {
        avertissements.push(
          `${ing.nom} : identifié par sa seule DLC (${dateDlc}), sans numéro de lot fournisseur — ` +
            'deux réceptions à cette même DLC resteraient indistinguables en cas de rappel.',
        );
      }

      /**
       * DLC déjà dépassée à la réception (docs/17 fiche 16) : jusqu'ici cet
       * avertissement n'existait qu'à la SAISIE (`SaisieReception.tsx`,
       * `avertissementDlcDejaDepassee`), et disparaissait donc au moment
       * précis où il serait le plus utile — la confirmation affichée APRÈS
       * enregistrement, quand la donnée est celle réellement persistée
       * (`dateDlc` déduite comprise, pas seulement saisie). Même défaut que
       * le message « Mode test » corrigé ce jour : un avertissement juste,
       * structurellement inatteignable après coup. Ajouté ici, jamais à la
       * place de l'avertissement de la saisie : les deux répondent à une
       * question différente (la saisie avertit avant d'enregistrer, ceci
       * prouve que la ligne réellement écrite porte encore l'anomalie).
       */
      const avertissementDlc = avertissementDlcDejaDepassee(ing.nom, dateDlc, entree.dateReception);
      if (avertissementDlc !== null) avertissements.push(avertissementDlc);

      const lotId = nouvelIdentifiant();

      tx.insert(lot)
        .values({
          id: lotId,
          ingredientId: ligne.ingredientId,
          fournisseurId: entree.fournisseurId,
          receptionId,
          numeroLotFournisseur: ligne.numeroLotFournisseur ?? null,
          dateReception: entree.dateReception,
          dateDlc,
          quantiteInitiale: ligne.quantite,
          // Le montant PAYE, tel quel. Aucune division a l'ecriture : le prix
          // unitaire est un taux, il se derive a la lecture. La version
          // precedente stockait le quotient et jetait ce montant, ce qui rendait
          // le lot definitivement irreconciliable avec la facture fournisseur.
          prixLigneCents: ligne.prixLigneCents,
          statut: 'disponible',
          motifStatutId: null,
          dateChangementStatut: null,
          notes: null,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      tx.insert(mouvementStock)
        .values({
          id: nouvelIdentifiant(),
          lotId,
          ingredientId: ligne.ingredientId,
          type: 'entree',
          quantite: ligne.quantite,
          dateMouvement: entree.dateReception,
          // A la reception, quantite et valeur sont connues en meme temps. Elles
          // divergeront quand la facture fournisseur arrivera (Lot 7) : c'est
          // alors une ecriture d'AJUSTEMENT qui sera ajoutee, jamais celle-ci
          // qui sera modifiee.
          valuationDate: entree.dateReception,
          ajustement: false,
          productionId: null,
          sessionId: null,
          motifId: null,
          motifTexte: null,
          coutCents: ligne.prixLigneCents,
          isAnnule: false,
          annuleParId: null,
          creePar: entree.creePar ?? null,
          creeLe: maintenant,
        })
        .run();

      lotsCrees.push({ lotId, ingredientId: ligne.ingredientId, quantite: ligne.quantite });
    }

    /**
     * La commande passe a `recue` : c'est CE changement d'etat qui la sort de
     * `quantiteDejaCommandee`, donc du stock projete.
     *
     * Une reception solde la commande ENTIERE, meme livree partiellement. C'est
     * volontaire et c'est le choix sur : la fois suivante, le calcul de point de
     * commande verra le stock reellement disponible et reproposera ce qui
     * manque. Le sur-comptage, lui, ne se rattrape jamais tout seul — il ne fait
     * que grandir a chaque commande.
     *
     * JOURNALISE (mission « boucle d'achat », 30/07/2026) : c'est CETTE entree
     * d'audit, et elle seule, qui permet plus tard a `annulerReception` de
     * SAVOIR — et non deviner — dans quel statut remettre la commande si cette
     * reception est un jour annulee. Avant cet ajout, le statut anterieur
     * n'etait conserve NULLE PART (voir le commentaire de `annulerReception`
     * plus bas) : CLAUDE.md §7 interdit justement de le deviner a posteriori
     * (« une valeur inconnue vaut null, jamais une valeur par defaut
     * plausible »). Une reception enregistree AVANT ce correctif ne laisse
     * donc aucune trace exploitable — `annulerReception` le detecte et ne
     * devine rien non plus dans ce cas.
     */
    if (entree.commandeId !== undefined && entree.commandeId !== null) {
      const commandeAvant = baseTx
        .select()
        .from(commandeFournisseur)
        .where(eq(commandeFournisseur.id, entree.commandeId))
        .get();

      const commandeApres = baseTx
        .update(commandeFournisseur)
        .set({ statut: 'recue', modifieLe: maintenant })
        .where(eq(commandeFournisseur.id, entree.commandeId))
        .returning()
        .get();

      if (commandeAvant !== undefined && commandeApres !== undefined) {
        journaliser(baseTx, {
          table: 'commande_fournisseur',
          enregistrementId: entree.commandeId,
          action: 'modification',
          valeurAvant: commandeAvant,
          valeurApres: commandeApres,
          parQui: entree.creePar ?? null,
        });
      }
    }

    return { receptionId, numero, lotsCrees, montantTotalCents, avertissements, commandeNumero };
  });
}

/**
 * Les trois statuts qu'une commande peut porter JUSTE AVANT qu'une réception
 * ne la marque `recue` — `enregistrerReception` (ci-dessus) refuse déjà
 * d'attacher une réception à une commande `recue` ou `annulee` à ce moment-là.
 * C'est tout ce qu'`annulerReception` a le droit de restaurer, jamais autre
 * chose : une valeur hors de cette liste ne serait pas un statut antérieur
 * plausible, ce serait une invention.
 */
const STATUTS_COMMANDE_ANTERIEURS_A_RECUE = ['brouillon', 'validee', 'envoyee'] as const;
type StatutCommandeAnterieur = (typeof STATUTS_COMMANDE_ANTERIEURS_A_RECUE)[number];

function statutCommandeAnterieurValide(valeur: unknown): valeur is StatutCommandeAnterieur {
  return (
    typeof valeur === 'string' &&
    (STATUTS_COMMANDE_ANTERIEURS_A_RECUE as readonly string[]).includes(valeur)
  );
}

export type ResultatAnnulationReception = {
  readonly receptionId: string;
  readonly numero: string;
  /** Mouvements d'entrée contrepassés, un par lot encore intact de cette réception. */
  readonly nbMouvementsContrepasses: number;
  /** Commande liée à cette réception (`reception.commandeId`), ou `null`. */
  readonly commandeId: string | null;
  /**
   * Statut auquel la commande liée a été REMISE, uniquement quand son statut
   * antérieur à cette réception a pu être retrouvé avec CERTITUDE (journal
   * d'audit écrit par `enregistrerReception` — voir le commentaire de la
   * fonction ci-dessous). `null` dans tous les autres cas — y compris quand
   * une commande était bien liée : ne jamais le confondre avec `commandeId`,
   * qui dit LUI si une commande existait.
   */
  readonly commandeStatutRestaure: StatutCommandeAnterieur | null;
};

/**
 * Annule une réception : CONTREPASSE l'entrée de stock de chacun de ses lots,
 * jamais un `DELETE` ni un `UPDATE` de quantité (CLAUDE.md §3 règles 5 et 7).
 *
 * DÉFAUT TROUVÉ À L'AUDIT (30/07/2026, « rien ne s'efface ») : aucune fonction
 * n'annulait une réception, alors que `annulerProduction`, `annulerSession` et
 * `annulerCommande` couvrent déjà chacun leur propre fait. Une livraison
 * saisie deux fois, ou pour le mauvais fournisseur, restait donc
 * DÉFINITIVEMENT engagée — stock compris — en violation directe de la règle
 * n°7. Réutilise `contrepasserMouvement` (`services/mouvements.ts`), lot par
 * lot, DANS CETTE MÊME transaction : soit toutes les contrepassations
 * passent, soit aucune — même patron que `annulerProduction`.
 *
 * `contrepasserMouvement` REFUSE, pour chaque lot, si sa matière a déjà été
 * consommée (en tout ou en partie) par une écriture postérieure — production,
 * vente, destruction : cette matière a RÉELLEMENT été utilisée, elle ne peut
 * pas être « désreçue ». Une réception dont au moins un lot a déjà servi
 * n'est donc PAS annulable dans son ensemble : l'échec de cette seule
 * contrepassation fait échouer toute la transaction, sans qu'aucun lot ne
 * soit à moitié rendu.
 *
 * `reception.statut` (colonne ajoutée le 30/07/2026, migration
 * `0025_high_captain_universe.sql`) passe ici à `annulee`, DANS LA MÊME
 * transaction que les contrepassations : la seule trace de la décision
 * restait sinon le journal d'audit, et aucun écran ne pouvait afficher
 * « cette réception est annulée » sans relire ce journal. Le statut RÉSUME la
 * contrepassation, il ne la remplace pas (CLAUDE.md §3 règle 5) : c'est
 * toujours `contrepasserMouvement` qui écrit l'écriture inverse de stock ; le
 * statut n'est qu'un `UPDATE` sur le SEUL champ `statut`, exactement ce que
 * fait déjà `annulerProduction` pour `production.statut` (D-038 — même
 * raisonnement appliqué ici).
 *
 * Le refus de la double annulation s'appuie DIRECTEMENT sur ce statut, et non
 * plus sur la déduction indirecte (absence de mouvement `entree` non annulé)
 * qu'utilisait la première version de cette fonction faute de colonne : une
 * lecture directe est plus sûre qu'une déduction, et c'est la même discipline
 * que `production_deja_annulee` sur `annulerProduction`.
 *
 * COMMANDE LIÉE (mission « boucle d'achat », 30/07/2026 — remplace la note
 * précédente, qui disait ne jamais y toucher parce que le statut antérieur
 * n'était conservé nulle part). Deux voies sont défendables, toutes deux
 * respectant « rien ne s'efface » : remettre la commande dans son statut
 * antérieur, ou laisser `recue` et rendre l'incohérence explicite et
 * permanente. La bonne réponse dépend d'une seule question — peut-on SAVOIR
 * ce statut antérieur, ou doit-on le DEVINER ? `enregistrerReception`
 * (ci-dessus) écrit désormais, à chaque bascule vers `recue`, une entrée du
 * journal d'audit qui fige ce statut antérieur. Cette fonction la cherche :
 *
 *  - SI ELLE EXISTE : le statut antérieur est un FAIT, pas une supposition —
 *    la commande y est remise par une ÉCRITURE NOUVELLE (un `UPDATE` daté
 *    d'aujourd'hui, journalisé), jamais une réécriture de l'ancienne entrée
 *    d'audit, qui reste intacte. Une phrase est aussi AJOUTÉE (jamais
 *    écrasée) à `commande.notes`, pour qu'un humain qui relit la commande
 *    comprenne le geste sans devoir remonter au journal.
 *  - SI ELLE N'EXISTE PAS (réception enregistrée avant ce correctif, ou
 *    historique incomplet) : le statut antérieur est INCONNU, et CLAUDE.md
 *    §7 est net — « une valeur inconnue vaut null, jamais une valeur par
 *    défaut plausible ». Rien n'est donc deviné : la commande reste `recue`,
 *    mais l'incohérence est rendue explicite et PERMANENTE dans la donnée
 *    elle-même (une phrase écrite dans `commande.notes`, journalisée comme
 *    l'autre cas), pas seulement dans un calcul de lecture
 *    (`receptionStatut` sur `CommandeResumeLigne`/`lireCommandeDetail`,
 *    `services/commandes.ts`) — ce calcul reste utile pour LISTER les
 *    commandes en incohérence, mais ne prouvait pas, à lui seul, qu'on avait
 *    cherché à corriger le fait.
 *
 * PLUSIEURS RÉCEPTIONS SUR LA MÊME COMMANDE. `enregistrerReception` refuse
 * d'attacher une réception à une commande dont le statut est encore `recue`
 * ou `annulee` (garde `commande_deja_soldee`) : à un instant donné, AU PLUS
 * UNE réception peut donc être la cause du statut `recue` courant d'une
 * commande. Si la réception qu'on annule ICI porte un `commandeId` et n'était
 * pas déjà annulée (garde plus haut), elle EST, par construction, cette
 * réception-là — jamais une réception plus ancienne déjà remplacée. Une
 * commande peut ainsi enchaîner plusieurs cycles « reçue -> annulée -> de
 * nouveau ouverte -> reçue par une AUTRE réception » : chaque annulation
 * retrouve alors SA PROPRE entrée d'audit (`listerJournalAudit` trie du plus
 * récent au plus ancien, le premier match est donc la bascule la plus
 * récente), jamais celle d'un cycle précédent.
 */
export function annulerReception(
  base: BaseBatte,
  receptionId: string,
  motifCode: CodeMotif,
  creePar?: string | null,
): ResultatAnnulationReception {
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const existante = baseTx.select().from(reception).where(eq(reception.id, receptionId)).get();
    if (existante === undefined) throw new ErreurIntrouvable('Réception', receptionId);

    // Refus DIRECT sur le statut (voir le commentaire de fonction) : une
    // écriture ne se contrepasse qu'une seule fois, même formulation que
    // `production_deja_annulee` sur `annulerProduction`.
    if (existante.statut === 'annulee') {
      throw new ErreurMetier(
        'reception_deja_annulee',
        `La réception ${existante.numero} est déjà annulée : chacun de ses lots a déjà été ` +
          'contrepassé.',
      );
    }

    // Verrou de periode (docs/07 §1.6) : verifie sur la date METIER de la
    // reception, exactement comme a sa creation (`enregistrerReception`
    // ci-dessus) — un exercice deja transmis au comptable ne doit plus voir
    // cette reception bouger, meme pour l'annuler.
    verifierPeriodeNonVerrouillee(baseTx, existante.dateReception);

    const idsLots = baseTx
      .select({ id: lot.id })
      .from(lot)
      .where(eq(lot.receptionId, receptionId))
      .all()
      .map((l) => l.id);

    /**
     * Mouvements `entree` NON DEJA ANNULES individuellement (une contrepassation
     * isolee via `POST /mouvements/:id/annuler` reste possible avant celle-ci,
     * exactement comme pour `annulerProduction`) : ce sont eux, et eux seuls,
     * que cette annulation doit encore contrepasser.
     *
     * DEFAUT CORRIGE (audit du 31/07/2026) : `type = 'entree' AND isAnnule = false`
     * NE SUFFIT PAS a designer « l'entree que CETTE reception a ecrite ». Deux
     * AUTRES ecritures portent EXACTEMENT la meme forme sur un lot qui a servi :
     *
     *  1. Contrepasser une SORTIE ecrit elle-meme un `entree` — voir
     *     `contrepasserMouvement` (`services/mouvements.ts`, et la copie
     *     locale de `annulerSession`, `services/sessions.ts`) : le type
     *     inverse d'une `sortie_production` ou d'une `sortie_vente` EST
     *     `entree`. Annuler une PRODUCTION qui avait consomme ce lot, puis
     *     annuler CETTE reception, presentait donc DEUX lignes `entree`
     *     ouvertes : l'originale (ex. 20000 g) et la contrepassation de la
     *     sortie (ex. 145 g). La boucle ci-dessous contrepassait alors la
     *     PREMIERE avec succes (le lot etait redevenu entier), rendait le
     *     restant a ZERO, puis tentait de contrepasser la SECONDE (145 g) sur
     *     un lot qui n'en portait plus — `contrepasserMouvement` refusait a
     *     bon droit, mais avec un message absurde : « il ne reste que 0 g,
     *     pour une entree de 145 g », comme si le porteur avait consomme une
     *     matiere qu'il venait de rendre. L'annulation, pourtant legitime,
     *     echouait DEFINITIVEMENT (une contrepassation ne se rejoue pas).
     *
     *  2. La RESTITUTION d'un ecart reel de production (sous-consommation,
     *     `services/production.ts` — recherche « Restitué au lot » —, fiche 9
     *     de docs/17) ecrit AUSSI un `entree`, `ajustement: false` comme
     *     l'entree d'origine : la production a consomme MOINS que le
     *     theorique, la difference est rendue au(x) lot(s) qu'elle avait
     *     entames. Cette ligne n'est PAS une contrepassation (`ajustement` y
     *     est `false`), donc `ajustement = false` seul — la premiere
     *     correction envisagee — ne l'aurait PAS exclue : exactement le piege
     *     que la mission a demande de verifier plutot que de supposer. Une
     *     production `terminee` (jamais annulee) peut laisser cette ligne
     *     ouverte indefiniment sur un lot par ailleurs intact.
     *
     * LE DISCRIMINANT RETENU : `ajustement = false` ET `production_id IS NULL`.
     * Aucun des deux seuls ne suffit (case 2 ci-dessus pour le premier, et
     * `sortie_vente` — qui ne porte jamais de `production_id` mais devient
     * `ajustement = true` en se contrepassant, `services/sessions.ts:1851` —
     * pour le second) ; la CONJONCTION des deux, en revanche, reproduit
     * EXACTEMENT la forme que `enregistrerReception` ecrit ci-dessus
     * (`ajustement: false, productionId: null, sessionId: null`) et SEULEMENT
     * elle : c'est la seule ecriture `entree` du depot qui ne soit ni une
     * contrepassation (`ajustement` le dit toujours), ni rattachee a une
     * production (`production_id` le dit toujours, sur `sortie_production`
     * comme sur sa restitution d'ecart et sur toute contrepassation qui en
     * decoule). `session_id` n'a pas besoin d'entrer dans le filtre : aucune
     * ecriture `entree` non-contrepassation, `production_id` null, n'existe
     * en dehors de celle-ci dans le depot (verifie ligne par ligne : les trois
     * seuls points d'ecriture d'un `type: 'entree'` litteral sont ce fichier,
     * `services/production.ts` — toujours avec `production_id` — et les
     * fixtures de test).
     *
     * GARDE-FOU INCHANGE : ce filtre ne change RIEN a `contrepasserMouvement`
     * (`services/mouvements.ts:226`), qui reste seul juge de la quantite
     * encore disponible sur CHAQUE mouvement qu'il reçoit — le refus
     * `entree_deja_consommee` sur une reception dont le lot sert encore une
     * production NON annulee continue de s'appliquer normalement.
     */
    const mouvementsEntreeOuverts =
      idsLots.length === 0
        ? []
        : baseTx
            .select({ id: mouvementStock.id })
            .from(mouvementStock)
            .where(
              and(
                inArray(mouvementStock.lotId, idsLots),
                eq(mouvementStock.type, 'entree'),
                eq(mouvementStock.isAnnule, false),
                eq(mouvementStock.ajustement, false),
                isNull(mouvementStock.productionId),
              ),
            )
            .all();

    for (const m of mouvementsEntreeOuverts) {
      contrepasserMouvement(baseTx, m.id, motifCode, creePar);
    }

    const apres = baseTx
      .update(reception)
      .set({ statut: 'annulee', modifieLe: maintenantUtc() })
      .where(eq(reception.id, receptionId))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'reception',
      enregistrementId: receptionId,
      action: 'annulation',
      valeurAvant: existante,
      valeurApres: apres,
      parQui: creePar ?? null,
    });

    // ─── Commande liée : restaurer si on le PEUT, sinon rendre le fait
    // explicite et permanent — jamais deviner (voir le commentaire de
    // fonction ci-dessus pour le raisonnement complet). ─────────────────────
    let commandeStatutRestaure: StatutCommandeAnterieur | null = null;

    if (existante.commandeId !== null) {
      const commandeActuelle = baseTx
        .select()
        .from(commandeFournisseur)
        .where(eq(commandeFournisseur.id, existante.commandeId))
        .get();

      // Rien à corriger si la commande n'est déjà plus `recue` (par exemple
      // parce qu'un cycle précédent l'a déjà remise ouverte, ou une anomalie
      // de données) : l'incohérence que cette fonction cible n'existe pas.
      if (commandeActuelle !== undefined && commandeActuelle.statut === 'recue') {
        const jour = jourCivilBelge(new Date());

        // Cherche l'entrée d'audit qui a fait basculer CETTE commande vers
        // `recue` (voir `enregistrerReception` ci-dessus). Le premier match
        // est la bascule la PLUS RÉCENTE (tri desc de `listerJournalAudit`),
        // forcément celle de la réception qu'on annule ici.
        const historique = listerJournalAudit(baseTx, {
          table: 'commande_fournisseur',
          enregistrementId: existante.commandeId,
          action: 'modification',
        });

        let statutAnterieur: StatutCommandeAnterieur | null = null;
        for (const ligne of historique) {
          if (ligne.valeurApres === null || ligne.valeurApres['statut'] !== 'recue') continue;
          const candidat = ligne.valeurAvant === null ? undefined : ligne.valeurAvant['statut'];
          if (statutCommandeAnterieurValide(candidat)) {
            statutAnterieur = candidat;
            break;
          }
        }

        if (statutAnterieur !== null) {
          const note =
            `Réception ${existante.numero} annulée le ${jour} : statut remis à « ` +
            `${statutAnterieur} » (statut antérieur retrouvé au journal d'audit).`;
          const notesApres =
            commandeActuelle.notes === null ? note : `${commandeActuelle.notes}\n${note}`;

          const commandeApres = baseTx
            .update(commandeFournisseur)
            .set({ statut: statutAnterieur, notes: notesApres, modifieLe: maintenantUtc() })
            .where(eq(commandeFournisseur.id, existante.commandeId))
            .returning()
            .get();

          journaliser(baseTx, {
            table: 'commande_fournisseur',
            enregistrementId: existante.commandeId,
            action: 'modification',
            valeurAvant: commandeActuelle,
            valeurApres: commandeApres,
            parQui: creePar ?? null,
          });

          commandeStatutRestaure = statutAnterieur;
        } else {
          const note =
            `Réception ${existante.numero} annulée le ${jour} : le statut antérieur de cette ` +
            "commande n'a pas pu être retrouvé (réception enregistrée avant le suivi d'audit du " +
            '30/07/2026, ou historique incomplet) — elle reste affichée « reçue » alors que la ' +
            'marchandise a été rendue.';
          const notesApres =
            commandeActuelle.notes === null ? note : `${commandeActuelle.notes}\n${note}`;

          const commandeApres = baseTx
            .update(commandeFournisseur)
            .set({ notes: notesApres, modifieLe: maintenantUtc() })
            .where(eq(commandeFournisseur.id, existante.commandeId))
            .returning()
            .get();

          journaliser(baseTx, {
            table: 'commande_fournisseur',
            enregistrementId: existante.commandeId,
            action: 'modification',
            valeurAvant: commandeActuelle,
            valeurApres: commandeApres,
            parQui: creePar ?? null,
          });
        }
      }
    }

    return {
      receptionId,
      numero: existante.numero,
      nbMouvementsContrepasses: mouvementsEntreeOuverts.length,
      commandeId: existante.commandeId,
      commandeStatutRestaure,
    };
  });
}
