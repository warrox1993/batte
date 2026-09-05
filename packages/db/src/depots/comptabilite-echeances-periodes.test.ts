/**
 * Trois branches de `depots/comptabilite.ts` que rien n'exerçait.
 *
 * 1. `taux_deductible_invalide` sur `enregistrerDepense`. La part déductible
 *    est en points de base ; hors de [0 ; 10 000] elle produirait une charge
 *    déductible supérieure à la dépense elle-même — un chiffre que
 *    CLAUDE.md §7 interdit d'écrire.
 *
 * 2. `marquerEcheanceFaite` sur une échéance PONCTUELLE, et sur une échéance
 *    ABSENTE du catalogue (saisie à la main). Les deux branches décident si
 *    l'échéance rebondit ou reste faite ; une échéance ponctuelle qui
 *    rebondirait réapparaîtrait tous les ans à l'écran, une échéance
 *    récurrente qui ne rebondirait pas disparaîtrait de l'échéancier.
 *
 * 3. `periode_deja_ouverte` sur `rouvrirPeriode` — le seul des trois refus de
 *    cette fonction qui n'était pas couvert.
 */

import { ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { echeance, fournisseur, periode } from '../schema.js';
import {
  cloturerPeriode,
  enregistrerDepense,
  marquerEcheanceFaite,
  rouvrirPeriode,
} from './comptabilite.js';

function attendCode(fn: () => unknown, code: string): ErreurMetier {
  try {
    fn();
    expect.unreachable(`devait lever une ErreurMetier de code « ${code} »`);
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect((erreur as ErreurMetier).code).toBe(code);
    return erreur as ErreurMetier;
  }
  throw new Error('inatteignable');
}

describe('enregistrerDepense — part déductible hors bornes', () => {
  let base: BaseBatte;
  let idFournisseur: string;

  function depense(deductibleBp: number | undefined) {
    return {
      dateDepense: '2026-03-10',
      libelle: 'Bonbonne de gaz',
      montantCents: 4500,
      categorie: 'materiel' as const,
      fournisseurId: idFournisseur,
      ...(deductibleBp === undefined ? {} : { deductibleBp }),
    };
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    idFournisseur = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(fournisseur)
      .values({
        id: idFournisseur,
        nom: 'Distributeur gaz',
        type: 'grossiste',
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  });

  it('accepte les deux bornes exactes : 0 % et 100 %', () => {
    // Le contrôle porte sur « hors bornes », pas sur « au bord » : une garde
    // écrite avec `<=` / `>=` refuserait à tort ces deux cas parfaitement
    // légitimes (un frais non déductible, un frais entièrement déductible).
    expect(enregistrerDepense(base, depense(0)).id).toBeTypeOf('string');
    expect(enregistrerDepense(base, depense(10_000)).id).toBeTypeOf('string');
  });

  it('refuse une part déductible négative', () => {
    const erreur = attendCode(
      () => enregistrerDepense(base, depense(-1)),
      'taux_deductible_invalide',
    );
    expect(erreur.champs).toHaveProperty('deductibleBp');
  });

  it('refuse une part déductible au-delà de 100 %', () => {
    attendCode(() => enregistrerDepense(base, depense(10_001)), 'taux_deductible_invalide');
  });
});

describe('marquerEcheanceFaite', () => {
  let base: BaseBatte;

  function insererEcheance(
    libelle: string,
    recurrence: 'annuelle' | 'ponctuelle',
    prochaineDate: string,
  ): string {
    const id = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(echeance)
      .values({
        id,
        libelle,
        recurrence,
        prochaineDate,
        sourceLegale: 'saisie manuelle',
        urlSource: null,
        montantEstimeCents: null,
        statut: 'a_venir',
        dateRealisation: null,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    return id;
  }

  function relire(id: string) {
    return base.select().from(echeance).where(eq(echeance.id, id)).get()!;
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  it('une échéance PONCTUELLE reste faite : elle ne rebondit jamais', () => {
    const id = insererEcheance('Dépôt du dossier Airbag', 'ponctuelle', '2026-06-30');
    marquerEcheanceFaite(base, id, '2026-06-25');

    const apres = relire(id);
    expect(apres.statut).toBe('faite');
    expect(apres.dateRealisation).toBe('2026-06-25');
    // Discrimine : la date butoir NE BOUGE PAS. Un rebond la porterait à 2027.
    expect(apres.prochaineDate).toBe('2026-06-30');
  });

  it('une échéance récurrente SAISIE À LA MAIN (hors catalogue) rebondit d’un an', () => {
    // Repli documenté : sans définition au catalogue, on retombe sur un pas
    // annuel plutôt que de laisser l'échéance disparaître de l'échéancier.
    const id = insererEcheance('Assurance RC exploitation', 'annuelle', '2026-09-15');
    marquerEcheanceFaite(base, id, '2026-09-10');

    const apres = relire(id);
    expect(apres.statut).toBe('a_venir');
    expect(apres.prochaineDate).toBe('2027-09-15');
  });

  it('l’ancrage du rebond est la date BUTOIR, pas la date de réalisation', () => {
    // Une échéance honorée EN AVANCE doit tout de même passer à l'année
    // suivante — jamais retomber sur elle-même parce que la réalisation
    // précède la date butoir. C'est exactement le piège que le test précédent
    // ne discriminerait pas seul si la réalisation était postérieure.
    const id = insererEcheance('Cotisation fédération', 'annuelle', '2026-12-31');
    marquerEcheanceFaite(base, id, '2026-01-02');
    expect(relire(id).prochaineDate).toBe('2027-12-31');
  });
});

describe('rouvrirPeriode — refus sur une période déjà ouverte', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  it('refuse de rouvrir une période au statut « ouverte »', () => {
    const id = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(periode)
      .values({
        id,
        annee: 2026,
        mois: 4,
        statut: 'ouverte',
        dateCloture: null,
        clotureePar: null,
        dateReouverture: null,
        motifReouverture: null,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    attendCode(() => rouvrirPeriode(base, id, 'correction de saisie'), 'periode_deja_ouverte');
    // Rien n'a été tracé : un motif de réouverture sur une période jamais
    // fermée mentirait à qui relit le dossier.
    expect(
      base.select().from(periode).where(eq(periode.id, id)).get()!.motifReouverture,
    ).toBeNull();
  });

  it('rouvre en revanche une période RÉELLEMENT clôturée, et trace le motif', () => {
    // Discrimine : sans ce cas, `periode_deja_ouverte` pourrait masquer un
    // refus systématique de `rouvrirPeriode`.
    const { id } = cloturerPeriode(base, 2026, 5);
    expect(base.select().from(periode).where(eq(periode.id, id)).get()!.statut).toBe('cloturee');

    rouvrirPeriode(base, id, 'facture reçue en retard');
    const apres = base.select().from(periode).where(eq(periode.id, id)).get()!;
    expect(apres.statut).toBe('ouverte');
    expect(apres.motifReouverture).toBe('facture reçue en retard');
  });
});
