import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CompositionMenu, VentilationComposantMenuContrat } from '@batte/core';
import { Tableau } from '../composants/Tableau';
import { COLONNES_COMPOSITION, avertissementCoutVentilationMenu } from './Menus';

/**
 * Mission du 30/07/2026 — le coût d'un menu, et la question qu'il pose.
 *
 * `POST /menus/:menuId/ventilation` (`apps/api/src/routes/menus.ts:121-127`)
 * existe déjà et `Menus.tsx` l'appelle déjà (`rafraichirVentilation`) : ce
 * n'était donc pas le trou de cette mission. Le trou trouvé ici est plus
 * fin : `ventilerMenu` (`packages/core/src/menus.ts`) applique une règle
 * TOUT-OU-RIEN — un seul composant au coût inconnu rend `coutTotalCents`,
 * `margeMenuCents`, `margeSepareeCents` et `ecartMargeCents` nuls pour TOUT
 * le menu — et l'écran affichait déjà ces tirets, mais SANS JAMAIS DIRE
 * POURQUOI ni LEQUEL des composants manque de prix. Un tiret nu ne distingue
 * pas « un café oublié » de « toute la composition sans prix ».
 *
 * `avertissementCoutVentilationMenu` est la fonction PURE extraite pour
 * décider ce message — même patron que `affichageCoutRevientProduit`
 * (`Produits.tsx`) : la décision d'affichage doit rester testable sans
 * monter l'écran. Le montage vit dans `Menus.montage.test.tsx`, à côté.
 */

function composant(
  overrides: Partial<VentilationComposantMenuContrat> = {},
): VentilationComposantMenuContrat {
  return {
    produitInclusId: 'produit-1',
    nom: 'Crêpe froment nature',
    nature: 'transforme',
    quantite: 1,
    partPrixCents: 350,
    coutTotalCents: 33,
    ...overrides,
  };
}

describe('avertissementCoutVentilationMenu', () => {
  it('ne dit rien quand tous les composants ont un coût de revient connu', () => {
    const avertissement = avertissementCoutVentilationMenu([
      composant({ nom: 'Crêpe', coutTotalCents: 33 }),
      composant({ nom: 'Café', coutTotalCents: 45 }),
    ]);

    expect(avertissement).toBeNull();
  });

  it('distingue un coût réellement nul (composant offert) d’un coût inconnu : `0` n’est jamais traité comme manquant', () => {
    const avertissement = avertissementCoutVentilationMenu([
      composant({ nom: 'Crêpe', coutTotalCents: 33 }),
      composant({ nom: 'Café offert', coutTotalCents: 0 }),
    ]);

    expect(avertissement).toBeNull();
  });

  it('ROUGE avant le correctif : nomme le composant au coût inconnu et dit « partiellement », quand certains composants restent connus', () => {
    const avertissement = avertissementCoutVentilationMenu([
      composant({ nom: 'Crêpe froment nature', coutTotalCents: 33 }),
      composant({ nom: 'Café', coutTotalCents: null }),
    ]);

    expect(avertissement).not.toBeNull();
    expect(avertissement).toContain('partiellement');
    expect(avertissement).toContain('Café');
    // Le composant CONNU ne doit pas être accusé à tort.
    expect(avertissement).not.toContain('Crêpe froment nature');
  });

  it('accorde correctement le verbe au pluriel quand plusieurs composants sont inconnus', () => {
    const avertissement = avertissementCoutVentilationMenu([
      composant({ nom: 'Crêpe', coutTotalCents: 33 }),
      composant({ nom: 'Café', coutTotalCents: null }),
      composant({ nom: 'Sirop', coutTotalCents: null }),
    ]);

    expect(avertissement).toContain('Café');
    expect(avertissement).toContain('Sirop');
    expect(avertissement).toContain('n’ont');
    expect(avertissement).not.toContain('n’a pas');
  });

  it('dit « tous les composants » plutôt que « partiellement » quand AUCUN coût n’est connu', () => {
    const avertissement = avertissementCoutVentilationMenu([
      composant({ nom: 'Café', coutTotalCents: null }),
      composant({ nom: 'Sirop', coutTotalCents: null }),
    ]);

    expect(avertissement).not.toBeNull();
    expect(avertissement).toContain('tous les composants');
    expect(avertissement).not.toContain('partiellement');
    expect(avertissement).toContain('Café');
    expect(avertissement).toContain('Sirop');
  });
});

/**
 * `COLONNES_COMPOSITION` — le panneau « Composition de … » sommait à 90 %
 * (garde D-081, `apps/api/src/tableau-largeurs-colonnes.test.ts` :
 * `Menus.tsx:451`), signalé sans faire échouer (une somme SOUS 100 laisse de
 * l'espace inutilisé, elle ne rétrécit rien) — mais dans ce panneau étroit
 * (~550 px, deux panneaux côte à côte, docs/07 §3.3), l'espace manquant
 * suffisait à faire déborder QUATRE des six EN-TÊTES eux-mêmes (« QUA… »,
 * « PRIX CATAL… », « PRIX IMP… », « STA… »), pas seulement une valeur de
 * cellule.
 *
 * ROUGE avant le correctif : `Qté`, `Prix catal. (€)` et `Prix imp. (€)`
 * n'existaient pas encore — les en-têtes étaient `Quantité`, `Prix catalogue
 * (€)` et `Prix imposé (€)` en entier, trop longs pour les ~550 px
 * disponibles une fois la somme ramenée à 100 (mesuré au `canvas.measureText`
 * avec la police, l'interlettrage et la mise en majuscules réels des
 * en-têtes : les six en-têtes réclament ensemble 623 px). `libelleLong`
 * restitue chaque mot entier en infobulle d'en-tête (`Tableau.tsx`) — la
 * même mécanique que l'abréviation « Écoul. » de `Sessions.tsx`.
 */
describe('COLONNES_COMPOSITION — six colonnes dans un panneau étroit, sans en-tête tronqué', () => {
  function composant(overrides: Partial<CompositionMenu> = {}): CompositionMenu {
    return {
      id: 'composant-1',
      menuId: 'menu-1',
      produitInclusId: 'produit-1',
      nomProduitInclus: '[démo] Crêpe froment / Sirop de Liège',
      nature: 'transforme',
      quantite: 1,
      prixCatalogueCents: 350,
      actif: true,
      prixForceCents: null,
      ...overrides,
    };
  }

  it('la somme des `largeur` fait exactement 100 (D-081) — plus 90', () => {
    const somme = COLONNES_COMPOSITION.reduce(
      (total, c) => total + Number.parseFloat(c.largeur),
      0,
    );
    expect(somme).toBeCloseTo(100, 5);
  });

  it('les trois en-têtes abrégés portent `libelleLong`, le mot entier reste accessible', () => {
    const parCle = Object.fromEntries(COLONNES_COMPOSITION.map((c) => [c.cle, c]));

    expect(parCle['quantite']?.libelle).toBe('Qté');
    expect(parCle['quantite']?.libelleLong).toBe('Quantité');

    expect(parCle['prixCatalogue']?.libelle).toBe('Prix catal. (€)');
    expect(parCle['prixCatalogue']?.libelleLong).toBe('Prix catalogue (€)');

    expect(parCle['prixForce']?.libelle).toBe('Prix imp. (€)');
    expect(parCle['prixForce']?.libelleLong).toBe('Prix imposé (€)');

    expect(parCle['produit']?.libelle).toBe('Produit');
    expect(parCle['produit']?.libelleLong).toBe('Produit inclus');
    expect(parCle['produit']?.troncature).toBe('repli');
  });

  it(
    'ROUGE avant le correctif : chaque en-tête abrégé apparaît dans le markup avec son mot ' +
      'entier posé en `title`, jamais perdu',
    () => {
      const balisage = renderToStaticMarkup(
        <Tableau
          colonnes={COLONNES_COMPOSITION}
          lignes={[composant()]}
          cleLigne={(c) => c.id}
          etatVide={<span>vide</span>}
        />,
      );

      expect(balisage).toContain('>Qté<');
      expect(balisage).toContain('title="Quantité"');
      expect(balisage).toContain('>Prix catal. (€)<');
      expect(balisage).toContain('title="Prix catalogue (€)"');
      expect(balisage).toContain('>Prix imp. (€)<');
      expect(balisage).toContain('title="Prix imposé (€)"');
      expect(balisage).toContain('>Produit<');
      expect(balisage).toContain('title="Produit inclus"');
    },
  );

  it('le produit inclus, long, se replie plutôt que de se tronquer (colonne identifiante, D-081)', () => {
    const balisage = renderToStaticMarkup(
      <Tableau
        colonnes={COLONNES_COMPOSITION}
        lignes={[composant({ nomProduitInclus: '[démo] Crêpe froment / Sirop de Liège' })]}
        cleLigne={(c) => c.id}
        etatVide={<span>vide</span>}
      />,
    );

    const indexTexte = balisage.indexOf('[démo] Crêpe froment / Sirop de Liège');
    expect(indexTexte).toBeGreaterThan(-1);
    const debutCellule = balisage.lastIndexOf('<td', indexTexte);
    const finCellule = balisage.indexOf('</td>', indexTexte);
    const cellule = balisage.slice(debutCellule, finCellule);

    expect(cellule).toContain('data-troncature="repli"');
    expect(cellule).not.toContain('truncate');
  });
});
