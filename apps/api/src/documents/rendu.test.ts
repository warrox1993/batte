/**
 * Tests d'integration du Lot 6.
 *
 * Verifie la chaine complete HTML -> Playwright -> fichier archive, et surtout
 * le mecanisme d'ARCHIVAGE : un document emis ne doit jamais pouvoir etre
 * remplace en silence par une version recalculee plus tard (docs/07 §6.5).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { creerBase, migrer, schema, seed, type BaseBatte } from '@batte/db';
import { eq } from 'drizzle-orm';
import {
  affichetteAllergenes,
  bonCommande,
  briefAvantMarche,
  etiquetteBac,
  ficheTechnique,
  rapportSession,
} from './gabarits.js';
import { registreAfscaMensuel } from './registre-afsca.js';
import {
  archiverFichierGenere,
  fermerNavigateur,
  rendrePdf,
  verifierIntegrite,
  versionsDocument,
} from './rendu.js';

// DEFAUT CORRIGÉ (diagnostic du 31/07/2026) : `vi.setConfig` doit s'executer
// PENDANT LA COLLECTE (donc au niveau du module, avant tout `describe`), pas
// a l'interieur d'un `beforeAll` — Vitest fige le `timeout` effectif de
// chaque `it`/`beforeAll`/`afterAll` au moment ou celui-ci est ENREGISTRÉ
// (l'appel a `it(...)`/`beforeAll(...)` lui-meme), toujours executé pendant la
// collecte. Un `vi.setConfig` appele DANS le corps d'un `beforeAll` (l'ancien
// code, ici) s'execute pendant la phase de RUN, apres coup : il ne change
// donc jamais le timeout du PREMIER test de ce fichier, ni celui d'aucun hook
// enregistre avant lui — reproduit deterministement (aucune charge requise)
// avec un fichier de test minimal, voir le rapport de livraison. Consequence
// mesuree sur ce depot : le premier test ci-dessous et le hook `afterAll` (qui
// ferme Chromium, `fermerNavigateur`) restaient au defaut Vitest (5 s / 10 s)
// malgre ce `vi.setConfig`, et echouaient sous la contention reelle d'une
// suite complete (« Test timed out in 5000ms », « Hook timed out in
// 10000ms »), jamais fichier seul. Le placer ICI, avant le premier `describe`,
// couvre desormais TOUS les tests et hooks de ce fichier, `afterAll` compris.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const FICHE = {
  code: 'R1',
  nom: 'Pâte à crêpes froment',
  version: 1,
  sansGluten: false,
  rendementMl: 455,
  rendementCrepes: 6,
  procede: 'Mélanger la farine, le sel et les sucres. Incorporer les œufs puis le lait.',
  lignes: [
    {
      nomIngredient: 'Farine T55',
      quantite: 145,
      unite: 'g' as const,
      coutCents: 11,
      noteTechnique: null,
    },
    {
      nomIngredient: 'Lait entier',
      quantite: 240,
      unite: 'ml' as const,
      coutCents: 28,
      noteTechnique: null,
    },
  ],
  coutMatiereCents: 39,
  coutParCrepeCents: 7,
  allergenes: ['gluten', 'lait', 'oeufs'],
  allergenesVerifies: true,
};

describe('Lot 6 — chaîne de rendu PDF', () => {
  let base: BaseBatte;
  const cheminsCrees: string[] = [];

  beforeAll(() => {
    // Le delai par defaut de vitest (5000 ms) mesure une machine a vide, pas
    // le demarrage de Chromium. `obtenirNavigateur` (rendu.ts) le lance de
    // maniere paresseuse AU PREMIER rendu de ce fichier : sur un poste charge
    // (autre suite en cours, antivirus qui scanne le binaire au premier
    // lancement), ce demarrage peut depasser 5 s en pratique alors que chaque
    // generation de PDF prend par ailleurs quelques centaines de
    // millisecondes (vu ci-dessous). Le `vi.setConfig` qui couvrait ce risque
    // vit desormais en tete de fichier, PAS ici (voir son commentaire) : place
    // dans ce `beforeAll`, il s'appliquait trop tard pour changer le timeout
    // du premier test.
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  afterAll(async () => {
    await fermerNavigateur();
    // Les tests ecrivent de vrais PDF : on nettoie derriere nous.
    for (const chemin of cheminsCrees) {
      if (existsSync(chemin)) rmSync(chemin, { force: true });
    }
  });

  it('génère une fiche technique lisible et non vide', async () => {
    const doc = await rendrePdf(base, {
      type: 'fiche_technique',
      objetId: 'r1',
      numero: 'R1',
      titre: 'Fiche technique R1',
      ...ficheTechnique(FICHE),
    });
    cheminsCrees.push(doc.chemin);

    expect(existsSync(doc.chemin)).toBe(true);
    // Un PDF d'une page avec du contenu pese au moins quelques kilo-octets ;
    // un fichier de 500 octets signalerait un rendu vide.
    expect(doc.tailleOctets).toBeGreaterThan(2000);
    // Signature du format : tout PDF commence par %PDF.
    expect(readFileSync(doc.chemin).subarray(0, 4).toString()).toBe('%PDF');
  });

  it("génère l'affichette allergènes, obligation AFSCA", async () => {
    const doc = await rendrePdf(base, {
      type: 'affichette_allergenes',
      objetId: null,
      numero: null,
      titre: 'Affichette allergènes',
      ...affichetteAllergenes({
        produits: [
          {
            nom: 'Crêpe froment / cassonade',
            allergenes: ['gluten', 'lait', 'oeufs'],
            allergenesVerifies: true,
            allergenesSurDemande: [],
          },
          {
            nom: 'Crêpe sarrasin nature',
            allergenes: [],
            allergenesVerifies: true,
            allergenesSurDemande: [],
          },
          {
            nom: 'Café à emporter',
            allergenes: [],
            allergenesVerifies: true,
            allergenesSurDemande: ['lait'],
          },
        ],
        dateGeneration: new Date('2026-08-02T08:00:00Z'),
      }),
    });
    cheminsCrees.push(doc.chemin);

    expect(existsSync(doc.chemin)).toBe(true);
    expect(doc.tailleOctets).toBeGreaterThan(2000);
  });

  it('génère une étiquette de bac avec sa DLC', async () => {
    const doc = await rendrePdf(base, {
      type: 'etiquette_bac',
      objetId: 'prod-1',
      numero: 'PATE-PR-2026-0001',
      titre: 'Étiquette PATE-PR-2026-0001',
      ...etiquetteBac({
        numeroLotPate: 'PATE-PR-2026-0001',
        recetteCode: 'R1',
        recetteNom: 'Pâte à crêpes froment',
        dateProduction: '2026-08-01T18:00:00Z',
        dateDlc: '2026-08-02T18:00:00Z',
        volumeMl: 5000,
        allergenes: ['gluten', 'lait', 'oeufs'],
        allergenesVerifies: true,
      }),
    });
    cheminsCrees.push(doc.chemin);

    expect(existsSync(doc.chemin)).toBe(true);
  });

  it('génère un rapport de session', async () => {
    const doc = await rendrePdf(base, {
      type: 'rapport_session',
      objetId: 'sess-1',
      numero: 'SM-2026-0001',
      titre: 'Rapport SM-2026-0001',
      ...rapportSession({
        numero: 'SM-2026-0001',
        lieuNom: 'La Batte',
        dateSession: '2026-08-02',
        ventes: [
          {
            nomProduit: 'Crêpe froment / cassonade',
            quantite: 24,
            prixUnitaireCents: 300,
            montantCents: 7200,
          },
        ],
        caTotalCents: 7200,
        caTransformeCents: 7200,
        caRevenduCents: 0,
        caEspecesCents: 7200,
        caCarteCents: 0,
        ecartCaisseCents: 0,
        coutMatiereCents: 0,
        commissionCarteCents: 0,
        fraisTotauxCents: 4200,
        margeBruteCents: 7200,
        margeNetteCents: 3000,
        margeParHeureCents: 462,
        crepesProduites: 30,
        crepesVendues: 24,
        crepesInvendues: 5,
        crepesCassees: 1,
        tauxEcoulementBp: 8000,
        notesQualitatives: null,
      }),
    });
    cheminsCrees.push(doc.chemin);

    expect(existsSync(doc.chemin)).toBe(true);
    expect(doc.tailleOctets).toBeGreaterThan(2000);
  });

  it('génère un brief avant-marché, avec ses alertes de stock et de DLC', async () => {
    const doc = await rendrePdf(base, {
      type: 'brief_avant_marche',
      objetId: 'sess-brief',
      numero: 'SM-2026-0002',
      titre: 'Brief SM-2026-0002',
      ...briefAvantMarche({
        session: { numero: 'SM-2026-0002', dateSession: '2026-08-09', lieuNom: 'La Batte' },
        crepesRecommandees: 150,
        crepesRetenues: 134,
        contrainteLimitante: 'Fenêtre de cuisson',
        manqueAGagnerCents: 4200,
        confianceBp: 7000,
        nbSessionsComparables: 6,
        baseline: { baselineCrepes: 120, explication: 'Moyenne bayésienne sur 6 sessions.' },
        facteurs: { meteoBp: 12000, evenementBp: 10000, saisonBp: 10000, tendanceBp: 10000 },
        evenements: [],
        meteo: {
          disponible: true,
          temperatureC: 21,
          precipitationsMm: 0,
          ventKmh: 12,
          ventFort: false,
          explication: 'Ensoleillé et doux.',
        },
        contraintes: [
          { libelle: 'Fenêtre de cuisson', plafondCrepes: 134 },
          { libelle: 'Glacière', plafondCrepes: 220 },
        ],
        alertesStock: [
          { nomIngredient: 'Farine T55', quantiteDisponible: 500, stockSecurite: 2000, unite: 'g' },
        ],
        horizonJours: 7,
        alertesDlc: [
          { ingredientNom: 'Lait entier', numeroLotFournisseur: 'LOT-0042', dateDlc: '2026-08-10' },
        ],
      }),
    });
    cheminsCrees.push(doc.chemin);

    expect(existsSync(doc.chemin)).toBe(true);
    expect(doc.tailleOctets).toBeGreaterThan(2000);
  });

  /**
   * Défaut corrigé (mission « brief vs écrans ») : `brief_horizon_alerte_dlc_jours`
   * était lu par la route (`routes/previsions.ts`) mais jamais transmis au
   * gabarit, dont le titre « Lots proches de leur DLC » ne disait pas sur
   * quelle fenêtre il comptait — alors que l'écran Stock utilise un défaut
   * DIFFÉRENT (14 jours, `formaterJoursRestants`). Un même jour, sur la même
   * base, le brief et l'écran pouvaient afficher des comptes différents sans
   * qu'aucun des deux ne dise pourquoi. Ce test fixe la fenêtre dans le HTML
   * rendu, avec ET sans alerte, pour que la régression casse un test lisible
   * plutôt qu'une inspection visuelle du PDF.
   */
  it('énonce la fenêtre DLC dans le titre de section, avec et sans lot à signaler', () => {
    const avecAlerte = briefAvantMarche({
      session: { numero: 'SM-2026-0002', dateSession: '2026-08-09', lieuNom: 'La Batte' },
      crepesRecommandees: 150,
      crepesRetenues: 134,
      contrainteLimitante: null,
      manqueAGagnerCents: null,
      confianceBp: 7000,
      nbSessionsComparables: 6,
      baseline: { baselineCrepes: 120, explication: 'Moyenne bayésienne sur 6 sessions.' },
      facteurs: { meteoBp: 12000, evenementBp: 10000, saisonBp: 10000, tendanceBp: 10000 },
      evenements: [],
      meteo: { disponible: false, raison: "Le lieu n'a pas de coordonnées." },
      contraintes: [],
      alertesStock: [],
      horizonJours: 7,
      alertesDlc: [
        { ingredientNom: 'Lait entier', numeroLotFournisseur: 'LOT-0042', dateDlc: '2026-08-10' },
      ],
    });
    expect(avecAlerte.html).toContain('Lots à moins de 7 jours de leur DLC');
    // L'ancien titre, muet sur la fenêtre, ne doit plus apparaître.
    expect(avecAlerte.html).not.toContain('Lots proches de leur DLC');

    const sansAlerte = briefAvantMarche({
      session: { numero: 'SM-2026-0003', dateSession: '2026-08-16', lieuNom: 'La Batte' },
      crepesRecommandees: 120,
      crepesRetenues: 120,
      contrainteLimitante: null,
      manqueAGagnerCents: null,
      confianceBp: 4000,
      nbSessionsComparables: 1,
      baseline: { baselineCrepes: 120, explication: 'Prior de départ.' },
      facteurs: { meteoBp: 10000, evenementBp: 10000, saisonBp: 10000, tendanceBp: 10000 },
      evenements: [],
      meteo: { disponible: false, raison: "Le lieu n'a pas de coordonnées." },
      contraintes: [],
      alertesStock: [],
      // Fenêtre volontairement différente de l'autre cas, pour prouver que le
      // texte suit VRAIMENT le paramètre au lieu d'un « 7 » écrit en dur dans
      // le gabarit.
      horizonJours: 3,
      alertesDlc: [],
    });
    expect(sansAlerte.html).toContain('Lots à moins de 3 jours de leur DLC');
    expect(sansAlerte.html).toContain('Aucun lot à moins de 3 jours de sa DLC.');
  });

  it('génère un brief avant-marché sans aucune alerte ni météo disponible', async () => {
    // Cas degrade : ni meteo, ni alerte — le gabarit doit rester valide et
    // dire explicitement qu'il n'y a rien a signaler (CLAUDE.md §5, mode
    // degrade complet).
    const doc = await rendrePdf(base, {
      type: 'brief_avant_marche',
      objetId: 'sess-brief-degrade',
      numero: 'SM-2026-0003',
      titre: 'Brief SM-2026-0003',
      ...briefAvantMarche({
        session: { numero: 'SM-2026-0003', dateSession: '2026-08-16', lieuNom: 'La Batte' },
        crepesRecommandees: 120,
        crepesRetenues: 120,
        contrainteLimitante: null,
        manqueAGagnerCents: null,
        confianceBp: 4000,
        nbSessionsComparables: 1,
        baseline: {
          baselineCrepes: 120,
          explication: 'Prior de départ, aucune session comparable.',
        },
        facteurs: { meteoBp: 10000, evenementBp: 10000, saisonBp: 10000, tendanceBp: 10000 },
        evenements: [],
        meteo: { disponible: false, raison: "Le lieu n'a pas de coordonnées." },
        contraintes: [],
        alertesStock: [],
        horizonJours: 7,
        alertesDlc: [],
      }),
    });
    cheminsCrees.push(doc.chemin);

    expect(existsSync(doc.chemin)).toBe(true);
    expect(doc.tailleOctets).toBeGreaterThan(2000);
  });

  it('génère un bon de commande fournisseur, avec la mention de franchise TVA', async () => {
    const rendu = bonCommande({
      numero: 'BC-2026-0001',
      fournisseurNom: 'Moulin de Statte',
      fournisseurEmail: 'commandes@moulin-statte.be',
      dateCreation: '2026-08-01T09:00:00Z',
      dateReceptionSouhaitee: '2026-08-08',
      lignes: [
        {
          nomIngredient: 'Farine T55',
          conditionnementLibelle: 'Sac 25 kg',
          quantiteConditionnements: 2,
          quantiteUniteRef: 50_000,
          unite: 'g',
          montantLigneCents: 4500,
        },
        {
          nomIngredient: 'Lait entier',
          conditionnementLibelle: null,
          quantiteConditionnements: 0,
          quantiteUniteRef: 12_000,
          unite: 'ml',
          montantLigneCents: 1080,
        },
      ],
      montantTotalCents: 5580,
      notes: null,
    });
    const doc = await rendrePdf(base, {
      type: 'bon_commande',
      objetId: 'cmd-1',
      numero: 'BC-2026-0001',
      titre: 'Bon de commande BC-2026-0001',
      ...rendu,
    });
    cheminsCrees.push(doc.chemin);

    expect(existsSync(doc.chemin)).toBe(true);
    expect(doc.tailleOctets).toBeGreaterThan(2000);
    // La franchise de TVA doit figurer sur tout document commercial sortant
    // (CLAUDE.md §6) : contrairement au brief avant-marché, ce PDF est envoyé
    // au fournisseur.
    expect(rendu.html).toContain('franchise des petites entreprises');
  });

  it('archive chaque document avec son empreinte', async () => {
    const doc = await rendrePdf(base, {
      type: 'fiche_technique',
      objetId: 'r-archive',
      numero: 'RX',
      titre: 'Archive',
      ...ficheTechnique(FICHE),
    });
    cheminsCrees.push(doc.chemin);

    const enBase = base
      .select()
      .from(schema.documentGenere)
      .where(eq(schema.documentGenere.id, doc.id))
      .get()!;

    expect(enBase.hashSha256).toHaveLength(64);
    expect(enBase.hashSha256).toBe(doc.hashSha256);
    expect(enBase.chemin).toBe(doc.chemin);
  });

  it('regénérer crée une NOUVELLE VERSION, jamais un écrasement', async () => {
    // C'est tout l'enjeu : le registre présenté à un contrôle en mars ne doit
    // pas pouvoir être remplacé par une version recalculée en septembre.
    const v1 = await rendrePdf(base, {
      type: 'rapport_session',
      objetId: 'sess-versions',
      numero: 'SM-2026-0099',
      titre: 'V1',
      ...ficheTechnique(FICHE),
    });
    const v2 = await rendrePdf(base, {
      type: 'rapport_session',
      objetId: 'sess-versions',
      numero: 'SM-2026-0099',
      titre: 'V2',
      ...ficheTechnique({ ...FICHE, coutMatiereCents: 9999 }),
    });
    cheminsCrees.push(v1.chemin, v2.chemin);

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    // Les DEUX fichiers existent encore : rien n'est effacé.
    expect(existsSync(v1.chemin)).toBe(true);
    expect(existsSync(v2.chemin)).toBe(true);
    expect(v1.chemin).not.toBe(v2.chemin);

    const versions = versionsDocument(base, 'rapport_session', 'sess-versions');
    expect(versions).toHaveLength(2);
    expect(versions[0]?.version).toBe(2); // la plus récente en premier
  });

  it('confirme l intégrité d un document intact', async () => {
    const doc = await rendrePdf(base, {
      type: 'fiche_technique',
      objetId: 'r-integre',
      numero: 'RI',
      titre: 'Intègre',
      ...ficheTechnique(FICHE),
    });
    cheminsCrees.push(doc.chemin);

    expect(verifierIntegrite(base, doc.id)).toEqual({ intact: true, raison: null });
  });

  it('DÉTECTE un document altéré après émission', async () => {
    const doc = await rendrePdf(base, {
      type: 'fiche_technique',
      objetId: 'r-altere',
      numero: 'RA',
      titre: 'Altéré',
      ...ficheTechnique(FICHE),
    });
    cheminsCrees.push(doc.chemin);

    writeFileSync(doc.chemin, 'contenu falsifié');

    const controle = verifierIntegrite(base, doc.id);
    expect(controle.intact).toBe(false);
    expect(controle.raison).toContain('modifié');
  });

  it('signale un fichier disparu du disque', async () => {
    const doc = await rendrePdf(base, {
      type: 'fiche_technique',
      objetId: 'r-disparu',
      numero: 'RD',
      titre: 'Disparu',
      ...ficheTechnique(FICHE),
    });

    rmSync(doc.chemin, { force: true });

    const controle = verifierIntegrite(base, doc.id);
    expect(controle.intact).toBe(false);
    expect(controle.raison).toContain('introuvable');
  });

  it('échappe le balisage venant des données', async () => {
    // Un nom de fournisseur contenant « < » casserait le rendu, ou pire, serait
    // interprété comme du balisage.
    const { html } = ficheTechnique({
      ...FICHE,
      nom: 'Pâte <script>alert(1)</script> & compagnie',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });
});

/**
 * Garde du défaut GRAVE de l'audit du 31/07/2026 (docs/24 §2.2) : chaque
 * gabarit calculait bien un pied de page, mais `documentHtml` (`rendu.ts`)
 * n'utilisait jamais `options.pied`, et le champ RÉELLEMENT lu par Playwright
 * — `DemandeRendu.options.pied` — n'était renseigné par AUCUN des 6 appelants.
 * Le pied de page conçu dans chaque gabarit n'atteignait donc JAMAIS l'appel
 * réel à `page.pdf()`.
 *
 * Ce test vérifie la partie qui a précisément cassé : que `options.pied`,
 * calculé par le gabarit, ressorte bien de la fonction — c'est exactement la
 * valeur qu'un appelant (`routes/documents.ts`, `routes/commandes.ts`,
 * `routes/previsions.ts`) doit désormais transmettre à `rendrePdf` via
 * `...rendu`. La preuve que le pied s'imprime RÉELLEMENT sur chaque page — le
 * mécanisme Playwright lui-même — est apportée par des PDF produits et lus
 * (voir le rapport de cette mission), pas par ce test unitaire : un test sur
 * le HTML ne voit pas ce que Chromium peint dans la marge de page.
 */
describe('Lot 6 — pied de page : le câblage options.pied ressort de chaque gabarit', () => {
  it.each([
    ['ficheTechnique', () => ficheTechnique(FICHE), 'Fiche technique R1 v1'],
    [
      'rapportSession',
      () =>
        rapportSession({
          numero: 'SM-2026-0001',
          lieuNom: 'La Batte',
          dateSession: '2026-08-02',
          ventes: [],
          caTotalCents: 0,
          caTransformeCents: 0,
          caRevenduCents: 0,
          caEspecesCents: 0,
          caCarteCents: 0,
          ecartCaisseCents: 0,
          coutMatiereCents: 0,
          commissionCarteCents: 0,
          fraisTotauxCents: 0,
          margeBruteCents: 0,
          margeNetteCents: 0,
          margeParHeureCents: null,
          crepesProduites: 0,
          crepesVendues: 0,
          crepesInvendues: 0,
          crepesCassees: 0,
          tauxEcoulementBp: null,
          notesQualitatives: null,
        }),
      'Rapport de session SM-2026-0001',
    ],
    [
      'bonCommande',
      () =>
        bonCommande({
          numero: 'BC-2026-0001',
          fournisseurNom: 'Moulin de Statte',
          fournisseurEmail: null,
          dateCreation: '2026-08-01',
          dateReceptionSouhaitee: null,
          lignes: [],
          montantTotalCents: 0,
          notes: null,
        }),
      'Bon de commande BC-2026-0001',
    ],
    [
      'registreAfscaMensuel',
      () =>
        registreAfscaMensuel({
          periodeLibelle: 'Juillet 2026',
          dateGeneration: new Date('2026-08-01T00:00:00.000Z'),
          exploitant: {
            nom: null,
            adresse: null,
            numeroEntreprise: null,
            numeroEnregistrementAfsca: null,
          },
          temperatures: [],
          nettoyages: [],
          nonConformites: [],
          exercicesTracabilite: [],
        }),
      'Registre AFSCA — Juillet 2026',
    ],
  ] as const)(
    '%s expose un `options.pied` non vide et nommé, celui qui doit désormais atteindre rendrePdf',
    (_nom, construire, mentionAttendue) => {
      const rendu = construire();
      expect(rendu.options.pied).toBeDefined();
      expect(rendu.options.pied).toContain(mentionAttendue);
      // Le mécanisme de numérotation automatique de Chromium (page.pdf()),
      // jamais un numéro calculé à la main.
      expect(rendu.options.pied).toContain('pageNumber');
      expect(rendu.options.pied).toContain('totalPages');
    },
  );

  it(
    'briefAvantMarche expose aussi un `options.pied` non vide (vérifié séparément : ' +
      'sa signature de données est plus longue que les autres)',
    () => {
      const rendu = briefAvantMarche({
        session: { numero: 'SM-2026-0002', dateSession: '2026-08-09', lieuNom: 'La Batte' },
        crepesRecommandees: 120,
        crepesRetenues: 120,
        contrainteLimitante: null,
        manqueAGagnerCents: null,
        confianceBp: 4000,
        nbSessionsComparables: 1,
        baseline: { baselineCrepes: 120, explication: 'Prior de départ.' },
        facteurs: { meteoBp: 10000, evenementBp: 10000, saisonBp: 10000, tendanceBp: 10000 },
        evenements: [],
        meteo: { disponible: false, raison: "Le lieu n'a pas de coordonnées." },
        contraintes: [],
        alertesStock: [],
        horizonJours: 7,
        alertesDlc: [],
      });
      expect(rendu.options.pied).toBeDefined();
      expect(rendu.options.pied).toContain('Brief avant-marché SM-2026-0002');
    },
  );

  it(
    "affichetteAllergenes et etiquetteBac n'ont VOLONTAIREMENT aucun pied de page " +
      '(rendu.ts : « Omis pour les etiquettes et affichettes ») — options.pied doit ' +
      'rester `undefined`, jamais une chaîne vide qui afficherait un pied fantôme',
    () => {
      const affichette = affichetteAllergenes({
        produits: [],
        dateGeneration: new Date('2026-08-02T08:00:00Z'),
      });
      expect(affichette.options.pied).toBeUndefined();

      const etiquette = etiquetteBac({
        numeroLotPate: 'PATE-PR-2026-0001',
        recetteCode: 'R1',
        recetteNom: 'Pâte à crêpes froment',
        dateProduction: '2026-08-01T18:00:00Z',
        dateDlc: '2026-08-02T18:00:00Z',
        volumeMl: 5000,
        allergenes: [],
        allergenesVerifies: true,
      });
      expect(etiquette.options.pied).toBeUndefined();
    },
  );
});

/**
 * CodeQL js/file-system-race (28/09/2026) : la taille venait d'un `statSync`,
 * l'empreinte d'un `readFileSync` ulterieur. Les deux decrivent desormais le
 * MEME contenu, lu une seule fois.
 */
describe('archiverFichierGenere — taille et empreinte d’une seule lecture', () => {
  it('archive la taille et l’empreinte exactes des octets écrits', async () => {
    const base = creerBase(':memory:');
    migrer(base);
    const octets = Buffer.from('contenu de test : taille et empreinte cohérentes\n'.repeat(50));

    const doc = await archiverFichierGenere(
      base,
      { type: 'fiche_technique', objetId: 'essai-course', numero: 'ESSAI', extension: 'txt' },
      (chemin) => writeFileSync(chemin, octets),
    );
    try {
      expect(doc.tailleOctets).toBe(octets.length);
      expect(doc.hashSha256).toBe(createHash('sha256').update(octets).digest('hex'));
      expect(verifierIntegrite(base, doc.id)).toEqual({ intact: true, raison: null });
    } finally {
      rmSync(doc.chemin, { force: true });
    }
  });
});
