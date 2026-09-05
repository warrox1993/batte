import type { ChampsEnErreur } from '@batte/core';

/**
 * Que devient `champsEnErreur` quand un champ change, AVANT tout nouvel essai
 * d'enregistrement ?
 *
 * DÉFAUT MESURÉ (recette clavier du 30/07/2026), partagé par Ingrédients,
 * Produits et Lieux de marché : chaque écran effaçait l'erreur du champ
 * modifié dès la première frappe, SANS revalider la nouvelle valeur. Sur
 * « Stock de sécurité » (Ingrédients), taper un seul caractère effaçait le
 * rouge et `aria-invalid` même si la valeur restait un non-entier — un
 * entre-deux qui n'est ni de la validation en direct, ni de la validation à
 * la sauvegarde, et qui donne l'impression d'avoir corrigé une saisie qui
 * reste fausse.
 *
 * CHOIX DU PROJET : validation À LA SAUVEGARDE, jamais en direct.
 * Revalider À CHAQUE frappe a été écarté : sur un champ entier, cela
 * marquerait « 1 » invalide en route vers « 12 » — une pénalité mid-frappe
 * sur exactement la saisie répétitive que CLAUDE.md §3 règle 10 veut fluide
 * au clavier. L'erreur affichée reste donc EXACTEMENT celle du dernier essai,
 * y compris sur le champ qu'on modifie, jusqu'à ce qu'`enregistrer()` la
 * recalcule en entier — succès : `{}` ; échec : l'ensemble à jour des champs
 * fautifs (`champsDepuisErreurZod`, ou l'équivalent local d'un écran). Rien
 * n'est présenté comme corrigé tant que ce n'est pas revérifié.
 *
 * Fonction UNIQUE et partagée plutôt que trois copies : une règle écrite
 * trois fois se contredit un jour (déjà vrai une fois, avant ce correctif,
 * où Produits s'en écartait sur le retour de focus — voir `Produits.tsx`).
 */
export function champsEnErreurApresModification(precedent: ChampsEnErreur): ChampsEnErreur {
  return precedent;
}
