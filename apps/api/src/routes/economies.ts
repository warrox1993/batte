/**
 * Routes `/api/economies` et `/api/exports/economies` (fiche 12 — suivi des
 * économies d'achat, inspiré du classeur Mithra Pharmaceuticals).
 *
 * `packages/core/src/contrats/economies.ts` et `packages/db/src/depots/economies.ts`
 * sont exportés par les barrels `@batte/core` et `@batte/db` : les imports
 * ci-dessous passent directement par eux (note corrigée le 29/07/2026 — un
 * commentaire précédent affirmait encore un pont relatif temporaire qui
 * n'existait déjà plus dans le code, D-040).
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { ErreurMetier, jourCivilBelge } from '@batte/core';
import type { BaseBatte } from '@batte/db';
import {
  schemaCreationEconomie,
  schemaDetectionEconomie,
  schemaEconomieLigne,
  schemaListeEconomies,
  schemaRenegociationTarif,
  schemaResultatRenegociation,
  schemaTableauBordEconomies,
  schemaTypeActionEconomie,
} from '@batte/core';
import {
  detecterEconomiePotentielle,
  enregistrerEconomie,
  listerEconomies,
  renegocierTarifAvecEconomie,
  tableauBordEconomies,
} from '@batte/db';
import {
  archiverExportExcel,
  exportEconomies,
  type DonneesExportEconomies,
} from '../documents/excel.js';

/** Année civile courante (Europe/Brussels) — même helper que `routes/comptabilite.ts`,
 * dupliqué ici faute d'accès à ce fichier (hors zone d'écriture). */
function anneeCourante(): number {
  return Number.parseInt(jourCivilBelge(new Date()).slice(0, 4), 10);
}

function analyserAnnee(brute: string | undefined): number {
  if (brute === undefined) return anneeCourante();

  // Format vérifié AVANT toute conversion : `Number.parseInt` est permissif
  // (« 2026abc » ou « 2026.5 » seraient tronqués au lieu d'être refusés, et
  // « -2026 » serait accepté comme un entier valide malgré `Number.isInteger`).
  if (!/^\d{4}$/.test(brute)) {
    throw new ErreurMetier('annee_invalide', `Année invalide : « ${brute} ».`, {
      champs: { annee: 'Indiquez une année sur quatre chiffres.' },
    });
  }
  return Number.parseInt(brute, 10);
}

/**
 * Bornes d'une année civile. Borne haute en ISO complet, jamais un jour civil
 * nu : même convention que `totalAchatsMarchandisesCents`
 * (`packages/db/src/depots/comptabilite.ts`) — sans elle, une économie datée
 * du 31 décembre serait exclue de sa propre année.
 */
function bornesAnnee(annee: number): { debut: string; fin: string } {
  return { debut: `${annee}-01-01`, fin: `${annee}-12-31T23:59:59.999Z` };
}

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Même geste que `documents.ts:servirFichier` (hors zone d'écriture), copié
 * ici : le fichier est RELU sur disque, jamais gardé en mémoire après l'écriture. */
function servirFichierXlsx(
  chemin: string,
  reponse: { header: (nom: string, valeur: string) => unknown; type: (t: string) => unknown },
): Buffer {
  const octets = readFileSync(chemin);
  reponse.header('Content-Disposition', `inline; filename="${basename(chemin)}"`);
  reponse.type(MIME_XLSX);
  return octets;
}

export function routesEconomies(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /* ─── Liste, filtrable par année et par type d'action ────────────────── */

    app.get<{ Querystring: { annee?: string; typeAction?: string } }>(
      '/economies',
      async (requete) => {
        const annee = analyserAnnee(requete.query.annee);
        const { debut, fin } = bornesAnnee(annee);
        const lignes = listerEconomies(base, {
          debut,
          fin,
          ...(requete.query.typeAction === undefined
            ? {}
            : { typeAction: schemaTypeActionEconomie.parse(requete.query.typeAction) }),
        });
        const economieTotaleCents = lignes.reduce((somme, l) => somme + l.economieCents, 0);

        return schemaListeEconomies.parse({
          data: lignes,
          meta: { total: lignes.length, economieTotaleCents },
        });
      },
    );

    /* ─── Tableau de bord agrégé — feuille « CHART_COST REDUCTION » ──────── */

    app.get<{ Querystring: { annee?: string } }>('/economies/tableau-bord', async (requete) => {
      const annee = analyserAnnee(requete.query.annee);
      const bornes = bornesAnnee(annee);
      const tableau = tableauBordEconomies(base, bornes);

      return schemaTableauBordEconomies.parse({ ...tableau, periode: bornes });
    });

    /* ─── Détection — proposer l'écart AVANT saisie, sans dupliquer le calcul ─── */

    app.get<{
      Querystring: {
        ingredientId?: string;
        fournisseurId?: string;
        prixCandidatCents?: string;
        /** Contenance de l'offre comparée : voir `depots/economies.ts`
         * (audit du 29/07/2026) — normalise la comparaison quand plusieurs
         * formats de tailles différentes sont actifs chez ce fournisseur. */
        quantiteUniteRefCandidat?: string;
      };
    }>('/economies/detecter', async (requete) => {
      const { ingredientId, fournisseurId, prixCandidatCents, quantiteUniteRefCandidat } =
        requete.query;
      const champs: Record<string, string> = {};
      if (ingredientId === undefined) champs['ingredientId'] = 'Obligatoire.';
      if (fournisseurId === undefined) champs['fournisseurId'] = 'Obligatoire.';
      if (prixCandidatCents === undefined) champs['prixCandidatCents'] = 'Obligatoire.';
      if (Object.keys(champs).length > 0) {
        throw new ErreurMetier(
          'parametres_detection_manquants',
          'ingredientId, fournisseurId et prixCandidatCents sont tous obligatoires.',
          { champs },
        );
      }

      const prix = Number.parseInt(prixCandidatCents!, 10);
      if (!Number.isInteger(prix)) {
        throw new ErreurMetier(
          'prix_candidat_invalide',
          'prixCandidatCents doit être un nombre entier de centimes.',
          { champs: { prixCandidatCents: 'Doit être un entier de centimes.' } },
        );
      }

      let contenanceCandidate: number | undefined;
      if (quantiteUniteRefCandidat !== undefined) {
        const parsee = Number.parseInt(quantiteUniteRefCandidat, 10);
        if (!Number.isInteger(parsee) || parsee <= 0) {
          throw new ErreurMetier(
            'quantite_candidate_invalide',
            'quantiteUniteRefCandidat doit être un entier strictement positif.',
            { champs: { quantiteUniteRefCandidat: 'Doit être un entier strictement positif.' } },
          );
        }
        contenanceCandidate = parsee;
      }

      const detection = detecterEconomiePotentielle(base, {
        ingredientId: ingredientId!,
        fournisseurId: fournisseurId!,
        prixCandidatCents: prix,
        ...(contenanceCandidate === undefined
          ? {}
          : { quantiteUniteRefCandidat: contenanceCandidate }),
      });
      return schemaDetectionEconomie.parse(detection);
    });

    /* ─── Saisie libre — le troisième type Mithra (stock immobilisé) et les
       cas hors renégociation de tarif ────────────────────────────────────── */

    app.post('/economies', async (requete, reponse) => {
      const corps = schemaCreationEconomie.parse(requete.body);
      const creee = enregistrerEconomie(base, corps);

      reponse.code(201);
      return schemaEconomieLigne.parse(creee);
    });

    /* ─── LE point d'accroche : renégocier un tarif ET capturer l'économie ─── */

    app.post('/economies/renegociations-tarif', async (requete, reponse) => {
      const corps = schemaRenegociationTarif.parse(requete.body);
      const resultat = renegocierTarifAvecEconomie(base, corps);

      reponse.code(201);
      return schemaResultatRenegociation.parse(resultat);
    });

    /* ─── Export Excel — « format proche du fichier Mithra fourni » ─────── */

    app.get<{ Querystring: { annee?: string } }>('/exports/economies', async (requete, reponse) => {
      const annee = analyserAnnee(requete.query.annee);
      const bornes = bornesAnnee(annee);

      const lignes = listerEconomies(base, bornes);
      const tableau = tableauBordEconomies(base, bornes);

      const donnees: DonneesExportEconomies = {
        dateExport: new Date(),
        periodeCouverte: String(annee),
        lignes: lignes.map((l) => ({
          dateAction: l.dateAction,
          numeroCommande: l.commandeNumero,
          ingredientNom: l.ingredientNom,
          fournisseurNom: l.fournisseurNom,
          typeAction: l.typeAction,
          description: l.description,
          prixUnitaireAvantCents: l.prixUnitaireAvantCents,
          prixUnitaireApresCents: l.prixUnitaireApresCents,
          quantiteConcernee: l.quantiteConcernee,
          economieCents: l.economieCents,
        })),
        tableau,
      };
      const octets = await exportEconomies(donnees);

      const doc = await archiverExportExcel(
        base,
        { objetId: `economies-${annee}`, numero: null, parametresSource: donnees },
        octets,
      );

      return servirFichierXlsx(doc.chemin, reponse);
    });
  };
}
