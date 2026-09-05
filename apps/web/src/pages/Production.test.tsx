import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProductionResume } from '@batte/core';
import { Tableau } from '../composants/Tableau';
import { COLONNES_CONSOMMATIONS, colonnesHistorique } from './Production';

// Horizon DLC arbitraire pour ces tests : ils vérifient des largeurs et de la
// troncature, jamais le contenu du compteur « J-n » — voir Stock.tsx/
// Production.tsx pour la vraie résolution depuis `brief_horizon_alerte_dlc_jours`.
const COLONNES_HISTORIQUE = colonnesHistorique(7);

/**
 * `COLONNES_HISTORIQUE` — vérification de largeur à la vraie résolution
 * (correction du 31/07/2026, à la suite de `docs/23-AUDIT-VISUEL.md`).
 *
 * L'audit visuel avait déclaré cet écran « indemne » à 1280×720, mais avait
 * mesuré ses PNG plutôt que `document.documentElement.clientWidth` (le
 * `devicePixelRatio` du navigateur pilotait à 1,25 : demander 1280×720
 * rendait en réalité 1024×576, une condition PLUS DURE que la cible réelle).
 * Revérifié à un `clientWidth === 1280` vérifié, avec les VRAIES données de
 * démonstration (`R2 — Pâte à crêpes sarrasin-châtaigne (sans gluten)`,
 * `packages/core/src/recettes.ts`), trois colonnes tronquaient réellement :
 * « Recette » (« R1 — Pâte à c… », 190 px requis pour 111 px disponibles),
 * « Lot de pâte » (identifiant AFSCA, CLAUDE.md §3 règle 6) et « Session »
 * (3 px de moins que nécessaire — invisible à l'œil, réel au `scrollWidth`).
 *
 * ROUGE avant le correctif : `recette` et `lotPate` utilisaient l'ellipse
 * par défaut (aucun `troncature` déclaré) et les `largeur` sommaient déjà à
 * 100 (pas un défaut D-081) mais mal réparties. `recette` ne peut de toute
 * façon pas être bornée par une largeur fixe — la longueur de `recetteNom`
 * varie de 26 à 51 caractères selon R1/R2, ce qu'aucune largeur raisonnable
 * ne peut accueillir sans jamais s'enrouler — d'où `troncature: 'repli'`
 * plutôt qu'un simple agrandissement.
 */
describe('COLONNES_HISTORIQUE — recette, lot de pâte et session ne se tronquent plus à 1280 px', () => {
  function production(overrides: Partial<ProductionResume> = {}): ProductionResume {
    return {
      id: 'production-1',
      numero: 'PR-2026-0001',
      recetteCode: 'R1',
      recetteNom: 'Pâte à crêpes froment',
      dateProduction: '2026-07-25',
      statut: 'terminee',
      volumeTheoriqueMl: 10_400,
      crepesTheoriques: 134,
      volumeReelMl: 10_400,
      crepesReelles: 134,
      coutMatiereTheoriqueCents: 3_400,
      // Champ ajouté à `schemaProductionResume` le 01/08/2026 (coût matière
      // RÉELLEMENT engagé). Complété ici pour que la fixture reste assignable
      // à `ProductionResume` : sans lui, `tsc` refusait ce fichier. La valeur
      // `3_400` n'est PAS reprise du théorique — le réel de cette production
      // est connu (`volumeReelMl` et `crepesReelles` le sont), et le recopier
      // affirmerait un écart de coût nul qui n'a pas été mesuré.
      coutMatiereReelCents: 3_512,
      numeroLotPate: 'PATE-PR-2026-0001',
      dateDlcPate: '2026-07-26',
      sessionId: 'session-1',
      sessionNumero: 'SM-2026-0002',
      ...overrides,
    };
  }

  it('la somme des `largeur` fait exactement 100 (D-081)', () => {
    const somme = COLONNES_HISTORIQUE.reduce((total, c) => total + Number.parseFloat(c.largeur), 0);
    expect(somme).toBeCloseTo(100, 5);
  });

  it('`recette` et `lotPate` portent `troncature: repli` — jamais l’ellipse par défaut', () => {
    const parCle = Object.fromEntries(COLONNES_HISTORIQUE.map((c) => [c.cle, c]));
    expect(parCle['recette']?.troncature).toBe('repli');
    expect(parCle['lotPate']?.troncature).toBe('repli');
  });

  it(
    'ROUGE avant le correctif : le nom de recette LONG (R2, sans gluten) apparaît en entier, ' +
      'replié plutôt que tronqué — la mention « sans gluten » ne peut pas disparaître dans une ' +
      'ellipse, c’est ce qui distingue R1 de R2 pour l’allergène',
    () => {
      const balisage = renderToStaticMarkup(
        <Tableau
          colonnes={COLONNES_HISTORIQUE}
          lignes={[
            production({
              recetteCode: 'R2',
              recetteNom: 'Pâte à crêpes sarrasin-châtaigne (sans gluten)',
            }),
          ]}
          cleLigne={(p) => p.id}
          etatVide={<span>vide</span>}
        />,
      );

      expect(balisage).toContain('R2 — Pâte à crêpes sarrasin-châtaigne (sans gluten)');

      const indexTexte = balisage.indexOf('sarrasin-châtaigne');
      const debutCellule = balisage.lastIndexOf('<td', indexTexte);
      const finCellule = balisage.indexOf('</td>', indexTexte);
      const cellule = balisage.slice(debutCellule, finCellule);
      expect(cellule).toContain('data-troncature="repli"');
      expect(cellule).not.toContain('truncate');
    },
  );

  it(
    'ROUGE avant le correctif : le numéro de lot de pâte (identifiant AFSCA) apparaît en ' +
      'entier, replié plutôt que tronqué — CLAUDE.md §3 règle 6',
    () => {
      const balisage = renderToStaticMarkup(
        <Tableau
          colonnes={COLONNES_HISTORIQUE}
          lignes={[production({ numeroLotPate: 'PATE-PR-2026-0001' })]}
          cleLigne={(p) => p.id}
          etatVide={<span>vide</span>}
        />,
      );

      const indexTexte = balisage.indexOf('PATE-PR-2026-0001');
      expect(indexTexte).toBeGreaterThan(-1);
      const debutCellule = balisage.lastIndexOf('<td', indexTexte);
      const finCellule = balisage.indexOf('</td>', indexTexte);
      const cellule = balisage.slice(debutCellule, finCellule);
      expect(cellule).toContain('data-troncature="repli"');
      expect(cellule).not.toContain('truncate');
    },
  );
});

/**
 * `COLONNES_CONSOMMATIONS` — la fiche de traçabilité, CINQ colonnes dans
 * ~418 px de contenu réel (420 px de panneau, moins 2×1 px de bordure).
 *
 * Passée de SIX à CINQ colonnes le 01/08/2026 : mesuré au navigateur
 * (`clientWidth`/`scrollWidth` de chaque `th`, aux trois cibles
 * 1280/1920/2560 — identiques, ce panneau ne dépend pas du viewport),
 * « Coût théo. » et « Coût réel » tronquaient en « COÛ… » et « COÛT … »,
 * quasi indiscernables l'un de l'autre. Les deux sont donc FUSIONNÉS en une
 * seule colonne « Coût » (théorique / réel dans la même cellule), ce qui
 * élimine la confusion à la racine et libère la largeur qui manquait à
 * « Ingrédient » et « Lot fournisseur » (abrégé en « Lot fourn. »). Les
 * largeurs ont donc toutes bougé, et D-081 exige qu'elles somment EXACTEMENT
 * à 100 : avec `table-layout: fixed`, un total différent laisse le navigateur
 * redistribuer comme il veut, et les colonnes se déplacent d'une ligne à
 * l'autre — fatal à une lecture au clavier, où la cible bouge sous les
 * doigts.
 *
 * Le même jour, et par un AUTRE chantier, la quatrième colonne a changé de
 * clé et d'intitulé : `reel` / « Réel » est devenue `sorti` / « Sorti », en
 * même temps que le champ `quantiteReelleMouvementee` prenait le nom
 * `quantiteMouvementee` déjà porté par les contrats AFSCA. Les deux chantiers
 * ont touché `Production.tsx` ; celui-ci lisait encore `parCle['reel']` et
 * échouait — non pas sur la fusion, qui était complète, mais sur une clé qui
 * n'existait plus.
 *
 * Ce que ces tests NE prouvent PAS : qu'aucun en-tête ni aucune cellule ne se
 * tronque à 418 px réels. Aucune feuille de style n'est appliquée ici, et
 * `devicePixelRatio` n'est pas constant (docs/39 §10) — cela se vérifie au
 * navigateur, pas ici (mesuré séparément, hors de cette suite Vitest). Ils ne
 * prouvent pas non plus que l'en-tête RENDU porte bien son infobulle : c'est
 * `Production.montage.test.tsx` qui lit le `title` du `<th>` réel.
 */
describe('COLONNES_CONSOMMATIONS — cinq colonnes, et la somme des largeurs (D-081)', () => {
  it('la somme des `largeur` fait exactement 100', () => {
    const somme = COLONNES_CONSOMMATIONS.reduce(
      (total, c) => total + Number.parseFloat(c.largeur),
      0,
    );
    expect(somme).toBeCloseTo(100, 5);
  });

  it(
    'les colonnes de coût sont FUSIONNÉES en une seule, et chaque en-tête abrégé porte son ' +
      'libellé LONG — un en-tête abrégé sans mot entier ne renvoie nulle part',
    () => {
      // LES CINQ CLÉS, NOMMÉES ET ORDONNÉES, AVANT TOUTE AUTRE ASSERTION.
      // C'est ce qui manquait le 01/08/2026 : la colonne `reel` est devenue
      // `sorti` et les assertions suivantes lisaient encore `parCle['reel']`.
      // Une lecture par clé disparue rend `undefined`, et l'optionnel `?.`
      // propage le `undefined` jusqu'au `toContain`, qui échoue sur « la
      // combinaison d'arguments est invalide » — un message qui n'accuse ni la
      // clé, ni le renommage, et qui envoie chercher le défaut dans le
      // formatage. Cette assertion-ci échoue en montrant les deux listes.
      expect(COLONNES_CONSOMMATIONS.map((c) => c.cle)).toEqual([
        'ingredient',
        'lot',
        'theorique',
        'sorti',
        'cout',
      ]);
      const parCle = Object.fromEntries(COLONNES_CONSOMMATIONS.map((c) => [c.cle, c]));
      // Une seule colonne de coût désormais — plus de `coutReel` séparée.
      expect(parCle['cout']?.libelle).toBe('Coût');
      expect(parCle['coutReel']).toBeUndefined();
      // `libelleLong` est ce que `Tableau.tsx` pose en `title` de l'en-tête ;
      // il doit encore nommer les DEUX notions que la cellule fusionnée porte.
      expect(parCle['cout']?.libelleLong).toContain('théorique');
      expect(parCle['cout']?.libelleLong).toContain('réel');
      expect(parCle['lot']?.libelle).toBe('Lot fourn.');
      expect(parCle['lot']?.libelleLong).toContain('fournisseur');
      expect(parCle['theorique']?.libelle).toBe('Théo.');
      expect(parCle['theorique']?.libelleLong).toContain('théorique');
      // `sorti` REMPLACE `reel` (01/08/2026) : « Réel » ne disait que ce que le
      // chiffre N'EST PAS (ni théorique, ni déclaré), « Sorti du lot » dit ce
      // qu'il EST — le net du grand livre sur CE lot. L'ancienne clé est
      // exigée absente, sinon les deux pourraient coexister sans que rien ne
      // le dise. « Sorti » est une abréviation SANS point final : le mot
      // entier ne peut donc venir que d'ici, la garde dérivée plus bas ne sait
      // pas la voir.
      expect(parCle['reel']).toBeUndefined();
      expect(parCle['sorti']?.libelle).toBe('Sorti');
      expect(parCle['sorti']?.libelleLong).toContain('Sorti du lot');
      expect(parCle['sorti']?.libelleLong).toContain('mouvementée');
    },
  );

  it(
    'garde dérivée : toute colonne dont l’en-tête se termine par un point — une abréviation ' +
      'typographique — porte un `libelleLong` ; la RÈGLE, pas une liste de clés écrite à la main',
    () => {
      // Les assertions par clé ci-dessus ne prouvent rien d'une SIXIÈME colonne
      // qu'on ajouterait demain : elles ne regardent que les clés qu'elles
      // nomment (D-045, docs/39 §2). Celle-ci balaie la définition entière.
      //
      // CE QU'ELLE NE VOIT PAS, et qu'il faut donc tenir à la main au-dessus :
      // une abréviation sans point final. « Sorti » pour « Sorti du lot » en
      // est une, et aucun motif mécanique ne peut la distinguer d'un intitulé
      // complet — seul l'auteur sait que le mot est coupé.
      const abregeesSansMotEntier = COLONNES_CONSOMMATIONS.filter(
        (c) => c.libelle.endsWith('.') && c.libelleLong === undefined,
      ).map((c) => c.cle);
      expect(abregeesSansMotEntier).toEqual([]);

      // La garde ci-dessus passerait aussi sur une définition SANS aucune
      // abréviation — vide, elle ne discriminerait rien (docs/39 §3, la
      // fixture trop dégénérée pour voir). Ce tableau en porte deux
      // aujourd'hui : on exige qu'il en reste au moins une à surveiller.
      expect(COLONNES_CONSOMMATIONS.filter((c) => c.libelle.endsWith('.')).length).toBeGreaterThan(
        0,
      );
    },
  );

  it('les deux colonnes de traçabilité gardent `troncature: repli` — CLAUDE.md §3 règle 6', () => {
    const parCle = Object.fromEntries(COLONNES_CONSOMMATIONS.map((c) => [c.cle, c]));
    expect(parCle['ingredient']?.troncature).toBe('repli');
    expect(parCle['lot']?.troncature).toBe('repli');
  });

  it(
    'la cellule « Coût » affiche le théorique ET le réel côte à côte, avec le même ' +
      'discriminant tiret/zéro que l’ancienne colonne séparée (CLAUDE.md §7)',
    () => {
      const parCle = Object.fromEntries(COLONNES_CONSOMMATIONS.map((c) => [c.cle, c]));
      const colonneCout = parCle['cout'];
      expect(colonneCout).toBeDefined();

      const ligneNonMesuree = {
        lotId: 'lot-1',
        ingredientId: 'ing-1',
        nomIngredient: 'Farine de froment T55',
        unite: 'g' as const,
        numeroLotFournisseur: 'LOT-2026-0731-A',
        quantiteTheorique: 4_000,
        quantiteReelle: null,
        coutCents: 480,
        quantiteMouvementee: null,
        coutReelCents: null,
      };
      // `—` pour le réel NON MESURÉ : jamais `0,00`, qui affirmerait une
      // matière gratuite (CLAUDE.md §7, le mensonge le plus traqué du dépôt).
      // `formaterMontant` rend un nombre SANS symbole (l'unité va dans
      // l'en-tête, docs/07 §4.5) : « 4,80 », jamais « 4,80 € ».
      expect(colonneCout?.rendu(ligneNonMesuree)).toBe('4,80 / —');

      const ligneRestituee = { ...ligneNonMesuree, quantiteMouvementee: 0, coutReelCents: 0 };
      // `0,00` pour un VRAI zéro (matière intégralement restituée) : ne doit
      // surtout pas se confondre avec le tiret ci-dessus.
      expect(colonneCout?.rendu(ligneRestituee)).toBe('4,80 / 0,00');
    },
  );
});
