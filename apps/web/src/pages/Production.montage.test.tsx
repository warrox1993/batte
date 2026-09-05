/**
 * Écran `Production` MONTÉ — l'écran qui CONSOMME du stock, sans retour.
 *
 * ═══ Pourquoi ce fichier existe ═══
 *
 * `Production.test.tsx`, à côté, mesure les largeurs et la troncature des
 * colonnes de l'historique. Il reste valable et n'est pas touché. Mais mesuré
 * le 01/08/2026, l'écran entier n'était couvert qu'à 16,40 % : le contrôle de
 * faisabilité en direct (avec son anti-rebond de 300 ms), le refus de lancer
 * une production infaisable, la saisie du réalisé, le rattachement de session
 * après coup, l'annulation D-087 et ses reprises de focus — rien n'était
 * atteignable, faute de DOM.
 *
 * L'écriture couverte ici est la plus irréversible du produit après la clôture
 * de session : `POST /productions` consomme des lots en FEFO. Chaque refus
 * vérifié plus bas est donc un lancement empêché, pas un confort d'interface.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  TIRET_ABSENT,
  formaterEuros,
  formaterMontant,
  formaterQuantite,
  type Faisabilite,
  type ProductionDetail,
} from '@batte/core';

/**
 * `formaterEuros` passe par `Intl`, qui insère une espace INSÉCABLE avant le
 * « € ». Deux chaînes visuellement identiques ne sont donc jamais égales tant
 * qu'on n'a pas normalisé les DEUX côtés — et jamais l'un contre un littéral
 * tapé à la main (docs/39 §10). Même fonction que dans
 * `ProchaineSession.montage.test.tsx`.
 */
function normaliser(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim();
}

// `ErreurApi` reste la VRAIE classe : l'écran fait un `instanceof` dessus pour
// choisir entre le message français du serveur et son repli générique.
import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  // `import type * as …` et non `typeof import(...)` : la règle ESLint
  // `consistent-type-imports` interdit la seconde forme — même formulation que
  // `BoutonDocument.montage.test.tsx`, le modèle de ce dépôt.
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: Production } = await import('./Production');

const appelApi = vi.mocked(requeteApi);

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

const RECETTE_R1 = {
  id: 'rec-r1',
  code: 'R1',
  nom: 'Pâte à crêpes froment',
  version: 1,
  statut: 'active' as const,
  sansGluten: false,
  rendementReferenceMl: 5_000,
  rendementReferenceCrepes: 66,
  nbLignes: 8,
  coutParCrepeCents: 33,
};

/** Brouillon : NON produisible. Discriminant du filtre « recettes actives ». */
const RECETTE_BROUILLON = {
  ...RECETTE_R1,
  id: 'rec-r3',
  code: 'R3',
  nom: 'Essai vanille',
  statut: 'brouillon' as const,
};

const SESSION_PLANIFIEE = {
  id: 'ses-1',
  numero: 'SM-2026-0002',
  lieuId: 'lieu-batte',
  lieuNom: 'La Batte',
  dateSession: '2026-08-02',
  statut: 'planifiee' as const,
  caTotalCents: null,
  margeNetteCents: null,
  tauxEcoulementBp: null,
  ecartCaisseCents: null,
  crepesVendues: 0,
  exclureDuModele: false,
  evenementId: null,
  evenementNom: null,
};

/** Clôturée : jamais proposable au rattachement (D-024, agrégats figés). */
const SESSION_CLOTUREE = {
  ...SESSION_PLANIFIEE,
  id: 'ses-close',
  numero: 'SM-2026-0001',
  dateSession: '2026-07-26',
  statut: 'cloturee' as const,
};

function faisabilite(surcharges: Partial<Faisabilite> = {}): Faisabilite {
  return {
    faisable: true,
    besoins: [
      {
        ingredientId: 'ing-farine',
        nomIngredient: 'Farine de froment T55',
        unite: 'g',
        requis: 4_000,
        disponible: 21_000,
        manquant: 0,
      },
      {
        ingredientId: 'ing-lait',
        nomIngredient: 'Lait entier',
        unite: 'ml',
        requis: 6_600,
        disponible: 12_000,
        manquant: 0,
      },
    ],
    manquants: [],
    ingredientLimitant: null,
    volumeMaximalMl: 15_000,
    volumeMl: 5_000,
    crepes: 66,
    ...surcharges,
  };
}

const MANQUE_FARINE = {
  ingredientId: 'ing-farine',
  nomIngredient: 'Farine de froment T55',
  unite: 'g' as const,
  requis: 4_000,
  disponible: 1_200,
  manquant: 2_800,
};

function detailProduction(surcharges: Partial<ProductionDetail> = {}): ProductionDetail {
  return {
    id: 'prod-1',
    numero: 'PR-2026-0007',
    recetteCode: 'R1',
    recetteNom: 'Pâte à crêpes froment',
    dateProduction: '2026-07-31',
    statut: 'lancee',
    volumeTheoriqueMl: 5_000,
    crepesTheoriques: 66,
    volumeReelMl: null,
    crepesReelles: null,
    coutMatiereTheoriqueCents: 2_178,
    // Ajouté au contrat le 01/08/2026 par une mission voisine : `null` = coût
    // réel PAS ENCORE connu, jamais 0 — un zéro afficherait 100 % de marge.
    coutMatiereReelCents: null,
    numeroLotPate: 'PATE-PR-2026-0007',
    dateDlcPate: '2026-08-01',
    sessionId: null,
    sessionNumero: null,
    sessionStatut: null,
    ecartMotif: null,
    notes: null,
    consommations: [
      {
        lotId: 'lot-farine-a',
        ingredientId: 'ing-farine',
        nomIngredient: 'Farine de froment T55',
        unite: 'g',
        numeroLotFournisseur: 'LOT-2026-0731-A',
        quantiteTheorique: 4_000,
        // `null` = non déclaré, JAMAIS 0.
        quantiteReelle: null,
        coutCents: 480,
        // Production `lancee` : aucun réalisé saisi, donc AUCUNE mesure du
        // réel — ni quantité mouvementée, ni coût. `null` partout, jamais 0
        // (`packages/db/src/depots/productions.ts` : le discriminant est
        // `coutMatiereReelCents !== null`).
        quantiteMouvementee: null,
        coutReelCents: null,
      },
      {
        lotId: 'lot-lait-b',
        ingredientId: 'ing-lait',
        nomIngredient: 'Lait entier',
        unite: 'ml',
        numeroLotFournisseur: null,
        quantiteTheorique: 6_600,
        quantiteReelle: 6_800,
        coutCents: 1_698,
        quantiteMouvementee: null,
        coutReelCents: null,
      },
    ],
    ecartRendementBp: null,
    coutMatiereReelNonAffecteCents: null,
    previsionId: null,
    previsionDateCalcul: null,
    previsionP50Crepes: null,
    previsionCrepesRetenues: null,
    ecartVsPrevisionBp: null,
    ...surcharges,
  };
}

/**
 * Production TERMINÉE, avec un réalisé saisi — le seul état où les colonnes de
 * coût RÉEL portent des chiffres.
 *
 * ═══ POURQUOI CES NOMBRES-LÀ ═══
 *
 * Ils ne tombent pas ronds, et c'est délibéré (docs/39 §7) : l'invariant
 * `somme(coutReelCents) + coutMatiereReelNonAffecteCents === coutMatiereReelCents`
 * doit être vérifiable à l'œil sur l'écran, et un jeu de nombres ronds le
 * rendrait vrai par accident. Ici 498 + 1 751 + 0 + 33 = 2 282.
 *
 * ═══ TROIS SITUATIONS DISTINCTES, UNE PAR LIGNE ═══
 *
 *  1. FARINE — la fournée a puisé dans DEUX lots pour cet ingrédient :
 *     `quantiteReelle` reste `null` (l'attribuer à l'un des deux inventerait
 *     une mesure) alors que le grand livre, lui, a bien enregistré 4 150 g sur
 *     CE lot. C'est le cas qui prouve que la colonne « Sorti » lit
 *     `quantiteMouvementee` : avec l'ancienne source, la ligne
 *     afficherait « — » à côté d'un coût réel de 4,98 €.
 *  2. LAIT — un seul lot : les deux quantités coïncident. Sans ce voisin, le
 *     cas 1 pourrait passer pour un accident de fixture.
 *  3. BEURRE — matière intégralement RESTITUÉE : `coutReelCents === 0`. C'est
 *     un VRAI zéro, et c'est le cœur de la colonne « Coût réel » : il ne doit
 *     PAS s'afficher « — ».
 */
function detailTermine(surcharges: Partial<ProductionDetail> = {}): ProductionDetail {
  return detailProduction({
    statut: 'terminee',
    volumeReelMl: 4_800,
    crepesReelles: 63,
    coutMatiereTheoriqueCents: 2_178,
    coutMatiereReelCents: 2_282,
    coutMatiereReelNonAffecteCents: 33,
    consommations: [
      {
        lotId: 'lot-farine-a',
        ingredientId: 'ing-farine',
        nomIngredient: 'Farine de froment T55',
        unite: 'g',
        numeroLotFournisseur: 'LOT-2026-0731-A',
        quantiteTheorique: 4_000,
        quantiteReelle: null,
        coutCents: 480,
        quantiteMouvementee: 4_150,
        coutReelCents: 498,
      },
      {
        lotId: 'lot-lait-b',
        ingredientId: 'ing-lait',
        nomIngredient: 'Lait entier',
        unite: 'ml',
        numeroLotFournisseur: 'LOT-2026-0731-B',
        quantiteTheorique: 6_600,
        quantiteReelle: 6_800,
        coutCents: 1_698,
        quantiteMouvementee: 6_800,
        coutReelCents: 1_751,
      },
      {
        lotId: 'lot-beurre-c',
        ingredientId: 'ing-beurre',
        nomIngredient: 'Beurre doux',
        unite: 'g',
        numeroLotFournisseur: 'LOT-2026-0731-C',
        quantiteTheorique: 1_500,
        quantiteReelle: 0,
        coutCents: 1_020,
        quantiteMouvementee: 0,
        coutReelCents: 0,
      },
    ],
    ecartRendementBp: -400,
    ...surcharges,
  });
}

const PARAMETRE_HORIZON_DLC = {
  id: 'par-1',
  cle: 'brief_horizon_alerte_dlc_jours',
  valeur: '7',
  typeValeur: 'entier' as const,
  dateDebutValidite: '2026-01-01',
  dateFinValidite: null,
  source: 'catalogue',
  description: "Fenêtre d'alerte DLC",
  creeLe: '2026-01-01T00:00:00.000Z',
  modifieLe: '2026-01-01T00:00:00.000Z',
};

type Monde = {
  recettes?: unknown[];
  sessions?: unknown[];
  productions?: unknown[];
  previsions?: unknown[];
  parametres?: unknown[];
  /** Réponse de `POST /productions/faisabilite`, ou une erreur à lever. */
  faisabilite?: Faisabilite | Error;
};

/**
 * Routeur des lectures. Les écritures (`POST /productions`, `PATCH …/realise`,
 * `PATCH …/session`, `POST …/annuler`) sont surchargées test par test : les
 * mélanger ici rendrait chaque test dépendant du réglage des autres.
 */
function routerLectures(monde: Monde = {}): void {
  const recettes = monde.recettes ?? [RECETTE_R1, RECETTE_BROUILLON];
  const sessions = monde.sessions ?? [SESSION_PLANIFIEE, SESSION_CLOTUREE];
  const productions = monde.productions ?? [];
  const previsions = monde.previsions ?? [];
  const parametres = monde.parametres ?? [PARAMETRE_HORIZON_DLC];
  const resultatFaisabilite = monde.faisabilite ?? faisabilite();

  appelApi.mockImplementation(async (chemin: string) => {
    if (chemin === '/parametres') return { data: parametres, meta: { total: parametres.length } };
    if (chemin === '/recettes') return { data: recettes, meta: { total: recettes.length } };
    if (chemin === '/sessions') return { data: sessions, meta: { total: sessions.length } };
    if (chemin === '/previsions') return { data: previsions, meta: { total: previsions.length } };
    if (chemin === '/productions')
      return { data: productions, meta: { total: productions.length } };
    if (chemin === '/productions/faisabilite') {
      if (resultatFaisabilite instanceof Error) throw resultatFaisabilite;
      return resultatFaisabilite;
    }
    const detail = (productions as ProductionDetail[]).find(
      (p) => chemin === `/productions/${p.id}`,
    );
    if (detail !== undefined) return detail;
    throw new Error(`Chemin non prévu par la fixture : ${chemin}`);
  });
}

function monter(): void {
  render(
    <MemoryRouter>
      <Production />
    </MemoryRouter>,
  );
}

/**
 * Monte, puis attend la fin du contrôle de faisabilité (anti-rebond compris).
 *
 * `attendreTableau` : le tableau des besoins n'existe que si le contrôle a
 * ABOUTI. Quand la fixture le fait échouer volontairement, l'attendre ferait
 * échouer le montage plutôt que ce que le test vérifie.
 */
async function monterAvecFaisabilite(monde: Monde = {}, attendreTableau = true): Promise<void> {
  routerLectures(monde);
  monter();
  await screen.findByRole('combobox', { name: 'Recette' });
  await vi.advanceTimersByTimeAsync(400);
  if (attendreTableau) await screen.findByRole('table');
}

const champValeur = () => screen.getByRole('textbox', { name: /crêpes visé|pâte visé/ });
const boutonLancer = () => screen.getByRole('button', { name: /Lancer la production|Lancement…/ });

beforeEach(() => {
  appelApi.mockReset();
  // Anti-rebond de 300 ms sur la faisabilité : sans horloge maîtrisée, chaque
  // test paierait une attente réelle, et le déclenchement resterait une
  // question de chance plutôt qu'une observation.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Chargements : prêt, erreur, référentiel vide
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Production — les états de chargement du référentiel', () => {
  it('annonce le chargement des recettes tant que rien n’est revenu', () => {
    appelApi.mockImplementation(() => new Promise(() => {}));
    monter();

    expect(screen.getByText('Chargement des recettes…')).toBeInTheDocument();
    expect(screen.getByText("Chargement de l'historique…")).toBeInTheDocument();
  });

  it('un échec du chargement des recettes affiche le message du serveur', async () => {
    appelApi.mockImplementation(async (chemin: string) => {
      if (chemin === '/recettes')
        throw new ErreurApi('Le référentiel des recettes est indisponible.', {
          code: 'indisponible',
          statut: 503,
        });
      throw new ErreurApi('Autre', { code: 'x', statut: 500 });
    });
    monter();

    expect(
      await screen.findByText('Le référentiel des recettes est indisponible.'),
    ).toBeInTheDocument();
  });

  it(
    'sans AUCUNE recette active, l’écran refuse le formulaire et renvoie vers Recettes — une ' +
      'recette `brouillon` n’a pas de sens à produire',
    async () => {
      routerLectures({ recettes: [RECETTE_BROUILLON] });
      monter();

      expect(await screen.findByText('Aucune recette active')).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Recette' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Aller aux recettes' })).toBeInTheDocument();
    },
  );

  it('la liste des recettes proposées exclut les brouillons', async () => {
    await monterAvecFaisabilite();

    const options = [
      ...(screen.getByRole('combobox', { name: 'Recette' }) as HTMLSelectElement).options,
    ].map((o) => o.textContent);
    expect(options).toContain('R1 — Pâte à crêpes froment');
    // Discriminant : sans cette exclusion, R3 apparaîtrait aussi.
    expect(options).not.toContain('R3 — Essai vanille');
  });

  it('le formulaire démarre sur le rendement RÉEL de la recette, jamais sur un chiffre inventé', async () => {
    await monterAvecFaisabilite();

    expect(champValeur()).toHaveValue('5000');
    expect(screen.getByRole('radio', { name: 'Un volume de pâte' })).toBeChecked();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Faisabilité : l'anti-rebond, le refus, et le volume maximal
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Production — le contrôle de faisabilité en direct', () => {
  it(
    'QUATRE frappes rapides ne font QU’UN appel : c’est ce que l’anti-rebond de 300 ms achète, ' +
      'et l’appel n’arrive qu’une fois la frappe finie',
    async () => {
      const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await monterAvecFaisabilite();

      const valeur = champValeur();
      appelApi.mockClear();
      await utilisateur.clear(valeur);
      await utilisateur.type(valeur, '7500');

      /*
        MESURER « rien n'est parti après 200 ms » NE SUFFIT PAS, et c'est le
        piège relevé le 01/08/2026 : mettre `DELAI_DEBOUNCE_MS` à 0 laissait le
        test vert, parce que l'appel immédiat partait AVANT le `mockClear` du
        montage. Ce qui discrimine, c'est le NOMBRE d'appels pour une rafale de
        frappes : un anti-rebond en fait UN, son absence en fait un par touche.
      */
      const appelsPendantLaFrappe = appelApi.mock.calls.filter(
        ([c]) => c === '/productions/faisabilite',
      ).length;
      expect(appelsPendantLaFrappe).toBe(0);

      await vi.advanceTimersByTimeAsync(400);
      await waitFor(() =>
        expect(appelApi).toHaveBeenCalledWith('/productions/faisabilite', expect.anything()),
      );
      expect(appelApi.mock.calls.filter(([c]) => c === '/productions/faisabilite')).toHaveLength(1);
    },
  );

  it('affiche la cible en volume ET en crêpes, via les formateurs', async () => {
    await monterAvecFaisabilite();

    expect(screen.getByText(formaterQuantite(5_000, 'ml'))).toBeInTheDocument();
    expect(screen.getByText('66 crêpes')).toBeInTheDocument();
    expect(screen.getByText('Réalisable avec le stock actuel')).toBeInTheDocument();
  });

  it(
    'une valeur illisible affiche son refus IMMÉDIATEMENT et annule le contrôle — l’erreur de ' +
      'saisie n’attend pas l’anti-rebond',
    async () => {
      const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await monterAvecFaisabilite();
      appelApi.mockClear();

      await utilisateur.clear(champValeur());
      await utilisateur.type(champValeur(), 'beaucoup');

      expect(
        screen.getByText('Le volume doit être un nombre entier positif, en millilitres.'),
      ).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(400);
      expect(appelApi).not.toHaveBeenCalledWith('/productions/faisabilite', expect.anything());
      expect(boutonLancer()).toBeDisabled();
    },
  );

  it('le message de refus change avec la cible choisie (crêpes ≠ volume)', async () => {
    const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await monterAvecFaisabilite();

    await utilisateur.click(screen.getByRole('radio', { name: 'Un nombre de crêpes' }));
    await utilisateur.clear(champValeur());
    await utilisateur.type(champValeur(), 'plein');

    expect(
      screen.getByText('Le nombre de crêpes doit être un nombre entier positif.'),
    ).toBeInTheDocument();
  });

  it('une date vidée bloque le contrôle, avec son propre message', async () => {
    const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await monterAvecFaisabilite();

    await utilisateur.clear(screen.getByLabelText('Date de production'));

    expect(screen.getByText('La date de production est obligatoire.')).toBeInTheDocument();
    expect(boutonLancer()).toBeDisabled();
  });

  it(
    'une production INFAISABLE nomme l’ingrédient limitant, propose le volume maximal, et ' +
      'VERROUILLE le lancement',
    async () => {
      await monterAvecFaisabilite({
        faisabilite: faisabilite({
          faisable: false,
          besoins: [MANQUE_FARINE],
          manquants: [MANQUE_FARINE],
          ingredientLimitant: MANQUE_FARINE,
          volumeMaximalMl: 1_500,
        }),
      });

      const alerte = await screen.findByRole('alert');
      expect(alerte).toHaveTextContent('Farine de froment T55');
      expect(alerte).toHaveTextContent(formaterQuantite(1_500, 'ml'));
      // LE point : le stock est consommé en FEFO de façon irréversible.
      expect(boutonLancer()).toBeDisabled();
    },
  );

  it('« Utiliser ce volume comme cible » reprend le nombre du SERVEUR, sans arithmétique locale', async () => {
    const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await monterAvecFaisabilite({
      faisabilite: faisabilite({
        faisable: false,
        besoins: [MANQUE_FARINE],
        manquants: [MANQUE_FARINE],
        ingredientLimitant: MANQUE_FARINE,
        volumeMaximalMl: 1_500,
      }),
    });

    await screen.findByRole('alert');
    await utilisateur.click(screen.getByRole('button', { name: 'Utiliser ce volume comme cible' }));

    expect(champValeur()).toHaveValue('1500');
  });

  it(
    'un stock à ZÉRO ne propose aucun repli : « Aucune production n’est réalisable », jamais un ' +
      'bouton qui poserait 0 ml comme cible',
    async () => {
      await monterAvecFaisabilite({
        faisabilite: faisabilite({
          faisable: false,
          besoins: [MANQUE_FARINE],
          manquants: [MANQUE_FARINE],
          ingredientLimitant: MANQUE_FARINE,
          volumeMaximalMl: 0,
        }),
      });

      await screen.findByText("Aucune production n'est réalisable avec le stock actuel.");
      expect(
        screen.queryByRole('button', { name: 'Utiliser ce volume comme cible' }),
      ).not.toBeInTheDocument();
    },
  );

  it('les besoins MANQUANTS sont affichés en tête du tableau, avant les conformes', async () => {
    const laitConforme = {
      ingredientId: 'ing-lait',
      nomIngredient: 'Lait entier',
      unite: 'ml' as const,
      requis: 6_600,
      disponible: 12_000,
      manquant: 0,
    };
    await monterAvecFaisabilite({
      faisabilite: faisabilite({
        faisable: false,
        // La farine est en SECONDE position dans `besoins` : si le tri ne se
        // faisait pas, elle resterait après le lait — c'est ce qui discrimine.
        besoins: [laitConforme, MANQUE_FARINE],
        manquants: [MANQUE_FARINE],
        ingredientLimitant: MANQUE_FARINE,
        volumeMaximalMl: 1_500,
      }),
    });

    const rangees = within(screen.getByRole('table')).getAllByRole('row');
    // `rangees[0]` est l'en-tête.
    expect(rangees[1]).toHaveTextContent('Farine de froment T55');
    expect(rangees[2]).toHaveTextContent('Lait entier');
  });

  it('un échec du contrôle de faisabilité s’affiche sans bloquer le reste de l’écran', async () => {
    await monterAvecFaisabilite(
      {
        faisabilite: new ErreurApi('Le contrôle de faisabilité a échoué.', {
          code: 'interne',
          statut: 500,
        }),
      },
      false,
    );

    expect(await screen.findByText('Le contrôle de faisabilité a échoué.')).toBeInTheDocument();
    expect(boutonLancer()).toBeDisabled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Lancement
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Production — lancer une production', () => {
  it('envoie la cible, la date et la session choisie, puis ouvre le détail de la production créée', async () => {
    const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await monterAvecFaisabilite();

    const cree = detailProduction();
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/productions' && options?.method === 'POST') return cree;
      if (chemin === '/productions/prod-1') return cree;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.selectOptions(
      screen.getByRole('combobox', { name: /^Session de destination/ }),
      'ses-1',
    );
    await utilisateur.click(boutonLancer());

    await waitFor(() =>
      expect(appelApi).toHaveBeenCalledWith(
        '/productions',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const appel = appelApi.mock.calls.find(
      ([c, o]) => c === '/productions' && (o as RequestInit | undefined)?.method === 'POST',
    );
    const corps = JSON.parse(String((appel?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(corps).toMatchObject({
      recetteId: 'rec-r1',
      cible: { cible: 'volume', valeur: 5000 },
      sessionId: 'ses-1',
      // Aucune prévision archivée pour cette session : `null`, jamais devinée.
      previsionId: null,
    });

    expect(await screen.findByText('Production PR-2026-0007 lancée.')).toBeInTheDocument();
  });

  it(
    'seules les sessions PLANIFIÉES sont proposables : une session clôturée a des agrégats ' +
      'figés (D-024)',
    async () => {
      await monterAvecFaisabilite();

      const options = [
        ...(screen.getByRole('combobox', { name: /^Session de destination/ }) as HTMLSelectElement)
          .options,
      ].map((o) => o.value);
      expect(options).toContain('ses-1');
      expect(options).not.toContain('ses-close');
    },
  );

  it('sans prévision archivée pour la session choisie, l’écran le DIT — il n’en invente pas une', async () => {
    const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await monterAvecFaisabilite();

    await utilisateur.selectOptions(
      screen.getByRole('combobox', { name: /^Session de destination/ }),
      'ses-1',
    );

    expect(
      screen.getByText('Aucune prévision archivée pour cette session : lancée sans référence.'),
    ).toBeInTheDocument();
  });

  it('la prévision archivée de la session choisie est affichée AVANT le clic, et c’est elle qui part', async () => {
    const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await monterAvecFaisabilite({
      previsions: [
        {
          id: 'prev-recente',
          dateCalcul: '2026-08-01T18:00:00.000Z',
          versionModele: 'v3',
          sessionId: 'ses-1',
          sessionNumero: 'SM-2026-0002',
          dateSession: '2026-08-02',
          p50Crepes: 120,
          crepesRecommandees: 134,
          crepesRetenues: 134,
          crepesReelles: null,
          erreurAbsolueBp: null,
          confianceBp: 7_000,
        },
        {
          id: 'prev-ancienne',
          dateCalcul: '2026-07-28T18:00:00.000Z',
          versionModele: 'v3',
          sessionId: 'ses-1',
          sessionNumero: 'SM-2026-0002',
          dateSession: '2026-08-02',
          p50Crepes: 100,
          crepesRecommandees: 110,
          crepesRetenues: 110,
          crepesReelles: null,
          erreurAbsolueBp: null,
          confianceBp: 6_000,
        },
      ],
    });

    const cree = detailProduction();
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/productions' && options?.method === 'POST') return cree;
      if (chemin === '/productions/prod-1') return cree;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.selectOptions(
      screen.getByRole('combobox', { name: /^Session de destination/ }),
      'ses-1',
    );
    expect(screen.getByText(/134 crêpes retenues/)).toBeInTheDocument();

    await utilisateur.click(boutonLancer());

    await waitFor(() =>
      expect(appelApi).toHaveBeenCalledWith(
        '/productions',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const appel = appelApi.mock.calls.find(
      ([c, o]) => c === '/productions' && (o as RequestInit | undefined)?.method === 'POST',
    );
    const corps = JSON.parse(String((appel?.[1] as RequestInit).body)) as Record<string, unknown>;
    // La PLUS RÉCENTE, celle affichée : `/previsions` rend déjà la liste triée,
    // et l'écran prend le premier élément qui correspond — jamais un choix
    // refait côté serveur après coup.
    expect(corps['previsionId']).toBe('prev-recente');
  });

  it('un refus du serveur au lancement s’affiche, et l’historique reste intact', async () => {
    const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await monterAvecFaisabilite();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/productions' && options?.method === 'POST')
        throw new ErreurApi(
          'Stock insuffisant : un lot vient d’être consommé par une autre saisie.',
          {
            code: 'stock_insuffisant',
            statut: 422,
          },
        );
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(boutonLancer());

    expect(
      await screen.findByText(
        'Stock insuffisant : un lot vient d’être consommé par une autre saisie.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Aucune production enregistrée')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Détail : traçabilité, réalisé, rattachement, annulation
   ═══════════════════════════════════════════════════════════════════════════ */

/** Monte l'écran avec UNE production à l'historique, et ouvre son détail. */
async function ouvrirDetail(
  detail: ProductionDetail = detailProduction(),
): Promise<ReturnType<typeof userEvent.setup>> {
  const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await monterAvecFaisabilite({ productions: [detail] });
  await utilisateur.click(screen.getByText(detail.numero));
  await screen.findByRole('button', { name: 'Fermer' });
  return utilisateur;
}

describe('Production — le panneau de détail : traçabilité et valeurs inconnues', () => {
  it(
    'sur une production LANCÉE, aucune mesure du réel n’existe : quantité ET coût réels ' +
      's’affichent « — », jamais « 0 g » ni « 0,00 »',
    async () => {
      await ouvrirDetail();

      const rangeeFarine = screen.getByText('LOT-2026-0731-A').closest('tr');
      expect(rangeeFarine).not.toBeNull();
      const ligne = within(rangeeFarine as HTMLElement);
      /*
        La colonne « Sorti » (quantité) n'est PAS fusionnée : son tiret reste
        un texte de cellule autonome, comme avant. `ouTiret` (`Production.tsx`)
        le pose : on l'exige.
      */
      expect(ligne.getByText(TIRET_ABSENT)).toBeInTheDocument();
      expect(ligne.queryByText(formaterQuantite(0, 'g'))).not.toBeInTheDocument();
      /*
        La colonne « Coût » EST fusionnée (01/08/2026, correctif troncature
        d'en-tête) : théorique et réel vivent dans la MÊME cellule
        (« 4,80 / — »), donc le tiret du coût réel n'est plus un texte de
        cellule à part — il faut lire la cellule ENTIÈRE. Le coût THÉORIQUE,
        lui, existe dès le lancement (jamais `null`) : sans ce voisin, une
        cellule tout en tiret rendrait ce test vert sans discriminer.
      */
      const celluleCout = ligne.getByText(`${formaterMontant(480)} / ${TIRET_ABSENT}`);
      expect(celluleCout).toBeInTheDocument();
      expect(celluleCout.textContent).not.toContain(formaterMontant(0));
    },
  );

  /* ═══════════════════════════════════════════════════════════════════════
     Le coût RÉEL — servi par la route, affiché nulle part avant le 01/08/2026,
     puis FUSIONNÉ avec le théorique le même jour (correctif de troncature
     d'en-tête : « Coût théo. » et « Coût réel » séparés tronquaient en
     « COÛ… » / « COÛT … », indiscernables l'un de l'autre)
     ═══════════════════════════════════════════════════════════════════════

     Ce que le porteur lisait AVANT le 01/08/2026 : le coût THÉORIQUE, figé au
     lancement, pendant que la clôture de session facturait le coût RÉEL à la
     marge du marché (`coutMatiereReelCents`, lu par `cloturerSession`). Deux
     chiffres différents pour la même fournée, dont un seul était visible — et
     c'était le mauvais. Aucun test unitaire ne pouvait le voir : la valeur
     était bien en base (docs/39 §7). */

  it('les DEUX coûts sont affichés dans LA MÊME colonne, théorique puis réel', async () => {
    await ouvrirDetail(detailTermine());

    // Le tableau est désigné par une de SES cellules, jamais par un index
    // dans `getAllByRole('table')` : trois tableaux coexistent sur cet écran
    // (besoins, historique, consommations), et un index se décalerait au
    // premier ajout de panneau.
    const tableau = screen.getByText('LOT-2026-0731-A').closest('table');
    expect(tableau).not.toBeNull();
    const enTetes = within(tableau as HTMLElement)
      .getAllByRole('columnheader')
      .map((e) => e.textContent);
    // UNE SEULE colonne de coût désormais : plus de « Coût théo. »/« Coût
    // réel » séparés — c'est l'ambiguïté elle-même qui est éliminée, pas
    // seulement sa troncature.
    expect(enTetes).toContain('Coût');
    expect(enTetes).not.toContain('Coût théo.');
    expect(enTetes).not.toContain('Coût réel');
    // Les deux mots entiers restent joignables via `libelleLong`.
    const coutEntete = within(tableau as HTMLElement).getByRole('columnheader', { name: 'Coût' });
    expect(coutEntete).toHaveAttribute('title', expect.stringContaining('théorique'));
    expect(coutEntete).toHaveAttribute('title', expect.stringContaining('réel'));
    // La cellule farine : « 4,80 / 4,98 » (théorique puis réel, même ordre
    // que le reste du tableau).
    expect(
      screen.getByText(`${formaterMontant(480)} / ${formaterMontant(498)}`),
    ).toBeInTheDocument();
  });

  it(
    'un coût réel de ZÉRO s’affiche « 0,00 » — lot intégralement restitué, pas une mesure ' +
      'manquante : c’est le cœur de la colonne',
    async () => {
      await ouvrirDetail(detailTermine());

      const rangeeBeurre = screen.getByText('LOT-2026-0731-C').closest('tr');
      expect(rangeeBeurre).not.toBeNull();
      // Cellule fusionnée « 10,20 / 0,00 » : le VRAI zéro du réel est visible
      // À CÔTÉ du théorique, jamais confondu avec un tiret.
      expect(
        within(rangeeBeurre as HTMLElement).getByText(
          `${formaterMontant(1_020)} / ${formaterMontant(0)}`,
        ),
      ).toBeInTheDocument();
      expect(within(rangeeBeurre as HTMLElement).queryByText(TIRET_ABSENT)).not.toBeInTheDocument();
      // Les voisins portent de vrais montants différents : sans eux, une
      // colonne remplie de zéros passerait pour un succès.
      expect(
        screen.getByText(`${formaterMontant(1_698)} / ${formaterMontant(1_751)}`),
      ).toBeInTheDocument();
      expect(
        screen.getByText(`${formaterMontant(480)} / ${formaterMontant(498)}`),
      ).toBeInTheDocument();
    },
  );

  it(
    'la colonne « Sorti » lit la quantité MOUVEMENTÉE, pas la quantité déclarée — sinon la ligne ' +
      'multi-lot montrerait « — » à côté d’un coût réel chiffré',
    async () => {
      await ouvrirDetail(detailTermine());

      // L'EN-TÊTE RENDU, et son infobulle. « Réel » a été renommé « Sorti » le
      // 01/08/2026 (le premier ne disait que ce que le chiffre n'est PAS) et
      // aucun test monté ne regardait cet en-tête-là : seule la définition de
      // colonnes était vérifiée, dans `Production.test.tsx`. « Sorti » est une
      // ABRÉVIATION de « Sorti du lot » — l'intitulé entier ne remonte donc
      // que par le `title`, qui est ce que `Tableau.tsx` alimente depuis
      // `libelleLong`.
      const tableau = screen.getByText('LOT-2026-0731-A').closest('table');
      expect(tableau).not.toBeNull();
      const enTeteSorti = within(tableau as HTMLElement).getByRole('columnheader', {
        name: 'Sorti',
      });
      expect(enTeteSorti).toHaveAttribute('title', expect.stringContaining('Sorti du lot'));
      expect(enTeteSorti).toHaveAttribute('title', expect.stringContaining('mouvementée'));
      expect(
        within(tableau as HTMLElement)
          .getAllByRole('columnheader')
          .map((e) => e.textContent),
      ).not.toContain('Réel');

      const rangeeFarine = screen.getByText('LOT-2026-0731-A').closest('tr');
      expect(rangeeFarine).not.toBeNull();
      // `quantiteReelle` vaut `null` sur cette ligne (deux lots pour le même
      // ingrédient) ; `quantiteMouvementee` vaut 4 150 g.
      expect(
        within(rangeeFarine as HTMLElement).getByText(formaterQuantite(4_150, 'g')),
      ).toBeInTheDocument();
      expect(within(rangeeFarine as HTMLElement).queryByText(TIRET_ABSENT)).not.toBeInTheDocument();
    },
  );

  it('le total du coût matière RÉEL est affiché, et « — » tant qu’il n’est pas mesuré', async () => {
    await ouvrirDetail(detailTermine());

    const total = screen.getByText(/Coût matière réel de la fournée/);
    expect(normaliser(total.textContent ?? '')).toContain(normaliser(formaterEuros(2_282)));
  });

  it('sur une production LANCÉE, ce même total vaut « — », jamais « 0,00 € »', async () => {
    await ouvrirDetail();

    const total = screen.getByText(/Coût matière réel de la fournée/);
    expect(total).toHaveTextContent(TIRET_ABSENT);
    expect(normaliser(total.textContent ?? '')).not.toContain(normaliser(formaterEuros(0)));
  });

  it(
    'une sur-consommation servie par un lot HORS fournée est chiffrée ET signalée comme un trou ' +
      'de traçabilité',
    async () => {
      await ouvrirDetail(detailTermine());

      const alerte = screen.getByText(/Sur-consommation servie par un lot hors fournée/);
      expect(normaliser(alerte.textContent ?? '')).toContain(normaliser(formaterEuros(33)));
      // La conséquence AFSCA, pas seulement le montant : ce lot n'apparaît
      // dans aucune ligne du tableau ci-dessus.
      expect(alerte).toHaveTextContent('rappel de marchandise');
    },
  );

  it('un reliquat de ZÉRO n’affiche RIEN : c’est le cas normal, et un bandeau permanent cesse d’être lu', async () => {
    await ouvrirDetail(detailTermine({ coutMatiereReelNonAffecteCents: 0 }));

    expect(
      screen.queryByText(/Sur-consommation servie par un lot hors fournée/),
    ).not.toBeInTheDocument();
    // Le reste du bloc, lui, est bien là : l'absence ci-dessus n'est pas celle
    // du bloc entier.
    expect(screen.getByText(/Coût matière réel de la fournée/)).toBeInTheDocument();
  });

  it('un reliquat encore INCONNU (réalisé non saisi) n’affiche rien non plus', async () => {
    await ouvrirDetail();

    expect(
      screen.queryByText(/Sur-consommation servie par un lot hors fournée/),
    ).not.toBeInTheDocument();
  });

  it('une production SANS session rattachée porte une alerte, jamais un tiret muet', async () => {
    await ouvrirDetail();

    expect(
      screen.getByText("Aucune session rattachée : son coût matière n'entre dans aucune marge."),
    ).toBeInTheDocument();
  });

  it('une session déjà CLÔTURÉE verrouille le rattachement, et le dit avant le clic', async () => {
    await ouvrirDetail(
      detailProduction({
        sessionId: 'ses-close',
        sessionNumero: 'SM-2026-0001',
        sessionStatut: 'cloturee',
      }),
    );

    // Phrase COMPLÈTE : « agrégats figés » apparaît aussi dans la raison de
    // blocage de l'annulation, juste en dessous. Une requête partielle serait
    // ambiguë, et l'ambiguïté ferait passer le test pour l'autre bloc.
    expect(
      screen.getByText(
        /Session déjà clôturée : ses agrégats sont figés \(D-024\), le rattachement ne peut plus changer\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Rattacher à' })).not.toBeInTheDocument();
  });

  it('rattacher après coup envoie un PATCH et confirme avec le NUMÉRO de session', async () => {
    const utilisateur = await ouvrirDetail();

    const rattache = detailProduction({
      sessionId: 'ses-1',
      sessionNumero: 'SM-2026-0002',
      sessionStatut: 'planifiee',
    });
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/productions/prod-1/session') return rattache;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.selectOptions(screen.getByRole('combobox', { name: 'Rattacher à' }), 'ses-1');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Rattachée à la session SM-2026-0002.')).toBeInTheDocument();
    const appel = appelApi.mock.calls.find(([c]) => c === '/productions/prod-1/session');
    expect(JSON.parse(String((appel?.[1] as RequestInit).body))).toEqual({ sessionId: 'ses-1' });
  });

  it('détacher est un choix VALIDE : `sessionId: null` part, et la confirmation le dit', async () => {
    const utilisateur = await ouvrirDetail(
      detailProduction({
        sessionId: 'ses-1',
        sessionNumero: 'SM-2026-0002',
        sessionStatut: 'planifiee',
      }),
    );

    const detache = detailProduction({ sessionId: null, sessionNumero: null, sessionStatut: null });
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/productions/prod-1/session') return detache;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.selectOptions(screen.getByRole('combobox', { name: 'Rattacher à' }), '');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Détachée de toute session.')).toBeInTheDocument();
    const appel = appelApi.mock.calls.find(([c]) => c === '/productions/prod-1/session');
    expect(JSON.parse(String((appel?.[1] as RequestInit).body))).toEqual({ sessionId: null });
  });

  it('un refus du rattachement s’affiche sans effacer la sélection en cours', async () => {
    const utilisateur = await ouvrirDetail();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/productions/prod-1/session')
        throw new ErreurApi('Cette session est clôturée : ses agrégats sont figés.', {
          code: 'session_cloturee',
          statut: 422,
        });
      return routeurBase?.(chemin, options);
    });

    await utilisateur.selectOptions(screen.getByRole('combobox', { name: 'Rattacher à' }), 'ses-1');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByText('Cette session est clôturée : ses agrégats sont figés.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rattacher à' })).toHaveValue('ses-1');
  });
});

describe('Production — la saisie du réalisé', () => {
  it('n’est proposée que sur une production `lancee`', async () => {
    await ouvrirDetail(detailProduction({ statut: 'terminee' }));

    expect(screen.queryByText('Saisie du réalisé')).not.toBeInTheDocument();
  });

  it('part du THÉORIQUE pour le volume et les crêpes, mais laisse le motif VIERGE', async () => {
    await ouvrirDetail();

    expect(screen.getByRole('textbox', { name: 'Volume réel (ml)' })).toHaveValue('5000');
    expect(screen.getByRole('textbox', { name: 'Crêpes réelles' })).toHaveValue('66');
    expect(screen.getByRole('textbox', { name: "Motif d'écart (optionnel)" })).toHaveValue('');
  });

  it(
    'les champs de consommation réelle par ingrédient démarrent VIDES — un champ pré-rempli ' +
      'se valide sans être lu (docs/17 fiche 9)',
    async () => {
      await ouvrirDetail();

      expect(screen.getByRole('textbox', { name: /^Farine de froment T55/ })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: /^Lait entier/ })).toHaveValue('');
    },
  );

  it('un volume réel illisible bloque l’enregistrement', async () => {
    const utilisateur = await ouvrirDetail();

    const volume = screen.getByRole('textbox', { name: 'Volume réel (ml)' });
    await utilisateur.clear(volume);
    await utilisateur.type(volume, 'presque tout');

    expect(screen.getByRole('button', { name: 'Enregistrer le réalisé' })).toBeDisabled();
  });

  it('un réalisé à ZÉRO reste valide : une pâte entièrement jetée est une valeur, pas une absence', async () => {
    const utilisateur = await ouvrirDetail();

    const crepes = screen.getByRole('textbox', { name: 'Crêpes réelles' });
    await utilisateur.clear(crepes);
    await utilisateur.type(crepes, '0');

    expect(screen.getByRole('button', { name: 'Enregistrer le réalisé' })).toBeEnabled();
  });

  it('une consommation réelle non vide mais illisible bloque, sans bloquer les entrées vides', async () => {
    const utilisateur = await ouvrirDetail();

    const farine = screen.getByRole('textbox', { name: /^Farine de froment T55/ });
    await utilisateur.type(farine, 'un peu');
    expect(screen.getByRole('button', { name: 'Enregistrer le réalisé' })).toBeDisabled();

    await utilisateur.clear(farine);
    expect(screen.getByRole('button', { name: 'Enregistrer le réalisé' })).toBeEnabled();
  });

  it(
    'seules les consommations DÉCLARÉES partent : une entrée vide n’est pas un zéro, elle ' +
      'n’est simplement pas envoyée',
    async () => {
      const utilisateur = await ouvrirDetail();

      const misAJour = detailProduction({
        statut: 'terminee',
        volumeReelMl: 4_800,
        crepesReelles: 63,
      });
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/productions/prod-1/realise') return misAJour;
        return routeurBase?.(chemin, options);
      });

      await utilisateur.type(
        screen.getByRole('textbox', { name: /^Farine de froment T55/ }),
        '4100',
      );
      /*
        LE LAIT EST TOUCHÉ PUIS VIDÉ, et ce détail est ce qui rend la fixture
        discriminante. Ne JAMAIS toucher le champ laisse sa clé absente de
        `consommationsReellesSaisies` : la boucle d'envoi ne la voit pas, et une
        mutation qui supprime le `continue` sur les saisies vides reste alors
        invisible — mesuré le 01/08/2026. Une saisie effacée (« j'ai commencé,
        puis renoncé ») est en outre le geste réel le plus courant.
      */
      const lait = screen.getByRole('textbox', { name: /^Lait entier/ });
      await utilisateur.type(lait, '6700');
      await utilisateur.clear(lait);

      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer le réalisé' }));

      await waitFor(() =>
        expect(appelApi).toHaveBeenCalledWith(
          '/productions/prod-1/realise',
          expect.objectContaining({ method: 'PATCH' }),
        ),
      );
      const appel = appelApi.mock.calls.find(([c]) => c === '/productions/prod-1/realise');
      const corps = JSON.parse(String((appel?.[1] as RequestInit).body)) as {
        consommationsReelles: unknown[];
      };
      // UNE seule entrée : le lait, vidé, n'est PAS déclaré à 0.
      expect(corps.consommationsReelles).toEqual([
        { ingredientId: 'ing-farine', quantiteReelle: 4100 },
      ]);
    },
  );

  /**
   * ═══ DÉFAUT RÉEL n°2, CORRIGÉ le 01/08/2026 (convention `it.fails`) ═══
   *
   * La confirmation de la saisie du réalisé N'ÉTAIT JAMAIS VISIBLE.
   *
   * `enregistrerRealise()` construit soigneusement deux messages
   * (« Réalisé enregistré. » et « Réalisé enregistré — consommation réelle
   * déclarée pour N ingrédient(s). ») et les pose dans `etatRealise`. Mais le
   * `<p role="status">` qui les rend vivait À L'INTÉRIEUR du bloc
   * `{detailCourant.statut === 'lancee' && (<form>…</form>)}`.
   *
   * Or `PATCH /productions/:id/realise` FORCE `statut: 'terminee'`
   * (`packages/db/src/services/production.ts`, `.set({ …, statut: 'terminee' })`).
   * La réponse reposait donc `etatDetail` avec un statut `terminee`, le
   * formulaire entier se démontait au même rendu, et le message disparaissait
   * avec lui — avant d'avoir été peint une seule fois.
   *
   * Conséquence concrète : après la deuxième écriture la plus importante de cet
   * écran (celle qui crée de vrais mouvements de stock quand une consommation
   * réelle est déclarée), le porteur ne recevait AUCUN accusé de réception. Le
   * seul indice était la disparition du formulaire, qui ressemblait autant à un
   * succès qu'à un plantage.
   *
   * L'effet de temporisation à 5 s (`setEtatRealise({ statut: 'inactif' })`)
   * était lui aussi mort-né pour la même raison — il redevient vivant
   * maintenant que le paragraphe qu'il éteint peut réellement s'afficher.
   *
   * Correctif : le `<p role="status">` est sorti du bloc conditionnel
   * `statut === 'lancee'` (`Production.tsx`) — il ne dépend plus que
   * d'`etatRealise`, jamais du statut de la production, même patron que
   * `messageAnnulation` un peu plus bas dans le même fichier.
   */
  /*
    N'assertit QUE la visibilité, jamais l'accord du pluriel en même temps : un
    `it.fails` qui mêle deux affirmations reste « rouge » si l'une des deux est
    corrigée, et le défaut passerait pour non corrigé. L'accord se vérifie dans
    le test de mesure ci-dessous, qui lit le corps envoyé.
  */
  it('la confirmation du réalisé est VISIBLE (cas : deux ingrédients déclarés)', async () => {
    const utilisateur = await ouvrirDetail();

    const misAJour = detailProduction({ statut: 'terminee' });
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/productions/prod-1/realise') return misAJour;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.type(screen.getByRole('textbox', { name: /^Farine de froment T55/ }), '4100');
    await utilisateur.type(screen.getByRole('textbox', { name: /^Lait entier/ }), '6700');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer le réalisé' }));

    expect(await screen.findByText(/^Réalisé enregistré/)).toBeInTheDocument();
  });

  it('sans consommation déclarée, la confirmation reste sobre mais VISIBLE', async () => {
    const utilisateur = await ouvrirDetail();

    const misAJour = detailProduction({ statut: 'terminee' });
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/productions/prod-1/realise') return misAJour;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer le réalisé' }));

    expect(await screen.findByText('Réalisé enregistré.')).toBeInTheDocument();
  });

  it(
    'mesure du mécanisme : l’écriture PART bien, le détail se met à jour, et le formulaire ' +
      'disparaît — c’est le seul signal reçu par le porteur',
    async () => {
      const utilisateur = await ouvrirDetail();

      const misAJour = detailProduction({
        statut: 'terminee',
        volumeReelMl: 4_800,
        crepesReelles: 63,
        ecartRendementBp: -400,
      });
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/productions/prod-1/realise') return misAJour;
        return routeurBase?.(chemin, options);
      });

      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer le réalisé' }));

      await waitFor(() =>
        expect(appelApi).toHaveBeenCalledWith(
          '/productions/prod-1/realise',
          expect.objectContaining({ method: 'PATCH' }),
        ),
      );
      // Le formulaire s'est démonté — mais la confirmation, elle, ne vit plus
      // dedans depuis le correctif du 01/08/2026 (voir les deux tests
      // ci-dessus) : c'est justement ce qui la rend visible malgré ce
      // démontage.
      await waitFor(() => expect(screen.queryByText('Saisie du réalisé')).not.toBeInTheDocument());
      // Le détail relu, lui, s'affiche bien : l'écriture n'est pas perdue.
      expect(screen.getByText(/Écart de rendement/)).toBeInTheDocument();
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   Clavier — CLAUDE.md §3 règle 10
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Production — clavier (CLAUDE.md §3 règle 10)', () => {
  it(
    'Échap ferme le panneau de détail ET rend le focus à la rangée d’historique — jamais à ' +
      '<body>, sinon il faut retraverser tout le menu pour revenir où l’on était',
    async () => {
      const utilisateur = await ouvrirDetail();
      /*
        Focus DÉPLACÉ DANS le panneau AVANT Échap, sur un champ qui va
        disparaître avec lui — pas laissé sur la rangée cliquée par
        `ouvrirDetail()`. Sans ce déplacement explicite, la rangée garde le
        focus par résidu (elle ne l'a jamais perdu) et le test ne prouve rien
        : une fixture aveugle, incapable de voir le défaut qu'elle prétend
        couvrir (docs/39 §3). C'est le scénario RÉEL qui expose le défaut :
        le porteur qui consulte un champ du panneau avant de presser Échap.
      */
      screen.getByRole('textbox', { name: 'Volume réel (ml)' }).focus();

      await utilisateur.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByText('Saisie du réalisé')).not.toBeInTheDocument());
      // Le panneau fermé, il ne reste qu'UNE occurrence du numéro : la rangée
      // d'historique (le titre du panneau a disparu avec lui).
      const rangee = screen.getByText('PR-2026-0007').closest('tr');
      expect(rangee).not.toBeNull();
      await waitFor(() => expect(rangee as HTMLElement).toHaveFocus());
      expect(document.body).not.toHaveFocus();
    },
  );

  it(
    'le bouton « Fermer » du panneau de détail rend lui aussi le focus à la rangée ' +
      'd’historique — même défaut, même correctif, que l’Échap ci-dessus',
    async () => {
      const utilisateur = await ouvrirDetail();

      await utilisateur.click(screen.getByRole('button', { name: 'Fermer' }));

      await waitFor(() => expect(screen.queryByText('Saisie du réalisé')).not.toBeInTheDocument());
      const rangee = screen.getByText('PR-2026-0007').closest('tr');
      expect(rangee).not.toBeNull();
      await waitFor(() => expect(rangee as HTMLElement).toHaveFocus());
      expect(document.body).not.toHaveFocus();
    },
  );

  it(
    'Entrée dans le formulaire du réalisé enregistre — mais le LANCEMENT, lui, n’est pas ' +
      'soumissible à l’Entrée : il consomme le stock en FEFO de façon irréversible',
    async () => {
      const utilisateur = await ouvrirDetail();

      const misAJour = detailProduction({ statut: 'terminee' });
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/productions/prod-1/realise') return misAJour;
        return routeurBase?.(chemin, options);
      });

      await utilisateur.type(screen.getByRole('textbox', { name: 'Crêpes réelles' }), '{Enter}');

      await waitFor(() =>
        expect(appelApi).toHaveBeenCalledWith(
          '/productions/prod-1/realise',
          expect.objectContaining({ method: 'PATCH' }),
        ),
      );
      // Le bloc de lancement n'est PAS un `<form>` : rien n'a été relancé.
      expect(appelApi).not.toHaveBeenCalledWith(
        '/productions',
        expect.objectContaining({ method: 'POST' }),
      );
    },
  );

  it(
    'après une saisie du réalisé réussie, le focus va sur « Fermer » — le formulaire qui portait ' +
      'le bouton vient d’être démonté par le passage à « Terminée »',
    async () => {
      const utilisateur = await ouvrirDetail();

      const misAJour = detailProduction({ statut: 'terminee' });
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/productions/prod-1/realise') return misAJour;
        return routeurBase?.(chemin, options);
      });

      /*
        Déclenché au CLAVIER depuis un champ, jamais par un clic sur le bouton :
        jsdom ne retire pas le focus d'un bouton devenu `disabled`, donc un clic
        laisserait le focus dessus et le test ne prouverait rien. Ici le focus
        part d'ailleurs — seule la reprise explicite peut l'amener à destination.
      */
      screen.getByRole('textbox', { name: 'Crêpes réelles' }).focus();
      await utilisateur.keyboard('{Enter}');

      await screen.findByText(/^Réalisé enregistré/);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus());
      expect(document.body).not.toHaveFocus();
    },
  );

  it('après une annulation réussie, le focus va sur « Fermer » — le seul contrôle encore actionnable', async () => {
    const utilisateur = await ouvrirDetail();

    const annulee = detailProduction({ statut: 'annulee' });
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/productions/prod-1/annuler')
        return { productionId: 'prod-1', numero: 'PR-2026-0007', nbMouvementsContrepasses: 2 };
      if (chemin === '/productions/prod-1') return annulee;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la production…' }));
    await utilisateur.selectOptions(
      screen.getByRole('combobox', { name: /^Motif/ }),
      'ERREUR_SAISIE',
    );
    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la production' }));

    await screen.findByText(/2 mouvements/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it('une annulation SANS motif est refusée avant tout appel', async () => {
    const utilisateur = await ouvrirDetail();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la production…' }));
    appelApi.mockClear();
    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la production' }));

    expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalledWith('/productions/prod-1/annuler', expect.anything());
  });

  it('fermer le bloc d’annulation rend le focus au bouton qui l’a ouvert', async () => {
    const utilisateur = await ouvrirDetail();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la production…' }));
    /*
      DEUX boutons « Fermer » coexistent une fois le bloc ouvert : celui du
      panneau de détail et celui du bloc d'annulation. Prendre le premier venu
      fermerait le panneau entier et le test passerait pour une raison qui n'a
      rien à voir. On vise donc celui du bloc, par son voisinage.
    */
    const bloc = screen.getByText('Annulation').closest('div');
    expect(bloc).not.toBeNull();
    await utilisateur.click(within(bloc as HTMLElement).getByRole('button', { name: 'Fermer' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Annuler la production…' })).toHaveFocus(),
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état pendant l'écriture : promesse EN VOL, jamais déjà résolue
   ═══════════════════════════════════════════════════════════════════════════

   docs/39 §3 (cinquième forme, « la promesse déjà résolue ») : TOUS les
   tests d'écriture ci-dessus enchaînent une réponse déjà tenue
   (`mockImplementation` qui `return`ne immédiatement) — l'état d'envoi
   retombe à `inactif` dans le MÊME écoulement de micro-tâches que sa pose,
   et n'atteint donc jamais le DOM. Rien, dans ce fichier, ne regardait
   jusqu'ici le bouton inerte, le libellé d'attente, ni un second envoi
   ignoré. Les quatre tests ci-dessous posent eux-mêmes la promesse et ne la
   résolvent qu'APRÈS avoir lu l'écran EN VOL — le stock consommé par
   `POST /productions` est irréversible (règle n°5), un double envoi ici
   fabrique deux écritures pour un seul geste.
*/
describe('Production — transitions d’état pendant l’écriture (promesse en vol)', () => {
  it(
    'le lancement annonce « Lancement… », bloque le bouton, et le rend à « Lancer la production » ' +
      'après la réponse',
    async () => {
      const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await monterAvecFaisabilite();

      const cree = detailProduction();
      let repondre: ((valeur: unknown) => void) | undefined;
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/productions' && options?.method === 'POST') {
          return new Promise((resoudre) => {
            repondre = resoudre;
          });
        }
        if (chemin === '/productions/prod-1') return cree;
        return routeurBase?.(chemin, options);
      });

      await utilisateur.click(boutonLancer());

      const bouton = await screen.findByRole('button', { name: 'Lancement…' });
      expect(bouton).toBeDisabled();

      /*
        AUCUN CHEMIN NE CONTOURNE CE BOUTON, vérifié par lecture du fichier :
        « Lancer la production » n'est PAS dans un `<form>` (docs/07, la
        consommation FEFO ne doit jamais partir sur un `Entrée`), et
        `Production.tsx` ne pose qu'UN SEUL `window.addEventListener('keydown',
        …)`, réservé à `Échap` pour fermer le panneau de détail — aucun
        raccourci n'appelle `lancerProduction`. Le garde-fou
        `if (etatLancement.statut === 'en_cours') return;` n'a donc PAS de
        second appel à observer ici : l'affirmer quand même serait une preuve
        feinte (consigne de mission).
      */

      repondre?.(cree);
      await screen.findByRole('button', { name: 'Lancer la production' });
      expect(screen.getByRole('button', { name: 'Lancer la production' })).toBeEnabled();
    },
  );

  it(
    'la saisie du réalisé annonce « Enregistrement… », bloque le bouton, et une frappe « Entrée » ' +
      'dans un champ du même formulaire — le seul contournement THÉORIQUEMENT possible, un ' +
      'bouton `submit` par défaut désactivé — n’ajoute AUCUN appel pendant que le premier est en vol',
    async () => {
      const utilisateur = await ouvrirDetail();

      let repondre: ((valeur: unknown) => void) | undefined;
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/productions/prod-1/realise') {
          return new Promise((resoudre) => {
            repondre = resoudre;
          });
        }
        return routeurBase?.(chemin, options);
      });

      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer le réalisé' }));

      const bouton = await screen.findByRole('button', { name: 'Enregistrement…' });
      expect(bouton).toBeDisabled();

      const appelsAvant = appelApi.mock.calls.filter(
        ([c]) => c === '/productions/prod-1/realise',
      ).length;
      // Mesuré, pas supposé : contrairement au lancement, ce bouton EST un
      // `type="submit"` dans un vrai `<form>` — la soumission IMPLICITE par
      // `Entrée` est donc le seul contournement qui reste à écarter.
      await utilisateur.type(screen.getByRole('textbox', { name: 'Crêpes réelles' }), '{Enter}');
      const appelsApres = appelApi.mock.calls.filter(
        ([c]) => c === '/productions/prod-1/realise',
      ).length;
      expect(appelsApres).toBe(appelsAvant);

      /*
        « Redevient actionnable » ne s'applique PAS tel quel ici : `PATCH
        …/realise` FORCE `statut: 'terminee'` (voir le commentaire « DÉFAUT
        RÉEL n°2 » plus haut dans ce fichier), donc la réponse démonte le
        `<form>` ENTIER — le bouton ne réapparaît pas désactivé puis activé,
        il DISPARAÎT, remplacé par la confirmation. C'est la preuve de fin de
        vol adaptée à ce cas précis : le bouton ne reste pas bloqué, l'écran
        progresse.
      */
      repondre?.(detailProduction({ statut: 'terminee' }));
      await screen.findByText(/^Réalisé enregistré/);
      expect(screen.queryByRole('button', { name: 'Enregistrement…' })).not.toBeInTheDocument();
    },
  );

  it(
    'le rattachement de session annonce « Enregistrement… », bloque le bouton, et le rend à ' +
      '« Enregistrer » après la réponse',
    async () => {
      const utilisateur = await ouvrirDetail();

      let repondre: ((valeur: unknown) => void) | undefined;
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/productions/prod-1/session') {
          return new Promise((resoudre) => {
            repondre = resoudre;
          });
        }
        return routeurBase?.(chemin, options);
      });

      await utilisateur.selectOptions(
        screen.getByRole('combobox', { name: 'Rattacher à' }),
        'ses-1',
      );
      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

      const bouton = await screen.findByRole('button', { name: 'Enregistrement…' });
      expect(bouton).toBeDisabled();

      /*
        Même constat que le lancement : ce bouton est hors `<form>`, et aucun
        raccourci clavier de ce fichier ne vise `rattacherSessionProduction`.
        Aucun contournement à démontrer.
      */

      repondre?.(
        detailProduction({
          sessionId: 'ses-1',
          sessionNumero: 'SM-2026-0002',
          sessionStatut: 'planifiee',
        }),
      );
      await screen.findByRole('button', { name: 'Enregistrer' });
      expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
    },
  );

  it(
    'l’annulation de production annonce « Annulation… », bloque le bouton, et REND IMPOSSIBLE ' +
      'une seconde annulation — la raison de blocage remplace le bouton, ce n’est pas juste ' +
      '« redevenu actionnable »',
    async () => {
      const utilisateur = await ouvrirDetail();

      const annulee = detailProduction({ statut: 'annulee' });
      let repondre: ((valeur: unknown) => void) | undefined;
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/productions/prod-1/annuler') {
          return new Promise((resoudre) => {
            repondre = resoudre;
          });
        }
        if (chemin === '/productions/prod-1') return annulee;
        return routeurBase?.(chemin, options);
      });

      await utilisateur.click(screen.getByRole('button', { name: 'Annuler la production…' }));
      await utilisateur.selectOptions(
        screen.getByRole('combobox', { name: /^Motif/ }),
        'ERREUR_SAISIE',
      );
      await utilisateur.click(screen.getByRole('button', { name: 'Annuler la production' }));

      const bouton = await screen.findByRole('button', { name: 'Annulation…' });
      expect(bouton).toBeDisabled();

      /*
        `BlocAnnulation` n'est délibérément PAS un `<form>` — son commentaire
        le dit : « Entrée ne doit jamais pouvoir déclencher une annulation par
        mégarde » —, et `Production.tsx` ne pose aucun raccourci Ctrl+S.
        Aucun chemin ne contourne donc ce bouton non plus.
      */

      repondre?.({ productionId: 'prod-1', numero: 'PR-2026-0007', nbMouvementsContrepasses: 2 });

      await screen.findByText(/2 mouvements contrepassés/);
      expect(screen.queryByRole('button', { name: 'Annulation…' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Annuler la production…' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/Production déjà annulée/)).toBeInTheDocument();
    },
  );
});
