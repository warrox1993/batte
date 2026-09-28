/**
 * Écran RECETTES, MONTÉ pour de vrai (jsdom, D-095 du 01/08/2026).
 *
 * ═══ Pourquoi c'était le plus gros trou du dépôt (11 % couverts) ═══
 *
 * Presque tout, sur cet écran, arrive APRÈS le premier rendu : la liste est
 * chargée par un effet, la première recette est SÉLECTIONNÉE automatiquement,
 * sa fiche est chargée par un second effet, et le calculateur — qui n'a
 * volontairement aucun bouton « Calculer » — part d'un `setTimeout` de 250 ms
 * après chaque frappe. `renderToStaticMarkup` s'arrête avant tout cela : il
 * voit un panneau « Chargement des recettes… » et un calculateur vide, et rien
 * d'autre. `Recettes.test.tsx`, à côté, teste sept fonctions pures et le dit
 * lui-même à chaque bloc (« ce test ne prouve PAS que le focus arrive
 * réellement », « pas de preuve que la phrase apparaît dans le DOM ») : c'est
 * exactement ce vide-là que ce fichier comble. Le voisin n'est pas touché.
 *
 * ═══ Ce que la fixture doit pouvoir contredire ═══
 *
 * DEUX recettes de statuts et de maturités différents (une scellée par 4
 * productions, une brouillon vide), TROIS ingrédients dont UN SANS PRIX et UN
 * SANS ALLERGÈNES VÉRIFIÉS. Une recette dont tous les ingrédients ont un prix
 * ne prouverait rien sur l'affichage d'un coût inconnu ; une recette à un seul
 * ingrédient ne prouverait rien sur une mise à l'échelle ; une seule recette
 * ne prouverait rien sur le scellement (D-005), qui est la décision la plus
 * lourde de cet écran.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TIRET_ABSENT,
  formaterEuros,
  formaterMontant,
  type IngredientComplet,
  type RecetteDetail,
  type RecetteReferentiel,
  type RecetteResume,
  type ResultatCalcul,
} from '@batte/core';

// `ErreurApi` reste la VRAIE classe : trois `.catch` de cet écran distinguent
// un refus du serveur (message affichable tel quel) d'une panne (« Erreur
// inattendue »). Une classe factice ferait passer les deux pour des pannes.
// Import de TYPE uniquement (effacé à la compilation, donc insensible au
// hissage de `vi.mock`) : la forme `typeof import('...')` en position de
// type est refusée par `@typescript-eslint/consistent-type-imports`.
import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: Recettes } = await import('./Recettes');

type AppelApi = (chemin: string, options?: RequestInit) => Promise<unknown>;
const appelApi = vi.mocked(requeteApi) as unknown as ReturnType<typeof vi.fn<AppelApi>>;

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

const R1: RecetteResume = {
  id: 'r-1',
  code: 'R1',
  nom: 'Pâte à crêpes froment',
  version: 1,
  statut: 'active',
  sansGluten: false,
  rendementReferenceMl: 5000,
  rendementReferenceCrepes: 66,
  nbLignes: 3,
  coutParCrepeCents: 33,
};

/** Recette VIDE : `coutParCrepeCents` à `null`, jamais 0 — c'était l'état permanent de R2. */
const R2: RecetteResume = {
  id: 'r-2',
  code: 'R2',
  nom: 'Pâte sarrasin-châtaigne (sans gluten)',
  version: 1,
  statut: 'brouillon',
  sansGluten: true,
  rendementReferenceMl: 5000,
  rendementReferenceCrepes: 68,
  nbLignes: 0,
  coutParCrepeCents: null,
};

const REFERENTIEL: RecetteReferentiel[] = [
  {
    id: 'r-1',
    code: 'R1',
    nom: 'Pâte à crêpes froment',
    version: 1,
    statut: 'active',
    sansGluten: false,
    recetteParentId: null,
    nbLignes: 3,
    // > 0 : la recette est SCELLÉE (D-005), elle ne se modifie plus.
    nbProductions: 4,
    nbProduits: 2,
    notesTechniques: [
      {
        ingredientId: 'i-beurre',
        nomIngredient: 'Beurre',
        noteTechnique: 'Beurre noisette : ne pas dépasser la coloration.',
      },
    ],
  },
  {
    id: 'r-2',
    code: 'R2',
    nom: 'Pâte sarrasin-châtaigne (sans gluten)',
    version: 1,
    statut: 'brouillon',
    sansGluten: true,
    recetteParentId: null,
    nbLignes: 0,
    nbProductions: 0,
    nbProduits: 0,
    notesTechniques: [],
  },
];

function ingredient(
  champs: Partial<IngredientComplet> & Pick<IngredientComplet, 'id' | 'nom'>,
): IngredientComplet {
  return {
    categorie: 'farine',
    uniteReference: 'g',
    densiteGParMl: null,
    allergenes: [],
    allergenesVerifies: true,
    stockSecurite: 0,
    delaiLivraisonJours: null,
    dureeConservationJours: null,
    notes: null,
    actif: true,
    nbConditionnements: 1,
    coutUnitaireCents: 1,
    nbLignesRecette: 1,
    nbLots: 2,
    ...champs,
  };
}

const INGREDIENTS: IngredientComplet[] = [
  ingredient({
    id: 'i-farine',
    nom: 'Farine de froment T55',
    allergenes: ['gluten'],
    allergenesVerifies: true,
    coutUnitaireCents: 0.09,
  }),
  ingredient({
    id: 'i-beurre',
    nom: 'Beurre',
    categorie: 'laitier',
    allergenes: ['lait'],
    allergenesVerifies: true,
    coutUnitaireCents: 0.85,
  }),
  // Le cas qui compte : aucun conditionnement actif, donc AUCUN prix connu, et
  // des allergènes JAMAIS vérifiés. Deux inconnues indépendantes sur la même
  // ligne — c'est ce que la création rapide d'ingrédient (fiche 09) produit.
  ingredient({
    id: 'i-fleur-oranger',
    nom: 'Eau de fleur d’oranger',
    categorie: 'aromate',
    uniteReference: 'ml',
    allergenes: [],
    allergenesVerifies: false,
    nbConditionnements: 0,
    coutUnitaireCents: null,
    nbLots: 0,
  }),
];

const DETAIL_R1: RecetteDetail = {
  ...R1,
  typePate: 'froment',
  perteCuissonBp: 500,
  tauxCasseBp: 200,
  perteFixeMl: 100,
  procede: 'Mélanger, laisser reposer une heure.',
  notes: null,
  dateActivation: '2026-01-05',
  lignes: [
    {
      ingredientId: 'i-farine',
      nomIngredient: 'Farine de froment T55',
      unite: 'g',
      quantiteReference: 1208,
      cumpCentsParUnite: 0.09,
      allergenes: ['gluten'],
      ordre: 0,
      noteTechnique: null,
    },
    {
      ingredientId: 'i-beurre',
      nomIngredient: 'Beurre',
      unite: 'g',
      quantiteReference: 458,
      cumpCentsParUnite: 0.85,
      allergenes: ['lait'],
      ordre: 1,
      noteTechnique: 'Beurre noisette : ne pas dépasser la coloration.',
    },
    {
      ingredientId: 'i-fleur-oranger',
      nomIngredient: 'Eau de fleur d’oranger',
      unite: 'ml',
      quantiteReference: 33,
      cumpCentsParUnite: null,
      allergenes: [],
      ordre: 2,
      noteTechnique: null,
    },
  ],
};

const DETAIL_R2: RecetteDetail = {
  ...R2,
  typePate: 'sarrasin',
  perteCuissonBp: 500,
  tauxCasseBp: 200,
  perteFixeMl: 0,
  procede: null,
  notes: null,
  dateActivation: null,
  lignes: [],
};

/**
 * Réponse de `POST /recettes/r-1/calculer`. UN SEUL des trois coûts est
 * inconnu : c'est la seule configuration qui distingue « le total est inconnu
 * parce qu'une ligne l'est » de « rien n'est chiffrable ».
 */
const CALCUL_R1: ResultatCalcul = {
  facteur: 1,
  volumeMl: 5000,
  crepesTheoriques: 66,
  crepesVendables: 62,
  lignes: [
    {
      ...DETAIL_R1.lignes[0]!,
      quantite: 1208,
      coutCents: 109,
    },
    {
      ...DETAIL_R1.lignes[1]!,
      quantite: 458,
      coutCents: 389,
    },
    {
      ...DETAIL_R1.lignes[2]!,
      quantite: 33,
      coutCents: null,
    },
  ],
  // `null` dès qu'UNE SEULE ligne est inconnue : jamais 109 + 389 présenté
  // comme un total complet.
  coutMatiereCents: null,
  coutParCrepeCents: null,
  allergenes: ['gluten', 'lait'],
};

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
    'GET /recettes': () => Promise.resolve({ data: [R1, R2], meta: { total: 2 } }),
    'GET /referentiel/recettes': () =>
      Promise.resolve({ data: REFERENTIEL, meta: { total: REFERENTIEL.length } }),
    'GET /referentiel/ingredients': () =>
      Promise.resolve({ data: INGREDIENTS, meta: { total: INGREDIENTS.length } }),
    'GET /recettes/r-1': () => Promise.resolve(DETAIL_R1),
    'GET /recettes/r-2': () => Promise.resolve(DETAIL_R2),
    'POST /recettes/r-1/calculer': () => Promise.resolve(CALCUL_R1),
  };
}

function monter(): void {
  render(<Recettes />);
}

/** Le tableau du calculateur, repéré par un en-tête qui n'existe que là. */
async function tableauCalcul(): Promise<HTMLElement> {
  // Le calculateur part d'un debounce de 250 ms : `findBy…` attend jusqu'à
  // 1 s par défaut, ce qui couvre largement — aucun faux minuteur nécessaire.
  const enTete = await screen.findByRole('columnheader', { name: 'Coût (€)' });
  const table = enTete.closest('table');
  if (table === null) throw new Error('En-tête de calcul hors de tout tableau.');
  return table;
}

function celluleDeLigne(table: HTMLElement, nom: string | RegExp, index: number): HTMLElement {
  const ligne = within(table).getByRole('row', { name: nom });
  const cellule = within(ligne).getAllByRole('cell')[index];
  if (cellule === undefined) throw new Error(`Cellule ${index} absente de la ligne.`);
  return cellule;
}

/** Ligne d'un couple libellé/valeur (« Coût matière », « Coût par crêpe »). */
function ligneDe(libelle: string): HTMLElement {
  const intitule = screen.getByText(libelle);
  const parent = intitule.parentElement;
  if (parent === null) throw new Error(`« ${libelle} » n'a pas de conteneur.`);
  return parent;
}

/**
 * Normalise les espaces des DEUX côtés avant comparaison.
 *
 * `formaterEuros` passe par `Intl` et insère une espace INSÉCABLE avant le
 * « € » ; le DOM, lu par `toHaveTextContent`, est normalisé en espaces
 * ordinaires. Sans cette précaution, une assertion POSITIVE devient rouge pour
 * un caractère invisible — et, bien pire, une assertion NÉGATIVE
 * (« le total partiel ne doit pas apparaître ») devient verte sans rien
 * prouver. Le formateur reste la source : on ne tape jamais « 5,10 € » à la
 * main.
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

describe('Recettes — chargement, prêt, erreur', () => {
  it('charge la liste PUIS ouvre d’office la première recette : jamais un panneau vide devant des données', async () => {
    brancherApi(reponsesNominales());
    monter();

    expect(screen.getByText('Chargement des recettes…')).toBeInTheDocument();

    // La fiche technique de R1 s'ouvre sans le moindre clic.
    expect(
      await screen.findByRole('heading', { name: 'R1 v1 — Pâte à crêpes froment' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Pâte sarrasin-châtaigne/ })).toBeInTheDocument();
  });

  it('la liste en erreur affiche le message du serveur, et le calculateur reste utilisable en le disant', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /referentiel/ingredients': () =>
        Promise.reject(
          new ErreurApi('Le référentiel des ingrédients est momentanément indisponible.', {
            code: 'referentiel_indisponible',
            statut: 503,
          }),
        ),
    });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'référentiel des ingrédients est momentanément indisponible',
    );
    // Mode dégradé : le calculateur ne plante pas, il explique.
    expect(
      screen.getByText(/Sélectionnez une recette dans la liste pour utiliser le calculateur/),
    ).toBeInTheDocument();
  });

  it('la fiche en erreur laisse la LISTE intacte : on peut encore choisir une autre recette', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /recettes/r-1': () =>
        Promise.reject(
          new ErreurApi('Cette version a été archivée pendant votre lecture.', {
            code: 'recette_absente',
            statut: 404,
          }),
        ),
    });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent('archivée pendant votre lecture');
    expect(screen.getByRole('row', { name: /Pâte sarrasin-châtaigne/ })).toBeInTheDocument();
  });

  it('l’état vide de la liste propose de créer, au lieu de constater', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /recettes': () => Promise.resolve({ data: [], meta: { total: 0 } }),
      'GET /referentiel/recettes': () => Promise.resolve({ data: [], meta: { total: 0 } }),
    });
    monter();

    expect(await screen.findByText('Aucune recette enregistrée')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer une recette' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Inconnu ≠ zéro
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Recettes — un coût inconnu s’écrit « — », jamais « 0,00 »', () => {
  it('la colonne « Coût/crêpe » d’une recette VIDE porte le tiret, celle d’une recette chiffrée son montant', async () => {
    brancherApi(reponsesNominales());
    monter();

    const ligneR2 = await screen.findByRole('row', { name: /Pâte sarrasin-châtaigne/ });
    const celluleR2 = within(ligneR2).getAllByRole('cell')[3];
    expect(celluleR2).toHaveTextContent(TIRET_ABSENT);
    expect(celluleR2?.textContent ?? '').not.toContain(formaterMontant(0));

    const ligneR1 = screen.getByRole('row', { name: /Pâte à crêpes froment/ });
    expect(within(ligneR1).getAllByRole('cell')[3]).toHaveTextContent(formaterMontant(33));
  });

  it('la ligne de calcul sans prix porte le tiret, et les deux lignes chiffrées gardent leur coût', async () => {
    brancherApi(reponsesNominales());
    monter();
    const table = await tableauCalcul();

    expect(celluleDeLigne(table, /Eau de fleur d’oranger/, 2)).toHaveTextContent(TIRET_ABSENT);
    expect(celluleDeLigne(table, /Farine de froment/, 2)).toHaveTextContent(formaterMontant(109));
    expect(celluleDeLigne(table, /^Beurre/, 2)).toHaveTextContent(formaterMontant(389));
  });

  it('le TOTAL nomme l’ingrédient sans prix au lieu d’afficher une somme partielle', async () => {
    brancherApi(reponsesNominales());
    monter();
    await tableauCalcul();

    const coutMatiere = ligneDe('Coût matière');
    expect(coutMatiere).toHaveTextContent('Coût inconnu');
    expect(coutMatiere).toHaveTextContent('Eau de fleur d’oranger');
    // La somme des deux lignes connues (109 + 389 = 498 c) ne doit JAMAIS
    // s'afficher comme si elle était le total.
    expect(texteDe(coutMatiere)).not.toContain(normaliser(formaterEuros(498)));
  });

  it('le coût par crêpe reste « — » : dériver d’un total inconnu fabriquerait un chiffre faux', async () => {
    brancherApi(reponsesNominales());
    monter();
    await tableauCalcul();

    const coutParCrepe = ligneDe('Coût par crêpe');
    expect(coutParCrepe).toHaveTextContent(TIRET_ABSENT);
    expect(texteDe(coutParCrepe)).not.toContain(normaliser(formaterEuros(0)));
  });

  it('dès que tous les prix sont connus, le total est chiffré — le tiret n’est pas un état permanent', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /recettes/r-1/calculer': () =>
        Promise.resolve({
          ...CALCUL_R1,
          lignes: CALCUL_R1.lignes.map((l, i) => (i === 2 ? { ...l, coutCents: 12 } : l)),
          coutMatiereCents: 109 + 389 + 12,
          coutParCrepeCents: 8,
        }),
    });
    monter();
    await tableauCalcul();

    expect(texteDe(ligneDe('Coût matière'))).toContain(normaliser(formaterEuros(510)));
    expect(ligneDe('Coût matière')).not.toHaveTextContent('Coût inconnu');
    expect(texteDe(ligneDe('Coût par crêpe'))).toContain(normaliser(formaterEuros(8)));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Allergènes : « non vérifié » n'est pas « aucun »
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Recettes — allergènes', () => {
  it('une ligne dont l’ingrédient n’est pas vérifié dit « non vérifié », jamais un tiret ni le code brut', async () => {
    brancherApi(reponsesNominales());
    monter();

    const enTete = await screen.findByRole('columnheader', { name: 'Allergènes' });
    const fiche = enTete.closest('table');
    expect(fiche).not.toBeNull();
    const cellule = celluleDeLigne(fiche as HTMLElement, /Eau de fleur d’oranger/, 2);
    expect(cellule).toHaveTextContent('non vérifié');
    expect(cellule).not.toHaveTextContent(TIRET_ABSENT);
  });

  it('une ligne vérifiée affiche le libellé RÉGLEMENTAIRE, jamais le code « gluten »', async () => {
    brancherApi(reponsesNominales());
    monter();

    const enTete = await screen.findByRole('columnheader', { name: 'Allergènes' });
    const cellule = celluleDeLigne(enTete.closest('table') as HTMLElement, /Farine de froment/, 2);
    expect(cellule).toHaveTextContent('Céréales contenant du gluten');
  });

  it('le calculateur, lui aussi, refuse d’affirmer « aucun allergène » quand une ligne n’est pas vérifiée', async () => {
    brancherApi(reponsesNominales());
    monter();
    await tableauCalcul();

    const ligneAllergenes = screen.getByText(/^Allergènes\s*:/).parentElement;
    expect(ligneAllergenes).toHaveTextContent('non vérifié');
    expect(ligneAllergenes).not.toHaveTextContent('Aucun allergène déclaré');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D-005 : ce qui scelle une recette
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Recettes — une recette qui a servi ne se réécrit plus (D-005)', () => {
  it('une recette SCELLÉE n’offre que le versionnage, et dit combien de productions la scellent', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('heading', { name: 'R1 v1 — Pâte à crêpes froment' });

    expect(screen.getByRole('button', { name: 'Créer la version 2' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Modifier cette version' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/a déjà servi à/)).toHaveTextContent('4');
    // Le compte de produits rattachés doit être annoncé AVANT le clic.
    expect(screen.getByText(/2 produits de vente sont rattachés/)).toBeInTheDocument();
  });

  /**
   * Migration vers `../composants/champs-formulaire` (01/08/2026) :
   * `Recettes` posait `readOnly` en dur sur ce SEUL champ, traduit en
   * `lectureSeule` du composant partagé. Rien ne couvrait ce comportement
   * avant cette migration — une mutation qui aurait perdu le câblage de
   * `lectureSeule` ne faisait rougir AUCUN test existant, alors que le CODE
   * est justement ce qui ne doit PAS changer d'une version à l'autre d'une
   * même lignée (D-005) : le laisser modifiable en mode « nouvelle version »
   * romprait le lien entre les versions.
   */
  it('« Créer la version N+1 » ouvre le CODE en lecture seule (lectureSeule, D-005)', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('heading', { name: 'R1 v1 — Pâte à crêpes froment' });

    await userEvent.click(screen.getByRole('button', { name: 'Créer la version 2' }));

    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveAttribute('readonly');
    // Discriminant : un champ voisin, lui, reste modifiable — sinon un
    // `lectureSeule` posé PARTOUT par erreur rendrait ce test vert à tort.
    expect(screen.getByRole('textbox', { name: 'Type de pâte' })).not.toHaveAttribute('readonly');
  });

  it('une recette JAMAIS produite offre les deux gestes, nommés', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Pâte sarrasin-châtaigne/ }));

    expect(
      await screen.findByRole('button', { name: 'Modifier cette version' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer la version 2' })).toBeInTheDocument();
    expect(screen.getByText(/Aucun produit/)).toBeInTheDocument();
  });

  it('le calculateur d’une recette VIDE le dit, au lieu de rendre un formulaire inerte', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Pâte sarrasin-châtaigne/ }));

    expect(
      await screen.findByText(/Le calculateur sera disponible dès que cette recette contiendra/),
    ).toBeInTheDocument();
    // Et surtout : aucun calcul n'est lancé sur une recette sans ligne.
    expect(appelApi.mock.calls.some(([chemin]) => chemin === '/recettes/r-2/calculer')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Calculateur — saisie refusée
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Recettes — calculateur', () => {
  it('une saisie illisible dit CE QU’ON ATTEND, et n’envoie aucune requête de calcul', async () => {
    brancherApi(reponsesNominales());
    monter();
    await tableauCalcul();

    const appelsAvant = appelApi.mock.calls.filter(
      ([chemin]) => chemin === '/recettes/r-1/calculer',
    ).length;

    const champ = screen.getByLabelText('Volume de pâte visé (ml)');
    await userEvent.clear(champ);
    await userEvent.type(champ, 'abc');

    expect(
      await screen.findByText('Le volume doit être un nombre entier positif, en millilitres.'),
    ).toBeInTheDocument();
    expect(champ).toHaveAttribute('aria-invalid', 'true');
    // Le tableau de résultats disparaît : mieux vaut rien qu'un résultat périmé.
    expect(screen.queryByRole('columnheader', { name: 'Coût (€)' })).not.toBeInTheDocument();

    const appelsApres = appelApi.mock.calls.filter(
      ([chemin]) => chemin === '/recettes/r-1/calculer',
    ).length;
    expect(appelsApres).toBe(appelsAvant);
  });

  it('changer de cible repart d’une valeur RÉELLE de la recette, jamais d’un chiffre rond inventé', async () => {
    brancherApi(reponsesNominales());
    monter();
    await tableauCalcul();

    await userEvent.click(screen.getByRole('radio', { name: 'Un nombre de crêpes' }));

    // 66 = `rendementReferenceCrepes` de R1, pas « 100 ».
    expect(screen.getByLabelText('Nombre de crêpes vendables visé')).toHaveValue(
      String(R1.rendementReferenceCrepes),
    );
  });

  it('le refus du serveur sur un calcul s’affiche tel quel, sans effacer le formulaire', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /recettes/r-1/calculer': () =>
        Promise.reject(
          new ErreurApi('Cette recette ne produit aucune crêpe vendable : vérifiez ses pertes.', {
            code: 'rendement_nul',
            statut: 422,
          }),
        ),
    });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent('aucune crêpe vendable');
    expect(screen.getByLabelText('Volume de pâte visé (ml)')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Clavier et focus (CLAUDE.md §3 règle 10, D-079)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Recettes — clavier et focus', () => {
  it('« Activer » cède le focus à « Archiver », qui vient de prendre sa place (D-079)', async () => {
    brancherApi({
      ...reponsesNominales(),
      'PATCH /recettes/r-2/statut': () =>
        Promise.resolve({ ...DETAIL_R2, statut: 'active' as const }),
    });
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Pâte sarrasin-châtaigne/ }));

    await userEvent.click(await screen.findByRole('button', { name: 'Activer' }));

    const archiver = await screen.findByRole('button', { name: 'Archiver' });
    // Sans ce rappel, le focus retombait sur `<body>` : le bouton cliqué
    // disparaît légitimement, mais le clavier ne doit pas repartir de zéro.
    await vi.waitFor(() => expect(document.activeElement).toBe(archiver));
  });

  it('« Ajouter un ingrédient » amène le focus SUR la ligne créée, pas sur le bouton', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Pâte sarrasin-châtaigne/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier cette version' }));

    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un ingrédient' }));

    const selectLigne1 = screen.getByRole('combobox', { name: 'Ingrédient de la ligne 1' });
    await vi.waitFor(() => expect(document.activeElement).toBe(selectLigne1));
  });

  it('« Retirer » rend le focus au bouton d’ajout : jamais `<body>` au milieu d’une composition', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Pâte sarrasin-châtaigne/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier cette version' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un ingrédient' }));

    await userEvent.click(screen.getByRole('button', { name: 'Retirer la ligne 1' }));

    const ajouter = screen.getByRole('button', { name: 'Ajouter un ingrédient' });
    await vi.waitFor(() => expect(document.activeElement).toBe(ajouter));
  });

  it('Ctrl+S ne déclenche RIEN en consultation — il n’y a rien à enregistrer', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('heading', { name: 'R1 v1 — Pâte à crêpes froment' });

    screen.getByLabelText('Volume de pâte visé (ml)').focus();
    await userEvent.keyboard('{Control>}s{/Control}');

    expect(appelApi.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
    expect(appelApi.mock.calls.some(([chemin]) => chemin === '/recettes')).toBe(true);
  });

  it('Ctrl+S enregistre en édition, et un refus champ par champ focalise la ligne fautive', async () => {
    brancherApi({
      ...reponsesNominales(),
      'PATCH /recettes/r-2': () =>
        Promise.reject(
          new ErreurApi('Saisie refusée.', {
            code: 'saisie_invalide',
            statut: 422,
            champs: { nom: 'Une recette porte déjà ce nom dans cette lignée.' },
          }),
        ),
    });
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Pâte sarrasin-châtaigne/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier cette version' }));

    await userEvent.keyboard('{Control>}s{/Control}');

    expect(
      await screen.findByText('Une recette porte déjà ce nom dans cette lignée.'),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Nom de la recette/ }));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Un défaut trouvé en montant l'écran
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * DÉFAUT RÉEL trouvé le 01/08/2026, corrigé le même jour — le test est devenu
 * ordinaire (il était en `it.fails` le temps que le correctif atteigne sa zone
 * d'écriture).
 *
 * L'avertissement posé sous le `<select>` d'une ligne dont l'ingrédient n'a
 * aucun conditionnement affirmait : « son coût est compté comme 0 € tant
 * qu'aucun conditionnement ne lui est associé ». C'ÉTAIT vrai — le commentaire
 * au-dessus de ce bloc décrivait encore un `?? 0` dans la prévisualisation. Ça
 * ne l'était plus : `previsualisation` transmet `ingredient.coutUnitaireCents`
 * tel quel (`null` compris) à `mettreAEchelle`, qui rend `coutMatiereCents:
 * null`, et le panneau juste en dessous écrit « Coût inconnu : prix manquant
 * sur … ».
 *
 * Les deux phrases étaient donc affichées EN MÊME TEMPS, à trois centimètres
 * l'une de l'autre, et elles se contredisaient : l'une disait que le coût
 * valait zéro, l'autre qu'il était inconnu. C'est précisément la confusion que
 * la doctrine « inconnu ≠ zéro » existe pour interdire — ici retournée contre
 * elle-même, puisque le COMPORTEMENT était bon et que c'est le TEXTE qui
 * mentait. Un porteur qui lisait le premier message pouvait conclure que sa
 * marge était surestimée de la valeur de l'ingrédient, alors qu'elle n'est
 * simplement pas calculée.
 *
 * Le correctif porte donc sur le TEXTE seul : aucun calcul n'a été touché, et
 * l'assertion sur « Coût inconnu » ci-dessous le vérifie — si un correctif
 * futur ramenait un `?? 0` dans la prévisualisation pour « faire coller » les
 * deux messages, ce test le verrait.
 */
describe('Recettes — les deux messages de coût disent la même chose', () => {
  it('l’avertissement de ligne et le panneau de total s’accordent : inconnu, jamais zéro', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.click(await screen.findByRole('row', { name: /Pâte sarrasin-châtaigne/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier cette version' }));

    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un ingrédient' }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Ingrédient de la ligne 1' }),
      'i-fleur-oranger',
    );

    const avertissementLigne = await screen.findByText(/Aucun prix connu pour/);
    // Le message de LIGNE ne doit plus décrire un `?? 0` qui n'existe plus.
    expect(avertissementLigne).not.toHaveTextContent('compté comme 0');
    // Et il doit dire ce qui est vrai : inconnu, explicitement distingué de nul.
    expect(avertissementLigne).toHaveTextContent('inconnu');

    // Une quantité est nécessaire pour que la prévisualisation SORTE de l'état
    // « indisponible » et calcule vraiment : sans elle, le panneau du total
    // n'affiche rien et la contradiction ne serait pas reproduite à l'écran.
    await userEvent.type(screen.getByRole('textbox', { name: /Quantité de la ligne 1/ }), '4');

    // Le panneau du TOTAL, lui, disait déjà juste — c'est l'autre moitié de la
    // contradiction. Les deux doivent tenir ENSEMBLE, VISIBLES EN MÊME TEMPS :
    // vérifier le seul message de ligne laisserait passer un correctif qui
    // aurait aligné les textes en cassant le calcul (retour d'un `?? 0`, qui
    // ferait disparaître ce « Coût inconnu » au profit d'un montant chiffré).
    expect(await screen.findByText(/Coût inconnu/)).toBeInTheDocument();
    expect(screen.getByText(/Aucun prix connu pour/)).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Attente d'écriture — promesse CONTRÔLÉE (docs/39 §3, cinquième forme)

   Tous les tests d'enregistrement ci-dessus (« Ctrl+S enregistre… ») résolvent
   ou rejettent leur promesse IMMÉDIATEMENT : l'état `envoi` retombe dans le
   même écoulement de micro-tâches que sa pose et n'atteint jamais le DOM. Les
   deux blocs suivants couvrent les DEUX emplacements `disabled` de cet écran :
   le bouton de la FICHE (`disabled={envoi === 'envoi'}`) et celui — un
   booléen NU, pas une comparaison — de la création rapide d'ingrédient
   (`disabled={envoi}`, fiche 09).
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Recettes — attente d’écriture : la FICHE l’annonce, puis redevient actionnable', () => {
  it(
    'pendant le PATCH, « Enregistrer les modifications » est `disabled` ; au succès le mode se ' +
      'referme et les deux gestes nommés (D-005) redeviennent disponibles',
    async () => {
      let repondre: ((valeur: unknown) => void) | undefined;
      brancherApi({
        ...reponsesNominales(),
        'PATCH /recettes/r-2': () =>
          new Promise((resoudre) => {
            repondre = resoudre;
          }),
      });
      monter();
      await userEvent.click(await screen.findByRole('row', { name: /Pâte sarrasin-châtaigne/ }));
      await userEvent.click(await screen.findByRole('button', { name: 'Modifier cette version' }));

      const bouton = screen.getByRole('button', { name: 'Enregistrer les modifications' });
      await userEvent.click(bouton);

      // 1. L'attente est ANNONCÉE : le bouton s'inertise.
      expect(bouton).toBeDisabled();
      /*
        2. Un second clic ou une Entrée sur CE bouton ne prouveraient rien :
        `disabled` natif, bloqué par le navigateur lui-même. Ctrl+S, qui
        appelle la MÊME fonction `enregistrer()` que ce bouton (pas un chemin
        distinct), ne le contourne donc PAS — à la différence du bouton de la
        création rapide d'ingrédient, ci-dessous, contourné par un chemin
        clavier DIFFÉRENT (voir le test (ex-`it.fails`) plus bas).
      */

      repondre?.(DETAIL_R2);

      // 3. Au succès, le mode se referme : le bouton disparaît, remplacé par
      // les deux gestes nommés (D-005), redevenus actionnables — la preuve
      // que le formulaire n'est plus « en vol ».
      expect(
        await screen.findByRole('button', { name: 'Modifier cette version' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Créer la version 2' })).toBeInTheDocument();
      expect(screen.getByText(/enregistrée/)).toBeInTheDocument();
    },
  );
});

describe('Recettes — attente d’écriture : la création rapide d’ingrédient (fiche 09) l’annonce, puis redevient actionnable', () => {
  it(
    '« Créer et utiliser dans cette ligne » s’inertise pendant le POST ; au succès le ' +
      'mini-formulaire disparaît et le focus part vers la quantité de la MÊME ligne',
    async () => {
      let repondre: ((valeur: unknown) => void) | undefined;
      brancherApi({
        ...reponsesNominales(),
        'POST /ingredients': () =>
          new Promise((resoudre) => {
            repondre = resoudre;
          }),
      });
      monter();

      await userEvent.click(await screen.findByRole('row', { name: /Pâte sarrasin-châtaigne/ }));
      await userEvent.click(await screen.findByRole('button', { name: 'Modifier cette version' }));
      await userEvent.click(screen.getByRole('button', { name: 'Ajouter un ingrédient' }));
      // La valeur sentinelle `OPTION_CREER_INGREDIENT` n'est pas exportée de
      // `Recettes.tsx` : on la vise par son LIBELLÉ visible, jamais recopiée
      // à la main (elle serait périmée sans qu'aucun test ne le signale).
      await userEvent.selectOptions(
        screen.getByRole('combobox', { name: 'Ingrédient de la ligne 1' }),
        screen.getByRole('option', { name: '+ Créer un nouvel ingrédient…' }),
      );

      await userEvent.type(screen.getByRole('textbox', { name: 'Nom' }), 'Cannelle');
      const bouton = screen.getByRole('button', { name: 'Créer et utiliser dans cette ligne' });
      await userEvent.click(bouton);

      // 1. L'attente est ANNONCÉE : le bouton s'inertise.
      expect(bouton).toBeDisabled();
      /*
        2. Un second clic sur CE bouton ne prouverait rien : `disabled` natif,
        bloqué par le navigateur. Le chemin qui contourne RÉELLEMENT ce
        mini-formulaire — Entrée dans le champ Nom, captée par le
        `<div onKeyDown>` englobant SANS lire `envoi` — est démontré à part,
        en `it.fails` ci-dessous : mélanger les deux preuves dans un seul test
        masquerait laquelle des deux assertions a fait rougir un futur
        correctif.
      */

      repondre?.(ingredient({ id: 'i-cannelle', nom: 'Cannelle' }));

      // 3. Au succès, le mini-formulaire disparaît ENTIÈREMENT
      // (`creationIngredient` redevient `null`) : c'est la preuve que le
      // contrôle est redevenu actionnable, puisque le bouton lui-même ne
      // survit pas au succès. Le focus part vers la quantité de la MÊME
      // ligne — l'étape suivante logique de la saisie.
      await vi.waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Créer et utiliser dans cette ligne' }),
        ).not.toBeInTheDocument(),
      );
      const quantiteLigne1 = screen.getByRole('textbox', { name: /Quantité de la ligne 1/ });
      await vi.waitFor(() => expect(document.activeElement).toBe(quantiteLigne1));
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   Défaut RÉEL trouvé en lisant la production — corrigé le 28/09/2026
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Recettes — défaut RÉEL : la création rapide d’ingrédient n’a AUCUN garde-fou contre un second envoi', () => {
  /**
   * `it.fails` (docs/39 §8). Le bouton « Créer et utiliser dans cette ligne »
   * DEVIENT bien `disabled` pendant l'envoi (`disabled={envoi}`, un booléen —
   * RAS de ce côté). Mais le `<div onKeyDown>` qui enveloppe le
   * mini-formulaire (ajouté pour reproduire le confort d'Entrée SANS imbriquer
   * un second `<form>` — voir le commentaire de tête de
   * `FormulaireIngredientRapide`, `Recettes.tsx`) appelle `onCreer()` SANS
   * jamais lire `etat.envoi`, et `creerIngredientRapide()` lui-même ne porte
   * AUCUN garde `if (creationIngredient.envoi) return;` en tête de fonction —
   * à la différence de `basculerActivite` dans `Ingredients.tsx`, qui EN a un
   * (`if (choisi === null || envoi === 'envoi') return;`, même patron). Une
   * seconde touche Entrée dans le champ « Nom », PENDANT l'aller-retour,
   * envoie donc un second `POST /ingredients` — un doublon de référentiel,
   * retenu ou non selon le seul hasard d'une réponse déjà revenue. Trouvé en
   * lisant la production le 02/08/2026 ; CORRIGÉ le 28/09/2026 par la garde
   * `if (creationIngredient.envoi) return;`. Le test, en `it.fails`
   * jusque-là, est devenu un test ordinaire.
   */
  it('une seconde touche Entrée PENDANT l’envoi ne devrait PAS partir en second POST /ingredients', async () => {
    const resolveurs: Array<(valeur: unknown) => void> = [];
    brancherApi({
      ...reponsesNominales(),
      'POST /ingredients': () => new Promise((resoudre) => resolveurs.push(resoudre)),
    });
    monter();

    await userEvent.click(await screen.findByRole('row', { name: /Pâte sarrasin-châtaigne/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier cette version' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un ingrédient' }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Ingrédient de la ligne 1' }),
      screen.getByRole('option', { name: '+ Créer un nouvel ingrédient…' }),
    );

    const nom = screen.getByRole('textbox', { name: 'Nom' });
    await userEvent.type(nom, 'Cannelle');
    await userEvent.click(
      screen.getByRole('button', { name: 'Créer et utiliser dans cette ligne' }),
    );

    try {
      expect(
        screen.getByRole('button', { name: 'Créer et utiliser dans cette ligne' }),
      ).toBeDisabled();
      // Entrée dans le champ NE PASSE PAS par ce bouton `disabled`.
      await userEvent.type(nom, '{Enter}');

      expect(
        appelApi.mock.calls.filter(
          ([chemin, options]) => chemin === '/ingredients' && options?.method === 'POST',
        ),
      ).toHaveLength(1);
    } finally {
      resolveurs.forEach((resoudre) => resoudre(ingredient({ id: 'i-cannelle', nom: 'Cannelle' })));
    }
  });
});
