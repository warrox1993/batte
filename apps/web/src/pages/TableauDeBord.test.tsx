import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TIRET_ABSENT,
  formaterDate,
  formaterEcartMontant,
  formaterEuros,
  formaterPourcent,
  joursEntre,
  type CompteurSeuilContrat,
  type EcheanceLigneContrat,
  type EtatDemarrage,
  type EtatIa,
  type FactureResume,
  type GroupePalmaresProduitsContrat,
  type JourCalendaire,
  type LigneClassementFournisseurContrat,
  type LigneClassementProduitContrat,
  type LigneComparaisonLieu,
  type LigneStockContrat,
  type MouvementPrixConcurrent,
  type ObjectifLigneContrat,
  type PrevisionArchivee,
  type PropositionEvenement,
  type SemaineCalendaire,
} from '@batte/core';
import {
  BlocGroupePalmaresProduits,
  LIBELLE_ECOULEMENT,
  SectionDemarrage,
  SectionMouvementsConcurrents,
  SectionPrevision,
  compterMouvementsParStatut,
  construireAlertes,
  construireSignauxDemarrage,
  demandeProjeteeFiable,
  ecartPrevuRealisePourSession,
  echeancesDansHorizon,
  formaterValeurCritereFournisseur,
  formaterValeurCritereProduit,
  libelleObjectifEnCours,
  LigneSeuil,
  meilleursLieux,
  objectifEnCoursLePlusProche,
  phraseDemandeProjetee,
  phraseDetailStableEtNouveau,
  phraseEnTeteMouvementsConcurrents,
  phrasePiedBudgetIa,
  phraseResumeMouvementsConcurrents,
  resumeMouvementsConcurrents,
  statutSeuil,
  titreEcoulement,
  titreMouvementConcurrent,
} from './TableauDeBord';

/** Horizon par défaut du tableau de bord (30 j) — voir `HORIZON_PAR_DEFAUT`. */
const HORIZON_TEST = 30;

/**
 * Horizon DLC de test — `construireAlertes` ne prend plus aucun défaut
 * implicite pour cette fenêtre (correctif « brief vs écrans », 01/08/2026) :
 * chaque appel doit désormais fournir explicitement la valeur lue depuis
 * `brief_horizon_alerte_dlc_jours`. 14 jours ici pour rester équivalent à
 * l'ancien défaut de `formaterJoursRestants` sur les cas déjà couverts par
 * ces tests.
 */
const HORIZON_DLC_TEST = 14;

/**
 * Le taux de vendu/produit portait trois habillages différents selon
 * l'écran avant cette mission (audit visuel du 30/07/2026,
 * `docs/23-AUDIT-VISUEL.md` §3.1) : « Écoulement » en entier ICI, tronqué
 * par CSS à largeur étroite en `ÉCOULE…` — une troncature qui dépend de la
 * largeur du navigateur et coupe où elle veut.
 *
 * `LIBELLE_ECOULEMENT` et `titreEcoulement` étaient dupliqués à l'identique
 * avec `Sessions.tsx` (aucun module commun n'était dans le périmètre
 * d'écriture de cette mission-là) ; `Sessions.test.tsx` vérifiait les deux
 * copies l'une contre l'autre. Consolidés depuis dans
 * `packages/core/src/affichage.ts` (mission du 31/07/2026, testés
 * directement là-bas) et ré-exportés ici : les tests ci-dessous vérifient
 * la valeur, pas l'absence de duplication, qui est désormais garantie par
 * construction (une seule définition existe).
 */
describe('LIBELLE_ECOULEMENT / titreEcoulement — une abréviation choisie, jamais une troncature CSS', () => {
  it('« Écoul. » : abréviation courte et stable, jamais de troncature à points de suspension', () => {
    expect(LIBELLE_ECOULEMENT).toBe('Écoul.');
    expect(LIBELLE_ECOULEMENT).not.toContain('…');
  });

  it("l'infobulle commence par le texte réellement rendu dans la cellule, puis nomme le mot entier", () => {
    expect(titreEcoulement(8953)).toBe(
      `${formaterPourcent(8953)} — Taux d'écoulement (vendu / produit)`,
    );
  });

  it('sur une valeur absente (`null`), l’infobulle commence par le même tiret que la cellule', () => {
    expect(titreEcoulement(null)).toBe(`${TIRET_ABSENT} — Taux d'écoulement (vendu / produit)`);
  });
});

/**
 * `statutSeuil` combine deux signaux distincts sur un seuil légal
 * (docs/16-AUDIT-COMPTABILITE.md §2, corrigé) :
 *   - `statutParPlafond(realiseCents, plafondCents, seuilAlerteBp)` — où j'en
 *     suis MAINTENANT ;
 *   - `depassementProjete` — où je VAIS finir l'année, calculé côté serveur.
 *
 * Défaut mesuré avant correction : l'écran ne regardait QUE la projection.
 * À 21 250 €, soit 85 % d'un seuil de franchise TVA à 25 000 €, la ligne
 * s'affichait EN VERT (« conforme ») car sous deux sessions
 * `projectionFinAnneeCents` vaut `null` et `depassementProjete` valait donc
 * `false` — le réalisé, pourtant à 85 %, n'était jamais consulté.
 *
 * Aucun rendu React ici : `statutSeuil` est une fonction pure, extraite
 * exactement pour être testable sans navigateur (même patron que
 * `etatEcheancesApresEchecPointage` dans `Comptabilite.tsx`).
 */
function compteur(partiel: Partial<CompteurSeuilContrat>): CompteurSeuilContrat {
  return {
    cle: 'seuil_test',
    libelle: 'Seuil de test',
    realiseCents: 0,
    plafondCents: 2_500_000,
    partBp: 0,
    projectionFinAnneeCents: null,
    depassementProjete: false,
    // Tolérance e604B (01/08/2026) : `null` sur tout seuil AUTRE que la
    // franchise TVA — c'est le second étage du MÊME seuil (sortie à
    // 25 000 €, tolérance jusqu'à 27 500 €), jamais un cinquième seuil
    // indépendant. Un `null` ici est un fait, pas une valeur manquante.
    toleranceE604b: null,
    source: 'test',
    ...partiel,
  };
}

const SEUIL_ALERTE_BP = 8_000; // 80 %, valeur réelle du catalogue.

describe('statutSeuil — combine réalisé et trajectoire', () => {
  it('affiche « alerte » à 85 % du plafond, MÊME sans projection (le défaut historique)', () => {
    // Exactement le scénario mesuré : 21 250 € sur 25 000 €, une seule
    // session tenue (projection encore nulle).
    const seuil = compteur({ realiseCents: 2_125_000, projectionFinAnneeCents: null });
    expect(statutSeuil(seuil, SEUIL_ALERTE_BP)).toBe('alerte');
  });

  it('affiche « depassement » quand le RÉALISÉ dépasse déjà le plafond, projection ou pas', () => {
    // La projection peut valoir `null` (historique insuffisant) alors que le
    // réalisé a déjà franchi le seuil — ce cas ne doit JAMAIS retomber sur
    // « conforme » ou « alerte ».
    const seuil = compteur({ realiseCents: 2_600_000, projectionFinAnneeCents: null });
    expect(statutSeuil(seuil, SEUIL_ALERTE_BP)).toBe('depassement');
  });

  it('affiche « depassement » sur la SEULE trajectoire, même à 40 % du réalisé', () => {
    // On peut être loin du seuil aujourd'hui et le franchir avant décembre :
    // la projection doit suffire à alerter, sans attendre le réalisé.
    const seuil = compteur({
      realiseCents: 1_000_000,
      projectionFinAnneeCents: 2_600_000,
      depassementProjete: true,
    });
    expect(statutSeuil(seuil, SEUIL_ALERTE_BP)).toBe('depassement');
  });

  it('reste « conforme » loin du seuil sans risque de trajectoire', () => {
    const seuil = compteur({
      realiseCents: 500_000,
      projectionFinAnneeCents: 1_200_000,
      depassementProjete: false,
    });
    expect(statutSeuil(seuil, SEUIL_ALERTE_BP)).toBe('conforme');
  });

  it('reste « conforme » à 85 % en fin d’année sans risque (projection ne dépasse pas)', () => {
    // « on peut être à 85 % en décembre sans risque » : ce cas doit rester à
    // « alerte » (le réalisé le justifie), jamais grimper à « depassement »
    // sans que le réalisé OU la projection ne l'atteignent réellement.
    const seuil = compteur({
      realiseCents: 2_125_000,
      projectionFinAnneeCents: 2_125_000,
      depassementProjete: false,
    });
    expect(statutSeuil(seuil, SEUIL_ALERTE_BP)).toBe('alerte');
  });
});

/**
 * `LigneSeuil` — second étage du régime de franchise TVA (docs/07 §6.6,
 * `docs/05-DECISIONS.md`).
 *
 * `CompteurSeuilEnrichi.toleranceE604b` (`packages/db/src/depots/sessions.ts`)
 * calculait déjà le plafond de tolérance de 27 500 € et son statut, et le
 * contrat HTTP (`packages/core/src/contrats/sessions.ts`) le déclare depuis
 * peu — mais rien à l'écran ne le montrait avant ce correctif : ni régression
 * (rien ne le testait), ni défaut connu, simplement un maillon jamais posé.
 *
 * Rendu par `renderToStaticMarkup` (UN rendu, dans l'état initial), même
 * technique que le reste de ce fichier.
 *
 * CE QUE CES TESTS NE PROUVENT PAS : que l'API renvoie réellement ce champ en
 * conditions réelles (couvert côté serveur par
 * `packages/db/src/seuils-parametrables.test.ts`), ni la mise en page exacte
 * au pixel près — seulement que le balisage contient (ou ne contient pas) le
 * qualificatif de tolérance, et jamais sur un seuil qui n'est pas la
 * franchise TVA.
 */
describe('LigneSeuil — le second étage de la franchise TVA ne devient jamais un cinquième seuil', () => {
  function compteurAvecTolerance(
    statutTolerance: 'conforme' | 'alerte' | 'depassement',
  ): CompteurSeuilContrat {
    return compteur({
      cle: 'seuil_franchise_tva_cents',
      libelle: 'Franchise TVA',
      realiseCents: 2_600_000,
      plafondCents: 2_500_000,
      partBp: 10_400,
      toleranceE604b: { plafondCents: 2_750_000, statut: statutTolerance },
    });
  }

  it("n'affiche AUCUN qualificatif de tolérance quand `toleranceE604b` est `null` (les trois autres seuils)", () => {
    const balisage = renderToStaticMarkup(
      <LigneSeuil seuil={compteur({ libelle: 'Aide Airbag' })} seuilAlerteBp={SEUIL_ALERTE_BP} />,
    );
    expect(balisage).not.toContain('tolérance');
  });

  it('affiche le plafond de TOLÉRANCE (27 500 €) sur la ligne Franchise TVA, jamais une rangée de plus', () => {
    const balisage = renderToStaticMarkup(
      <LigneSeuil seuil={compteurAvecTolerance('conforme')} seuilAlerteBp={SEUIL_ALERTE_BP} />,
    );
    expect(balisage).toContain('tolérance');
    expect(balisage).toContain(formaterEuros(2_750_000));
    // Une seule rangée : le libellé du seuil n'apparaît qu'une fois.
    expect(balisage.match(/Franchise TVA/g)?.length).toBe(1);
  });

  it('les trois statuts (conforme / alerte / dépassement) du plafond de tolérance restent DISTINGUABLES', () => {
    const glyphes = (['conforme', 'alerte', 'depassement'] as const).map((statutTolerance) => {
      const balisage = renderToStaticMarkup(
        <LigneSeuil
          seuil={compteurAvecTolerance(statutTolerance)}
          seuilAlerteBp={SEUIL_ALERTE_BP}
        />,
      );
      const debut = balisage.indexOf('tolérance');
      return balisage.slice(Math.max(0, debut - 80), debut);
    });
    // Trois rendus différents (le glyphe et la classe de couleur varient
    // avec `toleranceE604b.statut`) : sans ça, les trois états seraient
    // indiscernables à l'écran.
    expect(new Set(glyphes).size).toBe(3);
  });
});

describe('construireAlertes — un lot périmé ne se confond pas avec un lot qui approche', () => {
  /** Ligne de stock minimale : quantité largement suffisante, seule la DLC varie. */
  function ligneStock(nom: string, dlcLaPlusProche: string | null): LigneStockContrat {
    return {
      ingredientId: `id-${nom}`,
      nom,
      unite: 'g',
      stockSecurite: 1_000,
      quantiteDisponible: 10_300_000,
      quantiteTotale: 10_300_000,
      valeurCents: 500_000,
      cumpCentsParUnite: 0.05,
      dlcLaPlusProche,
      nbLots: 1,
    };
  }

  /** Aucune autre source d'alerte : on isole strictement le comportement DLC. */
  const alertesPour = (stock: readonly LigneStockContrat[]) =>
    construireAlertes(stock, [], [], [], [], [], [], HORIZON_TEST, HORIZON_DLC_TEST);

  it('classe un lot DÉJÀ périmé en dépassement, jamais parmi les DLC proches', () => {
    // `formaterJoursRestants` n'a pas de borne basse : elle rend « J+208 » pour
    // un lot périmé depuis sept mois. L'ancien filtre ne testait que « résultat
    // non nul » et comptait donc ce lot parmi ceux « proches de leur DLC » — un
    // libellé faux sur une denrée alimentaire.
    const alertes = alertesPour([ligneStock('Farine périmée', '2020-01-01')]);

    const perimee = alertes.find((a) => a.cle === 'dlc-perimee');
    expect(perimee).toBeDefined();
    expect(perimee?.statut).toBe('depassement');
    expect(perimee?.libelle).toContain('DÉJÀ périmé');

    // Et surtout : elle ne compte plus dans l'autre alerte.
    expect(alertes.find((a) => a.cle === 'dlc')).toBeUndefined();
  });

  it('garde un vrai lot proche de sa DLC en alerte, sans le déclarer périmé', () => {
    const demain = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const alertes = alertesPour([ligneStock('Lait de demain', demain)]);

    const proche = alertes.find((a) => a.cle === 'dlc');
    expect(proche).toBeDefined();
    expect(proche?.statut).toBe('alerte');
    expect(alertes.find((a) => a.cle === 'dlc-perimee')).toBeUndefined();
  });

  it('ne perd JAMAIS le signal : un lot périmé produit toujours une alerte', () => {
    // Le correctif « évident » — exclure les périmés du filtre — aurait rendu ce
    // lot totalement invisible, puisque rien d'autre sur ce tableau de bord ne
    // signalait la péremption. Ce test interdit cette régression.
    const alertes = alertesPour([ligneStock('Beurre oublié', '2019-06-30')]);
    expect(alertes.length).toBeGreaterThan(0);
    expect(alertes.some((a) => a.statut === 'depassement')).toBe(true);
  });

  it('distingue les deux quand les deux existent, le périmé en premier', () => {
    const demain = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const alertes = alertesPour([
      ligneStock('Lait de demain', demain),
      ligneStock('Farine périmée', '2020-01-01'),
    ]);

    const cles = alertes.map((a) => a.cle);
    expect(cles).toContain('dlc-perimee');
    expect(cles).toContain('dlc');
    // L'ordre est une décision métier : ce qui se retire de la vente passe avant
    // ce qui s'écoule en priorité.
    expect(cles.indexOf('dlc-perimee')).toBeLessThan(cles.indexOf('dlc'));
  });

  it('ne dit rien sur un stock sans aucune DLC connue', () => {
    const alertes = alertesPour([ligneStock('Sel sans DLC', null)]);
    expect(alertes.find((a) => a.cle === 'dlc')).toBeUndefined();
    expect(alertes.find((a) => a.cle === 'dlc-perimee')).toBeUndefined();
  });
});

/**
 * Horizon choisi par l'utilisateur (docs/demandes/10) : la ligne « échéances »
 * de la worklist « À traiter » est le SEUL encart de `construireAlertes` que
 * CE sélecteur (`horizonJours`) fait varier. La ligne « dlc » a bien sa PROPRE
 * fenêtre (`horizonDlcJours`, lue depuis `brief_horizon_alerte_dlc_jours` —
 * voir la description ci-dessus), mais ce n'est ni un réglage d'écran ni
 * l'objet de cette série de tests : elle reste fixe ici (`HORIZON_DLC_TEST`),
 * exactement comme le stock, le nettoyage et les non-conformités, qui
 * décrivent un état présent, sans fenêtre à filtrer.
 *
 * Ce que ces tests prouvent : la DÉCISION de montrer ou de masquer la ligne, à
 * partir d'un horizon en jours et de `joursAvantEcheance` — la même donnée que
 * rend déjà `/echeances`. Ce qu'ils NE prouvent PAS : qu'un clic sur le
 * sélecteur du navigateur recalcule réellement cette liste, ni qu'aucun focus
 * n'est perdu pendant la transition — ce fichier ne monte pas l'écran, rien
 * n'y observe donc un ré-rendu React ni `document.activeElement` (même limite
 * que documentée pour D-079, `docs/05-DECISIONS.md`). Le montage vit dans
 * `TableauDeBord.montage.test.tsx`, à côté de ce fichier.
 */
describe('construireAlertes — la ligne « échéances » suit l’horizon choisi', () => {
  function echeance(partiel: Partial<EcheanceLigneContrat>): EcheanceLigneContrat {
    return {
      id: 'ech-test',
      libelle: 'Listing clients TVA',
      recurrence: 'annuelle',
      prochaineDate: '2027-03-31',
      sourceLegale: 'Code TVA',
      urlSource: null,
      montantEstimeCents: null,
      statut: 'a_venir',
      dateRealisation: null,
      joursAvantEcheance: 20,
      alerteProche: false,
      ...partiel,
    };
  }

  it('un encart sans matière dans l’horizon choisi DISPARAÎT : une échéance à J+20 est absente à un horizon de 7 jours', () => {
    // C'est le test explicitement demandé : la ligne ne doit pas apparaître
    // avec un texte « aucune échéance » — elle doit ne pas exister du tout
    // dans la liste construite, exactement comme les autres catégories vides.
    const alertes = construireAlertes(
      [],
      [],
      [],
      [echeance({ joursAvantEcheance: 20 })],
      [],
      [],
      [],
      7,
      HORIZON_DLC_TEST,
    );
    expect(alertes.find((a) => a.cle === 'echeances')).toBeUndefined();
  });

  it('la même échéance à J+20 RÉAPPARAÎT dès que l’horizon est élargi à 30 jours', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [echeance({ joursAvantEcheance: 20 })],
      [],
      [],
      [],
      30,
      HORIZON_DLC_TEST,
    );
    const ligne = alertes.find((a) => a.cle === 'echeances');
    expect(ligne).toBeDefined();
    expect(ligne?.statut).toBe('alerte');
    // L'horizon retenu doit être nommé dans le libellé : le compte varie
    // avec le sélecteur, contrairement aux autres lignes de cette worklist.
    expect(ligne?.libelle).toContain('30 j');
  });

  it('une échéance EN RETARD reste visible même avec l’horizon le plus court, 7 jours', () => {
    // Un retard ne redevient pas « loin » parce qu'on réduit la fenêtre —
    // c'est déjà passé, ça reste urgent quel que soit l'horizon affiché.
    const alertes = construireAlertes(
      [],
      [],
      [],
      [echeance({ statut: 'en_retard', joursAvantEcheance: -5 })],
      [],
      [],
      [],
      7,
      HORIZON_DLC_TEST,
    );
    const ligne = alertes.find((a) => a.cle === 'echeances');
    expect(ligne).toBeDefined();
    expect(ligne?.statut).toBe('depassement');
  });

  it('une échéance déjà FAITE ne réapparaît jamais, même à l’horizon maximal (1 an)', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [echeance({ statut: 'faite', joursAvantEcheance: 3, dateRealisation: '2026-07-01' })],
      [],
      [],
      [],
      365,
      HORIZON_DLC_TEST,
    );
    expect(alertes.find((a) => a.cle === 'echeances')).toBeUndefined();
  });
});

/**
 * `docs/demandes/05-EVENEMENTS-DECOUVERTE-IA-RAYON-REGLABLE.md` : « une
 * proposition d'événement en attente de validation doit apparaître dans le
 * bloc Alertes […] avec sa rentabilité prévue en évidence. » La route
 * `GET /evenements-decouverte/propositions/nombre-en-attente` porte même le
 * commentaire « pour le bloc Alertes du tableau de bord » — jamais câblée
 * jusqu'ici (docs/28-ORPHELINS-DERIVES.md §2.5).
 */
describe('construireAlertes — propositions d’événement IA en attente', () => {
  function proposition(partiel: Partial<PropositionEvenement>): PropositionEvenement {
    return {
      id: 'prop-test',
      nom: 'Festival de la bière',
      type: 'festival',
      dateDebut: '2026-09-05',
      dateFin: '2026-09-06',
      portee: 'liege',
      intensiteEstimee: 3,
      impactEstimeBp: 12_000,
      impactMesureBp: null,
      source: 'ia',
      valideParHumain: false,
      notes: null,
      lieuId: 'lieu-test',
      lieuNom: 'La Batte',
      rayonRechercheKm: 10,
      distanceKm: 2.5,
      communeTexte: 'Liège',
      rentabiliteEstimeeCents: 5_432,
      famille: null,
      effectifEstime: null,
      ...partiel,
    };
  }

  it('rien à traiter : la ligne est absente sans aucune proposition en attente', () => {
    const alertes = construireAlertes([], [], [], [], [], [], [], HORIZON_TEST, HORIZON_DLC_TEST);
    expect(alertes.find((a) => a.cle === 'propositions-evenements')).toBeUndefined();
  });

  it('compte les propositions et met la MEILLEURE rentabilité en évidence (positive)', () => {
    // Le serveur les trie déjà par rentabilité décroissante : la première de
    // la liste est la plus rentable.
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [proposition({ rentabiliteEstimeeCents: 5_432 }), proposition({ id: 'prop-2' })],
      [],
      [],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    const ligne = alertes.find((a) => a.cle === 'propositions-evenements');
    expect(ligne).toBeDefined();
    expect(ligne?.statut).toBe('alerte');
    expect(ligne?.libelle).toContain('2 propositions');
    // `formaterEuros` insère l'espace fine insécable propre à `Intl.NumberFormat`
    // en locale fr-BE : on compare au résultat RÉEL de la fonction, jamais à un
    // littéral qui pourrait diverger d'un caractère Unicode invisible.
    expect(ligne?.libelle).toContain(`+${formaterEuros(5_432)}`);
    expect(ligne?.chemin).toBe('/evenements-decouverte');
  });

  it('accorde au singulier pour une seule proposition', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [proposition({})],
      [],
      [],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    const ligne = alertes.find((a) => a.cle === 'propositions-evenements');
    expect(ligne?.libelle).toContain('1 proposition ');
  });

  it('signe une rentabilité prévue NÉGATIVE avec un signe moins, jamais un nombre nu', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [proposition({ rentabiliteEstimeeCents: -1_200 })],
      [],
      [],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    const ligne = alertes.find((a) => a.cle === 'propositions-evenements');
    expect(ligne?.libelle).toContain(`−${formaterEuros(1_200)}`);
  });
});

/**
 * Mission « finir le tableau de bord » (01/08/2026) : le porteur a
 * explicitement signalé que `facture.dateEcheance` est nullable et qu'une
 * facture sans échéance n'est PAS « en retard » — même doctrine que
 * `dlc-perimee` / `dlc` plus haut, deux natures, deux lignes, jamais
 * fusionnées.
 */
describe('construireAlertes — factures impayées : « en retard » ne se confond jamais avec « sans échéance connue »', () => {
  function facture(partiel: Partial<FactureResume> & { id: string }): FactureResume {
    return {
      numeroFournisseur: 'F-2026-01',
      fournisseurId: 'four-1',
      fournisseurNom: 'Meunier test',
      dateFacture: '2026-06-01',
      dateEcheance: null,
      montantTotalCents: 10_000,
      statut: 'a_rapprocher',
      nbLignes: 1,
      ecartTotalCents: 0,
      estAnnulation: false,
      factureAnnuleeId: null,
      estAnnulee: false,
      creeLe: '2026-06-01T00:00:00.000Z',
      ...partiel,
    };
  }

  it('rien à traiter sans aucune facture impayée', () => {
    const alertes = construireAlertes([], [], [], [], [], [], [], HORIZON_TEST, HORIZON_DLC_TEST);
    expect(alertes.find((a) => a.cle === 'factures-retard')).toBeUndefined();
    expect(alertes.find((a) => a.cle === 'factures-echeance-inconnue')).toBeUndefined();
  });

  it('une facture impayée dont l’échéance est DÉJÀ dépassée produit la ligne « en retard », en dépassement', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [],
      [facture({ id: 'f1', dateEcheance: '2020-01-01', montantTotalCents: 12_345 })],
      [],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    const ligne = alertes.find((a) => a.cle === 'factures-retard');
    expect(ligne).toBeDefined();
    expect(ligne?.statut).toBe('depassement');
    expect(ligne?.libelle).toContain(formaterEuros(12_345));
    expect(ligne?.chemin).toBe('/factures');
    // Et surtout : elle ne compte PAS dans l'autre ligne.
    expect(alertes.find((a) => a.cle === 'factures-echeance-inconnue')).toBeUndefined();
  });

  it('une facture impayée SANS échéance connue produit une ligne DISTINCTE, jamais confondue avec un retard', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [],
      [facture({ id: 'f1', dateEcheance: null })],
      [],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    const ligne = alertes.find((a) => a.cle === 'factures-echeance-inconnue');
    expect(ligne).toBeDefined();
    // `alerte`, pas `depassement` : l'absence d'échéance n'est pas un retard
    // CONFIRMÉ, contrairement au cas ci-dessus.
    expect(ligne?.statut).toBe('alerte');
    expect(alertes.find((a) => a.cle === 'factures-retard')).toBeUndefined();
  });

  it('une facture impayée dont l’échéance est encore À VENIR ne produit AUCUNE des deux lignes', () => {
    // Rien à traiter aujourd'hui : ni en retard, ni sans échéance connue —
    // une worklist ne liste pas ce qui n'est pas encore actionnable.
    const dansUnAn = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [],
      [facture({ id: 'f1', dateEcheance: dansUnAn })],
      [],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    expect(alertes.find((a) => a.cle === 'factures-retard')).toBeUndefined();
    expect(alertes.find((a) => a.cle === 'factures-echeance-inconnue')).toBeUndefined();
  });

  it('une facture DÉJÀ PAYÉE n’apparaît dans aucune des deux lignes, même en retard ou sans échéance', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [],
      [
        facture({ id: 'f1', statut: 'payee', dateEcheance: '2020-01-01' }),
        facture({ id: 'f2', statut: 'payee', dateEcheance: null }),
      ],
      [],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    expect(alertes.find((a) => a.cle === 'factures-retard')).toBeUndefined();
    expect(alertes.find((a) => a.cle === 'factures-echeance-inconnue')).toBeUndefined();
  });

  it('une facture ANNULÉE par contre-écriture n’apparaît dans aucune des deux lignes', () => {
    // Une annulation (CLAUDE.md §3 règle 7) n'est plus une dette réelle.
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [],
      [facture({ id: 'f1', estAnnulee: true, dateEcheance: '2020-01-01' })],
      [],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    expect(alertes.find((a) => a.cle === 'factures-retard')).toBeUndefined();
  });

  it('additionne le MONTANT des factures en retard dans le libellé, pas seulement leur nombre', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [],
      [
        facture({ id: 'f1', dateEcheance: '2020-01-01', montantTotalCents: 1_000 }),
        facture({ id: 'f2', dateEcheance: '2020-02-01', montantTotalCents: 2_000 }),
      ],
      [],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    const ligne = alertes.find((a) => a.cle === 'factures-retard');
    expect(ligne?.libelle).toContain('2 factures');
    expect(ligne?.libelle).toContain(formaterEuros(3_000));
  });
});

/**
 * Septième élément demandé (mission « finir le tableau de bord ») :
 * l'objectif budgétaire EN COURS le plus proche de son échéance. Trois
 * pièges nommés par le porteur, chacun couvert par un test dédié :
 * `'sans_donnee'` ≠ `'manque'`, `'en_cours'` légitime ici, jamais le glyphe
 * ▲/`depassement` sur un objectif encore poursuivable.
 */
describe('construireAlertes / objectifEnCoursLePlusProche — l’objectif budgétaire qui change ce qu’on fait', () => {
  function objectif(partiel: Partial<ObjectifLigneContrat> & { id: string }): ObjectifLigneContrat {
    return {
      grandeur: 'chiffre_affaires',
      dateDebut: '2026-07-01',
      dateFin: '2026-07-31',
      valeurCible: 500_000,
      notes: null,
      estAnnulation: false,
      objectifAnnuleId: null,
      estAnnule: false,
      creeLe: '2026-07-01T00:00:00.000Z',
      modifieLe: '2026-07-01T00:00:00.000Z',
      evaluation: {
        grandeur: 'chiffre_affaires',
        valeurCible: 500_000,
        realise: 300_000,
        ecart: -200_000,
        avancementBp: 6_000,
        statut: 'en_cours',
        periodeTerminee: false,
      },
      ...partiel,
    };
  }

  it('rien à traiter : aucune ligne sans aucun objectif', () => {
    const alertes = construireAlertes([], [], [], [], [], [], [], HORIZON_TEST, HORIZON_DLC_TEST);
    expect(alertes.find((a) => a.cle === 'objectif-en-cours')).toBeUndefined();
  });

  it('un objectif « sans_donnee » (piège nommé : PAS la même chose que « manque ») ne produit AUCUNE ligne', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [],
      [],
      [
        objectif({
          id: 'o1',
          evaluation: {
            grandeur: 'chiffre_affaires',
            valeurCible: 500_000,
            realise: null,
            ecart: null,
            avancementBp: null,
            statut: 'sans_donnee',
            periodeTerminee: false,
          },
        }),
      ],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    expect(alertes.find((a) => a.cle === 'objectif-en-cours')).toBeUndefined();
  });

  it('un objectif « atteint » ne produit AUCUNE ligne : rien à faire, plus rien ne change', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [],
      [],
      [
        objectif({
          id: 'o1',
          evaluation: {
            grandeur: 'chiffre_affaires',
            valeurCible: 500_000,
            realise: 600_000,
            ecart: 100_000,
            avancementBp: 12_000,
            statut: 'atteint',
            periodeTerminee: false,
          },
        }),
      ],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    expect(alertes.find((a) => a.cle === 'objectif-en-cours')).toBeUndefined();
  });

  it('un objectif « manque » (période terminée, cible ratée) ne produit AUCUNE ligne : plus d’action possible', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [],
      [],
      [
        objectif({
          id: 'o1',
          evaluation: {
            grandeur: 'chiffre_affaires',
            valeurCible: 500_000,
            realise: 300_000,
            ecart: -200_000,
            avancementBp: 6_000,
            statut: 'manque',
            periodeTerminee: true,
          },
        }),
      ],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    expect(alertes.find((a) => a.cle === 'objectif-en-cours')).toBeUndefined();
  });

  it('un objectif « en_cours » produit une ligne en `alerte`, JAMAIS `depassement` — un objectif poursuivable n’est pas un fait dépassé', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [],
      [],
      [objectif({ id: 'o1' })],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    const ligne = alertes.find((a) => a.cle === 'objectif-en-cours');
    expect(ligne).toBeDefined();
    expect(ligne?.statut).toBe('alerte');
    expect(ligne?.chemin).toBe('/objectifs');
  });

  it('exclut un objectif ANNULÉ et sa contre-écriture d’annulation', () => {
    const alertes = construireAlertes(
      [],
      [],
      [],
      [],
      [],
      [],
      [objectif({ id: 'o1', estAnnule: true }), objectif({ id: 'o2', estAnnulation: true })],
      HORIZON_TEST,
      HORIZON_DLC_TEST,
    );
    expect(alertes.find((a) => a.cle === 'objectif-en-cours')).toBeUndefined();
  });

  it('objectifEnCoursLePlusProche retient celui dont l’échéance est la PLUS PROCHE, jamais le plus récemment créé', () => {
    const loin = objectif({ id: 'loin', dateFin: '2026-12-31' });
    const proche = objectif({ id: 'proche', dateFin: '2026-08-15' });
    expect(objectifEnCoursLePlusProche([loin, proche])?.id).toBe('proche');
    expect(objectifEnCoursLePlusProche([proche, loin])?.id).toBe('proche');
  });

  it('libelleObjectifEnCours dit l’avancement ET le reste à faire, jamais un seul des deux', () => {
    const libelle = libelleObjectifEnCours(objectif({ id: 'o1' }));
    expect(libelle).toContain('Chiffre d’affaires');
    expect(libelle).toContain(formaterPourcent(6_000));
    expect(libelle).toContain(formaterEuros(200_000));
    expect(libelle).toContain('31/07/2026');
  });
});

describe('echeancesDansHorizon — la fonction pure derrière la ligne « échéances »', () => {
  function echeance(partiel: Partial<EcheanceLigneContrat>): EcheanceLigneContrat {
    return {
      id: 'ech-test',
      libelle: 'Listing clients TVA',
      recurrence: 'annuelle',
      prochaineDate: '2027-03-31',
      sourceLegale: 'Code TVA',
      urlSource: null,
      montantEstimeCents: null,
      statut: 'a_venir',
      dateRealisation: null,
      joursAvantEcheance: 20,
      alerteProche: false,
      ...partiel,
    };
  }

  it('borne INCLUSE : à exactement `horizonJours`, l’échéance est retenue', () => {
    const lignes = [echeance({ joursAvantEcheance: 30 })];
    expect(echeancesDansHorizon(lignes, 30)).toHaveLength(1);
    expect(echeancesDansHorizon(lignes, 29)).toHaveLength(0);
  });

  it("ignore `alerteProche` : une echeance non marquee 'proche' par le parametre serveur peut quand meme entrer dans un horizon plus large", () => {
    // `alerteProche` vient du parametre FIXE `echeance_horizon_alerte_jours`
    // (souvent 30 par defaut). A un horizon de 90 jours choisi ICI, une
    // echeance a J+60 doit compter meme si le serveur ne l'a pas marquee
    // "proche" pour son propre horizon fixe.
    const lignes = [echeance({ joursAvantEcheance: 60, alerteProche: false })];
    expect(echeancesDansHorizon(lignes, 90)).toHaveLength(1);
  });
});

/**
 * `construireSignauxDemarrage` — le parcours de premier lancement redéfini
 * comme un ÉTAT DÉRIVÉ (docs/06, correction du 31/07/2026), jamais une case à
 * cocher persistante. Fonction PURE, même convention que `construireAlertes`
 * et `statutSeuil` ci-dessus : c'est elle qui décide, à partir des huit
 * booléens de `EtatDemarrage`, quelles lignes restent à montrer.
 */
function etatDemarrageComplet(partiel: Partial<EtatDemarrage> = {}): EtatDemarrage {
  return {
    aLieu: true,
    aRecette: true,
    aProduitVendable: true,
    aSession: true,
    aIngredient: true,
    aReception: true,
    aRecetteActiveAvecLignes: true,
    aProductionRattacheeSession: true,
    ...partiel,
  };
}

describe('construireSignauxDemarrage — huit signaux, deux natures qui ne se mélangent jamais', () => {
  it('ne retient AUCUN signal quand les huit valent vrai : la liste est vide', () => {
    expect(construireSignauxDemarrage(etatDemarrageComplet())).toEqual([]);
  });

  it('retient les quatre signaux BLOQUANTS sur une base réellement vierge, tous en tête de liste', () => {
    const etat = etatDemarrageComplet({
      aLieu: false,
      aRecette: false,
      aProduitVendable: false,
      aSession: false,
      aIngredient: false,
      aReception: false,
      aRecetteActiveAvecLignes: false,
      aProductionRattacheeSession: false,
    });
    const signaux = construireSignauxDemarrage(etat);

    expect(signaux).toHaveLength(8);
    expect(signaux.slice(0, 4).every((s) => s.nature === 'bloquant')).toBe(true);
    expect(signaux.slice(4).every((s) => s.nature === 'faussant')).toBe(true);
  });

  it('un signal déjà vrai (le chemin minimal absolu : lieu, recette, produit, session) disparaît de la liste, et SEULEMENT lui', () => {
    // Exactement le « chemin minimal absolu »
    // (packages/db/src/chemin-minimal-session.test.ts §5) : les quatre
    // bloquants sont satisfaits, les quatre faussants ne le sont pas encore.
    const etat = etatDemarrageComplet({
      aIngredient: false,
      aReception: false,
      aRecetteActiveAvecLignes: false,
      aProductionRattacheeSession: false,
    });
    const signaux = construireSignauxDemarrage(etat);

    expect(signaux.map((s) => s.cle)).toEqual([
      'aIngredient',
      'aReception',
      'aRecetteActiveAvecLignes',
      'aProductionRattacheeSession',
    ]);
    expect(signaux.every((s) => s.nature === 'faussant')).toBe(true);
  });

  it('chaque signal manquant porte un chemin de navigation non vide', () => {
    const etat = etatDemarrageComplet({ aLieu: false, aReception: false });
    for (const signal of construireSignauxDemarrage(etat)) {
      expect(signal.chemin.startsWith('/')).toBe(true);
    }
  });
});

/**
 * `SectionDemarrage` — LE test le plus important de cette mission : le
 * panneau doit disparaître tout seul dès que les huit signaux sont vrais, et
 * ne jamais afficher de félicitation ni d'émoji quand ce n'est pas encore le
 * cas (docs/07 : ton neutre, jamais professoral).
 *
 * Ce fichier ne monte pas l'écran : comme le reste des tests de cet écran
 * ici, on rend le composant PUR via `renderToStaticMarkup` (react-dom) et on
 * vérifie le balisage réellement produit. Le montage vit dans
 * `TableauDeBord.montage.test.tsx`.
 *
 * CE QUE CES TESTS NE PROUVENT PAS. `renderToStaticMarkup` ne monte rien :
 * aucun `useEffect` ne s'exécute, donc rien ici ne prouve que l'appel réseau
 * réel vers `GET /api/demarrage` alimente correctement cet état une fois
 * l'application ouverte dans un navigateur, ni qu'un clic sur une ligne
 * déclenche réellement `navigate(...)` (la fonction `onNaviguer` est appelée
 * directement dans le test suivant, hors de tout rendu). Seule la DÉCISION
 * de rendu — panneau présent ou absent, contenu du panneau — est vérifiée.
 */
describe('SectionDemarrage — disparaît tout seul, aucun état persistant', () => {
  it('ne rend RIEN quand les huit signaux sont vrais : aucune hauteur, aucune trace dans le balisage', () => {
    const balisage = renderToStaticMarkup(
      <SectionDemarrage
        etat={{ statut: 'pret', etat: etatDemarrageComplet() }}
        onNaviguer={() => {}}
      />,
    );
    expect(balisage).toBe('');
  });

  it('ne rend rien non plus PENDANT le chargement — lecture SQLite locale, aucun indicateur (docs/07 §4.7)', () => {
    const balisage = renderToStaticMarkup(
      <SectionDemarrage etat={{ statut: 'chargement' }} onNaviguer={() => {}} />,
    );
    expect(balisage).toBe('');
  });

  it('réapparaît dès qu’un seul signal redevient faux, avec le bon regroupement bloquant / faussant', () => {
    const balisage = renderToStaticMarkup(
      <SectionDemarrage
        etat={{
          statut: 'pret',
          etat: etatDemarrageComplet({ aLieu: false, aReception: false }),
        }}
        onNaviguer={() => {}}
      />,
    ).replace(/&#x27;/g, "'");

    expect(balisage).toContain('Avant de commencer');
    expect(balisage).toContain('Empêche de clôturer une session');
    expect(balisage).toContain('Aucun lieu de marché');
    expect(balisage).toContain('Fausse les chiffres affichés');
    expect(balisage).toContain('Aucune réception');

    // Aucun ton professoral, aucune félicitation, aucun émoji (docs/07 §4.8) —
    // et rien qui suggère qu'une étape serait « faite » : seul ce qui manque
    // encore apparaît.
    expect(balisage).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(balisage.toLowerCase()).not.toContain('bravo');
    expect(balisage.toLowerCase()).not.toContain('félicit');
    expect(balisage).not.toContain('Aucun produit vendable');
    expect(balisage).not.toContain('Aucune recette active');
  });

  it('un clic sur une ligne appelle `onNaviguer` avec le chemin exact du signal, jamais un chemin générique', () => {
    // `onNaviguer` n'est pas déclenché par `renderToStaticMarkup` (aucun
    // gestionnaire d'événement ne s'exécute dans un rendu statique) : ce
    // test appelle directement la fonction pure qui décide du chemin, preuve
    // que CHAQUE ligne mène quelque part de précis plutôt que vers un chemin
    // partagé générique.
    const signaux = construireSignauxDemarrage(
      etatDemarrageComplet({ aLieu: false, aIngredient: false }),
    );
    const chemins = signaux.map((s) => s.chemin);
    expect(chemins).toEqual(['/lieux', '/ingredients']);
    expect(new Set(chemins).size).toBe(chemins.length);
  });
});

/**
 * D-082 (`docs/05-DECISIONS.md`) : avant ce correctif, `SectionPrevision`
 * n'avait AUCUNE branche pour l'erreur `premier_passage_lieu` — elle tombait
 * dans le `catch` générique de l'effet qui charge `/prevision` et
 * `etatPrevision` finissait à `{ statut: 'erreur' }`, rendu par l'encadré
 * `role="alert"` rouge juste en dessous dans le composant. Or « premier
 * passage » est un état NORMAL et attendu (le porteur l'a choisi
 * exprès) : l'afficher en rouge apprend à l'utilisateur à voir du rouge là
 * où tout va bien.
 *
 * Ces tests vérifient la DÉCISION de rendu par balisage statique (même
 * technique que `SectionDemarrage` ci-dessus, CLAUDE.md §7). CE QU'ILS NE
 * PROUVENT PAS : que l'effet `useEffect` de `TableauDeBord` (fichier source,
 * non exporté) route bien le code HTTP `premier_passage_lieu` vers
 * `{ statut: 'premier_passage' }` — cette traduction n'est pas extraite en
 * fonction pure ici (contrairement à `etatDepuisErreurPrevision` dans
 * `ProchaineSession.tsx`), donc seule une lecture du code source
 * (`apps/web/src/pages/TableauDeBord.tsx`, le `.catch` de l'effet
 * `/prevision`) garantit ce câblage, pas ces tests.
 */
describe('SectionPrevision — « premier passage » (D-082) n’est jamais un encadré d’erreur', () => {
  it('rend un encadré INFORMATIF pour « premier passage », jamais `role="alert"` ni les classes rouges de l’état erreur', () => {
    const balisage = renderToStaticMarkup(
      <SectionPrevision
        etat={{
          statut: 'premier_passage',
          message:
            'Premier passage à Foire de Machin : aucune session n’y a encore été close, ' +
            'donc aucune prévision de production n’est possible (décision D-082).',
        }}
        onVoirDetail={() => {}}
        onCreerSession={() => {}}
      />,
    );

    expect(balisage).toContain('Premier passage : aucune prévision possible');
    expect(balisage).toContain('Foire de Machin');
    expect(balisage).not.toContain('role="alert"');
    expect(balisage).not.toContain('text-depassement');
    expect(balisage).not.toContain('bg-depassement-bg');
  });

  /**
   * INVERSÉ le 01/08/2026 (composant `EncartErreur` introduit le même jour,
   * `apps/web/src/composants/EncartErreur.tsx`) : ce test verrouillait la
   * convention qui a produit le défaut constaté en conditions réelles — un
   * encart en échec de chargement perdait son TITRE, remplacé par un bandeau
   * rouge nu (« Seuils légaux » / « À traiter » disparaissaient entièrement).
   * `text-depassement`/`bg-depassement-bg` décrivaient le bon comportement au
   * moment où ce test a été écrit ; ils décrivent le mauvais aujourd'hui — la
   * réponse à « ce test décrit-il encore le bon comportement ? » est
   * « non ». `role="alert"` reste légitime, lui : c'est `EncartErreur` qui
   * doit le porter, avec le TITRE du panneau conservé (`<h2>`), jamais les
   * couleurs du registre d'alerte MÉTIER — une panne technique n'annonce pas
   * une rupture de stock (docs/07 §4.8, `EncartErreur.tsx`).
   */
  it('rend `role="alert"` avec le TITRE du panneau conservé, jamais les classes du registre d’alerte métier (contraste, non-régression)', () => {
    const balisage = renderToStaticMarkup(
      <SectionPrevision
        etat={{ statut: 'erreur', message: 'La prévision n’a pas pu être calculée.' }}
        onVoirDetail={() => {}}
        onCreerSession={() => {}}
      />,
    );

    expect(balisage).toContain('role="alert"');
    expect(balisage).toContain('<h2');
    expect(balisage).toContain('Prochaine session');
    expect(balisage).toContain('La prévision n’a pas pu être calculée.');
    expect(balisage).not.toContain('text-depassement');
    expect(balisage).not.toContain('bg-depassement-bg');
  });

  it('« premier passage » et « erreur » produisent des balisages visuellement distincts (aucune troisième convention qui les confondrait)', () => {
    const balisagePremierPassage = renderToStaticMarkup(
      <SectionPrevision
        etat={{ statut: 'premier_passage', message: 'Premier passage.' }}
        onVoirDetail={() => {}}
        onCreerSession={() => {}}
      />,
    );
    const balisageErreur = renderToStaticMarkup(
      <SectionPrevision
        etat={{ statut: 'erreur', message: 'Erreur.' }}
        onVoirDetail={() => {}}
        onCreerSession={() => {}}
      />,
    );

    expect(balisagePremierPassage).not.toBe(balisageErreur);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Palmarès — formatage par critère et rendu du groupe (mission « palmarès »)
   ═══════════════════════════════════════════════════════════════════════════ */

function ligneProduit(
  partiel: Partial<LigneClassementProduitContrat> & { produitVenteId: string },
): LigneClassementProduitContrat {
  return {
    nom: partiel.produitVenteId,
    nature: 'transforme',
    volumeVendu: 0,
    caGenereCents: 0,
    margeTotaleGenereeCents: null,
    margeUnitaireMoyenneCents: null,
    margeParMinuteCuissonCents: null,
    raisonMargeParMinuteCuissonIndisponible: 'Nécessite un temps de cuisson par recette.',
    ...partiel,
  };
}

function ligneFournisseur(
  partiel: Partial<LigneClassementFournisseurContrat> & { fournisseurId: string },
): LigneClassementFournisseurContrat {
  return {
    nom: partiel.fournisseurId,
    economieGenereeCents: 0,
    fiabiliteFacturationBp: null,
    nbFacturesConsiderees: 0,
    prixComparableEcartBp: null,
    nbIngredientsComparables: 0,
    delaiLivraisonJours: null,
    qualiteProduitScore: null,
    ...partiel,
  };
}

describe('formaterValeurCritereProduit', () => {
  it('affiche la marge totale en euros', () => {
    expect(
      formaterValeurCritereProduit(
        ligneProduit({ produitVenteId: 'p1', margeTotaleGenereeCents: 1234 }),
        'marge_totale',
      ),
    ).toBe(formaterEuros(1234));
  });

  it('affiche le tiret d’absence quand la marge totale est inconnue — jamais 0,00 €', () => {
    expect(
      formaterValeurCritereProduit(
        ligneProduit({ produitVenteId: 'p1', margeTotaleGenereeCents: null }),
        'marge_totale',
      ),
    ).toBe(TIRET_ABSENT);
  });

  it('affiche le volume vendu en nombre brut, sans unité dans la cellule', () => {
    expect(
      formaterValeurCritereProduit(
        ligneProduit({ produitVenteId: 'p1', volumeVendu: 42 }),
        'volume_vendu',
      ),
    ).toBe('42');
  });

  it('« marge par minute de cuisson » affiche toujours le tiret : aucune valeur n’existe aujourd’hui', () => {
    expect(
      formaterValeurCritereProduit(
        ligneProduit({ produitVenteId: 'p1' }),
        'marge_par_minute_cuisson',
      ),
    ).toBe(TIRET_ABSENT);
  });
});

describe('formaterValeurCritereFournisseur', () => {
  it('affiche l’économie générée en euros, jamais un tiret (toujours connue, éventuellement nulle)', () => {
    expect(
      formaterValeurCritereFournisseur(
        ligneFournisseur({ fournisseurId: 'f1', economieGenereeCents: 500 }),
        'economie_generee',
      ),
    ).toBe(formaterEuros(500));
  });

  it('affiche le tiret quand la fiabilité de facturation est inconnue (aucune facture sur la période)', () => {
    expect(
      formaterValeurCritereFournisseur(
        ligneFournisseur({ fournisseurId: 'f1', fiabiliteFacturationBp: null }),
        'fiabilite_facturation',
      ),
    ).toBe(TIRET_ABSENT);
  });

  it('délai de livraison et qualité produit affichent toujours le tiret : hors de portée aujourd’hui', () => {
    const ligne = ligneFournisseur({ fournisseurId: 'f1' });
    expect(formaterValeurCritereFournisseur(ligne, 'delai_livraison')).toBe(TIRET_ABSENT);
    expect(formaterValeurCritereFournisseur(ligne, 'qualite_produit')).toBe(TIRET_ABSENT);
  });
});

describe('BlocGroupePalmaresProduits', () => {
  function groupe(partiel: Partial<GroupePalmaresProduitsContrat>): GroupePalmaresProduitsContrat {
    return {
      nature: 'transforme',
      lignes: [],
      echantillonSuffisant: true,
      raisonEchantillonInsuffisant: null,
      divergenceVenteRentabilite: null,
      ...partiel,
    };
  }

  it('échantillon insuffisant : affiche la raison servie par l’API, jamais un classement', () => {
    const balisage = renderToStaticMarkup(
      <BlocGroupePalmaresProduits
        groupe={groupe({
          echantillonSuffisant: false,
          raisonEchantillonInsuffisant:
            '2 sessions closes sur la période — moins que le minimum de 4.',
        })}
        critere="marge_totale"
      />,
    );
    expect(balisage).toContain('2 sessions closes sur la période');
    expect(balisage).toContain('Crêpes (transformé)');
  });

  it('« marge par minute de cuisson » affiche la raison TRANSFORMÉ, jamais un classement, même avec des lignes vendues', () => {
    const balisage = renderToStaticMarkup(
      <BlocGroupePalmaresProduits
        groupe={groupe({
          lignes: [ligneProduit({ produitVenteId: 'p1', nom: 'Crêpe test', volumeVendu: 10 })],
        })}
        critere="marge_par_minute_cuisson"
      />,
    );
    expect(balisage).toContain('Nécessite un temps de cuisson par recette');
    expect(balisage).not.toContain('Crêpe test');
  });

  it('« marge par minute de cuisson » sur le groupe REVENDU affiche la raison « sans objet », distincte de celle du transformé', () => {
    const balisage = renderToStaticMarkup(
      <BlocGroupePalmaresProduits
        groupe={groupe({ nature: 'revendu' })}
        critere="marge_par_minute_cuisson"
      />,
    );
    expect(balisage).toContain('Sans objet');
    expect(balisage).not.toContain('Nécessite un temps de cuisson par recette');
  });

  it('rend les trois premières lignes du classement, triées par le critère, jamais plus', () => {
    const balisage = renderToStaticMarkup(
      <BlocGroupePalmaresProduits
        groupe={groupe({
          lignes: [
            ligneProduit({
              produitVenteId: 'a',
              nom: 'A',
              volumeVendu: 10,
              margeTotaleGenereeCents: 100,
            }),
            ligneProduit({
              produitVenteId: 'b',
              nom: 'B',
              volumeVendu: 40,
              margeTotaleGenereeCents: 900,
            }),
            ligneProduit({
              produitVenteId: 'c',
              nom: 'C',
              volumeVendu: 30,
              margeTotaleGenereeCents: 500,
            }),
            ligneProduit({
              produitVenteId: 'd',
              nom: 'D',
              volumeVendu: 20,
              margeTotaleGenereeCents: 200,
            }),
          ],
        })}
        critere="marge_totale"
      />,
    );
    // Trié par marge totale décroissante : B (900) > C (500) > D (200) > A (100).
    // Les trois premiers sont donc B, C, D — A, le moins rentable, est exclu.
    expect(balisage).toContain('>B<');
    expect(balisage).toContain('>C<');
    expect(balisage).toContain('>D<');
    expect(balisage).not.toContain('>A<');
  });

  it('affiche la divergence vente/marge quand le serveur en a détecté une, jamais quand elle vaut `null`', () => {
    const avecDivergence = renderToStaticMarkup(
      <BlocGroupePalmaresProduits
        groupe={groupe({
          lignes: [
            ligneProduit({
              produitVenteId: 'a',
              nom: 'A',
              volumeVendu: 10,
              margeTotaleGenereeCents: 100,
            }),
          ],
          divergenceVenteRentabilite: {
            nature: 'transforme',
            nomPlusVendu: 'Crêpe nature',
            nomPlusRentable: 'Crêpe Nutella',
          },
        })}
        critere="marge_totale"
      />,
    );
    expect(avecDivergence).toContain('Crêpe nature');
    expect(avecDivergence).toContain('Crêpe Nutella');
    expect(avecDivergence).toContain('n’est pas le');

    const sansDivergence = renderToStaticMarkup(
      <BlocGroupePalmaresProduits
        groupe={groupe({
          lignes: [
            ligneProduit({
              produitVenteId: 'a',
              nom: 'A',
              volumeVendu: 10,
              margeTotaleGenereeCents: 100,
            }),
          ],
        })}
        critere="marge_totale"
      />,
    );
    expect(sansDivergence).not.toContain('n’est pas le');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Meilleurs lieux de marché — mission « finir le tableau de bord »
   ═══════════════════════════════════════════════════════════════════════════ */

describe('meilleursLieux — jamais un lieu jamais visité (D-082)', () => {
  function ligneLieu(
    partiel: Partial<LigneComparaisonLieu> & { lieuId: string },
  ): LigneComparaisonLieu {
    return {
      lieuNom: partiel.lieuId,
      distanceKm: 10,
      crepesPrevuesBaseline: 120,
      nbSessionsRetenues: 5,
      poidsPriorBp: 0,
      fiabilite: 'fiable',
      explicationBaseline: 'test',
      caAttenduCents: 100_000,
      coutMatiereAttenduCents: 10_000,
      coutGazAttenduCents: 1_000,
      coutEmplacementCents: 2_000,
      coutEmplacementIndisponibleRaison: null,
      coutDeplacementCents: 3_000,
      margeNetteAttendueCents: 80_000,
      ...partiel,
    };
  }

  it('cas vide : aucun lieu à comparer', () => {
    expect(meilleursLieux([])).toEqual([]);
  });

  it('exclut un lieu JAMAIS VISITÉ même si sa marge attendue n’est pas `null`', () => {
    // Exactement le piège D-082 : `nbSessionsRetenues === 0` retombe sur le
    // prior de baseline, qui produit un chiffre NON NUL mais inventé.
    const lignes = [
      ligneLieu({
        lieuId: 'jamais-visite',
        nbSessionsRetenues: 0,
        margeNetteAttendueCents: 999_999,
      }),
      ligneLieu({ lieuId: 'visite', nbSessionsRetenues: 3, margeNetteAttendueCents: 50_000 }),
    ];
    const meilleurs = meilleursLieux(lignes);
    expect(meilleurs.map((l) => l.lieuId)).toEqual(['visite']);
  });

  it('exclut un lieu visité dont la marge reste incalculable (`null`)', () => {
    const lignes = [
      ligneLieu({ lieuId: 'sans-marge', margeNetteAttendueCents: null }),
      ligneLieu({ lieuId: 'avec-marge', margeNetteAttendueCents: 50_000 }),
    ];
    const meilleurs = meilleursLieux(lignes);
    expect(meilleurs.map((l) => l.lieuId)).toEqual(['avec-marge']);
  });

  it('ne retient que les trois premiers, dans l’ordre déjà trié par le serveur', () => {
    const lignes = [
      ligneLieu({ lieuId: 'a', margeNetteAttendueCents: 400 }),
      ligneLieu({ lieuId: 'b', margeNetteAttendueCents: 300 }),
      ligneLieu({ lieuId: 'c', margeNetteAttendueCents: 200 }),
      ligneLieu({ lieuId: 'd', margeNetteAttendueCents: 100 }),
    ];
    expect(meilleursLieux(lignes).map((l) => l.lieuId)).toEqual(['a', 'b', 'c']);
  });

  it('cas vide : tous les lieux existants sont soit jamais visités, soit sans marge connue', () => {
    const lignes = [
      ligneLieu({ lieuId: 'jamais-visite', nbSessionsRetenues: 0 }),
      ligneLieu({ lieuId: 'sans-marge', margeNetteAttendueCents: null }),
    ];
    expect(meilleursLieux(lignes)).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Écart prévu/réalisé — colonne de « Dernières sessions »
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ecartPrevuRealisePourSession', () => {
  function prevision(partiel: Partial<PrevisionArchivee> & { id: string }): PrevisionArchivee {
    return {
      dateCalcul: '2026-07-01T08:00:00.000Z',
      versionModele: 'test',
      sessionId: null,
      sessionNumero: null,
      dateSession: null,
      p50Crepes: 100,
      crepesRecommandees: 100,
      crepesRetenues: 100,
      crepesReelles: null,
      erreurAbsolueBp: null,
      confianceBp: 5_000,
      ...partiel,
    };
  }

  it('rend `null` sans aucune prévision archivée pour cette session', () => {
    expect(ecartPrevuRealisePourSession([], 'session-1')).toBeNull();
  });

  it('rend `null` quand une prévision existe pour la session mais n’a jamais été rapprochée', () => {
    const previsions = [prevision({ id: 'p1', sessionId: 'session-1', erreurAbsolueBp: null })];
    expect(ecartPrevuRealisePourSession(previsions, 'session-1')).toBeNull();
  });

  it('rend l’erreur absolue déjà calculée, jamais recalculée ici', () => {
    const previsions = [prevision({ id: 'p1', sessionId: 'session-1', erreurAbsolueBp: 1_234 })];
    expect(ecartPrevuRealisePourSession(previsions, 'session-1')).toBe(1_234);
  });

  it('ignore les prévisions d’une AUTRE session', () => {
    const previsions = [prevision({ id: 'p1', sessionId: 'session-2', erreurAbsolueBp: 1_234 })];
    expect(ecartPrevuRealisePourSession(previsions, 'session-1')).toBeNull();
  });

  it('prend la PREMIÈRE prévision trouvée pour la session (liste déjà triée du plus récent au plus ancien par le serveur)', () => {
    const previsions = [
      prevision({ id: 'plus-recente', sessionId: 'session-1', erreurAbsolueBp: 500 }),
      prevision({ id: 'plus-ancienne', sessionId: 'session-1', erreurAbsolueBp: 9_000 }),
    ];
    expect(ecartPrevuRealisePourSession(previsions, 'session-1')).toBe(500);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Budget IA — pied de page discret
   ═══════════════════════════════════════════════════════════════════════════ */

describe('phrasePiedBudgetIa', () => {
  // Plafond/reste à cents NON RONDS (12,34 € plutôt que 20,00 €) : un montant
  // qui se termine par « 00 » contient TOUJOURS la sous-chaîne de
  // `formaterEuros(0)` (« 0,00 € ») — « 20,00 € » contient « 0,00 € » à partir
  // de son second caractère. Sans ce choix, l'assertion « ne contient pas
  // 0,00 € » ci-dessous serait un faux négatif structurel, pas une preuve.
  function etatIa(partiel: Partial<EtatIa>): EtatIa {
    return {
      configuree: true,
      plafondMensuelCents: 1_234,
      depenseDuMoisCents: 0,
      resteCents: 1_234,
      nbAppelsDuMois: 0,
      ...partiel,
    };
  }

  it('mode dégradé : assistance non configurée, jamais un chiffre de dépense affiché', () => {
    const phrase = phrasePiedBudgetIa(etatIa({ configuree: false }));
    expect(phrase).toContain('non configurée');
    expect(phrase).not.toContain(formaterEuros(1_234));
  });

  it('distingue « aucun appel journalisé » de « 0,00 € dépensés » — jamais confondus', () => {
    const phrase = phrasePiedBudgetIa(etatIa({ nbAppelsDuMois: 0, depenseDuMoisCents: 0 }));
    expect(phrase).toContain('aucun appel journalisé');
    expect(phrase).not.toContain(formaterEuros(0));
  });

  it('affiche le montant réel dès qu’au moins un appel a été journalisé, même à 0,00 €', () => {
    const phrase = phrasePiedBudgetIa(
      etatIa({ nbAppelsDuMois: 1, depenseDuMoisCents: 0, resteCents: 1_234 }),
    );
    expect(phrase).toContain(formaterEuros(0));
    expect(phrase).not.toContain('aucun appel journalisé');
  });

  it('affiche plafond, dépense et reste — trois chiffres, jamais un seul', () => {
    const phrase = phrasePiedBudgetIa(
      etatIa({
        plafondMensuelCents: 5_000,
        depenseDuMoisCents: 1_200,
        resteCents: 3_800,
        nbAppelsDuMois: 3,
      }),
    );
    expect(phrase).toContain(formaterEuros(5_000));
    expect(phrase).toContain(formaterEuros(1_200));
    expect(phrase).toContain(formaterEuros(3_800));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Demande projetée (besoins projetés, huitième élément) — le garde-fou
   d'exploitabilité repris de `PrevisionCalendaire.tsx`
   ═══════════════════════════════════════════════════════════════════════════ */

describe('demandeProjeteeFiable — ne somme QUE les semaines dont tous les jours sont exploitables', () => {
  function jour(exploitable: boolean): JourCalendaire {
    return {
      dateSession: '2026-08-03',
      lieuNom: 'La Batte',
      sessionId: null,
      horizonJours: 3,
      bandeHorizon: 'fiable',
      confianceHorizonBp: 8_000,
      exploitable,
      demandeAttendue: 30,
      p10: 25,
      p50: 30,
      p90: 35,
      crepesRecommandees: 30,
      evenements: [],
    };
  }

  function semaine(
    crepesPrevues: number,
    joursExploitables: readonly boolean[],
  ): SemaineCalendaire {
    return {
      debutSemaine: '2026-08-03',
      finSemaine: '2026-08-09',
      crepesPrevues,
      jours: joursExploitables.map(jour),
      besoinsIngredients: [],
    };
  }

  it('cas vide : aucune semaine', () => {
    expect(demandeProjeteeFiable([])).toEqual({
      totalCrepes: 0,
      nbSemainesFiables: 0,
      nbSemainesTotal: 0,
    });
  });

  it('somme les semaines dont TOUS les jours sont exploitables', () => {
    const resultat = demandeProjeteeFiable([
      semaine(176, [true, true, true]),
      semaine(160, [true, true, true]),
    ]);
    expect(resultat).toEqual({ totalCrepes: 336, nbSemainesFiables: 2, nbSemainesTotal: 2 });
  });

  it('EXCLUT une semaine dont UN SEUL jour est inexploitable — même si `crepesPrevues` porte une valeur', () => {
    // Exactement le défaut documenté dans `PrevisionCalendaire.tsx`
    // (`SemainePanneau`, `tousLesJoursExploitables`) : le CALCUL ne retire pas
    // encore lui-même la contribution d'un jour inexploitable de ce champ.
    const resultat = demandeProjeteeFiable([
      semaine(176, [true, true, true]),
      semaine(999, [true, false, true]),
    ]);
    expect(resultat).toEqual({ totalCrepes: 176, nbSemainesFiables: 1, nbSemainesTotal: 2 });
  });

  it('total à zéro et aucune semaine fiable quand TOUTES les semaines ont un jour inexploitable', () => {
    const resultat = demandeProjeteeFiable([semaine(999, [false, true])]);
    expect(resultat).toEqual({ totalCrepes: 0, nbSemainesFiables: 0, nbSemainesTotal: 1 });
  });
});

describe('phraseDemandeProjetee — jamais un total qui tairait son incomplétude', () => {
  it('dit explicitement la projection trop incertaine quand aucune semaine n’est fiable', () => {
    const phrase = phraseDemandeProjetee(
      { totalCrepes: 0, nbSemainesFiables: 0, nbSemainesTotal: 2 },
      '30 j',
    );
    expect(phrase).toContain('trop incertaine');
    // Aucun total chiffré (le signe « ≈ » n'introduit un nombre que dans les
    // deux autres branches) : une projection incertaine ne doit jamais
    // laisser passer un chiffre qui se prétendrait solide.
    expect(phrase).not.toContain('≈');
  });

  it('affiche le total SANS réserve quand toutes les semaines sont fiables', () => {
    const phrase = phraseDemandeProjetee(
      { totalCrepes: 663, nbSemainesFiables: 4, nbSemainesTotal: 4 },
      '30 j',
    );
    expect(phrase).toContain('663');
    expect(phrase).toContain('30 j');
    expect(phrase).not.toContain('fiable');
  });

  it('signale le nombre de semaines fiables quand la couverture est PARTIELLE — jamais un total silencieux sur son incomplétude', () => {
    const phrase = phraseDemandeProjetee(
      { totalCrepes: 176, nbSemainesFiables: 1, nbSemainesTotal: 2 },
      '15 j',
    );
    expect(phrase).toContain('176');
    expect(phrase).toContain('1 semaine fiable sur 2');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Concurrents — mouvements de prix (mission « la case concurrents »,
   01/08/2026) : « stable » (0 vérifié) ≠ « nouveau » (inconnu, jamais 0) ≠
   « hausse »/« baisse » (mouvement réel) — voir la documentation de tête de
   `SectionMouvementsConcurrents` dans `TableauDeBord.tsx`.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Fixture par défaut : un mouvement RÉEL (hausse), toutes les dates et tous
 * les montants renseignés. Chaque test override explicitement ce qui le
 * distingue — jamais une fixture dégénérée où tout vaudrait le même statut. */
function mouvement(
  partiel: Partial<MouvementPrixConcurrent> & {
    concurrentId: string;
    nomProduit: string;
  },
): MouvementPrixConcurrent {
  return {
    concurrentNom: partiel.concurrentId,
    statut: 'hausse',
    prixCents: 350,
    prixPrecedentCents: 300,
    ecartCents: 50,
    ecartBp: 1_667,
    dateObservation: '2026-07-28',
    dateObservationPrecedente: '2026-07-20',
    ...partiel,
  };
}

describe('resumeMouvementsConcurrents — décompte de CONCURRENTS distincts, jamais de lignes produit', () => {
  it('cas vide : aucun mouvement', () => {
    expect(resumeMouvementsConcurrents([])).toEqual({
      nbConcurrentsHausse: 0,
      nbConcurrentsBaisse: 0,
    });
  });

  it('un même concurrent qui augmente DEUX produits ne compte qu’UNE fois — le piège nommé par le porteur', () => {
    // Fixture qui DISCRIMINE réellement le défaut : si l'implémentation
    // comptait des LIGNES au lieu de concurrents, ce test verrait 2, pas 1.
    const mouvements = [
      mouvement({ concurrentId: 'concurrent-a', nomProduit: 'Crêpe nature', statut: 'hausse' }),
      mouvement({ concurrentId: 'concurrent-a', nomProduit: 'Crêpe Nutella', statut: 'hausse' }),
    ];
    expect(resumeMouvementsConcurrents(mouvements)).toEqual({
      nbConcurrentsHausse: 1,
      nbConcurrentsBaisse: 0,
    });
  });

  it('compte hausse et baisse INDÉPENDAMMENT, sur des concurrents différents', () => {
    const mouvements = [
      mouvement({ concurrentId: 'concurrent-a', nomProduit: 'p1', statut: 'hausse' }),
      mouvement({ concurrentId: 'concurrent-b', nomProduit: 'p1', statut: 'baisse' }),
      mouvement({ concurrentId: 'concurrent-c', nomProduit: 'p1', statut: 'stable' }),
      mouvement({
        concurrentId: 'concurrent-d',
        nomProduit: 'p1',
        statut: 'nouveau',
        prixPrecedentCents: null,
        ecartCents: null,
        ecartBp: null,
        dateObservationPrecedente: null,
      }),
    ];
    expect(resumeMouvementsConcurrents(mouvements)).toEqual({
      nbConcurrentsHausse: 1,
      nbConcurrentsBaisse: 1,
    });
  });

  it('un concurrent en hausse ET en baisse sur deux produits différents compte dans LES DEUX décomptes', () => {
    const mouvements = [
      mouvement({ concurrentId: 'concurrent-a', nomProduit: 'p1', statut: 'hausse' }),
      mouvement({ concurrentId: 'concurrent-a', nomProduit: 'p2', statut: 'baisse' }),
    ];
    expect(resumeMouvementsConcurrents(mouvements)).toEqual({
      nbConcurrentsHausse: 1,
      nbConcurrentsBaisse: 1,
    });
  });
});

describe('phraseResumeMouvementsConcurrents — proche mot pour mot de la demande du porteur', () => {
  it('rend `null` quand ni hausse ni baisse', () => {
    expect(
      phraseResumeMouvementsConcurrents({ nbConcurrentsHausse: 0, nbConcurrentsBaisse: 0 }),
    ).toBeNull();
  });

  it('accorde au singulier pour un seul concurrent en hausse', () => {
    const phrase = phraseResumeMouvementsConcurrents({
      nbConcurrentsHausse: 1,
      nbConcurrentsBaisse: 0,
    });
    expect(phrase).toBe('1 concurrent a augmenté ses prix depuis leur dernier relevé.');
  });

  it('accorde au pluriel dès deux concurrents en hausse — exactement la phrase du porteur', () => {
    const phrase = phraseResumeMouvementsConcurrents({
      nbConcurrentsHausse: 2,
      nbConcurrentsBaisse: 0,
    });
    expect(phrase).toBe('2 concurrents ont augmenté leurs prix depuis leur dernier relevé.');
  });

  it('combine hausse ET baisse dans la même phrase quand les deux existent', () => {
    const phrase = phraseResumeMouvementsConcurrents({
      nbConcurrentsHausse: 2,
      nbConcurrentsBaisse: 1,
    });
    expect(phrase).toContain('2 concurrents ont augmenté leurs prix');
    expect(phrase).toContain('1 concurrent a baissé ses prix');
  });
});

describe('compterMouvementsParStatut — compte des LIGNES produit, par statut', () => {
  it('cas vide : les quatre compteurs à zéro, jamais `undefined`', () => {
    expect(compterMouvementsParStatut([])).toEqual({
      hausse: 0,
      baisse: 0,
      stable: 0,
      nouveau: 0,
    });
  });

  it('compte chaque statut séparément, y compris plusieurs lignes du même concurrent', () => {
    const mouvements = [
      mouvement({ concurrentId: 'a', nomProduit: 'p1', statut: 'hausse' }),
      mouvement({ concurrentId: 'a', nomProduit: 'p2', statut: 'hausse' }),
      mouvement({ concurrentId: 'b', nomProduit: 'p1', statut: 'baisse' }),
      mouvement({
        concurrentId: 'c',
        nomProduit: 'p1',
        statut: 'stable',
        ecartCents: 0,
        ecartBp: 0,
      }),
      mouvement({
        concurrentId: 'd',
        nomProduit: 'p1',
        statut: 'nouveau',
        prixPrecedentCents: null,
        ecartCents: null,
        ecartBp: null,
        dateObservationPrecedente: null,
      }),
    ];
    // Ici, contrairement à `resumeMouvementsConcurrents`, les DEUX lignes
    // hausse du concurrent « a » comptent bien pour 2 : c'est un compte de
    // lignes produit, pas de concurrents.
    expect(compterMouvementsParStatut(mouvements)).toEqual({
      hausse: 2,
      baisse: 1,
      stable: 1,
      nouveau: 1,
    });
  });
});

describe('phraseEnTeteMouvementsConcurrents — « rien n’a bougé » et « rien à comparer » ne sont PAS la même phrase', () => {
  it('reprend le résumé hausse/baisse quand au moins un mouvement réel existe', () => {
    const mouvements = [mouvement({ concurrentId: 'a', nomProduit: 'p1', statut: 'hausse' })];
    expect(phraseEnTeteMouvementsConcurrents(mouvements)).toBe(
      '1 concurrent a augmenté ses prix depuis leur dernier relevé.',
    );
  });

  it('« tout stable » : au moins un `stable`, aucun hausse/baisse → « Aucun prix n’a bougé », une information VÉRIFIÉE', () => {
    const mouvements = [
      mouvement({
        concurrentId: 'a',
        nomProduit: 'p1',
        statut: 'stable',
        ecartCents: 0,
        ecartBp: 0,
      }),
      mouvement({
        concurrentId: 'b',
        nomProduit: 'p1',
        statut: 'stable',
        ecartCents: 0,
        ecartBp: 0,
      }),
    ];
    expect(phraseEnTeteMouvementsConcurrents(mouvements)).toBe(
      'Aucun prix n’a bougé depuis le dernier relevé.',
    );
  });

  it('« tout nouveau » : AUCUN stable, aucun hausse/baisse → « Rien à comparer », jamais la même phrase que « tout stable »', () => {
    // Piège nommé explicitement par la mission : un `nouveau` n'est pas un
    // `stable` déguisé. Une fixture où TOUT vaudrait `nouveau` serait
    // dégénérée si elle ne prouvait que ça — elle est comparée ICI, dans le
    // même describe, au cas « tout stable » ci-dessus, pour vérifier que les
    // deux phrases sont bien DISTINCTES.
    const mouvements = [
      mouvement({
        concurrentId: 'a',
        nomProduit: 'p1',
        statut: 'nouveau',
        prixPrecedentCents: null,
        ecartCents: null,
        ecartBp: null,
        dateObservationPrecedente: null,
      }),
    ];
    const phrase = phraseEnTeteMouvementsConcurrents(mouvements);
    expect(phrase).toBe('Rien à comparer pour l’instant : uniquement des premiers relevés.');
    expect(phrase).not.toBe('Aucun prix n’a bougé depuis le dernier relevé.');
  });
});

describe('phraseDetailStableEtNouveau — la mention agrégée qui empêche de PERDRE stable/nouveau', () => {
  it('rend `null` quand les deux compteurs sont nuls (rien à ajouter à l’en-tête)', () => {
    expect(phraseDetailStableEtNouveau({ hausse: 3, baisse: 1, stable: 0, nouveau: 0 })).toBeNull();
  });

  it('mentionne le compte `stable`, accordé au pluriel', () => {
    const phrase = phraseDetailStableEtNouveau({ hausse: 0, baisse: 0, stable: 2, nouveau: 0 });
    expect(phrase).toContain('2 produits sans changement');
  });

  it('mentionne le compte `nouveau` en clarifiant que ce n’est PAS comparable — jamais « 0 » ni « stable »', () => {
    const phrase = phraseDetailStableEtNouveau({ hausse: 0, baisse: 0, stable: 0, nouveau: 1 });
    expect(phrase).toContain('1 premier relevé');
    expect(phrase).toContain('rien à comparer encore');
    expect(phrase).not.toContain('sans changement');
  });

  it('joint les deux mentions quand stable ET nouveau coexistent', () => {
    const phrase = phraseDetailStableEtNouveau({ hausse: 1, baisse: 0, stable: 3, nouveau: 2 });
    expect(phrase).toContain('3 produits sans changement');
    expect(phrase).toContain('2 premiers relevés');
  });
});

describe('titreMouvementConcurrent — l’infobulle ne fabrique jamais une comparaison depuis zéro', () => {
  it('mouvement réel : nomme l’ancien prix, sa date, et la durée réelle via `joursEntre` (jamais réécrite)', () => {
    const m = mouvement({
      concurrentId: 'a',
      concurrentNom: 'Crêperie du Quai',
      nomProduit: 'Crêpe nature',
      statut: 'hausse',
      prixCents: 350,
      prixPrecedentCents: 300,
      dateObservation: '2026-07-28',
      dateObservationPrecedente: '2026-07-20',
    });
    const titre = titreMouvementConcurrent(m);
    expect(titre).toContain('Crêperie du Quai');
    expect(titre).toContain('Crêpe nature');
    expect(titre).toContain(formaterEuros(350));
    expect(titre).toContain(formaterEuros(300));
    expect(titre).toContain(formaterDate('2026-07-20'));
    // La durée vient de `joursEntre`, jamais recalculée à la main ici.
    const joursAttendus = joursEntre('2026-07-20', '2026-07-28');
    expect(titre).toContain(`${joursAttendus} jour`);
  });

  it('« nouveau » : dit explicitement « premier relevé », ne mentionne AUCUNE durée ni ancien prix, et n’affiche jamais 0,00 €', () => {
    const m = mouvement({
      concurrentId: 'a',
      concurrentNom: 'Le Comptoir Sucré',
      nomProduit: 'Gaufre de Liège',
      statut: 'nouveau',
      prixCents: 400,
      prixPrecedentCents: null,
      ecartCents: null,
      ecartBp: null,
      dateObservationPrecedente: null,
      dateObservation: '2026-07-28',
    });
    const titre = titreMouvementConcurrent(m);
    expect(titre).toContain('premier relevé');
    expect(titre).toContain(formaterEuros(400));
    expect(titre).not.toContain('jour');
    expect(titre).not.toContain('était');
    // Le piège central de la mission : `null` ne doit JAMAIS se lire « 0 € ».
    expect(titre).not.toContain(formaterEuros(0));
  });
});

describe('SectionMouvementsConcurrents — les quatre cas, rendus (renderToStaticMarkup, CLAUDE.md §7)', () => {
  it('chargement : indicateur textuel, le titre du panneau reste visible', () => {
    const balisage = renderToStaticMarkup(
      <SectionMouvementsConcurrents etat={{ statut: 'chargement' }} onVoirDetail={() => {}} />,
    );
    expect(balisage).toContain('Concurrents — mouvements de prix');
    expect(balisage).toContain('Calcul des mouvements de prix');
  });

  it('erreur : le message du serveur est affiché, jamais avalé', () => {
    const balisage = renderToStaticMarkup(
      <SectionMouvementsConcurrents
        etat={{ statut: 'erreur', message: 'Le calcul des mouvements a échoué.' }}
        onVoirDetail={() => {}}
      />,
    );
    expect(balisage).toContain('Le calcul des mouvements a échoué.');
  });

  it('aucun relevé de concurrent DU TOUT : un état vide DISTINCT de « tout stable » — jamais confondus', () => {
    const balisage = renderToStaticMarkup(
      <SectionMouvementsConcurrents
        etat={{ statut: 'pret', mouvements: [] }}
        onVoirDetail={() => {}}
      />,
    );
    expect(balisage).toContain('Aucun relevé de concurrent enregistré');
    // Les deux phrases « rien » ne sont PAS interchangeables : celle-ci ne
    // doit jamais apparaître pour une base simplement vide.
    expect(balisage).not.toContain('Aucun prix n’a bougé');
    expect(balisage).not.toContain('Rien à comparer');
  });

  it('tout stable : en-tête « Aucun prix n’a bougé », aucune ligne de mouvement individuelle, un décompte agrégé', () => {
    const mouvements = [
      mouvement({
        concurrentId: 'a',
        concurrentNom: 'Crêperie du Quai',
        nomProduit: 'Crêpe nature stable',
        statut: 'stable',
        ecartCents: 0,
        ecartBp: 0,
      }),
      mouvement({
        concurrentId: 'b',
        concurrentNom: 'Le Comptoir Sucré',
        nomProduit: 'Gaufre stable',
        statut: 'stable',
        ecartCents: 0,
        ecartBp: 0,
      }),
    ];
    const balisage = renderToStaticMarkup(
      <SectionMouvementsConcurrents
        etat={{ statut: 'pret', mouvements }}
        onVoirDetail={() => {}}
      />,
    );
    expect(balisage).toContain('Aucun prix n’a bougé depuis le dernier relevé.');
    expect(balisage).toContain('2 produits sans changement');
    // Un produit stable ne demande aucune décision (docs/07 §2.1) : il ne
    // reçoit jamais sa propre ligne, seulement le décompte agrégé ci-dessus.
    expect(balisage).not.toContain('Crêpe nature stable');
    expect(balisage).not.toContain('Gaufre stable');
  });

  it('mélange hausse/baisse/stable/nouveau : le résumé compte des CONCURRENTS distincts, le détail liste UNIQUEMENT les mouvements réels, et aucun `null` ne se lit « 0,00 € »', () => {
    const mouvements = [
      // Un concurrent qui augmente DEUX produits : ne doit compter qu'UNE fois.
      mouvement({
        concurrentId: 'concurrent-a',
        concurrentNom: 'Crêperie du Quai',
        nomProduit: 'Crêpe nature',
        statut: 'hausse',
        prixCents: 350,
        prixPrecedentCents: 300,
        ecartCents: 50,
        ecartBp: 1_667,
        dateObservation: '2026-07-28',
        dateObservationPrecedente: '2026-07-20',
      }),
      mouvement({
        concurrentId: 'concurrent-a',
        concurrentNom: 'Crêperie du Quai',
        nomProduit: 'Crêpe Nutella',
        statut: 'hausse',
        prixCents: 450,
        prixPrecedentCents: 400,
        ecartCents: 50,
        ecartBp: 1_250,
        dateObservation: '2026-07-28',
        dateObservationPrecedente: '2026-07-20',
      }),
      mouvement({
        concurrentId: 'concurrent-b',
        concurrentNom: 'Le Comptoir Sucré',
        nomProduit: 'Gaufre de Liège',
        statut: 'baisse',
        prixCents: 250,
        prixPrecedentCents: 300,
        ecartCents: -50,
        ecartBp: -1_667,
        dateObservation: '2026-07-28',
        dateObservationPrecedente: '2026-07-21',
      }),
      mouvement({
        concurrentId: 'concurrent-c',
        concurrentNom: 'Stand Immobile',
        nomProduit: 'Crêpe sel',
        statut: 'stable',
        ecartCents: 0,
        ecartBp: 0,
      }),
      // Le piège central : un `nouveau`, prix connu mais RIEN à comparer.
      mouvement({
        concurrentId: 'concurrent-d',
        concurrentNom: 'Nouveau Venu',
        nomProduit: 'Chichis',
        statut: 'nouveau',
        prixCents: 400,
        prixPrecedentCents: null,
        ecartCents: null,
        ecartBp: null,
        dateObservationPrecedente: null,
      }),
    ];
    const balisage = renderToStaticMarkup(
      <SectionMouvementsConcurrents
        etat={{ statut: 'pret', mouvements }}
        onVoirDetail={() => {}}
      />,
    );

    // Résumé : DEUX concurrents distincts (pas trois lignes hausse+baisse).
    expect(balisage).toContain('1 concurrent a augmenté ses prix');
    expect(balisage).toContain('1 concurrent a baissé ses prix');
    expect(balisage).not.toContain('2 concurrents ont augmenté');

    // Détail : les deux produits du concurrent A apparaissent tous les deux
    // (une ligne par PRODUIT, ce résumé ne fusionne pas les lignes) et le
    // produit de baisse aussi.
    expect(balisage).toContain('Crêpe nature');
    expect(balisage).toContain('Crêpe Nutella');
    expect(balisage).toContain('Gaufre de Liège');
    expect(balisage).toContain(formaterEcartMontant(50));
    expect(balisage).toContain(formaterEcartMontant(-50));

    // Le produit STABLE n'a pas sa propre ligne, seulement le compte agrégé.
    expect(balisage).not.toContain('Crêpe sel');
    expect(balisage).toContain('1 produit sans changement');

    // Le produit NOUVEAU n'a pas non plus sa propre ligne (même doctrine),
    // mais son existence n'est PAS perdue : le compte agrégé le nomme, et
    // SURTOUT son prix connu (4,00 €) n'apparaît nulle part comme un « 0,00 € ».
    expect(balisage).not.toContain('Chichis');
    expect(balisage).toContain('1 premier relevé');
    expect(balisage).not.toContain(formaterEuros(0));

    // Bouton de détail, vers l'écran Concurrents.
    expect(balisage).toContain('Voir le détail');
  });

  it('un mouvement réel affiche l’ancienneté de la comparaison (`joursEntre`), un `nouveau` non listé n’en affiche aucune', () => {
    const mouvements = [
      mouvement({
        concurrentId: 'concurrent-a',
        concurrentNom: 'Crêperie du Quai',
        nomProduit: 'Crêpe nature',
        statut: 'hausse',
        dateObservation: '2026-07-28',
        dateObservationPrecedente: '2026-07-20',
      }),
    ];
    const balisage = renderToStaticMarkup(
      <SectionMouvementsConcurrents
        etat={{ statut: 'pret', mouvements }}
        onVoirDetail={() => {}}
      />,
    );
    const joursAttendus = joursEntre('2026-07-20', '2026-07-28');
    expect(balisage).toContain(`sur ${joursAttendus} j`);
  });
});
