/**
 * Écran Factures fournisseur — test MONTÉ, en complément de `Factures.test.tsx`
 * et `Factures.securite.test.tsx`.
 *
 * ═══ Ce que ce fichier ajoute ═══
 *
 * Les deux fichiers voisins couvrent des fonctions PURES exportées
 * (`resoudreEcartLigneFacture`, `extraireFichierScanPath`,
 * `phraseCorrectionCoutLot`, `LienPieceJointe`…). Ils restent valables et ne
 * sont pas touchés. L'écran monté, lui, n'avait AUCUN test : la sélection
 * d'une facture, le chargement de son détail, et surtout le fait que
 * `resoudreEcartLigneFacture` soit RÉELLEMENT appelée par la colonne « Écart »
 * ne s'atteignent que par un montage.
 *
 * ═══ Les deux inconnues de cet écran ═══
 *
 * 1. `ecartResiduelCents` est `null` EXACTEMENT quand `lotResolu` est faux :
 *    comparer un montant à « aucun lot » n'a pas de sens. Un « 0,00 » y
 *    afficherait un écart NUL, coloré comme un vrai écart, là où il n'y a rien
 *    à comparer.
 * 2. `dateEcheance` est `null` quand aucune n'a été convenue. L'écran doit se
 *    taire, jamais inventer une échéance — c'est une date qui engage un
 *    paiement.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TIRET_ABSENT,
  formaterDate,
  formaterMontant,
  type FactureDetail,
  type FactureResume,
  type LigneFactureDetailContrat,
} from '@batte/core';

import type * as ApiReelle from '../lib/api';

// `typeof ApiReelle` plutôt que `typeof import('../lib/api')` : la règle
// `@typescript-eslint/consistent-type-imports` interdit l'annotation
// `import()` en ligne. Le `import type` ci-dessus est effacé à la
// compilation — il ne crée donc aucune référence de VALEUR dans la fabrique
// de `vi.mock`, que Vitest remonte en tête de fichier.
vi.mock('../lib/api', async (importerReel) => {
  const reel = await importerReel<typeof ApiReelle>();
  return { ...reel, requeteApi: vi.fn(), telechargerFichierApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: Factures } = await import('./Factures');

const appel = vi.mocked(requeteApi);

/** Classe du registre d'alerte MÉTIER, celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function resume(partiel: Partial<FactureResume> = {}): FactureResume {
  return {
    id: 'fac-1',
    numeroFournisseur: 'FA-2026-0042',
    fournisseurId: 'four-1',
    fournisseurNom: 'Moulin de Statte',
    dateFacture: '2026-01-15',
    dateEcheance: '2026-02-14',
    montantTotalCents: 48750,
    statut: 'a_rapprocher',
    nbLignes: 3,
    ecartTotalCents: 0,
    estAnnulation: false,
    factureAnnuleeId: null,
    estAnnulee: false,
    creeLe: '2026-01-16T09:00:00.000Z',
    ...partiel,
  };
}

function ligne(partiel: Partial<LigneFactureDetailContrat> = {}): LigneFactureDetailContrat {
  return {
    id: 'lig-1',
    libelle: 'Farine T55 — sac 25 kg',
    montantCents: 24000,
    receptionId: 'rec-1',
    numeroReception: 'R-2026-008',
    ingredientId: 'ing-1',
    nomIngredient: 'Farine T55',
    quantiteUniteRef: 25000,
    ecartPrixCents: 0,
    lotResolu: true,
    ecartResiduelCents: 0,
    receptionAnnulee: false,
    ...partiel,
  };
}

/**
 * TROIS lignes, une par cas que la colonne « Écart » doit distinguer :
 * conforme, en écart, et SANS lot résolu (donc rien à comparer). Une fixture
 * qui n'en porterait qu'une ne montrerait rien de la distinction — et c'est
 * précisément la troisième qui porte la règle « inconnu ≠ zéro ».
 */
const LIGNE_CONFORME = ligne();
const LIGNE_EN_ECART = ligne({
  id: 'lig-2',
  libelle: 'Lait entier — 6 × 1 L',
  montantCents: 1080,
  ecartPrixCents: 180,
  ecartResiduelCents: 180,
  nomIngredient: 'Lait entier',
});
const LIGNE_SANS_LOT = ligne({
  id: 'lig-3',
  libelle: 'Frais de transport',
  montantCents: 950,
  receptionId: null,
  numeroReception: null,
  ingredientId: null,
  nomIngredient: null,
  quantiteUniteRef: null,
  ecartPrixCents: 0,
  // LE cas qui compte : aucun lot résolu, donc AUCUN écart calculable.
  lotResolu: false,
  ecartResiduelCents: null,
});

function detail(partiel: Partial<FactureDetail> = {}): FactureDetail {
  return {
    ...resume(),
    notes: null,
    avertissements: [],
    lignes: [LIGNE_CONFORME, LIGNE_EN_ECART, LIGNE_SANS_LOT],
    ...partiel,
  };
}

type ReponsesFeintes = {
  liste?: unknown;
  detail?: unknown;
};

function feindre(reponses: ReponsesFeintes): void {
  appel.mockImplementation((chemin: string, options?: RequestInit) => {
    if (options?.method !== undefined && options.method !== 'GET') {
      return new Promise<never>(() => {});
    }
    const choisie = chemin === '/factures' ? reponses.liste : reponses.detail;
    if (choisie === undefined) return new Promise<never>(() => {});
    if (choisie instanceof Error) return Promise.reject(choisie);
    return Promise.resolve(choisie as never);
  });
}

function listeFactures(factures: FactureResume[]): unknown {
  return { data: factures, meta: { total: factures.length } };
}

beforeEach(() => {
  appel.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Les trois états d'un écran de lecture
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Factures — chargement, erreur, vide', () => {
  it('annonce le chargement plutôt que de laisser l’écran muet', () => {
    feindre({});
    render(<Factures />);

    expect(screen.getByText('Chargement des factures…')).toBeInTheDocument();
  });

  it('un échec de la liste reste NEUTRE, sans couleur d’alerte métier', async () => {
    feindre({
      liste: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<Factures />);

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue du serveur (code HTTP 500).');
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    expect(message.parentElement?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
  });

  it('une panne qui n’est pas une ErreurApi reste lisible en français', async () => {
    feindre({ liste: new TypeError('Failed to fetch') });
    render(<Factures />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Erreur inattendue, sans plus de détail.',
    );
  });

  it('liste vide : une phrase, et une action qui ouvre réellement la saisie', async () => {
    feindre({ liste: listeFactures([]) });
    render(<Factures />);

    expect(await screen.findByText('Aucune facture enregistrée')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nouvelle facture' })).toBeNull();

    // DEUX boutons portent ce nom (l'en-tête et l'action de l'état vide) : on
    // vise explicitement celui de l'ÉTAT VIDE, sinon le test prouverait le
    // bouton d'en-tête en croyant prouver l'autre.
    const boutons = screen.getAllByRole('button', { name: 'Nouvelle facture' });
    expect(boutons).toHaveLength(2);
    const actionEtatVide = boutons.find((b) => b.closest('td') !== null) as HTMLButtonElement;
    expect(actionEtatVide).toBeDefined();
    await userEvent.click(actionEtatVide);
    // L'action de l'état vide doit ouvrir la surface de saisie, sinon elle ment.
    expect(screen.getByRole('heading', { name: 'Nouvelle facture' })).toBeInTheDocument();
  });

  it('le compte de factures s’accorde en nombre', async () => {
    feindre({ liste: listeFactures([resume()]) });
    render(<Factures />);
    expect(await screen.findByRole('heading', { name: '1 facture' })).toBeInTheDocument();
  });

  it('deux factures se comptent au pluriel', async () => {
    feindre({ liste: listeFactures([resume(), resume({ id: 'fac-2' })]) });
    render(<Factures />);
    expect(await screen.findByRole('heading', { name: '2 factures' })).toBeInTheDocument();
  });

  it('un échec du DÉTAIL n’emporte pas la liste, et garde un cadre titré', async () => {
    feindre({
      liste: listeFactures([resume()]),
      detail: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<Factures />);

    await screen.findByText('FA-2026-0042');
    await userEvent.click(screen.getByText('FA-2026-0042'));

    const message = await screen.findByRole('alert');
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    // Le panneau garde un titre : un bandeau rouge nu ne dirait pas quel
    // encart est mort (défaut du 31/07/2026).
    expect(screen.getByRole('heading', { name: 'Erreur' })).toBeInTheDocument();
    // Et la liste reste consultable.
    expect(screen.getByText('Moulin de Statte')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Inconnu ≠ zéro — l'écart et l'échéance
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Factures — un écart incalculable ne s’affiche pas comme un écart nul', () => {
  async function ouvrirLeDetail(): Promise<void> {
    feindre({ liste: listeFactures([resume()]), detail: detail() });
    render(<Factures />);
    await screen.findByText('FA-2026-0042');
    await userEvent.click(screen.getByText('FA-2026-0042'));
    await screen.findByText('Frais de transport');
  }

  it('une ligne SANS lot résolu rend le tiret, jamais « 0,00 » coloré comme un écart', async () => {
    await ouvrirLeDetail();

    const sansLot = screen.getByText('Frais de transport').closest('tr') as HTMLTableRowElement;
    expect(within(sansLot).getAllByText(TIRET_ABSENT).length).toBeGreaterThanOrEqual(1);
    // Aucun registre de couleur ne s'applique : il n'y a rien à juger.
    expect(sansLot.innerHTML).not.toContain('text-depassement');
    expect(sansLot.innerHTML).not.toContain('text-alerte');
  });

  it('une ligne en écart RÉEL, elle, est chiffrée et colorée — la fixture discrimine', async () => {
    await ouvrirLeDetail();

    const enEcart = screen.getByText('Lait entier — 6 × 1 L').closest('tr') as HTMLTableRowElement;
    expect(enEcart.textContent ?? '').toContain(`+${formaterMontant(180)}`);
    expect(enEcart.innerHTML).toContain('text-depassement');
  });

  it('une ligne conforme n’est ni un tiret ni un écart : elle est CONFORME', async () => {
    await ouvrirLeDetail();

    const conforme = screen
      .getByText('Farine T55 — sac 25 kg')
      .closest('tr') as HTMLTableRowElement;
    // Les trois cas coexistent dans la même facture : c'est ce qui prouve que
    // l'écran les distingue, et non qu'il rend la même chose partout.
    expect(conforme.innerHTML).toContain('text-conforme');
  });

  it('un écart total NUL rend le tiret dans la liste, jamais « 0,00 »', async () => {
    feindre({
      liste: listeFactures([
        resume(),
        resume({ id: 'fac-2', numeroFournisseur: 'FA-2026-0043', ecartTotalCents: 320 }),
      ]),
    });
    render(<Factures />);

    const sansEcart = (await screen.findByText('FA-2026-0042')).closest(
      'tr',
    ) as HTMLTableRowElement;
    expect(within(sansEcart).getByText(TIRET_ABSENT)).toBeInTheDocument();
    expect(sansEcart.textContent ?? '').not.toContain(formaterMontant(0));

    // Celle qui a un écart le porte, signe et glyphe compris.
    const avecEcart = screen.getByText('FA-2026-0043').closest('tr') as HTMLTableRowElement;
    expect(avecEcart.textContent ?? '').toContain(`+${formaterMontant(320)}`);
    expect(avecEcart.innerHTML).toContain('text-depassement');
  });

  it('une échéance absente se tait, une échéance connue s’affiche via le formateur', async () => {
    feindre({
      liste: listeFactures([resume()]),
      detail: detail({ dateEcheance: null }),
    });
    render(<Factures />);

    await screen.findByText('FA-2026-0042');
    await userEvent.click(screen.getByText('FA-2026-0042'));

    // Une échéance engage un paiement : l'inventer serait plus grave que se
    // taire. La phrase se réduit alors à la date de facture seule.
    const ligneDates = await screen.findByText(/^Facturée le/);
    expect(ligneDates.textContent ?? '').toContain(formaterDate('2026-01-15'));
    expect(ligneDates.textContent ?? '').not.toContain('Échéance le');
  });

  it('avec une échéance, la phrase la nomme — comparée au FORMATEUR', async () => {
    feindre({ liste: listeFactures([resume()]), detail: detail() });
    render(<Factures />);

    await screen.findByText('FA-2026-0042');
    await userEvent.click(screen.getByText('FA-2026-0042'));

    const ligneDates = await screen.findByText(/^Facturée le/);
    // `2026-02-14` : une date civile lue comme minuit UTC a déjà fabriqué une
    // heure fantôme dans ce dépôt — on compare au formateur, jamais à
    // « 14/02/2026 » tapé à la main.
    expect(ligneDates.textContent ?? '').toContain(`Échéance le ${formaterDate('2026-02-14')}`);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Sélection du détail, clavier, et avertissements non bloquants
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Factures — ouvrir une facture, au clavier', () => {
  const DEUX = [resume(), resume({ id: 'fac-2', numeroFournisseur: 'FA-2026-0043' })];

  it('une seule rangée est dans l’ordre de tabulation — « roving tabindex »', async () => {
    feindre({ liste: listeFactures(DEUX), detail: detail() });
    render(<Factures />);

    await screen.findByText('FA-2026-0042');
    const rangees = screen.getAllByRole('row').filter((r) => r.hasAttribute('tabindex'));
    expect(rangees).toHaveLength(2);
    expect(rangees.filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('Entrée ouvre le détail, une seconde fois le referme — la sélection bascule', async () => {
    feindre({ liste: listeFactures(DEUX), detail: detail() });
    render(<Factures />);

    await screen.findByText('FA-2026-0042');
    const rangee = screen.getByText('FA-2026-0042').closest('tr') as HTMLTableRowElement;
    rangee.focus();
    await userEvent.keyboard('{Enter}');

    expect(rangee).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Farine T55 — sac 25 kg')).toBeInTheDocument();

    await userEvent.keyboard('{Enter}');
    expect(rangee).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByText('Farine T55 — sac 25 kg')).toBeNull();
  });

  it('Flèche Bas déplace le focus sans ouvrir de détail', async () => {
    feindre({ liste: listeFactures(DEUX), detail: detail() });
    render(<Factures />);

    await screen.findByText('FA-2026-0042');
    // On part de l'ordre RÉELLEMENT rendu, pas de l'ordre de la fixture : le
    // tableau trie par urgence (`comparerFactures`), et supposer l'ordre de
    // saisie ferait viser la mauvaise rangée — le test serait rouge pour une
    // raison qui n'a rien à voir avec le clavier.
    const rangees = screen.getAllByRole('row').filter((r) => r.hasAttribute('tabindex'));
    const [premiere, seconde] = rangees as [HTMLTableRowElement, HTMLTableRowElement];

    premiere.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(seconde);
    // Se déplacer n'est pas choisir : aucun détail ne doit s'être ouvert.
    expect(seconde).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByText('Farine T55 — sac 25 kg')).toBeNull();
  });

  it('le tri met en tête ce qui attend une DÉCISION, pas la plus récente', async () => {
    // Fixture discriminante : la facture déjà PAYÉE est la plus récente, celle
    // « à rapprocher » la plus ancienne. Un tri purement chronologique
    // remonterait donc la payée — et enfouirait la seule qui demande un geste.
    feindre({
      liste: listeFactures([
        resume({
          id: 'fac-payee',
          numeroFournisseur: 'FA-2026-0099',
          statut: 'payee',
          dateFacture: '2026-06-01',
        }),
        resume({
          id: 'fac-a-faire',
          numeroFournisseur: 'FA-2026-0001',
          statut: 'a_rapprocher',
          dateFacture: '2026-01-02',
        }),
      ]),
      detail: detail(),
    });
    render(<Factures />);

    await screen.findByText('FA-2026-0001');
    const numeros = Array.from(document.querySelectorAll('tbody tr')).map(
      (r) => r.querySelector('td')?.textContent ?? '',
    );
    expect(numeros).toEqual(['FA-2026-0001', 'FA-2026-0099']);
  });

  it('une facture VIDE de lignes le dit, sans carte ni bouton', async () => {
    feindre({ liste: listeFactures([resume()]), detail: detail({ lignes: [] }) });
    render(<Factures />);

    await screen.findByText('FA-2026-0042');
    await userEvent.click(screen.getByText('FA-2026-0042'));

    // `variante: 'normal'` : une ligne discrète, pas un état de premier
    // lancement à guider.
    expect(await screen.findByText('Aucune ligne dans cette facture.')).toBeInTheDocument();
  });

  it('un avertissement « réception annulée » est affiché TEL QUEL, sans être bloquant', async () => {
    feindre({
      liste: listeFactures([resume()]),
      detail: detail({
        avertissements: [
          'La ligne « Farine T55 — sac 25 kg » est rattachée à la réception R-2026-008, annulée depuis.',
        ],
        lignes: [ligne({ receptionAnnulee: true })],
      }),
    });
    render(<Factures />);

    await screen.findByText('FA-2026-0042');
    await userEvent.click(screen.getByText('FA-2026-0042'));

    expect(
      await screen.findByText(/est rattachée à la réception R-2026-008, annulée depuis/),
    ).toBeInTheDocument();
    // NON BLOQUANT : le rattachement reste accepté, la ligne reste affichée.
    expect(screen.getByText('Farine T55 — sac 25 kg')).toBeInTheDocument();
  });

  it('une facture SANS avertissement n’affiche aucun bandeau — la fixture discrimine', async () => {
    feindre({ liste: listeFactures([resume()]), detail: detail() });
    render(<Factures />);

    await screen.findByText('FA-2026-0042');
    await userEvent.click(screen.getByText('FA-2026-0042'));

    await screen.findByText('Farine T55 — sac 25 kg');
    // Un bandeau toujours présent cesse d'être lu, exactement le jour où il
    // compterait — c'est le cas le plus fréquent, et il doit rester muet.
    expect(screen.queryByText(/annulée depuis/)).toBeNull();
  });

  it('sans pièce jointe, l’écran dit POURQUOI elle ne peut plus être ajoutée', async () => {
    feindre({ liste: listeFactures([resume()]), detail: detail() });
    render(<Factures />);

    await screen.findByText('FA-2026-0042');
    await userEvent.click(screen.getByText('FA-2026-0042'));

    expect(await screen.findByText(/elle ne peut être ajoutée qu'à la saisie/)).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Transitions d'état pendant l'aller-retour — la promesse EN VOL

   Rien ci-dessus n'exerçait une ÉCRITURE : ni l'annulation, ni le changement
   de statut. Une promesse résolue via `mockResolvedValue` ne pourrait de
   toute façon rien montrer de l'attente (docs/39-DOCTRINE-DES-AGENTS.md §3,
   cinquième forme) : elle retombe à `inactif` dans le MÊME écoulement de
   micro-tâches que sa pose, avant d'atteindre le DOM. Les deux tests
   ci-dessous résolvent la promesse EUX-MÊMES, après avoir observé l'état
   « en cours ».
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Factures — annuler une facture annonce l’envoi, et redevient actionnable sans double écriture', () => {
  it(
    '« Annuler la facture » passe à « Annulation… » (disabled) pendant le POST, un second clic ' +
      'n’envoie rien de plus, et le libellé revient après un refus serveur',
    async () => {
      let rejeter: ((raison: unknown) => void) | undefined;
      appel.mockImplementation((chemin: string, options?: RequestInit) => {
        if (chemin === '/factures/fac-1/annuler' && options?.method === 'POST') {
          return new Promise((_resoudre, rej) => {
            rejeter = rej;
          });
        }
        if (options?.method !== undefined && options.method !== 'GET') {
          return new Promise<never>(() => {});
        }
        if (chemin === '/factures') return Promise.resolve(listeFactures([resume()]) as never);
        if (chemin === '/factures/fac-1') return Promise.resolve(detail() as never);
        return new Promise<never>(() => {});
      });

      render(<Factures />);
      await screen.findByText('FA-2026-0042');
      await userEvent.click(screen.getByText('FA-2026-0042'));
      await screen.findByText('Farine T55 — sac 25 kg');

      await userEvent.type(
        screen.getByLabelText("Motif de l'annulation"),
        'Facture saisie deux fois',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Annuler la facture' }));

      const bouton = await screen.findByRole('button', { name: 'Annulation…' });
      expect(bouton).toBeDisabled();

      /*
        `annulerFactureSelectionnee` porte un garde-fou explicite
        (`motif === '' || etatAnnulation.statut === 'en_cours'`), mais rien
        n'atteint cette fonction hors de ce bouton `type="submit"` : aucun
        raccourci clavier n'est posé sur ce panneau (à la différence de
        `SaisieFacture`, plus bas dans ce fichier, qui écoute Ctrl+Entrée pour
        la NOUVELLE facture — un formulaire différent). Ce second clic ne
        mesure donc que le blocage NATIF du navigateur sur un bouton
        `disabled`, jamais le garde-fou applicatif lui-même.
      */
      fireEvent.click(bouton);
      const postsAnnulation = () =>
        appel.mock.calls.filter(
          ([c, o]) =>
            c === '/factures/fac-1/annuler' && (o as RequestInit | undefined)?.method === 'POST',
        );
      expect(postsAnnulation()).toHaveLength(1);

      // Refus serveur plutôt que succès : un succès VIDE le motif
      // (`setMotifAnnulation('')`), ce qui redésactive ce même bouton pour
      // une raison DIFFÉRENTE (champ obligatoire vide) — ça ne prouverait pas
      // qu'il redevient actionnable. Un refus laisse le motif intact : c'est
      // le seul chemin qui montre proprement le retour à l'état normal.
      rejeter?.(
        new ErreurApi('Cette facture est déjà en litige : contactez le fournisseur d’abord.', {
          code: 'facture_en_litige',
          statut: 409,
        }),
      );

      const revenu = await screen.findByRole('button', { name: 'Annuler la facture' });
      expect(revenu).toBeEnabled();
      expect(
        await screen.findByText(
          'Cette facture est déjà en litige : contactez le fournisseur d’abord.',
        ),
      ).toBeInTheDocument();
    },
  );
});

describe('Factures — changer le statut annonce sa mise à jour, et redevient actionnable', () => {
  it(
    '« Appliquer » passe à « Mise à jour… » (disabled) pendant le PATCH, un second clic n’envoie ' +
      'rien de plus, et le libellé revient après un refus serveur',
    async () => {
      let rejeter: ((raison: unknown) => void) | undefined;
      appel.mockImplementation((chemin: string, options?: RequestInit) => {
        if (chemin === '/factures/fac-1/statut' && options?.method === 'PATCH') {
          return new Promise((_resoudre, rej) => {
            rejeter = rej;
          });
        }
        if (options?.method !== undefined && options.method !== 'GET') {
          return new Promise<never>(() => {});
        }
        if (chemin === '/factures') return Promise.resolve(listeFactures([resume()]) as never);
        if (chemin === '/factures/fac-1') return Promise.resolve(detail() as never);
        return new Promise<never>(() => {});
      });

      render(<Factures />);
      await screen.findByText('FA-2026-0042');
      await userEvent.click(screen.getByText('FA-2026-0042'));
      await screen.findByText('Farine T55 — sac 25 kg');

      await userEvent.selectOptions(screen.getByLabelText('Statut'), 'rapprochee');
      await userEvent.click(screen.getByRole('button', { name: 'Appliquer' }));

      const bouton = await screen.findByRole('button', { name: 'Mise à jour…' });
      expect(bouton).toBeDisabled();

      /*
        `appliquerChangementStatut` porte, elle aussi, un garde-fou explicite
        (`statutChoisi === detail.statut || etatChangementStatut.statut ===
        'en_cours'`). Ce bouton n'est ni un `type="submit"` ni relié à un
        raccourci clavier : aucun geste ne le contourne, donc — comme pour
        « Annuler la facture » ci-dessus — un second clic ne mesure que le
        blocage NATIF sur `disabled`.
      */
      fireEvent.click(bouton);
      const patchs = () =>
        appel.mock.calls.filter(
          ([c, o]) =>
            c === '/factures/fac-1/statut' && (o as RequestInit | undefined)?.method === 'PATCH',
        );
      expect(patchs()).toHaveLength(1);

      rejeter?.(
        new ErreurApi('Cette transition de statut est refusée.', {
          code: 'transition_refusee',
          statut: 422,
        }),
      );

      const revenu = await screen.findByRole('button', { name: 'Appliquer' });
      expect(revenu).toBeEnabled();
      expect(
        await screen.findByText('Cette transition de statut est refusée.'),
      ).toBeInTheDocument();
    },
  );
});
