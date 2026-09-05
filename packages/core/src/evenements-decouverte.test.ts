import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from './argent.js';
import {
  DOMAINE_RAYON_RECHERCHE_KM,
  estRayonRechercheValide,
  facteurDistanceDecayBp,
  facteurEvenementDepuisPorteeIntensite,
  rentabiliteEstimeeCents,
  trierParRentabiliteDecroissante,
  type ConfigDecoteDistanceEvenement,
  type ConfigFacteurEvenement,
} from './evenements-decouverte.js';
import { definitionParametre } from './parametres.js';

/**
 * Config de test — reproduit EXACTEMENT les anciennes constantes codées en
 * dur (`COEFFICIENT_PORTEE`, `PENTE_INTENSITE`, `DISTANCE_SANS_DECOTE_KM`,
 * `DISTANCE_DECOTE_MAX_KM`, `DISTANCE_PLANCHER_BP`) telles qu'elles
 * existaient avant leur migration vers la table `parametre`. Valeurs en dur
 * ICI et non lues du catalogue : ce fichier reste un test unitaire de la
 * fonction pure, indépendant du catalogue. La preuve que le catalogue
 * reproduit bien ces mêmes valeurs par défaut est faite plus bas, dans un
 * describe dédié.
 */
const CONFIG_FACTEUR: ConfigFacteurEvenement = {
  coefficientPorteeBp: { quartier: 10_000, liege: 6_000, national: 3_000 },
  penteIntensiteBp: 500,
};

const CONFIG_DECOTE: ConfigDecoteDistanceEvenement = {
  distanceSansDecoteKm: 10,
  distanceDecoteMaxKm: 100,
  distancePlancherBp: 2_000,
};

describe('estRayonRechercheValide', () => {
  it.each(DOMAINE_RAYON_RECHERCHE_KM)('accepte %i km (domaine fiche 05)', (valeur) => {
    expect(estRayonRechercheValide(valeur)).toBe(true);
  });

  it.each([0, 1, 25, 50, 200, -20])('refuse %i km (hors domaine)', (valeur) => {
    expect(estRayonRechercheValide(valeur)).toBe(false);
  });
});

describe('facteurEvenementDepuisPorteeIntensite — docs/03 « 1 + portée × intensité × 0,05 »', () => {
  it('quartier, intensité 3 -> ×1,15 (exemple docs/03)', () => {
    // 1 + 1,0 × 3 × 0,05 = 1,15
    expect(facteurEvenementDepuisPorteeIntensite('quartier', 3, CONFIG_FACTEUR)).toBe(11_500);
  });

  it('liège, intensité 5 -> ×1,15', () => {
    // 1 + 0,6 × 5 × 0,05 = 1,15
    expect(facteurEvenementDepuisPorteeIntensite('liege', 5, CONFIG_FACTEUR)).toBe(11_500);
  });

  it('national, intensité 1 -> ×1,015', () => {
    // 1 + 0,3 × 1 × 0,05 = 1,015
    expect(facteurEvenementDepuisPorteeIntensite('national', 1, CONFIG_FACTEUR)).toBe(10_150);
  });

  it('quartier, intensité 5 -> effet maximal ×1,25', () => {
    expect(facteurEvenementDepuisPorteeIntensite('quartier', 5, CONFIG_FACTEUR)).toBe(12_500);
  });

  it.each([0, 6, 1.5, -1])('refuse une intensité hors 1..5 (%s)', (intensite) => {
    expect(() =>
      facteurEvenementDepuisPorteeIntensite('quartier', intensite, CONFIG_FACTEUR),
    ).toThrow();
  });
});

describe('facteurDistanceDecayBp — décote explicite par distance (fiche 05)', () => {
  it('aucune décote jusqu’à 10 km inclus', () => {
    expect(facteurDistanceDecayBp(0, CONFIG_DECOTE)).toBe(BASE_POINTS);
    expect(facteurDistanceDecayBp(10, CONFIG_DECOTE)).toBe(BASE_POINTS);
  });

  it('décote strictement croissante entre 10 et 100 km', () => {
    const a = facteurDistanceDecayBp(20, CONFIG_DECOTE);
    const b = facteurDistanceDecayBp(40, CONFIG_DECOTE);
    const c = facteurDistanceDecayBp(90, CONFIG_DECOTE);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it('plancher atteint à 100 km et au-delà (jamais nul)', () => {
    expect(facteurDistanceDecayBp(100, CONFIG_DECOTE)).toBe(2_000);
    expect(facteurDistanceDecayBp(500, CONFIG_DECOTE)).toBe(2_000);
  });

  it('un rayon de 100 km classe un événement lointain plus bas qu’un proche', () => {
    // Même impact brut, seule la distance change : la décote doit suffire à
    // inverser l'ordre — c'est exactement le « piège » que la fiche 05 signale
    // (un rayon élargi à 100 km ne doit pas remonter artificiellement un
    // événement lointain devant un événement proche).
    const proche = facteurDistanceDecayBp(5, CONFIG_DECOTE);
    const lointain = facteurDistanceDecayBp(90, CONFIG_DECOTE);
    expect(proche).toBeGreaterThan(lointain);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuse une distance invalide (%s)', (d) => {
    expect(() => facteurDistanceDecayBp(d, CONFIG_DECOTE)).toThrow();
  });
});

describe('rentabiliteEstimeeCents', () => {
  it('un événement neutre (f=1) ne rapporte ni ne coûte rien, quelle que soit la distance', () => {
    expect(
      rentabiliteEstimeeCents(
        {
          baselineCrepes: 120,
          impactEstimeBp: BASE_POINTS,
          distanceKm: 5,
          margeUnitaireCents: 315,
        },
        CONFIG_DECOTE,
      ),
    ).toBe(0);
  });

  it('un événement positif proche rapporte plus que le même événement lointain', () => {
    const entreeCommune = { baselineCrepes: 120, impactEstimeBp: 11_500, margeUnitaireCents: 315 };
    const proche = rentabiliteEstimeeCents({ ...entreeCommune, distanceKm: 2 }, CONFIG_DECOTE);
    const lointain = rentabiliteEstimeeCents({ ...entreeCommune, distanceKm: 95 }, CONFIG_DECOTE);
    expect(proche).toBeGreaterThan(0);
    expect(lointain).toBeGreaterThan(0);
    expect(proche).toBeGreaterThan(lointain);
  });

  it('un événement négatif (grève) rend une rentabilité NÉGATIVE', () => {
    const resultat = rentabiliteEstimeeCents(
      {
        baselineCrepes: 120,
        impactEstimeBp: 7_500, // × 0,75, facteur négatif direct (docs/03)
        distanceKm: 3,
        margeUnitaireCents: 315,
      },
      CONFIG_DECOTE,
    );
    expect(resultat).toBeLessThan(0);
  });

  it('exemple chiffré : baseline 120, quartier/intensité 3 (×1,15), 2 km, marge 315 c', () => {
    // surcroît de crêpes = 120 × 0,15 = 18 ; 18 × 3,15 € = 56,70 € = 5670 c
    // (2 km < seuil sans décote, donc aucune décote appliquée)
    expect(
      rentabiliteEstimeeCents(
        {
          baselineCrepes: 120,
          impactEstimeBp: 11_500,
          distanceKm: 2,
          margeUnitaireCents: 315,
        },
        CONFIG_DECOTE,
      ),
    ).toBe(5_670);
  });
});

describe('trierParRentabiliteDecroissante', () => {
  it('trie du plus rentable au moins rentable, sans muter le tableau d’entrée', () => {
    const propositions = [
      { id: 'a', rentabiliteEstimeeCents: 1_000 },
      { id: 'b', rentabiliteEstimeeCents: 5_000 },
      { id: 'c', rentabiliteEstimeeCents: -200 },
    ];
    const original = [...propositions];

    const trie = trierParRentabiliteDecroissante(propositions);

    expect(trie.map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(propositions).toEqual(original);
  });

  it('rend un tableau vide sur une entrée vide', () => {
    expect(trierParRentabiliteDecroissante([])).toEqual([]);
  });
});

describe('catalogue `parametre` — les valeurs par défaut reproduisent EXACTEMENT l’ancien comportement codé en dur', () => {
  // Preuve d'équivalence 0-régression (CLAUDE.md §7, migration des cinq
  // constantes de ce module vers la table `parametre`) : on construit les
  // `Config*` à partir des `valeurDefaut` du catalogue — EXACTEMENT comme le
  // fait le dépôt (`packages/db/src/depots/evenements-decouverte.ts`) via
  // `Parametres.pointsDeBase` / `Parametres.entier` — et on vérifie que ces
  // configs sont identiques aux anciennes constantes codées en dur, puis que
  // les fonctions produisent les mêmes chiffres qu'avant la migration.
  function entierCatalogue(cle: string): number {
    const definition = definitionParametre(cle);
    if (definition === undefined) {
      throw new Error(`Paramètre absent du catalogue : ${cle}`);
    }
    return Number.parseInt(definition.valeurDefaut, 10);
  }

  const configFacteurDepuisCatalogue: ConfigFacteurEvenement = {
    coefficientPorteeBp: {
      quartier: entierCatalogue('evenement_coefficient_portee_quartier_bp'),
      liege: entierCatalogue('evenement_coefficient_portee_liege_bp'),
      national: entierCatalogue('evenement_coefficient_portee_national_bp'),
    },
    penteIntensiteBp: entierCatalogue('evenement_pente_intensite_bp'),
  };

  const configDecoteDepuisCatalogue: ConfigDecoteDistanceEvenement = {
    distanceSansDecoteKm: entierCatalogue('evenement_distance_sans_decote_km'),
    distanceDecoteMaxKm: entierCatalogue('evenement_distance_decote_max_km'),
    distancePlancherBp: entierCatalogue('evenement_distance_plancher_bp'),
  };

  it('les valeurs par défaut du catalogue sont IDENTIQUES aux anciennes constantes codées en dur', () => {
    expect(configFacteurDepuisCatalogue).toEqual(CONFIG_FACTEUR);
    expect(configDecoteDepuisCatalogue).toEqual(CONFIG_DECOTE);
  });

  it.each([
    ['quartier', 3, 11_500],
    ['liege', 5, 11_500],
    ['national', 1, 10_150],
    ['quartier', 5, 12_500],
  ] as const)(
    'facteurEvenementDepuisPorteeIntensite(%s, %i) = %i, avec les défauts du catalogue',
    (portee, intensite, attendu) => {
      expect(
        facteurEvenementDepuisPorteeIntensite(portee, intensite, configFacteurDepuisCatalogue),
      ).toBe(attendu);
    },
  );

  it('facteurDistanceDecayBp reproduit la même absence de décote et le même plancher, avec les défauts du catalogue', () => {
    expect(facteurDistanceDecayBp(10, configDecoteDepuisCatalogue)).toBe(BASE_POINTS);
    expect(facteurDistanceDecayBp(100, configDecoteDepuisCatalogue)).toBe(2_000);
    expect(facteurDistanceDecayBp(500, configDecoteDepuisCatalogue)).toBe(2_000);
  });
});
