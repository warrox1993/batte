/**
 * Écran ACHATS, MONTÉ pour de vrai (jsdom, D-095 du 01/08/2026).
 *
 * ═══ Ce que `Achats.test.tsx`, à côté, ne POUVAIT pas voir ═══
 *
 * Le fichier voisin teste `messageEnvoiCommande` — fonction pure, correctement
 * testée, intouchée ici. Elle décide LA phrase la plus délicate de l'écran
 * (« ce mail est-il vraiment parti ? »), mais cette phrase ne s'affiche
 * qu'après DEUX gestes : sélectionner une commande dans un tableau, ce qui
 * déclenche `GET /commandes/:id`. Au premier rendu, aucun détail n'existe.
 *
 * ═══ Ce que la fixture doit pouvoir contredire ═══
 *
 * QUATRE commandes couvrant les quatre étapes du parcours D-009 (brouillon →
 * validée → envoyée → reçue) et, sur les envois, LES TROIS valeurs de
 * `envoiModeTest` : `true` (mode test), `false` (envoi réel) et `null` (fait
 * INCONNU). C'est la troisième qui compte : la doctrine du dépôt interdit de
 * lire `null` comme `false`, et un jeu de fixtures qui ne porterait que
 * `true`/`false` ne pourrait pas voir la faute.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  formaterDate,
  formaterMontant,
  type CommandeDetail,
  type CommandeResume,
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
const { default: Achats } = await import('./Achats');

type AppelApi = (chemin: string, options?: RequestInit) => Promise<unknown>;
const appelApi = vi.mocked(requeteApi) as unknown as ReturnType<typeof vi.fn<AppelApi>>;

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function resume(
  champs: Partial<CommandeResume> & Pick<CommandeResume, 'id' | 'numero' | 'statut'>,
): CommandeResume {
  return {
    fournisseurId: 'f-1',
    fournisseurNom: 'Moulin de Hollogne',
    dateCreation: '2026-07-20',
    dateEnvoi: null,
    montantTotalCents: 4295,
    nbLignes: 2,
    genereAutomatiquement: true,
    receptionNumero: null,
    receptionStatut: null,
    ...champs,
  };
}

const COMMANDES: CommandeResume[] = [
  resume({ id: 'c-brouillon', numero: 'CF-2026-0001', statut: 'brouillon' }),
  resume({ id: 'c-validee', numero: 'CF-2026-0002', statut: 'validee' }),
  resume({
    id: 'c-envoyee-test',
    numero: 'CF-2026-0003',
    statut: 'envoyee',
    dateEnvoi: '2026-07-25',
  }),
  // Reçue, mais dont la SEULE réception a été annulée depuis : le cas
  // d'incohérence que l'écran doit signaler, et lui seul.
  resume({
    id: 'c-recue',
    numero: 'CF-2026-0004',
    statut: 'recue',
    dateEnvoi: '2026-07-10',
    receptionNumero: 'RC-2026-0009',
    receptionStatut: 'annulee',
  }),
];

function detail(
  champs: Partial<CommandeDetail> & Pick<CommandeDetail, 'id' | 'numero' | 'statut'>,
): CommandeDetail {
  return {
    fournisseurId: 'f-1',
    fournisseurNom: 'Moulin de Hollogne',
    dateCreation: '2026-07-20',
    dateEnvoi: null,
    montantTotalCents: 4295,
    nbLignes: 2,
    genereAutomatiquement: true,
    receptionNumero: null,
    receptionStatut: null,
    dateReceptionPrevue: null,
    emailEnvoyeA: null,
    fournisseurEmail: 'contact@moulin-hollogne.be',
    notes: null,
    lignes: [
      {
        id: 'l-1',
        ingredientId: 'i-farine',
        nomIngredient: 'Farine de froment T55',
        unite: 'g',
        conditionnementLibelle: 'Sac 25 kg',
        quantiteConditionnements: 1,
        quantiteUniteRef: 25000,
        prixLigneCents: 2995,
        prixUnitaireCents: 0.1198,
        montantLigneCents: 2995,
      },
      {
        id: 'l-2',
        ingredientId: 'i-sucre',
        nomIngredient: 'Vergeoise blonde',
        unite: 'g',
        // `null` : conditionnement inconnu, jamais une chaîne vide qui se
        // lirait comme un libellé réellement saisi.
        conditionnementLibelle: null,
        quantiteConditionnements: 2,
        quantiteUniteRef: 2000,
        prixLigneCents: 1300,
        prixUnitaireCents: 0.65,
        montantLigneCents: 1300,
      },
    ],
    receptionsLiees: [],
    envoiModeTest: null,
    cheminFichierTest: null,
    ...champs,
  };
}

const DETAILS: Record<string, CommandeDetail> = {
  'c-brouillon': detail({ id: 'c-brouillon', numero: 'CF-2026-0001', statut: 'brouillon' }),
  'c-validee': detail({ id: 'c-validee', numero: 'CF-2026-0002', statut: 'validee' }),
  'c-envoyee-test': detail({
    id: 'c-envoyee-test',
    numero: 'CF-2026-0003',
    statut: 'envoyee',
    dateEnvoi: '2026-07-25',
    emailEnvoyeA: 'contact@moulin-hollogne.be',
    envoiModeTest: true,
    cheminFichierTest: 'sorties/mails/CF-2026-0003.eml',
  }),
  'c-recue': detail({
    id: 'c-recue',
    numero: 'CF-2026-0004',
    statut: 'recue',
    dateEnvoi: '2026-07-10',
    emailEnvoyeA: 'contact@moulin-hollogne.be',
    // `null` : commande envoyée AVANT que ce fait soit tracé. Ni « test » ni
    // « réel » ne peuvent être affirmés.
    envoiModeTest: null,
    receptionNumero: 'RC-2026-0009',
    receptionStatut: 'annulee',
    receptionsLiees: [
      {
        id: 'r-1',
        numero: 'RC-2026-0009',
        dateReception: '2026-07-12',
        montantTotalCents: 4295,
        statut: 'annulee',
      },
    ],
  }),
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
  const routes: Reponses = {
    'GET /commandes': () => Promise.resolve({ data: COMMANDES, meta: { total: COMMANDES.length } }),
  };
  for (const [id, valeur] of Object.entries(DETAILS)) {
    routes[`GET /commandes/${id}`] = () => Promise.resolve(valeur);
  }
  return routes;
}

function monter(): void {
  render(<Achats />);
}

async function ouvrirLeDetail(numero: string): Promise<void> {
  await userEvent.click(await screen.findByRole('row', { name: new RegExp(numero) }));
  await screen.findByRole('heading', { name: numero });
}

function normaliser(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  appelApi.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Achats — chargement, prêt, erreur', () => {
  it('annonce le chargement, puis la liste', async () => {
    brancherApi(reponsesNominales());
    monter();

    expect(screen.getByText('Chargement des commandes…')).toBeInTheDocument();
    expect(await screen.findByRole('row', { name: /CF-2026-0001/ })).toBeInTheDocument();
  });

  it('un échec de la liste affiche le message du serveur, et le bouton « Générer » reste utilisable', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /commandes': () =>
        Promise.reject(
          new ErreurApi('Le journal des commandes est verrouillé.', {
            code: 'commandes_verrouillees',
            statut: 503,
          }),
        ),
    });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent('journal des commandes');
    expect(screen.getByRole('button', { name: 'Générer les commandes' })).toBeEnabled();
  });

  it('aucune commande : l’état vide propose la génération plutôt que de constater le vide', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /commandes': () => Promise.resolve({ data: [], meta: { total: 0 } }),
    });
    monter();

    expect(await screen.findByText('Aucune commande enregistrée')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Générer les commandes' })).toHaveLength(2);
  });

  it('la génération dit combien de brouillons, et NOMME les ingrédients qu’elle n’a pas pu commander', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /commandes/generer': () =>
        Promise.resolve({
          data: [COMMANDES[0]],
          meta: {
            total: 1,
            ingredientsIgnores: [
              {
                ingredientId: 'i-oeuf',
                nomIngredient: 'Œufs frais',
                motif: 'Aucun conditionnement actif : prix inconnu.',
              },
            ],
          },
        }),
    });
    monter();
    await screen.findByRole('row', { name: /CF-2026-0001/ });

    await userEvent.click(screen.getByRole('button', { name: 'Générer les commandes' }));

    expect(await screen.findByRole('status')).toHaveTextContent('1 brouillon généré');
    // Un ingrédient ignoré ne se commande pas : le taire produirait une rupture.
    expect(screen.getByRole('row', { name: /Œufs frais/ })).toHaveTextContent(
      'Aucun conditionnement actif',
    );
  });

  it('une génération refusée affiche la raison du serveur, jamais un succès muet', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /commandes/generer': () =>
        Promise.reject(
          new ErreurApi("Aucun fournisseur actif : impossible d'émettre un bon de commande.", {
            code: 'aucun_fournisseur',
            statut: 422,
          }),
        ),
    });
    monter();
    await screen.findByRole('row', { name: /CF-2026-0001/ });

    await userEvent.click(screen.getByRole('button', { name: 'Générer les commandes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Aucun fournisseur actif');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le parcours en trois étapes (D-009)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Achats — D-009 : générer, valider, envoyer, dans cet ordre et pas un autre', () => {
  it('un BROUILLON offre « Valider » et jamais le formulaire d’envoi', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLeDetail('CF-2026-0001');

    expect(screen.getByRole('button', { name: 'Valider la commande' })).toBeInTheDocument();
    // L'envoi réel ne doit être atteignable à AUCUN moment depuis un brouillon.
    expect(screen.queryByRole('button', { name: 'Envoyer par email' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adresse email')).not.toBeInTheDocument();
  });

  it('une commande VALIDÉE offre l’envoi, et le bouton reste inerte tant qu’aucune adresse n’est saisie', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLeDetail('CF-2026-0002');

    expect(screen.queryByRole('button', { name: 'Valider la commande' })).not.toBeInTheDocument();
    const envoyer = screen.getByRole('button', { name: 'Envoyer par email' });
    const champ = screen.getByLabelText('Adresse email');

    // L'écran pré-remplit l'adresse du fournisseur : c'est un repli utile, pas
    // une supposition — elle vient de la fiche fournisseur, jamais inventée.
    expect(champ).toHaveValue('contact@moulin-hollogne.be');
    expect(envoyer).toBeEnabled();

    // Vidée, l'adresse rend le bouton inerte : l'envoi ne part jamais « à
    // personne », et le garde-fou ne repose pas seulement sur le serveur.
    await userEvent.clear(champ);
    expect(envoyer).toBeDisabled();
  });

  it('valider un brouillon amène le focus SUR le champ d’adresse — l’étape suivante, pas `<body>`', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /commandes/c-brouillon/valider': () =>
        Promise.resolve({ ...DETAILS['c-brouillon']!, statut: 'validee' as const }),
    });
    monter();
    await ouvrirLeDetail('CF-2026-0001');

    await userEvent.click(screen.getByRole('button', { name: 'Valider la commande' }));

    const champEmail = await screen.findByLabelText('Adresse email');
    await vi.waitFor(() => expect(document.activeElement).toBe(champEmail));
    // Le bouton « Valider » a disparu avec son bloc : c'est normal, la commande
    // n'est plus un brouillon.
    expect(screen.queryByRole('button', { name: 'Valider la commande' })).not.toBeInTheDocument();
  });

  it('un refus de validation garde la commande en brouillon et dit pourquoi', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /commandes/c-brouillon/valider': () =>
        Promise.reject(
          new ErreurApi('Cette commande ne contient aucune ligne : rien à valider.', {
            code: 'commande_vide',
            statut: 422,
          }),
        ),
    });
    monter();
    await ouvrirLeDetail('CF-2026-0001');

    await userEvent.click(screen.getByRole('button', { name: 'Valider la commande' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('aucune ligne');
    expect(screen.getByRole('button', { name: 'Valider la commande' })).toBeInTheDocument();
  });

  it('un refus d’envoi CHAMP PAR CHAMP se pose sous le champ, jamais dans un bandeau global', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /commandes/c-validee/envoyer': () =>
        Promise.reject(
          new ErreurApi('Saisie refusée.', {
            code: 'saisie_invalide',
            statut: 422,
            champs: { email: "Cette adresse n'est pas une adresse email valide." },
          }),
        ),
    });
    monter();
    await ouvrirLeDetail('CF-2026-0002');

    const champ = screen.getByLabelText('Adresse email');
    await userEvent.type(champ, 'pas-une-adresse');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer par email' }));

    expect(
      await screen.findByText("Cette adresse n'est pas une adresse email valide."),
    ).toBeInTheDocument();
    expect(champ).toHaveAttribute('aria-invalid', 'true');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   « Ce mail est-il parti ? » — inconnu ≠ faux
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Achats — le mode d’envoi, affiché sans mentir', () => {
  it('un envoi en MODE TEST le dit explicitement, et nomme le fichier écrit', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLeDetail('CF-2026-0003');

    const bloc = await screen.findByText(/Mode test/);
    expect(bloc).toHaveTextContent("rien n'a été envoyé au fournisseur");
    expect(bloc).toHaveTextContent('sorties/mails/CF-2026-0003.eml');
    expect(bloc).toHaveTextContent(formaterDate('2026-07-25'));
  });

  it('un mode d’envoi INCONNU (`null`) ne se lit jamais comme un envoi réel confirmé', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLeDetail('CF-2026-0004');

    const bloc = await screen.findByText(/mode d'envoi non retrouvé/);
    expect(bloc).toHaveTextContent('réel ou test');
    // Le point exact de la doctrine : `null` ne vaut pas `false`.
    expect(bloc).not.toHaveTextContent('Mode test');
  });

  it('une commande « reçue » sans réception ACTIVE porte l’alerte d’incohérence, et elle seule', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLeDetail('CF-2026-0004');

    const alertes = await screen.findAllByRole('alert');
    expect(alertes.some((a) => a.textContent?.includes('aucune réception active'))).toBe(true);
    // La réception annulée reste LISTÉE : elle n'est pas effacée, seulement
    // marquée (CLAUDE.md §3 règle 7).
    expect(screen.getByText(/RC-2026-0009 · .* \(annulée\)/)).toBeInTheDocument();
  });

  it('une commande envoyée SANS incohérence ne porte aucune alerte — le signal reste rare', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLeDetail('CF-2026-0003');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Aucune réception ne référence encore cette commande/),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Détail : lignes, conditionnement inconnu, clavier
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Achats — détail et clavier', () => {
  it('un conditionnement inconnu s’écrit « — », jamais une case vide qui se lit comme un libellé', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLeDetail('CF-2026-0001');

    const ligne = screen.getByRole('row', { name: /Vergeoise blonde/ });
    expect(within(ligne).getAllByRole('cell')[1]).toHaveTextContent('—');
    // Le montant, lui, est connu et reste chiffré.
    expect(within(ligne).getAllByRole('cell')[4]).toHaveTextContent(formaterMontant(1300));
  });

  it('le montant total du détail est celui du résumé : les deux panneaux ne se contredisent pas', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLeDetail('CF-2026-0001');

    const total = screen.getByText(/Montant total/);
    expect(normaliser(total.textContent ?? '')).toContain(normaliser(formaterMontant(4295)));
  });

  it('rouvrir la même rangée REFERME le détail : la sélection est une bascule', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLeDetail('CF-2026-0001');

    await userEvent.click(screen.getByRole('row', { name: /CF-2026-0001/ }));

    expect(screen.queryByRole('heading', { name: 'CF-2026-0001' })).not.toBeInTheDocument();
  });

  /**
   * ═══ CE QUE CES TROIS TESTS REMPLACENT ═══
   *
   * Il y avait ici un test intitulé « « Fermer » rend le focus au bouton de
   * génération : jamais `<body>` après la fermeture ». Il était vert, et il
   * décrivait le MAUVAIS comportement — il figeait la faute au lieu de la voir.
   *
   * La cible d'alors, le bouton « Générer les commandes », vit dans un AUTRE
   * panneau, en haut de page. Deux torts, dont le second est le pire :
   *
   *  1. la TÉLÉPORTATION. Le focus n'atterrit pas sur `<body>`, donc le défaut
   *     est moins visible — mais l'utilisateur est renvoyé en haut de liste.
   *     C'est le repli « première rangée » que `choisirRangeeDeRepli`
   *     (`composants/navigationGrille.ts`) écarte explicitement : après la 30ᵉ
   *     ligne d'une liste de 40, on repart en haut, le même abandon que
   *     `<body>` en moins visible ;
   *  2. pendant une génération EN VOL, ce bouton est `disabled` : le `.focus()`
   *     y est purement INOPÉRANT et le focus tombe bel et bien sur `<body>`.
   *     C'est le troisième test ci-dessous.
   *
   * ═══ POURQUOI LE FOCUS EST DÉPLACÉ EXPLICITEMENT AVANT DE FERMER ═══
   *
   * Un test qui clique la rangée puis appuie sur Échap passe au vert MÊME SANS
   * correctif : le clic a déjà laissé le focus sur la rangée, et la rangée
   * n'est jamais démontée. On observerait alors un focus qui n'a pas bougé et
   * on le prendrait pour un focus rappelé — la fixture aveugle au sens strict
   * de docs/39 §3, forme 3 (« trop dégénérée pour discriminer »).
   *
   * Chaque test ci-dessous pose donc le focus À L'INTÉRIEUR du panneau qui va
   * disparaître, sur ce que cette couche offre RÉELLEMENT : le champ « Adresse
   * email » pour une commande validée, le bouton « Valider la commande » pour
   * un brouillon.
   */
  it('« Fermer » rend le focus à la RANGÉE d’origine, jamais à un bouton d’un autre panneau', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLeDetail('CF-2026-0001');

    // Le focus part d'un contrôle du panneau, pas de la rangée : sans ce
    // déplacement, le test serait vert avant même le correctif.
    const valider = screen.getByRole('button', { name: 'Valider la commande' });
    valider.focus();
    expect(document.activeElement).toBe(valider);

    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));

    const rangee = screen.getByRole('row', { name: /CF-2026-0001/ });
    await vi.waitFor(() => expect(document.activeElement).toBe(rangee));
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: 'Générer les commandes' }),
    );
  });

  it('Échap depuis le champ d’adresse rend le focus à la RANGÉE, jamais à `<body>`', async () => {
    brancherApi(reponsesNominales());
    monter();
    await ouvrirLeDetail('CF-2026-0002');

    // Le geste réel : on relit l'adresse du fournisseur, on se ravise, on
    // appuie sur Échap. Le champ appartient au panneau qui va se démonter.
    const champ = screen.getByLabelText('Adresse email');
    champ.focus();
    expect(document.activeElement).toBe(champ);

    await userEvent.keyboard('{Escape}');

    const rangee = screen.getByRole('row', { name: /CF-2026-0002/ });
    await vi.waitFor(() => expect(document.activeElement).toBe(rangee));
    expect(document.activeElement).not.toBe(document.body);
  });

  /**
   * LE CAS OÙ L'ANCIENNE CIBLE ÉTAIT PIRE QU'UNE TÉLÉPORTATION.
   *
   * `disabled={etatGeneration.statut === 'en_cours'}` rend le bouton
   * « Générer les commandes » inéligible au focus : `.focus()` dessus ne fait
   * alors STRICTEMENT RIEN et le focus reste où le démontage l'a laissé,
   * c'est-à-dire sur `<body>` (D-079).
   *
   * La génération est feinte par une promesse que le test résout LUI-MÊME, et
   * non par `mockResolvedValue` : une promesse déjà résolue ferait retomber
   * `etatGeneration` à `succes` dans le même écoulement de micro-tâches que sa
   * pose, l'état `en_cours` n'atteindrait jamais le DOM, et le test serait
   * structurellement incapable de voir ce qu'il annonce (docs/39 §3, cinquième
   * forme).
   */
  it('même pendant une génération EN VOL, Échap rend le focus à la rangée', async () => {
    let resoudreGeneration!: (valeur: unknown) => void;
    const generationEnVol = new Promise<unknown>((resoudre) => {
      resoudreGeneration = resoudre;
    });
    brancherApi({
      ...reponsesNominales(),
      'POST /commandes/generer': () => generationEnVol,
    });
    monter();
    await screen.findByRole('row', { name: /CF-2026-0002/ });

    await userEvent.click(screen.getByRole('button', { name: 'Générer les commandes' }));
    // Sans cette assertion, rien ne prouverait que la fixture atteint vraiment
    // l'état qui rendait l'ancienne cible infocalisable.
    const generer = screen.getByRole('button', { name: 'Génération…' });
    expect(generer).toBeDisabled();

    await ouvrirLeDetail('CF-2026-0002');
    const champ = screen.getByLabelText('Adresse email');
    champ.focus();

    await userEvent.keyboard('{Escape}');

    const rangee = screen.getByRole('row', { name: /CF-2026-0002/ });
    await vi.waitFor(() => expect(document.activeElement).toBe(rangee));
    expect(document.activeElement).not.toBe(document.body);

    resoudreGeneration({ data: [], meta: { total: 0, ingredientsIgnores: [] } });
  });

  /**
   * DÉFAUT RÉEL trouvé le 01/08/2026, corrigé le même jour — le test est
   * devenu ordinaire (il était en `it.fails` le temps que le correctif
   * atteigne sa zone d'écriture).
   *
   * `validerCommandeSelectionnee` préparait bien une confirmation
   * (`setEtatValidation({ statut: 'succes', message: 'Commande … validée.' })`),
   * et l'écran prévoyait bien un `<p role="status">` pour l'afficher — mais ce
   * paragraphe vivait À L'INTÉRIEUR du bloc `{detailCourant.statut ===
   * 'brouillon' && …}`. Or la même fonction venait de remplacer le détail par
   * une commande de statut `validee` : React rend les deux mises à jour dans
   * le même passage, le bloc disparaissait, et la phrase n'avait jamais de
   * conteneur où s'afficher. Le message existait, il était écrit, il était
   * juste — et il était structurellement inatteignable.
   *
   * Ce n'était pas cosmétique : la validation est l'étape 2/3 de D-009, la
   * « validation humaine explicite ». Elle était la seule des trois à ne
   * renvoyer aucune phrase de confirmation — l'annulation et l'envoi, eux, en
   * affichent une. Le porteur ne voyait que des boutons qui changent, sans
   * qu'un mot lui dise que l'écriture avait bien eu lieu.
   *
   * Le correctif sort le message du bloc conditionnel. L'assertion sur la
   * DISPARITION du bouton reste ci-dessous : elle prouve que le message est lu
   * dans l'état `validee` — c'est-à-dire précisément dans la situation qui le
   * rendait inatteignable, et non parce qu'un rendu intermédiaire l'aurait
   * laissé passer.
   */
  it('la confirmation « Commande … validée. » atteint l’écran, une fois le brouillon devenu validée', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /commandes/c-brouillon/valider': () =>
        Promise.resolve({ ...DETAILS['c-brouillon']!, statut: 'validee' as const }),
    });
    monter();
    await ouvrirLeDetail('CF-2026-0001');

    await userEvent.click(screen.getByRole('button', { name: 'Valider la commande' }));
    await screen.findByLabelText('Adresse email');

    // Le bloc « brouillon » a bien disparu : c'est CE passage qui escamotait
    // la confirmation. Sans cette assertion, le test resterait vert même si le
    // message n'était lisible que tant que le bouton était encore là.
    expect(screen.queryByRole('button', { name: 'Valider la commande' })).not.toBeInTheDocument();

    expect(await screen.findByRole('status')).toHaveTextContent('CF-2026-0001 validée');
  });

  it('une commande se choisit au CLAVIER, sans souris', async () => {
    brancherApi(reponsesNominales());
    monter();
    const rangee = await screen.findByRole('row', { name: /CF-2026-0002/ });

    rangee.focus();
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { name: 'CF-2026-0002' })).toBeInTheDocument();
  });
});
