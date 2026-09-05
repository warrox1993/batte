import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlocAnnulation } from './BlocAnnulation';
import { AUCUNE_ERREUR } from './champs';

/**
 * `BlocAnnulation` — le bloc partagé par les deux annulations que D-087 a
 * trouvées débranchées : la réception (depuis `DetailLot.tsx`) et la
 * production (depuis `pages/Production.tsx`).
 *
 * Ce qui est vérifié ici est exactement ce que la mission exige de l'écran :
 * un refus connu d'avance est DIT à la place du bouton, la conséquence est
 * lue AVANT la confirmation, et le motif est choisi au catalogue.
 *
 * Rendu par `renderToStaticMarkup` (react-dom, déjà présent) : ni `jsdom` ni
 * `@testing-library/react` ne sont installés (CLAUDE.md §7). CE QUE ÇA NE
 * PROUVE PAS : aucun clic n'est simulé, aucun effet React n'est exécuté, et
 * `document.activeElement` n'existe pas — donc rien ici ne prouve que le
 * focus va où il doit après une annulation. Seule la recette manuelle le
 * montre.
 */

const PROPRIETES_COMMUNES = {
  titre: "Réception d'origine",
  identite: <span>RC-2026-0007 du 22/07/2026 — 3 lots</span>,
  libelleOuverture: 'Annuler la réception…',
  phraseAvant: 'Annuler la réception RC-2026-0007 contrepassera les entrées de ses 3 lots.',
  libelleConfirmation: 'Annuler la réception',
  nomChampMotif: 'motif-annulation-reception',
  motif: '',
  onMotifChange: () => undefined,
  onOuvrir: () => undefined,
  onFermer: () => undefined,
  onConfirmer: () => undefined,
  erreurs: AUCUNE_ERREUR,
  enCours: false,
};

describe('BlocAnnulation — fermé', () => {
  it('propose le bouton d’ouverture quand rien ne bloque', () => {
    const balisage = renderToStaticMarkup(
      <BlocAnnulation {...PROPRIETES_COMMUNES} blocage={null} ouvert={false} />,
    );
    expect(balisage).toContain('Annuler la réception…');
    expect(balisage).toContain('RC-2026-0007');
  });

  it(
    'REMPLACE le bouton par la raison quand l’annulation est impossible — un bouton qui échoue ' +
      'toujours est le même défaut qu’un avertissement absent',
    () => {
      const balisage = renderToStaticMarkup(
        <BlocAnnulation
          {...PROPRIETES_COMMUNES}
          blocage={{ raison: 'Période 06/2026 verrouillée : cette réception ne peut plus…' }}
          ouvert={false}
        />,
      );
      expect(balisage).toContain('Période 06/2026 verrouillée');
      expect(balisage).not.toContain('Annuler la réception…');
    },
  );

  it('n’affiche PAS la conséquence tant que la confirmation n’est pas ouverte', () => {
    const balisage = renderToStaticMarkup(
      <BlocAnnulation {...PROPRIETES_COMMUNES} blocage={null} ouvert={false} />,
    );
    expect(balisage).not.toContain('contrepassera');
  });
});

describe('BlocAnnulation — ouvert', () => {
  function ouvert(surcharges: Partial<Parameters<typeof BlocAnnulation>[0]> = {}): string {
    return renderToStaticMarkup(
      <BlocAnnulation {...PROPRIETES_COMMUNES} blocage={null} ouvert {...surcharges} />,
    );
  }

  it('lit la conséquence AVANT de confirmer, avec le nombre de lots', () => {
    expect(ouvert()).toContain('contrepassera les entrées de ses 3 lots');
  });

  it('propose les motifs d’ajustement du catalogue, jamais un champ libre', () => {
    const balisage = ouvert();
    expect(balisage).toContain('ERREUR_SAISIE');
    expect(balisage).toContain('INVENTAIRE_ECART');
    expect(balisage).toContain('<select');
    expect(balisage).toContain('Choisir…');
  });

  it('n’est PAS un <form> : une action irréversible ne part jamais sur `Entrée`', () => {
    expect(ouvert()).not.toContain('<form');
  });

  it('affiche le bouton de confirmation et un retour arrière explicite', () => {
    const balisage = ouvert();
    expect(balisage).toContain('Annuler la réception<');
    expect(balisage).toContain('Fermer');
  });

  it('marque le bouton occupé pendant l’écriture, sans changer sa largeur de libellé au hasard', () => {
    const balisage = ouvert({ enCours: true });
    expect(balisage).toContain('Annulation…');
    expect(balisage).toContain('disabled');
  });

  it(
    'affiche le refus du serveur TEL QUEL, en français — c’est lui qui porte le nom du lot et ' +
      'la quantité manquante (`entree_deja_consommee`)',
    () => {
      const balisage = ouvert({
        erreurs: {
          champs: {},
          general:
            'Farine de froment T55 : il ne reste que 5,0 kg sur ce lot, pour une entrée de 10,0 kg.',
        },
      });
      expect(balisage).toContain('il ne reste que 5,0 kg sur ce lot');
      expect(balisage).toContain('role="alert"');
    },
  );

  it('affiche l’erreur de motif SOUS le champ, jamais en plus dans un bandeau (docs/07 §4.7)', () => {
    const balisage = ouvert({
      erreurs: { champs: { motifCode: 'Choisissez un motif dans la liste.' }, general: null },
    });
    expect(balisage).toContain('Choisissez un motif dans la liste.');
    expect(balisage).not.toContain('role="alert"');
  });
});
