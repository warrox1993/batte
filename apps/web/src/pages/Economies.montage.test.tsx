/**
 * Écran Économies — test MONTÉ, en complément d'`Economies.test.tsx`.
 *
 * ═══ Ce que ce fichier ajoute ═══
 *
 * `Economies.test.tsx`, à côté, prouve `anneeDepuisParametreUrl` en isolation
 * et écrit lui-même ce qu'il ne pouvait pas prouver : « que le composant
 * `Economies` appelle bien cette fonction au montage, ni qu'elle pré-filtre
 * réellement l'écran une fois monté — seul un montage réel (hors de portée
 * ici, faute de `jsdom`) le prouverait ». `jsdom` existe depuis le 01/08/2026 :
 * ce fichier ferme précisément ce trou, sans toucher à l'autre.
 *
 * ═══ Les deux inconnues de cet écran ═══
 *
 * 1. `partMargeBp` est `null` quand la marge de l'année n'est pas connue ou
 *    n'est pas strictement positive. « 0 % » y serait un mensonge : ça dirait
 *    que les économies ne pèsent rien, alors qu'on ne sait pas ce qu'elles
 *    pèsent.
 * 2. Une année sans aucune action doit se dire, et se dire AUTREMENT qu'une
 *    erreur de chargement.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  TIRET_ABSENT,
  formaterEuros,
  formaterPointsDeBase,
  type EconomieLigneContrat,
  type TableauBordEconomiesContrat,
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
const { default: Economies } = await import('./Economies');

const appel = vi.mocked(requeteApi);

/** Classe du registre d'alerte MÉTIER, celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function ligne(partiel: Partial<EconomieLigneContrat> = {}): EconomieLigneContrat {
  return {
    id: 'eco-1',
    dateAction: '2025-03-14',
    ingredientId: 'ing-1',
    ingredientNom: 'Farine T55',
    fournisseurId: 'four-1',
    fournisseurNom: 'Moulin de Statte',
    conditionnementId: 'cond-1',
    conditionnementLibelle: 'Sac 25 kg',
    typeAction: 'negociation_prix',
    description: 'Tarif renégocié au passage à 10 sacs.',
    prixUnitaireAvantCents: 2400,
    prixUnitaireApresCents: 2100,
    quantiteConcernee: 10,
    economieCents: 3000,
    commandeId: null,
    commandeNumero: null,
    saisiPar: null,
    creeLe: '2025-03-14T10:00:00.000Z',
    ...partiel,
  };
}

function tableauBord(
  partiel: Partial<TableauBordEconomiesContrat> = {},
): TableauBordEconomiesContrat {
  return {
    periode: { debut: '2025-01-01', fin: '2025-12-31' },
    totalCents: 4250,
    nbActions: 3,
    parMois: [
      {
        mois: '2025-03',
        parType: {
          negociation_prix: 3000,
          achat_alternatif: 0,
          remplacement_stock_immobilise: 0,
          autre: 0,
        },
        totalCents: 3000,
      },
      {
        mois: '2025-05',
        parType: {
          negociation_prix: 0,
          achat_alternatif: 1250,
          remplacement_stock_immobilise: 0,
          autre: 0,
        },
        totalCents: 1250,
      },
    ],
    parType: [
      { typeAction: 'negociation_prix', totalCents: 3000, nbActions: 2 },
      { typeAction: 'achat_alternatif', totalCents: 1250, nbActions: 1 },
    ],
    partMargeBp: 320,
    ...partiel,
  };
}

const REFERENTIEL_VIDE = { data: [], meta: { total: 0 } };

/**
 * Recherche par `textContent` BRUT.
 *
 * `formaterEuros` place une espace INSÉCABLE avant le « € », que le
 * normaliseur par défaut de `@testing-library` remplace par une espace
 * ordinaire : la valeur formatée ne correspondrait jamais à elle-même via
 * `getByText`. On compare au FORMATEUR, mais sur le texte non normalisé.
 */
function parTexteExact(attendu: string): HTMLElement[] {
  return Array.from(document.querySelectorAll('p, span, td')).filter(
    (n) => n.textContent === attendu,
  ) as HTMLElement[];
}

type ReponsesFeintes = {
  tableauBord?: unknown;
  liste?: unknown;
};

/** Chemins réellement appelés, dans l'ordre — sert aussi aux tests de pont URL. */
let cheminsAppeles: string[] = [];

function feindre(reponses: ReponsesFeintes): void {
  appel.mockImplementation((chemin: string, options?: RequestInit) => {
    cheminsAppeles.push(chemin);
    if (options?.method !== undefined && options.method !== 'GET') {
      return new Promise<never>(() => {});
    }
    if (chemin.startsWith('/economies/tableau-bord')) {
      const choisie = reponses.tableauBord;
      if (choisie === undefined) return new Promise<never>(() => {});
      if (choisie instanceof Error) return Promise.reject(choisie);
      return Promise.resolve(choisie as never);
    }
    if (chemin.startsWith('/economies?')) {
      const choisie = reponses.liste;
      if (choisie === undefined) return new Promise<never>(() => {});
      if (choisie instanceof Error) return Promise.reject(choisie);
      return Promise.resolve(choisie as never);
    }
    // Référentiel (ingrédients, fournisseurs, conditionnements) : servi vide,
    // il n'est pas le sujet de ces tests.
    return Promise.resolve(REFERENTIEL_VIDE as never);
  });
}

function listeEconomies(lignes: EconomieLigneContrat[]): unknown {
  return {
    data: lignes,
    meta: {
      total: lignes.length,
      economieTotaleCents: lignes.reduce((s, l) => s + l.economieCents, 0),
    },
  };
}

function monter(url = '/economies'): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Economies />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  appel.mockReset();
  cheminsAppeles = [];
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Les trois états, sur deux chargements indépendants
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Économies — chargement, erreur, vide', () => {
  it('les deux panneaux annoncent leur chargement', () => {
    feindre({});
    monter();

    expect(screen.getByText('Calcul en cours…')).toBeInTheDocument();
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
  });

  it('un échec du tableau de bord reste NEUTRE, sans couleur d’alerte métier', async () => {
    feindre({
      tableauBord: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
      liste: listeEconomies([ligne()]),
    });
    monter();

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue du serveur (code HTTP 500).');
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    expect(message.parentElement?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
    // La liste, elle, a répondu : les deux chargements sont indépendants.
    expect(screen.getByText('Farine T55')).toBeInTheDocument();
  });

  it('un paramètre manquant du catalogue est traduit en phrase actionnable', async () => {
    // `messageErreurAffichable` reconnaît TOUTE la classe `ErreurParametreManquant`
    // par son motif, et propose le remède — pas la clé technique brute en tête.
    feindre({
      tableauBord: new ErreurApi(
        "Le paramètre « economies_marge_reference » n'est pas défini. Renseignez-le dans Paramètres avant de continuer.",
        { code: 'parametre_manquant', statut: 500 },
      ),
      liste: listeEconomies([]),
    });
    monter();

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Lancez « npm run db:seed »');
    // Le message brut reste lisible, mais RELÉGUÉ : jamais la première phrase.
    expect(message).toHaveTextContent('economies_marge_reference');
  });

  it('année sans action : un état vide qui dit quoi faire, pas un graphique vide', async () => {
    feindre({
      tableauBord: tableauBord({
        totalCents: 0,
        nbActions: 0,
        parMois: [],
        parType: [],
        partMargeBp: null,
      }),
      liste: listeEconomies([]),
    });
    monter();

    expect(await screen.findByText('Aucune économie enregistrée cette année')).toBeInTheDocument();
    // Et l'état vide de la LISTE est un texte DIFFÉRENT : deux vides, deux
    // phrases (docs/07 §4.7 interdit un gabarit générique unique).
    expect(screen.getByText('Aucune économie enregistrée')).toBeInTheDocument();
  });

  it('un échec de la LISTE n’efface pas le tableau de bord', async () => {
    feindre({
      tableauBord: tableauBord(),
      liste: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    monter();

    await screen.findByRole('alert');
    expect(parTexteExact(formaterEuros(4250)).length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Inconnu ≠ zéro — `partMargeBp`
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Économies — une part de marge inconnue ne vaut pas « 0 % »', () => {
  it('`partMargeBp` à null rend le tiret ET nomme la cause', async () => {
    feindre({ tableauBord: tableauBord({ partMargeBp: null }), liste: listeEconomies([ligne()]) });
    monter();

    expect(
      await screen.findByText(
        "Marge de l'année pas encore connue ou nulle : ratio non affichable.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(TIRET_ABSENT)).toBeInTheDocument();
    // `formaterPointsDeBase(0)` vaut « 0 % » : l'afficher dirait que les
    // économies ne pèsent rien, alors qu'on ne sait pas ce qu'elles pèsent.
    expect(screen.queryByText(formaterPointsDeBase(0))).toBeNull();
  });

  it('`partMargeBp` connu s’affiche via le formateur — la fixture discrimine', async () => {
    feindre({ tableauBord: tableauBord({ partMargeBp: 320 }), liste: listeEconomies([ligne()]) });
    monter();

    expect(await screen.findByText(formaterPointsDeBase(320))).toBeInTheDocument();
    expect(
      screen.getByText(
        "Part de la marge brute des sessions clôturées attribuable aux économies d'achat.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(TIRET_ABSENT)).toBeNull();
  });

  it('le compte d’actions s’accorde : « 1 action », « 3 actions »', async () => {
    feindre({ tableauBord: tableauBord({ nbActions: 1 }), liste: listeEconomies([ligne()]) });
    monter();

    expect(await screen.findByText(/^1 action sur l'année/)).toBeInTheDocument();
  });

  it('le total par type est trié, le levier le plus efficace en tête', async () => {
    feindre({
      tableauBord: tableauBord({
        parType: [
          // Volontairement dans le DÉSORDRE : sans tri à l'écran, ce test
          // passerait sur une liste laissée telle quelle.
          { typeAction: 'achat_alternatif', totalCents: 1250, nbActions: 1 },
          { typeAction: 'negociation_prix', totalCents: 3000, nbActions: 2 },
        ],
      }),
      liste: listeEconomies([ligne()]),
    });
    monter();

    await screen.findByText(/Total par type d'action/);
    const cellules = Array.from(document.querySelectorAll('td')).map((c) => c.textContent ?? '');
    const indexNegociation = cellules.findIndex((t) => t.includes('Négociation'));
    const indexAlternatif = cellules.findIndex((t) => t.includes('alternatif'));
    expect(indexNegociation).toBeGreaterThanOrEqual(0);
    expect(indexAlternatif).toBeGreaterThan(indexNegociation);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Le pont Comptabilité → Économies, enfin prouvé de bout en bout
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Économies — le pré-filtre d’année vient bien de l’URL', () => {
  it('`?annee=2025` filtre les DEUX requêtes, pas seulement l’affichage', async () => {
    feindre({ tableauBord: tableauBord(), liste: listeEconomies([ligne()]) });
    monter('/economies?annee=2025&mois=2025-03');

    await screen.findByText('Farine T55');
    // C'est ce que le test unitaire voisin ne pouvait PAS prouver : que la
    // valeur lue de l'URL atteigne réellement les appels réseau.
    expect(cheminsAppeles).toContain('/economies/tableau-bord?annee=2025');
    expect(cheminsAppeles).toContain('/economies?annee=2025');
    expect(screen.getByRole('heading', { name: 'Tableau de bord 2025' })).toBeInTheDocument();
  });

  it('sans paramètre, l’écran retombe sur l’année civile courante', async () => {
    feindre({ tableauBord: tableauBord(), liste: listeEconomies([ligne()]) });
    monter('/economies');

    await screen.findByText('Farine T55');
    const anneeCourante = new Date().getFullYear();
    expect(cheminsAppeles).toContain(`/economies/tableau-bord?annee=${anneeCourante}`);
  });

  it('changer l’année relance les deux requêtes avec la nouvelle valeur', async () => {
    feindre({ tableauBord: tableauBord(), liste: listeEconomies([ligne()]) });
    monter('/economies?annee=2025');

    await screen.findByText('Farine T55');
    cheminsAppeles = [];
    // `fireEvent.change` et non une frappe caractère par caractère : le champ
    // est CONTRÔLÉ sur un entier, donc effacer le rend momentanément illisible
    // (`parseInt('')` vaut `NaN`) et React y réinjecte aussitôt l'ancienne
    // valeur — une frappe produirait « 20252024 », pas « 2024 ». C'est bien le
    // gestionnaire de changement qu'on teste ici, pas la saisie caractère.
    fireEvent.change(screen.getByLabelText('Année'), { target: { value: '2024' } });

    expect(cheminsAppeles).toContain('/economies/tableau-bord?annee=2024');
    expect(cheminsAppeles).toContain('/economies?annee=2024');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Les deux formulaires escamotables — clavier et focus
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Économies — les surfaces de saisie s’ouvrent et se ferment au clavier', () => {
  async function monterPret(): Promise<void> {
    feindre({ tableauBord: tableauBord(), liste: listeEconomies([ligne()]) });
    monter('/economies?annee=2025');
    await screen.findByText('Farine T55');
  }

  it('« Renégocier un tarif » est fermé par défaut et s’annonce comme tel', async () => {
    await monterPret();

    const bouton = screen.getByRole('button', { name: 'Renégocier un tarif' });
    expect(bouton).toHaveAttribute('aria-expanded', 'false');
  });

  it('l’ouvrir bascule `aria-expanded`, et Échap referme en rendant le focus', async () => {
    await monterPret();

    const bouton = screen.getByRole('button', { name: 'Renégocier un tarif' });
    await userEvent.click(bouton);
    expect(bouton).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{Escape}');
    expect(bouton).toHaveAttribute('aria-expanded', 'false');
    // Le focus ne tombe pas sur `<body>` : il revient au bouton d'origine.
    expect(document.activeElement).toBe(bouton);
  });

  it('Échap ferme la surface OUVERTE, et une seule à la fois', async () => {
    await monterPret();

    const renegocier = screen.getByRole('button', { name: 'Renégocier un tarif' });
    const saisieLibre = screen.getByRole('button', { name: 'Nouvelle économie' });
    await userEvent.click(saisieLibre);
    expect(saisieLibre).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{Escape}');
    expect(saisieLibre).toHaveAttribute('aria-expanded', 'false');
    expect(renegocier).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(saisieLibre);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Transitions d'état pendant l'aller-retour — la promesse EN VOL

   Rien ci-dessus n'exerçait une ÉCRITURE : ni la renégociation, ni la saisie
   libre. Une promesse résolue via `mockResolvedValue` ne pourrait de toute
   façon rien montrer de l'attente (docs/39-DOCTRINE-DES-AGENTS.md §3,
   cinquième forme) : elle retombe à `inactif` dans le MÊME écoulement de
   micro-tâches que sa pose, avant d'atteindre le DOM. Les deux tests
   ci-dessous résolvent la promesse EUX-MÊMES, après avoir observé l'état
   « en cours ».
   ═══════════════════════════════════════════════════════════════════════════ */

/** Un conditionnement ACTIF, seul moyen de rendre « Enregistrer » atteignable
 * dans le formulaire de renégociation (`schemaConditionnement`, `@batte/core`). */
const CONDITIONNEMENT_ACTIF = {
  id: 'cond-1',
  ingredientId: 'ing-1',
  ingredientNom: 'Farine T55',
  uniteReference: 'g',
  fournisseurId: 'four-1',
  fournisseurNom: 'Moulin de Statte',
  libelle: 'Sac 25 kg',
  quantiteUniteRef: 25000,
  prixCents: 2400,
  referenceFournisseur: null,
  datePrix: '2026-01-01',
  actif: true,
};

/** Un ingrédient et un fournisseur, seul moyen de rendre « Enregistrer »
 * atteignable dans le formulaire de saisie libre. */
const INGREDIENT_REFERENTIEL = {
  id: 'ing-1',
  nom: 'Farine T55',
  categorie: 'farine',
  unite: 'g',
  densiteGParMl: null,
  allergenes: ['gluten'],
  allergenesVerifies: true,
  stockSecurite: 5000,
  dureeConservationJours: 180,
};

const FOURNISSEUR_REFERENTIEL = {
  id: 'four-1',
  nom: 'Moulin de Statte',
  type: 'moulin',
  email: null,
  telephone: null,
  adresse: null,
  delaiLivraisonJours: 3,
  francoDePortCents: null,
  commandeMinimumCents: null,
  notes: null,
  actif: true,
  nbConditionnements: 1,
};

describe('Économies — une écriture annonce son envoi, et ne le refait pas deux fois', () => {
  it(
    'renégocier un tarif : « Enregistrer » passe à « Enregistrement… » (disabled) pendant le POST, ' +
      'un second clic n’envoie rien de plus, et le libellé revient après un refus serveur',
    async () => {
      let rejeter: ((raison: unknown) => void) | undefined;
      appel.mockImplementation((chemin: string, options?: RequestInit) => {
        if (chemin === '/economies/renegociations-tarif' && options?.method === 'POST') {
          return new Promise((_resoudre, rej) => {
            rejeter = rej;
          });
        }
        if (options?.method !== undefined && options.method !== 'GET') {
          return new Promise<never>(() => {});
        }
        if (chemin.startsWith('/economies/tableau-bord'))
          return Promise.resolve(tableauBord() as never);
        if (chemin.startsWith('/economies?')) return Promise.resolve(listeEconomies([]) as never);
        if (chemin === '/conditionnements')
          return Promise.resolve({ data: [CONDITIONNEMENT_ACTIF], meta: { total: 1 } } as never);
        if (chemin === '/ingredients')
          return Promise.resolve({ data: [INGREDIENT_REFERENTIEL], meta: { total: 1 } } as never);
        if (chemin === '/fournisseurs')
          return Promise.resolve({ data: [FOURNISSEUR_REFERENTIEL], meta: { total: 1 } } as never);
        return Promise.resolve(REFERENTIEL_VIDE as never);
      });

      monter();
      await userEvent.click(screen.getByRole('button', { name: 'Renégocier un tarif' }));
      await screen.findByRole('option', { name: /Sac 25 kg/ });

      await userEvent.selectOptions(screen.getByLabelText('Conditionnement'), 'cond-1');
      await userEvent.type(screen.getByLabelText('Nouveau prix (€)'), '20');
      await userEvent.type(screen.getByLabelText('Volume concerné'), '10');
      await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      const bouton = await screen.findByRole('button', { name: 'Enregistrement…' });
      expect(bouton).toBeDisabled();

      /*
        `soumettreRenegociation` porte un garde-fou explicite
        (`etatRenegociation.statut === 'en_cours'`), mais aucun raccourci
        clavier n'atteint ce formulaire hors de ce bouton `type="submit"` :
        un second clic ne mesure donc, comme partout ailleurs dans ce dépôt
        sans Ctrl+S, que le blocage NATIF du navigateur sur `disabled`.
      */
      fireEvent.click(bouton);
      const posts = () =>
        appel.mock.calls.filter(
          ([c, o]) =>
            c === '/economies/renegociations-tarif' &&
            (o as RequestInit | undefined)?.method === 'POST',
        );
      expect(posts()).toHaveLength(1);

      rejeter?.(
        new ErreurApi('Ce conditionnement a déjà été renégocié aujourd’hui.', {
          code: 'renegociation_dupliquee',
          statut: 409,
        }),
      );

      const revenu = await screen.findByRole('button', { name: 'Enregistrer' });
      expect(revenu).toBeEnabled();
      expect(
        await screen.findByText('Ce conditionnement a déjà été renégocié aujourd’hui.'),
      ).toBeInTheDocument();
    },
  );

  it(
    'économie constatée hors réception : « Enregistrer » passe à « Enregistrement… » (disabled) ' +
      'pendant le POST, et redevient actionnable après un refus serveur',
    async () => {
      let rejeter: ((raison: unknown) => void) | undefined;
      appel.mockImplementation((chemin: string, options?: RequestInit) => {
        if (chemin === '/economies' && options?.method === 'POST') {
          return new Promise((_resoudre, rej) => {
            rejeter = rej;
          });
        }
        if (options?.method !== undefined && options.method !== 'GET') {
          return new Promise<never>(() => {});
        }
        if (chemin.startsWith('/economies/tableau-bord'))
          return Promise.resolve(tableauBord() as never);
        if (chemin.startsWith('/economies?')) return Promise.resolve(listeEconomies([]) as never);
        if (chemin === '/ingredients')
          return Promise.resolve({ data: [INGREDIENT_REFERENTIEL], meta: { total: 1 } } as never);
        if (chemin === '/fournisseurs')
          return Promise.resolve({ data: [FOURNISSEUR_REFERENTIEL], meta: { total: 1 } } as never);
        return Promise.resolve(REFERENTIEL_VIDE as never);
      });

      monter();
      await userEvent.click(screen.getByRole('button', { name: 'Nouvelle économie' }));
      await screen.findByRole('option', { name: 'Farine T55' });

      await userEvent.selectOptions(screen.getByLabelText('Ingrédient'), 'ing-1');
      await userEvent.selectOptions(screen.getByLabelText('Fournisseur'), 'four-1');
      await userEvent.type(screen.getByLabelText('Description'), 'Achat en gros chez le voisin');
      await userEvent.type(screen.getByLabelText('Prix avant (€)'), '24');
      await userEvent.type(screen.getByLabelText('Prix après (€)'), '20');
      await userEvent.type(screen.getByLabelText('Quantité'), '5');
      await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      const bouton = await screen.findByRole('button', { name: 'Enregistrement…' });
      expect(bouton).toBeDisabled();

      // Même limite que ci-dessus : aucun raccourci clavier ne contourne ce
      // bouton, donc ce second clic ne mesure que le blocage natif.
      fireEvent.click(bouton);
      const posts = () =>
        appel.mock.calls.filter(
          ([c, o]) => c === '/economies' && (o as RequestInit | undefined)?.method === 'POST',
        );
      expect(posts()).toHaveLength(1);

      rejeter?.(
        new ErreurApi('Le fournisseur choisi est désactivé.', {
          code: 'fournisseur_inactif',
          statut: 422,
        }),
      );

      const revenu = await screen.findByRole('button', { name: 'Enregistrer' });
      expect(revenu).toBeEnabled();
      expect(await screen.findByText('Le fournisseur choisi est désactivé.')).toBeInTheDocument();
    },
  );
});
