/**
 * Audit ciblé du 29/07/2026 — zone d'écriture : référentiel et recettes
 * (`packages/core/src/{recettes,unites,production,recherche-ingredients}.ts`,
 * `packages/db/src/depots/{recettes,referentiel,referentiel-ecriture}.ts`,
 * les routes correspondantes et les écrans `Recettes.tsx`, `Ingredients.tsx`,
 * `Fournisseurs.tsx`, `Production.tsx`).
 *
 * MÉTHODE : chercher des conversions d'unité qui contournent `convertir()`, des
 * arrondis faits trop tôt (une quantité entière multipliée par un prix AVANT
 * le total, plutôt que l'inverse), des petites quantités qui disparaissent du
 * coût sans bruit, un versionnage de recette qui laisserait un calcul afficher
 * la mauvaise version, un conditionnement mal converti, et un rendement codé
 * en dur. Chaque conclusion ci-dessous a été VÉRIFIÉE, jamais supposée : lue
 * dans le code source, recalculée à la main avec les vraies données de
 * `donnees/batte.sqlite` (lecture seule), ou les deux.
 *
 * CE QUI A ÉTÉ BALAYÉ ET N'EST PAS RÉOUVERT ICI (vérifié, pas trouvé fautif) :
 *
 *  - `unites.ts::convertir` refuse déjà une conversion masse<->volume sans
 *    densité finie et strictement positive, refuse `piece` des deux côtés, et
 *    aucun appelant de `packages/core` ni de `packages/db` (zone de cet agent)
 *    ne multiplie une masse par une densité à la main : `grep` sur
 *    `densiteGParMl` dans tout le dépôt ne montre que la déclaration du champ,
 *    sa validation Zod (`contrats/referentiel.ts`) et les tests de
 *    `convertir` lui-même.
 *  - Le versionnage (D-005) est correct de bout en bout : `production.recetteId`
 *    pointe la VERSION précise utilisée (jointure sur `recette.id`, jamais sur
 *    `recette.code`), `modifierRecette` refuse dès qu'une production existe
 *    (`recette_scellee`), et `apps/api/src/documents/donnees.ts` (hors zone,
 *    lu pour vérifier) relit explicitement « la VERSION consommée ce jour-là,
 *    pas la version courante » pour l'étiquette de lot. Un calcul de coût ou
 *    une affichette d'allergènes ne peut donc pas afficher l'ancienne version
 *    d'une recette pour une production récente.
 *  - Le rendement de référence (R1 ≈ 66 crêpes/5 L, R2 ≈ 68) n'est codé en dur
 *    NULLE PART dans `recettes.ts` ni `production.ts` : `rendementReferenceMl`
 *    et `rendementReferenceCrepes` sont des colonnes de `recette`, jamais des
 *    littéraux. Les seules occurrences de 66/68/455/441 sont des données de
 *    seed et des fixtures de test, explicitement documentées comme telles.
 *    `verifierRecette` refuse un rendement net nul ou négatif
 *    (`rendement_net_nul`), et `schemaSaisieRecette` (contrats/referentiel.ts)
 *    plafonne chaque perte à 9 000 bp (90 %) : aucune saisie via l'API ne peut
 *    donc annuler la production — un rendement net absurde n'est atteignable
 *    que par une écriture directe en base, hors périmètre applicatif.
 *  - Le conditionnement respecte D-044 : `conditionnement.prixCents` est le
 *    MONTANT payé pour `quantiteUniteRef` (toujours exprimée dans l'unité de
 *    référence de l'ingrédient — un sac de 25 kg de farine est saisi comme
 *    25 000 g, jamais comme 25 kg à convertir), et le taux unitaire est
 *    toujours DÉRIVÉ à la lecture (`prixCents / quantiteUniteRef`, en flottant,
 *    jamais stocké) — jamais l'inverse. `schemaSaisieConditionnement` interdit
 *    une contenance nulle ou négative (elle diviserait le prix).
 *
 * Deux défauts réels ont été trouvés dans cette zone, TOUS DEUX CORRIGÉS
 * DEPUIS (29/07/2026, second passage). Le premier — l'arrondi ligne à ligne
 * de `mettreAEchelle` — est encodé ci-dessous (pur, sans base de données),
 * désormais en test de non-régression. Le second — un ingrédient SANS
 * conditionnement actif dont le coût était traité comme GRATUIT (0) plutôt que
 * comme INCONNU (null) dans `depots/recettes.ts::coutsDeReference` — exigeait
 * un accès base et vit donc dans
 * `packages/db/src/depots/referentiel.test.ts` (même zone d'écriture), pas
 * ici : `packages/core` ne dépend jamais de `packages/db` (règle
 * d'architecture n°1). `mettreAEchelle` et `coutProduitVendu` propagent
 * désormais ce `null` jusqu'au contrat HTTP (`contrats/recettes.ts`) et
 * jusqu'à l'écran (`apps/web/src/pages/Recettes.tsx`) : un test complémentaire
 * ci-dessous vérifie la propagation au niveau de la fonction pure elle-même.
 */

import { describe, expect, it } from 'vitest';
import { mettreAEchelle, type RecetteCalcul } from './recettes.js';

/**
 * R1 telle qu'elle existe RÉELLEMENT dans `donnees/batte.sqlite` (vérifié par
 * une requête SQL en lecture seule le 29/07/2026, `readonly: true`, connexion
 * séparée) : les huit lignes de `recette_ligne`, avec le taux dérivé de leur
 * conditionnement actif (`prix_cents / quantite_unite_ref`, D-018/D-044). Le
 * rendement de référence (455 ml, 6 crêpes) est la valeur réellement stockée
 * pour R1 v1 — ce n'est PAS une fixture inventée pour ce test.
 */
const R1_REELLE: RecetteCalcul = {
  id: 'r1',
  code: 'R1',
  rendementReferenceMl: 455,
  rendementReferenceCrepes: 6,
  perteCuissonBp: 0,
  tauxCasseBp: 0,
  lignes: [
    {
      ingredientId: 'farine-t55',
      nomIngredient: 'Farine de froment T55',
      unite: 'g',
      quantiteReference: 145,
      cumpCentsParUnite: 1875 / 25_000, // Sac 25 kg à 18,75 €
      allergenes: ['gluten'],
    },
    {
      ingredientId: 'lait-entier',
      nomIngredient: 'Lait entier',
      unite: 'ml',
      quantiteReference: 240,
      cumpCentsParUnite: 115 / 1000, // Brique 1 L à 1,15 €
      allergenes: ['lait'],
    },
    {
      ingredientId: 'oeuf',
      nomIngredient: 'Œufs entiers',
      unite: 'piece',
      quantiteReference: 2,
      cumpCentsParUnite: 600 / 30, // Plaque de 30 à 6,00 €
      allergenes: ['oeufs'],
    },
    {
      ingredientId: 'beurre',
      nomIngredient: 'Beurre',
      unite: 'g',
      quantiteReference: 55,
      cumpCentsParUnite: 450 / 500, // Plaquette 500 g à 4,50 €
      allergenes: ['lait'],
    },
    {
      ingredientId: 'vergeoise',
      nomIngredient: 'Vergeoise blonde',
      unite: 'g',
      quantiteReference: 23,
      cumpCentsParUnite: 320 / 1000, // Paquet 1 kg à 3,20 €
      allergenes: [],
    },
    {
      ingredientId: 'sel',
      nomIngredient: 'Sel fin',
      unite: 'g',
      // Le chiffre exact de CLAUDE.md §6 : 2 g de sel pour 6 crêpes.
      quantiteReference: 2,
      cumpCentsParUnite: 90 / 1000, // Paquet 1 kg à 0,90 €
      allergenes: [],
    },
    {
      ingredientId: 'sucre-vanille',
      nomIngredient: 'Sucre vanillé',
      unite: 'g',
      quantiteReference: 8,
      cumpCentsParUnite: 130 / 75, // Boîte de 10 sachets (7,5 g) à 1,30 €
      allergenes: [],
    },
    {
      ingredientId: 'fleur-oranger',
      nomIngredient: "Eau de fleur d'oranger",
      unite: 'ml',
      // Le chiffre exact de CLAUDE.md §6 : 4 ml d'eau de fleur d'oranger.
      quantiteReference: 4,
      cumpCentsParUnite: 290 / 250, // Flacon 250 ml à 2,90 €
      allergenes: [],
    },
  ],
};

describe('audit référentiel 29/07/2026 — arrondi de mettreAEchelle', () => {
  it(
    'CORRIGÉ : mettreAEchelle totalise les lignes en flottant PUIS arrondit UNE fois ' +
      "(« totaliser d'abord, arrondir à la fin »), au lieu d'arrondir chaque ligne avant de sommer",
    () => {
      /**
       * Constat, vérifié à la main avec les VRAIS prix de R1 (voir le
       * commentaire de `R1_REELLE` ci-dessus) : au rendement de référence
       * (facteur 1, 455 ml pour 6 crêpes), le coût EXACT (non arrondi) de la
       * fournée vaut 154,0217 centimes — farine 10,875 + lait 27,6 + œufs 40
       * + beurre 49,5 + vergeoise 7,36 + SEL 0,18 + sucre vanillé 13,8667 +
       * fleur d'oranger 4,64. `Math.round` une seule fois sur ce total donne
       * 154 centimes.
       *
       * AVANT LE CORRECTIF, `mettreAEchelle` (packages/core/src/recettes.ts)
       * faisait l'inverse : `coutCents: Math.round(quantite *
       * ligne.cumpCentsParUnite)` PAR LIGNE, puis `coutMatiereCents = somme
       * des coutCents déjà arrondis`. Sur ce jeu de données réel, ça rendait
       * 155 centimes (farine 11 + lait 28 + œufs 40 + beurre 50 + vergeoise 7
       * + SEL 0 + sucre vanillé 14 + fleur d'oranger 5) — 1 centime au-dessus
       * du total exact, et surtout : la ligne du sel (2 g à 0,09 c/g =
       * 0,18 c) s'arrondissait à ZÉRO et disparaissait intégralement du
       * total, sans qu'aucun signal ne le dise. C'était exactement le défaut
       * que `docs/demandes/15` §4.1 décrit et affirme à tort réglé (« on
       * multiplie d'abord et on arrondit à la fin ») : c'était vrai
       * MULTIPLIER puis arrondir une fois PAR LIGNE, pas pour le TOTAL de la
       * recette.
       *
       * CORRECTIF (ce test) : `mettreAEchelle` accumule désormais le total
       * EXACT (non arrondi) ligne par ligne, et n'arrondit qu'UNE fois, à la
       * toute fin. Le total vaut donc maintenant 154, pas 155 — la ligne de
       * sel ne disparaît plus du TOTAL, même si son propre `coutCents`
       * individuel (affichage informatif par ligne) reste arrondi à 0.
       *
       * IMPACT MESURÉ sur R1 : l'ancien code produisait 1 centime de trop sur
       * 154 (≈ 0,6 %) au rendement de référence — negligeable en valeur
       * absolue avec les prix de démonstration actuels, mais l'écart n'était
       * borné par rien : un ingrédient cher utilisé en petite quantité (une
       * épice, un arôme onéreux) aurait subi le même mécanisme sans que sa
       * perte soit aussi anodine.
       */
      const resultat = mettreAEchelle(R1_REELLE, {
        type: 'volume',
        volumeMl: R1_REELLE.rendementReferenceMl,
      });

      const totalExactCentimes = R1_REELLE.lignes.reduce(
        (somme, ligne) => somme + ligne.quantiteReference * (ligne.cumpCentsParUnite ?? 0),
        0,
      );

      expect(resultat.coutMatiereCents).toBe(Math.round(totalExactCentimes));
      expect(resultat.coutMatiereCents).toBe(154);
    },
  );

  it('la ligne de sel (2 g) reste arrondie à 0 centime individuellement, mais ne disparaît plus du total', () => {
    // Ce test fige la valeur du symptôme d'origine (le coût PAR LIGNE du sel
    // reste 0, par arrondi d'affichage) tout en vérifiant que le correctif
    // tient sa promesse : ce 0 individuel ne fait plus disparaître le sel du
    // TOTAL, qui vaut 154 et non 155 (voir le test précédent).
    const resultat = mettreAEchelle(R1_REELLE, {
      type: 'volume',
      volumeMl: R1_REELLE.rendementReferenceMl,
    });
    const ligneSel = resultat.lignes.find((l) => l.ingredientId === 'sel');
    expect(ligneSel?.quantite).toBe(2); // La quantité PESÉE, elle, ne disparaît jamais.
    expect(ligneSel?.coutCents).toBe(0); // Arrondi d'affichage par ligne, inoffensif désormais.
    expect(resultat.coutMatiereCents).toBe(154); // Le sel PÈSE bien dans le total.
  });
});

describe('audit référentiel 29/07/2026 — coût inconnu (défaut n°1), pur, dans mettreAEchelle', () => {
  /**
   * Complément, au niveau de la fonction pure : la moitié « base de données »
   * du défaut n°1 est encodée dans `packages/db/src/depots/referentiel.test.ts`
   * (`coutsDeReference` ne doit jamais rendre 0 pour un ingrédient sans
   * conditionnement). Ici, on vérifie que `mettreAEchelle` elle-même propage
   * correctement un `cumpCentsParUnite: null` — sans base, fonction pure,
   * comme l'exige la règle d'architecture n°1.
   */
  it('un ingrédient sans prix connu rend la ligne ET le total INCONNUS, jamais gratuits', () => {
    const avecCannelleSansPrix: RecetteCalcul = {
      ...R1_REELLE,
      lignes: [
        ...R1_REELLE.lignes,
        {
          ingredientId: 'cannelle',
          nomIngredient: 'Cannelle',
          unite: 'g',
          quantiteReference: 5,
          cumpCentsParUnite: null,
          allergenes: [],
        },
      ],
    };

    const resultat = mettreAEchelle(avecCannelleSansPrix, {
      type: 'volume',
      volumeMl: avecCannelleSansPrix.rendementReferenceMl,
    });

    const ligneCannelle = resultat.lignes.find((l) => l.ingredientId === 'cannelle');
    // La quantité pesée reste affichée : seul le COÛT est inconnu.
    expect(ligneCannelle?.quantite).toBe(5);
    expect(ligneCannelle?.coutCents).toBeNull();
    // Un total dont une ligne est inconnue est lui-même inconnu — jamais une
    // somme partielle (celle des sept autres lignes) présentée comme complète.
    expect(resultat.coutMatiereCents).toBeNull();
    expect(resultat.coutParCrepeCents).toBeNull();
  });
});
