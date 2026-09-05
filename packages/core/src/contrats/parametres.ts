/**
 * Contrat HTTP des routes `/api/parametres`.
 *
 * docs/06-UI-ET-PARCOURS.md : « Un schema Zod par route, partage entre client et
 * serveur via `packages/core`. Le typage du client est derive du schema, jamais
 * reecrit a la main. »
 *
 * Consequence concrete : ajouter une colonne a la table `parametre` sans mettre
 * ce schema a jour fait echouer la validation de sortie cote serveur, donc les
 * tests. Le contrat ne peut pas deriver en silence.
 */

import { z } from 'zod';

export const schemaTypeValeurParametre = z.enum(['entier', 'decimal', 'texte', 'booleen', 'json']);

/** Une ligne de la table `parametre`, telle qu'exposee par l'API. */
export const schemaParametre = z.object({
  id: z.string(),
  cle: z.string(),
  valeur: z.string(),
  typeValeur: schemaTypeValeurParametre,
  dateDebutValidite: z.string(),
  /** `null` = en vigueur sans terme connu. */
  dateFinValidite: z.string().nullable(),
  source: z.string(),
  description: z.string(),
  creeLe: z.string(),
  modifieLe: z.string(),
});

/** Forme des reponses de liste imposee par docs/06 : `{ data, meta }`. */
export const schemaListeParametres = z.object({
  data: z.array(schemaParametre),
  meta: z.object({ total: z.number().int() }),
});

/**
 * Corps du PATCH. Seule la valeur est modifiable : la cle, le type et la source
 * ne se corrigent pas depuis l'ecran, ils viennent du catalogue (D-013).
 *
 * ═══ Pourquoi le vide n'est PAS refuse ici (30/07/2026) ═══
 *
 * Ce schema portait un `.min(1)`. Il a ete retire, et le raisonnement vaut
 * d'etre garde : **Zod ne peut pas savoir de quel TYPE est le parametre**. Il ne
 * recoit qu'une valeur ; la cle est dans l'URL, et c'est la cle qui dit, via le
 * catalogue, s'il s'agit d'un entier, d'un booleen ou d'un texte libre.
 *
 * Or la regle correcte depend du type : un seuil ou un taux vide est une faute
 * (`Number('')` vaut 0, donc un `decimal` vide passerait pour zero), tandis
 * qu'un `texte` vide est une INFORMATION — c'est ainsi que
 * `adresse_depart_defaut` dit « pas encore renseignee » (D-065). Refuser le vide
 * partout forcait a inventer une adresse par defaut plausible, exactement ce que
 * ce projet interdit : elle aurait produit des distances fausses, donc des couts
 * de deplacement faux, que rien n'aurait signales.
 *
 * La garde n'est pas perdue, elle est DEPLACEE la ou le catalogue est connu :
 * `verifierValeur` (`packages/db/src/depots/parametres.ts`) refuse le vide pour
 * tous les types sauf `texte`, et leve une `ErreurMetier` traduite en 422 avec
 * un message francais. Dupliquer une regle dans un endroit qui n'a pas
 * l'information necessaire pour l'appliquer correctement, c'est la facon dont
 * une regle finit par etre fausse.
 */
export const schemaCorrectionParametre = z.object({
  valeur: z.string(),
});

export type Parametre = z.infer<typeof schemaParametre>;
export type ListeParametres = z.infer<typeof schemaListeParametres>;
export type CorrectionParametre = z.infer<typeof schemaCorrectionParametre>;
