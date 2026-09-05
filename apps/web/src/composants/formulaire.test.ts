import { describe, expect, it } from 'vitest';
import { champsEnErreurApresModification } from './formulaire';

/**
 * Défaut mesuré par la recette clavier du 30/07/2026, partagé par Ingrédients,
 * Produits et Lieux de marché : sur « Stock de sécurité » (Ingrédients), taper
 * UN caractère effaçait le marquage rouge et `aria-invalid`, même si la valeur
 * restait un non-entier — un entre-deux qui n'est ni de la validation en
 * direct (qui revaliderait la nouvelle valeur), ni de la validation à la
 * sauvegarde (qui laisserait le marquage intact jusqu'au prochain essai).
 *
 * `champsEnErreurApresModification` est le point UNIQUE qui documente le choix
 * du projet — validation À LA SAUVEGARDE — pour que les trois écrans qui
 * l'utilisent ne divergent jamais vers une troisième façon de faire.
 */
describe('champsEnErreurApresModification — validation à la sauvegarde, jamais en direct', () => {
  it('conserve tel quel un champ en erreur après une modification qui ne le revalide pas', () => {
    const avant = { stockSecurite: 'Le stock de sécurité doit être un nombre entier.' };
    expect(champsEnErreurApresModification(avant)).toEqual(avant);
  });

  it('ne modifie aucun autre champ en erreur', () => {
    const avant = { prixCents: 'Prix illisible.', nom: 'Le nom est obligatoire.' };
    expect(champsEnErreurApresModification(avant)).toEqual(avant);
  });

  it('renvoie un objet vide inchangé quand aucun champ n’est en erreur', () => {
    expect(champsEnErreurApresModification({})).toEqual({});
  });
});
