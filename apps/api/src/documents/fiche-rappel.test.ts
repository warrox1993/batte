/**
 * Tests du Lot 8 (mission du 01/08/2026) — fiche de rappel, traçabilité AVAL
 * d'un lot fournisseur : document DÉDIÉ, distinct du registre AFSCA mensuel
 * (voir le docblock de `fiche-rappel.ts` pour l'argument complet).
 *
 * Convention de ce fichier, comme `audit-documents.test.ts` : chaque test qui
 * engage un domaine réel (réception -> production -> session) appelle la
 * chaîne VRAIE (dépôt `tracabiliteAvalLot` -> `donneesFicheRappelLot` ->
 * `ficheRappelLot`), jamais un gabarit isolé sur des données inventées à la
 * main sans passer par la base. Les cas ventes/garnitures, structurellement de
 * simples passe-plats déjà couverts au niveau du dépôt
 * (`packages/db/src/depots/tracabilite.test.ts`), sont ici vérifiés au niveau
 * du gabarit PUR (données littérales), pour ne pas dupliquer un montage
 * complet de clôture de session par cas.
 *
 * `ficheRappelLot` n'a PAS de valeur `TypeDocument` câblée dans
 * `document_genere.type` (`packages/db/src/schema.ts`, hors zone d'écriture
 * de cette mission — voir la note dans `rendu.ts`). Le rendu PDF réel de ce
 * fichier appelle donc Chromium DIRECTEMENT via Playwright, avec EXACTEMENT
 * les mêmes options que `rendrePdf` (`rendu.ts`), plutôt que par ce
 * mécanisme d'archivage.
 *
 * PREUVE PAGE 2 : une extraction de texte PAR PAGE (`pdfjs-dist`, installé
 * isolément dans le dossier temporaire de session, jamais dans ce dépôt) a
 * été faite manuellement sur un PDF de 6 pages produit par ce même gabarit,
 * pour LIRE réellement ce qui s'imprime sur une page 2 — voir le rapport de
 * livraison de cette mission pour l'extrait. Le test automatisé ci-dessous
 * (`nombreDePages`) ne dépend d'aucune bibliothèque de parsing PDF : il lit
 * directement `/Count N` dans l'objet `/Pages` du fichier, un simple
 * sous-produit de la structure PDF, pour prouver qu'un VRAI débordement sur
 * plusieurs pages a eu lieu.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { eq } from 'drizzle-orm';
import {
  changerStatutLot,
  creerBase,
  creerSession,
  declarerNonConformite,
  enregistrerReception,
  annulerReception,
  fournisseur,
  ingredient,
  lancerProduction,
  lieuMarche,
  migrer,
  recette,
  saisirRealise,
  seed,
  seedDemonstration,
  type BaseBatte,
} from '@batte/db';
import { TIRET_ABSENT, formaterQuantite } from '@batte/core';
import { donneesFicheRappelLot } from './donnees.js';
import { ficheRappelLot, type DonneesFicheRappelLot } from './fiche-rappel.js';
import { COULEURS_IMPRESSION } from './style-impression.js';

// Même raison que `rendu.test.ts`/`audit-documents.test.ts` : `vi.setConfig`
// DOIT s'exécuter au niveau du module (collecte), jamais dans un `beforeAll` —
// Vitest fige le timeout effectif de chaque `it`/hook au moment où il est
// ENREGISTRÉ (diagnostic du 31/07/2026, voir le commentaire de tête de
// `rendu.test.ts`). `hookTimeout` couvre `afterAll` (ferme Chromium),
// `testTimeout` couvre le rendu PDF réel.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const JOUR = '2026-07-27';
const NUMERO_LOT_SANS_ESPACE = 'LOTRAPPELSANSESPACENITIRETXYZ0001234567890123456789';

let navigateurPartage: Browser | undefined;
async function obtenirNavigateurTest(): Promise<Browser> {
  navigateurPartage ??= await chromium.launch();
  return navigateurPartage;
}

/**
 * Rend un HTML en PDF avec EXACTEMENT les mêmes options que `rendrePdf`
 * (`rendu.ts`) — voir le docblock de fichier pour pourquoi ce test n'appelle
 * pas `rendrePdf` lui-même.
 */
async function rendrePdfDirect(
  html: string,
  pied: string | undefined,
  chemin: string,
): Promise<void> {
  const page = await (await obtenirNavigateurTest()).newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: chemin,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: pied !== undefined,
      footerTemplate: pied ?? '<span></span>',
      headerTemplate: '<span></span>',
      margin: { top: '15mm', bottom: '18mm', left: '15mm', right: '15mm' },
    });
  } finally {
    await page.close();
  }
}

/**
 * Nombre de pages d'un PDF, lu directement dans l'objet `/Pages` du fichier
 * (`/Type /Pages ... /Count N`) — AUCUNE dépendance de parsing PDF : c'est un
 * sous-produit brut de la structure du format, suffisant pour prouver qu'un
 * VRAI débordement sur plusieurs pages a eu lieu (voir le docblock de fichier
 * pour la vérification plus approfondie faite hors de ce test).
 */
function nombreDePages(chemin: string): number {
  const texte = readFileSync(chemin).toString('latin1');
  const trouve = /\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/.exec(texte);
  if (trouve === null) throw new Error('Impossible de lire /Count dans ce PDF.');
  return Number.parseInt(trouve[1]!, 10);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Chaîne complète réelle : réception -> production -> lot de pâte -> session
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Fiche de rappel — chaîne complète réelle (lot -> production -> lot de pâte -> session)', () => {
  let base: BaseBatte;
  let idFournisseur: string;
  let idLieu: string;
  let idR1: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!.id;
    idFournisseur = base
      .select({ id: fournisseur.id })
      .from(fournisseur)
      .where(eq(fournisseur.nom, '[démo] Fournisseur générique'))
      .get()!.id;
    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
  });

  /** Approvisionne tous les ingrédients de R1 SAUF la farine — celle-ci reçoit sa propre réception, ciblée, par test. */
  function approvisionnerSaufFarine(): void {
    const autres = base
      .select()
      .from(ingredient)
      .all()
      .filter((i) => i.nom !== 'Farine de froment T55');
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: autres.map((ing) => ({
        ingredientId: ing.id,
        quantite: 100_000,
        prixLigneCents: 1000,
        numeroLotFournisseur: 'LOT-TEST',
      })),
    });
  }

  function receptionnerFarine(
    numeroLotFournisseur: string,
    dateDlc?: string,
  ): { lotId: string; receptionId: string; receptionNumero: string } {
    const farine = base
      .select()
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!;
    const resultat = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: [
        {
          ingredientId: farine.id,
          quantite: 100_000,
          prixLigneCents: 1000,
          numeroLotFournisseur,
          ...(dateDlc === undefined ? {} : { dateDlc }),
        },
      ],
    });
    return {
      lotId: resultat.lotsCrees[0]!.lotId,
      receptionId: resultat.receptionId,
      receptionNumero: resultat.numero,
    };
  }

  afterAll(async () => {
    if (navigateurPartage !== undefined) await navigateurPartage.close();
  });

  /**
   * LE MAILLON QUE LE GABARIT PUR NE PEUT PAS VOIR : `donneesFicheRappelLot`
   * laissait tomber `quantiteMouvementee` en le remplaçant par la quantité
   * DÉCLARÉE. Un test de gabarit passe des données littérales et ne prouve
   * donc RIEN sur l'assemblage — c'est là que le champ se perdait.
   *
   * LA FIXTURE DOIT DISCRIMINER, et c'est tout l'objet de la sous-consommation
   * ci-dessous : sans écart, théorique et mouvementé seraient ÉGAUX, et un
   * assemblage qui recopierait le mauvais champ resterait vert par chance
   * (docs/39 §3, troisième forme — « trop dégénérée pour discriminer »).
   * 137 g et non 10 : assez pour qu'aucun arrondi ne puisse masquer l'écart.
   */
  it('l’assemblage porte la quantité RÉELLEMENT MOUVEMENTÉE, distincte du théorique ET de la déclaration', () => {
    approvisionnerSaufFarine();
    receptionnerFarine('LOT-FARINE-ECART');

    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const productionLancee = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      sessionId: session.id,
    });

    const avantEcart = donneesFicheRappelLot(base, 'LOT-FARINE-ECART');
    const theorique = avantEcart.productions[0]!.quantiteTheorique;
    // Avant toute déclaration, le stock a sorti exactement le théorique.
    expect(avantEcart.productions[0]!.quantiteMouvementee).toBe(theorique);

    const farine = base
      .select()
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!;
    saisirRealise(base, productionLancee.productionId, {
      volumeReelMl: 4800,
      crepesReelles: 61,
      consommationsReelles: [{ ingredientId: farine.id, quantiteReelle: theorique - 137 }],
    });

    const apresEcart = donneesFicheRappelLot(base, 'LOT-FARINE-ECART');
    const ligne = apresEcart.productions[0]!;
    // 137 g sont revenus AU MÊME lot : le net mouvementé descend d'autant,
    // pendant que le théorique, lui, ne bouge jamais (il est figé au
    // lancement). Les deux chiffres DIFFÈRENT désormais — c'est ce qui rend ce
    // test capable de voir lequel des deux la fiche transporte.
    expect(ligne.quantiteTheorique).toBe(theorique);
    expect(ligne.quantiteMouvementee).toBe(theorique - 137);

    const { html } = ficheRappelLot(apresEcart);
    // Et il arrive jusqu'au document réellement rendu, pas seulement jusqu'aux
    // données : comparé via le formateur du projet, `formaterQuantite` passant
    // par `Intl` (espaces insécables).
    expect(html).toContain(formaterQuantite(theorique - 137, apresEcart.unite));
  });

  it(
    'remonte, depuis un lot de farine identifié par un numéro long et SANS aucun ' +
      'espace ni tiret, la production qui l’a consommé, SON numéro de lot de pâte, et la ' +
      'session où elle est partie — la question exacte que pose un rappel fournisseur',
    () => {
      approvisionnerSaufFarine();
      receptionnerFarine(NUMERO_LOT_SANS_ESPACE, '2026-12-31');

      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      const production = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
        sessionId: session.id,
      });

      // Résolution par le NUMÉRO FOURNISSEUR, pas l'identifiant technique du
      // lot — exactement ce qu'un avis de rappel fournit en pratique
      // (`resoudreLotId`, `packages/db/src/depots/tracabilite.ts`).
      const donnees = donneesFicheRappelLot(base, NUMERO_LOT_SANS_ESPACE);

      expect(donnees.ingredientNom).toBe('Farine de froment T55');
      expect(donnees.fournisseurNom).toBe('[démo] Fournisseur générique');
      expect(donnees.numeroLotFournisseur).toBe(NUMERO_LOT_SANS_ESPACE);
      expect(donnees.unite).toBe('g');
      expect(donnees.productions).toHaveLength(1);
      expect(donnees.productions[0]!.numeroLotPate).toBe(production.numeroLotPate);
      expect(donnees.productions[0]!.numeroLotPate).toMatch(/^PATE-/);
      expect(donnees.productions[0]!.session).not.toBeNull();
      expect(donnees.productions[0]!.session?.numero).toBe(session.numero);
      expect(donnees.productions[0]!.session?.lieuNom).toBe('La Batte');

      const { html } = ficheRappelLot(donnees);
      // Le lot de pâte remonté depuis le lot d'ingrédient, ET la session où il
      // est parti, apparaissent tous les DEUX sur le document réellement rendu.
      expect(html).toContain(production.numeroLotPate);
      expect(html).toContain(session.numero);
      expect(html).toContain('La Batte');
      // Le numéro de lot fournisseur, long et SANS AUCUN ESPACE NI TIRET, reste
      // intégralement présent — jamais tronqué ni perdu (piège n°3 du
      // docblock de `fiche-rappel.ts`) : il n'est jamais placé dans une
      // cellule de tableau, seulement dans un paragraphe libre.
      expect(html).toContain(NUMERO_LOT_SANS_ESPACE);

      // Chaque champ d'identité de l'exploitant est ABSENT (aucun paramètre
      // `exploitant_*` renseigné par ce seed) : un repère distinct PAR CHAMP,
      // jamais une ligne blanche (CLAUDE.md §7).
      expect(html).toContain('Nom non renseigné — à compléter dans Paramètres');
      expect(html).toContain('Adresse non renseignée — à compléter dans Paramètres');
      expect(html).toContain("Numéro d'entreprise non renseigné — à compléter dans Paramètres");
      expect(html).toContain(
        "Numéro d'enregistrement AFSCA non renseigné — à compléter dans Paramètres",
      );
    },
  );

  it(
    'affiche « DLC 31/12/2026 » quand elle est connue, et l’OMET silencieusement ' +
      '(jamais une DLC fabriquée) pour un lot non périssable (`dateDlc === null`)',
    () => {
      const { lotId } = receptionnerFarine('LOT-AVEC-DLC-0001', '2026-12-31');
      const donneesAvecDlc = donneesFicheRappelLot(base, lotId);
      expect(donneesAvecDlc.dateDlc).toBe('2026-12-31');
      expect(ficheRappelLot(donneesAvecDlc).html).toContain('DLC 31/12/2026');

      // Un second lot de farine, SANS DLC cette fois (denrée non périssable à
      // cette échelle, `lot.date_dlc` nullable — `packages/db/src/schema.ts`).
      const { lotId: lotIdSansDlc } = receptionnerFarine('LOT-SANS-DLC-0002');
      const donneesSansDlc = donneesFicheRappelLot(base, lotIdSansDlc);
      expect(donneesSansDlc.dateDlc).toBeNull();
      // Reprend `libelleLotConcerne` (`registre-afsca.ts`) TEL QUEL : un DLC
      // `null` s'omet, elle ne se remplace jamais par une valeur fabriquée.
      expect(ficheRappelLot(donneesSansDlc).html).toContain('LOT-SANS-DLC-0002');
    },
  );

  it(
    'affiche « Annulée depuis » quand la réception d’origine a été annulée après coup, ' +
      'SANS faire disparaître le lot de la fiche (CLAUDE.md §3 règle 7 : « rien ne s’efface »)',
    () => {
      const { lotId, receptionId } = receptionnerFarine('LOT-RECEPTION-ANNULEE-0001');

      const donneesAvant = donneesFicheRappelLot(base, lotId);
      expect(donneesAvant.receptionStatut).toBe('active');
      expect(ficheRappelLot(donneesAvant).html).not.toContain('Annulée depuis');

      // Ce lot n'a jamais servi : l'annulation de sa réception réussit.
      annulerReception(base, receptionId, 'ERREUR_SAISIE');

      const donneesApres = donneesFicheRappelLot(base, lotId);
      // Le lot reste PRÉSENT sur la fiche : seul son statut de réception change.
      expect(donneesApres.ingredientNom).toBe('Farine de froment T55');
      expect(donneesApres.receptionStatut).toBe('annulee');
      expect(ficheRappelLot(donneesApres).html).toContain('Annulée depuis');
    },
  );

  it('« Aucune production n’a consommé ce lot » quand le lot n’a jamais été utilisé', () => {
    const { lotId } = receptionnerFarine('LOT-JAMAIS-UTILISE-0001');
    const donnees = donneesFicheRappelLot(base, lotId);
    expect(donnees.productions).toEqual([]);
    expect(ficheRappelLot(donnees).html).toContain("Aucune production n'a consommé ce lot.");
  });

  it(
    'affiche le statut ACTUEL du lot ET le motif du DERNIER changement, jamais l’un sans ' +
      'l’autre, après un blocage pour rappel fournisseur',
    () => {
      const { lotId } = receptionnerFarine('LOT-BLOQUE-RAPPEL-0001');
      changerStatutLot(base, lotId, 'bloque', 'RAPPEL_FOURNISSEUR', JOUR);

      const donnees = donneesFicheRappelLot(base, lotId);
      expect(donnees.statut).toBe('bloque');
      expect(donnees.motifStatutLibelle).toBe('Bloqué suite à un rappel fournisseur');

      const html = ficheRappelLot(donnees).html;
      // Le mot est entouré d'un `<span class="statut-depassement">` (couleur
      // d'alerte, `libelleLotConcerne`, `registre-afsca.ts`) : on vérifie donc
      // « Statut : » et « Bloqué » séparément, pas une chaîne contiguë.
      expect(html).toContain('Statut : ');
      expect(html).toContain('>Bloqué</span>');
      expect(html).toContain('Dernier changement de statut : Bloqué suite à un rappel fournisseur');

      // La non-conformité ouverte AUTOMATIQUEMENT par ce blocage
      // (`services/mouvements.ts`) doit elle aussi apparaître sur la fiche.
      expect(donnees.nonConformites.length).toBeGreaterThan(0);
      expect(html).toContain('Non-conformités déjà rattachées à ce lot');
    },
  );

  /* ═════════════════════════════════════════════════════════════════════
     PDF réel, forcé à déborder sur plusieurs pages
     ═════════════════════════════════════════════════════════════════════ */

  it(
    'rend un VRAI PDF de plusieurs pages, avec le pied de page (identité + mention) qui ' +
      'porte réellement l’option `options.pied` jusqu’à Chromium — la preuve texte page par ' +
      'page (pdfjs-dist, hors dépôt) est reportée en détail dans le rapport de livraison',
    async () => {
      approvisionnerSaufFarine();
      const { lotId } = receptionnerFarine(NUMERO_LOT_SANS_ESPACE, '2026-12-31');
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
        sessionId: session.id,
      });

      // Beaucoup de non-conformités rattachées à CE lot précis : le moyen le
      // plus simple de forcer un débordement réel sur plusieurs pages (une
      // section de tableau, sans dépendre d'un montage de session/clôture
      // supplémentaire).
      for (let i = 0; i < 45; i++) {
        declarerNonConformite(base, {
          dateConstat: JOUR,
          type: `Contrôle croisé ${i} (test pagination)`,
          description: `Ligne de remplissage n°${i} pour forcer la pagination sur ce lot précis.`,
          gravite: 'mineure',
          lotId,
        });
      }

      const donnees = donneesFicheRappelLot(base, lotId);
      const { html, options } = ficheRappelLot(donnees);
      expect(options.pied).toBeDefined();
      expect(options.pied).toContain(NUMERO_LOT_SANS_ESPACE);
      expect(options.pied).toContain('pageNumber');
      expect(options.pied).toContain('totalPages');

      const dossier = mkdtempSync(join(tmpdir(), 'batte-fiche-rappel-'));
      const chemin = join(dossier, 'fiche-rappel.pdf');
      try {
        await rendrePdfDirect(html, options.pied, chemin);

        expect(existsSync(chemin)).toBe(true);
        expect(readFileSync(chemin).subarray(0, 4).toString()).toBe('%PDF');
        expect(readFileSync(chemin).length).toBeGreaterThan(5000);
        // Preuve dépourvue de toute bibliothèque de parsing PDF (voir le
        // docblock de fichier) : un VRAI débordement sur plusieurs pages a eu
        // lieu, ce n'est pas resté un document d'une seule page.
        expect(nombreDePages(chemin)).toBeGreaterThan(1);
      } finally {
        rmSync(dossier, { recursive: true, force: true });
      }
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   Gabarit PUR : ventes directes et garnitures (données littérales, sans base)
   ═══════════════════════════════════════════════════════════════════════════ */

const DONNEES_MINIMALES: DonneesFicheRappelLot = {
  dateGeneration: new Date('2026-08-01T08:00:00Z'),
  exploitant: { nom: null, adresse: null, numeroEntreprise: null, numeroEnregistrementAfsca: null },
  ingredientNom: 'Sirop de Liège (test)',
  fournisseurNom: 'Producteur local (test)',
  numeroLotFournisseur: 'LOT-SIROP-0001',
  dateDlc: '2027-01-01',
  unite: 'piece',
  dateReception: '2026-07-01',
  receptionNumero: 'RC-2026-0099',
  receptionStatut: 'active',
  statut: 'disponible',
  motifStatutLibelle: null,
  dateChangementStatut: null,
  nonConformites: [],
  productions: [],
  ventes: [],
  garnitures: [],
};

describe('Fiche de rappel — gabarit pur : ventes directes', () => {
  it('« Aucune sortie vendue telle quelle » sans aucune vente directe', () => {
    const { html } = ficheRappelLot(DONNEES_MINIMALES);
    expect(html).toContain('Aucune sortie vendue telle quelle pour ce lot.');
  });

  it('affiche la quantité, la date et la session d’une vente directe (article revendu)', () => {
    const donnees: DonneesFicheRappelLot = {
      ...DONNEES_MINIMALES,
      ventes: [
        {
          quantite: 3,
          dateMouvement: '2026-07-27',
          session: { numero: 'SM-2026-0002', dateSession: '2026-07-27', lieuNom: 'La Batte' },
        },
      ],
    };
    const { html } = ficheRappelLot(donnees);
    expect(html).toContain('Sorties vendues telles quelles');
    expect(html).toContain('SM-2026-0002');
    expect(html).toContain('La Batte');
    expect(html).toContain('27/07/2026');
  });
});

describe('Fiche de rappel — gabarit pur : garnitures', () => {
  it('« Aucune sortie en garniture » sans aucune sortie étalée', () => {
    const { html } = ficheRappelLot(DONNEES_MINIMALES);
    expect(html).toContain('Aucune sortie en garniture pour ce lot.');
  });

  it('affiche les PRODUITS portant la garniture, pas seulement la session', () => {
    const donnees: DonneesFicheRappelLot = {
      ...DONNEES_MINIMALES,
      garnitures: [
        {
          quantite: 2,
          dateMouvement: '2026-07-27',
          session: { numero: 'SM-2026-0002', dateSession: '2026-07-27', lieuNom: 'La Batte' },
          produits: ['Crêpe froment / Sirop de Liège', 'Crêpe sarrasin / Sirop de Liège'],
        },
      ],
    };
    const { html } = ficheRappelLot(donnees);
    expect(html).toContain('Sorties étalées en garniture');
    expect(html).toContain('Crêpe froment / Sirop de Liège');
    expect(html).toContain('Crêpe sarrasin / Sirop de Liège');
  });

  it('affiche le libellé de session « en attente d’affectation » pour une production sans session', () => {
    const donnees: DonneesFicheRappelLot = {
      ...DONNEES_MINIMALES,
      productions: [
        {
          numero: 'PR-2026-0042',
          numeroLotPate: 'PATE-PR-2026-0042',
          dateProduction: '2026-07-27',
          quantiteTheorique: 145,
          quantiteMouvementee: 145,
          session: null,
        },
      ],
    };
    const { html } = ficheRappelLot(donnees);
    expect(html).toContain('PATE-PR-2026-0042');
    expect(html).toContain("En attente d'affectation à une session.");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le lot venu D'AILLEURS — ce que la fiche disait de faux jusqu'au 01/08/2026
   ═══════════════════════════════════════════════════════════════════════════

   Quand le porteur déclare avoir consommé PLUS que le théorique, la matière en
   trop est prise en FEFO sur le stock du jour : elle peut donc tomber sur un
   lot que la fournée n'avait PAS prévu. Ce lot a réellement alimenté la pâte.

   La fiche affichait alors « 0 théorique / — réel » sur cette ligne : deux
   chiffres qui, lus ensemble, disculpent le lot que le rappel vise. Le « — »
   n'était même pas un défaut d'affichage — `quantiteReelle` est la quantité
   DÉCLARÉE pour l'INGRÉDIENT entier, et elle est `null` par construction dès
   que plusieurs lots ont servi, c'est-à-dire dans ce cas précis.

   FIXTURE DISCRIMINANTE (docs/39 §3) : trois productions, trois situations
   distinctes. Une fixture où les trois lignes se ressemblent ne prouverait
   rien — en particulier, la quantité mouvementée DIFFÈRE du théorique sur deux
   des trois lignes, sans quoi afficher l'un ou l'autre champ donnerait le même
   texte.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Fiche de rappel — le lot que la fournée n’avait pas prévu', () => {
  const DONNEES_RAPPEL: DonneesFicheRappelLot = {
    ...DONNEES_MINIMALES,
    ingredientNom: 'Farine de froment T55 (test)',
    unite: 'g',
    productions: [
      // 1. LE cas du rappel : rien n'était prévu de ce lot, 287 g en sont sortis.
      {
        numero: 'PR-2026-0007',
        numeroLotPate: 'PATE-PR-2026-0007',
        dateProduction: '2026-07-25',
        quantiteTheorique: 0,
        quantiteMouvementee: 287,
        session: { numero: 'SM-2026-0031', dateSession: '2026-07-26', lieuNom: 'La Batte' },
      },
      // 2. Prévu et servi : la mention « hors fournée » ne doit PAS y apparaître.
      {
        numero: 'PR-2026-0008',
        numeroLotPate: 'PATE-PR-2026-0008',
        dateProduction: '2026-07-18',
        quantiteTheorique: 1180,
        quantiteMouvementee: 1180,
        session: { numero: 'SM-2026-0030', dateSession: '2026-07-19', lieuNom: 'La Batte' },
      },
      // 3. Prévu puis INTÉGRALEMENT restitué : un VRAI zéro, jamais « — ».
      {
        numero: 'PR-2026-0009',
        numeroLotPate: 'PATE-PR-2026-0009',
        dateProduction: '2026-07-11',
        quantiteTheorique: 512,
        quantiteMouvementee: 0,
        session: null,
      },
    ],
  };

  it('la colonne « Réel » a cédé la place à « Sorti du lot » — la seule des trois quantités attribuable au lot', () => {
    const { html } = ficheRappelLot(DONNEES_RAPPEL);
    expect(html).toContain('<th class="num">Sorti du lot</th>');
    // Et l'ancien en-tête a disparu : le garder en lui faisant dire une autre
    // valeur ferait relire le nouveau chiffre avec l'ancienne signification.
    expect(html).not.toContain('<th class="num">Réel</th>');
  });

  it('le lot venu d’ailleurs porte sa quantité RÉELLEMENT sortie, et la mention « hors fournée »', () => {
    const { html } = ficheRappelLot(DONNEES_RAPPEL);

    // Comparé via le formateur du projet, jamais un littéral : `formaterQuantite`
    // passe par `Intl`, qui insère des espaces insécables.
    expect(html).toContain(formaterQuantite(287, 'g'));
    expect(html).toContain('hors fournée');
    // La pâte et le marché concernés restent nommés : c'est la portée du rappel.
    expect(html).toContain('PATE-PR-2026-0007');
    expect(html).toContain('SM-2026-0031');
  });

  it('la mention ne s’applique QU’au lot hors fournée — sinon elle ne distinguerait rien', () => {
    const { html } = ficheRappelLot(DONNEES_RAPPEL);
    // Trois productions au tableau, une seule mention.
    expect(html.match(/hors fournée/g) ?? []).toHaveLength(1);
  });

  it('une restitution intégrale affiche un VRAI zéro, jamais le tiret d’une valeur inconnue', () => {
    const { html } = ficheRappelLot(DONNEES_RAPPEL);
    expect(html).toContain(formaterQuantite(0, 'g'));
    // `0` dit « la matière est repartie au stock » ; « — » dirait « on ne
    // sait pas ». Sur un rappel, les deux mènent à des décisions opposées.
    expect(html).not.toContain(`<td class="num">${TIRET_ABSENT}</td>`);
  });

  it('la mention reste NEUTRE : un écart comblé ailleurs n’est pas une non-conformité', () => {
    const { html } = ficheRappelLot(DONNEES_RAPPEL);
    // `statut-alerte` est le registre d'alerte du document (réservé à une
    // non-conformité non résolue, à une réception annulée). Le mélanger ici le
    // rendrait illisible là où il compte.
    expect(html).not.toMatch(/class="statut-alerte"[^>]*>[^<]*hors fournée/);
    expect(html).toContain(`color:${COULEURS_IMPRESSION.encreTertiaire}">— hors fournée`);
  });
});

describe('Fiche de rappel — échappement du balisage', () => {
  it('échappe un nom de fournisseur contenant « < » — jamais interprété comme du balisage', () => {
    const donnees: DonneesFicheRappelLot = {
      ...DONNEES_MINIMALES,
      fournisseurNom: 'Fournisseur <script>alert(1)</script> & fils',
    };
    const { html } = ficheRappelLot(donnees);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });
});
