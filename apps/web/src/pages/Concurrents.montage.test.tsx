/**
 * Écran Concurrents — test MONTÉ, en complément de `Concurrents.test.tsx`.
 *
 * ═══ Ce que ce fichier ajoute, et qui n'existait pas ═══
 *
 * `Concurrents.test.tsx`, à côté, couvre DEUX fonctions pures exportées
 * (`resoudreEcartComparateur`, `erreursSaisieConcurrent`). Il reste valable et
 * n'est pas touché. Mais l'écran lui-même était à **0 % de lignes couvertes** :
 * ses TROIS chargements indépendants (liste, lieux, comparateur), son détail
 * chargé à la sélection, et le rendu du comparateur ne s'atteignent que par un
 * montage réel.
 *
 * ═══ La décision centrale de cet écran ═══
 *
 * Le comparateur est « le seul écran du module qui change une décision ». Or
 * `ecartBp` est `null` EXACTEMENT quand l'un des deux prix moyens l'est. Un
 * `?? 0` y ferait passer un prix INCONNU pour un prix NUL — et afficherait un
 * écart chiffré, donc actionnable, calculé sur du vide. `resoudreEcartComparateur`
 * est déjà testée en isolation ; ce qui ne l'était PAS, c'est que l'écran
 * l'utilise et rende bien le tiret d'absence à la place d'un montant.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TIRET_ABSENT,
  formaterDate,
  formaterEuros,
  formaterMontant,
  type Comparateur,
  type Concurrent,
} from '@batte/core';

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
const { default: Concurrents } = await import('./Concurrents');

const appel = vi.mocked(requeteApi);

/** Classe du registre d'alerte MÉTIER, celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function concurrent(partiel: Partial<Concurrent> = {}): Concurrent {
  return {
    id: 'conc-1',
    nom: 'Crêperie du Pont',
    lieuId: 'lieu-1',
    lieuNom: 'La Batte',
    typeOffre: 'crepes',
    positionnement: 'standard',
    emplacementObserve: 'Face au pont des Arches',
    qualitePercue: 4,
    dateDerniereObservation: '2026-07-26',
    notesGenerales: null,
    actif: true,
    creeLe: '2026-06-01T08:00:00.000Z',
    modifieLe: '2026-07-26T18:00:00.000Z',
    ...partiel,
  };
}

const LIEUX = {
  data: [
    {
      id: 'lieu-1',
      nom: 'La Batte',
      heureDebut: '08:00',
      heureFin: '14:30',
      tarifEmplacementCents: 2200,
    },
    {
      id: 'lieu-2',
      nom: 'Marché de Herstal',
      heureDebut: null,
      heureFin: null,
      tarifEmplacementCents: null,
    },
  ],
  meta: { total: 2 },
};

/** Comparateur COMPLET : les deux moyennes sont connues, l'écart est calculable. */
function comparateurComplet(partielMoyenne: Partial<Comparateur['moyenne']> = {}): Comparateur {
  return {
    notreCarte: [
      { produitVenteId: 'pv-1', nom: 'Crêpe sucre', nature: 'transforme', prixCents: 300 },
      { produitVenteId: 'pv-2', nom: 'Sirop de Liège', nature: 'revendu', prixCents: 650 },
    ],
    dernierPrixConcurrents: [
      {
        // Nom VOLONTAIREMENT distinct de ceux de la liste : deux tableaux
        // coexistent à l'écran, et un nom partagé rendrait toute requête par
        // texte ambiguë — le test viserait alors la mauvaise rangée sans le dire.
        concurrentId: 'conc-9',
        concurrentNom: 'Chez Momo',
        typeOffre: 'crepes',
        positionnement: 'standard',
        nomProduit: 'Crêpe nature',
        prixCents: 350,
        dateObservation: '2026-07-26',
      },
    ],
    moyenne: {
      notrePrixMoyenCrepeCents: 300,
      concurrentsPrixMoyenCents: 350,
      ecartBp: 1667,
      nbConcurrentsEquivalents: 2,
      ...partielMoyenne,
    },
  };
}

type ReponsesFeintes = {
  liste?: unknown;
  comparateur?: unknown;
  lieux?: unknown;
  detail?: unknown;
};

function feindre(reponses: ReponsesFeintes): void {
  appel.mockImplementation((chemin: string, options?: RequestInit) => {
    if (options?.method !== undefined && options.method !== 'GET') {
      return new Promise<never>(() => {});
    }
    const choisie = chemin.startsWith('/concurrents/comparateur')
      ? reponses.comparateur
      : chemin === '/lieux'
        ? reponses.lieux
        : chemin.startsWith('/concurrents/')
          ? reponses.detail
          : chemin.startsWith('/concurrents')
            ? reponses.liste
            : undefined;
    if (choisie === undefined) return new Promise<never>(() => {});
    if (choisie instanceof Error) return Promise.reject(choisie);
    return Promise.resolve(choisie as never);
  });
}

/**
 * Trouve l'élément dont le `textContent` vaut EXACTEMENT `attendu`.
 *
 * `formaterEuros` place une espace INSÉCABLE avant le « € », que le
 * normaliseur par défaut de `@testing-library` remplace par une espace
 * ordinaire avant comparaison : la valeur formatée ne correspondrait donc
 * jamais à elle-même via `getByText`. On compare toujours au FORMATEUR, mais
 * sur le texte brut.
 */
function parTexteExact(attendu: string): HTMLElement[] {
  return Array.from(document.querySelectorAll('p, span, td')).filter(
    (n) => n.textContent === attendu,
  ) as HTMLElement[];
}

function listeConcurrents(concurrents: Concurrent[]): unknown {
  return { data: concurrents, meta: { total: concurrents.length } };
}

function detailDe(c: Concurrent): unknown {
  return { ...c, produits: [], observations: [], dernierPrixParProduit: [] };
}

beforeEach(() => {
  appel.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Les trois états, sur trois chargements indépendants
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Concurrents — chargement, erreur, vide', () => {
  it('les deux panneaux annoncent leur chargement plutôt que de rester muets', () => {
    feindre({});
    render(<Concurrents />);

    expect(screen.getByText('Calcul en cours…')).toBeInTheDocument();
    expect(screen.getByText('Chargement des concurrents…')).toBeInTheDocument();
  });

  it('un échec de la LISTE affiche le message du serveur, SANS la couleur d’alerte métier', async () => {
    feindre({
      liste: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
    });
    render(<Concurrents />);

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue du serveur (code HTTP 500).');
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    expect(message.parentElement?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
    // Le comparateur, lui, a répondu : les chargements sont indépendants.
    expect(screen.getByText('Crêpe sucre')).toBeInTheDocument();
  });

  it('un échec du COMPARATEUR n’emporte pas la liste', async () => {
    feindre({
      liste: listeConcurrents([concurrent()]),
      comparateur: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
      lieux: LIEUX,
    });
    render(<Concurrents />);

    await screen.findByRole('alert');
    expect(screen.getByText('Crêperie du Pont')).toBeInTheDocument();
  });

  it('liste vide : une phrase et une action, jamais un cadre nu', async () => {
    feindre({
      liste: listeConcurrents([]),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
    });
    render(<Concurrents />);

    expect(await screen.findByText('Aucun concurrent enregistré')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer un concurrent' })).toBeInTheDocument();
  });

  it('tous désactivés : l’état vide nomme LE filtre, et sa réinitialisation les ramène', async () => {
    const inactifs = [
      concurrent({ id: 'conc-1', actif: false }),
      concurrent({ id: 'conc-2', nom: 'Gaufres de Marie', actif: false }),
    ];
    feindre({
      liste: listeConcurrents(inactifs),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
    });
    render(<Concurrents />);

    expect(
      await screen.findByText(
        'Tous les concurrents enregistrés (2) sont désactivés et masqués par le filtre.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Aucun concurrent enregistré')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser le filtre' }));
    expect(screen.getByText('Gaufres de Marie')).toBeInTheDocument();
  });

  it('un comparateur sans carte ni relevé rend deux états vides DISTINCTS', async () => {
    feindre({
      liste: listeConcurrents([]),
      comparateur: {
        notreCarte: [],
        dernierPrixConcurrents: [],
        moyenne: {
          notrePrixMoyenCrepeCents: null,
          concurrentsPrixMoyenCents: null,
          ecartBp: null,
          nbConcurrentsEquivalents: 0,
        },
      },
      lieux: LIEUX,
    });
    render(<Concurrents />);

    expect(await screen.findByText('Aucun produit actif en carte.')).toBeInTheDocument();
    expect(
      screen.getByText("Aucun prix relevé chez un concurrent équivalent pour l'instant."),
    ).toBeInTheDocument();
  });

  it('un échec du chargement des LIEUX laisse le filtre sur « Tous les lieux »', async () => {
    feindre({
      liste: listeConcurrents([concurrent()]),
      comparateur: comparateurComplet(),
      lieux: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<Concurrents />);

    await screen.findByText('Crêperie du Pont');
    // DEUX contrôles portent le libellé « Lieu » (le filtre de liste et le
    // champ de la fiche) : on vise l'identifiant explicite du filtre, sinon la
    // requête est ambiguë et le test viserait l'un pour l'autre.
    const filtre = document.getElementById('filtre-lieu') as HTMLSelectElement;
    expect(Array.from(filtre.options).map((o) => o.textContent)).toEqual(['Tous les lieux']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Le comparateur — inconnu ≠ zéro, décision par décision
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Concurrents — un prix moyen inconnu ne se lit jamais comme un prix nul', () => {
  function monter(moyenne: Partial<Comparateur['moyenne']>): void {
    feindre({
      liste: listeConcurrents([concurrent()]),
      comparateur: comparateurComplet(moyenne),
      lieux: LIEUX,
    });
    render(<Concurrents />);
  }

  it('NOTRE prix moyen inconnu : tiret partout, et une phrase qui dit ce qui manque', async () => {
    monter({ notrePrixMoyenCrepeCents: null, ecartBp: null });

    expect(
      await screen.findByText(
        'Comparaison indisponible : il manque un prix de notre côté ou chez les concurrents équivalents.',
      ),
    ).toBeInTheDocument();
    // Aucun montant à zéro n'apparaît là où un prix moyen est attendu.
    expect(parTexteExact(formaterEuros(0))).toHaveLength(0);
    // Le prix moyen des concurrents, lui, reste affiché — la fixture discrimine.
    expect(parTexteExact(formaterEuros(350)).length).toBeGreaterThan(0);
  });

  it('le prix moyen des CONCURRENTS inconnu produit le même refus de calculer', async () => {
    monter({ concurrentsPrixMoyenCents: null, ecartBp: null });

    expect(
      await screen.findByText(
        'Comparaison indisponible : il manque un prix de notre côté ou chez les concurrents équivalents.',
      ),
    ).toBeInTheDocument();
    expect(parTexteExact(formaterEuros(300)).length).toBeGreaterThan(0);
    expect(parTexteExact(formaterEuros(0))).toHaveLength(0);
  });

  it('l’écart inconnu est rendu NEUTRE, ni « plus chers » ni « moins chers »', async () => {
    monter({ notrePrixMoyenCrepeCents: null, ecartBp: null });

    // On localise l'écart par SON intitulé : les deux moyennes rendent elles
    // aussi un tiret, dans la même taille. Chercher « le premier gros tiret »
    // aurait visé la moyenne et le test aurait parlé d'autre chose.
    const bloc = (await screen.findByText('Écart')).parentElement as HTMLElement;
    const ecart = within(bloc).getByText(TIRET_ABSENT);
    // Une inconnue n'est pas un jugement : ni couleur d'alerte, ni conforme.
    expect(ecart.className).toContain('text-ink-3');
    expect(ecart.className).not.toContain('text-alerte');
    expect(ecart.className).not.toContain('text-conforme');
  });

  it('les deux prix connus : l’écart est chiffré, signé, et commenté', async () => {
    monter({});

    // Concurrents plus chers que nous : écart POSITIF, registre conforme.
    const ecart = await screen.findByText('+0,50');
    expect(ecart.className).toContain('text-conforme');
    expect(
      screen.getByText(
        'Nous sommes moins chers que, ou alignés sur, la moyenne des concurrents équivalents.',
      ),
    ).toBeInTheDocument();
  });

  it('nous plus chers qu’eux : l’écart bascule au registre d’ALERTE', async () => {
    monter({ notrePrixMoyenCrepeCents: 400, concurrentsPrixMoyenCents: 350, ecartBp: -1250 });

    const ecart = await screen.findByText('−0,50');
    expect(ecart.className).toContain('text-alerte');
    expect(
      screen.getByText('Nous sommes plus chers que la moyenne des concurrents équivalents.'),
    ).toBeInTheDocument();
  });

  it('les prix des tableaux passent par le FORMATEUR, jamais par un littéral', async () => {
    monter({});

    await screen.findByText('Crêpe sucre');
    // `formaterMontant` pose une virgule décimale et deux décimales constantes :
    // « 3,00 » et non « 3 ». Comparé au formateur, jamais tapé à la main.
    expect(screen.getAllByText(formaterMontant(300)).length).toBeGreaterThan(0);
    expect(screen.getByText(formaterMontant(650))).toBeInTheDocument();
    expect(screen.getByText(formaterDate('2026-07-26'))).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Sélection, détail, clavier
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Concurrents — sélectionner une fiche, au clavier', () => {
  const DEUX = [
    concurrent(),
    concurrent({
      id: 'conc-2',
      nom: 'Gaufres de Marie',
      typeOffre: 'gaufres',
      positionnement: 'premium',
      qualitePercue: 2,
      // Jamais observé : la date doit se rendre en tiret, pas en date du jour.
      dateDerniereObservation: null,
      emplacementObserve: null,
    }),
  ];

  it('une seule rangée est dans l’ordre de tabulation — « roving tabindex »', async () => {
    feindre({
      liste: listeConcurrents(DEUX),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
    });
    render(<Concurrents />);

    await screen.findByText('Crêperie du Pont');
    const rangees = screen.getAllByRole('row').filter((r) => r.hasAttribute('tabindex'));
    expect(rangees.filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('Entrée sélectionne la ligne et déclenche le chargement du détail', async () => {
    feindre({
      liste: listeConcurrents(DEUX),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
      detail: detailDe(DEUX[1] as Concurrent),
    });
    render(<Concurrents />);

    await screen.findByText('Gaufres de Marie');
    const rangee = screen.getByText('Gaufres de Marie').closest('tr') as HTMLTableRowElement;
    rangee.focus();
    await userEvent.keyboard('{Enter}');

    expect(rangee).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByDisplayValue('Gaufres de Marie')).toBeInTheDocument();
  });

  it('un détail en échec est signalé sans emprunter la couleur d’alerte métier', async () => {
    feindre({
      liste: listeConcurrents(DEUX),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
      detail: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<Concurrents />);

    await screen.findByText('Crêperie du Pont');
    await userEvent.click(screen.getByText('Crêperie du Pont'));

    const message = await screen.findByRole('alert');
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
  });

  it('Ctrl+S enregistre au clavier et porte le focus sur le premier champ fautif', async () => {
    feindre({
      liste: listeConcurrents(DEUX),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
    });
    render(<Concurrents />);

    await screen.findByText('Crêperie du Pont');
    const qualite = document.querySelector('[name="qualitePercue"]') as HTMLElement;
    qualite.focus();
    expect(document.activeElement).toBe(qualite);

    const appelsAvant = appel.mock.calls.length;
    await userEvent.keyboard('{Control>}s{/Control}');

    // Fiche vierge : le refus est LOCAL (`erreursSaisieConcurrent`) et le focus
    // va au PREMIER champ fautif dans l'ordre de cette fonction — `lieuId`, et
    // non `nom`. `nom` est gardé par le `required` HTML, que Ctrl+S contourne
    // par construction : c'est bien `lieuId` que l'écran doit désigner ici.
    expect(document.activeElement).toHaveAttribute('name', 'lieuId');
    expect(
      screen.getByText('Choisissez le lieu où ce concurrent est observé.'),
    ).toBeInTheDocument();
    expect(appel.mock.calls.length).toBe(appelsAvant);
  });

  it('la qualité perçue est présentée comme SUBJECTIVE, pas comme une mesure', async () => {
    feindre({
      liste: listeConcurrents(DEUX),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
    });
    render(<Concurrents />);

    const rangee = (await screen.findByText('Crêperie du Pont')).closest(
      'tr',
    ) as HTMLTableRowElement;
    // Fiche 08 : « un chiffre présenté sans elle se lit comme une mesure ».
    // L'écran rend donc des étoiles, jamais un « 4 » nu dans la colonne.
    const cellules = Array.from(rangee.querySelectorAll('td')).map((c) => c.textContent ?? '');
    expect(cellules.some((t) => t.includes('★'))).toBe(true);
    expect(cellules).not.toContain('4');

    // Le second concurrent en a moins : la fixture discrimine deux niveaux.
    const autre = screen.getByText('Gaufres de Marie').closest('tr') as HTMLTableRowElement;
    const etoilesAutre = (within(autre).getByText(/★/).textContent ?? '').split('★').length - 1;
    const etoilesPremier = (within(rangee).getByText(/★/).textContent ?? '').split('★').length - 1;
    expect(etoilesAutre).toBeLessThan(etoilesPremier);
  });

  it('le filtre par lieu relance la liste ET le comparateur, pas seulement l’une des deux', async () => {
    const chemins: string[] = [];
    appel.mockImplementation((chemin: string) => {
      chemins.push(chemin);
      if (chemin.startsWith('/concurrents/comparateur')) {
        return Promise.resolve(comparateurComplet() as never);
      }
      if (chemin === '/lieux') return Promise.resolve(LIEUX as never);
      return Promise.resolve(listeConcurrents([concurrent()]) as never);
    });
    render(<Concurrents />);

    await screen.findByText('Crêperie du Pont');
    chemins.length = 0;
    await userEvent.selectOptions(
      document.getElementById('filtre-lieu') as HTMLSelectElement,
      'lieu-2',
    );

    // Un comparateur qui resterait sur « tous les lieux » pendant que la liste
    // filtre serait une comparaison entre deux périmètres différents.
    expect(chemins).toContain('/concurrents?lieuId=lieu-2');
    expect(chemins).toContain('/concurrents/comparateur?lieuId=lieu-2');
  });

  it('la limite du module est écrite à l’écran, pas seulement dans le code', async () => {
    feindre({
      liste: listeConcurrents([concurrent()]),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
    });
    render(<Concurrents />);

    expect(
      await screen.findByText(/Aucun chiffre de cet écran n'entre dans le calcul/),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Attente d'écriture — promesse CONTRÔLÉE (docs/39 §3, cinquième forme)

   `feindre()` retourne, par défaut, une promesse qui ne se résout JAMAIS pour
   toute écriture (`options?.method !== 'GET'`) : parfait pour observer l'état
   EN VOL, mais aucun test ci-dessus ne la libère pour observer le RETOUR à
   l'état actionnable. Les trois blocs suivants couvrent les TROIS phases
   `EtatEnregistrement` de cet écran (fiche, produit, observation), avec une
   promesse que le test résout lui-même — le seul moyen de voir les DEUX
   bouts : l'annonce ET le retour.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Concurrents — attente d’écriture : la FICHE l’annonce, puis redevient actionnable', () => {
  it(
    'pendant le PATCH, « Enregistrer » est `disabled` ET l’indicateur dit « Enregistrement… », ' +
      'puis les deux redeviennent normaux',
    async () => {
      feindre({
        liste: listeConcurrents([concurrent()]),
        comparateur: comparateurComplet(),
        lieux: LIEUX,
        detail: detailDe(concurrent()),
      });
      render(<Concurrents />);
      await screen.findByText('Crêperie du Pont');
      await userEvent.click(screen.getByText('Crêperie du Pont'));

      let repondre: ((valeur: unknown) => void) | undefined;
      appel.mockImplementation((chemin: string, options?: RequestInit) => {
        if (chemin === '/concurrents/conc-1' && options?.method === 'PATCH') {
          return new Promise((resoudre) => {
            repondre = resoudre;
          });
        }
        // Le reste (rechargements de liste/comparateur/détail après succès)
        // n'est pas ce que ce test observe : une promesse jamais résolue leur
        // suffit, exactement le comportement par défaut de `feindre()`.
        return new Promise<never>(() => {});
      });

      await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      // 1. L'attente est ANNONCÉE : le bouton s'inertise, l'indicateur le confirme.
      const bouton = screen.getByRole('button', { name: 'Enregistrer' });
      expect(bouton).toBeDisabled();
      expect(screen.getByText('Enregistrement…')).toBeInTheDocument();
      /*
        2. Un second clic ou une Entrée sur CE bouton ne prouveraient rien :
        `disabled` natif, bloqué par le navigateur lui-même. Le chemin qui
        contourne RÉELLEMENT ce bouton est Ctrl+S — voir le test (ex-`it.fails`)
        ci-dessous, qui montre qu'aucun garde-fou interne ne le bloque, lui.
      */

      repondre?.(concurrent());

      // 3. Après la réponse, le contrôle redevient actionnable ET l'indicateur le dit.
      await screen.findByText(/^Enregistré /);
      expect(screen.getByRole('button', { name: 'Enregistrer' })).not.toBeDisabled();
    },
  );
});

describe('Concurrents — attente d’écriture : PRODUIT et OBSERVATION l’annoncent, puis redeviennent actionnables', () => {
  it('« Ajouter » (produit observé) s’inertise pendant le POST, puis redevient actionnable et vide le formulaire', async () => {
    feindre({
      liste: listeConcurrents([concurrent()]),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
      detail: detailDe(concurrent()),
    });
    render(<Concurrents />);
    await screen.findByText('Crêperie du Pont');
    await userEvent.click(screen.getByText('Crêperie du Pont'));
    const nomProduit = await screen.findByLabelText('Nom du produit');

    let repondre: ((valeur: unknown) => void) | undefined;
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      if (chemin === '/concurrents/conc-1/produits' && options?.method === 'POST') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return new Promise<never>(() => {});
    });

    await userEvent.type(nomProduit, 'Crêpe Nutella');
    await userEvent.type(screen.getByLabelText('Prix (€)'), '4,50');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    // 1. L'attente est ANNONCÉE.
    const bouton = screen.getByRole('button', { name: 'Ajouter' });
    expect(bouton).toBeDisabled();
    /*
      2. Un second clic ou une Entrée ne prouveraient rien : `disabled` natif,
      bloqué par le navigateur. Ce sous-formulaire n'a pas de raccourci
      clavier qui le contourne.
    */

    repondre?.({});

    // 3. Au succès, `reinitialiserFormulaireProduit()` vide les champs ET le
    // bouton redevient actionnable — les deux ensemble prouvent le retour à
    // l'état de départ, pas seulement l'un des deux.
    await vi.waitFor(() => expect(screen.getByLabelText('Nom du produit')).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Ajouter' })).not.toBeDisabled();
  });

  it('« Enregistrer la visite » (observation) s’inertise pendant le POST, puis redevient actionnable et vide les notes', async () => {
    feindre({
      liste: listeConcurrents([concurrent()]),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
      detail: detailDe(concurrent()),
    });
    render(<Concurrents />);
    await screen.findByText('Crêperie du Pont');
    await userEvent.click(screen.getByText('Crêperie du Pont'));
    const notes = await screen.findByLabelText(/Notes \(ce que vous avez goûté/);

    let repondre: ((valeur: unknown) => void) | undefined;
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      if (chemin === '/concurrents/conc-1/observations' && options?.method === 'POST') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return new Promise<never>(() => {});
    });

    await userEvent.type(notes, 'File jusqu’au pont, forte affluence.');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la visite' }));

    const bouton = screen.getByRole('button', { name: 'Enregistrer la visite' });
    expect(bouton).toBeDisabled();

    repondre?.({});

    await vi.waitFor(() =>
      expect(screen.getByLabelText(/Notes \(ce que vous avez goûté/)).toHaveValue(''),
    );
    expect(screen.getByRole('button', { name: 'Enregistrer la visite' })).not.toBeDisabled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Défaut RÉEL trouvé en lisant la production — corrigé le 28/09/2026
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Concurrents — défaut RÉEL : Ctrl+S contourne le `disabled` de la fiche, garde-fou interne ajouté le 28/09/2026', () => {
  /**
   * `it.fails` (docs/39 §8), même famille que le défaut jumeau démontré dans
   * `Ingredients.montage.test.tsx`. `enregistrerFiche()` (`Concurrents.tsx`)
   * ne porte AUCUN garde du type `if (enregistrement.phase ===
   * 'enregistrement') return;` en tête de fonction. Seul le `disabled` natif
   * du bouton « Enregistrer » empêche un second clic ou une seconde
   * soumission par Entrée. Mais Ctrl+S appelle `enregistrerFiche()`
   * DIRECTEMENT depuis le conteneur englobant (`onKeyDown` en tête de
   * l'écran), sans passer par ce bouton : un second Ctrl+S pendant
   * l'aller-retour envoie donc une SECONDE écriture PATCH sur le même
   * concurrent. Trouvé en lisant la production le 02/08/2026 ; CORRIGÉ le
   * 28/09/2026 par une garde en tête de `enregistrerFiche()`. Le test, en
   * `it.fails` jusque-là, est devenu un test ordinaire.
   */
  it('un second Ctrl+S PENDANT l’enregistrement de la fiche ne devrait PAS déclencher une seconde écriture', async () => {
    feindre({
      liste: listeConcurrents([concurrent()]),
      comparateur: comparateurComplet(),
      lieux: LIEUX,
      detail: detailDe(concurrent()),
    });
    render(<Concurrents />);
    await screen.findByText('Crêperie du Pont');
    await userEvent.click(screen.getByText('Crêperie du Pont'));

    const resolveurs: Array<(valeur: unknown) => void> = [];
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      if (chemin === '/concurrents/conc-1' && options?.method === 'PATCH') {
        return new Promise((resoudre) => resolveurs.push(resoudre));
      }
      return new Promise<never>(() => {});
    });

    const qualite = document.querySelector('[name="qualitePercue"]') as HTMLElement;
    qualite.focus();
    await userEvent.keyboard('{Control>}s{/Control}');
    // PENDANT l'aller-retour : le bouton est déjà inerte…
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

    try {
      // …mais Ctrl+S, LUI, ne passe pas par ce bouton.
      await userEvent.keyboard('{Control>}s{/Control}');

      expect(
        appel.mock.calls.filter(
          ([c, o]) =>
            c === '/concurrents/conc-1' && (o as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toHaveLength(1);
    } finally {
      resolveurs.forEach((resoudre) => resoudre(concurrent()));
    }
  });
});
