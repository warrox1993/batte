/**
 * Exports Excel comptables et de stock (`docs/01` modules 2 et 7).
 *
 * Meme discipline que `gabarits.ts` : chaque export est une fonction PURE
 * donnees -> classeur. Aucun acces base ici — les depots fournissent des
 * lignes deja calculees, cette couche ne fait que les mettre en forme. Le
 * classeur est asynchrone a serialiser (ExcelJS), d'ou `Promise<Buffer>` en
 * lieu et place d'un `Buffer` synchrone — la fonction reste pure au sens
 * « aucun effet de bord, sortie deterministe pour une entree donnee ».
 *
 * Typographie des nombres : `docs/07-DOCTRINE-ERP-ET-DESIGN.md` §4.5 vaut en
 * tableur autant qu'a l'ecran. Trois consequences directes ici :
 *  - les nombres QUANTITATIFS (montants, quantites) sont alignes a droite,
 *    les nombres QUALITATIFS (dates, numeros de lot) et le texte a gauche ;
 *  - une valeur ABSENTE reste une cellule VIDE (`null`), jamais `0` ni `—` —
 *    le tiret cadratin de `TIRET_ABSENT` est un artifice d'ECRAN/PDF, il
 *    casserait le type d'une colonne numerique dans un tableur ;
 *  - CLAUDE.md §3 : l'argent est stocke en CENTIMES partout dans
 *    l'application. La division par 100 ne se fait qu'AU MOMENT DE L'ECRITURE
 *    dans la cellule, jamais avant.
 */

import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import type { Unite } from '@batte/core';
import type { BaseBatte } from '@batte/db';
import {
  FUSEAU,
  TYPES_ACTION_ECONOMIE,
  type TableauBordEconomies,
  type TypeActionEconomie,
} from '@batte/core';
import { MENTION_FRANCHISE_TVA, MENTION_NE_REMPLACE_PAS } from './style-impression.js';
import { archiverFichierGenere, type DocumentArchive } from './rendu.js';

/** Format francais des montants : jamais de texte, toujours 2 decimales fixes. */
const FORMAT_MONTANT = '#,##0.00 €';
/** Quantites en unite de reference (g, ml, piece) : toujours entieres. */
const FORMAT_QUANTITE = '#,##0';
const FORMAT_DATE = 'dd/mm/yyyy';

/* ═══════════════════════════════════════════════════════════════════════════
   Mecanique commune de mise en forme — factoree pour que les quatre exports
   partagent EXACTEMENT les memes regles typographiques.
   ═══════════════════════════════════════════════════════════════════════════ */

type AlignementColonne = 'gauche' | 'droite';

type ColonneExport = {
  readonly entete: string;
  readonly largeur: number;
  readonly numFmt?: string;
  readonly alignement: AlignementColonne;
};

/**
 * Cree une feuille tabulaire : colonnes largeurs/format explicites, en-tete
 * fige et en gras, une ligne par entree de `lignes`.
 *
 * L'alignement est applique COLONNE PAR COLONNE, apres l'ajout des lignes :
 * `Column#alignment` et `Column#numFmt` d'ExcelJS s'appliquent a toutes les
 * cellules deja presentes dans la colonne, en-tete compris — c'est exactement
 * la regle « l'en-tete suit l'alignement de sa colonne, jamais de centrage »
 * (docs/07 §4.5), obtenue sans code de mise en forme par cellule.
 */
function ajouterFeuilleTableau(
  classeur: ExcelJS.Workbook,
  nomFeuille: string,
  colonnes: readonly ColonneExport[],
  lignes: readonly ExcelJS.CellValue[][],
): ExcelJS.Worksheet {
  const feuille = classeur.addWorksheet(nomFeuille, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  feuille.columns = colonnes.map((colonne) => ({
    header: colonne.entete,
    width: colonne.largeur,
  }));
  feuille.getRow(1).font = { bold: true };

  for (const ligne of lignes) {
    feuille.addRow(ligne);
  }

  colonnes.forEach((colonne, index) => {
    const colonneExcel = feuille.getColumn(index + 1);
    if (colonne.numFmt !== undefined) colonneExcel.numFmt = colonne.numFmt;
    colonneExcel.alignment = { horizontal: colonne.alignement === 'droite' ? 'right' : 'left' };
  });

  return feuille;
}

/** `null` reste `null` (cellule vide) ; sinon convertit des CENTIMES en euros. */
function centimesEnEuros(centimes: number | null | undefined): number | null {
  return centimes === null || centimes === undefined ? null : centimes / 100;
}

/** Jour civil `AAAA-MM-JJ` -> `Date` Excel. `null` reste `null` (cellule vide). */
function jourCivilEnDateExcel(jourCivil: string | null | undefined): Date | null {
  return jourCivil === null || jourCivil === undefined ? null : new Date(`${jourCivil}T00:00:00Z`);
}

/**
 * DÉFAUT CORRIGÉ (audit `docs/31-DOCUMENTS-OUVERTS.md` §3.3, vérifié
 * empiriquement : un instant UTC connu écrit puis relu au niveau du XML brut
 * du `.xlsx` restituait le jour UTC, jamais le jour belge).
 *
 * Un tableur n'a AUCUNE notion de fuseau horaire : un nombre de série Excel
 * est une grandeur NAÏVE, affichée telle quelle à l'ouverture, quel que soit
 * le fuseau du poste. `jourCivilEnDateExcel` ci-dessus le sait déjà pour un
 * JOUR CIVIL PUR (ancré à minuit UTC, donc jamais affecté : minuit reste le
 * même jour calendaire quel que soit le fuseau). Mais `dateExport` est un
 * INSTANT réel avec une heure — le convertir en Excel sans égard au fuseau
 * restitue le jour ET l'heure UTC, pas ceux de Bruxelles, exactement l'écart
 * mesuré par l'audit (23:05 UTC le 31/07 = 01:05 le 01/08 à Bruxelles, mais
 * la cellule affichait « 31/07/2026 »).
 *
 * Le correctif retenu est de DÉCALER l'instant écrit plutôt que d'écrire une
 * CHAÎNE FORMATÉE à la place d'une date : cette cellule reste ainsi une vraie
 * valeur Excel de type Date (comme toutes les autres dates de ces classeurs),
 * ce qui préserve le tri chronologique, les filtres par date et le `numFmt`
 * déjà en place — une chaîne `« 01/08/2026 01:05 »` les aurait tous perdus
 * (un tri alphabétique sur des dates `jj/mm/aaaa` n'est PAS un tri
 * chronologique), pour un gain nul ici puisqu'aucun outil ne lit plus ce
 * classeur que l'utilisateur lui-même. Même principe déjà appliqué par
 * `jourCivilEnDateExcel` : on construit un `Date` dont les champs UTC portent
 * les chiffres que `Intl.DateTimeFormat` calcule pour Bruxelles — jamais un
 * décalage fixe (`+2h`) qui se tromperait à chaque changement heure d'été /
 * heure d'hiver.
 */
function instantEnDateExcelBruxelles(instant: Date): Date {
  const parties = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSEAU,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const composant = (type: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'): number => {
    const trouve = parties.find((partie) => partie.type === type);
    return trouve === undefined ? 0 : Number.parseInt(trouve.value, 10);
  };

  return new Date(
    Date.UTC(
      composant('year'),
      composant('month') - 1,
      composant('day'),
      composant('hour'),
      composant('minute'),
      composant('second'),
    ),
  );
}

/**
 * Feuille d'en-tete, commune aux quatre exports : nom du document, date
 * d'export, periode couverte, et — sur les seuls exports COMMERCIAUX
 * (recettes, achats) — la mention de franchise de TVA et la mention légale
 * (CLAUDE.md §7). Ni le stock ni les mouvements ne sont des documents
 * commerciaux (docs/01 module 7) : `mentionTva` sert de proxy volontaire pour
 * « pièce destinée au comptable » — c'est exactement la même sélectivité pour
 * les deux mentions, jamais une coïncidence à vérifier à deux endroits.
 */
function ajouterFeuilleInformations(
  classeur: ExcelJS.Workbook,
  info: {
    readonly titreDocument: string;
    readonly dateExport: Date;
    readonly periodeCouverte: string;
    readonly mentionTva: boolean;
  },
): void {
  const feuille = classeur.addWorksheet('Informations');
  feuille.columns = [{ width: 20 }, { width: 64 }];

  const ligneTitre = feuille.addRow(['Document', info.titreDocument]);
  ligneTitre.getCell(1).font = { bold: true };

  const ligneDate = feuille.addRow(['Date d’export', instantEnDateExcelBruxelles(info.dateExport)]);
  ligneDate.getCell(1).font = { bold: true };
  ligneDate.getCell(2).numFmt = FORMAT_DATE;

  const lignePeriode = feuille.addRow(['Période couverte', info.periodeCouverte]);
  lignePeriode.getCell(1).font = { bold: true };

  if (info.mentionTva) {
    feuille.addRow([]);
    for (const mention of [MENTION_FRANCHISE_TVA, MENTION_NE_REMPLACE_PAS]) {
      const ligneMention = feuille.addRow([null, mention]);
      ligneMention.getCell(2).font = { italic: true };
      ligneMention.getCell(2).alignment = { wrapText: true };
    }
  }
}

/**
 * Serialise le classeur en octets prets a etre ecrits sur disque ou envoyes en
 * telechargement.
 *
 * Le double cast via `unknown` contourne un defaut de typage d'ExcelJS : son
 * `.d.ts` redeclare un `Buffer` LOCAL minimal (`extends ArrayBuffer`, sans les
 * methodes Node) qui masque le vrai `Buffer` global dans la portee de son
 * propre module. A l'execution, `writeBuffer()` rend bien un `Buffer` Node
 * complet — seule l'annotation de type d'ExcelJS est trop pauvre.
 */
async function serialiser(classeur: ExcelJS.Workbook): Promise<Buffer> {
  const octets = await classeur.xlsx.writeBuffer();
  return octets as unknown as Buffer;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Stock valorise
   ═══════════════════════════════════════════════════════════════════════════ */

export type LigneExportStock = {
  readonly ingredientNom: string;
  readonly unite: Unite;
  readonly quantiteDisponible: number;
  /** `null` quand le stock est epuise (docs/07 §6.2) : zero ferait croire a une marge de 100 %. */
  readonly cumpCentsParUnite: number | null;
  readonly valeurCents: number;
  readonly stockSecurite: number;
  /** Jour civil `AAAA-MM-JJ` du lot le plus urgent. `null` si aucun lot restant n'a de DLC. */
  readonly dlcLaPlusProche: string | null;
  readonly nbLots: number;
};

export type DonneesExportStock = {
  readonly dateExport: Date;
  readonly periodeCouverte: string;
  readonly lignes: readonly LigneExportStock[];
};

const COLONNES_STOCK: readonly ColonneExport[] = [
  { entete: 'Ingrédient', largeur: 30, alignement: 'gauche' },
  { entete: 'Quantité disponible', largeur: 18, numFmt: FORMAT_QUANTITE, alignement: 'droite' },
  { entete: 'Unité', largeur: 8, alignement: 'gauche' },
  { entete: 'CUMP (€/unité)', largeur: 16, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'Valeur (€)', largeur: 14, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'Seuil', largeur: 10, numFmt: FORMAT_QUANTITE, alignement: 'droite' },
  { entete: 'DLC la plus proche', largeur: 18, numFmt: FORMAT_DATE, alignement: 'gauche' },
  { entete: 'Nombre de lots', largeur: 14, numFmt: FORMAT_QUANTITE, alignement: 'droite' },
];

function ligneStock(l: LigneExportStock): ExcelJS.CellValue[] {
  return [
    l.ingredientNom,
    l.quantiteDisponible,
    l.unite,
    centimesEnEuros(l.cumpCentsParUnite),
    centimesEnEuros(l.valeurCents),
    l.stockSecurite,
    jourCivilEnDateExcel(l.dlcLaPlusProche),
    l.nbLots,
  ];
}

/**
 * État de stock valorisé — `docs/01` module 2 : « État de stock valorisé
 * (PDF + Excel) ». Export INTERNE : pas de mention de franchise de TVA.
 */
export async function exportStockValorise(donnees: DonneesExportStock): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  classeur.created = instantEnDateExcelBruxelles(donnees.dateExport);

  ajouterFeuilleInformations(classeur, {
    titreDocument: 'État de stock valorisé',
    dateExport: donnees.dateExport,
    periodeCouverte: donnees.periodeCouverte,
    mentionTva: false,
  });
  ajouterFeuilleTableau(classeur, 'Stock valorisé', COLONNES_STOCK, donnees.lignes.map(ligneStock));

  return serialiser(classeur);
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Journal des recettes — obligation legale sous franchise de TVA
   ═══════════════════════════════════════════════════════════════════════════ */

export type LigneExportJournalRecettes = {
  readonly numero: string;
  /** Jour civil belge `AAAA-MM-JJ` de la session. */
  readonly dateSession: string;
  readonly lieuNom: string;
  readonly caTotalCents: number | null;
  readonly caTransformeCents: number | null;
  readonly caRevenduCents: number | null;
  readonly caEspecesCents: number | null;
  readonly caCarteCents: number | null;
  readonly ecartCaisseCents: number | null;
};

export type DonneesExportJournalRecettes = {
  readonly dateExport: Date;
  readonly periodeCouverte: string;
  readonly lignes: readonly LigneExportJournalRecettes[];
};

const COLONNES_JOURNAL_RECETTES: readonly ColonneExport[] = [
  { entete: 'Numéro', largeur: 16, alignement: 'gauche' },
  { entete: 'Date', largeur: 12, numFmt: FORMAT_DATE, alignement: 'gauche' },
  { entete: 'Lieu', largeur: 20, alignement: 'gauche' },
  { entete: 'CA total (€)', largeur: 14, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'CA transformé (€)', largeur: 16, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'CA revendu (€)', largeur: 14, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'Espèces (€)', largeur: 14, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'Carte (€)', largeur: 14, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'Écart de caisse (€)', largeur: 16, numFmt: FORMAT_MONTANT, alignement: 'droite' },
];

function ligneJournalRecettes(l: LigneExportJournalRecettes): ExcelJS.CellValue[] {
  return [
    l.numero,
    jourCivilEnDateExcel(l.dateSession),
    l.lieuNom,
    centimesEnEuros(l.caTotalCents),
    centimesEnEuros(l.caTransformeCents),
    centimesEnEuros(l.caRevenduCents),
    centimesEnEuros(l.caEspecesCents),
    centimesEnEuros(l.caCarteCents),
    centimesEnEuros(l.ecartCaisseCents),
  ];
}

/**
 * Journal des recettes — `docs/01` module 7 : journal OBLIGATOIRE sous le
 * regime de franchise de TVA, alimente par les sessions closes. Une ligne par
 * session CLOTUREE : c'est a l'appelant de filtrer sur le statut, cette
 * fonction ne fait que mettre en forme ce qu'on lui donne.
 */
export async function exportJournalRecettes(
  donnees: DonneesExportJournalRecettes,
): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  classeur.created = instantEnDateExcelBruxelles(donnees.dateExport);

  ajouterFeuilleInformations(classeur, {
    titreDocument: 'Journal des recettes',
    dateExport: donnees.dateExport,
    periodeCouverte: donnees.periodeCouverte,
    mentionTva: true,
  });
  ajouterFeuilleTableau(
    classeur,
    'Journal des recettes',
    COLONNES_JOURNAL_RECETTES,
    donnees.lignes.map(ligneJournalRecettes),
  );

  return serialiser(classeur);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Journal des achats
   ═══════════════════════════════════════════════════════════════════════════ */

export type LigneExportJournalAchats = {
  readonly numero: string;
  /** Jour civil belge `AAAA-MM-JJ` de la reception. */
  readonly dateReception: string;
  readonly fournisseurNom: string;
  readonly montantTotalCents: number | null;
  readonly nbLots: number;
};

export type DonneesExportJournalAchats = {
  readonly dateExport: Date;
  readonly periodeCouverte: string;
  readonly lignes: readonly LigneExportJournalAchats[];
};

const COLONNES_JOURNAL_ACHATS: readonly ColonneExport[] = [
  { entete: 'Numéro', largeur: 16, alignement: 'gauche' },
  { entete: 'Date', largeur: 12, numFmt: FORMAT_DATE, alignement: 'gauche' },
  { entete: 'Fournisseur', largeur: 26, alignement: 'gauche' },
  { entete: 'Montant (€)', largeur: 14, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'Nombre de lots', largeur: 14, numFmt: FORMAT_QUANTITE, alignement: 'droite' },
];

function ligneJournalAchats(l: LigneExportJournalAchats): ExcelJS.CellValue[] {
  return [
    l.numero,
    jourCivilEnDateExcel(l.dateReception),
    l.fournisseurNom,
    centimesEnEuros(l.montantTotalCents),
    l.nbLots,
  ];
}

/**
 * Journal des achats — `docs/01` module 7, une ligne par réception de
 * marchandise.
 */
export async function exportJournalAchats(donnees: DonneesExportJournalAchats): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  classeur.created = instantEnDateExcelBruxelles(donnees.dateExport);

  ajouterFeuilleInformations(classeur, {
    titreDocument: 'Journal des achats',
    dateExport: donnees.dateExport,
    periodeCouverte: donnees.periodeCouverte,
    mentionTva: true,
  });
  ajouterFeuilleTableau(
    classeur,
    'Journal des achats',
    COLONNES_JOURNAL_ACHATS,
    donnees.lignes.map(ligneJournalAchats),
  );

  return serialiser(classeur);
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. Mouvements de stock — journal complet
   ═══════════════════════════════════════════════════════════════════════════ */

/** Miroir de l'enum `mouvement_stock.type` du schema (`packages/db/src/schema.ts`). */
export type TypeMouvementExport =
  | 'entree'
  | 'sortie_production'
  | 'sortie_vente'
  | 'perte'
  | 'ajustement_inventaire'
  | 'consommation_perso';

const LIBELLES_TYPE_MOUVEMENT: Readonly<Record<TypeMouvementExport, string>> = {
  entree: 'Entrée',
  sortie_production: 'Sortie production',
  sortie_vente: 'Sortie vente',
  perte: 'Perte',
  ajustement_inventaire: 'Ajustement inventaire',
  consommation_perso: 'Consommation personnelle',
};

export type LigneExportMouvement = {
  /** Jour civil belge `AAAA-MM-JJ` du mouvement. */
  readonly dateMouvement: string;
  readonly type: TypeMouvementExport;
  readonly ingredientNom: string;
  /** Numéro de lot fournisseur. `null` si le lot n'en porte pas. */
  readonly lot: string | null;
  readonly quantite: number;
  readonly coutCents: number;
  /** Motif (code + texte libre, deja composes par l'appelant). `null` si aucun motif saisi. */
  readonly motif: string | null;
  readonly isAnnule: boolean;
};

export type DonneesExportMouvements = {
  readonly dateExport: Date;
  readonly periodeCouverte: string;
  readonly lignes: readonly LigneExportMouvement[];
};

const COLONNES_MOUVEMENTS: readonly ColonneExport[] = [
  { entete: 'Date', largeur: 12, numFmt: FORMAT_DATE, alignement: 'gauche' },
  { entete: 'Type', largeur: 20, alignement: 'gauche' },
  { entete: 'Ingrédient', largeur: 26, alignement: 'gauche' },
  { entete: 'Lot', largeur: 18, alignement: 'gauche' },
  { entete: 'Quantité', largeur: 12, numFmt: FORMAT_QUANTITE, alignement: 'droite' },
  { entete: 'Coût (€)', largeur: 12, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'Motif', largeur: 30, alignement: 'gauche' },
  { entete: 'Annulé', largeur: 10, alignement: 'gauche' },
];

function ligneMouvement(l: LigneExportMouvement): ExcelJS.CellValue[] {
  return [
    jourCivilEnDateExcel(l.dateMouvement),
    LIBELLES_TYPE_MOUVEMENT[l.type],
    l.ingredientNom,
    l.lot,
    l.quantite,
    centimesEnEuros(l.coutCents),
    l.motif,
    l.isAnnule ? 'Oui' : 'Non',
  ];
}

/**
 * Journal des mouvements de stock — `docs/01` module 2, la traçabilité
 * complete exigee par l'AFSCA (CLAUDE.md §3 regles n°5 et 6). Export INTERNE :
 * pas de mention de franchise de TVA.
 *
 * Les mouvements ANNULES restent dans l'export, marques « Oui » en colonne
 * « Annulé » — « rien ne s'efface » (CLAUDE.md §3 regle n°7) vaut aussi pour
 * ce que le comptable voit.
 */
export async function exportMouvementsStock(donnees: DonneesExportMouvements): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  classeur.created = instantEnDateExcelBruxelles(donnees.dateExport);

  ajouterFeuilleInformations(classeur, {
    titreDocument: 'Journal des mouvements de stock',
    dateExport: donnees.dateExport,
    periodeCouverte: donnees.periodeCouverte,
    mentionTva: false,
  });
  ajouterFeuilleTableau(
    classeur,
    'Mouvements de stock',
    COLONNES_MOUVEMENTS,
    donnees.lignes.map(ligneMouvement),
  );

  return serialiser(classeur);
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Suivi des économies d'achat (fiche 12 — inspiré du classeur Mithra
   Pharmaceuticals) : une feuille détail (« COST REDUCTION » du fichier
   source), une feuille synthèse croisée (« CHART_COST REDUCTION »).
   ═══════════════════════════════════════════════════════════════════════════ */

export type LigneExportEconomieDetail = {
  /** Jour civil `AAAA-MM-JJ`. */
  readonly dateAction: string;
  readonly numeroCommande: string | null;
  readonly ingredientNom: string;
  readonly fournisseurNom: string;
  readonly typeAction: TypeActionEconomie;
  readonly description: string;
  readonly prixUnitaireAvantCents: number;
  readonly prixUnitaireApresCents: number;
  readonly quantiteConcernee: number;
  /** DÉRIVÉ par l'appelant (`calculerEconomieCents`), jamais recalculé ici :
   * cette couche ne fait que mettre en forme (voir l'en-tête du fichier). */
  readonly economieCents: number;
};

export type DonneesExportEconomies = {
  readonly dateExport: Date;
  readonly periodeCouverte: string;
  readonly lignes: readonly LigneExportEconomieDetail[];
  /** Déjà agrégé par `agregerEconomies` (`packages/core/src/economies.ts`). */
  readonly tableau: TableauBordEconomies;
};

const LIBELLES_TYPE_ACTION_ECONOMIE: Readonly<Record<TypeActionEconomie, string>> = {
  negociation_prix: 'Négociation de prix',
  achat_alternatif: 'Achat alternatif',
  remplacement_stock_immobilise: 'Remplacement stock immobilisé',
  autre: 'Autre',
};

const COLONNES_ECONOMIES_DETAIL: readonly ColonneExport[] = [
  { entete: 'Mois', largeur: 10, alignement: 'gauche' },
  { entete: 'Date', largeur: 12, numFmt: FORMAT_DATE, alignement: 'gauche' },
  { entete: 'N° commande', largeur: 14, alignement: 'gauche' },
  { entete: 'Ingrédient', largeur: 26, alignement: 'gauche' },
  { entete: 'Fournisseur', largeur: 22, alignement: 'gauche' },
  { entete: "Type d'action", largeur: 24, alignement: 'gauche' },
  { entete: 'Description', largeur: 42, alignement: 'gauche' },
  { entete: 'Prix avant (€)', largeur: 14, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'Prix après (€)', largeur: 14, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'Écart unitaire (€)', largeur: 16, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'Quantité', largeur: 12, numFmt: FORMAT_QUANTITE, alignement: 'droite' },
  { entete: 'Économie (€)', largeur: 14, numFmt: FORMAT_MONTANT, alignement: 'droite' },
  { entete: 'Cumul (€)', largeur: 14, numFmt: FORMAT_MONTANT, alignement: 'droite' },
];

/**
 * Triées par date CROISSANTE avant calcul du cumul, quel que soit l'ordre
 * reçu : c'est la seule façon pour que la colonne « Cumul (€) » — comme le
 * cumul progressif du classeur Mithra source — se lise de haut en bas sans
 * repartir en arrière. Toujours non décroissant ici : `economie_achat`
 * n'accepte à l'écriture que des économies strictement positives
 * (`estEconomieStrictementPositive`, `packages/db/src/depots/economies.ts`).
 */
function lignesEconomiesDetail(
  lignes: readonly LigneExportEconomieDetail[],
): ExcelJS.CellValue[][] {
  const triees = [...lignes].sort((a, b) =>
    a.dateAction < b.dateAction ? -1 : a.dateAction > b.dateAction ? 1 : 0,
  );
  let cumulCents = 0;
  return triees.map((l) => {
    cumulCents += l.economieCents;
    return [
      l.dateAction.slice(0, 7),
      jourCivilEnDateExcel(l.dateAction),
      l.numeroCommande,
      l.ingredientNom,
      l.fournisseurNom,
      LIBELLES_TYPE_ACTION_ECONOMIE[l.typeAction],
      l.description,
      centimesEnEuros(l.prixUnitaireAvantCents),
      centimesEnEuros(l.prixUnitaireApresCents),
      centimesEnEuros(l.prixUnitaireAvantCents - l.prixUnitaireApresCents),
      l.quantiteConcernee,
      centimesEnEuros(l.economieCents),
      centimesEnEuros(cumulCents),
    ];
  });
}

/**
 * Feuille croisée, sur le modèle de « CHART_COST REDUCTION » : l'économie
 * totale cumulée EN TÊTE (fiche 12), puis un tableau mois × type d'action,
 * avec une ligne et une colonne de total — le levier le plus efficace se lit
 * directement sur la colonne « Total » la plus haute.
 *
 * Construite à la main plutôt que via `ajouterFeuilleTableau` : cette
 * dernière suppose que l'en-tête occupe la ligne 1, alors que le total cumulé
 * doit apparaître AVANT le tableau.
 */
function ajouterFeuilleSyntheseEconomies(
  classeur: ExcelJS.Workbook,
  tableau: TableauBordEconomies,
): void {
  const feuille = classeur.addWorksheet('Synthèse par type');
  feuille.columns = [
    { width: 14 },
    ...TYPES_ACTION_ECONOMIE.map(() => ({ width: 22 })),
    { width: 16 },
  ];

  const ligneLibelleTotal = feuille.addRow(['Économie totale sur la période']);
  ligneLibelleTotal.getCell(1).font = { bold: true };
  const celluleTotal = feuille.addRow([null, centimesEnEuros(tableau.totalCents)]).getCell(2);
  celluleTotal.numFmt = FORMAT_MONTANT;
  celluleTotal.font = { bold: true, size: 14 };
  feuille.addRow([]);

  const enTete = feuille.addRow([
    'Mois',
    ...TYPES_ACTION_ECONOMIE.map((t) => LIBELLES_TYPE_ACTION_ECONOMIE[t]),
    'Total',
  ]);
  enTete.font = { bold: true };
  enTete.eachCell((cellule) => {
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBEBED' } };
  });

  const derniereColonne = TYPES_ACTION_ECONOMIE.length + 2;
  for (const mois of tableau.parMois) {
    const ligne = feuille.addRow([
      mois.mois,
      ...TYPES_ACTION_ECONOMIE.map((t) => centimesEnEuros(mois.parType[t])),
      centimesEnEuros(mois.totalCents),
    ]);
    for (let colonne = 2; colonne <= derniereColonne; colonne += 1) {
      ligne.getCell(colonne).numFmt = FORMAT_MONTANT;
    }
  }

  const totauxParType = new Map(tableau.parType.map((t) => [t.typeAction, t.totalCents]));
  const ligneTotalParType = feuille.addRow([
    'Total',
    ...TYPES_ACTION_ECONOMIE.map((t) => centimesEnEuros(totauxParType.get(t) ?? 0)),
    centimesEnEuros(tableau.totalCents),
  ]);
  ligneTotalParType.font = { bold: true };
  for (let colonne = 2; colonne <= derniereColonne; colonne += 1) {
    ligneTotalParType.getCell(colonne).numFmt = FORMAT_MONTANT;
  }
}

/**
 * Export « au format proche de celui du fichier Mithra fourni » (critère de
 * fin de la fiche 12) : une feuille détail, une feuille synthèse croisée.
 * Export INTERNE : pas de mention de franchise de TVA, ce n'est pas un
 * document commercial.
 */
export async function exportEconomies(donnees: DonneesExportEconomies): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  classeur.created = instantEnDateExcelBruxelles(donnees.dateExport);

  ajouterFeuilleInformations(classeur, {
    titreDocument: 'Suivi des économies d’achat',
    dateExport: donnees.dateExport,
    periodeCouverte: donnees.periodeCouverte,
    mentionTva: false,
  });
  ajouterFeuilleTableau(
    classeur,
    'Détail des économies',
    COLONNES_ECONOMIES_DETAIL,
    lignesEconomiesDetail(donnees.lignes),
  );
  ajouterFeuilleSyntheseEconomies(classeur, donnees.tableau);

  return serialiser(classeur);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Archivage — reutilise le mecanisme COMMUN de `rendu.ts`
   ═══════════════════════════════════════════════════════════════════════════ */

export type DemandeExportExcel = {
  /** Objet source de l'export : `'stock'`, `'journal-recettes-2026'`… selon l'appelant. */
  readonly objetId: string | null;
  readonly numero: string | null;
  readonly parametresSource?: unknown;
  readonly creePar?: string | null;
};

/**
 * Ecrit un classeur DEJA PRODUIT (par une des quatre fonctions ci-dessus) sur
 * disque et l'ARCHIVE sous le type `export_excel`, avec son empreinte
 * SHA-256 et son numero de version — exactement le meme mecanisme que pour un
 * PDF (`rendrePdf`), via la fonction commune `archiverFichierGenere` de
 * `rendu.ts`.
 *
 * Regenerer le meme export cree une NOUVELLE VERSION numerotee : le classeur
 * precedent reste sur disque et en base (docs/07 §6.5) — un grand livre remis
 * au comptable en mars ne doit pas pouvoir etre remplace en silence par un
 * recalcul de septembre.
 */
export async function archiverExportExcel(
  base: BaseBatte,
  demande: DemandeExportExcel,
  classeurOctets: Buffer,
): Promise<DocumentArchive> {
  return archiverFichierGenere(
    base,
    {
      type: 'export_excel',
      objetId: demande.objetId,
      numero: demande.numero,
      extension: 'xlsx',
      parametresSource: demande.parametresSource,
      creePar: demande.creePar ?? null,
    },
    (chemin) => writeFileSync(chemin, classeurOctets),
  );
}
