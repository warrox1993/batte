/**
 * Garde du défaut GRAVE de l'audit `docs/31-DOCUMENTS-OUVERTS.md` §3.2
 * (31/07/2026) : l'étiquette de bac imprimait « Produit le 25/07/2026 02:00 »
 * et « DLC 26/07/2026 02:00 » — une heure entièrement FABRIQUÉE.
 *
 * CAUSE : `gabarits.ts` appelait `formaterDateHeure` (un formateur DATE+HEURE)
 * sur `donnees.dateProduction`, un JOUR CIVIL PUR (`"2026-07-25"`, sans
 * heure). `new Date("2026-07-25")` est interprété par JavaScript comme minuit
 * UTC, ce qui, reformaté en `Europe/Brussels` l'été (UTC+2), devient « 02:00 »
 * — un instant qui n'a jamais représenté une heure réelle de production,
 * imprimé sur une étiquette de traçabilité (et qui change en hiver, ce qui
 * est pire). `dateDlc` porte la même maladie : son ancre est un minuit UTC
 * arbitraire (`ajouterHeures(dateProduction + 'T00:00:00Z', dureeHeures)`,
 * `packages/db/src/services/production.ts`), jamais un instant observé.
 *
 * CORRECTIF : `formaterDate` (date seule), déjà utilisé par l'écran pour ces
 * mêmes champs (`Production.tsx`), remplace `formaterDateHeure` dans
 * `etiquetteBac` (`gabarits.ts`).
 */

import { describe, expect, it } from 'vitest';
import {
  creerBase,
  enregistrerReception,
  lancerProduction,
  migrer,
  schema,
  seed,
  type BaseBatte,
} from '@batte/db';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { donneesEtiquetteBac } from './donnees.js';
import { etiquetteBac, type DonneesEtiquette } from './gabarits.js';

function creerIngredientTest(base: BaseBatte, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.ingredient)
    .values({
      id,
      nom,
      categorie: 'garniture',
      uniteReference: 'g',
      allergenes: [],
      allergenesVerifies: true,
      stockSecurite: 0,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function creerFournisseurTest(base: BaseBatte, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.fournisseur)
    .values({
      id,
      nom,
      type: 'grossiste',
      delaiLivraisonJours: 2,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function creerRecetteTest(
  base: BaseBatte,
  code: string,
  lignes: readonly { ingredientId: string; quantiteUniteRef: number }[],
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.recette)
    .values({
      id,
      code,
      nom: `Recette de test ${code}`,
      version: 1,
      statut: 'active',
      typePate: 'froment',
      sansGluten: false,
      rendementReferenceMl: 5000,
      rendementReferenceCrepes: 66,
      perteCuissonBp: 0,
      tauxCasseBp: 0,
      perteFixeMl: 0,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  base
    .insert(schema.recetteLigne)
    .values(
      lignes.map((l, index) => ({
        id: nouvelIdentifiant(),
        recetteId: id,
        ingredientId: l.ingredientId,
        quantiteUniteRef: l.quantiteUniteRef,
        ordre: index,
        noteTechnique: null,
      })),
    )
    .run();

  return id;
}

/** Aucun caractère `HH:MM` nulle part dans le document. */
function neContientAucuneHeure(html: string): void {
  expect(html).not.toMatch(/\d{2}:\d{2}/);
}

describe('Étiquette de bac — plus aucune heure fabriquée sur une date jour-civil-pur', () => {
  it(
    'appelée directement (fonction PURE, données à la main) : ' +
      "produit le 25/07/2026 en ÉTÉ (UTC+2) — le cas exact de l'audit — " +
      "n'affiche JAMAIS « 02:00 »",
    () => {
      const donnees: DonneesEtiquette = {
        numeroLotPate: 'PATE-PR-2026-0001',
        recetteCode: 'R1',
        recetteNom: 'Pâte à crêpes froment',
        // Jour civil PUR, exactement la forme produite par
        // `documents/donnees.ts` (`detail.dateProduction`).
        dateProduction: '2026-07-25',
        // ISO ancré à un minuit UTC arbitraire, exactement la forme produite
        // par `ajouterHeures('2026-07-25T00:00:00Z', 24)`
        // (`packages/db/src/services/production.ts`).
        dateDlc: '2026-07-26T00:00:00.000Z',
        volumeMl: 5000,
        allergenes: ['gluten'],
        allergenesVerifies: true,
      };

      const { html } = etiquetteBac(donnees);

      // AVANT LE CORRECTIF, ce texte exact s'imprimait : un instant fabriqué.
      expect(html).not.toContain('02:00');
      neContientAucuneHeure(html);

      // Les DEUX jours doivent rester lisibles, en date seule.
      expect(html).toContain('25/07/2026');
      expect(html).toContain('26/07/2026');
    },
  );

  it('produit le 15/01/2026 en HIVER (UTC+1) : même garde, l’autre saison', () => {
    const donnees: DonneesEtiquette = {
      numeroLotPate: 'PATE-PR-2026-0002',
      recetteCode: 'R1',
      recetteNom: 'Pâte à crêpes froment',
      dateProduction: '2026-01-15',
      dateDlc: '2026-01-16T00:00:00.000Z',
      volumeMl: 5000,
      allergenes: ['gluten'],
      allergenesVerifies: true,
    };

    const { html } = etiquetteBac(donnees);

    // L'hiver, le même défaut aurait imprimé « 01:00 » (UTC+1) — une heure
    // DIFFÉRENTE de l'été pour la même absence de saisie, la preuve que
    // l'heure n'a jamais eu de sens métier.
    neContientAucuneHeure(html);
    expect(html).toContain('15/01/2026');
    expect(html).toContain('16/01/2026');
  });

  it(
    'chaîne réelle (dépôt → `donneesEtiquetteBac` → `etiquetteBac`), pas seulement le ' +
      'gabarit sur des données à la main',
    () => {
      const base = creerBase(':memory:');
      migrer(base);
      seed(base);

      const idFournisseur = creerFournisseurTest(base, 'Fournisseur étiquette-date (test)');
      const idFarine = creerIngredientTest(base, 'Farine étiquette-date (test)');
      const idRecette = creerRecetteTest(base, 'RTEST-ETIQ-DATE', [
        { ingredientId: idFarine, quantiteUniteRef: 100 },
      ]);

      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2026-07-01',
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 100_000,
            prixLigneCents: 1000,
            numeroLotFournisseur: 'LOT-TEST-ETIQ-DATE',
          },
        ],
      });

      const production = lancerProduction(base, {
        recetteId: idRecette,
        cible: { type: 'volume', volumeMl: 1000 },
        dateProduction: '2026-07-25',
      });

      const donnees = donneesEtiquetteBac(base, production.productionId);
      expect(donnees).not.toBeNull();
      // La chaîne réelle produit bien un jour civil pur, pas un instant.
      expect(donnees?.dateProduction).toBe('2026-07-25');

      const { html } = etiquetteBac(donnees!);
      expect(html).not.toContain('02:00');
      neContientAucuneHeure(html);
      expect(html).toContain('25/07/2026');
    },
  );
});
