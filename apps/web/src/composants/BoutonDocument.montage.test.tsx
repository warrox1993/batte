/**
 * PREMIER test de ce dépôt à MONTER réellement un composant React.
 *
 * ═══ Pourquoi il est dans un fichier à part ═══
 *
 * `BoutonDocument.test.tsx`, à côté, teste le balisage par
 * `renderToStaticMarkup` et les fonctions pures. Il reste valable et n'a pas
 * été touché : vérifier qu'un `<button>` porte `type="button"` ne demande pas
 * de DOM. Ce fichier-ci couvre ce que l'autre ne POUVAIT pas voir — tout ce
 * qui se passe après le premier rendu.
 *
 * ═══ Ce que ce fichier prouve, et que rien ne prouvait avant ═══
 *
 * Le 01/08/2026, 78 emplacements de l'application ont cessé d'employer le
 * registre d'alerte MÉTIER (bordure et fond `depassement`) pour signaler une
 * panne technique. La distinction est réelle : une rupture de stock demande
 * un geste au porteur, une coupure réseau n'en demande aucun, et les mélanger
 * dilue le seul signal qui doit rester rare.
 *
 * `BoutonDocument` porte les DEUX cas dans le même état, et il a fallu les
 * séparer par `natureDuRefus`. Mais cet état ne s'atteint qu'après un clic et
 * une réponse du serveur : `renderToStaticMarkup` ne le voit jamais. La règle
 * était donc appliquée sans qu'aucun test puisse constater qu'elle l'était —
 * exactement le « vert par absence » que ce dépôt traque.
 *
 * Ce que ce fichier ne prouve toujours pas : que la couleur rendue est
 * LISIBLE, ni qu'elle correspond au jeton attendu une fois Tailwind compilé.
 * jsdom n'applique aucune feuille de style. Il prouve quelle CLASSE est
 * posée, ce qui est la décision ; le rendu visuel reste vérifié au navigateur.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ModuleApi from '../lib/api';

// Le module réseau est remplacé AVANT l'import du composant : `vi.mock` est
// remonté en tête de fichier par Vitest, mais `ErreurApi` doit rester la VRAIE
// classe — `natureDuRefus` fait un `instanceof` dessus, et une classe factice
// ferait passer tous les refus pour techniques, donc le test serait vert pour
// la mauvaise raison.
vi.mock('../lib/api', async (importerReel) => {
  // `import type * as …` et non `typeof import(...)` : la règle ESLint
  // `consistent-type-imports` interdit la seconde forme, et ce fichier sert de
  // MODÈLE — une faute recopiée ici se recopie partout.
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, telechargerFichierApi: vi.fn() };
});

const { ErreurApi, telechargerFichierApi } = await import('../lib/api');
const { BoutonDocument } = await import('./BoutonDocument');

const echoue = vi.mocked(telechargerFichierApi);

/** Classe du registre d'alerte MÉTIER, celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

beforeEach(() => {
  echoue.mockReset();
});

describe('BoutonDocument monté — le registre d’erreur suit la NATURE du refus', () => {
  it('un 422 garde le registre d’alerte métier : le porteur a un geste à faire', async () => {
    echoue.mockRejectedValue(
      new ErreurApi(
        "Aucun produit actif : l'affichette serait vide. Activez au moins un produit de la carte avant de l'éditer.",
        { code: 'aucun_produit_actif', statut: 422 },
      ),
    );

    render(<BoutonDocument chemin="/documents/affichette-allergenes" libelle="Éditer" />);
    await userEvent.click(screen.getByRole('button', { name: 'Éditer' }));

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Activez au moins un produit');
    expect(message.className).toContain(CLASSE_ALERTE_METIER);
  });

  it('un 500 passe au registre NEUTRE : il n’y a aucune décision à prendre', async () => {
    echoue.mockRejectedValue(
      new ErreurApi('Erreur inattendue du serveur.', { code: 'interne', statut: 500 }),
    );

    render(<BoutonDocument chemin="/documents/registre-afsca" libelle="Éditer" />);
    await userEvent.click(screen.getByRole('button', { name: 'Éditer' }));

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue du serveur.');
    // LE point du correctif : plus aucune couleur d'alerte métier ici.
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    expect(message.parentElement?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
  });

  it('une coupure réseau — même pas une ErreurApi — reste neutre elle aussi', async () => {
    echoue.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<BoutonDocument chemin="/exports/stock" libelle="Éditer" />);
    await userEvent.click(screen.getByRole('button', { name: 'Éditer' }));

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent("L'édition du document a échoué");
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
  });

  it('une raison d’indisponibilité reste MÉTIER, et n’appelle jamais le réseau', async () => {
    render(
      <BoutonDocument
        chemin="/documents/rapport-session/abc"
        libelle="Éditer le rapport"
        raisonIndisponible="Cette session est en statut « Planifiée » : le rapport n’est éditable qu’après clôture."
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Éditer le rapport' }));

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('n’est éditable qu’après clôture');
    expect(message.className).toContain(CLASSE_ALERTE_METIER);
    // Un bouton annoncé indisponible qui partirait quand même en requête
    // archiverait une version du document (D-026) pour rien.
    expect(echoue).not.toHaveBeenCalled();
  });

  /**
   * Le garde-fou D-026, qui n'avait jamais pu être prouvé automatiquement :
   * chaque appel ARCHIVE une version numérotée du document. Un double-clic ne
   * « régénère » pas, il archive DEUX fois — ce qui se voit sur un contrôle
   * AFSCA. Le verrou est une `ref` lue et écrite dans le même tour de boucle,
   * précisément parce que `setEtat` est asynchrone ; aucun rendu statique ne
   * pouvait en rendre compte.
   */
  it('un double-clic n’envoie QU’UNE requête — le verrou D-026 tient', async () => {
    let libere: (() => void) | undefined;
    echoue.mockImplementation(
      () =>
        new Promise((_, rejeter) => {
          libere = () => rejeter(new TypeError('Failed to fetch'));
        }),
    );

    render(<BoutonDocument chemin="/exports/stock" libelle="Éditer" />);
    const bouton = screen.getByRole('button', { name: /Éditer|Édition/ });

    await userEvent.click(bouton);
    await userEvent.click(bouton);

    expect(echoue).toHaveBeenCalledTimes(1);
    libere?.();
  });

  /**
   * Ce que RIEN, jusqu'ici, n'observait — même dans ce fichier : ni
   * `aria-disabled="true"`, ni `aria-busy="true"`, ni le libellé d'attente
   * PENDANT l'aller-retour. Le double-clic ci-dessus prouve le VERROU, pas
   * l'ANNONCE — il feint le réseau avec une promesse qui ne se résout JAMAIS,
   * ce qui montre bien l'état `en_cours` mais ne montre PAS le retour à l'état
   * de repos. Mesuré le 02/08/2026 (docs/39 §3, cinquième forme) : partout où
   * une promesse est déjà résolue au moment où le test l'observe, l'état en
   * vol retombe dans le même écoulement de micro-tâches que sa pose et
   * n'atteint jamais le DOM. Ici, une promesse CONTRÔLÉE, résolue par le test
   * lui-même APRÈS avoir observé l'attente.
   */
  it(
    'pendant la génération, `aria-disabled`/`aria-busy` sont posés et le libellé passe à ' +
      '« Édition… », puis tout revient à l’état de repos',
    async () => {
      let repondre: ((valeur: ModuleApi.FichierRecu) => void) | undefined;
      echoue.mockImplementation(
        () =>
          new Promise((resoudre) => {
            repondre = resoudre;
          }),
      );

      render(<BoutonDocument chemin="/exports/stock" libelle="Éditer" />);
      await userEvent.click(screen.getByRole('button', { name: 'Éditer' }));

      // 1. L'attente est ANNONCÉE : le libellé change, ET les deux attributs
      // ARIA sont posés — sans que le nœud sorte du DOM ni du parcours de
      // tabulation (ce n'est pas `disabled`, D-026 le justifie en tête de
      // fichier : archiver deux fois se voit sur un contrôle AFSCA).
      const enCours = await screen.findByRole('button', { name: 'Édition…' });
      expect(enCours).toHaveAttribute('aria-disabled', 'true');
      expect(enCours).toHaveAttribute('aria-busy', 'true');
      /*
        Ce que la ligne suivante PROUVE, et ce qu'elle NE prouve PAS : mesuré
        à la sonde le 02/08/2026, jsdom ne retire PAS le focus d'un `<button>`
        qui devient `disabled` NATIF — `toHaveFocus()` passerait donc ICI
        COMME avec un `disabled` natif, et ne distinguerait RIEN à elle seule.
        Elle est posée quand même parce que la production, ELLE, pose bien
        `aria-disabled` (jamais `disabled`) : le CONTRAT vérifié ici est donc
        le bon. Mais la conservation RÉELLE du focus au clavier — l'effet que
        ce contrat est censé produire dans un vrai navigateur — reste à
        vérifier au navigateur : jsdom ne calcule aucun style ni aucune
        politique de focus liée à `aria-disabled`.
      */
      expect(enCours).toHaveFocus();

      repondre?.({ contenu: new Blob(['contenu']), nomFichier: 'stock-2026-08-02.xlsx' });

      // 3. Après la réponse, tout redevient l'état de repos : le libellé
      // revient, et les deux attributs ARIA repassent à `false` — pas
      // seulement absents, ce qui distinguerait un oubli d'une remise à zéro.
      const revenu = await screen.findByRole('button', { name: 'Éditer' });
      expect(revenu).toHaveAttribute('aria-disabled', 'false');
      expect(revenu).toHaveAttribute('aria-busy', 'false');
    },
  );
});
