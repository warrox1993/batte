/**
 * Tableau de bord — test MONTÉ, en complément de `TableauDeBord.test.tsx`.
 *
 * ═══ Ce que ce fichier ajoute ═══
 *
 * `TableauDeBord.test.tsx`, à côté, rend `SectionPrevision`, `SectionDemarrage`
 * et consorts par `renderToStaticMarkup`, en LEUR PASSANT un état à la main.
 * Il reste valable et n'est pas touché.
 *
 * Ce qu'il ne pouvait PAS voir : l'écran monté, et surtout **le mappage entre
 * la réponse du serveur et l'état passé à ces sections**. Un `catch` qui
 * classerait `premier_passage_lieu` dans la branche générique rendrait un
 * encadré rouge pour un lieu jamais visité — exactement le défaut D-082 — et
 * aucun test statique ne l'aurait vu, puisqu'il n'appelle jamais ce `catch`.
 *
 * ═══ Le défaut du 31/07/2026 que ce fichier verrouille ═══
 *
 * Deux routes ont répondu en 500, et les encarts « Seuils légaux » / « À
 * traiter » ont disparu ENTIÈREMENT, remplacés par un bandeau rouge nu sans
 * titre ni cadre. Le porteur ne pouvait pas dire QUEL encart était mort.
 * `EncartErreur` a corrigé cela — mais rien ne vérifiait, ici, que le tableau
 * de bord l'utilise réellement. C'est ce que ces tests font.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { formaterEuros, formaterPourcent, type CompteurSeuilContrat } from '@batte/core';

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
const { default: TableauDeBord } = await import('./TableauDeBord');

const appel = vi.mocked(requeteApi);

/** Classe du registre d'alerte MÉTIER, celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function seuil(partiel: Partial<CompteurSeuilContrat> = {}): CompteurSeuilContrat {
  return {
    cle: 'franchise_tva',
    libelle: 'Franchise TVA',
    realiseCents: 2125000,
    plafondCents: 2500000,
    partBp: 8500,
    projectionFinAnneeCents: 2400000,
    depassementProjete: false,
    source: 'Code TVA, art. 56bis',
    toleranceE604b: null,
    ...partiel,
  };
}

function tableauSeuils(data: CompteurSeuilContrat[]): unknown {
  return {
    data,
    meta: {
      annee: 2026,
      sessionsTenues: 12,
      caTransformeCents: 1500000,
      caRevenduCents: 625000,
      partRevenduBp: 2941,
      seuilAlerteBp: 8000,
    },
  };
}

/**
 * Réponses PAR CHEMIN. Toute route non citée reste EN ATTENTE plutôt que de
 * recevoir une réponse inventée : cet écran charge une douzaine de routes, et
 * en servir des réponses fantaisistes ferait échouer des `parse` Zod ailleurs,
 * donc apparaître des bandeaux d'erreur sans rapport avec ce qu'on teste.
 */
function feindre(reponses: Readonly<Record<string, unknown>>): void {
  appel.mockImplementation((chemin: string) => {
    const choisie = reponses[chemin];
    if (choisie === undefined) return new Promise<never>(() => {});
    if (choisie instanceof Error) return Promise.reject(choisie);
    return Promise.resolve(choisie as never);
  });
}

function monter(): void {
  render(
    <MemoryRouter>
      <TableauDeBord />
    </MemoryRouter>,
  );
}

/**
 * Recherche par `textContent` BRUT : `formaterEuros` place une espace
 * INSÉCABLE avant le « € », que le normaliseur de `@testing-library` remplace
 * par une espace ordinaire. On compare toujours au FORMATEUR, sur le texte non
 * normalisé.
 */
function texteBrutPresent(attendu: string): boolean {
  return Array.from(document.querySelectorAll('p, span, td, dd')).some((n) =>
    (n.textContent ?? '').includes(attendu),
  );
}

beforeEach(() => {
  appel.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. L'état de chargement — un écran qui se tait n'est pas un écran vide
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Tableau de bord — chargement', () => {
  it('chaque section annonce son propre chargement, aucune ne reste muette', () => {
    feindre({});
    monter();

    expect(screen.getByText('Calcul de la prévision…')).toBeInTheDocument();
    expect(screen.getByText('Chargement des seuils…')).toBeInTheDocument();
    expect(screen.getByText('Chargement des sessions…')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Le registre d'erreur — le défaut du 31/07/2026, verrouillé
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Tableau de bord — un encart en erreur garde son titre et son cadre', () => {
  it('« Seuils légaux » en échec : le TITRE survit, et la couleur d’alerte métier n’apparaît pas', async () => {
    feindre({
      '/seuils': new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    monter();

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue du serveur (code HTTP 500).');
    // Le défaut mesuré le 31/07/2026 : l'encart disparaissait ENTIÈREMENT,
    // remplacé par un bandeau rouge nu — impossible de dire lequel était mort.
    expect(screen.getByRole('heading', { name: 'Seuils légaux' })).toBeInTheDocument();
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    expect(message.parentElement?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
  });

  it('« Dernières sessions » en échec : même traitement, même registre neutre', async () => {
    feindre({
      '/sessions': new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    monter();

    const message = await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: 'Dernières sessions' })).toBeInTheDocument();
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
  });

  it('« Prochaine session » en échec : le titre survit, sans couleur d’alerte métier', async () => {
    feindre({
      '/prevision': new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    monter();

    const message = await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: 'Prochaine session' })).toBeInTheDocument();
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
  });

  it('une clé de paramètre absente devient une phrase actionnable, pas un jargon', async () => {
    // `messageErreurAffichable` reconnaît TOUTE la classe
    // `ErreurParametreManquant` par son motif — le remède vaut pour les 99
    // clés du catalogue, jamais une liste écrite à la main.
    feindre({
      '/seuils': new ErreurApi(
        "Le paramètre « echeance_e604b_tolerance_cents » n'est pas défini. Renseignez-le dans Paramètres avant de continuer.",
        { code: 'parametre_manquant', statut: 500 },
      ),
    });
    monter();

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Lancez « npm run db:seed »');
    // La clé technique reste lisible, mais RELÉGUÉE — jamais la première
    // phrase lue (c'était le défaut du 31/07/2026).
    expect(message).toHaveTextContent('echeance_e604b_tolerance_cents');
    const premiereLigne = message.querySelector('p');
    expect(premiereLigne?.textContent ?? '').not.toContain('echeance_e604b_tolerance_cents');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. La prévision — trois refus, trois registres différents (D-082)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Tableau de bord — un fait normal n’est pas une panne', () => {
  it('aucune session planifiée : un état vide avec une ACTION, pas un encadré rouge', async () => {
    feindre({
      '/prevision': new ErreurApi(
        'Aucune session planifiée : créez-en une pour obtenir une prévision.',
        { code: 'aucune_session_planifiee', statut: 404 },
      ),
    });
    monter();

    expect(await screen.findByText('Aucune session à venir')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer une session' })).toBeInTheDocument();
    // Ni `role="alert"`, ni titre « Prochaine session » d'encart en erreur.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('premier passage sur un lieu (D-082) : informatif, et SANS action à faire', async () => {
    feindre({
      '/prevision': new ErreurApi(
        'Ce lieu n’a jamais été visité : la prévision demande au moins une session clôturée.',
        { code: 'premier_passage_lieu', statut: 422 },
      ),
    });
    monter();

    expect(
      await screen.findByText('Premier passage : aucune prévision possible'),
    ).toBeInTheDocument();
    // Rien ne se « fait » pour sortir de cet état : il suffit que la première
    // session sur ce lieu se clôture. Proposer une action mentirait.
    expect(screen.queryByRole('button', { name: 'Créer une session' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('une VRAIE panne, elle, produit bien l’encart en erreur — la fixture discrimine', async () => {
    feindre({
      '/prevision': new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Erreur inattendue du serveur (code HTTP 500).',
    );
    expect(screen.queryByText('Premier passage : aucune prévision possible')).toBeNull();
    expect(screen.queryByText('Aucune session à venir')).toBeNull();
  });

  it('une panne qui n’est même pas une ErreurApi reste lisible en français', async () => {
    feindre({ '/prevision': new TypeError('Failed to fetch') });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La prévision n’a pas pu être calculée.',
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Les seuils légaux — la ventilation qui décide de la franchise TVA
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Tableau de bord — les seuils légaux ne prétendent jamais avoir contrôlé', () => {
  it('aucun seuil paramétré : la section DISPARAÎT, elle n’affiche pas « rien à signaler »', async () => {
    feindre({ '/seuils': tableauSeuils([]) });
    monter();

    // Une configuration incomplète n'est pas une absence d'alerte : laisser un
    // panneau vert « aucun dépassement » ferait croire qu'un contrôle a eu lieu.
    // On attend une frontière observable pour éviter de conclure trop tôt.
    expect(await screen.findByText('Chargement des sessions…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Seuils légaux' })).toBeNull();
    expect(screen.queryByText('Chargement des seuils…')).toBeNull();
  });

  it('un seuil paramétré : la section apparaît, avec sa ventilation transformé / revendu', async () => {
    feindre({ '/seuils': tableauSeuils([seuil()]) });
    monter();

    expect(await screen.findByRole('heading', { name: 'Seuils légaux' })).toBeInTheDocument();
    expect(screen.getByText('Franchise TVA')).toBeInTheDocument();
    // CLAUDE.md §6 : les seuils portent sur le CA, pas sur la marge — sans la
    // ventilation, on se retrouve hors franchise TVA sans l'avoir vu venir.
    expect(texteBrutPresent(`Dont revente : ${formaterEuros(625000)}`)).toBe(true);
    expect(texteBrutPresent(formaterPourcent(2941))).toBe(true);
    expect(texteBrutPresent('sur 12 sessions en 2026')).toBe(true);
  });

  it('le détail des seuils est atteignable, et son intitulé de lien est explicite', async () => {
    feindre({ '/seuils': tableauSeuils([seuil()]) });
    monter();

    await screen.findByRole('heading', { name: 'Seuils légaux' });
    // Un « Voir le détail » nu ne dit pas de QUOI, pour un lecteur d'écran qui
    // parcourt la liste des liens hors contexte.
    expect(
      screen.getByRole('button', { name: 'Voir le détail des sessions et des seuils légaux' }),
    ).toBeInTheDocument();
  });

  it('une seule session tenue ne s’écrit pas « 1 sessions »', async () => {
    feindre({
      '/seuils': {
        data: [seuil()],
        meta: {
          annee: 2026,
          sessionsTenues: 1,
          caTransformeCents: 150000,
          caRevenduCents: 62500,
          partRevenduBp: 2941,
          seuilAlerteBp: 8000,
        },
      },
    });
    monter();

    await screen.findByRole('heading', { name: 'Seuils légaux' });
    expect(texteBrutPresent('sur 1 session en 2026')).toBe(true);
    expect(texteBrutPresent('sur 1 sessions')).toBe(false);
  });
});
