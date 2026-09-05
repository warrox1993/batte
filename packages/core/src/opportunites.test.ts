import { describe, expect, it } from 'vitest';
import {
  coutDeplacementCampagneCents,
  coutEmplacementCampagneCents,
  fiabiliteOpportunite,
  margeNetteAttendueOpportunite,
  nombreSessionsCampagne,
  previsionCrepesEntreprise,
  tauxPriseEntrepriseObserve,
} from './opportunites.js';

describe('nombreSessionsCampagne', () => {
  it('rend toujours 1 pour un événement grand public, quelles que soient les dates', () => {
    expect(nombreSessionsCampagne('grand_public', '2026-08-01', '2026-08-03')).toBe(1);
  });

  it('rend toujours 1 pour un stand entreprise, quelles que soient les dates', () => {
    expect(nombreSessionsCampagne('entreprise', '2026-08-01', '2026-08-03')).toBe(1);
  });

  it('compte un jour par session pour un marché de Noël, dates inclusives', () => {
    // Du 1er au 3 décembre inclus : trois jours, pas deux.
    expect(nombreSessionsCampagne('marche_noel', '2026-12-01', '2026-12-03')).toBe(3);
  });

  it('rend 1 pour un marché de Noël d’un seul jour', () => {
    expect(nombreSessionsCampagne('marche_noel', '2026-12-01', '2026-12-01')).toBe(1);
  });
});

describe('previsionCrepesEntreprise', () => {
  it('reste silencieuse (null) quand l’effectif est inconnu', () => {
    expect(previsionCrepesEntreprise(null, 3000)).toBeNull();
  });

  it('reste silencieuse (null) quand le taux de prise n’a jamais été mesuré', () => {
    expect(previsionCrepesEntreprise(200, null)).toBeNull();
  });

  it('reste silencieuse (null) quand ni l’un ni l’autre n’est connu', () => {
    expect(previsionCrepesEntreprise(null, null)).toBeNull();
  });

  it('multiplie effectif × taux de prise, arrondi', () => {
    // 200 employés × 35 % = 70 crêpes.
    expect(previsionCrepesEntreprise(200, 3500)).toBe(70);
  });

  it('accepte un taux au-delà de 100 % — ce n’est pas un multiplicateur neutre', () => {
    // 50 employés, 1,5 crêpe chacun en moyenne = 75.
    expect(previsionCrepesEntreprise(50, 15_000)).toBe(75);
  });

  it('refuse un effectif négatif', () => {
    expect(() => previsionCrepesEntreprise(-5, 3000)).toThrow();
  });

  it('refuse un taux de prise négatif', () => {
    expect(() => previsionCrepesEntreprise(100, -100)).toThrow();
  });
});

describe('tauxPriseEntrepriseObserve', () => {
  it('reste silencieux (null) sans aucune observation', () => {
    const mesure = tauxPriseEntrepriseObserve([], 3);
    expect(mesure.tauxPriseBp).toBeNull();
    expect(mesure.nbObservations).toBe(0);
  });

  it('reste silencieux tant que le nombre d’observations est sous le seuil', () => {
    const observations = [
      { effectifEstime: 150, crepesVendues: 60 },
      { effectifEstime: 150, crepesVendues: 45 },
    ];
    const mesure = tauxPriseEntrepriseObserve(observations, 3);
    expect(mesure.tauxPriseBp).toBeNull();
    // Le nombre d’observations reste renseigné même sous le seuil : l’écran
    // doit pouvoir afficher « 2 observations, pas encore mesurable ».
    expect(mesure.nbObservations).toBe(2);
  });

  it('devient utilisable exactement au seuil, jamais avant', () => {
    const observations = [
      { effectifEstime: 150, crepesVendues: 60 }, // 40 %
      { effectifEstime: 150, crepesVendues: 60 }, // 40 %
      { effectifEstime: 150, crepesVendues: 60 }, // 40 %
    ];
    const mesure = tauxPriseEntrepriseObserve(observations, 3);
    expect(mesure.tauxPriseBp).toBe(4000);
    expect(mesure.nbObservations).toBe(3);
  });

  it('moyenne les taux de plusieurs visites de LA MÊME entreprise', () => {
    const observations = [
      { effectifEstime: 100, crepesVendues: 30 }, // 30 %
      { effectifEstime: 100, crepesVendues: 50 }, // 50 %
    ];
    const mesure = tauxPriseEntrepriseObserve(observations, 2);
    expect(mesure.tauxPriseBp).toBe(4000);
  });

  it('exclut un effectif à zéro ou négatif — jamais un taux infini', () => {
    const observations = [
      { effectifEstime: 100, crepesVendues: 40 },
      { effectifEstime: 0, crepesVendues: 999 },
      { effectifEstime: -5, crepesVendues: 3 },
    ];
    const mesure = tauxPriseEntrepriseObserve(observations, 1);
    expect(mesure.nbObservations).toBe(1);
    expect(mesure.tauxPriseBp).toBe(4000);
  });

  it('reste silencieux à zéro observation même avec un seuil mal réglé à 0 — jamais NaN', () => {
    const mesure = tauxPriseEntrepriseObserve([], 0);
    expect(mesure.tauxPriseBp).toBeNull();
    expect(mesure.nbObservations).toBe(0);
  });

  it('ne plafonne jamais à 100 % : plusieurs crêpes par personne restent possibles', () => {
    const observations = [
      { effectifEstime: 50, crepesVendues: 75 }, // 150 %
      { effectifEstime: 50, crepesVendues: 75 },
    ];
    const mesure = tauxPriseEntrepriseObserve(observations, 2);
    expect(mesure.tauxPriseBp).toBe(15_000);
  });
});

describe('coutEmplacementCampagneCents', () => {
  it('propage null sans y toucher', () => {
    const resultat = coutEmplacementCampagneCents(
      { cents: null, raisonIndisponible: 'inconnu' },
      'jour',
      5,
    );
    expect(resultat).toEqual({ cents: null, raisonIndisponible: 'inconnu' });
  });

  it('multiplie le tarif JOURNALIER par le nombre de sessions', () => {
    const resultat = coutEmplacementCampagneCents(
      { cents: 2200, raisonIndisponible: null },
      'jour',
      3,
    );
    expect(resultat).toEqual({ cents: 6600, raisonIndisponible: null });
  });

  it('ne multiplie JAMAIS un forfait : il couvre déjà toute la campagne', () => {
    const resultat = coutEmplacementCampagneCents(
      { cents: 5000, raisonIndisponible: null },
      'forfait',
      6,
    );
    expect(resultat).toEqual({ cents: 5000, raisonIndisponible: null });
  });
});

describe('coutDeplacementCampagneCents', () => {
  it('propage null sans y toucher', () => {
    expect(coutDeplacementCampagneCents(null, 4)).toBeNull();
  });

  it('multiplie le coût par session par le nombre de sessions — le trajet se répète chaque jour', () => {
    expect(coutDeplacementCampagneCents(1904, 3)).toBe(5712);
  });

  it('laisse un coût d’un seul jour inchangé', () => {
    expect(coutDeplacementCampagneCents(1904, 1)).toBe(1904);
  });
});

describe('fiabiliteOpportunite', () => {
  it('laisse la fiabilité inchangée quand la distance est routière (déclarée sur un lieu)', () => {
    expect(fiabiliteOpportunite('tres_fiable', false)).toBe('tres_fiable');
    expect(fiabiliteOpportunite('fiable', false)).toBe('fiable');
    expect(fiabiliteOpportunite('peu_fiable', false)).toBe('peu_fiable');
    expect(fiabiliteOpportunite('aucune_donnee', false)).toBe('aucune_donnee');
  });

  it('plafonne à "peu_fiable" une baseline pourtant fiable, si la distance n’est qu’à vol d’oiseau', () => {
    expect(fiabiliteOpportunite('tres_fiable', true)).toBe('peu_fiable');
    expect(fiabiliteOpportunite('fiable', true)).toBe('peu_fiable');
  });

  it('n’aggrave jamais un niveau déjà bas', () => {
    expect(fiabiliteOpportunite('peu_fiable', true)).toBe('peu_fiable');
    expect(fiabiliteOpportunite('aucune_donnee', true)).toBe('aucune_donnee');
  });
});

describe('margeNetteAttendueOpportunite', () => {
  const ENTREES_UN_JOUR = {
    nbSessions: 1,
    crepesPrevuesParSession: 100,
    prixMoyenCrepeCents: 400,
    coutMatiereCrepeCents: 100,
    coutGazCrepeCents: 20,
    coutEmplacementParSession: { cents: 2200, raisonIndisponible: null },
    modeTarification: 'jour' as const,
    coutDeplacementParSessionCents: 1904,
  };

  it('se réduit exactement au calcul fiche 13 pour une opportunité d’un seul jour', () => {
    const resultat = margeNetteAttendueOpportunite(ENTREES_UN_JOUR);
    expect(resultat.caAttenduCents).toBe(40_000);
    expect(resultat.coutMatiereAttenduCents).toBe(10_000);
    expect(resultat.coutGazAttenduCents).toBe(2_000);
    expect(resultat.coutEmplacementCents).toBe(2200);
    expect(resultat.coutDeplacementCents).toBe(1904);
    // 40000 - 10000 - 2200 - 1904 - 2000 = 23896.
    expect(resultat.margeNetteAttendueCents).toBe(23_896);
    expect(resultat.nbSessions).toBe(1);
    expect(resultat.crepesPrevuesTotal).toBe(100);
  });

  it('agrège CA, matière et gaz sur toute la campagne, et répète le déplacement chaque jour', () => {
    const resultat = margeNetteAttendueOpportunite({ ...ENTREES_UN_JOUR, nbSessions: 3 });
    expect(resultat.crepesPrevuesTotal).toBe(300);
    expect(resultat.caAttenduCents).toBe(120_000);
    expect(resultat.coutMatiereAttenduCents).toBe(30_000);
    expect(resultat.coutGazAttenduCents).toBe(6_000);
    // Tarif "jour" : payé chaque jour de la campagne.
    expect(resultat.coutEmplacementCents).toBe(6600);
    // Le trajet se répète chaque jour.
    expect(resultat.coutDeplacementCents).toBe(5712);
  });

  it('ne compte le forfait qu’une seule fois sur toute la campagne', () => {
    const resultat = margeNetteAttendueOpportunite({
      ...ENTREES_UN_JOUR,
      nbSessions: 4,
      modeTarification: 'forfait',
    });
    expect(resultat.coutEmplacementCents).toBe(2200);
  });

  it('rend une marge nette INCONNUE (jamais 0) quand la fréquentation n’est pas prévisible', () => {
    const resultat = margeNetteAttendueOpportunite({
      ...ENTREES_UN_JOUR,
      crepesPrevuesParSession: null,
    });
    expect(resultat.caAttenduCents).toBeNull();
    expect(resultat.coutMatiereAttenduCents).toBeNull();
    expect(resultat.coutGazAttenduCents).toBeNull();
    expect(resultat.margeNetteAttendueCents).toBeNull();
    expect(resultat.crepesPrevuesTotal).toBeNull();
    // Les coûts fixes du trajet et de l'emplacement, eux, restent connus.
    expect(resultat.coutEmplacementCents).toBe(2200);
    expect(resultat.coutDeplacementCents).toBe(1904);
  });

  it('propage la raison d’indisponibilité de l’emplacement même sans fréquentation connue', () => {
    const resultat = margeNetteAttendueOpportunite({
      ...ENTREES_UN_JOUR,
      crepesPrevuesParSession: null,
      coutEmplacementParSession: { cents: null, raisonIndisponible: 'Tarif non renseigné.' },
      modeTarification: null,
    });
    expect(resultat.coutEmplacementCents).toBeNull();
    expect(resultat.coutEmplacementIndisponibleRaison).toBe('Tarif non renseigné.');
  });
});
