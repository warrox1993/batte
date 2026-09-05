/**
 * Contrat HTTP de la route `/api/audit` — LECTURE du journal d'audit.
 *
 * CLAUDE.md §3 regle 7 : « Rien ne s'efface. [...] Journal d'audit sur toutes
 * les tables sensibles. » La table etait tenue et personne ne pouvait la lire :
 * `listerJournalAudit` n'avait aucun appelant de production et aucune route ne
 * l'exposait (docs/13 §4.9). Un journal qu'on ne peut pas ouvrir coute des
 * ecritures et ne rend aucun service — y compris a un controleur, qui est
 * pourtant la seule raison pour laquelle on le tient.
 *
 * Le journal est en LECTURE SEULE, definitivement. Aucun schema d'ecriture ne
 * doit apparaitre ici : `journaliser` s'appelle depuis la transaction qui
 * modifie la donnee, jamais depuis HTTP. Un journal alimentable par une requete
 * exterieure ne prouve plus rien.
 */

import { z } from 'zod';

export const schemaActionAudit = z.enum(['creation', 'modification', 'annulation']);

/**
 * Instantane d'une ligne, fige tel quel au moment de l'action.
 *
 * La forme est LIBRE et c'est assume : le journal trace des tables differentes
 * (`parametre`, `lot`, `mouvement_stock`, `fournisseur`, `produit`…) dont les
 * colonnes n'ont rien de commun. Contraindre la forme ici reviendrait a devoir
 * modifier ce contrat a chaque nouvelle table tracee — et un journal qui refuse
 * d'enregistrer ce qu'il ne connait pas deja est un journal qui ment par
 * omission. Les valeurs restent `unknown` : l'ecran les affiche, il ne calcule
 * jamais dessus.
 */
export const schemaInstantaneAudit = z.record(z.string(), z.unknown());

export const schemaLigneAudit = z.object({
  id: z.string(),
  /** Nom SQL de la table tracee, ex. `parametre`. */
  table: z.string(),
  enregistrementId: z.string(),
  action: schemaActionAudit,
  /** `null` sur une creation. */
  valeurAvant: schemaInstantaneAudit.nullable(),
  /** `null` sur une suppression logique. */
  valeurApres: schemaInstantaneAudit.nullable(),
  /** Instant ISO 8601 UTC. L'affichage local est a la charge de l'ecran (§3 regle 8). */
  dateAction: z.string(),
  /** Nullable : pas d'authentification en V1 (D-001). */
  parQui: z.string().nullable(),
});

export const schemaJournalAudit = z.object({
  data: z.array(schemaLigneAudit),
  meta: z.object({
    /** Nombre d'entrees correspondant au filtre, AVANT plafonnement. */
    total: z.int(),
    /** Plafond applique a `data`. */
    limite: z.int(),
    /**
     * Vrai quand `total > limite`. Sans ce drapeau, l'ecran afficherait 200
     * lignes en laissant croire qu'il n'y en a pas d'autres : sur un journal,
     * une troncature invisible est une preuve d'absence qui ne prouve rien.
     */
    tronque: z.boolean(),
    /**
     * Tables REELLEMENT presentes dans le journal, pour alimenter le filtre.
     * Derivee de la base et jamais codee en dur : une liste ecrite a la main
     * proposerait des tables vides et tairait celles qu'un futur appel a
     * `journaliser` ajoutera.
     */
    tables: z.array(z.string()),
  }),
});

export type ActionAuditContrat = z.infer<typeof schemaActionAudit>;
export type LigneAuditContrat = z.infer<typeof schemaLigneAudit>;
export type JournalAudit = z.infer<typeof schemaJournalAudit>;
