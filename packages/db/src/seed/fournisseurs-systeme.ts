/**
 * Fournisseurs SYSTEME — du referentiel, pas de la demonstration.
 *
 * Ils vivent dans `seed()` et non dans `seedDemonstration()` : la demonstration
 * s'efface quand l'utilisateur veut sa vraie base, ceux-ci restent, au meme
 * titre que les codes motifs ou le plan de nettoyage. Sans eux, une fonction
 * documentee de l'application est inutilisable des la premiere minute.
 *
 * ── Pourquoi un fournisseur nomme plutot qu'un `fournisseur_id` nullable ─────
 *
 * Un inventaire d'ouverture est STRUCTURELLEMENT une reception : il cree des
 * lots et des mouvements d'entree, exactement comme une livraison. Or le lot
 * porte une cle etrangere obligatoire vers le fournisseur, et le service de
 * reception refuse un fournisseur inconnu.
 *
 * La tentation etait de rendre ce lien nullable. Ce serait repondre « on ne
 * sait pas » a la question « d'ou vient ce lot ? » — la question exacte que
 * l'AFSCA pose lors d'un rappel. Toute la tracabilite amont devrait alors
 * traiter un cas d'absence, et chaque ecran afficher un vide.
 *
 * Un fournisseur nomme repond quelque chose de VRAI et d'auditable : ce stock
 * etait present a l'ouverture de l'application, son origine commerciale n'est
 * pas tracee par cet outil. C'est une reponse honnete, pas un trou — et elle ne
 * touche ni au schema ni aux cles etrangeres.
 */

import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { fournisseur } from '../schema.js';

/**
 * Le libelle EST la cle d'idempotence : il est recherche avant insertion, comme
 * partout ailleurs dans la graine. Le renommer depuis l'interface creerait un
 * doublon a la prochaine execution — c'est le prix de ne pas ajouter une
 * colonne technique au schema pour trois lignes.
 */
export const FOURNISSEUR_INVENTAIRE_OUVERTURE = "Inventaire d'ouverture — origine non tracée";

export type ResultatSeedFournisseursSysteme = {
  inseres: string[];
};

export function seedFournisseursSysteme(base: BaseBatte): ResultatSeedFournisseursSysteme {
  const existant = base
    .select({ id: fournisseur.id })
    .from(fournisseur)
    .where(eq(fournisseur.nom, FOURNISSEUR_INVENTAIRE_OUVERTURE))
    .limit(1)
    .all();
  if (existant.length > 0) return { inseres: [] };

  const maintenant = maintenantUtc();

  base
    .insert(fournisseur)
    .values({
      id: nouvelIdentifiant(),
      nom: FOURNISSEUR_INVENTAIRE_OUVERTURE,
      /**
       * `systeme` : la valeur a ete ajoutee a l'enum plutot que de forcer
       * `detail`, qui aurait ete faux. Elle est LISIBLE mais NON SAISISSABLE —
       * `schemaSaisieFournisseur` n'accepte que les quatre types commerciaux,
       * sans quoi un formulaire pourrait fabriquer du stock d'origine non
       * tracee a volonte. C'est aussi ce type qui ecarte cette ligne du moteur
       * de reapprovisionnement (D-049).
       */
      type: 'systeme',
      // Rien d'invente : on ne commande RIEN a ce fournisseur, donc il n'a ni
      // adresse, ni contact, ni conditions commerciales. `0` jour de livraison
      // n'est pas un delai plausible, c'est l'absence de delai — la colonne
      // est `NOT NULL`.
      email: null,
      telephone: null,
      adresse: null,
      delaiLivraisonJours: 0,
      francoDePortCents: null,
      commandeMinimumCents: null,
      /**
       * ACTIF, et c'est une decision, pas un defaut.
       *
       * `apps/web/src/saisie-stock/SaisieReception.tsx` ne propose que les
       * fournisseurs actifs dans sa liste deroulante : desactive, celui-ci
       * serait invisible dans le seul ecran ou il sert. Ce qui le tient a
       * l'ecart des commandes n'est pas son statut mais le fait qu'il n'a
       * AUCUN conditionnement — or `genererBrouillonsCommandes` deduit le
       * fournisseur a commander du conditionnement de l'ingredient. Il ne peut
       * donc jamais se retrouver sur un bon de commande.
       */
      actif: true,
      notes:
        'Fournisseur SYSTÈME, créé par la graine. Il ne correspond à aucune entreprise : il ' +
        "sert à rattacher les lots d'un inventaire d'ouverture — la marchandise déjà en stock " +
        "le jour où l'application est installée. Un lot doit toujours porter l'identité de son " +
        'fournisseur (obligation de traçabilité) ; ici cette identité dit honnêtement que ' +
        "l'origine commerciale n'est pas tracée par cet outil, au lieu de laisser un vide. " +
        'Ne le supprimez pas : des lots le référencent, et le droit comptable belge impose de ' +
        'pouvoir les relire pendant dix ans.',
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  return { inseres: [FOURNISSEUR_INVENTAIRE_OUVERTURE] };
}
