import { describe, expect, it } from 'vitest';
import {
  OPTIONS_MOTIF_ANNULATION,
  blocageAnnulationProduction,
  blocageAnnulationReception,
  phraseApresAnnulationProduction,
  phraseApresAnnulationReception,
  phraseAvantAnnulationProduction,
  phraseAvantAnnulationReception,
  phraseCommandeApresAnnulationReception,
} from './annulation';

/**
 * D-087 : câblage des deux annulations qui touchent des LOTS — donc le
 * registre AFSCA. Ce fichier teste les DÉCISIONS, extraites en fonctions
 * pures : ce que l'écran dit avant le clic, et ce qu'il dit après.
 *
 * CE QU'IL NE PROUVE PAS. Le dépôt n'a ni `jsdom` ni
 * `@testing-library/react` (CLAUDE.md §7, `vitest.config.ts`) : rien ici ne
 * prouve que `DetailLot.tsx` ou `Production.tsx` appellent réellement ces
 * fonctions, ni que le bouton disparaît à l'écran, ni que `.focus()` atteint
 * le nœud visé. Le rendu est couvert séparément par `BlocAnnulation.test.tsx`
 * (`renderToStaticMarkup`), et le reste par la recette manuelle du rapport de
 * livraison.
 */

describe('blocageAnnulationReception — ce que l’écran affiche À LA PLACE du bouton', () => {
  it('rend `null` — donc le bouton — sur une réception active', () => {
    expect(blocageAnnulationReception({ receptionStatut: 'active' })).toBeNull();
  });

  it('bloque une réception DÉJÀ annulée, en disant que les deux écritures restent au journal', () => {
    const blocage = blocageAnnulationReception({ receptionStatut: 'annulee' });
    expect(blocage?.raison).toContain('déjà annulée');
    expect(blocage?.raison).toContain('restent au journal');
  });

  it(
    'n’annonce JAMAIS un verrou de période : la garde existe côté serveur mais aucun chemin de ' +
      'production n’écrit `statut = verrouillee` — un avertissement pour un état qui ne peut pas ' +
      'survenir apprend à ignorer ceux qui le peuvent (docs/07 §3.5)',
    () => {
      expect(blocageAnnulationReception({ receptionStatut: 'active' })).toBeNull();
    },
  );
});

describe('blocageAnnulationProduction — les refus ANNONÇABLES d’`annulerProduction`', () => {
  it('rend `null` sur une production lancée, hors session clôturée', () => {
    expect(
      blocageAnnulationProduction({
        statut: 'lancee',
        sessionStatut: 'planifiee',
        sessionNumero: 'SM-2026-0002',
      }),
    ).toBeNull();
  });

  it('rend `null` sur une production TERMINÉE : l’erreur peut se découvrir après le réalisé', () => {
    expect(
      blocageAnnulationProduction({
        statut: 'terminee',
        sessionStatut: null,
        sessionNumero: null,
      }),
    ).toBeNull();
  });

  it('bloque une production déjà annulée', () => {
    const blocage = blocageAnnulationProduction({
      statut: 'annulee',
      sessionStatut: null,
      sessionNumero: null,
    });
    expect(blocage?.raison).toContain('déjà annulée');
  });

  it('bloque sur session clôturée et cite son numéro (D-024)', () => {
    const blocage = blocageAnnulationProduction({
      statut: 'lancee',
      sessionStatut: 'cloturee',
      sessionNumero: 'SM-2026-0002',
    });
    expect(blocage?.raison).toContain('SM-2026-0002');
    expect(blocage?.raison).toContain('clôturée');
  });

  it('sans numéro connu, dit « sa session » plutôt qu’un numéro inventé (CLAUDE.md §7)', () => {
    const blocage = blocageAnnulationProduction({
      statut: 'lancee',
      sessionStatut: 'cloturee',
      sessionNumero: null,
    });
    expect(blocage?.raison).toContain('sa session');
    expect(blocage?.raison).not.toContain('null');
  });

  it('le statut « annulée » passe AVANT la session clôturée : les deux peuvent être vrais', () => {
    const blocage = blocageAnnulationProduction({
      statut: 'annulee',
      sessionStatut: 'cloturee',
      sessionNumero: 'SM-2026-0001',
    });
    expect(blocage?.raison).toContain('déjà annulée');
  });
});

describe('phraseAvantAnnulationReception — le nombre de lots se dit AVANT, jamais après', () => {
  it('annonce le nombre de lots au pluriel, celui qu’on regarde compris, DEPUIS un lot', () => {
    const phrase = phraseAvantAnnulationReception({
      numero: 'RC-2026-0007',
      dateReception: '2026-07-22',
      nbLots: 3,
      depuisUnLot: true,
    });
    expect(phrase).toContain('RC-2026-0007');
    expect(phrase).toContain('3 lots');
    expect(phrase).toContain('celui-ci compris');
  });

  it(
    'ne dit PAS « celui-ci compris » depuis l’écran de saisie : aucun lot n’y est « celui-ci », ' +
      'la précision n’aurait aucun référent',
    () => {
      const phrase = phraseAvantAnnulationReception({
        numero: 'RC-2026-0007',
        dateReception: '2026-07-22',
        nbLots: 3,
        depuisUnLot: false,
      });
      expect(phrase).toContain('3 lots');
      expect(phrase).not.toContain('celui-ci');
    },
  );

  it('ne dit pas « 1 lots » : la réception à un seul lot a sa propre formulation', () => {
    const phrase = phraseAvantAnnulationReception({
      numero: 'RC-2026-0008',
      dateReception: '2026-07-22',
      nbLots: 1,
      depuisUnLot: true,
    });
    expect(phrase).toContain('unique lot');
    expect(phrase).not.toContain('1 lots');
    // La seconde phrase s'accorde : « un seul de ces lots » derrière « son
    // unique lot » désignerait un pluriel qui n'existe pas.
    expect(phrase).not.toContain('ces lots');
    expect(phrase).toContain('Si ce lot');
  });

  it('prévient du refus possible : un lot déjà consommé fait échouer l’annulation ENTIÈRE', () => {
    const phrase = phraseAvantAnnulationReception({
      numero: 'RC-2026-0007',
      dateReception: '2026-07-22',
      nbLots: 2,
      depuisUnLot: false,
    });
    expect(phrase).toContain('refusée');
  });
});

describe('phraseAvantAnnulationProduction — ce que le stock redevient, dit avant', () => {
  it('annonce que la matière revient dans SES lots d’origine, en écritures inverses', () => {
    const phrase = phraseAvantAnnulationProduction({ numero: 'PR-2026-0001' });
    expect(phrase).toContain('PR-2026-0001');
    expect(phrase).toContain("lots d'origine");
    expect(phrase).toContain('inverses');
  });

  it('dit que la production RESTE lisible, marquée annulée — « rien ne s’efface » (règle 7)', () => {
    const phrase = phraseAvantAnnulationProduction({ numero: 'PR-2026-0001' });
    expect(phrase).toContain('Annulée');
    expect(phrase).toContain('efface');
  });

  it('prévient que le réalisé déjà saisi est contrepassé avec le reste (fiche 9)', () => {
    expect(phraseAvantAnnulationProduction({ numero: 'PR-2026-0001' })).toContain('réalisé');
  });
});

describe('phraseCommandeApresAnnulationReception — `commandeId` et `commandeStatutRestaure` ne disent PAS la même chose', () => {
  it('rend `null` quand aucune commande n’était liée : rien n’est ajouté à la confirmation', () => {
    expect(
      phraseCommandeApresAnnulationReception({ commandeId: null, commandeStatutRestaure: null }),
    ).toBeNull();
  });

  it('dit à quel statut la commande a été REMISE quand il a pu être retrouvé', () => {
    expect(
      phraseCommandeApresAnnulationReception({
        commandeId: 'cmd-1',
        commandeStatutRestaure: 'envoyee',
      }),
    ).toContain('« envoyée »');
  });

  it(
    'CAS QUI COMPTE : une commande était liée mais son statut antérieur est INCONNU — la phrase ' +
      'le dit, au lieu de laisser croire qu’il ne s’est rien passé côté commande',
    () => {
      const phrase = phraseCommandeApresAnnulationReception({
        commandeId: 'cmd-1',
        commandeStatutRestaure: null,
      });
      expect(phrase).not.toBeNull();
      expect(phrase).toContain('« reçue »');
      expect(phrase).toContain('notes');
    },
  );
});

describe('phrases de confirmation — les chiffres viennent du serveur, jamais recalculés', () => {
  it('porte le nombre d’entrées contrepassées, au singulier comme au pluriel', () => {
    expect(
      phraseApresAnnulationReception({
        numero: 'RC-2026-0007',
        nbMouvementsContrepasses: 1,
        commandeId: null,
        commandeStatutRestaure: null,
      }),
    ).toContain('1 entrée contrepassée');
    expect(
      phraseApresAnnulationReception({
        numero: 'RC-2026-0007',
        nbMouvementsContrepasses: 3,
        commandeId: null,
        commandeStatutRestaure: null,
      }),
    ).toContain('3 entrées contrepassées');
  });

  it('recolle la mention de commande à la confirmation quand il y en a une', () => {
    expect(
      phraseApresAnnulationReception({
        numero: 'RC-2026-0007',
        nbMouvementsContrepasses: 2,
        commandeId: 'cmd-1',
        commandeStatutRestaure: 'validee',
      }),
    ).toContain('« validée »');
  });

  it('la confirmation de production dit que la matière est revenue dans SES lots d’origine', () => {
    const phrase = phraseApresAnnulationProduction({
      numero: 'PR-2026-0001',
      nbMouvementsContrepasses: 5,
    });
    expect(phrase).toContain('PR-2026-0001');
    expect(phrase).toContain('5 mouvements contrepassés');
    expect(phrase).toContain("lots d'origine");
  });
});

describe('OPTIONS_MOTIF_ANNULATION — un motif choisi au catalogue, jamais tapé', () => {
  it('propose exactement les motifs d’AJUSTEMENT du catalogue partagé', () => {
    expect(OPTIONS_MOTIF_ANNULATION.map((o) => o.valeur)).toEqual([
      'INVENTAIRE_ECART',
      'ERREUR_SAISIE',
    ]);
  });

  it('porte le libellé lisible de « Correction d’une erreur de saisie »', () => {
    const correction = OPTIONS_MOTIF_ANNULATION.find((o) => o.valeur === 'ERREUR_SAISIE');
    expect(correction?.libelle).toBe("Correction d'une erreur de saisie");
  });
});
