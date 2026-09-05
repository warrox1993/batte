import { describe, expect, it } from 'vitest';
import type { ObjectifLigneContrat } from '@batte/core';
import {
  erreursSaisieObjectif,
  libelleCibleAnnulationObjectif,
  type BrouillonObjectif,
} from './Objectifs';

/**
 * Recette clavier du 30/07/2026, deux défauts distincts sur l'écran Objectifs.
 *
 * 1. Un refus d'enregistrement affichait un bandeau de PAGE : le focus restait
 *    sur le bouton « Enregistrer », et le champ « Cible » fautif n'était
 *    marqué invalide nulle part — ni bordure rouge, ni `aria-invalid`. Sept
 *    autres écrans (Ingrédients, Produits, Fournisseurs, Lieux de marché,
 *    Concurrents, Équipements, Nomenclature de vente) partagent déjà le même
 *    mécanisme : `setChampsEnErreurObjectif` toujours suivie de
 *    `focaliserPremierChampFautifObjectif`. `erreursSaisieObjectif` est la
 *    fonction PURE qui décide QUEL champ est fautif, extraite pour être
 *    testée sans rendre l'écran du tout.
 *
 * 2. Un nouvel objectif arrivait avec Début ET Fin pré-remplis au MÊME JOUR
 *    (aujourd'hui) : pour une cible de « chiffre d'affaires cumulé », rien ne
 *    pouvait jamais le valider si l'utilisateur ne pensait pas à changer la
 *    fin. `dateFinSaisie` part maintenant VIDE (voir le composant) — un choix
 *    actif est exigé, jamais un défaut plausible mais faux (la doctrine du
 *    projet : une valeur inconnue vaut `null`, jamais une valeur plausible).
 *    `objectif.date_fin` est `NOT NULL` (packages/db/src/schema.ts) : ce
 *    "null" ne peut donc vivre que côté écran, sous forme d'un champ vide qui
 *    bloque l'enregistrement tant qu'il n'est pas choisi — jamais transmis
 *    tel quel au serveur. Aucune migration n'a été faite ce soir.
 *
 * CE QUE CES TESTS NE PROUVENT PAS : que `focaliserPremierChampFautifObjectif`
 * retrouve effectivement le bon nœud DOM (`[name="…"]`) et lui donne le focus,
 * ni que la bordure rouge / `aria-invalid` s'affichent réellement à l'écran —
 * ces deux derniers points ne sont vérifiables qu'à la main ou avec un
 * navigateur (même limite que le reste de cet écran et de `Produits.test.tsx`,
 * `Fournisseurs.test.tsx`).
 */

const BROUILLON_VALIDE: BrouillonObjectif = {
  grandeur: 'chiffre_affaires',
  dateDebut: '2026-08-01',
  dateFin: '2026-08-31',
  valeurCible: '1000,00',
};

describe('erreursSaisieObjectif — le champ que le focus doit atteindre en premier', () => {
  it('ne signale rien sur un brouillon entièrement valide', () => {
    expect(erreursSaisieObjectif(BROUILLON_VALIDE)).toEqual({});
  });

  it('signale « dateFin » quand la date de fin est VIDE — jamais un objectif né invérifiable', () => {
    const erreurs = erreursSaisieObjectif({ ...BROUILLON_VALIDE, dateFin: '' });
    expect(Object.keys(erreurs)).toEqual(['dateFin']);
    expect(erreurs['dateFin']).toMatch(/ne pourra jamais être évalué/);
  });

  it('signale « dateFin » quand début et fin sont inversés', () => {
    const erreurs = erreursSaisieObjectif({
      ...BROUILLON_VALIDE,
      dateDebut: '2026-08-31',
      dateFin: '2026-08-01',
    });
    expect(Object.keys(erreurs)).toEqual(['dateFin']);
    expect(erreurs['dateFin']).toMatch(/postérieure ou égale/);
  });

  it('N’ACCUSE PAS début et fin identiques : un objectif d’un seul jour reste un choix valide', () => {
    // Le défaut mesuré est le défaut PLAUSIBLE-MAIS-FAUX (aujourd'hui pour les
    // deux, sans que l'utilisateur l'ait choisi) — pas la coïncidence en
    // elle-même : si l'utilisateur choisit délibérément le même jour deux
    // fois, ce n'est plus un oubli.
    const erreurs = erreursSaisieObjectif({
      ...BROUILLON_VALIDE,
      dateDebut: '2026-08-15',
      dateFin: '2026-08-15',
    });
    expect(erreurs).toEqual({});
  });

  it('signale « valeurCible » quand la cible est vide ou illisible (montant)', () => {
    expect(Object.keys(erreursSaisieObjectif({ ...BROUILLON_VALIDE, valeurCible: '' }))).toEqual([
      'valeurCible',
    ]);
    expect(Object.keys(erreursSaisieObjectif({ ...BROUILLON_VALIDE, valeurCible: 'abc' }))).toEqual(
      ['valeurCible'],
    );
  });

  it('signale « valeurCible » quand la cible est nulle ou négative (montant)', () => {
    expect(
      Object.keys(erreursSaisieObjectif({ ...BROUILLON_VALIDE, valeurCible: '0,00' })),
    ).toEqual(['valeurCible']);
  });

  it('exige un ENTIER pour « nombre_sessions », jamais de décimales', () => {
    const brouillon: BrouillonObjectif = {
      ...BROUILLON_VALIDE,
      grandeur: 'nombre_sessions',
      valeurCible: '6',
    };
    expect(erreursSaisieObjectif(brouillon)).toEqual({});
    expect(Object.keys(erreursSaisieObjectif({ ...brouillon, valeurCible: '6,5' }))).toEqual([
      'valeurCible',
    ]);
    expect(Object.keys(erreursSaisieObjectif({ ...brouillon, valeurCible: '0' }))).toEqual([
      'valeurCible',
    ]);
  });

  it('signale « dateFin » EN PREMIER quand dateFin et valeurCible sont TOUTES DEUX fautives', () => {
    // Ordre stable : `focaliserPremierChampFautifObjectif` ne prend QUE la
    // première clé — l'ordre d'insertion décide donc quel champ reçoit le
    // focus. La date de fin passe en premier : sans elle, la cible n'a même
    // pas de période à évaluer.
    const erreurs = erreursSaisieObjectif({ ...BROUILLON_VALIDE, dateFin: '', valeurCible: '' });
    expect(Object.keys(erreurs)[0]).toBe('dateFin');
  });
});

/**
 * `objectifAnnuleId` (`schemaObjectifLigne`, docs/21-CHAMPS-NON-LUS.md §5) :
 * le badge « Correction » disait QU'un objectif corrige quelque chose, jamais
 * LEQUEL. `libelleCibleAnnulationObjectif` referme ce trou par un JOIN
 * d'affichage sur la liste déjà chargée — jamais un second calcul.
 */
describe('libelleCibleAnnulationObjectif', () => {
  function objectif(overrides: Partial<ObjectifLigneContrat> = {}): ObjectifLigneContrat {
    return {
      id: 'o1',
      grandeur: 'marge_nette',
      dateDebut: '2026-01-01',
      dateFin: '2026-03-31',
      valeurCible: 100000,
      notes: null,
      estAnnulation: false,
      objectifAnnuleId: null,
      estAnnule: false,
      creeLe: '2026-01-01T10:00:00.000Z',
      modifieLe: '2026-01-01T10:00:00.000Z',
      evaluation: {
        grandeur: 'marge_nette',
        valeurCible: 100000,
        realise: null,
        ecart: null,
        avancementBp: null,
        statut: 'sans_donnee',
        periodeTerminee: false,
      },
      ...overrides,
    };
  }

  it('rend `null` quand la ligne n’est pas une correction (`objectifAnnuleId` absent)', () => {
    expect(libelleCibleAnnulationObjectif(null, [objectif()])).toBeNull();
  });

  it('nomme la grandeur et la période de l’objectif corrigé', () => {
    const originale = objectif({
      id: 'o1',
      grandeur: 'marge_nette',
      dateDebut: '2026-01-01',
      dateFin: '2026-03-31',
    });
    const toutes = [originale, objectif({ id: 'o2', objectifAnnuleId: 'o1', estAnnulation: true })];
    const resultat = libelleCibleAnnulationObjectif('o1', toutes);
    expect(resultat).not.toBeNull();
    expect(resultat).toContain('Marge nette');
    expect(resultat).toContain('01/01/2026');
    expect(resultat).toContain('31/03/2026');
  });

  it('rend `null` si la cible référencée n’existe plus dans la liste chargée (garde de robustesse)', () => {
    const toutes = [objectif({ id: 'o2', objectifAnnuleId: 'o-inconnu', estAnnulation: true })];
    expect(libelleCibleAnnulationObjectif('o-inconnu', toutes)).toBeNull();
  });
});
