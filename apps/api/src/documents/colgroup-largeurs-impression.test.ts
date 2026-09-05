/**
 * Garde de la même famille que D-081 (`docs/05-DECISIONS.md`), appliquée aux
 * tableaux D'IMPRESSION (`gabarits.ts`, `registre-afsca.ts`) plutôt qu'aux
 * tableaux d'écran (`Tableau.tsx`, gardés par
 * `apps/api/src/tableau-largeurs-colonnes.test.ts`) : depuis le correctif du
 * défaut critique de l'audit du 31/07/2026 (docs/24 §2.1), `style-impression.ts`
 * pose `table-layout: fixed` sur TOUS les documents imprimés, et chaque
 * `<table>` porte désormais son propre `<colgroup>` de largeurs déclarées.
 *
 * LE RISQUE QUE CE FICHIER EXISTE POUR EMPÊCHER — exactement celui de D-081 :
 * en layout fixe, si la somme des largeurs d'un `<colgroup>` DÉPASSE 100 %, le
 * navigateur RENORMALISE chaque colonne à `100 / somme` — un rétrécissement
 * uniforme et invisible à la lecture du code source. Sans cette garde, un
 * futur ajustement de colonne pourrait réintroduire la même classe de défaut
 * que celle qui vient d'être corrigée, sur les documents remis à l'AFSCA ou au
 * fournisseur.
 *
 * MÉTHODE : dérivée du système de fichiers (tout `.ts` de ce dossier, hors
 * `*.test.ts`), jamais une liste de deux fichiers énumérée à la main — un
 * gabarit ajouté demain avec ses propres tableaux est couvert sans qu'on ait à
 * y penser (même motif que `tableau-largeurs-colonnes.test.ts`, D-045).
 *
 * ASYMÉTRIE VOLONTAIRE, identique à D-081 : au-dessus de 100, échec DUR (le
 * défaut réel). En dessous de 100, avertissement seulement (le navigateur
 * laisse l'espace inutilisé — rien ne casse, mais ça peut trahir une colonne
 * oubliée).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOSSIER_DOCUMENTS = import.meta.dirname;
const EPSILON = 0.01;

type BlocColgroup = {
  readonly fichier: string;
  readonly index: number;
  readonly somme: number;
  readonly largeurs: readonly number[];
};

function listerFichiersGabarits(): string[] {
  return readdirSync(DOSSIER_DOCUMENTS)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort();
}

/**
 * Extrait chaque bloc `<colgroup>...</colgroup>` d'un fichier et la liste des
 * largeurs `width:NN%` qu'il contient, dans l'ordre.
 */
function extraireBlocs(texte: string, fichier: string): BlocColgroup[] {
  const blocs: BlocColgroup[] = [];
  const motifColgroup = /<colgroup>([\s\S]*?)<\/colgroup>/g;
  let correspondance: RegExpExecArray | null;
  let index = 0;
  while ((correspondance = motifColgroup.exec(texte)) !== null) {
    index++;
    const contenu = correspondance[1] ?? '';
    const largeurs: number[] = [];
    const motifLargeur = /width:\s*(\d+(?:\.\d+)?)%/g;
    let m: RegExpExecArray | null;
    while ((m = motifLargeur.exec(contenu)) !== null) {
      largeurs.push(Number.parseFloat(m[1] ?? '0'));
    }
    blocs.push({
      fichier,
      index,
      somme: largeurs.reduce((total, v) => total + v, 0),
      largeurs,
    });
  }
  return blocs;
}

function auditerColgroups(): BlocColgroup[] {
  const blocs: BlocColgroup[] = [];
  for (const fichier of listerFichiersGabarits()) {
    const texte = readFileSync(join(DOSSIER_DOCUMENTS, fichier), 'utf8');
    blocs.push(...extraireBlocs(texte, fichier));
  }
  return blocs;
}

describe('Impression — la somme des largeurs de chaque `<colgroup>` doit faire 100', () => {
  it("le scan n'est pas vacuellement vide : il voit réellement des blocs `<colgroup>`", () => {
    // Même défense que D-081/D-045 : un scan qui balaierait silencieusement
    // zéro bloc passerait quand même, sans jamais avoir vérifié quoi que ce
    // soit.
    const blocs = auditerColgroups();
    expect(blocs.length).toBeGreaterThan(10);
  });

  it('aucune somme ne DÉPASSE 100 (renormalisation invisible du navigateur, le défaut de D-081)', () => {
    const blocs = auditerColgroups();

    for (const bloc of blocs) {
      if (bloc.somme < 100 - EPSILON) {
        console.warn(
          `[colgroup impression][sous 100, toléré] ${bloc.fichier} (bloc n°${bloc.index}) — ` +
            `somme = ${bloc.somme}% (colonnes : ${bloc.largeurs.join(' + ')}).`,
        );
      }
    }

    const depassements = blocs
      .filter((bloc) => bloc.somme > 100 + EPSILON)
      .map(
        (bloc) =>
          `${bloc.fichier} (bloc n°${bloc.index}) — somme = ${bloc.somme}% ` +
          `(colonnes : ${bloc.largeurs.join(' + ')})`,
      );
    for (const ligne of depassements) console.error(`[colgroup impression][DÉPASSEMENT] ${ligne}`);
    expect(depassements).toEqual([]);
  });
});
