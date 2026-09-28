/**
 * Registre AFSCA — test MONTÉ, en complément de `RegistreAfsca.test.tsx`.
 *
 * ═══ Ce que ce fichier ajoute ═══
 *
 * `RegistreAfsca.test.tsx`, à côté, rend deux badges purs via
 * `renderToStaticMarkup`. Il reste valable et n'est pas touché. L'écran
 * lui-même, lui, était à **0 % de lignes couvertes** : les cinq onglets, leurs
 * chargements, et la navigation ARIA au clavier ne s'atteignent que par un
 * montage réel.
 *
 * ═══ Pourquoi cet écran mérite plus d'attention que les autres ═══
 *
 * C'est un registre RÉGLEMENTAIRE. Une date fausse ou une ligne manquante y
 * coûte plus qu'ailleurs :
 *
 * 1. **Les dates.** Le fuseau est `Europe/Brussels`, le stockage en ISO 8601
 *    UTC — et une date civile relue comme minuit UTC a déjà fabriqué une heure
 *    fantôme dans un document de ce dépôt. Les tests ci-dessous comparent donc
 *    TOUJOURS au formateur (`formaterDate`), jamais à une date tapée à la main.
 * 2. **Rien ne s'efface** (CLAUDE.md §3 règle 7). Un relevé annulé RESTE dans
 *    le tableau, barré et badgé : le masquer réécrirait le passé. C'est une
 *    règle que seul un montage peut vérifier — le badge seul ne dit pas si la
 *    ligne survit.
 * 3. **Un champ de température ne se pré-remplit JAMAIS** : un champ
 *    pré-rempli à 4 °C se valide sans être lu, ce qui est un faux en écriture.
 * 4. **Une liste vide n'y a pas toujours le même sens.** « Aucune session sans
 *    relevé » est une BONNE nouvelle (conformité complète), « aucun relevé »
 *    est un premier lancement. Deux vides, deux phrases.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TIRET_ABSENT,
  formaterDate,
  type NonConformiteContrat,
  type ReleveTemperatureContrat,
  type SessionSansReleveTemperatureContrat,
  type TacheNettoyageContrat,
  type TracabiliteAmontSessionContrat,
  type TracabiliteAvalLotContrat,
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
// `formaterEntier` est importé DE L'ÉCRAN, jamais réécrit ici : `Intl` insère
// une espace insécable dans « 1 251 », et deux chaînes visuellement identiques
// ne sont alors jamais égales. Comparer via le formateur du projet est la
// seule façon de ne pas fabriquer un test vert pour la mauvaise raison.
const { default: RegistreAfsca, formaterEntier } = await import('./RegistreAfsca');

const appel = vi.mocked(requeteApi);

/** Classe du registre d'alerte MÉTIER, celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function releve(partiel: Partial<ReleveTemperatureContrat> = {}): ReleveTemperatureContrat {
  return {
    id: 'rel-1',
    sessionId: 'sess-1',
    productionId: null,
    equipement: 'Glacière rigide 60 L',
    temperatureC: 3.5,
    dateReleve: '2026-01-15',
    moment: 'depart',
    conforme: true,
    actionCorrective: null,
    relevePar: 'Jean-Baptiste',
    creeLe: '2026-01-15T07:12:00.000Z',
    statut: 'active',
    motifAnnulation: null,
    dateAnnulation: null,
    ...partiel,
  };
}

/**
 * TROIS relevés, un par situation que le registre doit distinguer :
 * conforme, non conforme (avec son action corrective), et annulé. Une fixture
 * qui n'en porterait qu'un ne montrerait rien de la distinction.
 */
const CONFORME = releve();
const NON_CONFORME = releve({
  id: 'rel-2',
  equipement: 'Glacière souple',
  temperatureC: 9.2,
  dateReleve: '2026-07-26',
  moment: 'mi_session',
  conforme: false,
  actionCorrective: 'Blocs eutectiques remplacés, produits écartés.',
  // Signature absente : elle doit se lire « — », jamais une chaîne vide muette.
  relevePar: null,
});
const ANNULE = releve({
  id: 'rel-3',
  equipement: 'Sonde de four',
  temperatureC: 62,
  dateReleve: '2026-07-26',
  moment: 'retour',
  conforme: true,
  statut: 'annulee',
  motifAnnulation: 'Thermomètre mal calibré.',
  dateAnnulation: '2026-07-27T09:00:00.000Z',
});

const SESSIONS_SANS_RELEVE: SessionSansReleveTemperatureContrat[] = [
  {
    sessionId: 'sess-9',
    numero: 'S-2026-014',
    dateSession: '2026-04-05',
    lieuNom: 'La Batte',
  },
];

type ReponsesFeintes = {
  releves?: unknown;
  sansReleve?: unknown;
  amont?: unknown;
  aval?: unknown;
};

function feindre(reponses: ReponsesFeintes): void {
  appel.mockImplementation((chemin: string, options?: RequestInit) => {
    if (options?.method !== undefined && options.method !== 'GET') {
      return new Promise<never>(() => {});
    }
    if (chemin === '/afsca/temperatures') {
      const choisie = reponses.releves;
      if (choisie === undefined) return new Promise<never>(() => {});
      if (choisie instanceof Error) return Promise.reject(choisie);
      return Promise.resolve(choisie as never);
    }
    if (chemin.startsWith('/afsca/temperatures/sessions-sans-releve')) {
      const choisie = reponses.sansReleve;
      if (choisie === undefined) return new Promise<never>(() => {});
      if (choisie instanceof Error) return Promise.reject(choisie);
      return Promise.resolve(choisie as never);
    }
    if (chemin.startsWith('/afsca/tracabilite/sessions/')) {
      const choisie = reponses.amont;
      if (choisie === undefined) return new Promise<never>(() => {});
      if (choisie instanceof Error) return Promise.reject(choisie);
      return Promise.resolve(choisie as never);
    }
    if (chemin.startsWith('/afsca/tracabilite/lots/')) {
      const choisie = reponses.aval;
      if (choisie === undefined) return new Promise<never>(() => {});
      if (choisie instanceof Error) return Promise.reject(choisie);
      return Promise.resolve(choisie as never);
    }
    // Les autres onglets ne sont pas montés par défaut ; s'ils le sont, on les
    // laisse en chargement plutôt que d'inventer une réponse.
    return new Promise<never>(() => {});
  });
}

function listeReleves(releves: ReleveTemperatureContrat[]): unknown {
  return { data: releves, meta: { total: releves.length } };
}

function listeSansReleve(sessions: SessionSansReleveTemperatureContrat[]): unknown {
  return { data: sessions, meta: { total: sessions.length } };
}

beforeEach(() => {
  appel.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. La barre d'onglets — une promesse ARIA, tenue au clavier
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Registre AFSCA — cinq registres juxtaposés, une seule tabulation', () => {
  function monter(): void {
    feindre({ releves: listeReleves([CONFORME]), sansReleve: listeSansReleve([]) });
    render(<RegistreAfsca />);
  }

  it('les cinq onglets existent, un seul est sélectionné', () => {
    monter();

    const onglets = screen.getAllByRole('tab');
    expect(onglets.map((o) => o.textContent)).toEqual([
      'Températures',
      'Nettoyage',
      'Non-conformités',
      'Traçabilité',
      'Exercice de traçabilité',
    ]);
    expect(onglets.filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('le groupe entier ne coûte qu’UNE tabulation — « tabindex glissant »', () => {
    monter();

    const onglets = screen.getAllByRole('tab');
    // Sans cela, il fallait cinq tabulations pour atteindre le premier champ
    // du formulaire, à chaque écran et à chaque saisie.
    expect(onglets.filter((o) => o.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(onglets.filter((o) => o.getAttribute('tabindex') === '-1')).toHaveLength(4);
  });

  it('chaque onglet DÉSIGNE son panneau, et le panneau renvoie vers son onglet', () => {
    monter();

    const actif = screen
      .getAllByRole('tab')
      .find((o) => o.getAttribute('aria-selected') === 'true');
    const panneau = screen.getByRole('tabpanel');
    expect(actif?.getAttribute('aria-controls')).toBe(panneau.id);
    expect(panneau.getAttribute('aria-labelledby')).toBe(actif?.id);
  });

  it('Flèche Droite change d’onglet ET y porte le focus', async () => {
    monter();

    const onglets = screen.getAllByRole('tab');
    (onglets[0] as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(onglets[1]).toHaveAttribute('aria-selected', 'true');
    // Le motif APG veut que la flèche DÉPLACE le focus : sans ça, la sélection
    // avance mais le clavier reste sur l'onglet précédent.
    expect(document.activeElement).toBe(onglets[1]);
    expect(onglets[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('Flèche Gauche depuis le premier boucle jusqu’au dernier', async () => {
    monter();

    const onglets = screen.getAllByRole('tab');
    (onglets[0] as HTMLElement).focus();
    await userEvent.keyboard('{ArrowLeft}');

    expect(onglets[4]).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(onglets[4]);
  });

  it('Fin va au dernier onglet, Début revient au premier', async () => {
    monter();

    const onglets = screen.getAllByRole('tab');
    (onglets[0] as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    expect(onglets[4]).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Home}');
    expect(onglets[0]).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(onglets[0]);
  });

  it('changer d’onglet change le contenu — pas seulement le soulignement', async () => {
    monter();

    expect(await screen.findByText('Glacière rigide 60 L')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Nettoyage' }));
    expect(screen.queryByText('Glacière rigide 60 L')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Nettoyage' })).toHaveAttribute('aria-selected', 'true');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Relevés de température — chargement, erreur, vide
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Registre AFSCA — relevés : les trois états', () => {
  it('annonce les deux chargements plutôt que de laisser l’onglet muet', () => {
    feindre({});
    render(<RegistreAfsca />);

    expect(screen.getByText('Chargement des relevés…')).toBeInTheDocument();
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
  });

  it('un échec de chargement reste NEUTRE : une panne réseau n’est pas une non-conformité', async () => {
    feindre({
      releves: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
      sansReleve: listeSansReleve([]),
    });
    render(<RegistreAfsca />);

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue du serveur (code HTTP 500).');
    // Sur un registre AFSCA, mélanger les deux registres de couleur est
    // particulièrement coûteux : le rouge doit rester réservé au dépassement
    // de température, seul signal qui demande un geste.
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    expect(message.parentElement?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
  });

  it('aucun relevé : un premier lancement, avec la marche à suivre', async () => {
    feindre({ releves: listeReleves([]), sansReleve: listeSansReleve([]) });
    render(<RegistreAfsca />);

    expect(await screen.findByText('Aucun relevé enregistré')).toBeInTheDocument();
    expect(
      screen.getByText('Saisissez le premier relevé de température avec le formulaire ci-dessus.'),
    ).toBeInTheDocument();
  });

  it('aucune session sans relevé : une BONNE nouvelle, dite autrement qu’un premier lancement', async () => {
    feindre({ releves: listeReleves([CONFORME]), sansReleve: listeSansReleve([]) });
    render(<RegistreAfsca />);

    // `variante: 'normal'` — une ligne discrète, pas une carte avec titre et
    // bouton : ici, le vide veut dire « conformité complète sur la période ».
    expect(
      await screen.findByText('Aucune session clôturée sans relevé sur la période choisie.'),
    ).toBeInTheDocument();
    // Et surtout : PAS le texte du premier lancement, qui enverrait saisir.
    expect(screen.queryByText('Aucun relevé enregistré')).toBeNull();
  });

  it('une session sans relevé est LISTÉE : c’est la question qu’un contrôleur pose', async () => {
    feindre({
      releves: listeReleves([CONFORME]),
      sansReleve: listeSansReleve(SESSIONS_SANS_RELEVE),
    });
    render(<RegistreAfsca />);

    expect(await screen.findByText('S-2026-014')).toBeInTheDocument();
    const rangee = screen.getByText('S-2026-014').closest('tr') as HTMLTableRowElement;
    // Date comparée au FORMATEUR : `Europe/Brussels`, jamais une date tapée.
    expect(within(rangee).getByText(formaterDate('2026-04-05'))).toBeInTheDocument();
    expect(within(rangee).getByText('La Batte')).toBeInTheDocument();
  });

  it('le compte de relevés s’accorde en nombre', async () => {
    feindre({ releves: listeReleves([CONFORME]), sansReleve: listeSansReleve([]) });
    render(<RegistreAfsca />);
    expect(await screen.findByRole('heading', { name: '1 relevé' })).toBeInTheDocument();
  });

  it('deux relevés se comptent au pluriel', async () => {
    feindre({
      releves: listeReleves([CONFORME, NON_CONFORME]),
      sansReleve: listeSansReleve([]),
    });
    render(<RegistreAfsca />);
    expect(await screen.findByRole('heading', { name: '2 relevés' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Ce que le registre doit dire exactement — dates, absences, annulations
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Registre AFSCA — une ligne de registre ne ment pas', () => {
  function monterLesTrois(): void {
    feindre({
      releves: listeReleves([CONFORME, NON_CONFORME, ANNULE]),
      sansReleve: listeSansReleve([]),
    });
    render(<RegistreAfsca />);
  }

  it('la date affichée est le JOUR CIVIL belge, pas une date décalée d’un fuseau', async () => {
    monterLesTrois();

    const rangee = (await screen.findByText('Glacière rigide 60 L')).closest(
      'tr',
    ) as HTMLTableRowElement;
    // `2026-01-15` en plein hiver : c'est exactement le cas où lire une date
    // civile comme minuit UTC produit une heure fantôme. On compare au
    // formateur du dépôt, qui applique `Europe/Brussels`.
    expect(within(rangee).getByText(formaterDate('2026-01-15'))).toBeInTheDocument();
  });

  it('une action corrective absente rend le tiret, jamais une cellule muette', async () => {
    monterLesTrois();

    const conforme = (await screen.findByText('Glacière rigide 60 L')).closest(
      'tr',
    ) as HTMLTableRowElement;
    // Relevé conforme : aucune action corrective à mener, donc « — ».
    expect(within(conforme).getAllByText(TIRET_ABSENT).length).toBeGreaterThanOrEqual(1);

    // Le relevé NON conforme, lui, la porte — sans quoi ce test ne
    // discriminerait rien : c'est LE champ que l'AFSCA lit en premier.
    const nonConforme = screen.getByText('Glacière souple').closest('tr') as HTMLTableRowElement;
    expect(
      within(nonConforme).getByText('Blocs eutectiques remplacés, produits écartés.'),
    ).toBeInTheDocument();
  });

  it('une signature absente rend le tiret — sur un autocontrôle, c’est la signature de la mesure', async () => {
    monterLesTrois();

    const nonConforme = (await screen.findByText('Glacière souple')).closest(
      'tr',
    ) as HTMLTableRowElement;
    expect(within(nonConforme).getAllByText(TIRET_ABSENT).length).toBeGreaterThanOrEqual(1);

    const conforme = screen.getByText('Glacière rigide 60 L').closest('tr') as HTMLTableRowElement;
    expect(within(conforme).getByText('Jean-Baptiste')).toBeInTheDocument();
  });

  it('conforme et non conforme se distinguent par un glyphe ET par la couleur', async () => {
    monterLesTrois();

    const conforme = (await screen.findByText('Glacière rigide 60 L')).closest(
      'tr',
    ) as HTMLTableRowElement;
    const pastilleConforme = within(conforme).getByText('Conforme');
    expect(pastilleConforme.className).toContain('text-conforme');
    // Le glyphe est le canal REDONDANT : ces tableaux partent en PDF chez le
    // comptable et à l'AFSCA, parfois en noir et blanc.
    expect(pastilleConforme.querySelector('[aria-hidden="true"]')).not.toBeNull();

    const nonConforme = screen.getByText('Glacière souple').closest('tr') as HTMLTableRowElement;
    const pastilleNon = within(nonConforme).getByText('Non conforme');
    expect(pastilleNon.className).toContain('text-depassement');
    expect(pastilleNon.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('un relevé ANNULÉ reste dans le tableau — rien ne s’efface (CLAUDE.md §3 règle 7)', async () => {
    monterLesTrois();

    // La ligne SURVIT : la masquer réécrirait le passé, ce qui se voit sur un
    // contrôle. C'est précisément ce que le test du badge seul ne pouvait pas
    // vérifier.
    const annule = (await screen.findByText('Sonde de four')).closest('tr') as HTMLTableRowElement;
    expect(annule).toBeInTheDocument();
    expect(within(annule).getByText('— relevé annulé')).toBeInTheDocument();
  });

  it('la valeur d’un relevé annulé est BARRÉE : elle ne fait plus foi', async () => {
    monterLesTrois();

    const annule = (await screen.findByText('Sonde de four')).closest('tr') as HTMLTableRowElement;
    const valeur = within(annule).getByText(/62/);
    expect(valeur.className).toContain('line-through');

    // Un relevé ACTIF, lui, n'est jamais barré — la fixture discrimine.
    const actif = screen.getByText('Glacière rigide 60 L').closest('tr') as HTMLTableRowElement;
    expect((within(actif).getByText(/3,5|3\.5/) as HTMLElement).className ?? '').not.toContain(
      'line-through',
    );
  });

  it('un relevé actif propose « Annuler », un relevé annulé ne le propose plus', async () => {
    monterLesTrois();

    const actif = (await screen.findByText('Glacière rigide 60 L')).closest(
      'tr',
    ) as HTMLTableRowElement;
    expect(within(actif).getByRole('button', { name: /Annuler/ })).toBeInTheDocument();

    const annule = screen.getByText('Sonde de four').closest('tr') as HTMLTableRowElement;
    expect(within(annule).queryByRole('button', { name: /Annuler/ })).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. La saisie — un champ de température ne se pré-remplit jamais
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Registre AFSCA — saisir un relevé sans jamais fabriquer une valeur', () => {
  async function monterPret(): Promise<void> {
    feindre({ releves: listeReleves([CONFORME]), sansReleve: listeSansReleve([]) });
    render(<RegistreAfsca />);
    await screen.findByText('Glacière rigide 60 L');
  }

  it('le champ de température est VIDE au montage — un champ pré-rempli se valide sans être lu', async () => {
    await monterPret();

    const champ = screen.getByLabelText('Température (°C)') as HTMLInputElement;
    expect(champ.value).toBe('');
    // Et l'équipement non plus n'est pas deviné.
    expect((screen.getByLabelText('Équipement') as HTMLInputElement).value).toBe('');
  });

  it('la date du relevé est proposée à AUJOURD’HUI, jamais à une date qui traîne', async () => {
    await monterPret();

    const date = screen.getByLabelText('Date du relevé') as HTMLInputElement;
    // Une date par défaut figée à l'import serait un antidatage invisible
    // (CLAUDE.md §7). On la recalcule ici sur le même fuseau que `lib/dates`.
    const attendue = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Brussels',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    expect(date.value).toBe(attendue);
  });

  it('l’enregistrement est REFUSÉ tant que l’équipement ou la température manquent', async () => {
    await monterPret();

    const bouton = screen.getByRole('button', { name: /Enregistrer/ });
    expect(bouton).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Équipement'), 'Glacière rigide 60 L');
    // Toujours refusé : la température manque encore.
    expect(bouton).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Température (°C)'), '3,5');
    expect(bouton).toBeEnabled();
  });

  it('une température illisible ne rend pas le bouton actif', async () => {
    await monterPret();

    await userEvent.type(screen.getByLabelText('Équipement'), 'Glacière');
    await userEvent.type(screen.getByLabelText('Température (°C)'), 'froid');
    expect(screen.getByRole('button', { name: /Enregistrer/ })).toBeDisabled();
  });

  it('un refus « action corrective obligatoire » porte le focus SUR ce champ', async () => {
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return Promise.reject(
          new ErreurApi('Saisie refusée.', {
            code: 'validation',
            statut: 422,
            champs: {
              actionCorrective:
                'Un relevé hors seuil exige une action corrective : décrivez ce qui a été fait.',
            },
          }),
        );
      }
      if (chemin === '/afsca/temperatures') {
        return Promise.resolve(listeReleves([CONFORME]) as never);
      }
      return Promise.resolve(listeSansReleve([]) as never);
    });
    render(<RegistreAfsca />);
    await screen.findByText('Glacière rigide 60 L');

    await userEvent.type(screen.getByLabelText('Équipement'), 'Glacière souple');
    await userEvent.type(screen.getByLabelText('Température (°C)'), '9,2');
    await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        'Un relevé hors seuil exige une action corrective : décrivez ce qui a été fait.',
      ),
    ).toBeInTheDocument();
    // docs/07 §4.7 : le focus va au champ fautif, et la saisie n'est pas vidée.
    expect(document.activeElement).toHaveAttribute('id', 'temp-action');
    expect((screen.getByLabelText('Température (°C)') as HTMLInputElement).value).toBe('9,2');
  });

  it('un relevé NON CONFORME enregistré annonce la non-conformité ouverte automatiquement', async () => {
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return Promise.resolve(
          releve({ id: 'rel-4', conforme: false, temperatureC: 9.2 }) as never,
        );
      }
      if (chemin === '/afsca/temperatures') {
        return Promise.resolve(listeReleves([CONFORME]) as never);
      }
      return Promise.resolve(listeSansReleve([]) as never);
    });
    render(<RegistreAfsca />);
    await screen.findByText('Glacière rigide 60 L');

    await userEvent.type(screen.getByLabelText('Équipement'), 'Glacière souple');
    await userEvent.type(screen.getByLabelText('Température (°C)'), '9,2');
    await userEvent.type(screen.getByLabelText(/Action corrective/), 'Blocs remplacés.');
    await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

    // Sans cette phrase, rien à l'écran ne dirait qu'un SECOND registre vient
    // d'être écrit (docs/17 fiche 15).
    const confirmation = await screen.findByText(/NON CONFORME/);
    expect(confirmation).toHaveTextContent('Une non-conformité a été ouverte');

    // Le focus repart sur la température : c'est le seul champ revidé, pour
    // enchaîner le relevé suivant du même équipement sans tabuler à l'envers.
    expect(document.activeElement).toBe(screen.getByLabelText('Température (°C)'));
    expect((screen.getByLabelText('Température (°C)') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Équipement') as HTMLInputElement).value).toBe('Glacière souple');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Traçabilité — le geste du rappel sanitaire
   ═══════════════════════════════════════════════════════════════════════════

   LE GESTE RÉEL : le meunier rappelle un lot de farine. Le porteur ouvre cet
   onglet et demande « quelles pâtes, quelles sessions, quels clients ». La
   réponse doit être COMPLÈTE — obligation réglementaire (CLAUDE.md §3
   règle 6), pas un confort.

   CE QUI A CHANGÉ LE 01/08/2026, ET QUE CES TESTS GARDENT. Les deux sens de la
   traçabilité partent désormais du GRAND LIVRE et non de la table écrite au
   lancement. Un lot venu combler une sur-consommation — pris en FEFO sur le
   stock du jour, donc possiblement absent de la fournée d'origine — entre
   maintenant dans le registre, avec un champ neuf : `quantiteMouvementee`.

   TROIS QUANTITÉS COEXISTENT, ET ELLES NE DISENT PAS LA MÊME CHOSE :
     - `quantiteTheorique`   ce que la recette prévoyait DE CE LOT ;
     - `quantiteReelle`      ce que le porteur a DÉCLARÉ pour l'INGRÉDIENT
                             entier — `null` dès que plusieurs lots ont servi ;
     - `quantiteMouvementee` ce que le STOCK a enregistré, LOT PAR LOT.

   L'écran affiche désormais la PREMIÈRE et la TROISIÈME. La deuxième a cédé sa
   colonne : voir le bloc « TROIS QUANTITÉS, ET DEUX COLONNES »
   (`RegistreAfsca.tsx`) pour la décision et pour ce qu'elle coûte.

   POURQUOI LA FIXTURE CI-DESSOUS PORTE QUATRE LOTS DIFFÉRENTS. Une fixture où
   tous les lots se ressemblent ne prouve rien (docs/39 §3, six instances
   payées) :
     1. un lot PRÉVU ET SERVI, dont la quantité déclarée DIFFÈRE de la
        quantité mouvementée — sans cet écart, afficher l'un ou l'autre champ
        donnerait le même texte et le test serait vert par chance ;
     2. un lot PRÉVU PUIS INTÉGRALEMENT RESTITUÉ, dont le net vaut `0` — un
        VRAI zéro, que le champ déclaré (`null`) rendrait « — » ;
     3. le LOT DU RAPPEL : servi SANS avoir été prévu ;
     4. un lot NOMINAL, servi exactement comme prévu, et SANS DLC.

   ═══ CE QU'ÉTAIT LE QUATRIÈME CAS, ET POURQUOI IL A CHANGÉ (02/08/2026) ═══

   Il décrivait « un lot dont `quantiteMouvementee` est ABSENT de la charge
   utile », et affirmait que l'écran devait alors lire « — » plutôt que « 0 ».

   Ce cas est devenu STRUCTURELLEMENT IMPOSSIBLE le 01/08/2026, quand le champ
   est passé de `.nullable().optional()` à REQUIS
   (`schemaTracabiliteAmontConsommation`, `packages/core/src/contrats/afsca.ts`).
   Établi dans le code, pas par principe — DEUX portes Zod, et non une :

     - la route `GET /afsca/tracabilite/sessions/:id` fait
       `schemaTracabiliteAmontSession.parse(resultat)`
       (`apps/api/src/routes/afsca.ts`) ; une `ZodError` levée dans un
       gestionnaire y devient un **422** (`apps/api/src/plugins/erreurs.ts`),
       jamais une réponse 200 amputée ;
     - l'écran RE-VALIDE la charge reçue avec le MÊME schéma
       (`schemaTracabiliteAmontSession.parse(reponse)`, `RegistreAfsca.tsx`,
       `rechercherAmont`) avant de la mettre en état `pret`. C'est cette
       seconde porte qui ferme le cas quoi qu'il arrive côté serveur : sans le
       champ, le tableau n'est JAMAIS rendu — l'écran passe en état d'erreur.

   L'argument « un serveur d'une version antérieure servirait une charge sans ce
   champ » ne tient pas ici : en production, c'est le MÊME processus Fastify qui
   sert `apps/web/dist` (`apps/api/src/serveur.ts`). Client et serveur sont un
   seul artefact, sur un seul poste, pour un seul utilisateur (CLAUDE.md §0
   et §1) — il n'existe aucun déploiement où l'un devance l'autre.

   Le test correspondant a donc été RÉÉCRIT, pas retiré ni assoupli : il ne
   vérifie plus un rendu inatteignable, il garde la PORTE qui le rend
   inatteignable (« une charge SANS le champ requis est REFUSÉE »). Si quelqu'un
   remet `.optional()` au contrat, ou retire le `.parse()` de l'écran, il rougit.
   L'intention de l'ancien cas — une absence se dit « — », jamais une valeur
   fabriquée — survit sur `dateDlc`, où l'absence est RÉELLE (voir `LOT_SANS_DLC`).
   ═══════════════════════════════════════════════════════════════════════════ */

type ConsommationAmont =
  TracabiliteAmontSessionContrat['productions'][number]['consommations'][number];

/**
 * `quantiteMouvementee` est le SEUL champ de cette fabrique SANS valeur par
 * défaut, et c'est délibéré : il n'en existe aucune qui soit honnête.
 *
 * Un `0` par défaut n'est pas un remplissage neutre, c'est une AFFIRMATION —
 * « la matière prise sur ce lot a été intégralement restituée ». Posé ici le
 * 01/08/2026 pour satisfaire `tsc` au moment du durcissement du contrat, il a
 * immédiatement aplati le quatrième cas de cette fixture sur le deuxième : deux
 * lots que rien ne devait rendre interchangeables affichaient le même « 0 »
 * dans la colonne même que la fixture existe pour discriminer (docs/39 §3,
 * forme 3 — « trop dégénérée pour discriminer »).
 *
 * Le rendre OBLIGATOIRE au type ne corrige pas cet aplatissement : il le rend
 * ININSCRIPTIBLE. Un cas ajouté demain sans y penser ne compile pas.
 */
function consommation(
  partiel: Partial<ConsommationAmont> & Pick<ConsommationAmont, 'quantiteMouvementee'>,
): ConsommationAmont {
  return {
    lotId: 'lot-x',
    ingredientId: 'ing-farine',
    ingredientNom: 'Farine de froment T55',
    quantiteTheorique: 0,
    quantiteReelle: null,
    numeroLotFournisseur: null,
    dateReception: '2026-07-20',
    dateDlc: '2027-01-31',
    fournisseurId: 'four-1',
    fournisseurNom: 'Moulin de Statte',
    receptionId: 'rec-1',
    receptionNumero: 'RC-2026-0044',
    receptionStatut: 'active',
    ...partiel,
  };
}

/**
 * 1. Prévu ET servi. La déclaration du porteur (1 251 g) porte sur
 *    l'INGRÉDIENT entier : 964 g sont sortis d'ici, les 287 restants du lot
 *    n°3 ci-dessous. Les deux chiffres DIFFÈRENT — c'est ce qui rend ces
 *    tests capables de voir lequel des deux l'écran affiche.
 */
const LOT_PREVU_SERVI = consommation({
  lotId: 'lot-far-a',
  numeroLotFournisseur: 'FAR-2026-A',
  quantiteTheorique: 964,
  quantiteReelle: 1251,
  quantiteMouvementee: 964,
});

/**
 * 2. Prévu, puis INTÉGRALEMENT RESTITUÉ. Le stock a bougé dans les deux sens,
 *    net zéro. Ingrédient servi par plusieurs lots, donc la déclaration n'est
 *    attribuable à aucun : `quantiteReelle` est `null`. Un écran qui lirait ce
 *    champ-là afficherait « — » là où la vérité est « rien n'en est sorti, net ».
 */
const LOT_PREVU_RESTITUE = consommation({
  lotId: 'lot-lait-b',
  ingredientId: 'ing-lait',
  ingredientNom: 'Lait entier',
  numeroLotFournisseur: 'LAIT-2026-B',
  quantiteTheorique: 340,
  quantiteReelle: null,
  quantiteMouvementee: 0,
});

/**
 * 3. LE LOT DU RAPPEL. La fournée ne lui avait rien alloué
 *    (`quantiteTheorique` = 0, un vrai zéro), la déclaration ne lui est pas
 *    attribuable (`null`) — et pourtant 287 g en sont sortis. C'est
 *    exactement la ligne qu'un avis de rappel vient chercher.
 */
const LOT_HORS_FOURNEE = consommation({
  lotId: 'lot-far-b',
  numeroLotFournisseur: 'FAR-2026-B',
  quantiteTheorique: 0,
  quantiteReelle: null,
  quantiteMouvementee: 287,
});

/**
 * 4. NOMINAL, ET SANS DLC. Remplace, le 02/08/2026, le cas « champ neuf
 *    ABSENT » devenu structurellement impossible — voir le bloc d'en-tête de
 *    cette section pour ce qui l'a rendu tel, et le test « une charge SANS
 *    `quantiteMouvementee` est REFUSÉE » pour ce qui le garde désormais.
 *
 *    CE QU'IL APPORTE, et c'est l'intention de l'ancien cas portée sur un champ
 *    où l'absence est RÉELLE : `dateDlc` est nullable en base (`lot.date_dlc`,
 *    déclarée sans `notNull()`) et au contrat (`z.string().nullable()`) — une
 *    vergeoise n'en porte pas. Une fixture où TOUTES les DLC sont connues ne
 *    prouve rien sur l'affichage d'une DLC inconnue (docs/39 §3, forme 3, dont
 *    c'est l'exemple mot pour mot). C'est la seule ligne du tableau qui porte
 *    une absence, et le seul lot dont la cellule DLC doive lire « — ».
 *
 *    CE QU'IL N'APPORTE PAS, dit franchement : les trois quantités coïncident
 *    ici (55 prévu, 55 déclaré, 55 mouvementé), donc cette ligne NE discrimine
 *    PAS la source de la colonne « Sorti du lot ». Ce sont les lots 1 et 2 qui
 *    portent cette preuve. Elle est là parce qu'un registre fait de quatre
 *    lignes toutes exceptionnelles ne ressemble à aucune session réelle.
 */
const LOT_SANS_DLC = consommation({
  lotId: 'lot-verg-c',
  ingredientId: 'ing-vergeoise',
  ingredientNom: 'Vergeoise blonde',
  numeroLotFournisseur: 'VERG-2026-C',
  dateDlc: null,
  quantiteTheorique: 55,
  quantiteReelle: 55,
  quantiteMouvementee: 55,
});

const AMONT_SESSION: TracabiliteAmontSessionContrat = {
  sessionId: 'sess-31',
  numero: 'SM-2026-0031',
  dateSession: '2026-07-26',
  productions: [
    {
      productionId: 'prod-7',
      numero: 'PR-2026-0007',
      recetteCode: 'R1',
      recetteNom: 'Pâte à crêpes froment',
      numeroLotPate: 'PATE-PR-2026-0007',
      dateProduction: '2026-07-25',
      consommations: [LOT_PREVU_SERVI, LOT_PREVU_RESTITUE, LOT_HORS_FOURNEE, LOT_SANS_DLC],
    },
  ],
  revendus: [],
  garnitures: [],
};

const SESSION_BATTE = {
  id: 'sess-31',
  numero: 'SM-2026-0031',
  dateSession: '2026-07-26',
  lieuNom: 'La Batte',
};

/**
 * Le sens AVAL, celui d'un rappel réel : on part du lot `FAR-2026-B` — celui
 * de l'avis fournisseur — et on demande où il est parti. Trois productions,
 * les trois mêmes situations discriminantes qu'en amont.
 */
const AVAL_LOT_RAPPELE: TracabiliteAvalLotContrat = {
  lotId: 'lot-far-b',
  ingredientId: 'ing-farine',
  ingredientNom: 'Farine de froment T55',
  numeroLotFournisseur: 'FAR-2026-B',
  dateReception: '2026-07-20',
  dateDlc: '2027-01-31',
  fournisseurId: 'four-1',
  fournisseurNom: 'Moulin de Statte',
  receptionId: 'rec-1',
  receptionNumero: 'RC-2026-0044',
  receptionStatut: 'active',
  statut: 'bloque',
  motifStatutLibelle: 'Rappel fournisseur',
  dateChangementStatut: '2026-08-01T09:14:00.000Z',
  nonConformites: [],
  productions: [
    // Le cas du rappel : cette fournée n'avait PAS prévu ce lot.
    {
      productionId: 'prod-7',
      numero: 'PR-2026-0007',
      dateProduction: '2026-07-25',
      numeroLotPate: 'PATE-PR-2026-0007',
      quantiteTheorique: 0,
      quantiteReelle: null,
      quantiteMouvementee: 287,
      session: SESSION_BATTE,
    },
    // Prévu et servi, avec une déclaration (1 310) distincte du mouvementé.
    {
      productionId: 'prod-8',
      numero: 'PR-2026-0008',
      dateProduction: '2026-07-18',
      numeroLotPate: 'PATE-PR-2026-0008',
      quantiteTheorique: 1180,
      quantiteReelle: 1310,
      quantiteMouvementee: 1180,
      session: SESSION_BATTE,
    },
    // Prévu puis intégralement restitué, et pâte pas encore affectée.
    {
      productionId: 'prod-9',
      numero: 'PR-2026-0009',
      dateProduction: '2026-07-11',
      numeroLotPate: 'PATE-PR-2026-0009',
      quantiteTheorique: 512,
      quantiteReelle: null,
      quantiteMouvementee: 0,
      session: null,
    },
  ],
  ventes: [],
  garnitures: [],
};

/** En-têtes du tableau qui contient cette rangée, dans l'ordre du DOM. */
function enTetes(rangee: HTMLTableRowElement): string[] {
  const tableau = rangee.closest('table');
  if (tableau === null) throw new Error('Rangée hors de tout <table>.');
  return [...tableau.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
}

/**
 * Cellule n° `index` de cette rangée. Les index nommés ci-dessous ne sont pas
 * une supposition : le premier test de chaque bloc vérifie l'ORDRE des
 * en-têtes, et rougit donc AVANT ceux-ci si une colonne bouge.
 */
function cellule(rangee: HTMLTableRowElement, index: number): HTMLTableCellElement {
  const cellules = rangee.querySelectorAll('td');
  const trouvee = cellules.item(index);
  if (trouvee === null) {
    throw new Error(`Colonne ${index} absente (${cellules.length} cellules dans la rangée).`);
  }
  return trouvee;
}

/**
 * Le NOMBRE d'une cellule « Théorique », isolé de la marque « hors fournée »
 * qui peut le suivre : le nombre est un nœud texte, la marque un `<span>`.
 */
function nombreTheorique(cellule: HTMLTableCellElement): string {
  return cellule.firstChild?.textContent ?? '';
}

const AMONT = { DLC: 4, THEORIQUE: 5, SORTI: 6 } as const;
const AVAL = { THEORIQUE: 3, SORTI: 4, SESSION: 5 } as const;
const MARQUE_HORS_FOURNEE = '— hors fournée';

type Objet = Record<string, unknown>;

/**
 * Copie profonde d'une charge utile, RENDUE AU TYPE `Objet` — c'est-à-dire
 * délestée du contrat.
 *
 * `quantiteMouvementee` étant REQUIS, une charge qui en manque ne peut plus se
 * fabriquer en respectant le type : il faut sortir du type pour l'écrire, ce
 * qui est exactement la démonstration recherchée. Aller-retour JSON plutôt que
 * `structuredClone` : ces fixtures sont purement sérialisables, et on ne dépend
 * ainsi d'aucun global que l'environnement `jsdom` pourrait ne pas exposer.
 */
function copieDelestee(charge: unknown): Objet {
  return JSON.parse(JSON.stringify(charge)) as Objet;
}

/** Descend dans une charge délestée, en échouant fort plutôt qu'en silence. */
function sous(objet: Objet, ...cles: readonly (string | number)[]): Objet {
  let courant: unknown = objet;
  for (const cle of cles) {
    if (typeof courant !== 'object' || courant === null) {
      throw new Error(`Chemin absent de la charge : ${cles.join('.')}`);
    }
    courant = (courant as Objet)[String(cle)];
  }
  if (typeof courant !== 'object' || courant === null) {
    throw new Error(`Chemin absent de la charge : ${cles.join('.')}`);
  }
  return courant as Objet;
}

describe('Traçabilité amont — ce que la fournée a pris, lot par lot', () => {
  async function rechercher(): Promise<void> {
    feindre({
      releves: listeReleves([CONFORME]),
      sansReleve: listeSansReleve([]),
      amont: AMONT_SESSION,
    });
    render(<RegistreAfsca />);
    await userEvent.click(screen.getByRole('tab', { name: 'Traçabilité' }));
    await userEvent.type(screen.getByLabelText('Identifiant de la session'), 'sess-31');
    await userEvent.click(screen.getAllByRole('button', { name: 'Rechercher' })[0] as HTMLElement);
    await screen.findByText('FAR-2026-A');
  }

  function rangee(numeroLot: string): HTMLTableRowElement {
    const cellule = screen.getByText(numeroLot);
    const tr = cellule.closest('tr');
    if (tr === null) throw new Error(`Lot ${numeroLot} hors de toute rangée.`);
    return tr;
  }

  it('« Sorti du lot » a PRIS LA PLACE de « Réel » — sept colonnes, pas huit', async () => {
    await rechercher();

    // L'ordre EST la garantie des index nommés plus haut. Et l'absence de
    // « Réel » est le cœur de la décision : le registre n'affiche plus une
    // quantité déclarée POUR L'INGRÉDIENT sur une ligne de LOT.
    expect(enTetes(rangee('FAR-2026-A'))).toEqual([
      'Ingrédient',
      'N° lot fournisseur',
      'Fournisseur',
      'Réception',
      'DLC',
      'Théorique',
      'Sorti du lot',
    ]);
  });

  it('un lot prévu et servi affiche ce que le STOCK a enregistré, pas ce que le porteur a déclaré', async () => {
    await rechercher();

    const ligne = rangee('FAR-2026-A');
    expect(nombreTheorique(cellule(ligne, AMONT.THEORIQUE))).toBe(formaterEntier(964));
    expect(cellule(ligne, AMONT.SORTI).textContent).toBe(formaterEntier(964));

    // La quantité DÉCLARÉE (1 251 g, pour l'ingrédient entier) n'apparaît
    // nulle part sur cette ligne. `textContent` et non `getByText` : le
    // normaliseur de testing-library remplace l'espace insécable d'`Intl` par
    // une espace ordinaire, et rendrait ce contrôle faussement rassurant.
    expect(ligne.textContent ?? '').not.toContain(formaterEntier(1251));
  });

  it('un lot prévu puis intégralement restitué affiche « 0 » — un VRAI zéro, jamais « — »', async () => {
    await rechercher();

    // `quantiteReelle` vaut `null` sur cette ligne (ingrédient servi par
    // plusieurs lots) : un écran qui lirait ce champ-là écrirait « — », ce qui
    // se lit « on ne sait pas ». La vérité est « la matière est repartie au
    // stock » — un zéro mesuré.
    const sorti = cellule(rangee('LAIT-2026-B'), AMONT.SORTI);
    expect(sorti.textContent).toBe(formaterEntier(0));
    expect(sorti.textContent).not.toBe(TIRET_ABSENT);
  });

  it('une DLC absente vaut « — », jamais une date fabriquée', async () => {
    await rechercher();

    // `dateDlc` est nullable en base comme au contrat : une vergeoise n'a pas
    // de DLC. C'est la seule absence RÉELLE de ce tableau, et elle doit se lire
    // comme une absence (CLAUDE.md §7).
    expect(cellule(rangee('VERG-2026-C'), AMONT.DLC).textContent).toBe(TIRET_ABSENT);

    // Les trois autres lots la portent : sans cela, ce test passerait aussi
    // avec un écran qui n'afficherait JAMAIS de DLC.
    for (const numero of ['FAR-2026-A', 'LAIT-2026-B', 'FAR-2026-B']) {
      expect(cellule(rangee(numero), AMONT.DLC).textContent).toBe(formaterDate('2027-01-31'));
    }
  });

  /**
   * CE TEST A REMPLACÉ, le 02/08/2026, « un champ “sorti du lot” ABSENT vaut
   * “—”, jamais “0” ».
   *
   * L'ancien décrivait un rendu devenu inatteignable : `quantiteMouvementee`
   * étant REQUIS au contrat depuis le 01/08/2026, aucune charge utile amputée
   * n'atteint plus le tableau. Le garder aurait été garder une fixture aveugle
   * de forme 2 — « elle décrit un cas impossible » (docs/39 §3).
   *
   * Ce qu'il vérifie à la place est la PORTE qui produit cette impossibilité,
   * et c'est un comportement réel : l'écran RE-VALIDE la charge reçue avec le
   * même schéma que la route, au lieu de faire confiance au serveur. Sans cette
   * seconde validation, un champ requis manquant redeviendrait `undefined` dans
   * le rendu, et l'`ouTiret` défensif de la colonne le peindrait en « — » —
   * c'est-à-dire une charge utile CASSÉE affichée comme une donnée simplement
   * inconnue. Un registre réglementaire doit dire qu'il n'a pas pu lire, pas
   * inventer une absence.
   *
   * Il rougit donc si l'on remet `.optional()` au contrat, ou si l'on retire le
   * `.parse()` de l'écran — les deux seules façons de rouvrir le cas.
   */
  it('une charge SANS le champ requis est REFUSÉE — jamais rendue, ni en « 0 » ni en « — »', async () => {
    const ampute = copieDelestee(AMONT_SESSION);
    delete sous(ampute, 'productions', 0, 'consommations', 0)['quantiteMouvementee'];

    feindre({
      releves: listeReleves([CONFORME]),
      sansReleve: listeSansReleve([]),
      amont: ampute,
    });
    render(<RegistreAfsca />);
    await userEvent.click(screen.getByRole('tab', { name: 'Traçabilité' }));
    await userEvent.type(screen.getByLabelText('Identifiant de la session'), 'sess-31');
    await userEvent.click(screen.getAllByRole('button', { name: 'Rechercher' })[0] as HTMLElement);

    expect(await screen.findByText('La recherche a échoué.')).toBeInTheDocument();
    // Et AUCUNE ligne n'est rendue : ni celle qu'on a amputée, ni les trois
    // saines de la même charge. Une réponse à moitié lue vaut zéro sur un
    // rappel — le porteur doit rechercher, pas croire un tableau tronqué.
    expect(screen.queryByText('FAR-2026-A')).toBeNull();
    expect(screen.queryByText('FAR-2026-B')).toBeNull();
  });

  it('le lot venu d’ailleurs porte la marque « hors fournée » — et lui seul', async () => {
    await rechercher();

    // Sans marque, « 0 théorique » se lit « ce lot n'a rien fourni » : l'exact
    // inverse de la vérité, sur la ligne même qu'un rappel vient chercher.
    const rappel = rangee('FAR-2026-B');
    expect(within(rappel).getByText(MARQUE_HORS_FOURNEE)).toBeInTheDocument();
    expect(nombreTheorique(cellule(rappel, AMONT.THEORIQUE))).toBe(formaterEntier(0));
    expect(cellule(rappel, AMONT.SORTI).textContent).toBe(formaterEntier(287));

    // Les trois autres lots étaient prévus : les marquer tous ne
    // distinguerait plus rien.
    for (const numero of ['FAR-2026-A', 'LAIT-2026-B', 'VERG-2026-C']) {
      expect(within(rangee(numero)).queryByText(MARQUE_HORS_FOURNEE)).toBeNull();
    }
  });

  it('la marque reste NEUTRE : un lot venu combler un écart n’est pas une non-conformité', async () => {
    await rechercher();

    const marque = within(rangee('FAR-2026-B')).getByText(MARQUE_HORS_FOURNEE);
    expect(marque.className).toContain('text-ink-3');
    // Le registre d'alerte métier doit rester rare pour rester lu : le rouge
    // est réservé à ce qui demande un geste (dépassement de température),
    // jamais à un mouvement de stock normal.
    expect(marque.className).not.toContain('text-depassement');
    expect(marque.className).not.toContain('text-alerte');
    expect(marque.className).not.toContain(CLASSE_ALERTE_METIER);
    // Et la marque porte son propre TEXTE : une infobulle native n'est pas
    // exposée au clavier (CLAUDE.md §3 règle 10), elle ne peut donc jamais
    // être le seul support d'un fait réglementaire.
    expect(marque.textContent).toContain('hors fournée');
  });

  it('les deux colonnes de quantité ne se tronquent sous AUCUNE forme', async () => {
    await rechercher();

    // `data-troncature="repli"` EST la décision (docs/07 §4.5) : jsdom
    // n'applique aucune feuille de style, on prouve la classe posée, pas le
    // pixel. Sans elle, l'ellipse mangerait la marque « hors fournée » avant
    // le nombre — et le lot du rappel redeviendrait un « 0 » muet.
    const ligne = rangee('FAR-2026-B');
    expect(cellule(ligne, AMONT.THEORIQUE)).toHaveAttribute('data-troncature', 'repli');
    expect(cellule(ligne, AMONT.SORTI)).toHaveAttribute('data-troncature', 'repli');
  });
});

describe('Traçabilité aval — « le meunier rappelle ce lot : où est-il parti ? »', () => {
  async function rechercher(): Promise<HTMLInputElement> {
    feindre({
      releves: listeReleves([CONFORME]),
      sansReleve: listeSansReleve([]),
      aval: AVAL_LOT_RAPPELE,
    });
    render(<RegistreAfsca />);
    await userEvent.click(screen.getByRole('tab', { name: 'Traçabilité' }));
    const champ = screen.getByLabelText(
      'Numéro de lot fournisseur (ou identifiant technique)',
    ) as HTMLInputElement;
    await userEvent.type(champ, 'FAR-2026-B');
    // `{Enter}` et non un clic : c'est le geste réel, et la règle 10 de
    // CLAUDE.md veut que la souris ne soit jamais obligatoire.
    await userEvent.keyboard('{Enter}');
    await screen.findByText('PR-2026-0007');
    return champ;
  }

  function rangee(numeroProduction: string): HTMLTableRowElement {
    const tr = screen.getByText(numeroProduction).closest('tr');
    if (tr === null) throw new Error(`Production ${numeroProduction} hors de toute rangée.`);
    return tr;
  }

  it('« Sorti du lot » a pris la place de « Réel » ici aussi — six colonnes', async () => {
    await rechercher();

    expect(enTetes(rangee('PR-2026-0007'))).toEqual([
      'Production',
      'Lot de pâte',
      'Date',
      'Théorique',
      'Sorti du lot',
      'Session',
    ]);
  });

  it('la production qui n’avait PAS prévu ce lot nomme quand même la pâte, la quantité et le marché', async () => {
    await rechercher();

    // C'est LA réponse au rappel, et elle n'existait nulle part avant le
    // 01/08/2026 : cette production ne figurait pas au registre, parce que le
    // lot n'avait aucune ligne dans la table écrite au lancement.
    const ligne = rangee('PR-2026-0007');
    expect(within(ligne).getByText('PATE-PR-2026-0007')).toBeInTheDocument();
    expect(within(ligne).getByText(MARQUE_HORS_FOURNEE)).toBeInTheDocument();
    expect(nombreTheorique(cellule(ligne, AVAL.THEORIQUE))).toBe(formaterEntier(0));
    expect(cellule(ligne, AVAL.SORTI).textContent).toBe(formaterEntier(287));
    // Le marché concerné, nommé — pas seulement la pâte. Date comparée au
    // formateur : `Europe/Brussels`, jamais une date tapée à la main.
    expect(cellule(ligne, AVAL.SESSION).textContent).toContain('SM-2026-0031');
    expect(cellule(ligne, AVAL.SESSION).textContent).toContain('La Batte');
    expect(cellule(ligne, AVAL.SESSION).textContent).toContain(formaterDate('2026-07-26'));
  });

  it('sur une production qui l’avait bien prévu, c’est encore le STOCK qui parle — et aucune marque', async () => {
    await rechercher();

    const ligne = rangee('PR-2026-0008');
    expect(nombreTheorique(cellule(ligne, AVAL.THEORIQUE))).toBe(formaterEntier(1180));
    expect(cellule(ligne, AVAL.SORTI).textContent).toBe(formaterEntier(1180));
    // La déclaration du porteur (1 310) reste hors de cette ligne.
    expect(ligne.textContent ?? '').not.toContain(formaterEntier(1310));
    expect(within(ligne).queryByText(MARQUE_HORS_FOURNEE)).toBeNull();
  });

  it('restitution intégrale : « 0 », et une pâte encore sans marché se dit « — »', async () => {
    await rechercher();

    const ligne = rangee('PR-2026-0009');
    expect(cellule(ligne, AVAL.SORTI).textContent).toBe(formaterEntier(0));
    // Deux « absences » de nature opposée sur la MÊME rangée : un zéro mesuré
    // à gauche, une affectation qui n'a pas encore eu lieu à droite.
    expect(cellule(ligne, AVAL.SESSION).textContent).toBe(TIRET_ABSENT);
  });

  /**
   * Jumeau du test de refus côté amont, et il n'est PAS redondant : le sens
   * aval passe par un second appel à `.parse()`, sur un autre schéma et dans
   * une autre fonction (`rechercherAval`, `RegistreAfsca.tsx`). Un seul des
   * deux gardé, l'autre pouvait être retiré sans qu'aucun test ne rougisse.
   */
  it('ici aussi, une charge sans le champ requis est REFUSÉE plutôt que rendue', async () => {
    const ampute = copieDelestee(AVAL_LOT_RAPPELE);
    delete sous(ampute, 'productions', 0)['quantiteMouvementee'];

    feindre({
      releves: listeReleves([CONFORME]),
      sansReleve: listeSansReleve([]),
      aval: ampute,
    });
    render(<RegistreAfsca />);
    await userEvent.click(screen.getByRole('tab', { name: 'Traçabilité' }));
    await userEvent.type(
      screen.getByLabelText('Numéro de lot fournisseur (ou identifiant technique)'),
      'FAR-2026-B',
    );
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByText('La recherche a échoué.')).toBeInTheDocument();
    expect(screen.queryByText('PR-2026-0007')).toBeNull();
    expect(screen.queryByText('PR-2026-0008')).toBeNull();
  });

  it('la recherche se lance à Entrée, et le focus RESTE dans le champ pour enchaîner un second lot', async () => {
    const champ = await rechercher();

    // La saisie post-marché est répétitive (CLAUDE.md §3 règle 10) : un rappel
    // porte souvent sur plusieurs lots d'affilée. Si l'écran ramenait le focus
    // ailleurs après chaque résultat, il faudrait la souris à chaque lot.
    expect(document.activeElement).toBe(champ);
    expect(champ.value).toBe('FAR-2026-B');
  });

  it('on atteint la Traçabilité aux FLÈCHES, sans jamais toucher la souris', async () => {
    feindre({ releves: listeReleves([CONFORME]), sansReleve: listeSansReleve([]) });
    render(<RegistreAfsca />);

    const onglets = screen.getAllByRole('tab');
    (onglets[0] as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');

    expect(onglets[3]).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(onglets[3]);
    // Le panneau est bien celui de la traçabilité, pas seulement l'onglet.
    expect(
      screen.getByLabelText('Numéro de lot fournisseur (ou identifiant technique)'),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. L'ATTENTE PENDANT UN ENVOI — promesse CONTRÔLÉE (docs/39 §3, forme 5)

   Chaque test au-dessus feint le réseau avec une promesse déjà résolue
   (`Promise.resolve`, via `feindre`) : elle est déjà tenue au moment où le
   test l'observe, et l'état « en_cours » retombe à son état suivant dans le
   MÊME écoulement de micro-tâches que sa pose — il n'atteint jamais le DOM.
   C'est un registre RÉGLEMENTAIRE (docs AFSCA) : un relevé de température ou
   une non-conformité écrite deux fois par un double envoi fausse le registre
   d'autocontrôle lui-même, pas seulement l'écran.

   Chaque test ci-dessous résout la promesse LUI-MÊME, après avoir observé
   l'attente. AUCUN de ces cinq formulaires n'a d'écouteur clavier global
   (contrairement à `Sessions.tsx`, qui expose Ctrl+S sur `window` pour sa
   clôture) : seul Échap existe ici, et il ne soumet rien — il referme un
   panneau de sélection. Un `<button disabled>` bloque nativement le clic ET
   la soumission implicite par Entrée (limite déjà mesurée dans
   `SaisieSortie.montage.test.tsx`). Un second geste ne prouverait donc RIEN
   du garde-fou applicatif : seul l'attribut `disabled` serait mesuré. Chaque
   test le dit explicitement plutôt que de feindre un contournement qui
   n'existe pas.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Router COMPLET des cinq onglets — nécessaire ici : `feindre` (plus haut)
 * laisse VOLONTAIREMENT en chargement perpétuel tout onglet qui n'est pas son
 * objet (« on les laisse en chargement plutôt que d'inventer une réponse »).
 * Les tests de cette section ouvrent successivement les cinq, il faut donc
 * une réponse par défaut pour chacun.
 */
type ReponsesCompletes = {
  releves?: unknown;
  sansReleve?: unknown;
  tachesEnRetard?: unknown;
  taches?: unknown;
  executions?: unknown;
  nonConformites?: unknown;
  exercices?: unknown;
  amont?: unknown;
  aval?: unknown;
};

function routerComplet(
  reponses: ReponsesCompletes,
): (chemin: string, options?: RequestInit) => Promise<unknown> {
  return (chemin, options) => {
    // Toute ÉCRITURE par défaut reste en vol indéfiniment : chaque test la
    // reprend explicitement via un `mockImplementation` posé PAR-DESSUS
    // celui-ci (`routeurBase`), jamais ici — sinon la promesse « contrôlée »
    // de chaque test ne contrôlerait plus rien.
    if (options?.method !== undefined && options.method !== 'GET') {
      return new Promise<never>(() => {});
    }
    if (chemin === '/afsca/temperatures')
      return Promise.resolve(reponses.releves ?? listeReleves([]));
    if (chemin.startsWith('/afsca/temperatures/sessions-sans-releve'))
      return Promise.resolve(reponses.sansReleve ?? listeSansReleve([]));
    if (chemin === '/afsca/nettoyage/taches-en-retard')
      return Promise.resolve(reponses.tachesEnRetard ?? { data: [], meta: { total: 0 } });
    if (chemin === '/afsca/nettoyage/taches')
      return Promise.resolve(reponses.taches ?? { data: [], meta: { total: 0 } });
    if (chemin.startsWith('/afsca/nettoyage/executions'))
      return Promise.resolve(reponses.executions ?? { data: [], meta: { total: 0 } });
    if (chemin === '/afsca/non-conformites')
      return Promise.resolve(reponses.nonConformites ?? { data: [], meta: { total: 0 } });
    if (chemin === '/afsca/exercices-tracabilite')
      return Promise.resolve(reponses.exercices ?? { data: [], meta: { total: 0 } });
    if (chemin.startsWith('/afsca/tracabilite/sessions/'))
      return reponses.amont === undefined
        ? new Promise<never>(() => {})
        : Promise.resolve(reponses.amont);
    if (chemin.startsWith('/afsca/tracabilite/lots/'))
      return reponses.aval === undefined
        ? new Promise<never>(() => {})
        : Promise.resolve(reponses.aval);
    return Promise.reject(new Error(`Chemin non prévu par la fixture : ${chemin}`));
  };
}

describe('Registre AFSCA — relevé de température : l’attente pendant l’envoi (promesse contrôlée)', () => {
  async function monterPret(): Promise<void> {
    appel.mockImplementation(
      routerComplet({ releves: listeReleves([CONFORME]), sansReleve: listeSansReleve([]) }),
    );
    render(<RegistreAfsca />);
    await screen.findByText('Glacière rigide 60 L');
  }

  it('l’enregistrement d’un relevé est ANNONCÉ et redevient actionnable après la réponse', async () => {
    await monterPret();
    await userEvent.type(screen.getByLabelText('Équipement'), 'Glacière souple');
    await userEvent.type(screen.getByLabelText('Température (°C)'), '3,5');

    let repondre: ((valeur: unknown) => void) | undefined;
    const routeurBase = appel.getMockImplementation();
    appel.mockImplementation((chemin, options) => {
      if (chemin === '/afsca/temperatures' && options?.method === 'POST') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return routeurBase?.(chemin, options) ?? Promise.reject(new Error('Router de base absent.'));
    });

    const bouton = screen.getByRole('button', { name: /Enregistrer le relevé/ });
    await userEvent.click(bouton);

    // 1. L'attente est ANNONCÉE : ce formulaire choisit `disabled` natif
    //    (contrairement au contrôle d'intégrité de `Stock.tsx`).
    await waitFor(() => expect(bouton).toBeDisabled());
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();

    /*
      2. AUCUN chemin ne contourne ce bouton : ce formulaire n'a pas
      d'écouteur clavier global (seul Échap existe sur cet écran, et il ne
      soumet jamais rien — il referme un panneau de sélection ailleurs). Un
      second clic ou un `{Enter}` seraient déjà bloqués par le navigateur, et
      ne prouveraient donc RIEN du garde-fou applicatif `peutEnregistrer`
      (docs/39 §3, forme 5) : ce test ne feint pas ce contournement.
    */
    repondre?.(
      releve({
        id: 'rel-nouveau',
        equipement: 'Glacière souple',
        temperatureC: 3.5,
        moment: 'depart',
      }),
    );

    /*
      3. Le libellé redevient « Enregistrer le relevé » : la transition
      `en_cours` → `succes` a bien eu lieu. On ne réaffirme PAS `not
      .toBeDisabled()` ici : un succès vide AUSSI le champ Température (« Le
      champ temperature repart TOUJOURS vide », `RegistreAfsca.tsx`), et
      `peutEnregistrer` redevient alors faux pour une raison LÉGITIME et sans
      rapport avec l'attente réseau — un champ obligatoire de nouveau vide,
      pas un bouton resté bloqué. Confondre les deux ferait tomber ce test
      pour un mauvais motif dès qu'une saisie post-succès change.
    */
    await screen.findByRole('button', { name: /Enregistrer le relevé/ });
    expect(screen.getByText('Relevé enregistré — conforme.')).toBeInTheDocument();
  });

  it('l’annulation d’un relevé est ANNONCÉE et redevient actionnable après la réponse', async () => {
    await monterPret();
    await userEvent.click(screen.getByRole('button', { name: /Annuler/ }));
    await userEvent.type(
      screen.getByLabelText('Motif de l’annulation'),
      'Thermomètre mal calibré.',
    );

    let repondre: ((valeur: unknown) => void) | undefined;
    const routeurBase = appel.getMockImplementation();
    appel.mockImplementation((chemin, options) => {
      if (chemin === `/afsca/temperatures/${CONFORME.id}/annuler` && options?.method === 'POST') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return routeurBase?.(chemin, options) ?? Promise.reject(new Error('Router de base absent.'));
    });

    const bouton = screen.getByRole('button', { name: 'Confirmer l’annulation' });
    await userEvent.click(bouton);

    await waitFor(() => expect(bouton).toBeDisabled());
    expect(screen.getByText('Annulation…')).toBeInTheDocument();

    // Même limite que ci-dessus : aucun geste clavier ne contourne ce
    // bouton `disabled` natif sur cet écran.
    repondre?.({});
    await screen.findByText('Relevé annulé.');
  });
});

describe('Registre AFSCA — nettoyage : l’exécution d’une tâche est ANNONCÉE (promesse contrôlée)', () => {
  const TACHE_NETTOYAGE: TacheNettoyageContrat = {
    id: 'tache-1',
    libelle: 'Nettoyage plaque',
    frequence: 'apres_session',
    zone: 'Cuisson',
    actif: true,
    creeLe: '2026-01-01T00:00:00.000Z',
    modifieLe: '2026-01-01T00:00:00.000Z',
  };

  it('l’exécution d’une tâche est ANNONCÉE et redevient actionnable après la réponse', async () => {
    appel.mockImplementation(
      routerComplet({ taches: { data: [TACHE_NETTOYAGE], meta: { total: 1 } } }),
    );
    render(<RegistreAfsca />);
    await userEvent.click(screen.getByRole('tab', { name: 'Nettoyage' }));
    await userEvent.click(await screen.findByRole('row', { name: /Nettoyage plaque/ }));
    await screen.findByLabelText("Date d'exécution");

    let repondre: ((valeur: unknown) => void) | undefined;
    const routeurBase = appel.getMockImplementation();
    appel.mockImplementation((chemin, options) => {
      if (chemin === '/afsca/nettoyage/executions' && options?.method === 'POST') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return routeurBase?.(chemin, options) ?? Promise.reject(new Error('Router de base absent.'));
    });

    // `dateExecution` est déjà pré-rempli à AUJOURD'HUI (fiche 17) : aucune
    // autre saisie n'est nécessaire pour rendre ce formulaire actionnable.
    const bouton = screen.getByRole('button', { name: /Enregistrer/ });
    await userEvent.click(bouton);

    await waitFor(() => expect(bouton).toBeDisabled());
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();

    // Même limite : aucun geste clavier ne contourne ce bouton `disabled`.
    repondre?.({
      id: 'exec-1',
      tacheId: 'tache-1',
      sessionId: null,
      dateExecution: '2026-08-02',
      executePar: null,
      observations: null,
      creeLe: '2026-08-02T10:00:00.000Z',
    });
    await screen.findByText('Exécution enregistrée.');
  });
});

describe('Registre AFSCA — non-conformités : déclarer et clôturer, ANNONCÉS (promesse contrôlée)', () => {
  it('la déclaration d’une non-conformité est ANNONCÉE et redevient actionnable après la réponse', async () => {
    appel.mockImplementation(routerComplet({}));
    render(<RegistreAfsca />);
    await userEvent.click(screen.getByRole('tab', { name: 'Non-conformités' }));
    await userEvent.type(screen.getByLabelText('Type'), 'Hygiène du stand');
    await userEvent.type(screen.getByLabelText('Description'), 'Gants non renouvelés.');

    let repondre: ((valeur: unknown) => void) | undefined;
    const routeurBase = appel.getMockImplementation();
    appel.mockImplementation((chemin, options) => {
      if (chemin === '/afsca/non-conformites' && options?.method === 'POST') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return routeurBase?.(chemin, options) ?? Promise.reject(new Error('Router de base absent.'));
    });

    const bouton = screen.getByRole('button', { name: /Déclarer/ });
    await userEvent.click(bouton);

    await waitFor(() => expect(bouton).toBeDisabled());
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();

    repondre?.({
      id: 'nc-1',
      dateConstat: '2026-08-02',
      type: 'Hygiène du stand',
      description: 'Gants non renouvelés.',
      gravite: 'mineure',
      actionCorrective: null,
      dateResolution: null,
      sessionId: null,
      lotId: null,
      creeLe: '2026-08-02T10:00:00.000Z',
      modifieLe: '2026-08-02T10:00:00.000Z',
    });
    await screen.findByText('Non-conformité déclarée.');
  });

  /** Une non-conformité OUVERTE (`dateResolution: null`), rendue clôturable. */
  const NC_OUVERTE: NonConformiteContrat = {
    id: 'nc-9',
    dateConstat: '2026-07-20',
    type: 'Chaîne du froid',
    description: 'Glacière ouverte trop longtemps.',
    gravite: 'majeure',
    actionCorrective: null,
    dateResolution: null,
    sessionId: null,
    lotId: null,
    creeLe: '2026-07-20T10:00:00.000Z',
    modifieLe: '2026-07-20T10:00:00.000Z',
  };

  /**
   * Ouvre l'onglet, sélectionne `NC_OUVERTE`, remplit l'action corrective, et
   * intercepte `POST /afsca/non-conformites/nc-9/cloturer` par une promesse
   * CONTRÔLÉE. Partagé par les deux tests ci-dessous : l'un vérifie l'attente
   * et la sortie du formulaire, l'autre le message de confirmation qui,
   * mesuré ici, ne s'affiche jamais.
   */
  async function clotureEnCours(): Promise<{
    bouton: HTMLElement;
    repondre: (valeur: unknown) => void;
  }> {
    appel.mockImplementation(
      routerComplet({ nonConformites: { data: [NC_OUVERTE], meta: { total: 1 } } }),
    );
    render(<RegistreAfsca />);
    await userEvent.click(screen.getByRole('tab', { name: 'Non-conformités' }));
    await userEvent.click(await screen.findByRole('row', { name: /Chaîne du froid/ }));
    await userEvent.type(screen.getByLabelText('Action corrective prise'), 'Blocs remplacés.');

    let repondre: (valeur: unknown) => void = () => {};
    const routeurBase = appel.getMockImplementation();
    appel.mockImplementation((chemin, options) => {
      if (chemin === '/afsca/non-conformites/nc-9/cloturer' && options?.method === 'POST') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return routeurBase?.(chemin, options) ?? Promise.reject(new Error('Router de base absent.'));
    });

    const bouton = screen.getByRole('button', { name: /Clôturer/ });
    await userEvent.click(bouton);
    await waitFor(() => expect(bouton).toBeDisabled());

    return { bouton, repondre };
  }

  it(
    'la clôture d’une non-conformité est ANNONCÉE, et le formulaire cède la place au résumé ' +
      'figé après la réponse',
    async () => {
      const { bouton, repondre } = await clotureEnCours();
      expect(screen.getByText('Clôture…')).toBeInTheDocument();

      /*
        Recovery mesurée SANS passer par le message de confirmation (voir le
        `it.fails` juste en dessous) : une fois `dateResolution` non nul, la
        production bascule du `<form>` vers un `<p>` figé « Clôturée le … » —
        c'est la moitié du comportement qui fonctionne, et elle suffit à
        prouver que l'écran est sorti de l'attente, sans dépendre de la
        moitié cassée.
      */
      repondre({
        ...NC_OUVERTE,
        dateResolution: '2026-08-02',
        actionCorrective: 'Blocs remplacés.',
      });
      await waitFor(() => expect(bouton).not.toBeInTheDocument());
      expect(await screen.findByText(/^Clôturée le /)).toBeInTheDocument();
    },
  );

  /**
   * ═══ DÉFAUT RÉEL, CORRIGÉ LE 28/09/2026 (était en `it.fails`) ═══
   *
   * Trouvé PAR ce test — vert au premier jet avec `mockResolvedValue`,
   * rouge dès qu'une promesse CONTRÔLÉE force à observer le rendu qui suit
   * réellement la réponse (docs/39 §3, forme 5 : exactement le défaut que ce
   * dossier de tests existe pour traquer).
   *
   * `<p role="status">{etatCloture.message}</p>` (« Non-conformité
   * clôturée. ») vit À L'INTÉRIEUR de la branche `nonConformiteSelectionnee.
   * dateResolution === null ? (<form>…) : (<p>Clôturée le …)` du même
   * `RegistreAfsca.tsx`. Or `cloturer()` pose, dans la MÊME passe,
   * `setEtatListe(...)` (qui donne à la non-conformité sa `dateResolution`
   * fraîche) ET `setEtatCloture({ statut: 'succes', … })`. Le premier
   * changement fait basculer `nonConformiteSelectionnee.dateResolution` de
   * `null` à une date RÉELLE, ce qui bascule le ternaire vers l'AUTRE
   * branche — celle qui ne rend jamais ce paragraphe. Le message de
   * confirmation est donc DÉMONTÉ AU RENDU MÊME où il devrait apparaître :
   * il n'est, structurellement, jamais visible.
   *
   * C'est très exactement la même famille de défaut que ce dépôt a déjà
   * trouvée et corrigée trois fois le 01/08/2026 ailleurs : la confirmation
   * du réalisé dans `Production.tsx`, et la confirmation d'annulation dans
   * `Sessions.tsx` (« Session annulée. », voir le commentaire du même nom
   * dans `Sessions.montage.test.tsx`) — un `<p role="status">` posé À
   * L'INTÉRIEUR d'un bloc que la MÊME écriture démonte. Ici, sur un registre
   * RÉGLEMENTAIRE, l'utilisateur qui vient de clôturer une non-conformité
   * (chaîne du froid, hygiène) ne reçoit AUCUN accusé de réception — le seul
   * signal est la disparition du formulaire.
   *
   * CORRIGÉ le 28/09/2026 : le `<p role="status">` est sorti du ternaire, il
   * ne dépend plus de `dateResolution` (même remède que les deux
   * précédents). Le test, en `it.fails` jusque-là, est devenu ordinaire.
   */
  it('la confirmation « Non-conformité clôturée. » est visible après la clôture (défaut corrigé le 28/09/2026)', async () => {
    const { repondre } = await clotureEnCours();
    repondre({
      ...NC_OUVERTE,
      dateResolution: '2026-08-02',
      actionCorrective: 'Blocs remplacés.',
    });
    await screen.findByText('Non-conformité clôturée.');
  });
});

describe('Registre AFSCA — exercice de traçabilité : l’envoi est ANNONCÉ (promesse contrôlée)', () => {
  it('l’enregistrement d’un exercice est ANNONCÉ et redevient actionnable après la réponse', async () => {
    appel.mockImplementation(routerComplet({}));
    render(<RegistreAfsca />);
    await userEvent.click(screen.getByRole('tab', { name: 'Exercice de traçabilité' }));
    // `dateExercice` (aujourd'hui) et `résultat` (« concluant ») sont déjà
    // valides par défaut : rien d'autre à saisir pour rendre le formulaire
    // actionnable (voir `peutEnregistrer`, `RegistreAfsca.tsx`).
    await screen.findByLabelText('Date');

    let repondre: ((valeur: unknown) => void) | undefined;
    const routeurBase = appel.getMockImplementation();
    appel.mockImplementation((chemin, options) => {
      if (chemin === '/afsca/exercices-tracabilite' && options?.method === 'POST') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return routeurBase?.(chemin, options) ?? Promise.reject(new Error('Router de base absent.'));
    });

    const bouton = screen.getByRole('button', { name: /Enregistrer/ });
    await userEvent.click(bouton);

    await waitFor(() => expect(bouton).toBeDisabled());
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();

    repondre?.({
      id: 'ex-1',
      dateExercice: '2026-08-02',
      lotDepartId: null,
      dureeMinutes: null,
      resultat: 'concluant',
      ecartsConstates: null,
      documentId: null,
      creeLe: '2026-08-02T10:00:00.000Z',
    });
    await screen.findByText('Exercice enregistré.');
  });
});

describe('Registre AFSCA — traçabilité : la recherche est ANNONCÉE pendant l’aller-retour (promesse contrôlée)', () => {
  /**
   * Read-only, à la différence des cinq blocs ci-dessus : `rechercherAmont`
   * et `rechercherAval` (`RegistreAfsca.tsx`) écrivent un `GET`, jamais un
   * `POST`. Un second départ ici gaspille un aller-retour, il n'écrit rien
   * dans aucun registre — c'est pourquoi ces deux boutons choisissent
   * `disabled` natif comme la clôture d'une non-conformité, pas
   * `aria-disabled` comme le contrôle d'intégrité de `Stock.tsx`. Testés
   * quand même : le libellé et l'attribut restent des engagements d'écran,
   * indépendamment de ce qu'ils protègent.
   */
  it('la recherche AMONT est ANNONCÉE (`disabled`, libellé) pendant l’aller-retour', async () => {
    appel.mockImplementation(routerComplet({}));
    render(<RegistreAfsca />);
    await userEvent.click(screen.getByRole('tab', { name: 'Traçabilité' }));
    await userEvent.type(screen.getByLabelText('Identifiant de la session'), 'sess-31');

    let repondre: ((valeur: unknown) => void) | undefined;
    const routeurBase = appel.getMockImplementation();
    appel.mockImplementation((chemin, options) => {
      if (chemin === '/afsca/tracabilite/sessions/sess-31') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return routeurBase?.(chemin, options) ?? Promise.reject(new Error('Router de base absent.'));
    });

    const bouton = screen.getAllByRole('button', { name: 'Rechercher' })[0] as HTMLElement;
    await userEvent.click(bouton);

    await waitFor(() => expect(bouton).toBeDisabled());
    expect(screen.getByText('Recherche…')).toBeInTheDocument();

    repondre?.(AMONT_SESSION);
    await screen.findByText('FAR-2026-A');
  });

  it('la recherche AVAL est ANNONCÉE pendant l’aller-retour, même garde que l’amont', async () => {
    appel.mockImplementation(routerComplet({}));
    render(<RegistreAfsca />);
    await userEvent.click(screen.getByRole('tab', { name: 'Traçabilité' }));
    await userEvent.type(
      screen.getByLabelText('Numéro de lot fournisseur (ou identifiant technique)'),
      'FAR-2026-B',
    );

    let repondre: ((valeur: unknown) => void) | undefined;
    const routeurBase = appel.getMockImplementation();
    appel.mockImplementation((chemin, options) => {
      if (chemin === '/afsca/tracabilite/lots/FAR-2026-B') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return routeurBase?.(chemin, options) ?? Promise.reject(new Error('Router de base absent.'));
    });

    const bouton = screen.getAllByRole('button', { name: 'Rechercher' })[1] as HTMLElement;
    await userEvent.click(bouton);

    await waitFor(() => expect(bouton).toBeDisabled());
    expect(screen.getByText('Recherche…')).toBeInTheDocument();

    repondre?.(AVAL_LOT_RAPPELE);
    await screen.findByText('PR-2026-0007');
  });
});
