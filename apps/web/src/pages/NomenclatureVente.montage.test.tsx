/**
 * Écran NOMENCLATURE DE VENTE, MONTÉ pour de vrai (jsdom, D-095 du 01/08/2026).
 *
 * ═══ Ce que `NomenclatureVente.test.tsx`, à côté, ne POUVAIT pas voir ═══
 *
 * Le fichier voisin teste `erreursSaisieComposantVente` et
 * `coutLotReferenceCents` — deux fonctions pures, correctement testées, et
 * intouchées ici. Toutes deux portent des commentaires qui disent la limite
 * (« exportée pour rester testable sans monter l'écran »). Or le tableau où
 * ce coût s'affiche n'existe qu'une fois un produit CHOISI dans un
 * `<select>`, ce qui
 * déclenche une seconde requête : au premier rendu, `produitId === ''` et
 * l'écran ne montre qu'un état vide.
 *
 * ═══ Ce que la fixture doit pouvoir contredire ═══
 *
 * TROIS composants aux situations distinctes : un gobelet à lot de référence 1
 * et prix connu, une pincée de cannelle à lot 100 (le cas pour lequel tout
 * l'écran existe — 0,3 c par café s'afficherait « 0,00 € » si on divisait),
 * et une crème OPTIONNELLE sans prix. Un seul composant à lot 1 et prix connu
 * ne prouverait ni la multiplication par le lot, ni le refus d'écrire zéro.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  formaterMontant,
  type ComposantVente,
  type IngredientReferentiel,
  type Produit,
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
const { default: NomenclatureVente, coutLotReferenceCents } = await import('./NomenclatureVente');

type AppelApi = (chemin: string, options?: RequestInit) => Promise<unknown>;
const appelApi = vi.mocked(requeteApi) as unknown as ReturnType<typeof vi.fn<AppelApi>>;

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function produit(champs: Pick<Produit, 'id' | 'nom' | 'nature'>): Produit {
  return {
    recetteId: null,
    recetteLibelle: null,
    ingredientId: null,
    ingredientNom: null,
    prixCents: 200,
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
  produit({ id: 'p-cafe', nom: 'Café', nature: 'transforme' }),
  produit({ id: 'p-sirop', nom: 'Pot de sirop de Liège', nature: 'revendu' }),
  produit({ id: 'p-menu', nom: 'Formule du marché', nature: 'menu' }),
];

const INGREDIENTS: IngredientReferentiel[] = [
  {
    id: 'i-gobelet',
    nom: 'Gobelet carton 25 cl',
    categorie: 'consommable',
    unite: 'piece',
    densiteGParMl: null,
    allergenes: [],
    allergenesVerifies: true,
    stockSecurite: 50,
    dureeConservationJours: null,
  },
  {
    id: 'i-cannelle',
    nom: 'Cannelle moulue',
    categorie: 'aromate',
    unite: 'g',
    densiteGParMl: null,
    allergenes: [],
    allergenesVerifies: true,
    stockSecurite: 0,
    dureeConservationJours: null,
  },
];

function composant(
  champs: Partial<ComposantVente> & Pick<ComposantVente, 'id' | 'nomIngredient'>,
): ComposantVente {
  return {
    produitVenteId: 'p-cafe',
    ingredientId: 'i-x',
    unite: 'g',
    quantiteUniteRef: 1,
    quantiteReferenceUnites: 1,
    cumpCentsParUnite: 1,
    allergenes: [],
    consommationSurPlace: null,
    optionnel: false,
    actif: true,
    coutIndicatifCentsParUnite: 1,
    ...champs,
  };
}

const COMPOSANTS: ComposantVente[] = [
  composant({
    id: 'cv-1',
    ingredientId: 'i-gobelet',
    nomIngredient: 'Gobelet carton 25 cl',
    unite: 'piece',
    quantiteUniteRef: 1,
    quantiteReferenceUnites: 1,
    cumpCentsParUnite: 4.5,
    coutIndicatifCentsParUnite: 4.5,
    consommationSurPlace: false,
  }),
  // LE cas pour lequel cet écran existe : 20 g pour 100 cafés = 0,3 c par
  // café. Divisé, cela s'écrirait « 0,00 € » et passerait pour gratuit.
  composant({
    id: 'cv-2',
    ingredientId: 'i-cannelle',
    nomIngredient: 'Cannelle moulue',
    unite: 'g',
    quantiteUniteRef: 20,
    quantiteReferenceUnites: 100,
    cumpCentsParUnite: 1.5,
    coutIndicatifCentsParUnite: 0.3,
  }),
  // Optionnelle ET sans prix : deux distinctions dans la même ligne.
  composant({
    id: 'cv-3',
    ingredientId: 'i-creme',
    nomIngredient: 'Crème liquide',
    unite: 'ml',
    quantiteUniteRef: 20,
    quantiteReferenceUnites: 1,
    cumpCentsParUnite: null,
    coutIndicatifCentsParUnite: null,
    optionnel: true,
    allergenes: ['lait'],
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
    'GET /produits': () => Promise.resolve({ data: PRODUITS, meta: { total: PRODUITS.length } }),
    'GET /ingredients': () =>
      Promise.resolve({ data: INGREDIENTS, meta: { total: INGREDIENTS.length } }),
    'GET /produits/p-cafe/composants': () =>
      Promise.resolve({ data: COMPOSANTS, meta: { total: COMPOSANTS.length } }),
    'GET /produits/p-menu/composants': () => Promise.resolve({ data: [], meta: { total: 0 } }),
  };
}

function monter(entree = '/nomenclature-vente'): void {
  render(
    <MemoryRouter initialEntries={[entree]}>
      <NomenclatureVente />
    </MemoryRouter>,
  );
}

async function choisirLeCafe(): Promise<void> {
  await userEvent.selectOptions(await screen.findByLabelText(/Choisir un produit/), 'p-cafe');
}

function ligneDuTableau(nom: string | RegExp): HTMLElement {
  return screen.getByRole('row', { name: nom });
}

function celluleDe(nom: string | RegExp, index: number): HTMLElement {
  const cellule = within(ligneDuTableau(nom)).getAllByRole('cell')[index];
  if (cellule === undefined) throw new Error(`Cellule ${index} absente.`);
  return cellule;
}

beforeEach(() => {
  appelApi.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Nomenclature de vente — chargement, prêt, erreur', () => {
  it('sans produit choisi, l’écran dit quoi faire — jamais un tableau vide sans phrase', async () => {
    brancherApi(reponsesNominales());
    monter();

    expect(await screen.findByText('Choisissez un produit')).toBeInTheDocument();
    expect(
      screen.getByText(/Sélectionnez un produit ci-dessus pour déclarer ce qu'il consomme/),
    ).toBeInTheDocument();
  });

  it('le pont depuis l’écran Produits (`?produit=…`) ouvre directement le bon produit', async () => {
    brancherApi(reponsesNominales());
    monter('/nomenclature-vente?produit=p-cafe');

    expect(
      await screen.findByRole('heading', { name: /Composants de « Café »/ }),
    ).toBeInTheDocument();
    // Le titre du panneau arrive AVANT la réponse de `/composants` : attendre
    // la ligne, et non la lire aussitôt, est ce que fait l'œil du porteur.
    expect(await screen.findByRole('row', { name: /Cannelle moulue/ })).toBeInTheDocument();
  });

  it('un identifiant de produit inconnu dans l’URL ne sélectionne rien, et ne casse pas l’écran', async () => {
    brancherApi(reponsesNominales());
    monter('/nomenclature-vente?produit=p-inexistant');

    expect(await screen.findByText('Choisissez un produit')).toBeInTheDocument();
  });

  it('un échec de la liste des composants garde le produit choisi et affiche le message du serveur', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /produits/p-cafe/composants': () =>
        Promise.reject(
          new ErreurApi('Ce produit a été retiré de la vente entre-temps.', {
            code: 'produit_absent',
            statut: 404,
          }),
        ),
    });
    monter();
    await choisirLeCafe();

    expect(await screen.findByRole('alert')).toHaveTextContent('retiré de la vente entre-temps');
    expect(screen.getByRole('heading', { name: /Composants de « Café »/ })).toBeInTheDocument();
  });

  it('un produit sans composant explique la conséquence, et propose le geste', async () => {
    brancherApi(reponsesNominales());
    monter();
    await userEvent.selectOptions(await screen.findByLabelText(/Choisir un produit/), 'p-menu');

    expect(await screen.findByText('Aucun composant déclaré')).toBeInTheDocument();
    expect(
      screen.getByText(/aucune serviette, aucun gobelet, aucune pincée de cannelle/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Déclarer un composant' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Inconnu ≠ zéro, et le lot de référence
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Nomenclature de vente — le coût du LOT, jamais un zéro par arrondi', () => {
  it('la cannelle affiche le coût du LOT ENTIER (100 cafés), pas le coût par café arrondi à zéro', async () => {
    brancherApi(reponsesNominales());
    monter();
    await choisirLeCafe();

    await screen.findByRole('row', { name: /Cannelle moulue/ });
    // 0,3 c × 100 = 30 c. Le nombre vient de la fonction pure de l'écran, pas
    // d'un calcul refait à la main dans le test.
    const attendu = coutLotReferenceCents(COMPOSANTS[1]!);
    expect(attendu).toBe(30);
    expect(celluleDe(/Cannelle moulue/, 3)).toHaveTextContent(formaterMontant(attendu!));
    // Le piège que tout l'écran existe pour éviter : « 0,00 ».
    expect(celluleDe(/Cannelle moulue/, 3)).not.toHaveTextContent(formaterMontant(0));
  });

  it('un composant jamais acheté écrit « Prix inconnu », jamais « 0,00 »', async () => {
    brancherApi(reponsesNominales());
    monter();
    await choisirLeCafe();

    await screen.findByRole('row', { name: /Crème liquide/ });
    const cellule = celluleDe(/Crème liquide/, 3);
    expect(cellule).toHaveTextContent('Prix inconnu');
    expect(cellule).not.toHaveTextContent(formaterMontant(0));
  });

  it('la quantité déclarée se lit différemment selon le lot : « / unité vendue » ou « pour N unités »', async () => {
    brancherApi(reponsesNominales());
    monter();
    await choisirLeCafe();

    await screen.findByRole('row', { name: /Gobelet carton/ });
    expect(celluleDe(/Gobelet carton/, 1)).toHaveTextContent('1 piece / unité vendue');
    expect(celluleDe(/Cannelle moulue/, 1)).toHaveTextContent('20 g pour 100 unités vendues');
  });

  it('une OPTION est marquée comme telle : un café noir n’est pas un café à la crème', async () => {
    brancherApi(reponsesNominales());
    monter();
    await choisirLeCafe();

    await screen.findByRole('row', { name: /Crème liquide/ });
    expect(celluleDe(/Crème liquide/, 2)).toHaveTextContent('Option');
    expect(celluleDe(/Gobelet carton/, 2)).not.toHaveTextContent('Option');
    // Le mode de consommation doit rester lisible à côté de l'option.
    expect(celluleDe(/Gobelet carton/, 2)).toHaveTextContent('À emporter seulement');
  });

  it('l’avertissement de lot de référence apparaît AVANT l’enregistrement, et disparaît une fois le lot suffisant', async () => {
    brancherApi(reponsesNominales());
    monter();
    await choisirLeCafe();
    await screen.findByRole('row', { name: /Gobelet carton/ });

    const champQuantite = screen.getByRole('textbox', { name: /Quantité consommée/ });
    const champLot = screen.getByRole('textbox', { name: /unités vendues/ });
    await userEvent.type(champQuantite, '20');
    await userEvent.clear(champLot);
    await userEvent.type(champLot, '100');

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent("s'arrondirait à 0 sur une vente isolée");

    await userEvent.clear(champLot);
    await userEvent.type(champLot, '10');
    // 20 g pour 10 unités = 2 g par unité : plus aucun risque d'arrondi.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Clavier (CLAUDE.md §3 règle 10)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Nomenclature de vente — clavier', () => {
  it('un refus LOCAL amène le focus sur le premier champ fautif', async () => {
    brancherApi(reponsesNominales());
    monter();
    await choisirLeCafe();
    await screen.findByRole('row', { name: /Gobelet carton/ });

    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Choisissez un ingrédient.')).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole('combobox', { name: /Ingrédient consommé/ }),
    );
  });

  it('Ctrl+S enregistre, et le corps envoyé porte le lot de référence tel quel', async () => {
    const enregistre = vi.fn(() => Promise.resolve(COMPOSANTS[0]));
    brancherApi({ ...reponsesNominales(), 'POST /produits/p-cafe/composants': enregistre });
    monter();
    await choisirLeCafe();
    await screen.findByRole('row', { name: /Gobelet carton/ });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /Ingrédient consommé/ }),
      'i-cannelle',
    );
    await userEvent.type(screen.getByRole('textbox', { name: /Quantité consommée/ }), '20');
    const champLot = screen.getByRole('textbox', { name: /unités vendues/ });
    await userEvent.clear(champLot);
    await userEvent.type(champLot, '100');
    await userEvent.keyboard('{Control>}s{/Control}');

    await vi.waitFor(() => expect(enregistre).toHaveBeenCalledTimes(1));
    const corps = JSON.parse(
      String(
        appelApi.mock.calls.find(
          ([chemin, options]) =>
            chemin === '/produits/p-cafe/composants' && options?.method === 'POST',
        )?.[1]?.body,
      ),
    ) as Record<string, unknown>;
    expect(corps['quantiteUniteRef']).toBe(20);
    expect(corps['quantiteReferenceUnites']).toBe(100);
  });

  it('« Nouveau composant » amène le focus dans le formulaire', async () => {
    brancherApi(reponsesNominales());
    monter();
    await choisirLeCafe();
    await screen.findByRole('row', { name: /Gobelet carton/ });

    await userEvent.click(screen.getByRole('button', { name: 'Nouveau composant' }));

    const champIngredient = screen.getByRole('combobox', { name: /Ingrédient consommé/ });
    await vi.waitFor(() => expect(document.activeElement).toBe(champIngredient));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   L'état d'enregistrement PENDANT la requête (docs/39 §3, cinquième forme)
   ═══════════════════════════════════════════════════════════════════════════

   Toutes les fixtures de ce fichier, jusqu'ici, résolvent leur promesse
   IMMÉDIATEMENT (`Promise.resolve()`). L'état `enregistrement` retombe donc à
   `'inchange'`/`'enregistre'` dans le même écoulement de micro-tâches que sa
   pose : aucun test existant ne pouvait voir le bouton inerte ni le texte
   « Enregistrement… ». Ici la requête est CONTRÔLÉE, résolue seulement après
   avoir observé l'attente.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Nomenclature de vente — l’état d’enregistrement, observé PENDANT la requête', () => {
  it('« Enregistrer » devient inerte et l’indicateur dit « Enregistrement… », puis les deux redeviennent normaux', async () => {
    let repondre: ((valeur: unknown) => void) | undefined;
    const poster = vi.fn(
      () =>
        new Promise((resoudre) => {
          repondre = resoudre;
        }),
    );
    brancherApi({ ...reponsesNominales(), 'POST /produits/p-cafe/composants': poster });
    monter();
    await choisirLeCafe();
    await screen.findByRole('row', { name: /Gobelet carton/ });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /Ingrédient consommé/ }),
      'i-gobelet',
    );
    await userEvent.type(screen.getByRole('textbox', { name: /Quantité consommée/ }), '1');
    const bouton = screen.getByRole('button', { name: 'Enregistrer' });
    await userEvent.click(bouton);

    // La requête est EN VOL ici, et seulement ici.
    expect(bouton).toBeDisabled();
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();

    repondre?.(
      composant({ id: 'cv-new', ingredientId: 'i-gobelet', nomIngredient: 'Gobelet carton 25 cl' }),
    );

    await vi.waitFor(() => expect(bouton).not.toBeDisabled());
    expect(await screen.findByText(/^Enregistré /)).toBeInTheDocument();
  });

  /**
   * ═══ DÉFAUT RÉEL, CORRIGÉ LE 28/09/2026 (était en `it.fails`) ═══
   *
   * Même défaut que sur `Produits.tsx`, `Menus.tsx`, `LieuxMarche.tsx` et
   * `Equipements.tsx` : `enregistrer()` (`NomenclatureVente.tsx`) ne consulte
   * jamais `enregistrement` avant de reposter. Le bouton « Enregistrer » est
   * bien `disabled={enregistrement === 'enregistrement'}`, ce qui bloque un
   * second CLIC — mais Ctrl+S est lu par le `onKeyDown` du `<div>` racine et
   * appelle `enregistrer()` sans jamais regarder cet état. Un second Ctrl+S
   * pendant l'envoi CONTOURNE donc le bouton désactivé et repart en DEUXIÈME
   * requête POST — un composant de nomenclature déclaré deux fois, donc
   * compté deux fois dans le coût matière d'une vente.
   *
   * Ce test décrit le comportement SAIN (une seule requête). Il était en
   * `it.fails` jusqu'au correctif : une garde en tête de `enregistrer()`
   * refuse un second départ tant que le premier est en vol.
   */
  it('un second Ctrl+S pendant l’envoi ne contourne plus le bouton `disabled` : une seule requête (défaut corrigé le 28/09/2026)', async () => {
    const resolveurs: Array<(valeur: unknown) => void> = [];
    const poster = vi.fn(() => new Promise((resoudre) => resolveurs.push(resoudre)));
    brancherApi({ ...reponsesNominales(), 'POST /produits/p-cafe/composants': poster });
    monter();
    await choisirLeCafe();
    await screen.findByRole('row', { name: /Gobelet carton/ });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /Ingrédient consommé/ }),
      'i-gobelet',
    );
    const champQuantite = screen.getByRole('textbox', { name: /Quantité consommée/ });
    await userEvent.type(champQuantite, '1');

    await userEvent.keyboard('{Control>}s{/Control}');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

    // Le bouton est déjà `disabled` — et pourtant rien n'empêche ce second
    // Ctrl+S d'appeler `enregistrer()` une deuxième fois.
    await userEvent.keyboard('{Control>}s{/Control}');

    // Toujours résoudre AVANT l'assertion qui échoue, sinon les promesses
    // fuient dans le test suivant.
    resolveurs.forEach((r) =>
      r(
        composant({
          id: 'cv-new',
          ingredientId: 'i-gobelet',
          nomIngredient: 'Gobelet carton 25 cl',
        }),
      ),
    );

    expect(poster).toHaveBeenCalledTimes(1);
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
 * Le sélecteur de produit composait son libellé avec
 * `p.nature === 'transforme' ? 'transformé' : 'revendu'`. Un MENU (la
 * troisième nature, CLAUDE.md §6) y était donc annoncé « revendu » — le mot le
 * plus faux possible, puisque la ventilation transformé/revendu alimente
 * DIRECTEMENT les compteurs de seuils légaux, qui portent sur le CA.
 *
 * Ce n'était pas une hypothèse : c'était EXACTEMENT le défaut déjà trouvé et
 * corrigé deux fois ailleurs, par un `switch` exhaustif nommé `libelleNature`
 * — dans `Menus.tsx` et dans `Produits.tsx`, avec le même commentaire mot pour
 * mot (« Un ternaire `transforme ? … : 'Revendu'` etiquetait un menu comme
 * "Revendu" — faux, et invisible a la lecture »). La correction n'avait pas
 * atteint cet écran-ci, et rien ne pouvait le signaler : ce libellé n'apparaît
 * qu'à l'intérieur d'une `<option>` d'un `<select>` rempli après chargement.
 *
 * Le correctif IMPORTE `libelleNature` depuis `Menus.tsx` au lieu d'en écrire
 * une troisième copie : les deux corrections précédentes avaient recopié le
 * `switch`, et c'est cette recopie qui a laissé survivre le troisième site.
 *
 * Les TROIS natures sont vérifiées, pas seulement le menu : une assertion qui
 * ne regarderait que « le menu ne dit pas revendu » resterait verte si le
 * correctif cassait au passage l'étiquette d'un vrai produit revendu.
 */
describe('Nomenclature de vente — la nature d’un menu dans le sélecteur', () => {
  it('chacune des trois natures est annoncée par son propre mot dans le sélecteur', async () => {
    brancherApi(reponsesNominales());
    monter();

    const selecteur = await screen.findByLabelText(/Choisir un produit/);
    const option = (nom: RegExp): HTMLElement =>
      within(selecteur).getByRole('option', { name: nom });

    // Le défaut mesuré : un menu étiqueté « revendu ». La casse est ignorée —
    // un `Revendu` capitalisé serait tout aussi faux.
    expect(option(/Formule du marché/).textContent).not.toMatch(/revendu/i);
    expect(option(/Formule du marché/).textContent).toContain('(Menu)');

    // Et les deux natures qui marchaient déjà continuent de marcher : sans
    // elles, ce test ne saurait pas distinguer un correctif d'un libellé
    // uniformément cassé.
    expect(option(/Café/).textContent).toContain('(Transformé)');
    expect(option(/Pot de sirop de Liège/).textContent).toContain('(Revendu)');
  });
});
