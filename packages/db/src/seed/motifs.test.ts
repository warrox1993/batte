/**
 * `seedMotifs` — idempotence et resynchronisation.
 *
 * La branche jamais exercée est la plus délicate des deux : quand un motif
 * existe déjà mais que son libellé ou sa catégorie ont changé au catalogue,
 * la graine doit METTRE À JOUR ces deux colonnes — et ne surtout pas toucher
 * à `actif`. Le contrat est écrit en tête du fichier source : « le catalogue
 * possède la documentation, la base possède l'activation — désactiver un motif
 * inutilisé est une décision de l'utilisateur, le seed ne doit jamais la
 * défaire ».
 *
 * Rien ne le vérifiait. Or `seed` tourne à chaque `npm run db:init` : une
 * resynchronisation qui réactiverait les motifs remettrait, à chaque
 * démarrage, des motifs que l'utilisateur avait volontairement retirés de ses
 * listes déroulantes.
 */

import { CATALOGUE_MOTIFS } from '@batte/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { motif } from '../schema.js';
import { seedMotifs } from './motifs.js';

/** Un code réellement présent au catalogue, pris à la source et non recopié. */
const CODE = CATALOGUE_MOTIFS[0]!.code;

describe('seedMotifs', () => {
  let base: BaseBatte;

  function ligne(code: string) {
    return base.select().from(motif).where(eq(motif.code, code)).get();
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('insère tout le catalogue au premier passage', () => {
    const resultat = seedMotifs(base);
    expect(resultat.inseres.length).toBe(CATALOGUE_MOTIFS.length);
    expect(resultat.libellesMisAJour).toEqual([]);
    expect(base.select().from(motif).all().length).toBe(CATALOGUE_MOTIFS.length);
  });

  it('n’insère ni ne modifie rien au second passage — idempotent', () => {
    seedMotifs(base);
    const resultat = seedMotifs(base);
    expect(resultat.inseres).toEqual([]);
    expect(resultat.libellesMisAJour).toEqual([]);
    expect(base.select().from(motif).all().length).toBe(CATALOGUE_MOTIFS.length);
  });

  it('resynchronise le LIBELLÉ divergent, et lui seul', () => {
    seedMotifs(base);
    const avant = ligne(CODE)!;
    base.update(motif).set({ libelle: 'Libellé périmé' }).where(eq(motif.code, CODE)).run();

    const resultat = seedMotifs(base);

    expect(resultat.libellesMisAJour).toEqual([CODE]);
    // Discrimine : seule la ligne touchée doit remonter. Une graine qui
    // réécrirait tout signalerait les 13 codes.
    expect(resultat.inseres).toEqual([]);
    const apres = ligne(CODE)!;
    expect(apres.libelle).toBe(avant.libelle);
    expect(apres.id).toBe(avant.id);
  });

  it('resynchronise aussi une CATÉGORIE divergente', () => {
    seedMotifs(base);
    const avant = ligne(CODE)!;
    const autreCategorie = CATALOGUE_MOTIFS.find((m) => m.categorie !== avant.categorie)!.categorie;
    base.update(motif).set({ categorie: autreCategorie }).where(eq(motif.code, CODE)).run();

    const resultat = seedMotifs(base);

    expect(resultat.libellesMisAJour).toEqual([CODE]);
    expect(ligne(CODE)!.categorie).toBe(avant.categorie);
  });

  it('ne RÉACTIVE JAMAIS un motif que l’utilisateur a désactivé', () => {
    // Le cœur du contrat : la resynchronisation touche le libellé et la
    // catégorie, jamais `actif`. Le motif est désactivé ET son libellé rendu
    // divergent, pour que la mise à jour ait réellement lieu sur cette ligne.
    seedMotifs(base);
    base
      .update(motif)
      .set({ actif: false, libelle: 'Libellé périmé' })
      .where(eq(motif.code, CODE))
      .run();

    const resultat = seedMotifs(base);

    expect(resultat.libellesMisAJour).toEqual([CODE]);
    expect(ligne(CODE)!.actif).toBe(false);
  });
});
