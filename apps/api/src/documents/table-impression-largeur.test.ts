/// <reference lib="dom" />
/**
 * Garde du défaut CRITIQUE de l'audit du 31/07/2026 (`docs/24-AUDIT-DOCUMENTS-IMPRIMES.md` §2.1) :
 * un tableau à PLUSIEURS colonnes de texte libre s'effondre à l'impression dès
 * qu'UNE SEULE cellule contient une chaîne longue SANS ESPACE (un code de
 * référence collé, un libellé technique) — les colonnes GRAVITÉ, LOT CONCERNÉ,
 * ACTION CORRECTIVE et RÉSOLUTION disparaissent alors de la page, sur TOUTES
 * les lignes, et la colonne DESCRIPTION se coupe en plein mot.
 *
 * CE QU'UN TEST SUR LE HTML PRODUIT NE PEUT PAS VOIR : le défaut est un effet
 * du moteur de PAGINATION D'IMPRESSION de Chromium (`page.pdf()`), pas du HTML
 * lui-même — le HTML contient toujours ses 7 `<td>` par ligne, que le rendu
 * papier les affiche ou non. Un `expect(html).toContain(...)` passerait donc
 * MÊME AVEC LE DÉFAUT, exactement le piège que la consigne de cet audit
 * signale explicitement.
 *
 * CE QUE CE FICHIER VÉRIFIE À LA PLACE : la LARGEUR RÉELLEMENT CALCULÉE de la
 * table par le moteur de rendu, dans un viewport dont la largeur reproduit
 * EXACTEMENT la largeur imprimable d'une page A4 avec les marges de ce dépôt
 * (`style-impression.ts`, `@page { margin: 15mm 15mm 18mm 15mm; }` → 180 mm de
 * contenu). En layout `table-layout: auto` (l'état d'avant correctif), une
 * seule cellule au contenu insécable pousse la table BIEN AU-DELÀ de cette
 * largeur — exactement ce que Chromium, à l'impression, coupe au bord de la
 * page plutôt que de faire défiler. En layout `fixed` + `<colgroup>` (le
 * correctif), la largeur de la table reste bornée à 100 % du conteneur quel
 * que soit le contenu : le texte long s'enroule DANS sa cellule (la ligne
 * grandit), il ne pousse plus les colonnes suivantes hors de la page.
 *
 * Chromium est lancé directement ici (pas via `rendu.ts`, dont
 * `obtenirNavigateur` n'est pas exporté) : Playwright est déjà une dépendance
 * de `@batte/api`, déjà utilisée pour la génération PDF réelle.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { registreAfscaMensuel, type DonneesRegistreAfsca } from './registre-afsca.js';

// DEFAUT CORRIGÉ (diagnostic du 31/07/2026, voir `rendu.test.ts`) : ce
// `vi.setConfig` vivait dans le `beforeAll` ci-dessous. Vitest fige le
// timeout effectif de chaque `it`/`beforeAll`/`afterAll` au moment de son
// ENREGISTREMENT (pendant la collecte), avant qu'aucun corps de `beforeAll`
// ne s'execute : un `vi.setConfig` appele DANS un `beforeAll` ne change donc
// jamais le timeout du premier test ni d'aucun hook enregistre avant lui —
// reproduit deterministement, sans charge, avec un fichier minimal (voir le
// rapport de livraison). Place ICI, avant le `describe`, il couvre
// desormais reellement le test ET le hook `afterAll` (fermeture de
// Chromium), qui restait jusqu'ici au defaut Vitest de 10 s.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * Largeur imprimable, en pixels CSS (96 px/pouce), pour une page A4 (210 mm)
 * avec les marges gauche/droite de 15 mm chacune posées par `style-impression.ts`
 * (`@page { margin: 15mm 15mm 18mm 15mm; }`) : (210 - 15 - 15) mm = 180 mm.
 */
const LARGEUR_IMPRIMABLE_PX = Math.round(((210 - 15 - 15) / 25.4) * 96);

/** Chaîne réaliste : un code de référence collé, sans le moindre espace. */
function chaineLongueSansEspace(longueur: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let resultat = '';
  for (let i = 0; i < longueur; i++) {
    resultat += alphabet[i % alphabet.length];
  }
  return resultat;
}

function donneesAvecNonConformiteLongue(): DonneesRegistreAfsca {
  return {
    periodeLibelle: 'Juillet 2026 (test largeur)',
    dateGeneration: new Date('2026-07-31T10:00:00.000Z'),
    exploitant: {
      nom: null,
      adresse: null,
      numeroEntreprise: null,
      numeroEnregistrementAfsca: null,
    },
    temperatures: [],
    nettoyages: [],
    exercicesTracabilite: [],
    nonConformites: [
      // Une première ligne COURTE, réaliste : si le défaut existe, elle aussi
      // perd ses colonnes (« pour TOUTES les lignes », pas seulement la longue).
      {
        dateConstat: '2026-07-20',
        type: 'Rappel fournisseur',
        description: 'Rappel du lot de farine par le fournisseur, précaution sanitaire.',
        gravite: 'majeure',
        actionCorrective: 'Lot bloqué en attente de retour du fournisseur.',
        dateResolution: null,
        lot: null,
      },
      // La ligne qui déclenche le défaut : type ET description longs, sans
      // espace — exactement le « code de référence fournisseur collé » de
      // l'audit (85 et 140 caractères, mêmes ordres de grandeur).
      {
        dateConstat: '2026-07-25',
        type: chaineLongueSansEspace(85),
        description: chaineLongueSansEspace(140),
        gravite: 'mineure',
        actionCorrective:
          'Vérification demandée auprès du service qualité du fournisseur concerné.',
        dateResolution: null,
        lot: null,
      },
    ],
  };
}

describe('Impression — le tableau des non-conformités ne déborde jamais de la largeur imprimable', () => {
  let navigateur: Browser;

  afterAll(async () => {
    await navigateur?.close();
  });

  it(
    'reste dans la largeur imprimable (180 mm) et garde ses 7 colonnes ' +
      'même avec un champ libre long et sans espace (défaut critique de ' +
      "l'audit du 31/07/2026, docs/24 §2.1)",
    async () => {
      navigateur = await chromium.launch();
      const page = await navigateur.newPage();
      try {
        // Le viewport reproduit la largeur IMPRIMABLE, pas la largeur A4
        // totale : c'est la contrainte réelle que `table { width: 100%; }`
        // doit respecter sur le papier.
        await page.setViewportSize({ width: LARGEUR_IMPRIMABLE_PX, height: 2000 });

        const { html } = registreAfscaMensuel(donneesAvecNonConformiteLongue());
        await page.setContent(html, { waitUntil: 'load' });

        const mesure = await page.evaluate(() => {
          const tables = Array.from(document.querySelectorAll('table'));
          const table = tables.find((t) =>
            Array.from(t.querySelectorAll('th')).some((th) => th.textContent === 'Résolution'),
          );
          if (table === undefined) return null;

          const libellesEntete = Array.from(table.querySelectorAll('th')).map(
            (th) => th.textContent,
          );
          const largeurTable = table.getBoundingClientRect().width;

          // Pour CHAQUE ligne, la position horizontale de la dernière cellule
          // (Résolution) : si elle dépasse la largeur imprimable, cette
          // colonne — et tout ce qui la précède au-delà du bord — est
          // exactement ce que Chromium coupe à l'impression.
          const lignes = Array.from(table.querySelectorAll('tbody tr'));
          const positionsDerniereCellule = lignes.map((tr) => {
            const cellules = tr.querySelectorAll('td');
            const derniere = cellules[cellules.length - 1];
            return derniere === undefined ? null : derniere.getBoundingClientRect().right;
          });

          return {
            libellesEntete,
            largeurTable,
            positionsDerniereCellule,
            nbLignes: lignes.length,
          };
        });

        expect(mesure).not.toBeNull();
        // Les 7 colonnes existent bien dans le DOM — la garde ne serait pas
        // fiable si elle mesurait la mauvaise table (celle du gabarit compte
        // 7 en-têtes, aucune autre table de ce document n'en a autant).
        expect(mesure!.libellesEntete).toEqual([
          'Constat',
          'Type',
          'Description',
          'Gravité',
          'Lot concerné',
          'Action corrective',
          'Résolution',
        ]);
        expect(mesure!.nbLignes).toBe(2);

        // LA garde du défaut critique : la table ne s'étale jamais au-delà de
        // la largeur imprimable, quel que soit le contenu d'une cellule.
        expect(mesure!.largeurTable).toBeLessThanOrEqual(LARGEUR_IMPRIMABLE_PX + 1);

        // Et donc la dernière colonne (Résolution) de CHAQUE ligne — y
        // compris celle qui suit la ligne au champ long — reste dans la page,
        // jamais poussée hors de la largeur imprimable par la ligne précédente.
        for (const position of mesure!.positionsDerniereCellule) {
          expect(position).not.toBeNull();
          expect(position!).toBeLessThanOrEqual(LARGEUR_IMPRIMABLE_PX + 1);
        }
      } finally {
        await page.close();
      }
    },
  );
});
