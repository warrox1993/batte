/**
 * Écran Événements — premier test MONTÉ de cet écran.
 *
 * ═══ Pourquoi ce fichier existe ═══
 *
 * `Evenements.tsx` était à **0 % de couverture** au 01/08/2026. Il n'exporte
 * aucune fonction pure : la conversion saisie ↔ points de base, l'ouverture du
 * formulaire escamotable, le rappel de focus et les trois états de liste ne
 * s'atteignent QUE par un montage réel.
 *
 * ═══ La distinction que cet écran existe pour montrer ═══
 *
 * L'impact ESTIMÉ est une intuition (encre secondaire), l'impact MESURÉ est une
 * observation (encre pleine). Les confondre serait exactement la faute que ce
 * dépôt traque : `impactMesureBp === null` ne vaut pas « × 1,00 », il vaut
 * « on n'a pas encore mesuré ». Les fixtures ci-dessous portent donc TOUJOURS
 * un événement mesuré ET un événement non mesuré — sans quoi le test ne
 * discriminerait rien.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TIRET_ABSENT, formaterDate, type Evenement } from '@batte/core';

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
const { default: Evenements } = await import('./Evenements');

const appel = vi.mocked(requeteApi);

/** Classe du registre d'alerte MÉTIER, celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function evenement(partiel: Partial<Evenement> = {}): Evenement {
  return {
    id: 'evt-1',
    nom: 'Fêtes de Wallonie',
    type: 'festival',
    dateDebut: '2026-09-19',
    dateFin: '2026-09-21',
    portee: 'liege',
    intensiteEstimee: 4,
    impactEstimeBp: 13000,
    impactMesureBp: 12500,
    source: 'liege.be',
    valideParHumain: true,
    notes: null,
    ...partiel,
  };
}

/**
 * DEUX événements, opposés sur les deux axes que l'écran doit distinguer :
 * mesuré/non mesuré, et validé/proposition IA. Un seul événement ne prouverait
 * ni l'un ni l'autre.
 */
const MESURE_ET_VALIDE = evenement();
const NON_MESURE_ET_PROPOSE = evenement({
  id: 'evt-2',
  nom: 'Braderie de Sainte-Marguerite',
  type: 'autre',
  dateDebut: '2026-01-15',
  dateFin: '2026-01-15',
  portee: 'quartier',
  intensiteEstimee: 2,
  impactEstimeBp: 10800,
  // LE cas qui compte : jamais mesuré.
  impactMesureBp: null,
  source: null,
  valideParHumain: false,
});

function feindreListe(evenements: Evenement[] | Error | undefined): void {
  appel.mockImplementation((_chemin: string, options?: RequestInit) => {
    // Les écritures (POST) restent en attente sauf mise en place explicite.
    if (options?.method !== undefined && options.method !== 'GET') {
      return new Promise<never>(() => {});
    }
    if (evenements === undefined) return new Promise<never>(() => {});
    if (evenements instanceof Error) return Promise.reject(evenements);
    return Promise.resolve({
      data: evenements,
      meta: { total: evenements.length },
    } as never);
  });
}

function monter(): void {
  render(
    <MemoryRouter>
      <Evenements />
    </MemoryRouter>,
  );
}

/**
 * Renseigne les DEUX dates, obligatoires en HTML (`required`).
 *
 * Sans elles, `jsdom` applique la validation native du navigateur et le clic
 * sur « Créer l'événement » n'émet JAMAIS de `submit` : le test « passerait »
 * sur un formulaire que le navigateur a lui-même bloqué, sans qu'aucune ligne
 * de `soumettre()` ne s'exécute. C'est la troisième forme de fixture aveugle —
 * celle qui décrit un cas impossible.
 */
async function saisirLesDates(debut = '2026-09-19', fin = '2026-09-21'): Promise<void> {
  await userEvent.type(screen.getByLabelText('Début'), debut);
  await userEvent.type(screen.getByLabelText('Fin'), fin);
}

beforeEach(() => {
  appel.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Les trois états d'un écran de lecture
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Événements — chargement, erreur, vide', () => {
  it('annonce le chargement plutôt que de laisser un écran muet', () => {
    feindreListe(undefined);
    monter();

    expect(screen.getByText('Chargement des événements…')).toBeInTheDocument();
  });

  it('affiche le message du serveur en cas d’échec, SANS la couleur d’alerte métier', async () => {
    feindreListe(
      new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    );
    monter();

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue du serveur (code HTTP 500).');
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    expect(message.parentElement?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
  });

  it('une erreur non typée reste lisible, et ne prétend pas venir du serveur', async () => {
    feindreListe(new TypeError('Failed to fetch'));
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Erreur inattendue, sans plus de détail.',
    );
  });

  it('liste vide : une phrase qui explique à quoi sert un événement, et une action', async () => {
    feindreListe([]);
    monter();

    expect(await screen.findByText('Aucun événement enregistré')).toBeInTheDocument();
    expect(
      screen.getByText(/modifie la fréquentation attendue : saisissez-le/),
    ).toBeInTheDocument();

    // L'action de l'état vide ouvre le formulaire — sinon le bouton ment.
    expect(screen.queryByLabelText('Nom')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Créer un événement' }));
    expect(screen.getByLabelText('Nom')).toBeInTheDocument();
  });

  it('le titre du panneau compte les événements, au singulier comme au pluriel', async () => {
    feindreListe([MESURE_ET_VALIDE]);
    monter();
    expect(await screen.findByRole('heading', { name: '1 événement' })).toBeInTheDocument();
  });

  it('deux événements se comptent au pluriel', async () => {
    feindreListe([MESURE_ET_VALIDE, NON_MESURE_ET_PROPOSE]);
    monter();
    expect(await screen.findByRole('heading', { name: '2 événements' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Estimé ≠ mesuré, et inconnu ≠ neutre
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Événements — un impact jamais mesuré ne se lit pas comme un impact neutre', () => {
  it('un impact mesuré ABSENT rend le tiret d’absence, jamais « × 1,00 »', async () => {
    feindreListe([MESURE_ET_VALIDE, NON_MESURE_ET_PROPOSE]);
    monter();

    const rangee = (await screen.findByText('Braderie de Sainte-Marguerite')).closest(
      'tr',
    ) as HTMLTableRowElement;
    expect(within(rangee).getByText(TIRET_ABSENT)).toBeInTheDocument();
    // « × 1,00 » serait un facteur NEUTRE mesuré — une affirmation, là où il
    // n'y a qu'une absence de mesure.
    expect(rangee.textContent ?? '').not.toContain('× 1,00');
    // L'estimé, lui, reste affiché : c'est l'intuition, elle existe toujours.
    expect(rangee.textContent ?? '').toContain('× 1,08');
  });

  it('un impact mesuré PRÉSENT s’affiche en encre pleine — la fixture discrimine', async () => {
    feindreListe([MESURE_ET_VALIDE, NON_MESURE_ET_PROPOSE]);
    monter();

    const rangee = (await screen.findByText('Fêtes de Wallonie')).closest(
      'tr',
    ) as HTMLTableRowElement;
    const mesure = within(rangee).getByText('× 1,25');
    // Encre PLEINE (`text-ink`) : c'est une observation.
    expect(mesure.className).toContain('text-ink');
    expect(mesure.className).toContain('font-medium');

    // L'estimé de la même ligne, lui, est en encre SECONDAIRE : c'est une
    // intuition. Sans cette seconde assertion, rien ne prouverait que les deux
    // colonnes se lisent différemment.
    expect(within(rangee).getByText('× 1,30').className).toContain('text-ink-3');
  });

  it('une proposition IA non validée est signalée en alerte, un événement validé en conforme', async () => {
    feindreListe([MESURE_ET_VALIDE, NON_MESURE_ET_PROPOSE]);
    monter();

    const propose = (await screen.findByText('Braderie de Sainte-Marguerite')).closest(
      'tr',
    ) as HTMLTableRowElement;
    const badgePropose = within(propose).getByText(/Proposition IA/);
    expect(badgePropose.className).toContain('text-alerte');
    // Le rappel d'action « — à valider » ne doit pas se perdre à la troncature.
    expect(badgePropose.textContent ?? '').toContain('à valider');

    const valide = screen.getByText('Fêtes de Wallonie').closest('tr') as HTMLTableRowElement;
    expect(within(valide).getByText('Validé').className).toContain('text-conforme');
  });

  it('une période d’un seul jour n’affiche qu’une date, sur le bon jour civil', async () => {
    feindreListe([NON_MESURE_ET_PROPOSE]);
    monter();

    const rangee = (await screen.findByText('Braderie de Sainte-Marguerite')).closest(
      'tr',
    ) as HTMLTableRowElement;
    // Comparé au FORMATEUR (`Europe/Brussels`), jamais à « 15/01/2026 » tapé à
    // la main : c'est précisément une date civile relue comme minuit UTC qui a
    // déjà fabriqué une heure fantôme dans un document de ce dépôt.
    const attendue = formaterDate('2026-01-15');
    expect(within(rangee).getByText(attendue)).toBeInTheDocument();
    expect(rangee.textContent ?? '').not.toContain(`${attendue} – ${attendue}`);
  });

  it('une période sur plusieurs jours affiche les deux bornes', async () => {
    feindreListe([MESURE_ET_VALIDE]);
    monter();

    const rangee = (await screen.findByText('Fêtes de Wallonie')).closest(
      'tr',
    ) as HTMLTableRowElement;
    expect(
      within(rangee).getByText(`${formaterDate('2026-09-19')} – ${formaterDate('2026-09-21')}`),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Le formulaire escamotable — clavier, focus, Échap
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Événements — le formulaire est escamotable, et rendu au clavier', () => {
  it('il est FERMÉ par défaut : consulter est le geste fréquent, saisir le geste rare', async () => {
    feindreListe([MESURE_ET_VALIDE]);
    monter();

    await screen.findByText('Fêtes de Wallonie');
    const bascule = screen.getByRole('button', { name: 'Nouvel événement' });
    expect(bascule).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Nom')).toBeNull();
  });

  it('l’ouvrir porte le focus au premier champ, sans traverser toute la liste', async () => {
    feindreListe([MESURE_ET_VALIDE]);
    monter();

    await screen.findByText('Fêtes de Wallonie');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel événement' }));

    // Le formulaire est rendu APRÈS le tableau dans le DOM : sans ce rappel,
    // l'atteindre coûterait une tabulation par événement de la liste.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Nom')));
    expect(screen.getByRole('button', { name: 'Fermer le formulaire' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('Échap referme le formulaire ET rend le focus au bouton qui l’avait ouvert', async () => {
    feindreListe([MESURE_ET_VALIDE]);
    monter();

    await screen.findByText('Fêtes de Wallonie');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel événement' }));
    await screen.findByLabelText('Nom');

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByLabelText('Nom')).toBeNull();
    // Le focus ne tombe pas sur `<body>` : il revient là où l'œil se trouvait.
    const bascule = screen.getByRole('button', { name: 'Nouvel événement' });
    expect(document.activeElement).toBe(bascule);
  });

  it('une fois refermé, Échap ne fait plus rien — l’écouteur est bien retiré', async () => {
    feindreListe([MESURE_ET_VALIDE]);
    monter();

    await screen.findByText('Fêtes de Wallonie');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel événement' }));
    await screen.findByLabelText('Nom');
    await userEvent.keyboard('{Escape}');

    const bascule = screen.getByRole('button', { name: 'Nouvel événement' });
    bascule.blur();
    await userEvent.keyboard('{Escape}');
    // Si l'écouteur survivait à la fermeture, il replacerait le focus ici.
    expect(document.activeElement).not.toBe(bascule);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. La conversion saisie ↔ points de base — une unité d'AFFICHAGE
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Événements — l’ampleur de l’effet se saisit en % ou en multiplicateur', () => {
  async function ouvrirFormulaire(): Promise<void> {
    feindreListe([]);
    monter();
    await screen.findByText('Aucun événement enregistré');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel événement' }));
    await screen.findByLabelText('Nom');
  }

  it('« 30 » en mode écart se relit « × 1,30 » sous le champ', async () => {
    await ouvrirFormulaire();
    await userEvent.type(screen.getByLabelText('Écart attendu (%)'), '30');
    expect(screen.getByText('= × 1,30')).toBeInTheDocument();
  });

  it('« 1,30 » en mode multiplicateur donne le MÊME facteur — les deux modes concordent', async () => {
    await ouvrirFormulaire();
    await userEvent.click(screen.getByRole('radio', { name: 'Multiplicateur' }));
    await userEvent.type(screen.getByLabelText('Multiplicateur attendu'), '1,30');
    expect(screen.getByText('= × 1,30')).toBeInTheDocument();
  });

  it('champ vide : une phrase d’explication, jamais un facteur inventé', async () => {
    await ouvrirFormulaire();
    expect(
      screen.getByText('La prévision multipliera sa base par ce facteur.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^= ×/)).toBeNull();
  });

  it('une saisie illisible est REFUSÉE avant tout aller-retour, et le focus y va', async () => {
    await ouvrirFormulaire();
    await userEvent.type(screen.getByLabelText('Nom'), 'Braderie');
    await saisirLesDates();
    await userEvent.type(screen.getByLabelText('Écart attendu (%)'), 'beaucoup');

    const appelsAvant = appel.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Créer l’événement' }));

    expect(screen.getByText('Indiquez un nombre.')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText('Écart attendu (%)'));
    expect(appel.mock.calls.length).toBe(appelsAvant);
  });

  it('un écart de −100 % ou moins est refusé : un effet ne descend pas à zéro', async () => {
    await ouvrirFormulaire();
    await userEvent.type(screen.getByLabelText('Nom'), 'Grève générale');
    await saisirLesDates();
    await userEvent.type(screen.getByLabelText('Écart attendu (%)'), '-100');

    const appelsAvant = appel.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Créer l’événement' }));

    expect(screen.getByText(/L’effet doit rester positif/)).toBeInTheDocument();
    expect(appel.mock.calls.length).toBe(appelsAvant);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Création — ce qui part au serveur, et ce qui revient
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Événements — la création convertit en points de base et rend le focus', () => {
  it('envoie l’impact en POINTS DE BASE, pas la saisie brute', async () => {
    let corpsEnvoye: unknown = null;
    appel.mockImplementation((_chemin: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        corpsEnvoye = JSON.parse(String(options.body));
        return Promise.resolve({} as never);
      }
      return Promise.resolve({ data: [], meta: { total: 0 } } as never);
    });

    monter();
    await screen.findByText('Aucun événement enregistré');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel événement' }));
    await screen.findByLabelText('Nom');

    await userEvent.type(screen.getByLabelText('Nom'), 'Braderie de Noël');
    await saisirLesDates('2026-12-05', '2026-12-06');
    await userEvent.type(screen.getByLabelText('Écart attendu (%)'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Créer l’événement' }));

    await waitFor(() => expect(corpsEnvoye).not.toBeNull());
    // 10 000 = 100 % : « +30 % » vaut 13 000 points de base (CLAUDE.md §3).
    expect(corpsEnvoye).toMatchObject({
      nom: 'Braderie de Noël',
      impactEstimeBp: 13000,
      // Valeur par défaut du brouillon, pas une valeur inventée par le test.
      intensiteEstimee: 3,
      // Champs facultatifs vides : `null`, jamais la chaîne vide.
      source: null,
      notes: null,
    });
  });

  it('après création : message de succès, formulaire vidé, focus rendu au premier champ', async () => {
    appel.mockImplementation((_chemin: string, options?: RequestInit) =>
      options?.method === 'POST'
        ? Promise.resolve({} as never)
        : Promise.resolve({ data: [], meta: { total: 0 } } as never),
    );

    monter();
    await screen.findByText('Aucun événement enregistré');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel événement' }));
    await screen.findByLabelText('Nom');

    const nom = screen.getByLabelText('Nom');
    await userEvent.type(nom, 'Braderie de Noël');
    await saisirLesDates('2026-12-05', '2026-12-06');
    await userEvent.type(screen.getByLabelText('Écart attendu (%)'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Créer l’événement' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Événement créé et validé.');
    // Le brouillon est remis à zéro : saisir le suivant ne demande pas d'effacer.
    expect((nom as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(nom);
    // Et le formulaire NE se referme PAS : le masquer rendrait le succès invisible.
    expect(screen.getByLabelText('Nom')).toBeInTheDocument();
  });

  it('un refus du serveur pose l’erreur sous le champ nommé et y porte le focus', async () => {
    appel.mockImplementation((_chemin: string, options?: RequestInit) =>
      options?.method === 'POST'
        ? Promise.reject(
            new ErreurApi('Saisie refusée.', {
              code: 'validation',
              statut: 422,
              champs: { dateFin: 'La date de fin ne peut pas précéder la date de début.' },
            }),
          )
        : Promise.resolve({ data: [], meta: { total: 0 } } as never),
    );

    monter();
    await screen.findByText('Aucun événement enregistré');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel événement' }));
    await screen.findByLabelText('Nom');

    await userEvent.type(screen.getByLabelText('Nom'), 'Braderie');
    await saisirLesDates('2026-12-06', '2026-12-05');
    await userEvent.type(screen.getByLabelText('Écart attendu (%)'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Créer l’événement' }));

    expect(
      await screen.findByText('La date de fin ne peut pas précéder la date de début.'),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText('Fin'));
  });

  it('la liste est rechargée après création — sans quoi l’événement neuf resterait invisible', async () => {
    const chemins: string[] = [];
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      chemins.push(`${options?.method ?? 'GET'} ${chemin}`);
      return options?.method === 'POST'
        ? Promise.resolve({} as never)
        : Promise.resolve({ data: [], meta: { total: 0 } } as never);
    });

    monter();
    await screen.findByText('Aucun événement enregistré');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel événement' }));
    await screen.findByLabelText('Nom');
    await userEvent.type(screen.getByLabelText('Nom'), 'Braderie');
    await saisirLesDates();
    await userEvent.type(screen.getByLabelText('Écart attendu (%)'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Créer l’événement' }));

    await screen.findByRole('status');
    const indexPost = chemins.indexOf('POST /evenements');
    expect(indexPost).toBeGreaterThanOrEqual(0);
    expect(chemins.slice(indexPost + 1)).toContain('GET /evenements');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. Attente d'écriture — promesse CONTRÔLÉE (docs/39 §3, cinquième forme)

   Tous les tests de création ci-dessus résolvent (ou rejettent) leur promesse
   IMMÉDIATEMENT : l'état `envoi` retombe dans le même écoulement de
   micro-tâches que sa pose et n'atteint jamais le DOM. Mesuré le 02/08/2026 :
   c'est exactement le trou qui a laissé cet écran entièrement VERT après
   neutralisation de la pose de l'état en vol dans le code de production.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Événements — l’attente du POST est ANNONCÉE, pas seulement invisible', () => {
  it('pendant l’aller-retour, le bouton devient `disabled` et dit « Création… », puis redevient actionnable', async () => {
    let repondre: ((valeur: unknown) => void) | undefined;
    appel.mockImplementation((_chemin: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return Promise.resolve({ data: [], meta: { total: 0 } } as never);
    });

    monter();
    await screen.findByText('Aucun événement enregistré');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel événement' }));
    await screen.findByLabelText('Nom');

    await userEvent.type(screen.getByLabelText('Nom'), 'Braderie de Noël');
    await saisirLesDates('2026-12-05', '2026-12-06');
    await userEvent.type(screen.getByLabelText('Écart attendu (%)'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Créer l’événement' }));

    // 1. L'attente est ANNONCÉE : le libellé change ET le bouton s'inertise —
    // c'est le SEUL des six écrans de cette mission où le libellé du bouton
    // lui-même change (les autres portent un indicateur SÉPARÉ).
    const enCours = await screen.findByRole('button', { name: 'Création…' });
    expect(enCours).toBeDisabled();
    /*
      2. Un second clic ou une Entrée sur CE bouton ne prouveraient rien :
      `disabled` natif, bloqué par le navigateur lui-même (même mise en garde
      que `SaisieSortie.montage.test.tsx`). Aucun raccourci clavier de cet
      écran (pas de Ctrl+S ici) ne contourne ce bouton : contrairement à
      `Ingredients.tsx`/`Concurrents.tsx`, la garantie observée ici repose
      ENTIÈREMENT sur l'attribut `disabled`.
    */

    repondre?.({});

    // 3. Après la réponse, le libellé ET l'état redeviennent ceux du repos.
    expect(await screen.findByRole('button', { name: 'Créer l’événement' })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Événement créé et validé.');
  });

  it('un refus PENDANT l’aller-retour laisse d’abord voir l’attente, puis rend le bouton actionnable avec l’erreur affichée', async () => {
    let rejeter: ((raison: unknown) => void) | undefined;
    appel.mockImplementation((_chemin: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return new Promise((_resoudre, refuser) => {
          rejeter = refuser;
        });
      }
      return Promise.resolve({ data: [], meta: { total: 0 } } as never);
    });

    monter();
    await screen.findByText('Aucun événement enregistré');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel événement' }));
    await screen.findByLabelText('Nom');

    await userEvent.type(screen.getByLabelText('Nom'), 'Braderie');
    await saisirLesDates('2026-12-06', '2026-12-05');
    await userEvent.type(screen.getByLabelText('Écart attendu (%)'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Créer l’événement' }));

    // L'attente est visible AVANT le refus, pas seulement l'erreur après coup.
    expect(await screen.findByRole('button', { name: 'Création…' })).toBeDisabled();

    rejeter?.(
      new ErreurApi('Saisie refusée.', {
        code: 'validation',
        statut: 422,
        champs: { dateFin: 'La date de fin ne peut pas précéder la date de début.' },
      }),
    );

    expect(
      await screen.findByText('La date de fin ne peut pas précéder la date de début.'),
    ).toBeInTheDocument();
    // Le refus rend le bouton actionnable — le message d'erreur seul ne le
    // prouverait pas si `disabled` restait posé à tort après un `catch`.
    expect(screen.getByRole('button', { name: 'Créer l’événement' })).not.toBeDisabled();
  });
});
