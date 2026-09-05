import { describe, expect, it } from 'vitest';
import {
  calculerMargeAttendueLieu,
  coutDeplacementSessionCents,
  coutEmplacementSessionCents,
  coutKilometriqueRetenu,
  distanceVolDoiseauKm,
  etatDistanceLieu,
  fiabiliteLieu,
  imputationTourneeDeplacement,
  type MesureCoutVehicule,
} from './deplacement.js';

describe('coutDeplacementSessionCents', () => {
  it('renvoie null quand la distance est inconnue — jamais un coût zéro', () => {
    expect(coutDeplacementSessionCents(null, 47.61)).toBeNull();
  });

  it('D-074 — une distance au dixième de km (telle que rendue par OpenRouteService) se traduit sans arrondi intermédiaire', () => {
    // 12,4 km : exactement la forme que `apps/api/src/itineraire/client.ts`
    // produit désormais depuis les mètres bruts du fournisseur (D-074) — plus
    // le kilomètre entier d'avant, qui aurait jeté le « ,4 » à la source, sans
    // qu'aucune fonction de ce fichier ne puisse ensuite le rattraper.
    // 12,4 × 2 × 47,61 = 1180,728 → arrondi UNE SEULE FOIS à 1181 centimes.
    expect(coutDeplacementSessionCents(12.4, 47.61)).toBe(1181);
  });

  it('compte la distance ALLER-RETOUR, jamais aller simple', () => {
    // 20 km aller simple, 47,61 centimes/km : 20 * 2 * 47.61 = 1904.4 → 1904.
    expect(coutDeplacementSessionCents(20, 47.61)).toBe(1904);
  });

  it('un lieu à 0 km (connu, pas inconnu) coûte réellement 0', () => {
    expect(coutDeplacementSessionCents(0, 47.61)).toBe(0);
  });

  it('privilégie le lieu le plus proche à écart de gain marginal — l’exemple du porteur', () => {
    // « si un lieu est à 50 km et je gagnerais en prévision 5000 alors que
    // celui à 20 km me ferait gagner 4999, on va donc privilégier le plus
    // proche » : l'écart de coût kilométrique doit dépasser le centime d'écart
    // de gain brut annoncé par l'exemple. Les deux distances sont connues
    // (jamais `null`) : `expect(...).not.toBeNull()` le prouve au lecteur du
    // test ET affine le type pour la soustraction qui suit.
    const coutProche = coutDeplacementSessionCents(20, 47.61);
    const coutLointain = coutDeplacementSessionCents(50, 47.61);
    expect(coutProche).not.toBeNull();
    expect(coutLointain).not.toBeNull();
    expect((coutLointain as number) - (coutProche as number)).toBeGreaterThan(1);
  });
});

describe('imputationTourneeDeplacement — D-064, la session porte ce qu’elle aurait coûté seule', () => {
  const TAUX = 47.61; // cents/km, même forfait que les autres tests du fichier.

  it('cas 1 — distance réelle non saisie : coût réel inconnu, aucun repli sur l’estimation', () => {
    const resultat = imputationTourneeDeplacement({
      distanceReelleKm: null,
      distanceReferenceKmAllerSimple: 20,
      coutKilometriqueCentsParKm: TAUX,
    });
    expect(resultat).toEqual({
      coutSessionCents: null,
      coutDetourAchatsCents: null,
      coutTotalReelCents: null,
    });
  });

  it('cas 2 — référence du lieu inconnue : le total réel reste connu, la séparation ne l’est pas', () => {
    // 62,3 km réels * 47,61 c/km = 2965,923 → 2966.
    const resultat = imputationTourneeDeplacement({
      distanceReelleKm: 62.3,
      distanceReferenceKmAllerSimple: null,
      coutKilometriqueCentsParKm: TAUX,
    });
    expect(resultat.coutSessionCents).toBeNull();
    expect(resultat.coutDetourAchatsCents).toBeNull();
    expect(resultat.coutTotalReelCents).toBe(2966);
  });

  it('cas 3 — tournée réelle < 2 × la référence (marchés enchaînés) : le détour ne descend jamais sous zéro', () => {
    // Référence 30 km → la session « seule » vaudrait 60 km aller-retour,
    // mais la tournée réelle (deux marchés enchaînés) ne fait que 55 km :
    // la session ne doit JAMAIS être chargée de plus que ce qui a été roulé.
    const resultat = imputationTourneeDeplacement({
      distanceReelleKm: 55,
      distanceReferenceKmAllerSimple: 30,
      coutKilometriqueCentsParKm: TAUX,
    });
    // 55 * 47.61 = 2618.55 → 2619.
    expect(resultat.coutTotalReelCents).toBe(2619);
    expect(resultat.coutDetourAchatsCents).toBe(0);
    expect(resultat.coutSessionCents).toBe(2619);
    // Preuve que la session n'est PAS chargée du théorique (60 km → 2857) :
    // elle porte exactement ce qui a été réellement roulé, pas plus.
    expect(resultat.coutSessionCents).not.toBe(Math.round(60 * TAUX));
  });

  it('cas 4 — tournée réelle == 2 × la référence : aucun détour, la part achats est 0 (une vraie valeur)', () => {
    const resultat = imputationTourneeDeplacement({
      distanceReelleKm: 40,
      distanceReferenceKmAllerSimple: 20,
      coutKilometriqueCentsParKm: TAUX,
    });
    // Doit coïncider avec coutDeplacementSessionCents(20, TAUX) : même trajet,
    // aucun détour, les deux modèles doivent s'accorder.
    expect(resultat.coutTotalReelCents).toBe(coutDeplacementSessionCents(20, TAUX));
    expect(resultat.coutSessionCents).toBe(coutDeplacementSessionCents(20, TAUX));
    expect(resultat.coutDetourAchatsCents).toBe(0);
  });

  it('un vrai détour répartit le coût réel entre session et achats, en centimes entiers', () => {
    // Référence 13,7 km → session seule 27,4 km. Tournée réelle 62,3 km
    // (passage chez un fournisseur). Détour = 62,3 - 27,4 = 34,9 km.
    const resultat = imputationTourneeDeplacement({
      distanceReelleKm: 62.3,
      distanceReferenceKmAllerSimple: 13.7,
      coutKilometriqueCentsParKm: TAUX,
    });
    // Total   : 62.3 * 47.61 = 2965.923 → 2966.
    // Détour  : 34.9 * 47.61 = 1661.589 → 1662.
    // Session : dérivée par soustraction, jamais arrondie séparément.
    expect(resultat.coutTotalReelCents).toBe(2966);
    expect(resultat.coutDetourAchatsCents).toBe(1662);
    expect(resultat.coutSessionCents).toBe(1304);
  });

  it('BOUCLAGE AU CENTIME — la part session + la part achats redonnent exactement le total, sur des km qui ne tombent pas rond', () => {
    // Un arrondi indépendant de chaque part le prouverait faux : 27,4 * 47,61
    // = 1304,514 arrondi seul donnerait 1305, alors que la valeur dérivée par
    // soustraction (celle que la fonction rend) est 1304 — l'écart d'un
    // centime que ce test interdit.
    const casNonRonds = [
      { distanceReelleKm: 62.3, distanceReferenceKmAllerSimple: 13.7 },
      { distanceReelleKm: 101.7, distanceReferenceKmAllerSimple: 8.3 },
      { distanceReelleKm: 33.33, distanceReferenceKmAllerSimple: 11.11 },
      { distanceReelleKm: 199.9, distanceReferenceKmAllerSimple: 47.05 },
    ];

    for (const cas of casNonRonds) {
      const resultat = imputationTourneeDeplacement({
        ...cas,
        coutKilometriqueCentsParKm: TAUX,
      });
      expect(resultat.coutSessionCents).not.toBeNull();
      expect(resultat.coutDetourAchatsCents).not.toBeNull();
      expect(resultat.coutTotalReelCents).not.toBeNull();
      expect(
        (resultat.coutSessionCents as number) + (resultat.coutDetourAchatsCents as number),
      ).toBe(resultat.coutTotalReelCents);
    }
  });
});

describe('coutEmplacementSessionCents', () => {
  it('renvoie le tarif direct pour un mode "jour"', () => {
    const resultat = coutEmplacementSessionCents({
      tarifEmplacementCents: 2200,
      modeTarification: 'jour',
    });
    expect(resultat).toEqual({ cents: 2200, raisonIndisponible: null });
  });

  it('renvoie le tarif direct pour un mode "forfait"', () => {
    const resultat = coutEmplacementSessionCents({
      tarifEmplacementCents: 5000,
      modeTarification: 'forfait',
    });
    expect(resultat).toEqual({ cents: 5000, raisonIndisponible: null });
  });

  it('refuse de deviner une répartition pour un tarif mensuel au mètre linéaire', () => {
    const resultat = coutEmplacementSessionCents({
      tarifEmplacementCents: 12000,
      modeTarification: 'metre_lineaire_mois',
    });
    expect(resultat.cents).toBeNull();
    expect(resultat.raisonIndisponible).not.toBeNull();
  });

  it('renvoie null avec une raison quand le tarif est absent', () => {
    const resultat = coutEmplacementSessionCents({
      tarifEmplacementCents: null,
      modeTarification: 'jour',
    });
    expect(resultat.cents).toBeNull();
    expect(resultat.raisonIndisponible).not.toBeNull();
  });

  it('renvoie null avec une raison quand le mode est absent', () => {
    const resultat = coutEmplacementSessionCents({
      tarifEmplacementCents: 2200,
      modeTarification: null,
    });
    expect(resultat.cents).toBeNull();
    expect(resultat.raisonIndisponible).not.toBeNull();
  });
});

describe('fiabiliteLieu', () => {
  it('signale l’absence totale de données', () => {
    expect(fiabiliteLieu(0, 8, 25)).toBe('aucune_donnee');
  });

  it('est "peu_fiable" en dessous du premier seuil', () => {
    expect(fiabiliteLieu(3, 8, 25)).toBe('peu_fiable');
  });

  it('est "fiable" entre les deux seuils', () => {
    expect(fiabiliteLieu(10, 8, 25)).toBe('fiable');
  });

  it('est "tres_fiable" au-delà du second seuil', () => {
    expect(fiabiliteLieu(30, 8, 25)).toBe('tres_fiable');
  });
});

describe('calculerMargeAttendueLieu', () => {
  const ENTREES_COMPLETES = {
    crepesPrevues: 100,
    prixMoyenCrepeCents: 500,
    coutMatiereCrepeCents: 100,
    coutGazCrepeCents: 20,
    coutEmplacementSessionCents: 2000,
    coutDeplacementSessionCents: 1904,
  };

  it('compose CA attendu, coûts et marge nette quand tout est connu', () => {
    const resultat = calculerMargeAttendueLieu(ENTREES_COMPLETES);
    expect(resultat.caAttenduCents).toBe(50_000);
    expect(resultat.coutMatiereAttenduCents).toBe(10_000);
    expect(resultat.coutGazAttenduCents).toBe(2_000);
    expect(resultat.coutEmplacementCents).toBe(2_000);
    expect(resultat.coutDeplacementCents).toBe(1_904);
    // 50000 - 10000 - 2000 - 1904 - 2000 = 34096
    expect(resultat.margeNetteAttendueCents).toBe(34_096);
  });

  it('la marge nette est null dès que la distance (donc le déplacement) est inconnue', () => {
    const resultat = calculerMargeAttendueLieu({
      ...ENTREES_COMPLETES,
      coutDeplacementSessionCents: null,
    });
    expect(resultat.margeNetteAttendueCents).toBeNull();
    // Le CA attendu reste calculable : seule la marge nette dépend du déplacement.
    expect(resultat.caAttenduCents).toBe(50_000);
  });

  it('la marge nette est null dès que le coût d’emplacement est inconnu', () => {
    const resultat = calculerMargeAttendueLieu({
      ...ENTREES_COMPLETES,
      coutEmplacementSessionCents: null,
    });
    expect(resultat.margeNetteAttendueCents).toBeNull();
  });

  it('la marge nette est null dès que le prix moyen est indisponible (aucune vente, aucun tarif)', () => {
    const resultat = calculerMargeAttendueLieu({
      ...ENTREES_COMPLETES,
      prixMoyenCrepeCents: null,
    });
    expect(resultat.caAttenduCents).toBeNull();
    expect(resultat.margeNetteAttendueCents).toBeNull();
  });

  it('la marge nette est null dès que le coût gaz n’est pas mesuré', () => {
    const resultat = calculerMargeAttendueLieu({
      ...ENTREES_COMPLETES,
      coutGazCrepeCents: null,
    });
    expect(resultat.coutGazAttenduCents).toBeNull();
    expect(resultat.margeNetteAttendueCents).toBeNull();
  });

  it('ne classe jamais un lieu à 0 crêpe prévue comme rentable par accident', () => {
    const resultat = calculerMargeAttendueLieu({ ...ENTREES_COMPLETES, crepesPrevues: 0 });
    expect(resultat.caAttenduCents).toBe(0);
    expect(resultat.margeNetteAttendueCents).toBe(
      0 -
        0 -
        ENTREES_COMPLETES.coutEmplacementSessionCents -
        ENTREES_COMPLETES.coutDeplacementSessionCents -
        0,
    );
  });
});

describe('distanceVolDoiseauKm', () => {
  it('renvoie 0 pour deux coordonnées identiques', () => {
    const point = { latitude: 50.6326, longitude: 5.5797 };
    expect(distanceVolDoiseauKm(point, point)).toBeCloseTo(0, 6);
  });

  it('est symétrique — l’aller et le retour mesurent la même distance', () => {
    const liege = { latitude: 50.6326, longitude: 5.5797 };
    const bruxelles = { latitude: 50.8503, longitude: 4.3517 };
    expect(distanceVolDoiseauKm(liege, bruxelles)).toBeCloseTo(
      distanceVolDoiseauKm(bruxelles, liege),
      9,
    );
  });

  it('mesure une distance connue à quelques km près (Liège → Bruxelles ≈ 90 km à vol d’oiseau)', () => {
    const liege = { latitude: 50.6326, longitude: 5.5797 };
    const bruxelles = { latitude: 50.8503, longitude: 4.3517 };
    const distance = distanceVolDoiseauKm(liege, bruxelles);
    expect(distance).toBeGreaterThan(80);
    expect(distance).toBeLessThan(100);
  });
});

describe('etatDistanceLieu — les TROIS états, jamais deux', () => {
  it('est "confirmee" dès que la distance saisie existe, suggestion ou non', () => {
    expect(etatDistanceLieu({ distanceKmConfirmee: 12, distanceSuggereeKm: null })).toBe(
      'confirmee',
    );
    expect(etatDistanceLieu({ distanceKmConfirmee: 12, distanceSuggereeKm: 18.4 })).toBe(
      'confirmee',
    );
  });

  it('est "suggeree" seulement en l’absence de distance confirmée', () => {
    expect(etatDistanceLieu({ distanceKmConfirmee: null, distanceSuggereeKm: 18.4 })).toBe(
      'suggeree',
    );
  });

  it('est "inconnue" quand ni l’une ni l’autre n’existe', () => {
    expect(etatDistanceLieu({ distanceKmConfirmee: null, distanceSuggereeKm: null })).toBe(
      'inconnue',
    );
  });
});

describe('coutKilometriqueRetenu — le mesuré prime sur le forfait, seulement si fiable', () => {
  const FORFAIT_CENTS_PAR_KM = 47.61;

  function mesure(surcharges: Partial<MesureCoutVehicule> = {}): MesureCoutVehicule {
    return {
      totalDepensesCarburantCents: 0,
      nbPleins: 0,
      totalKmParcourus: 0,
      ...surcharges,
    };
  }

  it('retombe sur le forfait sans aucune donnée mesurée', () => {
    const resultat = coutKilometriqueRetenu({
      forfaitCentsParKm: FORFAIT_CENTS_PAR_KM,
      mesure: mesure(),
      pleinsMinimum: 8,
    });
    expect(resultat.origine).toBe('forfait');
    expect(resultat.centsParKm).toBe(FORFAIT_CENTS_PAR_KM);
    expect(resultat.libelle).toContain('Forfait officiel');
  });

  it('retombe sur le forfait tant que le nombre de pleins est sous le seuil', () => {
    const resultat = coutKilometriqueRetenu({
      forfaitCentsParKm: FORFAIT_CENTS_PAR_KM,
      mesure: mesure({ totalDepensesCarburantCents: 20_000, nbPleins: 3, totalKmParcourus: 1_000 }),
      pleinsMinimum: 8,
    });
    expect(resultat.origine).toBe('forfait');
  });

  it('bascule sur le mesuré exactement au seuil de pleins', () => {
    // 20 000 centimes / 1 000 km = 20 centimes/km.
    const resultat = coutKilometriqueRetenu({
      forfaitCentsParKm: FORFAIT_CENTS_PAR_KM,
      mesure: mesure({ totalDepensesCarburantCents: 20_000, nbPleins: 8, totalKmParcourus: 1_000 }),
      pleinsMinimum: 8,
    });
    expect(resultat.origine).toBe('mesure');
    expect(resultat.centsParKm).toBe(20);
    expect(resultat.libelle).toContain('Mesuré sur vos frais réels');
    expect(resultat.libelle).toContain('8 pleins');
  });

  it('ne divise jamais par zéro : aucun kilomètre parcouru retombe sur le forfait', () => {
    const resultat = coutKilometriqueRetenu({
      forfaitCentsParKm: FORFAIT_CENTS_PAR_KM,
      mesure: mesure({ totalDepensesCarburantCents: 20_000, nbPleins: 20, totalKmParcourus: 0 }),
      pleinsMinimum: 8,
    });
    expect(resultat.origine).toBe('forfait');
  });

  it('un coût mesuré nul ou négatif (dépenses annulées) retombe sur le forfait', () => {
    const resultat = coutKilometriqueRetenu({
      forfaitCentsParKm: FORFAIT_CENTS_PAR_KM,
      mesure: mesure({ totalDepensesCarburantCents: 0, nbPleins: 10, totalKmParcourus: 500 }),
      pleinsMinimum: 8,
    });
    expect(resultat.origine).toBe('forfait');
  });
});
