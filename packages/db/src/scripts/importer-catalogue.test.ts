/**
 * L'import du catalogue fournisseurs ne perd rien, et il le prouve.
 *
 * ⛔ POURQUOI CE FICHIER EXISTE
 *
 * L'usine a collecte 22 353 lignes de catalogue chez 223 fournisseurs. Le
 * premier pont vers l'ERP (`exporter_erp.py`) n'en faisait entrer que 1 081 :
 * il exigeait une contenance ET un rattachement a l'un des 19 ingredients du
 * referentiel, et jetait tout le reste en silence.
 *
 * La consigne du porteur, le 18/08/2026, est l'inverse et elle est litterale :
 * « c'est imperatif de conserver 100 % des fournisseurs, produits et
 * categories ». Une perte n'est donc pas un compromis acceptable ici — c'est
 * un echec.
 *
 * ⛔ CE QUE CES TESTS VERIFIENT, ET POURQUOI CHACUN
 *
 * Le compte, d'abord : autant de lignes en base que dans la source. C'est le
 * seul test qui attrape une perte SILENCIEUSE, celle ou l'import se termine
 * sans erreur en ayant laisse des lignes derriere lui.
 *
 * Puis les cas que le pont precedent jetait : la ligne sans prix (le catalogue
 * Covr n'en porte aucun), la ligne sans contenance (11 717 lignes mesurees),
 * la ligne sans rattachement (le cas majoritaire). Chacun doit entrer avec sa
 * colonne vide plutot que de disparaitre.
 *
 * Enfin l'idempotence : un import relance deux fois ne doit pas doubler les
 * lignes. Sans elle, la premiere erreur d'exploitation serait irreversible —
 * et « rien ne s'efface » (regle n°7) interdit de nettoyer par un DELETE.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { catalogueProduit, fournisseur, ingredient } from '../schema.js';
import {
  importerCatalogue,
  type LigneCatalogueSource,
  type FournisseurSource,
} from './importer-catalogue.js';

/** Deux fournisseurs, dont un sans email : le classeur en porte beaucoup. */
const FOURNISSEURS: FournisseurSource[] = [
  {
    id: 'moulin-boland',
    nom: 'Moulin Boland',
    type: 'moulin',
    email: 'info@moulinboland.be',
    telephone: null,
    adresse: null,
    delaiLivraisonJours: null,
    francoDePortCents: null,
    commandeMinimumCents: null,
    notes: '[categorie-classeur] Farines',
    categorieClasseur: 'Farines',
  },
  {
    id: 'biopack',
    nom: 'Biopack',
    type: 'grossiste',
    email: null,
    telephone: null,
    adresse: null,
    delaiLivraisonJours: null,
    francoDePortCents: null,
    commandeMinimumCents: null,
    notes: '[categorie-classeur] Emballages',
    categorieClasseur: 'Emballages',
  },
];

/**
 * Quatre lignes choisies pour couvrir les quatre cas que l'ancien pont
 * jetait — et une cinquieme, complete, qui doit passer comme avant.
 */
const CATALOGUE: LigneCatalogueSource[] = [
  {
    id: 'l-complete',
    fournisseurId: 'moulin-boland',
    ingredientNom: null,
    referenceFournisseur: 'T55-25',
    designation: 'Farine T55 Mistral',
    conditionnementTexte: 'Sac 25 kg',
    quantiteUniteRef: 25000,
    uniteReference: 'g',
    prixCents: 2600,
    tauxTvaBps: 600,
    datePrix: '2026-08-18',
    source: 'run-a/catalogue.pdf',
    notes: null,
  },
  {
    id: 'l-sans-prix',
    fournisseurId: 'biopack',
    ingredientNom: null,
    referenceFournisseur: 'COVR-15PE',
    designation: 'Assiette bagasse 23 cm',
    conditionnementTexte: 'carton de 500',
    quantiteUniteRef: 500,
    uniteReference: 'piece',
    prixCents: null, // le catalogue Covr ne porte AUCUN prix
    tauxTvaBps: null,
    datePrix: '2026-08-18',
    source: 'run-a/covr.pdf',
    notes: null,
  },
  {
    id: 'l-sans-contenance',
    fournisseurId: 'biopack',
    ingredientNom: null,
    referenceFournisseur: 'DWJ1',
    designation: 'Boissons sans alcool',
    conditionnementTexte: null,
    quantiteUniteRef: null, // rien dans le catalogue ne la dit
    uniteReference: null,
    prixCents: 315,
    tauxTvaBps: null,
    datePrix: '2026-08-18',
    source: 'run-a/vajra.pdf',
    notes: null,
  },
  {
    id: 'l-sans-reference',
    fournisseurId: 'moulin-boland',
    ingredientNom: null,
    referenceFournisseur: null,
    designation: 'Farine de sarrasin bio',
    conditionnementTexte: null,
    quantiteUniteRef: null,
    uniteReference: null,
    prixCents: null,
    tauxTvaBps: null,
    datePrix: '2026-08-18',
    source: 'run-b/tarif.pdf',
    notes: null,
  },
];

describe('Import du catalogue fournisseurs — 100 % ou echec', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  /* ═══════════════════════════════════════════════════════════════════════
     1. Le compte — le seul test qui attrape une perte silencieuse
     ═══════════════════════════════════════════════════════════════════════ */

  it('fait entrer AUTANT de lignes que la source en contient', () => {
    const rapport = importerCatalogue(base, FOURNISSEURS, CATALOGUE);

    const enBase = base
      .select({ n: sql<number>`count(*)` })
      .from(catalogueProduit)
      .get()!.n;

    expect(enBase).toBe(CATALOGUE.length);
    expect(rapport.cataloguesInseres + rapport.cataloguesIgnores).toBe(CATALOGUE.length);
    expect(rapport.cataloguesIgnores).toBe(0);
  });

  it('fait entrer tous les fournisseurs, avec leur categorie de classeur', () => {
    importerCatalogue(base, FOURNISSEURS, CATALOGUE);

    const n = base
      .select({ n: sql<number>`count(*)` })
      .from(fournisseur)
      .get()!.n;
    expect(n).toBe(FOURNISSEURS.length);

    const boland = base
      .select()
      .from(fournisseur)
      .where(eq(fournisseur.id, 'moulin-boland'))
      .get()!;
    // La categorie metier ne survit que la : `type` ne connait que quatre valeurs.
    expect(boland.notes).toContain('Farines');
  });

  /* ═══════════════════════════════════════════════════════════════════════
     2. Les quatre cas que l'ancien pont jetait
     ═══════════════════════════════════════════════════════════════════════ */

  it('garde la ligne SANS PRIX au lieu de la jeter', () => {
    importerCatalogue(base, FOURNISSEURS, CATALOGUE);
    const l = base
      .select()
      .from(catalogueProduit)
      .where(eq(catalogueProduit.referenceFournisseur, 'COVR-15PE'))
      .get();
    expect(l).toBeDefined();
    expect(l!.prixCents).toBeNull();
    expect(l!.designation).toBe('Assiette bagasse 23 cm');
  });

  it('garde la ligne SANS CONTENANCE au lieu de la jeter', () => {
    importerCatalogue(base, FOURNISSEURS, CATALOGUE);
    const l = base
      .select()
      .from(catalogueProduit)
      .where(eq(catalogueProduit.referenceFournisseur, 'DWJ1'))
      .get();
    expect(l).toBeDefined();
    expect(l!.quantiteUniteRef).toBeNull();
    expect(l!.uniteReference).toBeNull();
    expect(l!.prixCents).toBe(315);
  });

  it('garde la ligne SANS REFERENCE au lieu de la jeter', () => {
    importerCatalogue(base, FOURNISSEURS, CATALOGUE);
    const l = base
      .select()
      .from(catalogueProduit)
      .where(eq(catalogueProduit.designation, 'Farine de sarrasin bio'))
      .get();
    expect(l).toBeDefined();
    expect(l!.referenceFournisseur).toBeNull();
  });

  it('garde le texte de conditionnement tel que le fournisseur l ecrit', () => {
    importerCatalogue(base, FOURNISSEURS, CATALOGUE);
    const l = base
      .select()
      .from(catalogueProduit)
      .where(eq(catalogueProduit.referenceFournisseur, 'T55-25'))
      .get()!;
    expect(l.conditionnementTexte).toBe('Sac 25 kg');
    expect(l.quantiteUniteRef).toBe(25000);
    expect(l.uniteReference).toBe('g');
  });

  /* ═══════════════════════════════════════════════════════════════════════
     3. L'idempotence — un import relance ne double rien
     ═══════════════════════════════════════════════════════════════════════ */

  it('relance sans doubler : deux imports donnent le meme compte', () => {
    importerCatalogue(base, FOURNISSEURS, CATALOGUE);
    const apresUn = base
      .select({ n: sql<number>`count(*)` })
      .from(catalogueProduit)
      .get()!.n;

    const rapport = importerCatalogue(base, FOURNISSEURS, CATALOGUE);
    const apresDeux = base
      .select({ n: sql<number>`count(*)` })
      .from(catalogueProduit)
      .get()!.n;

    expect(apresDeux).toBe(apresUn);
    expect(rapport.cataloguesMisAJour).toBe(CATALOGUE.length);
    expect(rapport.cataloguesInseres).toBe(0);
  });

  it('met a jour un prix qui a change, sans creer de seconde ligne', () => {
    importerCatalogue(base, FOURNISSEURS, CATALOGUE);
    const modifie = CATALOGUE.map((l) => (l.id === 'l-complete' ? { ...l, prixCents: 2750 } : l));
    importerCatalogue(base, FOURNISSEURS, modifie);

    const lignes = base
      .select()
      .from(catalogueProduit)
      .where(eq(catalogueProduit.referenceFournisseur, 'T55-25'))
      .all();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.prixCents).toBe(2750);
  });

  it('ne redouble PAS le marqueur de categorie a chaque reimport', () => {
    // ⛔ CONSTATE EN BASE LE 18/08/2026, APRES LE PREMIER IMPORT REEL :
    //     [categorie-classeur] Emballages ... [categorie-classeur] Emballages
    // L'export Python pose deja le marqueur dans `notes` ; l'importeur le
    // reposait par-dessus. A chaque relance, une ligne de plus.
    //
    // Le test d'idempotence qui existait ne comptait que les LIGNES : il
    // passait au vert pendant que le champ enflait. Un compte juste ne dit
    // rien du contenu.
    importerCatalogue(base, FOURNISSEURS, CATALOGUE);
    importerCatalogue(base, FOURNISSEURS, CATALOGUE);
    importerCatalogue(base, FOURNISSEURS, CATALOGUE);

    const f = base.select().from(fournisseur).where(eq(fournisseur.id, 'biopack')).get()!;
    const occurrences = (f.notes ?? '').split('[categorie-classeur]').length - 1;
    expect(occurrences).toBe(1);
    expect(f.notes).toContain('Emballages');
  });

  /* ═══════════════════════════════════════════════════════════════════════
     4. Ce qui ne doit PAS entrer — et qui doit etre nomme
     ═══════════════════════════════════════════════════════════════════════ */

  it('refuse une ligne dont le fournisseur est absent, et la NOMME', () => {
    const orpheline: LigneCatalogueSource = {
      ...CATALOGUE[0]!,
      id: 'l-orpheline',
      fournisseurId: 'fournisseur-inexistant',
      referenceFournisseur: 'ORPH-1',
    };
    const rapport = importerCatalogue(base, FOURNISSEURS, [...CATALOGUE, orpheline]);

    expect(rapport.cataloguesIgnores).toBe(1);
    // Nommee, pas juste comptee : sans le motif, on ne sait pas quoi corriger.
    expect(rapport.motifs.join(' ')).toContain('ORPH-1');
    expect(rapport.cataloguesInseres).toBe(CATALOGUE.length);
  });

  it('ne touche pas aux ingredients existants', () => {
    const avant = base
      .select({ n: sql<number>`count(*)` })
      .from(ingredient)
      .get()!.n;
    importerCatalogue(base, FOURNISSEURS, CATALOGUE);
    const apres = base
      .select({ n: sql<number>`count(*)` })
      .from(ingredient)
      .get()!.n;
    expect(apres).toBe(avant);
  });
});
