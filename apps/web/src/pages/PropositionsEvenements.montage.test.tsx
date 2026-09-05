/**
 * Écran Propositions d'événements (IA) — premier test MONTÉ de cet écran.
 *
 * ═══ Pourquoi ce fichier existe ═══
 *
 * `PropositionsEvenements.tsx` était à **0 % de couverture** au 01/08/2026.
 * DEUX chargements indépendants, cinq états de recherche, un ajustement local
 * par ligne, et une validation qui recharge la liste : rien de tout cela n'est
 * atteignable sans montage réel.
 *
 * ═══ Ce que cet écran doit dire honnêtement ═══
 *
 * 1. **La distance est à vol d'oiseau**, jamais routière (fiche 05). La mention
 *    « à vol d'oiseau » n'est pas un ornement : c'est l'avertissement qui
 *    interdit de lire ce chiffre comme un trajet. Elle ne doit donc jamais
 *    disparaître derrière une ellipse — et une distance inconnue vaut « — »,
 *    jamais 0 km.
 * 2. **Le mode dégradé est dans le contrat** : plafond IA atteint ou clé
 *    absente n'est PAS une erreur, c'est une indisponibilité annoncée
 *    (CLAUDE.md §5). Elle se lit dans un registre neutre, pas en rouge.
 *
 * ═══ Sur les fixtures ═══
 *
 * Chaque jeu porte une proposition COMPLÈTE et une proposition LACUNAIRE (sans
 * lieu, sans distance, sans source). Une liste dont tous les champs sont
 * renseignés ne prouverait rien sur l'affichage d'un champ absent.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DOMAINE_RAYON_RECHERCHE_KM,
  formaterEuros,
  type LieuPourRechercheEvenements,
  type PropositionEvenement,
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
const { default: PropositionsEvenements } = await import('./PropositionsEvenements');

const appel = vi.mocked(requeteApi);

/** Classe du registre d'alerte MÉTIER, celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function proposition(partiel: Partial<PropositionEvenement> = {}): PropositionEvenement {
  return {
    id: 'prop-1',
    nom: 'Marché de Noël de Verviers',
    type: 'festival',
    dateDebut: '2026-12-05',
    dateFin: '2026-12-24',
    portee: 'liege',
    intensiteEstimee: 3,
    impactEstimeBp: 12000,
    impactMesureBp: null,
    source: 'https://verviers.be/marche-de-noel',
    valideParHumain: false,
    notes: null,
    lieuId: 'lieu-1',
    lieuNom: 'La Batte',
    rayonRechercheKm: 40,
    distanceKm: 27.35,
    communeTexte: 'Verviers',
    rentabiliteEstimeeCents: 18400,
    famille: null,
    effectifEstime: null,
    ...partiel,
  };
}

const COMPLETE = proposition();
/** Tout ce que le serveur peut légitimement rendre à `null`, réuni sur une ligne. */
const LACUNAIRE = proposition({
  id: 'prop-2',
  nom: 'Fête médiévale de Franchimont',
  lieuId: null,
  lieuNom: null,
  rayonRechercheKm: null,
  distanceKm: null,
  communeTexte: null,
  source: null,
  // Rentabilité NÉGATIVE : le second cas de couleur, sans lequel le test ne
  // pourrait pas montrer que l'écran distingue un gain d'une perte.
  rentabiliteEstimeeCents: -4200,
});

const LIEUX: LieuPourRechercheEvenements[] = [
  { id: 'lieu-1', nom: 'La Batte', rayonRechercheEvenementsKm: 40 },
  { id: 'lieu-2', nom: 'Marché de Herstal', rayonRechercheEvenementsKm: 10 },
];

type ReponsesFeintes = {
  lieux?: unknown;
  propositions?: unknown;
  /** Réponses des écritures (PATCH/POST), servies dans l'ordre d'appel. */
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
      chemin === '/evenements-decouverte/lieux'
        ? reponses.lieux
        : chemin === '/evenements-decouverte/propositions'
          ? reponses.propositions
          : undefined;
    if (choisie === undefined) return new Promise<never>(() => {});
    if (choisie instanceof Error) return Promise.reject(choisie);
    return Promise.resolve(choisie as never);
  });
}

function listePropositions(propositions: PropositionEvenement[]): unknown {
  return { data: propositions, meta: { total: propositions.length } };
}

beforeEach(() => {
  appel.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Les trois états d'un écran de lecture
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Propositions d’événements — chargement, erreur, vide', () => {
  it('annonce le chargement plutôt que de laisser la page muette', () => {
    feindre({});
    render(<PropositionsEvenements />);

    expect(screen.getByText('Chargement des propositions…')).toBeInTheDocument();
  });

  it('un échec de la liste affiche le message du serveur, SANS la couleur d’alerte métier', async () => {
    feindre({
      lieux: { data: LIEUX },
      propositions: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<PropositionsEvenements />);

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue du serveur (code HTTP 500).');
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    expect(message.parentElement?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
  });

  it('liste vide : une phrase qui dit par où commencer, jamais un tableau nu', async () => {
    feindre({ lieux: { data: LIEUX }, propositions: listePropositions([]) });
    render(<PropositionsEvenements />);

    expect(await screen.findByText('Aucune proposition en attente')).toBeInTheDocument();
    expect(screen.getByText(/Cherchez des événements pour un lieu ci-dessus/)).toBeInTheDocument();
  });

  it('le panneau de recherche reste utilisable même quand la LISTE échoue', async () => {
    feindre({
      lieux: { data: LIEUX },
      propositions: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<PropositionsEvenements />);

    await screen.findByRole('alert');
    // Le sélecteur de lieu a bien répondu de son côté : mode dégradé, pas
    // écran mort.
    expect(await screen.findByRole('option', { name: 'La Batte' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chercher des événements' })).toBeEnabled();
  });

  it('sans aucun lieu, la recherche est désactivée plutôt que de partir dans le vide', async () => {
    feindre({ lieux: { data: [] }, propositions: listePropositions([]) });
    render(<PropositionsEvenements />);

    expect(await screen.findByRole('option', { name: 'Aucun lieu actif' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chercher des événements' })).toBeDisabled();
    expect(screen.getByLabelText('Rayon de recherche')).toBeDisabled();
  });

  /**
   * DÉFAUT RÉEL trouvé le 01/08/2026, corrigé le même jour — le test est
   * devenu ordinaire (il était en `it.fails` le temps que le correctif
   * atteigne sa zone d'écriture).
   *
   * `chargerLieux` échoue pour des raisons purement TECHNIQUES : le serveur
   * n'a pas répondu, ou a rendu un 500. Le porteur n'a AUCUN geste à faire.
   * Pourtant `erreurLieux` était rendu en `text-depassement`
   * (`PropositionsEvenements.tsx`, ~ligne 610) — la couleur du registre
   * d'alerte MÉTIER, celle d'une rupture de stock ou d'un seuil légal franchi.
   *
   * Ce qui prouvait que c'était un oubli et non une décision : le MÊME
   * fichier, trente lignes plus bas, rendait déjà l'échec de chargement de la
   * LISTE via `MessageErreur`, en registre neutre. Deux pannes de même nature,
   * deux registres, dans un seul écran.
   *
   * `erreurLieux` passe désormais par `MessageErreur`, dont le `<div
   * role="alert">` ne porte aucune classe de registre métier.
   *
   * jsdom n'applique AUCUNE feuille de style : ce test prouve quelle CLASSE
   * est posée — c'est là qu'est la décision — pas la couleur effectivement
   * peinte à l'écran.
   */
  it('un échec de chargement des LIEUX reste dans le registre technique, jamais en alerte métier', async () => {
    feindre({
      lieux: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
      propositions: listePropositions([]),
    });
    render(<PropositionsEvenements />);

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue du serveur (code HTTP 500).');
    expect(message.className).not.toContain('text-depassement');
    // `alerte` est l'AUTRE couleur du registre métier : la vérifier aussi
    // évite qu'un correctif se contente de glisser d'un ton métier à l'autre.
    expect(message.className).not.toContain('text-alerte');
  });

  it('mais l’échec des lieux est bien DIT — un « Aucun lieu actif » muet mentirait', async () => {
    feindre({
      lieux: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
      propositions: listePropositions([]),
    });
    render(<PropositionsEvenements />);

    // Sans ce message, « Aucun lieu actif » se lirait comme une vraie liste
    // vide alors que l'appel réseau a simplement échoué (CLAUDE.md §4 :
    // jamais d'échec invisible).
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Erreur inattendue du serveur (code HTTP 500).',
    );
    expect(screen.getByRole('option', { name: 'Aucun lieu actif' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Inconnu ≠ zéro, et la distance nommée honnêtement
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Propositions d’événements — ce qui manque s’affiche comme manquant', () => {
  function monterAvecLesDeux(): void {
    feindre({
      lieux: { data: LIEUX },
      propositions: listePropositions([COMPLETE, LACUNAIRE]),
    });
    render(<PropositionsEvenements />);
  }

  it('une distance inconnue rend le tiret, jamais « ≈ 0 km »', async () => {
    monterAvecLesDeux();

    const rangee = (await screen.findByText('Fête médiévale de Franchimont')).closest(
      'tr',
    ) as HTMLTableRowElement;
    expect(rangee.textContent ?? '').not.toContain('0 km');
    expect(rangee.textContent ?? '').not.toContain('vol d’oiseau');
  });

  it('une distance connue est TOUJOURS qualifiée « à vol d’oiseau » — jamais un trajet', async () => {
    monterAvecLesDeux();

    const rangee = (await screen.findByText('Marché de Noël de Verviers')).closest(
      'tr',
    ) as HTMLTableRowElement;
    // La mention fait partie de la VALEUR, pas d'une infobulle : la fiche 05
    // interdit de laisser croire à une distance routière.
    expect(within(rangee).getByText(/≈ 27,4 km à vol d’oiseau/)).toBeInTheDocument();
  });

  it('un lieu et une source absents rendent le tiret, jamais une chaîne vide', async () => {
    monterAvecLesDeux();

    const rangee = (await screen.findByText('Fête médiévale de Franchimont')).closest(
      'tr',
    ) as HTMLTableRowElement;
    // Trois tirets attendus sur cette ligne : lieu, distance, source. L'effectif
    // en porte un quatrième (la famille n'est pas « entreprise »).
    expect(within(rangee).getAllByText('—').length).toBeGreaterThanOrEqual(3);

    // La ligne complète, elle, les affiche : la fixture discrimine.
    const complete = screen
      .getByText('Marché de Noël de Verviers')
      .closest('tr') as HTMLTableRowElement;
    expect(within(complete).getByText('La Batte')).toBeInTheDocument();
    expect(within(complete).getByText('https://verviers.be/marche-de-noel')).toBeInTheDocument();
  });

  it('une rentabilité positive se lit en conforme, une négative en dépassement', async () => {
    monterAvecLesDeux();

    /**
     * On lit `textContent` BRUT, sans passer par `getByText`.
     *
     * `formaterEuros` met une espace INSÉCABLE (U+00A0) avant le « € », et le
     * normaliseur par défaut de `@testing-library` la remplace par une espace
     * ordinaire avant de comparer : la valeur formatée ne correspondrait donc
     * jamais à elle-même. La leçon reste la même — on ne compare jamais à un
     * littéral tapé à la main, on compare au FORMATEUR.
     */
    function spanDeTexte(rangee: HTMLElement, attendu: string): HTMLElement {
      const trouve = Array.from(rangee.querySelectorAll('span')).find(
        (s) => s.textContent === attendu,
      );
      expect(trouve, `aucune cellule ne porte exactement « ${attendu} »`).toBeDefined();
      return trouve as HTMLElement;
    }

    const gagnante = (await screen.findByText('Marché de Noël de Verviers')).closest(
      'tr',
    ) as HTMLElement;
    expect(spanDeTexte(gagnante, `+${formaterEuros(18400)}`).className).toContain('text-conforme');

    const perdante = screen.getByText('Fête médiévale de Franchimont').closest('tr') as HTMLElement;
    expect(spanDeTexte(perdante, `−${formaterEuros(4200)}`).className).toContain(
      'text-depassement',
    );
  });

  it('l’effectif ne se saisit QUE pour une opportunité « entreprise »', async () => {
    monterAvecLesDeux();

    await screen.findByText('Marché de Noël de Verviers');
    // Famille `null` par défaut : pas de champ d'effectif, un tiret.
    expect(
      screen.queryByLabelText('Effectif estimé pour « Marché de Noël de Verviers »'),
    ).toBeNull();

    await userEvent.selectOptions(
      screen.getByLabelText('Famille d’opportunité de « Marché de Noël de Verviers »'),
      'entreprise',
    );

    expect(
      screen.getByLabelText('Effectif estimé pour « Marché de Noël de Verviers »'),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Les garde-fous de la fiche 05 / 14, toujours affichés
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Propositions d’événements — les avertissements ne se perdent pas', () => {
  it('le rayon n’est PAS un filtre administratif, et l’écran le dit', async () => {
    feindre({ lieux: { data: LIEUX }, propositions: listePropositions([]) });
    render(<PropositionsEvenements />);

    expect(
      await screen.findByText(/un rayon de 100 km autour de Liège atteint aussi Maastricht/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Déclenchement manuel : ce projet n’a pas de tâche planifiée automatique/),
    ).toBeInTheDocument();
  });

  it('la distinction opportunité / facteur classique est expliquée avant la saisie', async () => {
    feindre({ lieux: { data: LIEUX }, propositions: listePropositions([]) });
    render(<PropositionsEvenements />);

    expect(
      await screen.findByText(/ne dopent pas La Batte : ce sont des sessions à part/),
    ).toBeInTheDocument();
  });

  it('le domaine de rayons proposé est celui de `@batte/core`, jamais une liste recopiée', async () => {
    feindre({ lieux: { data: LIEUX }, propositions: listePropositions([]) });
    render(<PropositionsEvenements />);

    const selecteur = (await screen.findByLabelText('Rayon de recherche')) as HTMLSelectElement;
    expect(Array.from(selecteur.options).map((o) => o.value)).toEqual(
      DOMAINE_RAYON_RECHERCHE_KM.map(String),
    );
    // Et il est positionné sur le rayon DU LIEU sélectionné, pas sur un défaut.
    expect(selecteur.value).toBe('40');
  });

  it('changer de lieu change le rayon affiché — sinon le réglage mentirait', async () => {
    feindre({ lieux: { data: LIEUX }, propositions: listePropositions([]) });
    render(<PropositionsEvenements />);

    const selecteurRayon = (await screen.findByLabelText(
      'Rayon de recherche',
    )) as HTMLSelectElement;
    expect(selecteurRayon.value).toBe('40');

    await userEvent.selectOptions(screen.getByLabelText('Lieu'), 'lieu-2');
    expect(selecteurRayon.value).toBe('10');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. La recherche — et son mode dégradé, qui n'est pas une panne
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Propositions d’événements — le mode dégradé n’est pas une erreur', () => {
  it('une indisponibilité annoncée se lit en registre NEUTRE, pas en rouge', async () => {
    feindre({
      lieux: { data: LIEUX },
      propositions: listePropositions([]),
      ecritures: [
        {
          disponible: false,
          raison: 'Plafond mensuel d’appels IA atteint : la recherche reprendra le mois prochain.',
        },
      ],
    });
    render(<PropositionsEvenements />);

    await screen.findByRole('option', { name: 'La Batte' });
    await userEvent.click(screen.getByRole('button', { name: 'Chercher des événements' }));

    const message = await screen.findByRole('status');
    expect(message).toHaveTextContent('Plafond mensuel d’appels IA atteint');
    // CLAUDE.md §5 : l'IA est un confort, jamais une dépendance. Un plafond
    // atteint n'est pas une panne — ni `role="alert"`, ni couleur d'alerte.
    expect(message.className).not.toContain('text-depassement');
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
  });

  it('une recherche fructueuse annonce le nombre et recharge la liste', async () => {
    let listeServie = listePropositions([]);
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        listeServie = listePropositions([COMPLETE]);
        return Promise.resolve({
          disponible: true,
          propositions: [COMPLETE],
          coutCents: 3,
        } as never);
      }
      if (chemin === '/evenements-decouverte/lieux')
        return Promise.resolve({ data: LIEUX } as never);
      return Promise.resolve(listeServie as never);
    });
    render(<PropositionsEvenements />);

    await screen.findByRole('option', { name: 'La Batte' });
    await userEvent.click(screen.getByRole('button', { name: 'Chercher des événements' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      '1 proposition(s) ajoutée(s) à la liste ci-dessous.',
    );
    // La liste a bien été rechargée : sans ça, la proposition neuve resterait
    // invisible jusqu'au prochain rafraîchissement de la page.
    expect(await screen.findByText('Marché de Noël de Verviers')).toBeInTheDocument();
  });

  it('une recherche sans résultat le dit — jamais un silence qu’on prendrait pour un échec', async () => {
    feindre({
      lieux: { data: LIEUX },
      propositions: listePropositions([]),
      ecritures: [{ disponible: true, propositions: [], coutCents: 2 }],
    });
    render(<PropositionsEvenements />);

    await screen.findByRole('option', { name: 'La Batte' });
    await userEvent.click(screen.getByRole('button', { name: 'Chercher des événements' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Recherche terminée : aucun événement trouvé.',
    );
  });

  it('un échec de la recherche est signalé, et ne fait pas passer pour un « rien trouvé »', async () => {
    feindre({
      lieux: { data: LIEUX },
      propositions: listePropositions([]),
      ecritures: [
        new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
          code: 'erreur_inattendue',
          statut: 500,
        }),
      ],
    });
    render(<PropositionsEvenements />);

    await screen.findByRole('option', { name: 'La Batte' });
    await userEvent.click(screen.getByRole('button', { name: 'Chercher des événements' }));

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent('Erreur inattendue du serveur (code HTTP 500).');
    expect(screen.queryByText(/aucun événement trouvé/)).toBeNull();
  });

  it('le bouton se rend inerte pendant la recherche — un appel IA se paie', async () => {
    let libere: ((valeur: unknown) => void) | undefined;
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return new Promise((resoudre) => {
          libere = resoudre;
        });
      }
      if (chemin === '/evenements-decouverte/lieux')
        return Promise.resolve({ data: LIEUX } as never);
      return Promise.resolve(listePropositions([]) as never);
    });
    render(<PropositionsEvenements />);

    await screen.findByRole('option', { name: 'La Batte' });
    const bouton = screen.getByRole('button', { name: 'Chercher des événements' });
    await userEvent.click(bouton);

    const enCours = await screen.findByRole('button', { name: 'Recherche…' });
    expect(enCours).toBeDisabled();
    libere?.({ disponible: true, propositions: [], coutCents: 1 });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Validation / rejet — et le clavier (CLAUDE.md §3 règle 10)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Propositions d’événements — valider sans souris', () => {
  it('l’ajustement de portée est envoyé tel quel, jamais la valeur d’origine', async () => {
    let corps: unknown = null;
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      if (options?.method === 'POST' && chemin.endsWith('/valider')) {
        corps = JSON.parse(String(options.body));
        return Promise.resolve({} as never);
      }
      if (chemin === '/evenements-decouverte/lieux')
        return Promise.resolve({ data: LIEUX } as never);
      return Promise.resolve(listePropositions([COMPLETE]) as never);
    });
    render(<PropositionsEvenements />);

    await screen.findByText('Marché de Noël de Verviers');
    await userEvent.selectOptions(
      screen.getByLabelText('Portée de « Marché de Noël de Verviers »'),
      'national',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Valider' }));

    await waitFor(() => expect(corps).not.toBeNull());
    expect(corps).toMatchObject({
      portee: 'national',
      intensiteEstimee: 3,
      famille: null,
      effectifEstime: null,
    });
  });

  it('Entrée depuis un contrôle de la ligne valide — sans atteindre le bouton à la souris', async () => {
    let chemin = '';
    appel.mockImplementation((c: string, options?: RequestInit) => {
      if (options?.method === 'POST' && c.endsWith('/valider')) {
        chemin = c;
        return Promise.resolve({} as never);
      }
      if (c === '/evenements-decouverte/lieux') return Promise.resolve({ data: LIEUX } as never);
      return Promise.resolve(listePropositions([COMPLETE]) as never);
    });
    render(<PropositionsEvenements />);

    await screen.findByText('Marché de Noël de Verviers');
    // Une `<tr>` ne peut pas contenir un `<form>` : sans `onKeyDown` explicite,
    // ajuster la ligne au clavier obligerait quand même la souris pour valider.
    const intensite = screen.getByLabelText(
      'Intensité de « Marché de Noël de Verviers », de 1 à 5',
    );
    intensite.focus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(chemin).toBe('/evenements-decouverte/propositions/prop-1/valider'));
  });

  it('les deux boutons de la ligne se rendent inertes pendant l’envoi', async () => {
    let libere: ((valeur: unknown) => void) | undefined;
    appel.mockImplementation((c: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return new Promise((resoudre) => {
          libere = resoudre;
        });
      }
      if (c === '/evenements-decouverte/lieux') return Promise.resolve({ data: LIEUX } as never);
      return Promise.resolve(listePropositions([COMPLETE, LACUNAIRE]) as never);
    });
    render(<PropositionsEvenements />);

    await screen.findByText('Marché de Noël de Verviers');
    const rangee = screen.getByText('Marché de Noël de Verviers').closest('tr') as HTMLElement;
    await userEvent.click(within(rangee).getByRole('button', { name: 'Valider' }));

    await waitFor(() =>
      expect(within(rangee).getByRole('button', { name: 'Valider' })).toBeDisabled(),
    );
    expect(within(rangee).getByRole('button', { name: 'Rejeter' })).toBeDisabled();

    // L'AUTRE ligne, elle, reste utilisable : le verrou est par proposition, pas
    // global. Sans cette seconde assertion, un verrou global passerait aussi.
    const autre = screen.getByText('Fête médiévale de Franchimont').closest('tr') as HTMLElement;
    expect(within(autre).getByRole('button', { name: 'Valider' })).toBeEnabled();

    libere?.({});
  });

  it('un rejet échoué est signalé, et ne fait pas disparaître la ligne en silence', async () => {
    appel.mockImplementation((c: string, options?: RequestInit) => {
      if (options?.method === 'POST' && c.endsWith('/rejeter')) {
        return Promise.reject(
          new ErreurApi('Cette proposition a déjà été traitée.', {
            code: 'deja_traitee',
            statut: 409,
          }),
        );
      }
      if (c === '/evenements-decouverte/lieux') return Promise.resolve({ data: LIEUX } as never);
      return Promise.resolve(listePropositions([COMPLETE]) as never);
    });
    render(<PropositionsEvenements />);

    await screen.findByText('Marché de Noël de Verviers');
    await userEvent.click(screen.getByRole('button', { name: 'Rejeter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cette proposition a déjà été traitée.',
    );
  });
});
