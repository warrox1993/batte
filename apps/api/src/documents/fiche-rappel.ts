/**
 * Fiche de rappel — traçabilité AVAL d'un lot fournisseur (mission du
 * 01/08/2026).
 *
 * DÉCISION : UN DOCUMENT DÉDIÉ, JAMAIS UNE SECTION DU REGISTRE MENSUEL
 * ─────────────────────────────────────────────────────────────────────
 * La question posée par un rappel réel n'est pas « que s'est-il passé ce
 * mois-ci ? » (la question du registre AFSCA, `registre-afsca.ts`) mais
 * « ce lot précis, où est-il parti ? ». Trois raisons structurelles, pas
 * seulement une préférence de présentation :
 *
 *  1. UNE FENÊTRE DE TEMPS DIFFÉRENTE. Le registre est borné à un mois civil
 *     (`donneesRegistreAfsca(base, annee, mois)`). Un lot de farine à longue
 *     conservation reçu en mai peut être consommé par une production en
 *     juillet, elle-même vendue en août : aucun mois unique ne contient la
 *     chaîne complète. Une « section aval » greffée sur le registre mensuel
 *     ne montrerait donc, structurellement, qu'un fragment de la traçabilité
 *     — exactement l'inverse de ce qu'un rappel exige.
 *  2. UNE CLÉ D'ENTRÉE DIFFÉRENTE. Le registre se feuillette par période ; un
 *     contrôleur ou un avis de rappel fournisseur tient un LOT (un numéro,
 *     une DLC), jamais un mois. `tracabiliteAvalLot` (`@batte/db`) est déjà
 *     interrogeable par cette clé précise — c'est exactement ce qu'un
 *     document « qu'on tire pour un lot donné » doit exposer, pas quelque
 *     chose qu'il faudrait retrouver en feuilletant douze registres mensuels.
 *  3. LE PRÉCÉDENT DU PRODUIT LUI-MÊME. Aucun des documents existants n'est
 *     périodique par défaut : la fiche technique se tire par recette,
 *     l'étiquette par production, le rapport par session — tous des
 *     documents dédiés, adressés par identifiant. Le registre mensuel est
 *     l'EXCEPTION (une obligation réglementaire de relevé périodique), pas le
 *     patron à suivre pour une consultation ponctuelle.
 *
 * D'où : `GET /documents/fiche-rappel/:lot`, sur le modèle exact de
 * `GET /documents/etiquette-bac/:id` — un identifiant, un document.
 *
 * TROIS PIÈGES DÉJÀ PAYÉS SUR CES DOCUMENTS, ÉVITÉS ICI :
 * ─────────────────────────────────────────────────────────────────────
 *  - PIED DE PAGE : `rendrePdf` (`rendu.ts`) ne répète que `footerTemplate`
 *    sur chaque page, jamais `headerTemplate`. L'identité de l'exploitant et
 *    la mention légale vivent donc dans `pied()` ci-dessous (répété par
 *    Chromium), PAS seulement dans `entete()` (page 1 uniquement) — même
 *    mécanisme que `registre-afsca.ts`, vérifié réellement sur une page 2
 *    (voir `fiche-rappel.test.ts` et le rapport de livraison).
 *  - JOUR CIVIL vs INSTANT : `dateReception`, `dateDlc`, `dateProduction`,
 *    `dateMouvement` (session) sont des JOURS CIVILS PURS (`"2026-07-25"`,
 *    ancrés à minuit UTC) — `formaterDate` uniquement, jamais
 *    `formaterDateHeure`, qui fabriquerait une heure inexistante (« 02:00 »
 *    l'été à Bruxelles, le défaut exact de `docs/31-DOCUMENTS-OUVERTS.md`
 *    §3.2). SEUL `dateChangementStatut` est un instant RÉEL
 *    (`maintenantUtc()`, `services/mouvements.ts:changerStatutLot`) : c'est
 *    la seule date de cette fiche qui appelle `formaterDateHeure` — via
 *    `libelleLotConcerne`, réutilisé tel quel depuis `registre-afsca.ts`.
 *  - IDENTIFIANT SANS ESPACE DANS UNE CELLULE ÉTROITE : un numéro de lot
 *    fournisseur saisi sans espace ni tiret s'enroulerait caractère par
 *    caractère dans une colonne de tableau trop étroite (même mécanique que
 *    `troncature: 'repli'` sur l'écran, `apps/web/src/index.css`). Cette
 *    fiche NE PLACE JAMAIS `numeroLotFournisseur` dans une cellule de
 *    tableau : il n'apparaît que dans le bloc « Lot concerné », un
 *    paragraphe libre (pas de largeur de colonne à respecter). Les seuls
 *    identifiants en cellule (`numero` de production, `numeroLotPate`,
 *    `numero` de session) sont TOUS générés par l'application avec des
 *    tirets (`PR-2026-0001`, `PATE-PR-2026-0001`) — des points de coupure
 *    naturels — et leurs colonnes restent généreuses (voir les `colgroup`
 *    ci-dessous), vérifié avec un numéro fournisseur long et sans espace
 *    dans `fiche-rappel.test.ts`.
 *
 * Fonction PURE, comme tous les gabarits de ce dossier : donnees -> HTML,
 * aucun accès base, aucun calcul métier (CLAUDE.md §3 règle 1). L'assemblage
 * réel vit dans `donnees.ts` (`donneesFicheRappelLot`), au-dessus de
 * `tracabiliteAvalLot` (`packages/db/src/depots/tracabilite.ts`).
 */

import { documentHtml, echapper, type RenduGabarit } from './rendu.js';
import { COULEURS_IMPRESSION } from './style-impression.js';
import {
  blocExploitant,
  exploitantCompact,
  libelleLotConcerne,
  LIBELLES_GRAVITE,
  type DonneesRegistreAfscaExploitant,
} from './registre-afsca.js';
import { formaterDate, formaterQuantite, TIRET_ABSENT, type Unite } from '@batte/core';

const MENTION_FICHE_RAPPEL =
  "Cette fiche reprend, à sa date d'édition, la traçabilité aval enregistrée dans " +
  "l'application pour ce lot : les productions qui l'ont consommé et les sessions où " +
  'elles sont parties. Elle documente un lot précis ; elle ne remplace ni un contrôle ' +
  "AFSCA ni l'appréciation de l'agent chargé de l'inspection.";

/** Session résumée — même trois champs que `TracabiliteAvalSession` (`@batte/db`), sans l'id technique. */
export type DonneesFicheRappelSession = {
  readonly numero: string;
  readonly dateSession: string;
  readonly lieuNom: string;
};

export type DonneesFicheRappelProduction = {
  readonly numero: string;
  readonly numeroLotPate: string;
  /** Jour civil pur — voir le docblock de ce fichier. */
  readonly dateProduction: string;
  /**
   * Quantité PRÉVUE de ce lot au lancement de cette production. `0` — un VRAI
   * zéro — quand la fournée ne l'avait pas prévu et ne l'a touché que pour
   * combler un écart déclaré après coup. Ce cas porte la mention
   * « hors fournée » sur le document : voir `sectionProductions`.
   */
  readonly quantiteTheorique: number;
  /**
   * Quantité réellement SORTIE de ce lot pour cette production — net signé des
   * mouvements de stock.
   *
   * REMPLACE `quantiteReelle` (01/08/2026), et ce n'était pas un choix de
   * présentation. `quantiteReelle` est la quantité que le porteur a DÉCLARÉE
   * pour l'INGRÉDIENT entier : elle vaut `null` dès que la fournée a puisé
   * dans plusieurs lots — c'est-à-dire précisément le cas d'une
   * sur-consommation comblée ailleurs, celui qui amène un lot RAPPELÉ sur ce
   * document. La fiche de rappel affichait donc « — » à l'endroit exact où un
   * contrôle attend un chiffre. Celui-ci est le seul des trois champs de
   * quantité qui soit toujours connu ET toujours attribuable AU LOT
   * (`TracabiliteAvalProduction.quantiteMouvementee`, `@batte/db`).
   */
  readonly quantiteMouvementee: number;
  /** `null` = lot de pâte pas encore affecté à une session (pas une incohérence). */
  readonly session: DonneesFicheRappelSession | null;
};

export type DonneesFicheRappelSortie = {
  readonly quantite: number;
  /** Jour civil pur — voir le docblock de ce fichier. */
  readonly dateMouvement: string;
  readonly session: DonneesFicheRappelSession;
};

export type DonneesFicheRappelGarniture = DonneesFicheRappelSortie & {
  /** Produits vendus ce jour-là qui portaient cette garniture. */
  readonly produits: readonly string[];
};

export type DonneesFicheRappelNonConformite = {
  readonly dateConstat: string;
  readonly type: string;
  readonly gravite: string;
  readonly description: string;
  readonly actionCorrective: string | null;
  readonly dateResolution: string | null;
};

export type DonneesFicheRappelLot = {
  readonly dateGeneration: Date;
  readonly exploitant: DonneesRegistreAfscaExploitant;
  readonly ingredientNom: string;
  readonly fournisseurNom: string;
  readonly numeroLotFournisseur: string | null;
  /** `null` = denrée non périssable (voir `packages/db/src/schema.ts`, colonne `lot.date_dlc`). */
  readonly dateDlc: string | null;
  /** Unité de référence de l'ingrédient — sert à formater les quantités consommées/sorties. */
  readonly unite: Unite;
  readonly dateReception: string;
  readonly receptionNumero: string;
  readonly receptionStatut: 'active' | 'annulee';
  readonly statut: 'disponible' | 'quarantaine' | 'bloque' | 'detruit';
  readonly motifStatutLibelle: string | null;
  readonly dateChangementStatut: string | null;
  readonly nonConformites: readonly DonneesFicheRappelNonConformite[];
  readonly productions: readonly DonneesFicheRappelProduction[];
  /** Sorties vendues TELLES QUELLES. Vide pour un ingrédient uniquement transformé. */
  readonly ventes: readonly DonneesFicheRappelSortie[];
  /** Sorties étalées sur un produit transformé. */
  readonly garnitures: readonly DonneesFicheRappelGarniture[];
};

function entete(donnees: DonneesFicheRappelLot): string {
  return `<div class="entete">
    <div>
      <h1>Fiche de rappel — traçabilité d'un lot</h1>
      <p class="sous-titre">${echapper(donnees.ingredientNom)} — ${echapper(donnees.fournisseurNom)}</p>
    </div>
    <div class="reference">
      <strong>Éditée le</strong>${echapper(formaterDate(donnees.dateGeneration))}
    </div>
  </div>
  ${blocExploitant(donnees.exploitant)}`;
}

/**
 * Répété sur CHAQUE page par Chromium (voir le docblock du fichier, piège
 * n°1) — seul mécanisme qui fait réellement survivre l'identité du lot et la
 * mention légale au-delà de la première page.
 */
function pied(donnees: DonneesFicheRappelLot): string {
  const identite =
    donnees.numeroLotFournisseur === null
      ? donnees.ingredientNom
      : `${donnees.ingredientNom} — ${donnees.numeroLotFournisseur}`;

  return `<div style="width:100%;font-size:7pt;color:#71717a;padding:0 15mm;font-family:'Segoe UI',sans-serif">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:4mm">
      <span>${echapper(`Fiche de rappel — ${identite}`)} · ${exploitantCompact(donnees.exploitant)}</span>
      <span style="white-space:nowrap">page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>
    <div style="margin-top:0.5mm;font-size:6.5pt">${echapper(MENTION_FICHE_RAPPEL)}</div>
  </div>`;
}

/**
 * Bloc d'identification du lot : réutilise `libelleLotConcerne`
 * (`registre-afsca.ts`) TEL QUEL — même fournisseur, même numéro/DLC, même
 * statut actuel et même mention du dernier changement que sur le registre
 * mensuel (« un même mot doit désigner la même chose à l'écran et sur le
 * document imprimé »). Zéro nouveau libellé métier créé pour cette fiche.
 *
 * Dans un `<p>` de bloc libre, PAS dans une cellule de tableau : c'est ce qui
 * évite le piège n°3 du docblock de fichier (identifiant sans espace qui
 * s'enroule caractère par caractère dans une colonne étroite).
 */
function blocLotConcerne(donnees: DonneesFicheRappelLot): string {
  return `<div class="bloc">
    <p style="margin:0 0 1mm;font-size:8pt;text-transform:uppercase;letter-spacing:0.4pt;color:${COULEURS_IMPRESSION.encreTertiaire}">
      Lot concerné
    </p>
    <p style="margin:0;font-size:11pt;font-weight:600;color:${COULEURS_IMPRESSION.encre}">
      ${libelleLotConcerne({
        ingredientNom: donnees.ingredientNom,
        fournisseurNom: donnees.fournisseurNom,
        numeroLotFournisseur: donnees.numeroLotFournisseur,
        dateDlc: donnees.dateDlc,
        statut: donnees.statut,
        motifStatutLibelle: donnees.motifStatutLibelle,
        dateChangementStatut: donnees.dateChangementStatut,
      })}
    </p>
  </div>`;
}

function sectionReception(donnees: DonneesFicheRappelLot): string {
  return `
    <h2>Réception d'origine</h2>
    <table>
      <colgroup><col style="width:40%"><col style="width:60%"></colgroup>
      <tbody>
        <tr><td>Numéro de réception</td><td>${echapper(donnees.receptionNumero)}</td></tr>
        <tr><td>Date de réception</td><td>${echapper(formaterDate(donnees.dateReception))}</td></tr>
        <tr>
          <td>Statut de la réception</td>
          <td>${
            donnees.receptionStatut === 'annulee'
              ? '<span class="statut-alerte">Annulée depuis</span>'
              : 'Active'
          }</td>
        </tr>
      </tbody>
    </table>
  `;
}

function sectionNonConformites(lignes: readonly DonneesFicheRappelNonConformite[]): string {
  if (lignes.length === 0) {
    return (
      `<h2>Non-conformités déjà rattachées à ce lot</h2>` +
      `<p class="absent">Aucune non-conformité rattachée à ce lot.</p>`
    );
  }

  return `
    <h2>Non-conformités déjà rattachées à ce lot</h2>
    <table>
      <colgroup>
        <col style="width:10%">
        <col style="width:14%">
        <col style="width:10%">
        <col style="width:30%">
        <col style="width:20%">
        <col style="width:16%">
      </colgroup>
      <thead>
        <tr>
          <th>Constat</th>
          <th>Type</th>
          <th>Gravité</th>
          <th>Description</th>
          <th>Action corrective</th>
          <th>Résolution</th>
        </tr>
      </thead>
      <tbody>
        ${lignes
          .map(
            (l) => `<tr>
              <td>${echapper(formaterDate(l.dateConstat))}</td>
              <td>${echapper(l.type)}</td>
              <td>${echapper(LIBELLES_GRAVITE[l.gravite] ?? l.gravite)}</td>
              <td>${echapper(l.description)}</td>
              <td>${
                l.actionCorrective === null
                  ? `<span class="absent">${TIRET_ABSENT}</span>`
                  : echapper(l.actionCorrective)
              }</td>
              <td>${
                l.dateResolution === null
                  ? '<span class="statut-alerte">En cours</span>'
                  : echapper(formaterDate(l.dateResolution))
              }</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

/** Cellule « Session » commune aux trois tableaux ci-dessous. */
function celluleSession(session: DonneesFicheRappelSession | null): string {
  if (session === null) {
    return `<span class="absent">En attente d'affectation à une session.</span>`;
  }
  return (
    `${echapper(session.numero)} — ${echapper(formaterDate(session.dateSession))} — ` +
    echapper(session.lieuNom)
  );
}

/**
 * Mention NEUTRE : cette fournée n'avait pas prévu le lot rappelé, et il l'a
 * pourtant alimentée.
 *
 * Sans elle, la colonne « Théorique » affiche un `0` nu, qui se lit « ce lot
 * n'a rien fourni à cette production » — l'inverse exact de la vérité, dans le
 * document qu'un contrôle AFSCA lit pour délimiter un rappel. La mention est
 * posée DANS la cellule dont le `0` induit en erreur, jamais dans une colonne
 * séparée (le tableau en compte déjà six sur 180 mm imprimables).
 *
 * Ton NEUTRE (`encreTertiaire`), pas `statut-alerte` : une sur-consommation
 * comblée par un autre lot est un événement normal du stock, pas une
 * non-conformité — même raisonnement que le badge homologue de l'écran
 * (`BadgeLotHorsFournee`, `apps/web/src/pages/RegistreAfsca.tsx`), et même
 * vocabulaire, pour qu'un mot désigne la même chose à l'écran et sur le papier.
 */
function mentionHorsFournee(quantiteTheorique: number): string {
  if (quantiteTheorique !== 0) return '';
  return ` <span style="color:${COULEURS_IMPRESSION.encreTertiaire}">${echapper('— hors fournée')}</span>`;
}

/**
 * LE tableau qui répond à la question du rappel : quel LOT DE PÂTE est issu
 * d'une production ayant consommé ce lot d'ingrédient, et dans quelle
 * session est-il parti (`numeroLotPate`, voir le docblock de
 * `TracabiliteAvalProduction`, `packages/db/src/depots/tracabilite.ts`).
 *
 * Colonne « Réel » REMPLACÉE par « Sorti du lot » le 01/08/2026 — voir
 * `DonneesFicheRappelProduction.quantiteMouvementee` pour le motif. Un
 * REMPLACEMENT et non un ajout : à 180 mm imprimables (`style-impression.ts`,
 * marges de 15 mm), une septième colonne rétrécirait « Session » et « Lot de
 * pâte », les deux champs qui NOMMENT ce qu'un rappel doit aller chercher. Les
 * deux points repris à « Session » vont aux colonnes de quantité, dont l'une
 * porte désormais l'en-tête plus long et l'autre la mention « hors fournée ».
 *
 * L'en-tête est RENOMMÉ plutôt que réutilisé : garder « Réel » en lui faisant
 * dire une autre valeur ferait relire le nouveau chiffre avec l'ancienne
 * signification — sur un document d'archive, relu des mois plus tard, c'est
 * pire que le défaut d'origine.
 */
function sectionProductions(lignes: readonly DonneesFicheRappelProduction[], unite: Unite): string {
  if (lignes.length === 0) {
    return (
      `<h2>Productions ayant consommé ce lot</h2>` +
      `<p class="absent">Aucune production n'a consommé ce lot.</p>`
    );
  }

  return `
    <h2>Productions ayant consommé ce lot</h2>
    <table>
      <colgroup>
        <col style="width:14%">
        <col style="width:18%">
        <col style="width:12%">
        <col style="width:13%">
        <col style="width:13%">
        <col style="width:30%">
      </colgroup>
      <thead>
        <tr>
          <th>Production</th>
          <th>Lot de pâte</th>
          <th>Date de production</th>
          <th class="num">Théorique</th>
          <th class="num">Sorti du lot</th>
          <th>Session</th>
        </tr>
      </thead>
      <tbody>
        ${lignes
          .map(
            (l) => `<tr>
              <td>${echapper(l.numero)}</td>
              <td>${echapper(l.numeroLotPate)}</td>
              <td>${echapper(formaterDate(l.dateProduction))}</td>
              <td class="num">${echapper(formaterQuantite(l.quantiteTheorique, unite))}${mentionHorsFournee(l.quantiteTheorique)}</td>
              <td class="num">${echapper(formaterQuantite(l.quantiteMouvementee, unite))}</td>
              <td>${celluleSession(l.session)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

/** Sorties vendues TELLES QUELLES (article revendu, sans production intermédiaire). */
function sectionVentes(lignes: readonly DonneesFicheRappelSortie[], unite: Unite): string {
  if (lignes.length === 0) {
    return (
      `<h2>Sorties vendues telles quelles</h2>` +
      `<p class="absent">Aucune sortie vendue telle quelle pour ce lot.</p>`
    );
  }

  return `
    <h2>Sorties vendues telles quelles</h2>
    <table>
      <colgroup>
        <col style="width:20%">
        <col style="width:20%">
        <col style="width:60%">
      </colgroup>
      <thead>
        <tr>
          <th class="num">Quantité</th>
          <th>Date</th>
          <th>Session</th>
        </tr>
      </thead>
      <tbody>
        ${lignes
          .map(
            (l) => `<tr>
              <td class="num">${echapper(formaterQuantite(l.quantite, unite))}</td>
              <td>${echapper(formaterDate(l.dateMouvement))}</td>
              <td>${celluleSession(l.session)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

/** Sorties étalées sur un produit transformé (garniture). */
function sectionGarnitures(lignes: readonly DonneesFicheRappelGarniture[], unite: Unite): string {
  if (lignes.length === 0) {
    return (
      `<h2>Sorties étalées en garniture</h2>` +
      `<p class="absent">Aucune sortie en garniture pour ce lot.</p>`
    );
  }

  return `
    <h2>Sorties étalées en garniture</h2>
    <table>
      <colgroup>
        <col style="width:15%">
        <col style="width:15%">
        <col style="width:35%">
        <col style="width:35%">
      </colgroup>
      <thead>
        <tr>
          <th class="num">Quantité</th>
          <th>Date</th>
          <th>Session</th>
          <th>Produits portant cette garniture</th>
        </tr>
      </thead>
      <tbody>
        ${lignes
          .map(
            (l) => `<tr>
              <td class="num">${echapper(formaterQuantite(l.quantite, unite))}</td>
              <td>${echapper(formaterDate(l.dateMouvement))}</td>
              <td>${celluleSession(l.session)}</td>
              <td>${echapper(l.produits.join(' · '))}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

export function ficheRappelLot(donnees: DonneesFicheRappelLot): RenduGabarit {
  const corps = `
    ${entete(donnees)}

    ${blocLotConcerne(donnees)}
    ${sectionReception(donnees)}
    ${sectionNonConformites(donnees.nonConformites)}
    ${sectionProductions(donnees.productions, donnees.unite)}
    ${sectionVentes(donnees.ventes, donnees.unite)}
    ${sectionGarnitures(donnees.garnitures, donnees.unite)}

    <p class="mention">${echapper(MENTION_FICHE_RAPPEL)}</p>
  `;

  const titre =
    donnees.numeroLotFournisseur === null
      ? `Fiche de rappel — ${donnees.ingredientNom}`
      : `Fiche de rappel — ${donnees.ingredientNom} (${donnees.numeroLotFournisseur})`;

  return documentHtml(titre, corps, { pied: pied(donnees) });
}
