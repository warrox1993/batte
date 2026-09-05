/**
 * Écran « Où aller ? » (OPPORTUNITÉS), MONTÉ pour de vrai (jsdom, D-095).
 *
 * ═══ Ce que `Opportunites.test.tsx`, à côté, ne POUVAIT pas voir ═══
 *
 * Le fichier voisin teste `phraseCoutKilometrique`, `estPremierPassageLigne`
 * et `celluleMontantOuTiret` — fonctions pures, correctement testées, et
 * intouchées ici. Rien ne prouvait que le tableau les APPELLE : ce tableau
 * n'existe qu'après la réponse de `/opportunites`, hors de portée d'un rendu
 * statique.
 *
 * ═══ Ce que la fixture doit pouvoir contredire ═══
 *
 * TROIS lignes, TROIS familles, TROIS raisons différentes d'ignorer un
 * chiffre : un grand public déjà visité (tout est chiffré), un marché de Noël
 * JAMAIS visité (D-082 : tiret + « premier passage », jamais une prévision de
 * zéro), et un stand ENTREPRISE (silencieux par construction, D-059 — et qui
 * ne doit surtout PAS porter la mention « premier passage », qui parlerait
 * d'une autre absence). Une fixture d'une seule famille ne pourrait pas
 * distinguer ces trois silences.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TIRET_ABSENT,
  formaterMontant,
  type LieuMarcheContrat,
  type LigneOpportunite,
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
const { default: Opportunites, phraseCoutKilometrique } = await import('./Opportunites');

type AppelApi = (chemin: string, options?: RequestInit) => Promise<unknown>;
const appelApi = vi.mocked(requeteApi) as unknown as ReturnType<typeof vi.fn<AppelApi>>;

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function ligne(
  champs: Partial<LigneOpportunite> & Pick<LigneOpportunite, 'id' | 'nom' | 'famille'>,
): LigneOpportunite {
  return {
    type: 'festival',
    dateDebut: '2026-12-05',
    dateFin: '2026-12-05',
    nbSessions: 1,
    communeTexte: null,
    lieuId: 'lieu-1',
    lieuNom: 'La Batte',
    distanceKm: 12,
    distanceEstimeeVolDoiseau: false,
    effectifEstime: null,
    fiabilite: 'fiable',
    nbSessionsRetenues: 8,
    explicationPrevision: 'Moyenne de 8 sessions closes sur ce lieu.',
    crepesPrevuesParSession: 134,
    crepesPrevuesTotal: 134,
    caAttenduCents: 83_800,
    coutMatiereAttenduCents: 4_422,
    coutGazAttenduCents: 900,
    coutEmplacementCents: 1_500,
    coutEmplacementIndisponibleRaison: null,
    coutDeplacementCents: 780,
    margeNetteAttendueCents: 76_198,
    source: null,
    notes: null,
    ...champs,
  };
}

const LIGNES: LigneOpportunite[] = [
  ligne({ id: 'o-batte', nom: 'Marché de La Batte', famille: 'grand_public' }),
  // D-082 : lieu jamais visité. Aucun chiffre inventé — mais le tiret doit
  // dire POURQUOI, sans quoi il se lit comme une saisie oubliée.
  ligne({
    id: 'o-noel',
    nom: 'Marché de Noël de Verviers',
    famille: 'marche_noel',
    lieuId: 'lieu-2',
    lieuNom: 'Verviers — Place Verte',
    nbSessions: 3,
    dateFin: '2026-12-07',
    fiabilite: 'aucune_donnee',
    nbSessionsRetenues: 0,
    explicationPrevision: 'Aucune session close sur ce lieu : aucune prévision de revenu.',
    crepesPrevuesParSession: null,
    crepesPrevuesTotal: null,
    caAttenduCents: null,
    coutMatiereAttenduCents: null,
    coutGazAttenduCents: null,
    coutEmplacementCents: 4_500,
    coutDeplacementCents: 2_340,
    margeNetteAttendueCents: null,
  }),
  // D-059 : la famille `entreprise` reste silencieuse tant qu'aucun taux de
  // prise n'a été observé. C'est une AUTRE absence — elle ne doit pas
  // emprunter le vocabulaire du premier passage.
  ligne({
    id: 'o-entreprise',
    nom: 'Petit-déjeuner Techspace Aero',
    famille: 'entreprise',
    lieuId: null,
    lieuNom: null,
    communeTexte: 'Milmort',
    distanceKm: 18,
    distanceEstimeeVolDoiseau: true,
    effectifEstime: 400,
    fiabilite: 'aucune_donnee',
    nbSessionsRetenues: 0,
    explicationPrevision: 'Aucun taux de prise observé pour un stand entreprise.',
    crepesPrevuesParSession: null,
    crepesPrevuesTotal: null,
    caAttenduCents: null,
    coutMatiereAttenduCents: null,
    coutGazAttenduCents: null,
    coutEmplacementCents: null,
    coutEmplacementIndisponibleRaison: 'Aucun tarif d’emplacement connu pour ce lieu.',
    coutDeplacementCents: 1_170,
    margeNetteAttendueCents: null,
  }),
];

const META = {
  total: LIGNES.length,
  coutKilometriqueCentsParKm: 32.5,
  coutKilometriqueSource: 'SPF Finances 2026',
  coutsDisponibles: true,
  avertissementCouts: null,
  avertissementTauxPriseEntreprise:
    'Aucun taux de prise n’a encore été observé sur un stand entreprise : ces lignes restent sans prévision de fréquentation.',
};

const LIEUX: LieuMarcheContrat[] = [];

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
    'GET /opportunites': () => Promise.resolve({ data: LIGNES, meta: META }),
    'GET /lieux': () => Promise.resolve({ data: LIEUX, meta: { total: 0 } }),
  };
}

function monter(): void {
  render(<Opportunites />);
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
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Opportunités — chargement, prêt, erreur', () => {
  it('annonce le chargement, puis rend le tableau', async () => {
    brancherApi(reponsesNominales());
    monter();

    expect(screen.getByText('Chargement des opportunités…')).toBeInTheDocument();
    expect(await screen.findByRole('row', { name: /Marché de La Batte/ })).toBeInTheDocument();
  });

  it('un échec affiche le message du serveur au lieu d’un tableau vide', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /opportunites': () =>
        Promise.reject(
          new ErreurApi('Le calcul de déplacement a échoué : aucun point de départ déclaré.', {
            code: 'point_depart_absent',
            statut: 422,
          }),
        ),
    });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent('aucun point de départ déclaré');
  });

  it('la panne du référentiel des LIEUX ne casse rien : la liste reste consultable (mode dégradé)', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /lieux': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    monter();

    expect(await screen.findByRole('row', { name: /Marché de La Batte/ })).toBeInTheDocument();
    // Seul le sélecteur de rattachement disparaît, faute de lieux à proposer.
    expect(screen.queryByRole('combobox', { name: /Rattacher un lieu/ })).not.toBeInTheDocument();
  });

  it('aucune opportunité : une phrase de démarrage et une action, jamais un tableau muet', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /opportunites': () => Promise.resolve({ data: [], meta: { ...META, total: 0 } }),
    });
    monter();

    expect(await screen.findByText('Aucune opportunité enregistrée')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer une opportunité' })).toBeInTheDocument();
  });

  it('le taux kilométrique est affiché avec SA SOURCE : aucun chiffre réglementaire nu', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Marché de La Batte/ });

    expect(screen.getByText(phraseCoutKilometrique(META))).toHaveTextContent('SPF Finances 2026');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Trois silences, trois vocabulaires (D-082, D-059)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Opportunités — un chiffre inconnu n’est jamais une prévision de zéro', () => {
  it('une ligne CHIFFRÉE affiche son CA et sa marge, sans mention d’absence', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Marché de La Batte/ });

    expect(celluleDe(/Marché de La Batte/, 7)).toHaveTextContent(formaterMontant(83_800));
    expect(celluleDe(/Marché de La Batte/, 9)).toHaveTextContent(formaterMontant(76_198));
    expect(celluleDe(/Marché de La Batte/, 7)).not.toHaveTextContent('premier passage');
  });

  it('un lieu JAMAIS visité porte le tiret ET la mention « premier passage » (D-082)', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Marché de Noël de Verviers/ });

    const ca = celluleDe(/Marché de Noël de Verviers/, 7);
    expect(ca).toHaveTextContent(TIRET_ABSENT);
    expect(ca).toHaveTextContent('premier passage');
    // Un tiret NU se lirait comme un oubli de saisie ; « 0,00 » se lirait
    // comme une prévision de recette nulle. Ni l'un ni l'autre.
    expect(normaliser(ca.textContent ?? '')).not.toContain(normaliser(formaterMontant(0)));

    const marge = celluleDe(/Marché de Noël de Verviers/, 9);
    expect(marge).toHaveTextContent('premier passage');
  });

  it('un stand ENTREPRISE reste silencieux SANS emprunter le vocabulaire du premier passage (D-059)', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Techspace Aero/ });

    const ca = celluleDe(/Techspace Aero/, 7);
    expect(ca).toHaveTextContent(TIRET_ABSENT);
    // LE point de la distinction : deux absences différentes, deux phrases.
    expect(ca).not.toHaveTextContent('premier passage');
    // Sa raison à lui est dite une fois, au-dessus du tableau.
    expect(screen.getByText(META.avertissementTauxPriseEntreprise)).toBeInTheDocument();
  });

  it('les frais gardent leurs DEUX montants distincts, et un emplacement inconnu y reste un tiret', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Techspace Aero/ });

    // Déplacement connu / emplacement inconnu : jamais additionnés, jamais
    // l'un masquant l'autre.
    const frais = celluleDe(/Techspace Aero/, 8);
    expect(frais).toHaveTextContent(formaterMontant(1_170));
    expect(frais).toHaveTextContent(TIRET_ABSENT);
    // Et la RAISON de l'absence est disponible, pas seulement l'absence.
    expect(frais.getAttribute('title') ?? '').toContain('Aucun tarif d’emplacement connu');
  });

  it('une distance à VOL D’OISEAU le dit : jamais confondue avec une distance routière', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Techspace Aero/ });

    expect(celluleDe(/Techspace Aero/, 4)).toHaveTextContent('vol d’oiseau');
    expect(celluleDe(/Marché de La Batte/, 4)).not.toHaveTextContent('vol d’oiseau');
  });

  it('la fiabilité est écrite en clair à côté de la fréquentation, avec le nombre de sessions retenues', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Marché de La Batte/ });

    expect(celluleDe(/Marché de La Batte/, 5)).toHaveTextContent('Fiable (8 sessions)');
    expect(celluleDe(/Marché de Noël de Verviers/, 5)).toHaveTextContent('jamais visité');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Actions et clavier (CLAUDE.md §3 règle 10)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Opportunités — écarter, créer, clavier', () => {
  it('écarter une opportunité le confirme par un message, et recharge la liste', async () => {
    const rejet = vi.fn(() => Promise.resolve({}));
    brancherApi({ ...reponsesNominales(), 'POST /opportunites/o-noel/rejeter': rejet });
    monter();
    await screen.findByRole('row', { name: /Marché de Noël de Verviers/ });

    const rangee = screen.getByRole('row', { name: /Marché de Noël de Verviers/ });
    await userEvent.click(within(rangee).getByRole('button', { name: 'Écarter' }));

    await vi.waitFor(() => expect(rejet).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent('« Marché de Noël de Verviers »');
  });

  it('un rejet refusé le DIT, en registre d’erreur — jamais un succès muet', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /opportunites/o-noel/rejeter': () =>
        Promise.reject(
          new ErreurApi('Cette opportunité a déjà servi à une session close.', {
            code: 'opportunite_utilisee',
            statut: 422,
          }),
        ),
    });
    monter();
    const rangee = await screen.findByRole('row', { name: /Marché de Noël de Verviers/ });

    await userEvent.click(within(rangee).getByRole('button', { name: 'Écarter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('déjà servi à une session close');
  });

  it('ouvrir le formulaire y amène le focus ; Échap le referme et rend le focus au bouton', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('row', { name: /Marché de La Batte/ });
    const bascule = screen.getByRole('button', { name: 'Nouvelle opportunité' });

    await userEvent.click(bascule);
    const champNom = document.getElementById('opp-nom');
    expect(champNom).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(champNom));

    await userEvent.keyboard('{Escape}');

    expect(document.getElementById('opp-nom')).toBeNull();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Nouvelle opportunité' }),
      ),
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Attente d'écriture — promesse CONTRÔLÉE (docs/39 §3, cinquième forme)

   Les tests ci-dessus (« écarter une opportunité », « un rejet refusé »)
   résolvent leur promesse IMMÉDIATEMENT : l'état `enCoursId`/`envoi` retombe
   dans le même écoulement de micro-tâches que sa pose et n'atteint jamais le
   DOM. Les deux blocs suivants couvrent les DEUX emplacements d'attente de
   cet écran : les DEUX contrôles de ligne (`enCoursId === l.id`, partagé par
   le bouton « Écarter » ET le sélecteur « Rattacher un lieu… »), et le
   formulaire de création.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Opportunités — attente d’écriture : LA LIGNE l’annonce, puis redevient actionnable', () => {
  it(
    'pendant le rattachement d’un lieu, LES DEUX contrôles de CETTE ligne s’inertisent — jamais ' +
      'ceux d’une AUTRE ligne — puis la ligne redevient actionnable',
    async () => {
      let repondre: ((valeur: unknown) => void) | undefined;
      brancherApi({
        ...reponsesNominales(),
        // Un lieu proposable : sans lui, le `<select>` de rattachement ne se
        // rend même pas (`lieux.length > 0`), et ce test ne prouverait rien.
        // Forme complète exigée par `schemaListeLieux` (`packages/core`) —
        // un objet `{ id, nom }` seul échoue au `parse` et retombe
        // silencieusement sur `[]` (mode dégradé de `chargerLieux`).
        'GET /lieux': () =>
          Promise.resolve({
            data: [
              {
                id: 'lieu-9',
                nom: 'Marché de Verviers-centre',
                heureDebut: null,
                heureFin: null,
                tarifEmplacementCents: null,
              },
            ],
            meta: { total: 1 },
          }),
        'PATCH /opportunites/o-entreprise/rattacher-lieu': () =>
          new Promise((resoudre) => {
            repondre = resoudre;
          }),
      });
      monter();
      const rangee = await screen.findByRole('row', { name: /Techspace Aero/ });

      await userEvent.selectOptions(
        within(rangee).getByRole('combobox', { name: /Rattacher un lieu/ }),
        'lieu-9',
      );

      // 1. L'attente est ANNONCÉE sur LES DEUX contrôles de CETTE ligne…
      expect(within(rangee).getByRole('combobox', { name: /Rattacher un lieu/ })).toBeDisabled();
      expect(within(rangee).getByRole('button', { name: 'Écarter' })).toBeDisabled();
      // …et JAMAIS sur ceux d'une AUTRE ligne : `enCoursId` est scindé PAR
      // LIGNE, pas un seul verrou global qui geler tout le tableau.
      const autreRangee = screen.getByRole('row', { name: /Marché de La Batte/ });
      expect(within(autreRangee).getByRole('button', { name: 'Écarter' })).not.toBeDisabled();
      /*
        2. Un second clic sur « Écarter » ne prouverait rien : `disabled`
        natif, bloqué par le navigateur. Aucun raccourci clavier ne contourne
        ces deux contrôles.
      */

      repondre?.({});

      // 3. Après la réponse, la ligne redevient actionnable ET le confirme.
      await vi.waitFor(() =>
        expect(within(rangee).getByRole('button', { name: 'Écarter' })).not.toBeDisabled(),
      );
      expect(await screen.findByRole('status')).toHaveTextContent('Lieu rattaché à');
    },
  );
});

describe('Opportunités — attente d’écriture : le FORMULAIRE l’annonce, puis redevient actionnable', () => {
  it('« Créer l’opportunité » devient `disabled` et dit « Création… » pendant l’envoi, puis redevient normal', async () => {
    let repondre: ((valeur: unknown) => void) | undefined;
    brancherApi({
      ...reponsesNominales(),
      'POST /opportunites': () =>
        new Promise((resoudre) => {
          repondre = resoudre;
        }),
    });
    monter();
    await screen.findByRole('row', { name: /Marché de La Batte/ });
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle opportunité' }));
    await screen.findByLabelText('Nom');

    await userEvent.type(screen.getByLabelText('Nom'), 'Fête médiévale');
    await userEvent.type(screen.getByLabelText('Début'), '2026-10-03');
    await userEvent.type(screen.getByLabelText('Fin'), '2026-10-03');
    await userEvent.click(screen.getByRole('button', { name: 'Créer l’opportunité' }));

    // 1. L'attente est ANNONCÉE : le libellé change ET le bouton s'inertise.
    const enCours = await screen.findByRole('button', { name: 'Création…' });
    expect(enCours).toBeDisabled();
    // 2. `disabled` natif bloque déjà clic et Entrée : aucun raccourci clavier
    // de cet écran ne contourne ce bouton.

    repondre?.({});

    // 3. Après la réponse, le libellé ET l'état redeviennent ceux du repos.
    expect(await screen.findByRole('button', { name: 'Créer l’opportunité' })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Opportunité créée.');
  });
});
