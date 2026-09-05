/**
 * Tests ciblés des trois colonnes ajoutées à `lieu_marche` pour la fiche 13
 * (distance, facturation électrique, puissance disponible) — `creerLieu` /
 * `modifierLieu` / `listerLieuxComplets` existaient déjà, sans AUCUNE
 * couverture de test avant ce lot (vérifié : ni `referentiel.test.ts`, ni
 * `integration.test.ts` n'exercent la création d'un lieu).
 *
 * Garantie vérifiée ici, la même que documentée sur la colonne elle-même
 * (`packages/db/src/schema.ts`) et sur D-055 : `NULL` veut dire « non
 * renseigné », jamais « zéro » — un lieu à 0 km RÉELLEMENT connu doit rester
 * distinguable d'un lieu dont la distance n'a simplement pas été saisie.
 */

import { ErreurMetier, maintenantUtc, nouvelIdentifiant, type SaisieRecette } from '@batte/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { fournisseur, ingredient } from '../schema.js';
import {
  creerConditionnement,
  creerLieu,
  creerRecette,
  listerConditionnements,
  listerLieuxComplets,
  listerRecettesReferentiel,
  modifierConditionnement,
  modifierLieu,
  modifierRecette,
} from './referentiel-ecriture.js';

/** Saisie de lieu valide, déjà normalisée comme le ferait le contrat Zod. */
function saisieLieu(surcharges: Record<string, unknown> = {}) {
  return {
    nom: 'Marché de test',
    adresse: null,
    latitude: null,
    longitude: null,
    jourSemaine: null,
    heureDebut: null,
    heureFin: null,
    tarifEmplacementCents: null,
    modeTarification: null,
    metresLineaires: null,
    distanceKm: null,
    facturationElectricite: null,
    puissanceDisponibleW: null,
    notes: null,
    ...surcharges,
  };
}

describe('dépôt référentiel-écriture — lieux : distance, électricité, puissance (fiche 13, D-055)', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('crée un lieu sans distance ni électricité renseignées : NULL, jamais 0', () => {
    const id = creerLieu(base, saisieLieu());
    const lieu = listerLieuxComplets(base).find((l) => l.id === id);

    expect(lieu?.distanceKm).toBeNull();
    expect(lieu?.facturationElectricite).toBeNull();
    expect(lieu?.puissanceDisponibleW).toBeNull();
  });

  it('enregistre une distance, un mode de facturation électrique et une puissance disponible', () => {
    const id = creerLieu(
      base,
      saisieLieu({
        distanceKm: 22,
        facturationElectricite: 'comprise',
        puissanceDisponibleW: 3500,
      }),
    );
    const lieu = listerLieuxComplets(base).find((l) => l.id === id);

    expect(lieu?.distanceKm).toBe(22);
    expect(lieu?.facturationElectricite).toBe('comprise');
    expect(lieu?.puissanceDisponibleW).toBe(3500);
  });

  it('un lieu à 0 km RÉELLEMENT connu reste distinct d’un lieu sans distance renseignée', () => {
    const idConnu = creerLieu(base, saisieLieu({ distanceKm: 0 }));
    const idInconnu = creerLieu(base, saisieLieu());
    const lieux = listerLieuxComplets(base);

    expect(lieux.find((l) => l.id === idConnu)?.distanceKm).toBe(0);
    expect(lieux.find((l) => l.id === idInconnu)?.distanceKm).toBeNull();
  });

  it('modifie une distance déjà renseignée', () => {
    const id = creerLieu(base, saisieLieu({ distanceKm: 22 }));
    modifierLieu(base, id, saisieLieu({ distanceKm: 35 }));

    const lieu = listerLieuxComplets(base).find((l) => l.id === id);
    expect(lieu?.distanceKm).toBe(35);
  });

  it.each(['compteur', 'forfait', 'comprise', 'aucune'] as const)(
    'accepte le mode de facturation électrique « %s »',
    (mode) => {
      const id = creerLieu(base, saisieLieu({ facturationElectricite: mode }));
      const lieu = listerLieuxComplets(base).find((l) => l.id === id);
      expect(lieu?.facturationElectricite).toBe(mode);
    },
  );
});

/**
 * Audit du 30/07/2026 : `recette_ligne.note_technique` était écrite et
 * conservée d'un enregistrement à l'autre (`notesTechniquesExistantes`,
 * `referentiel-ecriture.ts`), mais jamais exposée par aucun contrat de
 * lecture. `listerRecettesReferentiel` la rend désormais, non vide
 * seulement, sous `notesTechniques` — voir `schemaRecetteReferentiel`,
 * `contrats/referentiel.ts`.
 */
describe('dépôt référentiel-écriture — notes techniques de recette (audit 30/07/2026)', () => {
  let base: BaseBatte;
  let idFarine: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);

    idFarine = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(ingredient)
      .values({
        id: idFarine,
        nom: 'Farine test',
        categorie: 'farine',
        uniteReference: 'g',
        allergenes: ['gluten'],
        stockSecurite: 0,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  });

  function saisieRecette(lignes: SaisieRecette['lignes']): SaisieRecette {
    return {
      code: 'RT',
      nom: 'Recette test',
      typePate: 'froment',
      sansGluten: false,
      rendementReferenceMl: 1000,
      rendementReferenceCrepes: 10,
      perteCuissonBp: 0,
      tauxCasseBp: 0,
      perteFixeMl: 0,
      procede: null,
      notes: null,
      lignes,
    };
  }

  it('creerRecette écrit la note technique, exposée par `listerRecettesReferentiel`', () => {
    const id = creerRecette(
      base,
      saisieRecette([
        {
          ingredientId: idFarine,
          quantiteUniteRef: 100,
          noteTechnique: 'Beurre noisette : ne pas dépasser la coloration.',
        },
      ]),
    );

    const ligne = listerRecettesReferentiel(base).find((r) => r.id === id);
    expect(ligne?.notesTechniques).toEqual([
      {
        ingredientId: idFarine,
        nomIngredient: 'Farine test',
        noteTechnique: 'Beurre noisette : ne pas dépasser la coloration.',
      },
    ]);
  });

  it('une ligne SANS note technique est absente de `notesTechniques`, jamais une entrée `null`', () => {
    const id = creerRecette(
      base,
      saisieRecette([{ ingredientId: idFarine, quantiteUniteRef: 100, noteTechnique: null }]),
    );

    const ligne = listerRecettesReferentiel(base).find((r) => r.id === id);
    expect(ligne?.notesTechniques).toEqual([]);
  });

  it('modifierRecette SANS renvoyer la note CONSERVE celle déjà en base', () => {
    const id = creerRecette(
      base,
      saisieRecette([
        { ingredientId: idFarine, quantiteUniteRef: 100, noteTechnique: 'Laisser reposer 1 h.' },
      ]),
    );

    // Le formulaire renvoie `null` pour cette ligne, comme le fait aujourd'hui
    // tout écran qui ne sait pas encore lire la note (voir le rapport de
    // livraison) : elle doit SURVIVRE, pas être effacée en silence.
    modifierRecette(
      base,
      id,
      saisieRecette([{ ingredientId: idFarine, quantiteUniteRef: 150, noteTechnique: null }]),
    );

    const ligne = listerRecettesReferentiel(base).find((r) => r.id === id);
    expect(ligne?.notesTechniques).toEqual([
      {
        ingredientId: idFarine,
        nomIngredient: 'Farine test',
        noteTechnique: 'Laisser reposer 1 h.',
      },
    ]);
    expect(ligne?.nbLignes).toBe(1);
  });

  it('modifierRecette avec une note EXPLICITE la remplace', () => {
    const id = creerRecette(
      base,
      saisieRecette([
        { ingredientId: idFarine, quantiteUniteRef: 100, noteTechnique: 'Ancienne note.' },
      ]),
    );

    modifierRecette(
      base,
      id,
      saisieRecette([
        { ingredientId: idFarine, quantiteUniteRef: 100, noteTechnique: 'Nouvelle note.' },
      ]),
    );

    const ligne = listerRecettesReferentiel(base).find((r) => r.id === id);
    expect(ligne?.notesTechniques).toEqual([
      { ingredientId: idFarine, nomIngredient: 'Farine test', noteTechnique: 'Nouvelle note.' },
    ]);
  });
});

/**
 * `creerConditionnement` / `modifierConditionnement` n'avaient AUCUNE
 * couverture de test avant ce lot (vérifié : ni ce fichier, ni
 * `referentiel.test.ts`, ni `economies.test.ts` ne les appellent) — alors
 * même que leur garde-fou fournisseur système (audit du 31/07/2026,
 * `depots/fournisseur-systeme.ts`) est désormais partagée avec trois autres
 * points d'écriture. Sans ce test, un refactoring de cette garde ne serait
 * vérifié nulle part pour CE point d'écriture précis.
 */
describe('dépôt référentiel-écriture — conditionnements : le fournisseur système n’est jamais commandable', () => {
  let base: BaseBatte;
  let idIngredient: string;
  let idFournisseurSysteme: string;
  let idFournisseurCommercial: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const maintenant = maintenantUtc();
    idIngredient = nouvelIdentifiant();
    base
      .insert(ingredient)
      .values({
        id: idIngredient,
        nom: 'Farine de test',
        categorie: 'farine',
        uniteReference: 'g',
        allergenes: ['gluten'],
        stockSecurite: 0,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idFournisseurSysteme = base
      .select({ id: fournisseur.id })
      .from(fournisseur)
      .where(eq(fournisseur.type, 'systeme'))
      .get()!.id;

    idFournisseurCommercial = base
      .insert(fournisseur)
      .values({
        id: nouvelIdentifiant(),
        nom: 'Meunier de test',
        type: 'moulin',
        email: null,
        telephone: null,
        adresse: null,
        delaiLivraisonJours: 3,
        francoDePortCents: null,
        commandeMinimumCents: null,
        notes: null,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .returning({ id: fournisseur.id })
      .get()!.id;
  });

  function saisieConditionnement(fournisseurId: string) {
    return {
      ingredientId: idIngredient,
      fournisseurId,
      libelle: 'Sac 25 kg',
      quantiteUniteRef: 25_000,
      prixCents: 1_500,
      referenceFournisseur: null,
      datePrix: '2026-01-01',
    };
  }

  it('refuse `creerConditionnement` au nom du fournisseur système, avec un code dédié', () => {
    expect(() => creerConditionnement(base, saisieConditionnement(idFournisseurSysteme))).toThrow(
      ErreurMetier,
    );

    try {
      creerConditionnement(base, saisieConditionnement(idFournisseurSysteme));
      expect.unreachable('devrait avoir levé une ErreurMetier');
    } catch (erreur) {
      const metier = erreur as ErreurMetier;
      expect(metier.code).toBe('fournisseur_systeme');
      expect(metier.statut).toBe(422);
    }

    expect(listerConditionnements(base)).toHaveLength(0);
  });

  it('accepte `creerConditionnement` pour un fournisseur COMMERCIAL', () => {
    const id = creerConditionnement(base, saisieConditionnement(idFournisseurCommercial));

    const ligne = listerConditionnements(base).find((l) => l.id === id);
    expect(ligne).toBeDefined();
    expect(ligne?.fournisseurId).toBe(idFournisseurCommercial);
  });

  it('refuse `modifierConditionnement` qui rattache un conditionnement existant au fournisseur système', () => {
    const id = creerConditionnement(base, saisieConditionnement(idFournisseurCommercial));

    expect(() =>
      modifierConditionnement(base, id, saisieConditionnement(idFournisseurSysteme)),
    ).toThrow(ErreurMetier);

    // RIEN NE BOUGE : le conditionnement reste rattaché au fournisseur commercial.
    const ligne = listerConditionnements(base).find((l) => l.id === id);
    expect(ligne?.fournisseurId).toBe(idFournisseurCommercial);
  });
});

/**
 * Audit du 31/07/2026 (docs/30 §2.3) : `recette.sans_gluten` est une case
 * cochée à la main, jamais recoupée avec les allergènes réels des ingrédients
 * de la recette. On pouvait déclarer « sans gluten » une recette dont un
 * ingrédient porte explicitement le code `gluten`, sans qu'aucun code ne s'y
 * oppose — jusqu'à `verifierCoherenceSansGluten` (ce fichier).
 *
 * TROIS CAS, TROIS TRAITEMENTS (voir le commentaire de la garde elle-même) :
 * contradiction franche → refus (422) ; ignorance (jamais vérifié) → aucun
 * refus, l'application n'affirme rien qu'elle ne sait pas ; cohérent → aucun
 * refus, aucun bruit. Le troisième cas est celui qui prouve que la garde ne
 * bloque pas le cas légitime — sans lui, les deux premiers ne prouvent rien.
 */
describe('dépôt référentiel-écriture — cohérence « sans gluten » (audit 31/07/2026, docs/30 §2.3)', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  /** Insère un ingrédient directement, comme le fait déjà ce fichier de test. */
  function insererIngredient(surcharges: {
    nom: string;
    allergenes: string[];
    allergenesVerifies: boolean;
  }): string {
    const id = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(ingredient)
      .values({
        id,
        nom: surcharges.nom,
        categorie: 'farine',
        uniteReference: 'g',
        allergenes: surcharges.allergenes,
        allergenesVerifies: surcharges.allergenesVerifies,
        stockSecurite: 0,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    return id;
  }

  function saisieRecette(
    lignes: SaisieRecette['lignes'],
    surcharges: Partial<SaisieRecette> = {},
  ): SaisieRecette {
    return {
      code: 'RT-GLUTEN',
      nom: 'Recette test allergènes',
      typePate: 'sarrasin',
      sansGluten: true,
      rendementReferenceMl: 1000,
      rendementReferenceCrepes: 10,
      perteCuissonBp: 0,
      tauxCasseBp: 0,
      perteFixeMl: 0,
      procede: null,
      notes: null,
      lignes,
      ...surcharges,
    };
  }

  it('refuse (422) une recette « sans gluten » dont un ingrédient VÉRIFIÉ porte le code gluten', () => {
    const idFroment = insererIngredient({
      nom: 'Farine de froment T55',
      allergenes: ['gluten'],
      allergenesVerifies: true,
    });

    expect(() =>
      creerRecette(
        base,
        saisieRecette([{ ingredientId: idFroment, quantiteUniteRef: 145, noteTechnique: null }]),
      ),
    ).toThrow(ErreurMetier);

    try {
      creerRecette(
        base,
        saisieRecette([{ ingredientId: idFroment, quantiteUniteRef: 145, noteTechnique: null }]),
      );
      expect.unreachable('devrait avoir levé une ErreurMetier');
    } catch (erreur) {
      const metier = erreur as ErreurMetier;
      expect(metier.code).toBe('sans_gluten_contradictoire');
      expect(metier.statut).toBe(422);
      expect(metier.champs?.sansGluten).toBeDefined();
    }

    // RIEN N'A ÉTÉ ÉCRIT : la recette contradictoire n'existe pas en base.
    expect(listerRecettesReferentiel(base).some((r) => r.code === 'RT-GLUTEN')).toBe(false);
  });

  it('accepte (ignorance, pas une faute) une recette « sans gluten » dont un ingrédient n’a JAMAIS été vérifié', () => {
    // Cas le plus courant : jamais évalué du tout, liste vide (défaut de création).
    const idJamaisEvalue = insererIngredient({
      nom: 'Farine de sarrasin (non évaluée)',
      allergenes: [],
      allergenesVerifies: false,
    });

    const id = creerRecette(
      base,
      saisieRecette([{ ingredientId: idJamaisEvalue, quantiteUniteRef: 200, noteTechnique: null }]),
    );

    const ligne = listerRecettesReferentiel(base).find((r) => r.id === id);
    expect(ligne?.sansGluten).toBe(true);
  });

  it('accepte (ignorance) même quand l’ingrédient NON VÉRIFIÉ porte déjà le code gluten', () => {
    // Quelqu'un a tapé « gluten » sans cocher la case de vérification : c'est
    // encore une AFFIRMATION NON CONFIRMÉE, pas un fait établi. La traiter
    // comme une contradiction franche reviendrait à punir une saisie
    // partielle exactement comme une faute avérée — ce que la doctrine
    // interdit (CLAUDE.md §7 : l'inconnu vaut `null`, jamais une faute).
    const idNonVerifieAvecGluten = insererIngredient({
      nom: 'Ingrédient douteux, non vérifié',
      allergenes: ['gluten'],
      allergenesVerifies: false,
    });

    expect(() =>
      creerRecette(
        base,
        saisieRecette([
          { ingredientId: idNonVerifieAvecGluten, quantiteUniteRef: 50, noteTechnique: null },
        ]),
      ),
    ).not.toThrow();
  });

  it('accepte SANS bruit une recette « sans gluten » dont tous les ingrédients sont vérifiés et sans gluten (cas légitime)', () => {
    const idSarrasin = insererIngredient({
      nom: 'Farine de sarrasin',
      allergenes: [],
      allergenesVerifies: true,
    });
    const idChataigne = insererIngredient({
      nom: 'Farine de châtaigne',
      allergenes: [],
      allergenesVerifies: true,
    });

    const id = creerRecette(
      base,
      saisieRecette([
        { ingredientId: idSarrasin, quantiteUniteRef: 300, noteTechnique: null },
        { ingredientId: idChataigne, quantiteUniteRef: 100, noteTechnique: null },
      ]),
    );

    const ligne = listerRecettesReferentiel(base).find((r) => r.id === id);
    expect(ligne).toBeDefined();
    expect(ligne?.sansGluten).toBe(true);
    expect(ligne?.nbLignes).toBe(2);
  });

  it('refuse aussi via `modifierRecette` — le cas RÉEL de remplissage de R2 (docs/30 §2.3)', () => {
    // R2 telle que semée : brouillon vide, `sansGluten: true`. On simule ici
    // le geste réel de complétion décrit par ce fichier lui-même
    // (`modifierRecette`, "LE CAS QUI COMPTE : R2...") avec un ingrédient
    // choisi PAR ERREUR, dont le gluten est déjà vérifié.
    const idVide = creerRecette(base, saisieRecette([]));

    const idFromentVerifie = insererIngredient({
      nom: 'Farine de froment (erreur de choix)',
      allergenes: ['gluten'],
      allergenesVerifies: true,
    });

    expect(() =>
      modifierRecette(
        base,
        idVide,
        saisieRecette([
          { ingredientId: idFromentVerifie, quantiteUniteRef: 145, noteTechnique: null },
        ]),
      ),
    ).toThrow(ErreurMetier);

    // La recette reste vide : la modification contradictoire n'a pas été appliquée.
    const ligne = listerRecettesReferentiel(base).find((r) => r.id === idVide);
    expect(ligne?.nbLignes).toBe(0);
  });

  it('n’examine pas les recettes qui ne revendiquent rien (`sansGluten: false`)', () => {
    const idFroment = insererIngredient({
      nom: 'Farine de froment (recette normale)',
      allergenes: ['gluten'],
      allergenesVerifies: true,
    });

    expect(() =>
      creerRecette(
        base,
        saisieRecette([{ ingredientId: idFroment, quantiteUniteRef: 145, noteTechnique: null }], {
          sansGluten: false,
        }),
      ),
    ).not.toThrow();
  });
});
