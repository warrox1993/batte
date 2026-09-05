/**
 * Tests du journal d'audit — CLAUDE.md §3 regle 7.
 *
 * L'enjeu n'est pas la table en elle-meme : c'est de prouver qu'un seuil legal
 * modifie laisse sa valeur anterieure lisible. Sans cette preuve, un controle
 * demandant « quel seuil appliquiez-vous en mars ? » reste sans reponse.
 */

import { definitionParametre, ErreurIntrouvable } from '@batte/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { journaliser, listerJournalAudit, tablesTracees } from './audit.js';
import { ajouterVersionParametre, corrigerParametre, listerParametres } from './parametres.js';

/** Le seuil le plus sensible du projet : sortie de la franchise de TVA. */
const CLE_SEUIL_TVA = 'seuil_franchise_tva_cents';

/**
 * Aucune valeur metier en dur (CLAUDE.md §7) : la valeur attendue vient du
 * catalogue, exactement comme celle que le seed a inseree.
 */
function valeurCatalogue(cle: string): string {
  const definition = definitionParametre(cle);
  if (definition === undefined) throw new Error(`Cle absente du catalogue : ${cle}`);
  return definition.valeurDefaut;
}

function ligneParametre(base: BaseBatte, cle: string) {
  const ligne = listerParametres(base).find((l) => l.cle === cle);
  if (ligne === undefined) throw new Error(`Parametre non seede : ${cle}`);
  return ligne;
}

describe('journal d’audit', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  describe('journaliser / listerJournalAudit', () => {
    it('ecrit une entree et la relit avec ses deux instantanes', () => {
      const id = journaliser(base, {
        table: 'ingredient',
        enregistrementId: 'ing-1',
        action: 'modification',
        valeurAvant: { nom: 'Farine T55' },
        valeurApres: { nom: 'Farine T65' },
        parQui: 'Propriétaire',
      });

      const lignes = listerJournalAudit(base, { table: 'ingredient' });
      expect(lignes).toHaveLength(1);
      expect(lignes[0]?.id).toBe(id);
      expect(lignes[0]?.action).toBe('modification');
      expect(lignes[0]?.valeurAvant).toEqual({ nom: 'Farine T55' });
      expect(lignes[0]?.valeurApres).toEqual({ nom: 'Farine T65' });
      expect(lignes[0]?.parQui).toBe('Propriétaire');
      // ISO 8601 UTC (CLAUDE.md §3 regle 8).
      expect(lignes[0]?.dateAction).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    it('accepte l’absence d’instantane avant et d’utilisateur', () => {
      journaliser(base, {
        table: 'produit',
        enregistrementId: 'prod-1',
        action: 'creation',
        valeurApres: { nom: 'Sirop de Liège' },
      });

      const [ligne] = listerJournalAudit(base, { table: 'produit' });
      expect(ligne?.valeurAvant).toBeNull();
      expect(ligne?.parQui).toBeNull();
    });

    it('filtre par table puis par enregistrement', () => {
      journaliser(base, { table: 'recette', enregistrementId: 'r1', action: 'creation' });
      journaliser(base, { table: 'recette', enregistrementId: 'r2', action: 'creation' });
      journaliser(base, { table: 'ingredient', enregistrementId: 'i1', action: 'creation' });

      expect(listerJournalAudit(base, { table: 'recette' })).toHaveLength(2);
      expect(listerJournalAudit(base, { table: 'recette', enregistrementId: 'r2' })).toHaveLength(
        1,
      );
      expect(listerJournalAudit(base)).toHaveLength(3);
    });

    it('rend les entrees de la plus recente a la plus ancienne', () => {
      journaliser(base, { table: 'recette', enregistrementId: 'r1', action: 'creation' });
      journaliser(base, { table: 'recette', enregistrementId: 'r2', action: 'modification' });

      const lignes = listerJournalAudit(base, { table: 'recette' });
      // Les deux ecritures peuvent partager la meme milliseconde : c'est l'UUID
      // v7, chronologique, qui garantit un ordre stable.
      expect(lignes.map((l) => l.enregistrementId)).toEqual(['r2', 'r1']);
    });

    it('borne la periode, jour civil inclus de bout en bout', () => {
      journaliser(base, { table: 'recette', enregistrementId: 'r1', action: 'creation' });
      const [ligne] = listerJournalAudit(base, { table: 'recette' });
      const jourUtc = (ligne?.dateAction ?? '').slice(0, 10);

      // Une borne haute exprimee en jour civil doit couvrir la journee entiere,
      // pas s'arreter a minuit pile.
      expect(listerJournalAudit(base, { jusqua: jourUtc })).toHaveLength(1);
      expect(listerJournalAudit(base, { depuis: jourUtc })).toHaveLength(1);
      expect(listerJournalAudit(base, { jusqua: '2000-01-01' })).toHaveLength(0);
      expect(listerJournalAudit(base, { depuis: '2999-01-01' })).toHaveLength(0);
    });

    it('respecte la limite demandee', () => {
      journaliser(base, { table: 'recette', enregistrementId: 'r1', action: 'creation' });
      journaliser(base, { table: 'recette', enregistrementId: 'r2', action: 'creation' });

      expect(listerJournalAudit(base, { limite: 1 })).toHaveLength(1);
    });
  });

  describe('correction d’un seuil legal', () => {
    it('garde la valeur anterieure lisible apres modification', () => {
      const avant = ligneParametre(base, CLE_SEUIL_TVA);
      const valeurInitiale = valeurCatalogue(CLE_SEUIL_TVA);
      expect(avant.valeur).toBe(valeurInitiale);

      // Correction : le seuil passe a une autre valeur, en centimes entiers.
      const valeurCorrigee = String(Number(valeurInitiale) + 100_000);
      corrigerParametre(base, avant.id, valeurCorrigee, 'Propriétaire');

      // La table ne porte plus que la nouvelle valeur...
      expect(ligneParametre(base, CLE_SEUIL_TVA).valeur).toBe(valeurCorrigee);

      // ... mais le journal repond encore « quel seuil appliquiez-vous avant ? ».
      const [trace] = listerJournalAudit(base, {
        table: 'parametre',
        enregistrementId: avant.id,
      });
      expect(trace?.action).toBe('modification');
      expect(trace?.valeurAvant?.valeur).toBe(valeurInitiale);
      expect(trace?.valeurApres?.valeur).toBe(valeurCorrigee);
      expect(trace?.parQui).toBe('Propriétaire');
    });

    it('trace la cle et la periode de validite, pas seulement la valeur', () => {
      const avant = ligneParametre(base, CLE_SEUIL_TVA);
      corrigerParametre(base, avant.id, '1');

      const [trace] = listerJournalAudit(base, { table: 'parametre' });
      // Une valeur nue serait illisible : il faut savoir de quelle cle et de
      // quelle periode elle provenait.
      expect(trace?.valeurAvant?.cle).toBe(CLE_SEUIL_TVA);
      expect(trace?.valeurAvant?.dateDebutValidite).toBe(avant.dateDebutValidite);
      expect(trace?.valeurAvant?.source).toBe(avant.source);
    });

    it('empile les corrections successives sans jamais en ecraser une', () => {
      const ligne = ligneParametre(base, CLE_SEUIL_TVA);
      const initiale = valeurCatalogue(CLE_SEUIL_TVA);

      corrigerParametre(base, ligne.id, '2600000');
      corrigerParametre(base, ligne.id, '2700000');

      const traces = listerJournalAudit(base, { table: 'parametre' });
      expect(traces).toHaveLength(2);
      // Ordre du plus recent au plus ancien : la chaine complete se relit.
      expect(traces[0]?.valeurAvant?.valeur).toBe('2600000');
      expect(traces[0]?.valeurApres?.valeur).toBe('2700000');
      expect(traces[1]?.valeurAvant?.valeur).toBe(initiale);
      expect(traces[1]?.valeurApres?.valeur).toBe('2600000');
    });

    it('refuse de corriger un parametre inexistant, sans rien journaliser', () => {
      expect(() => corrigerParametre(base, 'identifiant-inconnu', '1')).toThrow(ErreurIntrouvable);
      expect(listerJournalAudit(base, { table: 'parametre' })).toHaveLength(0);
    });
  });

  describe('nouvelle version datee', () => {
    it('journalise la creation avec l’instantane de la ligne inseree', () => {
      const id = ajouterVersionParametre(
        base,
        {
          cle: CLE_SEUIL_TVA,
          valeur: '2600000',
          typeValeur: 'entier',
          dateDebutValidite: '2027-01-01',
          source: 'SPF Finances — valeur 2027.',
          description: 'Seuil de franchise TVA 2027.',
        },
        'Propriétaire',
      );

      const [trace] = listerJournalAudit(base, {
        table: 'parametre',
        enregistrementId: id,
      });
      expect(trace?.action).toBe('creation');
      expect(trace?.valeurAvant).toBeNull();
      expect(trace?.valeurApres?.valeur).toBe('2600000');
      expect(trace?.valeurApres?.dateDebutValidite).toBe('2027-01-01');

      // La version precedente n'a pas bouge : rien ne s'efface.
      const versions = listerParametres(base).filter((l) => l.cle === CLE_SEUIL_TVA);
      expect(versions).toHaveLength(2);
    });
  });

  describe('atomicite', () => {
    it('n’ecrit rien quand la transaction englobante echoue', () => {
      expect(() =>
        base.transaction((tx) => {
          const baseTx = tx as unknown as BaseBatte;
          journaliser(baseTx, {
            table: 'parametre',
            enregistrementId: 'peu-importe',
            action: 'modification',
            valeurApres: { valeur: '999' },
          });
          // Echec APRES la journalisation : une trace qui survivrait a un echec
          // decrirait une modification qui n'a jamais eu lieu.
          throw new Error('échec simulé');
        }),
      ).toThrow('échec simulé');

      expect(listerJournalAudit(base)).toHaveLength(0);
    });

    it('conserve la valeur d’origine quand la correction echoue', () => {
      const ligne = ligneParametre(base, CLE_SEUIL_TVA);

      expect(() =>
        base.transaction((tx) => {
          const baseTx = tx as unknown as BaseBatte;
          corrigerParametre(baseTx, ligne.id, '1');
          throw new Error('échec simulé');
        }),
      ).toThrow('échec simulé');

      // Ni la valeur ni la trace : les deux tombent ensemble.
      expect(ligneParametre(base, CLE_SEUIL_TVA).valeur).toBe(valeurCatalogue(CLE_SEUIL_TVA));
      expect(listerJournalAudit(base, { table: 'parametre' })).toHaveLength(0);
    });
  });

  /**
   * `tablesTracees` — descendue depuis une requête Drizzle qui vivait
   * directement dans `apps/api/src/routes/audit.ts` (CLAUDE.md §3 règle 1).
   */
  describe('tablesTracees', () => {
    it('rend zéro table sur un journal vierge', () => {
      expect(tablesTracees(base)).toEqual([]);
    });

    it('rend les tables réellement tracées, triées, sans doublon', () => {
      journaliser(base, { table: 'produit', enregistrementId: 'p-1', action: 'creation' });
      journaliser(base, { table: 'ingredient', enregistrementId: 'i-1', action: 'creation' });
      // Une seconde écriture sur `produit` ne doit pas dupliquer l'entrée.
      journaliser(base, { table: 'produit', enregistrementId: 'p-2', action: 'creation' });

      expect(tablesTracees(base)).toEqual(['ingredient', 'produit']);
    });
  });
});
