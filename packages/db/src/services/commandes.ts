/**
 * Reapprovisionnement automatique et cycle de vie des commandes fournisseur
 * (Lot 7).
 *
 * Le calcul chiffre (point de commande, arrondi aux conditionnements) vient
 * entierement de `@batte/core` ; ce fichier n'assemble que les donnees et les
 * ecritures. Cycle de statuts impose par D-009 (docs/05-DECISIONS.md) :
 * `brouillon -> validee -> envoyee`, sans jamais sauter une etape — l'envoi
 * automatique sans validation humaine est exclu PAR CONSTRUCTION, pas par
 * discipline.
 */

import {
  ErreurIntrouvable,
  ErreurMetier,
  ajouterJours,
  calculerBesoinReapprovisionnement,
  jourCivilBelge,
  maintenantUtc,
  nouvelIdentifiant,
  quantiteDisponible,
  type Unite,
} from '@batte/core';
import { and, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  commandeFournisseur,
  commandeLigne,
  conditionnement,
  fournisseur,
  ingredient,
  mouvementStock,
  reception,
} from '../schema.js';
import { journaliser, listerJournalAudit } from '../depots/audit.js';
import { allouerNumero } from '../depots/numerotation.js';
import { lireParametres } from '../depots/parametres.js';
import { lotsDeLIngredient } from '../depots/stock.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Lecture
   ═══════════════════════════════════════════════════════════════════════════ */

export type CommandeResumeLigne = {
  id: string;
  numero: string;
  fournisseurId: string;
  fournisseurNom: string;
  statut: 'brouillon' | 'validee' | 'envoyee' | 'recue' | 'annulee';
  dateCreation: string;
  dateEnvoi: string | null;
  montantTotalCents: number;
  nbLignes: number;
  genereAutomatiquement: boolean;
  /**
   * Numero de la réception la plus récente qui référence cette commande
   * (`reception.commande_id`), ou `null` si aucune ne la référence encore.
   *
   * REFERME LA BOUCLE D'ACHAT dans le sens commande -> réception. Cette
   * colonne était écrite par `enregistrerReception` (`services/reception.ts`)
   * pour SOLDER la commande au moment même de l'écriture (paramètre
   * d'entrée), mais jamais relue depuis la table ensuite — audit du
   * 30/07/2026, `audit-colonnes-orphelines.test.ts`. Voir
   * `receptionsRecentesParCommande` ci-dessous pour pourquoi « la plus
   * récente » plutôt qu'« exactement une ».
   */
  receptionNumero: string | null;
  /**
   * Statut de cette même réception (`active` ou `annulee`).
   *
   * La question réelle que ce champ permet de trancher : une commande reste
   * affichée `recue` pour toujours, même quand la réception qui l'avait
   * soldée est ensuite ANNULÉE — `annulerReception` (`services/reception.ts`)
   * documente explicitement ne PAS revenir sur le statut de la commande
   * (« son statut ANTÉRIEUR exact... n'est conservé nulle part »). Sans cette
   * relecture, rien ne signalait cette divergence : une commande « reçue »
   * dont la marchandise est en réalité repartie (contrepassée) se lisait
   * comme n'importe quelle autre commande honorée.
   */
  receptionStatut: 'active' | 'annulee' | null;
};

/**
 * Réception la plus récente référençant chacune des commandes demandées.
 *
 * `reception.commande_id` ne porte ni index ni clé étrangère déclarés en base
 * (`schema.ts`, hors périmètre d'écriture de cette mission) : un simple `IN`
 * suffit largement au volume de ce projet (une poignée de commandes par
 * semaine).
 *
 * « La plus récente » et non « LA » réception : `enregistrerReception` refuse
 * déjà une seconde réception sur une commande encore ouverte
 * (`commande_deja_soldee`), donc au plus UNE réception active devrait exister
 * par commande en usage normal — mais rien n'empêche techniquement une
 * réception annulée puis remplacée par une autre. Prendre la plus récente
 * (triée par date de réception) est le choix le moins surprenant pour un
 * résumé de liste ; `lireCommandeDetail` ci-dessous rend, lui, la liste
 * complète.
 */
function receptionsRecentesParCommande(
  base: BaseBatte,
  commandeIds: readonly string[],
): Map<string, { numero: string; statut: 'active' | 'annulee' }> {
  const carte = new Map<string, { numero: string; statut: 'active' | 'annulee' }>();
  if (commandeIds.length === 0) return carte;

  const lignes = base
    .select({
      commandeId: reception.commandeId,
      numero: reception.numero,
      statut: reception.statut,
    })
    .from(reception)
    .where(inArray(reception.commandeId, commandeIds))
    .orderBy(desc(reception.dateReception))
    .all();

  for (const ligne of lignes) {
    // Le `IN` ne peut rendre qu'un `commandeId` de la liste demandée, donc
    // jamais `null` ici en pratique — garde de type pour la colonne nullable.
    if (ligne.commandeId === null) continue;
    // Premier rencontré = le plus récent (tri desc ci-dessus) : les suivants,
    // s'il y en a, sont ignorés.
    if (carte.has(ligne.commandeId)) continue;
    carte.set(ligne.commandeId, { numero: ligne.numero, statut: ligne.statut });
  }
  return carte;
}

/** Liste des commandes, de la plus recente a la plus ancienne. */
export function listerCommandes(base: BaseBatte): CommandeResumeLigne[] {
  const lignes = base
    .select({
      id: commandeFournisseur.id,
      numero: commandeFournisseur.numero,
      fournisseurId: commandeFournisseur.fournisseurId,
      fournisseurNom: fournisseur.nom,
      statut: commandeFournisseur.statut,
      dateCreation: commandeFournisseur.dateCreation,
      dateEnvoi: commandeFournisseur.dateEnvoi,
      montantTotalCents: commandeFournisseur.montantTotalCents,
      genereAutomatiquement: commandeFournisseur.genereAutomatiquement,
    })
    .from(commandeFournisseur)
    .innerJoin(fournisseur, eq(commandeFournisseur.fournisseurId, fournisseur.id))
    .orderBy(desc(commandeFournisseur.dateCreation), desc(commandeFournisseur.numero))
    .all();

  const comptes = base
    .select({ commandeId: commandeLigne.commandeId, n: sql<number>`COUNT(*)` })
    .from(commandeLigne)
    .groupBy(commandeLigne.commandeId)
    .all();
  const nbLignesParCommande = new Map(comptes.map((c) => [c.commandeId, c.n]));

  const receptions = receptionsRecentesParCommande(
    base,
    lignes.map((l) => l.id),
  );

  return lignes.map((l) => ({
    ...l,
    nbLignes: nbLignesParCommande.get(l.id) ?? 0,
    receptionNumero: receptions.get(l.id)?.numero ?? null,
    receptionStatut: receptions.get(l.id)?.statut ?? null,
  }));
}

export type ReceptionLieeLigne = {
  readonly id: string;
  readonly numero: string;
  readonly dateReception: string;
  /** `null` si le montant de cette réception n'a jamais été renseigné — jamais 0 inventé. */
  readonly montantTotalCents: number | null;
  readonly statut: 'active' | 'annulee';
};

/**
 * Toutes les réceptions référençant cette commande (`reception.commande_id`),
 * la plus récente d'abord — voir `receptionsRecentesParCommande` ci-dessus
 * pour pourquoi il peut, rarement, y en avoir plus d'une.
 */
function receptionsLieesACommande(base: BaseBatte, commandeId: string): ReceptionLieeLigne[] {
  return base
    .select({
      id: reception.id,
      numero: reception.numero,
      dateReception: reception.dateReception,
      montantTotalCents: reception.montantTotalCents,
      statut: reception.statut,
    })
    .from(reception)
    .where(eq(reception.commandeId, commandeId))
    .orderBy(desc(reception.dateReception))
    .all();
}

/**
 * Ce qu'on sait d'un envoi de mail : mode test (rien envoyé, fichier écrit)
 * ou envoi réel. Même forme que `ResultatEnvoiMail` (`apps/api/src/mail.ts`,
 * hors zone d'écriture de ce fichier) sans sa date — utilisée ici dans les
 * DEUX sens : en ENTRÉE de `marquerEnvoyee` (pour journaliser LE FAIT au
 * moment même de l'envoi) et en SORTIE de `envoiModeTestConnu` (le fait
 * retrouvé, en lecture, depuis le journal d'audit).
 */
export type EnvoiModeTestConnu = {
  readonly modeTest: boolean;
  readonly cheminFichierTest: string | null;
};

/**
 * Ce qu'on sait, DE FAÇON PERSISTÉE, du dernier envoi de cette commande.
 *
 * Lu dans le JOURNAL D'AUDIT plutôt que dans une colonne dédiée : aucune
 * colonne ne porte ce fait (`packages/db/src/schema.ts`, hors zone
 * d'écriture de cette mission, décrite mais pas créée — voir le rapport de
 * mission). `marquerEnvoyee` ci-dessous annote deux clés supplémentaires
 * (`envoiModeTest`, `envoiCheminFichierTest`) dans le JSON `valeurs_apres` de
 * son entrée d'audit — cette colonne est déjà libre, sans schéma fixe
 * (`journalAudit.valeursApres`, mode `json`), donc aucune migration n'est
 * nécessaire pour lui faire porter un fait qui n'est pas une colonne réelle
 * de `commande_fournisseur`.
 *
 * Rend `null` si cette commande n'a JAMAIS été envoyée par ce mécanisme —
 * soit elle n'a encore jamais été envoyée, soit elle l'a été AVANT ce
 * correctif (aucune entrée d'audit ne portait alors ces clés). C'est le
 * cœur de la doctrine « une valeur inconnue vaut `null`, jamais `false` »
 * (mission « le seul piège silencieux qui reste », 01/08/2026) : sans ce
 * fait retrouvé, rien ne permet d'affirmer qu'un envoi passé était réel —
 * l'écran ne doit donc jamais l'affirmer à sa place.
 */
export function envoiModeTestConnu(base: BaseBatte, commandeId: string): EnvoiModeTestConnu | null {
  const entrees = listerJournalAudit(base, {
    table: 'commande_fournisseur',
    enregistrementId: commandeId,
  });

  for (const entree of entrees) {
    const valeurs = entree.valeurApres;
    if (valeurs === null) continue;
    // `unknown` + affinage (CLAUDE.md §4) : ces deux clés ne sont pas des
    // colonnes de `commande_fournisseur`, seulement des annotations posées
    // par `marquerEnvoyee` — rien ne garantit leur présence sur une entrée
    // plus ancienne ou d'une autre nature (ex. une annulation).
    const modeTest = valeurs['envoiModeTest'];
    if (typeof modeTest !== 'boolean') continue;
    const chemin = valeurs['envoiCheminFichierTest'];
    return { modeTest, cheminFichierTest: typeof chemin === 'string' ? chemin : null };
  }
  return null;
}

/** Une ligne du detail d'une commande — voir `schemaLigneCommande` (le contrat HTTP). */
export type LigneCommandeDetail = {
  readonly id: string;
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly unite: Unite;
  readonly conditionnementLibelle: string | null;
  readonly quantiteConditionnements: number;
  readonly quantiteUniteRef: number;
  readonly prixLigneCents: number;
  readonly montantLigneCents: number;
  readonly prixUnitaireCents: number;
};

/**
 * Detail complet d'une commande — ce que rend `lireCommandeDetail`.
 *
 * Type de retour EXPLICITE (et non inféré) : régression déjà vécue sur cette
 * même fonction (voir le test « régression » plus bas dans
 * `commandes.test.ts`) — sans cette annotation, un champ manquant dans
 * l'objet renvoyé n'est détecté par RIEN à la compilation, seulement par
 * `schemaCommandeDetail.parse(...)` à l'exécution, donc en HTTP 422 pour
 * chaque route qui rend le détail d'une commande.
 */
export type CommandeDetailLigne = CommandeResumeLigne & {
  readonly fournisseurEmail: string | null;
  readonly dateReceptionPrevue: string | null;
  readonly emailEnvoyeA: string | null;
  readonly notes: string | null;
  readonly lignes: LigneCommandeDetail[];
  readonly receptionsLiees: ReceptionLieeLigne[];
  readonly envoiModeTest: boolean | null;
  readonly cheminFichierTest: string | null;
};

/**
 * Detail d'une commande, lignes comprises.
 *
 * Le montant de la ligne est LU tel quel : c'est lui la donnee stockee, en
 * centimes entiers (regle n°3). C'est le PRIX UNITAIRE qui est derive, parce
 * qu'il est un taux et qu'un taux se calcule — meme principe que le CUMP
 * (D-018), applique ici a une ligne de commande plutot qu'a un lot.
 *
 * Consequence : plus aucun arrondi a la lecture, donc le total de la commande
 * est exactement la somme de ce que le fournisseur lit ligne par ligne.
 */
export function lireCommandeDetail(base: BaseBatte, id: string): CommandeDetailLigne | null {
  const entete = base
    .select({
      commande: commandeFournisseur,
      fournisseurNom: fournisseur.nom,
      fournisseurEmail: fournisseur.email,
    })
    .from(commandeFournisseur)
    .innerJoin(fournisseur, eq(commandeFournisseur.fournisseurId, fournisseur.id))
    .where(eq(commandeFournisseur.id, id))
    .get();

  if (entete === undefined) return null;

  const lignesBrutes = base
    .select({
      id: commandeLigne.id,
      ingredientId: commandeLigne.ingredientId,
      nomIngredient: ingredient.nom,
      unite: ingredient.uniteReference,
      conditionnementLibelle: conditionnement.libelle,
      quantiteConditionnements: commandeLigne.quantiteConditionnements,
      quantiteUniteRef: commandeLigne.quantiteUniteRef,
      prixLigneCents: commandeLigne.prixLigneCents,
    })
    .from(commandeLigne)
    .innerJoin(ingredient, eq(commandeLigne.ingredientId, ingredient.id))
    .leftJoin(conditionnement, eq(commandeLigne.conditionnementId, conditionnement.id))
    .where(eq(commandeLigne.commandeId, id))
    .orderBy(ingredient.nom)
    .all();

  const lignes = lignesBrutes.map((l) => ({
    ...l,
    montantLigneCents: l.prixLigneCents,
    // Division protegee : une ligne de quantite nulle ne doit pas injecter un
    // `Infinity` dans un contrat Zod ni dans un bon de commande (D-034).
    prixUnitaireCents: l.quantiteUniteRef > 0 ? l.prixLigneCents / l.quantiteUniteRef : 0,
  }));

  // REFERME LA BOUCLE D'ACHAT dans le sens commande -> réception (voir
  // `receptionsLieesACommande` ci-dessus) : audit du 30/07/2026,
  // `reception.commandeId` était écrite jamais relue depuis la table.
  // `receptionNumero`/`receptionStatut` (résumé, même paire de champs que
  // `CommandeResumeLigne`/`listerCommandes`) sont DÉRIVÉS de cette même liste,
  // jamais d'une seconde requête : la plus récente en tête (tri desc), pour
  // rester cohérents entre le résumé et le détail d'une même commande.
  const receptionsLiees = receptionsLieesACommande(base, id);

  // Le fait « ce mail-là est-il parti ? », retrouvé au journal d'audit —
  // jamais deviné : `null` si cette commande n'a jamais été envoyée, ou si
  // elle l'a été avant que `marquerEnvoyee` n'annote ce fait (voir
  // `envoiModeTestConnu` ci-dessus).
  const envoiConnu = envoiModeTestConnu(base, id);

  const c = entete.commande;
  return {
    id: c.id,
    numero: c.numero,
    fournisseurId: c.fournisseurId,
    fournisseurNom: entete.fournisseurNom,
    fournisseurEmail: entete.fournisseurEmail,
    statut: c.statut,
    dateCreation: c.dateCreation,
    dateEnvoi: c.dateEnvoi,
    dateReceptionPrevue: c.dateReceptionPrevue,
    montantTotalCents: c.montantTotalCents,
    nbLignes: lignes.length,
    genereAutomatiquement: c.genereAutomatiquement,
    emailEnvoyeA: c.emailEnvoyeA,
    notes: c.notes,
    lignes,
    receptionNumero: receptionsLiees[0]?.numero ?? null,
    receptionStatut: receptionsLiees[0]?.statut ?? null,
    receptionsLiees,
    envoiModeTest: envoiConnu?.modeTest ?? null,
    cheminFichierTest: envoiConnu?.cheminFichierTest ?? null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Generation des brouillons — le point de commande statistique
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Serie de consommation JOUR CALENDAIRE PAR JOUR CALENDAIRE d'un ingredient,
 * sur une fenetre se terminant a `jourReference` inclus.
 *
 * Les jours sans sortie de production comptent pour ZERO : c'est ce qui rend
 * l'ecart-type de `profilConsommation` representatif du rythme reel (docs/07
 * §1.9), et pas seulement des jours ou une fournee a eu lieu.
 */
function serieConsommationJournaliere(
  base: BaseBatte,
  ingredientId: string,
  jourReference: string,
  fenetreJours: number,
): number[] {
  const depuis = ajouterJours(jourReference, -(fenetreJours - 1));

  const lignes = base
    .select({
      jour: mouvementStock.dateMouvement,
      quantite: sql<number>`SUM(${mouvementStock.quantite})`,
    })
    .from(mouvementStock)
    .where(
      and(
        eq(mouvementStock.ingredientId, ingredientId),
        // Les DEUX sorties commerciales, et pas seulement la production.
        //
        // Un produit REVENDU (sirop, confiture) ne sort jamais par
        // `sortie_production` : sa matiere n'est transformee par aucune recette,
        // elle part en `sortie_vente` a la cloture. Filtrer sur la seule
        // production lui donnait donc une consommation percue NULLE, donc un
        // point de commande nul : on ne l'aurait jamais reapprovisionne.
        //
        // Les autres types restent exclus a dessein : une perte, une casse ou
        // une consommation personnelle sont des accidents, pas de la demande.
        // Les inclure ferait recommander pour couvrir des pertes futures.
        inArray(mouvementStock.type, ['sortie_production', 'sortie_vente']),
        eq(mouvementStock.isAnnule, false),
        gte(mouvementStock.dateMouvement, depuis),
        lte(mouvementStock.dateMouvement, jourReference),
      ),
    )
    .groupBy(mouvementStock.dateMouvement)
    .all();

  const parJour = new Map(lignes.map((l) => [l.jour, l.quantite]));

  const serie: number[] = [];
  for (let i = 0; i < fenetreJours; i++) {
    serie.push(parJour.get(ajouterJours(depuis, i)) ?? 0);
  }
  return serie;
}

/** Quantite deja engagee sur des commandes OUVERTES (pas encore recues ni annulees). */
function quantiteDejaCommandee(base: BaseBatte, ingredientId: string): number {
  const resultat = base
    .select({ total: sql<number | null>`SUM(${commandeLigne.quantiteUniteRef})` })
    .from(commandeLigne)
    .innerJoin(commandeFournisseur, eq(commandeLigne.commandeId, commandeFournisseur.id))
    .where(
      and(
        eq(commandeLigne.ingredientId, ingredientId),
        inArray(commandeFournisseur.statut, ['brouillon', 'validee', 'envoyee']),
      ),
    )
    .get();
  return resultat?.total ?? 0;
}

/**
 * Conditionnement de reference d'un ingredient : le plus recent conditionnement
 * ACTIF, tous fournisseurs confondus. Meme regle que le cout de reference d'une
 * recette (D-018, `packages/db/src/depots/recettes.ts`) — appliquee ici au
 * choix du fournisseur a qui commander plutot qu'au cout matiere.
 */
function conditionnementReference(base: BaseBatte, ingredientId: string) {
  return base
    .select({
      conditionnementId: conditionnement.id,
      libelle: conditionnement.libelle,
      tailleConditionnementUniteRef: conditionnement.quantiteUniteRef,
      prixCents: conditionnement.prixCents,
      fournisseurId: conditionnement.fournisseurId,
      fournisseurNom: fournisseur.nom,
    })
    .from(conditionnement)
    .innerJoin(fournisseur, eq(conditionnement.fournisseurId, fournisseur.id))
    .where(
      and(
        eq(conditionnement.ingredientId, ingredientId),
        eq(conditionnement.actif, true),
        // Un fournisseur SYSTEME n'est pas une contrepartie commerciale : on ne
        // lui commande rien. Sans ce filtre, le moteur pouvait emettre un bon de
        // commande adresse a « Inventaire d'ouverture » — reproduit, pas
        // suppose. Le geste declencheur est banal : c'est le fournisseur qu'on
        // vient d'utiliser pour declarer son stock d'ouverture, et il figure
        // dans les listes.
        ne(fournisseur.type, 'systeme'),
      ),
    )
    .orderBy(desc(conditionnement.datePrix))
    .limit(1)
    .get();
}

export type IngredientIgnoreGeneration = {
  ingredientId: string;
  nomIngredient: string;
  motif: string;
};

export type ResultatGenerationCommandes = {
  commandes: CommandeResumeLigne[];
  ignores: IngredientIgnoreGeneration[];
};

type LigneACommander = {
  ingredientId: string;
  nomIngredient: string;
  unite: Unite;
  conditionnementId: string;
  quantiteConditionnements: number;
  quantiteUniteRefTotal: number;
  /** Montant de la ligne, en centimes ENTIERS. Seule valeur qui sera persistee. */
  prixLigneCents: number;
};

/**
 * Calcule le point de commande de chaque ingredient actif et cree des
 * brouillons de commande groupes par fournisseur.
 *
 * ATOMIQUE : soit toutes les commandes et leurs lignes sont creees, soit
 * aucune — un echec en cours de route ne doit jamais laisser une commande
 * sans lignes ni un numero consomme pour rien.
 *
 * N'insere RIEN pour un ingredient dont le besoin est deja couvert par le
 * stock disponible ET par une commande OUVERTE existante : relancer ce calcul
 * plusieurs fois de suite (par exemple un jour ou l'application n'a pas ete
 * ouverte) ne duplique jamais un brouillon deja suffisant.
 */
export function genererBrouillonsCommandes(
  base: BaseBatte,
  options: { jourReference?: string } = {},
): ResultatGenerationCommandes {
  const jourReference = options.jourReference ?? jourCivilBelge(new Date());

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const parametres = lireParametres(baseTx, jourReference);
    const z = parametres.decimal('reappro_niveau_service_z');
    const fenetreJours = parametres.entier('reappro_fenetre_historique_jours');

    const ingredientsActifs = baseTx
      .select()
      .from(ingredient)
      .where(eq(ingredient.actif, true))
      .orderBy(ingredient.nom)
      .all();

    const ignores: IngredientIgnoreGeneration[] = [];
    const lignesParFournisseur = new Map<
      string,
      { fournisseurNom: string; lignes: LigneACommander[] }
    >();

    for (const ing of ingredientsActifs) {
      if (ing.delaiLivraisonJours === null) {
        ignores.push({
          ingredientId: ing.id,
          nomIngredient: ing.nom,
          motif:
            'Délai de livraison non renseigné sur la fiche ingrédient : impossible de ' +
            'calculer un point de commande fiable.',
        });
        continue;
      }

      const reference = conditionnementReference(baseTx, ing.id);
      if (reference === undefined) {
        ignores.push({
          ingredientId: ing.id,
          nomIngredient: ing.nom,
          motif:
            'Aucun conditionnement actif : impossible de déterminer le fournisseur et ' +
            'la taille de commande.',
        });
        continue;
      }

      const quantitesParJour = serieConsommationJournaliere(
        baseTx,
        ing.id,
        jourReference,
        fenetreJours,
      );

      const lots = lotsDeLIngredient(baseTx, ing.id);
      const disponible = quantiteDisponible(lots, jourReference);
      const dejaCommandee = quantiteDejaCommandee(baseTx, ing.id);

      const besoin = calculerBesoinReapprovisionnement({
        quantitesParJourCalendaire: quantitesParJour,
        delaiLivraisonJours: ing.delaiLivraisonJours,
        z,
        stockProjete: disponible + dejaCommandee,
        conditionnementUniteRef: reference.tailleConditionnementUniteRef,
      });

      if (besoin.commande.nbConditionnements === 0) continue;

      // Le montant de la ligne est arrondi UNE fois, ici, puis stocke tel quel.
      // Le prix unitaire du conditionnement reste un intermediaire de calcul :
      // il ne survit pas a l'ecriture, seul le montant entier est persiste
      // (regle n°3). `tailleConditionnementUniteRef` vient d'un conditionnement
      // actif, mais on se protege quand meme d'une fiche a zero — une division
      // par zero produirait un `NaN` que `Math.round` propagerait en base.
      const prixLigneCents =
        reference.tailleConditionnementUniteRef > 0
          ? Math.round(
              (besoin.commande.quantiteUniteRef * reference.prixCents) /
                reference.tailleConditionnementUniteRef,
            )
          : 0;

      const groupe = lignesParFournisseur.get(reference.fournisseurId) ?? {
        fournisseurNom: reference.fournisseurNom,
        lignes: [],
      };
      groupe.lignes.push({
        ingredientId: ing.id,
        nomIngredient: ing.nom,
        unite: ing.uniteReference,
        conditionnementId: reference.conditionnementId,
        quantiteConditionnements: besoin.commande.nbConditionnements,
        quantiteUniteRefTotal: besoin.commande.quantiteUniteRef,
        prixLigneCents,
      });
      lignesParFournisseur.set(reference.fournisseurId, groupe);
    }

    const maintenant = maintenantUtc();
    const annee = Number.parseInt(jourReference.slice(0, 4), 10);
    const commandesCreees: CommandeResumeLigne[] = [];

    for (const [fournisseurId, groupe] of lignesParFournisseur) {
      const numero = allouerNumero(baseTx, 'commande', annee);
      const commandeId = nouvelIdentifiant();
      // Somme EXACTE des montants qui vont etre ecrits, et non une somme
      // d'arrondis recalcules a partir des taux : le total de l'entete est
      // desormais prouvablement egal a la somme de ses lignes en base.
      const montantTotalCents = groupe.lignes.reduce((somme, l) => somme + l.prixLigneCents, 0);

      baseTx
        .insert(commandeFournisseur)
        .values({
          id: commandeId,
          numero,
          fournisseurId,
          statut: 'brouillon',
          dateCreation: maintenant,
          dateEnvoi: null,
          dateReceptionPrevue: null,
          montantTotalCents,
          genereAutomatiquement: true,
          emailEnvoyeA: null,
          /**
           * SCHÉMA MORT, signalé ici pour le prochain lecteur (Trou 4, audit
           * du 30/07/2026) : cette colonne n'est JAMAIS renseignée après sa
           * création à `null`, et aucune route ni écran ne la lit — vérifié
           * par recherche exhaustive (`grep -r documentId`), y compris dans
           * `contrats/commandes.ts`, qui ne la déclare même pas.
           *
           * Le mécanisme d'archivage RÉEL (D-026, `document_genere`) lie DANS
           * L'AUTRE SENS : `type = 'bon_commande'`, `objet_id = commande.id`
           * (voir `apps/api/src/routes/commandes.ts::genererPdfCommande`).
           * Une seule raison suffit à ne PAS relier cette colonne : D-026
           * archive une NOUVELLE VERSION à chaque régénération du PDF (le
           * bon de commande peut être consulté plusieurs fois avant l'envoi),
           * donc plusieurs lignes `document_genere` peuvent légitimement
           * exister pour UNE commande. Un simple FK `document_id` ne pourrait
           * pointer que vers UNE version — soit la première (fausse dès la
           * deuxième régénération), soit la dernière (à réécrire à chaque
           * appel, ce que D-026 interdit explicitement : « le fichier
           * précédent reste sur disque et en base », jamais écrasé).
           *
           * Retirer la colonne est hors périmètre (`schema.ts` réservé à un
           * autre chantier) : elle reste donc `null` à vie, et c'est le
           * comportement CORRECT, pas un oubli.
           */
          documentId: null,
          notes: null,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      for (const ligne of groupe.lignes) {
        baseTx
          .insert(commandeLigne)
          .values({
            id: nouvelIdentifiant(),
            commandeId,
            ingredientId: ligne.ingredientId,
            conditionnementId: ligne.conditionnementId,
            quantiteConditionnements: ligne.quantiteConditionnements,
            quantiteUniteRef: ligne.quantiteUniteRefTotal,
            prixLigneCents: ligne.prixLigneCents,
          })
          .run();
      }

      commandesCreees.push({
        id: commandeId,
        numero,
        fournisseurId,
        fournisseurNom: groupe.fournisseurNom,
        statut: 'brouillon',
        dateCreation: maintenant,
        dateEnvoi: null,
        montantTotalCents,
        nbLignes: groupe.lignes.length,
        genereAutomatiquement: true,
        // Un brouillon qui vient d'être généré n'a, par construction, encore
        // aucune réception qui le référence.
        receptionNumero: null,
        receptionStatut: null,
      });
    }

    return { commandes: commandesCreees, ignores };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cycle de vie — brouillon -> validee -> envoyee
   ═══════════════════════════════════════════════════════════════════════════ */

function chargerCommande(base: BaseBatte, commandeId: string) {
  const trouvee = base
    .select()
    .from(commandeFournisseur)
    .where(eq(commandeFournisseur.id, commandeId))
    .get();
  if (trouvee === undefined) throw new ErreurIntrouvable('Commande', commandeId);
  return trouvee;
}

/**
 * `brouillon -> validee`. Aucune autre transition n'entre ici : c'est la
 * garantie technique que valider un brouillon deux fois, ou valider une
 * commande deja envoyee, echoue avec un message qui nomme le statut en cause.
 */
export function validerCommande(base: BaseBatte, commandeId: string): void {
  const commande = chargerCommande(base, commandeId);

  if (commande.statut !== 'brouillon') {
    throw new ErreurMetier(
      'commande_non_brouillon',
      `La commande ${commande.numero} est en statut « ${commande.statut} » : ` +
        'seul un brouillon peut être validé.',
    );
  }

  base
    .update(commandeFournisseur)
    .set({ statut: 'validee', modifieLe: maintenantUtc() })
    .where(eq(commandeFournisseur.id, commandeId))
    .run();
}

/**
 * Annule une commande, sans jamais l'effacer (règle n°7).
 *
 * DÉFAUT TROUVÉ EN AUDIT (29/07/2026, chaîne d'achat) : le statut `annulee`
 * existe dans `schemaStatutCommande` depuis le Lot 7, et `Achats.tsx` porte
 * même un affichage dédié pour ce statut — mais AUCUNE fonction, nulle part,
 * ne l'écrivait. Un brouillon généré pour un ingrédient qu'on décide finalement
 * de ne pas commander (rupture d'approvisionnement chez le meunier, quantité
 * revue à la baisse après un comptage) restait donc coincé en `brouillon`
 * POUR TOUJOURS : `quantiteDejaCommandee` le compte parmi les commandes
 * OUVERTES (`brouillon`, `validee`, `envoyee`), donc le stock projeté restait
 * artificiellement gonflé et `genererBrouillonsCommandes` ne reproposait plus
 * jamais rien pour cet ingrédient — la même famille de défaut que D-036, mais
 * côté abandon plutôt que côté réception.
 *
 * Autorisée depuis `brouillon` et `validee` seulement : une commande `envoyee`
 * a déjà quitté l'application vers un vrai fournisseur, et une commande
 * `recue` correspond à une livraison réellement arrivée — aucune des deux ne
 * se défait par un clic, le désaccord se règle avec le fournisseur, pas dans
 * l'application (même esprit que « rien ne s'efface »).
 *
 * `motif` est facultatif et réutilise la colonne `notes` existante (aucune
 * colonne supplémentaire nécessaire) : une raison figée aide à comprendre,
 * six mois plus tard, pourquoi cette commande n'a jamais été honorée.
 *
 * JOURNALISATION (audit du 30/07/2026, Trou 5 — le journal d'audit n'avait
 * aucune ligne sur la vraie base). Cette fonction écrivait déjà le
 * changement de statut SANS jamais appeler `journaliser`, contrairement à
 * `annulerProduction` (`services/production.ts`), qui trace la même famille
 * de geste — une DÉCISION d'annulation. Une commande annulée en silence
 * n'est pas un défaut visible sur la base actuelle (aucune commande réelle
 * n'a encore été annulée), mais c'est une action corrective MUETTE par
 * construction : le jour où ce chemin sert, CLAUDE.md §3 règle 7 (« journal
 * d'audit sur toutes les tables sensibles ») serait violé sans qu'aucun test
 * ne le voie. Corrigé ici, dans la même transaction que l'écriture tracée
 * (même discipline que `depots/audit.ts` : « même transaction que la
 * modification tracée »).
 */
export function annulerCommande(base: BaseBatte, commandeId: string, motif?: string): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    const commande = chargerCommande(baseTx, commandeId);

    if (commande.statut !== 'brouillon' && commande.statut !== 'validee') {
      throw new ErreurMetier(
        'commande_non_annulable',
        `La commande ${commande.numero} est en statut « ${commande.statut} » : seule une commande ` +
          'en brouillon ou validée (pas encore envoyée) peut être annulée. Une commande déjà ' +
          "envoyée ou reçue ne se défait pas d'un clic : le désaccord se règle avec le fournisseur.",
      );
    }

    const apres = baseTx
      .update(commandeFournisseur)
      .set({
        statut: 'annulee',
        notes: motif ?? commande.notes,
        modifieLe: maintenantUtc(),
      })
      .where(eq(commandeFournisseur.id, commandeId))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'commande_fournisseur',
      enregistrementId: commandeId,
      action: 'annulation',
      valeurAvant: commande,
      valeurApres: apres,
    });
  });
}

/**
 * `validee -> envoyee`. Refuse toute autre origine, y compris `brouillon` :
 * c'est exactement la garantie de D-009 — aucun envoi sans validation humaine
 * explicite, pas seulement par convention d'interface mais par ce refus.
 *
 * PERSISTE LE FAIT « ce mail-là est-il parti ? » (mission « le seul piège
 * silencieux qui reste », 01/08/2026) : `envoi.modeTest` — connu UNE SEULE
 * FOIS, au moment même de l'appel, par `apps/api/src/routes/commandes.ts`
 * depuis le retour de `envoyerMail` (`apps/api/src/mail.ts`) — est annoté dans le
 * journal d'audit, en même transaction que la bascule de statut (même
 * discipline que `annulerCommande` ci-dessus, et que `depots/audit.ts` :
 * « même transaction que la modification tracée »). Sans cette écriture, le
 * mode d'envoi n'existait plus nulle part une fois la réponse HTTP partie :
 * rouvrir la commande après un rechargement de page la montrait comme un
 * envoi réel, qu'il l'ait été ou non.
 */
export function marquerEnvoyee(
  base: BaseBatte,
  commandeId: string,
  emailEnvoyeA: string,
  envoi: EnvoiModeTestConnu,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    const commande = chargerCommande(baseTx, commandeId);

    if (commande.statut !== 'validee') {
      throw new ErreurMetier(
        'commande_non_validee',
        `La commande ${commande.numero} est en statut « ${commande.statut} » : ` +
          "seule une commande validée peut être envoyée. Validez-la avant de l'envoyer.",
      );
    }
    if (emailEnvoyeA.trim() === '') {
      throw new ErreurMetier(
        'email_manquant',
        "Aucune adresse email n'a été fournie pour l'envoi de cette commande.",
        { champs: { email: 'Adresse email requise.' } },
      );
    }

    const maintenant = maintenantUtc();
    const apres = baseTx
      .update(commandeFournisseur)
      .set({
        statut: 'envoyee',
        dateEnvoi: maintenant,
        emailEnvoyeA,
        modifieLe: maintenant,
      })
      .where(eq(commandeFournisseur.id, commandeId))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'commande_fournisseur',
      enregistrementId: commandeId,
      action: 'modification',
      valeurAvant: commande,
      // `envoiModeTest`/`envoiCheminFichierTest` : PAS des colonnes de
      // `commande_fournisseur`, seulement une annotation posée sur ce fait
      // dans la colonne JSON déjà libre du journal — voir
      // `envoiModeTestConnu` ci-dessus pour la lecture symétrique.
      valeurApres: {
        ...apres,
        envoiModeTest: envoi.modeTest,
        envoiCheminFichierTest: envoi.cheminFichierTest,
      },
    });
  });
}
