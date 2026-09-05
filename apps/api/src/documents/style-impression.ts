/**
 * Feuille de style commune a TOUS les documents imprimes.
 *
 * `CLAUDE.md` §2 : « Un seul mécanisme pour tous les documents ». Un seul
 * fichier de style, donc, et non un style par gabarit — sinon la fiche
 * technique et le registre AFSCA divergeront au premier ajustement.
 *
 * Contraintes propres au papier, differentes de l'ecran :
 *  - le fond n'est pas garanti imprime : on ne fait jamais porter une
 *    information par un aplat de couleur seul ;
 *  - une bordure de 1 px a l'ecran devient tres fine sur papier : on passe a
 *    0,5 mm pour les separations structurelles ;
 *  - les tailles sont en POINTS et en millimetres, pas en pixels.
 */

export const COULEURS_IMPRESSION = {
  encre: '#18181b',
  encreSecondaire: '#3f3f46',
  encreTertiaire: '#71717a',
  filet: '#c9c9ce',
  filetLeger: '#e4e4e7',
  fondCreuse: '#f4f4f5',
  alerte: '#b45309',
  depassement: '#b91c1c',
} as const;

/**
 * Mention legale obligatoire sur tout document COMMERCIAL sortant.
 *
 * `docs/01` module 7 : le regime de franchise impose cette mention. Elle ne
 * s'applique pas aux documents internes (etiquette de bac, registre AFSCA).
 */
export const MENTION_FRANCHISE_TVA =
  'Régime particulier de franchise des petites entreprises — TVA non applicable, art. 56bis du Code de la TVA.';

/**
 * Mention legale obligatoire sur tout document de SYNTHESE FISCALE
 * (CLAUDE.md §7 : « l'application ne remplace pas un comptable, un guichet
 * d'entreprise ou l'AFSCA. Les ecrans de synthese fiscale portent une mention
 * en ce sens »).
 *
 * DEFAUT CORRIGE (audit `docs/31-DOCUMENTS-OUVERTS.md` §5) : seul le registre
 * AFSCA portait une mention de ce type (`registre-afsca.ts`, specifique a
 * l'AFSCA) — le rapport de session (CA, marge nette) et les deux journaux
 * Excel destines au comptable (recettes, achats) n'en avaient AUCUNE, alors
 * que ce sont exactement les pieces de synthese fiscale que CLAUDE.md §7 vise.
 *
 * Distincte de `MENTION_REGISTRE_AFSCA` (`registre-afsca.ts`), qui reste
 * propre au registre d'autocontrole (elle parle de saisie et de controle
 * AFSCA, pas de comptable ni de guichet d'entreprise) : les deux mentions ne
 * disent pas la meme chose et ne doivent pas fusionner.
 */
export const MENTION_NE_REMPLACE_PAS =
  "Ce document est produit par l'application à titre indicatif : il ne remplace ni un " +
  "comptable, ni un guichet d'entreprises, ni l'AFSCA.";

export const STYLE_IMPRESSION = `
  @page {
    size: A4;
    margin: 15mm 15mm 18mm 15mm;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    font-size: 10pt;
    line-height: 1.35;
    color: ${COULEURS_IMPRESSION.encreSecondaire};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── En-tete et pied ─────────────────────────────────────────────────── */
  .entete {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 0.5mm solid ${COULEURS_IMPRESSION.filet};
    padding-bottom: 3mm;
    margin-bottom: 6mm;
  }
  .entete h1 {
    margin: 0;
    font-size: 16pt;
    font-weight: 600;
    letter-spacing: -0.2pt;
    color: ${COULEURS_IMPRESSION.encre};
  }
  .entete .sous-titre {
    margin: 1mm 0 0;
    font-size: 9pt;
    color: ${COULEURS_IMPRESSION.encreTertiaire};
  }
  .entete .reference {
    text-align: right;
    font-size: 9pt;
    color: ${COULEURS_IMPRESSION.encreTertiaire};
  }
  .entete .reference strong {
    display: block;
    font-family: 'Cascadia Mono', Consolas, monospace;
    font-size: 11pt;
    color: ${COULEURS_IMPRESSION.encre};
  }

  .pied {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    border-top: 0.3mm solid ${COULEURS_IMPRESSION.filetLeger};
    padding-top: 2mm;
    font-size: 7.5pt;
    color: ${COULEURS_IMPRESSION.encreTertiaire};
    display: flex;
    justify-content: space-between;
  }

  /* ── Sections ────────────────────────────────────────────────────────── */
  h2 {
    margin: 6mm 0 2mm;
    font-size: 8pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4pt;
    color: ${COULEURS_IMPRESSION.encreTertiaire};
  }
  /* Un titre ne doit jamais rester seul en bas de page. */
  h1, h2 { break-after: avoid; }

  /* ── Tableaux ────────────────────────────────────────────────────────── */
  /*
   * DEFAUT CRITIQUE CORRIGE (audit du 31/07/2026, docs/24 par.2.1) : sans
   * table-layout fixed, une seule cellule au contenu insecable (un code de
   * reference colle, sans le moindre espace) forcait la largeur de sa colonne
   * - donc de la table entiere - au-dela de la largeur imprimable. Chromium,
   * a l'impression, ne fait JAMAIS defiler horizontalement : il coupe au bord
   * de la page, et les colonnes suivantes disparaissent purement et
   * simplement, sur TOUTES les lignes. C'est exactement la discipline que
   * docs/07-DOCTRINE-ERP-ET-DESIGN.md par.4.5 impose deja a l'ecran.
   *
   * fixed seul ne suffit pas : SANS largeurs declarees, le navigateur
   * repartit les colonnes A EGALITE, ce qui peut degrader un tableau qui
   * fonctionnait par chance en layout auto. C'est pourquoi CHAQUE table des
   * gabarits (gabarits.ts, registre-afsca.ts) porte desormais son propre
   * colgroup de largeurs explicites (voir colgroup-largeurs.test.ts, garde
   * D-081-like : la somme de chaque colgroup doit faire EXACTEMENT 100, sinon
   * le navigateur renormalise et retrecit tout en silence).
   */
  table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 9.5pt;
  }
  thead {
    /* En-tete repete sur chaque page d'un tableau long. */
    display: table-header-group;
  }
  th {
    text-align: left;
    font-size: 7.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3pt;
    color: ${COULEURS_IMPRESSION.encreTertiaire};
    border-bottom: 0.4mm solid ${COULEURS_IMPRESSION.filet};
    padding: 1.5mm 2mm;
    /* Un libelle d'en-tete est court et controle par l'application : le
       retour a la ligne reste un filet de securite, jamais la norme. */
    overflow-wrap: break-word;
  }
  td {
    padding: 1.5mm 2mm;
    border-bottom: 0.2mm solid ${COULEURS_IMPRESSION.filetLeger};
    vertical-align: top;
    /* Le complement indispensable de table-layout fixed ci-dessus : une
       chaine sans espace s'enroule maintenant DANS sa cellule (la ligne
       grandit) au lieu de pousser les colonnes suivantes hors de la page. */
    overflow-wrap: break-word;
  }
  tr { break-inside: avoid; }

  /* Nombres a droite, chiffres tabulaires : la virgule s'aligne. */
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums slashed-zero;
    white-space: nowrap;
  }
  .total td {
    border-top: 0.4mm solid ${COULEURS_IMPRESSION.filet};
    border-bottom: none;
    font-weight: 600;
    color: ${COULEURS_IMPRESSION.encre};
  }

  /* ── Statuts : GLYPHE + mot, jamais la couleur seule ─────────────────── */
  /* Le fond n'est pas garanti imprime, et le document peut sortir en noir et
     blanc chez le comptable ou l'AFSCA. */
  .statut-alerte { color: ${COULEURS_IMPRESSION.alerte}; font-weight: 600; }
  .statut-depassement { color: ${COULEURS_IMPRESSION.depassement}; font-weight: 600; }

  .absent { color: ${COULEURS_IMPRESSION.encreTertiaire}; }

  /* ── Blocs ───────────────────────────────────────────────────────────── */
  .bloc {
    border: 0.3mm solid ${COULEURS_IMPRESSION.filet};
    padding: 3mm;
    margin-bottom: 4mm;
    break-inside: avoid;
  }
  .mention {
    margin-top: 6mm;
    padding-top: 2mm;
    border-top: 0.2mm solid ${COULEURS_IMPRESSION.filetLeger};
    font-size: 7.5pt;
    color: ${COULEURS_IMPRESSION.encreTertiaire};
  }

  .paire { display: flex; gap: 4mm; }
  .paire > * { flex: 1; }
`;

/**
 * Style specifique a l'affichette allergenes.
 *
 * Exigence de `docs/01` module 1 : « lisible à un mètre ». Ce n'est pas une
 * preference esthetique — c'est une obligation d'information du consommateur
 * sur un stand. D'ou des corps de 20 a 48 pt, sans commune mesure avec les
 * autres documents.
 */
export const STYLE_AFFICHETTE = `
  @page { size: A4; margin: 12mm; }
  body { font-size: 16pt; }
  .titre-affichette {
    font-size: 34pt;
    font-weight: 600;
    letter-spacing: -0.5pt;
    margin: 0 0 2mm;
    color: ${COULEURS_IMPRESSION.encre};
  }
  .sous-titre-affichette {
    font-size: 13pt;
    color: ${COULEURS_IMPRESSION.encreTertiaire};
    margin: 0 0 8mm;
  }
  .produit-affichette {
    border-top: 0.6mm solid ${COULEURS_IMPRESSION.filet};
    padding: 5mm 0;
    break-inside: avoid;
  }
  .nom-produit {
    font-size: 22pt;
    font-weight: 600;
    color: ${COULEURS_IMPRESSION.encre};
    margin: 0 0 2mm;
  }
  .allergenes-produit {
    font-size: 18pt;
    color: ${COULEURS_IMPRESSION.encreSecondaire};
  }
  .allergene {
    font-weight: 600;
    color: ${COULEURS_IMPRESSION.encre};
    text-transform: uppercase;
  }
  .sans-allergene { font-size: 16pt; color: ${COULEURS_IMPRESSION.encreTertiaire}; }
  .allergenes-sur-demande {
    font-size: 14pt;
    font-style: italic;
    color: ${COULEURS_IMPRESSION.encreSecondaire};
    margin: 2mm 0 0;
  }
  .avertissement-affichette {
    margin-top: 10mm;
    padding: 4mm;
    border: 0.6mm solid ${COULEURS_IMPRESSION.filet};
    font-size: 12pt;
  }
`;
