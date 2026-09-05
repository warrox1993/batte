/**
 * `BoutonDocument` — le chemin qui RÉUSSIT, c'est-à-dire la remise du fichier.
 *
 * ═══ Ce que ce fichier ajoute aux deux voisins ═══
 *
 * `BoutonDocument.test.tsx` couvre le balisage et les fonctions pures ;
 * `BoutonDocument.montage.test.tsx` couvre les REFUS (métier contre technique)
 * et le verrou anti-double-clic. Les deux restent valables et ne sont pas
 * touchés.
 *
 * Aucun des deux ne va jusqu'au bout du cas nominal : mesure du 01/08/2026,
 * `remettreAuNavigateur` (lignes 104-115) et le retour à l'état inactif
 * (ligne 180) n'étaient exécutés par aucun test. Autrement dit, la seule
 * fonction du composant — livrer le fichier — était la seule chose que
 * personne ne vérifiait, alors que ses trois échecs l'étaient tous.
 *
 * Ce n'est pas une coquetterie de couverture. Cette fonction contient une
 * exigence de navigateur que rien ne rappelle à la relecture : **l'ancre doit
 * appartenir au document** pour que le clic synthétique compte sur Firefox, un
 * `click()` sur un nœud détaché y étant ignoré. Un refactor qui « simplifie »
 * en retirant l'`appendChild` marche sur Chrome et casse silencieusement le
 * téléchargement sur Firefox.
 *
 * ═══ Piège d'environnement ═══
 *
 * jsdom n'implémente ni `URL.createObjectURL` ni `URL.revokeObjectURL` : elles
 * valent `undefined` et lèvent au premier appel. On les pose donc ici — ce qui
 * les rend du même coup observables, et permet de vérifier que l'URL objet est
 * bien LIBÉRÉE (sans quoi le blob resterait en mémoire tant que l'onglet est
 * ouvert, sur un poste qu'on laisse ouvert plusieurs jours).
 *
 * ═══ Ce que ce fichier ne prouve pas ═══
 *
 * Que le fichier atterrisse réellement dans le dossier de téléchargement :
 * jsdom n'écrit rien sur le disque. Il prouve que l'ancre est correctement
 * formée, attachée, cliquée, retirée, et l'URL libérée.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Import de TYPE seulement : il est effacé à la compilation, donc il ne
// déclenche aucun chargement du module avant le `vi.mock` ci-dessous. La forme
// `importerReel<typeof import('../lib/api')>()` employée ailleurs fait la même
// chose mais viole `@typescript-eslint/consistent-type-imports` — voir le
// rapport de mission.
import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, telechargerFichierApi: vi.fn() };
});

const { telechargerFichierApi } = await import('../lib/api');
const { BoutonDocument } = await import('./BoutonDocument');

const telecharger = vi.mocked(telechargerFichierApi);

let creerUrl: ReturnType<typeof vi.fn>;
let libererUrl: ReturnType<typeof vi.fn>;

beforeEach(() => {
  telecharger.mockReset();
  creerUrl = vi.fn(() => 'blob:faux-objet-url');
  libererUrl = vi.fn();
  // Absentes de jsdom : on les POSE, on ne les remplace pas.
  (URL as unknown as Record<string, unknown>).createObjectURL = creerUrl;
  (URL as unknown as Record<string, unknown>).revokeObjectURL = libererUrl;
});

afterEach(() => {
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  vi.useRealTimers();
});

function documentRecu() {
  return {
    contenu: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
    nomFichier: 'registre_afsca_2026-06_v1_20260728-2033.pdf',
  };
}

describe('BoutonDocument — la remise du fichier au navigateur', () => {
  it('crée une ancre de téléchargement portant le nom DONNÉ PAR LE SERVEUR', async () => {
    const utilisateur = userEvent.setup();
    telecharger.mockResolvedValue(documentRecu());

    // On observe le `click` de l'ancre plutôt que de la chercher dans le DOM :
    // elle est retirée immédiatement après, donc introuvable ensuite.
    const ancresCliquees: { href: string; download: string; attachee: boolean }[] = [];
    const clicOriginal = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function intercepte(this: HTMLAnchorElement) {
      ancresCliquees.push({
        href: this.href,
        download: this.download,
        // LE point : sur Firefox, un `click()` sur un nœud détaché est ignoré.
        attachee: document.body.contains(this),
      });
    };

    try {
      render(<BoutonDocument chemin="/documents/registre-afsca" libelle="Éditer" />);
      await utilisateur.click(screen.getByRole('button', { name: 'Éditer' }));

      await waitFor(() => expect(ancresCliquees).toHaveLength(1));
      expect(ancresCliquees[0]?.download).toBe('registre_afsca_2026-06_v1_20260728-2033.pdf');
      expect(ancresCliquees[0]?.href).toContain('blob:faux-objet-url');
      expect(ancresCliquees[0]?.attachee).toBe(true);
    } finally {
      HTMLAnchorElement.prototype.click = clicOriginal;
    }
  });

  it('ne laisse aucune ancre derrière elle dans le document', async () => {
    const utilisateur = userEvent.setup();
    telecharger.mockResolvedValue(documentRecu());

    render(<BoutonDocument chemin="/exports/stock" libelle="Éditer" />);
    await utilisateur.click(screen.getByRole('button', { name: 'Éditer' }));

    // Sans le `remove()`, chaque édition laisserait une ancre invisible de plus
    // dans la page — et autant de cibles de tabulation fantômes.
    await waitFor(() => expect(creerUrl).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('libère l’URL objet, mais DIFFÉRÉE — le blob ne reste pas en mémoire', async () => {
    /*
     * Ce test attend le vrai délai (1 s) au lieu de simuler l'horloge, et
     * c'est délibéré. Deux dispositifs plus rapides ont été essayés et
     * ÉCARTÉS, tous deux parce qu'ils rendaient le fichier entier instable :
     *
     *  - les horloges simulées de Vitest figent la file de micro-tâches dont
     *    `userEvent` et la promesse de téléchargement dépendent : interblocage ;
     *  - remplacer `window.setTimeout` prive `waitFor` de son propre minuteur.
     *    Pire, quand le test expire, Vitest rejette sa promesse en laissant la
     *    fonction suspendue sur son `await` — le `finally` de restauration ne
     *    s'exécute JAMAIS, et le remplacement fuit sur les tests suivants, qui
     *    échouent à leur tour pour une raison qui n'est pas la leur.
     *
     * Une seconde d'attente sur un test est un prix acceptable ; un fichier
     * dont trois tests s'accusent mutuellement ne l'est pas.
     */
    const utilisateur = userEvent.setup();
    telecharger.mockResolvedValue(documentRecu());

    render(<BoutonDocument chemin="/documents/registre-afsca" libelle="Éditer" />);
    await utilisateur.click(screen.getByRole('button', { name: 'Éditer' }));

    await waitFor(() => expect(creerUrl).toHaveBeenCalledTimes(1));
    // Pas immédiatement : libérer l'URL avant que le navigateur ait lu le blob
    // annulerait le téléchargement.
    expect(libererUrl).not.toHaveBeenCalled();

    await waitFor(() => expect(libererUrl).toHaveBeenCalledWith('blob:faux-objet-url'), {
      timeout: 4000,
    });
  }, 10_000);

  it('revient à l’état actif : deux documents s’éditent d’affilée', async () => {
    // Le retour à `statut: 'inactif'` (ligne 180), jamais exercé. S'il
    // manquait, le bouton resterait affiché « Édition… » à vie et il faudrait
    // recharger l'écran entre deux documents.
    const utilisateur = userEvent.setup();
    telecharger.mockResolvedValue(documentRecu());

    render(<BoutonDocument chemin="/documents/registre-afsca" libelle="Éditer" />);
    const bouton = screen.getByRole('button', { name: /Éditer|Édition/ });

    await utilisateur.click(bouton);
    await waitFor(() => expect(bouton).toHaveAttribute('aria-busy', 'false'));

    await utilisateur.click(bouton);
    await waitFor(() => expect(telecharger).toHaveBeenCalledTimes(2));

    // Et aucun message d'erreur n'est apparu sur le chemin nominal.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('n’affiche aucune erreur résiduelle après un échec suivi d’une réussite', async () => {
    const utilisateur = userEvent.setup();
    render(<BoutonDocument chemin="/documents/registre-afsca" libelle="Éditer" />);
    const bouton = screen.getByRole('button', { name: /Éditer|Édition/ });

    telecharger.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await utilisateur.click(bouton);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    // Un message d'échec qui SURVIT à la réussite suivante ferait croire que
    // le document n'a pas été édité alors qu'il vient de l'être.
    telecharger.mockResolvedValue(documentRecu());
    await utilisateur.click(bouton);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
