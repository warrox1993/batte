import { describe, expect, it } from 'vitest';
import { cleMouvementAFocaliserApresContrepassation } from './DetailLot';

/**
 * Recette clavier du 30/07/2026 (D-079 / docs/22-FOCUS-DETRUIT.md §2.1) : le
 * focus retombait sur `<body>` après un changement de statut de lot ou une
 * contrepassation de mouvement déclenchés depuis `<DetailLot>`, le plus
 * coûteux des trois défauts du sweep — Stock est l'écran le plus utilisé.
 *
 * Ni `jsdom` ni `@testing-library/react` ne sont installés (CLAUDE.md §7,
 * voir `vitest.config.ts`) : on ne peut pas observer `document.activeElement`
 * ni simuler un clic réel. Ce fichier prouve uniquement la DÉCISION — quel
 * mouvement devient la prochaine cible après une contrepassation — extraite
 * en fonction pure, même discipline que `cleAFocaliserApresRetrait`
 * (`SaisieReception.tsx`) et `cleEcheanceAFocaliserApresPointage`
 * (`Comptabilite.tsx`). Il ne prouve PAS que `DetailLot.tsx` appelle bien
 * `.focus()` sur le bon nœud DOM, ni que `data-mouvement` désigne
 * effectivement ce nœud dans le rendu réel, ni que l'effet des lots de
 * `Stock.tsx` (corrigé pour ne plus transiter par `'chargement'`) empêche
 * bien le démontage en pratique dans un navigateur : seule une recette
 * manuelle (ou un futur test avec navigateur) peut fermer ces boucles-là.
 */

type MouvementTest = {
  readonly id: string;
  readonly isAnnule: boolean;
  readonly estContrepassation: boolean;
};

function mouvement(
  id: string,
  options: { readonly isAnnule?: boolean; readonly estContrepassation?: boolean } = {},
): MouvementTest {
  return {
    id,
    isAnnule: options.isAnnule ?? false,
    estContrepassation: options.estContrepassation ?? false,
  };
}

describe('cleMouvementAFocaliserApresContrepassation — continuer la correction sans repasser par <body>', () => {
  it('cible le PROCHAIN mouvement encore corrigeable après celui qu’on vient de contrepasser', () => {
    const avant = [mouvement('entree'), mouvement('sortie'), mouvement('perte')];
    expect(cleMouvementAFocaliserApresContrepassation(avant, 'entree')).toBe('sortie');
  });

  it('saute les mouvements déjà annulés : ils n’ont plus de bouton « Corriger… », seulement « Annulé »', () => {
    const avant = [
      mouvement('entree'),
      mouvement('sortie', { isAnnule: true }),
      mouvement('perte'),
    ];
    expect(cleMouvementAFocaliserApresContrepassation(avant, 'entree')).toBe('perte');
  });

  it('saute les écritures de contrepassation elles-mêmes : elles n’ont pas non plus de bouton', () => {
    const avant = [
      mouvement('entree'),
      mouvement('inverse-dune-correction-precedente', { estContrepassation: true }),
      mouvement('perte'),
    ];
    expect(cleMouvementAFocaliserApresContrepassation(avant, 'entree')).toBe('perte');
  });

  it('revient sur le précédent corrigeable quand le contrepassé était le DERNIER corrigeable', () => {
    const avant = [
      mouvement('entree'),
      mouvement('sortie'),
      mouvement('perte', { isAnnule: true }),
    ];
    expect(cleMouvementAFocaliserApresContrepassation(avant, 'sortie')).toBe('entree');
  });

  it('rend `null` quand plus aucun mouvement n’est corrigeable après la contrepassation', () => {
    // Cas terminal, rare : un seul mouvement corrigeable existait, on vient de
    // le contrepasser. Aucune cible de continuation n'existe — l'appelant ne
    // force alors rien (voir `DetailLot.tsx`), même choix que sur
    // l'échéancier plutôt qu'un repli inventé.
    const avant = [mouvement('entree')];
    expect(cleMouvementAFocaliserApresContrepassation(avant, 'entree')).toBeNull();
  });

  it('rend `null` sur une liste déjà vide (garde de robustesse)', () => {
    expect(cleMouvementAFocaliserApresContrepassation([], 'entree')).toBeNull();
  });

  it('ne fait AUCUNE hypothèse sur la position réelle du mouvement contrepassé dans le tableau : « rien ne s’efface » (CLAUDE.md §3 règle 7) — la ligne originale reste à sa place, barrée, jamais retirée du tableau', () => {
    // Contrairement à `cleAFocaliserApresRetrait` (SaisieReception.tsx), qui
    // suppose une ligne réellement retirée, cette fonction ne retire jamais
    // rien du tableau qu'on lui donne : elle filtre seulement les mouvements
    // encore corrigeables. Preuve directe : passer un tableau où l'id
    // contrepassé n'apparaît même plus (comme s'il avait déjà été retiré, ce
    // qui ne devrait jamais arriver en pratique) retombe simplement sur le
    // premier corrigeable, sans lever d'erreur.
    const avant = [mouvement('sortie'), mouvement('perte')];
    expect(cleMouvementAFocaliserApresContrepassation(avant, 'introuvable')).toBe('sortie');
  });
});
