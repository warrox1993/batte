/**
 * Écran MENUS, MONTÉ pour de vrai (jsdom, D-095 du 01/08/2026).
 *
 * ═══ Ce que `Menus.test.tsx`, à côté, ne POUVAIT pas voir ═══
 *
 * Ce fichier voisin teste `avertissementCoutVentilationMenu` et
 * `COLONNES_COMPOSITION` — deux valeurs pures, correctement testées, et
 * intouchées ici. Mais rien, jusqu'à ce jour, ne prouvait qu'un seul de ces
 * mots atteignait l'écran : le panneau « Ventilation du prix » ne naît
 * qu'après DEUX requêtes (composition + ventilation) déclenchées par un
 * `useEffect` sur `menuId`, c'est-à-dire après un geste utilisateur.
 * `renderToStaticMarkup` s'arrête au premier rendu, où `menuId === ''` et où
 * ce panneau n'existe pas du tout.
 *
 * ═══ Pourquoi les fixtures passent par `ventilerMenu` (`@batte/core`) ═══
 *
 * Écrire à la main une réponse de ventilation, c'est écrire une fixture qui
 * ne peut pas contredire l'écran : les parts sommeraient au prix du menu
 * parce que JE les aurais faites sommer. On appelle donc la VRAIE fonction de
 * répartition, celle que la route `POST /menus/:id/ventilation` appelle
 * elle-même. Le prix du menu est **733 c** réparti sur trois composants de
 * poids 350/200/380 : un montant qui NE TOMBE PAS ROND, seul capable de faire
 * apparaître un défaut d'arrondi (900 c sur trois parts égales n'en montrerait
 * aucun). Les trois natures et un coût inconnu sur UN SEUL composant sont
 * présents ensemble — une fixture où tous les coûts sont connus ne prouverait
 * rien sur l'affichage d'un coût inconnu.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  ErreurMetier,
  TIRET_ABSENT,
  formaterMontant,
  repartirPrixMenu,
  ventilerMenu,
  type ComposantMenuCalcul,
  type CompositionMenu,
  type MenuResume,
  type Produit,
  type VentilationMenuContrat,
} from '@batte/core';

// Même précaution que `BoutonDocument.montage.test.tsx` : `ErreurApi` doit
// rester la VRAIE classe — l'écran fait `erreur instanceof ErreurApi` pour
// décider s'il affiche le message du serveur ou « Erreur inattendue ». Une
// classe factice rendrait tous les tests d'erreur verts pour la mauvaise
// raison (le message générique passerait pour le message métier).
// Import de TYPE uniquement (effacé à la compilation, donc insensible au
// hissage de `vi.mock`) : la forme `typeof import('...')` en position de
// type est refusée par `@typescript-eslint/consistent-type-imports`.
import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: Menus } = await import('./Menus');

type AppelApi = (chemin: string, options?: RequestInit) => Promise<unknown>;
const appelApi = vi.mocked(requeteApi) as unknown as ReturnType<typeof vi.fn<AppelApi>>;

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures — trois natures, un coût inconnu, un prix qui ne tombe pas rond
   ═══════════════════════════════════════════════════════════════════════════ */

const PRIX_MENU_CENTS = 733;

const PRODUITS: Produit[] = [
  produit({ id: 'p-menu', nom: 'Formule du marché', nature: 'menu', prixCents: PRIX_MENU_CENTS }),
  produit({ id: 'p-crepe', nom: 'Crêpe froment nature', nature: 'transforme', prixCents: 350 }),
  produit({ id: 'p-cafe', nom: 'Café', nature: 'revendu', prixCents: 200 }),
  produit({ id: 'p-sirop', nom: 'Sirop de Liège', nature: 'revendu', prixCents: 380 }),
];

function produit(champs: Pick<Produit, 'id' | 'nom' | 'nature' | 'prixCents'>): Produit {
  return {
    recetteId: null,
    recetteLibelle: null,
    ingredientId: null,
    ingredientNom: null,
    consommationUnite: null,
    nbCrepes: null,
    volumeMlParUnite: null,
    categorie: null,
    consommationSurPlace: false,
    actif: true,
    ...champs,
  };
}

const MENUS: MenuResume[] = [
  {
    id: 'p-menu',
    nom: 'Formule du marché',
    nature: 'menu',
    prixCents: PRIX_MENU_CENTS,
    actif: true,
    nbComposantsActifs: 3,
  },
];

function composition(prixForceCents: number | null = null): CompositionMenu[] {
  return [
    {
      id: 'c-1',
      menuId: 'p-menu',
      produitInclusId: 'p-crepe',
      nomProduitInclus: 'Crêpe froment nature',
      nature: 'transforme',
      quantite: 1,
      prixCatalogueCents: 350,
      actif: true,
      prixForceCents,
    },
    {
      id: 'c-2',
      menuId: 'p-menu',
      produitInclusId: 'p-cafe',
      nomProduitInclus: 'Café',
      nature: 'revendu',
      quantite: 1,
      prixCatalogueCents: 200,
      actif: true,
      prixForceCents: null,
    },
    {
      id: 'c-3',
      menuId: 'p-menu',
      produitInclusId: 'p-sirop',
      nomProduitInclus: 'Sirop de Liège',
      nature: 'revendu',
      quantite: 1,
      prixCatalogueCents: 380,
      actif: true,
      prixForceCents: null,
    },
  ];
}

/**
 * `coutSirop` à `null` = le cas qui compte : un SEUL composant sans prix rend
 * tout le coût du menu inconnu (règle tout-ou-rien de `ventilerMenu`), et
 * l'écran doit alors écrire `—` partout, jamais `0,00`.
 */
function composantsCalcul(coutSiropCents: number | null): ComposantMenuCalcul[] {
  return [
    {
      produitInclusId: 'p-crepe',
      nom: 'Crêpe froment nature',
      nature: 'transforme',
      quantite: 1,
      prixCatalogueCents: 350,
      coutMatiereCents: 33,
      nbCrepesParUnite: 1,
      prixForceCents: null,
    },
    {
      produitInclusId: 'p-cafe',
      nom: 'Café',
      nature: 'revendu',
      quantite: 1,
      prixCatalogueCents: 200,
      coutMatiereCents: 45,
      nbCrepesParUnite: 0,
      prixForceCents: null,
    },
    {
      produitInclusId: 'p-sirop',
      nom: 'Sirop de Liège',
      nature: 'revendu',
      quantite: 1,
      prixCatalogueCents: 380,
      coutMatiereCents: coutSiropCents,
      nbCrepesParUnite: 0,
      prixForceCents: null,
    },
  ];
}

/** Réponse de `POST /menus/:id/ventilation`, calculée par la VRAIE fonction du serveur. */
function ventilation(coutSiropCents: number | null): VentilationMenuContrat {
  const calcul = ventilerMenu(PRIX_MENU_CENTS, composantsCalcul(coutSiropCents));
  return {
    menuId: 'p-menu',
    nomMenu: 'Formule du marché',
    prixMenuCents: PRIX_MENU_CENTS,
    composants: calcul.composants.map((c) => ({
      produitInclusId: c.produitInclusId,
      nom: c.nom,
      nature: c.nature,
      quantite: c.quantite,
      partPrixCents: c.partPrixCents,
      coutTotalCents: c.coutTotalCents,
    })),
    parNatureCents: calcul.parNatureCents,
    coutTotalCents: calcul.coutTotalCents,
    margeMenuCents: calcul.margeMenuCents,
    prixSepareTotalCents: calcul.prixSepareTotalCents,
    margeSepareeCents: calcul.margeSepareeCents,
    ecartMargeCents: calcul.ecartMargeCents,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Aiguillage des requêtes
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

/** Le jeu d'appels nominal, avec le coût du sirop paramétrable. */
function reponsesNominales(coutSiropCents: number | null): Reponses {
  return {
    'GET /produits': () => Promise.resolve({ data: PRODUITS, meta: { total: PRODUITS.length } }),
    'GET /menus': () => Promise.resolve({ data: MENUS, meta: { total: MENUS.length } }),
    'GET /menus/p-menu/composition': () =>
      Promise.resolve({ data: composition(), meta: { total: 3 } }),
    'POST /menus/p-menu/ventilation': () => Promise.resolve(ventilation(coutSiropCents)),
  };
}

function monter(): void {
  render(
    <MemoryRouter initialEntries={['/menus']}>
      <Menus />
    </MemoryRouter>,
  );
}

/** Choisit le menu à piloter : c'est CE geste qui fait naître les deux panneaux. */
async function choisirLeMenu(): Promise<void> {
  const selecteur = await screen.findByLabelText(/Produit à gérer comme menu/);
  await userEvent.selectOptions(selecteur, 'p-menu');
}

/** Le tableau de la ventilation, repéré par un en-tête qui n'existe que là. */
function tableauVentilation(): HTMLElement {
  const enTete = screen.getByRole('columnheader', { name: 'Part du prix (€)' });
  const table = enTete.closest('table');
  if (table === null) throw new Error('En-tête de ventilation hors de tout tableau.');
  return table;
}

function celluleDeLigne(table: HTMLElement, nom: string | RegExp, index: number): HTMLElement {
  const ligne = within(table).getByRole('row', { name: nom });
  const cellules = within(ligne).getAllByRole('cell');
  const cellule = cellules[index];
  if (cellule === undefined) throw new Error(`Cellule ${index} absente de la ligne.`);
  return cellule;
}

beforeEach(() => {
  appelApi.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Menus — chargement, prêt, erreur', () => {
  it('passe de « aucun menu » à la liste chargée, sans jamais afficher un panneau muet', async () => {
    brancherApi(reponsesNominales(null));
    monter();

    // Premier rendu : les listes sont vides, l'état vide DOIT parler.
    expect(
      screen.getByText(/Aucun menu déclaré : choisissez un produit ci-dessous/),
    ).toBeInTheDocument();

    expect(await screen.findByRole('row', { name: /Formule du marché/ })).toBeInTheDocument();
    expect(screen.queryByText(/Aucun menu déclaré/)).not.toBeInTheDocument();
  });

  it('affiche le message du serveur quand la liste échoue, et garde le titre du panneau', async () => {
    brancherApi({
      'GET /produits': () =>
        Promise.reject(
          new ErreurApi('La base de données est verrouillée par une autre écriture.', {
            code: 'base_verrouillee',
            statut: 503,
          }),
        ),
      'GET /menus': () => Promise.resolve({ data: [], meta: { total: 0 } }),
    });
    monter();

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent('La base de données est verrouillée');
    // Le panneau ne disparaît pas avec son contenu (patron `MessageErreur`).
    expect(screen.getByRole('heading', { name: /Menus déjà déclarés/i })).toBeInTheDocument();
  });

  it('remplace « Erreur inattendue » par le message du serveur, et l’inverse pour une valeur non-ErreurApi', async () => {
    brancherApi({
      'GET /produits': () => Promise.reject(new TypeError('Failed to fetch')),
      'GET /menus': () => Promise.resolve({ data: [], meta: { total: 0 } }),
    });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent('Erreur inattendue');
  });

  it('tant qu’aucun menu n’est choisi, l’écran dit quoi faire au lieu d’un panneau vide', async () => {
    brancherApi(reponsesNominales(null));
    monter();

    expect(await screen.findByText('Choisissez un produit')).toBeInTheDocument();
    expect(
      screen.getByText(/Sélectionnez un produit ci-dessus pour déclarer les composants/),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Inconnu ≠ zéro — la priorité absolue de cet écran
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Menus — un coût inconnu s’écrit « — », jamais « 0,00 »', () => {
  it('le composant sans prix porte le tiret d’absence, et lui SEUL', async () => {
    brancherApi(reponsesNominales(null));
    monter();
    await choisirLeMenu();

    const table = await screen.findByRole('columnheader', { name: 'Coût de revient (€)' });
    const ventilationTable = table.closest('table');
    expect(ventilationTable).not.toBeNull();

    // Colonne 3 = « Coût de revient (€) ».
    expect(celluleDeLigne(tableauVentilation(), /Sirop de Liège/, 3)).toHaveTextContent(
      TIRET_ABSENT,
    );
    // Les deux composants au coût CONNU gardent leur chiffre : le tiret ne
    // doit pas contaminer toute la colonne.
    expect(celluleDeLigne(tableauVentilation(), /Crêpe froment nature/, 3)).toHaveTextContent(
      formaterMontant(33),
    );
    expect(celluleDeLigne(tableauVentilation(), /^Café/, 3)).toHaveTextContent(formaterMontant(45));
  });

  it('les quatre agrégats dérivés du coût sont tous « — » — aucun ne vaut 0,00', async () => {
    brancherApi(reponsesNominales(null));
    monter();
    await choisirLeMenu();

    for (const libelle of [
      'Coût total',
      'Marge du menu',
      'Marge si vendus séparément',
      'Écart menu vs séparé',
    ]) {
      const titre = await screen.findByText(libelle);
      const bloc = titre.parentElement;
      expect(bloc).not.toBeNull();
      expect(bloc).toHaveTextContent(TIRET_ABSENT);
      // LE mensonge traqué : un coût matière à 0 fabriquerait 100 % de marge.
      expect(bloc?.textContent ?? '').not.toContain(formaterMontant(0));
    }
  });

  it('nomme LE composant fautif — un tiret nu ne distingue pas un café oublié de toute la carte', async () => {
    brancherApi(reponsesNominales(null));
    monter();
    await choisirLeMenu();

    const avertissement = await screen.findByRole('alert');
    expect(avertissement).toHaveTextContent('partiellement');
    expect(avertissement).toHaveTextContent('Sirop de Liège');
    // Les composants CHIFFRÉS ne doivent pas être accusés à tort.
    expect(avertissement).not.toHaveTextContent('Crêpe froment nature');
  });

  it('dès que tous les coûts sont connus, les agrégats sont chiffrés ET l’avertissement disparaît', async () => {
    brancherApi(reponsesNominales(120));
    monter();
    await choisirLeMenu();

    const coutTotal = await screen.findByText('Coût total');
    // 33 + 45 + 120 = 198 c. Aucun de ces nombres n'est tapé à la main ici :
    // il vient de `ventilerMenu`, et le texte attendu du formateur.
    expect(coutTotal.parentElement).toHaveTextContent(formaterMontant(33 + 45 + 120));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Trois natures, et la garantie de somme
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Menus — ventilation par nature et répartition au centime', () => {
  it('un menu MIXTE ventile son prix entre transformé et revendu, et la somme fait le prix du menu', async () => {
    brancherApi(reponsesNominales(120));
    monter();
    await choisirLeMenu();

    const attendu = ventilation(120);
    const caTransforme = await screen.findByText('CA transformé');
    expect(caTransforme.parentElement).toHaveTextContent(
      formaterMontant(attendu.parNatureCents.transforme),
    );
    const caRevendu = screen.getByText('CA revendu');
    expect(caRevendu.parentElement).toHaveTextContent(
      formaterMontant(attendu.parNatureCents.revendu),
    );

    // La garantie non négociable de `repartir()` : rien ne se perd. Sur 733 c
    // et trois poids inégaux, un arrondi part par part perdrait un centime.
    expect(attendu.parNatureCents.transforme + attendu.parNatureCents.revendu).toBe(
      PRIX_MENU_CENTS,
    );
  });

  it('la nature d’un composant REVENDU est écrite « Revendu », jamais confondue avec « Transformé »', async () => {
    brancherApi(reponsesNominales(120));
    monter();
    await choisirLeMenu();

    await screen.findByRole('columnheader', { name: 'Part du prix (€)' });
    expect(celluleDeLigne(tableauVentilation(), /Sirop de Liège/, 1)).toHaveTextContent('Revendu');
    expect(celluleDeLigne(tableauVentilation(), /Crêpe froment nature/, 1)).toHaveTextContent(
      'Transformé',
    );
  });

  it('chaque part affichée est celle rendue par `repartir`, au centime près', async () => {
    brancherApi(reponsesNominales(120));
    monter();
    await choisirLeMenu();

    await screen.findByRole('columnheader', { name: 'Part du prix (€)' });
    const attendu = ventilation(120);
    for (const composant of attendu.composants) {
      expect(
        celluleDeLigne(tableauVentilation(), new RegExp(echapper(composant.nom)), 2),
      ).toHaveTextContent(formaterMontant(composant.partPrixCents));
    }
  });
});

function echapper(texte: string): string {
  return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ═══════════════════════════════════════════════════════════════════════════
   Le refus qui ferait échouer toute une clôture, dit AVANT le dimanche soir
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `cloturerSession` ventile CHAQUE menu dans la MÊME transaction que toute la
 * clôture (`repartirPrixMenu`, `@batte/core`) : des prix désignés qui
 * dépassent le prix pratiqué font donc échouer la journée entière. Cet écran
 * est le seul endroit où le porteur peut le voir venir — encore faut-il que
 * le message y arrive entier.
 *
 * Le message n'est pas recopié à la main : on le fait produire par la VRAIE
 * `repartirPrixMenu`, celle qui refusera la clôture. Un message recopié
 * divergerait au premier changement de formulation, et le test resterait vert.
 */
function messageRefusPrixDesignes(): string {
  try {
    repartirPrixMenu(PRIX_MENU_CENTS, [
      { nom: 'Crêpe froment nature', poids: 350, prixForceCents: 500 },
      { nom: 'Café', poids: 200, prixForceCents: 300 },
      { nom: 'Sirop de Liège', poids: 380, prixForceCents: null },
    ]);
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) return erreur.message;
    throw erreur;
  }
  throw new Error('`repartirPrixMenu` aurait dû refuser : la fixture ne teste plus rien.');
}

describe('Menus — prix désignés incohérents', () => {
  it('affiche le refus du serveur en entier : le menu, les deux issues, et le composant privé de part', async () => {
    const message = messageRefusPrixDesignes();
    brancherApi({
      ...reponsesNominales(120),
      'POST /menus/p-menu/ventilation': () =>
        Promise.reject(new ErreurApi(message, { code: 'menu_prix_force_incoherent', statut: 422 })),
    });
    monter();
    await choisirLeMenu();

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent('Sirop de Liège');
    expect(alerte).toHaveTextContent('Corrigez le prix pratiqué');
    expect(alerte).toHaveTextContent('réduisez/retirez le prix désigné');
  });

  it('n’affiche AUCUN chiffre de ventilation quand le calcul a été refusé — pas de tableau à moitié vrai', async () => {
    brancherApi({
      ...reponsesNominales(120),
      'POST /menus/p-menu/ventilation': () =>
        Promise.reject(
          new ErreurApi(messageRefusPrixDesignes(), {
            code: 'menu_prix_force_incoherent',
            statut: 422,
          }),
        ),
    });
    monter();
    await choisirLeMenu();

    await screen.findByRole('alert');
    expect(
      screen.queryByRole('columnheader', { name: 'Part du prix (€)' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('CA transformé')).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Simulation éphémère vs réglage enregistré
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Menus — la simulation ne se confond pas avec le réglage enregistré', () => {
  it('rappelle, à côté du champ de simulation, le prix RÉELLEMENT enregistré du composant', async () => {
    brancherApi({
      ...reponsesNominales(120),
      'GET /menus/p-menu/composition': () =>
        Promise.resolve({ data: composition(150), meta: { total: 3 } }),
    });
    monter();
    await choisirLeMenu();

    await userEvent.click(
      await screen.findByRole('radio', { name: /Essayer un autre prix, composant par composant/ }),
    );

    expect(await screen.findByText(`(enregistré : ${formaterMontant(150)} €)`)).toBeInTheDocument();
  });

  it('revenir au prorata relance le calcul en JETANT la simulation saisie', async () => {
    brancherApi(reponsesNominales(120));
    monter();
    await choisirLeMenu();

    await userEvent.click(
      await screen.findByRole('radio', { name: /Essayer un autre prix, composant par composant/ }),
    );
    const champCafe = await screen.findByPlaceholderText(formaterMontant(200));
    await userEvent.type(champCafe, '1,50');
    await userEvent.click(screen.getByRole('button', { name: 'Recalculer' }));

    const corpsSimule = dernierCorpsVentilation();
    expect(corpsSimule).toEqual({ prixForcesCents: { 'p-cafe': 150 } });

    await userEvent.click(screen.getByRole('radio', { name: /Au prorata des prix catalogue/ }));
    // Le retour au prorata doit repartir d'un corps VIDE : une simulation qui
    // survivrait au changement de méthode fausserait silencieusement le calcul.
    expect(dernierCorpsVentilation()).toEqual({ prixForcesCents: {} });
  });
});

function dernierCorpsVentilation(): unknown {
  const appels = appelApi.mock.calls.filter(
    ([chemin, options]) => chemin === '/menus/p-menu/ventilation' && options?.method === 'POST',
  );
  const dernier = appels[appels.length - 1];
  if (dernier === undefined) throw new Error('Aucun appel de ventilation enregistré.');
  const corps = dernier[1]?.body;
  return typeof corps === 'string' ? JSON.parse(corps) : corps;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Clavier (CLAUDE.md §3 règle 10)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Menus — clavier', () => {
  it('Ctrl+S enregistre sans passer par la souris, et refuse une saisie incomplète en le disant', async () => {
    brancherApi(reponsesNominales(120));
    monter();
    await choisirLeMenu();
    await screen.findByRole('columnheader', { name: 'Part du prix (€)' });

    const champQuantite = screen.getByRole('textbox', { name: /Quantité dans le menu/ });
    champQuantite.focus();
    await userEvent.keyboard('{Control>}s{/Control}');

    expect(
      await screen.findByText('Choisissez le produit inclus dans ce menu.'),
    ).toBeInTheDocument();
  });

  it('« Nouveau composant » amène le focus dans le formulaire, pas sur le bouton qui vient de disparaître du regard', async () => {
    brancherApi(reponsesNominales(120));
    monter();
    await choisirLeMenu();
    await screen.findByRole('columnheader', { name: 'Part du prix (€)' });

    await userEvent.click(screen.getByRole('button', { name: 'Nouveau composant' }));

    const champProduit = screen.getByRole('combobox', { name: /Produit inclus/ });
    await vi.waitFor(() => expect(document.activeElement).toBe(champProduit));
  });

  /**
   * DÉFAUT RÉEL trouvé le 01/08/2026, corrigé le même jour — le test est
   * devenu ordinaire (il était en `it.fails` le temps que le correctif
   * atteigne sa zone d'écriture).
   *
   * `Produits.tsx` porte la règle explicitement : « jamais
   * `setChampsEnErreur` sans `focaliserPremierChampFautif` juste après »
   * (défaut mesuré par la recette clavier du 30/07/2026, même famille que
   * D-079 / docs/22-FOCUS-DETRUIT.md). `Menus.tsx` déclarait bien la fonction
   * `focaliserPremierChampFautif` — mais ne l'appelait QUE dans le `.catch`
   * d'une erreur SERVEUR. La validation LOCALE (`corpsDepuisBrouillon`)
   * posait les erreurs et sortait sans jamais déplacer le focus.
   *
   * Conséquence à l'usage, avant correctif : après un `Ctrl+S` ou un clic sur
   * « Enregistrer » avec un produit inclus non choisi, le message apparaissait
   * en haut du formulaire pendant que le focus restait sur le bouton de
   * soumission — le porteur devait remonter à la souris ou à coups de
   * `Shift+Tab` jusqu'au champ fautif. C'est exactement le geste que la
   * règle 10 existe pour supprimer.
   */
  it('après un refus LOCAL, le focus atterrit sur le premier champ fautif', async () => {
    brancherApi(reponsesNominales(120));
    monter();
    await choisirLeMenu();
    await screen.findByRole('columnheader', { name: 'Part du prix (€)' });

    const soumettre = screen.getByRole('button', { name: 'Enregistrer' });
    await userEvent.click(soumettre);
    await screen.findByText('Choisissez le produit inclus dans ce menu.');

    const champProduit = screen.getByRole('combobox', { name: /Produit inclus/ });
    expect(document.activeElement).toBe(champProduit);
    // Et surtout PAS resté sur le bouton de soumission : c'est l'état mesuré
    // avant correctif, celui qui obligeait à revenir à la souris.
    expect(document.activeElement).not.toBe(soumettre);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   L'état d'enregistrement PENDANT la requête (docs/39 §3, cinquième forme)
   ═══════════════════════════════════════════════════════════════════════════

   `mockResolvedValue`/`Promise.resolve()` — ce que toutes les fixtures de ce
   fichier utilisent jusqu'ici — rend une promesse déjà résolue : l'état
   `enregistrement` retombe à `'inchange'`/`'enregistre'` avant que le test
   n'ait eu la moindre chance d'observer l'attente. Ici la requête est
   CONTRÔLÉE, résolue seulement après avoir constaté le bouton inerte et le
   texte « Enregistrement… ».
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Menus — l’état d’enregistrement de la composition, observé PENDANT la requête', () => {
  it('« Enregistrer » devient inerte et l’indicateur dit « Enregistrement… », puis les deux redeviennent normaux', async () => {
    let repondre: ((valeur: unknown) => void) | undefined;
    const poster = vi.fn(
      () =>
        new Promise((resoudre) => {
          repondre = resoudre;
        }),
    );
    brancherApi({ ...reponsesNominales(120), 'POST /menus/p-menu/composition': poster });
    monter();
    await choisirLeMenu();
    await screen.findByRole('columnheader', { name: 'Part du prix (€)' });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /Produit inclus/ }),
      'p-crepe',
    );
    await userEvent.type(screen.getByRole('textbox', { name: /Quantité dans le menu/ }), '2');
    const bouton = screen.getByRole('button', { name: 'Enregistrer' });
    await userEvent.click(bouton);

    // La requête est EN VOL ici, et seulement ici.
    expect(bouton).toBeDisabled();
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();

    repondre?.({
      id: 'c-new',
      menuId: 'p-menu',
      produitInclusId: 'p-crepe',
      nomProduitInclus: 'Crêpe froment nature',
      nature: 'transforme',
      quantite: 2,
      prixCatalogueCents: 350,
      actif: true,
      prixForceCents: null,
    } satisfies CompositionMenu);

    await vi.waitFor(() => expect(bouton).not.toBeDisabled());
    expect(await screen.findByText(/^Enregistré /)).toBeInTheDocument();
  });

  /**
   * ═══ DÉFAUT RÉEL, NON CORRIGÉ (hors zone d'écriture de cette mission) ═══
   *
   * Même défaut que sur `Produits.tsx` et `LieuxMarche.tsx` : `enregistrer()`
   * (`Menus.tsx`) ne consulte jamais `enregistrement` avant de reposter. Le
   * bouton « Enregistrer » est bien `disabled={enregistrement === 'enregistrement'}`,
   * ce qui bloque un second CLIC — mais Ctrl+S est lu par le `onKeyDown` du
   * `<div>` racine et appelle `enregistrer()` sans jamais regarder cet état.
   * Un second Ctrl+S pendant l'envoi CONTOURNE donc le bouton désactivé et
   * repart en DEUXIÈME requête POST — deux lignes de composition pour une
   * seule intention.
   *
   * Ce test échoue intentionnellement : il décrit le comportement SAIN (une
   * seule requête), que le code actuel ne tient pas.
   */
  it.fails(
    'DÉFAUT RÉEL : un second Ctrl+S pendant l’envoi contourne le bouton `disabled` et poste une deuxième fois',
    async () => {
      const resolveurs: Array<(valeur: unknown) => void> = [];
      const poster = vi.fn(() => new Promise((resoudre) => resolveurs.push(resoudre)));
      brancherApi({ ...reponsesNominales(120), 'POST /menus/p-menu/composition': poster });
      monter();
      await choisirLeMenu();
      await screen.findByRole('columnheader', { name: 'Part du prix (€)' });

      await userEvent.selectOptions(
        screen.getByRole('combobox', { name: /Produit inclus/ }),
        'p-crepe',
      );
      const champQuantite = screen.getByRole('textbox', { name: /Quantité dans le menu/ });
      await userEvent.type(champQuantite, '2');

      await userEvent.keyboard('{Control>}s{/Control}');
      expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

      // Le bouton est déjà `disabled` — et pourtant rien n'empêche ce second
      // Ctrl+S d'appeler `enregistrer()` une deuxième fois.
      await userEvent.keyboard('{Control>}s{/Control}');

      // Toujours résoudre AVANT l'assertion qui échoue, sinon les promesses
      // fuient dans le test suivant.
      resolveurs.forEach((r) =>
        r({
          id: 'c-new',
          menuId: 'p-menu',
          produitInclusId: 'p-crepe',
          nomProduitInclus: 'Crêpe froment nature',
          nature: 'transforme',
          quantite: 2,
          prixCatalogueCents: 350,
          actif: true,
          prixForceCents: null,
        } satisfies CompositionMenu),
      );

      expect(poster).toHaveBeenCalledTimes(1);
    },
  );
});
