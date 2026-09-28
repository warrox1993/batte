/**
 * Migration des recettes depuis le classeur de l'usine — le classeur fait foi.
 *
 *     npx tsx packages/db/src/scripts/importer-recettes.ts --recettes <f.json>
 *     ... --a-blanc     # controle sans ecrire
 *
 * ⛔ POURQUOI CETTE MIGRATION
 *
 * Comparaison du 18/08/2026, a base egale de 1 000 ml de pate :
 *
 *     Beurre                   57,1 g classeur  contre  120,9 g ERP   +112 %
 *     Oeufs entiers               2,3           contre      4,4        +92 %
 *     Farine de froment T55   285,7 g           contre    318,7 g      +12 %
 *
 * Plus quatre ingredients sans correspondance — jaunes d'oeufs, gousse de
 * vanille et rhum brun cote classeur ; sucre vanille et eau de fleur
 * d'oranger cote ERP. Ce n'etaient pas deux versions d'une meme recette,
 * mais deux recettes differentes sous le meme nom. Et R2 etait ENTIEREMENT
 * VIDE dans l'ERP.
 *
 * Jean-Baptiste a tranche : « celle du classeur fait foi ».
 *
 * ⛔ LE PERIMETRE EST ETROIT, ET DELIBEREMENT
 *
 * Le classeur porte des INGREDIENTS et des QUANTITES. Il ne dit rien de la
 * perte de cuisson, du taux de casse, du statut, ni de l'allegation « sans
 * gluten ». Cette migration ne remplace donc QUE les lignes et le rendement
 * de reference ; le reste de la fiche est laisse tel qu'il est.
 *
 * Ecraser `sansGluten` depuis un libelle de feuille reviendrait a decider une
 * allegation reglementaire sans fiche technique. La regle de la maison est
 * explicite : « ne jamais ecrire sans gluten sans reserve ».
 *
 * ⛔ LES INGREDIENTS CREES NAISSENT « NON DOCUMENTES »
 *
 * Neuf ingredients du classeur n'existent pas dans l'ERP. Ils sont crees avec
 * `allergenes: []` ET `allergenesVerifies: false`. C'est la seule facon
 * honnete : un tableau vide avec `verifies = true` affirmerait qu'ils ne
 * contiennent aucun des quatorze allergenes, ce que personne n'a verifie.
 *
 * ⛔ IL NE CREE AUCUNE RECETTE
 *
 * Une recette absente de l'ERP est SIGNALEE, pas creee : lui inventer un
 * code, un type de pate et une allegation depuis un export de classeur
 * produirait une fiche que personne n'a relue. Le rapport la nomme.
 */

import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { creerBase, fermerBase, type BaseBatte } from '../client.js';
import { ingredient, recette, recetteLigne } from '../schema.js';

export type LigneRecetteSource = {
  ingredientNom: string;
  quantiteUniteRef: number;
  uniteReference: string;
  categorieSiACreer: string;
};

export type RecetteSource = {
  code: string;
  rendementReferenceMl: number | null;
  lignes: LigneRecetteSource[];
};

export type RapportRecettes = {
  ingredientsCrees: number;
  recettesMisesAJour: number;
  recettesIgnorees: number;
  lignesEcrites: number;
  lignesIgnorees: number;
  motifs: string[];
};

const CATEGORIES = new Set([
  'farine',
  'laitier',
  'oeuf',
  'sucre',
  'garniture',
  'consommable',
  'gaz',
  'boisson',
  'aromate',
]);
const UNITES = new Set(['g', 'ml', 'piece']);

/** Identifiant lisible et stable, derive du nom. */
function identifiant(nom: string, prefixe: string): string {
  const base = nom
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${prefixe}-${base.slice(0, 44) || 'sans-nom'}`;
}

export function importerRecettes(
  base: BaseBatte,
  sources: readonly RecetteSource[],
): RapportRecettes {
  const maintenant = new Date().toISOString();
  const rapport: RapportRecettes = {
    ingredientsCrees: 0,
    recettesMisesAJour: 0,
    recettesIgnorees: 0,
    lignesEcrites: 0,
    lignesIgnorees: 0,
    motifs: [],
  };

  base.transaction((tx) => {
    /* ---- 1. les ingredients manquants ---------------------------------- */
    const parNom = new Map(
      tx
        .select({ id: ingredient.id, nom: ingredient.nom })
        .from(ingredient)
        .all()
        .map((i) => [i.nom, i.id] as const),
    );

    for (const src of sources) {
      for (const l of src.lignes) {
        if (parNom.has(l.ingredientNom)) continue;
        const categorie = CATEGORIES.has(l.categorieSiACreer) ? l.categorieSiACreer : 'aromate';
        const unite = UNITES.has(l.uniteReference) ? l.uniteReference : 'g';
        const id = identifiant(l.ingredientNom, 'ing');
        tx.insert(ingredient)
          .values({
            id,
            nom: l.ingredientNom,
            categorie: categorie as
              | 'farine'
              | 'laitier'
              | 'oeuf'
              | 'sucre'
              | 'garniture'
              | 'consommable'
              | 'gaz'
              | 'boisson'
              | 'aromate',
            uniteReference: unite as 'g' | 'ml' | 'piece',
            densiteGParMl: null,
            // ⛔ VIDE ET NON VERIFIE = « non documente ».
            // Un tableau vide avec `verifies = true` affirmerait l'absence
            // des quatorze allergenes, ce que personne n'a controle.
            allergenes: [],
            allergenesVerifies: false,
            stockSecurite: 0,
            actif: true,
            notes: 'Cree par la migration du classeur — allergenes a documenter.',
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();
        parNom.set(l.ingredientNom, id);
        rapport.ingredientsCrees += 1;
      }
    }

    /* ---- 2. les lignes de recette -------------------------------------- */
    for (const src of sources) {
      const cible = tx
        .select({ id: recette.id })
        .from(recette)
        .where(eq(recette.code, src.code))
        .get();

      if (!cible) {
        rapport.recettesIgnorees += 1;
        rapport.motifs.push(
          `recette « ${src.code} » absente de l'ERP : aucune fiche a mettre a jour. ` +
            `Elle n'est PAS creee — un code, un type de pate et une allegation ` +
            `inventes depuis un export produiraient une fiche que personne n'a relue.`,
        );
        rapport.lignesIgnorees += src.lignes.length;
        continue;
      }

      // ⛔ On remplace les lignes, on ne les cumule pas. `recette_ligne` porte
      // un index unique (recette_id, ingredient_id) : reinserer sans vider
      // leverait une contrainte SQLite brute au lieu d'un message clair.
      tx.delete(recetteLigne).where(eq(recetteLigne.recetteId, cible.id)).run();

      let ordre = 0;
      for (const l of src.lignes) {
        const ingId = parNom.get(l.ingredientNom);
        if (!ingId) {
          rapport.lignesIgnorees += 1;
          rapport.motifs.push(
            `${src.code} / « ${l.ingredientNom} » : ingredient introuvable et non cree`,
          );
          continue;
        }
        ordre += 1;
        tx.insert(recetteLigne)
          .values({
            id: `${cible.id}--${ingId}`,
            recetteId: cible.id,
            ingredientId: ingId,
            quantiteUniteRef: l.quantiteUniteRef,
            ordre,
            noteTechnique: null,
          })
          .run();
        rapport.lignesEcrites += 1;
      }

      // ⛔ SEUL LE RENDEMENT SUIT LES LIGNES. Pertes, statut, type de pate et
      // `sansGluten` restent ceux de l'ERP : le classeur ne les porte pas.
      if (src.rendementReferenceMl && src.rendementReferenceMl > 0) {
        tx.update(recette)
          .set({ rendementReferenceMl: src.rendementReferenceMl, modifieLe: maintenant })
          .where(eq(recette.id, cible.id))
          .run();
      }
      rapport.recettesMisesAJour += 1;
    }
  });

  return rapport;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Entree en ligne de commande
   ═══════════════════════════════════════════════════════════════════════════ */

function argument(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function principal(): void {
  const chemin = argument('recettes');
  const aBlanc = process.argv.includes('--a-blanc');
  if (!chemin) {
    console.error('Usage : importer-recettes.ts --recettes <f.json> [--a-blanc]');
    process.exit(2);
  }

  const brut = JSON.parse(readFileSync(chemin, 'utf-8')) as {
    recettes: RecetteSource[];
    reserves?: string[];
  };
  const sources = brut.recettes ?? [];
  const attendu = sources.reduce((n, r) => n + r.lignes.length, 0);
  console.log(`Source : ${sources.length} recette(s), ${attendu} ligne(s).`);

  const base = creerBase();
  try {
    if (aBlanc) {
      for (const s of sources) {
        const cible = base
          .select({ id: recette.id, nom: recette.nom })
          .from(recette)
          .where(eq(recette.code, s.code))
          .get();
        console.log(
          `  ${s.code} -> ${cible ? `« ${cible.nom} »` : '⛔ ABSENTE de l ERP'} ` +
            `(${s.lignes.length} ligne(s))`,
        );
      }
      console.log('Rien ecrit.');
      return;
    }

    const r = importerRecettes(base, sources);
    console.log(`\nIngredients crees   : ${r.ingredientsCrees}`);
    console.log(`Recettes mises a jour: ${r.recettesMisesAJour}`);
    console.log(`Recettes ignorees    : ${r.recettesIgnorees}`);
    console.log(`Lignes ecrites       : ${r.lignesEcrites}`);
    console.log(`Lignes ignorees      : ${r.lignesIgnorees}`);

    // ⛔ L'EGALITE QUI INTERDIT LA PERTE SILENCIEUSE.
    if (r.lignesEcrites + r.lignesIgnorees !== attendu) {
      console.error(
        `\n⛔ COMPTE FAUX : ${attendu} lignes en source, ` +
          `${r.lignesEcrites + r.lignesIgnorees} traitees.`,
      );
      process.exit(1);
    }
    console.log(`✓ compte juste : ${attendu} = ${r.lignesEcrites} + ${r.lignesIgnorees}`);

    if (r.motifs.length) {
      console.log(`\n${r.motifs.length} signalement(s) :`);
      for (const m of r.motifs) console.log(`  - ${m}`);
    }
    if (r.ingredientsCrees > 0) {
      console.log(
        `\n⚠ ${r.ingredientsCrees} ingredient(s) cree(s) avec des allergenes ` +
          `NON DOCUMENTES. Ils doivent etre renseignes avant toute fiche ` +
          `allergenes ou allegation « sans gluten ».`,
      );
    }
  } finally {
    fermerBase(base);
  }
}

if (process.argv[1]?.includes('importer-recettes')) {
  principal();
}
