/**
 * Client Claude — le seul endroit du projet qui parle a l'API Anthropic.
 *
 * Trois regles structurent ce fichier, toutes issues de CLAUDE.md :
 *
 *  1. **La cle ne quitte jamais le serveur** (§2). Elle est lue depuis `.env`,
 *     n'est jamais renvoyee dans une reponse HTTP, et n'apparait dans aucun log.
 *  2. **Mode degrade complet** (§5). Sans cle, avec un plafond atteint, ou en
 *     cas de panne reseau, `demanderCommentaire` rend un refus MOTIVE — jamais
 *     une exception. L'application doit rester pleinement fonctionnelle sans
 *     aucun appel Claude.
 *  3. **Claude ne calcule jamais** (§3 regle 2). Les prompts d'ici demandent du
 *     TEXTE a propos de chiffres deja calcules ; aucun ne demande un nombre.
 *     Rien de ce que renvoie ce module n'entre en base sans validation humaine
 *     explicite.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  coutAppelCents,
  coutMaximalCents,
  detailEchecPourJournal,
  estimerTokens,
  familleModele,
  raisonEchecIa,
  tarifModele,
  verifierPlafond,
  type Parametres,
  type UsageIa,
} from '@batte/core';
import { depenseIaDuMois, journaliserAppelIa, type BaseBatte } from '@batte/db';

export type ReponseIa =
  | { readonly disponible: true; readonly texte: string; readonly coutCents: number }
  | { readonly disponible: false; readonly raison: string };

export type DemandeIa = {
  readonly usage: UsageIa;
  /** Cadre le role de Claude. Contient les interdits, pas les donnees. */
  readonly consigne: string;
  /** Les chiffres, deja calcules par le moteur deterministe. */
  readonly contenu: string;
};

/**
 * Client paresseux, cree au premier appel reussi.
 *
 * `null` signifie « pas de cle configuree », ce qui est un etat NORMAL du
 * produit et non une erreur de configuration : l'utilisateur peut tres bien
 * n'avoir jamais souscrit a l'API.
 */
let client: Anthropic | null = null;

function obtenirClient(): Anthropic | null {
  if (client !== null) return client;
  const cle = process.env['ANTHROPIC_API_KEY'];
  if (cle === undefined || cle.trim() === '') return null;
  client = new Anthropic({ apiKey: cle });
  return client;
}

/** L'assistance est-elle configurée ? Ne révèle jamais la clé, seulement sa présence. */
export function assistanceConfiguree(): boolean {
  return obtenirClient() !== null;
}

/** Mois civil belge courant, sous forme `{ annee, mois }`. */
function moisCourant(maintenant: Date): { annee: number; mois: number } {
  const belge = new Intl.DateTimeFormat('fr-BE', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(maintenant);

  const annee = Number(belge.find((p) => p.type === 'year')?.value ?? '0');
  const mois = Number(belge.find((p) => p.type === 'month')?.value ?? '0');
  return { annee, mois };
}

/**
 * Demande un commentaire a Claude.
 *
 * Ne leve JAMAIS. Toute panne devient un `{ disponible: false, raison }`
 * affichable tel quel : c'est ce qui permet a l'ecran appelant de dire
 * « commentaire indisponible » sans rien casser.
 */
export async function demanderCommentaire(
  base: BaseBatte,
  parametres: Parametres,
  demande: DemandeIa,
  maintenant: () => Date = () => new Date(),
): Promise<ReponseIa> {
  const anthropic = obtenirClient();
  if (anthropic === null) {
    return {
      disponible: false,
      raison:
        "L'assistance Claude n'est pas configurée. Renseignez ANTHROPIC_API_KEY dans " +
        "le fichier .env du poste pour l'activer. L'application fonctionne sans.",
    };
  }

  const famille = familleModele(demande.usage);
  const tarif = tarifModele(famille, parametres);
  const tokensSortieMax = parametres.entier('ia_tokens_sortie_max');

  // Controle du plafond AVANT l'appel : on ne peut pas revenir sur une depense
  // deja engagee.
  const { annee, mois } = moisCourant(maintenant());
  const decision = verifierPlafond(
    depenseIaDuMois(base, annee, mois),
    coutMaximalCents(
      estimerTokens(demande.consigne) + estimerTokens(demande.contenu),
      tokensSortieMax,
      tarif,
    ),
    parametres,
  );
  if (!decision.autorise) return { disponible: false, raison: decision.raison };

  const debut = maintenant().getTime();

  try {
    const reponse = await anthropic.messages.create({
      model: tarif.modele,
      max_tokens: tokensSortieMax,
      system: demande.consigne,
      messages: [{ role: 'user', content: demande.contenu }],
    });

    const texte = reponse.content
      .filter((bloc): bloc is Anthropic.TextBlock => bloc.type === 'text')
      .map((bloc) => bloc.text)
      .join('\n')
      .trim();

    const coutCents = coutAppelCents(
      reponse.usage.input_tokens,
      reponse.usage.output_tokens,
      tarif,
    );

    journaliserAppelIa(base, {
      usage: demande.usage,
      modele: tarif.modele,
      tokensEntree: reponse.usage.input_tokens,
      tokensSortie: reponse.usage.output_tokens,
      coutCents,
      dureeMs: maintenant().getTime() - debut,
      // Un commentaire n'alimente pas la base : pas de validation a demander.
      valideeParHumain: null,
    });

    if (texte === '') {
      return { disponible: false, raison: 'Claude a répondu sans contenu exploitable.' };
    }

    return { disponible: true, texte, coutCents };
  } catch (cause) {
    /*
     * Le message d'une exception du SDK n'est PAS ecrit par nous : il peut
     * porter une URL avec jeton, un en-tete d'autorisation ou l'arborescence du
     * poste. Il ne franchit donc jamais la frontiere HTTP tel quel.
     *
     *  - la RAISON affichee est deduite du seul statut HTTP (texte 100 % ecrit
     *    dans `packages/core`) ;
     *  - le JOURNAL conserve un extrait assaini et borne, pour qu'une panne
     *    recurrente reste diagnosticable sans etre un vidage de memoire.
     */
    const statut = statutHttpDe(cause);
    const detailBrut = cause instanceof Error ? cause.message : String(cause);

    // On journalise l'echec : un appel rate a pu consommer des tokens, et une
    // panne recurrente doit etre visible plutot que silencieuse.
    journaliserAppelIa(base, {
      usage: demande.usage,
      modele: tarif.modele,
      tokensEntree: 0,
      tokensSortie: 0,
      coutCents: 0,
      dureeMs: maintenant().getTime() - debut,
      valideeParHumain: null,
      erreur: detailEchecPourJournal(statut, detailBrut),
    });

    return { disponible: false, raison: raisonEchecIa(statut) };
  }
}

/**
 * Statut HTTP porte par une erreur du SDK Anthropic (`APIError.status`).
 *
 * `null` quand l'appel n'a jamais abouti — panne reseau, pare-feu, delai
 * depasse : il n'y a alors aucun statut a lire.
 */
function statutHttpDe(cause: unknown): number | null {
  if (typeof cause !== 'object' || cause === null) return null;
  const statut = (cause as { status?: unknown }).status;
  return typeof statut === 'number' && Number.isInteger(statut) ? statut : null;
}

/** Remet le client a zero. Reservé aux tests : une cle changee doit etre relue. */
export function reinitialiserClientIa(): void {
  client = null;
}
