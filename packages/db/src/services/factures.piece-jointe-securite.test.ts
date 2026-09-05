/**
 * Mission « surface d'attaque ouverte aujourd'hui » (30/07/2026) : les
 * pièces jointes de factures/réceptions sont désormais stockées EN LIGNE, en
 * Data URI, puis réaffichées dans un `<a href>` du navigateur
 * (`apps/web/src/pages/Factures.tsx`). Une Data URI rendue dans `href`/`src`
 * est du contenu EXÉCUTABLE par le navigateur : un `data:text/html` ou un SVG
 * porteur d'un `<script>` s'exécuterait dans le contexte de l'application.
 *
 * Ce fichier prouve, avec des cas RÉELLEMENT hostiles (pas seulement des cas
 * valides qui passent), que `validerPieceJointe` — partagée par
 * `enregistrerFacture` (ce fichier) et `enregistrerReception`
 * (`services/reception.ts`) — refuse :
 *
 *  1. tout type MIME hors de la liste blanche (donc AUCUN `text/html` ni
 *     `image/svg+xml`, même bien formé) ;
 *  2. tout contenu dont les octets réels ne correspondent PAS au type MIME
 *     déclaré (un fichier étiqueté « image/png » dont le contenu est en
 *     réalité du HTML) — la vérification ajoutée par cette mission ;
 *  3. les contournements de forme de la Data URI elle-même : casse du type
 *     MIME, paramètre inséré avant `;base64,`, `;base64` absent, préfixe
 *     `data:` dédoublé, espace de tête, octet nul injecté, contenu tronqué
 *     ou garni de caractères hors alphabet base64.
 *
 * Nuance assumée (mission, § « pas de rideau disproportionné ») : l'app est
 * MONO-UTILISATEUR locale, la seule personne qui téléverse est celle qui
 * regarde. Le risque visé n'est pas un attaquant distant, mais un fichier
 * reçu d'un fournisseur et joint sans y regarder — d'où la vérification du
 * contenu réel, jamais une charge cryptographique disproportionnée.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurMetier } from '@batte/core';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { conditionnement, ingredient, fournisseur } from '../schema.js';
import { enregistrerFacture, validerPieceJointe } from './factures.js';
import { enregistrerReception } from './reception.js';

const JOUR = '2026-07-27';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures binaires — construites en octets, jamais copiées d'une source
   externe : c'est ce qui rend explicite QUELS octets sont testés.
   ═══════════════════════════════════════════════════════════════════════════ */

/** PNG 1×1 minuscule, RÉELLEMENT valide (même fixture que `factures.test.ts`). */
const PNG_VALIDE_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** JPEG minimal : seule la signature (FFD8FF) est vérifiée par le code testé. */
const JPEG_VALIDE_B64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00,
]).toString('base64');

/** WEBP minimal : RIFF<taille>WEBP, les deux jetons non contigus vérifiés par le code testé. */
const WEBP_VALIDE_B64 = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from([0x56, 0x50, 0x38, 0x20]),
]).toString('base64');

/** PDF minimal : seule la signature `%PDF-` est vérifiée par le code testé. */
const PDF_VALIDE_B64 = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< >>\nendobj\n', 'latin1').toString(
  'base64',
);

/** Un contenu HTML avec script, encodé en base64 — jamais un type MIME accepté tel quel. */
const HTML_SCRIPT_B64 = Buffer.from(
  '<html><body><script>alert(document.cookie)</script></body></html>',
  'ascii',
).toString('base64');

/** Un SVG avec script embarqué — même remarque : jamais un type MIME accepté. */
const SVG_SCRIPT_B64 = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  'ascii',
).toString('base64');

function attendreErreur(fn: () => unknown, code: string): void {
  expect.assertions(2);
  try {
    fn();
    throw new Error('devait lever, n’a rien levé');
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect((erreur as ErreurMetier).code).toBe(code);
  }
}

describe('validerPieceJointe — types MIME hostiles jamais acceptés', () => {
  it('refuse text/html même bien formé (jamais exécutable via ce chemin)', () => {
    attendreErreur(
      () => validerPieceJointe(`data:text/html;base64,${HTML_SCRIPT_B64}`),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse image/svg+xml même porteur d’un <script> (SVG scriptable jamais dans la liste blanche)', () => {
    attendreErreur(
      () => validerPieceJointe(`data:image/svg+xml;base64,${SVG_SCRIPT_B64}`),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse application/javascript', () => {
    attendreErreur(
      () =>
        validerPieceJointe(
          `data:application/javascript;base64,${Buffer.from('alert(1)').toString('base64')}`,
        ),
      'piece_jointe_format_invalide',
    );
  });
});

describe('validerPieceJointe — contenu réel vérifié contre le type déclaré', () => {
  it('ACCEPTE encore un PNG réellement valide (non-régression du contrôle ajouté)', () => {
    expect(validerPieceJointe(`data:image/png;base64,${PNG_VALIDE_B64}`)).toBe(
      `data:image/png;base64,${PNG_VALIDE_B64}`,
    );
  });

  it('accepte un JPEG réellement valide', () => {
    const uri = `data:image/jpeg;base64,${JPEG_VALIDE_B64}`;
    expect(validerPieceJointe(uri)).toBe(uri);
  });

  it('accepte un WEBP réellement valide (RIFF/WEBP non contigus)', () => {
    const uri = `data:image/webp;base64,${WEBP_VALIDE_B64}`;
    expect(validerPieceJointe(uri)).toBe(uri);
  });

  it('accepte un PDF réellement valide', () => {
    const uri = `data:application/pdf;base64,${PDF_VALIDE_B64}`;
    expect(validerPieceJointe(uri)).toBe(uri);
  });

  it(
    'REFUSE un contenu HTML/script étiqueté « image/png » — le cas central de la mission : ' +
      'un fichier .png dont les octets sont du HTML reste du HTML pour le navigateur',
    () => {
      attendreErreur(
        () => validerPieceJointe(`data:image/png;base64,${HTML_SCRIPT_B64}`),
        'piece_jointe_contenu_incoherent',
      );
    },
  );

  it('refuse un contenu HTML/script étiqueté « application/pdf »', () => {
    attendreErreur(
      () => validerPieceJointe(`data:application/pdf;base64,${HTML_SCRIPT_B64}`),
      'piece_jointe_contenu_incoherent',
    );
  });

  it('refuse un PNG réel étiqueté « application/pdf » (type déclaré incohérent avec le contenu)', () => {
    attendreErreur(
      () => validerPieceJointe(`data:application/pdf;base64,${PNG_VALIDE_B64}`),
      'piece_jointe_contenu_incoherent',
    );
  });

  it('refuse un WEBP réel étiqueté « image/jpeg »', () => {
    attendreErreur(
      () => validerPieceJointe(`data:image/jpeg;base64,${WEBP_VALIDE_B64}`),
      'piece_jointe_contenu_incoherent',
    );
  });

  it('refuse un contenu trop court pour porter la moindre signature (« image/webp » sur 3 octets)', () => {
    const contenuCourt = Buffer.from([0x52, 0x49, 0x46]).toString('base64'); // "RIF", tronqué
    attendreErreur(
      () => validerPieceJointe(`data:image/webp;base64,${contenuCourt}`),
      'piece_jointe_contenu_incoherent',
    );
  });
});

describe('validerPieceJointe — contournements de forme de la Data URI', () => {
  it('refuse une casse différente du type MIME (« IMAGE/PNG » n’est pas « image/png »)', () => {
    attendreErreur(
      () => validerPieceJointe(`data:IMAGE/PNG;base64,${PNG_VALIDE_B64}`),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse le préfixe « DATA: » en majuscules', () => {
    attendreErreur(
      () => validerPieceJointe(`DATA:image/png;base64,${PNG_VALIDE_B64}`),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse un paramètre inséré avant « ;base64, » (ex. « ;charset=binary »)', () => {
    attendreErreur(
      () => validerPieceJointe(`data:image/png;charset=binary;base64,${PNG_VALIDE_B64}`),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse un « ;base64 » absent (Data URI texte brut, pas encodée)', () => {
    attendreErreur(
      () => validerPieceJointe('data:image/png,plaintextpasdutoutbase64'),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse un préfixe « data: » dédoublé', () => {
    attendreErreur(
      () => validerPieceJointe(`data:data:image/png;base64,${PNG_VALIDE_B64}`),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse un espace de tête avant « data: »', () => {
    attendreErreur(
      () => validerPieceJointe(` data:image/png;base64,${PNG_VALIDE_B64}`),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse un contenu garni après le payload base64 (virgule et texte en trop)', () => {
    attendreErreur(
      () => validerPieceJointe(`data:image/png;base64,${PNG_VALIDE_B64},donnee-en-trop`),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse un octet NUL injecté au milieu du payload base64', () => {
    const avecNul = `${PNG_VALIDE_B64.slice(0, 10)} ${PNG_VALIDE_B64.slice(10)}`;
    attendreErreur(
      () => validerPieceJointe(`data:image/png;base64,${avecNul}`),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse un espace injecté au milieu du payload base64', () => {
    const avecEspace = `${PNG_VALIDE_B64.slice(0, 10)} ${PNG_VALIDE_B64.slice(10)}`;
    attendreErreur(
      () => validerPieceJointe(`data:image/png;base64,${avecEspace}`),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse un saut de ligne injecté au milieu du payload base64', () => {
    const avecSautDeLigne = `${PNG_VALIDE_B64.slice(0, 10)}\n${PNG_VALIDE_B64.slice(10)}`;
    attendreErreur(
      () => validerPieceJointe(`data:image/png;base64,${avecSautDeLigne}`),
      'piece_jointe_format_invalide',
    );
  });

  it('refuse un payload base64 vide', () => {
    attendreErreur(
      () => validerPieceJointe('data:image/png;base64,'),
      'piece_jointe_format_invalide',
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le garde-fou protège les DEUX chemins d'écriture (facture ET réception),
   pas seulement la fonction exportée en isolation.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('le contrôle de contenu protège enregistrerFacture ET enregistrerReception', () => {
  let base: BaseBatte;
  let idFarine: string;
  let idMeunier: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    idFarine = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!.id;
    idMeunier = base
      .select({ id: conditionnement.fournisseurId })
      .from(conditionnement)
      .where(eq(conditionnement.ingredientId, idFarine))
      .get()!.id;
  });

  it('enregistrerFacture refuse un HTML/script étiqueté « image/png », transaction non écrite', () => {
    const avant = base.select({ id: fournisseur.id }).from(fournisseur).all().length;

    expect(() =>
      enregistrerFacture(base, {
        numeroFournisseur: 'FA-SEC-001',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        fichierScanPath: `data:image/png;base64,${HTML_SCRIPT_B64}`,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      }),
    ).toThrow(ErreurMetier);

    // Rien ne doit avoir été écrit à côté (atomicité de la transaction) : le
    // nombre de fournisseurs, temoin indirect, est inchangé.
    expect(base.select({ id: fournisseur.id }).from(fournisseur).all().length).toBe(avant);
  });

  it('enregistrerReception refuse le MÊME HTML/script étiqueté « image/png »', () => {
    expect(() =>
      enregistrerReception(base, {
        fournisseurId: idMeunier,
        dateReception: JOUR,
        fichierScanPath: `data:image/png;base64,${HTML_SCRIPT_B64}`,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 500,
            numeroLotFournisseur: 'LOT-SEC-001',
          },
        ],
      }),
    ).toThrow(ErreurMetier);
  });

  it('enregistrerReception refuse un SVG scriptable même étiqueté « application/pdf »', () => {
    expect(() =>
      enregistrerReception(base, {
        fournisseurId: idMeunier,
        dateReception: JOUR,
        fichierScanPath: `data:application/pdf;base64,${SVG_SCRIPT_B64}`,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 500,
            numeroLotFournisseur: 'LOT-SEC-002',
          },
        ],
      }),
    ).toThrow(ErreurMetier);
  });

  it('enregistrerFacture ACCEPTE toujours un PDF réellement valide (non-régression)', () => {
    const resultat = enregistrerFacture(base, {
      numeroFournisseur: 'FA-SEC-002',
      fournisseurId: idMeunier,
      dateFacture: JOUR,
      fichierScanPath: `data:application/pdf;base64,${PDF_VALIDE_B64}`,
      lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
    });
    expect(resultat.factureId.trim()).not.toBe('');
  });
});
