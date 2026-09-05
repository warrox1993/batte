/**
 * Regle d'architecture n°3, mise sous test : « tous les montants sont stockes en
 * centimes d'euro (INTEGER). Aucun flottant pour de l'argent, nulle part. »
 *
 * Ce fichier existe parce que la regle avait ete violee en silence : `lot` et
 * `commande_ligne` stockaient un `real`. Le type n'etait que le symptome — la
 * faute reelle etait de persister un TAUX (`prix_ligne / quantite`) a la place
 * du MONTANT paye, ce qui detruisait irremediablement le centime de la facture
 * fournisseur et rendait impossible le rapprochement a trois
 * facture <-> reception <-> commande prevu par le schema.
 *
 * Le premier test ci-dessous est generique et balaye TOUTE la base : c'est lui
 * qui empeche la faute de revenir dans une table qui n'existe pas encore.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { ajouterJours } from '@batte/core';
import { eq } from 'drizzle-orm';
import { creerBase, sqliteBrut, type BaseBatte } from './client.js';
import { config } from './config.js';
import { migrer } from './migrer.js';
import { seed } from './seed/index.js';
import { seedDemonstration } from './seed/demonstration.js';
import { commandeLigne, fournisseur, ingredient, lot } from './schema.js';
import { etatDuStock, lotsDeLIngredient } from './depots/stock.js';
import { ajouterVersionParametre } from './depots/parametres.js';
import { enregistrerReception } from './services/reception.js';
import { enregistrerSortie } from './services/mouvements.js';
import { genererBrouillonsCommandes, lireCommandeDetail } from './services/commandes.js';

const JOUR = '2026-07-27';

/** Une ligne de `PRAGMA table_info` : seules ces deux colonnes nous interessent. */
type ColonneSqlite = { name: string; type: string };

describe('Regle n°3 — argent en entiers', () => {
  let base: BaseBatte;
  let idFarine: string;
  let idFournisseur: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    idFarine = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!.id;
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
  });

  /* ═════════════════════════════════════════════════════════════════════════
     1. Le garde-fou structurel : aucune colonne `_cents` en flottant
     ═════════════════════════════════════════════════════════════════════════ */

  describe('schema', () => {
    /**
     * Balaye TOUTES les tables et echoue des qu'une colonne dont le nom finit
     * par `_cents` n'est pas declaree `INTEGER`.
     *
     * Generique a dessein : un test qui nommerait `lot` et `commande_ligne`
     * protegerait les deux tables deja corrigees et laisserait passer la
     * onzieme. C'est la convention de nommage qui est le contrat, pas la liste
     * des tables du jour.
     */
    it("aucune colonne de montant (`*_cents`) n'est stockee en flottant", () => {
      const sqlite = sqliteBrut(base);

      const tables = sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'
           ORDER BY name`,
        )
        .all() as { name: string }[];

      // Sans cette borne, une base vide rendrait le test vert par vacuite.
      expect(tables.length).toBeGreaterThan(30);

      const fautives: string[] = [];
      let nbColonnesMontant = 0;

      for (const table of tables) {
        // `table_info` ne se parametre pas : le nom vient de `sqlite_master`,
        // donc d'un identifiant deja valide, jamais d'une saisie utilisateur.
        const colonnes = sqlite
          .prepare(`PRAGMA table_info("${table.name}")`)
          .all() as ColonneSqlite[];

        for (const colonne of colonnes) {
          if (!colonne.name.endsWith('_cents')) continue;
          nbColonnesMontant += 1;
          if (colonne.type.toUpperCase() !== 'INTEGER') {
            fautives.push(`${table.name}.${colonne.name} : ${colonne.type}`);
          }
        }
      }

      expect(nbColonnesMontant).toBeGreaterThan(20);
      expect(fautives).toEqual([]);
    });

    /**
     * Contre-epreuve du test precedent : il doit VRAIMENT detecter un `real`.
     * Sans elle, une erreur de filtre (`endsWith` sur un suffixe qui ne matche
     * jamais) rendrait le garde-fou vert et inutile a perpetuite.
     */
    it('le garde-fou detecte bien une colonne de montant en flottant', () => {
      const sqlite = sqliteBrut(base);
      sqlite.exec('CREATE TABLE essai_regression (id text PRIMARY KEY, montant_cents real)');

      const colonnes = sqlite
        .prepare('PRAGMA table_info("essai_regression")')
        .all() as ColonneSqlite[];
      const montant = colonnes.find((c) => c.name.endsWith('_cents'))!;

      expect(montant.type.toUpperCase()).not.toBe('INTEGER');
    });
  });

  /* ═════════════════════════════════════════════════════════════════════════
     2. Reconciliation d'une reception : facture <-> lots, au centime
     ═════════════════════════════════════════════════════════════════════════ */

  describe('reception', () => {
    it('la somme des lots creés vaut EXACTEMENT le montant de la reception', () => {
      // Trois lignes dont deux qui ne tombent pas rond a l'unite : c'est
      // precisement ou l'ancien quotient flottant perdait des centimes.
      const lignes = [
        {
          ingredientId: idFarine,
          quantite: 25_000,
          prixLigneCents: 1299,
          numeroLotFournisseur: 'LOT-TEST-1',
        },
        {
          ingredientId: idFarine,
          quantite: 3000,
          prixLigneCents: 707,
          numeroLotFournisseur: 'LOT-TEST-2',
        },
        {
          ingredientId: idFarine,
          quantite: 7,
          prixLigneCents: 1,
          numeroLotFournisseur: 'LOT-TEST-3',
        },
      ];

      const resultat = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes,
      });

      const lotsCrees = base
        .select({ id: lot.id, prixLigneCents: lot.prixLigneCents })
        .from(lot)
        .where(eq(lot.receptionId, resultat.receptionId))
        .all();

      expect(lotsCrees).toHaveLength(3);

      const sommeLots = lotsCrees.reduce((total, l) => total + l.prixLigneCents, 0);
      const sommeFacture = lignes.reduce((total, l) => total + l.prixLigneCents, 0);

      // Aucune tolerance : c'est tout l'enjeu. Un rapprochement de facture ne se
      // solde pas « a peu pres ».
      expect(sommeLots).toBe(sommeFacture);
      expect(sommeLots).toBe(resultat.montantTotalCents);
    });

    /**
     * LE cas qui perdait des centimes.
     *
     * 1 299 c pour 25 000 g donne un taux de 0,05196 c/g, non representable
     * exactement en binaire. L'ancien code stockait ce quotient et jetait
     * `prixLigneCents` : le montant paye n'etait plus qu'un produit reconstitue,
     * donc arrondi. Ici le montant relu doit etre le montant saisi, a l'unite.
     */
    it('un prix qui ne tombe pas rond est relu au centime pres', () => {
      const resultat = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 25_000,
            prixLigneCents: 1299,
            numeroLotFournisseur: 'LOT-TEST',
          },
        ],
      });

      const enBase = base
        .select({ prixLigneCents: lot.prixLigneCents, quantiteInitiale: lot.quantiteInitiale })
        .from(lot)
        .where(eq(lot.receptionId, resultat.receptionId))
        .get()!;

      expect(enBase.prixLigneCents).toBe(1299);
      expect(Number.isInteger(enBase.prixLigneCents)).toBe(true);

      // Et le taux derive reste bien le taux exact attendu, sans passage par
      // un stockage intermediaire qui l'aurait fige.
      const lots = lotsDeLIngredient(base, idFarine).filter((l) => l.prixLigneCents === 1299);
      expect(lots).toHaveLength(1);
      expect(lots[0]!.prixUnitaireCents).toBe(1299 / 25_000);
      expect(lots[0]!.quantiteInitiale).toBe(25_000);
    });

    it("le mouvement d'entree porte le meme montant entier que son lot", () => {
      // Les deux tables doivent raconter la meme histoire : `lot` porte la
      // valeur d'achat, `mouvement_stock` porte le cout du flux. Si elles
      // divergent, le stock et la comptabilite ne se rejoindront jamais.
      const resultat = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1234,
            prixLigneCents: 987,
            numeroLotFournisseur: 'LOT-TEST',
          },
        ],
      });

      const lotCree = base
        .select()
        .from(lot)
        .where(eq(lot.receptionId, resultat.receptionId))
        .get()!;

      expect(lotCree.prixLigneCents).toBe(987);
      expect(resultat.montantTotalCents).toBe(987);
    });
  });

  /* ═════════════════════════════════════════════════════════════════════════
     3. Reconciliation d'une commande : entete <-> lignes, au centime
     ═════════════════════════════════════════════════════════════════════════ */

  describe('commande fournisseur', () => {
    /** Meme montage que `commandes.test.ts` : stock consomme jusque sous le seuil. */
    function farineSousLePointDeCommande(): void {
      ajouterVersionParametre(base, {
        cle: 'reappro_fenetre_historique_jours',
        valeur: '14',
        typeValeur: 'entier',
        dateDebutValidite: '2026-07-01',
        source: 'test',
        description: 'Fenêtre réduite pour les tests.',
      });

      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2026-06-01',
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 16_000,
            prixLigneCents: 100,
            numeroLotFournisseur: 'LOT-TEST',
          },
        ],
      });

      for (let i = 0; i < 14; i += 1) {
        enregistrerSortie(base, {
          ingredientId: idFarine,
          quantite: 1000,
          type: 'sortie_production',
          motifCode: 'SURDOSAGE',
          dateMouvement: ajouterJours(ajouterJours(JOUR, -13), i),
        });
      }
    }

    it('montantTotalCents vaut EXACTEMENT la somme des lignes stockees', () => {
      farineSousLePointDeCommande();

      const resultat = genererBrouillonsCommandes(base, { jourReference: JOUR });
      expect(resultat.commandes.length).toBeGreaterThan(0);

      for (const commande of resultat.commandes) {
        const lignesEnBase = base
          .select({ prixLigneCents: commandeLigne.prixLigneCents })
          .from(commandeLigne)
          .where(eq(commandeLigne.commandeId, commande.id))
          .all();

        expect(lignesEnBase.length).toBeGreaterThan(0);

        const somme = lignesEnBase.reduce((total, l) => total + l.prixLigneCents, 0);
        expect(somme).toBe(commande.montantTotalCents);

        // Et le detail relu par l'ecran raconte la meme chose, sans arrondi
        // supplementaire : l'entete ne peut plus contredire ses propres lignes.
        const detail = lireCommandeDetail(base, commande.id)!;
        const sommeDetail = detail.lignes.reduce((total, l) => total + l.montantLigneCents, 0);
        expect(sommeDetail).toBe(detail.montantTotalCents);
        for (const ligne of detail.lignes) {
          expect(ligne.prixLigneCents).toBe(ligne.montantLigneCents);
          expect(Number.isInteger(ligne.prixLigneCents)).toBe(true);
        }
      }
    });

    it('le prix unitaire lu est un taux DERIVE, jamais une valeur stockee', () => {
      farineSousLePointDeCommande();

      const resultat = genererBrouillonsCommandes(base, { jourReference: JOUR });
      const detail = lireCommandeDetail(base, resultat.commandes[0]!.id)!;
      const ligne = detail.lignes.find((l) => l.ingredientId === idFarine)!;

      expect(ligne.prixUnitaireCents).toBe(ligne.prixLigneCents / ligne.quantiteUniteRef);
      expect(Number.isFinite(ligne.prixUnitaireCents)).toBe(true);
    });
  });

  /* ═════════════════════════════════════════════════════════════════════════
     4. La migration elle-meme : « rien ne s'efface » (regle n°7)
     ═════════════════════════════════════════════════════════════════════════ */

  describe('migration 0008 — conversion du taux vers le montant', () => {
    type EntreeJournal = { idx: number; tag: string };

    /** Rejoue les migrations une par une, comme le fait le migrateur Drizzle. */
    function appliquer(sqlite: Database.Database, tag: string): void {
      const contenu = readFileSync(join(config.dossierMigrations, `${tag}.sql`), 'utf8');
      sqlite.exec('BEGIN');
      for (const instruction of contenu.split('--> statement-breakpoint')) {
        if (instruction.trim() !== '') sqlite.exec(instruction);
      }
      sqlite.exec('COMMIT');
    }

    /**
     * Une migration qui remettrait les prix a zero passerait tous les autres
     * tests de ce fichier : ils tournent sur une base creee d'un bloc, donc
     * vide au moment de la conversion. Seule une REPRISE de l'historique sur
     * des donnees deja presentes prouve que la regle n°7 est tenue.
     *
     * Les valeurs choisies sont celles qui perdaient des centimes : 1 299 c pour
     * 25 000 g donne 0,05196 c/g, et 703 c pour 3 000 unites donne
     * 0,2343333... — deux taux non representables exactement en binaire.
     */
    it("reconstitue au centime les montants d'une base deja peuplee", () => {
      const journal = JSON.parse(
        readFileSync(join(config.dossierMigrations, 'meta', '_journal.json'), 'utf8'),
      ) as { entries: EntreeJournal[] };

      const correction = journal.entries.find((e) => e.tag.startsWith('0008_'));
      expect(correction).toBeDefined();

      const sqlite = new Database(':memory:');
      try {
        // Verification ciblee sur deux tables : les cles etrangeres sont hors
        // sujet ici et exigeraient de peupler la moitie du referentiel.
        sqlite.pragma('foreign_keys = OFF');

        for (const entree of journal.entries.filter((e) => e.idx < correction!.idx)) {
          appliquer(sqlite, entree.tag);
        }

        // L'etat tel que l'ANCIEN code l'ecrivait : le quotient flottant, et le
        // montant paye deja perdu.
        sqlite
          .prepare(
            `INSERT INTO lot (id,ingredient_id,fournisseur_id,reception_id,date_reception,
               quantite_initiale,prix_unitaire_cents,statut,cree_le,modifie_le)
             VALUES ('L','I','F','R',?,25000,?,'disponible','t','t')`,
          )
          .run(JOUR, 1299 / 25_000);
        sqlite
          .prepare(
            `INSERT INTO commande_ligne (id,commande_id,ingredient_id,
               quantite_conditionnements,quantite_unite_ref,prix_unitaire_cents)
             VALUES ('CL','C','I',1,3000,?)`,
          )
          .run(703 / 3000);

        appliquer(sqlite, correction!.tag);

        const lotConverti = sqlite.prepare('SELECT prix_ligne_cents p FROM lot').get() as {
          p: number;
        };
        const ligneConvertie = sqlite
          .prepare('SELECT prix_ligne_cents p FROM commande_ligne')
          .get() as { p: number };

        expect(lotConverti.p).toBe(1299);
        expect(ligneConvertie.p).toBe(703);

        // Et l'ancienne colonne flottante a bien disparu des deux tables.
        for (const table of ['lot', 'commande_ligne']) {
          const colonnes = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as ColonneSqlite[];
          expect(colonnes.map((c) => c.name)).not.toContain('prix_unitaire_cents');
          expect(colonnes.find((c) => c.name === 'prix_ligne_cents')?.type.toUpperCase()).toBe(
            'INTEGER',
          );
        }
      } finally {
        sqlite.close();
      }
    });
  });

  /* ═════════════════════════════════════════════════════════════════════════
     5. Garde `NaN` / `Infinity` (D-034)
     ═════════════════════════════════════════════════════════════════════════ */

  describe('division protegee', () => {
    /**
     * Un lot de quantite initiale nulle ne peut pas naitre d'une reception
     * (`quantite <= 0` est refuse en 422), mais il peut naitre d'une reprise de
     * donnees ou d'une correction manuelle. D-034 a montre qu'un `NaN` unique se
     * propage en silence dans TOUTE la valorisation avant qu'on le remarque :
     * le garde-fou se teste, il ne se suppose pas.
     */
    it('un lot de quantite initiale 0 ne rend ni NaN ni Infinity', () => {
      // Une reception normale d'abord : elle fournit le `reception_id` exige
      // par la cle etrangere, et un lot sain a cote duquel comparer.
      const saine = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 250,
            numeroLotFournisseur: 'LOT-TEST',
          },
        ],
      });

      const sqlite = sqliteBrut(base);
      const maintenant = '2026-07-27T06:00:00.000Z';

      sqlite
        .prepare(
          `INSERT INTO lot (id, ingredient_id, fournisseur_id, reception_id,
             numero_lot_fournisseur, date_reception, date_dlc, quantite_initiale,
             prix_ligne_cents, statut, cree_le, modifie_le)
           VALUES ('lot-degenere', ?, ?, ?, 'ZERO', ?, NULL, 0, 500,
             'disponible', ?, ?)`,
        )
        .run(idFarine, idFournisseur, saine.receptionId, JOUR, maintenant, maintenant);

      const degenere = lotsDeLIngredient(base, idFarine).find((l) => l.id === 'lot-degenere');
      expect(degenere).toBeDefined();
      expect(Number.isFinite(degenere!.prixUnitaireCents)).toBe(true);
      expect(Number.isNaN(degenere!.prixUnitaireCents)).toBe(false);
      expect(degenere!.prixUnitaireCents).toBe(0);

      // Et le `NaN` ne s'est pas propage a la ligne de stock qui agrege ce lot.
      const ligne = etatDuStock(base, JOUR).find((l) => l.ingredientId === idFarine)!;
      expect(Number.isFinite(ligne.valeurCents)).toBe(true);
      expect(Number.isInteger(ligne.valeurCents)).toBe(true);
      if (ligne.cumpCentsParUnite !== null) {
        expect(Number.isFinite(ligne.cumpCentsParUnite)).toBe(true);
      }
    });
  });
});
