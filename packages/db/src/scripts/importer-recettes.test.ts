/**
 * Migration des recettes depuis le classeur — le classeur fait foi.
 *
 * ⛔ CE QUI A MOTIVE CE FICHIER
 *
 * Comparaison du 18/08/2026, a base egale (1 000 ml de pate) :
 *
 *     ingredient              classeur       ERP     ecart
 *     Beurre                    57,1 g   120,9 g    +112 %
 *     Oeufs entiers                2,3       4,4     +92 %
 *     Farine de froment T55    285,7 g   318,7 g     +12 %
 *
 * Et quatre ingredients sans correspondance : le classeur porte des jaunes
 * d'oeufs, une gousse de vanille et du rhum brun ; l'ERP portait du sucre
 * vanille et de l'eau de fleur d'oranger. Deux recettes differentes sous le
 * meme nom. R2 « sarrasin-chataigne » etait en outre ENTIEREMENT VIDE cote
 * ERP, alors que le classeur en porte douze lignes.
 *
 * Jean-Baptiste a tranche : « celle du classeur fait foi ».
 *
 * ⛔ LE PERIMETRE, ET POURQUOI IL EST ETROIT
 *
 * Le classeur porte des INGREDIENTS et des QUANTITES. Il ne dit rien de la
 * perte de cuisson, du taux de casse, ni de l'allegation « sans gluten ».
 * La migration ne remplace donc QUE les lignes ; tout le reste de la fiche
 * recette est repris tel qu'il est en base.
 *
 * C'est deliberе : ecraser `sansGluten` par une valeur deduite d'un nom de
 * feuille reviendrait a decider une allegation reglementaire depuis un
 * libelle. La regle de la maison l'interdit — « ne jamais ecrire sans gluten
 * sans reserve ».
 *
 * ⛔ ET LES ALLERGENES DES INGREDIENTS CREES
 *
 * Neuf ingredients du classeur n'existaient pas dans l'ERP. Ils sont crees
 * avec `allergenes: []` ET `allergenesVerifies: false` — ce qui se lit
 * « non documente », jamais « ne contient pas ». Le test l'exige
 * explicitement, parce que c'est la seule difference entre une fiche
 * honnete et une fiche qui ment par omission.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { ingredient, recette, recetteLigne } from '../schema.js';
import { importerRecettes, type RecetteSource } from './importer-recettes.js';

const SOURCE: RecetteSource[] = [
  {
    code: 'R1',
    rendementReferenceMl: 1750,
    lignes: [
      { ingredientNom: 'Farine de froment T55', quantiteUniteRef: 500, uniteReference: 'g', categorieSiACreer: 'farine' },
      { ingredientNom: 'Lait entier', quantiteUniteRef: 1000, uniteReference: 'ml', categorieSiACreer: 'laitier' },
      { ingredientNom: 'Œufs entiers', quantiteUniteRef: 4, uniteReference: 'piece', categorieSiACreer: 'oeuf' },
      { ingredientNom: "Jaunes d'œufs", quantiteUniteRef: 2, uniteReference: 'piece', categorieSiACreer: 'oeuf' },
      { ingredientNom: 'Beurre', quantiteUniteRef: 100, uniteReference: 'g', categorieSiACreer: 'laitier' },
      { ingredientNom: 'Rhum brun', quantiteUniteRef: 30, uniteReference: 'ml', categorieSiACreer: 'aromate' },
    ],
  },
  {
    code: 'R2',
    rendementReferenceMl: 1400,
    lignes: [
      { ingredientNom: 'Farine de sarrasin', quantiteUniteRef: 180, uniteReference: 'g', categorieSiACreer: 'farine' },
      { ingredientNom: 'Gomme de xanthane', quantiteUniteRef: 3, uniteReference: 'g', categorieSiACreer: 'aromate' },
    ],
  },
];

/** Cree les deux recettes cibles, comme l'ERP les porte avant migration. */
function poserRecettesVides(base: BaseBatte): void {
  const t = new Date().toISOString();
  base
    .insert(recette)
    .values([
      {
        id: 'rec-r1', code: 'R1', nom: 'Pâte à crêpes froment', version: 1,
        statut: 'active', typePate: 'froment', sansGluten: false,
        rendementReferenceMl: 455, rendementReferenceCrepes: 7,
        perteCuissonBp: 300, tauxCasseBp: 200, perteFixeMl: 0,
        creeLe: t, modifieLe: t,
      },
      {
        id: 'rec-r2', code: 'R2', nom: 'Pâte sarrasin-châtaigne', version: 1,
        statut: 'brouillon', typePate: 'sarrasin-chataigne', sansGluten: true,
        rendementReferenceMl: 441, rendementReferenceCrepes: 6,
        perteCuissonBp: 300, tauxCasseBp: 200, perteFixeMl: 0,
        creeLe: t, modifieLe: t,
      },
    ])
    .run();
}

describe('Migration des recettes — le classeur fait foi', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    poserRecettesVides(base);
  });

  it('cree les ingredients manquants, en NON DOCUMENTE', () => {
    const r = importerRecettes(base, SOURCE);

    const rhum = base
      .select()
      .from(ingredient)
      .where(eq(ingredient.nom, 'Rhum brun'))
      .get();
    expect(rhum).toBeDefined();
    expect(rhum!.uniteReference).toBe('ml');
    // ⛔ LE POINT QUI COMPTE : « non documente », jamais « ne contient pas ».
    expect(rhum!.allergenes).toEqual([]);
    expect(rhum!.allergenesVerifies).toBe(false);
    expect(r.ingredientsCrees).toBeGreaterThan(0);
  });

  it('remplace les lignes de R1 par celles du classeur', () => {
    importerRecettes(base, SOURCE);
    const lignes = base
      .select({ n: sql<number>`count(*)` })
      .from(recetteLigne)
      .where(eq(recetteLigne.recetteId, 'rec-r1'))
      .get()!.n;
    expect(lignes).toBe(SOURCE[0]!.lignes.length);
  });

  it('remplit R2, qui etait entierement vide', () => {
    importerRecettes(base, SOURCE);
    const lignes = base
      .select({ n: sql<number>`count(*)` })
      .from(recetteLigne)
      .where(eq(recetteLigne.recetteId, 'rec-r2'))
      .get()!.n;
    expect(lignes).toBe(SOURCE[1]!.lignes.length);
  });

  it('ecrit les quantites du classeur, converties aux unites de l ERP', () => {
    importerRecettes(base, SOURCE);
    const farine = base
      .select({ q: recetteLigne.quantiteUniteRef })
      .from(recetteLigne)
      .innerJoin(ingredient, eq(ingredient.id, recetteLigne.ingredientId))
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!;
    // 0,5 kg au classeur -> 500 g dans l'ERP. Un facteur mille les separe.
    expect(farine.q).toBe(500);
  });

  it('met le rendement de reference du classeur', () => {
    importerRecettes(base, SOURCE);
    const r1 = base.select().from(recette).where(eq(recette.id, 'rec-r1')).get()!;
    expect(r1.rendementReferenceMl).toBe(1750);
  });

  it('ne touche PAS a l allegation sans gluten ni aux pertes', () => {
    // ⛔ Le classeur ne dit rien de ces champs. Les ecraser reviendrait a
    // decider une allegation reglementaire depuis un libelle de feuille.
    importerRecettes(base, SOURCE);
    const r2 = base.select().from(recette).where(eq(recette.id, 'rec-r2')).get()!;
    expect(r2.sansGluten).toBe(true);
    expect(r2.perteCuissonBp).toBe(300);
    expect(r2.tauxCasseBp).toBe(200);
    expect(r2.statut).toBe('brouillon');
  });

  it('relance sans doubler : deux migrations donnent le meme compte', () => {
    importerRecettes(base, SOURCE);
    const apresUn = base.select({ n: sql<number>`count(*)` }).from(recetteLigne).get()!.n;
    const r = importerRecettes(base, SOURCE);
    const apresDeux = base.select({ n: sql<number>`count(*)` }).from(recetteLigne).get()!.n;
    expect(apresDeux).toBe(apresUn);
    expect(r.ingredientsCrees).toBe(0); // ils existent deja
  });

  it('refuse une recette dont le code est absent de l ERP, et la NOMME', () => {
    const inconnue: RecetteSource = { code: 'R9', rendementReferenceMl: 1000, lignes: [] };
    const r = importerRecettes(base, [...SOURCE, inconnue]);
    expect(r.recettesIgnorees).toBe(1);
    expect(r.motifs.join(' ')).toContain('R9');
  });

  it('compte juste : aucune ligne source ne disparait en silence', () => {
    const r = importerRecettes(base, SOURCE);
    const attendu = SOURCE.reduce((n, x) => n + x.lignes.length, 0);
    expect(r.lignesEcrites + r.lignesIgnorees).toBe(attendu);
    expect(r.lignesIgnorees).toBe(0);
  });
});
