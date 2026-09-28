/**
 * Routes `/api/evenements-decouverte/*` (fiche
 * `docs/demandes/05-EVENEMENTS-DECOUVERTE-IA-RAYON-REGLABLE.md`).
 *
 * ═══ Déclenchement MANUEL, pas de tâche planifiée ═══
 *
 * La fiche demande une « tâche planifiée hebdomadaire ». Ce projet n'a AUCUN
 * ordonnanceur (aucune dépendance de type cron, aucun processus d'arrière-
 * plan) : en ajouter un pour cette seule fiche serait la première pièce d'une
 * infrastructure que rien d'autre n'utilise. À la place : un bouton
 * « Chercher des événements » par lieu (`POST .../lieux/:lieuId/rechercher`),
 * cohérent avec CLAUDE.md §5 (« l'IA est un confort, jamais une dépendance »)
 * et immédiatement utilisable. Voir le rapport de livraison.
 *
 * ═══ La recherche web est une INTERFACE remplaçable ═══
 *
 * `SourcePropositionsEvenements` est le point d'injection : ce fichier fournit
 * une implémentation par défaut (`rechercherEvenementsParClaude`, SDK
 * `@anthropic-ai/sdk`, outil serveur `web_search_20250305`), mais toute autre
 * source de propositions peut lui être substituée (tests, ou un futur
 * fournisseur de recherche différent) sans toucher aux routes.
 *
 * ═══ Import relatif temporaire — cross-package ═══
 *
 * `packages/core/src/contrats/evenements-decouverte.ts` et
 * `packages/db/src/depots/evenements-decouverte.ts` sont des fichiers NEUFS,
 * hors des barrels `@batte/core` / `@batte/db` (câblage réservé à
 * l'orchestrateur — voir le rapport de livraison pour les lignes exactes).
 * Les imports ci-dessous passent donc par un chemin relatif direct, même
 * convention que `apps/api/src/routes/concurrents.ts` (fiche 08) avant son
 * câblage.
 *
 * ═══ Duplication assumée avec `apps/api/src/ia/client.ts` — PAS un TODO ═══
 *
 * `client.ts` se décrit comme « le seul endroit du projet qui parle à l'API
 * Anthropic », et ce fichier en ouvre un second — DÉLIBÉRÉMENT, pas par oubli.
 * `demanderCommentaire` (`ia/client.ts`) fait un SEUL appel, texte libre, sans
 * outil serveur. Cette route a besoin de tout autre chose : une relance
 * MULTI-TOURS après `pause_turn` (l'outil `web_search` peut interrompre le
 * tour côté serveur), avec REVÉRIFICATION du plafond mensuel AVANT CHAQUE
 * tour — recherche web comprise, facturée séparément des tokens par Anthropic
 * (voir la boucle de `rechercherEvenementsParClaude` ci-dessous). Un audit du
 * 30/07/2026 a confirmé ce comportement correct, y compris à la limite
 * (plafond franchi APRÈS qu'un premier tour a déjà eu lieu), au moyen d'un
 * serveur HTTP local bouchonnant l'API Anthropic — jamais un appel réel
 * facturé.
 *
 * FUSIONNER SANS PREUVE SERAIT PLUS RISQUÉ QUE LA DUPLICATION : replier cette
 * boucle dans `client.ts` obligerait `demanderCommentaire` (~4 appels/mois,
 * un simple commentaire de prévision) à porter une logique de relance et un
 * compteur de recherches web dont il n'a aucun besoin — ou ferait de
 * `ia/client.ts` un fichier à deux formes, le genre de branchement où un cas
 * mal testé d'un usage finit par percer dans l'autre. Tant qu'une fusion n'a
 * pas été VÉRIFIÉE conserver EXACTEMENT ce comportement de plafond (revérifi-
 * cation par tour comprise), la duplication reste le moindre mal — elle
 * n'est PAS laissée à fusionner « si souhaité », elle est un choix. Seuls
 * deux petits extracteurs sans état (statut HTTP, mois civil belge) et la
 * construction du client Anthropic sont dupliqués ; tout ce qui est
 * déterministe et réutilisable (calcul de coût, vérification du plafond,
 * tarif du modèle, assainissement des messages d'erreur) reste IMPORTÉ de
 * `@batte/core` / `@batte/db`, jamais réécrit.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { FastifyPluginAsync } from 'fastify';
import {
  coutAppelCents,
  coutMaximalCents,
  coutRechercheWebCents,
  detailEchecPourJournal,
  estimerTokens,
  ErreurIntrouvable,
  familleModele,
  jourCivilBelge,
  raisonEchecIa,
  tarifModele,
  verifierPlafond,
  type Parametres,
} from '@batte/core';
import { depenseIaDuMois, journaliserAppelIa, lireParametres, type BaseBatte } from '@batte/db';
import {
  schemaDemandeRecherche,
  schemaListeLieuxPourRechercheEvenements,
  schemaListePropositionsEvenements,
  schemaPropositionEvenement,
  schemaPropositionsEvenementsIaBrutes,
  schemaReglageRayonRecherche,
  schemaResultatRechercheEvenements,
  schemaValidationProposition,
  type PropositionEvenementIaBrute,
} from '@batte/core';
import { trierParRentabiliteDecroissante } from '@batte/core';
import {
  creerPropositionEvenementIa,
  lieuPourRechercheEvenements,
  listerLieuxPourRechercheEvenements,
  listerPropositionsEnAttente,
  nombrePropositionsEnAttente,
  reglerRayonRechercheEvenements,
  rejeterPropositionEvenement,
  validerPropositionEvenement,
} from '@batte/db';
import { LIMITE_APPEL_EXTERNE } from '../plugins/limitation-debit.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Source de propositions — interface remplaçable
   ═══════════════════════════════════════════════════════════════════════════ */

export type DemandeRechercheIa = {
  readonly lieuNom: string;
  readonly rayonKm: number;
};

export type ResultatBrutRechercheIa =
  | {
      readonly disponible: true;
      readonly propositions: readonly PropositionEvenementIaBrute[];
      readonly coutCents: number;
    }
  | { readonly disponible: false; readonly raison: string };

/**
 * Point d'injection : n'importe quelle fonction de cette forme peut
 * remplacer `rechercherEvenementsParClaude` (tests, ou un futur fournisseur).
 */
export type SourcePropositionsEvenements = (
  base: BaseBatte,
  parametres: Parametres,
  demande: DemandeRechercheIa,
) => Promise<ResultatBrutRechercheIa>;

/* ═══════════════════════════════════════════════════════════════════════════
   Implémentation par défaut — Claude + recherche web serveur
   ═══════════════════════════════════════════════════════════════════════════ */

/** Nombre de reprises après `pause_turn` (limite serveur de tours de recherche). */
const NB_TOURS_MAX = 3;
/** Recherches web autorisées PAR APPEL : borne le coût d'une recherche qui dérape. */
const MAX_USAGES_RECHERCHE_WEB = 5;

function construireConsigneRecherche(
  lieuNom: string,
  rayonKm: number,
  dateReference: string,
): string {
  return [
    `Tu assistes une micro-entreprise belge qui vend des crêpes en ambulant, sur le marché de ` +
      `« ${lieuNom} ». Cherche, en utilisant l'outil de recherche web mis à ta disposition, des ` +
      `événements RÉELS susceptibles de modifier la fréquentation de ce marché, dans un rayon de ` +
      `${rayonKm} km autour de « ${lieuNom} », à partir du ${dateReference} et dans les deux à ` +
      `trois prochains mois.`,
    '',
    'RÈGLES ABSOLUES :',
    '- Cherche RÉELLEMENT sur le web avant de répondre. N’invente aucun événement : si tu ne ' +
      'trouves rien de sourcé, réponds par un tableau vide.',
    '- Types pertinents : festivals, braderies, brocantes, matchs à domicile, travaux de voirie ' +
      'annoncés, jours fériés locaux, grèves annoncées, tout événement qui ferme ou gêne le marché.',
    '- Indique une intensité (1 à 5) et une portée (« quartier », « liege » ou « national ») : ce ' +
      'sont des ESTIMATIONS INITIALES que l’utilisateur pourra ajuster avant validation, jamais un ' +
      'calcul final.',
    '- Tu ne calcules AUCUN impact chiffré, AUCUNE rentabilité, AUCUN facteur de prévision : ce ' +
      'calcul appartient entièrement à l’application, jamais à toi.',
    '- Indique une distance approximative à vol d’oiseau (jamais un temps de trajet ni une ' +
      'distance routière), en kilomètres.',
    '- Cite systématiquement une source (URL ou description précise de la page trouvée).',
    '- Termine ta réponse par un UNIQUE bloc de code JSON, sans aucun texte après ce bloc, ' +
      'contenant un tableau (vide si rien trouvé) au format suivant :',
    '  [{"nom": string, "type": "festival"|"ferie"|"sportif"|"meteo_exceptionnelle"|"greve"|' +
      '"travaux"|"concurrence"|"autre", "dateDebut": "AAAA-MM-JJ", "dateFin": "AAAA-MM-JJ", ' +
      '"communeTexte": string, "distanceEstimeeKm": number, "portee": "quartier"|"liege"|' +
      '"national", "intensiteEstimee": number, "source": string, "resume": string}]',
  ].join('\n');
}

/**
 * Client Anthropic dédié à cette route. Duplication assumée de
 * `obtenirClient` (`ia/client.ts`, non exporté, hors zone d'écriture) — voir
 * l'en-tête de ce fichier.
 */
function clientAnthropicPourRecherche(): Anthropic | null {
  const cle = process.env['ANTHROPIC_API_KEY'];
  if (cle === undefined || cle.trim() === '') return null;
  return new Anthropic({ apiKey: cle });
}

/** Mois civil belge courant — même calcul que `ia/client.ts` (dupliqué, non exporté). */
function moisCourantBelge(maintenant: Date): { annee: number; mois: number } {
  const belge = new Intl.DateTimeFormat('fr-BE', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(maintenant);
  const annee = Number(belge.find((p) => p.type === 'year')?.value ?? '0');
  const mois = Number(belge.find((p) => p.type === 'month')?.value ?? '0');
  return { annee, mois };
}

/** Statut HTTP porté par une erreur du SDK Anthropic — dupliqué de `ia/client.ts`. */
function statutHttpDe(cause: unknown): number | null {
  if (typeof cause !== 'object' || cause === null) return null;
  const statut = (cause as { status?: unknown }).status;
  return typeof statut === 'number' && Number.isInteger(statut) ? statut : null;
}

/**
 * Extrait un tableau JSON de la réponse texte de Claude : un bloc de code
 * ```json … ``` s'il existe, sinon le texte entier. `null` si rien
 * d'analysable comme JSON — jamais une exception qui remonterait à l'appelant.
 */
function extraireTableauJson(texte: string): unknown[] | null {
  const blocJson = /```json\s*([\s\S]*?)```/i.exec(texte) ?? /```\s*([\s\S]*?)```/.exec(texte);
  const candidat = (blocJson?.[1] ?? texte).trim();
  if (candidat === '') return null;
  try {
    const analyse: unknown = JSON.parse(candidat);
    return Array.isArray(analyse) ? analyse : null;
  } catch {
    return null;
  }
}

/**
 * Implémentation par défaut de `SourcePropositionsEvenements` : Claude, avec
 * l'outil serveur `web_search_20250305` (compatible avec le modèle
 * d'extraction configuré, y compris Haiku — la variante `_20260209` exige un
 * modèle plus récent). Ne lève JAMAIS : toute panne devient
 * `{ disponible: false, raison }`, exactement comme `demanderCommentaire`.
 */
export async function rechercherEvenementsParClaude(
  base: BaseBatte,
  parametres: Parametres,
  demande: DemandeRechercheIa,
  maintenant: () => Date = () => new Date(),
): Promise<ResultatBrutRechercheIa> {
  const anthropic = clientAnthropicPourRecherche();
  if (anthropic === null) {
    return {
      disponible: false,
      raison:
        "L'assistance Claude n'est pas configurée. Renseignez ANTHROPIC_API_KEY dans le fichier " +
        '.env du poste pour activer la recherche automatique. Vous pouvez toujours saisir un ' +
        'événement manuellement dans Événements.',
    };
  }

  const famille = familleModele('evenements');
  const tarif = tarifModele(famille, parametres);
  const tokensSortieMax = parametres.entier('ia_tokens_sortie_max');

  const dateReference = jourCivilBelge(maintenant());
  const consigne = construireConsigneRecherche(demande.lieuNom, demande.rayonKm, dateReference);
  const contenuInitial =
    `Cherche des événements pertinents autour de « ${demande.lieuNom} », dans un rayon de ` +
    `${demande.rayonKm} km, à partir d'aujourd'hui (${dateReference}).`;

  const { annee, mois } = moisCourantBelge(maintenant());
  const debut = maintenant().getTime();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: contenuInitial }];
  let tokensEntreeTotal = 0;
  let tokensSortieTotal = 0;
  /**
   * Nombre de recherches web RÉELLEMENT exécutées par l'outil serveur
   * `web_search`, cumulé tour après tour. Anthropic facture CE nombre
   * SÉPARÉMENT des tokens (`ia_tarif_recherche_web_cents_par_mille`) — sans ce
   * compteur, jusqu'à `MAX_USAGES_RECHERCHE_WEB × NB_TOURS_MAX` recherches
   * réellement facturées échapperaient à `journal_ia` et au plafond mensuel.
   */
  let nbRecherchesWebTotal = 0;
  let derniereReponse: Anthropic.Message | null = null;
  /**
   * Raison du refus quand le plafond coupe la relance APRÈS au moins un tour
   * déjà exécuté (voir le commentaire dans la boucle). `null` tant qu'aucun
   * tour n'a été bloqué de cette façon.
   */
  let raisonPlafondEnCoursDeRecherche: string | null = null;

  try {
    for (let tour = 0; tour < NB_TOURS_MAX; tour += 1) {
      /**
       * Plafond revérifié AVANT CHAQUE tour, pas seulement avant le premier.
       *
       * `pause_turn` (limite serveur de recherches par tour) fait relancer
       * jusqu'à `NB_TOURS_MAX` appels réseau supplémentaires, et CHACUN
       * rejoue toute la conversation (y compris les résultats de recherche
       * déjà trouvés, potentiellement volumineux) avant de pouvoir encore
       * coûter jusqu'à `tokensSortieMax` en sortie ET jusqu'à
       * `MAX_USAGES_RECHERCHE_WEB` recherches web supplémentaires — facturées
       * SÉPARÉMENT des tokens par Anthropic. Un contrôle fait une seule fois,
       * avant le premier appel, ne majore le coût que d'UN appel — jamais
       * celui d'une relance qui en enchaîne plusieurs : c'est un plafond
       * vérifié avant l'engagement de LA PREMIÈRE dépense, mais pas avant
       * celui des suivantes, ce que D-031 interdit précisément ailleurs. On
       * estime donc, à chaque tour, le coût maximal du PROCHAIN appel — tokens
       * ET recherches web confondus — sur la conversation TELLE QU'ELLE SERA
       * renvoyée (elle grossit à chaque relance), et on l'ajoute à ce qui a
       * déjà été RÉELLEMENT dépensé dans cette recherche, tokens ET
       * recherches web déjà exécutées (jamais une estimation, une fois les
       * chiffres réels connus).
       */
      const coutDejaEngageCents =
        coutAppelCents(tokensEntreeTotal, tokensSortieTotal, tarif) +
        coutRechercheWebCents(nbRecherchesWebTotal, parametres);
      const estimationProchainTourCents =
        coutMaximalCents(
          estimerTokens(consigne) + estimerTokens(JSON.stringify(messages)),
          tokensSortieMax,
          tarif,
        ) + coutRechercheWebCents(MAX_USAGES_RECHERCHE_WEB, parametres);
      const decisionTour = verifierPlafond(
        depenseIaDuMois(base, annee, mois) + coutDejaEngageCents,
        estimationProchainTourCents,
        parametres,
      );
      if (!decisionTour.autorise) {
        if (derniereReponse === null) {
          // Bloqué avant le moindre appel réseau : rien n'a été dépensé,
          // rien à journaliser (comportement inchangé pour ce cas).
          return { disponible: false, raison: decisionTour.raison };
        }
        // Un ou plusieurs tours ont déjà eu lieu : la relance est coupée ICI,
        // avant le prochain appel réseau, et ce qui a RÉELLEMENT été dépensé
        // (jamais une estimation) est journalisé plus bas, après la boucle.
        raisonPlafondEnCoursDeRecherche = decisionTour.raison;
        break;
      }

      const reponse = await anthropic.messages.create({
        model: tarif.modele,
        max_tokens: tokensSortieMax,
        system: consigne,
        messages,
        tools: [
          { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_USAGES_RECHERCHE_WEB },
        ],
      });

      tokensEntreeTotal += reponse.usage.input_tokens;
      tokensSortieTotal += reponse.usage.output_tokens;
      // Recherches web RÉELLEMENT exécutées ce tour, facturées séparément des
      // tokens par Anthropic (`usage.server_tool_use.web_search_requests`) —
      // `null` quand aucun outil serveur n'a été utilisé ce tour.
      nbRecherchesWebTotal += reponse.usage.server_tool_use?.web_search_requests ?? 0;
      derniereReponse = reponse;

      if (reponse.stop_reason !== 'pause_turn') break;
      // Tour serveur interrompu (limite de recherches par tour) : on renvoie
      // la conversation telle quelle pour que Claude reprenne où il en était
      // (shared/tool-use-concepts.md « pause_turn »), jamais un nouveau
      // message « continue ».
      messages.push({ role: 'assistant', content: reponse.content });
    }
  } catch (cause) {
    const statut = statutHttpDe(cause);
    const detailBrut = cause instanceof Error ? cause.message : String(cause);
    // Defaut trouve a l'audit du 01/08/2026 : ce bloc journalisait
    // `coutCents: 0` inconditionnellement, alors que `tokensEntreeTotal` /
    // `tokensSortieTotal` portent deja le total REELLEMENT accumule sur les
    // tours precedents (un premier tour reussi avant une panne au tour
    // suivant a reellement consomme des tokens facturables). Meme formule que
    // le chemin nominal plus bas : jamais un cout invente, jamais un cout
    // remis a zero quand on connait deja les tokens qui le determinent
    // (CLAUDE.md §3 — une valeur inconnue vaut `null`, jamais 0 ; ici la
    // valeur n'est meme pas inconnue).
    const coutDejaEngageCents =
      coutAppelCents(tokensEntreeTotal, tokensSortieTotal, tarif) +
      coutRechercheWebCents(nbRecherchesWebTotal, parametres);
    journaliserAppelIa(base, {
      usage: 'evenements',
      modele: tarif.modele,
      tokensEntree: tokensEntreeTotal,
      tokensSortie: tokensSortieTotal,
      coutCents: coutDejaEngageCents,
      dureeMs: maintenant().getTime() - debut,
      valideeParHumain: null,
      erreur: detailEchecPourJournal(statut, detailBrut),
    });
    return { disponible: false, raison: raisonEchecIa(statut) };
  }

  // Coût RÉEL final : tokens ET recherches web réellement exécutées,
  // additionnés — jamais l'un à la place de l'autre (Anthropic facture les
  // deux séparément). C'est ce montant qui est journalisé et qui alimente le
  // plafond mensuel du mois suivant.
  const coutCents =
    coutAppelCents(tokensEntreeTotal, tokensSortieTotal, tarif) +
    coutRechercheWebCents(nbRecherchesWebTotal, parametres);

  if (raisonPlafondEnCoursDeRecherche !== null) {
    // La relance a été coupée par le plafond APRÈS au moins un tour : on
    // journalise le coût RÉEL déjà engagé — un appel raté ou interrompu a
    // quand même coûté quelque chose, et un plafond qui ne compte pas cette
    // dépense-là ne plafonne rien la prochaine fois.
    journaliserAppelIa(base, {
      usage: 'evenements',
      modele: tarif.modele,
      tokensEntree: tokensEntreeTotal,
      tokensSortie: tokensSortieTotal,
      coutCents,
      dureeMs: maintenant().getTime() - debut,
      valideeParHumain: null,
      erreur:
        'recherche interrompue avant complétion : le plafond mensuel serait dépassé par la relance.',
    });
    return { disponible: false, raison: raisonPlafondEnCoursDeRecherche };
  }

  if (derniereReponse === null) {
    return { disponible: false, raison: "L'API Claude n'a produit aucune réponse exploitable." };
  }

  if (derniereReponse.stop_reason === 'refusal') {
    journaliserAppelIa(base, {
      usage: 'evenements',
      modele: tarif.modele,
      tokensEntree: tokensEntreeTotal,
      tokensSortie: tokensSortieTotal,
      coutCents,
      dureeMs: maintenant().getTime() - debut,
      valideeParHumain: null,
      erreur: 'requête refusée par les garde-fous de sécurité de Claude.',
    });
    return {
      disponible: false,
      raison:
        'Claude a refusé cette recherche. Réessayez plus tard, ou saisissez l’événement ' +
        'manuellement dans Événements.',
    };
  }

  const texte = derniereReponse.content
    .filter((bloc): bloc is Anthropic.TextBlock => bloc.type === 'text')
    .map((bloc) => bloc.text)
    .join('\n')
    .trim();

  journaliserAppelIa(base, {
    usage: 'evenements',
    modele: tarif.modele,
    tokensEntree: tokensEntreeTotal,
    tokensSortie: tokensSortieTotal,
    coutCents,
    dureeMs: maintenant().getTime() - debut,
    // Une recherche n'alimente pas la base à elle seule (chaque proposition
    // reste `valide_par_humain = false`) : rien à valider pour l'appel lui-même.
    valideeParHumain: null,
  });

  if (texte === '') {
    return {
      disponible: false,
      raison: 'Claude a répondu sans contenu exploitable pour cette recherche.',
    };
  }

  const brut = extraireTableauJson(texte);
  if (brut === null) {
    return {
      disponible: false,
      raison:
        'La recherche a renvoyé un résultat mal formé. Réessayez, ou saisissez l’événement ' +
        'manuellement dans Événements.',
    };
  }

  const analyse = schemaPropositionsEvenementsIaBrutes.safeParse(brut);
  if (!analyse.success) {
    return {
      disponible: false,
      raison:
        'La recherche a renvoyé des événements dans un format inattendu. Réessayez, ou saisissez ' +
        'l’événement manuellement dans Événements.',
    };
  }

  return { disponible: true, propositions: analyse.data, coutCents };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Routes
   ═══════════════════════════════════════════════════════════════════════════ */

export function routesEvenementsDecouverte(
  base: BaseBatte,
  dependances: { sourcePropositions?: SourcePropositionsEvenements } = {},
): FastifyPluginAsync {
  const sourcePropositions = dependances.sourcePropositions ?? rechercherEvenementsParClaude;

  return async (app) => {
    /* ─── Lieux — sélecteur de l'écran de validation ──────────────────────── */

    app.get('/evenements-decouverte/lieux', async () => {
      const lignes = listerLieuxPourRechercheEvenements(base);
      return schemaListeLieuxPourRechercheEvenements.parse({ data: lignes });
    });

    /**
     * Rayon réglable PAR LIEU (fiche 05) — 5 | 10 | 15 | 20 | 40 | 100 km.
     * Route dédiée à cette fiche : le référentiel des lieux
     * (`apps/api/src/routes/referentiel-ecriture.ts`) n'expose pas encore ce
     * champ, voir le rapport de livraison.
     */
    app.patch<{ Params: { lieuId: string } }>(
      '/evenements-decouverte/lieux/:lieuId/rayon-recherche',
      async (requete) => {
        const corps = schemaReglageRayonRecherche.parse(requete.body);
        const modifie = reglerRayonRechercheEvenements(
          base,
          requete.params.lieuId,
          corps.rayonRechercheEvenementsKm,
        );
        return modifie;
      },
    );

    /* ─── Déclenchement manuel de la recherche (pas de tâche planifiée) ───── */

    app.post(
      '/evenements-decouverte/rechercher',
      { config: { rateLimit: LIMITE_APPEL_EXTERNE } },
      async (requete) => {
        const corps = schemaDemandeRecherche.parse(requete.body);
        const lieu = lieuPourRechercheEvenements(base, corps.lieuId);
        if (lieu === undefined) throw new ErreurIntrouvable('Lieu de marché', corps.lieuId);

        const parametres = lireParametres(base);
        const resultat = await sourcePropositions(base, parametres, {
          lieuNom: lieu.nom,
          rayonKm: lieu.rayonRechercheEvenementsKm,
        });

        if (!resultat.disponible) {
          return schemaResultatRechercheEvenements.parse({
            disponible: false,
            raison: resultat.raison,
          });
        }

        const propositions = resultat.propositions.map((brute) =>
          creerPropositionEvenementIa(base, {
            lieuId: lieu.id,
            nom: brute.nom,
            type: brute.type,
            dateDebut: brute.dateDebut,
            dateFin: brute.dateFin,
            portee: brute.portee,
            intensiteEstimee: brute.intensiteEstimee,
            distanceKm: brute.distanceEstimeeKm,
            communeTexte: brute.communeTexte,
            source: brute.source,
            resume: brute.resume,
          }),
        );

        return schemaResultatRechercheEvenements.parse({
          disponible: true,
          propositions: trierParRentabiliteDecroissante(propositions),
          coutCents: resultat.coutCents,
        });
      },
    );

    /* ─── Propositions en attente — triées par rentabilité décroissante ───── */

    app.get('/evenements-decouverte/propositions', async () => {
      const lignes = listerPropositionsEnAttente(base);
      return schemaListePropositionsEvenements.parse({
        data: lignes,
        meta: { total: lignes.length },
      });
    });

    /** Pour le bloc Alertes du tableau de bord (fiche 05) — voir le rapport de livraison. */
    app.get('/evenements-decouverte/propositions/nombre-en-attente', async () => ({
      nombre: nombrePropositionsEnAttente(base),
    }));

    app.post<{ Params: { id: string } }>(
      '/evenements-decouverte/propositions/:id/valider',
      async (requete) => {
        const corps = schemaValidationProposition.parse(requete.body ?? {});
        const validee = validerPropositionEvenement(base, requete.params.id, corps);
        return schemaPropositionEvenement.parse(validee);
      },
    );

    app.post<{ Params: { id: string } }>(
      '/evenements-decouverte/propositions/:id/rejeter',
      async (requete, reponse) => {
        rejeterPropositionEvenement(base, requete.params.id);
        reponse.code(204);
        return null;
      },
    );
  };
}
