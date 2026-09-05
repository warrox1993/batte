/**
 * Catalogue des codes motifs.
 *
 * Meme principe que `CATALOGUE_PARAMETRES` (decision D-013) : le catalogue
 * TypeScript est la source unique, le seed le transpose, et les codes sont
 * derives en type — une faute de frappe devient une erreur de compilation.
 *
 * Pourquoi des CODES et pas du texte libre (docs/07 §6.8 rang 9) : sans eux, on
 * ne peut pas repondre a « ou fuit la matiere ? », pourtant listee comme axe
 * analytique dans docs/01 §7. La litterature retail le dit sans detour :
 *
 *   « Si "inconnu" est le plus gros poste au bout de six mois, votre processus
 *     est casse. Un ecart qu'on ne peut pas attribuer est un ecart qu'on ne
 *     peut pas corriger. »
 *
 * Le texte libre reste disponible EN COMPLEMENT sur chaque mouvement, jamais en
 * remplacement.
 */

export type CategorieMotif = 'perte' | 'ajustement' | 'sortie_volontaire' | 'statut_lot';

export type DefinitionMotif = {
  readonly code: string;
  readonly libelle: string;
  readonly categorie: CategorieMotif;
};

export const CATALOGUE_MOTIFS: readonly DefinitionMotif[] = [
  // --- Pertes : matiere engagee puis perdue --------------------------------
  {
    code: 'CASSE_CUISSON',
    libelle: 'Crêpe ratée ou déchirée à la cuisson',
    categorie: 'perte',
  },
  {
    code: 'FOND_BASSINE',
    libelle: 'Fond de bassine non récupérable',
    categorie: 'perte',
  },
  {
    code: 'SURDOSAGE',
    libelle: 'Louche trop généreuse (surdosage à la cuisson)',
    categorie: 'perte',
  },
  {
    code: 'CASSE_TRANSPORT',
    libelle: 'Casse ou renversement au transport',
    categorie: 'perte',
  },
  {
    code: 'DLC_DEPASSEE',
    libelle: 'Jeté pour DLC dépassée',
    categorie: 'perte',
  },
  {
    code: 'NON_CONFORME',
    libelle: 'Écarté pour non-conformité (chaîne du froid, aspect, odeur)',
    categorie: 'perte',
  },

  // --- Sorties volontaires : la matiere part, mais ce n'est pas une perte ---
  {
    code: 'PERSO',
    libelle: 'Consommation personnelle',
    categorie: 'sortie_volontaire',
  },
  {
    code: 'DON',
    libelle: 'Don ou dégustation offerte',
    categorie: 'sortie_volontaire',
  },

  // --- Ajustements : le stock theorique etait faux --------------------------
  {
    code: 'INVENTAIRE_ECART',
    libelle: "Écart constaté à l'inventaire",
    categorie: 'ajustement',
  },
  {
    code: 'ERREUR_SAISIE',
    libelle: "Correction d'une erreur de saisie",
    categorie: 'ajustement',
  },

  // --- Changements de statut d'un lot ---------------------------------------
  {
    code: 'QUARANTAINE_DOUTE',
    libelle: 'Mise en quarantaine — conformité à vérifier',
    categorie: 'statut_lot',
  },
  {
    code: 'LEVEE_QUARANTAINE',
    libelle: 'Levée de quarantaine après vérification',
    categorie: 'statut_lot',
  },
  {
    code: 'RAPPEL_FOURNISSEUR',
    libelle: 'Bloqué suite à un rappel fournisseur',
    categorie: 'statut_lot',
  },
] as const;

export type CodeMotif = (typeof CATALOGUE_MOTIFS)[number]['code'];

export function definitionMotif(code: string): DefinitionMotif | undefined {
  return CATALOGUE_MOTIFS.find((m) => m.code === code);
}

/** Motifs proposables pour un type de mouvement donne, pour ne pas noyer l'ecran. */
export function motifsPour(categorie: CategorieMotif): readonly DefinitionMotif[] {
  return CATALOGUE_MOTIFS.filter((m) => m.categorie === categorie);
}
