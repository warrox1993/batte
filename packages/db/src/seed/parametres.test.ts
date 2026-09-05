/**
 * Tests de `seedParametres` — le contrat D-013 n'avait jamais été prouvé.
 *
 * `seedParametres` (voir sa doc) promet d'être « idempotent sur les VALEURS,
 * synchronisant sur les MÉTADONNÉES » : relancer `npm run db:seed` doit
 * pouvoir corriger une description ou une source améliorée, mais ne DOIT
 * JAMAIS remettre un seuil ajusté à la main à sa valeur d'usine. C'est
 * exactement la classe de défaut qu'un audit a trouvée cette nuit ailleurs
 * dans le catalogue (des valeurs inventées écrites en dur) : une régression
 * ici serait plus sournoise encore, puisqu'elle écraserait une valeur que
 * l'UTILISATEUR a lui-même choisie, silencieusement, à chaque redémarrage.
 *
 * Aucun test existant n'appelait `seedParametres` directement : les autres
 * suites passent par `seed(base)` (qui l'appelle en premier) sans jamais
 * vérifier ni l'idempotence, ni la resynchronisation des métadonnées.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { CATALOGUE_PARAMETRES } from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { parametre } from '../schema.js';
import { seedParametres } from './parametres.js';

/** Une clé quelconque du catalogue, prise à dessein plutôt que codée en dur : */
const CLE_TEST = CATALOGUE_PARAMETRES[0]!.cle;

function ligne(base: BaseBatte, cle: string) {
  const trouvee = base.select().from(parametre).where(eq(parametre.cle, cle)).all();
  if (trouvee.length === 0) throw new Error(`Paramètre non seedé : ${cle}`);
  return trouvee[0]!;
}

describe('seedParametres', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('insère toutes les clés du catalogue sur une base vierge, à leur valeur par défaut', () => {
    const resultat = seedParametres(base);

    expect(resultat.deja_presents).toHaveLength(0);
    expect(resultat.metadonneesMisesAJour).toHaveLength(0);
    expect(new Set(resultat.inseres)).toEqual(new Set(CATALOGUE_PARAMETRES.map((d) => d.cle)));

    for (const definition of CATALOGUE_PARAMETRES) {
      const ligneBase = ligne(base, definition.cle);
      expect(ligneBase.valeur, definition.cle).toBe(definition.valeurDefaut);
      expect(ligneBase.description, definition.cle).toBe(definition.description);
      expect(ligneBase.source, definition.cle).toBe(definition.source);
      expect(ligneBase.typeValeur, definition.cle).toBe(definition.typeValeur);
      expect(ligneBase.dateDebutValidite, definition.cle).toBe(definition.dateDebutValidite);
      expect(ligneBase.dateFinValidite, definition.cle).toBeNull();
    }
  });

  it('ne réinsère rien et ne resynchronise rien sur un second appel sans changement', () => {
    seedParametres(base);
    const resultat = seedParametres(base);

    expect(resultat.inseres).toHaveLength(0);
    expect(resultat.metadonneesMisesAJour).toHaveLength(0);
    expect(new Set(resultat.deja_presents)).toEqual(
      new Set(CATALOGUE_PARAMETRES.map((d) => d.cle)),
    );
  });

  it(
    'ne remet JAMAIS une valeur ajustée à la main à sa valeur d’usine ' +
      '(D-013 — idempotent sur les valeurs)',
    () => {
      seedParametres(base);

      const definition = CATALOGUE_PARAMETRES.find((d) => d.cle === CLE_TEST)!;
      const avant = ligne(base, CLE_TEST);
      // Une valeur manifestement différente de celle d'usine, quel que soit le
      // type déclaré : un entier ou un décimal accepte '999999', un texte ou du
      // JSON acceptent n'importe quelle chaîne non vide.
      const valeurAjustee =
        definition.typeValeur === 'texte' || definition.typeValeur === 'json'
          ? 'valeur-ajustee-a-la-main'
          : '999999';
      expect(valeurAjustee).not.toBe(definition.valeurDefaut);

      base.update(parametre).set({ valeur: valeurAjustee }).where(eq(parametre.id, avant.id)).run();

      const resultat = seedParametres(base);

      // La clé existait déjà : ni réinsérée, ni comptée comme neuve.
      expect(resultat.inseres).not.toContain(CLE_TEST);
      expect(resultat.deja_presents).toContain(CLE_TEST);

      const apres = ligne(base, CLE_TEST);
      expect(apres.valeur).toBe(valeurAjustee);
      expect(apres.valeur).not.toBe(definition.valeurDefaut);
    },
  );

  it(
    'resynchronise description, source et type quand ils ont dérivé du catalogue, ' +
      'sans toucher à la valeur en vigueur',
    () => {
      seedParametres(base);

      const definition = CATALOGUE_PARAMETRES.find((d) => d.cle === CLE_TEST)!;
      const avant = ligne(base, CLE_TEST);
      const valeurUtilisateur = avant.valeur;

      // Simule une documentation qui a dérivé du catalogue (le seul cas que
      // `seedParametres` doit corriger) — jamais la valeur elle-même.
      base
        .update(parametre)
        .set({
          description: 'Description périmée, écrite avant une clarification.',
          source: 'Source périmée.',
        })
        .where(eq(parametre.id, avant.id))
        .run();

      const resultat = seedParametres(base);

      expect(resultat.metadonneesMisesAJour).toContain(CLE_TEST);
      expect(resultat.inseres).not.toContain(CLE_TEST);

      const apres = ligne(base, CLE_TEST);
      expect(apres.description).toBe(definition.description);
      expect(apres.source).toBe(definition.source);
      // La valeur, elle, n'a pas bougé — ce n'est pas elle qui avait dérivé.
      expect(apres.valeur).toBe(valeurUtilisateur);
    },
  );
});
