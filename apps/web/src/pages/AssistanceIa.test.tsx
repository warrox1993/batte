import { describe, expect, it } from 'vitest';
import type { EtatIa } from '@batte/core';
import { resumerBudgetIa } from './AssistanceIa';

/**
 * `resumerBudgetIa` (mission « garde-fou de dépense », audit du 30/07/2026) :
 * CLAUDE.md §5 exige un plafond mensuel consultable, et CLAUDE.md §7 impose
 * qu'une valeur inconnue s'écrive `null`, jamais `0`. Le contrat HTTP
 * (`schemaEtatIa`, `packages/core/src/contrats/ia.ts`) ne laisse pourtant
 * aucune place à `null` sur `depenseDuMoisCents` : la colonne est calculée par
 * `COALESCE(SUM(...), 0)` côté base (`packages/db/src/depots/ia.ts:72`), donc
 * TOUJOURS un entier, y compris quand la table est vide pour le mois. Seul
 * `nbAppelsDuMois` porte l'information qui permet de distinguer « personne n'a
 * rien dépensé » de « aucun appel n'a eu lieu, la question ne se pose même
 * pas » — c'est exactement ce que cette fonction décide, sans recalculer le
 * moindre montant (ils sont repris tels quels du contrat).
 *
 * `AssistanceIa` (le composant, avec son `useEffect` et son `fetch`) n'est
 * PAS monté ici : ce fichier teste des fonctions pures. Ce que ces tests NE
 * prouvent PAS :
 * que l'écran appelle bien `GET /api/ia/etat` et `GET /api/ia/journal`, que le
 * JSX affiche réellement la bonne branche à l'écran, ni le rendu du tableau
 * du journal des appels (`COLONNES`) — seule la DÉCISION en amont du rendu est
 * vérifiée ici.
 */

function etat(partiel: Partial<EtatIa>): EtatIa {
  return {
    configuree: false,
    plafondMensuelCents: 500,
    depenseDuMoisCents: 0,
    resteCents: 500,
    nbAppelsDuMois: 0,
    ...partiel,
  };
}

describe('resumerBudgetIa — jamais confondre « aucun appel » et « 0,00 € dépensés »', () => {
  it(
    'rend `{ statut: "aucun_appel" }` quand `nbAppelsDuMois` vaut 0, même si ' +
      '`depenseDuMoisCents` vaut aussi 0 — ce sont les MÊMES chiffres bruts que le cas ' +
      '« appels journalisés à coût nul » ci-dessous, seul `nbAppelsDuMois` les distingue',
    () => {
      const resume = resumerBudgetIa(
        etat({ configuree: true, nbAppelsDuMois: 0, depenseDuMoisCents: 0 }),
      );
      expect(resume.depense).toEqual({ statut: 'aucun_appel' });
    },
  );

  it(
    'rend `{ statut: "montant", depenseDuMoisCents: 0, ... }` — jamais `aucun_appel` — ' +
      'quand des appels existent mais ont tous coûté 0 (échecs journalisés avant tout ' +
      'appel réseau facturé, `apps/api/src/ia/client.ts` catch) : ce sont des appels RÉELS, ' +
      'pas une absence de donnée',
    () => {
      const resume = resumerBudgetIa(
        etat({ configuree: true, nbAppelsDuMois: 3, depenseDuMoisCents: 0 }),
      );
      expect(resume.depense).toEqual({
        statut: 'montant',
        depenseDuMoisCents: 0,
        nbAppelsDuMois: 3,
      });
    },
  );

  it('rend le montant réel et le nombre d’appels quand une dépense existe', () => {
    const resume = resumerBudgetIa(
      etat({ configuree: true, nbAppelsDuMois: 5, depenseDuMoisCents: 234 }),
    );
    expect(resume.depense).toEqual({
      statut: 'montant',
      depenseDuMoisCents: 234,
      nbAppelsDuMois: 5,
    });
  });

  it(
    'ne recalcule ni le plafond ni le reste : ils sont repris TELS QUELS du contrat, ' +
      'aucune arithmétique de plus (CLAUDE.md §3 règle 1 — aucun calcul métier hors ' +
      '`packages/core`)',
    () => {
      const resume = resumerBudgetIa(
        etat({
          plafondMensuelCents: 1000,
          resteCents: 766,
          depenseDuMoisCents: 234,
          nbAppelsDuMois: 5,
        }),
      );
      expect(resume.plafondMensuelCents).toBe(1000);
      expect(resume.resteCents).toBe(766);
    },
  );

  it(
    '`configuree` reste un fait INDÉPENDANT de la dépense du mois : une clé retirée en ' +
      'cours de mois ne doit pas effacer les appels réellement passés plus tôt ce mois-ci',
    () => {
      const resume = resumerBudgetIa(
        etat({ configuree: false, nbAppelsDuMois: 2, depenseDuMoisCents: 50 }),
      );
      expect(resume.configuree).toBe(false);
      expect(resume.depense).toEqual({
        statut: 'montant',
        depenseDuMoisCents: 50,
        nbAppelsDuMois: 2,
      });
    },
  );

  it('assistance non configurée et aucun appel ce mois-ci : les deux états coexistent sans conflit', () => {
    const resume = resumerBudgetIa(etat({ configuree: false, nbAppelsDuMois: 0 }));
    expect(resume.configuree).toBe(false);
    expect(resume.depense).toEqual({ statut: 'aucun_appel' });
  });
});
