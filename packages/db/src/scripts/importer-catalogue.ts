/**
 * Import des fournisseurs et de leur catalogue, depuis l'usine a devis.
 *
 *     npx tsx packages/db/src/scripts/importer-catalogue.ts \
 *         --fournisseurs <chemin.json> --catalogue <chemin.json>
 *     ... --a-blanc     # compte et controle, n'ecrit rien
 *
 * ⛔ CE QU'IL FAIT ENTRER, ET POURQUOI PAS DANS `conditionnement`
 *
 * `conditionnement` decrit ce qu'on ACHETE pour un ingredient du referentiel :
 * `ingredient_id` NOT NULL, contenance NOT NULL. Un catalogue fournisseur est
 * autre chose — c'est tout ce que la maison vend, dont l'immense majorite ne
 * correspond a aucun des ingredients de l'ERP.
 *
 * Mesure du 18/08/2026 : 22 353 lignes collectees, 9 545 uniques, dont 4 724
 * sans contenance et 5 652 sans prix. Le pont precedent n'en faisait entrer
 * que 1 081 — 95 % de la matiere commerciale perdue en silence.
 *
 * Elles arrivent donc dans `catalogue_produit`, ou contenance et prix sont
 * nullables. Une ligne incomplete entre avec ses trous VISIBLES ; elle ne
 * disparait pas.
 *
 * ⛔ IDEMPOTENT PAR CONSTRUCTION
 *
 * L'identifiant d'une ligne est deterministe (il vient de l'export). Relancer
 * l'import met a jour, il ne duplique pas. C'est indispensable ici : « rien
 * ne s'efface » (regle n°7) interdit de nettoyer par un DELETE, donc un
 * import qui doublerait serait irreversible.
 *
 * ⛔ IL NE JETTE QU'UN SEUL CAS, ET IL LE NOMME
 *
 * Une ligne dont le fournisseur n'existe pas viole la cle etrangere : il n'y
 * a pas d'ancrage possible. Elle est comptee ET nommee dans le rapport, avec
 * sa reference, pour qu'on sache quoi corriger. Tout autre manque produit une
 * colonne vide.
 */

import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { creerBase, fermerBase, type BaseBatte } from '../client.js';
import { catalogueProduit, fournisseur } from '../schema.js';

/** Un fournisseur tel que `exporter_erp.py` le produit. */
export type FournisseurSource = {
  id: string;
  nom: string;
  type: string;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  delaiLivraisonJours: number | null;
  francoDePortCents: number | null;
  commandeMinimumCents: number | null;
  notes: string | null;
  /** La categorie du classeur — 21 valeurs, la ou `type` n'en connait que 4. */
  categorieClasseur?: string | null;
};

/** Une ligne de catalogue telle que `exporter_catalogue_erp.py` la produit. */
export type LigneCatalogueSource = {
  id: string;
  fournisseurId: string;
  ingredientNom: string | null;
  referenceFournisseur: string | null;
  designation: string;
  conditionnementTexte: string | null;
  quantiteUniteRef: number | null;
  uniteReference: string | null;
  prixCents: number | null;
  tauxTvaBps: number | null;
  datePrix: string;
  source: string;
  notes: string | null;
};

export type RapportImport = {
  fournisseursInseres: number;
  fournisseursMisAJour: number;
  cataloguesInseres: number;
  cataloguesMisAJour: number;
  cataloguesIgnores: number;
  /** Un motif par ligne ecartee. Jamais un compte sans les noms. */
  motifs: string[];
};

/** Le marqueur qui rend la categorie retrouvable par recherche de texte. */
const MARQUEUR_CATEGORIE = '[categorie-classeur]';

const TYPES_ERP = new Set(['moulin', 'grossiste', 'ferme', 'detail', 'systeme']);
const UNITES_ERP = new Set(['g', 'ml', 'piece']);

/**
 * Verse fournisseurs puis catalogue, dans une seule transaction.
 *
 * Tout ou rien : un import a moitie applique laisserait la base dans un etat
 * qu'aucun compte ne decrit, et « rien ne s'efface » rendrait le nettoyage
 * impossible.
 */
export function importerCatalogue(
  base: BaseBatte,
  fournisseurs: readonly FournisseurSource[],
  lignes: readonly LigneCatalogueSource[],
): RapportImport {
  const maintenant = new Date().toISOString();
  const rapport: RapportImport = {
    fournisseursInseres: 0,
    fournisseursMisAJour: 0,
    cataloguesInseres: 0,
    cataloguesMisAJour: 0,
    cataloguesIgnores: 0,
    motifs: [],
  };

  base.transaction((tx) => {
    /* ---- 1. les fournisseurs ------------------------------------------- */
    for (const f of fournisseurs) {
      // Un type inconnu ne fait pas perdre le fournisseur : il devient
      // `grossiste`, et la categorie d'origine reste dans les notes.
      const type = TYPES_ERP.has(f.type) ? f.type : 'grossiste';
      // ⛔ LE MARQUEUR NE SE REPOSE PAS S'IL EST DEJA LA.
      // Constate en base le 18/08/2026 apres le premier import reel : la
      // categorie apparaissait DEUX fois, parce que l'export Python pose
      // deja le marqueur et que l'importeur le reposait par dessus. A
      // chaque relance, une ligne de plus — et le test d'idempotence ne
      // comptait que les LIGNES, jamais le contenu du champ.
      const dejaMarque = (f.notes ?? '').includes(MARQUEUR_CATEGORIE);
      const notes =
        f.categorieClasseur && !dejaMarque
          ? `${MARQUEUR_CATEGORIE} ${f.categorieClasseur}\n${f.notes ?? ''}`.slice(0, 4000)
          : f.notes;

      const existant = tx
        .select({ id: fournisseur.id })
        .from(fournisseur)
        .where(eq(fournisseur.id, f.id))
        .get();

      const valeurs = {
        nom: f.nom,
        type: type as 'moulin' | 'grossiste' | 'ferme' | 'detail' | 'systeme',
        email: f.email,
        telephone: f.telephone,
        adresse: f.adresse,
        delaiLivraisonJours: f.delaiLivraisonJours ?? 0,
        francoDePortCents: f.francoDePortCents,
        commandeMinimumCents: f.commandeMinimumCents,
        notes,
        modifieLe: maintenant,
      };

      if (existant) {
        tx.update(fournisseur).set(valeurs).where(eq(fournisseur.id, f.id)).run();
        rapport.fournisseursMisAJour += 1;
      } else {
        tx.insert(fournisseur).values({ id: f.id, ...valeurs, creeLe: maintenant }).run();
        rapport.fournisseursInseres += 1;
      }
    }

    /* ---- 2. le catalogue ------------------------------------------------ */
    const connus = new Set(
      tx.select({ id: fournisseur.id }).from(fournisseur).all().map((r) => r.id),
    );

    for (const l of lignes) {
      if (!connus.has(l.fournisseurId)) {
        rapport.cataloguesIgnores += 1;
        rapport.motifs.push(
          `${l.referenceFournisseur ?? l.designation} : fournisseur « ${l.fournisseurId} » absent, aucun ancrage`,
        );
        continue;
      }

      // Une unite hors des trois de l'ERP n'invalide pas la ligne : on la
      // laisse vide plutot que d'ecrire une valeur que rien ne sait relire.
      const unite =
        l.uniteReference && UNITES_ERP.has(l.uniteReference)
          ? (l.uniteReference as 'g' | 'ml' | 'piece')
          : null;

      const valeurs = {
        fournisseurId: l.fournisseurId,
        ingredientId: null,
        referenceFournisseur: l.referenceFournisseur,
        designation: l.designation,
        conditionnementTexte: l.conditionnementTexte,
        quantiteUniteRef: unite ? l.quantiteUniteRef : null,
        uniteReference: unite,
        prixCents: l.prixCents,
        tauxTvaBps: l.tauxTvaBps,
        datePrix: l.datePrix,
        source: l.source,
        notes: l.notes,
        modifieLe: maintenant,
      };

      const existant = tx
        .select({ id: catalogueProduit.id })
        .from(catalogueProduit)
        .where(eq(catalogueProduit.id, l.id))
        .get();

      if (existant) {
        tx.update(catalogueProduit).set(valeurs).where(eq(catalogueProduit.id, l.id)).run();
        rapport.cataloguesMisAJour += 1;
      } else {
        tx.insert(catalogueProduit)
          .values({ id: l.id, ...valeurs, creeLe: maintenant })
          .run();
        rapport.cataloguesInseres += 1;
      }
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
  const cheminF = argument('fournisseurs');
  const cheminC = argument('catalogue');
  const aBlanc = process.argv.includes('--a-blanc');

  if (!cheminF || !cheminC) {
    console.error(
      'Usage : importer-catalogue.ts --fournisseurs <f.json> --catalogue <c.json> [--a-blanc]',
    );
    process.exit(2);
  }

  const fournisseurs = JSON.parse(readFileSync(cheminF, 'utf-8')) as FournisseurSource[];
  const lignes = JSON.parse(readFileSync(cheminC, 'utf-8')) as LigneCatalogueSource[];

  console.log(`Source : ${fournisseurs.length} fournisseurs, ${lignes.length} lignes.`);

  if (aBlanc) {
    // ⛔ Le controle a blanc ne se contente pas de compter : il verifie
    // l'ancrage, qui est le SEUL motif de rejet possible a l'import.
    const ids = new Set(fournisseurs.map((f) => f.id));
    const orphelines = lignes.filter((l) => !ids.has(l.fournisseurId));
    console.log(`A blanc : ${orphelines.length} ligne(s) sans ancrage.`);
    for (const o of orphelines.slice(0, 5)) {
      console.log(`  - ${o.referenceFournisseur ?? o.designation} -> ${o.fournisseurId}`);
    }
    console.log('Rien ecrit.');
    return;
  }

  const base = creerBase();
  try {
    const avant = base
      .select({ n: sql<number>`count(*)` })
      .from(catalogueProduit)
      .get()!.n;

    const r = importerCatalogue(base, fournisseurs, lignes);

    const apres = base
      .select({ n: sql<number>`count(*)` })
      .from(catalogueProduit)
      .get()!.n;

    console.log(
      `\nFournisseurs : ${r.fournisseursInseres} crees, ${r.fournisseursMisAJour} mis a jour.`,
    );
    console.log(
      `Catalogue    : ${r.cataloguesInseres} crees, ${r.cataloguesMisAJour} mis a jour, ` +
        `${r.cataloguesIgnores} ignores.`,
    );
    console.log(`Lignes en base : ${avant} -> ${apres}`);

    // ⛔ L'EGALITE QUI INTERDIT LA PERTE SILENCIEUSE.
    const traitees = r.cataloguesInseres + r.cataloguesMisAJour + r.cataloguesIgnores;
    if (traitees !== lignes.length) {
      console.error(
        `\n⛔ COMPTE FAUX : ${lignes.length} lignes en source, ${traitees} traitees.`,
      );
      process.exit(1);
    }
    console.log(
      `✓ compte juste : ${lignes.length} = ${r.cataloguesInseres} + ` +
        `${r.cataloguesMisAJour} + ${r.cataloguesIgnores}`,
    );

    if (r.motifs.length) {
      console.log(`\n${r.motifs.length} ligne(s) ecartee(s), toutes nommees :`);
      for (const m of r.motifs.slice(0, 10)) console.log(`  - ${m}`);
    }
  } finally {
    fermerBase(base);
  }
}

// `tsx` execute le module directement : pas d'equivalent fiable de
// `require.main === module` en ESM, on teste l'argument de lancement.
if (process.argv[1]?.includes('importer-catalogue')) {
  principal();
}
