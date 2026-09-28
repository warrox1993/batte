/**
 * Assistance Claude — la partie qui ne parle a personne (Lot 9).
 *
 * Tout ce qui est ici est DETERMINISTE : calcul du cout d'un appel, decision
 * d'autoriser ou non un appel au vu du plafond, classement des usages.
 * L'appel reseau lui-meme vit dans `apps/api/src/ia/`.
 *
 * Rappel de la regle la plus importante du projet (CLAUDE.md §3 regle 2) :
 * **un LLM ne calcule jamais**. Claude commente des chiffres deja produits par
 * le moteur deterministe, il n'en fabrique aucun. Ce fichier ne contient donc
 * aucun prompt qui demanderait un nombre.
 */

import type { Centimes } from './argent.js';
import type { Parametres } from './parametres.js';

/**
 * Les cinq usages tracés dans `journal_ia` (docs/02).
 *
 * `extraction` (lecture d'un bon de livraison) est RÉSERVÉ et NON IMPLÉMENTÉ :
 * aucune route n'écrit cet usage (docs/28-ORPHELINS-DERIVES.md §5). La valeur
 * reste déclarée parce qu'elle fait partie de l'énumération persistée de
 * `journal_ia.usage` ; la FAMILLE `extraction`, elle, est bien utilisée par la
 * découverte d'événements.
 */
export type UsageIa = 'prevision' | 'analyse_ecart' | 'extraction' | 'synthese' | 'evenements';

/**
 * Familles de modeles. Deux suffisent : le bon marche pour l'extraction
 * frequente, le capable pour les commentaires mensuels (CLAUDE.md §5).
 */
export type FamilleModele = 'extraction' | 'commentaire';

const FAMILLE_PAR_USAGE: Readonly<Record<UsageIa, FamilleModele>> = {
  extraction: 'extraction',
  evenements: 'extraction',
  prevision: 'commentaire',
  analyse_ecart: 'commentaire',
  synthese: 'commentaire',
};

export function familleModele(usage: UsageIa): FamilleModele {
  return FAMILLE_PAR_USAGE[usage];
}

/** Un million : les tarifs sont exprimes par million de tokens. */
const TOKENS_PAR_UNITE_TARIF = 1_000_000;

export type Tarif = {
  readonly modele: string;
  readonly entreeCentsParMtok: number;
  readonly sortieCentsParMtok: number;
};

/** Tarif en vigueur pour une famille de modeles. Tout vient de `parametre`. */
export function tarifModele(famille: FamilleModele, parametres: Parametres): Tarif {
  return famille === 'extraction'
    ? {
        modele: parametres.texte('ia_modele_extraction'),
        entreeCentsParMtok: parametres.entier('ia_tarif_extraction_entree_cents_par_mtok'),
        sortieCentsParMtok: parametres.entier('ia_tarif_extraction_sortie_cents_par_mtok'),
      }
    : {
        modele: parametres.texte('ia_modele_commentaire'),
        entreeCentsParMtok: parametres.entier('ia_tarif_commentaire_entree_cents_par_mtok'),
        sortieCentsParMtok: parametres.entier('ia_tarif_commentaire_sortie_cents_par_mtok'),
      };
}

/**
 * Cout d'un appel, en centimes.
 *
 * Arrondi au SUPERIEUR : un appel qui a reellement coute quelque chose ne doit
 * jamais etre compte pour zero. A ce volume, la plupart des appels coutent une
 * fraction de centime, et un arrondi au plus proche les rendrait tous gratuits
 * — le plafond mensuel ne serait alors jamais atteint et ne protegerait rien.
 */
export function coutAppelCents(tokensEntree: number, tokensSortie: number, tarif: Tarif): Centimes {
  const brut =
    (tokensEntree * tarif.entreeCentsParMtok + tokensSortie * tarif.sortieCentsParMtok) /
    TOKENS_PAR_UNITE_TARIF;
  return brut > 0 ? Math.max(1, Math.ceil(brut)) : 0;
}

/**
 * Cout maximal possible d'un appel, connu AVANT de le lancer.
 *
 * Sert a refuser un appel qui ferait franchir le plafond, plutot qu'a le
 * constater apres coup. On ne peut pas revenir sur une depense deja engagee.
 */
export function coutMaximalCents(
  tokensEntreeEstimes: number,
  tokensSortieMax: number,
  tarif: Tarif,
): Centimes {
  return coutAppelCents(tokensEntreeEstimes, tokensSortieMax, tarif);
}

/**
 * Cout des recherches web REELLEMENT executees par l'outil serveur
 * `web_search`, facture par Anthropic EN PLUS du cout des tokens (voir
 * `ia_tarif_recherche_web_cents_par_mille`, converti depuis 10 $ / 1000
 * recherches). N'est jamais une alternative a `coutAppelCents` : les deux
 * s'additionnent, exactement comme la facture Anthropic les additionne.
 *
 * Meme regle d'arrondi que `coutAppelCents` (D-030) : au SUPERIEUR, plancher a
 * 1 centime des que le nombre de recherches est non nul — une recherche
 * reellement facturee ne doit jamais etre comptee pour zero.
 */
export function coutRechercheWebCents(nbRecherches: number, parametres: Parametres): Centimes {
  const tarifCentsParMille = parametres.centimes('ia_tarif_recherche_web_cents_par_mille');
  const brut = (nbRecherches * tarifCentsParMille) / 1000;
  return brut > 0 ? Math.max(1, Math.ceil(brut)) : 0;
}

export type DecisionPlafond =
  | { readonly autorise: true; readonly resteCents: Centimes }
  | { readonly autorise: false; readonly raison: string };

/**
 * Autorise ou refuse un appel au vu du plafond mensuel.
 *
 * Le refus est une reponse NORMALE, pas une erreur : l'application continue,
 * elle affiche simplement que le commentaire n'est pas disponible ce mois-ci.
 * C'est le sens de « l'IA est un confort, jamais une dependance ».
 */
export function verifierPlafond(
  depenseDuMoisCents: Centimes,
  coutEstimeCents: Centimes,
  parametres: Parametres,
): DecisionPlafond {
  const plafond = parametres.centimes('plafond_ia_mensuel_cents');

  if (plafond <= 0) {
    return {
      autorise: false,
      raison:
        "L'assistance Claude est désactivée (plafond mensuel à 0 €). " +
        'Modifiez « plafond_ia_mensuel_cents » dans Paramètres pour l’activer.',
    };
  }

  if (depenseDuMoisCents + coutEstimeCents > plafond) {
    return {
      autorise: false,
      raison:
        `Plafond mensuel atteint : ${formaterCentimes(depenseDuMoisCents)} dépensés sur ` +
        `${formaterCentimes(plafond)}. Les commentaires reprendront le mois prochain, ` +
        'ou plus tôt si vous relevez le plafond dans Paramètres.',
    };
  }

  return { autorise: true, resteCents: plafond - depenseDuMoisCents - coutEstimeCents };
}

/** Montant lisible dans un message d'erreur. Volontairement local et minimal. */
function formaterCentimes(centimes: Centimes): string {
  return `${(centimes / 100).toFixed(2).replace('.', ',')} €`;
}

/**
 * Estimation grossiere du nombre de tokens d'un texte.
 *
 * Sert uniquement au controle de plafond AVANT l'appel ; le compteur reel vient
 * ensuite de la reponse de l'API. Environ 4 caracteres par token en francais —
 * on majore volontairement, parce qu'une sous-estimation ferait franchir le
 * plafond sans l'avoir vu venir.
 */
export function estimerTokens(texte: string): number {
  return Math.ceil(texte.length / 3);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Echecs d'appel : ce qu'on a le droit d'afficher et de conserver
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Longueur maximale d'un detail d'echec conserve dans `journal_ia.erreur`.
 *
 * Ce n'est pas une valeur metier (rien a parametrer) : c'est la borne au-dela
 * de laquelle un message de bibliotheque cesse d'aider au diagnostic et devient
 * un vidage de memoire dans une table lue par un ecran.
 */
const LONGUEUR_MAX_DETAIL_ECHEC = 200;

/**
 * Ce qu'on masque dans le message d'une exception AVANT de le conserver.
 *
 * Le message d'un echec d'appel HTTP n'est pas ecrit par nous : il vient du SDK,
 * de `fetch`, ou du systeme. Il peut donc contenir une URL avec jeton, un
 * en-tete d'autorisation, ou l'arborescence du poste. Or ce texte finit dans
 * `journal_ia.erreur`, que `GET /api/ia/journal` renvoie au navigateur : c'est
 * une frontiere de sortie, soumise a CLAUDE.md §2 et §7 au meme titre qu'une
 * reponse d'erreur.
 *
 * Liste de refus assumee : elle ne remplace pas la regle « aucun texte
 * tiers n'entre dans la RAISON affichee » (voir `raisonEchecIa`), elle ne
 * protege que la trace de diagnostic.
 */
const MOTIFS_A_MASQUER: readonly RegExp[] = [
  // Clé Anthropic, sous toutes ses formes.
  /sk-ant-[A-Za-z0-9_-]+/gi,
  // En-tetes d'autorisation et paires « cle = valeur » sensibles.
  /\bbearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:x-api-key|api[_-]?key|apikey|authorization|password|mot_de_passe|secret|token)\b\s*[:=]\s*\S+/gi,
  // Chemin absolu Windows (`C:\Users\...`) : revele le nom du compte du poste.
  /[A-Za-z]:[\\/][^\s"'`)]+/g,
  // Toute mention d'un chemin de dependance : deja interdite par le balayage
  // anti-fuite des tests d'integration.
  /\S*node_modules\S*/gi,
  // Chemin absolu POSIX ou chemin d'URL : peut porter un jeton en clair.
  /(?:\/[\w.@~-]+){2,}\/?/g,
];

/**
 * Rend un message d'exception presentable : sans secret, sans arborescence,
 * sans pile d'appel, et borne en longueur.
 *
 * Fonction PURE et exhaustivement testee, placee ici et non dans la couche HTTP
 * parce que c'est une regle du produit et non de la plomberie.
 */
export function assainirDetailIa(detailBrut: string): string {
  // Une pile d'appel Node commence par « \n    at fn (fichier:ligne) » : on la
  // coupe entierement plutot que de la masquer morceau par morceau.
  let texte = detailBrut.replace(/\n\s*at\s[^\n]*/g, ' ');

  for (const motif of MOTIFS_A_MASQUER) texte = texte.replace(motif, '[masqué]');

  texte = texte.replace(/\s+/g, ' ').trim();
  if (texte === '') return 'détail non exploitable';

  return texte.length <= LONGUEUR_MAX_DETAIL_ECHEC
    ? texte
    : `${texte.slice(0, LONGUEUR_MAX_DETAIL_ECHEC)}…`;
}

/**
 * Raison AFFICHABLE d'un echec d'appel, deduite du seul statut HTTP.
 *
 * Aucun texte venu de la bibliotheque n'y entre — c'est la difference avec
 * `assainirDetailIa`, qui, lui, assainit un texte tiers pour le journal. Une
 * liste de refus finit toujours par laisser passer quelque chose ; la reponse
 * HTTP, elle, ne contient donc QUE des phrases ecrites ici.
 *
 * `statut === null` signifie « aucun statut HTTP » : l'appel n'a jamais abouti
 * (DNS, pare-feu, delai depasse).
 */
export function raisonEchecIa(statut: number | null): string {
  const repli = ' La page reste utilisable sans commentaire.';

  if (statut === null) {
    return (
      "L'API Claude est injoignable depuis ce poste : vérifiez la connexion " +
      'internet ou le pare-feu.' +
      repli
    );
  }

  if (statut === 401 || statut === 403) {
    return (
      "L'API Claude a refusé la clé configurée. Vérifiez ANTHROPIC_API_KEY dans " +
      'le fichier .env du poste.' +
      repli
    );
  }

  if (statut === 429) {
    return (
      "L'API Claude a refusé l'appel pour cause de débit trop élevé. Réessayez " +
      'dans quelques minutes.' +
      repli
    );
  }

  if (statut >= 500) {
    return `L'API Claude est momentanément en panne (code ${statut}).${repli}`;
  }

  return `L'API Claude a refusé la requête (code ${statut}).${repli}`;
}

/**
 * Ligne de diagnostic conservee dans `journal_ia.erreur`.
 *
 * On garde le statut (chiffre ecrit par nous) ET un extrait assaini du message
 * d'origine : sans lui, une panne recurrente serait invisible, ce que CLAUDE.md
 * §4 interdit (« jamais de catch silencieux »).
 */
export function detailEchecPourJournal(statut: number | null, detailBrut: string): string {
  const assaini = assainirDetailIa(detailBrut);
  return statut === null ? `réseau — ${assaini}` : `HTTP ${statut} — ${assaini}`;
}
