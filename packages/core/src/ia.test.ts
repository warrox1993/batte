import { describe, expect, it } from 'vitest';
import { CATALOGUE_PARAMETRES, Parametres } from './parametres.js';
import {
  coutAppelCents,
  coutMaximalCents,
  coutRechercheWebCents,
  estimerTokens,
  familleModele,
  tarifModele,
  verifierPlafond,
} from './ia.js';

/** Parametres charges depuis le catalogue : aucune valeur codee dans le test. */
const PARAMETRES = Parametres.depuisLignes(
  CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: d.valeurDefaut })),
);

/** Rejoue le catalogue en surchargeant une cle — pour tester un plafond different. */
function avec(surcharges: Record<string, string>): Parametres {
  return Parametres.depuisLignes(
    CATALOGUE_PARAMETRES.map((d) => ({
      cle: d.cle,
      valeur: surcharges[d.cle] ?? d.valeurDefaut,
    })),
  );
}

describe('familleModele', () => {
  it("envoie l'extraction sur le modèle bon marché", () => {
    expect(familleModele('extraction')).toBe('extraction');
    expect(familleModele('evenements')).toBe('extraction');
  });

  it('envoie les commentaires sur le modèle capable', () => {
    expect(familleModele('prevision')).toBe('commentaire');
    expect(familleModele('analyse_ecart')).toBe('commentaire');
    expect(familleModele('synthese')).toBe('commentaire');
  });
});

describe('tarifModele', () => {
  it('lit le modèle et les tarifs dans les paramètres, jamais en dur', () => {
    const perso = avec({
      ia_modele_extraction: 'modele-fictif',
      ia_tarif_extraction_entree_cents_par_mtok: '42',
    });
    const tarif = tarifModele('extraction', perso);
    expect(tarif.modele).toBe('modele-fictif');
    expect(tarif.entreeCentsParMtok).toBe(42);
  });

  it('distingue les deux familles', () => {
    expect(tarifModele('commentaire', PARAMETRES).entreeCentsParMtok).toBeGreaterThan(
      tarifModele('extraction', PARAMETRES).entreeCentsParMtok,
    );
  });
});

describe('coutAppelCents', () => {
  const tarif = { modele: 'x', entreeCentsParMtok: 100, sortieCentsParMtok: 500 };

  it('calcule au prorata du million de tokens', () => {
    // 1 Mtok entrée + 1 Mtok sortie = 100 + 500 centimes.
    expect(coutAppelCents(1_000_000, 1_000_000, tarif)).toBe(600);
  });

  it('ne compte JAMAIS zéro pour un appel qui a coûté quelque chose', () => {
    // 100 tokens à 1 €/Mtok valent 0,01 centime. Arrondi au plus proche, ce
    // serait 0 — et le plafond mensuel ne serait jamais atteint.
    expect(coutAppelCents(100, 0, tarif)).toBe(1);
  });

  it('rend zéro pour un appel réellement vide', () => {
    expect(coutAppelCents(0, 0, tarif)).toBe(0);
  });

  it('arrondit au supérieur', () => {
    expect(coutAppelCents(15_000, 0, tarif)).toBe(2); // 1,5 centime -> 2
  });

  it('reste un entier de centimes', () => {
    expect(Number.isInteger(coutAppelCents(3457, 1289, tarif))).toBe(true);
  });
});

describe('coutMaximalCents', () => {
  it('majore le coût réel du même appel', () => {
    const tarif = tarifModele('commentaire', PARAMETRES);
    const max = coutMaximalCents(2000, 1024, tarif);
    const reel = coutAppelCents(2000, 300, tarif);
    expect(max).toBeGreaterThanOrEqual(reel);
  });
});

describe('coutRechercheWebCents', () => {
  /**
   * `coutRechercheWebCents` n'avait AUCUN test direct dans ce fichier alors
   * qu'elle vit dans `packages/core` (CLAUDE.md §4 : « toute fonction de
   * packages/core est testée ») — seule `evenements-decouverte.test.ts`
   * (hors zone de cet agent) l'exerçait, indirectement, à travers une route
   * entière. Ces tests couvrent la fonction PURE elle-même : l'arrondi, le cas
   * zéro, et la lecture du tarif depuis `parametre` (jamais une valeur en dur).
   */
  it('lit le tarif dans les paramètres, jamais en dur', () => {
    const perso = avec({ ia_tarif_recherche_web_cents_par_mille: '2000' });
    // 2000 centimes pour 1000 recherches → 2 centimes par recherche.
    expect(coutRechercheWebCents(1, perso)).toBe(2);
    expect(coutRechercheWebCents(10, perso)).toBe(20);
  });

  it('rend zéro pour zéro recherche', () => {
    expect(coutRechercheWebCents(0, PARAMETRES)).toBe(0);
  });

  it('ne compte JAMAIS zéro pour une recherche réellement exécutée et facturée', () => {
    // Un tarif faible sur une seule recherche vaut une fraction de centime :
    // arrondie au plus proche, ce serait zéro, et le plafond ne verrait jamais
    // passer une recherche pourtant réellement facturée par Anthropic.
    const perso = avec({ ia_tarif_recherche_web_cents_par_mille: '1' });
    expect(coutRechercheWebCents(1, perso)).toBe(1);
  });

  it('arrondit au supérieur, même règle que coutAppelCents (D-030)', () => {
    const perso = avec({ ia_tarif_recherche_web_cents_par_mille: '3000' });
    // 3 recherches à 3000 c/1000 = 9 centimes exactement.
    expect(coutRechercheWebCents(3, perso)).toBe(9);
    // 1 recherche à 3000 c/1000 = 3 centimes exactement (pas d'arrondi requis
    // ici, mais confirme l'absence de sur-arrondi).
    expect(coutRechercheWebCents(1, perso)).toBe(3);
  });

  it('varie indépendamment de coutAppelCents : les deux coûts ne se substituent jamais l’un à l’autre', () => {
    // CLAUDE.md §5 : Anthropic facture les tokens et les recherches web
    // séparément. Si les deux fonctions partageaient un état ou se
    // recouvraient, augmenter les recherches changerait aussi le coût des
    // tokens (ou l'inverse) — ce que ce test interdit explicitement.
    const tarif = { modele: 'x', entreeCentsParMtok: 100, sortieCentsParMtok: 500 };
    // Tarif rond (1 cent/recherche exactement) pour que la mise à l'échelle
    // soit vérifiable sans effet d'arrondi qui la fausserait.
    const perso = avec({ ia_tarif_recherche_web_cents_par_mille: '1000' });

    const coutTokensSeul = coutAppelCents(1_000_000, 1_000_000, tarif);
    const coutRecherchesSeul = coutRechercheWebCents(5, perso);

    expect(coutTokensSeul).toBeGreaterThan(0);
    expect(coutRecherchesSeul).toBeGreaterThan(0);
    // Multiplier les recherches par 10 ne doit rien changer au coût des tokens.
    expect(coutAppelCents(1_000_000, 1_000_000, tarif)).toBe(coutTokensSeul);
    expect(coutRechercheWebCents(50, perso)).toBe(coutRecherchesSeul * 10);
  });
});

describe('verifierPlafond', () => {
  it('autorise tant que le plafond est loin', () => {
    const decision = verifierPlafond(0, 5, PARAMETRES);
    expect(decision.autorise).toBe(true);
  });

  it('refuse quand l appel ferait franchir le plafond', () => {
    // On refuse AVANT, pas après : une dépense engagée ne se reprend pas.
    const decision = verifierPlafond(498, 5, PARAMETRES);
    expect(decision.autorise).toBe(false);
    if (!decision.autorise) expect(decision.raison).toContain('Plafond mensuel atteint');
  });

  it('autorise un appel qui tombe exactement sur le plafond', () => {
    const decision = verifierPlafond(495, 5, PARAMETRES);
    expect(decision.autorise).toBe(true);
    if (decision.autorise) expect(decision.resteCents).toBe(0);
  });

  it('coupe entièrement l IA quand le plafond vaut zéro', () => {
    // Mode dégradé volontaire : l'utilisateur doit pouvoir désactiver Claude
    // sans rien casser (CLAUDE.md §5).
    const decision = verifierPlafond(0, 1, avec({ plafond_ia_mensuel_cents: '0' }));
    expect(decision.autorise).toBe(false);
    if (!decision.autorise) expect(decision.raison).toContain('désactivée');
  });

  it('nomme le montant restant dans le refus, pas seulement « dépassé »', () => {
    const decision = verifierPlafond(500, 1, PARAMETRES);
    expect(decision.autorise).toBe(false);
    if (!decision.autorise) expect(decision.raison).toContain('5,00 €');
  });
});

describe('estimerTokens', () => {
  it('majore plutôt que de sous-estimer', () => {
    // Une sous-estimation ferait franchir le plafond sans l'avoir vu venir.
    const texte = 'a'.repeat(400);
    expect(estimerTokens(texte)).toBeGreaterThan(400 / 4);
  });

  it('rend zéro sur une chaîne vide', () => {
    expect(estimerTokens('')).toBe(0);
  });
});
