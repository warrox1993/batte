import { describe, expect, it } from 'vitest';
import {
  formaterEcartMontant,
  formaterEuros,
  type CorrectionLotAppliquee,
  type FactureResume,
  type LigneFactureDetailContrat,
} from '@batte/core';
import {
  cleAFocaliserApresRetraitLigneFacture,
  cleLigneFactureAFocaliserApresCorrection,
  extraireFichierScanPath,
  libelleCibleAnnulationFacture,
  phraseCorrectionCoutLot,
  resoudreEcartLigneFacture,
} from './Factures';

/**
 * Audit du 30/07/2026 (« inconnu affiché comme zéro », couche affichage) :
 * la cellule « Écart » de la fiche facture faisait
 * `formaterMontant(l.ecartResiduelCents ?? 0)` — un repli qui ne peut jamais
 * se déclencher AUJOURD'HUI (le serveur ne renvoie `ecartResiduelCents` à
 * `null` que quand `lotResolu` est faux, et ce cas est déjà écarté par la
 * branche `!l.lotResolu` juste avant), mais que le TYPE
 * (`LigneFactureDetailContrat`, `number | null`) autorise. Si cette
 * invariance venait à se rompre un jour côté serveur, l'écran aurait affiché
 * « 0,00 € » en rouge ou en vert — un écart CONNU et NUL — là où la bonne
 * réponse est « on ne sait pas ».
 *
 * `resoudreEcartLigneFacture` est extraite du `rendu` de colonne pour être
 * testée sans navigateur (même convention que `Comptabilite.test.tsx`).
 */

function ligne(partiel: Partial<LigneFactureDetailContrat>): LigneFactureDetailContrat {
  return {
    id: 'ligne-1',
    libelle: 'Farine T55',
    montantCents: 5000,
    receptionId: 'reception-1',
    numeroReception: 'BL-001',
    ingredientId: 'ingredient-1',
    nomIngredient: 'Farine T55',
    quantiteUniteRef: 25000,
    ecartPrixCents: 0,
    lotResolu: true,
    ecartResiduelCents: 0,
    receptionAnnulee: false,
    ...partiel,
  };
}

describe('resoudreEcartLigneFacture', () => {
  it('rend « absent » quand le lot n’a pas pu être résolu', () => {
    expect(
      resoudreEcartLigneFacture(ligne({ lotResolu: false, ecartResiduelCents: null })),
    ).toEqual({ type: 'absent' });
  });

  it('rend « conforme » sans écart initial quand la ligne n’a jamais posé de problème', () => {
    expect(resoudreEcartLigneFacture(ligne({ ecartResiduelCents: 0, ecartPrixCents: 0 }))).toEqual({
      type: 'conforme',
      ecartInitialCents: 0,
    });
  });

  it(
    'rend « conforme » avec l’écart initial connu quand la ligne a été CORRIGÉE (docs/21 §1.6/§5) : ' +
      'ecartResiduelCents retombe à 0 après `corrigerCoutLot`, mais ecartPrixCents (constaté à la ' +
      'saisie, jamais recalculé) garde la trace de l’écart réparé',
    () => {
      expect(
        resoudreEcartLigneFacture(ligne({ ecartResiduelCents: 0, ecartPrixCents: 320 })),
      ).toEqual({ type: 'conforme', ecartInitialCents: 320 });
    },
  );

  it('rend l’écart signé, positif, quand il est connu et positif', () => {
    expect(resoudreEcartLigneFacture(ligne({ ecartResiduelCents: 150 }))).toEqual({
      type: 'ecart',
      positif: true,
      texte: '+1,50',
    });
  });

  it('rend l’écart signé, négatif, quand il est connu et négatif', () => {
    expect(resoudreEcartLigneFacture(ligne({ ecartResiduelCents: -150 }))).toEqual({
      type: 'ecart',
      positif: false,
      texte: '-1,50',
    });
  });

  it('ne masque JAMAIS un écart résiduel inconnu en 0,00 € : « absent » même si lotResolu est vrai', () => {
    // Cas que le type autorise (`ecartResiduelCents: number | null`) mais que
    // le serveur ne produit pas aujourd'hui : la garde doit rester basée sur
    // la valeur elle-même, jamais sur un `?? 0` qui la ferait disparaître.
    expect(resoudreEcartLigneFacture(ligne({ lotResolu: true, ecartResiduelCents: null }))).toEqual(
      { type: 'absent' },
    );
  });
});

/**
 * docs/21-CHAMPS-NON-LUS.md §1.6 : `corrigerCoutLot` appelait
 * `/factures/lignes/:id/corriger-lot` sans jamais typer ni afficher sa
 * réponse — un changement de coût de matière restait silencieux, malgré un
 * contrat explicitement écrit pour dire « le AVANT et le APRÈS ».
 */
describe('phraseCorrectionCoutLot', () => {
  function resultat(partiel: Partial<CorrectionLotAppliquee>): CorrectionLotAppliquee {
    return {
      factureLigneId: 'ligne-1',
      lotId: 'lot-1',
      prixAvantCents: 1200,
      prixApresCents: 1450,
      ...partiel,
    };
  }

  // Attendus construits via les MÊMES fonctions de formatage que la fonction
  // testée (`formaterEuros`/`formaterEcartMontant`, `@batte/core`) : ces
  // fonctions rendent une espace insécable fine (U+202F) devant « € », pas
  // une espace normale — un littéral figé dans le test se serait décalé d'un
  // caractère invisible sans que la relecture ne le voie.
  it('dit le prix AVANT, le prix APRÈS et l’écart signé, quand le coût augmente', () => {
    expect(phraseCorrectionCoutLot(resultat({ prixAvantCents: 1200, prixApresCents: 1450 }))).toBe(
      `Coût du lot corrigé : ${formaterEuros(1200)} → ${formaterEuros(1450)} (${formaterEcartMontant(250)} €).`,
    );
  });

  it('garde le signe négatif (moins typographique, docs/07 §4.5) quand la correction fait baisser le coût', () => {
    expect(phraseCorrectionCoutLot(resultat({ prixAvantCents: 1450, prixApresCents: 1200 }))).toBe(
      `Coût du lot corrigé : ${formaterEuros(1450)} → ${formaterEuros(1200)} (${formaterEcartMontant(-250)} €).`,
    );
  });
});

/**
 * Mission « trois chemins de pièce jointe jamais utilisés » (30/07/2026).
 *
 * `schemaFactureDetail` (`@batte/core`) ne porte pas encore `fichierScanPath`
 * (contrat HTTP partagé, hors périmètre d'écriture de cette mission) :
 * `extraireFichierScanPath` lit donc la réponse BRUTE plutôt que l'objet
 * validé. Testée sans navigateur, même convention que
 * `resoudreEcartLigneFacture` ci-dessus.
 */
describe('extraireFichierScanPath', () => {
  it('lit la chaîne quand la réponse la porte', () => {
    expect(extraireFichierScanPath({ fichierScanPath: 'data:image/png;base64,AAA=' })).toBe(
      'data:image/png;base64,AAA=',
    );
  });

  it('rend `null` quand le champ vaut `null`', () => {
    expect(extraireFichierScanPath({ fichierScanPath: null })).toBeNull();
  });

  it('rend `null` quand le champ est absent', () => {
    expect(extraireFichierScanPath({ id: 'facture-1' })).toBeNull();
  });

  it('rend `null` sur une réponse qui n’est pas un objet, sans lever', () => {
    expect(extraireFichierScanPath(null)).toBeNull();
    expect(extraireFichierScanPath(undefined)).toBeNull();
    expect(extraireFichierScanPath('texte')).toBeNull();
    expect(extraireFichierScanPath(42)).toBeNull();
  });

  it('rend `null` quand le champ existe mais n’est pas une chaîne', () => {
    expect(extraireFichierScanPath({ fichierScanPath: 123 })).toBeNull();
  });
});

/**
 * Recette clavier du 30/07/2026 : « Retirer » une ligne de facture faisait
 * retomber le focus sur `<body>` — reproduit deux fois. Même raisonnement que
 * `cleAFocaliserApresRetrait` (`saisie-stock/SaisieReception.tsx`) : on retire
 * une ligne parce qu'on s'est trompé, et on veut continuer à saisir au même
 * endroit à l'écran, jamais en redescendant chercher une autre rangée.
 *
 * Ce fichier ne monte pas l'écran : ce test fige la DÉCISION (quelle clé de
 * ligne devient la cible), pas le geste lui-même. Il ne prouve PAS que
 * `Factures.tsx` retrouve effectivement le champ `libelle-<clé>` dans le DOM
 * réel et lui donne le focus — cette dernière étape relève de
 * `Factures.montage.test.tsx`, à côté de ce fichier.
 */
describe('cleAFocaliserApresRetraitLigneFacture — continuer à saisir au même endroit', () => {
  function ligne(cle: string) {
    return { cle };
  }

  it('cible la ligne qui prend la place VISUELLE de celle qu’on retire (la suivante)', () => {
    const avant = [ligne('a'), ligne('b'), ligne('c')];
    const apres = [ligne('a'), ligne('c')];
    expect(cleAFocaliserApresRetraitLigneFacture(avant, 'b', apres)).toBe('c');
  });

  it('retombe sur la ligne précédente quand on retire la DERNIÈRE ligne', () => {
    const avant = [ligne('a'), ligne('b'), ligne('c')];
    const apres = [ligne('a'), ligne('b')];
    expect(cleAFocaliserApresRetraitLigneFacture(avant, 'c', apres)).toBe('b');
  });

  it('cible la ligne vierge de remplacement quand la SEULE ligne est retirée', () => {
    // `retirerLigne` insère alors une ligne vide plutôt que de vider le
    // tableau (aucune saisie sans au moins une rangée) : `apres` porte cette
    // ligne de remplacement, seule candidate possible.
    const avant = [ligne('unique')];
    const apres = [ligne('remplacement')];
    expect(cleAFocaliserApresRetraitLigneFacture(avant, 'unique', apres)).toBe('remplacement');
  });

  it('rend `null` seulement si la liste après retrait est vide (garde de robustesse)', () => {
    expect(cleAFocaliserApresRetraitLigneFacture([ligne('a')], 'a', [])).toBeNull();
  });
});

/**
 * Recette clavier du 31/07/2026 (D-079, `docs/22-FOCUS-DETRUIT.md` §2.2) :
 * « Corriger le coût du lot » faisait retomber le focus sur `<body>`, en
 * démontant tout le panneau de détail de la facture — une facture peut
 * porter plusieurs lignes en écart, corrigées à la suite.
 *
 * Même raisonnement que `cleEcheanceAFocaliserApresPointage`
 * (`Comptabilite.tsx`) : la ligne corrigée cesse d'être « actionnable »
 * (son bouton disparaît, `resoudreEcartLigneFacture` ne rend plus
 * `'ecart'`), donc la continuation naturelle est la PROCHAINE ligne encore
 * en écart.
 *
 * Ce fichier ne monte pas l'écran : ce test fige la DÉCISION (quelle ligne
 * devient la cible), pas le geste lui-même. Il ne prouve PAS que
 * `Factures.tsx` retrouve effectivement le bouton
 * `[data-ligne-facture="<id>"] button` dans le DOM réel et lui donne le focus
 * — cette dernière étape relève de `Factures.montage.test.tsx`.
 */
describe('cleLigneFactureAFocaliserApresCorrection — continuer la correction sans repasser par <body>', () => {
  function ligneEcart(id: string, ecartResiduelCents: number | null) {
    return ligne({ id, ecartResiduelCents });
  }

  it('cible la PROCHAINE ligne encore en écart après celle qu’on vient de corriger', () => {
    const avant = [ligneEcart('l1', 150), ligneEcart('l2', -80), ligneEcart('l3', 0)];
    expect(cleLigneFactureAFocaliserApresCorrection(avant, 'l1')).toBe('l2');
  });

  it('reste sur la position du MILIEU de la liste restante, pas systématiquement sur la première', () => {
    // Quatre lignes en écart ; on corrige la DEUXIÈME (index 1 parmi les
    // actionnables) : la cible doit rester à l'index 1 parmi les trois
    // restantes ('l3'), jamais retomber sur la première par défaut.
    const avant = [
      ligneEcart('l1', 150),
      ligneEcart('l2', -80),
      ligneEcart('l3', 60),
      ligneEcart('l4', -40),
    ];
    expect(cleLigneFactureAFocaliserApresCorrection(avant, 'l2')).toBe('l3');
  });

  it('saute les lignes déjà conformes ou sans lot résolu : elles n’ont plus de bouton à focaliser', () => {
    const avant = [
      ligneEcart('l1', 150),
      ligneEcart('l2', 0), // conforme
      ligneEcart('l3', -80),
    ];
    expect(cleLigneFactureAFocaliserApresCorrection(avant, 'l1')).toBe('l3');
  });

  it('revient sur la précédente encore en écart quand la corrigée était la DERNIÈRE actionnable', () => {
    const avant = [ligneEcart('l1', 150), ligneEcart('l2', -80), ligneEcart('l3', 0)];
    expect(cleLigneFactureAFocaliserApresCorrection(avant, 'l2')).toBe('l1');
  });

  it('rend `null` quand plus aucune ligne n’est en écart après la correction', () => {
    // Cas terminal : facture entièrement rapprochée. Aucune cible de
    // continuation n'existe — l'appelant ne force alors rien (voir
    // `Factures.tsx`), plutôt que d'inventer un repli sans rapport avec le
    // geste (même choix que sur l'échéancier de `Comptabilite.tsx`).
    const avant = [ligneEcart('l1', 150)];
    expect(cleLigneFactureAFocaliserApresCorrection(avant, 'l1')).toBeNull();
  });

  it('rend `null` sur une liste déjà vide (garde de robustesse)', () => {
    expect(cleLigneFactureAFocaliserApresCorrection([], 'l1')).toBeNull();
  });
});

/**
 * `factureAnnuleeId` (`schemaFactureResume`, docs/21-CHAMPS-NON-LUS.md §5) :
 * le badge « Annulation » disait QU'une facture est annulée, jamais LAQUELLE
 * facture antérieure elle solde. `libelleCibleAnnulationFacture` referme ce
 * trou par un JOIN d'affichage sur la liste déjà chargée — jamais un second
 * calcul.
 */
describe('libelleCibleAnnulationFacture', () => {
  function facture(overrides: Partial<FactureResume> = {}): FactureResume {
    return {
      id: 'f1',
      numeroFournisseur: 'BL-2026-042',
      fournisseurId: 'four1',
      fournisseurNom: 'Moulin Delcourt',
      dateFacture: '2026-03-12',
      dateEcheance: null,
      montantTotalCents: 25000,
      statut: 'a_rapprocher',
      nbLignes: 2,
      ecartTotalCents: 0,
      estAnnulation: false,
      factureAnnuleeId: null,
      estAnnulee: false,
      creeLe: '2026-03-12T10:00:00.000Z',
      ...overrides,
    };
  }

  it('rend `null` quand la ligne n’est pas une annulation (`factureAnnuleeId` absent)', () => {
    expect(libelleCibleAnnulationFacture(null, [facture()])).toBeNull();
  });

  it('nomme le numéro, la date et le fournisseur de la facture annulée', () => {
    const originale = facture({
      id: 'f1',
      numeroFournisseur: 'BL-2026-042',
      dateFacture: '2026-03-12',
      fournisseurNom: 'Moulin Delcourt',
    });
    const toutes = [originale, facture({ id: 'f2', factureAnnuleeId: 'f1', estAnnulation: true })];
    const resultat = libelleCibleAnnulationFacture('f1', toutes);
    expect(resultat).not.toBeNull();
    expect(resultat).toContain('BL-2026-042');
    expect(resultat).toContain('12/03/2026');
    expect(resultat).toContain('Moulin Delcourt');
  });

  it('rend `null` si la cible référencée n’existe plus dans la liste chargée (garde de robustesse)', () => {
    const toutes = [facture({ id: 'f2', factureAnnuleeId: 'f-inconnue', estAnnulation: true })];
    expect(libelleCibleAnnulationFacture('f-inconnue', toutes)).toBeNull();
  });
});
