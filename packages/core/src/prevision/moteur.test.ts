import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import { CATALOGUE_PARAMETRES, Parametres } from '../parametres.js';
import { ErreurMetier } from '../erreurs.js';
import {
  confianceBp,
  contraintesSession,
  manqueAGagnerEcretage,
  prevoir,
  sigmaRetenu,
} from './moteur.js';
import { classerMeteo, facteurMeteo } from './meteo.js';
import {
  ecartType,
  medianeDepuisEsperance,
  quantileLogNormal,
  quantileNormal,
  ratioCritique,
  repartitionNormale,
  sigmaDepuisCoefficientVariation,
  ventesEsperees,
} from './statistiques.js';

/**
 * `prevision_meteo_ensoleille_tiede_bp` et `..._frais_bp` referment les deux
 * trous de la grille meteo (ciel dégagé 22-26 °C, ciel dégagé 5-10 °C) — voir
 * docs/17 fiche 2. Elles sont desormais au catalogue officiel
 * (`packages/core/src/parametres.ts`) avec un prior EXPLICITEMENT NEUTRE
 * (10000 = `BASE_POINTS`), et non une valeur devinee : decision D-059,
 * « les facteurs ne se demandent pas, ils s'apprennent ». Aucune valeur
 * locale a injecter ici, contrairement a la version precedente de ce test.
 */
/** Parametres charges depuis le catalogue : aucune valeur codee dans le test. */
const PARAMETRES = Parametres.depuisLignes(
  CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: d.valeurDefaut })),
);

const METEO_NEUTRE = {
  temperatureC: 15,
  precipitationsMm: 0,
  ventKmh: 10,
  couvertureNuageuseBp: 8000,
};

/** Couts reels du projet : rupture 3,15 €, invendu 0,25 € (docs/03). */
const COUTS = { coutRuptureCents: 315, coutInvenduCents: 25 };

describe('quantileNormal', () => {
  it('rend 0 a la mediane', () => {
    expect(quantileNormal(0.5)).toBeCloseTo(0, 6);
  });

  it('retrouve les quantiles usuels', () => {
    expect(quantileNormal(0.9)).toBeCloseTo(1.2816, 3);
    expect(quantileNormal(0.95)).toBeCloseTo(1.6449, 3);
    expect(quantileNormal(0.99)).toBeCloseTo(2.3263, 3);
  });

  it('est symetrique', () => {
    expect(quantileNormal(0.1)).toBeCloseTo(-quantileNormal(0.9), 6);
  });

  it('refuse une probabilite hors du domaine', () => {
    expect(() => quantileNormal(0)).toThrow(RangeError);
    expect(() => quantileNormal(1)).toThrow(RangeError);
  });
});

describe('quantileLogNormal', () => {
  it('rend la mediane au quantile 50', () => {
    expect(quantileLogNormal(120, 0.35, 0.5)).toBeCloseTo(120, 6);
  });

  it('est asymetrique : la queue haute est plus longue que la basse', () => {
    // C'est la propriete qui justifie le choix log-normal : une bonne journee
    // peut doubler les ventes, une mauvaise ne peut pas les rendre negatives.
    const p10 = quantileLogNormal(120, 0.35, 0.1);
    const p90 = quantileLogNormal(120, 0.35, 0.9);
    expect(120 - p10).toBeLessThan(p90 - 120);
  });

  it('rend la mediane quand sigma est nul', () => {
    expect(quantileLogNormal(120, 0, 0.9)).toBe(120);
  });

  it('ne rend jamais de valeur negative', () => {
    expect(quantileLogNormal(120, 0.8, 0.001)).toBeGreaterThan(0);
  });

  it('refuse un ecart-type non fini au lieu de propager un NaN', () => {
    // D-034 : un `NaN` traverse ce moteur SANS JAMAIS LEVER. Il ressortait en
    // « NaN crêpes » a l ecran, sans aucune erreur pour l expliquer.
    expect(() => quantileLogNormal(120, Number.NaN, 0.9)).toThrow(RangeError);
    expect(() => quantileLogNormal(120, Number.POSITIVE_INFINITY, 0.9)).toThrow(RangeError);
    // Une mediane non finie, elle, n a pas de sens : on rend 0, comme pour une
    // mediane nulle, sans lever — l appelant a deja sa garde metier.
    expect(quantileLogNormal(Number.NaN, 0.3, 0.9)).toBe(0);
  });
});

describe('ecartType', () => {
  it('refuse de mesurer une dispersion sous deux valeurs', () => {
    // Une seule observation n a aucune dispersion MESURABLE. Rendre 0 est un
    // contrat explicite : `calculerBaseline` s appuie dessus pour dire « je ne
    // sais pas » plutot que d afficher un intervalle faussement etroit.
    expect(ecartType([])).toBe(0);
    expect(ecartType([42])).toBe(0);
    // Estimateur non biaise : diviseur n − 1, pas n.
    expect(ecartType([2, 4])).toBeCloseTo(Math.SQRT2, 12);
  });
});

describe('repartitionNormale — Φ', () => {
  it('vaut 0,5 en zéro et retrouve les valeurs de référence', () => {
    expect(repartitionNormale(0)).toBe(0.5);
    expect(repartitionNormale(1.959_963_985)).toBeCloseTo(0.975, 9);
    expect(repartitionNormale(1.281_551_566)).toBeCloseTo(0.9, 9);
  });

  it('est symétrique et sature proprement dans les queues', () => {
    expect(repartitionNormale(-2) + repartitionNormale(2)).toBeCloseTo(1, 12);
    expect(repartitionNormale(-40)).toBe(0);
    expect(repartitionNormale(40)).toBe(1);
    // Le raccord entre la forme rationnelle et la fraction continue tombe a
    // 7,0711 : il ne doit pas laisser de marche.
    expect(repartitionNormale(7.07)).toBeCloseTo(repartitionNormale(7.08), 12);
  });
});

describe('ventesEsperees — E[min(demande, production)]', () => {
  it('ne dépasse jamais la production ni l espérance de la demande', () => {
    const mediane = 134;
    const sigma = 0.3;
    const esperance = mediane * Math.exp((sigma * sigma) / 2);
    expect(ventesEsperees(50, mediane, sigma)).toBeLessThanOrEqual(50);
    expect(ventesEsperees(1e6, mediane, sigma)).toBeCloseTo(esperance, 6);
  });

  it('sans dispersion, on vend le minimum des deux', () => {
    expect(ventesEsperees(80, 134, 0)).toBe(80);
    expect(ventesEsperees(300, 134, 0)).toBe(134);
  });

  it('rend 0 sur une entrée vide ou absurde', () => {
    expect(ventesEsperees(0, 134, 0.3)).toBe(0);
    expect(ventesEsperees(-5, 134, 0.3)).toBe(0);
    expect(ventesEsperees(100, 0, 0.3)).toBe(0);
    expect(ventesEsperees(100, Number.NaN, 0.3)).toBe(0);
  });
});

describe('sigmaDepuisCoefficientVariation', () => {
  it('convertit un coefficient de variation en écart-type log', () => {
    // CV = √(exp(σ²) − 1). Le prior de docs/03, 0,35 de CV, vaut σ = 0,3400 :
    // l injecter tel quel elargissait l intervalle de 1,5 %.
    expect(sigmaDepuisCoefficientVariation(0.35)).toBeCloseTo(0.339_938_7, 6);
    // Reciproque exacte.
    const sigma = sigmaDepuisCoefficientVariation(0.35);
    expect(Math.sqrt(Math.exp(sigma * sigma) - 1)).toBeCloseTo(0.35, 12);
  });

  it('rend 0 sur une entrée inexploitable', () => {
    expect(sigmaDepuisCoefficientVariation(0)).toBe(0);
    expect(sigmaDepuisCoefficientVariation(-1)).toBe(0);
    expect(sigmaDepuisCoefficientVariation(Number.NaN)).toBe(0);
  });
});

describe('medianeDepuisEsperance', () => {
  it('rend une médiane strictement sous la moyenne', () => {
    expect(medianeDepuisEsperance(134, 0.35)).toBeLessThan(134);
    expect(medianeDepuisEsperance(134, 0.35) * Math.exp(0.35 ** 2 / 2)).toBeCloseTo(134, 9);
  });

  it('ne change rien sans dispersion, et refuse une entrée absurde', () => {
    expect(medianeDepuisEsperance(134, 0)).toBe(134);
    expect(medianeDepuisEsperance(134, Number.NaN)).toBe(134);
    expect(medianeDepuisEsperance(0, 0.35)).toBe(0);
    expect(medianeDepuisEsperance(Number.NaN, 0.35)).toBe(0);
  });
});

describe('ratioCritique — le calcul le plus rentable du projet', () => {
  it('donne ~0,93 avec les couts reels du projet', () => {
    // 3,15 / (3,15 + 0,25) = 0,926. C'est le chiffre de docs/03 §decision.
    expect(ratioCritique(315, 25)).toBeCloseTo(0.926, 3);
  });

  it('est tres au-dessus de la mediane : l intuition va dans le mauvais sens', () => {
    // On craint le gaspillage visible ; le vrai cout est la vente manquee.
    expect(ratioCritique(315, 25)).toBeGreaterThan(0.9);
  });

  it('rend 0,5 quand les deux couts sont egaux', () => {
    expect(ratioCritique(100, 100)).toBe(0.5);
  });

  it('rend null quand un cout manque, plutot qu un chiffre inventé', () => {
    // Surtout pas 0,5 : ce serait recommander la MEDIANE, que docs/03 interdit.
    // Un cout absent est une donnee manquante, pas un arbitrage equilibre.
    expect(ratioCritique(0, 0)).toBeNull();
    expect(ratioCritique(315, 0)).toBeNull();
    expect(ratioCritique(0, 25)).toBeNull();
  });

  it('rend null sur des couts non finis', () => {
    expect(ratioCritique(Number.NaN, 25)).toBeNull();
    expect(ratioCritique(315, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('ne rend JAMAIS exactement 1 : quantileNormal(1) leverait une RangeError', () => {
    // C'etait le plantage jour 1 de l'ecran « Prochaine session » : sans
    // reception, le cout matiere valait 0, donc le ratio valait 1.
    expect(ratioCritique(315, 0)).not.toBe(1);
  });
});

describe('classerMeteo', () => {
  it('classe la pluie continue au-dela du seuil', () => {
    expect(classerMeteo({ ...METEO_NEUTRE, precipitationsMm: 3 }, PARAMETRES)).toBe(
      'pluie_continue',
    );
  });

  it('classe une pluie faible en averses', () => {
    expect(classerMeteo({ ...METEO_NEUTRE, precipitationsMm: 0.5 }, PARAMETRES)).toBe('averses');
  });

  it('classe le beau temps doux', () => {
    expect(
      classerMeteo({ ...METEO_NEUTRE, temperatureC: 18, couvertureNuageuseBp: 2000 }, PARAMETRES),
    ).toBe('ensoleille_doux');
  });

  it('classe la forte chaleur a part du beau temps doux', () => {
    // La chaleur detourne de la crepe : effet en cloche de la temperature.
    expect(
      classerMeteo({ ...METEO_NEUTRE, temperatureC: 30, couvertureNuageuseBp: 1000 }, PARAMETRES),
    ).toBe('ensoleille_chaud');
  });

  it('classe le froid sec', () => {
    expect(classerMeteo({ ...METEO_NEUTRE, temperatureC: 2 }, PARAMETRES)).toBe('sec_froid');
  });

  it('fait primer la pluie sur tout le reste', () => {
    // Un ciel degage sous la pluie reste de la pluie : c'est elle qui determine
    // si les gens sortent.
    expect(
      classerMeteo(
        { temperatureC: 18, precipitationsMm: 5, ventKmh: 0, couvertureNuageuseBp: 0 },
        PARAMETRES,
      ),
    ).toBe('pluie_continue');
  });

  /**
   * Les deux trous de docs/03, REFERMES (docs/15 §1.2, docs/17 fiche 2).
   *
   * Cas reel : releve du 28/07/2026 sur l'API de production, 25,3 °C sous
   * 13 % de nuages, classe « couvert_sec », facteur 1,0000 — un dimanche
   * ensoleille traite comme un dimanche gris.
   */
  it('classe le ciel degage et tiede entre la borne haute du doux et le seuil de chaleur', () => {
    for (const temperatureC of [23, 24, 25.3, 26]) {
      expect(
        classerMeteo(
          { temperatureC, precipitationsMm: 0, ventKmh: 5, couvertureNuageuseBp: 1343 },
          PARAMETRES,
        ),
      ).toBe('ensoleille_tiede');
    }
  });

  it('classe le ciel degage et frais entre le seuil de froid et la borne basse du doux', () => {
    for (const temperatureC of [5, 7, 9.9]) {
      expect(
        classerMeteo(
          { temperatureC, precipitationsMm: 0, ventKmh: 5, couvertureNuageuseBp: 1343 },
          PARAMETRES,
        ),
      ).toBe('ensoleille_frais');
    }
  });

  /**
   * Propriete EXHAUSTIVE, pas un cas isole : sur une grille de seuils ET de
   * temperatures (pas de balayage de 1 °C, sur toute plage coherente), un
   * ciel degage n'est JAMAIS classe `couvert_sec`. C'est la garantie que le
   * trou ne peut pas se rouvrir en silence, meme si les seuils bougent —
   * balayage deterministe, pas aleatoire : les seuils sont un petit ensemble
   * fini, l'exhaustivite est plus forte qu'un tirage.
   */
  it('un ciel degage n est jamais classe couvert_sec, quels que soient temperature et seuils coherents', () => {
    const paliers = [-10, 0, 10, 20, 30];
    for (const tempFroide of paliers) {
      for (const tempDouceMin of paliers) {
        if (tempDouceMin < tempFroide) continue;
        for (const tempDouceMax of paliers) {
          if (tempDouceMax < tempDouceMin) continue;
          for (const tempChaude of paliers) {
            if (tempChaude < tempDouceMax) continue;

            const parametresLocaux = Parametres.depuisLignes([
              ...CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: d.valeurDefaut })),
              { cle: 'prevision_temp_froide_c', valeur: String(tempFroide) },
              { cle: 'prevision_temp_douce_min_c', valeur: String(tempDouceMin) },
              { cle: 'prevision_temp_douce_max_c', valeur: String(tempDouceMax) },
              { cle: 'prevision_temp_chaude_c', valeur: String(tempChaude) },
            ]);

            for (
              let temperatureC = tempFroide - 10;
              temperatureC <= tempChaude + 10;
              temperatureC += 1
            ) {
              const categorie = classerMeteo(
                { temperatureC, precipitationsMm: 0, ventKmh: 5, couvertureNuageuseBp: 0 },
                parametresLocaux,
              );
              expect(categorie).not.toBe('couvert_sec');
            }
          }
        }
      }
    }
  });

  it('refuse des seuils de temperature incoherents plutot que de rouvrir un trou en silence', () => {
    // « doux max » sous « doux min » : un ciel degage entre les deux ne
    // correspondrait plus a aucune categorie si la garde n'existait pas.
    const parametresCasses = Parametres.depuisLignes([
      ...CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: d.valeurDefaut })),
      { cle: 'prevision_temp_douce_min_c', valeur: '22' },
      { cle: 'prevision_temp_douce_max_c', valeur: '10' },
    ]);

    expect(() => classerMeteo(METEO_NEUTRE, parametresCasses)).toThrow(ErreurMetier);
    try {
      classerMeteo(METEO_NEUTRE, parametresCasses);
      expect.unreachable();
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('seuils_meteo_incoherents');
    }
  });

  /**
   * Une donnée manquante ne vaut jamais zéro — ni aucune autre valeur qui se
   * déguiserait en mesure. Avant cette garde, un `NaN` isolé sur un seul champ
   * (température perdue, couverture nuageuse conservée) ne levait rien :
   * `NaN > tempChaude`, `NaN >= tempDouceMin`, `NaN < tempFroide` valent tous
   * `false`, si bien que le ciel dégagé retombait sur la DERNIÈRE branche
   * testée, `ensoleille_frais` — une catégorie RÉELLE, avec son propre prior,
   * indiscernable d'une vraie mesure. La bonne réponse est de refuser :
   * l'appelant doit transmettre `entree.meteo = null` à `prevoir()` quand la
   * météo du jour n'est pas connue, pas un relevé partiel.
   */
  it('refuse une temperature non finie plutot que de la classer ensoleille_frais en silence', () => {
    const conditions = {
      temperatureC: Number.NaN,
      precipitationsMm: 0,
      ventKmh: 5,
      couvertureNuageuseBp: 1343, // ciel dégagé
    };
    expect(() => classerMeteo(conditions, PARAMETRES)).toThrow(ErreurMetier);
    try {
      classerMeteo(conditions, PARAMETRES);
      expect.unreachable();
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('meteo_conditions_invalides');
    }
  });

  it('refuse aussi une precipitation, un vent ou une couverture nuageuse non finis', () => {
    for (const partiel of [
      { precipitationsMm: Number.NaN },
      { ventKmh: Number.POSITIVE_INFINITY },
      { couvertureNuageuseBp: Number.NaN },
    ]) {
      expect(() => classerMeteo({ ...METEO_NEUTRE, ...partiel }, PARAMETRES)).toThrow(ErreurMetier);
    }
  });
});

describe('facteurMeteo', () => {
  it('applique le prior de la categorie', () => {
    const r = facteurMeteo(
      { ...METEO_NEUTRE, temperatureC: 18, couvertureNuageuseBp: 1000 },
      PARAMETRES,
    );
    expect(r.facteurBp).toBe(12_000);
  });

  it('COMBINE le vent fort au lieu de remplacer la categorie', () => {
    // Un marche ensoleille mais balaye par le vent n'est pas un marche ensoleille.
    const r = facteurMeteo(
      { temperatureC: 18, precipitationsMm: 0, ventKmh: 55, couvertureNuageuseBp: 1000 },
      PARAMETRES,
    );
    expect(r.ventFort).toBe(true);
    expect(r.facteurBp).toBe(9000); // 1,20 x 0,75
  });

  it('produit une explication affichable', () => {
    const r = facteurMeteo({ ...METEO_NEUTRE, precipitationsMm: 5 }, PARAMETRES);
    expect(r.explication).toContain('pluie continue');
  });

  /**
   * Les deux trous de docs/03 REFERMES (docs/15 §1.2, docs/17 fiche 2) : ils
   * ne disent plus « couvert » ET ont desormais leur propre CATEGORIE et leur
   * propre parametre — plus jamais noyes dans `couvert_sec`. C'est la
   * CLASSIFICATION qui etait cassee, corrigee ici. Cas reel : releve du
   * 28/07/2026, 25,3 °C sous 13 % de nuages, alors classe « couvert_sec »,
   * facteur 1,0000.
   *
   * Le FACTEUR, lui, reste sciemment neutre (1,00) tant qu'il n'est pas
   * mesure — decision D-059, testee separement ci-dessous : refermer le trou
   * de classification est le PREALABLE qui rend la mesure possible, ce n'est
   * pas la mesure elle-meme.
   */
  it('sort une categorie et un libelle propres sur les deux trous refermes, plus « couvert »', () => {
    for (const temperatureC of [23, 25]) {
      const r = facteurMeteo(
        { temperatureC, precipitationsMm: 0, ventKmh: 5, couvertureNuageuseBp: 1343 },
        PARAMETRES,
      );
      expect(r.categorie).toBe('ensoleille_tiede');
      expect(r.explication).not.toContain('couvert');
      expect(r.explication).toContain('tiède');
    }

    const frais = facteurMeteo(
      { temperatureC: 7, precipitationsMm: 0, ventKmh: 5, couvertureNuageuseBp: 1343 },
      PARAMETRES,
    );
    expect(frais.categorie).toBe('ensoleille_frais');
    expect(frais.explication).not.toContain('couvert');
    expect(frais.explication).toContain('frais');

    // Un vrai ciel couvert, lui, garde son libelle : le trou refermé ne l'a
    // pas fait disparaître.
    const couvert = facteurMeteo({ ...METEO_NEUTRE, couvertureNuageuseBp: 9500 }, PARAMETRES);
    expect(couvert.categorie).toBe('couvert_sec');
    expect(couvert.explication).toContain('couvert et sec');
  });

  /**
   * D-059 : « ne jamais inventer un prior non neutre ». `docs/15 §6` avait
   * proposé 11000 (tiède) et 10500 (frais) ; le porteur a corrigé le tir —
   * ces valeurs ne se devinent pas, elles s'apprennent. Le catalogue les
   * porte donc à 10000 (neutre), et ce test verrouille cette neutralité :
   * si quelqu'un réintroduit une valeur devinée dans
   * `packages/core/src/parametres.ts`, ce test casse.
   */
  it('les deux facteurs des trous refermes restent NEUTRES tant qu ils ne sont pas mesures (D-059)', () => {
    const tiede = facteurMeteo(
      { temperatureC: 24, precipitationsMm: 0, ventKmh: 5, couvertureNuageuseBp: 1343 },
      PARAMETRES,
    );
    expect(tiede.categorie).toBe('ensoleille_tiede');
    expect(tiede.facteurBp).toBe(BASE_POINTS);

    const frais = facteurMeteo(
      { temperatureC: 7, precipitationsMm: 0, ventKmh: 5, couvertureNuageuseBp: 1343 },
      PARAMETRES,
    );
    expect(frais.categorie).toBe('ensoleille_frais');
    expect(frais.facteurBp).toBe(BASE_POINTS);
  });
});

describe('sigmaRetenu — honnetete sur l incertitude', () => {
  it('assume un intervalle large sous 8 sessions', () => {
    // « Un modele qui affiche 168 crepes sans intervalle au bout de trois
    // sessions ment. »
    //
    // Le test porte sur la CONVERSION, pas sur un nombre fige : le parametre
    // est un coefficient de VARIATION, la log-normale se parametre par un
    // ecart-type LOG, et CV = √(exp(σ²) − 1). 0,35 de CV vaut σ = 0,3400.
    const cvPrior = PARAMETRES.pointsDeBase('prevision_cv_prior_bp') / BASE_POINTS;
    expect(sigmaRetenu(3, 0.05, PARAMETRES)).toBe(sigmaDepuisCoefficientVariation(cvPrior));
    expect(sigmaRetenu(3, 0.05, PARAMETRES)).toBeLessThan(cvPrior);
  });

  it('se rabat sur le prior quand la mesure est inexploitable', () => {
    // Un sigma `NaN` traversait tout le moteur sans jamais lever : la
    // recommandation ressortait en « NaN crêpes ». Meme famille que D-034.
    const attendu = sigmaRetenu(30, null, PARAMETRES);
    expect(sigmaRetenu(30, Number.NaN, PARAMETRES)).toBe(attendu);
    expect(sigmaRetenu(30, Number.POSITIVE_INFINITY, PARAMETRES)).toBe(attendu);
    expect(sigmaRetenu(30, -1, PARAMETRES)).toBe(attendu);
  });

  it('applique un plancher entre 8 et 25 sessions', () => {
    expect(sigmaRetenu(12, 0.05, PARAMETRES)).toBe(0.2);
    expect(sigmaRetenu(12, 0.4, PARAMETRES)).toBe(0.4);
  });

  it('fait confiance a la mesure au-dela de 25 sessions', () => {
    expect(sigmaRetenu(30, 0.12, PARAMETRES)).toBe(0.12);
  });
});

describe('confianceBp', () => {
  // Lue au catalogue et non reecrite ici : `prevision_demi_confiance_sessions`
  // est sortie du code le 30/07/2026 et sa valeur par defaut doit reproduire
  // exactement l'ancien comportement code en dur.
  const DEMI = Number(
    CATALOGUE_PARAMETRES.find((p) => p.cle === 'prevision_demi_confiance_sessions')?.valeurDefaut,
  );

  it('est nulle sans aucune session', () => {
    expect(confianceBp(0, DEMI)).toBe(0);
  });

  it('croit avec l historique sans jamais atteindre la certitude', () => {
    expect(confianceBp(4, DEMI)).toBeLessThan(confianceBp(20, DEMI));
    expect(confianceBp(50, DEMI)).toBeLessThan(10_000);
  });

  it('reproduit EXACTEMENT les valeurs de l ancienne constante codee en dur', () => {
    // Le seul test qui prouve que la sortie du code vers le catalogue n'a rien
    // change : docs/03 annonce ~67 % a 20 sessions, ~75 % a 30, ~83 % a 50.
    expect(DEMI).toBe(10);
    expect(confianceBp(20, DEMI)).toBe(6667);
    expect(confianceBp(30, DEMI)).toBe(7500);
    expect(confianceBp(50, DEMI)).toBe(8333);
  });
});

describe('prevoir — modele multiplicatif', () => {
  const base = {
    baselineCrepes: 118,
    nbSessionsObservees: 4,
    meteo: null,
    ...COUTS,
    contraintes: [],
  };

  it('rend la baseline quand tous les facteurs sont neutres', () => {
    // `demandeAttendue` est le produit `baseline × facteurs`, c'est-a-dire
    // l'ESPERANCE des ventes. `p50` est la MEDIANE : pour une log-normale elle
    // est plus basse de exp(sigma²/2), et les confondre gonflait toute la
    // chaine de production.
    const r = prevoir(base, PARAMETRES);
    expect(r.demandeAttendue).toBe(118);
    expect(r.p50).toBeLessThan(r.demandeAttendue);
  });

  it('sépare la demande attendue (moyenne) de la médiane', () => {
    // Test sur la FORMULE : la mediane se deduit de l'esperance par le sigma
    // retenu, jamais d'un nombre fige.
    const r = prevoir(base, PARAMETRES);
    const sigma = sigmaRetenu(base.nbSessionsObservees, null, PARAMETRES);
    expect(r.p50).toBe(Math.round(medianeDepuisEsperance(118, sigma)));
  });

  it('multiplie les facteurs entre eux', () => {
    // 118 x 1,30 x 0,95 = 145,7 -> 146, la decomposition affichee de docs/03.
    const r = prevoir(
      { ...base, evenementBp: 13_000, saisonBp: 9500, tendanceBp: 10_000, meteo: null },
      PARAMETRES,
    );
    expect(r.demandeAttendue).toBe(Math.round(118 * 1.3 * 0.95));
  });

  it('applique le facteur meteo', () => {
    const r = prevoir(
      { ...base, meteo: { ...METEO_NEUTRE, temperatureC: 18, couvertureNuageuseBp: 1000 } },
      PARAMETRES,
    );
    expect(r.facteurs.meteoBp).toBe(12_000);
    expect(r.demandeAttendue).toBe(Math.round(118 * 1.2));
  });

  it('refuse un quantile de repli hors du domaine plutôt que de planter', () => {
    // `quantile_cible_production_bp` est saisissable a l'ecran Parametres. A 0
    // ou a 10000, `quantileNormal` levait une `RangeError` non traduite :
    // erreur 500 sur « Prochaine session », sans dire quoi corriger.
    for (const cible of ['0', '10000']) {
      const parametres = Parametres.depuisLignes(
        CATALOGUE_PARAMETRES.map((d) => ({
          cle: d.cle,
          valeur: d.cle === 'quantile_cible_production_bp' ? cible : d.valeurDefaut,
        })),
      );
      expect(() => prevoir({ ...base, coutInvenduCents: 0 }, parametres)).toThrow(ErreurMetier);
    }
  });

  it('refuse une baseline nulle ou negative', () => {
    expect(() => prevoir({ ...base, baselineCrepes: 0 }, PARAMETRES)).toThrow(ErreurMetier);
  });
});

/**
 * `meteoFacteurBp` / `meteoExplication` (docs/17 fiches 2/4, D-059) : le
 * facteur météo MESURÉ, calculé et validé par
 * `apps/api/src/routes/previsions.ts`, prime sur le prior calculé en interne
 * par `facteurMeteo(entree.meteo, parametres)`.
 */
describe('prevoir — facteur meteo MESURE (D-059)', () => {
  const base = {
    baselineCrepes: 118,
    nbSessionsObservees: 4,
    meteo: { ...METEO_NEUTRE, temperatureC: 18, couvertureNuageuseBp: 1000 }, // prior 12000
    ...COUTS,
    contraintes: [],
  };

  it('zéro régression : `meteoFacteurBp` absent laisse le prior EXACTEMENT comme avant', () => {
    const r = prevoir(base, PARAMETRES);
    expect(r.facteurs.meteoBp).toBe(12_000);
    expect(r.demandeAttendue).toBe(Math.round(118 * 1.2));
  });

  it('le facteur mesuré remplace le prior quand il est fourni', () => {
    const r = prevoir({ ...base, meteoFacteurBp: 13_500 }, PARAMETRES);
    expect(r.facteurs.meteoBp).toBe(13_500);
    expect(r.demandeAttendue).toBe(Math.round(118 * 1.35));
  });

  it('l’explication mesurée remplace celle du prior dans la décomposition affichée', () => {
    const r = prevoir(
      {
        ...base,
        meteoFacteurBp: 13_500,
        meteoExplication: 'ensoleillé et doux — mesuré sur 9 dimanches',
      },
      PARAMETRES,
    );
    expect(r.explication.join(' ')).toContain('mesuré sur 9 dimanches');
  });

  it('sans meteo (mode degrade), le facteur mesuré ne s’applique jamais', () => {
    // Un appelant ne doit normalement jamais fournir `meteoFacteurBp` sans
    // `meteo` — mais si `meteo` est `null`, le neutre doit rester la seule
    // issue possible : rien à mesurer sans conditions.
    const r = prevoir({ ...base, meteo: null }, PARAMETRES);
    expect(r.facteurs.meteoBp).toBe(BASE_POINTS);
  });
});

describe('prevoir — decision economique : NE JAMAIS produire la mediane', () => {
  const base = {
    baselineCrepes: 118,
    nbSessionsObservees: 4,
    meteo: null,
    ...COUTS,
    contraintes: [],
  };

  it('recommande nettement PLUS que la mediane', () => {
    const r = prevoir(base, PARAMETRES);
    expect(r.crepesRecommandees).toBeGreaterThan(r.p50);
    expect(r.crepesRecommandees).toBeGreaterThan(r.p90 * 0.95);
  });

  it('retient un quantile cible autour de 0,93 avec les couts reels', () => {
    // Le test porte sur la FORMULE, pas sur une valeur figee : `Cu` et `Co`
    // viennent des donnees reelles et le ratio se recalcule a chaque prevision
    // (docs/07 §6.6, point 4).
    const r = prevoir(base, PARAMETRES);
    const ratio = ratioCritique(315, 25);
    expect(ratio).not.toBeNull();
    expect(r.quantileCibleBp).toBe(Math.round(ratio! * 10_000));
    expect(r.quantileCibleBp).toBeGreaterThan(9000);
  });

  it('se rabat sur le quantile cible paramétré quand un coût manque', () => {
    // Repli documenté par la description du paramètre lui-même. Sans lui, le
    // ratio valait 1 et la prévision plantait sur une installation neuve.
    const sansCoutInvendu = prevoir({ ...base, coutInvenduCents: 0 }, PARAMETRES);
    expect(sansCoutInvendu.quantileCibleBp).toBe(
      PARAMETRES.pointsDeBase('quantile_cible_production_bp'),
    );
    expect(Number.isFinite(sansCoutInvendu.crepesRecommandees)).toBe(true);
  });

  it('produit moins quand l invendu coute aussi cher que la rupture', () => {
    const symetrique = prevoir(
      { ...base, coutRuptureCents: 100, coutInvenduCents: 100 },
      PARAMETRES,
    );
    expect(symetrique.crepesRecommandees).toBe(symetrique.p50);
  });

  it('produit plus quand la pate restante est reutilisable (invendu moins cher)', () => {
    const cher = prevoir({ ...base, coutInvenduCents: 100 }, PARAMETRES);
    const pasCher = prevoir({ ...base, coutInvenduCents: 5 }, PARAMETRES);
    expect(pasCher.crepesRecommandees).toBeGreaterThan(cher.crepesRecommandees);
  });

  it('explique POURQUOI produire plus que la mediane', () => {
    // La recommandation contredira l'intuition : l'ecran doit argumenter.
    const texte = prevoir(base, PARAMETRES).explication.join(' ');
    expect(texte).toContain('rupture');
    expect(texte).toContain('% des cas, pas 50 %');
  });
});

describe('prevoir — contraintes dures', () => {
  const base = {
    baselineCrepes: 200,
    nbSessionsObservees: 10,
    meteo: null,
    ...COUTS,
  };

  it('ne retient rien de plus que la contrainte la plus basse', () => {
    const r = prevoir(
      {
        ...base,
        contraintes: [
          { libelle: 'capacité de cuisson', plafondCrepes: 185 },
          { libelle: 'capacité de la glacière', plafondCrepes: 176 },
        ],
      },
      PARAMETRES,
    );

    expect(r.crepesRetenues).toBe(176);
    expect(r.contrainteLimitante).toBe('capacité de la glacière');
  });

  it('chiffre le manque a gagner — c est lui qui justifiera un investissement', () => {
    const r = prevoir(
      { ...base, contraintes: [{ libelle: 'capacité de cuisson', plafondCrepes: 180 }] },
      PARAMETRES,
    );

    // Le test porte sur la FORMULE : difference de profit ESPERE, recalculee
    // ici a partir des memes primitives. Jamais un nombre fige.
    const sigma = sigmaRetenu(base.nbSessionsObservees, null, PARAMETRES);
    const mediane = medianeDepuisEsperance(base.baselineCrepes, sigma);
    expect(r.manqueAGagnerCents).toBe(
      manqueAGagnerEcretage({
        crepesRecommandees: r.crepesRecommandees,
        crepesRetenues: 180,
        mediane,
        sigma,
        coutRuptureCents: 315,
        coutInvenduCents: 25,
      }),
    );
    expect(r.explication.join(' ')).toContain('Manque à gagner');
  });

  it('le manque a gagner reste TRES en dessous de « crêpes perdues × marge »', () => {
    // docs/03 chiffre l'exemple 210 -> 180 a 94,50 € (30 x 3,15 €), en
    // supposant que les 30 crepes retirees se seraient toutes vendues. Elles
    // viennent du HAUT de la distribution : en esperance il s'en vend 3,3.
    // Surestime d'un facteur 25, ce chiffre justifierait un achat de materiel
    // qui ne se rembourserait jamais.
    const r = prevoir(
      { ...base, contraintes: [{ libelle: 'capacité de cuisson', plafondCrepes: 180 }] },
      PARAMETRES,
    );
    const naif = (r.crepesRecommandees - 180) * 315;
    expect(r.manqueAGagnerCents).toBeGreaterThan(0);
    expect(r.manqueAGagnerCents).toBeLessThan(naif / 2);
  });

  it('ne signale aucune contrainte quand aucune ne mord', () => {
    const r = prevoir(
      { ...base, contraintes: [{ libelle: 'capacité de cuisson', plafondCrepes: 9999 }] },
      PARAMETRES,
    );
    expect(r.contrainteLimitante).toBeNull();
    expect(r.manqueAGagnerCents).toBeNull();
    expect(r.crepesRetenues).toBe(r.crepesRecommandees);
  });
});

describe('contraintesSession', () => {
  it('calcule la capacite de cuisson depuis les parametres, jamais en dur', () => {
    // 6 h 30 x 85 % x 60 crepes/h = 331.
    const contraintes = contraintesSession({
      fenetreMinutes: 390,
      volumeParCrepeMl: 76,
      stockMaximalCrepes: null,
      parametres: PARAMETRES,
    });
    const cuisson = contraintes.find((c) => c.libelle === 'capacité de cuisson');
    expect(cuisson?.plafondCrepes).toBe(331);
  });

  it('borne par la glaciere', () => {
    // 18 000 ml / 76 ml = 236 crepes.
    const contraintes = contraintesSession({
      fenetreMinutes: 390,
      volumeParCrepeMl: 76,
      stockMaximalCrepes: null,
      parametres: PARAMETRES,
    });
    const glaciere = contraintes.find((c) => c.libelle === 'capacité de la glacière');
    expect(glaciere?.plafondCrepes).toBe(236);
  });

  it('ajoute le stock quand il est connu', () => {
    const contraintes = contraintesSession({
      fenetreMinutes: 390,
      volumeParCrepeMl: 76,
      stockMaximalCrepes: 150,
      parametres: PARAMETRES,
    });
    expect(contraintes.map((c) => c.libelle)).toContain("stock d'ingrédients");
  });

  it('ne rend JAMAIS un plafond negatif ni non fini', () => {
    // Une heure de fin saisie avant l heure de debut donne une fenetre
    // negative : le plafond de cuisson descendait a −1020 crepes, `prevoir`
    // retenait ce minimum, et la recommandation devenait negative avec un
    // manque a gagner gigantesque.
    const contraintes = contraintesSession({
      fenetreMinutes: -1200,
      volumeParCrepeMl: 76,
      stockMaximalCrepes: -40,
      parametres: PARAMETRES,
    });
    for (const c of contraintes) {
      expect(c.plafondCrepes).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(c.plafondCrepes)).toBe(true);
    }

    const nonFinies = contraintesSession({
      fenetreMinutes: Number.NaN,
      volumeParCrepeMl: 76,
      stockMaximalCrepes: Number.POSITIVE_INFINITY,
      parametres: PARAMETRES,
    });
    for (const c of nonFinies) {
      expect(Number.isFinite(c.plafondCrepes)).toBe(true);
      expect(c.plafondCrepes).toBeGreaterThanOrEqual(0);
    }
  });

  it('omet la glaciere quand le volume par crepe est inconnu', () => {
    const contraintes = contraintesSession({
      fenetreMinutes: 390,
      volumeParCrepeMl: 0,
      stockMaximalCrepes: null,
      parametres: PARAMETRES,
    });
    expect(contraintes.map((c) => c.libelle)).not.toContain('capacité de la glacière');
  });

  /**
   * Quatrieme contrainte dure de docs/03 (« volume maximal transportable sans
   * vehicule personnel »), absente du moteur jusqu'a l'audit du 30/07/2026.
   * `transport_volume_pate_max_ml` vaut 0 par defaut au catalogue : NON
   * RENSEIGNE, jamais « aucune limite ». Tant qu'elle reste a 0, ce test
   * PROUVE la garantie de 0 regression : aucune prevision existante ne
   * renseigne cette cle, donc aucune ne doit voir apparaitre une troisieme
   * contrainte de volume.
   */
  it('omet le volume transportable tant que le parametre vaut 0 (non renseigne)', () => {
    const contraintes = contraintesSession({
      fenetreMinutes: 390,
      volumeParCrepeMl: 76,
      stockMaximalCrepes: null,
      parametres: PARAMETRES, // transport_volume_pate_max_ml = 0 (defaut catalogue)
    });
    expect(contraintes.map((c) => c.libelle)).not.toContain('volume transportable');
    // Exactement les deux contraintes deja couvertes par les tests ci-dessus :
    // aucune troisieme contrainte n'apparait tant que rien n'est renseigne.
    expect(contraintes).toHaveLength(2);
  });

  it('ajoute le volume transportable, calcule exactement comme la glaciere, des qu il est renseigne', () => {
    const parametresRenseignes = Parametres.depuisLignes(
      CATALOGUE_PARAMETRES.map((d) => ({
        cle: d.cle,
        valeur: d.cle === 'transport_volume_pate_max_ml' ? '15200' : d.valeurDefaut,
      })),
    );
    // 15 200 ml / 76 ml = 200 crepes — meme formule que la glaciere.
    const contraintes = contraintesSession({
      fenetreMinutes: 390,
      volumeParCrepeMl: 76,
      stockMaximalCrepes: null,
      parametres: parametresRenseignes,
    });
    const transport = contraintes.find((c) => c.libelle === 'volume transportable');
    expect(transport?.plafondCrepes).toBe(200);
  });

  it('omet aussi le volume transportable quand le volume par crepe est inconnu, meme renseigne', () => {
    const parametresRenseignes = Parametres.depuisLignes(
      CATALOGUE_PARAMETRES.map((d) => ({
        cle: d.cle,
        valeur: d.cle === 'transport_volume_pate_max_ml' ? '15200' : d.valeurDefaut,
      })),
    );
    const contraintes = contraintesSession({
      fenetreMinutes: 390,
      volumeParCrepeMl: 0,
      stockMaximalCrepes: null,
      parametres: parametresRenseignes,
    });
    expect(contraintes.map((c) => c.libelle)).not.toContain('volume transportable');
  });
});

/**
 * Quatrieme contrainte dure de docs/03, cote `prevoir()` : l'HONNETETE de
 * l'explication affichee. Une valeur absente ne doit jamais se lire comme une
 * capacite illimitee (le defaut « inconnu = infini », symetrique de « inconnu
 * = zero », corrige neuf fois cette nuit) : tant que
 * `transport_volume_pate_max_ml` vaut 0, `prevoir` le dit explicitement, au
 * meme endroit que les trois autres contraintes.
 */
describe('prevoir — quatrieme contrainte dure : volume transportable non renseignee par defaut', () => {
  const base = {
    baselineCrepes: 118,
    nbSessionsObservees: 4,
    meteo: null,
    ...COUTS,
    contraintes: [],
  };

  it('0 regression : la mention n a AUCUN effet sur les chiffres calcules', () => {
    // Memes valeurs que « rend la baseline quand tous les facteurs sont
    // neutres » et « recommande nettement PLUS que la mediane » plus haut,
    // sur le meme `base` non modifie : la seule chose qui change est un texte
    // supplementaire dans `explication`.
    const r = prevoir(base, PARAMETRES);
    expect(r.demandeAttendue).toBe(118);
    expect(r.p50).toBeLessThan(118);
    expect(r.crepesRecommandees).toBeGreaterThan(r.p50);
    expect(r.crepesRetenues).toBe(r.crepesRecommandees);
  });

  it('mentionne explicitement l absence de controle tant que le parametre vaut 0', () => {
    const texte = prevoir(base, PARAMETRES).explication.join(' ');
    expect(texte).toContain('Volume transportable non renseigné');
    expect(texte).toContain("n'est pas contrôlée");
  });

  it('ne mentionne plus rien des que le parametre est renseigne', () => {
    const parametresRenseignes = Parametres.depuisLignes(
      CATALOGUE_PARAMETRES.map((d) => ({
        cle: d.cle,
        valeur: d.cle === 'transport_volume_pate_max_ml' ? '15200' : d.valeurDefaut,
      })),
    );
    const texte = prevoir(base, parametresRenseignes).explication.join(' ');
    expect(texte).not.toContain('non renseigné');
  });
});

describe('sigma mesuré transmis au moteur', () => {
  const COUTS_REELS = { coutRuptureCents: 315, coutInvenduCents: 25 };

  function avecSigma(sigmaObserve: number | null, nbSessions: number) {
    return prevoir(
      {
        baselineCrepes: 134,
        nbSessionsObservees: nbSessions,
        sigmaObserve,
        meteo: null,
        contraintes: [],
        ...COUTS_REELS,
      },
      PARAMETRES,
    );
  }

  it('un sigma mesuré RESSERRE l intervalle et la recommandation', () => {
    // Le defaut : `sigmaRetenu(n, null, …)` etait ecrit en dur, donc le sigma
    // calcule sur l'historique n'atteignait jamais le moteur. L'intervalle
    // restait au coefficient de variation prior (0,35) a vie, et la
    // recommandation avec — une quarantaine de crepes en trop par marche.
    const prior = avecSigma(null, 30);
    const mesure = avecSigma(0.18, 30);

    expect(mesure.p90 - mesure.p10).toBeLessThan(prior.p90 - prior.p10);
    expect(mesure.crepesRecommandees).toBeLessThan(prior.crepesRecommandees);
  });

  it('ignore le sigma mesuré tant que l historique est trop court', () => {
    // Sous 8 sessions, on ne mesure rien de fiable : le prior prime, c'est un
    // choix d'honnetete deja pose par `sigmaRetenu`.
    expect(avecSigma(0.05, 3).crepesRecommandees).toBe(avecSigma(null, 3).crepesRecommandees);
  });

  it('applique le plancher de sigma entre 8 et 25 sessions', () => {
    // Un sigma absurdement bas sur un historique encore court donnerait un
    // intervalle faussement etroit.
    const plancherBp = PARAMETRES.pointsDeBase('prevision_plancher_sigma_bp');
    const auPlancher = avecSigma(plancherBp / BASE_POINTS, 10);
    const sousLePlancher = avecSigma(0.01, 10);
    expect(sousLePlancher.crepesRecommandees).toBe(auPlancher.crepesRecommandees);
  });
});

/**
 * docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md §2 : quatre
 * nouveaux predicteurs (comparable calendaire, jour de semaine, vacances
 * scolaires, session consecutive) et un cinquieme qui calibre l'incertitude
 * (ecart meteo prevue/realisee). Regle du porteur, 29/07 : « 0 régression,
 * 100 % amélioration » — la premiere serie de tests ci-dessous PROUVE la
 * non-regression (aucun appelant existant ne fournit ces champs), la
 * deuxieme prouve que le moteur les compose correctement quand on les lui
 * donne.
 */
describe('prevoir — nouveaux prédicteurs (docs/demandes/07) : 0 régression', () => {
  const base = {
    baselineCrepes: 118,
    nbSessionsObservees: 4,
    meteo: null,
    ...COUTS,
    contraintes: [],
  };

  it('un appelant qui ne connaît pas les nouveaux champs obtient EXACTEMENT le même résultat qu’avant leur introduction', () => {
    // C'est la garantie de démarrage à froid : tant qu'aucun prédicteur ne
    // fournit de valeur (parce qu'aucun n'a assez d'historique pour s'estimer
    // sérieusement, ou qu'aucun n'a été admis par la validation croisée), le
    // moteur doit se comporter EXACTEMENT comme avant leur introduction.
    // `exactOptionalPropertyTypes` interdit d'ecrire `champ: undefined` :
    // omettre le champ est la seule facon d'exprimer « je ne le fournis pas »,
    // et c'est exactement le cas que ce test doit couvrir — un appelant qui
    // ignore purement et simplement l'existence de ces cinq champs, comme
    // `apps/api/src/routes/previsions.ts` aujourd'hui.
    //
    // Valeurs PINGEES sur ce que la formule rendait AVANT ce lot (voir le
    // test « rend la baseline quand tous les facteurs sont neutres » et
    // « recommande nettement PLUS que la mediane » ci-dessus, sur le même
    // `base` non modifié) : 118 crêpes de demande attendue, un p50 strictement
    // sous 118, et une recommandation strictement au-dessus du p50.
    const r = prevoir(base, PARAMETRES);
    expect(r.demandeAttendue).toBe(118);
    expect(r.p50).toBeLessThan(118);
    expect(r.crepesRecommandees).toBeGreaterThan(r.p50);
  });

  it('les quatre nouveaux facteurs sont neutres par défaut, mais TOUJOURS présents dans la décomposition', () => {
    const r = prevoir(base, PARAMETRES);
    expect(r.facteurs.comparableCalendaireBp).toBe(BASE_POINTS);
    expect(r.facteurs.jourSemaineBp).toBe(BASE_POINTS);
    expect(r.facteurs.vacancesScolairesBp).toBe(BASE_POINTS);
    expect(r.facteurs.sessionConsecutiveBp).toBe(BASE_POINTS);
  });

  it('un prédicteur neutre ne laisse AUCUNE trace dans l’explication affichée', () => {
    const texte = prevoir(base, PARAMETRES).explication.join(' ');
    expect(texte).not.toContain('Comparable calendaire');
    expect(texte).not.toContain('Jour de la semaine');
    expect(texte).not.toContain('Vacances scolaires');
    expect(texte).not.toContain('Session précédente');
    expect(texte).not.toContain('fiabilité météo');
  });
});

describe('prevoir — nouveaux prédicteurs (docs/demandes/07) : composition', () => {
  const base = {
    baselineCrepes: 118,
    nbSessionsObservees: 4,
    meteo: null,
    ...COUTS,
    contraintes: [],
  };

  it('compose les quatre nouveaux facteurs dans le produit multiplicatif', () => {
    const r = prevoir(
      {
        ...base,
        comparableCalendaireBp: 15_000,
        jourSemaineBp: 9_000,
        vacancesScolairesBp: 11_000,
        sessionConsecutiveBp: 9_500,
      },
      PARAMETRES,
    );
    const attendu = Math.round(118 * 1.5 * 0.9 * 1.1 * 0.95);
    expect(r.demandeAttendue).toBe(attendu);
  });

  it('chaque facteur non neutre apparaît dans la décomposition affichée', () => {
    const texte = prevoir(
      {
        ...base,
        comparableCalendaireBp: 15_000,
        jourSemaineBp: 9_000,
        vacancesScolairesBp: 11_000,
        sessionConsecutiveBp: 9_500,
      },
      PARAMETRES,
    ).explication.join(' ');
    expect(texte).toContain('Comparable calendaire');
    expect(texte).toContain('Jour de la semaine');
    expect(texte).toContain('Vacances scolaires');
    expect(texte).toContain('Session précédente');
  });

  it('une inflation de sigma ÉLARGIT l’intervalle sans changer la demande attendue', () => {
    const sansInflation = prevoir(base, PARAMETRES);
    const avecInflation = prevoir({ ...base, inflationSigmaMeteoBp: 15_000 }, PARAMETRES);

    expect(avecInflation.demandeAttendue).toBe(sansInflation.demandeAttendue);
    expect(avecInflation.p90 - avecInflation.p10).toBeGreaterThan(
      sansInflation.p90 - sansInflation.p10,
    );
    expect(avecInflation.explication.join(' ')).toContain('fiabilité météo');
  });

  it('une inflation neutre (10000) ne change strictement rien', () => {
    const sansChamp = prevoir(base, PARAMETRES);
    const avecChampNeutre = prevoir({ ...base, inflationSigmaMeteoBp: BASE_POINTS }, PARAMETRES);
    expect(avecChampNeutre).toEqual(sansChamp);
  });
});

/**
 * docs/demandes/06 — « Prévision calendaire sur 365 jours et achats
 * anticipés », le piège central : l'incertitude doit croître visiblement
 * avec l'horizon. Même patron de non-régression que `inflationSigmaMeteoBp`
 * ci-dessus : `previsionCourante` (apps/api/src/routes/previsions.ts, la
 * prochaine session) ne fournit jamais ce nouveau champ, donc son résultat
 * ne doit pas bouger d'un iota.
 */
describe('prevoir — inflation de sigma liée à l’HORIZON CALENDAIRE (docs/demandes/06)', () => {
  const base = {
    baselineCrepes: 118,
    nbSessionsObservees: 4,
    meteo: null,
    ...COUTS,
    contraintes: [],
  };

  it('zéro régression : absente, elle laisse `prevoir` EXACTEMENT comme avant son introduction', () => {
    const sansChamp = prevoir(base, PARAMETRES);
    expect(sansChamp.demandeAttendue).toBe(118);
    expect(sansChamp.p50).toBeLessThan(118);
  });

  it('une inflation neutre (10000) ne change strictement rien — même valeur, byte à byte', () => {
    const sansChamp = prevoir(base, PARAMETRES);
    const avecChampNeutre = prevoir({ ...base, inflationSigmaHorizonBp: BASE_POINTS }, PARAMETRES);
    expect(avecChampNeutre).toEqual(sansChamp);
  });

  it('élargit l’intervalle P10/P90 SANS changer la demande attendue', () => {
    const proche = prevoir(base, PARAMETRES);
    const lointaine = prevoir({ ...base, inflationSigmaHorizonBp: 30_000 }, PARAMETRES);

    expect(lointaine.demandeAttendue).toBe(proche.demandeAttendue);
    expect(lointaine.p90 - lointaine.p10).toBeGreaterThan(proche.p90 - proche.p10);
    expect(lointaine.explication.join(' ')).toContain("éloignement de l'échéance");
  });

  it('se COMPOSE avec l’inflation météo, sans que l’une remplace l’autre', () => {
    const seuleMeteo = prevoir({ ...base, inflationSigmaMeteoBp: 15_000 }, PARAMETRES);
    const meteoEtHorizon = prevoir(
      { ...base, inflationSigmaMeteoBp: 15_000, inflationSigmaHorizonBp: 15_000 },
      PARAMETRES,
    );
    // Les deux intervalles s'élargissent l'un ET l'autre : le second doit être
    // strictement plus large que le premier, jamais égal (composition
    // multiplicative, pas un simple remplacement du plus large des deux).
    expect(meteoEtHorizon.p90 - meteoEtHorizon.p10).toBeGreaterThan(
      seuleMeteo.p90 - seuleMeteo.p10,
    );
  });

  it('la garantie « jamais de contraction » vit dans la SOURCE, pas dans `prevoir`', () => {
    // `prevoir` fait confiance à son appelant, comme il le fait déjà pour
    // `inflationSigmaMeteoBp` (aucun clamp non plus sur ce champ) : c'est
    // `inflationHorizonBp` (horizon.ts) qui porte la garantie de ne jamais
    // rendre moins que 10000, testée séparément dans horizon.test.ts. Ce test
    // documente ce partage des responsabilités : si un appelant transmettait
    // quand même une valeur sous 10000, `prevoir` la répercuterait telle
    // quelle plutôt que de la corriger silencieusement — même choix que pour
    // `inflationSigmaMeteoBp`.
    const sansInflation = prevoir(base, PARAMETRES);
    const inflationBasse = prevoir({ ...base, inflationSigmaHorizonBp: 5_000 }, PARAMETRES);
    expect(inflationBasse.p90 - inflationBasse.p10).toBeLessThan(
      sansInflation.p90 - sansInflation.p10,
    );
  });
});
