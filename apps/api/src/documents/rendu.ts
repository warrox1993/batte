/**
 * Chaine de rendu PDF : HTML + CSS print -> Playwright -> fichier archive.
 *
 * UN SEUL mecanisme pour tous les documents (`CLAUDE.md` §2). Un gabarit
 * produit du HTML, cette couche s'occupe du reste : navigateur, pagination,
 * ecriture, empreinte, archivage.
 *
 * Le navigateur est reutilise entre deux rendus consecutifs : le demarrage de
 * Chromium coute ~300 ms, la generation d'une page ~50 ms. Generer les sept
 * documents d'une session en relancant le navigateur a chaque fois multiplierait
 * le temps par six.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { horodatageFichier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { config, schema, type BaseBatte } from '@batte/db';
import { and, desc, eq } from 'drizzle-orm';
import { STYLE_IMPRESSION } from './style-impression.js';

export type TypeDocument =
  | 'fiche_technique'
  | 'affichette_allergenes'
  | 'etiquette_bac'
  | 'bon_commande'
  | 'brief_avant_marche'
  | 'rapport_session'
  | 'registre_afsca'
  | 'export_excel'
  /**
   * FICHE DE RAPPEL (01/08/2026) : traçabilité AVAL d'un lot, seul document
   * tiré par LOT et non par période. La valeur miroir a été ajoutée le même
   * jour à l'énumération Drizzle de `document_genere.type`
   * (`packages/db/src/schema.ts`) — les DEUX sont nécessaires, en ajouter une
   * seule casse le typecheck de `archiverFichierGenere` ci-dessous.
   *
   * Aucune migration : sous SQLite, un `enum` Drizzle est une contrainte
   * TypeScript, jamais un `CHECK` SQL — vérifié sur cette colonne précise.
   *
   * Reste à câbler : la route `GET /documents/fiche-rappel/:lot`. Le gabarit
   * lui-même est prouvé par un rendu Chromium réel dans `fiche-rappel.test.ts`.
   */
  | 'fiche_rappel';

export type DocumentArchive = {
  id: string;
  type: TypeDocument;
  numero: string | null;
  version: number;
  chemin: string;
  tailleOctets: number;
  hashSha256: string;
  dateGeneration: string;
};

/**
 * Navigateur partage, demarre a la premiere demande.
 *
 * Volontairement paresseux : la plupart des sessions d'utilisation ne generent
 * aucun PDF, et faire payer 300 ms de demarrage de Chromium au lancement de
 * l'API serait absurde.
 */
let navigateurPartage: Browser | null = null;

async function obtenirNavigateur(): Promise<Browser> {
  if (navigateurPartage !== null && navigateurPartage.isConnected()) {
    return navigateurPartage;
  }
  navigateurPartage = await chromium.launch();
  return navigateurPartage;
}

/** A appeler a l'arret du serveur : sinon un processus Chromium survit. */
export async function fermerNavigateur(): Promise<void> {
  if (navigateurPartage !== null) {
    await navigateurPartage.close();
    navigateurPartage = null;
  }
}

export type OptionsPage = {
  /** Style additionnel propre au gabarit, applique APRES le style commun. */
  readonly styleAdditionnel?: string;
  /** Paysage pour un tableau large. Portrait par defaut. */
  readonly paysage?: boolean;
  /** Pied de page HTML. Omis pour les etiquettes et affichettes. */
  readonly pied?: string;
};

/**
 * Ce qu'un gabarit produit : le HTML du document ET les `options` (dont le
 * pied de page) qui doivent voyager jusqu'a `rendrePdf`.
 *
 * DEFAUT CORRIGE (audit du 31/07/2026) : `documentHtml` recevait deja
 * `options.pied`, calcule par chaque gabarit, mais ne le rendait accessible
 * NULLE PART — la fonction renvoyait seulement une chaine HTML, et
 * `options.pied` n'etait utilise que pour construire cette chaine (ce qu'il
 * ne fait meme pas : un `.pied` en position `fixed` dans le corps ne se
 * repeterait qu'une fois par impression Chromium, jamais par page). Le SEUL
 * mecanisme qui compte pour Playwright est `DemandeRendu.options.pied`, lu
 * par `rendrePdf` ci-dessous — un champ totalement SEPARE que rien
 * n'alimentait, puisque le gabarit ne renvoyait qu'une chaine. En renvoyant
 * le couple `{ html, options }`, un appelant peut faire
 * `rendrePdf(base, { ..., ...renduGabarit })` et le pied voyage enfin
 * jusqu'au vrai mecanisme.
 */
export type RenduGabarit = {
  readonly html: string;
  readonly options: OptionsPage;
};

/** Assemble un document HTML complet a partir du corps d'un gabarit. */
export function documentHtml(
  titre: string,
  corps: string,
  options: OptionsPage = {},
): RenduGabarit {
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${echapper(titre)}</title>
<style>${STYLE_IMPRESSION}${options.styleAdditionnel ?? ''}</style>
</head>
<body>${corps}</body>
</html>`;
  return { html, options };
}

/**
 * Echappe le texte insere dans un gabarit.
 *
 * Les donnees viennent de la base — un nom de fournisseur ou une note libre
 * peut contenir `<` ou `&`. Sans echappement, le rendu casse silencieusement
 * ou, pire, interprete le contenu comme du balisage.
 */
export function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type DemandeRendu = {
  readonly type: TypeDocument;
  readonly objetId: string | null;
  readonly numero: string | null;
  readonly titre: string;
  readonly html: string;
  readonly options?: OptionsPage;
  /** Instantane des donnees ayant servi au rendu, pour l'audit. */
  readonly parametresSource?: unknown;
  readonly creePar?: string | null;
};

/**
 * Version suivante pour un couple (type, objetId) : 1 si aucun document n'a
 * encore ete emis pour ce couple.
 */
function prochaineVersion(base: BaseBatte, type: TypeDocument, objetId: string | null): number {
  const versionPrecedente = base
    .select({ version: schema.documentGenere.version })
    .from(schema.documentGenere)
    .where(
      and(
        eq(schema.documentGenere.type, type),
        objetId === null
          ? eq(schema.documentGenere.objetId, '')
          : eq(schema.documentGenere.objetId, objetId),
      ),
    )
    .orderBy(desc(schema.documentGenere.version))
    .limit(1)
    .get();

  return (versionPrecedente?.version ?? 0) + 1;
}

/**
 * Nom de fichier unique et trie chronologiquement, sans caractere hostile au
 * systeme de fichiers. Sans extension : celle-ci depend du format produit.
 */
function construireNomFichier(
  type: TypeDocument,
  numero: string | null,
  objetId: string | null,
  version: number,
): string {
  return [type, numero ?? objetId ?? 'general', `v${version}`, horodatageFichier()]
    .join('_')
    .replace(/[^A-Za-z0-9_-]/g, '-');
}

export type DemandeArchivage = {
  readonly type: TypeDocument;
  readonly objetId: string | null;
  readonly numero: string | null;
  /** Extension SANS le point : `pdf`, `xlsx`… */
  readonly extension: string;
  /** Instantane des donnees ayant servi a la production du fichier, pour l'audit. */
  readonly parametresSource?: unknown;
  readonly creePar?: string | null;
};

/**
 * Ecrit un document sur disque et l'ARCHIVE : calcule la version suivante,
 * construit un nom de fichier unique, delegue la PRODUCTION des octets a
 * `ecrireFichier` (Playwright pour un PDF, ExcelJS pour un classeur — seul ce
 * mecanisme differe d'un format a l'autre), puis calcule l'empreinte SHA-256
 * et insere la ligne `document_genere`.
 *
 * Extrait de `rendrePdf` pour le Lot 6 (exports Excel) : `rendrePdf` n'etait
 * pas reutilisable tel quel pour un fichier non-PDF, l'archivage, lui, est
 * IDENTIQUE quel que soit le format produit.
 *
 * Regenerer le meme document cree une NOUVELLE VERSION numerotee : le fichier
 * precedent reste sur disque et en base. C'est la reponse au defaut releve en
 * `docs/07` §6.5 — un registre presente a un controle ne doit jamais pouvoir
 * etre remplace par une version recalculee plus tard.
 */
export async function archiverFichierGenere(
  base: BaseBatte,
  demande: DemandeArchivage,
  ecrireFichier: (chemin: string) => void | Promise<void>,
): Promise<DocumentArchive> {
  const version = prochaineVersion(base, demande.type, demande.objetId);
  const nomFichier = construireNomFichier(demande.type, demande.numero, demande.objetId, version);
  const chemin = join(config.dossierSorties, `${nomFichier}.${demande.extension}`);
  mkdirSync(dirname(chemin), { recursive: true });

  await ecrireFichier(chemin);

  // Taille et empreinte calculees sur UNE SEULE lecture du fichier. Avec un
  // `statSync` puis un `readFileSync` separes, un fichier modifie entre les
  // deux (autre processus, ecriture differee) aurait ete archive avec une
  // taille et une empreinte qui ne decrivent pas le meme contenu, ce qu'un
  // controle d'integrite ulterieur signalerait a tort ou a raison sans qu'on
  // puisse savoir lequel (CodeQL js/file-system-race, 28/09/2026).
  const contenu = readFileSync(chemin);
  const tailleOctets = contenu.length;
  const hashSha256 = createHash('sha256').update(contenu).digest('hex');
  const dateGeneration = maintenantUtc();
  const id = nouvelIdentifiant();

  base
    .insert(schema.documentGenere)
    .values({
      id,
      type: demande.type,
      objetId: demande.objetId ?? '',
      numero: demande.numero,
      version,
      dateGeneration,
      chemin,
      tailleOctets,
      hashSha256,
      parametresSource: demande.parametresSource ?? null,
      creePar: demande.creePar ?? null,
    })
    .run();

  return {
    id,
    type: demande.type,
    numero: demande.numero,
    version,
    chemin,
    tailleOctets,
    hashSha256,
    dateGeneration,
  };
}

/**
 * Rend un document en PDF, l'ecrit sur disque et l'ARCHIVE via
 * `archiverFichierGenere`.
 */
export async function rendrePdf(base: BaseBatte, demande: DemandeRendu): Promise<DocumentArchive> {
  return archiverFichierGenere(
    base,
    {
      type: demande.type,
      objetId: demande.objetId,
      numero: demande.numero,
      extension: 'pdf',
      parametresSource: demande.parametresSource,
      creePar: demande.creePar ?? null,
    },
    async (chemin) => {
      const navigateur = await obtenirNavigateur();
      const page = await navigateur.newPage();
      try {
        // `waitUntil: 'load'` suffit : le HTML est autonome, sans ressource externe
        // — coherent avec le cout d'infra de 0 € et le fonctionnement hors ligne.
        await page.setContent(demande.html, { waitUntil: 'load' });
        await page.pdf({
          path: chemin,
          format: 'A4',
          landscape: demande.options?.paysage ?? false,
          printBackground: true,
          displayHeaderFooter: demande.options?.pied !== undefined,
          footerTemplate: demande.options?.pied ?? '<span></span>',
          headerTemplate: '<span></span>',
          margin: { top: '15mm', bottom: '18mm', left: '15mm', right: '15mm' },
        });
      } finally {
        await page.close();
      }
    },
  );
}

/** Historique des versions d'un document, de la plus recente a la plus ancienne. */
export function versionsDocument(base: BaseBatte, type: TypeDocument, objetId: string | null) {
  return base
    .select()
    .from(schema.documentGenere)
    .where(
      and(eq(schema.documentGenere.type, type), eq(schema.documentGenere.objetId, objetId ?? '')),
    )
    .orderBy(desc(schema.documentGenere.version))
    .all();
}

/**
 * Verifie qu'un document archive n'a pas ete altere depuis son emission.
 *
 * Utile avant de presenter un registre a un controle : on peut affirmer que le
 * fichier est bien celui qui a ete emis a telle date.
 */
export function verifierIntegrite(
  base: BaseBatte,
  documentId: string,
): { intact: boolean; raison: string | null } {
  const doc = base
    .select()
    .from(schema.documentGenere)
    .where(eq(schema.documentGenere.id, documentId))
    .get();

  if (doc === undefined) return { intact: false, raison: 'Document inconnu.' };

  try {
    const hash = createHash('sha256').update(readFileSync(doc.chemin)).digest('hex');
    return hash === doc.hashSha256
      ? { intact: true, raison: null }
      : { intact: false, raison: 'Le fichier a été modifié depuis son émission.' };
  } catch {
    return { intact: false, raison: 'Le fichier est introuvable sur le disque.' };
  }
}
