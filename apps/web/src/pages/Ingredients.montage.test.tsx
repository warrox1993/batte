/**
 * Écran `Ingrédients` MONTÉ — le référentiel dont tout le reste dépend.
 *
 * ═══ Pourquoi ce fichier existe ═══
 *
 * `Ingredients.test.tsx`, à côté, teste `corpsSaisieIngredient` et
 * `BROUILLON_INGREDIENT_VIDE` — deux fonctions pures. Il reste valable et n'est
 * pas touché. Mais il ne pouvait rien dire du reste : mesuré le 01/08/2026,
 * cet écran était couvert à 11,68 %, avec 8,69 % de ses fonctions. Tout ce qui
 * suit le premier rendu — les trois chargements, le refus Zod rejoué avant tout
 * aller-retour, le retour de focus après enregistrement (D-079), la recherche
 * par synonymes, les trois gestes de tarif — était hors de portée.
 *
 * Ce que ce fichier ne prouve PAS : que le serveur applique les mêmes règles.
 * Il prouve ce que l'écran affiche, refuse, envoie et focalise.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// `formaterMontant` est importé comme VALEUR : comparer un prix à un littéral
// tapé à la main ne marche pas dans ce dépôt (`Intl` insère une espace
// insécable). On compare via le formateur du projet, jamais autrement.
import { formaterMontant } from '@batte/core';
import type { Conditionnement, Fournisseur, IngredientComplet } from '@batte/core';

// `ErreurApi` reste la VRAIE classe : `enregistrer()` fait un `instanceof`
// dessus pour décider entre messages de champ et bandeau global. Une classe
// factice ferait tomber tous les refus dans la branche « erreur inattendue »,
// et les tests de répartition seraient verts pour la mauvaise raison.
import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  // `import type * as …` et non `typeof import(...)` : la règle ESLint
  // `consistent-type-imports` interdit la seconde forme — même formulation que
  // `BoutonDocument.montage.test.tsx`, le modèle de ce dépôt.
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: Ingredients } = await import('./Ingredients');

const appelApi = vi.mocked(requeteApi);

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures — trois ingrédients qui DIFFÈRENT sur ce qu'on veut discriminer
   ═══════════════════════════════════════════════════════════════════════════ */

function ingredient(surcharges: Partial<IngredientComplet> = {}): IngredientComplet {
  return {
    id: 'ing-farine-t55',
    nom: 'Farine de froment T55',
    categorie: 'farine',
    uniteReference: 'g',
    densiteGParMl: null,
    allergenes: ['gluten'],
    allergenesVerifies: true,
    // 5 kg : une valeur NON NULLE, pour que la colonne « Stock mini » puisse
    // discriminer d'avec l'ingrédient à 0 ci-dessous.
    stockSecurite: 5_000,
    delaiLivraisonJours: 3,
    dureeConservationJours: 180,
    notes: null,
    actif: true,
    nbConditionnements: 1,
    // 18,75 € / 25 000 g = 0,075 c/g — cohérent avec le conditionnement de la
    // même fixture. Le contrat autorise le réel non arrondi (D-018).
    coutUnitaireCents: 0.075,
    nbLignesRecette: 2,
    nbLots: 4,
    ...surcharges,
  };
}

const VERGEOISE = ingredient({
  id: 'ing-vergeoise',
  nom: 'Vergeoise blonde',
  categorie: 'sucre',
  allergenes: [],
  allergenesVerifies: false,
  // 0 = « aucun seuil déclaré », jamais un choix actif de zéro réserve : la
  // colonne doit dire « non défini », pas « 0 g ».
  stockSecurite: 0,
  nbConditionnements: 0,
  coutUnitaireCents: null,
  nbLignesRecette: 1,
  nbLots: 0,
});

const SEL_RETIRE = ingredient({
  id: 'ing-sel',
  nom: 'Sel fin',
  categorie: 'aromate',
  allergenes: [],
  actif: false,
  stockSecurite: 200,
  nbConditionnements: 1,
  nbLots: 1,
});

function conditionnement(surcharges: Partial<Conditionnement> = {}): Conditionnement {
  return {
    id: 'cond-sac-25',
    ingredientId: 'ing-farine-t55',
    ingredientNom: 'Farine de froment T55',
    uniteReference: 'g',
    fournisseurId: 'fou-meunier',
    fournisseurNom: 'Moulin de Hollogne',
    libelle: 'Sac 25 kg',
    quantiteUniteRef: 25_000,
    prixCents: 1_875,
    referenceFournisseur: 'MH-T55-25',
    datePrix: '2026-01-05',
    actif: true,
    ...surcharges,
  };
}

const FOURNISSEUR: Fournisseur = {
  id: 'fou-meunier',
  nom: 'Moulin de Hollogne',
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

/** Le fournisseur SYSTÈME ne doit jamais être proposable : ce n'est pas un fournisseur. */
const INVENTAIRE_OUVERTURE: Fournisseur = {
  ...FOURNISSEUR,
  id: 'fou-systeme',
  nom: 'Inventaire d’ouverture',
  type: 'systeme',
  nbConditionnements: 0,
};

type Referentiel = {
  ingredients?: IngredientComplet[];
  conditionnements?: Conditionnement[];
  fournisseurs?: Fournisseur[];
};

/**
 * Routeur de `requeteApi`, appliqué à TOUS les appels du composant. Un chemin
 * non prévu lève : un `undefined` silencieux ferait échouer un `schema.parse`
 * plus loin, avec un message qui accuserait le composant au lieu du test.
 */
function routerLectures(referentiel: Referentiel = {}): void {
  const ingredients = referentiel.ingredients ?? [ingredient(), VERGEOISE];
  const conditionnements = referentiel.conditionnements ?? [conditionnement()];
  const fournisseurs = referentiel.fournisseurs ?? [FOURNISSEUR, INVENTAIRE_OUVERTURE];

  appelApi.mockImplementation(async (chemin: string) => {
    if (chemin === '/referentiel/ingredients')
      return { data: ingredients, meta: { total: ingredients.length } };
    if (chemin === '/conditionnements')
      return { data: conditionnements, meta: { total: conditionnements.length } };
    if (chemin === '/fournisseurs')
      return { data: fournisseurs, meta: { total: fournisseurs.length } };
    throw new Error(`Chemin non prévu par la fixture : ${chemin}`);
  });
}

/**
 * Monte l'écran et attend la fin du chargement.
 *
 * `temoin` nomme ce qu'on attend à l'écran : par défaut le premier ingrédient
 * de la fixture, mais certains scénarios n'en ont aucun (référentiel vide) ou
 * en ont d'autres. Attendre un témoin qui ne viendra jamais ferait échouer le
 * test sur le montage plutôt que sur ce qu'il vérifie.
 */
async function monterPret(
  referentiel: Referentiel = {},
  temoin: string = 'Farine de froment T55',
): Promise<void> {
  routerLectures(referentiel);
  render(<Ingredients />);
  await screen.findByText(temoin);
}

/**
 * Rangée du tableau qui porte ce libellé.
 *
 * `getByRole('row', { name })` NE MARCHE PAS ici : `Tableau` pose
 * `role="grid"` sur le `<table>`, et le nom accessible d'une `row` dans une
 * grille ne se calcule pas depuis son contenu — la requête ne trouve rien,
 * silencieusement. On remonte donc depuis la cellule, ce qui a l'avantage de
 * dire exactement ce qu'on cherche : le libellé VISIBLE.
 */
function rangee(libelle: string): HTMLElement {
  const cellule = screen.getByText(libelle);
  const ligne = cellule.closest('tr');
  if (ligne === null) throw new Error(`« ${libelle} » n'est dans aucune rangée de tableau.`);
  return ligne;
}

const champNom = () => screen.getByRole('textbox', { name: /^Nom de l’ingrédient/ });
const boutonEnregistrer = () => screen.getByRole('button', { name: 'Enregistrer' });

beforeEach(() => {
  appelApi.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Chargement → prêt · chargement → erreur
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Ingrédients — les trois transitions du chargement', () => {
  it('annonce le chargement AVANT que les trois listes ne soient revenues', () => {
    // Jamais résolue : l'écran doit rester dans son état de chargement.
    appelApi.mockImplementation(() => new Promise(() => {}));
    render(<Ingredients />);

    expect(screen.getByText('Chargement des ingrédients…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('passe à « prêt » et liste les ingrédients actifs', async () => {
    await monterPret();

    expect(screen.queryByText('Chargement des ingrédients…')).not.toBeInTheDocument();
    expect(rangee('Vergeoise blonde')).toBeInTheDocument();
  });

  it('un échec de chargement affiche le message FRANÇAIS du serveur, pas un écran blanc', async () => {
    appelApi.mockRejectedValue(
      new ErreurApi('La base de données est verrouillée par une sauvegarde en cours.', {
        code: 'base_verrouillee',
        statut: 503,
      }),
    );
    render(<Ingredients />);

    expect(
      await screen.findByText('La base de données est verrouillée par une sauvegarde en cours.'),
    ).toBeInTheDocument();
  });

  it('un échec qui n’est pas une `ErreurApi` retombe sur le message générique, jamais sur rien', async () => {
    appelApi.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Ingredients />);

    expect(await screen.findByText('Erreur inattendue, sans plus de détail.')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Inconnu ≠ zéro, et absence de prix ≠ prix nul
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Ingrédients — un stock de sécurité à 0 se lit « non défini », jamais « 0 g »', () => {
  it('affiche « non défini » sur l’ingrédient jamais paramétré, et la quantité sur l’autre', async () => {
    await monterPret();

    const rangeeVergeoise = rangee('Vergeoise blonde');
    expect(within(rangeeVergeoise).getByText('non défini')).toBeInTheDocument();

    // Discriminant : la rangée voisine, elle, affiche bien une quantité — sans
    // quoi « non défini » partout rendrait ce test vert sans rien prouver.
    const rangeeFarine = rangee('Farine de froment T55');
    expect(within(rangeeFarine).queryByText('non défini')).not.toBeInTheDocument();
  });

  it('un ingrédient SANS conditionnement est signalé « aucun » — sans prix, aucun coût matière', async () => {
    await monterPret();

    const rangeeVergeoise = rangee('Vergeoise blonde');
    expect(within(rangeeVergeoise).getByText('aucun')).toBeInTheDocument();

    const rangeeFarine = rangee('Farine de froment T55');
    expect(within(rangeeFarine).queryByText('aucun')).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Filtres et états vides
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Ingrédients — recherche, ingrédients retirés, états vides', () => {
  it('un ingrédient RETIRÉ est masqué par défaut, et réapparaît en cochant la case', async () => {
    const utilisateur = userEvent.setup();
    await monterPret({ ingredients: [ingredient(), SEL_RETIRE] });

    expect(screen.queryByText('Sel fin')).not.toBeInTheDocument();

    await utilisateur.click(
      screen.getByRole('checkbox', { name: 'Afficher aussi les ingrédients retirés' }),
    );

    expect(rangee('Sel fin')).toBeInTheDocument();
  });

  it(
    'chercher « cassonade » retrouve la « Vergeoise blonde » — c’est CE synonyme qui évite ' +
      'de créer une seconde ligne de stock pour la même denrée (fiche 09)',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.type(
        screen.getByRole('searchbox', { name: 'Rechercher un ingrédient par nom ou synonyme' }),
        'cassonade',
      );

      expect(rangee('Vergeoise blonde')).toBeInTheDocument();
      // Discriminant : l'autre ingrédient DOIT disparaître, sinon la recherche
      // ne filtre rien et le test serait vert sur une liste inchangée.
      expect(screen.queryByText('Farine de froment T55')).not.toBeInTheDocument();
    },
  );

  it('une recherche sans résultat explique le RISQUE de doublon, pas seulement « rien trouvé »', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.type(
      screen.getByRole('searchbox', { name: 'Rechercher un ingrédient par nom ou synonyme' }),
      'zzzintrouvable',
    );

    expect(
      screen.getByText(/S'il s'agit bien d'un ingrédient nouveau, créez-le/),
    ).toBeInTheDocument();
    expect(screen.getByText(/nom ou synonyme confondus/)).toBeInTheDocument();
  });

  it('« Effacer » n’apparaît qu’avec une recherche active, et la vide', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();

    const recherche = screen.getByRole('searchbox', {
      name: 'Rechercher un ingrédient par nom ou synonyme',
    });
    await utilisateur.type(recherche, 'farine');
    await utilisateur.click(screen.getByRole('button', { name: 'Effacer' }));

    expect(recherche).toHaveValue('');
    expect(rangee('Vergeoise blonde')).toBeInTheDocument();
  });

  it('un référentiel entièrement vide propose de créer, plutôt que d’afficher un tableau muet', async () => {
    await monterPret({ ingredients: [], conditionnements: [] }, 'Aucun ingrédient enregistré');

    expect(screen.getByText('Aucun ingrédient enregistré')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer un ingrédient' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Sélection d'une fiche : le formulaire suit la ligne
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Ingrédients — choisir une ligne charge SA fiche, jamais celle d’à côté', () => {
  it('remplit le formulaire avec les valeurs de l’ingrédient cliqué', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Vergeoise blonde'));

    expect(champNom()).toHaveValue('Vergeoise blonde');
    // `stockSecurite` vaut 0 en base : le formulaire, lui, l'affiche tel quel —
    // c'est la LISTE qui traduit 0 en « non défini », pas le champ.
    expect(screen.getByRole('textbox', { name: /^Stock de sécurité/ })).toHaveValue('0');
    expect(screen.getByRole('checkbox', { name: /^Allergènes vérifiés/ })).not.toBeChecked();
  });

  it('l’unité de compte est annoncée FIGÉE quand des lots ou des recettes s’y appuient', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Farine de froment T55'));

    // 4 lots et 2 lignes de recette : changer l'unité ne convertirait pas les
    // quantités, elle les RÉINTERPRÉTERAIT.
    expect(screen.getByText(/Figée : 4 lot\(s\) et 2 ligne\(s\) de recette/)).toBeInTheDocument();
  });

  it('aucune aide « figée » sur un ingrédient neuf, sans lot ni recette', async () => {
    const utilisateur = userEvent.setup();
    await monterPret(
      {
        ingredients: [
          ingredient({ id: 'ing-neuf', nom: 'Sucre glace', nbLots: 0, nbLignesRecette: 0 }),
        ],
      },
      'Sucre glace',
    );

    await utilisateur.click(rangee('Sucre glace'));

    expect(screen.queryByText(/Figée :/)).not.toBeInTheDocument();
  });

  it('la densité disparaît du formulaire quand l’unité passe à « pièces » — elle n’y serait jamais lue', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    expect(screen.getByRole('textbox', { name: /^Densité \(g\/ml\)/ })).toBeInTheDocument();

    await utilisateur.selectOptions(
      screen.getByRole('combobox', { name: /^Unité de compte/ }),
      'piece',
    );

    expect(screen.queryByRole('textbox', { name: /^Densité/ })).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Migration vers `../composants/champs-formulaire` (01/08/2026) : `numerique`
   n'est plus un booléen mais `'entier' | 'decimal'`, et chaque champ doit
   traduire fidèlement SA nature — jamais un défaut unique pour tout l'écran.
   Rien de tout cela n'était couvert avant cette migration : une mutation qui
   inverserait les deux valeurs ci-dessous ne faisait rougir AUCUN test
   existant (le clavier numérique mobile n'est observable qu'au navigateur, or
   `inputMode` EST posé dans le DOM, donc vérifiable ici).
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Ingrédients — le clavier numérique suit la nature du champ, jamais un défaut unique', () => {
  it('un champ ENTIER (stock de sécurité, en grammes — CLAUDE.md §3 règle 4) pose inputMode="numeric"', async () => {
    await monterPret();

    expect(screen.getByRole('textbox', { name: /^Stock de sécurité/ })).toHaveAttribute(
      'inputmode',
      'numeric',
    );
  });

  it('un champ DÉCIMAL (densité en g/ml, un prix payé en €) pose inputMode="decimal"', async () => {
    await monterPret();

    expect(screen.getByRole('textbox', { name: /^Densité/ })).toHaveAttribute(
      'inputmode',
      'decimal',
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Enregistrement : refus Zod local, refus serveur, succès — et le FOCUS
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Ingrédients — enregistrer : ce qui est refusé avant tout aller-retour', () => {
  it(
    'une densité illisible est refusée LOCALEMENT par le schéma partagé — `JSON.stringify(NaN)` ' +
      'vaut `null`, donc l’envoyer la ferait passer pour « pas de densité »',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();
      appelApi.mockClear();

      await utilisateur.type(champNom(), 'Lait entier');
      await utilisateur.type(screen.getByRole('textbox', { name: /^Densité/ }), 'épais');
      await utilisateur.click(boutonEnregistrer());

      // Aucune écriture : ni POST ni PATCH n'a quitté le navigateur.
      expect(appelApi).not.toHaveBeenCalled();
      // Et le champ fautif prend le focus, pour ne pas le faire chercher.
      expect(screen.getByRole('textbox', { name: /^Densité/ })).toHaveFocus();
    },
  );

  it('le champ fautif porte `aria-invalid` et son message est relié par `aria-describedby`', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();
    appelApi.mockClear();

    await utilisateur.type(champNom(), 'Lait entier');
    await utilisateur.type(screen.getByRole('textbox', { name: /^Densité/ }), 'épais');
    await utilisateur.click(boutonEnregistrer());

    const densite = screen.getByRole('textbox', { name: /^Densité/ });
    expect(densite).toHaveAttribute('aria-invalid', 'true');
    expect(densite.getAttribute('aria-describedby')).toContain('densiteGParMl-erreur');
    expect(document.getElementById('densiteGParMl-erreur')?.textContent ?? '').not.toBe('');
  });

  it(
    'au CLIC sur un formulaire vide, le refus du NOM s’affiche — la validation native ne ' +
      'l’intercepte plus (correctif du 01/08/2026)',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();
      appelApi.mockClear();

      await utilisateur.click(screen.getByRole('button', { name: 'Nouvel ingrédient' }));
      await utilisateur.click(boutonEnregistrer());

      /*
        AVANT le correctif, `required` sur le champ « Nom » faisait annuler la
        soumission par le navigateur : `enregistrer()` n'était jamais appelée,
        aucun message ne s'affichait, et seule une bulle native transitoire
        apparaissait. Mesuré alors : `valueMissing === true`, ZÉRO `submit`.
      */
      const nom = champNom();
      expect(nom).toHaveAttribute('aria-invalid', 'true');
      expect(nom.getAttribute('aria-describedby')).toContain('nom-erreur');
      expect(document.getElementById('nom-erreur')?.textContent ?? '').not.toBe('');
      // Rien ne part sur le réseau : le refus est purement local.
      expect(appelApi).not.toHaveBeenCalledWith('/ingredients', expect.anything());
    },
  );

  it(
    'l’obligation reste ANNONCÉE aux lecteurs d’écran — `aria-required`, pas la disparition ' +
      'de l’information',
    async () => {
      await monterPret();
      expect(champNom()).toHaveAttribute('aria-required', 'true');
      // Et surtout PLUS l'attribut natif, qui reprendrait la main sur la soumission.
      expect(champNom()).not.toHaveAttribute('required');
    },
  );

  it('un stock de sécurité illisible est refusé aussi — le `?? 0` n’intercepte pas `NaN`', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();
    appelApi.mockClear();

    await utilisateur.type(champNom(), 'Lait entier');
    await utilisateur.type(screen.getByRole('textbox', { name: /^Stock de sécurité/ }), 'beaucoup');
    await utilisateur.click(boutonEnregistrer());

    expect(appelApi).not.toHaveBeenCalled();
  });
});

describe('Ingrédients — enregistrer : succès, refus serveur, et le focus après le geste', () => {
  it('un enregistrement réussi envoie le corps attendu puis relit le référentiel', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Farine de froment T55'));
    appelApi.mockClear();

    const modifie = ingredient({ stockSecurite: 8_000 });
    appelApi.mockImplementation(async (chemin: string) => {
      if (chemin === '/ingredients/ing-farine-t55') return modifie;
      if (chemin === '/referentiel/ingredients')
        return { data: [modifie, VERGEOISE], meta: { total: 2 } };
      if (chemin === '/conditionnements') return { data: [conditionnement()], meta: { total: 1 } };
      throw new Error(`Chemin non prévu : ${chemin}`);
    });

    const stock = screen.getByRole('textbox', { name: /^Stock de sécurité/ });
    await utilisateur.clear(stock);
    await utilisateur.type(stock, '8000');
    await utilisateur.click(boutonEnregistrer());

    await waitFor(() =>
      expect(appelApi).toHaveBeenCalledWith(
        '/ingredients/ing-farine-t55',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const appelEcriture = appelApi.mock.calls.find(([c]) => c === '/ingredients/ing-farine-t55');
    const corps = JSON.parse(String(appelEcriture?.[1]?.body)) as Record<string, unknown>;
    expect(corps).toMatchObject({ nom: 'Farine de froment T55', stockSecurite: 8000 });

    // Relecture : l'écran n'affirme jamais un état qu'il n'a pas relu.
    expect(appelApi).toHaveBeenCalledWith('/referentiel/ingredients');
  });

  it(
    'après un enregistrement réussi, le focus REVIENT sur « Enregistrer » (D-079) — un bouton ' +
      'qui perd `disabled` pendant qu’il a le focus est blur par le navigateur, et le focus ' +
      'retomberait sur `<body>` au milieu d’une série de saisies',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.click(rangee('Farine de froment T55'));
      const enregistre = ingredient({ notes: 'Meunier de Hollogne' });
      appelApi.mockImplementation(async (chemin: string) => {
        if (chemin === '/ingredients/ing-farine-t55') return enregistre;
        if (chemin === '/referentiel/ingredients')
          return { data: [enregistre, VERGEOISE], meta: { total: 2 } };
        if (chemin === '/conditionnements')
          return { data: [conditionnement()], meta: { total: 1 } };
        throw new Error(`Chemin non prévu : ${chemin}`);
      });

      const notes = screen.getByRole('textbox', { name: /^Notes/ });
      await utilisateur.type(notes, 'Meunier de Hollogne');

      /*
        PARTIR DU CLIC NE PROUVE RIEN, et c'est le piège mesuré le 01/08/2026 :
        le clic laisse déjà le focus SUR le bouton, et jsdom — contrairement à
        un vrai navigateur — ne le retire pas quand `disabled` apparaît. Une
        mutation qui SUPPRIME la reprise de focus laissait donc ce test vert.

        Ctrl+S déclenche le même enregistrement depuis un CHAMP : le focus part
        d'ailleurs, et seule la reprise explicite (`requestAnimationFrame` +
        `boutonEnregistrerRef`) peut l'amener sur le bouton. C'est cette
        DESTINATION qui est le contrat de D-079, pas la simple survie du focus.
      */
      notes.focus();
      await utilisateur.keyboard('{Control>}s{/Control}');

      await screen.findByText(/^Enregistré /);
      await waitFor(() => expect(boutonEnregistrer()).toHaveFocus());
      expect(document.body).not.toHaveFocus();
    },
  );

  it(
    'un 422 avec `champs` affiche le message SOUS le champ et n’ajoute PAS de bandeau — ' +
      'un double signalement fait chercher l’erreur deux fois (docs/07 §4.7)',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.click(rangee('Farine de froment T55'));
      appelApi.mockRejectedValue(
        new ErreurApi('Saisie refusée.', {
          code: 'validation',
          statut: 422,
          champs: { nom: 'Un ingrédient porte déjà ce nom.' },
        }),
      );

      await utilisateur.type(champNom(), ' bis');
      await utilisateur.click(boutonEnregistrer());

      const message = await screen.findByText('Un ingrédient porte déjà ce nom.');
      expect(message).toHaveAttribute('id', 'nom-erreur');
      // Le message GLOBAL du serveur ne doit apparaître nulle part.
      expect(screen.queryByText('Saisie refusée.')).not.toBeInTheDocument();
      // Et le champ désigné prend le focus.
      expect(champNom()).toHaveFocus();
    },
  );

  it('un refus SANS `champs` s’affiche en bandeau et rend le focus au bouton', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Farine de froment T55'));
    appelApi.mockRejectedValue(
      new ErreurApi('Période comptable verrouillée : cette fiche ne peut plus changer.', {
        code: 'periode_verrouillee',
        statut: 409,
      }),
    );

    const nom = champNom();
    await utilisateur.type(nom, ' bis');
    // Même raison que le test de succès ci-dessus : le focus doit PARTIR
    // d'ailleurs que du bouton pour que sa destination soit observable.
    nom.focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(
      await screen.findByText('Période comptable verrouillée : cette fiche ne peut plus changer.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(boutonEnregistrer()).toHaveFocus());
  });

  it('l’indicateur passe de « rien » à « Modifications non enregistrées » dès la première frappe', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Farine de froment T55'));
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();

    await utilisateur.type(champNom(), ' bis');
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Clavier — CLAUDE.md §3 règle 10
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Ingrédients — clavier (CLAUDE.md §3 règle 10)', () => {
  it('Ctrl+S enregistre sans passer par la souris', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Farine de froment T55'));
    const enregistre = ingredient({ notes: 'noté au clavier' });
    appelApi.mockImplementation(async (chemin: string) => {
      if (chemin === '/ingredients/ing-farine-t55') return enregistre;
      if (chemin === '/referentiel/ingredients')
        return { data: [enregistre, VERGEOISE], meta: { total: 2 } };
      if (chemin === '/conditionnements') return { data: [conditionnement()], meta: { total: 1 } };
      throw new Error(`Chemin non prévu : ${chemin}`);
    });

    screen.getByRole('textbox', { name: /^Notes/ }).focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    await waitFor(() =>
      expect(appelApi).toHaveBeenCalledWith(
        '/ingredients/ing-farine-t55',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
  });

  it('les allergènes sont des cases NATIVES, cochables à l’Espace — jamais un `div onClick`', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Vergeoise blonde'));
    /*
      `getByRole('checkbox', { name })` et NON un `querySelector` sur l'attribut
      `name` : le titre de ce test affirme que la case est NATIVE, et seul le
      rôle le prouve. Un `<div onClick>` portant le même attribut satisferait un
      sélecteur CSS sans satisfaire la règle n°10.
    */
    const gluten = screen.getByRole('checkbox', { name: /gluten/i });
    expect(gluten).not.toBeChecked();

    gluten.focus();
    await utilisateur.keyboard(' ');

    expect(gluten).toBeChecked();
  });

  it('« Nouvel ingrédient » vide le formulaire ET y place le focus, sans traverser la page', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Farine de froment T55'));
    expect(champNom()).toHaveValue('Farine de froment T55');

    await utilisateur.click(screen.getByRole('button', { name: 'Nouvel ingrédient' }));

    expect(champNom()).toHaveValue('');
    // `nouveau()` focalise le premier `input` du formulaire via un `setTimeout`.
    await waitFor(() => expect(champNom()).toHaveFocus());
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Conditionnements — LE PRIX, et les trois gestes qui le touchent
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Ingrédients — conditionnements : trois gestes nommés, jamais un « Modifier » unique', () => {
  it('le panneau des conditionnements n’existe qu’une fois un ingrédient choisi', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    expect(screen.queryByText(/^Conditionnements —/)).not.toBeInTheDocument();

    await utilisateur.click(rangee('Farine de froment T55'));

    expect(screen.getByText('Conditionnements — Farine de froment T55')).toBeInTheDocument();
  });

  it('« Nouveau tarif » et « Corriger la fiche » sont DEUX boutons distincts sur une ligne active', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Farine de froment T55'));
    await utilisateur.click(rangee('Sac 25 kg'));

    expect(
      screen.getByRole('button', { name: 'Enregistrer un nouveau tarif' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corriger la fiche' })).toBeInTheDocument();
  });

  it(
    'le mode « tarif » vide le PRIX et la DATE — les pré-remplir avec l’ancienne valeur ' +
      'inviterait à valider sans lire',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.click(rangee('Farine de froment T55'));
      await utilisateur.click(rangee('Sac 25 kg'));
      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer un nouveau tarif' }));

      expect(screen.getByRole('textbox', { name: /^Prix payé/ })).toHaveValue('');
      expect(screen.getByLabelText('Prix en vigueur le')).toHaveValue('');
      // Le tarif EN VIGUEUR reste rappelé, pour comparer sans le recopier.
      expect(screen.getByText(/tarif en vigueur/)).toBeInTheDocument();
    },
  );

  it(
    'le mode « correction » REPREND la ligne telle quelle — c’est l’autre geste, celui qui ' +
      'réécrit le passé, et il ne se saisit pas à blanc',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.click(rangee('Farine de froment T55'));
      await utilisateur.click(rangee('Sac 25 kg'));
      await utilisateur.click(screen.getByRole('button', { name: 'Corriger la fiche' }));

      expect(screen.getByRole('textbox', { name: /^Libellé du format/ })).toHaveValue('Sac 25 kg');
      expect(screen.getByRole('textbox', { name: /^Prix payé/ })).toHaveValue('18,75');
      expect(screen.getByLabelText('Prix en vigueur le')).toHaveValue('2026-01-05');
    },
  );

  it('un prix illisible est refusé AVANT tout appel, avec le format attendu en exemple', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Farine de froment T55'));
    await utilisateur.click(rangee('Sac 25 kg'));
    await utilisateur.click(screen.getByRole('button', { name: 'Corriger la fiche' }));
    appelApi.mockClear();

    const prix = screen.getByRole('textbox', { name: /^Prix payé/ });
    await utilisateur.clear(prix);
    await utilisateur.type(prix, 'gratuit');
    // DEUX boutons portent le libellé « Enregistrer » à cet instant : celui de
    // la fiche ingrédient et celui du conditionnement. On vise explicitement le
    // second, sinon la requête est ambiguë — et l'ambiguïté ferait passer le
    // test pour le mauvais formulaire.
    const formulaireTarif = prix.closest('form');
    expect(formulaireTarif).not.toBeNull();
    await utilisateur.click(
      within(formulaireTarif as HTMLElement).getByRole('button', { name: 'Enregistrer' }),
    );

    expect(screen.getByText('Prix illisible. Exemple attendu : 18,75')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalled();
    expect(prix).toHaveFocus();
  });

  it(
    'une ligne ARCHIVÉE ne propose aucun des deux gestes de tarif : c’est de l’historique de prix, ' +
      'pas une ligne à faire évoluer',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret({
        conditionnements: [
          conditionnement(),
          conditionnement({
            id: 'cond-ancien',
            libelle: 'Sac 25 kg (ancien tarif)',
            prixCents: 1_690,
            datePrix: '2025-09-01',
            actif: false,
          }),
        ],
      });

      await utilisateur.click(rangee('Farine de froment T55'));
      await utilisateur.click(rangee('Sac 25 kg (ancien tarif)'));

      expect(
        screen.queryByRole('button', { name: 'Enregistrer un nouveau tarif' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Corriger la fiche' })).not.toBeInTheDocument();
      expect(screen.getByText(/Cette ligne est archivée/)).toBeInTheDocument();
    },
  );

  it(
    'le fournisseur SYSTÈME « Inventaire d’ouverture » n’est jamais proposable — un ' +
      'conditionnement posé sur lui ne servirait à générer aucune commande',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.click(rangee('Farine de froment T55'));
      await utilisateur.click(screen.getByRole('button', { name: 'Ajouter un conditionnement' }));

      const options = [
        ...(screen.getByRole('combobox', { name: /^Fournisseur/ }) as HTMLSelectElement).options,
      ].map((o) => o.textContent);
      expect(options).toContain('Moulin de Hollogne');
      expect(options).not.toContain('Inventaire d’ouverture');
    },
  );

  it('Échap referme un mode d’écriture et rend le focus au bouton qui l’a ouvert', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Farine de froment T55'));
    await utilisateur.click(rangee('Sac 25 kg'));
    const ouvrirTarif = screen.getByRole('button', { name: 'Enregistrer un nouveau tarif' });
    await utilisateur.click(ouvrirTarif);
    expect(screen.getByRole('textbox', { name: /^Prix payé/ })).toBeInTheDocument();

    await utilisateur.keyboard('{Escape}');

    // Le formulaire s'est refermé…
    expect(screen.queryByRole('textbox', { name: /^Prix payé/ })).not.toBeInTheDocument();
    // …et le focus est revenu sur le bouton PRÉCIS qui l'avait ouvert, pas sur
    // `<body>` ni sur un voisin.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enregistrer un nouveau tarif' })).toHaveFocus(),
    );
  });

  it('sans aucun conditionnement, l’écran dit ce que ça coûte : aucun prix, donc aucun coût matière', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(rangee('Vergeoise blonde'));

    expect(screen.getByText('Aucun conditionnement')).toBeInTheDocument();
    expect(
      screen.getByText(/le coût matière de toute recette qui le cite reste incalculable/),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Retirer un format d'achat — le geste qui manquait

   `PATCH /api/conditionnements/:id/activite` était la SEULE des neuf routes
   `…/activite` du dépôt sans bouton. Conséquence mesurée : quand le meunier
   remplace son sac de 25 kg par du 10 kg sans nouveau tarif sur l'ancien, le
   format abandonné restait servi au coût matière et aux bons de commande
   indéfiniment — la seule désactivation existante étant l'archivage
   automatique d'`enregistrerNouveauTarif`.

   ═══ La fixture, et ce qu'elle peut discriminer ═══

   Trois lignes qui ne se ressemblent PAS, sans quoi rien ne serait prouvé :

    - `Sac 25 kg` — ACTIF, tarif en vigueur. C'est lui qu'on retire.
    - `Sac 10 kg` — ACTIF aussi, et c'est le discriminant qui coûte le plus
      cher à obtenir : sans une seconde ligne active, un bouton qui agirait sur
      « la première ligne du tableau » plutôt que sur la ligne CHOISIE serait
      indétectable. Les deux portent des prix et des contenances différents.
    - `Sac 25 kg (ancien tarif)` — DÉJÀ INACTIF, archivé par un changement de
      tarif, à un prix DIFFÉRENT (16,90 € contre 18,75 €). C'est lui qui prouve
      que le bouton s'apparie sur l'état réel de la ligne et non sur un défaut,
      et que l'historique de prix reste lisible.

   Ce que la fixture NE peut pas porter : le lien vers une réception passée.
   Vérifié dans le service (`LigneReception`, `packages/db/src/services/
   reception.ts`) — une ligne de réception porte un `ingredientId`, une
   quantité et un prix payé, JAMAIS un `conditionnementId`. Ce sont
   `commande_ligne` et `economie_achat` qui portent la clé étrangère
   (`packages/db/src/schema.ts`), et le contrat `schemaConditionnement`
   n'expose aucun compteur d'usage. L'usage passé est donc représenté ici par
   ce que l'écran peut réellement voir : l'ingrédient porteur a `nbLots: 4`, et
   la ligne archivée conserve son prix d'époque après le geste.
   ═══════════════════════════════════════════════════════════════════════════ */

const SAC_10 = conditionnement({
  id: 'cond-sac-10',
  libelle: 'Sac 10 kg',
  quantiteUniteRef: 10_000,
  prixCents: 850,
  datePrix: '2026-01-05',
});

const SAC_25_ANCIEN = conditionnement({
  id: 'cond-ancien',
  libelle: 'Sac 25 kg (ancien tarif)',
  prixCents: 1_690,
  datePrix: '2025-09-01',
  actif: false,
});

/** Les trois lignes ensemble : c'est cette liste qui rend les tests discriminants. */
const TROIS_FORMATS = [conditionnement(), SAC_10, SAC_25_ANCIEN];

const boutonRetirer = () => screen.getByRole('button', { name: 'Retirer ce format d’achat' });

/**
 * Route les lectures ET le `PATCH …/activite`, en rendant la ligne basculée.
 *
 * `apresBascule` décrit l'état du référentiel APRÈS le geste : l'écran relit
 * toujours (`charger()`), donc une fixture qui rendrait la liste inchangée
 * ferait passer un test que la vraie application ferait échouer.
 */
function routerBascule(id: string, actif: boolean): Conditionnement[] {
  const apresBascule = TROIS_FORMATS.map((c) => (c.id === id ? { ...c, actif } : c));

  appelApi.mockImplementation(async (chemin: string) => {
    if (chemin === `/conditionnements/${id}/activite`) return apresBascule.find((c) => c.id === id);
    if (chemin === '/referentiel/ingredients')
      return { data: [ingredient(), VERGEOISE], meta: { total: 2 } };
    if (chemin === '/conditionnements')
      return { data: apresBascule, meta: { total: apresBascule.length } };
    if (chemin === '/fournisseurs')
      return { data: [FOURNISSEUR, INVENTAIRE_OUVERTURE], meta: { total: 2 } };
    throw new Error(`Chemin non prévu par la fixture : ${chemin}`);
  });

  return apresBascule;
}

describe('Ingrédients — retirer un format d’achat que le fournisseur ne vend plus', () => {
  it('le bouton n’apparaît qu’une fois une ligne choisie — il agit sur ELLE, pas sur le tableau', async () => {
    const utilisateur = userEvent.setup();
    await monterPret({ conditionnements: TROIS_FORMATS });

    await utilisateur.click(rangee('Farine de froment T55'));

    // Trois formats à l'écran, aucune ligne choisie : aucun geste de retrait.
    expect(
      screen.queryByRole('button', { name: 'Retirer ce format d’achat' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remettre ce format en service' }),
    ).not.toBeInTheDocument();

    await utilisateur.click(rangee('Sac 10 kg'));

    expect(boutonRetirer()).toBeInTheDocument();
  });

  it(
    'le libellé s’apparie à l’état RÉEL de la ligne choisie : « Retirer » sur une active, ' +
      '« Remettre en service » sur celle déjà archivée',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret({ conditionnements: TROIS_FORMATS });

      await utilisateur.click(rangee('Farine de froment T55'));

      await utilisateur.click(rangee('Sac 25 kg (ancien tarif)'));
      expect(
        screen.getByRole('button', { name: 'Remettre ce format en service' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Retirer ce format d’achat' }),
      ).not.toBeInTheDocument();

      // Discriminant : la ligne d'à côté, active, propose l'autre libellé. Un
      // libellé figé serait vert sur la moitié de ce test et rouge ici.
      await utilisateur.click(rangee('Sac 10 kg'));
      expect(boutonRetirer()).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Remettre ce format en service' }),
      ).not.toBeInTheDocument();
    },
  );

  it(
    'le clic envoie `PATCH /conditionnements/:id/activite` avec `actif: false` sur la ligne ' +
      'CHOISIE — jamais sur la première du tableau',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret({ conditionnements: TROIS_FORMATS });

      await utilisateur.click(rangee('Farine de froment T55'));
      // Volontairement la DEUXIÈME ligne active : viser « Sac 25 kg », qui est
      // la première du tableau, rendrait indiscernable un bouton qui agirait
      // sur l'index 0 au lieu de la sélection.
      await utilisateur.click(rangee('Sac 10 kg'));

      routerBascule('cond-sac-10', false);
      await utilisateur.click(boutonRetirer());

      await waitFor(() =>
        expect(appelApi).toHaveBeenCalledWith(
          '/conditionnements/cond-sac-10/activite',
          expect.objectContaining({ method: 'PATCH' }),
        ),
      );
      const appel = appelApi.mock.calls.find(
        ([c]) => c === '/conditionnements/cond-sac-10/activite',
      );
      expect(JSON.parse(String(appel?.[1]?.body))).toEqual({ actif: false });

      // Et l'écran RELIT plutôt que d'affirmer un état qu'il n'a pas revu.
      expect(appelApi).toHaveBeenCalledWith('/conditionnements');
    },
  );

  it(
    'une ligne retirée RESTE affichée avec son prix — c’est la base de valorisation des lots ' +
      'reçus et la traçabilité AFSCA (CLAUDE.md §3 règles 6 et 7)',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret({ conditionnements: TROIS_FORMATS });

      await utilisateur.click(rangee('Farine de froment T55'));
      await utilisateur.click(rangee('Sac 10 kg'));

      routerBascule('cond-sac-10', false);
      await utilisateur.click(boutonRetirer());

      // La ligne ne disparaît pas du tableau…
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Remettre ce format en service' }),
        ).toBeInTheDocument(),
      );
      const ligne = rangee('Sac 10 kg');
      expect(ligne).toBeInTheDocument();
      // …et elle porte toujours SON prix, pas celui du voisin. Comparé via le
      // formateur du projet : `Intl` insère une espace insécable, un littéral
      // tapé à la main ne serait jamais égal.
      expect(within(ligne).getByText(formaterMontant(850))).toBeInTheDocument();
      /*
        L'écran ne doit pas laisser croire à une suppression, puisqu'il n'y en
        a aucune. Première rédaction de cette assertion : `queryByText(/supprim/i)`
        — elle est tombée sur la phrase « Un ingrédient ne se supprime pas », qui
        est précisément le bon message. Le test décrivait mal ce qu'il voulait
        dire : ce qu'on interdit, c'est un GESTE de suppression, pas le mot.
      */
      expect(screen.queryByRole('button', { name: /supprimer/i })).not.toBeInTheDocument();
      // La ligne annonce son nouvel état DANS le tableau — « archivé » à côté
      // de sa date. C'est la preuve qu'elle a changé d'état sans quitter la vue.
      expect(within(ligne).getByText(/2026-01-05 — archivé/)).toBeInTheDocument();

      /*
        LA TROISIÈME JAMBE DE LA FIXTURE, celle du passé reçu.

        L'ingrédient porteur a `nbLots: 4` : quatre lots sont entrés en stock
        sous ce référentiel, et leur traçabilité AFSCA doit survivre au geste.
        C'est tout ce que l'écran peut voir du passé — `schemaConditionnement`
        n'expose aucun compteur d'usage, et une ligne de réception
        (`LigneReception`) porte un ingrédient, une quantité et un prix payé,
        jamais un conditionnement. Ce qu'on vérifie donc : le geste est LOCAL
        à la ligne. L'ingrédient reste au référentiel, avec ses quatre lots.
      */
      expect(screen.getByRole('button', { name: 'Retirer du référentiel' })).toBeInTheDocument();
      expect(screen.getByText(/4 lot\(s\) reçu\(s\) le référencent/)).toBeInTheDocument();
    },
  );

  it('après le geste, le focus reste sur le bouton — pas sur `<body>` (CLAUDE.md §3 règle 10)', async () => {
    const utilisateur = userEvent.setup();
    await monterPret({ conditionnements: TROIS_FORMATS });

    await utilisateur.click(rangee('Farine de froment T55'));
    await utilisateur.click(rangee('Sac 10 kg'));

    routerBascule('cond-sac-10', false);
    await utilisateur.click(boutonRetirer());

    /*
        LA DESTINATION EST LE CONTRAT, pas la survie du focus par accident.
        Le bouton n'est jamais `disabled` (il porte `aria-disabled`), donc
        jsdom ne le blur pas : ce que ce test attrape, c'est le DÉMONTAGE — un
        bouton rendu à l'intérieur de `{choisi.actif && …}` serait détruit à
        l'instant où `actif` bascule, et le focus retomberait sur `<body>`.
        On l'interroge sous son NOUVEAU libellé : c'est bien le même nœud, qui
        a seulement changé de texte.
      */
    const remis = await screen.findByRole('button', { name: 'Remettre ce format en service' });
    await waitFor(() => expect(remis).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it('le bouton est atteignable et actionnable au CLAVIER seul, sans souris', async () => {
    const utilisateur = userEvent.setup();
    await monterPret({ conditionnements: TROIS_FORMATS });

    await utilisateur.click(rangee('Farine de froment T55'));
    await utilisateur.click(rangee('Sac 10 kg'));

    routerBascule('cond-sac-10', false);
    // `<button>` NATIF : focalisable et déclenchable à l'Entrée. Un
    // `<div onClick>` satisferait le clic ci-dessus mais pas cette ligne.
    boutonRetirer().focus();
    await utilisateur.keyboard('{Enter}');

    await waitFor(() =>
      expect(appelApi).toHaveBeenCalledWith(
        '/conditionnements/cond-sac-10/activite',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
  });

  it(
    'pendant l’aller-retour, le bouton GARDE le focus et refuse un second envoi — c’est ' +
      '`aria-disabled` plus un garde-fou, jamais l’attribut `disabled`',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret({ conditionnements: TROIS_FORMATS });

      await utilisateur.click(rangee('Farine de froment T55'));
      await utilisateur.click(rangee('Sac 10 kg'));

      /*
        Une requête RÉELLEMENT EN VOL, et c'est tout l'objet de ce test.

        Les autres scénarios de ce bloc rendent une promesse déjà résolue :
        `envoi` retombe à « inactif » dans le même écoulement de micro-tâches,
        l'état d'attente n'atteint jamais le DOM, et un `disabled` posé à la
        place d'`aria-disabled` reste donc INVISIBLE. Mesuré, pas supposé :
        la mutation `aria-disabled` → `disabled` laissait les 49 tests verts.
        C'est la fixture dégénérée de docs/39 §3, forme 3 — elle ne mentait
        pas, elle était incapable de voir.
      */
      let libererLaRequete: (valeur: unknown) => void = () => {};
      const enVol = new Promise((resoudre) => {
        libererLaRequete = resoudre;
      });
      const apresBascule = TROIS_FORMATS.map((c) =>
        c.id === 'cond-sac-10' ? { ...c, actif: false } : c,
      );
      appelApi.mockImplementation(async (chemin: string) => {
        if (chemin === '/conditionnements/cond-sac-10/activite') {
          await enVol;
          return apresBascule.find((c) => c.id === 'cond-sac-10');
        }
        if (chemin === '/referentiel/ingredients')
          return { data: [ingredient(), VERGEOISE], meta: { total: 2 } };
        if (chemin === '/conditionnements')
          return { data: apresBascule, meta: { total: apresBascule.length } };
        if (chemin === '/fournisseurs')
          return { data: [FOURNISSEUR, INVENTAIRE_OUVERTURE], meta: { total: 2 } };
        throw new Error(`Chemin non prévu par la fixture : ${chemin}`);
      });

      const bouton = boutonRetirer();
      await utilisateur.click(bouton);

      // 1. L'attente est ANNONCÉE, sans retirer le nœud du parcours de tabulation.
      await waitFor(() => expect(bouton).toHaveAttribute('aria-disabled', 'true'));
      // 2. Et le focus est TOUJOURS là : un `<button disabled>` qui a le focus
      //    le perd au profit de `<body>`, à cet instant précis.
      expect(bouton).toHaveFocus();

      // 3. L'inertie vient du GARDE-FOU, pas de l'attribut : `aria-disabled`
      //    n'empêche aucun clic, seul le test en tête de `basculerActivite` le
      //    fait. Sans lui, un double clic enverrait deux bascules — donc un
      //    aller-retour qui remettrait la ligne en service sans le vouloir.
      await utilisateur.click(bouton);
      expect(
        appelApi.mock.calls.filter(([c]) => c === '/conditionnements/cond-sac-10/activite'),
      ).toHaveLength(1);

      libererLaRequete(undefined);
      expect(
        await screen.findByRole('button', { name: 'Remettre ce format en service' }),
      ).toBeInTheDocument();
    },
  );

  it('« Remettre ce format en service » renvoie bien `actif: true`, pas une seconde désactivation', async () => {
    const utilisateur = userEvent.setup();
    await monterPret({ conditionnements: TROIS_FORMATS });

    await utilisateur.click(rangee('Farine de froment T55'));
    await utilisateur.click(rangee('Sac 25 kg (ancien tarif)'));

    routerBascule('cond-ancien', true);
    await utilisateur.click(screen.getByRole('button', { name: 'Remettre ce format en service' }));

    await waitFor(() =>
      expect(appelApi).toHaveBeenCalledWith(
        '/conditionnements/cond-ancien/activite',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const appel = appelApi.mock.calls.find(([c]) => c === '/conditionnements/cond-ancien/activite');
    expect(JSON.parse(String(appel?.[1]?.body))).toEqual({ actif: true });
  });

  it(
    'l’écran explique ce que le retrait fait VRAIMENT — il ne laisse pas croire à une ' +
      'suppression, et il prévient du double prix à la remise en service',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret({ conditionnements: TROIS_FORMATS });

      await utilisateur.click(rangee('Farine de froment T55'));
      await utilisateur.click(rangee('Sac 10 kg'));

      expect(screen.getByText(/Un format d’achat ne se supprime pas/)).toBeInTheDocument();
      expect(
        screen.getByText(/il ne sert plus au coût matière ni aux bons de commande/),
      ).toBeInTheDocument();

      // Discriminant : la ligne archivée porte l'AUTRE mise en garde, celle du
      // double prix. Un texte unique serait vert sur la première moitié.
      await utilisateur.click(rangee('Sac 25 kg (ancien tarif)'));
      expect(
        screen.getByText(/deux prix coexisteraient alors pour le même article/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Un format d’achat ne se supprime pas/)).not.toBeInTheDocument();
    },
  );

  it(
    'un refus du serveur s’AFFICHE dans le panneau de consultation — le bandeau n’y existait ' +
      'pas, un échec y aurait été muet',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret({ conditionnements: TROIS_FORMATS });

      await utilisateur.click(rangee('Farine de froment T55'));
      await utilisateur.click(rangee('Sac 10 kg'));

      appelApi.mockRejectedValue(
        new ErreurApi('Période comptable verrouillée : ce format ne peut plus changer.', {
          code: 'periode_verrouillee',
          statut: 409,
        }),
      );
      await utilisateur.click(boutonRetirer());

      expect(
        await screen.findByText('Période comptable verrouillée : ce format ne peut plus changer.'),
      ).toBeInTheDocument();
    },
  );

  it('un échec qui n’est pas une `ErreurApi` retombe sur le message générique, jamais sur rien', async () => {
    const utilisateur = userEvent.setup();
    await monterPret({ conditionnements: TROIS_FORMATS });

    await utilisateur.click(rangee('Farine de froment T55'));
    await utilisateur.click(rangee('Sac 10 kg'));

    appelApi.mockRejectedValue(new TypeError('Failed to fetch'));
    await utilisateur.click(boutonRetirer());

    expect(await screen.findByText('Erreur inattendue, sans plus de détail.')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Attente d'écriture — promesse CONTRÔLÉE (docs/39 §3, cinquième forme)

   Tous les tests d'enregistrement ci-dessus résolvent leur promesse
   IMMÉDIATEMENT (`mockImplementation(async …)` ou `mockRejectedValue`) :
   l'état d'envoi retombe dans le même écoulement de micro-tâches que sa pose
   et n'atteint jamais le DOM. Mesuré le 02/08/2026 : neutraliser la pose de
   l'état en vol sur cet écran laissait CE fichier entièrement vert, sauf le
   test `aria-disabled` déjà présent plus haut (ligne ~1173). Les deux blocs
   suivants couvrent les DEUX emplacements qui restaient aveugles : le bouton
   `disabled` de la fiche ingrédient, et celui du formulaire de
   conditionnement (tarif/création/correction).
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Ingrédients — attente d’écriture : la FICHE l’annonce, puis redevient actionnable', () => {
  it(
    'pendant le PATCH, « Enregistrer » est `disabled` ET l’indicateur dit « Enregistrement… », ' +
      'puis les deux redeviennent normaux',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.click(rangee('Farine de froment T55'));

      let repondre: ((valeur: unknown) => void) | undefined;
      const modifie = ingredient({ stockSecurite: 8_000 });
      appelApi.mockImplementation(async (chemin: string) => {
        if (chemin === '/ingredients/ing-farine-t55') {
          return new Promise((resoudre) => {
            repondre = resoudre;
          });
        }
        if (chemin === '/referentiel/ingredients')
          return { data: [modifie, VERGEOISE], meta: { total: 2 } };
        if (chemin === '/conditionnements')
          return { data: [conditionnement()], meta: { total: 1 } };
        if (chemin === '/fournisseurs')
          return { data: [FOURNISSEUR, INVENTAIRE_OUVERTURE], meta: { total: 2 } };
        throw new Error(`Chemin non prévu : ${chemin}`);
      });

      const stock = screen.getByRole('textbox', { name: /^Stock de sécurité/ });
      await utilisateur.clear(stock);
      await utilisateur.type(stock, '8000');
      await utilisateur.click(boutonEnregistrer());

      // 1. L'attente est ANNONCÉE : le bouton s'inertise, l'indicateur le confirme.
      expect(boutonEnregistrer()).toBeDisabled();
      expect(screen.getByText('Enregistrement…')).toBeInTheDocument();
      /*
        2. Un second clic ou une Entrée sur CE bouton ne prouveraient rien :
        `disabled` natif, bloqué par le navigateur lui-même (même mise en
        garde que `SaisieSortie.montage.test.tsx`, ligne ~490). Le chemin qui
        contourne RÉELLEMENT ce bouton est Ctrl+S — voir le test (ex-`it.fails`)
        ci-dessous, qui montre qu'aucun garde-fou interne ne le bloque, lui.
      */

      repondre?.(modifie);

      // 3. Après la réponse, le contrôle redevient actionnable ET l'indicateur le dit.
      await screen.findByText(/^Enregistré /);
      expect(boutonEnregistrer()).not.toBeDisabled();
    },
  );
});

describe('Ingrédients — attente d’écriture : le CONDITIONNEMENT l’annonce, puis redevient actionnable', () => {
  it(
    'pendant l’enregistrement d’un nouveau tarif, le bouton « Enregistrer » du conditionnement ' +
      's’inertise, puis le panneau referme le formulaire au succès',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.click(rangee('Farine de froment T55'));
      await utilisateur.click(rangee('Sac 25 kg'));
      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer un nouveau tarif' }));

      const prix = screen.getByRole('textbox', { name: /^Prix payé/ });
      await utilisateur.type(prix, '19,50');
      await utilisateur.type(screen.getByLabelText('Prix en vigueur le'), '2026-02-01');

      let repondre: ((valeur: unknown) => void) | undefined;
      const apresTarif = conditionnement({ prixCents: 1_950, datePrix: '2026-02-01' });
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/conditionnements/cond-sac-25/tarifs' && options?.method === 'POST') {
          return new Promise((resoudre) => {
            repondre = resoudre;
          });
        }
        if (chemin === '/referentiel/ingredients')
          return { data: [ingredient(), VERGEOISE], meta: { total: 2 } };
        if (chemin === '/conditionnements') return { data: [apresTarif], meta: { total: 1 } };
        if (chemin === '/fournisseurs')
          return { data: [FOURNISSEUR, INVENTAIRE_OUVERTURE], meta: { total: 2 } };
        throw new Error(`Chemin non prévu : ${chemin}`);
      });

      // Mode « tarif » : le libellé du bouton est « Enregistrer le tarif »,
      // pas « Enregistrer » (`mode === 'tarif' ? 'Enregistrer le tarif' : …`,
      // `Ingredients.tsx`) — à ne pas confondre avec celui de la FICHE, qui
      // porte le libellé nu.
      const bouton = screen.getByRole('button', { name: 'Enregistrer le tarif' });
      await utilisateur.click(bouton);

      // 1. L'attente est ANNONCÉE.
      expect(bouton).toBeDisabled();
      /*
        2. Un second clic ou une Entrée ne prouveraient rien : `disabled`
        natif, bloqué par le navigateur — ce formulaire n'a pas de raccourci
        Ctrl+S qui le contournerait (contrairement à la fiche ingrédient,
        ci-dessus, ou à la fiche concurrent).
      */

      repondre?.(apresTarif);

      // 3. Au succès, le panneau REFERME le formulaire d'écriture : c'est ce
      // retour à « Enregistrer un nouveau tarif » qui prouve que le contrôle
      // est redevenu actionnable — le bouton `disabled` lui-même ne survit
      // pas à la fermeture.
      await screen.findByRole('button', { name: 'Enregistrer un nouveau tarif' });
      expect(screen.queryByRole('textbox', { name: /^Prix payé/ })).not.toBeInTheDocument();
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   Défaut RÉEL trouvé en lisant la production — corrigé le 28/09/2026
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Ingrédients — défaut RÉEL : Ctrl+S contourne le `disabled`, SANS garde-fou interne', () => {
  /**
   * `it.fails` (docs/39 §8). `enregistrer()` (`Ingredients.tsx`) ne porte
   * AUCUN garde du type `if (enregistrement.phase === 'enregistrement') return;`
   * en tête de fonction — à la différence de `basculerActivite`, plus bas dans
   * le MÊME fichier, qui en a un (`if (choisi === null || envoi === 'envoi')
   * return;`). Seul le `disabled` natif du bouton « Enregistrer » empêche un
   * second clic ou une seconde soumission par Entrée. Mais Ctrl+S appelle
   * `enregistrer()` DIRECTEMENT depuis le conteneur englobant (`onKeyDown` en
   * tête de l'écran, `Ingredients.tsx`), sans passer par ce bouton : un second
   * Ctrl+S pendant l'aller-retour envoie donc une SECONDE écriture PATCH sur
   * le même ingrédient. Trouvé en lisant la production le 02/08/2026 ; CORRIGÉ
   * le 28/09/2026 par une garde en tête de `enregistrer()`. Le test, en
   * `it.fails` jusque-là, est devenu un test ordinaire.
   */
  it('un second Ctrl+S PENDANT l’aller-retour ne devrait PAS déclencher une seconde écriture', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();
    await utilisateur.click(rangee('Farine de froment T55'));

    const modifie = ingredient({ stockSecurite: 8_000 });
    const resolveurs: Array<(valeur: unknown) => void> = [];
    appelApi.mockImplementation(async (chemin: string) => {
      if (chemin === '/ingredients/ing-farine-t55') {
        return new Promise((resoudre) => resolveurs.push(resoudre));
      }
      if (chemin === '/referentiel/ingredients')
        return { data: [modifie, VERGEOISE], meta: { total: 2 } };
      if (chemin === '/conditionnements') return { data: [conditionnement()], meta: { total: 1 } };
      if (chemin === '/fournisseurs')
        return { data: [FOURNISSEUR, INVENTAIRE_OUVERTURE], meta: { total: 2 } };
      throw new Error(`Chemin non prévu : ${chemin}`);
    });

    const stock = screen.getByRole('textbox', { name: /^Stock de sécurité/ });
    await utilisateur.clear(stock);
    await utilisateur.type(stock, '8000');
    stock.focus();
    await utilisateur.keyboard('{Control>}s{/Control}');
    // PENDANT l'aller-retour : le bouton est déjà inerte…
    expect(boutonEnregistrer()).toBeDisabled();

    try {
      // …mais Ctrl+S, LUI, ne passe pas par ce bouton.
      await utilisateur.keyboard('{Control>}s{/Control}');

      expect(appelApi.mock.calls.filter(([c]) => c === '/ingredients/ing-farine-t55')).toHaveLength(
        1,
      );
    } finally {
      resolveurs.forEach((resoudre) => resoudre(modifie));
    }
  });
});
