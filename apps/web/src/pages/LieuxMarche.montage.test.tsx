/**
 * Écran Lieux de marché — premier test MONTÉ de cet écran.
 *
 * ═══ Pourquoi ce fichier existe ═══
 *
 * `LieuxMarche.tsx` était à **0 % de couverture** au 01/08/2026. Comme
 * `Equipements.tsx`, il n'exporte aucune fonction pure : tout ce qu'il décide
 * vit dans des `useEffect`, des états React et des rendus conditionnels — donc
 * hors de portée de `renderToStaticMarkup`, qui ne voit que le premier rendu.
 *
 * ═══ Ce que cet écran a de particulier ═══
 *
 * DEUX champs y portent des conséquences invisibles, et ce sont eux qu'on
 * teste en priorité :
 *
 * 1. **Latitude / longitude** alimentent `releverMeteo`. Sans elles, le
 *    facteur météo de la prévision est neutralisé SILENCIEUSEMENT. La colonne
 *    « Météo » est donc une colonne d'EXCEPTION, pas une décoration — un lieu
 *    sans coordonnées doit se voir dans la liste.
 * 2. **La distance** ne vaut JAMAIS 0 km quand elle est absente (fiche 13) :
 *    un lieu sans distance ne peut pas être comparé aux autres sur la marge
 *    nette, et un 0 km ferait passer un déplacement pour gratuit.
 *
 * ═══ Sur les fixtures ═══
 *
 * Chaque jeu porte le cas connu ET le cas inconnu. Une liste de lieux tous
 * localisés ne prouverait rien sur l'affichage d'un lieu sans coordonnées ;
 * une liste d'un seul lieu ne prouverait rien sur la sélection au clavier.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TIRET_ABSENT, formaterMontant, type LieuComplet } from '@batte/core';

import type * as ApiReelle from '../lib/api';

// `typeof ApiReelle` plutôt que `typeof import('../lib/api')` : la règle
// `@typescript-eslint/consistent-type-imports` interdit l'annotation
// `import()` en ligne. Le `import type` ci-dessus est effacé à la
// compilation — il ne crée donc aucune référence de VALEUR dans la fabrique
// de `vi.mock`, que Vitest remonte en tête de fichier.
vi.mock('../lib/api', async (importerReel) => {
  const reel = await importerReel<typeof ApiReelle>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: LieuxMarche } = await import('./LieuxMarche');

const appel = vi.mocked(requeteApi);

/** Classe du registre d'alerte MÉTIER, celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function lieu(partiel: Partial<LieuComplet> = {}): LieuComplet {
  return {
    id: 'lieu-1',
    nom: 'La Batte',
    adresse: 'Quai de la Batte, 4000 Liège',
    latitude: 50.6469,
    longitude: 5.5786,
    jourSemaine: 0,
    heureDebut: '08:00',
    heureFin: '14:30',
    tarifEmplacementCents: 2200,
    modeTarification: 'metre_lineaire_mois',
    metresLineaires: 4,
    distanceKm: 23.4,
    facturationElectricite: 'aucune',
    puissanceDisponibleW: null,
    notes: null,
    actif: true,
    nbSessions: 12,
    distanceCalculAutomatique: null,
    ...partiel,
  };
}

/**
 * DEUX lieux qui se distinguent sur tout ce que l'écran est censé montrer :
 * l'un localisé, tarifé, à distance connue ; l'autre sans coordonnées, sans
 * tarif, sans jour, sans distance. Sans ce SECOND lieu, aucun test de cet
 * écran ne pourrait discriminer « inconnu » de « zéro ».
 */
const LIEU_COMPLET = lieu();
const LIEU_LACUNAIRE = lieu({
  id: 'lieu-2',
  nom: 'Marché couvert de Sainte-Marguerite',
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
  notes: null,
  nbSessions: 0,
});

type ReponsesFeintes = {
  lieux?: unknown;
  equipements?: unknown;
  /** Réponses des écritures, servies dans l'ordre d'appel. */
  ecritures?: unknown[];
};

function feindre(reponses: ReponsesFeintes): void {
  const ecritures = [...(reponses.ecritures ?? [])];
  appel.mockImplementation((chemin: string, options?: RequestInit) => {
    const enLecture = options?.method === undefined || options.method === 'GET';
    if (!enLecture) {
      const suivante = ecritures.shift();
      if (suivante === undefined) return new Promise<never>(() => {});
      if (suivante instanceof Error) return Promise.reject(suivante);
      return Promise.resolve(suivante as never);
    }
    const choisie =
      chemin === '/referentiel/lieux'
        ? reponses.lieux
        : chemin === '/equipements'
          ? reponses.equipements
          : undefined;
    if (choisie === undefined) return new Promise<never>(() => {});
    if (choisie instanceof Error) return Promise.reject(choisie);
    return Promise.resolve(choisie as never);
  });
}

function listeLieux(lieux: LieuComplet[]): unknown {
  return { data: lieux, meta: { total: lieux.length } };
}

function parcEquipements(puissanceTotaleEnServiceW: number): unknown {
  return { data: [], meta: { total: 0, puissanceTotaleEnServiceW } };
}

beforeEach(() => {
  appel.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Les trois états d'un écran de lecture
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Lieux de marché — chargement, erreur, vide', () => {
  it('annonce le chargement plutôt que de laisser un panneau muet', () => {
    feindre({});
    render(<LieuxMarche />);

    expect(screen.getByText('Chargement des lieux…')).toBeInTheDocument();
  });

  it('affiche le message du serveur en cas d’échec, SANS la couleur d’alerte métier', async () => {
    feindre({
      lieux: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<LieuxMarche />);

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue du serveur (code HTTP 500).');
    // Une coupure réseau ne demande aucun geste : elle n'emprunte pas le
    // registre d'une rupture de stock (correctif du 01/08/2026, 78 emplacements).
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    expect(message.parentElement?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
  });

  it('une erreur RÉSEAU (pas même une ErreurApi) reste lisible et neutre', async () => {
    feindre({ lieux: new TypeError('Failed to fetch') });
    render(<LieuxMarche />);

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue, sans plus de détail.');
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
  });

  it('le panneau garde son titre quand le chargement échoue', async () => {
    feindre({
      lieux: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<LieuxMarche />);

    await screen.findByRole('alert');
    // `level: 2` et non le nom seul : le `h1` de la page et le `h2` du panneau
    // portent le MÊME libellé. C'est le titre du PANNEAU qui doit survivre —
    // un encart qui disparaît avec son titre ne dit plus lequel est mort.
    expect(screen.getByRole('heading', { level: 2, name: 'Lieux de marché' })).toBeInTheDocument();
  });

  it('liste vide au premier lancement : la phrase dit à quoi servent les coordonnées', async () => {
    feindre({ lieux: listeLieux([]), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    expect(await screen.findByText('Aucun lieu de marché')).toBeInTheDocument();
    expect(screen.getByText(/Ses coordonnées servent à relever la météo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer un lieu' })).toBeInTheDocument();
  });

  it('liste non vide mais masquée par le filtre : l’état vide nomme LE filtre, pas le vide', async () => {
    const retires = [
      lieu({ id: 'lieu-1', actif: false }),
      lieu({ id: 'lieu-2', nom: 'Marché de Herstal', actif: false }),
    ];
    feindre({ lieux: listeLieux(retires), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    expect(
      await screen.findByText(
        'Les 2 lieux enregistrés sont tous retirés, et le filtre les masque.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Aucun lieu de marché')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser le filtre' }));
    expect(screen.getByText('Marché de Herstal')).toBeInTheDocument();
  });

  it('le compte « visibles sur total » suit le filtre, il ne le contredit pas', async () => {
    const mixte = [LIEU_COMPLET, lieu({ id: 'lieu-3', nom: 'Marché de Herstal', actif: false })];
    feindre({ lieux: listeLieux(mixte), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    expect(await screen.findByText('1 sur 2 lieux')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Afficher aussi les lieux retirés/ }),
    );
    expect(screen.getByText('2 sur 2 lieux')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Inconnu ≠ zéro, et la colonne d'exception « Météo »
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Lieux de marché — ce qui manque se voit, et ne se lit pas comme un zéro', () => {
  it('un lieu sans coordonnées est signalé dans la liste, un lieu localisé ne l’est pas', async () => {
    feindre({
      lieux: listeLieux([LIEU_COMPLET, LIEU_LACUNAIRE]),
      equipements: parcEquipements(0),
    });
    render(<LieuxMarche />);

    const rangeeLacunaire = (
      await screen.findByText('Marché couvert de Sainte-Marguerite')
    ).closest('tr') as HTMLTableRowElement;
    expect(within(rangeeLacunaire).getByText('sans coordonnées')).toBeInTheDocument();

    // Le SECOND lieu, lui, est localisé : sans lui, ce test passerait aussi
    // sur un écran qui écrirait « sans coordonnées » sur chaque ligne.
    const rangeeComplete = screen.getByText('La Batte').closest('tr') as HTMLTableRowElement;
    expect(within(rangeeComplete).getByText('localisé')).toBeInTheDocument();
    expect(within(rangeeComplete).queryByText('sans coordonnées')).not.toBeInTheDocument();
  });

  it('un jour de marché inconnu rend le tiret d’absence, jamais « Dimanche » par défaut', async () => {
    feindre({
      lieux: listeLieux([LIEU_COMPLET, LIEU_LACUNAIRE]),
      equipements: parcEquipements(0),
    });
    render(<LieuxMarche />);

    const rangeeLacunaire = (
      await screen.findByText('Marché couvert de Sainte-Marguerite')
    ).closest('tr') as HTMLTableRowElement;
    expect(within(rangeeLacunaire).getByText(TIRET_ABSENT)).toBeInTheDocument();
    expect(within(rangeeLacunaire).queryByText('Dimanche')).not.toBeInTheDocument();

    // `jourSemaine: 0` n'est PAS une absence : c'est dimanche, et La Batte s'y
    // tient. C'est exactement la confusion que ce test existe pour interdire.
    const rangeeComplete = screen.getByText('La Batte').closest('tr') as HTMLTableRowElement;
    expect(within(rangeeComplete).getByText('Dimanche')).toBeInTheDocument();
  });

  it('un tarif absent laisse le champ VIDE, jamais « 0,00 »', async () => {
    feindre({
      lieux: listeLieux([LIEU_COMPLET, LIEU_LACUNAIRE]),
      equipements: parcEquipements(0),
    });
    render(<LieuxMarche />);

    await screen.findByText('Marché couvert de Sainte-Marguerite');
    await userEvent.click(screen.getByText('Marché couvert de Sainte-Marguerite'));

    const tarif = document.querySelector('[name="tarifEmplacementCents"]') as HTMLInputElement;
    expect(tarif.value).toBe('');
    // Un tarif d'emplacement à zéro serait un emplacement GRATUIT — ce n'est
    // pas la même information qu'un tarif non renseigné.
    expect(tarif.value).not.toBe(formaterMontant(0));
  });

  it('un tarif présent se pré-remplit via le FORMATEUR, jamais un littéral tapé à la main', async () => {
    feindre({ lieux: listeLieux([LIEU_COMPLET]), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));

    const tarif = document.querySelector('[name="tarifEmplacementCents"]') as HTMLInputElement;
    expect(tarif.value).toBe(formaterMontant(2200));
  });

  it('une distance absente laisse le champ vide et coupe la suggestion faute de coordonnées', async () => {
    feindre({
      lieux: listeLieux([LIEU_COMPLET, LIEU_LACUNAIRE]),
      equipements: parcEquipements(0),
    });
    render(<LieuxMarche />);

    await screen.findByText('Marché couvert de Sainte-Marguerite');
    await userEvent.click(screen.getByText('Marché couvert de Sainte-Marguerite'));

    expect((document.querySelector('[name="distanceKm"]') as HTMLInputElement).value).toBe('');
    expect(
      screen.getByText(
        /Ce lieu n’a pas de coordonnées : renseignez latitude et longitude ci-dessus/,
      ),
    ).toBeInTheDocument();
  });

  it('une distance décimale se pré-remplit à la virgule française, pas au point anglo-saxon', async () => {
    feindre({ lieux: listeLieux([LIEU_COMPLET]), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));

    // D-074 : `distanceKm` porte une décimale depuis qu'OpenRouteService la
    // calcule au dixième de km. Un `String(23.4)` brut afficherait « 23.4 »
    // dans un formulaire où tout le reste parle en virgules.
    expect((document.querySelector('[name="distanceKm"]') as HTMLInputElement).value).toBe('23,4');
  });

  it('l’attribution OpenStreetMap est affichée, licence CC-BY oblige', async () => {
    feindre({ lieux: listeLieux([LIEU_COMPLET]), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    expect(
      await screen.findByText(/OpenRouteService, © contributeurs OpenStreetMap \(CC BY 4\.0\)/),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Suggestion de distance à vol d'oiseau — un chiffre À CORRIGER
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Lieux de marché — la suggestion de distance ne fait jamais foi', () => {
  it('une distance déjà confirmée prime : aucune suggestion ne s’y substitue', async () => {
    feindre({ lieux: listeLieux([LIEU_COMPLET]), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));

    // Même en donnant un point de départ, l'écran dit que la distance
    // confirmée prime (`etatDistanceLieu` → 'confirmee').
    await userEvent.type(
      document.querySelector('[name="origineLatitude"]') as HTMLInputElement,
      '50,45',
    );
    await userEvent.type(
      document.querySelector('[name="origineLongitude"]') as HTMLInputElement,
      '4,87',
    );

    expect(screen.getByText(/Une distance confirmée existe déjà pour ce lieu/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Utiliser cette estimation' })).toBeNull();
  });

  it('sans distance confirmée, la suggestion apparaît — et seulement quand le départ est saisi', async () => {
    // Fixture DISCRIMINANTE : coordonnées du lieu connues, mais distance
    // absente. C'est le seul cas où l'état 'suggeree' est atteignable.
    const sansDistance = lieu({ id: 'lieu-4', nom: 'Marché de Visé', distanceKm: null });
    feindre({ lieux: listeLieux([sansDistance]), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    await screen.findByText('Marché de Visé');
    await userEvent.click(screen.getByText('Marché de Visé'));

    // Tant que le point de départ manque, rien n'est proposé : on ne fabrique
    // pas une distance depuis une seule extrémité.
    expect(screen.queryByRole('button', { name: 'Utiliser cette estimation' })).toBeNull();

    await userEvent.type(
      document.querySelector('[name="origineLatitude"]') as HTMLInputElement,
      '50,45',
    );
    await userEvent.type(
      document.querySelector('[name="origineLongitude"]') as HTMLInputElement,
      '4,87',
    );

    const bouton = await screen.findByRole('button', { name: 'Utiliser cette estimation' });
    expect(screen.getByText(/à vol d’oiseau — à corriger avec votre GPS/)).toBeInTheDocument();

    // Et elle n'entre dans le formulaire QUE sur un geste explicite.
    const distance = document.querySelector('[name="distanceKm"]') as HTMLInputElement;
    expect(distance.value).toBe('');
    await userEvent.click(bouton);
    expect(distance.value).not.toBe('');
    expect(Number(distance.value)).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Diagnostic de disjonction — mode dégradé et inconnue non jugée
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Lieux de marché — le diagnostic de puissance se tait plutôt que de mentir', () => {
  it('sans parc d’équipements lisible, le diagnostic disparaît et l’écran reste utilisable', async () => {
    feindre({
      lieux: listeLieux([LIEU_COMPLET]),
      equipements: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));
    await userEvent.type(
      document.querySelector('[name="puissanceDisponibleW"]') as HTMLInputElement,
      '3500',
    );

    // Aucune ligne de diagnostic : le complément s'efface, il ne casse rien.
    expect(screen.queryByText(/avant disjonction/)).toBeNull();
    expect(screen.queryByText(/W d’équipements en service sur ce lieu/)).toBeNull();
    // La gestion des lieux, elle, reste pleinement opérationnelle.
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  });

  it('avec un parc connu, une puissance disponible SUFFISANTE annonce la marge', async () => {
    feindre({ lieux: listeLieux([LIEU_COMPLET]), equipements: parcEquipements(3000) });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));
    await userEvent.type(
      document.querySelector('[name="puissanceDisponibleW"]') as HTMLInputElement,
      '4500',
    );

    expect(await screen.findByText(/marge de .* avant disjonction/)).toBeInTheDocument();
  });

  it('une puissance disponible INSUFFISANTE annonce le dépassement, en direct', async () => {
    feindre({ lieux: listeLieux([LIEU_COMPLET]), equipements: parcEquipements(4500) });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));
    await userEvent.type(
      document.querySelector('[name="puissanceDisponibleW"]') as HTMLInputElement,
      '3500',
    );

    const avertissement = await screen.findByText(/W de trop si tout tourne en même temps/);
    expect(avertissement.className).toContain('text-depassement');
  });

  it('une puissance disponible NON RENSEIGNÉE ne se lit pas comme « pas de risque »', async () => {
    feindre({ lieux: listeLieux([LIEU_COMPLET]), equipements: parcEquipements(4500) });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));

    // Le champ reste vide (`puissanceDisponibleW: null` dans la fixture).
    expect(
      (document.querySelector('[name="puissanceDisponibleW"]') as HTMLInputElement).value,
    ).toBe('');
    // D-055 : l'écran dit qu'il NE SAIT PAS, il n'affiche ni « ça tient » ni
    // une marge inventée.
    const message = await screen.findByText(/Puissance disponible non renseignée pour ce lieu/);
    expect(message.className).toContain('text-ink-3');
    expect(message.className).not.toContain('text-conforme');
    expect(screen.queryByText(/avant disjonction/)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Le clavier — CLAUDE.md §3 règle 10
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Lieux de marché — utilisable au clavier', () => {
  const DEUX = [LIEU_COMPLET, LIEU_LACUNAIRE];

  it('une seule rangée est dans l’ordre de tabulation — « roving tabindex »', async () => {
    feindre({ lieux: listeLieux(DEUX), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    const rangees = screen.getAllByRole('row').filter((r) => r.hasAttribute('tabindex'));
    expect(rangees).toHaveLength(2);
    expect(rangees.filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('Entrée charge la fiche du lieu, et la fiche prend son nom', async () => {
    feindre({ lieux: listeLieux(DEUX), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    await screen.findByText('Marché couvert de Sainte-Marguerite');
    const rangee = screen
      .getByText('Marché couvert de Sainte-Marguerite')
      .closest('tr') as HTMLTableRowElement;
    rangee.focus();
    await userEvent.keyboard('{Enter}');

    expect(rangee).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('heading', { name: 'Marché couvert de Sainte-Marguerite' }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Marché couvert de Sainte-Marguerite')).toBeInTheDocument();
  });

  it('Flèche Bas déplace le focus, Home revient à la première rangée', async () => {
    feindre({ lieux: listeLieux(DEUX), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    const premiere = screen.getByText('La Batte').closest('tr') as HTMLTableRowElement;
    const seconde = screen
      .getByText('Marché couvert de Sainte-Marguerite')
      .closest('tr') as HTMLTableRowElement;

    premiere.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(seconde);
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(premiere);
  });

  it('« Nouveau lieu » vide la fiche ET porte le focus au premier champ', async () => {
    feindre({ lieux: listeLieux(DEUX), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));
    expect(screen.getByDisplayValue('La Batte')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Nouveau lieu' }));

    expect(screen.queryByDisplayValue('La Batte')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Nouveau lieu' })).toBeInTheDocument();
    // Le focus est posé par un `setTimeout(…, 0)` : `waitFor` attend le tour de
    // boucle plutôt que de supposer qu'il a déjà eu lieu.
    await waitFor(() => expect(document.activeElement).toHaveAttribute('name', 'nom'));
  });

  it('Ctrl+S enregistre au clavier et pose le focus sur le premier champ fautif', async () => {
    feindre({ lieux: listeLieux(DEUX), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    const notes = document.querySelector('[name="notes"]') as HTMLInputElement;
    notes.focus();
    expect(document.activeElement).toBe(notes);

    const appelsAvant = appel.mock.calls.length;
    await userEvent.keyboard('{Control>}s{/Control}');

    // Le nom est obligatoire, la fiche est vierge : le schéma partagé refuse
    // AVANT tout aller-retour, et le focus va au champ en cause.
    expect(document.activeElement).toHaveAttribute('name', 'nom');
    expect(appel.mock.calls.length).toBe(appelsAvant);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. Enregistrement — ce que l'écran dit après coup
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Lieux de marché — l’indicateur d’enregistrement dit la vérité', () => {
  it('une modification non enregistrée est signalée, et l’état initial ne l’est pas', async () => {
    feindre({ lieux: listeLieux([LIEU_COMPLET]), equipements: parcEquipements(0) });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));
    // Juste après la sélection, rien n'a changé : aucun avertissement.
    expect(screen.queryByText('Modifications non enregistrées')).toBeNull();

    await userEvent.type(document.querySelector('[name="notes"]') as HTMLInputElement, 'x');
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
  });

  it('un échec de calcul automatique de distance est DIT après enregistrement', async () => {
    // Le serveur accepte l'écriture mais signale que le calcul de distance a
    // échoué (docs/21 §2.8) : sans cette ligne, la distance resterait vide ou
    // périmée sans un mot d'explication.
    const enregistre = {
      ...LIEU_COMPLET,
      distanceCalculAutomatique: {
        reussi: false,
        raison: 'OpenRouteService n’a pas répondu : la distance n’a pas été recalculée.',
      },
    };
    feindre({
      lieux: listeLieux([LIEU_COMPLET]),
      equipements: parcEquipements(0),
      ecritures: [enregistre],
    });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByText(
        'OpenRouteService n’a pas répondu : la distance n’a pas été recalculée.',
      ),
    ).toBeInTheDocument();
  });

  it('un calcul automatique RÉUSSI n’affiche aucun avertissement — la fixture discrimine', async () => {
    // Forme EXACTE de la branche `reussi: true` de l'union discriminée
    // (`schemaResultatCalculAutomatiqueDistance`) : elle porte `attribution`,
    // pas `raison`. Une fixture de forme approximative aurait été rejetée par
    // Zod et le test serait « passé » sur la branche d'erreur — un cas
    // impossible déguisé en cas nominal.
    const enregistre = {
      ...LIEU_COMPLET,
      distanceCalculAutomatique: {
        reussi: true,
        attribution: '© contributeurs OpenStreetMap (CC BY 4.0)',
      },
    };
    feindre({
      lieux: listeLieux([LIEU_COMPLET]),
      equipements: parcEquipements(0),
      ecritures: [enregistre],
    });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(/^Enregistré /)).toBeInTheDocument();
    expect(screen.queryByText(/OpenRouteService n’a pas répondu/)).toBeNull();
  });

  it('un refus du serveur pose l’erreur SOUS le champ nommé, et y porte le focus', async () => {
    feindre({
      lieux: listeLieux([LIEU_COMPLET]),
      equipements: parcEquipements(0),
      ecritures: [
        new ErreurApi('Saisie refusée.', {
          code: 'validation',
          statut: 422,
          champs: { latitude: 'La latitude est comprise entre -90 et 90.' },
        }),
      ],
    });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByText('La latitude est comprise entre -90 et 90.'),
    ).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute('name', 'latitude');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. L'état d'enregistrement PENDANT la requête (docs/39 §3, cinquième forme)
   ═══════════════════════════════════════════════════════════════════════════

   `feindre` (ci-dessus) sert ses écritures avec `Promise.resolve()`/
   `Promise.reject()` déjà résolues, ce qui convient pour vérifier un RÉSULTAT
   mais rend l'attente elle-même invisible : l'état `enregistrement` retombe à
   `'enregistre'`/`'modifie'` dans le même écoulement de micro-tâches que sa
   pose. Les deux tests ci-dessous posent leur PROPRE feinte, avec une
   promesse que le test résout lui-même — seul moyen d'observer ce qui vit
   PENDANT l'aller-retour.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Lieux de marché — l’état d’enregistrement, observé PENDANT que la requête est en vol', () => {
  it('« Enregistrer » devient inerte et l’indicateur dit « Enregistrement… », puis les deux redeviennent normaux', async () => {
    let repondre: ((valeur: unknown) => void) | undefined;
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      const methode = options?.method ?? 'GET';
      if (methode === 'GET' && chemin === '/referentiel/lieux') {
        return Promise.resolve(listeLieux([LIEU_COMPLET]));
      }
      if (methode === 'GET' && chemin === '/equipements') {
        return Promise.resolve(parcEquipements(0));
      }
      if (methode === 'PATCH' && chemin === '/lieux/lieu-1') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return Promise.reject(new Error(`Appel non attendu dans ce test : ${methode} ${chemin}`));
    });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));
    const bouton = screen.getByRole('button', { name: 'Enregistrer' });
    await userEvent.click(bouton);

    // La requête est EN VOL ici, et seulement ici : les deux canaux d'attente
    // à la fois — le bouton natif `disabled` et l'indicateur textuel.
    expect(bouton).toBeDisabled();
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();

    repondre?.(LIEU_COMPLET);

    await waitFor(() => expect(bouton).not.toBeDisabled());
    expect(await screen.findByText(/^Enregistré /)).toBeInTheDocument();
  });

  /**
   * ═══ DÉFAUT RÉEL, CORRIGÉ LE 28/09/2026 (était en `it.fails`) ═══
   *
   * Même défaut que sur `Produits.tsx`, `Menus.tsx`, `Equipements.tsx` et
   * `NomenclatureVente.tsx` : `enregistrer()` (`LieuxMarche.tsx`) ne consulte
   * jamais `enregistrement.phase` avant de reposter. Le bouton « Enregistrer »
   * est bien `disabled={enregistrement.phase === 'enregistrement'}`, ce qui
   * bloque un second CLIC — mais Ctrl+S est lu par le `onKeyDown` du `<div>`
   * racine et appelle `enregistrer()` sans jamais regarder cet état. Un second
   * Ctrl+S pendant l'envoi CONTOURNE donc le bouton désactivé et repart en
   * DEUXIÈME requête PATCH — sur cet écran précis, une seconde tentative de
   * calcul automatique de distance (OpenRouteService, un appel externe payant
   * en quota) pour une seule intention d'enregistrement.
   *
   * Ce test décrit le comportement SAIN (une seule requête). Il était en
   * `it.fails` jusqu'au correctif : une garde en tête de `enregistrer()`
   * refuse un second départ tant que le premier est en vol.
   */
  it('un second Ctrl+S pendant l’envoi ne contourne plus le bouton `disabled` : une seule requête (défaut corrigé le 28/09/2026)', async () => {
    const resolveurs: Array<(valeur: unknown) => void> = [];
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      const methode = options?.method ?? 'GET';
      if (methode === 'GET' && chemin === '/referentiel/lieux') {
        return Promise.resolve(listeLieux([LIEU_COMPLET]));
      }
      if (methode === 'GET' && chemin === '/equipements') {
        return Promise.resolve(parcEquipements(0));
      }
      if (methode === 'PATCH' && chemin === '/lieux/lieu-1') {
        return new Promise((resoudre) => resolveurs.push(resoudre));
      }
      return Promise.reject(new Error(`Appel non attendu dans ce test : ${methode} ${chemin}`));
    });
    render(<LieuxMarche />);

    await screen.findByText('La Batte');
    await userEvent.click(screen.getByText('La Batte'));

    // Un champ SANS conséquence sur la validité du corps envoyé : la seule
    // chose qui compte ici est que le focus reste DANS le formulaire.
    const notes = document.querySelector('[name="notes"]') as HTMLInputElement;
    notes.focus();

    await userEvent.keyboard('{Control>}s{/Control}');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

    // Le bouton est déjà `disabled` — et pourtant rien n'empêche ce second
    // Ctrl+S d'appeler `enregistrer()` une deuxième fois.
    await userEvent.keyboard('{Control>}s{/Control}');

    // Toujours résoudre AVANT l'assertion qui échoue, sinon les promesses
    // fuient dans le test suivant.
    resolveurs.forEach((r) => r(LIEU_COMPLET));

    expect(resolveurs.length).toBe(1);
  });
});
