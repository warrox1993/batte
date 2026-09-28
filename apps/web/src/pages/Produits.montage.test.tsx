/**
 * Écran PRODUITS, MONTÉ pour de vrai (jsdom, D-095 du 01/08/2026).
 *
 * ═══ Ce que `Produits.test.tsx`, à côté, ne POUVAIT pas voir ═══
 *
 * Le fichier voisin teste `corpsSaisieProduit`, `erreursSaisieProduit` et
 * `affichageCoutRevientProduit` — trois fonctions pures, correctement
 * testées, et intouchées ici. Elles décident CE QU'IL FAUDRAIT écrire ; rien
 * ne prouvait que l'écran l'écrit. Or l'encart « Coût de revient » n'existe
 * qu'une fois une ligne SÉLECTIONNÉE (`coutSelection !== null`), donc après un
 * clic — état hors de portée de `renderToStaticMarkup`, qui rend l'écran une
 * fois, sans données, sans sélection.
 *
 * ═══ Ce que la fixture doit pouvoir contredire ═══
 *
 * Le catalogue porte les TROIS natures ensemble (§6 : transformé ≈ 90 % de
 * marge, revendu ≈ 30-40 %, menu sans coût propre) et DEUX coûts inconnus de
 * causes différentes — une recette sans prix, et un composant de nomenclature
 * de vente nommément identifié. Un catalogue où tous les coûts sont connus ne
 * prouverait rien sur l'affichage d'un coût inconnu ; un catalogue d'une seule
 * nature ne prouverait rien sur la ventilation qui alimente les seuils légaux.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  TIRET_ABSENT,
  formaterMontant,
  formaterPourcent,
  type CoutProduitVenduContrat,
  type IngredientReferentiel,
  type MenuResume,
  type Produit,
  type RecetteResume,
} from '@batte/core';

// `ErreurApi` reste la VRAIE classe : `enregistrer` fait `erreur instanceof
// ErreurApi && erreur.champs !== undefined` pour décider s'il pose les erreurs
// SOUS les champs ou un bandeau global. Une classe factice enverrait tout dans
// le bandeau, et les tests de champ seraient verts sans rien prouver.
// Import de TYPE uniquement (effacé à la compilation, donc insensible au
// hissage de `vi.mock`) : la forme `typeof import('...')` en position de
// type est refusée par `@typescript-eslint/consistent-type-imports`.
import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: Produits } = await import('./Produits');

type AppelApi = (chemin: string, options?: RequestInit) => Promise<unknown>;
const appelApi = vi.mocked(requeteApi) as unknown as ReturnType<typeof vi.fn<AppelApi>>;

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function produit(champs: Partial<Produit> & Pick<Produit, 'id' | 'nom' | 'nature'>): Produit {
  return {
    recetteId: null,
    recetteLibelle: null,
    ingredientId: null,
    ingredientNom: null,
    prixCents: 350,
    consommationUnite: null,
    nbCrepes: null,
    volumeMlParUnite: null,
    categorie: null,
    consommationSurPlace: false,
    actif: true,
    ...champs,
  };
}

const PRODUITS: Produit[] = [
  produit({
    id: 'p-crepe',
    nom: 'Crêpe froment / Sirop de Liège',
    nature: 'transforme',
    recetteId: 'r-1',
    recetteLibelle: 'R1 v1 — Pâte à crêpes froment',
    consommationUnite: 'crepes',
    nbCrepes: 1,
    prixCents: 350,
  }),
  produit({
    id: 'p-cafe',
    nom: 'Café',
    nature: 'transforme',
    recetteId: 'r-1',
    consommationUnite: 'nomenclature',
    nbCrepes: 0,
    prixCents: 200,
  }),
  produit({
    id: 'p-sirop',
    nom: 'Pot de sirop de Liège 450 g',
    nature: 'revendu',
    ingredientId: 'i-sirop',
    ingredientNom: 'Sirop de Liège',
    prixCents: 620,
  }),
  produit({ id: 'p-menu', nom: 'Formule du marché', nature: 'menu', prixCents: 733 }),
  produit({ id: 'p-retire', nom: 'Crêpe au sucre (retirée)', nature: 'transforme', actif: false }),
];

function cout(
  champs: Partial<CoutProduitVenduContrat> &
    Pick<CoutProduitVenduContrat, 'produitVenteId' | 'nom' | 'nature' | 'prixVenteCents'>,
): CoutProduitVenduContrat {
  return {
    coutPateCents: 0,
    coutAchatCents: 0,
    coutGarnituresCents: 0,
    coutComposantsCents: 0,
    coutMatiereCents: null,
    margeCents: null,
    margeBp: null,
    garnitures: [],
    composants: [],
    allergenes: [],
    ...champs,
  };
}

/**
 * Trois lignes de coût, TROIS situations distinctes — c'est ce qui rend la
 * fixture discriminante :
 *  - la crêpe : coût CONNU (33 c) et marge chiffrée ;
 *  - le café : coût INCONNU à cause d'un composant de vente nommé
 *    (« Café en grains »), la troisième cause que
 *    `avertissementCoutRevientInconnu` sait nommer ;
 *  - le sirop revendu : coût INCONNU sans composant en cause (aucun
 *    conditionnement actif) — même absence, message différent.
 * Le menu, lui, n'a AUCUNE ligne : `listerCoutsRevientProduits` l'omet.
 */
const COUTS: CoutProduitVenduContrat[] = [
  cout({
    produitVenteId: 'p-crepe',
    nom: 'Crêpe froment / Sirop de Liège',
    nature: 'transforme',
    prixVenteCents: 350,
    coutPateCents: 33,
    coutMatiereCents: 33,
    margeCents: 317,
    margeBp: 9057,
  }),
  cout({
    produitVenteId: 'p-cafe',
    nom: 'Café',
    nature: 'transforme',
    prixVenteCents: 200,
    coutComposantsCents: null,
    coutMatiereCents: null,
    composants: [
      {
        ingredientId: 'i-cafe-grains',
        nomIngredient: 'Café en grains',
        unite: 'g',
        quantiteUniteRef: 7,
        quantiteReferenceUnites: 1,
        cumpCentsParUnite: null,
        coutCents: null,
        allergenes: [],
        optionnel: false,
        consommationSurPlace: null,
        inclusDansLeCout: true,
      },
      {
        // Ligne OPTIONNELLE et sans prix : elle ne compte pour rien dans le
        // total, donc elle ne doit JAMAIS être désignée coupable. Sans elle,
        // le test ne distinguerait pas « nomme un composant » de « nomme le
        // bon composant ».
        ingredientId: 'i-creme',
        nomIngredient: 'Crème liquide',
        unite: 'ml',
        quantiteUniteRef: 20,
        quantiteReferenceUnites: 1,
        cumpCentsParUnite: null,
        coutCents: null,
        allergenes: ['lait'],
        optionnel: true,
        consommationSurPlace: null,
        inclusDansLeCout: false,
      },
    ],
  }),
  cout({
    produitVenteId: 'p-sirop',
    nom: 'Pot de sirop de Liège 450 g',
    nature: 'revendu',
    prixVenteCents: 620,
    coutAchatCents: 0,
    coutMatiereCents: null,
  }),
];

const RECETTES: RecetteResume[] = [
  {
    id: 'r-1',
    code: 'R1',
    nom: 'Pâte à crêpes froment',
    version: 1,
    statut: 'active',
    sansGluten: false,
    rendementReferenceMl: 5000,
    rendementReferenceCrepes: 66,
    nbLignes: 8,
    coutParCrepeCents: 33,
  },
];

const INGREDIENTS: IngredientReferentiel[] = [
  {
    id: 'i-sirop',
    nom: 'Sirop de Liège',
    categorie: 'garniture',
    unite: 'g',
    densiteGParMl: null,
    allergenes: [],
    allergenesVerifies: true,
    stockSecurite: 0,
    dureeConservationJours: null,
  },
];

/** `p-menu` est ABSENT de cette liste : c'est son absence qui dit « menu vide ». */
const MENUS_SANS_LE_NOTRE: MenuResume[] = [];

const MENUS_AVEC_COMPOSANTS: MenuResume[] = [
  {
    id: 'p-menu',
    nom: 'Formule du marché',
    nature: 'menu',
    prixCents: 733,
    actif: true,
    nbComposantsActifs: 3,
  },
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

function reponsesNominales(menus: MenuResume[] = MENUS_SANS_LE_NOTRE): Reponses {
  return {
    'GET /produits': () => Promise.resolve({ data: PRODUITS, meta: { total: PRODUITS.length } }),
    'GET /recettes': () => Promise.resolve({ data: RECETTES, meta: { total: RECETTES.length } }),
    'GET /ingredients': () =>
      Promise.resolve({ data: INGREDIENTS, meta: { total: INGREDIENTS.length } }),
    'GET /menus': () => Promise.resolve({ data: menus, meta: { total: menus.length } }),
    'GET /couts-produits': () => Promise.resolve({ data: COUTS, meta: { total: COUTS.length } }),
  };
}

function monter(): void {
  render(
    <MemoryRouter initialEntries={['/produits']}>
      <Produits />
    </MemoryRouter>,
  );
}

async function ouvrirLaFiche(nom: string | RegExp): Promise<void> {
  const ligne = await screen.findByRole('row', { name: nom });
  await userEvent.click(ligne);
}

/** L'encart « Coût de revient », repéré par son intitulé, jamais par sa position. */
function encartCout(): HTMLElement {
  const intitule = screen.getByText('Coût de revient');
  const encart = intitule.parentElement;
  if (encart === null) throw new Error("L'intitulé « Coût de revient » n'a pas de conteneur.");
  return encart;
}

/**
 * Compare deux textes APRÈS la même normalisation d'espaces.
 *
 * `formaterPourcent` (`@batte/core`) insère une espace insécable étroite
 * (U+202F) avant le « % », et `formaterMontant` une espace insécable dans les
 * milliers ; `toHaveTextContent` normalise, lui, les espaces du DOM en espace
 * ordinaire. Comparer directement rendait le test rouge pour un caractère
 * invisible — et surtout, taper « 91 % » à la main aurait produit un test qui
 * ne dit plus rien du formateur réel. On garde donc le formateur comme source,
 * et on normalise LES DEUX côtés.
 */
function normaliser(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim();
}

function texteDe(element: HTMLElement): string {
  return normaliser(element.textContent ?? '');
}

beforeEach(() => {
  appelApi.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Produits — chargement, prêt, erreur', () => {
  it('annonce le chargement, puis le remplace par la carte des produits', async () => {
    brancherApi(reponsesNominales());
    monter();

    expect(screen.getByText('Chargement des produits…')).toBeInTheDocument();

    expect(await screen.findByRole('row', { name: /Crêpe froment/ })).toBeInTheDocument();
    expect(screen.queryByText('Chargement des produits…')).not.toBeInTheDocument();
  });

  it('UNE seule requête en échec suffit à mettre tout l’écran en erreur, avec le message du serveur', async () => {
    brancherApi({
      ...reponsesNominales(),
      // Le coût est la CINQUIÈME requête du `Promise.all` : c'est justement
      // celle qu'on pourrait croire accessoire. Elle ne l'est pas.
      'GET /couts-produits': () =>
        Promise.reject(
          new ErreurApi("Le paramètre « tva_taux_bp » n'est pas défini.", {
            code: 'parametre_absent',
            statut: 500,
          }),
        ),
    });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent('tva_taux_bp');
    expect(screen.queryByRole('row', { name: /Crêpe froment/ })).not.toBeInTheDocument();
  });

  it('une valeur lancée qui n’est pas une ErreurApi ne fabrique jamais un faux message métier', async () => {
    brancherApi({ ...reponsesNominales(), 'GET /produits': () => Promise.reject(new TypeError()) });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent('Erreur inattendue');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Inconnu ≠ zéro
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Produits — un coût de revient inconnu ne vaut jamais zéro', () => {
  it('un coût CONNU s’affiche chiffré, avec sa marge et son taux', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLaFiche(/Crêpe froment/);

    const encart = encartCout();
    expect(texteDe(encart)).toContain(normaliser(formaterMontant(33)));
    expect(texteDe(encart)).toContain(normaliser(formaterMontant(317)));
    expect(texteDe(encart)).toContain(normaliser(formaterPourcent(9057)));
    // Rien à avertir quand tout est connu : un bandeau permanent cesse d'être lu.
    expect(within(encart).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('un coût INCONNU écrit « — » pour le coût ET pour la marge — 0,00 fabriquerait 100 % de marge', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLaFiche(/Pot de sirop de Liège/);

    const encart = encartCout();
    expect(encart).toHaveTextContent(TIRET_ABSENT);
    expect(texteDe(encart)).not.toContain(normaliser(formaterMontant(0)));
    // Le taux de marge ne doit pas non plus s'inventer : pas de « (100 %) ».
    expect(texteDe(encart)).not.toContain(normaliser(formaterPourcent(10000)));
  });

  it('nomme LE composant de vente fautif, et jamais l’option qui ne compte pas dans le total', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLaFiche(/^Café/);

    const avertissement = await within(encartCout()).findByRole('alert');
    expect(avertissement).toHaveTextContent('Café en grains');
    // « Crème liquide » est optionnelle : elle n'entre pas dans le coût, donc
    // elle n'est pas la cause. L'accuser enverrait chercher au mauvais endroit.
    expect(avertissement).not.toHaveTextContent('Crème liquide');
  });

  it('un REVENDU sans conditionnement actif renvoie vers l’achat, pas vers une recette qu’il n’a pas', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLaFiche(/Pot de sirop de Liège/);

    const avertissement = await within(encartCout()).findByRole('alert');
    expect(avertissement).toHaveTextContent('conditionnement actif');
    expect(avertissement).not.toHaveTextContent('recette');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Les trois natures
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Produits — les trois natures', () => {
  it('un MENU ne prétend pas avoir un coût de revient propre : il renvoie à l’écran Menus', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLaFiche(/Formule du marché/);

    const encart = encartCout();
    expect(encart).toHaveTextContent(TIRET_ABSENT);
    const avertissement = await within(encart).findByRole('alert');
    expect(avertissement).toHaveTextContent('se déduit de ses composants');
    expect(avertissement).toHaveTextContent('Menus');
  });

  it('un menu SANS composant actif est signalé comme la coquille dangereuse qu’il est', async () => {
    brancherApi(reponsesNominales(MENUS_SANS_LE_NOTRE));
    monter();
    await ouvrirLaFiche(/Formule du marché/);

    expect(await screen.findByText(/ne contient encore aucun composant actif/)).toBeInTheDocument();
  });

  it('le même menu, une fois composé, ne porte plus l’alerte — le signal reste rare', async () => {
    brancherApi(reponsesNominales(MENUS_AVEC_COMPOSANTS));
    monter();
    await ouvrirLaFiche(/Formule du marché/);

    await screen.findByRole('button', { name: /Définir la composition de ce menu/ });
    expect(screen.queryByText(/ne contient encore aucun composant actif/)).not.toBeInTheDocument();
  });

  it('changer la nature RETIRE de l’écran le champ devenu absurde, au lieu d’en refuser la valeur après coup', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLaFiche(/Crêpe froment/);

    // Un transformé porte « Recette » et « Une unité vendue consomme… ».
    expect(screen.getByRole('combobox', { name: 'Recette' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Une unité vendue consomme/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Menu — composé d’autres produits/ }));

    expect(screen.queryByRole('combobox', { name: 'Recette' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: /Une unité vendue consomme/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Un menu n’a ni recette ni article à rattacher ici/),
    ).toBeInTheDocument();
  });

  it('un détour par « revendu » PURGE la recette : revenir à « transformé » ne la restaure pas', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLaFiche(/Crêpe froment/);

    expect(screen.getByRole('combobox', { name: 'Recette' })).toHaveValue('r-1');

    await userEvent.click(screen.getByRole('radio', { name: /Revendu — acheté préemballé/ }));
    await userEvent.click(screen.getByRole('radio', { name: /Transformé — issu d’une recette/ }));

    // Le brouillon lui-même doit être propre, pas seulement le corps envoyé :
    // un `recetteId` survivant réapparaîtrait à l'écran comme un rattachement
    // toujours valide, alors que l'utilisateur vient de dire l'inverse.
    expect(screen.getByRole('combobox', { name: 'Recette' })).toHaveValue('');
  });

  it('bascule transformé → menu : le corps envoyé ne porte plus AUCUN reste du transformé', async () => {
    const enregistre = vi.fn(() =>
      Promise.resolve(
        produit({ id: 'p-crepe', nom: 'Crêpe froment / Sirop de Liège', nature: 'menu' }),
      ),
    );
    brancherApi({ ...reponsesNominales(), 'PATCH /produits/p-crepe': enregistre });
    monter();
    await ouvrirLaFiche(/Crêpe froment/);

    await userEvent.click(screen.getByRole('radio', { name: /Menu — composé d’autres produits/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await vi.waitFor(() => expect(enregistre).toHaveBeenCalled());
    const corps = JSON.parse(
      String(appelApi.mock.calls.find(([c]) => c === '/produits/p-crepe')?.[1]?.body),
    ) as Record<string, unknown>;
    expect(corps['nature']).toBe('menu');
    // Le rattachement d'un transformé partirait en 422 côté serveur ; l'écran
    // doit rendre la faute IMPOSSIBLE, pas seulement la faire refuser.
    expect(corps['recetteId']).toBeNull();
    expect(corps['ingredientId']).toBeNull();
    expect(corps['consommationUnite']).toBeNull();
    expect(corps['volumeMlParUnite']).toBeNull();
  });

  it('le filtre par nature ne garde QUE la nature demandée, et dit lequel filtre quand il ne reste rien', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Crêpe froment/ });

    await userEvent.click(screen.getByRole('radio', { name: 'Revendus' }));

    expect(screen.getByRole('row', { name: /Pot de sirop de Liège/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Crêpe froment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Formule du marché/ })).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   États vides
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Produits — états vides', () => {
  it('catalogue jamais rempli : une phrase de démarrage ET une action, pas un tableau muet', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /produits': () => Promise.resolve({ data: [], meta: { total: 0 } }),
      'GET /couts-produits': () => Promise.resolve({ data: [], meta: { total: 0 } }),
    });
    monter();

    expect(await screen.findByText('Aucun produit enregistré')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer un produit' })).toBeInTheDocument();
  });

  it('un filtre qui ne laisse rien NOMME le filtre en cause — jamais le texte du premier lancement', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /produits': () =>
        Promise.resolve({
          data: [produit({ id: 'p-x', nom: 'Crêpe nature', nature: 'transforme' })],
          meta: { total: 1 },
        }),
      'GET /couts-produits': () => Promise.resolve({ data: [], meta: { total: 0 } }),
    });
    monter();
    await screen.findByRole('row', { name: /Crêpe nature/ });

    await userEvent.click(screen.getByRole('radio', { name: 'Revendus' }));

    expect(screen.getByText(/ne correspond au filtre en cours/)).toBeInTheDocument();
    expect(screen.getByText(/Revendus/, { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('Aucun produit enregistré')).not.toBeInTheDocument();
    // Et la sortie de secours doit exister, pas seulement le constat.
    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser le filtre' }));
    expect(screen.getByRole('row', { name: /Crêpe nature/ })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Clavier (CLAUDE.md §3 règle 10)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Produits — clavier', () => {
  it('Ctrl+S enregistre depuis n’importe quel champ du formulaire', async () => {
    const enregistre = vi.fn(() => Promise.resolve(PRODUITS[0]));
    brancherApi({ ...reponsesNominales(), 'PATCH /produits/p-crepe': enregistre });
    monter();
    await ouvrirLaFiche(/Crêpe froment/);

    screen.getByRole('textbox', { name: 'Catégorie' }).focus();
    await userEvent.keyboard('{Control>}s{/Control}');

    await vi.waitFor(() => expect(enregistre).toHaveBeenCalledTimes(1));
  });

  it('un refus LOCAL amène le focus SUR le champ fautif — pas sur le bouton « Enregistrer »', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLaFiche(/Crêpe froment/);

    const champPrix = screen.getByRole('textbox', { name: 'Prix de vente (€)' });
    await userEvent.clear(champPrix);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(/Prix illisible/)).toBeInTheDocument();
    expect(document.activeElement).toBe(champPrix);
    expect(champPrix).toHaveAttribute('aria-invalid', 'true');
  });

  it('un refus SERVEUR champ par champ amène aussi le focus sur le premier champ fautif', async () => {
    brancherApi({
      ...reponsesNominales(),
      'PATCH /produits/p-crepe': () =>
        Promise.reject(
          new ErreurApi('Saisie refusée.', {
            code: 'saisie_invalide',
            statut: 422,
            champs: { nom: 'Ce nom est déjà pris par un autre produit.' },
          }),
        ),
    });
    monter();
    await ouvrirLaFiche(/Crêpe froment/);

    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByText('Ce nom est déjà pris par un autre produit.'),
    ).toBeInTheDocument();
    // `name: /Nom du produit/` et non l'égalité stricte : le `<label>` enveloppe
    // le champ ET le message d'erreur, si bien que le nom accessible du champ
    // devient « Nom du produit Ce nom est déjà pris… » dès qu'une erreur est
    // posée. C'est le nom réel, pas une approximation du test.
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Nom du produit/ }));
  });

  it('« Nouveau produit » ouvre une fiche vierge ET y amène le focus', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLaFiche(/Crêpe froment/);

    await userEvent.click(screen.getByRole('button', { name: 'Nouveau produit' }));

    const champNom = screen.getByRole('textbox', { name: 'Nom du produit' });
    await vi.waitFor(() => expect(document.activeElement).toBe(champNom));
    expect(champNom).toHaveValue('');
    // Une fiche neuve ne doit pas hériter du coût de la fiche précédente.
    expect(screen.queryByText('Coût de revient')).not.toBeInTheDocument();
  });

  it('une rangée du catalogue se choisit au clavier, sans souris', async () => {
    brancherApi(reponsesNominales());
    monter();
    const ligne = await screen.findByRole('row', { name: /Pot de sirop de Liège/ });

    ligne.focus();
    await userEvent.keyboard('{Enter}');

    expect(
      screen.getByRole('heading', { name: 'Pot de sirop de Liège 450 g' }),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   L'état d'enregistrement PENDANT la requête (docs/39 §3, cinquième forme)
   ═══════════════════════════════════════════════════════════════════════════

   Tout ce qui suit était INVISIBLE d'un `mockResolvedValue(...)` : la promesse
   déjà résolue retombe à `inchange`/`enregistre` dans le même écoulement de
   micro-tâches que sa pose, avant que le test n'ait pu observer quoi que ce
   soit. La requête est ici CONTRÔLÉE par le test — jamais résolue tant que le
   test ne l'a pas explicitement décidé, une fois l'attente observée.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Produits — l’état d’enregistrement, observé PENDANT que la requête est en vol', () => {
  it('le bouton « Enregistrer » devient inerte et l’indicateur dit « Enregistrement… », puis les deux redeviennent normaux', async () => {
    let repondre: ((valeur: unknown) => void) | undefined;
    const patch = vi.fn(
      () =>
        new Promise((resoudre) => {
          repondre = resoudre;
        }),
    );
    brancherApi({ ...reponsesNominales(), 'PATCH /produits/p-crepe': patch });
    monter();
    await ouvrirLaFiche(/Crêpe froment/);

    const bouton = screen.getByRole('button', { name: 'Enregistrer' });
    await userEvent.click(bouton);

    // La requête est EN VOL ici, et seulement ici : l'attente est annoncée par
    // DEUX canaux à la fois — le bouton natif `disabled` (règle 10 du clavier :
    // il n'utilise jamais `aria-disabled` seul) ET l'indicateur textuel.
    expect(bouton).toBeDisabled();
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();

    repondre?.(
      produit({
        id: 'p-crepe',
        nom: 'Crêpe froment / Sirop de Liège',
        nature: 'transforme',
        recetteId: 'r-1',
        consommationUnite: 'crepes',
        nbCrepes: 1,
        prixCents: 350,
      }),
    );

    // Redevenu actionnable : un bouton qui resterait `disabled` à vie après
    // une réponse serait pire que l'absence d'indicateur.
    await vi.waitFor(() => expect(bouton).not.toBeDisabled());
    expect(await screen.findByText(/^Enregistré /)).toBeInTheDocument();
  });

  /**
   * ═══ DÉFAUT RÉEL, CORRIGÉ LE 28/09/2026 (était en `it.fails`) ═══
   *
   * `enregistrer()` (`Produits.tsx`) ne vérifie JAMAIS `enregistrement.phase`
   * avant de repartir en réseau. Le bouton « Enregistrer » porte bien
   * `disabled={enregistrement.phase === 'enregistrement'}`, ce qui bloque un
   * second CLIC ou une seconde touche Entrée sur ce bouton — mais Ctrl+S est
   * lu par le `onKeyDown` du `<div>` racine, qui appelle `enregistrer()`
   * DIRECTEMENT, sans jamais consulter cet état. Un second Ctrl+S, frappé
   * pendant que le premier est encore en vol, CONTOURNE donc le bouton
   * désactivé et repart en DEUXIÈME requête PATCH — deux écritures pour une
   * seule intention, sur un écran qui décide la ventilation transformé/revendu
   * des seuils légaux (CLAUDE.md §6).
   *
   * Ce test décrit le comportement SAIN (une seule requête). Il était en
   * `it.fails` jusqu'au correctif : une garde en tête de `enregistrer()`
   * refuse un second départ tant que le premier est en vol.
   */
  it('un second Ctrl+S pendant l’envoi ne contourne plus le bouton `disabled` : une seule requête (défaut corrigé le 28/09/2026)', async () => {
    const resolveurs: Array<(valeur: unknown) => void> = [];
    const patch = vi.fn(() => new Promise((resoudre) => resolveurs.push(resoudre)));
    brancherApi({ ...reponsesNominales(), 'PATCH /produits/p-crepe': patch });
    monter();
    await ouvrirLaFiche(/Crêpe froment/);

    // Un champ SANS conséquence sur la validité du corps envoyé : la seule
    // chose qui compte ici est que le focus reste DANS le formulaire.
    const champCategorie = screen.getByRole('textbox', { name: 'Catégorie' });
    champCategorie.focus();

    await userEvent.keyboard('{Control>}s{/Control}');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

    // Le bouton est déjà `disabled` — et pourtant rien n'empêche ce second
    // Ctrl+S d'appeler `enregistrer()` une deuxième fois.
    await userEvent.keyboard('{Control>}s{/Control}');

    // Toujours résoudre AVANT l'assertion qui échoue, sinon les promesses
    // du mock fuient dans le test suivant (elles ne seraient jamais
    // consommées si l'assertion ci-dessous interrompt le test en premier).
    resolveurs.forEach((r) =>
      r(
        produit({
          id: 'p-crepe',
          nom: 'Crêpe froment / Sirop de Liège',
          nature: 'transforme',
          recetteId: 'r-1',
          consommationUnite: 'crepes',
          nbCrepes: 1,
          prixCents: 350,
        }),
      ),
    );

    expect(patch).toHaveBeenCalledTimes(1);
  });
});
