/**
 * Gabarits HTML des documents.
 *
 * Chaque gabarit est une fonction PURE : donnees -> HTML. Aucun acces base,
 * aucun calcul metier — les chiffres arrivent deja calcules par `@batte/core`.
 * Cela les rend testables sans navigateur ni base de donnees.
 */

import {
  COULEURS_IMPRESSION,
  MENTION_FRANCHISE_TVA,
  MENTION_NE_REMPLACE_PAS,
  STYLE_AFFICHETTE,
} from './style-impression.js';
import { documentHtml, echapper, type RenduGabarit } from './rendu.js';
import {
  BASE_POINTS,
  TIRET_ABSENT,
  formaterDate,
  formaterEuros,
  formaterMontant,
  formaterPourcent,
  formaterQuantite,
  libelleAllergene,
  type Unite,
} from '@batte/core';

/**
 * `<colgroup>` partage par les tableaux « libellé / valeur » à DEUX colonnes
 * sans en-tête (construits ligne à ligne par `ligne()` ci-dessous, dans
 * `rapportSession` et `briefAvantMarche`) : même forme partout, un seul
 * endroit à ajuster (D-081 : la somme doit faire EXACTEMENT 100).
 */
const COLGROUP_LIGNE = '<colgroup><col style="width:70%"><col style="width:30%"></colgroup>';

/** Pied de page commun, avec numerotation automatique par Chromium. */
function pied(mention: string): string {
  return `<div style="width:100%;font-size:7pt;color:#71717a;padding:0 15mm;display:flex;justify-content:space-between;font-family:'Segoe UI',sans-serif">
    <span>${echapper(mention)}</span>
    <span>page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}

function entete(titre: string, sousTitre: string, reference: string | null): string {
  return `<div class="entete">
    <div>
      <h1>${echapper(titre)}</h1>
      <p class="sous-titre">${echapper(sousTitre)}</p>
    </div>
    ${
      reference === null
        ? ''
        : `<div class="reference"><strong>${echapper(reference)}</strong>${echapper(
            formaterDate(new Date()),
          )}</div>`
    }
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Fiche technique de recette
   ═══════════════════════════════════════════════════════════════════════════ */

export type DonneesFicheTechnique = {
  readonly code: string;
  readonly nom: string;
  readonly version: number;
  readonly sansGluten: boolean;
  readonly rendementMl: number;
  readonly rendementCrepes: number;
  readonly procede: string | null;
  readonly lignes: readonly {
    nomIngredient: string;
    quantite: number;
    unite: Unite;
    /**
     * `null` quand le CUMP de l'ingrédient est inconnu (`@batte/core`,
     * `mettreAEchelle` : « un ingrédient épuisé n'a pas un coût de zéro, il
     * n'a pas de coût », D-018). Jamais ramené à 0 avant ce gabarit — voir
     * son rendu ci-dessous.
     */
    coutCents: number | null;
    /**
     * Note du GESTE pour cette ligne (« beurre noisette, ne pas dépasser la
     * coloration »), `recette_ligne.note_technique`. CE N'EST JAMAIS UN
     * ALLERGÈNE (CLAUDE.md §7) : ne sert à rien d'autre qu'à s'afficher ici,
     * jamais à compléter `allergenes` ci-dessous. `null` = aucune note
     * saisie pour cette ligne — un cas normal, pas une absence à signaler.
     */
    noteTechnique: string | null;
  }[];
  /** `null` dès qu'une seule ligne a un coût inconnu : un total partiel n'est pas présentable comme complet. */
  readonly coutMatiereCents: number | null;
  readonly coutParCrepeCents: number | null;
  readonly allergenes: readonly string[];
  /**
   * Faux dès qu'UN SEUL ingrédient de la recette n'a jamais été évalué
   * (`ingredient.allergenes_verifies`). Tant que c'est faux, `allergenes`
   * ci-dessus ne dit rien de sûr : le gabarit doit avertir, jamais afficher
   * la liste comme si elle était complète (CLAUDE.md §7).
   */
  readonly allergenesVerifies: boolean;
};

export function ficheTechnique(donnees: DonneesFicheTechnique): RenduGabarit {
  const corps = `
    ${entete(
      `${donnees.code} — ${donnees.nom}`,
      `Fiche technique · version ${donnees.version}${donnees.sansGluten ? ' · sans gluten' : ''}`,
      donnees.code,
    )}

    <h2>Rendement de référence</h2>
    <p>${formaterQuantite(donnees.rendementMl, 'ml')} de pâte pour ${donnees.rendementCrepes} crêpes.</p>

    <h2>Ingrédients</h2>
    <table>
      <colgroup>
        <col style="width:60%">
        <col style="width:20%">
        <col style="width:20%">
      </colgroup>
      <thead>
        <tr>
          <th>Ingrédient</th>
          <th class="num">Quantité</th>
          <th class="num">Coût (€)</th>
        </tr>
      </thead>
      <tbody>
        ${donnees.lignes
          .map(
            (l) => `<tr>
              <td>${echapper(l.nomIngredient)}${
                l.noteTechnique === null
                  ? ''
                  : `<div style="margin-top:0.5mm;font-size:8pt;font-style:italic;color:${COULEURS_IMPRESSION.encreTertiaire}">${echapper(l.noteTechnique)}</div>`
              }</td>
              <td class="num">${echapper(formaterQuantite(l.quantite, l.unite))}</td>
              <td class="num">${
                l.coutCents === null
                  ? `<span class="absent">${TIRET_ABSENT}</span>`
                  : echapper(formaterMontant(l.coutCents))
              }</td>
            </tr>`,
          )
          .join('')}
        <tr class="total">
          <td>Coût matière total</td>
          <td class="num"></td>
          <td class="num">${
            donnees.coutMatiereCents === null
              ? `<span class="absent">${TIRET_ABSENT}</span>`
              : echapper(formaterMontant(donnees.coutMatiereCents))
          }</td>
        </tr>
        <tr class="total">
          <td>Par crêpe</td>
          <td class="num"></td>
          <td class="num">${
            donnees.coutParCrepeCents === null
              ? `<span class="absent">${TIRET_ABSENT}</span>`
              : echapper(formaterMontant(donnees.coutParCrepeCents))
          }</td>
        </tr>
      </tbody>
    </table>

    <h2>Allergènes</h2>
    <p>${
      !donnees.allergenesVerifies
        ? `<span class="statut-alerte">Allergènes non encore vérifiés — évaluez-les avant toute diffusion.</span>`
        : donnees.allergenes.length === 0
          ? `<span class="absent">Aucun allergène déclaré parmi les 14 de la liste réglementaire.</span>`
          : // `libelleAllergene` et non le code brut : `fruits-a-coque` est un
            // IDENTIFIANT, pas un libellé. Sur un document lu par un client ou
            // par un contrôleur, la formulation réglementaire est ce qui compte
            // — « Anhydride sulfureux et sulfites », pas « sulfites ».
            echapper(donnees.allergenes.map(libelleAllergene).join(' · '))
    }</p>

    ${donnees.procede === null ? '' : `<h2>Procédé</h2><p>${echapper(donnees.procede)}</p>`}

    <p class="mention">${echapper(MENTION_FRANCHISE_TVA)}</p>
  `;

  return documentHtml(`Fiche technique ${donnees.code}`, corps, {
    pied: pied(`Fiche technique ${donnees.code} v${donnees.version}`),
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Affichette allergenes — OBLIGATION AFSCA
   ═══════════════════════════════════════════════════════════════════════════ */

export type DonneesAffichette = {
  readonly produits: readonly {
    nom: string;
    allergenes: readonly string[];
    /**
     * Faux dès qu'UN SEUL ingrédient obligatoire (recette, garniture,
     * composant NON optionnel, article revendu, ou l'un de ces sources pour
     * un produit inclus dans un menu) n'a jamais été évalué. Une liste
     * d'allergènes partiellement fondée n'est pas une liste d'allergènes :
     * tant que ce drapeau est faux, le gabarit avertit au lieu d'afficher
     * `allergenes` ou « aucun allergène déclaré ».
     */
    allergenesVerifies: boolean;
    /**
     * Allergenes apportes par une OPTION servie seulement sur demande (creme
     * dans un café) — jamais ceux deja presents dans `allergenes` (fiche 15
     * §4.1bis). Vide pour un produit sans option, ou dont aucune option
     * n'apporte d'allergene supplementaire.
     */
    allergenesSurDemande: readonly string[];
  }[];
  readonly dateGeneration: Date;
};

/**
 * Affichette a poser sur le stand.
 *
 * `docs/01` module 1 : « lisible à un mètre ». Ce n'est pas une preference
 * esthetique mais une obligation d'information du consommateur — d'ou les corps
 * de 18 a 34 pt et l'absence de tout ornement.
 *
 * Un allergène apporté par une option (la crème d'un café, servie seulement
 * sur demande) est annoncé À PART, sous « sur demande » : l'unir en silence à
 * la liste principale déclarerait un café noir « au lait » à tort, ce qui est
 * tout aussi faux qu'un oubli — trop large décrédibilise l'affichette entière.
 *
 * Aucune mention de franchise TVA : ce n'est pas un document commercial, c'est
 * une information reglementaire destinee au client.
 */
export function affichetteAllergenes(donnees: DonneesAffichette): RenduGabarit {
  const corps = `
    <p class="titre-affichette">Allergènes</p>
    <p class="sous-titre-affichette">Information obligatoire · liste des 14 allergènes réglementaires</p>

    ${donnees.produits
      .map(
        (p) => `<div class="produit-affichette">
          <p class="nom-produit">${echapper(p.nom)}</p>
          <p class="allergenes-produit">${
            !p.allergenesVerifies
              ? '<span class="statut-alerte">Allergènes non encore vérifiés</span>'
              : p.allergenes.length === 0
                ? '<span class="sans-allergene">Aucun allergène déclaré</span>'
                : p.allergenes
                    .map((a) => `<span class="allergene">${echapper(libelleAllergene(a))}</span>`)
                    .join(' · ')
          }</p>
          ${
            p.allergenesSurDemande.length === 0
              ? ''
              : `<p class="allergenes-sur-demande">Sur demande : ${p.allergenesSurDemande
                  .map((a) => `<span class="allergene">${echapper(libelleAllergene(a))}</span>`)
                  .join(' · ')}</p>`
          }
        </div>`,
      )
      .join('')}

    <div class="avertissement-affichette">
      Nos préparations sont réalisées sur un même plan de travail : une présence
      accidentelle de traces d'autres allergènes ne peut pas être exclue.
      N'hésitez pas à nous interroger.
    </div>

    <p style="margin-top:8mm;font-size:9pt;color:#71717a">
      Affichette éditée le ${echapper(formaterDate(donnees.dateGeneration))}.
    </p>
  `;

  return documentHtml('Affichette allergènes', corps, { styleAdditionnel: STYLE_AFFICHETTE });
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Etiquette de bac de pate
   ═══════════════════════════════════════════════════════════════════════════ */

export type DonneesEtiquette = {
  readonly numeroLotPate: string;
  readonly recetteCode: string;
  readonly recetteNom: string;
  /**
   * Jour civil pur (`"2026-07-25"`, pose par `donneesEtiquetteBac`,
   * `documents/donnees.ts`) : AUCUNE heure
   * de production réelle n'est saisie nulle part dans l'application. Ne JAMAIS
   * formater avec `formaterDateHeure` — voir le docblock d'`etiquetteBac`
   * ci-dessous (DÉFAUT CORRIGÉ, audit `docs/31-DOCUMENTS-OUVERTS.md` §3.2).
   */
  readonly dateProduction: string;
  /**
   * ISO complet, mais ANCRÉ sur un minuit UTC arbitraire
   * (`ajouterHeures(dateProduction + 'T00:00:00Z', dureeHeures)`,
   * `packages/db/src/services/production.ts`) : l'heure qu'il porte ne
   * représente aucun instant réellement observé, exactement comme
   * `dateProduction` ci-dessus. Même consigne : `formaterDate`, jamais
   * `formaterDateHeure`.
   */
  readonly dateDlc: string;
  readonly volumeMl: number;
  readonly allergenes: readonly string[];
  /** Faux dès qu'un seul ingrédient de la recette n'a jamais été évalué. */
  readonly allergenesVerifies: boolean;
};

/**
 * Etiquette a coller sur le bac. Document INTERNE de tracabilite : pas de
 * mention commerciale, mais la DLC en evidence — c'est elle qui declenche le
 * retrait du bac.
 *
 * DÉFAUT CORRIGÉ (audit `docs/31-DOCUMENTS-OUVERTS.md` §3.2, 31/07/2026) :
 * `formaterDateHeure` était appelé ici sur `dateProduction`/`dateDlc`, deux
 * valeurs dont l'heure ne représente jamais un instant réellement observé
 * (voir leurs commentaires sur `DonneesEtiquette` ci-dessus) — ce qui
 * fabriquait une heure de production inventée (« 02:00 » l'été à Bruxelles,
 * pour un jour civil ancré à minuit UTC). `formaterDate` (date seule),
 * déjà utilisé par l'écran pour ces mêmes champs (`Production.tsx`), est la
 * seule fonction honnête sur cette étiquette.
 */
export function etiquetteBac(donnees: DonneesEtiquette): RenduGabarit {
  const corps = `
    <div style="border:0.8mm solid #18181b;padding:6mm">
      <p style="margin:0;font-size:9pt;text-transform:uppercase;letter-spacing:0.4pt;color:#71717a">
        Lot de pâte
      </p>
      <p style="margin:1mm 0 4mm;font-family:'Cascadia Mono',Consolas,monospace;font-size:20pt;font-weight:600;color:#18181b">
        ${echapper(donnees.numeroLotPate)}
      </p>

      <p style="margin:0;font-size:15pt;font-weight:600;color:#18181b">
        ${echapper(donnees.recetteCode)} — ${echapper(donnees.recetteNom)}
      </p>
      <p style="margin:1mm 0 5mm;font-size:11pt">${echapper(formaterQuantite(donnees.volumeMl, 'ml'))}</p>

      <table style="font-size:11pt">
        <colgroup><col style="width:65%"><col style="width:35%"></colgroup>
        <tr>
          <td style="border:none;padding:1mm 0">Produit le</td>
          <td style="border:none;padding:1mm 0" class="num">${echapper(formaterDate(donnees.dateProduction))}</td>
        </tr>
        <tr>
          <td style="border:none;padding:1mm 0;font-weight:600;color:#b45309">À CONSOMMER AVANT LE</td>
          <td style="border:none;padding:1mm 0;font-weight:600;color:#b45309" class="num">
            ${echapper(formaterDate(donnees.dateDlc))}
          </td>
        </tr>
      </table>

      <p style="margin:5mm 0 0;font-size:10pt">
        <strong>Allergènes :</strong> ${
          !donnees.allergenesVerifies
            ? `<span class="statut-alerte">non encore vérifiés</span>`
            : donnees.allergenes.length === 0
              ? `<span class="absent">aucun déclaré</span>`
              : echapper(donnees.allergenes.map(libelleAllergene).join(' · '))
        }
      </p>
    </div>
  `;

  return documentHtml(`Étiquette ${donnees.numeroLotPate}`, corps);
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. Rapport de session
   ═══════════════════════════════════════════════════════════════════════════ */

export type DonneesRapportSession = {
  readonly numero: string;
  readonly lieuNom: string;
  readonly dateSession: string;
  readonly ventes: readonly {
    nomProduit: string;
    quantite: number;
    prixUnitaireCents: number;
    montantCents: number;
  }[];
  readonly caTotalCents: number;
  readonly caTransformeCents: number;
  readonly caRevenduCents: number;
  readonly caEspecesCents: number;
  readonly caCarteCents: number;
  readonly ecartCaisseCents: number;
  readonly coutMatiereCents: number;
  readonly commissionCarteCents: number;
  readonly fraisTotauxCents: number;
  readonly margeBruteCents: number;
  readonly margeNetteCents: number;
  readonly margeParHeureCents: number | null;
  readonly crepesProduites: number;
  readonly crepesVendues: number;
  readonly crepesInvendues: number;
  readonly crepesCassees: number;
  readonly tauxEcoulementBp: number | null;
  readonly notesQualitatives: string | null;
};

export function rapportSession(donnees: DonneesRapportSession): RenduGabarit {
  const ligne = (libelle: string, valeur: string, fort = false): string =>
    `<tr${fort ? ' class="total"' : ''}>
      <td>${echapper(libelle)}</td>
      <td class="num">${valeur}</td>
    </tr>`;

  const corps = `
    ${entete(`Session du ${formaterDate(donnees.dateSession)}`, donnees.lieuNom, donnees.numero)}

    <h2>Ventes</h2>
    <table>
      <colgroup>
        <col style="width:55%">
        <col style="width:15%">
        <col style="width:15%">
        <col style="width:15%">
      </colgroup>
      <thead>
        <tr>
          <th>Produit</th>
          <th class="num">Qté</th>
          <th class="num">PU (€)</th>
          <th class="num">Total (€)</th>
        </tr>
      </thead>
      <tbody>
        ${donnees.ventes
          .map(
            (v) => `<tr>
              <td>${echapper(v.nomProduit)}</td>
              <td class="num">${v.quantite}</td>
              <td class="num">${echapper(formaterMontant(v.prixUnitaireCents))}</td>
              <td class="num">${echapper(formaterMontant(v.montantCents))}</td>
            </tr>`,
          )
          .join('')}
        <tr class="total">
          <td>Chiffre d'affaires</td>
          <td class="num"></td>
          <td class="num"></td>
          <td class="num">${echapper(formaterMontant(donnees.caTotalCents))}</td>
        </tr>
      </tbody>
    </table>

    <div class="paire">
      <div>
        <h2>Caisse</h2>
        <table>
          ${COLGROUP_LIGNE}
          ${ligne('Espèces', formaterMontant(donnees.caEspecesCents))}
          ${ligne('Carte (SumUp)', formaterMontant(donnees.caCarteCents))}
          ${ligne(
            'Écart de caisse',
            donnees.ecartCaisseCents === 0
              ? '0,00'
              : `<span class="statut-depassement">${echapper(formaterMontant(donnees.ecartCaisseCents))}</span>`,
            true,
          )}
        </table>
      </div>
      <div>
        <h2>Ventilation</h2>
        <table>
          ${COLGROUP_LIGNE}
          ${ligne('Transformé', formaterMontant(donnees.caTransformeCents))}
          ${ligne('Revendu', formaterMontant(donnees.caRevenduCents))}
        </table>
      </div>
    </div>

    <h2>Production</h2>
    <table>
      ${COLGROUP_LIGNE}
      ${ligne('Produites', String(donnees.crepesProduites))}
      ${ligne('Vendues', String(donnees.crepesVendues))}
      ${ligne('Invendues', String(donnees.crepesInvendues))}
      ${ligne('Cassées', String(donnees.crepesCassees))}
      ${ligne(
        "Taux d'écoulement",
        donnees.tauxEcoulementBp === null ? '—' : formaterPourcent(donnees.tauxEcoulementBp),
        true,
      )}
    </table>

    <h2>Rentabilité</h2>
    <table>
      ${COLGROUP_LIGNE}
      ${ligne('Coût matière', formaterMontant(donnees.coutMatiereCents))}
      ${ligne('Marge brute', formaterMontant(donnees.margeBruteCents))}
      ${ligne('Frais de session', formaterMontant(donnees.fraisTotauxCents))}
      ${ligne('Commission carte', formaterMontant(donnees.commissionCarteCents))}
      ${ligne('Marge nette', formaterMontant(donnees.margeNetteCents), true)}
      ${ligne(
        'Marge par heure de présence',
        donnees.margeParHeureCents === null
          ? `<span class="absent">${TIRET_ABSENT}</span>`
          : formaterEuros(donnees.margeParHeureCents),
        true,
      )}
    </table>

    ${
      donnees.notesQualitatives === null
        ? ''
        : `<h2>Notes</h2><p>${echapper(donnees.notesQualitatives)}</p>`
    }

    <p class="mention">${echapper(MENTION_FRANCHISE_TVA)}</p>
    <p class="mention">${echapper(MENTION_NE_REMPLACE_PAS)}</p>
  `;

  return documentHtml(`Rapport de session ${donnees.numero}`, corps, {
    pied: pied(`Rapport de session ${donnees.numero}`),
  });
}

/** Multiplicateur lisible : 8500 bp -> « × 0,85 ». Meme convention que `ProchaineSession.tsx`. */
function formaterFacteurBp(bp: number): string {
  return `× ${(bp / BASE_POINTS).toFixed(2).replace('.', ',')}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Brief avant-marche
   ═══════════════════════════════════════════════════════════════════════════ */

export type DonneesBrief = {
  readonly session: { numero: string; dateSession: string; lieuNom: string };
  readonly crepesRecommandees: number;
  readonly crepesRetenues: number;
  readonly contrainteLimitante: string | null;
  readonly manqueAGagnerCents: number | null;
  readonly confianceBp: number;
  readonly nbSessionsComparables: number;
  readonly baseline: { baselineCrepes: number; explication: string };
  readonly facteurs: {
    meteoBp: number;
    evenementBp: number;
    saisonBp: number;
    tendanceBp: number;
  };
  readonly evenements: readonly { nom: string }[];
  readonly meteo:
    | {
        disponible: true;
        temperatureC: number;
        precipitationsMm: number;
        ventKmh: number;
        ventFort: boolean;
        explication: string;
      }
    | { disponible: false; raison: string };
  readonly contraintes: readonly { libelle: string; plafondCrepes: number }[];
  readonly alertesStock: readonly {
    nomIngredient: string;
    quantiteDisponible: number;
    stockSecurite: number;
    unite: Unite;
  }[];
  /**
   * Fenêtre (en jours avant DLC) qui a servi à sélectionner `alertesDlc`
   * ci-dessous — `parametre.brief_horizon_alerte_dlc_jours` (§7 : aucun seuil
   * en dur). SANS ce champ, le document affichait une liste filtrée sans dire
   * sur quelle fenêtre, alors que l'écran Stock utilise un défaut DIFFÉRENT
   * (14 jours, `formaterJoursRestants`) : à la même seconde sur la même base,
   * les deux auraient pu annoncer des comptes différents sans qu'aucun des
   * deux ne dise pourquoi. Un chiffre sans sa fenêtre est incomparable.
   */
  readonly horizonJours: number;
  readonly alertesDlc: readonly {
    ingredientNom: string;
    numeroLotFournisseur: string | null;
    dateDlc: string;
  }[];
};

/**
 * Brief avant-marche : le document qu'on relit le samedi soir avant de partir.
 *
 * Une page, aucune mention de franchise TVA — document interne, jamais remis
 * a un tiers (a la difference du bon de commande ci-dessous). Structure en
 * deux colonnes (`.paire`) pour tenir sur une seule page malgre la quantite
 * d'information : c'est le meme choix que `rapportSession`.
 */
export function briefAvantMarche(donnees: DonneesBrief): RenduGabarit {
  const ligne = (libelle: string, valeur: string, alerte = false): string =>
    `<tr${alerte ? ' class="total"' : ''}>
      <td>${echapper(libelle)}</td>
      <td class="num"${alerte ? ` style="color:${COULEURS_IMPRESSION.alerte}"` : ''}>${valeur}</td>
    </tr>`;

  const libelleEvenement =
    donnees.evenements.length === 0
      ? 'aucun ce jour-là'
      : donnees.evenements.map((e) => e.nom).join(', ');

  const corps = `
    ${entete(
      `Brief avant-marché — ${donnees.session.lieuNom}`,
      formaterDate(donnees.session.dateSession),
      donnees.session.numero,
    )}

    <div class="bloc" style="display:flex;align-items:baseline;gap:6mm">
      <span style="font-size:26pt;font-weight:600;color:${COULEURS_IMPRESSION.encre}">
        ${donnees.crepesRetenues}
      </span>
      <span style="font-size:11pt;color:${COULEURS_IMPRESSION.encreTertiaire}">crêpes à produire</span>
    </div>
    ${
      donnees.contrainteLimitante === null
        ? ''
        : `<p class="statut-alerte">
            ▲ Ramené de ${donnees.crepesRecommandees} à ${donnees.crepesRetenues} —
            limite : ${echapper(donnees.contrainteLimitante)}.
            ${
              donnees.manqueAGagnerCents === null
                ? ''
                : `Manque à gagner estimé : ${echapper(formaterEuros(donnees.manqueAGagnerCents))}.`
            }
          </p>`
    }

    <div class="paire">
      <div>
        <h2>D'où vient ce chiffre</h2>
        <table>
          ${COLGROUP_LIGNE}
          ${ligne('Base historique', `${donnees.baseline.baselineCrepes} crêpes`)}
          ${ligne('Météo', formaterFacteurBp(donnees.facteurs.meteoBp))}
          ${ligne(`Événement — ${echapper(libelleEvenement)}`, formaterFacteurBp(donnees.facteurs.evenementBp))}
          ${ligne('Saison', formaterFacteurBp(donnees.facteurs.saisonBp))}
          ${ligne('Tendance', formaterFacteurBp(donnees.facteurs.tendanceBp))}
        </table>
        <p style="margin-top:2mm;font-size:8.5pt;color:${COULEURS_IMPRESSION.encreTertiaire}">
          Confiance : ${formaterPourcent(donnees.confianceBp)}, sur ${donnees.nbSessionsComparables}
          session${donnees.nbSessionsComparables > 1 ? 's' : ''} comparable${
            donnees.nbSessionsComparables > 1 ? 's' : ''
          }.
        </p>
      </div>
      <div>
        <h2>Contraintes</h2>
        <table>
          <colgroup><col style="width:60%"><col style="width:40%"></colgroup>
          <thead>
            <tr><th>Contrainte</th><th class="num">Plafond</th></tr>
          </thead>
          <tbody>
            ${donnees.contraintes
              .map((c) => {
                const limitante = c.libelle === donnees.contrainteLimitante;
                return `<tr>
                  <td${limitante ? ` style="color:${COULEURS_IMPRESSION.alerte};font-weight:600"` : ''}>
                    ${limitante ? '▲ ' : ''}${echapper(c.libelle)}
                  </td>
                  <td class="num"${limitante ? ` style="color:${COULEURS_IMPRESSION.alerte};font-weight:600"` : ''}>
                    ${c.plafondCrepes} crêpes
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <h2>Météo annoncée</h2>
    ${
      donnees.meteo.disponible
        ? `<p>
            ${donnees.meteo.temperatureC} °C, ${donnees.meteo.precipitationsMm} mm de précipitations,
            vent ${donnees.meteo.ventKmh} km/h. ${echapper(donnees.meteo.explication)}
            ${donnees.meteo.ventFort ? '<span class="statut-alerte"> ▲ Vent fort : prévoir le lestage du stand.</span>' : ''}
          </p>`
        : `<p><span class="absent">Météo indisponible — ${echapper(donnees.meteo.raison)}</span></p>`
    }

    <div class="paire">
      <div>
        <h2>Stock</h2>
        ${
          donnees.alertesStock.length === 0
            ? `<p><span class="absent">Aucun ingrédient sous le seuil de sécurité.</span></p>`
            : `<table>
                <colgroup><col style="width:50%"><col style="width:25%"><col style="width:25%"></colgroup>
                <thead><tr><th>Ingrédient</th><th class="num">Disponible</th><th class="num">Seuil</th></tr></thead>
                <tbody>
                  ${donnees.alertesStock
                    .map(
                      (a) => `<tr>
                        <td>${echapper(a.nomIngredient)}</td>
                        <td class="num statut-alerte">${echapper(formaterQuantite(a.quantiteDisponible, a.unite))}</td>
                        <td class="num">${echapper(formaterQuantite(a.stockSecurite, a.unite))}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>`
        }
      </div>
      <div>
        <h2>Lots à moins de ${donnees.horizonJours} jours de leur DLC</h2>
        ${
          donnees.alertesDlc.length === 0
            ? `<p><span class="absent">Aucun lot à moins de ${donnees.horizonJours} jours de sa DLC.</span></p>`
            : `<table>
                <colgroup><col style="width:40%"><col style="width:35%"><col style="width:25%"></colgroup>
                <thead><tr><th>Ingrédient</th><th>Lot</th><th class="num">DLC</th></tr></thead>
                <tbody>
                  ${donnees.alertesDlc
                    .map(
                      (a) => `<tr>
                        <td>${echapper(a.ingredientNom)}</td>
                        <td>${a.numeroLotFournisseur === null ? `<span class="absent">${TIRET_ABSENT}</span>` : echapper(a.numeroLotFournisseur)}</td>
                        <td class="num statut-alerte">${echapper(formaterDate(a.dateDlc))}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>`
        }
      </div>
    </div>
  `;

  return documentHtml(`Brief avant-marché ${donnees.session.numero}`, corps, {
    pied: pied(`Brief avant-marché ${donnees.session.numero}`),
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. Bon de commande fournisseur
   ═══════════════════════════════════════════════════════════════════════════ */

export type DonneesBonCommande = {
  readonly numero: string;
  readonly fournisseurNom: string;
  readonly fournisseurEmail: string | null;
  readonly dateCreation: string;
  readonly dateReceptionSouhaitee: string | null;
  readonly lignes: readonly {
    nomIngredient: string;
    conditionnementLibelle: string | null;
    quantiteConditionnements: number;
    quantiteUniteRef: number;
    unite: Unite;
    montantLigneCents: number;
  }[];
  readonly montantTotalCents: number;
  readonly notes: string | null;
};

/**
 * Bon de commande, joint au mail envoye au fournisseur (D-009 : jamais avant
 * validation humaine — cette fonction ne fait que produire le PDF, l'envoi
 * reste une etape separee dans `routes/commandes.ts`).
 *
 * Document COMMERCIAL sortant : porte donc la mention de franchise TVA, a la
 * difference du brief avant-marche ci-dessus.
 */
export function bonCommande(donnees: DonneesBonCommande): RenduGabarit {
  const corps = `
    ${entete('Bon de commande', donnees.fournisseurNom, donnees.numero)}

    <p style="font-size:9pt;color:${COULEURS_IMPRESSION.encreTertiaire}">
      Commande créée le ${echapper(formaterDate(donnees.dateCreation))}.
      ${donnees.fournisseurEmail === null ? '' : `Contact : ${echapper(donnees.fournisseurEmail)}.`}
    </p>

    <table>
      <colgroup>
        <col style="width:35%">
        <col style="width:30%">
        <col style="width:15%">
        <col style="width:20%">
      </colgroup>
      <thead>
        <tr>
          <th>Ingrédient</th>
          <th>Conditionnement</th>
          <th class="num">Quantité</th>
          <th class="num">Montant (€)</th>
        </tr>
      </thead>
      <tbody>
        ${donnees.lignes
          .map(
            (l) => `<tr>
              <td>${echapper(l.nomIngredient)}</td>
              <td>${
                l.conditionnementLibelle === null
                  ? `<span class="absent">${TIRET_ABSENT}</span>`
                  : `${l.quantiteConditionnements} × ${echapper(l.conditionnementLibelle)}`
              }</td>
              <td class="num">${echapper(formaterQuantite(l.quantiteUniteRef, l.unite))}</td>
              <td class="num">${echapper(formaterMontant(l.montantLigneCents))}</td>
            </tr>`,
          )
          .join('')}
        <tr class="total">
          <td>Total</td>
          <td class="num"></td>
          <td class="num"></td>
          <td class="num">${echapper(formaterMontant(donnees.montantTotalCents))}</td>
        </tr>
      </tbody>
    </table>

    <p class="bloc" style="margin-top:6mm">
      <strong>Livraison souhaitée le :</strong>
      ${
        donnees.dateReceptionSouhaitee === null
          ? `<span class="absent">à convenir avec le fournisseur</span>`
          : echapper(formaterDate(donnees.dateReceptionSouhaitee))
      }
    </p>

    ${donnees.notes === null ? '' : `<h2>Notes</h2><p>${echapper(donnees.notes)}</p>`}

    <p class="mention">${echapper(MENTION_FRANCHISE_TVA)}</p>
  `;

  return documentHtml(`Bon de commande ${donnees.numero}`, corps, {
    pied: pied(`Bon de commande ${donnees.numero}`),
  });
}
