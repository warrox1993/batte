/**
 * Tests du contrat de referentiel.
 *
 * L'enjeu n'est pas de verifier que Zod sait valider une chaine : c'est de
 * prouver que la REGLE nature <-> rattachement tient dans les deux sens, et
 * qu'elle designe le champ fautif. Un produit revendu enregistre par erreur en
 * « transforme » fausse la ventilation des compteurs de seuils legaux — et les
 * seuils belges portent sur le chiffre d'affaires, pas sur la marge
 * (CLAUDE.md §6). C'est donc une regle a portee reglementaire, pas un confort
 * de saisie.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  champsDepuisErreurZod,
  schemaChangementActivite,
  schemaSaisieFournisseur,
  schemaSaisieIngredient,
  schemaSaisieLieu,
  schemaSaisieProduit,
  schemaSaisieRecette,
  type SaisieProduitBrute,
} from './referentiel.js';

/** Saisie minimale d'un fournisseur valide, a deformer champ par champ. */
function fournisseurValide() {
  return {
    nom: 'Moulin de Statte',
    type: 'moulin' as const,
    email: 'contact@moulin-statte.be',
    telephone: null,
    adresse: null,
    delaiLivraisonJours: 3,
    francoDePortCents: null,
    commandeMinimumCents: null,
    notes: null,
  };
}

function produitTransformeValide(): SaisieProduitBrute {
  return {
    nom: 'Froment / cassonade',
    nature: 'transforme',
    recetteId: 'recette-r1',
    ingredientId: null,
    prixCents: 300,
    consommationUnite: 'crepes',
    nbCrepes: 1,
    volumeMlParUnite: null,
    categorie: 'sucrée',
    consommationSurPlace: false,
  };
}

/**
 * Pas de `consommationUnite` ici : un revendu ne consomme rien de la
 * production, la question ne se pose pas — la clé est OMETTABLE
 * (`.exactOptional()`, `schemaSaisieProduitBrute`), pas à renseigner par
 * `null`. C'est exactement ce qu'un test plus bas (« refuse un revendu qui
 * répondrait quand même à cette question ») vérifie dans l'autre sens.
 */
function produitRevenduValide(): SaisieProduitBrute {
  return {
    nom: 'Pot Sirop de Liège 450 g',
    nature: 'revendu',
    recetteId: null,
    ingredientId: 'ingredient-sirop',
    prixCents: 750,
    nbCrepes: null,
    volumeMlParUnite: null,
    categorie: 'terroir',
    consommationSurPlace: false,
  };
}

/** Chemins de champs signales par Zod, pour assertion directe. */
function champsFautifs(resultat: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) {
  return (resultat.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('contrat référentiel — fournisseur', () => {
  it('accepte une saisie complète', () => {
    const resultat = schemaSaisieFournisseur.safeParse(fournisseurValide());
    expect(resultat.success).toBe(true);
  });

  it('refuse un nom vide ou fait uniquement d’espaces', () => {
    for (const nom of ['', '   ']) {
      const resultat = schemaSaisieFournisseur.safeParse({ ...fournisseurValide(), nom });
      expect(resultat.success).toBe(false);
      expect(champsFautifs(resultat)).toContain('nom');
    }
  });

  it('accepte un fournisseur SANS e-mail : la ferme où l’on passe n’en a pas', () => {
    for (const email of [null, undefined, '', '   ']) {
      const resultat = schemaSaisieFournisseur.safeParse({ ...fournisseurValide(), email });
      expect(resultat.success).toBe(true);
      // Normalise a `null` : sans cela, `email IS NULL` cesserait de repondre a
      // « qui ne peut pas recevoir de bon de commande ? ».
      if (resultat.success) expect(resultat.data.email).toBeNull();
    }
  });

  it('refuse un e-mail MAL FORMÉ : le bon de commande partirait dans le vide', () => {
    const resultat = schemaSaisieFournisseur.safeParse({
      ...fournisseurValide(),
      email: 'contact-arobase-manquant',
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('email');
  });

  it('normalise les espaces autour des champs textuels facultatifs', () => {
    const resultat = schemaSaisieFournisseur.safeParse({
      ...fournisseurValide(),
      telephone: '  04 221 00 00  ',
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.telephone).toBe('04 221 00 00');
  });

  it('refuse un délai de livraison négatif ou non entier', () => {
    for (const delai of [-1, 2.5]) {
      const resultat = schemaSaisieFournisseur.safeParse({
        ...fournisseurValide(),
        delaiLivraisonJours: delai,
      });
      expect(resultat.success).toBe(false);
      expect(champsFautifs(resultat)).toContain('delaiLivraisonJours');
    }
  });

  it('refuse un délai aberrant : il gonflerait tous les points de commande', () => {
    const resultat = schemaSaisieFournisseur.safeParse({
      ...fournisseurValide(),
      delaiLivraisonJours: 3650,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('delaiLivraisonJours');
  });

  it('refuse un franco de port en flottant : l’argent est en centimes entiers', () => {
    const resultat = schemaSaisieFournisseur.safeParse({
      ...fournisseurValide(),
      francoDePortCents: 150.5,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('francoDePortCents');
  });
});

describe('contrat référentiel — cohérence nature / rattachement d’un produit', () => {
  it('accepte un transformé rattaché à une recette', () => {
    expect(schemaSaisieProduit.safeParse(produitTransformeValide()).success).toBe(true);
  });

  it('accepte un revendu rattaché à un article acheté', () => {
    expect(schemaSaisieProduit.safeParse(produitRevenduValide()).success).toBe(true);
  });

  it('refuse un transformé SANS recette, en désignant le champ recetteId', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      recetteId: null,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('recetteId');
  });

  it('refuse un transformé rattaché à un article revendu', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      ingredientId: 'ingredient-sirop',
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('ingredientId');
  });

  it('refuse un transformé sans nombre de crêpes : le taux d’écoulement serait incalculable', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      nbCrepes: null,
      volumeMlParUnite: null,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('nbCrepes');
  });

  it('refuse un revendu SANS article acheté, en désignant le champ ingredientId', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitRevenduValide(),
      ingredientId: null,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('ingredientId');
  });

  it('refuse un revendu rattaché à une recette : il est acheté tel quel', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitRevenduValide(),
      recetteId: 'recette-r1',
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('recetteId');
  });

  it('refuse un revendu qui consommerait des crêpes', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitRevenduValide(),
      nbCrepes: 1,
      volumeMlParUnite: null,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('nbCrepes');
  });

  it('signale SIMULTANÉMENT les deux fautes d’un revendu mal rattaché', () => {
    // Le cas reel : l'utilisateur bascule « transformé » -> « revendu » sans
    // vider le rattachement precedent. Les deux champs doivent s'allumer, sinon
    // il corrige, resoumet, et decouvre la seconde faute au coup d'apres.
    const resultat = schemaSaisieProduit.safeParse({
      ...produitRevenduValide(),
      recetteId: 'recette-r1',
      ingredientId: null,
    });
    expect(resultat.success).toBe(false);
    const champs = champsFautifs(resultat);
    expect(champs).toContain('recetteId');
    expect(champs).toContain('ingredientId');
  });

  it('refuse un revendu qui répondrait quand même à la question de consommationUnite', () => {
    // La clé est OMETTABLE (`.exactOptional()`) pour un revendu : ABSENTE ou
    // `null`, la question ne se pose pas, les deux sont acceptés. La
    // RENSEIGNER — lui donner une vraie réponse — est ce que ce test attrape,
    // même patron que « refuse un revendu qui consommerait des crêpes »
    // ci-dessus.
    const resultat = schemaSaisieProduit.safeParse({
      ...produitRevenduValide(),
      consommationUnite: 'crepes',
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('consommationUnite');
  });

  it('refuse un prix de vente négatif', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      prixCents: -1,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('prixCents');
  });

  it('refuse un prix de vente en euros flottants : l’argent est en centimes entiers', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      prixCents: 3.5,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('prixCents');
  });

  it('traite la chaîne vide d’un select non renseigné comme une absence', () => {
    // Un `<select>` non choisi renvoie `''`, pas `null` : sans normalisation, la
    // base stockerait une clé étrangère vide au lieu de NULL.
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      recetteId: '',
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('recetteId');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   consommationUnite — le champ qui remplace la devinette sur « zéro crêpe »
   (décision du porteur, 31/07/2026, fiche 15 §4/§5.1). Trois cas, et ils
   s'excluent : rendre les états impossibles inécrivables est TOUT l'intérêt
   de ce champ (voir `verifierConsommationUniteTransforme`, referentiel.ts).
   ═══════════════════════════════════════════════════════════════════════════ */

describe('contrat référentiel — consommationUnite (les trois cas, et leurs refus)', () => {
  it('accepte `crepes` : nbCrepes >= 1, volumeMlParUnite vide', () => {
    const resultat = schemaSaisieProduit.safeParse(produitTransformeValide());
    expect(resultat.success).toBe(true);
  });

  it('accepte `volume_pate` : volumeMlParUnite renseigné, nbCrepes à 0', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      consommationUnite: 'volume_pate',
      nbCrepes: 0,
      volumeMlParUnite: 500,
    });
    expect(resultat.success).toBe(true);
  });

  /**
   * LE CAFÉ (fiche 15 §4) : un `transforme` À LA DEMANDE, dont la composition
   * vit entièrement dans la nomenclature de vente — jamais dans une recette
   * de production. C'est le cas que le défaut d'origine bloquait à tort en
   * exigeant un `volumeMlParUnite` : ce test est la preuve, au niveau du
   * contrat pur, que la même forme passe désormais.
   */
  it('accepte `nomenclature` (le café) : ni nbCrepes ni volumeMlParUnite exigé, nbCrepes à 0', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      consommationUnite: 'nomenclature',
      nbCrepes: 0,
      volumeMlParUnite: null,
    });
    expect(resultat.success).toBe(true);
  });

  it('refuse un transformé qui ne précise pas ce qu’une unité vendue consomme', () => {
    const resultat = schemaSaisieProduit.safeParse({
      nom: 'Froment / cassonade',
      nature: 'transforme',
      recetteId: 'recette-r1',
      ingredientId: null,
      prixCents: 300,
      // `consommationUnite` absent : « pas encore choisi », exactement comme
      // `null` explicite (voir `verifierConsommationUniteTransforme`).
      nbCrepes: 1,
      volumeMlParUnite: null,
      categorie: 'sucrée',
      consommationSurPlace: false,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('consommationUnite');
  });

  /** OBLIGATOIRE (rapport de mission) : la pâte vendue au volume exige TOUJOURS son volume. */
  it('refuse `volume_pate` SANS volumeMlParUnite : la clôture au volume ne saurait pas combien retrancher', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      consommationUnite: 'volume_pate',
      nbCrepes: 0,
      volumeMlParUnite: null,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('volumeMlParUnite');
  });

  /**
   * OBLIGATOIRE (rapport de mission) : une combinaison absurde est refusée.
   * `volume_pate` à 5 crêpes — une unité ne peut pas être à la fois une
   * bouteille et une crêpe.
   */
  it('refuse `volume_pate` avec 5 crêpes : une unité ne peut pas être à la fois une bouteille et une crêpe', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      consommationUnite: 'volume_pate',
      nbCrepes: 5,
      volumeMlParUnite: 500,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('nbCrepes');
  });

  it('refuse `crepes` avec un volume renseigné : ce champ ne décrit qu’une bouteille', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      consommationUnite: 'crepes',
      nbCrepes: 1,
      volumeMlParUnite: 500,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('volumeMlParUnite');
  });

  it('refuse `nomenclature` avec des crêpes consommées : sa composition vient de la nomenclature de vente, pas d’un nombre de crêpes', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      consommationUnite: 'nomenclature',
      nbCrepes: 3,
      volumeMlParUnite: null,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('nbCrepes');
  });

  it('refuse `nomenclature` avec un volume renseigné : ce produit ne représente aucun volume de pâte', () => {
    const resultat = schemaSaisieProduit.safeParse({
      ...produitTransformeValide(),
      consommationUnite: 'nomenclature',
      nbCrepes: 0,
      volumeMlParUnite: 500,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('volumeMlParUnite');
  });

  it('refuse un menu qui répondrait quand même à la question de consommationUnite', () => {
    const resultat = schemaSaisieProduit.safeParse({
      nom: 'Menu crêpe + café',
      nature: 'menu',
      recetteId: null,
      ingredientId: null,
      prixCents: 500,
      consommationUnite: 'crepes',
      nbCrepes: null,
      volumeMlParUnite: null,
      categorie: 'menu',
      consommationSurPlace: false,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('consommationUnite');
  });
});

describe('contrat référentiel — changement d’activité', () => {
  it('accepte les deux sens : on désactive, et on peut revenir en arrière', () => {
    expect(schemaChangementActivite.safeParse({ actif: false }).success).toBe(true);
    expect(schemaChangementActivite.safeParse({ actif: true }).success).toBe(true);
  });

  it('refuse une valeur non booléenne', () => {
    expect(schemaChangementActivite.safeParse({ actif: 'non' }).success).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   verifierCoherenceIngredient — une pièce ne se convertit ni en masse ni en
   volume, donc n'a pas de densité (unites.ts::convertir refuse déjà ce cas :
   ce garde-fou évite qu'une valeur saisie pour rien fasse croire à une
   capacité de conversion qui n'existe pas).
   ═══════════════════════════════════════════════════════════════════════════ */

describe('contrat référentiel — cohérence ingrédient (unité vs densité)', () => {
  function ingredientValide() {
    return {
      nom: 'Farine de froment T55',
      categorie: 'farine' as const,
      uniteReference: 'g' as const,
      densiteGParMl: null,
      allergenes: ['gluten'],
      allergenesVerifies: true,
      stockSecurite: 5000,
      delaiLivraisonJours: 3,
      dureeConservationJours: 365,
      notes: null,
    };
  }

  it('accepte un ingrédient massique ou volumique avec une densité renseignée', () => {
    const resultat = schemaSaisieIngredient.safeParse({
      ...ingredientValide(),
      uniteReference: 'ml',
      densiteGParMl: 1.03,
    });
    expect(resultat.success).toBe(true);
  });

  it('accepte un ingrédient compté à la pièce SANS densité', () => {
    const resultat = schemaSaisieIngredient.safeParse({
      ...ingredientValide(),
      uniteReference: 'piece',
      densiteGParMl: null,
    });
    expect(resultat.success).toBe(true);
  });

  it('refuse une densité posée sur un ingrédient compté à la pièce, en désignant densiteGParMl', () => {
    const resultat = schemaSaisieIngredient.safeParse({
      ...ingredientValide(),
      uniteReference: 'piece',
      densiteGParMl: 1.03,
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('densiteGParMl');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   verifierCoherenceRecette — un ingrédient au plus une fois par recette.
   Sans ce contrôle, un doublon remonterait en contrainte SQLite brute (index
   unique recette_ligne(recette_id, ingredient_id)), donc en 500 « erreur
   inattendue » plutôt qu'en 422 désignant la ligne fautive.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('contrat référentiel — cohérence recette (un ingrédient au plus une fois)', () => {
  function recetteValide() {
    return {
      code: 'R1',
      nom: 'Froment classique',
      typePate: 'froment',
      sansGluten: false,
      rendementReferenceMl: 5000,
      rendementReferenceCrepes: 66,
      perteCuissonBp: 500,
      tauxCasseBp: 200,
      lignes: [
        { ingredientId: 'farine-t55', quantiteUniteRef: 1450 },
        { ingredientId: 'lait-entier', quantiteUniteRef: 2400 },
      ],
    };
  }

  it('accepte une recette dont chaque ingrédient apparaît une seule fois', () => {
    expect(schemaSaisieRecette.safeParse(recetteValide()).success).toBe(true);
  });

  it('accepte une recette sans aucune ligne : cette règle-ci ne porte que sur les doublons', () => {
    expect(schemaSaisieRecette.safeParse({ ...recetteValide(), lignes: [] }).success).toBe(true);
  });

  it('refuse un ingrédient qui apparaît deux fois, en désignant la SECONDE ligne', () => {
    const resultat = schemaSaisieRecette.safeParse({
      ...recetteValide(),
      lignes: [
        { ingredientId: 'farine-t55', quantiteUniteRef: 1450 },
        { ingredientId: 'farine-t55', quantiteUniteRef: 100 },
      ],
    });
    expect(resultat.success).toBe(false);
    const champs = champsFautifs(resultat);
    expect(champs).toContain('lignes.1.ingredientId');
    // La première apparition n'est jamais fautive : c'est l'ARRIVÉE en double qui l'est.
    expect(champs).not.toContain('lignes.0.ingredientId');
  });

  it('signale chaque doublon supplémentaire au-delà du second, sur trois occurrences', () => {
    const resultat = schemaSaisieRecette.safeParse({
      ...recetteValide(),
      lignes: [
        { ingredientId: 'farine-t55', quantiteUniteRef: 1450 },
        { ingredientId: 'farine-t55', quantiteUniteRef: 100 },
        { ingredientId: 'farine-t55', quantiteUniteRef: 50 },
      ],
    });
    expect(resultat.success).toBe(false);
    const champs = champsFautifs(resultat);
    expect(champs).toContain('lignes.1.ingredientId');
    expect(champs).toContain('lignes.2.ingredientId');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   verifierCoherenceLieu — trois règles indépendantes : coordonnées par paire,
   fenêtre horaire de durée strictement positive, tarif au mètre linéaire
   accompagné d'un métrage.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('contrat référentiel — cohérence lieu (coordonnées, horaires, tarif)', () => {
  function lieuValide() {
    return { nom: 'Marché de la Batte' };
  }

  it('accepte un lieu sans aucune coordonnée : un marché couvert n’a pas besoin de météo', () => {
    expect(schemaSaisieLieu.safeParse(lieuValide()).success).toBe(true);
  });

  it('accepte un lieu avec latitude ET longitude', () => {
    const resultat = schemaSaisieLieu.safeParse({
      ...lieuValide(),
      latitude: 50.6326,
      longitude: 5.5797,
    });
    expect(resultat.success).toBe(true);
  });

  it('refuse une latitude SANS longitude : la météo ne pourrait pas être relevée', () => {
    const resultat = schemaSaisieLieu.safeParse({ ...lieuValide(), latitude: 50.6326 });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('longitude');
  });

  it('refuse une longitude SANS latitude', () => {
    const resultat = schemaSaisieLieu.safeParse({ ...lieuValide(), longitude: 5.5797 });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('latitude');
  });

  /**
   * D-074 (31/07/2026, tâche bloquante distincte de la refonte
   * `consommationUnite` de ce fichier) : le service d'itinéraire
   * (`apps/api/src/itineraire/client.ts`) arrondit désormais au DIXIÈME de km,
   * et non plus au km entier — un `z.int()` sur `distanceKm` referait un 422
   * sur la première distance non ronde, APRÈS que le calcul a eu lieu et que
   * la valeur a été stockée (la route d'écriture relit sa propre écriture par
   * un `.parse()`). Ce test est la preuve qu'une distance décimale traverse
   * désormais la validation — ce n'est PAS un relâchement de la règle 4 du
   * §3 : cette règle porte sur les masses et les volumes, jamais les
   * distances.
   */
  it('accepte une distance décimale (mesurée au dixième de km, D-074)', () => {
    const resultat = schemaSaisieLieu.safeParse({ ...lieuValide(), distanceKm: 24.8 });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.distanceKm).toBe(24.8);
  });

  it('refuse toujours une distance négative, décimale ou non', () => {
    const resultat = schemaSaisieLieu.safeParse({ ...lieuValide(), distanceKm: -0.5 });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('distanceKm');
  });

  it('accepte une fenêtre horaire de durée strictement positive', () => {
    const resultat = schemaSaisieLieu.safeParse({
      ...lieuValide(),
      heureDebut: '08:00',
      heureFin: '14:30',
    });
    expect(resultat.success).toBe(true);
  });

  it('refuse une heure de fin ANTÉRIEURE à l’heure de début', () => {
    const resultat = schemaSaisieLieu.safeParse({
      ...lieuValide(),
      heureDebut: '14:30',
      heureFin: '08:00',
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('heureFin');
  });

  it('refuse une fenêtre de durée NULLE : heure de fin égale à l’heure de début', () => {
    const resultat = schemaSaisieLieu.safeParse({
      ...lieuValide(),
      heureDebut: '08:00',
      heureFin: '08:00',
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('heureFin');
  });

  it('accepte un tarif au mètre linéaire accompagné d’un métrage', () => {
    const resultat = schemaSaisieLieu.safeParse({
      ...lieuValide(),
      modeTarification: 'metre_lineaire_mois',
      metresLineaires: 6,
    });
    expect(resultat.success).toBe(true);
  });

  it('refuse un tarif au mètre linéaire SANS métrage : le tarif ne serait pas calculable', () => {
    const resultat = schemaSaisieLieu.safeParse({
      ...lieuValide(),
      modeTarification: 'metre_lineaire_mois',
    });
    expect(resultat.success).toBe(false);
    expect(champsFautifs(resultat)).toContain('metresLineaires');
  });

  it('accepte un tarif au forfait SANS métrage : la règle ne s’applique qu’au mètre linéaire', () => {
    const resultat = schemaSaisieLieu.safeParse({
      ...lieuValide(),
      modeTarification: 'forfait',
    });
    expect(resultat.success).toBe(true);
  });

  it('signale simultanément trois fautes indépendantes', () => {
    const resultat = schemaSaisieLieu.safeParse({
      ...lieuValide(),
      latitude: 50.6326,
      heureDebut: '14:30',
      heureFin: '08:00',
      modeTarification: 'metre_lineaire_mois',
    });
    expect(resultat.success).toBe(false);
    const champs = champsFautifs(resultat);
    expect(champs).toContain('longitude');
    expect(champs).toContain('heureFin');
    expect(champs).toContain('metresLineaires');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   champsDepuisErreurZod — traduction ZodError -> { champ: message }, partagée
   par le gestionnaire d'erreurs Fastify (D-035) et les formulaires du navigateur.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('champsDepuisErreurZod', () => {
  it('associe un chemin de champ simple à son message', () => {
    const resultat = schemaSaisieFournisseur.safeParse({
      nom: '',
      type: 'moulin' as const,
      email: null,
      telephone: null,
      adresse: null,
      delaiLivraisonJours: 3,
      francoDePortCents: null,
      commandeMinimumCents: null,
      notes: null,
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(champsDepuisErreurZod(resultat.error)).toEqual({
      nom: 'Le nom du fournisseur est obligatoire.',
    });
  });

  it('aplatit un chemin imbriqué (ligne de recette) en notation pointée', () => {
    const resultat = schemaSaisieRecette.safeParse({
      code: 'R1',
      nom: 'Froment',
      typePate: 'froment',
      sansGluten: false,
      rendementReferenceMl: 5000,
      rendementReferenceCrepes: 66,
      perteCuissonBp: 0,
      tauxCasseBp: 0,
      lignes: [
        { ingredientId: 'farine-t55', quantiteUniteRef: 100 },
        { ingredientId: 'farine-t55', quantiteUniteRef: 50 },
      ],
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(Object.keys(champsDepuisErreurZod(resultat.error))).toContain('lignes.1.ingredientId');
  });

  it('range une issue SANS chemin sous `_global`, pour ne pas la perdre', () => {
    const schemaTest = z.object({ a: z.string() }).superRefine((valeur, ctx) => {
      if (valeur.a === 'incoherent') {
        ctx.addIssue({ code: 'custom', path: [], message: 'Incohérence globale.' });
      }
    });
    const resultat = schemaTest.safeParse({ a: 'incoherent' });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(champsDepuisErreurZod(resultat.error)).toEqual({ _global: 'Incohérence globale.' });
  });

  it('conserve le DERNIER message quand deux issues visent le même champ', () => {
    const schemaTest = z.object({ a: z.string() }).superRefine((_valeur, ctx) => {
      ctx.addIssue({ code: 'custom', path: ['a'], message: 'Premier message.' });
      ctx.addIssue({ code: 'custom', path: ['a'], message: 'Second message.' });
    });
    const resultat = schemaTest.safeParse({ a: 'x' });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(champsDepuisErreurZod(resultat.error)).toEqual({ a: 'Second message.' });
  });

  it('rend un objet vide sur une erreur sans aucune issue', () => {
    expect(champsDepuisErreurZod(new z.ZodError([]))).toEqual({});
  });
});
