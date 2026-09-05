/**
 * Écran OBJECTIFS ET SUCCÈS, MONTÉ pour de vrai (jsdom, D-095 du 01/08/2026).
 *
 * ═══ Ce que `Objectifs.test.tsx`, à côté, ne POUVAIT pas voir ═══
 *
 * Le fichier voisin teste `erreursSaisieObjectif` et
 * `libelleCibleAnnulationObjectif` — deux fonctions pures, correctement
 * testées, et intouchées ici. Le formulaire de création, lui, n'existe même
 * pas dans le DOM avant un clic sur « Nouvel objectif » : `renderToStaticMarkup`
 * ne peut ni le remplir, ni le soumettre, ni constater où atterrit le focus.
 *
 * ═══ Ce que la fixture doit pouvoir contredire ═══
 *
 * QUATRE lignes d'objectif de statuts DIFFÉRENTS, dont une contre-écriture
 * d'annulation et sa cible. Un seul objectif « atteint » ne prouverait rien
 * sur l'échelle de statuts ; et sans la PAIRE annulation/annulé, la phrase
 * « corrige l'objectif … » n'aurait rien à résoudre.
 *
 * DEUX seuils légaux dans le contexte, dont un À 85 % de son plafond : c'est
 * exactement le cas qui s'affichait en vert avant que `seuilAlerteBp` soit lu
 * (CLAUDE.md §6 : alerte à 80 %). Un jeu de seuils tous à 10 % ne pourrait pas
 * voir la faute.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  GLYPHE_STATUT,
  formaterDate,
  formaterEuros,
  type ObjectifLigneContrat,
  type SuccesContrat,
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
const { default: Objectifs } = await import('./Objectifs');

type AppelApi = (chemin: string, options?: RequestInit) => Promise<unknown>;
const appelApi = vi.mocked(requeteApi) as unknown as ReturnType<typeof vi.fn<AppelApi>>;

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function objectif(
  champs: Partial<ObjectifLigneContrat> & Pick<ObjectifLigneContrat, 'id' | 'grandeur'>,
): ObjectifLigneContrat {
  const base: ObjectifLigneContrat = {
    id: champs.id,
    grandeur: champs.grandeur,
    dateDebut: '2026-01-01',
    dateFin: '2026-12-31',
    valeurCible: 2_000_000,
    notes: null,
    estAnnulation: false,
    objectifAnnuleId: null,
    estAnnule: false,
    creeLe: '2026-01-02T09:00:00.000Z',
    modifieLe: '2026-01-02T09:00:00.000Z',
    evaluation: {
      grandeur: champs.grandeur,
      valeurCible: 2_000_000,
      realise: 1_200_000,
      ecart: -800_000,
      avancementBp: 6000,
      statut: 'en_cours',
      periodeTerminee: false,
    },
  };
  return { ...base, ...champs, evaluation: { ...base.evaluation, ...champs.evaluation } };
}

const OBJECTIFS: ObjectifLigneContrat[] = [
  objectif({ id: 'o-ca', grandeur: 'chiffre_affaires' }),
  // « Sans donnée » : aucune session clôturée sur la période. Ni succès, ni
  // échec — et surtout PAS un réalisé de 0, qui se lirait comme un échec.
  objectif({
    id: 'o-marge',
    grandeur: 'marge_nette',
    valeurCible: 500_000,
    evaluation: {
      grandeur: 'marge_nette',
      valeurCible: 500_000,
      realise: null,
      ecart: null,
      avancementBp: null,
      statut: 'sans_donnee',
      periodeTerminee: false,
    },
  }),
  // La paire annulé / annulation : c'est elle qui donne à
  // `libelleCibleAnnulationObjectif` quelque chose à résoudre.
  objectif({
    id: 'o-sessions-ancien',
    grandeur: 'nombre_sessions',
    dateDebut: '2026-02-01',
    dateFin: '2026-06-30',
    valeurCible: 20,
    estAnnule: true,
    evaluation: {
      grandeur: 'nombre_sessions',
      valeurCible: 20,
      realise: 14,
      ecart: -6,
      avancementBp: 7000,
      statut: 'manque',
      periodeTerminee: true,
    },
  }),
  objectif({
    id: 'o-sessions-corrige',
    grandeur: 'nombre_sessions',
    dateDebut: '2026-02-01',
    dateFin: '2026-06-30',
    valeurCible: 14,
    estAnnulation: true,
    objectifAnnuleId: 'o-sessions-ancien',
    evaluation: {
      grandeur: 'nombre_sessions',
      valeurCible: 14,
      realise: 14,
      ecart: 0,
      avancementBp: 10000,
      statut: 'atteint',
      periodeTerminee: true,
    },
  }),
];

const SUCCES: SuccesContrat = {
  series: [],
  niveauChiffreAffaires: {
    niveau: {
      niveauActuel: 2,
      libelleNiveauActuel: 'Marché du dimanche',
      valeurActuelle: 1_200_000,
      prochainPalier: { niveau: 3, seuil: 2_000_000, libelle: 'Saison complète' },
      progressionVersProchainBp: 6000,
    },
    contexteSeuilsLegaux: {
      data: [
        {
          cle: 'franchise_tva',
          libelle: 'Franchise TVA',
          realiseCents: 2_125_000,
          plafondCents: 2_500_000,
          // 85 % : au-dessus du palier d'alerte de 80 %, sous le plafond.
          partBp: 8500,
          projectionFinAnneeCents: 2_400_000,
          depassementProjete: false,
          source: 'parametre',
          toleranceE604b: null,
        },
        {
          cle: 'airbag',
          libelle: 'Aide Airbag',
          realiseCents: 300_000,
          plafondCents: 2_300_000,
          partBp: 1304,
          projectionFinAnneeCents: null,
          depassementProjete: false,
          source: 'parametre',
          toleranceE604b: null,
        },
      ],
      meta: {
        annee: 2026,
        sessionsTenues: 14,
        caTransformeCents: 1_400_000,
        caRevenduCents: 725_000,
        partRevenduBp: 3411,
        seuilAlerteBp: 8000,
      },
    },
  },
  niveauAnciennete: {
    niveauActuel: 1,
    libelleNiveauActuel: 'Première saison',
    valeurActuelle: 8,
    prochainPalier: null,
    progressionVersProchainBp: null,
  },
  anticipationSeuils: [],
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
    'GET /objectifs': () => Promise.resolve({ data: OBJECTIFS, meta: { total: OBJECTIFS.length } }),
    'GET /objectifs/succes': () => Promise.resolve(SUCCES),
  };
}

function monter(): void {
  render(<Objectifs />);
}

function normaliser(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  appelApi.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état — DEUX appels indépendants
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Objectifs — chargement, prêt, erreur', () => {
  it('annonce ses deux chargements, puis les remplace tous les deux', async () => {
    brancherApi(reponsesNominales());
    monter();

    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    expect(screen.getByText('Chargement des succès…')).toBeInTheDocument();

    expect(await screen.findByText('Chiffre d’affaires')).toBeInTheDocument();
    expect(screen.queryByText('Chargement des succès…')).not.toBeInTheDocument();
  });

  it('une panne des SUCCÈS n’emporte pas les OBJECTIFS : on peut toujours se fixer une cible', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /objectifs/succes': () =>
        Promise.reject(
          new ErreurApi('Le calcul des séries a échoué.', { code: 'succes_indispo', statut: 500 }),
        ),
    });
    monter();

    // Les objectifs restent lisibles…
    expect(await screen.findByText('Marge nette')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouvel objectif' })).toBeEnabled();
    // …et les quatre encarts de succès gardent CHACUN leur titre plutôt que de
    // disparaître derrière un unique bandeau sans cadre.
    for (const titre of [
      'Niveau — Chiffre d’affaires cumulé',
      'Niveau — Ancienneté active',
      'Succès',
      'Anticipation d’un seuil légal',
    ]) {
      expect(screen.getByRole('heading', { name: titre })).toBeInTheDocument();
    }
  });

  it('une panne des OBJECTIFS affiche le message du serveur sans masquer les succès', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /objectifs': () =>
        Promise.reject(
          new ErreurApi('La table des objectifs est verrouillée.', {
            code: 'objectifs_verrouilles',
            statut: 503,
          }),
        ),
    });
    monter();

    expect(await screen.findByRole('alert')).toHaveTextContent('table des objectifs');
    expect(screen.getByText('Marché du dimanche')).toBeInTheDocument();
  });

  it('aucun objectif : une phrase de démarrage, pas une liste muette', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /objectifs': () => Promise.resolve({ data: [], meta: { total: 0 } }),
    });
    monter();

    expect(await screen.findByText('Aucun objectif fixé')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Inconnu ≠ zéro, et le contexte des seuils légaux
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Objectifs — ce que la ligne dit, et ce qu’elle refuse de dire', () => {
  it('un réalisé INCONNU dit « sans donnée sur la période », jamais 0,00 € — qui se lirait comme un échec', async () => {
    brancherApi(reponsesNominales());
    monter();
    const titre = await screen.findByText('Marge nette');
    const ligne = titre.closest('li');
    expect(ligne).not.toBeNull();

    const texte = normaliser(ligne?.textContent ?? '');
    expect(texte).toContain('réalisé sans donnée sur la période');
    // Le mensonge traqué : « réalisé 0,00 € » se lirait comme un échec, alors
    // qu'aucune session n'a encore été clôturée sur la période. On vise la
    // phrase entière — « 0,00 » seul serait aussi un morceau de « 5 000,00 ».
    expect(texte).not.toContain(`réalisé ${normaliser(formaterEuros(0))}`);
    // La CIBLE, elle, reste chiffrée : c'est le RÉALISÉ qui est inconnu.
    expect(texte).toContain(`Cible ${normaliser(formaterEuros(500_000))}`);
    // Et le statut reste NEUTRE : ni succès, ni échec.
    expect(ligne).toHaveTextContent('Sans donnée');
  });

  it('un objectif de CHIFFRE D’AFFAIRES ne s’affiche jamais nu : les seuils légaux l’accompagnent', async () => {
    brancherApi(reponsesNominales());
    monter();
    const titre = await screen.findByText('Chiffre d’affaires');
    const ligne = titre.closest('li');
    expect(ligne).not.toBeNull();

    expect(ligne).toHaveTextContent('Franchise TVA');
    expect(ligne).toHaveTextContent('Aide Airbag');
    expect(normaliser(ligne?.textContent ?? '')).toContain(normaliser(formaterEuros(2_125_000)));
  });

  it('un seuil à 85 % porte le glyphe d’ALERTE, pas celui du conforme (CLAUDE.md §6 : alerte à 80 %)', async () => {
    brancherApi(reponsesNominales());
    monter();
    // Le contexte des seuils apparaît DEUX fois sur cet écran (sous la ligne
    // d'objectif de CA, et dans l'encart de succès) : on vise celui de la
    // LIGNE, celui que la fiche §2.1 rend obligatoire.
    const ligne = (await screen.findByText('Chiffre d’affaires')).closest('li');
    expect(ligne).not.toBeNull();
    const dansLaLigne = within(ligne as HTMLElement);

    // 85 % du plafond : au-dessus du palier de 80 %, donc alerte.
    expect(dansLaLigne.getByText('Franchise TVA').textContent).toContain(GLYPHE_STATUT.alerte);
    // 13 % : rien à signaler — le signal reste rare.
    expect(dansLaLigne.getByText('Aide Airbag').textContent).toContain(GLYPHE_STATUT.conforme);
  });

  it('un objectif de NOMBRE DE SESSIONS se compte en sessions, jamais en euros', async () => {
    brancherApi(reponsesNominales());
    monter();
    const lignes = await screen.findAllByText('Nombre de sessions');
    const ligne = lignes[0]?.closest('li');
    expect(ligne).not.toBeNull();

    expect(ligne).toHaveTextContent('20 sessions');
    expect(normaliser(ligne?.textContent ?? '')).not.toContain('€');
  });

  it('une correction NOMME l’objectif qu’elle corrige — deux corrections ne sont plus indiscernables', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByText('Chiffre d’affaires');

    const texte = await screen.findByText(/corrige l’objectif/);
    expect(texte).toHaveTextContent('Nombre de sessions');
    expect(texte).toHaveTextContent(formaterDate('2026-02-01'));
    expect(texte).toHaveTextContent(formaterDate('2026-06-30'));
  });

  it('la ligne annulée porte « Annulé », la contre-écriture porte « Correction » — et pas l’inverse', async () => {
    brancherApi(reponsesNominales());
    monter();
    const lignes = await screen.findAllByText('Nombre de sessions');

    const annulee = lignes[0]?.closest('li');
    const correction = lignes[1]?.closest('li');
    expect(annulee).toHaveTextContent('Annulé');
    expect(annulee).not.toHaveTextContent('Correction');
    expect(correction).toHaveTextContent('Correction');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Saisie, clavier, focus (CLAUDE.md §3 règle 10)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Objectifs — création au clavier', () => {
  it('ouvrir le formulaire y amène le focus, et « Fin » n’est JAMAIS pré-remplie à notre place', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByText('Chiffre d’affaires');

    await userEvent.click(screen.getByRole('button', { name: 'Nouvel objectif' }));

    const grandeur = screen.getByLabelText('Grandeur');
    await vi.waitFor(() => expect(document.activeElement).toBe(grandeur));
    // Un début pré-rempli est un repli utile ; une FIN pré-remplie au même jour
    // fabriquerait un objectif qu'aucune session ne pourrait jamais valider.
    expect(screen.getByLabelText('Début')).not.toHaveValue('');
    expect(screen.getByLabelText(/^Fin/)).toHaveValue('');
    expect(screen.getByText('Aucun défaut : à choisir vous-même.')).toBeInTheDocument();
  });

  it('une fin non choisie est refusée AVANT tout aller-retour, et le focus y atterrit', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByText('Chiffre d’affaires');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel objectif' }));

    await userEvent.type(screen.getByLabelText(/Cible/), '25000');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const champFin = screen.getByLabelText(/^Fin/);
    expect(
      await screen.findByText(/Choisissez une date de fin : sans elle, cet objectif/),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(champFin);
    expect(champFin).toHaveAttribute('aria-invalid', 'true');
    // Rien n'est parti au serveur : la faute est arrêtée ici.
    expect(appelApi.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
  });

  it('changer de GRANDEUR change ce que « Cible » veut dire, et efface les erreurs devenues caduques', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByText('Chiffre d’affaires');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel objectif' }));

    expect(screen.getByLabelText('Cible (€)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/La cible doit être un montant valide/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Grandeur'), 'nombre_sessions');

    expect(screen.getByLabelText('Cible (sessions)')).toBeInTheDocument();
    // Le message précédent parlait d'un MONTANT : le garder après un
    // changement d'unité désignerait la mauvaise faute.
    expect(screen.queryByText(/La cible doit être un montant valide/)).not.toBeInTheDocument();
  });

  it('un objectif valide part au serveur en CENTIMES entiers, et le formulaire se referme sur son bouton', async () => {
    const cree = vi.fn(() => Promise.resolve({}));
    brancherApi({ ...reponsesNominales(), 'POST /objectifs': cree });
    monter();
    await screen.findByText('Chiffre d’affaires');
    const bouton = screen.getByRole('button', { name: 'Nouvel objectif' });
    await userEvent.click(bouton);

    await userEvent.type(screen.getByLabelText(/^Fin/), '2026-12-31');
    await userEvent.type(screen.getByLabelText(/Cible/), '25000');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await vi.waitFor(() => expect(cree).toHaveBeenCalledTimes(1));
    const corps = JSON.parse(
      String(
        appelApi.mock.calls.find(([c, o]) => c === '/objectifs' && o?.method === 'POST')?.[1]?.body,
      ),
    ) as Record<string, unknown>;
    // 25 000 € = 2 500 000 centimes ENTIERS (CLAUDE.md §3 règle 3).
    expect(corps['valeurCible']).toBe(2_500_000);
    expect(corps['dateFin']).toBe('2026-12-31');

    await vi.waitFor(() => expect(document.activeElement).toBe(bouton));
  });

  it('un refus SERVEUR champ par champ se marque sur le champ, jamais dans un bandeau de page', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /objectifs': () =>
        Promise.reject(
          new ErreurApi('Saisie refusée.', {
            code: 'saisie_invalide',
            statut: 422,
            champs: { dateFin: 'Cette date n’existe pas au calendrier.' },
          }),
        ),
    });
    monter();
    await screen.findByText('Chiffre d’affaires');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvel objectif' }));

    await userEvent.type(screen.getByLabelText(/^Fin/), '2026-12-31');
    await userEvent.type(screen.getByLabelText(/Cible/), '25000');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Cette date n’existe pas au calendrier.')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText(/^Fin/));
  });

  it('Échap referme le formulaire et rend le focus au bouton qui l’avait ouvert', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByText('Chiffre d’affaires');
    const bouton = screen.getByRole('button', { name: 'Nouvel objectif' });
    await userEvent.click(bouton);
    expect(screen.getByLabelText('Grandeur')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByLabelText('Grandeur')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(document.activeElement).toBe(bouton));
  });

  it('une annulation sans motif est refusée AVANT tout aller-retour : rien ne s’efface en silence', async () => {
    brancherApi(reponsesNominales());
    monter();
    const titre = await screen.findByText('Marge nette');
    const ligne = titre.closest('li');
    expect(ligne).not.toBeNull();

    await userEvent.click(within(ligne as HTMLElement).getByRole('button', { name: /Annuler/ }));
    const champMotif = await screen.findByLabelText('Motif de l’annulation');
    await vi.waitFor(() => expect(document.activeElement).toBe(champMotif));

    await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(
      await screen.findByText('Indiquez pourquoi cet objectif est annulé ou corrigé.'),
    ).toBeInTheDocument();
    expect(appelApi.mock.calls.some(([c]) => c.includes('/annuler'))).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état pendant l'aller-retour — la promesse EN VOL

   Le test « un objectif valide part au serveur… » (ci-dessus) résout sa
   promesse IMMÉDIATEMENT (`Promise.resolve({})`) : il prouve le CORPS envoyé,
   jamais ce qui se passe PENDANT l'aller-retour — un bouton `disabled`, un
   libellé d'attente, ne peuvent tout simplement pas y être vus
   (docs/39-DOCTRINE-DES-AGENTS.md §3, cinquième forme). Les deux tests ci-dessous
   résolvent la promesse EUX-MÊMES, après avoir observé l'état « en cours »
   dans le DOM.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Objectifs — créer un objectif annonce l’envoi, et redevient actionnable sans double écriture', () => {
  it(
    '« Enregistrer » passe à « Enregistrement… » (disabled) pendant le POST, un second clic ' +
      'n’envoie rien de plus, et le libellé revient après un refus serveur',
    async () => {
      let rejeter: ((raison: unknown) => void) | undefined;
      brancherApi({
        ...reponsesNominales(),
        'POST /objectifs': () =>
          new Promise((_resoudre, rej) => {
            rejeter = rej;
          }),
      });
      monter();
      await screen.findByText('Chiffre d’affaires');
      await userEvent.click(screen.getByRole('button', { name: 'Nouvel objectif' }));

      await userEvent.type(screen.getByLabelText(/^Fin/), '2026-12-31');
      await userEvent.type(screen.getByLabelText(/Cible/), '25000');
      await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      const bouton = await screen.findByRole('button', { name: 'Enregistrement…' });
      expect(bouton).toBeDisabled();

      /*
        `creerObjectifDepuisFormulaire` porte un garde-fou explicite
        (`etatCreation.statut === 'en_cours'`), mais rien ne le contourne sur
        cet écran : aucun raccourci clavier n'est posé sur ce formulaire. Ce
        second clic ne mesure donc que le blocage NATIF du navigateur sur un
        bouton `disabled`, jamais le garde-fou applicatif lui-même.
      */
      fireEvent.click(bouton);
      const posts = () =>
        appelApi.mock.calls.filter(([c, o]) => c === '/objectifs' && o?.method === 'POST');
      expect(posts()).toHaveLength(1);

      // Refus serveur plutôt que succès : un succès REFERME le panneau
      // (`setCreationOuverte(false)`), donc ce bouton disparaîtrait — seul un
      // refus montre ce MÊME bouton redevenir « Enregistrer », actionnable.
      rejeter?.(
        new ErreurApi('Une cible existe déjà sur une période qui chevauche celle-ci.', {
          code: 'periode_chevauchante',
          statut: 409,
        }),
      );

      const revenu = await screen.findByRole('button', { name: 'Enregistrer' });
      expect(revenu).toBeEnabled();
      expect(
        await screen.findByText('Une cible existe déjà sur une période qui chevauche celle-ci.'),
      ).toBeInTheDocument();
    },
  );
});

describe('Objectifs — annuler un objectif annonce l’envoi, et redevient actionnable après un refus', () => {
  it(
    '« Confirmer » est disabled pendant le POST, un second clic n’envoie rien de plus, et ' +
      'redevient actionnable après un refus serveur',
    async () => {
      let rejeter: ((raison: unknown) => void) | undefined;
      brancherApi({
        ...reponsesNominales(),
        'POST /objectifs/o-marge/annuler': () =>
          new Promise((_resoudre, rej) => {
            rejeter = rej;
          }),
      });
      monter();
      const titre = await screen.findByText('Marge nette');
      const ligne = titre.closest('li') as HTMLElement;

      await userEvent.click(within(ligne).getByRole('button', { name: /Annuler/ }));
      await userEvent.type(
        await screen.findByLabelText('Motif de l’annulation'),
        'Cible revue à la baisse',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

      const bouton = await screen.findByRole('button', { name: 'Confirmer' });
      expect(bouton).toBeDisabled();

      /*
        DÉFAUT D'INERTIE RÉEL, à signaler (pas à corriger — aucun fichier de
        production n'est dans la zone d'écriture de cette mission) :
        `confirmerAnnulationObjectif` ne porte AUCUN garde-fou
        `if (etatAnnulation.statut === 'en_cours') return` avant d'écrire —
        contrairement à `creerObjectifDepuisFormulaire` juste au-dessus, qui
        en porte un. Le SEUL verrou posé ici est ce `disabled` natif. Aucun
        raccourci clavier n'atteint cette fonction hors de ce bouton, donc
        l'absence de garde-fou reste aujourd'hui inatteignable par un geste
        réel — mais ce second clic ne le PROUVE pas : il ne mesure, comme
        ailleurs dans ce fichier, que le blocage natif.
      */
      fireEvent.click(bouton);
      const posts = () =>
        appelApi.mock.calls.filter(
          ([c, o]) => c === '/objectifs/o-marge/annuler' && o?.method === 'POST',
        );
      expect(posts()).toHaveLength(1);

      rejeter?.(
        new ErreurApi('Cet objectif a déjà été corrigé par une autre écriture.', {
          code: 'objectif_deja_corrige',
          statut: 409,
        }),
      );

      const revenu = await screen.findByRole('button', { name: 'Confirmer' });
      expect(revenu).toBeEnabled();
      expect(
        await screen.findByText('Cet objectif a déjà été corrigé par une autre écriture.'),
      ).toBeInTheDocument();
    },
  );
});
