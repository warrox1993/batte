/**
 * Les usages concrets de Claude dans l'application (Lot 9).
 *
 * Chaque consigne repete la meme interdiction, et ce n'est pas une redondance :
 * c'est la garantie qu'aucun chiffre invente ne franchisse la frontiere. Claude
 * COMMENTE des chiffres deja calcules par le moteur deterministe ; il n'en
 * produit aucun (CLAUDE.md §3 regle 2).
 *
 * Les consignes vivent ici, separees du client, pour qu'on puisse les relire
 * sans lire de la plomberie HTTP — c'est le contenu le plus sensible du lot.
 */

import { formaterEuros, type Prevision } from '@batte/core';
import type { DemandeIa } from './client.js';

/**
 * Socle commun a toutes les consignes.
 *
 * L'interdiction de produire un chiffre est repetee dans chaque consigne parce
 * qu'un modele suit mieux une regle enoncee dans son propre contexte qu'une
 * regle heritee d'ailleurs.
 */
const SOCLE =
  'Tu assistes une micro-entreprise belge qui vend des crêpes sur le marché de La Batte, à Liège. ' +
  'Deux personnes, un stand, un marché par semaine.\n\n' +
  'RÈGLES ABSOLUES :\n' +
  '- Tu ne produis JAMAIS de chiffre. Aucun nombre de ta réponse ne doit être calculé par toi. ' +
  'Tu peux citer les chiffres qu’on te donne, jamais en dériver de nouveaux.\n' +
  "- Si une question demande un calcul, dis que le calcul appartient à l'application et " +
  'commente ce qui t’est fourni.\n' +
  '- Tu écris en français, à la deuxième personne du pluriel, sans jargon.\n' +
  '- Tu es bref : quelques phrases, jamais une dissertation.\n' +
  "- Tu ne t'excuses pas et tu ne te présentes pas.";

/**
 * Commentaire d'une prevision.
 *
 * La recommandation de production paraitra souvent trop haute : le role de
 * Claude est de la rendre acceptable, pas de la corriger.
 */
export function commentaireDePrevision(prevision: Prevision): DemandeIa {
  const meteo = prevision.meteo.disponible
    ? `${prevision.meteo.explication} (facteur ×${(prevision.meteo.facteurBp / 10000).toFixed(2)})`
    : `indisponible — ${prevision.meteo.raison}`;

  const evenements =
    prevision.evenements.length === 0 ? 'aucun' : prevision.evenements.map((e) => e.nom).join(', ');

  return {
    usage: 'prevision',
    consigne:
      `${SOCLE}\n\n` +
      'On te donne une prévision de production déjà calculée. Commente-la en trois points : ' +
      'ce qui la rend prudente ou risquée, ce à quoi il faut faire attention le jour même, ' +
      "et ce qui pourrait la faire dévier. Ne recommande pas d'autre quantité que celle donnée.",
    contenu: [
      `Session : ${prevision.session?.lieuNom ?? 'lieu inconnu'} le ${prevision.session?.dateSession ?? '?'}.`,
      `Base historique : ${prevision.baseline.baselineCrepes} crêpes (${prevision.baseline.explication}).`,
      `Météo : ${meteo}.`,
      `Événements : ${evenements}.`,
      `Demande attendue : médiane ${prevision.p50} crêpes, fourchette ${prevision.p10} à ${prevision.p90}.`,
      `Quantité à produire retenue : ${prevision.crepesRetenues} crêpes.`,
      prevision.contrainteLimitante === null
        ? 'Aucune contrainte ne limite la production.'
        : `Contrainte limitante : ${prevision.contrainteLimitante}.`,
      /*
       * Les deux couts ne sont annonces QUE s'ils sont reellement connus.
       *
       * Defaut trouve le 01/08/2026, en corrigeant le meme mensonge a l'ecran :
       * ces deux montants valent `0` quand la matiere n'est pas chiffrable
       * (aucune production, ou aucune recette dont tous les ingredients ont un
       * conditionnement au prix connu). Les envoyer tels quels faisait
       * commenter la prevision par un modele CONVAINCU QU'UN INVENDU NE COUTE
       * RIEN — donc porte a juger la quantite retenue trop prudente, avec
       * l'assurance d'un chiffre.
       *
       * C'est le mensonge « inconnu affiche comme zero » adresse a un lecteur
       * qui, lui, ne peut pas aller verifier. CLAUDE.md §3 regle 2 dit que
       * Claude COMMENTE les chiffres : encore faut-il ne pas lui en fournir de
       * faux. Dire « inconnu » le laisse en tenir compte ; dire « 0,00 € » le
       * trompe en silence.
       */
      `Coût d'une rupture : ${
        prevision.couts.prixMoyenConnu && prevision.couts.coutInvenduConnu
          ? `${formaterEuros(prevision.couts.coutRuptureCents)} de marge perdue`
          : 'INCONNU (coût matière non chiffrable) — ne le traite pas comme nul'
      }. ` +
        `Coût d'un invendu : ${
          prevision.couts.coutInvenduConnu
            ? formaterEuros(prevision.couts.coutInvenduCents)
            : 'INCONNU (coût matière non chiffrable) — ne le traite pas comme nul'
        }.`,
      `Confiance du modèle : ${Math.round(prevision.confianceBp / 100)} % sur ` +
        `${prevision.nbSessionsComparables} session(s) comparable(s).`,
    ].join('\n'),
  };
}

export type EcartSession = {
  readonly numero: string;
  readonly dateSession: string;
  readonly crepesProduites: number;
  readonly crepesVendues: number;
  readonly crepesInvendues: number;
  /**
   * `null` UNIQUEMENT quand la session n'est pas encore clôturée (ces trois
   * colonnes ne sont écrites qu'à la clôture, `services/sessions.ts`) — jamais
   * un `0` de repli. L'appelant (`routes/ia.ts`) refuse déjà d'appeler cette
   * fonction pour une session non close ; ce type reste `| null` ici plutôt
   * que de faire confiance à cette garantie depuis un autre fichier — c'est le
   * défaut trouvé le 30/07/2026 : un `?? 0` faisait passer « pas encore
   * calculé » pour « chiffre d'affaires nul », ce qui aurait fait dire à
   * Claude qu'un marché sans aucune vente encore saisie affichait un « écart
   * de caisse de 0 € », soit exactement l'inverse d'un signal d'alerte.
   */
  readonly caTotalCents: number | null;
  readonly margeNetteCents: number | null;
  readonly ecartCaisseCents: number | null;
  readonly prevuCrepes: number | null;
  readonly notesQualitatives: string | null;
};

/**
 * Analyse d'un ecart entre le prevu et le realise.
 *
 * Le but n'est pas de justifier l'ecart, c'est de proposer des HYPOTHESES que
 * l'utilisateur pourra confirmer ou rejeter la fois suivante.
 */
export function analyseEcart(session: EcartSession): DemandeIa {
  return {
    usage: 'analyse_ecart',
    consigne:
      `${SOCLE}\n\n` +
      "On te donne le bilan d'une session de marché. Propose deux ou trois HYPOTHÈSES " +
      "expliquant l'écart entre ce qui était prévu et ce qui s'est passé, et pour chacune, " +
      "dis ce qu'il faudrait observer au prochain marché pour la confirmer ou l'écarter. " +
      'Formule-les comme des hypothèses, pas comme des conclusions.',
    contenu: [
      `Session ${session.numero} du ${session.dateSession}.`,
      session.prevuCrepes === null
        ? 'Aucune prévision archivée pour cette session.'
        : `Prévu : ${session.prevuCrepes} crêpes.`,
      `Produit : ${session.crepesProduites}. Vendu : ${session.crepesVendues}. ` +
        `Invendu : ${session.crepesInvendues}.`,
      session.caTotalCents === null || session.margeNetteCents === null
        ? "Chiffre d'affaires et marge nette : pas encore calculés (session pas encore clôturée)."
        : `Chiffre d'affaires : ${formaterEuros(session.caTotalCents)}. ` +
          `Marge nette : ${formaterEuros(session.margeNetteCents)}.`,
      session.ecartCaisseCents === null
        ? 'Écart de caisse : pas encore calculé (session pas encore clôturée).'
        : `Écart de caisse : ${formaterEuros(session.ecartCaisseCents)}.`,
      session.notesQualitatives === null
        ? 'Aucune note du jour.'
        : `Notes du jour : ${session.notesQualitatives}`,
    ].join('\n'),
  };
}

/**
 * Brief avant-marche.
 *
 * Le texte qu'on relit le samedi soir. Il ne remplace aucun ecran : il resume
 * ce que les ecrans disent deja.
 */
export function briefAvantMarche(entree: {
  readonly prevision: Prevision;
  readonly alertesStock: readonly string[];
  readonly alertesDlc: readonly string[];
}): DemandeIa {
  return {
    usage: 'synthese',
    consigne:
      `${SOCLE}\n\n` +
      "Rédige un court brief à relire la veille du marché : ce qu'il y a à faire, " +
      "dans l'ordre, et les deux ou trois points de vigilance. Pas de liste à puces " +
      'de plus de six lignes. Ne réinvente rien : tout est dans les données fournies.',
    contenu: [
      `Session : ${entree.prevision.session?.lieuNom ?? '?'} le ` +
        `${entree.prevision.session?.dateSession ?? '?'}.`,
      `À produire : ${entree.prevision.crepesRetenues} crêpes.`,
      entree.prevision.meteo.disponible
        ? `Météo annoncée : ${entree.prevision.meteo.explication}` +
          `${entree.prevision.meteo.ventFort ? ', vent fort' : ''}.`
        : 'Météo indisponible.',
      entree.alertesStock.length === 0
        ? 'Stock : rien sous le seuil.'
        : `Stock sous le seuil : ${entree.alertesStock.join(', ')}.`,
      entree.alertesDlc.length === 0
        ? 'DLC : rien à surveiller.'
        : `Lots proches de la DLC : ${entree.alertesDlc.join(', ')}.`,
    ].join('\n'),
  };
}
