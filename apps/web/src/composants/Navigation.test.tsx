import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Navigation } from './Navigation';

/**
 * Meme dispositif que `Tableau.test.tsx` : ce fichier ne monte pas le
 * composant. `renderToStaticMarkup` verifie le STRUCTUREL (nombre de liens,
 * presence du lien d'evitement, hauteur de rangee) — jamais le comportemental
 * (le vrai defilement au clavier, l'auto-scroll natif du navigateur sur un
 * focus, la souris). Le montage vit dans `Navigation.montage.test.tsx`, a
 * cote de ce fichier. Le defilement REEL, lui, reste hors de portee des deux :
 * verifie a la main au navigateur le 31/07/2026, `nav.scrollTop` passe bien de
 * 0 a 252 des qu'on focalise un lien situe sous la ligne de flottaison.
 */
function rendre(chemin = '/'): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[chemin]}>
      <Navigation />
    </MemoryRouter>,
  );
}

describe('Navigation — inventaire des entrees (mission du 31/07/2026)', () => {
  /**
   * Mesure au navigateur, 1280x720, `document.documentElement.clientHeight`
   * (facteur d'echelle Windows exclu, voir docs/07 §4.4) : la nav occupe
   * 720 px de hauteur utile pour 972 px de contenu, soit un debordement de
   * 252 px. 21 des 29 entrees restent visibles sans defiler ; les 8
   * manquantes sont exactement les 8 dernieres de la liste (fin de
   * « Controle » + Parametres), c'est-a-dire les moins frequentes d'apres le
   * commentaire meme de ce fichier (« l'ordre reflete la frequence d'usage
   * reelle »). Conclusion de la mission : ce debordement est mesure et
   * assume, PAS corrige (voir le rapport pour l'arbitrage complet).
   *
   * Ce test fige le compte a 29 : s'il echoue, ce n'est pas un bug, c'est le
   * signal qu'il faut REEVALUER cet arbitrage (docs/06 a mettre a jour, et
   * potentiellement revisiter regroupement/densite/accordeon) avant de
   * changer simplement le chiffre ci-dessous.
   */
  it('compte exactement 29 entrees, le chiffre sur lequel l arbitrage de hauteur repose', () => {
    const balisage = rendre();
    const nbLiens = (balisage.match(/<a /g) ?? []).length;
    expect(nbLiens).toBe(29);
  });

  it('ne perd aucune route : chaque chemin apparait exactement une fois', () => {
    const balisage = rendre();
    const chemins = Array.from(balisage.matchAll(/href="([^"]+)"/g)).map((m) => m[1]);
    const uniques = new Set(chemins);
    expect(chemins.length).toBe(uniques.size);
    expect(chemins).toContain('/registre-afsca');
    expect(chemins).toContain('/journal-audit');
    expect(chemins).toContain('/parametres');
  });

  it('place le lien d evitement avant le premier lien de la liste', () => {
    // Le remede principal au defilement (docs/06, §Navigation) : il ne doit
    // jamais passer derriere les liens dans l'ordre du DOM / de tabulation.
    const balisage = rendre();
    const indexBouton = balisage.indexOf('Aller au contenu');
    const indexPremierLien = balisage.indexOf('<a ');
    expect(indexBouton).toBeGreaterThan(-1);
    expect(indexBouton).toBeLessThan(indexPremierLien);
  });

  it('garde une hauteur de rangee de 28 px minimum (h-7), jamais decorative', () => {
    // docs/07 §4.3 : 28 px est deja le plancher « dense » du projet ; docs/07
    // §4.4 rappelle que la cible n'est pas decorative. Une future densification
    // qui passerait sous ce plancher devrait etre une decision explicite, pas
    // un accident de refactor.
    const balisage = rendre();
    const nbLiensH7 = (balisage.match(/class="[^"]*\bh-7\b[^"]*"/g) ?? []).length;
    expect(nbLiensH7).toBeGreaterThanOrEqual(29);
  });

  it('a 5 groupes, dont exactement un sans titre (Parametres, isole en bas)', () => {
    const balisage = rendre();
    const nbTitres = (balisage.match(/<h2[^>]*>/g) ?? []).length;
    // 5 groupes au total, 1 seul (Parametres) sans <h2>.
    expect(nbTitres).toBe(4);
    expect(balisage).toContain('>Paramètres<');
  });
});

/**
 * Correction du 31/07/2026 : atterrir directement (lien externe, actualisation,
 * retour arriere du navigateur) sur une des 8 entrees sous le pli laissait la
 * nav a `scrollTop = 0`, avec l'entree active invisible et aucun element
 * focalise — l'utilisateur perdait son repere de position, precisement sur
 * les ecrans les moins frequentes ou il en a le plus besoin. Verifie au
 * navigateur (pas ici) : `nav.scrollTop` passe de 0 a 196 au chargement de
 * `/journal-audit`, et l'entree redevient entierement visible.
 *
 * `renderToStaticMarkup` n'execute aucun effet (le `useLayoutEffect` qui fait
 * le `scrollIntoView` ne tourne jamais ici) : ce test ne prouve PAS que le
 * defilement a lieu. Il verifie seulement la PRECONDITION structurelle dont
 * cet effet depend — que `nav.querySelector('a[aria-current="page"]')`
 * trouve bien, et uniquement, le lien de la route active.
 */
describe('Navigation — precondition du recentrage automatique (aria-current)', () => {
  it('marque le lien actif avec aria-current="page", et lui seul', () => {
    const balisage = rendre('/journal-audit');
    expect((balisage.match(/aria-current="page"/g) ?? []).length).toBe(1);
    // Le lien marque est bien celui de la route demandee.
    const segmentAutourDeAriaCurrent = balisage.slice(
      balisage.indexOf('aria-current="page"') - 300,
    );
    expect(segmentAutourDeAriaCurrent).toContain('/journal-audit');
  });

  it('ne marque aucun lien sur une route qui ne correspond a aucune entree', () => {
    const balisage = rendre('/route-inexistante');
    expect(balisage).not.toContain('aria-current="page"');
  });
});
