/**
 * `DetailLot` MONTÉ — le panneau où l'on DÉFAIT une écriture de stock.
 *
 * ═══ Pourquoi ce fichier existe ═══
 *
 * `DetailLot.test.ts`, à côté, teste `cleMouvementAFocaliserApresContrepassation`
 * — une fonction pure extraite précisément parce que le dépôt ne savait pas
 * monter un composant. Il reste valable et n'est pas touché. Mesuré le
 * 01/08/2026, le fichier n'était couvert qu'à 10,78 %.
 *
 * Ce panneau porte les TROIS gestes qui reviennent sur du stock déjà écrit :
 * changer le statut d'un lot (quarantaine, destruction), contrepasser un
 * mouvement, annuler la réception d'origine. Aucun n'efface quoi que ce soit —
 * tous ajoutent une écriture inverse (CLAUDE.md §3 règle 7) — mais tous
 * touchent la matière tracée au registre AFSCA. Chacun exige un motif choisi
 * dans une liste, et chacun a une cible de focus précise après le geste :
 * jamais `<body>` au milieu d'une série de corrections.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formaterQuantite, type LotDetail } from '@batte/core';

import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  // `import type * as …` et non `typeof import(...)` : la règle ESLint
  // `consistent-type-imports` interdit la seconde forme — même formulation que
  // `BoutonDocument.montage.test.tsx`, le modèle de ce dépôt.
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { DetailLot } = await import('./DetailLot');

const appelApi = vi.mocked(requeteApi);

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function lotDetail(surcharges: Partial<LotDetail> = {}): LotDetail {
  return {
    id: 'lot-farine-a',
    numeroLotFournisseur: 'LOT-2026-0731-A',
    dateReception: '2026-07-31',
    dateDlc: '2027-01-31',
    quantiteRestante: 18_000,
    quantiteInitiale: 25_000,
    prixLigneCents: 1_875,
    prixUnitaireCents: 0.075,
    statut: 'disponible',
    receptionStatut: 'active',
    ...surcharges,
  };
}

/** Entrée d'origine : jamais une contrepassation, donc corrigeable. */
const MOUVEMENT_ENTREE = {
  id: 'mvt-entree',
  type: 'entree' as const,
  quantite: 25_000,
  dateMouvement: '2026-07-31',
  coutCents: 1_875,
  motifCode: null,
  motifLibelle: null,
  motifTexte: null,
  ajustement: false,
  isAnnule: false,
  annuleParId: null,
  estContrepassation: false,
  creeLe: '2026-07-31T09:00:00.000Z',
};

/** Sortie de production : le second mouvement corrigeable de la fixture. */
const MOUVEMENT_SORTIE = {
  ...MOUVEMENT_ENTREE,
  id: 'mvt-sortie',
  type: 'sortie_production' as const,
  quantite: 7_000,
  dateMouvement: '2026-08-01',
  coutCents: 525,
  creeLe: '2026-08-01T07:00:00.000Z',
};

/**
 * DÉJÀ annulé : ne doit PLUS proposer « Corriger… ». Sans ce voisin, un test
 * qui compte les boutons de correction ne discriminerait rien.
 */
const MOUVEMENT_DEJA_ANNULE = {
  ...MOUVEMENT_ENTREE,
  id: 'mvt-annule',
  type: 'perte' as const,
  quantite: 500,
  dateMouvement: '2026-08-01',
  coutCents: 38,
  motifCode: 'CASSE_TRANSPORT',
  motifLibelle: 'Casse ou renversement au transport',
  isAnnule: true,
  annuleParId: 'mvt-contrepassation',
  creeLe: '2026-08-01T08:00:00.000Z',
};

const LOT_AVEC_RECEPTION = {
  ...lotDetail(),
  ingredientId: 'ing-farine',
  receptionId: 'rec-1',
  receptionNumero: 'RC-2026-0012',
  receptionNbLots: 2,
};

type Monde = {
  lot?: LotDetail;
  mouvements?: unknown[];
  nbAnnules?: number;
  receptionStatut?: 'active' | 'annulee';
  /** Force l'échec de `GET /lots/:id` — la réception devient illisible. */
  receptionIllisible?: boolean;
};

function routerLectures(monde: Monde = {}): void {
  const lot = monde.lot ?? lotDetail();
  const mouvements = monde.mouvements ?? [MOUVEMENT_ENTREE, MOUVEMENT_SORTIE];
  const nbAnnules = monde.nbAnnules ?? 0;

  appelApi.mockImplementation(async (chemin: string) => {
    if (chemin === `/lots/${lot.id}/mouvements`)
      return { data: mouvements, meta: { total: mouvements.length, nbAnnules } };
    if (chemin === `/lots/${lot.id}`) {
      if (monde.receptionIllisible === true)
        throw new ErreurApi("La réception d'origine est introuvable.", {
          code: 'introuvable',
          statut: 404,
        });
      return {
        ...LOT_AVEC_RECEPTION,
        ...lot,
        receptionStatut: monde.receptionStatut ?? lot.receptionStatut,
      };
    }
    throw new Error(`Chemin non prévu par la fixture : ${chemin}`);
  });
}

type Props = Parameters<typeof DetailLot>[0];

function proprietes(surcharges: Partial<Props> = {}): Props {
  return {
    lot: lotDetail(),
    nomIngredient: 'Farine de froment T55',
    unite: 'g',
    onEcriture: vi.fn(),
    ...surcharges,
  };
}

async function monterPret(monde: Monde = {}, surcharges: Partial<Props> = {}): Promise<Props> {
  routerLectures(monde);
  const props = proprietes({
    ...(monde.lot !== undefined ? { lot: monde.lot } : {}),
    ...surcharges,
  });
  render(<DetailLot {...props} />);
  await screen.findByRole('button', { name: 'Changer le statut…' });
  return props;
}

const champMotif = (libelle: RegExp) => screen.getByRole('combobox', { name: libelle });

/**
 * Rangée du tableau des mouvements qui porte ce mouvement.
 *
 * `data-mouvement` et non une requête accessible, à la différence du reste de
 * ce fichier : il n'existe AUCUNE prise accessible pour désigner UNE rangée par
 * identifiant de mouvement — deux mouvements peuvent partager date, type et
 * quantité. `DetailLot.tsx` pose cet attribut précisément pour y replacer le
 * focus après une contrepassation ; le test vise donc la même prise que le
 * produit.
 */
function rangeeMouvement(identifiant: string): HTMLElement {
  const cellule = document.querySelector<HTMLElement>(`[data-mouvement="${identifiant}"]`);
  if (cellule === null) throw new Error(`Aucune rangée pour le mouvement « ${identifiant} ».`);
  const ligne = cellule.closest('tr');
  return (ligne ?? cellule) as HTMLElement;
}

beforeEach(() => {
  appelApi.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Chargements : deux chaînes INDÉPENDANTES
   ═══════════════════════════════════════════════════════════════════════════ */

describe('DetailLot — les deux chargements ne se font pas tomber l’un l’autre', () => {
  it('un échec de l’HISTORIQUE laisse la réception d’origine lisible', async () => {
    appelApi.mockImplementation(async (chemin: string) => {
      if (chemin.endsWith('/mouvements'))
        throw new ErreurApi("L'historique est indisponible.", { code: 'x', statut: 503 });
      return LOT_AVEC_RECEPTION;
    });
    render(<DetailLot {...proprietes()} />);

    expect(await screen.findByText("L'historique est indisponible.")).toBeInTheDocument();
    // Le bloc de la réception, lui, est bien là.
    expect(await screen.findByText("Réception d'origine")).toBeInTheDocument();
  });

  it(
    'un échec de la RÉCEPTION laisse l’historique lisible, et DIT que l’annulation n’est pas ' +
      'proposée — jamais un bouton absent sans explication',
    async () => {
      await monterPret({ receptionIllisible: true });

      expect(
        screen.getByText(/L'annulation de la réception n'est donc pas proposée\./),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Annuler la réception…' }),
      ).not.toBeInTheDocument();
      // L'historique, lui, s'affiche.
      expect(rangeeMouvement('mvt-entree')).toBeInTheDocument();
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   Changement de statut : motif obligatoire, et un palier pour la destruction
   ═══════════════════════════════════════════════════════════════════════════ */

describe('DetailLot — changer le statut d’un lot', () => {
  it('propose d’emblée un statut DIFFÉRENT de l’actuel — le serveur refuse le changement nul', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));

    expect((champMotif(/^Nouveau statut/) as HTMLSelectElement).value).toBe('quarantaine');
  });

  it('un lot DÉJÀ en quarantaine se voit proposer « disponible », et non l’inverse', async () => {
    const utilisateur = userEvent.setup();
    await monterPret({ lot: lotDetail({ statut: 'quarantaine' }) });

    await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));

    expect((champMotif(/^Nouveau statut/) as HTMLSelectElement).value).toBe('disponible');
  });

  it('sans motif, le changement est refusé avant tout appel', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));
    appelApi.mockClear();
    await utilisateur.click(screen.getByRole('button', { name: 'Appliquer le statut' }));

    expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalledWith('/lots/lot-farine-a/statut', expect.anything());
  });

  it(
    'une DESTRUCTION demande une confirmation supplémentaire : un clic ne détruit jamais un lot, ' +
      'il demande d’abord',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));
      await utilisateur.selectOptions(champMotif(/^Nouveau statut/), 'detruit');
      await utilisateur.selectOptions(champMotif(/^Motif/), 'RAPPEL_FOURNISSEUR');
      appelApi.mockClear();
      await utilisateur.click(screen.getByRole('button', { name: 'Appliquer le statut' }));

      // Rien n'est parti : seul le palier de confirmation s'est affiché.
      expect(appelApi).not.toHaveBeenCalledWith('/lots/lot-farine-a/statut', expect.anything());
      expect(screen.getByRole('alert')).toHaveTextContent('ce statut ne se reprend pas');
      expect(screen.getByRole('button', { name: 'Confirmer la destruction' })).toBeInTheDocument();
    },
  );

  it('changer de statut visé APRÈS la confirmation la remet à zéro — on ne détruit pas par inertie', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));
    await utilisateur.selectOptions(champMotif(/^Nouveau statut/), 'detruit');
    await utilisateur.selectOptions(champMotif(/^Motif/), 'RAPPEL_FOURNISSEUR');
    await utilisateur.click(screen.getByRole('button', { name: 'Appliquer le statut' }));
    expect(screen.getByRole('button', { name: 'Confirmer la destruction' })).toBeInTheDocument();

    await utilisateur.selectOptions(champMotif(/^Nouveau statut/), 'quarantaine');

    expect(
      screen.queryByRole('button', { name: 'Confirmer la destruction' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appliquer le statut' })).toBeInTheDocument();
  });

  it(
    'une destruction confirmée annonce EN CHIFFRES ce qui est sorti du stock — « c’est fait » ' +
      'ne dit pas ce qui a bougé (docs/17 fiche 18)',
    async () => {
      const utilisateur = userEvent.setup();
      const props = await monterPret();

      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/lots/lot-farine-a/statut')
          return {
            lotId: 'lot-farine-a',
            statutPrecedent: 'disponible',
            statut: 'detruit',
            mouvementDestructionId: 'mvt-destruction',
            quantiteDetruite: 18_000,
            coutDetruitCents: 1_350,
          };
        return routeurBase?.(chemin, options);
      });

      await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));
      await utilisateur.selectOptions(champMotif(/^Nouveau statut/), 'detruit');
      await utilisateur.selectOptions(champMotif(/^Motif/), 'RAPPEL_FOURNISSEUR');
      await utilisateur.click(screen.getByRole('button', { name: 'Appliquer le statut' }));
      await utilisateur.click(screen.getByRole('button', { name: 'Confirmer la destruction' }));

      await waitFor(() => expect(props.onEcriture).toHaveBeenCalled());
      const message = String(vi.mocked(props.onEcriture).mock.calls[0]?.[0]);
      // Comparé VIA le formateur : `Intl` pose une espace insécable.
      expect(message).toContain(formaterQuantite(18_000, 'g'));
      expect(message).toContain('mouvement de perte');
    },
  );

  it('un lot DÉJÀ vide ne fabrique aucun chiffre : la phrase reste générale', async () => {
    const utilisateur = userEvent.setup();
    const props = await monterPret({ lot: lotDetail({ quantiteRestante: 0 }) });

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/lots/lot-farine-a/statut')
        return {
          lotId: 'lot-farine-a',
          statutPrecedent: 'disponible',
          statut: 'detruit',
          // Aucun mouvement écrit : le lot était déjà vide.
          mouvementDestructionId: null,
          quantiteDetruite: null,
          coutDetruitCents: null,
        };
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));
    await utilisateur.selectOptions(champMotif(/^Nouveau statut/), 'detruit');
    await utilisateur.selectOptions(champMotif(/^Motif/), 'RAPPEL_FOURNISSEUR');
    await utilisateur.click(screen.getByRole('button', { name: 'Appliquer le statut' }));
    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer la destruction' }));

    await waitFor(() => expect(props.onEcriture).toHaveBeenCalled());
    const message = String(vi.mocked(props.onEcriture).mock.calls[0]?.[0]);
    expect(message).not.toContain('mouvement de perte');
    // « Détruit » est le LIBELLÉ du statut (`LIBELLE_STATUT`), capitale comprise.
    expect(message).toContain('« Détruit »');
  });

  it(
    'après un changement appliqué, le focus revient sur « Changer le statut… » (D-079) — le ' +
      'bouton qui vient d’agir est démonté avec son formulaire',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/lots/lot-farine-a/statut')
          return {
            lotId: 'lot-farine-a',
            statutPrecedent: 'disponible',
            statut: 'quarantaine',
            mouvementDestructionId: null,
            quantiteDetruite: null,
            coutDetruitCents: null,
          };
        return routeurBase?.(chemin, options);
      });

      await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));
      await utilisateur.selectOptions(champMotif(/^Motif/), 'QUARANTAINE_DOUTE');
      await utilisateur.click(screen.getByRole('button', { name: 'Appliquer le statut' }));

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Changer le statut…' })).toHaveFocus(),
      );
      expect(document.body).not.toHaveFocus();
    },
  );

  it('un refus du serveur laisse le formulaire OUVERT, avec le message tel quel', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/lots/lot-farine-a/statut')
        throw new ErreurApi('Ce lot est déjà dans ce statut.', {
          code: 'statut_inchange',
          statut: 422,
        });
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));
    await utilisateur.selectOptions(champMotif(/^Motif/), 'QUARANTAINE_DOUTE');
    await utilisateur.click(screen.getByRole('button', { name: 'Appliquer le statut' }));

    expect(await screen.findByText('Ce lot est déjà dans ce statut.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appliquer le statut' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Contrepassation d'un mouvement
   ═══════════════════════════════════════════════════════════════════════════ */

describe('DetailLot — contrepasser un mouvement (rien ne s’efface)', () => {
  it('un mouvement DÉJÀ annulé ne propose plus « Corriger… »', async () => {
    await monterPret({
      mouvements: [MOUVEMENT_ENTREE, MOUVEMENT_DEJA_ANNULE],
      nbAnnules: 1,
    });

    expect(
      within(rangeeMouvement('mvt-entree')).getByRole('button', { name: 'Corriger…' }),
    ).toBeInTheDocument();
    // Discriminant : sans cette règle, les DEUX rangées porteraient le bouton.
    expect(
      within(rangeeMouvement('mvt-annule')).queryByRole('button', { name: 'Corriger…' }),
    ).not.toBeInTheDocument();
  });

  it('sans motif, la contrepassation est refusée avant tout appel', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(
      within(rangeeMouvement('mvt-entree')).getByRole('button', { name: 'Corriger…' }),
    );
    appelApi.mockClear();
    await utilisateur.click(screen.getByRole('button', { name: 'Contrepasser ce mouvement' }));

    expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalledWith('/mouvements/mvt-entree/annuler', expect.anything());
  });

  it('le formulaire annonce la quantité EXACTE qui sera remise en jeu', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(
      within(rangeeMouvement('mvt-sortie')).getByRole('button', { name: 'Corriger…' }),
    );

    /*
      Le signe et la quantité vivent dans le MÊME `<span>` (« − 7,0 kg ») :
      chercher la quantité seule échoue, et c'est précisément la lecture que le
      porteur fait — le sens du mouvement compte autant que son chiffre.
    */
    const rappel = screen.getByText(/l'originale restera au journal, barrée/);
    expect(rappel.textContent ?? '').toContain(formaterQuantite(7_000, 'g'));
    expect(rappel.textContent ?? '').toContain('−');
  });

  it('une contrepassation confirmée poste le motif et annonce le retour de matière', async () => {
    const utilisateur = userEvent.setup();
    const props = await monterPret();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/mouvements/mvt-sortie/annuler')
        return { mouvementOrigineId: 'mvt-sortie', mouvementContrepassationId: 'mvt-inverse' };
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(
      within(rangeeMouvement('mvt-sortie')).getByRole('button', { name: 'Corriger…' }),
    );
    await utilisateur.selectOptions(champMotif(/^Motif de la correction/), 'ERREUR_SAISIE');
    await utilisateur.click(screen.getByRole('button', { name: 'Contrepasser ce mouvement' }));

    await waitFor(() => expect(props.onEcriture).toHaveBeenCalled());
    const appel = appelApi.mock.calls.find(([c]) => c === '/mouvements/mvt-sortie/annuler');
    expect(JSON.parse(String((appel?.[1] as RequestInit).body))).toEqual({
      motifCode: 'ERREUR_SAISIE',
    });
    const message = String(vi.mocked(props.onEcriture).mock.calls[0]?.[0]);
    expect(message).toContain(formaterQuantite(7_000, 'g'));
    expect(message).toContain('Farine de froment T55');
  });

  it(
    'après une contrepassation, le focus va sur le PROCHAIN mouvement encore corrigeable — pas ' +
      'sur `<body>` au milieu d’une série de corrections',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/mouvements/mvt-entree/annuler')
          return { mouvementOrigineId: 'mvt-entree', mouvementContrepassationId: 'mvt-inverse' };
        return routeurBase?.(chemin, options);
      });

      await utilisateur.click(
        within(rangeeMouvement('mvt-entree')).getByRole('button', { name: 'Corriger…' }),
      );
      await utilisateur.selectOptions(champMotif(/^Motif de la correction/), 'ERREUR_SAISIE');
      await utilisateur.click(screen.getByRole('button', { name: 'Contrepasser ce mouvement' }));

      await waitFor(() =>
        expect(
          within(rangeeMouvement('mvt-sortie')).getByRole('button', { name: 'Corriger…' }),
        ).toHaveFocus(),
      );
      expect(document.body).not.toHaveFocus();
    },
  );

  it('un refus du serveur garde le formulaire ouvert, message compris', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/mouvements/mvt-entree/annuler')
        throw new ErreurApi('Ce mouvement a déjà été contrepassé.', {
          code: 'deja_annule',
          statut: 422,
        });
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(
      within(rangeeMouvement('mvt-entree')).getByRole('button', { name: 'Corriger…' }),
    );
    await utilisateur.selectOptions(champMotif(/^Motif de la correction/), 'ERREUR_SAISIE');
    await utilisateur.click(screen.getByRole('button', { name: 'Contrepasser ce mouvement' }));

    expect(await screen.findByText('Ce mouvement a déjà été contrepassé.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contrepasser ce mouvement' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Annulation de la réception d'origine (D-087)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('DetailLot — annuler la réception d’origine', () => {
  it('annonce le numéro de réception ET le nombre de lots qu’elle emporte', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception…' }));

    /*
      Le numéro apparaît DEUX fois une fois le bloc ouvert : dans la ligne
      d'identité, et dans la phrase de conséquence lue avant de confirmer. Une
      requête `getByText` serait ambiguë — on compte donc explicitement, ce qui
      documente aussi que les deux rappels existent.
    */
    expect(screen.getAllByText(/RC-2026-0012/).length).toBeGreaterThanOrEqual(2);
    // Deux lots dans cette réception : annuler l'un annule l'autre. Le rappel
    // apparaît lui aussi deux fois, pour la même raison que le numéro.
    expect(screen.getAllByText(/2 lots/).length).toBeGreaterThanOrEqual(2);
  });

  it(
    'une réception DÉJÀ annulée ne propose plus le bouton : la raison prend sa place, dite avant ' +
      'le clic plutôt que découverte après',
    async () => {
      await monterPret({ receptionStatut: 'annulee' });

      expect(
        screen.queryByRole('button', { name: 'Annuler la réception…' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/déjà annulée/i)).toBeInTheDocument();
    },
  );

  it('sans motif, l’annulation est refusée avant tout appel', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception…' }));
    appelApi.mockClear();
    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception' }));

    expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalledWith('/receptions/rec-1/annuler', expect.anything());
  });

  it('une annulation réussie annonce le nombre d’entrées contrepassées', async () => {
    const utilisateur = userEvent.setup();
    const props = await monterPret();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/receptions/rec-1/annuler')
        return {
          receptionId: 'rec-1',
          numero: 'RC-2026-0012',
          nbMouvementsContrepasses: 2,
          commandeId: null,
          commandeStatutRestaure: null,
        };
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception…' }));
    await utilisateur.selectOptions(champMotif(/^Motif de l'annulation/), 'ERREUR_SAISIE');
    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception' }));

    await waitFor(() => expect(props.onEcriture).toHaveBeenCalled());
    expect(String(vi.mocked(props.onEcriture).mock.calls[0]?.[0])).toContain(
      '2 entrées contrepassées',
    );
  });

  it(
    'un refus AFFICHE le message du serveur TEL QUEL — il porte le nom de l’ingrédient et la ' +
      'quantité manquante, deux chiffres qu’une reformulation perdrait',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/receptions/rec-1/annuler')
          throw new ErreurApi(
            'Farine de froment T55 : 7,0 kg déjà consommés sur ce lot, la contrepassation est impossible.',
            { code: 'entree_deja_consommee', statut: 422 },
          );
        return routeurBase?.(chemin, options);
      });

      await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception…' }));
      await utilisateur.selectOptions(champMotif(/^Motif de l'annulation/), 'ERREUR_SAISIE');
      await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception' }));

      expect(
        await screen.findByText(
          'Farine de froment T55 : 7,0 kg déjà consommés sur ce lot, la contrepassation est impossible.',
        ),
      ).toBeInTheDocument();
    },
  );

  it('fermer le bloc d’annulation rend le focus au bouton qui l’a ouvert', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception…' }));
    const bloc = screen.getByText("Réception d'origine").closest('div');
    await utilisateur.click(within(bloc as HTMLElement).getByRole('button', { name: 'Fermer' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Annuler la réception…' })).toHaveFocus(),
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Clavier — CLAUDE.md §3 règle 10
   ═══════════════════════════════════════════════════════════════════════════ */

describe('DetailLot — clavier (CLAUDE.md §3 règle 10)', () => {
  it(
    'AUCUN des trois gestes n’est un `<form>` : `Entrée` ne peut ni bloquer, ni détruire, ni ' +
      'contrepasser par mégarde',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));
      appelApi.mockClear();
      champMotif(/^Motif/).focus();
      await utilisateur.keyboard('{Enter}');

      expect(appelApi).not.toHaveBeenCalledWith('/lots/lot-farine-a/statut', expect.anything());
      // Et le formulaire reste ouvert, sans message de refus : rien ne s'est passé.
      expect(screen.getByRole('button', { name: 'Appliquer le statut' })).toBeInTheDocument();
    },
  );

  it('chaque bouton « Corriger… » est nommé, et atteignable au clavier', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    const corriger = within(rangeeMouvement('mvt-entree')).getByRole('button', {
      name: 'Corriger…',
    });
    corriger.focus();
    expect(corriger).toHaveFocus();
    await utilisateur.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: 'Contrepasser ce mouvement' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état pendant l'envoi : promesse EN VOL, jamais déjà résolue
   ═══════════════════════════════════════════════════════════════════════════

   docs/39 §3 (cinquième forme, « la promesse déjà résolue ») : tous les tests
   ci-dessus enchaînent la réponse dans le MÊME écoulement de micro-tâches que
   le clic — l'état d'envoi n'atteint jamais le DOM. Les trois gestes de ce
   panneau PARTAGENT un seul `envoiEnCours` (`DetailLot.tsx`), et AUCUN n'est
   dans un `<form>` : `DetailLot.tsx` ne contient ni `ctrlKey`, ni `metaKey`,
   ni `addEventListener` (vérifié). Aucun raccourci global n'existe donc pour
   contourner un bouton `disabled` — et cliquer un AUTRE bouton d'action ne le
   contournerait pas non plus : gouverné par le MÊME booléen, il serait, lui
   aussi, `disabled`. Un second clic ou un `Entrée` ne prouveraient donc rien
   du garde-fou `if (envoiEnCours) return;` de chacune des trois fonctions —
   il n'est donc pas feint ici (consigne de mission : dire l'absence de
   chemin plutôt que la simuler).
*/
describe('DetailLot — transitions d’état pendant l’envoi (promesse en vol)', () => {
  it(
    'le changement de statut bloque « Appliquer le statut » pendant l’envoi, et referme le ' +
      'formulaire après la réponse (le bouton bascule « Changer le statut… » revient)',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      let repondre: ((valeur: unknown) => void) | undefined;
      appelApi.mockImplementation(
        () =>
          new Promise((resoudre) => {
            repondre = resoudre;
          }),
      );

      await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));
      await utilisateur.selectOptions(champMotif(/^Motif/), 'QUARANTAINE_DOUTE');
      await utilisateur.click(screen.getByRole('button', { name: 'Appliquer le statut' }));

      // Pendant l'envoi, le même bouton annonce l'attente (correctif du
      // 28/09/2026, voir le test « annonce l’attente par un libellé » plus bas).
      expect(screen.getByRole('button', { name: 'Enregistrement…' })).toBeDisabled();

      repondre?.({
        lotId: 'lot-farine-a',
        statutPrecedent: 'disponible',
        statut: 'quarantaine',
        mouvementDestructionId: null,
        quantiteDetruite: null,
        coutDetruitCents: null,
      });

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Changer le statut…' })).toBeInTheDocument(),
      );
      expect(screen.queryByRole('button', { name: 'Appliquer le statut' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Enregistrement…' })).not.toBeInTheDocument();
    },
  );

  it(
    'la contrepassation annonce « Enregistrement… », bloque le bouton, et referme le formulaire ' +
      'de correction après la réponse',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      let repondre: ((valeur: unknown) => void) | undefined;
      appelApi.mockImplementation(
        () =>
          new Promise((resoudre) => {
            repondre = resoudre;
          }),
      );

      await utilisateur.click(
        within(rangeeMouvement('mvt-sortie')).getByRole('button', { name: 'Corriger…' }),
      );
      await utilisateur.selectOptions(champMotif(/^Motif de la correction/), 'ERREUR_SAISIE');
      await utilisateur.click(screen.getByRole('button', { name: 'Contrepasser ce mouvement' }));

      const bouton = await screen.findByRole('button', { name: 'Enregistrement…' });
      expect(bouton).toBeDisabled();

      repondre?.({ mouvementOrigineId: 'mvt-sortie', mouvementContrepassationId: 'mvt-inverse' });

      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Contrepasser ce mouvement' }),
        ).not.toBeInTheDocument(),
      );
    },
  );

  it(
    'l’annulation de la réception d’origine annonce « Annulation… », bloque le bouton, et REND ' +
      'le geste d’ouverture — « Annuler la réception… » — après la réponse (ce lot reste ' +
      'annulable une seconde fois, à la différence d’une production)',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      let repondre: ((valeur: unknown) => void) | undefined;
      appelApi.mockImplementation(
        () =>
          new Promise((resoudre) => {
            repondre = resoudre;
          }),
      );

      await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception…' }));
      await utilisateur.selectOptions(champMotif(/^Motif de l'annulation/), 'ERREUR_SAISIE');
      await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception' }));

      const bouton = await screen.findByRole('button', { name: 'Annulation…' });
      expect(bouton).toBeDisabled();

      /*
        Ici, contrairement au test voisin de `SaisieReception.montage.test.tsx`,
        la fixture (`routerLectures`) ne change PAS `receptionStatut` en
        réponse à `rafraichir()` : le bouton d'ouverture réapparaît donc bien.
        Les deux comportements sont corrects, chacun pour sa fixture — celui-ci
        prouve juste que le contrôle ne reste pas bloqué `disabled` à vie.
      */
      repondre?.({
        receptionId: 'rec-1',
        numero: 'RC-2026-0012',
        nbMouvementsContrepasses: 2,
        commandeId: null,
        commandeStatutRestaure: null,
      });

      await screen.findByRole('button', { name: 'Annuler la réception…' });
    },
  );

  /**
   * ═══ DÉFAUT RÉEL, TROUVÉ EN LISANT `DetailLot.tsx`, CORRIGÉ LE 28/09/2026 ═══
   *
   * Le bouton « Appliquer le statut » ne porte AUCUN libellé d'attente : son
   * texte reste figé sur `{destructionConfirmee ? 'Confirmer la destruction'
   * : 'Appliquer le statut'}` pendant tout l'aller-retour — seul `disabled`
   * change. C'est une asymétrie DANS CE MÊME FICHIER : les deux autres
   * écritures, juste au-dessus, affichent bien « Enregistrement… » et
   * « Annulation… » pendant leur propre envoi. Un porteur qui clique
   * « Appliquer le statut » sur un réseau lent n'a donc AUCUN signal que sa
   * saisie est partie, hormis un bouton qui a cessé de réagir — ce que
   * docs/06/07 demandent précisément d'annoncer par un libellé.
   *
   * Signalé d’abord par un test qui échouait volontairement (`it.fails`,
   * docs/39 §8).
   * CORRIGÉ le 28/09/2026 : le bouton affiche « Enregistrement… » pendant
   * l'envoi. Le test, en `it.fails` jusque-là, est devenu ordinaire.
   */
  it(
    'le bouton « Appliquer le statut » annonce l’attente par un libellé, comme ses deux ' +
      'voisins de ce même fichier (défaut corrigé le 28/09/2026)',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      appelApi.mockImplementation(() => new Promise(() => {}));

      await utilisateur.click(screen.getByRole('button', { name: 'Changer le statut…' }));
      await utilisateur.selectOptions(champMotif(/^Motif/), 'QUARANTAINE_DOUTE');
      await utilisateur.click(screen.getByRole('button', { name: 'Appliquer le statut' }));

      expect(await screen.findByRole('button', { name: 'Enregistrement…' })).toBeInTheDocument();
    },
  );
});
