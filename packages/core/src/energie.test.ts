import { describe, expect, it } from 'vitest';
import {
  coutEnergieEviteeAutoproductionMoyenne,
  coutEnergieSessionCents,
  diagnosticPuissanceLieu,
  electriciteDisponibleLieu,
  energieElectriqueTotaleKwh,
  energieKWh,
  estCompatibleAutoproductionMobile,
  kilometresParcourusAllerRetour,
  pointEquilibreAutoproduction,
  quantitesPhysiquesParIngredient,
  sommePuissanceEnServiceW,
} from './energie.js';

describe('sommePuissanceEnServiceW', () => {
  it('rend 0 quand aucun équipement — une vraie somme vide, pas une inconnue', () => {
    expect(sommePuissanceEnServiceW([])).toBe(0);
  });

  it('ne compte que les équipements EN SERVICE et ACTIFS', () => {
    const equipements = [
      { puissanceW: 1500, enService: true, actif: true },
      // Déclaré pour comparaison avant achat, pas en service : ne compte pas.
      { puissanceW: 2000, enService: false, actif: true },
      // Retiré : ne tourne plus jamais, même s'il était marqué en service.
      { puissanceW: 900, enService: true, actif: false },
      { puissanceW: 1500, enService: true, actif: true },
    ];
    expect(sommePuissanceEnServiceW(equipements)).toBe(3000);
  });
});

describe('diagnosticPuissanceLieu', () => {
  it('rend tout à null quand la puissance disponible est inconnue et qu’il y a un risque à vérifier', () => {
    const resultat = diagnosticPuissanceLieu(4500, null);
    expect(resultat.margeW).toBeNull();
    expect(resultat.risqueDisjonction).toBeNull();
    expect(resultat.avertissement).not.toBeNull();
    expect(resultat.avertissement).toContain('4500 W');
  });

  it('ne signale rien si disponibilité inconnue mais aucun appareil en service', () => {
    const resultat = diagnosticPuissanceLieu(0, null);
    expect(resultat.risqueDisjonction).toBeNull();
    expect(resultat.avertissement).toBeNull();
  });

  it('signale le risque de disjonction — l’exemple du porteur : 3 radiateurs de 1500 W pour 3500 W disponibles', () => {
    const resultat = diagnosticPuissanceLieu(4500, 3500);
    expect(resultat.margeW).toBe(-1000);
    expect(resultat.risqueDisjonction).toBe(true);
    expect(resultat.avertissement).toBe(
      '4500 W prévus pour 3500 W disponibles : 1000 W de trop si tout tourne en même temps, ' +
        'certains appareils devront alterner.',
    );
  });

  it('ne signale rien quand la puissance disponible suffit', () => {
    const resultat = diagnosticPuissanceLieu(3000, 3500);
    expect(resultat.margeW).toBe(500);
    expect(resultat.risqueDisjonction).toBe(false);
    expect(resultat.avertissement).toBeNull();
  });

  it('la limite exacte (marge nulle) n’est pas un risque', () => {
    const resultat = diagnosticPuissanceLieu(3500, 3500);
    expect(resultat.margeW).toBe(0);
    expect(resultat.risqueDisjonction).toBe(false);
  });
});

describe('electriciteDisponibleLieu', () => {
  it('rend null quand le mode de facturation est inconnu — jamais disponible par défaut (D-055)', () => {
    expect(electriciteDisponibleLieu(null)).toBeNull();
  });

  it('rend false pour "aucune" — le seul cas qui affirme l’absence de courant', () => {
    expect(electriciteDisponibleLieu('aucune')).toBe(false);
  });

  it.each(['compteur', 'forfait', 'comprise'] as const)('rend true pour le mode « %s »', (mode) => {
    expect(electriciteDisponibleLieu(mode)).toBe(true);
  });
});

describe('energieKWh', () => {
  it('convertit puissance × durée en kWh', () => {
    // 1500 W pendant 60 min = 1,5 kWh.
    expect(energieKWh(1500, 60)).toBeCloseTo(1.5, 6);
  });

  it('gère une durée fractionnaire de l’heure', () => {
    // 2000 W pendant 30 min = 1 kWh.
    expect(energieKWh(2000, 30)).toBeCloseTo(1, 6);
  });

  it('rend 0 sans durée', () => {
    expect(energieKWh(2000, 0)).toBe(0);
  });
});

describe('coutEnergieSessionCents', () => {
  const uneUtilisation = [{ puissanceW: 1500, dureeMinutes: 120 }]; // 3 kWh

  it('rend le kWh physique mais aucun coût quand le mode de facturation est inconnu', () => {
    const resultat = coutEnergieSessionCents({
      equipementsUtilises: uneUtilisation,
      facturationElectricite: null,
      prixKwhCentsParKwh: 35,
    });
    expect(resultat.kwh).toBeCloseTo(3, 6);
    expect(resultat.cents).toBeNull();
    expect(resultat.raisonIndisponible).toMatch(/inconnu/);
  });

  it('rend un coût null quand le lieu ne dispose d’aucune électricité', () => {
    const resultat = coutEnergieSessionCents({
      equipementsUtilises: uneUtilisation,
      facturationElectricite: 'aucune',
      prixKwhCentsParKwh: 35,
    });
    expect(resultat.cents).toBeNull();
    expect(resultat.raisonIndisponible).toMatch(/aucune électricité/);
  });

  it('refuse de compter un coût au forfait — déjà compté dans le tarif d’emplacement', () => {
    const resultat = coutEnergieSessionCents({
      equipementsUtilises: uneUtilisation,
      facturationElectricite: 'forfait',
      prixKwhCentsParKwh: 35,
    });
    expect(resultat.cents).toBeNull();
    expect(resultat.raisonIndisponible).toMatch(/forfait/);
  });

  it('refuse de compter un coût quand l’électricité est comprise dans l’emplacement', () => {
    const resultat = coutEnergieSessionCents({
      equipementsUtilises: uneUtilisation,
      facturationElectricite: 'comprise',
      prixKwhCentsParKwh: 35,
    });
    expect(resultat.cents).toBeNull();
    expect(resultat.raisonIndisponible).toMatch(/comprise/);
  });

  it('rend un coût null au compteur si le prix du kWh n’est pas paramétré', () => {
    const resultat = coutEnergieSessionCents({
      equipementsUtilises: uneUtilisation,
      facturationElectricite: 'compteur',
      prixKwhCentsParKwh: null,
    });
    expect(resultat.kwh).toBeCloseTo(3, 6);
    expect(resultat.cents).toBeNull();
    expect(resultat.raisonIndisponible).toMatch(/non paramétré/);
  });

  it('calcule le coût réel au compteur quand le prix du kWh est connu', () => {
    // 3 kWh × 35 centimes = 105 centimes.
    const resultat = coutEnergieSessionCents({
      equipementsUtilises: uneUtilisation,
      facturationElectricite: 'compteur',
      prixKwhCentsParKwh: 35,
    });
    expect(resultat.cents).toBe(105);
    expect(resultat.raisonIndisponible).toBeNull();
  });

  it('additionne plusieurs équipements utilisés simultanément', () => {
    // Deux radiateurs de 1500 W pendant 60 min = 3 kWh au total.
    const resultat = coutEnergieSessionCents({
      equipementsUtilises: [
        { puissanceW: 1500, dureeMinutes: 60 },
        { puissanceW: 1500, dureeMinutes: 60 },
      ],
      facturationElectricite: 'compteur',
      prixKwhCentsParKwh: 30,
    });
    expect(resultat.kwh).toBeCloseTo(3, 6);
    expect(resultat.cents).toBe(90);
  });

  it('rend 0 kWh et 0 centime sans aucun équipement utilisé — un vrai zéro, pas une inconnue', () => {
    const resultat = coutEnergieSessionCents({
      equipementsUtilises: [],
      facturationElectricite: 'compteur',
      prixKwhCentsParKwh: 35,
    });
    expect(resultat.kwh).toBe(0);
    expect(resultat.cents).toBe(0);
  });
});

describe('estCompatibleAutoproductionMobile', () => {
  it.each(['eclairage', 'froid', 'paiement'] as const)(
    '« %s » est compatible avec une autoproduction mobile modeste',
    (type) => {
      expect(estCompatibleAutoproductionMobile(type)).toBe(true);
    },
  );

  it.each(['cuisson', 'chauffage', 'autre'] as const)(
    '« %s » n’est PAS compatible — le garde-fou de la fiche 17 §3.1',
    (type) => {
      expect(estCompatibleAutoproductionMobile(type)).toBe(false);
    },
  );
});

describe('pointEquilibreAutoproduction', () => {
  it('rend null quand le coût d’installation est inconnu', () => {
    const resultat = pointEquilibreAutoproduction({
      coutInstallationCents: null,
      coutEnergieEviteParSessionCents: 500,
    });
    expect(resultat.sessionsAvantEquilibre).toBeNull();
    expect(resultat.raisonIndisponible).toMatch(/installation inconnu/);
  });

  it('refuse un coût d’installation nul ou négatif', () => {
    const resultat = pointEquilibreAutoproduction({
      coutInstallationCents: 0,
      coutEnergieEviteParSessionCents: 500,
    });
    expect(resultat.sessionsAvantEquilibre).toBeNull();
    expect(resultat.raisonIndisponible).toMatch(/strictement positif/);
  });

  it('rend null quand le coût d’énergie évité est inconnu — jamais une estimation', () => {
    const resultat = pointEquilibreAutoproduction({
      coutInstallationCents: 250_000,
      coutEnergieEviteParSessionCents: null,
    });
    expect(resultat.sessionsAvantEquilibre).toBeNull();
    expect(resultat.raisonIndisponible).toMatch(/inconnu/);
  });

  it('rend null quand aucune économie n’est mesurée (coût évité nul ou négatif)', () => {
    const resultat = pointEquilibreAutoproduction({
      coutInstallationCents: 250_000,
      coutEnergieEviteParSessionCents: 0,
    });
    expect(resultat.sessionsAvantEquilibre).toBeNull();
    expect(resultat.raisonIndisponible).toMatch(/Aucune économie/);
  });

  it('calcule le nombre de sessions, arrondi AU SUPÉRIEUR', () => {
    // 250 000 cents / 400 cents par session = 625 sessions pile.
    const resultat = pointEquilibreAutoproduction({
      coutInstallationCents: 250_000,
      coutEnergieEviteParSessionCents: 400,
    });
    expect(resultat.sessionsAvantEquilibre).toBe(625);
    expect(resultat.raisonIndisponible).toBeNull();
  });

  it('arrondit au supérieur quand la division ne tombe pas juste', () => {
    // 1000 / 300 = 3,33... -> 4 sessions ENTIÈRES pour rembourser.
    const resultat = pointEquilibreAutoproduction({
      coutInstallationCents: 1000,
      coutEnergieEviteParSessionCents: 300,
    });
    expect(resultat.sessionsAvantEquilibre).toBe(4);
  });
});

describe('coutEnergieEviteeAutoproductionMoyenne', () => {
  it('rend null sans aucune ligne — rien à moyenner', () => {
    const resultat = coutEnergieEviteeAutoproductionMoyenne([], 30);
    expect(resultat.coutMoyenParSessionCents).toBeNull();
    expect(resultat.nbSessionsPriseEnCompte).toBe(0);
    expect(resultat.raisonIndisponible).not.toBeNull();
  });

  it('ignore la cuisson et le chauffage — seule l’électricité compatible compte', () => {
    const resultat = coutEnergieEviteeAutoproductionMoyenne(
      [
        {
          sessionId: 's1',
          type: 'cuisson',
          puissanceW: 3000,
          dureeMinutes: 120,
          facturationElectricite: 'compteur',
        },
        {
          sessionId: 's1',
          type: 'chauffage',
          puissanceW: 2000,
          dureeMinutes: 120,
          facturationElectricite: 'compteur',
        },
      ],
      30,
    );
    expect(resultat.coutMoyenParSessionCents).toBeNull();
    expect(resultat.nbSessionsPriseEnCompte).toBe(0);
  });

  it('ne compte un lieu que s’il facture au compteur avec un prix connu', () => {
    const resultat = coutEnergieEviteeAutoproductionMoyenne(
      [
        {
          sessionId: 's1',
          type: 'eclairage',
          puissanceW: 100,
          dureeMinutes: 300,
          facturationElectricite: 'forfait',
        },
      ],
      30,
    );
    expect(resultat.coutMoyenParSessionCents).toBeNull();
  });

  it('moyenne le coût d’électricité compatible sur les sessions mesurables', () => {
    // Session 1 : éclairage 100 W pendant 300 min = 0,5 kWh -> 15 centimes à 30 c/kWh.
    // Session 2 : froid 60 W pendant 600 min = 0,6 kWh -> 18 centimes à 30 c/kWh.
    const resultat = coutEnergieEviteeAutoproductionMoyenne(
      [
        {
          sessionId: 's1',
          type: 'eclairage',
          puissanceW: 100,
          dureeMinutes: 300,
          facturationElectricite: 'compteur',
        },
        {
          sessionId: 's2',
          type: 'froid',
          puissanceW: 60,
          dureeMinutes: 600,
          facturationElectricite: 'compteur',
        },
      ],
      30,
    );
    expect(resultat.nbSessionsPriseEnCompte).toBe(2);
    expect(resultat.coutMoyenParSessionCents).toBe(Math.round((15 + 18) / 2));
    expect(resultat.raisonIndisponible).toBeNull();
  });
});

describe('quantitesPhysiquesParIngredient', () => {
  const ingredients = [
    {
      id: 'i-farine',
      nom: 'Farine T55',
      categorie: 'farine' as const,
      uniteReference: 'g' as const,
    },
    {
      id: 'i-gaz',
      nom: 'Bouteille de gaz',
      categorie: 'gaz' as const,
      uniteReference: 'piece' as const,
    },
    {
      id: 'i-gobelet',
      nom: 'Gobelets',
      categorie: 'consommable' as const,
      uniteReference: 'piece' as const,
    },
  ];

  it('additionne les lots PAR INGRÉDIENT, jamais par catégorie', () => {
    const resultat = quantitesPhysiquesParIngredient(
      [
        { ingredientId: 'i-farine', quantiteInitiale: 12_500 },
        { ingredientId: 'i-farine', quantiteInitiale: 5_000 },
        { ingredientId: 'i-gaz', quantiteInitiale: 3 },
        { ingredientId: 'i-gobelet', quantiteInitiale: 500 },
      ],
      ingredients,
    );

    expect(resultat.find((l) => l.ingredientId === 'i-farine')?.quantiteRecue).toBe(17_500);
    expect(resultat.find((l) => l.ingredientId === 'i-gaz')?.quantiteRecue).toBe(3);
    expect(resultat.find((l) => l.ingredientId === 'i-gobelet')?.quantiteRecue).toBe(500);
    // Le gaz et les consommables ressortent sans code spécifique : ce sont déjà
    // des ingrédients comme les autres (docs/demandes/17 §4.2).
    expect(resultat.find((l) => l.ingredientId === 'i-gaz')?.categorie).toBe('gaz');
    expect(resultat.find((l) => l.ingredientId === 'i-gobelet')?.categorie).toBe('consommable');
  });

  it('ne mélange jamais les unités : chaque ligne garde SA propre uniteReference', () => {
    const resultat = quantitesPhysiquesParIngredient(
      [
        { ingredientId: 'i-farine', quantiteInitiale: 1000 },
        { ingredientId: 'i-gaz', quantiteInitiale: 2 },
      ],
      ingredients,
    );
    expect(resultat.find((l) => l.ingredientId === 'i-farine')?.uniteReference).toBe('g');
    expect(resultat.find((l) => l.ingredientId === 'i-gaz')?.uniteReference).toBe('piece');
  });

  it('ignore un lot dont l’ingrédient est introuvable plutôt que d’en deviner la catégorie', () => {
    const resultat = quantitesPhysiquesParIngredient(
      [{ ingredientId: 'inconnu', quantiteInitiale: 100 }],
      ingredients,
    );
    expect(resultat).toEqual([]);
  });

  it('rend un tableau vide sans aucun lot', () => {
    expect(quantitesPhysiquesParIngredient([], ingredients)).toEqual([]);
  });
});

describe('kilometresParcourusAllerRetour', () => {
  it('double la distance ALLER SIMPLE de chaque session (aller-retour, D-060)', () => {
    const resultat = kilometresParcourusAllerRetour([
      { distanceKmAllerSimple: 30 },
      { distanceKmAllerSimple: 10 },
    ]);
    expect(resultat.totalKm).toBe(80);
    expect(resultat.nbSessionsDistanceInconnue).toBe(0);
  });

  it('exclut une distance inconnue du total — jamais comptée comme 0 km', () => {
    const resultat = kilometresParcourusAllerRetour([
      { distanceKmAllerSimple: 30 },
      { distanceKmAllerSimple: null },
    ]);
    expect(resultat.totalKm).toBe(60);
    expect(resultat.nbSessionsDistanceInconnue).toBe(1);
  });

  it('rend 0 km et 0 session inconnue sans aucune session — un vrai zéro', () => {
    const resultat = kilometresParcourusAllerRetour([]);
    expect(resultat.totalKm).toBe(0);
    expect(resultat.nbSessionsDistanceInconnue).toBe(0);
  });
});

describe('energieElectriqueTotaleKwh', () => {
  it('additionne TOUS les types d’équipement, cuisson et chauffage compris', () => {
    // 3000 W x 120 min = 6 kWh, 1500 W x 60 min = 1,5 kWh.
    const total = energieElectriqueTotaleKwh([
      { puissanceW: 3000, dureeMinutes: 120 },
      { puissanceW: 1500, dureeMinutes: 60 },
    ]);
    expect(total).toBeCloseTo(7.5, 6);
  });

  it('rend 0 sans aucune utilisation', () => {
    expect(energieElectriqueTotaleKwh([])).toBe(0);
  });
});
