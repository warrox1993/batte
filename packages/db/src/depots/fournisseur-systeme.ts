/**
 * Foyer UNIQUE de la garde « ce fournisseur est-il commercial ? ».
 *
 * ═══ POURQUOI CE FICHIER EXISTE (audit du 31/07/2026) ═══
 *
 * La même vérification — le fournisseur existe-t-il, et n'est-il PAS le
 * fournisseur SYSTÈME (« Inventaire d'ouverture », `fournisseur.type =
 * 'systeme'` — voir `seed/fournisseurs-systeme.ts`) — vivait recopiée à
 * l'identique dans TROIS points d'écriture (`depots/referentiel-ecriture.ts`,
 * `depots/economies.ts`, `services/factures.ts`), et son message d'existence
 * avait déjà divergé trois fois sur trois (« n'existe plus. » / « n'existe
 * pas ou a été supprimé. » / un `ErreurIntrouvable` 404 sans `champs` plutôt
 * qu'un 422 formulaire). Un QUATRIÈME point d'écriture — `enregistrerDepense`
 * (`depots/comptabilite.ts`) — vérifiait l'existence du fournisseur mais
 * jamais son type : rien n'empêchait donc d'attribuer une dépense à
 * « Inventaire d'ouverture », qui n'a jamais engagé la moindre charge réelle.
 *
 * Une règle sans foyer dérive : c'est exactement ce qui vient d'être constaté
 * un étage au-dessus, sur le filtre de sélection du fournisseur recopié dans
 * trois écrans (deux divergences sur trois). Ce fichier est le foyer unique
 * de LA RÈGLE (l'existence, puis le rejet du type système) ; le MESSAGE reste
 * partiellement au choix de l'appelant, parce que la conséquence concrète
 * diffère réellement selon l'écran (« on ne lui commande rien » vs « aucune
 * facture ne s'enregistre à son nom ») — voir `contexteRefus` ci-dessous.
 *
 * Message d'EXISTENCE retenu : celui déjà partagé par les trois autres
 * vérifications d'existence de `depots/economies.ts` (ingrédient,
 * conditionnement, commande), la convention la plus répandue dans ce
 * paquet — pas un choix arbitraire parmi les trois formulations trouvées.
 *
 * ═══ CE QUE CE FICHIER NE COUVRE PAS (à dessein) ═══
 *
 *  - `services/reception.ts` (`enregistrerReception`) — RECEVOIR de la
 *    marchandise CONTRE le fournisseur système est sa raison d'être
 *    (`seed/fournisseurs-systeme.ts` : « c'est ainsi que l'inventaire
 *    d'ouverture obtient un lot tracé, exigence AFSCA »). Cette fonction
 *    n'est appelée par AUCUN chemin de réception, et ne doit jamais l'être —
 *    voir `seed/fournisseurs-systeme.test.ts` pour la preuve que ce chemin
 *    fonctionne toujours.
 *  - `services/commandes.ts::conditionnementReference` — le fournisseur n'y
 *    est jamais choisi par l'utilisateur : il est DÉDUIT du conditionnement
 *    actif le plus récent, par un simple filtre de requête
 *    (`ne(fournisseur.type, 'systeme')`, D-049). Il n'y a rien à REFUSER là
 *    où aucun `fournisseurId` n'est soumis par un formulaire — appeler cette
 *    fonction transformerait un filtre silencieux (candidat simplement
 *    écarté) en une erreur qu'aucun écran ne peut présenter.
 *  - `depots/referentiel.ts::verifierFournisseurModifiable` — une règle
 *    VOISINE mais DISTINCTE : elle protège la FICHE fournisseur système
 *    elle-même (on ne la modifie ni ne la désactive), pas une référence
 *    ENTRANTE vers elle depuis un autre document. Signature différente
 *    (reçoit la ligne déjà chargée par l'appelant pour sa propre trace
 *    d'audit, ne fait pas sa propre lecture) : les fondre forcerait une
 *    ressemblance de surface entre deux règles qui n'ont pas le même sujet
 *    (CLAUDE.md — « un regroupement forcé entre deux règles qui se
 *    ressemblent aujourd'hui est pire que deux copies »).
 */

import { ErreurMetier } from '@batte/core';
import { eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { fournisseur } from '../schema.js';

/**
 * Vérifie qu'un `fournisseurId` SAISI PAR L'UTILISATEUR existe et n'est pas
 * le fournisseur système. À appeler AVANT toute écriture qui rattache un
 * document (conditionnement, économie, facture, dépense…) à ce fournisseur.
 *
 * `contexteRefus` porte la conséquence propre à l'appelant, employée dans le
 * message quand le fournisseur EST le système — ex. `"on ne lui commande
 * rien."`, `"aucune facture ne s'enregistre à son nom."` — jamais une phrase
 * générique : c'est elle qui rend le refus compréhensible sur CET écran
 * précis plutôt qu'un message interchangeable d'un écran à l'autre.
 */
export function verifierFournisseurCommercial(
  base: BaseBatte,
  fournisseurId: string,
  contexteRefus: string,
): void {
  const ligne = base
    .select({ type: fournisseur.type })
    .from(fournisseur)
    .where(eq(fournisseur.id, fournisseurId))
    .get();

  if (ligne === undefined) {
    throw new ErreurMetier(
      'fournisseur_introuvable',
      "Le fournisseur choisi n'existe pas ou a été supprimé.",
      { champs: { fournisseurId: 'Choisissez un fournisseur existant.' } },
    );
  }
  if (ligne.type === 'systeme') {
    throw new ErreurMetier(
      'fournisseur_systeme',
      `« Inventaire d'ouverture » n'est pas un fournisseur : ${contexteRefus}`,
      { champs: { fournisseurId: 'Choisissez un fournisseur commercial.' } },
    );
  }
}
