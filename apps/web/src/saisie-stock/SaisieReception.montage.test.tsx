/**
 * `SaisieReception` MONTÉ — le premier maillon de la chaîne de données.
 *
 * ═══ Pourquoi ce fichier existe ═══
 *
 * `SaisieReception.test.tsx`, à côté, teste `valeursFormulaireVide`,
 * `actionSurEntree` et `cleAFocaliserApresRetrait` — trois fonctions PURES
 * extraites précisément parce que le dépôt ne savait pas monter un composant.
 * Il reste valable et n'est pas touché. Mesuré le 01/08/2026, le fichier
 * n'était couvert qu'à 9,38 % : le refus de saisie ligne par ligne, la
 * traçabilité par numéro de lot OU par DLC (fiche 16), la remise à blanc et la
 * reprise de focus après enregistrement, l'annulation D-087 — rien n'était
 * atteignable.
 *
 * Une réception écrit des LOTS. Un lot mal identifié est un rappel de
 * marchandise impossible à effectuer (CLAUDE.md §3 règle 6) : les refus
 * vérifiés ici ne sont pas de l'ergonomie.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  avertissementDlcDejaDepassee,
  formaterQuantite,
  type CommandeResume,
  type Fournisseur,
} from '@batte/core';
import { aujourdHui } from '../lib/dates';

import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  // `import type * as …` et non `typeof import(...)` : la règle ESLint
  // `consistent-type-imports` interdit la seconde forme — même formulation que
  // `BoutonDocument.montage.test.tsx`, le modèle de ce dépôt.
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { SaisieReception } = await import('./SaisieReception');

const appelApi = vi.mocked(requeteApi);

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

const MEUNIER: Fournisseur = {
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
  nbConditionnements: 2,
};

/** Désactivé : reste dans l'historique, disparaît des listes de choix. */
const FOURNISSEUR_RETIRE: Fournisseur = {
  ...MEUNIER,
  id: 'fou-ancien',
  nom: 'Grossiste Delvaux',
  type: 'grossiste',
  actif: false,
};

/** SANS durée de conservation : aucune DLC ne peut être déduite. */
const FARINE = {
  id: 'ing-farine',
  nom: 'Farine de froment T55',
  categorie: 'farine',
  unite: 'g' as const,
  densiteGParMl: null,
  allergenes: ['gluten'],
  allergenesVerifies: true,
  stockSecurite: 5_000,
  dureeConservationJours: null,
};

/** AVEC durée de conservation : la DLC se déduit, l'identifiant existe donc. */
const LAIT = {
  id: 'ing-lait',
  nom: 'Lait entier',
  categorie: 'laitier',
  unite: 'ml' as const,
  densiteGParMl: 1.03,
  allergenes: ['lait'],
  allergenesVerifies: true,
  stockSecurite: 2_000,
  dureeConservationJours: 8,
};

const COMMANDE_OUVERTE: CommandeResume = {
  id: 'cmd-1',
  numero: 'CD-2026-0004',
  fournisseurId: 'fou-meunier',
  fournisseurNom: 'Moulin de Hollogne',
  statut: 'envoyee',
  dateCreation: '2026-07-25',
  dateEnvoi: '2026-07-26',
  montantTotalCents: 8_900,
  nbLignes: 3,
  genereAutomatiquement: true,
  receptionNumero: null,
  receptionStatut: null,
};

/** Déjà reçue : le serveur la refuserait, l'écran ne la propose donc pas. */
const COMMANDE_SOLDEE: CommandeResume = {
  ...COMMANDE_OUVERTE,
  id: 'cmd-close',
  numero: 'CD-2026-0001',
  statut: 'recue',
};

const RECEPTION_CREEE = {
  receptionId: 'rec-1',
  numero: 'RC-2026-0012',
  montantTotalCents: 4_900,
  nbLots: 2,
  avertissements: [],
  commandeNumero: null,
};

type Monde = {
  fournisseurs?: unknown[];
  ingredients?: unknown[];
  commandes?: unknown[];
};

function routerLectures(monde: Monde = {}): void {
  const fournisseurs = monde.fournisseurs ?? [MEUNIER, FOURNISSEUR_RETIRE];
  const ingredients = monde.ingredients ?? [FARINE, LAIT];
  const commandes = monde.commandes ?? [COMMANDE_OUVERTE, COMMANDE_SOLDEE];

  appelApi.mockImplementation(async (chemin: string) => {
    if (chemin === '/fournisseurs')
      return { data: fournisseurs, meta: { total: fournisseurs.length } };
    if (chemin === '/ingredients')
      return { data: ingredients, meta: { total: ingredients.length } };
    if (chemin === '/commandes') return { data: commandes, meta: { total: commandes.length } };
    throw new Error(`Chemin non prévu par la fixture : ${chemin}`);
  });
}

type Props = Parameters<typeof SaisieReception>[0];

function proprietes(surcharges: Partial<Props> = {}): Props {
  return {
    variante: 'reception',
    onEnregistre: vi.fn(),
    onAnnuler: vi.fn(),
    ...surcharges,
  };
}

async function monterPret(monde: Monde = {}, surcharges: Partial<Props> = {}): Promise<Props> {
  routerLectures(monde);
  const props = proprietes(surcharges);
  render(<SaisieReception {...props} />);
  await screen.findByRole('combobox', { name: /^Fournisseur/ });
  return props;
}

const champFournisseur = () => screen.getByRole('combobox', { name: /^Fournisseur/ });
const champDate = () => screen.getByLabelText(/^Date de réception/);
const boutonEnregistrer = () =>
  screen.getByRole('button', { name: /Enregistrer la réception|Enregistrement…/ });

/** Champs de la ligne `n` (1-indexée) — leur libellé porte le numéro. */
const champIngredient = (n = 1) => screen.getByRole('combobox', { name: `Ingrédient, ligne ${n}` });
const champQuantite = (n = 1) =>
  screen.getByRole('textbox', { name: `Quantité reçue, ligne ${n}` });
const champPrix = (n = 1) =>
  screen.getByRole('textbox', { name: `Prix payé pour la ligne ${n}, en euros` });
const champNumeroLot = (n = 1) =>
  screen.getByRole('textbox', { name: `Numéro de lot fournisseur, ligne ${n}` });
const champDlc = (n = 1) => screen.getByLabelText(`Date limite de consommation, ligne ${n}`);

/**
 * Remplit une ligne complète et valide.
 *
 * `Ctrl+S` est employé partout comme déclencheur : le `<select name="fournisseurId">`
 * porte `required`, donc un CLIC sur le bouton `type="submit"` est intercepté
 * par la validation NATIVE du navigateur tant que le fournisseur est vide — et
 * `enregistrer()` n'est jamais appelée (voir le `it.fails` en fin de fichier).
 */
async function remplirLigneValide(utilisateur: ReturnType<typeof userEvent.setup>): Promise<void> {
  await utilisateur.selectOptions(champIngredient(), 'ing-farine');
  await utilisateur.type(champQuantite(), '25000');
  await utilisateur.type(champPrix(), '18,75');
  await utilisateur.type(champNumeroLot(), 'LOT-2026-0731-A');
}

beforeEach(() => {
  appelApi.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Chargement du référentiel
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieReception — les états du référentiel', () => {
  it('annonce le chargement avant que les trois listes ne soient revenues', () => {
    appelApi.mockImplementation(() => new Promise(() => {}));
    render(<SaisieReception {...proprietes()} />);

    expect(screen.getByText('Chargement du référentiel…')).toBeInTheDocument();
  });

  it('un échec affiche le message du serveur, jamais un formulaire à moitié utilisable', async () => {
    appelApi.mockRejectedValue(
      new ErreurApi('Le référentiel est indisponible.', { code: 'indisponible', statut: 503 }),
    );
    render(<SaisieReception {...proprietes()} />);

    expect(await screen.findByText('Le référentiel est indisponible.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Fournisseur/ })).not.toBeInTheDocument();
  });

  it(
    'sans AUCUN fournisseur actif, l’écran explique pourquoi il ne peut rien saisir — un lot ' +
      'porte toujours l’identité de celui qui l’a livré',
    async () => {
      routerLectures({ fournisseurs: [FOURNISSEUR_RETIRE] });
      render(<SaisieReception {...proprietes()} />);

      expect(await screen.findByText('Aucun fournisseur actif')).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: /^Fournisseur/ })).not.toBeInTheDocument();
    },
  );

  it('un fournisseur DÉSACTIVÉ ne figure pas dans la liste de choix', async () => {
    await monterPret();

    const options = [...(champFournisseur() as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toContain('fou-meunier');
    expect(options).not.toContain('fou-ancien');
  });

  it('le premier champ reçoit le focus dès que le formulaire devient utilisable', async () => {
    await monterPret();

    // Sans ce rappel, ouvrir la saisie au clavier coûte une vingtaine de
    // tabulations (le bouton qui l'ouvrait a disparu en s'ouvrant).
    await waitFor(() => expect(champFournisseur()).toHaveFocus());
  });

  it('la variante « inventaire » pré-remplit la note qui distingue l’ouverture d’un achat réel', async () => {
    await monterPret({}, { variante: 'inventaire' });

    expect(screen.getByRole('textbox', { name: /^Notes/ })).toHaveValue("Inventaire d'ouverture");
    expect(screen.getByRole('button', { name: "Enregistrer l'inventaire" })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Commandes soldables
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieReception — la commande à solder (D-036)', () => {
  it('le sélecteur n’apparaît QU’UNE FOIS un fournisseur choisi, jamais vide en permanence', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    expect(screen.queryByRole('combobox', { name: /^Commande à solder/ })).not.toBeInTheDocument();

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');

    expect(screen.getByRole('combobox', { name: /^Commande à solder/ })).toBeInTheDocument();
  });

  it('une commande déjà REÇUE n’est pas proposée : le serveur la refuserait', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');

    const options = [
      ...(screen.getByRole('combobox', { name: /^Commande à solder/ }) as HTMLSelectElement)
        .options,
    ].map((o) => o.value);
    expect(options).toContain('cmd-1');
    expect(options).not.toContain('cmd-close');
  });

  it(
    'changer de fournisseur OUBLIE la commande choisie — sinon la réception serait rattachée à ' +
      'la commande d’un autre',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret({
        fournisseurs: [MEUNIER, { ...MEUNIER, id: 'fou-autre', nom: 'Ferme du Ry', actif: true }],
      });

      await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
      const commande = screen.getByRole('combobox', {
        name: /^Commande à solder/,
      }) as HTMLSelectElement;
      await utilisateur.selectOptions(commande, 'cmd-1');
      expect(commande.value).toBe('cmd-1');

      await utilisateur.selectOptions(champFournisseur(), 'fou-autre');
      await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');

      expect(
        (screen.getByRole('combobox', { name: /^Commande à solder/ }) as HTMLSelectElement).value,
      ).toBe('');
    },
  );

  it('l’aide avertit du DOUBLE COMPTAGE tant qu’aucune commande n’est rattachée', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');

    expect(
      screen.getByText(/la marchandise reçue sera comptée deux fois par le point de commande/),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Les refus de saisie, un par un
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieReception — refus de saisie : aucune pièce ne part incomplète', () => {
  it('un fournisseur non choisi bloque, avec son message d’en-tête', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await remplirLigneValide(utilisateur);
    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(
      screen.getByText('Choisissez le fournisseur qui a livré cette marchandise.'),
    ).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalledWith('/receptions', expect.anything());
  });

  it('la variante « inventaire » dit AUTRE CHOSE sur le même refus — le geste n’est pas le même', async () => {
    const utilisateur = userEvent.setup();
    await monterPret({}, { variante: 'inventaire' });

    await remplirLigneValide(utilisateur);
    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(
      screen.getByText(/créez un fournisseur « Inventaire d'ouverture » dans l'écran Fournisseurs/),
    ).toBeInTheDocument();
  });

  it('une date de réception vidée bloque', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await remplirLigneValide(utilisateur);
    await utilisateur.clear(champDate());
    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(screen.getByText('Indiquez le jour où la marchandise est arrivée.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalledWith('/receptions', expect.anything());
  });

  /**
   * Même défaut que le fournisseur, mais côté `ChampSaisie` (l'`<input>`) plutôt
   * que `ChampSelection` : `dateReception` reçoit aussi `obligatoire`, donc
   * portait aussi `required`. Un `input[type=date]` vidé rend le champ
   * invalide aux yeux du navigateur exactement comme un `<select>` vide — la
   * même interception native, un mécanisme distinct à vérifier séparément.
   */
  it('une date de réception vidée bloque désormais au CLIC aussi, pas seulement au Ctrl+S', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await remplirLigneValide(utilisateur);
    await utilisateur.clear(champDate());
    await utilisateur.click(boutonEnregistrer());

    expect(screen.getByText('Indiquez le jour où la marchandise est arrivée.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalledWith('/receptions', expect.anything());
  });

  it('un ingrédient non choisi bloque SA ligne', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await utilisateur.type(champQuantite(), '25000');
    await utilisateur.type(champPrix(), '18,75');
    await utilisateur.type(champNumeroLot(), 'LOT-A');
    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(screen.getByText('Choisissez un ingrédient dans la liste.')).toBeInTheDocument();
  });

  it(
    'le message de quantité nomme l’unité de RÉFÉRENCE une fois l’ingrédient connu, et reste ' +
      'générique tant qu’il ne l’est pas',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
      await utilisateur.type(champPrix(), '18,75');
      await utilisateur.type(champNumeroLot(), 'LOT-A');
      champPrix().focus();
      await utilisateur.keyboard('{Control>}s{/Control}');
      expect(
        screen.getByText('La quantité reçue doit être un nombre entier supérieur à zéro.'),
      ).toBeInTheDocument();

      await utilisateur.selectOptions(champIngredient(), 'ing-lait');
      champPrix().focus();
      await utilisateur.keyboard('{Control>}s{/Control}');
      expect(
        screen.getByText(
          'La quantité reçue doit être un nombre entier de millilitres, supérieur à zéro.',
        ),
      ).toBeInTheDocument();
    },
  );

  it('un prix illisible bloque, avec le format attendu en exemple', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await utilisateur.selectOptions(champIngredient(), 'ing-farine');
    await utilisateur.type(champQuantite(), '25000');
    await utilisateur.type(champPrix(), 'offert');
    await utilisateur.type(champNumeroLot(), 'LOT-A');
    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(screen.getByText('Montant illisible. Exemple attendu : 24,90')).toBeInTheDocument();
  });

  it('un prix NÉGATIF est refusé — un remboursement n’est pas une réception', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await utilisateur.selectOptions(champIngredient(), 'ing-farine');
    await utilisateur.type(champQuantite(), '25000');
    await utilisateur.type(champPrix(), '-5,00');
    await utilisateur.type(champNumeroLot(), 'LOT-A');
    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(screen.getByText('Le prix payé ne peut pas être négatif.')).toBeInTheDocument();
  });

  it('un prix de ZÉRO est ACCEPTÉ : un échantillon offert est une vraie réception', async () => {
    const utilisateur = userEvent.setup();
    const props = await monterPret();

    appelApi.mockImplementation(async (chemin: string) => {
      if (chemin === '/receptions') return RECEPTION_CREEE;
      throw new Error(`Chemin non prévu : ${chemin}`);
    });

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await utilisateur.selectOptions(champIngredient(), 'ing-farine');
    await utilisateur.type(champQuantite(), '1000');
    await utilisateur.type(champPrix(), '0,00');
    await utilisateur.type(champNumeroLot(), 'LOT-ECH');
    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    await waitFor(() => expect(props.onEnregistre).toHaveBeenCalledWith(RECEPTION_CREEE));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Traçabilité par lot (fiche 16) — numéro OU DLC, jamais les deux exigés
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieReception — un lot doit être IDENTIFIABLE (CLAUDE.md §3 règle 6)', () => {
  it('ni numéro, ni DLC saisie, ni DLC déductible : la réception est refusée', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    // FARINE n'a AUCUNE durée de conservation : rien à déduire.
    await utilisateur.selectOptions(champIngredient(), 'ing-farine');
    await utilisateur.type(champQuantite(), '25000');
    await utilisateur.type(champPrix(), '18,75');
    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(
      screen.getByText(
        'Aucun identifiant pour ce lot : indiquez un numéro de lot fournisseur, ou à défaut une DLC précise (jour et mois).',
      ),
    ).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalledWith('/receptions', expect.anything());
  });

  it(
    'la SEULE DLC suffit à identifier un lot — la directive 2011/91/UE ne réclame pas les deux, ' +
      'et les exiger ensemble bloquerait une réception parfaitement traçable',
    async () => {
      const utilisateur = userEvent.setup();
      const props = await monterPret();

      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/receptions') return RECEPTION_CREEE;
        return routeurBase?.(chemin, options);
      });

      await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
      await utilisateur.selectOptions(champIngredient(), 'ing-farine');
      await utilisateur.type(champQuantite(), '25000');
      await utilisateur.type(champPrix(), '18,75');
      await utilisateur.type(champDlc(), '2027-01-31');
      champQuantite().focus();
      await utilisateur.keyboard('{Control>}s{/Control}');

      await waitFor(() => expect(props.onEnregistre).toHaveBeenCalledWith(RECEPTION_CREEE));
    },
  );

  it(
    'une DLC DÉDUCTIBLE (durée de conservation déclarée) suffit aussi — c’est le serveur qui la ' +
      'posera, l’écran ne l’envoie pas',
    async () => {
      const utilisateur = userEvent.setup();
      const props = await monterPret();

      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/receptions') return RECEPTION_CREEE;
        return routeurBase?.(chemin, options);
      });

      await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
      // LAIT porte `dureeConservationJours: 8`.
      await utilisateur.selectOptions(champIngredient(), 'ing-lait');
      await utilisateur.type(champQuantite(), '12000');
      await utilisateur.type(champPrix(), '9,60');
      champQuantite().focus();
      await utilisateur.keyboard('{Control>}s{/Control}');

      await waitFor(() => expect(props.onEnregistre).toHaveBeenCalled());
      const appel = appelApi.mock.calls.find(([c]) => c === '/receptions');
      const corps = JSON.parse(String((appel?.[1] as RequestInit).body)) as {
        lignes: { dateDlc: unknown; numeroLotFournisseur: unknown }[];
      };
      // NI la DLC déduite NI un numéro inventé : les deux restent `null`, le
      // serveur reste seul auteur d'une donnée réglementaire.
      expect(corps.lignes[0]?.dateDlc).toBeNull();
      expect(corps.lignes[0]?.numeroLotFournisseur).toBeNull();
    },
  );

  it('quand seule la DLC identifie, l’écran AVERTIT sans bloquer', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.selectOptions(champIngredient(), 'ing-farine');
    await utilisateur.type(champDlc(), '2027-01-31');

    expect(
      screen.getByText(
        'DLC seule : deux réceptions à cette DLC seront indistinguables en cas de rappel.',
      ),
    ).toBeInTheDocument();
  });

  it('dès qu’un numéro de lot existe, l’avertissement disparaît', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.selectOptions(champIngredient(), 'ing-farine');
    await utilisateur.type(champDlc(), '2027-01-31');
    await utilisateur.type(champNumeroLot(), 'LOT-A');

    expect(screen.queryByText(/indistinguables en cas de rappel/)).not.toBeInTheDocument();
  });

  it('une DLC déjà dépassée à la réception est signalée — sans jamais refuser (CLAUDE.md §7)', async () => {
    const utilisateur = userEvent.setup();
    const props = await monterPret();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/receptions') return RECEPTION_CREEE;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await utilisateur.selectOptions(champIngredient(), 'ing-farine');
    await utilisateur.type(champQuantite(), '25000');
    await utilisateur.type(champPrix(), '18,75');
    await utilisateur.type(champNumeroLot(), 'LOT-A');
    // Le champ « Date de réception » est pré-rempli au jour courant.
    const dateDuJour = aujourdHui();
    // Une faute de frappe sur l'année, le cas visé par la fiche.
    await utilisateur.type(champDlc(), '2020-01-31');

    /*
      Comparé VIA `avertissementDlcDejaDepassee` (`@batte/core`), jamais par un
      motif lâche : la phrase NOMME l'ingrédient, la DLC saisie, le nombre de
      jours de retard et la date de réception. Un `/déjà dépassée/` resterait
      vert si une reformulation perdait le nom de l'ingrédient — or c'est lui
      qui rend l'avertissement actionnable.
    */
    const attendu = avertissementDlcDejaDepassee('Farine de froment T55', '2020-01-31', dateDuJour);
    expect(attendu).not.toBeNull();
    expect(screen.getByText(attendu as string)).toBeInTheDocument();

    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');
    // NON BLOQUANT : l'enregistrement passe quand même.
    await waitFor(() => expect(props.onEnregistre).toHaveBeenCalled());
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le total de contrôle — inconnu ≠ zéro
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieReception — le total de contrôle, comparé au bon de livraison', () => {
  it('sans aucun prix lisible, le total affiche un TIRET, jamais « 0,00 € »', async () => {
    await monterPret();

    const pied = screen.getByText('Total saisi').closest('span');
    expect(pied).not.toBeNull();
    expect(within(pied as HTMLElement).queryByText('0,00 €')).not.toBeInTheDocument();
    expect((pied as HTMLElement).textContent).toContain('—');
  });

  it('somme les prix lisibles, et compte à part les montants illisibles', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.type(champPrix(), '18,75');
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
    await utilisateur.type(champPrix(2), 'offert');

    expect(screen.getByText('18,75 €')).toBeInTheDocument();
    expect(screen.getByText(/1 montant illisible/)).toBeInTheDocument();
  });

  it('relit la quantité saisie dans son unité — une faute d’un facteur mille se voit', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.selectOptions(champIngredient(), 'ing-farine');
    await utilisateur.type(champQuantite(), '25000');

    // Comparé VIA le formateur (espace insécable posée par `Intl`).
    expect(screen.getByText(formaterQuantite(25_000, 'g'))).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Enregistrement : la pièce entière, puis la remise à blanc
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieReception — une réception est une PIÈCE, écrite en une seule requête', () => {
  it('envoie TOUTES les lignes en un seul POST', async () => {
    const utilisateur = userEvent.setup();
    const props = await monterPret();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/receptions') return RECEPTION_CREEE;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await remplirLigneValide(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
    await utilisateur.selectOptions(champIngredient(2), 'ing-lait');
    await utilisateur.type(champQuantite(2), '12000');
    await utilisateur.type(champPrix(2), '9,60');
    await utilisateur.type(champNumeroLot(2), 'LOT-LAIT-B');

    await utilisateur.click(boutonEnregistrer());

    await waitFor(() => expect(props.onEnregistre).toHaveBeenCalledWith(RECEPTION_CREEE));
    const appelsReception = appelApi.mock.calls.filter(([c]) => c === '/receptions');
    // UNE seule requête : une réception à moitié écrite laisserait des lots
    // sans mouvement d'entrée, donc un stock faux.
    expect(appelsReception).toHaveLength(1);
    const corps = JSON.parse(String((appelsReception[0]?.[1] as RequestInit).body)) as {
      lignes: unknown[];
    };
    expect(corps.lignes).toHaveLength(2);
  });

  it('un enregistrement réussi VIDE le formulaire et lui rend le focus, sans le fermer', async () => {
    const utilisateur = userEvent.setup();
    const props = await monterPret();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/receptions') return RECEPTION_CREEE;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await remplirLigneValide(utilisateur);
    await utilisateur.click(boutonEnregistrer());

    await waitFor(() => expect(props.onEnregistre).toHaveBeenCalled());
    // Vidé…
    await waitFor(() => expect(champFournisseur()).toHaveValue(''));
    expect(champQuantite()).toHaveValue('');
    // …et le focus est revenu au premier champ, pas sur `<body>` : le porteur
    // enchaîne les réceptions, plusieurs fournisseurs livrent le même jour.
    await waitFor(() => expect(champFournisseur()).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it('un refus du serveur GARDE la saisie à l’écran — jamais retaper ce qui vient d’être tapé', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/receptions')
        throw new ErreurApi('Période comptable verrouillée.', {
          code: 'periode_verrouillee',
          statut: 409,
        });
      return routeurBase?.(chemin, options);
    });

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await remplirLigneValide(utilisateur);
    await utilisateur.click(boutonEnregistrer());

    expect(await screen.findByText('Période comptable verrouillée.')).toBeInTheDocument();
    expect(champQuantite()).toHaveValue('25000');
    expect(champFournisseur()).toHaveValue('fou-meunier');
  });

  it(
    'un champ que cet écran ne sait pas afficher (`lignes.0.quantite`) remonte en bandeau — ' +
      'jamais un refus muet',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/receptions')
          throw new ErreurApi('Saisie refusée.', {
            code: 'validation',
            statut: 422,
            champs: { 'lignes.0.quantite': 'Quantité supérieure au maximum autorisé.' },
          });
        return routeurBase?.(chemin, options);
      });

      await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
      await remplirLigneValide(utilisateur);
      await utilisateur.click(boutonEnregistrer());

      expect(
        await screen.findByText('Saisie refusée. Quantité supérieure au maximum autorisé.'),
      ).toBeInTheDocument();
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   Reprise immédiate : annuler la réception qu'on vient d'écrire (D-087)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieReception — annuler la réception qu’on vient d’écrire (D-087)', () => {
  /** Enregistre une réception valide et rend l'utilisateur pour la suite. */
  async function enregistrerPuisReprendre(): Promise<ReturnType<typeof userEvent.setup>> {
    const utilisateur = userEvent.setup();
    await monterPret();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/receptions') return RECEPTION_CREEE;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await remplirLigneValide(utilisateur);
    await utilisateur.click(boutonEnregistrer());
    await screen.findByRole('button', { name: 'Annuler cette réception…' });
    return utilisateur;
  }

  it('le bloc de reprise n’existe qu’APRÈS un enregistrement', async () => {
    await monterPret();

    expect(
      screen.queryByRole('button', { name: 'Annuler cette réception…' }),
    ).not.toBeInTheDocument();
  });

  it('affiche le numéro rendu par le SERVEUR et le nombre de lots créés', async () => {
    await enregistrerPuisReprendre();

    expect(screen.getByText('RC-2026-0012')).toBeInTheDocument();
    expect(screen.getByText(/2 lots créés\./)).toBeInTheDocument();
  });

  it('une annulation sans motif est refusée avant tout appel', async () => {
    const utilisateur = await enregistrerPuisReprendre();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler cette réception…' }));
    appelApi.mockClear();
    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception' }));

    expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalledWith('/receptions/rec-1/annuler', expect.anything());
  });

  it(
    'l’annulation réussie laisse l’enregistrement ET sa confirmation à l’écran (D-083), et rend ' +
      'le focus au premier champ pour ressaisir',
    async () => {
      const utilisateur = await enregistrerPuisReprendre();

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

      await utilisateur.click(screen.getByRole('button', { name: 'Annuler cette réception…' }));
      await utilisateur.selectOptions(
        screen.getByRole('combobox', { name: /^Motif de l'annulation/ }),
        'ERREUR_SAISIE',
      );
      await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception' }));

      await screen.findByText(/2 entrées contrepassées/);
      // Rien ne s'efface : le numéro reste lisible à côté de son annulation.
      expect(screen.getByText('RC-2026-0012')).toBeInTheDocument();
      await waitFor(() => expect(champFournisseur()).toHaveFocus());
    },
  );

  it('un refus d’annulation garde le bloc ouvert et rend le focus au bouton de confirmation', async () => {
    const utilisateur = await enregistrerPuisReprendre();

    /*
      LE REFUS EST RETARDÉ, ET LE FOCUS DÉPLACÉ PENDANT L'APPEL. Sans cela le
      test ne prouve rien : jsdom — contrairement à un vrai navigateur — ne
      retire PAS le focus d'un bouton qui devient `disabled`. Le bouton le
      garderait donc du simple fait du clic, et une mutation supprimant la
      reprise de focus resterait verte (mesuré le 01/08/2026). Déplacer le
      focus pendant que la requête est en vol reproduit ce que le navigateur
      fait de lui-même, et rend la DESTINATION observable.
    */
    let refuser: (() => void) | undefined;
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/receptions/rec-1/annuler')
        return new Promise((_, rejeter) => {
          refuser = () =>
            rejeter(
              new ErreurApi(
                'Un lot de cette réception a déjà été consommé : la contrepassation est impossible.',
                { code: 'entree_deja_consommee', statut: 422 },
              ),
            );
        });
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler cette réception…' }));
    await utilisateur.selectOptions(
      screen.getByRole('combobox', { name: /^Motif de l'annulation/ }),
      'ERREUR_SAISIE',
    );
    await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception' }));

    champFournisseur().focus();
    refuser?.();

    expect(
      await screen.findByText(
        'Un lot de cette réception a déjà été consommé : la contrepassation est impossible.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Annuler la réception' })).toHaveFocus(),
    );
  });

  it(
    '`Entrée` dans le bloc de reprise n’enregistre PAS une nouvelle réception — le bloc vit ' +
      'dans le `<form>`, et la soumission implicite serait le pire moment',
    async () => {
      const utilisateur = await enregistrerPuisReprendre();

      await utilisateur.click(screen.getByRole('button', { name: 'Annuler cette réception…' }));
      appelApi.mockClear();

      /*
        OBSERVER « aucun POST n'est parti » NE SUFFIT PAS : jsdom ne pratique
        pas la soumission implicite depuis un `<select>`, donc rien ne partirait
        de toute façon, garde ou pas — la mutation restait verte (mesuré le
        01/08/2026).

        Ce qui discrimine, c'est la GARDE elle-même : `stopPropagation()`
        empêche l'évènement d'atteindre le document. Un écouteur posé là
        n'entend donc rien tant que la garde tient, et l'entend dès qu'elle
        tombe.
      */
      let entenduAuDocument = 0;
      const espion = (): void => {
        entenduAuDocument += 1;
      };
      document.addEventListener('keydown', espion);
      try {
        screen.getByRole('combobox', { name: /^Motif de l'annulation/ }).focus();
        await utilisateur.keyboard('{Enter}');
      } finally {
        document.removeEventListener('keydown', espion);
      }

      expect(entenduAuDocument).toBe(0);
      expect(appelApi).not.toHaveBeenCalledWith('/receptions', expect.anything());
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   Clavier — CLAUDE.md §3 règle 10
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieReception — clavier (CLAUDE.md §3 règle 10)', () => {
  it('`Entrée` depuis la dernière ligne en AJOUTE une et y place le focus', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    champQuantite().focus();
    await utilisateur.keyboard('{Enter}');

    await waitFor(() => expect(champIngredient(2)).toBeInTheDocument());
    await waitFor(() => expect(champIngredient(2)).toHaveFocus());
  });

  it('`Entrée` depuis une ligne intermédiaire descend d’une ligne, sans en créer', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
    champQuantite(1).focus();
    await utilisateur.keyboard('{Enter}');

    await waitFor(() => expect(champIngredient(2)).toHaveFocus());
    expect(screen.queryByRole('combobox', { name: 'Ingrédient, ligne 3' })).not.toBeInTheDocument();
  });

  it('`Ctrl+Entrée` enregistre une saisie complète', async () => {
    const utilisateur = userEvent.setup();
    const props = await monterPret();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/receptions') return RECEPTION_CREEE;
      return routeurBase?.(chemin, options);
    });

    await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
    await remplirLigneValide(utilisateur);
    champPrix().focus();
    await utilisateur.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(props.onEnregistre).toHaveBeenCalled());
  });

  it(
    '`Ctrl+Entrée` sur une ligne INCOMPLÈTE n’ajoute pas de ligne au passage — c’est le défaut ' +
      'exact corrigé le 30/07/2026 : le raccourci semblait « ajouter une ligne au lieu ' +
      'd’enregistrer »',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      /*
        LA LIGNE DOIT ÊTRE REFUSÉE, et c'est ce qui rend la fixture
        discriminante : sur une saisie VALIDE, `reinitialiserFormulaire()`
        remet le tableau à une seule ligne — une ligne ajoutée par erreur
        disparaîtrait dans la remise à blanc, et la mutation resterait
        invisible (mesuré le 01/08/2026). Ici, ni numéro de lot ni DLC : le
        refus laisse le formulaire tel quel, donc observable.
      */
      await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
      await utilisateur.selectOptions(champIngredient(), 'ing-farine');
      await utilisateur.type(champQuantite(), '25000');
      await utilisateur.type(champPrix(), '18,75');
      champPrix().focus();
      await utilisateur.keyboard('{Control>}{Enter}{/Control}');

      expect(screen.getByText(/Aucun identifiant pour ce lot/)).toBeInTheDocument();
      expect(
        screen.queryByRole('combobox', { name: 'Ingrédient, ligne 2' }),
      ).not.toBeInTheDocument();
    },
  );

  it('retirer une ligne replace le focus dans la grille, jamais sur `<body>`', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
    await utilisateur.selectOptions(champIngredient(2), 'ing-lait');
    await utilisateur.click(screen.getByRole('button', { name: 'Retirer la ligne 1' }));

    await waitFor(() => expect(champIngredient(1)).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it('retirer la SEULE ligne en recrée une vierge, focalisée — le formulaire ne reste jamais vide', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await utilisateur.type(champQuantite(), '25000');
    await utilisateur.click(screen.getByRole('button', { name: 'Retirer la ligne 1' }));

    await waitFor(() => expect(champQuantite(1)).toHaveValue(''));
    await waitFor(() => expect(champIngredient(1)).toHaveFocus());
  });

  /**
   * ═══ DÉFAUT RÉEL n°1 (même cause que dans `SaisieSortie`), CORRIGÉ ═══
   *
   * `ChampSelection nom="fournisseurId"` recevait `obligatoire`, donc `required`
   * sur le `<select>`, et le bouton d'enregistrement est un `type="submit"`.
   * La VALIDATION NATIVE du navigateur annulait donc la soumission tant que le
   * fournisseur était vide : `enregistrer()` n'était jamais appelée, et AUCUN
   * des refus applicatifs ne s'affichait.
   *
   * C'était plus grave ici que sur la sortie de stock : ce formulaire signale
   * des erreurs LIGNE PAR LIGNE (ingrédient, quantité, prix, identifiant de
   * lot). Toutes restaient invisibles derrière la bulle native, qui ne parlait
   * que du fournisseur — alors que `construireCorps()` est écrite pour les
   * montrer toutes en même temps et pour focaliser la première fautive.
   *
   * CORRECTIF : `ChampSaisie`/`ChampSelection` (`./champs.tsx`) posent
   * désormais `aria-required` plutôt que `required`. Le `<select>` ne bloque
   * plus la soumission ; c'est la validation applicative qui répond, et elle
   * répond MIEUX (tous les champs fautifs à la fois). `Ctrl+S`/`Ctrl+Entrée`
   * restent valables et continuent d'être employés par les tests de refus
   * ci-dessus — ils ne sont plus le SEUL chemin.
   */
  it('le refus du fournisseur s’affiche désormais au CLIC, pas seulement au Ctrl+S', async () => {
    const utilisateur = userEvent.setup();
    await monterPret();

    await remplirLigneValide(utilisateur);
    await utilisateur.click(boutonEnregistrer());

    expect(
      screen.getByText('Choisissez le fournisseur qui a livré cette marchandise.'),
    ).toBeInTheDocument();
  });

  it(
    'au clic sur un formulaire entièrement vide, TOUS les refus s’affichent à la fois — ' +
      'en-tête ET ligne — jamais un seul masqué derrière la bulle native',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      await utilisateur.click(boutonEnregistrer());

      // En-tête.
      expect(
        screen.getByText('Choisissez le fournisseur qui a livré cette marchandise.'),
      ).toBeInTheDocument();
      // Ligne : les quatre refus se lisent ensemble, pas un seul à la fois.
      expect(screen.getByText('Choisissez un ingrédient dans la liste.')).toBeInTheDocument();
      expect(
        screen.getByText('La quantité reçue doit être un nombre entier supérieur à zéro.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Montant illisible. Exemple attendu : 24,90')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Aucun identifiant pour ce lot : indiquez un numéro de lot fournisseur, ou à défaut une DLC précise (jour et mois).',
        ),
      ).toBeInTheDocument();
      expect(appelApi).not.toHaveBeenCalledWith('/receptions', expect.anything());
    },
  );

  it(
    'mesure du mécanisme (après correctif) : le `<select>` ne porte plus `required`, le clic ' +
      'émet bien un `submit`',
    async () => {
      const utilisateur = userEvent.setup();
      routerLectures();
      const { container } = render(<SaisieReception {...proprietes()} />);
      await screen.findByRole('combobox', { name: /^Fournisseur/ });

      const formulaire = container.querySelector('form');
      let soumissions = 0;
      formulaire?.addEventListener('submit', () => {
        soumissions += 1;
      });

      await utilisateur.click(boutonEnregistrer());

      // Plus de `required` : le fournisseur vide ne rend plus le `<select>`
      // invalide aux yeux du navigateur — `aria-required` porte seul
      // l'obligation, pour les lecteurs d'écran, sans intercepter la soumission.
      expect(
        container.querySelector<HTMLSelectElement>('select[name="fournisseurId"]')?.validity
          .valueMissing,
      ).toBe(false);
      // C'est CE `submit` qui rend `enregistrer()` — et donc les messages
      // français — atteignables au clic.
      expect(soumissions).toBe(1);
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état pendant l'envoi : promesse EN VOL, jamais déjà résolue
   ═══════════════════════════════════════════════════════════════════════════

   docs/39 §3 (cinquième forme, « la promesse déjà résolue ») : un mock qui
   `return`ne immédiatement — `mockResolvedValue` compris — tient sa promesse
   dans le MÊME écoulement de micro-tâches que la pose de l'état d'envoi. Tout
   ce qui ne vit QUE pendant l'aller-retour (bouton inerte, libellé
   d'attente, second envoi ignoré) devient alors structurellement invisible.
   Les tests ci-dessous posent donc eux-mêmes la promesse et ne la résolvent
   qu'APRÈS avoir lu l'écran EN VOL.
*/
describe('SaisieReception — transitions d’état pendant l’envoi (promesse en vol)', () => {
  it(
    'l’enregistrement annonce « Enregistrement… », bloque le bouton, et un Ctrl+S — qui ' +
      'CONTOURNE ce bouton en appelant enregistrer() directement — n’écrit RIEN tant que le ' +
      'premier envoi est en vol',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      let repondre: ((valeur: unknown) => void) | undefined;
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/receptions') {
          return new Promise((resoudre) => {
            repondre = resoudre;
          });
        }
        return routeurBase?.(chemin, options);
      });

      await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
      await remplirLigneValide(utilisateur);
      await utilisateur.click(boutonEnregistrer());

      const bouton = await screen.findByRole('button', { name: 'Enregistrement…' });
      expect(bouton).toBeDisabled();

      /*
        CONTOURNEMENT RÉEL, PAS SUPPOSÉ : `Ctrl+S`/`Ctrl+Entrée` appellent
        `enregistrer()` DIRECTEMENT depuis l'`onKeyDown` du `<form>`
        (`SaisieReception.tsx`), sans passer par le bouton `disabled` — le
        même chemin que celui déjà démontré dans
        `SaisieSortie.montage.test.tsx`. C'est donc bien le garde-fou
        `if (envoiEnCours) return;` de `enregistrer()`, et non le seul
        `disabled` natif du bouton, qui doit empêcher un second POST ici.
      */
      champQuantite().focus();
      await utilisateur.keyboard('{Control>}s{/Control}');

      expect(appelApi.mock.calls.filter(([c]) => c === '/receptions')).toHaveLength(1);

      repondre?.(RECEPTION_CREEE);
      await screen.findByRole('button', { name: 'Enregistrer la réception' });
      expect(screen.getByRole('button', { name: 'Enregistrer la réception' })).toBeEnabled();
    },
  );

  it(
    'l’annulation de la dernière réception annonce « Annulation… », bloque le bouton, et REND ' +
      'IMPOSSIBLE une seconde annulation — la raison de blocage remplace le bouton après la ' +
      'réponse, elle n’est pas juste « redevenue actionnable »',
    async () => {
      const utilisateur = userEvent.setup();
      await monterPret();

      // Enregistrement préalable, pour faire apparaître le bloc de reprise
      // (D-087) — même geste que `enregistrerPuisReprendre` du describe
      // voisin, mais local à ce bloc : cette fonction-là est scopée à SON
      // `describe` et n'est pas exportée.
      const routeurEnregistrement = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/receptions') return RECEPTION_CREEE;
        return routeurEnregistrement?.(chemin, options);
      });
      await utilisateur.selectOptions(champFournisseur(), 'fou-meunier');
      await remplirLigneValide(utilisateur);
      await utilisateur.click(boutonEnregistrer());
      await screen.findByRole('button', { name: 'Annuler cette réception…' });

      let repondre: ((valeur: unknown) => void) | undefined;
      const routeurAnnulation = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/receptions/rec-1/annuler') {
          return new Promise((resoudre) => {
            repondre = resoudre;
          });
        }
        return routeurAnnulation?.(chemin, options);
      });

      await utilisateur.click(screen.getByRole('button', { name: 'Annuler cette réception…' }));
      await utilisateur.selectOptions(
        screen.getByRole('combobox', { name: /^Motif de l'annulation/ }),
        'ERREUR_SAISIE',
      );
      await utilisateur.click(screen.getByRole('button', { name: 'Annuler la réception' }));

      const bouton = await screen.findByRole('button', { name: 'Annulation…' });
      expect(bouton).toBeDisabled();

      /*
        AUCUN CONTOURNEMENT TROUVÉ POUR CE bouton-CI, et ce n'est pas faute
        d'avoir cherché : le bloc de reprise intercepte `Entrée`
        (`evenement.stopPropagation()`, testé plus haut dans ce fichier), et
        `Ctrl+S`, lui, n'est PAS intercepté par ce même bloc — il remonte
        jusqu'au `<form>` et y appelle `enregistrer()`, une fonction AUTRE que
        `annulerDerniereReception()`, gouvernée par un état AUTRE
        (`envoiEnCours`, pas `annulationEnCours`). L'utiliser prouverait donc
        autre chose que le garde-fou de CETTE écriture. Ce test n'affirme donc
        PAS avoir démontré un contournement ici — conformément à la consigne
        de ne jamais feindre une preuve qu'on n'a pas.
      */

      repondre?.({
        receptionId: 'rec-1',
        numero: 'RC-2026-0012',
        nbMouvementsContrepasses: 2,
        commandeId: null,
        commandeStatutRestaure: null,
      });

      // « Redevient actionnable » ne veut PAS dire « le bouton réapparaît » :
      // une réception ne s'annule qu'UNE fois (même règle que `DetailLot`).
      // La preuve de fin de vol est donc que le bouton `Annulation…` a
      // disparu, remplacé par la raison de blocage — pas qu'il redevient
      // cliquable.
      await screen.findByText(/2 entrées contrepassées/);
      expect(screen.queryByRole('button', { name: 'Annulation…' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Annuler cette réception…' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/déjà annulée/i)).toBeInTheDocument();
    },
  );
});
