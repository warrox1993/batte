import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { JourCalendaire, SemaineCalendaire } from '@batte/core';
import { phraseQuantitesAlerteReappro, SemainePanneau } from './PrevisionCalendaire';

/**
 * `SemainePanneau` est le SEUL endroit qui lit `jour.exploitable` et
 * `semaine.crepesPrevues` (docs/demandes/06, `packages/core/src/prevision/
 * horizon.ts` : `intervalleExploitable`). Ce fichier ne monte pas l'écran :
 * même convention que `ExplicationPrevision` dans `ProchaineSession.test.tsx` —
 * on rend le composant PUR via `renderToStaticMarkup` et on vérifie le texte
 * réellement présent dans le balisage.
 *
 * Deux vérifications distinctes, jamais confondues :
 *  - par JOUR : `exploitable: false` doit remplacer le chiffre par
 *    l'explication (déjà en place avant cette mission) ;
 *  - par SEMAINE : `semaine.crepesPrevues` additionne les jours du groupe
 *    SANS filtrer sur `exploitable` (voir le rapport de livraison) — le
 *    titre ne doit donc afficher ce total comme un chiffre solide que si
 *    TOUS les jours du groupe sont exploitables (correctif de cette
 *    mission : avant, le titre affichait toujours le total, même quand un
 *    des jours qui le compose était déclaré sans valeur par le moteur).
 */

function jour(partiel: Partial<JourCalendaire>): JourCalendaire {
  return {
    dateSession: '2026-08-02',
    lieuNom: 'La Batte',
    sessionId: null,
    horizonJours: 3,
    bandeHorizon: 'fiable',
    confianceHorizonBp: 9000,
    exploitable: true,
    demandeAttendue: 100,
    p10: 80,
    p50: 100,
    p90: 120,
    crepesRecommandees: 110,
    evenements: [],
    ...partiel,
  };
}

function semaine(partiel: Partial<SemaineCalendaire>): SemaineCalendaire {
  return {
    debutSemaine: '2026-08-02',
    finSemaine: '2026-08-08',
    crepesPrevues: 110,
    jours: [jour({})],
    besoinsIngredients: [],
    ...partiel,
  };
}

describe('SemainePanneau — chiffre par jour', () => {
  it('affiche le chiffre et la fourchette quand le jour est exploitable', () => {
    const balisage = renderToStaticMarkup(<SemainePanneau semaine={semaine({})} />);
    expect(balisage).toContain('110 crêpes (80 à 120)');
    expect(balisage).not.toContain('Trop incertain à cet horizon pour guider une décision.');
  });

  it('remplace le chiffre par l’explication quand le jour est inexploitable', () => {
    const s = semaine({ jours: [jour({ exploitable: false })] });
    const balisage = renderToStaticMarkup(<SemainePanneau semaine={s} />);
    expect(balisage).not.toContain('110 crêpes (');
    expect(balisage).toContain('Trop incertain à cet horizon pour guider une décision.');
  });
});

describe('SemainePanneau — total agrégé du titre', () => {
  it('affiche le total en chiffre quand TOUS les jours de la semaine sont exploitables', () => {
    const s = semaine({
      crepesPrevues: 240,
      jours: [
        jour({ dateSession: '2026-08-02', exploitable: true }),
        jour({ dateSession: '2026-08-03', exploitable: true }),
      ],
    });
    const balisage = renderToStaticMarkup(<SemainePanneau semaine={s} />);
    expect(balisage).toContain('240 crêpes prévues');
  });

  it(
    'remplace le total par une phrase honnête dès qu’UN jour de la semaine est ' +
      'inexploitable — le total additionne ce jour sans le filtrer',
    () => {
      const s = semaine({
        crepesPrevues: 240,
        jours: [
          jour({ dateSession: '2026-08-02', exploitable: true }),
          jour({ dateSession: '2026-08-03', exploitable: false }),
        ],
      });
      const balisage = renderToStaticMarkup(<SemainePanneau semaine={s} />);
      expect(balisage).not.toContain('crêpes prévues');
      expect(balisage).toContain('total trop incertain à cet horizon');
    },
  );

  it('remplace le total quand AUCUN jour de la semaine n’est exploitable', () => {
    const s = semaine({
      crepesPrevues: 300,
      jours: [jour({ exploitable: false })],
    });
    const balisage = renderToStaticMarkup(<SemainePanneau semaine={s} />);
    expect(balisage).not.toContain('300 crêpes prévues');
    expect(balisage).toContain('total trop incertain à cet horizon');
  });
});

/**
 * `phraseQuantitesAlerteReappro` (docs/21-CHAMPS-NON-LUS.md §5, candidats non
 * vérifiés individuellement par l'audit, vérifiés ici) : `besoinProjeteFenetre`,
 * `stockProjeteActuel` et `deficit` étaient calculés, testés, servis par
 * `GET /prevision-calendaire`, et jamais lus par cet écran — seule la phrase
 * QUALITATIVE (`explication`) était affichée, jamais la magnitude du manque.
 */
describe('phraseQuantitesAlerteReappro — la magnitude derrière le « pourquoi »', () => {
  it('complète l’explication avec les trois quantités, dans l’unité de l’ingrédient', () => {
    const phrase = phraseQuantitesAlerteReappro({
      explication: 'Un pic de demande projeté dépasse le stock projeté : commandez Farine T55.',
      besoinProjeteFenetre: 3200,
      stockProjeteActuel: 1100,
      deficit: 2100,
      unite: 'g',
    });

    // `formaterQuantite` (packages/core/src/unites.ts) bascule en kg au-delà
    // de 1000 g pour LES TROIS quantités, pas seulement le déficit — un piège
    // mesuré en écrivant ce test : 1100 g s'affiche « 1,1 kg », jamais « 1 100 g ».
    expect(phrase.startsWith('Un pic de demande projeté')).toBe(true);
    expect(phrase).toContain('besoin projeté 3,2 kg');
    expect(phrase).toContain('stock projeté 1,1 kg');
    expect(phrase).toContain('déficit 2,1 kg');
  });

  it(
    'affiche un déficit à ZÉRO comme une vraie valeur quand seul le déclencheur réactif a sonné ' +
      '(deficit = max(0, besoin − stock), jamais un inconnu déguisé)',
    () => {
      const phrase = phraseQuantitesAlerteReappro({
        explication:
          'Consommation récente déjà sous le point de commande habituel : commandez Lait.',
        besoinProjeteFenetre: 500,
        stockProjeteActuel: 800,
        deficit: 0,
        unite: 'ml',
      });

      expect(phrase).toContain('déficit 0 ml');
    },
  );

  it('ne répète jamais l’avertissement de jours exclus : il vit déjà dans `explication`', () => {
    const explicationAvecAvertissement =
      'Stock projeté suffisant sur la fenêtre de commande (J+3 à J+10). Attention : 2 jours de ' +
      'la fenêtre étaient trop incertains pour être comptés — le besoin réel peut être supérieur à ce chiffre.';
    const phrase = phraseQuantitesAlerteReappro({
      explication: explicationAvecAvertissement,
      besoinProjeteFenetre: 100,
      stockProjeteActuel: 400,
      deficit: 0,
      unite: 'piece',
    });

    // L'avertissement d'origine doit survivre tel quel...
    expect(phrase).toContain(explicationAvecAvertissement);
    // ...et n'apparaître qu'UNE fois : la fonction ajoute les quantités, elle
    // ne reconstruit jamais elle-même une phrase sur `joursExclusFenetre`.
    expect(phrase.split('Attention :').length - 1).toBe(1);
  });
});
