/**
 * Écran STOCK, MONTÉ pour de vrai (jsdom, D-095 du 01/08/2026).
 *
 * ═══ Ce que `Stock.test.tsx`, à côté, ne POUVAIT pas voir ═══
 *
 * Le fichier voisin teste `statutLigne`, `statutAfficheLot` et
 * `valorisationLots` — trois fonctions pures, correctement testées, et
 * intouchées ici. Elles décident ; rien ne prouvait que l'écran leur obéit.
 * Or le détail par lot n'existe qu'après un clic sur une rangée, qui déclenche
 * `GET /stock/:id/lots` : au premier rendu, il n'y a qu'un « Chargement du
 * stock… ». `renderToStaticMarkup` s'arrête là.
 *
 * ═══ Ce que la fixture doit pouvoir contredire ═══
 *
 * TROIS ingrédients dans TROIS états distincts — un périmé (le cas où le
 * libellé mentait : « Commander » au lieu de « Lot périmé »), un sous son
 * stock de sécurité, un normal — et, pour l'ingrédient périmé, DEUX lots dont
 * un seul l'est. Un ingrédient à un lot unique ne prouverait pas que la
 * valeur exploitable EXCLUT le périmé sans jeter le reste.
 *
 * Les dates sont calculées RELATIVEMENT au jour réel, jamais figées : cet
 * écran lit `aujourdHui()` (`../lib/dates`) à chaque rendu, et une date en dur
 * ferait passer le test au vert ou au rouge selon le jour où on le rejoue.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  formaterEuros,
  formaterMontant,
  jourCivilBelge,
  type LigneStockContrat,
  type LotDetail,
} from '@batte/core';

// Import de TYPE uniquement (effacé à la compilation, donc insensible au
// hissage de `vi.mock`) : la forme `typeof import('...')` en position de
// type est refusée par `@typescript-eslint/consistent-type-imports`.
import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: Stock, valorisationLots } = await import('./Stock');

type AppelApi = (chemin: string, options?: RequestInit) => Promise<unknown>;
const appelApi = vi.mocked(requeteApi) as unknown as ReturnType<typeof vi.fn<AppelApi>>;

/* ═══════════════════════════════════════════════════════════════════════════
   Dates relatives au jour réel
   ═══════════════════════════════════════════════════════════════════════════ */

const JOUR_MS = 24 * 60 * 60 * 1000;

function jourDecale(jours: number): string {
  return jourCivilBelge(new Date(Date.now() + jours * JOUR_MS));
}

const HIER = jourDecale(-1);
const DANS_TROIS_JOURS = jourDecale(3);
const DANS_UN_AN = jourDecale(365);

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function ligne(
  champs: Partial<LigneStockContrat> & Pick<LigneStockContrat, 'ingredientId' | 'nom'>,
): LigneStockContrat {
  return {
    unite: 'g',
    stockSecurite: 1000,
    quantiteDisponible: 5000,
    quantiteTotale: 5000,
    valeurCents: 1000,
    cumpCentsParUnite: 0.2,
    dlcLaPlusProche: DANS_UN_AN,
    nbLots: 1,
    ...champs,
  };
}

const LIGNES: LigneStockContrat[] = [
  // Ordre d'arrivée VOLONTAIREMENT contraire à l'urgence : le tri de l'écran
  // doit le corriger, sans quoi le test ne prouverait rien du tri.
  ligne({ ingredientId: 'i-farine', nom: 'Farine de froment T55', valeurCents: 2450 }),
  ligne({
    ingredientId: 'i-lait',
    nom: 'Lait entier',
    unite: 'ml',
    quantiteDisponible: 400,
    quantiteTotale: 400,
    stockSecurite: 2000,
    valeurCents: 60,
  }),
  ligne({
    ingredientId: 'i-cafe',
    nom: 'Café moulu',
    quantiteDisponible: 0,
    quantiteTotale: 200,
    dlcLaPlusProche: HIER,
    valeurCents: 300,
    nbLots: 2,
  }),
  // Rupture SÈCHE, sans aucune DLC : même statut « dépassement » que le café,
  // mais pour une raison TOUTE AUTRE. Sans cette quatrième ligne, le test ne
  // pourrait pas distinguer « le libellé dit la bonne raison » de « le libellé
  // dit toujours la même chose ».
  ligne({
    ingredientId: 'i-vergeoise',
    nom: 'Vergeoise blonde',
    quantiteDisponible: 0,
    quantiteTotale: 0,
    dlcLaPlusProche: null,
    valeurCents: 0,
    nbLots: 0,
  }),
];

function lot(champs: Partial<LotDetail> & Pick<LotDetail, 'id'>): LotDetail {
  return {
    numeroLotFournisseur: 'L-000',
    dateReception: jourDecale(-30),
    dateDlc: DANS_UN_AN,
    quantiteRestante: 100,
    quantiteInitiale: 100,
    prixLigneCents: 150,
    prixUnitaireCents: 1.5,
    statut: 'disponible',
    receptionStatut: 'active',
    ...champs,
  };
}

/**
 * Deux lots du même café : l'un PÉRIMÉ mais toujours « disponible » au sens
 * administratif (c'est le cas exact du défaut G6 : l'étiquette mentait), et
 * l'autre parfaitement valable. C'est cette cohabitation qui rend le test
 * capable de discriminer.
 */
const LOTS_CAFE: LotDetail[] = [
  lot({
    id: 'lot-perime',
    numeroLotFournisseur: 'CAF-2025-11',
    dateDlc: HIER,
    quantiteRestante: 200,
    quantiteInitiale: 200,
    prixLigneCents: 300,
    prixUnitaireCents: 1.5,
    statut: 'disponible',
  }),
  lot({
    id: 'lot-frais',
    numeroLotFournisseur: 'CAF-2026-07',
    dateDlc: DANS_TROIS_JOURS,
    quantiteRestante: 500,
    quantiteInitiale: 500,
    prixLigneCents: 750,
    prixUnitaireCents: 1.5,
    statut: 'disponible',
  }),
];

/* ═══════════════════════════════════════════════════════════════════════════
   Aiguillage
   ═══════════════════════════════════════════════════════════════════════════ */

type Reponses = Record<string, () => Promise<unknown>>;

function brancherApi(reponses: Reponses): void {
  appelApi.mockImplementation((chemin, options) => {
    const cle = `${options?.method ?? 'GET'} ${chemin}`;
    const reponse = reponses[cle];
    if (reponse === undefined) {
      return Promise.reject(
        new Error(`Aucune réponse déclarée pour « ${cle} » — la fixture ne couvre pas cet appel.`),
      );
    }
    return reponse();
  });
}

function reponsesNominales(): Reponses {
  return {
    'GET /parametres': () =>
      Promise.resolve({
        data: [
          {
            cle: 'brief_horizon_alerte_dlc_jours',
            valeur: '7',
            type: 'entier',
            unite: 'jours',
            libelle: 'Horizon d’alerte DLC',
            source: 'defaut',
            dateValiditeDebut: '2026-01-01',
            dateValiditeFin: null,
          },
        ],
        meta: { total: 1 },
      }),
    'GET /stock': () =>
      Promise.resolve({
        data: LIGNES,
        meta: {
          total: LIGNES.length,
          valeurTotaleCents: LIGNES.reduce((somme, l) => somme + l.valeurCents, 0),
          nbAReapprovisionner: 2,
        },
      }),
    'GET /stock/i-cafe/lots': () =>
      Promise.resolve({ data: LOTS_CAFE, meta: { total: LOTS_CAFE.length } }),
    'GET /stock/i-farine/lots': () =>
      Promise.resolve({ data: [lot({ id: 'lot-farine' })], meta: { total: 1 } }),
  };
}

function monter(): void {
  render(
    <MemoryRouter initialEntries={['/stock']}>
      <Stock />
    </MemoryRouter>,
  );
}

function celluleDe(nom: string | RegExp, index: number): HTMLElement {
  const cellule = within(screen.getByRole('row', { name: nom })).getAllByRole('cell')[index];
  if (cellule === undefined) throw new Error(`Cellule ${index} absente.`);
  return cellule;
}

function normaliser(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  appelApi.mockReset();
  /**
   * `scrollIntoView` n'existe pas dans jsdom (aucune mise en page, donc aucun
   * défilement). Ce n'est PAS un défaut du produit : l'écran l'appelle pour
   * amener le panneau de détail sous les yeux, geste qui n'a de sens que dans
   * un vrai navigateur. On le neutralise plutôt que de contourner l'appel —
   * contourner reviendrait à ne pas tester le chemin réel.
   */
  Element.prototype.scrollIntoView = vi.fn();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Stock — chargement, prêt, erreur', () => {
  it('annonce le chargement, puis rend le tableau', async () => {
    brancherApi(reponsesNominales());
    monter();

    expect(screen.getByText('Chargement du stock…')).toBeInTheDocument();
    expect(await screen.findByRole('row', { name: /Café moulu/ })).toBeInTheDocument();
    expect(screen.queryByText('Chargement du stock…')).not.toBeInTheDocument();
  });

  it('un échec de `/stock` affiche le message du serveur au lieu d’un tableau vide', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /stock': () =>
        Promise.reject(
          new ErreurApi('Le grand livre de stock est en cours de réindexation.', {
            code: 'stock_indisponible',
            statut: 503,
          }),
        ),
    });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent('réindexation');
  });

  it('l’échec du paramètre d’horizon DLC ne casse RIEN : mode dégradé, le tableau reste entier', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /parametres': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    monter();

    expect(await screen.findByRole('row', { name: /Café moulu/ })).toBeInTheDocument();
    // Seule la phrase qui explique la fenêtre « J-n » disparaît.
    expect(screen.queryByText(/même fenêtre que le brief avant-marché/)).not.toBeInTheDocument();
  });

  it('un stock jamais alimenté propose de saisir un inventaire, au lieu de constater le vide', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /stock': () =>
        Promise.resolve({
          data: [],
          meta: { total: 0, valeurTotaleCents: 0, nbAReapprovisionner: 0 },
        }),
    });
    monter();

    expect(await screen.findByText('Aucun stock enregistré')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Saisir un inventaire initial' }),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le tri par urgence, et l'étiquette qui mentait
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Stock — urgence et péremption', () => {
  it('trie par URGENCE et non par ordre d’arrivée : le périmé en tête, le sain en queue', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Café moulu/ });

    const noms = screen
      .getAllByRole('row')
      .slice(1) // l'en-tête
      .map((r) => within(r).getAllByRole('cell')[0]?.textContent ?? '');
    // Dépassements d'abord (DLC la plus proche en tête, un stock sans DLC
    // ferme la marche), puis l'alerte, puis le conforme.
    expect(noms[0]).toContain('Café moulu');
    expect(noms[1]).toContain('Vergeoise blonde');
    expect(noms[2]).toContain('Lait entier');
    expect(noms[3]).toContain('Farine de froment T55');
  });

  it('un ingrédient dont le lot est périmé dit « Lot périmé », jamais le générique « Commander »', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Café moulu/ });

    // La VRAIE raison, pas une raison plausible : l'utilisateur qui lit
    // « Commander » va chercher un manque de quantité qui n'existe pas.
    expect(celluleDe(/Café moulu/, 5)).toHaveTextContent('Lot périmé');
    expect(celluleDe(/Café moulu/, 5)).not.toHaveTextContent('Commander');
    // La vergeoise, elle, manque VRAIMENT : même statut, autre raison, autre
    // mot. C'est cette paire qui prouve que le libellé n'est pas une constante.
    expect(celluleDe(/Vergeoise blonde/, 5)).toHaveTextContent('Commander');
    expect(celluleDe(/Lait entier/, 5)).toHaveTextContent('À surveiller');
  });

  it('un lot administrativement « disponible » mais périmé s’affiche « Périmé » dans son détail (G6)', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Café moulu/ }));

    await screen.findByRole('row', { name: /CAF-2025-11/ });
    expect(celluleDe(/CAF-2025-11/, 5)).toHaveTextContent('Périmé');
    expect(celluleDe(/CAF-2025-11/, 5)).not.toHaveTextContent('Disponible');
    // Le lot encore bon garde son étiquette : le tiret ne contamine pas.
    expect(celluleDe(/CAF-2026-07/, 5)).toHaveTextContent('Disponible');
  });

  it('la valeur EXPLOITABLE exclut le lot périmé, et l’écran chiffre à part ce qui est périmé', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Café moulu/ }));
    await screen.findByRole('row', { name: /CAF-2025-11/ });

    // Les deux montants viennent de la fonction pure de l'écran, jamais d'un
    // calcul refait à la main : 750 c exploitables, 300 c périmés.
    const attendu = valorisationLots(LOTS_CAFE, jourCivilBelge(new Date()));
    expect(attendu.exploitableCents).toBe(750);
    expect(attendu.perimeeCents).toBe(300);

    const bandeau = screen.getByText(/Valeur exploitable/).closest('p');
    expect(bandeau).not.toBeNull();
    const texte = normaliser(bandeau?.textContent ?? '');
    expect(texte).toContain(normaliser(formaterEuros(attendu.exploitableCents)));
    expect(texte).toContain(normaliser(formaterEuros(attendu.perimeeCents)));
    expect(texte).toContain('de matière périmée non comptés');
  });

  it('un ingrédient SANS matière périmée n’affiche aucun compteur de périmé — le signal reste rare', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Farine de froment T55/ }));

    await screen.findByRole('row', { name: /L-000/ });
    const bandeau = screen.getByText(/Valeur exploitable/).closest('p');
    expect(bandeau).not.toBeNull();
    expect(bandeau?.textContent ?? '').not.toContain('de matière périmée non comptés');
  });

  it('la valeur d’un ingrédient reste écrite sans « € » en cellule : l’unité est dans l’en-tête', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Farine de froment T55/ });

    const cellule = celluleDe(/Farine de froment T55/, 2);
    expect(normaliser(cellule.textContent ?? '')).toBe(normaliser(formaterMontant(2450)));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Détail par lot et clavier (CLAUDE.md §3 règle 10)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Stock — détail par lot, clavier', () => {
  it('choisir un ingrédient au CLAVIER ouvre son détail, sans souris', async () => {
    brancherApi(reponsesNominales());
    monter();
    const rangee = await screen.findByRole('row', { name: /Farine de froment T55/ });

    rangee.focus();
    await userEvent.keyboard('{Enter}');

    expect(
      await screen.findByRole('heading', { name: /Farine de froment T55 — 1 lot/ }),
    ).toBeInTheDocument();
  });

  it('Échap ferme le panneau de détail, couche par couche — jamais tout d’un coup', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Café moulu/ }));
    await screen.findByRole('row', { name: /CAF-2025-11/ });

    // Couche 1 : le lot sélectionné.
    await userEvent.click(screen.getByRole('row', { name: /CAF-2025-11/ }));
    await userEvent.keyboard('{Escape}');
    // Le panneau de l'ingrédient est TOUJOURS là : une seule couche est tombée.
    expect(screen.getByRole('heading', { name: /Café moulu — 2 lots/ })).toBeInTheDocument();

    // Couche 2 : le panneau de l'ingrédient.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: /Café moulu — 2 lots/ })).not.toBeInTheDocument();
  });

  it('un échec du détail par lot laisse le tableau principal intact', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /stock/i-cafe/lots': () =>
        Promise.reject(
          new ErreurApi('Aucun lot lisible pour cet ingrédient.', {
            code: 'lots_illisibles',
            statut: 500,
          }),
        ),
    });
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Café moulu/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Aucun lot lisible');
    expect(screen.getByRole('row', { name: /Farine de froment T55/ })).toBeInTheDocument();
  });

  it('« Fermer » referme le panneau et rend la main au tableau', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Café moulu/ }));
    await screen.findByRole('row', { name: /CAF-2025-11/ });

    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));

    expect(screen.queryByRole('heading', { name: /Café moulu — 2 lots/ })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Café moulu/ })).toBeInTheDocument();
  });

  /*
    ═══ Le focus après la fermeture du panneau (défaut réel, 01/08/2026) ═══

    Les deux tests ci-dessous sont SÉPARÉS de celui du dessus, qui prouve la
    disparition du panneau et rien d'autre. Ce qu'ils ajoutent est la seule
    chose qui manquait : OÙ atterrit le focus. Sur `<body>`, les flèches ne
    font plus rien et la tabulation suivante repart du tout début du document —
    il faut retraverser la navigation latérale pour revenir où l'on était, ce
    que CLAUDE.md §3 règle 10 existe pour éviter.

    ═══ Pourquoi le focus est DÉPLACÉ explicitement avant Échap ═══

    Un test qui clique la rangée puis presse Échap passerait AU VERT SANS LE
    CORRECTIF : le clic laisse le focus sur la rangée, qui ne le perd donc
    jamais, et l'assertion finale se vérifie par simple résidu. C'est une
    fixture aveugle au sens strict de docs/39 §3 — elle ne ment pas, elle est
    incapable de voir. Il faut donc emmener le focus DANS le panneau, sur un
    nœud qui se démonte AVEC lui.

    Le bouton « Fermer », lui, n'a pas besoin de ce déplacement : le clic met
    de lui-même le focus dessus, et ce bouton disparaît avec le panneau qu'il
    ferme.

    Aucun CHAMP DE SAISIE n'est visé à cette couche-ci, et ce n'est pas un
    raccourci : les seuls champs du panneau appartiennent à des sous-couches
    (`SaisieSortie`, `DetailLot`) qu'Échap ferme AVANT le panneau lui-même
    (« une seule couche à la fois »). Viser un de ces champs testerait une
    autre branche que celle qu'on veut couvrir. Les cibles retenues — le
    bouton « Sortir du stock… » et une rangée de lot — sont les deux nœuds
    focalisables réels de cette couche, et les deux gestes réels : on hésite
    avant de saisir une sortie, on parcourt les lots aux flèches.
  */

  it('Échap sur le panneau rend le focus à la rangée de l’ingrédient, jamais à `<body>`', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Café moulu/ }));
    await screen.findByRole('row', { name: /CAF-2025-11/ });

    // Focus emmené DANS le panneau, sur un bouton qui va disparaître avec lui.
    // `sortieOuverte` reste faux et aucun lot n'est sélectionné : Échap tombe
    // donc bien sur la branche FINALE, celle qui ferme le panneau entier.
    screen.getByRole('button', { name: 'Sortir du stock…' }).focus();
    expect(screen.getByRole('button', { name: 'Sortir du stock…' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: /Café moulu — 2 lots/ }),
      ).not.toBeInTheDocument(),
    );
    // Le panneau fermé, « Café moulu » n'apparaît plus que dans la rangée du
    // tableau : le titre du panneau a disparu avec lui.
    const rangee = screen.getByText('Café moulu').closest('tr');
    expect(rangee).not.toBeNull();
    await waitFor(() => expect(rangee as HTMLElement).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it('« Fermer » rend lui aussi le focus à la rangée — même défaut, même correctif qu’Échap', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Café moulu/ }));
    // Focus emmené sur une RANGÉE DE LOT — à l'intérieur du panneau, dans la
    // grille imbriquée, donc démontée avec lui. Le clic sur « Fermer » qui
    // suit déplacera le focus sur le bouton, lui-même démonté : deux nœuds
    // perdus d'affilée, et pourtant la rangée d'origine doit revenir.
    const rangeeLot = await screen.findByRole('row', { name: /CAF-2025-11/ });
    rangeeLot.focus();
    expect(rangeeLot).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: /Café moulu — 2 lots/ }),
      ).not.toBeInTheDocument(),
    );
    const rangee = screen.getByText('Café moulu').closest('tr');
    expect(rangee).not.toBeNull();
    await waitFor(() => expect(rangee as HTMLElement).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  /*
    Le MÊME défaut une couche plus bas, trouvé en cherchant s'il se répétait —
    et il se répétait. Échap sur le détail d'un LOT démonte `DetailLot` : tout
    ce qui y avait le focus le rendait à `<body>`. C'est la couche où ça coûte
    le plus cher, parce que c'est celle qu'on enchaîne : on corrige un lot, on
    ferme, on passe au lot suivant de la même liste.

    Ici encore, le focus est emmené DANS le panneau qui va disparaître, sur un
    bouton de `DetailLot` : sans ce déplacement, le clic qui a ouvert le lot
    aurait laissé le focus sur la rangée, qui ne l'aurait jamais perdu — le
    test serait vert sans le correctif.
  */
  it('Échap sur le détail d’un LOT rend le focus à la rangée du lot, jamais à `<body>`', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Café moulu/ }));
    const rangeeLot = await screen.findByRole('row', { name: /CAF-2025-11/ });
    await userEvent.click(rangeeLot);

    const bouton = await screen.findByRole('button', { name: 'Changer le statut…' });
    bouton.focus();
    expect(bouton).toHaveFocus();

    await userEvent.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Changer le statut…' })).not.toBeInTheDocument(),
    );
    // La rangée du lot survit — seul `DetailLot` s'est démonté : le panneau de
    // l'ingrédient est toujours là, une seule couche est tombée.
    await waitFor(() => expect(rangeeLot).toHaveFocus());
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('heading', { name: /Café moulu — 2 lots/ })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le formulaire de réception : entrer, et surtout RESSORTIR
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `SaisieReception` charge trois référentiels avant de s'afficher, et le
 * FOURNISSEUR n'est pas optionnel : sans aucun fournisseur actif, elle rend un
 * état vide (« Aucun fournisseur actif ») À LA PLACE du formulaire, et le
 * bouton « Annuler » n'existe alors jamais.
 *
 * Écrit après coup : la première version de cette fixture servait trois listes
 * VIDES, et décrivait donc un cas où le formulaire ne peut pas exister — la
 * deuxième forme de fixture aveugle de docs/39 §3. Elle échouait sur
 * l'introuvabilité du bouton, pas sur le focus qu'elle prétendait mesurer.
 *
 * Un fournisseur et un ingrédient suffisent : ce test porte sur la SORTIE du
 * formulaire, pas sur sa saisie.
 */
function reponsesReferentielMinimal(): Reponses {
  return {
    'GET /fournisseurs': () =>
      Promise.resolve({
        data: [
          {
            id: 'f-meunier',
            nom: 'Moulin de la Batte',
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
          },
        ],
        meta: { total: 1 },
      }),
    'GET /ingredients': () =>
      Promise.resolve({
        data: [
          {
            id: 'i-farine',
            nom: 'Farine de froment T55',
            categorie: 'farine',
            unite: 'g',
            densiteGParMl: null,
            allergenes: ['gluten'],
            allergenesVerifies: true,
            stockSecurite: 1000,
            dureeConservationJours: null,
          },
        ],
        meta: { total: 1 },
      }),
    'GET /commandes': () => Promise.resolve({ data: [], meta: { total: 0 } }),
  };
}

describe('Stock — réception, aller ET retour au clavier', () => {
  /**
   * DÉFAUT RÉEL, moitié manquante d'un correctif déjà fait dans l'autre sens.
   *
   * `SaisieReception` explique elle-même, au-dessus de son effet de focus
   * d'ouverture, que le bouton « Enregistrer une réception » DISPARAÎT en
   * s'ouvrant et que le focus retombait alors sur `<body>` — corrigé pour
   * l'ENTRÉE dans le formulaire. La SORTIE par « Annuler » avait le défaut
   * symétrique, et il n'avait pas été vu : le bouton « Annuler » se démonte
   * avec le formulaire qu'il ferme, et rien ne reprenait le focus.
   *
   * Le même écran traite pourtant déjà correctement le cas jumeau, une couche
   * plus bas : `onAnnuler` de `SaisieSortie` rend le focus à `boutonSortir`.
   *
   * Ce test n'a besoin d'AUCUN déplacement de focus explicite, et ce n'est pas
   * l'oubli que dénonce le commentaire des tests d'Échap ci-dessus : ici c'est
   * le CLIC lui-même qui pose le focus sur « Annuler », et ce bouton est
   * précisément celui qui se démonte. La fixture voit donc le défaut sans
   * qu'on ait à l'aider.
   */
  it('« Annuler » la réception rend le focus au bouton qui l’avait ouverte, jamais à `<body>`', async () => {
    brancherApi({ ...reponsesNominales(), ...reponsesReferentielMinimal() });
    monter();
    await screen.findByRole('row', { name: /Café moulu/ });

    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer une réception' }));
    const annuler = await screen.findByRole('button', { name: 'Annuler' });
    await userEvent.click(annuler);

    const ouvrir = await screen.findByRole('button', { name: 'Enregistrer une réception' });
    await waitFor(() => expect(ouvrir).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  /**
   * DÉFAUT CONNU, encodé en `it.fails` (docs/39 §8) — le remède appartient à
   * `SaisieReception`, dont l'état vide est rendu À LA PLACE du formulaire.
   *
   * Sans aucun fournisseur actif, `SaisieReception` n'affiche ni champ ni
   * bouton, seulement une phrase d'explication. Or à cet instant :
   *  - le bouton « Enregistrer une réception » n'est plus rendu (mode
   *    `reception`) ;
   *  - Échap est volontairement neutralisé dans ce mode, pour ne pas perdre
   *    une saisie recopiée d'un bon de livraison papier ;
   *  - l'état vide n'offre aucun bouton de retour.
   *
   * Il ne reste donc AUCUN chemin de sortie au clavier : il faut retraverser la
   * navigation latérale, exactement ce que CLAUDE.md §3 règle 10 interdit. Le
   * cas n'est pas théorique — c'est l'écran que voit quelqu'un qui démarre,
   * avant d'avoir créé son premier fournisseur.
   *
   * CORRIGÉ le 28/09/2026 : sans fournisseur actif, `SaisieReception` n'a
   * aucune saisie à protéger ; Échap y revient à l'écran précédent et un
   * bouton « Annuler », focalisé d'office, offre la même sortie. Le test, en
   * `it.fails` jusque-là, est devenu un test ordinaire.
   */
  it('sans fournisseur actif, Échap quitte la réception : plus de cul-de-sac au clavier (défaut corrigé le 28/09/2026)', async () => {
    brancherApi({
      ...reponsesNominales(),
      ...reponsesReferentielMinimal(),
      'GET /fournisseurs': () => Promise.resolve({ data: [], meta: { total: 0 } }),
    });
    monter();
    await screen.findByRole('row', { name: /Café moulu/ });

    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer une réception' }));
    expect(await screen.findByText('Aucun fournisseur actif')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Aucun fournisseur actif')).not.toBeInTheDocument();
  });

  it('sans fournisseur actif, un bouton « Annuler » reçoit le focus et ramène au stock', async () => {
    brancherApi({
      ...reponsesNominales(),
      ...reponsesReferentielMinimal(),
      'GET /fournisseurs': () => Promise.resolve({ data: [], meta: { total: 0 } }),
    });
    monter();
    await screen.findByRole('row', { name: /Café moulu/ });

    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer une réception' }));
    await screen.findByText('Aucun fournisseur actif');
    const annuler = screen.getByRole('button', { name: 'Annuler' });
    await waitFor(() => expect(annuler).toHaveFocus());

    await userEvent.keyboard('{Enter}');
    expect(screen.queryByText('Aucun fournisseur actif')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer une réception' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le contrôle d'intégrité du grand livre — l'attente pendant l'aller-retour

   `verifierIntegrite()` pose `aria-disabled`, jamais `disabled` natif : le
   bouton reste dans le flux de tabulation pendant l'appel. Tout ce qui vit
   PENDANT cette requête — le libellé, l'attribut, un éventuel garde-fou — est
   INVISIBLE à une promesse déjà résolue (`mockResolvedValue`) : elle retombe à
   « fait » ou « erreur » dans le même écoulement de micro-tâches que sa pose
   sur « en_cours ». Les tests ci-dessous résolvent la promesse EUX-MÊMES,
   après avoir observé l'attente (docs/39 §3, forme 5).
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Stock — le contrôle d’intégrité pendant l’aller-retour (promesse contrôlée)', () => {
  /** Routeur de `reponsesNominales()`, mais avec `/stock/integrite` intercepté à part. */
  function routerAvecIntegriteControlee(): {
    repondre: (valeur: unknown) => void;
  } {
    let repondre: (valeur: unknown) => void = () => {};
    const base = reponsesNominales();
    appelApi.mockImplementation((chemin, options) => {
      if (chemin === '/stock/integrite') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      const cle = `${options?.method ?? 'GET'} ${chemin}`;
      const reponse = base[cle];
      if (reponse === undefined) {
        return Promise.reject(new Error(`Aucune réponse déclarée pour « ${cle} ».`));
      }
      return reponse();
    });
    return { repondre: (valeur: unknown) => repondre(valeur) };
  }

  it(
    'l’aller-retour est ANNONCÉ (`aria-disabled`, `aria-busy`, libellé) et redevient actionnable ' +
      'après la réponse',
    async () => {
      const controle = routerAvecIntegriteControlee();
      monter();
      await screen.findByRole('row', { name: /Café moulu/ });

      const bouton = screen.getByRole('button', { name: "Vérifier l'intégrité du stock" });
      await userEvent.click(bouton);

      // 1. L'attente est ANNONCÉE, sans retirer le bouton du parcours de
      //    tabulation — c'est tout l'intérêt d'`aria-disabled` ici plutôt que
      //    `disabled` natif (voir le test (ex-`it.fails`) juste en dessous pour ce que
      //    ce choix coûte quand AUCUN garde-fou ne l'accompagne).
      await waitFor(() => expect(bouton).toHaveAttribute('aria-disabled', 'true'));
      expect(bouton).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByText('Vérification…')).toBeInTheDocument();

      // 2. Une fois la réponse reçue, l'écran redevient actionnable.
      controle.repondre({ coherent: true, nbLotsVerifies: 4, lotsFautifs: [] });
      expect(await screen.findByText(/Stock cohérent/)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: "Vérifier l'intégrité du stock" }),
      ).not.toHaveAttribute('aria-disabled', 'true');
    },
  );

  /**
   * ═══ DÉFAUT RÉEL, CORRIGÉ LE 28/09/2026 (était en `it.fails`) ═══
   *
   * `verifierIntegrite()` (`Stock.tsx`) ne porte AUCUN garde-fou en tête : ni
   * `if (etatIntegrite.statut === 'en_cours') return;`, ni verrou `useRef`.
   * Le bouton pose `aria-disabled` — qui, par construction, n'empêche AUCUN
   * clic (c'est tout son intérêt pour le focus, et c'est aussi son risque :
   * voir `focus-actions.test.ts`, en-tête, « un `aria-disabled` sans
   * garde-fou est un bouton qui reste cliquable — un défaut différent, et
   * pire », et cette même garde y déclare ne pas pouvoir voir CE défaut-là :
   * « ça se prouve au montage, pas ici »). Un second clic pendant la
   * vérification part donc réellement en second `GET /stock/integrite`.
   *
   * Atténuation, pour ne pas dramatiser : `/stock/integrite` est une LECTURE
   * seule — un double appel gaspille un aller-retour, il n'écrit rien dans le
   * grand livre. Le défaut reste réel : c'est le MOTIF (`aria-disabled` sans
   * garde-fou) qui est fautif, le même motif que ce dépôt a déjà corrigé
   * ailleurs (`Ingredients.tsx`, bouton « Retirer ce format d'achat » —
   * `Ingredients.montage.test.tsx` en porte la preuve) — seul cet
   * emplacement-ci ne l'a pas reçu.
   *
   * CORRIGÉ le 28/09/2026 : garde en tête de `verifierIntegrite()`. Le test,
   * en `it.fails` jusque-là, est devenu un test ordinaire.
   */
  it('un second clic pendant la vérification ne part pas en second appel réseau (défaut corrigé le 28/09/2026)', async () => {
    const controle = routerAvecIntegriteControlee();
    monter();
    await screen.findByRole('row', { name: /Café moulu/ });

    const bouton = screen.getByRole('button', { name: "Vérifier l'intégrité du stock" });
    await userEvent.click(bouton);
    await waitFor(() => expect(bouton).toHaveAttribute('aria-disabled', 'true'));

    // CE QUE CE TEST ATTEND (tenu depuis le 28/09/2026) : le second clic ne
    // devrait déclencher AUCUN second appel.
    await userEvent.click(bouton);
    expect(appelApi.mock.calls.filter(([chemin]) => chemin === '/stock/integrite')).toHaveLength(1);

    controle.repondre({ coherent: true, nbLotsVerifies: 4, lotsFautifs: [] });
  });
});
