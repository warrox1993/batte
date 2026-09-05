import { describe, expect, it } from 'vitest';
import { ErreurParametreManquant } from './erreurs.js';
import { CATALOGUE_PARAMETRES, Parametres, definitionParametre } from './parametres.js';

describe('CATALOGUE_PARAMETRES', () => {
  it('ne contient aucune cle en double', () => {
    const cles = CATALOGUE_PARAMETRES.map((d) => d.cle);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it('documente une source pour chaque parametre', () => {
    // CLAUDE.md §7 : un seuil sans source est inverifiable l'annee suivante.
    for (const definition of CATALOGUE_PARAMETRES) {
      expect(definition.source.length, definition.cle).toBeGreaterThan(0);
      expect(definition.description.length, definition.cle).toBeGreaterThan(0);
    }
  });

  it('date la validite de chaque parametre au format AAAA-MM-JJ', () => {
    for (const definition of CATALOGUE_PARAMETRES) {
      expect(definition.dateDebutValidite, definition.cle).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('declare une valeur par defaut coherente avec son type', () => {
    for (const definition of CATALOGUE_PARAMETRES) {
      if (definition.typeValeur === 'entier') {
        expect(definition.valeurDefaut, definition.cle).toMatch(/^-?\d+$/);
      }
      if (definition.typeValeur === 'decimal') {
        expect(Number.isFinite(Number(definition.valeurDefaut)), definition.cle).toBe(true);
      }
    }
  });

  it('couvre les cles minimales exigees par docs/02-MODELE-DONNEES.md', () => {
    const attendues = [
      'seuil_franchise_tva_cents',
      'seuil_airbag_cents',
      'seuil_cotisation_reduite_cents',
      'taux_cotisation_inasti_bp',
      'taux_ipp_marginal_bp',
      'taux_commission_sumup_bp',
      'quantile_cible_production_bp',
      'temperature_max_froid_c',
      'duree_conservation_pate_heures',
    ];
    const presentes = CATALOGUE_PARAMETRES.map((d) => d.cle);
    for (const cle of attendues) expect(presentes).toContain(cle);
  });

  it("garde 'adresse_depart_defaut' vide par défaut — jamais une adresse inventée (D-064)", () => {
    // Une adresse plausible serait pire qu'un vide : elle produirait des
    // distances fausses que rien ne signalerait. Voir
    // packages/core/src/point-depart.ts pour la résolution session/défaut.
    const definition = definitionParametre('adresse_depart_defaut');
    expect(definition?.typeValeur).toBe('texte');
    expect(definition?.valeurDefaut).toBe('');
    expect(definition?.source).toMatch(/porteur/i);
  });
});

describe('definitionParametre', () => {
  it('retrouve une definition par sa cle', () => {
    expect(definitionParametre('taux_commission_sumup_bp')?.valeurDefaut).toBe('169');
  });

  it('rend undefined sur une cle inconnue', () => {
    expect(definitionParametre('cle_qui_n_existe_pas')).toBeUndefined();
  });
});

describe('Parametres', () => {
  const jeu = Parametres.depuisLignes([
    { cle: 'seuil_franchise_tva_cents', valeur: '2500000' },
    { cle: 'taux_commission_sumup_bp', valeur: '169' },
    { cle: 'temperature_max_froid_c', valeur: '7' },
    { cle: 'duree_conservation_pate_heures', valeur: '24' },
  ]);

  it('lit un montant en centimes', () => {
    expect(jeu.centimes('seuil_franchise_tva_cents')).toBe(2_500_000);
  });

  it('lit un taux en points de base', () => {
    expect(jeu.pointsDeBase('taux_commission_sumup_bp')).toBe(169);
  });

  it('lit une valeur decimale', () => {
    expect(jeu.decimal('temperature_max_froid_c')).toBe(7);
  });

  it('leve une erreur explicite sur un parametre absent plutot que de replier sur une valeur en dur', () => {
    // C'est le comportement voulu : un seuil manquant est un defaut de
    // configuration a corriger, pas un cas a masquer.
    expect(() => jeu.centimes('seuil_airbag_cents')).toThrow(ErreurParametreManquant);
  });

  it('leve une erreur si la valeur stockee n est pas du type attendu', () => {
    const abime = Parametres.depuisLignes([{ cle: 'seuil_airbag_cents', valeur: 'beaucoup' }]);
    expect(() => abime.entier('seuil_airbag_cents')).toThrow(ErreurParametreManquant);
  });

  it('signale les cles du catalogue absentes du jeu charge', () => {
    const manquantes = jeu.clesManquantes();
    expect(manquantes).toContain('seuil_airbag_cents');
    expect(manquantes).not.toContain('seuil_franchise_tva_cents');
  });

  it('conserve la derniere valeur vue pour une cle dupliquee', () => {
    // La requete SQL trie par date de debut croissante : la plus recente ecrase.
    const versionne = Parametres.depuisLignes([
      { cle: 'seuil_franchise_tva_cents', valeur: '2400000' },
      { cle: 'seuil_franchise_tva_cents', valeur: '2500000' },
    ]);
    expect(versionne.centimes('seuil_franchise_tva_cents')).toBe(2_500_000);
  });

  it('possede() ne leve jamais', () => {
    expect(jeu.possede('inconnue')).toBe(false);
    expect(jeu.possede('temperature_max_froid_c')).toBe(true);
  });
});

describe('Parametres.texteOuNull', () => {
  it('rend null sur une chaine vide, jamais la chaine elle-meme', () => {
    // Convention docs/29 : une valeur inconnue vaut `null`, jamais `''` — le
    // code appelant doit pouvoir le dire explicitement plutot que d'imprimer
    // un champ blanc en silence.
    const jeu = Parametres.depuisLignes([{ cle: 'exploitant_nom', valeur: '' }]);
    expect(jeu.texteOuNull('exploitant_nom')).toBeNull();
  });

  it('rend la valeur telle quelle des qu elle n est pas vide', () => {
    const jeu = Parametres.depuisLignes([
      { cle: 'exploitant_nom', valeur: 'Jean Dupont, crêpier' },
    ]);
    expect(jeu.texteOuNull('exploitant_nom')).toBe('Jean Dupont, crêpier');
  });

  it('leve une erreur explicite sur un parametre absent, comme texte()', () => {
    const vide = Parametres.depuisLignes([]);
    expect(() => vide.texteOuNull('exploitant_nom')).toThrow(ErreurParametreManquant);
  });
});

describe("CATALOGUE_PARAMETRES — identité de l'exploitant", () => {
  const cles = [
    'exploitant_nom',
    'exploitant_adresse',
    'exploitant_numero_entreprise',
    'exploitant_numero_enregistrement_afsca',
  ] as const;

  it('existe pour les quatre champs, tous vides par défaut — jamais une valeur devinée', () => {
    for (const cle of cles) {
      const definition = definitionParametre(cle);
      expect(definition?.typeValeur, cle).toBe('texte');
      expect(definition?.valeurDefaut, cle).toBe('');
      expect(definition?.source, cle).toMatch(/porteur/i);
    }
  });
});

describe('CATALOGUE_PARAMETRES — échéancier réglementaire (docs/29 §6 point 1)', () => {
  it('porte les jours de chaque échéance, IDENTIQUES aux anciens littéraux de comptabilite.ts', () => {
    expect(definitionParametre('echeance_listing_tva_jours')?.valeurDefaut).toBe('03-31');
    expect(definitionParametre('echeance_inasti_trimestrielle_jours')?.valeurDefaut).toBe(
      '04-10,07-10,10-12,12-21',
    );
    expect(definitionParametre('echeance_contribution_afsca_jours')?.valeurDefaut).toBe('03-02');
    expect(definitionParametre('echeance_renouvellement_ambulant_jours')?.valeurDefaut).toBe(
      '01-01',
    );
    expect(definitionParametre('echeance_e604b_jours')?.valeurDefaut).toBe('12-15');
  });

  it('porte le pas quinquennal, IDENTIQUE à l ancien PAS_ANNEES.quinquennale', () => {
    expect(definitionParametre('echeance_pas_quinquennal_annees')?.valeurDefaut).toBe('5');
  });

  it("porte en centimes entiers les deux montants AFSCA jusqu'ici en PROSE SEULE", () => {
    expect(
      definitionParametre('echeance_contribution_afsca_avec_autorisation_cents')?.valeurDefaut,
    ).toBe('10271'); // 102,71 €
    expect(
      definitionParametre('echeance_contribution_afsca_sans_autorisation_cents')?.valeurDefaut,
    ).toBe('5136'); // 51,36 €
  });

  it("porte en centimes entiers le plafond de tolérance e604B jusqu'ici en PROSE SEULE", () => {
    expect(definitionParametre('echeance_e604b_tolerance_cents')?.valeurDefaut).toBe('2750000'); // 27 500 €
  });

  it('ne laisse aucune de ces 19 clés sans source ni date de validité', () => {
    const clesEcheancier = CATALOGUE_PARAMETRES.filter((d) => d.cle.startsWith('echeance_'));
    expect(clesEcheancier.length).toBeGreaterThanOrEqual(19);
    for (const definition of clesEcheancier) {
      expect(definition.source.length, definition.cle).toBeGreaterThan(0);
      expect(definition.dateDebutValidite, definition.cle).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
