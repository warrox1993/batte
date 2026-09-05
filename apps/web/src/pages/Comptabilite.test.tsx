import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  DepenseLigneContrat,
  EcheanceLigneContrat,
  ImpactVerrouillagePeriodeContrat,
} from '@batte/core';
import { ErreurApi } from '../lib/api';
import { Tableau } from '../composants/Tableau';
import { aujourdHui } from '../lib/dates';
import {
  BandeauErreur,
  ChampMontantEstimeEcheance,
  cheminEconomiesDuMois,
  cleEcheanceAFocaliserApresPointage,
  colonnesEcheances,
  confirmationVerrouillageActivable,
  etatEcheancesApresEchecPointage,
  ImpactVerrouillagePeriode,
  libelleCibleAnnulationDepense,
  messageErreurApi,
  texteConfirmationVerrouillagePeriode,
} from './Comptabilite';

/**
 * Fiche 20 (docs/17) : pointer une échéance réglementaire pouvait échouer
 * SANS RIEN DIRE — le `catch` rechargeait la liste en silence, l'écran se
 * réaffichait à l'identique et l'utilisateur croyait avoir pointé une
 * échéance qu'il n'avait pas pointée.
 *
 * Ce fichier ne monte pas l'écran (le montage vit dans
 * `Comptabilite.montage.test.tsx`, à côté) : on prouve donc la régression par
 * deux moyens sans montage, comme le reste de cet écran
 * (`JournalAudit.test.tsx`, `Stock.test.tsx`) —
 *
 *  - `etatEcheancesApresEchecPointage` est une fonction PURE, extraite du
 *    corps entier du `catch` : un test peut donc figer que ce `catch` ne fait
 *    RIEN d'autre que produire l'état d'erreur. Une fonction pure ne peut pas
 *    déclencher un rechargement réseau — le défaut mesuré est rendu
 *    structurellement impossible, pas seulement corrigé par relecture.
 *  - `BandeauErreur`, rendu par `renderToStaticMarkup`, prouve que cet état
 *    produit bien un message VISIBLE et annoncé (`role="alert"`), et non un
 *    écran qui se contente de se recharger.
 *
 * Les deux bouts de la chaîne (catch -> état -> balisage) sont donc couverts
 * sans navigateur.
 */

describe('messageErreurApi', () => {
  it('reprend le message d’une ErreurApi telle quelle', () => {
    const erreur = new ErreurApi('Le serveur ne répond pas.', { code: 'timeout', statut: 504 });
    expect(messageErreurApi(erreur)).toBe('Le serveur ne répond pas.');
  });

  it('retombe sur un message générique pour toute erreur qui n’est PAS une ErreurApi', () => {
    // Panne réseau brute (TypeError de `fetch`), exception inattendue,
    // valeur non-Error : aucune de ces trois ne doit jamais remonter telle
    // quelle à l'écran (message technique, en anglais, illisible).
    expect(messageErreurApi(new TypeError('fetch failed'))).toBe(
      'Erreur inattendue, sans plus de détail.',
    );
    expect(messageErreurApi('chaîne brute')).toBe('Erreur inattendue, sans plus de détail.');
    expect(messageErreurApi(undefined)).toBe('Erreur inattendue, sans plus de détail.');
  });
});

/**
 * `colonnesEcheances` — la coupure d'affichage du compte à rebours « J-n »
 * de la colonne « Prochaine date » vient désormais du paramètre
 * `comptabilite_horizon_affichage_echeances_jours` (mission du 01/08/2026,
 * complément), et non plus d'un littéral `60` nu (docs/29-VALEURS-EN-DUR.md
 * §6 point 1).
 *
 * Vérifié en LIVE, sur une instance isolée (API 5011, base neuve, jamais la
 * base réelle) : une échéance à 72 jours ne montre AUCUN compteur au réglage
 * par défaut (60), puis montre « J-72 » dès que le paramètre est relevé à
 * 100 via `PATCH /api/parametres/:id` (le vrai chemin d'écriture de l'écran
 * Paramètres) — la preuve que la valeur est réellement LUE, pas seulement
 * nommée. Les tests ci-dessous rejouent la même propriété sans navigateur,
 * par `renderToStaticMarkup` (un seul rendu, dans l'état initial) : ils
 * prouvent la DÉCISION de rendu, pas l'appel réseau qui alimente
 * `horizonAffichageEcheancesJours` — celui-ci reste vérifié par la capture
 * d'écran, pas par ces tests.
 */
describe('colonnesEcheances — l’horizon d’affichage du compteur J-n vient du paramètre', () => {
  function echeanceDansNJours(n: number): EcheanceLigneContrat & {
    onMarquerFaite: () => void;
    onEstimerMontant: (montantEstimeCents: number | null) => void;
  } {
    const d = new Date(`${aujourdHui()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return {
      id: 'echeance-test',
      libelle: 'Échéance de test',
      recurrence: 'annuelle',
      prochaineDate: d.toISOString().slice(0, 10),
      sourceLegale: 'Test',
      urlSource: null,
      montantEstimeCents: null,
      statut: 'a_venir',
      dateRealisation: null,
      joursAvantEcheance: n,
      alerteProche: false,
      onMarquerFaite: () => {},
      onEstimerMontant: () => {},
    };
  }

  function rendreCelluleDate(horizon: number | null, joursAvant: number): string {
    return renderToStaticMarkup(
      <Tableau
        colonnes={colonnesEcheances(horizon)}
        lignes={[echeanceDansNJours(joursAvant)]}
        cleLigne={(l) => l.id}
        etatVide={<span>vide</span>}
      />,
    );
  }

  it('sans paramètre chargé (`null`) : la date s’affiche SEULE, jamais un horizon inventé', () => {
    // Même échéance qu’une fois le paramètre chargé (10 jours, largement sous
    // n’importe quel horizon plausible) : seul l’état `null` change.
    const balisage = rendreCelluleDate(null, 10);
    expect(balisage).not.toContain('J-10');
  });

  it('à 60 (le défaut du catalogue) : une échéance à 72 jours ne montre AUCUN compteur', () => {
    const balisage = rendreCelluleDate(60, 72);
    expect(balisage).not.toMatch(/J-\d/);
  });

  it('à 100 : la MÊME échéance à 72 jours montre désormais « J-72 » — la valeur est bien LUE', () => {
    const balisage = rendreCelluleDate(100, 72);
    expect(balisage).toContain('J-72');
  });
});

describe('etatEcheancesApresEchecPointage — le catch de « Marquer faite »', () => {
  it('produit l’état ERREUR avec le message serveur, jamais un état « pret » silencieux', () => {
    const erreur = new ErreurApi('Cette échéance est déjà marquée faite.', {
      code: 'echeance_deja_faite',
      statut: 422,
    });

    expect(etatEcheancesApresEchecPointage(erreur)).toEqual({
      statut: 'erreur',
      message: 'Cette échéance est déjà marquée faite.',
    });
  });

  it('produit un état ERREUR même sur une panne réseau anonyme, jamais un état inactif', () => {
    expect(etatEcheancesApresEchecPointage(new TypeError('fetch failed'))).toEqual({
      statut: 'erreur',
      message: 'Erreur inattendue, sans plus de détail.',
    });
  });

  it('est une fonction PURE : deux appels avec la même erreur rendent EXACTEMENT le même état', () => {
    // Une fonction qui rechargerait la liste en tâche de fond aurait un effet
    // de bord observable (un second appel réseau) ; une fonction pure ne
    // peut structurellement pas le faire.
    const erreur = new ErreurApi('X', { code: 'x', statut: 500 });
    expect(etatEcheancesApresEchecPointage(erreur)).toEqual(
      etatEcheancesApresEchecPointage(erreur),
    );
  });
});

describe('BandeauErreur — l’échec devient VISIBLE, pas seulement un état interne', () => {
  it('rend le message dans un `role="alert"`, annoncé sans action de l’utilisateur', () => {
    const balisage = renderToStaticMarkup(
      <BandeauErreur message="Cette échéance est déjà marquée faite." />,
    );
    expect(balisage).toContain('role="alert"');
    expect(balisage).toContain('Cette échéance est déjà marquée faite.');
  });

  it('rend le message produit par etatEcheancesApresEchecPointage bout à bout', () => {
    // La chaîne complète : une erreur serveur -> l'état -> le balisage.
    const erreur = new ErreurApi('Le listing TVA du 31 mars est déjà clos.', {
      code: 'periode_verrouillee',
      statut: 422,
    });
    const etat = etatEcheancesApresEchecPointage(erreur);
    if (etat.statut !== 'erreur') throw new Error('Attendu un état « erreur ».');
    const balisage = renderToStaticMarkup(<BandeauErreur message={etat.message} />);

    expect(balisage).toContain('role="alert"');
    expect(balisage).toContain('Le listing TVA du 31 mars est déjà clos.');
  });
});

/**
 * Audit du 30/07/2026 : `echeance.montantEstimeCents` était affichée mais
 * jamais saisissable. `ChampMontantEstimeEcheance` est la saisie ouverte pour
 * la combler — vérifiée ici, comme le reste de cet écran, sans navigateur
 * (`renderToStaticMarkup` — voir l'en-tête du fichier).
 * Ne peut donc PAS simuler une frappe ni un `blur` : ces deux tests figent
 * uniquement le rendu initial pour les deux cas — valeur connue, valeur
 * inconnue — qui sont exactement ceux qu'un défaut de saisie masquerait.
 */
describe('ChampMontantEstimeEcheance — saisie du montant estimé d’une échéance', () => {
  it('affiche un champ vide avec le tiret d’absence en indication, quand aucune estimation n’existe', () => {
    const balisage = renderToStaticMarkup(
      <ChampMontantEstimeEcheance valeurInitialeCents={null} onValider={() => {}} />,
    );
    expect(balisage).toContain('placeholder="—"');
    // Jamais de `value`/`defaultValue` non vide sur une estimation inconnue :
    // un champ pré-rempli à 0 se lirait comme une vraie estimation saisie.
    expect(balisage).not.toMatch(/value="[^"]+"/);
  });

  it('pré-remplit le montant estimé existant, formaté en euros', () => {
    const balisage = renderToStaticMarkup(
      <ChampMontantEstimeEcheance valeurInitialeCents={10_271} onValider={() => {}} />,
    );
    expect(balisage).toContain('value="102,71"');
  });

  it('marque le champ comme jamais un montant dû, pour un lecteur d’écran', () => {
    const balisage = renderToStaticMarkup(
      <ChampMontantEstimeEcheance valeurInitialeCents={null} onValider={() => {}} />,
    );
    expect(balisage).toContain('aria-label="Montant estimé, en euros — jamais un montant dû"');
  });
});

/**
 * Recette clavier du 30/07/2026 : « Marquer faite » faisait retomber le focus
 * sur `<body>` — le bouton de la ligne pointée disparaît (`statut === 'faite'`
 * masque « Marquer faite »), et rien ne recapturait le focus ensuite.
 *
 * Ce fichier ne monte pas l'écran : il n'observe donc ni
 * `document.activeElement` ni un clic réel. Ce test fige uniquement la
 * DÉCISION — quelle échéance devient la prochaine cible — extraite en
 * fonction pure. Il ne prouve PAS que `Comptabilite.tsx` appelle bien
 * `.focus()` sur le bon nœud DOM, ni que `data-echeance` désigne
 * effectivement ce nœud dans le rendu réel : cette dernière boucle se ferme
 * dans `Comptabilite.montage.test.tsx`, ou par une recette manuelle.
 */
describe('cleEcheanceAFocaliserApresPointage — continuer le pointage sans repasser par <body>', () => {
  function echeance(id: string, statut: 'a_venir' | 'en_retard' | 'faite') {
    return { id, statut };
  }

  it('cible la PROCHAINE échéance encore actionnable après celle qu’on vient de pointer', () => {
    const avant = [
      echeance('tva', 'a_venir'),
      echeance('inasti', 'a_venir'),
      echeance('afsca', 'en_retard'),
    ];
    expect(cleEcheanceAFocaliserApresPointage(avant, 'tva')).toBe('inasti');
  });

  it('saute les échéances déjà faites : elles n’ont plus de bouton à focaliser', () => {
    const avant = [
      echeance('tva', 'a_venir'),
      echeance('inasti', 'faite'),
      echeance('afsca', 'en_retard'),
    ];
    expect(cleEcheanceAFocaliserApresPointage(avant, 'tva')).toBe('afsca');
  });

  it('revient sur la précédente actionnable quand la pointée était la DERNIÈRE actionnable', () => {
    const avant = [
      echeance('tva', 'a_venir'),
      echeance('inasti', 'a_venir'),
      echeance('afsca', 'faite'),
    ];
    expect(cleEcheanceAFocaliserApresPointage(avant, 'inasti')).toBe('tva');
  });

  it('rend `null` quand plus aucune échéance n’est actionnable après le pointage', () => {
    // Cas terminal, rare : toutes les échéances sont à jour. Aucune cible de
    // continuation n'existe — l'appelant ne force alors rien (voir
    // `Comptabilite.tsx`), ce qui reste préférable à inventer une cible qui
    // n'a pas de sens.
    const avant = [echeance('tva', 'a_venir')];
    expect(cleEcheanceAFocaliserApresPointage(avant, 'tva')).toBeNull();
  });

  it('rend `null` sur une liste déjà vide (garde de robustesse)', () => {
    expect(cleEcheanceAFocaliserApresPointage([], 'tva')).toBeNull();
  });
});

/**
 * Pont Comptabilité → Économies d'achat (docs/demandes/10 : « renvoyer
 * directement vers l'économie d'achat du mois sans re-saisie »), sur le même
 * mécanisme que `navigate('/menus?produit=${id}')` (Produits.tsx → Menus.tsx) :
 * un identifiant en paramètre d'URL, jamais un second mécanisme inventé.
 *
 * CE QUE CES TESTS NE PROUVENT PAS : que le clic sur un des deux boutons
 * (« Voir l'économie d'achat de ce mois », « Économies → » par ligne de
 * `Périodes`) appelle réellement `navigate` avec cette chaîne — ce fichier ne
 * monte pas l'écran, donc aucun clic n'y est simulé (voir
 * `Comptabilite.montage.test.tsx`). Ils prouvent seulement que la fonction qui
 * construit le CHEMIN est correcte, avec des mois à un ET deux chiffres (un
 * gabarit à un seul cas aurait laissé passer un défaut de zéro-remplissage
 * sans qu'aucun test ne le voie). Plus important encore : à la date
 * d'écriture, `Economies.tsx` ne lit aucun de ces deux paramètres au montage
 * (aucun `useSearchParams`, `annee` initialisée sur l'année civile courante
 * quel que soit le contenu de l'URL) — ce lien navigue vers le bon écran mais
 * ne le pré-filtre pas encore, voir le commentaire de `cheminEconomiesDuMois`.
 */
describe('cheminEconomiesDuMois — le pont vers Économies d’achat', () => {
  it('construit `/economies?annee=…&mois=…` pour un mois à deux chiffres', () => {
    expect(cheminEconomiesDuMois(2026, 11)).toBe('/economies?annee=2026&mois=11');
  });

  it('ne zéro-remplit PAS le mois à un chiffre — même convention que `NOMS_MOIS[mois - 1]`', () => {
    // `PeriodeLigneContrat.mois` et `NOMS_MOIS` (Comptabilite.tsx) utilisent
    // déjà des mois 1-12 sans zéro-remplissage : un `mois=03` produit par ce
    // pont serait un format que rien d'autre dans ce fichier ne produit.
    expect(cheminEconomiesDuMois(2026, 3)).toBe('/economies?annee=2026&mois=3');
  });

  it('respecte l’ordre des paramètres — année puis mois, jamais l’inverse', () => {
    // Les deux arguments sont deux entiers du même ordre de grandeur possible
    // (2026 et 3) : un ordre inversé dans le corps de la fonction ne serait
    // détecté par AUCUN des deux tests précédents s'ils utilisaient des
    // valeurs qui ne se distinguent pas assez visuellement.
    expect(cheminEconomiesDuMois(3, 2026)).toBe('/economies?annee=3&mois=2026');
    expect(cheminEconomiesDuMois(3, 2026)).not.toBe(cheminEconomiesDuMois(2026, 3));
  });
});

/**
 * `depenseAnnuleeId` (`schemaDepenseLigne`, docs/21-CHAMPS-NON-LUS.md §5) :
 * le badge « Correction » disait QU'une dépense corrige quelque chose, jamais
 * LAQUELLE. `libelleCibleAnnulationDepense` referme ce trou par un JOIN
 * d'affichage sur la liste déjà chargée — jamais un second calcul.
 */
describe('libelleCibleAnnulationDepense', () => {
  function depense(overrides: Partial<DepenseLigneContrat> = {}): DepenseLigneContrat {
    return {
      id: 'd1',
      dateDepense: '2026-03-12',
      libelle: 'Assurance RC pro',
      categorie: 'assurance',
      montantCents: 15000,
      montantDeductibleCents: 15000,
      fournisseurId: null,
      fournisseurNom: null,
      justificatifPath: null,
      deductibleBp: 10000,
      immobilisationId: null,
      notes: null,
      estAnnulation: false,
      depenseAnnuleeId: null,
      estAnnulee: false,
      creeLe: '2026-03-12T10:00:00.000Z',
      ...overrides,
    };
  }

  it('rend `null` quand la ligne n’est pas une correction (`depenseAnnuleeId` absent)', () => {
    const toutes = [depense()];
    expect(libelleCibleAnnulationDepense(null, toutes)).toBeNull();
  });

  it('nomme la dépense corrigée — libellé, date et montant', () => {
    const originale = depense({ id: 'd1', libelle: 'Assurance RC pro', dateDepense: '2026-03-12' });
    const toutes = [originale, depense({ id: 'd2', depenseAnnuleeId: 'd1', estAnnulation: true })];
    const resultat = libelleCibleAnnulationDepense('d1', toutes);
    expect(resultat).not.toBeNull();
    expect(resultat).toContain('Assurance RC pro');
    expect(resultat).toContain('12/03/2026');
    expect(resultat).toContain('150,00');
  });

  it('rend `null` si la cible référencée n’existe plus dans la liste chargée (garde de robustesse)', () => {
    // Cas qui ne devrait jamais arriver (une contre-écriture référence
    // toujours une ligne existante), mais une liste partiellement filtrée ou
    // paginée pourrait un jour omettre la cible — mieux vaut taire que
    // planter ou mentir.
    const toutes = [depense({ id: 'd2', depenseAnnuleeId: 'd-inconnue', estAnnulation: true })];
    expect(libelleCibleAnnulationDepense('d-inconnue', toutes)).toBeNull();
  });
});

/**
 * Verrouillage définitif d'une période (mission du 01/08/2026,
 * docs/34-VERROU-COMPTABLE.md) — le geste le plus irréversible du produit
 * (`rouvrirPeriode` refuse déjà une période `verrouillee`, et la contre-passation
 * vérifie le verrou sur la date D'ORIGINE de l'écriture, jamais sur aujourd'hui).
 *
 * CE QUE CES TESTS PROUVENT : la DÉCISION d'activation du bouton final
 * (`confirmationVerrouillageActivable`, fonction pure) et le RENDU du décompte
 * chiffré dans ses trois états (`ImpactVerrouillagePeriode`, via
 * `renderToStaticMarkup`) — en particulier qu'un échec du chargement ne rend
 * NI champ de confirmation NI bouton, et que les deux familles de compteurs
 * n'apparaissent jamais additionnées.
 *
 * CE QUE CES TESTS NE PROUVENT PAS (pas de montage dans ce fichier, comme
 * pour le reste de cet écran ici) : qu'un clic réel sur
 * « Verrouiller… » ouvre bien la confirmation, qu'`Échap` la referme sans
 * jamais confirmer, que `disabled` posé sur le bouton final au moment du clic
 * ne fait pas perdre le focus AVANT que `requestAnimationFrame` ne le
 * restaure en cas d'échec, ni que le focus atterrit bien sur
 * `boutonCloturerPeriode` après un verrouillage réussi. Ces points restent
 * vérifiés par la recette manuelle (capture d'écran) décrite dans le rapport
 * de livraison, pas par ce fichier.
 */
describe('texteConfirmationVerrouillagePeriode — le texte exact à recopier', () => {
  it('compose « Mois Année » à partir du mois et de l’année de la ligne', () => {
    expect(texteConfirmationVerrouillagePeriode(7, 2026)).toBe('Juillet 2026');
  });

  it('couvre le premier mois (janvier), qui utilise `mois - 1 === 0`', () => {
    expect(texteConfirmationVerrouillagePeriode(1, 2026)).toBe('Janvier 2026');
  });

  it('couvre le dernier mois (décembre), borne haute du tableau `NOMS_MOIS`', () => {
    expect(texteConfirmationVerrouillagePeriode(12, 2026)).toBe('Décembre 2026');
  });
});

describe('confirmationVerrouillageActivable — le geste délibéré secondaire', () => {
  const impactConnu: ImpactVerrouillagePeriodeContrat = {
    periodeId: 'p1',
    annee: 2026,
    mois: 7,
    mouvementsStockNonAnnulesCount: 3,
    receptionsNonAnnuleesCount: 1,
    productionsNonAnnuleesCount: 0,
    sessionsNonAnnuleesCount: 2,
    depensesCount: 5,
    immobilisationsCount: 1,
  };

  it('refuse tant que l’impact est encore en cours de chargement, même avec le bon texte recopié', () => {
    expect(
      confirmationVerrouillageActivable({ statut: 'chargement' }, 'Juillet 2026', 'Juillet 2026'),
    ).toBe(false);
  });

  it('refuse quand le chargement de l’impact a ÉCHOUÉ, même avec le bon texte recopié — un décompte inconnu bloque le geste, il ne vaut jamais zéro', () => {
    expect(
      confirmationVerrouillageActivable(
        { statut: 'erreur', message: 'Panne réseau.' },
        'Juillet 2026',
        'Juillet 2026',
      ),
    ).toBe(false);
  });

  it('refuse quand l’impact est connu mais que le texte recopié ne correspond pas', () => {
    expect(
      confirmationVerrouillageActivable(
        { statut: 'pret', impact: impactConnu },
        'Juilet 2026', // faute de frappe volontaire
        'Juillet 2026',
      ),
    ).toBe(false);
  });

  it('refuse une correspondance qui ne diffère que par la casse — recopier veut dire recopier EXACTEMENT', () => {
    expect(
      confirmationVerrouillageActivable(
        { statut: 'pret', impact: impactConnu },
        'juillet 2026',
        'Juillet 2026',
      ),
    ).toBe(false);
  });

  it('active seulement quand l’impact est connu ET le texte recopié correspond exactement', () => {
    expect(
      confirmationVerrouillageActivable(
        { statut: 'pret', impact: impactConnu },
        'Juillet 2026',
        'Juillet 2026',
      ),
    ).toBe(true);
  });

  it('tolère les espaces superflus autour de la saisie (comme un copier-coller), jamais dans le texte attendu lui-même', () => {
    expect(
      confirmationVerrouillageActivable(
        { statut: 'pret', impact: impactConnu },
        '  Juillet 2026  ',
        'Juillet 2026',
      ),
    ).toBe(true);
  });
});

describe('ImpactVerrouillagePeriode — le décompte chiffré, deux familles jamais mélangées', () => {
  it('en chargement : aucun compteur, aucune des deux familles, aucune phrase d’irréversibilité', () => {
    const balisage = renderToStaticMarkup(
      <ImpactVerrouillagePeriode etat={{ statut: 'chargement' }} />,
    );
    expect(balisage).toContain('Calcul de l’impact');
    expect(balisage).not.toContain('Définitivement incorrigible');
    expect(balisage).not.toContain('Informatif seulement');
    expect(balisage).not.toContain('ne pourra plus jamais être rouverte');
  });

  it('en échec : refuse le geste EXPLICITEMENT, sans afficher de compteurs à zéro inventés', () => {
    const balisage = renderToStaticMarkup(
      <ImpactVerrouillagePeriode
        etat={{ statut: 'erreur', message: 'Impossible de contacter le serveur.' }}
      />,
    );
    expect(balisage).toContain('role="alert"');
    expect(balisage).toContain('Impossible de contacter le serveur.');
    expect(balisage).toContain('Verrouillage refusé');
    // Aucune trace des deux familles ni de la phrase finale : ce n'est pas
    // seulement UN bouton absent, c'est tout le décompte qui n'est pas rendu.
    expect(balisage).not.toContain('Définitivement incorrigible');
    expect(balisage).not.toContain('Informatif seulement');
    expect(balisage).not.toContain('0 mouvement');
  });

  it('avec un impact connu : les DEUX familles apparaissent, jamais additionnées, avec la phrase d’irréversibilité exacte', () => {
    const balisage = renderToStaticMarkup(
      <ImpactVerrouillagePeriode
        etat={{
          statut: 'pret',
          impact: {
            periodeId: 'p1',
            annee: 2026,
            mois: 7,
            mouvementsStockNonAnnulesCount: 3,
            receptionsNonAnnuleesCount: 1,
            productionsNonAnnuleesCount: 0,
            sessionsNonAnnuleesCount: 2,
            depensesCount: 5,
            immobilisationsCount: 1,
          },
        }}
      />,
    );

    // Famille 1 — définitivement incorrigible, accord singulier/pluriel
    // vérifié sur les deux bornes (0 et 1 restent au singulier, comme partout
    // ailleurs dans ce dépôt — voir `accord`).
    expect(balisage).toContain('Définitivement incorrigible');
    expect(balisage).toContain('3 mouvements de stock non annulés');
    expect(balisage).toContain('1 réception non annulée');
    expect(balisage).toContain('0 production non annulée');
    expect(balisage).toContain('2 sessions non annulées');

    // Famille 2 — informative seulement, jamais dans le même bloc que la
    // famille 1 (vérifié ci-dessous par l'ordre des deux libellés).
    expect(balisage).toContain('Informatif seulement');
    expect(balisage).toContain('5 dépenses de ce mois');
    expect(balisage).toContain('1 immobilisation de ce mois');

    // Les deux familles ne sont jamais additionnées : aucun total (9 = 3+1+0+2+5+... n'apparaît nulle part).
    expect(balisage).not.toMatch(/\b9\b/);

    // La phrase non négociable, mot pour mot.
    expect(balisage).toContain(
      'Cette période ne pourra plus jamais être rouverte, y compris par ce logiciel.',
    );

    // Ordre : la famille irrécupérable est annoncée AVANT l'informative —
    // un lecteur pressé voit d'abord ce qui est réellement figé.
    expect(balisage.indexOf('Définitivement incorrigible')).toBeLessThan(
      balisage.indexOf('Informatif seulement'),
    );
  });

  /**
   * L'avertissement ne doit pas EXAGÉRER sa portée : un avertissement qui
   * ment par excès s'apprend à cliquer sans lire, exactement comme un
   * avertissement absent.
   *
   * FAIT VÉRIFIÉ, pas supposé : `packages/db/src/services/factures.ts`
   * n'appelle jamais `verifierPeriodeNonVerrouillee` (zéro occurrence dans
   * tout le fichier). Une facture reste donc enregistrable, annulable, et
   * `corrigerCoutLot` réécrit encore `lot.prix_ligne_cents` d'un lot reçu
   * dans un mois verrouillé — `enregistrerFacture` y insère même des
   * `frais_reception` que `totalFraisReceptionCents` reprend dans la synthèse
   * de l'exercice.
   */
  it('annonce que les factures fournisseur ÉCHAPPENT au verrou, dans la famille informative et JAMAIS dans celle des incorrigibles', () => {
    const balisage = renderToStaticMarkup(
      <ImpactVerrouillagePeriode
        etat={{
          statut: 'pret',
          impact: {
            periodeId: 'p1',
            annee: 2026,
            mois: 7,
            mouvementsStockNonAnnulesCount: 3,
            receptionsNonAnnuleesCount: 1,
            productionsNonAnnuleesCount: 0,
            sessionsNonAnnuleesCount: 2,
            depensesCount: 5,
            immobilisationsCount: 1,
          },
        }}
      />,
    );

    expect(balisage).toContain('Les factures fournisseur ne sont pas regardées par ce verrou');
    // Le fait est énoncé SANS compteur inventé : le contrat ne renvoie aucun
    // décompte de factures, et un composant ne calcule pas (CLAUDE.md §3).
    expect(balisage).not.toMatch(/\d+ factures? /);
    // Et il vit du BON côté de la frontière : après « Informatif seulement »,
    // donc jamais dans la liste de ce que le verrou fige.
    expect(balisage.indexOf('Informatif seulement')).toBeLessThan(
      balisage.indexOf('Les factures fournisseur'),
    );
  });
});
