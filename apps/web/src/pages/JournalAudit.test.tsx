import { describe, expect, it } from 'vitest';
import { TIRET_ABSENT } from '@batte/core';
import { differencesAudit, formaterValeurAudit } from './JournalAudit';

/**
 * Le journal fige la ligne ENTIÈRE à chaque geste. C'est le bon choix — une
 * valeur seule ne se relit pas sans sa clé ni sa période de validité — mais
 * cela veut dire que l'écran reçoit deux objets de vingt champs pour signaler
 * qu'un seul a bougé. `differencesAudit` est ce qui rend le journal LISIBLE :
 * sans elle, la réponse à « qui a changé ce seuil, et quand ? » est enterrée
 * sous dix-neuf champs identiques.
 */
describe('differencesAudit', () => {
  it('ne retient que les champs dont la valeur a réellement changé', () => {
    const differences = differencesAudit(
      { id: 'p1', cle: 'seuil_tva_cents', valeur: '2500000', source: 'SPF Finances' },
      { id: 'p1', cle: 'seuil_tva_cents', valeur: '2600000', source: 'SPF Finances' },
    );

    expect(differences).toEqual([{ champ: 'valeur', avant: '2500000', apres: '2600000' }]);
  });

  it('écarte `modifie_le`, qui change à chaque modification par construction', () => {
    // Le signaler à chaque entrée n'apprend rien de plus que la date de
    // l'entrée elle-même, déjà en colonne — et il masquerait le vrai
    // changement quand celui-ci est le seul autre champ.
    const differences = differencesAudit(
      { valeur: '10', modifie_le: '2026-01-01T00:00:00.000Z' },
      { valeur: '11', modifie_le: '2026-07-28T09:00:00.000Z' },
    );

    expect(differences.map((d) => d.champ)).toEqual(['valeur']);
  });

  it('traite une création comme l’apparition de tous ses champs renseignés', () => {
    const differences = differencesAudit(null, { id: 'f1', nom: 'Moulin de Statte' });

    expect(differences).toHaveLength(2);
    expect(differences.every((d) => d.avant === TIRET_ABSENT)).toBe(true);
  });

  it('signale un champ apparu ou disparu, pas seulement un champ modifié', () => {
    const differences = differencesAudit({ dlc: '2026-08-01' }, { dlc: null });

    expect(differences).toEqual([{ champ: 'dlc', avant: '2026-08-01', apres: TIRET_ABSENT }]);
  });

  it('rend une liste vide quand rien n’a bougé', () => {
    expect(differencesAudit({ a: 1 }, { a: 1 })).toEqual([]);
    expect(differencesAudit(null, null)).toEqual([]);
  });

  it('trie par nom de champ : deux lectures du même journal se lisent pareil', () => {
    const differences = differencesAudit({ zeta: 1, alpha: 1 }, { zeta: 2, alpha: 2 });

    expect(differences.map((d) => d.champ)).toEqual(['alpha', 'zeta']);
  });
});

describe('formaterValeurAudit', () => {
  it('écrit l’absence avec le tiret, jamais « null »', () => {
    // Le journal se relit par quelqu'un qui n'a pas écrit le schéma.
    expect(formaterValeurAudit(null)).toBe(TIRET_ABSENT);
    expect(formaterValeurAudit(undefined)).toBe(TIRET_ABSENT);
    expect(formaterValeurAudit('')).toBe(TIRET_ABSENT);
  });

  it('écrit un booléen en français', () => {
    expect(formaterValeurAudit(true)).toBe('oui');
    expect(formaterValeurAudit(false)).toBe('non');
  });

  it('rend un nombre tel quel, sans mise en forme monétaire', () => {
    // Un instantané porte des centimes ENTIERS et des grammes : les habiller en
    // euros ici ferait dire au journal autre chose que ce qui est en base.
    expect(formaterValeurAudit(2500000)).toBe('2500000');
    expect(formaterValeurAudit(0)).toBe('0');
  });

  it('rend un objet en JSON brut plutôt qu’un résumé qui perd l’information', () => {
    expect(formaterValeurAudit({ gluten: true })).toBe('{"gluten":true}');
    expect(formaterValeurAudit(['gluten', 'lait'])).toBe('["gluten","lait"]');
  });
});
