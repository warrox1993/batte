/**
 * Tests du verrou de période appliqué à `enregistrerReception`.
 *
 * Défaut d'intégrité comptable (audit documentaire) : `periode.statut =
 * 'verrouillee'` existait en base sans qu'aucun code ne l'applique — on
 * pouvait enregistrer une réception datée dans un exercice verrouillé
 * exactement comme si de rien n'était. `verifierPeriodeNonVerrouillee`
 * (`../depots/comptabilite.ts`) corrige ce point ; ce fichier le prouve pour
 * le point d'écriture « réception ».
 *
 * Le reste du comportement de `enregistrerReception` (création de lot, FEFO,
 * avertissement DLC seule…) est déjà couvert ailleurs (`services/production.test.ts`,
 * `depots/stock.test.ts`, `depots/tracabilite.test.ts`) : pas de duplication ici.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { fournisseur, ingredient, lot, mouvementStock, periode, reception } from '../schema.js';
import { enregistrerReception } from './reception.js';

/** Voir le même utilitaire dans `depots/comptabilite.test.ts` — pas de fonction
 * de production ne pose ce statut, la seule voie est l'écriture directe. */
function verrouillerPeriode(base: BaseBatte, annee: number, mois: number): void {
  const maintenant = maintenantUtc();
  base
    .insert(periode)
    .values({
      id: nouvelIdentifiant(),
      annee,
      mois,
      statut: 'verrouillee',
      dateCloture: maintenant,
      clotureePar: null,
      dateReouverture: null,
      motifReouverture: null,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
}

describe('enregistrerReception — verrou de periode', () => {
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

  it('refuse une reception datee dans une periode verrouillee, sans rien ecrire', () => {
    verrouillerPeriode(base, 2026, 4);

    expect(() =>
      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2026-04-12',
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 500,
            numeroLotFournisseur: 'LOT-VERROU-1',
          },
        ],
      }),
    ).toThrow(ErreurMetier);

    // Atomicite : ni le document `reception`, ni le lot, ni le mouvement
    // d'entree ne doivent exister apres un refus.
    expect(base.select().from(reception).all()).toHaveLength(0);
    expect(base.select().from(lot).all()).toHaveLength(0);
    expect(base.select().from(mouvementStock).all()).toHaveLength(0);
  });

  it('nomme la periode verrouillee dans le message d erreur', () => {
    verrouillerPeriode(base, 2026, 4);

    try {
      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2026-04-12',
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 500,
            numeroLotFournisseur: 'LOT-VERROU-2',
          },
        ],
      });
      expect.unreachable('devait refuser');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('periode_verrouillee');
      expect((erreur as ErreurMetier).message).toContain('04/2026');
    }
  });

  it('reste possible dans une periode OUVERTE, meme quand un AUTRE mois est verrouille — zero regression', () => {
    verrouillerPeriode(base, 2026, 4);

    const resultat = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-05-12',
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 500,
          numeroLotFournisseur: 'LOT-VERROU-3',
        },
      ],
    });

    expect(resultat.lotsCrees).toHaveLength(1);
    expect(base.select().from(reception).all()).toHaveLength(1);
  });
});

/**
 * Mission « trois chemins de pièce jointe jamais utilisés » (30/07/2026).
 *
 * `reception.fichier_scan_path` est désormais écrivable avec une vraie valeur
 * (Data URI, même décision de conception que `services/factures.ts`) — mais
 * SEULEMENT au niveau de ce service. `enregistrerReception` n'est appelée que
 * depuis `apps/api/src/routes/stock.ts`, hors du périmètre d'écriture de
 * cette mission (fichier explicitement protégé) : aucune route HTTP ne
 * transmet ce champ aujourd'hui. Ces tests prouvent la capacité de
 * PERSISTANCE, pas la reachabilité HTTP — voir le rapport de livraison.
 */
describe('enregistrerReception — pièce jointe (bon de livraison scanné)', () => {
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

  const PIECE_VALIDE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  it('persiste une pièce jointe valide sur la réception', () => {
    const resultat = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-27',
      fichierScanPath: PIECE_VALIDE,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 500,
          numeroLotFournisseur: 'LOT-PJ-1',
        },
      ],
    });

    const ligne = base
      .select({ fichierScanPath: reception.fichierScanPath })
      .from(reception)
      .where(eq(reception.id, resultat.receptionId))
      .get();
    expect(ligne?.fichierScanPath).toBe(PIECE_VALIDE);
  });

  it("reste à `null` quand aucune pièce n'est fournie — comportement inchangé", () => {
    const resultat = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-27',
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 500,
          numeroLotFournisseur: 'LOT-PJ-2',
        },
      ],
    });

    const ligne = base
      .select({ fichierScanPath: reception.fichierScanPath })
      .from(reception)
      .where(eq(reception.id, resultat.receptionId))
      .get();
    expect(ligne?.fichierScanPath).toBeNull();
  });

  it('traite une chaîne vide comme `null`, jamais comme un chemin (CLAUDE.md §7)', () => {
    const resultat = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-07-27',
      fichierScanPath: '   ',
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 500,
          numeroLotFournisseur: 'LOT-PJ-3',
        },
      ],
    });

    const ligne = base
      .select({ fichierScanPath: reception.fichierScanPath })
      .from(reception)
      .where(eq(reception.id, resultat.receptionId))
      .get();
    expect(ligne?.fichierScanPath).toBeNull();
  });

  it("refuse un chemin disque : ce n'est pas une Data URI reconnue", () => {
    expect(() =>
      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2026-07-27',
        fichierScanPath: 'C:\\Users\\porteur\\Documents\\bon-livraison.pdf',
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 500,
            numeroLotFournisseur: 'LOT-PJ-4',
          },
        ],
      }),
    ).toThrow(ErreurMetier);
  });
});
