/**
 * Tests des exports Excel du Lot 6.
 *
 * Trois choses a verifier, non negociables (CLAUDE.md §7, docs/07 §4.5) :
 *  - le classeur produit est relisible par ExcelJS ;
 *  - un montant est ecrit comme un NOMBRE, jamais comme du texte ;
 *  - une valeur ABSENTE reste une cellule VIDE, jamais `0` ni un tiret.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { creerBase, migrer, schema, type BaseBatte } from '@batte/db';
import { eq } from 'drizzle-orm';
import {
  archiverExportExcel,
  exportJournalAchats,
  exportJournalRecettes,
  exportMouvementsStock,
  exportStockValorise,
} from './excel.js';

/**
 * Relit un classeur depuis ses octets, pour verifier ce qu'ExcelJS y a
 * vraiment ecrit.
 *
 * Le passage par `unknown as never` contourne le meme defaut de typage
 * d'ExcelJS que `excel.ts::serialiser` : `load()` attend un `Buffer` LOCAL a
 * son propre module (un shim minimal `extends ArrayBuffer`), impossible a
 * nommer depuis l'exterieur, et structurellement different du vrai `Buffer`
 * Node que produisent nos exports.
 */
async function relire(octets: Buffer): Promise<ExcelJS.Workbook> {
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(octets as unknown as never);
  return classeur;
}

const DATE_EXPORT = new Date('2026-08-02T08:00:00Z');

describe('Lot 6 — export « Stock valorisé »', () => {
  it('produit un classeur relisible, avec montants numériques et absence vide', async () => {
    const octets = await exportStockValorise({
      dateExport: DATE_EXPORT,
      periodeCouverte: 'Au 2 août 2026',
      lignes: [
        {
          ingredientNom: 'Farine T55',
          unite: 'g',
          quantiteDisponible: 4200,
          cumpCentsParUnite: 0.6,
          valeurCents: 2520,
          stockSecurite: 5000,
          dlcLaPlusProche: '2026-09-01',
          nbLots: 2,
        },
        {
          // Stock épuisé : CUMP absent (`null`), valeur réellement nulle (`0`).
          // Ce ne sont PAS la même information (docs/07 §4.5, docs/07 §6.2).
          ingredientNom: 'Sirop d’érable',
          unite: 'piece',
          quantiteDisponible: 0,
          cumpCentsParUnite: null,
          valeurCents: 0,
          stockSecurite: 6,
          dlcLaPlusProche: null,
          nbLots: 0,
        },
      ],
    });

    expect(octets.byteLength).toBeGreaterThan(0);

    const classeur = await relire(octets);
    expect(classeur.getWorksheet('Informations')).toBeDefined();

    const feuille = classeur.getWorksheet('Stock valorisé');
    expect(feuille).toBeDefined();
    expect(feuille!.getRow(1).getCell(1).value).toBe('Ingrédient');

    const ligneFarine = feuille!.getRow(2);
    expect(typeof ligneFarine.getCell(4).value).toBe('number'); // CUMP
    expect(typeof ligneFarine.getCell(5).value).toBe('number'); // Valeur
    expect(ligneFarine.getCell(5).value).toBe(25.2);

    const ligneSirop = feuille!.getRow(3);
    // Valeur absente : cellule VIDE, jamais 0.
    expect(ligneSirop.getCell(4).value).toBeNull();
    // Valeur réellement nulle : le zéro EST écrit.
    expect(ligneSirop.getCell(5).value).toBe(0);
    expect(ligneSirop.getCell(7).value).toBeNull(); // DLC absente
  });

  it("n'affiche PAS la mention de franchise de TVA : ce n'est pas un document commercial", async () => {
    const octets = await exportStockValorise({
      dateExport: DATE_EXPORT,
      periodeCouverte: 'Au 2 août 2026',
      lignes: [],
    });
    const classeur = await relire(octets);
    const info = classeur.getWorksheet('Informations')!;
    const texteInfo = info
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
    expect(texteInfo).not.toContain('franchise');
  });
});

describe('Lot 6 — export « Journal des recettes »', () => {
  it('produit un classeur avec la ventilation transformé/revendu et la mention TVA', async () => {
    const octets = await exportJournalRecettes({
      dateExport: DATE_EXPORT,
      periodeCouverte: 'Année 2026',
      lignes: [
        {
          numero: 'SM-2026-0001',
          dateSession: '2026-08-02',
          lieuNom: 'La Batte',
          caTotalCents: 83_800,
          caTransformeCents: 60_000,
          caRevenduCents: 23_800,
          caEspecesCents: 50_000,
          caCarteCents: 33_800,
          ecartCaisseCents: 0,
        },
      ],
    });

    const classeur = await relire(octets);
    const feuille = classeur.getWorksheet('Journal des recettes');
    expect(feuille).toBeDefined();

    const ligne = feuille!.getRow(2);
    expect(ligne.getCell(1).value).toBe('SM-2026-0001');
    expect(ligne.getCell(2).value).toBeInstanceOf(Date); // Date Excel, pas du texte
    expect(typeof ligne.getCell(4).value).toBe('number');
    expect(ligne.getCell(4).value).toBe(838);

    const info = classeur.getWorksheet('Informations')!;
    const texteInfo = info
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
    expect(texteInfo).toContain('franchise');
  });
});

describe('Lot 6 — export « Journal des achats »', () => {
  it('produit une ligne par réception, montant numérique', async () => {
    const octets = await exportJournalAchats({
      dateExport: DATE_EXPORT,
      periodeCouverte: 'Année 2026',
      lignes: [
        {
          numero: 'RC-2026-0001',
          dateReception: '2026-07-30',
          fournisseurNom: 'Moulin de la Meuse',
          montantTotalCents: 12_500,
          nbLots: 3,
        },
      ],
    });

    const classeur = await relire(octets);
    const feuille = classeur.getWorksheet('Journal des achats');
    expect(feuille).toBeDefined();
    const ligne = feuille!.getRow(2);
    expect(ligne.getCell(3).value).toBe('Moulin de la Meuse');
    expect(typeof ligne.getCell(4).value).toBe('number');
    expect(ligne.getCell(4).value).toBe(125);
  });
});

describe('Lot 6 — export « Mouvements de stock »', () => {
  it('conserve les mouvements annulés, marqués et non filtrés', async () => {
    const octets = await exportMouvementsStock({
      dateExport: DATE_EXPORT,
      periodeCouverte: 'Semaine du 27/07/2026',
      lignes: [
        {
          dateMouvement: '2026-08-01',
          type: 'entree',
          ingredientNom: 'Farine T55',
          lot: 'LOT-2026-042',
          quantite: 25_000,
          coutCents: 3_000,
          motif: null,
          isAnnule: false,
        },
        {
          dateMouvement: '2026-08-02',
          type: 'perte',
          ingredientNom: 'Farine T55',
          lot: 'LOT-2026-042',
          quantite: 500,
          coutCents: 60,
          motif: 'CASSE_CUISSON — bac renversé',
          isAnnule: true,
        },
      ],
    });

    const classeur = await relire(octets);
    const feuille = classeur.getWorksheet('Mouvements de stock');
    expect(feuille).toBeDefined();

    const ligne1 = feuille!.getRow(2);
    expect(ligne1.getCell(1).value).toBeInstanceOf(Date);
    expect(ligne1.getCell(2).value).toBe('Entrée');
    expect(ligne1.getCell(7).value).toBeNull(); // motif absent : cellule vide
    expect(ligne1.getCell(8).value).toBe('Non');

    const ligne2 = feuille!.getRow(3);
    expect(ligne2.getCell(2).value).toBe('Perte');
    expect(ligne2.getCell(7).value).toContain('CASSE_CUISSON');
    expect(ligne2.getCell(8).value).toBe('Oui'); // annulé : reste visible, jamais filtré
  });
});

describe('Lot 6 — archivage des exports Excel', () => {
  let base: BaseBatte;
  const cheminsCrees: string[] = [];

  afterAll(() => {
    for (const chemin of cheminsCrees) {
      if (existsSync(chemin)) rmSync(chemin, { force: true });
    }
  });

  it('écrit le classeur sur disque et l’archive avec son empreinte SHA-256', async () => {
    base = creerBase(':memory:');
    migrer(base);

    const octets = await exportStockValorise({
      dateExport: DATE_EXPORT,
      periodeCouverte: 'Au 2 août 2026',
      lignes: [],
    });

    const archive = await archiverExportExcel(base, { objetId: 'stock', numero: null }, octets);
    cheminsCrees.push(archive.chemin);

    expect(archive.type).toBe('export_excel');
    expect(archive.version).toBe(1);
    expect(archive.hashSha256).toHaveLength(64);
    expect(existsSync(archive.chemin)).toBe(true);

    const enBase = base
      .select()
      .from(schema.documentGenere)
      .where(eq(schema.documentGenere.id, archive.id))
      .get()!;
    expect(enBase.type).toBe('export_excel');
    expect(enBase.hashSha256).toBe(archive.hashSha256);
  });

  it('régénérer le même export crée une NOUVELLE VERSION, jamais un écrasement', async () => {
    const octets = await exportStockValorise({
      dateExport: DATE_EXPORT,
      periodeCouverte: 'Au 2 août 2026',
      lignes: [],
    });

    const v1 = await archiverExportExcel(
      base,
      { objetId: 'stock-versionne', numero: null },
      octets,
    );
    const v2 = await archiverExportExcel(
      base,
      { objetId: 'stock-versionne', numero: null },
      octets,
    );
    cheminsCrees.push(v1.chemin, v2.chemin);

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(existsSync(v1.chemin)).toBe(true);
    expect(existsSync(v2.chemin)).toBe(true);
    expect(v1.chemin).not.toBe(v2.chemin);
  });
});
