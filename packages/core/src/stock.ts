/**
 * Logique de stock pure : FEFO, valorisation, disponibilite.
 *
 * Regle d'architecture n°5 (CLAUDE.md §3) : **le stock est la somme de ses
 * mouvements**. Aucune fonction de ce fichier ne prend ni ne rend une quantite
 * « stockee » — elles travaillent toutes sur des restants deja calcules par
 * l'appelant a partir des mouvements.
 *
 * Regle n°6 : la consommation se fait en FEFO (*first expired, first out*),
 * pas en FIFO. Ce n'est pas une preference : c'est ce qu'impose une denree a
 * DLC, et Microsoft recommande explicitement FIFO/FEFO pour « les articles a
 * duree de vie limitee, ou les plus anciens doivent etre vendus avant leur date
 * de peremption » (docs/07 §1.7).
 */

import { ErreurMetier } from './erreurs.js';
import { joursEntre } from './horodatage.js';

/**
 * Statut d'un lot. Un ERP BLOQUE, il n'autorise pas au fil de l'eau : un lot
 * suspecte non conforme passe en quarantaine avant decision, et le deblocage
 * est un evenement trace (docs/07 §6.8 rang 10).
 */
export type StatutLot = 'disponible' | 'quarantaine' | 'bloque' | 'detruit';

export type LotStock = {
  readonly id: string;
  readonly ingredientId: string;
  readonly numeroLotFournisseur: string | null;
  /** Jour civil `AAAA-MM-JJ`. `null` = denree non perissable. */
  readonly dateDlc: string | null;
  readonly dateReception: string;
  /** Deja calcule comme `quantite_initiale - somme des sorties`. */
  readonly quantiteRestante: number;
  /** Prix d'achat unitaire du lot, en centimes par unite de reference. */
  readonly prixUnitaireCents: number;
  readonly statut: StatutLot;
};

export type AllocationFefo = {
  readonly lotId: string;
  readonly quantite: number;
  readonly coutCents: number;
  /** Vrai si ce lot a ete retenu malgre une DLC depassee, sur motif explicite. */
  readonly dlcDepassee: boolean;
};

export type ResultatFefo = {
  readonly allocations: readonly AllocationFefo[];
  /** Quantite qu'on n'a PAS pu servir. `0` si le stock suffit. */
  readonly quantiteManquante: number;
  readonly coutTotalCents: number;
};

export type OptionsFefo = {
  /**
   * Autorise a consommer un lot perime. Faux par defaut : c'est l'invariant n°2
   * de docs/02 (« aucun mouvement de sortie sur un lot dont la DLC est depassee,
   * sauf motif explicite enregistre »). L'appelant qui passe `true` DOIT
   * enregistrer un motif sur le mouvement.
   */
  readonly autoriserDlcDepassee?: boolean;
};

/**
 * Ordre FEFO : ce qui perime le plus tot part en premier.
 *
 * Un lot sans DLC passe en DERNIER, et non en premier : une denree non
 * perissable n'est jamais urgente, la garder ne coute rien alors que garder
 * une denree datee la fait perimer.
 *
 * A DLC egale, on departage par date de reception : sans ce second critere,
 * l'ordre dependrait de l'ordre de lecture SQL, donc une meme production
 * consommerait des lots differents d'une execution a l'autre — ce qui rendrait
 * la tracabilite non reproductible.
 */
export function ordonnerFefo(lots: readonly LotStock[]): LotStock[] {
  return [...lots].sort((a, b) => {
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
 * Vrai si une DLC est strictement anterieure au jour de reference.
 *
 * Prend la DATE seule, et non un `LotStock` complet : l'ecran Stock (Lot 2)
 * n'a cote client que `dateDlc` (contrat HTTP `LotDetail`), jamais tous les
 * champs d'un `LotStock` — construire un faux lot pour ce seul test serait
 * plus de code, pas moins. C'est cette meme fonction qui doit trancher
 * « perime » des deux cotes, serveur et client, sinon les deux pourraient un
 * jour diverger sur la definition de « perime ».
 */
export function estPerime(dateDlc: string | null, jourReference: string): boolean {
  if (dateDlc === null) return false;
  return joursEntre(jourReference, dateDlc) < 0;
}

/**
 * Avertissement NON BLOQUANT : la DLC saisie a la reception est DEJA
 * DEPASSEE au jour meme de cette reception.
 *
 * DEFAUT REPERE (docs/27-PARCOURS-REJOUE.md §3.d, 01/08/2026) : rien
 * n'avertit aujourd'hui quand une DLC saisie a la reception est deja
 * depassee — une DLC du 01/01/2026 saisie a une reception du 01/08/2026
 * (sept mois de retard) s'enregistre normalement, sans un mot. La
 * marchandise entre alors en stock, et le lot n'est marque « Perime »
 * qu'A POSTERIORI, en le rouvrant dans l'ecran Stock.
 *
 * NE PAS REFUSER LA RECEPTION : un lot livre deja perime est un FAIT, pas
 * une anomalie a rejeter — CLAUDE.md §7 et l'AFSCA exigent justement de
 * pouvoir tracer une marchandise perimee des son entree, pas de faire
 * disparaitre l'evenement en refusant de l'enregistrer. Mais NE RIEN DIRE
 * est une faute distincte : la cause la plus probable d'une DLC deja
 * depassee AU MOMENT MEME de la reception est une faute de frappe sur la
 * date (« 31/03/2027 » tape « 31/03/2026 ») — une erreur qui, sans
 * avertissement, ne se decouvre qu'un jour par hasard dans l'ecran Stock,
 * apres avoir deja fausse la FEFO (le lot est ecarte a raison, mais pour la
 * mauvaise raison presumee), les alertes de DLC proche et le registre
 * AFSCA.
 *
 * MEME FAMILLE que l'avertissement deja ecrit par `enregistrerReception`
 * (`packages/db/src/services/reception.ts`) pour un lot identifie par sa
 * seule DLC, sans numero de lot fournisseur : un tableau de PHRASES non
 * bloquantes, affichees TELLES QUELLES par `avertissementsReceptionAAfficher`
 * (`affichage.ts`), jamais reformulees. Cette fonction ne fait que FOURNIR la
 * phrase : c'est `enregistrerReception` qui decide de l'emettre, a cote de
 * l'avertissement « identifie par sa seule DLC », par le meme mecanisme.
 *
 * `null` quand il n'y a rien a dire : pas de DLC saisie, ou DLC pas encore
 * depassee a la date de reception (y compris le jour meme de la DLC — meme
 * convention que `estPerime`).
 */
export function avertissementDlcDejaDepassee(
  nomIngredient: string,
  dateDlc: string | null,
  dateReception: string,
): string | null {
  if (dateDlc === null || !estPerime(dateDlc, dateReception)) return null;
  const joursDeRetard = -joursEntre(dateReception, dateDlc);
  return (
    `${nomIngredient} : la DLC saisie (${dateDlc}) est déjà dépassée de ${joursDeRetard} jour` +
    `${joursDeRetard > 1 ? 's' : ''} à la date de cette réception (${dateReception}) — vérifiez ` +
    `qu'il ne s'agit pas d'une erreur de saisie de date (jour, mois ou année inversés). La ` +
    'réception reste enregistrée telle quelle : une marchandise livrée déjà périmée doit rester ' +
    'traçable, pas disparaître.'
  );
}

/**
 * Repartit une quantite a consommer sur les lots, en FEFO.
 *
 * Ne leve pas si le stock est insuffisant : rend `quantiteManquante`, parce que
 * l'ecran de faisabilite du Lot 3 doit pouvoir dire « il manque 1,2 kg » plutot
 * que d'echouer sans chiffre.
 *
 * Ne peut jamais sur-consommer un lot (invariant n°1) : chaque allocation est
 * bornee par le restant du lot.
 */
export function repartirFefo(
  lots: readonly LotStock[],
  quantiteRequise: number,
  jourReference: string,
  options: OptionsFefo = {},
): ResultatFefo {
  if (quantiteRequise < 0) {
    throw new ErreurMetier(
      'quantite_negative',
      'Une quantité à consommer ne peut pas être négative.',
    );
  }

  const autoriserDlcDepassee = options.autoriserDlcDepassee ?? false;

  const eligibles = ordonnerFefo(
    lots.filter(
      (lot) =>
        // Seul un lot `disponible` se consomme. Quarantaine, blocage et
        // destruction sont des decisions explicites qui doivent etre levees
        // par un evenement trace, jamais contournees par la FEFO.
        lot.statut === 'disponible' &&
        lot.quantiteRestante > 0 &&
        (autoriserDlcDepassee || !estPerime(lot.dateDlc, jourReference)),
    ),
  );

  const allocations: AllocationFefo[] = [];
  let reste = quantiteRequise;
  let coutTotalCents = 0;

  for (const lot of eligibles) {
    if (reste <= 0) break;
    const quantite = Math.min(reste, lot.quantiteRestante);
    const coutCents = Math.round(quantite * lot.prixUnitaireCents);
    allocations.push({
      lotId: lot.id,
      quantite,
      coutCents,
      dlcDepassee: estPerime(lot.dateDlc, jourReference),
    });
    coutTotalCents += coutCents;
    reste -= quantite;
  }

  return { allocations, quantiteManquante: reste, coutTotalCents };
}

/**
 * Coût unitaire moyen pondere des lots restants, en centimes par unite.
 *
 * Rend `null` et non `0` quand il n'y a plus de stock : un ingredient epuise
 * n'a pas un cout de zero, il n'a pas de cout. Zero ferait apparaitre une marge
 * de 100 % sur la prochaine production.
 *
 * C'est bien une VALEUR CALCULEE et jamais stockee (decision D-018) : la
 * colonne `cump_cents_par_unite` de docs/02 n'existe pas dans le schema.
 *
 * INCHANGEE par le correctif de valorisation ci-dessous (mission « un lot
 * perime ne pese plus dans la valeur du stock ») : cette fonction continue
 * d'inclure un lot perime dans sa moyenne, exactement comme avant. Ce n'est
 * pas un oubli, c'est le perimetre de la mission qui l'impose (« tu ne touches
 * a aucun autre calcul que celui de la valorisation ») — mais la consequence
 * doit etre dite : docs/02 §« Invariants a tester explicitement » n°6 affirme
 * « le CUMP d'un ingredient est toujours coherent avec la valorisation de ses
 * lots restants ». Cet invariant NE TIENT PLUS globalement des qu'un lot
 * perime existe encore en stock : `calculerCump(lots) * quantiteRestanteTotale`
 * (qui compte le perime) et `valoriserStock(lots, jourReference)` (qui l'exclut
 * desormais) divergent alors EXACTEMENT de `valoriserStockPerime(lots,
 * jourReference)`. L'invariant reste vrai quand aucun lot n'est perime — c'est
 * le seul cas que le test existant (`stock.test.ts`) verifie, et il reste
 * vrai tel quel. Un test dedie, plus bas, mesure l'ecart dans le cas perime
 * pour que cette divergence soit visible plutot que decouverte par hasard.
 */
export function calculerCump(lots: readonly LotStock[]): number | null {
  let quantite = 0;
  let valeurCents = 0;

  for (const lot of lots) {
    // Un lot detruit ne vaut plus rien et ne doit pas peser dans la moyenne.
    // La quarantaine et le blocage, si : la marchandise existe encore et sera
    // peut-etre debloquee.
    if (lot.statut === 'detruit') continue;
    if (lot.quantiteRestante <= 0) continue;
    quantite += lot.quantiteRestante;
    valeurCents += lot.quantiteRestante * lot.prixUnitaireCents;
  }

  return quantite === 0 ? null : valeurCents / quantite;
}

/**
 * Un lot est-il encore un ACTIF VENDABLE, du seul point de vue de la
 * valorisation ?
 *
 * Quatre etats existent sur un lot (`StatutLot`), plus la DLC, plus le statut
 * de sa reception d'origine (`receptionStatut`) — mais UN SEUL raisonnement
 * tranche « peut-on encore le vendre ? » :
 *
 *  - `detruit` : la matiere est physiquement sortie (mouvement de perte ecrit
 *    par `changerStatutLot`), son `quantiteRestante` est deja retombe a 0 —
 *    exclue de toute facon par le filtre `quantiteRestante <= 0` ci-dessous,
 *    mais le statut reste verifie en plus, en garde-fou explicite.
 *  - PERIME (`estPerime(dateDlc, jourReference)`) : la vente d'une denree
 *    perimee est interdite par la reglementation alimentaire — ce n'est pas
 *    une prudence commerciale, c'est un fait legal. Une matiere qu'on ne peut
 *    plus vendre n'est pas un actif, quel que soit ce qu'elle a coute
 *    (CLAUDE.md §7 : ne rien minorer, mais ne rien surevaluer non plus).
 *  - `quarantaine` et `bloque` : PIEGE SYMETRIQUE, verifie explicitement par
 *    un test — ces deux statuts NE sont PAS exclus ici. Une quarantaine est
 *    une matiere EN ATTENTE DE VERIFICATION (`schema.ts` : « un lot suspecte
 *    non conforme passe en quarantaine avant decision »), pas une matiere
 *    perdue ; un blocage peut lever a la decision (rappel fournisseur clos,
 *    non-conformite levee). La retirer de la valeur serait aussi faux que d'y
 *    laisser un lot perime : les deux inventent une certitude qu'on n'a pas.
 *    La question posee ici est « peut-on encore le vendre ? », jamais
 *    « son statut administratif est-il normal ? ».
 *  - `receptionStatut === 'annulee'` : deliberement PAS teste ici. Une
 *    reception annulee contrepasse integralement l'entree de chacun de ses
 *    lots ENCORE INTACTS (`annulerReception`,
 *    `packages/db/src/services/reception.ts`) — le seul cas ou elle echoue
 *    est un lot deja partiellement consomme par une production active, auquel
 *    cas la reception REDEVIENT refusee et reste `active`. Un lot dont la
 *    reception est reellement `annulee` a donc toujours `quantiteRestante`
 *    ramene a 0, deja exclu par le filtre `quantiteRestante <= 0` : lui donner
 *    un second filtre ici serait une regle morte, jamais atteinte en pratique.
 */
/**
 * Sous-ensemble d'un `LotStock` suffisant pour la valorisation — exactement
 * les quatre champs que `valoriserStock`/`valoriserStockPerime` lisent,
 * jamais `id`, `ingredientId`, `numeroLotFournisseur` ni `dateReception`.
 *
 * Ce sous-typage n'est pas une elegance : il permet a l'ecran Stock
 * (`apps/web/src/pages/Stock.tsx`) d'appeler ces DEUX MEMES fonctions
 * directement sur `LotDetail` (`packages/core/src/contrats/stock.ts`), le
 * contrat que `GET /stock/:id/lots` rend deja au navigateur — qui ne porte
 * PAS `ingredientId` (l'ingredient est deja connu par le panneau qui affiche
 * ces lots, voir le commentaire de `schemaLotDetail`). Sans cet
 * assouplissement, l'ecran aurait du soit fabriquer un `ingredientId` factice
 * pour satisfaire un champ dont ce calcul n'a jamais eu besoin, soit
 * dupliquer la formule de valorisation cote client — les deux etant
 * exactement ce que la regle d'architecture n°1 (CLAUDE.md §3) interdit.
 */
export type LotValorisable = Pick<
  LotStock,
  'statut' | 'quantiteRestante' | 'prixUnitaireCents' | 'dateDlc'
>;

function estActifVendable(
  lot: Pick<LotValorisable, 'statut' | 'quantiteRestante' | 'dateDlc'>,
  jourReference: string | undefined,
): boolean {
  if (lot.statut === 'detruit' || lot.quantiteRestante <= 0) return false;
  if (jourReference !== undefined && estPerime(lot.dateDlc, jourReference)) return false;
  return true;
}

/**
 * Valeur totale EXPLOITABLE du stock d'un ingredient, en centimes entiers.
 *
 * « Exploitable » veut dire : ce qu'on peut encore vendre. Voir
 * `estActifVendable` ci-dessus pour le detail des etats exclus (detruit,
 * perime) et de ceux deliberement conserves (quarantaine, bloque — piege
 * symetrique verifie par un test).
 *
 * DEFAUT CORRIGE (mission « un lot perime ne pese plus dans la valeur du
 * stock », 01/08/2026, docs/27-PARCOURS-REJOUE.md §3.b) : cette fonction
 * n'excluait avant que `statut === 'detruit'`, jamais la peremption — un lot
 * a 0 g disponible (`quantiteDisponible` l'excluait deja correctement) restait
 * pourtant compte plein tarif ici, parce que `quantiteRestante` (la quantite
 * PHYSIQUE encore en stock, perimee ou non) reste positive tant que personne
 * n'a sorti la matiere par un mouvement — et un lot perime n'est PAS sorti,
 * il est simplement invendable. Repere sur le cas reel : cafe moulu, 200 g
 * recus DLC deja depassee, 0 g disponible, 3,00 € comptes quand meme dans une
 * valeur totale de 82,12 €.
 *
 * `jourReference` est OPTIONNEL, et c'est le RESTE d'une migration, pas une
 * regle metier. Histoire de la decision, gardee parce qu'elle explique une
 * signature qui parait molle : le parametre a ete ajoute APRES coup, alors que
 * `etatDuStock` (`packages/db/src/depots/stock.ts`) appelait deja cette
 * fonction. Le rendre OBLIGATOIRE d'emblee aurait plante en PRODUCTION a la
 * premiere requete `GET /api/stock` sur le serveur reel du porteur
 * (`tsx watch` recharge a chaud des l'enregistrement, AVANT que l'appel ait pu
 * etre corrige) : `jourReference` aurait valu `undefined` a l'execution
 * (JavaScript n'impose aucune arite), et `estPerime(dateDlc, undefined)`
 * aurait leve dans `joursEntre`. Omis, il degrade PROPREMENT vers l'ancien
 * comportement (aucune exclusion par peremption) plutot que de planter.
 *
 * L'appel de `etatDuStock` passe desormais `jourReference`. L'option ne
 * subsiste donc que comme filet : si un appelant l'oublie, il retombe sur
 * l'ancienne valorisation au lieu de jeter. Le jour ou l'on voudra la rendre
 * obligatoire, il faudra verifier TOUS les appelants d'abord — c'est
 * exactement ce que cette migration a appris.
 */
export function valoriserStock(lots: readonly LotValorisable[], jourReference?: string): number {
  let valeurCents = 0;
  for (const lot of lots) {
    if (!estActifVendable(lot, jourReference)) continue;
    valeurCents += lot.quantiteRestante * lot.prixUnitaireCents;
  }
  return Math.round(valeurCents);
}

/**
 * Valeur de la matiere PERIMEE mais toujours PHYSIQUEMENT en stock — le
 * complement exact de `valoriserStock` ci-dessus : `valoriserStock(lots,
 * jourReference) + valoriserStockPerime(lots, jourReference)` reste egal a
 * l'ancienne valorisation totale (tout ce qui n'est pas detruit), pour tout
 * lot dont le `statut` administratif est `disponible`, `quarantaine` ou
 * `bloque` — la peremption ne fait que DEPLACER la valeur d'un total vers
 * l'autre, elle ne la fait jamais disparaitre (CLAUDE.md §7 : ne rien
 * minorer).
 *
 * `jourReference` est ICI OBLIGATOIRE, a la difference de `valoriserStock` :
 * aucun appelant existant n'invoque encore cette fonction (elle est neuve),
 * il n'y a donc aucun appel a menager a un seul argument, et une « valeur
 * perimee » sans date de reference n'aurait de toute facon aucun sens a
 * rendre par defaut (ni 0, qui masquerait la perte, ni le total entier, qui
 * la surevaluerait).
 *
 * Reste tel quel pour un lot `quarantaine` ou `bloque` PERIME : la peremption
 * l'emporte sur le statut administratif, elle rend la matiere invendable
 * quelle que soit la raison pour laquelle elle etait deja retiree de la FEFO.
 */
export function valoriserStockPerime(
  lots: readonly LotValorisable[],
  jourReference: string,
): number {
  let valeurCents = 0;
  for (const lot of lots) {
    if (lot.statut === 'detruit' || lot.quantiteRestante <= 0) continue;
    if (!estPerime(lot.dateDlc, jourReference)) continue;
    valeurCents += lot.quantiteRestante * lot.prixUnitaireCents;
  }
  return Math.round(valeurCents);
}

/** Quantite consommable maintenant : hors quarantaine, blocage, destruction et DLC. */
export function quantiteDisponible(lots: readonly LotStock[], jourReference: string): number {
  return lots
    .filter(
      (lot) =>
        lot.statut === 'disponible' &&
        lot.quantiteRestante > 0 &&
        !estPerime(lot.dateDlc, jourReference),
    )
    .reduce((total, lot) => total + lot.quantiteRestante, 0);
}

/**
 * Lots dont la DLC approche, tries du plus urgent au moins urgent.
 * Alimente l'alerte « DLC J-3 » du tableau de bord.
 */
export function lotsProchesDlc(
  lots: readonly LotStock[],
  jourReference: string,
  horizonJours: number,
): { lot: LotStock; joursRestants: number }[] {
  return ordonnerFefo(lots)
    .filter((lot) => lot.dateDlc !== null && lot.quantiteRestante > 0 && lot.statut !== 'detruit')
    .map((lot) => ({ lot, joursRestants: joursEntre(jourReference, lot.dateDlc!) }))
    .filter((entree) => entree.joursRestants <= horizonJours)
    .sort((a, b) => a.joursRestants - b.joursRestants);
}
