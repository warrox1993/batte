import { ErreurApi } from '../lib/api';
import { Panneau } from './Panneau';

/**
 * Un encart qui échoue à charger ne doit JAMAIS disparaître avec son titre.
 *
 * Défaut constaté en conditions réelles (31/07/2026) : deux routes du
 * tableau de bord répondaient en 500 (un paramètre absent du catalogue), et
 * les encarts « Seuils légaux » / « À traiter » disparaissaient ENTIÈREMENT,
 * remplacés par un bandeau rouge nu sans titre ni cadre — l'un se retrouvant
 * même collé sous un autre encart, comme s'il lui appartenait. Le porteur ne
 * pouvait pas dire QUEL encart était mort, et le message
 * (« echeance_e604b_tolerance_cents » n'est pas défini ») était une clé
 * technique, pas une phrase en français actionnable (CLAUDE.md §4).
 *
 * Le patron correct existait déjà, partiellement et dupliqué mot pour mot,
 * dans `Factures.tsx` et `saisie-stock/SaisieReception.tsx` :
 * `if (etat.statut === 'erreur') return (<Panneau titre={titre}><BandeauErreur
 * message={...} /></Panneau>)`. Ce fichier n'invente pas un second patron, il
 * en fait l'unique version partagée — voir `EncartErreur` plus bas pour le
 * remplacement direct de ce `if`, et `MessageErreur` pour le cas où le
 * `Panneau` est déjà ouvert par ailleurs (état imbriqué dans un panneau qui
 * affiche aussi une liste, un formulaire, etc. — jamais un second `Panneau`
 * imbriqué dans celui déjà ouvert, docs/07-DOCTRINE-ERP-ET-DESIGN.md §4.8).
 */

/**
 * Phrase générique pour TOUTE la CLASSE `ErreurParametreManquant`
 * (`packages/core/src/erreurs.ts`), quelle que soit la clé absente.
 *
 * Le remède est vrai pour les 99 clés du catalogue, pas une seule :
 * `packages/db/src/seed/parametres.ts` (`seedParametres`) est idempotent sur
 * les clés déjà présentes (D-013, commentaire de la fonction) — relancer le
 * seed ajoute uniquement ce qui manque, sans jamais écraser un réglage déjà
 * ajusté à la main. C'est exactement le cas qui produit cette erreur : une
 * clé ajoutée au catalogue TypeScript après le dernier `db:seed` de la base
 * réelle.
 */
const MESSAGE_PARAMETRE_MANQUANT_GENERIQUE =
  "Ce calcul a besoin d'un réglage absent du catalogue de paramètres. Lancez « npm run db:seed » " +
  'pour le créer avec sa valeur par défaut, puis vérifiez-le dans Paramètres.';

/**
 * Motif EXACT du message que `ErreurParametreManquant` produit, quelle que
 * soit la clé (`` `Le paramètre « ${cle} » n'est pas défini. Renseignez-le
 * dans Paramètres avant de continuer.` ``). Une SEULE expression pour toute
 * la classe — jamais un dictionnaire clé par clé : ce dépôt a déjà payé
 * plusieurs fois le prix d'une liste écrite à la main, fausse dès qu'une clé
 * s'ajoute (mémoire du porteur, fiches `docs/demandes/`).
 */
const MOTIF_PARAMETRE_MANQUANT =
  /^Le paramètre « .+ » n'est pas défini\. Renseignez-le dans Paramètres avant de continuer\.$/;

/**
 * Un refus n'a pas la même nature selon son origine, et l'écran doit le dire.
 *
 *  - `metier` : le porteur a quelque chose à faire — une saisie à corriger, une
 *    condition d'exploitation à remplir (« cette session n'est pas encore
 *    clôturée », « aucun produit actif »). Registre d'alerte MÉTIER, celui qui
 *    doit rester rare pour rester lisible.
 *  - `technique` : le serveur n'a pas répondu, ou a rendu un 500. Il n'y a
 *    aucune décision à prendre. Registre neutre de `MessageErreur`.
 *
 * Les mélanger a été corrigé sur 78 emplacements de l'application le
 * 01/08/2026 : une panne de réseau y criait aussi fort qu'une rupture de stock.
 */
export type NatureRefus = 'metier' | 'technique';

/**
 * Un 4xx est un REFUS raisonné du serveur : le message est déjà une phrase en
 * français qui dit quoi faire (`packages/db/src/services/**` les écrit ainsi à
 * la source). Un 5xx, une coupure réseau ou une valeur lancée qui n'est même
 * pas une `Error` sont des PANNES : le porteur n'y peut rien.
 *
 * Fonction PURE, exportée pour être testée directement — comme
 * `messageErreurAffichable` ci-dessous, et pour la même raison : la décision
 * doit se prouver hors du rendu, indépendamment de tout composant qui
 * l'utilise. Le rendu de l'encart est couvert par
 * `EncartErreur.montage.test.tsx`.
 */
export function natureDuRefus(erreur: unknown): NatureRefus {
  return erreur instanceof ErreurApi && erreur.statut >= 400 && erreur.statut < 500
    ? 'metier'
    : 'technique';
}

export type MessageErreurAffichable = {
  /** Phrase affichée en PREMIER, toujours actionnable. */
  readonly principal: string;
  /**
   * Message BRUT du serveur, relégué en second plan — lisible par qui
   * développe, jamais la première chose lue. `null` quand `principal` est
   * déjà ce message brut : toute erreur métier hors de la classe reconnue
   * est déjà écrite en français actionnable À LA SOURCE (voir par exemple le
   * refus d'annulation d'une réception déjà consommée,
   * `packages/db/src/services/mouvements.ts`) — la doubler ici ferait du
   * bruit, pas de la pédagogie.
   */
  readonly detailTechnique: string | null;
};

/**
 * Fonction PURE, exportée pour être testée directement : c'est elle qui
 * décide ce qui s'affiche, indépendamment de tout rendu.
 */
export function messageErreurAffichable(brut: string): MessageErreurAffichable {
  if (MOTIF_PARAMETRE_MANQUANT.test(brut)) {
    return { principal: MESSAGE_PARAMETRE_MANQUANT_GENERIQUE, detailTechnique: brut };
  }
  return { principal: brut, detailTechnique: null };
}

/**
 * Contenu d'un encart en erreur, À POSER DANS un `Panneau` déjà ouvert.
 *
 * Ni le glyphe ni la couleur du registre d'alerte MÉTIER (`alerte` /
 * `depassement`, `--color-alerte*` / `--color-depassement*`, `index.css`) :
 * une panne technique de chargement n'annonce ni une rupture de stock ni un
 * seuil franchi, et les mélanger diluerait le seul signal qui doit rester
 * rare. `text-ink-2` / `text-ink-3` sont les mêmes tons que le reste du texte
 * courant de l'application — aucun jeton nouveau, et un encart en erreur qui
 * ne « crie » pas plus fort qu'un encart sain.
 */
export function MessageErreur({ message }: { message: string }) {
  const { principal, detailTechnique } = messageErreurAffichable(message);
  return (
    <div role="alert">
      <p className="text-sm text-ink-2">{principal}</p>
      {detailTechnique !== null && <p className="mt-1 text-2xs text-ink-3">{detailTechnique}</p>}
    </div>
  );
}

/**
 * Un encart ENTIER en erreur : le `Panneau` et son titre restent en place, le
 * cadre garde sa taille normale, seul le contenu change. Remplace directement
 * un `if (etat.statut === 'erreur') { return (<div role="alert"
 * className="…depassement…">{etat.message}</div>); }` qui, lui, jetait le
 * titre avec le reste.
 */
export function EncartErreur({ titre, message }: { titre: string; message: string }) {
  return (
    <Panneau titre={titre}>
      <MessageErreur message={message} />
    </Panneau>
  );
}
