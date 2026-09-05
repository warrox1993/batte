/**
 * Rentabilite d'une session de marche et compteurs de seuils legaux.
 *
 * Fonctions pures. C'est ici que se joue « le point ou l'argent, la matiere et
 * la prevision se rencontrent » (docs/01 module 4).
 */

import {
  BASE_POINTS,
  appliquerPointsDeBase,
  ratioEnPointsDeBase,
  repartir,
  type Centimes,
  type PointsDeBase,
} from './argent.js';
import type { ConsommationUnite, FacturationElectricite } from './contrats/referentiel.js';
import { coutEnergieSessionCents } from './energie.js';
import { ErreurMetier } from './erreurs.js';

/**
 * Nature d'une LIGNE DE VENTE. La distinction est STRUCTURANTE : a marge
 * egale, la revente genere ~2,6 fois plus de chiffre d'affaires que la crepe
 * — or les seuils legaux portent sur le CA, pas sur la marge (CLAUDE.md §6).
 *
 * VOLONTAIREMENT LIMITE A DEUX VALEURS, MEME DEPUIS QUE `produit_vente.nature`
 * EN PORTE UNE TROISIEME (`menu`, fiche 16 §2, migration 0023). Une ligne qui
 * atteint `totaliserVentes` — et donc les compteurs de seuils legaux — est
 * TOUJOURS l'une des deux natures VENDUES, jamais un menu : un menu n'y
 * arrive jamais tel quel, il est explose en ses composants AVANT
 * (`exploserVenteMenuEnLignesVente`, `packages/core/src/menus.ts`), et chaque
 * composant y arrive avec sa VRAIE nature. Elargir ce type a `'menu'` ferait
 * tomber une ligne de menu non explosee dans `caRevenduCents` (le `else` de
 * `totaliserVentes` ci-dessous), faussant silencieusement le compteur de
 * franchise TVA — exactement l'erreur que cette restriction protege.
 *
 * Le type COMPLET, conteneur de menu compris, est `NatureProduitVente`
 * (`packages/core/src/contrats/referentiel.ts`), derive du schema Zod qui
 * valide reellement la colonne. Les deux types divergent PAR CONSTRUCTION :
 * ne pas les fusionner.
 */
export type NatureProduit = 'transforme' | 'revendu';

export type LigneVente = {
  readonly produitVenteId: string;
  readonly nature: NatureProduit;
  readonly quantite: number;
  readonly prixUnitaireCents: Centimes;
  /** Nombre de crepes consommees par unite vendue. 0 pour un produit revendu. */
  readonly nbCrepesParUnite: number;
  /** Vrai si le produit est consomme sur place — alimente le seuil SCE. */
  readonly consommationSurPlace: boolean;
};

export type FraisSession = {
  readonly emplacementCents: Centimes;
  readonly deplacementCents: Centimes;
  readonly gazCents: Centimes;
  readonly diversCents: Centimes;
  /**
   * Coût d'électricité RETENU pour cette session (fiche 17 — voir
   * `resoudreCoutEnergieSession` plus bas), jamais saisi directement par
   * l'utilisateur, à la différence des quatre champs ci-dessus : calculé à la
   * clôture depuis les équipements utilisés, le mode de facturation
   * électrique du lieu et le prix du kWh (`packages/core/src/energie.ts`).
   *
   * TOUJOURS un entier connu, jamais `null` : un coût réel mais non
   * quantifiable est compté 0 PAR PRUDENCE (rien de plus à soustraire qu'on
   * connaisse) plutôt que de faire propager une inconnue dans toute la marge
   * de la session — `ResolutionCoutEnergieSession.raisonExclusion` porte la
   * distinction entre un zéro CERTAIN (aucune électricité sur ce lieu, ou
   * déjà comptée dans l'emplacement/le forfait) et un zéro par EXCLUSION
   * (donnée manquante), que ce champ seul ne peut pas exprimer.
   */
  readonly energieCents: Centimes;
};

/* ═══════════════════════════════════════════════════════════════════════════
   Électricité dans la marge de session (docs/demandes/17, D-055)
   ═══════════════════════════════════════════════════════════════════════════

   `coutEnergieSessionCents` (`packages/core/src/energie.ts`, à ne pas
   modifier) sait déjà distinguer les trois cas du lieu : pas d'électricité,
   déjà comptée (forfait/compris), ou facturée au compteur. Son `cents` vaut
   `null` dans les deux premiers cas ET quand le prix du kWh manque — TROIS
   raisons différentes derrière le même `null`.

   Ce qu'elle NE PEUT PAS savoir, parce que ça dépend de données qu'elle ne
   voit pas : une session dont AUCUNE durée d'équipement n'a jamais été
   enregistrée n'a pas fourni une liste vide qui prouve « rien n'a tourné » —
   elle peut tout aussi bien n'avoir simplement jamais été mesurée (toute
   session close avant l'existence de cette saisie, fiche 17, en est un cas
   permanent : `equipement_session` n'a alors AUCUNE ligne pour elle, pour
   toujours). Une liste vide et une liste jamais remplie sont IDENTIQUES en
   base — exactement la même ambiguïté que `relevesTemperature`
   (`contrats/sessions.ts`) : une absence reste une absence, jamais une valeur
   implicite. */

export type EntreeCoutEnergieSessionRetenu = {
  readonly equipementsUtilises: readonly {
    readonly puissanceW: number;
    readonly dureeMinutes: number;
  }[];
  /** `lieu_marche.facturation_electricite` de CETTE session. `null` = inconnu. */
  readonly facturationElectricite: FacturationElectricite | null;
  /** Prix du kWh en centimes, tel que lu dans `packages/core/src/parametres.ts`. `null` = non paramétré. */
  readonly prixKwhCentsParKwh: number | null;
};

export type ResolutionCoutEnergieSession = {
  /**
   * Montant à soustraire de la marge — TOUJOURS un entier connu. Voir
   * `FraisSession.energieCents` pour pourquoi une inconnue vaut 0 ici plutôt
   * que de se propager.
   */
  readonly montantCents: Centimes;
  /**
   * `null` quand `montantCents` est une valeur CERTAINE : un coût réellement
   * mesuré (compteur, prix connu, équipements renseignés), ou un ZÉRO CERTAIN
   * (aucune électricité sur ce lieu, ou déjà comptée dans l'emplacement/le
   * forfait — double comptage évité, docs/demandes/17 « le piège du prix du
   * kWh »). Sinon, explique pourquoi un coût qui pourrait être réel a été
   * compté 0 par prudence — jamais un silence sur pourquoi.
   */
  readonly raisonExclusion: string | null;
};

/**
 * Décide le montant d'électricité qui entre RÉELLEMENT dans la marge d'une
 * session — cas 3 SEUL de docs/demandes/17 (facturation au compteur), jamais
 * les cas 1 et 2 (aucune électricité, ou déjà comptée ailleurs).
 *
 * N'AJOUTE QU'UN SEUL GARDE-FOU à `coutEnergieSessionCents` (energie.ts), que
 * la fonction pure ne peut pas connaître : sur un lieu facturé AU COMPTEUR,
 * une liste d'équipements utilisés VIDE ne veut PAS dire « zéro kWh consommé »
 * — elle peut aussi bien vouloir dire « jamais mesuré » (voir l'en-tête
 * ci-dessus). Compter 0 sans le dire affirmerait à tort que la session n'a
 * rien consommé, ce qui embellirait sa marge. Ce garde-fou s'applique donc
 * AVANT toute autre logique, et rend le coût EXCLU (0, mais signalé) plutôt
 * que certain.
 *
 * Partout ailleurs, `cents === null` recouvre DEUX réalités que cette
 * fonction distingue explicitement : une ABSENCE CERTAINE (aucune électricité,
 * ou déjà comptée dans l'emplacement/le forfait — `raisonExclusion` reste
 * `null`, ce n'est pas un manque) et une VRAIE INCONNUE (mode ou prix non
 * paramétré — `raisonExclusion` porte alors le message de `energie.ts`).
 */
export function resoudreCoutEnergieSession(
  entree: EntreeCoutEnergieSessionRetenu,
): ResolutionCoutEnergieSession {
  if (entree.facturationElectricite === 'compteur' && entree.equipementsUtilises.length === 0) {
    return {
      montantCents: 0,
      raisonExclusion:
        "Aucune durée d'utilisation d'équipement électrique n'est enregistrée pour cette " +
        "session : impossible de distinguer « rien n'a été utilisé » de « pas encore mesuré » " +
        "(cas permanent des sessions closes avant l'existence de cette saisie, fiche 17). Le " +
        "coût d'électricité reste donc exclu de la marge (compté 0 par prudence), jamais " +
        'affirmé nul.',
    };
  }

  const resultat = coutEnergieSessionCents({
    equipementsUtilises: entree.equipementsUtilises,
    facturationElectricite: entree.facturationElectricite,
    prixKwhCentsParKwh: entree.prixKwhCentsParKwh,
  });

  if (resultat.cents !== null) {
    return { montantCents: resultat.cents, raisonExclusion: null };
  }

  // `cents === null` ici : soit une absence CERTAINE (aucune électricité, ou
  // déjà comptée dans l'emplacement/le forfait — jamais une inconnue), soit
  // une VRAIE inconnue (mode ou prix non paramétré). Les deux valent 0 dans
  // l'arithmétique de la marge — il n'y a rien de plus à soustraire qu'on
  // connaisse —, mais seule la seconde doit rester visible comme une
  // exclusion : la première est un fait acquis, pas un manque.
  const absenceCertaine =
    entree.facturationElectricite === 'aucune' ||
    entree.facturationElectricite === 'forfait' ||
    entree.facturationElectricite === 'comprise';

  return {
    montantCents: 0,
    raisonExclusion: absenceCertaine ? null : resultat.raisonIndisponible,
  };
}

export type ComptageCaisse = {
  /**
   * Monnaie emportee le matin. Ne fait PAS partie du chiffre d'affaires.
   * Toujours connue : elle a un vrai zero par defaut (« aucune monnaie
   * emportee » est une reponse legitime), jamais `null` — a la difference des
   * deux champs suivants, qui restent inconnus tant qu'ils n'ont pas ete
   * comptes.
   */
  readonly fondsCaisseInitialCents: Centimes;
  /**
   * Total des especes comptees au retour, fonds initial COMPRIS. `null` =
   * pas encore compte : un formulaire de cloture vierge ne dit RIEN sur la
   * caisse, il ne dit certainement pas qu'elle est a zero.
   */
  readonly especesCompteesCents: Centimes | null;
  /** Total encaisse par carte, releve SumUp. `null` = pas encore releve, meme raison que ci-dessus. */
  readonly caCarteCents: Centimes | null;
};

export type ProductionSession = {
  readonly crepesProduites: number;
  readonly crepesVendues: number;
  readonly crepesInvendues: number;
  readonly crepesCassees: number;
};

/* ═══════════════════════════════════════════════════════════════════════════
   Caisse
   ═══════════════════════════════════════════════════════════════════════════ */

export type ResultatCaisse = {
  /**
   * Especes reellement encaissees : comptees MOINS le fonds initial. `null`
   * tant que les especes comptees sont inconnues (voir `ComptageCaisse`).
   */
  readonly caEspecesCents: Centimes | null;
  /** `null` tant que le releve carte est inconnu. */
  readonly caCarteCents: Centimes | null;
  /** `null` si l'un des deux totaux ci-dessus est inconnu. */
  readonly caTotalEncaisseCents: Centimes | null;
  /**
   * Ecart entre l'encaisse et les ventes saisies. Positif = il y a plus en
   * caisse que de ventes enregistrees. `null` tant que la caisse n'est pas
   * entierement comptee — JAMAIS `0`, qui se lirait comme « caisse juste »
   * alors que rien n'a encore ete verifie (voir la doctrine sur `ComptageCaisse`
   * ci-dessus : un formulaire de cloture vierge ne doit jamais afficher un
   * ecart, encore moins un ecart negatif egal au CA du jour).
   */
  readonly ecartCaisseCents: Centimes | null;
};

/**
 * Rapprochement de caisse.
 *
 * `ca_especes` est **derive**, jamais saisi : c'est la correction de l'invariant
 * n°4 de docs/02, qui etait faux tel qu'ecrit. Partir avec 60 € de monnaie donne
 * « CA especes + 60 » au comptage — l'egalite ne tenait que si l'utilisateur
 * soustrayait le fonds de tete, c'est-a-dire faisait a la main le calcul que
 * l'application doit faire.
 *
 * L'INCONNU SE PROPAGE, IL NE DEVIENT JAMAIS ZERO. Un appelant qui remplacerait
 * une saisie vide par `0` AVANT d'appeler cette fonction (`especesCompteesCents
 * ?? 0`) obtiendrait un ecart de caisse EGAL A MOINS LE CA DU JOUR sur un
 * formulaire ou rien n'a encore ete tape — un chiffre rouge a cinq chiffres
 * avant meme la premiere frappe, sur l'ecran qu'on remplit a 23 h apres un
 * marche de six heures et demie. `especesCompteesCents` et `caCarteCents`
 * sont donc `Centimes | null` ici : `null` veut dire « pas encore compte », et
 * chaque total qui en depend (`caEspecesCents`, `caTotalEncaisseCents`,
 * `ecartCaisseCents`) reste `null` tant que l'information manque, plutot que de
 * calculer un ecart sur une hypothese jamais saisie.
 */
export function rapprocherCaisse(
  comptage: ComptageCaisse,
  caVentesCents: Centimes,
): ResultatCaisse {
  const caEspecesCents =
    comptage.especesCompteesCents === null
      ? null
      : comptage.especesCompteesCents - comptage.fondsCaisseInitialCents;
  const caTotalEncaisseCents =
    caEspecesCents === null || comptage.caCarteCents === null
      ? null
      : caEspecesCents + comptage.caCarteCents;
  return {
    caEspecesCents,
    caCarteCents: comptage.caCarteCents,
    caTotalEncaisseCents,
    ecartCaisseCents: caTotalEncaisseCents === null ? null : caTotalEncaisseCents - caVentesCents,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ventes et rentabilite
   ═══════════════════════════════════════════════════════════════════════════ */

export type TotauxVentes = {
  readonly caTotalCents: Centimes;
  /** Ventile transforme / revendu : indispensable aux compteurs de seuils. */
  readonly caTransformeCents: Centimes;
  readonly caRevenduCents: Centimes;
  /** CA des services de restauration, hors emporte. Alimente le seuil SCE. */
  readonly caSurPlaceCents: Centimes;
  /**
   * Nombre d'ARTICLES vendus, pas de tickets.
   *
   * Le champ s'appelait `nbTransactions` et servait de denominateur au « panier
   * moyen » — qui valait donc le prix moyen d'un ARTICLE, soit environ la
   * moitie du vrai panier des qu'un client prend deux articles. `session_vente`
   * agrege par produit et ne porte aucune notion de ticket : le vrai panier
   * exige une saisie, il ne se derive pas.
   */
  readonly nbArticlesVendus: number;
  readonly crepesVendues: number;
};

export function totaliserVentes(lignes: readonly LigneVente[]): TotauxVentes {
  let caTotalCents = 0;
  let caTransformeCents = 0;
  let caRevenduCents = 0;
  let caSurPlaceCents = 0;
  let nbArticlesVendus = 0;
  let crepesVendues = 0;

  for (const ligne of lignes) {
    const montant = ligne.quantite * ligne.prixUnitaireCents;
    caTotalCents += montant;
    if (ligne.nature === 'transforme') caTransformeCents += montant;
    else caRevenduCents += montant;
    if (ligne.consommationSurPlace) caSurPlaceCents += montant;
    nbArticlesVendus += ligne.quantite;
    crepesVendues += ligne.quantite * ligne.nbCrepesParUnite;
  }

  return {
    caTotalCents,
    caTransformeCents,
    caRevenduCents,
    caSurPlaceCents,
    nbArticlesVendus,
    crepesVendues,
  };
}

export type RentabiliteSession = {
  readonly caTotalCents: Centimes;
  readonly coutMatiereCents: Centimes;
  readonly commissionCarteCents: Centimes;
  readonly fraisTotauxCents: Centimes;
  readonly margeBruteCents: Centimes;
  readonly margeNetteCents: Centimes;
  /**
   * Vendu / produit. L'indicateur qui pilote la prevision suivante. `null`
   * quand rien n'a ete produit (une session qui ne vend QUE du revendu, par
   * exemple) : `ratioEnPointsDeBase` rend 0 sur un denominateur nul, ce qui
   * afficherait « 0 % d'ecoulement » — un invendu total — la ou la verite est
   * « aucune production, la question ne se pose pas ». Meme doctrine que
   * `panierMoyenCents` et `margeParHeureCents` : un denominateur inconnu rend
   * `null`, jamais un chiffre invente qui se lit comme une mesure.
   */
  readonly tauxEcoulementBp: PointsDeBase | null;
  /** `null` si la duree n'est pas connue : on n'invente pas un denominateur. */
  readonly margeParHeureCents: Centimes | null;
  /**
   * CA rapporte au nombre de TICKETS. `null` tant que les tickets ne sont pas
   * comptes — un panier moyen calcule sur des articles serait faux de moitie,
   * et un chiffre faux presente comme une mesure est pire que pas de chiffre.
   */
  readonly panierMoyenCents: Centimes | null;
  /** CA rapporte au nombre d'articles. Toujours calculable, jamais confondu
   *  avec le panier moyen. */
  readonly prixMoyenParArticleCents: Centimes | null;
  /**
   * Cout matiere du TRANSFORME (production + garnitures) rapporte aux crepes
   * VENDUES. Comparable aux 0,33-0,45 €/crepe de CLAUDE.md §6 — precisement
   * parce qu'il exclut le cout d'achat des marchandises REVENDUES (docs/17
   * fiche 12) : un pot de sirop revendu n'a rien a voir avec une crepe, le
   * melanger dans ce ratio le fait mentir.
   */
  readonly coutMatiereParCrepeCents: Centimes | null;
  /**
   * Cout COMPLET (matiere du transforme + frais + commission) rapporte aux
   * crepes VENDUES. Anciennement `coutRevientParCrepeCents`, qui divisait
   * aussi le cout d'achat des marchandises revendues par les crepes vendues —
   * un facteur ~2 sur la marge affichee des qu'il y avait de la revente
   * (docs/14 G12, docs/17 fiche 12). Le nom change avec le calcul.
   */
  readonly coutCompletParCrepeVendueCents: Centimes | null;
};

/**
 * Rentabilite complete d'une session.
 *
 * `marge nette par heure de presence` est « le seul chiffre qui dit vraiment si
 * la session valait le coup » (docs/01 module 4). Il rend `null` plutot que
 * zero quand la duree est inconnue : un denominateur invente donnerait un
 * chiffre faux presente comme une mesure.
 */
export function calculerRentabilite(entree: {
  totaux: TotauxVentes;
  /**
   * Cout matiere directement imputable au TRANSFORME : productions rattachees
   * + garnitures. C'est la seule base comparable au cout de revient documente
   * (CLAUDE.md §6) et la seule qui a un sens rapportee a une crepe.
   */
  coutMatiereTransformeCents: Centimes;
  /**
   * Cout d'achat des marchandises REVENDUES telles quelles (sirop, confiture…).
   * Entre dans la marge de la session, JAMAIS dans un ratio « par crepe » —
   * une crepe n'en consomme aucune (docs/17 fiche 12).
   */
  coutMarchandisesRevenduesCents: Centimes;
  /**
   * Cout d'achat des COMPOSANTS DE VENTE (fiche 15) : contenants, serviettes,
   * ingredients d'un cafe transforme a la demande. Panier DEDIE, distinct de
   * `coutMarchandisesRevenduesCents` : un composant n'est PAS un article
   * revendu tel quel (meme raisonnement que la garniture, D-053) — le
   * confondre avec le cout des marchandises revendues fausserait la lecture
   * de CETTE ligne le jour ou elle est affichee separement (marge de la
   * revente stricto sensu). Entre dans la marge de la session comme les deux
   * autres paniers, JAMAIS dans un ratio « par crepe » : un gobelet de cafe
   * n'en consomme aucune.
   */
  coutComposantsVenteCents: Centimes;
  /**
   * Part du cout REEL de production attribuee a la pate vendue TELLE QUELLE
   * (bouteille, pot — fiche 15 §5.1) plutot qu'a une crepe : PRELEVEE sur le
   * cout de production deja paye (`repartirCoutProductionEntrePateVendueEtCrepes`
   * ci-dessous), JAMAIS RECREEE — une production a deja sorti la farine, le
   * lait et les oeufs du stock une seule fois ; ce panier ne fait que
   * DEPLACER une part de ce cout deja compte, il ne le compte pas une
   * deuxieme fois.
   *
   * Panier DEDIE, distinct de `coutMatiereTransformeCents` : une bouteille de
   * pate ne consomme aucune crepe, la melanger au panier « transforme »
   * gonflerait `coutMatiereParCrepeCents`/`coutCompletParCrepeVendueCents`
   * d'un cout qui n'appartient pas aux crepes vendues. Entre dans la marge de
   * la session comme les trois autres paniers, JAMAIS dans un ratio « par
   * crepe ». Optionnel, defaut 0 : la tres grande majorite des sessions n'en
   * vendent aucune (0 regression pour tout appelant qui l'omet).
   */
  coutPateVendueDirectementCents?: Centimes;
  frais: FraisSession;
  caCarteCents: Centimes;
  tauxCommissionCarteBp: PointsDeBase;
  production: ProductionSession;
  dureeMinutes: number | null;
  /** Tickets encaisses, quand ils ont ete comptes. Seule source du panier moyen. */
  nbTickets?: number | null;
}): RentabiliteSession {
  const {
    totaux,
    coutMatiereTransformeCents,
    coutMarchandisesRevenduesCents,
    coutComposantsVenteCents,
    frais,
    production,
  } = entree;
  const coutPateVendueDirectementCents = entree.coutPateVendueDirectementCents ?? 0;
  // Cout matiere TOTAL de la session (transforme + revendu + composants de
  // vente + pate vendue directement) : c'est la seule grandeur pertinente
  // pour la marge, qui ne distingue pas d'ou vient le CA.
  const coutMatiereCents =
    coutMatiereTransformeCents +
    coutMarchandisesRevenduesCents +
    coutComposantsVenteCents +
    coutPateVendueDirectementCents;

  const commissionCarteCents = appliquerPointsDeBase(
    entree.caCarteCents,
    entree.tauxCommissionCarteBp,
  );
  const fraisTotauxCents =
    frais.emplacementCents +
    frais.deplacementCents +
    frais.gazCents +
    frais.diversCents +
    frais.energieCents;

  const margeBruteCents = totaux.caTotalCents - coutMatiereCents;
  const margeNetteCents = margeBruteCents - fraisTotauxCents - commissionCarteCents;

  const dureeHeures =
    entree.dureeMinutes === null || entree.dureeMinutes <= 0 ? null : entree.dureeMinutes / 60;

  return {
    caTotalCents: totaux.caTotalCents,
    coutMatiereCents,
    commissionCarteCents,
    fraisTotauxCents,
    margeBruteCents,
    margeNetteCents,
    tauxEcoulementBp:
      production.crepesProduites === 0
        ? null
        : ratioEnPointsDeBase(production.crepesVendues, production.crepesProduites),
    margeParHeureCents: dureeHeures === null ? null : Math.round(margeNetteCents / dureeHeures),
    panierMoyenCents:
      entree.nbTickets === undefined || entree.nbTickets === null || entree.nbTickets <= 0
        ? null
        : Math.round(totaux.caTotalCents / entree.nbTickets),
    prixMoyenParArticleCents:
      totaux.nbArticlesVendus === 0
        ? null
        : Math.round(totaux.caTotalCents / totaux.nbArticlesVendus),
    coutMatiereParCrepeCents:
      production.crepesVendues === 0
        ? null
        : Math.round(coutMatiereTransformeCents / production.crepesVendues),
    // Cout COMPLET (matiere du TRANSFORME + frais + commission), ramene au
    // volume reellement VENDU (docs/01 module 7). Sur les crepes vendues et
    // non produites : le cout des invendues est supporte par celles qu'on
    // vend. La matiere REVENDUE en est exclue (docs/17 fiche 12) : elle entre
    // dans la marge, jamais dans un ratio par crepe.
    coutCompletParCrepeVendueCents:
      production.crepesVendues === 0
        ? null
        : Math.round(
            (coutMatiereTransformeCents + fraisTotauxCents + commissionCarteCents) /
              production.crepesVendues,
          ),
  };
}

/**
 * Vrai si du TRANSFORME a ete vendu (`caTransformeCents > 0`) alors qu'AUCUNE
 * source de cout n'a ete consultee pour lui — ni une production, ni une
 * garniture (`coutMatiereTransformeCents === 0`), ni la nomenclature de VENTE
 * d'un transforme A LA DEMANDE (`coutComposantsVenteCents === 0`, fiche 15) —
 * la marge brute affichee vaut alors 100 % de ce CA, sans qu'aucun champ de
 * `ResultatCloture` (`packages/db/src/services/sessions.ts`) ne le signale
 * (defaut trouve en audit, 30/07/2026). C'est le trou SYMETRIQUE de celui deja
 * corrige cote revendu/garnitures/composants : la-bas, un stock insuffisant
 * se signale deja par `EcartStockVente` ; ici, une production simplement
 * ABSENTE (mode « crepes produites saisies a la main », aucune production
 * rattachee) ou une recette vide/jamais activee ne se signalait nulle part.
 *
 * LE SEUIL DE DECLENCHEMENT, ET POURQUOI CE N'EST PAS UN POURCENTAGE : deux
 * cas se ressemblent en surface (les deux affichent 0 centime de cout
 * transforme) et n'ont RIEN a voir.
 *  - Session qui n'a vendu QUE du revendu -> `caTransformeCents === 0`. Un
 *    cout transforme nul y est alors LA VERITE (aucune crepe vendue,
 *    rien a retrancher) : cette fonction rend `false`, JAMAIS un avertissement
 *    ici. Un avertissement qui se declenche dans ce cas (le cas le plus
 *    frequent d'un stand qui ne vend parfois QUE du terroir) serait ignore au
 *    bout de trois clotures, et ne servirait plus jamais dans le second cas.
 *  - Du transforme a ete vendu MAIS AUCUNE des deux sources de cout n'a rien
 *    retenu -> `caTransformeCents > 0` ET `coutMatiereTransformeCents === 0`
 *    ET `coutComposantsVenteCents === 0` : c'est l'anomalie exacte de cette
 *    mission (typiquement une crepe sans production rattachee), et cette
 *    fonction rend `true`.
 *
 * TROISIEME PANIER, AJOUTE PAR CETTE MISSION : `coutComposantsVenteCents`
 * (fiche 15, `sortirLesComposantsVente` / `calculerRentabilite` ci-dessus).
 * Un produit transforme peut etre A LA DEMANDE plutot que PAR LOT — le cafe
 * est l'exemple type : il ne se produit jamais en fournee, sa composition
 * (cafe moulu, eau, gobelet...) vient ENTIEREMENT de sa nomenclature de VENTE.
 * Son cout matiere existe donc bel et bien, simplement retenu dans un AUTRE
 * panier que `coutMatiereTransformeCents` (qui ne compte que production +
 * garnitures) — voir la doc de `coutComposantsVenteCents` sur
 * `calculerRentabilite` pour pourquoi ce panier reste separe (il n'a aucun
 * sens rapporte a UNE crepe, un gobelet n'en consomme aucune). Sans ce
 * troisieme panier, une session qui ne vend QUE ce type de produit afficherait
 * `coutMatiereTransformeCents === 0` avec un CA transforme positif, et
 * l'avertissement crierait a chaque cloture alors qu'aucun chiffre n'est faux
 * — exactement le risque que cette fonction existe pour eviter (voir
 * l'argument du seuil relatif ci-dessous : un avertissement qui ment une fois
 * sur trois cesse d'etre lu avant le jour ou il dit vrai).
 *
 * AUCUNE EXCEPTION NOMMEE ICI : cette fonction ne connait ni le cafe ni aucun
 * produit en particulier. Elle ne fait qu'etendre le meme principe aux DEUX
 * paniers qui portent un cout matiere transforme reel — la distinction qui
 * compte est entre « aucune source consultee » (les deux paniers a zero) et
 * « le cout est dans un autre panier » (l'un des deux est non nul), jamais un
 * nom de produit.
 *
 * STRICTEMENT `=== 0` SUR LES DEUX PANIERS, jamais un seuil relatif (« moins
 * de X % du CA de transforme ») : un cout PARTIELLEMENT retenu — un seul
 * centime, dans L'UN OU L'AUTRE panier — prouve qu'au moins une source de
 * cout (une production, une garniture, ou une nomenclature de vente) a bien
 * ete consultee. Ce n'est plus alors le silence total que ce defaut decrit,
 * c'est un chiffre qui peut se discuter au cas par cas (une garniture
 * manquante, un ecart de FEFO) — et ces cas-la sont deja portes par
 * `EcartStockVente`. Un seuil relatif inventerait une marge d'erreur que rien
 * ne justifie et NE PROTEGE PAS mieux : le defaut decrit dans cette mission
 * est un cout TOTALEMENT absent, pas un cout sous-estime.
 *
 * `caTransformeCents` (une grandeur MONETAIRE deja calculee par
 * `totaliserVentes`, menu explose compris) est le bon signal, plutot qu'un
 * comptage de crepes : il reste positif pour un produit transforme qui ne
 * produit aucune crepe (« pate vendue au volume », `nbCrepes = 0`, ou un
 * transforme a la demande comme le cafe), et un composant de menu ventile en
 * transforme y contribue deja correctement (`exploserVenteMenuEnLignesVente`
 * lui a deja donne sa vraie nature avant que `totaliserVentes` ne tourne) —
 * sans introduire une deuxieme facon de compter la meme chose que celle qui
 * alimente deja les compteurs de seuils legaux (CLAUDE.md §6).
 */
export function coutMatiereTransformeSuspect(entree: {
  readonly caTransformeCents: Centimes;
  readonly coutMatiereTransformeCents: Centimes;
  /**
   * Cout d'achat des composants de nomenclature de VENTE (fiche 15,
   * `sortirLesComposantsVente` / panier `coutComposantsVenteCents` de
   * `calculerRentabilite` ci-dessus) — TOTAL de la SESSION, tous produits
   * confondus (transforme, revendu, menu explose). C'est un panier de session,
   * pas un panier par produit : une session qui vend a la fois un transforme
   * A LA DEMANDE correctement costee et un transforme PAR LOT sans aucune
   * production ne serait donc PAS signalee par cette fonction, puisque ce
   * panier serait non nul globalement. Limite assumee — voir le rapport de
   * livraison de cette mission — plutot qu'une precision par produit que rien
   * dans le modele actuel (agrege par session) ne permet de calculer sans
   * deplacer un montant, ce que cette mission interdit.
   */
  readonly coutComposantsVenteCents: Centimes;
  /**
   * QUATRIEME PANIER (fiche 15 §5.1, mission « la pate vendue au volume
   * n'est jamais deduite du stock ») : cout de la pate vendue DIRECTEMENT au
   * volume (bouteille, pot), prelevee sur le cout de production —
   * `coutPateVendueDirectementCents` de `calculerRentabilite` ci-dessus. Une
   * session qui ne vend QUE de la pate en bouteille (aucune crepe) verrait
   * `coutMatiereTransformeCents` a zero — LA VERITE, aucune crepe n'a ete
   * cuite — alors que son vrai cout matiere est retenu ICI, dans ce panier.
   * Sans lui, cette fonction confondrait ce cas legitime avec le defaut
   * qu'elle traque (defaut symetrique a celui deja corrige pour le cafe,
   * `coutComposantsVenteCents`).
   *
   * Optionnel, defaut 0 : un appelant qui ne vend jamais de pate au volume
   * peut l'omettre sans changer le comportement (0 regression).
   */
  readonly coutPateVendueDirectementCents?: Centimes;
}): boolean {
  return (
    entree.caTransformeCents > 0 &&
    entree.coutMatiereTransformeCents === 0 &&
    entree.coutComposantsVenteCents === 0 &&
    (entree.coutPateVendueDirectementCents ?? 0) === 0
  );
}

/**
 * Coherence entre production et ecoulement.
 *
 * `produites == vendues + invendues + cassees` doit toujours tenir. Rend
 * l'ecart plutot que de lever : l'ecran affiche l'incoherence en direct pendant
 * la saisie, il ne bloque pas au moment de valider.
 */
export function ecartProduction(production: ProductionSession): number {
  return (
    production.crepesProduites -
    (production.crepesVendues + production.crepesInvendues + production.crepesCassees)
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Resolution des crepes produites depuis un volume de pate MESURE

   Deuxieme facon de cloturer, au choix avec la saisie directe d'un nombre de
   crepes (demande du porteur : « le choix manuel entre nombre de crepes
   vendues et quantite en ml ou g vendu et restant »). Il regarde son bac, il
   mesure ce qu'il reste, l'application deduit ce qui a ete produit — c'est
   exactement la ressaisie que CLAUDE.md §0 interdit d'imposer quand
   l'application peut calculer.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Une production rattachee, reduite a ce qu'il faut pour deriver des crepes
 * depuis un volume mesure.
 *
 * Le REEL prime sur le THEORIQUE des qu'il est connu (meme regle que la
 * resolution par saisie explicite, cote depot) : c'est l'appelant qui doit
 * choisir `volumeReelMl ?? volumeTheoriqueMl` et `crepesReelles ??
 * crepesTheoriques` avant d'appeler cette fonction.
 */
export type ProductionPourVolumeRestant = {
  readonly volumeProduitMl: number;
  readonly crepesProduites: number;
};

export type ResolutionCrepesParVolume = {
  readonly crepesProduites: number;
  /** Somme des volumes des productions rattachees (reel si connu). */
  readonly volumeProduitMl: number;
  readonly volumeRestantMl: number;
  /** Volume total disparu du bac : cuit en crepes ET vendu tel quel (fiche 15 §5.1). */
  readonly volumeConsommeMl: number;
  /**
   * Part de `volumeConsommeMl` vendue DIRECTEMENT en pate (bouteille, pot),
   * retranchee AVANT la conversion en crepes. `0` sur une session qui ne vend
   * aucune pate telle quelle — jamais autre chose qu'une somme de quantites
   * entieres deja connues, donc jamais `null` ici (voir `estPateVendueAuVolume`
   * et `volumePateVendueDirectementMl` ci-dessous).
   */
  readonly volumePateVendueMl: number;
};

/**
 * Un produit de vente qui vend LA PATE elle-meme, telle quelle (une bouteille,
 * un pot) — et non une crepe qui en est CUITE (fiche 15 §5.1).
 *
 * LE PROBLEME : la cloture au volume (D-057) deduit les crepes produites du
 * volume disparu du bac. Si deux litres partent en bouteille, ils quittent le
 * bac SANS devenir des crepes — le calcul les compterait pourtant comme des
 * crepes produites, surestimant la production.
 *
 * L'IDENTIFICATION, PAR LE CHAMP QUI LA NOMME (decision du porteur du
 * 31/07/2026, fiche 15 §4/§5.1) : `nature === 'transforme'` ET
 * `consommationUnite === 'volume_pate'`. AVANT cette decision, l'identification
 * se deduisait de `recetteId !== null && nbCrepes === 0` — et c'etait FAUX
 * pour un transforme A LA DEMANDE (le cafe, fiche 15 §4), qui partage la meme
 * valeur `nbCrepes = 0` (« cette unite ne produit aucune crepe ») pour une
 * raison DIFFERENTE (sa composition vit dans la nomenclature de vente, jamais
 * dans une recette de production). Cette fonction rendait donc VRAI pour un
 * cafe des qu'on lui rattachait une recette — meme vide — pour satisfaire
 * `verifierCoherenceProduit` : exactement le defaut que `consommationUnite`
 * corrige, en NOMMANT le cas plutot qu'en le deduisant.
 *
 * CE QUE CETTE FONCTION NE RESOUT TOUJOURS PAS : le volume en ml represente
 * par UNE unite vendue. Voir `volumePateVendueDirectementMl` ci-dessous, dont
 * la contribution reste `0` tant qu'aucune source de volume par unite n'est
 * lue par l'appelant (limite documentee, jamais silencieuse — meme famille
 * que la densite de pate manquante, D-057).
 */
export function estPateVendueAuVolume(produit: {
  readonly nature: NatureProduit;
  readonly consommationUnite: ConsommationUnite | null;
}): boolean {
  return produit.nature === 'transforme' && produit.consommationUnite === 'volume_pate';
}

/** Une ligne de vente, reduite a ce qu'il faut pour en tirer un volume de pate vendue. */
export type LigneVentePourVolumePate = {
  readonly quantite: number;
  readonly estPateVendueAuVolume: boolean;
  /**
   * Volume en ml represente par UNE unite vendue de ce produit. `null` =
   * inconnu (aucun champ du modele ne le porte encore, voir
   * `estPateVendueAuVolume` ci-dessus) : la ligne est alors IGNOREE plutot que
   * comptee pour 0 ml, pour ne jamais confondre « pas de pate vendue » et
   * « volume inconnu ». Tant qu'aucune source n'existe, cette fonction rend
   * donc toujours 0 sur des ventes de pate reelles — limite assumee et
   * documentee, pas une correction silencieuse.
   */
  readonly volumeMlParUnite: number | null;
};

/**
 * Volume total de pate vendue DIRECTEMENT (bouteille, pot) sur une session,
 * a retrancher du volume consomme AVANT d'en deduire des crepes.
 *
 * Chaque terme est un PRODUIT DE DEUX ENTIERS (quantite vendue x volume par
 * unite) : la somme est donc elle-meme un entier exact, sans aucun arrondi a
 * faire ici — a la difference de `cumulerComposantsVendus`, qui doit proteger
 * des quantites FRACTIONNAIRES (piege de la cannelle). Rien de tel ici, les
 * deux facteurs sont deja entiers.
 */
export function volumePateVendueDirectementMl(lignes: readonly LigneVentePourVolumePate[]): number {
  let total = 0;
  for (const ligne of lignes) {
    if (!ligne.estPateVendueAuVolume || ligne.volumeMlParUnite === null) continue;
    total += ligne.quantite * ligne.volumeMlParUnite;
  }
  return total;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cout de la pate vendue DIRECTEMENT au volume (fiche 15 §5.1, mission
   « la pate vendue au volume n'est jamais deduite du stock »)

   LE PIEGE A NE PAS REPRODUIRE, et pourquoi cette fonction ne RE-CALCULE
   rien : une production a deja sorti farine, lait et oeufs du stock UNE
   SEULE FOIS, au prix REEL des lots consommes (FEFO), et son cout total
   (`coutProductionsCents`) est deja connu de la session qui l'a rattachee.
   Vendre une part de cette pate telle quelle (bouteille) au lieu de la cuire
   ne fait sortir AUCUN ingredient supplementaire du stock : c'est le MEME
   cout deja paye qui doit simplement etre PARTAGE entre deux destinations
   (des crepes, une bouteille), jamais un cout recalcule depuis la recette
   (qui redonnerait un ingredient une deuxieme fois) ni une seconde sortie de
   stock (qui redonnerait le meme mouvement une deuxieme fois).
   ═══════════════════════════════════════════════════════════════════════════ */

export type RepartitionCoutProductionSession = {
  /**
   * Part du cout de production PRELEVEE pour la pate vendue directement
   * (bouteille, pot). `0` des qu'aucune pate n'a ete vendue au volume cette
   * session — le cas le plus frequent, et le seul avant cette mission.
   */
  readonly coutPateVendueDirectementCents: Centimes;
  /**
   * Ce qui RESTE du cout de production une fois la part ci-dessus prelevee —
   * c'est CE chiffre, et seulement lui, qui doit alimenter
   * `coutMatiereTransformeCents` (`calculerRentabilite` ci-dessus) et les
   * ratios « par crepe » : la pate mise en bouteille n'a cuit aucune crepe,
   * son cout n'a donc rien a faire dans un ratio qui divise par des crepes
   * vendues.
   */
  readonly coutMatiereTransformeRestantCents: Centimes;
};

/**
 * Partage `coutProductionsCents` (cout REEL, deja connu, deja paye) entre la
 * pate qui a cuit des crepes et celle vendue directement au volume — AU
 * PRORATA DES VOLUMES, jamais recalcule depuis la recette (voir l'en-tete
 * ci-dessus).
 *
 * UN SEUL ARRONDI, A LA FIN, ET LA DERNIERE PART SE DERIVE PAR SOUSTRACTION
 * (`repartir`, `packages/core/src/argent.ts`) : c'est la SEULE facon que les
 * deux parts retombent exactement sur `coutProductionsCents`, centime pres —
 * arrondir chaque part independamment ferait deriver la somme (CLAUDE.md §3
 * regle 3). La part CREPES est la part DERIVEE (dernier poids de `repartir`) :
 * c'est elle qui portait 100 % du cout avant cette mission, elle continue
 * donc de porter « le reste », la pate en bouteille ne faisant que PRELEVER
 * sa propre part dessus.
 *
 * `volumePateVendueDirectementMl === 0` (le cas de la tres grande majorite
 * des sessions) rend `{ coutPateVendueDirectementCents: 0,
 * coutMatiereTransformeRestantCents: coutProductionsCents }` SANS appeler
 * `repartir` : zero regression, bit a bit, pour toute session qui ne vend
 * aucune pate au volume.
 *
 * DEUX IMPOSSIBILITES PHYSIQUES refusees, meme doctrine que
 * `resoudreCrepesDepuisVolumeRestant` (une mesure incoherente n'est pas une
 * faute de frappe a corriger en silence, c'est une saisie qui ne peut pas
 * correspondre au reel) :
 *  - de la pate est vendue au volume alors qu'AUCUNE production n'est
 *    rattachee a la session (`volumeProduitMl <= 0`) : il n'existe alors
 *    aucun cout a partager, ni aucune tracabilite AFSCA vers un lot de pate
 *    produit (CLAUDE.md §3 regle 6) ;
 *  - le volume vendu au volume DEPASSE le volume total produit rattache a la
 *    session : on ne peut pas vendre plus de pate qu'il n'en a ete produit.
 */
export function repartirCoutProductionEntrePateVendueEtCrepes(entree: {
  readonly coutProductionsCents: Centimes;
  /** Somme des volumes (reel si connu, sinon theorique) des productions rattachees a la session. */
  readonly volumeProduitMl: number;
  readonly volumePateVendueDirectementMl: number;
}): RepartitionCoutProductionSession {
  if (entree.volumePateVendueDirectementMl === 0) {
    return {
      coutPateVendueDirectementCents: 0,
      coutMatiereTransformeRestantCents: entree.coutProductionsCents,
    };
  }

  if (entree.volumeProduitMl <= 0) {
    throw new ErreurMetier(
      'volume_pate_vendue_sans_production',
      'De la pâte a été vendue directement (au volume) cette session, mais aucune production ' +
        "n'y est rattachée : impossible d'établir son coût matière, ni son lot d'origine pour " +
        'la traçabilité. Rattachez la production correspondante.',
    );
  }

  if (entree.volumePateVendueDirectementMl > entree.volumeProduitMl) {
    throw new ErreurMetier(
      'volume_pate_vendue_superieur_au_produit',
      `Le volume de pâte vendue directement (${entree.volumePateVendueDirectementMl} ml) ` +
        `dépasse le volume produit rattaché à cette session (${entree.volumeProduitMl} ml) : ` +
        'vérifiez les ventes ou la production.',
    );
  }

  // `repartir` garantit deux parts, dans l'ordre des poids fournis : l'acces
  // par indice est donc sur (meme convention que `menus.ts::repartirPrixMenu`
  // et que `repartir` elle-meme, qui indexe ses propres poids avec `!`),
  // jamais un cast.
  const parts = repartir(entree.coutProductionsCents, [
    entree.volumePateVendueDirectementMl,
    entree.volumeProduitMl - entree.volumePateVendueDirectementMl,
  ]);

  return {
    coutPateVendueDirectementCents: parts[0]!,
    coutMatiereTransformeRestantCents: parts[1]!,
  };
}

/**
 * Derive le nombre de crepes produites depuis une MESURE du volume de pate
 * restant dans le bac, plutot que de le redemander (CLAUDE.md §0).
 *
 * Le ratio crepes/volume utilise est celui des productions RATTACHEES
 * elles-memes (agrege sur toutes, ponderees par leur volume), pas le
 * rendement brut de la recette : c'est le ratio EXACT de la fournee mise en
 * oeuvre pour cette session, pertes de cuisson et perte fixe deja comprises.
 * Sur une session a une seule production sans perte declaree, ce ratio
 * coincide avec le rendement de reference de la recette (CLAUDE.md §6 : R1,
 * 455 ml pour 6 crepes, soit ≈ 76 ml/crepe).
 *
 * Ne REFUSE JAMAIS un ecart avec vendues + invendues + cassees : un volume
 * mesure n'est pas une faute de frappe a corriger, c'est une INFORMATION —
 * une louche plus genereuse, une pate plus epaisse que prevu. C'est a
 * l'appelant d'afficher cet ecart (`ecartProduction`), jamais de le refuser
 * ici. Seule une impossibilite PHYSIQUE — plus de pate restante que de pate
 * produite, ou plus de pate vendue directement que de pate consommee — est
 * refusee : ce n'est pas un ecart de mesure, c'est une saisie qui ne peut pas
 * correspondre au reel.
 *
 * `volumePateVendueMl` (fiche 15 §5.1) : la pate vendue TELLE QUELLE quitte le
 * bac SANS devenir des crepes. La retrancher AVANT la conversion est ce qui
 * empeche une bouteille vendue de se transformer en fausses crepes produites.
 */
export function resoudreCrepesDepuisVolumeRestant(
  productions: readonly ProductionPourVolumeRestant[],
  volumeRestantMl: number,
  volumePateVendueMl = 0,
): ResolutionCrepesParVolume {
  const volumeProduitMl = productions.reduce((total, p) => total + p.volumeProduitMl, 0);
  const crepesProduitesTotal = productions.reduce((total, p) => total + p.crepesProduites, 0);

  if (volumeProduitMl <= 0) {
    throw new ErreurMetier(
      'volume_production_inconnu',
      "Aucune production avec un volume connu n'est rattachée à cette session : impossible de " +
        'déduire les crêpes produites depuis un volume restant. Rattachez la production ' +
        'correspondante, ou déclarez directement le nombre de crêpes produites.',
    );
  }
  if (volumeRestantMl < 0 || volumeRestantMl > volumeProduitMl) {
    throw new ErreurMetier(
      'volume_restant_incoherent',
      `Le volume restant déclaré (${volumeRestantMl} ml) ne peut pas dépasser le volume ` +
        `produit rattaché à cette session (${volumeProduitMl} ml) : vérifiez la mesure.`,
      { champs: { volumeRestantSaisi: `Ne peut pas dépasser ${volumeProduitMl} ml produits.` } },
    );
  }

  const volumeConsommeMl = volumeProduitMl - volumeRestantMl;

  if (volumePateVendueMl < 0 || volumePateVendueMl > volumeConsommeMl) {
    throw new ErreurMetier(
      'volume_pate_vendue_incoherent',
      `Le volume de pâte vendue directement (${volumePateVendueMl} ml) ne peut pas dépasser le ` +
        `volume disparu du bac (${volumeConsommeMl} ml) : vérifiez la mesure.`,
      {
        champs: {
          volumePateVendueMl: `Ne peut pas dépasser ${volumeConsommeMl} ml consommés.`,
        },
      },
    );
  }

  const volumeConsommePourCrepesMl = volumeConsommeMl - volumePateVendueMl;
  return {
    crepesProduites: Math.round(
      (volumeConsommePourCrepesMl * crepesProduitesTotal) / volumeProduitMl,
    ),
    volumeProduitMl,
    volumeRestantMl,
    volumeConsommeMl,
    volumePateVendueMl,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Seuils legaux
   ═══════════════════════════════════════════════════════════════════════════ */

export type CompteurSeuil = {
  readonly cle: string;
  readonly libelle: string;
  readonly realiseCents: Centimes;
  readonly plafondCents: Centimes;
  readonly partBp: PointsDeBase;
  /**
   * Projection de fin d'annee au rythme observe. `null` si l'historique est
   * trop court pour projeter — un pourcentage instantane ne permet aucune
   * decision, mais une projection inventee serait pire (docs/07 §6.8 rang 16).
   */
  readonly projectionFinAnneeCents: Centimes | null;
};

/**
 * Trajectoire vers un seuil legal.
 *
 * Projette au rythme des sessions deja tenues : « au rythme des 8 dernieres
 * sessions, vous terminerez l'annee a 22 400 € ». Un pourcentage instantane
 * (« 17 % ») ne permet aucune decision ; une projection en permet une.
 */
export function projeterSeuil(entree: {
  cle: string;
  libelle: string;
  realiseCents: Centimes;
  plafondCents: Centimes;
  sessionsTenues: number;
  sessionsPrevuesDansLAnnee: number;
}): CompteurSeuil {
  const partBp =
    entree.plafondCents <= 0 ? 0 : ratioEnPointsDeBase(entree.realiseCents, entree.plafondCents);

  // Il faut au moins deux sessions pour parler de « rythme » : une seule
  // session ne dit rien de la suite.
  const projection =
    entree.sessionsTenues < 2 || entree.sessionsPrevuesDansLAnnee <= 0
      ? null
      : Math.round(
          (entree.realiseCents / entree.sessionsTenues) * entree.sessionsPrevuesDansLAnnee,
        );

  return {
    cle: entree.cle,
    libelle: entree.libelle,
    realiseCents: entree.realiseCents,
    plafondCents: entree.plafondCents,
    partBp,
    projectionFinAnneeCents: projection,
  };
}

/** Vrai si la projection franchit le plafond — l'alerte qui compte vraiment. */
export function depassementProjete(compteur: CompteurSeuil): boolean {
  return (
    compteur.projectionFinAnneeCents !== null &&
    compteur.projectionFinAnneeCents >= compteur.plafondCents
  );
}

/** Part du CA venant de la revente, en points de base. */
export function partRevenduBp(totaux: TotauxVentes): PointsDeBase {
  return totaux.caTotalCents === 0
    ? 0
    : Math.round((totaux.caRevenduCents / totaux.caTotalCents) * BASE_POINTS);
}
