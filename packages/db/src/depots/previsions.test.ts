/**
 * Tests du dépôt de prévision — la boucle prévu/réalisé (docs/17 fiches 2/4,
 * décision D-059).
 *
 * Deux mécanismes distincts, tous les deux refermés par ce lot :
 *
 *  - `observationsMeteoDuLieu` : matière première (conditions météo brutes,
 *    pas encore classées) de la mesure du facteur météo PAR CATÉGORIE —
 *    calculée et validée par `apps/api/src/routes/previsions.ts`.
 *  - `mesurerImpactEvenement` / `rapprocherPrevision` : `evenement.impact_mesure_bp`
 *    existait, documenté, jamais écrit (vérifié le 29/07/2026 : zéro
 *    `insert`/`update` sur cette colonne dans tout le dépôt avant ce lot).
 *    Ce fichier prouve qu'il l'est désormais, avec la formule de docs/03
 *    (« facteur 3 ») : `impact_mesuré = réel / (baseline × météo × saison)`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  BASE_POINTS,
  CATALOGUE_PARAMETRES,
  Parametres,
  maintenantUtc,
  nouvelIdentifiant,
  prevoir,
  type ResultatPrevision,
} from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import {
  commandeFournisseur,
  commandeLigne,
  conditionnement,
  evenement,
  ingredient,
  lieuMarche,
  produitVente,
  production,
  recette,
  sessionMarche,
} from '../schema.js';
import { creerSession, cloturerSession } from '../services/sessions.js';
import { enregistrerReception } from '../services/reception.js';
import { enregistrerSortie } from '../services/mouvements.js';
import {
  archiverPrevision,
  coutsNewsvendor,
  creerEvenement,
  enregistrerMeteo,
  facteurEvenementBp,
  ingredientsActifsAvecDelai,
  lireMeteo,
  mesurerImpactEvenement,
  observationsCompletesDuLieu,
  observationsDuLieu,
  observationsMeteoDuLieu,
  occurrencesCandidates,
  partsRecettesActives,
  predicteursPrecision,
  prochaineSessionPlanifiee,
  quantiteDejaCommandeeIngredient,
  qualiteModele,
  serieConsommationJournaliereIngredient,
  stockProjeteIngredient,
  syntheseManqueAGagner,
} from './previsions.js';

/** Un lieu de marché minimal, propre à ce fichier de test. */
function insererLieu(base: BaseBatte, nom = 'Marché de test'): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(lieuMarche)
    .values({
      id,
      nom,
      latitude: 50.6,
      longitude: 5.57,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

/** Un produit transformé, une crêpe par unité : `quantite` vaut alors `crepesVendues`. */
function insererProduitTransforme(base: BaseBatte): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(produitVente)
    .values({
      id,
      nom: 'Froment / cassonade',
      nature: 'transforme',
      recetteId: null,
      ingredientId: null,
      prixCents: 300,
      nbCrepes: 1,
      categorie: null,
      consommationSurPlace: false,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

describe('previsions — dépôt', () => {
  let base: BaseBatte;
  let lieuId: string;
  let produitId: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    lieuId = insererLieu(base);
    produitId = insererProduitTransforme(base);
  });

  /**
   * Clôture une session avec `crepesVendues` EXACTEMENT `quantite` (produit à
   * une crêpe par unité) et, en option, un relevé météo RÉEL pour sa date.
   */
  function cloturerSessionAvecVentes(
    dateSession: string,
    quantite: number,
    options: { exclureDuModele?: boolean } = {},
  ): string {
    const { id } = creerSession(base, { lieuId, dateSession });
    cloturerSession(base, id, {
      ventes: [{ produitVenteId: produitId, quantite, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: quantite * 300,
      caCarteCents: 0,
      crepesProduites: quantite,
      crepesInvendues: 0,
      crepesCassees: 0,
      exclureDuModele: options.exclureDuModele ?? false,
    });
    return id;
  }

  function releverMeteoReelle(dateSession: string, temperatureC: number): void {
    enregistrerMeteo(base, {
      lieuId,
      dateObservation: dateSession,
      type: 'reelle',
      temperatureC,
      precipitationsMm: 0,
      ventKmh: 5,
      couvertureNuageuseBp: 1000,
      recupereLe: maintenantUtc(),
    });
  }

  /** Paramètres du catalogue, valeurs par défaut : suffisant pour faire tourner `prevoir()`. */
  const PARAMETRES = Parametres.depuisLignes(
    CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: d.valeurDefaut })),
  );

  /** Archive une prévision à baseline/météo/saison CONNUES, pour rendre `impact_mesuré` calculable à la main. */
  function archiverPrevisionConnue(sessionId: string, baselineCrepes: number): void {
    const resultat = prevoir(
      {
        baselineCrepes,
        nbSessionsObservees: 0,
        // meteo: null -> facteurs.meteoBp = BASE_POINTS (1,00) : la formule de
        // l'impact mesuré se réduit alors à `reel / baseline`, facile à
        // vérifier à la main dans les assertions.
        meteo: null,
        coutRuptureCents: 300,
        coutInvenduCents: 25,
        contraintes: [],
      },
      PARAMETRES,
    );
    archiverPrevision(base, { sessionId, resultat });
  }

  describe('observationsMeteoDuLieu', () => {
    it('renvoie les sessions closes avec un relevé météo réel exploitable', () => {
      cloturerSessionAvecVentes('2026-08-02', 120);
      releverMeteoReelle('2026-08-02', 22);

      const observations = observationsMeteoDuLieu(base, lieuId);
      expect(observations).toHaveLength(1);
      expect(observations[0]).toMatchObject({
        dateSession: '2026-08-02',
        crepesVendues: 120,
        conditions: { temperatureC: 22 },
      });
    });

    it('écarte une session sans relevé météo exploitable pour sa date', () => {
      cloturerSessionAvecVentes('2026-08-09', 100);
      // Aucun `enregistrerMeteo` pour cette date : jamais un facteur inventé
      // sur une catégorie qu'on ne peut pas déterminer.
      expect(observationsMeteoDuLieu(base, lieuId)).toHaveLength(0);
    });

    it('écarte une session exclue du modèle', () => {
      cloturerSessionAvecVentes('2026-08-16', 100, { exclureDuModele: true });
      releverMeteoReelle('2026-08-16', 20);
      expect(observationsMeteoDuLieu(base, lieuId)).toHaveLength(0);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     `enregistrerMeteo` — les quatre colonnes longtemps inremplissables
     (audit du 30/07/2026) : `temperature_ressentie_c`, `probabilite_pluie_bp`,
     `code_meteo`, `donnees_brutes` étaient écrites `null` EN DUR, quelle que
     soit l'entrée reçue — la donnée était récupérée par `open-meteo.ts` puis
     jetée avant d'atteindre la base. Ce bloc prouve qu'elle y arrive
     désormais, et qu'un champ ABSENT reste `null`, jamais `0` (CLAUDE.md §7 —
     décisif ici pour la probabilité de pluie : confondre les deux ferait
     produire de la pâte pour un dimanche qu'on croit sec).
     ═══════════════════════════════════════════════════════════════════════ */
  describe('enregistrerMeteo — quatre colonnes fraîchement branchées', () => {
    it('écrit une vraie valeur sur les quatre colonnes quand elles sont fournies', () => {
      enregistrerMeteo(base, {
        lieuId,
        dateObservation: '2026-09-06',
        type: 'prevision',
        temperatureC: 18,
        precipitationsMm: 0.4,
        ventKmh: 12,
        couvertureNuageuseBp: 6000,
        recupereLe: maintenantUtc(),
        temperatureRessentieC: 16.5,
        // 80 % de risque de pluie -> 8000 points de base, jamais 80.
        probabilitePluieBp: 8000,
        codeMeteo: 61,
        donneesBrutes: {
          heures: ['2026-09-06T09:00'],
          valeurs: { weather_code: [61] },
          unites: {},
        },
      });

      const ligne = lireMeteo(base, lieuId, '2026-09-06');
      expect(ligne).not.toBeNull();
      expect(ligne!.temperatureRessentieC).toBe(16.5);
      expect(ligne!.probabilitePluieBp).toBe(8000);
      expect(ligne!.codeMeteo).toBe(61);
      expect(ligne!.donneesBrutes).toEqual({
        heures: ['2026-09-06T09:00'],
        valeurs: { weather_code: [61] },
        unites: {},
      });
    });

    it('un champ ABSENT (non fourni) reste null, jamais 0', () => {
      // Aucun des quatre champs n'est passé — exactement ce que fait
      // `obtenirMeteo` (apps/api/src/routes/previsions.ts) quand il
      // reconstruit un relevé depuis le cache (`lireMeteo` ne les relit pas).
      enregistrerMeteo(base, {
        lieuId,
        dateObservation: '2026-09-13',
        type: 'prevision',
        temperatureC: 19,
        precipitationsMm: 0,
        ventKmh: 8,
        couvertureNuageuseBp: 3000,
        recupereLe: maintenantUtc(),
      });

      const ligne = lireMeteo(base, lieuId, '2026-09-13');
      expect(ligne).not.toBeNull();
      expect(ligne!.temperatureRessentieC).toBeNull();
      expect(ligne!.probabilitePluieBp).toBeNull();
      expect(ligne!.probabilitePluieBp).not.toBe(0);
      expect(ligne!.codeMeteo).toBeNull();
      expect(ligne!.donneesBrutes).toBeNull();
    });

    it('une probabilité de pluie explicitement nulle (0 %) reste 0, jamais confondue avec « inconnue »', () => {
      // 0 est une vraie mesure (temps sec certain) — distincte de `null`
      // (« Open-Meteo n'a rien rendu »). Le `?? null` de `enregistrerMeteo` ne
      // doit neutraliser que `null`/`undefined`, jamais un zéro réel.
      enregistrerMeteo(base, {
        lieuId,
        dateObservation: '2026-09-20',
        type: 'prevision',
        temperatureC: 20,
        precipitationsMm: 0,
        ventKmh: 5,
        couvertureNuageuseBp: 1000,
        recupereLe: maintenantUtc(),
        probabilitePluieBp: 0,
        codeMeteo: 0,
      });

      const ligne = lireMeteo(base, lieuId, '2026-09-20');
      expect(ligne!.probabilitePluieBp).toBe(0);
      expect(ligne!.probabilitePluieBp).not.toBeNull();
      expect(ligne!.codeMeteo).toBe(0);
      expect(ligne!.codeMeteo).not.toBeNull();
    });

    it('un rafraîchissement (même lieu/date/type/horizon) met aussi à jour les quatre colonnes', () => {
      const entreeCommune = {
        lieuId,
        dateObservation: '2026-09-27',
        type: 'prevision' as const,
        precipitationsMm: 0,
        ventKmh: 10,
        couvertureNuageuseBp: 4000,
      };
      enregistrerMeteo(base, {
        ...entreeCommune,
        temperatureC: 17,
        recupereLe: '2026-09-20T08:00:00.000Z',
        temperatureRessentieC: 15,
        probabilitePluieBp: 2000,
        codeMeteo: 3,
      });

      // Même (lieu, date, type, horizon) : `onConflictDoUpdate` doit
      // remplacer les quatre colonnes, pas seulement les quatre historiques.
      enregistrerMeteo(base, {
        ...entreeCommune,
        temperatureC: 21,
        recupereLe: '2026-09-20T08:00:00.000Z',
        temperatureRessentieC: 19,
        probabilitePluieBp: 500,
        codeMeteo: 61,
      });

      const ligne = lireMeteo(base, lieuId, '2026-09-27');
      expect(ligne!.temperatureRessentieC).toBe(19);
      expect(ligne!.probabilitePluieBp).toBe(500);
      expect(ligne!.codeMeteo).toBe(61);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     Mesure de charge du 30/07/2026 : `observationsMeteoDuLieu`,
     `observationsDuLieu` et `observationsCompletesDuLieu` appelaient
     `facteurEvenementBp(base, s.dateSession)` — donc une requête sur
     `evenement` — UNE FOIS PAR SESSION de l'historique (`observationsDuLieu`
     passait de 2,2 ms à vide à 60,3 ms à 150 sessions). Corrigé en chargeant
     les événements validés UNE SEULE FOIS par appel
     (`evenementsValidesEnBloc`), puis en filtrant en mémoire
     (`facteurEvenementBpEnMemoire`) — même patron que `garniesParSession`
     dans `depots/tracabilite.ts`.

     Ce bloc ne vérifie pas que le résultat n'est pas vide : il compare,
     champ `evenementBp` par champ `evenementBp`, la sortie des trois
     fonctions à `facteurEvenementBp(base, date)` — la fonction PUBLIQUE,
     INCHANGÉE, une requête par date — sur un jeu de données non trivial :
     deux lieux, huit sessions, cinq événements couvrant les trois cas qui
     feraient dérailler une mémoïsation maladroite :
       1. un événement NON VALIDÉ qui chevauche EXACTEMENT un événement
          validé (doit rester sans aucun effet, même partiel) ;
       2. un événement NON VALIDÉ seul actif un jour donné (le facteur doit
          alors être neutre, pas un facteur inventé) ;
       3. les bornes de date : `dateFin` strictement égale à la date d'une
          session (incluse) contre `dateFin` un jour avant (exclue) —
          exactement les défauts déjà rencontrés sur ce projet (D-020, D-026).
     ═══════════════════════════════════════════════════════════════════════ */
  describe('cache local des événements (evenementBp) — équivalence avant/après mémoïsation', () => {
    /** Insère un événement BRUT, sans passer par `creerEvenement` (qui force `valideParHumain = true`). */
    function insererEvenementBrut(entree: {
      dateDebut: string;
      dateFin: string;
      impactEstimeBp: number;
      impactMesureBp?: number | null;
      valideParHumain: boolean;
    }): string {
      const id = nouvelIdentifiant();
      const maintenant = maintenantUtc();
      base
        .insert(evenement)
        .values({
          id,
          nom: `Événement test ${id}`,
          type: 'autre',
          dateDebut: entree.dateDebut,
          dateFin: entree.dateFin,
          portee: 'quartier',
          intensiteEstimee: 3,
          impactEstimeBp: entree.impactEstimeBp,
          impactMesureBp: entree.impactMesureBp ?? null,
          valideParHumain: entree.valideParHumain,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      return id;
    }

    function releverMeteoReellePour(lieu: string, dateSession: string, temperatureC: number): void {
      enregistrerMeteo(base, {
        lieuId: lieu,
        dateObservation: dateSession,
        type: 'reelle',
        temperatureC,
        precipitationsMm: 0,
        ventKmh: 5,
        couvertureNuageuseBp: 1000,
        recupereLe: maintenantUtc(),
      });
    }

    /** Clôture une session sur le lieu donné, `crepesVendues` = `crepesProduites` = `quantite`. */
    function cloturerSessionPourLieu(lieu: string, dateSession: string, quantite: number): void {
      const { id } = creerSession(base, { lieuId: lieu, dateSession });
      cloturerSession(base, id, {
        ventes: [{ produitVenteId: produitId, quantite, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: quantite * 300,
        caCarteCents: 0,
        crepesProduites: quantite,
        crepesInvendues: 0,
        crepesCassees: 0,
      });
    }

    /**
     * Construit le jeu de données : deux lieux, huit sessions closes avec un
     * relevé météo réel, cinq événements. Rend l'identifiant du second lieu.
     */
    function construireJeuDeDonnees(): { lieuB: string } {
      const lieuB = insererLieu(base, 'Marché B (cache événements)');

      for (const [date, qte] of [
        ['2026-08-01', 100],
        ['2026-08-02', 110],
        ['2026-08-09', 120],
        ['2026-08-16', 130],
        ['2026-08-23', 140],
        ['2026-08-30', 150],
      ] as const) {
        cloturerSessionPourLieu(lieuId, date, qte);
        releverMeteoReellePour(lieuId, date, 20);
      }
      for (const [date, qte] of [
        ['2026-08-02', 90],
        ['2026-08-16', 95],
      ] as const) {
        cloturerSessionPourLieu(lieuB, date, qte);
        releverMeteoReellePour(lieuB, date, 18);
      }

      // 1) Événement VALIDÉ, estimation seule (pas encore de mesure).
      creerEvenement(base, {
        nom: 'Événement validé (estimation)',
        type: 'festival',
        dateDebut: '2026-08-01',
        dateFin: '2026-08-02',
        portee: 'quartier',
        intensiteEstimee: 3,
        impactEstimeBp: 12_000,
      });
      // 2) Chevauche EXACTEMENT la même date (08-02) que l'événement
      //    ci-dessus, mais N'EST PAS validé : ne doit jamais entrer dans le
      //    produit, même en partie.
      insererEvenementBrut({
        dateDebut: '2026-08-02',
        dateFin: '2026-08-02',
        impactEstimeBp: 20_000,
        valideParHumain: false,
      });
      // 3) Impact MESURÉ renseigné : doit primer sur l'estimation, y compris
      //    en passant par le cache en mémoire.
      insererEvenementBrut({
        dateDebut: '2026-08-09',
        dateFin: '2026-08-09',
        impactEstimeBp: 8_000,
        impactMesureBp: 9_000,
        valideParHumain: true,
      });
      // 4) SEUL événement du 16 août, et NON validé : le facteur de ce jour
      //    doit rester neutre (BASE_POINTS), sur les deux lieux.
      insererEvenementBrut({
        dateDebut: '2026-08-16',
        dateFin: '2026-08-16',
        impactEstimeBp: 5_000,
        valideParHumain: false,
      });
      // 5) Borne INCLUSIVE : dateFin = 23 août s'applique à la session du 23.
      creerEvenement(base, {
        nom: 'Événement borne inclusive',
        type: 'festival',
        dateDebut: '2026-08-22',
        dateFin: '2026-08-23',
        portee: 'quartier',
        intensiteEstimee: 3,
        impactEstimeBp: 11_000,
      });
      // 6) Borne EXCLUSIVE : dateFin = 29 août, un jour avant la session du
      //    30 — ne doit surtout PAS s'y appliquer (D-020, D-026).
      creerEvenement(base, {
        nom: 'Événement borne exclusive',
        type: 'festival',
        dateDebut: '2026-08-28',
        dateFin: '2026-08-29',
        portee: 'quartier',
        intensiteEstimee: 3,
        impactEstimeBp: 7_000,
      });

      return { lieuB };
    }

    it('observationsDuLieu : evenementBp identique au calcul PAR SESSION (facteurEvenementBp), événement non validé exclu, bornes de date respectées', () => {
      const { lieuB } = construireJeuDeDonnees();

      for (const lieu of [lieuId, lieuB]) {
        const observations = observationsDuLieu(base, lieu);
        expect(observations.length).toBeGreaterThan(0);
        for (const obs of observations) {
          // Équivalence face à l'ancien chemin : `facteurEvenementBp` reste
          // inchangée (une requête par date, jamais mise en cache) — c'est
          // la RÉFÉRENCE indépendante de cette comparaison.
          expect(obs.evenementBp).toBe(facteurEvenementBp(base, obs.dateSession));
        }
      }

      const parDateA = new Map(
        observationsDuLieu(base, lieuId).map((o) => [o.dateSession, o.evenementBp]),
      );
      expect(parDateA.get('2026-08-01')).toBe(12_000);
      expect(parDateA.get('2026-08-02')).toBe(12_000); // l'événement non validé n'a rien changé.
      expect(parDateA.get('2026-08-09')).toBe(9_000); // mesuré, pas estimé.
      expect(parDateA.get('2026-08-16')).toBe(BASE_POINTS); // seul événement du jour : non validé.
      expect(parDateA.get('2026-08-23')).toBe(11_000); // borne dateFin incluse.
      expect(parDateA.get('2026-08-30')).toBe(BASE_POINTS); // borne dateFin de l'avant-veille : hors champ.

      const parDateB = new Map(
        observationsDuLieu(base, lieuB).map((o) => [o.dateSession, o.evenementBp]),
      );
      expect(parDateB.get('2026-08-02')).toBe(12_000);
      expect(parDateB.get('2026-08-16')).toBe(BASE_POINTS);
    });

    it('observationsMeteoDuLieu : même équivalence, mêmes exclusions, sur les conditions météo brutes', () => {
      const { lieuB } = construireJeuDeDonnees();

      for (const lieu of [lieuId, lieuB]) {
        const observations = observationsMeteoDuLieu(base, lieu);
        expect(observations.length).toBeGreaterThan(0);
        for (const obs of observations) {
          expect(obs.evenementBp).toBe(facteurEvenementBp(base, obs.dateSession));
        }
      }
    });

    it('observationsCompletesDuLieu : même équivalence, mêmes exclusions, sur l’historique enrichi', () => {
      const { lieuB } = construireJeuDeDonnees();

      for (const lieu of [lieuId, lieuB]) {
        const observations = observationsCompletesDuLieu(base, lieu);
        expect(observations.length).toBeGreaterThan(0);
        for (const obs of observations) {
          expect(obs.evenementBp).toBe(facteurEvenementBp(base, obs.dateSession));
        }
      }
    });
  });

  describe('mesurerImpactEvenement / rapprocherPrevision — impact mesuré des événements', () => {
    it('écrit impact_mesure_bp à la clôture, avec la formule réel / (baseline × météo × saison)', () => {
      const evenementId = creerEvenement(base, {
        nom: 'Fête locale',
        type: 'festival',
        dateDebut: '2026-08-02',
        dateFin: '2026-08-02',
        portee: 'quartier',
        intensiteEstimee: 3,
        impactEstimeBp: 11_500,
      });

      const sessionId = creerSession(base, { lieuId, dateSession: '2026-08-02' }).id;
      // baseline = 100, météo neutre (1,00), saison neutre (1,00) archivées :
      // impact_mesuré = crepesReelles / 100.
      archiverPrevisionConnue(sessionId, 100);

      cloturerSession(base, sessionId, {
        ventes: [{ produitVenteId: produitId, quantite: 150, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 150 * 300,
        caCarteCents: 0,
        crepesProduites: 150,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      const ligne = base.select().from(evenement).where(eq(evenement.id, evenementId)).get()!;
      // 150 / (100 × 1,00 × 1,00) = 1,50 -> 15000 bp.
      expect(ligne.impactMesureBp).toBe(15_000);
    });

    it('n’écrit rien quand plus d’un événement est actif le même jour (attribution ambiguë)', () => {
      const ev1 = creerEvenement(base, {
        nom: 'Événement A',
        type: 'festival',
        dateDebut: '2026-08-02',
        dateFin: '2026-08-02',
        portee: 'quartier',
        intensiteEstimee: 3,
        impactEstimeBp: 11_500,
      });
      const ev2 = creerEvenement(base, {
        nom: 'Événement B',
        type: 'sportif',
        dateDebut: '2026-08-02',
        dateFin: '2026-08-02',
        portee: 'quartier',
        intensiteEstimee: 2,
        impactEstimeBp: 11_000,
      });

      const sessionId = creerSession(base, { lieuId, dateSession: '2026-08-02' }).id;
      archiverPrevisionConnue(sessionId, 100);
      cloturerSession(base, sessionId, {
        ventes: [{ produitVenteId: produitId, quantite: 150, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 150 * 300,
        caCarteCents: 0,
        crepesProduites: 150,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      const ligne1 = base.select().from(evenement).where(eq(evenement.id, ev1)).get()!;
      const ligne2 = base.select().from(evenement).where(eq(evenement.id, ev2)).get()!;
      expect(ligne1.impactMesureBp).toBeNull();
      expect(ligne2.impactMesureBp).toBeNull();
    });

    it('moyenne sur plusieurs dimanches tombant dans la fenêtre de l’événement', () => {
      const evenementId = creerEvenement(base, {
        nom: 'Braderie du mois',
        type: 'festival',
        dateDebut: '2026-08-02',
        dateFin: '2026-08-23',
        portee: 'quartier',
        intensiteEstimee: 3,
        impactEstimeBp: 11_500,
      });

      const session1 = creerSession(base, { lieuId, dateSession: '2026-08-02' }).id;
      archiverPrevisionConnue(session1, 100);
      cloturerSession(base, session1, {
        ventes: [{ produitVenteId: produitId, quantite: 150, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 150 * 300,
        caCarteCents: 0,
        crepesProduites: 150,
        crepesInvendues: 0,
        crepesCassees: 0,
      });
      // Premier point : 150/100 = 1,50 -> 15000 bp.
      expect(
        base.select().from(evenement).where(eq(evenement.id, evenementId)).get()!.impactMesureBp,
      ).toBe(15_000);

      const session2 = creerSession(base, { lieuId, dateSession: '2026-08-09' }).id;
      archiverPrevisionConnue(session2, 100);
      cloturerSession(base, session2, {
        ventes: [{ produitVenteId: produitId, quantite: 130, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 130 * 300,
        caCarteCents: 0,
        crepesProduites: 130,
        crepesInvendues: 0,
        crepesCassees: 0,
      });
      // Second point : 130/100 = 1,30 -> 13000 bp. Moyenne de (15000, 13000) = 14000.
      expect(
        base.select().from(evenement).where(eq(evenement.id, evenementId)).get()!.impactMesureBp,
      ).toBe(14_000);
    });

    it('écarte une session exclue du modèle de la moyenne', () => {
      const evenementId = creerEvenement(base, {
        nom: 'Braderie du mois',
        type: 'festival',
        dateDebut: '2026-08-02',
        dateFin: '2026-08-23',
        portee: 'quartier',
        intensiteEstimee: 3,
        impactEstimeBp: 11_500,
      });

      const session1 = creerSession(base, { lieuId, dateSession: '2026-08-02' }).id;
      archiverPrevisionConnue(session1, 100);
      cloturerSession(base, session1, {
        ventes: [{ produitVenteId: produitId, quantite: 150, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 150 * 300,
        caCarteCents: 0,
        crepesProduites: 150,
        crepesInvendues: 0,
        crepesCassees: 0,
        // Panne de gaz : une mesure qui ne représente rien ne doit jamais
        // polluer un coefficient réutilisé pour de futures prévisions.
        exclureDuModele: true,
      });
      expect(
        base.select().from(evenement).where(eq(evenement.id, evenementId)).get()!.impactMesureBp,
      ).toBeNull();

      const session2 = creerSession(base, { lieuId, dateSession: '2026-08-09' }).id;
      archiverPrevisionConnue(session2, 100);
      cloturerSession(base, session2, {
        ventes: [{ produitVenteId: produitId, quantite: 130, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 130 * 300,
        caCarteCents: 0,
        crepesProduites: 130,
        crepesInvendues: 0,
        crepesCassees: 0,
      });
      // Seule la session NON exclue compte : 130/100 = 1,30 -> 13000 bp,
      // jamais une moyenne avec la session exclue.
      expect(
        base.select().from(evenement).where(eq(evenement.id, evenementId)).get()!.impactMesureBp,
      ).toBe(13_000);
    });

    it('ne touche pas impact_mesure_bp quand aucune prévision n’a été archivée pour la session', () => {
      const evenementId = creerEvenement(base, {
        nom: 'Fête locale',
        type: 'festival',
        dateDebut: '2026-08-02',
        dateFin: '2026-08-02',
        portee: 'quartier',
        intensiteEstimee: 3,
        impactEstimeBp: 11_500,
      });

      const sessionId = creerSession(base, { lieuId, dateSession: '2026-08-02' }).id;
      // Aucun `archiverPrevisionConnue` : pas de baseline/météo/saison de
      // référence, donc pas de résidu calculable.
      cloturerSession(base, sessionId, {
        ventes: [{ produitVenteId: produitId, quantite: 150, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 150 * 300,
        caCarteCents: 0,
        crepesProduites: 150,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      expect(
        base.select().from(evenement).where(eq(evenement.id, evenementId)).get()!.impactMesureBp,
      ).toBeNull();
    });

    it('appelable directement sans effet quand l’événement n’existe pas (jamais de plantage)', () => {
      expect(() => mesurerImpactEvenement(base, 'inconnu')).not.toThrow();
    });

    /**
     * Critère de fin de la fiche 4 : « la prévision suivante du même
     * événement l'utilise de préférence à l'estimation. » `facteurEvenementBp`
     * lisait déjà `impactMesureBp ?? impactEstimeBp` — la seule pièce
     * manquante était l'écriture de la colonne, désormais faite par
     * `mesurerImpactEvenement`.
     */
    it('la prévision d’un futur jour du même événement utilise l’impact MESURÉ, pas l’estimation', () => {
      const evenementId = creerEvenement(base, {
        nom: 'Braderie du mois',
        type: 'festival',
        dateDebut: '2026-08-02',
        dateFin: '2026-08-23',
        portee: 'quartier',
        // Estimation initiale volontairement TRÈS différente de la mesure à
        // venir, pour que le test distingue clairement les deux.
        intensiteEstimee: 1,
        impactEstimeBp: 10_500,
      });

      const sessionId = creerSession(base, { lieuId, dateSession: '2026-08-02' }).id;
      archiverPrevisionConnue(sessionId, 100);
      cloturerSession(base, sessionId, {
        ventes: [{ produitVenteId: produitId, quantite: 150, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 150 * 300,
        caCarteCents: 0,
        crepesProduites: 150,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      // Un second dimanche, dans la MÊME fenêtre d'événement (dateFin = 23) :
      // c'est la prévision de CE jour qui doit désormais préférer la mesure.
      expect(facteurEvenementBp(base, '2026-08-09')).toBe(15_000);

      const ligne = base.select().from(evenement).where(eq(evenement.id, evenementId)).get()!;
      expect(ligne.impactMesureBp).toBe(15_000);
      expect(ligne.impactEstimeBp).toBe(10_500); // l'estimation d'origine reste, elle, inchangée.
    });
  });

  describe('rapprocherPrevision — non-régression : le rapprochement du réalisé continue de fonctionner', () => {
    it('renseigne crepesReelles et erreurAbsolueBp sur la prévision archivée', () => {
      const sessionId = creerSession(base, { lieuId, dateSession: '2026-08-02' }).id;
      archiverPrevisionConnue(sessionId, 100);

      cloturerSession(base, sessionId, {
        ventes: [{ produitVenteId: produitId, quantite: 150, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 150 * 300,
        caCarteCents: 0,
        crepesProduites: 150,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      const session = base
        .select({ crepesVendues: sessionMarche.crepesVendues })
        .from(sessionMarche)
        .where(eq(sessionMarche.id, sessionId))
        .get()!;
      expect(session.crepesVendues).toBe(150);
    });
  });

  /**
   * docs/demandes/06 — Prévision calendaire et achats anticipés.
   *
   * Trois lectures neuves : les dates candidates de l'horizon
   * (`occurrencesCandidates`), la répartition mesurée entre recettes actives
   * (`partsRecettesActives`), et ce que couvrent déjà les commandes ouvertes
   * par ingrédient. Aucun calcul de prévision dans ces tests : uniquement des
   * lectures, comme le reste du dépôt.
   */
  describe('occurrencesCandidates', () => {
    it('génère une occurrence par semaine pour un lieu récurrent, sans session créée', () => {
      // `lieuId` (créé par `insererLieu`) n'a pas de `jourSemaine` : on lui en
      // donne un ici pour isoler ce test du reste du fichier.
      base
        .update(lieuMarche)
        .set({ jourSemaine: 0 }) // dimanche
        .where(eq(lieuMarche.id, lieuId))
        .run();

      // Fenêtre demi-ouverte [depuis, depuis + horizonJours[ (docs/demandes/06).
      const occurrences = occurrencesCandidates(base, '2026-08-02', 15);
      expect(occurrences.map((o) => o.dateSession)).toEqual([
        '2026-08-02',
        '2026-08-09',
        '2026-08-16',
      ]);
      expect(occurrences.every((o) => o.sessionId === null)).toBe(true);
      expect(occurrences.every((o) => o.lieuId === lieuId)).toBe(true);
    });

    it('porte le VRAI sessionId quand une session est déjà planifiée pour une date récurrente', () => {
      base.update(lieuMarche).set({ jourSemaine: 0 }).where(eq(lieuMarche.id, lieuId)).run();
      const { id: sessionId } = creerSession(base, { lieuId, dateSession: '2026-08-09' });

      const occurrences = occurrencesCandidates(base, '2026-08-02', 15);
      const premiere = occurrences.find((o) => o.dateSession === '2026-08-02');
      const seconde = occurrences.find((o) => o.dateSession === '2026-08-09');
      expect(premiere?.sessionId).toBeNull();
      expect(seconde?.sessionId).toBe(sessionId);
    });

    it('inclut une session planifiée exceptionnelle qui ne tombe PAS sur le jour récurrent', () => {
      base.update(lieuMarche).set({ jourSemaine: 0 }).where(eq(lieuMarche.id, lieuId)).run();
      // 2026-08-05 est un mercredi : un marché exceptionnel, pas la récurrence.
      const { id: sessionId } = creerSession(base, { lieuId, dateSession: '2026-08-05' });

      const occurrences = occurrencesCandidates(base, '2026-08-02', 10);
      const exceptionnelle = occurrences.find((o) => o.dateSession === '2026-08-05');
      expect(exceptionnelle?.sessionId).toBe(sessionId);
    });

    it('ignore un lieu actif sans jour de semaine récurrent et sans session planifiée', () => {
      // `lieuId` n'a jamais reçu de `jourSemaine` dans ce test : aucune
      // occurrence recurrente ne doit apparaître.
      expect(occurrencesCandidates(base, '2026-08-02', 30)).toEqual([]);
    });

    it('rend les occurrences triées par date croissante', () => {
      base.update(lieuMarche).set({ jourSemaine: 0 }).where(eq(lieuMarche.id, lieuId)).run();
      const dates = occurrencesCandidates(base, '2026-08-02', 22).map((o) => o.dateSession);
      expect(dates).toEqual([...dates].sort());
    });
  });

  describe('partsRecettesActives', () => {
    /** Recette minimale, active par défaut. */
    function insererRecette(code: string, statut: 'brouillon' | 'active' | 'archivee' = 'active') {
      const id = nouvelIdentifiant();
      const maintenant = maintenantUtc();
      base
        .insert(recette)
        .values({
          id,
          code,
          nom: code,
          version: 1,
          statut,
          typePate: 'froment',
          rendementReferenceMl: 1000,
          rendementReferenceCrepes: 6,
          perteCuissonBp: 0,
          tauxCasseBp: 0,
          perteFixeMl: 0,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      return id;
    }

    function insererProduction(recetteId: string, crepesTheoriques: number): void {
      const id = nouvelIdentifiant();
      const maintenant = maintenantUtc();
      base
        .insert(production)
        .values({
          id,
          numero: `PR-TEST-${id}`,
          recetteId,
          dateProduction: '2026-07-01',
          statut: 'terminee',
          volumeTheoriqueMl: 1000,
          crepesTheoriques,
          coutMatiereTheoriqueCents: 100,
          numeroLotPate: `LOT-${id}`,
          dateDlcPate: '2026-07-04',
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
    }

    it('rend un tableau vide sans aucune recette active', () => {
      insererRecette('R0', 'brouillon');
      expect(partsRecettesActives(base)).toEqual([]);
    });

    it('rend 100 % à une recette active UNIQUE, sans avoir besoin de mesure', () => {
      const id = insererRecette('R1');
      expect(partsRecettesActives(base)).toEqual([{ recetteId: id, partBp: BASE_POINTS }]);
    });

    it('rend `null` quand plusieurs recettes actives coexistent SANS historique — jamais un partage deviné', () => {
      insererRecette('R1');
      insererRecette('R2');
      expect(partsRecettesActives(base)).toBeNull();
    });

    it('mesure la part de chaque recette sur l’historique de production RÉEL', () => {
      const idR1 = insererRecette('R1');
      const idR2 = insererRecette('R2');
      insererProduction(idR1, 70);
      insererProduction(idR2, 30);

      const parts = partsRecettesActives(base);
      expect(parts).toContainEqual({ recetteId: idR1, partBp: 7000 });
      expect(parts).toContainEqual({ recetteId: idR2, partBp: 3000 });
    });

    it('ignore les productions ANNULÉES dans la mesure', () => {
      const idR1 = insererRecette('R1');
      const idR2 = insererRecette('R2');
      insererProduction(idR1, 100);
      insererProduction(idR2, 100);
      // Une troisième production, annulée, ne doit peser sur AUCUNE part.
      const idAnnulee = nouvelIdentifiant();
      const maintenant = maintenantUtc();
      base
        .insert(production)
        .values({
          id: idAnnulee,
          numero: 'PR-TEST-ANNULEE',
          recetteId: idR1,
          dateProduction: '2026-07-01',
          statut: 'annulee',
          volumeTheoriqueMl: 1000,
          crepesTheoriques: 900,
          coutMatiereTheoriqueCents: 100,
          numeroLotPate: 'LOT-ANNULEE',
          dateDlcPate: '2026-07-04',
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const parts = partsRecettesActives(base);
      expect(parts).toContainEqual({ recetteId: idR1, partBp: 5000 });
      expect(parts).toContainEqual({ recetteId: idR2, partBp: 5000 });
    });
  });

  /**
   * Trois lectures qui alimentent le point de commande PRÉDICTIF
   * (`apps/api/src/routes/previsions.ts`) : le délai par ingrédient, ce qui
   * est déjà commandé, et le stock projeté qui en résulte. `seedDemonstration`
   * fournit un ingrédient, un fournisseur et un conditionnement déjà liés —
   * même socle que `services/commandes.test.ts`.
   */
  describe('stock et commandes par ingrédient (point de commande prédictif)', () => {
    let idFarine: string;
    let idFournisseurDemo: string;
    let idConditionnementFarine: string;

    beforeEach(() => {
      seedDemonstration(base);
      idFarine = base
        .select({ id: ingredient.id })
        .from(ingredient)
        .where(eq(ingredient.nom, 'Farine de froment T55'))
        .get()!.id;
      const conditionnementFarine = base
        .select({ id: conditionnement.id, fournisseurId: conditionnement.fournisseurId })
        .from(conditionnement)
        .where(eq(conditionnement.ingredientId, idFarine))
        .get()!;
      idFournisseurDemo = conditionnementFarine.fournisseurId;
      idConditionnementFarine = conditionnementFarine.id;
    });

    it('ingredientsActifsAvecDelai liste la farine avec son délai renseigné', () => {
      const lignes = ingredientsActifsAvecDelai(base);
      const farine = lignes.find((l) => l.ingredientId === idFarine);
      expect(farine).toBeDefined();
      expect(farine?.delaiLivraisonJours).toBeGreaterThan(0);
    });

    it('serieConsommationJournaliereIngredient compte la consommation réelle, zéro les jours sans sortie', () => {
      enregistrerReception(base, {
        fournisseurId: idFournisseurDemo,
        dateReception: '2026-07-01',
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 5000,
            prixLigneCents: 100,
            numeroLotFournisseur: 'LOT-SERIE-CONSO',
          },
        ],
      });

      enregistrerSortie(base, {
        ingredientId: idFarine,
        quantite: 500,
        type: 'sortie_production',
        motifCode: 'SURDOSAGE',
        dateMouvement: '2026-07-27',
      });

      const serie = serieConsommationJournaliereIngredient(base, idFarine, '2026-07-27', 5);
      expect(serie).toHaveLength(5);
      expect(serie.at(-1)).toBe(500); // le dernier jour de la fenêtre est `jourReference`.
      expect(serie.slice(0, -1).every((v) => v === 0)).toBe(true);
    });

    it('quantiteDejaCommandeeIngredient somme les commandes OUVERTES, ignore les reçues et annulées', () => {
      function insererCommande(
        statut: 'brouillon' | 'validee' | 'recue' | 'annulee',
        quantite: number,
      ) {
        const idCommande = nouvelIdentifiant();
        const maintenant = maintenantUtc();
        base
          .insert(commandeFournisseur)
          .values({
            id: idCommande,
            numero: `CF-TEST-${idCommande}`,
            fournisseurId: idFournisseurDemo,
            statut,
            dateCreation: maintenant,
            dateEnvoi: null,
            dateReceptionPrevue: null,
            montantTotalCents: 0,
            genereAutomatiquement: false,
            emailEnvoyeA: null,
            documentId: null,
            notes: null,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();
        base
          .insert(commandeLigne)
          .values({
            id: nouvelIdentifiant(),
            commandeId: idCommande,
            ingredientId: idFarine,
            conditionnementId: idConditionnementFarine,
            quantiteConditionnements: 1,
            quantiteUniteRef: quantite,
            prixLigneCents: 100,
          })
          .run();
      }

      insererCommande('brouillon', 1000);
      insererCommande('validee', 2000);
      insererCommande('recue', 5000); // déjà réceptionnée : ne compte plus comme « en cours ».
      insererCommande('annulee', 9000); // jamais comptée.

      expect(quantiteDejaCommandeeIngredient(base, idFarine)).toBe(3000);
    });

    it('stockProjeteIngredient additionne le disponible ET les commandes déjà ouvertes', () => {
      const disponibleAvant = stockProjeteIngredient(base, idFarine, '2026-07-27');

      enregistrerReception(base, {
        fournisseurId: idFournisseurDemo,
        dateReception: '2026-07-01',
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 4000,
            prixLigneCents: 100,
            numeroLotFournisseur: 'LOT-STOCK-PROJETE',
          },
        ],
      });

      const idCommande = nouvelIdentifiant();
      const maintenant = maintenantUtc();
      base
        .insert(commandeFournisseur)
        .values({
          id: idCommande,
          numero: `CF-TEST-${idCommande}`,
          fournisseurId: idFournisseurDemo,
          statut: 'validee',
          dateCreation: maintenant,
          dateEnvoi: null,
          dateReceptionPrevue: null,
          montantTotalCents: 0,
          genereAutomatiquement: false,
          emailEnvoyeA: null,
          documentId: null,
          notes: null,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      base
        .insert(commandeLigne)
        .values({
          id: nouvelIdentifiant(),
          commandeId: idCommande,
          ingredientId: idFarine,
          conditionnementId: idConditionnementFarine,
          quantiteConditionnements: 1,
          quantiteUniteRef: 1500,
          prixLigneCents: 100,
        })
        .run();

      const apres = stockProjeteIngredient(base, idFarine, '2026-07-27');
      expect(apres).toBe(disponibleAvant + 4000 + 1500);
    });
  });
});

/**
 * `coutsNewsvendor` — `coutInvenduConnu` / `prixMoyenConnu` (audit du coût
 * complet, fiche 13).
 *
 * PREUVE des défauts corrigés :
 *  1. un coût matière TOTALEMENT INCONNU (aucune production, aucune recette
 *     au coût connu) retombait sur un ZÉRO SENTINELLE indiscernable d'un vrai
 *     coût matière nul — exactement le défaut que CLAUDE.md §7 interdit
 *     (« une valeur inconnue vaut `null`, jamais `0` »). `routes/lieux-
 *     rentabilite.ts` et `routes/opportunites.ts` ne testaient que
 *     `prixMoyenCrepeCents > 0` avant d'utiliser `coutInvenduCents` comme un
 *     coût réel dans la marge nette attendue d'un lieu (fiche 13) : sans
 *     `coutInvenduConnu`, un lieu pouvait afficher une marge qui suppose une
 *     matière GRATUITE.
 *  2. `prixMoyenCrepeCents` n'était PAS exposé : les deux routes le
 *     reconstruisaient par `coutRuptureCents + coutInvenduCents`, une formule
 *     exacte SEULEMENT quand le prix couvre la matière (`coutRuptureCents =
 *     max(0, prix − matière)` écrête à 0 en dessous). Sur une matière connue
 *     mais un prix INCONNU (aucune vente, aucun produit transformé au tarif
 *     affiché), la reconstruction renvoyait la matière EN GUISE DE PRIX — un
 *     nombre positif qui a l'air réel, alors qu'aucun prix n'est connu.
 *     `prixMoyenCrepeCents`/`prixMoyenConnu`, exposés directement, évitent
 *     cette reconstruction fragile.
 */
describe('coutsNewsvendor — coutInvenduConnu / prixMoyenConnu (fiche 13, jamais un 0 inventé)', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it(
    'coutInvenduConnu et prixMoyenConnu valent false quand rien ne permet de les estimer ' +
      '— les deux cents restent à 0, mais comme des SENTINELLES, pas des mesures',
    () => {
      // `seed(base)` seul, sans `seedDemonstration` : ni recette ni produit
      // vendable n'existe encore, exactement le premier lancement de
      // l'application.
      seed(base);

      const couts = coutsNewsvendor(base);
      expect(couts.coutInvenduConnu).toBe(false);
      expect(couts.coutInvenduCents).toBe(0);
      expect(couts.prixMoyenConnu).toBe(false);
      expect(couts.prixMoyenCrepeCents).toBe(0);
    },
  );

  it(
    'les deux valent true dès qu’une recette active a un coût connu et qu’un produit ' +
      'transformé porte un tarif affiché, même sans aucune vente ni production réelle ' +
      '(replis théoriques, pas des mesures)',
    () => {
      seed(base);
      seedDemonstration(base);

      const couts = coutsNewsvendor(base);
      expect(couts.coutInvenduConnu).toBe(true);
      // R1 (CLAUDE.md §6) a un coût par crêpe strictement positif : ce n'est
      // pas le 0 sentinelle du test précédent.
      expect(couts.coutInvenduCents).toBeGreaterThan(0);
      expect(couts.prixMoyenConnu).toBe(true);
      expect(couts.prixMoyenCrepeCents).toBeGreaterThan(0);
    },
  );
});

/**
 * `predicteursPrecision` / `syntheseManqueAGagner` — audit du 30/07/2026
 * (`audit-colonnes-orphelines.test.ts`) : 14 colonnes de `prevision` étaient
 * ÉCRITES à chaque archivage (`archiverPrevision`) et jamais RELUES par aucun
 * dépôt. Ce bloc referme deux cas :
 *
 *  - les quatre "facteurs de précision" de la fiche 07
 *    (`facteur_comparable_calendaire_bp`, `facteur_jour_semaine_bp`,
 *    `facteur_vacances_scolaires_bp`, `facteur_session_consecutive_bp`) —
 *    combien de fois chacun a été ADMIS (colonne non nulle) sur l'historique
 *    archivé ;
 *  - `manque_a_gagner_cents` / `contrainte_limitante` — le cumul et la
 *    fréquence de la contrainte qui justifierait un jour un investissement
 *    (troisième plaque, camionnette).
 *
 * Les huit autres colonnes analytiques (`facteurEvenementBp`,
 * `facteurTendanceBp`, `inflationSigmaMeteoBp`, `quantileCibleBp`,
 * `repartitionRecettes`, `nbSessionsComparables`, `commentaireIa`,
 * `explicationFacteurs`) restent volontairement NON reprojetées : aucune
 * d'elles ne répond à une question isolée que l'écran « Qualité du modèle »
 * ne couvre pas déjà (les facteurs de base sont visibles EN DIRECT sur
 * « Prochaine session », et `npm run backtest` — vérifié dans ce même audit —
 * ne lit d'ailleurs AUCUNE des 14 colonnes de `prevision` : il rejoue
 * l'historique depuis les tables sources, jamais depuis l'archive
 * `prevision`). Un câblage qui ne sert aucune décision serait la même faute
 * que la colonne orpheline qu'il prétend corriger.
 */
function resultatFixture(
  contrainteLimitante: string | null,
  manqueAGagnerCents: number | null,
): ResultatPrevision {
  return {
    baseline: 100,
    facteurs: {
      meteoBp: BASE_POINTS,
      evenementBp: BASE_POINTS,
      saisonBp: BASE_POINTS,
      tendanceBp: BASE_POINTS,
      comparableCalendaireBp: BASE_POINTS,
      jourSemaineBp: BASE_POINTS,
      vacancesScolairesBp: BASE_POINTS,
      sessionConsecutiveBp: BASE_POINTS,
    },
    demandeAttendue: 100,
    p10: 80,
    p50: 100,
    p90: 130,
    quantileCibleBp: 9000,
    crepesRecommandees: 120,
    crepesRetenues: 120,
    contrainteLimitante,
    manqueAGagnerCents,
    confianceBp: 3000,
    nbSessionsComparables: 2,
    explication: [],
    repartition: [],
    plancherSansGlutenApplique: false,
  };
}

describe('predicteursPrecision — fiche 07, colonnes archivées jamais relues avant ce lot', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  it('compte les activations (colonne non nulle) et le total, indépendamment par facteur', () => {
    archiverPrevision(base, {
      sessionId: null,
      resultat: resultatFixture(null, null),
      facteurComparableCalendaireBp: 10800,
      facteurJourSemaineBp: null,
      facteurVacancesScolairesBp: 9500,
      facteurSessionConsecutiveBp: null,
    });
    archiverPrevision(base, {
      sessionId: null,
      resultat: resultatFixture(null, null),
      // Aucun facteur transmis ici : les quatre colonnes restent NULL, ce que
      // fait `archiverPrevision` par défaut (`?? null`) quand l'appelant
      // n'a rien à donner.
    });

    const etat = predicteursPrecision(base);
    expect(etat.facteurComparableCalendaireBp).toEqual({ nbActif: 1, nbTotal: 2 });
    expect(etat.facteurJourSemaineBp).toEqual({ nbActif: 0, nbTotal: 2 });
    expect(etat.facteurVacancesScolairesBp).toEqual({ nbActif: 1, nbTotal: 2 });
    expect(etat.facteurSessionConsecutiveBp).toEqual({ nbActif: 0, nbTotal: 2 });
  });

  it('nbTotal vaut 0 (jamais une division par zéro) quand rien n’a encore été archivé', () => {
    const etat = predicteursPrecision(base);
    expect(etat.facteurComparableCalendaireBp).toEqual({ nbActif: 0, nbTotal: 0 });
    expect(etat.facteurJourSemaineBp).toEqual({ nbActif: 0, nbTotal: 0 });
    expect(etat.facteurVacancesScolairesBp).toEqual({ nbActif: 0, nbTotal: 0 });
    expect(etat.facteurSessionConsecutiveBp).toEqual({ nbActif: 0, nbTotal: 0 });
  });
});

describe('syntheseManqueAGagner — manqueAGagnerCents / contrainteLimitante, jamais relues avant ce lot', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  it('ne somme que les prévisions CHIFFRÉES et identifie la contrainte la plus fréquente', () => {
    archiverPrevision(base, { sessionId: null, resultat: resultatFixture(null, null) });
    archiverPrevision(base, {
      sessionId: null,
      resultat: resultatFixture('capacité de cuisson', 3200),
    });
    archiverPrevision(base, {
      sessionId: null,
      resultat: resultatFixture('capacité de cuisson', 1500),
    });
    archiverPrevision(base, {
      sessionId: null,
      resultat: resultatFixture('capacité de la glacière', 800),
    });

    const synthese = syntheseManqueAGagner(base);
    // 3 previsions chiffrees sur 4 archivees : la premiere (sans contrainte)
    // n'entre PAS dans la somme, elle ne pese pas pour un 0.
    expect(synthese.totalCents).toBe(3200 + 1500 + 800);
    expect(synthese.nbPrevisionsChiffrees).toBe(3);
    expect(synthese.nbPrevisionsTotal).toBe(4);
    expect(synthese.contrainteLaPlusFrequente).toBe('capacité de cuisson');
    expect(synthese.nbPrevisionsContrainteLaPlusFrequente).toBe(2);
  });

  it('totalCents et contrainteLaPlusFrequente valent null (jamais 0 ni une chaîne vide) sans aucune mesure', () => {
    archiverPrevision(base, { sessionId: null, resultat: resultatFixture(null, null) });

    const synthese = syntheseManqueAGagner(base);
    expect(synthese.totalCents).toBeNull();
    expect(synthese.contrainteLaPlusFrequente).toBeNull();
    expect(synthese.nbPrevisionsChiffrees).toBe(0);
    expect(synthese.nbPrevisionsContrainteLaPlusFrequente).toBe(0);
    expect(synthese.nbPrevisionsTotal).toBe(1);
  });
});

describe('qualiteModele expose désormais predicteursPrecision et syntheseManqueAGagner', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  it('les deux champs sont présents et cohérents même sans aucune prévision rapprochée', () => {
    // Aucun rapprochement (pas de session close) : les six indicateurs
    // historiques restent tous `null`/0, mais les deux nouveaux champs NE
    // dépendent PAS du rapprochement — ils portent sur TOUTES les prévisions
    // archivées.
    archiverPrevision(base, {
      sessionId: null,
      resultat: resultatFixture('capacité de cuisson', 5000),
      facteurJourSemaineBp: 11000,
    });

    const qualite = qualiteModele(base);
    expect(qualite.nbPrevisionsRapprochees).toBe(0);
    expect(qualite.syntheseManqueAGagner.totalCents).toBe(5000);
    expect(qualite.syntheseManqueAGagner.contrainteLaPlusFrequente).toBe('capacité de cuisson');
    expect(qualite.predicteursPrecision.facteurJourSemaineBp).toEqual({ nbActif: 1, nbTotal: 1 });
    expect(qualite.predicteursPrecision.facteurComparableCalendaireBp).toEqual({
      nbActif: 0,
      nbTotal: 1,
    });
  });
});

/**
 * `prochaineSessionPlanifiee` — le lieu de la session, jamais un nom à
 * deviner (mission du 31/07/2026, docs/demandes/10).
 *
 * `session.lieuId` du contrat `GET /api/prevision`
 * (`packages/core/src/contrats/previsions.ts`) vient EXACTEMENT de cette
 * fonction : la preuve qu'elle rend le bon identifiant doit donc être posée
 * ici, pas seulement à l'écran. Le jeu ci-dessous contient délibérément DEUX
 * lieux du MÊME nom — le cas qui motive toute la mission
 * (`lieu_marche.nom` n'est pas contraint UNIQUE en base,
 * `packages/db/src/schema.ts`) — pour prouver que la clé étrangère
 * `session_marche.lieu_id`, elle, ne confond jamais les deux, contrairement à
 * une résolution par nom.
 */
describe('prochaineSessionPlanifiee — le lieuId réel de la session, jamais un nom ambigu', () => {
  it('rend le lieuId de la session, distinct de son homonyme', () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const lieuVoulu = insererLieu(base, 'La Batte');
    // Second lieu, EXACTEMENT le même nom que celui de la session : le cas
    // qui rendrait une résolution par nom ambiguë. La session, elle, pointe
    // sans ambiguïté sur `lieuVoulu` par sa clé étrangère.
    const lieuHomonyme = insererLieu(base, 'La Batte');
    expect(lieuHomonyme).not.toBe(lieuVoulu);

    const dateSession = '2026-08-09';
    const { id: sessionId } = creerSession(base, { lieuId: lieuVoulu, dateSession });

    const session = prochaineSessionPlanifiee(base, '2026-08-01');

    expect(session).not.toBeNull();
    expect(session!.id).toBe(sessionId);
    expect(session!.lieuId).toBe(lieuVoulu);
    expect(session!.lieuId).not.toBe(lieuHomonyme);
    expect(session!.lieuNom).toBe('La Batte');
  });

  it('rend `null` quand aucune session planifiée n’est à venir', () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);

    expect(prochaineSessionPlanifiee(base, '2026-08-01')).toBeNull();
  });
});
