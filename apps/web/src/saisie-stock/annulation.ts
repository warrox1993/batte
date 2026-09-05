import { formaterDate, motifsPour } from '@batte/core';
import type { OptionSelection } from './champs';

/**
 * Décisions PURES partagées par les deux écrans qui annulent une écriture de
 * LOT : `DetailLot.tsx` (annuler la réception qui a créé ce lot) et
 * `pages/Production.tsx` (annuler une production, donc rendre les lots
 * qu'elle a consommés).
 *
 * D-087 (31/07/2026) : ce sont exactement les deux seules écritures qui
 * CRÉENT ou CONSOMMENT des lots, donc les deux seules dont une erreur remonte
 * jusqu'au registre AFSCA. Leurs deux routes existaient — service,
 * contrepassation, motif obligatoire, tests — et aucun écran ne les appelait.
 *
 * POURQUOI CE FICHIER, ET PAS `lib/`. Les deux écrans doivent poser les mêmes
 * questions (« cette écriture est-elle encore annulable ? », « que dire de la
 * commande liée ? ») et une seconde implémentation qui divergerait ferait dire
 * à un écran ce que l'autre contredirait. Sa place naturelle serait
 * `apps/web/src/lib/` — voir le rapport de livraison : ce dossier n'est pas
 * dans la zone d'écriture de la mission qui l'a créé, et le déplacer est un
 * geste sans risque à faire par son propriétaire.
 *
 * Règle d'architecture n°1 : aucun CALCUL métier ici. Ces fonctions lisent des
 * statuts déjà décidés par le serveur et choisissent une phrase. Le serveur
 * reste la seule autorité sur le refus lui-même (`annulerReception`,
 * `annulerProduction`, `contrepasserMouvement`) — ce qui est écrit ici sert à
 * le DIRE AVANT le clic, jamais à s'en passer.
 */

/**
 * Motifs d'AJUSTEMENT. Une annulation n'est ni une perte ni une sortie
 * volontaire : la matière n'a jamais bougé, c'est l'écriture qui était fausse.
 * `motifsPour` (`@batte/core`) lit `CATALOGUE_MOTIFS`, module statique déjà
 * présent côté navigateur — jamais un `GET /motifs` qui relaierait une donnée
 * qu'on a déjà, ni un filtre par catégorie réécrit à la main (règle n°1).
 *
 * Au niveau du module et non dans un `useMemo` : le catalogue ne change pas
 * pendant la vie de l'application, et `motifsPour` rend un tableau neuf à
 * chaque appel — ce qui ferait inutilement changer une dépendance de rendu.
 */
export const OPTIONS_MOTIF_ANNULATION: readonly OptionSelection[] = motifsPour('ajustement').map(
  (motif) => ({ valeur: motif.code, libelle: motif.libelle }),
);

/* ═══════════════════════════════════════════════════════════════════════════
   Ce qui EMPÊCHE d'annuler — dit avant le clic, jamais découvert après
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Raison pour laquelle le bouton d'annulation n'est PAS proposé, ou `null`
 * quand il l'est. Le texte est rendu ici, en français, à la place du bouton :
 * un bouton qui échoue toujours est le même défaut qu'un avertissement absent.
 */
export type BlocageAnnulation = { readonly raison: string } | null;

/**
 * CE QUI N'EST PAS ANNONCÉ ICI, ET POURQUOI — deux refus sur trois.
 *
 * 1. LE LOT DÉJÀ CONSOMMÉ (`entree_deja_consommee`, levé par
 *    `contrepasserMouvement`). Refus RÉEL et fréquent, mais impossible à
 *    anticiper honnêtement depuis un écran : une réception peut avoir créé
 *    plusieurs lots et l'écran n'en connaît qu'un. Annoncer « annulable »
 *    d'après ce seul lot mentirait une fois sur deux. Il arrive donc en
 *    refus — avec le nom de l'ingrédient et la quantité manquante déjà
 *    écrits par le serveur, affichés tels quels.
 *
 * 2. LA PÉRIODE VERROUILLÉE. La garde existe et elle est juste
 *    (`verifierPeriodeNonVerrouillee`, `depots/comptabilite.ts`), mais
 *    vérification faite : `statut = 'verrouillee'` n'est écrit par AUCUN
 *    chemin de production — une clôture pose `'cloturee'`, et seule une
 *    fixture de test pose l'autre. Un avertissement préventif pour un état
 *    qui ne peut pas survenir est exactement le signal qui apprend à ignorer
 *    ceux qui le peuvent (docs/07 §3.5 : « aucune alerte non actionnable »,
 *    « après une première alerte ignorée, ignorées ensuite à 87,9 % »). Le
 *    jour où le verrouillage sera câblé, la garde se déclenchera et son
 *    message français remontera par le chemin d'erreur, comme les autres.
 */

/** Une réception est-elle encore annulable, et sinon pourquoi ? */
export function blocageAnnulationReception(etat: {
  readonly receptionStatut: 'active' | 'annulee';
}): BlocageAnnulation {
  if (etat.receptionStatut === 'annulee') {
    return {
      raison:
        'Réception déjà annulée : les entrées de ses lots ont été contrepassées. Une écriture ne ' +
        "se contrepasse qu'une seule fois — les deux restent au journal.",
    };
  }
  return null;
}

/**
 * Une production est-elle encore annulable, et sinon pourquoi ? Les deux refus
 * ANNONÇABLES d'`annulerProduction` (`packages/db/src/services/production.ts`),
 * dans le même ordre — voir ci-dessus pour ceux qui ne le sont pas.
 */
export function blocageAnnulationProduction(etat: {
  readonly statut: 'lancee' | 'terminee' | 'annulee';
  readonly sessionStatut: string | null;
  readonly sessionNumero: string | null;
}): BlocageAnnulation {
  if (etat.statut === 'annulee') {
    return {
      raison:
        'Production déjà annulée : ses mouvements de stock ont été contrepassés. Une écriture ne ' +
        "se contrepasse qu'une seule fois — les deux restent au journal.",
    };
  }
  if (etat.sessionStatut === 'cloturee') {
    // Le numéro est repris quand on l'a ; sans lui, la phrase reste exacte
    // plutôt que de citer un numéro inventé (CLAUDE.md §7).
    const session = etat.sessionNumero === null ? 'sa session' : `la session ${etat.sessionNumero}`;
    return {
      raison:
        `Rattachée à ${session}, déjà clôturée : ses agrégats sont figés (D-024). Annuler cette ` +
        'production changerait un coût matière déjà arrêté sans que la marge affichée ne le ' +
        'répercute jamais.',
    };
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ce que la confirmation dit — chiffres du serveur, jamais recalculés
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ce qu'il faut dire AVANT de confirmer l'annulation d'une réception.
 *
 * Le nombre de lots est le point de la phrase : une réception est une PIÈCE
 * (le meunier livre la farine, le sel et le sucre sous un seul bon), et
 * l'annuler contrepasse l'entrée de TOUS ses lots dans une seule transaction.
 * Sans ce nombre, on croit corriger une ligne et on en corrige trois.
 */
export function phraseAvantAnnulationReception(reception: {
  readonly numero: string;
  readonly dateReception: string;
  readonly nbLots: number;
  /**
   * Vrai quand le geste part d'UN lot (`DetailLot.tsx`) : la phrase précise
   * alors que le lot regardé fait partie du lot d'écritures contrepassées —
   * c'est exactement le malentendu à lever, on croit corriger la ligne qu'on a
   * sous les yeux. Faux depuis l'écran de saisie, où aucun lot n'est
   * « celui-ci » et où la précision n'aurait aucun référent.
   */
  readonly depuisUnLot: boolean;
}): string {
  const unique = reception.nbLots === 1;
  const lots = unique
    ? "l'entrée de son unique lot"
    : `les entrées de ses ${reception.nbLots} lots${reception.depuisUnLot ? ', celui-ci compris' : ''}`;
  // La seconde phrase s'accorde avec la première : « un seul de ces lots »
  // devant « son unique lot » désignerait un pluriel qui n'existe pas.
  const condition = unique
    ? "Si ce lot a déjà été consommé, même en partie, l'annulation est refusée"
    : "Si un seul de ces lots a déjà été consommé, même en partie, l'annulation entière est refusée";
  return (
    `Annuler la réception ${reception.numero} du ${formaterDate(reception.dateReception)} ` +
    `contrepassera ${lots}. ${condition} : cette matière a réellement servi, elle ne peut pas ` +
    'être « désreçue ».'
  );
}

/**
 * Ce qu'il faut dire AVANT de confirmer l'annulation d'une production.
 *
 * Le nombre de mouvements n'y figure PAS, volontairement : `annulerProduction`
 * contrepasse tous les mouvements portant `production_id`, ce qui inclut les
 * écarts de réalisé (docs/17 fiche 9) — l'écran ne connaît que les
 * consommations agrégées par lot, un compte annoncé d'avance serait donc faux
 * dès qu'un écart a été déclaré. Le chiffre exact vient du serveur, après
 * (`phraseApresAnnulationProduction`).
 */
export function phraseAvantAnnulationProduction(production: { readonly numero: string }): string {
  return (
    `Annuler la production ${production.numero} contrepassera tous ses mouvements de stock : la ` +
    "matière consommée revient dans ses lots d'origine, en écritures inverses, y compris les " +
    'écarts déjà déclarés au réalisé. La production restera lisible dans l’historique, marquée ' +
    '« Annulée » — rien ne s’efface.'
  );
}

/**
 * Ce que devient la COMMANDE liée après annulation, en une phrase — ou `null`
 * quand aucune commande n'était liée, et alors rien n'est ajouté.
 *
 * NE JAMAIS CONFONDRE LES DEUX CHAMPS, le contrat le commente déjà
 * (`schemaAnnulationReceptionCreee`, `packages/core/src/contrats/stock.ts`) :
 * `commandeId` dit si une commande ÉTAIT liée ; `commandeStatutRestaure` dit à
 * quel statut elle a été REMISE, et il vaut `null` dans beaucoup de cas où
 * `commandeId` ne l'est pas — une réception enregistrée avant que le journal
 * d'audit ne fige ce statut antérieur ne laisse rien à retrouver, et
 * CLAUDE.md §7 interdit de le deviner. Le troisième cas doit donc se lire à
 * l'écran, pas seulement dans `commande.notes`.
 */
export function phraseCommandeApresAnnulationReception(resultat: {
  readonly commandeId: string | null;
  readonly commandeStatutRestaure: 'brouillon' | 'validee' | 'envoyee' | null;
}): string | null {
  if (resultat.commandeId === null) return null;
  if (resultat.commandeStatutRestaure === null) {
    return (
      'Une commande était liée : son statut antérieur n’a pas pu être retrouvé avec certitude, ' +
      'elle reste « reçue » et l’incohérence est écrite dans ses notes.'
    );
  }
  const libelle: Readonly<Record<'brouillon' | 'validee' | 'envoyee', string>> = {
    brouillon: 'brouillon',
    validee: 'validée',
    envoyee: 'envoyée',
  };
  return `La commande liée est revenue au statut « ${libelle[resultat.commandeStatutRestaure]} ».`;
}

/**
 * Confirmation d'une annulation de réception. `nbMouvementsContrepasses` vient
 * du serveur et n'est jamais recalculé ici : il compte les entrées ENCORE
 * OUVERTES au moment de l'annulation, donc pas forcément le nombre de lots
 * (un lot déjà contrepassé isolément n'y figure plus).
 */
export function phraseApresAnnulationReception(resultat: {
  readonly numero: string;
  readonly nbMouvementsContrepasses: number;
  readonly commandeId: string | null;
  readonly commandeStatutRestaure: 'brouillon' | 'validee' | 'envoyee' | null;
}): string {
  const entrees =
    resultat.nbMouvementsContrepasses === 1
      ? '1 entrée contrepassée'
      : `${resultat.nbMouvementsContrepasses} entrées contrepassées`;
  const commande = phraseCommandeApresAnnulationReception(resultat);
  return (
    `Réception ${resultat.numero} annulée — ${entrees}. Les écritures annulées restent au ` +
    `journal, barrées.${commande === null ? '' : ` ${commande}`}`
  );
}

/** Confirmation d'une annulation de production, même discipline de chiffres. */
export function phraseApresAnnulationProduction(resultat: {
  readonly numero: string;
  readonly nbMouvementsContrepasses: number;
}): string {
  const mouvements =
    resultat.nbMouvementsContrepasses === 1
      ? '1 mouvement contrepassé'
      : `${resultat.nbMouvementsContrepasses} mouvements contrepassés`;
  return (
    `Production ${resultat.numero} annulée — ${mouvements}. La matière est revenue dans ses lots ` +
    "d'origine ; les écritures annulées restent au journal, barrées."
  );
}
