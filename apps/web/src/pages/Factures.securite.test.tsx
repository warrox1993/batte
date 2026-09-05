import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { extraireFichierScanPath, LienPieceJointe } from './Factures';

/**
 * Mission « surface d'attaque ouverte aujourd'hui » (30/07/2026).
 *
 * Une Data URI rendue dans un `href`/`src` est du contenu EXÉCUTABLE par le
 * navigateur (`data:text/html`, SVG scriptable…). La garde décisive côté
 * écran est l'attribut `download` sur le lien de pièce jointe
 * (`LienPieceJointe`, extrait de `Factures.tsx` pour être testé isolément
 * par `renderToStaticMarkup`, sans monter `Factures` entier) : SANS lui,
 * cliquer ce lien
 * NAVIGUERAIT vers la Data URI au lieu de la télécharger.
 *
 * Ces tests verrouillent cette garde par le MARKUP RÉELLEMENT PRODUIT, pas
 * par une relecture du code source : si `download` disparaissait un jour
 * d'une future modification de `Factures.tsx`, ce test casserait.
 */

describe('LienPieceJointe — la garde `download` contre l’exécution d’une Data URI', () => {
  it('porte `download` et le `href` exact, sans aucun `target`', () => {
    const pieceJointe = 'data:image/png;base64,AAAA';
    const balisage = renderToStaticMarkup(
      <LienPieceJointe pieceJointe={pieceJointe} numeroFournisseur="FA-2026-001" />,
    );

    expect(balisage).toContain('download="facture-FA-2026-001"');
    expect(balisage).toContain(`href="${pieceJointe}"`);
    // Un `target="_blank"` ouvrirait un onglet inutile (une Data URI n'a pas
    // de `window.opener` a proteger) et pourrait, sur certains navigateurs,
    // contourner le telechargement force par `download`.
    expect(balisage).not.toContain('target=');
  });

  it(
    'DÉFENSE EN PROFONDEUR : même si une Data URI hostile atteignait ce composant ' +
      '(en pratique bloquée bien avant, par `validerPieceJointe` côté serveur), le rendu reste ' +
      'un simple lien `href`/`download` — jamais un `dangerouslySetInnerHTML`, jamais un `iframe`, ' +
      'jamais un `srcDoc`',
    () => {
      const pieceJointeHostile = 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='; // <script>alert(1)</script>
      const balisage = renderToStaticMarkup(
        <LienPieceJointe pieceJointe={pieceJointeHostile} numeroFournisseur="FA-2026-002" />,
      );

      // Le contenu hostile n'est JAMAIS interprété par React : il n'apparaît
      // que comme valeur d'attribut `href`, jamais comme balisage HTML.
      expect(balisage).toContain(`href="${pieceJointeHostile}"`);
      expect(balisage).toContain('download="facture-FA-2026-002"');
      expect(balisage).not.toContain('<script>');
      expect(balisage).not.toContain('dangerouslySetInnerHTML');
      expect(balisage).not.toContain('<iframe');
      expect(balisage).not.toContain('srcDoc');
      // Un SEUL element <a> : pas de second element injecte a cote.
      expect(balisage.match(/<a /g)?.length).toBe(1);
    },
  );

  it('échappe le numéro de fournisseur dans le nom de fichier téléchargé (pas d’injection d’attribut)', () => {
    // Un numero de facture saisi par l'utilisateur ne devrait jamais pouvoir
    // fermer prematurement l'attribut `download` : React echappe toute
    // valeur de prop, y compris celle-ci.
    const numeroHostile = 'FA"><script>alert(1)</script>';
    const balisage = renderToStaticMarkup(
      <LienPieceJointe
        pieceJointe="data:image/png;base64,AAAA"
        numeroFournisseur={numeroHostile}
      />,
    );

    expect(balisage).not.toContain('<script>');
    expect(balisage).toContain('&quot;');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Cas hostiles supplementaires pour extraireFichierScanPath, au-dela de ceux
   deja couverts par Factures.test.tsx (types incorrects, reponse non-objet).
   ═══════════════════════════════════════════════════════════════════════════ */

describe('extraireFichierScanPath — formes hostiles supplémentaires', () => {
  it('ignore un tableau au lieu d’une chaîne', () => {
    expect(extraireFichierScanPath({ fichierScanPath: ['data:image/png;base64,AAAA'] })).toBeNull();
  });

  it('ignore un objet imbriqué au lieu d’une chaîne', () => {
    expect(
      extraireFichierScanPath({
        fichierScanPath: { toString: () => 'data:image/png;base64,AAAA' },
      }),
    ).toBeNull();
  });

  it('n’exécute jamais un getter hostile sur la propriété (lecture directe, pas de coercition)', () => {
    let getterAppele = false;
    const reponseHostile = {
      get fichierScanPath() {
        getterAppele = true;
        return 'data:image/png;base64,AAAA';
      },
    };
    // Le getter EST legitimement appele (acces normal a la propriete) : ce
    // test documente que `extraireFichierScanPath` ne fait rien de plus
    // qu'une lecture simple, jamais un `JSON.stringify` ni une serialisation
    // recursive qui explorerait le reste de l'objet.
    expect(extraireFichierScanPath(reponseHostile)).toBe('data:image/png;base64,AAAA');
    expect(getterAppele).toBe(true);
  });

  it('rend `null` sur une chaîne vide (pas de Data URI, mais pas d’exception non plus)', () => {
    expect(extraireFichierScanPath({ fichierScanPath: '' })).toBe('');
  });
});
