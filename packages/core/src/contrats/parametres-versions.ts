/**
 * Contrat HTTP de `POST /api/parametres/:cle/versions` — faire evoluer un
 * parametre a partir d'une date, sans ecraser la valeur precedente.
 *
 * Pourquoi un contrat separe de `schemaCorrectionParametre` : ce sont deux
 * gestes METIER distincts, et les confondre reecrit des pieces comptables
 * closes.
 *
 *  - **Corriger** (`PATCH /parametres/:id`) : la valeur saisie etait fausse,
 *    elle n'a jamais ete vraie. On repare une faute de frappe. Retroactif par
 *    nature, puisqu'on efface une erreur qui n'aurait jamais du exister.
 *  - **Faire evoluer** (cette route) : la valeur etait juste, et elle change a
 *    partir d'une date. Le seuil de franchise TVA qui passe de 25 000 € a autre
 *    chose en 2027. JAMAIS retroactif — c'est precisement ce qui protege les
 *    sessions deja cloturees d'etre recalculees avec un seuil qui n'existait
 *    pas encore (D-004 / D-024, agregats figes a la cloture).
 *
 * La cle voyage dans l'URL et non dans le corps : elle designe la ressource,
 * elle ne se saisit pas dans un formulaire. Une cle inconnue du catalogue est
 * donc un 404, tandis qu'une valeur mal saisie est un 422 portant le nom du
 * champ fautif.
 *
 * Ni `cle`, ni `typeValeur`, ni `description` ne figurent dans le corps : ils
 * viennent du catalogue `CATALOGUE_PARAMETRES`, source unique (D-013). Ne
 * restent saisissables que les trois informations qui changent reellement d'une
 * version a l'autre — le chiffre, sa date d'entree en vigueur, et sa source.
 */

import { z } from 'zod';

/** Jour civil `AAAA-MM-JJ` (CLAUDE.md §3 regle 8 : dates au jour civil belge). */
const MOTIF_JOUR_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

export const schemaNouvelleVersionParametre = z.object({
  /**
   * Valeur BRUTE, telle qu'elle sera stockee — la table `parametre` est
   * generique et ne connait que du texte. Le typage fin (entier pour un
   * `_cents`, booleen, JSON...) est verifie cote depot contre le type declare
   * au catalogue : le refaire ici en dupliquerait la regle.
   */
  valeur: z.string().min(1, 'Indiquez la nouvelle valeur.'),
  dateDebutValidite: z
    .string()
    .regex(MOTIF_JOUR_CIVIL, "Indiquez la date d'entrée en vigueur, au format AAAA-MM-JJ."),
  /**
   * Obligatoire, et c'est voulu : CLAUDE.md §7 impose « date de validite et
   * source ». Un seuil legal dont on ne sait plus d'ou il sort est invérifiable
   * le jour d'un controle.
   */
  source: z
    .string()
    .min(1, 'Indiquez la source du nouveau chiffre : texte légal, contrat, ou mesure.'),
});

export type NouvelleVersionParametre = z.infer<typeof schemaNouvelleVersionParametre>;
