/**
 * Écran Comptabilité — test MONTÉ, en complément de `Comptabilite.test.tsx`.
 *
 * ═══ Ce que ce fichier ajoute ═══
 *
 * `Comptabilite.test.tsx`, à côté, couvre douze fonctions et composants PURS
 * exportés (`colonnesEcheances`, `confirmationVerrouillageActivable`,
 * `ImpactVerrouillagePeriode`, `cheminEconomiesDuMois`…). Il reste valable et
 * n'est pas touché — il est même l'un des meilleurs du dépôt.
 *
 * Ce qu'il ne pouvait PAS voir : l'écran monté. Sept chargements indépendants,
 * une année pilotée en tête d'écran qui doit se propager à tous, et le fait —
 * central ici — que `colonnesEcheances(horizon)` reçoive bien l'horizon lu du
 * catalogue de paramètres et non `null` par accident. Le test unitaire prouve
 * que la fonction LIT son argument ; il ne prouve pas que l'écran le LUI PASSE.
 *
 * ═══ Pourquoi cet écran mérite plus d'attention ═══
 *
 * C'est un écran à valeur RÉGLEMENTAIRE, et il est bâti sur deux règles :
 *
 * 1. **Une inconnue vaut `null`, jamais `0`.** Une marge par créneau reposant
 *    sur zéro session à marge connue s'affiche « — », pas « 0,00 » : un coût
 *    à zéro produit 100 % de marge, c'est le mensonge le plus traqué ici.
 * 2. **Les dates sont civiles, en `Europe/Brussels`.** Elles se comparent au
 *    formateur, jamais à un littéral tapé à la main.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  TIRET_ABSENT,
  formaterDate,
  formaterEuros,
  formaterMontant,
  type EcheanceLigneContrat,
  type LigneAgregatCreneauContrat,
  type SyntheseExerciceContrat,
} from '@batte/core';

import type * as ApiReelle from '../lib/api';

// `typeof ApiReelle` plutôt que `typeof import('../lib/api')` : la règle
// `@typescript-eslint/consistent-type-imports` interdit l'annotation
// `import()` en ligne. Le `import type` ci-dessus est effacé à la
// compilation — il ne crée donc aucune référence de VALEUR dans la fabrique
// de `vi.mock`, que Vitest remonte en tête de fichier.
vi.mock('../lib/api', async (importerReel) => {
  const reel = await importerReel<typeof ApiReelle>();
  return { ...reel, requeteApi: vi.fn(), telechargerFichierApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: Comptabilite } = await import('./Comptabilite');

const appel = vi.mocked(requeteApi);

/** Classe du registre d'alerte MÉTIER, celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function synthese(partiel: Partial<SyntheseExerciceContrat> = {}): SyntheseExerciceContrat {
  return {
    annee: 2026,
    recettesCents: 838000,
    depensesDeductiblesCents: 312400,
    amortissementsCents: 45000,
    beneficeBrutCents: 480600,
    cotisationsSocialesCents: 100000,
    impotEstimeCents: 90000,
    netEstimeCents: 290600,
    ...partiel,
  };
}

/**
 * DEUX créneaux : l'un dont la marge est connue, l'autre dont AUCUNE session
 * contributrice n'a de marge (`margeBrute/NetteEstimeeCents: null`,
 * `nbSessionsAvecMargeConnue: 0`). Sans ce second cas, le test ne pourrait rien
 * dire de la distinction inconnu / zéro — qui est LA règle de cet écran.
 */
const CRENEAUX: LigneAgregatCreneauContrat[] = [
  {
    creneauHoraire: '08:00-10:00',
    nbSessions: 8,
    quantiteVendue: 214,
    caCents: 64200,
    nbSessionsAvecMargeConnue: 8,
    margeBruteEstimeeCents: 41800,
    margeNetteEstimeeCents: 33500,
  },
  {
    // Le bucket des ventes SANS créneau saisi : il reste dans l'agrégat, sans
    // quoi le total affiché serait faux (CLAUDE.md §7).
    creneauHoraire: null,
    nbSessions: 3,
    quantiteVendue: 41,
    caCents: 12300,
    nbSessionsAvecMargeConnue: 0,
    margeBruteEstimeeCents: null,
    margeNetteEstimeeCents: null,
  },
];

function echeance(partiel: Partial<EcheanceLigneContrat> = {}): EcheanceLigneContrat {
  return {
    id: 'ech-1',
    libelle: 'Listing clients TVA',
    recurrence: 'annuelle',
    prochaineDate: '2027-03-31',
    sourceLegale: 'Code TVA, art. 53quinquies',
    urlSource: null,
    montantEstimeCents: null,
    statut: 'a_venir',
    dateRealisation: null,
    joursAvantEcheance: 72,
    alerteProche: false,
    ...partiel,
  };
}

/** Paramètre du catalogue qui pilote l'horizon d'affichage du compteur « J-n ». */
function catalogueParametres(horizonJours: number | null): unknown {
  if (horizonJours === null) return { data: [], meta: { total: 0 } };
  // Forme EXACTE de `schemaParametre` (`contrats/parametres.ts`) : une
  // fixture approximative serait rejetée par Zod, le `catch` de l'écran
  // l'avalerait volontairement (mode dégradé), et le test « passerait » sur
  // un horizon resté `null` — vert pour la mauvaise raison.
  return {
    data: [
      {
        id: 'par-1',
        cle: 'comptabilite_horizon_affichage_echeances_jours',
        valeur: String(horizonJours),
        typeValeur: 'entier',
        dateDebutValidite: '2020-01-01',
        dateFinValidite: null,
        source: 'Catalogue de test',
        description: 'Horizon d’affichage du compteur J-n sur l’échéancier.',
        creeLe: '2020-01-01T00:00:00.000Z',
        modifieLe: '2020-01-01T00:00:00.000Z',
      },
    ],
    meta: { total: 1 },
  };
}

type ReponsesFeintes = {
  synthese?: unknown;
  echeances?: unknown;
  creneaux?: unknown;
  parametres?: unknown;
  /** `GET /periodes` — vide par défaut, comme avant l'ajout de cette clé. */
  periodes?: unknown;
  /** `GET /periodes/:id/impact-verrouillage`. */
  impactVerrouillage?: unknown;
  /**
   * `POST /periodes/:id/verrouiller`. Laissée à `undefined`, l'écriture reste
   * suspendue à jamais — comportement HISTORIQUE de ce fichier pour TOUT
   * non-GET, conservé tel quel : c'est lui qui permet d'observer l'état
   * « en cours » sans course.
   */
  verrouillage?: unknown;
};

let cheminsAppeles: string[] = [];

const LISTE_VIDE = { data: [], meta: { total: 0 } };

function feindre(reponses: ReponsesFeintes): void {
  appel.mockImplementation((chemin: string, options?: RequestInit) => {
    cheminsAppeles.push(chemin);
    if (options?.method !== undefined && options.method !== 'GET') {
      if (chemin.endsWith('/verrouiller') && reponses.verrouillage !== undefined) {
        if (reponses.verrouillage instanceof Error) return Promise.reject(reponses.verrouillage);
        return Promise.resolve(reponses.verrouillage as never);
      }
      return new Promise<never>(() => {});
    }
    const choisie = chemin.startsWith('/synthese-exercice')
      ? reponses.synthese
      : chemin.startsWith('/echeances')
        ? reponses.echeances
        : chemin.startsWith('/ventes-par-creneau')
          ? reponses.creneaux
          : chemin === '/parametres'
            ? (reponses.parametres ?? catalogueParametres(null))
            : // AVANT `/periodes` : `startsWith('/periodes')` capterait aussi
              // `/periodes/:id/impact-verrouillage`, qui doit répondre autre
              // chose qu'une liste de périodes.
              chemin.includes('/impact-verrouillage')
              ? reponses.impactVerrouillage
              : chemin === '/periodes'
                ? (reponses.periodes ?? LISTE_VIDE)
                : LISTE_VIDE;
    if (choisie === undefined) return new Promise<never>(() => {});
    if (choisie instanceof Error) return Promise.reject(choisie);
    return Promise.resolve(choisie as never);
  });
}

function listeCreneaux(lignes: LigneAgregatCreneauContrat[], nbSessionsCloturees: number): unknown {
  return { data: lignes, meta: { annee: 2026, nbSessionsCloturees } };
}

function monter(): void {
  render(
    <MemoryRouter>
      <Comptabilite />
    </MemoryRouter>,
  );
}

/**
 * Recherche par `textContent` BRUT : `formaterEuros` place une espace
 * INSÉCABLE avant le « € », que le normaliseur de `@testing-library` remplace
 * par une espace ordinaire — la valeur formatée ne correspondrait jamais à
 * elle-même via `getByText`. On compare toujours au FORMATEUR, sur le texte
 * non normalisé.
 */
function parTexteExact(attendu: string): HTMLElement[] {
  return Array.from(document.querySelectorAll('p, span, td, dd')).filter(
    (n) => n.textContent === attendu,
  ) as HTMLElement[];
}

beforeEach(() => {
  appel.mockReset();
  cheminsAppeles = [];
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Les trois états, sur des chargements indépendants
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Comptabilité — chargement, erreur, vide', () => {
  it('la synthèse annonce son calcul plutôt que de rester muette', () => {
    feindre({});
    monter();

    expect(screen.getByText('Calcul en cours…')).toBeInTheDocument();
  });

  it('un échec de la synthèse reste NEUTRE, sans couleur d’alerte métier', async () => {
    feindre({
      synthese: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
      echeances: LISTE_VIDE,
      creneaux: listeCreneaux([], 0),
    });
    monter();

    // Plusieurs panneaux peuvent échouer en même temps : on les vérifie TOUS
    // plutôt que « le premier », sans quoi une régression sur un panneau non
    // visé passerait inaperçue.
    const messages = await screen.findAllByRole('alert');
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
      expect(message.parentElement?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
    }
    expect(
      messages.some((m) =>
        (m.textContent ?? '').includes('Erreur inattendue du serveur (code HTTP 500).'),
      ),
    ).toBe(true);
  });

  it('un échec de la synthèse n’emporte PAS l’échéancier — les panneaux sont indépendants', async () => {
    feindre({
      synthese: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
      echeances: { data: [echeance()], meta: { total: 1 } },
      creneaux: listeCreneaux(CRENEAUX, 8),
    });
    monter();

    await screen.findAllByRole('alert');
    expect(screen.getByText('Listing clients TVA')).toBeInTheDocument();
    expect(screen.getByText('08:00-10:00')).toBeInTheDocument();
  });

  it('le panneau de synthèse garde son titre quand il échoue', async () => {
    feindre({
      synthese: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
      echeances: LISTE_VIDE,
      creneaux: listeCreneaux([], 0),
    });
    monter();

    await screen.findAllByRole('alert');
    const annee = new Date().getFullYear();
    expect(
      screen.getByRole('heading', { name: `Synthèse de l'exercice ${annee}` }),
    ).toBeInTheDocument();
  });

  it('aucune échéance : une ligne discrète, pas une carte avec bouton', async () => {
    feindre({
      synthese: synthese(),
      echeances: LISTE_VIDE,
      creneaux: listeCreneaux([], 0),
    });
    monter();

    // `variante: 'normal'` — un échéancier vide n'est pas un premier
    // lancement à guider, c'est simplement « rien à faire ».
    expect(await screen.findByText('Aucune échéance réglementaire.')).toBeInTheDocument();
  });

  it('aucune session clôturée : l’état vide des créneaux dit ce qui le remplira', async () => {
    feindre({
      synthese: synthese(),
      echeances: LISTE_VIDE,
      creneaux: listeCreneaux([], 0),
    });
    monter();

    expect(await screen.findByText('Aucune session clôturée cette année')).toBeInTheDocument();
    // Et ce texte est DIFFÉRENT de celui de l'échéancier : deux vides, deux
    // phrases (docs/07 §4.7 interdit un gabarit générique unique).
    expect(screen.getByText('Aucune échéance réglementaire.')).toBeInTheDocument();
  });

  it('la mention « ne remplace ni un comptable ni l’AFSCA » accompagne toujours le résultat', async () => {
    feindre({
      synthese: synthese(),
      echeances: LISTE_VIDE,
      creneaux: listeCreneaux([], 0),
    });
    monter();

    // CLAUDE.md §7 : les écrans de synthèse fiscale portent cette mention.
    expect(
      await screen.findByText(/ne remplace ni un comptable, ni un guichet d’entreprises/),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Inconnu ≠ zéro — la marge par créneau
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Comptabilité — une marge sans session à marge connue vaut « — », jamais « 0,00 »', () => {
  function monterAvecCreneaux(): void {
    feindre({
      synthese: synthese(),
      echeances: LISTE_VIDE,
      creneaux: listeCreneaux(CRENEAUX, 8),
    });
    monter();
  }

  it('le créneau sans marge connue rend le tiret sur les DEUX marges', async () => {
    monterAvecCreneaux();

    const rangee = (await screen.findByText('Non renseigné')).closest('tr') as HTMLTableRowElement;
    // Deux marges inconnues, deux tirets — et un CA, lui, bien réel : la
    // ligne existe, seules ses marges sont indéterminées.
    expect(within(rangee).getAllByText(TIRET_ABSENT)).toHaveLength(2);
    expect(rangee.textContent ?? '').toContain(formaterMontant(12300));
    // Un « 0,00 » ici ferait passer un coût inconnu pour un coût nul.
    expect(rangee.textContent ?? '').not.toContain(formaterMontant(0));
  });

  it('le créneau à marge connue les affiche via le formateur — la fixture discrimine', async () => {
    monterAvecCreneaux();

    const rangee = (await screen.findByText('08:00-10:00')).closest('tr') as HTMLTableRowElement;
    expect(within(rangee).getByText(formaterMontant(41800))).toBeInTheDocument();
    expect(within(rangee).getByText(formaterMontant(33500))).toBeInTheDocument();
    expect(within(rangee).queryByText(TIRET_ABSENT)).toBeNull();
  });

  it('l’infobulle dit sur COMBIEN de sessions la marge est répartie', async () => {
    monterAvecCreneaux();

    const rangee = (await screen.findByText('08:00-10:00')).closest('tr') as HTMLTableRowElement;
    const cellules = Array.from(rangee.querySelectorAll('td'));
    const titres = cellules.map((c) => c.getAttribute('title') ?? '');
    // Une marge reposant sur 1 session sur 8 n'a pas la même fiabilité qu'une
    // marge reposant sur 8 sur 8 : l'écran doit le dire (docs/21 §5).
    expect(titres.some((t) => t.includes('répartie sur 8/8 sessions'))).toBe(true);
  });

  it('la ligne « Non renseigné » n’est PAS écartée de l’agrégat', async () => {
    monterAvecCreneaux();

    // Un bucket disparu en silence fausserait le total affiché : le libellé
    // est un texte explicite, pas le tiret générique d'une valeur manquante.
    expect(await screen.findByText('Non renseigné')).toBeInTheDocument();
  });

  it('la marge par créneau est annoncée comme une ESTIMATION, jamais comme une mesure', async () => {
    monterAvecCreneaux();

    const mention = await screen.findByText(/La marge est une ESTIMATION répartie au prorata/);
    expect(mention.textContent ?? '').toContain('jamais une décomposition réelle du coût');
    expect(mention.textContent ?? '').toContain('Cumulé sur 8 sessions clôturées');
  });

  it('les sept montants de la synthèse passent tous par le formateur', async () => {
    feindre({
      synthese: synthese(),
      echeances: LISTE_VIDE,
      creneaux: listeCreneaux([], 0),
    });
    monter();

    await screen.findByText('Recettes');
    for (const cents of [838000, 312400, 45000, 480600, 100000, 90000, 290600]) {
      expect(parTexteExact(formaterEuros(cents)).length).toBeGreaterThan(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. L'échéancier réglementaire — dates et horizon lu du catalogue
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Comptabilité — l’échéancier ne fabrique ni date ni horizon', () => {
  it('la date d’échéance est le jour civil belge, comparé au formateur', async () => {
    feindre({
      synthese: synthese(),
      echeances: { data: [echeance()], meta: { total: 1 } },
      creneaux: listeCreneaux([], 0),
    });
    monter();

    const rangee = (await screen.findByText('Listing clients TVA')).closest(
      'tr',
    ) as HTMLTableRowElement;
    // Le listing clients TVA tombe au 31 mars, même à zéro (CLAUDE.md §6).
    // Une date civile relue comme minuit UTC a déjà produit une heure fantôme
    // dans un document de ce dépôt : on compare au formateur, jamais à
    // « 31/03/2027 » tapé à la main.
    expect(within(rangee).getByText(formaterDate('2027-03-31'))).toBeInTheDocument();
  });

  it('une échéance jamais réalisée rend le tiret, jamais une date inventée', async () => {
    feindre({
      synthese: synthese(),
      echeances: {
        data: [
          echeance(),
          echeance({
            id: 'ech-2',
            libelle: 'Déclaration INASTI',
            statut: 'faite',
            dateRealisation: '2026-06-30',
            prochaineDate: '2027-06-30',
          }),
        ],
        meta: { total: 2 },
      },
      creneaux: listeCreneaux([], 0),
    });
    monter();

    const jamaisFaite = (await screen.findByText('Listing clients TVA')).closest(
      'tr',
    ) as HTMLTableRowElement;
    expect(within(jamaisFaite).getAllByText(TIRET_ABSENT).length).toBeGreaterThanOrEqual(1);

    // Celle qui EST faite porte sa date réelle — la fixture discrimine.
    const faite = screen.getByText('Déclaration INASTI').closest('tr') as HTMLTableRowElement;
    expect(within(faite).getByText(formaterDate('2026-06-30'))).toBeInTheDocument();
  });

  it('sans le paramètre du catalogue, AUCUN compteur « J-n » n’est inventé', async () => {
    feindre({
      synthese: synthese(),
      echeances: { data: [echeance({ joursAvantEcheance: 72 })], meta: { total: 1 } },
      creneaux: listeCreneaux([], 0),
      parametres: catalogueParametres(null),
    });
    monter();

    const rangee = (await screen.findByText('Listing clients TVA')).closest(
      'tr',
    ) as HTMLTableRowElement;
    expect(rangee.textContent ?? '').not.toMatch(/J[-+]\d/);
  });

  it('l’horizon lu du catalogue atteint bien les colonnes — le pont, pas seulement la fonction', async () => {
    // Le test unitaire voisin prouve que `colonnesEcheances(100)` affiche
    // « J-72 ». Ce qu'il ne prouve PAS : que l'écran passe bien 100 à cette
    // fonction après l'avoir lu dans `/parametres`. C'est ce pont-ci qu'on
    // vérifie, et il n'existait aucun test pour lui.
    const dans5Jours = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    feindre({
      synthese: synthese(),
      echeances: {
        data: [echeance({ prochaineDate: dans5Jours, joursAvantEcheance: 5 })],
        meta: { total: 1 },
      },
      creneaux: listeCreneaux([], 0),
      parametres: catalogueParametres(100),
    });
    monter();

    const rangee = (await screen.findByText('Listing clients TVA')).closest(
      'tr',
    ) as HTMLTableRowElement;
    expect(rangee.textContent ?? '').toMatch(/J-5/);
  });

  it('le montant estimé est annoncé comme une SAISIE, jamais comme un montant dû', async () => {
    feindre({
      synthese: synthese(),
      echeances: { data: [echeance()], meta: { total: 1 } },
      creneaux: listeCreneaux([], 0),
    });
    monter();

    expect(
      await screen.findByText(/ce n’est jamais un montant dû ni calculé par l’application/),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. L'année pilote TOUT l'écran, jamais un panneau seul
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Comptabilité — un seul sélecteur d’exercice, propagé partout', () => {
  it('les quatre routes annuelles partent avec la MÊME année', async () => {
    feindre({
      synthese: synthese(),
      echeances: LISTE_VIDE,
      creneaux: listeCreneaux([], 0),
    });
    monter();

    await screen.findByText('Recettes');
    const annee = new Date().getFullYear();
    expect(cheminsAppeles).toContain(`/synthese-exercice?annee=${annee}`);
    expect(cheminsAppeles).toContain(`/depenses?annee=${annee}`);
    expect(cheminsAppeles).toContain(`/immobilisations?annee=${annee}`);
    expect(cheminsAppeles).toContain(`/ventes-par-creneau?annee=${annee}`);
  });

  it('changer l’exercice relance CES quatre routes, et pas les routes non annuelles', async () => {
    feindre({
      synthese: synthese(),
      echeances: LISTE_VIDE,
      creneaux: listeCreneaux([], 0),
    });
    monter();

    await screen.findByText('Recettes');
    cheminsAppeles = [];
    // `fireEvent.change` : le champ est CONTRÔLÉ sur un entier, une frappe
    // caractère par caractère produirait « 20262024 » — c'est le gestionnaire
    // qu'on teste, pas la saisie caractère.
    fireEvent.change(screen.getByLabelText('Exercice'), { target: { value: '2024' } });

    expect(cheminsAppeles).toContain('/synthese-exercice?annee=2024');
    expect(cheminsAppeles).toContain('/depenses?annee=2024');
    expect(cheminsAppeles).toContain('/immobilisations?annee=2024');
    expect(cheminsAppeles).toContain('/ventes-par-creneau?annee=2024');
    // L'échéancier et les périodes ne dépendent PAS de l'exercice : les
    // relancer serait du bruit réseau, et surtout un décalage possible entre
    // ce qui est affiché et ce qui vient d'être demandé.
    expect(cheminsAppeles).not.toContain('/echeances');
    expect(cheminsAppeles).not.toContain('/periodes');
  });

  it('le titre du panneau suit l’exercice choisi', async () => {
    feindre({
      synthese: synthese(),
      echeances: LISTE_VIDE,
      creneaux: listeCreneaux([], 0),
    });
    monter();

    await screen.findByText('Recettes');
    fireEvent.change(screen.getByLabelText('Exercice'), { target: { value: '2024' } });
    expect(
      screen.getByRole('heading', { name: "Synthèse de l'exercice 2024" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Journaux comptables 2024' })).toBeInTheDocument();
  });

  it('un échec du catalogue de paramètres n’empêche pas l’écran de fonctionner', async () => {
    feindre({
      synthese: synthese(),
      echeances: { data: [echeance()], meta: { total: 1 } },
      creneaux: listeCreneaux(CRENEAUX, 8),
      parametres: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    monter();

    // CLAUDE.md §5 : mode dégradé. Le compteur « J-n » disparaît, la date et
    // tout le reste demeurent.
    expect(await screen.findByText('Listing clients TVA')).toBeInTheDocument();
    expect(screen.getByText(formaterDate('2027-03-31'))).toBeInTheDocument();
    expect(screen.getByText('08:00-10:00')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Le verrouillage définitif d'une période — le geste irréversible

   `Comptabilite.test.tsx` couvre la DÉCISION (`confirmationVerrouillageActivable`)
   et le RENDU du décompte (`ImpactVerrouillagePeriode`, en statique). Son
   propre en-tête énumère ce qu'il ne pouvait PAS voir, et c'est exactement ce
   que cette section ajoute : qu'un clic ouvre bien la confirmation, qu'`Échap`
   la referme SANS jamais confirmer, qu'`Entrée` ne déclenche rien, où atterrit
   le focus après chaque issue, et qu'aucun `POST` ne part avant la recopie.

   POURQUOI ces tests-là et pas d'autres : ce geste est le seul du produit dont
   l'application n'a AUCUNE voie de retour — `rouvrirPeriode` refuse une période
   `verrouillee`, et la contre-passation d'un mouvement vérifie le verrou sur la
   date D'ORIGINE de l'écriture. Un raccourci clavier qui l'atteindrait par
   accident ne se rattraperait pas.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une période CLÔTURÉE : le seul état depuis lequel le verrou est proposé. */
const PERIODE_CLOTUREE = {
  id: 'per-2026-06',
  annee: 2026,
  mois: 6,
  statut: 'cloturee',
  dateCloture: '2026-07-02T09:00:00.000Z',
  clotureePar: 'Le porteur du projet',
  dateReouverture: null,
  motifReouverture: null,
};

/**
 * Trois périodes, une par statut. Une fixture à une seule ligne ne pourrait
 * pas discriminer : c'est la comparaison des trois qui prouve que le bouton
 * « Verrouiller… » n'apparaît QUE sur `cloturee` — l'enchaînement imposé
 * ('ouverte' → 'cloturee' → 'verrouillee') doit être visible à l'écran, pas
 * seulement refusé par le serveur.
 *
 * Les compteurs de l'impact sont DÉLIBÉRÉMENT tous différents, et deux d'entre
 * eux valent 0 et 1 : des chiffres tous égaux ne verraient ni une famille
 * recopiée dans l'autre, ni une faute d'accord singulier/pluriel.
 */
const PERIODES_TROIS_STATUTS = {
  data: [
    PERIODE_CLOTUREE,
    {
      id: 'per-2026-07',
      annee: 2026,
      mois: 7,
      statut: 'ouverte',
      dateCloture: null,
      clotureePar: null,
      dateReouverture: null,
      motifReouverture: null,
    },
    {
      id: 'per-2026-05',
      annee: 2026,
      mois: 5,
      statut: 'verrouillee',
      dateCloture: '2026-06-03T09:00:00.000Z',
      clotureePar: 'Le porteur du projet',
      dateReouverture: null,
      motifReouverture: null,
    },
  ],
  meta: { total: 3 },
};

const IMPACT_JUIN = {
  periodeId: 'per-2026-06',
  annee: 2026,
  mois: 6,
  mouvementsStockNonAnnulesCount: 17,
  receptionsNonAnnuleesCount: 3,
  productionsNonAnnuleesCount: 1,
  sessionsNonAnnuleesCount: 4,
  depensesCount: 6,
  immobilisationsCount: 0,
};

/** Le texte EXACT à recopier pour la période de juin 2026 de la fixture. */
const RECOPIE_ATTENDUE = 'Juin 2026';

function feindreAvecPeriodes(supplement: ReponsesFeintes = {}): void {
  feindre({
    synthese: synthese(),
    echeances: LISTE_VIDE,
    creneaux: listeCreneaux([], 0),
    periodes: PERIODES_TROIS_STATUTS,
    ...supplement,
  });
}

/** Ouvre la confirmation sur juin 2026 et rend la main une fois montée. */
async function ouvrirConfirmationVerrouillage(): Promise<void> {
  monter();
  const declencheur = await screen.findByRole('button', { name: 'Verrouiller…' });
  fireEvent.click(declencheur);
  await screen.findByText(/^Verrouillage définitif — /);
}

/** Le bouton d'ancrage du focus, dont le libellé porte le mois COURANT. */
function boutonCloturer(): HTMLElement {
  return screen.getByRole('button', { name: /^Clôturer / });
}

/** Tous les `POST` partis vers la route de verrouillage, quelle que soit la période. */
function postsDeVerrouillage(): unknown[] {
  return appel.mock.calls.filter(
    ([chemin, options]) =>
      typeof chemin === 'string' &&
      chemin.endsWith('/verrouiller') &&
      (options as RequestInit | undefined)?.method === 'POST',
  );
}

describe('Comptabilité — le verrou définitif ne se pose jamais par accident', () => {
  it('n’offre « Verrouiller… » QUE sur une période clôturée — jamais ouverte, jamais déjà verrouillée', async () => {
    feindreAvecPeriodes({ impactVerrouillage: IMPACT_JUIN });
    monter();

    await screen.findByText('Juin 2026');
    // Un seul déclencheur pour trois périodes : `getAllByRole` plutôt que
    // `getByRole`, pour que le test échoue en DISANT combien il en a trouvé si
    // un jour il s'en ajoute un sur le mauvais statut.
    expect(screen.getAllByRole('button', { name: 'Verrouiller…' })).toHaveLength(1);
    // « Rouvrir » suit la même règle, en miroir : la période déjà verrouillée
    // ne l'offre pas non plus (le point de non-retour ne bouge plus).
    expect(screen.getAllByRole('button', { name: 'Rouvrir' })).toHaveLength(1);

    const ligneVerrouillee = screen.getByText('Mai 2026').closest('tr') as HTMLTableRowElement;
    expect(within(ligneVerrouillee).queryByRole('button', { name: 'Verrouiller…' })).toBeNull();
    expect(within(ligneVerrouillee).queryByRole('button', { name: 'Rouvrir' })).toBeNull();
    expect(within(ligneVerrouillee).getByText('Verrouillée')).toBeInTheDocument();
  });

  it('le clic ouvre la confirmation, demande l’impact de CETTE période, et pose le focus sur la recopie', async () => {
    feindreAvecPeriodes({ impactVerrouillage: IMPACT_JUIN });
    await ouvrirConfirmationVerrouillage();

    expect(cheminsAppeles).toContain('/periodes/per-2026-06/impact-verrouillage');
    const champ = await screen.findByLabelText(
      `Recopier « ${RECOPIE_ATTENDUE} » pour confirmer le verrouillage définitif`,
    );
    // `document.activeElement` RÉEL : un `autoFocus` posé dans le balisage
    // prouverait une intention, pas un focus.
    expect(document.activeElement).toBe(champ);
  });

  it('affiche les DEUX familles de conséquences, jamais additionnées, et l’écart des factures', async () => {
    feindreAvecPeriodes({ impactVerrouillage: IMPACT_JUIN });
    await ouvrirConfirmationVerrouillage();

    expect(await screen.findByText('Définitivement incorrigible')).toBeInTheDocument();
    expect(screen.getByText('17 mouvements de stock non annulés')).toBeInTheDocument();
    expect(screen.getByText('1 production non annulée')).toBeInTheDocument();
    expect(screen.getByText(/Informatif seulement/)).toBeInTheDocument();
    expect(screen.getByText(/6 dépenses de ce mois/)).toBeInTheDocument();
    // L'avertissement n'EXAGÈRE pas sa portée : `services/factures.ts`
    // n'appelle jamais la garde du verrou (zéro occurrence), donc l'écran le
    // dit plutôt que de laisser lire « verrouillé » comme « tout est figé ».
    expect(
      screen.getByText(/Les factures fournisseur ne sont pas regardées par ce verrou/),
    ).toBeInTheDocument();
    // Aucun total des six compteurs (17+3+1+4+6+0 = 31) nulle part.
    expect(document.body.textContent ?? '').not.toMatch(/\b31\b/);
  });

  it('tant que l’impact charge : ni recopie, ni bouton final — un décompte inconnu ne propose rien', async () => {
    // `impactVerrouillage` laissé à `undefined` : la promesse ne se résout
    // jamais, l'état reste `'chargement'`.
    feindreAvecPeriodes();
    await ouvrirConfirmationVerrouillage();

    expect(screen.getByText('Calcul de l’impact…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verrouiller définitivement' })).toBeNull();
    expect(
      screen.queryByLabelText(
        `Recopier « ${RECOPIE_ATTENDUE} » pour confirmer le verrouillage définitif`,
      ),
    ).toBeNull();
  });

  it('un impact qui ÉCHOUE refuse le geste, reste dans le registre NEUTRE, et donne le focus à « Fermer »', async () => {
    feindreAvecPeriodes({
      impactVerrouillage: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    await ouvrirConfirmationVerrouillage();

    const refus = await screen.findByText(/Verrouillage refusé/);
    expect(refus).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verrouiller définitivement' })).toBeNull();

    // Une panne réseau n'est PAS une alerte métier : le registre `depassement`
    // reste réservé à ce qui demande un geste (docs/07 §4.8).
    for (const message of screen.getAllByRole('alert')) {
      expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    }

    const fermer = screen.getByRole('button', { name: 'Fermer' });
    expect(document.activeElement).toBe(fermer);
  });

  it('le bouton final reste inerte tant que la recopie n’est pas EXACTE, puis s’active', async () => {
    feindreAvecPeriodes({ impactVerrouillage: IMPACT_JUIN });
    await ouvrirConfirmationVerrouillage();

    const champ = await screen.findByLabelText(
      `Recopier « ${RECOPIE_ATTENDUE} » pour confirmer le verrouillage définitif`,
    );
    const bouton = screen.getByRole('button', { name: 'Verrouiller définitivement' });
    expect(bouton).toBeDisabled();

    // Une casse différente ne suffit pas : recopier veut dire recopier.
    fireEvent.change(champ, { target: { value: 'juin 2026' } });
    expect(bouton).toBeDisabled();

    fireEvent.change(champ, { target: { value: RECOPIE_ATTENDUE } });
    expect(bouton).toBeEnabled();
    // Et rien n'est encore parti : c'est l'activation d'un bouton, pas un geste.
    expect(postsDeVerrouillage()).toHaveLength(0);
  });

  it('« Entrée » dans le champ de recopie ne verrouille RIEN — il n’y a pas de `<form>` ici', async () => {
    feindreAvecPeriodes({ impactVerrouillage: IMPACT_JUIN });
    await ouvrirConfirmationVerrouillage();

    const champ = await screen.findByLabelText(
      `Recopier « ${RECOPIE_ATTENDUE} » pour confirmer le verrouillage définitif`,
    );
    fireEvent.change(champ, { target: { value: RECOPIE_ATTENDUE } });
    // Le bouton est ACTIF : si « Entrée » soumettait, ce serait maintenant.
    expect(screen.getByRole('button', { name: 'Verrouiller définitivement' })).toBeEnabled();

    fireEvent.keyDown(champ, { key: 'Enter', code: 'Enter' });
    fireEvent.submit(champ);

    expect(postsDeVerrouillage()).toHaveLength(0);
    // La confirmation est toujours là : « Entrée » n'a pas non plus refermé.
    expect(screen.getByText(/^Verrouillage définitif — /)).toBeInTheDocument();
  });

  it('« Échap » referme sans jamais confirmer, et rend le focus au bouton de clôture', async () => {
    feindreAvecPeriodes({ impactVerrouillage: IMPACT_JUIN });
    await ouvrirConfirmationVerrouillage();

    const champ = await screen.findByLabelText(
      `Recopier « ${RECOPIE_ATTENDUE} » pour confirmer le verrouillage définitif`,
    );
    fireEvent.change(champ, { target: { value: RECOPIE_ATTENDUE } });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByText(/^Verrouillage définitif — /)).toBeNull();
    expect(postsDeVerrouillage()).toHaveLength(0);
    expect(document.activeElement).toBe(boutonCloturer());
  });

  it('rouvrir la confirmation repart d’une recopie VIDE — une saisie ne survit pas à une fermeture', async () => {
    feindreAvecPeriodes({ impactVerrouillage: IMPACT_JUIN });
    await ouvrirConfirmationVerrouillage();

    const champ = await screen.findByLabelText(
      `Recopier « ${RECOPIE_ATTENDUE} » pour confirmer le verrouillage définitif`,
    );
    fireEvent.change(champ, { target: { value: RECOPIE_ATTENDUE } });
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Verrouiller…' }));
    const champRouvert = await screen.findByLabelText(
      `Recopier « ${RECOPIE_ATTENDUE} » pour confirmer le verrouillage définitif`,
    );
    expect((champRouvert as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Verrouiller définitivement' })).toBeDisabled();
  });

  it('les deux confirmations s’excluent : ouvrir le verrouillage ferme la réouverture, et l’inverse', async () => {
    feindreAvecPeriodes({ impactVerrouillage: IMPACT_JUIN });
    monter();

    fireEvent.click(await screen.findByRole('button', { name: 'Rouvrir' }));
    expect(screen.getByLabelText('Motif de la réouverture')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Verrouiller…' }));
    // L'une est réversible et l'autre définitive : les afficher ensemble sous
    // le même tableau invite au clic sur la mauvaise.
    expect(screen.queryByLabelText('Motif de la réouverture')).toBeNull();
    await screen.findByText(/^Verrouillage définitif — /);

    fireEvent.click(screen.getByRole('button', { name: 'Rouvrir' }));
    expect(screen.queryByText(/^Verrouillage définitif — /)).toBeNull();
    expect(screen.getByLabelText('Motif de la réouverture')).toBeInTheDocument();
  });

  it('le geste confirmé part sur la BONNE période, puis rend le focus au bouton de clôture', async () => {
    feindreAvecPeriodes({
      impactVerrouillage: IMPACT_JUIN,
      verrouillage: { ...PERIODE_CLOTUREE, statut: 'verrouillee' },
    });
    await ouvrirConfirmationVerrouillage();

    const champ = await screen.findByLabelText(
      `Recopier « ${RECOPIE_ATTENDUE} » pour confirmer le verrouillage définitif`,
    );
    fireEvent.change(champ, { target: { value: RECOPIE_ATTENDUE } });
    fireEvent.click(screen.getByRole('button', { name: 'Verrouiller définitivement' }));

    await waitFor(() => expect(postsDeVerrouillage()).toHaveLength(1));
    // La période visée est celle de la LIGNE cliquée, jamais « la première » :
    // deux autres périodes existent dans la fixture, dont une déjà verrouillée.
    expect(cheminsAppeles).toContain('/periodes/per-2026-06/verrouiller');
    await waitFor(() => expect(document.activeElement).toBe(boutonCloturer()));
    // Et la liste est relue : l'écran ne réécrit pas le statut de son côté.
    expect(cheminsAppeles.filter((c) => c === '/periodes').length).toBeGreaterThanOrEqual(2);
  });

  it('un refus du serveur affiche son message et REND le focus au bouton, que `disabled` lui avait pris', async () => {
    feindreAvecPeriodes({
      impactVerrouillage: IMPACT_JUIN,
      verrouillage: new ErreurApi('La période 06/2026 est déjà verrouillée.', {
        code: 'periode_deja_verrouillee',
        statut: 422,
      }),
    });
    await ouvrirConfirmationVerrouillage();

    const champ = await screen.findByLabelText(
      `Recopier « ${RECOPIE_ATTENDUE} » pour confirmer le verrouillage définitif`,
    );
    fireEvent.change(champ, { target: { value: RECOPIE_ATTENDUE } });
    fireEvent.click(screen.getByRole('button', { name: 'Verrouiller définitivement' }));

    expect(await screen.findByText('La période 06/2026 est déjà verrouillée.')).toBeInTheDocument();
    // `disabled={enCours}` fait lâcher le focus au profit de `<body>` AVANT
    // tout rendu React : sans le `requestAnimationFrame` du gestionnaire, le
    // porteur se retrouverait au clavier sur rien du tout.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Verrouiller définitivement' }),
      ),
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. Transitions d'état pendant l'aller-retour — la promesse EN VOL

   Tout ce qui précède résout ses écritures soit IMMÉDIATEMENT
   (`Promise.resolve`, via `reponses.verrouillage` dans `feindre`), soit
   JAMAIS (`new Promise<never>(() => {})`, pour figer un chargement). Aucune
   des deux formes ne peut voir un bouton `disabled` PENDANT la requête, ni
   son libellé d'attente, ni son retour à l'état actionnable — c'est
   exactement la « cinquième forme » de fixture aveugle mesurée le 02/08/2026
   (docs/39-DOCTRINE-DES-AGENTS.md §3) : une promesse déjà résolue rend l'état
   « en cours » invisible, dans le MÊME écoulement de micro-tâches que sa
   pose. Les deux tests ci-dessous résolvent la promesse EUX-MÊMES, après
   avoir observé l'état « en cours » dans le DOM.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Comptabilité — une écriture annonce son envoi, et ne le refait pas deux fois', () => {
  it(
    'création d’une dépense : le bouton passe à « Enregistrement… » (disabled) pendant le POST, ' +
      'et redevient « Enregistrer » actionnable après un refus serveur',
    async () => {
      let rejeter: ((raison: unknown) => void) | undefined;
      appel.mockImplementation((chemin: string, options?: RequestInit) => {
        cheminsAppeles.push(chemin);
        if (chemin === '/depenses' && options?.method === 'POST') {
          return new Promise((_resoudre, rej) => {
            rejeter = rej;
          });
        }
        if (options?.method !== undefined && options.method !== 'GET') {
          return new Promise<never>(() => {});
        }
        if (chemin.startsWith('/synthese-exercice')) return Promise.resolve(synthese() as never);
        if (chemin.startsWith('/depenses')) return Promise.resolve(LISTE_VIDE as never);
        if (chemin.startsWith('/echeances')) return Promise.resolve(LISTE_VIDE as never);
        if (chemin.startsWith('/ventes-par-creneau'))
          return Promise.resolve(listeCreneaux([], 0) as never);
        if (chemin === '/parametres') return Promise.resolve(catalogueParametres(null) as never);
        if (chemin === '/periodes') return Promise.resolve(LISTE_VIDE as never);
        if (chemin.startsWith('/immobilisations')) return Promise.resolve(LISTE_VIDE as never);
        return Promise.resolve(LISTE_VIDE as never);
      });

      monter();
      await screen.findByText('Recettes');

      fireEvent.click(screen.getByRole('button', { name: 'Nouvelle dépense' }));
      fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Farine T55' } });
      fireEvent.change(screen.getByLabelText('Montant (€)'), { target: { value: '10' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      const bouton = await screen.findByRole('button', { name: 'Enregistrement…' });
      expect(bouton).toBeDisabled();

      /*
        `creerDepense` porte un garde-fou explicite
        (`if (etatCreationDepense.statut === 'en_cours') return;`), mais AUCUN
        raccourci clavier n'atteint ce formulaire sur cet écran (contrairement
        à `SaisieSortie`, qui écoute Ctrl+S sur son `<form>`) : le `disabled`
        natif est donc le SEUL verrou jamais exercé par un geste utilisateur
        réel. Ce second clic ne prouve donc que le blocage NATIF du navigateur
        sur un bouton `disabled` — pas le garde-fou applicatif, qu'aucun
        chemin réel n'atteint jamais en double.
      */
      fireEvent.click(bouton);
      const postsDepense = () =>
        appel.mock.calls.filter(
          ([c, o]) => c === '/depenses' && (o as RequestInit | undefined)?.method === 'POST',
        );
      expect(postsDepense()).toHaveLength(1);

      // Refus serveur plutôt que succès : un succès REFERME le panneau
      // (`setCreationDepenseOuverte(false)`), donc ce bouton disparaîtrait —
      // seul un refus montre ce MÊME bouton redevenir « Enregistrer »,
      // actionnable, sans quitter l'écran.
      rejeter?.(
        new ErreurApi('Le libellé est déjà utilisé ce mois-ci.', {
          code: 'depense_dupliquee',
          statut: 409,
        }),
      );

      const revenu = await screen.findByRole('button', { name: 'Enregistrer' });
      expect(revenu).toBeEnabled();
      expect(
        await screen.findByText('Le libellé est déjà utilisé ce mois-ci.'),
      ).toBeInTheDocument();
    },
  );

  it(
    'verrouillage définitif d’une période : « Verrouiller définitivement » passe à ' +
      '« Verrouillage… » (disabled) pendant le POST, et un second clic n’envoie rien de plus',
    async () => {
      feindreAvecPeriodes({ impactVerrouillage: IMPACT_JUIN });
      await ouvrirConfirmationVerrouillage();

      const champ = await screen.findByLabelText(
        `Recopier « ${RECOPIE_ATTENDUE} » pour confirmer le verrouillage définitif`,
      );
      fireEvent.change(champ, { target: { value: RECOPIE_ATTENDUE } });

      // À partir d'ici, la fixture partagée (`feindre`) est remplacée par une
      // promesse CONTRÔLÉE pour le seul `POST /verrouiller` : les tests du
      // bloc 5 ci-dessus la résolvent soit immédiatement
      // (`reponses.verrouillage`, via `Promise.resolve`), soit jamais —
      // aucun des deux ne peut montrer l'état « en cours » PENDANT la
      // requête, qui est le sujet de ce test-ci.
      let repondre: ((valeur: unknown) => void) | undefined;
      appel.mockImplementation((chemin: string, options?: RequestInit) => {
        cheminsAppeles.push(chemin);
        if (chemin.endsWith('/verrouiller') && options?.method === 'POST') {
          return new Promise((resoudre) => {
            repondre = resoudre;
          });
        }
        if (chemin === '/periodes') return Promise.resolve(PERIODES_TROIS_STATUTS as never);
        return new Promise<never>(() => {});
      });

      fireEvent.click(screen.getByRole('button', { name: 'Verrouiller définitivement' }));

      const boutonEnCours = await screen.findByRole('button', { name: 'Verrouillage…' });
      expect(boutonEnCours).toBeDisabled();

      /*
        Aucun `<form>` n'entoure ce bouton et rien n'écoute Ctrl+S pour CE
        geste (voir le commentaire d'en-tête de la section « Verrouillage
        définitif » de `Comptabilite.tsx` : « Aucun raccourci clavier ne peut
        l'atteindre »). `confirmerVerrouillagePeriode` ne porte d'ailleurs
        AUCUN garde-fou `if (etatEcritureVerrouillage.statut === 'en_cours')
        return` dans son corps — le SEUL verrou posé est ce `disabled` natif.
        Ce second clic ne mesure donc que lui, jamais un garde-fou applicatif
        distinct : il n'y en a pas à mesurer.
      */
      fireEvent.click(boutonEnCours);
      const posts = appel.mock.calls.filter(
        ([c, o]) =>
          typeof c === 'string' &&
          c.endsWith('/verrouiller') &&
          (o as RequestInit | undefined)?.method === 'POST',
      );
      expect(posts).toHaveLength(1);

      repondre?.({ ...PERIODE_CLOTUREE, statut: 'verrouillee' });

      // La confirmation entière se démonte au succès
      // (`setPeriodeEnVerrouillageId(null)`) : c'est elle, plutôt que CE
      // bouton précis, qui « redevient actionnable » — la preuve que l'état
      // n'est pas resté bloqué à « en cours » à vie est sa disparition.
      await waitFor(() => expect(screen.queryByText(/^Verrouillage définitif — /)).toBeNull());
    },
  );
});
